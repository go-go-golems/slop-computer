package host

// Tests from SLOP3-001 phase P0 (sign-in, tokens, probes, hosts); formerly p0_test.go.

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/config"
)

func TestDeviceLoginWhoamiRevoke(t *testing.T) {
	h := newHarness(t)
	b := h.browser()
	b.signIn("admin@example.com")

	// The CLI starts a device login.
	r := b.do("POST", "/auth/device", h.cfg.Hosts.Main, strings.NewReader(`{"name":"test cli","days":30}`), nil)
	start := readJSON(t, r)
	code, _ := start["userCode"].(string)
	device, _ := start["deviceCode"].(string)
	if code == "" || device == "" {
		t.Fatalf("device start: %v", start)
	}
	// Polling before approval is pending.
	r = b.do("POST", "/auth/device/token", h.cfg.Hosts.Main, strings.NewReader(`{"deviceCode":"`+device+`"}`), nil)
	if r.StatusCode != 428 {
		t.Fatalf("poll before approval: %d", r.StatusCode)
	}
	r.Body.Close()
	// The person opens the approval page and approves.
	r = b.do("GET", "/device?code="+code, h.cfg.Hosts.Main, nil, nil)
	page, _ := io.ReadAll(r.Body)
	r.Body.Close()
	m := regexp.MustCompile(`name="csrf" value="([^"]+)"`).FindSubmatch(page)
	if m == nil {
		t.Fatalf("no csrf in approval page: %s", page)
	}
	form := url.Values{"csrf": {string(m[1])}, "code": {code}, "scope": {"read", "write", "admin"}, "days": {"30"}, "decision": {"approve"}}
	r = b.do("POST", "/device", h.cfg.Hosts.Main, strings.NewReader(form.Encode()), map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	if r.StatusCode != 200 {
		t.Fatalf("approve: %d", r.StatusCode)
	}
	r.Body.Close()
	// The CLI collects its token, exactly once.
	r = b.do("POST", "/auth/device/token", h.cfg.Hosts.Main, strings.NewReader(`{"deviceCode":"`+device+`"}`), nil)
	tok := readJSON(t, r)
	token, _ := tok["token"].(string)
	if !strings.HasPrefix(token, "slp_") {
		t.Fatalf("token: %v", tok)
	}
	r = b.do("POST", "/auth/device/token", h.cfg.Hosts.Main, strings.NewReader(`{"deviceCode":"`+device+`"}`), nil)
	if r.StatusCode != 404 {
		t.Fatalf("second collect should fail, got %d", r.StatusCode)
	}
	r.Body.Close()

	// whoami with the token.
	st, who := api(t, h, token, "whoami", map[string]any{})
	if st != 200 {
		t.Fatalf("whoami: %d %v", st, who)
	}
	res := who["result"].(map[string]any)
	person := res["person"].(map[string]any)
	if person["role"] != "admin" || res["kind"] != "token" {
		t.Fatalf("whoami result: %v", res)
	}

	// A token cannot mint a token with more scopes: make a read-only one first.
	st, made := api(t, h, token, "token.new", map[string]any{"name": "ro", "scopes": "read", "days": 1})
	if st != 200 {
		t.Fatalf("token.new: %d %v", st, made)
	}
	ro := made["result"].(map[string]any)["token"].(string)
	st, e := api(t, h, ro, "token.new", map[string]any{"name": "escalate", "scopes": "read,write", "days": 1})
	if st != 403 {
		t.Fatalf("escalation should be refused: %d %v", st, e)
	}
	// A read-only token cannot call a write verb.
	st, _ = api(t, h, ro, "token.rm", map[string]any{"id": "tok_x"})
	if st != 403 {
		t.Fatalf("read token on write verb: %d", st)
	}

	// Revoke the first token; it stops working at once.
	id := tok["tokenId"].(string)
	if st, out := api(t, h, token, "token.rm", map[string]any{"id": id}); st != 200 {
		t.Fatalf("token.rm: %d %v", st, out)
	}
	if st, _ := api(t, h, token, "whoami", map[string]any{}); st != 401 {
		t.Fatalf("revoked token still works: %d", st)
	}

	// A session call without CSRF is refused; with it, it works.
	r = b.do("POST", "/api/v1/whoami", h.cfg.Hosts.Main, strings.NewReader(`{}`), nil)
	if r.StatusCode != 403 {
		t.Fatalf("session without csrf: %d", r.StatusCode)
	}
	r.Body.Close()
	r = b.do("GET", "/auth/session", h.cfg.Hosts.Main, nil, nil)
	sess := readJSON(t, r)
	r = b.do("POST", "/api/v1/whoami", h.cfg.Hosts.Main, strings.NewReader(`{}`), map[string]string{"X-CSRF-Token": sess["csrf"].(string)})
	if r.StatusCode != 200 {
		t.Fatalf("session with csrf: %d", r.StatusCode)
	}
	r.Body.Close()
}

func TestSignupRoles(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	a, _, _ := h.k.People.SignInUser(ctx, "Admin@Example.com", "", "", h.cfg.AdminEmails, true)
	m, _, _ := h.k.People.SignInUser(ctx, "kim@example.com", "", "", h.cfg.AdminEmails, true)
	p, _, _ := h.k.People.SignInUser(ctx, "pat@example.com", "", "", h.cfg.AdminEmails, false)
	if a.Role != "admin" || m.Role != "member" || p.Role != "pending" {
		t.Fatalf("roles: %s %s %s", a.Role, m.Role, p.Role)
	}
	// Signing in again keeps the same person.
	m2, created, _ := h.k.People.SignInUser(ctx, "kim@example.com", "", "", h.cfg.AdminEmails, true)
	if created || m2.ID != m.ID {
		t.Fatalf("second sign-in made a new person")
	}
	// Disabling revokes tokens.
	_, tk, _ := h.k.People.CreateToken(ctx, m.ID, "x", []string{"read"}, 1)
	if _, err := h.k.People.SetRole(ctx, a.ID, "test", m.ID, "disabled"); err != nil {
		t.Fatal(err)
	}
	got, _ := h.k.People.Token(ctx, tk.ID)
	if got.RevokedAt == nil {
		t.Fatalf("disabling did not revoke the token")
	}
}

// Probes reach the pod's address, which is not a configured host.
func TestProbesOnAnyHost(t *testing.T) {
	h := newHarness(t)
	b := h.browser()
	for _, path := range []string{"/healthz", "/readyz"} {
		if r := b.do("GET", path, "10.42.0.7:8080", nil, nil); r.StatusCode != 200 {
			t.Fatalf("%s on the pod address: %d", path, r.StatusCode)
		}
	}
	if r := b.do("GET", "/", "10.42.0.7:8080", nil, nil); r.StatusCode != http.StatusMisdirectedRequest {
		t.Fatalf("/ on the pod address: %d", r.StatusCode)
	}
}

// Trusted origins (main, live) deny by default: every response starts
// with frame-ancestors 'none', nosniff and a same-origin referrer policy;
// the main host is never framed, the back office loads only its own code,
// and HTTPS deployments send HSTS. Static and sandbox hosts do not get
// these defaults (pages run there by design).
func TestTrustedHostHeaders(t *testing.T) {
	h := newHarnessWith(t, func(c *config.Config) { c.Scheme = "https" })
	main, live := h.cfg.Hosts.Main, h.cfg.Hosts.Live[0]
	for _, c := range []struct{ host, path string }{{main, "/"}, {main, "/auth/login"}, {main, "/auth/session"}, {live, "/_site/me"}} {
		r, _ := h.get(c.host, c.path)
		hd := r.Header
		if !strings.Contains(hd.Get("Content-Security-Policy"), "frame-ancestors 'none'") || hd.Get("X-Content-Type-Options") != "nosniff" ||
			hd.Get("Referrer-Policy") != "same-origin" || hd.Get("Strict-Transport-Security") == "" {
			t.Fatalf("%s%s: csp %q nosniff %q referrer %q hsts %q", c.host, c.path, hd.Get("Content-Security-Policy"),
				hd.Get("X-Content-Type-Options"), hd.Get("Referrer-Policy"), hd.Get("Strict-Transport-Security"))
		}
		if c.host == main && hd.Get("X-Frame-Options") != "DENY" {
			t.Fatalf("%s%s: X-Frame-Options %q", c.host, c.path, hd.Get("X-Frame-Options"))
		}
	}
	if r, _ := h.get(main, "/"); !strings.Contains(r.Header.Get("Content-Security-Policy"), "default-src 'self'") {
		t.Fatalf("back office CSP = %q", r.Header.Get("Content-Security-Policy"))
	}
	if r, _ := h.get(h.cfg.Hosts.Static[0], "/"); r.Header.Get("Strict-Transport-Security") != "" || r.Header.Get("X-Frame-Options") != "" {
		t.Fatalf("static host got trusted defaults: %v", r.Header)
	}
}
