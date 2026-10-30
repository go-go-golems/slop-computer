package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"html/template"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/render"
	"github.com/go-go-golems/slop-computer/pkg/routing"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// Live sites (SLOP-011). A live route runs its app against a target on a
// site host. The site never runs the app itself: it serves a small shell
// that opens a view for the visitor and frames the target's own origin,
// exactly as the Workshop's /run does. A view's secret therefore never
// reaches a page on the site's origin.
//
// Site hosts have their own sessions (cookies are per host). A person signs
// in on the main host and is handed over to the site host with a one-time
// code; the site cookie is SameSite=Strict and HttpOnly, and /_site/ calls
// that change something must come from the site's own origin.

func (s *Server) siteCookie() string {
	if s.Config.Secure() {
		return "__Host-slop_site"
	}
	return "slop_site_dev"
}

func (s *Server) setSiteCookie(w http.ResponseWriter, value string, maxAge int) {
	// #nosec G124 -- Secure follows the public scheme, as for the main session.
	http.SetCookie(w, &http.Cookie{Name: s.siteCookie(), Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: s.Config.Secure(), SameSite: http.SameSiteStrictMode})
}

// siteOrigin is a site host's origin, with the public URL's scheme.
func (s *Server) siteOrigin(host string) string {
	return s.Config.PublicURL.Scheme + "://" + strings.ToLower(host)
}

// siteOrigins are the origins of every site host: they may frame an app's
// target origin, as the Workshop may.
func (s *Server) siteOrigins() []string {
	out := make([]string, 0, len(s.Config.SiteHosts))
	for _, h := range s.Config.SiteHosts {
		out = append(out, s.siteOrigin(h))
	}
	return out
}

// parentOrigin is the origin that frames a view opened by this request: the
// site host it came to, else the main-host origin it came to.
func (s *Server) parentOrigin(r *http.Request) string {
	if h := s.siteHost(r.Host); h != "" {
		return s.siteOrigin(h)
	}
	return s.requestOrigin(r)
}

// sitePrincipal is who a site request is from.
type sitePrincipal struct {
	Session store.SiteSession
	User    store.User
}

func (p *sitePrincipal) ID() string { return p.Session.Principal }

// siteResolve finds the site session of a request, nil without one. A
// disabled user's session counts as none.
func (s *Server) siteResolve(r *http.Request) (*sitePrincipal, error) {
	c, err := r.Cookie(s.siteCookie())
	if err != nil || c.Value == "" {
		return nil, nil
	}
	ss, err := s.Store.ResolveSiteSession(r.Context(), s.siteHost(r.Host), c.Value)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u, err := s.Store.User(r.Context(), ss.Principal)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if u.Role == store.RoleDisabled {
		return nil, nil
	}
	return &sitePrincipal{Session: ss, User: u}, nil
}

// shellRequest is the check on /_site/ calls that change something: from a
// script on the site's own origin (the shell), as JSON. With the cookie's
// SameSite=Strict, a form on another site cannot get here signed in.
func (s *Server) shellRequest(r *http.Request) bool {
	if r.Header.Get("Origin") != s.siteOrigin(r.Host) {
		return false
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		return false
	}
	if r.Method == http.MethodPost && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return false
	}
	return true
}

// siteReturn keeps a return path on the site host and off /_site/.
func siteReturn(p string) string {
	p = safeReturn(p)
	if strings.HasPrefix(p, "/_site/") {
		return "/"
	}
	return p
}

// siteRoutes is the site's mux for /_site/, behind serveSite.
func (s *Server) siteLiveRoutes() *http.ServeMux {
	m := http.NewServeMux()
	m.HandleFunc("GET /_site/me", s.siteMe)
	m.HandleFunc("GET /_site/login", s.siteLogin)
	m.HandleFunc("GET /_site/callback", s.siteCallback)
	m.HandleFunc("POST /_site/logout", s.shellOnly(s.siteLogout))
	m.HandleFunc("POST /_site/views", s.shellOnly(s.openSiteView))
	m.HandleFunc("POST /_site/instances", s.shellOnly(s.createInstance))
	m.HandleFunc("POST /_site/views/{v}/renew", s.shellOnly(s.siteOwnView(s.renewView)))
	m.HandleFunc("POST /_site/views/{v}/consent", s.shellOnly(s.siteOwnView(s.consentView)))
	m.HandleFunc("DELETE /_site/views/{v}", s.shellOnly(s.siteOwnView(s.closeView)))
	m.HandleFunc("/_site/", func(w http.ResponseWriter, r *http.Request) { httpx.Fail(w, 404, "not_found", "Unknown site route") })
	return m
}

