package api

// The HTTP API door (SLOP3-010 PR 3): POST /api/v1/<verb> with the
// arguments as JSON, GET /api/v1/verbs; stream verbs answer as SSE.

import (
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// Door is the HTTP API.
type Door struct {
	Web    *web.Sessions
	People *identity.Accounts // last-seen times
	Verbs  *verbs.Table
}
