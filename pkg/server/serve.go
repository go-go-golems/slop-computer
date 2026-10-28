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
func (s *Server) renderPage(ctx context.Context, page store.Version, res *routing.Resolution, host, reqPath, mode, parent string) ([]byte, error) {
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
		Version: render.VersionInfo{Artifact: page.Artifact, N: page.N}, Mode: mode, ParentOrigin: parent}
	if res != nil {
		route = &res.Route
		boot.Route.Params = res.Params
		boot.Record = res.Record
	}
	for name, b := range s.bindings(ctx, page, route) {
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
			if rt.Page == page {
				return true
			}
		}
		return false
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
	versionOf := func(rt store.Route) (store.Version, error) {
		n := 0
		if rt.Version != nil {
			n = *rt.Version
		}
		return s.Store.Version(ctx, rt.Page, n)
	}
	res, ok := routing.Resolve(public, host, r.URL.Path)
	// A path with an extension may be a file of the page it resolves to, or of
	// the page the browser was on (relative links from /pricing to style.css
	// arrive as /style.css).
	if path.Ext(r.URL.Path) != "" {
		if ok && !res.Fallback {
			if v, err := versionOf(res.Route); err == nil {
				if f, found := fileFor(v, r.URL.Path); found {
					s.serveBlob(w, r, f)
					return
				}
			}
		}
		if ref, err := url.Parse(r.Referer()); err == nil && strings.EqualFold(ref.Host, r.Host) {
			if rr, rok := routing.Resolve(public, host, ref.Path); rok {
				if v, err := versionOf(rr.Route); err == nil {
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
	v, err := versionOf(res.Route)
	if err != nil {
		notFoundPage(w)
		return
	}
	body, err := s.renderPage(ctx, v, &res, host, r.URL.Path, render.ModeSite, "")
	if err != nil {
		unavailable(w, err)
		return
	}
	status := http.StatusOK
	if res.Fallback {
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

// serveSandbox serves one version as a Workshop preview. ?host= gives the
// route context (bindings, params, record) of that host's route for the path.
func (s *Server) serveSandbox(w http.ResponseWriter, r *http.Request, label string) {
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
	artifact, n, err := s.Store.SandboxTarget(ctx, label)
	if err != nil {
		notFoundPage(w)
		return
	}
	v, err := s.Store.Version(ctx, artifact, n)
	if err != nil {
		notFoundPage(w)
		return
	}
	if r.URL.Path != "/" && path.Ext(r.URL.Path) != "" && path.Ext(r.URL.Path) != ".html" {
		if f, ok := fileFor(v, r.URL.Path); ok {
			s.serveBlob(w, r, f)
			return
		}
		notFoundPage(w)
		return
	}
	q := r.URL.Query()
	mode := render.ModePreview
	if q.Get("mode") == render.ModeThumb {
		mode = render.ModeThumb
	}
	parent := q.Get("parent")
	if !slicesContains(s.origins(), parent) {
		parent = s.origins()[0]
	}
	var res *routing.Resolution
	if host := q.Get("host"); host != "" {
		routes, err := s.Store.Routes(ctx, host)
		if err == nil {
			if rr, ok := routing.Resolve(routes, host, r.URL.Path); ok {
				res = &rr
			}
		}
	}
	body, err := s.renderPage(ctx, v, res, q.Get("host"), r.URL.Path, mode, parent)
	if err != nil {
		httpx.Fail(w, 404, "not_found", err.Error())
		return
	}
	s.writePage(w, http.StatusOK, body)
}

func slicesContains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}
