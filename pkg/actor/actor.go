// Package actor runs a store's server half: actor.js on goja, one runtime
// per active store, owned by one goroutine that takes events from the
// store's inbox.
// Every event is a turn (one store transaction). An await on real I/O ends
// the turn: the I/O finishes on another goroutine, which posts a
// continuation event; that event's turn resolves the promise, and goja runs
// the code after the await inside the new transaction.
package actor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Limits of one actor.
var (
	TurnLimit   = 5 * time.Second  // a turn's JavaScript is interrupted after this
	IdleTimeout = 60 * time.Second // an actor without events is retired
	CallTimeout = 60 * time.Second // how long a caller waits for an awaited result
)

// Visitor is who an event acts for, as ctx.visitor shows them.
type Visitor struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Audience   string   `json:"audience"`
	Level      string   `json:"level"`
	Guest      bool     `json:"guest"`
	Subscribed bool     `json:"subscribed"`
	LLM        *llm.LLM `json:"llm,omitempty"`
	// Payer is who an LLM call is charged to: the visitor when they are a
	// person, the store's owner for alarms and reactors (guide §9.2).
	Payer string `json:"-"`
	// Scopes are the token's scopes when the visitor came with a token
	// (nil for sessions): trusted modules act with them, no more.
	Scopes []string `json:"-"`
	// View is the page's view when the event came from one: approvals of
	// governance calls are per view.
	View string `json:"-"`
}

