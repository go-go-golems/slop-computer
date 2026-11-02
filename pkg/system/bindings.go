package system

import (
	"context"
	"database/sql"
	"errors"
)

// Binding maps a store's read alias to a real store. Assets: the store's
// actor may also read the target's uploaded files.
type Binding struct {
	Store  string `json:"store"`
	Alias  string `json:"alias"`
	Target string `json:"target"`
	Assets bool   `json:"assets,omitempty"`
}

// Binding returns the target of a store's alias.
func (d *DB) Binding(ctx context.Context, store, alias string) (string, error) {
	b, err := d.BindingOf(ctx, store, alias)
	return b.Target, err
}

// BindingOf returns a store's alias with its settings.
func (d *DB) BindingOf(ctx context.Context, store, alias string) (Binding, error) {
	b := Binding{Store: store, Alias: alias}
	err := d.QueryRowContext(ctx, `SELECT target, assets FROM bindings WHERE store = ? AND alias = ?`, store, alias).Scan(&b.Target, &b.Assets)
	if errors.Is(err, sql.ErrNoRows) {
		return b, ErrNotFound
	}
	return b, err
}

// Bindings lists a store's aliases.
func (d *DB) Bindings(ctx context.Context, store string) ([]Binding, error) {
	rows, err := d.QueryContext(ctx, `SELECT store, alias, target, assets FROM bindings WHERE store = ? ORDER BY alias`, store)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Binding{}
	for rows.Next() {
		var b Binding
		if err := rows.Scan(&b.Store, &b.Alias, &b.Target, &b.Assets); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// SetBinding points a store's alias at a target store.
func (d *DB) SetBinding(ctx context.Context, actor, via string, b Binding) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO bindings (store, alias, target, assets) VALUES (?, ?, ?, ?)
			ON CONFLICT (store, alias) DO UPDATE SET target = excluded.target, assets = excluded.assets`, b.Store, b.Alias, b.Target, b.Assets); err != nil {
			return err
		}
		after := b.Target
		if b.Assets {
			after += " (with uploads)"
		}
		_, err := Log(ctx, tx, d.NowMs(), actor, via, "bound "+b.Store+" "+b.Alias+" → "+after,
			Change{Kind: "binding", Key: b.Store + " " + b.Alias, Op: "set", After: after})
		return err
	})
}

// RemoveBinding deletes a store's alias.
func (d *DB) RemoveBinding(ctx context.Context, actor, via, store, alias string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM bindings WHERE store = ? AND alias = ?`, store, alias)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		_, err = Log(ctx, tx, d.NowMs(), actor, via, "unbound "+store+" "+alias, Change{Kind: "binding", Key: store + " " + alias, Op: "remove"})
		return err
	})
}

// SetSchedule records a store's next alarm time.
func (d *DB) SetSchedule(ctx context.Context, store string, next int64) error {
	_, err := d.ExecContext(ctx, `INSERT INTO schedules (store, next_at) VALUES (?, ?) ON CONFLICT (store) DO UPDATE SET next_at = excluded.next_at`, store, next)
	return err
}

// ClearSchedule forgets a store's alarms.
func (d *DB) ClearSchedule(ctx context.Context, store string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM schedules WHERE store = ?`, store)
	return err
}

// DueSchedules lists the stores with an alarm due at now.
func (d *DB) DueSchedules(ctx context.Context, now int64) ([]string, error) {
	rows, err := d.QueryContext(ctx, `SELECT store FROM schedules WHERE next_at <= ? ORDER BY next_at`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
