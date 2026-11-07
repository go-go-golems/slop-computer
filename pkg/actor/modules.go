package actor

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/apps"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// module is use(name): the catalog of what actors can reach. A module the
// app may not use is null, as the contract requires of undeclared
// capabilities.
func (a *Actor) module(name string) goja.Value {
	switch name {
	case "sql":
		return a.sqlModule()
	case "db":
		return a.dbModule()
	case "files":
		return a.filesModule()
	case "alarm":
		return a.alarmModule()
	case "storage":
		return a.storageModule()
	case "time":
		return a.timeModule()
	case "log":
		return a.logModule()
	case "stores":
		return a.storesModule()
	// Policy capabilities: use() runs before any visitor exists, so it is
	// null only when the app does not declare the capability or the policy
	// allows it for no audience; each call checks the turn's visitor.
	case "fetch":
		if len(a.run.Manifest.Slop.Fetch) > 0 && a.m.allowedAny(a, "fetch") {
			return a.fetchModule()
		}
	case "secrets":
		if len(a.run.Manifest.Slop.Secrets) > 0 && a.m.allowedAny(a, "secrets") {
			return a.secretsModule()
		}
	default:
		if load, ok := a.m.provided[name]; ok {
			if v := load(a); v != nil {
				return v
			}
			return goja.Null()
		}
		if mod, ok := a.m.modules[name]; ok {
			return a.catalogModule(mod)
		}
	}
	return goja.Null()
}

// Turn returns the turn in progress (for modules provided by other
// packages), or throws.
func (a *Actor) Turn() *store.Turn { return a.turn().t }

// VM is the actor's runtime (for modules provided by other packages).
func (a *Actor) VM() *goja.Runtime { return a.vm }

// Store is the actor's store.
func (a *Actor) Store() *store.Store { return a.st }

// App is the app the actor runs.
func (a *Actor) App() string { return a.run.App }

// Manifest is the manifest of the running app version.
func (a *Actor) Manifest() *apps.Manifest { return a.run.Manifest }

// Need throws permission_denied unless this turn's visitor may use a
// policy capability.
func (a *Actor) Need(capability string) { a.need(capability) }

// IO starts real I/O; see io.
func (a *Actor) IO(work func() (any, error), settle func(v any) (goja.Value, error)) goja.Value {
	return a.io(work, settle)
}

// Later is for a module whose work, on its own goroutine, must come back to
// JavaScript more than once (actor sample's tools). Called inside a turn, it
// returns run, which posts fn as a new turn of the event in progress, a
// continuation as an awaited I/O's is: fn's writes commit with that turn.
// If fn fails (an error, a throw, a panic, the turn limit) the turn rolls
// back and failed gets the error, while the handler stays parked. run may
// be called from any goroutine, any number of times.
func (a *Actor) Later() func(fn func() error, failed func(error)) {
	ev := a.turn().ev
	if ev.parent != nil {
		ev = ev.parent
	}
	return func(fn func() error, failed func(error)) {
		_ = a.m.push(a.st.ID, &event{kind: "cont", visitor: ev.visitor, via: ev.via, parent: ev, owner: a, failed: failed,
			run: func(*Actor, *goja.Object) (goja.Value, error) { return nil, fn() }})
	}
}

// Visitor is the visitor of the event in progress.
func (a *Actor) Visitor() Visitor {
	t := a.turn()
	if t.ev.parent != nil {
		return t.ev.parent.visitor
	}
	return t.ev.visitor
}

// Throw raises an error with a code in JavaScript.
func (a *Actor) Throw(code, msg string) { a.throw(fail(code, "%s", msg)) }

// ThrowError raises an Error (with its confirmation id) in JavaScript.
func (a *Actor) ThrowError(e *Error) { a.throw(e) }

// Allowed checks a policy capability for the current turn's visitor (for
// alarms and reactors, the store itself).
func (a *Actor) Allowed(capability string) bool { return a.m.allowed(a, capability) }

// AllowedAny reports whether the policy allows a capability for any
// audience (what use() can know before a visitor exists).
func (a *Actor) AllowedAny(capability string) bool { return a.m.allowedAny(a, capability) }

