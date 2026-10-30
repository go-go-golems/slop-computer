package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// siteBrowser is a browser on the site host site.test: its own cookie (the
// harness's jar keys cookies by URL, not by Host), Host and Origin.
type siteBrowser struct {
	h      *harness
	cookie string
}

func (sb *siteBrowser) req(method, path string, body any, hdr map[string]string) (int, []byte, http.Header) {
	sb.h.t.Helper()
	var r io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		r = strings.NewReader(string(raw))
	}
	req, _ := http.NewRequest(method, sb.h.ts.URL+path, r)
	req.Host = "site.test"
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet {
		req.Header.Set("Origin", "http://site.test")
	}
	if sb.cookie != "" {
		req.AddCookie(&http.Cookie{Name: "slop_site_dev", Value: sb.cookie})
	}
	for k, v := range hdr {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		sb.h.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	for _, c := range resp.Cookies() {
		if c.Name == "slop_site_dev" {
			sb.cookie = c.Value
		}
	}
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b, resp.Header
}

// json sends a request and decodes a JSON reply.
func (sb *siteBrowser) json(method, path string, body any, out any) int {
	sb.h.t.Helper()
	code, b, _ := sb.req(method, path, body, nil)
	if out != nil {
		_ = json.Unmarshal(b, out)
	}
	return code
}

// handoff signs b in on site.test the way the shell's Sign in does: the main
// host hands over a one-time code, the site's callback turns it into a
// site session.
func (h *harness) handoff(b *browser, ret string) *siteBrowser {
	h.t.Helper()
	resp, err := b.c.Get(h.ts.URL + "/auth/handoff?host=site.test&return=" + url.QueryEscape(ret))
	if err != nil || resp.StatusCode != 303 {
		h.t.Fatalf("handoff: %v %v", err, resp)
	}
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if loc.Host != "site.test" || loc.Path != "/_site/callback" {
		h.t.Fatalf("handoff went to %s", loc)
	}
	sb := &siteBrowser{h: h}
	code, _, hdr := sb.req("GET", loc.RequestURI(), nil, nil)
	if code != 303 || hdr.Get("Location") != ret || sb.cookie == "" {
		h.t.Fatalf("callback: %d %v", code, hdr)
	}
	return sb
}

// liveSetup: an app (board), a workspace that runs it (ws), and a live
// route /board/team that runs board against ws for admins.
func liveSetup(t *testing.T) (*harness, *browser) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "board", map[string]any{"title": "Board", "kind": "page"}, map[string]any{"capabilities": map[string]any{"db": map[string]any{}, "user": map[string]any{}}},
		map[string]string{"index.html": "<!doctype html><title>board</title>"})
	h.pushFiles(tok, "ws", map[string]any{"title": "Team", "kind": "data", "app": "board"}, nil, map[string]string{"readme.md": "x"})
	route := map[string]any{"host": "site.test", "path": "/board/team", "page": "board", "live": true, "access": "admins",
		"bindings": map[string]any{"target": map[string]any{"artifact": "ws"}}}
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 200 {
		t.Fatalf("live route: %d", code)
	}
	return h, manuel
}

