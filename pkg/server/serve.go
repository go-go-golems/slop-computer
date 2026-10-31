package server

import (
	"context"
	"encoding/json"
	"github.com/go-go-golems/slop-computer/pkg/blobs"
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
			if w, h, ok := s.imageSize(v.Files[p]); ok {
				rec["width"], rec["height"] = w, h
			}
		}
	}
	s.recCache.put(key, out)
	return out, v, nil
}

// pageManifest is the part of a page's manifest the server reads.
type pageManifest struct {
	Reads  map[string]string `json:"reads"`
	Tokens string            `json:"tokens"`
	// Files names data artifacts whose files the page links to without
	// reading their records (covers, galleries): served, not loaded.
	Files []string `json:"files"`
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
	boot := render.Boot{Route: render.RouteInfo{Host: host, Path: reqPath, Params: map[string]string{}}, Data: map[string]any{},
		Version: render.VersionInfo{Artifact: page.Artifact, N: page.N}, Mode: mode, ParentOrigin: parent, Runtime: runtime}
	if res != nil {
		route = &res.Route
		boot.Route.Params = res.Params
		boot.Record = res.Record
	}
	for name, b := range s.bindings(ctx, page, route) {
		if name == "target" && mode == render.ModeSite {
			// An app on a site route runs read-only against the bound
			// target's saved documents (static mode, players).
			if rb := s.staticRuntime(ctx, page, b); rb != nil {
				boot.Mode, boot.Runtime = render.ModeStatic, rb
			}
			continue
		}
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
		boot.Data[name] = render.NewDataRef(b.Artifact, b.N)
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
	// ?h= names the content (render.AssetURL): cached for good; a bare or
	// stale URL is a place.
	class := placeURL
	if h := r.URL.Query().Get("h"); h != "" && h == render.AssetHash(name) {
		class = contentURL
	}
	w.Header().Set("Cache-Control", s.cacheControl(r, class))
	w.Header().Set("ETag", `"`+render.AssetHash(name)+`"`)
	if etagMatch(r.Header.Get("If-None-Match"), `"`+render.AssetHash(name)+`"`) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	typ := "text/javascript; charset=utf-8"
	if strings.HasSuffix(name, ".css") {
		typ = "text/css; charset=utf-8"
	}
	writeBody(w, r, http.StatusOK, typ, b)
}

// writePage writes a rendered page: a document, revalidated on every use by
// an ETag of its body, so an unchanged page costs a 304.
func (s *Server) writePage(w http.ResponseWriter, r *http.Request, status int, body []byte) {
	tag := `"` + blobs.Sum(body)[:32] + `"`
	h := w.Header()
	h.Set("Cache-Control", "no-cache")
	h.Set("ETag", tag)
	if status == http.StatusOK && etagMatch(r.Header.Get("If-None-Match"), tag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeBody(w, r, status, "text/html; charset=utf-8", body)
}

func notFoundPage(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte("<!doctype html><title>Not found</title><p style=\"font:14px Arial;padding:24px\">Nothing is routed here.</p>"))
}

var versionPath = regexp.MustCompile(`^/_v/([a-z0-9][a-z0-9-]{0,62})/([0-9]+)/(.+)$`)

// recordsPath is /_r/<artifact>/<n>.js: a data version's records as a script.
var recordsPath = regexp.MustCompile(`^/_r/([a-z0-9][a-z0-9-]{0,62})/([0-9]+)\.js$`)

// dataPath is /_d/<artifact>/<n or main>/<file>: a file of a data artifact
// that a page reads (records give image files a src there).
var dataPath = regexp.MustCompile(`^/_d/([a-z0-9][a-z0-9-]{0,62})/(main|[0-9]+)/(.+)$`)

// serveData serves a file of a data version: a numbered version is a content
// URL, main a place URL (it moves with each push).
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
		s.serveFile(w, r, f, placeURL)
		return
	}
	s.serveFile(w, r, f, contentURL)
}

