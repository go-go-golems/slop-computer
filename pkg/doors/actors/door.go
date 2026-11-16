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
	"context"

	"github.com/go-go-golems/slop-computer/pkg/access"
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
	// Embed and RenewEmbed open and renew a view of a store framed by a
	// tool app's own page (the page door's; SLOP3-022 C.1). Nil: the
	// workshop module has no embed.
	Embed      func(ctx context.Context, p *access.Principal, store, toolStore, toolApp string, dev bool) (map[string]any, error)
	RenewEmbed func(ctx context.Context, p *access.Principal, view, toolStore, toolApp string) (map[string]any, error)
}
