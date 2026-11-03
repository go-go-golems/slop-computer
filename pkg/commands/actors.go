package commands

import (
	"context"
	"errors"
	"slices"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/apps"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/system"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func actorErr(err error) error {
	var ae *actor.Error
	if errors.As(err, &ae) {
		e := &verbs.Error{Code: ae.Code, Message: ae.Message}
		if ae.Confirm != "" {
			e.Message += "; allow it with: slop confirm approve " + ae.Confirm + ", then repeat the call"
			e.Extra = map[string]any{"confirm": ae.Confirm}
		}
		return e
	}
	return err
}

func actorVerbs(e *Env) []*verbs.Verb {
	storeArg := verbs.Arg{Name: "store", Type: "string", Pos: 1, Required: true}
	return []*verbs.Verb{
		{Name: "actor.call", Doc: "Call an action of a store's actor (the action checks your level itself).", Scope: verbs.Write, Action: authz.ActorCall,
			Args: []verbs.Arg{storeArg, {Name: "action", Type: "string", Pos: 2, Required: true}, {Name: "args", Type: "json"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "calling"); err != nil {
					return nil, err
				}
				var args any = map[string]any{}
				if a.Has("args") {
					args = norm(a["args"])
					if s, ok := a["args"].(string); ok {
						args = decodeJSON([]byte(s))
					}
				}
				v, err := e.A.Call(ctx, a.S("store"), a.S("action"), args, e.A.VisitorOf(ctx, p, a.S("store")), p.ViaLabel())
				return v, actorErr(err)
			}},
		{Name: "app.logs", Doc: "The recent log of a store's actor (console.log, ctx.log).", Scope: verbs.Read, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "reading the actor log"); err != nil {
					return nil, err
				}
				out := map[string]any{"lines": e.A.Logs(ctx, a.S("store"))}
				if b := e.A.Broken(a.S("store")); b != "" {
					out["broken"] = b
				}
				return out, nil
			}},
		{Name: "app.restart", Doc: "Restart a store's actor: clears a broken state and retries activation.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "restarting"); err != nil {
					return nil, err
				}
				e.A.Restart(a.S("store"))
				r, err := e.K.Running(ctx, a.S("store"))
				if err != nil {
					return nil, err
				}
				return map[string]any{"store": r.Store, "app": r.App, "n": r.N, "broken": r.Broken()}, nil
			}},
		{Name: "app.trust", Doc: "Trust an app with a Go module it declares in app.json slop.modules (system, workshop); restarts its actors.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []verbs.Arg{{Name: "app", Type: "string", Pos: 1, Required: true}, {Name: "module", Type: "string", Pos: 2, Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				app, mod := a.S("app"), a.S("module")
				if !apps.Modules[mod] {
					return nil, verbs.Errf("invalid_argument", "no module %q (system, workshop)", mod)
				}
				r, err := e.K.Running(ctx, app)
				if err != nil || r.Manifest == nil {
					return nil, verbs.Errf("not_found", "%s is not an app (no app.json)", app)
				}
				if !slices.Contains(r.Manifest.Slop.Modules, mod) {
					return nil, verbs.Errf("invalid_argument", "%s does not declare %s in app.json slop.modules", app, mod)
				}
				if err := e.Sys.TrustModule(ctx, p.ID(), p.ViaLabel(), app, mod); err != nil {
					return nil, err
				}
				e.A.RestartApp(app) // use() is evaluated at start
				return map[string]any{"app": app, "module": mod, "trusted": true}, nil
			}},
		{Name: "app.untrust", Doc: "Withdraw an app's trust with a Go module; restarts its actors.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []verbs.Arg{{Name: "app", Type: "string", Pos: 1, Required: true}, {Name: "module", Type: "string", Pos: 2, Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				app, mod := a.S("app"), a.S("module")
				err := e.Sys.UntrustModule(ctx, p.ID(), p.ViaLabel(), app, mod)
				if errors.Is(err, system.ErrNotFound) {
					return nil, verbs.Errf("not_found", "%s is not trusted with %s", app, mod)
				}
				if err != nil {
					return nil, err
				}
				e.A.RestartApp(app)
				return map[string]any{"app": app, "module": mod, "trusted": false}, nil
			}},
		{Name: "app.follow", Doc: "Make a store run the snapshot of its app that a ref points at (main by default; draft runs unpublished code).", Scope: verbs.Write, AdminOnly: true, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg, {Name: "ref", Type: "string", Pos: 2, Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				s, d, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "changing the app version")
				if err != nil {
					return nil, err
				}
				r, err := e.K.Running(ctx, s.ID)
				if err != nil {
					return nil, err
				}
				as, err := e.K.Store(ctx, r.App)
				if err != nil {
					return nil, err
				}
				ref := a.S("ref")
				if _, err := as.Ref(ctx, ref); err != nil {
					return nil, verbs.Errf("not_found", "%s has no ref %s", r.App, ref)
				}
				if _, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
					t.Summary = "follows " + r.App + "@" + ref
					return t.SetMeta("app_ref", ref)
				}); err != nil {
					return nil, storeErr(err)
				}
				r, err = e.K.Running(ctx, s.ID) // activates the store at the ref's snapshot
				if err != nil {
					return nil, err
				}
				return map[string]any{"store": s.ID, "app": r.App, "ref": ref, "n": r.N, "broken": r.Broken()}, nil
			}},
		{Name: "app.modules", Doc: "The Go modules apps can use, and which apps are trusted with them (one app: what it declares and is trusted with).", Scope: verbs.Read, Action: authz.StoreRead, StoreArg: "app",
			Args: []verbs.Arg{{Name: "app", Type: "string", Pos: 1}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				reg := []map[string]any{}
				for _, m := range e.A.Modules() {
					reg = append(reg, map[string]any{"name": m.Name, "doc": m.Doc})
				}
				trust, err := e.Sys.AppModules(ctx, a.S("app"))
				if err != nil {
					return nil, err
				}
				out := map[string]any{"modules": reg, "trusted": trust}
				if app := a.S("app"); app != "" {
					if _, _, err := e.open(ctx, p, app, rt.LevelView, "reading"); err != nil {
						return nil, err
					}
					declared := []string{}
					if r, err := e.K.Running(ctx, app); err == nil && r.Manifest != nil {
						declared = append(declared, r.Manifest.Slop.Modules...)
					}
					out["app"], out["declared"] = app, declared
				}
				return out, nil
			}},
		{Name: "alarm.ls", Doc: "List a store's alarms.", Scope: verbs.Read, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				s, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "reading alarms")
				if err != nil {
					return nil, err
				}
				return s.ReadQuery(ctx, `SELECT name, at, every, running FROM _alarms ORDER BY at`)
			}},
		{Name: "alarm.fire", Doc: "Fire a store's alarm now.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg, {Name: "name", Type: "string", Pos: 2, Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "firing alarms"); err != nil {
					return nil, err
				}
				return map[string]any{"fired": a.S("name")}, actorErr(e.A.Fire(ctx, a.S("store"), a.S("name")))
			}},
		{Name: "bind.ls", Doc: "List a store's read aliases.", Scope: verbs.Read, Action: authz.StoreRead,
			Args: []verbs.Arg{storeArg},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "reading"); err != nil {
					return nil, err
				}
				return e.Sys.Bindings(ctx, a.S("store"))
			}},
		{Name: "bind.set", Doc: "Point a store's read alias at another store (grant store:<store> view there for actors); with --prefix, also map it into the store's pages' db: <alias>/… reads the target's <prefix>/… as the viewer, at most at --level.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg, {Name: "alias", Type: "string", Pos: 2, Required: true}, {Name: "target", Type: "string", Pos: 3, Required: true},
				{Name: "assets", Type: "bool", Doc: "also let the store's actor read the target's uploaded files, and its pages show them (needs admin on the target)"},
				{Name: "prefix", Type: "string", Doc: "a collection path in the target: pages reach it at <alias>/… (SLOP3-008)"},
				{Name: "level", Type: "string", Doc: "with --prefix: the most the alias gives, view, interact or admin (default view); you need it on the target"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "binding"); err != nil {
					return nil, err
				}
				b := system.Binding{Store: a.S("store"), Alias: a.S("alias"), Target: a.S("target"), Assets: a.B("assets"), Prefix: a.S("prefix"), Level: a.S("level")}
				if err := checkAlias(ctx, e, p, &b); err != nil {
					return nil, err
				}
				if err := e.Sys.SetBinding(ctx, p.ID(), p.ViaLabel(), b); err != nil {
					return nil, err
				}
				return b, nil
			}},
		{Name: "bind.rm", Doc: "Remove a store's read alias.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg, {Name: "alias", Type: "string", Pos: 2, Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "unbinding"); err != nil {
					return nil, err
				}
				err := e.Sys.RemoveBinding(ctx, p.ID(), p.ViaLabel(), a.S("store"), a.S("alias"))
				if errors.Is(err, system.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no alias %s on %s", a.S("alias"), a.S("store"))
				}
				return map[string]any{"removed": a.S("alias")}, err
			}},
	}
}

