package policy

import (
	"context"
	"database/sql"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// --- trusted Go modules (SLOP3-002) ------------------------------------------

// AppModule is one trust: an app may use() a Go module.
type AppModule struct {
	App       string `json:"app"`
	Module    string `json:"module"`
	GrantedBy string `json:"grantedBy"`
	GrantedAt int64  `json:"grantedAt"`
}

// TrustModule lets an app use a Go module.
func (d *Governance) TrustModule(ctx context.Context, actor, via, app, module string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		now := d.NowMs()
		if _, err := tx.ExecContext(ctx, `INSERT INTO app_modules (app, module, granted_by, granted_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (app, module) DO UPDATE SET granted_by = excluded.granted_by, granted_at = excluded.granted_at`,
			app, module, actor, now); err != nil {
			return err
		}
		_, err := sysdb.Log(ctx, tx, now, actor, via, "trust "+app+" with "+module,
			sysdb.Change{Kind: "module", Key: app + " " + module, Op: "set", After: "trusted"})
		return err
	})
}

// UntrustModule withdraws a trust (ErrNotFound when there was none).
func (d *Governance) UntrustModule(ctx context.Context, actor, via, app, module string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM app_modules WHERE app = ? AND module = ?`, app, module)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sysdb.ErrNotFound
		}
		_, err = sysdb.Log(ctx, tx, d.NowMs(), actor, via, "untrust "+app+" with "+module,
			sysdb.Change{Kind: "module", Key: app + " " + module, Op: "remove", Before: "trusted"})
		return err
	})
}

// Trusted reports whether an app may use a Go module.
func (d *Governance) Trusted(ctx context.Context, app, module string) bool {
	var one int
	// A trust row counts only while the admin who made it is still an admin
	// (SLOP3-007: trust has provenance, like a link and its creator).
	return d.QueryRowContext(ctx, `SELECT 1 FROM app_modules m LEFT JOIN people p ON p.id = m.granted_by
		WHERE m.app = ? AND m.module = ? AND (m.granted_by = 'system' OR p.role = 'admin')`, app, module).Scan(&one) == nil
}

// AppModules lists trusts, of one app or (app "") of all.
func (d *Governance) AppModules(ctx context.Context, app string) ([]AppModule, error) {
	rows, err := d.QueryContext(ctx, `SELECT app, module, granted_by, granted_at FROM app_modules
		WHERE ? = '' OR app = ? ORDER BY app, module`, app, app)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []AppModule{}
	for rows.Next() {
		var m AppModule
		if err := rows.Scan(&m.App, &m.Module, &m.GrantedBy, &m.GrantedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
