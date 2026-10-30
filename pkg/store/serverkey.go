package store

import (
	"context"
	"crypto/rand"
	"database/sql"

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
