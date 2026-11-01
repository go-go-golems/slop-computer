package actor

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/rt"
	"github.com/go-go-golems/slop/pkg/store"
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
	case "room":
		return a.roomModule()
	case "alarm":
		return a.alarmModule()
	case "time":
		return a.timeModule()
	case "log":
		return a.logModule()
	case "stores":
		return a.storesModule()
	case "fetch":
		if len(a.run.Manifest.Slop.Fetch) > 0 && a.m.allowed(a, "fetch") {
			return a.fetchModule()
		}
	case "secrets":
		if len(a.run.Manifest.Slop.Secrets) > 0 && a.m.allowed(a, "secrets") {
			return a.secretsModule()
		}
	case "sample":
		if a.m.Sample != nil && a.m.allowed(a, "sample") {
			return a.m.Sample(a)
		}
	case "platform":
		if len(a.run.Manifest.Slop.Platform) > 0 && a.m.Platform != nil && a.m.allowed(a, "platform") {
			return a.m.Platform(a)
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

// IO starts real I/O; see io.
func (a *Actor) IO(work func() (any, error), settle func(v any) (goja.Value, error)) goja.Value {
	return a.io(work, settle)
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

func (a *Actor) dbModule() goja.Value {
	o := a.vm.NewObject()
	_ = o.Set("doc", func(path string) goja.Value {
		d := a.vm.NewObject()
		_ = d.Set("path", path)
		_ = d.Set("get", func() goja.Value {
			doc, err := a.turn().t.GetDoc(path)
			if err != nil {
				return a.snap(store.Doc{}, false, path)
			}
			return a.snap(doc, true, path)
		})
		_ = d.Set("set", func(v goja.Value) goja.Value {
			body, _ := a.fromJS(v).(map[string]any)
			ver, err := a.turn().t.SetDoc(path, body, 0)
			a.check(err)
			return a.vm.ToValue(ver)
		})
		_ = d.Set("update", func(v goja.Value) goja.Value {
			body, _ := a.fromJS(v).(map[string]any)
			ver, err := a.turn().t.UpdateDoc(path, body)
			a.check(err)
			return a.vm.ToValue(ver)
		})
		_ = d.Set("delete", func() goja.Value {
			ok, err := a.turn().t.DeleteDoc(path)
			a.check(err)
			return a.vm.ToValue(ok)
		})
		return d
	})
	_ = o.Set("collection", func(coll string) goja.Value { return a.query(rt.Query{Coll: coll}) })
	return o
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
		n.Order, n.Desc = field, !goja.IsUndefined(dir) && dir.String() == "desc"
		return a.query(n)
	})
	_ = o.Set("limit", func(k int) goja.Value {
		n := q
		n.Limit = k
		return a.query(n)
	})
	_ = o.Set("get", func() goja.Value {
		docs, err := a.turn().t.QueryDocs(q)
		a.check(err)
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
		f, err := a.turn().t.PutFile(zone, path, b, ctype)
		a.check(err)
		return a.toJS(f)
	})
	_ = o.Set("list", func(prefix goja.Value, opts goja.Value) goja.Value {
		p := ""
		if !goja.IsUndefined(prefix) && !goja.IsNull(prefix) {
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

// --- room ----------------------------------------------------------------

func (a *Actor) roomModule() goja.Value {
	o := a.vm.NewObject()
	_ = o.Set("emit", func(topic string, data goja.Value) goja.Value {
		t := a.turn()
		payload := a.fromJS(data)
		id := a.st.ID
		// Output waits for the commit.
		t.out = append(t.out, func() {
			if a.m.RoomEmit != nil {
				a.m.RoomEmit(id, topic, payload)
			}
		})
		return goja.Undefined()
	})
	_ = o.Set("peers", func() goja.Value {
		if a.m.RoomPeers == nil {
			return a.vm.NewArray()
		}
		return a.toJS(a.m.RoomPeers(a.st.ID))
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
		target, err := a.m.K.Sys.Binding(ctx, a.st.ID, alias)
		if err != nil {
			a.throw(fail("not_found", "no binding for %q on %s", alias, a.st.ID))
		}
		me := &access.Principal{Kind: access.KindStore, Store: a.st.ID}
		d, _, err := a.m.K.Access.Can(ctx, me, target, rt.LevelView, "reading", true)
		a.check(err)
		if !d.OK {
			a.throw(fail("permission_denied", "store:%s cannot read %s (grant it view)", a.st.ID, target))
		}
		ts, err := a.m.K.Store(ctx, target)
		a.check(err)
		r := a.vm.NewObject()
		_ = r.Set("id", target)
		docs := a.vm.NewObject()
		_ = docs.Set("get", func(path string) goja.Value {
			doc, err := ts.GetDoc(ctx, path)
			if err != nil {
				return a.snap(store.Doc{}, false, path)
			}
			return a.snap(doc, true, path)
		})
		_ = docs.Set("query", func(coll string, opts goja.Value) goja.Value {
			q := rt.Query{Coll: coll}
			if obj, ok := opts.(*goja.Object); ok && opts != nil {
				b, _ := json.Marshal(a.fromJS(obj))
				_ = json.Unmarshal(b, &q)
				q.Coll = coll
			}
			ds, err := ts.Query(ctx, q)
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
			n, err := ts.Ref(ctx, "main")
			a.check(err)
			f, err := ts.SnapshotFile(ctx, n, path)
			a.check(err)
			b, err := ts.ReadFile(f)
			a.check(err)
			return a.vm.ToValue(string(b))
		})
		_ = files.Set("list", func() goja.Value {
			n, err := ts.Ref(ctx, "main")
			a.check(err)
			fs, err := ts.SnapshotFiles(ctx, n)
			a.check(err)
			return a.toJS(fs)
		})
		_ = r.Set("files", files)
		_ = r.Set("log", func(after int64) goja.Value {
			cs, err := ts.Log(ctx, after, 100)
			a.check(err)
			return a.toJS(cs)
		})
		_ = r.Set("call", func(action string, args goja.Value) goja.Value {
			payload := a.fromJS(args)
			vis := Visitor{ID: "store:" + a.st.ID, Audience: "member", Level: d.LevelName()}
			return a.io(func() (any, error) {
				return a.m.Call(ctx, target, action, payload, vis, "store:"+a.st.ID)
			}, func(v any) (goja.Value, error) { return a.toJS(v), nil })
		})
		return r
	})
	return o
}

// --- fetch, secrets --------------------------------------------------------

func (a *Actor) fetchModule() goja.Value {
	return a.vm.ToValue(func(raw string, init goja.Value) goja.Value {
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
			c := &http.Client{Timeout: 30 * time.Second}
			r, err := c.Do(req)
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
