package server

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

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

// B3 exit: static publishing. Publishing needs the app trusted with the
// workshop module and the visitor to be an admin of the static store; a
// live publication moves main, a draft only draft; the settings page and
// its forms work for the site's admins, same-origin only.
func TestBlocksSitePublish(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com", "read", "write")
	live, static := h.cfg.Hosts.Live[0], h.cfg.Hosts.Static[0]
	blocksWorkspace(t, h, admin, "ws-weft")
	installBlocksSite(t, h, admin)
	blocksSite(t, h, admin, "weft-site", "ws-weft")
	h.call(admin, "grant.set", map[string]any{"store": "weft-site", "subject": "@guest", "level": "view"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/pub/:id", "storeParam": "id", "type": "blocks-site"})
	h.call(admin, "mount.set", map[string]any{"host": static, "path": "/s/:id", "storeParam": "id", "type": "site"})
	h.call(admin, "store.new", map[string]any{"id": "weft-static", "type": "site"})
	h.call(admin, "grant.set", map[string]any{"store": "weft-static", "subject": "@guest", "level": "view"})
	call := func(token, action string, args map[string]any) any {
		return h.call(token, "actor.call", map[string]any{"store": "weft-site", "action": action, "args": args})
	}

	cfg := call(admin, "configure", map[string]any{"root": "weft", "to": "weft-static"})
	if fmtAny(cfg) != `{"root":"weft","to":"weft-static"}` {
		t.Fatalf("configure = %s", fmtAny(cfg))
	}
	h.fail(admin, "actor.call", map[string]any{"store": "weft-site", "action": "configure", "args": map[string]any{"root": "not a page"}}, "invalid_argument")
	h.fail(admin, "actor.call", map[string]any{"store": "weft-site", "action": "publish", "args": map[string]any{"live": true}}, "unavailable")
	h.call(admin, "app.trust", map[string]any{"app": "blocks-site", "module": "workshop"})

	// Live: the static host serves the pages, linked relatively.
	r := call(admin, "publish", map[string]any{"live": true}).(map[string]any)
	if r["to"] != "weft-static" || r["live"] != true || fmtAny(r["files"]) != "3" || fmtAny(r["pages"]) != "3" {
		t.Fatalf("publish = %v", r)
	}
	if res, body := h.get(static, "/s/weft-static/"); res.StatusCode != 200 || !strings.Contains(body, "Yarn for people who knit in public") || !strings.Contains(body, `href="care/"`) {
		t.Fatalf("static home = %d\n%s", res.StatusCode, body)
	}
	if res, _ := h.get(static, "/s/weft-static/care"); res.StatusCode != 308 || res.Header.Get("Location") != "/s/weft-static/care/" {
		t.Fatalf("static /care = %d → %q", res.StatusCode, res.Header.Get("Location"))
	}
	if _, body := h.get(static, "/s/weft-static/care/"); !strings.Contains(body, "Wash cold. Dry flat.") || !strings.Contains(body, `<a href="../">Weft</a>`) {
		t.Fatalf("static care:\n%s", body)
	}

	// An edit: the reader shows it at once, the static site only once published.
	h.call(admin, "docs.set", map[string]any{"store": "ws-weft", "path": "chunks/c-z-0", "data": map[string]any{
		"at": 1793600100000, "n": 1, "ops": []any{[]any{"z1", "uz:you", 900, `care.ui.1 is p "NEW CARE TIP"`, 1793600100000}}}})
	if _, body := h.get(live, "/pub/weft-site/care"); !strings.Contains(body, "NEW CARE TIP") {
		t.Fatal("the reader does not show the edit")
	}
	if _, body := h.get(static, "/s/weft-static/care/"); strings.Contains(body, "NEW CARE TIP") {
		t.Fatal("the static site changed without a publication")
	}
	d := call(admin, "publish", map[string]any{}).(map[string]any) // a draft
	if _, body := h.get(static, "/s/weft-static/care/"); strings.Contains(body, "NEW CARE TIP") {
		t.Fatal("a draft publication moved main")
	}
	if got := h.call(admin, "files.cat", map[string]any{"store": "weft-static", "at": "draft", "path": "care/index.html"}).(string); !strings.Contains(got, "NEW CARE TIP") {
		t.Fatalf("draft #%v lacks the edit", d["n"])
	}
	st := call(admin, "status", nil).(map[string]any)
	if pub := st["published"].(map[string]any); fmtAny(pub["n"]) != fmtAny(d["n"]) || pub["live"] != false || len(st["pages"].([]any)) != 3 {
		t.Fatalf("status = %s", fmtAny(st))
	}

	// Admin of the site is not enough: publishing writes the static store as the visitor.
	h.call(admin, "grant.set", map[string]any{"store": "weft-site", "subject": h.call(mia, "whoami", nil).(map[string]any)["id"], "level": "admin"})
	h.fail(mia, "actor.call", map[string]any{"store": "weft-site", "action": "publish", "args": map[string]any{"live": true}}, "permission_denied")
	h.fail(h.tokenFor("ned@example.com"), "actor.call", map[string]any{"store": "weft-site", "action": "configure", "args": map[string]any{"title": "x"}}, "permission_denied")

	// The settings page and its forms, signed in on the live host.
	ab := h.browser()
	ab.signIn("admin@example.com")
	as := h.site(live)
	signInSite(t, h, as, ab, live, "/pub/weft-site/")
	if res, body := as.page("GET", live, "/pub/weft-site/_site", "", nil); res.StatusCode != 200 || !strings.Contains(body, "Settings and publishing") ||
		!strings.Contains(body, "#"+fmtAny(d["n"])+" to <b>weft-static</b> (draft)") || strings.Contains(body, "Publishing is not set up") {
		t.Fatalf("settings page = %d\n%s", res.StatusCode, body)
	}
	if _, body := as.page("GET", live, "/pub/weft-site/care", "", nil); !strings.Contains(body, `<a href="/pub/weft-site/_site">Settings and publishing</a>`) {
		t.Fatal("an admin's page has no admin bar")
	}
	if res, _ := h.get(live, "/pub/weft-site/_site"); res.StatusCode == 200 {
		t.Fatal("a guest opened the settings page")
	}
	origin := map[string]string{"Origin": h.cfg.Origin(live), "Sec-Fetch-Site": "same-origin"}
	res, _ := as.page("POST", live, "/pub/weft-site/_publish", "to=weft-static&live=1", origin)
	if loc := res.Header.Get("Location"); res.StatusCode != 303 || !strings.Contains(loc, "/pub/weft-site/_site?m=published") || !strings.Contains(loc, "live=1") {
		t.Fatalf("publish form = %d → %q", res.StatusCode, loc)
	}
	if _, body := h.get(static, "/s/weft-static/care/"); !strings.Contains(body, "NEW CARE TIP") {
		t.Fatal("the publish form did not publish")
	}
	if _, body := as.page("GET", live, "/pub/weft-site/_site?m=published&n=9&live=1&to=weft-static", "", nil); !strings.Contains(body, "Published #9: weft-static serves it now.") {
		t.Fatal("no note after publishing")
	}
	if _, body := as.page("GET", live, "/pub/weft-site/_site?e=permission_denied&to=%3Cb%3E", "", nil); !strings.Contains(body, "You need to be an admin of the static store") || strings.Contains(body, "<b>e") {
		t.Fatal("the error note reflects the URL")
	}
	res, _ = as.page("POST", live, "/pub/weft-site/_site", "title=Weft+Yarns&root=weft&home=&to=weft-static", origin)
	if res.StatusCode != 303 || !strings.HasSuffix(res.Header.Get("Location"), "?m=saved") {
		t.Fatalf("settings form = %d → %q", res.StatusCode, res.Header.Get("Location"))
	}
	if _, body := h.get(live, "/pub/weft-site/"); !strings.Contains(body, `<a class="brand" href="/pub/weft-site/">Weft Yarns</a>`) {
		t.Fatal("the saved title is not shown")
	}
	// The same posts from another origin (an app's sandbox page) do not act as the person.
	for _, hdr := range []map[string]string{
		{"Origin": "http://x1.sbx.localhost", "Sec-Fetch-Site": "same-site"},
		{"Sec-Fetch-Site": "cross-site"},
	} {
		if res, _ := as.page("POST", live, "/pub/weft-site/_site", "title=Owned", hdr); res.StatusCode == 303 {
			t.Fatalf("a cross-origin form post (%v) was accepted", hdr)
		}
	}
	if fmtAny(call(admin, "status", nil).(map[string]any)["config"]) != `{"root":"weft","title":"Weft Yarns","to":"weft-static"}` {
		t.Fatal("the settings changed")
	}
}
