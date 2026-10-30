package store

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// Visitors (SLOP-011): someone who opens a public live route without
// signing in gets a visitor id (vis_…) and a site session. A visitor has
// no users row: the Workshop's people list stays the people let in, and
// visitors expire.

// VisitorPrefix starts every visitor id.
const VisitorPrefix = "vis_"

// RoleVisitor is the role a visitor acts with. It is never stored: users
// rows hold admin, member, pending or disabled.
const RoleVisitor = "visitor"

// IsVisitor reports whether a principal id names a visitor.
func IsVisitor(id string) bool { return strings.HasPrefix(id, VisitorPrefix) }

// VisitorIdle is how long a visitor lasts unseen.
const VisitorIdle = 90 * 24 * time.Hour

// CreateVisitor makes a new visitor.
func (s *Store) CreateVisitor(ctx context.Context) (string, error) {
	id := VisitorPrefix + RandomHex(12)
	now := s.Now()
	_, err := s.db().exec(ctx, `INSERT INTO visitors(id,created_at,last_seen_at) VALUES(?,?,?)`, id, now, now)
	return id, err
}

// TouchVisitor reports whether the visitor exists, and marks it seen.
func (s *Store) TouchVisitor(ctx context.Context, id string) (bool, error) {
	res, err := s.db().exec(ctx, `UPDATE visitors SET last_seen_at=? WHERE id=?`, s.Now(), id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// privatePrefix is where a principal's private documents live.
func privatePrefix(id string) string { return "data/users/" + id + "/" }

// PrivateDoc is one of a principal's private documents in one target.
type PrivateDoc struct {
	Target string
	RTDoc
}

// PrivateDocs lists a principal's private documents in every target.
func (s *Store) PrivateDocs(ctx context.Context, id string) ([]PrivateDoc, error) {
	prefix := privatePrefix(id)
	rows, err := s.db().query(ctx, `SELECT target_id,`+rtDocColumns+` FROM rt_docs WHERE substr(path,1,?)=? AND body IS NOT NULL ORDER BY target_id,path`, len(prefix), prefix)
	return scanAll(rows, err, func(r *sql.Rows) (PrivateDoc, error) {
		var d PrivateDoc
		err := r.Scan(&d.Target, &d.Path, &d.Coll, &d.Body, &d.Version, &d.Rev, &d.UpdatedBy, &d.UpdatedAt)
		return d, err
	})
}

// MoveGrants gives to every grant from has (keeping the higher level where
// to has one already) and removes from's, audited as actor.
func (s *Store) MoveGrants(ctx context.Context, from, to, actor string) ([]Event, error) {
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		rows, err := tx.query(ctx, `SELECT `+grantColumns+` FROM rt_grants WHERE subject=?`, from)
		gs, err := scanAll(rows, err, func(r *sql.Rows) (Grant, error) { return scanGrant(r) })
		if err != nil {
			return err
		}
		now := s.Now()
		for _, g := range gs {
			var had string
			err := tx.row(ctx, `SELECT level FROM rt_grants WHERE target_id=? AND subject=?`, g.Target, to).Scan(&had)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if levelRank(had) < levelRank(g.Level) {
				if _, err = tx.exec(ctx, `INSERT INTO rt_grants(`+grantColumns+`) VALUES(?,?,?,?,?,?)
ON CONFLICT(target_id,subject) DO UPDATE SET level=excluded.level, via=excluded.via, created_by=excluded.created_by, created_at=excluded.created_at`,
					g.Target, to, g.Level, g.Via, nullable(actor), now); err != nil {
					return err
				}
			}
			if _, err = tx.exec(ctx, `DELETE FROM rt_grants WHERE target_id=? AND subject=?`, g.Target, from); err != nil {
				return err
			}
			if err = audit(ctx, tx, now, actor, "access.claim", g.Target, map[string]any{"from": from, "to": to, "level": g.Level}); err != nil {
				return err
			}
			a, err := getArtifact(ctx, tx, g.Target)
			if err != nil {
				return err
			}
			ev, err := appendEvent(ctx, tx, now, EvAccessChanged, deref(a.Project), g.Target, actor, map[string]any{"subject": to, "level": g.Level})
			if err != nil {
				return err
			}
			evs = append(evs, ev)
		}
		return nil
	})
	return evs, err
}

// ClaimVisitor records that user took over what visitor did.
func (s *Store) ClaimVisitor(ctx context.Context, visitor, user string) error {
	_, err := s.db().exec(ctx, `UPDATE visitors SET claimed_by=? WHERE id=?`, user, visitor)
	return err
}

// SweepVisitors deletes visitors unseen for idle, with their site
// sessions, grants and private documents, and returns how many went.
func (s *Store) SweepVisitors(ctx context.Context, idle time.Duration) (int, error) {
	n := 0
	err := s.InTx(ctx, func(tx db) error {
		now := s.Now()
		rows, err := tx.query(ctx, `SELECT id FROM visitors WHERE last_seen_at < ?`, now.Add(-idle))
		ids, err := scanAll(rows, err, func(r *sql.Rows) (string, error) {
			var id string
			return id, r.Scan(&id)
		})
		if err != nil {
			return err
		}
		for _, id := range ids {
			prefix := privatePrefix(id)
			for _, q := range []struct {
				sql  string
				args []any
			}{
				{`DELETE FROM site_sessions WHERE principal=?`, []any{id}},
				{`DELETE FROM rt_grants WHERE subject=?`, []any{id}},
				{`DELETE FROM rt_docs WHERE substr(path,1,?)=?`, []any{len(prefix), prefix}},
				{`DELETE FROM visitors WHERE id=?`, []any{id}},
			} {
				if _, err := tx.exec(ctx, q.sql, q.args...); err != nil {
					return err
				}
			}
		}
		n = len(ids)
		if n == 0 {
			return nil
		}
		return audit(ctx, tx, now, "", "visitor.expire", "", map[string]any{"count": n, "idleDays": int(idle.Hours() / 24)})
	})
	return n, err
}
