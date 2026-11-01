package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/httpx"
	"github.com/go-go-golems/slop/pkg/rt"
	"github.com/go-go-golems/slop/pkg/store"
	"github.com/go-go-golems/slop/pkg/system"
)

// The page protocol (ported from slop-computer's rt.go, same wire format so
// the built runtime, claude.js, runs unchanged): a view is one open page of
// an app for one person; its page reads /_rt/events (a fetch-streamed SSE)
// and calls /_rt/rpc on its sandbox origin, with the view's secret.

type rtState struct {
	views *rt.Registry
	key   []byte

	roomMu sync.Mutex
	joined map[string][]string // view → named rooms

	leaseMu sync.Mutex
	leases  map[string]lease // store \x00 path
}

type lease struct {
	holder string
	until  time.Time
}

func newRT(key []byte) *rtState {
	return &rtState{views: rt.NewRegistry(), key: key, joined: map[string][]string{}, leases: map[string]lease{}}
}

// rtFail is a protocol error with a code the runtime understands.
type rtFail struct{ Code, Message string }

func (e *rtFail) Error() string { return e.Code + ": " + e.Message }

func rtErr(code, format string, args ...any) error {
	return &rtFail{Code: code, Message: fmt.Sprintf(format, args...)}
}

// label is a store+app's sandbox origin label: stable while the server key
// is, so a store's localStorage survives new versions.
func (s *Server) label(storeID, app string) string {
	m := hmac.New(sha256.New, s.rt.key)
	m.Write([]byte(storeID + "\x00" + app))
	return "s" + hex.EncodeToString(m.Sum(nil))[:20]
}

// sandboxURL is the address of an app version on its store's origin.
func (s *Server) sandboxURL(ctx context.Context, v *rt.View, parent string) (string, string, error) {
	if s.Cfg.Hosts.Sandbox == "" {
		return "", "", rtErr("unavailable", "this server has no sandbox host")
	}
	l := s.label(v.Target, v.App)
	if err := s.Sys.SetOrigin(ctx, l, v.Target, v.App); err != nil {
		return "", "", err
	}
	origin := s.Cfg.Scheme + "://" + l + "." + s.Cfg.Hosts.Sandbox
	q := url.Values{"mode": {"app"}, "parent": {parent}}
	return origin + "/v/" + strconv.Itoa(v.Version) + "/?" + q.Encode(), origin, nil
}

// grantedCaps is what a view may run, as the runtime sees it: what the app
// declares and the core serves. (P6 adds the policy matrix and LLM access.)
func grantedCaps(v *rt.View) map[string]any {
	out := map[string]any{}
	for name := range v.Caps.Declared {
		switch name {
		case "db", "room", "downloads":
			out[name] = map[string]any{}
		case "assets":
			if v.Level >= rt.LevelInteract && v.Role != string(access.AudGuest) {
				out[name] = map[string]any{} // guests store no files: they answer to nobody
			}
		case "artifact":
			if v.Target == v.App && v.Role == string(access.AudAdmin) {
				out[name] = map[string]any{} // publishing replaces the app for everyone
			}
		case "user":
			scopes := []string{}
			for sc := range v.Caps.Scopes {
				scopes = append(scopes, sc)
			}
			sort.Strings(scopes)
			out["user"] = map[string]any{"scopes": scopes}
		}
	}
	// slop's own namespace: actions, read aliases, the visitor. Every app
	// view has it; declaring "slop" is not needed.
	out["slop"] = map[string]any{}
	return out
}

// viewOut answers an open: the view, its secret, and where to frame it.
type viewOut struct {
	*rt.View
	Secret string         `json:"secret"`
	URL    string         `json:"url"`
	Origin string         `json:"origin"`
	Level  string         `json:"level"`
	Caps   map[string]any `json:"caps"`
}

