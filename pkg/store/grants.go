package store

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"time"
)

// Grants (SLOP-011): who may open a target, at which level. A subject is
// one person (usr_…), one anonymous visitor (vis_…), everyone signed in
// (*signed-in: members and admins) or anyone (*anyone). The server takes
// the highest level a principal's subjects get, capped by its kind.

const (
	SubjectSignedIn = "*signed-in"
	SubjectAnyone   = "*anyone"
)

// Grant is one subject's level on one target.
type Grant struct {
	Target    string    `json:"target"`
	Subject   string    `json:"subject"`
	Level     string    `json:"level"`
	Via       string    `json:"via,omitempty"` // the share link that created it
	CreatedBy *string   `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
}

var subjectPattern = regexp.MustCompile(`^((usr|vis)_[0-9a-z]{1,64}|\*signed-in|\*anyone)$`)

// ValidSubject reports whether s names a grant subject.
func ValidSubject(s string) bool { return subjectPattern.MatchString(s) }

// ValidGrantLevel reports whether l is a level a grant can give.
func ValidGrantLevel(l string) bool {
	return l == "view" || l == "interact" || l == "admin" || l == "owner"
}

const grantColumns = `target_id,subject,level,via,created_by,created_at`

func scanGrant(r scanner) (Grant, error) {
	var g Grant
	err := r.Scan(&g.Target, &g.Subject, &g.Level, &g.Via, &g.CreatedBy, &g.CreatedAt)
	return g, err
}

// RTGrants lists a target's grants.
func (s *Store) RTGrants(ctx context.Context, target string) ([]Grant, error) {
	rows, err := s.db().query(ctx, `SELECT `+grantColumns+` FROM rt_grants WHERE target_id=? ORDER BY subject`, target)
	return scanAll(rows, err, func(r *sql.Rows) (Grant, error) { return scanGrant(r) })
}

// RTGrantsFor lists the grants a target gives any of subjects.
func (s *Store) RTGrantsFor(ctx context.Context, target string, subjects []string) ([]Grant, error) {
	if len(subjects) == 0 {
		return nil, nil
	}
	q := `SELECT ` + grantColumns + ` FROM rt_grants WHERE target_id=? AND subject IN (?` + strings.Repeat(",?", len(subjects)-1) + `)`
	args := []any{target}
	for _, sub := range subjects {
		args = append(args, sub)
	}
	rows, err := s.db().query(ctx, q, args...)
	return scanAll(rows, err, func(r *sql.Rows) (Grant, error) { return scanGrant(r) })
}

// RTSetGrant gives subject a level on target (replacing what it had),
// audited and announced.
func (s *Store) RTSetGrant(ctx context.Context, target, subject, level, via, actor string) (Grant, []Event, error) {
	if !ValidSubject(subject) {
		return Grant{}, nil, invalidf("a subject is usr_…, vis_…, *signed-in or *anyone")
	}
	if !ValidGrantLevel(level) {
		return Grant{}, nil, invalidf("a level is view, interact, admin or owner")
	}
	var out Grant
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		a, err := getArtifact(ctx, tx, target)
		if err != nil {
			return err
		}
		now := s.Now()
		out, err = scanGrant(tx.row(ctx, `INSERT INTO rt_grants(`+grantColumns+`) VALUES(?,?,?,?,?,?)
ON CONFLICT(target_id,subject) DO UPDATE SET level=excluded.level, via=excluded.via, created_by=excluded.created_by, created_at=excluded.created_at
RETURNING `+grantColumns, target, subject, level, via, nullable(actor), now))
		if err != nil {
			return err
		}
		if err = audit(ctx, tx, now, actor, "access.grant", target, map[string]any{"subject": subject, "level": level, "via": via}); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvAccessChanged, deref(a.Project), target, actor, map[string]any{"subject": subject, "level": level})
		evs = append(evs, ev)
		return err
	})
	return out, evs, err
}

// RTRemoveGrant takes subject's grant on target away.
func (s *Store) RTRemoveGrant(ctx context.Context, target, subject, actor string) ([]Event, error) {
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		a, err := getArtifact(ctx, tx, target)
		if err != nil {
			return err
		}
		res, err := tx.exec(ctx, `DELETE FROM rt_grants WHERE target_id=? AND subject=?`, target, subject)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		now := s.Now()
		if err = audit(ctx, tx, now, actor, "access.revoke", target, map[string]any{"subject": subject}); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvAccessChanged, deref(a.Project), target, actor, map[string]any{"subject": subject, "level": nil})
		evs = append(evs, ev)
		return err
	})
	return evs, err
}
