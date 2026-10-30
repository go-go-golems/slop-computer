package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
)

// The artifact runtime's server half (SLOP-009): views, the per-view
// stream, and the RPC table every capability calls through. pkg/rt holds
// the semantics; pkg/store/rt.go the SQL.

func (s *Server) rtRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /api/rt/views", s.guard(admin, noToken, s.openView))
	m.HandleFunc("POST /api/rt/views/{v}/renew", s.guard(admin, noToken, s.renewView))
	m.HandleFunc("POST /api/rt/views/{v}/consent", s.guard(admin, noToken, s.consentView))
	m.HandleFunc("DELETE /api/rt/views/{v}", s.guard(admin, noToken, s.closeView))
	// Agents: a token opens a view (a room peer) and calls documents.
	m.HandleFunc("POST /api/rt/targets/{t}/views", s.guard(admin, scopeRW, s.openAgentView))
	m.HandleFunc("POST /api/rt/targets/{t}/db", s.guard(admin, anyToken, s.agentDB))
	// A view's own calls, by its secret: agents reach them on the main
	// host; pages reach the same handlers as /_rt/… on their target origin.
	m.HandleFunc("GET /api/rt/events", s.viewEvents)
	m.HandleFunc("POST /api/rt/rpc", s.viewRPC)
	m.HandleFunc("GET /api/apps", s.guard(admin, scopeRW, s.listApps))
	m.HandleFunc("POST /api/apps/{id}/approve", s.guard(admin, noToken, s.approveApp))
	m.HandleFunc("GET /run/{rest...}", s.guard(public, noToken, s.workshopPage))
}

// rtFail is a capability error: a contract code and a message.
type rtFail struct{ Code, Message string }

func (e *rtFail) Error() string { return e.Code + ": " + e.Message }

func rtErr(code, format string, args ...any) error {
	return &rtFail{Code: code, Message: fmt.Sprintf(format, args...)}
}

// capsCache keeps parsed manifests of immutable versions.
type capsCache struct {
	mu sync.Mutex
	m  map[string]rt.Caps
}

// appCaps parses an app version's capabilities.
func (s *Server) appCaps(ctx context.Context, app string, n int) (rt.Caps, store.Version, error) {
	v, err := s.Store.Version(ctx, app, n)
	if err != nil {
		return rt.Caps{}, v, err
	}
	key := app + "@" + strconv.Itoa(v.N)
	s.caps.mu.Lock()
	c, ok := s.caps.m[key]
	s.caps.mu.Unlock()
	if ok {
		return c, v, nil
	}
	c, err = rt.ParseManifest(v.Manifest, rt.SlopPermissions)
	if err != nil {
		return c, v, err
	}
	s.caps.mu.Lock()
	if s.caps.m == nil || len(s.caps.m) > 512 {
		s.caps.m = map[string]rt.Caps{}
	}
	s.caps.m[key] = c
	s.caps.mu.Unlock()
	return c, v, nil
}

// rtTarget resolves a target: the artifact, its app (itself when it has
// none) and the app version that governs it (n, or the app's main).
func (s *Server) rtTarget(ctx context.Context, id string, n int) (store.Artifact, rt.Caps, store.Version, error) {
	t, err := s.Store.Artifact(ctx, id)
	if err != nil {
		return t, rt.Caps{}, store.Version{}, err
	}
	app := t.ID
	if t.App != "" {
		app = t.App
	}
	caps, v, err := s.appCaps(ctx, app, n)
	return t, caps, v, err
}

// approved is the slop permissions an admin approved for this app version:
// all it asks for, or none.
func (s *Server) approved(ctx context.Context, app string, n int, caps rt.Caps) []string {
	if len(caps.Permission) == 0 {
		return nil
	}
	a, err := s.Store.RTApprovalOf(ctx, app, n)
	if err != nil {
		return nil
	}
	for _, p := range caps.Permission {
		if !slices.Contains(a.Permissions, p) {
			return nil
		}
	}
	return caps.Permission
}

