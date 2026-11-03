package registry

import (
	"context"
	"database/sql"
	"errors"
	"strconv"

	"github.com/go-go-golems/slop-computer/pkg/ids"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// CreateLink makes a link to store and returns it with its token, which
// is shown once and kept only as a hash.
func (d *Registry) CreateLink(ctx context.Context, actor, via, store, level string, expiresAt int64) (sysdb.Link, string, error) {
	if level != "view" && level != "interact" {
		return sysdb.Link{}, "", errors.New("a link gives view or interact")
	}
	token := ids.Secret("k_")
	l := sysdb.Link{ID: ids.New("lnk_", 12), Store: store, Level: level, CreatedBy: actor, CreatedAt: d.NowMs(), ExpiresAt: expiresAt}
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO links (id, store, level, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			l.ID, store, level, ids.Hash(token), actor, l.CreatedAt, positive(expiresAt)); err != nil {
			return err
		}
		_, err := sysdb.Log(ctx, tx, l.CreatedAt, actor, via, "link "+l.ID+" ("+level+") on "+store, sysdb.Change{Kind: "link", Key: l.ID, Op: "create", After: level})
		return err
	})
	return l, token, err
}

// Links lists a store's links, newest first.
func (d *Registry) Links(ctx context.Context, store string) ([]sysdb.Link, error) {
	rows, err := d.QueryContext(ctx, `SELECT l.id, l.store, l.level, l.created_by, l.created_at, coalesce(l.expires_at, 0), coalesce(l.revoked_at, 0),
		(SELECT count(*) FROM grants g WHERE g.store = l.store AND g.via = l.id)
		FROM links l WHERE l.store = ? ORDER BY l.created_at DESC`, store)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []sysdb.Link{}
	for rows.Next() {
		var l sysdb.Link
		if err := rows.Scan(&l.ID, &l.Store, &l.Level, &l.CreatedBy, &l.CreatedAt, &l.ExpiresAt, &l.RevokedAt, &l.Uses); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// LinkByID returns one link.
func (d *Registry) LinkByID(ctx context.Context, id string) (sysdb.Link, error) {
	var l sysdb.Link
	err := d.QueryRowContext(ctx, `SELECT id, store, level, created_by, created_at, coalesce(expires_at, 0), coalesce(revoked_at, 0) FROM links WHERE id = ?`, id).
		Scan(&l.ID, &l.Store, &l.Level, &l.CreatedBy, &l.CreatedAt, &l.ExpiresAt, &l.RevokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return l, sysdb.ErrNotFound
	}
	return l, err
}

// RevokeLink stops a link and removes the grants it gave. It returns the
// store, whose open views need review.
func (d *Registry) RevokeLink(ctx context.Context, actor, via, id string) (string, error) {
	var store string
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `SELECT store FROM links WHERE id = ?`, id).Scan(&store); errors.Is(err, sql.ErrNoRows) {
			return sysdb.ErrNotFound
		} else if err != nil {
			return err
		}
		now := d.NowMs()
		if _, err := tx.ExecContext(ctx, `UPDATE links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now, id); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM grants WHERE store = ? AND via = ?`, store, id)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		_, err = sysdb.Log(ctx, tx, now, actor, via, "revoked link "+id+" on "+store, sysdb.Change{Kind: "link", Key: id, Op: "revoke", Before: strconv.FormatInt(n, 10) + " grants"})
		return err
	})
	return store, err
}

// RedeemLink gives subject the level of the link whose token this is, on
// store, unless they already hold as much there: have is their effective
// level (by ownership, role or any grant). It returns the link id and
// whether a grant was written.
func (d *Registry) RedeemLink(ctx context.Context, store, token, subject, have string) (string, bool, error) {
	var id string
	wrote := false
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		now := d.NowMs()
		var level string
		err := tx.QueryRowContext(ctx, `SELECT id, level FROM links WHERE token_hash = ? AND store = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
			ids.Hash(token), store, now).Scan(&id, &level)
		if errors.Is(err, sql.ErrNoRows) {
			return sysdb.ErrNotFound
		}
		if err != nil {
			return err
		}
		if sysdb.LevelRank[have] >= sysdb.LevelRank[level] {
			return nil // a link never lowers, and adds nothing here
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO grants (store, subject, level, via, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (store, subject, via) DO UPDATE SET level = excluded.level, created_at = excluded.created_at`,
			store, subject, level, id, subject, now); err != nil {
			return err
		}
		wrote = true
		_, err = sysdb.Log(ctx, tx, now, subject, "link", "grant "+subject+" "+level+" on "+store+" by link "+id,
			sysdb.Change{Kind: "grant", Key: store + " " + subject, Op: "set", After: level})
		return err
	})
	return id, wrote, err
}

// positive is a nullable column value: NULL for zero.
func positive(n int64) any {
	if n <= 0 {
		return nil
	}
	return n
}
