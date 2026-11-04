package pages

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
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/ids"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/policy"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Live hosts (SLOP-011 carried over): the shell at mount paths, a site
// session per host (__Host-slop_site, SameSite=Strict), guests, the sign-in
// handoff from the main host, and /_site/* calls from the shell.

func (s *Door) siteCookie() string {
	if s.Cfg.SecureCookies() {
		return "__Host-slop_site"
	}
	return "slop_site"
}

func (s *Door) siteStateCookie() string {
	if s.Cfg.SecureCookies() {
		return "__Host-slop_site_state"
	}
	return "slop_site_state"
}

func (s *Door) setSiteCookie(w http.ResponseWriter, name, value string, maxAge int) {
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
func (s *Door) stateValue(state, guest string) string {
	m := hmac.New(sha256.New, s.rt.key)
	m.Write([]byte(state + "\x00" + guest))
	return state + "." + guest + "." + hex.EncodeToString(m.Sum(nil))[:24]
}

// parseState returns the state and the guest a signed state value names.
func (s *Door) parseState(v string) (string, string, bool) {
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
func (s *Door) sitePrincipal(r *http.Request) (*access.Principal, *identity.Session) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead && s.crossOrigin(r) {
		return nil, nil
	}
	c, err := r.Cookie(s.siteCookie())
	if err != nil || c.Value == "" {
		return nil, nil
	}
	sess, err := s.People.SessionBySecret(r.Context(), c.Value, r.Host)
	if err != nil {
		return nil, nil
	}
	p := s.Web.PersonAs(r.Context(), sess.Person, "page")
	if p == nil {
		return nil, nil
	}
	if p.Kind == access.KindGuest {
		s.People.SeeGuest(r.Context(), c.Value, sess)
	}
	return p, &sess
}

// newGuest gives this browser a guest id on this host.
func (s *Door) newGuest(w http.ResponseWriter, r *http.Request) (*access.Principal, error) {
	ip := s.Web.ClientIP(r)
	limit := s.Cfg.GuestsPerHour
	if limit <= 0 {
		limit = identity.GuestsPerHour
	}
	if s.People.GuestsFrom(r.Context(), ip, time.Now().Add(-time.Hour).UnixMilli()) >= limit {
		return nil, identity.ErrTooManyGuests
	}
	g, err := s.People.CreateGuest(r.Context(), ip)
	if err != nil {
		return nil, err
	}
	secret, _, err := s.People.CreateSessionFor(r.Context(), g.ID, r.Host, "", identity.GuestDays)
	if err != nil {
		return nil, err
	}
	// The cookie outlives any guest; the session (renewed while the guest
	// visits) decides how long the identity lasts.
	s.setSiteCookie(w, s.siteCookie(), secret, 400*24*3600)
	return access.PersonPrincipal(g, "page"), nil
}

// sameOrigin guards /_site/* calls: they must come from this host's pages.
func (s *Door) sameOrigin(r *http.Request) bool {
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
func (s *Door) crossOrigin(r *http.Request) bool {
	if sf := r.Header.Get("Sec-Fetch-Site"); sf != "" && sf != "same-origin" {
		return true
	}
	o := r.Header.Get("Origin")
	return o != "" && o != s.Cfg.Origin(r.Host)
}

// serveLive serves a live host.
func (s *Door) serveLive(w http.ResponseWriter, r *http.Request) {
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
		// slop's icon, unless an app's actor route answered it above.
		if web.IsFavicon(p) && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			web.Favicon(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		s.serveShell(w, r)
	}
}

func (s *Door) siteCall(w http.ResponseWriter, r *http.Request) {
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

func (s *Door) siteMe(w http.ResponseWriter, r *http.Request) {
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
		"audience": s.K.Access.AudienceOf(r.Context(), p)}
	if c := s.claimable(r, p, sess); c != nil {
		out["claim"] = c
	}
	httpx.JSON(w, 200, out)
}

func displayName(p *sysdb.Person) string {
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
func (s *Door) siteOpenView(w http.ResponseWriter, r *http.Request) {
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
		if m.CreateApp != "" && p != nil && s.K.Access.In(ctx, p, access.Group(m.CreateAudience)) {
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
		if d, _, _ := s.K.Access.Can(ctx, nil, res.store, rt.LevelView, "", true); !d.OK && in.Link == "" {
			httpx.Fail(w, 401, "unauthenticated", "sign in to open this")
			return
		}
		if p, err = s.newGuest(w, r); err != nil {
			if errors.Is(err, identity.ErrTooManyGuests) {
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
func (s *Door) siteViewCall(w http.ResponseWriter, r *http.Request, rest string) {
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
		if row, err := s.Registry.StoreByID(r.Context(), v.Target); err != nil || s.recheck(r.Context(), v, row) {
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
func (s *Door) siteLogin(w http.ResponseWriter, r *http.Request) {
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
func (s *Door) handoff(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	host, ret, state := q.Get("host"), siteReturn(q.Get("return")), q.Get("state")
	if s.Cfg.HostKind(host) != "live" || state == "" {
		http.Error(w, "bad handoff", http.StatusBadRequest)
		return
	}
	p, _, _ := s.Web.Principal(r)
	if p == nil || p.Kind != access.KindUser {
		http.Redirect(w, r, "/auth/login?return="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
		return
	}
	code, err := s.People.CreateHandoff(r.Context(), identity.Handoff{Person: p.ID(), Host: host, Return: ret, State: state})
	if err != nil {
		http.Error(w, "handoff failed", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, s.Cfg.Origin(host)+"/_site/callback?code="+url.QueryEscape(code), http.StatusSeeOther)
}

// siteCallback takes the code, checks it against this browser's state
// cookie, and sets the site session.
func (s *Door) siteCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	h, err := s.People.TakeHandoff(ctx, r.URL.Query().Get("code"), r.Host)
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
	secret, _, err := s.People.CreateSession(ctx, h.Person, r.Host, fromGuest)
	if err != nil {
		http.Error(w, "sign-in failed", http.StatusInternalServerError)
		return
	}
	s.setSiteCookie(w, s.siteCookie(), secret, 30*24*3600)
	http.Redirect(w, r, h.Return, http.StatusSeeOther)
}

func (s *Door) siteLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(s.siteCookie()); err == nil {
		_ = s.People.DeleteSession(r.Context(), c.Value)
	}
	s.setSiteCookie(w, s.siteCookie(), "", -1)
	httpx.JSON(w, 200, map[string]any{"ok": true})
}

// siteCreate makes a new store of a mount's app for a member and returns
// its path.
func (s *Door) siteCreate(w http.ResponseWriter, r *http.Request) {
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
	mounts, err := s.Registry.Mounts(ctx, r.Host)
	if err != nil {
		failView(w, err)
		return
	}
	m, ok := registry.BestMount(mounts, in.Path)
	if !ok || m.Mount.CreateApp == "" || m.Mount.StoreParam == "" {
		httpx.Fail(w, 404, "not_found", "nothing can be created here")
		return
	}
	if !s.K.Access.In(ctx, p, access.Group(m.Mount.CreateAudience)) {
		httpx.Fail(w, 403, "audience_required", "creating one here is for "+m.Mount.CreateAudience+"s")
		return
	}
	row, _, err := s.K.CreateStore(ctx, p, kernel.NewStore{Type: m.Mount.Type, App: m.Mount.CreateApp})
	if err != nil {
		failView(w, err)
		return
	}
	// The mount's alias template binds the new store (SLOP3-008 phase 4), as
	// the admin who set it checked; its owner can change them afterwards.
	for _, b := range m.Mount.Aliases {
		b.Store = row.ID
		if err := s.Registry.SetBinding(ctx, p.ID(), "mount:"+m.Mount.Host+m.Mount.Path, b); err != nil {
			failView(w, err)
			return
		}
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
func (s *Door) managed(w http.ResponseWriter, r *http.Request, path string) (string, *access.Principal, bool) {
	ctx := r.Context()
	p, _ := s.sitePrincipal(r)
	res, err := s.resolve(ctx, r.Host, path)
	if err != nil || p == nil {
		httpx.Fail(w, 404, "not_found", "nothing to share here")
		return "", nil, false
	}
	d, _, _ := s.K.Access.Can(ctx, p, res.store, rt.LevelOwner, "sharing", true)
	if !d.OK && !p.IsAdmin() {
		httpx.Fail(w, 403, "permission_denied", "only the owner shares this")
		return "", nil, false
	}
	return res.store, p, true
}

func (s *Door) siteAccess(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	_ = httpx.Read(r, &in, 4<<10)
	id, _, ok := s.managed(w, r, in.Path)
	if !ok {
		return
	}
	gs, err := s.Registry.Grants(r.Context(), id)
	if err != nil {
		failView(w, err)
		return
	}
	type grantOut struct {
		sysdb.Grant
		Name string `json:"name,omitempty"`
	}
	out := []grantOut{}
	for _, g := range gs {
		o := grantOut{Grant: g}
		if pp, err := s.People.Person(r.Context(), g.Subject); err == nil {
			o.Name = displayName(&pp)
		}
		out = append(out, o)
	}
	links, err := s.Registry.Links(r.Context(), id)
	if err != nil {
		failView(w, err)
		return
	}
	live := []sysdb.Link{}
	for _, l := range links {
		if l.RevokedAt == 0 && (l.ExpiresAt == 0 || l.ExpiresAt > time.Now().UnixMilli()) {
			live = append(live, l)
		}
	}
	httpx.JSON(w, 200, map[string]any{"store": id, "grants": out, "links": live})
}

// siteGrant sets or removes a grant; owners give view or interact here.
func (s *Door) siteGrant(w http.ResponseWriter, r *http.Request) {
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
		_, err := s.Registry.RemoveGrant(ctx, p.ID(), "site", id, in.Subject, "")
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
	if _, err := s.Registry.SetGrant(ctx, p.ID(), "site", sysdb.Grant{Store: id, Subject: in.Subject, Level: in.Level}); err != nil {
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
func (s *Door) reviewViews(ctx context.Context, id string) {
	// The store's own views, and views of other stores that read it
	// (SLOP3-008): each is checked against its own store's row.
	rows := map[string]sysdb.StoreRow{}
	for _, v := range s.rt.views.Reaching(id) {
		row, ok := rows[v.Target]
		if !ok {
			r, err := s.Registry.StoreByID(ctx, v.Target)
			if err != nil {
				continue
			}
			row, rows[v.Target] = r, r
		}
		s.recheck(ctx, v, row)
	}
}

// confirm reports whether v may still act with the level, audience and
// policy it was opened with. They are a cache of a decision made from
// system.db, valid at the epoch it was made at; after any write the view's
// next use decides again and closes it if the answer changed, so access
// follows the state even when no hook called reviewViews.
func (s *Door) confirm(ctx context.Context, v *rt.View) bool {
	e := s.Sys.Epoch()
	if v.Epoch.Load() == e {
		return true
	}
	row, err := s.Registry.StoreByID(ctx, v.Target)
	if errors.Is(err, sysdb.ErrNotFound) {
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
func (s *Door) recheck(ctx context.Context, v *rt.View, row sysdb.StoreRow) bool {
	d := s.K.Access.Level(ctx, s.viewPrincipal(ctx, v), row)
	switch {
	case d.Level == rt.LevelNone:
		s.rt.views.Close(v, true)
	case d.Level != v.Level || string(d.Audience) != v.Role || !s.samePolicy(ctx, v, string(d.Audience)) ||
		!s.db.Space(ctx, v.Target, v.Caps, v.Policy["stores"]).Equal(v.Space) || // its aliases changed (SLOP3-008)
		s.remoteLevelsMoved(ctx, v): // or the viewer's level on a store it reads
		v.Send(rt.Out{Type: "access", Data: map[string]any{"level": d.Level.String()}})
		s.rt.views.Close(v, false)
	default:
		return false
	}
	return true
}

// samePolicy reports whether the app's policy cells for aud are still the
// ones v was opened with (they authorize uploads, email, sample).
func (s *Door) samePolicy(ctx context.Context, v *rt.View, aud string) bool {
	for _, c := range policy.PolicyCaps {
		if s.Gov.Policy(ctx, v.App, c, aud) != v.Policy[c] {
			return false
		}
	}
	return true
}

// reviewApp re-checks the open views of every store running app, after its
// policy matrix changed.
func (s *Door) reviewApp(ctx context.Context, app string) {
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
<title>{{.Title}}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="{{.CSS}}">
<script type="application/json" id="slop-shell">{{.Boot}}</script></head>
<body><header class="shell-bar"><span class="shell-title">{{.Title}}</span><span class="shell-sp"></span>
<button type="button" class="shell-btn" id="share" hidden>Share</button><span class="shell-me" id="me"></span></header>
<main class="shell-main"><iframe id="app" hidden allow="clipboard-write; fullscreen" title="{{.Title}}"></iframe><div class="shell-note" id="note">Opening…</div></main>
<script src="{{.JS}}"></script></body></html>`))

// serveShell answers a mount path on a live host with the shell, which
// opens a view and frames the app.
func (s *Door) serveShell(w http.ResponseWriter, r *http.Request) {
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
		if run, err := s.K.Running(ctx, res.m.Mount.CreateApp); err == nil && run.Manifest != nil && run.Manifest.Title != "" {
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
func (s *Door) siteConfirm(w http.ResponseWriter, r *http.Request, id string) {
	p, _ := s.sitePrincipal(r)
	if p == nil || p.Person == nil {
		httpx.Fail(w, 404, "not_found", "no such confirmation")
		return
	}
	book := s.Confirm
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
