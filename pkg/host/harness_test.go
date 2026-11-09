package host

// The test harness: the server under httptest, signed-in tokens,
// a browser with cookies, live-host sites, and the readers the tests share
// (app folders, documents, event streams).

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/commands"
	"github.com/go-go-golems/slop-computer/pkg/config"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// harness runs a server behind httptest and lets requests choose a Host.
type harness struct {
	t   *testing.T
	ts  *httptest.Server
	cfg *config.Config
	sys *sysdb.DB
	k   *kernel.Kernel
	a   *actor.Manager
	srv *Server
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	return newHarnessWith(t, nil)
}

// newHarnessWith lets a test change the configuration before the server
// is built.
func newHarnessWith(t *testing.T, change func(*config.Config)) *harness {
	t.Helper()
	cfg := &config.Config{Local: true, Data: t.TempDir(), Listen: "127.0.0.1:18399", AdminEmails: []string{"admin@example.com"}}
	if change != nil {
		change(cfg)
	}
	// SLOP_TEST_ACTORS_RUNTIME=direct runs the suite's actors on the bare
	// goja runtime, the way back while it is kept (SLOP3-016 design doc 02).
	if r := os.Getenv("SLOP_TEST_ACTORS_RUNTIME"); r != "" && cfg.Actors.Runtime == "" {
		cfg.Actors.Runtime = r
	}
	cfg.Defaults()
	sys, err := sysdb.Open(context.Background(), filepath.Join(cfg.Data, "system.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sys.Close() })
	k, err := kernel.New(cfg, sys)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(k.Close)
	env := &commands.Env{Cfg: cfg, K: k, A: actor.New(k)}
	srv, err := Build(context.Background(), cfg, sys, env)
	if err != nil {
		t.Fatal(err)
	}
	checkOutputs(t, srv.Verbs)
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return &harness{t: t, ts: ts, cfg: cfg, sys: sys, k: k, a: env.A, srv: srv}
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

// tokenFor signs a person in (making them on first use) and mints a token.
func (h *harness) tokenFor(email string, scopes ...string) string {
	h.t.Helper()
	ctx := context.Background()
	p, _, err := h.k.People.SignInUser(ctx, email, "", "sub-"+email, h.cfg.AdminEmails, true)
	if err != nil {
		h.t.Fatal(err)
	}
	if len(scopes) == 0 {
		scopes = []string{"read", "write"}
	}
	secret, _, err := h.k.People.CreateToken(ctx, p.ID, "test", scopes, 30)
	if err != nil {
		h.t.Fatal(err)
	}
	return secret
}

// call runs a verb and fails the test unless it succeeds.
func (h *harness) call(token, verb string, args map[string]any) any {
	h.t.Helper()
	st, out := api(h.t, h, token, verb, args)
	if st != 200 {
		h.t.Fatalf("%s %v: %d %v", verb, args, st, out)
	}
	return out["result"]
}

// fail runs a verb that must fail with code.
func (h *harness) fail(token, verb string, args map[string]any, code string) map[string]any {
	h.t.Helper()
	st, out := api(h.t, h, token, verb, args)
	e, _ := out["error"].(map[string]any)
	if st == 200 || e == nil || e["code"] != code {
		h.t.Fatalf("%s %v: want %s, got %d %v", verb, args, code, st, out)
	}
	return e
}

// get fetches a path on a host without following redirects.
func (h *harness) get(host, path string) (*http.Response, string) {
	h.t.Helper()
	req, _ := http.NewRequest("GET", h.ts.URL+path, nil)
	req.Host = host
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := c.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(b)
}

func files(m map[string]string) []any {
	out := []any{}
	for p, t := range m {
		out = append(out, map[string]any{"path": p, "text": t})
	}
	return out
}

// site is a browser on a live host: it keeps the site cookie.
type site struct {
	h    *harness
	host string
	c    *http.Client
}

func (h *harness) site(host string) *site {
	jar, _ := cookiejar.New(nil)
	return &site{h: h, host: host, c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (s *site) do(method, host, path string, body any, hdr map[string]string) (*http.Response, map[string]any) {
	s.h.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, s.h.ts.URL+path, rd)
	req.Host = host
	// The cookie jar keys on the request URL; send the host's cookies by hand.
	u, _ := url.Parse("http://" + host + path)
	for _, c := range s.c.Jar.Cookies(u) {
		req.AddCookie(c)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://"+host)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := s.c.Do(req)
	if err != nil {
		s.h.t.Fatal(err)
	}
	if cs := resp.Cookies(); len(cs) > 0 {
		s.c.Jar.SetCookies(u, cs)
	}
	if strings.Contains(resp.Header.Get("Content-Type"), "event-stream") {
		return resp, nil
	}
	defer resp.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

// events reads SSE events from a stream until n arrive or the timeout.
func events(t *testing.T, resp *http.Response, n int, timeout time.Duration) []map[string]any {
	t.Helper()
	out := []map[string]any{}
	done := make(chan struct{})
	go func() {
		defer close(done)
		sc := bufio.NewScanner(resp.Body)
		typ := ""
		for sc.Scan() {
			line := sc.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				typ = line[7:]
			case strings.HasPrefix(line, "data: "):
				var d map[string]any
				_ = json.Unmarshal([]byte(line[6:]), &d)
				d["_type"] = typ
				out = append(out, d)
				if len(out) >= n {
					return
				}
			}
		}
	}()
	select {
	case <-done:
	case <-time.After(timeout):
	}
	resp.Body.Close()
	<-done
	return out
}

func waitFor(t *testing.T, what string, fn func() bool) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if fn() {
			return
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

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
	d, err := st.GetDoc(context.Background(), path, store.Everything)
	if err != nil || d.Body == nil {
		return nil
	}
	return d.Body
}

// page is a browser request on a site that keeps the body as text (for
// HTML answers and form posts).
func (s *site) page(method, host, path, form string, hdr map[string]string) (*http.Response, string) {
	s.h.t.Helper()
	req, _ := http.NewRequest(method, s.h.ts.URL+path, strings.NewReader(form))
	req.Host = host
	u, _ := url.Parse("http://" + host + path)
	for _, c := range s.c.Jar.Cookies(u) {
		req.AddCookie(c)
	}
	if form != "" {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := s.c.Do(req)
	if err != nil {
		s.h.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

// appDir reads an app folder of the repository (apps/<name>) as files.push
// entries.
func appDir(t *testing.T, name string) []any {
	t.Helper()
	root := filepath.Join("..", "..", "apps", name)
	m := map[string]string{}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := os.ReadFile(p)
		rel, _ := filepath.Rel(root, p)
		m[filepath.ToSlash(rel)] = string(b)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return files(m)
}

// exampleFiles reads apps/examples/<name> as files.push entries.
func exampleFiles(t *testing.T, name string) []any {
	t.Helper()
	return appDir(t, filepath.Join("examples", name))
}

func docBody(h *harness, tok, storeID, path string) map[string]any {
	code, res := api(h.t, h, tok, "docs.get", map[string]any{"store": storeID, "path": path})
	if code != 200 {
		return nil
	}
	b, _ := res["result"].(map[string]any)["body"].(map[string]any)
	return b
}
