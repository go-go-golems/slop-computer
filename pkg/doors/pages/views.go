package pages

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
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	capsdb "github.com/go-go-golems/slop-computer/pkg/caps/db"
	caproom "github.com/go-go-golems/slop-computer/pkg/caps/room"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/policy"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// The page protocol (ported from slop-computer's rt.go, same wire format so
// the built runtime, claude.js, runs unchanged): a view is one open page of
// an app for one person; its page reads /_rt/events (a fetch-streamed SSE)
// and calls /_rt/rpc on its sandbox origin, with the view's secret.

type rtState struct {
	views *rt.Registry
	key   []byte

	leaseMu sync.Mutex
	leases  map[string]lease // store \x00 path

	once onceCache // keyed calls: a resend gets the first result
}

type lease struct {
	holder string
	until  time.Time
}

func newRT(key []byte) *rtState {
	return &rtState{views: rt.NewRegistry(), key: key, leases: map[string]lease{}}
}

// rtFail is a protocol error with a code the runtime understands.
type rtFail struct{ Code, Message, Confirm string }

func (e *rtFail) Error() string { return e.Code + ": " + e.Message }

func rtErr(code, format string, args ...any) error {
	return &rtFail{Code: code, Message: fmt.Sprintf(format, args...)}
}

// label is a store+app's sandbox origin label: stable while the server key
// is, so a store's localStorage survives new versions.
func (s *Door) label(storeID, app string) string {
	m := hmac.New(sha256.New, s.rt.key)
	m.Write([]byte(storeID + "\x00" + app))
	return "s" + hex.EncodeToString(m.Sum(nil))[:20]
}

