package actor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"path"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
	"github.com/robfig/cron/v3"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/policy"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Manager owns the actors of all stores.
type Manager struct {
	K *kernel.Kernel

	mu      sync.Mutex
	actors  map[string]*Actor
	inboxes map[string]*inbox // store → its queue of events (inbox.go)
	// gen moves whenever actors are stopped so the next event builds them
	// again (a restart, trust or policy change, a new version). A build
	// that started before reads state from before the change: Get drops it
	// and builds again.
	gen    uint64
	broken map[string]string // store → app@n: why
	files  map[string]map[string][]byte
	logs   map[string][]LogLine

	// Hooks provided by the host.
	Policy func(app, capability, audience string) bool
	Secret func(ctx context.Context, app, name string) (string, error)
	Paths  Paths                                                       // the db paths outside the store (aliases, _stores); nil: the store's own only
	Grant  func(ctx context.Context, app, module string) (Grant, bool) // app.trust: an app's grant of a catalog module
	// Around, when set, wraps every entry into an actor's VM (op is
	// "load", "setup" or "turn <kind>"); run does the work and must be
	// called once. For tests and measurements; set it before actors start.
	Around func(op string, run func() error) error
	// TurnLimit, when set, replaces the package's TurnLimit for this
	// manager's actors (tests: the package variable is read by every
	// running actor, so changing it races). Set it before actors start.
	TurnLimit time.Duration
	// Runtime is what actors run on: RuntimeEngine ("" too) or
	// RuntimeDirect (slop.yaml actors.runtime). Set it before actors start.
	Runtime string

	engines engineFactory // the engine runtimes' factory, built on first use

	llmMu sync.RWMutex
	llmB  llm.Backend // the sample backend (SetLLM, LLM)

	provided map[string]func(*Actor) goja.Value // the door's capability bindings (Provide)
	modules  map[string]Module                  // the catalog (Register; catalog.go)
	calls    meters                             // module calls (catalog.go)
}

// SetLLM sets the sample backend (nil: no LLM). The host sets it while it
// is built, when actors may already run (the system follower starts them),
// so it is read under a lock.
func (m *Manager) SetLLM(b llm.Backend) {
	m.llmMu.Lock()
	defer m.llmMu.Unlock()
	m.llmB = b
}

// LLM is the sample backend, nil without one.
func (m *Manager) LLM() llm.Backend {
	m.llmMu.RLock()
	defer m.llmMu.RUnlock()
	return m.llmB
}

// turnLimit is how long one entry's JavaScript may run.
func (m *Manager) turnLimit() time.Duration {
	if m.TurnLimit > 0 {
		return m.TurnLimit
	}
	return TurnLimit
}

// New makes the actor manager and hooks it into the kernel (activation,
// commits for reactors).
func New(k *kernel.Kernel) *Manager {
	m := &Manager{K: k, actors: map[string]*Actor{}, inboxes: map[string]*inbox{}, broken: map[string]string{}, files: map[string]map[string][]byte{}, logs: map[string][]LogLine{}}
	if k.Cfg != nil {
		m.Runtime = k.Cfg.Actors.Runtime
	}
	k.Activate = m.activate
	k.OnActivated = m.onActivated
	k.Subscribe(m.onCommit)
	m.followSystem()
	m.registerBuiltins()
	return m
}

// allowed checks a policy capability for the current turn's visitor (for
// alarms and reactors, the store itself: the @store cell).
func (m *Manager) allowed(a *Actor, capability string) bool {
	if m.Policy == nil {
		return true
	}
	aud := string(access.AudStore) // no turn: nobody but the store itself
	if a.cur != nil {
		aud = a.Visitor().Audience
	}
	return m.Policy(a.run.App, capability, aud)
}

// allowedAny reports whether the policy allows a capability for any
// audience: use(name) is null when it allows it for none.
func (m *Manager) allowedAny(a *Actor, capability string) bool {
	if m.Policy == nil {
		return true
	}
	for _, aud := range policy.PolicyAudiences {
		if m.Policy(a.run.App, capability, aud) {
			return true
		}
	}
	return false
}

// need throws permission_denied unless the current visitor may use a
// policy capability.
func (a *Actor) need(capability string) {
	if !a.m.allowed(a, capability) {
		a.throw(fail("permission_denied", "this app may not use %s for %s", capability, orNone(a.Visitor().Audience)))
	}
}

