package server

import (
	"net/http"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Local mode: nickname sign-in for development and collaboration tests. The
// routes below are registered only when Config.Local is set (not merely
// guarded), and Config.Validate refuses non-loopback addresses.

func (s *Server) localRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /auth/local", s.localSignIn)
	m.HandleFunc("POST /api/local/token", s.localToken)
}

func (s *Server) localLoginPage(w http.ResponseWriter, r *http.Request, ret, problem string) {
	users, err := s.Store.UsersByIssuer(r.Context(), identity.LocalIssuer)
	if err != nil {
		unavailable(w, err)
		return
	}
	status := http.StatusOK
	if problem != "" {
		status = http.StatusBadRequest
	}
	s.render(w, status, "local-login", map[string]any{"Users": users, "Return": ret, "Problem": problem, "Role": s.Config.Local.Role})
}

// localSignIn signs a nickname in. It is a plain form post from the login
// page; Origin is checked because no session (and no CSRF token) exists yet.
func (s *Server) localSignIn(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		httpx.Fail(w, 403, "invalid_origin", "Cross-origin request rejected")
		return
	}
	ret := safeReturn(r.PostFormValue("return"))
	id, err := identity.LocalIdentity(r.PostFormValue("nickname"))
	if err != nil {
		s.localLoginPage(w, r, ret, err.Error())
		return
	}
	if err = s.signIn(w, r, id, s.Config.Local.Role, ""); err != nil {
		unavailable(w, err)
		return
	}
	http.Redirect(w, r, ret, http.StatusSeeOther)
}

// localToken mints a token for a nickname without a browser, for agents and
// scripts on this machine: slop auth login --as <nickname>.
func (s *Server) localToken(w http.ResponseWriter, r *http.Request) {
	if !identity.IsLoopbackHost(s.clientAddress(r)) {
		httpx.Fail(w, 403, "loopback_only", "Local tokens are only issued to this machine")
		return
	}
	var in struct {
		Nickname string   `json:"nickname"`
		Scopes   []string `json:"scopes"`
		Days     int      `json:"days"`
		Name     string   `json:"name"`
	}
	if err := httpx.Read(w, r, &in, 2048); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Invalid JSON body")
		return
	}
	id, err := identity.LocalIdentity(in.Nickname)
	if err != nil {
		httpx.Fail(w, 400, "invalid_nickname", err.Error())
		return
	}
	u, err := s.Store.UpsertIdentity(r.Context(), id, s.Config.Local.Role)
	if err != nil {
		unavailable(w, err)
		return
	}
	if len(in.Scopes) == 0 {
		in.Scopes = []string{store.ScopeRead, store.ScopeWrite}
	}
	if in.Days == 0 {
		in.Days = 30
	}
	scopes, expires, gerr := tokenGrant(u.Role, in.Scopes, in.Days)
	if gerr != nil {
		gerr.write(w)
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = "local token for " + u.DisplayName
	}
	secret, t, err := s.Store.CreateToken(r.Context(), u.ID, name, scopes, expires)
	if err != nil {
		unavailable(w, err)
		return
	}
	_ = s.Store.Audit(store.WithAuditVia(r.Context(), "local"), u.ID, "token.create", t.ID, map[string]any{"name": t.Name, "scopes": t.Scopes, "via": "local"})
	httpx.JSON(w, 201, map[string]any{"token": secret, "info": t, "user": meUser(u)})
}

// localMode is what /api/config reports.
func (s *Server) mode() string {
	if s.Config.Local != nil {
		return "local"
	}
	return "oidc"
}
