package identity

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/ids"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Session is a browser session on one host.
type Session struct {
	Person    string
	Host      string
	CSRF      string
	FromGuest string
	ExpiresAt int64
}

// SessionDays is the absolute lifetime of a signed-in session. A guest's
// session lasts GuestDays from the guest's last visit instead (SeeGuest).
const SessionDays = 30

const dayMs = 24 * int64(time.Hour/time.Millisecond)

// SeeGuest keeps an active guest: their session and their record (which
// the sweep deletes after GuestDays unseen) both run GuestDays from now. It
// writes at most once a day per session.
func (d *Accounts) SeeGuest(ctx context.Context, secret string, s Session) {
	now := d.NowMs()
	if now+GuestDays*dayMs-s.ExpiresAt < dayMs {
		return
	}
	_, _ = d.ExecContext(ctx, `UPDATE sessions SET expires_at = ? WHERE id_hash = ?`, now+GuestDays*dayMs, ids.Hash(secret))
	_, _ = d.ExecContext(ctx, `UPDATE people SET last_seen_at = ? WHERE id = ?`, now, s.Person)
}

// CreateSession starts a session for person on host and returns its secret.
func (d *Accounts) CreateSession(ctx context.Context, person, host, fromGuest string) (string, Session, error) {
	return d.CreateSessionFor(ctx, person, host, fromGuest, SessionDays)
}