// appFiles reads the scripts of an app version (cached).
func (m *Manager) appFiles(ctx context.Context, app string, n int64) (map[string][]byte, error) {
	key := app + "@" + strconv.FormatInt(n, 10)
	m.mu.Lock()
	if f, ok := m.files[key]; ok {
		m.mu.Unlock()
		return f, nil
	}
	m.mu.Unlock()
	as, err := m.K.Store(ctx, app)
	if err != nil {
		return nil, err
	}
	list, err := as.SnapshotFiles(ctx, n)
	if err != nil {
		return nil, err
	}
	out := map[string][]byte{}
	for _, f := range list {
		ext := path.Ext(f.Path)
		if (ext == ".js" || ext == ".json" || ext == ".sql") && f.Size < 4<<20 {
			b, err := as.ReadFile(f)
			if err != nil {
				return nil, err
			}
			out[f.Path] = b
		}
	}
	m.mu.Lock()
	if len(m.files) > 256 {
		m.files = map[string]map[string][]byte{}
	}
	m.files[key] = out
	m.mu.Unlock()
	return out, nil
}

// Get returns the store's running actor, building it on first use. It is
// nil (and no error) when the store's app has no actor.
func (m *Manager) Get(ctx context.Context, id string) (*Actor, error) {
	for {
		a, stale, err := m.get(ctx, id)
		if !stale {
			return a, err
		}
	}
}

// get is one attempt of Get; stale reports a build overtaken by a restart.
// get returns the running actor, and whether a restart made the build stale.
func (m *Manager) get(ctx context.Context, id string) (*Actor, bool, error) {
	m.mu.Lock()
	gen := m.gen
	m.mu.Unlock()
	r, err := m.K.Running(ctx, id)
	if err != nil {
		return nil, false, err
	}
	if r.N > 0 && !r.Usable() {
		// never activated (its migrations or setup failed): no actor runs it
		return nil, false, fail("actor_error", "the app is broken: %s", r.Broken())
	}
	if r.Manifest == nil || r.Manifest.Actor == "" {
		return nil, false, nil
	}
	key := r.App + "@" + strconv.FormatInt(r.N, 10)
	m.mu.Lock()
	if a := m.actors[id]; a != nil && a.key == key {
		m.mu.Unlock()
		return a, false, nil
	}
	if why, ok := m.broken[id]; ok && strings.HasPrefix(why, key+": ") {
		m.mu.Unlock()
		return nil, false, fail("actor_error", "the actor is broken: %s", strings.TrimPrefix(why, key+": "))
	}
	m.mu.Unlock()
	files, err := m.appFiles(ctx, r.App, r.N)
	if err != nil {
		return nil, false, err
	}
	st, err := m.K.Store(ctx, id)
	if err != nil {
		return nil, false, err
	}
	a, err := build(ctx, m, st, r, files, true)
	m.mu.Lock()
	if m.gen != gen {
		m.mu.Unlock()
		a.release()
		return nil, true, nil // a restart happened during the build
	}
	if err != nil {
		m.broken[id] = key + ": " + err.Error()
		m.mu.Unlock()
		return nil, false, err
	}
	if old := m.actors[id]; old != nil {
		if old.key == key {
			m.mu.Unlock()
			a.release()
			return old, false, nil // someone else built it meanwhile
		}
		close(old.stop)
	}
	m.actors[id] = a
	m.mu.Unlock()
	go a.loop()
	if a.followsSystem() {
		m.queueSystem(a) // catch up with what happened while it was stopped
	}
	return a, false, nil
}

// Running is the actor of a store if one is in memory (nil otherwise).
func (m *Manager) Running(id string) *Actor {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.actors[id]
}

func (m *Manager) retire(a *Actor) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.actors[a.st.ID] != a {
		return true
	}
	if len(m.inboxLocked(a.st.ID).evs) > 0 {
		return false // something arrived: take it first
	}
	delete(m.actors, a.st.ID)
	close(a.stop)
	return true
}

