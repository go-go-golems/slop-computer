package system

import (
	"context"
	"database/sql"
	"errors"

	"github.com/go-go-golems/slop/pkg/ids"
)

// HandoffTTL is how long a sign-in handoff code is good for (ms).
const HandoffTTL = 2 * 60 * 1000

// Handoff carries a main-host sign-in to a live host.
type Handoff struct {
	Person string
	Host   string
	Return string
	State  string
}

// CreateHandoff makes a one-time code for person to sign in on host. The
// state binds it to the browser that asked (the live host's state cookie).
func (d *DB) CreateHandoff(ctx context.Context, h Handoff) (string, error) {
	code := ids.Secret("hnd_")
	_, err := d.ExecContext(ctx, `INSERT INTO handoffs (code_hash, person, host, return_path, state, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		ids.Hash(code), h.Person, h.Host, h.Return, h.State, d.NowMs()+HandoffTTL)
	return code, err
}

// TakeHandoff consumes a code for host (it works once).
func (d *DB) TakeHandoff(ctx context.Context, code, host string) (Handoff, error) {
	var h Handoff
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		var exp int64
		err := tx.QueryRowContext(ctx, `SELECT person, host, return_path, state, expires_at FROM handoffs WHERE code_hash = ?`, ids.Hash(code)).
			Scan(&h.Person, &h.Host, &h.Return, &h.State, &exp)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM handoffs WHERE code_hash = ? OR expires_at < ?`, ids.Hash(code), d.NowMs()); err != nil {
			return err
		}
		if exp < d.NowMs() || h.Host != host {
			return ErrNotFound
		}
		return nil
	})
	return h, err
}

// SetOrigin records which store and app a sandbox label serves.
func (d *DB) SetOrigin(ctx context.Context, label, store, app string) error {
	_, err := d.ExecContext(ctx, `INSERT INTO origins (label, store, app) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, label, store, app)
	return err
}

// Origin returns the store and app of a sandbox label.
func (d *DB) Origin(ctx context.Context, label string) (store, app string, err error) {
	err = d.QueryRowContext(ctx, `SELECT store, app FROM origins WHERE label = ?`, label).Scan(&store, &app)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return store, app, err
}
