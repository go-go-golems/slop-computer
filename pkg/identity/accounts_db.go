package identity

import "github.com/go-go-golems/slop-computer/pkg/sysdb"

// Accounts holds this domain's queries over system.db (SLOP3-010 PR 2).
type Accounts struct{ *sysdb.DB }

// NewAccounts is the domain over db.
func NewAccounts(db *sysdb.DB) *Accounts { return &Accounts{DB: db} }
