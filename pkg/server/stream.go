package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

func (s *Server) streamRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/events", s.guardPerm(admin, scopeRW, "events:read", s.eventStream))
	m.HandleFunc("GET /api/comments/wait", s.guard(admin, scopeRW, s.waitComments))
	m.HandleFunc("GET /api/agents", s.guard(admin, scopeRW, s.listAgents))
}

// cursor reads where a client wants to resume: Last-Event-ID (sent by
// EventSource on reconnect), then ?after=, else "now" (no replay).
func (s *Server) cursor(r *http.Request) (int64, error) {
	for _, raw := range []string{r.Header.Get("Last-Event-ID"), r.URL.Query().Get("after")} {
		if raw != "" {
			return strconv.ParseInt(raw, 10, 64)
		}
	}
	return s.Store.LastSeq(r.Context())
}

func writeEvent(w http.ResponseWriter, ev store.Event) error {
	raw, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	if ev.Seq > 0 {
		if _, err = fmt.Fprintf(w, "id: %d\n", ev.Seq); err != nil {
			return err
		}
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, raw)
	return err
}

// eventStream is the Workshop's server-sent event stream. It subscribes
// before replaying stored events, so nothing committed in between is lost,
// and skips anything at or below the replayed cursor.
func (s *Server) eventStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Fail(w, 500, "unsupported", "Streaming unsupported")
		return
	}
	sub := s.Events.Subscribe(nil)
	defer s.Events.Unsubscribe(sub)
	last, err := s.cursor(r)
	if err != nil {
		httpx.Fail(w, 400, "invalid_request", "Invalid event cursor")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	for {
		evs, err := s.Store.EventsAfter(r.Context(), last, 500)
		if err != nil {
			return
		}
		for _, ev := range evs {
			if writeEvent(w, ev) != nil {
				return
			}
			last = ev.Seq
		}
		if len(evs) < 500 {
			break
		}
	}
	// Tell the client where the replay ended (also useful when nothing replayed).
	_, _ = fmt.Fprintf(w, "event: ready\ndata: {\"seq\":%d}\n\n", last)
	flusher.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
		case ev, ok := <-sub.C:
			if !ok {
				return // fell behind: the client reconnects with Last-Event-ID
			}
			if ev.Seq != 0 && ev.Seq <= last {
				continue
			}
			if writeEvent(w, ev) != nil {
				return
			}
			if ev.Seq > 0 {
				last = ev.Seq
			}
		}
		flusher.Flush()
	}
}

// Waiter is an agent blocked in `slop comments wait`.
type Waiter struct {
	ID       int64     `json:"id"`
	User     string    `json:"user"`
	Name     string    `json:"name"`
	Token    string    `json:"token,omitempty"`
	Project  string    `json:"project,omitempty"`
	Artifact string    `json:"artifact,omitempty"`
	Since    time.Time `json:"since"`
}

type waiters struct {
	mu   sync.Mutex
	next int64
	all  map[int64]Waiter
}

func newWaiters() *waiters { return &waiters{all: map[int64]Waiter{}} }

func (ws *waiters) add(w Waiter) Waiter {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	ws.next++
	w.ID = ws.next
	ws.all[w.ID] = w
	return w
}

func (ws *waiters) remove(id int64) {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	delete(ws.all, id)
}

