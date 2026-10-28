package server

import (
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// maxAdminTokenDays bounds the lifetime of tokens that carry the admin scope.
const maxAdminTokenDays = 90

func (s *Server) tokenRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/me", s.guard(session, anyToken, s.apiMe))
	m.HandleFunc("GET /api/config", s.guard(public, anyToken, s.apiConfig))
	// Tokens are managed from a browser session only: a token cannot mint or
	// revoke tokens.
	m.HandleFunc("GET /api/tokens", s.guard(admin, noToken, s.tokens))
	m.HandleFunc("POST /api/tokens", s.guard(admin, noToken, s.createToken))
	m.HandleFunc("DELETE /api/tokens/{id}", s.guard(admin, noToken, s.revokeToken))
	// The one exception: a token may revoke itself (CLI logout).
	m.HandleFunc("DELETE /api/me/token", s.guard(session, anyToken, s.revokeSelf))
}

// apiMe tells a client who it is acting as and, for a token, what the token
// may reach. Any valid token may call it.
func (s *Server) apiMe(w http.ResponseWriter, r *http.Request) {
	p := principal(r.Context())
	out := map[string]any{"user": meUser(p.User), "token": p.Token}
	if p.Token == nil {
		out["csrfToken"] = p.Session.CSRF
	}
	httpx.OK(w, out)
}

// apiConfig describes the server to the Workshop and the CLI.
func (s *Server) apiConfig(w http.ResponseWriter, r *http.Request) {
	httpx.OK(w, map[string]any{"mode": s.mode(), "publicUrl": origin(s.Config.PublicURL), "siteHosts": s.Config.SiteHosts, "sandboxDomain": s.Config.SandboxDomain})
}

func (s *Server) tokens(w http.ResponseWriter, r *http.Request) {
	owner := actor(r)
	if r.URL.Query().Get("all") == "1" {
		owner = ""
	}
	list, err := s.Store.Tokens(r.Context(), owner)
	if err != nil {
		unavailable(w, err)
		return
	}
	httpx.OK(w, list)
}

// grantError is a token request the caller's role may not have.
type grantError struct {
	status        int
	code, message string
}

func (e *grantError) Error() string { return e.code + ": " + e.message }

func (e *grantError) write(w http.ResponseWriter) { httpx.Fail(w, e.status, e.code, e.message) }

// tokenGrant validates the scopes and lifetime of a token for a user with
// role. Tokens with the admin scope must expire within maxAdminTokenDays.
func tokenGrant(role string, scopes []string, days int) ([]string, *time.Time, *grantError) {
	if days < 0 || days > 366 {
		return nil, nil, &grantError{400, "invalid_request", "A lifetime of 0–366 days (0 = no expiry) is required"}
	}
	allowed := store.ScopesForRole(role)
	if len(allowed) == 0 {
		return nil, nil, &grantError{403, "tokens_unavailable", "This account cannot create API tokens"}
	}
	var out []string
	for _, sc := range scopes {
		if !slices.Contains(allowed, sc) {
			return nil, nil, &grantError{400, "invalid_scopes", "Scopes must be chosen from: " + strings.Join(allowed, ", ")}
		}
		if !slices.Contains(out, sc) {
			out = append(out, sc)
		}
	}
	if len(out) == 0 {
		return nil, nil, &grantError{400, "invalid_scopes", "Choose at least one scope from: " + strings.Join(allowed, ", ")}
	}
	if slices.Contains(out, store.ScopeAdmin) && (days < 1 || days > maxAdminTokenDays) {
		return nil, nil, &grantError{400, "invalid_request", "Tokens with the admin scope must expire within 1–90 days"}
	}
	if days == 0 {
		return out, nil, nil
	}
	t := time.Now().Add(time.Duration(days) * 24 * time.Hour)
	return out, &t, nil
}

func (s *Server) createToken(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name   string   `json:"name"`
		Days   int      `json:"days"`
		Scopes []string `json:"scopes"`
	}
	if err := httpx.Read(w, r, &in, 2048); err != nil || strings.TrimSpace(in.Name) == "" || len(in.Name) > 80 {
		httpx.Fail(w, 400, "invalid_request", "A name (≤80 characters) is required")
		return
	}
	scopes, expires, gerr := tokenGrant(me(r).Role, in.Scopes, in.Days)
	if gerr != nil {
		gerr.write(w)
		return
	}
	secret, t, err := s.Store.CreateToken(r.Context(), actor(r), strings.TrimSpace(in.Name), scopes, expires)
	if err != nil {
		unavailable(w, err)
		return
	}
	_ = s.Store.Audit(r.Context(), actor(r), "token.create", t.ID, map[string]any{"name": t.Name, "scopes": t.Scopes, "expiresAt": t.ExpiresAt})
	s.event(r, store.EvTokenCreated, t)
	httpx.JSON(w, 201, map[string]any{"token": secret, "info": t})
}

// revokeToken revokes one of the caller's tokens, or anyone's: both users
// are admins, and the Admin screen lists every token.
func (s *Server) revokeToken(w http.ResponseWriter, r *http.Request) {
	t, err := s.Store.RevokeToken(r.Context(), "", r.PathValue("id"))
	if err != nil {
		httpx.Fail(w, 404, "not_found", "Token not found")
		return
	}
	_ = s.Store.Audit(r.Context(), actor(r), "token.revoke", t.ID, map[string]any{"name": t.Name, "owner": t.UserID})
	s.event(r, store.EvTokenRevoked, t)
	httpx.OK(w, map[string]bool{"revoked": true})
}

// revokeSelf revokes the token the request was made with.
func (s *Server) revokeSelf(w http.ResponseWriter, r *http.Request) {
	p := principal(r.Context())
	if p.Token == nil {
		httpx.Fail(w, 400, "token_required", "Only an API token can revoke itself")
		return
	}
	if _, err := s.Store.RevokeToken(r.Context(), p.User.ID, p.Token.ID); err != nil {
		unavailable(w, err)
		return
	}
	_ = s.Store.Audit(r.Context(), p.User.ID, "token.revoke_self", p.Token.ID, map[string]any{"name": p.Token.Name})
	httpx.OK(w, map[string]bool{"revoked": true})
}
