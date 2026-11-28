package commands

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func mountVerbs(e mountEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[ServerHostsIn, ServerHostsOut]{Name: "server.hosts", Doc: "This server's hosts: main, live, static and sandbox.", Scope: verbs.Read, Action: authz.Platform,
			Run: func(req verbs.Req, in ServerHostsIn) (ServerHostsOut, error) {
				h := e.Cfg.Hosts
				return ServerHostsOut{Main: h.Main, Live: h.Live, Static: h.Static, Sandbox: h.Sandbox}, nil
			}}.Verb(),
		verbs.Def[MountLsIn, []map[string]any]{Name: "mount.ls", Doc: "List mounts (of one host).", Scope: verbs.Read, Action: authz.Platform,
			Run: func(req verbs.Req, in MountLsIn) ([]map[string]any, error) {
				ctx := req.Context
				ms, err := e.K.Registry.Mounts(ctx, in.Host)
				if err != nil {
					return nil, err
				}
				// --host apps.localhost on a server whose host is
				// apps.localhost:8080: match the name without the port, not
				// nothing (SLOP3-026, persona round 1 read [] as "no mounts").
				if len(ms) == 0 && in.Host != "" && !strings.Contains(in.Host, ":") {
					all, err := e.K.Registry.Mounts(ctx, "")
					if err != nil {
						return nil, err
					}
					for _, m := range all {
						if h, _, ok := strings.Cut(m.Host, ":"); ok && h == in.Host {
							ms = append(ms, m)
						}
					}
				}
				out := []map[string]any{}
				for _, m := range ms {
					out = append(out, map[string]any{"mount": m, "kind": e.Cfg.HostKind(m.Host), "url": e.Cfg.Origin(m.Host) + m.Path})
				}
				return out, nil
			}}.Verb(),
		verbs.Def[MountSetIn, MountSetOut]{Name: "mount.set", Doc: "Mount a store (or a :param naming stores) at host+path. A host is live or static, set in configuration.",
			Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(r verbs.Req, in MountSetIn) (MountSetOut, error) {
				e, p := e, r.Principal
				m := registry.Mount{Host: in.Host, Path: in.Path, Store: in.Store, StoreParam: in.StoreParam,
					Type: in.Type, CreateApp: in.CreateApp, CreateAudience: in.CreateAudience, API: in.API}
				if err := checkMount(r, e, &m); err != nil {
					return MountSetOut{}, err
				}
				t, err := aliasTemplate(r, e, p, in.Aliases, m)
				if err != nil {
					return MountSetOut{}, err
				}
				m.Aliases = t
				before := e.mountAt(r, m.Host, m.Path)
				m, err = e.K.Registry.SetMount(r, p.ID(), p.ViaLabel(), m)
				if err != nil {
					return MountSetOut{}, err
				}
				e.restartServed(r, before, &m)
				out := MountSetOut{Mount: m, URL: e.Cfg.Origin(m.Host) + m.Path}
				if m.Store != "" {
					if d, _, _ := e.K.Access.Can(r, nil, m.Store, rt.LevelView, "", true); !d.OK {
						out.Note = "guests cannot read " + m.Store + ": signed-in visitors with a grant can; grant @guest view to make it public"
						if e.Cfg.HostKind(m.Host) == "static" {
							out.Note = "a static host serves guests only, and guests cannot read " + m.Store + ": grant @guest view to publish it"
						}
					}
				}
				return out, nil
			}}.Verb(),
		verbs.Def[MountRmIn, MountRmOut]{Name: "mount.rm", Doc: "Remove a mount (mount undo brings it back).", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in MountRmIn) (MountRmOut, error) {
				ctx := req.Context
				p := req.Principal
				before := e.mountAt(ctx, in.Host, in.Path)
				err := e.K.Registry.RemoveMount(ctx, p.ID(), p.ViaLabel(), in.Host, in.Path)
				if errors.Is(err, sysdb.ErrNotFound) {
					return MountRmOut{}, verbs.Errf("not_found", "nothing is mounted at %s%s", in.Host, in.Path)
				}
				if err == nil {
					e.restartServed(ctx, before, nil)
				}
				return MountRmOut{Removed: in.Host + in.Path}, err
			}}.Verb(),
		verbs.Def[MountUndoIn, MountUndoOut]{Name: "mount.undo", Doc: "Restore a mount to its value before its last change.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in MountUndoIn) (MountUndoOut, error) {
				ctx := req.Context
				p := req.Principal
				before := e.mountAt(ctx, in.Host, in.Path)
				m, err := e.K.Registry.UndoMount(ctx, p.ID(), p.ViaLabel(), in.Host, in.Path)
				if errors.Is(err, sysdb.ErrNotFound) {
					return MountUndoOut{}, verbs.Errf("not_found", "no history for %s%s", in.Host, in.Path)
				}
				if err != nil {
					return MountUndoOut{}, err
				}
				e.restartServed(ctx, before, m)
				return MountUndoOut{Restored: m}, nil
			}}.Verb(),
		verbs.Def[MountRoutesIn, []MountRoute]{Name: "mount.routes", Doc: "The actor routes a mount serves: each route key of the store, whether the mount's API policy allows it, and the level and audiences it needs there.",
			Scope: verbs.Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in MountRoutesIn) ([]MountRoute, error) {
				return e.mountRoutes(req.Context, in)
			}}.Verb(),
		verbs.Def[AppStatusIn, AppStatusOut]{Name: "app.status", Doc: "The app a store runs: app store, snapshot, manifest, and why it is broken if it is.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in AppStatusIn) (AppStatusOut, error) {
				ctx := req.Context
				p := req.Principal
				st, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading")
				if err != nil {
					return AppStatusOut{}, err
				}
				out, err := statusOf(ctx, e.kernelEnv, e.A, st, in.Store, in.Peek)
				if err != nil || !in.Migrations {
					return out, err
				}
				rows, err := st.ReadQuery(ctx, `SELECT name, sha256 FROM _migrations`)
				if err != nil {
					return AppStatusOut{}, err
				}
				out.Applied = map[string]string{}
				for _, r := range rows {
					out.Applied[fmt.Sprint(r["name"])] = fmt.Sprint(r["sha256"])
				}
				// Pending: migrations in the newest snapshot (one that failed,
				// or that activates on next use) that have not run here.
				newest := max(out.N, out.FailedN, out.Next)
				if as, err := e.K.Store(ctx, out.App); err == nil && newest > 0 {
					files, _ := as.SnapshotFiles(ctx, newest)
					for _, f := range files {
						if strings.HasPrefix(f.Path, "sql/") && strings.HasSuffix(f.Path, ".sql") {
							if _, done := out.Applied[f.Path]; !done {
								out.Pending = append(out.Pending, f.Path)
							}
						}
					}
				}
				return out, nil
			}}.Verb(),
		verbs.Def[StoreShowIn, map[string]any]{Name: "store.show", Doc: "Everything about one store in one answer: the app it runs and where its code is, where it is mounted, its data (collections, SQL tables), grants, aliases, actions and alarms, and what to run next.", Scope: verbs.Read, Action: authz.StoreRead, StoreArg: "store",
			Run: func(req verbs.Req, in StoreShowIn) (map[string]any, error) {
				return e.show(req.Context, req.Principal, in.Store)
			}}.Verb(),
		verbs.Def[AppLsIn, []map[string]any]{Name: "app.ls", Doc: "List the stores that are apps (their tree's main snapshot holds app.json).", Scope: verbs.Read, Action: authz.Platform,
			Run: func(req verbs.Req, in AppLsIn) ([]map[string]any, error) {
				ctx := req.Context
				p := req.Principal
				rows, err := e.K.VisibleStores(ctx, p)
				if p.IsAdmin() {
					rows, err = e.K.Registry.Stores(ctx, "")
				}
				if err != nil {
					return nil, err
				}
				out := []map[string]any{}
				for _, row := range rows {
					if row.App != "" {
						continue
					}
					r, err := e.K.Running(ctx, row.ID)
					if err != nil || r.Manifest == nil {
						continue
					}
					out = append(out, map[string]any{"app": row.ID, "title": r.Manifest.Title, "type": r.Manifest.Type, "n": r.N, "live": r.Manifest.Live()})
				}
				return out, nil
			}}.Verb(),
	}
}

