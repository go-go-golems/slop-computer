package host

// Tests from SLOP3-001 phase P3 (actors); formerly p3_test.go.

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

const trackerActor = `
const sql = use('sql'), db = use('db'), time = use('time'), stores = use('stores'), room = use('room');
defineActor({
  setup(ctx) {
    if (!sql.one('SELECT 1 AS x FROM tasks WHERE title = ?', 'welcome')) sql.run('INSERT INTO tasks (title, by, at) VALUES (?, ?, ?)', 'welcome', ctx.visitor.id, ctx.now);
  },
  actions: {
    add: { requires: 'interact', run(ctx, { title }) {
      const r = sql.run('INSERT INTO tasks (title, by, at) VALUES (?, ?, ?)', title, ctx.visitor.id, ctx.now);
      room.emit('changed', { id: r.lastRowid });
      return { id: r.lastRowid, by: ctx.visitor.id, audience: ctx.visitor.audience };
    } },
    async slow(ctx, { title }) {
      sql.run('INSERT INTO tasks (title, by, at) VALUES (?, ?, ?)', title + ' (draft)', ctx.visitor.id, ctx.now);
      const before = ctx.now;
      await time.sleep(30);
      sql.run('INSERT INTO tasks (title, by, at) VALUES (?, ?, ?)', title + ' (published)', ctx.visitor.id, ctx.now);
      return { later: ctx.now >= before };
    },
    async boom(ctx) {
      sql.run('INSERT INTO tasks (title, by, at) VALUES (?, ?, ?)', 'never', ctx.visitor.id, ctx.now);
      await Promise.resolve(1);
      ctx.fail('conflict', 'no thanks');
    },
    count() { return sql.one('SELECT count(*) AS n FROM tasks').n; },
    catalog(ctx) { return stores.open('catalog').docs.get('items/a').data(); },
    hijack() { sql.run('DELETE FROM _docs'); },
  },
  http: {
    'GET /feed.json': { level: 'public', run: (ctx, req) => ({ json: sql.all('SELECT title FROM tasks ORDER BY id') }) },
    'GET /tasks/:id': { run: (ctx, req) => ({ json: sql.one('SELECT title FROM tasks WHERE id = ?', Number(req.params.id)) }) },
    'GET /members': { audience: 'subscriber', run: () => ({ html: '<h1>hi</h1>' }) },
  },
  on: {
    'table:tasks'(ctx, commit) {
      const cur = db.doc('stats/tasks').get();
      db.doc('stats/tasks').set({ commits: (cur.exists ? cur.data().commits : 0) + 1, lastRev: commit.rev });
    },
  },
  every: {
    tick: { every: '1h', run(ctx) { const t = db.doc('stats/ticks').get(); db.doc('stats/ticks').set({ n: (t.exists ? t.data().n : 0) + 1 }); } },
  },
});
`

