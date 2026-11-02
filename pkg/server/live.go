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
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/ids"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/system"
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
// guest, or nil. The cookie names the person only on safe requests or on
// requests from this host's own pages: an unsafe request from another
// origin acts as nobody (an app's sandbox origin is same-site, so SameSite
// cookies alone would let its pages post as the person).
func (s *Server) sitePrincipal(r *http.Request) (*access.Principal, *system.Session) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead && s.crossOrigin(r) {
		return nil, nil
	}
	c, err := r.Cookie(s.siteCookie())
	if err != nil || c.Value == "" {
		return nil, nil
	}
	sess, err := s.Sys.SessionBySecret(r.Context(), c.Value, r.Host)
	if err != nil {
		return nil, nil
	}
	p := s.personAs(r.Context(), sess.Person, "page")
	if p == nil {
		return nil, nil
	}
	if p.Kind == access.KindGuest {
		s.Sys.SeeGuest(r.Context(), c.Value, sess)
	}
	return p, &sess
}

// newGuest gives this browser a guest id on this host.
func (s *Server) newGuest(w http.ResponseWriter, r *http.Request) (*access.Principal, error) {
	ip := s.clientIP(r)
	limit := s.Cfg.GuestsPerHour
	if limit <= 0 {
		limit = system.GuestsPerHour
	}
	if s.Sys.GuestsFrom(r.Context(), ip, time.Now().Add(-time.Hour).UnixMilli()) >= limit {
		return nil, system.ErrTooManyGuests
	}
	g, err := s.Sys.CreateGuest(r.Context(), ip)
	if err != nil {
		return nil, err
	}
	secret, _, err := s.Sys.CreateSessionFor(r.Context(), g.ID, r.Host, "", system.GuestDays)
	if err != nil {
		return nil, err
	}
	// The cookie outlives any guest; the session (renewed while the guest
	// visits) decides how long the identity lasts.
	s.setSiteCookie(w, s.siteCookie(), secret, 400*24*3600)
	return access.PersonPrincipal(g, "page"), nil
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

// crossOrigin reports a request the browser says came from another
// origin. Sandbox origins are same-site with the live host, so SameSite
// cookies alone do not keep their pages from posting with a session.
func (s *Server) crossOrigin(r *http.Request) bool {
	if sf := r.Header.Get("Sec-Fetch-Site"); sf != "" && sf != "same-origin" {
		return true
	}
	o := r.Header.Get("Origin")
	return o != "" && o != s.Cfg.Origin(r.Host)
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
	default:
		// An actor route on the mount answers first; then the shell.
		if res, err := s.resolve(r.Context(), r.Host, p); err == nil {
			pr, _ := s.sitePrincipal(r)
			if s.serveActorRoute(w, r, res, pr) {
				return
			}
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		s.serveShell(w, r)
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
	case p == "/_site/links" && r.Method == http.MethodPost:
		s.siteLinks(w, r)
	case strings.HasPrefix(p, "/_site/links/") && strings.HasSuffix(p, "/revoke") && r.Method == http.MethodPost:
		s.siteRevokeLink(w, r, strings.TrimSuffix(strings.TrimPrefix(p, "/_site/links/"), "/revoke"))
	case p == "/_site/claim" && r.Method == http.MethodPost:
		s.siteClaim(w, r)
	case strings.HasPrefix(p, "/_site/confirm/"):
		s.siteConfirm(w, r, strings.TrimPrefix(p, "/_site/confirm/"))
	default:
		httpx.Fail(w, 404, "not_found", "no such site call")
	}
}

func (s *Server) siteMe(w http.ResponseWriter, r *http.Request) {
	p, sess := s.sitePrincipal(r)
	if p == nil {
		httpx.JSON(w, 200, map[string]any{"kind": "none", "audience": access.AudGuest})
		return
	}
	kind := "user"
	if p.Kind == access.KindGuest {
		kind = "guest"
	}
	out := map[string]any{"kind": kind, "id": p.ID(), "name": displayName(p.Person), "role": p.Role(),
		"audience": s.Env.K.Access.AudienceOf(r.Context(), p)}
	if c := s.claimable(r, p, sess); c != nil {
		out["claim"] = c
	}
	httpx.JSON(w, 200, out)
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
		Link string `json:"link"` // a share link's token, from ?k=
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
		if m.CreateApp != "" && p != nil && s.Env.K.Access.In(ctx, p, access.Group(m.CreateAudience)) {
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
		// Guests get an id when the store gives guests a level, or when
		// they bring a share link, so that what they write records who
		// wrote it.
		if d, _, _ := s.Env.K.Access.Can(ctx, nil, res.store, rt.LevelView, "", true); !d.OK && in.Link == "" {
			httpx.Fail(w, 401, "unauthenticated", "sign in to open this")
			return
		}
		if p, err = s.newGuest(w, r); err != nil {
			if errors.Is(err, system.ErrTooManyGuests) {
				httpx.Fail(w, 429, "rate_limited", err.Error())
				return
			}
			failView(w, err)
			return
		}
	}
	if in.Link != "" {
		if err := s.redeemLink(ctx, res.store, in.Link, p); err != nil {
			httpx.Fail(w, 403, "link_invalid", "this share link has expired or was revoked")
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
		// a view whose access changed is not renewed: the shell opens a new one
		if row, err := s.Sys.StoreByID(r.Context(), v.Target); err != nil || s.recheck(r.Context(), v, row) {
			httpx.Fail(w, 404, "not_found", "no such view")
			return
		}
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
	if !s.Env.K.Access.In(ctx, p, access.Group(m.Mount.CreateAudience)) {
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
	links, err := s.Sys.Links(r.Context(), id)
	if err != nil {
		failView(w, err)
		return
	}
	live := []system.Link{}
	for _, l := range links {
		if l.RevokedAt == 0 && (l.ExpiresAt == 0 || l.ExpiresAt > time.Now().UnixMilli()) {
			live = append(live, l)
		}
	}
	httpx.JSON(w, 200, map[string]any{"store": id, "grants": out, "links": live})
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
// changed. A view whose viewer now has another level or audience is closed:
// revoked when no access is left, otherwise after an access event, on which
// the page reopens at the new level (the shell does this). Calling it is
// not what makes access correct (confirm does that on the view's next use);
// it tells idle pages now rather than at their next call.
func (s *Server) reviewViews(ctx context.Context, id string) {
	row, err := s.Sys.StoreByID(ctx, id)
	if err != nil {
		return
	}
	for _, v := range s.rt.views.Of(id) {
		s.recheck(ctx, v, row)
	}
}

// confirm reports whether v may still act with the level, audience and
// policy it was opened with. They are a cache of a decision made from
// system.db, valid at the epoch it was made at; after any write the view's
// next use decides again and closes it if the answer changed, so access
// follows the state even when no hook called reviewViews.
func (s *Server) confirm(ctx context.Context, v *rt.View) bool {
	e := s.Sys.Epoch()
	if v.Epoch.Load() == e {
		return true
	}
	row, err := s.Sys.StoreByID(ctx, v.Target)
	if errors.Is(err, system.ErrNotFound) {
		s.rt.views.Close(v, true)
		return false
	}
	if err != nil {
		return false // refuse this call; the next one asks again
	}
	if s.recheck(ctx, v, row) {
		return false
	}
	v.Epoch.Store(e)
	return true
}

// recheck closes v when its viewer's access to row is no longer the one v
// was opened with, and reports whether it did.
func (s *Server) recheck(ctx context.Context, v *rt.View, row system.StoreRow) bool {
	d := s.Env.K.Access.Level(ctx, s.viewPrincipal(ctx, v), row)
	switch {
	case d.Level == rt.LevelNone:
		s.rt.views.Close(v, true)
	case d.Level != v.Level || string(d.Audience) != v.Role || !s.samePolicy(ctx, v, string(d.Audience)):
		v.Send(rt.Out{Type: "access", Data: map[string]any{"level": d.Level.String()}})
		s.rt.views.Close(v, false)
	default:
		return false
	}
	return true
}

// samePolicy reports whether the app's policy cells for aud are still the
// ones v was opened with (they authorize uploads, email, sample).
func (s *Server) samePolicy(ctx context.Context, v *rt.View, aud string) bool {
	for _, c := range system.PolicyCaps {
		if s.Sys.Policy(ctx, v.App, c, aud) != v.Policy[c] {
			return false
		}
	}
	return true
}

// reviewApp re-checks the open views of every store running app, after its
// policy matrix changed.
func (s *Server) reviewApp(ctx context.Context, app string) {
	seen := map[string]bool{}
	for _, v := range s.rt.views.Where(func(v *rt.View) bool { return v.App == app }) {
		if !seen[v.Target] {
			seen[v.Target] = true
			s.reviewViews(ctx, v.Target)
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

// siteConfirm is the shell's side of a confirmation (SLOP3-002): GET shows
// what an app asks to do for the signed-in person, POST allows it. The
// shell runs outside the app's frame, so the app can neither draw nor
// answer this dialog.
func (s *Server) siteConfirm(w http.ResponseWriter, r *http.Request, id string) {
	p, _ := s.sitePrincipal(r)
	if p == nil || p.Person == nil {
		httpx.Fail(w, 404, "not_found", "no such confirmation")
		return
	}
	book := s.Env.Confirmations()
	switch r.Method {
	case http.MethodGet:
		if c, ok := book.Get(id, p.ID()); ok {
			httpx.JSON(w, 200, c)
			return
		}
	case http.MethodPost:
		if c, ok := book.Approve(id, p.ID()); ok {
			httpx.JSON(w, 200, c)
			return
		}
	}
	httpx.Fail(w, 404, "not_found", "no such confirmation")
}
