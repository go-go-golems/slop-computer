package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/store/storetest"
)

// harness runs a local-mode server on httptest with a fresh store.
type harness struct {
	t   *testing.T
	srv *Server
	ts  *httptest.Server
	st  *store.Store
}

func newHarness(t *testing.T, role string) *harness {
	t.Helper()
	st := storetest.Open(t)
	ts := httptest.NewUnstartedServer(nil)
	ts.Start()
	t.Cleanup(ts.Close)
	u, _ := url.Parse(ts.URL)
	cfg := Config{PublicURL: u, Local: &LocalConfig{Role: role}}
	if err := cfg.Validate(u.Host); err != nil {
		t.Fatal(err)
	}
	bl, err := blobs.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	srv := New(cfg, st, bl)
	ts.Config.Handler = srv.Handler()
	return &harness{t: t, srv: srv, ts: ts, st: st}
}

// browser is a cookie-carrying client signed in as a nickname.
type browser struct {
	h    *harness
	c    *http.Client
	csrf string
	user map[string]any
}

func (h *harness) signIn(nick string) *browser {
	h.t.Helper()
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, _ := http.NewRequest("POST", h.ts.URL+"/auth/local", strings.NewReader(url.Values{"nickname": {nick}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", h.ts.URL)
	resp, err := c.Do(req)
	if err != nil || resp.StatusCode != 303 {
		h.t.Fatalf("sign in %s: %v %v", nick, err, resp)
	}
	b := &browser{h: h, c: c}
	var me map[string]any
	if code := b.do("GET", "/api/me", nil, &me); code != 200 {
		h.t.Fatalf("me: %d", code)
	}
	b.csrf, _ = me["csrfToken"].(string)
	b.user, _ = me["user"].(map[string]any)
	return b
}

func (b *browser) id() string { return b.user["id"].(string) }

// do sends a JSON request with Origin and CSRF headers and decodes the reply.
func (b *browser) do(method, path string, body any, out any) int {
	b.h.t.Helper()
	return b.h.call(b.c, method, path, body, out, map[string]string{"Origin": b.h.ts.URL, "X-CSRF-Token": b.csrf})
}

// token mints a token for an existing user directly in the store.
func (h *harness) token(userID string, scopes ...string) string {
	h.t.Helper()
	exp := time.Now().Add(time.Hour)
	secret, _, err := h.st.CreateToken(context.Background(), userID, "test", scopes, &exp)
	if err != nil {
		h.t.Fatal(err)
	}
	return secret
}

// bearer sends a request with an API token.
func (h *harness) bearer(token, method, path string, body any, out any) int {
	h.t.Helper()
	return h.call(http.DefaultClient, method, path, body, out, map[string]string{"Authorization": "Bearer " + token})
}

func (h *harness) call(c *http.Client, method, path string, body any, out any, headers map[string]string) int {
	h.t.Helper()
	var r io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		r = strings.NewReader(string(raw))
	}
	req, _ := http.NewRequest(method, h.ts.URL+path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if out != nil {
		_ = json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}
