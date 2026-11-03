package registry

import (
	"context"
	"database/sql"
	"errors"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Binding maps a store's read alias to a real store. Assets: the store's
// actor may also read the target's uploaded files, and its pages show them.
// Prefix (SLOP3-008): the alias also maps into the store's pages' db, as
// <alias>/… → the target's <prefix>/…, at most at Level.
type Binding struct {
	Store  string `json:"store,omitempty"` // "" in a mount's alias template
	Alias  string `json:"alias"`
	Target string `json:"target"`
	Assets bool   `json:"assets,omitempty"`
	Prefix string `json:"prefix,omitempty"`
	Level  string `json:"level,omitempty"`
}

// Binding returns the target of a store's alias.
func (d *Registry) Binding(ctx context.Context, store, alias string) (string, error) {
	b, err := d.BindingOf(ctx, store, alias)
	return b.Target, err
}

// BindingOf returns a store's alias with its settings.
func (d *Registry) BindingOf(ctx context.Context, store, alias string) (Binding, error) {
	b := Binding{Store: store, Alias: alias}
	err := d.QueryRowContext(ctx, `SELECT target, assets, prefix, level FROM bindings WHERE store = ? AND alias = ?`, store, alias).Scan(&b.Target, &b.Assets, &b.Prefix, &b.Level)
	if errors.Is(err, sql.ErrNoRows) {
		return b, sysdb.ErrNotFound
	}
	return b, err
}

// Bindings lists a store's aliases.
func (d *Registry) Bindings(ctx context.Context, store string) ([]Binding, error) {
	rows, err := d.QueryContext(ctx, `SELECT store, alias, target, assets, prefix, level FROM bindings WHERE store = ? ORDER BY alias`, store)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Binding{}
	for rows.Next() {
		var b Binding
		if err := rows.Scan(&b.Store, &b.Alias, &b.Target, &b.Assets, &b.Prefix, &b.Level); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// SetBinding points a store's alias at a target store.
func (d *Registry) SetBinding(ctx context.Context, actor, via string, b Binding) error {
	if b.Level == "" {
		b.Level = "view"
	}
	return d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO bindings (store, alias, target, assets, prefix, level) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (store, alias) DO UPDATE SET target = excluded.target, assets = excluded.assets,
			prefix = excluded.prefix, level = excluded.level`, b.Store, b.Alias, b.Target, b.Assets, b.Prefix, b.Level); err != nil {
			return err
		}
		after := b.Target
		if b.Prefix != "" {
			after += ":" + b.Prefix + " (in pages at " + b.Alias + ", " + b.Level + ")"
		}
		if b.Assets {
			after += " (with uploads)"
		}
		_, err := sysdb.Log(ctx, tx, d.NowMs(), actor, via, "bound "+b.Store+" "+b.Alias+" → "+after,
			sysdb.Change{Kind: "binding", Key: b.Store + " " + b.Alias, Op: "set", After: after})
		return err
	})
}

// RemoveBinding deletes a store's alias.
func (d *Registry) RemoveBinding(ctx context.Context, actor, via, store, alias string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM bindings WHERE store = ? AND alias = ?`, store, alias)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sysdb.ErrNotFound
		}
		_, err = sysdb.Log(ctx, tx, d.NowMs(), actor, via, "unbound "+store+" "+alias, sysdb.Change{Kind: "binding", Key: store + " " + alias, Op: "remove"})
		return err
	})
}

// SetSchedule records a store's next alarm time.
func (d *Registry) SetSchedule(ctx context.Context, store string, next int64) error {
	_, err := d.ExecContext(ctx, `INSERT INTO schedules (store, next_at) VALUES (?, ?) ON CONFLICT (store) DO UPDATE SET next_at = excluded.next_at`, store, next)
	return err
}

// ClearSchedule forgets a store's alarms.
func (d *Registry) ClearSchedule(ctx context.Context, store string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM schedules WHERE store = ?`, store)
	return err
}

// DueSchedules lists the stores with an alarm due at now.
func (d *Registry) DueSchedules(ctx context.Context, now int64) ([]string, error) {
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
