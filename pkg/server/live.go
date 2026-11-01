package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html/template"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/httpx"
	"github.com/go-go-golems/slop/pkg/ids"
	"github.com/go-go-golems/slop/pkg/kernel"
	"github.com/go-go-golems/slop/pkg/rt"
	"github.com/go-go-golems/slop/pkg/system"
)

// Live hosts (SLOP-011 carried over): the shell at mount paths, a site
// session per host (__Host-slop_site, SameSite=Strict), guests, the sign-in
// handoff from the main host, and /_site/* calls from the shell.

func (s *Server) siteCookie() string {
	if s.Cfg.SecureCookies() {
		return "__Host-slop_site"
	}
	return "slop_site"
}

func (s *Server) siteStateCookie() string {
	if s.Cfg.SecureCookies() {
		return "__Host-slop_site_state"
	}
	return "slop_site_state"
}

func (s *Server) setSiteCookie(w http.ResponseWriter, name, value string, maxAge int) {
	// The session is Strict. The sign-in state is Lax: the return from the
	// main host is a cross-site navigation, where Strict cookies are withheld.
	same := http.SameSiteStrictMode
	if name == s.siteStateCookie() {
		same = http.SameSiteLaxMode
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true,
		Secure: s.Cfg.SecureCookies(), SameSite: same})
}

// stateValue binds a handoff state to the guest this browser was (signed,
// so a browser cannot name someone else's guest).
func (s *Server) stateValue(state, guest string) string {
	m := hmac.New(sha256.New, s.rt.key)
	m.Write([]byte(state + "\x00" + guest))
	return state + "." + guest + "." + hex.EncodeToString(m.Sum(nil))[:24]
}

func (s *Server) parseState(v string) (state, guest string, ok bool) {
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return "", "", false
	}
	if !hmac.Equal([]byte(s.stateValue(parts[0], parts[1])), []byte(v)) {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// sitePrincipal is whoever this browser is on this live host: a user, a
// guest, or nil.
func (s *Server) sitePrincipal(r *http.Request) (*access.Principal, *system.Session) {
	c, err := r.Cookie(s.siteCookie())
	if err != nil || c.Value == "" {
		return nil, nil
	}
	sess, err := s.Sys.SessionBySecret(r.Context(), c.Value, r.Host)
	if err != nil {
		return nil, nil
	}
	p, err := s.Sys.Person(r.Context(), sess.Person)
	if err != nil || p.Role == system.RoleDisabled {
		return nil, nil
	}
	kind := access.KindUser
	if p.Kind == "guest" {
		kind = access.KindGuest
	}
	return &access.Principal{Kind: kind, Person: &p, Via: "page"}, &sess
}

// newGuest gives this browser a guest id on this host.
func (s *Server) newGuest(w http.ResponseWriter, r *http.Request) (*access.Principal, error) {
	g, err := s.Sys.CreateGuest(r.Context(), s.clientIP(r))
	if err != nil {
		return nil, err
	}
	secret, _, err := s.Sys.CreateSession(r.Context(), g.ID, r.Host, "")
	if err != nil {
		return nil, err
	}
	s.setSiteCookie(w, s.siteCookie(), secret, 400*24*3600)
	return &access.Principal{Kind: access.KindGuest, Person: &g, Via: "page"}, nil
}

// sameOrigin guards /_site/* calls: they must come from this host's pages.
func (s *Server) sameOrigin(r *http.Request) bool {
	if sf := r.Header.Get("Sec-Fetch-Site"); sf != "" && sf != "same-origin" {
		return false
	}
	if o := r.Header.Get("Origin"); o != "" && o != s.Cfg.Origin(r.Host) {
		return false
	}
	if r.Method == http.MethodPost && r.ContentLength != 0 && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return false
	}
	return true
}

