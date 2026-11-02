package server

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"

	"github.com/go-go-golems/slop-computer/pkg/config"
)

// signInSite runs the live-host handoff for a site client whose browser b
// is signed in on the main host.
func signInSite(t *testing.T, h *harness, s *site, b *browser, host, ret string) {
	t.Helper()
	r, _ := s.do("GET", host, "/_site/login?return="+url.QueryEscape(ret), nil, nil)
	loc, _ := url.Parse(r.Header.Get("Location"))
	r = b.do("GET", loc.RequestURI(), h.cfg.Hosts.Main, nil, nil)
	cb, _ := url.Parse(r.Header.Get("Location"))
	if r, _ = s.do("GET", host, cb.RequestURI(), nil, nil); r.StatusCode != 303 {
		t.Fatalf("site sign-in: %d", r.StatusCode)
	}
}

// openView opens a view of the store mounted at path, with an optional
// share link, and returns the status and the view.
func openView(s *site, host, path, link string) (int, map[string]any) {
	r, v := s.do("POST", host, "/_site/views", map[string]any{"path": path, "link": link}, nil)
	return r.StatusCode, v
}

// rpc calls a view's RPC method.
func rpc(s *site, v map[string]any, method string, args any) map[string]any {
	u := strings.TrimPrefix(strings.Split(v["url"].(string), "/v/")[0], "http://")
	_, out := s.do("POST", u, "/_rt/rpc", map[string]any{"method": method, "args": args},
		map[string]string{"Authorization": "Bearer " + v["secret"].(string)})
	return out
}

// privateDoc reads a document from the store itself: docs.get hides
// data/users/<id>/ even from admins.
func privateDoc(t *testing.T, h *harness, storeID, path string) map[string]any {
	t.Helper()
	st, err := h.k.Store(context.Background(), storeID)
	if err != nil {
		t.Fatal(err)
	}
	d, err := st.GetDoc(context.Background(), path)
	if err != nil || d.Body == nil {
		return nil
	}
	return d.Body
}

