package commands

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// subjectPrincipal is the principal explain.can asks about: a person by id
// or email, store:<id>, or "anonymous" (a visitor without an id).
func (e *Env) subjectPrincipal(ctx context.Context, subject string) (*access.Principal, error) {
	switch {
	case subject == "anonymous":
		return nil, nil
	case strings.HasPrefix(subject, "store:"):
		return &access.Principal{Kind: access.KindStore, Store: strings.TrimPrefix(subject, "store:")}, nil
	}
	var p sysdb.Person
	var err error
	if strings.Contains(subject, "@") {
		p, err = e.K.People.PersonByEmail(ctx, subject)
	} else {
		p, err = e.K.People.Person(ctx, subject)
	}
	if err != nil {
		return nil, verbs.Errf("not_found", "no person %s", subject)
	}
	return access.PersonPrincipal(p, ""), nil
}

func accessVerbs(e *Env) []*verbs.Verb {
	storeArg := verbs.Arg{Name: "store", Type: "string", Pos: 1, Required: true}
	return []*verbs.Verb{
		{Name: "explain.can", Doc: "Explain whether someone (you, a person, store:<id> or anonymous) holds a level on a store, or may read/write a document path, with the trace.", Scope: verbs.Read, Action: authz.Account,
			Args: []verbs.Arg{storeArg, {Name: "level", Type: "string", Pos: 2, Doc: "view, interact, admin or owner (default view)"},
				{Name: "subject", Type: "string", Doc: "usr_…, vis_…, an email, store:<id> or anonymous (default: you)"},
				{Name: "path", Type: "string", Doc: "a document path: apply the app's rules"},
				{Name: "op", Type: "string", Doc: "read or write, with path (default read)"},
				{Name: "action", Type: "string", Doc: "an action (doc.write, store.admin, code.push, …): does its floor hold"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				who := p
				if s := a.S("subject"); s != "" {
					if !p.IsAdmin() && s != p.ID() {
						return nil, verbs.Errf("permission_denied", "only admins explain other people's access")
					}
					q, err := e.subjectPrincipal(ctx, s)
					if err != nil {
						return nil, err
					}
					who = q
				}
				lv := a.S("level")
				if lv == "" {
					lv = "view"
				}
				need, ok := rt.ParseLevel(lv)
				if !ok {
					return nil, verbs.Errf("invalid_argument", "unknown level %q", lv)
				}
				id := a.S("store")
				st, err := e.K.Registry.StoreByID(ctx, id)
				if errors.Is(err, sysdb.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no store %s", id)
				}
				if err != nil {
					return nil, err
				}
				d := e.K.Access.Level(ctx, who, st)
				if act := authz.Action(a.S("action")); act != "" {
					ok, why := authz.Floor(act, d.Level, who.IsAdmin())
					if ok {
						d.Trace = append(d.Trace, fmt.Sprintf("%s: the floor holds", act))
					} else {
						d.Trace = append(d.Trace, why)
					}
					out := map[string]any{"ok": ok, "level": d.LevelName(), "action": act, "audience": d.Audience, "groups": d.Audience.Groups(), "trace": d.Trace}
					if !ok {
						out["code"] = "permission_denied"
					}
					return out, nil
				}
				if path := a.S("path"); path != "" {
					op := a.S("op")
					if op == "" {
						op = "read"
					}
					r, w := e.K.Rules(ctx, id).Need(path, who.ID())
					need = r
					if op == "write" {
						need = w
					}
					d.Trace = append(d.Trace, fmt.Sprintf("rule %s: %s needs %s", path, op, need))
				}
				ok = d.Level >= need && need != rt.LevelSelf
				if need == rt.LevelSelf {
					d.Trace = append(d.Trace, "only its own person ({self}) may do this")
				}
				out := map[string]any{"ok": ok, "level": d.LevelName(), "need": need.String(), "audience": d.Audience, "groups": d.Audience.Groups(), "trace": d.Trace}
				if !ok {
					d.Trace = append(d.Trace, fmt.Sprintf("%s < %s", d.Level, need))
					out["trace"] = d.Trace
					out["code"] = "permission_denied"
					if d.Level == rt.LevelNone {
						out["code"] = "not_found"
					}
				}
				return out, nil
			}},
		{Name: "link.new", Doc: "Make a share link to a store: whoever opens it gets view or interact. The token is shown once.", Scope: verbs.Write, Action: authz.StoreOwner,
			Args: []verbs.Arg{storeArg, {Name: "level", Type: "string", Pos: 2, Doc: "view or interact (default view)"},
				{Name: "days", Type: "int", Doc: "how long it works (0: until revoked)"},
				{Name: "url", Type: "string", Doc: "the page's address on a live host, to build the link's URL"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelOwner, "sharing"); err != nil && !p.IsAdmin() {
					return nil, err
				}
				lv := a.S("level")
				if lv == "" {
					lv = "view"
				}
				var until int64
				if d := a.I("days", 0); d > 0 {
					until = time.Now().Add(time.Duration(d) * 24 * time.Hour).UnixMilli()
				}
				l, token, err := e.K.Registry.CreateLink(ctx, p.ID(), p.ViaLabel(), a.S("store"), lv, until)
				if err != nil {
					return nil, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				out := map[string]any{"link": l, "token": token}
				if u := a.S("url"); u != "" {
					sep := "?"
					if strings.Contains(u, "?") {
						sep = "&"
					}
					out["url"] = u + sep + "k=" + url.QueryEscape(token)
				}
				return out, nil
			}},
		{Name: "link.ls", Doc: "List a store's share links (uses: grants they gave that still stand).", Scope: verbs.Read, Action: authz.StoreOwner,
			Args: []verbs.Arg{storeArg},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelOwner, "reading links"); err != nil && !p.IsAdmin() {
					return nil, err
				}
				return e.K.Registry.Links(ctx, a.S("store"))
			}},
		{Name: "link.rm", Doc: "Revoke a share link; the access it gave ends at once.", Scope: verbs.Write, Action: authz.StoreOwner, StoreArg: "-",
			Args: []verbs.Arg{{Name: "id", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				l, err := e.K.Registry.LinkByID(ctx, a.S("id"))
				if err != nil {
					return nil, verbs.Errf("not_found", "no link %s", a.S("id"))
				}
				if _, _, err := e.open(ctx, p, l.Store, rt.LevelOwner, "revoking links"); err != nil && !p.IsAdmin() {
					return nil, err
				}
				if _, err := e.K.Registry.RevokeLink(ctx, p.ID(), p.ViaLabel(), l.ID); err != nil {
					return nil, err
				}
				return map[string]any{"revoked": l.ID, "store": l.Store}, nil
			}},
		{Name: "guest.sweep", Doc: "Delete guests unseen for 90 days (or --days), with their grants and private documents.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []verbs.Arg{{Name: "days", Type: "int", Doc: "unseen for at least this many days (default 90)"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				days := a.I("days", identity.GuestDays)
				n, err := e.K.SweepGuests(ctx, time.Now().Add(-time.Duration(days)*24*time.Hour).UnixMilli())
				return map[string]any{"deleted": n}, err
			}},
	}
}