// openView opens a view of a store for p. parent is the origin that will
// frame it.
func (s *Server) openView(ctx context.Context, p *access.Principal, storeID, parent string) (*viewOut, error) {
	d, _, err := s.Env.K.Access.Can(ctx, p, storeID, rt.LevelView, "opening", true)
	if err != nil {
		return nil, err
	}
	if !d.OK {
		return nil, rtErr("not_granted", "you cannot open this")
	}
	run, err := s.Env.K.Running(ctx, storeID)
	if err != nil {
		return nil, err
	}
	if run.N == 0 {
		return nil, rtErr("unavailable", "nothing has been pushed to %s yet", run.App)
	}
	if run.Broken != "" {
		return nil, rtErr("unavailable", "the app is broken: %s", run.Broken)
	}
	var caps rt.Caps
	if run.Manifest != nil {
		caps = run.Manifest.Caps
	} else {
		caps, _ = rt.ParseManifest(nil, nil)
	}
	name := ""
	if p != nil && p.Person != nil {
		name = p.Person.Name
	}
	v := s.rt.views.Open(&rt.View{Target: storeID, App: run.App, Version: int(run.N), User: p.ID(), Name: name,
		Role: string(d.Audience), Level: d.Level, Caps: caps, Kind: "viewer"})
	u, origin, err := s.sandboxURL(ctx, v, parent)
	if err != nil {
		s.rt.views.Close(v, false)
		return nil, err
	}
	return &viewOut{View: v, Secret: v.Secret, URL: u, Origin: origin, Level: v.Level.String(), Caps: grantedCaps(v)}, nil
}

// failView answers a failed open on a site or API call.
func failView(w http.ResponseWriter, err error) {
	var f *rtFail
	if errors.As(err, &f) {
		status := 400
		switch f.Code {
		case "not_granted", "not_permitted":
			status = 403
		case "unavailable":
			status = 503
		}
		httpx.Fail(w, status, f.Code, f.Message)
		return
	}
	log.Printf("view: %v", err)
	httpx.Fail(w, 500, "unavailable", "the view could not be opened")
}

type originStore struct{}

// viewOf finds the calling view from its secret; on a sandbox origin the
// view must belong to that origin's store.
func (s *Server) viewOf(r *http.Request) *rt.View {
	bearer := r.Header.Get("Authorization")
	if !strings.HasPrefix(bearer, "Bearer "+rt.SecretPrefix) {
		return nil
	}
	v := s.rt.views.Lookup(strings.TrimPrefix(bearer, "Bearer "))
	if v == nil {
		return nil
	}
	if id, ok := r.Context().Value(originStore{}).(string); ok && id != v.Target {
		return nil
	}
	return v
}

// --- the stream --------------------------------------------------------

func writeSSE(w http.ResponseWriter, typ string, data any) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", typ, raw)
	return err
}

// docOut is a document as the runtime receives it. Rev is set only on the
// last document of a commit, so a resume point never splits a commit.
type docOut struct {
	Rev     int64           `json:"rev,omitempty"`
	Path    string          `json:"path"`
	Version int64           `json:"version"`
	Body    json.RawMessage `json:"body,omitempty"`
	Patch   *rt.Patch       `json:"patch,omitempty"`
	Base    int64           `json:"base,omitempty"`
	Deleted bool            `json:"deleted,omitempty"`
}

func (s *Server) hello(ctx context.Context, v *rt.View, head int64) map[string]any {
	return map[string]any{"view": v.ID, "target": v.Target, "app": v.App, "version": v.Version, "kind": v.Kind,
		"level": v.Level.String(), "caps": grantedCaps(v), "rev": head, "me": s.userInfo(ctx, v),
		"permissions": permissionStates(v)}
}