// The P4 scenario suite: every audience against every kind of grant
// subject, read back through explain.can.
func TestAccessScenarios(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.tokenFor("mia@example.com")  // member
	h.tokenFor("sam@example.com")  // subscriber (below)
	h.tokenFor("pete@example.com") // pending
	h.tokenFor("dan@example.com")  // disabled
	h.tokenFor("ada@example.com")  // an admin who did not create the store
	people := map[string]string{}
	for _, e := range []string{"mia", "sam", "pete", "dan", "ada"} {
		p, err := h.sys.PersonByEmail(ctx, e+"@example.com")
		if err != nil {
			t.Fatal(err)
		}
		people[e] = p.ID
	}
	h.call(admin, "people.role", map[string]any{"id": people["pete"], "role": "pending"})
	h.call(admin, "people.role", map[string]any{"id": people["dan"], "role": "disabled"})
	h.call(admin, "people.role", map[string]any{"id": people["ada"], "role": "admin"})
	h.k.Access.Subscribed = func(_ context.Context, id string) bool { return id == people["sam"] }
	guest, err := h.sys.CreateGuest(ctx, "192.0.2.1")
	if err != nil {
		t.Fatal(err)
	}
	h.call(admin, "store.new", map[string]any{"id": "s"})
	h.call(admin, "store.new", map[string]any{"id": "other"})

	personas := []struct{ name, subject string }{
		{"anonymous", "anonymous"}, {"guest", guest.ID}, {"pending", people["pete"]}, {"member", people["mia"]},
		{"subscriber", people["sam"]}, {"admin", people["ada"]}, {"creator", "admin@example.com"}, {"disabled", people["dan"]},
		{"store", "store:other"},
	}
	cases := []struct {
		grants map[string]string // subject -> level
		want   []string          // per persona, in order
	}{
		{nil, []string{"none", "none", "none", "none", "none", "admin", "owner", "none", "none"}},
		// @guest is everyone but disabled accounts; store actors need a
		// grant of their own.
		{map[string]string{"@guest": "view"}, []string{"view", "view", "view", "view", "view", "admin", "owner", "none", "none"}},
		// Caps: guests (and pending users) at most interact, members and
		// subscribers at most admin.
		{map[string]string{"@guest": "admin"}, []string{"interact", "interact", "interact", "admin", "admin", "admin", "owner", "none", "none"}},
		{map[string]string{"@member": "interact"}, []string{"none", "none", "none", "interact", "interact", "admin", "owner", "none", "none"}},
		{map[string]string{"@subscriber": "interact"}, []string{"none", "none", "none", "none", "interact", "admin", "owner", "none", "none"}},
		// The highest grant counts; owner only by creation (a member's
		// owner grant is capped at admin).
		{map[string]string{"@member": "view", people["mia"]: "owner"}, []string{"none", "none", "none", "admin", "view", "admin", "owner", "none", "none"}},
		{map[string]string{guest.ID: "interact"}, []string{"none", "interact", "none", "none", "none", "admin", "owner", "none", "none"}},
		{map[string]string{"store:other": "view"}, []string{"none", "none", "none", "none", "none", "admin", "owner", "none", "view"}},
	}
	for i, c := range cases {
		for _, g := range h.call(admin, "grant.ls", map[string]any{"store": "s"}).([]any) {
			gm := g.(map[string]any)
			h.call(admin, "grant.rm", map[string]any{"store": "s", "subject": gm["subject"]})
		}
		for sub, lv := range c.grants {
			h.call(admin, "grant.set", map[string]any{"store": "s", "subject": sub, "level": lv})
		}
		for j, p := range personas {
			out := h.call(admin, "explain.can", map[string]any{"store": "s", "subject": p.subject}).(map[string]any)
			if out["level"] != c.want[j] {
				t.Errorf("case %d (%v), %s: level %v, want %s\n  trace: %v", i, c.grants, p.name, out["level"], c.want[j], out["trace"])
			}
		}
	}
	// A denial explains itself, including a rule on a document path.
	h.call(admin, "grant.set", map[string]any{"store": "s", "subject": "@guest", "level": "view"})
	out := h.call(admin, "explain.can", map[string]any{"store": "s", "subject": guest.ID, "level": "interact"}).(map[string]any)
	tr := fmt.Sprint(out["trace"]) // not JSON: it escapes "<"
	if out["ok"] != false || out["code"] != "permission_denied" || !strings.Contains(tr, "grant @guest view on s (direct)") || !strings.Contains(tr, "view < interact") {
		t.Fatalf("denial = %v", out)
	}
	// Only admins explain other people.
	mia := h.tokenFor("mia@example.com")
	h.fail(mia, "explain.can", map[string]any{"store": "s", "subject": guest.ID}, "permission_denied")
	if me := h.call(mia, "explain.can", map[string]any{"store": "s"}).(map[string]any); me["level"] != "view" {
		t.Fatalf("mia explains herself = %v", me)
	}
}