func (s *Server) shellOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.shellRequest(r) {
			httpx.Fail(w, 403, "invalid_origin", "Only the site's own pages can do this")
			return
		}
		h(w, r)
	}
}

// siteOwnView runs a view handler for the site session that opened the
// view, through the same principal the main-host handlers read.
func (s *Server) siteOwnView(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, err := s.siteResolve(r)
		if err != nil {
			unavailable(w, err)
			return
		}
		if p == nil {
			httpx.Fail(w, 401, "login_required", "Sign in first")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, &Principal{User: p.User})))
	}
}

func (s *Server) siteMe(w http.ResponseWriter, r *http.Request) {
	p, err := s.siteResolve(r)
	if err != nil {
		unavailable(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if p == nil {
		httpx.OK(w, map[string]any{"kind": "none"})
		return
	}
	httpx.OK(w, map[string]any{"kind": "user", "id": p.User.ID, "name": p.User.DisplayName, "role": p.User.Role})
}

// siteLogin starts a handoff: the main host signs the person in (if it has
// to) and sends them back with a one-time code.
func (s *Server) siteLogin(w http.ResponseWriter, r *http.Request) {
	q := url.Values{"host": {s.siteHost(r.Host)}, "return": {siteReturn(r.URL.Query().Get("return"))}}
	http.Redirect(w, r, s.origins()[0]+"/auth/handoff?"+q.Encode(), http.StatusSeeOther)
}

// handoff answers GET /auth/handoff?host=&return= on the main host: a
// signed-in person goes to the site host's callback with a code that signs
// them in there once, within a minute. Only configured site hosts are
// handed to, so this is no open redirect.
func (s *Server) handoff(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	host := s.siteHost(q.Get("host"))
	if q.Get("host") == "" || host == "" {
		http.Error(w, "unknown site host", http.StatusBadRequest)
		return
	}
	ret := siteReturn(q.Get("return"))
	p, err := s.resolve(r)
	if err != nil {
		unavailable(w, err)
		return
	}
	if p == nil {
		http.Redirect(w, r, "/auth/login?return="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
		return
	}
	if p.User.Role == store.RoleDisabled {
		http.Error(w, "this account is disabled", http.StatusForbidden)
		return
	}
	code := store.RandomHex(24)
	if err = s.Store.SaveHandoff(r.Context(), code, p.User.ID, host, ret); err != nil {
		unavailable(w, err)
		return
	}
	http.Redirect(w, r, s.siteOrigin(host)+"/_site/callback?code="+code, http.StatusSeeOther)
}

func (s *Server) siteCallback(w http.ResponseWriter, r *http.Request) {
	host := s.siteHost(r.Host)
	user, ret, err := s.Store.ConsumeHandoff(r.Context(), r.URL.Query().Get("code"), host)
	if err != nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`<!doctype html><title>Sign-in link expired</title><p style="font:14px Arial;padding:24px">This sign-in link was already used or has expired. <a href="/_site/login">Sign in again</a>.</p>`))
		return
	}
	token, _, err := s.Store.CreateSiteSession(r.Context(), host, user)
	if err != nil {
		unavailable(w, err)
		return
	}
	_ = s.Store.Audit(store.WithAuditVia(r.Context(), "browser"), user, "site.signin", host, nil)
	s.setSiteCookie(w, token, int(store.SiteSessionAbsolute.Seconds()))
	http.Redirect(w, r, siteReturn(ret), http.StatusSeeOther)
}

func (s *Server) siteLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(s.siteCookie()); err == nil && c.Value != "" {
		if err := s.Store.RevokeSiteSession(r.Context(), store.Hash(c.Value)); err != nil {
			unavailable(w, err)
			return
		}
	}
	s.setSiteCookie(w, "", -1)
	httpx.OK(w, map[string]bool{"ok": true})
}

// isolated is the CSP sandbox a site host that runs live apps serves its
// other pages with (decision D8): an opaque origin, so no page on the host
// can send the visitor's site cookie, read the shell or open views as the
// visitor. Scripts, forms, popups, dialogs and downloads still work; Web
// Storage does not, and the runtime gives such pages memory storage.
const isolated = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"

// siteHeaders sets what every site response but the shell and /_site/
// carries: who may frame it, the sandbox when the host runs live apps, and
// open CORS (everything served here is public, and isolated pages fetch it
// from an opaque origin).
func (s *Server) siteHeaders(w http.ResponseWriter, routes []store.Route) {
	csp := "frame-ancestors 'self' " + strings.Join(s.origins(), " ")
	if slices.ContainsFunc(routes, func(rt store.Route) bool { return rt.Live }) {
		csp += "; " + isolated
	}
	w.Header().Set("Content-Security-Policy", csp)
	w.Header().Set("Access-Control-Allow-Origin", "*")
}