// serveLive serves a live host.
func (s *Server) serveLive(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	switch {
	case strings.HasPrefix(p, "/_slop/"):
		serveAsset(w, r)
	case strings.HasPrefix(p, "/_s/"):
		pr, _ := s.sitePrincipal(r)
		s.serveStoreFile(w, r, pr)
	case p == "/_site/login" && r.Method == http.MethodGet:
		s.siteLogin(w, r)
	case p == "/_site/callback" && r.Method == http.MethodGet:
		s.siteCallback(w, r)
	case strings.HasPrefix(p, "/_site/"):
		if !s.sameOrigin(r) {
			httpx.Fail(w, 403, "permission_denied", "cross-origin site call")
			return
		}
		s.siteCall(w, r)
	case r.Method == http.MethodGet || r.Method == http.MethodHead:
		s.serveShell(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) siteCall(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	switch {
	case p == "/_site/me":
		s.siteMe(w, r)
	case p == "/_site/views" && r.Method == http.MethodPost:
		s.siteOpenView(w, r)
	case strings.HasPrefix(p, "/_site/views/"):
		s.siteViewCall(w, r, strings.TrimPrefix(p, "/_site/views/"))
	case p == "/_site/logout" && r.Method == http.MethodPost:
		s.siteLogout(w, r)
	case p == "/_site/create" && r.Method == http.MethodPost:
		s.siteCreate(w, r)
	case p == "/_site/access" && r.Method == http.MethodPost:
		s.siteAccess(w, r)
	case p == "/_site/grants" && r.Method == http.MethodPost:
		s.siteGrant(w, r)
	default:
		httpx.Fail(w, 404, "not_found", "no such site call")
	}
}

func (s *Server) siteMe(w http.ResponseWriter, r *http.Request) {
	p, _ := s.sitePrincipal(r)
	if p == nil {
		httpx.JSON(w, 200, map[string]any{"kind": "none", "audience": access.AudGuest})
		return
	}
	kind := "user"
	if p.Kind == access.KindGuest {
		kind = "guest"
	}
	httpx.JSON(w, 200, map[string]any{"kind": kind, "id": p.ID(), "name": displayName(p.Person), "role": p.Role(),
		"audience": s.Env.K.Access.AudienceOf(r.Context(), p)})
}

func displayName(p *system.Person) string {
	if p == nil {
		return ""
	}
	if p.Kind == "guest" {
		return "Guest"
	}
	if p.Name != "" {
		return p.Name
	}
	name, _, _ := strings.Cut(p.Email, "@")
	return name
}

// siteOpenView opens a view on the store of the mount a path names.
func (s *Server) siteOpenView(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	if err := httpx.Read(r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_argument", "send {path}")
		return
	}
	ctx := r.Context()
	res, err := s.resolve(ctx, r.Host, in.Path)
	p, _ := s.sitePrincipal(r)
	if errors.Is(err, errNoStore) {
		m := res.m.Mount
		out := map[string]any{"error": map[string]string{"code": "no_instance", "message": "nothing is here yet"}, "create": m.CreateApp != ""}
		if m.CreateApp != "" && p != nil && s.Env.K.Access.AudienceOf(ctx, p).AtLeast(access.Audience(m.CreateAudience)) {
			out["mayCreate"] = true
		}
		httpx.JSON(w, 404, out)
		return
	}
	if err != nil {
		httpx.Fail(w, 404, "not_found", "nothing is mounted here")
		return
	}
	if p == nil {
		// Guests get an id when the store gives guests a level, so that
		// what they write records who wrote it.
		if d, _, _ := s.Env.K.Access.Can(ctx, nil, res.store, rt.LevelView, "", true); !d.OK {
			httpx.Fail(w, 401, "unauthenticated", "sign in to open this")
			return
		}
		if p, err = s.newGuest(w, r); err != nil {
			failView(w, err)
			return
		}
	}
	v, err := s.openView(ctx, p, res.store, s.Cfg.Origin(r.Host))
	if err != nil {
		var f *rtFail
		if errors.As(err, &f) && f.Code == "not_granted" && p.Kind == access.KindGuest {
			httpx.Fail(w, 401, "unauthenticated", "sign in to open this")
			return
		}
		failView(w, err)
		return
	}
	httpx.JSON(w, 200, v)
}

// siteViewCall: POST <id>/renew, DELETE <id>, POST <id>/consent.
func (s *Server) siteViewCall(w http.ResponseWriter, r *http.Request, rest string) {
	id, op, _ := strings.Cut(rest, "/")
	v := s.rt.views.Get(id)
	p, _ := s.sitePrincipal(r)
	if v == nil || p == nil || v.User != p.ID() {
		httpx.Fail(w, 404, "not_found", "no such view")
		return
	}
	switch {
	case op == "renew" && r.Method == http.MethodPost:
		s.rt.views.Renew(v)
		httpx.JSON(w, 200, map[string]any{"view": v.ID, "secret": v.Secret, "expiresAt": v.Expires})
	case op == "" && r.Method == http.MethodDelete:
		s.rt.views.Close(v, false)
		httpx.JSON(w, 200, map[string]any{"ok": true})
	case op == "consent" && r.Method == http.MethodPost:
		httpx.JSON(w, 200, map[string]any{"ok": true})
	default:
		httpx.Fail(w, 404, "not_found", "no such view call")
	}
}

// siteReturn keeps a return path on this host.
func siteReturn(p string) string {
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || strings.HasPrefix(p, "/_site/") {
		return "/"
	}
	return p
}

// siteLogin starts the handoff: a state cookie bound to this browser, then
// the main host's /auth/handoff.
func (s *Server) siteLogin(w http.ResponseWriter, r *http.Request) {
	state := ids.Secret("st_")
	guest := ""
	if p, _ := s.sitePrincipal(r); p != nil && p.Kind == access.KindGuest {
		guest = p.ID()
	}
	s.setSiteCookie(w, s.siteStateCookie(), s.stateValue(state, guest), 600)
	q := url.Values{"host": {r.Host}, "return": {siteReturn(r.URL.Query().Get("return"))}, "state": {state}}
	http.Redirect(w, r, s.Cfg.MainURL()+"/auth/handoff?"+q.Encode(), http.StatusSeeOther)
}

// handoff (main host) signs the person in if needed and sends a one-time
// code back to the live host.
func (s *Server) handoff(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	host, ret, state := q.Get("host"), siteReturn(q.Get("return")), q.Get("state")
	if s.Cfg.HostKind(host) != "live" || state == "" {
		http.Error(w, "bad handoff", http.StatusBadRequest)
		return
	}
	p, _, _ := s.principalOf(r)
	if p == nil || p.Kind != access.KindUser {
		http.Redirect(w, r, "/auth/login?return="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
		return
	}
	code, err := s.Sys.CreateHandoff(r.Context(), system.Handoff{Person: p.ID(), Host: host, Return: ret, State: state})
	if err != nil {
		http.Error(w, "handoff failed", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, s.Cfg.Origin(host)+"/_site/callback?code="+url.QueryEscape(code), http.StatusSeeOther)
}

// siteCallback takes the code, checks it against this browser's state
// cookie, and sets the site session.
func (s *Server) siteCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	h, err := s.Sys.TakeHandoff(ctx, r.URL.Query().Get("code"), r.Host)
	c, cerr := r.Cookie(s.siteStateCookie())
	var state, fromGuest string
	ok := false
	if cerr == nil {
		state, fromGuest, ok = s.parseState(c.Value)
	}
	if err != nil || !ok || state != h.State {
		http.Error(w, "this sign-in link is not valid here; try again", http.StatusBadRequest)
		return
	}
	s.setSiteCookie(w, s.siteStateCookie(), "", -1)
	secret, _, err := s.Sys.CreateSession(ctx, h.Person, r.Host, fromGuest)
	if err != nil {
		http.Error(w, "sign-in failed", http.StatusInternalServerError)
		return
	}
	s.setSiteCookie(w, s.siteCookie(), secret, 30*24*3600)
	http.Redirect(w, r, h.Return, http.StatusSeeOther)
}

func (s *Server) siteLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(s.siteCookie()); err == nil {
		_ = s.Sys.DeleteSession(r.Context(), c.Value)
	}
	s.setSiteCookie(w, s.siteCookie(), "", -1)
	httpx.JSON(w, 200, map[string]any{"ok": true})
}

// siteCreate makes a new store of a mount's app for a member and returns
// its path.
func (s *Server) siteCreate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	if err := httpx.Read(r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_argument", "send {path}")
		return
	}
	ctx := r.Context()
	p, _ := s.sitePrincipal(r)
	if p == nil || p.Kind != access.KindUser {
		httpx.Fail(w, 401, "unauthenticated", "sign in to create one")
		return
	}
	mounts, err := s.Sys.Mounts(ctx, r.Host)
	if err != nil {
		failView(w, err)
		return
	}
	m, ok := system.BestMount(mounts, in.Path)
	if !ok || m.Mount.CreateApp == "" || m.Mount.StoreParam == "" {
		httpx.Fail(w, 404, "not_found", "nothing can be created here")
		return
	}
	if !s.Env.K.Access.AudienceOf(ctx, p).AtLeast(access.Audience(m.Mount.CreateAudience)) {
		httpx.Fail(w, 403, "audience_required", "creating one here is for "+m.Mount.CreateAudience+"s")
		return
	}
	row, _, err := s.Env.K.CreateStore(ctx, p, kernel.NewStore{Type: m.Mount.Type, App: m.Mount.CreateApp})
	if err != nil {
		failView(w, err)
		return
	}
	httpx.JSON(w, 201, map[string]any{"store": row.ID, "path": mountPath(m.Mount.Path, m.Params, m.Mount.StoreParam, row.ID)})
}

// mountPath fills a mount pattern's params (the store param with id).
func mountPath(pattern string, params map[string]string, storeParam, id string) string {
	segs := strings.Split(strings.Trim(pattern, "/"), "/")
	out := []string{}
	for _, sg := range segs {
		switch {
		case sg == "*":
		case sg == ":"+storeParam:
			out = append(out, id)
		case strings.HasPrefix(sg, ":"):
			out = append(out, params[sg[1:]])
		default:
			out = append(out, sg)
		}
	}
	return "/" + strings.Join(out, "/")
}

// managed resolves a path to a store the caller owns (or administers).
func (s *Server) managed(w http.ResponseWriter, r *http.Request, path string) (string, *access.Principal, bool) {
	ctx := r.Context()
	p, _ := s.sitePrincipal(r)
	res, err := s.resolve(ctx, r.Host, path)
	if err != nil || p == nil {
		httpx.Fail(w, 404, "not_found", "nothing to share here")
		return "", nil, false
	}
	d, _, _ := s.Env.K.Access.Can(ctx, p, res.store, rt.LevelOwner, "sharing", true)
	if !d.OK && !p.IsAdmin() {
		httpx.Fail(w, 403, "permission_denied", "only the owner shares this")
		return "", nil, false
	}
	return res.store, p, true
}

func (s *Server) siteAccess(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	_ = httpx.Read(r, &in, 4<<10)
	id, _, ok := s.managed(w, r, in.Path)
	if !ok {
		return
	}
	gs, err := s.Sys.Grants(r.Context(), id)
	if err != nil {
		failView(w, err)
		return
	}
	type grantOut struct {
		system.Grant
		Name string `json:"name,omitempty"`
	}
	out := []grantOut{}
	for _, g := range gs {
		o := grantOut{Grant: g}
		if pp, err := s.Sys.Person(r.Context(), g.Subject); err == nil {
			o.Name = displayName(&pp)
		}
		out = append(out, o)
	}
	httpx.JSON(w, 200, map[string]any{"store": id, "grants": out, "links": []any{}})
}

// siteGrant sets or removes a grant; owners give view or interact here.
func (s *Server) siteGrant(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path    string `json:"path"`
		Subject string `json:"subject"`
		Level   string `json:"level"`
	}
	if err := httpx.Read(r, &in, 4<<10); err != nil {
		httpx.Fail(w, 400, "invalid_argument", "send {path, subject, level}")
		return
	}
	id, p, ok := s.managed(w, r, in.Path)
	if !ok {
		return
	}
	ctx := r.Context()
	if in.Level == "" {
		_, err := s.Sys.RemoveGrant(ctx, p.ID(), "site", id, in.Subject, "")
		if err != nil {
			failView(w, err)
			return
		}
		s.reviewViews(ctx, id)
		httpx.JSON(w, 200, map[string]any{"ok": true})
		return
	}
	if in.Level != "view" && in.Level != "interact" {
		httpx.Fail(w, 400, "invalid_argument", "owners give view or interact here")
		return
	}
	if _, err := s.Sys.SetGrant(ctx, p.ID(), "site", system.Grant{Store: id, Subject: in.Subject, Level: in.Level}); err != nil {
		failView(w, err)
		return
	}
	s.reviewViews(ctx, id)
	httpx.JSON(w, 200, map[string]any{"ok": true})
}

