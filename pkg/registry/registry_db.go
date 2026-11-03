package registry

import "github.com/go-go-golems/slop-computer/pkg/sysdb"

// Registry holds this domain's queries over system.db (SLOP3-010 PR 2).
type Registry struct{ *sysdb.DB }

// NewRegistry is the domain over db.
func NewRegistry(db *sysdb.DB) *Registry { return &Registry{DB: db} }