// viewEvents is a view's stream: hello, a catch-up from ?after=, then live
// commits (filtered by the view's subscriptions and read rules), room
// events and reloads.
func (s *Server) viewEvents(w http.ResponseWriter, r *http.Request) {
	v := s.viewOf(r)
	if v == nil {
		httpx.Fail(w, 401, "revoked", "the view is closed or expired")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Fail(w, 500, "unsupported", "streaming unsupported")
		return
	}
	ctx := r.Context()
	st, err := s.Env.K.Store(ctx, v.Target)
	if err != nil {
		httpx.Fail(w, 503, "unavailable", "the store is unavailable")
		return
	}
	ch := v.Attach()
	defer v.Detach(ch)
	resume := r.URL.Query().Has("after")
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	head := st.Head()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	last := head
	visible := func(path string) bool { return v.Wants(path) && v.Caps.Rules.CanRead(path, v.User, v.Level) }
	// sendAll writes docs, putting each commit's rev on its last document.
	sendAll := func(docs []docOut, revs []int64) error {
		for i, d := range docs {
			if i == len(docs)-1 || revs[i+1] != revs[i] {
				d.Rev = revs[i]
			}
			if err := writeSSE(w, "doc", d); err != nil {
				return err
			}
		}
		return nil
	}
	catchUp := func(from int64) error {
		rows, err := st.DocsSince(ctx, from, "")
		if err != nil {
			return err
		}
		var docs []docOut
		var revs []int64
		for _, d := range rows {
			if !visible(d.Path) {
				continue
			}
			o := docOut{Path: d.Path, Version: d.Version, Deleted: d.Body == nil}
			if d.Body != nil {
				o.Body, _ = json.Marshal(d.Body)
			}
			docs, revs = append(docs, o), append(revs, d.Rev)
			last = max(last, d.Rev)
		}
		last = max(last, st.Head())
		return sendAll(docs, revs)
	}
	if writeSSE(w, "hello", s.hello(ctx, v, head)) != nil {
		return
	}
	if resume && after >= 0 && after < head && catchUp(after) != nil {
		return
	}
	for _, room := range s.roomsOf(v) {
		_ = writeSSE(w, "peers", s.peersOf(v.Target, room))
	}
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
		case o, ok := <-ch:
			if !ok {
				return // replaced, closed, or fell behind: the runtime reconnects
			}
			var err error
			switch {
			case o.Rev > 0 && o.Rev <= last:
			case o.Rev > last+1:
				err = catchUp(last)
			case o.Rev > 0:
				last = o.Rev
				var docs []docOut
				var revs []int64
				for _, c := range o.Changes {
					if visible(c.Path) {
						docs = append(docs, docOut{Path: c.Path, Version: c.Version, Body: c.Body, Patch: c.Patch, Base: c.Base, Deleted: c.Deleted})
						revs = append(revs, o.Rev)
					}
				}
				err = sendAll(docs, revs)
			default:
				err = writeSSE(w, o.Type, o.Data)
				if o.Type == "revoked" {
					flusher.Flush()
					return
				}
			}
			if err != nil {
				return
			}
		}
		flusher.Flush()
	}
}

// publish sends every commit to the views of its store, with a patch
// instead of the body when the patch is small next to it (diff sync), and
// tells views of an app whose ref moved to reload.
func (s *Server) publish(c *store.Commit) {
	out := rt.Out{Rev: c.Rev}
	refMoved := false
	for _, ch := range c.Changes {
		switch ch.Kind {
		case "ref":
			refMoved = true
		case "doc":
			rc := &rt.Change{Rev: c.Rev, Path: ch.Key, Version: ch.Version, Body: ch.Body, Deleted: ch.Body == nil}
			if ch.Body != nil && ch.Prev != nil && len(ch.Body) > 512 {
				var a, b any
				if json.Unmarshal(ch.Prev, &a) == nil && json.Unmarshal(ch.Body, &b) == nil {
					if p := rt.Diff(a, b); p != nil && rt.PatchSize(p) <= len(ch.Body)/4 {
						rc.Patch, rc.Base, rc.Body = p, ch.Version-1, nil
					}
				}
			}
			out.Changes = append(out.Changes, rc)
		}
	}
	for _, v := range s.rt.views.Of(c.Store) {
		v.Send(out)
	}
	if refMoved {
		go s.reloadApp(c.Store)
	}
}

// reloadApp tells the views running an app whose ref moved to reopen on
// the new version (activating their stores first).
func (s *Server) reloadApp(app string) {
	ctx := context.Background()
	seen := map[string]int64{}
	for _, v := range s.rt.views.Where(func(v *rt.View) bool { return v.App == app }) {
		n, ok := seen[v.Target]
		if !ok {
			run, err := s.Env.K.Running(ctx, v.Target)
			if err != nil || run.App != app {
				continue
			}
			n, seen[v.Target] = run.N, run.N
		}
		if n != int64(v.Version) {
			v.Send(rt.Out{Type: "reload", Data: map[string]any{"version": n}})
		}
	}
}

// --- RPC ---------------------------------------------------------------

type rpcFunc func(ctx context.Context, v *rt.View, args json.RawMessage) (any, error)