func (m *Manager) markBroken(a *Actor, why string) {
	m.mu.Lock()
	m.broken[a.st.ID] = a.key + ": " + why
	if m.actors[a.st.ID] == a {
		delete(m.actors, a.st.ID)
		close(a.stop)
	}
	m.mu.Unlock()
	log.Printf("actor %s (%s) broken: %s", a.st.ID, a.key, why)
}

// Restart clears a store's broken state and stops its actor, so the next
// event builds it again (and activation is retried).
// RestartApp stops the running actors of every store running app, so the
// next event builds them again (use() is evaluated at start: a policy
// change needs a fresh runtime).
func (m *Manager) RestartApp(app string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.gen++
	for id, a := range m.actors {
		if a.run.App == app {
			delete(m.actors, id)
			close(a.stop)
		}
	}
	// A failed build is cached per store (m.broken, keyed app@n). The
	// changes that restart an app (a grant, its configuration, a policy)
	// can make that build succeed, so the next request builds again.
	for id, why := range m.broken {
		if strings.HasPrefix(why, app+"@") {
			delete(m.broken, id)
		}
	}
}

func (m *Manager) Restart(id string) {
	m.mu.Lock()
	m.gen++
	delete(m.broken, id)
	if a := m.actors[id]; a != nil {
		delete(m.actors, id)
		close(a.stop)
	}
	m.mu.Unlock()
	m.K.ClearFailure(id)
}

// Broken reports why a store's actor is broken ("" when it is not).
func (m *Manager) Broken(id string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.broken[id]
}

// onActivated stops the store's actor of an older version; the next event
// builds the new one. builds in flight are discarded (gen): they may have
// read the version before the activation committed.
//
// An actor of the version just activated stays. get sees a version only once
// its activation has committed, so such an actor was built after it: a
// request that waited on the activating turn ("another request activated it
// first") can build and install it before the activating goroutine gets
// here. Stopping it would restart it for nothing and forget its recent
// crashes.
func (m *Manager) onActivated(id string, r kernel.Running) {
	key := r.App + "@" + strconv.FormatInt(r.N, 10)
	m.mu.Lock()
	m.gen++
	delete(m.broken, id)
	if a := m.actors[id]; a != nil && a.key != key {
		delete(m.actors, id)
		close(a.stop)
	}
	m.mu.Unlock()
	m.refreshSchedule(context.Background(), id)
}

// storeVisitor is the store itself, for setup, reactors and alarms.
func (m *Manager) storeVisitor(ctx context.Context, id string) Visitor {
	// Nobody is behind an alarm, a reactor or setup: the store acts as
	// itself (SLOP3-007 decision 3). It is owner of its own data, in the
	// group @store for policy, and pays for its own model calls; it never
	// borrows its owner.
	v := Visitor{ID: "store:" + id, Name: id, Level: "owner", Audience: string(access.AudStore), Payer: "store:" + id}
	m.withLLM(ctx, &v)
	return v
}

// withLLM adds what the payer may spend on the LLM this month.
func (m *Manager) withLLM(ctx context.Context, v *Visitor) {
	if v.Payer == "" {
		v.LLM = &llm.LLM{}
		return
	}
	l := m.K.Ledger.LLMFor(ctx, v.Payer, v.Audience)
	v.LLM = &l
}

// VisitorOf describes a principal to a store's actor.
func (m *Manager) VisitorOf(ctx context.Context, p *access.Principal, storeID string) Visitor {
	v := Visitor{ID: p.ID(), Audience: string(access.AudGuest), Guest: true}
	if p != nil && p.Kind == access.KindStore {
		v.Name, v.Guest = p.Store, false
	}
	if p != nil && p.Person != nil {
		v.Name = p.Person.Name
		if v.Name == "" {
			v.Name, _, _ = strings.Cut(p.Person.Email, "@")
		}
		v.Guest = p.Person.Kind == "guest"
	}
	if row, err := m.K.Registry.StoreByID(ctx, storeID); err == nil {
		d := m.K.Access.Level(ctx, p, row)
		v.Level, v.Audience = d.LevelName(), string(d.Audience)
	}
	v.Subscribed = v.Audience == string(access.AudSubscriber)
	if v.Level == "none" {
		v.Level = ""
	}
	if p != nil && p.Person != nil {
		v.Payer = p.Person.ID // a visitor without an id is never charged
	}
	if p != nil && p.Kind == access.KindToken {
		v.Scopes = append([]string{}, p.Scopes...) // modules act with the token's scopes, no more
	}
	m.withLLM(ctx, &v)
	return v
}

