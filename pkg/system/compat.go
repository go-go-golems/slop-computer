package system

// Transition (SLOP3-010 PR 2): system.db's core and shared rows moved to
// pkg/sysdb, and each domain's queries move to its package. Until the last
// commit of PR 2, DB composes them and these names forward, so every step
// compiles; then this package is deleted.

import (
	"context"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// DB is system.db with every domain's queries.
type DB struct {
	*sysdb.DB
}

// Open opens (and migrates) system.db at path.
func Open(ctx context.Context, path string) (*DB, error) {
	d, err := sysdb.Open(ctx, path)
	if err != nil {
		return nil, err
	}
	return &DB{DB: d}, nil
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
	levelRank   = sysdb.LevelRank
	nullStr     = sysdb.NullStr
	nullInt     = sysdb.NullInt
	splitScopes = sysdb.SplitScopes
)
