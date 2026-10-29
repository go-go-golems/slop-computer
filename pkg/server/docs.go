package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Live documents: a tool's working copy of a data artifact (Pinup keeps one
// document per layer). Changes reach other clients on the artifact's docs
// stream as ephemeral events; a client that reconnects catches up by rev
// from the docs table, so the kernel event log never sees a drag.

func (s *Server) docRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/docs/{artifact}", s.guardPerm(admin, scopeRW, "docs:read", s.listDocs))
	m.HandleFunc("GET /api/docs/{artifact}/events", s.guardPerm(admin, scopeRW, "docs:read", s.docEvents))
	m.HandleFunc("GET /api/docs/{artifact}/{coll}/{id}", s.guardPerm(admin, scopeRW, "docs:read", s.getDoc))
	m.HandleFunc("PUT /api/docs/{artifact}/{coll}/{id}", s.guardPerm(admin, scopeRW, "docs:write", s.putDoc))
	m.HandleFunc("DELETE /api/docs/{artifact}/{coll}/{id}", s.guardPerm(admin, scopeRW, "docs:write", s.deleteDoc))
	m.HandleFunc("POST /api/docs/{artifact}/{coll}/{id}/acquire", s.guardPerm(admin, scopeRW, "docs:write", s.acquireDoc))
	m.HandleFunc("GET /api/presence/{artifact}", s.guardPerm(admin, scopeRW, "docs:read", s.listPresence))
	m.HandleFunc("POST /api/presence/{artifact}", s.guardPerm(admin, scopeRW, "docs:write", s.postPresence))
}

// docEventData is the largest document a doc event carries inline; clients
// GET bigger ones.
const docEventData = 64 << 10

func docPathOf(r *http.Request) string { return r.PathValue("coll") + "/" + r.PathValue("id") }

func (s *Server) docFail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrDocTooLarge):
		httpx.Fail(w, 413, "too_large", fmt.Sprintf("A document is at most %d KiB", store.MaxDocBytes>>10))
	case errors.Is(err, store.ErrDocQuota):
		httpx.Fail(w, 507, "quota_exceeded", fmt.Sprintf("A design keeps at most %d documents and %d MB", store.MaxDocs, store.MaxDocArtifactBytes>>20))
	default:
		s.fail(w, err)
	}
}

func (s *Server) listDocs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	after, _ := strconv.ParseInt(q.Get("after"), 10, 64)
	docs, head, err := s.Store.Docs(r.Context(), r.PathValue("artifact"), q.Get("prefix"), after)
	if err != nil {
		s.docFail(w, err)
		return
	}
	if docs == nil {
		docs = []store.Doc{}
	}
	httpx.OK(w, map[string]any{"docs": docs, "rev": head})
}

func (s *Server) getDoc(w http.ResponseWriter, r *http.Request) {
	d, err := s.Store.GetDoc(r.Context(), r.PathValue("artifact"), docPathOf(r))
	if err != nil {
		s.docFail(w, err)
		return
	}
	httpx.OK(w, d)
}

// publishDoc tells the artifact's docs streams about a change.
func (s *Server) publishDoc(artifact string, d store.Doc, actor string) {
	p := map[string]any{"path": d.Path, "rev": d.Rev, "by": actor}
	switch {
	case d.Data == nil:
		p["data"] = nil
	case len(d.Data) <= docEventData:
		p["data"] = json.RawMessage(d.Data)
	default:
		p["big"] = true
	}
	s.Events.Publish(store.Event{Type: store.EvDoc, Artifact: artifact, Actor: actor, Payload: store.MustJSON(p), CreatedAt: d.At})
}

func (s *Server) putDoc(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, store.MaxDocBytes+1))
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		s.docFail(w, store.ErrDocTooLarge)
		return
	}
	if err != nil {
		httpx.Fail(w, 400, "invalid_request", "Could not read the body")
		return
	}
	a := r.PathValue("artifact")
	d, err := s.Store.PutDoc(r.Context(), a, docPathOf(r), store.JSON(body), actor(r))
	if err != nil {
		s.docFail(w, err)
		return
	}
	s.publishDoc(a, d, actor(r))
	httpx.OK(w, map[string]any{"path": d.Path, "rev": d.Rev})
}