// --- activation ----------------------------------------------------------

// activate runs inside the activation turn: the app version's pending
// migrations (sql/*.sql in name order), then setup and smoke. Any error
// rolls back the whole activation.
func (m *Manager) activate(ctx context.Context, t *store.Turn, r kernel.Running) error {
	files, err := m.appFiles(ctx, r.App, r.N)
	if err != nil {
		return err
	}
	var migs []string
	for p := range files {
		if strings.HasPrefix(p, "sql/") && strings.HasSuffix(p, ".sql") && !strings.Contains(p[4:], "/") {
			migs = append(migs, p)
		}
	}
	sort.Strings(migs)
	applied, err := t.Query(store.CallerKernel, `SELECT name, sha256 FROM _migrations`)
	if err != nil {
		return err
	}
	done := map[string]string{}
	for _, row := range applied {
		done[fmt.Sprint(row["name"])] = fmt.Sprint(row["sha256"])
	}
	for _, p := range migs {
		sum := sha256hex(files[p])
		if prev, ok := done[p]; ok {
			if prev != sum {
				return fmt.Errorf("migration %s changed after it was applied; add a new migration instead", p)
			}
			continue
		}
		if _, err := t.Exec(store.CallerMigration, string(files[p])); err != nil {
			return fmt.Errorf("migration %s: %v", p, err)
		}
		if _, err := t.Exec(store.CallerKernel, `INSERT INTO _migrations (name, sha256, rev) VALUES (?, ?, ?)`, p, sum, t.Rev); err != nil {
			return err
		}
	}
	if r.Manifest == nil || r.Manifest.Actor == "" {
		return nil
	}
	st, err := m.K.Store(ctx, r.Store)
	if err != nil {
		return err
	}
	a, err := build(ctx, m, st, r, files, true)
	if err != nil {
		return err
	}
	// This actor only runs setup: the store's actor is built on first use.
	defer a.release()
	return a.enter(ctx, "setup", func(*goja.Runtime) error { return m.setup(ctx, t, a) })
}