// reviewViews re-checks the open views of a store after its access
// changed: a view whose level changed gets access (reopen) or revoked.
func (s *Server) reviewViews(ctx context.Context, id string) {
	row, err := s.Sys.StoreByID(ctx, id)
	if err != nil {
		return
	}
	for _, v := range s.rt.views.Of(id) {
		var p *access.Principal
		if v.User != "" {
			if pp, err := s.Sys.Person(ctx, v.User); err == nil {
				kind := access.KindUser
				if pp.Kind == "guest" {
					kind = access.KindGuest
				}
				p = &access.Principal{Kind: kind, Person: &pp}
			}
		}
		d := s.Env.K.Access.Level(ctx, p, row)
		switch {
		case d.Level == rt.LevelNone:
			s.rt.views.Close(v, true)
		case d.Level != v.Level:
			v.Send(rt.Out{Type: "access", Data: map[string]any{"level": d.Level.String()}})
		}
	}
}

var shellPage = template.Must(template.New("shell").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Title}}</title><link rel="stylesheet" href="{{.CSS}}">
<script type="application/json" id="slop-shell">{{.Boot}}</script></head>
<body><header class="shell-bar"><span class="shell-title">{{.Title}}</span><span class="shell-sp"></span>
<button type="button" class="shell-btn" id="share" hidden>Share</button><span class="shell-me" id="me"></span></header>
<main class="shell-main"><iframe id="app" hidden allow="clipboard-write; fullscreen" title="{{.Title}}"></iframe><div class="shell-note" id="note">Opening…</div></main>
<script src="{{.JS}}"></script></body></html>`))

// serveShell answers a mount path on a live host with the shell, which
// opens a view and frames the app.
func (s *Server) serveShell(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	res, err := s.resolve(ctx, r.Host, r.URL.Path)
	if err != nil && !errors.Is(err, errNoStore) {
		notFound(w)
		return
	}
	title := "slop"
	if err == nil && res.run.Manifest != nil && res.run.Manifest.Title != "" {
		title = res.run.Manifest.Title
	} else if res != nil && res.m.Mount.CreateApp != "" {
		if run, err := s.Env.K.Running(ctx, res.m.Mount.CreateApp); err == nil && run.Manifest != nil && run.Manifest.Title != "" {
			title = run.Manifest.Title
		}
	}
	boot, _ := json.Marshal(map[string]any{"title": title, "sandbox": s.Cfg.Hosts.Sandbox, "main": s.Cfg.MainURL()})
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
	w.Header().Set("Referrer-Policy", "same-origin")
	_ = shellPage.Execute(w, map[string]any{"Title": title, "CSS": assetURL("shell.css"), "JS": assetURL("shell.js"),
		"Boot": template.JS(boot)})
}

