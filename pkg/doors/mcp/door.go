package mcp

import (
	"github.com/go-go-golems/slop-computer/pkg/config"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// Door is the MCP door.
type Door struct {
	Cfg    *config.Config // the main host (Origin checks)
	Web    *web.Sessions
	People *identity.Accounts // last-seen times
	Verbs  *verbs.Table
}

// maxBody bounds a JSON-RPC message (as the HTTP API's body).
const maxBody = 96 << 20
