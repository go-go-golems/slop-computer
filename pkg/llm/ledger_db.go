package llm

import "github.com/go-go-golems/slop-computer/pkg/sysdb"

// Ledger holds this domain's queries over system.db (SLOP3-010 PR 2).
type Ledger struct{ *sysdb.DB }

// NewLedger is the domain over db.
func NewLedger(db *sysdb.DB) *Ledger { return &Ledger{DB: db} }