// CreateSessionFor starts a session that lasts days.
func (d *Accounts) CreateSessionFor(ctx context.Context, person, host, fromGuest string, days int) (string, Session, error) {
	secret := ids.Secret("ses_")
	now := d.NowMs()
	s := Session{Person: person, Host: host, CSRF: ids.New("", 16), FromGuest: fromGuest,
		ExpiresAt: now + int64(days)*dayMs}
	_, err := d.ExecContext(ctx, `INSERT INTO sessions (id_hash, person, host, csrf, from_guest, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		ids.Hash(secret), person, host, s.CSRF, sysdb.NullStr(fromGuest), now, s.ExpiresAt)
	return secret, s, err
}

// SessionBySecret returns a live session for a cookie value on host.
func (d *Accounts) SessionBySecret(ctx context.Context, secret, host string) (Session, error) {
	var s Session
	var from sql.NullString
	err := d.QueryRowContext(ctx, `SELECT person, host, csrf, from_guest, expires_at FROM sessions WHERE id_hash = ? AND expires_at > ?`,
		ids.Hash(secret), d.NowMs()).Scan(&s.Person, &s.Host, &s.CSRF, &from, &s.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return s, sysdb.ErrNotFound
	}
	if err != nil {
		return s, err
	}
	if !strings.EqualFold(s.Host, host) {
		return s, sysdb.ErrNotFound
	}
	s.FromGuest = from.String
	return s, nil
}

// DeleteSession ends a session.
// SetSessionIDToken keeps an OIDC sign-in's ID token with its session, for
// logout at the identity provider.
func (d *Accounts) SetSessionIDToken(ctx context.Context, secret, idToken string) error {
	_, err := d.ExecContext(ctx, `UPDATE sessions SET id_token = ? WHERE id_hash = ?`, sysdb.NullStr(idToken), ids.Hash(secret))
	return err
}

// SessionIDToken is the ID token kept with a session, or "".
func (d *Accounts) SessionIDToken(ctx context.Context, secret string) string {
	var tok sql.NullString
	_ = d.QueryRowContext(ctx, `SELECT id_token FROM sessions WHERE id_hash = ?`, ids.Hash(secret)).Scan(&tok)
	return tok.String
}

func (d *Accounts) DeleteSession(ctx context.Context, secret string) error {
	_, err := d.ExecContext(ctx, `DELETE FROM sessions WHERE id_hash = ?`, ids.Hash(secret))
	return err
}

// ScopesForRole are the scopes a user with role may give a token.
func ScopesForRole(role string) []string {
	switch role {
	case sysdb.RoleAdmin:
		return []string{sysdb.ScopeRead, sysdb.ScopeWrite, sysdb.ScopeAdmin}
	case sysdb.RoleMember:
		return []string{sysdb.ScopeRead, sysdb.ScopeWrite}
	}
	return nil
}

// MaxAdminTokenDays bounds the lifetime of tokens with the admin scope.
const MaxAdminTokenDays = 90

// Token is an API token as listed (never with its secret).
type Token struct {
	ID         string   `json:"id"`
	Person     string   `json:"person"`
	Name       string   `json:"name"`
	Scopes     []string `json:"scopes"`
	CreatedAt  int64    `json:"createdAt"`
	ExpiresAt  *int64   `json:"expiresAt,omitempty"`
	LastUsedAt *int64   `json:"lastUsedAt,omitempty"`
	RevokedAt  *int64   `json:"revokedAt,omitempty"`
}

// GrantError explains why a token cannot be made.
type GrantError struct{ Code, Message string }

func (e *GrantError) Error() string { return e.Code + ": " + e.Message }

// CheckTokenGrant validates scopes and lifetime for a user with role.
// days is 0 for no expiry (not allowed with admin).
func CheckTokenGrant(role string, scopes []string, days int) ([]string, error) {
	if days < 0 || days > 366 {
		return nil, &GrantError{"invalid_argument", "a lifetime of 0–366 days (0 = no expiry) is required"}
	}
	allowed := ScopesForRole(role)
	if len(allowed) == 0 {
		return nil, &GrantError{"permission_denied", "this account cannot create API tokens"}
	}
	out := []string{}
	for _, sc := range scopes {
		if !slices.Contains(allowed, sc) {
			return nil, &GrantError{"invalid_argument", "scopes must be chosen from: " + strings.Join(allowed, ", ")}
		}
		if !slices.Contains(out, sc) {
			out = append(out, sc)
		}
	}
	if len(out) == 0 {
		return nil, &GrantError{"invalid_argument", "choose at least one scope from: " + strings.Join(allowed, ", ")}
	}
	if slices.Contains(out, sysdb.ScopeAdmin) && (days < 1 || days > MaxAdminTokenDays) {
		return nil, &GrantError{"invalid_argument", "tokens with the admin scope must expire within 1–90 days"}
	}
	return out, nil
}

// CreateToken makes a token for person and returns its secret once.
func (d *Accounts) CreateToken(ctx context.Context, person, name string, scopes []string, days int) (string, Token, error) {
	secret := ids.Secret("slp_")
	now := d.NowMs()
	t := Token{ID: ids.New("tok_", 12), Person: person, Name: name, Scopes: scopes, CreatedAt: now}
	if days > 0 {
		e := now + int64(days)*24*int64(time.Hour/time.Millisecond)
		t.ExpiresAt = &e
	}
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO tokens (id, hash, person, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			t.ID, ids.Hash(secret), person, name, strings.Join(scopes, " "), now, sysdb.NullInt(t.ExpiresAt)); err != nil {
			return err
		}
		_, err := sysdb.Log(ctx, tx, now, person, "auth", "token "+t.ID+" ("+name+") created",
			sysdb.Change{Kind: "token", Key: t.ID, Op: "create", After: strings.Join(scopes, " ")})
		return err
	})
	return secret, t, err
}

const tokenCols = `id, person, name, scopes, created_at, expires_at, last_used_at, revoked_at`

func scanToken(row interface{ Scan(...any) error }) (Token, error) {
	var t Token
	var scopes string
	var exp, used, rev sql.NullInt64
	err := row.Scan(&t.ID, &t.Person, &t.Name, &scopes, &t.CreatedAt, &exp, &used, &rev)
	if errors.Is(err, sql.ErrNoRows) {
		return t, sysdb.ErrNotFound
	}
	t.Scopes = sysdb.SplitScopes(scopes)
	if exp.Valid {
		t.ExpiresAt = &exp.Int64
	}
	if used.Valid {
		t.LastUsedAt = &used.Int64
	}
	if rev.Valid {
		t.RevokedAt = &rev.Int64
	}
	return t, err
}

// TokenBySecret returns a live token and records its use.
func (d *Accounts) TokenBySecret(ctx context.Context, secret string) (Token, error) {
	t, err := scanToken(d.QueryRowContext(ctx, `SELECT `+tokenCols+` FROM tokens WHERE hash = ?`, ids.Hash(secret)))
	if err != nil {
		return t, err
	}
	now := d.NowMs()
	if t.RevokedAt != nil || (t.ExpiresAt != nil && *t.ExpiresAt <= now) {
		return t, sysdb.ErrNotFound
	}
	_, _ = d.ExecContext(ctx, `UPDATE tokens SET last_used_at = ? WHERE id = ?`, now, t.ID)
	return t, nil
}

// Tokens lists a person's tokens ("" for everyone's).
func (d *Accounts) Tokens(ctx context.Context, person string) ([]Token, error) {
	q := `SELECT ` + tokenCols + ` FROM tokens`
	args := []any{}
	if person != "" {
		q += ` WHERE person = ?`
		args = append(args, person)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := d.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Token{}
	for rows.Next() {
		t, err := scanToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Token returns one token.
func (d *Accounts) Token(ctx context.Context, id string) (Token, error) {
	return scanToken(d.QueryRowContext(ctx, `SELECT `+tokenCols+` FROM tokens WHERE id = ?`, id))
}

// RevokeToken revokes a token.
func (d *Accounts) RevokeToken(ctx context.Context, actor, via, id string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, d.NowMs(), id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sysdb.ErrNotFound
		}
		_, err = sysdb.Log(ctx, tx, d.NowMs(), actor, via, "token "+id+" revoked", sysdb.Change{Kind: "token", Key: id, Op: "revoke"})
		return err
	})
}