// A live route serves a shell; the shell opens a view for a person signed
// in on the site by a handoff from the main host, and frames the app on
// its target's origin with the site as parent (SLOP-011 phase 1).
func TestLiveRouteForAdmins(t *testing.T) {
	h, manuel := liveSetup(t)
	anon := &siteBrowser{h: h}

	// The shell: no secret, no data; it may frame the sandbox.
	code, body, hdr := anon.req("GET", "/board/team", nil, nil)
	if code != 200 || !strings.Contains(string(body), `id="slop-shell"`) || !strings.Contains(string(body), "/_slop/shell.js?h=") || strings.Contains(string(body), "slv_") ||
		!strings.Contains(hdr.Get("Content-Security-Policy"), "frame-src http://*.sandbox.test") {
		t.Fatalf("shell %d %v\n%s", code, hdr, body)
	}
	if code := anon.json("POST", "/_site/views", map[string]any{"path": "/board/team"}, nil); code != 401 {
		t.Fatalf("signed out: %d", code)
	}

	// The handoff: signed out on the main host, it signs in first.
	nobody := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, _ := nobody.Get(h.ts.URL + "/auth/handoff?host=site.test&return=/board/team")
	if resp.StatusCode != 303 || !strings.HasPrefix(resp.Header.Get("Location"), "/auth/login?return=%2Fauth%2Fhandoff%3F") {
		t.Fatalf("signed-out handoff: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	if resp, _ = manuel.c.Get(h.ts.URL + "/auth/handoff?host=evil.test&return=/"); resp.StatusCode != 400 {
		t.Fatalf("handoff to an unknown host: %d", resp.StatusCode)
	}
	site := h.handoff(manuel, "/board/team")
	var me map[string]any
	if site.json("GET", "/_site/me", nil, &me); me["kind"] != "user" || me["id"] != manuel.id() {
		t.Fatalf("me: %v", me)
	}

	// The view: on the target's origin, framed by the site.
	var v map[string]any
	if code := site.json("POST", "/_site/views", map[string]any{"path": "/board/team"}, &v); code != 200 || v["target"] != "ws" || v["level"] != "owner" {
		t.Fatalf("site view: %d %v", code, v)
	}
	u, _ := url.Parse(v["url"].(string))
	if !strings.HasSuffix(u.Host, ".sandbox.test") || u.Query().Get("parent") != "http://site.test" {
		t.Fatalf("view url %s", u)
	}
	vc := &viewClient{h: h, host: u.Host, secret: v["secret"].(string), id: v["view"].(string)}
	vc.stream()
	if _, errc := vc.rpc("db.write", map[string]any{"path": "notes/n1", "op": "set", "body": map[string]any{"text": "live"}}); errc != "" {
		t.Fatalf("db.write from the site view: %s", errc)
	}
	sreq, _ := http.NewRequest("GET", h.ts.URL+u.RequestURI(), nil)
	sreq.Host = u.Host
	sresp, _ := http.DefaultTransport.RoundTrip(sreq)
	page, _ := io.ReadAll(sresp.Body)
	_ = sresp.Body.Close()
	if !strings.Contains(string(page), `"parentOrigin":"http://site.test"`) || !strings.Contains(sresp.Header.Get("Content-Security-Policy"), "http://site.test") {
		t.Fatalf("the sandbox does not accept the site as parent: %v\n%.300s", sresp.Header, page)
	}
	if code := site.json("POST", "/_site/views/"+vc.id+"/renew", map[string]any{}, nil); code != 200 {
		t.Fatalf("renew: %d", code)
	}

	// Only the site's own pages change things: Origin, Fetch metadata, JSON.
	for name, hdr := range map[string]map[string]string{
		"no origin":      {"Origin": ""},
		"other origin":   {"Origin": "http://evil.test"},
		"cross-site":     {"Sec-Fetch-Site": "cross-site"},
		"a form posting": {"Content-Type": "application/x-www-form-urlencoded"},
	} {
		if code, _, _ := site.req("POST", "/_site/views", map[string]any{"path": "/board/team"}, hdr); code != 403 {
			t.Errorf("%s: %d", name, code)
		}
	}

	// Only admins open an admins route; a disabled account has no session.
	ctx := context.Background()
	if _, err := h.st.SetUserRole(ctx, manuel.id(), store.RolePending); err != nil {
		t.Fatal(err)
	}
	if code := site.json("POST", "/_site/views", map[string]any{"path": "/board/team"}, nil); code != 401 {
		t.Fatalf("leaving admin revokes site sessions too: %d", code)
	}
	if _, err := h.st.SetUserRole(ctx, manuel.id(), store.RoleAdmin); err != nil {
		t.Fatal(err)
	}
	site = h.handoff(h.signIn("manuel"), "/board/team")
	if code := site.json("POST", "/_site/logout", map[string]any{}, nil); code != 200 {
		t.Fatalf("logout: %d", code)
	}
	if site.json("GET", "/_site/me", nil, &me); me["kind"] != "none" {
		t.Fatalf("after logout: %v", me)
	}
}

// A handoff code works once, on its host, and returns only to site paths.
func TestHandoffCodes(t *testing.T) {
	h, manuel := liveSetup(t)
	resp, _ := manuel.c.Get(h.ts.URL + "/auth/handoff?host=site.test&return=" + url.QueryEscape("//evil.test/x"))
	loc, _ := url.Parse(resp.Header.Get("Location"))
	sb := &siteBrowser{h: h}
	if code, _, hdr := sb.req("GET", loc.RequestURI(), nil, nil); code != 303 || hdr.Get("Location") != "/" {
		t.Fatalf("a foreign return path: %d %s", code, hdr.Get("Location"))
	}
	if code, _, _ := (&siteBrowser{h: h}).req("GET", loc.RequestURI(), nil, nil); code != 400 {
		t.Fatalf("a used code: %d", code)
	}
	// A code is for the host it was made for.
	if err := h.st.SaveHandoff(context.Background(), "abc", manuel.id(), "other.test", "/"); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := (&siteBrowser{h: h}).req("GET", "/_site/callback?code=abc", nil, nil); code != 400 {
		t.Fatalf("a code for another host: %d", code)
	}
}

// Live routes are validated: signed-in needs live, the fallback and
// page-from routes cannot be live, and a live route's target must be the
// app or data that names it.
func TestLiveRouteRules(t *testing.T) {
	h, manuel := liveSetup(t)
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "other", map[string]any{"title": "Other", "kind": "data"}, nil, map[string]string{"readme.md": "x"})
	for name, route := range map[string]map[string]any{
		"signed-in, static": {"host": "site.test", "path": "/x", "page": "board", "access": "signed-in"},
		"live fallback":     {"host": "site.test", "path": "*", "page": "board", "live": true},
		"create, static":    {"host": "site.test", "path": "/y", "page": "board", "create": "admins"},
	} {
		if code := manuel.do("PUT", "/api/routes", route, nil); code != 400 {
			t.Errorf("%s: %d", name, code)
		}
	}
	// A target that does not name the app opens nothing.
	route := map[string]any{"host": "site.test", "path": "/board/other", "page": "board", "live": true, "access": "admins",
		"bindings": map[string]any{"target": map[string]any{"artifact": "other"}}}
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 200 {
		t.Fatalf("route: %d", code)
	}
	site := h.handoff(manuel, "/")
	if code := site.json("POST", "/_site/views", map[string]any{"path": "/board/other"}, nil); code != 404 {
		t.Fatalf("unrelated target: %d", code)
	}
	// A live route's app files are not public on the site.
	if code, _, _ := site.req("GET", "/_v/board/1/index.html", nil, nil); code != 404 {
		t.Fatalf("live app files on the site: %d", code)
	}
}

