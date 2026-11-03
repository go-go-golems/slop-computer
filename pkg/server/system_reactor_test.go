package server

// Tests from SLOP3-002 phase W3 (system: reactors); formerly w3_test.go.

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

const watchActor = `
const db = use('db');
defineActor({
  actions: {
    count(ctx) { const c = db.doc('stats/grants').get(); return c.exists ? c.data() : { n: 0 }; },
  },
  on: {
    'system:grant'(ctx, e) {
      if (!e.changes.some((c) => c.kind === 'grant' && c.key.startsWith('target '))) return;
      const c = db.doc('stats/grants').get();
      const n = (c.exists ? c.data().n : 0) + 1;
      db.doc('stats/grants').set({ n, last: e.summary, via: e.via, rev: e.rev });
    },
  },
});
`

// W3 exit: a system:grant reactor runs once per grant.set made from the
// CLI, keeps its cursor across a restart, catches up on start, and does
// not run while the app is not trusted with system.
func TestSystemReactor(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	toolApp(t, h, admin, "watch", watchActor, "system")
	h.call(admin, "store.new", map[string]any{"id": "target"})
	count := func() float64 {
		n, _ := h.call(admin, "actor.call", map[string]any{"store": "watch", "action": "count"}).(map[string]any)["n"].(float64)
		return n
	}
	waitFor := func(want float64) {
		t.Helper()
		for end := time.Now().Add(5 * time.Second); time.Now().Before(end); time.Sleep(30 * time.Millisecond) {
			if count() == want {
				return
			}
		}
		t.Fatalf("grant count = %v, want %v", count(), want)
	}
	grant := func(subject string) {
		h.call(admin, "grant.set", map[string]any{"store": "target", "subject": subject, "level": "view"})
	}

	// Not trusted: nothing is delivered.
	count()
	grant("@guest")
	time.Sleep(200 * time.Millisecond)
	if n := count(); n != 0 {
		t.Fatalf("untrusted reactor ran: %v", n)
	}

	h.call(admin, "app.trust", map[string]any{"app": "watch", "module": "system"})
	count() // start the actor: it catches up from its cursor (set at activation)
	waitFor(1)
	grant("@member")
	waitFor(2)
	grant("@subscriber")
	waitFor(3)
	time.Sleep(200 * time.Millisecond)
	if n := count(); n != 3 {
		t.Fatalf("delivered more than once: %v", n)
	}

	// A restart keeps the cursor: nothing is delivered twice; what happened
	// while stopped is delivered on start.
	h.a.Restart("watch")
	grant("@guest")
	count()
	waitFor(4)
	time.Sleep(200 * time.Millisecond)
	if n := count(); n != 4 {
		t.Fatalf("after restart: %v", n)
	}
	last := h.call(admin, "docs.get", map[string]any{"store": "watch", "path": "stats/grants"}).(map[string]any)["body"].(map[string]any)
	if !strings.Contains(fmt.Sprint(last["last"]), "target") || last["via"] == "" {
		t.Fatalf("last = %v", last)
	}
}