func (s *Server) rpcTable() map[string]rpcFunc {
	return map[string]rpcFunc{
		"db.get": s.rpcDBGet, "db.query": s.rpcDBQuery, "db.write": s.rpcDBWrite, "db.acquire": s.rpcDBAcquire,
		"db.subscribe": s.rpcDBSubscribe, "db.unsubscribe": s.rpcDBUnsubscribe,
		"user.profiles": s.rpcUserProfiles, "user.search": s.rpcUserSearch,
		"room.join": s.rpcRoomJoin, "room.leave": s.rpcRoomLeave, "room.presence": s.rpcRoomPresence, "room.emit": s.rpcRoomEmit,
		"assets.list": s.rpcAssetsList, "assets.delete": s.rpcAssetsDelete, "artifact.publish": s.rpcArtifactPublish,
		"room.canSendToClaudeSession": func(context.Context, *rt.View, json.RawMessage) (any, error) { return false, nil },
		"slop.call":                   s.rpcSlopCall, "slop.read": s.rpcSlopRead,
		"permissions.state": func(_ context.Context, v *rt.View, _ json.RawMessage) (any, error) { return permissionStates(v), nil },
	}
}

func (s *Server) viewRPC(w http.ResponseWriter, r *http.Request) {
	v := s.viewOf(r)
	if v == nil {
		httpx.JSON(w, 401, map[string]any{"error": map[string]string{"code": "revoked", "message": "the view is closed or expired"}})
		return
	}
	var in struct {
		Method string          `json:"method"`
		Args   json.RawMessage `json:"args"`
	}
	if err := httpx.Read(r, &in, int64(rt.MaxDocBytes)+64<<10); err != nil {
		httpx.JSON(w, 400, map[string]any{"error": map[string]string{"code": "invalid_argument", "message": "send {method, args}"}})
		return
	}
	fn, ok := s.rpcTable()[in.Method]
	if !ok {
		httpx.JSON(w, 400, map[string]any{"error": map[string]string{"code": "capability_removed", "message": "unknown method " + in.Method}})
		return
	}
	name, _, _ := strings.Cut(in.Method, ".")
	if _, granted := grantedCaps(v)[name]; !granted && name != "permissions" {
		httpx.JSON(w, 403, map[string]any{"error": map[string]string{"code": "not_granted", "message": "this view was not granted " + name}})
		return
	}
	out, err := fn(r.Context(), v, in.Args)
	if err != nil {
		var f *rtFail
		if !errors.As(err, &f) {
			log.Printf("rpc %s: %v", in.Method, err)
			f = &rtFail{Code: "unavailable", Message: "the call failed"}
		}
		httpx.JSON(w, 200, map[string]any{"error": map[string]string{"code": f.Code, "message": f.Message}})
		return
	}
	httpx.JSON(w, 200, map[string]any{"result": out})
}

func args[T any](raw json.RawMessage) (T, error) {
	var a T
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &a); err != nil {
			return a, rtErr("invalid_argument", "bad arguments: %v", err)
		}
	}
	return a, nil
}

func (s *Server) viewStore(ctx context.Context, v *rt.View) (*store.Store, error) {
	return s.Env.K.Store(ctx, v.Target)
}

func viewWho(v *rt.View) store.Who {
	return store.Who{ID: v.User, Via: "page", Level: v.Level.String(), App: v.App + "@" + strconv.Itoa(v.Version)}
}

func docResult(d store.Doc) map[string]any {
	return map[string]any{"path": d.Path, "exists": true, "version": d.Version, "body": d.Body}
}

func (s *Server) rpcDBGet(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ Path string }](raw)
	if err != nil {
		return nil, err
	}
	return s.dbGet(ctx, v, a.Path)
}

func (s *Server) dbGet(ctx context.Context, v *rt.View, path string) (any, error) {
	if !rt.ValidDocPath(path) {
		return nil, rtErr("invalid_argument", "%q is not a document path", path)
	}
	missing := map[string]any{"path": path, "exists": false}
	if !v.Caps.Rules.CanRead(path, v.User, v.Level) {
		return missing, nil
	}
	st, err := s.viewStore(ctx, v)
	if err != nil {
		return nil, err
	}
	d, err := st.GetDoc(ctx, path)
	if errors.Is(err, store.ErrNotFound) {
		return missing, nil
	}
	if err != nil {
		return nil, err
	}
	return docResult(d), nil
}