// grantedCaps is what a view may run, as the runtime sees it.
func grantedCaps(v *rt.View) map[string]any {
	out := map[string]any{}
	for name := range v.Caps.Declared {
		switch name {
		case "files", "mcp":
			continue // not served yet: use() resolves null
		case "artifact":
			if v.Target != v.App {
				continue // publish replaces the app itself
			}
		case "slop":
			if len(v.Perms) == 0 {
				continue
			}
		case "assets":
			if v.Level < rt.LevelInteract {
				continue
			}
		case "sample":
			if v.Role != store.RoleAdmin {
				continue // models spend the server's credentials: admins only
			}
		}
		if name == "artifact" && v.Role != store.RoleAdmin {
			continue // publishing replaces the app for everyone
		}
		out[name] = map[string]any{}
	}
	if v.Caps.Declared["user"] {
		scopes := []string{}
		for sc := range v.Caps.Scopes {
			scopes = append(scopes, sc)
		}
		sort.Strings(scopes)
		out["user"] = map[string]any{"scopes": scopes}
	}
	if _, ok := out["comments"]; ok {
		out["comments"] = map[string]any{"composer_only": v.Caps.Composer}
	}
	if _, ok := out["sample"]; ok {
		out["sample"] = map[string]any{"images": v.Caps.Images}
	}
	if _, ok := out["slop"]; ok {
		out["slop"] = map[string]any{"permissions": v.Perms}
	}
	return out
}

// targetURL is the address of an app version on its target's origin.
func (s *Server) targetURL(ctx context.Context, r *http.Request, target string, n int, mode string, extra url.Values) (string, string, error) {
	if s.Config.SandboxDomain == "" {
		return "", "", rtErr("unavailable", "This server has no sandbox domain (--sandbox-domain)")
	}
	label, err := s.Store.RTOrigin(ctx, target)
	if err != nil {
		return "", "", err
	}
	q := url.Values{"mode": {mode}, "parent": {s.parentOrigin(r)}}
	for k, vs := range extra {
		q[k] = vs
	}
	u := url.URL{Scheme: s.Config.PublicURL.Scheme, Host: label + "." + s.Config.SandboxDomain, Path: "/v/" + strconv.Itoa(n) + "/", RawQuery: q.Encode()}
	return u.String(), u.Scheme + "://" + u.Host, nil
}

type viewOut struct {
	*rt.View
	Secret string         `json:"secret"`
	URL    string         `json:"url,omitempty"`
	Origin string         `json:"origin,omitempty"`
	Level  string         `json:"level"`
	Caps   map[string]any `json:"caps"`
	Asks   []string       `json:"asks,omitempty"` // slop permissions the version asks for, unapproved
}

func (s *Server) newView(ctx context.Context, u store.User, target string, n int, kind string) (*rt.View, []string, error) {
	t, caps, v, err := s.rtTarget(ctx, target, n)
	if err != nil {
		return nil, nil, err
	}
	level := s.levelOf(ctx, u, t)
	if level == rt.LevelNone {
		return nil, nil, rtErr("not_granted", "You cannot open this")
	}
	var perms, asks []string
	if u.Role == store.RoleAdmin { // the slop API is the admin's own
		if perms = s.approved(ctx, v.Artifact, v.N, caps); perms == nil {
			asks = caps.Permission
		}
	}
	view := s.views.Open(&rt.View{Target: t.ID, App: v.Artifact, Version: v.N, User: u.ID, Name: u.DisplayName, Role: u.Role,
		Level: level, Caps: caps, Perms: perms, Kind: kind})
	return view, asks, nil
}