// servedRoutes are the routes a site host answers: static public routes,
// and every live route (its access decides who may open the app).
func servedRoutes(routes []store.Route) []store.Route {
	out := routes[:0:0]
	for _, rt := range routes {
		if rt.Live || rt.Access == "public" {
			out = append(out, rt)
		}
	}
	return out
}

// admitted reports whether a live route's access lets p try to open its
// app; the level they get on the target (grants) decides what follows.
func admitted(rt store.Route, p *sitePrincipal) bool {
	if p == nil {
		return false
	}
	switch rt.Access {
	case "admins":
		return p.User.Role == store.RoleAdmin
	case "signed-in", "public":
		return p.User.Role == store.RoleAdmin || p.User.Role == store.RoleMember
	}
	return false
}

// liveTarget is the target a live route runs its app against: the one its
// path names (/blocks/:db with target {db}), its fixed "target" binding, or
// else the page itself. The target must be the app or a data artifact that
// names it, so a route never opens unrelated data.
func (s *Server) liveTarget(ctx context.Context, res routing.Resolution) (store.Artifact, error) {
	id := res.Route.Page
	param, templated := store.TemplatedTarget(res.Route)
	if templated {
		id = res.Params[param]
	} else if b, ok := res.Route.Bindings["target"]; ok {
		id = b.Artifact
	}
	t, err := s.Store.Artifact(ctx, id)
	if err != nil {
		return t, err
	}
	if templated && t.Kind != store.KindData {
		return t, store.ErrNotFound
	}
	if t.ID != res.Route.Page && (t.Kind != store.KindData || t.App != res.Route.Page) {
		return t, store.ErrNotFound
	}
	return t, nil
}

// mayCreate reports whether p may create an instance on a live route.
func mayCreate(rt store.Route, p *sitePrincipal) bool {
	if !admitted(rt, p) {
		return false
	}
	switch rt.Create {
	case "admins":
		return p.User.Role == store.RoleAdmin
	case "signed-in", "public":
		return p.User.Role == store.RoleAdmin || p.User.Role == store.RoleMember
	}
	return false
}

// liveRoute resolves the live route of path on a site request's host.
func (s *Server) liveRoute(ctx context.Context, r *http.Request, path string) (routing.Resolution, bool, error) {
	host := s.siteHost(r.Host)
	routes, err := s.Store.Routes(ctx, host)
	if err != nil {
		return routing.Resolution{}, false, err
	}
	res, ok := routing.Resolve(servedRoutes(routes), host, path)
	return res, ok && res.Route.Live && !res.Fallback, nil
}

// openSiteView answers POST /_site/views {path}: the shell of a live route
// opens a view for the site session, as the Workshop's /run does with the
// main session. The frame's parent is the site origin.
func (s *Server) openSiteView(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
		Link string `json:"link"` // a share link's token, from ?k=
	}
	if err := httpx.Read(w, r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {path}")
		return
	}
	ctx := r.Context()
	res, ok, err := s.liveRoute(ctx, r, in.Path)
	if err != nil {
		unavailable(w, err)
		return
	}
	if !ok {
		httpx.Fail(w, 404, "not_found", "No live route here")
		return
	}
	p, err := s.siteResolve(r)
	if err != nil {
		unavailable(w, err)
		return
	}
	t, err := s.liveTarget(ctx, res)
	if err != nil {
		if _, templated := store.TemplatedTarget(res.Route); templated {
			httpx.JSON(w, 404, map[string]any{"error": httpx.Failure{Code: "no_instance", Message: "There is nothing here yet"},
				"create": res.Route.Create != "", "mayCreate": mayCreate(res.Route, p)})
			return
		}
		httpx.Fail(w, 404, "not_found", "This route's app has nothing to open")
		return
	}
	if p == nil {
		httpx.Fail(w, 401, "login_required", "Sign in to open this")
		return
	}
	if !admitted(res.Route, p) {
		httpx.Fail(w, 403, "not_granted", "You do not have access to this")
		return
	}
	if in.Link != "" {
		_, evs, err := s.Store.RTRedeemLink(ctx, t.ID, in.Link, p.ID())
		if errors.Is(err, store.ErrNotFound) {
			httpx.Fail(w, 403, "link_invalid", "This share link has expired or was revoked")
			return
		}
		if err != nil {
			s.fail(w, err)
			return
		}
		if len(evs) > 0 {
			s.publish(evs)
			s.reviewViews(ctx, t.ID)
		}
	}
	n := 0
	if res.Route.Version != nil {
		n = *res.Route.Version
	}
	v, asks, err := s.newView(ctx, p.User, t.ID, n, "viewer")
	if err != nil {
		s.rtHTTPFail(w, err)
		return
	}
	u, origin, err := s.targetURL(ctx, r, v.Target, v.Version, "app", nil)
	if err != nil {
		s.views.Close(v, false)
		s.rtHTTPFail(w, err)
		return
	}
	httpx.OK(w, viewOut{View: v, Secret: v.Secret, URL: u, Origin: origin, Level: v.Level.String(), Caps: grantedCaps(v), Asks: asks})
}