// readable lists a collection's documents the viewer may read.
func (s *Server) readable(ctx context.Context, v *rt.View, coll string) ([]rt.Doc, error) {
	st, err := s.viewStore(ctx, v)
	if err != nil {
		return nil, err
	}
	docs, err := st.Query(ctx, rt.Query{Coll: coll})
	if err != nil {
		return nil, rtErr("invalid_argument", "invalid collection %q", coll)
	}
	out := make([]rt.Doc, 0, len(docs))
	for _, d := range docs {
		if v.Caps.Rules.CanRead(d.Path, v.User, v.Level) {
			out = append(out, rt.Doc{Path: d.Path, Body: d.Body, Version: d.Version})
		}
	}
	return out, nil
}

func (s *Server) rpcDBQuery(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	q, err := args[rt.Query](raw)
	if err != nil {
		return nil, err
	}
	if err := q.Validate(); err != nil {
		return nil, rtErr("invalid_argument", "invalid query on %q", q.Coll)
	}
	docs, err := s.readable(ctx, v, q.Coll)
	if err != nil {
		return nil, err
	}
	return map[string]any{"docs": q.Apply(docs)}, nil
}

type writeIn struct {
	Path      string          `json:"path"`
	Op        string          `json:"op"` // set | update | patch | delete
	Body      json.RawMessage `json:"body,omitempty"`
	Patch     *rt.Patch       `json:"patch,omitempty"`
	Base      int64           `json:"base,omitempty"`
	IfVersion *int64          `json:"ifVersion,omitempty"`
}

func (s *Server) rpcDBWrite(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	in, err := args[writeIn](raw)
	if err != nil {
		return nil, err
	}
	version, rev, err := s.dbWrite(ctx, v, in)
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": version, "rev": rev}, nil
}

// dbWrite validates and commits one write as one turn.
func (s *Server) dbWrite(ctx context.Context, v *rt.View, in writeIn) (int64, int64, error) {
	if !rt.ValidDocPath(in.Path) {
		return 0, 0, rtErr("invalid_argument", "%q is not a document path", in.Path)
	}
	if !v.Caps.Rules.CanWrite(in.Path, v.User, v.Level) {
		return 0, 0, rtErr("invalid_argument", "this viewer cannot write %q", in.Path)
	}
	var body map[string]any
	switch in.Op {
	case "set", "update":
		b, err := rt.ParseBody(in.Body)
		if err != nil {
			return 0, 0, rtErr("invalid_argument", "%v", err)
		}
		body = b
	case "patch":
		if in.Patch == nil {
			return 0, 0, rtErr("invalid_argument", "a patch write needs a patch")
		}
	case "delete":
	default:
		return 0, 0, rtErr("invalid_argument", "unknown write %q", in.Op)
	}
	st, err := s.viewStore(ctx, v)
	if err != nil {
		return 0, 0, err
	}
	var version int64
	c, err := st.Do(ctx, viewWho(v), func(t *store.Turn) error {
		cur, err := t.GetDoc(in.Path)
		exists := err == nil
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if in.IfVersion != nil {
			have := int64(0)
			if exists {
				have = cur.Version
			}
			if have != *in.IfVersion {
				return rtErr("conflict", "the document is at version %d, not %d", have, *in.IfVersion)
			}
		}
		switch in.Op {
		case "set":
			version, err = t.SetDoc(in.Path, body, 0)
		case "update":
			if !exists {
				return rtErr("invalid_argument", "update needs an existing document at %q", in.Path)
			}
			version, err = t.UpdateDoc(in.Path, body)
		case "patch":
			if !exists || cur.Version != in.Base {
				return rtErr("conflict_base", "the document moved past version %d", in.Base)
			}
			old := any(cur.Body)
			b, _ := json.Marshal(old)
			_ = json.Unmarshal(b, &old) // patches apply to plain JSON values
			next, perr := rt.Apply(old, *in.Patch)
			m, ok := next.(map[string]any)
			if perr != nil || !ok {
				return rtErr("conflict_base", "the patch does not apply")
			}
			version, err = t.SetDoc(in.Path, m, 0)
		case "delete":
			_, err = t.DeleteDoc(in.Path)
		}
		return err
	})
	if err != nil {
		var f *rtFail
		var de *store.DocError
		switch {
		case errors.As(err, &f):
			return 0, 0, f
		case errors.As(err, &de) && strings.HasPrefix(de.Msg, "quota_exceeded"):
			return 0, 0, rtErr("quota_exceeded", "this database holds at most %d documents", rt.MaxDocsPerTarget)
		case errors.As(err, &de):
			return 0, 0, rtErr("invalid_argument", "%s", de.Msg)
		}
		return 0, 0, err
	}
	var rev int64
	if c != nil {
		rev = c.Rev
	}
	return version, rev, nil
}