// setup runs setup and smoke inside the activation turn, then records the
// version's recurring alarms and its reactors' cursors.
func (m *Manager) setup(ctx context.Context, t *store.Turn, a *Actor) error {
	st := a.st
	for _, name := range a.undeclared {
		a.log("warn", fmt.Sprintf("action %s declares no requires; callers need admin", name))
	}
	ev := &event{kind: "setup", visitor: m.storeVisitor(ctx, st.ID), via: "activate"}
	a.cur = &turn{t: t, ev: ev, rev: t.Rev - 1}
	defer func() { a.cur = nil }()
	defer a.dropSavepoints() // after a failed hook; closeSavepoints ran otherwise
	defer a.fs.end(false)    // likewise for the fs module (a no-op after end(true))
	cx := a.ctxObject(ev)
	for _, name := range []string{"setup", "smoke"} {
		f := a.fn(name, "")
		if f == nil {
			continue
		}
		var v goja.Value
		err := a.limited(name+" took too long", func() error {
			var err error
			v, err = f(goja.Undefined(), cx)
			return err
		})
		if err != nil {
			return fmt.Errorf("%s: %v", name, a.asError(err).Message)
		}
		if p, ok := v.Export().(*goja.Promise); ok {
			switch p.State() {
			case goja.PromiseStatePending:
				return fmt.Errorf("%s must not await I/O", name)
			case goja.PromiseStateRejected:
				return fmt.Errorf("%s: %v", name, a.jsError(p.Result()).Message)
			case goja.PromiseStateFulfilled: // settled within the turn: fine
			}
		}
	}
	a.closeSavepoints() // a handle setup or smoke left open rolls back
	a.fs.end(true)
	// Recurring alarms from every: add new ones, update changed specs,
	// drop those the version no longer declares.
	declared := map[string]bool{}
	for _, name := range a.keys("every") {
		obj, _ := a.def.Get("every").(*goja.Object).Get(name).(*goja.Object)
		if obj == nil {
			continue
		}
		spec := ""
		for _, k := range []string{"cron", "every"} {
			if v := obj.Get(k); v != nil && !goja.IsUndefined(v) {
				spec = v.String()
			}
		}
		next, err := nextTime(spec, time.UnixMilli(t.Now))
		if err != nil {
			return fmt.Errorf("every.%s: %v", name, err)
		}
		declared[name] = true
		if _, err := t.Exec(store.CallerKernel, `INSERT INTO _alarms (name, at, every, data, running) VALUES (?, ?, ?, NULL, 0)
			ON CONFLICT (name) DO UPDATE SET every = excluded.every, at = CASE WHEN _alarms.every = excluded.every THEN _alarms.at ELSE excluded.at END`,
			name, next.UnixMilli(), spec); err != nil {
			return err
		}
	}
	rows, err := t.Query(store.CallerKernel, `SELECT name FROM _alarms WHERE every IS NOT NULL`)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if name := fmt.Sprint(row["name"]); !declared[name] {
			if _, err := t.Exec(store.CallerKernel, `DELETE FROM _alarms WHERE name = ?`, name); err != nil {
				return err
			}
		}
	}
	// Reactors start at the current head: they follow what happens next.
	for _, name := range a.keys("on") {
		source, epoch, rev := "self", st.Epoch(), t.Rev-1
		if strings.HasPrefix(name, "system:") {
			head, err := m.K.Sys.LogHead(ctx)
			if err != nil {
				return err
			}
			source, epoch, rev = "system", 0, head
		}
		if _, err := t.Exec(store.CallerKernel, `INSERT INTO _cursors (name, source, epoch, rev) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
			name, source, epoch, rev); err != nil {
			return err
		}
	}
	return nil
}

// --- actions and HTTP -----------------------------------------------------

// Call runs an action of a store's actor and waits for its result (which
// may take several turns when the action awaits I/O).
func (m *Manager) Call(ctx context.Context, storeID, action string, args any, vis Visitor, via string) (any, error) {
	a, err := m.Get(ctx, storeID)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, fail("not_found", "%s has no actor", storeID)
	}
	if !slices.Contains(a.keys("actions"), action) {
		return nil, fail("not_found", "%s has no action %q", storeID, action)
	}
	// The action's declared requires, checked before any of its code runs:
	// one check for the actor.call verb, page calls and store-to-store calls.
	if err := a.mayCall(action, vis); err != nil {
		return nil, err
	}
	return a.send(ctx, &event{kind: "action", name: action, visitor: vis, via: via,
		run: func(a *Actor, cx *goja.Object) (goja.Value, error) {
			f := a.fn("actions", action)
			if f == nil {
				return nil, fail("not_found", "%s has no action %q", storeID, action)
			}
			return f(goja.Undefined(), cx, a.toJS(args))
		}})
}

// mayCall checks the visitor's level against an action's requires.
func (a *Actor) mayCall(action string, vis Visitor) error {
	need, ok := a.requires[action]
	if !ok {
		need = rt.LevelAdmin
	}
	have, _ := rt.ParseLevel(vis.Level)
	if have >= need {
		return nil
	}
	if have == rt.LevelNone {
		return fail("not_found", "%s has no action %q", a.st.ID, action)
	}
	if slices.Contains(a.undeclared, action) {
		return fail("permission_denied", "%s declares no requires, so it needs admin; you have %s", action, have)
	}
	return fail("permission_denied", "%s needs %s; you have %s", action, need, have)
}

// Actions lists the actions of a store's actor.
func (m *Manager) Actions(ctx context.Context, storeID string) []string {
	a, err := m.Get(ctx, storeID)
	if err != nil || a == nil {
		return nil
	}
	return a.keys("actions")
}

// Req is an HTTP request as a route handler sees it.
type Req struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Base    string            `json:"base"` // the URL path the mount matched, without a trailing slash
	Params  map[string]string `json:"params"`
	Query   map[string]string `json:"query"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

// Res is a route handler's answer.
type Res struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Type    string            `json:"-"`
	Body    []byte            `json:"-"`
	Asset   *AssetRef         `json:"-"` // an uploaded file of a bound store, sent by the server
}

// AssetRef names an uploaded file of the store bound at alias From.
type AssetRef struct {
	From string `json:"from"`
	ID   string `json:"id"`
}

// Route is a matched HTTP route of an actor.
type Route struct {
	Key      string
	Level    string // view (default), interact, admin, owner, or public
	Audience string
	Params   map[string]string
}

// MatchRoute finds the actor route for a method and path (below the
// mount). ok is false when the store has no actor or no route matches.
// With a mount's API policy, only the route keys its allowlist covers are
// candidates (SLOP3-012): a request can never reach any other key.
func (m *Manager) MatchRoute(ctx context.Context, storeID, method, p string, api *registry.MountAPI) (*Actor, Route, bool) {
	a, err := m.Get(ctx, storeID)
	if err != nil || a == nil {
		return nil, Route{}, false
	}
	best := Route{}
	bestScore := -1
	for _, key := range a.keys("http") {
		meth, pat, ok := strings.Cut(key, " ")
		if !ok || (meth != method && meth != "*" && (meth != "GET" || method != "HEAD")) {
			continue
		}
		if api != nil && !api.AllowsKey(key) {
			continue
		}
		params, score, ok := registry.MatchPattern(pat, p)
		if !ok || score <= bestScore {
			continue
		}
		r := a.routes[key]
		r.Params = params
		best, bestScore = r, score
	}
	return a, best, bestScore >= 0
}

// Serve runs a matched route as an event and returns its response.
func (m *Manager) Serve(ctx context.Context, a *Actor, route Route, req Req, vis Visitor) (*Res, error) {
	req.Params = route.Params
	v, err := a.send(ctx, &event{kind: "http", name: route.Key, visitor: vis, via: "http",
		run: func(a *Actor, cx *goja.Object) (goja.Value, error) {
			f := a.fn("http", route.Key)
			if f == nil {
				return nil, fail("actor_error", "route %s has no run", route.Key)
			}
			return f(goja.Undefined(), cx, a.toJS(req))
		}})
	if err != nil {
		return nil, err
	}
	return toRes(v), nil
}

func toRes(v any) *Res {
	res := &Res{Status: 200, Headers: map[string]string{}}
	m, ok := v.(map[string]any)
	if !ok {
		b, _ := json.Marshal(v)
		res.Type, res.Body = "application/json", b
		return res
	}
	if s, ok := m["status"].(json.Number); ok {
		if n, err := s.Int64(); err == nil {
			res.Status = int(n)
		}
	}
	if h, ok := m["headers"].(map[string]any); ok {
		for k, x := range h {
			res.Headers[k] = fmt.Sprint(x)
		}
	}
	switch {
	case m["asset"] != nil:
		if a, ok := m["asset"].(map[string]any); ok {
			res.Asset = &AssetRef{From: fmt.Sprint(a["from"]), ID: fmt.Sprint(a["id"])}
		}
	case m["json"] != nil:
		b, _ := json.Marshal(m["json"])
		res.Type, res.Body = "application/json", b
	case m["html"] != nil:
		res.Type, res.Body = "text/html; charset=utf-8", []byte(fmt.Sprint(m["html"]))
	case m["text"] != nil:
		res.Type, res.Body = "text/plain; charset=utf-8", []byte(fmt.Sprint(m["text"]))
	case m["body"] != nil:
		res.Type, res.Body = "application/octet-stream", []byte(fmt.Sprint(m["body"]))
	}
	return res
}

// Logs returns the recent log lines of a store's actor.
// Logs returns the last lines a store's actor logged, oldest first.
func (m *Manager) Logs(ctx context.Context, id string) []LogLine {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]LogLine{}, m.logs[id]...)
}