// P4 exit: share links — redemption, never lowering, an invalid token, and
// revocation, which closes the views the link opened; and reopen (a level
// change closes the view, a new one has the new level) versus revoked (no
// level left).
func TestShareLinks(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "notes"})
	h.call(admin, "files.push", map[string]any{"store": "notes", "files": files(map[string]string{
		"app.json": `{"title":"Notes","capabilities":{"db":{}}}`, "index.html": "<!doctype html><title>n</title>"})})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/notes", "store": "notes"})

	// Nobody may open it yet.
	g := h.site(live)
	if st, _ := openView(g, live, "/notes", ""); st != 401 {
		t.Fatalf("closed store: %d", st)
	}
	l := h.call(admin, "link.new", map[string]any{"store": "notes", "level": "interact", "days": 30, "url": "http://" + live + "/notes"}).(map[string]any)
	token := l["token"].(string)
	if !strings.HasSuffix(l["url"].(string), "/notes?k="+url.QueryEscape(token)) {
		t.Fatalf("link url = %v", l["url"])
	}
	if st, v := openView(g, live, "/notes", "k_wrong"); st != 403 || v["error"].(map[string]any)["code"] != "link_invalid" {
		t.Fatalf("wrong token: %d %v", st, v)
	}
	st, v := openView(g, live, "/notes", token)
	if st != 200 || v["level"] != "interact" {
		t.Fatalf("redeemed: %d %v", st, v)
	}
	// The grant stays: the next open needs no link.
	st, v = openView(g, live, "/notes", "")
	if st != 200 || v["level"] != "interact" {
		t.Fatalf("reopen without link: %d %v", st, v)
	}
	if out := rpc(g, v, "db.write", map[string]any{"path": "items/a", "op": "set", "body": map[string]any{"x": 1}}); out["error"] != nil {
		t.Fatalf("write through link grant: %v", out)
	}
	// A link never lowers: the owner opening a view link stays owner.
	view := h.call(admin, "link.new", map[string]any{"store": "notes", "level": "view"}).(map[string]any)
	ab := h.browser()
	ab.signIn("admin@example.com")
	as := h.site(live)
	signInSite(t, h, as, ab, live, "/notes")
	if st, v := openView(as, live, "/notes", view["token"].(string)); st != 200 || v["level"] != "owner" {
		t.Fatalf("admin with a view link: %d %v", st, v)
	}
	links := h.call(admin, "link.ls", map[string]any{"store": "notes"}).([]any)
	uses := map[string]float64{}
	for _, x := range links {
		m := x.(map[string]any)
		uses[m["id"].(string)] = m["uses"].(float64)
	}
	if uses[l["link"].(map[string]any)["id"].(string)] != 1 || uses[view["link"].(map[string]any)["id"].(string)] != 0 {
		t.Fatalf("link uses = %v", uses)
	}

	// Reopen versus revoked. A grant that leaves the guest's level as it
	// was keeps the view open...
	h.call(admin, "grant.set", map[string]any{"store": "notes", "subject": "@guest", "level": "view"})
	if out := rpc(g, v, "db.get", map[string]any{"path": "items/a"}); out["error"] != nil {
		t.Fatalf("view after a grant that changed nothing: %v", out)
	}
	// ...revoking the link leaves the guest @guest view: a level change. The
	// interact view is closed (it must not go on writing); the shell opens
	// a new one at view.
	h.call(admin, "link.rm", map[string]any{"id": l["link"].(map[string]any)["id"]})
	if out := rpc(g, v, "db.write", map[string]any{"path": "items/b", "op": "set", "body": map[string]any{"x": 2}}); out["error"] == nil {
		t.Fatalf("the interact view still writes after the link was revoked: %v", out)
	}
	st, v = openView(g, live, "/notes", "")
	if st != 200 || v["level"] != "view" {
		t.Fatalf("reopen with @guest view left: %d %v", st, v)
	}
	if out := rpc(g, v, "db.get", map[string]any{"path": "items/a"}); out["error"] != nil {
		t.Fatalf("view with @guest view left: %v", out)
	}
	if st, v2 := openView(g, live, "/notes", token); st != 403 || v2["error"].(map[string]any)["code"] != "link_invalid" {
		t.Fatalf("revoked link: %d %v", st, v2)
	}
	// ...and with no level left, the view is closed.
	h.call(admin, "grant.rm", map[string]any{"store": "notes", "subject": "@guest"})
	out := rpc(g, v, "db.get", map[string]any{"path": "items/a"})
	if out["error"] == nil {
		t.Fatalf("view stayed open after its access was revoked: %v", out)
	}
	if st, _ := openView(g, live, "/notes", ""); st != 401 && st != 403 {
		t.Fatalf("open after revoke: %d", st)
	}
}

