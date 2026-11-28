package actors

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
)

// workshopFuncs is the workshop module: what a review or publishing tool
// needs, called as the visitor. commit and push write to the draft ref
// unless told otherwise: mounts serve main, and only publish moves it.
//
// Every ref write states where the ref is, so it cannot overwrite a write
// it did not see (SLOP3-023):
//
//   - commit(store, changes, {base, message, ref, activate}): the changes
//     [{path, text} | {path, data} | {path, sha256, size} | {path, delete:
//     true}] over snapshot base (required; 0: the ref does not exist yet),
//     merged per path when the ref moved since; conflict when a changed
//     path changed there too (extra.conflicts), and nothing is written.
//   - push(store, files, {ifAt, message, ref, activate}): the whole tree.
//   - moveRef(store, ref, n, {ifAt}), publish(store, n, {ifAt}) (moves
//     main) and dropRef(store, ref, {ifAt}): ifAt is where the ref points
//     now (0: it does not exist yet).
var workshopFuncs = []modFunc{
	{JS: "stores", Verb: "store.ls"}, // stores({all: true}): every store, for admins
	{JS: "snapshots", Verb: "snap.ls", Pos: []string{"store"}},
	{JS: "refs", Verb: "ref.ls", Pos: []string{"store"}},
	{JS: "files", Verb: "files.ls", Pos: []string{"store", "at"}},
	{JS: "read", Verb: "files.cat", Pos: []string{"store", "at", "path"}},
	{JS: "log", Verb: "log.show", Pos: []string{"store", "after", "limit"}},
	{JS: "commit", Verb: "files.commit", Pos: []string{"store", "changes"}, Default: map[string]any{"ref": "draft"}},
	{JS: "push", Verb: "files.push", Pos: []string{"store", "files"}, Default: map[string]any{"ref": "draft"}},
	{JS: "moveRef", Verb: "ref.move", Pos: []string{"store", "ref", "n"}},
	{JS: "publish", Verb: "ref.move", Pos: []string{"store", "n"}, Fixed: map[string]any{"ref": "main"}},
	{JS: "dropRef", Verb: "ref.rm", Pos: []string{"store", "ref"}},
	{JS: "follow", Verb: "app.follow", Pos: []string{"store", "ref"}},
	{JS: "status", Verb: "app.status", Pos: []string{"store"}},
	{JS: "preview", Verb: "preview.url", Pos: []string{"store", "at", "parent"}},
	// types(app, {instance}): the app's TypeScript declarations (SLOP3-024).
	{JS: "types", Verb: "app.types", Pos: []string{"app"}},
	{JS: "mounts", Verb: "mount.ls", Pos: []string{"host"}},

	// SLOP3-022, a dev loop: instances that run a ref of an app
	// (newStore(id, {app, type}), then follow), their state, logs and
	// data, and seeding them from fixtures. commit and push take
	// {activate: [ids]}; drop is workshopModule's own.
	{JS: "newStore", Verb: "store.new", Pos: []string{"id"}},
	{JS: "logs", Verb: "app.logs", Pos: []string{"store"}},
	{JS: "restart", Verb: "app.restart", Pos: []string{"store"}},
	{JS: "doc", Verb: "docs.get", Pos: []string{"store", "path"}},
	{JS: "docs", Verb: "docs.ls", Pos: []string{"store", "coll"}},
	{JS: "sql", Verb: "sql.query", Pos: []string{"store", "sql", "args"}},
	{JS: "importDocs", Verb: "import.docs", Pos: []string{"store", "coll", "rows"}},
	{JS: "importTable", Verb: "import.table", Pos: []string{"store", "table", "rows"}},
}

