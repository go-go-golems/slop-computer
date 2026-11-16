package host

import (
	"testing"
)

// SLOP3-022: the server side of the bench's dev loop (draft, dev instances,
// publish). The design is ticket SLOP3-022's guide, Part 5 and Appendix C.

// A minimal app with an actor and one migration; draft adds a second one.
func devApp() map[string]string {
	return map[string]string{
		"app.json":    `{"title":"Jot","actor":"actor.js","type":"jot"}`,
		"actor.js":    `defineActor({ actions: { tables(ctx) { return use('sql').all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name").map(r => r.name); } } });`,
		"sql/001.sql": `CREATE TABLE notes (id TEXT PRIMARY KEY);`,
		"index.html":  "<title>jot</title>",
	}
}

// C.3: ref.move with ifAt is a compare-and-swap, so a publish cannot
// silently overwrite another one; the result says where the ref was.
func TestRefMoveIfAt(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	app := devApp()
	n1 := num(h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app)}).(map[string]any)["n"])
	app["sql/002_tags.sql"] = `CREATE TABLE tags (note TEXT, tag TEXT);`
	n2 := num(h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app), "ref": "draft"}).(map[string]any)["n"])

	// Publish draft: main is still at n1.
	out := h.call(admin, "ref.move", map[string]any{"store": "jot", "ref": "main", "n": n2, "ifAt": n1}).(map[string]any)
	if num(out["n"]) != n2 || num(out["from"]) != n1 {
		t.Fatalf("publish = %v, want n %d from %d", out, n2, n1)
	}
	// A second publisher who still believes main is at n1 is refused.
	e := h.fail(admin, "ref.move", map[string]any{"store": "jot", "ref": "main", "n": n1, "ifAt": n1}, "conflict")
	if e == nil {
		t.Fatal("stale ifAt: no error")
	}
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "jot"}).(map[string]any); num(refs["main"]) != n2 {
		t.Fatalf("main moved by a refused publish: %v", refs)
	}
	// ifAt 0: only if the ref does not exist yet.
	h.call(admin, "ref.move", map[string]any{"store": "jot", "ref": "release", "n": n1, "ifAt": 0})
	h.fail(admin, "ref.move", map[string]any{"store": "jot", "ref": "release", "n": n2, "ifAt": 0}, "conflict")
	// Without ifAt the move is unconditional, as before (a rollback).
	out = h.call(admin, "ref.move", map[string]any{"store": "jot", "ref": "main", "n": n1}).(map[string]any)
	if num(out["from"]) != n2 {
		t.Fatalf("rollback from = %v, want %d", out["from"], n2)
	}
}

func num(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case int64:
		return x
	case int:
		return int64(x)
	}
	return -1
}
