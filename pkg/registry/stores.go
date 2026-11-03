package registry

import (
	"context"
	"database/sql"
	"errors"
	"regexp"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

var storeID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// ValidStoreID reports a valid store id slug.
func ValidStoreID(id string) bool { return storeID.MatchString(id) }

// ErrExists is returned when creating something that already exists.
var ErrExists = errors.New("already exists")

const storeCols = `id, type, coalesce(app, ''), owner, created_at, coalesce(made_by, '')`

func scanStore(row interface{ Scan(...any) error }) (sysdb.StoreRow, error) {
	var s sysdb.StoreRow
	err := row.Scan(&s.ID, &s.Type, &s.App, &s.Owner, &s.CreatedAt, &s.MadeBy)
	if errors.Is(err, sql.ErrNoRows) {
		return s, sysdb.ErrNotFound
	}
	return s, err
}

// AddStore registers a store.
func (d *Registry) AddStore(ctx context.Context, s sysdb.StoreRow, via string) (sysdb.StoreRow, error) {
	if !ValidStoreID(s.ID) {
		return s, errors.New("a store id is lowercase letters, digits and dashes, starting with a letter or digit")
	}
	s.CreatedAt = d.NowMs()
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM stores WHERE id = ?`, s.ID).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			return ErrExists
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO stores (id, type, app, owner, created_at, made_by) VALUES (?, ?, ?, ?, ?, ?)`,
			s.ID, s.Type, sysdb.NullStr(s.App), s.Owner, s.CreatedAt, sysdb.NullStr(s.MadeBy)); err != nil {
			return err
		}
		_, err := sysdb.Log(ctx, tx, s.CreatedAt, s.MadeBy, via, "created store "+s.ID, sysdb.Change{Kind: "store", Key: s.ID, Op: "create", After: s.Owner})
		return err
	})
	return s, err
}

// SetStoreType changes a store's type: which typed mounts (/b/:id --type
// blocks) serve it. It returns the row as it is now.
func (d *Registry) SetStoreType(ctx context.Context, actor, via, id, typ string) (sysdb.StoreRow, error) {
	var row sysdb.StoreRow
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if row, err = scanStore(tx.QueryRowContext(ctx, `SELECT `+storeCols+` FROM stores WHERE id = ?`, id)); err != nil {
			return err
		}
		if row.Type == typ {
			return nil
		}
		if _, err = tx.ExecContext(ctx, `UPDATE stores SET type = ? WHERE id = ?`, typ, id); err != nil {
			return err
		}
		before := row.Type
		row.Type = typ
		_, err = sysdb.Log(ctx, tx, d.NowMs(), actor, via, "set the type of store "+id,
			sysdb.Change{Kind: "store", Key: id, Op: "type", Before: before, After: typ})
		return err
	})
	return row, err
}

// StoreByID returns a store's registry row.
func (d *Registry) StoreByID(ctx context.Context, id string) (sysdb.StoreRow, error) {
	return scanStore(d.QueryRowContext(ctx, `SELECT `+storeCols+` FROM stores WHERE id = ?`, id))
}

