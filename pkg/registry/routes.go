package registry

// Route keys and patterns (SLOP3-012): the "METHOD /pattern" keys of an
// actor's http routes, shared by the actor runtime (which registers and
// matches them), the pages door and the mount verbs (which check them
// against a mount's API policy). Data only: no HTTP, no goja.

import "strings"

// RouteMethods are the methods a route key may name; "*" is any method.
var RouteMethods = map[string]bool{"GET": true, "HEAD": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true, "OPTIONS": true, "*": true}

// SplitKey splits "GET /a/:b" into its method and pattern.
func SplitKey(key string) (string, string) {
	method, pattern, _ := strings.Cut(key, " ")
	return method, pattern
}

// ValidRouteKey reports whether key is "METHOD /pattern": a method of
// RouteMethods, one space, and a pattern of literal segments, :name
// segments and an optional final * ("/" alone is the mount's root).
func ValidRouteKey(key string) bool {
	method, pattern, ok := strings.Cut(key, " ")
	return ok && RouteMethods[method] && ValidRoutePattern(pattern)
}

// ValidRoutePattern reports whether pattern is a route pattern.
func ValidRoutePattern(pattern string) bool {
	if !strings.HasPrefix(pattern, "/") || strings.ContainsAny(pattern, " ?#") {
		return false
	}
	if pattern == "/" {
		return true
	}
	segs := strings.Split(strings.TrimPrefix(pattern, "/"), "/")
	for i, s := range segs {
		switch {
		case s == "*":
			if i != len(segs)-1 {
				return false
			}
		case strings.HasPrefix(s, ":"):
			if !validParam(s[1:]) {
				return false
			}
		case s == "" || strings.ContainsAny(s, ":*"):
			return false
		}
	}
	return true
}

func validParam(name string) bool {
	if name == "" {
		return false
	}
	for i, c := range name {
		letter := c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
		digit := i > 0 && c >= '0' && c <= '9'
		if !letter && !digit {
			return false
		}
	}
	return true
}