func (s *Server) deleteDoc(w http.ResponseWriter, r *http.Request) {
	a := r.PathValue("artifact")
	d, err := s.Store.DeleteDoc(r.Context(), a, docPathOf(r), actor(r))
	if err != nil {
		s.docFail(w, err)
		return
	}
	s.publishDoc(a, d, actor(r))
	httpx.OK(w, map[string]any{"path": d.Path, "rev": d.Rev})
}

func (s *Server) acquireDoc(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Holder string `json:"holder"`
		TTLMs  int64  `json:"ttlMs"`
	}
	if err := httpx.Read(w, r, &in, 4096); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {holder, ttlMs}")
		return
	}
	ok, err := s.Store.AcquireDoc(r.Context(), r.PathValue("artifact"), docPathOf(r), in.Holder, time.Duration(in.TTLMs)*time.Millisecond)
	if err != nil {
		s.docFail(w, err)
		return
	}
	httpx.OK(w, map[string]bool{"acquired": ok})
}

func writeDocEvent(w io.Writer, rev int64, typ string, payload []byte) error {
	if rev > 0 {
		if _, err := fmt.Fprintf(w, "id: %d\n", rev); err != nil {
			return err
		}
	}
	_, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", typ, payload)
	return err
}

// docEvents streams an artifact's document changes after ?after= (or
// Last-Event-ID) and then live ones, with presence. Like eventStream it
// subscribes before it replays, and skips what the replay already sent:
// revs are handed out under a row lock held to commit, so they commit in
// order.
func (s *Server) docEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Fail(w, 500, "unsupported", "Streaming unsupported")
		return
	}
	ctx, a := r.Context(), r.PathValue("artifact")
	after := int64(0)
	for _, raw := range []string{r.Header.Get("Last-Event-ID"), r.URL.Query().Get("after")} {
		if raw != "" {
			after, _ = strconv.ParseInt(raw, 10, 64)
			break
		}
	}
	project := s.projectOf(ctx, a)
	sub := s.Events.Subscribe(func(ev store.Event) bool {
		if store.DocStreamOnly(ev.Type) {
			return ev.Artifact == a
		}
		return (ev.Type == store.EvAgentWaiting || ev.Type == store.EvAgentLeft) && agentFor(ev.Artifact, ev.Project, a, project)
	})
	defer s.Events.Unsubscribe(sub)
	docs, _, err := s.Store.Docs(ctx, a, "", after)
	if err != nil {
		s.docFail(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	last := after
	for _, d := range docs {
		var data any
		if d.Data != nil {
			data = json.RawMessage(d.Data)
		}
		if writeDocEvent(w, d.Rev, store.EvDoc, store.MustJSON(map[string]any{"path": d.Path, "rev": d.Rev, "data": data, "by": d.By})) != nil {
			return
		}
		last = max(last, d.Rev)
	}
	_, _ = fmt.Fprintf(w, "event: ready\ndata: {\"rev\":%d}\n\n", last)
	flusher.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ping.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
		case ev, ok := <-sub.C:
			if !ok {
				return // fell behind: the client reconnects with its rev
			}
			switch ev.Type {
			case store.EvDoc:
				var p struct {
					Rev int64 `json:"rev"`
				}
				_ = json.Unmarshal(ev.Payload, &p)
				if p.Rev <= last {
					continue
				}
				if writeDocEvent(w, p.Rev, ev.Type, ev.Payload) != nil {
					return
				}
				last = p.Rev
			case store.EvPresence:
				if writeDocEvent(w, 0, ev.Type, ev.Payload) != nil {
					return
				}
			default: // an agent started or stopped waiting on this design
				var wt Waiter
				_ = json.Unmarshal(ev.Payload, &wt)
				pe := agentPeer(wt)
				pe.Left = ev.Type == store.EvAgentLeft
				if writeDocEvent(w, 0, store.EvPresence, store.MustJSON(pe)) != nil {
					return
				}
			}
		}
		flusher.Flush()
	}
}

// agentFor reports whether an agent waiting on (artifact, project) waits on
// design a of project p: on a itself, on its project, or on everything.
func agentFor(artifact, project, a, p string) bool {
	return artifact == a || (artifact == "" && (project == "" || project == p))
}

