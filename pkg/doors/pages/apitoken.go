package pages

// The apiToken middleware (SLOP3-012 phase 4): a bearer token on an API
// mount acts as its person, with the token's scopes, as on the main host
// (web.Sessions.Principal). Without the middleware, Authorization is ignored
// on live hosts, as before. A token that does not resolve is refused, never
// silently downgraded to the site cookie.

import (
	"net/http"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

func (s *Door) apiTokenStep(c *apiCall) bool {
	cfg, on := c.api.APIToken()
	if !on {
		return true
	}
	h := c.r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		if cfg.Required {
			unauthorized(c.w, "this API needs a bearer token")
			return false
		}
		return true
	}
	ctx := c.r.Context()
	t, err := s.People.TokenBySecret(ctx, strings.TrimPrefix(h, "Bearer "))
	if err != nil {
		unauthorized(c.w, "the token is not valid")
		return false
	}
	p := s.Web.PersonAs(ctx, t.Person, "http")
	if p == nil {
		unauthorized(c.w, "the token's person cannot sign in")
		return false
	}
	p.Kind, p.TokenID, p.Scopes = access.KindToken, t.ID, t.Scopes
	// A token's scopes do not cap its person's level on a store; they cap
	// what it may do: a read token makes safe requests only.
	if !safeMethod(c.r.Method) && !p.HasScope(sysdb.ScopeWrite) {
		writeJSONError(c.w, 403, "insufficient_scope", c.r.Method+" needs a token with the write scope")
		return false
	}
	if !p.HasScope(sysdb.ScopeRead) {
		writeJSONError(c.w, 403, "insufficient_scope", "the token has no scope")
		return false
	}
	c.p = p
	return true
}

func safeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

func unauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="slop"`)
	writeJSONError(w, 401, "unauthenticated", msg)
}
