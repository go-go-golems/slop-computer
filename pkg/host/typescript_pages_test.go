package host

import (
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/tscompile"
)

// tsApp is an app written in TypeScript, with two vendored names; caps
// makes it a live app (the static host serves only sites). clip.ts is not
// code: a video (an MPEG transport stream starts with 0x47).
func tsApp(caps string) []any {
	app := files(map[string]string{
		"app.json":         `{"title":"TS",` + caps + `"slop":{"imports":{"page":{"preact":"vendor/preact.js","preact/jsx-runtime":"vendor/jsx-runtime.js"}}}}`,
		"index.html":       `<!doctype html><html><head><title>t</title></head><body><script type="module" src="main.ts"></script></body></html>`,
		"about.html":       `<!doctype html><html><head><title>a</title></head><body>about</body></html>`,
		"docs/index.html":  `<!doctype html><html><head><title>d</title></head><body>docs</body></html>`,
		"main.ts":          "import { slug } from './lib/text.ts'\nexport const title: string = slug('Hello World')\n",
		"lib/text.ts":      "export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')\n",
		"hello.tsx":        "export const Hello = ({ name }: { name: string }) => <p>Hello {name}</p>\n",
		"broken.ts":        "const rows = await list(\nexport {}\n",
		"types.d.ts":       "declare const x: number\n",
		"tsconfig.json":    `{"compilerOptions": {"jsx": "react-jsx", "jsxImportSource": "preact"}}`,
		"vendor/preact.js": "export const h = 1\n",
	})
	return append(app, map[string]any{"path": "clip.ts", "data": base64.StdEncoding.EncodeToString([]byte{0x47, 0x40, 0x00, 0xff, 0xfe})})
}

// checkTSFiles checks the files of tsApp served under base on host: what
// every route that serves an app's pages must do.
func checkTSFiles(t *testing.T, h *harness, host, base string) {
	t.Helper()
	get := func(p string) (*http.Response, string) { return h.get(host, base+p) }

	r, body := get("main.ts")
	if r.StatusCode != 200 || r.Header.Get("Content-Type") != "text/javascript; charset=utf-8" ||
		!strings.Contains(body, `import { slug } from "./lib/text.ts"`) || strings.Contains(body, ": string") ||
		!strings.HasSuffix(body, "//# sourceMappingURL=main.ts.map\n") {
		t.Fatalf("%s%s main.ts: %d %q\n%s", host, base, r.StatusCode, r.Header.Get("Content-Type"), body)
	}
	etag := r.Header.Get("ETag")
	if !strings.Contains(etag, tscompile.Version) || r.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("main.ts headers: %v", r.Header)
	}
	req, _ := http.NewRequest("GET", h.ts.URL+base+"main.ts", nil)
	req.Host, req.Header = host, http.Header{"If-None-Match": {etag}}
	if r, err := http.DefaultClient.Do(req); err != nil || r.StatusCode != 304 {
		t.Fatalf("revalidation: %v %v", r, err)
	}
	if r, body := get("main.ts.map"); r.StatusCode != 200 || r.Header.Get("Content-Type") != "application/json" || !strings.Contains(body, `"main.ts"`) {
		t.Fatalf("main.ts.map: %d %s", r.StatusCode, body)
	}
	if _, body := get("lib/text.ts"); !strings.Contains(body, "const slug = (s) =>") || strings.Contains(body, ": string") {
		t.Fatalf("lib/text.ts:\n%s", body)
	}
	if _, body := get("hello.tsx"); !strings.Contains(body, `from "preact/jsx-runtime"`) {
		t.Fatalf("hello.tsx does not follow tsconfig.json:\n%s", body)
	}
	if r, body := get("broken.ts"); r.StatusCode != 200 || !strings.HasPrefix(body, `throw new SyntaxError("broken.ts:2:1: `) {
		t.Fatalf("broken.ts: %d %s", r.StatusCode, body)
	}
	if r, body := get("types.d.ts"); r.Header.Get("Content-Type") != "text/typescript; charset=utf-8" || body != "declare const x: number\n" {
		t.Fatalf("types.d.ts is a declaration, served as stored: %q %q", r.Header.Get("Content-Type"), body)
	}
	if _, body := get("clip.ts"); body != "\x47\x40\x00\xff\xfe" {
		t.Fatalf("clip.ts is not text, served as stored: %q", body)
	}
	if _, body := get("nothing.ts.map"); strings.Contains(body, "mappings") {
		t.Fatalf("a map for a file that does not exist: %s", body)
	}
	importMap := `<script type="importmap">{"imports":{"preact":"` + base + `vendor/preact.js","preact/jsx-runtime":"` + base + `vendor/jsx-runtime.js"}}</script>`
	if _, body := get("about.html"); !strings.Contains(body, importMap) {
		t.Fatalf("about.html has no import map %s:\n%s", importMap, body)
	}
	// A directory's page, by its slash: the map resolves against the app's
	// root, not the directory.
	if r, body := get("docs/"); r.StatusCode != 200 || !strings.Contains(body, importMap) {
		t.Fatalf("docs/ (%d) has no import map %s:\n%s", r.StatusCode, importMap, body)
	}
}

