package server

import (
	"bytes"
	"compress/gzip"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/url"
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

// A preview of an older page version gets the records and files that
// version reads, though main no longer reads them (SLOP-012 review): the
// page's Referer names the version. Without it, or naming a version that
// does not read the data, nothing is served.
func TestPreviewReadsItsVersion(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "notes", map[string]any{"title": "Notes", "kind": "data"}, nil, map[string]string{"a.json": `{"title":"A"}`, "x.png": pngOf(t, 10, 10, false)})
	page := map[string]string{"index.html": "<!doctype html><title>p</title>"}
	h.pushFiles(tok, "board", map[string]any{"title": "Board", "kind": "page"}, map[string]any{"reads": map[string]string{"notes": "notes"}}, page)
	h.pushFiles(tok, "board", nil, map[string]any{}, page) // main reads nothing now

	var su map[string]any
	if code := manuel.do("GET", "/api/sandbox-url?artifact=board&n=1", nil, &su); code != 200 {
		t.Fatalf("sandbox url %d %v", code, su)
	}
	u, _ := url.Parse(su["url"].(string))
	if _, body, _ := h.fetch(u.Host, u.RequestURI(), nil); !strings.Contains(string(body), `src="/_r/notes/1.js"`) {
		t.Fatalf("v1 preview does not load its records:\n%s", body)
	}
	from := func(n string) map[string]string {
		return map[string]string{"Referer": "http://" + u.Host + "/v/" + n + "/"}
	}
	for _, c := range []struct {
		path string
		hdr  map[string]string
		want int
	}{
		{"/_r/notes/1.js", from("1"), 200},
		{"/_d/notes/1/x.png", from("1"), 200},
		{"/_r/notes/1.js", nil, 404},
		{"/_r/notes/1.js", from("2"), 404},
		{"/_r/notes/1.js", map[string]string{"Referer": "http://elsewhere.test/v/1/"}, 404},
	} {
		if code, _, _ := h.fetch(u.Host, c.path, c.hdr); code != c.want {
			t.Errorf("%s from %v: %d, want %d", c.path, c.hdr, code, c.want)
		}
	}
}

// withOrientation puts an EXIF APP1 segment naming orientation o (big
// endian, one IFD0 entry) right after a JPEG's SOI marker.
func withOrientation(jpg []byte, o uint16) []byte {
	tiff := []byte{'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, byte(o >> 8), byte(o), 0, 0, 0, 0, 0, 0, 0, 0}
	seg := append([]byte("Exif\x00\x00"), tiff...)
	app1 := append([]byte{0xFF, 0xE1, byte((len(seg) + 2) >> 8), byte(len(seg) + 2)}, seg...)
	return append(append(append([]byte{}, jpg[:2]...), app1...), jpg[2:]...)
}

// A phone photo stored sideways with EXIF orientation 6 is shown turned
// right; its thumbnail and its record's size are as shown (SLOP-012 review).
func TestThumbnailOrientation(t *testing.T) {
	// 640×320 as stored: red on the left half, blue on the right, noisy so
	// a copy is smaller than the original. Shown, it is 320×640, red on top.
	img := image.NewNRGBA(image.Rect(0, 0, 640, 320))
	seed := uint32(7)
	for y := 0; y < 320; y++ {
		for x := 0; x < 640; x++ {
			seed = seed*1664525 + 1013904223
			n := uint8(seed >> 26) // 0-63
			c := color.NRGBA{R: 192 + n, G: n, B: n, A: 255}
			if x >= 320 {
				c = color.NRGBA{R: n, G: n, B: 192 + n, A: 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "photos", map[string]any{"title": "Photos", "kind": "data"}, nil, map[string]string{"phone.jpg": string(withOrientation(buf.Bytes(), 6))})
	h.pushFiles(tok, "roll", map[string]any{"title": "Roll", "kind": "page"}, map[string]any{"reads": map[string]string{"photos": "photos"}},
		map[string]string{"index.html": "<!doctype html><title>roll</title>"})
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/roll", "page": "roll"}, nil)

	code, body, hdr := h.fetch("site.test", "/_d/photos/1/phone.jpg?w=160", nil)
	if code != 200 || hdr.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("thumbnail %d %v", code, hdr)
	}
	thumb, err := jpeg.Decode(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if b := thumb.Bounds(); b.Dx() != 160 || b.Dy() != 320 {
		t.Fatalf("thumbnail is %v, want 160×320 as shown", b)
	}
	top, bottom := thumb.At(80, 40), thumb.At(80, 280)
	if r, _, b, _ := top.RGBA(); r < b {
		t.Errorf("top is %v, want red", top)
	}
	if r, _, b, _ := bottom.RGBA(); b < r {
		t.Errorf("bottom is %v, want blue", bottom)
	}
	if _, recs, _ := h.fetch("site.test", "/_r/photos/1.js", nil); !strings.Contains(string(recs), `"height":640`) || !strings.Contains(string(recs), `"width":320`) {
		t.Fatalf("record size not as shown:\n%.600s", recs)
	}
}

// orient matches the EXIF table, built here from two plain moves: mirror
// left-right and turn right (2: mirror; 3: turn twice; 4: mirror, turn
// twice; 5: mirror, turn left (top-bottom mirrored, turned right); 6: turn right; 7: mirror, turn
// right; 8: turn three times).
func TestOrient(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	for i := range src.Pix {
		src.Pix[i] = uint8(i)
	}
	mirror := func(m *image.NRGBA) *image.NRGBA {
		w, h := m.Bounds().Dx(), m.Bounds().Dy()
		out := image.NewNRGBA(image.Rect(0, 0, w, h))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				out.SetNRGBA(x, y, m.NRGBAAt(w-1-x, y))
			}
		}
		return out
	}
	right := func(m *image.NRGBA) *image.NRGBA { // the top row becomes the right column
		w, h := m.Bounds().Dx(), m.Bounds().Dy()
		out := image.NewNRGBA(image.Rect(0, 0, h, w))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				out.SetNRGBA(h-1-y, x, m.NRGBAAt(x, y))
			}
		}
		return out
	}
	want := map[int]*image.NRGBA{
		1: src, 2: mirror(src), 3: right(right(src)), 4: right(right(mirror(src))),
		5: right(right(right(mirror(src)))), 6: right(src), 7: right(mirror(src)), 8: right(right(right(src))),
	}
	for o := 1; o <= 8; o++ {
		got := orient(src, o)
		if got.Bounds() != want[o].Bounds() || !bytes.Equal(got.Pix, want[o].Pix) {
			t.Errorf("orientation %d: %v %v, want %v %v", o, got.Bounds(), got.Pix, want[o].Bounds(), want[o].Pix)
		}
	}
}