// siteView opens a view through the shell's endpoint and connects it.
func (sb *siteBrowser) siteView(path string) (*viewClient, map[string]any, int) {
	sb.h.t.Helper()
	var v map[string]any
	code := sb.json("POST", "/_site/views", map[string]any{"path": path}, &v)
	if code != 200 {
		return nil, v, code
	}
	u, _ := url.Parse(v["url"].(string))
	vc := &viewClient{h: sb.h, host: u.Host, secret: v["secret"].(string), id: v["view"].(string)}
	vc.stream()
	return vc, v, code
}

// Members open what grants give them, never more than admin, and a grant
// change closes the views it changes (SLOP-011 phase 2).
func TestGrantsAndMembers(t *testing.T) {
	h, manuel := liveSetup(t)
	ctx := context.Background()
	route := map[string]any{"host": "site.test", "path": "/board/team", "page": "board", "live": true, "access": "signed-in",
		"bindings": map[string]any{"target": map[string]any{"artifact": "ws"}}}
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 200 {
		t.Fatalf("route: %d", code)
	}
	alexB := h.signIn("alex") // local mode makes everyone an admin first
	alex := alexB.id()
	if _, err := h.st.SetUserRole(ctx, alex, store.RoleMember); err != nil {
		t.Fatal(err)
	}
	site := h.handoff(h.signIn("alex"), "/board/team")
	if _, v, code := site.siteView("/board/team"); code != 403 {
		t.Fatalf("a member without a grant: %d %v", code, v)
	}

	grant := func(subject, level string) {
		t.Helper()
		var out map[string]any
		if code := manuel.do("PUT", "/api/rt/targets/ws/grants/"+url.PathEscape(subject), map[string]any{"level": level}, &out); code != 200 {
			t.Fatalf("grant %s %s: %d %v", subject, level, code, out)
		}
	}
	grant("*signed-in", "view")
	vc, v, code := site.siteView("/board/team")
	if code != 200 || v["level"] != "view" {
		t.Fatalf("a member with *signed-in view: %d %v", code, v)
	}
	caps := v["caps"].(map[string]any)
	if _, ok := caps["db"]; !ok {
		t.Fatalf("caps %v", caps)
	}
	if _, e := vc.rpc("db.write", map[string]any{"path": "notes/n1", "op": "set", "body": map[string]any{"by": "alex"}}); e == "" {
		t.Fatal("a viewer wrote")
	}

	// A higher grant closes the view; the new one has the new level.
	grant(alex, "interact")
	vc.next("revoked")
	vc, v, _ = site.siteView("/board/team")
	if v["level"] != "interact" {
		t.Fatalf("after interact: %v", v)
	}
	if _, e := vc.rpc("db.write", map[string]any{"path": "notes/n1", "op": "set", "body": map[string]any{"by": "alex"}}); e != "" {
		t.Fatalf("an interact member could not write: %s", e)
	}

	// Members are capped at admin, and get neither models nor publishing.
	grant(alex, "owner")
	vc.next("revoked")
	_, v, _ = site.siteView("/board/team")
	if v["level"] != "admin" {
		t.Fatalf("an owner grant to a member: %v", v)
	}

	// Who has access: the grants, the views open now, the live routes.
	var acc struct {
		Grants []map[string]any `json:"grants"`
		Views  []map[string]any `json:"views"`
		Routes []map[string]any `json:"routes"`
	}
	if code := manuel.do("GET", "/api/rt/targets/ws/access", nil, &acc); code != 200 || len(acc.Grants) != 2 || len(acc.Views) != 1 || len(acc.Routes) != 1 {
		t.Fatalf("access %d %+v", code, acc)
	}
	for _, g := range acc.Grants {
		if g["subject"] == alex && g["name"] != "alex" {
			t.Fatalf("grant names %v", acc.Grants)
		}
	}

	// Taking grants away closes the view and the door.
	for _, sub := range []string{alex, "*signed-in"} {
		if code := manuel.do("DELETE", "/api/rt/targets/ws/grants/"+url.PathEscape(sub), nil, nil); code != 200 {
			t.Fatalf("revoke %s: %d", sub, code)
		}
	}
	if _, _, code := site.siteView("/board/team"); code != 403 {
		t.Fatalf("after revoking: %d", code)
	}
	if code := manuel.do("PUT", "/api/rt/targets/ws/grants/usr_nobody", map[string]any{"level": "view"}, nil); code != 400 {
		t.Fatalf("a grant to nobody: %d", code)
	}
	if code := manuel.do("PUT", "/api/rt/targets/ws/grants/bob", map[string]any{"level": "view"}, nil); code != 400 {
		t.Fatalf("a malformed subject: %d", code)
	}
}

