package server

import (
	"bytes"
	"compress/gzip"
	"image"
	"image/color"
	"image/png"
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

// pngOf is a w×h PNG of noise, like a photo (a smooth gradient compresses
// so well that no copy is smaller), transparent on the left half if alpha.
func pngOf(t *testing.T, w, h int, alpha bool) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	seed := uint32(1)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			seed = seed*1664525 + 1013904223
			a := uint8(255)
			if alpha && x < w/2 {
				a = 0
			}
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(seed >> 24), G: uint8(seed >> 16), B: uint8(seed >> 8), A: a})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}

// Any image URL takes ?w= (SLOP-012): scaled to a ladder width, never
// enlarged, JPEG when opaque and PNG when not, built once, with the cache
// class of the URL it came from.
func TestThumbnails(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "pics", map[string]any{"title": "Pics", "kind": "data"}, nil, map[string]string{
		"big.png": pngOf(t, 800, 500, false), "clear.png": pngOf(t, 800, 500, true), "tiny.png": pngOf(t, 100, 60, false), "notes.txt": "hello"})
	h.pushFiles(tok, "album", map[string]any{"title": "Album", "kind": "page"}, map[string]any{"reads": map[string]string{"pics": "pics"}},
		map[string]string{"index.html": "<!doctype html><title>album</title>"})
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/album", "page": "album"}, nil)

	decoded := func(b []byte) image.Config {
		t.Helper()
		cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		return cfg
	}
	code, body, hdr := h.fetch("site.test", "/_d/pics/1/big.png?w=480", nil)
	if cfg := decoded(body); code != 200 || hdr.Get("Content-Type") != "image/jpeg" || cfg.Width != 480 || cfg.Height != 300 ||
		hdr.Get("Cache-Control") != "public, max-age=31536000, immutable" || !strings.HasSuffix(hdr.Get("ETag"), `.w480"`) {
		t.Fatalf("thumbnail %d %v %v", code, hdr, cfg)
	}
	sum := strings.TrimSuffix(strings.Trim(hdr.Get("ETag"), `"`), ".w480")
	if _, ok := h.srv.Blobs.Derived(sum + ".w480.jpg"); !ok {
		t.Fatal("the thumbnail was not kept")
	}
	if _, body, _ = h.fetch("site.test", "/_d/pics/1/big.png?w=500", nil); decoded(body).Width != 640 {
		t.Fatalf("?w=500 snaps to %d", decoded(body).Width)
	}
	if _, body, hdr = h.fetch("site.test", "/_d/pics/1/clear.png?w=320", nil); hdr.Get("Content-Type") != "image/png" || decoded(body).Width != 320 {
		t.Fatalf("transparent thumbnail %v", hdr)
	}
	// Smaller than the width asked for: the original, as it is.
	tiny := pngOf(t, 100, 60, false)
	if _, body, hdr = h.fetch("site.test", "/_d/pics/1/tiny.png?w=480", nil); string(body) != tiny || hdr.Get("Content-Type") != "image/png" {
		t.Fatalf("no enlargement %v", hdr)
	}
	// main is a place, thumbnails too; ?w= means nothing for text.
	if _, _, hdr = h.fetch("site.test", "/_d/pics/main/big.png?w=480", nil); hdr.Get("Cache-Control") != "public, max-age=60, stale-while-revalidate=86400" || hdr.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("thumbnail at main %v", hdr)
	}
	if _, body, _ = h.fetch("site.test", "/_d/pics/1/notes.txt?w=480", nil); string(body) != "hello" {
		t.Fatalf("?w= on text: %q", body)
	}
	// A page that only links to the images names them in files: served,
	// but their records are not loaded.
	h.pushFiles(tok, "covers", map[string]any{"title": "Covers", "kind": "page"}, map[string]any{"files": []string{"pics"}},
		map[string]string{"index.html": "<!doctype html><title>covers</title>"})
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/covers", "page": "covers"}, nil)
	h.pushFiles(tok, "pics2", map[string]any{"title": "Unread", "kind": "data"}, nil, map[string]string{"x.png": pngOf(t, 10, 10, false)})
	if _, page, _ := h.fetch("site.test", "/covers", nil); strings.Contains(string(page), "/_r/") || strings.Contains(string(page), `"pics"`) {
		t.Fatalf("files loaded records:\n%s", page)
	}
	if code, _, _ := h.fetch("site.test", "/_d/pics2/1/x.png", nil); code != 404 {
		t.Fatalf("unread data served: %d", code)
	}
	// Records of images carry their size.
	_, recs, _ := h.fetch("site.test", "/_r/pics/1.js", nil)
	if !strings.Contains(string(recs), `"height":500`) || !strings.Contains(string(recs), `"width":800`) {
		t.Fatalf("records lack sizes:\n%.600s", recs)
	}
}