// The P3 exit test: an app with an actor, migrations, setup, actions that
// await I/O, HTTP routes, a reactor, an alarm, a read alias, and a broken
// version that leaves the store on the old one.
func TestActors(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	bob := h.tokenFor("bob@example.com")
	h.call(admin, "store.new", map[string]any{"id": "tracker"})
	h.push(admin, map[string]any{"store": "tracker", "files": files(map[string]string{
		"app.json":          `{"title":"Tracker","actor":"actor.js","type":"tracker","capabilities":{"db":{}},"slop":{"reads":{"catalog":{"type":"catalog"}}}}`,
		"actor.js":          trackerActor,
		"index.html":        "<!doctype html><title>t</title>",
		"sql/001_tasks.sql": "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, by TEXT, at INTEGER);",
	})})
	st := h.call(admin, "app.status", map[string]any{"store": "tracker"}).(map[string]any)
	if st["broken"] != "" || st["n"] != 1.0 {
		t.Fatalf("status = %v", st)
	}
	// A store that runs the app takes its declared type (SLOP3-026).
	if row := h.call(admin, "store.new", map[string]any{"id": "t2", "app": "tracker"}).(map[string]any); row["type"] != "tracker" {
		t.Fatalf("store.new --app type = %v", row)
	}
	if row := h.call(admin, "store.new", map[string]any{"id": "t3", "app": "tracker", "type": "other"}).(map[string]any); row["type"] != "other" {
		t.Fatalf("store.new --type = %v", row)
	}
	// --as a person: bob holds view on t2 through @member? He holds nothing yet.
	h.fail(admin, "actor.call", map[string]any{"store": "t2", "action": "add", "args": map[string]any{"title": "b"}, "as": "bob@example.com"}, "not_found")
	h.call(admin, "grant.set", map[string]any{"store": "t2", "subject": personID(t, h, "bob@example.com"), "level": "interact"})
	if g := h.call(admin, "actor.call", map[string]any{"store": "t2", "action": "add", "args": map[string]any{"title": "b"}, "as": "bob@example.com"}).(map[string]any); g["audience"] != "member" || !strings.HasPrefix(g["by"].(string), "usr_") {
		t.Fatalf("as bob = %v", g)
	}
	if b, _ := json.Marshal(h.call(admin, "log.show", map[string]any{"store": "t2"})); !strings.Contains(string(b), "as bob@example.com, by usr_") {
		t.Fatalf("log after --as bob does not name the admin: %s", b)
	}
	// --as anonymous succeeds with a guest grant (on t2, so tracker's counts hold).
	h.call(admin, "grant.set", map[string]any{"store": "t2", "subject": "@guest", "level": "interact"})
	if g := h.call(admin, "actor.call", map[string]any{"store": "t2", "action": "add", "args": map[string]any{"title": "g"}, "as": "anonymous"}).(map[string]any); g["audience"] != "guest" {
		t.Fatalf("as anonymous = %v", g)
	}
	// Policy belongs to the app: an instance is refused, naming it.
	if e := h.fail(admin, "policy.ls", map[string]any{"app": "t2"}, "invalid_argument"); !strings.Contains(e["message"].(string), "slop policy ls tracker") {
		t.Fatalf("policy.ls on an instance = %v", e)
	}
	// Migration and setup ran in activation.
	rows := h.call(admin, "sql.query", map[string]any{"store": "tracker", "sql": "SELECT title FROM tasks"}).([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["title"] != "welcome" {
		t.Fatalf("after activation: %v", rows)
	}

	// An action as the admin.
	out := h.call(admin, "actor.call", map[string]any{"store": "tracker", "action": "add", "args": map[string]any{"title": "one"}}).(map[string]any)
	if out["id"] != 2.0 || !strings.HasPrefix(out["by"].(string), "usr_") || out["audience"] != "admin" {
		t.Fatalf("add = %v", out)
	}
	// ctx.need: bob has no level at all, then view only.
	h.fail(bob, "actor.call", map[string]any{"store": "tracker", "action": "add", "args": map[string]any{"title": "x"}}, "not_found")
	h.call(admin, "grant.set", map[string]any{"store": "tracker", "subject": "@member", "level": "view"})
	e := h.fail(bob, "actor.call", map[string]any{"store": "tracker", "action": "add", "args": map[string]any{"title": "x"}}, "permission_denied")
	if !strings.Contains(e["message"].(string), "needs interact") {
		t.Fatalf("need = %v", e)
	}
	// --as anonymous: a signed-out visitor, admins only (round 3).
	h.fail(bob, "actor.call", map[string]any{"store": "tracker", "action": "add", "as": "anonymous"}, "permission_denied")
	h.fail(admin, "actor.call", map[string]any{"store": "tracker", "action": "add", "as": "@member"}, "invalid_argument")
	h.fail(admin, "actor.call", map[string]any{"store": "tracker", "action": "add", "as": "nobody@example.com"}, "not_found")
	// no level at all hides the action, as it hides it from bob above
	h.fail(admin, "actor.call", map[string]any{"store": "tracker", "action": "add", "args": map[string]any{"title": "x"}, "as": "anonymous"}, "not_found")
	h.call(admin, "grant.set", map[string]any{"store": "tracker", "subject": "@guest", "level": "view"})
	e = h.fail(admin, "actor.call", map[string]any{"store": "tracker", "action": "add", "args": map[string]any{"title": "x"}, "as": "anonymous"}, "permission_denied")
	if !strings.Contains(e["message"].(string), "needs interact") {
		t.Fatalf("as anonymous, guest view = %v", e)
	}
	h.call(admin, "grant.set", map[string]any{"store": "tracker", "subject": "@guest", "level": "interact"})
	h.call(admin, "grant.rm", map[string]any{"store": "tracker", "subject": "@guest"})
	// explain.can --action answers for the actor's actions (SLOP3-026):
	// add requires interact, slow declares nothing, so it needs admin; an
	// unknown name lists the actor's actions.
	ex := h.call(bob, "explain.can", map[string]any{"store": "tracker", "action": "add"}).(map[string]any)
	// --subject @member: any member with no grants of their own (round 5).
	if g := h.call(admin, "explain.can", map[string]any{"store": "tracker", "subject": "@member"}).(map[string]any); g["ok"] != true || g["audience"] != "member" || g["level"] != "view" {
		t.Fatalf("explain @member = %v", g)
	}
	h.fail(admin, "explain.can", map[string]any{"store": "tracker", "subject": "@subscriber"}, "invalid_argument")
	if g := h.call(admin, "explain.can", map[string]any{"store": "tracker", "subject": "@guest"}).(map[string]any); g["audience"] != "guest" {
		t.Fatalf("explain @guest = %v", g)
	}
	if ex["ok"] != false || ex["need"] != "interact" || ex["level"] != "view" {
		t.Fatalf("explain add = %v", ex)
	}
	ex = h.call(admin, "explain.can", map[string]any{"store": "tracker", "action": "slow"}).(map[string]any)
	if ex["ok"] != true || ex["need"] != "admin" || !strings.Contains(fmt.Sprint(ex["trace"]), "declares no requires") {
		t.Fatalf("explain slow = %v", ex)
	}
	e = h.fail(admin, "explain.can", map[string]any{"store": "tracker", "action": "nope"}, "invalid_argument")
	if !strings.Contains(e["message"].(string), "add, boom, catalog") {
		t.Fatalf("explain nope = %v", e)
	}

	// An await on real I/O ends the turn: two commits, the second later.
	logBefore := len(h.call(admin, "log.show", map[string]any{"store": "tracker", "after": 0, "limit": 1000}).([]any))
	out = h.call(admin, "actor.call", map[string]any{"store": "tracker", "action": "slow", "args": map[string]any{"title": "post"}}).(map[string]any)
	if out["later"] != true {
		t.Fatalf("slow = %v", out)
	}
	commits := h.call(admin, "log.show", map[string]any{"store": "tracker", "after": 0, "limit": 1000}).([]any)
	var slow []string
	for _, c := range commits[logBefore:] {
		m := c.(map[string]any)
		if strings.HasPrefix(m["via"].(string), "http") {
			slow = append(slow, m["summary"].(string))
		}
	}
	if len(slow) != 2 {
		t.Fatalf("slow made %d commits: %v", len(slow), slow)
	}
	// A throw after an await of something resolved rolls back that turn.
	h.fail(admin, "actor.call", map[string]any{"store": "tracker", "action": "boom"}, "conflict")
	if n := h.call(admin, "actor.call", map[string]any{"store": "tracker", "action": "count"}); n != 4.0 {
		t.Fatalf("count after boom = %v (want 4: welcome, one, draft, published)", n)
	}
	// Actors cannot write kernel tables.
	h.fail(admin, "actor.call", map[string]any{"store": "tracker", "action": "hijack"}, "actor_error")

	// The reactor followed table:tasks exactly once per commit.
	waitFor(t, "the reactor", func() bool {
		d, ok := h.call(admin, "docs.get", map[string]any{"store": "tracker", "path": "stats/tasks"}).(map[string]any)
		return ok && d["body"].(map[string]any)["commits"] == 3.0
	})

	// The alarm from every, fired by hand.
	alarms := h.call(admin, "alarm.ls", map[string]any{"store": "tracker"}).([]any)
	if len(alarms) != 1 || alarms[0].(map[string]any)["name"] != "tick" {
		t.Fatalf("alarms = %v", alarms)
	}
	h.call(admin, "alarm.fire", map[string]any{"store": "tracker", "name": "tick"})
	waitFor(t, "the alarm", func() bool {
		code, res := api(t, h, admin, "docs.get", map[string]any{"store": "tracker", "path": "stats/ticks"})
		return code == 200 && res["result"].(map[string]any)["body"].(map[string]any)["n"] == 1.0
	})

	// HTTP routes on a live mount: public, and level-checked.
	h.call(admin, "store.new", map[string]any{"id": "api"})
	h.push(admin, map[string]any{"store": "api", "files": files(map[string]string{
		"app.json": `{"title":"API","actor":"actor.js"}`,
		"actor.js": `defineActor({ http: { 'GET /hello/:name': { level: 'public', run: (ctx, req) => ({ json: { hi: req.params.name, q: req.query.x } }) },
		  'GET /secret': { run: () => ({ text: 'no' }) } } });`,
	})})
	h.call(admin, "mount.set", map[string]any{"host": h.cfg.Hosts.Live[0], "path": "/api", "store": "api"})
	r, body := h.get(h.cfg.Hosts.Live[0], "/api/hello/ana?x=1")
	if r.StatusCode != 200 || !strings.Contains(body, `"hi":"ana"`) || r.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("public route: %d %q", r.StatusCode, body)
	}
	if r, _ := h.get(h.cfg.Hosts.Live[0], "/api/secret"); r.StatusCode != 404 {
		t.Fatalf("level-checked route for nobody: %d", r.StatusCode)
	}

	// A read alias: the actor reads another store by a grant to store:tracker.
	h.call(admin, "store.new", map[string]any{"id": "cat", "type": "catalog"})
	h.call(admin, "docs.set", map[string]any{"store": "cat", "path": "items/a", "data": map[string]any{"name": "A"}})
	// docs ls without a collection names the store's collections (round 3).
	if e := h.fail(admin, "docs.ls", map[string]any{"store": "cat"}, "invalid_argument"); !strings.Contains(e["message"].(string), "items (1)") {
		t.Fatalf("docs.ls without coll = %v", e)
	}
	h.call(admin, "bind.set", map[string]any{"store": "tracker", "alias": "catalog", "target": "cat"})
	h.fail(admin, "actor.call", map[string]any{"store": "tracker", "action": "catalog"}, "permission_denied")
	h.call(admin, "grant.set", map[string]any{"store": "cat", "subject": "store:tracker", "level": "view"})
	if got := h.call(admin, "actor.call", map[string]any{"store": "tracker", "action": "catalog"}).(map[string]any); got["name"] != "A" {
		t.Fatalf("catalog = %v", got)
	}

	// A version whose migration fails leaves the store on the old one.
	h.commit(admin, map[string]any{"store": "tracker", "changes": files(map[string]string{
		"sql/002_bad.sql": "CREATE TABLE _nope (x);",
	})})
	st = h.call(admin, "app.status", map[string]any{"store": "tracker"}).(map[string]any)
	if st["n"] != 1.0 || !strings.Contains(st["broken"].(string), "002_bad") {
		t.Fatalf("broken status = %v", st)
	}
	// It names the failed snapshot and the one still served (SLOP3-026).
	if st["failedN"] != 2.0 || !strings.Contains(st["broken"].(string), "snapshot 2:") || !strings.Contains(st["broken"].(string), "still serves snapshot 1") {
		t.Fatalf("broken names no snapshots: %v", st)
	}
	if n := h.call(admin, "actor.call", map[string]any{"store": "tracker", "action": "count"}); n != 4.0 {
		t.Fatalf("old version still runs: %v", n)
	}
	// A good version activates.
	h.commit(admin, map[string]any{"store": "tracker", "changes": files(map[string]string{
		"sql/002_bad.sql": "ALTER TABLE tasks ADD COLUMN done INTEGER DEFAULT 0;",
	})})
	st = h.call(admin, "app.status", map[string]any{"store": "tracker"}).(map[string]any)
	if st["n"] != 3.0 || st["broken"] != "" {
		t.Fatalf("fixed status = %v", st)
	}
	rows = h.call(admin, "sql.query", map[string]any{"store": "tracker", "sql": "SELECT done FROM tasks LIMIT 1"}).([]any)
	if len(rows) != 1 {
		t.Fatalf("migration 002: %v", rows)
	}
	// Data stores of the app: each gets its own migrations and setup.
	h.call(admin, "store.new", map[string]any{"id": "tracker-2", "app": "tracker", "type": "tracker"})
	if n := h.call(admin, "actor.call", map[string]any{"store": "tracker-2", "action": "count"}); n != 1.0 {
		t.Fatalf("data store count = %v", n)
	}
	if logs := h.call(admin, "app.logs", map[string]any{"store": "tracker"}).(map[string]any); logs["lines"] == nil {
		t.Fatalf("app.logs = %v", logs)
	}
}

// Pages call actions with claude.use('slop').actions: RPC slop.call.
func TestPageCallsAction(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "votes"})
	h.push(admin, map[string]any{"store": "votes", "files": files(map[string]string{
		"app.json":   `{"title":"Votes","actor":"actor.js","capabilities":{"db":{}}}`,
		"actor.js":   `const db = use('db'); defineActor({ actions: { vote: { requires: 'interact', run(ctx, { pick }) { db.doc('votes/' + ctx.visitor.id.replace(/[^a-z0-9_]/gi, '')).set({ pick }); return { ok: true, guest: ctx.visitor.guest }; } } } });`,
		"index.html": "<!doctype html><title>v</title>",
	})})
	h.call(admin, "grant.set", map[string]any{"store": "votes", "subject": "@guest", "level": "interact"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/votes", "store": "votes"})
	g := h.site(live)
	_, v := g.do("POST", live, "/_site/views", map[string]any{"path": "/votes"}, nil)
	if caps := v["caps"].(map[string]any); caps["slop"] == nil {
		t.Fatalf("caps = %v", caps)
	}
	u := strings.TrimPrefix(strings.Split(v["url"].(string), "/v/")[0], "http://")
	_, out := g.do("POST", u, "/_rt/rpc", map[string]any{"method": "slop.call", "args": map[string]any{"action": "vote", "args": map[string]any{"pick": "red"}}},
		map[string]string{"Authorization": "Bearer " + v["secret"].(string)})
	res, _ := out["result"].(map[string]any)
	if res == nil || res["guest"] != true {
		t.Fatalf("slop.call = %v", out)
	}
	_, out = g.do("POST", u, "/_rt/rpc", map[string]any{"method": "slop.call", "args": map[string]any{"action": "nope"}},
		map[string]string{"Authorization": "Bearer " + v["secret"].(string)})
	if e, _ := out["error"].(map[string]any); e == nil || e["code"] != "not_found" {
		t.Fatalf("unknown action = %v", out)
	}
}

// A version whose activation fails leaves the store on the last good one,
// and pages keep opening on it.
func TestViewsOpenOnFallbackVersion(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "fb"})
	h.push(admin, map[string]any{"store": "fb", "files": files(map[string]string{
		"app.json": `{"title":"F","capabilities":{"db":{}}}`, "index.html": "<!doctype html><title>f</title>",
		"sql/001_ok.sql": "CREATE TABLE items (id INTEGER PRIMARY KEY);"})})
	h.call(admin, "grant.set", map[string]any{"store": "fb", "subject": "@guest", "level": "view"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/fb", "store": "fb"})
	g := h.site(live)
	if st, v := openView(g, live, "/fb", ""); st != 200 {
		t.Fatalf("first version: %d %v", st, v)
	}
	h.commit(admin, map[string]any{"store": "fb", "changes": files(map[string]string{"sql/002_bad.sql": "CREATE TABLE _nope (x);"})})
	if st := h.call(admin, "app.status", map[string]any{"store": "fb"}).(map[string]any); st["n"] != 1.0 || st["broken"] == "" {
		t.Fatalf("status after a bad version: %v", st)
	}
	if st, v := openView(g, live, "/fb", ""); st != 200 || v["version"] != 1.0 {
		t.Fatalf("view on the fallback version: %d %v", st, v)
	}
}

// A first version that fails to activate has nothing usable: its actor
// does not run against migrations that never ran, and status says why.
func TestNothingUsableAfterFirstActivationFails(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "nogo"})
	h.push(admin, map[string]any{"store": "nogo", "files": files(map[string]string{
		"app.json":        `{"title":"N","actor":"actor.js"}`,
		"actor.js":        `defineActor({ actions: { count(ctx) { return sql.query('SELECT count(*) AS n FROM items')[0].n; } } });`,
		"index.html":      "x",
		"sql/001_bad.sql": "CREATE TABLE _nope (x);",
	})})
	st := h.call(admin, "app.status", map[string]any{"store": "nogo"}).(map[string]any)
	if !strings.Contains(fmt.Sprint(st["broken"]), "001_bad") {
		t.Fatalf("status = %v", st)
	}
	e := h.fail(admin, "actor.call", map[string]any{"store": "nogo", "action": "count"}, "actor_error")
	if !strings.Contains(e["message"].(string), "broken") {
		t.Fatalf("actor.call on a never-activated version: %v", e)
	}
}