// AfterCommit runs fn once the turn in progress commits (output such as a
// room message must not leave a turn that rolls back).
func (a *Actor) AfterCommit(fn func()) {
	t := a.turn()
	t.out = append(t.out, fn)
}

// ToJS converts Go data to JS data.
func (a *Actor) ToJS(v any) goja.Value { return a.toJS(v) }

// FromJS converts JS data to Go data.
func (a *Actor) FromJS(v goja.Value) any { return a.fromJS(v) }

func (a *Actor) turn() *turn {
	if a.cur == nil {
		panic(a.vm.NewTypeError("this works only while the actor handles an event"))
	}
	return a.cur
}

func (a *Actor) check(err error) {
	if err != nil {
		a.throw(a.asError(err))
	}
}

func (a *Actor) params(args []goja.Value) []any {
	out := make([]any, len(args))
	for i, v := range args {
		x := a.fromJS(v)
		switch n := x.(type) {
		case json.Number:
			if iv, err := n.Int64(); err == nil {
				x = iv
			} else {
				x, _ = n.Float64()
			}
		case bool:
			if n {
				x = 1
			} else {
				x = 0
			}
		case map[string]any, []any:
			b, _ := json.Marshal(n)
			x = string(b)
		}
		out[i] = x
	}
	return out
}

// --- sql -----------------------------------------------------------------

func (a *Actor) sqlModule() goja.Value {
	o := a.vm.NewObject()
	sp := 0
	_ = o.Set("all", func(call goja.FunctionCall) goja.Value {
		rows, err := a.turn().t.Query(store.CallerActor, call.Argument(0).String(), a.params(call.Arguments[1:])...)
		a.check(err)
		return a.toJS(rows)
	})
	_ = o.Set("one", func(call goja.FunctionCall) goja.Value {
		rows, err := a.turn().t.Query(store.CallerActor, call.Argument(0).String(), a.params(call.Arguments[1:])...)
		a.check(err)
		if len(rows) == 0 {
			return goja.Null()
		}
		return a.toJS(rows[0])
	})
	_ = o.Set("run", func(call goja.FunctionCall) goja.Value {
		res, err := a.turn().t.Exec(store.CallerActor, call.Argument(0).String(), a.params(call.Arguments[1:])...)
		a.check(err)
		n, _ := res.RowsAffected()
		id, _ := res.LastInsertId()
		return a.toJS(map[string]any{"changes": n, "lastRowid": id})
	})
	_ = o.Set("transaction", func(fn goja.Callable) goja.Value {
		t := a.turn().t
		sp++
		name := "sp" + strconv.Itoa(sp)
		_, err := t.Exec(store.CallerActor, "SAVEPOINT "+name)
		a.check(err)
		v, err := fn(goja.Undefined())
		if err != nil {
			_, _ = t.Exec(store.CallerActor, "ROLLBACK TO "+name)
			_, _ = t.Exec(store.CallerActor, "RELEASE "+name)
			panic(err)
		}
		_, err = t.Exec(store.CallerActor, "RELEASE "+name)
		a.check(err)
		return v
	})
	return o
}

// --- db ------------------------------------------------------------------

func (a *Actor) snap(d store.Doc, exists bool, path string) goja.Value {
	o := a.vm.NewObject()
	_ = o.Set("exists", exists)
	_ = o.Set("path", path)
	_ = o.Set("id", rt.IDOf(path))
	_ = o.Set("version", d.Version)
	body := a.toJS(d.Body)
	if !exists {
		body = goja.Undefined()
	}
	_ = o.Set("data", func() goja.Value { return body })
	return o
}

// Paths serves an actor's db paths that are not its own store's (SLOP3-009
// step 4): its store's aliases and _stores, resolved through the same
// rt.Space as its pages' (pkg/caps/db implements it). The actor reads them
// as the event's visitor: what that person could read through a page of
// this app, no more. An alarm or a reactor has no visitor and reads as
// nobody.
type Paths interface {
	Space(ctx context.Context, storeID string, caps rt.Caps, stores bool) *rt.Space
	Get(ctx context.Context, v *rt.View, path string) (rt.Doc, bool, error)
	Query(ctx context.Context, v *rt.View, q rt.Query) ([]rt.Doc, error)
}