func (s *Server) openView(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Target  string `json:"target"`
		Version int    `json:"version"`
	}
	if err := httpx.Read(w, r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {target, version?}")
		return
	}
	v, asks, err := s.newView(r.Context(), me(r), in.Target, in.Version, "viewer")
	if err != nil {
		s.rtHTTPFail(w, err)
		return
	}
	u, origin, err := s.targetURL(r.Context(), r, v.Target, v.Version, "app", nil)
	if err != nil {
		s.views.Close(v, false)
		s.rtHTTPFail(w, err)
		return
	}
	httpx.OK(w, viewOut{View: v, Secret: v.Secret, URL: u, Origin: origin, Level: v.Level.String(), Caps: grantedCaps(v), Asks: asks})
}

// ownView finds a view the signed-in person opened.
func (s *Server) ownView(w http.ResponseWriter, r *http.Request) *rt.View {
	v := s.views.Get(r.PathValue("v"))
	if v == nil || v.User != actor(r) {
		httpx.Fail(w, 404, "not_found", "No such view")
		return nil
	}
	return v
}

func (s *Server) renewView(w http.ResponseWriter, r *http.Request) {
	if v := s.ownView(w, r); v != nil {
		s.views.Renew(v)
		httpx.OK(w, map[string]any{"view": v.ID, "secret": v.Secret, "expiresAt": v.Expires})
	}
}

func (s *Server) closeView(w http.ResponseWriter, r *http.Request) {
	if v := s.ownView(w, r); v != nil {
		s.views.Close(v, false)
		httpx.OK(w, map[string]bool{"closed": true})
	}
}

// consentView records the person's answer from the shell's dialog: only the
// shell, with the session, can grant a capability that asks.
func (s *Server) consentView(w http.ResponseWriter, r *http.Request) {
	v := s.ownView(w, r)
	if v == nil {
		return
	}
	var in map[string]string
	if err := httpx.Read(w, r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {capability: granted|denied}")
		return
	}
	for name, st := range in {
		if !consentCaps[name] || (st != "granted" && st != "denied") {
			httpx.Fail(w, 400, "invalid_request", "Unknown capability or state")
			return
		}
		if err := s.Store.RTSetConsent(r.Context(), v.User, v.App, name, st); err != nil {
			unavailable(w, err)
			return
		}
	}
	httpx.OK(w, s.permissionStates(r.Context(), v))
}

func (s *Server) openAgentView(w http.ResponseWriter, r *http.Request) {
	v, _, err := s.newView(r.Context(), me(r), r.PathValue("t"), 0, "agent")
	if err != nil {
		s.rtHTTPFail(w, err)
		return
	}
	httpx.OK(w, viewOut{View: v, Secret: v.Secret, Level: v.Level.String(), Caps: grantedCaps(v)})
}

func (s *Server) rtHTTPFail(w http.ResponseWriter, err error) {
	var f *rtFail
	switch {
	case errors.As(err, &f):
		status := 400
		switch f.Code {
		case "not_granted", "not_writer", "not_permitted":
			status = 403
		case "unavailable":
			status = 503
		case "conflict":
			status = 409
		}
		httpx.Fail(w, status, f.Code, f.Message)
	default:
		s.fail(w, err)
	}
}

// viewOf resolves the calling view from its secret; on a target origin the
// view must belong to that target.
func (s *Server) viewOf(r *http.Request) *rt.View {
	bearer := r.Header.Get("Authorization")
	if !strings.HasPrefix(bearer, "Bearer "+rt.SecretPrefix) {
		return nil
	}
	v := s.views.Lookup(strings.TrimPrefix(bearer, "Bearer "))
	if v == nil {
		return nil
	}
	if t, ok := r.Context().Value(originTarget{}).(string); ok && t != v.Target {
		return nil
	}
	return v
}

type originTarget struct{}

// --- the stream --------------------------------------------------------

func writeSSE(w http.ResponseWriter, typ string, id int64, data any) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	if id > 0 {
		if _, err = fmt.Fprintf(w, "id: %d\n", id); err != nil {
			return err
		}
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", typ, raw)
	return err
}

