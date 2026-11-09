---
Title: 'Design: migrating the actor VM to a go-go-goja engine runtime'
Ticket: SLOP3-016
Status: active
Topics:
    - architecture
    - backend
    - apps
    - agents
    - security
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/actor/actor.go
      Note: 'build, loop, handle, continueWith, io: the VM entry points the host interface wraps'
    - Path: repo://pkg/actor/catalog.go
      Note: module classes; where bridged go-go-goja modules would register
    - Path: repo://pkg/actor/modules.go
      Note: use() catalog and the helpers modules call
ExternalSources: []
Summary: 'How to run slop''s per-store actor on a go-go-goja engine.Runtime instead of a bare goja.Runtime, without changing what apps see: turns stay transactions, awaited I/O stays a continuation turn, require keeps slop''s rules, no timers. Covers the two runtimes, every point where they differ, the upstream changes needed in go-go-goja, a host abstraction with a flag, phases and the parity test strategy.'
LastUpdated: 2026-11-07T14:30:00-05:00
WhatFor: Planning and reviewing the migration of pkg/actor to go-go-goja's engine
WhenToUse: Before changing how pkg/actor creates or drives its goja runtime, or when adding go-go-goja modules or jsverbs to actors
---

# Design: migrating the actor VM to a go-go-goja engine runtime

## 1. Executive summary

Every slop store that runs an app has an **actor**: a server-side JavaScript runtime that handles one event at a time. Today the actor creates a bare `goja.Runtime` and drives it from its own goroutine (`pkg/actor/actor.go:170-233, 354-494`). go-go-goja, the go-go-golems library of goja modules and tooling, has its own runtime, `engine.Runtime`. That runtime bundles a VM, a goja_nodejs event loop that owns the VM, a module registry for `require`, and an owner object through which all VM access is serialised (`go-go-goja/pkg/engine/factory.go:184-292`).

Moving the actor onto `engine.Runtime` would let slop use go-go-goja's ecosystem inside actors:

- data modules (`yaml`, `crypto`, `events`, …) with their TypeScript declarations;
- **jsverbs**, invoked directly in an actor's runtime (`Registry.InvokeInRuntime`), which the SLOP3-016 Pinboard design wants for app verbs run server-side;
- go-go-goja's REPL and inspector tooling, attached to a running actor for debugging.

The two runtimes disagree on four points, and each matters because of guarantees slop gives to apps:

1. **Who drives the VM.** slop's actor goroutine calls into the VM directly. In go-go-goja the event loop owns it, and others go through `Owner.Call`/`Post`.
2. **Where asynchronous results land.** slop resumes code after an `await` on real I/O in a *new turn*: a new SQLite transaction, with the visitor restored (`actor.go:509-541`). go-go-goja modules settle promises with `Owner.Post` on the loop, outside any transaction.
3. **Timers and clocks.** slop deliberately has no timers, and `Date.now` is the turn's clock (`actor.go:199-206`). go-go-goja installs `setTimeout` (through the `timer` module, which is even in its "data-only" default set, `module_specs.go:164`), console timers and a wall-clock `performance.now` (`factory.go:261-270`).
4. **`require` resolution.** In slop a bare name is a path in the app's tree, and catalog names (`database`, `express`, `fs`, `path`) resolve first, behind policy (`actor.go:281-334`). goja_nodejs resolves bare names to native modules and then to `node_modules`.

The design keeps slop's semantics exactly and treats go-go-goja as the runtime host:

- turns run through `Owner.Call` from the existing actor goroutine;
- an owner adapter turns every module's `Post` into a slop continuation turn;
- timers, console timers and `performance` are not installed;
- slop keeps its own `require` and exposes its catalog through it;
- the actor is built with all default module sets off and an explicit module list.

The work starts with a refactor that puts every VM entry point behind one interface, then adds an engine-backed implementation behind a configuration flag, and switches the default only when the whole actor test suite passes on both.

Estimated effort: two to four days for the slop side, plus small upstream changes in go-go-goja (section 7).

## 2. Scope

**In scope:** how `pkg/actor` creates, drives and stops its runtime; the module bridge in both directions; the upstream go-go-goja options this needs; tests and rollout.

