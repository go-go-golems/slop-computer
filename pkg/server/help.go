package server

import (
	"html/template"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/doc"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/records"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Help topics for admins: /help/<slug> renders the topic `slop help <slug>`
// shows, with this server's hosts filled in; /help/<slug>.md is the same as
// Markdown, which agents can fetch with their token.
func (s *Server) helpRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /help/{name}", s.guard(public, scopeRW, s.helpPage))
}

func (s *Server) helpPage(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	slug, raw := strings.CutSuffix(name, ".md")
	title, body, ok := doc.Topic(slug)
	if !ok {
		http.NotFound(w, r)
		return
	}
	p := principal(r.Context())
	switch {
	case p == nil && raw:
		httpx.Fail(w, 401, "login_required", "Sign in first")
		return
	case p == nil:
		http.Redirect(w, r, "/auth/login?return="+url.QueryEscape("/help/"+name), http.StatusSeeOther)
		return
	case p.User.Role != store.RoleAdmin && raw:
		httpx.Fail(w, 403, "admin_required", "An administrator has to let you in first")
		return
	case p.User.Role != store.RoleAdmin:
		s.render(w, http.StatusForbidden, "home", map[string]any{"Me": p.User, "CSRF": p.Session.CSRF})
		return
	}
	body = s.fillHosts(body)
	if raw {
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(body))
		return
	}
	// The topic is our own embedded Markdown, not user input.
	s.render(w, http.StatusOK, "help", map[string]any{"Title": title, "Slug": slug,
		"HTML": template.HTML(records.Markdown(body))}) // #nosec G203 -- embedded topic
}

// fillHosts puts this server's main and first site host into a topic.
func (s *Server) fillHosts(text string) string {
	main := strings.TrimRight(s.Config.PublicURL.String(), "/")
	if len(s.Config.SiteHosts) > 0 {
		text = strings.ReplaceAll(text, "https://"+doc.SiteHost, s.Config.PublicURL.Scheme+"://"+s.Config.SiteHosts[0])
	}
	return strings.ReplaceAll(text, doc.Server, main)
}