// dbView is the turn in progress as a view of the store by its visitor,
// with the store's path space: built once per turn, on the first db call.
func (a *Actor) dbView() *rt.View {
	t := a.turn()
	if t.view != nil {
		return t.view
	}
	vis := a.Visitor()
	level, _ := rt.ParseLevel(vis.Level)
	var caps rt.Caps
	if a.run.Manifest != nil {
		caps = a.run.Manifest.Caps
	}
	v := &rt.View{Target: a.st.ID, App: a.run.App, User: vis.ID, Role: vis.Audience, Level: level, Caps: caps, Kind: rt.KindActor}
	if a.m.Paths != nil {
		v.Space = a.m.Paths.Space(t.t.Context(), a.st.ID, caps, a.m.allowed(a, "stores"))
	}
	t.view = v
	return v
}

// resolve maps a db path of the actor to its target; true (hidden) for
// another store's private documents: reads find nothing, writes are
// refused.
func (a *Actor) resolve(path string, doc bool) (rt.Target, bool) {
	v := a.dbView()
	tgt, err := v.Space.Resolve(path, doc)
	var pe *rt.PathError
	if errors.As(err, &pe) {
		if pe.Code == "not_found" {
			return rt.Target{}, true
		}
		a.throw(fail(pe.Code, "%s", pe.Msg))
	}
	if tgt.Store == "" && !tgt.Registry {
		tgt.Store, tgt.Own = a.st.ID, true
	}
	return tgt, false
}

// ownPath is the path in the actor's store that a write of path writes:
// one write writes one store, the actor's own, so a path in another store
// (an alias, _stores) is refused.
func (a *Actor) ownPath(path string) string {
	a.noOpenTransaction("documents")
	tgt, hidden := a.resolve(path, true)
	if hidden || !tgt.Own {
		a.throw(fail("permission_denied", "%s is in another store: an actor writes only its own (call that store's action through use('stores'))", path))
	}
	return tgt.Path
}

func (a *Actor) dbModule() goja.Value {
	o := a.vm.NewObject()
	_ = o.Set("doc", func(path string) goja.Value {
		d := a.vm.NewObject()
		_ = d.Set("path", path)
		_ = d.Set("get", func() goja.Value {
			tgt, hidden := a.resolve(path, true)
			switch {
			case hidden:
				return a.snap(store.Doc{}, false, path)
			case tgt.Own:
				doc, err := a.turn().t.GetDoc(tgt.Path)
				if err != nil {
					return a.snap(store.Doc{}, false, path)
				}
				return a.snap(doc, true, path)
			case a.m.Paths == nil:
				return a.snap(store.Doc{}, false, path)
			}
			doc, ok, err := a.m.Paths.Get(a.turn().t.Context(), a.dbView(), path)
			a.check(err)
			return a.snap(store.Doc{Path: path, Body: doc.Body, Version: doc.Version}, ok, path)
		})
		_ = d.Set("set", func(v goja.Value) goja.Value {
			body, _ := a.fromJS(v).(map[string]any)
			ver, err := a.turn().t.SetDoc(a.ownPath(path), body, 0)
			a.check(err)
			return a.vm.ToValue(ver)
		})
		_ = d.Set("update", func(v goja.Value) goja.Value {
			body, _ := a.fromJS(v).(map[string]any)
			ver, err := a.turn().t.UpdateDoc(a.ownPath(path), body)
			a.check(err)
			return a.vm.ToValue(ver)
		})
		_ = d.Set("delete", func() goja.Value {
			ok, err := a.turn().t.DeleteDoc(a.ownPath(path))
			a.check(err)
			return a.vm.ToValue(ok)
		})
		return d
	})
	_ = o.Set("collection", func(coll string) goja.Value { return a.query(rt.Query{Coll: coll}) })
	return o
}

// queryDocs runs q (on a collection of the actor's space): in the turn for
// the store's own documents, through Paths for another store's.
func (a *Actor) queryDocs(q rt.Query) []store.Doc {
	tgt, hidden := a.resolve(q.Coll, false)
	switch {
	case hidden || (!tgt.Own && a.m.Paths == nil):
		return nil
	case tgt.Own:
		pageColl := q.Coll
		q.Coll = tgt.Path
		docs, err := a.turn().t.QueryDocs(q, store.Everything)
		a.check(err)
		if tgt.Via != "" { // an alias of the store itself: its page paths
			for i := range docs {
				docs[i].Path = pageColl + "/" + rt.IDOf(docs[i].Path)
			}
		}
		return docs
	}
	if err := q.ValidateShape(); err != nil {
		a.throw(fail("invalid_argument", "invalid query on %q", q.Coll))
	}
	ds, err := a.m.Paths.Query(a.turn().t.Context(), a.dbView(), q)
	a.check(err)
	docs := make([]store.Doc, len(ds))
	for i, d := range ds {
		docs[i] = store.Doc{Path: d.Path, Body: d.Body, Version: d.Version}
	}
	return docs
}