// checkMount validates a mount against the host's kind and the store.
func checkMount(ctx context.Context, e mountEnv, m *registry.Mount) error {
	kind := e.Cfg.HostKind(m.Host)
	if kind != "live" && kind != "static" {
		return verbs.Errf("invalid_argument", "%s is not a live or static host in this server's configuration", m.Host)
	}
	if !registry.ValidMountPath(m.Path) {
		return verbs.Errf("invalid_argument", "a mount path is /, /name, /name/:param or /name/*")
	}
	if m.API != nil {
		if kind != "live" {
			return verbs.Errf("invalid_argument", "an API policy goes on a live host: static hosts serve no actor routes to visitors")
		}
		if err := registry.ValidateAPI(m.API); err != nil {
			return verbs.Errf("invalid_argument", "api: %v", err)
		}
	}
	if (m.Store == "") == (m.StoreParam == "") {
		return verbs.Errf("invalid_argument", "give a store, or storeParam (a :param of the path)")
	}
	if m.StoreParam != "" && !slices.Contains(splitSegs(m.Path), ":"+m.StoreParam) {
		return verbs.Errf("invalid_argument", "the path has no :%s", m.StoreParam)
	}
	if m.Store != "" && (m.Type != "" || m.CreateApp != "") {
		return verbs.Errf("invalid_argument", "type and createApp go with storeParam")
	}
	if m.CreateApp != "" {
		if kind != "live" {
			return verbs.Errf("invalid_argument", "stores are created from the URL on live hosts only")
		}
		r, err := e.K.Running(ctx, m.CreateApp)
		if err != nil || r.Manifest == nil {
			return verbs.Errf("invalid_argument", "createApp %s is not an app", m.CreateApp)
		}
		if m.CreateAudience == "" {
			m.CreateAudience = string(access.AudMember)
		}
		if !slices.Contains([]string{"member", "subscriber", "admin"}, m.CreateAudience) {
			return verbs.Errf("invalid_argument", "createAudience is member, subscriber or admin")
		}
		if m.Type == "" {
			m.Type = r.Manifest.Type
		}
	}
	if m.Store == "" {
		return nil
	}
	r, err := e.K.Running(ctx, m.Store)
	if err != nil {
		return verbs.Errf("not_found", "no store %s", m.Store)
	}
	switch {
	case kind == "static" && r.Manifest.Live():
		return verbs.Errf("invalid_argument", "%s runs a live app (capabilities or an actor): mount it on a live host", m.Store)
	case kind == "live" && !r.Manifest.Live():
		// Say why it looks like plain content: often its app has not been
		// pushed, or its newest app.json did not activate (P-6: a manifest
		// that did not parse sent the person to the static host).
		switch {
		case r.N == 0:
			return verbs.Errf("invalid_argument", "%s has nothing pushed yet: push the app first (slop push <dir> --store %s), then mount it", m.Store, m.Store)
		case r.Failed != nil:
			return verbs.Errf("invalid_argument", "%s's newest version (snapshot %d) did not activate: %s; fix it and push again (slop app status %s)", m.Store, r.Failed.N, r.Failed.Why, m.Store)
		}
		return verbs.Errf("invalid_argument", "%s is plain content (its app.json declares no capabilities and no actor): mount it on a static host, or add capabilities to app.json and push", m.Store)
	}
	return nil
}

