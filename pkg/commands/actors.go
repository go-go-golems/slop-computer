package commands

import (
	"context"
	"errors"
	"slices"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/apps"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/policy"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
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

func actorVerbs(e actorEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[ActorCallIn, any]{Name: "actor.call", Doc: "Call an action of a store's actor (the action checks your level itself).", Scope: verbs.Write, Action: authz.ActorCall,
			Run: func(req verbs.Req, in ActorCallIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelView, "calling"); err != nil {
					return nil, err
				}
				var args any = map[string]any{}
				if in.Args != nil {
					args = norm(in.Args)
					if s, ok := in.Args.(string); ok {
						args = decodeJSON([]byte(s))
					}
				}
				v, err := e.A.Call(ctx, in.Store, in.Action, args, e.A.VisitorOf(ctx, p, in.Store), p.ViaLabel())
				return v, actorErr(err)
			}}.Verb(),
		verbs.Def[AppLogsIn, AppLogsOut]{Name: "app.logs", Doc: "The recent log of a store's actor (console.log, ctx.log).", Scope: verbs.Read, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in AppLogsIn) (AppLogsOut, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "reading the actor log"); err != nil {
					return AppLogsOut{}, err
				}
				out := AppLogsOut{Lines: e.A.Logs(ctx, in.Store)}
				if b := e.A.Broken(in.Store); b != "" {
					out.Broken = ptr[string](b)
				}
				return out, nil
			}}.Verb(),
		verbs.Def[AppRestartIn, AppRestartOut]{Name: "app.restart", Doc: "Restart a store's actor: clears a broken state and retries activation.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in AppRestartIn) (AppRestartOut, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "restarting"); err != nil {
					return AppRestartOut{}, err
				}
				e.A.Restart(in.Store)
				r, err := e.K.Running(ctx, in.Store)
				if err != nil {
					return AppRestartOut{}, err
				}
				return AppRestartOut{Store: r.Store, App: r.App, N: r.N, Broken: r.Broken()}, nil
			}}.Verb(),
		verbs.Def[AppTrustIn, AppTrustOut]{Name: "app.trust", Doc: "Trust an app with a Go module it declares in app.json slop.modules (system, workshop); restarts its actors.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in AppTrustIn) (AppTrustOut, error) {
				ctx := req.Context
				p := req.Principal
				app, mod := in.App, in.Module
				if !apps.Modules[mod] {
					return AppTrustOut{}, verbs.Errf("invalid_argument", "no module %q (system, workshop)", mod)
				}
				r, err := e.K.Running(ctx, app)
				if err != nil || r.Manifest == nil {
					return AppTrustOut{}, verbs.Errf("not_found", "%s is not an app (no app.json)", app)
				}
				if !slices.Contains(r.Manifest.Slop.Modules, mod) {
					return AppTrustOut{}, verbs.Errf("invalid_argument", "%s does not declare %s in app.json slop.modules", app, mod)
				}
				if err := e.K.Gov.TrustModule(ctx, p.ID(), p.ViaLabel(), app, mod); err != nil {
					return AppTrustOut{}, err
				}
				e.A.RestartApp(app) // use() is evaluated at start
				return AppTrustOut{App: app, Module: mod, Trusted: true}, nil
			}}.Verb(),
		verbs.Def[AppUntrustIn, AppUntrustOut]{Name: "app.untrust", Doc: "Withdraw an app's trust with a Go module; restarts its actors.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in AppUntrustIn) (AppUntrustOut, error) {
				ctx := req.Context
				p := req.Principal
				app, mod := in.App, in.Module
				err := e.K.Gov.UntrustModule(ctx, p.ID(), p.ViaLabel(), app, mod)
				if errors.Is(err, sysdb.ErrNotFound) {
					return AppUntrustOut{}, verbs.Errf("not_found", "%s is not trusted with %s", app, mod)
				}
				if err != nil {
					return AppUntrustOut{}, err
				}
				e.A.RestartApp(app)
				return AppUntrustOut{App: app, Module: mod, Trusted: false}, nil
			}}.Verb(),
		verbs.Def[AppFollowIn, AppFollowOut]{Name: "app.follow", Doc: "Make a store run the snapshot of its app that a ref points at (main by default; draft runs unpublished code).", Scope: verbs.Write, AdminOnly: true, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in AppFollowIn) (AppFollowOut, error) {
				ctx := req.Context
				p := req.Principal
				s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "changing the app version")
				if err != nil {
					return AppFollowOut{}, err
				}
				r, err := e.K.Running(ctx, s.ID)
				if err != nil {
					return AppFollowOut{}, err
				}
				as, err := e.K.Store(ctx, r.App)
				if err != nil {
					return AppFollowOut{}, err
				}
				ref := in.Ref
				if _, err := as.Ref(ctx, ref); err != nil {
					return AppFollowOut{}, verbs.Errf("not_found", "%s has no ref %s", r.App, ref)
				}
				if _, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
					t.Summary = "follows " + r.App + "@" + ref
					return t.SetMeta("app_ref", ref)
				}); err != nil {
					return AppFollowOut{}, storeErr(err)
				}
				r, err = e.K.Running(ctx, s.ID) // activates the store at the ref's snapshot
				if err != nil {
					return AppFollowOut{}, err
				}
				return AppFollowOut{Store: s.ID, App: r.App, Ref: ref, N: r.N, Broken: r.Broken()}, nil
			}}.Verb(),
		verbs.Def[AppModulesIn, AppModulesOut]{Name: "app.modules", Doc: "The Go modules apps can use, and which apps are trusted with them (one app: what it declares and is trusted with).", Scope: verbs.Read, Action: authz.StoreRead, StoreArg: "app",
			Run: func(req verbs.Req, in AppModulesIn) (AppModulesOut, error) {
				ctx := req.Context
				p := req.Principal
				reg := []map[string]any{}
				for _, m := range e.A.Modules() {
					reg = append(reg, map[string]any{"name": m.Name, "doc": m.Doc})
				}
				trust, err := e.K.Gov.AppModules(ctx, in.App)
				if err != nil {
					return AppModulesOut{}, err
				}
				out := AppModulesOut{Modules: reg, Trusted: trust}
				if app := in.App; app != "" {
					if _, _, err := e.open(ctx, p, app, rt.LevelView, "reading"); err != nil {
						return AppModulesOut{}, err
					}
					declared := []string{}
					if r, err := e.K.Running(ctx, app); err == nil && r.Manifest != nil {
						declared = append(declared, r.Manifest.Slop.Modules...)
					}
					out.App, out.Declared = &app, &declared
				}
				return out, nil
			}}.Verb(),
		verbs.Def[AlarmLsIn, []map[string]any]{Name: "alarm.ls", Doc: "List a store's alarms.", Scope: verbs.Read, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in AlarmLsIn) ([]map[string]any, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "reading alarms")
				if err != nil {
					return nil, err
				}
				return s.ReadQuery(ctx, `SELECT name, at, every, running FROM _alarms ORDER BY at`)
			}}.Verb(),
		verbs.Def[AlarmFireIn, AlarmFireOut]{Name: "alarm.fire", Doc: "Fire a store's alarm now.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in AlarmFireIn) (AlarmFireOut, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "firing alarms"); err != nil {
					return AlarmFireOut{}, err
				}
				return AlarmFireOut{Fired: in.Name}, actorErr(e.A.Fire(ctx, in.Store, in.Name))
			}}.Verb(),
		verbs.Def[BindLsIn, []registry.Binding]{Name: "bind.ls", Doc: "List a store's read aliases.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in BindLsIn) ([]registry.Binding, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading"); err != nil {
					return nil, err
				}
				return e.K.Registry.Bindings(ctx, in.Store)
			}}.Verb(),
		verbs.Def[BindSetIn, registry.Binding]{Name: "bind.set", Doc: "Point a store's read alias at another store (grant store:<store> view there for actors); with --prefix, also map it into the store's pages' db: <alias>/… reads the target's <prefix>/… as the viewer, at most at --level.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in BindSetIn) (registry.Binding, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "binding"); err != nil {
					return registry.Binding{}, err
				}
				b := registry.Binding{Store: in.Store, Alias: in.Alias, Target: in.Target, Assets: in.Assets, Prefix: in.Prefix, Level: in.Level}
				if err := checkAlias(ctx, e.kernelEnv, p, &b); err != nil {
					return registry.Binding{}, err
				}
				if err := e.K.Registry.SetBinding(ctx, p.ID(), p.ViaLabel(), b); err != nil {
					return registry.Binding{}, err
				}
				return b, nil
			}}.Verb(),
		verbs.Def[BindRmIn, BindRmOut]{Name: "bind.rm", Doc: "Remove a store's read alias.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in BindRmIn) (BindRmOut, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "unbinding"); err != nil {
					return BindRmOut{}, err
				}
				err := e.K.Registry.RemoveBinding(ctx, p.ID(), p.ViaLabel(), in.Store, in.Alias)
				if errors.Is(err, sysdb.ErrNotFound) {
					return BindRmOut{}, verbs.Errf("not_found", "no alias %s on %s", in.Alias, in.Store)
				}
				return BindRmOut{Removed: in.Alias}, err
			}}.Verb(),
	}
}

