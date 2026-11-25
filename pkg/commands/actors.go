package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/actor"
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
		if ae.Extra != nil {
			e.Extra = ae.Extra // an action that rethrows a verb's error keeps its details
		}
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
				// --as anonymous runs the action as a fresh signed-out
				// visitor: four persona agents had no way to prove what a
				// guest gets but the page's own RPC (SLOP3-026, round 3).
				// --as a person runs it with that person's level, audience
				// and LLM access (and charges them); via names the admin.
				caller, via := p, p.ViaLabel()
				if in.As != "" {
					if !p.IsAdmin() {
						return nil, verbs.Errf("permission_denied", "only platform admins call as someone else")
					}
					if strings.HasPrefix(in.As, "store:") || strings.HasPrefix(in.As, "@") {
						return nil, verbs.Errf("invalid_argument", "--as takes anonymous or a person (usr_… or an email), not %s; for a group, name one of its people", in.As)
					}
					q, err := e.subjectPrincipal(ctx, in.As)
					if err != nil {
						return nil, err
					}
					caller, via = q, "cli (as "+in.As+", by "+p.ID()+")"
				}
				var args any = map[string]any{}
				if in.Args != nil {
					args = norm(in.Args)
					if s, ok := in.Args.(string); ok {
						args = decodeJSON([]byte(s))
					}
				}
				v, err := e.A.Call(ctx, in.Store, in.Action, args, e.A.VisitorOf(ctx, caller, in.Store), via)
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
		verbs.Def[AppTrustIn, AppTrustOut]{Name: "app.trust", Doc: "Grant an app a Go module from the catalog (app.modules), with an optional configuration checked against the module's; restarts its actors. Trusted modules (system, workshop) must be declared in app.json slop.modules; modules on by default (database, express, fs, path) are only configured by a grant.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in AppTrustIn) (AppTrustOut, error) {
				ctx := req.Context
				p := req.Principal
				app := in.App
				mod, ok := e.A.Module(in.Module)
				if !ok {
					names := []string{}
					for _, m := range e.A.Modules() {
						names = append(names, m.Name)
					}
					return AppTrustOut{}, verbs.Errf("invalid_argument", "no module %q (%s)", in.Module, strings.Join(names, ", "))
				}
				r, err := e.K.Running(ctx, app)
				if err != nil || r.Manifest == nil {
					return AppTrustOut{}, verbs.Errf("not_found", "%s is not an app (no app.json)", app)
				}
				if mod.Class == actor.ClassTrusted && !slices.Contains(r.Manifest.Slop.Modules, mod.Name) {
					return AppTrustOut{}, verbs.Errf("invalid_argument", "%s does not declare %s in app.json slop.modules", app, mod.Name)
				}
				raw, err := json.Marshal(in.Config)
				if err != nil {
					return AppTrustOut{}, verbs.Errf("invalid_argument", "config: %v", err)
				}
				if in.Config == nil {
					raw = nil
				}
				config, err := mod.CanonicalConfig(raw)
				if err != nil {
					return AppTrustOut{}, verbs.Errf("invalid_argument", "%v", err)
				}
				if err := e.K.Gov.TrustModule(ctx, p.ID(), p.ViaLabel(), app, mod.Name, config); err != nil {
					return AppTrustOut{}, err
				}
				e.A.RestartApp(app) // use() is evaluated at start
				return AppTrustOut{App: app, Module: mod.Name, Trusted: true, Config: json.RawMessage(config)}, nil
			}}.Verb(),
		verbs.Def[AppUntrustIn, AppUntrustOut]{Name: "app.untrust", Doc: "Withdraw an app's grant of a Go module (a module on by default returns to its default configuration); restarts its actors.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
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
					row := map[string]any{"name": m.Name, "doc": m.Doc, "class": string(m.Class), "default": m.Class.Default()}
					if m.Config != nil {
						row["config"] = verbs.SchemaFor(m.Config)
					}
					if m.TypeScript != "" {
						row["typescript"] = m.TypeScript
					}
					reg = append(reg, row)
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
					calls := e.A.ModuleCalls(app)
					out.App, out.Declared, out.Calls = &app, &declared, &calls
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
				rows, err := s.ReadQuery(ctx, `SELECT a.name, a.at, a.every, a.running, r.at AS last_at, r.now AS last_now,
					r.via AS last_via, r.ok AS last_ok, r.error AS last_error, r.late AS last_late
					FROM _alarms a LEFT JOIN _alarm_runs r USING (name) ORDER BY a.at`)
				if err != nil {
					return nil, err
				}
				return alarmRows(rows, time.Now()), nil
			}}.Verb(),
		verbs.Def[AlarmFireIn, AlarmFireOut]{Name: "alarm.fire", Doc: "Fire a store's alarm now.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in AlarmFireIn) (AlarmFireOut, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "firing alarms")
				if err != nil {
					return AlarmFireOut{}, err
				}
				rows, err := s.ReadQuery(ctx, `SELECT at, every FROM _alarms WHERE name = ?`, in.Name)
				if err != nil {
					return AlarmFireOut{}, err
				}
				if len(rows) == 0 {
					return AlarmFireOut{}, &verbs.Error{Code: "not_found", Message: in.Store + " has no alarm " + strconvQuote(in.Name) + "; slop alarm ls " + in.Store + " lists them"}
				}
				spec, _ := rows[0]["every"].(string)
				at, err := fireTime(in.At, spec, toMillis(rows[0]["at"]), time.Now())
				if err != nil {
					return AlarmFireOut{}, err
				}
				start := time.Now().UnixMilli()
				if err := e.A.FireAt(ctx, in.Store, in.Name, at); err != nil {
					return AlarmFireOut{}, actorErr(err)
				}
				out := AlarmFireOut{Fired: in.Name, Status: "running"}
				if at != 0 {
					out.Now = time.UnixMilli(at).In(actor.ScheduleZone(spec)).Format(time.RFC3339)
				}
				// Wait (up to 15 s) for the handler to end, so the answer says
				// whether it worked; slop alarm ls shows it later too.
				for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
					r, err := s.ReadQuery(ctx, `SELECT ok, error FROM _alarm_runs WHERE name = ? AND at >= ?`, in.Name, start)
					if err != nil || ctx.Err() != nil {
						break
					}
					if len(r) > 0 {
						out.Status = "ok"
						if toMillis(r[0]["ok"]) == 0 {
							out.Status, out.Error = "failed", fmt.Sprint(r[0]["error"])
						}
						break
					}
				}
				return out, nil
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
		verbs.Def[BindSetIn, registry.Binding]{Name: "bind.set", Doc: "Point a store's read alias at another store (grant store:<store> view there for actors); with --prefix, also map it into the store's pages' db: <alias>/… reads the target's <prefix>/… as the viewer, at most at --level. --prefix needs the viewer to hold a grant on the target, which lets them read those records anywhere: for totals of records viewers must not see, read them in the actor (slop help capability-db).", Scope: verbs.Write, Action: authz.StoreAdmin,
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
	As     string `json:"as,omitempty" jsonschema_description:"anonymous, or a person (usr_… or an email): run the action as them, with their level, audience and LLM access (platform admins), to test what they get"`
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
	// Config is the module's configuration (its schema is in app.modules).
	Config map[string]any `json:"config,omitempty"`
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
	At    string `json:"at,omitempty" jsonschema_description:"run it as if it were this time (ctx.now): next (its next scheduled run), HH:MM (the next such time in the schedule's zone), or RFC 3339; the store's data timestamps stay real"`
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
	App     string          `json:"app"`
	Module  string          `json:"module"`
	Trusted bool            `json:"trusted"`
	Config  json.RawMessage `json:"config"`
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
	Fired  string `json:"fired"`
	Now    string `json:"now,omitempty"`   // the ctx.now its handler saw (--at)
	Status string `json:"status"`          // ok, failed, or running (still going after 15 s)
	Error  string `json:"error,omitempty"` // the handler's error, when it failed
}

