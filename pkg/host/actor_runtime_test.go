package host

// SLOP3-016, actor VM migration phase 2: the guarantees an app sees are the
// same on both runtimes (design doc 02 §9): no timers or wall clocks, the
// turn's clock, console into the actor's log; and on the engine runtime, a
// go-go-goja module's Post settles in a continuation turn.

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/go-go-golems/go-go-goja/pkg/runtimebridge"

	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/config"
)

const runtimeActor = `
defineActor({
  actions: {
    globals() {
      return {
        setTimeout: typeof setTimeout, setInterval: typeof setInterval, setImmediate: typeof setImmediate,
        performance: typeof performance, Buffer: typeof Buffer, URL: typeof URL, process: typeof process,
        consoleTime: typeof console.time,
      };
    },
    clock(ctx) { return { now: ctx.now, date: Date.now(), newDate: new Date().getTime() }; },
    say(ctx, { text }) { console.log('said', text); console.warn({ text }); return null; },
  },
});
`

func TestActorRuntimeGuarantees(t *testing.T) {
	for _, rt := range []string{actor.RuntimeDirect, actor.RuntimeEngine} {
		t.Run(rt, func(t *testing.T) {
			h := newHarnessWith(t, func(c *config.Config) { c.Actors.Runtime = rt })
			admin := h.tokenFor("admin@example.com", "read", "write", "admin")
			h.call(admin, "store.new", map[string]any{"id": "rt"})
			h.call(admin, "files.push", map[string]any{"store": "rt", "files": files(map[string]string{
				"app.json": `{"title":"Runtime","actor":"actor.js"}`,
				"actor.js": runtimeActor,
			})})
			g := h.call(admin, "actor.call", map[string]any{"store": "rt", "action": "globals"}).(map[string]any)
			for k, v := range g {
				if v != "undefined" {
					t.Errorf("%s is %v in an actor; want undefined", k, v)
				}
			}
			if a := h.a.Running("rt"); a == nil || a.Runtime() != rt {
				t.Fatalf("actor runtime = %v, want %s", a, rt)
			}
			c := h.call(admin, "actor.call", map[string]any{"store": "rt", "action": "clock"}).(map[string]any)
			if c["now"] != c["date"] {
				t.Errorf("Date.now() = %v, ctx.now = %v: want the turn's time", c["date"], c["now"])
			}
			h.call(admin, "actor.call", map[string]any{"store": "rt", "action": "say", "args": map[string]any{"text": "hi"}})
			logs := h.call(admin, "app.logs", map[string]any{"store": "rt"}).(map[string]any)
			text := ""
			for _, l := range logs["lines"].([]any) {
				text += l.(map[string]any)["text"].(string) + "\n"
			}
			if !strings.Contains(text, "said hi") || !strings.Contains(text, `{"text":"hi"}`) {
				t.Errorf("console did not reach app.logs: %q", text)
			}
		})
	}
}

// A go-go-goja module settles through runtimebridge's owner. On the engine
// runtime that owner turns a Post into a continuation turn: the code after
// the await commits on its own, and rolls back on its own failure.
const postActor = `
const later = use('later'), db = use('db');
defineActor({
  actions: {
    async save(ctx) {
      db.doc('a/1').set({ x: 1 });
      const v = await later.settle(2);
      db.doc('a/2').set({ x: v });
      return v;
    },
    async bad(ctx) {
      db.doc('b/1').set({ x: 1 });
      await later.settle(1);
      db.doc('b/2').set({ x: 2 });
      throw new Error('no');
    },
    loose(ctx) { return later.fromGoroutine(); },
  },
});
`