// Stores lists stores, all of them or those an owner owns.
func (d *Registry) Stores(ctx context.Context, owner string) ([]sysdb.StoreRow, error) {
	q, args := `SELECT `+storeCols+` FROM stores ORDER BY id`, []any{}
	if owner != "" {
		q, args = `SELECT `+storeCols+` FROM stores WHERE owner = ? ORDER BY id`, []any{owner}
	}
	rows, err := d.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []sysdb.StoreRow{}
	for rows.Next() {
		s, err := scanStore(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// StoresGranted lists the stores where any of subjects holds a grant.
func (d *Registry) StoresGranted(ctx context.Context, subjects []string) ([]sysdb.StoreRow, error) {
	if len(subjects) == 0 {
		return nil, nil
	}
	q := `SELECT DISTINCT ` + storeCols + ` FROM stores WHERE id IN (SELECT store FROM grants WHERE subject IN (?` +
		repeatPlaceholders(len(subjects)-1) + `)) ORDER BY id`
	args := make([]any, len(subjects))
	for i, s := range subjects {
		args[i] = s
	}
	rows, err := d.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []sysdb.StoreRow{}
	for rows.Next() {
		s, err := scanStore(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func repeatPlaceholders(n int) string {
	s := ""
	for range n {
		s += ", ?"
	}
	return s
}

// SetStoreApp records which app a store runs ("" = itself).
func (d *Registry) SetStoreApp(ctx context.Context, actor, via, id, app string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE stores SET app = ? WHERE id = ?`, sysdb.NullStr(app), id); err != nil {
			return err
		}
		_, err := sysdb.Log(ctx, tx, d.NowMs(), actor, via, "store "+id+" runs "+app, sysdb.Change{Kind: "store", Key: id, Op: "app", After: app})
		return err
	})
}

// RemoveStore deletes a store's registry row, its grants and links.
func (d *Registry) RemoveStore(ctx context.Context, actor, via, id string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM stores WHERE id = ?`, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sysdb.ErrNotFound
		}
		_, err = sysdb.Log(ctx, tx, d.NowMs(), actor, via, "deleted store "+id, sysdb.Change{Kind: "store", Key: id, Op: "delete"})
		return err
	})
}

// Grants lists a store's grants.
func (d *Registry) Grants(ctx context.Context, store string) ([]sysdb.Grant, error) {
	rows, err := d.QueryContext(ctx, `SELECT g.store, g.subject, g.level, g.via, coalesce(g.created_by, ''), g.created_at,
		l.id, coalesce(l.created_by, ''), coalesce(l.level, ''), coalesce(l.revoked_at, 0), coalesce(l.expires_at, 0)
		FROM grants g LEFT JOIN links l ON l.id = g.via WHERE g.store = ? ORDER BY g.subject, g.via`, store)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []sysdb.Grant{}
	for rows.Next() {
		var g sysdb.Grant
		var link sql.NullString
		var gl sysdb.GrantLink
		if err := rows.Scan(&g.Store, &g.Subject, &g.Level, &g.Via, &g.CreatedBy, &g.CreatedAt,
			&link, &gl.Creator, &gl.Level, &gl.RevokedAt, &gl.ExpiresAt); err != nil {
			return nil, err
		}
		if link.Valid {
			g.Link = &gl
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// SetGrant gives subject a level on store (replacing the grant with the same via).
func (d *Registry) SetGrant(ctx context.Context, actor, via string, g sysdb.Grant) (sysdb.Grant, error) {
	if !sysdb.ValidLevel(g.Level) {
		return g, errors.New("level must be view, interact, admin or owner")
	}
	if g.Via == "" {
		g.Via = "direct"
	}
	g.CreatedBy, g.CreatedAt = actor, d.NowMs()
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		var before string
		_ = tx.QueryRowContext(ctx, `SELECT level FROM grants WHERE store = ? AND subject = ? AND via = ?`, g.Store, g.Subject, g.Via).Scan(&before)
		if _, err := tx.ExecContext(ctx, `INSERT INTO grants (store, subject, level, via, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (store, subject, via) DO UPDATE SET level = excluded.level, created_by = excluded.created_by, created_at = excluded.created_at`,
			g.Store, g.Subject, g.Level, g.Via, sysdb.NullStr(actor), g.CreatedAt); err != nil {
			return err
		}
		_, err := sysdb.Log(ctx, tx, g.CreatedAt, actor, via, "grant "+g.Subject+" "+g.Level+" on "+g.Store,
			sysdb.Change{Kind: "grant", Key: g.Store + " " + g.Subject, Op: "set", Before: before, After: g.Level})
		return err
	})
	return g, err
}

// RemoveGrant deletes a subject's grants on a store (one via, or all when via is "").
func (d *Registry) RemoveGrant(ctx context.Context, actor, via, store, subject, grantVia string) (int64, error) {
	var n int64
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		q, args := `DELETE FROM grants WHERE store = ? AND subject = ?`, []any{store, subject}
		if grantVia != "" {
			q, args = q+` AND via = ?`, append(args, grantVia)
		}
		res, err := tx.ExecContext(ctx, q, args...)
		if err != nil {
			return err
		}
		n, _ = res.RowsAffected()
		if n == 0 {
			return nil
		}
		_, err = sysdb.Log(ctx, tx, d.NowMs(), actor, via, "revoked "+subject+" on "+store, sysdb.Change{Kind: "grant", Key: store + " " + subject, Op: "remove"})
		return err
	})
	return n, err
}
