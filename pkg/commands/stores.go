package commands

import (
	"bytes"
	"errors"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func bytesReader(b []byte) *bytes.Reader { return bytes.NewReader(b) }

func storeVerbs(e kernelEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[StoreLsIn, any]{Name: "store.ls", Doc: "List the stores you own or hold a grant on (admins: --all).", Scope: verbs.Read, Action: authz.Account,
			Run: func(req verbs.Req, in StoreLsIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				var rows []sysdb.StoreRow
				var err error
				if in.All {
					if !p.IsAdmin() {
						return nil, verbs.Errf("permission_denied", "only admins list every store")
					}
					rows, err = e.K.Registry.Stores(ctx, "")
				} else {
					rows, err = e.K.VisibleStores(ctx, p)
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
			}}.Verb(),
		verbs.Def[StoreNewIn, any]{Name: "store.new", Doc: "Make a store; you become its owner.", Scope: verbs.Write, Action: authz.StoreCreate,
			Run: func(req verbs.Req, in StoreNewIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				if !e.K.Access.In(ctx, p, access.GroupMember) {
					return nil, verbs.Errf("permission_denied", "only members make stores")
				}
				row, _, err := e.K.CreateStore(ctx, p, kernel.NewStore{ID: in.ID, Type: in.Type, App: in.App})
				if errors.Is(err, registry.ErrExists) {
					return nil, verbs.Errf("conflict", "store %s exists", in.ID)
				}
				if err != nil {
					return nil, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				return row, nil
			}}.Verb(),
		verbs.Def[StoreRmIn, any]{Name: "store.rm", Doc: "Delete a store, its documents, files and grants. Owners and admins only.", Scope: verbs.Write, Action: authz.StoreAdmin, StoreArg: "id",
			Run: func(req verbs.Req, in StoreRmIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				need := rt.LevelOwner
				if p.IsAdmin() {
					need = rt.LevelAdmin
				}
				if _, _, err := e.open(ctx, p, in.ID, need, "deleting"); err != nil {
					return nil, err
				}
				if err := e.K.DeleteStore(ctx, p, in.ID); err != nil {
					return nil, err
				}
				return map[string]any{"deleted": in.ID}, nil
			}}.Verb(),
		verbs.Def[StoreTypeIn, any]{Name: "store.type", Doc: "Set a store's type, which decides the typed mounts that serve it (/b/:id --type blocks); empty clears it. Admins only.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in StoreTypeIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				row, err := e.K.SetStoreType(ctx, p, in.ID, in.Type)
				if errors.Is(err, sysdb.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no store %s", in.ID)
				}
				return row, err
			}}.Verb(),
		verbs.Def[StoreMetaIn, any]{Name: "store.meta", Doc: "A store's settings, head rev, sizes and your level on it.", Scope: verbs.Read, Action: authz.StoreRead, StoreArg: "id",
			Run: func(req verbs.Req, in StoreMetaIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				s, d, err := e.open(ctx, p, in.ID, rt.LevelView, "reading")
				if err != nil {
					return nil, err
				}
				row, _ := e.K.Registry.StoreByID(ctx, s.ID)
				colls, _ := s.Collections(ctx)
				refs, _ := s.Refs(ctx)
				return map[string]any{"store": row, "meta": s.AllMeta(), "head": s.Head(), "docs": s.CountDocs(ctx),
					"collections": colls, "refs": refs, "level": d.LevelName(), "audience": d.Audience}, nil
			}}.Verb(),
		verbs.Def[GrantLsIn, any]{Name: "grant.ls", Doc: "List a store's grants.", Scope: verbs.Read, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in GrantLsIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "listing grants"); err != nil {
					return nil, err
				}
				gs, err := e.K.Registry.Grants(ctx, in.Store)
				if err != nil {
					return nil, err
				}
				st, err := e.K.Registry.StoreByID(ctx, in.Store)
				if err != nil {
					return nil, err
				}
				for i := range gs {
					gs[i].Inactive = e.K.Access.GrantInactive(ctx, gs[i], st)
				}
				return gs, nil
			}}.Verb(),
		verbs.Def[GrantSetIn, sysdb.Grant]{Name: "grant.set", Doc: "Give a subject (usr_…, vis_…, store:<id>, @guest, @member, @subscriber) a level on a store.",
			Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(r verbs.Req, in GrantSetIn) (sysdb.Grant, error) {
				e, p := e, r.Principal
				_, d, err := e.open(r, p, in.Store, rt.LevelAdmin, "granting")
				if err != nil {
					return sysdb.Grant{}, err
				}
				if !validSubject(in.Subject) {
					return sysdb.Grant{}, verbs.Errf("invalid_argument", "a subject is usr_…, vis_…, store:<id>, @guest, @member or @subscriber")
				}
				lvl, ok := rt.ParseLevel(in.Level)
				if !ok || lvl == rt.LevelSelf {
					return sysdb.Grant{}, verbs.Errf("invalid_argument", "level must be view, interact, admin or owner")
				}
				if lvl > d.Level {
					return sysdb.Grant{}, &verbs.Error{Code: "permission_denied", Message: "you cannot grant more than your own level", Trace: d.Trace}
				}
				g, err := e.K.Registry.SetGrant(r, p.ID(), p.ViaLabel(), sysdb.Grant{Store: in.Store, Subject: in.Subject, Level: in.Level})
				return g, err
			}}.Verb(),
		verbs.Def[GrantRmIn, any]{Name: "grant.rm", Doc: "Remove a subject's grants on a store.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in GrantRmIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "revoking"); err != nil {
					return nil, err
				}
				n, err := e.K.Registry.RemoveGrant(ctx, p.ID(), p.ViaLabel(), in.Store, in.Subject, in.Via)
				return map[string]any{"removed": n}, err
			}}.Verb(),
		verbs.Def[LogShowIn, any]{Name: "log.show", Doc: "A store's commits after a rev (oldest first), or the newest ones.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in LogShowIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading the log")
				if err != nil {
					return nil, err
				}
				limit := int(or(in.Limit, 50))
				if in.After != nil {
					return s.Log(ctx, or(in.After, 0), limit)
				}
				return s.RecentLog(ctx, limit)
			}}.Verb(),
		verbs.Def[LogWaitIn, any]{Name: "log.wait", Doc: "Wait for a store's commits after a rev: they return as soon as there is one, or an empty list after the timeout.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in LogWaitIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading the log")
				if err != nil {
					return nil, err
				}
				secs := or(in.Timeout, 55)
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
					list, err := s.Log(ctx, in.After, int(or(in.Limit, 50)))
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
			}}.Verb(),
	}
}

