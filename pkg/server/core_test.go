package server

// SLOP3-007, the authority core: exit tests written before the code they
// test (phase 0). Each is skipped until its phase lands and fails on the
// code before that phase.

import (
	"context"
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
	t.Skip("SLOP3-007 phase 1")
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
	t.Skip("SLOP3-007 phase 1")
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
	t.Skip("SLOP3-007 phase 2")
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
	t.Skip("SLOP3-007 phase 2")
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
}

// Phase 2: a link's grants end when its creator no longer holds the
// link's level (decision 7). Today they outlive the creator.
func TestLinkGrantsEndWithCreator(t *testing.T) {
	t.Skip("SLOP3-007 phase 2")
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
	t.Skip("SLOP3-007 phase 3")
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
	t.Skip("SLOP3-007 phase 5")
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