// Members get no models and do not publish, whatever their level.
func TestMemberCapabilityPolicy(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "pad", map[string]any{"title": "Pad", "kind": "page"},
		map[string]any{"capabilities": map[string]any{"db": map[string]any{}, "sample": map[string]any{}, "artifact": map[string]any{}, "assets": map[string]any{}}},
		map[string]string{"index.html": "<!doctype html><title>pad</title>"})
	route := map[string]any{"host": "site.test", "path": "/pad", "page": "pad", "live": true, "access": "signed-in"}
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 200 {
		t.Fatalf("route: %d", code)
	}
	alexB := h.signIn("alex")
	if _, err := h.st.SetUserRole(context.Background(), alexB.id(), store.RoleMember); err != nil {
		t.Fatal(err)
	}
	if code := manuel.do("PUT", "/api/rt/targets/pad/grants/"+alexB.id(), map[string]any{"level": "admin"}, nil); code != 200 {
		t.Fatalf("grant: %d", code)
	}
	vc, v, code := h.handoff(h.signIn("alex"), "/pad").siteView("/pad")
	if code != 200 {
		t.Fatalf("member view: %d %v", code, v)
	}
	caps := v["caps"].(map[string]any)
	for _, c := range []string{"sample", "artifact"} {
		if _, ok := caps[c]; ok {
			t.Errorf("a member was granted %s: %v", c, caps)
		}
	}
	if _, ok := caps["assets"]; !ok {
		t.Errorf("an admin-level member has no assets: %v", caps)
	}
	if _, e := vc.rpc("artifact.publish", map[string]any{"html": "<!doctype html><title>x</title>"}); e == "" {
		t.Error("a member published")
	}
	// The admin's own view of the same app has them.
	_, v, _ = h.handoff(manuel, "/pad").siteView("/pad")
	if caps := v["caps"].(map[string]any); caps["sample"] == nil || caps["artifact"] == nil {
		t.Errorf("admin caps %v", caps)
	}
}

// A site host that runs live apps serves its other pages with an opaque
// origin (decision D8); the shell and /_site/ are not sandboxed.
func TestSitePagesIsolated(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "home", map[string]any{"title": "Home", "kind": "page"}, nil, map[string]string{"index.html": "<!doctype html><title>home</title>"})
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/", "page": "home"}, nil)
	anon := &siteBrowser{h: h}
	if _, _, hdr := anon.req("GET", "/", nil, nil); strings.Contains(hdr.Get("Content-Security-Policy"), "sandbox allow") {
		t.Fatalf("a host without live apps sandboxes its pages: %s", hdr.Get("Content-Security-Policy"))
	}
	h.pushFiles(tok, "board", map[string]any{"title": "Board", "kind": "page"}, map[string]any{"capabilities": map[string]any{"db": map[string]any{}}},
		map[string]string{"index.html": "<!doctype html><title>board</title>"})
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/board", "page": "board", "live": true, "access": "admins"}, nil)
	_, _, hdr := anon.req("GET", "/", nil, nil)
	if csp := hdr.Get("Content-Security-Policy"); !strings.Contains(csp, "sandbox allow-scripts") || strings.Contains(csp, "allow-same-origin") || hdr.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("an isolated page: %v", hdr)
	}
	if _, _, hdr = anon.req("GET", "/board", nil, nil); strings.Contains(hdr.Get("Content-Security-Policy"), "sandbox allow") || hdr.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("the shell is sandboxed: %v", hdr)
	}
	if _, _, hdr = anon.req("GET", "/_site/me", nil, nil); hdr.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("/_site/ allows other origins: %v", hdr)
	}
}