func (a *Actor) query(q rt.Query) goja.Value {
	o := a.vm.NewObject()
	_ = o.Set("where", func(field, op string, value goja.Value) goja.Value {
		n := q
		n.Filters = append(append([]rt.Filter(nil), q.Filters...), rt.Filter{Field: field, Op: op, Value: a.fromJS(value)})
		return a.query(n)
	})
	_ = o.Set("orderBy", func(field string, dir goja.Value) goja.Value {
		n := q
		n.Order, n.Desc = field, !absent(dir) && dir.String() == "desc"
		return a.query(n)
	})
	_ = o.Set("limit", func(k int) goja.Value {
		n := q
		n.Limit = k
		return a.query(n)
	})
	_ = o.Set("get", func() goja.Value {
		docs := a.queryDocs(q)
		snaps := make([]any, len(docs))
		for i, d := range docs {
			snaps[i] = a.snap(d, true, d.Path)
		}
		r := a.vm.NewObject()
		_ = r.Set("docs", a.vm.NewArray(snaps...))
		_ = r.Set("size", len(docs))
		_ = r.Set("empty", len(docs) == 0)
		return r
	})
	return o
}

// --- files ---------------------------------------------------------------

func (a *Actor) filesModule() goja.Value {
	o := a.vm.NewObject()
	find := func(path string, opts goja.Value) store.File {
		zone, at := "tree", ""
		if obj, ok := opts.(*goja.Object); ok && opts != nil {
			if z := obj.Get("zone"); z != nil && !goja.IsUndefined(z) {
				zone = z.String()
			}
			if x := obj.Get("at"); x != nil && !goja.IsUndefined(x) {
				at = x.String()
			}
		}
		ctx := a.turn().t.Context()
		if at != "" {
			n, err := a.st.Ref(ctx, at)
			a.check(err)
			f, err := a.st.SnapshotFile(ctx, n, path)
			a.check(err)
			return f
		}
		f, err := a.st.File(ctx, zone, path)
		a.check(err)
		return f
	}
	_ = o.Set("text", func(path string, opts goja.Value) goja.Value {
		b, err := a.st.ReadFile(find(path, opts))
		a.check(err)
		return a.vm.ToValue(string(b))
	})
	_ = o.Set("read", func(path string, opts goja.Value) goja.Value {
		b, err := a.st.ReadFile(find(path, opts))
		a.check(err)
		return a.vm.ToValue(a.vm.NewArrayBuffer(b))
	})
	_ = o.Set("write", func(path string, data goja.Value, opts goja.Value) goja.Value {
		zone, ctype := "assets", ""
		if obj, ok := opts.(*goja.Object); ok && opts != nil {
			if z := obj.Get("zone"); z != nil && !goja.IsUndefined(z) {
				zone = z.String()
			}
			if c := obj.Get("type"); c != nil && !goja.IsUndefined(c) {
				ctype = c.String()
			}
		}
		var b []byte
		switch x := data.Export().(type) {
		case goja.ArrayBuffer:
			b = x.Bytes()
		case []byte:
			b = x
		default:
			b = []byte(data.String())
		}
		a.noOpenTransaction("files")
		f, err := a.turn().t.PutFile(zone, path, b, ctype)
		a.check(err)
		return a.toJS(f)
	})
	_ = o.Set("list", func(prefix goja.Value, opts goja.Value) goja.Value {
		p := ""
		if !absent(prefix) {
			p = prefix.String()
		}
		zone := "tree"
		if obj, ok := opts.(*goja.Object); ok && opts != nil {
			if z := obj.Get("zone"); z != nil && !goja.IsUndefined(z) {
				zone = z.String()
			}
		}
		fs, err := a.turn().t.ZoneFiles(zone)
		a.check(err)
		out := []store.File{}
		for _, f := range fs {
			if strings.HasPrefix(f.Path, p) {
				out = append(out, f)
			}
		}
		return a.toJS(out)
	})
	_ = o.Set("snapshot", func(opts goja.Value) goja.Value {
		msg := ""
		if obj, ok := opts.(*goja.Object); ok && opts != nil {
			if m := obj.Get("message"); m != nil && !goja.IsUndefined(m) {
				msg = m.String()
			}
		}
		n, err := a.turn().t.Snapshot(msg, "")
		a.check(err)
		return a.vm.ToValue(n)
	})
	return o
}

