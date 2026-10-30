package server

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/render"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// fetch is get with request headers, without the client's own gzip handling.
func (h *harness) fetch(host, path string, headers map[string]string) (int, []byte, http.Header) {
	h.t.Helper()
	req, _ := http.NewRequest("GET", h.ts.URL+path, nil)
	req.Host = host
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b, resp.Header
}

func gunzip(t *testing.T, b []byte) string {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// What a URL names decides how long it may be cached: content for good, a
// place briefly, a document never without revalidation. Text is gzipped
// (SLOP-012).
func TestCacheClassesAndCompression(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	css1 := "body{margin:0}\n" + strings.Repeat(".a{color:red}\n", 200)
	page := "<!doctype html><html><head><link rel=stylesheet href=style.css></head><body>" + strings.Repeat("<p>hello</p>", 200) + "</body></html>"
	h.pushFiles(tok, "shop", map[string]any{"title": "Shop", "kind": "page"}, nil, map[string]string{"index.html": page, "style.css": css1})
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/shop", "page": "shop"}, nil)
	const place = "public, max-age=60, stale-while-revalidate=86400"
	const content = "public, max-age=31536000, immutable"

	// The page: a document with an ETag; unchanged, a 304; gzipped on request.
	code, body, hdr := h.fetch("site.test", "/shop", nil)
	tag := hdr.Get("ETag")
	if code != 200 || hdr.Get("Cache-Control") != "no-cache" || tag == "" || hdr.Get("Content-Encoding") != "" {
		t.Fatalf("page %d %v", code, hdr)
	}
	if !strings.Contains(string(body), `src="`+render.AssetURL("runtime.js")+`"`) {
		t.Fatalf("page does not name the runtime by its hash:\n%.400s", body)
	}
	if code, body, _ = h.fetch("site.test", "/shop", map[string]string{"If-None-Match": tag}); code != 304 || len(body) != 0 {
		t.Fatalf("revalidated page %d %d bytes", code, len(body))
	}
	code, body, hdr = h.fetch("site.test", "/shop", map[string]string{"Accept-Encoding": "gzip"})
	if code != 200 || hdr.Get("Content-Encoding") != "gzip" || !strings.Contains(hdr.Get("Vary"), "Accept-Encoding") || !strings.Contains(gunzip(t, body), "<p>hello</p>") {
		t.Fatalf("gzipped page %d %v", code, hdr)
	}

	// The page's own file is named by the page's path, not its version: a
	// place (it was cached as immutable before, and went stale for a year).
	code, body, hdr = h.fetch("site.test", "/style.css", map[string]string{"Referer": "http://site.test/shop"})
	if code != 200 || string(body) != css1 || hdr.Get("Cache-Control") != place || !strings.Contains(hdr.Get("Vary"), "Referer") {
		t.Fatalf("page file %d %v", code, hdr)
	}
	css2 := "body{margin:1px}\n" + strings.Repeat(".b{color:blue}\n", 200)
	h.pushFiles(tok, "shop", nil, nil, map[string]string{"index.html": page, "style.css": css2})
	if _, body, _ = h.fetch("site.test", "/style.css", map[string]string{"Referer": "http://site.test/shop"}); string(body) != css2 {
		t.Fatalf("page file after a new version: %.40q", body)
	}

	// A file named by its version is content, gzipped from a derived copy.
	code, body, hdr = h.fetch("site.test", "/_v/shop/1/style.css", map[string]string{"Accept-Encoding": "gzip"})
	if code != 200 || hdr.Get("Cache-Control") != content || hdr.Get("Content-Encoding") != "gzip" || gunzip(t, body) != css1 {
		t.Fatalf("versioned file %d %v", code, hdr)
	}
	if code, body, hdr = h.fetch("site.test", "/_v/shop/1/style.css", map[string]string{"Range": "bytes=0-3", "Accept-Encoding": "gzip"}); code != 206 || string(body) != "body" || hdr.Get("Content-Encoding") != "" {
		t.Fatalf("range request %d %q %v", code, body, hdr)
	}

	// Runtime assets: content when named by their hash, a place otherwise.
	if _, _, hdr = h.fetch("site.test", render.AssetURL("runtime.js"), nil); hdr.Get("Cache-Control") != content {
		t.Fatalf("hashed runtime %v", hdr)
	}
	if _, _, hdr = h.fetch("site.test", "/_slop/runtime.js", nil); hdr.Get("Cache-Control") != place {
		t.Fatalf("bare runtime %v", hdr)
	}

	// Off the site host, everything is private.
	if _, _, hdr = h.fetch(h.ts.Listener.Addr().String(), "/api/artifacts/shop/versions/1/files/style.css", map[string]string{"Authorization": "Bearer " + tok}); hdr.Get("Cache-Control") != "private, max-age=31536000, immutable" {
		t.Fatalf("API file %v", hdr)
	}
}
