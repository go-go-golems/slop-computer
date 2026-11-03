package auth

import (
	"errors"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Routes registers sign-in, sign-out, the session probe, the OIDC callback
// and device login.
func (s *Door) Routes(m *http.ServeMux) {
	s.deviceRoutes(m)
	m.HandleFunc("GET /auth/login", s.loginPage)
	m.HandleFunc("POST /auth/local", s.localSignIn)
	m.HandleFunc("POST /auth/logout", s.logout)
	m.HandleFunc("GET /auth/session", s.sessionInfo)
	m.HandleFunc("GET /auth/callback", s.oidcCallback)
}

var signInFailedTmpl = template.Must(template.New("failed").Parse(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in problem · slop</title>
<style>body{font:15px/1.5 Arial,sans-serif;color:#1a1a1a;margin:0;display:grid;place-items:center;min-height:100vh}
div{border:1px solid #d6d6d6;padding:24px 28px;max-width:360px}h1{font-size:18px;margin:0 0 12px}a{color:#1a1a1a}</style>
<div><h1>Sign-in did not work</h1><p>{{.Problem}}</p><p><a href="{{.Again}}">Continue signing in</a></p></div>`))

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

func (s *Door) loginPage(w http.ResponseWriter, r *http.Request) {
	ret := web.SafeReturn(r.URL.Query().Get("return"))
	if !s.Cfg.Local && s.oidcLogin != nil {
		s.oidcLogin(w, r, ret)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = loginTmpl.Execute(w, map[string]any{"Local": s.Cfg.Local, "Return": ret, "Problem": r.URL.Query().Get("problem")})
}

func (s *Door) localSignIn(w http.ResponseWriter, r *http.Request) {
	if !s.Cfg.Local {
		http.Error(w, "local sign-in is off", http.StatusNotFound)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	ret := web.SafeReturn(r.PostForm.Get("return"))
	email := strings.TrimSpace(r.PostForm.Get("email"))
	if !strings.Contains(email, "@") {
		http.Redirect(w, r, "/auth/login?problem="+url.QueryEscape("Enter an email")+"&return="+url.QueryEscape(ret), http.StatusSeeOther)
		return
	}
	if err := s.signIn(w, r, email, r.PostForm.Get("name"), "", ""); err != nil {
		http.Redirect(w, r, "/auth/login?problem="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, ret, http.StatusSeeOther)
}

// signIn finds or creates the user and starts a main-host session.
func (s *Door) signIn(w http.ResponseWriter, r *http.Request, email, name, subject, idToken string) error {
	p, _, err := s.People.SignInUser(r.Context(), email, name, subject, s.Cfg.AdminEmails, s.Cfg.SignupOpen())
	if err != nil {
		return err
	}
	if p.Role == sysdb.RoleDisabled {
		return errors.New("this account is disabled")
	}
	secret, _, err := s.People.CreateSession(r.Context(), p.ID, r.Host, "")
	if err != nil {
		return err
	}
	if idToken != "" {
		if err := s.People.SetSessionIDToken(r.Context(), secret, idToken); err != nil {
			return err
		}
	}
	s.Web.SetCookie(w, s.Web.CookieName(), secret, identity.SessionDays*24*3600, http.SameSiteLaxMode)
	return nil
}

// logout ends the session; after an OIDC sign-in it goes on to the
// provider's end_session_endpoint (RP-initiated logout), which ends the
// provider's browser session too and comes back to the main host's /, so
// the next sign-in asks again (another account can sign in).
func (s *Door) logout(w http.ResponseWriter, r *http.Request) {
	idToken := ""
	if c, err := r.Cookie(s.Web.CookieName()); err == nil {
		idToken = s.People.SessionIDToken(r.Context(), c.Value)
		_ = s.People.DeleteSession(r.Context(), c.Value)
	}
	s.Web.SetCookie(w, s.Web.CookieName(), "", -1, http.SameSiteLaxMode)
	next := ""
	if s.oidc != nil && idToken != "" {
		target, err := s.oidc.LogoutURL(r.Context(), idToken, s.Cfg.MainURL()+"/", "")
		if err != nil {
			log.Printf("oidc logout: %v", err)
		}
		next = target
	}
	// A page that signs out with fetch cannot follow a redirect to the
	// provider (another origin): it asks for JSON and navigates to next.
	if strings.Contains(r.Header.Get("Accept"), "application/json") {
		httpx.JSON(w, 200, map[string]any{"ok": true, "next": next})
		return
	}
	if next == "" {
		next = "/"
	}
	http.Redirect(w, r, next, http.StatusSeeOther)
}

// sessionInfo tells the back office who is signed in and its CSRF token.
func (s *Door) sessionInfo(w http.ResponseWriter, r *http.Request) {
	p, sess, _ := s.Web.Principal(r)
	if p == nil || sess == nil {
		httpx.JSON(w, 200, map[string]any{"signedIn": false, "login": "/auth/login"})
		return
	}
	httpx.JSON(w, 200, map[string]any{"signedIn": true, "person": p.Person, "csrf": sess.CSRF})
}
