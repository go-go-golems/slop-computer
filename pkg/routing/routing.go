// Package routing matches request paths against route patterns. It is the
// Go port of the Workshop prototype's matcher (sources/workshop/api.js
// match/specificity/resolve); the two must agree.
package routing

import (
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Match reports whether path matches pattern and returns its parameters.
// ":name" captures one segment, a trailing "*" captures the rest (as "*"),
// and the pattern "*" alone is the fallback that matches everything.
func Match(pattern, path string) (map[string]string, bool) {
	params := map[string]string{}
	if pattern == "*" {
		return params, true
	}
	ps, xs := segments(pattern), segments(path)
	for i, p := range ps {
		if p == "*" {
			params["*"] = strings.Join(xs[min(i, len(xs)):], "/")
			return params, true
		}
		if i >= len(xs) {
			return nil, false
		}
		if strings.HasPrefix(p, ":") {
			v, err := url.PathUnescape(xs[i])
			if err != nil {
				v = xs[i]
			}
			params[p[1:]] = v
		} else if p != xs[i] {
			return nil, false
		}
	}
	return params, len(xs) == len(ps)
}

func segments(p string) []string {
	out := []string{}
	for _, s := range strings.Split(p, "/") {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// Specificity orders patterns: each literal segment counts 3, a :param 2, a
// trailing * 1; the fallback "*" is -1.
func Specificity(pattern string) int {
	if pattern == "*" {
		return -1
	}
	n := 0
	for _, s := range segments(pattern) {
		switch {
		case s == "*":
			n++
		case strings.HasPrefix(s, ":"):
			n += 2
		default:
			n += 3
		}
	}
	return n
}

// Resolution is the route a path resolves to, with its parameters and the
// record path filled in from them. Page is the page the route names for the
// path: its PageFrom filled in, or its Page. The server sets Missing when a
// filled-in page is not one the route may serve, and serves Route.Page.
type Resolution struct {
	Route    store.Route       `json:"route"`
	Params   map[string]string `json:"params"`
	Record   string            `json:"record,omitempty"`
	Page     string            `json:"page"`
	Missing  bool              `json:"missing,omitempty"`
	Fallback bool              `json:"fallback"`
}

var recordParam = regexp.MustCompile(`\{(\w+)\}`)

func fill(t string, params map[string]string) string {
	return recordParam.ReplaceAllStringFunc(t, func(m string) string { return params[m[1:len(m)-1]] })
}

// TemplateMatcher matches the artifact ids a page-from template can name:
// "release-{page}" → ^release-(.+)$.
func TemplateMatcher(t string) *regexp.Regexp {
	parts := recordParam.Split(t, -1)
	for i := range parts {
		parts[i] = regexp.QuoteMeta(parts[i])
	}
	return regexp.MustCompile("^" + strings.Join(parts, "(.+)") + "$")
}

// Resolve picks the most specific route of rows that matches path; rows of
// other hosts are ignored.
func Resolve(rows []store.Route, host, path string) (Resolution, bool) {
	cands := []store.Route{}
	for _, r := range rows {
		if r.Host == host {
			cands = append(cands, r)
		}
	}
	sort.SliceStable(cands, func(i, j int) bool { return Specificity(cands[i].Path) > Specificity(cands[j].Path) })
	if path == "" {
		path = "/"
	}
	for _, r := range cands {
		params, ok := Match(r.Path, path)
		if !ok {
			continue
		}
		res := Resolution{Route: r, Params: params, Page: r.Page, Fallback: r.Path == "*"}
		if r.Record != "" {
			res.Record = fill(r.Record, params)
		}
		if r.PageFrom != "" {
			res.Page = fill(r.PageFrom, params)
		}
		return res, true
	}
	return Resolution{}, false
}
