package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/records"
	"github.com/go-go-golems/slop-computer/pkg/render"
	"github.com/go-go-golems/slop-computer/pkg/routing"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
)

// Serving versions: site hosts answer through the route table; the sandbox
// domain serves one version per unguessable host label, for Workshop
// previews. Neither carries the main host's session cookie.

// recordCache keeps parsed records of immutable data versions.
type recordCache struct {
	mu sync.Mutex
	m  map[string][]records.Record
}

func (c *recordCache) get(key string) ([]records.Record, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r, ok := c.m[key]
	return r, ok
}

func (c *recordCache) put(key string, r []records.Record) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m == nil || len(c.m) > 256 {
		c.m = map[string][]records.Record{}
	}
	c.m[key] = r
}

// records parses the files of one data version.
func (s *Server) records(ctx context.Context, artifact string, n int) ([]records.Record, store.Version, error) {
	v, err := s.Store.Version(ctx, artifact, n)
	if err != nil {
		return nil, v, err
	}
	key := artifact + "@" + strconv.Itoa(v.N)
	if r, ok := s.recCache.get(key); ok {
		return r, v, nil
	}
	paths := make([]string, 0, len(v.Files))
	for p := range v.Files {
		if p != "slop.json" {
			paths = append(paths, p)
		}
	}
	out, err := records.FromFiles(paths, func(p string) ([]byte, error) { return s.Blobs.Read(v.Files[p].SHA256) })
	if err != nil {
		return nil, v, err
	}
	// File records point at their bytes; the URL names the version, so it
	// can be cached for good.
	for _, rec := range out {
		if rec["file"] == true {
			p, _ := rec["path"].(string)
			rec["src"] = "/_d/" + artifact + "/" + strconv.Itoa(v.N) + "/" + p
			rec["type"], rec["size"] = v.Files[p].Type, v.Files[p].Size
		}
	}
	s.recCache.put(key, out)
	return out, v, nil
}

// pageManifest is the part of a page's manifest the server reads.
type pageManifest struct {
	Reads  map[string]string `json:"reads"`
	Tokens string            `json:"tokens"`
}

// ResolvedBinding is a binding with the concrete version it means now.
type ResolvedBinding struct {
	Artifact string `json:"artifact"`
	Version  *int   `json:"version"`
	N        int    `json:"n"`
}

// bindings: the page's reads at main, $tokens from its manifest, overridden
// by the route's bindings; each resolved to a version number (0 when the
// data artifact has no version).
func (s *Server) bindings(ctx context.Context, page store.Version, route *store.Route) map[string]ResolvedBinding {
	var m pageManifest
	_ = store.ManifestOf(page, &m)
	out := map[string]ResolvedBinding{}
	for name, a := range m.Reads {
		out[name] = ResolvedBinding{Artifact: a}
	}
	if m.Tokens != "" {
		out["$tokens"] = ResolvedBinding{Artifact: m.Tokens}
	}
	if route != nil {
		for name, b := range route.Bindings {
			out[name] = ResolvedBinding{Artifact: b.Artifact, Version: b.Version}
		}
	}
	for name, b := range out {
		if b.Version != nil {
			b.N = *b.Version
		} else if a, err := s.Store.Artifact(ctx, b.Artifact); err == nil {
			b.N = a.Main
		}
		out[name] = b
	}
	return out
}