// BindRmOut is bind.rm's result.
type BindRmOut struct {
	Removed string `json:"removed"`
}

// AppModulesOut is app.modules's result.
type AppModulesOut struct {
	App      *string            `json:"app,omitempty"`
	Declared *[]string          `json:"declared,omitempty"`
	Calls    *map[string]int64  `json:"calls,omitempty"` // module calls since the process started (one app)
	Modules  []map[string]any   `json:"modules"`
	Trusted  []policy.AppModule `json:"trusted"`
}

func strconvQuote(s string) string { return strconv.Quote(s) }

func toMillis(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case int:
		return int64(x)
	case float64:
		return int64(x)
	}
	n, _ := strconv.ParseInt(fmt.Sprint(v), 10, 64)
	return n
}

// alarmRows is alarm.ls's answer: each alarm's next run as a time in the
// zone its schedule runs in, and how its last run went.
func alarmRows(rows []map[string]any, now time.Time) []map[string]any {
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		spec, _ := r["every"].(string)
		loc := actor.ScheduleZone(spec)
		at := time.UnixMilli(toMillis(r["at"])).In(loc)
		o := map[string]any{"name": r["name"], "at": r["at"], "every": r["every"], "running": r["running"],
			"next": at.Format("2006-01-02 15:04 MST"), "zone": actor.ZoneName(loc), "in": until(at.Sub(now))}
		if r["last_at"] != nil {
			last := time.UnixMilli(toMillis(r["last_at"])).In(loc)
			o["last"] = last.Format("2006-01-02 15:04 MST")
			o["lastVia"] = r["last_via"]
			o["lastOk"] = toMillis(r["last_ok"]) == 1
			if r["last_error"] != nil {
				o["lastError"] = r["last_error"]
			}
			if toMillis(r["last_late"]) == 1 {
				o["lastLate"] = true
			}
			if n := toMillis(r["last_now"]); n != toMillis(r["last_at"]) && n != 0 {
				o["lastAsOf"] = time.UnixMilli(n).In(loc).Format("2006-01-02 15:04 MST") // fired with --at
			}
		}
		out = append(out, o)
	}
	return out
}