func (s *Server) rpcDBAcquire(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		Path   string          `json:"path"`
		Holder string          `json:"holder"`
		TTLMs  int64           `json:"ttlMs"`
		Data   json.RawMessage `json:"data"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if !rt.ValidDocPath(a.Path) || a.Holder == "" || len(a.Holder) > 200 {
		return nil, rtErr("invalid_argument", "acquire needs a document path and a holder")
	}
	if !v.Caps.Rules.CanWrite(a.Path, v.User, v.Level) {
		return nil, rtErr("invalid_argument", "this viewer cannot write %q", a.Path)
	}
	ttl := a.TTLMs
	if ttl == 0 {
		ttl = rt.DefaultLeaseMs
	}
	ttl = min(max(ttl, rt.MinLeaseMs), rt.MaxLeaseMs)
	now := time.Now()
	key := v.Target + "\x00" + a.Path
	s.rt.leaseMu.Lock()
	l, held := s.rt.leases[key]
	if held && l.holder != a.Holder && l.until.After(now) {
		s.rt.leaseMu.Unlock()
		return map[string]any{"acquired": false, "expiresAt": l.until.UTC().Format(time.RFC3339)}, nil
	}
	until := now.Add(time.Duration(ttl) * time.Millisecond)
	s.rt.leases[key] = lease{holder: a.Holder, until: until}
	for k, l := range s.rt.leases {
		if l.until.Before(now) {
			delete(s.rt.leases, k)
		}
	}
	s.rt.leaseMu.Unlock()
	var version int64
	if len(a.Data) > 0 && string(a.Data) != "null" {
		data, err := rt.ParseBody(a.Data)
		if err != nil {
			return nil, rtErr("invalid_argument", "%v", err)
		}
		st, err := s.viewStore(ctx, v)
		if err != nil {
			return nil, err
		}
		if _, err := st.Do(ctx, viewWho(v), func(t *store.Turn) error {
			version, err = t.UpdateDoc(a.Path, data)
			return err
		}); err != nil {
			return nil, err
		}
	} else if d, err := s.dbGet(ctx, v, a.Path); err == nil {
		if m, ok := d.(map[string]any); ok && m["exists"] == true {
			version = m["version"].(int64)
		}
	}
	return map[string]any{"acquired": true, "version": version, "expiresAt": until.UTC().Format(time.RFC3339), "holder": a.Holder}, nil
}

// rpcDBSubscribe registers a subscription and returns its current
// documents (without the limit: the runtime windows its mirror).
func (s *Server) rpcDBSubscribe(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		Sub   string    `json:"sub"`
		Path  string    `json:"path"`
		Coll  bool      `json:"coll"`
		Query *rt.Query `json:"query"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if a.Sub == "" || len(a.Sub) > 64 || (a.Coll && !rt.ValidCollPath(a.Path)) || (!a.Coll && !rt.ValidDocPath(a.Path)) {
		return nil, rtErr("invalid_argument", "invalid subscription")
	}
	q := rt.Query{Coll: a.Path}
	if a.Query != nil {
		q = *a.Query
		q.Coll, q.Limit = a.Path, 0
	}
	if a.Coll && q.Validate() != nil {
		return nil, rtErr("invalid_argument", "invalid query on %q", a.Path)
	}
	// Register first, then read: a write in between arrives on the stream
	// too, and the runtime keeps the higher version.
	if !v.Subscribe(rt.Sub{ID: a.Sub, Path: a.Path, Coll: a.Coll}) {
		return nil, rtErr("resource_exhausted", "at most %d subscriptions per view", rt.MaxSubscriptions)
	}
	st, err := s.viewStore(ctx, v)
	if err != nil {
		return nil, err
	}
	head := st.Head()
	if !a.Coll {
		d, err := s.dbGet(ctx, v, a.Path)
		if err != nil {
			return nil, err
		}
		return map[string]any{"rev": head, "doc": d}, nil
	}
	docs, err := s.readable(ctx, v, a.Path)
	if err != nil {
		return nil, err
	}
	return map[string]any{"rev": head, "docs": q.Apply(docs)}, nil
}

func (s *Server) rpcDBUnsubscribe(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ Sub string }](raw)
	if err != nil {
		return nil, err
	}
	v.Unsubscribe(a.Sub)
	return map[string]bool{"ok": true}, nil
}