// createInstance answers POST /_site/instances {path}: on a live route
// whose target is named in the path, a person the route's create policy
// admits gets a new, empty data artifact for its app, which they own.
// Its id is random, so knowing the URL pattern reveals no instance.
func (s *Server) createInstance(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	if err := httpx.Read(w, r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {path}")
		return
	}
	ctx := r.Context()
	res, ok, err := s.liveRoute(ctx, r, in.Path)
	if err != nil {
		unavailable(w, err)
		return
	}
	param, templated := store.TemplatedTarget(res.Route)
	if !ok || !templated || res.Route.Create == "" {
		httpx.Fail(w, 404, "not_found", "Nothing can be created here")
		return
	}
	p, err := s.siteResolve(r)
	if err != nil {
		unavailable(w, err)
		return
	}
	if p == nil {
		httpx.Fail(w, 401, "login_required", "Sign in to create one")
		return
	}
	if !mayCreate(res.Route, p) {
		httpx.Fail(w, 403, "not_granted", "You cannot create one here")
		return
	}
	app, err := s.Store.Artifact(ctx, res.Route.Page)
	if err != nil {
		s.fail(w, err)
		return
	}
	title := firstNonEmpty(p.User.DisplayName, "Someone") + ", " + s.Store.Now().Format("2 Jan 2006") // the shell shows "<app> · <title>"
	b := make([]byte, 10)
	_, _ = rand.Read(b) // never fails (crypto/rand)
	id := "i-" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b))
	a, evs, err := s.Store.CreateArtifact(ctx, id, store.ArtifactInput{Title: title, Kind: store.KindData, App: app.ID, Project: app.Project}, p.User.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.publish(evs)
	params := maps.Clone(res.Params)
	params[param] = a.ID
	path, _ := routing.FillPath(res.Route.Path, params)
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": a.ID, "path": path})
}

// shellBoot is what the shell page starts from.
type shellBoot struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Target  string `json:"target"`
	Sandbox string `json:"sandbox"` // the sandbox domain, to check frame origins
}

var shellPage = template.Must(template.New("shell").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title><link rel="stylesheet" href="{{.CSS}}">
<script type="application/json" id="slop-shell">{{.Boot}}</script>
</head><body>
<header class="shell-bar"><b class="shell-title">{{.Title}}</b><span class="shell-sp"></span><span class="shell-me" id="me"></span></header>
<main class="shell-main"><iframe id="app" title="{{.Title}}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" allow="clipboard-read; clipboard-write"></iframe>
<div class="shell-note" id="note">Opening…</div></main>
<script src="{{.JS}}"></script>
</body></html>`))

// serveShell answers a live route: the shell that opens the app. It holds
// no secret and no data, so it is the same for everyone.
func (s *Server) serveShell(w http.ResponseWriter, r *http.Request, res routing.Resolution) {
	ctx := r.Context()
	title := res.Route.Page
	target := ""
	if t, err := s.liveTarget(ctx, res); err == nil {
		target = t.ID
		if a, err := s.Store.Artifact(ctx, res.Route.Page); err == nil && a.Title != "" {
			title = a.Title
		}
		if t.ID != res.Route.Page && t.Title != "" {
			title += " · " + t.Title
		}
	}
	boot, _ := json.Marshal(shellBoot{Path: r.URL.Path, Title: title, Target: target, Sandbox: s.Config.SandboxDomain})
	var buf bytes.Buffer
	err := shellPage.Execute(&buf, map[string]any{
		"Title": title, "Boot": template.JS(bytes.ReplaceAll(boot, []byte("<"), []byte(`<`))), // #nosec G203 -- JSON, "<" escaped
		"CSS": render.AssetURL("shell.css"), "JS": render.AssetURL("shell.js"),
	})
	if err != nil {
		log.Error().Err(err).Msg("render shell")
		unavailable(w, err)
		return
	}
	sandbox := s.Config.PublicURL.Scheme + "://*." + s.Config.SandboxDomain
	w.Header().Del("Access-Control-Allow-Origin")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src "+sandbox+
		"; frame-ancestors 'self' "+strings.Join(s.origins(), " ")+"; base-uri 'none'; form-action 'self'")
	w.Header().Set("Referrer-Policy", "same-origin")
	s.writePage(w, r, http.StatusOK, buf.Bytes())
}
