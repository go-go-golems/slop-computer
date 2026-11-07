package host

// SLOP3-012 phase 2: use('express') / require('express'), go-go-goja's route
// builder compiled into the actor's route table, on a live mount without an
// API policy.

import (
	"encoding/json"
	"strings"
	"testing"
)

const expressActor = `
const app = require('express').app(), db = require('database'), time = use('time');
app.use((ctx, res, next) => { res.set('X-Mw', 'ran'); return next(); });
app.get('/hello/:name').public().handle((ctx, res) => res.json({ hi: ctx.params.name, q: ctx.query.x, m: ctx.request.method, v: ctx.visitor.level }));
app.get('/members').allow('interact').handle((ctx, res) => res.send('for interact'));
app.post('/items').allow('interact').handle((ctx, res) => {
  const r = db.exec('INSERT INTO items (title) VALUES (?)', ctx.body.title);
  res.status(201).json({ id: r.lastInsertId });
});
app.get('/go').public().handle((ctx, res) => res.redirect(303, '/x/hello/there'));
app.get('/later').public().handle(async (ctx, res) => { await time.sleep(1); res.send('later'); });
app.get('/twice').public().handle((ctx, res) => { res.send('a'); res.send('b'); });
app.get('/object').public().handle(() => ({ x: 1 }));
app.get('/string').public().handle(() => 'just text');
app.get('/nothing').public().handle(() => {});
app.get('/cookies').public().handle((ctx, res) => res.json(ctx.cookies));
app.get('/static').public().handle(() => { app.static('/files', '/etc'); });
app.get('/listen').public().handle(() => { app.listen(); });
app.get('/auth').public().handle(() => { app.get('/y').auth('session'); });
defineActor({
  http: { 'GET /plain': { level: 'public', run: () => ({ text: 'plain' }) } },
  actions: {
    late() { app.get('/sneaky').public().handle((ctx, res) => res.send('x')); },
    count() { return db.query('SELECT count(*) AS n FROM items')[0].n; },
  },
});
`

func TestExpressModule(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "ex"})
	h.call(admin, "files.push", map[string]any{"store": "ex", "files": files(map[string]string{
		"app.json":          `{"title":"Express","actor":"actor.js"}`,
		"actor.js":          expressActor,
		"sql/001_items.sql": "CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT NOT NULL);",
	})})
	if st := h.call(admin, "app.status", map[string]any{"store": "ex"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("status = %v", st)
	}
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/x", "store": "ex"})

	errCode := func(body string) string {
		var m map[string]map[string]string
		_ = json.Unmarshal([]byte(body), &m)
		return m["error"]["code"]
	}

	// A public route, with the app.use chain, params, query and the envelope.
	r, body := h.get(live, "/x/hello/ana?x=1")
	if r.StatusCode != 200 || r.Header.Get("X-Mw") != "ran" || !strings.Contains(body, `"hi":"ana"`) || !strings.Contains(body, `"q":"1"`) || !strings.Contains(body, `"m":"GET"`) {
		t.Fatalf("hello: %d %v %q", r.StatusCode, r.Header, body)
	}
	// http: routes and builder routes are one table.
	if r, body := h.get(live, "/x/plain"); r.StatusCode != 200 || body != "plain" {
		t.Fatalf("plain: %d %q", r.StatusCode, body)
	}
	// .allow(level): 404 for nobody, 403 for a viewer.
	if r, _ := h.get(live, "/x/members"); r.StatusCode != 404 {
		t.Fatalf("members for nobody: %d", r.StatusCode)
	}
	bob, bs := h.browser(), h.site(live)
	bob.signIn("bob@example.com")
	signInSite(t, h, bs, bob, live, "/x")
	h.call(admin, "grant.set", map[string]any{"store": "ex", "subject": "@member", "level": "view"})
	if r, _ := bs.do("GET", live, "/x/members", nil, nil); r.StatusCode != 403 {
		t.Fatalf("members for a viewer: %d", r.StatusCode)
	}
	if r, _ := bs.do("POST", live, "/x/items", map[string]any{"title": "no"}, nil); r.StatusCode != 403 {
		t.Fatalf("POST for a viewer: %d", r.StatusCode)
	}
	// status(201).json, with a JSON body, for an interact visitor.
	h.call(admin, "grant.set", map[string]any{"store": "ex", "subject": "@member", "level": "interact"})
	r, out := bs.do("POST", live, "/x/items", map[string]any{"title": "one"}, nil)
	if r.StatusCode != 201 || out["id"] != 1.0 {
		t.Fatalf("POST items: %d %v", r.StatusCode, out)
	}
	if n := h.call(admin, "actor.call", map[string]any{"store": "ex", "action": "count"}); n != 1.0 {
		t.Fatalf("count = %v", n)
	}

	// redirect, an async handler, a returned string.
	if r, _ := h.get(live, "/x/go"); r.StatusCode != 303 || r.Header.Get("Location") != "/x/hello/there" {
		t.Fatalf("redirect: %d %q", r.StatusCode, r.Header.Get("Location"))
	}
	if r, body := h.get(live, "/x/later"); r.StatusCode != 200 || body != "later" {
		t.Fatalf("async: %d %q", r.StatusCode, body)
	}
	if r, body := h.get(live, "/x/string"); r.StatusCode != 200 || body != "just text" || !strings.HasPrefix(r.Header.Get("Content-Type"), "text/plain") {
		t.Fatalf("string: %d %q %q", r.StatusCode, body, r.Header.Get("Content-Type"))
	}

	// What slop does not do fails loudly, with a code.
	for path, code := range map[string]string{
		"/x/twice":   "invalid_state",
		"/x/nothing": "invalid_state",
		"/x/object":  "not_supported",
		"/x/cookies": "not_supported",
		"/x/static":  "not_supported",
		"/x/listen":  "not_supported",
		"/x/auth":    "not_supported",
	} {
		if r, body := h.get(live, path); r.StatusCode != 500 || errCode(body) != code {
			t.Errorf("%s: %d %q, want %s", path, r.StatusCode, body, code)
		}
	}
	// Routes register only while actor.js loads.
	h.fail(admin, "actor.call", map[string]any{"store": "ex", "action": "late"}, "invalid_state")

	// Load-time errors break the actor, and app.status says why.
	for name, src := range map[string]string{
		"twice":   `const app = require('express').app(); app.get('/a').public().handle((c, r) => r.end()); defineActor({ http: { 'GET /a': { level: 'public', run: () => ({ text: 'a' }) } } });`,
		"level":   `require('express').app().get('/a').allow('superuser').handle((c, r) => r.end()); defineActor({});`,
		"pattern": `require('express').app().get('a/*/b').public().handle((c, r) => r.end()); defineActor({});`,
		"group":   `require('express').app().get('/a').public().audience('vip').handle((c, r) => r.end()); defineActor({});`,
	} {
		id := "bad" + name
		h.call(admin, "store.new", map[string]any{"id": id})
		h.call(admin, "files.push", map[string]any{"store": id, "files": files(map[string]string{
			"app.json": `{"title":"Bad","actor":"actor.js"}`,
			"actor.js": src,
		})})
		st := h.call(admin, "app.status", map[string]any{"store": id}).(map[string]any)
		if b, _ := st["broken"].(string); b == "" {
			t.Errorf("%s: not broken: %v", name, st)
		} else {
			t.Logf("%s: %s", name, b)
		}
	}
}
