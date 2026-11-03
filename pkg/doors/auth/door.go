// Package auth is the sign-in door: local and OIDC sign-in, sign-out, the
// session probe and device login (SLOP3-010 PR 3). It starts main-host
// sessions; doors/web reads them.
package auth

import (
	"net/http"

	"github.com/go-go-golems/slop-computer/pkg/config"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/identity"
)

// Door serves /auth/* and /device.
type Door struct {
	Cfg    *config.Config
	Web    *web.Sessions
	People *identity.Accounts

	// oidcLogin starts an OIDC sign-in (nil until Setup configures OIDC).
	oidcLogin func(w http.ResponseWriter, r *http.Request, ret string)
	oidc      *identity.Provider
}
