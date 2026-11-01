package server

import (
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop/pkg/apps"
	"github.com/go-go-golems/slop/pkg/config"
)

// A static site whose app.json names a notFound page has no client-side
// routes: a missing path gets that page with a 404, a present one is
// served as usual.
func TestStaticNotFoundPage(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	static := h.cfg.Hosts.Static[0]
	h.call(admin, "store.new", map[string]any{"id": "lab"})
	h.call(admin, "files.push", map[string]any{"store": "lab", "files": files(map[string]string{
		"app.json":             `{"title": "Lab", "notFound": "404.html"}`,
		"index.html":           `<h1>Lab</h1>`,
		"404.html":             `<h1>Nothing here</h1>`,
		"journal/index.html":   `<h1>Journal</h1>`,
		"journal/a/index.html": `<h1>Post A</h1>`,
	})})
	h.call(admin, "mount.set", map[string]any{"host": static, "path": "/", "store": "lab"})
	h.call(admin, "grant.set", map[string]any{"store": "lab", "subject": "@guest", "level": "view"})

	if r, body := h.get(static, "/"); r.StatusCode != 200 || body != "<h1>Lab</h1>" {
		t.Fatalf("root: %d %q", r.StatusCode, body)
	}
	if r, body := h.get(static, "/journal/a/"); r.StatusCode != 200 || body != "<h1>Post A</h1>" {
		t.Fatalf("post: %d %q", r.StatusCode, body)
	}
	for _, p := range []string{"/journal/b", "/press", "/missing.png"} {
		r, body := h.get(static, p)
		if r.StatusCode != 404 || !strings.Contains(body, "Nothing here") || r.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: %d %q %q", p, r.StatusCode, body, r.Header.Get("Cache-Control"))
		}
	}
	// A notFound that leaves the tree breaks the manifest.
	if _, err := apps.Parse([]byte(`{"notFound": "../x.html"}`)); err == nil {
		t.Fatal("a notFound outside the tree must be refused")
	}
}

// A room's peers are the views with a stream attached: when a page goes
// away (its stream ends) the others hear it leave at once, not when the
// view is swept IdleGrace later.
func TestPresenceLeavesWithStream(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "board"})
	h.call(admin, "files.push", map[string]any{"store": "board", "files": files(map[string]string{
		"app.json":   `{"title":"Board","type":"board","capabilities":{"room":{}}}`,
		"index.html": `<!doctype html><title>b</title>board`,
	})})
	h.call(admin, "store.new", map[string]any{"id": "board-1", "app": "board", "type": "board"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/b/:id", "storeParam": "id", "type": "board"})
	h.call(admin, "grant.set", map[string]any{"store": "board-1", "subject": "@guest", "level": "interact"})

	a, b := h.site(live), h.site(live)
	_, va := openView(a, live, "/b/board-1", "")
	_, vb := openView(b, live, "/b/board-1", "")
	sb := openStream(t, b, vb)
	sa := openStream(t, a, va)
	rpc(b, vb, "room.presence", map[string]any{"patch": map[string]any{"page": "home"}})
	rpc(a, va, "room.presence", map[string]any{"patch": map[string]any{"page": "home"}})

	// count waits for a peers event listing n peers.
	count := func(n int) {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			ev := sb.next(t, "peers", time.Until(deadline))
			if peers, _ := ev["peers"].([]any); len(peers) == n {
				return
			}
		}
		t.Fatalf("no peers event with %d peers", n)
	}
	count(2)
	sa.resp.Body.Close()
	count(1)
}

// guests_per_hour replaces the default limit of new guests per address.
func TestGuestsPerHourConfig(t *testing.T) {
	h := newHarnessWith(t, func(c *config.Config) { c.GuestsPerHour = 2 })
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "open"})
	h.call(admin, "files.push", map[string]any{"store": "open", "files": files(map[string]string{
		"app.json": `{"title":"Open","capabilities":{"db":{}}}`, "index.html": "<!doctype html><title>o</title>"})})
	h.call(admin, "grant.set", map[string]any{"store": "open", "subject": "@guest", "level": "interact"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/open", "store": "open"})
	for i := 0; i < 2; i++ {
		if st, v := openView(h.site(live), live, "/open", ""); st != 200 {
			t.Fatalf("guest %d: %d %v", i, st, v)
		}
	}
	if st, v := openView(h.site(live), live, "/open", ""); st != 429 {
		t.Fatalf("third guest: %d %v", st, v)
	}
}