// docOut is a document as the runtime receives it.
type docOut struct {
	Rev     int64           `json:"rev,omitempty"`
	Path    string          `json:"path"`
	Version int64           `json:"version"`
	Body    json.RawMessage `json:"body,omitempty"`
	Patch   *rt.Patch       `json:"patch,omitempty"`
	Base    int64           `json:"base,omitempty"`
	Deleted bool            `json:"deleted,omitempty"`
}

func fromRow(d store.RTDoc) docOut {
	return docOut{Rev: d.Rev, Path: d.Path, Version: d.Version, Body: d.Body, Deleted: d.Body == nil}
}

func (s *Server) hello(ctx context.Context, v *rt.View, head int64) map[string]any {
	caps := grantedCaps(v)
	if sl, ok := caps["slop"].(map[string]any); ok {
		// What the management API's callers need to address the site.
		sl["config"] = map[string]any{"siteHosts": s.Config.SiteHosts, "publicUrl": origin(s.Config.PublicURL)}
	}
	return map[string]any{"view": v.ID, "target": v.Target, "app": v.App, "version": v.Version, "kind": v.Kind,
		"level": v.Level.String(), "caps": caps, "rev": head, "me": s.userInfo(ctx, v),
		"permissions": s.permissionStates(ctx, v)}
}

