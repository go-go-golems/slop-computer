package server

// Tests from SLOP3-001 phase P3 (the example apps); formerly p3_examples_test.go.

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// P3 exit: apps/examples/journal works — drafts per person through a view that
// uses slop_principal(), publishing, a publish across an await, the feed
// route, the stats reactor, and a missed alarm that fires once, late.
func TestJournalExample(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	bob := h.tokenFor("bob@example.com")
	h.call(admin, "store.new", map[string]any{"id": "journal"})
	h.call(admin, "files.push", map[string]any{"store": "journal", "files": exampleFiles(t, "journal")})
	if st := h.call(admin, "app.status", map[string]any{"store": "journal"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("status = %v", st)
	}
	h.call(admin, "grant.set", map[string]any{"store": "journal", "subject": "@member", "level": "interact"})

	a := h.call(admin, "actor.call", map[string]any{"store": "journal", "action": "draft", "args": map[string]any{"title": "Hello", "body": "one two three"}}).(map[string]any)
	h.call(bob, "actor.call", map[string]any{"store": "journal", "action": "draft", "args": map[string]any{"title": "Bob's"}})
	// my_drafts filters by slop_principal(): each sees only their own.
	if d := h.call(bob, "actor.call", map[string]any{"store": "journal", "action": "drafts"}).([]any); len(d) != 1 || d[0].(map[string]any)["title"] != "Bob's" {
		t.Fatalf("bob's drafts = %v", d)
	}
	// Bob may not publish the admin's draft.
	h.fail(bob, "actor.call", map[string]any{"store": "journal", "action": "publish", "args": map[string]any{"id": a["id"]}}, "permission_denied")
	h.call(admin, "actor.call", map[string]any{"store": "journal", "action": "publish", "args": map[string]any{"id": a["id"]}})
	bd := h.call(bob, "actor.call", map[string]any{"store": "journal", "action": "drafts"}).([]any)
	out := h.call(bob, "actor.call", map[string]any{"store": "journal", "action": "slowPublish",
		"args": map[string]any{"id": bd[0].(map[string]any)["id"], "delayMs": 20}}).(map[string]any)
	if out["ok"] != true {
		t.Fatalf("slowPublish = %v", out)
	}
	posts := h.call(bob, "actor.call", map[string]any{"store": "journal", "action": "posts"}).([]any)
	if len(posts) != 2 || posts[0].(map[string]any)["title"] != "Bob's" {
		t.Fatalf("posts = %v", posts)
	}
	waitFor(t, "stats", func() bool {
		s := docBody(h, admin, "journal", "stats/main")
		return s != nil && s["published"] == 2.0 && s["drafts"] == 0.0 && s["words"] == 3.0
	})

	// The feed route is public: it answers on the live host without a session.
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/journal", "store": "journal"})
	r, body := h.get(live, "/journal/feed.json")
	if r.StatusCode != 200 || !strings.Contains(body, `"title":"Hello"`) {
		t.Fatalf("feed: %d %s", r.StatusCode, body)
	}

	// An alarm missed while the server was down: due three hours ago.
	ctx := context.Background()
	st, err := h.k.Store(ctx, "journal")
	if err != nil {
		t.Fatal(err)
	}
	missed := time.Now().Add(-3 * time.Hour).UnixMilli()
	if _, err := st.Do(ctx, store.Who{ID: "system", Via: "test"}, func(tt *store.Turn) error {
		_, err := tt.Exec(store.CallerKernel, `UPDATE _alarms SET at = ? WHERE name = 'digest'`, missed)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := h.k.Registry.SetSchedule(ctx, "journal", missed); err != nil {
		t.Fatal(err)
	}
	due, _ := h.k.Registry.DueSchedules(ctx, time.Now().UnixMilli())
	for _, id := range due {
		_ = h.a.Fire(ctx, id, "") // what the scheduler's tick does
	}
	var digests []any
	waitFor(t, "the digest", func() bool {
		digests = h.call(admin, "docs.ls", map[string]any{"store": "journal", "coll": "digests"}).([]any)
		return len(digests) > 0
	})
	time.Sleep(100 * time.Millisecond)
	digests = h.call(admin, "docs.ls", map[string]any{"store": "journal", "coll": "digests"}).([]any)
	if len(digests) != 1 || digests[0].(map[string]any)["body"].(map[string]any)["late"] != true {
		t.Fatalf("digests = %v", digests)
	}
	alarms := h.call(admin, "alarm.ls", map[string]any{"store": "journal"}).([]any)
	if at := alarms[0].(map[string]any)["at"].(float64); int64(at) <= time.Now().UnixMilli() {
		t.Fatalf("digest not rescheduled: %v", alarms)
	}

	// A version whose smoke check throws keeps the old version.
	broken := exampleFiles(t, "journal")
	for _, f := range broken {
		m := f.(map[string]any)
		if m["path"] == "actor.js" {
			m["text"] = strings.Replace(m["text"].(string), "sql.one('SELECT count(*) AS n FROM published_posts');", "throw new Error('smoke says no');", 1)
		}
	}
	h.call(admin, "files.push", map[string]any{"store": "journal", "files": broken})
	s := h.call(admin, "app.status", map[string]any{"store": "journal"}).(map[string]any)
	if s["n"] != 1.0 || !strings.Contains(s["broken"].(string), "smoke says no") {
		t.Fatalf("after a failing smoke: %v", s)
	}
	if p := h.call(bob, "actor.call", map[string]any{"store": "journal", "action": "posts"}).([]any); len(p) != 2 {
		t.Fatalf("old version stopped serving: %v", p)
	}
}

// P3 exit: a reactor whose turn fails leaves nothing applied, and the next
// delivery applies each commit exactly once.
func TestReactorExactlyOnce(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "counter"})
	h.call(admin, "files.push", map[string]any{"store": "counter", "files": files(map[string]string{
		"app.json": `{"title":"Counter","actor":"actor.js"}`,
		"actor.js": `const db = use('db');
defineActor({ on: { 'doc:items/*'(ctx, commit) {
  if (db.doc('flags/fail').get().exists) throw new Error('reactor crashed');
  const c = db.doc('stats/seen').get();
  db.doc('stats/seen').set({ n: (c.exists ? c.data().n : 0) + 1 });
  db.doc('seen/r' + commit.rev).set({ rev: commit.rev });
} } });`,
	})})
	h.call(admin, "docs.set", map[string]any{"store": "counter", "path": "flags/fail", "data": map[string]any{}})
	for i := 0; i < 3; i++ {
		h.call(admin, "docs.set", map[string]any{"store": "counter", "path": "items/i" + string(rune('0'+i)), "data": map[string]any{"i": i}})
	}
	time.Sleep(150 * time.Millisecond)
	if b := docBody(h, admin, "counter", "stats/seen"); b != nil {
		t.Fatalf("a failing reactor applied writes: %v", b)
	}
	if logs := h.call(admin, "app.logs", map[string]any{"store": "counter"}).(map[string]any); !strings.Contains(strings.ToLower(fmtAny(logs)), "reactor crashed") {
		t.Fatalf("logs = %v", logs)
	}
	h.call(admin, "docs.rm", map[string]any{"store": "counter", "path": "flags/fail"})
	h.call(admin, "docs.set", map[string]any{"store": "counter", "path": "items/i3", "data": map[string]any{"i": 3}})
	waitFor(t, "the reactor", func() bool {
		b := docBody(h, admin, "counter", "stats/seen")
		return b != nil && b["n"] == 4.0
	})
	time.Sleep(100 * time.Millisecond)
	if b := docBody(h, admin, "counter", "stats/seen"); b["n"] != 4.0 {
		t.Fatalf("delivered more than once: %v", b)
	}
	if seen := h.call(admin, "docs.ls", map[string]any{"store": "counter", "coll": "seen"}).([]any); len(seen) != 4 {
		t.Fatalf("seen = %v", seen)
	}
}

// P3 exit: apps/examples/guestbook — a guest signs through the page.
func TestGuestbookExample(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "guestbook"})
	h.call(admin, "files.push", map[string]any{"store": "guestbook", "files": exampleFiles(t, "guestbook")})
	h.call(admin, "store.new", map[string]any{"id": "guestbook-main", "app": "guestbook", "type": "guestbook"})
	h.call(admin, "grant.set", map[string]any{"store": "guestbook-main", "subject": "@guest", "level": "interact"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/guestbook", "store": "guestbook-main"})
	g := h.site(live)
	_, v := g.do("POST", live, "/_site/views", map[string]any{"path": "/guestbook"}, nil)
	u := strings.TrimPrefix(strings.Split(v["url"].(string), "/v/")[0], "http://")
	auth := map[string]string{"Authorization": "Bearer " + v["secret"].(string)}
	_, out := g.do("POST", u, "/_rt/rpc", map[string]any{"method": "slop.call", "args": map[string]any{"action": "sign", "args": map[string]any{"text": "  hello from a guest  "}}}, auth)
	res, _ := out["result"].(map[string]any)
	if res == nil {
		t.Fatalf("sign = %v", out)
	}
	e := docBody(h, admin, "guestbook-main", "entries/"+res["id"].(string))
	if e["text"] != "hello from a guest" || e["guest"] != true {
		t.Fatalf("entry = %v", e)
	}
	_, out = g.do("POST", u, "/_rt/rpc", map[string]any{"method": "slop.call", "args": map[string]any{"action": "sign", "args": map[string]any{"text": "   "}}}, auth)
	if er, _ := out["error"].(map[string]any); er == nil || er["code"] != "invalid_argument" {
		t.Fatalf("empty sign = %v", out)
	}
	// No sample before P6's policy: reply is denied.
	_, out = g.do("POST", u, "/_rt/rpc", map[string]any{"method": "slop.call", "args": map[string]any{"action": "reply", "args": map[string]any{"id": res["id"]}}}, auth)
	if er, _ := out["error"].(map[string]any); er == nil || er["code"] != "permission_denied" {
		t.Fatalf("reply = %v", out)
	}
}

func fmtAny(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
