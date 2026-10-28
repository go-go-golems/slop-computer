package server

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

func TestGuardMatrix(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	ramon := h.signIn("ramon")
	// ramon is set back to pending to stand for a new, unapproved user.
	if code := manuel.do("PATCH", "/api/users/"+ramon.id(), map[string]string{"role": "pending"}, nil); code != 200 {
		t.Fatalf("set pending: %d", code)
	}
	pendingBrowser := h.signIn("ramon")
	read := h.token(manuel.id(), store.ScopeRead)
	rw := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	adm := h.token(manuel.id(), store.ScopeAdmin)
	pendingToken := h.token(ramon.id(), store.ScopeRead, store.ScopeWrite)

	cases := []struct {
		name   string
		code   int
		status int
	}{
		{"anonymous me", h.call(http.DefaultClient, "GET", "/api/me", nil, nil, nil), 401},
		{"pending browser me", pendingBrowser.do("GET", "/api/me", nil, nil), 200},
		{"pending browser users", pendingBrowser.do("GET", "/api/users", nil, nil), 403},
		{"pending token users", h.bearer(pendingToken, "GET", "/api/users", nil, nil), 403},
		{"read token users", h.bearer(read, "GET", "/api/users", nil, nil), 200},
		{"admin-only token users (no read)", h.bearer(adm, "GET", "/api/users", nil, nil), 403},
		{"rw token audit", h.bearer(rw, "GET", "/api/audit", nil, nil), 403},
		{"admin token audit", h.bearer(adm, "GET", "/api/audit", nil, nil), 200},
		{"rw token patch user", h.bearer(rw, "PATCH", "/api/users/"+ramon.id(), map[string]string{"role": "admin"}, nil), 403},
		{"token lists tokens", h.bearer(adm, "GET", "/api/tokens", nil, nil), 401},
		{"browser lists tokens", manuel.do("GET", "/api/tokens", nil, nil), 200},
		{"revoked token", func() int {
			bad := h.token(manuel.id(), store.ScopeRead)
			_ = h.bearer(bad, "DELETE", "/api/me/token", nil, nil)
			return h.bearer(bad, "GET", "/api/users", nil, nil)
		}(), 401},
		{"self lockout", manuel.do("PATCH", "/api/users/"+manuel.id(), map[string]string{"role": "disabled"}, nil), 409},
	}
	for _, c := range cases {
		if c.code != c.status {
			t.Errorf("%s: got %d, want %d", c.name, c.code, c.status)
		}
	}

	// Cookie mutations need the CSRF token and a same-site Origin.
	if code := h.call(manuel.c, "POST", "/api/tokens", map[string]any{"name": "x", "scopes": []string{"read"}}, nil, map[string]string{"Origin": h.ts.URL}); code != 403 {
		t.Errorf("no CSRF: %d", code)
	}
	if code := h.call(manuel.c, "POST", "/api/tokens", map[string]any{"name": "x", "scopes": []string{"read"}}, nil, map[string]string{"Origin": "http://evil.example", "X-CSRF-Token": manuel.csrf}); code != 403 {
		t.Errorf("cross origin: %d", code)
	}
	var created map[string]any
	if code := manuel.do("POST", "/api/tokens", map[string]any{"name": "x", "scopes": []string{"read", "admin"}, "days": 30}, &created); code != 201 {
		t.Errorf("create token: %d %v", code, created)
	}
	if code := manuel.do("POST", "/api/tokens", map[string]any{"name": "x", "scopes": []string{"admin"}, "days": 0}, nil); code != 400 {
		t.Errorf("admin token without expiry: %d", code)
	}
}

func TestLocalTokenAndDeviceApproval(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	var tok map[string]any
	if code := h.call(http.DefaultClient, "POST", "/api/local/token", map[string]any{"nickname": "claude-manuel"}, &tok, nil); code != 201 {
		t.Fatalf("local token: %d %v", code, tok)
	}
	if code := h.bearer(tok["token"].(string), "GET", "/api/me", nil, nil); code != 200 {
		t.Fatalf("local token me: %d", code)
	}

	// Device login approved through the server-rendered form.
	var dc map[string]any
	if code := h.call(http.DefaultClient, "POST", "/api/device/authorize", map[string]any{"clientName": "cli"}, &dc, nil); code != 201 {
		t.Fatalf("authorize: %d", code)
	}
	manuel := h.signIn("manuel")
	form := url.Values{"csrf": {manuel.csrf}, "code": {dc["userCode"].(string)}, "decision": {"approve"}, "days": {"30"}, "scope": {"read", "write"}}
	req, _ := http.NewRequest("POST", h.ts.URL+"/device", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", h.ts.URL)
	resp, err := manuel.c.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("approve: %v %v", err, resp)
	}
	var issued map[string]any
	if code := h.call(http.DefaultClient, "POST", "/api/device/token", map[string]any{"deviceCode": dc["deviceCode"]}, &issued, nil); code != 200 {
		t.Fatalf("poll: %d %v", code, issued)
	}
	if code := h.bearer(issued["token"].(string), "GET", "/api/users", nil, nil); code != 200 {
		t.Fatalf("device token: %d", code)
	}
}

func TestLocalModeGuardRails(t *testing.T) {
	u, _ := url.Parse("http://localhost:8080")
	cfg := Config{PublicURL: u, Local: &LocalConfig{Role: store.RoleAdmin}}
	if err := cfg.Validate("0.0.0.0:8080"); err == nil {
		t.Fatal("local mode must refuse a non-loopback listen address")
	}
	pub, _ := url.Parse("https://slop.computer")
	cfg.PublicURL = pub
	if err := cfg.Validate("127.0.0.1:8080"); err == nil {
		t.Fatal("local mode must refuse a non-loopback public URL")
	}
	// Outside local mode the nickname routes do not exist.
	h := newHarness(t, store.RoleAdmin)
	h.srv.Config.Local = nil
	h.srv.mux = h.srv.routes()
	if code := h.call(http.DefaultClient, "POST", "/api/local/token", map[string]any{"nickname": "x"}, nil, nil); code != 404 {
		t.Fatalf("local token outside local mode: %d", code)
	}
}
