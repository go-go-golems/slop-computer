package server

import "testing"

// SLOP3-006: an app store made without a type joins a typed parameter
// mount once an admin sets its type, so one /f/:id mount serves every
// imported app instead of one exact mount each.
func TestStoreTypeJoinsTypedMount(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	adminNoScope := h.tokenFor("admin@example.com", "read", "write")
	member := h.tokenFor("member@example.com", "read", "write")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "orrery"})
	h.call(admin, "files.push", map[string]any{"store": "orrery", "files": files(map[string]string{
		"app.json":   `{"title":"Orrery","capabilities":{"db":{}}}`,
		"index.html": `<!doctype html><title>o</title>orrery`,
	})})
	h.call(admin, "grant.set", map[string]any{"store": "orrery", "subject": "@guest", "level": "interact"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/f/:id", "storeParam": "id", "type": "release"})

	guest := h.site(live)
	if st, _ := openView(guest, live, "/f/orrery", ""); st == 200 {
		t.Fatal("an untyped store must not be served by a typed mount")
	}

	h.fail(member, "store.type", map[string]any{"id": "orrery", "type": "release"}, "permission_denied")
	h.fail(adminNoScope, "store.type", map[string]any{"id": "orrery", "type": "release"}, "permission_denied")
	h.fail(admin, "store.type", map[string]any{"id": "nope", "type": "release"}, "not_found")

	row := h.call(admin, "store.type", map[string]any{"id": "orrery", "type": "release"}).(map[string]any)
	if row["type"] != "release" {
		t.Fatalf("store.type returned %v", row)
	}
	meta := h.call(admin, "store.meta", map[string]any{"id": "orrery"}).(map[string]any)
	if m, _ := meta["meta"].(map[string]any); m["type"] != "release" {
		t.Fatalf("store meta type: %v", meta["meta"])
	}
	if st, v := openView(guest, live, "/f/orrery", ""); st != 200 {
		t.Fatalf("typed store through /f/:id: %d %v", st, v)
	}
	// Setting it again changes nothing; clearing takes it off the mount.
	h.call(admin, "store.type", map[string]any{"id": "orrery", "type": "release"})
	h.call(admin, "store.type", map[string]any{"id": "orrery", "type": ""})
	if st, _ := openView(h.site(live), live, "/f/orrery", ""); st == 200 {
		t.Fatal("a cleared type must leave the typed mount")
	}
}
