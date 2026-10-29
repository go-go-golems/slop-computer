package server

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// get fetches path from the test server with a Host header (and Referer).
func (h *harness) get(host, path, referer string) (int, string, http.Header) {
	h.t.Helper()
	req, _ := http.NewRequest("GET", h.ts.URL+path, nil)
	req.Host = host
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b), resp.Header
}

func (h *harness) pushFiles(token, artifact string, create map[string]any, manifest map[string]any, files map[string]string) {
	h.t.Helper()
	tree := map[string]string{}
	for p, c := range files {
		tree[p] = h.upload(token, []byte(c))
	}
	body := map[string]any{"tree": tree, "create": create, "manifest": manifest, "force": true}
	var res map[string]any
	if code := h.bearer(token, "POST", "/api/artifacts/"+artifact+"/versions", body, &res); code != 201 {
		h.t.Fatalf("push %s: %d %v", artifact, code, res)
	}
}

func TestServeSiteAndSandbox(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "journal", map[string]any{"title": "Journal", "kind": "data", "type": "post"}, nil, map[string]string{
		"posts/routes-not-templates.md": "---\ntitle: Routes, not templates\ndate: 2026-10-26\n---\nA **table** of routes.\n",
		"posts/other.md":                "---\ntitle: Other\n---\nBody\n"})
	h.pushFiles(tok, "lab-tokens", map[string]any{"title": "Tokens", "kind": "data", "type": "tokens"}, nil, map[string]string{
		"tokens.json": `{"colors":{"ink":"#1a1a1a"},"radius":"0"}`})
	h.pushFiles(tok, "journal-post", map[string]any{"title": "Post", "kind": "page"}, map[string]any{"reads": map[string]string{"posts": "journal"}, "tokens": "lab-tokens"},
		map[string]string{"index.html": "<!doctype html><html><head><link rel=stylesheet href=style.css></head><body></body></html>", "style.css": "body{margin:0}"})
	h.pushFiles(tok, "secret", map[string]any{"title": "Secret", "kind": "page"}, nil, map[string]string{"index.html": "<p>secret"})

	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/journal/:slug", "page": "journal-post", "record": "posts/{slug}.md"}, nil)
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/secret", "page": "secret", "access": "admins"}, nil)

	code, body, hdr := h.get("site.test", "/journal/routes-not-templates", "")
	if code != 200 || !strings.Contains(body, `"record":"posts/routes-not-templates.md"`) || !strings.Contains(body, `"title":"Routes, not templates"`) ||
		!strings.Contains(body, `\u003cstrong\u003etable\u003c/strong\u003e`) || !strings.Contains(body, `<style data-slop="tokens">html:root{--ink:#1a1a1a;--radius:0}</style></head>`) ||
		strings.Contains(body, "bridge.js") {
		t.Fatalf("site page %d %s", code, body)
	}
	if !strings.Contains(hdr.Get("Content-Security-Policy"), "frame-ancestors") {
		t.Fatalf("csp %v", hdr)
	}
	if code, body, _ = h.get("site.test", "/journal/style.css", ""); code != 200 || body != "body{margin:0}" {
		t.Fatalf("asset under the route %d %q", code, body)
	}
	if code, body, _ = h.get("site.test", "/style.css", "http://site.test/journal/other"); code != 200 || body != "body{margin:0}" {
		t.Fatalf("asset via referer %d %q", code, body)
	}
	if code, _, _ = h.get("site.test", "/_v/journal-post/1/style.css", ""); code != 200 {
		t.Fatalf("explicit version path %d", code)
	}
	if code, _, _ = h.get("site.test", "/_v/secret/1/index.html", ""); code != 404 {
		t.Fatalf("admins-only page must not be served via /_v/: %d", code)
	}
	if code, _, _ = h.get("site.test", "/secret", ""); code != 404 {
		t.Fatalf("admins-only route %d", code)
	}
	if code, _, _ = h.get("site.test", "/nowhere", ""); code != 404 {
		t.Fatalf("unrouted %d", code)
	}
	if code, body, _ = h.get("site.test", "/_slop/runtime.js", ""); code != 200 || !strings.Contains(body, "window.slop") {
		t.Fatalf("runtime %d", code)
	}
	if code, _, _ = h.get("other.test", "/", ""); code != http.StatusMisdirectedRequest {
		t.Fatalf("unknown host %d", code)
	}
	// Probes address the pod (10.42.0.7:8080), not a configured host.
	for _, p := range []string{"/healthz", "/readyz"} {
		if code, _, _ = h.get("10.42.0.7:8080", p, ""); code != 200 {
			t.Fatalf("probe %s on an unknown host: %d", p, code)
		}
	}

	// Previews: an unguessable origin per artifact, the version in the path.
	var su map[string]any
	if code := manuel.do("GET", "/api/sandbox-url?artifact=journal-post&n=1&host=site.test&path=/journal/other", nil, &su); code != 200 {
		t.Fatalf("sandbox url %d %v", code, su)
	}
	u, _ := url.Parse(su["url"].(string))
	if !strings.HasSuffix(u.Host, ".sandbox.test") || u.Path != "/v/1/" || u.Query().Get("path") != "/journal/other" {
		t.Fatalf("sandbox url %v", u)
	}
	code, body, _ = h.get(u.Host, u.RequestURI(), "")
	if code != 200 || !strings.Contains(body, "bridge.js") || !strings.Contains(body, "claude.js") || !strings.Contains(body, `"parentOrigin":"`+h.ts.URL+`"`) || !strings.Contains(body, `"record":"posts/other.md"`) {
		t.Fatalf("preview %d %s", code, body)
	}
	if code, body, _ = h.get(u.Host, "/v/1/style.css", ""); code != 200 || body != "body{margin:0}" {
		t.Fatalf("preview asset %d %q", code, body)
	}
	if code, _, _ = h.get("s00000000000000000000.sandbox.test", "/", ""); code != 404 {
		t.Fatalf("unknown label %d", code)
	}

	// The API answers what a visitor would get.
	var res map[string]any
	if code := manuel.do("GET", "/api/resolve?host=site.test&path=/journal/other", nil, &res); code != 200 || res["n"].(float64) != 1 {
		t.Fatalf("resolve %d %v", code, res)
	}
	var recs []map[string]any
	if code := manuel.do("GET", "/api/artifacts/journal/versions/main/records", nil, &recs); code != 200 || len(recs) != 2 {
		t.Fatalf("records %d %v", code, recs)
	}
}

