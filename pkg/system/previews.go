package system

import (
	"context"
	"database/sql"
	"errors"
)

// Preview is one inspect preview: a snapshot served at the root of its own
// sandbox origin, p<label>, framed only by parent.
type Preview struct {
	Label     string `json:"label"`
	Store     string `json:"store"`
	N         int64  `json:"n"`
	Person    string `json:"person"`
	Parent    string `json:"parent"`
	ExpiresAt int64  `json:"expiresAt"`
}

// CreatePreview stores a preview (and forgets expired ones).
func (d *DB) CreatePreview(ctx context.Context, p Preview) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM previews WHERE expires_at < ?`, d.NowMs()); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO previews (label, store, n, person, parent, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
			p.Label, p.Store, p.N, p.Person, p.Parent, p.ExpiresAt)
		return err
	})
}

// PreviewByLabel returns a preview that has not expired.
func (d *DB) PreviewByLabel(ctx context.Context, label string) (Preview, error) {
	var p Preview
	err := d.QueryRowContext(ctx, `SELECT label, store, n, person, parent, expires_at FROM previews WHERE label = ? AND expires_at >= ?`,
		label, d.NowMs()).Scan(&p.Label, &p.Store, &p.N, &p.Person, &p.Parent, &p.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return p, err
}
