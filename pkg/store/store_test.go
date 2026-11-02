package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/rt"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	b, err := blobs.Open(filepath.Join(dir, "blobs"))
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(context.Background(), "st_test", filepath.Join(dir, "st_test.db"), b)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

var me = Who{ID: "usr_me", Via: "test", Level: "owner"}

func TestDocsAndLog(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	var commits []*Commit
	s.OnCommit = func(c *Commit) { commits = append(commits, c) }

	c, err := s.Do(ctx, me, func(t *Turn) error {
		if _, err := t.SetDoc("notes/a", map[string]any{"title": "a", "n": 1}, 0); err != nil {
			return err
		}
		_, err := t.SetDoc("notes/b", map[string]any{"title": "b", "n": 2}, 0)
		return err
	})
	if err != nil || c == nil || c.Rev != 1 || len(c.Changes) != 2 {
		t.Fatalf("commit = %+v, %v", c, err)
	}
	if len(commits) != 1 || commits[0].Rev != 1 {
		t.Fatalf("OnCommit saw %+v", commits)
	}

	// A turn that changes nothing gets no rev.
	c, err = s.Do(ctx, me, func(t *Turn) error { _, err := t.GetDoc("notes/a"); return err })
	if err != nil || c != nil {
		t.Fatalf("read-only turn = %+v, %v", c, err)
	}

	// Conditional writes, merge, delete.
	_, err = s.Do(ctx, me, func(t *Turn) error { _, err := t.SetDoc("notes/a", map[string]any{"x": 1}, 7); return err })
	var de *DocError
	if !errors.As(err, &de) || !strings.Contains(de.Msg, "conflict") {
		t.Fatalf("conditional write err = %v", err)
	}
	c, err = s.Do(ctx, me, func(t *Turn) error {
		if _, err := t.UpdateDoc("notes/a", map[string]any{"tag": "x"}); err != nil {
			return err
		}
		_, err := t.DeleteDoc("notes/b")
		return err
	})
	if err != nil || c.Rev != 2 {
		t.Fatalf("rev 2 = %+v, %v", c, err)
	}
	d, err := s.GetDoc(ctx, "notes/a")
	if err != nil || d.Body["tag"] != "x" || d.Version != 2 {
		t.Fatalf("merged doc = %+v, %v", d, err)
	}
	if _, err := s.GetDoc(ctx, "notes/b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted doc err = %v", err)
	}
	docs, err := s.Query(ctx, rt.Query{Coll: "notes"})
	if err != nil || len(docs) != 1 {
		t.Fatalf("query = %+v, %v", docs, err)
	}
	since, _ := s.DocsSince(ctx, 1, "notes/")
	if len(since) != 2 || since[1].Body != nil {
		t.Fatalf("since = %+v", since)
	}

	// A failing turn rolls back.
	_, err = s.Do(ctx, me, func(t *Turn) error {
		_, _ = t.SetDoc("notes/c", map[string]any{}, 0)
		return errors.New("boom")
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if _, err := s.GetDoc(ctx, "notes/c"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("rolled-back doc err = %v", err)
	}
	log, err := s.Log(ctx, 0, 10)
	if err != nil || len(log) != 2 || log[0].Principal != "usr_me" || len(log[1].Changes) != 2 {
		t.Fatalf("log = %+v, %v", log, err)
	}
	if s.Head() != 2 {
		t.Fatalf("head = %d", s.Head())
	}
}

func TestAppSQLAuthorizer(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)

	// Migrations may create app tables, not kernel ones.
	c, err := s.Do(ctx, me, func(t *Turn) error {
		_, err := t.Exec(CallerMigration, `CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, by TEXT DEFAULT (slop_principal()))`)
		return err
	})
	if err != nil || c == nil || c.Changes[0].Kind != "schema" {
		t.Fatalf("migration = %+v, %v", c, err)
	}
	for _, q := range []string{
		`CREATE TABLE _evil (x)`,
		`CREATE TEMP TABLE t (x)`,
		`ATTACH DATABASE ':memory:' AS other`,
		// An app-named trigger or index on a kernel table: a trigger there
		// would run its body inside the kernel's own (unchecked) writes.
		`CREATE TRIGGER inject AFTER INSERT ON _docs BEGIN INSERT INTO _meta (key, value) VALUES ('x', 'y'); END`,
		`CREATE INDEX docs_by ON _docs (path)`,
	} {
		_, err := s.Do(ctx, me, func(t *Turn) error { _, err := t.Exec(CallerMigration, q); return err })
		if err == nil {
			t.Errorf("%s: expected denial", q)
		}
	}

	// Actors write app tables; slop_principal() sees the turn's principal.
	c, err = s.Do(ctx, me, func(t *Turn) error {
		_, err := t.Exec(CallerActor, `INSERT INTO items (name) VALUES (?)`, "one")
		return err
	})
	if err != nil || len(c.Changes) != 1 || c.Changes[0].Key != "items" {
		t.Fatalf("actor insert = %+v, %v", c, err)
	}
	rows, err := s.ReadQuery(ctx, `SELECT name, by FROM items`)
	if err != nil || len(rows) != 1 || rows[0]["by"] != "usr_me" {
		t.Fatalf("rows = %+v, %v", rows, err)
	}
	for _, q := range []string{
		`DELETE FROM _docs`,
		`UPDATE _meta SET value = 'x'`,
		`CREATE TABLE more (x)`,
		`DROP TABLE items`,
		`PRAGMA writable_schema = 1`,
		`COMMIT`,
	} {
		_, err := s.Do(ctx, me, func(t *Turn) error { _, err := t.Exec(CallerActor, q); return err })
		if err == nil {
			t.Errorf("actor %s: expected denial", q)
		}
	}
	// Reads of kernel tables and recursive CTEs are fine.
	_, err = s.Do(ctx, me, func(t *Turn) error {
		if _, err := t.Query(CallerActor, `SELECT count(*) FROM _docs`); err != nil {
			return err
		}
		_, err := t.Query(CallerActor, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 5) SELECT i FROM n`)
		return err
	})
	if err != nil {
		t.Fatalf("actor reads: %v", err)
	}
	// Admin reads cannot write.
	_, err = s.Do(ctx, me, func(t *Turn) error { _, err := t.Exec(CallerAdminRead, `DELETE FROM items`); return err })
	if err == nil {
		t.Fatal("admin-read delete: expected denial")
	}
}

func TestFilesAndSnapshots(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	_, err := s.Do(ctx, me, func(t *Turn) error {
		if _, err := t.PutFile("tree", "app.json", []byte(`{"name":"x"}`), ""); err != nil {
			return err
		}
		if _, err := t.PutFile("tree", "index.html", []byte(`<h1>hi</h1>`), ""); err != nil {
			return err
		}
		n, err := t.Snapshot("first", "")
		if n != 1 {
			t.Summary = "unexpected"
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Do(ctx, me, func(t *Turn) error {
		if _, err := t.PutFile("tree", "index.html", []byte(`<h1>bye</h1>`), ""); err != nil {
			return err
		}
		if _, err := t.PutFile("tree", "../x", nil, ""); err == nil {
			t.Summary = "bad path accepted"
		}
		_, err := t.Snapshot("second", "")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	refs, _ := s.Refs(ctx)
	if refs["main"] != 2 {
		t.Fatalf("refs = %v", refs)
	}
	snaps, _ := s.Snapshots(ctx)
	if len(snaps) != 2 || snaps[0].Tree == snaps[1].Tree {
		t.Fatalf("snapshots = %+v", snaps)
	}
	f, err := s.SnapshotFile(ctx, 1, "index.html")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := s.ReadFile(f)
	if string(b) != "<h1>hi</h1>" || !strings.HasPrefix(f.Type, "text/html") {
		t.Fatalf("snapshot 1 index = %q %s", b, f.Type)
	}
	// Rolling back moves the ref.
	if _, err := s.Do(ctx, me, func(t *Turn) error { return t.MoveRef("main", 1) }); err != nil {
		t.Fatal(err)
	}
	n, _ := s.Ref(ctx, "main")
	if n != 1 {
		t.Fatalf("main = %d", n)
	}
	if !ValidFilePath("a/b.txt") || ValidFilePath("/a") || ValidFilePath("a/../b") || ValidFilePath("") {
		t.Fatal("ValidFilePath")
	}
}

// An export round trip keeps BLOB cells as BLOBs, byte for byte (through
// JSON, as import.folder receives a bundle).
func TestExportKeepsBlobs(t *testing.T) {
	ctx := context.Background()
	src, dst := openTest(t), openTest(t)
	raw := []byte{0x00, 0xff, 0xfe, 'h', 'i', 0x80}
	if _, err := src.Do(ctx, me, func(t *Turn) error {
		if _, err := t.Exec(CallerMigration, `CREATE TABLE bins (id INTEGER PRIMARY KEY, data BLOB, note TEXT) STRICT`); err != nil {
			return err
		}
		_, err := t.Exec(CallerActor, `INSERT INTO bins (data, note) VALUES (?, 'x')`, raw)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	b, err := src.Export(ctx)
	if err != nil {
		t.Fatal(err)
	}
	j, _ := json.Marshal(b)
	var back Bundle
	dec := json.NewDecoder(bytes.NewReader(j))
	dec.UseNumber()
	if err := dec.Decode(&back); err != nil {
		t.Fatal(err)
	}
	if _, err := dst.Do(ctx, me, func(t *Turn) error { return t.Restore(&back) }); err != nil {
		t.Fatalf("restore: %v", err)
	}
	rows, err := dst.ReadQuery(ctx, `SELECT typeof(data) AS kind, hex(data) AS hex, note FROM bins`)
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows = %v, %v", rows, err)
	}
	if rows[0]["kind"] != "blob" || rows[0]["hex"] != "00FFFE686980" || rows[0]["note"] != "x" {
		t.Fatalf("after the round trip: %v", rows[0])
	}
}

// No app-authored SQL runs as the kernel. A trigger or a foreign key
// cascade runs inside the statement that set it off, with its authority;
// so the kernel never writes app tables, and app tables may not reference
// kernel tables (a document delete would cascade into them).
func TestNoAppSQLRunsAsTheKernel(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	migrate := func(q string) error {
		_, err := s.Do(ctx, me, func(t *Turn) error { _, err := t.Exec(CallerMigration, q); return err })
		return err
	}
	if err := migrate(`CREATE TABLE notes (path TEXT REFERENCES _docs(path) ON DELETE CASCADE)`); err == nil {
		t.Fatal("an app table referencing _docs: expected denial")
	}
	// References between app tables are fine, and kernel work goes on.
	if err := migrate(`CREATE TABLE parent (id TEXT PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	if err := migrate(`CREATE TABLE kid (p TEXT REFERENCES parent(id) ON DELETE CASCADE)`); err != nil {
		t.Fatal(err)
	}
	if err := migrate(`CREATE TRIGGER kid_gone AFTER DELETE ON kid BEGIN INSERT INTO parent (id) VALUES ('again'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Do(ctx, me, func(t *Turn) error { _, err := t.SetDoc("notes/a", map[string]any{"x": 1}, 0); return err }); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Do(ctx, me, func(t *Turn) error { _, err := t.DeleteDoc("notes/a"); return err }); err != nil {
		t.Fatal(err)
	}
	// The kernel itself may not write an app table (its triggers would run
	// as the kernel).
	if _, err := s.Do(ctx, me, func(t *Turn) error { _, err := t.Exec(CallerKernel, `DELETE FROM parent`); return err }); err == nil {
		t.Fatal("a kernel write to an app table: expected denial")
	}
}