func splitSegs(p string) []string {
	out := []string{}
	for _, s := range splitSlash(p) {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

func splitSlash(p string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(p); i++ {
		if i == len(p) || p[i] == '/' {
			out = append(out, p[start:i])
			start = i + 1
		}
	}
	return out
}

// aliasTemplate reads mount.set's aliases: the bindings each store the mount
// creates gets (SLOP3-008 phase 4), checked as bind.set checks them, against
// the admin setting the mount (who must hold what they template).
func aliasTemplate(ctx context.Context, e mountEnv, p *access.Principal, in []AliasIn, m registry.Mount) ([]registry.Binding, error) {
	if len(in) > 0 && m.CreateApp == "" {
		return nil, verbs.Errf("invalid_argument", "aliases go with createApp: they bind the stores a mount creates")
	}
	var out []registry.Binding
	seen := map[string]bool{}
	for _, x := range in {
		b := registry.Binding{Alias: x.Alias, Target: x.Target, Prefix: x.Prefix, Level: x.Level, Assets: x.Assets}
		if seen[b.Alias] {
			return nil, verbs.Errf("invalid_argument", "alias %s is listed twice", b.Alias)
		}
		seen[b.Alias] = true
		if err := checkAlias(ctx, e.kernelEnv, p, &b); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}

// MountSetIn is mount.set's input.
type MountSetIn struct {
	Host           string             `json:"host" slop:"pos=1" jsonschema_description:"a live or static host from the configuration"`
	Path           string             `json:"path" slop:"pos=2" jsonschema_description:"the path pattern: /guestbook, /r/:store, /docs/*"`
	Store          string             `json:"store,omitempty" slop:"pos=3" jsonschema_description:"the store mounted (or storeParam)"`
	StoreParam     string             `json:"storeParam,omitempty" jsonschema_description:"the path parameter naming the store, e.g. store for /r/:store"`
	Type           string             `json:"type,omitempty" jsonschema_description:"with storeParam: the store type required"`
	CreateApp      string             `json:"createApp,omitempty" jsonschema_description:"live hosts: offer to create a store of this app"`
	CreateAudience string             `json:"createAudience,omitempty" jsonschema:"enum=member,enum=subscriber,enum=admin" jsonschema_description:"who may create (default member)"`
	Aliases        []AliasIn          `json:"aliases,omitempty" jsonschema_description:"with createApp: bind each store created here"`
	API            *registry.MountAPI `json:"api,omitempty" jsonschema_description:"live hosts: the mount's API policy (route allowlist, floors, host middlewares, request and response rules); omit to serve every actor route"`
}

// MountRoutesIn is mount.routes's input.
type MountRoutesIn struct {
	Host  string `json:"host" slop:"pos=1"`
	Path  string `json:"path" slop:"pos=2"`
	Store string `json:"store,omitempty" slop:"pos=3" jsonschema_description:"for a :param mount: the store to list"`
}

// MountRoute is one actor route as a mount serves it.
type MountRoute struct {
	Store          string   `json:"store"`
	Key            string   `json:"key"`
	Allowed        bool     `json:"allowed"`        // the mount's allowlist covers the key (always, without a policy)
	DeclaredLevel  string   `json:"declaredLevel"`  // what the app declared
	EffectiveLevel string   `json:"effectiveLevel"` // with the mount's floor
	Audiences      []string `json:"audiences"`      // groups the visitor must be in (the route's and the floor's)
}

// AliasIn is one entry of a mount's alias template: a binding without its
// store, which is the store the mount creates.
type AliasIn struct {
	Alias  string `json:"alias" jsonschema_description:"the name in the new store's pages"`
	Target string `json:"target" jsonschema_description:"the store it reaches"`
	Prefix string `json:"prefix,omitempty" jsonschema_description:"a collection path in the target"`
	Level  string `json:"level,omitempty" jsonschema:"enum=view,enum=interact,enum=admin" jsonschema_description:"with prefix: the most the alias gives (default view)"`
	Assets bool   `json:"assets,omitempty" jsonschema_description:"also show the target's uploads"`
}

// MountSetOut is mount.set's result.
type MountSetOut struct {
	Mount registry.Mount `json:"mount"`
	URL   string         `json:"url"`
	Note  string         `json:"note,omitempty"`
}

// ServerHostsIn is server.hosts's input.
type ServerHostsIn struct {
}

// MountLsIn is mount.ls's input.
type MountLsIn struct {
	Host string `json:"host,omitempty" slop:"pos=1"`
}

// MountRmIn is mount.rm's input.
type MountRmIn struct {
	Host string `json:"host" slop:"pos=1"`
	Path string `json:"path" slop:"pos=2"`
}

// MountUndoIn is mount.undo's input.
type MountUndoIn struct {
	Host string `json:"host" slop:"pos=1"`
	Path string `json:"path" slop:"pos=2"`
}

// AppStatusIn is app.status's input.
type AppStatusIn struct {
	Store      string `json:"store" slop:"pos=1"`
	Peek       bool   `json:"peek,omitempty" jsonschema_description:"do not activate: n is the version running now, next a newer one it activates on its next use"`
	Migrations bool   `json:"migrations,omitempty" jsonschema_description:"also list the migrations the store has applied (name: sha256), which a new version must not change"`
}

// AppLsIn is app.ls's input.
type AppLsIn struct {
}

// ServerHostsOut is server.hosts's result.
type ServerHostsOut struct {
	Live    []string `json:"live"`
	Main    string   `json:"main"`
	Sandbox string   `json:"sandbox"`
	Static  []string `json:"static"`
}

// MountRmOut is mount.rm's result.
type MountRmOut struct {
	Removed string `json:"removed"`
}

// MountUndoOut is mount.undo's result.
type MountUndoOut struct {
	Restored *registry.Mount `json:"restored"`
}

// AppStatusOut is app.status's result.
type AppStatusOut struct {
	App      string            `json:"app"`
	Broken   string            `json:"broken"`
	FailedN  int64             `json:"failedN,omitempty"`  // the snapshot that failed, when an older one still serves
	Manifest map[string]any    `json:"manifest,omitempty"` // set only to a non-empty object
	N        int64             `json:"n"`
	Next     int64             `json:"next,omitempty"`    // with peek: the version it activates on its next use
	Applied  map[string]string `json:"applied,omitempty"` // with migrations: sql/… name → sha256 of what ran
	Pending  []string          `json:"pending,omitempty"` // with migrations: in the newest snapshot, not yet run here
	Ref      string            `json:"ref"`
	Store    string            `json:"store"`
}

// statusOf is app.status for an opened store. Running activates a pending
// version, so asking is also how a store comes up on a new snapshot; peek
// only looks.
func statusOf(ctx context.Context, e kernelEnv, a *actor.Manager, st *store.Store, id string, peek bool) (AppStatusOut, error) {
	look := e.K.Running
	if peek {
		look = e.K.Peek
	}
	r, err := look(ctx, id)
	if err != nil {
		return AppStatusOut{}, err
	}
	out := AppStatusOut{Store: r.Store, App: r.App, Ref: st.Meta("app_ref"), N: r.N, Next: r.Next, Broken: r.Broken()}
	// The newest snapshot failed and an older one still serves: n and the
	// manifest below are that older one. Say so, or the manifest seems to
	// contradict the error (SLOP3-026, persona round 1).
	if f := r.Failed; f != nil && f.N != r.N {
		out.FailedN = f.N
		if r.N > 0 && r.Active {
			out.Broken = fmt.Sprintf("snapshot %d: %s (the store still serves snapshot %d: n and manifest are that one)", f.N, f.Why, r.N)
		} else {
			out.Broken = fmt.Sprintf("snapshot %d: %s", f.N, f.Why)
		}
	}
	if out.Broken == "" && a != nil {
		// a build that failed after activation (a mount's route
		// policy, SLOP3-012): "app@n: why"
		out.Broken = a.Broken(id)
	}
	if m := r.Manifest; m != nil {
		caps := []string{}
		for c := range m.Caps.Declared {
			caps = append(caps, c)
		}
		slices.Sort(caps)
		out.Manifest = (map[string]any{"title": m.Title, "page": m.Entry(), "actor": m.Actor, "type": m.Type,
			"capabilities": caps, "slop": m.Slop, "live": m.Live()})
	}
	return out, nil
}

// mountAt is the mount at host+path, or nil.
func (e mountEnv) mountAt(ctx context.Context, host, path string) *registry.Mount {
	ms, err := e.K.Registry.Mounts(ctx, host)
	if err != nil {
		return nil
	}
	for _, m := range ms {
		if m.Path == path {
			return &m
		}
	}
	return nil
}

// servedStores are the stores a mount can serve: the one it names, or every
// store of its :param's type (every store when it has no type).
func (e mountEnv) servedStores(ctx context.Context, m *registry.Mount) []string {
	if m == nil {
		return nil
	}
	if m.Store != "" {
		return []string{m.Store}
	}
	rows, err := e.K.Registry.Stores(ctx, "")
	if err != nil {
		return nil
	}
	var out []string
	for _, r := range rows {
		if m.Type == "" || r.Type == m.Type {
			out = append(out, r.ID)
		}
	}
	return out
}

// restartServed restarts the actors of the stores a changed mount served
// before or serves now, when the change involves an API policy (the
// effective route table and the load-time check depend on it), and any of
// those stores that is broken (a mount change can fix a route-policy
// failure). Restart also clears the broken cache and a failed activation.
func (e mountEnv) restartServed(ctx context.Context, before, after *registry.Mount) {
	if e.A == nil {
		return
	}
	policy := (before != nil && before.API != nil) || (after != nil && after.API != nil)
	seen := map[string]bool{}
	for _, m := range []*registry.Mount{before, after} {
		for _, id := range e.servedStores(ctx, m) {
			if seen[id] {
				continue
			}
			seen[id] = true
			broken := e.A.Broken(id) != ""
			if r, err := e.K.Running(ctx, id); err == nil && r.Broken() != "" {
				broken = true
			}
			if policy || broken {
				e.A.Restart(id)
				// Build it again now, so app.status shows a route-policy
				// failure (or its fix) at once, not at the next request.
				_, _ = e.A.Get(ctx, id)
			}
		}
	}
}

// mountRoutes lists the routes a mount serves, for review before or after
// setting its API policy.
func (e mountEnv) mountRoutes(ctx context.Context, in MountRoutesIn) ([]MountRoute, error) {
	m := e.mountAt(ctx, in.Host, in.Path)
	if m == nil {
		return nil, verbs.Errf("not_found", "nothing is mounted at %s%s", in.Host, in.Path)
	}
	if e.A == nil {
		return nil, verbs.Errf("unavailable", "this server runs no actors")
	}
	stores := e.servedStores(ctx, m)
	if in.Store != "" {
		if !slices.Contains(stores, in.Store) {
			return nil, verbs.Errf("invalid_argument", "%s%s does not serve %s", in.Host, in.Path, in.Store)
		}
		stores = []string{in.Store}
	} else if m.Store == "" {
		return nil, verbs.Errf("invalid_argument", "%s%s is a :%s mount: give the store to list", in.Host, in.Path, m.StoreParam)
	}
	out := []MountRoute{}
	for _, id := range stores {
		routes, err := e.A.Routes(ctx, id)
		if err != nil {
			return nil, err
		}
		for _, r := range routes {
			mr := MountRoute{Store: id, Key: r.Key, Allowed: true, DeclaredLevel: r.Level, EffectiveLevel: r.Level, Audiences: []string{}}
			if r.Audience != "" {
				mr.Audiences = append(mr.Audiences, r.Audience)
			}
			if m.API != nil {
				mr.Allowed = m.API.AllowsKey(r.Key)
				f := m.API.FloorOf(r.Key)
				mr.EffectiveLevel = registry.MaxLevel(r.Level, f.Min)
				if f.Audience != "" {
					mr.Audiences = append(mr.Audiences, f.Audience)
				}
			}
			out = append(out, mr)
		}
	}
	return out, nil
}

// StoreShowIn is store.show's input.
type StoreShowIn struct {
	Store string `json:"store" slop:"pos=1"`
}

// show is store.show: the questions a person new to a store asks (round
// js-3, the inheritor: store ls, mount ls, app status and explain can took
// four commands to say what /tasks is).
func (e mountEnv) show(ctx context.Context, p *access.Principal, id string) (map[string]any, error) {
	st, d, err := e.open(ctx, p, id, rt.LevelView, "reading")
	if err != nil {
		return nil, err
	}
	row, _ := e.K.Registry.StoreByID(ctx, id)
	out := map[string]any{"store": id, "type": row.Type, "owner": row.Owner, "level": d.LevelName(), "audience": d.Audience}
	next := []string{}
	status, err := statusOf(ctx, e.kernelEnv, e.A, st, id, true)
	if err == nil && status.N > 0 {
		app := map[string]any{"app": status.App, "snapshot": status.N, "broken": status.Broken}
		if m := status.Manifest; m != nil {
			app["title"], app["capabilities"], app["actor"], app["page"] = m["title"], m["capabilities"], m["actor"], m["page"]
			if out["type"] == "" {
				out["type"] = m["type"]
			}
		}
		if status.App == id {
			app["code"] = "in this store: slop pull " + id + " <dir>, edit, slop push <dir> --store " + id
		} else {
			app["code"] = "in the app store " + status.App + " (this store runs it): slop pull " + status.App + " <dir>"
		}
		out["app"] = app
		if status.Broken != "" {
			next = append(next, "slop app status "+id+" (why it is broken)")
		}
	} else {
		out["app"] = nil
		next = append(next, "nothing pushed yet: slop push <dir> --store "+id)
	}
	if ms, err := e.K.Registry.Mounts(ctx, ""); err == nil {
		urls := []string{}
		for _, m := range ms {
			if m.Store == id {
				urls = append(urls, e.Cfg.Origin(m.Host)+m.Path)
			}
		}
		out["mounted"] = urls
	}
	data := map[string]any{}
	colls, _ := st.Collections(ctx)
	data["collections"] = colls
	tables, _ := st.AppTables(ctx)
	data["tables"] = tables
	out["data"] = data
	if len(colls) > 0 {
		next = append(next, "slop docs ls "+id+" <collection>")
	}
	if len(tables) > 0 {
		next = append(next, "slop sql query "+id+" 'SELECT * FROM <table>'")
	}
	if bs, err := e.K.Registry.Bindings(ctx, id); err == nil && len(bs) > 0 {
		al := map[string]string{}
		for _, b := range bs {
			al[b.Alias] = b.Target
		}
		out["reads"] = al
	}
	if d.Level >= rt.LevelAdmin {
		if gs, err := e.K.Registry.Grants(ctx, id); err == nil {
			g := map[string]string{}
			for _, x := range gs {
				g[x.Subject] = x.Level
			}
			out["grants"] = g
		}
		if rows, err := st.ReadQuery(ctx, `SELECT a.name, a.at, a.every, a.running, r.at AS last_at, r.now AS last_now,
			r.via AS last_via, r.ok AS last_ok, r.error AS last_error, r.late AS last_late
			FROM _alarms a LEFT JOIN _alarm_runs r USING (name) ORDER BY a.at`); err == nil && len(rows) > 0 {
			out["alarms"] = alarmRows(rows, time.Now())
		}
	}
	if e.A != nil {
		if acts := e.A.Actions(ctx, id); len(acts) > 0 {
			slices.Sort(acts)
			out["actions"] = acts
			next = append(next, "slop call "+id+" <action> '{…}'")
		}
	}
	next = append(next, "slop explain can "+id+" view --subject @guest (who can open it)")
	out["next"] = next
	return out, nil
}
