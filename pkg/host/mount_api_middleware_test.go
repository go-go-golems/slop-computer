package host

// SLOP3-012 phase 4: the host middleware chain of an API mount, which runs
// before the actor is built.

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

const middlewareActor = `
const app = require('express').app(), db = require('database');
app.get('/api/hit').public().handle((ctx, res) => {
  db.exec('INSERT INTO hits (at) VALUES (?)', ctx.now);
  res.json({ who: ctx.visitor.id || null, level: ctx.visitor.level });
});
app.post('/api/items').allow('view').handle((ctx, res) => res.status(201).json({ ok: true }));
defineActor({ actions: { hits() { return db.query('SELECT count(*) AS n FROM hits')[0].n; } } });
`

// raw sends a request on a host and returns the response with its body read.
func (h *harness) raw(method, host, path string, body io.Reader, hdr map[string]string) (*http.Response, string) {
	h.t.Helper()
	req, _ := http.NewRequest(method, h.ts.URL+path, body)
	req.Host = host
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(b)
}

func TestMountAPIMiddleware(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	bobToken := h.tokenFor("bob@example.com")
	annToken := h.tokenFor("ann@example.com")
	readToken := h.tokenFor("rita@example.com", "read")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "mw"})
	h.call(admin, "files.push", map[string]any{"store": "mw", "files": files(map[string]string{
		"app.json":         `{"title":"MW","actor":"actor.js"}`,
		"actor.js":         middlewareActor,
		"sql/001_hits.sql": "CREATE TABLE hits (id INTEGER PRIMARY KEY, at INTEGER);",
	})})
	h.call(admin, "grant.set", map[string]any{"store": "mw", "subject": "@member", "level": "view"})
	floors := []any{map[string]any{"route": "GET /api/hit", "min": "public"}}
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/mw", "store": "mw", "api": map[string]any{
		"routes": []any{"GET /api/*", "POST /api/items"}, "floors": floors, "maxBodyBytes": 16,
		"middleware": []any{
			map[string]any{"name": "rateLimit", "config": map[string]any{"per": "ip", "limit": 2, "window": "1h"}},
			map[string]any{"name": "cors", "config": map[string]any{"origins": []any{"https://client.example"}}},
			map[string]any{"name": "apiToken", "config": map[string]any{}},
		},
	}})
	hits := func() float64 {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "mw", "action": "hits"}).(float64)
	}

	// rateLimit per ip: the third request is refused before the turn.
	for i := 0; i < 2; i++ {
		if r, body := h.raw("GET", live, "/mw/api/hit", nil, nil); r.StatusCode != 200 {
			t.Fatalf("hit %d: %d %q", i, r.StatusCode, body)
		}
	}
	r, body := h.raw("GET", live, "/mw/api/hit", nil, nil)
	if r.StatusCode != 429 || r.Header.Get("Retry-After") == "" || !strings.Contains(body, "rate_limited") {
		t.Fatalf("third hit: %d %v %q", r.StatusCode, r.Header, body)
	}
	if n := hits(); n != 2 {
		t.Fatalf("hits = %v: the refused request ran", n)
	}

	// A fresh mount for the other steps (rate limits are per mount).
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/mw2", "store": "mw", "api": map[string]any{
		"routes": []any{"GET /api/*", "POST /api/items"}, "floors": floors, "maxBodyBytes": 16,
		"middleware": []any{
			map[string]any{"name": "cors", "config": map[string]any{"origins": []any{"https://client.example"}}},
			map[string]any{"name": "apiToken", "config": map[string]any{}},
			map[string]any{"name": "rateLimit", "config": map[string]any{"per": "visitor", "limit": 1, "window": "1h"}},
		},
	}})

	// Refused requests never build the actor.
	h.a.Restart("mw")
	if h.a.Running("mw") != nil {
		t.Fatal("restart left an actor")
	}
	// cors: a preflight from an allowed origin is answered here.
	r, _ = h.raw("OPTIONS", live, "/mw2/api/items", nil, map[string]string{"Origin": "https://client.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
	if r.StatusCode != 204 || r.Header.Get("Access-Control-Allow-Origin") != "https://client.example" || !strings.Contains(r.Header.Get("Access-Control-Allow-Methods"), "POST") ||
		r.Header.Get("Access-Control-Allow-Credentials") != "" {
		t.Fatalf("preflight: %d %v", r.StatusCode, r.Header)
	}
	if r, _ := h.raw("OPTIONS", live, "/mw2/api/items", nil, map[string]string{"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}); r.StatusCode != 403 {
		t.Fatalf("preflight from another origin: %d", r.StatusCode)
	}
	// methods: no allowed route takes DELETE.
	if r, _ := h.raw("DELETE", live, "/mw2/api/items", nil, nil); r.StatusCode != 405 || !strings.Contains(r.Header.Get("Allow"), "POST") {
		t.Fatalf("DELETE: %d %v", r.StatusCode, r.Header)
	}
	// maxBody: a declared body over the limit.
	if r, _ := h.raw("POST", live, "/mw2/api/items", strings.NewReader(strings.Repeat("x", 40)), map[string]string{"Content-Type": "application/json"}); r.StatusCode != 413 {
		t.Fatalf("big body: %d", r.StatusCode)
	}
	// apiToken: a token that does not resolve.
	r, _ = h.raw("GET", live, "/mw2/api/hit", nil, map[string]string{"Authorization": "Bearer nope"})
	if r.StatusCode != 401 || !strings.HasPrefix(r.Header.Get("WWW-Authenticate"), "Bearer") {
		t.Fatalf("bad token: %d %v", r.StatusCode, r.Header)
	}
	if h.a.Running("mw") != nil {
		t.Fatal("a refused request built the actor")
	}

	// apiToken: a token acts as its person, from another origin too.
	r, body = h.raw("POST", live, "/mw2/api/items", strings.NewReader(`{}`), map[string]string{"Authorization": "Bearer " + bobToken, "Origin": "https://client.example", "Content-Type": "application/json"})
	if r.StatusCode != 201 || r.Header.Get("Access-Control-Allow-Origin") != "https://client.example" {
		t.Fatalf("POST with a token from an allowed origin: %d %v %q", r.StatusCode, r.Header, body)
	}
	// A read token makes safe requests only.
	if r, body := h.raw("POST", live, "/mw2/api/items", strings.NewReader(`{}`), map[string]string{"Authorization": "Bearer " + readToken, "Content-Type": "application/json"}); r.StatusCode != 403 || !strings.Contains(body, "insufficient_scope") {
		t.Fatalf("POST with a read token: %d %q", r.StatusCode, body)
	}
	// rateLimit per visitor (limit 1): bob is out, ann is not.
	if r, _ := h.raw("GET", live, "/mw2/api/hit", nil, map[string]string{"Authorization": "Bearer " + bobToken}); r.StatusCode != 429 {
		t.Fatalf("bob's second request: %d", r.StatusCode)
	}
	r, body = h.raw("GET", live, "/mw2/api/hit", nil, map[string]string{"Authorization": "Bearer " + annToken})
	if r.StatusCode != 200 || !strings.Contains(body, `"level":"view"`) || !strings.Contains(body, `"who":"usr_`) {
		t.Fatalf("ann: %d %q", r.StatusCode, body)
	}
	// Without apiToken, Authorization means nothing on a live host.
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/mw3", "store": "mw", "api": map[string]any{"routes": []any{"POST /api/items"}}})
	if r, _ := h.raw("POST", live, "/mw3/api/items", strings.NewReader(`{}`), map[string]string{"Authorization": "Bearer " + bobToken, "Content-Type": "application/json"}); r.StatusCode != 404 {
		t.Fatalf("token without apiToken: %d", r.StatusCode)
	}
	// required: no token is 401.
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/mw4", "store": "mw", "api": map[string]any{"routes": []any{"GET /api/*"}, "floors": floors,
		"middleware": []any{map[string]any{"name": "apiToken", "config": map[string]any{"required": true}}}}})
	if r, _ := h.raw("GET", live, "/mw4/api/hit", nil, nil); r.StatusCode != 401 {
		t.Fatalf("required token missing: %d", r.StatusCode)
	}
	if r, _ := h.raw("GET", live, "/mw4/api/hit", nil, map[string]string{"Authorization": "Bearer " + annToken}); r.StatusCode != 200 {
		t.Fatalf("required token given: %d", r.StatusCode)
	}
}
