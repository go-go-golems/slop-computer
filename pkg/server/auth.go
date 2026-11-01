package server

import (
	"context"
	"errors"
	"html/template"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/httpx"
	"github.com/go-go-golems/slop/pkg/system"
)

type ctxKey struct{}

// sessionCookie is the main host's session cookie name.
func (s *Server) sessionCookie() string {
	if s.Cfg.SecureCookies() {
		return "__Host-slop_session"
	}
	return "slop_session"
}

func (s *Server) setCookie(w http.ResponseWriter, name, value string, maxAge int, sameSite http.SameSite) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true,
		Secure: s.Cfg.SecureCookies(), SameSite: sameSite})
}

// principalOf resolves the caller on the main host: a bearer token, or a
// session cookie. It returns nil for nobody, and the session for CSRF checks.
func (s *Server) principalOf(r *http.Request) (*access.Principal, *system.Session, error) {
	ctx := r.Context()
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		t, err := s.Sys.TokenBySecret(ctx, strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			return nil, nil, err
		}
		p, err := s.Sys.Person(ctx, t.Person)
		if err != nil {
			return nil, nil, err
		}
		if p.Role == system.RoleDisabled {
			return nil, nil, system.ErrNotFound
		}
		return &access.Principal{Kind: access.KindToken, Person: &p, TokenID: t.ID, Scopes: t.Scopes, Via: "http"}, nil, nil
	}
	c, err := r.Cookie(s.sessionCookie())
	if err != nil || c.Value == "" {
		return nil, nil, nil
	}
	sess, err := s.Sys.SessionBySecret(ctx, c.Value, r.Host)
	if err != nil {
		return nil, nil, nil
	}
	p, err := s.Sys.Person(ctx, sess.Person)
	if err != nil || p.Role == system.RoleDisabled {
		return nil, nil, nil
	}
	kind := access.KindUser
	if p.Kind == "guest" {
		kind = access.KindGuest
	}
	return &access.Principal{Kind: kind, Person: &p, Via: "http"}, &sess, nil
}

func (s *Server) authRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /auth/login", s.loginPage)
	m.HandleFunc("POST /auth/local", s.localSignIn)
	m.HandleFunc("POST /auth/logout", s.logout)
	m.HandleFunc("GET /auth/session", s.sessionInfo)
}

var loginTmpl = template.Must(template.New("login").Parse(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · slop</title>
<style>body{font:15px/1.5 Arial,sans-serif;color:#1a1a1a;margin:0;display:grid;place-items:center;min-height:100vh}
form{border:1px solid #d6d6d6;padding:24px 28px;min-width:300px}h1{font-size:18px;margin:0 0 16px}
label{display:block;margin:10px 0 4px;color:#737373;font-size:13px}input{width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #d6d6d6;font:inherit}
button{margin-top:16px;padding:7px 14px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;font:inherit;cursor:pointer}
.err{color:#e2001a;margin-top:10px}.dim{color:#737373;font-size:13px}</style>
<form method="post" action="/auth/local"><h1>Sign in to slop</h1>
{{if .Local}}<label>Email</label><input name="email" type="email" required autofocus>
<label>Name</label><input name="name"><input type="hidden" name="return" value="{{.Return}}">
<button>Sign in</button><p class="dim">Local sign-in (development).</p>
{{else}}<p>This server signs in with its OIDC provider.</p>{{end}}
{{if .Problem}}<p class="err">{{.Problem}}</p>{{end}}</form>`))

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	ret := safeReturn(r.URL.Query().Get("return"))
	if !s.Cfg.Local && s.oidcLogin != nil {
		s.oidcLogin(w, r, ret)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = loginTmpl.Execute(w, map[string]any{"Local": s.Cfg.Local, "Return": ret, "Problem": r.URL.Query().Get("problem")})
}

func (s *Server) localSignIn(w http.ResponseWriter, r *http.Request) {
	if !s.Cfg.Local {
		http.Error(w, "local sign-in is off", http.StatusNotFound)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	ret := safeReturn(r.PostForm.Get("return"))
	email := strings.TrimSpace(r.PostForm.Get("email"))
	if !strings.Contains(email, "@") {
		http.Redirect(w, r, "/auth/login?problem="+url.QueryEscape("Enter an email")+"&return="+url.QueryEscape(ret), http.StatusSeeOther)
		return
	}
	if err := s.signIn(w, r, email, r.PostForm.Get("name"), ""); err != nil {
		http.Redirect(w, r, "/auth/login?problem="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, ret, http.StatusSeeOther)
}

// signIn finds or creates the user and starts a main-host session.
func (s *Server) signIn(w http.ResponseWriter, r *http.Request, email, name, subject string) error {
	p, _, err := s.Sys.SignInUser(r.Context(), email, name, subject, s.Cfg.AdminEmails, s.Cfg.SignupOpen())
	if err != nil {
		return err
	}
	if p.Role == system.RoleDisabled {
		return errors.New("this account is disabled")
	}
	secret, _, err := s.Sys.CreateSession(r.Context(), p.ID, r.Host, "")
	if err != nil {
		return err
	}
	s.setCookie(w, s.sessionCookie(), secret, system.SessionDays*24*3600, http.SameSiteLaxMode)
	return nil
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(s.sessionCookie()); err == nil {
		_ = s.Sys.DeleteSession(r.Context(), c.Value)
	}
	s.setCookie(w, s.sessionCookie(), "", -1, http.SameSiteLaxMode)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// sessionInfo tells the back office who is signed in and its CSRF token.
func (s *Server) sessionInfo(w http.ResponseWriter, r *http.Request) {
	p, sess, _ := s.principalOf(r)
	if p == nil || sess == nil {
		httpx.JSON(w, 200, map[string]any{"signedIn": false, "login": "/auth/login"})
		return
	}
	httpx.JSON(w, 200, map[string]any{"signedIn": true, "person": p.Person, "csrf": sess.CSRF})
}

// safeReturn keeps redirects on this host.
func safeReturn(p string) string {
	if p == "" || !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || strings.Contains(p, "\\") {
		return "/"
	}
	return p
}

// withPrincipal stores the principal in a context.
func withPrincipal(ctx context.Context, p *access.Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}