// viewEvents is a view's stream: hello, a catch-up from ?after=, then live
// document changes (in rev order, gaps filled from the table, filtered by
// the view's subscriptions and read rules), room events, reloads.
func (s *Server) viewEvents(w http.ResponseWriter, r *http.Request) {
	v := s.viewOf(r)
	if v == nil {
		httpx.Fail(w, 401, "revoked", "The view is closed or expired")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Fail(w, 500, "unsupported", "Streaming unsupported")
		return
	}
	ctx := r.Context()
	ch := v.Attach()
	defer v.Detach(ch)
	// after is the rev a reconnecting view saw last; 0 is a valid resume
	// point (the target was empty), so its presence, not its value, counts.
	resume := r.URL.Query().Has("after")
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	head, err := s.Store.RTHead(ctx, v.Target)
	if err != nil {
		unavailable(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	last := head
	send := func(d docOut) error {
		if !v.Wants(d.Path) {
			return nil
		}
		if !v.Caps.Rules.CanRead(d.Path, v.User, v.Level) {
			return nil
		}
		return writeSSE(w, "doc", d.Rev, d)
	}
	catchUp := func(from int64) error {
		rows, h, err := s.Store.RTChanges(ctx, v.Target, from)
		if err != nil {
			return err
		}
		for _, d := range rows {
			if err := send(fromRow(d)); err != nil {
				return err
			}
		}
		last = max(last, h)
		return nil
	}
	if writeSSE(w, "hello", 0, s.hello(ctx, v, head)) != nil {
		return
	}
	if resume && after >= 0 && after < head && catchUp(after) != nil {
		return
	}
	for _, room := range s.roomsOf(v) {
		_ = writeSSE(w, "peers", 0, s.peersOf(v.Target, room))
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
			switch c := o.Change; {
			case c == nil:
				err = writeSSE(w, o.Type, 0, o.Data)
				if o.Type == "revoked" {
					flusher.Flush()
					return
				}
			case c.Rev <= last:
			case c.Rev > last+1:
				err = catchUp(last)
			default:
				last = c.Rev
				err = send(docOut{Rev: c.Rev, Path: c.Path, Version: c.Version, Body: c.Body, Patch: c.Patch, Base: c.Base, Deleted: c.Deleted})
			}
			if err != nil {
				return
			}
		}
		flusher.Flush()
	}
}

// rtPublish sends a committed write to the target's views, with a patch
// instead of the body when the patch is small (diff sync).
func (s *Server) rtPublish(ch store.RTChange) {
	if ch.Rev == 0 {
		return
	}
	c := &rt.Change{Rev: ch.Rev, Path: ch.Path, Version: ch.Version, Body: ch.Body, Deleted: ch.Body == nil}
	if ch.Body != nil && ch.Prev != nil && len(ch.Body) > 512 {
		var a, b any
		if json.Unmarshal(ch.Prev, &a) == nil && json.Unmarshal(ch.Body, &b) == nil {
			if p := rt.Diff(a, b); p != nil && rt.PatchSize(p) <= len(ch.Body)/4 {
				c.Patch, c.Base, c.Body = p, ch.Version-1, nil
			}
		}
	}
	for _, v := range s.views.Of(ch.Target) {
		v.Send(rt.Out{Change: c})
	}
}

// --- RPC ---------------------------------------------------------------

type rpcIn struct {
	Method string          `json:"method"`
	Args   json.RawMessage `json:"args"`
}

type rpcFunc func(ctx context.Context, v *rt.View, args json.RawMessage) (any, error)

func (s *Server) rpcTable() map[string]rpcFunc {
	return map[string]rpcFunc{
		"db.get": s.rpcDBGet, "db.query": s.rpcDBQuery, "db.write": s.rpcDBWrite, "db.acquire": s.rpcDBAcquire,
		"db.subscribe": s.rpcDBSubscribe, "db.unsubscribe": s.rpcDBUnsubscribe,
		"user.profiles": s.rpcUserProfiles, "user.search": s.rpcUserSearch,
		"room.join": s.rpcRoomJoin, "room.leave": s.rpcRoomLeave, "room.presence": s.rpcRoomPresence, "room.emit": s.rpcRoomEmit,
		"room.sendToClaudeSession": s.rpcSendToClaudeSession, "room.canSendToClaudeSession": s.rpcCanSendToClaudeSession,
		"comments.create": s.rpcCommentsCreate, "comments.reply": s.rpcCommentsReply, "comments.resolve": s.rpcCommentsResolve,
		"comments.sendToClaude": s.rpcCommentsSendToClaude,
		"assets.list":           s.rpcAssetsList, "assets.delete": s.rpcAssetsDelete,
		"artifact.publish":  s.rpcArtifactPublish,
		"permissions.state": s.rpcPermissionsState,
		"sample.limits":     s.rpcSampleLimits,
	}
}

func (s *Server) viewRPC(w http.ResponseWriter, r *http.Request) {
	v := s.viewOf(r)
	if v == nil {
		httpx.JSON(w, 401, map[string]any{"error": map[string]string{"code": "revoked", "message": "The view is closed or expired"}})
		return
	}
	var in rpcIn
	if err := httpx.Read(w, r, &in, int64(rt.MaxDocBytes)+64<<10); err != nil {
		httpx.JSON(w, 400, map[string]any{"error": map[string]string{"code": "invalid_argument", "message": "Send {method, args}"}})
		return
	}
	fn, ok := s.rpcTable()[in.Method]
	if !ok {
		httpx.JSON(w, 400, map[string]any{"error": map[string]string{"code": "capability_removed", "message": "Unknown method " + in.Method}})
		return
	}
	name := strings.SplitN(in.Method, ".", 2)[0]
	if name != "permissions" {
		if _, granted := grantedCaps(v)[name]; !granted {
			httpx.JSON(w, 403, map[string]any{"error": map[string]string{"code": "not_granted", "message": "This view was not granted " + name}})
			return
		}
	}
	ctx := store.WithAuditVia(r.Context(), "app "+v.App+"@"+strconv.Itoa(v.Version))
	out, err := fn(ctx, v, in.Args)
	if err != nil {
		var f *rtFail
		if !errors.As(err, &f) {
			unavailableLog(err)
			f = &rtFail{Code: "unavailable", Message: "The call failed"}
		}
		httpx.JSON(w, 200, map[string]any{"error": map[string]string{"code": f.Code, "message": f.Message}})
		return
	}
	httpx.OK(w, map[string]any{"result": out})
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

// --- db ----------------------------------------------------------------

// writer is who writes: a view's or an agent's user and level, and the
// rules of the target's app.
type writer struct {
	user  string
	level rt.Level
	rules rt.Rules
}

func (s *Server) rpcDBGet(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ Path string }](raw)
	if err != nil {
		return nil, err
	}
	return s.dbGet(ctx, v.Target, writer{v.User, v.Level, v.Caps.Rules}, a.Path)
}