// A route can name its target in the path: /board/:db opens any
// workspace of board, nothing else; signed-in people create their own
// instances and own them (SLOP-011 phase 3).
func TestInstances(t *testing.T) {
	h, manuel := liveSetup(t)
	ctx := context.Background()
	route := map[string]any{"host": "site.test", "path": "/board/:db", "page": "board", "live": true, "access": "signed-in", "create": "signed-in",
		"bindings": map[string]any{"target": map[string]any{"artifact": "{db}"}}}
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 200 {
		t.Fatalf("templated route: %d", code)
	}
	for name, bad := range map[string]map[string]any{
		"not live":      {"host": "site.test", "path": "/z/:db", "page": "board", "bindings": map[string]any{"target": map[string]any{"artifact": "{db}"}}},
		"unknown param": {"host": "site.test", "path": "/z/:db", "page": "board", "live": true, "bindings": map[string]any{"target": map[string]any{"artifact": "{x}"}}},
		"prefixed":      {"host": "site.test", "path": "/z/:db", "page": "board", "live": true, "bindings": map[string]any{"target": map[string]any{"artifact": "ws-{db}"}}},
		"other binding": {"host": "site.test", "path": "/z/:db", "page": "board", "live": true, "bindings": map[string]any{"notes": map[string]any{"artifact": "{db}"}}},
		"create, fixed": {"host": "site.test", "path": "/z", "page": "board", "live": true, "create": "signed-in"},
	} {
		if code := manuel.do("PUT", "/api/routes", bad, nil); code != 400 {
			t.Errorf("%s: %d", name, code)
		}
	}

	site := h.handoff(manuel, "/")
	if _, v, code := site.siteView("/board/ws"); code != 200 || v["level"] != "owner" {
		t.Fatalf("an existing workspace: %d %v", code, v)
	}
	// The app itself, or another app's data, is not an instance.
	h.pushFiles(h.token(manuel.id(), store.ScopeRead, store.ScopeWrite), "other", map[string]any{"title": "Other", "kind": "data"}, nil, map[string]string{"a.md": "x"})
	for _, p := range []string{"/board/board", "/board/other"} {
		var out map[string]any
		if code := site.json("POST", "/_site/views", map[string]any{"path": p}, &out); code != 404 || out["error"].(map[string]any)["code"] != "no_instance" {
			t.Fatalf("%s: %d %v", p, code, out)
		}
	}

	// A member creates one, owns it, and nobody else gets in without a grant.
	alexB := h.signIn("alex")
	if _, err := h.st.SetUserRole(ctx, alexB.id(), store.RoleMember); err != nil {
		t.Fatal(err)
	}
	alex := h.handoff(h.signIn("alex"), "/")
	var miss map[string]any
	if code := alex.json("POST", "/_site/views", map[string]any{"path": "/board/new"}, &miss); code != 404 || miss["mayCreate"] != true {
		t.Fatalf("an unknown instance: %d %v", code, miss)
	}
	var made struct{ ID, Path string }
	if code := alex.json("POST", "/_site/instances", map[string]any{"path": "/board/new"}, &made); code != 201 || !strings.HasPrefix(made.ID, "i-") || made.Path != "/board/"+made.ID {
		t.Fatalf("create: %d %+v", code, made)
	}
	a, err := h.st.Artifact(ctx, made.ID)
	if err != nil || a.Kind != store.KindData || a.App != "board" || a.CreatedBy == nil || *a.CreatedBy != alexB.id() {
		t.Fatalf("the instance %+v %v", a, err)
	}
	vc, v, code := alex.siteView(made.Path)
	if code != 200 || v["level"] != "owner" {
		t.Fatalf("the creator: %d %v", code, v)
	}
	if _, e := vc.rpc("db.write", map[string]any{"path": "notes/n1", "op": "set", "body": map[string]any{"by": "alex"}}); e != "" {
		t.Fatalf("the owner could not write: %s", e)
	}
	if _, _, code := alex.siteView("/board/ws"); code != 403 {
		t.Fatalf("someone else's workspace: %d", code)
	}

	// The create policy: admins only keeps members out; no policy, no create.
	route["create"] = "admins"
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 200 {
		t.Fatal(code)
	}
	if code := alex.json("POST", "/_site/instances", map[string]any{"path": "/board/new"}, nil); code != 403 {
		t.Fatalf("create by a member under admins: %d", code)
	}
	delete(route, "create")
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 200 {
		t.Fatal(code)
	}
	if code := site.json("POST", "/_site/instances", map[string]any{"path": "/board/new"}, nil); code != 404 {
		t.Fatalf("create without a policy: %d", code)
	}
	anon := &siteBrowser{h: h}
	route["create"] = "signed-in"
	_ = manuel.do("PUT", "/api/routes", route, nil)
	if code := anon.json("POST", "/_site/instances", map[string]any{"path": "/board/new"}, nil); code != 401 {
		t.Fatalf("create signed out: %d", code)
	}
}

