// Package system owns system.db: people, sessions, tokens, the stores
// registry, grants, mounts, policy, LLM access, subscriptions and the
// platform log. Store contents live in their own files (pkg/store).
package system

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3" // registers "sqlite3"
)

//go:embed migrations/*.sql
var migrations embed.FS

// DB is system.db.
type DB struct {
	*sql.DB
	Now func() time.Time
}

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("not found")

// Open opens (and migrates) system.db at path.
func Open(ctx context.Context, path string) (*DB, error) {
	dsn := fmt.Sprintf("file:%s?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on&_txlock=immediate", path)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}
	d := &DB{DB: db, Now: time.Now}
	if err := d.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return d, nil
}

// NowMs is the current time in milliseconds.
func (d *DB) NowMs() int64 { return d.Now().UnixMilli() }

// migrate applies embedded migrations in name order. Foreign keys are off
// while a migration runs (so table rebuilds keep references), and
// foreign_key_check must pass before it commits.
func (d *DB) migrate(ctx context.Context) error {
	if _, err := d.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS _schema (name TEXT PRIMARY KEY, at INTEGER NOT NULL)`); err != nil {
		return err
	}
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		var n int
		if err := d.QueryRowContext(ctx, `SELECT count(*) FROM _schema WHERE name = ?`, name).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		body, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		if err := d.applyMigration(ctx, name, string(body)); err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
	}
	return nil
}

func (d *DB) applyMigration(ctx context.Context, name, body string) error {
	conn, err := d.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	defer func() { _, _ = conn.ExecContext(context.Background(), `PRAGMA foreign_keys = ON`) }()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, body); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		return err
	}
	bad := rows.Next()
	_ = rows.Close()
	if bad {
		return errors.New("foreign_key_check failed")
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO _schema (name, at) VALUES (?, ?)`, name, d.NowMs()); err != nil {
		return err
	}
	return tx.Commit()
}

// Change is one entry of a system log commit.
type Change struct {
	Kind   string `json:"kind"`
	Key    string `json:"key"`
	Op     string `json:"op"`
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`
}

// Execer is a *sql.Tx or *sql.DB.
type Execer interface {
	ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error)
	QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row
	QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error)
}

// Log writes one system log commit in the given transaction and returns its rev.
func Log(ctx context.Context, x Execer, at int64, principal, via, summary string, changes ...Change) (int64, error) {
	res, err := x.ExecContext(ctx, `INSERT INTO _log (at, principal, via, summary) VALUES (?, ?, ?, ?)`, at, principal, via, summary)
	if err != nil {
		return 0, err
	}
	rev, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	for i, c := range changes {
		if _, err := x.ExecContext(ctx, `INSERT INTO _changes (rev, seq, kind, key, op, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			rev, i, c.Kind, c.Key, c.Op, nullStr(c.Before), nullStr(c.After)); err != nil {
			return 0, err
		}
	}
	return rev, nil
}

// LogEntry is a system log commit as read back.
type LogEntry struct {
	Rev       int64    `json:"rev"`
	At        int64    `json:"at"`
	Principal string   `json:"principal"`
	Via       string   `json:"via"`
	Summary   string   `json:"summary"`
	Changes   []Change `json:"changes,omitempty"`
}

// Logs returns the newest system log commits, newest first.
func (d *DB) Logs(ctx context.Context, limit int) ([]LogEntry, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := d.QueryContext(ctx, `SELECT rev, at, principal, via, summary FROM _log ORDER BY rev DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LogEntry{}
	for rows.Next() {
		var e LogEntry
		if err := rows.Scan(&e.Rev, &e.At, &e.Principal, &e.Via, &e.Summary); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Tx runs fn in a write transaction.
func (d *DB) Tx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullInt(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

// splitScopes parses a space-separated scope list.
func splitScopes(s string) []string { return strings.Fields(s) }