// --- alarm, time, log ----------------------------------------------------

func (a *Actor) alarmModule() goja.Value {
	o := a.vm.NewObject()
	_ = o.Set("at", func(at int64, name string, data goja.Value) goja.Value {
		t := a.turn()
		raw, _ := json.Marshal(a.fromJS(data))
		_, err := t.t.Exec(store.CallerKernel, `INSERT INTO _alarms (name, at, every, data, running) VALUES (?, ?, NULL, ?, 0)
			ON CONFLICT (name) DO UPDATE SET at = excluded.at, every = NULL, data = excluded.data, running = 0`, name, at, string(raw))
		a.check(err)
		t.alarms = true
		return goja.Undefined()
	})
	_ = o.Set("every", func(name, spec string) goja.Value {
		t := a.turn()
		next, err := nextTime(spec, time.UnixMilli(t.t.Now))
		a.check(err)
		_, err = t.t.Exec(store.CallerKernel, `INSERT INTO _alarms (name, at, every, data, running) VALUES (?, ?, ?, NULL, 0)
			ON CONFLICT (name) DO UPDATE SET at = excluded.at, every = excluded.every`, name, next.UnixMilli(), spec)
		a.check(err)
		t.alarms = true
		return goja.Undefined()
	})
	_ = o.Set("cancel", func(name string) goja.Value {
		t := a.turn()
		_, err := t.t.Exec(store.CallerKernel, `DELETE FROM _alarms WHERE name = ?`, name)
		a.check(err)
		t.alarms = true
		return goja.Undefined()
	})
	_ = o.Set("list", func() goja.Value {
		rows, err := a.turn().t.Query(store.CallerKernel, `SELECT name, at, every, running FROM _alarms ORDER BY at`)
		a.check(err)
		return a.toJS(rows)
	})
	return o
}

func (a *Actor) timeModule() goja.Value {
	o := a.vm.NewObject()
	_ = o.Set("now", func() int64 { return a.turn().t.Now })
	_ = o.Set("sleep", func(ms int64) goja.Value {
		ms = min(max(ms, 0), 24*3600*1000)
		return a.io(func() (any, error) {
			time.Sleep(time.Duration(ms) * time.Millisecond)
			return nil, nil
		}, func(any) (goja.Value, error) { return goja.Undefined(), nil })
	})
	return o
}

func (a *Actor) logModule() goja.Value {
	o := a.vm.NewObject()
	for _, lv := range []string{"info", "warn", "error", "debug"} {
		lv := lv
		_ = o.Set(lv, func(call goja.FunctionCall) goja.Value {
			a.log(lv, joinArgs(a.vm, call.Arguments))
			return goja.Undefined()
		})
	}
	return o
}

// --- stores: read aliases, other actors ----------------------------------

