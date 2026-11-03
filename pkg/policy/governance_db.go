package policy

import "github.com/go-go-golems/slop-computer/pkg/sysdb"

// Governance holds this domain's queries over system.db (SLOP3-010 PR 2).
type Governance struct{ *sysdb.DB }

// NewGovernance is the domain over db.
func NewGovernance(db *sysdb.DB) *Governance { return &Governance{DB: db} }