// A share link gives whoever opens it its level, as a grant via the link;
// revoking the link takes those grants away (SLOP-011 phase 3).
func TestShareLinks(t *testing.T) {
	h, manuel := liveSetup(t)
	ctx := context.Background()
	route := map[string]any{"host": "site.test", "path": "/board/team", "page": "board", "live": true, "access": "signed-in",
		"bindings": map[string]any{"target": map[string]any{"artifact": "ws"}}}
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 200 {
		t.Fatalf("route: %d", code)
	}
	var made struct {
		Link  map[string]any `json:"link"`
		Token string         `json:"token"`
		URLs  []string       `json:"urls"`
	}
	if code := manuel.do("POST", "/api/rt/targets/ws/links", map[string]any{"level": "interact", "days": 7}, &made); code != 201 ||
		made.Token == "" || len(made.URLs) != 1 || made.URLs[0] != "http://site.test/board/team?k="+made.Token {
		t.Fatalf("link: %d %+v", code, made)
	}
	if code := manuel.do("POST", "/api/rt/targets/ws/links", map[string]any{"level": "admin"}, nil); code != 400 {
		t.Fatalf("an admin link: %d", code)
	}

	alexB := h.signIn("alex")
	if _, err := h.st.SetUserRole(ctx, alexB.id(), store.RoleMember); err != nil {
		t.Fatal(err)
	}
	alex := h.handoff(h.signIn("alex"), "/")
	if _, _, code := alex.siteView("/board/team"); code != 403 {
		t.Fatalf("without the link: %d", code)
	}
	open := func(token string) (map[string]any, int) {
		var v map[string]any
		code := alex.json("POST", "/_site/views", map[string]any{"path": "/board/team", "link": token}, &v)
		return v, code
	}
	if v, code := open("nope"); code != 403 || v["error"].(map[string]any)["code"] != "link_invalid" {
		t.Fatalf("a wrong token: %d %v", code, v)
	}
	if v, code := open(made.Token); code != 200 || v["level"] != "interact" {
		t.Fatalf("with the link: %d %v", code, v)
	}
	// The grant stays: no link needed next time.
	_, v, code := alex.siteView("/board/team")
	if code != 200 || v["level"] != "interact" {
		t.Fatalf("after the link: %d %v", code, v)
	}
	// A link never lowers a grant someone already has.
	if c := manuel.do("PUT", "/api/rt/targets/ws/grants/"+alexB.id(), map[string]any{"level": "admin"}, nil); c != 200 {
		t.Fatal(c)
	}
	if v, code := open(made.Token); code != 200 || v["level"] != "admin" {
		t.Fatalf("a link lowered a grant: %d %v", code, v)
	}
	_ = manuel.do("DELETE", "/api/rt/targets/ws/grants/"+alexB.id(), nil, nil)
	_, _ = open(made.Token)

	var acc struct {
		Grants []map[string]any `json:"grants"`
		Links  []map[string]any `json:"links"`
	}
	if code := manuel.do("GET", "/api/rt/targets/ws/access", nil, &acc); code != 200 || len(acc.Links) != 1 || len(acc.Grants) != 1 || acc.Grants[0]["via"] != made.Link["id"] {
		t.Fatalf("access: %d %+v", code, acc)
	}
	id := made.Link["id"].(string)
	if code := manuel.do("DELETE", "/api/rt/targets/ws/links/"+id, nil, nil); code != 200 {
		t.Fatalf("revoke: %d", code)
	}
	if _, _, code := alex.siteView("/board/team"); code != 403 {
		t.Fatalf("after revoking the link: %d", code)
	}
	if _, code := open(made.Token); code != 403 {
		t.Fatalf("a revoked link: %d", code)
	}
	if code := manuel.do("DELETE", "/api/rt/targets/ws/links/"+id, nil, nil); code != 404 {
		t.Fatalf("revoking twice: %d", code)
	}
}

