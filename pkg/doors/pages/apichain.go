package pages

// The host middleware chain of a mount's API (SLOP3-012 phase 4). It runs
// in the pages door before MatchRoute, because MatchRoute builds the
// store's actor: a request the chain refuses costs no actor build, no inbox
// slot and no turn. The order is slop's, fixed; a mount's policy only
// enables and configures steps, so no policy can misorder them:
//
//  1. rateLimit {per: ip}       429 + Retry-After
//  2. cors                      answers preflights; marks allowed origins
//  3. methods                   405 for a method no allowed route has
//  4. maxBody                   413 when Content-Length is over the limit
//  5. apiToken                  a bearer token becomes the principal; 401
//  6. rateLimit {per: visitor}  keyed by the principal
//
// Then MatchRoute, the level and audience checks, the turn, and the
// response filters (serveActorRoute).

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/registry"
)

// apiCall is one request on an API mount, as the chain sees it.
type apiCall struct {
	w     http.ResponseWriter
	r     *http.Request
	mount string // host+path of the mount: rate limits are per mount
	api   *registry.MountAPI
	p     *access.Principal // the site's principal, or the token's after apiToken
}

// runAPIChain runs the chain; false means a step answered the request.
func (s *Door) runAPIChain(c *apiCall) bool {
	now := time.Now()
	limits := c.api.RateLimits()
	for _, rl := range limits {
		if rl.Per == "ip" && !s.limitStep(c, rl, "ip:"+s.Web.ClientIP(c.r), now) {
			return false
		}
	}
	if !s.corsStep(c) || !methodsStep(c) || !maxBodyStep(c) || !s.apiTokenStep(c) {
		return false
	}
	for _, rl := range limits {
		if rl.Per == "visitor" {
			key := "ip:" + s.Web.ClientIP(c.r) // nobody is keyed by address
			if c.p != nil {
				key = "who:" + c.p.ID()
			}
			if !s.limitStep(c, rl, key, now) {
				return false
			}
		}
	}
	return true
}

// limitStep takes a token from the bucket of (mount, rule, key).
func (s *Door) limitStep(c *apiCall, rl registry.RateLimitConfig, key string, now time.Time) bool {
	ok, retry := s.limiter.take(c.mount+"|"+rl.Per+"|"+key, rl, now)
	if ok {
		return true
	}
	secs := int(retry.Seconds() + 0.999)
	if secs < 1 {
		secs = 1
	}
	c.w.Header().Set("Retry-After", fmt.Sprint(secs))
	writeJSONError(c.w, 429, "rate_limited", fmt.Sprintf("at most %d requests per %s; retry in %ds", rl.Limit, rl.WindowDuration(), secs))
	return false
}

// methodsStep refuses a method that no allowlist entry names.
func methodsStep(c *apiCall) bool {
	methods := allowedMethods(c.api)
	if methods["*"] || methods[c.r.Method] {
		return true
	}
	allow := make([]string, 0, len(methods))
	for m := range methods {
		allow = append(allow, m)
	}
	slices.Sort(allow)
	c.w.Header().Set("Allow", strings.Join(allow, ", "))
	writeJSONError(c.w, 405, "method_not_allowed", c.r.Method+" is not a method of this API")
	return false
}

// allowedMethods are the methods of the policy's allowlist (GET brings HEAD).
func allowedMethods(api *registry.MountAPI) map[string]bool {
	out := map[string]bool{}
	for _, r := range api.Routes {
		m, _ := registry.SplitKey(r)
		out[m] = true
		if m == "GET" {
			out["HEAD"] = true
		}
	}
	return out
}

// maxBodyStep refuses a declared body over the limit before anything reads
// it (serveActorRoute still checks what it reads: Content-Length can be
// absent or wrong).
func maxBodyStep(c *apiCall) bool {
	if c.r.ContentLength > c.api.MaxBodyBytes {
		writeJSONError(c.w, 413, "payload_too_large", fmt.Sprintf("the body is limited to %d bytes", c.api.MaxBodyBytes))
		return false
	}
	return true
}
