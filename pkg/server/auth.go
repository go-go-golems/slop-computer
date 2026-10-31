package server

import (
	"context"
	"crypto/subtle"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// Principal is the authenticated caller: a browser session, or a personal
// API token (Token set, no session) on routes whose scope it carries.
type Principal struct {
	Session store.Session
	User    store.User
	Token   *store.APIToken
	// View is set when an app calls the management API through its slop
	// capability, with its view secret (slv_…).
	View *rt.View
}

type principalKey struct{}

func principal(ctx context.Context) *Principal {
	p, _ := ctx.Value(principalKey{}).(*Principal)
	return p
}

func actor(r *http.Request) string { return principal(r.Context()).User.ID }

func me(r *http.Request) store.User { return principal(r.Context()).User }

func (s *Server) sessionCookie() string {
	if s.Config.Secure() {
		return "__Host-slop_session"
	}
	return "slop_session_dev"
}

func (s *Server) flowCookie() string {
	if s.Config.Secure() {
		return "__Host-slop_flow"
	}
	return "slop_flow_dev"
}

func (s *Server) setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	// #nosec G124 -- Secure follows the public scheme: always set for HTTPS
	// deployments (with the __Host- prefix); off only for http://localhost.
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: s.Config.Secure(), SameSite: http.SameSiteLaxMode})
}

// resolve loads the session principal, if any.
func (s *Server) resolve(r *http.Request) (*Principal, error) {
	c, err := r.Cookie(s.sessionCookie())
	if err != nil || c.Value == "" {
		return nil, nil
	}
	sess, u, err := s.Store.ResolveSession(r.Context(), c.Value)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &Principal{Session: sess, User: u}, nil
}

// Access levels declared per route.
const (
	public = iota
	session
	admin // role admin: pending and disabled users stop here
)

// scope is the token scope a route accepts. Every route declares one next to
// its level, so which surfaces a token reaches is visible where the route is
// registered.
type scope string

const (
	noToken    scope = ""      // personal API tokens are rejected
	anyToken   scope = "*"     // any valid token (GET /api/me)
	scopeRW    scope = "rw"    // read for GET and HEAD, write otherwise
	scopeAdmin scope = "admin" // store.ScopeAdmin
)

// required is the token scope a request needs on a route declaring sc.
func (sc scope) required(method string) string {
	switch sc {
	case scopeRW:
		if method == http.MethodGet || method == http.MethodHead {
			return store.ScopeRead
		}
		return store.ScopeWrite
	case scopeAdmin:
		return store.ScopeAdmin
	case noToken, anyToken:
	}
	return string(sc)
}

// guard enforces authentication, role and CSRF + Origin for browser
// mutations. Hiding UI elements is never the authorization.
func (s *Server) guard(level int, sc scope, h http.HandlerFunc) http.HandlerFunc {
	return s.guardPerm(level, sc, "", h)
}

// guardPerm is guard for a route an app may call through its slop
// capability, with a view whose approved permissions include perm
// (rt.SlopPermissions). Routes guarded without a permission never accept
// view secrets.
func (s *Server) guardPerm(level int, sc scope, perm string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, err := s.resolve(r)
		if err != nil {
			log.Error().Err(err).Msg("resolve session")
			httpx.Fail(w, 503, "unavailable", "Session store unavailable")
			return
		}
		ctx := store.WithAuditVia(r.Context(), "browser")
		// An app's view reaches only routes that name a permission an admin
		// approved for its version.
		if bearer := r.Header.Get("Authorization"); p == nil && strings.HasPrefix(bearer, "Bearer "+rt.SecretPrefix) {
			if perm == "" {
				httpx.Fail(w, 403, "app_not_allowed", "Apps cannot call this endpoint")
				return
			}
			v := s.views.Lookup(strings.TrimPrefix(bearer, "Bearer "))
			if v == nil {
				httpx.Fail(w, 401, "view_invalid", "The view is closed or expired")
				return
			}
			if !slices.Contains(v.Perms, perm) {
				httpx.Fail(w, 403, "app_permission", "This app version was not approved for "+perm)
				return
			}
			u, err := s.Store.User(ctx, v.User)
			if err != nil || u.Role != store.RoleAdmin {
				httpx.Fail(w, 401, "view_invalid", "The view's user cannot call this")
				return
			}
			p = &Principal{User: u, View: v}
			ctx = store.WithAuditVia(ctx, "app "+v.App+"@"+strconv.Itoa(v.Version))
		}
		// A personal API token reaches only routes whose scope it carries. The
		// scope is a ceiling: the role check below still applies.
		if bearer := r.Header.Get("Authorization"); p == nil && strings.HasPrefix(bearer, "Bearer "+store.TokenPrefix) {
			if sc == noToken {
				httpx.Fail(w, 401, "token_not_allowed", "API tokens are not accepted here")
				return
			}
			t, u, err := s.Store.ResolveToken(ctx, strings.TrimPrefix(bearer, "Bearer "))
			if err != nil {
				httpx.Fail(w, 401, "token_invalid", "The API token is invalid, expired or revoked")
				return
			}
			if need := sc.required(r.Method); sc != anyToken && !t.Allows(need) {
				httpx.Fail(w, 403, "token_scope", "This token lacks the "+need+" scope")
				return
			}
			p = &Principal{User: u, Token: &t}
			ctx = store.WithAuditVia(store.WithAuditToken(ctx, t.ID), t.Name)
		}
		if level >= session && p == nil {
			httpx.Fail(w, 401, "login_required", "Sign in first")
			return
		}
		if level >= admin && p.User.Role != store.RoleAdmin {
			httpx.Fail(w, 403, "admin_required", "An administrator has to let you in first")
			return
		}
		// A bearer token is not an ambient browser credential: no Origin or
		// CSRF check applies to it.
		if r.Method != http.MethodGet && r.Method != http.MethodHead && p != nil && p.Token == nil && p.View == nil {
			if !s.sameOrigin(r) {
				httpx.Fail(w, 403, "invalid_origin", "Cross-origin request rejected")
				return
			}
			token := r.Header.Get("X-CSRF-Token")
			if token == "" {
				token = r.PostFormValue("csrf")
			}
			if subtle.ConstantTimeCompare([]byte(token), []byte(p.Session.CSRF)) != 1 {
				httpx.Fail(w, 403, "csrf_failed", "Missing or invalid CSRF token")
				return
			}
		}
		h(w, r.WithContext(context.WithValue(ctx, principalKey{}, p)))
	}
}

