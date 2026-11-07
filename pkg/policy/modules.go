package policy

import (
	"context"
	"database/sql"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// --- trusted Go modules (SLOP3-002) ------------------------------------------

// AppModule is one grant: an app may use() a Go module, configured so.
type AppModule struct {
	App       string `json:"app"`
	Module    string `json:"module"`
	Config    string `json:"config"` // JSON; the caller validated it against the module (SLOP3-012)
	GrantedBy string `json:"grantedBy"`
	GrantedAt int64  `json:"grantedAt"`
	// Current: the grant's admin is still an admin (or it is the system's).
	Current bool `json:"current"`
}

// currentSQL is true for a grant row m whose maker is still an admin
// (SLOP3-007: trust has provenance, like a link and its creator).
const currentSQL = `(m.granted_by = 'system' OR p.role = 'admin')`

// TrustModule grants an app a Go module with a configuration (JSON, "{}"
// for none), replacing an earlier grant.
func (d *Governance) TrustModule(ctx context.Context, actor, via, app, module, config string) error {
	if config == "" {
		config = "{}"
	}
	return d.Tx(ctx, func(tx *sql.Tx) error {
		now := d.NowMs()
		before := ""
		_ = tx.QueryRowContext(ctx, `SELECT config FROM app_modules WHERE app = ? AND module = ?`, app, module).Scan(&before)
		if _, err := tx.ExecContext(ctx, `INSERT INTO app_modules (app, module, config, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (app, module) DO UPDATE SET config = excluded.config, granted_by = excluded.granted_by, granted_at = excluded.granted_at`,
			app, module, config, actor, now); err != nil {
			return err
		}
		_, err := sysdb.Log(ctx, tx, now, actor, via, "trust "+app+" with "+module,
			sysdb.Change{Kind: "module", Key: app + " " + module, Op: "set", Before: before, After: config})
		return err
	})
}

// UntrustModule withdraws a trust (ErrNotFound when there was none).
func (d *Governance) UntrustModule(ctx context.Context, actor, via, app, module string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		before := ""
		_ = tx.QueryRowContext(ctx, `SELECT config FROM app_modules WHERE app = ? AND module = ?`, app, module).Scan(&before)
		res, err := tx.ExecContext(ctx, `DELETE FROM app_modules WHERE app = ? AND module = ?`, app, module)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sysdb.ErrNotFound
		}
		_, err = sysdb.Log(ctx, tx, d.NowMs(), actor, via, "untrust "+app+" with "+module,
			sysdb.Change{Kind: "module", Key: app + " " + module, Op: "remove", Before: before})
		return err
	})
}

// Trusted reports whether an app holds a current grant of a Go module.
func (d *Governance) Trusted(ctx context.Context, app, module string) bool {
	g, ok := d.ModuleGrant(ctx, app, module)
	return ok && g.Current
}

// ModuleGrant is an app's grant of a module, current or not (a lapsed
// grant of a module that is on by default still restricts it).
func (d *Governance) ModuleGrant(ctx context.Context, app, module string) (AppModule, bool) {
	var m AppModule
	err := d.QueryRowContext(ctx, `SELECT m.app, m.module, m.config, m.granted_by, m.granted_at, `+currentSQL+`
		FROM app_modules m LEFT JOIN people p ON p.id = m.granted_by WHERE m.app = ? AND m.module = ?`, app, module).
		Scan(&m.App, &m.Module, &m.Config, &m.GrantedBy, &m.GrantedAt, &m.Current)
	return m, err == nil
}

// AppModules lists trusts, of one app or (app "") of all.
func (d *Governance) AppModules(ctx context.Context, app string) ([]AppModule, error) {
	rows, err := d.QueryContext(ctx, `SELECT m.app, m.module, m.config, m.granted_by, m.granted_at, `+currentSQL+`
		FROM app_modules m LEFT JOIN people p ON p.id = m.granted_by
		WHERE ? = '' OR m.app = ? ORDER BY m.app, m.module`, app, app)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []AppModule{}
	for rows.Next() {
		var m AppModule
		if err := rows.Scan(&m.App, &m.Module, &m.Config, &m.GrantedBy, &m.GrantedAt, &m.Current); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
