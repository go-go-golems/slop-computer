package store

import (
	"context"
	"time"
)

type LoginFlow struct {
	BindingHash []byte
	Nonce       string
	Verifier    string
	ReturnPath  string
}

func (s *Store) SaveLoginFlow(ctx context.Context, state string, f LoginFlow, ttl time.Duration) error {
	now := s.Now()
	if _, err := s.db().exec(ctx, `DELETE FROM login_flows WHERE expires_at < ?`, now.Add(-time.Hour)); err != nil {
		return err
	}
	_, err := s.db().exec(ctx, `INSERT INTO login_flows(state_hash,binding_hash,nonce,verifier,return_path,expires_at) VALUES(?,?,?,?,?,?)`,
		Hash(state), f.BindingHash, f.Nonce, f.Verifier, f.ReturnPath, now.Add(ttl))
	return err
}

// ConsumeLoginFlow atomically consumes an unexpired flow bound to the browser.
func (s *Store) ConsumeLoginFlow(ctx context.Context, state string, binding []byte) (LoginFlow, error) {
	var f LoginFlow
	now := s.Now()
	err := s.db().row(ctx, `UPDATE login_flows SET consumed_at=?
WHERE state_hash=? AND binding_hash=? AND consumed_at IS NULL AND expires_at > ?
RETURNING binding_hash,nonce,verifier,return_path`, now, Hash(state), binding, now).Scan(&f.BindingHash, &f.Nonce, &f.Verifier, &f.ReturnPath)
	return f, notFound(err)
}

type Session struct {
	Hash      []byte
	UserID    string
	CSRF      string
	ExpiresAt time.Time
	// IDToken is the sign-in ID token, kept only as the logout id_token_hint.
	IDToken string
}

const (
	SessionIdle     = 7 * 24 * time.Hour
	SessionAbsolute = 30 * 24 * time.Hour
)

// CreateSession stores only the digest of a fresh random token.
func (s *Store) CreateSession(ctx context.Context, user, idToken string) (string, Session, error) {
	token := RandomHex(32)
	now := s.Now()
	sess := Session{Hash: Hash(token), UserID: user, CSRF: RandomHex(24), ExpiresAt: now.Add(SessionIdle), IDToken: idToken}
	_, err := s.db().exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,id_token,created_at,last_seen_at,expires_at,absolute_expires_at) VALUES(?,?,?,?,?,?,?,?)`,
		sess.Hash, user, sess.CSRF, idToken, now, now, sess.ExpiresAt, now.Add(SessionAbsolute))
	return token, sess, err
}

// ResolveSession returns a usable session and slides its idle expiry.
func (s *Store) ResolveSession(ctx context.Context, token string) (Session, User, error) {
	var sess Session
	var absolute time.Time
	now := s.Now()
	d := s.db()
	err := d.row(ctx, `SELECT token_hash,user_id,csrf_token,id_token,absolute_expires_at FROM sessions
WHERE token_hash=? AND revoked_at IS NULL AND expires_at > ? AND absolute_expires_at > ?`, Hash(token), now, now).
		Scan(&sess.Hash, &sess.UserID, &sess.CSRF, &sess.IDToken, &absolute)
	if err != nil {
		return sess, User{}, notFound(err)
	}
	sess.ExpiresAt = now.Add(SessionIdle)
	if absolute.Before(sess.ExpiresAt) {
		sess.ExpiresAt = absolute
	}
	if _, err = d.exec(ctx, `UPDATE sessions SET last_seen_at=?, expires_at=? WHERE token_hash=?`, now, sess.ExpiresAt, sess.Hash); err != nil {
		return sess, User{}, err
	}
	touchUser(ctx, d, sess.UserID, now)
	u, err := s.User(ctx, sess.UserID)
	return sess, u, err
}

// RevokeSession revokes one session.
func (s *Store) RevokeSession(ctx context.Context, hash []byte) error {
	_, err := s.db().exec(ctx, `UPDATE sessions SET revoked_at=?, id_token='' WHERE token_hash=? AND revoked_at IS NULL`, s.Now(), hash)
	return err
}

// RevokeUserSessions revokes every session of a user.
func (s *Store) RevokeUserSessions(ctx context.Context, user string) (int64, error) {
	res, err := s.db().exec(ctx, `UPDATE sessions SET revoked_at=?, id_token='' WHERE user_id=? AND revoked_at IS NULL`, s.Now(), user)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
