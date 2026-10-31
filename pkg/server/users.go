package server

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

func (s *Server) userRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/users", s.guard(admin, scopeRW, s.users))
	m.HandleFunc("PATCH /api/users/{id}", s.guard(admin, scopeAdmin, s.patchUser))
	m.HandleFunc("POST /api/users/{id}/revoke-sessions", s.guard(admin, scopeAdmin, s.revokeUserSessions))
	m.HandleFunc("GET /api/audit", s.guard(admin, scopeAdmin, s.auditLog))
}

// users lists everyone; rw tokens may read it so agents can name people.
func (s *Server) users(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.Users(r.Context())
	if err != nil {
		unavailable(w, err)
		return
	}
	httpx.OK(w, list)
}

// patchUser changes a role. An admin cannot demote or disable themselves.
func (s *Server) patchUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Role string `json:"role"`
	}
	if err := httpx.Read(w, r, &in, 1024); err != nil || !store.ValidRole(in.Role) {
		httpx.Fail(w, 400, "invalid_request", "role must be admin, member, pending or disabled")
		return
	}
	if id == actor(r) && in.Role != store.RoleAdmin {
		httpx.Fail(w, 409, "self_lockout", "You cannot demote or disable your own account")
		return
	}
	before, err := s.Store.User(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		httpx.Fail(w, 404, "not_found", "User not found")
		return
	} else if err != nil {
		unavailable(w, err)
		return
	}
	u, err := s.Store.SetUserRole(r.Context(), id, in.Role)
	if err != nil {
		unavailable(w, err)
		return
	}
	_ = s.Store.Audit(r.Context(), actor(r), "user.role", id, map[string]any{"name": u.DisplayName, "from": before.Role, "to": u.Role})
	if u.Role != before.Role {
		// Views act as their user: a changed role ends them.
		for _, v := range s.views.Where(func(v *rt.View) bool { return v.User == u.ID }) {
			s.views.Close(v, true)
		}
	}
	s.event(r, store.EvUserRole, map[string]any{"user": u, "from": before.Role})
	httpx.OK(w, u)
}

// revokeUserSessions ends a user's sessions and, with {"tokens": true}, their tokens.
func (s *Server) revokeUserSessions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Tokens bool `json:"tokens"`
	}
	if r.ContentLength > 0 {
		if err := httpx.Read(w, r, &in, 1024); err != nil {
			httpx.Fail(w, 400, "invalid_request", "Invalid JSON body")
			return
		}
	}
	sessions, err := s.Store.RevokeUserSessions(r.Context(), id)
	if err != nil {
		unavailable(w, err)
		return
	}
	var tokens int64
	if in.Tokens {
		if tokens, err = s.Store.RevokeUserTokens(r.Context(), id); err != nil {
			unavailable(w, err)
			return
		}
	}
	_ = s.Store.Audit(r.Context(), actor(r), "user.revoke_sessions", id, map[string]any{"sessions": sessions, "tokens": tokens})
	httpx.OK(w, map[string]int64{"sessions": sessions, "tokens": tokens})
}

func (s *Server) auditLog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	before, _ := strconv.ParseInt(q.Get("before"), 10, 64)
	list, err := s.Store.AuditQuery(r.Context(), store.AuditFilter{Subject: q.Get("subject"), Actor: q.Get("actor"), Action: q.Get("action"), Before: before, Limit: limit})
	if err != nil {
		unavailable(w, err)
		return
	}
	httpx.OK(w, list)
}

// event records and publishes an event outside a kernel transaction.
func (s *Server) event(r *http.Request, typ string, payload any) {
	ev, err := s.Store.AppendEvent(r.Context(), typ, "", "", actor(r), payload)
	if err != nil {
		unavailableLog(err)
		return
	}
	s.publish([]store.Event{ev})
}