// sandboxURL is the address of an app version on its store's origin.
func (s *Door) sandboxURL(ctx context.Context, v *rt.View, parent string) (string, string, error) {
	if s.Cfg.Hosts.Sandbox == "" {
		return "", "", rtErr("unavailable", "this server has no sandbox host")
	}
	l := s.label(v.Target, v.App)
	if err := s.People.SetOrigin(ctx, l, v.Target, v.App); err != nil {
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
		case "files":
			// A project is a store's main snapshot (SLOP3-008): the stores
			// _stores reaches, or one alias's target.
			if v.Caps.Files != "" && (v.Caps.Files != rt.StoresRoot || v.Space.Stores != rt.LevelNone) {
				out[name] = map[string]any{"project": v.Caps.Files}
			}
		case "assets":
			// The policy decides by audience (members and up by default);
			// a visitor without an id answers to nobody and stores nothing.
			if v.Level >= rt.LevelInteract && v.User != "" && v.Policy["assets"] {
				out[name] = map[string]any{}
			}
		case "artifact":
			if v.Target == v.App && v.Role == string(access.AudAdmin) {
				out[name] = map[string]any{} // publishing replaces the app for everyone
			}
		case "sample":
			if v.User != "" && v.Policy["sample"] {
				out[name] = map[string]any{"images": v.Caps.Images}
			}
		case "user":
			scopes := []string{}
			for sc := range v.Caps.Scopes {
				if sc == "email" && !v.Policy["user.email"] {
					continue
				}
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
func (s *Door) openView(ctx context.Context, p *access.Principal, storeID, parent string) (*viewOut, error) {
	epoch := s.Sys.Epoch() // read first: a write during the decision makes the next call decide again
	d, _, err := s.K.Access.Can(ctx, p, storeID, rt.LevelView, "opening", true)
	if err != nil {
		return nil, err
	}
	if !d.OK {
		return nil, rtErr("not_granted", "you cannot open this")
	}
	run, err := s.K.Running(ctx, storeID)
	if err != nil {
		return nil, err
	}
	if run.N == 0 {
		return nil, rtErr("unavailable", "nothing has been pushed to %s yet", run.App)
	}
	if !run.Usable() {
		return nil, rtErr("unavailable", "the app is broken: %s", run.Broken())
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
	pol := map[string]bool{}
	for _, c := range policy.PolicyCaps {
		pol[c] = s.Gov.Policy(ctx, run.App, c, string(d.Audience))
	}
	v := &rt.View{Target: storeID, App: run.App, Version: int(run.N), User: p.ID(), Name: name,
		Role: string(d.Audience), Level: d.Level, Caps: caps, Policy: pol, Kind: "viewer",
		Space: s.db.Space(ctx, storeID, caps, pol["stores"])}
	v.Epoch.Store(epoch)
	v = s.rt.views.Open(v)
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
func (s *Door) viewOf(r *http.Request) *rt.View {
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
	if !s.confirm(r.Context(), v) {
		return nil
	}
	return v
}

// --- the stream --------------------------------------------------------

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
	// A change in another store the view follows: that store's key (rt.View
	// RemoteKey) and, on a commit's last document, its rev there. The
	// runtime keeps the newest and sends it back on reconnect (?remote=).
	Remote    string `json:"remote,omitempty"`
	RemoteRev int64  `json:"remoteRev,omitempty"`
}

func (s *Door) hello(ctx context.Context, v *rt.View, head int64) map[string]any {
	return map[string]any{"view": v.ID, "target": v.Target, "app": v.App, "version": v.Version, "kind": v.Kind,
		"level": v.Level.String(), "caps": grantedCaps(v), "rev": head, "me": s.userInfo(ctx, v),
		"permissions": permissionStates(v)}
}

// viewEvents is a view's stream: hello, a catch-up from ?after=, then live
// commits (filtered by the view's subscriptions and read rules), room
// events and reloads.
func (s *Door) viewEvents(w http.ResponseWriter, r *http.Request) {
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
	st, err := s.K.Store(ctx, v.Target)
	if err != nil {
		httpx.Fail(w, 503, "unavailable", "the store is unavailable")
		return
	}
	ch := v.Attach()
	// The view is a peer while its stream is attached: its rooms hear it
	// arrive and leave.
	s.rooms.AnnounceAll(v)
	defer func() {
		v.Detach(ch)
		s.rooms.AnnounceAll(v)
	}()
	resume := r.URL.Query().Has("after")
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	head := st.Head()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	last := head
	// own reads the view's own store's commits; every document is sent at
	// each page path that shows it (its own path, an alias, _stores/<it>).
	own := s.db.ReaderFor(ctx, v, v.Target)
	stored := func(d store.Doc) docOut {
		o := docOut{Version: d.Version, Deleted: d.Body == nil}
		if d.Body != nil {
			o.Body, _ = json.Marshal(d.Body)
		}
		return o
	}
	// sendAll writes docs, putting each commit's rev on its last document.
	sendAll := func(docs []docOut, revs []int64) error {
		for i, d := range docs {
			if i == len(docs)-1 || revs[i+1] != revs[i] {
				d.Rev = revs[i]
			}
			if err := web.WriteSSE(w, "doc", d); err != nil {
				return err
			}
		}
		return nil
	}
	// catchUp sends what changed after from. The head is read first: every
	// commit up to it is committed, so the documents read next include it,
	// and one that lands later is in those rows or arrives on ch. Reading the
	// head after the documents could move last past a commit never sent.
	catchUp := func(from int64) error {
		upTo := st.Head()
		if s.CatchUpGap != nil {
			s.CatchUpGap()
		}
		rows, err := st.DocsSince(ctx, from, "")
		if err != nil {
			return err
		}
		var docs []docOut
		var revs []int64
		for _, d := range rows {
			for _, o := range pageDocs(own, v, d.Path, stored(d)) {
				docs, revs = append(docs, o), append(revs, d.Rev)
			}
			last = max(last, d.Rev)
		}
		last = max(last, upTo)
		return sendAll(docs, revs)
	}
	// sendRemote writes another store's documents, each with the store's
	// key, putting each commit's rev there on its last document: the
	// runtime's cursor for that store (rev is the view's own store's).
	sendRemote := func(storeID string, docs []docOut, revs []int64) error {
		key := v.RemoteKey(storeID)
		for i, d := range docs {
			d.Remote = key
			if i == len(docs)-1 || revs[i+1] != revs[i] {
				d.RemoteRev = revs[i]
			}
			if err := web.WriteSSE(w, "doc", d); err != nil {
				return err
			}
		}
		return nil
	}
	// catchUpRemote sends what changed in another store this view follows
	// after from.
	catchUpRemote := func(storeID string, from int64) error {
		rst, err := s.K.Store(ctx, storeID)
		if err != nil {
			return nil // gone or unavailable: nothing to send
		}
		upTo := rst.Head()
		rows, err := rst.DocsSince(ctx, from, "")
		if err != nil {
			return err
		}
		r := s.db.ReaderFor(ctx, v, storeID)
		reached := upTo
		var docs []docOut
		var revs []int64
		for _, d := range rows {
			for _, o := range pageDocs(r, v, d.Path, stored(d)) {
				docs, revs = append(docs, o), append(revs, d.Rev)
			}
			reached = max(reached, d.Rev)
		}
		if err := sendRemote(storeID, docs, revs); err != nil {
			return err
		}
		v.Caught(storeID, reached)
		return nil
	}
	// remote handles a commit of another store the view follows.
	remote := func(o rt.Out) error {
		from, ok := v.Watching(o.Store)
		switch {
		case !ok || o.Rev <= from:
			return nil
		case !s.confirm(ctx, v):
			return nil // the view was closed: its access or revoked event follows
		case o.Rev > from+1:
			return catchUpRemote(o.Store, from)
		}
		r := s.db.ReaderFor(ctx, v, o.Store)
		var docs []docOut
		var revs []int64
		for _, c := range o.Changes {
			for _, d := range pageDocs(r, v, c.Path, docOut{Version: c.Version, Body: c.Body, Patch: c.Patch, Base: c.Base, Deleted: c.Deleted}) {
				docs, revs = append(docs, d), append(revs, o.Rev)
			}
		}
		if err := sendRemote(o.Store, docs, revs); err != nil {
			return err
		}
		v.Caught(o.Store, o.Rev)
		return nil
	}
	if web.WriteSSE(w, "hello", s.hello(ctx, v, head)) != nil {
		return
	}
	if resume && after >= 0 && after < head && catchUp(after) != nil {
		return
	}
	// The other stores it follows: what changed since the runtime last
	// received a change there (?remote=key:rev,…), or since the view
	// started following it. Changes it got already come again; the runtime
	// keeps the newer version, so a resume repeats rather than loses.
	for storeID, from := range v.Resume(remoteCursors(r.URL.Query().Get("remote"))) {
		if catchUpRemote(storeID, from) != nil {
			return
		}
	}
	for _, room := range s.rooms.Of(v) {
		_ = web.WriteSSE(w, "peers", s.rooms.Peers(v.Target, room))
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
			case o.Rev > 0 && o.Store != "" && o.Store != v.Target:
				err = remote(o)
			case o.Rev > 0 && o.Rev <= last:
			case o.Rev > 0 && !s.confirm(ctx, v):
				// the view was closed: its access or revoked event follows
			case o.Rev > last+1:
				err = catchUp(last)
			case o.Rev > 0:
				last = o.Rev
				var docs []docOut
				var revs []int64
				for _, c := range o.Changes {
					for _, d := range pageDocs(own, v, c.Path, docOut{Version: c.Version, Body: c.Body, Patch: c.Patch, Base: c.Base, Deleted: c.Deleted}) {
						docs, revs = append(docs, d), append(revs, o.Rev)
					}
				}
				err = sendAll(docs, revs)
			default:
				err = web.WriteSSE(w, o.Type, o.Data)
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

// remoteCursors reads a reconnecting runtime's per-store cursors:
// key:rev pairs, comma-separated. What does not parse is left out (that
// store resumes from where the view started following it).
func remoteCursors(q string) map[string]int64 {
	out := map[string]int64{}
	for _, p := range strings.Split(q, ",") {
		k, r, ok := strings.Cut(p, ":")
		if n, err := strconv.ParseInt(r, 10, 64); ok && err == nil && k != "" && n > 0 {
			out[k] = n
		}
	}
	return out
}

// publish sends every commit to the views of its store, with a patch
// instead of the body when the patch is small next to it (diff sync), and
// tells views of an app whose ref moved to reload.
func (s *Door) publish(c *store.Commit) {
	out := rt.Out{Store: c.Store, Rev: c.Rev}
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
	for _, v := range s.rt.views.Reaching(c.Store) { // its own views, and views following it
		v.Send(out)
	}
	if refMoved {
		go s.reloadApp(c.Store)
	}
}

// reloadApp tells the views running an app whose ref moved to reopen on
// the new version (activating their stores first).
func (s *Door) reloadApp(app string) {
	ctx := context.Background()
	seen := map[string]int64{}
	for _, v := range s.rt.views.Where(func(v *rt.View) bool { return v.App == app }) {
		n, ok := seen[v.Target]
		if !ok {
			run, err := s.K.Running(ctx, v.Target)
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

// rpcMethod is a runtime method: what it does, and how. viewRPC checks the
// action's floor against the view before the method runs.
type rpcMethod struct {
	act authz.Action
	fn  rpcFunc
}

func (s *Door) rpcTable() map[string]rpcMethod {
	return map[string]rpcMethod{
		"db.get":                      {authz.DocRead, s.rpcDBGet},
		"db.query":                    {authz.DocRead, s.rpcDBQuery},
		"db.subscribe":                {authz.DocRead, s.rpcDBSubscribe},
		"db.unsubscribe":              {authz.DocRead, s.rpcDBUnsubscribe},
		"db.write":                    {authz.DocWrite, s.rpcDBWrite},
		"db.acquire":                  {authz.DocWrite, s.rpcDBAcquire},
		"user.profiles":               {authz.UserRead, s.rpcUserProfiles},
		"user.search":                 {authz.UserRead, s.rpcUserSearch},
		"sample.limits":               {authz.Sample, s.rpcSampleLimits},
		"room.join":                   {authz.Room, s.rpcRoomJoin},
		"room.leave":                  {authz.Room, s.rpcRoomLeave},
		"room.presence":               {authz.Room, s.rpcRoomPresence},
		"room.emit":                   {authz.Room, s.rpcRoomEmit},
		"room.canSendToClaudeSession": {authz.Room, func(context.Context, *rt.View, json.RawMessage) (any, error) { return false, nil }},
		"assets.list":                 {authz.AssetWrite, s.rpcAssetsList},
		"assets.delete":               {authz.AssetWrite, s.rpcAssetsDelete},
		"artifact.publish":            {authz.CodePush, s.rpcArtifactPublish},
		"slop.call":                   {authz.ActorCall, s.rpcSlopCall},
		"slop.read":                   {authz.DocRead, s.rpcSlopRead},
		"files.list":                  {authz.DocRead, s.rpcFilesList},
		"files.read":                  {authz.DocRead, s.rpcFilesRead},
		"permissions.state": {authz.StoreRead, func(_ context.Context, v *rt.View, _ json.RawMessage) (any, error) {
			return permissionStates(v), nil
		}},
	}
}

// viewMay reports whether v clears act's floor on its own store.
func viewMay(v *rt.View, act authz.Action) bool {
	spec, _ := authz.Of(act)
	ok, _ := authz.Floor(act, v.Level, v.Role == string(access.AudAdmin))
	return ok && spec.Store
}

func (s *Door) viewRPC(w http.ResponseWriter, r *http.Request) {
	v := s.viewOf(r)
	if v == nil {
		httpx.JSON(w, 401, map[string]any{"error": map[string]string{"code": "revoked", "message": "the view is closed or expired"}})
		return
	}
	var in struct {
		Method string          `json:"method"`
		Args   json.RawMessage `json:"args"`
		Key    string          `json:"key"` // set on calls that are not harmless to run twice
	}
	if err := httpx.Read(r, &in, int64(rt.MaxDocBytes)+64<<10); err != nil {
		httpx.JSON(w, 400, map[string]any{"error": map[string]string{"code": "invalid_argument", "message": "send {method, args}"}})
		return
	}
	m, ok := s.rpcTable()[in.Method]
	if !ok {
		httpx.JSON(w, 400, map[string]any{"error": map[string]string{"code": "capability_removed", "message": "unknown method " + in.Method}})
		return
	}
	name, _, _ := strings.Cut(in.Method, ".")
	if _, granted := grantedCaps(v)[name]; !granted && name != "permissions" {
		httpx.JSON(w, 403, map[string]any{"error": map[string]string{"code": "not_granted", "message": "this view was not granted " + name}})
		return
	}
	if !viewMay(v, m.act) {
		httpx.JSON(w, 403, map[string]any{"error": map[string]string{"code": "not_granted", "message": in.Method + " needs more access than this view has"}})
		return
	}
	run := func() (any, error) { return m.fn(r.Context(), v, in.Args) }
	var out any
	var err error
	if in.Key != "" && len(in.Key) <= 64 {
		// The call runs to its end even when the connection breaks: its
		// resend waits for this result instead of a cancellation.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Minute)
		defer cancel()
		run = func() (any, error) { return m.fn(ctx, v, in.Args) }
		out, err = s.rt.once.do(onceKey{v.Target, v.User, in.Key}, run)
	} else {
		out, err = run()
	}
	if err != nil {
		var f *rtFail
		if !errors.As(err, &f) {
			log.Printf("rpc %s: %v", in.Method, err)
			f = &rtFail{Code: "unavailable", Message: "the call failed"}
		}
		e := map[string]string{"code": f.Code, "message": f.Message}
		if f.Confirm != "" {
			e["confirm"] = f.Confirm
		}
		httpx.JSON(w, 200, map[string]any{"error": e})
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

func (s *Door) viewStore(ctx context.Context, v *rt.View) (*store.Store, error) {
	return s.K.Store(ctx, v.Target)
}

func viewWho(v *rt.View) store.Who {
	return store.Who{ID: v.User, Via: "page", Level: v.Level.String(), App: v.App + "@" + strconv.Itoa(v.Version)}
}

func docResult(d store.Doc) map[string]any {
	return map[string]any{"path": d.Path, "exists": true, "version": d.Version, "body": d.Body}
}

func (s *Door) rpcDBGet(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ Path string }](raw)
	if err != nil {
		return nil, err
	}
	return s.dbGet(ctx, v, a.Path)
}

// dbGet reads one document at a page path, wherever it lives (SLOP3-008).
// A document the viewer may not read, in any store, is missing.
func (s *Door) dbGet(ctx context.Context, v *rt.View, path string) (map[string]any, error) {
	d, ok, err := s.db.Get(ctx, v, path)
	if err != nil {
		return nil, dbErr(err)
	}
	if !ok {
		return map[string]any{"path": path, "exists": false}, nil
	}
	return map[string]any{"path": path, "exists": true, "version": d.Version, "body": d.Body}, nil
}

// readable runs q (on a page collection) over the documents the viewer may
// read in the store the collection lives in, with page paths.
func (s *Door) readable(ctx context.Context, v *rt.View, q rt.Query) ([]rt.Doc, error) {
	docs, err := s.db.Query(ctx, v, q)
	return docs, dbErr(err)
}

func (s *Door) rpcDBQuery(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	q, err := args[rt.Query](raw)
	if err != nil {
		return nil, err
	}
	if err := q.ValidateShape(); err != nil {
		return nil, rtErr("invalid_argument", "invalid query on %q", q.Coll)
	}
	docs, err := s.readable(ctx, v, q)
	if err != nil {
		return nil, err
	}
	return map[string]any{"docs": docs}, nil
}

func (s *Door) rpcDBWrite(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	in, err := args[capsdb.WriteIn](raw)
	if err != nil {
		return nil, err
	}
	version, rev, err := s.dbWrite(ctx, v, in)
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": version, "rev": rev}, nil
}

// writeRoute resolves a page path for a write: the registry's documents
// are not writable this way, and the viewer must be allowed to write it.
func (s *Door) writeRoute(ctx context.Context, v *rt.View, path string) (capsdb.Route, error) {
	r, err := s.db.WriteRoute(ctx, v, path)
	return r, dbErr(err)
}

// dbWrite validates and commits one write as one turn, in the store the
// page path lives in, or runs the registry verb a registry document's write
// stands for.
func (s *Door) dbWrite(ctx context.Context, v *rt.View, in capsdb.WriteIn) (int64, int64, error) {
	version, rev, err := s.db.Write(ctx, v, viewWho(v), in)
	return version, rev, dbErr(err)
}

func (s *Door) rpcDBAcquire(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		Path   string          `json:"path"`
		Holder string          `json:"holder"`
		TTLMs  int64           `json:"ttlMs"`
		Data   json.RawMessage `json:"data"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if a.Holder == "" || len(a.Holder) > 200 {
		return nil, rtErr("invalid_argument", "acquire needs a document path and a holder")
	}
	r, err := s.writeRoute(ctx, v, a.Path)
	if err != nil {
		return nil, err
	}
	ttl := a.TTLMs
	if ttl == 0 {
		ttl = rt.DefaultLeaseMs
	}
	ttl = min(max(ttl, rt.MinLeaseMs), rt.MaxLeaseMs)
	now := time.Now()
	key := r.Tgt.Store + "\x00" + r.Tgt.Path // the document's, whichever page path names it
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
		if _, err := r.St.Do(ctx, capsdb.Who(viewWho(v), r), func(t *store.Turn) error {
			version, err = t.UpdateDoc(r.Tgt.Path, data)
			return err
		}); err != nil {
			return nil, err
		}
	} else if d, err := s.dbGet(ctx, v, a.Path); err == nil {
		if d["exists"] == true {
			version = d["version"].(int64)
		}
	}
	return map[string]any{"acquired": true, "version": version, "expiresAt": until.UTC().Format(time.RFC3339), "holder": a.Holder}, nil
}

// rpcDBSubscribe registers a subscription and returns its current
// documents (without the limit: the runtime windows its mirror). A
// subscription in another store makes the view follow that store's log.
func (s *Door) rpcDBSubscribe(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		Sub   string    `json:"sub"`
		Path  string    `json:"path"`
		Coll  bool      `json:"coll"`
		Query *rt.Query `json:"query"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if a.Sub == "" || len(a.Sub) > 64 {
		return nil, rtErr("invalid_argument", "invalid subscription")
	}
	r, err := s.route(ctx, v, a.Path, !a.Coll)
	if err != nil {
		return nil, err
	}
	q := rt.Query{Coll: a.Path}
	if a.Query != nil {
		q = *a.Query
		q.Coll, q.Limit = a.Path, 0
	}
	if a.Coll && q.ValidateShape() != nil {
		return nil, rtErr("invalid_argument", "invalid query on %q", a.Path)
	}
	// Register first, then read: a write in between arrives on the stream
	// too, and the runtime keeps the higher version.
	if !v.Subscribe(rt.Sub{ID: a.Sub, Path: a.Path, Coll: a.Coll}) {
		return nil, rtErr("resource_exhausted", "at most %d subscriptions per view", rt.MaxSubscriptions)
	}
	var head int64
	switch {
	case r.Tgt.Own:
		head = r.St.Head()
	case r.Found:
		// Follow the other store from its head as read before the
		// documents: what lands later arrives on the stream. Follow it
		// too when the viewer may not read it yet (held is none): a grant
		// there then moves the level the view recorded, and recheck
		// reopens the page, which subscribes again and reads it.
		rst := r.St
		if rst == nil {
			rst, _ = s.K.Store(ctx, r.Tgt.Store)
		}
		if rst != nil {
			v.Watch(rst.ID, rst.Head(), r.Held)
		}
		st, _ := s.viewStore(ctx, v)
		if st != nil {
			head = st.Head()
		}
	}
	// A registry subscription is live (step 3): the follower sends it the
	// system log's changes. Remember it before reading, as for a store
	// subscription: a change in between reaches it (twice at worst; the
	// runtime keeps the higher version), where remembering after the read
	// would record a stale snapshot the follower already passed.
	if r.Tgt.Registry {
		s.reg.Live.Remember(v.ID, registry.Sub{ID: a.Sub, Path: a.Path, Coll: a.Coll, Query: q}, nil)
	}
	if !a.Coll {
		d, err := s.dbGet(ctx, v, a.Path)
		if err != nil {
			s.reg.Live.Forget(v.ID, a.Sub)
			return nil, err
		}
		if r.Tgt.Registry && d["exists"] == true {
			s.reg.Live.Saw(v.ID, a.Sub, []rt.Doc{{Path: a.Path, Version: d["version"].(int64)}})
		}
		return map[string]any{"rev": head, "doc": d}, nil
	}
	docs, err := s.readable(ctx, v, q)
	if err != nil {
		s.reg.Live.Forget(v.ID, a.Sub)
		return nil, err
	}
	if r.Tgt.Registry {
		s.reg.Live.Saw(v.ID, a.Sub, docs)
	}
	return map[string]any{"rev": head, "docs": docs}, nil
}

func (s *Door) rpcDBUnsubscribe(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ Sub string }](raw)
	if err != nil {
		return nil, err
	}
	v.Unsubscribe(a.Sub)
	s.reg.Live.Forget(v.ID, a.Sub)
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

func profileOf(v *rt.View, p sysdb.Person) profile {
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
	if v.Caps.Scopes["email"] && v.Policy["user.email"] {
		out.Email = p.Email
	}
	return out
}

// userInfo is the viewer as the user capability reports them, plus who
// they are to the platform (audience, level).
func (s *Door) userInfo(ctx context.Context, v *rt.View) map[string]any {
	out := map[string]any{"isOwner": v.Level == rt.LevelOwner, "canEdit": v.Level >= rt.LevelAdmin,
		"audience": v.Role, "level": v.Level.String(),
		"can": map[string]bool{
			"data.write":   v.Caps.Rules.CanWrite("__probe__/__probe__", "", v.Level),
			"assets.write": v.Level >= rt.LevelInteract, "files.write": v.Level >= rt.LevelAdmin, "people.add": false,
		}}
	if s.A != nil {
		vis := s.A.VisitorOf(ctx, s.viewPrincipal(ctx, v), v.Target)
		out["visitor"] = vis
		out["subscribed"] = vis.Subscribed
	}
	l := s.viewLLM(ctx, v) // §9.5: user.me().llm
	out["llm"] = map[string]any{"allowed": l.Allowed, "remaining": l.Remaining}
	if v.Caps.Declared["user"] {
		out["id"] = v.User
		out["guest"] = strings.HasPrefix(v.User, "vis_") || v.User == ""
		if p, err := s.People.Person(ctx, v.User); err == nil {
			out["profile"] = profileOf(v, p)
		}
	}
	return out
}

func (s *Door) rpcUserProfiles(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ IDs []string }](raw)
	if err != nil {
		return nil, err
	}
	if len(a.IDs) > 200 {
		return nil, rtErr("invalid_argument", "at most 200 ids")
	}
	out := map[string]profile{}
	for _, id := range a.IDs {
		if p, err := s.People.Person(ctx, id); err == nil {
			out[id] = profileOf(v, p)
		}
	}
	return out, nil
}

// rpcUserSearch finds people who hold a grant on (or own) the view's store.
func (s *Door) rpcUserSearch(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ Q string }](raw)
	if err != nil {
		return nil, err
	}
	if !v.Caps.Scopes["profile"] {
		return []profile{}, nil
	}
	ids := []string{}
	if row, err := s.Registry.StoreByID(ctx, v.Target); err == nil {
		ids = append(ids, row.Owner)
	}
	if gs, err := s.Registry.Grants(ctx, v.Target); err == nil {
		for _, g := range gs {
			if strings.HasPrefix(g.Subject, "usr_") && !slices.Contains(ids, g.Subject) {
				ids = append(ids, g.Subject)
			}
		}
	}
	q := strings.ToLower(strings.TrimSpace(a.Q))
	out := []profile{}
	for _, id := range ids {
		p, err := s.People.Person(ctx, id)
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
// The room capability is pkg/caps/room; these are its page protocol.

type roomArgs struct {
	Room  string          `json:"room"`
	Topic string          `json:"topic"`
	Data  json.RawMessage `json:"data"`
	Patch map[string]any  `json:"patch"`
}

// roomErr is the room capability's refusal as the runtime's error.
func roomErr(err error) error {
	var e *caproom.Error
	if errors.As(err, &e) {
		return &rtFail{Code: e.Code, Message: e.Message}
	}
	return err
}

func (s *Door) rpcRoomJoin(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	peers, err := s.rooms.Join(v, a.Room)
	return peers, roomErr(err)
}

func (s *Door) rpcRoomLeave(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	s.rooms.Leave(v, a.Room)
	return map[string]bool{"ok": true}, nil
}

func (s *Door) rpcRoomPresence(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	if err := s.rooms.Presence(v, a.Room, a.Patch); err != nil {
		return nil, roomErr(err)
	}
	return map[string]bool{"ok": true}, nil
}

func (s *Door) rpcRoomEmit(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	dropped, err := s.rooms.Emit(v, a.Room, a.Topic, a.Data, time.Now())
	if err != nil {
		return nil, roomErr(err)
	}
	if dropped {
		return map[string]bool{"dropped": true}, nil
	}
	return map[string]bool{"ok": true}, nil
}
