package server

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/records"
	"github.com/go-go-golems/slop-computer/pkg/routing"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// SiteSource is the reads value that gives a page its host's site index:
// "reads": {"pages": "$site"}.
const SiteSource = "$site"

// siteMax caps the index; every page that reads it embeds it.
const siteMax = 2000

// siteTTL bounds how stale a cached index can be when a change happens
// outside this process (another replica, SQL by hand).
const siteTTL = 30 * time.Second

func (s *Server) siteRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/site", s.guardPerm(admin, scopeRW, "routes:read", s.getSiteIndex))
}

func (s *Server) getSiteIndex(w http.ResponseWriter, r *http.Request) {
	host := s.siteHost(r.URL.Query().Get("host"))
	if host == "" {
		httpx.Fail(w, 400, "invalid_request", "host must be one of the site hosts")
		return
	}
	httpx.OK(w, s.siteIndex(r.Context(), host))
}

// siteHost is the site host a request or preview names, or the first site
// host when it names none; "" when it names one that is not a site host.
func (s *Server) siteHost(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	for _, x := range s.Config.SiteHosts {
		if h == "" || strings.ToLower(x) == h {
			return strings.ToLower(x)
		}
	}
	return ""
}

// siteCache keeps one index per host. publish bumps gen after any change
// that can alter an index, which makes every cached index stale.
type siteCache struct {
	mu      sync.Mutex
	gen     uint64
	entries map[string]siteCached
}

type siteCached struct {
	gen  uint64
	at   time.Time
	rows []records.Record
}

var siteEvents = map[string]bool{
	store.EvRouteSet: true, store.EvRouteRemoved: true, store.EvRefMoved: true, store.EvVersionCreated: true,
	store.EvArtifactCreated: true, store.EvArtifactUpdated: true, store.EvProjectUpdated: true,
}

func (c *siteCache) changed(evs []store.Event) {
	for _, ev := range evs {
		if siteEvents[ev.Type] {
			c.mu.Lock()
			c.gen++
			c.mu.Unlock()
			return
		}
	}
}

// siteIndex is the public URLs of host as records (see siteEntries).
func (s *Server) siteIndex(ctx context.Context, host string) []records.Record {
	c := &s.site
	c.mu.Lock()
	gen := c.gen
	if e, ok := c.entries[host]; ok && e.gen == gen && time.Since(e.at) < siteTTL {
		c.mu.Unlock()
		return e.rows
	}
	c.mu.Unlock()
	rows := s.siteEntries(ctx, host)
	c.mu.Lock()
	if c.entries == nil {
		c.entries = map[string]siteCached{}
	}
	c.entries[host] = siteCached{gen: gen, at: time.Now(), rows: rows}
	c.mu.Unlock()
	return rows
}

// siteEntries lists every URL a visitor of host can reach, one record each:
// static routes, each listed record a record route serves, and each page a
// page-from route admits. A URL is kept only when it resolves to the route
// that produced it (another route can shadow it) and its page is listed.
// Private routes, the fallback and :param routes without a record are left
// out.
func (s *Server) siteEntries(ctx context.Context, host string) []records.Record {
	out := []records.Record{}
	routes, err := s.Store.Routes(ctx, host)
	if err != nil {
		return out
	}
	public := routes[:0:0]
	for _, rt := range routes {
		if rt.Access == "public" {
			public = append(public, rt)
		}
	}
	projects := map[string]string{}
	if ps, err := s.Store.Projects(ctx); err == nil {
		for _, p := range ps {
			projects[p.ID] = p.Name
		}
	}
	seen := map[string]bool{}
	add := func(rt store.Route, path, kind string, page store.Artifact, title string, updated time.Time, rec records.Record) {
		if seen[path] || len(out) >= siteMax {
			return
		}
		res, ok := routing.Resolve(public, host, path)
		if !ok || res.Route.Path != rt.Path || (kind == "project-page" && res.Page != page.ID) {
			return
		}
		seen[path] = true
		e := records.Record{"id": path, "path": path, "title": title, "kind": kind, "route": rt.Path, "page": page.ID,
			"section": "", "depth": 0, "updated": updated.UTC().Format(time.RFC3339)}
		if segs := strings.Split(strings.Trim(path, "/"), "/"); segs[0] != "" {
			e["section"], e["depth"] = segs[0], len(segs)
		}
		if page.Project != nil {
			e["project"], e["projectName"] = *page.Project, projects[*page.Project]
		}
		if rec != nil {
			e["record"] = rec
		}
		out = append(out, e)
	}
	for _, rt := range public {
		if rt.Path == "*" {
			continue
		}
		switch {
		case rt.PageFrom != "":
			s.siteProjectPages(ctx, rt, func(path string, a store.Artifact, v store.Version) {
				add(rt, path, "project-page", a, firstNonEmpty(a.Title, a.ID), v.CreatedAt, nil)
			})
		case rt.Record != "":
			page, v, ok := s.sitePage(ctx, rt.Page, rt.Version)
			if !ok {
				continue
			}
			re, names := routing.RecordMatcher(rt.Record)
			for name, b := range s.bindings(ctx, v, &rt) {
				if name == "$tokens" || b.N == 0 || strings.HasPrefix(b.Artifact, "$") {
					continue
				}
				rows, dv, err := s.records(ctx, b.Artifact, b.N)
				if err != nil {
					continue
				}
				for _, r := range rows {
					p, _ := r["path"].(string)
					m := re.FindStringSubmatch(p)
					if m == nil || !listedRecord(r) {
						continue
					}
					params := map[string]string{}
					for i, n := range names {
						params[n] = m[i+1]
					}
					path, ok := routing.FillPath(rt.Path, params)
					if !ok {
						continue
					}
					title, _ := r["title"].(string)
					if title == "" {
						title, _ = r["id"].(string)
					}
					add(rt, path, "record", page, title, dv.CreatedAt, siteRecord(r))
				}
			}
		case strings.ContainsAny(rt.Path, ":*"):
			// a parameter the server cannot enumerate
		default:
			if page, v, ok := s.sitePage(ctx, rt.Page, rt.Version); ok {
				add(rt, rt.Path, "page", page, firstNonEmpty(page.Title, page.ID), v.CreatedAt, nil)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i]["path"].(string) < out[j]["path"].(string) })
	return out
}

