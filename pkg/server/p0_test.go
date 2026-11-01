package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/go-go-golems/slop/pkg/actor"
	"github.com/go-go-golems/slop/pkg/config"
	"github.com/go-go-golems/slop/pkg/kernel"
	"github.com/go-go-golems/slop/pkg/system"
	"github.com/go-go-golems/slop/pkg/verbs"
)

// harness runs a server behind httptest and lets requests choose a Host.
type harness struct {
	t   *testing.T
	ts  *httptest.Server
	cfg *config.Config
	sys *system.DB
	k   *kernel.Kernel
	a   *actor.Manager
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	cfg := &config.Config{Local: true, Data: t.TempDir(), Listen: "127.0.0.1:18399", AdminEmails: []string{"admin@example.com"}}
	cfg.Defaults()
	sys, err := system.Open(context.Background(), filepath.Join(cfg.Data, "system.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sys.Close() })
	k, err := kernel.New(cfg, sys)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(k.Close)
	env := &verbs.Env{Cfg: cfg, Sys: sys, K: k, A: actor.New(k)}
	srv, err := Build(context.Background(), cfg, sys, env)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return &harness{t: t, ts: ts, cfg: cfg, sys: sys, k: k, a: env.A}
}

// browser is a cookie-keeping client that sends Host: main.
type browser struct {
	h  *harness
	c  *http.Client
	jr http.CookieJar
}

func (h *harness) browser() *browser {
	jar, _ := cookiejar.New(nil)
	return &browser{h: h, jr: jar, c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (b *browser) do(method, path, host string, body io.Reader, hdr map[string]string) *http.Response {
	b.h.t.Helper()
	u := b.h.ts.URL + path
	req, err := http.NewRequest(method, u, body)
	if err != nil {
		b.h.t.Fatal(err)
	}
	req.Host = host
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	// Cookies are kept per test server URL, whatever the Host.
	resp, err := b.c.Do(req)
	if err != nil {
		b.h.t.Fatal(err)
	}
	return resp
}

func readJSON(t *testing.T, r *http.Response) map[string]any {
	t.Helper()
	defer r.Body.Close()
	var m map[string]any
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		t.Fatalf("decode (%d): %v", r.StatusCode, err)
	}
	return m
}

func (b *browser) signIn(email string) {
	b.h.t.Helper()
	form := url.Values{"email": {email}, "name": {"Test"}, "return": {"/"}}
	r := b.do("POST", "/auth/local", b.h.cfg.Hosts.Main, strings.NewReader(form.Encode()), map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	if r.StatusCode != 303 {
		b.h.t.Fatalf("sign in: %d", r.StatusCode)
	}
}

func api(t *testing.T, h *harness, token, verb string, args any) (int, map[string]any) {
	t.Helper()
	body, _ := json.Marshal(args)
	req, _ := http.NewRequest("POST", h.ts.URL+"/api/v1/"+verb, bytes.NewReader(body))
	req.Host = h.cfg.Hosts.Main
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, readJSON(t, resp)
}

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
	a, _, _ := h.sys.SignInUser(ctx, "Admin@Example.com", "", "", h.cfg.AdminEmails, true)
	m, _, _ := h.sys.SignInUser(ctx, "kim@example.com", "", "", h.cfg.AdminEmails, true)
	p, _, _ := h.sys.SignInUser(ctx, "pat@example.com", "", "", h.cfg.AdminEmails, false)
	if a.Role != "admin" || m.Role != "member" || p.Role != "pending" {
		t.Fatalf("roles: %s %s %s", a.Role, m.Role, p.Role)
	}
	// Signing in again keeps the same person.
	m2, created, _ := h.sys.SignInUser(ctx, "kim@example.com", "", "", h.cfg.AdminEmails, true)
	if created || m2.ID != m.ID {
		t.Fatalf("second sign-in made a new person")
	}
	// Disabling revokes tokens.
	_, tk, _ := h.sys.CreateToken(ctx, m.ID, "x", []string{"read"}, 1)
	if _, err := h.sys.SetRole(ctx, a.ID, m.ID, "disabled"); err != nil {
		t.Fatal(err)
	}
	got, _ := h.sys.Token(ctx, tk.ID)
	if got.RevokedAt == nil {
		t.Fatalf("disabling did not revoke the token")
	}
}
