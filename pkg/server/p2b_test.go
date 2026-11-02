package server

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"testing"
	"time"
)

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

// The P2 exit test, second part: a page app runs on a live host for
// guests, and a write in one view reaches another view's stream.
func TestLiveHostViews(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "board"})
	h.call(admin, "files.push", map[string]any{"store": "board", "files": files(map[string]string{
		"app.json":   `{"title":"Board","type":"board","capabilities":{"db":{},"user":{"scopes":["profile"]},"room":{}}}`,
		"index.html": `<!doctype html><html><head><title>b</title></head><body>board</body></html>`,
		"app.css":    `body{}`,
	})})
	h.call(admin, "store.new", map[string]any{"id": "board-1", "app": "board", "type": "board"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/b/:id", "storeParam": "id", "type": "board", "createApp": "board"})

	// Without a guest grant, a visitor is asked to sign in.
	a := h.site(live)
	if r, _ := a.do("POST", live, "/_site/views", map[string]any{"path": "/b/board-1"}, nil); r.StatusCode != 401 {
		t.Fatalf("private: %d", r.StatusCode)
	}
	h.call(admin, "grant.set", map[string]any{"store": "board-1", "subject": "@guest", "level": "interact"})
	r, v1 := a.do("POST", live, "/_site/views", map[string]any{"path": "/b/board-1"}, nil)
	if r.StatusCode != 200 || v1["level"] != "interact" {
		t.Fatalf("guest view: %d %v", r.StatusCode, v1)
	}
	if _, me := a.do("GET", live, "/_site/me", nil, nil); me["kind"] != "guest" {
		t.Fatalf("me = %v", me)
	}
	// Cross-origin site calls are refused.
	if r, _ := a.do("POST", live, "/_site/views", map[string]any{"path": "/b/board-1"}, map[string]string{"Origin": "http://evil.example"}); r.StatusCode != 403 {
		t.Fatalf("cross-origin: %d", r.StatusCode)
	}
	// The shell is served at the mount path.
	resp, _ := a.do("GET", live, "/b/board-1", nil, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("shell: %d", resp.StatusCode)
	}

	// The sandbox origin serves the app with the runtime injected.
	u, _ := url.Parse(v1["url"].(string))
	sbx := u.Host
	req, _ := http.NewRequest("GET", h.ts.URL+u.RequestURI(), nil)
	req.Host = sbx
	pr, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(pr.Body)
	pr.Body.Close()
	if !strings.Contains(string(page), `id="slop-boot"`) || !strings.Contains(string(page), "/_slop/claude.js?v=") ||
		!strings.Contains(pr.Header.Get("Content-Security-Policy"), "frame-ancestors") {
		t.Fatalf("app page: %s", page)
	}
	if r, body := h.get(sbx, "/v/1/app.css"); r.StatusCode != 200 || body != "body{}" || r.Header.Get("Cache-Control") != cacheImmutable {
		t.Fatalf("app file: %d %q", r.StatusCode, body)
	}

	// A second guest opens a view; the first writes; the second hears it.
	b := h.site(live)
	_, v2 := b.do("POST", live, "/_site/views", map[string]any{"path": "/b/board-1"}, nil)
	stream, _ := b.do("GET", sbx, "/_rt/events", nil, map[string]string{"Authorization": "Bearer " + v2["secret"].(string)})
	if stream.StatusCode != 200 {
		t.Fatalf("stream: %d", stream.StatusCode)
	}
	rpc := func(secret, method string, args any) map[string]any {
		_, out := a.do("POST", sbx, "/_rt/rpc", map[string]any{"method": method, "args": args}, map[string]string{"Authorization": "Bearer " + secret})
		return out
	}
	if out := rpc(v2["secret"].(string), "db.subscribe", map[string]any{"sub": "s1", "path": "notes", "coll": true}); out["result"] == nil {
		t.Fatalf("subscribe: %v", out)
	}
	go func() {
		time.Sleep(200 * time.Millisecond)
		rpc(v1["secret"].(string), "db.write", map[string]any{"path": "notes/n1", "op": "set", "body": map[string]any{"text": "hi"}})
	}()
	evs := events(t, stream, 2, 3*time.Second)
	if len(evs) < 2 || evs[0]["_type"] != "hello" || evs[1]["_type"] != "doc" || evs[1]["path"] != "notes/n1" || evs[1]["rev"] == nil {
		t.Fatalf("events = %v", evs)
	}
	who := evs[0]["me"].(map[string]any)
	if who["guest"] != true || who["audience"] != "guest" {
		t.Fatalf("hello.me = %v", who)
	}
	// The write is in the store's log as the guest, via page.
	log := h.call(admin, "log.show", map[string]any{"store": "board-1", "limit": 1}).([]any)
	if e := log[0].(map[string]any); e["via"] != "page" || !strings.HasPrefix(e["principal"].(string), "vis_") || e["app"] != "board@1" {
		t.Fatalf("log = %v", e)
	}
	// A view of one store cannot use another store's origin.
	h.call(admin, "store.new", map[string]any{"id": "board-2", "app": "board", "type": "board"})
	h.call(admin, "grant.set", map[string]any{"store": "board-2", "subject": "@guest", "level": "view"})
	_, v3 := a.do("POST", live, "/_site/views", map[string]any{"path": "/b/board-2"}, nil)
	if out := rpc(v3["secret"].(string), "db.get", map[string]any{"path": "notes/n1"}); out["error"] == nil {
		t.Fatalf("cross-store rpc: %v", out)
	}
	// Revoking the guest grant closes the guests' views.
	h.call(admin, "grant.rm", map[string]any{"store": "board-1", "subject": "@guest"})
}

// The handoff signs a person in on a live host; a forged state fails.
func TestSiteHandoff(t *testing.T) {
	h := newHarness(t)
	live := h.cfg.Hosts.Live[0]
	b := h.browser()
	b.signIn("admin@example.com")
	s := h.site(live)
	r, _ := s.do("GET", live, "/_site/login?return=/b/x", nil, nil)
	loc, _ := url.Parse(r.Header.Get("Location"))
	if r.StatusCode != 303 || loc.Path != "/auth/handoff" {
		t.Fatalf("login: %d %s", r.StatusCode, loc)
	}
	r = b.do("GET", loc.RequestURI(), h.cfg.Hosts.Main, nil, nil)
	cb, _ := url.Parse(r.Header.Get("Location"))
	if r.StatusCode != 303 || cb.Path != "/_site/callback" {
		t.Fatalf("handoff: %d %s", r.StatusCode, cb)
	}
	// A browser without the state cookie cannot use the code.
	other := h.site(live)
	if r, _ := other.do("GET", live, cb.RequestURI(), nil, nil); r.StatusCode != 400 {
		t.Fatalf("stolen code: %d", r.StatusCode)
	}
	// The code was used up by that attempt; get a fresh one.
	r, _ = s.do("GET", live, "/_site/login?return=/b/x", nil, nil)
	loc, _ = url.Parse(r.Header.Get("Location"))
	r = b.do("GET", loc.RequestURI(), h.cfg.Hosts.Main, nil, nil)
	cb, _ = url.Parse(r.Header.Get("Location"))
	r, _ = s.do("GET", live, cb.RequestURI(), nil, nil)
	if r.StatusCode != 303 || r.Header.Get("Location") != "/b/x" {
		t.Fatalf("callback: %d %s", r.StatusCode, r.Header.Get("Location"))
	}
	if _, me := s.do("GET", live, "/_site/me", nil, nil); me["kind"] != "user" || me["role"] != "admin" {
		t.Fatalf("me after sign-in = %v", me)
	}
}

// Files under /_s/ are anyone's who can push to a store. On the live host
// (the shell's origin, with its sessions) they run nothing (a sandbox CSP)
// and what is not media is a download; the static host, which has no
// sessions, serves them as they are.
func TestLiveStoreFilesIsolated(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live, static := h.cfg.Hosts.Live[0], h.cfg.Hosts.Static[0]
	h.call(admin, "store.new", map[string]any{"id": "pub"})
	h.call(admin, "files.push", map[string]any{"store": "pub", "files": files(map[string]string{
		"index.html": "<!doctype html><script>fetch('/_site/me')</script>",
		"pic.svg":    `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`})})
	h.call(admin, "files.put", map[string]any{"store": "pub", "zone": "assets", "path": "up.html", "text": "<script>alert(1)</script>"})
	h.call(admin, "grant.set", map[string]any{"store": "pub", "subject": "@guest", "level": "view"})
	for path, download := range map[string]bool{"/_s/pub/main/index.html": true, "/_s/pub/assets/up.html": true, "/_s/pub/main/pic.svg": false} {
		r, _ := h.get(live, path)
		if r.StatusCode != 200 || r.Header.Get("Content-Security-Policy") != "sandbox; default-src 'none'" ||
			(r.Header.Get("Content-Disposition") == "attachment") != download {
			t.Fatalf("live %s: %d %s, csp %q, disposition %q", path, r.StatusCode, r.Header.Get("Content-Type"),
				r.Header.Get("Content-Security-Policy"), r.Header.Get("Content-Disposition"))
		}
	}
	if r, _ := h.get(static, "/_s/pub/main/index.html"); r.StatusCode != 200 || r.Header.Get("Content-Security-Policy") != "" || r.Header.Get("Content-Disposition") != "" {
		t.Fatalf("static: %d csp %q", r.StatusCode, r.Header.Get("Content-Security-Policy"))
	}
}

// A guest who reads a private store through their own grant (a redeemed
// share link) gets responses no shared cache may keep.
func TestGuestGrantFilesNotPublic(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "priv"})
	h.call(admin, "files.push", map[string]any{"store": "priv", "files": files(map[string]string{
		"app.json": `{"title":"P","capabilities":{"db":{}}}`, "index.html": "<!doctype html><title>p</title>", "pic.png": "png"})})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/priv", "store": "priv"})
	l := h.call(admin, "link.new", map[string]any{"store": "priv", "level": "view", "days": 1}).(map[string]any)
	g := h.site(live)
	if st, _ := openView(g, live, "/priv", l["token"].(string)); st != 200 {
		t.Fatalf("redeem: %d", st)
	}
	for _, path := range []string{"/_s/priv/1/pic.png", "/_s/priv/main/pic.png"} {
		r, _ := g.do("GET", live, path, nil, nil)
		if r.StatusCode != 200 || r.Header.Get("Cache-Control") != cachePrivate {
			t.Fatalf("%s for a guest with a link grant: %d %q", path, r.StatusCode, r.Header.Get("Cache-Control"))
		}
	}
	// A store anyone may read stays publicly cacheable.
	h.call(admin, "grant.set", map[string]any{"store": "priv", "subject": "@guest", "level": "view"})
	if r, _ := g.do("GET", live, "/_s/priv/1/pic.png", nil, nil); r.Header.Get("Cache-Control") != cacheImmutable {
		t.Fatalf("public snapshot file: %q", r.Header.Get("Cache-Control"))
	}
}
