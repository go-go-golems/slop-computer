package registry

// A mount's API policy (SLOP3-012 phase 3): which of the served store's
// actor routes a mount exposes, at what level at least, behind which host
// middlewares, and with which request and response rules. The mount is the
// prefix an app's endpoints live under (an admin sets it), so the policy
// lives there too: the same app mounted twice can expose two different
// APIs. This file is data and validation only; the pages door enforces it.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime"
	"slices"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Byte limits of a mount's API policy.
const (
	DefaultMaxBodyBytes     = 1 << 20
	MaxMaxBodyBytes         = 8 << 20
	DefaultMaxResponseBytes = 4 << 20
	MaxMaxResponseBytes     = 32 << 20
)

// DefaultResponseTypes and DefaultForwardHeaders apply when a policy names none.
var (
	DefaultResponseTypes  = []string{"application/json", "text/plain"}
	DefaultForwardHeaders = []string{"content-type", "accept", "user-agent", "referer"}
	// neverForwarded are request headers an actor never sees: identity is slop's.
	neverForwarded = []string{"cookie", "authorization", "proxy-authorization", "set-cookie"}
)

// MountAPI is a mount's API policy.
type MountAPI struct {
	Prefix           string       `json:"prefix,omitempty"`           // below the mount ("" = the whole mount): only paths under it reach the actor
	Routes           []string     `json:"routes"`                     // allowlist of route keys ("GET /api/*")
	Floors           []Floor      `json:"floors,omitempty"`           // minimum level and audience per route pattern
	DefaultMin       string       `json:"defaultMin,omitempty"`       // the floor where none matches (default view)
	Middleware       []Middleware `json:"middleware,omitempty"`       // host middlewares, run in slop's fixed order
	ResponseTypes    []string     `json:"responseTypes,omitempty"`    // media types a response may have (default json, text)
	ForwardHeaders   []string     `json:"forwardHeaders,omitempty"`   // request headers the actor sees (default four)
	MaxBodyBytes     int64        `json:"maxBodyBytes,omitempty"`     // larger request bodies answer 413 (default 1 MiB, at most 8 MiB)
	MaxResponseBytes int64        `json:"maxResponseBytes,omitempty"` // larger responses answer 500 (default 4 MiB, at most 32 MiB)
}

// Floor raises the level (and adds an audience) for the routes its
// pattern covers.
type Floor struct {
	Route    string `json:"route"`              // a route key, as in Routes
	Min      string `json:"min,omitempty"`      // public, view, interact, admin or owner
	Audience string `json:"audience,omitempty"` // a group the visitor must be in
}

// Middleware enables one host middleware; Config is decoded strictly by Name.
type Middleware struct {
	Name   string          `json:"name"` // rateLimit, cors or apiToken
	Config json.RawMessage `json:"config,omitempty"`
}

// RateLimitConfig is the rateLimit middleware's configuration: a token
// bucket of Burst (default Limit) tokens refilled at Limit per Window.
type RateLimitConfig struct {
	Per    string `json:"per"`              // ip or visitor
	Limit  int    `json:"limit"`            // requests per window
	Window string `json:"window,omitempty"` // a duration such as "1m" (default 1m)
	Burst  int    `json:"burst,omitempty"`  // the bucket's size (default Limit)
}

// CORSConfig is the cors middleware's configuration. Credentials are never
// allowed: cross-origin API clients authenticate with tokens.
type CORSConfig struct {
	Origins       []string `json:"origins"`                 // allowed origins, scheme://host[:port]
	MaxAgeSeconds int      `json:"maxAgeSeconds,omitempty"` // preflight cache (default 600)
}

// APITokenConfig is the apiToken middleware's configuration: a bearer
// token acts as its person, with the token's scopes.
type APITokenConfig struct {
	Required bool `json:"required,omitempty"` // refuse requests without a valid token (401)
}

