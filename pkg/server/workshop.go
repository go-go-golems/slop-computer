package server

import (
	"io/fs"
	"net/http"
	"net/url"
	"strings"
)

// The Workshop (web/workshop, embedded through pkg/web) is a single-page app:
// its client-side paths all get index.html, its files are under
// /static/workshop/. Only artifacts change through the database; the
// Workshop changes with the binary.

func (s *Server) workshopRoutes(m *http.ServeMux) {
	page := s.guard(public, noToken, s.workshopPage)
	for _, p := range []string{"GET /{$}", "GET /watch", "GET /watch/{rest...}", "GET /routes", "GET /artifacts", "GET /site", "GET /admin"} {
		m.HandleFunc(p, page)
	}
	m.HandleFunc("GET /static/workshop/{path...}", s.workshopFile)
}

// workshopPage serves index.html to anyone signed in; the app itself shows
// pending people that they have to wait. Without a build it falls back to
// the server-rendered placeholder.
func (s *Server) workshopPage(w http.ResponseWriter, r *http.Request) {
	p := principal(r.Context())
	if p == nil {
		http.Redirect(w, r, "/auth/login?return="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
		return
	}
	if s.Config.Workshop == nil {
		s.render(w, http.StatusOK, "home", map[string]any{"Me": p.User, "CSRF": p.Session.CSRF, "NoWorkshop": true})
		return
	}
	b, err := fs.ReadFile(s.Config.Workshop, "index.html")
	if err != nil {
		unavailable(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", s.workshopCSP())
	_, _ = w.Write(b)
}

// workshopFile serves the build's files; hashed assets are immutable.
func (s *Server) workshopFile(w http.ResponseWriter, r *http.Request) {
	if s.Config.Workshop == nil {
		http.NotFound(w, r)
		return
	}
	p := r.PathValue("path")
	if strings.HasPrefix(p, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeFileFS(w, r, s.Config.Workshop, p)
}

// workshopCSP keeps the Workshop to its own scripts and API, and lets it
// frame only preview origins (s<label>.<sandbox domain>). React sets inline
// style attributes, hence 'unsafe-inline' for styles only.
func (s *Server) workshopCSP() string {
	frames := "'none'"
	if s.Config.SandboxDomain != "" {
		frames = s.Config.PublicURL.Scheme + "://*." + s.Config.SandboxDomain
	}
	return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
		"frame-src " + frames + "; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
}