func (s *Server) dbGet(ctx context.Context, target string, wr writer, path string) (any, error) {
	if !rt.ValidDocPath(path) {
		return nil, rtErr("invalid_argument", "%q is not a document path", path)
	}
	missing := map[string]any{"path": path, "exists": false}
	if !wr.rules.CanRead(path, wr.user, wr.level) {
		return missing, nil
	}
	d, err := s.Store.RTDoc(ctx, target, path)
	if errors.Is(err, store.ErrNotFound) {
		return missing, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"path": path, "exists": true, "version": d.Version, "body": json.RawMessage(d.Body)}, nil
}

// readable lists a collection's documents the reader may read, decoded.
func (s *Server) readable(ctx context.Context, target, coll string, wr writer) ([]rt.Doc, error) {
	rows, err := s.Store.RTColl(ctx, target, coll)
	if err != nil {
		return nil, err
	}
	out := make([]rt.Doc, 0, len(rows))
	for _, d := range rows {
		if !wr.rules.CanRead(d.Path, wr.user, wr.level) {
			continue
		}
		var body map[string]any
		if json.Unmarshal(d.Body, &body) != nil {
			continue
		}
		out = append(out, rt.Doc{Path: d.Path, Body: body, Version: d.Version})
	}
	return out, nil
}

func (s *Server) rpcDBQuery(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	q, err := args[rt.Query](raw)
	if err != nil {
		return nil, err
	}
	return s.dbQuery(ctx, v.Target, writer{v.User, v.Level, v.Caps.Rules}, q)
}

func (s *Server) dbQuery(ctx context.Context, target string, wr writer, q rt.Query) (any, error) {
	if err := q.Validate(); err != nil {
		return nil, rtErr("invalid_argument", "invalid query on %q", q.Coll)
	}
	docs, err := s.readable(ctx, target, q.Coll, wr)
	if err != nil {
		return nil, err
	}
	return map[string]any{"docs": q.Apply(docs)}, nil
}

// writeIn is one document write.
type writeIn struct {
	Path      string          `json:"path"`
	Op        string          `json:"op"` // set | update | patch | delete
	Body      json.RawMessage `json:"body,omitempty"`
	Patch     *rt.Patch       `json:"patch,omitempty"`
	Base      int64           `json:"base,omitempty"`
	IfVersion *int64          `json:"ifVersion,omitempty"` // agents: compare-and-set
}

func (s *Server) rpcDBWrite(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	in, err := args[writeIn](raw)
	if err != nil {
		return nil, err
	}
	ch, err := s.dbWrite(ctx, v.Target, writer{v.User, v.Level, v.Caps.Rules}, in)
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": ch.Version, "rev": ch.Rev}, nil
}