// WindowDuration is the rate limit's window.
func (c RateLimitConfig) WindowDuration() time.Duration {
	if c.Window == "" {
		return time.Minute
	}
	d, _ := time.ParseDuration(c.Window)
	return d
}

// Validate checks a rate limit.
func (c RateLimitConfig) Validate() error {
	if c.Per != "ip" && c.Per != "visitor" {
		return fmt.Errorf("per is ip or visitor")
	}
	if c.Limit < 1 || c.Limit > 1_000_000 {
		return fmt.Errorf("limit is between 1 and 1000000")
	}
	if c.Window != "" {
		d, err := time.ParseDuration(c.Window)
		if err != nil || d < time.Second || d > 24*time.Hour {
			return fmt.Errorf("window is a duration between 1s and 24h")
		}
	}
	if c.Burst < 0 || c.Burst > 1_000_000 {
		return fmt.Errorf("burst is between 0 and 1000000")
	}
	return nil
}

// Validate checks a CORS configuration.
func (c CORSConfig) Validate() error {
	if len(c.Origins) == 0 {
		return fmt.Errorf("origins lists at least one origin")
	}
	for _, o := range c.Origins {
		if !validOrigin(o) {
			return fmt.Errorf("origin %q is not scheme://host[:port]", o)
		}
	}
	if c.MaxAgeSeconds < 0 || c.MaxAgeSeconds > 86400 {
		return fmt.Errorf("maxAgeSeconds is between 0 and 86400")
	}
	return nil
}

// Validate checks an apiToken configuration (nothing to check).
func (c APITokenConfig) Validate() error { return nil }

func validOrigin(o string) bool {
	rest, ok := strings.CutPrefix(o, "https://")
	if !ok {
		rest, ok = strings.CutPrefix(o, "http://")
	}
	return ok && rest != "" && !strings.ContainsAny(rest, "/?#@ *")
}

// decodeStrict decodes raw into v, refusing unknown fields and trailing data.
func decodeStrict(raw json.RawMessage, v any) error {
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = json.RawMessage("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if dec.More() {
		return fmt.Errorf("trailing data after the configuration")
	}
	return nil
}

// RateLimits, CORS and APIToken decode a validated policy's middlewares.
func (a *MountAPI) RateLimits() []RateLimitConfig {
	var out []RateLimitConfig
	for _, m := range a.Middleware {
		if m.Name == "rateLimit" {
			var c RateLimitConfig
			if decodeStrict(m.Config, &c) == nil {
				out = append(out, c)
			}
		}
	}
	return out
}

// CORS is the policy's cors middleware, if it enables one.
func (a *MountAPI) CORS() (CORSConfig, bool) {
	for _, m := range a.Middleware {
		if m.Name == "cors" {
			var c CORSConfig
			return c, decodeStrict(m.Config, &c) == nil
		}
	}
	return CORSConfig{}, false
}

// APIToken is the policy's apiToken middleware, if it enables one.
func (a *MountAPI) APIToken() (APITokenConfig, bool) {
	for _, m := range a.Middleware {
		if m.Name == "apiToken" {
			var c APITokenConfig
			return c, decodeStrict(m.Config, &c) == nil
		}
	}
	return APITokenConfig{}, false
}