func validSubject(s string) bool {
	switch {
	case s == "@guest", s == "@member", s == "@subscriber":
		return true
	case strings.HasPrefix(s, "usr_"), strings.HasPrefix(s, "vis_"):
		return len(s) > 4
	case strings.HasPrefix(s, "store:"):
		return registry.ValidStoreID(s[6:])
	}
	return false
}

// GrantSetIn is grant.set's input.
type GrantSetIn struct {
	Store   string `json:"store" slop:"pos=1" jsonschema_description:"the store"`
	Subject string `json:"subject" slop:"pos=2" jsonschema_description:"usr_…, vis_…, store:<id>, @guest, @member or @subscriber"`
	Level   string `json:"level" slop:"pos=3" jsonschema:"enum=view,enum=interact,enum=admin,enum=owner" jsonschema_description:"the level to give"`
}

// StoreLsIn is store.ls's input.
type StoreLsIn struct {
	All bool `json:"all,omitempty" jsonschema_description:"every store (admins)"`
}

// StoreNewIn is store.new's input.
type StoreNewIn struct {
	ID   string `json:"id,omitempty" slop:"pos=1" jsonschema_description:"lowercase slug; empty makes s-xxxxxxxx"`
	Type string `json:"type,omitempty"`
	App  string `json:"app,omitempty" jsonschema_description:"the app store it runs"`
}

// StoreRmIn is store.rm's input.
type StoreRmIn struct {
	ID string `json:"id" slop:"pos=1"`
}

// StoreTypeIn is store.type's input.
type StoreTypeIn struct {
	ID   string `json:"id" slop:"pos=1"`
	Type string `json:"type,omitempty" slop:"pos=2" jsonschema_description:"the new type; empty clears it"`
}

// StoreMetaIn is store.meta's input.
type StoreMetaIn struct {
	ID string `json:"id" slop:"pos=1"`
}

// GrantLsIn is grant.ls's input.
type GrantLsIn struct {
	Store string `json:"store" slop:"pos=1"`
}

// GrantRmIn is grant.rm's input.
type GrantRmIn struct {
	Store   string `json:"store" slop:"pos=1"`
	Subject string `json:"subject" slop:"pos=2"`
	Via     string `json:"via,omitempty" jsonschema_description:"only the grant made this way (direct, lnk_…)"`
}

// LogShowIn is log.show's input.
type LogShowIn struct {
	Store string `json:"store" slop:"pos=1"`
	After *int64 `json:"after,omitempty" jsonschema_description:"commits after this rev"`
	Limit *int64 `json:"limit,omitempty" jsonschema_description:"at most this many (default 50)"`
}

// LogWaitIn is log.wait's input.
type LogWaitIn struct {
	Store   string `json:"store" slop:"pos=1"`
	After   int64  `json:"after" jsonschema_description:"commits after this rev"`
	Timeout *int64 `json:"timeout,omitempty" jsonschema_description:"seconds (default 55, at most 300)"`
	Limit   *int64 `json:"limit,omitempty" jsonschema_description:"at most this many (default 50)"`
}
