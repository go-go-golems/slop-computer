package access

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/system"
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
)

var audRank = map[Audience]int{AudNone: 0, AudGuest: 1, AudMember: 2, AudSubscriber: 3, AudAdmin: 4}

// AtLeast reports a >= b on the ladder.
func (a Audience) AtLeast(b Audience) bool { return audRank[a] >= audRank[b] }

// ValidAudience reports one of guest, member, subscriber, admin.
func ValidAudience(s string) bool { return audRank[Audience(s)] > 0 }

// capOf is the highest level an audience may hold through grants.
func capOf(a Audience) rt.Level {
	switch a {
	case AudGuest:
		return rt.LevelInteract
	case AudMember, AudSubscriber:
		return rt.LevelAdmin
	case AudAdmin:
		return rt.LevelOwner
	}
	return rt.LevelNone
}

// scopeCap is the highest level a token's scopes allow.
func scopeCap(scopes []string) rt.Level {
	if slices.Contains(scopes, system.ScopeWrite) || slices.Contains(scopes, system.ScopeAdmin) {
		return rt.LevelOwner
	}
	if slices.Contains(scopes, system.ScopeRead) {
		return rt.LevelView
	}
	return rt.LevelNone
}

// Checker answers access questions against system.db.
type Checker struct {
	Sys *system.DB
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
	case p.Kind == KindStore:
		return AudMember
	case p.Person == nil, p.Kind == KindGuest, p.Person.Kind == "guest":
		return AudGuest
	}
	switch p.Person.Role {
	case system.RoleDisabled:
		return AudNone
	case system.RolePending:
		return AudGuest
	case system.RoleAdmin:
		return AudAdmin
	case system.RoleMember:
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
	switch subject {
	case "@guest":
		return aud.AtLeast(AudGuest)
	case "@member":
		return aud.AtLeast(AudMember)
	case "@subscriber":
		return aud.AtLeast(AudSubscriber)
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

// Level computes p's level on a store, explaining how.
func (c *Checker) Level(ctx context.Context, p *Principal, st system.StoreRow) Decision {
	d := Decision{Audience: c.AudienceOf(ctx, p)}
	who := p.ID()
	if who == "" {
		who = "an anonymous visitor"
	}
	d.Trace = append(d.Trace, fmt.Sprintf("audience %s (%s)", d.Audience, who))
	if p != nil && p.Kind == KindSystem {
		d.Level = rt.LevelOwner
		d.Trace = append(d.Trace, "the kernel itself")
		return d
	}
	if d.Audience == AudNone {
		d.Trace = append(d.Trace, "a disabled account holds no level")
		return d
	}
	switch {
	case st.Owner != "" && st.Owner == p.ID():
		d.Level = rt.LevelOwner
		d.Trace = append(d.Trace, "owner of "+st.ID)
	case d.Audience == AudAdmin:
		d.Level = rt.LevelAdmin
		d.Trace = append(d.Trace, "admins are admin on every store")
	default:
		grants, err := c.Sys.Grants(ctx, st.ID)
		if err != nil {
			d.Trace = append(d.Trace, "grants unreadable: "+err.Error())
			return d
		}
		for _, g := range grants {
			if !Matches(g.Subject, p, d.Audience) {
				continue
			}
			l, _ := rt.ParseLevel(g.Level)
			d.Trace = append(d.Trace, fmt.Sprintf("grant %s %s on %s (%s)", g.Subject, g.Level, st.ID, g.Via))
			if l > d.Level {
				d.Level = l
			}
		}
		if d.Level == rt.LevelNone {
			d.Trace = append(d.Trace, "no grant on "+st.ID+" matches")
		}
		if cp := capOf(d.Audience); d.Level > cp {
			d.Trace = append(d.Trace, fmt.Sprintf("cap %s <= %s", d.Audience, cp))
			d.Level = cp
		}
	}
	if p != nil && p.Kind == KindToken {
		if cp := scopeCap(p.Scopes); d.Level > cp {
			d.Trace = append(d.Trace, fmt.Sprintf("token scopes %v cap at %s", p.Scopes, cp))
			d.Level = cp
		}
	}
	return d
}

// Can checks that p holds at least need on store. hidden makes a failure
// read as not_found (reads of things the caller may not know exist).
func (c *Checker) Can(ctx context.Context, p *Principal, store string, need rt.Level, what string, hidden bool) (Decision, system.StoreRow, error) {
	st, err := c.Sys.StoreByID(ctx, store)
	if errors.Is(err, system.ErrNotFound) {
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