// guestSetup: an app that declares everything a guest might want, and its
// workspace on a public live route.
func guestSetup(t *testing.T) (*harness, *browser) {
	h, manuel := liveSetup(t)
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "board", map[string]any{"title": "Board", "kind": "page"}, map[string]any{"capabilities": map[string]any{
		"db": map[string]any{}, "user": map[string]any{"scopes": []string{"profile"}}, "room": map[string]any{},
		"assets": map[string]any{}, "comments": map[string]any{}, "downloads": true}},
		map[string]string{"index.html": "<!doctype html><title>board</title>"})
	route := map[string]any{"host": "site.test", "path": "/board/team", "page": "board", "live": true, "access": "public",
		"bindings": map[string]any{"target": map[string]any{"artifact": "ws"}}}
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 200 {
		t.Fatalf("public route: %d", code)
	}
	return h, manuel
}

// Someone who is not signed in opens a public live route as a guest: a
// visitor id and a site session, at most interact, without files,
// comments or models (SLOP-011 phase 4).
func TestVisitors(t *testing.T) {
	h, manuel := guestSetup(t)
	anon := &siteBrowser{h: h}
	if _, _, code := anon.siteView("/board/team"); code != 401 || anon.cookie != "" {
		t.Fatalf("a public route nobody granted *anyone: %d, cookie %q", code, anon.cookie)
	}
	if code := manuel.do("PUT", "/api/rt/targets/ws/grants/*anyone", map[string]any{"level": "admin"}, nil); code != 200 {
		t.Fatal(code)
	}
	vc, v, code := anon.siteView("/board/team")
	if code != 200 || anon.cookie == "" || v["level"] != "interact" {
		t.Fatalf("a guest: %d %v", code, v)
	}
	caps := v["caps"].(map[string]any)
	for _, c := range []string{"assets", "comments", "sample", "artifact", "slop"} {
		if _, ok := caps[c]; ok {
			t.Errorf("a guest got %s: %v", c, caps)
		}
	}
	for _, c := range []string{"db", "user", "room", "downloads"} {
		if _, ok := caps[c]; !ok {
			t.Errorf("a guest has no %s: %v", c, caps)
		}
	}
	vis := v["user"].(string)
	if !store.IsVisitor(vis) {
		t.Fatalf("the view's user %q", vis)
	}
	hello := vc.stream()
	me := hello["me"].(map[string]any)
	if me["id"] != vis || me["guest"] != true || me["profile"].(map[string]any)["name"] != "Guest" {
		t.Fatalf("user info %v", me)
	}
	if out, e := vc.rpc("user.profiles", map[string]any{"ids": []string{vis}}); e != "" || out[vis].(map[string]any)["guest"] != true {
		t.Fatalf("profiles %v %s", out, e)
	}
	if _, e := vc.rpc("db.write", map[string]any{"path": "data/users/" + vis + "/draft", "op": "set", "body": map[string]any{"x": 1}}); e != "" {
		t.Fatalf("a guest's own document: %s", e)
	}
	var who map[string]any
	if anon.json("GET", "/_site/me", nil, &who); who["kind"] != "visitor" || who["id"] != vis {
		t.Fatalf("me %v", who)
	}
	// The same cookie is the same guest; consent and creating are for
	// people who signed in.
	if _, v2, _ := anon.siteView("/board/team"); v2["user"] != vis {
		t.Fatalf("a second open: %v", v2)
	}
	if code := anon.json("POST", "/_site/views/"+v["view"].(string)+"/consent", map[string]any{"comments": "granted"}, nil); code != 403 {
		t.Fatalf("a guest's consent: %d", code)
	}
	route := map[string]any{"host": "site.test", "path": "/board/:db", "page": "board", "live": true, "access": "public", "create": "signed-in",
		"bindings": map[string]any{"target": map[string]any{"artifact": "{db}"}}}
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 200 {
		t.Fatal(code)
	}
	if code := anon.json("POST", "/_site/instances", map[string]any{"path": "/board/new"}, nil); code != 401 {
		t.Fatalf("a guest creates: %d", code)
	}
	route["create"] = "public"
	if code := manuel.do("PUT", "/api/routes", route, nil); code != 400 {
		t.Fatalf("create public: %d", code)
	}
	// A route for signed-in people keeps guests out.
	_ = manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/board/team", "page": "board", "live": true, "access": "signed-in",
		"bindings": map[string]any{"target": map[string]any{"artifact": "ws"}}}, nil)
	if _, _, code := anon.siteView("/board/team"); code != 403 {
		t.Fatalf("a guest on a signed-in route: %d", code)
	}
	var acc struct{ Grants []map[string]any }
	manuel.do("GET", "/api/rt/targets/ws/access", nil, &acc)
	if len(acc.Grants) != 1 || acc.Grants[0]["name"] != "anyone, signed in or not" {
		t.Fatalf("grants %v", acc.Grants)
	}
}

