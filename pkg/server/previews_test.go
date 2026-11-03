package server

// Tests from SLOP3-002 phase W5 (inspect previews); formerly w5_test.go.

import (
	"context"
	"strings"
	"testing"
)

// W5 exit: a private store's preview is served only on its label, at the
// root, with the bridge in its HTML and a CSP naming the parent; parents
// outside this server are refused; an expired label, an unknown label and
// a person who lost access all get 404.
func TestPreviews(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com")
	live := h.cfg.Origin(h.cfg.Hosts.Live[0])
	h.call(admin, "store.new", map[string]any{"id": "priv"})
	h.call(admin, "files.push", map[string]any{"store": "priv", "files": files(map[string]string{
		"index.html":       `<!doctype html><html><head><title>Priv</title><link rel="stylesheet" href="/style.css"></head><body><h1>main</h1><a href="/about/">about</a></body></html>`,
		"about/index.html": `<h1>About</h1>`,
		"style.css":        `h1 { color: teal }`,
	})})
	h.call(admin, "files.push", map[string]any{"store": "priv", "ref": "draft", "files": files(map[string]string{
		"index.html": `<!doctype html><html><head><title>Priv</title></head><body><h1>draft</h1></body></html>`,
	})})
	host := func(url string) string { return strings.TrimSuffix(strings.TrimPrefix(url, h.cfg.Scheme+"://"), "/") }

	// The default is draft; at selects a ref or a snapshot.
	pv := h.call(admin, "preview.url", map[string]any{"store": "priv", "parent": live}).(map[string]any)
	r, body := h.get(host(pv["url"].(string)), "/")
	if r.StatusCode != 200 || !strings.Contains(body, "<h1>draft</h1>") {
		t.Fatalf("draft preview: %d %s", r.StatusCode, body)
	}
	if !strings.Contains(body, `"mode":"preview"`) || !strings.Contains(body, `"parentOrigin":"`+live+`"`) || !strings.Contains(body, "/_slop/bridge.js") {
		t.Fatalf("preview injection missing: %s", body)
	}
	if csp := r.Header.Get("Content-Security-Policy"); !strings.HasPrefix(csp, "frame-ancestors "+live+" ") || strings.Contains(csp, "*") {
		t.Fatalf("csp = %q", csp)
	}
	if cc := r.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Fatalf("cache-control = %q", cc)
	}
	pv = h.call(admin, "preview.url", map[string]any{"store": "priv", "at": "main", "parent": live}).(map[string]any)
	ph := host(pv["url"].(string))
	if _, body := h.get(ph, "/"); !strings.Contains(body, "<h1>main</h1>") {
		t.Fatalf("main preview: %s", body)
	}
	if r, body := h.get(ph, "/about/"); r.StatusCode != 200 || !strings.Contains(body, "About") {
		t.Fatalf("about: %d %s", r.StatusCode, body)
	}
	if r, body := h.get(ph, "/style.css"); r.StatusCode != 200 || !strings.Contains(r.Header.Get("Content-Type"), "css") || !strings.Contains(body, "teal") {
		t.Fatalf("css: %d %s", r.StatusCode, r.Header.Get("Content-Type"))
	}
	if r, body := h.get(ph, "/_slop/bridge.js"); r.StatusCode != 200 || !strings.Contains(body, "pick") {
		t.Fatalf("bridge: %d", r.StatusCode)
	}

	// Parents outside this server are refused; a tool's sandbox origin is fine.
	h.fail(admin, "preview.url", map[string]any{"store": "priv", "parent": "https://evil.example"}, "invalid_argument")
	tool := h.cfg.Scheme + "://s0123abcd." + h.cfg.Hosts.Sandbox
	tp := h.call(admin, "preview.url", map[string]any{"store": "priv", "parent": tool}).(map[string]any)
	if r, _ := h.get(host(tp["url"].(string)), "/"); r.Header.Get("Content-Security-Policy") != "frame-ancestors "+tool+" "+h.cfg.MainURL()+" "+live {
		t.Fatalf("csp for a tool origin = %q", r.Header.Get("Content-Security-Policy"))
	}
	// A person who cannot read the store gets no preview.
	h.fail(mia, "preview.url", map[string]any{"store": "priv", "parent": live}, "not_found")

	// Unknown and expired labels are not found.
	if r, _ := h.get("p0000000000000000000000ff."+h.cfg.Hosts.Sandbox, "/"); r.StatusCode != 404 {
		t.Fatalf("unknown label: %d", r.StatusCode)
	}
	label, _, _ := strings.Cut(ph, ".")
	if _, err := h.sys.ExecContext(context.Background(), `UPDATE previews SET expires_at = 1 WHERE label = ?`, label); err != nil {
		t.Fatal(err)
	}
	if r, _ := h.get(ph, "/"); r.StatusCode != 404 {
		t.Fatalf("expired label: %d", r.StatusCode)
	}

	// Access is checked on every request: losing it ends the preview.
	h.call(admin, "grant.set", map[string]any{"store": "priv", "subject": "@member", "level": "view"})
	mp := h.call(mia, "preview.url", map[string]any{"store": "priv", "parent": live}).(map[string]any)
	if r, _ := h.get(host(mp["url"].(string)), "/"); r.StatusCode != 200 {
		t.Fatalf("member preview: %d", r.StatusCode)
	}
	h.call(admin, "grant.rm", map[string]any{"store": "priv", "subject": "@member"})
	if r, _ := h.get(host(mp["url"].(string)), "/"); r.StatusCode != 404 {
		t.Fatalf("preview after losing access: %d", r.StatusCode)
	}
}
