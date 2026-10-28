// Package store persists slop's users, sessions, tokens, audit log and
// artifact kernel through database/sql, on PostgreSQL or SQLite.
//
// Ported from github.com/go-go-golems/francois@106776a pkg/catalog/store,
// which used pgx directly. Queries are written with ? placeholders and in the
// SQL subset both databases accept; see the SLOP-001 design doc §6.2.1.
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" driver
	"github.com/pkg/errors"
	_ "modernc.org/sqlite" // registers the "sqlite" driver
)

//go:embed migrations/postgres/*.sql migrations/sqlite/*.sql
var migrationFiles embed.FS

// Dialect names the database a Store talks to.
type Dialect string

const (
	Postgres Dialect = "postgres"
	SQLite   Dialect = "sqlite"
)

var (
	// ErrNotFound is returned when a lookup has no visible row.
	ErrNotFound = errors.New("not found")
	// ErrConflict is returned when a unique key or a compare-and-set fails.
	ErrConflict = errors.New("conflict")
)

// Store is the database handle. Its methods are safe for concurrent use.
type Store struct {
	DB      *sql.DB
	Dialect Dialect
	// Now is the clock; tests replace it.
	Now func() time.Time
}

// Open connects to url: "sqlite:<path>", "sqlite::memory:" or a
// postgres:// / postgresql:// URL.
func Open(ctx context.Context, url string) (*Store, error) {
	s := &Store{Now: func() time.Time { return time.Now().UTC() }}
	var err error
	switch {
	case strings.HasPrefix(url, "sqlite:"):
		path := strings.TrimPrefix(url, "sqlite:")
		dsn := "file::memory:"
		if path != ":memory:" {
			if err = os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				return nil, errors.Wrap(err, "create database directory")
			}
			dsn = "file:" + path
		}
		// One connection: SQLite has one writer anyway, and an in-memory
		// database exists per connection. Times are written in SQLite's own
		// format so they compare as text and parse back into time.Time.
		dsn += "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate&_time_format=sqlite&_texttotime=1"
		if s.DB, err = sql.Open("sqlite", dsn); err != nil {
			return nil, errors.Wrap(err, "open sqlite database")
		}
		s.DB.SetMaxOpenConns(1)
		s.Dialect = SQLite
	case strings.HasPrefix(url, "postgres://") || strings.HasPrefix(url, "postgresql://"):
		if s.DB, err = sql.Open("pgx", url); err != nil {
			return nil, errors.Wrap(err, "open postgres database")
		}
		s.Dialect = Postgres
	default:
		return nil, errors.Errorf("database URL must start with sqlite: or postgres://, got %q", url)
	}
	if err = s.DB.PingContext(ctx); err != nil {
		_ = s.DB.Close()
		return nil, errors.Wrap(err, "connect database")
	}
	return s, nil
}

func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.DB.PingContext(ctx) }

// q is what store functions need from either the database or a transaction.
type q interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// db binds a q to the dialect, rewriting ? placeholders for Postgres.
type db struct {
	q q
	d Dialect
}

func (s *Store) db() db { return db{s.DB, s.Dialect} }

func (d db) exec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.q.ExecContext(ctx, rebind(d.d, query), utcArgs(args)...)
}

func (d db) query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.q.QueryContext(ctx, rebind(d.d, query), utcArgs(args)...)
}

func (d db) row(ctx context.Context, query string, args ...any) *sql.Row {
	return d.q.QueryRowContext(ctx, rebind(d.d, query), utcArgs(args)...)
}

// utcArgs converts time arguments to UTC. SQLite stores times as text and
// compares them as text, which is only correct when every value has the same
// offset.
func utcArgs(args []any) []any {
	for i, a := range args {
		switch v := a.(type) {
		case time.Time:
			args[i] = v.UTC()
		case *time.Time:
			if v != nil {
				u := v.UTC()
				args[i] = &u
			}
		}
	}
	return args
}

// forUpdate appends a row lock on Postgres; SQLite transactions already hold
// the database's single write lock (BEGIN IMMEDIATE).
func (d db) forUpdate(query string) string {
	if d.d == Postgres {
		return query + " FOR UPDATE"
	}
	return query
}