// alarm fire --at runs a job as if it were its time; alarm ls shows the next
// run in the schedule's zone and how the last run went (JS round, SLOP3-026).
func TestAlarmFireAtAndLastRun(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "digest"})
	h.push(admin, map[string]any{"store": "digest", "files": files(map[string]string{
		"app.json": `{"title":"Digest","actor":"actor.js","capabilities":{"db":{}}}`,
		"actor.js": `const db = use('db'); defineActor({ every: {
		  morning: { every: 'CRON_TZ=Europe/Berlin 0 7 * * *', run(ctx) { db.doc('m/last').set({ now: ctx.now, date: Date.now() }); } },
		  bad: { every: '1h', run() { throw new Error('boom'); } },
		} });`,
	})})
	var rows []any
	waitFor(t, "the alarms", func() bool {
		rows = h.call(admin, "alarm.ls", map[string]any{"store": "digest"}).([]any)
		return len(rows) == 2
	})
	var morning map[string]any
	for _, r := range rows {
		if r.(map[string]any)["name"] == "morning" {
			morning = r.(map[string]any)
		}
	}
	if morning == nil || morning["zone"] != "Europe/Berlin" || !strings.Contains(morning["next"].(string), " 07:00 ") || morning["last"] != nil {
		t.Fatalf("alarm ls morning = %v", morning)
	}
	// --at 07:00: the handler sees 07:00 Berlin; the answer says it worked.
	out := h.call(admin, "alarm.fire", map[string]any{"store": "digest", "name": "morning", "at": "07:00"}).(map[string]any)
	if out["status"] != "ok" || !strings.Contains(out["now"].(string), "T07:00:00+01:00") {
		t.Fatalf("alarm fire --at = %v", out)
	}
	d := h.call(admin, "docs.get", map[string]any{"store": "digest", "path": "m/last"}).(map[string]any)
	seen := time.UnixMilli(int64(d["body"].(map[string]any)["now"].(float64))).In(time.FixedZone("CET", 3600))
	if seen.Hour() != 7 || seen.Minute() != 0 {
		t.Fatalf("ctx.now = %v", seen)
	}
	if body := d["body"].(map[string]any); body["date"] != body["now"] {
		t.Fatalf("Date.now() %v != ctx.now %v", body["date"], body["now"])
	}
	// A failing handler: fire says so, and ls keeps the error.
	if out := h.call(admin, "alarm.fire", map[string]any{"store": "digest", "name": "bad"}).(map[string]any); out["status"] != "failed" || !strings.Contains(out["error"].(string), "boom") {
		t.Fatalf("alarm fire bad = %v", out)
	}
	for _, r := range h.call(admin, "alarm.ls", map[string]any{"store": "digest"}).([]any) {
		r := r.(map[string]any)
		switch r["name"] {
		case "morning":
			if r["lastOk"] != true || r["lastVia"] != "alarm fire" || !strings.Contains(fmt.Sprint(r["lastAsOf"]), " 07:00 ") {
				t.Fatalf("ls morning after fire = %v", r)
			}
		case "bad":
			if r["lastOk"] != false || !strings.Contains(fmt.Sprint(r["lastError"]), "boom") {
				t.Fatalf("ls bad after fire = %v", r)
			}
		}
	}
	h.fail(admin, "alarm.fire", map[string]any{"store": "digest", "name": "nope"}, "not_found")
	h.fail(admin, "alarm.fire", map[string]any{"store": "digest", "name": "morning", "at": "seven"}, "invalid_argument")
}