func TestEngineModulePostIsATurn(t *testing.T) {
	h := newHarnessWith(t, func(c *config.Config) { c.Actors.Runtime = actor.RuntimeEngine })
	refused := make(chan error, 1)
	h.a.Register(actor.Module{Name: "later", Class: actor.ClassData, Load: func(s actor.Setup) goja.Value {
		vm := s.Actor.VM()
		o := vm.NewObject()
		_ = o.Set("settle", func(v goja.Value) goja.Value {
			svc, ok := runtimebridge.Lookup(vm)
			if !ok {
				panic(vm.NewTypeError("no runtimebridge services"))
			}
			p, resolve, _ := vm.NewPromise()
			if err := svc.Owner.Post(context.Background(), "later.settle", func(context.Context, *goja.Runtime) { _ = resolve(v) }); err != nil {
				panic(vm.NewGoError(err))
			}
			return vm.ToValue(p)
		})
		_ = o.Set("fromGoroutine", func() goja.Value {
			svc, _ := runtimebridge.Lookup(vm)
			go func() {
				refused <- svc.Owner.Post(context.Background(), "later.loose", func(context.Context, *goja.Runtime) {})
			}()
			return goja.Undefined()
		})
		return o
	}})
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "post"})
	h.call(admin, "files.push", map[string]any{"store": "post", "files": files(map[string]string{
		"app.json": `{"title":"Post","actor":"actor.js","capabilities":{"db":{}}}`,
		"actor.js": postActor,
	})})
	// commits counts the commits that wrote documents under prefix.
	commits := func(prefix string) int {
		n := 0
		for _, c := range h.call(admin, "log.show", map[string]any{"store": "post", "after": 0, "limit": 1000}).([]any) {
			for _, ch := range c.(map[string]any)["changes"].([]any) {
				if m := ch.(map[string]any); m["kind"] == "doc" && strings.HasPrefix(m["key"].(string), prefix) {
					n++
					break
				}
			}
		}
		return n
	}
	exists := func(path string) bool {
		code, _ := api(t, h, admin, "docs.get", map[string]any{"store": "post", "path": path})
		return code == 200
	}
	if got := h.call(admin, "actor.call", map[string]any{"store": "post", "action": "save"}); got != 2.0 {
		t.Fatalf("save = %v", got)
	}
	if n := commits("a/"); n != 2 {
		t.Fatalf("save made %d commits, want 2 (before and after the await)", n)
	}
	if !exists("a/1") || !exists("a/2") {
		t.Fatalf("save's writes are missing")
	}
	h.fail(admin, "actor.call", map[string]any{"store": "post", "action": "bad"}, "actor_error")
	if !exists("b/1") || exists("b/2") {
		t.Fatalf("bad: b/1 %v (want committed), b/2 %v (want rolled back)", exists("b/1"), exists("b/2"))
	}
	h.call(admin, "actor.call", map[string]any{"store": "post", "action": "loose"})
	if err := <-refused; err == nil || !strings.Contains(err.Error(), "outside a turn") {
		t.Fatalf("a Post from a module's goroutine = %v, want refused", err)
	}
}

// The crash path is the same on both runtimes: a Go panic inside a turn
// fails that turn ("turn panicked"); one inside setup fails the activation
// (the panic travels from the engine's loop back to the kernel's turn);
// three crashed turns in a minute mark the actor broken.
func TestActorCrashPath(t *testing.T) {
	for _, rt := range []string{actor.RuntimeDirect, actor.RuntimeEngine} {
		t.Run(rt, func(t *testing.T) {
			h := newHarnessWith(t, func(c *config.Config) { c.Actors.Runtime = rt })
			h.a.TurnLimit = 200 * time.Millisecond
			h.a.Register(actor.Module{Name: "boom", Class: actor.ClassData, Load: func(s actor.Setup) goja.Value {
				o := s.Actor.VM().NewObject()
				_ = o.Set("now", func() goja.Value { panic("boom") })
				return o
			}})
			admin := h.tokenFor("admin@example.com", "read", "write", "admin")

			// A panic in setup fails the activation and leaves no version.
			h.call(admin, "store.new", map[string]any{"id": "setupboom"})
			h.call(admin, "files.push", map[string]any{"store": "setupboom", "files": files(map[string]string{
				"app.json": `{"title":"Boom","actor":"actor.js"}`,
				"actor.js": `defineActor({ setup() { use('boom').now(); } });`,
			})})
			st := h.call(admin, "app.status", map[string]any{"store": "setupboom"}).(map[string]any)
			if !strings.Contains(fmt.Sprint(st["broken"]), "panicked") {
				t.Fatalf("setup panic: status = %v", st)
			}

			// Turns: a panic, then endless loops; three crashes break it.
			h.call(admin, "store.new", map[string]any{"id": "crash"})
			h.call(admin, "files.push", map[string]any{"store": "crash", "files": files(map[string]string{
				"app.json": `{"title":"Crash","actor":"actor.js"}`,
				"actor.js": `defineActor({ actions: { boom() { use('boom').now(); }, spin() { for (;;) {} }, ok() { return 1; } } });`,
			})})
			e := h.fail(admin, "actor.call", map[string]any{"store": "crash", "action": "boom"}, "actor_error")
			if !strings.Contains(e["message"].(string), "panicked") {
				t.Fatalf("boom = %v", e)
			}
			if got := h.call(admin, "actor.call", map[string]any{"store": "crash", "action": "ok"}); got != 1.0 {
				t.Fatalf("ok after one crash = %v", got)
			}
			start := time.Now()
			h.fail(admin, "actor.call", map[string]any{"store": "crash", "action": "spin"}, "actor_error")
			if d := time.Since(start); d < 200*time.Millisecond || d > 2*time.Second {
				t.Errorf("spin interrupted after %v, want about 200ms", d)
			}
			h.fail(admin, "actor.call", map[string]any{"store": "crash", "action": "spin"}, "actor_error")
			e = h.fail(admin, "actor.call", map[string]any{"store": "crash", "action": "ok"}, "actor_error")
			if !strings.Contains(e["message"].(string), "broken") {
				t.Fatalf("after three crashes: %v", e)
			}
		})
	}
}
