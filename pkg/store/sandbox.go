package store

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"

	"github.com/pkg/errors"
)

// ServerKey returns a named random 32-byte key, creating it on first use.
func (s *Store) ServerKey(ctx context.Context, name string) ([]byte, error) {
	var key []byte
	err := s.db().row(ctx, `SELECT value FROM server_keys WHERE name=?`, name).Scan(&key)
	if err == nil {
		return key, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	key = make([]byte, 32)
	if _, err = rand.Read(key); err != nil {
		return nil, err
	}
	if _, err = s.db().exec(ctx, `INSERT INTO server_keys(name,value,created_at) VALUES(?,?,?) ON CONFLICT(name) DO NOTHING`, name, key, s.Now()); err != nil {
		return nil, err
	}
	// Another process may have won the insert; read what is stored.
	err = s.db().row(ctx, `SELECT value FROM server_keys WHERE name=?`, name).Scan(&key)
	return key, err
}

// SandboxLabel returns the host label of a version's preview origin: "s"
// and 20 hex digits of an HMAC, unguessable without the server key.
func (s *Store) SandboxLabel(ctx context.Context, artifact string, n int) (string, error) {
	key, err := s.ServerKey(ctx, "sandbox")
	if err != nil {
		return "", err
	}
	m := hmac.New(sha256.New, key)
	_, _ = fmt.Fprintf(m, "%s\x00%d", artifact, n)
	label := "s" + hex.EncodeToString(m.Sum(nil))[:20]
	_, err = s.db().exec(ctx, `INSERT INTO sandbox_labels(label,artifact_id,n,created_at) VALUES(?,?,?,?) ON CONFLICT(label) DO NOTHING`, label, artifact, n, s.Now())
	return label, err
}

// SandboxTarget maps a label back to its artifact version.
func (s *Store) SandboxTarget(ctx context.Context, label string) (string, int, error) {
	var artifact string
	var n int
	err := s.db().row(ctx, `SELECT artifact_id,n FROM sandbox_labels WHERE label=?`, label).Scan(&artifact, &n)
	return artifact, n, notFound(err)
}
