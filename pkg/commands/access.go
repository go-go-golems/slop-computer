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
func (e kernelEnv) subjectPrincipal(ctx context.Context, subject string) (*access.Principal, error) {
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

func accessVerbs(e kernelEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[ExplainCanIn, any]{Name: "explain.can", Doc: "Explain whether someone (you, a person, store:<id> or anonymous) holds a level on a store, or may read/write a document path, with the trace.", Scope: verbs.Read, Action: authz.Account,
			Run: func(req verbs.Req, in ExplainCanIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				who := p
				if s := in.Subject; s != "" {
					if !p.IsAdmin() && s != p.ID() {
						return nil, verbs.Errf("permission_denied", "only admins explain other people's access")
					}
					q, err := e.subjectPrincipal(ctx, s)
					if err != nil {
						return nil, err
					}
					who = q
				}
				lv := in.Level
				if lv == "" {
					lv = "view"
				}
				need, ok := rt.ParseLevel(lv)
				if !ok {
					return nil, verbs.Errf("invalid_argument", "unknown level %q", lv)
				}
				id := in.Store
				st, err := e.K.Registry.StoreByID(ctx, id)
				if errors.Is(err, sysdb.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no store %s", id)
				}
				if err != nil {
					return nil, err
				}
				d := e.K.Access.Level(ctx, who, st)
				if act := authz.Action(in.Action); act != "" {
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
				if path := in.Path; path != "" {
					op := in.Op
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
			}}.Verb(),
		verbs.Def[LinkNewIn, any]{Name: "link.new", Doc: "Make a share link to a store: whoever opens it gets view or interact. The token is shown once.", Scope: verbs.Write, Action: authz.StoreOwner,
			Run: func(req verbs.Req, in LinkNewIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelOwner, "sharing"); err != nil && !p.IsAdmin() {
					return nil, err
				}
				lv := in.Level
				if lv == "" {
					lv = "view"
				}
				var until int64
				if d := in.Days; d > 0 {
					until = time.Now().Add(time.Duration(d) * 24 * time.Hour).UnixMilli()
				}
				l, token, err := e.K.Registry.CreateLink(ctx, p.ID(), p.ViaLabel(), in.Store, lv, until)
				if err != nil {
					return nil, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				out := map[string]any{"link": l, "token": token}
				if u := in.URL; u != "" {
					sep := "?"
					if strings.Contains(u, "?") {
						sep = "&"
					}
					out["url"] = u + sep + "k=" + url.QueryEscape(token)
				}
				return out, nil
			}}.Verb(),
		verbs.Def[LinkLsIn, any]{Name: "link.ls", Doc: "List a store's share links (uses: grants they gave that still stand).", Scope: verbs.Read, Action: authz.StoreOwner,
			Run: func(req verbs.Req, in LinkLsIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelOwner, "reading links"); err != nil && !p.IsAdmin() {
					return nil, err
				}
				return e.K.Registry.Links(ctx, in.Store)
			}}.Verb(),
		verbs.Def[LinkRmIn, any]{Name: "link.rm", Doc: "Revoke a share link; the access it gave ends at once.", Scope: verbs.Write, Action: authz.StoreOwner, StoreArg: "-",
			Run: func(req verbs.Req, in LinkRmIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				l, err := e.K.Registry.LinkByID(ctx, in.ID)
				if err != nil {
					return nil, verbs.Errf("not_found", "no link %s", in.ID)
				}
				if _, _, err := e.open(ctx, p, l.Store, rt.LevelOwner, "revoking links"); err != nil && !p.IsAdmin() {
					return nil, err
				}
				if _, err := e.K.Registry.RevokeLink(ctx, p.ID(), p.ViaLabel(), l.ID); err != nil {
					return nil, err
				}
				return map[string]any{"revoked": l.ID, "store": l.Store}, nil
			}}.Verb(),
		verbs.Def[GuestSweepIn, any]{Name: "guest.sweep", Doc: "Delete guests unseen for 90 days (or --days), with their grants and private documents.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in GuestSweepIn) (any, error) {
				ctx := req.Context
				days := or(in.Days, identity.GuestDays)
				n, err := e.K.SweepGuests(ctx, time.Now().Add(-time.Duration(days)*24*time.Hour).UnixMilli())
				return map[string]any{"deleted": n}, err
			}}.Verb(),
	}
}

// ExplainCanIn is explain.can's input.
type ExplainCanIn struct {
	Store   string `json:"store" slop:"pos=1"`
	Level   string `json:"level,omitempty" slop:"pos=2" jsonschema_description:"view, interact, admin or owner (default view)"`
	Subject string `json:"subject,omitempty" jsonschema_description:"usr_…, vis_…, an email, store:<id> or anonymous (default: you)"`
	Path    string `json:"path,omitempty" jsonschema_description:"a document path: apply the app's rules"`
	Op      string `json:"op,omitempty" jsonschema_description:"read or write, with path (default read)"`
	Action  string `json:"action,omitempty" jsonschema_description:"an action (doc.write, store.admin, code.push, …): does its floor hold"`
}

// LinkNewIn is link.new's input.
type LinkNewIn struct {
	Store string `json:"store" slop:"pos=1"`
	Level string `json:"level,omitempty" slop:"pos=2" jsonschema_description:"view or interact (default view)"`
	Days  int64  `json:"days,omitempty" jsonschema_description:"how long it works (0: until revoked)"`
	URL   string `json:"url,omitempty" jsonschema_description:"the page's address on a live host, to build the link's URL"`
}

// LinkLsIn is link.ls's input.
type LinkLsIn struct {
	Store string `json:"store" slop:"pos=1"`
}

// LinkRmIn is link.rm's input.
type LinkRmIn struct {
	ID string `json:"id" slop:"pos=1"`
}

// GuestSweepIn is guest.sweep's input.
type GuestSweepIn struct {
	Days *int64 `json:"days,omitempty" jsonschema_description:"unseen for at least this many days (default 90)"`
}
