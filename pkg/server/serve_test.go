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

	// Previews: an unguessable origin per version.
	var su map[string]any
	if code := manuel.do("GET", "/api/sandbox-url?artifact=journal-post&n=1&host=site.test&path=/journal/other", nil, &su); code != 200 {
		t.Fatalf("sandbox url %d %v", code, su)
	}
	u, _ := url.Parse(su["url"].(string))
	if !strings.HasSuffix(u.Host, ".sandbox.test") || u.Path != "/journal/other" {
		t.Fatalf("sandbox url %v", u)
	}
	code, body, _ = h.get(u.Host, u.RequestURI(), "")
	if code != 200 || !strings.Contains(body, "bridge.js") || !strings.Contains(body, `"parentOrigin":"`+h.ts.URL+`"`) || !strings.Contains(body, `"record":"posts/other.md"`) {
		t.Fatalf("preview %d %s", code, body)
	}
	if code, body, _ = h.get(u.Host, "/journal/style.css", ""); code != 200 || body != "body{margin:0}" {
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