// One address makes a limited number of guests an hour.
func TestVisitorLimit(t *testing.T) {
	h, manuel := guestSetup(t)
	_ = manuel.do("PUT", "/api/rt/targets/ws/grants/*anyone", map[string]any{"level": "view"}, nil)
	for i := 0; i < visitorsPerHour; i++ {
		if _, _, code := (&siteBrowser{h: h}).siteView("/board/team"); code != 200 {
			t.Fatalf("guest %d: %d", i, code)
		}
	}
	if _, _, code := (&siteBrowser{h: h}).siteView("/board/team"); code != 429 {
		t.Fatalf("one guest too many: %d", code)
	}
}

// handoffOver signs b in on a site browser that already has a cookie (a
// guest's), as the shell's Sign in does.
func (h *harness) handoffOver(sb *siteBrowser, b *browser, ret string) {
	h.t.Helper()
	resp, err := b.c.Get(h.ts.URL + "/auth/handoff?host=site.test&return=" + url.QueryEscape(ret))
	if err != nil || resp.StatusCode != 303 {
		h.t.Fatalf("handoff: %v %v", err, resp)
	}
	loc, _ := url.Parse(resp.Header.Get("Location"))
	before := sb.cookie
	if code, _, _ := sb.req("GET", loc.RequestURI(), nil, nil); code != 303 || sb.cookie == before {
		h.t.Fatalf("callback: %d", code)
	}
}

// A guest who signs in is offered what they did as a guest, and keeps it
// only by saying so.
func TestVisitorClaim(t *testing.T) {
	h, manuel := guestSetup(t)
	ctx := context.Background()
	_ = manuel.do("PUT", "/api/rt/targets/ws/grants/*anyone", map[string]any{"level": "view"}, nil)
	var link struct{ Token string }
	if code := manuel.do("POST", "/api/rt/targets/ws/links", map[string]any{"level": "interact"}, &link); code != 201 {
		t.Fatal(code)
	}
	sb := &siteBrowser{h: h}
	var v map[string]any
	if code := sb.json("POST", "/_site/views", map[string]any{"path": "/board/team", "link": link.Token}, &v); code != 200 || v["level"] != "interact" {
		t.Fatalf("a guest with a link: %d %v", code, v)
	}
	vis := v["user"].(string)
	u, _ := url.Parse(v["url"].(string))
	vc := &viewClient{h: h, host: u.Host, secret: v["secret"].(string), id: v["view"].(string)}
	vc.stream()
	if _, e := vc.rpc("db.write", map[string]any{"path": "data/users/" + vis + "/draft", "op": "set", "body": map[string]any{"x": 1}}); e != "" {
		t.Fatal(e)
	}

	alexB := h.signIn("alex")
	alex := alexB.id()
	if _, err := h.st.SetUserRole(ctx, alex, store.RoleMember); err != nil {
		t.Fatal(err)
	}
	h.handoffOver(sb, h.signIn("alex"), "/board/team")
	var me struct {
		Kind  string
		Claim map[string]int
	}
	if sb.json("GET", "/_site/me", nil, &me); me.Kind != "user" || me.Claim["docs"] != 1 || me.Claim["grants"] != 1 || me.Claim["places"] != 1 {
		t.Fatalf("the offer: %+v", me)
	}
	var out map[string]any
	if code := sb.json("POST", "/_site/claim", map[string]any{"keep": true}, &out); code != 200 || out["docs"] != float64(1) {
		t.Fatalf("keep: %d %v", code, out)
	}
	if d, err := h.st.RTDoc(ctx, "ws", "data/users/"+alex+"/draft"); err != nil || string(d.Body) != `{"x":1}` {
		t.Fatalf("the kept document: %v %s", err, d.Body)
	}
	if gs, _ := h.st.SubjectGrants(ctx, alex); len(gs) != 1 || gs[0].Level != "interact" {
		t.Fatalf("the kept grant: %v", gs)
	}
	if gs, _ := h.st.SubjectGrants(ctx, vis); len(gs) != 0 {
		t.Fatalf("the guest kept its grant: %v", gs)
	}
	me.Claim = nil
	if sb.json("GET", "/_site/me", nil, &me); me.Claim != nil {
		t.Fatalf("offered twice: %+v", me)
	}
	if code := sb.json("POST", "/_site/claim", map[string]any{"keep": true}, nil); code != 404 {
		t.Fatalf("claim twice: %d", code)
	}
	if _, v, code := sb.siteView("/board/team"); code != 200 || v["level"] != "interact" || v["user"] != alex {
		t.Fatalf("after keeping: %d %v", code, v)
	}
}
