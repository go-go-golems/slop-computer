package server

// SLOP3-007, the authority core: exit tests written before the code they
// test (phase 0). Each is skipped until its phase lands and fails on the
// code before that phase.

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

// personID is the id of the person with this email.
func personID(t *testing.T, h *harness, email string) string {
	t.Helper()
	p, err := h.sys.PersonByEmail(context.Background(), email)
	if err != nil {
		t.Fatal(err)
	}
	return p.ID
}

// llmAllowed is what a person's llm.usage says about their model access.
func llmAllowed(t *testing.T, h *harness, tok string) map[string]any {
	t.Helper()
	return h.call(tok, "llm.usage", map[string]any{}).(map[string]any)["llm"].(map[string]any)
}

// Phase 1: a policy cell on @member reaches subscribers, who are members
// who pay. Today cells match the audience exactly, so paying takes the
// capability away.
func TestSubscriberKeepsMemberPolicy(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	aiApp(t, h, admin)
	sam := h.tokenFor("sam@example.com")
	h.call(admin, "sub.grant", map[string]any{"person": "sam@example.com", "until": "30d"})
	h.call(admin, "llm.set", map[string]any{"subject": "@subscriber", "value": "on"})
	h.call(admin, "policy.set", map[string]any{"app": "ai", "capability": "sample", "audience": "@member", "value": "on"})
	can := h.call(sam, "actor.call", map[string]any{"store": "ai", "action": "can"}).(map[string]any)
	if can["allowed"] != true {
		t.Fatalf("a subscriber must inherit the @member cell: %v", can)
	}
}

// Phase 1: an @member LLM row reaches subscribers. Today LLMFor looks for
// the person's row, else the exact audience's, and finds none.
func TestSubscriberKeepsMemberLLMRow(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	sam := h.tokenFor("sam@example.com")
	h.call(admin, "sub.grant", map[string]any{"person": "sam@example.com", "until": "30d"})
	h.call(admin, "llm.set", map[string]any{"subject": "@member", "value": "on", "budget": 1000})
	if u := llmAllowed(t, h, sam); u["allowed"] != true || u["remaining"] != 1000.0 {
		t.Fatalf("a subscriber must inherit the @member row: %v", u)
	}
}

// Phase 2: an owner set back to pending is capped like a guest. Today
// Level returns owner before it applies the audience cap.
func TestPendingOwnerCappedAtInteract(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	dan := h.tokenFor("dan@example.com")
	h.call(dan, "store.new", map[string]any{"id": "s-dan"})
	h.call(admin, "people.role", map[string]any{"id": personID(t, h, "dan@example.com"), "role": "pending"})
	got := h.call(admin, "explain.can", map[string]any{"store": "s-dan", "level": "admin", "subject": "dan@example.com"}).(map[string]any)
	if got["ok"] == true || got["level"] != "interact" {
		t.Fatalf("a pending owner must hold interact, not admin or owner: %v", got)
	}
}

// linkStore makes a mounted store "notes" owned by owner, open to nobody,
// and returns the live host.
func linkStore(t *testing.T, h *harness, admin, owner string) string {
	t.Helper()
	live := h.cfg.Hosts.Live[0]
	h.call(owner, "store.new", map[string]any{"id": "notes"})
	h.call(admin, "files.push", map[string]any{"store": "notes", "files": files(map[string]string{
		"app.json": `{"title":"Notes","capabilities":{"db":{}}}`, "index.html": "<!doctype html><title>n</title>"})})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/notes", "store": "notes"})
	return live
}

// Phase 2: a grant made by redeeming a link stops counting once the link
// expires. Today expiry only stops new redemptions.
func TestExpiredLinkGrantsInert(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := linkStore(t, h, admin, admin)
	l := h.call(admin, "link.new", map[string]any{"store": "notes", "level": "interact", "days": 1}).(map[string]any)
	g := h.site(live)
	if st, v := openView(g, live, "/notes", l["token"].(string)); st != 200 {
		t.Fatalf("redeem: %d %v", st, v)
	}
	later := time.Now().Add(48 * time.Hour)
	h.sys.Now = func() time.Time { return later }
	if st, v := openView(g, live, "/notes", ""); st == 200 {
		t.Fatalf("an expired link's grant must not open the store: %v", v)
	}
	gs := h.call(admin, "grant.ls", map[string]any{"store": "notes"}).([]any)
	if len(gs) != 1 || gs[0].(map[string]any)["inactive"] != "its link was revoked or has expired" {
		t.Fatalf("grant.ls must show the expired link's grant as inactive: %v", gs)
	}
}