// A scheduled alarm whose handler throws is retried a minute later, not on
// every tick of the scheduler.
func TestFailingAlarmBacksOff(t *testing.T) {
	h := newHarness(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h.a.Start(ctx) // the scheduler (the harness serves without it)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "flaky"})
	h.push(admin, map[string]any{"store": "flaky", "files": files(map[string]string{
		"app.json": `{"title":"Flaky","actor":"actor.js","capabilities":{"db":{}}}`,
		"actor.js": `defineActor({ every: { bad: { every: '1s', run() { throw new Error('boom'); } } } });`,
	})})
	waitFor(t, "a failed run", func() bool {
		rows := h.call(admin, "alarm.ls", map[string]any{"store": "flaky"}).([]any)
		return len(rows) == 1 && rows[0].(map[string]any)["lastOk"] == false
	})
	time.Sleep(3 * time.Second)
	lines := h.call(admin, "app.logs", map[string]any{"store": "flaky"}).(map[string]any)["lines"].([]any)
	n := 0
	for _, l := range lines {
		if strings.Contains(fmt.Sprint(l), "alarm bad failed") {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("the failing alarm ran %d times in ~3 s, want 1", n)
	}
}

// Pointers for a store whose data is SQL and whose app has only actions
// (rounds js-2 and js-3).
func TestPointersForSQLAndActions(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "inv"})
	h.push(admin, map[string]any{"store": "inv", "files": files(map[string]string{
		"app.json":          `{"title":"Inv","actor":"actor.js","capabilities":{"db":{}}}`,
		"actor.js":          `const sql = use('sql'); defineActor({ actions: { add: { requires: 'admin', run(ctx, a) { sql.run('INSERT INTO items (name, qty) VALUES (?, ?)', a.name, a.qty); } }, list() { return sql.all('SELECT * FROM items'); } } });`,
		"sql/001_items.sql": "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER);",
	})})
	h.call(admin, "actor.call", map[string]any{"store": "inv", "action": "add", "args": map[string]any{"name": "bolts", "qty": 3}})
	if e := h.fail(admin, "docs.ls", map[string]any{"store": "inv"}, "invalid_argument"); !strings.Contains(e["message"].(string), "items (1 rows)") {
		t.Fatalf("docs ls without coll = %v", e)
	}
	out := h.call(admin, "app.verbs", map[string]any{"store": "inv"}).(map[string]any)
	if !strings.Contains(fmt.Sprint(out["note"]), "actions are add, list") {
		t.Fatalf("app verbs = %v", out)
	}
	if e := h.fail(admin, "actor.call", map[string]any{"store": "inv", "action": "add", "name": "x"}, "invalid_argument"); !strings.Contains(e["message"].(string), "--args") {
		t.Fatalf("actor call with the action's arguments = %v", e)
	}
	// store show: one answer for "what is this store?"
	show := h.call(admin, "store.show", map[string]any{"store": "inv"}).(map[string]any)
	if show["data"].(map[string]any)["tables"].(map[string]any)["items"] != 1.0 || fmt.Sprint(show["actions"]) != "[add list]" ||
		!strings.Contains(fmt.Sprint(show["app"].(map[string]any)["code"]), "slop pull inv") {
		t.Fatalf("store show = %v", show)
	}
	// store ls: a store that is its own app says so; app keeps its meaning.
	h.call(admin, "store.new", map[string]any{"id": "inv2", "app": "inv"})
	kinds := map[string]string{}
	for _, r := range h.call(admin, "store.ls", map[string]any{}).([]any) {
		r := r.(map[string]any)
		kinds[r["id"].(string)] = fmt.Sprint(r["kind"], " ", r["app"])
	}
	if kinds["inv"] != "app " || kinds["inv2"] != "instance inv" {
		t.Fatalf("store ls kinds = %v", kinds)
	}
	// app status --migrations names what the newest snapshot would still run.
	h.push(admin, map[string]any{"store": "inv", "files": files(map[string]string{
		"app.json":          `{"title":"Inv","actor":"actor.js","capabilities":{"db":{},"storage":{}}}`,
		"sql/001_items.sql": "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER);",
		"sql/002_more.sql":  "ALTER TABLE items ADD COLUMN shelf TEXT;",
		"actor.js":          `defineActor({ actions: { add() {}, list() {} } });`,
	})})
	st := h.call(admin, "app.status", map[string]any{"store": "inv", "migrations": true}).(map[string]any)
	if fmt.Sprint(st["pending"]) != "[sql/002_more.sql]" {
		t.Fatalf("pending migrations = %v", st)
	}
}