// --- user --------------------------------------------------------------

type profile struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar,omitempty"`
	Color  string `json:"color"`
	Email  string `json:"email,omitempty"`
	Guest  bool   `json:"guest,omitempty"`
}

func hue(id string) string {
	h := 0
	for _, c := range id {
		h = (h*31 + int(c)) % 360
	}
	return fmt.Sprintf("hsl(%d 55%% 45%%)", h)
}

func profileOf(v *rt.View, p system.Person) profile {
	out := profile{ID: p.ID, Color: hue(p.ID)}
	if p.Kind == "guest" {
		out.Name, out.Guest = "Guest", true
		return out
	}
	if v.Caps.Scopes["profile"] {
		out.Name = p.Name
		if out.Name == "" {
			out.Name, _, _ = strings.Cut(p.Email, "@")
		}
	}
	if v.Caps.Scopes["email"] {
		out.Email = p.Email
	}
	return out
}

// userInfo is the viewer as the user capability reports them, plus who
// they are to the platform (audience, level).
func (s *Server) userInfo(ctx context.Context, v *rt.View) map[string]any {
	out := map[string]any{"isOwner": v.Level == rt.LevelOwner, "canEdit": v.Level >= rt.LevelAdmin,
		"audience": v.Role, "level": v.Level.String(),
		"can": map[string]bool{
			"data.write":   v.Caps.Rules.CanWrite("__probe__/__probe__", "", v.Level),
			"assets.write": v.Level >= rt.LevelInteract, "files.write": v.Level >= rt.LevelAdmin, "people.add": false,
		}}
	if s.Env.A != nil {
		out["visitor"] = s.Env.A.VisitorOf(ctx, s.viewPrincipal(ctx, v), v.Target)
	}
	if v.Caps.Declared["user"] {
		out["id"] = v.User
		out["guest"] = strings.HasPrefix(v.User, "vis_") || v.User == ""
		if p, err := s.Sys.Person(ctx, v.User); err == nil {
			out["profile"] = profileOf(v, p)
		}
	}
	return out
}

func (s *Server) rpcUserProfiles(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ IDs []string }](raw)
	if err != nil {
		return nil, err
	}
	if len(a.IDs) > 200 {
		return nil, rtErr("invalid_argument", "at most 200 ids")
	}
	out := map[string]profile{}
	for _, id := range a.IDs {
		if p, err := s.Sys.Person(ctx, id); err == nil {
			out[id] = profileOf(v, p)
		}
	}
	return out, nil
}

// rpcUserSearch finds people who hold a grant on (or own) the view's store.
func (s *Server) rpcUserSearch(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ Q string }](raw)
	if err != nil {
		return nil, err
	}
	if !v.Caps.Scopes["profile"] {
		return []profile{}, nil
	}
	ids := []string{}
	if row, err := s.Sys.StoreByID(ctx, v.Target); err == nil {
		ids = append(ids, row.Owner)
	}
	if gs, err := s.Sys.Grants(ctx, v.Target); err == nil {
		for _, g := range gs {
			if strings.HasPrefix(g.Subject, "usr_") && !slices.Contains(ids, g.Subject) {
				ids = append(ids, g.Subject)
			}
		}
	}
	q := strings.ToLower(strings.TrimSpace(a.Q))
	out := []profile{}
	for _, id := range ids {
		p, err := s.Sys.Person(ctx, id)
		if err != nil {
			continue
		}
		pr := profileOf(v, p)
		if q == "" || strings.Contains(strings.ToLower(pr.Name), q) || (v.Caps.Scopes["email"] && strings.Contains(strings.ToLower(p.Email), q)) {
			out = append(out, pr)
		}
		if len(out) == 20 {
			break
		}
	}
	return out, nil
}

// permissionStates: every granted capability is granted (consent-asking
// ones, sample, arrive with LLM access in P6).
func permissionStates(v *rt.View) map[string]string {
	out := map[string]string{}
	for name := range grantedCaps(v) {
		out[name] = "granted"
	}
	return out
}

// --- rooms -------------------------------------------------------------

var (
	topicName = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,47}$`)
	roomName  = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{0,47}$`)
)