func (ws *waiters) list() []Waiter {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	out := make([]Waiter, 0, len(ws.all))
	for _, w := range ws.all {
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (s *Server) listAgents(w http.ResponseWriter, r *http.Request) {
	httpx.OK(w, s.waiters.list())
}

// commentFrom is what the wait filter needs from a comment event's payload.
type commentFrom struct {
	Thread  json.RawMessage `json:"thread"`
	Comment *store.Comment  `json:"comment"`
}

// commentMatches reports whether ev is a new comment the caller should see:
// on the project/artifact asked for, and not written through the caller's
// own token (an agent ignores its own replies, but sees its owner's
// browser comments).
func commentMatches(ev store.Event, project, artifact, ownToken, ownUser string) bool {
	if ev.Type != store.EvThreadCreated && ev.Type != store.EvCommentCreated {
		return false
	}
	if (project != "" && ev.Project != project) || (artifact != "" && ev.Artifact != artifact) {
		return false
	}
	var p commentFrom
	if json.Unmarshal(ev.Payload, &p) != nil {
		return false
	}
	var c *store.Comment
	if ev.Type == store.EvCommentCreated {
		c = p.Comment
	} else {
		var t store.Thread
		if json.Unmarshal(p.Thread, &t) != nil || len(t.Comments) == 0 {
			return false
		}
		c = &t.Comments[0]
	}
	if c == nil {
		return false
	}
	if ownToken != "" {
		return c.TokenID == nil || *c.TokenID != ownToken
	}
	return c.By != ownUser
}

// waitComments blocks until a matching comment arrives after the cursor
// (default: now) or the timeout passes (204). The answer carries the whole
// thread, so an agent has the anchor and every earlier comment.
func (s *Server) waitComments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	project, artifact := q.Get("project"), q.Get("artifact")
	p := principal(r.Context())
	ownToken := ""
	if p.Token != nil {
		ownToken = p.Token.ID
	}
	timeout := 55 * time.Second
	if t, err := strconv.Atoi(q.Get("timeout")); err == nil && t > 0 && t <= 300 {
		timeout = time.Duration(t) * time.Second
	}
	match := func(ev store.Event) bool { return commentMatches(ev, project, artifact, ownToken, p.User.ID) }
	sub := s.Events.Subscribe(match)
	defer s.Events.Unsubscribe(sub)
	after, err := s.cursor(r)
	if err != nil {
		httpx.Fail(w, 400, "invalid_request", "Invalid event cursor")
		return
	}
	answer := func(ev store.Event) {
		var payload commentFrom
		_ = json.Unmarshal(ev.Payload, &payload)
		threadID := ""
		if ev.Type == store.EvCommentCreated {
			_ = json.Unmarshal(payload.Thread, &threadID)
		} else {
			var t store.Thread
			_ = json.Unmarshal(payload.Thread, &t)
			threadID = t.ID
		}
		t, err := s.Store.Thread(r.Context(), threadID)
		if err != nil {
			unavailable(w, err)
			return
		}
		httpx.OK(w, map[string]any{"seq": ev.Seq, "type": ev.Type, "thread": t, "artifact": ev.Artifact, "project": ev.Project})
	}
	for {
		evs, err := s.Store.EventsAfter(r.Context(), after, 500)
		if err != nil {
			unavailable(w, err)
			return
		}
		for _, ev := range evs {
			if match(ev) {
				answer(ev)
				return
			}
			after = ev.Seq
		}
		if len(evs) < 500 {
			break
		}
	}
	name := p.User.DisplayName
	tokenName := ""
	if p.Token != nil {
		tokenName = p.Token.Name
	}
	waiter := s.waiters.add(Waiter{User: p.User.ID, Name: name, Token: tokenName, Project: project, Artifact: artifact, Since: time.Now().UTC()})
	s.publish([]store.Event{{Type: store.EvAgentWaiting, Project: project, Artifact: artifact, Actor: p.User.ID, Payload: store.MustJSON(waiter), CreatedAt: waiter.Since}})
	defer func() {
		s.waiters.remove(waiter.ID)
		s.publish([]store.Event{{Type: store.EvAgentLeft, Project: project, Artifact: artifact, Actor: p.User.ID, Payload: store.MustJSON(waiter), CreatedAt: time.Now().UTC()}})
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-timer.C:
			w.WriteHeader(http.StatusNoContent)
			return
		case ev, ok := <-sub.C:
			if !ok {
				w.WriteHeader(http.StatusNoContent) // fell behind; the CLI retries from its cursor
				return
			}
			if ev.Seq > after {
				answer(ev)
				return
			}
		}
	}
}