func (s *Server) sameOrigin(r *http.Request) bool {
	if o := r.Header.Get("Origin"); o != "" {
		return slices.Contains(s.origins(), o)
	}
	// Browsers always send Origin on cross-origin POSTs; fall back to Fetch
	// metadata for older same-origin requests.
	site := r.Header.Get("Sec-Fetch-Site")
	return site == "" || site == "same-origin"
}

// safeReturn keeps post-login redirects on local paths. Of /auth/, only a
// handoff to a site host is a place to return to.
func safeReturn(p string) string {
	if p == "" || !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || strings.HasPrefix(p, "/\\") ||
		(strings.HasPrefix(p, "/auth/") && !strings.HasPrefix(p, "/auth/handoff?")) {
		return "/"
	}
	u, err := url.Parse(p)
	if err != nil || u.Host != "" || u.Scheme != "" {
		return "/"
	}
	return u.RequestURI()
}

func (s *Server) authRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /auth/login", s.login)
	m.HandleFunc("GET /auth/callback", s.callback)
	m.HandleFunc("GET /auth/handoff", s.handoff)
	m.HandleFunc("POST /auth/logout", s.guard(session, noToken, s.logout))
	if s.Config.Local != nil {
		s.localRoutes(m)
	}
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	ret := safeReturn(r.URL.Query().Get("return"))
	if s.Config.Local != nil {
		s.localLoginPage(w, r, ret, "")
		return
	}
	state, nonce, verifier, binding := store.RandomHex(24), store.RandomHex(16), store.RandomHex(32), store.RandomHex(24)
	if err := s.Store.SaveLoginFlow(r.Context(), state, store.LoginFlow{BindingHash: store.Hash(binding), Nonce: nonce, Verifier: verifier, ReturnPath: ret}, 10*time.Minute); err != nil {
		httpx.Fail(w, 503, "unavailable", "Could not start sign-in")
		return
	}
	target, err := s.Config.OIDC.AuthURL(r.Context(), state, nonce, verifier, "", "")
	if err != nil {
		log.Warn().Err(err).Msg("OIDC discovery failed")
		s.signInFailed(w, r, "provider_unavailable", ret)
		return
	}
	s.setCookie(w, s.flowCookie(), binding, 600)
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func (s *Server) callback(w http.ResponseWriter, r *http.Request) {
	if s.Config.OIDC == nil {
		http.NotFound(w, r)
		return
	}
	q := r.URL.Query()
	state := q.Get("state")
	// Until the flow is consumed, "Continue signing in" leads to where the
	// sign-in was going, read by state: it starts a new flow and trusts
	// nothing of this one.
	started := func() string {
		if state == "" {
			return "/"
		}
		ret, _ := s.Store.LoginFlowReturn(r.Context(), state)
		return ret
	}
	if q.Get("error") != "" {
		s.signInFailed(w, r, "denied", started())
		return
	}
	c, err := r.Cookie(s.flowCookie())
	if err != nil || c.Value == "" || state == "" || q.Get("code") == "" {
		s.signInFailed(w, r, "flow_missing", started())
		return
	}
	flow, err := s.Store.ConsumeLoginFlow(r.Context(), state, store.Hash(c.Value))
	if err != nil {
		s.signInFailed(w, r, "flow_invalid", started())
		return
	}
	id, idToken, err := s.Config.OIDC.Exchange(r.Context(), q.Get("code"), flow.Verifier, flow.Nonce)
	if err != nil {
		log.Warn().Err(err).Msg("OIDC exchange failed")
		s.signInFailed(w, r, "exchange_failed", flow.ReturnPath)
		return
	}
	if err = s.signIn(w, r, id, store.RolePending, idToken); err != nil {
		log.Error().Err(err).Msg("sign in")
		s.signInFailed(w, r, "account_unavailable", flow.ReturnPath)
		return
	}
	s.setCookie(w, s.flowCookie(), "", -1)
	http.Redirect(w, r, flow.ReturnPath, http.StatusSeeOther)
}