// dbWrite validates and commits one write, then tells the target's views.
func (s *Server) dbWrite(ctx context.Context, target string, wr writer, in writeIn) (store.RTChange, error) {
	if !rt.ValidDocPath(in.Path) {
		return store.RTChange{}, rtErr("invalid_argument", "%q is not a document path", in.Path)
	}
	if !wr.rules.CanWrite(in.Path, wr.user, wr.level) {
		return store.RTChange{}, rtErr("invalid_argument", "this viewer cannot write %q", in.Path)
	}
	var body map[string]any
	switch in.Op {
	case "set", "update":
		b, err := rt.ParseBody(in.Body)
		if err != nil {
			return store.RTChange{}, rtErr("invalid_argument", "%v", err)
		}
		body = b
	case "patch":
		if in.Patch == nil {
			return store.RTChange{}, rtErr("invalid_argument", "a patch write needs a patch")
		}
	case "delete":
	default:
		return store.RTChange{}, rtErr("invalid_argument", "unknown write %q", in.Op)
	}
	ch, err := s.Store.RTWrite(ctx, target, in.Path, rt.CollOf(in.Path), wr.user, func(cur *store.RTDoc) ([]byte, error) {
		if in.IfVersion != nil {
			have := int64(0)
			if cur != nil {
				have = cur.Version
			}
			if have != *in.IfVersion {
				return nil, rtErr("conflict", "the document is at version %d, not %d", have, *in.IfVersion)
			}
		}
		switch in.Op {
		case "set":
			return rt.EncodeBody(body)
		case "update":
			if cur == nil {
				return nil, rtErr("invalid_argument", "update needs an existing document at %q", in.Path)
			}
			var old map[string]any
			if err := json.Unmarshal(cur.Body, &old); err != nil {
				return nil, err
			}
			return rt.EncodeBody(rt.Merge(old, body))
		case "patch":
			if cur == nil || cur.Version != in.Base {
				return nil, rtErr("conflict_base", "the document moved past version %d", in.Base)
			}
			var old any
			if err := json.Unmarshal(cur.Body, &old); err != nil {
				return nil, err
			}
			next, err := rt.Apply(old, *in.Patch)
			if err != nil {
				return nil, rtErr("conflict_base", "the patch does not apply")
			}
			m, ok := next.(map[string]any)
			if !ok {
				return nil, rtErr("invalid_argument", "%v", rt.ErrBody)
			}
			return rt.EncodeBody(m)
		}
		return nil, nil // delete
	})
	switch {
	case errors.Is(err, rt.ErrBody):
		return ch, rtErr("invalid_argument", "%v", err)
	case errors.Is(err, store.ErrRTQuota):
		return ch, rtErr("quota_exceeded", "this database holds at most %d documents", rt.MaxDocsPerTarget)
	case err != nil:
		return ch, err
	}
	s.rtPublish(ch)
	return ch, nil
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
	wr := writer{v.User, v.Level, v.Caps.Rules}
	if !rt.ValidDocPath(a.Path) || a.Holder == "" || len(a.Holder) > 200 {
		return nil, rtErr("invalid_argument", "acquire needs a document path and a holder")
	}
	if !wr.rules.CanWrite(a.Path, wr.user, wr.level) {
		return nil, rtErr("invalid_argument", "this viewer cannot write %q", a.Path)
	}
	ttl := a.TTLMs
	if ttl == 0 {
		ttl = rt.DefaultLeaseMs
	}
	ttl = min(max(ttl, rt.MinLeaseMs), rt.MaxLeaseMs)
	ok, until, err := s.Store.RTAcquire(ctx, v.Target, a.Path, a.Holder, time.Duration(ttl)*time.Millisecond)
	if err != nil {
		return nil, err
	}
	if !ok {
		return map[string]any{"acquired": false, "expiresAt": until.UTC().Format(time.RFC3339)}, nil
	}
	var version int64
	if len(a.Data) > 0 && string(a.Data) != "null" {
		data, err := rt.ParseBody(a.Data)
		if err != nil {
			return nil, rtErr("invalid_argument", "%v", err)
		}
		ch, err := s.Store.RTWrite(ctx, v.Target, a.Path, rt.CollOf(a.Path), v.User, func(cur *store.RTDoc) ([]byte, error) {
			old := map[string]any{}
			if cur != nil {
				_ = json.Unmarshal(cur.Body, &old)
			}
			return rt.EncodeBody(rt.Merge(old, data))
		})
		if err != nil {
			return nil, err
		}
		s.rtPublish(ch)
		version = ch.Version
	} else if d, err := s.Store.RTDoc(ctx, v.Target, a.Path); err == nil {
		version = d.Version
	}
	return map[string]any{"acquired": true, "version": version, "expiresAt": until.UTC().Format(time.RFC3339), "holder": a.Holder}, nil
}

