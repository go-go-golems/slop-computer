package verbs

import (
	"context"
	"errors"
	"slices"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/apps"
	"github.com/go-go-golems/slop/pkg/rt"
	"github.com/go-go-golems/slop/pkg/store"
	"github.com/go-go-golems/slop/pkg/system"
)

func init() {
	hostArg := Arg{Name: "host", Type: "string", Pos: 1, Required: true}
	pathArg := Arg{Name: "path", Type: "string", Pos: 2, Required: true}
	Register(
		&Verb{Name: "mount.ls", Doc: "List mounts (of one host).", Scope: Read,
			Args: []Arg{{Name: "host", Type: "string", Pos: 1}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				ms, err := e.Sys.Mounts(ctx, a.S("host"))
				if err != nil {
					return nil, err
				}
				out := []map[string]any{}
				for _, m := range ms {
					out = append(out, map[string]any{"mount": m, "kind": e.Cfg.HostKind(m.Host), "url": e.Cfg.Origin(m.Host) + m.Path})
				}
				return out, nil
			}},
		&Verb{Name: "mount.set", Doc: "Mount a store (or a :param naming stores) at host+path. A host is live or static, set in configuration.", Scope: Write, AdminOnly: true,
			Args: []Arg{hostArg, pathArg, {Name: "store", Type: "string", Pos: 3},
				{Name: "storeParam", Type: "string", Doc: "the path parameter naming the store, e.g. store for /r/:store"},
				{Name: "type", Type: "string", Doc: "with storeParam: the store type required"},
				{Name: "createApp", Type: "string", Doc: "live hosts: offer to create a store of this app"},
				{Name: "createAudience", Type: "string", Doc: "who may create: member (default), subscriber or admin"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				m := system.Mount{Host: a.S("host"), Path: a.S("path"), Store: a.S("store"), StoreParam: a.S("storeParam"),
					Type: a.S("type"), CreateApp: a.S("createApp"), CreateAudience: a.S("createAudience")}
				if err := checkMount(ctx, e, &m); err != nil {
					return nil, err
				}
				m, err := e.Sys.SetMount(ctx, p.ID(), p.ViaLabel(), m)
				if err != nil {
					return nil, err
				}
				out := map[string]any{"mount": m, "url": e.Cfg.Origin(m.Host) + m.Path}
				if m.Store != "" {
					if d, _, _ := e.K.Access.Can(ctx, nil, m.Store, rt.LevelView, "", true); !d.OK {
						out["note"] = "guests cannot read " + m.Store + ": signed-in visitors with a grant can; grant @guest view to make it public"
						if e.Cfg.HostKind(m.Host) == "static" {
							out["note"] = "a static host serves guests only, and guests cannot read " + m.Store + ": grant @guest view to publish it"
						}
					}
				}
				return out, nil
			}},
		&Verb{Name: "mount.rm", Doc: "Remove a mount (mount undo brings it back).", Scope: Write, AdminOnly: true,
			Args: []Arg{hostArg, pathArg},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				err := e.Sys.RemoveMount(ctx, p.ID(), p.ViaLabel(), a.S("host"), a.S("path"))
				if errors.Is(err, system.ErrNotFound) {
					return nil, Errf("not_found", "nothing is mounted at %s%s", a.S("host"), a.S("path"))
				}
				return map[string]any{"removed": a.S("host") + a.S("path")}, err
			}},
		&Verb{Name: "mount.undo", Doc: "Restore a mount to its value before its last change.", Scope: Write, AdminOnly: true,
			Args: []Arg{hostArg, pathArg},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				m, err := e.Sys.UndoMount(ctx, p.ID(), p.ViaLabel(), a.S("host"), a.S("path"))
				if errors.Is(err, system.ErrNotFound) {
					return nil, Errf("not_found", "no history for %s%s", a.S("host"), a.S("path"))
				}
				if err != nil {
					return nil, err
				}
				return map[string]any{"restored": m}, nil
			}},
		&Verb{Name: "app.status", Doc: "The app a store runs: app store, snapshot, manifest, and why it is broken if it is.", Scope: Read,
			Args: []Arg{{Name: "store", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				st, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "reading")
				if err != nil {
					return nil, err
				}
				r, err := e.K.Running(ctx, a.S("store"))
				if err != nil {
					return nil, err
				}
				out := map[string]any{"store": r.Store, "app": r.App, "ref": st.Meta("app_ref"), "n": r.N, "broken": r.Broken}
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
			}},
		&Verb{Name: "app.ls", Doc: "List the stores that are apps (their tree's main snapshot holds app.json).", Scope: Read,
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				rows, err := visibleStores(ctx, e, p)
				if p.IsAdmin() {
					rows, err = e.Sys.Stores(ctx, "")
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
			}},
	)
}

// checkMount validates a mount against the host's kind and the store.
func checkMount(ctx context.Context, e *Env, m *system.Mount) error {
	kind := e.Cfg.HostKind(m.Host)
	if kind != "live" && kind != "static" {
		return Errf("invalid_argument", "%s is not a live or static host in this server's configuration", m.Host)
	}
	if !system.ValidMountPath(m.Path) {
		return Errf("invalid_argument", "a mount path is /, /name, /name/:param or /name/*")
	}
	if (m.Store == "") == (m.StoreParam == "") {
		return Errf("invalid_argument", "give a store, or storeParam (a :param of the path)")
	}
	if m.StoreParam != "" && !slices.Contains(splitSegs(m.Path), ":"+m.StoreParam) {
		return Errf("invalid_argument", "the path has no :%s", m.StoreParam)
	}
	if m.Store != "" && (m.Type != "" || m.CreateApp != "") {
		return Errf("invalid_argument", "type and createApp go with storeParam")
	}
	if m.CreateApp != "" {
		if kind != "live" {
			return Errf("invalid_argument", "stores are created from the URL on live hosts only")
		}
		r, err := e.K.Running(ctx, m.CreateApp)
		if err != nil || r.Manifest == nil {
			return Errf("invalid_argument", "createApp %s is not an app", m.CreateApp)
		}
		if m.CreateAudience == "" {
			m.CreateAudience = string(access.AudMember)
		}
		if !slices.Contains([]string{"member", "subscriber", "admin"}, m.CreateAudience) {
			return Errf("invalid_argument", "createAudience is member, subscriber or admin")
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
		return Errf("not_found", "no store %s", m.Store)
	}
	switch {
	case kind == "static" && r.Manifest.Live():
		return Errf("invalid_argument", "%s runs a live app (capabilities or an actor): mount it on a live host", m.Store)
	case kind == "live" && !r.Manifest.Live():
		return Errf("invalid_argument", "%s is plain content: mount it on a static host", m.Store)
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

// needCodeRight enforces decision D9: only admins write app code, meaning
// the tree or refs of a store whose tree holds app.json (or a push that
// adds one).
func needCodeRight(ctx context.Context, s *store.Store, p *access.Principal, paths ...string) error {
	if p.IsAdmin() {
		return nil
	}
	isApp := slices.Contains(paths, apps.File)
	if !isApp {
		if _, err := s.File(ctx, "tree", apps.File); err == nil {
			isApp = true
		}
	}
	if !isApp {
		if n, err := s.Ref(ctx, "main"); err == nil {
			if _, err := s.SnapshotFile(ctx, n, apps.File); err == nil {
				isApp = true
			}
		}
	}
	if isApp {
		return Errf("permission_denied", "only admins push app code (this tree holds app.json; decision D9)")
	}
	return nil
}