func until(d time.Duration) string {
	if d < 0 {
		return "due"
	}
	d = d.Round(time.Minute)
	if d < time.Minute {
		return "under a minute"
	}
	h, m := int(d.Hours()), int(d.Minutes())%60
	switch {
	case h >= 48:
		return fmt.Sprintf("%dd %dh", h/24, h%24)
	case h > 0:
		return fmt.Sprintf("%dh %dm", h, m)
	}
	return fmt.Sprintf("%dm", m)
}

// fireTime is the ctx.now of alarm fire --at (0: none): next (the alarm's
// next run), HH:MM (the next such time in the schedule's zone), or RFC 3339.
func fireTime(at, spec string, next int64, now time.Time) (int64, error) {
	at = strings.TrimSpace(at)
	loc := actor.ScheduleZone(spec)
	switch {
	case at == "":
		return 0, nil
	case at == "next":
		return next, nil
	}
	if t, err := time.Parse(time.RFC3339, at); err == nil {
		return t.UnixMilli(), nil
	}
	if t, err := time.ParseInLocation("2006-01-02 15:04", at, loc); err == nil {
		return t.UnixMilli(), nil
	}
	if t, err := time.ParseInLocation("15:04", at, loc); err == nil {
		n := now.In(loc)
		d := time.Date(n.Year(), n.Month(), n.Day(), t.Hour(), t.Minute(), 0, 0, loc)
		if !d.After(n) {
			d = d.AddDate(0, 0, 1)
		}
		return d.UnixMilli(), nil
	}
	return 0, &verbs.Error{Code: "invalid_argument", Message: "--at " + strconv.Quote(at) + ": give next, HH:MM (e.g. 07:00), \"YYYY-MM-DD HH:MM\" or RFC 3339 (2026-11-26T07:00:00-05:00)"}
}