**Out of scope:** changing what apps can do. No API visible to app authors changes in this migration. New modules (`yaml`, jsverbs) are added after it, in their own changes. Page runtimes in the browser are unrelated.

## 3. Orientation

### 3.1 slop's actor, in one page

- **Manager and actor.** `actor.Manager` keeps one `Actor` per running store, built on first use from the app's snapshot and retired after 60 s without events (`actor.go:32-34`, `manager.go`).
- **Build.** `build()` creates `goja.New()`, sets the JSON field-name mapper, and installs the globals `defineActor`, `use`, `require`, `console` (into the actor's log, kept by the manager), `__slopNow`, and `Date.now`, which returns the turn's time. It then runs `actor.js` under a 5-second interrupt and reads the definition's shape (`actor.go:170-233`).
- **Events and turns.** Callers push events (`action`, `http`, `alarm`, `reactor`, `setup`, `cont`) into the store's inbox. The actor goroutine takes one at a time (`loop`, `:354-394`). `handle` runs it as a **turn**: `store.Do` opens a SQLite transaction as the visitor, sets `a.cur`, arms a `TurnLimit` timer that calls `vm.Interrupt`, and runs the handler. A rejected root promise, an exception or an interrupt rolls the turn back; otherwise it commits (`:396-494`).
- **Awaited I/O.** A module that does real I/O calls `a.io(work, settle)`: it creates a promise, runs `work` on a goroutine, and when that finishes pushes a `cont` event whose turn runs `settle` and resolves the promise (`:509-541`). The code after the `await` therefore runs in a new transaction. The original event is **parked** until its root promise settles (`park` `:93-97`, `rootOr` `:496-507`).
- **Turn-scoped state.** `use('database')` savepoints are closed or dropped with the turn (`database.go:147-170`). `use('fs')` writes follow the turn's commit or rollback (`a.fs.end(err == nil)`, `actor.go:439`). Room messages and replies wait for the commit (`cur.out`).
- **Modules.** `use(name)` is a switch over built-ins (`sql db files alarm storage time log stores`), policy-checked capabilities (`fetch secrets`), modules provided by other packages (`room sample platform`, `registry.go`), and catalog modules (`database express fs path system workshop`, classes data/own/scoped/trusted, `catalog.go:1-80`). Modules call back through the actor's exported helpers (`IO`, `Turn`, `Visitor`, `Need`, `ToJS`, `modules.go:72-129`).
- **Crashes.** Three interrupted or panicked turns within a minute mark the actor broken (`crashed`, `:543-557`).

### 3.2 go-go-goja's engine, in one page

- **Factory and runtime.** `engine.NewRuntimeFactoryBuilder(opts…)` collects modules, module middleware and runtime initializers, and builds an immutable `RuntimeFactory`. `NewRuntime()` creates a fresh runtime from it (`factory.go:40-60, 184-292`).
- **What `NewRuntime` does,** in order:
  1. `goja.New()`, then `eventloop.NewEventLoop()` and `loop.Start()`, which starts the loop's goroutine (`:208-212`).
  2. `runtimeowner.NewRuntimeOwner(vm, loop, …)`: the owner (`:214-218`).
  3. `runtimebridge.Store(vm, {LifetimeContext, Loop, Owner})`, so modules can find the owner from the VM (`:232-236`).
  4. A goja_nodejs `require` registry; each registered module is added to it (`:238-258`).
  5. `reg.Enable(vm)`, `console.Enable`, `buffer.Enable`, `url.Enable`, then performance globals and console timers (`:260-270`).
  6. Runtime initializers (`:274-290`).
- **The owner** (`pkg/runtimeowner/runner.go`). `Call(ctx, op, fn)` runs `fn` on the loop goroutine and waits for its result. When already on the owner context it runs `fn` directly, which makes re-entrant calls safe. `Post(ctx, op, fn)` schedules `fn` without waiting. Panics are recovered into errors when `RecoverPanics` is set (`:90-134, 136-230`).
- **runtimebridge.** Asynchronous modules look up `RuntimeServices` from the VM and settle promises with `Owner.Post` (`pkg/runtimebridge/runtimebridge.go`). The express module adapts between the two owner interfaces in about 20 lines (`modules/express/express.go:69-87`).
- **Default modules.** `pkg/engine/runtime.go:20-28` blank-imports every module: `crypto database events exec fs os path time timer`. Which ones a runtime gets is decided by options (`WithImplicitDefaultRegistryModules`, `WithDataOnlyDefaultRegistryModules`, `options.go:59-90`) and by module middleware (`MiddlewareSafe`, `MiddlewareOnly`, `module_middleware.go`). The data-only set is `crypto events path time timer` (`module_specs.go:164`).

### 3.3 Terms

| Term | Meaning here |
|---|---|
| turn | one event handled in one store transaction, with one visitor, under a 5 s interrupt |
| continuation | the `cont` event that resumes a handler after awaited I/O, in a new turn |
| park | an event whose root promise is pending across turns |
| owner | go-go-goja's object that serialises access to the VM (`Call`, `Post`) |
| loop | the goja_nodejs event loop goroutine that the owner schedules onto |
| host | (new, this design) the interface `pkg/actor` uses to reach its VM, with a direct and an engine implementation |

## 4. Where the two runtimes differ

| # | Concern | slop today | engine default | Required behaviour | How |
|---|---|---|---|---|---|
| 1 | VM driver | actor goroutine calls the VM | loop goroutine owns the VM | one event at a time, in inbox order | the actor goroutine calls `Owner.Call` for each turn and waits (D1) |
| 2 | async settle | `cont` turn via the inbox | `Owner.Post` on the loop | every settle inside a turn | the owner given to modules turns `Post` into a continuation event (D2) |
| 3 | timers | none | `timer` module, console timers | none (determinism, no work outside turns) | no default modules; no console timers (D3, upstream U2) |
| 4 | clock | `Date.now` = turn time | wall clock; `performance.now` from runtime start | turn time | slop's initializer sets `Date.now`; no `performance` global (D3, U2) |
| 5 | require | tree paths, catalog first, policy | goja_nodejs: native, then `node_modules` | slop's rules | keep slop's `require` global; the registry only serves bridged modules (D4) |
| 6 | console | into the actor log | goja_nodejs console to stdout | into the actor log | slop's initializer replaces `console` (D5) |
| 7 | Buffer, URL | absent | installed | no change visible to apps | not installed in phase 2; possibly offered later (D5, U2) |
| 8 | interrupts | `vm.Interrupt` from a timer | none per call | 5 s per turn, on load and on setup | unchanged: `Interrupt` is safe from any goroutine; armed around the `Call` |
| 9 | panics | `turn panicked` → crash count | recovered into errors by the owner | crash count unchanged | the owner's recovered error is mapped to the same crash path |
| 10 | lifetime | retire after idle; `stop` channel | `Runtime.Close`, loop stop | retire closes the runtime | `host.Close()` calls `Runtime.Close` |
| 11 | goroutines | 1 per live actor | 2 per live actor (actor + loop) | acceptable | measure in phase 3 |
| 12 | default modules | none from go-go-goja | everything compiled in, selectable | none unless chosen | `WithImplicitDefaultRegistryModules(false)`, `WithDataOnlyDefaultRegistryModules(false)`, explicit list (D6) |

## 5. Proposed design

### 5.1 A host interface in `pkg/actor`

All VM access in `pkg/actor` goes through one small interface. The first implementation wraps today's behaviour exactly; the second uses the engine.

```go
// pkg/actor/host.go
type vmHost interface {
	VM() *goja.Runtime
	// Run executes fn with exclusive use of the VM and returns its error.
	// Direct: calls fn. Engine: Owner.Call on the loop goroutine.
	Run(ctx context.Context, op string, fn func(vm *goja.Runtime) error) error
	Interrupt(reason any) // safe from any goroutine
	ClearInterrupt()
	Close(ctx context.Context) error
}

type directHost struct{ vm *goja.Runtime }        // phase 1: today's behaviour

type engineHost struct {                           // phase 2
	rt *engine.Runtime
}
func (h *engineHost) Run(ctx context.Context, op string, fn func(*goja.Runtime) error) error {
	_, err := h.rt.Owner.Call(ctx, op, func(_ context.Context, vm *goja.Runtime) (any, error) {
		return nil, fn(vm)
	})
	return err
}
```

`build`, `handle` (the body inside `store.Do`) and every continuation run through `host.Run`. Module code already runs inside those calls, so modules keep calling `a.vm` directly; on the engine host that is the loop goroutine, which owns the VM at that moment.

### Decision D1: the inbox stays; each turn is one `Owner.Call`

- **Context:** slop's ordering, back-pressure (256 queued events) and parking live in the actor goroutine and the store's inbox. The engine wants the loop goroutine to own the VM.
- **Options considered:** (a) move the inbox onto the event loop (`Post` each event); (b) keep the actor goroutine and inbox, and run each turn with `Owner.Call`.
- **Decision:** (b).
- **Rationale:** The transaction (`store.Do`), the visitor, the reply channel and the park state are all managed by the actor goroutine today. Keeping them there leaves `manager.go` and the inbox untouched. `Call` blocks the actor goroutine until the turn's JavaScript returns, so turns stay strictly one at a time.
- **Consequences:** Each turn pays one goroutine hand-off (measure it; expected microseconds against millisecond turns). The SQLite transaction is opened on the actor goroutine and used from the loop goroutine during the call. That is safe because the actor goroutine is blocked, but `store.Turn` must not rely on goroutine identity (check it in phase 2).
- **Status:** proposed

### 5.2 Asynchronous settlement goes through turns

### Decision D2: modules see an owner whose `Post` becomes a continuation turn

- **Context:** slop's guarantee is that the code after an `await` runs inside a turn: in a transaction, with the visitor, under the interrupt. go-go-goja modules (fetch, and any asynchronous module added later) settle with `runtimebridge`'s `Owner.Post`, which would run the settle callback on the loop with no turn.
- **Options considered:** (a) allow settlement on the loop, and forbid store access there; (b) give modules an owner whose `Post` pushes a slop `cont` event, so the callback runs inside a new turn; (c) bridge only synchronous go-go-goja modules.
- **Decision:** (b), with (c) as the first step: phase 4 bridges only synchronous modules, and (b) lands before any asynchronous go-go-goja module is offered.
- **Rationale:** (a) breaks the transaction guarantee silently for any module author who forgets the rule. (b) is the same mechanism slop's own `io()` uses (`actor.go:518-541`).
- **Consequences:** go-go-goja needs a way to supply the runtimebridge owner (upstream U1), because `NewRuntime` stores its own before modules register (`factory.go:232-236`). The adapter:

```go
// The owner slop stores in runtimebridge for the actor's VM.
type turnOwner struct{ a *Actor; inner runtimebridge.RuntimeOwner }

func (o turnOwner) Call(ctx context.Context, op string, fn func(context.Context, *goja.Runtime) (any, error)) (any, error) {
	return o.inner.Call(ctx, op, fn) // re-entrant on the loop; used synchronously inside a turn
}
func (o turnOwner) Post(ctx context.Context, op string, fn func(context.Context, *goja.Runtime)) error {
	ev := o.a.parentEventOrNil()     // the event whose handler is waiting, captured when the work started
	if ev == nil { return errors.New("asynchronous settle outside a handler") }
	o.a.continueWith(ev, func() error { fn(ctx, o.a.vm); return nil }) // runs in a new turn
	return nil
}
```

`parentEventOrNil` needs the event to be known when the module starts its work, not when it settles. slop's `io()` captures `a.cur.ev` at that point. For go-go-goja modules, the adapter captures it in `Call`/`Post` by reading `a.cur` at the time the module registers its pending work. Phase 4 must verify this for each asynchronous module before it is offered.
- **Status:** proposed

### 5.3 Timers, clock and globals

### Decision D3: no timers; the clock stays the turn's

- **Context:** A timer callback runs outside any turn, so it would write outside a transaction and outside the visitor's rights. `performance.now` measures wall time, which apps could use to observe scheduling. slop's alarms (`use('alarm')`, `every`) are the supported way to schedule work.
- **Decision:** No `timer` module, no console timers, no `performance` global. `Date.now` and `new Date()` with no arguments keep returning the turn's time.
- **Consequences:** Needs upstream U2 (options to skip the globals `NewRuntime` installs), or a slop runtime initializer that deletes them after creation. Deleting works for globals, but an explicit option is clearer and cannot race module registration.
- **Status:** proposed

### Decision D5: slop's globals are installed by a runtime initializer

`defineActor`, `use`, `require` (slop's), `console` (into the actor log), `__slopNow` and the `Date.now` override move from `build()` into a `RuntimeInitializer` that the factory runs on every new runtime (`factory.go:274-290`). `Buffer` and `URL` are not installed in this migration (no visible change). Offering them later is a separate decision; they are pure data and harmless.

### 5.4 require

### Decision D4: slop keeps its own `require`

- **Context:** slop's resolution rules are part of the app contract: a bare name is a path in the app's tree; `require('database')` is `use('database')`, with policy; `.json` files load as values (`actor.go:281-334`). goja_nodejs's registry would look for `node_modules` and expose any registered native module by name.
- **Options considered:** (a) adopt goja_nodejs `require` with a custom loader that emulates slop's rules; (b) keep slop's `require` as the global, and use the go-go-goja registry only as a source of bridged modules, reached through slop's catalog.
- **Decision:** (b).
- **Rationale:** Emulating the rules inside goja_nodejs's resolver would be subtle (bare-name handling, caching, cycles) and would risk breaking existing apps (Blocks site, Workshop, back office, the examples). With (b), app-visible behaviour is unchanged by construction.
- **Consequences:** jsverbs' `InvokeInRuntime` calls `runtime.Require.Require(modulePath)` (`go-go-goja/pkg/jsverbs/runtime.go:48-70`). For verbs inside actors, the engine's `Require` must find the verb files. A loader over the app's verb sources is enough, since verbs are not app modules (phase 5). Alternatively, upstream U3 lets jsverbs take a require function.
- **Status:** proposed

### 5.5 Modules in both directions

**slop's modules on the engine runtime.** Unchanged. They are built by `use()` and the catalog on the same VM, and use the actor's helpers.

**go-go-goja modules in slop's catalog.** A bridge wraps a go-go-goja native module as a slop catalog module:

```go
// pkg/actor/bridge.go
func bridged(name string, class Class, mod modules.NativeModule) Module {
	return Module{Name: name, Class: class, Doc: mod.Doc(), TypeScript: tsFor(mod),
		Load: func(s Setup) goja.Value {
			vm := s.Actor.VM()
			obj := vm.NewObject(); _ = obj.Set("exports", vm.NewObject())
			mod.Loader(vm, obj)                 // go-go-goja's loader fills module.exports
			return obj.Get("exports")
		}}
}
```

Phase 4 starts with synchronous, data-class modules only: `yaml`, `crypto` and `events`. Each is checked for globals it installs and for use of the event loop.

### Decision D6: engine runtimes start empty

The actor factory is built with `WithImplicitDefaultRegistryModules(false)` and `WithDataOnlyDefaultRegistryModules(false)`, and no module middleware that selects defaults. Modules reach an actor only through slop's catalog, which applies classes, grants and policy. Even the data-only set contains `timer`, so "safe defaults" are not safe for actors. The default modules remain compiled into the binary (`pkg/engine/runtime.go:20-28`); compiling them out would be a separate upstream change.

### 5.6 Build and turn, with the engine host

```go
// manager: one factory, built once
m.factory = engine.NewRuntimeFactoryBuilder(
	engine.WithImplicitDefaultRegistryModules(false),
	engine.WithDataOnlyDefaultRegistryModules(false),
	engine.WithRuntimeBridgeOwner(turnOwnerFor),    // U1
	engine.WithoutDefaultGlobals("console-timers", "performance", "buffer", "url"), // U2
).WithRuntimeInitializers(slopGlobals{}).Build()

// build(): per actor
rt, err := m.factory.NewRuntime(engine.WithLifetimeContext(actorCtx))
a.host = &engineHost{rt: rt}
err = a.host.Run(ctx, "load", func(vm *goja.Runtime) error {
	timer := time.AfterFunc(TurnLimit, func() { a.host.Interrupt("actor.js took too long to load") })
	defer func() { timer.Stop(); a.host.ClearInterrupt() }()
	_, err := vm.RunScript(entry, src)
	return err
})

// handle(): per event (inside store.Do, on the actor goroutine)
err := a.host.Run(ctx, "turn "+ev.kind, func(vm *goja.Runtime) error {
	v, err := ev.run(a, ctxObj)   // the existing body, unchanged
	val = v
	return err
})
```

Everything around `host.Run` stays as it is: the transaction, the interrupt timer, savepoint cleanup, the `fs` journal, the park and settle logic, and the replies.

### 5.7 Configuration and rollout

`slop.yaml` gets `actors: {runtime: direct | engine}` (default `direct`). A host test runs every actor test twice (section 9). The default switches to `engine` when the suites match and the benchmarks are acceptable; `direct` is removed one release later.

## 6. What the migration enables

| Gain | How |
|---|---|
| jsverbs inside actors | `Registry.InvokeInRuntime(ctx, a.host.rt, verb, values)` inside a turn: SLOP3-016 app verbs run server-side in the board's actor, with `core.js` loaded once |
| go-go-goja modules | bridged into the catalog with their TypeScript (`yaml`, `crypto`, `events` first) |
| debugging | go-go-goja's REPL session and inspector attach to an `engine.Runtime`: an admin could inspect a live actor (a separate, admin-only feature) |
| one runtime model | slop and other go-go-golems tools share owner, bridge and module conventions |

What it does not change: what apps can do, the turn model, the security classes of modules.

## 7. Upstream changes in go-go-goja

| # | Change | Why |
|---|---|---|
| U1 | An option to supply the `runtimebridge` owner, or to wrap the default one, before modules register | D2: asynchronous settlement must become a slop turn |
| U2 | Options to skip the globals `NewRuntime` installs (`console`, console timers, `performance`, `Buffer`, `URL`) | D3, D5: no timers, a turn clock, slop's console |
| U3 (optional) | jsverbs: an invoke variant taking a `*goja.Runtime` and a require function, instead of `*engine.Runtime` | lets slop run verbs before, or without, this migration |
| U4 (separate) | jsverbs: a pure-Go scanner on goja's parser, tree-sitter in an opt-in subpackage | keeps cgo grammars out of slop (SLOP3-016 discussion) |

U1 and U2 are small (options on the builder) and useful beyond slop: any host that needs deterministic runtimes wants them.

## 8. Implementation phases

| Phase | Work | Done when |
|---|---|---|
| 0 | Upstream U1, U2 in go-go-goja; release; slop `go.mod` adds go-go-goja (goja revisions already match: `v0.0.0-20261103151521-97b96e1e55f5`) | go-go-goja tests pass; slop builds |
| 1 | `vmHost` interface and `directHost`; route `build`, `handle` and continuations through `host.Run`; no behaviour change | the whole `pkg/host` suite passes unchanged |
| 2 | `engineHost`, the actor factory (D6), `slopGlobals` initializer (D3, D5), `turnOwner` (D2), the `actors.runtime` flag | the actor suites pass in both modes |
| 3 | Measurements: turn latency (`db_bench_test.go`), goroutines and memory per live actor, interrupt timing, crash path | numbers recorded; no regression beyond agreed bounds |
| 4 | Bridge synchronous data modules (`yaml`, `crypto`, `events`) into the catalog, with TypeScript | catalog tests list them; apps can `use('yaml')` |
| 5 | jsverbs inside actors: `app.verb` (SLOP3-016 §6.12) runs verbs in the board's actor turn | the Pinboard verb tests pass server-side |
| 6 | Default to `engine`; remove `directHost` one release later | — |

## 9. Test strategy

- **Parity: the existing actor suites in both modes.** `actors_test.go`, `actor_db_test.go`, `database_module_test.go`, `express_module_test.go`, `fs_module_test.go`, `modules_test.go`, `module_catalog_test.go`, `system_module_test.go`, `system_reactor_test.go`, `workshop_module_test.go`, `examples_test.go`, `once_test.go`, plus the mount API tests. The harness gains a mode switch; CI runs both.
- **New tests for the differences:**
  - no `setTimeout`, `setInterval` or `performance` in an actor;
  - `Date.now()` equals the turn time;
  - `console.log` lands in `app.logs`;
  - an infinite loop is interrupted at 5 s, three times marks the actor broken;
  - a module's `Post` settles in a new turn: a write after the `await` commits separately and is rolled back on its own failure.
- **Race detector:** the suites under `-race` in engine mode. The transaction crossing goroutines (D1) is the likeliest source of findings.
- **Benchmarks:** `db_bench_test.go`, plus a turn-latency microbenchmark (an empty action) in both modes.

## 10. Risks and open questions

1. **Transaction across goroutines (D1).** `store.Turn` is opened on the actor goroutine and used from the loop goroutine while the actor goroutine waits. Check that nothing in `pkg/store` assumes goroutine identity (for example thread-bound SQLite connections or `runtime.LockOSThread`; `pkg/store` has no `LockOSThread` today).
2. **Settling outside a turn (D2).** Any go-go-goja module that settles promises some other way than through runtimebridge's owner would bypass the adapter. Each asynchronous module needs a review before it is bridged.
3. **Two goroutines per actor.** With many stores active, goroutine count doubles. Actors retire after 60 s idle, so the steady state is bounded by active stores. Measure in phase 3.
4. **Binary size.** go-go-goja's engine compiles in all its default modules (and `mattn/go-sqlite3`, which slop already uses). Measure, and consider an upstream change to make module registration opt-in.
5. **Behavioural drift in goja_nodejs pieces.** By keeping slop's `require` and globals, the only goja_nodejs pieces in use are the event loop and the owner. Keep it that way unless a later decision adds more.
6. **Is it worth it?** If jsverbs inside actors is the only near-term need, U3 alone (a jsverbs invoke on a plain VM) delivers it without migrating. The migration pays off when go-go-goja modules, shared tooling or the inspector are wanted as well. Decide after phase 1, which is cheap and useful on its own: one VM entry point.

## 11. References

**slop** (this repository):
- `pkg/actor/actor.go` — limits `:32-34`; `Actor` `:110-153`; `build` `:170-233`; `requirer` `:281-334`; `loop` `:354-394`; `handle` `:396-494`; `park` `:93-97`, `rootOr` `:496-507`; `continueWith` `:509-516`; `io` `:518-541`; `crashed` `:543-557`.
- `pkg/actor/modules.go:27-129` — `use()` and the helpers modules call.
- `pkg/actor/catalog.go` — module classes and the catalog; `pkg/actor/registry.go` — provided modules.
- `pkg/actor/database.go:147-170` (savepoints per turn), `memfs.go:94-110` (the `fs` journal per turn), `express.go` (route registration while loading).
- `pkg/host/*_test.go` — the actor suites listed in section 9; `pkg/host/db_bench_test.go`.
- `ttmp/2026/11/05/SLOP3-012…/design-doc/01-…` §16-17 — why slop reimplemented `database` and `express` instead of importing go-go-goja.

**go-go-goja** (`~/code/wesen/go-go-golems/go-go-goja`, `e9bc789`):
- `pkg/engine/factory.go:40-60` (builder), `:184-292` (`NewRuntime`); `pkg/engine/runtime.go:20-47` (default module imports, `Runtime`); `pkg/engine/options.go:59-90`; `pkg/engine/module_middleware.go`; `pkg/engine/module_specs.go:164` (data-only set); `pkg/engine/performance.go` (performance and console timers).
- `pkg/runtimeowner/types.go`, `runner.go:90-230` — `Call`, `Post`, re-entrancy, panic recovery.
- `pkg/runtimebridge/runtimebridge.go` — the owner subset modules use.
- `modules/express/express.go:69-87` — an adapter between owner interfaces.
- `pkg/jsverbs/runtime.go:48-70` — `InvokeInRuntime` (uses `Owner.Call` and `Require.Require`).

**SLOP3-016:** `design-doc/01-…` §6.12 (app verbs with jsverbs), diary steps 3-4.

## 12. As built (phases 0–4): where the implementation differs

The code is in go-go-golems/go-go-goja#107 (U1–U4) and PR #38 (phases 1–4). The diary is `reference/02-diary-actor-vm-migration.md`. Differences from this design:

- **D1, one host run per whole event.** One `host.Run` wraps the whole event, the store transaction (`store.Do`) included, not only the JavaScript. A turn's transaction therefore stays on the loop goroutine; only activation's setup crosses goroutines.
- **D5, globals in `load`.** slop's globals are still installed in `load`, not by a runtime initializer. They close over the actor, which does not exist yet when the factory builds a runtime.
- **D4/5.5, bridged modules.** `yaml`, `crypto` and `events` from go-go-goja and `buffer` from goja_nodejs are catalog modules of class data (`pkg/actor/bridge.go`).
  - `crypto` returns Buffers, which goja_nodejs finds through `require('buffer')`, so slop's `require` answers `buffer`. There is still no global `Buffer`.
  - A new `Module.Plain` flag hands `events` and `buffer` to the app unwrapped, so their constructors work. Their calls are therefore not metered. Only modules that need no grant may be plain.
  - The four names are reserved: they resolve before an app's own files.
- **Turn owner, as designed (D2).** A settlement from a module's own goroutine is refused and logged. Asynchronous go-go-goja modules stay unbridged until the owner can tell which event a settlement belongs to.
- **Pre-existing race fixed on the way.** `kernel.activate` calls `OnActivated` after its turn, outside the store's serialization. A request that raced a background activation could build the actor, and the late `OnActivated` then stopped it. `onActivated` now stops only an actor of an older version (`pkg/actor/manager.go`). It had made `TestActorCrashPath` flaky in both modes.
- **Dependency.** Until #107 is merged and tagged, `go.mod` replaces go-go-goja with the wesen fork at the PR's head. The release binary grows 1.8%.
- **Measurements (phase 3):**
  - per-entry overhead: 2.3 ns direct, 6.4 µs engine;
  - empty action: 118–131 µs direct, 100–126 µs engine;
  - action with one write: 310–331 µs direct, 338–409 µs engine;
  - per live actor: 1 goroutine and ~30 KiB direct, 2 goroutines and ~48 KiB engine;
  - an endless loop is interrupted at the turn limit in both modes.
- **Phase 5 (jsverbs in actors) is not done.** App verbs run on the server through `app.verb` in a fresh runtime outside the actor (SLOP3-016 phase 5b), which MCP needed. Running them inside an actor turn remains optional.
- **Phase 6 (engine by default) is blocked on:**
  1. #107 merged and tagged;
  2. the engine-mode CI job seen green;
  3. a staging soak with `actors.runtime: engine`.

## 13. As built (phase 6): engine by default

PR #40. Of the three blockers in §12, the first two are met, and the user waived the third:
1. #107 is merged. slop takes go-go-goja from upstream at the merge commit (`9d7ede7`, a pseudo-version), with no fork `replace`. The merge commit's tree equals the fork commit 0d995b4. A tag can replace the pseudo-version whenever go-go-goja cuts one.
2. The engine-mode CI job was green on #39.
3. There is no staging environment. The user decided to switch anyway, so production is the soak, and `actors.runtime: direct` in `slop.yaml` is the way back without a new image.

Changes:
- `actors.runtime` defaults to `engine`, and an empty `Manager.Runtime` means engine. `direct` stays for one release.
- CI runs `go test ./...` on engine, then `SLOP_TEST_ACTORS_RUNTIME=direct go test ./pkg/host/`, the reverse of before.
- The race run in engine mode (§9) found a race that is not specific to the engine runtime. The manager's sample backend (`Manager.LLM`) was a plain field. The host sets it during `Build`, when actors can already run because the system follower starts them, and tests set it after their fixtures had started actors. It is now behind a lock (`SetLLM`, `LLM()`).
- Measurements, repeated (busy machine), direct vs engine:
  - empty action: 186 vs 176 µs;
  - one write: 534 vs 597 µs;
  - `Later` continuation: 230 vs 258 µs;
  - per live actor: 1 goroutine and 33.8 KiB vs 2 goroutines and 53.7 KiB.

Still open: phase 5 (jsverbs inside the actor turn, optional), and removing `directHost` one release after #40 ships.