// reads lists the data artifacts a page version reads under a route.
func (s *Server) reads(ctx context.Context, v store.Version, route *store.Route) map[string]bool {
	out := map[string]bool{}
	for _, b := range s.bindings(ctx, v, route) {
		out[b.Artifact] = true
	}
	var m pageManifest
	_ = store.ManifestOf(v, &m)
	for _, a := range m.Files {
		out[a] = true
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
	if strings.HasPrefix(r.URL.Path, "/_site/") {
		s.siteMux.ServeHTTP(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/_slop/") {
		s.serveSlopAsset(w, r)
		return
	}
	ctx := r.Context()
	host := strings.ToLower(r.Host)
	routes, err := s.Store.Routes(ctx, host)
	if err != nil {
		unavailable(w, err)
		return
	}
	s.siteHeaders(w, routes)
	// public: the static routes anyone sees. Live routes run their app on
	// its target's origin, so they make no files or data public here.
	public := routes[:0:0]
	for _, rt := range routes {
		if rt.Access == "public" && !rt.Live {
			public = append(public, rt)
		}
	}
	served := servedRoutes(routes)
	routedPage := func(page string) bool {
		for _, rt := range public {
			if rt.Page == page || s.admits(ctx, rt, page) {
				return true
			}
		}
		return false
	}
	// readByRoute: a data artifact some routed page reads (its files and
	// records are public with the page).
	readByRoute := func(data string) bool {
		for _, rt := range public {
			n := 0
			if rt.Version != nil {
				n = *rt.Version
			}
			if v, err := s.Store.Version(ctx, rt.Page, n); err == nil && s.reads(ctx, v, &rt)[data] {
				return true
			}
		}
		// Then the pages page-from routes admit, which costs a lookup per page.
		for _, rt := range public {
			if rt.PageFrom != "" && s.pageFromReads(ctx, rt, data) {
				return true
			}
		}
		return false
	}
	// /_d/<artifact>/<n>/<file>: a file of data some routed page reads.
	if m := dataPath.FindStringSubmatch(r.URL.Path); m != nil {
		if readByRoute(m[1]) {
			s.serveData(w, r, m)
			return
		}
		notFoundPage(w)
		return
	}
	// /_r/<artifact>/<n>.js: the records of data some routed page reads.
	if m := recordsPath.FindStringSubmatch(r.URL.Path); m != nil {
		if readByRoute(m[1]) {
			s.serveRecords(w, r, m)
			return
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
			s.serveFile(w, r, f, classOfVersion(n))
			return
		}
		notFoundPage(w)
		return
	}
	res, ok := routing.Resolve(served, host, r.URL.Path)
	if ok && res.Route.Live && !res.Fallback {
		s.serveShell(w, r, res)
		return
	}
	// A path with an extension may be a file of the page it resolves to, or of
	// the page the browser was on (relative links from /pricing to style.css
	// arrive as /style.css; from /r/weft as /r/style.css).
	if path.Ext(r.URL.Path) != "" {
		if ok && !res.Fallback && !res.Route.Live {
			if v, missing, err := s.target(ctx, res); err == nil && !missing {
				if f, found := fileFor(v, r.URL.Path); found {
					s.serveFile(w, r, f, placeURL) // the page's path, not its version
					return
				}
			}
		}
		if ref, err := url.Parse(r.Referer()); err == nil && strings.EqualFold(ref.Host, r.Host) {
			if rr, rok := routing.Resolve(public, host, ref.Path); rok {
				if v, _, err := s.target(ctx, rr); err == nil {
					if f, found := fileFor(v, r.URL.Path); found {
						w.Header().Add("Vary", "Referer") // which page's file depends on the page
						s.serveFile(w, r, f, placeURL)
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
	s.writePage(w, r, status, body)
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
	// The Workshop and the shells of live routes on site hosts frame apps.
	w.Header().Set("Content-Security-Policy", "frame-ancestors 'self' "+strings.Join(append(s.origins(), s.siteOrigins()...), " "))
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
		if dm := dataPath.FindStringSubmatch(p); dm != nil && s.sandboxReads(r, app, dm[1]) {
			s.serveData(w, r, dm)
			return
		}
		if rm := recordsPath.FindStringSubmatch(p); rm != nil && s.sandboxReads(r, app, rm[1]) {
			s.serveRecords(w, r, rm)
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
			s.serveFile(w, r, f, classOfVersion(n))
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
	if !slicesContains(append(s.origins(), s.siteOrigins()...), parent) {
		parent = s.origins()[0]
	}
	res, routePath := s.previewRoute(ctx, q)
	body, err := s.renderPage(ctx, v, res, q.Get("host"), routePath, mode, parent, s.runtimeBoot(target, v, caps))
	if err != nil {
		httpx.Fail(w, 404, "not_found", err.Error())
		return
	}
	s.writePage(w, r, http.StatusOK, body)
}

// staticRuntime is the runtime boot of an app page bound to a target on a
// site route: the documents of the target version's db.json, nil when the
// page declares no capabilities.
func (s *Server) staticRuntime(ctx context.Context, page store.Version, b ResolvedBinding) *render.Runtime {
	caps, err := rt.ParseManifest(page.Manifest, rt.SlopPermissions)
	if err != nil || !caps.IsApp() {
		return nil
	}
	rb := s.runtimeBoot(b.Artifact, page, caps)
	rb.Docs = json.RawMessage("{}")
	if b.N > 0 {
		if v, err := s.Store.Version(ctx, b.Artifact, b.N); err == nil {
			if f, ok := v.Files["db.json"]; ok {
				if raw, err := s.Blobs.Read(f.SHA256); err == nil && json.Valid(raw) {
					rb.Docs = raw
				}
			}
		}
	}
	return rb
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

// previewRoute is the route a preview shows its page under: ?host= and
// ?path= of a sandbox URL, resolved as a visitor's request would be (nil
// without a host), and the path, "/" when none is given.
func (s *Server) previewRoute(ctx context.Context, q url.Values) (*routing.Resolution, string) {
	path := q.Get("path")
	if !strings.HasPrefix(path, "/") {
		path = "/"
	}
	host := q.Get("host")
	if host == "" {
		return nil, path
	}
	routes, err := s.Store.Routes(ctx, host)
	if err != nil {
		return nil, path
	}
	if rr, ok := routing.Resolve(routes, host, path); ok {
		return &rr, path
	}
	return nil, path
}

// sandboxReads reports whether a sandbox serves data's files and records:
// the page version the request comes from reads it, or main does, or a site
// route serving the app does. The Referer (/v/<n>/…?host=&path=, sent in
// full within the origin) names the version, so a preview of an older
// version gets what that version reads. It grants nothing new: the label
// serves every version of the app, each rendered with its own data.
func (s *Server) sandboxReads(r *http.Request, app, data string) bool {
	ctx := r.Context()
	if ref, err := url.Parse(r.Referer()); err == nil && strings.EqualFold(ref.Host, r.Host) {
		if m := appPath.FindStringSubmatch(ref.Path); m != nil {
			n, _ := strconv.Atoi(m[1])
			if v, err := s.Store.Version(ctx, app, n); err == nil {
				var route *store.Route
				if res, _ := s.previewRoute(ctx, ref.Query()); res != nil {
					route = &res.Route
				}
				if s.reads(ctx, v, route)[data] {
					return true
				}
			}
		}
	}
	v, err := s.Store.Version(ctx, app, 0)
	if err == nil && s.reads(ctx, v, nil)[data] {
		return true
	}
	for _, host := range s.Config.SiteHosts {
		routes, err := s.Store.Routes(ctx, host)
		if err != nil {
			continue
		}
		for _, rt := range routes {
			if (rt.Page == app || s.admits(ctx, rt, app)) && s.reads(ctx, v, &rt)[data] {
				return true
			}
		}
	}
	return false
}

// serveRecords serves /_r/<artifact>/<n>.js: one data version's records as
// a script that hands them to window.slop. A version never changes, so the
// script is a content URL.
func (s *Server) serveRecords(w http.ResponseWriter, r *http.Request, m []string) {
	n, _ := strconv.Atoi(m[2])
	if n == 0 {
		notFoundPage(w)
		return
	}
	rs, _, err := s.records(r.Context(), m[1], n)
	if err != nil {
		notFoundPage(w)
		return
	}
	ref := render.NewDataRef(m[1], n)
	tag := `"` + string(ref) + `"`
	w.Header().Set("ETag", tag)
	w.Header().Set("Cache-Control", s.cacheControl(r, contentURL))
	if etagMatch(r.Header.Get("If-None-Match"), tag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeBody(w, r, http.StatusOK, "text/javascript; charset=utf-8", render.RecordsScript(ref, rs))
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