// renderPage injects boot data into a page version's index.html.
func (s *Server) renderPage(ctx context.Context, page store.Version, res *routing.Resolution, host, reqPath, mode, parent string, runtime *render.Runtime) ([]byte, error) {
	idx, ok := page.Files["index.html"]
	if !ok {
		return nil, errors.New("this version has no index.html")
	}
	src, err := s.Blobs.Read(idx.SHA256)
	if err != nil {
		return nil, err
	}
	var route *store.Route
	boot := render.Boot{Route: render.RouteInfo{Host: host, Path: reqPath, Params: map[string]string{}}, Data: map[string][]records.Record{},
		Version: render.VersionInfo{Artifact: page.Artifact, N: page.N}, Mode: mode, ParentOrigin: parent, Runtime: runtime}
	if res != nil {
		route = &res.Route
		boot.Route.Params = res.Params
		boot.Record = res.Record
	}
	for name, b := range s.bindings(ctx, page, route) {
		if b.Artifact == SiteSource {
			if h := s.siteHost(host); h != "" {
				boot.Data[name] = s.siteIndex(ctx, h)
			}
			continue
		}
		if b.N == 0 {
			continue
		}
		if name == "$tokens" {
			v, err := s.Store.Version(ctx, b.Artifact, b.N)
			if err != nil {
				continue
			}
			if f, ok := v.Files["tokens.json"]; ok {
				if raw, err := s.Blobs.Read(f.SHA256); err == nil {
					var t records.Tokens
					if json.Unmarshal(raw, &t) == nil {
						boot.Tokens = &t
					}
				}
			}
			continue
		}
		rs, _, err := s.records(ctx, b.Artifact, b.N)
		if err != nil {
			continue
		}
		boot.Data[name] = rs
	}
	return render.Inject(src, boot), nil
}

// fileFor finds the file a request path names in a version's tree: the path
// itself, then its last segment.
func fileFor(v store.Version, reqPath string) (store.FileEntry, bool) {
	rel := strings.TrimPrefix(reqPath, "/")
	if f, ok := v.Files[rel]; ok && rel != "" {
		return f, true
	}
	f, ok := v.Files[path.Base(reqPath)]
	return f, ok && path.Base(reqPath) != "/"
}

