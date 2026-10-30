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
