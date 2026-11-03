package commands

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/system"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func bytesReader(b []byte) *bytes.Reader { return bytes.NewReader(b) }

func storeVerbs(e *Env) []*verbs.Verb {
	return []*verbs.Verb{
		{Name: "store.ls", Doc: "List the stores you own or hold a grant on (admins: --all).", Scope: verbs.Read, Action: authz.Account,
			Args: []verbs.Arg{{Name: "all", Type: "bool", Doc: "every store (admins)"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				var rows []system.StoreRow
				var err error
				if a.B("all") {
					if !p.IsAdmin() {
						return nil, verbs.Errf("permission_denied", "only admins list every store")
					}
					rows, err = e.Sys.Stores(ctx, "")
				} else {
					rows, err = VisibleStores(ctx, e, p)
				}
				if err != nil {
					return nil, err
				}
				out := []map[string]any{}
				for _, r := range rows {
					d := e.K.Access.Level(ctx, p, r)
					out = append(out, map[string]any{"id": r.ID, "type": r.Type, "app": r.App, "owner": r.Owner,
						"createdAt": r.CreatedAt, "level": d.LevelName()})
				}
				return out, nil
			}},
		{Name: "store.new", Doc: "Make a store; you become its owner.", Scope: verbs.Write, Action: authz.StoreCreate,
			Args: []verbs.Arg{{Name: "id", Type: "string", Pos: 1, Doc: "lowercase slug; empty makes s-xxxxxxxx"},
				{Name: "type", Type: "string"}, {Name: "app", Type: "string", Doc: "the app store it runs"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if !e.K.Access.In(ctx, p, access.GroupMember) {
					return nil, verbs.Errf("permission_denied", "only members make stores")
				}
				row, _, err := e.K.CreateStore(ctx, p, kernel.NewStore{ID: a.S("id"), Type: a.S("type"), App: a.S("app")})
				if errors.Is(err, system.ErrExists) {
					return nil, verbs.Errf("conflict", "store %s exists", a.S("id"))
				}
				if err != nil {
					return nil, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				return row, nil
			}},
		{Name: "store.rm", Doc: "Delete a store, its documents, files and grants. Owners and admins only.", Scope: verbs.Write, Action: authz.StoreAdmin, StoreArg: "id",
			Args: []verbs.Arg{{Name: "id", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				need := rt.LevelOwner
				if p.IsAdmin() {
					need = rt.LevelAdmin
				}
				if _, _, err := e.open(ctx, p, a.S("id"), need, "deleting"); err != nil {
					return nil, err
				}
				if err := e.K.DeleteStore(ctx, p, a.S("id")); err != nil {
					return nil, err
				}
				return map[string]any{"deleted": a.S("id")}, nil
			}},
		{Name: "store.type", Doc: "Set a store's type, which decides the typed mounts that serve it (/b/:id --type blocks); empty clears it. Admins only.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []verbs.Arg{{Name: "id", Type: "string", Pos: 1, Required: true}, {Name: "type", Type: "string", Pos: 2, Doc: "the new type; empty clears it"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				row, err := e.K.SetStoreType(ctx, p, a.S("id"), a.S("type"))
				if errors.Is(err, system.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no store %s", a.S("id"))
				}
				return row, err
			}},
		{Name: "store.meta", Doc: "A store's settings, head rev, sizes and your level on it.", Scope: verbs.Read, Action: authz.StoreRead, StoreArg: "id",
			Args: []verbs.Arg{{Name: "id", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				s, d, err := e.open(ctx, p, a.S("id"), rt.LevelView, "reading")
				if err != nil {
					return nil, err
				}
				row, _ := e.Sys.StoreByID(ctx, s.ID)
				colls, _ := s.Collections(ctx)
				refs, _ := s.Refs(ctx)
				return map[string]any{"store": row, "meta": s.AllMeta(), "head": s.Head(), "docs": s.CountDocs(ctx),
					"collections": colls, "refs": refs, "level": d.LevelName(), "audience": d.Audience}, nil
			}},
		{Name: "grant.ls", Doc: "List a store's grants.", Scope: verbs.Read, Action: authz.StoreAdmin,
			Args: []verbs.Arg{{Name: "store", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "listing grants"); err != nil {
					return nil, err
				}
				gs, err := e.Sys.Grants(ctx, a.S("store"))
				if err != nil {
					return nil, err
				}
				st, err := e.Sys.StoreByID(ctx, a.S("store"))
				if err != nil {
					return nil, err
				}
				for i := range gs {
					gs[i].Inactive = e.K.Access.GrantInactive(ctx, gs[i], st)
				}
				return gs, nil
			}},
		verbs.Def[GrantSetIn, system.Grant]{Name: "grant.set", Doc: "Give a subject (usr_…, vis_…, store:<id>, @guest, @member, @subscriber) a level on a store.",
			Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(r verbs.Req, in GrantSetIn) (system.Grant, error) {
				e, p := e, r.Principal
				_, d, err := e.open(r, p, in.Store, rt.LevelAdmin, "granting")
				if err != nil {
					return system.Grant{}, err
				}
				if !validSubject(in.Subject) {
					return system.Grant{}, verbs.Errf("invalid_argument", "a subject is usr_…, vis_…, store:<id>, @guest, @member or @subscriber")
				}
				lvl, ok := rt.ParseLevel(in.Level)
				if !ok || lvl == rt.LevelSelf {
					return system.Grant{}, verbs.Errf("invalid_argument", "level must be view, interact, admin or owner")
				}
				if lvl > d.Level {
					return system.Grant{}, &verbs.Error{Code: "permission_denied", Message: "you cannot grant more than your own level", Trace: d.Trace}
				}
				g, err := e.Sys.SetGrant(r, p.ID(), p.ViaLabel(), system.Grant{Store: in.Store, Subject: in.Subject, Level: in.Level})
				return g, err
			}}.Verb(),
		{Name: "grant.rm", Doc: "Remove a subject's grants on a store.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Args: []verbs.Arg{{Name: "store", Type: "string", Pos: 1, Required: true}, {Name: "subject", Type: "string", Pos: 2, Required: true},
				{Name: "via", Type: "string", Doc: "only the grant made this way (direct, lnk_…)"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "revoking"); err != nil {
					return nil, err
				}
				n, err := e.Sys.RemoveGrant(ctx, p.ID(), p.ViaLabel(), a.S("store"), a.S("subject"), a.S("via"))
				return map[string]any{"removed": n}, err
			}},
		{Name: "log.show", Doc: "A store's commits after a rev (oldest first), or the newest ones.", Scope: verbs.Read, Action: authz.StoreRead,
			Args: []verbs.Arg{{Name: "store", Type: "string", Pos: 1, Required: true}, {Name: "after", Type: "int", Doc: "commits after this rev"},
				{Name: "limit", Type: "int", Doc: "at most this many (default 50)"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				s, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "reading the log")
				if err != nil {
					return nil, err
				}
				limit := int(a.I("limit", 50))
				if a.Has("after") {
					return s.Log(ctx, a.I("after", 0), limit)
				}
				return s.RecentLog(ctx, limit)
			}},
		{Name: "log.wait", Doc: "Wait for a store's commits after a rev: they return as soon as there is one, or an empty list after the timeout.", Scope: verbs.Read, Action: authz.StoreRead,
			Args: []verbs.Arg{{Name: "store", Type: "string", Pos: 1, Required: true}, {Name: "after", Type: "int", Required: true, Doc: "commits after this rev"},
				{Name: "timeout", Type: "int", Doc: "seconds (default 55, at most 300)"}, {Name: "limit", Type: "int", Doc: "at most this many (default 50)"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				s, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "reading the log")
				if err != nil {
					return nil, err
				}
				secs := a.I("timeout", 55)
				if secs < 0 || secs > 300 {
					return nil, verbs.Errf("invalid_argument", "the timeout is 0 to 300 seconds")
				}
				// Subscribe before reading, so a commit in between is not missed.
				woke := make(chan struct{}, 1)
				stop := e.K.Subscribe(func(c *store.Commit) {
					if c.Store == s.ID {
						select {
						case woke <- struct{}{}:
						default:
						}
					}
				})
				defer stop()
				timer := time.NewTimer(time.Duration(secs) * time.Second)
				defer timer.Stop()
				for {
					list, err := s.Log(ctx, a.I("after", 0), int(a.I("limit", 50)))
					if err != nil || len(list) > 0 {
						return list, err
					}
					select {
					case <-woke:
					case <-timer.C:
						return list, nil
					case <-ctx.Done():
						return list, nil
					}
				}
			}},
	}
}

func validSubject(s string) bool {
	switch {
	case s == "@guest", s == "@member", s == "@subscriber":
		return true
	case strings.HasPrefix(s, "usr_"), strings.HasPrefix(s, "vis_"):
		return len(s) > 4
	case strings.HasPrefix(s, "store:"):
		return system.ValidStoreID(s[6:])
	}
	return false
}

// VisibleStores lists what p owns or holds a grant on.
func VisibleStores(ctx context.Context, e *Env, p *access.Principal) ([]system.StoreRow, error) {
	aud := e.K.Access.AudienceOf(ctx, p)
	subjects := []string{}
	if id := p.ID(); id != "" {
		subjects = append(subjects, id)
	}
	for _, s := range []string{"@guest", "@member", "@subscriber"} {
		if access.Matches(s, p, aud) {
			subjects = append(subjects, s)
		}
	}
	seen := map[string]bool{}
	out := []system.StoreRow{}
	if p.ID() != "" {
		owned, err := e.Sys.Stores(ctx, p.ID())
		if err != nil {
			return nil, err
		}
		for _, r := range owned {
			seen[r.ID] = true
			out = append(out, r)
		}
	}
	granted, err := e.Sys.StoresGranted(ctx, subjects)
	if err != nil {
		return nil, err
	}
	for _, r := range granted {
		if !seen[r.ID] {
			out = append(out, r)
		}
	}
	return out, nil
}

// GrantSetIn is grant.set's input.
type GrantSetIn struct {
	Store   string `json:"store" slop:"pos=1" jsonschema_description:"the store"`
	Subject string `json:"subject" slop:"pos=2" jsonschema_description:"usr_…, vis_…, store:<id>, @guest, @member or @subscriber"`
	Level   string `json:"level" slop:"pos=3" jsonschema:"enum=view,enum=interact,enum=admin,enum=owner" jsonschema_description:"the level to give"`
}