// workshopModule is use('workshop'): workshopFuncs, plus drop(id), which
// deletes an instance that runs unpublished code: a store that runs
// another store's app and follows a ref other than main (a dev, proposal
// or test-run instance). It never deletes an app store or a production
// instance, even for an admin, who holds admin on every store.
func (s *Door) workshopModule(a *actor.Actor) goja.Value {
	o := s.verbModule(a, "workshop", workshopFuncs).(*goja.Object)
	_ = o.Set("drop", func(id string) goja.Value {
		if !s.Gov.Trusted(context.Background(), a.App(), "workshop") {
			a.Throw("permission_denied", a.App()+" is no longer trusted with workshop")
		}
		p := s.actAs(a, "workshop", true)
		return a.IO(func() (any, error) {
			ctx := web.WithPrincipal(context.Background(), p)
			if err := s.unpublished(ctx, p, "drop removes", id); err != nil {
				return nil, err
			}
			out, err := s.Verbs.Call(ctx, p, "store.rm", map[string]any{"id": id})
			if err != nil {
				return nil, verbFail(err)
			}
			return out, nil
		}, func(out any) (goja.Value, error) { return a.ToJS(out), nil })
	})
	// exec(id, sql, args) runs SQL that may write on an instance's app
	// tables, under the same rule as drop: only an instance that runs
	// unpublished code (a person removing one test row from their dev
	// data; before, only a reset of all of it could).
	_ = o.Set("exec", func(id, query string, args goja.Value) goja.Value {
		if !s.Gov.Trusted(context.Background(), a.App(), "workshop") {
			a.Throw("permission_denied", a.App()+" is no longer trusted with workshop")
		}
		var av any
		if args != nil && !goja.IsUndefined(args) && !goja.IsNull(args) {
			av = args.Export()
		}
		p := s.actAs(a, "workshop", true)
		return a.IO(func() (any, error) {
			ctx := web.WithPrincipal(context.Background(), p)
			if err := s.unpublished(ctx, p, "exec writes to", id); err != nil {
				return nil, err
			}
			out, err := s.Verbs.Call(ctx, p, "sql.exec", map[string]any{"store": id, "sql": query, "args": av, "write": true})
			if err != nil {
				return nil, verbFail(err)
			}
			return out, nil
		}, func(out any) (goja.Value, error) { return a.ToJS(out), nil })
	})
	// mountApp(app) gives a published app a web address: /<app> on the
	// server's first live host, unless something else is mounted there
	// (the same mount again is a no-op). mount.set is for platform admins,
	// so only they can; personas who published asked "where is my link?"
	// four times in two rounds.
	_ = o.Set("mountApp", func(app string) goja.Value {
		if !s.Gov.Trusted(context.Background(), a.App(), "workshop") {
			a.Throw("permission_denied", a.App()+" is no longer trusted with workshop")
		}
		p := s.actAs(a, "workshop", true)
		return a.IO(func() (any, error) {
			ctx := web.WithPrincipal(context.Background(), p)
			var st struct {
				Store, App string
				Refs       map[string]int64
			}
			out, err := s.Verbs.Call(ctx, p, "app.status", map[string]any{"store": app})
			if err != nil {
				return nil, verbFail(err)
			}
			b, _ := json.Marshal(out)
			_ = json.Unmarshal(b, &st)
			if st.App != st.Store {
				return nil, &actor.Error{Code: "invalid_argument", Message: app + " is an instance of " + st.App + ", not an app"}
			}
			refs, err := s.Verbs.Call(ctx, p, "ref.ls", map[string]any{"store": app})
			if err != nil {
				return nil, verbFail(err)
			}
			if rb, _ := json.Marshal(refs); !strings.Contains(string(rb), `"main"`) {
				return nil, &actor.Error{Code: "failed_precondition", Message: app + " is not published yet: publish it first"}
			}
			hosts, err := s.Verbs.Call(ctx, p, "server.hosts", map[string]any{})
			if err != nil {
				return nil, verbFail(err)
			}
			var h struct{ Live []string }
			hb, _ := json.Marshal(hosts)
			_ = json.Unmarshal(hb, &h)
			if len(h.Live) == 0 {
				return nil, &actor.Error{Code: "failed_precondition", Message: "this server has no live host to put apps on"}
			}
			host, path := h.Live[0], "/"+app
			ms, err := s.Verbs.Call(ctx, p, "mount.ls", map[string]any{"host": host})
			if err != nil {
				return nil, verbFail(err)
			}
			var list []struct {
				Mount struct{ Path, Store string }
				URL   string
			}
			mb, _ := json.Marshal(ms)
			_ = json.Unmarshal(mb, &list)
			for _, m := range list {
				if m.Mount.Path == path {
					if m.Mount.Store == app {
						return map[string]any{"url": m.URL, "existed": true}, nil
					}
					return nil, &actor.Error{Code: "already_exists", Message: host + path + " already serves " + m.Mount.Store}
				}
			}
			if _, err := s.Verbs.Call(ctx, p, "mount.set", map[string]any{"host": host, "path": path, "store": app}); err != nil {
				return nil, verbFail(err)
			}
			ms, _ = s.Verbs.Call(ctx, p, "mount.ls", map[string]any{"host": host})
			mb, _ = json.Marshal(ms)
			_ = json.Unmarshal(mb, &list)
			for _, m := range list {
				if m.Mount.Path == path {
					return map[string]any{"url": m.URL}, nil
				}
			}
			return map[string]any{"url": ""}, nil
		}, func(out any) (goja.Value, error) { return a.ToJS(out), nil })
	})
	// embed(store, {dev}) opens a view of store for the visitor, framed by
	// this app's own page; renewEmbed(view) renews its secret when the
	// framed page's runtime asks (SLOP3-022 C.1).
	trusted := func() {
		if !s.Gov.Trusted(context.Background(), a.App(), "workshop") {
			a.Throw("permission_denied", a.App()+" is no longer trusted with workshop")
		}
	}
	toJS := func(out any) (goja.Value, error) { return a.ToJS(out), nil }
	_ = o.Set("embed", func(store string, opts goja.Value) goja.Value {
		trusted()
		if s.Embed == nil {
			a.Throw("unavailable", "this server opens no embedded views")
		}
		dev := false
		if m, ok := a.FromJS(opts).(map[string]any); ok {
			dev, _ = m["dev"].(bool)
		}
		p := s.actAs(a, "workshop", true)
		tool, app := a.Store().ID, a.App()
		return a.IO(func() (any, error) {
			out, err := s.Embed(context.Background(), p, store, tool, app, dev)
			if err != nil {
				return nil, verbFail(err)
			}
			return out, nil
		}, toJS)
	})
	_ = o.Set("renewEmbed", func(view string) goja.Value {
		trusted()
		if s.RenewEmbed == nil {
			a.Throw("unavailable", "this server opens no embedded views")
		}
		p := s.actAs(a, "workshop", true)
		tool, app := a.Store().ID, a.App()
		return a.IO(func() (any, error) {
			out, err := s.RenewEmbed(context.Background(), p, view, tool, app)
			if err != nil {
				return nil, verbFail(err)
			}
			return out, nil
		}, toJS)
	})
	// closeEmbed(view) ends an embedded view this app opened for the
	// visitor, when its frame goes away or reloads.
	_ = o.Set("closeEmbed", func(view string) goja.Value {
		trusted()
		if s.CloseEmbed == nil {
			a.Throw("unavailable", "this server opens no embedded views")
		}
		p := s.actAs(a, "workshop", true)
		tool, app := a.Store().ID, a.App()
		return a.IO(func() (any, error) {
			out, err := s.CloseEmbed(context.Background(), p, view, tool, app)
			if err != nil {
				return nil, verbFail(err)
			}
			return out, nil
		}, toJS)
	})
	return o
}

// unpublished refuses unless id is an instance that runs unpublished code:
// a store that runs another store's app, at a ref other than main (a dev,
// proposal or test-run instance). Never an app store or a production
// instance, even for an admin, who holds admin on every store.
func (s *Door) unpublished(ctx context.Context, p *access.Principal, what, id string) error {
	out, err := s.Verbs.Call(ctx, p, "app.status", map[string]any{"store": id})
	if err != nil {
		return verbFail(err)
	}
	var st struct{ Store, App, Ref string }
	b, _ := json.Marshal(out)
	_ = json.Unmarshal(b, &st)
	if st.App == st.Store || st.Ref == "" || st.Ref == "main" {
		return &actor.Error{Code: "permission_denied", Message: what + " only instances that run unpublished code (another store's app, at a ref other than main); " + id + " runs " + st.App + "@" + st.Ref}
	}
	return nil
}
