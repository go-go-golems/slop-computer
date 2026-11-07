package pages

// The cors middleware (SLOP3-012 phase 4). It answers preflights itself
// (before the actor exists for the request) and marks responses to allowed
// origins. It never allows credentials: a cross-origin unsafe request acts
// as nobody on a live host anyway (sitePrincipal), so API clients on other
// origins authenticate with bearer tokens (the apiToken middleware).

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
)

// corsStep runs the cors middleware when the policy enables it.
func (s *Door) corsStep(c *apiCall) bool {
	cfg, on := c.api.CORS()
	origin := c.r.Header.Get("Origin")
	preflight := c.r.Method == http.MethodOptions && c.r.Header.Get("Access-Control-Request-Method") != ""
	if !on || origin == "" || !s.crossOrigin(c.r) {
		return true // not a cross-origin request, or no CORS on this API
	}
	allowed := slices.Contains(cfg.Origins, origin)
	h := c.w.Header()
	h.Add("Vary", "Origin")
	if !preflight {
		if allowed {
			h.Set("Access-Control-Allow-Origin", origin)
		}
		return true // a disallowed origin gets no CORS headers: the browser keeps the answer from it
	}
	if !allowed {
		writeJSONError(c.w, 403, "origin_not_allowed", origin+" may not call this API")
		return false
	}
	want := strings.ToUpper(c.r.Header.Get("Access-Control-Request-Method"))
	methods := allowedMethods(c.api)
	if !methods["*"] && !methods[want] {
		writeJSONError(c.w, 403, "method_not_allowed", want+" is not a method of this API")
		return false
	}
	allowMethods := []string{}
	for m := range methods {
		if m != "*" {
			allowMethods = append(allowMethods, m)
		}
	}
	if methods["*"] {
		allowMethods = []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}
	}
	slices.Sort(allowMethods)
	// The headers a client may send: what the actor is given, and the
	// token's Authorization.
	allowHeaders := append(append([]string{}, c.api.ForwardHeaders...), "authorization")
	maxAge := cfg.MaxAgeSeconds
	if maxAge == 0 {
		maxAge = 600
	}
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Access-Control-Allow-Methods", strings.Join(allowMethods, ", "))
	h.Set("Access-Control-Allow-Headers", strings.Join(allowHeaders, ", "))
	h.Set("Access-Control-Max-Age", fmt.Sprint(maxAge))
	h.Set("Cache-Control", "no-store")
	c.w.WriteHeader(http.StatusNoContent)
	return false
}