func (s *Server) serveSlopAsset(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/_slop/")
	b, err := fs.ReadFile(render.Assets, "assets/"+name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(b)
}

// frameAncestors lets the Workshop (on any main-host origin) frame a page.
func (s *Server) frameAncestors(w http.ResponseWriter) {
	w.Header().Set("Content-Security-Policy", "frame-ancestors 'self' "+strings.Join(s.origins(), " "))
}

func (s *Server) writePage(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func notFoundPage(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte("<!doctype html><title>Not found</title><p style=\"font:14px Arial;padding:24px\">Nothing is routed here.</p>"))
}

var versionPath = regexp.MustCompile(`^/_v/([a-z0-9][a-z0-9-]{0,62})/([0-9]+)/(.+)$`)

// dataPath is /_d/<artifact>/<n or main>/<file>: a file of a data artifact
// that a page reads (records give image files a src there).
var dataPath = regexp.MustCompile(`^/_d/([a-z0-9][a-z0-9-]{0,62})/(main|[0-9]+)/(.+)$`)

// serveData serves a file of a data version. Numbered versions never change;
// main may move, so it is revalidated (by ETag) on every use.
func (s *Server) serveData(w http.ResponseWriter, r *http.Request, m []string) {
	n := 0
	if m[2] != "main" {
		n, _ = strconv.Atoi(m[2])
	}
	v, err := s.Store.Version(r.Context(), m[1], n)
	f, ok := v.Files[m[3]]
	if err != nil || !ok || m[3] == "slop.json" {
		notFoundPage(w)
		return
	}
	if n == 0 {
		w.Header().Set("Cache-Control", "no-cache")
		file, err := s.Blobs.Open(f.SHA256)
		if err != nil {
			unavailable(w, err)
			return
		}
		defer func() { _ = file.Close() }()
		w.Header().Set("Content-Type", f.Type)
		w.Header().Set("ETag", `"`+f.SHA256+`"`)
		http.ServeContent(w, r, "", zeroTime, file)
		return
	}
	s.serveBlob(w, r, f)
}

// reads lists the data artifacts a page version reads under a route.
func (s *Server) reads(ctx context.Context, v store.Version, route *store.Route) map[string]bool {
	out := map[string]bool{}
	for _, b := range s.bindings(ctx, v, route) {
		out[b.Artifact] = true
	}
	return out
}

// projectOf is the project of an artifact, "" when it has none.
func (s *Server) projectOf(ctx context.Context, id string) string {
	a, err := s.Store.Artifact(ctx, id)
	if err != nil || a.Project == nil {
		return ""
	}
	return *a.Project
}

// admits reports whether a page-from route can serve page artifact id: its
// template names it, and it is a page of the route page's project.
func (s *Server) admits(ctx context.Context, rt store.Route, id string) bool {
	if rt.PageFrom == "" || !store.ValidArtifactID(id) || !routing.TemplateMatcher(rt.PageFrom).MatchString(id) {
		return false
	}
	a, err := s.Store.Artifact(ctx, id)
	if err != nil || a.Kind != store.KindPage || a.Project == nil {
		return false
	}
	return *a.Project == s.projectOf(ctx, rt.Page)
}

// target is the version a resolution serves: for a page-from route, the
// main of the page it names when the route admits it; otherwise (missing)
// the route's own page.
func (s *Server) target(ctx context.Context, res routing.Resolution) (store.Version, bool, error) {
	rt := res.Route
	if rt.PageFrom != "" && s.admits(ctx, rt, res.Page) {
		if v, err := s.Store.Version(ctx, res.Page, 0); err == nil {
			return v, false, nil
		}
	}
	n := 0
	if rt.Version != nil {
		n = *rt.Version
	}
	v, err := s.Store.Version(ctx, rt.Page, n)
	return v, rt.PageFrom != "", err
}

// pageFromReads reports whether a page a page-from route admits reads data
// artifact d at its main version.
func (s *Server) pageFromReads(ctx context.Context, rt store.Route, d string) bool {
	proj := s.projectOf(ctx, rt.Page)
	if proj == "" {
		return false
	}
	arts, err := s.Store.Artifacts(ctx, proj)
	if err != nil {
		return false
	}
	match := routing.TemplateMatcher(rt.PageFrom)
	for _, a := range arts {
		if a.Kind != store.KindPage || a.Main == 0 || !match.MatchString(a.ID) {
			continue
		}
		if v, err := s.Store.Version(ctx, a.ID, a.Main); err == nil && s.reads(ctx, v, &rt)[d] {
			return true
		}
	}
	return false
}

// serveSite answers a site host through its route table.
func (s *Server) serveSite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/_slop/") {
		s.serveSlopAsset(w, r)
		return
	}
	s.frameAncestors(w)
	ctx := r.Context()
	host := strings.ToLower(r.Host)
	routes, err := s.Store.Routes(ctx, host)
	if err != nil {
		unavailable(w, err)
		return
	}
	public := routes[:0:0]
	for _, rt := range routes {
		if rt.Access == "public" {
			public = append(public, rt)
		}
	}
	routedPage := func(page string) bool {
		for _, rt := range public {
			if rt.Page == page || s.admits(ctx, rt, page) {
				return true
			}
		}
		return false
	}
	// /_d/<artifact>/<n>/<file>: a file of data some routed page reads.
	if m := dataPath.FindStringSubmatch(r.URL.Path); m != nil {
		for _, rt := range public {
			n := 0
			if rt.Version != nil {
				n = *rt.Version
			}
			if v, err := s.Store.Version(ctx, rt.Page, n); err == nil && s.reads(ctx, v, &rt)[m[1]] {
				s.serveData(w, r, m)
				return
			}
		}
		// Then the pages page-from routes admit, which costs a lookup per page.
		for _, rt := range public {
			if rt.PageFrom != "" && s.pageFromReads(ctx, rt, m[1]) {
				s.serveData(w, r, m)
				return
			}
		}
		notFoundPage(w)
		return
	}
	// /_v/<artifact>/<n>/<file>: an explicit file of a routed page's version.
	if m := versionPath.FindStringSubmatch(r.URL.Path); m != nil {
		n, _ := strconv.Atoi(m[2])
		if !routedPage(m[1]) {
			notFoundPage(w)
			return
		}
		v, err := s.Store.Version(ctx, m[1], n)
		if f, ok := v.Files[m[3]]; err == nil && ok {
			s.serveBlob(w, r, f)
			return
		}
		notFoundPage(w)
		return
	}
	res, ok := routing.Resolve(public, host, r.URL.Path)
	// A path with an extension may be a file of the page it resolves to, or of
	// the page the browser was on (relative links from /pricing to style.css
	// arrive as /style.css; from /r/weft as /r/style.css).
	if path.Ext(r.URL.Path) != "" {
		if ok && !res.Fallback {
			if v, missing, err := s.target(ctx, res); err == nil && !missing {
				if f, found := fileFor(v, r.URL.Path); found {
					s.serveBlob(w, r, f)
					return
				}
			}
		}
		if ref, err := url.Parse(r.Referer()); err == nil && strings.EqualFold(ref.Host, r.Host) {
			if rr, rok := routing.Resolve(public, host, ref.Path); rok {
				if v, _, err := s.target(ctx, rr); err == nil {
					if f, found := fileFor(v, r.URL.Path); found {
						s.serveBlob(w, r, f)
						return
					}
				}
			}
		}
	}
	if !ok {
		notFoundPage(w)
		return
	}
	v, missing, err := s.target(ctx, res)
	if err != nil {
		notFoundPage(w)
		return
	}
	if missing {
		res.Page, res.Missing = res.Route.Page, true
	}
	body, err := s.renderPage(ctx, v, &res, host, r.URL.Path, render.ModeSite, "", nil)
	if err != nil {
		unavailable(w, err)
		return
	}
	status := http.StatusOK
	if res.Fallback || res.Missing {
		status = http.StatusNotFound
	}
	s.writePage(w, status, body)
}