// Phase 2: a link's grants end when its creator no longer holds the
// link's level (decision 7). Today they outlive the creator.
func TestLinkGrantsEndWithCreator(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	ana := h.tokenFor("ana@example.com")
	live := linkStore(t, h, admin, ana)
	l := h.call(ana, "link.new", map[string]any{"store": "notes", "level": "interact"}).(map[string]any)
	g := h.site(live)
	if st, v := openView(g, live, "/notes", l["token"].(string)); st != 200 {
		t.Fatalf("redeem: %d %v", st, v)
	}
	h.call(admin, "people.role", map[string]any{"id": personID(t, h, "ana@example.com"), "role": "disabled"})
	if st, v := openView(g, live, "/notes", ""); st == 200 {
		t.Fatalf("a link whose creator holds nothing must not open the store: %v", v)
	}
}

const undeclaredActor = `
const db = use('db');
defineActor({
  actions: {
    poke(ctx) { db.doc('pokes/last').set({ by: ctx.visitor.id }); return 'poked'; },
    look: { requires: 'view', run(ctx) { return 'looked'; } },
  },
});
`

// Phase 3: an action that declares no requires needs admin, checked
// before it runs (decision 4, amended). Today actor.call checks view and
// the action checks nothing.
func TestActionWithoutRequiresNeedsAdmin(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com")
	h.call(admin, "store.new", map[string]any{"id": "pk"})
	h.call(admin, "files.push", map[string]any{"store": "pk", "files": files(map[string]string{
		"app.json":   `{"title":"Poke","actor":"actor.js","capabilities":{"db":{}}}`,
		"actor.js":   undeclaredActor,
		"index.html": "<!doctype html><title>pk</title>",
	})})
	h.call(admin, "grant.set", map[string]any{"store": "pk", "subject": "@member", "level": "interact"})
	h.fail(mia, "actor.call", map[string]any{"store": "pk", "action": "poke"}, "permission_denied")
	if docBody(h, admin, "pk", "pokes/last") != nil {
		t.Fatal("the undeclared action ran")
	}
	if got := h.call(mia, "actor.call", map[string]any{"store": "pk", "action": "look"}); got != "looked" {
		t.Fatalf("a declared view action: %v", got)
	}
	if got := h.call(admin, "actor.call", map[string]any{"store": "pk", "action": "poke"}); got != "poked" {
		t.Fatalf("an admin may run an undeclared action: %v", got)
	}
}

// Phase 5: parallel model calls can't spend past the budget. Today each
// call checks remaining > 0, calls the model, then charges, so parallel
// calls all pass the check.
func TestConcurrentSamplesCannotOverspend(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	aiApp(t, h, admin)
	sam := h.tokenFor("sam@example.com")
	h.call(admin, "sub.grant", map[string]any{"person": "sam@example.com", "until": "30d"})
	h.call(admin, "policy.set", map[string]any{"app": "ai", "capability": "sample", "audience": "@subscriber", "value": "on"})
	// The fake model charges 22 tokens a call ("hi"): a budget for 5 calls.
	const budget = 110
	h.call(admin, "llm.set", map[string]any{"subject": "@subscriber", "value": "on", "budget": budget})
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok := 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, _ := api(t, h, sam, "actor.call", map[string]any{"store": "ai", "action": "ask", "args": map[string]any{"q": "hi"}})
			if st == 200 {
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	used := llmAllowed(t, h, sam)["used"].(float64)
	t.Logf("ok=%d used=%v", ok, used)
	if ok == 0 || used > budget {
		t.Fatalf("%d calls succeeded and spent %v tokens against a budget of %d", ok, used, budget)
	}
}

// Phase 1: groups by kind of principal, through explain.can, which
// reports the highest group as the audience. A pending person is in
// @guest only; an admin token without the admin scope is a member.
func TestGroupsByKind(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	adminNoScope := h.tokenFor("admin@example.com", "read", "write")
	h.tokenFor("mia@example.com")
	h.tokenFor("sam@example.com")
	h.tokenFor("pat@example.com")
	h.call(admin, "store.new", map[string]any{"id": "g"})
	h.call(admin, "sub.grant", map[string]any{"person": "sam@example.com", "until": "30d"})
	h.call(admin, "people.role", map[string]any{"id": personID(t, h, "pat@example.com"), "role": "pending"})
	aud := func(tok, subject string) any {
		args := map[string]any{"store": "g"}
		if subject != "" {
			args["subject"] = subject
		}
		return h.call(tok, "explain.can", args).(map[string]any)["audience"]
	}
	for subject, want := range map[string]string{"mia@example.com": "member", "sam@example.com": "subscriber", "pat@example.com": "guest", "anonymous": "guest"} {
		if got := aud(admin, subject); got != want {
			t.Errorf("%s: audience %v, want %s", subject, got, want)
		}
	}
	if got := aud(admin, ""); got != "admin" {
		t.Errorf("admin token: %v", got)
	}
	if got := aud(adminNoScope, ""); got != "member" {
		t.Errorf("admin token without the admin scope: %v", got)
	}
}

// Phase 3: a requires that names no level a caller can hold fails the
// activation, which rolls back; the store reports why.
func TestActionRequiresBadLevelFailsActivation(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "bad"})
	h.call(admin, "files.push", map[string]any{"store": "bad", "files": files(map[string]string{
		"app.json":   `{"title":"Bad","actor":"actor.js","capabilities":{"db":{}}}`,
		"actor.js":   `defineActor({ actions: { mine: { requires: 'self', run(ctx) { return 1; } } } });`,
		"index.html": "<!doctype html><title>bad</title>",
	})})
	st := h.call(admin, "app.status", map[string]any{"store": "bad"}).(map[string]any)
	if b, _ := st["broken"].(string); !strings.Contains(b, `requires "self"`) {
		t.Fatalf("app.status = %v", st)
	}
}

