package actors

import (
	"context"
	"encoding/json"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// workshopFuncs is the workshop module: what a review or publishing tool
// needs, called as the visitor. push writes to the draft ref unless told
// otherwise: mounts serve main, and only publish moves it.
var workshopFuncs = []modFunc{
	{JS: "stores", Verb: "store.ls"}, // stores({all: true}): every store, for admins
	{JS: "snapshots", Verb: "snap.ls", Pos: []string{"store"}},
	{JS: "refs", Verb: "ref.ls", Pos: []string{"store"}},
	{JS: "files", Verb: "files.ls", Pos: []string{"store", "at"}},
	{JS: "read", Verb: "files.cat", Pos: []string{"store", "at", "path"}},
	{JS: "log", Verb: "log.show", Pos: []string{"store", "after", "limit"}},
	{JS: "push", Verb: "files.push", Pos: []string{"store", "files"}, Default: map[string]any{"ref": "draft"}},
	{JS: "moveRef", Verb: "ref.move", Pos: []string{"store", "ref", "n"}},
	{JS: "publish", Verb: "ref.move", Pos: []string{"store", "n"}, Fixed: map[string]any{"ref": "main"}},
	{JS: "follow", Verb: "app.follow", Pos: []string{"store", "ref"}},
	{JS: "status", Verb: "app.status", Pos: []string{"store"}},
	{JS: "preview", Verb: "preview.url", Pos: []string{"store", "at", "parent"}},

	// SLOP3-022, a dev loop: instances that run a ref of an app
	// (newStore(id, {app, type}), then follow), their state, logs and
	// data, and seeding them from fixtures. push takes {activate: [ids]}
	// and publish takes {ifAt: n}; drop is workshopModule's own.
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
			out, err := s.Verbs.Call(ctx, p, "app.status", map[string]any{"store": id})
			if err != nil {
				ve := verbs.AsError(err)
				return nil, &actor.Error{Code: ve.Code, Message: ve.Message}
			}
			var st struct{ Store, App, Ref string }
			b, _ := json.Marshal(out)
			_ = json.Unmarshal(b, &st)
			if st.App == st.Store || st.Ref == "" || st.Ref == "main" {
				return nil, &actor.Error{Code: "permission_denied", Message: "drop removes only instances that run unpublished code (another store's app, at a ref other than main); " + id + " runs " + st.App + "@" + st.Ref}
			}
			if out, err = s.Verbs.Call(ctx, p, "store.rm", map[string]any{"id": id}); err != nil {
				ve := verbs.AsError(err)
				return nil, &actor.Error{Code: ve.Code, Message: ve.Message}
			}
			return out, nil
		}, func(out any) (goja.Value, error) { return a.ToJS(out), nil })
	})
	return o
}