func (a *Actor) storesModule() goja.Value {
	o := a.vm.NewObject()
	_ = o.Set("open", func(alias string) goja.Value {
		t := a.turn()
		ctx := t.t.Context()
		b, err := a.m.K.Registry.BindingOf(ctx, a.st.ID, alias)
		if err != nil {
			a.throw(fail("not_found", "no binding for %q on %s", alias, a.st.ID))
		}
		target := b.Target
		me := &access.Principal{Kind: access.KindStore, Store: a.st.ID}
		// fresh decides again on every call through the handle, in the
		// calling turn (SLOP3-007): a handle kept across turns stops working
		// once the grant to store:<id> is gone. It returns the turn's
		// context, the level, and the target's read rule at that level.
		fresh := func() (context.Context, rt.Level, func(string) bool) {
			cx := a.turn().t.Context()
			d, _, err := a.m.K.Access.Can(cx, me, target, rt.LevelView, "reading", true)
			a.check(err)
			if !d.OK {
				a.throw(fail("permission_denied", "store:%s cannot read %s (grant it view)", a.st.ID, target))
			}
			// the target's read rules hold for a store as for anyone at its level
			rules := a.m.K.Rules(cx, target)
			return cx, d.Level, func(path string) bool { return rules.CanRead(path, me.ID(), d.Level) }
		}
		fresh()
		ts, err := a.m.K.Store(ctx, target)
		a.check(err)
		r := a.vm.NewObject()
		_ = r.Set("id", target)
		docs := a.vm.NewObject()
		_ = docs.Set("get", func(path string) goja.Value {
			ctx, _, may := fresh()
			doc, err := ts.GetDoc(ctx, path, may)
			if err != nil {
				return a.snap(store.Doc{}, false, path)
			}
			return a.snap(doc, true, path)
		})
		_ = docs.Set("query", func(coll string, opts goja.Value) goja.Value {
			ctx, _, may := fresh()
			q := rt.Query{Coll: coll}
			if obj, ok := opts.(*goja.Object); ok && opts != nil {
				b, _ := json.Marshal(a.fromJS(obj))
				_ = json.Unmarshal(b, &q)
				q.Coll = coll
			}
			ds, err := ts.Query(ctx, q, may)
			a.check(err)
			out := make([]any, len(ds))
			for i, d := range ds {
				out[i] = a.snap(d, true, d.Path)
			}
			return a.vm.NewArray(out...)
		})
		_ = r.Set("docs", docs)
		files := a.vm.NewObject()
		_ = files.Set("text", func(path string) goja.Value {
			ctx, _, _ := fresh()
			n, err := ts.Ref(ctx, "main")
			a.check(err)
			f, err := ts.SnapshotFile(ctx, n, path)
			a.check(err)
			b, err := ts.ReadFile(f)
			a.check(err)
			return a.vm.ToValue(string(b))
		})
		_ = files.Set("list", func() goja.Value {
			ctx, _, _ := fresh()
			n, err := ts.Ref(ctx, "main")
			a.check(err)
			fs, err := ts.SnapshotFiles(ctx, n)
			a.check(err)
			return a.toJS(fs)
		})
		_ = r.Set("files", files)
		// assets: the target's uploaded files, described, never read (a
		// route answers {asset: {from, id}} and the server sends the
		// bytes); null unless the binding was set with uploads.
		_ = r.Set("assets", goja.Null())
		if b.Assets {
			desc := func(f store.File) map[string]any {
				return map[string]any{"id": f.Path, "type": f.Type, "size": f.Size, "sha256": f.SHA256}
			}
			assets := a.vm.NewObject()
			_ = assets.Set("get", func(id string) goja.Value {
				ctx, _, _ := fresh()
				f, err := ts.File(ctx, "assets", id)
				if err != nil {
					return goja.Null()
				}
				return a.toJS(desc(f))
			})
			_ = assets.Set("list", func() goja.Value {
				ctx, _, _ := fresh()
				fs, err := ts.Files(ctx, "assets", "")
				a.check(err)
				out := make([]any, len(fs))
				for i, f := range fs {
					out[i] = desc(f)
				}
				return a.toJS(out)
			})
			_ = r.Set("assets", assets)
		}
		// rev is the target's latest rev: whether it changed since a read.
		_ = r.Set("rev", func() int64 { return ts.Head() })
		_ = r.Set("log", func(after int64) goja.Value {
			ctx, _, _ := fresh()
			cs, err := ts.Log(ctx, after, 100)
			a.check(err)
			return a.toJS(cs)
		})
		_ = r.Set("call", func(action string, args goja.Value) goja.Value {
			ctx, lv, _ := fresh()
			payload := a.fromJS(args)
			vis := Visitor{ID: "store:" + a.st.ID, Audience: string(access.AudStore), Level: lv.String()}
			return a.io(func() (any, error) {
				return a.m.Call(ctx, target, action, payload, vis, "store:"+a.st.ID)
			}, func(v any) (goja.Value, error) { return a.toJS(v), nil })
		})
		return r
	})
	return o
}