const maxLogLines = 500

func (m *Manager) log(store, level, text string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	l := append(m.logs[store], LogLine{At: time.Now().UnixMilli(), Level: level, Text: text})
	if len(l) > maxLogLines {
		l = l[len(l)-maxLogLines:]
	}
	m.logs[store] = l
}

// --- reactors -------------------------------------------------------------

// onCommit queues a reactor event for a store whose actor follows its log.
func (m *Manager) onCommit(c *store.Commit) {
	if c.Via == "reactor" || c.Via == "activate" {
		return
	}
	go func() {
		a, err := m.Get(context.Background(), c.Store)
		if err != nil || a == nil || len(a.keys("on")) == 0 {
			return
		}
		a.mu.Lock()
		if a.reactor {
			a.mu.Unlock()
			return
		}
		a.reactor = true
		a.mu.Unlock()
		ev := &event{kind: "reactor", visitor: m.storeVisitor(context.Background(), c.Store), via: "reactor",
			run: func(a *Actor, cx *goja.Object) (goja.Value, error) {
				a.mu.Lock()
				a.reactor = false
				a.mu.Unlock()
				return nil, a.react(cx)
			}}
		if m.push(c.Store, ev) != nil {
			a.mu.Lock()
			a.reactor = false // the queue is full: the next commit queues it again
			a.mu.Unlock()
		}
	}()
}

