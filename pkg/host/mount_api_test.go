package host

// SLOP3-012 phase 3: a mount's API policy. The same app is mounted twice
// on a live host: /j without a policy (every route, as before) and /japi
// with one (an allowlist, floors, body and response rules).

import (
	"encoding/json"
	"strings"
	"testing"
)

const apiActor = `
const app = require('express').app();
app.get('/api/feed.json').public().handle((ctx, res) => res.json({ items: [1, 2] }));
app.get('/api/members').allow('view').handle((ctx, res) => res.json({ ok: true }));
app.post('/api/items').allow('view').handle((ctx, res) => res.status(201).json({ len: ctx.rawBody.length }));
app.get('/api/page').public().handle((ctx, res) => res.html('<h1>hi</h1>'));
app.get('/api/headers').public().handle((ctx, res) => {
  res.set('Set-Cookie', 'a=1').set('X-Custom', '1').set('ETag', '"e1"').set('Content-Security-Policy', "default-src *");
  res.json({});
});
app.get('/api/echo').public().handle((ctx, res) => res.json(ctx.request.headers));
app.get('/api/admin').public().handle((ctx, res) => res.json({ admin: true }));
app.get('/outside').public().handle((ctx, res) => res.send('actor outside'));
defineActor({});
`

func TestMountAPIPolicy(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "jr"})
	h.call(admin, "files.push", map[string]any{"store": "jr", "files": files(map[string]string{
		"app.json":   `{"title":"Journal","actor":"actor.js"}`,
		"actor.js":   apiActor,
		"index.html": "<!doctype html><title>journal page</title>",
	})})
	h.call(admin, "grant.set", map[string]any{"store": "jr", "subject": "@member", "level": "view"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/j", "store": "jr"})
	policy := func(extra map[string]any) map[string]any {
		p := map[string]any{
			"prefix": "/api",
			"routes": []any{"GET /api/feed.json", "GET /api/members", "POST /api/items", "GET /api/page", "GET /api/headers", "GET /api/echo"},
			"floors": []any{
				map[string]any{"route": "GET /api/feed.json", "min": "public"},
				map[string]any{"route": "GET /api/members", "audience": "subscriber"},
			},
			"maxBodyBytes":   10,
			"forwardHeaders": []any{"Accept", "X-Trace"},
		}
		for k, v := range extra {
			p[k] = v
		}
		return p
	}
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/japi", "store": "jr", "api": policy(nil)})

	bob, bs := h.browser(), h.site(live)
	bob.signIn("bob@example.com")
	signInSite(t, h, bs, bob, live, "/j")
	errCode := func(m map[string]any) string {
		e, _ := m["error"].(map[string]any)
		c, _ := e["code"].(string)
		return c
	}

	// The allowlist: a key it does not cover is never served there; the
	// mount without a policy still serves it.
	// (bob holds view, which the default floor needs: only the allowlist
	// keeps him out.)
	if r, out := bs.do("GET", live, "/japi/api/admin", nil, nil); r.StatusCode != 404 || errCode(out) != "not_found" {
		t.Fatalf("admin on the API mount: %d %v", r.StatusCode, out)
	}
	if r, body := h.get(live, "/j/api/admin"); r.StatusCode != 200 || !strings.Contains(body, "admin") {
		t.Fatalf("admin on the plain mount: %d %q", r.StatusCode, body)
	}
	// The prefix: other paths are not the actor's on the API mount.
	if r, body := h.get(live, "/japi/outside"); strings.Contains(body, "actor outside") {
		t.Fatalf("outside the prefix reached the actor: %d %q", r.StatusCode, body)
	}
	if _, body := h.get(live, "/j/outside"); body != "actor outside" {
		t.Fatalf("outside on the plain mount: %q", body)
	}

	// Floors: a public floor keeps feed.json public; the page, public in
	// the app, needs view here (the default floor); members needs a group.
	if r, _ := h.get(live, "/japi/api/feed.json"); r.StatusCode != 200 {
		t.Fatalf("feed for nobody: %d", r.StatusCode)
	}
	if r, _ := h.get(live, "/japi/api/page"); r.StatusCode != 404 {
		t.Fatalf("page for nobody on the API mount: %d", r.StatusCode)
	}
	if r, _ := h.get(live, "/j/api/page"); r.StatusCode != 200 {
		t.Fatalf("page for nobody on the plain mount: %d", r.StatusCode)
	}
	r, out := bs.do("GET", live, "/japi/api/members", nil, nil)
	if r.StatusCode != 403 || errCode(out) != "audience_required" {
		t.Fatalf("members for a member: %d %v", r.StatusCode, out)
	}

	// Response types: HTML is not among the defaults.
	if r, out := bs.do("GET", live, "/japi/api/page", nil, nil); r.StatusCode != 500 || errCode(out) != "response_type_not_allowed" {
		t.Fatalf("html on the API mount: %d %v", r.StatusCode, out)
	}
	// Response headers: only the allowlist leaves an API mount.
	r, _ = bs.do("GET", live, "/japi/api/headers", nil, nil)
	if r.Header.Get("Set-Cookie") != "" || r.Header.Get("X-Custom") != "" || r.Header.Get("Content-Security-Policy") == "default-src *" || r.Header.Get("Etag") != `"e1"` {
		t.Fatalf("API mount headers: %v", r.Header)
	}
	r, _ = bs.do("GET", live, "/j/api/headers", nil, nil)
	if r.Header.Get("X-Custom") != "1" {
		t.Fatalf("plain mount headers changed: %v", r.Header)
	}
	// Forwarded headers: the policy's list; never the cookie.
	r, out = bs.do("GET", live, "/japi/api/echo", nil, map[string]string{"X-Trace": "t1", "Accept": "application/json", "User-Agent": "test"})
	if r.StatusCode != 200 || out["x-trace"] != "t1" || out["accept"] != "application/json" || out["user-agent"] != nil || out["cookie"] != nil {
		t.Fatalf("forwarded headers: %d %v", r.StatusCode, out)
	}

	// Bodies: over the mount's limit is 413, not a truncated request.
	r, out = bs.do("POST", live, "/japi/api/items", "0123456789abc", nil)
	if r.StatusCode != 413 || errCode(out) != "payload_too_large" {
		t.Fatalf("large body: %d %v", r.StatusCode, out)
	}
	if r, out := bs.do("POST", live, "/japi/api/items", "ok", nil); r.StatusCode != 201 || out["len"] != 4.0 {
		t.Fatalf("small body: %d %v", r.StatusCode, out)
	}
	// Without a policy, the limit is 1 MiB, and it is refused, not cut.
	big := strings.Repeat("x", (1<<20)+10)
	if r, out := bs.do("POST", live, "/j/api/items", big, nil); r.StatusCode != 413 || errCode(out) != "payload_too_large" {
		t.Fatalf("1 MiB body on the plain mount: %d %v", r.StatusCode, out)
	}

	// mount.routes lists the routes as the mount serves them.
	routes := h.call(admin, "mount.routes", map[string]any{"host": live, "path": "/japi"}).([]any)
	byKey := map[string]map[string]any{}
	for _, x := range routes {
		m := x.(map[string]any)
		byKey[m["key"].(string)] = m
	}
	if byKey["GET /api/admin"]["allowed"] != false || byKey["GET /api/feed.json"]["effectiveLevel"] != "public" ||
		byKey["GET /api/page"]["effectiveLevel"] != "view" || byKey["GET /api/page"]["declaredLevel"] != "public" {
		t.Fatalf("mount.routes = %v", routes)
	}
	if aud := byKey["GET /api/members"]["audiences"].([]any); len(aud) != 1 || aud[0] != "subscriber" {
		t.Fatalf("members audiences = %v", aud)
	}

	// Allowing HTML sandboxes it; mount.undo brings the old policy back.
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/japi", "store": "jr", "api": policy(map[string]any{"responseTypes": []any{"application/json", "text/html"}})})
	r, _ = bs.do("GET", live, "/japi/api/page", nil, nil)
	if r.StatusCode != 200 || r.Header.Get("Content-Security-Policy") != "sandbox; default-src 'none'" {
		t.Fatalf("allowed html: %d %v", r.StatusCode, r.Header)
	}
	h.call(admin, "mount.undo", map[string]any{"host": live, "path": "/japi"})
	if r, _ := bs.do("GET", live, "/japi/api/page", nil, nil); r.StatusCode != 500 {
		t.Fatalf("html after undo: %d", r.StatusCode)
	}
	ms := h.call(admin, "mount.ls", map[string]any{"host": live}).([]any)
	for _, x := range ms {
		m := x.(map[string]any)["mount"].(map[string]any)
		if m["path"] == "/japi" {
			b, _ := json.Marshal(m["api"])
			if !strings.Contains(string(b), `"maxBodyBytes":10`) || strings.Contains(string(b), "text/html") {
				t.Fatalf("restored api = %s", b)
			}
		}
	}

	// A store served only by an API mount: a route outside its allowlist
	// breaks the actor visibly; widening the mount fixes it, no restart.
	h.call(admin, "store.new", map[string]any{"id": "solo"})
	h.call(admin, "files.push", map[string]any{"store": "solo", "files": files(map[string]string{
		"app.json": `{"title":"Solo","actor":"actor.js"}`,
		"actor.js": `const app = require('express').app();
app.get('/api/feed.json').public().handle((c, r) => r.json({ ok: 1 }));
app.get('/api/admin').public().handle((c, r) => r.json({ admin: 1 }));
defineActor({});`,
	})})
	narrow := map[string]any{"routes": []any{"GET /api/feed.json"}, "floors": []any{map[string]any{"route": "GET /api/*", "min": "public"}}}
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/solo", "store": "solo", "api": narrow})
	st := h.call(admin, "app.status", map[string]any{"store": "solo"}).(map[string]any)
	if b, _ := st["broken"].(string); !strings.Contains(b, "GET /api/admin is in no API allowlist") {
		t.Fatalf("narrow mount: status = %v", st)
	}
	if r, _ := h.get(live, "/solo/api/feed.json"); r.StatusCode == 200 {
		t.Fatalf("a broken actor answered: %d", r.StatusCode)
	}
	wide := map[string]any{"routes": []any{"GET /api/*"}, "floors": []any{map[string]any{"route": "GET /api/*", "min": "public"}}}
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/solo", "store": "solo", "api": wide})
	if st := h.call(admin, "app.status", map[string]any{"store": "solo"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("widened mount: status = %v", st)
	}
	if r, body := h.get(live, "/solo/api/admin"); r.StatusCode != 200 || !strings.Contains(body, "admin") {
		t.Fatalf("after widening: %d %q", r.StatusCode, body)
	}

	// mount.set refuses what a policy may not say.
	h.fail(admin, "mount.set", map[string]any{"host": live, "path": "/bad", "store": "jr", "api": policy(map[string]any{"forwardHeaders": []any{"Cookie"}})}, "invalid_argument")
	h.fail(admin, "mount.set", map[string]any{"host": live, "path": "/bad", "store": "jr", "api": map[string]any{"routes": []any{}}}, "invalid_argument")
	h.fail(admin, "mount.set", map[string]any{"host": live, "path": "/bad", "store": "jr", "api": map[string]any{"routes": []any{"GET /api/*"}, "middleware": []any{map[string]any{"name": "cors", "config": map[string]any{"origins": []any{"*"}}}}}}, "invalid_argument")
	h.fail(admin, "mount.set", map[string]any{"host": live, "path": "/bad", "store": "jr", "api": map[string]any{"routes": []any{"GET /api/*"}, "bogus": true}}, "invalid_argument")
}