// --- fetch, secrets --------------------------------------------------------

// fetchRedirect checks every redirect of a fetch as the first request was
// checked: its origin must be in app.json slop.fetch (SLOP3-012 phase 5c).
// Without it, an allowed origin could send the request on to any other,
// internal addresses included.
func (a *Actor) fetchRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return fail("unavailable", "fetch stopped after 10 redirects")
	}
	u := req.URL
	origin := u.Scheme + "://" + u.Host
	if (u.Scheme != "https" && u.Scheme != "http") || !slices.Contains(a.run.Manifest.Slop.Fetch, origin) {
		return fail("permission_denied", "fetch was redirected to %s, which is not in app.json slop.fetch", origin)
	}
	return nil
}

func (a *Actor) fetchModule() goja.Value {
	return a.vm.ToValue(func(raw string, init goja.Value) goja.Value {
		a.need("fetch")
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
			a.throw(fail("invalid_argument", "fetch needs an http(s) URL"))
		}
		origin := u.Scheme + "://" + u.Host
		if !slices.Contains(a.run.Manifest.Slop.Fetch, origin) {
			a.throw(fail("permission_denied", "%s is not in app.json slop.fetch", origin))
		}
		method, body, headers := "GET", "", map[string]string{}
		if obj, ok := init.(*goja.Object); ok && init != nil {
			if m := obj.Get("method"); m != nil && !goja.IsUndefined(m) {
				method = strings.ToUpper(m.String())
			}
			if b := obj.Get("body"); b != nil && !goja.IsUndefined(b) {
				body = b.String()
			}
			if h, ok := obj.Get("headers").(*goja.Object); ok {
				for _, k := range h.Keys() {
					headers[k] = h.Get(k).String()
				}
			}
		}
		type resp struct {
			status  int
			headers map[string]string
			body    []byte
		}
		return a.io(func() (any, error) {
			req, err := http.NewRequest(method, raw, strings.NewReader(body))
			if err != nil {
				return nil, err
			}
			for k, v := range headers {
				req.Header.Set(k, v)
			}
			c := &http.Client{Timeout: 30 * time.Second, CheckRedirect: a.fetchRedirect}
			r, err := c.Do(req)
			var denied *Error
			if errors.As(err, &denied) {
				return nil, denied // a redirect left slop.fetch
			}
			if err != nil {
				return nil, fail("unavailable", "fetch %s: %v", origin, err)
			}
			defer r.Body.Close()
			b, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
			if err != nil {
				return nil, err
			}
			h := map[string]string{}
			for k := range r.Header {
				h[strings.ToLower(k)] = r.Header.Get(k)
			}
			return resp{status: r.StatusCode, headers: h, body: b}, nil
		}, func(v any) (goja.Value, error) {
			rs := v.(resp)
			o := a.vm.NewObject()
			_ = o.Set("status", rs.status)
			_ = o.Set("ok", rs.status >= 200 && rs.status < 300)
			_ = o.Set("headers", a.toJS(rs.headers))
			_ = o.Set("text", func() string { return string(rs.body) })
			_ = o.Set("json", func() goja.Value {
				var x any
				if err := json.Unmarshal(rs.body, &x); err != nil {
					a.throw(fail("invalid_argument", "the response is not JSON"))
				}
				return a.vm.ToValue(x)
			})
			_ = o.Set("base64", func() string { return base64.StdEncoding.EncodeToString(rs.body) })
			return o, nil
		})
	})
}

func (a *Actor) secretsModule() goja.Value {
	o := a.vm.NewObject()
	_ = o.Set("get", func(name string) goja.Value {
		a.need("secrets")
		if !slices.Contains(a.run.Manifest.Slop.Secrets, name) {
			a.throw(fail("permission_denied", "%s is not in app.json slop.secrets", name))
		}
		if a.m.Secret == nil {
			return goja.Null()
		}
		v, err := a.m.Secret(a.turn().t.Context(), a.run.App, name)
		if err != nil {
			return goja.Null()
		}
		return a.vm.ToValue(v)
	})
	return o
}

// absent reports a missing optional argument: goja passes nil for an
// argument the caller left out, which IsUndefined does not catch.
func absent(v goja.Value) bool { return v == nil || goja.IsUndefined(v) || goja.IsNull(v) }
