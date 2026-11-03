package host

// Tests from SLOP3-003 phase B5 (uploaded files); formerly b5_test.go.

import (
	"encoding/base64"
	"strings"
	"testing"
)

const onePNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

// probeActor answers any id with {asset}, so the test can see what the
// server itself allows, and lists what its handle describes.
const probeActor = `
defineActor({
  actions: { assets() { const a = use('stores').open('source').assets; return a ? a.list() : null; } },
  http: { 'GET /x/:id': { level: 'public', run: (ctx, req) => ({ asset: { from: 'source', id: req.params.id } }) } },
});
`

// B5 exit: uploaded files. A binding shares them only when set with
// assets, which needs admin on the target; the reader serves only the
// uploads its published pages show, the server rechecks the binding and
// sends the bytes (never a page); a publication copies them by hash.
// Covers render; images are https or uploads.
func TestBlocksSiteUploads(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com", "read", "write")
	live, static := h.cfg.Hosts.Live[0], h.cfg.Hosts.Static[0]
	blocksWorkspace(t, h, admin, "ws-weft")
	png, _ := base64.StdEncoding.DecodeString(onePNG)
	up := func(id, typ string, data []byte) map[string]any {
		return map[string]any{"path": id, "data": base64.StdEncoding.EncodeToString(data), "type": typ}
	}
	h.call(admin, "import.files", map[string]any{"store": "ws-weft", "zone": "assets", "files": []any{
		up("a1png", "image/png", png), up("a2pdf", "application/pdf", []byte("%PDF-1.4 x")),
		up("a3secret", "image/png", png), up("a4draft", "image/png", png), up("a5html", "text/html", []byte("<script>alert(1)</script>")),
	}})
	rec := func(id, name, kind, typ string) string {
		return `{name: "` + name + `", kind: "` + kind + `", type: "` + typ + `", size: 68, url: "/_blob/` + id + `", id: "` + id + `"}`
	}
	ops := []string{
		`weft.cover = "ocean"`,
		`weft.media = [` + rec("a1png", "skein.png", "image", "image/png") + `, ` + rec("a2pdf", "pattern.pdf", "pdf", "application/pdf") +
			`, {name: "tab.png", kind: "image", type: "image/png", size: 1, url: "blob:x", local: true, id: "local1"}]`,
		`weft.ui.40 is upload media`,
		`weft.ui.41 is each m in media`,
		`weft.ui.41.0 is file m`,
		`weft.ui.42 is image "https://example.com/yarn.jpg", alt: "Yarn"`,
		`weft.ui.43 is image "http://example.com/plain.jpg"`,
		`care.cover = "https://example.com/c.jpg"`,
		`drafts.media = [` + rec("a4draft", "d.png", "image", "image/png") + `]`,
		`drafts.ui.1 is file drafts.media.0`,
	}
	chunk := []any{}
	for i, op := range ops {
		chunk = append(chunk, []any{"m" + string(rune('a'+i)), "uz:you", 800 + i, op, 1793600200000})
	}
	h.call(admin, "docs.set", map[string]any{"store": "ws-weft", "path": "chunks/c-media-0", "data": map[string]any{"at": 1793600200000, "n": len(chunk), "ops": chunk}})

	installBlocksSite(t, h, admin)
	blocksSite(t, h, admin, "weft-site", "ws-weft")
	h.call(admin, "grant.set", map[string]any{"store": "weft-site", "subject": "@guest", "level": "view"})
	h.call(admin, "docs.set", map[string]any{"store": "weft-site", "path": "site/config", "data": map[string]any{"root": "weft"}})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/pub/:id", "storeParam": "id", "type": "blocks-site"})

	// Not shared: covers and https images, no uploads; the media route is a 404.
	_, home := h.get(live, "/pub/weft-site/")
	if !strings.Contains(home, `<div class="cover" style="background: linear-gradient(120deg, #CFE8F2 0%`) ||
		!strings.Contains(home, `<img src="https://example.com/yarn.jpg" alt="Yarn"`) || strings.Contains(home, "plain.jpg") ||
		strings.Contains(home, "_media") || strings.Contains(home, "skein.png") {
		t.Fatalf("home without shared uploads:\n%s", home)
	}
	if _, care := h.get(live, "/pub/weft-site/care"); !strings.Contains(care, `url(&quot;https://example.com/c.jpg&quot;)`) {
		t.Fatalf("care cover:\n%s", care)
	}
	if res, _ := h.get(live, "/pub/weft-site/_media/a1png"); res.StatusCode != 404 {
		t.Fatalf("an unshared upload answers %d", res.StatusCode)
	}

	// Sharing needs admin on the workspace, not only on the site.
	miaID := h.call(mia, "whoami", nil).(map[string]any)["id"]
	h.call(admin, "grant.set", map[string]any{"store": "weft-site", "subject": miaID, "level": "admin"})
	h.call(admin, "grant.set", map[string]any{"store": "ws-weft", "subject": miaID, "level": "view"})
	h.call(mia, "bind.set", map[string]any{"store": "weft-site", "alias": "source", "target": "ws-weft"})
	h.fail(mia, "bind.set", map[string]any{"store": "weft-site", "alias": "source", "target": "ws-weft", "assets": true}, "permission_denied")
	h.call(admin, "bind.set", map[string]any{"store": "weft-site", "alias": "source", "target": "ws-weft", "assets": true})
	if bs := fmtAny(h.call(admin, "bind.ls", map[string]any{"store": "weft-site"})); !strings.Contains(bs, `"assets":true`) {
		t.Fatalf("bind.ls = %s", bs)
	}

	// Shared: the pages show the uploads they reference, and only those are served.
	_, home = h.get(live, "/pub/weft-site/")
	if !strings.Contains(home, `<figure class="file"><img src="/pub/weft-site/_media/a1png" alt="skein.png" loading="lazy"><figcaption>skein.png</figcaption></figure>`) ||
		!strings.Contains(home, `<a class="file" href="/pub/weft-site/_media/a2pdf">📎 pattern.pdf</a>`) || strings.Contains(home, "local1") || strings.Contains(home, "a4draft") {
		t.Fatalf("home with shared uploads:\n%s", home)
	}
	res, body := h.get(live, "/pub/weft-site/_media/a1png")
	if res.StatusCode != 200 || body != string(png) || res.Header.Get("Content-Type") != "image/png" ||
		res.Header.Get("Content-Security-Policy") != "sandbox; default-src 'none'" || res.Header.Get("Content-Disposition") != "" {
		t.Fatalf("a shown upload = %d %q %v", res.StatusCode, res.Header.Get("Content-Type"), res.Header)
	}
	for _, id := range []string{"a3secret", "a4draft", "a5html", "nope"} {
		if res, _ := h.get(live, "/pub/weft-site/_media/"+id); res.StatusCode != 404 {
			t.Errorf("upload %s (not shown on a published page) answers %d", id, res.StatusCode)
		}
	}

	// What the server allows, whatever the actor says: a probe app answering {asset} for any id.
	h.call(admin, "store.new", map[string]any{"id": "probe"})
	h.call(admin, "files.push", map[string]any{"store": "probe", "files": files(map[string]string{"app.json": `{"title":"probe","actor":"actor.js"}`, "actor.js": probeActor})})
	h.call(admin, "store.new", map[string]any{"id": "probe-1", "app": "probe"})
	h.call(admin, "bind.set", map[string]any{"store": "probe-1", "alias": "source", "target": "ws-weft"})
	h.call(admin, "grant.set", map[string]any{"store": "ws-weft", "subject": "store:probe-1", "level": "view"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/probe/:id", "storeParam": "id"})
	if got := h.call(admin, "actor.call", map[string]any{"store": "probe-1", "action": "assets", "args": map[string]any{}}); got != nil {
		t.Fatalf("a binding without assets describes uploads: %v", got)
	}
	if res, _ := h.get(live, "/probe/probe-1/x/a1png"); res.StatusCode != 404 {
		t.Fatalf("the server sent an upload through a binding without assets: %d", res.StatusCode)
	}
	h.call(admin, "bind.set", map[string]any{"store": "probe-1", "alias": "source", "target": "ws-weft", "assets": true})
	list := fmtAny(h.call(admin, "actor.call", map[string]any{"store": "probe-1", "action": "assets", "args": map[string]any{}}))
	if !strings.Contains(list, `"id":"a1png"`) || !strings.Contains(list, `"sha256":"`) || !strings.Contains(list, `"type":"image/png"`) {
		t.Fatalf("assets.list() = %s", list)
	}
	if res, _ := h.get(live, "/probe/probe-1/x/a5html"); res.StatusCode != 200 || res.Header.Get("Content-Disposition") != "attachment" ||
		res.Header.Get("Content-Security-Policy") != "sandbox; default-src 'none'" {
		t.Fatalf("an HTML upload = %d %v", res.StatusCode, res.Header)
	}
	h.call(admin, "grant.rm", map[string]any{"store": "ws-weft", "subject": "store:probe-1"})
	if res, _ := h.get(live, "/probe/probe-1/x/a1png"); res.StatusCode != 404 {
		t.Fatalf("the server sent an upload after the grant was removed: %d", res.StatusCode)
	}

	// A publication copies the uploads its pages show, by hash.
	h.call(admin, "mount.set", map[string]any{"host": static, "path": "/s/:id", "storeParam": "id", "type": "site"})
	h.call(admin, "store.new", map[string]any{"id": "weft-static", "type": "site"})
	h.call(admin, "grant.set", map[string]any{"store": "weft-static", "subject": "@guest", "level": "view"})
	h.call(admin, "app.trust", map[string]any{"app": "blocks-site", "module": "workshop"})
	r := h.call(admin, "actor.call", map[string]any{"store": "weft-site", "action": "publish", "args": map[string]any{"to": "weft-static", "live": true}}).(map[string]any)
	if fmtAny(r["files"]) != "5" {
		t.Fatalf("publish = %v", r)
	}
	tree := fmtAny(h.call(admin, "files.ls", map[string]any{"store": "weft-static", "at": "main"}))
	if !strings.Contains(tree, `"path":"media/a1png"`) || !strings.Contains(tree, `"path":"media/a2pdf"`) || strings.Contains(tree, "a3secret") || strings.Contains(tree, "a4draft") {
		t.Fatalf("static tree = %s", tree)
	}
	if _, body := h.get(static, "/s/weft-static/"); !strings.Contains(body, `<img src="media/a1png"`) {
		t.Fatalf("static home:\n%s", body)
	}
	if res, body := h.get(static, "/s/weft-static/media/a1png"); res.StatusCode != 200 || body != string(png) {
		t.Fatalf("static upload = %d", res.StatusCode)
	}
}

// Store bytes get their headers from facts (SLOP3-005 §6.8): an actor may
// ask for public caching of an upload it serves, but a shared cache keeps
// it only when anyone may read the serving store; and uploads never run
// as pages, on the static host either.
func TestStoreBytesFacts(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live, static := h.cfg.Hosts.Live[0], h.cfg.Hosts.Static[0]
	png, _ := base64.StdEncoding.DecodeString(onePNG)
	h.call(admin, "store.new", map[string]any{"id": "src"})
	h.call(admin, "import.files", map[string]any{"store": "src", "zone": "assets", "files": []any{
		map[string]any{"path": "pic", "data": base64.StdEncoding.EncodeToString(png), "type": "image/png"},
		map[string]any{"path": "page.html", "data": base64.StdEncoding.EncodeToString([]byte("<script>alert(1)</script>")), "type": "text/html"},
	}})
	h.call(admin, "store.new", map[string]any{"id": "cacher"})
	h.call(admin, "files.push", map[string]any{"store": "cacher", "files": files(map[string]string{"app.json": `{"title":"c","actor":"actor.js"}`,
		"actor.js": `defineActor({ http: {
  'GET /x/:id': { level: 'public', run: (ctx, req) => ({ asset: { from: 'source', id: req.params.id }, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }) },
  'GET /page': { level: 'public', run: () => ({ html: '<p>hi</p>', headers: { 'Cache-Control': 'public, max-age=600' } }) },
} });`})})
	h.call(admin, "store.new", map[string]any{"id": "cacher-1", "app": "cacher"})
	h.call(admin, "bind.set", map[string]any{"store": "cacher-1", "alias": "source", "target": "src", "assets": true})
	h.call(admin, "grant.set", map[string]any{"store": "src", "subject": "store:cacher-1", "level": "view"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/c/:id", "storeParam": "id"})
	if r, _ := h.get(live, "/c/cacher-1/x/pic"); r.StatusCode != 200 || r.Header.Get("Cache-Control") != cachePrivate {
		t.Fatalf("an upload through a store nobody anonymous may read: %d %q", r.StatusCode, r.Header.Get("Cache-Control"))
	}
	if r, _ := h.get(live, "/c/cacher-1/page"); r.StatusCode != 200 || r.Header.Get("Cache-Control") != cachePrivate {
		t.Fatalf("an actor page asking public caching on a private store: %d %q", r.StatusCode, r.Header.Get("Cache-Control"))
	}
	h.call(admin, "grant.set", map[string]any{"store": "cacher-1", "subject": "@guest", "level": "view"})
	if r, _ := h.get(live, "/c/cacher-1/page"); r.Header.Get("Cache-Control") != "public, max-age=600" {
		t.Fatalf("an actor page on a public store keeps its caching: %q", r.Header.Get("Cache-Control"))
	}
	if r, _ := h.get(live, "/c/cacher-1/x/pic"); r.Header.Get("Cache-Control") != cacheImmutable {
		t.Fatalf("an upload through a public store, asked immutable: %q", r.Header.Get("Cache-Control"))
	}
	// Uploads are not pages anywhere: the static host isolates them too.
	h.call(admin, "grant.set", map[string]any{"store": "src", "subject": "@guest", "level": "view"})
	r, _ := h.get(static, "/_s/src/assets/page.html")
	if r.StatusCode != 200 || r.Header.Get("Content-Security-Policy") != "sandbox; default-src 'none'" || r.Header.Get("Content-Disposition") != "attachment" {
		t.Fatalf("an uploaded page on the static host: %d csp %q disposition %q", r.StatusCode, r.Header.Get("Content-Security-Policy"), r.Header.Get("Content-Disposition"))
	}
}
