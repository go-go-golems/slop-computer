package commands

import (
	"context"
	"errors"
	"slices"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func mountVerbs(e mountEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[ServerHostsIn, any]{Name: "server.hosts", Doc: "This server's hosts: main, live, static and sandbox.", Scope: verbs.Read, Action: authz.Platform,
			Run: func(req verbs.Req, in ServerHostsIn) (any, error) {
				h := e.Cfg.Hosts
				return map[string]any{"main": h.Main, "live": h.Live, "static": h.Static, "sandbox": h.Sandbox}, nil
			}}.Verb(),
		verbs.Def[MountLsIn, any]{Name: "mount.ls", Doc: "List mounts (of one host).", Scope: verbs.Read, Action: authz.Platform,
			Run: func(req verbs.Req, in MountLsIn) (any, error) {
				ctx := req.Context
				ms, err := e.K.Registry.Mounts(ctx, in.Host)
				if err != nil {
					return nil, err
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
					Type: in.Type, CreateApp: in.CreateApp, CreateAudience: in.CreateAudience}
				if err := checkMount(r, e, &m); err != nil {
					return MountSetOut{}, err
				}
				t, err := aliasTemplate(r, e, p, in.Aliases, m)
				if err != nil {
					return MountSetOut{}, err
				}
				m.Aliases = t
				m, err = e.K.Registry.SetMount(r, p.ID(), p.ViaLabel(), m)
				if err != nil {
					return MountSetOut{}, err
				}
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
		verbs.Def[MountRmIn, any]{Name: "mount.rm", Doc: "Remove a mount (mount undo brings it back).", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in MountRmIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				err := e.K.Registry.RemoveMount(ctx, p.ID(), p.ViaLabel(), in.Host, in.Path)
				if errors.Is(err, sysdb.ErrNotFound) {
					return nil, verbs.Errf("not_found", "nothing is mounted at %s%s", in.Host, in.Path)
				}
				return map[string]any{"removed": in.Host + in.Path}, err
			}}.Verb(),
		verbs.Def[MountUndoIn, any]{Name: "mount.undo", Doc: "Restore a mount to its value before its last change.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in MountUndoIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				m, err := e.K.Registry.UndoMount(ctx, p.ID(), p.ViaLabel(), in.Host, in.Path)
				if errors.Is(err, sysdb.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no history for %s%s", in.Host, in.Path)
				}
				if err != nil {
					return nil, err
				}
				return map[string]any{"restored": m}, nil
			}}.Verb(),
		verbs.Def[AppStatusIn, any]{Name: "app.status", Doc: "The app a store runs: app store, snapshot, manifest, and why it is broken if it is.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in AppStatusIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				st, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading")
				if err != nil {
					return nil, err
				}
				r, err := e.K.Running(ctx, in.Store)
				if err != nil {
					return nil, err
				}
				out := map[string]any{"store": r.Store, "app": r.App, "ref": st.Meta("app_ref"), "n": r.N, "broken": r.Broken()}
				if m := r.Manifest; m != nil {
					caps := []string{}
					for c := range m.Caps.Declared {
						caps = append(caps, c)
					}
					slices.Sort(caps)
					out["manifest"] = map[string]any{"title": m.Title, "page": m.Entry(), "actor": m.Actor, "type": m.Type,
						"capabilities": caps, "slop": m.Slop, "live": m.Live()}
				}
				return out, nil
			}}.Verb(),
		verbs.Def[AppLsIn, any]{Name: "app.ls", Doc: "List the stores that are apps (their tree's main snapshot holds app.json).", Scope: verbs.Read, Action: authz.Platform,
			Run: func(req verbs.Req, in AppLsIn) (any, error) {
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
		return verbs.Errf("invalid_argument", "%s is plain content: mount it on a static host", m.Store)
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
	Host           string    `json:"host" slop:"pos=1" jsonschema_description:"a live or static host from the configuration"`
	Path           string    `json:"path" slop:"pos=2" jsonschema_description:"the path pattern: /guestbook, /r/:store, /docs/*"`
	Store          string    `json:"store,omitempty" slop:"pos=3" jsonschema_description:"the store mounted (or storeParam)"`
	StoreParam     string    `json:"storeParam,omitempty" jsonschema_description:"the path parameter naming the store, e.g. store for /r/:store"`
	Type           string    `json:"type,omitempty" jsonschema_description:"with storeParam: the store type required"`
	CreateApp      string    `json:"createApp,omitempty" jsonschema_description:"live hosts: offer to create a store of this app"`
	CreateAudience string    `json:"createAudience,omitempty" jsonschema:"enum=member,enum=subscriber,enum=admin" jsonschema_description:"who may create (default member)"`
	Aliases        []AliasIn `json:"aliases,omitempty" jsonschema_description:"with createApp: bind each store created here"`
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
	Store string `json:"store" slop:"pos=1"`
}

// AppLsIn is app.ls's input.
type AppLsIn struct {
}