// sandboxLabel extracts the label from s<label>.<sandbox domain>.
func (s *Server) sandboxLabel(host string) (string, bool) {
	d := strings.ToLower(s.Config.SandboxDomain)
	if d == "" || !strings.HasSuffix(host, "."+d) {
		return "", false
	}
	label := strings.TrimSuffix(host, "."+d)
	if !sandboxLabelPattern.MatchString(label) {
		return "", false
	}
	return label, true
}

var sandboxLabelPattern = regexp.MustCompile(`^s[0-9a-f]{20}$`)

// appPath is /v/<n>/<file>: a version of the target's app.
var appPath = regexp.MustCompile(`^/v/([0-9]+)/(.*)$`)

// serveSandbox serves a target's origin: its app's versions under /v/<n>/
// (the boot injected into index.html), the runtime's calls under /_rt/, the
// target's assets under /_blob/, and data files previews read. A page
// artifact is its own target, so Workshop previews use the same scheme.
func (s *Server) serveSandbox(w http.ResponseWriter, r *http.Request, label string) {
	ctx := r.Context()
	target, err := s.Store.RTOriginTarget(ctx, label)
	if err != nil {
		notFoundPage(w)
		return
	}
	r = r.WithContext(context.WithValue(ctx, originTarget{}, target))
	p := r.URL.Path
	get := r.Method == http.MethodGet || r.Method == http.MethodHead
	switch {
	case p == "/_rt/events" && get:
		s.viewEvents(w, r)
		return
	case p == "/_rt/rpc" && r.Method == http.MethodPost:
		s.viewRPC(w, r)
		return
	case p == "/_rt/assets" && r.Method == http.MethodPost:
		s.uploadAsset(w, r)
		return
	case p == "/_rt/sample" && r.Method == http.MethodPost:
		s.startSample(w, r)
		return
	case strings.HasPrefix(p, "/_rt/sample/") && r.Method == http.MethodPost:
		// /_rt/sample/{call}/cancel or /_rt/sample/{call}/tools/{use}
		parts := strings.Split(strings.TrimPrefix(p, "/_rt/sample/"), "/")
		switch {
		case len(parts) == 2 && parts[1] == "cancel":
			s.cancelSample(w, r, parts[0])
		case len(parts) == 3 && parts[1] == "tools":
			s.sampleTool(w, r, parts[0], parts[2])
		default:
			notFoundPage(w)
		}
		return
	case strings.HasPrefix(p, "/_rt/api/"):
		s.slopProxy(w, r, strings.TrimPrefix(p, "/_rt"))
		return
	case !get:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	case strings.HasPrefix(p, "/_slop/"):
		s.serveSlopAsset(w, r)
		return
	case strings.HasPrefix(p, "/_blob/"):
		s.serveAsset(w, r, target, strings.TrimPrefix(p, "/_blob/"))
		return
	}
	s.frameAncestors(w)
	t, err := s.Store.Artifact(ctx, target)
	if err != nil {
		notFoundPage(w)
		return
	}
	app := t.ID
	if t.App != "" {
		app = t.App
	}
	m := appPath.FindStringSubmatch(p)
	if m == nil {
		if dm := dataPath.FindStringSubmatch(p); dm != nil {
			s.serveSandboxData(w, r, app, dm)
			return
		}
		notFoundPage(w)
		return
	}
	n, _ := strconv.Atoi(m[1])
	v, err := s.Store.Version(ctx, app, n)
	if err != nil {
		notFoundPage(w)
		return
	}
	if rest := m[2]; rest != "" && rest != "index.html" {
		if f, ok := fileFor(v, "/"+rest); ok {
			s.serveBlob(w, r, f)
			return
		}
		notFoundPage(w)
		return
	}
	q := r.URL.Query()
	caps, _, _ := s.appCaps(ctx, app, n)
	mode := render.ModePreview
	if caps.IsApp() {
		mode = render.ModeApp
	}
	if qm := q.Get("mode"); qm == render.ModePreview || qm == render.ModeThumb || qm == render.ModeApp {
		mode = qm
	}
	parent := q.Get("parent")
	if !slicesContains(s.origins(), parent) {
		parent = s.origins()[0]
	}
	var res *routing.Resolution
	routePath := q.Get("path")
	if !strings.HasPrefix(routePath, "/") {
		routePath = "/"
	}
	if host := q.Get("host"); host != "" {
		if routes, err := s.Store.Routes(ctx, host); err == nil {
			if rr, ok := routing.Resolve(routes, host, routePath); ok {
				res = &rr
			}
		}
	}
	body, err := s.renderPage(ctx, v, res, q.Get("host"), routePath, mode, parent, s.runtimeBoot(target, v, caps))
	if err != nil {
		httpx.Fail(w, 404, "not_found", err.Error())
		return
	}
	s.writePage(w, http.StatusOK, body)
}

