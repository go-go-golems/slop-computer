package server

import (
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Tools are pushed pages that run inside the Workshop (in an iframe on the
// sandbox domain) and call the API with a short-lived grant carrying only the
// permissions an admin approved. Enabling, disabling and granting need a
// browser session: an API token (or a tool) cannot approve tools.

func (s *Server) toolRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/tools", s.guard(admin, scopeRW, s.listTools))
	m.HandleFunc("PUT /api/tools/{id}", s.guard(admin, noToken, s.enableTool))
	m.HandleFunc("DELETE /api/tools/{id}", s.guard(admin, noToken, s.disableTool))
	m.HandleFunc("POST /api/tools/{id}/grant", s.guard(admin, noToken, s.grantTool))
	m.HandleFunc("GET /tools/{rest...}", s.guard(public, noToken, s.workshopPage))
}

// toolView is a tool for the Workshop: the enabled version (if any) and the
// newest version's manifest, with the permissions it asks for beyond the
// enabled ones.
type toolView struct {
	Artifact string      `json:"artifact"`
	Project  *string     `json:"project"`
	Enabled  *store.Tool `json:"enabled"`
	Latest   toolVersion `json:"latest"`
}

type toolVersion struct {
	N              int      `json:"n"`
	Title          string   `json:"title"`
	Icon           string   `json:"icon,omitempty"`
	Permissions    []string `json:"permissions"`
	NewPermissions []string `json:"newPermissions"`
	Error          string   `json:"error,omitempty"`
}

func (s *Server) listTools(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	enabled, err := s.Store.Tools(ctx)
	if err != nil {
		unavailable(w, err)
		return
	}
	arts, err := s.Store.Artifacts(ctx, "")
	if err != nil {
		unavailable(w, err)
		return
	}
	out := []toolView{}
	for _, a := range arts {
		if a.Kind != store.KindPage || a.Latest == 0 {
			continue
		}
		var en *store.Tool
		for i := range enabled {
			if enabled[i].Artifact == a.ID {
				en = &enabled[i]
			}
		}
		v, err := s.Store.Version(ctx, a.ID, a.Latest)
		if err != nil {
			continue
		}
		m, merr := store.ToolManifestOf(v)
		if m == nil && en == nil {
			continue
		}
		tv := toolView{Artifact: a.ID, Project: a.Project, Enabled: en, Latest: toolVersion{N: v.N, NewPermissions: []string{}}}
		if m != nil {
			tv.Latest.Title, tv.Latest.Icon, tv.Latest.Permissions = m.Title, m.Icon, m.Permissions
			for _, p := range m.Permissions {
				if en == nil || !slices.Contains(en.Permissions, p) {
					tv.Latest.NewPermissions = append(tv.Latest.NewPermissions, p)
				}
			}
		}
		if merr != nil {
			tv.Latest.Error = merr.Error()
		}
		out = append(out, tv)
	}
	httpx.OK(w, map[string]any{"tools": out, "permissions": store.ToolPermissions})
}

func (s *Server) enableTool(w http.ResponseWriter, r *http.Request) {
	var in struct {
		N int `json:"n"`
	}
	if err := httpx.Read(w, r, &in, 4096); err != nil || in.N <= 0 {
		httpx.Fail(w, 400, "invalid_request", "Send {n: version}")
		return
	}
	t, evs, err := s.Store.EnableTool(r.Context(), r.PathValue("id"), in.N, actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.OK(w, t)
}

func (s *Server) disableTool(w http.ResponseWriter, r *http.Request) {
	evs, err := s.Store.DisableTool(r.Context(), r.PathValue("id"), actor(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	httpx.OK(w, map[string]bool{"disabled": true})
}

// grantTool gives the caller a grant for the enabled version, or with try
// for any version that has a tool section (trying needs no approval; the
// grant is only ever the caller's).
func (s *Server) grantTool(w http.ResponseWriter, r *http.Request) {
	var in struct {
		N   int  `json:"n"`
		Try bool `json:"try"`
	}
	if err := httpx.Read(w, r, &in, 4096); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {n, try}")
		return
	}
	ctx, id := r.Context(), r.PathValue("id")
	var perms []string
	if in.Try {
		v, err := s.Store.Version(ctx, id, in.N)
		if err != nil {
			s.fail(w, err)
			return
		}
		m, err := store.ToolManifestOf(v)
		if err != nil {
			s.fail(w, err)
			return
		}
		if m == nil {
			httpx.Fail(w, 400, "not_a_tool", id+" v"+strconv.Itoa(v.N)+" has no tool section")
			return
		}
		in.N, perms = v.N, m.Permissions
	} else {
		t, err := s.Store.Tool(ctx, id)
		if err != nil {
			httpx.Fail(w, 404, "not_enabled", id+" is not an enabled tool")
			return
		}
		if in.N != 0 && in.N != t.Version {
			httpx.Fail(w, 409, "not_enabled_version", "The enabled version is v"+strconv.Itoa(t.Version)+"; try other versions with try")
			return
		}
		in.N, perms = t.Version, t.Permissions
	}
	secret, g, err := s.Store.CreateGrant(ctx, id, in.N, actor(r), perms)
	if err != nil {
		unavailable(w, err)
		return
	}
	// people names the active users, so a tool can show who did what: a
	// grant cannot list users itself.
	people := map[string]map[string]string{}
	if us, err := s.Store.Users(ctx); err == nil {
		for _, u := range us {
			if u.Role == store.RoleAdmin {
				people[u.ID] = map[string]string{"id": u.ID, "name": u.DisplayName}
			}
		}
	}
	httpx.OK(w, map[string]any{"grant": secret, "expiresAt": g.ExpiresAt, "permissions": g.Permissions, "n": in.N, "try": in.Try,
		"user": map[string]string{"id": me(r).ID, "name": me(r).DisplayName}, "people": people})
}

// isSandboxOrigin reports whether an Origin header names a preview origin
// (s<label>.<sandbox domain>) on the public URL's scheme.
func (s *Server) isSandboxOrigin(o string) bool {
	u, err := url.Parse(o)
	if err != nil || u.Scheme != s.Config.PublicURL.Scheme || s.Config.SandboxDomain == "" {
		return false
	}
	return strings.HasSuffix(strings.ToLower(u.Host), "."+strings.ToLower(s.Config.SandboxDomain))
}

// cors answers tools: API calls from sandbox origins, never with cookies
// (no Allow-Credentials), only the Authorization and Content-Type headers.
// It reports whether the request was a preflight that is now answered.
func (s *Server) cors(w http.ResponseWriter, r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" || !strings.HasPrefix(r.URL.Path, "/api/") || !s.isSandboxOrigin(o) {
		return false
	}
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", o)
	h.Add("Vary", "Origin")
	if r.Method != http.MethodOptions {
		return false
	}
	h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE")
	h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	h.Set("Access-Control-Max-Age", "600")
	w.WriteHeader(http.StatusNoContent)
	return true
}
