package store

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

// TestTypeOfWithoutMimeTypes: the types slop serves must not depend on the
// host's mime.types, which the slop image does not have (SLOP3-021: the
// catalog's .woff2 fonts went out as application/octet-stream).
func TestTypeOfWithoutMimeTypes(t *testing.T) {
	for name, want := range map[string]string{
		"kit/fonts/plex.woff2": "font/woff2", "a.WOFF": "font/woff", "a.ttf": "font/ttf", "a.otf": "font/otf",
		"favicon.ico": "image/vnd.microsoft.icon", "notes.txt": "text/plain; charset=utf-8",
		"rows.csv": "text/csv; charset=utf-8", "clip.mp4": "video/mp4", "song.mp3": "audio/mpeg",
		"app.js": "text/javascript; charset=utf-8", "report.md": "text/markdown; charset=utf-8",
		"index.html": "text/html; charset=utf-8", "pic.svg": "image/svg+xml", "data.bin": "application/octet-stream",
	} {
		if got := TypeOf(name); got != want {
			t.Errorf("TypeOf(%q) = %q, want %q", name, got, want)
		}
	}
}

// TestSQLiteHasFTS5: apps may declare fts5 tables in their migrations
// (sqlpolicy.go), which needs SQLite built with FTS5: go-sqlite3's
// sqlite_fts5 build tag. Builds and tests pass -tags sqlite_fts5 (Makefile,
// Dockerfile, CI); without it this test fails rather than a store migration
// in production.
func TestSQLiteHasFTS5(t *testing.T) {
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "fts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if _, err := db.Exec(`CREATE VIRTUAL TABLE notes USING fts5(body)`); err != nil {
		if strings.Contains(err.Error(), "no such module: fts5") {
			t.Fatal("SQLite was built without FTS5: build and test with -tags sqlite_fts5 (make test, make build)")
		}
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO notes(body) VALUES ('a pinboard of windows'), ('a catalog of apps')`); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM notes WHERE notes MATCH 'catalog'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("MATCH 'catalog' = %d, %v; want 1", n, err)
	}
}
