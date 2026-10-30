package store

import (
	"context"
	"database/sql"
	"time"

	"github.com/pkg/errors"
)

// Roles. Anyone who signs in is pending until an admin lets them in.
const (
	RoleAdmin    = "admin"
	RolePending  = "pending"
	RoleDisabled = "disabled"
)

// ValidRole reports whether role is one of the three roles.
func ValidRole(role string) bool {
	return role == RoleAdmin || role == RolePending || role == RoleDisabled
}

type User struct {
	ID            string     `json:"id"`
	Issuer        string     `json:"issuer"`
	Subject       string     `json:"subject"`
	Email         string     `json:"email"`
	EmailVerified bool       `json:"emailVerified"`
	DisplayName   string     `json:"name"`
	Role          string     `json:"role"`
	CreatedAt     time.Time  `json:"createdAt"`
	LastLoginAt   *time.Time `json:"lastLoginAt,omitempty"`
	LastSeenAt    *time.Time `json:"lastSeenAt,omitempty"`
}

const userColumns = `id,issuer,subject,email,email_verified,display_name,role,created_at,last_login_at,last_seen_at`

type scanner interface{ Scan(dest ...any) error }

func scanUser(row scanner) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Issuer, &u.Subject, &u.Email, &u.EmailVerified, &u.DisplayName, &u.Role, &u.CreatedAt, &u.LastLoginAt, &u.LastSeenAt)
	return u, notFound(err)
}

// Identity holds verified claims from the identity provider (OIDC or local
// nicknames); email and name are mutable profile data.
type Identity struct {
	Issuer, Subject, Email, Name string
	EmailVerified                bool
}

// UpsertIdentity provisions or refreshes a user keyed by issuer and subject.
// role applies only when the user is created; a login never changes a role.
func (s *Store) UpsertIdentity(ctx context.Context, id Identity, role string) (User, error) {
	if !ValidRole(role) {
		return User{}, errors.Errorf("invalid role %q", role)
	}
	now := s.Now()
	return scanUser(s.db().row(ctx, `INSERT INTO users(id,issuer,subject,email,email_verified,display_name,role,created_at,last_login_at,last_seen_at)
VALUES(?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(issuer,subject) DO UPDATE SET email=excluded.email,email_verified=excluded.email_verified,display_name=excluded.display_name,last_login_at=excluded.last_login_at,last_seen_at=excluded.last_seen_at
RETURNING `+userColumns, NewID("usr_"), id.Issuer, id.Subject, id.Email, id.EmailVerified, id.Name, role, now, now, now))
}

func (s *Store) User(ctx context.Context, id string) (User, error) {
	return getUser(ctx, s.db(), id)
}

func getUser(ctx context.Context, d db, id string) (User, error) {
	return scanUser(d.row(ctx, `SELECT `+userColumns+` FROM users WHERE id=?`, id))
}

func (s *Store) UserByIdentity(ctx context.Context, issuer, subject string) (User, error) {
	return scanUser(s.db().row(ctx, `SELECT `+userColumns+` FROM users WHERE issuer=? AND subject=?`, issuer, subject))
}

// Users lists every account, pending first, then by creation.
func (s *Store) Users(ctx context.Context) ([]User, error) {
	rows, err := s.db().query(ctx, `SELECT `+userColumns+` FROM users ORDER BY CASE WHEN role='pending' THEN 0 ELSE 1 END, created_at, id`)
	return scanAll(rows, err, func(r *sql.Rows) (User, error) { return scanUser(r) })
}

// UsersByIssuer lists the users of one issuer, for the local sign-in page.
func (s *Store) UsersByIssuer(ctx context.Context, issuer string) ([]User, error) {
	rows, err := s.db().query(ctx, `SELECT `+userColumns+` FROM users WHERE issuer=? ORDER BY last_login_at DESC, id`, issuer)
	return scanAll(rows, err, func(r *sql.Rows) (User, error) { return scanUser(r) })
}

// SetUserRole changes a role. Moving away from admin revokes the user's
// sessions (main and site hosts) and tokens, so a demoted or disabled user
// loses access at once.
func (s *Store) SetUserRole(ctx context.Context, id, role string) (User, error) {
	if !ValidRole(role) {
		return User{}, errors.New("role must be admin, pending or disabled")
	}
	var out User
	err := s.InTx(ctx, func(tx db) error {
		var old string
		if err := tx.row(ctx, tx.forUpdate(`SELECT role FROM users WHERE id=?`), id).Scan(&old); err != nil {
			return notFound(err)
		}
		if old != role {
			if _, err := tx.exec(ctx, `UPDATE users SET role=? WHERE id=?`, role, id); err != nil {
				return err
			}
			if role != RoleAdmin {
				now := s.Now()
				if _, err := tx.exec(ctx, `UPDATE sessions SET revoked_at=?, id_token='' WHERE user_id=? AND revoked_at IS NULL`, now, id); err != nil {
					return err
				}
				if _, err := tx.exec(ctx, `UPDATE api_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`, now, id); err != nil {
					return err
				}
				if _, err := tx.exec(ctx, `UPDATE site_sessions SET revoked_at=? WHERE principal=? AND revoked_at IS NULL`, now, id); err != nil {
					return err
				}
			}
		}
		var err error
		out, err = getUser(ctx, tx, id)
		return err
	})
	return out, err
}

// ImportAdmin makes the person with this identity an admin before (or
// after) their first sign-in, for importing another app's admins. A pending
// user is promoted; a disabled one is left alone. It returns the user and
// what happened: "created", "promoted", "unchanged" or "disabled".
func (s *Store) ImportAdmin(ctx context.Context, id Identity) (User, string, error) {
	u, err := s.UserByIdentity(ctx, id.Issuer, id.Subject)
	switch {
	case errors.Is(err, ErrNotFound):
		u, err = scanUser(s.db().row(ctx, `INSERT INTO users(id,issuer,subject,email,email_verified,display_name,role,created_at)
VALUES(?,?,?,?,?,?,?,?) RETURNING `+userColumns, NewID("usr_"), id.Issuer, id.Subject, id.Email, id.EmailVerified, id.Name, RoleAdmin, s.Now()))
		return u, "created", err
	case err != nil:
		return u, "", err
	case u.Role == RoleAdmin:
		return u, "unchanged", nil
	case u.Role == RoleDisabled:
		return u, "disabled", nil
	}
	u, err = s.SetUserRole(ctx, u.ID, RoleAdmin)
	return u, "promoted", err
}

// touchUser records activity at most once a minute.
func touchUser(ctx context.Context, d db, id string, now time.Time) {
	_, _ = d.exec(ctx, `UPDATE users SET last_seen_at=? WHERE id=? AND (last_seen_at IS NULL OR last_seen_at < ?)`, now, id, now.Add(-time.Minute))
}
