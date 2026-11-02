package server

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

// get fetches a path on a host without following redirects.
func (h *harness) get(host, path string) (*http.Response, string) {
	h.t.Helper()
	req, _ := http.NewRequest("GET", h.ts.URL+path, nil)
	req.Host = host
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := c.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(b)
}

func files(m map[string]string) []any {
	out := []any{}
	for p, t := range m {
		out = append(out, map[string]any{"path": p, "text": t})
	}
	return out
}

// The P2 exit test, first part: a static site serves on the static host
// with its relative CSS.
func TestStaticSite(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	static := h.cfg.Hosts.Static[0]
	h.call(admin, "store.new", map[string]any{"id": "weft"})
	h.call(admin, "files.push", map[string]any{"store": "weft", "files": files(map[string]string{
		"index.html":      `<link rel="stylesheet" href="style.css"><h1>Weft</h1><a href="docs/">docs</a>`,
		"style.css":       `h1 { color: teal }`,
		"docs/index.html": `<h1>Docs</h1>`,
		"img/a.svg":       `<svg xmlns="http://www.w3.org/2000/svg"/>`,
	})})
	out := h.call(admin, "mount.set", map[string]any{"host": static, "path": "/r/weft", "store": "weft"}).(map[string]any)
	if !strings.Contains(out["note"].(string), "@guest view") {
		t.Fatalf("expected a publishing note: %v", out)
	}
	// Not public yet: a static host serves guests only.
	if r, _ := h.get(static, "/r/weft/"); r.StatusCode != 404 {
		t.Fatalf("private site: %d", r.StatusCode)
	}
	h.call(admin, "grant.set", map[string]any{"store": "weft", "subject": "@guest", "level": "view"})

	r, _ := h.get(static, "/r/weft")
	if r.StatusCode != 308 || r.Header.Get("Location") != "/r/weft/" {
		t.Fatalf("no trailing-slash redirect: %d %s", r.StatusCode, r.Header.Get("Location"))
	}
	r, body := h.get(static, "/r/weft/")
	if r.StatusCode != 200 || !strings.Contains(body, "<h1>Weft</h1>") || r.Header.Get("Cache-Control") != cacheMoving {
		t.Fatalf("index: %d %q %s", r.StatusCode, body, r.Header.Get("Cache-Control"))
	}
	if len(r.Cookies()) != 0 {
		t.Fatal("a static host sets no cookies")
	}
	r, body = h.get(static, "/r/weft/style.css")
	if r.StatusCode != 200 || !strings.HasPrefix(r.Header.Get("Content-Type"), "text/css") || body != "h1 { color: teal }" {
		t.Fatalf("relative css: %d %s %q", r.StatusCode, r.Header.Get("Content-Type"), body)
	}
	etag := r.Header.Get("ETag")
	req, _ := http.NewRequest("GET", h.ts.URL+"/r/weft/style.css", nil)
	req.Host, req.Header = static, http.Header{"If-None-Match": {etag}}
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != 304 {
		t.Fatalf("conditional get: %d", resp.StatusCode)
	}
	if r, _ := h.get(static, "/r/weft/docs"); r.StatusCode != 308 {
		t.Fatalf("directory without slash: %d", r.StatusCode)
	}
	if r, body := h.get(static, "/r/weft/docs/"); r.StatusCode != 200 || body != "<h1>Docs</h1>" {
		t.Fatalf("docs: %d %q", r.StatusCode, body)
	}
	// Client routes get the entry page; missing files with extensions 404.
	if r, body := h.get(static, "/r/weft/some/route"); r.StatusCode != 200 || !strings.Contains(body, "Weft") {
		t.Fatalf("client route: %d", r.StatusCode)
	}
	if r, _ := h.get(static, "/r/weft/missing.png"); r.StatusCode != 404 {
		t.Fatalf("missing file: %d", r.StatusCode)
	}
	// A store's own files: immutable at a number, moving at a ref.
	if r, _ := h.get(static, "/_s/weft/1/img/a.svg"); r.StatusCode != 200 || r.Header.Get("Cache-Control") != cacheImmutable {
		t.Fatalf("/_s at 1: %d %s", r.StatusCode, r.Header.Get("Cache-Control"))
	}
	if r, _ := h.get(static, "/_s/weft/main/style.css"); r.Header.Get("Cache-Control") != cacheMoving {
		t.Fatalf("/_s at main: %s", r.Header.Get("Cache-Control"))
	}
	// A new push is served at once (the mount follows main).
	h.call(admin, "files.push", map[string]any{"store": "weft", "prune": false, "files": files(map[string]string{"style.css": "h1 { color: navy }"})})
	if _, body := h.get(static, "/r/weft/style.css"); body != "h1 { color: navy }" {
		t.Fatalf("after push: %q", body)
	}
	// Unknown paths and other stores are not found.
	if r, _ := h.get(static, "/nothing"); r.StatusCode != 404 {
		t.Fatalf("unmounted: %d", r.StatusCode)
	}

	// A :param mount serves any store of a type; mount undo restores.
	h.call(admin, "store.new", map[string]any{"id": "rel-1", "type": "release"})
	h.call(admin, "files.push", map[string]any{"store": "rel-1", "files": files(map[string]string{"index.html": "release one"})})
	h.call(admin, "grant.set", map[string]any{"store": "rel-1", "subject": "@guest", "level": "view"})
	h.call(admin, "mount.set", map[string]any{"host": static, "path": "/rel/:id", "storeParam": "id", "type": "release"})
	if _, body := h.get(static, "/rel/rel-1/"); body != "release one" {
		t.Fatalf(":param mount: %q", body)
	}
	if r, _ := h.get(static, "/rel/weft/"); r.StatusCode != 404 {
		t.Fatalf("wrong type served: %d", r.StatusCode)
	}
	h.call(admin, "mount.rm", map[string]any{"host": static, "path": "/r/weft"})
	if r, _ := h.get(static, "/r/weft/"); r.StatusCode != 404 {
		t.Fatalf("after rm: %d", r.StatusCode)
	}
	h.call(admin, "mount.undo", map[string]any{"host": static, "path": "/r/weft"})
	if r, _ := h.get(static, "/r/weft/"); r.StatusCode != 200 {
		t.Fatalf("after undo: %d", r.StatusCode)
	}

	// Host kinds: a live app is refused on a static host, plain content on a live one.
	h.call(admin, "store.new", map[string]any{"id": "board"})
	h.call(admin, "files.push", map[string]any{"store": "board", "files": files(map[string]string{
		"app.json": `{"title":"Board","capabilities":{"db":{}}}`, "index.html": "board"})})
	h.fail(admin, "mount.set", map[string]any{"host": static, "path": "/board", "store": "board"}, "invalid_argument")
	h.fail(admin, "mount.set", map[string]any{"host": h.cfg.Hosts.Live[0], "path": "/weft", "store": "weft"}, "invalid_argument")
	h.fail(admin, "mount.set", map[string]any{"host": h.cfg.Hosts.Main, "path": "/x", "store": "weft"}, "invalid_argument")
	st := h.call(admin, "app.status", map[string]any{"store": "board"}).(map[string]any)
	if m := st["manifest"].(map[string]any); m["title"] != "Board" || m["live"] != true {
		t.Fatalf("app.status = %v", st)
	}
}

