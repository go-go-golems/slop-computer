package access

import (
	"context"
	"errors"
	"fmt"

	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Audience is computed for every request and turn, never stored.
type Audience string

// Audiences, a ladder: each includes the powers of the ones below.
const (
	AudNone       Audience = "none" // disabled accounts
	AudGuest      Audience = "guest"
	AudMember     Audience = "member"
	AudSubscriber Audience = "subscriber"
	AudAdmin      Audience = "admin"
	// AudStore is a store acting on its own (alarms, reactors, its own
	// platform calls): in the group @store only (SLOP3-007).
	AudStore Audience = "store"
)

// Group is a set of principals computed from role, kind and subscription
// (SLOP3-007): @guest, @member, @subscriber, @admin, @store. Nesting is
// decided once, in sysdb.GroupsOf.
type Group string

const (
	GroupGuest      Group = "@guest" // everyone, signed in or not
	GroupMember     Group = "@member"
	GroupSubscriber Group = "@subscriber"
	GroupAdmin      Group = "@admin"
	GroupStore      Group = "@store" // a store acting on its own
)

// Groups is the audience's groups, nesting included.
func (a Audience) Groups() []Group {
	var out []Group
	for _, g := range sysdb.GroupsOf(string(a)) {
		out = append(out, Group("@"+g))
	}
	return out
}

// In reports whether the audience is in group g ("@member" or "member").
func (a Audience) In(g Group) bool { return sysdb.InGroup(string(a), string(g)) }

// Groups computes a principal's groups.
func (c *Checker) Groups(ctx context.Context, p *Principal) []Group {
	return c.AudienceOf(ctx, p).Groups()
}

// In reports whether p is in group g.
func (c *Checker) In(ctx context.Context, p *Principal, g Group) bool {
	return c.AudienceOf(ctx, p).In(g)
}

// ValidAudience reports one of guest, member, subscriber, admin.
func ValidAudience(s string) bool {
	switch Audience(s) {
	case AudGuest, AudMember, AudSubscriber, AudAdmin:
		return true
	}
	return false
}

// Directory is what the checker reads (SLOP3-010 PR 2): stores and their
// grants (the registry), people (identity) and the clock. The host passes
// sysdb.db's domains; access owns no database handle.
type Directory interface {
	StoreByID(ctx context.Context, id string) (sysdb.StoreRow, error)
	Grants(ctx context.Context, store string) ([]sysdb.Grant, error)
	Person(ctx context.Context, id string) (sysdb.Person, error)
	NowMs() int64
}

// Checker answers access questions against a Directory.
type Checker struct {
	Dir Directory
	// Subscribed reports standing access (subscription or comp). Billing
	// installs it; until then nobody is a subscriber.
	Subscribed func(ctx context.Context, person string) bool
}

// AudienceOf computes a principal's audience.
func (c *Checker) AudienceOf(ctx context.Context, p *Principal) Audience {
	switch {
	case p == nil:
		return AudGuest
	case p.Kind == KindSystem:
		return AudAdmin
	case p.Kind == KindStore && p.Trusted:
		// A store admitted by a live trust row (an admin trusted its app
		// with a module): it acts with admin's reads through that module.
		return AudAdmin
	case p.Kind == KindStore:
		return AudStore
	case p.Person == nil, p.Kind == KindGuest, p.Person.Kind == "guest":
		return AudGuest
	}
	switch p.Role() {
	case sysdb.RoleDisabled:
		return AudNone
	case sysdb.RolePending:
		return AudGuest
	case sysdb.RoleAdmin:
		return AudAdmin
	case sysdb.RoleMember:
		if c.Subscribed != nil && c.Subscribed(ctx, p.Person.ID) {
			return AudSubscriber
		}
		return AudMember
	}
	return AudNone
}

// Matches reports whether a grant subject names this principal.
func Matches(subject string, p *Principal, aud Audience) bool {
	if p != nil && p.Kind == KindStore {
		// A store's actor holds only the grants made to store:<id>:
		// cross-store access is always explicit.
		return subject == p.ID()
	}
	switch Group(subject) {
	case GroupGuest, GroupMember, GroupSubscriber:
		return aud.In(Group(subject))
	}
	return subject != "" && subject == p.ID()
}

// Decision is the outcome of a check, with the facts that decided it.
type Decision struct {
	OK       bool     `json:"ok"`
	Code     string   `json:"code,omitempty"` // permission_denied or not_found
	Level    rt.Level `json:"-"`
	Audience Audience `json:"audience"`
	Trace    []string `json:"trace"`
}

// LevelName is the decision's level as a word.
func (d Decision) LevelName() string { return d.Level.String() }

// Level computes p's level on a store, explaining how: the max over every
// source, then the min over every ceiling (SLOP3-007). There is no other
// branch, so no source can skip a ceiling.
//
//	sources   the kernel (owner); a store on itself (owner); the store's
//	          owner column (owner); @admin (admin on every store); each
//	          live grant matching p (at most admin)
//	ceilings  kindCap: none for a disabled account or a token without
//	          scopes, interact for guests and pending people, else owner
func (c *Checker) Level(ctx context.Context, p *Principal, st sysdb.StoreRow) Decision {
	return c.level(ctx, p, st, true)
}

// level is Level; withLinks false leaves out grants that came from links,
// which is how a link's creator is judged (so links can't hold each other
// up).
func (c *Checker) level(ctx context.Context, p *Principal, st sysdb.StoreRow, withLinks bool) Decision {
	d := Decision{Audience: c.AudienceOf(ctx, p)}
	who := p.ID()
	if who == "" {
		who = "an anonymous visitor"
	}
	d.Trace = append(d.Trace, fmt.Sprintf("audience %s (%s)", d.Audience, who))
	src := rt.LevelNone
	from := func(l rt.Level, why string) {
		d.Trace = append(d.Trace, why)
		src = max(src, l)
	}
	switch {
	case p != nil && p.Kind == KindSystem:
		from(rt.LevelOwner, "the kernel itself")
	case p != nil && p.Kind == KindStore && p.Store == st.ID:
		from(rt.LevelOwner, "a store on itself")
	}
	if st.Owner != "" && st.Owner == p.ID() {
		from(rt.LevelOwner, "owner of "+st.ID)
	}
	if d.Audience.In(GroupAdmin) && p.Kind != KindSystem {
		from(rt.LevelAdmin, "admins are admin on every store")
	}
	grants, err := c.Dir.Grants(ctx, st.ID)
	if err != nil {
		d.Trace = append(d.Trace, "grants unreadable: "+err.Error())
	}
	matched := false
	for _, g := range grants {
		if !Matches(g.Subject, p, d.Audience) {
			continue
		}
		if g.Link != nil {
			if !withLinks {
				continue
			}
			if why := c.deadLink(ctx, g, st); why != "" {
				d.Trace = append(d.Trace, fmt.Sprintf("grant %s %s on %s (%s): %s", g.Subject, g.Level, st.ID, g.Via, why))
				continue
			}
		}
		l, _ := rt.ParseLevel(g.Level)
		matched = true
		// Owner comes only from the owner column: a grant gives at most admin.
		from(min(l, rt.LevelAdmin), fmt.Sprintf("grant %s %s on %s (%s)", g.Subject, g.Level, st.ID, g.Via))
	}
	if !matched && src == rt.LevelNone {
		d.Trace = append(d.Trace, "no grant on "+st.ID+" matches")
	}
	ceil, why := kindCap(p, d.Audience)
	if ceil < src {
		d.Trace = append(d.Trace, fmt.Sprintf("ceiling: %s (%s)", why, ceil))
	}
	d.Level = min(src, ceil)
	return d
}

// kindCap is the ceiling a principal's kind puts on every source.
func kindCap(p *Principal, aud Audience) (rt.Level, string) {
	switch {
	case p != nil && (p.Kind == KindSystem || p.Kind == KindStore):
		return rt.LevelOwner, "no ceiling"
	case p != nil && p.Kind == KindToken && len(p.Scopes) == 0:
		return rt.LevelNone, "a token without scopes holds nothing"
	case aud == AudNone:
		return rt.LevelNone, "a disabled account holds no level"
	case aud == AudGuest:
		return rt.LevelInteract, "guests and pending accounts hold at most interact"
	}
	return rt.LevelOwner, "no ceiling"
}

// GrantInactive says why a grant no longer counts, or "" while it does
// (only link grants can stop counting on their own).
func (c *Checker) GrantInactive(ctx context.Context, g sysdb.Grant, st sysdb.StoreRow) string {
	if g.Link == nil {
		return ""
	}
	return c.deadLink(ctx, g, st)
}

// deadLink says why a grant made by redeeming a link no longer counts, or
// "" while it does: the link is revoked or expired, or its creator no
// longer holds the link's level on the store (decision 7). The creator's
// level leaves link grants out, so links can't hold each other up.
func (c *Checker) deadLink(ctx context.Context, g sysdb.Grant, st sysdb.StoreRow) string {
	if !g.Link.Live(c.Dir.NowMs()) {
		return "its link was revoked or has expired"
	}
	if g.Link.Creator == "system" || g.Link.Creator == "" {
		return ""
	}
	creator, err := c.Dir.Person(ctx, g.Link.Creator)
	if err != nil {
		return "its link's creator is gone"
	}
	need, _ := rt.ParseLevel(g.Link.Level)
	if c.level(ctx, PersonPrincipal(creator, ""), st, false).Level < need {
		return "its link's creator no longer holds " + g.Link.Level
	}
	return ""
}

// Can checks that p holds at least need on store. hidden makes a failure
// read as not_found (reads of things the caller may not know exist).
func (c *Checker) Can(ctx context.Context, p *Principal, store string, need rt.Level, what string, hidden bool) (Decision, sysdb.StoreRow, error) {
	st, err := c.Dir.StoreByID(ctx, store)
	if errors.Is(err, sysdb.ErrNotFound) {
		return Decision{Code: "not_found", Trace: []string{"no store " + store}}, st, nil
	}
	if err != nil {
		return Decision{}, st, err
	}
	d := c.Level(ctx, p, st)
	if what != "" {
		d.Trace = append(d.Trace, fmt.Sprintf("%s needs %s", what, need))
	}
	if d.Level >= need && need != rt.LevelSelf {
		d.OK = true
		return d, st, nil
	}
	d.Trace = append(d.Trace, fmt.Sprintf("%s < %s", d.Level, need))
	d.Code = "permission_denied"
	if hidden || d.Level == rt.LevelNone {
		d.Code = "not_found"
	}
	return d, st, nil
}
