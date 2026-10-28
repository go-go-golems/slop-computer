// Package storetest opens a fresh, migrated store per test: SQLite in a temp
// directory, or a new Postgres database when TEST_DATABASE_URL is set.
package storetest

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Open returns a migrated store that is closed (and dropped, on Postgres)
// when the test ends.
func Open(t testing.TB) *store.Store {
	t.Helper()
	ctx := context.Background()
	dsn := "sqlite:" + filepath.Join(t.TempDir(), "slop.db")
	if base := os.Getenv("TEST_DATABASE_URL"); base != "" {
		dsn = createDatabase(t, base)
	}
	s, err := store.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return s
}

func createDatabase(t testing.TB, base string) string {
	t.Helper()
	admin, err := sql.Open("pgx", base)
	if err != nil {
		t.Fatal(err)
	}
	name := "slop_test_" + store.RandomHex(6)
	if _, err = admin.Exec(`CREATE DATABASE ` + name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(`DROP DATABASE IF EXISTS ` + name + ` WITH (FORCE)`)
		_ = admin.Close()
	})
	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + strings.TrimPrefix(name, "/")
	return u.String()
}