// checkAlias checks a binding as bind.set takes it (and a mount's alias
// template, without its store): a valid alias and prefix, a level only with
// a prefix (view when none is given), and p holding that level on the target,
// admin with assets. You cannot alias more than you hold: pages read the
// target through the alias up to its level, as their own viewers.
func checkAlias(ctx context.Context, e *Env, p *access.Principal, b *system.Binding) error {
	level := rt.LevelView
	switch {
	case b.Prefix == "" && b.Level != "":
		return verbs.Errf("invalid_argument", "--level needs --prefix: only an alias in the pages' db has a level")
	case b.Prefix != "":
		if err := rt.ValidAlias(b.Alias, b.Prefix); err != nil {
			return verbs.Errf("invalid_argument", "%s", err.(*rt.PathError).Msg)
		}
		if b.Level != "" {
			l, ok := rt.ParseLevel(b.Level)
			if !ok || l < rt.LevelView || l > rt.LevelAdmin {
				return verbs.Errf("invalid_argument", "--level is view, interact or admin")
			}
			level = l
		}
		b.Level = level.String()
	case b.Alias == "" || b.Target == "":
		return verbs.Errf("invalid_argument", "an alias needs a name and a target")
	}
	need, why := level, "binding to"
	if b.Assets {
		need, why = rt.LevelAdmin, "sharing the uploads of"
	}
	_, _, err := e.open(ctx, p, b.Target, need, why)
	return err
}
