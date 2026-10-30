package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/store/storetest"
)

// A failed sign-in shows the problem page where it happened, never a redirect
// to a page that does not know about it, and offers a fresh sign-in to where
// the person was going (SLOP-013).
func TestSignInProblems(t *testing.T) {
	var idp *httptest.Server
	discovery := true
	idp = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" || !discovery {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"issuer": idp.URL, "authorization_endpoint": idp.URL + "/authorize",
			"token_endpoint": idp.URL + "/token", "jwks_uri": idp.URL + "/keys"})
	}))
	defer idp.Close()

	st := storetest.Open(t)
	ts := httptest.NewUnstartedServer(nil)
	ts.Start()
	defer ts.Close()
	u, _ := url.Parse(ts.URL)
	cfg := Config{PublicURL: u, SiteHosts: []string{"site.test"}, SandboxDomain: "sandbox.test",
		OIDC: identity.New(identity.Config{Issuer: idp.URL, ClientID: "slop-web", RedirectURL: ts.URL + "/auth/callback"})}
	if err := cfg.Validate(u.Host); err != nil {
		t.Fatal(err)
	}
	bl, err := blobs.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	srv := New(cfg, st, bl)
	ts.Config.Handler = srv.Handler()
	ctx := context.Background()
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	get := func(path string, cookie *http.Cookie) (int, http.Header, string) {
		t.Helper()
		req, _ := http.NewRequest("GET", ts.URL+path, nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		resp, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, resp.Header, string(b)
	}
	continueTo := func(body string) string {
		t.Helper()
		const marker = `<a class="button primary" href="`
		i := strings.Index(body, marker)
		if i < 0 {
			t.Fatalf("no Continue link in\n%s", body)
		}
		rest := body[i+len(marker):]
		href := strings.ReplaceAll(rest[:strings.Index(rest, `"`)], "&amp;", "&")
		v, err := url.Parse(href)
		if err != nil || v.Path != "/auth/login" {
			t.Fatalf("Continue href %q", href)
		}
		return v.Query().Get("return")
	}

	// The user's case: the sign-in started in browser A (a flow for
	// /device?code=…), the callback arrives in browser B without the cookie.
	saved := func(state, ret string) {
		t.Helper()
		if err := st.SaveLoginFlow(ctx, state, store.LoginFlow{BindingHash: store.Hash("binding-" + state), Nonce: "n", Verifier: "v", ReturnPath: ret}, 10*time.Minute); err != nil {
			t.Fatal(err)
		}
	}
	saved("state-a", "/device?code=ABCD-EFGH")
	status, h, body := get("/auth/callback?state=state-a&code=c", nil)
	if status != http.StatusBadRequest || h.Get("Location") != "" || !strings.Contains(body, "This sign-in started in another browser") {
		t.Fatalf("flow_missing: %d %q\n%s", status, h.Get("Location"), body)
	}
	if got := continueTo(body); got != "/device?code=ABCD-EFGH" {
		t.Fatalf("flow_missing continues to %q", got)
	}

	// Unknown state: continue to /.
	_, _, body = get("/auth/callback?state=nobody&code=c", nil)
	if got := continueTo(body); got != "/" {
		t.Fatalf("unknown state continues to %q", got)
	}

	// A cookie that does not match (another browser's, or a replay).
	saved("state-b", "/watch/storefront")
	status, _, body = get("/auth/callback?state=state-b&code=c", &http.Cookie{Name: srv.flowCookie(), Value: "not-the-binding"})
	if status != http.StatusBadRequest || !strings.Contains(body, "already used or has expired") || continueTo(body) != "/watch/storefront" {
		t.Fatalf("flow_invalid: %d\n%s", status, body)
	}

	// The provider refused or the person cancelled.
	saved("state-c", "/routes")
	status, _, body = get("/auth/callback?state=state-c&error=access_denied", nil)
	if status != http.StatusForbidden || !strings.Contains(body, "Sign-in was cancelled") || continueTo(body) != "/routes" {
		t.Fatalf("denied: %d\n%s", status, body)
	}

	// A stored return path is never trusted as is.
	saved("state-d", "//evil.example/x")
	_, _, body = get("/auth/callback?state=state-d&code=c", nil)
	if got := continueTo(body); got != "/" {
		t.Fatalf("unsafe return continues to %q", got)
	}

	// The provider is down when the sign-in starts.
	discovery = false
	status, h, body = get("/auth/login?return=%2Fsite", nil)
	if status != http.StatusServiceUnavailable || h.Get("Location") != "" || continueTo(body) != "/site" {
		t.Fatalf("provider_unavailable: %d %q\n%s", status, h.Get("Location"), body)
	}
}
