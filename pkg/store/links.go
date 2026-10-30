package store

import (
	"context"
	"database/sql"
	"time"

	"github.com/pkg/errors"
)

// Share links (SLOP-011): possession of a link's token gives its level on
// its target. Redeeming one writes a grant for the principal that opened
// it (via = the link's id), so the access listing shows who came in by
// which link, and revoking the link takes those grants away again.

// Link is a share link; its token is shown once, when it is made.
type Link struct {
	ID        string     `json:"id"`
	Target    string     `json:"target"`
	Level     string     `json:"level"`
	CreatedBy *string    `json:"createdBy"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt"`
}

const linkColumns = `id,target_id,level,created_by,created_at,expires_at,revoked_at`

func scanLink(r scanner) (Link, error) {
	var l Link
	err := r.Scan(&l.ID, &l.Target, &l.Level, &l.CreatedBy, &l.CreatedAt, &l.ExpiresAt, &l.RevokedAt)
	return l, err
}

// levelRank orders grant levels; unknown levels rank lowest.
func levelRank(l string) int {
	switch l {
	case "view":
		return 1
	case "interact":
		return 2
	case "admin":
		return 3
	case "owner":
		return 4
	}
	return 0
}

// RTLinks lists a target's share links, newest first.
func (s *Store) RTLinks(ctx context.Context, target string) ([]Link, error) {
	rows, err := s.db().query(ctx, `SELECT `+linkColumns+` FROM rt_links WHERE target_id=? ORDER BY created_at DESC`, target)
	return scanAll(rows, err, func(r *sql.Rows) (Link, error) { return scanLink(r) })
}

// RTCreateLink makes a share link to target at level (view or interact)
// and returns its token.
func (s *Store) RTCreateLink(ctx context.Context, target, level string, expires *time.Time, actor string) (string, Link, []Event, error) {
	if level != "view" && level != "interact" {
		return "", Link{}, nil, invalidf("a share link gives view or interact")
	}
	token := RandomHex(24)
	var out Link
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		a, err := getArtifact(ctx, tx, target)
		if err != nil {
			return err
		}
		now := s.Now()
		out, err = scanLink(tx.row(ctx, `INSERT INTO rt_links(id,target_id,token_hash,level,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)
RETURNING `+linkColumns, "lnk_"+RandomHex(8), target, Hash(token), level, nullable(actor), now, expires))
		if err != nil {
			return err
		}
		if err = audit(ctx, tx, now, actor, "access.link", target, map[string]any{"link": out.ID, "level": level}); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvAccessChanged, deref(a.Project), target, actor, map[string]any{"link": out.ID, "level": level})
		evs = append(evs, ev)
		return err
	})
	return token, out, evs, err
}

// RTRevokeLink stops a link working and removes the grants it gave.
func (s *Store) RTRevokeLink(ctx context.Context, target, id, actor string) ([]Event, error) {
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		a, err := getArtifact(ctx, tx, target)
		if err != nil {
			return err
		}
		now := s.Now()
		res, err := tx.exec(ctx, `UPDATE rt_links SET revoked_at=? WHERE id=? AND target_id=? AND revoked_at IS NULL`, now, id, target)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		if _, err = tx.exec(ctx, `DELETE FROM rt_grants WHERE target_id=? AND via=?`, target, id); err != nil {
			return err
		}
		if err = audit(ctx, tx, now, actor, "access.unlink", target, map[string]any{"link": id}); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvAccessChanged, deref(a.Project), target, actor, map[string]any{"link": id, "level": nil})
		evs = append(evs, ev)
		return err
	})
	return evs, err
}

// RTRedeemLink gives subject the level of target's link with token, unless
// a grant already gives it as much. It returns the link's id, or
// ErrNotFound for a token that is unknown, revoked, expired or another
// target's.
func (s *Store) RTRedeemLink(ctx context.Context, target, token, subject string) (string, []Event, error) {
	if !ValidSubject(subject) || subject[0] == '*' {
		return "", nil, invalidf("a link is redeemed by one person or visitor")
	}
	var id string
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		now := s.Now()
		var level string
		err := tx.row(ctx, `SELECT id,level FROM rt_links WHERE token_hash=? AND target_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
			Hash(token), target, now).Scan(&id, &level)
		if err != nil {
			return notFound(err)
		}
		var had string
		err = tx.row(ctx, `SELECT level FROM rt_grants WHERE target_id=? AND subject=?`, target, subject).Scan(&had)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if levelRank(had) >= levelRank(level) {
			return nil
		}
		if _, err = tx.exec(ctx, `INSERT INTO rt_grants(`+grantColumns+`) VALUES(?,?,?,?,?,?)
ON CONFLICT(target_id,subject) DO UPDATE SET level=excluded.level, via=excluded.via, created_by=excluded.created_by, created_at=excluded.created_at`,
			target, subject, level, id, subject, now); err != nil {
			return err
		}
		a, err := getArtifact(ctx, tx, target)
		if err != nil {
			return err
		}
		if err = audit(ctx, tx, now, subject, "access.grant", target, map[string]any{"subject": subject, "level": level, "via": id}); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvAccessChanged, deref(a.Project), target, subject, map[string]any{"subject": subject, "level": level, "via": id})
		evs = append(evs, ev)
		return err
	})
	return id, evs, err
}
