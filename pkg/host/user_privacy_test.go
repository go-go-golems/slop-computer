package host

// SLOP3-014: what an app learns about the person using it. A page learns
// the person's id only when its app.json declares the user capability, and
// their name only with the profile scope (the claude.ai contract); its
// actor always knows the id (apps key their data on it), and the name only
// with the profile scope. No session credential reaches the page.

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"
)

const whoActor = `defineActor({ actions: { who: { requires: 'view', run(ctx) { return ctx.visitor; } } } });`

// privacyApp pushes an app with the given capabilities and an actor that
// returns ctx.visitor; members may interact with it.
func privacyApp(t *testing.T, h *harness, admin, id, caps string) {
	t.Helper()
	h.call(admin, "store.new", map[string]any{"id": id})
	h.call(admin, "files.push", map[string]any{"store": id, "files": files(map[string]string{
		"app.json":   `{"title":"P","actor":"actor.js","capabilities":` + caps + `}`,
		"actor.js":   whoActor,
		"index.html": "<!doctype html><title>p</title>",
	})})
	h.call(admin, "grant.set", map[string]any{"store": id, "subject": "@member", "level": "interact"})
}

func TestAppSeesVisitorOnlyAsDeclared(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	cases := []struct {
		app, caps string
		id, name  bool // what the page may learn
	}{
		{"plain", `{"db":{}}`, false, false},
		{"ids", `{"user":{}}`, true, false},
		{"names", `{"user":{"scopes":["profile"]}}`, true, true},
	}
	for _, c := range cases {
		privacyApp(t, h, admin, c.app, c.caps)
		h.call(admin, "mount.set", map[string]any{"host": live, "path": "/" + c.app, "store": c.app})
	}
	b := h.browser()
	b.signIn("ivy.private@example.com") // local sign-in names the person "Test"
	s := h.site(live)
	signInSite(t, h, s, b, live, "/plain")
	ivy := personID(t, h, "ivy.private@example.com")
	var cookies []string
	for _, ck := range s.c.Jar.Cookies(&url.URL{Scheme: "http", Host: live, Path: "/"}) {
		cookies = append(cookies, ck.Value)
	}
	if len(cookies) == 0 {
		t.Fatal("no site session cookie")
	}

	for _, c := range cases {
		_, v := openView(s, live, "/"+c.app, "")
		hello := openStream(t, s, v).next(t, "hello", 2*time.Second)
		raw, _ := json.Marshal(hello)
		page := string(raw)
		if got := strings.Contains(page, ivy); got != c.id {
			t.Errorf("%s: the page learns the person's id = %v, want %v: %s", c.app, got, c.id, page)
		}
		named := strings.Contains(page, `"Test"`) || strings.Contains(page, "ivy.private")
		if named != c.name {
			t.Errorf("%s: the page learns the person's name = %v, want %v: %s", c.app, named, c.name, page)
		}
		// What every page keeps (design §10): the person's standing.
		vis, _ := hello["me"].(map[string]any)["visitor"].(map[string]any)
		if vis == nil || vis["audience"] != "member" || vis["level"] != "interact" || vis["guest"] != false {
			t.Errorf("%s: visitor = %v", c.app, vis)
		}
		// No session credential reaches the page: neither in the view the
		// shell receives (its secret is the view's own) nor in hello.
		vraw, _ := json.Marshal(v)
		for _, ck := range cookies {
			if strings.Contains(page, ck) || strings.Contains(string(vraw), ck) {
				t.Errorf("%s: the site session reaches the page", c.app)
			}
		}
	}

	// The actor: the id always (apps key their data on it), the name only
	// with the profile scope.
	tok := h.tokenFor("ivy.private@example.com")
	for _, c := range cases {
		got := h.call(tok, "actor.call", map[string]any{"store": c.app, "action": "who"}).(map[string]any)
		if got["id"] != ivy {
			t.Errorf("%s: ctx.visitor.id = %v, want %s", c.app, got["id"], ivy)
		}
		if name, _ := got["name"].(string); (name != "") != c.name {
			t.Errorf("%s: ctx.visitor.name = %q, want a name: %v", c.app, name, c.name)
		}
	}
}

// user.search may match a query against people's email addresses only when
// the app may see them: the email scope and the admin's user.email cell.
func TestUserSearchByEmailNeedsPolicy(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	privacyApp(t, h, admin, "people", `{"user":{"scopes":["profile","email"]}}`)
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/people", "store": "people"})
	b := h.browser()
	b.signIn("ivy.private@example.com")
	s := h.site(live)
	signInSite(t, h, s, b, live, "/people")
	h.call(admin, "grant.set", map[string]any{"store": "people", "subject": personID(t, h, "ivy.private@example.com"), "level": "interact"})

	search := func() []any {
		_, v := openView(s, live, "/people", "")
		out := rpc(s, v, "user.search", map[string]any{"q": "ivy.private@"})
		res, _ := out["result"].([]any)
		return res
	}
	// The query only matches the address, which the app may not see.
	if got := search(); len(got) != 0 {
		t.Fatalf("user.search matched an email the app may not see: %v", got)
	}
	h.call(admin, "policy.set", map[string]any{"app": "people", "capability": "user.email", "audience": "@member", "value": "on"})
	got := search()
	if len(got) != 1 || got[0].(map[string]any)["email"] != "ivy.private@example.com" {
		t.Fatalf("with the user.email policy on: %v", got)
	}
}
