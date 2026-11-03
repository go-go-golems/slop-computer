package system

// Transition (SLOP3-010 PR 2): system.db's core and shared rows moved to
// pkg/sysdb, and each domain's queries move to its package. Until the last
// commit of PR 2, DB composes them and these names forward, so every step
// compiles; then this package is deleted.

import (
	"context"

	"github.com/go-go-golems/slop-computer/pkg/llm"

	"github.com/go-go-golems/slop-computer/pkg/registry"

	"github.com/go-go-golems/slop-computer/pkg/identity"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// DB is system.db with every domain's queries.
type DB struct {
	*sysdb.DB
	*llm.Ledger
	*registry.Registry
	*identity.Accounts
}

// Open opens (and migrates) system.db at path.
func Open(ctx context.Context, path string) (*DB, error) {
	d, err := sysdb.Open(ctx, path)
	if err != nil {
		return nil, err
	}
	return &DB{DB: d, Accounts: identity.NewAccounts(d), Registry: registry.NewRegistry(d), Ledger: llm.NewLedger(d)}, nil
}

type (
	Person    = sysdb.Person
	StoreRow  = sysdb.StoreRow
	Grant     = sysdb.Grant
	GrantLink = sysdb.GrantLink
	Link      = sysdb.Link
	Change    = sysdb.Change
	Execer    = sysdb.Execer
	LogEntry  = sysdb.LogEntry
)

const (
	RolePending  = sysdb.RolePending
	RoleMember   = sysdb.RoleMember
	RoleAdmin    = sysdb.RoleAdmin
	RoleDisabled = sysdb.RoleDisabled
	RoleGuest    = sysdb.RoleGuest
	ScopeRead    = sysdb.ScopeRead
	ScopeWrite   = sysdb.ScopeWrite
	ScopeAdmin   = sysdb.ScopeAdmin
)

var (
	ErrNotFound = sysdb.ErrNotFound
	Log         = sysdb.Log
	GroupsOf    = sysdb.GroupsOf
	InGroup     = sysdb.InGroup
	ValidLevel  = sysdb.ValidLevel
	nullStr     = sysdb.NullStr
)

// forwarded from pkg/identity
type (
	Session    = identity.Session
	Token      = identity.Token
	GrantError = identity.GrantError
	DeviceCode = identity.DeviceCode
	LoginFlow  = identity.LoginFlow
	Handoff    = identity.Handoff
)

const (
	SessionDays       = identity.SessionDays
	MaxAdminTokenDays = identity.MaxAdminTokenDays
	DeviceMinutes     = identity.DeviceMinutes
	HandoffTTL        = identity.HandoffTTL
	GuestsPerHour     = identity.GuestsPerHour
	GuestDays         = identity.GuestDays
)

var (
	ErrPending       = identity.ErrPending
	ErrDenied        = identity.ErrDenied
	ErrTooManyGuests = identity.ErrTooManyGuests
	ScopesForRole    = identity.ScopesForRole
	CheckTokenGrant  = identity.CheckTokenGrant
	GuestCutoff      = identity.GuestCutoff
)

// forwarded from pkg/registry
type (
	Binding = registry.Binding
	Preview = registry.Preview
	Mount   = registry.Mount
	Match   = registry.Match
)

var (
	ErrExists      = registry.ErrExists
	ValidStoreID   = registry.ValidStoreID
	ValidMountPath = registry.ValidMountPath
	BestMount      = registry.BestMount
	SortMounts     = registry.SortMounts
)

// forwarded from pkg/llm
type (
	Hold        = llm.Hold
	BudgetMeter = llm.BudgetMeter
	LLMRow      = llm.LLMRow
	LLM         = llm.LLM
)

const (
	HoldTTL = llm.HoldTTL
)

var (
	ErrQuota = llm.ErrQuota
	Period   = llm.Period
)