const platformAlarmActor = `
const platform = use('platform'), db = use('db');
defineActor({
  actions: { ping: { requires: 'view', run(ctx) { return 'pong'; } } },
  every: {
    share: { every: '1h', run(ctx) {
      try { platform.grants.set({ store: 'other', subject: '@guest', level: 'view' }); db.doc('out/share').set({ ok: true, at: ctx.now }); }
      catch (e) { db.doc('out/share').set({ code: e.code || String(e), at: ctx.now }); }
    } },
  },
});
`

// fireAndWait fires an alarm, then calls ping: the actor runs one event at
// a time, so ping returns after the alarm's turn.
func fireAndWait(t *testing.T, h *harness, admin, store, alarm string) {
	t.Helper()
	h.call(admin, "alarm.fire", map[string]any{"store": store, "name": alarm})
	h.call(admin, "actor.call", map[string]any{"store": store, "action": "ping"})
}

// Phase 4: an alarm has no person behind it, so a platform call acts as
// the store itself, which holds only what was granted to store:<id>. Today
// it acts as the store's owner (here an admin) and the grant goes through.
func TestAlarmPlatformActsAsStore(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "other"})
	h.call(admin, "store.new", map[string]any{"id": "pf"})
	h.call(admin, "files.push", map[string]any{"store": "pf", "files": files(map[string]string{
		"app.json":   `{"title":"PF","actor":"actor.js","capabilities":{"db":{}},"slop":{"platform":["grants.set"]}}`,
		"actor.js":   platformAlarmActor,
		"index.html": "<!doctype html><title>pf</title>",
	})})
	h.call(admin, "policy.set", map[string]any{"app": "pf", "capability": "platform", "audience": "@admin", "value": "on"})
	h.call(admin, "policy.set", map[string]any{"app": "pf", "capability": "platform", "audience": "@store", "value": "on"})
	fireAndWait(t, h, admin, "pf", "share")
	// Refused: store:pf holds nothing on other, so it isn't even told other
	// exists (not_found), as for anyone holding nothing.
	if d := docBody(h, admin, "pf", "out/share"); d["ok"] == true || (d["code"] != "not_found" && d["code"] != "permission_denied") {
		t.Fatalf("store:pf holds nothing on other, the grant must be refused: %v", d)
	}
	h.call(admin, "grant.set", map[string]any{"store": "other", "subject": "store:pf", "level": "admin"})
	fireAndWait(t, h, admin, "pf", "share")
	if d := docBody(h, admin, "pf", "out/share"); d["ok"] != true {
		t.Fatalf("with admin granted to store:pf, the grant goes through: %v", d)
	}
}