// ValidateAPI checks a mount's API policy (nil is no policy).
func ValidateAPI(a *MountAPI) error {
	if a == nil {
		return nil
	}
	if a.Prefix != "" && (a.Prefix == "/" || !ValidMountPath(a.Prefix) || strings.ContainsAny(a.Prefix, ":*")) {
		return fmt.Errorf("prefix is a literal path such as /api (or empty for the whole mount)")
	}
	if len(a.Routes) == 0 {
		return fmt.Errorf("routes lists at least one route key (remove the api block to serve every route)")
	}
	for _, r := range a.Routes {
		if !ValidRouteKey(r) {
			return fmt.Errorf("route %q is not METHOD /pattern (GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS or *)", r)
		}
		if _, p := SplitKey(r); !UnderPrefix(p, a.Prefix) {
			return fmt.Errorf("route %q is not under the prefix %s", r, a.Prefix)
		}
	}
	if a.DefaultMin != "" && LevelRank(a.DefaultMin) < 0 {
		return fmt.Errorf("defaultMin %q is public, view, interact, admin or owner", a.DefaultMin)
	}
	for _, f := range a.Floors {
		if !ValidRouteKey(f.Route) {
			return fmt.Errorf("floor route %q is not METHOD /pattern", f.Route)
		}
		if f.Min == "" && f.Audience == "" {
			return fmt.Errorf("floor %s sets neither min nor audience", f.Route)
		}
		if f.Min != "" && LevelRank(f.Min) < 0 {
			return fmt.Errorf("floor %s: min %q is public, view, interact, admin or owner", f.Route, f.Min)
		}
		if f.Audience != "" && (!sysdb.ValidGroup(f.Audience) || strings.TrimPrefix(f.Audience, "@") == "store") {
			return fmt.Errorf("floor %s: audience %q is guest, member, subscriber or admin", f.Route, f.Audience)
		}
	}
	seen := map[string]bool{}
	for _, m := range a.Middleware {
		var err error
		slot := m.Name
		switch m.Name {
		case "rateLimit":
			var c RateLimitConfig
			if err = decodeStrict(m.Config, &c); err == nil {
				err = c.Validate()
			}
			slot += ":" + c.Per
		case "cors":
			var c CORSConfig
			if err = decodeStrict(m.Config, &c); err == nil {
				err = c.Validate()
			}
		case "apiToken":
			var c APITokenConfig
			if err = decodeStrict(m.Config, &c); err == nil {
				err = c.Validate()
			}
		default:
			return fmt.Errorf("middleware %q is rateLimit, cors or apiToken", m.Name)
		}
		if err != nil {
			return fmt.Errorf("middleware %s: %v", m.Name, err)
		}
		if seen[slot] {
			return fmt.Errorf("middleware %s is listed twice", slot)
		}
		seen[slot] = true
	}
	for _, t := range a.ResponseTypes {
		mt, params, err := mime.ParseMediaType(t)
		if err != nil || len(params) > 0 || mt != strings.ToLower(t) || !strings.Contains(mt, "/") || strings.Contains(mt, "*") {
			return fmt.Errorf("response type %q is a media type such as application/json (lowercase, no parameters or wildcards)", t)
		}
	}
	for _, h := range a.ForwardHeaders {
		if slices.Contains(neverForwarded, strings.ToLower(h)) {
			return fmt.Errorf("header %s is never forwarded: identity is slop's (use the apiToken middleware)", h)
		}
		if h == "" || strings.ContainsAny(h, " :\t") {
			return fmt.Errorf("header %q is not a header name", h)
		}
	}
	if a.MaxBodyBytes < 0 || a.MaxBodyBytes > MaxMaxBodyBytes {
		return fmt.Errorf("maxBodyBytes is between 1 and %d", MaxMaxBodyBytes)
	}
	if a.MaxResponseBytes < 0 || a.MaxResponseBytes > MaxMaxResponseBytes {
		return fmt.Errorf("maxResponseBytes is between 1 and %d", MaxMaxResponseBytes)
	}
	return nil
}

// WithDefaults is the policy as enforced: unset fields at their defaults,
// header names lowercase.
func (a MountAPI) WithDefaults() MountAPI {
	if a.DefaultMin == "" {
		a.DefaultMin = "view"
	}
	if len(a.ResponseTypes) == 0 {
		a.ResponseTypes = DefaultResponseTypes
	}
	if len(a.ForwardHeaders) == 0 {
		a.ForwardHeaders = DefaultForwardHeaders
	} else {
		hs := make([]string, len(a.ForwardHeaders))
		for i, h := range a.ForwardHeaders {
			hs[i] = strings.ToLower(h)
		}
		a.ForwardHeaders = hs
	}
	if a.MaxBodyBytes == 0 {
		a.MaxBodyBytes = DefaultMaxBodyBytes
	}
	if a.MaxResponseBytes == 0 {
		a.MaxResponseBytes = DefaultMaxResponseBytes
	}
	return a
}

