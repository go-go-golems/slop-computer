package host

// SLOP3-016, actor VM migration phase 1: every entry into an actor's VM
// goes through its host. The manager's Around hook sees each one; the
// hand-off variant runs each on another goroutine, as a go-go-goja owner
// will (the activation turn, opened by the kernel, then crosses goroutines).

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/actor"
)

const hostActor = `
const db = use('db'), time = use('time');
defineActor({
  setup(ctx) { db.doc('stats/setup').set({ ok: true }); },
  actions: {
    add(ctx, { n }) { db.doc('items/' + n).set({ n }); return { n }; },
    async later(ctx) {
      await time.sleep(5);
      db.doc('stats/later').set({ at: ctx.now });
      return 'done';
    },
    spin() { for (;;) {} },
  },
  http: { 'GET /hi': { level: 'public', run: () => ({ json: { hi: 1 } }) } },
  on: { 'doc:items/*'(ctx, c) {
    const s = db.doc('stats/react').get();
    db.doc('stats/react').set({ n: (s.exists ? s.data().n : 0) + 1 });
  } },
  every: { tick: { every: '1h', run() { db.doc('stats/tick').set({ ok: true }); } } },
});
`

// hostOps counts the VM entries by op.
type hostOps struct {
	mu  sync.Mutex
	ops map[string]int
}

func (c *hostOps) count(op string) {
	c.mu.Lock()
	c.ops[op]++
	c.mu.Unlock()
}

func (c *hostOps) get(op string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ops[op]
}

func TestActorHostEntries(t *testing.T) {
	for _, handoff := range []bool{false, true} {
		t.Run(fmt.Sprintf("handoff=%v", handoff), func(t *testing.T) {
			old := actor.TurnLimit
			actor.TurnLimit = 300 * time.Millisecond
			t.Cleanup(func() { actor.TurnLimit = old })

			h := newHarness(t)
			seen := &hostOps{ops: map[string]int{}}
			h.a.Around = func(op string, run func() error) error {
				seen.count(op)
				if !handoff {
					return run()
				}
				// Run on another goroutine and wait, as an owner's Call does;
				// a panic travels back to the caller, as the store expects.
				type out struct {
					err error
					p   any
				}
				done := make(chan out, 1)
				go func() {
					var o out
					defer func() {
						o.p = recover()
						done <- o
					}()
					o.err = run()
				}()
				o := <-done
				if o.p != nil {
					panic(o.p)
				}
				return o.err
			}
			exerciseHostActor(t, h)
			for _, op := range []string{"load", "setup", "turn action", "turn cont", "turn http", "turn reactor", "turn alarm"} {
				if seen.get(op) == 0 {
					t.Errorf("no %q went through the host (%v)", op, seen.ops)
				}
			}
		})
	}
}

func exerciseHostActor(t *testing.T, h *harness) {
	t.Helper()
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "hosted"})
	h.call(admin, "files.push", map[string]any{"store": "hosted", "files": files(map[string]string{
		"app.json": `{"title":"Hosted","actor":"actor.js","capabilities":{"db":{}}}`,
		"actor.js": hostActor,
	})})
	doc := func(path string) map[string]any {
		code, res := api(t, h, admin, "docs.get", map[string]any{"store": "hosted", "path": path})
		if code != 200 {
			return nil
		}
		d, _ := res["result"].(map[string]any)
		body, _ := d["body"].(map[string]any)
		return body
	}
	if doc("stats/setup")["ok"] != true {
		t.Fatalf("setup did not run")
	}
	// An action, and its reactor.
	out := h.call(admin, "actor.call", map[string]any{"store": "hosted", "action": "add", "args": map[string]any{"n": 1}}).(map[string]any)
	if out["n"] != 1.0 {
		t.Fatalf("add = %v", out)
	}
	waitFor(t, "the reactor", func() bool { return doc("stats/react")["n"] == 1.0 })
	// An await on real I/O: the rest runs in a continuation turn.
	if got := h.call(admin, "actor.call", map[string]any{"store": "hosted", "action": "later"}); got != "done" {
		t.Fatalf("later = %v", got)
	}
	if doc("stats/later") == nil {
		t.Fatalf("the continuation did not commit")
	}
	// An HTTP route.
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/hosted", "store": "hosted"})
	if r, body := h.get(live, "/hosted/hi"); r.StatusCode != 200 || !strings.Contains(body, `"hi":1`) {
		t.Fatalf("route: %d %q", r.StatusCode, body)
	}
	// An alarm.
	h.call(admin, "alarm.fire", map[string]any{"store": "hosted", "name": "tick"})
	waitFor(t, "the alarm", func() bool { return doc("stats/tick")["ok"] == true })
	// A turn that never ends is interrupted through the host, and the actor
	// goes on.
	e := h.fail(admin, "actor.call", map[string]any{"store": "hosted", "action": "spin"}, "actor_error")
	if !strings.Contains(e["message"].(string), "took longer") {
		t.Fatalf("spin = %v", e)
	}
	out = h.call(admin, "actor.call", map[string]any{"store": "hosted", "action": "add", "args": map[string]any{"n": 2}}).(map[string]any)
	if out["n"] != 2.0 {
		t.Fatalf("add after spin = %v", out)
	}
}