// P4 exit: the cross-site guest claim. A guest writes a private document
// and redeems a link on one site, signs in, and keeps both.
func TestGuestClaim(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	for _, id := range []string{"pad", "club"} {
		h.call(admin, "store.new", map[string]any{"id": id})
		h.call(admin, "files.push", map[string]any{"store": id, "files": files(map[string]string{
			"app.json": `{"title":"` + id + `","capabilities":{"db":{}}}`, "index.html": "<!doctype html><title>x</title>"})})
		h.call(admin, "mount.set", map[string]any{"host": live, "path": "/" + id, "store": id})
	}
	h.call(admin, "grant.set", map[string]any{"store": "pad", "subject": "@guest", "level": "interact"})
	l := h.call(admin, "link.new", map[string]any{"store": "club", "level": "view"}).(map[string]any)

	s := h.site(live)
	st, v := openView(s, live, "/pad", "")
	if st != 200 {
		t.Fatalf("guest open: %d %v", st, v)
	}
	_, me := s.do("GET", live, "/_site/me", nil, nil)
	vis := me["id"].(string)
	if !strings.HasPrefix(vis, "vis_") {
		t.Fatalf("me = %v", me)
	}
	if out := rpc(s, v, "db.write", map[string]any{"path": "data/users/" + vis + "/draft", "op": "set", "body": map[string]any{"text": "mine"}}); out["error"] != nil {
		t.Fatalf("private write: %v", out)
	}
	if st, _ := openView(s, live, "/club", l["token"].(string)); st != 200 {
		t.Fatalf("link as guest: %d", st)
	}

	// Sign in on the main host, then on the site: the session remembers
	// the guest, and /_site/me offers the claim.
	b := h.browser()
	b.signIn("rosa@example.com")
	signInSite(t, h, s, b, live, "/pad")
	_, me = s.do("GET", live, "/_site/me", nil, nil)
	claim, _ := me["claim"].(map[string]any)
	if me["kind"] != "user" || claim == nil || claim["docs"] != 1.0 || claim["grants"] != 1.0 {
		t.Fatalf("me after sign-in = %v", me)
	}
	usr := me["id"].(string)
	r, out := s.do("POST", live, "/_site/claim", map[string]any{"keep": true}, nil)
	if r.StatusCode != 200 || out["docs"] != 1.0 || out["grants"] != 1.0 {
		t.Fatalf("claim: %d %v", r.StatusCode, out)
	}
	if d := privateDoc(t, h, "pad", "data/users/"+usr+"/draft"); d == nil || d["text"] != "mine" {
		t.Fatalf("claimed doc = %v", d)
	}
	if e := h.call(admin, "explain.can", map[string]any{"store": "club", "subject": usr}).(map[string]any); e["level"] != "view" {
		t.Fatalf("claimed grant: %v", e)
	}
	if e := h.call(admin, "explain.can", map[string]any{"store": "club", "subject": vis}).(map[string]any); e["level"] != "none" {
		t.Fatalf("guest kept its grant: %v", e)
	}
	// The offer is settled.
	if _, me = s.do("GET", live, "/_site/me", nil, nil); me["claim"] != nil {
		t.Fatalf("offer still open: %v", me)
	}
	if r, _ := s.do("POST", live, "/_site/claim", map[string]any{"keep": true}, nil); r.StatusCode != 404 {
		t.Fatalf("second claim: %d", r.StatusCode)
	}
}