// react delivers the commits after each reactor's cursor, and moves the
// cursor, in this one turn: exactly once.
func (a *Actor) react(cx *goja.Object) error {
	t := a.cur.t
	ctx := t.Context()
	for _, name := range a.keys("on") {
		f := a.fn("on", name)
		if f == nil || strings.HasPrefix(name, "system:") {
			continue
		}
		rows, err := t.Query(store.CallerKernel, `SELECT rev FROM _cursors WHERE name = ? AND source = 'self'`, name)
		if err != nil {
			return err
		}
		var from int64
		if len(rows) == 0 {
			from = a.cur.rev
		} else {
			from = toInt(rows[0]["rev"])
		}
		commits, err := a.st.Log(ctx, from, 200)
		if err != nil {
			return err
		}
		last := from
		for _, c := range commits {
			last = c.Rev
			if c.Via == "reactor" || c.Via == "activate" || !selects(name, c) {
				continue
			}
			if _, err := f(goja.Undefined(), cx, a.toJS(c)); err != nil {
				return err
			}
		}
		if last != from || len(rows) == 0 {
			if _, err := t.Exec(store.CallerKernel, `INSERT INTO _cursors (name, source, epoch, rev) VALUES (?, 'self', ?, ?)
				ON CONFLICT (name) DO UPDATE SET rev = excluded.rev, epoch = excluded.epoch`, name, a.st.Epoch(), last); err != nil {
				return err
			}
		}
	}
	return nil
}

func toInt(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case float64:
		return int64(x)
	}
	n, _ := strconv.ParseInt(fmt.Sprint(v), 10, 64)
	return n
}

// selects reports whether a selector matches any change of a commit:
// doc:<glob>, file:<glob>, table:<name>, ref:<name>, snapshot, schema, *.
func selects(sel string, c store.Commit) bool {
	if sel == "*" {
		return true
	}
	kind, pat, _ := strings.Cut(sel, ":")
	for _, ch := range c.Changes {
		if ch.Kind != kind {
			continue
		}
		key := ch.Key
		if kind == "file" {
			_, key, _ = strings.Cut(key, ":")
		}
		if pat == "" || pat == "*" {
			return true
		}
		if ok, _ := path.Match(pat, key); ok {
			return true
		}
		if strings.HasSuffix(pat, "/**") && strings.HasPrefix(key, strings.TrimSuffix(pat, "**")) {
			return true
		}
	}
	return false
}

// --- alarms ---------------------------------------------------------------

var cronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor)

// nextTime is the next time a spec fires after from: a Go duration
// ("5m"), "@every 5m", a descriptor (@hourly) or a 5-field cron line.
func nextTime(spec string, from time.Time) (time.Time, error) {
	spec = strings.TrimSpace(spec)
	if d, err := time.ParseDuration(spec); err == nil {
		if d < time.Second {
			return time.Time{}, errors.New("an interval is at least 1s")
		}
		return from.Add(d), nil
	}
	s, err := cronParser.Parse(spec)
	if err != nil {
		return time.Time{}, fmt.Errorf("bad schedule %q: %v", spec, err)
	}
	return s.Next(from), nil
}

// afterTurn refreshes a store's schedule when a turn touched its alarms.
func (m *Manager) afterTurn(a *Actor, t *turn) {
	if t.alarms || t.ev.kind == "alarm" {
		m.refreshSchedule(context.Background(), a.st.ID)
	}
}

