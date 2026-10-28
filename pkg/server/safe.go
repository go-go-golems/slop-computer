package server

import (
	"net/http"
	"net/url"
	"sort"
	"strconv"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Safe mode (/_/) is the fuse box: a server-rendered page, no JavaScript,
// that works when the Workshop does not. It points routes at other versions,
// undoes route changes and revokes tokens, through the same store functions
// and events as the API.

func (s *Server) safeRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /_/{$}", s.guard(public, noToken, s.safePage))
	m.HandleFunc("POST /_/route", s.guard(admin, noToken, s.safePoint))
	m.HandleFunc("POST /_/undo", s.guard(admin, noToken, s.safeUndo))
	m.HandleFunc("POST /_/revoke", s.guard(admin, noToken, s.safeRevoke))
}

type safeRoute struct {
	store.Route
	Main     int
	Versions []int
}

type safeHost struct {
	Host   string
	Routes []safeRoute
}

func (s *Server) safePage(w http.ResponseWriter, r *http.Request) {
	p := principal(r.Context())
	if p == nil {
		http.Redirect(w, r, "/auth/login?return="+url.QueryEscape("/_/"), http.StatusSeeOther)
		return
	}
	if p.User.Role != store.RoleAdmin {
		s.render(w, http.StatusForbidden, "home", map[string]any{"Me": p.User, "CSRF": p.Session.CSRF})
		return
	}
	ctx := r.Context()
	routes, err := s.Store.Routes(ctx, "")
	if err != nil {
		unavailable(w, err)
		return
	}
	hosts := map[string]*safeHost{}
	order := append([]string{}, s.Config.SiteHosts...)
	for _, h := range s.Config.SiteHosts {
		hosts[h] = &safeHost{Host: h}
	}
	versions := map[string][]int{}
	for _, rt := range routes {
		if hosts[rt.Host] == nil {
			hosts[rt.Host] = &safeHost{Host: rt.Host}
			order = append(order, rt.Host)
		}
		if _, ok := versions[rt.Page]; !ok {
			if vs, err := s.Store.Versions(ctx, rt.Page); err == nil {
				for i := len(vs) - 1; i >= 0; i-- {
					versions[rt.Page] = append(versions[rt.Page], vs[i].N)
				}
			}
		}
		sr := safeRoute{Route: rt, Versions: versions[rt.Page]}
		if a, err := s.Store.Artifact(ctx, rt.Page); err == nil {
			sr.Main = a.Main
		}
		hosts[rt.Host].Routes = append(hosts[rt.Host].Routes, sr)
	}
	out := make([]*safeHost, 0, len(order))
	for _, h := range order {
		sort.Slice(hosts[h].Routes, func(i, j int) bool { return hosts[h].Routes[i].Path < hosts[h].Routes[j].Path })
		out = append(out, hosts[h])
	}
	tokens, err := s.Store.Tokens(ctx, "")
	if err != nil {
		unavailable(w, err)
		return
	}
	s.render(w, http.StatusOK, "safe", map[string]any{"Me": p.User, "CSRF": p.Session.CSRF, "Hosts": out, "Tokens": tokens,
		"Done": r.URL.Query().Get("done"), "Error": r.URL.Query().Get("error")})
}

// safeBack returns to the safe page with a message.
func safeBack(w http.ResponseWriter, r *http.Request, key, msg string) {
	http.Redirect(w, r, "/_/?"+url.Values{key: {msg}}.Encode(), http.StatusSeeOther)
}

func (s *Server) safePoint(w http.ResponseWriter, r *http.Request) {
	host, path, to := r.PostFormValue("host"), r.PostFormValue("path"), r.PostFormValue("version")
	routes, err := s.Store.Routes(r.Context(), host)
	if err != nil {
		unavailable(w, err)
		return
	}
	var rt *store.Route
	for i := range routes {
		if routes[i].Path == path {
			rt = &routes[i]
		}
	}
	if rt == nil {
		safeBack(w, r, "error", "No route "+host+path)
		return
	}
	note := "follows main (safe mode)"
	rt.Version = nil
	if to != "main" {
		n, err := strconv.Atoi(to)
		if err != nil || n <= 0 {
			safeBack(w, r, "error", "Not a version: "+to)
			return
		}
		rt.Version = &n
		note = "pinned v" + to + " (safe mode)"
	}
	_, evs, err := s.Store.SetRoute(r.Context(), *rt, note, actor(r))
	if err != nil {
		safeBack(w, r, "error", err.Error())
		return
	}
	s.publish(evs)
	safeBack(w, r, "done", host+path+": "+note)
}

func (s *Server) safeUndo(w http.ResponseWriter, r *http.Request) {
	host, path := r.PostFormValue("host"), r.PostFormValue("path")
	_, evs, err := s.Store.UndoRoute(r.Context(), host, path, actor(r))
	if err != nil {
		safeBack(w, r, "error", err.Error())
		return
	}
	s.publish(evs)
	safeBack(w, r, "done", host+path+": last change undone")
}

func (s *Server) safeRevoke(w http.ResponseWriter, r *http.Request) {
	t, err := s.Store.RevokeToken(r.Context(), "", r.PostFormValue("id"))
	if err != nil {
		safeBack(w, r, "error", "Token not found")
		return
	}
	_ = s.Store.Audit(r.Context(), actor(r), "token.revoke", t.ID, map[string]any{"name": t.Name, "owner": t.UserID})
	s.event(r, store.EvTokenRevoked, t)
	safeBack(w, r, "done", "Revoked "+t.Name)
}
