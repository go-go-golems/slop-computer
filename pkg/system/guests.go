package system

import (
	"context"
	"database/sql"
	"time"

	"github.com/go-go-golems/slop/pkg/ids"
)

// Guest limits (SLOP-011): one address may create at most GuestsPerHour
// guests an hour, and guests unseen for GuestDays are deleted.
const (
	GuestsPerHour = 30
	GuestDays     = 90
)

// ErrTooManyGuests: this address made too many guests in the last hour.
var ErrTooManyGuests = errorString("too many new guests from this address; try again later")

type errorString string

func (e errorString) Error() string { return string(e) }

// GuestsFrom counts the guests ip created since since (ms).
func (d *DB) GuestsFrom(ctx context.Context, ip string, since int64) int {
	var n int
	_ = d.QueryRowContext(ctx, `SELECT count(*) FROM people WHERE kind = 'guest' AND created_ip = ? AND created_at > ?`, ip, since).Scan(&n)
	return n
}

// StaleGuests lists guests unseen since before (ms) that nobody claimed.
func (d *DB) StaleGuests(ctx context.Context, before int64) ([]string, error) {
	rows, err := d.QueryContext(ctx, `SELECT id FROM people WHERE kind = 'guest' AND last_seen_at < ? ORDER BY last_seen_at LIMIT 1000`, before)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// DeleteGuest removes a guest, its sessions (by cascade) and its grants.
func (d *DB) DeleteGuest(ctx context.Context, id string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM grants WHERE subject = ?`, id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM people WHERE id = ? AND kind = 'guest'`, id); err != nil {
			return err
		}
		_, err := Log(ctx, tx, d.NowMs(), "system", "sweep", "deleted guest "+id, Change{Kind: "person", Key: id, Op: "remove"})
		return err
	})
}

// SubjectGrants lists every grant to one subject.
func (d *DB) SubjectGrants(ctx context.Context, subject string) ([]Grant, error) {
	rows, err := d.QueryContext(ctx, `SELECT store, subject, level, via, coalesce(created_by, ''), created_at FROM grants WHERE subject = ? ORDER BY store`, subject)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Grant{}
	for rows.Next() {
		var g Grant
		if err := rows.Scan(&g.Store, &g.Subject, &g.Level, &g.Via, &g.CreatedBy, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// MoveGrants gives to every grant from has, where to has less on that
// store, and removes from's grants. It returns the stores touched.
func (d *DB) MoveGrants(ctx context.Context, from, to string) ([]string, error) {
	gs, err := d.SubjectGrants(ctx, from)
	if err != nil {
		return nil, err
	}
	stores := []string{}
	err = d.Tx(ctx, func(tx *sql.Tx) error {
		now := d.NowMs()
		for _, g := range gs {
			var had string
			_ = tx.QueryRowContext(ctx, `SELECT level FROM grants WHERE store = ? AND subject = ?
				ORDER BY CASE level WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'interact' THEN 2 ELSE 1 END DESC LIMIT 1`, g.Store, to).Scan(&had)
			if levelRank[had] < levelRank[g.Level] {
				if _, err := tx.ExecContext(ctx, `INSERT INTO grants (store, subject, level, via, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
					ON CONFLICT (store, subject, via) DO UPDATE SET level = excluded.level, created_at = excluded.created_at`,
					g.Store, to, g.Level, g.Via, to, now); err != nil {
					return err
				}
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM grants WHERE store = ? AND subject = ? AND via = ?`, g.Store, from, g.Via); err != nil {
				return err
			}
			if _, err := Log(ctx, tx, now, to, "claim", "claimed "+from+"'s "+g.Level+" on "+g.Store,
				Change{Kind: "grant", Key: g.Store + " " + to, Op: "claim", Before: from, After: g.Level}); err != nil {
				return err
			}
			stores = append(stores, g.Store)
		}
		_, err := tx.ExecContext(ctx, `UPDATE people SET claimed_by = ? WHERE id = ? AND kind = 'guest'`, to, from)
		return err
	})
	return stores, err
}

// SettleClaim ends the claim offer of a session (kept or declined).
func (d *DB) SettleClaim(ctx context.Context, secret string) error {
	_, err := d.ExecContext(ctx, `UPDATE sessions SET from_guest = NULL WHERE id_hash = ?`, ids.Hash(secret))
	return err
}

// GuestCutoff is the last-seen time before which a guest is swept.
func GuestCutoff(now time.Time) int64 {
	return now.Add(-GuestDays * 24 * time.Hour).UnixMilli()
}
