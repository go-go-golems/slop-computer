package host

// SLOP3-012 phase 1: use('database') / require('database'), go-go-goja's
// database API over the actor's own store.

import (
	"testing"
)

const databaseActor = `
const db = require('database'), docs = use('db'), time = use('time');
const local = require('./database.js');
defineActor({
  actions: {
    empty() { return db.query('SELECT name FROM items WHERE 0'); },
    add(ctx, { name }) { return db.exec('INSERT INTO items (name) VALUES (?)', name); },
    two() { return db.query('SELECT ? AS a, ? AS b, ? AS c', [1, 2], true); },
    names() { return db.query('SELECT name FROM items ORDER BY id').map(r => r.name); },
    configure() { db.configure('sqlite3', '/etc/passwd'); },
    hijack() { db.exec('DELETE FROM _docs'); },
    attach() { db.exec("ATTACH DATABASE ':memory:' AS other"); },
    commit() { const tx = db.begin(); tx.exec('INSERT INTO items (name) VALUES (?)', 'kept'); return tx.commit(); },
    rollback() { const tx = db.begin(); tx.exec('INSERT INTO items (name) VALUES (?)', 'dropped'); return tx.rollback(); },
    leaveOpen() { const tx = db.begin(); tx.exec('INSERT INTO items (name) VALUES (?)', 'left-open'); return 1; },
    async acrossAwait() {
      const tx = db.begin();
      tx.exec('INSERT INTO items (name) VALUES (?)', 'before-await');
      await time.sleep(1);
      tx.exec('INSERT INTO items (name) VALUES (?)', 'after-await');
    },
    docWhileOpen() { db.begin(); docs.doc('notes/a').set({ x: 1 }); },
    nested() {
      const outer = db.begin(), inner = db.begin();
      inner.exec('INSERT INTO items (name) VALUES (?)', 'inner');
      outer.rollback();
      inner.commit();
    },
    failWithOpen() { const tx = db.begin(); tx.exec('INSERT INTO items (name) VALUES (?)', 'failed'); throw new Error('boom'); },
    same() { return require('database') === use('database') && db === use('database'); },
    local() { return local.x; },
  },
  on: {
    'table:items'(ctx, commit) {
      const cur = docs.doc('stats/items').get();
      docs.doc('stats/items').set({ commits: (cur.exists ? cur.data().commits : 0) + 1 });
    },
  },
});
`

func TestDatabaseModule(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "dbm"})
	h.call(admin, "files.push", map[string]any{"store": "dbm", "files": files(map[string]string{
		"app.json":          `{"title":"DB","actor":"actor.js"}`,
		"actor.js":          databaseActor,
		"database.js":       `module.exports = { x: 'tree file' };`,
		"sql/001_items.sql": "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
	})})
	if st := h.call(admin, "app.status", map[string]any{"store": "dbm"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("status = %v", st)
	}
	call := func(action string, args map[string]any) any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "dbm", "action": action, "args": args})
	}
	fails := func(action, code string) {
		t.Helper()
		h.fail(admin, "actor.call", map[string]any{"store": "dbm", "action": action}, code)
	}
	names := func() []any {
		t.Helper()
		return call("names", nil).([]any)
	}
	want := func(what string, got []any, w ...string) {
		t.Helper()
		if len(got) != len(w) {
			t.Fatalf("%s: %v, want %v", what, got, w)
		}
		for i := range w {
			if got[i] != w[i] {
				t.Fatalf("%s: %v, want %v", what, got, w)
			}
		}
	}

	// query and exec.
	if got := call("empty", nil).([]any); len(got) != 0 {
		t.Fatalf("empty = %v", got)
	}
	r := call("add", map[string]any{"name": "one"}).(map[string]any)
	if r["success"] != true || r["rowsAffected"] != 1.0 || r["lastInsertId"] != 1.0 {
		t.Fatalf("exec = %v", r)
	}
	// An array argument spreads into parameters (go-go-goja); booleans are 0/1.
	if got := call("two", nil).([]any); len(got) != 1 || got[0].(map[string]any)["a"] != 1.0 || got[0].(map[string]any)["b"] != 2.0 || got[0].(map[string]any)["c"] != 1.0 {
		t.Fatalf("two = %v", got)
	}

	// No other database, no kernel tables, no ATTACH.
	fails("configure", "permission_denied")
	fails("hijack", "actor_error")
	fails("attach", "actor_error")

	// begin: commit keeps, rollback discards, an open handle rolls back
	// at the end of its turn, and does not survive an await.
	call("commit", nil)
	call("rollback", nil)
	call("leaveOpen", nil)
	want("after commit, rollback, leaveOpen", names(), "one", "kept")
	fails("acrossAwait", "conflict")
	want("after acrossAwait", names(), "one", "kept")

	// Documents cannot change under an open handle.
	fails("docWhileOpen", "conflict")
	// Rolling back an outer handle ends the inner one too.
	fails("nested", "conflict")
	want("after nested", names(), "one", "kept")
	// A failed turn takes its handles with it; the next turn starts clean.
	h.fail(admin, "actor.call", map[string]any{"store": "dbm", "action": "failWithOpen"}, "actor_error")
	call("commit", nil)
	want("after failWithOpen and commit", names(), "one", "kept", "kept")

	// require('database') is use('database'); './database.js' is the tree's.
	if call("same", nil) != true {
		t.Fatal("require('database') is not use('database')")
	}
	if got := call("local", nil); got != "tree file" {
		t.Fatalf("require('./database.js') = %v", got)
	}

	// Writes through database.exec fire table reactors like sql's.
	waitFor(t, "the table reactor", func() bool {
		d, ok := h.call(admin, "docs.get", map[string]any{"store": "dbm", "path": "stats/items"}).(map[string]any)
		return ok && d["body"].(map[string]any)["commits"].(float64) >= 3
	})
}
