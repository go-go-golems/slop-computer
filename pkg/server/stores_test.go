package server

// Tests from SLOP3-001 phase P1 (stores, the eval door, import and export); formerly p1_test.go.

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

const booksCSV = "isbn,title,year\n111,Old Book,1990\n222,New Book,2004\n333,Newer Book,2019\n"

// The P1 exit test: one eval program creates a store, imports a CSV as
// documents, queries them, pushes a folder and lists snapshots.
func TestEvalProgram(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	prog := `
slop.store.new({ id: 'inbox' });
slop.files.put({ store: 'inbox', path: 'books.csv', text: args.csv });
const rows = slop.files.cat({ store: 'inbox', path: 'books.csv', as: 'csv' });
slop.store.new({ id: 'library' });
slop.docs.set({ store: 'library', batch: rows.map(r => (
  { path: 'books/' + r.isbn, data: { title: r.title, year: Number(r.year) } })) });
const recent = slop.docs.query({ store: 'library', coll: 'books', where: [['year', '>=', 2000]], orderBy: 'year', desc: true });
slop.files.push({ store: 'library', message: 'site', files: [
  { path: 'index.html', text: '<h1>Library</h1>' }, { path: 'style.css', text: 'h1 { color: red }' }] });
slop.files.push({ store: 'library', message: 'site again', files: [{ path: 'index.html', text: '<h1>Library!</h1>' }] });
console.log('imported', rows.length, { ok: true });
return { books: rows.length, recent: recent.map(d => d.body.title),
  snaps: slop.snap.ls({ store: 'library' }).map(s => s.message),
  tree: slop.files.ls({ store: 'library' }).map(f => f.path) };`
	res := h.call(admin, "eval", map[string]any{"source": prog, "args": map[string]any{"csv": booksCSV}}).(map[string]any)
	got := res["result"].(map[string]any)
	want := map[string]any{"books": 3.0, "recent": []any{"Newer Book", "New Book"},
		"snaps": []any{"site again", "site"}, "tree": []any{"index.html"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("eval result = %#v", got)
	}
	if logs := res["logs"].([]any); len(logs) != 1 || logs[0] != `imported 3 {"ok":true}` {
		t.Fatalf("logs = %v", logs)
	}
	// Every write is in the log as made by the person, via eval with the token.
	log := h.call(admin, "log.show", map[string]any{"store": "library"}).([]any)
	first := log[len(log)-1].(map[string]any)
	if !strings.HasPrefix(first["via"].(string), "eval:tok_") || !strings.HasPrefix(first["principal"].(string), "usr_") {
		t.Fatalf("log entry = %v", first)
	}
	// Snapshot 1 still has the first index.html; main points at 2.
	idx := h.call(admin, "files.cat", map[string]any{"store": "library", "path": "index.html", "at": "1"})
	if idx != "<h1>Library</h1>" {
		t.Fatalf("snapshot 1 index = %v", idx)
	}
	// A path the snapshot does not have is not an empty file.
	if st, out := api(t, h, admin, "files.cat", map[string]any{"store": "library", "path": "nope.html", "at": "1"}); st != 404 {
		t.Fatalf("missing file at snapshot 1: %d %v", st, out)
	}

	// A caught verb error has .code; an uncaught one keeps it.
	res = h.call(admin, "eval", map[string]any{"source": `try { slop.docs.get({ store: 'library', path: 'books/nope' }) } catch (e) { return e.code }`}).(map[string]any)
	if res["result"] != "not_found" {
		t.Fatalf("caught = %v", res)
	}
	h.fail(admin, "eval", map[string]any{"source": `slop.docs.get({ store: 'library', path: 'books/nope' })`}, "not_found")
	e := h.fail(admin, "eval", map[string]any{"source": `console.log('before'); null.x`}, "eval_error")
	if logs := e["extra"].(map[string]any)["logs"].([]any); len(logs) != 1 {
		t.Fatalf("logs kept on failure = %v", e)
	}
	// Read-only programs cannot write.
	h.fail(admin, "eval", map[string]any{"readOnly": true, "source": `slop.store.new({ id: 'nope' })`}, "permission_denied")
	// Programs are interrupted.
	old := verbs.EvalTimeout
	verbs.EvalTimeout = 200 * time.Millisecond
	defer func() { verbs.EvalTimeout = old }()
	h.fail(admin, "eval", map[string]any{"source": `while (true) {}`}, "unavailable")
}

func TestStoreAccess(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	bob := h.tokenFor("bob@example.com")
	h.call(admin, "store.new", map[string]any{"id": "library"})
	h.call(admin, "docs.set", map[string]any{"store": "library", "path": "books/1", "data": map[string]any{"t": "a"}})

	// Without a grant the store does not exist for bob.
	h.fail(bob, "docs.get", map[string]any{"store": "library", "path": "books/1"}, "not_found")
	if ls := h.call(bob, "store.ls", nil).([]any); len(ls) != 0 {
		t.Fatalf("bob sees %v", ls)
	}
	// @member view lets him read but not write; the denial explains itself.
	h.call(admin, "grant.set", map[string]any{"store": "library", "subject": "@member", "level": "view"})
	h.call(bob, "docs.get", map[string]any{"store": "library", "path": "books/1"})
	e := h.fail(bob, "docs.set", map[string]any{"store": "library", "path": "books/2", "data": map[string]any{}}, "permission_denied")
	trace := strings.Join(toStrings(e["trace"]), "\n")
	for _, want := range []string{"audience member", "grant @member view on library", "write needs interact"} {
		if !strings.Contains(trace, want) {
			t.Fatalf("trace lacks %q:\n%s", want, trace)
		}
	}
	// He cannot grant himself more, nor run SQL.
	bobID := h.call(bob, "whoami", nil).(map[string]any)["id"].(string)
	h.fail(bob, "grant.set", map[string]any{"store": "library", "subject": bobID, "level": "interact"}, "permission_denied")
	h.fail(bob, "sql.query", map[string]any{"store": "library", "sql": "SELECT 1"}, "permission_denied")
	// A direct interact grant lets him write; his own data/users path is private.
	h.call(admin, "grant.set", map[string]any{"store": "library", "subject": bobID, "level": "interact"})
	h.call(bob, "docs.set", map[string]any{"store": "library", "path": "books/2", "data": map[string]any{"t": "b"}})
	h.call(bob, "docs.set", map[string]any{"store": "library", "path": "data/users/" + bobID + "/n1", "data": map[string]any{"x": 1}})
	h.fail(admin, "docs.get", map[string]any{"store": "library", "path": "data/users/" + bobID + "/n1"}, "not_found")
	// He owns what he makes; admins can delete it.
	h.call(bob, "store.new", map[string]any{"id": "bobs"})
	ls := h.call(bob, "store.ls", nil).([]any)
	if len(ls) != 2 {
		t.Fatalf("bob's stores = %v", ls)
	}
	h.fail(bob, "store.rm", map[string]any{"id": "library"}, "permission_denied")
	h.call(admin, "store.rm", map[string]any{"id": "bobs"})
	h.fail(bob, "store.meta", map[string]any{"id": "bobs"}, "not_found")
	// Read-only tokens read and do not write.
	ro := h.tokenFor("bob@example.com", "read")
	h.call(ro, "docs.get", map[string]any{"store": "library", "path": "books/2"})
	h.fail(ro, "docs.set", map[string]any{"store": "library", "path": "books/3", "data": map[string]any{}}, "permission_denied")
}

func toStrings(v any) []string {
	out := []string{}
	l, _ := v.([]any)
	for _, x := range l {
		out = append(out, x.(string))
	}
	return out
}

// Export followed by import reproduces documents, files and tables.
func TestExportImport(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "src", "type": "journal"})
	// Tables come from migrations (P3); create them as one would.
	s, err := h.k.Store(context.Background(), "src")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Do(context.Background(), store.Who{ID: "system", Via: "test"}, func(tt *store.Turn) error {
		for _, q := range []string{
			`CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, words INTEGER, by TEXT DEFAULT (slop_principal()))`,
			`CREATE TABLE audit (entry INTEGER, at INTEGER)`,
			`CREATE INDEX entries_title ON entries (title)`,
			`CREATE TRIGGER entries_audit AFTER INSERT ON entries BEGIN INSERT INTO audit VALUES (new.id, 0); END`,
			`CREATE VIEW long_entries AS SELECT * FROM entries WHERE words > 100`,
		} {
			if _, err := tt.Exec(store.CallerMigration, q); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	h.call(admin, "import.table", map[string]any{"store": "src", "table": "entries", "format": "csv",
		"text": "title,words\nfirst,10\nsecond,250\n"})
	h.call(admin, "import.docs", map[string]any{"store": "src", "coll": "books", "id": "isbn", "format": "csv", "text": booksCSV})
	h.call(admin, "docs.update", map[string]any{"store": "src", "path": "books/111", "data": map[string]any{"tags": []any{"x"}}})
	h.call(admin, "files.push", map[string]any{"store": "src", "files": []any{
		map[string]any{"path": "index.html", "text": "<p>hi</p>"},
		map[string]any{"path": "img/dot.png", "data": "iVBORw0KGgo="}}})
	h.call(admin, "files.put", map[string]any{"store": "src", "zone": "assets", "path": "up/a.txt", "text": "asset"})
	rows := h.call(admin, "sql.query", map[string]any{"store": "src", "sql": "SELECT count(*) AS n FROM audit"}).([]any)
	if rows[0].(map[string]any)["n"] != 2.0 {
		t.Fatalf("trigger rows = %v", rows)
	}

	exp := h.call(admin, "store.export", map[string]any{"id": "src"}).(map[string]any)
	h.call(admin, "import.folder", map[string]any{"store": "dst", "bundle": exp["bundle"], "blobs": exp["blobs"]})
	exp2 := h.call(admin, "store.export", map[string]any{"id": "dst"}).(map[string]any)
	if !reflect.DeepEqual(exp["bundle"], exp2["bundle"]) {
		t.Fatalf("round trip differs:\n%v\n%v", exp["bundle"], exp2["bundle"])
	}
	// The trigger did not fire on the restored rows, and the sequence carried over.
	rows = h.call(admin, "sql.query", map[string]any{"store": "dst", "sql": "SELECT count(*) AS n FROM audit"}).([]any)
	if rows[0].(map[string]any)["n"] != 2.0 {
		t.Fatalf("dst audit rows = %v", rows)
	}
	h.call(admin, "import.table", map[string]any{"store": "dst", "table": "entries", "rows": []any{map[string]any{"title": "third"}}})
	rows = h.call(admin, "sql.query", map[string]any{"store": "dst", "sql": "SELECT max(entry) AS id, count(*) AS n FROM audit"}).([]any)
	if r := rows[0].(map[string]any); r["id"] != 3.0 || r["n"] != 3.0 {
		t.Fatalf("dst after insert = %v", r)
	}
	// Admin SQL cannot write kernel tables, nor DDL.
	h.fail(admin, "sql.exec", map[string]any{"store": "dst", "sql": "DELETE FROM _docs", "write": true}, "invalid_argument")
	h.fail(admin, "sql.exec", map[string]any{"store": "dst", "sql": "DROP TABLE entries", "write": true}, "invalid_argument")
	h.fail(admin, "sql.exec", map[string]any{"store": "dst", "sql": "DELETE FROM entries"}, "invalid_argument")
	h.call(admin, "sql.exec", map[string]any{"store": "dst", "sql": "DELETE FROM entries WHERE id = ?", "args": []any{3}, "write": true})
}