// Guests: at most 30 new ones an hour from one address; unseen for 90 days
// they are swept, with their grants and private documents.
func TestGuestLimitAndSweep(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "open"})
	h.call(admin, "files.push", map[string]any{"store": "open", "files": files(map[string]string{
		"app.json": `{"title":"Open","capabilities":{"db":{}}}`, "index.html": "<!doctype html><title>o</title>"})})
	h.call(admin, "grant.set", map[string]any{"store": "open", "subject": "@guest", "level": "interact"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/open", "store": "open"})

	var first map[string]any
	var firstSite *site
	for i := 0; i < 30; i++ {
		s := h.site(live)
		st, v := openView(s, live, "/open", "")
		if st != 200 {
			t.Fatalf("guest %d: %d %v", i, st, v)
		}
		if i == 0 {
			first, firstSite = v, s
		}
	}
	if st, v := openView(h.site(live), live, "/open", ""); st != 429 {
		t.Fatalf("31st guest: %d %v", st, v)
	}

	_, me := firstSite.do("GET", live, "/_site/me", nil, nil)
	vis := me["id"].(string)
	rpc(firstSite, first, "db.write", map[string]any{"path": "data/users/" + vis + "/n", "op": "set", "body": map[string]any{"a": 1}})
	h.call(admin, "grant.set", map[string]any{"store": "open", "subject": vis, "level": "interact"})
	if _, err := h.sys.ExecContext(ctx, `UPDATE people SET last_seen_at = ? WHERE id = ?`, time.Now().Add(-91*24*time.Hour).UnixMilli(), vis); err != nil {
		t.Fatal(err)
	}
	if d := privateDoc(t, h, "open", "data/users/"+vis+"/n"); d == nil {
		t.Fatal("the guest's private doc was not written")
	}
	out := h.call(admin, "guest.sweep", map[string]any{}).(map[string]any)
	if out["deleted"] != 1.0 {
		t.Fatalf("sweep = %v", out)
	}
	if _, err := h.sys.Person(ctx, vis); err == nil {
		t.Fatal("the guest is still there")
	}
	if d := privateDoc(t, h, "open", "data/users/"+vis+"/n"); d != nil {
		t.Fatalf("private doc survived: %v", d)
	}
	for _, g := range h.call(admin, "grant.ls", map[string]any{"store": "open"}).([]any) {
		if g.(map[string]any)["subject"] == vis {
			t.Fatal("grant survived the sweep")
		}
	}
}

// fakeOP is a minimal OpenID provider: discovery, authorize (it signs the
// user in at once), token with PKCE, JWKS.
type fakeOP struct {
	ts       *httptest.Server
	key      *rsa.PrivateKey
	clientID string
	mu       sync.Mutex
	codes    map[string]fakeCode
	email    string
	scope    string // of the last authorize request
}

type fakeCode struct{ nonce, challenge, redirect string }

func newFakeOP(t *testing.T, clientID, email string) *fakeOP {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	op := &fakeOP{key: key, clientID: clientID, codes: map[string]fakeCode{}, email: email}
	m := http.NewServeMux()
	m.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		iss := op.ts.URL
		_ = json.NewEncoder(w).Encode(map[string]any{"issuer": iss, "authorization_endpoint": iss + "/authorize",
			"token_endpoint": iss + "/token", "jwks_uri": iss + "/keys", "userinfo_endpoint": iss + "/userinfo", "end_session_endpoint": iss + "/logout",
			"id_token_signing_alg_values_supported": []string{"RS256"}, "response_types_supported": []string{"code"},
			"subject_types_supported": []string{"public"}, "code_challenge_methods_supported": []string{"S256"}})
	})
	m.HandleFunc("GET /keys", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"}}})
	})
	m.HandleFunc("GET /authorize", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("code_challenge_method") != "S256" || q.Get("client_id") != op.clientID {
			http.Error(w, "bad authorize request", 400)
			return
		}
		code := "c" + q.Get("state")[:8]
		op.mu.Lock()
		op.scope = q.Get("scope")
		op.codes[code] = fakeCode{q.Get("nonce"), q.Get("code_challenge"), q.Get("redirect_uri")}
		op.mu.Unlock()
		http.Redirect(w, r, q.Get("redirect_uri")+"?code="+code+"&state="+url.QueryEscape(q.Get("state")), http.StatusSeeOther)
	})
	m.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json") // oauth2 parses anything else as a form
		_ = r.ParseForm()
		op.mu.Lock()
		c, ok := op.codes[r.PostForm.Get("code")]
		delete(op.codes, r.PostForm.Get("code"))
		op.mu.Unlock()
		sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
		if !ok || base64.RawURLEncoding.EncodeToString(sum[:]) != c.challenge || r.PostForm.Get("redirect_uri") != c.redirect {
			w.WriteHeader(400)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
			return
		}
		signer, _ := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "k1"))
		now := time.Now().Unix()
		claims, _ := json.Marshal(map[string]any{"iss": op.ts.URL, "sub": "u-123", "aud": []string{op.clientID}, "azp": op.clientID,
			"exp": now + 300, "iat": now, "nonce": c.nonce, "email": op.email, "email_verified": true, "name": "Olga OIDC"})
		jws, _ := signer.Sign(claims)
		idt, _ := jws.CompactSerialize()
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "at", "token_type": "Bearer", "expires_in": 300, "id_token": idt})
	})
	op.ts = httptest.NewServer(m)
	t.Cleanup(op.ts.Close)
	return op
}

