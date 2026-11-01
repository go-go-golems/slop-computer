package verbs

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"time"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/kernel"
	"github.com/go-go-golems/slop/pkg/rt"
	"github.com/go-go-golems/slop/pkg/store"
	"github.com/go-go-golems/slop/pkg/system"
)

func bytesReader(b []byte) *bytes.Reader { return bytes.NewReader(b) }

func init() {
	Register(
		&Verb{Name: "store.ls", Doc: "List the stores you own or hold a grant on (admins: --all).", Scope: Read,
			Args: []Arg{{Name: "all", Type: "bool", Doc: "every store (admins)"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				var rows []system.StoreRow
				var err error
				if a.B("all") {
					if !p.IsAdmin() {
						return nil, Errf("permission_denied", "only admins list every store")
					}
					rows, err = e.Sys.Stores(ctx, "")
				} else {
					rows, err = visibleStores(ctx, e, p)
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
		&Verb{Name: "store.new", Doc: "Make a store; you become its owner.", Scope: Write,
			Args: []Arg{{Name: "id", Type: "string", Pos: 1, Doc: "lowercase slug; empty makes s-xxxxxxxx"},
				{Name: "type", Type: "string"}, {Name: "app", Type: "string", Doc: "the app store it runs"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if !e.K.Access.AudienceOf(ctx, p).AtLeast(access.AudMember) {
					return nil, Errf("permission_denied", "only members make stores")
				}
				row, _, err := e.K.CreateStore(ctx, p, kernel.NewStore{ID: a.S("id"), Type: a.S("type"), App: a.S("app")})
				if errors.Is(err, system.ErrExists) {
					return nil, Errf("conflict", "store %s exists", a.S("id"))
				}
				if err != nil {
					return nil, Errf("invalid_argument", "%s", err.Error())
				}
				return row, nil
			}},
		&Verb{Name: "store.rm", Doc: "Delete a store, its documents, files and grants. Owners and admins only.", Scope: Write,
			Args: []Arg{{Name: "id", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
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
		&Verb{Name: "store.meta", Doc: "A store's settings, head rev, sizes and your level on it.", Scope: Read,
			Args: []Arg{{Name: "id", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
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
		&Verb{Name: "grant.ls", Doc: "List a store's grants.", Scope: Read,
			Args: []Arg{{Name: "store", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "listing grants"); err != nil {
					return nil, err
				}
				return e.Sys.Grants(ctx, a.S("store"))
			}},
		&Verb{Name: "grant.set", Doc: "Give a subject (usr_…, vis_…, store:<id>, @guest, @member, @subscriber) a level on a store.", Scope: Write,
			Args: []Arg{{Name: "store", Type: "string", Pos: 1, Required: true}, {Name: "subject", Type: "string", Pos: 2, Required: true},
				{Name: "level", Type: "string", Pos: 3, Required: true, Doc: "view, interact, admin or owner"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				_, d, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "granting")
				if err != nil {
					return nil, err
				}
				if !validSubject(a.S("subject")) {
					return nil, Errf("invalid_argument", "a subject is usr_…, vis_…, store:<id>, @guest, @member or @subscriber")
				}
				lvl, ok := rt.ParseLevel(a.S("level"))
				if !ok || lvl == rt.LevelSelf {
					return nil, Errf("invalid_argument", "level must be view, interact, admin or owner")
				}
				if lvl > d.Level {
					return nil, &Error{Code: "permission_denied", Message: "you cannot grant more than your own level", Trace: d.Trace}
				}
				g, err := e.Sys.SetGrant(ctx, p.ID(), p.ViaLabel(), system.Grant{Store: a.S("store"), Subject: a.S("subject"), Level: a.S("level")})
				if err == nil && e.AccessChanged != nil {
					e.AccessChanged(ctx, g.Store)
				}
				return g, err
			}},
		&Verb{Name: "grant.rm", Doc: "Remove a subject's grants on a store.", Scope: Write,
			Args: []Arg{{Name: "store", Type: "string", Pos: 1, Required: true}, {Name: "subject", Type: "string", Pos: 2, Required: true},
				{Name: "via", Type: "string", Doc: "only the grant made this way (direct, lnk_…)"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "revoking"); err != nil {
					return nil, err
				}
				n, err := e.Sys.RemoveGrant(ctx, p.ID(), p.ViaLabel(), a.S("store"), a.S("subject"), a.S("via"))
				if err == nil && n > 0 && e.AccessChanged != nil {
					e.AccessChanged(ctx, a.S("store"))
				}
				return map[string]any{"removed": n}, err
			}},
		&Verb{Name: "log.show", Doc: "A store's commits after a rev (oldest first), or the newest ones.", Scope: Read,
			Args: []Arg{{Name: "store", Type: "string", Pos: 1, Required: true}, {Name: "after", Type: "int", Doc: "commits after this rev"},
				{Name: "limit", Type: "int", Doc: "at most this many (default 50)"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
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
		&Verb{Name: "log.wait", Doc: "Wait for a store's commits after a rev: they return as soon as there is one, or an empty list after the timeout.", Scope: Read,
			Args: []Arg{{Name: "store", Type: "string", Pos: 1, Required: true}, {Name: "after", Type: "int", Required: true, Doc: "commits after this rev"},
				{Name: "timeout", Type: "int", Doc: "seconds (default 55, at most 300)"}, {Name: "limit", Type: "int", Doc: "at most this many (default 50)"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				s, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "reading the log")
				if err != nil {
					return nil, err
				}
				secs := a.I("timeout", 55)
				if secs < 0 || secs > 300 {
					return nil, Errf("invalid_argument", "the timeout is 0 to 300 seconds")
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
	)
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

// visibleStores lists what p owns or holds a grant on.
func visibleStores(ctx context.Context, e *Env, p *access.Principal) ([]system.StoreRow, error) {
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
