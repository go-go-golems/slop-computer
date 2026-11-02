// Package access answers who is acting (principals and audiences) and
// whether they may do something (levels, grants, rules, policy, LLM access).
package access

import (
	"slices"

	"github.com/go-go-golems/slop/pkg/system"
)

// Kinds of principal.
const (
	KindUser   = "user"
	KindGuest  = "guest"
	KindToken  = "token"
	KindStore  = "store"
	KindSystem = "system"
)

// Principal is whoever acts on a request or a turn.
type Principal struct {
	Kind    string         // user, guest, token, store, system; guest with an empty Person is an id-less visitor
	Person  *system.Person // the user or guest (the token's user for tokens)
	TokenID string         // tokens only
	Scopes  []string       // tokens only
	Store   string         // store principals: the store id
	Via     string         // how the request came in: cli, http, eval, page, actor, ...
}

// ID is what logs and slop_principal() record: the person for users, guests
// and tokens (a token acts as its user), store:<id> for stores, "system".
func (p *Principal) ID() string {
	switch {
	case p == nil:
		return ""
	case p.Kind == KindSystem:
		return "system"
	case p.Kind == KindStore:
		return "store:" + p.Store
	case p.Person != nil:
		return p.Person.ID
	}
	return ""
}

// ViaLabel is the log's via column: the door, plus the token id for agents.
func (p *Principal) ViaLabel() string {
	v := p.Via
	if v == "" {
		v = "http"
	}
	if p.TokenID != "" {
		v += ":" + p.TokenID
	}
	return v
}

// Role is the person's platform role ("" for id-less guests, stores, system).
func (p *Principal) Role() string {
	if p == nil || p.Person == nil {
		return ""
	}
	return p.Person.Role
}

// IsAdmin reports a signed-in admin (or an admin's token).
func (p *Principal) IsAdmin() bool {
	return p != nil && (p.Kind == KindSystem || (p.Person != nil && p.Person.Role == system.RoleAdmin))
}

// HasScope reports whether a token carries a scope; sessions carry all.
// Scopes are ordered: admin implies write implies read.
func (p *Principal) HasScope(need string) bool {
	if p == nil || p.Kind != KindToken {
		return true
	}
	switch need {
	case system.ScopeRead:
		return len(p.Scopes) > 0
	case system.ScopeWrite:
		return slices.Contains(p.Scopes, system.ScopeWrite) || slices.Contains(p.Scopes, system.ScopeAdmin)
	case system.ScopeAdmin:
		return slices.Contains(p.Scopes, system.ScopeAdmin)
	}
	return false
}

// System is the kernel acting on its own behalf.
var System = &Principal{Kind: KindSystem, Via: "kernel"}
