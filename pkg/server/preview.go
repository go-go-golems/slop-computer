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

// sandboxURL is the preview URL of a version: /v/<n>/ on its artifact's own
// origin under the sandbox domain. ?host=&path= give a route context; mode
// is preview, thumb or app.
func (s *Server) sandboxURL(w http.ResponseWriter, r *http.Request) {
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
	mode := q.Get("mode")
	if mode == "" {
		mode = "preview"
	}
	extra := url.Values{}
	for _, k := range []string{"host", "path"} {
		if v := q.Get(k); v != "" {
			extra.Set(k, v)
		}
	}
	u, origin, err := s.targetURL(r.Context(), r, artifact, n, mode, extra)
	if err != nil {
		s.rtHTTPFail(w, err)
		return
	}
	httpx.OK(w, map[string]any{"url": u, "origin": origin, "artifact": artifact, "n": n})
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
