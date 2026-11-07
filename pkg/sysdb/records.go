package sysdb

// The rows several domains and pkg/access read (SLOP3-010 PR 2): people
// and their roles, token scopes, stores, grants and links, and the group
// nesting of audiences. Each domain owns its queries; these are the shapes
// they share.

import "strings"

const (
	RolePending  = "pending"
	RoleMember   = "member"
	RoleAdmin    = "admin"
	RoleDisabled = "disabled"
	RoleGuest    = "guest"
)

// Person is a user or a guest.
type Person struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Email      string `json:"email,omitempty"`
	Name       string `json:"name"`
	Role       string `json:"role"`
	CreatedAt  int64  `json:"createdAt"`
	LastSeenAt int64  `json:"lastSeenAt"`
}

// Scopes of a token.
const (
	ScopeRead  = "read"
	ScopeWrite = "write"
	ScopeAdmin = "admin"
)

// StoreRow is a store's registry row.
type StoreRow struct {
	ID        string `json:"id"`
	Type      string `json:"type,omitempty"`
	App       string `json:"app,omitempty"` // the app store it runs; "" = itself
	Owner     string `json:"owner"`
	CreatedAt int64  `json:"createdAt"`
	MadeBy    string `json:"madeBy,omitempty"`
}

// Grant gives a subject a level on a store.
type Grant struct {
	Store     string `json:"store"`
	Subject   string `json:"subject"`
	Level     string `json:"level"`
	Via       string `json:"via"`
	CreatedBy string `json:"createdBy,omitempty"`
	CreatedAt int64  `json:"createdAt"`
	// Link is the share link a grant came from (via = its id), read with
	// the grant: a link grant counts only while the link does (SLOP3-007).
	Link *GrantLink `json:"-"`
	// Inactive says why a link grant no longer counts (grant.ls fills it).
	Inactive string `json:"inactive,omitempty"`
}

// GrantLink is the state of the link behind a grant.
type GrantLink struct {
	Creator   string // who made the link: their level bounds it
	Level     string // the level the link gives
	RevokedAt int64  // 0: not revoked
	ExpiresAt int64  // 0: never
}

// Live reports whether the link still stands at now (ms): not revoked, not
// expired. Its creator's level is checked by the caller (access), which
// can compute levels.
func (l *GrantLink) Live(now int64) bool {
	return l.RevokedAt == 0 && (l.ExpiresAt == 0 || l.ExpiresAt > now)
}

// LevelRank orders levels.
var LevelRank = map[string]int{"": 0, "none": 0, "view": 1, "interact": 2, "admin": 3, "owner": 4}

// ValidLevel reports a grantable level.
func ValidLevel(l string) bool { return LevelRank[l] > 0 }

// Link is a share link: a secret URL that gives its opener a level on a
// store, by writing a grant whose via is the link's id.
type Link struct {
	ID        string `json:"id"`
	Store     string `json:"store"`
	Level     string `json:"level"`
	CreatedBy string `json:"createdBy"`
	CreatedAt int64  `json:"createdAt"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
	RevokedAt int64  `json:"revokedAt,omitempty"`
	Uses      int    `json:"uses"` // grants it gave that still stand
}

// GroupsOf is the one place group nesting is decided (SLOP3-007 decision
// 1): @admin ⊆ @subscriber ⊆ @member ⊆ @guest, so an audience's groups are
// it and every audience below it. "store" (a store acting on its own) is a
// group of its own, inside none of the others. Every "is this person in
// this class?" question reads this, never a rank.
func GroupsOf(audience string) []string {
	switch audience {
	case "guest":
		return []string{"guest"}
	case "member":
		return []string{"guest", "member"}
	case "subscriber":
		return []string{"guest", "member", "subscriber"}
	case "admin":
		return []string{"guest", "member", "subscriber", "admin"}
	case "store":
		return []string{"store"}
	}
	return nil
}

// ValidGroup reports whether group (with or without its "@") is a person
// group or "store".
func ValidGroup(group string) bool {
	return GroupsOf(strings.TrimPrefix(group, "@")) != nil
}

// InGroup reports whether an audience's groups include group (with or
// without its "@").
func InGroup(audience, group string) bool {
	if len(group) > 0 && group[0] == '@' {
		group = group[1:]
	}
	for _, g := range GroupsOf(audience) {
		if g == group {
			return true
		}
	}
	return false
}
