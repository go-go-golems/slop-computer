package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"slices"
	"time"
)

// TokenPrefix marks personal API tokens.
const TokenPrefix = "slp_"

// Token scopes. A scope is a ceiling: the owner's role still applies.
const (
	ScopeRead  = "read"  // GET on the kernel API
	ScopeWrite = "write" // mutations on the kernel API; implies read
	ScopeAdmin = "admin" // users, other people's tokens, the audit log
)

// ScopesForRole lists the scopes a user with this role may put on a token.
func ScopesForRole(role string) []string {
	if role == RoleAdmin {
		return []string{ScopeRead, ScopeWrite, ScopeAdmin}
	}
	return nil
}

// APIToken is a personal API token. Only its hash is stored; the secret is
// shown once at creation.
type APIToken struct {
	ID         string     `json:"id"`
	UserID     string     `json:"owner"`
	Name       string     `json:"name"`
	Scopes     StringList `json:"scopes"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
}

// Allows reports whether the token carries scope need; write implies read.
func (t APIToken) Allows(need string) bool {
	return slices.Contains(t.Scopes, need) || (need == ScopeRead && slices.Contains(t.Scopes, ScopeWrite))
}

const tokenColumns = `id,user_id,name,scopes,created_at,last_used_at,expires_at,revoked_at`

func scanToken(r scanner) (APIToken, error) {
	var t APIToken
	err := r.Scan(&t.ID, &t.UserID, &t.Name, &t.Scopes, &t.CreatedAt, &t.LastUsedAt, &t.ExpiresAt, &t.RevokedAt)
	return t, notFound(err)
}

// CreateToken issues a token with the given scopes; expires may be nil for no
// expiry. Callers validate scopes against the owner's role.
func (s *Store) CreateToken(ctx context.Context, user, name string, scopes []string, expires *time.Time) (string, APIToken, error) {
	return insertToken(ctx, s.db(), s.Now(), user, name, scopes, expires)
}

func insertToken(ctx context.Context, d db, now time.Time, user, name string, scopes []string, expires *time.Time) (string, APIToken, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", APIToken{}, err
	}
	secret := TokenPrefix + base64.RawURLEncoding.EncodeToString(b)
	t, err := scanToken(d.row(ctx, `INSERT INTO api_tokens(id,user_id,name,scopes,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?) RETURNING `+tokenColumns,
		NewID("tok_"), user, name, StringList(scopes), Hash(secret), now, expires))
	return secret, t, err
}

// Tokens lists one user's tokens, or everyone's when user is "".
func (s *Store) Tokens(ctx context.Context, user string) ([]APIToken, error) {
	rows, err := s.db().query(ctx, `SELECT `+tokenColumns+` FROM api_tokens WHERE (?='' OR user_id=?) ORDER BY created_at DESC`, user, user)
	return scanAll(rows, err, func(r *sql.Rows) (APIToken, error) { return scanToken(r) })
}

// RevokeToken revokes a live token; user "" revokes anyone's (admins).
func (s *Store) RevokeToken(ctx context.Context, user, id string) (APIToken, error) {
	return scanToken(s.db().row(ctx, `UPDATE api_tokens SET revoked_at=? WHERE id=? AND (?='' OR user_id=?) AND revoked_at IS NULL RETURNING `+tokenColumns,
		s.Now(), id, user, user))
}

// RevokeUserTokens revokes all of a user's live tokens.
func (s *Store) RevokeUserTokens(ctx context.Context, user string) (int64, error) {
	res, err := s.db().exec(ctx, `UPDATE api_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`, s.Now(), user)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ResolveToken returns the user of a live token and records its use.
func (s *Store) ResolveToken(ctx context.Context, secret string) (APIToken, User, error) {
	now := s.Now()
	d := s.db()
	t, err := scanToken(d.row(ctx, `UPDATE api_tokens SET last_used_at=? WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
RETURNING `+tokenColumns, now, Hash(secret), now))
	if err != nil {
		return t, User{}, err
	}
	touchUser(ctx, d, t.UserID, now)
	u, err := s.User(ctx, t.UserID)
	return t, u, err
}