// Presence: who has a design open and what they look at, kept in memory
// (one process, like the event broker) and forgotten after presenceTTL
// without a post.
const presenceTTL = 30 * time.Second

type peer struct {
	Peer     string          `json:"peer"`
	User     string          `json:"user,omitempty"`
	Name     string          `json:"name,omitempty"`
	Kind     string          `json:"kind"`
	Presence json.RawMessage `json:"presence,omitempty"`
	Left     bool            `json:"left,omitempty"`
	seen     time.Time
}

func agentPeer(wt Waiter) peer {
	return peer{Peer: "agent-" + strconv.FormatInt(wt.ID, 10), User: wt.User, Name: wt.Name, Kind: "agent", Presence: json.RawMessage(`{}`)}
}

type presenceHub struct {
	mu    sync.Mutex
	peers map[string]map[string]*peer // artifact → peer id → peer
}

func newPresenceHub() *presenceHub { return &presenceHub{peers: map[string]map[string]*peer{}} }

// expire drops an artifact's stale peers and returns them.
func (h *presenceHub) expire(a string, now time.Time) []peer {
	var gone []peer
	for id, p := range h.peers[a] {
		if now.Sub(p.seen) > presenceTTL {
			delete(h.peers[a], id)
			gone = append(gone, peer{Peer: p.Peer, User: p.User, Kind: p.Kind, Left: true})
		}
	}
	return gone
}

func (s *Server) publishPresence(a string, ps ...peer) {
	evs := make([]store.Event, 0, len(ps))
	for _, p := range ps {
		evs = append(evs, store.Event{Type: store.EvPresence, Artifact: a, Actor: p.User, Payload: store.MustJSON(p), CreatedAt: time.Now().UTC()})
	}
	s.Events.Publish(evs...)
}

func (s *Server) listPresence(w http.ResponseWriter, r *http.Request) {
	ctx, a := r.Context(), r.PathValue("artifact")
	if err := s.Store.DocArtifact(ctx, a); err != nil {
		s.docFail(w, err)
		return
	}
	h := s.presence
	h.mu.Lock()
	gone := h.expire(a, time.Now())
	out := []peer{}
	for _, p := range h.peers[a] {
		out = append(out, *p)
	}
	h.mu.Unlock()
	s.publishPresence(a, gone...)
	project := s.projectOf(ctx, a)
	for _, wt := range s.waiters.list() {
		if agentFor(wt.Artifact, wt.Project, a, project) {
			out = append(out, agentPeer(wt))
		}
	}
	httpx.OK(w, map[string]any{"peers": out})
}

func (s *Server) postPresence(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Peer     string          `json:"peer"`
		Presence json.RawMessage `json:"presence"`
		Left     bool            `json:"left"`
	}
	if err := httpx.Read(w, r, &in, 4096); err != nil || in.Peer == "" || len(in.Peer) > 64 {
		httpx.Fail(w, 400, "invalid_request", "Send {peer, presence} (at most 4 KiB), or {peer, left: true}")
		return
	}
	ctx, a := r.Context(), r.PathValue("artifact")
	if err := s.Store.DocArtifact(ctx, a); err != nil {
		s.docFail(w, err)
		return
	}
	if len(in.Presence) == 0 || string(in.Presence) == "null" {
		in.Presence = json.RawMessage(`{}`)
	}
	u := me(r)
	p := peer{Peer: in.Peer, User: u.ID, Name: u.DisplayName, Kind: "viewer", Presence: in.Presence, Left: in.Left, seen: time.Now()}
	h := s.presence
	h.mu.Lock()
	if h.peers[a] == nil {
		h.peers[a] = map[string]*peer{}
	}
	if cur, ok := h.peers[a][in.Peer]; ok && cur.User != u.ID {
		h.mu.Unlock()
		httpx.Fail(w, 409, "peer_taken", "Another user has this peer id")
		return
	}
	if in.Left {
		delete(h.peers[a], in.Peer)
	} else {
		h.peers[a][in.Peer] = &p
	}
	gone := h.expire(a, time.Now())
	h.mu.Unlock()
	s.publishPresence(a, append(gone, p)...)
	httpx.OK(w, map[string]bool{"ok": true})
}
