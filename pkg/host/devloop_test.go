package host

import (
	"strings"
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

// C.2: files.push {activate} brings the listed stores up on the new
// snapshot and reports each, so a dev loop learns at once that a
// migration failed, while the instance keeps serving its last good version.
func TestPushActivates(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	app := devApp()
	h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app)})
	h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app), "ref": "draft"})
	h.call(admin, "store.new", map[string]any{"id": "jot-dev", "app": "jot", "type": "jot"})
	h.call(admin, "app.follow", map[string]any{"store": "jot-dev", "ref": "draft"})

	activated := func(out any) map[string]any {
		t.Helper()
		l, _ := out.(map[string]any)["activated"].([]any)
		if len(l) != 2 {
			t.Fatalf("activated = %v, want 2 entries", out)
		}
		if e, _ := l[1].(map[string]any)["error"].(string); e == "" {
			t.Fatalf("an unknown store reports no error: %v", l[1])
		}
		return l[0].(map[string]any)
	}

	// A good migration: the dev instance is on the new snapshot.
	app["sql/002_tags.sql"] = `CREATE TABLE tags (note TEXT, tag TEXT);`
	out := h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app), "ref": "draft", "activate": []string{"jot-dev", "nope"}})
	n := num(out.(map[string]any)["n"])
	a := activated(out)
	if a["store"] != "jot-dev" || a["ref"] != "draft" || num(a["n"]) != n || a["broken"] != "" {
		t.Fatalf("activated[0] = %v, want jot-dev on draft at %d, not broken", a, n)
	}
	if got := fmtAny(h.call(admin, "actor.call", map[string]any{"store": "jot-dev", "action": "tables"})); got != `["notes","tags"]` {
		t.Fatalf("dev tables = %s", got)
	}

	// A broken migration: reported, and the instance keeps the good version.
	app["sql/003_bad.sql"] = `CREATE TABL oops (x);`
	out = h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app), "ref": "draft", "activate": []string{"jot-dev", "nope"}})
	a = activated(out)
	if b, _ := a["broken"].(string); !strings.Contains(b, "003_bad") {
		t.Fatalf("broken = %q, want the failing migration named", a["broken"])
	}
	if num(a["n"]) != n {
		t.Fatalf("n = %v, want the last good snapshot %d", a["n"], n)
	}
	if got := fmtAny(h.call(admin, "actor.call", map[string]any{"store": "jot-dev", "action": "tables"})); got != `["notes","tags"]` {
		t.Fatalf("dev tables after a failed migration = %s", got)
	}
}
