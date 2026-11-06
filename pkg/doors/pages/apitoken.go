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
	c.p = p
	return true
}

func unauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="slop"`)
	writeJSONError(w, 401, "unauthenticated", msg)
}
