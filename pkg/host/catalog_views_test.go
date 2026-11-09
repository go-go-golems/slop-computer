package host

// SLOP3-015: the catalog views are static stores on nested mounts of the
// static host: /catalog (the kit and the data), and /catalog/list,
// /catalog/table, /catalog/sheet, /catalog/caps, /catalog/zine,
// /catalog/timeline, /catalog/treemap, /catalog/roulette, /catalog/term and
// /catalog/desktop and /catalog/agents (one view each). The most specific mount answers, every page reaches the shared kit
// and views.json on the same origin, and no app runtime is involved. The
// catalog itself is catalog-data's (SLOP3-018), on the live host: the
// static stores hold no copy of it.

import (
	"strings"
	"testing"
)

func TestCatalogViewsOnStaticHost(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	static := h.cfg.Hosts.Static[0]
	catalog := appDir(t, "catalog")
	catalog = append(catalog,
		map[string]any{"path": "data/views.json", "text": `[{"id":"list","title":"Index","path":"/catalog/list/"}]`})
	for _, s := range []struct {
		id, mount string
		files     []any
	}{
		{"catalog", "/catalog", catalog},
		{"catalog-list", "/catalog/list", appDir(t, "catalog-list")},
		{"catalog-table", "/catalog/table", appDir(t, "catalog-table")},
		{"catalog-sheet", "/catalog/sheet", appDir(t, "catalog-sheet")},
		{"catalog-caps", "/catalog/caps", appDir(t, "catalog-caps")},
		{"catalog-zine", "/catalog/zine", appDir(t, "catalog-zine")},
		{"catalog-timeline", "/catalog/timeline", appDir(t, "catalog-timeline")},
		{"catalog-treemap", "/catalog/treemap", appDir(t, "catalog-treemap")},
		{"catalog-roulette", "/catalog/roulette", appDir(t, "catalog-roulette")},
		{"catalog-term", "/catalog/term", appDir(t, "catalog-term")},
		{"catalog-desktop", "/catalog/desktop", appDir(t, "catalog-desktop")},
		{"catalog-agents", "/catalog/agents", appDir(t, "catalog-agents")},
	} {
		h.call(admin, "store.new", map[string]any{"id": s.id})
		h.call(admin, "files.push", map[string]any{"store": s.id, "files": s.files})
		h.call(admin, "grant.set", map[string]any{"store": s.id, "subject": "@guest", "level": "view"})
		h.call(admin, "mount.set", map[string]any{"host": static, "path": s.mount, "store": s.id})
	}

	for path, want := range map[string]string{
		"/catalog/":                "One catalog, several ways to look at it.",
		"/catalog/list/":           "<title>Index — slop catalog</title>",
		"/catalog/table/":          "<title>Table — slop catalog</title>",
		"/catalog/sheet/":          "<title>Contact sheet — slop catalog</title>",
		"/catalog/caps/":           "<title>Capabilities — slop catalog</title>",
		"/catalog/zine/":           "<title>Zine — slop catalog</title>",
		"/catalog/timeline/":       "<title>Timeline — slop catalog</title>",
		"/catalog/treemap/":        "<title>Sizes — slop catalog</title>",
		"/catalog/roulette/":       "<title>Roulette — slop catalog</title>",
		"/catalog/term/":           "<title>Terminal — slop catalog</title>",
		"/catalog/desktop/":        "<title>Desktop — slop catalog</title>",
		"/catalog/agents/":         "<title>Agents — slop catalog</title>",
		"/catalog/kit/views.js":    "palette",
		"/catalog/kit/views.css":   ".cv-viewer",
		"/catalog/data/views.json": `"id":"list"`,
	} {
		r, body := h.get(static, path)
		if r.StatusCode != 200 || !strings.Contains(body, want) {
			t.Errorf("%s: %d, want %q in %.120q", path, r.StatusCode, want, body)
		}
		// Static pages: files only, no runtime injected.
		if strings.Contains(body, "/_slop/claude.js") {
			t.Errorf("%s: an app runtime was injected", path)
		}
	}
	// Each view loads the shared kit from the catalog mount.
	for _, path := range []string{"/catalog/list/", "/catalog/table/", "/catalog/sheet/", "/catalog/caps/", "/catalog/zine/",
		"/catalog/timeline/", "/catalog/treemap/", "/catalog/roulette/", "/catalog/term/", "/catalog/desktop/", "/catalog/agents/"} {
		if _, body := h.get(static, path); !strings.Contains(body, `src="/catalog/kit/views.js"`) {
			t.Errorf("%s does not load the kit", path)
		}
	}
	// The kit and the links read the catalog from catalog-data's routes.
	for path, want := range map[string]string{
		"/catalog/kit/views.js": `fetch(API + "/catalog.json")`,
		"/catalog/timeline/":    `href="https://apps.slop.yolo.scapegoat.dev/catalog/api/feed.xml"`,
		"/catalog/agents/":      `href="https://apps.slop.yolo.scapegoat.dev/catalog/api/llms.txt"`,
	} {
		if _, body := h.get(static, path); !strings.Contains(body, want) {
			t.Errorf("%s: no %s", path, want)
		}
	}
	// A mount root without its slash goes to the slash (relative URLs).
	if r, _ := h.get(static, "/catalog/list"); r.StatusCode != 308 || r.Header.Get("Location") != "/catalog/list/" {
		t.Errorf("/catalog/list: %d %q", r.StatusCode, r.Header.Get("Location"))
	}
	// Without @guest view the static host shows nothing.
	h.call(admin, "grant.rm", map[string]any{"store": "catalog-table", "subject": "@guest"})
	if r, _ := h.get(static, "/catalog/table/"); r.StatusCode != 404 {
		t.Errorf("/catalog/table/ without a guest grant: %d", r.StatusCode)
	}
}
