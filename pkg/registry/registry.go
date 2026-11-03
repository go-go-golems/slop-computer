// Package registry is the platform's registry as documents (SLOP3-008
// phase 3, moved here by SLOP3-009 step 3): stores, their grants, aliases
// and LLM budgets, and people, read and written through the db API by apps
// allowed _stores, each through the verb that owns the row. It knows
// nothing of HTTP: the page door gives it the view and a Host.
package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/system"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// Host is what the documents need from the door that serves them.
type Host interface {
	// Viewer is the person (or guest) behind a view.
	Viewer(ctx context.Context, v *rt.View) *access.Principal
	// ActingApp is that person acting through the view's app (labelled
	// app:<app>); nil for a visitor without an id.
	ActingApp(ctx context.Context, v *rt.View) *access.Principal
	// Reachable lists the stores the viewer may open, at most at ceil.
	Reachable(ctx context.Context, v *rt.View, ceil rt.Level) ([]system.StoreRow, error)
	// WithPrincipal is ctx carrying p, as verb calls expect.
	WithPrincipal(ctx context.Context, p *access.Principal) context.Context
}

// Docs serves the registry's documents.
type Docs struct {
	Sys  *system.DB
	Env  *verbs.Env
	Host Host
	Live *Live
}

// WriteIn is a db write of a registry document.
type WriteIn struct {
	Op        string          // set | update | delete
	Body      json.RawMessage // for set and update
	IfVersion *int64
}

// Error is a refused read or write: a contract error code, and for
// confirmation_required the id of the confirmation the person is asked.
type Error struct{ Code, Message, Confirm string }

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func errf(code, format string, args ...any) error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// LastChange is the newest system revision that changed the row kind/key
// (a store id, "<store> <subject>" for a grant, "<store> <alias>" for a
// binding, a person id): the row's version as a document. 0 when it never
// changed.
func LastChange(ctx context.Context, db *system.DB, kind, key string) int64 {
	var n sql.NullInt64
	_ = db.QueryRowContext(ctx, `SELECT max(rev) FROM _changes WHERE kind = ? AND key = ?`, kind, key).Scan(&n)
	return n.Int64
}

// lastChangeUpTo is LastChange among the revisions up to head. A document
// is versioned at the log head read before its row: a commit that lands
// between reading the row and reading its version would otherwise give an
// old body the new version, and the live document would never be sent the
// new body (its version would not move again).
func lastChangeUpTo(ctx context.Context, db *system.DB, kind, key string, head int64) int64 {
	var n sql.NullInt64
	_ = db.QueryRowContext(ctx, `SELECT max(rev) FROM _changes WHERE kind = ? AND key = ? AND rev <= ?`, kind, key, head).Scan(&n)
	return n.Int64
}
