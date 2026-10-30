package server

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
)

// Access (SLOP-011): a person's level on a target is the highest their
// role, authorship and grants give them, capped by their role, so a
// mistaken grant cannot make a member more than an admin of one target.
// Grants are explicit rows, listed and changed through the access API.

// subjectsOf are the grant subjects a person answers to: none for pending
// and disabled people.
func subjectsOf(u store.User) []string {
	switch u.Role {
	case store.RoleAdmin, store.RoleMember:
		return []string{u.ID, store.SubjectSignedIn, store.SubjectAnyone}
	}
	return nil
}

// levelCap is the most a role can hold on a target.
func levelCap(role string) rt.Level {
	switch role {
	case store.RoleAdmin:
		return rt.LevelOwner
	case store.RoleMember:
		return rt.LevelAdmin
	}
	return rt.LevelNone
}

// levelOf is a person's level on a target: admins administer every target,
// the creator owns it, and grants give the rest.
func (s *Server) levelOf(ctx context.Context, u store.User, t store.Artifact) rt.Level {
	subjects := subjectsOf(u)
	if subjects == nil {
		return rt.LevelNone
	}
	if t.CreatedBy != nil && *t.CreatedBy == u.ID {
		return min(rt.LevelOwner, levelCap(u.Role))
	}
	best := rt.LevelNone
	if u.Role == store.RoleAdmin {
		best = rt.LevelAdmin
	}
	grants, err := s.Store.RTGrantsFor(ctx, t.ID, subjects)
	if err != nil {
		unavailableLog(err)
	}
	for _, g := range grants {
		if l, ok := rt.ParseLevel(g.Level); ok && l > best {
			best = l
		}
	}
	return min(best, levelCap(u.Role))
}

// reviewViews closes a target's views whose person's level is no longer
// the view's: the page asks its shell to renew, and the new view carries
// the new level (or none).
func (s *Server) reviewViews(ctx context.Context, target string) {
	t, err := s.Store.Artifact(ctx, target)
	if err != nil {
		return
	}
	for _, v := range s.views.Of(target) {
		u, err := s.Store.User(ctx, v.User)
		if err != nil || s.levelOf(ctx, u, t) != v.Level {
			s.views.Close(v, true)
		}
	}
}

func (s *Server) accessRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/rt/targets/{t}/access", s.guard(admin, scopeRW, s.targetAccess))
	m.HandleFunc("PUT /api/rt/targets/{t}/grants/{subject}", s.guard(admin, scopeRW, s.putGrant))
	m.HandleFunc("DELETE /api/rt/targets/{t}/grants/{subject}", s.guard(admin, scopeRW, s.deleteGrant))
}

type accessGrant struct {
	store.Grant
	Name string `json:"name,omitempty"`
}

type accessView struct {
	View      string    `json:"view"`
	Principal string    `json:"principal"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Level     string    `json:"level"`
	Since     time.Time `json:"since"`
}

type accessRoute struct {
	Host   string `json:"host"`
	Path   string `json:"path"`
	Access string `json:"access"`
}

// targetAccess answers "who has access to this": who may open it (owner,
// grants) and who has it open now (views), and the live routes that run it.
func (s *Server) targetAccess(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	t, err := s.Store.Artifact(ctx, r.PathValue("t"))
	if err != nil {
		s.fail(w, err)
		return
	}
	names := map[string]string{store.SubjectSignedIn: "everyone signed in", store.SubjectAnyone: "anyone, signed in or not"}
	if us, err := s.Store.Users(ctx); err == nil {
		for _, u := range us {
			names[u.ID] = u.DisplayName
		}
	}
	out := map[string]any{"target": t.ID, "app": t.App}
	if t.CreatedBy != nil {
		out["owner"] = map[string]string{"id": *t.CreatedBy, "name": names[*t.CreatedBy]}
	}
	gs, err := s.Store.RTGrants(ctx, t.ID)
	if err != nil {
		unavailable(w, err)
		return
	}
	grants := []accessGrant{}
	for _, g := range gs {
		grants = append(grants, accessGrant{Grant: g, Name: names[g.Subject]})
	}
	views := []accessView{}
	for _, v := range s.views.Of(t.ID) {
		views = append(views, accessView{View: v.ID, Principal: v.User, Name: v.Name, Kind: v.Kind, Level: v.Level.String(), Since: v.Created})
	}
	slices.SortFunc(views, func(a, b accessView) int { return a.Since.Compare(b.Since) })
	routes := []accessRoute{}
	if rs, err := s.Store.Routes(ctx, ""); err == nil {
		app := t.ID
		if t.App != "" {
			app = t.App
		}
		for _, rt := range rs {
			if !rt.Live || rt.Page != app {
				continue
			}
			if b, ok := rt.Bindings["target"]; (ok && b.Artifact == t.ID) || (!ok && t.ID == app) {
				routes = append(routes, accessRoute{Host: rt.Host, Path: rt.Path, Access: rt.Access})
			}
		}
	}
	out["grants"], out["views"], out["routes"] = grants, views, routes
	httpx.OK(w, out)
}

func (s *Server) putGrant(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Level string `json:"level"`
	}
	if err := httpx.Read(w, r, &in, 1024); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {level}")
		return
	}
	t, subject := r.PathValue("t"), r.PathValue("subject")
	if _, err := s.Store.User(r.Context(), subject); store.ValidSubject(subject) && subject[:4] == "usr_" && errors.Is(err, store.ErrNotFound) {
		httpx.Fail(w, 400, "invalid_request", "No such person: "+subject)
		return
	}
	g, evs, err := s.Store.RTSetGrant(r.Context(), t, subject, in.Level, "", actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	s.reviewViews(r.Context(), t)
	httpx.OK(w, g)
}

func (s *Server) deleteGrant(w http.ResponseWriter, r *http.Request) {
	t := r.PathValue("t")
	evs, err := s.Store.RTRemoveGrant(r.Context(), t, r.PathValue("subject"), actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	s.reviewViews(r.Context(), t)
	httpx.OK(w, map[string]bool{"removed": true})
}
