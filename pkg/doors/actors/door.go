// Package actors is the actor door (SLOP3-010 PR 3): the Go modules an app's
// actor can use() — system, workshop (verb-backed, with governance
// confirmation) and platform — each a verb call made as the visitor
// through the table. Room emit and actor routes still live with the pages
// (they read the open views); PR 4 moves them onto capabilities.
package actors

import (
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/policy"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// Door builds the modules.
type Door struct {
	Web   *web.Sessions
	Gov   *policy.Governance
	Verbs *verbs.Table
	// Confirm is the book of governance changes waiting for a person.
	Confirm *verbs.Confirmations
}