// checkAlias checks a binding as bind.set takes it (and a mount's alias
// template, without its store): a valid alias and prefix, a level only with
// a prefix (view when none is given), and p holding that level on the target,
// admin with assets. You cannot alias more than you hold: pages read the
// target through the alias up to its level, as their own viewers.
func checkAlias(ctx context.Context, e kernelEnv, p *access.Principal, b *registry.Binding) error {
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

// ActorCallIn is actor.call's input.
type ActorCallIn struct {
	Store  string `json:"store" slop:"pos=1"`
	Action string `json:"action" slop:"pos=2"`
	Args   any    `json:"args,omitempty"`
}

// AppLogsIn is app.logs's input.
type AppLogsIn struct {
	Store string `json:"store" slop:"pos=1"`
}

// AppRestartIn is app.restart's input.
type AppRestartIn struct {
	Store string `json:"store" slop:"pos=1"`
}

// AppTrustIn is app.trust's input.
type AppTrustIn struct {
	App    string `json:"app" slop:"pos=1"`
	Module string `json:"module" slop:"pos=2"`
}

// AppUntrustIn is app.untrust's input.
type AppUntrustIn struct {
	App    string `json:"app" slop:"pos=1"`
	Module string `json:"module" slop:"pos=2"`
}

// AppFollowIn is app.follow's input.
type AppFollowIn struct {
	Store string `json:"store" slop:"pos=1"`
	Ref   string `json:"ref" slop:"pos=2"`
}

// AppModulesIn is app.modules's input.
type AppModulesIn struct {
	App string `json:"app,omitempty" slop:"pos=1"`
}

// AlarmLsIn is alarm.ls's input.
type AlarmLsIn struct {
	Store string `json:"store" slop:"pos=1"`
}

// AlarmFireIn is alarm.fire's input.
type AlarmFireIn struct {
	Store string `json:"store" slop:"pos=1"`
	Name  string `json:"name" slop:"pos=2"`
}

// BindLsIn is bind.ls's input.
type BindLsIn struct {
	Store string `json:"store" slop:"pos=1"`
}

// BindSetIn is bind.set's input.
type BindSetIn struct {
	Store  string `json:"store" slop:"pos=1"`
	Alias  string `json:"alias" slop:"pos=2"`
	Target string `json:"target" slop:"pos=3"`
	Assets bool   `json:"assets,omitempty" jsonschema_description:"also let the store's actor read the target's uploaded files, and its pages show them (needs admin on the target)"`
	Prefix string `json:"prefix,omitempty" jsonschema_description:"a collection path in the target: pages reach it at <alias>/… (SLOP3-008)"`
	Level  string `json:"level,omitempty" jsonschema_description:"with --prefix: the most the alias gives, view, interact or admin (default view); you need it on the target"`
}

// BindRmIn is bind.rm's input.
type BindRmIn struct {
	Store string `json:"store" slop:"pos=1"`
	Alias string `json:"alias" slop:"pos=2"`
}

// AppLogsOut is app.logs's result.
type AppLogsOut struct {
	Broken *string         `json:"broken,omitempty"`
	Lines  []actor.LogLine `json:"lines"`
}

// AppRestartOut is app.restart's result.
type AppRestartOut struct {
	App    string `json:"app"`
	Broken string `json:"broken"`
	N      int64  `json:"n"`
	Store  string `json:"store"`
}

// AppTrustOut is app.trust's result.
type AppTrustOut struct {
	App     string `json:"app"`
	Module  string `json:"module"`
	Trusted bool   `json:"trusted"`
}

// AppUntrustOut is app.untrust's result.
type AppUntrustOut struct {
	App     string `json:"app"`
	Module  string `json:"module"`
	Trusted bool   `json:"trusted"`
}

// AppFollowOut is app.follow's result.
type AppFollowOut struct {
	App    string `json:"app"`
	Broken string `json:"broken"`
	N      int64  `json:"n"`
	Ref    string `json:"ref"`
	Store  string `json:"store"`
}

// AlarmFireOut is alarm.fire's result.
type AlarmFireOut struct {
	Fired string `json:"fired"`
}

// BindRmOut is bind.rm's result.
type BindRmOut struct {
	Removed string `json:"removed"`
}

// AppModulesOut is app.modules's result.
type AppModulesOut struct {
	App      *string            `json:"app,omitempty"`
	Declared *[]string          `json:"declared,omitempty"`
	Modules  []map[string]any   `json:"modules"`
	Trusted  []policy.AppModule `json:"trusted"`
}