// rpcDBSubscribe registers a subscription and returns its current documents:
// a document, or a collection's documents matching the filters, without the
// limit (the runtime windows its mirror).
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
	head, err := s.Store.RTHead(ctx, v.Target)
	if err != nil {
		return nil, err
	}
	wr := writer{v.User, v.Level, v.Caps.Rules}
	if !a.Coll {
		d, err := s.dbGet(ctx, v.Target, wr, a.Path)
		if err != nil {
			return nil, err
		}
		return map[string]any{"rev": head, "doc": d}, nil
	}
	docs, err := s.readable(ctx, v.Target, a.Path, wr)
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

// profile is a person as pages see them.
type profile struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar,omitempty"`
	Color  string `json:"color"`
	Email  string `json:"email,omitempty"`
}

func hue(id string) string {
	h := 0
	for _, c := range id {
		h = (h*31 + int(c)) % 360
	}
	return fmt.Sprintf("hsl(%d 55%% 45%%)", h)
}

func profileOf(v *rt.View, u store.User) profile {
	p := profile{ID: u.ID, Color: hue(u.ID)}
	if v.Caps.Scopes["profile"] {
		p.Name, p.Avatar = u.DisplayName, "/_slop/avatar/"+u.ID+".svg"
	}
	if v.Caps.Scopes["email"] {
		p.Email = u.Email
	}
	return p
}

// userInfo is the viewer as the user capability reports them.
func (s *Server) userInfo(ctx context.Context, v *rt.View) map[string]any {
	out := map[string]any{"isOwner": v.Level == rt.LevelOwner, "canEdit": v.Level >= rt.LevelAdmin,
		"can": map[string]bool{
			"data.write":   v.Caps.Rules.CanWrite("__probe__/__probe__", "", v.Level),
			"assets.write": v.Level >= rt.LevelInteract, "files.write": v.Level >= rt.LevelAdmin, "people.add": false,
		}}
	if v.Caps.Declared["user"] {
		if u, err := s.Store.User(ctx, v.User); err == nil {
			out["profile"] = profileOf(v, u)
		}
		out["id"] = v.User
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
	us, err := s.Store.Users(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]profile{}
	for _, u := range us {
		if slices.Contains(a.IDs, u.ID) {
			out[u.ID] = profileOf(v, u)
		}
	}
	return out, nil
}

func (s *Server) rpcUserSearch(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ Q string }](raw)
	if err != nil {
		return nil, err
	}
	if !v.Caps.Scopes["profile"] {
		return []profile{}, nil
	}
	us, err := s.Store.Users(ctx)
	if err != nil {
		return nil, err
	}
	q := strings.ToLower(strings.TrimSpace(a.Q))
	out := []profile{}
	for _, u := range us {
		if u.Role != store.RoleAdmin {
			continue
		}
		if q == "" || strings.Contains(strings.ToLower(u.DisplayName), q) || (v.Caps.Scopes["email"] && strings.Contains(strings.ToLower(u.Email), q)) {
			out = append(out, profileOf(v, u))
		}
		if len(out) == 20 {
			break
		}
	}
	return out, nil
}

// --- permissions -------------------------------------------------------

// consentCaps are the capabilities that ask the viewer before first use.
var consentCaps = map[string]bool{"sample": true, "comments": true}

func (s *Server) permissionStates(ctx context.Context, v *rt.View) map[string]string {
	out := map[string]string{}
	for name := range grantedCaps(v) {
		if !consentCaps[name] || (name == "comments" && v.Caps.Composer) {
			out[name] = "granted"
			continue
		}
		st, err := s.Store.RTConsent(ctx, v.User, v.App, name)
		if err != nil || st == "" {
			st = "prompt"
		}
		out[name] = st
	}
	return out
}

func (s *Server) rpcPermissionsState(ctx context.Context, v *rt.View, _ json.RawMessage) (any, error) {
	return s.permissionStates(ctx, v), nil
}

// needConsent fails a call to a capability the viewer has not granted.
func (s *Server) needConsent(ctx context.Context, v *rt.View, name string) error {
	if s.permissionStates(ctx, v)[name] != "granted" {
		return rtErr("not_granted", "the viewer has not allowed %s", name)
	}
	return nil
}
