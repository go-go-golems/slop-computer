package server

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/routing"
)

func (s *Server) previewRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/sandbox-url", s.guard(admin, scopeRW, s.sandboxURL))
	m.HandleFunc("GET /api/resolve", s.guardPerm(admin, scopeRW, "routes:read", s.resolveRoute))
	m.HandleFunc("GET /api/artifacts/{id}/versions/{n}/records", s.guardPerm(admin, scopeRW, "versions:read", s.versionRecords))
}

// sandboxURL mints the preview URL of a version: its own origin under the
// sandbox domain, with an unguessable label. ?host=&path= give a route
// context; mode is preview or thumb.
func (s *Server) sandboxURL(w http.ResponseWriter, r *http.Request) {
	if s.Config.SandboxDomain == "" {
		httpx.Fail(w, 503, "no_sandbox", "This server has no sandbox domain (--sandbox-domain)")
		return
	}
	q := r.URL.Query()
	artifact := q.Get("artifact")
	n, err := strconv.Atoi(q.Get("n"))
	if err != nil || n <= 0 {
		a, aerr := s.Store.Artifact(r.Context(), artifact)
		if aerr != nil {
			storeFail(w, aerr)
			return
		}
		n = a.Main
	}
	if _, err = s.Store.Version(r.Context(), artifact, n); err != nil {
		storeFail(w, err)
		return
	}
	label, err := s.Store.SandboxLabel(r.Context(), artifact, n)
	if err != nil {
		unavailable(w, err)
		return
	}
	p := q.Get("path")
	if !strings.HasPrefix(p, "/") {
		p = "/"
	}
	params := url.Values{"parent": {s.requestOrigin(r)}}
	for _, k := range []string{"mode", "host"} {
		if v := q.Get(k); v != "" {
			params.Set(k, v)
		}
	}
	u := url.URL{Scheme: s.Config.PublicURL.Scheme, Host: label + "." + s.Config.SandboxDomain, Path: p, RawQuery: params.Encode()}
	httpx.OK(w, map[string]any{"url": u.String(), "origin": u.Scheme + "://" + u.Host, "artifact": artifact, "n": n})
}

// resolveRoute answers what a visitor would get at host+path.
func (s *Server) resolveRoute(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	host := strings.ToLower(q.Get("host"))
	routes, err := s.Store.Routes(r.Context(), host)
	if err != nil {
		unavailable(w, err)
		return
	}
	res, ok := routing.Resolve(routes, host, q.Get("path"))
	if !ok {
		httpx.Fail(w, 404, "not_found", "No route matches")
		return
	}
	v, missing, err := s.target(r.Context(), res)
	if missing {
		res.Page, res.Missing = res.Route.Page, true
	}
	if err != nil {
		httpx.OK(w, map[string]any{"resolution": res, "n": 0, "bindings": map[string]any{}})
		return
	}
	httpx.OK(w, map[string]any{"resolution": res, "n": v.N, "bindings": s.bindings(r.Context(), v, &res.Route)})
}

func (s *Server) versionRecords(w http.ResponseWriter, r *http.Request) {
	n, ok := versionNumber(r)
	if !ok {
		httpx.Fail(w, 400, "invalid_request", "A version is a number or main")
		return
	}
	rs, _, err := s.records(r.Context(), r.PathValue("id"), n)
	if err != nil {
		storeFail(w, err)
		return
	}
	httpx.OK(w, rs)
}