func TestPageFromRoutes(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	for _, p := range []string{"francois", "other"} {
		if code := manuel.do("PUT", "/api/projects/"+p, map[string]any{"name": p}, nil); code != 200 {
			t.Fatalf("project %s: %d", p, code)
		}
	}
	page := func(id, project, html string, manifest map[string]any, extra map[string]string) {
		files := map[string]string{"index.html": html}
		for k, v := range extra {
			files[k] = v
		}
		h.pushFiles(tok, id, map[string]any{"title": id, "kind": "page", "project": project}, manifest, files)
	}
	h.pushFiles(tok, "media", map[string]any{"title": "Media", "kind": "data", "project": "francois"}, nil, map[string]string{"a.png": "PNG"})
	page("release-missing", "francois", "<!doctype html><html><head></head><body>no such release</body></html>", nil, nil)
	page("weft", "francois", "<!doctype html><html><head><link rel=stylesheet href=style.css></head><body>weft</body></html>",
		map[string]any{"reads": map[string]string{"media": "media"}}, map[string]string{"style.css": "weft{}"})
	page("intruder", "other", "<p>other project", nil, nil)

	var rt map[string]any
	if code := manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/r/:page", "page": "release-missing", "pageFrom": "{page}"}, &rt); code != 200 || rt["pageFrom"] != "{page}" {
		t.Fatalf("put page-from route %d %v", code, rt)
	}
	if code := manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/x/:p", "page": "release-missing", "pageFrom": "{nope}"}, &rt); code != 400 {
		t.Fatalf("unknown param must be refused: %d %v", code, rt)
	}

	code, body, _ := h.get("site.test", "/r/weft", "")
	if code != 200 || !strings.Contains(body, "<body>weft") || !strings.Contains(body, `"version":{"artifact":"weft","n":1}`) || !strings.Contains(body, `"params":{"page":"weft"}`) {
		t.Fatalf("/r/weft %d %s", code, body)
	}
	for _, p := range []string{"/r/nope", "/r/intruder", "/r/media", "/r/Weft"} {
		if code, body, _ = h.get("site.test", p, ""); code != 404 || !strings.Contains(body, "no such release") {
			t.Fatalf("%s must be the else page with 404: %d %s", p, code, body)
		}
	}
	if code, body, _ = h.get("site.test", "/r/style.css", "http://site.test/r/weft"); code != 200 || body != "weft{}" {
		t.Fatalf("relative asset via referer %d %q", code, body)
	}
	if code, _, _ = h.get("site.test", "/_v/weft/1/style.css", ""); code != 200 {
		t.Fatalf("/_v/ of an admitted page %d", code)
	}
	if code, _, _ = h.get("site.test", "/_v/intruder/1/index.html", ""); code != 404 {
		t.Fatalf("/_v/ of another project's page %d", code)
	}
	if code, body, _ = h.get("site.test", "/_d/media/1/a.png", ""); code != 200 || body != "PNG" {
		t.Fatalf("/_d/ of data an admitted page reads %d %q", code, body)
	}

	var res map[string]any
	if code := manuel.do("GET", "/api/resolve?host=site.test&path=/r/weft", nil, &res); code != 200 || res["resolution"].(map[string]any)["page"] != "weft" {
		t.Fatalf("resolve %d %v", code, res)
	}
	if code := manuel.do("GET", "/api/resolve?host=site.test&path=/r/nope", nil, &res); code != 200 || res["resolution"].(map[string]any)["page"] != "release-missing" ||
		res["resolution"].(map[string]any)["missing"] != true {
		t.Fatalf("resolve missing %d %v", code, res)
	}
}