// SLOP3-024 phase 0: the routes that serve an app's pages (the sandbox,
// the static host, previews) serve .ts and .tsx compiled, with source maps,
// and give HTML the import map of the app's vendored packages. Store files
// (/_s/) are served as stored.
func TestTypeScriptPages(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live, static := h.cfg.Hosts.Live[0], h.cfg.Hosts.Static[0]
	h.call(admin, "store.new", map[string]any{"id": "tsapp"})
	h.call(admin, "files.push", map[string]any{"store": "tsapp", "files": tsApp(`"capabilities":{"db":{}},`)})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/ts", "store": "tsapp"})
	h.call(admin, "grant.set", map[string]any{"store": "tsapp", "subject": "@guest", "level": "interact"})
	h.call(admin, "store.new", map[string]any{"id": "tssite"})
	h.call(admin, "files.push", map[string]any{"store": "tssite", "files": tsApp("")})
	h.call(admin, "mount.set", map[string]any{"host": static, "path": "/ts", "store": "tssite"})
	h.call(admin, "grant.set", map[string]any{"store": "tssite", "subject": "@guest", "level": "view"})

	// The sandbox: the app's entry page carries the runtime and the import map.
	v := guestView(t, h.site(live), "/ts")
	u, _ := url.Parse(v["url"].(string))
	checkTSFiles(t, h, u.Host, u.Path)
	if _, body := h.get(u.Host, u.Path); !strings.Contains(body, `<script type="importmap">{"imports":{"preact":"`+u.Path+`vendor/preact.js"`) || !strings.Contains(body, "claude.js") {
		t.Fatalf("the entry page:\n%s", body)
	}
	// Store files are served as stored, even on the sandbox host.
	if r, body := h.get(u.Host, "/_s/tsapp/main/main.ts"); r.StatusCode != 200 || !strings.Contains(body, ": string") {
		t.Fatalf("/_s/ main.ts: %d %s", r.StatusCode, body)
	}

	// The static host serves a site (no capabilities) at its mount.
	checkTSFiles(t, h, static, "/ts/")
	if _, body := h.get(static, "/ts/"); !strings.Contains(body, `"preact":"/ts/vendor/preact.js"`) {
		t.Fatalf("the static entry page:\n%s", body)
	}

	// A preview serves the app at its host's root.
	pv := h.call(admin, "preview.url", map[string]any{"store": "tsapp", "at": "main", "parent": h.cfg.Origin(live)}).(map[string]any)
	ph := strings.TrimSuffix(strings.TrimPrefix(pv["url"].(string), h.cfg.Scheme+"://"), "/")
	checkTSFiles(t, h, ph, "/")
	if _, body := h.get(ph, "/"); !strings.Contains(body, `"preact":"/vendor/preact.js"`) || !strings.Contains(body, `"mode":"preview"`) {
		t.Fatalf("the preview's entry page:\n%s", body)
	}
}
