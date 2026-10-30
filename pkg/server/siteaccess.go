package server

import (
	"context"
	"net/http"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Sharing from the site (SLOP-011, decision 5): the owner of a target
// manages who may open it from the shell's Share dialog, without the
// Workshop. Owners give view or interact, to everyone signed in, to anyone
// or by link, and take any grant away; admin and owner grants stay with
// admins in the Workshop.

func (s *Server) siteAccessRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /_site/access", s.shellOnly(s.siteAccess))
	m.HandleFunc("POST /_site/grants", s.shellOnly(s.siteGrant))
	m.HandleFunc("POST /_site/links", s.shellOnly(s.siteLink))
	m.HandleFunc("POST /_site/links/{id}/revoke", s.shellOnly(s.siteUnlink))
}

// mayManage reports whether p manages t's access from the site: its owner,
// or an admin.
func (s *Server) mayManage(ctx context.Context, p *sitePrincipal, t store.Artifact) bool {
	if p == nil || p.visitor() {
		return false
	}
	return p.User.Role == store.RoleAdmin || s.levelOf(ctx, p.User, t) == rt.LevelOwner
}

// managed resolves {path} to the target of its live route, for a principal
// who manages it; it answers the request itself otherwise.
func (s *Server) managed(w http.ResponseWriter, r *http.Request, path string) (store.Artifact, *sitePrincipal, bool) {
	ctx := r.Context()
	res, ok, err := s.liveRoute(ctx, r, path)
	if err != nil {
		unavailable(w, err)
		return store.Artifact{}, nil, false
	}
	if !ok {
		httpx.Fail(w, 404, "not_found", "No live route here")
		return store.Artifact{}, nil, false
	}
	t, err := s.liveTarget(ctx, res)
	if err != nil {
		httpx.Fail(w, 404, "not_found", "There is nothing here")
		return store.Artifact{}, nil, false
	}
	p, err := s.siteResolve(r)
	if err != nil {
		unavailable(w, err)
		return store.Artifact{}, nil, false
	}
	if !s.mayManage(ctx, p, t) {
		httpx.Fail(w, 403, "not_granted", "Only its owner shares this")
		return store.Artifact{}, nil, false
	}
	return t, p, true
}

// siteAccess answers POST /_site/access {path}: the grants and live links
// of the target, with names.
func (s *Server) siteAccess(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	if err := httpx.Read(w, r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {path}")
		return
	}
	t, _, ok := s.managed(w, r, in.Path)
	if !ok {
		return
	}
	ctx := r.Context()
	gs, err := s.Store.RTGrants(ctx, t.ID)
	if err != nil {
		unavailable(w, err)
		return
	}
	ls, err := s.Store.RTLinks(ctx, t.ID)
	if err != nil {
		unavailable(w, err)
		return
	}
	names := map[string]string{}
	if us, err := s.Store.Users(ctx); err == nil {
		for _, u := range us {
			names[u.ID] = u.DisplayName
		}
	}
	grants := []accessGrant{}
	for _, g := range gs {
		name := names[g.Subject]
		if store.IsVisitor(g.Subject) {
			name = "A guest"
		}
		grants = append(grants, accessGrant{Grant: g, Name: name})
	}
	links := []store.Link{}
	now := s.Store.Now()
	for _, l := range ls {
		if l.RevokedAt == nil && (l.ExpiresAt == nil || l.ExpiresAt.After(now)) {
			links = append(links, l)
		}
	}
	httpx.OK(w, map[string]any{"target": t.ID, "title": t.Title, "grants": grants, "links": links})
}

// siteGrant answers POST /_site/grants {path, subject, level}: level view
// or interact for everyone signed in or anyone, or "" to take a subject's
// grant away.
func (s *Server) siteGrant(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path    string `json:"path"`
		Subject string `json:"subject"`
		Level   string `json:"level"`
	}
	if err := httpx.Read(w, r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {path, subject, level}")
		return
	}
	t, p, ok := s.managed(w, r, in.Path)
	if !ok {
		return
	}
	ctx := r.Context()
	var evs []store.Event
	var err error
	switch {
	case in.Level == "":
		evs, err = s.Store.RTRemoveGrant(ctx, t.ID, in.Subject, p.ID())
	case in.Level != "view" && in.Level != "interact":
		httpx.Fail(w, 400, "invalid_request", "From the site, share view or interact; admins give more in the Workshop")
		return
	case in.Subject != store.SubjectSignedIn && in.Subject != store.SubjectAnyone:
		httpx.Fail(w, 400, "invalid_request", "Share with everyone signed in or anyone, or make a link")
		return
	default:
		_, evs, err = s.Store.RTSetGrant(ctx, t.ID, in.Subject, in.Level, "", p.ID())
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	s.reviewViews(ctx, t.ID)
	httpx.OK(w, map[string]bool{"ok": true})
}

// siteLink answers POST /_site/links {path, level, days}: a share link to
// this route's target, as this route's URL.
func (s *Server) siteLink(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path  string `json:"path"`
		Level string `json:"level"`
		Days  int    `json:"days"`
	}
	if err := httpx.Read(w, r, &in, 4<<10); err != nil || in.Days < 0 || in.Days > 365 {
		httpx.Fail(w, 400, "invalid_request", "Send {path, level, days}; days is 0 (no expiry) to 365")
		return
	}
	t, p, ok := s.managed(w, r, in.Path)
	if !ok {
		return
	}
	var expires *time.Time
	if in.Days > 0 {
		e := s.Store.Now().Add(time.Duration(in.Days) * 24 * time.Hour)
		expires = &e
	}
	token, link, evs, err := s.Store.RTCreateLink(r.Context(), t.ID, in.Level, expires, p.ID())
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.JSON(w, http.StatusCreated, map[string]any{"link": link, "url": s.siteOrigin(r.Host) + in.Path + "?k=" + token})
}

// siteUnlink answers POST /_site/links/{id}/revoke {path}.
func (s *Server) siteUnlink(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	if err := httpx.Read(w, r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {path}")
		return
	}
	t, p, ok := s.managed(w, r, in.Path)
	if !ok {
		return
	}
	evs, err := s.Store.RTRevokeLink(r.Context(), t.ID, r.PathValue("id"), p.ID())
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	s.reviewViews(r.Context(), t.ID)
	httpx.OK(w, map[string]bool{"revoked": true})
}
