package host

// SLOP3-016, actor VM migration phase 3: what the engine runtime costs,
// measured against the direct one (design doc 02 §8). Runs only with
// SLOP_BENCH=1; the numbers go to the migration diary.

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/config"
)

const runtimeBenchActor = `
const db = use('db'), time = use('time');
let n = 0;
defineActor({
  actions: {
    noop: { requires: 'view', run() { return 1; } },
    put: { requires: 'view', run() { db.doc('x/1').set({ n: ++n }); return n; } },
    later: { requires: 'view', async run() { await time.sleep(0); return 1; } },
    spin: { requires: 'view', run() { for (;;) {} } },
  },
});
`

func TestBenchActorRuntime(t *testing.T) {
	if os.Getenv("SLOP_BENCH") == "" {
		t.Skip("set SLOP_BENCH=1")
	}
	stores := 200
	for _, rt := range []string{actor.RuntimeDirect, actor.RuntimeEngine} {
		t.Run(rt, func(t *testing.T) {
			h := newHarnessWith(t, func(c *config.Config) { c.Actors.Runtime = rt })
			admin := h.tokenFor("admin@example.com", "read", "write", "admin")
			h.call(admin, "store.new", map[string]any{"id": "bench"})
			h.call(admin, "files.push", map[string]any{"store": "bench", "files": files(map[string]string{
				"app.json": `{"title":"Bench","actor":"actor.js","capabilities":{"db":{}}}`,
				"actor.js": runtimeBenchActor,
			})})
			ctx := context.Background()
			vis := actor.Visitor{ID: "usr_bench", Level: "owner", Audience: "admin"}
			call := func(store, action string) {
				if _, err := h.a.Call(ctx, store, action, nil, vis, "bench"); err != nil {
					t.Fatalf("%s %s: %v", store, action, err)
				}
			}
			call("bench", "noop")

			// Turn latency.
			for _, action := range []string{"noop", "put", "later"} {
				r := testing.Benchmark(func(b *testing.B) {
					b.ReportAllocs()
					for b.Loop() {
						call("bench", action)
					}
				})
				t.Logf("%s turn %-5s %s %s", rt, action, r.String(), r.MemString())
			}

			// Goroutines and memory per live actor: all running, then all
			// stopped (a commit already starts a store's actor, so stores are
			// made first and the difference is the actors alone).
			for i := range stores {
				h.call(admin, "store.new", map[string]any{"id": fmt.Sprintf("b%03d", i), "app": "bench"})
			}
			settle := func() (int, uint64) {
				time.Sleep(300 * time.Millisecond)
				runtime.GC()
				runtime.GC()
				var ms runtime.MemStats
				runtime.ReadMemStats(&ms)
				return runtime.NumGoroutine(), ms.HeapInuse
			}
			for i := range stores {
				call(fmt.Sprintf("b%03d", i), "noop")
			}
			g1, m1 := settle()
			for i := range stores {
				h.a.Restart(fmt.Sprintf("b%03d", i))
			}
			g0, m0 := settle()
			t.Logf("%s %d live actors: %d goroutines (%.2f each), %.1f MiB heap (%.1f KiB each)",
				rt, stores, g1-g0, float64(g1-g0)/float64(stores),
				(float64(m1)-float64(m0))/(1<<20), (float64(m1)-float64(m0))/1024/float64(stores))

			// Interrupt timing at the real limit.
			start := time.Now()
			if _, err := h.a.Call(ctx, "bench", "spin", nil, vis, "bench"); err == nil {
				t.Fatalf("spin returned")
			}
			t.Logf("%s endless loop interrupted after %v (limit %v)", rt, time.Since(start).Round(time.Millisecond), actor.TurnLimit)
		})
	}
}
