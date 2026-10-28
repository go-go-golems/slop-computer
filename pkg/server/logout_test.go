package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/store/storetest"
)

// Signing out from a server-rendered page (the pending screen, safe mode)
// must end the identity provider session too: back on / a live provider
// session would sign the person straight in again.
func TestFormLogoutEndsProviderSession(t *testing.T) {
	var idp *httptest.Server
	idp = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"issuer": idp.URL, "authorization_endpoint": idp.URL + "/authorize",
			"token_endpoint": idp.URL + "/token", "jwks_uri": idp.URL + "/keys", "end_session_endpoint": idp.URL + "/end_session"})
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
	user, err := st.UpsertIdentity(ctx, store.Identity{Issuer: idp.URL, Subject: "42", Name: "Pending"}, store.RolePending)
	if err != nil {
		t.Fatal(err)
	}
	token, sess, err := st.CreateSession(ctx, user.ID, "the-id-token")
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("POST", ts.URL+"/auth/logout", strings.NewReader(url.Values{"csrf": {sess.CSRF}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", ts.URL)
	req.AddCookie(&http.Cookie{Name: srv.sessionCookie(), Value: token})
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if resp.StatusCode != http.StatusSeeOther || loc.Path != "/end_session" || loc.Query().Get("id_token_hint") != "the-id-token" ||
		loc.Query().Get("post_logout_redirect_uri") != ts.URL+"/" {
		t.Fatalf("form logout: %d %s", resp.StatusCode, loc)
	}
	if _, _, err := st.ResolveSession(ctx, token); err == nil {
		t.Fatal("the slop session survived the logout")
	}
}