// UnderPrefix reports whether a path (with a leading slash) is the prefix
// or below it; every path is under "".
func UnderPrefix(p, prefix string) bool {
	if prefix == "" {
		return true
	}
	return p == prefix || strings.HasPrefix(p, prefix+"/")
}

// AllowsKey reports whether some allowlist entry covers a route key.
func (a *MountAPI) AllowsKey(key string) bool {
	for _, r := range a.Routes {
		if Covers(r, key) {
			return true
		}
	}
	return false
}

// FloorOf is the floor for a route key: the min and audience of the most
// specific floor that covers it (literal segments 2, :params 1; the first
// wins a tie), else DefaultMin (view when unset) and no audience.
func (a *MountAPI) FloorOf(key string) Floor {
	def := a.DefaultMin
	if def == "" {
		def = "view"
	}
	best, bestScore := Floor{Min: def}, -1
	for _, f := range a.Floors {
		if !Covers(f.Route, key) {
			continue
		}
		if s := patternScore(f.Route); s > bestScore {
			best, bestScore = f, s
		}
	}
	if best.Min == "" {
		best.Min = def // a floor with only an audience keeps the default level
	}
	return best
}

func patternScore(key string) int {
	_, p := SplitKey(key)
	score := 0
	for _, s := range segs(p) {
		switch {
		case s == "*":
		case strings.HasPrefix(s, ":"):
			score++
		default:
			score += 2
		}
	}
	return score
}

// LevelRank orders route levels: public 0, view 1, interact 2, admin 3,
// owner 4; -1 for anything else.
func LevelRank(level string) int {
	return slices.Index([]string{"public", "view", "interact", "admin", "owner"}, level)
}

// MaxLevel is the higher of two route levels (an unknown one wins, so a
// typo fails closed).
func MaxLevel(a, b string) string {
	if LevelRank(a) < 0 || LevelRank(a) >= LevelRank(b) {
		return a
	}
	return b
}

// Covers reports whether allowlist entry allow covers route key key: every
// request key can match is also matched by allow. A parameter covers a
// literal or a parameter; a literal only the same literal; a final *
// covers the rest, including a key's own *. A "*" method is covered only by
// a "*" entry; GET covers HEAD (a GET route answers HEAD).
func Covers(allow, key string) bool {
	am, ap := SplitKey(allow)
	km, kp := SplitKey(key)
	if am != "*" && am != km && (am != "GET" || km != "HEAD") {
		return false
	}
	as, ks := segs(ap), segs(kp)
	for i, a := range as {
		if a == "*" {
			return true
		}
		if i >= len(ks) || ks[i] == "*" {
			return false
		}
		if !strings.HasPrefix(a, ":") && a != ks[i] {
			return false // a literal covers only the same literal
		}
	}
	return len(as) == len(ks)
}

func segs(p string) []string {
	t := strings.Trim(p, "/")
	if t == "" {
		return nil
	}
	return strings.Split(t, "/")
}

// MatchPattern matches a route pattern (/a/:b/*) against a request path:
// the parameters, a score (literal segments 2, :params 1) and whether it
// matched. A final * binds the rest of the path, which may be empty.
func MatchPattern(pat, p string) (map[string]string, int, bool) {
	ps, xs := segs(pat), segs(p)
	params := map[string]string{}
	score := 0
	for i, s := range ps {
		if s == "*" {
			params["*"] = strings.Join(xs[i:], "/")
			return params, score, true
		}
		if i >= len(xs) {
			return nil, 0, false
		}
		switch {
		case strings.HasPrefix(s, ":"):
			params[s[1:]] = xs[i]
			score++
		case s == xs[i]:
			score += 2
		default:
			return nil, 0, false
		}
	}
	if len(xs) != len(ps) {
		return nil, 0, false
	}
	return params, score, true
}