// rebind rewrites ? placeholders to $1, $2, … for Postgres. Queries never
// contain a literal question mark.
func rebind(d Dialect, query string) string {
	if d != Postgres || !strings.Contains(query, "?") {
		return query
	}
	var b strings.Builder
	n := 0
	for _, r := range query {
		if r == '?' {
			n++
			b.WriteString("$" + strconv.Itoa(n))
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// InTx runs fn in a transaction, committing when fn returns nil. fn must use
// only the db it is given: with SQLite's single connection, calling back into
// the Store would deadlock.
func (s *Store) InTx(ctx context.Context, fn func(tx db) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err = fn(db{tx, s.Dialect}); err != nil {
		return err
	}
	return tx.Commit()
}

func scanAll[T any](rows *sql.Rows, err error, scan func(*sql.Rows) (T, error)) ([]T, error) {
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []T{}
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func migrationDir(d Dialect) string { return "migrations/" + string(d) }

// Migrations lists the embedded migration names for d, in order.
func Migrations(d Dialect) ([]string, error) {
	entries, err := fs.ReadDir(migrationFiles, migrationDir(d))
	if err != nil {
		return nil, errors.Wrap(err, "read migrations")
	}
	names := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// Migrate applies embedded migrations in order and refuses to run when an
// applied migration's contents changed.
func (s *Store) Migrate(ctx context.Context) ([]string, error) {
	names, err := Migrations(s.Dialect)
	if err != nil {
		return nil, err
	}
	applied := []string{}
	err = s.InTx(ctx, func(tx db) error {
		if s.Dialect == Postgres {
			if _, err := tx.exec(ctx, `SELECT pg_advisory_xact_lock(4202611)`); err != nil {
				return errors.Wrap(err, "lock migrations")
			}
		}
		blob := "blob"
		if s.Dialect == Postgres {
			blob = "bytea"
		}
		if _, err := tx.exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum `+blob+` NOT NULL, applied_at TIMESTAMP NOT NULL)`); err != nil {
			return errors.Wrap(err, "create migration ledger")
		}
		for _, name := range names {
			body, err := migrationFiles.ReadFile(migrationDir(s.Dialect) + "/" + name)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(body)
			var existing []byte
			err = tx.row(ctx, `SELECT checksum FROM schema_migrations WHERE name=?`, name).Scan(&existing)
			if err == nil {
				if string(existing) != string(sum[:]) {
					return errors.Errorf("migration %s changed after it was applied", name)
				}
				continue
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if _, err = tx.q.ExecContext(ctx, string(body)); err != nil {
				return errors.Wrapf(err, "apply migration %s", name)
			}
			if _, err = tx.exec(ctx, `INSERT INTO schema_migrations(name,checksum,applied_at) VALUES(?,?,?)`, name, sum[:], s.Now()); err != nil {
				return err
			}
			applied = append(applied, name)
		}
		return nil
	})
	return applied, err
}

// Pending reports migrations that have not been applied, so serve can refuse
// to start against an incompatible schema.
func (s *Store) Pending(ctx context.Context) ([]string, error) {
	names, err := Migrations(s.Dialect)
	if err != nil {
		return nil, err
	}
	done := map[string]bool{}
	rows, err := s.DB.QueryContext(ctx, `SELECT name FROM schema_migrations`)
	if err == nil {
		got, err := scanAll(rows, nil, func(r *sql.Rows) (string, error) { var n string; return n, r.Scan(&n) })
		if err != nil {
			return nil, err
		}
		for _, n := range got {
			done[n] = true
		}
	}
	pending := []string{}
	for _, n := range names {
		if !done[n] {
			pending = append(pending, n)
		}
	}
	return pending, nil
}

// NewID returns an opaque prefixed identifier.
func NewID(prefix string) string { return prefix + RandomHex(12) }

func RandomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// Hash is the storage form of bearer secrets (sessions, codes, tokens).
func Hash(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// isUnique reports a unique-constraint violation on either database.
func isUnique(err error) bool {
	if err == nil {
		return false
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return pg.Code == "23505"
	}
	return strings.Contains(err.Error(), "UNIQUE constraint failed") || strings.Contains(err.Error(), "PRIMARY KEY constraint failed")
}

// StringList is a []string stored as JSON text in both databases.
type StringList []string

func (l StringList) Value() (driver.Value, error) {
	if l == nil {
		l = StringList{}
	}
	b, err := json.Marshal([]string(l))
	return string(b), err
}

func (l *StringList) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*l = nil
		return nil
	case string:
		return json.Unmarshal([]byte(v), (*[]string)(l))
	case []byte:
		return json.Unmarshal(v, (*[]string)(l))
	}
	return errors.Errorf("cannot scan %T into StringList", src)
}

// JSON is a raw JSON document stored as text in both databases.
type JSON json.RawMessage

func (j JSON) Value() (driver.Value, error) {
	if len(j) == 0 {
		return "{}", nil
	}
	return string(j), nil
}

func (j *JSON) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*j = nil
	case string:
		*j = JSON(v)
	case []byte:
		*j = append(JSON(nil), v...)
	default:
		return errors.Errorf("cannot scan %T into JSON", src)
	}
	return nil
}

func (j JSON) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("null"), nil
	}
	return j, nil
}

func (j *JSON) UnmarshalJSON(b []byte) error { *j = append(JSON(nil), b...); return nil }

// MustJSON marshals v for a JSON column.
func MustJSON(v any) JSON {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return JSON(b)
}

// Redact hides a Postgres URL's password for logs.
func Redact(url string) string {
	if i := strings.Index(url, "://"); i >= 0 {
		if at := strings.Index(url[i+3:], "@"); at >= 0 {
			if colon := strings.Index(url[i+3:i+3+at], ":"); colon >= 0 {
				return url[:i+3+colon] + ":***" + url[i+3+at:]
			}
		}
	}
	return url
}

// InvalidError is a request the store refuses on validation grounds; the
// message is safe to show to the caller.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

func invalidf(format string, args ...any) error {
	if len(args) == 0 {
		return &InvalidError{Msg: format}
	}
	return &InvalidError{Msg: fmt.Sprintf(format, args...)}
}
