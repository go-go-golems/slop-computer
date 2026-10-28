package server

import (
	"net/http"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

func TestToolsGrantsAndCORS(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	ramon := h.signIn("ramon")
	manuel := h.signIn("manuel")
	tok := h.token(ramon.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "pricing", map[string]any{"title": "Pricing", "kind": "page"}, nil, map[string]string{"index.html": "<p>v1"})
	h.pushFiles(tok, "pricing", nil, nil, map[string]string{"index.html": "<p>v2"})
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/pricing", "page": "pricing", "version": 1}, nil)
	board := map[string]any{"tool": map[string]any{"title": "Release board", "icon": "rocket", "permissions": []string{"routes:read", "routes:write", "versions:read"}}}
	h.pushFiles(tok, "board", map[string]any{"title": "Board", "kind": "page"}, board, map[string]string{"index.html": "<h1>Board</h1>"})

	// Listed as a tool that is not enabled yet.
	var list struct {
		Tools []toolView `json:"tools"`
	}
	if code := ramon.do("GET", "/api/tools", nil, &list); code != 200 || len(list.Tools) != 1 || list.Tools[0].Enabled != nil || len(list.Tools[0].Latest.NewPermissions) != 3 {
		t.Fatalf("tools %d %+v", code, list)
	}
	// Not enabled: only a try grant, and never with an API token.
	if code := ramon.do("POST", "/api/tools/board/grant", map[string]any{"n": 1}, nil); code != 404 {
		t.Fatalf("grant before enable: %d", code)
	}
	if code := h.bearer(tok, "POST", "/api/tools/board/grant", map[string]any{"n": 1, "try": true}, nil); code != 401 {
		t.Fatalf("grant with a token: %d", code)
	}
	var g struct {
		Grant       string   `json:"grant"`
		Permissions []string `json:"permissions"`
	}
	if code := ramon.do("POST", "/api/tools/board/grant", map[string]any{"n": 1, "try": true}, &g); code != 200 || len(g.Permissions) != 3 {
		t.Fatalf("try grant %d %+v", code, g)
	}
	// The grant does what it was given, as ramon, through the tool.
	if code := h.bearer(g.Grant, "GET", "/api/routes", nil, nil); code != 200 {
		t.Fatalf("routes:read %d", code)
	}
	if code := h.bearer(g.Grant, "PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/pricing", "page": "pricing", "version": 2, "note": "shipped from release board"}, nil); code != 200 {
		t.Fatalf("routes:write %d", code)
	}
	logs, _ := h.st.RouteLog(t.Context(), "site.test", "/pricing", 1)
	if len(logs) != 1 || logs[0].Via != "tool board@1" || *logs[0].By != ramon.id() {
		t.Fatalf("route log %+v", logs)
	}
	// ... and nothing else.
	for _, c := range []struct {
		method, path string
		want         int
	}{
		{"GET", "/api/threads", 403},     // threads:read not granted
		{"GET", "/api/tokens", 403},      // noToken route: never
		{"GET", "/api/users", 403},       // not grantable
		{"GET", "/api/audit", 403},       // not grantable
		{"PUT", "/api/tools/board", 403}, // a tool cannot enable tools
	} {
		if code := h.bearer(g.Grant, c.method, c.path, map[string]any{"n": 1}, nil); code != c.want {
			t.Fatalf("%s %s with a grant: %d, want %d", c.method, c.path, code, c.want)
		}
	}

	// CORS: preflights from preview origins only, never with credentials.
	req, _ := http.NewRequest("OPTIONS", h.ts.URL+"/api/routes", nil)
	req.Header.Set("Origin", "http://sabc.sandbox.test")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 204 || resp.Header.Get("Access-Control-Allow-Origin") != "http://sabc.sandbox.test" ||
		resp.Header.Get("Access-Control-Allow-Credentials") != "" || resp.Header.Get("Access-Control-Allow-Headers") != "Authorization, Content-Type" {
		t.Fatalf("preflight %v %v", err, resp)
	}
	req.Header.Set("Origin", "http://evil.test")
	if resp, _ = http.DefaultClient.Do(req); resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("preflight from elsewhere: %v", resp.Header)
	}
	// A browser session from a preview origin is still refused (no CSRF bypass).
	if code := h.call(manuel.c, "PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/pricing", "page": "pricing"}, nil,
		map[string]string{"Origin": "http://sabc.sandbox.test", "X-CSRF-Token": manuel.csrf}); code != 403 {
		t.Fatalf("session from a sandbox origin: %d", code)
	}

	// Enabling takes the manifest's permissions; a normal grant follows the
	// enabled version; disabling revokes outstanding grants.
	var tl store.Tool
	if code := manuel.do("PUT", "/api/tools/board", map[string]any{"n": 1}, &tl); code != 200 || tl.Version != 1 || len(tl.Permissions) != 3 {
		t.Fatalf("enable %d %+v", code, tl)
	}
	if code := manuel.do("POST", "/api/tools/board/grant", map[string]any{"n": 1}, &g); code != 200 {
		t.Fatalf("grant %d", code)
	}
	if code := manuel.do("DELETE", "/api/tools/board", nil, nil); code != 200 {
		t.Fatalf("disable %d", code)
	}
	if code := h.bearer(g.Grant, "GET", "/api/routes", nil, nil); code != 401 {
		t.Fatalf("grant after disable: %d", code)
	}
	// A page without a tool section cannot be enabled.
	if code := manuel.do("PUT", "/api/tools/pricing", map[string]any{"n": 1}, nil); code != 400 {
		t.Fatalf("enable a plain page: %d", code)
	}
	// Changing a user's role ends their grants.
	manuel.do("PUT", "/api/tools/board", map[string]any{"n": 1}, nil)
	ramon.do("POST", "/api/tools/board/grant", map[string]any{"n": 1}, &g)
	manuel.do("PATCH", "/api/users/"+ramon.id(), map[string]any{"role": "pending"}, nil)
	if code := h.bearer(g.Grant, "GET", "/api/routes", nil, nil); code != 401 {
		t.Fatalf("grant after role change: %d", code)
	}
}

func TestPushRefusesBadToolSection(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	sum := h.upload(tok, []byte("<p>x"))
	body := map[string]any{"tree": map[string]string{"index.html": sum}, "create": map[string]any{"title": "X", "kind": "page"},
		"manifest": map[string]any{"tool": map[string]any{"title": "X", "permissions": []string{"users:write"}}}}
	var res map[string]any
	if code := h.bearer(tok, "POST", "/api/artifacts/x/versions", body, &res); code != 400 {
		t.Fatalf("push with an unknown permission: %d %v", code, res)
	}
}
