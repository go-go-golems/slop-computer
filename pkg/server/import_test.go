package server

import (
	"net/url"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Files of data artifacts (G2 in SLOP-002): binary files become file records
// with a src under /_d/, served only for data a routed page reads.
func TestDataFiles(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "media", map[string]any{"title": "Media", "kind": "data"}, nil, map[string]string{
		"files/med_1.png": "\x89PNG fake", "index.json": `{"med_1":{"alt":"a lens"}}`})
	h.pushFiles(tok, "private", map[string]any{"title": "Private", "kind": "data"}, nil, map[string]string{"files/p.png": "secret"})
	h.pushFiles(tok, "gallery", map[string]any{"title": "Gallery", "kind": "page"}, map[string]any{"reads": map[string]string{"media": "media"}},
		map[string]string{"index.html": "<!doctype html><title>g</title>"})
	h.pushFiles(tok, "lonely", map[string]any{"title": "Lonely", "kind": "page"}, map[string]any{"reads": map[string]string{"p": "private"}},
		map[string]string{"index.html": "<p>x"})
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/gallery", "page": "gallery"}, nil)

	code, body, _ := h.get("site.test", "/gallery", "")
	if code != 200 || !strings.Contains(body, `<script src="/_r/media/1.js">`) {
		t.Fatalf("gallery %d %s", code, body)
	}
	code, body, _ = h.get("site.test", "/_r/media/1.js", "")
	if code != 200 || !strings.Contains(body, `"src":"/_d/media/1/files/med_1.png"`) || strings.Contains(body, "PNG fake") {
		t.Fatalf("gallery records %d %s", code, body)
	}
	code, body, hdr := h.get("site.test", "/_d/media/1/files/med_1.png", "")
	if code != 200 || body != "\x89PNG fake" || !strings.Contains(hdr.Get("Cache-Control"), "immutable") {
		t.Fatalf("data file %d %q %v", code, body, hdr)
	}
	// main is a place: fresh for a minute on a site host, then revalidated.
	if code, _, hdr = h.get("site.test", "/_d/media/main/files/med_1.png", ""); code != 200 || hdr.Get("Cache-Control") != "public, max-age=60, stale-while-revalidate=86400" {
		t.Fatalf("data file at main %d %v", code, hdr)
	}
	// Data no public route reads, and the manifest, stay private.
	for _, p := range []string{"/_d/private/1/files/p.png", "/_d/media/1/slop.json", "/_d/media/1/nope.png"} {
		if code, _, _ = h.get("site.test", p, ""); code != 404 {
			t.Fatalf("%s: %d", p, code)
		}
	}
	// A preview of a page serves the data its manifest reads.
	var su map[string]any
	manuel.do("GET", "/api/sandbox-url?artifact=lonely&n=1", nil, &su)
	u, _ := url.Parse(su["url"].(string))
	host := u.Host
	if code, body, _ = h.get(host, "/_d/private/1/files/p.png", ""); code != 200 || body != "secret" {
		t.Fatalf("preview data file %d %q", code, body)
	}
	if code, body, _ = h.get(host, "/_r/private/1.js", ""); code != 200 || !strings.HasPrefix(body, `slop.records("private@1",`) {
		t.Fatalf("preview records %d %q", code, body)
	}
	if code, _, _ = h.get(host, "/_r/media/1.js", ""); code != 404 {
		t.Fatalf("preview of unrelated records %d", code)
	}
	if code, _, _ = h.get(host, "/_d/media/1/files/med_1.png", ""); code != 404 {
		t.Fatalf("preview of unrelated data %d", code)
	}
}

// Pushing on behalf of someone else (G1): admin scope only, audited.
func TestPushAs(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	ramon := h.signIn("ramon")
	rw := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	adm := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite, store.ScopeAdmin)
	tree := map[string]string{"index.html": h.upload(rw, []byte("<p>hi"))}
	push := func(tok string, body map[string]any) (int, map[string]any) {
		var res map[string]any
		code := h.bearer(tok, "POST", "/api/artifacts/imported/versions", body, &res)
		return code, res
	}
	create := map[string]any{"title": "Imported", "kind": "page"}
	if code, res := push(rw, map[string]any{"tree": tree, "create": create, "author": ramon.id()}); code != 403 {
		t.Fatalf("rw token pushing as someone else: %d %v", code, res)
	}
	if code, res := push(adm, map[string]any{"tree": tree, "create": create, "author": "usr_nobody"}); code != 400 {
		t.Fatalf("unknown author: %d %v", code, res)
	}
	code, res := push(adm, map[string]any{"tree": tree, "create": create, "author": ramon.id(), "via": "import", "message": "1.0.0"})
	v, _ := res["version"].(map[string]any)
	if code != 201 || v["by"] != ramon.id() || v["via"] != "import" {
		t.Fatalf("push as ramon: %d %v", code, res)
	}
	entries, err := h.st.AuditQuery(t.Context(), store.AuditFilter{Subject: "imported"})
	if err != nil || len(entries) == 0 || entries[0].Action != "version.push_as" || *entries[0].ActorID != manuel.id() {
		t.Fatalf("audit %v %v", entries, err)
	}
}