// Error is an actor failure with a code (permission_denied, actor_error…).
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Confirm string `json:"confirm,omitempty"` // confirmation_required: the confirmation's id
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func fail(code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

type result struct {
	v   any
	err error
}

// event is one thing for the actor to do in a turn.
type event struct {
	kind    string // action http alarm reactor cont
	name    string
	visitor Visitor
	via     string
	late    bool
	// run calls into JavaScript inside the turn; its value may be a promise.
	run    func(a *Actor, ctx *goja.Object) (goja.Value, error)
	reply  chan result
	park   *park       // set (on the actor's goroutine) when the handler awaits I/O
	parent *event      // a continuation resumes this event's handler
	owner  *Actor      // a continuation's runtime: no other actor can resume it
	gone   atomic.Bool // its caller stopped waiting: do not run it
}

// park is an event whose handler awaits real I/O: its root promise settles
// in a later turn.
type park struct {
	root *goja.Promise
	ev   *event
	ctx  *goja.Object
}

// turn is the turn in progress.
type turn struct {
	t      *store.Turn
	ev     *event
	out    []func() // released after the commit: room messages, replies
	rev    int64    // the store's rev when the turn began
	alarms bool     // _alarms changed: refresh the schedule after the commit
	view   *rt.View // the turn as a view of the store by its visitor (dbView)
}

// Actor is one store's running actor.
type Actor struct {
	m   *Manager
	st  *store.Store
	run kernel.Running
	key string // app@n it was built from

	vm  *goja.Runtime
	def *goja.Object
	// groups and routes are the definition's shape as Go data, read once at
	// build: other goroutines (callers, the commit and system-log
	// followers) consult them; only the actor's goroutine touches def.
	groups map[string][]string
	routes map[string]Route
	// requires is the level each action needs, checked by the kernel
	// before the action runs (SLOP3-007 phase 3); undeclared lists the
	// actions that declare none, which need admin.
	requires   map[string]rt.Level
	undeclared []string

	storage goja.Value // use('storage'), built on first use (storage.go)

	wake  chan struct{} // capacity 1: the store's inbox has something
	stop  chan struct{}
	cur   *turn
	parks int

	mu        sync.Mutex
	crashes   []time.Time
	reactor   bool // a reactor event is queued
	sysQueued bool // a system reactor event is queued
}

// LogLine is one line of an actor's log.
type LogLine struct {
	At    int64  `json:"at"`
	Level string `json:"level"`
	Text  string `json:"text"`
}

// log keeps a line in the manager, so the log outlives the runtime (an
// idle retire, a crash, a restart).
func (a *Actor) log(level, text string) {
	a.m.log(a.run.Store, level, text)
}

// build makes the runtime: it runs the app's actor.js, which must call
// defineActor once.
func build(m *Manager, st *store.Store, run kernel.Running, files map[string][]byte) (*Actor, error) {
	a := &Actor{m: m, st: st, run: run, key: run.App + "@" + strconv.FormatInt(run.N, 10),
		vm: goja.New(), wake: make(chan struct{}, 1), stop: make(chan struct{})}
	a.vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
	entry := run.Manifest.Actor
	src, ok := files[entry]
	if !ok {
		return nil, fail("actor_error", "%s is not in %s", entry, a.key)
	}
	g := a.vm.GlobalObject()
	_ = g.Set("defineActor", func(call goja.FunctionCall) goja.Value {
		obj, ok := call.Argument(0).(*goja.Object)
		if !ok {
			panic(a.vm.NewTypeError("defineActor takes an object"))
		}
		a.def = obj
		return goja.Undefined()
	})
	_ = g.Set("use", func(name string) goja.Value { return a.module(name) })
	_ = g.Set("require", a.requirer(files, entry))
	console := a.vm.NewObject()
	for _, lv := range []string{"log", "info", "warn", "error", "debug"} {
		lv := lv
		_ = console.Set(lv, func(call goja.FunctionCall) goja.Value {
			a.log(lv, joinArgs(a.vm, call.Arguments))
			return goja.Undefined()
		})
	}
	_ = g.Set("console", console)
	_ = g.Set("__slopNow", func() int64 {
		if a.cur != nil {
			return a.cur.t.Now
		}
		return time.Now().UnixMilli()
	})
	if _, err := a.vm.RunString(`Date.now = function () { return __slopNow(); };`); err != nil {
		return nil, err
	}
	timer := time.AfterFunc(TurnLimit, func() { a.vm.Interrupt("actor.js took too long to load") })
	_, err := a.vm.RunScript(entry, string(src))
	timer.Stop()
	a.vm.ClearInterrupt()
	if err != nil {
		return nil, fail("actor_error", "%s: %v", entry, err)
	}
	if a.def == nil {
		return nil, fail("actor_error", "%s did not call defineActor", entry)
	}
	if err := a.readShape(); err != nil {
		return nil, fail("actor_error", "%s: %v", entry, err)
	}
	return a, nil
}

// readShape copies the definition's group keys and route options to Go.
func (a *Actor) readShape() error {
	a.groups, a.routes = map[string][]string{}, map[string]Route{}
	for _, group := range []string{"actions", "on", "every", "alarms", "http"} {
		if obj, ok := a.def.Get(group).(*goja.Object); ok {
			a.groups[group] = obj.Keys()
		}
	}
	// Each action's requires: { requires: 'view' | 'interact' | 'admin' |
	// 'owner', run }. A plain function, or an object without requires,
	// needs admin: an action fails closed (decision 4, amended).
	a.requires, a.undeclared = map[string]rt.Level{}, nil
	actions, _ := a.def.Get("actions").(*goja.Object)
	for _, name := range a.groups["actions"] {
		need, declared := rt.LevelAdmin, false
		if o, ok := actions.Get(name).(*goja.Object); ok {
			if _, isFn := goja.AssertFunction(o); !isFn {
				if v := o.Get("requires"); v != nil && !goja.IsUndefined(v) {
					l, ok := rt.ParseLevel(v.String())
					if !ok || l == rt.LevelNone || l == rt.LevelSelf {
						return fmt.Errorf("action %s requires %q: use view, interact, admin or owner", name, v.String())
					}
					need, declared = l, true
				}
			}
		}
		a.requires[name] = need
		if !declared {
			a.undeclared = append(a.undeclared, name)
		}
	}
	routes, _ := a.def.Get("http").(*goja.Object)
	for _, key := range a.groups["http"] {
		r := Route{Key: key, Level: "view"}
		if o, ok := routes.Get(key).(*goja.Object); ok {
			if v := o.Get("level"); v != nil && !goja.IsUndefined(v) {
				r.Level = v.String()
			}
			if v := o.Get("audience"); v != nil && !goja.IsUndefined(v) {
				r.Audience = v.String()
			}
		}
		a.routes[key] = r
	}
	return nil
}

// requirer gives actor.js CommonJS require of other .js files in its tree.
func (a *Actor) requirer(files map[string][]byte, entry string) func(string) goja.Value {
	cache := map[string]goja.Value{}
	var req func(from, name string) goja.Value
	req = func(from, name string) goja.Value {
		p := name
		if strings.HasPrefix(name, "./") || strings.HasPrefix(name, "../") {
			dir := from[:strings.LastIndex(from, "/")+1]
			p = cleanPath(dir + name)
		}
		if !strings.HasSuffix(p, ".js") && !strings.HasSuffix(p, ".json") {
			p += ".js"
		}
		if v, ok := cache[p]; ok {
			return v
		}
		src, ok := files[p]
		if !ok {
			panic(a.vm.NewGoError(fmt.Errorf("require: no %s in the app", p)))
		}
		if strings.HasSuffix(p, ".json") {
			v, err := a.vm.RunString("(" + string(src) + ")")
			if err != nil {
				panic(err)
			}
			cache[p] = v
			return v
		}
		fn, err := a.vm.RunScript(p, "(function (module, exports, require) {"+string(src)+"\n})")
		if err != nil {
			panic(err)
		}
		call, _ := goja.AssertFunction(fn)
		module := a.vm.NewObject()
		exports := a.vm.NewObject()
		_ = module.Set("exports", exports)
		cache[p] = exports
		local := func(n string) goja.Value { return req(p, n) }
		if _, err := call(goja.Undefined(), module, exports, a.vm.ToValue(local)); err != nil {
			panic(err)
		}
		cache[p] = module.Get("exports")
		return cache[p]
	}
	return func(name string) goja.Value { return req(entry, name) }
}

func cleanPath(p string) string {
	out := []string{}
	for _, s := range strings.Split(p, "/") {
		switch s {
		case "", ".":
		case "..":
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
		default:
			out = append(out, s)
		}
	}
	return strings.Join(out, "/")
}

// loop is the actor's goroutine: one event at a time, from the store's
// inbox, until the actor no longer runs the store.
func (a *Actor) loop() {
	idle := time.NewTimer(IdleTimeout)
	defer idle.Stop()
	for {
		ev, ok := a.m.take(a)
		if !ok {
			return // replaced, retired or stopped: the queue stays with the store
		}
		if ev == nil {
			select {
			case <-a.wake:
			case <-idle.C:
				if a.parks == 0 && a.m.retire(a) {
					return
				}
				idle.Reset(IdleTimeout)
			case <-a.stop:
				return
			}
			continue
		}
		switch {
		case ev.gone.Load():
		case ev.owner != nil && ev.owner != a:
			// the rest of a handler that awaited I/O in a runtime that stopped
			if ev.parent != nil && ev.parent.reply != nil {
				ev.parent.reply <- result{err: fail("actor_error", "lost: the actor stopped")}
			}
		default:
			a.handle(ev)
		}
		if !idle.Stop() {
			select {
			case <-idle.C:
			default:
			}
		}
		idle.Reset(IdleTimeout)
	}
}

// handle runs one event as one turn.
func (a *Actor) handle(ev *event) {
	ctx := context.Background()
	who := store.Who{ID: ev.visitor.ID, Via: ev.via, Level: ev.visitor.Level, App: a.key}
	var pk *park
	if ev.parent != nil {
		pk = ev.parent.park // nil: nobody awaits this I/O
	}
	var val goja.Value
	cur := &turn{ev: ev}
	var ctxObj *goja.Object
	_, err := a.st.Do(ctx, who, func(t *store.Turn) error {
		cur.t, cur.rev = t, t.Rev-1
		a.cur = cur
		defer func() { a.cur = nil }()
		if pk != nil {
			ctxObj = pk.ctx
		} else if ev.parent == nil {
			ctxObj = a.ctxObject(ev)
		}
		timer := time.AfterFunc(TurnLimit, func() { a.vm.Interrupt("turn took longer than " + TurnLimit.String()) })
		defer func() {
			timer.Stop()
			a.vm.ClearInterrupt()
		}()
		v, err := ev.run(a, ctxObj)
		if err != nil {
			return err
		}
		val = v
		// A handler that threw after an await of something already
		// resolved: its promise is rejected now, so this turn rolls back.
		root := pk.rootOr(v)
		if root != nil && root.State() == goja.PromiseStateRejected {
			return a.jsError(root.Result())
		}
		return nil
	})
	if err != nil {
		var ie *goja.InterruptedError
		if errors.As(err, &ie) || strings.Contains(err.Error(), "turn panicked") {
			a.crashed()
		}
		target := ev
		if pk != nil {
			target = pk.ev
			a.parks--
		}
		if target.reply != nil {
			target.reply <- result{err: a.asError(err)}
		} else {
			// Nobody waits for a reactor or an alarm: the log is where
			// its failure shows. Its turn rolled back and will be retried.
			what := target.kind
			if target.name != "" {
				what += " " + target.name
			}
			a.log("error", what+" failed: "+a.asError(err).Message)
		}
		a.m.afterTurn(a, cur)
		return
	}
	for _, f := range cur.out {
		f()
	}
	a.m.afterTurn(a, cur)
	// Settle, or park.
	root := pk.rootOr(val)
	target := ev
	if pk != nil {
		target = pk.ev
	}
	switch {
	case root == nil:
		if target.reply != nil {
			target.reply <- result{v: a.export(val)}
		}
	case root.State() == goja.PromiseStatePending:
		if pk == nil {
			a.parks++
			target.park = &park{root: root, ev: target, ctx: ctxObj}
		}
	default:
		if pk != nil {
			a.parks--
		}
		if target.reply != nil {
			if root.State() == goja.PromiseStateFulfilled {
				target.reply <- result{v: a.export(root.Result())}
			} else {
				target.reply <- result{err: a.jsError(root.Result())}
			}
		}
	}
}

func (pk *park) rootOr(v goja.Value) *goja.Promise {
	if pk != nil {
		return pk.root
	}
	if v == nil {
		return nil
	}
	if p, ok := v.Export().(*goja.Promise); ok {
		return p
	}
	return nil
}

// continueWith posts the turn that resumes a parked handler: resolve runs
// (inside that turn) the JavaScript after the await.
func (a *Actor) continueWith(ev *event, resolve func() error) {
	_ = a.m.push(a.st.ID, &event{kind: "cont", visitor: ev.visitor, via: ev.via, parent: ev, owner: a,
		run: func(a *Actor, _ *goja.Object) (goja.Value, error) { return nil, resolve() }})
}

// io starts real I/O from inside a turn and returns its promise. work runs
// on its own goroutine; settle runs in the continuation turn.
func (a *Actor) io(work func() (any, error), settle func(v any) (goja.Value, error)) goja.Value {
	if a.cur == nil {
		panic(a.vm.NewTypeError("I/O is only possible while handling an event"))
	}
	p, resolve, reject := a.vm.NewPromise()
	ev := a.cur.ev
	if ev.parent != nil {
		ev = ev.parent
	}
	go func() {
		v, err := work()
		a.continueWith(ev, func() error {
			if err != nil {
				return reject(a.errValue(a.asError(err)))
			}
			out, err := settle(v)
			if err != nil {
				return reject(a.errValue(a.asError(err)))
			}
			return resolve(out)
		})
	}()
	return a.vm.ToValue(p)
}

func (a *Actor) crashed() {
	now := time.Now()
	a.mu.Lock()
	a.crashes = append(a.crashes, now)
	recent := 0
	for _, t := range a.crashes {
		if now.Sub(t) < time.Minute {
			recent++
		}
	}
	a.mu.Unlock()
	if recent >= 3 {
		a.m.markBroken(a, "3 crashed turns in a minute")
	}
}

// ctxObject is the ctx a handler receives.
func (a *Actor) ctxObject(ev *event) *goja.Object {
	vm := a.vm
	o := vm.NewObject()
	vis := a.toJS(ev.visitor)
	_ = o.Set("visitor", vis)
	_ = o.Set("principal", vis) // the lab's name for it
	_ = o.Set("store", a.toJS(map[string]any{"id": a.st.ID, "type": a.st.Meta("type")}))
	_ = o.Set("app", a.toJS(map[string]any{"id": a.run.App, "version": a.run.N}))
	_ = o.Set("event", a.toJS(map[string]any{"kind": ev.kind, "name": ev.name, "late": ev.late}))
	// ctx.storage, as a Durable Object's state.storage (storage.go).
	_ = o.DefineAccessorProperty("storage", vm.ToValue(func() goja.Value { return a.storageModule() }), nil, goja.FLAG_FALSE, goja.FLAG_TRUE)
	_ = o.DefineAccessorProperty("now", vm.ToValue(func() int64 {
		if a.cur != nil {
			return a.cur.t.Now
		}
		return time.Now().UnixMilli()
	}), nil, goja.FLAG_FALSE, goja.FLAG_TRUE)
	_ = o.DefineAccessorProperty("rev", vm.ToValue(func() int64 {
		if a.cur != nil {
			return a.cur.rev
		}
		return a.st.Head()
	}), nil, goja.FLAG_FALSE, goja.FLAG_TRUE)
	_ = o.Set("need", func(level string) goja.Value {
		need, ok := rt.ParseLevel(level)
		have, _ := rt.ParseLevel(ev.visitor.Level)
		if !ok {
			a.throw(fail("invalid_argument", "unknown level %q", level))
		}
		if have < need {
			a.throw(fail("permission_denied", "this needs %s; you have %s", level, orNone(ev.visitor.Level)))
		}
		return goja.Undefined()
	})
	_ = o.Set("needAudience", func(aud string) goja.Value {
		if !sysdb.InGroup(ev.visitor.Audience, aud) {
			a.throw(fail("audience_required", "this is for %ss", aud))
		}
		return goja.Undefined()
	})
	_ = o.Set("fail", func(code, msg string) goja.Value {
		a.throw(fail(code, "%s", msg))
		return goja.Undefined()
	})
	_ = o.Set("log", func(call goja.FunctionCall) goja.Value {
		a.log("log", joinArgs(vm, call.Arguments))
		return goja.Undefined()
	})
	return o
}

func orNone(s string) string {
	if s == "" {
		return "none"
	}
	return s
}

// throw raises an Error as a JS exception with .code.
func (a *Actor) throw(e *Error) {
	panic(a.errValue(e))
}

func (a *Actor) errValue(e *Error) goja.Value {
	obj, err := a.vm.New(a.vm.Get("Error"), a.vm.ToValue(e.Message))
	if err != nil {
		return a.vm.ToValue(e.Error())
	}
	_ = obj.Set("code", e.Code)
	if e.Confirm != "" {
		_ = obj.Set("confirm", e.Confirm)
	}
	return obj
}

// jsError turns a thrown JS value into an Error, keeping its .code.
func (a *Actor) jsError(v goja.Value) *Error {
	if obj, ok := v.(*goja.Object); ok {
		msg := ""
		if m := obj.Get("message"); m != nil {
			msg = m.String()
		}
		if c := obj.Get("code"); c != nil && !goja.IsUndefined(c) && c.String() != "" {
			e := &Error{Code: c.String(), Message: msg}
			if cf := obj.Get("confirm"); cf != nil && !goja.IsUndefined(cf) {
				e.Confirm = cf.String()
			}
			return e
		}
		if msg != "" {
			return &Error{Code: "actor_error", Message: msg}
		}
	}
	return &Error{Code: "actor_error", Message: v.String()}
}

// asError converts any error from a turn into an *Error.
func (a *Actor) asError(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	var ex *goja.Exception
	if errors.As(err, &ex) {
		e := a.jsError(ex.Value())
		if e.Code == "actor_error" {
			e.Message = ex.Error()
		}
		return e
	}
	var ie *goja.InterruptedError
	if errors.As(err, &ie) {
		return fail("actor_error", "%v", ie.Value())
	}
	if errors.Is(err, store.ErrAppCode) {
		return fail("permission_denied", "%v", err)
	}
	var de *store.DocError
	if errors.As(err, &de) {
		return fail("invalid_argument", "%s", de.Msg)
	}
	return fail("actor_error", "%v", err)
}

// toJS converts Go data to plain JS data through JSON.
func (a *Actor) toJS(v any) goja.Value {
	if v == nil {
		return goja.Null()
	}
	b, err := json.Marshal(v)
	if err != nil {
		return goja.Null()
	}
	// JSON.parse makes native objects and arrays: values wrapped from Go
	// maps and slices would not keep in-place changes (push on a nested
	// array would be lost when the object is written back).
	parse, ok := goja.AssertFunction(a.vm.Get("JSON").ToObject(a.vm).Get("parse"))
	if !ok {
		return goja.Null()
	}
	out, err := parse(goja.Undefined(), a.vm.ToValue(string(b)))
	if err != nil {
		return goja.Null()
	}
	return out
}

// export converts a JS value to JSON data (JSON.stringify's rules).
func (a *Actor) export(v goja.Value) any {
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return nil
	}
	if p, ok := v.Export().(*goja.Promise); ok {
		return a.export(p.Result())
	}
	j := a.vm.Get("JSON").ToObject(a.vm)
	stringify, _ := goja.AssertFunction(j.Get("stringify"))
	s, err := stringify(j, v)
	if err != nil || goja.IsUndefined(s) {
		return nil
	}
	var out any
	dec := json.NewDecoder(strings.NewReader(s.String()))
	dec.UseNumber()
	if dec.Decode(&out) != nil {
		return nil
	}
	return out
}

