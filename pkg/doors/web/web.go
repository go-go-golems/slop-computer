// Package web is the HTTP plumbing every door shares (SLOP3-010 PR 3):
// who a request is (a bearer token or a session cookie on the main host),
// the person an id acts as, cookies, the client's address, server-sent
// events, safe redirects and secret files. A door imports this package and
// nothing of another door.
package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/config"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Sessions resolves requests to principals.
type Sessions struct {
	Cfg    *config.Config
	People *identity.Accounts
}

// CookieName is the main host's session cookie name.
func (w *Sessions) CookieName() string {
	if w.Cfg.SecureCookies() {
		return "__Host-slop_session"
	}
	return "slop_session"
}

// SetCookie sets an HttpOnly cookie on the whole host.
func (w *Sessions) SetCookie(rw http.ResponseWriter, name, value string, maxAge int, sameSite http.SameSite) {
	http.SetCookie(rw, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true,
		Secure: w.Cfg.SecureCookies(), SameSite: sameSite})
}

// Principal resolves the caller on the main host: a bearer token, or a
// session cookie. It returns nil for nobody, and the session for CSRF checks.
func (w *Sessions) Principal(r *http.Request) (*access.Principal, *identity.Session, error) {
	ctx := r.Context()
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		t, err := w.People.TokenBySecret(ctx, strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			return nil, nil, err
		}
		p := w.PersonAs(ctx, t.Person, "http")
		if p == nil {
			return nil, nil, sysdb.ErrNotFound
		}
		p.Kind, p.TokenID, p.Scopes = access.KindToken, t.ID, t.Scopes
		return p, nil, nil
	}
	c, err := r.Cookie(w.CookieName())
	if err != nil || c.Value == "" {
		return nil, nil, nil
	}
	sess, err := w.People.SessionBySecret(ctx, c.Value, r.Host)
	if err != nil {
		return nil, nil, nil
	}
	p := w.PersonAs(ctx, sess.Person, "http")
	if p == nil {
		return nil, nil, nil
	}
	return p, &sess, nil
}

// PersonAs is the principal person id acts as through via, or nil when the
// person is gone or their account is disabled. Sessions, tokens, views,
// previews and apps acting for their payer all turn a stored person id into
// someone who acts here, so a disabled account is refused the same way on
// every door.
func (w *Sessions) PersonAs(ctx context.Context, id, via string) *access.Principal {
	p, err := w.People.Person(ctx, id)
	if err != nil || p.Role == sysdb.RoleDisabled {
		return nil
	}
	return access.PersonPrincipal(p, via)
}

// ClientIP is the caller's address (X-Forwarded-For only behind a trusted
// proxy).
func (w *Sessions) ClientIP(r *http.Request) string {
	if w.Cfg.TrustProxy {
		if f := r.Header.Get("X-Forwarded-For"); f != "" {
			return strings.TrimSpace(strings.Split(f, ",")[0])
		}
	}
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

type ctxKey struct{}

// WithPrincipal stores the principal in a context.
func WithPrincipal(ctx context.Context, p *access.Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

// WriteSSE writes one server-sent event.
func WriteSSE(w http.ResponseWriter, typ string, data any) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", typ, raw)
	return err
}

// SafeReturn keeps redirects on this host.
func SafeReturn(p string) string {
	if p == "" || !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || strings.Contains(p, "\\") {
		return "/"
	}
	return p
}

// ReadSecret reads a secret file (trimmed; empty is an error).
func ReadSecret(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	v := strings.TrimSpace(string(b))
	if v == "" {
		return "", fmt.Errorf("%s is empty", path)
	}
	return v, nil
}