// signIn provisions the user and starts a browser session.
// signInProblem is what a failed sign-in tells the person, by failure code.
type signInProblem struct {
	Status  int
	Title   string
	Explain string
}

var signInProblems = map[string]signInProblem{
	"provider_unavailable": {http.StatusServiceUnavailable, "The sign-in service is not reachable",
		"slop could not reach the identity provider. Try again in a minute."},
	"denied": {http.StatusForbidden, "Sign-in was cancelled",
		"The identity provider did not sign you in. If you cancelled, you can start again."},
	"flow_missing": {http.StatusBadRequest, "This sign-in started in another browser",
		"You finished signing in in a different browser from the one that started it, or this browser blocked a cookie. Continue to sign in here."},
	"flow_invalid": {http.StatusBadRequest, "This sign-in link was already used or has expired",
		"A sign-in link works once, for 10 minutes. Start again."},
	"exchange_failed": {http.StatusBadGateway, "The identity provider refused the sign-in",
		"Start again. If it keeps happening, tell an administrator: the server log has the details."},
	"account_unavailable": {http.StatusServiceUnavailable, "Your account could not be loaded",
		"Try again in a minute. If it keeps happening, tell an administrator."},
}

// signInFailed shows the sign-in problem page where the failure happened, so
// no other page has to understand it, and logs the failure. ret is where
// "Continue signing in" leads.
func (s *Server) signInFailed(w http.ResponseWriter, r *http.Request, code, ret string) {
	p := signInProblems[code]
	ret = safeReturn(ret)
	log.Info().Str("code", code).Str("client", s.clientAddress(r)).Str("return", ret).Msg("sign-in failed")
	s.setCookie(w, s.flowCookie(), "", -1)
	s.render(w, p.Status, "sign-in-problem", map[string]any{"Code": code, "Problem": p, "Continue": "/auth/login?return=" + url.QueryEscape(ret)})
}

func (s *Server) signIn(w http.ResponseWriter, r *http.Request, id store.Identity, role, idToken string) error {
	u, err := s.Store.UpsertIdentity(r.Context(), id, role)
	if err != nil {
		return err
	}
	token, _, err := s.Store.CreateSession(r.Context(), u.ID, idToken)
	if err != nil {
		return err
	}
	_ = s.Store.Audit(store.WithAuditVia(r.Context(), "browser"), u.ID, "user.signin", u.ID, map[string]any{"issuer": id.Issuer, "role": u.Role})
	s.setCookie(w, s.sessionCookie(), token, int(store.SessionAbsolute.Seconds()))
	return nil
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	p := principal(r.Context())
	if err := s.Store.RevokeSession(r.Context(), p.Session.Hash); err != nil {
		httpx.Fail(w, 503, "unavailable", "Could not sign out")
		return
	}
	s.setCookie(w, s.sessionCookie(), "", -1)
	out := map[string]any{"ok": true}
	// End the identity provider session too, so the next sign-in asks for
	// credentials instead of silently reusing it.
	if s.Config.OIDC != nil && p.Session.IDToken != "" {
		target, err := s.Config.OIDC.LogoutURL(r.Context(), p.Session.IDToken, s.requestOrigin(r)+"/", "")
		if err != nil {
			log.Warn().Err(err).Msg("Identity provider logout unavailable")
		} else if target != "" {
			out["redirect"] = target
		}
	}
	if r.Header.Get("X-CSRF-Token") == "" { // a form post from a server-rendered page
		// Go on to the identity provider's logout too; back on / its live
		// session would sign the person straight in again.
		dest := "/"
		if target, ok := out["redirect"].(string); ok {
			dest = target
		}
		http.Redirect(w, r, dest, http.StatusSeeOther)
		return
	}
	httpx.OK(w, out)
}

// meUser is the user as /api/me and device logins describe it.
func meUser(u store.User) map[string]any {
	return map[string]any{"id": u.ID, "name": u.DisplayName, "email": u.Email, "role": u.Role, "local": u.Issuer == identity.LocalIssuer}
}