// sitePage is a route's page and the version it serves, when it has one and
// is listed.
func (s *Server) sitePage(ctx context.Context, id string, pinned *int) (store.Artifact, store.Version, bool) {
	a, err := s.Store.Artifact(ctx, id)
	if err != nil {
		return a, store.Version{}, false
	}
	n := 0
	if pinned != nil {
		n = *pinned
	}
	v, err := s.Store.Version(ctx, id, n)
	if err != nil || !listedPage(v) {
		return a, v, false
	}
	return a, v, true
}

// siteProjectPages calls fn for each page a page-from route admits, with
// the URL that names it.
func (s *Server) siteProjectPages(ctx context.Context, rt store.Route, fn func(string, store.Artifact, store.Version)) {
	proj := s.projectOf(ctx, rt.Page)
	if proj == "" {
		return
	}
	arts, err := s.Store.Artifacts(ctx, proj)
	if err != nil {
		return
	}
	match, names := routing.TemplateMatcher(rt.PageFrom), store.TemplateParams(rt.PageFrom)
	for _, a := range arts {
		if a.Kind != store.KindPage || a.Main == 0 || a.ID == rt.Page || !s.admits(ctx, rt, a.ID) {
			continue
		}
		m := match.FindStringSubmatch(a.ID)
		if len(m) != len(names)+1 {
			continue
		}
		params := map[string]string{}
		for i, n := range names {
			params[n] = m[i+1]
		}
		path, ok := routing.FillPath(rt.Path, params)
		if !ok {
			continue
		}
		if _, v, ok := s.sitePage(ctx, a.ID, nil); ok {
			fn(path, a, v)
		}
	}
}

// siteRecord is a record without its bulky content, for the index.
func siteRecord(r records.Record) records.Record {
	out := records.Record{}
	for k, v := range r {
		switch k {
		case "body", "html", "text", "csv", "error":
		default:
			out[k] = v
		}
	}
	return out
}

// truthy reads a flag written as a boolean or as text ("true", "True").
func truthy(v any) (bool, bool) {
	switch x := v.(type) {
	case bool:
		return x, true
	case string:
		switch strings.ToLower(strings.TrimSpace(x)) {
		case "true", "yes":
			return true, true
		case "false", "no":
			return false, true
		}
	}
	return false, false
}

// listedRecord leaves out records marked unlisted: draft or hidden, listed
// false, or a visibility other than public.
func listedRecord(r records.Record) bool {
	if b, ok := truthy(r["draft"]); ok && b {
		return false
	}
	if b, ok := truthy(r["hidden"]); ok && b {
		return false
	}
	if b, ok := truthy(r["listed"]); ok && !b {
		return false
	}
	if v, ok := r["visibility"].(string); ok && v != "" && !strings.EqualFold(v, "public") {
		return false
	}
	return true
}

// listedPage leaves out pages whose manifest says "listed": false.
func listedPage(v store.Version) bool {
	var m struct {
		Listed *bool `json:"listed"`
	}
	_ = store.ManifestOf(v, &m)
	return m.Listed == nil || *m.Listed
}

func firstNonEmpty(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}
