package commands

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
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
		// Agents typed --subject @member and --subject visitor (round 3).
		return nil, verbs.Errf("not_found", "no person %s (--subject takes a person's usr_… id or email, store:<id>, or anonymous for a signed-out visitor; a group such as @member is not a subject: name one of its people)", subject)
	}
	return access.PersonPrincipal(p, ""), nil
}

func accessVerbs(e actorEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[ExplainCanIn, ExplainCanOut]{Name: "explain.can", Doc: "Explain whether someone (you, a person, store:<id> or anonymous) holds a level on a store, or may read/write a document path, with the trace.", Scope: verbs.Read, Action: authz.Account,
			Run: func(req verbs.Req, in ExplainCanIn) (ExplainCanOut, error) {
				ctx := req.Context
				p := req.Principal
				who := p
				if s := in.Subject; s != "" {
					if !p.IsAdmin() && s != p.ID() {
						return ExplainCanOut{}, verbs.Errf("permission_denied", "only admins explain other people's access")
					}
					q, err := e.subjectPrincipal(ctx, s)
					if err != nil {
						return ExplainCanOut{}, err
					}
					who = q
				}
				lv := in.Level
				if lv == "" {
					lv = "view"
				}
				need, ok := rt.ParseLevel(lv)
				if !ok {
					return ExplainCanOut{}, verbs.Errf("invalid_argument", "unknown level %q", lv)
				}
				id := in.Store
				st, err := e.K.Registry.StoreByID(ctx, id)
				if errors.Is(err, sysdb.ErrNotFound) {
					return ExplainCanOut{}, verbs.Errf("not_found", "no store %s", id)
				}
				if err != nil {
					return ExplainCanOut{}, err
				}
				d := e.K.Access.Level(ctx, who, st)
				if act := authz.Action(in.Action); act != "" && !authz.Known(act) {
					return e.explainActorAction(ctx, id, in.Action, d)
				}
				if act := authz.Action(in.Action); act != "" {
					ok, why := authz.Floor(act, d.Level, who.IsAdmin())
					if ok {
						d.Trace = append(d.Trace, fmt.Sprintf("%s: the floor holds", act))
					} else {
						d.Trace = append(d.Trace, why)
					}
					out := ExplainCanOut{Ok: ok, Level: d.LevelName(), Action: ptr[authz.Action](act), Audience: d.Audience, Groups: d.Audience.Groups(), Trace: d.Trace}
					if !ok {
						out.Code = ptr[string]("permission_denied")
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
				out := ExplainCanOut{Ok: ok, Level: d.LevelName(), Need: ptr[string](need.String()), Audience: d.Audience, Groups: d.Audience.Groups(), Trace: d.Trace}
				if !ok {
					d.Trace = append(d.Trace, fmt.Sprintf("%s < %s", d.Level, need))
					out.Trace = d.Trace
					out.Code = ptr[string]("permission_denied")
					if d.Level == rt.LevelNone {
						out.Code = ptr[string]("not_found")
					}
				}
				return out, nil
			}}.Verb(),
		verbs.Def[LinkNewIn, LinkNewOut]{Name: "link.new", Doc: "Make a share link to a store: whoever opens it gets view or interact. The token is shown once.", Scope: verbs.Write, Action: authz.StoreOwner,
			Run: func(req verbs.Req, in LinkNewIn) (LinkNewOut, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelOwner, "sharing"); err != nil && !p.IsAdmin() {
					return LinkNewOut{}, err
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
					return LinkNewOut{}, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				out := LinkNewOut{Link: l, Token: token}
				if u := in.URL; u != "" {
					sep := "?"
					if strings.Contains(u, "?") {
						sep = "&"
					}
					out.URL = ptr[string](u + sep + "k=" + url.QueryEscape(token))
				}
				return out, nil
			}}.Verb(),
		verbs.Def[LinkLsIn, []sysdb.Link]{Name: "link.ls", Doc: "List a store's share links (uses: grants they gave that still stand).", Scope: verbs.Read, Action: authz.StoreOwner,
			Run: func(req verbs.Req, in LinkLsIn) ([]sysdb.Link, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelOwner, "reading links"); err != nil && !p.IsAdmin() {
					return nil, err
				}
				return e.K.Registry.Links(ctx, in.Store)
			}}.Verb(),
		verbs.Def[LinkRmIn, LinkRmOut]{Name: "link.rm", Doc: "Revoke a share link; the access it gave ends at once.", Scope: verbs.Write, Action: authz.StoreOwner, StoreArg: "-",
			Run: func(req verbs.Req, in LinkRmIn) (LinkRmOut, error) {
				ctx := req.Context
				p := req.Principal
				l, err := e.K.Registry.LinkByID(ctx, in.ID)
				if err != nil {
					return LinkRmOut{}, verbs.Errf("not_found", "no link %s", in.ID)
				}
				if _, _, err := e.open(ctx, p, l.Store, rt.LevelOwner, "revoking links"); err != nil && !p.IsAdmin() {
					return LinkRmOut{}, err
				}
				if _, err := e.K.Registry.RevokeLink(ctx, p.ID(), p.ViaLabel(), l.ID); err != nil {
					return LinkRmOut{}, err
				}
				return LinkRmOut{Revoked: l.ID, Store: l.Store}, nil
			}}.Verb(),
		verbs.Def[GuestSweepIn, GuestSweepOut]{Name: "guest.sweep", Doc: "Delete guests unseen for 90 days (or --days), with their grants and private documents.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in GuestSweepIn) (GuestSweepOut, error) {
				ctx := req.Context
				days := or(in.Days, identity.GuestDays)
				n, err := e.K.SweepGuests(ctx, time.Now().Add(-time.Duration(days)*24*time.Hour).UnixMilli())
				return GuestSweepOut{Deleted: n}, err
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
	Action  string `json:"action,omitempty" jsonschema_description:"a platform action (doc.write, store.admin, code.push, …) or an action of the store's actor (sign, addClip, …): may the subject run it"`
}

// explainActorAction answers explain.can --action for an action of the
// store's actor: its requires against the caller's level, the same check
// actor.call, a page and app verbs meet before the action runs. A name that
// is neither a platform action nor an actor action lists both kinds.
func (e actorEnv) explainActorAction(ctx context.Context, store, action string, d access.Decision) (ExplainCanOut, error) {
	if e.A == nil {
		return ExplainCanOut{}, verbs.Errf("invalid_argument", "%q is not a platform action (%s)", action, authz.Examples())
	}
	need, declared, found := e.A.Requires(ctx, store, action)
	if !found {
		acts := e.A.Actions(ctx, store)
		sort.Strings(acts)
		have := "it has no actor"
		if len(acts) > 0 {
			have = "its actor's actions: " + strings.Join(acts, ", ")
		}
		return ExplainCanOut{}, verbs.Errf("invalid_argument", "%q is neither a platform action (%s) nor an action of %s (%s)", action, authz.Examples(), store, have)
	}
	if declared {
		d.Trace = append(d.Trace, fmt.Sprintf("action %s of %s's actor requires %s", action, store, need))
	} else {
		d.Trace = append(d.Trace, fmt.Sprintf("action %s of %s's actor declares no requires, so it needs admin", action, store))
	}
	ok := d.Level >= need
	out := ExplainCanOut{Ok: ok, Level: d.LevelName(), Need: ptr[string](need.String()), Action: ptr[authz.Action](authz.Action(action)), Audience: d.Audience, Groups: d.Audience.Groups()}
	if !ok {
		d.Trace = append(d.Trace, fmt.Sprintf("%s < %s", d.Level, need))
		out.Code = ptr[string]("permission_denied")
	}
	out.Trace = d.Trace
	return out, nil
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

// ExplainCanOut is explain.can's result.
type ExplainCanOut struct {
	Action   *authz.Action   `json:"action,omitempty"`
	Audience access.Audience `json:"audience"`
	Code     *string         `json:"code,omitempty"`
	Groups   []access.Group  `json:"groups"`
	Level    string          `json:"level"`
	Need     *string         `json:"need,omitempty"`
	Ok       bool            `json:"ok"`
	Trace    []string        `json:"trace"`
}

// LinkNewOut is link.new's result.
type LinkNewOut struct {
	Link  sysdb.Link `json:"link"`
	Token string     `json:"token"`
	URL   *string    `json:"url,omitempty"`
}

// LinkRmOut is link.rm's result.
type LinkRmOut struct {
	Revoked string `json:"revoked"`
	Store   string `json:"store"`
}

// GuestSweepOut is guest.sweep's result.
type GuestSweepOut struct {
	Deleted int `json:"deleted"`
}
