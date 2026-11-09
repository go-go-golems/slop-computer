package host

// SLOP3-015 view 14: the catalog shelf, a page-only app on the live host.
// Each person's stars are private (data/users/<id>/shelf); a person may
// share theirs (shelves/<id>), which everyone admitted reads and only its
// owner writes. The page sees ids (it declares user) and names (profile).

import (
	"testing"
)

func TestCatalogShelfApp(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	fs := append(appDir(t, "catalog-shelf"), map[string]any{"path": "data/catalog.json", "text": catalogFixture})
	h.call(admin, "store.new", map[string]any{"id": "catalog-shelf"})
	h.call(admin, "files.push", map[string]any{"store": "catalog-shelf", "files": fs})
	h.call(admin, "grant.set", map[string]any{"store": "catalog-shelf", "subject": "@guest", "level": "view"})
	h.call(admin, "grant.set", map[string]any{"store": "catalog-shelf", "subject": "@member", "level": "interact"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/catalog/shelf", "store": "catalog-shelf"})

	open := func(email string) (map[string]any, *site, string) {
		t.Helper()
		b, s := h.browser(), h.site(live)
		b.signIn(email)
		signInSite(t, h, s, b, live, "/catalog/shelf")
		st, v := openView(s, live, "/catalog/shelf", "")
		id, _ := v["user"].(string)
		if st != 200 || id == "" || v["level"] != "interact" {
			t.Fatalf("%s: view %d %v", email, st, v)
		}
		return v, s, id
	}
	va, sa, ada := open("ada@example.com")
	vb, sb, bob := open("bob@example.com")

	write := func(s *site, v map[string]any, path string, body map[string]any) map[string]any {
		return rpc(s, v, "db.write", map[string]any{"path": path, "op": "set", "body": body})
	}
	// Ada keeps two stars and shares her shelf.
	if out := write(sa, va, "data/users/"+ada+"/shelf", map[string]any{"stars": map[string]any{"weft": 1, "mimeo": 2}, "share": true}); out["error"] != nil {
		t.Fatalf("ada's shelf: %v", out)
	}
	if out := write(sa, va, "shelves/"+ada, map[string]any{"apps": []any{"mimeo", "weft"}, "at": 2}); out["error"] != nil {
		t.Fatalf("ada shares: %v", out)
	}
	// Bob reads her shared shelf, not her private one, and writes neither.
	if d := result(t, rpc(sb, vb, "db.get", map[string]any{"path": "shelves/" + ada})); d["exists"] != true {
		t.Fatalf("bob reads ada's shared shelf: %v", d)
	}
	if d := result(t, rpc(sb, vb, "db.get", map[string]any{"path": "data/users/" + ada + "/shelf"})); d["exists"] != false {
		t.Fatalf("bob reads ada's private shelf: %v", d)
	}
	if out := write(sb, vb, "shelves/"+ada, map[string]any{"apps": []any{"x"}}); out["error"] == nil {
		t.Fatalf("bob overwrote ada's shared shelf")
	}
	if out := write(sb, vb, "data/users/"+ada+"/shelf", map[string]any{"stars": map[string]any{}}); out["error"] == nil {
		t.Fatalf("bob overwrote ada's private shelf")
	}
	// Bob shares his own.
	if out := write(sb, vb, "shelves/"+bob, map[string]any{"apps": []any{"weft"}, "at": 3}); out["error"] != nil {
		t.Fatalf("bob shares: %v", out)
	}
	if d := privateDoc(t, h, "catalog-shelf", "data/users/"+ada+"/shelf"); d == nil || d["share"] != true {
		t.Fatalf("ada's private shelf in the store: %v", d)
	}
	// A guest sees the page, but no data: no id, and no shared shelves.
	g := h.site(live)
	st, vg := openView(g, live, "/catalog/shelf", "")
	if st != 200 {
		t.Fatalf("guest view: %d %v", st, vg)
	}
	if out := rpc(g, vg, "db.write", map[string]any{"path": "shelves/x", "op": "set", "body": map[string]any{"apps": []any{}}}); out["error"] == nil {
		t.Fatalf("a guest wrote a shelf")
	}
}