// fromJS converts a JS argument to plain Go data (numbers as json.Number).
func (a *Actor) fromJS(v goja.Value) any {
	return a.export(v)
}

func joinArgs(vm *goja.Runtime, args []goja.Value) string {
	parts := make([]string, len(args))
	for i, v := range args {
		if obj, ok := v.(*goja.Object); ok && obj.ClassName() != "Error" {
			j := vm.Get("JSON").ToObject(vm)
			stringify, _ := goja.AssertFunction(j.Get("stringify"))
			if s, err := stringify(j, v); err == nil && !goja.IsUndefined(s) {
				parts[i] = s.String()
				continue
			}
		}
		parts[i] = v.String()
	}
	return strings.Join(parts, " ")
}

// fn returns def.<group>.<name> (or def.<group> when name is "") as a
// function, or nil.
func (a *Actor) fn(group, name string) goja.Callable {
	v := a.def.Get(group)
	if v == nil || goja.IsUndefined(v) {
		return nil
	}
	if name != "" {
		obj, ok := v.(*goja.Object)
		if !ok {
			return nil
		}
		v = obj.Get(name)
		if v == nil {
			return nil
		}
		if o, ok := v.(*goja.Object); ok {
			if run := o.Get("run"); run != nil {
				if f, ok := goja.AssertFunction(run); ok {
					return f
				}
			}
		}
	}
	f, _ := goja.AssertFunction(v)
	return f
}

// keys lists the own keys of def.<group> (any goroutine).
func (a *Actor) keys(group string) []string { return a.groups[group] }

// send queues an event on the store's inbox and waits for its result. If
// the actor stops meanwhile (a new version, a restart, an idle retire), the
// event stays queued for the actor that replaces it: it is never sent
// twice.
func (a *Actor) send(ctx context.Context, ev *event) (any, error) {
	ev.reply = make(chan result, 1)
	ctx, cancel := context.WithTimeout(ctx, CallTimeout)
	defer cancel()
	if err := a.m.push(a.st.ID, ev); err != nil {
		return nil, err
	}
	for cur := a; ; {
		select {
		case r := <-ev.reply:
			return r.v, r.err
		case <-ctx.Done():
			ev.gone.Store(true)
			return nil, fail("unavailable", "the actor did not answer in time")
		case <-cur.stop:
			next, err := a.m.Get(ctx, a.st.ID)
			if err == nil && next == nil {
				err = fail("not_found", "%s has no actor", a.st.ID)
			}
			if err != nil {
				ev.gone.Store(true)
				return nil, err
			}
			cur = next
		}
	}
}