// P4: sign-in with OIDC (PKCE, nonce, a flow bound to the browser).
func TestOIDCSignIn(t *testing.T) {
	op := newFakeOP(t, "slop-client", "olga@example.com")
	dir := t.TempDir()
	idFile := filepath.Join(dir, "client_id")
	if err := os.WriteFile(idFile, []byte("slop-client\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	h := newHarnessWith(t, func(c *config.Config) {
		c.Local = false
		c.OIDC = config.OIDC{Issuer: op.ts.URL, ClientIDFile: idFile, Scope: "urn:zitadel:iam:org:id:123456"}
	})
	b := h.browser()
	r := b.do("GET", "/auth/login?return=/x", h.cfg.Hosts.Main, nil, nil)
	auth, _ := url.Parse(r.Header.Get("Location"))
	if r.StatusCode != 303 || !strings.HasPrefix(auth.String(), op.ts.URL+"/authorize") {
		t.Fatalf("login: %d %s", r.StatusCode, auth)
	}
	// The provider signs the user in and sends them back.
	resp, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Get(auth.String())
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	back, _ := url.Parse(resp.Header.Get("Location"))
	if back.Path != "/auth/callback" {
		t.Fatalf("authorize: %d %s", resp.StatusCode, back)
	}
	// Another browser cannot finish this flow.
	other := h.browser()
	if r := other.do("GET", back.RequestURI(), h.cfg.Hosts.Main, nil, nil); r.StatusCode != 400 {
		t.Fatalf("callback in another browser: %d", r.StatusCode)
	}
	// That attempt did not consume the flow: the state is checked against
	// the browser's binding first. (It did; start again.)
	r = b.do("GET", "/auth/login?return=/x", h.cfg.Hosts.Main, nil, nil)
	auth, _ = url.Parse(r.Header.Get("Location"))
	resp, _ = (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Get(auth.String())
	resp.Body.Close()
	back, _ = url.Parse(resp.Header.Get("Location"))
	r = b.do("GET", back.RequestURI(), h.cfg.Hosts.Main, nil, nil)
	if r.StatusCode != 303 || r.Header.Get("Location") != "/x" {
		t.Fatalf("callback: %d %s", r.StatusCode, r.Header.Get("Location"))
	}
	info := readJSON(t, b.do("GET", "/auth/session", h.cfg.Hosts.Main, nil, nil))
	person, _ := info["person"].(map[string]any)
	if info["signedIn"] != true || person["email"] != "olga@example.com" || person["name"] != "Olga OIDC" {
		t.Fatalf("session = %v", info)
	}
	// ZITADEL's organization scope is asked for along with the standard ones.
	op.mu.Lock()
	scope := strings.Fields(op.scope)
	op.mu.Unlock()
	for _, want := range []string{"openid", "email", "profile", "urn:zitadel:iam:org:id:123456"} {
		if !slices.Contains(scope, want) {
			t.Fatalf("authorize scope %q lacks %s", op.scope, want)
		}
	}
	// Signing out ends the provider's session too (RP-initiated logout with
	// the ID token as hint), and comes back to the main host.
	r = b.do("POST", "/auth/logout", h.cfg.Hosts.Main, nil, nil)
	out, _ := url.Parse(r.Header.Get("Location"))
	lq := out.Query()
	if r.StatusCode != 303 || !strings.HasPrefix(out.String(), op.ts.URL+"/logout?") || lq.Get("client_id") != "slop-client" ||
		lq.Get("post_logout_redirect_uri") != h.cfg.MainURL()+"/" || strings.Count(lq.Get("id_token_hint"), ".") != 2 {
		t.Fatalf("logout: %d %s", r.StatusCode, out)
	}
	if info := readJSON(t, b.do("GET", "/auth/session", h.cfg.Hosts.Main, nil, nil)); info["signedIn"] != false {
		t.Fatalf("session after logout = %v", info)
	}
	// The back office signs out with fetch, which cannot follow the
	// redirect to the provider: asked for JSON, the server names it.
	r = b.do("GET", "/auth/login?return=/", h.cfg.Hosts.Main, nil, nil)
	auth, _ = url.Parse(r.Header.Get("Location"))
	resp, _ = (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Get(auth.String())
	resp.Body.Close()
	back, _ = url.Parse(resp.Header.Get("Location"))
	b.do("GET", back.RequestURI(), h.cfg.Hosts.Main, nil, nil)
	out2 := readJSON(t, b.do("POST", "/auth/logout", h.cfg.Hosts.Main, nil, map[string]string{"Accept": "application/json"}))
	if next, _ := out2["next"].(string); !strings.HasPrefix(next, op.ts.URL+"/logout?") || !strings.Contains(next, "id_token_hint=") {
		t.Fatalf("logout asked for JSON = %v", out2)
	}
	// The local form is off.
	if r := b.do("POST", "/auth/local", h.cfg.Hosts.Main, strings.NewReader("email=x@example.com"), map[string]string{"Content-Type": "application/x-www-form-urlencoded"}); r.StatusCode != 404 {
		t.Fatalf("local sign-in with OIDC: %d", r.StatusCode)
	}
}