func (s *Server) roomsOf(v *rt.View) []string {
	s.rt.roomMu.Lock()
	names := append([]string{""}, s.rt.joined[v.ID]...)
	s.rt.roomMu.Unlock()
	var out []string
	for _, name := range names {
		if v.In(name) {
			out = append(out, name)
		}
	}
	return out
}

func (s *Server) peersOf(target, room string) map[string]any {
	peers := []rt.Peer{}
	for _, o := range s.rt.views.Of(target) {
		if p, ok := o.AsPeer(room); ok {
			peers = append(peers, p)
		}
	}
	sort.Slice(peers, func(i, j int) bool { return peers[i].Peer < peers[j].Peer })
	return map[string]any{"room": room, "peers": peers}
}

func (s *Server) announce(target, room string) {
	ev := rt.Out{Type: "peers", Data: s.peersOf(target, room)}
	for _, o := range s.rt.views.Of(target) {
		if o.In(room) {
			o.Send(ev)
		}
	}
}

func (s *Server) roomClosed(v *rt.View, rooms []string) {
	s.told.forget(v.ID)
	s.rt.roomMu.Lock()
	delete(s.rt.joined, v.ID)
	s.rt.roomMu.Unlock()
	for _, room := range rooms {
		s.announce(v.Target, room)
	}
}

type roomArgs struct {
	Room  string          `json:"room"`
	Topic string          `json:"topic"`
	Data  json.RawMessage `json:"data"`
	Patch map[string]any  `json:"patch"`
}

func (s *Server) rpcRoomJoin(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	if a.Room != "" && !roomName.MatchString(a.Room) {
		return nil, rtErr("invalid_argument", "a room name matches %s", roomName)
	}
	if !v.Join(a.Room) {
		return nil, rtErr("limit_reached", "at most %d rooms", rt.MaxRooms)
	}
	if a.Room != "" {
		s.rt.roomMu.Lock()
		if !slices.Contains(s.rt.joined[v.ID], a.Room) {
			s.rt.joined[v.ID] = append(s.rt.joined[v.ID], a.Room)
		}
		s.rt.roomMu.Unlock()
	}
	s.announce(v.Target, a.Room)
	return s.peersOf(v.Target, a.Room), nil
}

func (s *Server) rpcRoomLeave(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	if v.Leave(a.Room) {
		s.rt.roomMu.Lock()
		s.rt.joined[v.ID] = slices.DeleteFunc(s.rt.joined[v.ID], func(n string) bool { return n == a.Room })
		s.rt.roomMu.Unlock()
		s.announce(v.Target, a.Room)
	}
	return map[string]bool{"ok": true}, nil
}

func (s *Server) rpcRoomPresence(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	if !v.In(a.Room) {
		v.Join(a.Room)
	}
	if err := v.SetPresence(a.Room, a.Patch); err != nil {
		return nil, rtErr("invalid_argument", "%v", err)
	}
	s.announce(v.Target, a.Room)
	return map[string]bool{"ok": true}, nil
}

func (s *Server) rpcRoomEmit(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	if !topicName.MatchString(a.Topic) {
		return nil, rtErr("invalid_argument", "a topic matches %s", topicName)
	}
	if len(a.Data) > rt.MaxRoomData {
		return nil, rtErr("invalid_argument", "data is at most %d bytes of JSON", rt.MaxRoomData)
	}
	need := rt.LevelAdmin
	if l, ok := v.Caps.Topics[a.Topic]; ok {
		need = l
	}
	if v.Level < need {
		return nil, rtErr("not_permitted", "topic %q needs %s", a.Topic, need)
	}
	if !v.In(a.Room) {
		return nil, rtErr("invalid_argument", "not in room %q", a.Room)
	}
	if !v.AllowEmit(time.Now()) {
		return map[string]bool{"dropped": true}, nil
	}
	var by *string
	if v.Caps.Declared["user"] && v.User != "" {
		u := v.User
		by = &u
	}
	data := a.Data
	if len(data) == 0 {
		data = json.RawMessage("null")
	}
	ev := rt.Out{Type: "room", Data: map[string]any{"room": a.Room, "topic": a.Topic, "data": data, "peer": v.ID, "by": by,
		"kind": v.Kind, "guest": strings.HasPrefix(v.User, "vis_")}}
	for _, o := range s.rt.views.Of(v.Target) {
		if o.In(a.Room) {
			o.Send(ev)
		}
	}
	return map[string]bool{"ok": true}, nil
}
