package billing

import "github.com/go-go-golems/slop-computer/pkg/sysdb"

// Book holds this domain's queries over system.db (SLOP3-010 PR 2).
type Book struct{ *sysdb.DB }

// NewBook is the domain over db.
func NewBook(db *sysdb.DB) *Book { return &Book{DB: db} }
