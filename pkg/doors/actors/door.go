// Package actors is the actor door (SLOP3-010 PR 3, PR 4): what an app's
// actor can use() from outside its own store. Capabilities are bound here
// (room on pkg/caps/room, sample on pkg/caps/sample), and so are the
// platform-changing modules: system and workshop (verb-backed, with
// governance confirmation) and platform, each a verb call made as the
// visitor through the table. The runtime (pkg/actor) keeps the modules of
// the actor's own store, which run inside its turn: sql, db, files,
// storage, alarm, time, log, stores, fetch and secrets.
package actors

import (
	caproom "github.com/go-go-golems/slop-computer/pkg/caps/room"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/llm"
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
	// Ledger meters sampling; Rooms is the room capability over the page
	// door's open views (nil: room.emit reaches nobody).
	Ledger *llm.Ledger
	Rooms  *caproom.Rooms
}