// Decision D9: only admins push app code.
func TestOnlyAdminsPushAppCode(t *testing.T) {
	h := newHarness(t)
	bob := h.tokenFor("bob@example.com")
	h.call(bob, "store.new", map[string]any{"id": "bobs-site"})
	// Plain content is fine.
	h.call(bob, "files.push", map[string]any{"store": "bobs-site", "files": files(map[string]string{"index.html": "hi"})})
	// app.json is code.
	h.fail(bob, "files.push", map[string]any{"store": "bobs-site", "files": files(map[string]string{"index.html": "hi", "app.json": "{}"})}, "permission_denied")
	h.fail(bob, "files.put", map[string]any{"store": "bobs-site", "path": "app.json", "text": "{}"}, "permission_denied")
	// Content stores of an app's data are not code: a data store's assets are fine.
	h.call(bob, "files.put", map[string]any{"store": "bobs-site", "zone": "assets", "path": "a.txt", "text": "x"})
	// Nor through an import: a bundle whose tree holds app.json is code.
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "an-app"})
	h.call(admin, "files.push", map[string]any{"store": "an-app", "files": files(map[string]string{
		"app.json": `{"title":"A","actor":"actor.js"}`, "actor.js": "defineActor({})", "index.html": "hi"})})
	app := h.call(admin, "store.export", map[string]any{"id": "an-app"}).(map[string]any)
	h.fail(bob, "import.folder", map[string]any{"store": "bobs-app", "bundle": app["bundle"], "blobs": app["blobs"]}, "permission_denied")
	site := h.call(bob, "store.export", map[string]any{"id": "bobs-site"}).(map[string]any)
	h.call(bob, "import.folder", map[string]any{"store": "bobs-copy", "bundle": site["bundle"], "blobs": site["blobs"]})
	h.call(admin, "import.folder", map[string]any{"store": "app-copy", "bundle": app["bundle"], "blobs": app["blobs"]})
	// Nor through the bundle's schema: a trigger on a kernel table would run
	// inside the kernel's writes of the restored documents.
	inject := map[string]any{"meta": map[string]any{}, "docs": []any{map[string]any{"path": "notes/a", "body": map[string]any{"x": 1}}},
		"schema": []any{map[string]any{"type": "trigger", "name": "inject_code", "table": "_docs",
			"sql": "CREATE TRIGGER inject_code AFTER INSERT ON _docs BEGIN INSERT INTO _meta (key, value) VALUES ('app', 'evil'); END"}}}
	h.fail(bob, "import.folder", map[string]any{"store": "bobs-trigger", "bundle": inject}, "invalid_argument")
}

// A query's limit counts only documents the caller may read: the read
// rules apply first (docs.query, docs.ls), as they do for db.query.
func TestQueryLimitAfterReadRules(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com")
	h.call(admin, "store.new", map[string]any{"id": "ruled"})
	h.call(admin, "files.push", map[string]any{"store": "ruled", "files": files(map[string]string{
		"app.json":   `{"title":"R","capabilities":{"db":{"rules":[{"path":"notes/a","read":"admin","write":"admin"}]}}}`,
		"index.html": "x"})})
	h.call(admin, "grant.set", map[string]any{"store": "ruled", "subject": "@member", "level": "view"})
	h.call(admin, "docs.set", map[string]any{"store": "ruled", "path": "notes/a", "data": map[string]any{"n": 1}})
	h.call(admin, "docs.set", map[string]any{"store": "ruled", "path": "notes/b", "data": map[string]any{"n": 2}})
	for _, verb := range []string{"docs.query", "docs.ls"} {
		got := h.call(mia, verb, map[string]any{"store": "ruled", "coll": "notes", "limit": 1}).([]any)
		if len(got) != 1 || got[0].(map[string]any)["path"] != "notes/b" {
			t.Fatalf("%s limit 1 as a member: %v", verb, got)
		}
	}
	if got := h.call(admin, "docs.query", map[string]any{"store": "ruled", "coll": "notes", "limit": 1}).([]any); len(got) != 1 || got[0].(map[string]any)["path"] != "notes/a" {
		t.Fatalf("docs.query limit 1 as admin: %v", got)
	}
}