// Phase 4: an alarm's model call is the store's: it needs the @store
// policy cell and an LLM row for store:<id> (or @store), and charges
// store:<id>. Today it needs the owner's cell and charges the owner.
func TestAlarmSampleNeedsStoreCellAndBudget(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	aiApp(t, h, admin)
	h.call(admin, "policy.set", map[string]any{"app": "ai", "capability": "sample", "audience": "@admin", "value": "on"})
	used := func() float64 { return llmAllowed(t, h, admin)["used"].(float64) }
	before := used()
	fire := func() {
		t.Helper()
		h.call(admin, "alarm.fire", map[string]any{"store": "ai", "name": "digest"})
		h.call(admin, "actor.call", map[string]any{"store": "ai", "action": "can"})
	}
	fire()
	if docBody(h, admin, "ai", "digests/last") != nil || used() != before {
		t.Fatal("without the @store cell the alarm must not sample, nor charge the owner")
	}
	h.call(admin, "policy.set", map[string]any{"app": "ai", "capability": "sample", "audience": "@store", "value": "on"})
	fire()
	if docBody(h, admin, "ai", "digests/last") != nil {
		t.Fatal("without an LLM row for the store the alarm must not sample")
	}
	h.call(admin, "llm.set", map[string]any{"subject": "store:ai", "value": "on", "budget": 1000})
	fire()
	waitFor(t, "the digest", func() bool { return docBody(h, admin, "ai", "digests/last") != nil })
	if d := docBody(h, admin, "ai", "digests/last"); d["payer"] != "store:ai" {
		t.Fatalf("digest = %v", d)
	}
	if used() != before {
		t.Fatal("the owner must not be charged for the store's alarm")
	}
	if u := h.call(admin, "llm.usage", map[string]any{"person": "store:ai"}).(map[string]any)["llm"].(map[string]any); u["used"].(float64) <= 0 {
		t.Fatalf("store:ai must be charged: %v", u)
	}
}

const readerActor = `
const stores = use('stores');
let src = null;
defineActor({
  actions: {
    open: { requires: 'admin', run(ctx) { src = stores.open('src'); return src.docs.get('notes/a').exists; } },
    read: { requires: 'admin', run(ctx) { return src.docs.get('notes/a').exists; } },
  },
});
`

// Phase 4: a handle from stores.open decides on every call, not once at
// open: after the grant to store:<id> is removed, the kept handle fails.
func TestStoresOpenRechecks(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "src"})
	h.call(admin, "docs.set", map[string]any{"store": "src", "path": "notes/a", "data": map[string]any{"t": 1}})
	h.call(admin, "store.new", map[string]any{"id": "reader"})
	h.call(admin, "files.push", map[string]any{"store": "reader", "files": files(map[string]string{
		"app.json":   `{"title":"Reader","actor":"actor.js","capabilities":{"db":{}}}`,
		"actor.js":   readerActor,
		"index.html": "<!doctype html><title>r</title>",
	})})
	h.call(admin, "bind.set", map[string]any{"store": "reader", "alias": "src", "target": "src"})
	h.call(admin, "grant.set", map[string]any{"store": "src", "subject": "store:reader", "level": "view"})
	if got := h.call(admin, "actor.call", map[string]any{"store": "reader", "action": "open"}); got != true {
		t.Fatalf("open: %v", got)
	}
	h.call(admin, "grant.rm", map[string]any{"store": "src", "subject": "store:reader"})
	h.fail(admin, "actor.call", map[string]any{"store": "reader", "action": "read"}, "permission_denied")
}

// Phase 4 (amended): trust in a module has provenance. It counts only
// while the admin who made it is still an admin, checked on every call.
func TestTrustEndsWithItsAdmin(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.tokenFor("ada@example.com")
	h.call(admin, "people.role", map[string]any{"id": personID(t, h, "ada@example.com"), "role": "admin"})
	ada := h.tokenFor("ada@example.com", "read", "write", "admin")
	toolApp(t, h, admin, "tool", toolActor, "system")
	h.call(ada, "app.trust", map[string]any{"app": "tool", "module": "system"})
	if n, _ := h.call(admin, "actor.call", map[string]any{"store": "tool", "action": "people"}).(float64); n < 2 {
		t.Fatalf("trusted by ada: people = %v", n)
	}
	h.call(admin, "people.role", map[string]any{"id": personID(t, h, "ada@example.com"), "role": "member"})
	e := h.fail(admin, "actor.call", map[string]any{"store": "tool", "action": "people"}, "permission_denied")
	if !strings.Contains(e["message"].(string), "no longer trusted") {
		t.Fatalf("after ada is demoted: %v", e)
	}
}
