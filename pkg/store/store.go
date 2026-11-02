// Package store is one store: a SQLite file holding documents, files, the
// app's own tables and a log of every change. All writes go through turns
// (turn.go); a turn is one transaction and, when it changes anything, one
// commit with one rev.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"sync"

	"github.com/mattn/go-sqlite3"

	"github.com/go-go-golems/slop-computer/pkg/blobs"
)

const schema = `
CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS _docs (
  path TEXT PRIMARY KEY, coll TEXT NOT NULL, body TEXT,
  version INTEGER NOT NULL, rev INTEGER NOT NULL, size INTEGER NOT NULL,
  by TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS _docs_coll ON _docs (coll, path);
CREATE TABLE IF NOT EXISTS _files (
  zone TEXT NOT NULL CHECK (zone IN ('tree','assets')), path TEXT NOT NULL,
  sha256 TEXT NOT NULL, size INTEGER NOT NULL, type TEXT NOT NULL,
  rev INTEGER NOT NULL, by TEXT, at INTEGER NOT NULL, PRIMARY KEY (zone, path));
CREATE TABLE IF NOT EXISTS _log (
  rev INTEGER PRIMARY KEY, at INTEGER NOT NULL, principal TEXT NOT NULL,
  via TEXT NOT NULL, app TEXT, summary TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS _changes (
  rev INTEGER NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL,
  key TEXT NOT NULL, op TEXT NOT NULL, version INTEGER, PRIMARY KEY (rev, seq));
CREATE TABLE IF NOT EXISTS _snapshots (
  n INTEGER PRIMARY KEY, rev INTEGER NOT NULL, tree TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '', by TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS _snapshot_files (
  n INTEGER NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL,
  size INTEGER NOT NULL, type TEXT NOT NULL, PRIMARY KEY (n, path)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS _refs (name TEXT PRIMARY KEY, n INTEGER NOT NULL, at INTEGER, by TEXT);
CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS _cursors (name TEXT PRIMARY KEY, source TEXT NOT NULL,
  epoch INTEGER NOT NULL, rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS _alarms (name TEXT PRIMARY KEY, at INTEGER NOT NULL, every TEXT,
  data TEXT, running INTEGER NOT NULL DEFAULT 0);
`

// Store is one open store file.
type Store struct {
	ID    string
	Path  string
	Blobs *blobs.Blobs

	rw *sql.DB   // one connection: the writer
	w  *sql.Conn // the writer, carrying the authorizer and slop_* functions
	ro *sql.DB   // readers

	mu  sync.Mutex // one turn at a time
	cur *Turn      // the turn in progress (read by the authorizer and functions)

	// OnCommit is called after every commit, outside the store's lock.
	OnCommit func(*Commit)
}

// ErrNotFound is returned for missing documents, files, snapshots or refs.
var ErrNotFound = errors.New("not found")

// Open opens (creating if needed) the store file at path.
func Open(ctx context.Context, id, path string, b *blobs.Blobs) (*Store, error) {
	rw, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on", path))
	if err != nil {
		return nil, err
	}
	rw.SetMaxOpenConns(1)
	w, err := rw.Conn(ctx)
	if err != nil {
		_ = rw.Close()
		return nil, err
	}
	s := &Store{ID: id, Path: path, Blobs: b, rw: rw, w: w}
	if _, err := w.ExecContext(ctx, schema); err != nil {
		s.Close()
		return nil, err
	}
	if err := w.Raw(func(dc any) error {
		c, ok := dc.(*sqlite3.SQLiteConn)
		if !ok {
			return errors.New("not a sqlite3 connection")
		}
		c.SetLimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
		c.RegisterAuthorizer(s.authorize)
		if err := c.RegisterFunc("slop_principal", func() string { return s.curPrincipal() }, false); err != nil {
			return err
		}
		if err := c.RegisterFunc("slop_level", func() string { return s.curLevel() }, false); err != nil {
			return err
		}
		return c.RegisterFunc("slop_now", func() int64 { return s.curNow() }, false)
	}); err != nil {
		s.Close()
		return nil, err
	}
	ro, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=ro&_journal_mode=WAL&_busy_timeout=5000", path))
	if err != nil {
		s.Close()
		return nil, err
	}
	s.ro = ro
	if s.Meta("id") == "" {
		if err := s.setMetaDirect(ctx, map[string]string{"id": id, "epoch": "1", "schema_version": "1", "app_ref": "main"}); err != nil {
			s.Close()
			return nil, err
		}
	}
	return s, nil
}

// Close closes the store's connections.
func (s *Store) Close() {
	if s.ro != nil {
		_ = s.ro.Close()
	}
	if s.w != nil {
		_ = s.w.Close()
	}
	if s.rw != nil {
		_ = s.rw.Close()
	}
}

// Meta returns one _meta value ("" when unset).
func (s *Store) Meta(key string) string {
	var v string
	db := s.ro
	if db == nil {
		db = s.rw
	}
	_ = db.QueryRow(`SELECT value FROM _meta WHERE key = ?`, key).Scan(&v)
	return v
}

// MetaInt returns a _meta value as an integer.
func (s *Store) MetaInt(key string) int64 {
	n, _ := strconv.ParseInt(s.Meta(key), 10, 64)
	return n
}

// AllMeta returns every _meta value.
func (s *Store) AllMeta() map[string]string {
	out := map[string]string{}
	rows, err := s.ro.Query(`SELECT key, value FROM _meta`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if rows.Scan(&k, &v) == nil {
			out[k] = v
		}
	}
	return out
}

// setMetaDirect writes _meta outside a turn (store creation only).
func (s *Store) setMetaDirect(ctx context.Context, kv map[string]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range kv {
		if _, err := s.w.ExecContext(ctx, `INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, k, v); err != nil {
			return err
		}
	}
	return nil
}

// Head is the store's latest rev (0 when nothing was committed).
func (s *Store) Head() int64 {
	var n sql.NullInt64
	_ = s.ro.QueryRow(`SELECT max(rev) FROM _log`).Scan(&n)
	return n.Int64
}

// Epoch changes when the store is restored from a backup.
func (s *Store) Epoch() int64 { return s.MetaInt("epoch") }