// refreshSchedule mirrors a store's next alarm time into system.db.
func (m *Manager) refreshSchedule(ctx context.Context, id string) {
	st, err := m.K.Store(ctx, id)
	if err != nil {
		return
	}
	rows, err := st.ReadQuery(ctx, `SELECT min(at) AS next FROM _alarms WHERE running = 0`)
	if err != nil || len(rows) == 0 || rows[0]["next"] == nil {
		_ = m.K.Registry.ClearSchedule(ctx, id)
		return
	}
	_ = m.K.Registry.SetSchedule(ctx, id, toInt(rows[0]["next"]))
}

// Start runs the alarm scheduler until ctx ends: it wakes the stores whose
// next alarm is due (an alarm missed while the server was down fires once,
// late).
func (m *Manager) Start(ctx context.Context) {
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				due, err := m.K.Registry.DueSchedules(ctx, now.UnixMilli())
				if err != nil {
					continue
				}
				for _, id := range due {
					if err := m.Fire(ctx, id, ""); err != nil {
						log.Printf("schedule %s: %v", id, err)
					}
				}
			}
		}
	}()
}

// Fire queues the store's due alarms (or one named alarm, now).
func (m *Manager) Fire(ctx context.Context, id, name string) error {
	a, err := m.Get(ctx, id)
	if err != nil {
		return err
	}
	if a == nil {
		_ = m.K.Registry.ClearSchedule(ctx, id)
		return fail("not_found", "%s has no actor", id)
	}
	// Push the schedule forward so the ticker does not queue it again
	// while the alarm runs; afterTurn sets the real next time.
	_ = m.K.Registry.SetSchedule(ctx, id, time.Now().Add(time.Minute).UnixMilli())
	ev := &event{kind: "alarm", name: name, visitor: m.storeVisitor(ctx, id), via: "alarm",
		run: func(a *Actor, cx *goja.Object) (goja.Value, error) { return a.alarm(cx, name) }}
	return m.push(id, ev)
}

// alarm runs the first due alarm (or the named one) and reschedules it.
func (a *Actor) alarm(cx *goja.Object, only string) (goja.Value, error) {
	t := a.cur.t
	q, args := `SELECT name, at, every, data FROM _alarms WHERE at <= ? AND running = 0 ORDER BY at LIMIT 1`, []any{t.Now}
	if only != "" {
		q, args = `SELECT name, at, every, data FROM _alarms WHERE name = ?`, []any{only}
	}
	rows, err := t.Query(store.CallerKernel, q, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	row := rows[0]
	name := fmt.Sprint(row["name"])
	at := toInt(row["at"])
	a.cur.ev.name = name
	late := false
	if spec, ok := row["every"].(string); ok && spec != "" {
		next, err := nextTime(spec, time.UnixMilli(t.Now))
		if err != nil {
			return nil, err
		}
		// Late: it should have fired more than a period ago (missed while down).
		late = t.Now-at > max(60_000, next.UnixMilli()-t.Now)
		if _, err := t.Exec(store.CallerKernel, `UPDATE _alarms SET at = ? WHERE name = ?`, next.UnixMilli(), name); err != nil {
			return nil, err
		}
	} else if _, err := t.Exec(store.CallerKernel, `DELETE FROM _alarms WHERE name = ?`, name); err != nil {
		return nil, err
	}
	_ = cx.Set("event", a.toJS(map[string]any{"kind": "alarm", "name": name, "late": late}))
	f := a.fn("every", name)
	if f == nil {
		f = a.fn("alarms", name)
	}
	if f == nil {
		a.log("warn", "alarm "+name+" has no handler")
		return nil, nil
	}
	data := goja.Undefined()
	if s, ok := row["data"].(string); ok && s != "" && s != "null" {
		var x any
		if json.Unmarshal([]byte(s), &x) == nil {
			data = a.vm.ToValue(x)
		}
	}
	// Queue the next due alarm, if any, as its own event.
	if only == "" {
		go func() {
			id := a.st.ID
			rows, err := a.st.ReadQuery(context.Background(), `SELECT count(*) AS n FROM _alarms WHERE at <= ? AND running = 0`, time.Now().UnixMilli())
			if err == nil && len(rows) > 0 && toInt(rows[0]["n"]) > 0 {
				_ = a.m.Fire(context.Background(), id, "")
			}
		}()
	}
	return f(goja.Undefined(), cx, data)
}

func sha256hex(b []byte) string {
	return fmt.Sprintf("%x", sha256sum(b))
}
