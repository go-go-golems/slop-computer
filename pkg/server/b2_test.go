package server

import (
	"strings"
	"testing"
)

// installBlocksSite pushes apps/blocks-site and makes a site bound to a
// workspace, readable by the site (the publishing decision).
func installBlocksSite(t *testing.T, h *harness, admin string) {
	t.Helper()
	h.call(admin, "store.new", map[string]any{"id": "blocks-site"})
	h.call(admin, "files.push", map[string]any{"store": "blocks-site", "files": appDir(t, "blocks-site")})
	if st := h.call(admin, "app.status", map[string]any{"store": "blocks-site"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("blocks-site is broken: %v", st)
	}
}

func blocksSite(t *testing.T, h *harness, token, id, workspace string) {
	t.Helper()
	h.call(token, "store.new", map[string]any{"id": id, "app": "blocks-site", "type": "blocks-site"})
	h.call(token, "bind.set", map[string]any{"store": id, "alias": "source", "target": workspace})
	h.call(token, "grant.set", map[string]any{"store": workspace, "subject": "store:" + id, "level": "view"})
}

// B2 exit: the live reader. A guest reads a site only with a grant on the
// site (never on the workspace); pages are the workspace as it is now;
// nothing of the log leaks; settings scope the site; the reader also
// answers on the static host.
func TestBlocksSiteReader(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live, static := h.cfg.Hosts.Live[0], h.cfg.Hosts.Static[0]
	blocksWorkspace(t, h, admin, "ws-weft")
	installBlocksSite(t, h, admin)
	blocksSite(t, h, admin, "weft-site", "ws-weft")
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/pub/:id", "storeParam": "id", "type": "blocks-site"})

	if res, _ := h.get(live, "/pub/weft-site/"); res.StatusCode != 404 {
		t.Fatalf("without a grant on the site, a guest gets %d", res.StatusCode)
	}
	h.call(admin, "grant.set", map[string]any{"store": "weft-site", "subject": "@guest", "level": "view"})
	res, home := h.get(live, "/pub/weft-site/")
	if res.StatusCode != 200 || !strings.Contains(home, `<span class="pi">🧶</span>Weft</h1>`) || !strings.Contains(home, "Mallory was here") {
		t.Fatalf("home = %d\n%s", res.StatusCode, home)
	}
	if csp := res.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'none'") || strings.Contains(csp, "script") {
		t.Fatalf("CSP = %q", csp)
	}
	for _, gone := range []string{"OLD INTRO TEXT", "FORGED", "STALE CHUNK", "op00", "chunks/", "usr_ada", "<script", "Settings and publishing"} {
		if strings.Contains(home, gone) {
			t.Errorf("the reader shows %q to a guest", gone)
		}
	}
	// Links are absolute, under the mount; without a scope every page is published.
	if !strings.Contains(home, `href="/pub/weft-site/care"`) || !strings.Contains(home, `<a class="mention" href="/pub/weft-site/drafts">Drafts</a>`) {
		t.Fatalf("home links:\n%s", home)
	}
	if res, body := h.get(live, "/pub/weft-site/care"); res.StatusCode != 200 || !strings.Contains(body, "Wash cold. Dry flat.") {
		t.Fatalf("care = %d %s", res.StatusCode, body)
	}
	if res, _ := h.get(live, "/pub/weft-site/weft"); res.StatusCode != 302 || res.Header.Get("Location") != "/pub/weft-site/" {
		t.Fatalf("the home page's slug answers %d → %q", res.StatusCode, res.Header.Get("Location"))
	}
	for _, p := range []string{"/pub/weft-site/nope", "/pub/weft-site/care/deeper"} {
		if res, _ := h.get(live, p); res.StatusCode != 404 {
			t.Fatalf("%s answers %d", p, res.StatusCode)
		}
	}

	// An edit in the workspace shows on the next request; a page id goes to its slug.
	h.call(admin, "docs.set", map[string]any{"store": "ws-weft", "path": "chunks/c-z-0", "data": map[string]any{
		"at": 1793600100000, "n": 3, "ops": []any{
			[]any{"z1", "uz:you", 900, `faq.ui.1 is p "NEW ANSWER"`, 1793600100000},
			[]any{"z2", "uz:you", 901, `p_x1.title = "Getting started"`, 1793600100000},
			[]any{"z3", "uz:you", 902, `p_x1.parent = "weft"`, 1793600100000},
		}}})
	if _, body := h.get(live, "/pub/weft-site/faq"); !strings.Contains(body, "NEW ANSWER") {
		t.Fatalf("faq after the edit:\n%s", body)
	}
	if res, _ := h.get(live, "/pub/weft-site/p_x1"); res.StatusCode != 302 || res.Header.Get("Location") != "/pub/weft-site/getting-started" {
		t.Fatalf("a page id answers %d → %q", res.StatusCode, res.Header.Get("Location"))
	}

	// Scope: only weft and its sub-pages; drafts is not found, and its mention loses link and title.
	h.call(admin, "docs.set", map[string]any{"store": "weft-site", "path": "site/config", "data": map[string]any{"root": "weft", "title": "Weft Yarns"}})
	if res, _ := h.get(live, "/pub/weft-site/drafts"); res.StatusCode != 404 {
		t.Fatalf("a page outside the scope answers %d", res.StatusCode)
	}
	if _, body := h.get(live, "/pub/weft-site/"); !strings.Contains(body, `Unpublished: <span class="mention">drafts</span>`) ||
		strings.Contains(body, "Drafts") || !strings.Contains(body, `<a class="brand" href="/pub/weft-site/">Weft Yarns</a>`) {
		t.Fatalf("scoped home:\n%s", body)
	}

	// The same site on the static host: sessionless, as a guest.
	h.call(admin, "mount.set", map[string]any{"host": static, "path": "/r/:id", "storeParam": "id", "type": "blocks-site"})
	if res, body := h.get(static, "/r/weft-site/care"); res.StatusCode != 200 || !strings.Contains(body, `href="/r/weft-site/"`) {
		t.Fatalf("static host = %d\n%s", res.StatusCode, body)
	}

	// A site that cannot read its workspace says so, without details for guests.
	h.call(admin, "store.new", map[string]any{"id": "lost-site", "app": "blocks-site", "type": "blocks-site"})
	h.call(admin, "grant.set", map[string]any{"store": "lost-site", "subject": "@guest", "level": "view"})
	if res, body := h.get(live, "/pub/lost-site/"); res.StatusCode != 503 || !strings.Contains(body, "not available") || strings.Contains(body, "binding") {
		t.Fatalf("an unbound site = %d %s", res.StatusCode, body)
	}
}
