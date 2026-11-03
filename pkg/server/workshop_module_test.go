package server

// Tests from SLOP3-002 phase W4 (the workshop module); formerly w4_test.go.

import (
	"strings"
	"testing"
	"time"
)

const benchActor = `
const ws = use('workshop');
defineActor({
  actions: {
    async push(ctx, { store, text }) { return await ws.push(store, [{ path: 'index.html', text }], { message: 'from the bench' }); },
    async publish(ctx, { store, n }) { return await ws.publish(store, n); },
    async refs(ctx, { store }) { return await ws.refs(store); },
    async read(ctx, { store, at, path }) { return await ws.read(store, at, path); },
    async follow(ctx, { store, ref }) { return await ws.follow(store, ref); },
  },
});
`

// W4 exit: pushing to draft through the workshop module leaves what the
// mount serves alone and publish moves main; log.wait returns on a commit
// and times out empty; a scratch instance follows draft and runs its
// migration.
func TestWorkshopModule(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	static := h.cfg.Hosts.Static[0]
	toolApp(t, h, admin, "bench", benchActor, "workshop")
	h.call(admin, "app.trust", map[string]any{"app": "bench", "module": "workshop"})
	call := func(action string, args map[string]any) any {
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args})
	}

	h.call(admin, "store.new", map[string]any{"id": "site"})
	h.call(admin, "files.push", map[string]any{"store": "site", "files": files(map[string]string{"index.html": "<h1>one</h1>"})})
	h.call(admin, "grant.set", map[string]any{"store": "site", "subject": "@guest", "level": "view"})
	h.call(admin, "mount.set", map[string]any{"host": static, "path": "/site", "store": "site"})
	serves := func() string { _, body := h.get(static, "/site/"); return body }

	pushed := call("push", map[string]any{"store": "site", "text": "<h1>two</h1>"}).(map[string]any)
	n := pushed["n"]
	if !strings.Contains(serves(), "one") {
		t.Fatalf("draft push changed the site: %s", serves())
	}
	if got := call("read", map[string]any{"store": "site", "at": "draft", "path": "index.html"}); !strings.Contains(fmtAny(got), "two") {
		t.Fatalf("draft read = %v", got)
	}
	refs := fmtAny(call("refs", map[string]any{"store": "site"}))
	if !strings.Contains(refs, `"draft"`) || !strings.Contains(refs, `"main"`) {
		t.Fatalf("refs = %s", refs)
	}
	call("publish", map[string]any{"store": "site", "n": n})
	if !strings.Contains(serves(), "two") {
		t.Fatalf("publish did not move main: %s", serves())
	}

	// log.wait: a commit wakes it; nothing times out with an empty list.
	head := h.call(admin, "log.show", map[string]any{"store": "site", "limit": 1}).([]any)[0].(map[string]any)["rev"]
	done := make(chan []any, 1)
	go func() {
		_, out := api(t, h, admin, "log.wait", map[string]any{"store": "site", "after": head, "timeout": 10})
		l, _ := out["result"].([]any)
		done <- l
	}()
	time.Sleep(100 * time.Millisecond)
	start := time.Now()
	h.call(admin, "docs.set", map[string]any{"store": "site", "path": "notes/a", "data": map[string]any{"x": 1}})
	select {
	case l := <-done:
		if len(l) != 1 || time.Since(start) > 2*time.Second {
			t.Fatalf("log.wait = %v after %v", l, time.Since(start))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("log.wait did not return on a commit")
	}
	start = time.Now()
	if l := h.call(admin, "log.wait", map[string]any{"store": "site", "after": head.(float64) + 1, "timeout": 1}).([]any); len(l) != 0 || time.Since(start) < 900*time.Millisecond {
		t.Fatalf("log.wait timeout = %v after %v", l, time.Since(start))
	}

	// A scratch instance follows the app's draft and runs its migration.
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	app := map[string]string{
		"app.json":    `{"title":"Jot","actor":"actor.js","type":"jot"}`,
		"actor.js":    `defineActor({ actions: { tables(ctx) { return use('sql').all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name").map(r => r.name); } } });`,
		"sql/001.sql": `CREATE TABLE notes (id TEXT PRIMARY KEY);`,
		"index.html":  "<title>jot</title>",
	}
	h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app)})
	h.call(admin, "store.new", map[string]any{"id": "jot-scratch", "app": "jot", "type": "jot"})
	tables := func(store string) string {
		return fmtAny(h.call(admin, "actor.call", map[string]any{"store": store, "action": "tables"}))
	}
	if got := tables("jot-scratch"); got != `["notes"]` {
		t.Fatalf("scratch on main: %s", got)
	}
	app["sql/002_tags.sql"] = `CREATE TABLE tags (note TEXT, tag TEXT);`
	h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app), "ref": "draft"})
	h.fail(admin, "app.follow", map[string]any{"store": "jot-scratch", "ref": "nope"}, "not_found")
	f := call("follow", map[string]any{"store": "jot-scratch", "ref": "draft"}).(map[string]any)
	if f["ref"] != "draft" || f["broken"] != "" {
		t.Fatalf("follow = %v", f)
	}
	if got := tables("jot-scratch"); got != `["notes","tags"]` {
		t.Fatalf("scratch on draft: %s", got)
	}
	if got := tables("jot"); got != `["notes"]` {
		t.Fatalf("the app itself still runs main: %s", got)
	}
	if st := h.call(admin, "app.status", map[string]any{"store": "jot-scratch"}).(map[string]any); st["ref"] != "draft" {
		t.Fatalf("app.status = %v", st)
	}
}