// runtimeBoot is what claude.js reads before a view arrives: the names of
// the capabilities the app declares.
func (s *Server) runtimeBoot(target string, v store.Version, caps rt.Caps) *render.Runtime {
	names := map[string]any{}
	for name := range caps.Declared {
		names[name] = map[string]any{}
	}
	return &render.Runtime{Target: target, App: v.Artifact, Version: v.N, Caps: names}
}

// serveSandboxData serves data files the app reads, by its manifest or a
// route to it on any site host.
func (s *Server) serveSandboxData(w http.ResponseWriter, r *http.Request, app string, m []string) {
	ctx := r.Context()
	v, err := s.Store.Version(ctx, app, 0)
	if err == nil && s.reads(ctx, v, nil)[m[1]] {
		s.serveData(w, r, m)
		return
	}
	for _, host := range s.Config.SiteHosts {
		routes, err := s.Store.Routes(ctx, host)
		if err != nil {
			continue
		}
		for _, rt := range routes {
			if (rt.Page == app || s.admits(ctx, rt, app)) && s.reads(ctx, v, &rt)[m[1]] {
				s.serveData(w, r, m)
				return
			}
		}
	}
	notFoundPage(w)
}

// slopProxy is the slop capability: /_rt/api/… on the target origin runs the
// main host's /api/… with the view's secret, which guardPerm accepts for the
// permissions an admin approved. Same-origin for the page, so no CORS.
func (s *Server) slopProxy(w http.ResponseWriter, r *http.Request, apiPath string) {
	if s.viewOf(r) == nil {
		httpx.Fail(w, 401, "revoked", "The view is closed or expired")
		return
	}
	r2 := r.Clone(r.Context())
	r2.URL.Path, r2.URL.RawPath, r2.RequestURI = apiPath, "", ""
	r2.Host = s.Config.PublicURL.Host
	s.mux.ServeHTTP(w, r2)
}

func slicesContains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}
