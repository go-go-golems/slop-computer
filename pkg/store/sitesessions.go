package store

import (
	"context"
	"time"
)

// Site sessions (SLOP-011): cookies are per host, so a site host keeps its
// own sessions. A signed-in person gets one by a handoff from the main host;
// an anonymous visitor gets one when a live route admits the public.

// SiteSession is a session on one site host.
type SiteSession struct {
	Hash      []byte
	Host      string
	Principal string // usr_… or vis_…
	ExpiresAt time.Time
	// FromVisitor is the visitor this person was on the host before they
	// signed in, until they keep or drop what the visitor did.
	FromVisitor string
}

const (
	SiteSessionIdle     = 30 * 24 * time.Hour
	SiteSessionAbsolute = 90 * 24 * time.Hour
	HandoffTTL          = time.Minute
)

// CreateSiteSession starts a session for principal on host and returns its
// token; only the token's digest is stored. fromVisitor is the visitor a
// person signed in over, or "".
func (s *Store) CreateSiteSession(ctx context.Context, host, principal, fromVisitor string) (string, SiteSession, error) {
	token := RandomHex(32)
	now := s.Now()
	ss := SiteSession{Hash: Hash(token), Host: host, Principal: principal, ExpiresAt: now.Add(SiteSessionIdle), FromVisitor: fromVisitor}
	_, err := s.db().exec(ctx, `INSERT INTO site_sessions(token_hash,host,principal,created_at,last_seen_at,expires_at,from_visitor) VALUES(?,?,?,?,?,?,?)`,
		ss.Hash, host, principal, now, now, ss.ExpiresAt, nullable(fromVisitor))
	return token, ss, err
}

// SettleFromVisitor forgets the visitor a session signed in over, once its
// person kept or dropped what the visitor did.
func (s *Store) SettleFromVisitor(ctx context.Context, hash []byte) error {
	_, err := s.db().exec(ctx, `UPDATE site_sessions SET from_visitor=NULL WHERE token_hash=?`, hash)
	return err
}

// ResolveSiteSession returns a usable session of host and slides its idle
// expiry, up to SiteSessionAbsolute after it began.
func (s *Store) ResolveSiteSession(ctx context.Context, host, token string) (SiteSession, error) {
	ss := SiteSession{Hash: Hash(token), Host: host}
	var created time.Time
	var from *string
	now := s.Now()
	err := s.db().row(ctx, `SELECT principal,created_at,from_visitor FROM site_sessions
WHERE token_hash=? AND host=? AND revoked_at IS NULL AND expires_at > ?`, ss.Hash, host, now).Scan(&ss.Principal, &created, &from)
	ss.FromVisitor = deref(from)
	if err != nil {
		return ss, notFound(err)
	}
	ss.ExpiresAt = now.Add(SiteSessionIdle)
	if end := created.Add(SiteSessionAbsolute); end.Before(ss.ExpiresAt) {
		ss.ExpiresAt = end
	}
	_, err = s.db().exec(ctx, `UPDATE site_sessions SET last_seen_at=?, expires_at=? WHERE token_hash=?`, now, ss.ExpiresAt, ss.Hash)
	return ss, err
}

// RevokeSiteSession ends one site session.
func (s *Store) RevokeSiteSession(ctx context.Context, hash []byte) error {
	_, err := s.db().exec(ctx, `UPDATE site_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL`, s.Now(), hash)
	return err
}

// SaveHandoff stores a one-time code that signs user in on host and leads
// to returnPath there, for the browser holding state.
func (s *Store) SaveHandoff(ctx context.Context, code, user, host, returnPath, state string) error {
	now := s.Now()
	if _, err := s.db().exec(ctx, `DELETE FROM site_handoffs WHERE expires_at < ?`, now.Add(-time.Hour)); err != nil {
		return err
	}
	_, err := s.db().exec(ctx, `INSERT INTO site_handoffs(code_hash,user_id,host,return_path,expires_at,state) VALUES(?,?,?,?,?,?)`,
		Hash(code), user, host, returnPath, now.Add(HandoffTTL), state)
	return err
}

// ConsumeHandoff uses a code once, on the host it was made for, before it
// expires, by the browser holding its state: the user it signs in and where
// to go.
func (s *Store) ConsumeHandoff(ctx context.Context, code, host, state string) (string, string, error) {
	var user, returnPath string
	now := s.Now()
	err := s.db().row(ctx, `UPDATE site_handoffs SET consumed_at=?
WHERE code_hash=? AND host=? AND state=? AND state<>'' AND consumed_at IS NULL AND expires_at > ?
RETURNING user_id,return_path`, now, Hash(code), host, state, now).Scan(&user, &returnPath)
	return user, returnPath, notFound(err)
}
