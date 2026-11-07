---
Title: 'Diary: actor VM migration'
Ticket: SLOP3-016
Status: active
Topics:
    - apps
    - collaboration
    - architecture
    - frontend
    - backend
    - agents
    - security
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/actor/actor.go
      Note: build/load and handle/turnFor through the host
    - Path: repo://pkg/actor/host.go
      Note: vmHost, directHost, enter, limited, release (phase 1)
    - Path: repo://pkg/actor/manager.go
      Note: activate/setup through the host; Around and TurnLimit hooks
    - Path: repo://pkg/host/actor_host_test.go
      Note: TestActorHostEntries (direct and hand-off)
ExternalSources: []
Summary: "Working record of the actor VM migration (design doc 02): phase 1, every VM entry through a host."
LastUpdated: 2026-11-07T14:18:02.172386856-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary: actor VM migration

## Goal

The working record of the actor VM migration in SLOP3-016 (design doc 02, "migrating the actor VM to a go-go-goja engine runtime"): what was changed, in which order, with what evidence. The Pinboard work has its own diary, `01-diary.md`.

## Context

Design doc 02 plans seven phases. Phase 0 is upstream work in go-go-goja (U1, U2). Phase 1, recorded here first, needs no go-go-goja: it puts every entry into an actor's VM behind one interface, with today's behaviour as the only implementation, so that phase 2 can add an engine-backed implementation behind a flag.

## Step 1: Phase 1, every VM entry through a host

This step adds `vmHost` and `directHost` to `pkg/actor`, and routes the three places where Go enters an actor's VM through `host.Run`. It also adds a manager hook, `Around`, that sees every entry, and a test that runs an actor through every kind of entry: once directly, and once with each entry handed to another goroutine as a go-go-goja owner would. There is no behaviour change: the whole suite passes unchanged.

### Prompt Context
**User prompt (verbatim):** "Ok, do the tickets, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Implement the SLOP3-016 tasks. This fork's share: actor VM migration phase 1 (task `t:cfik`): the `vmHost` interface and `directHost`, all VM entry points through `host.Run`, no go-go-goja dependency, no behaviour change; a branch pushed, no PR yet.
**Inferred user intent:** Make the actor runtime replaceable without risk, as the first step towards running actors on go-go-goja.
**Commit (code):** `614eff8` — "actor: every VM entry goes through a host (SLOP3-016 actor VM phase 1)"; `fc143e6` — "actor: a per-manager turn limit; the host test no longer changes the global" (branch `task/slop3-016-actor-host`)

### What I did
- Made a worktree from `origin/main` (`f4cc9d2`), branch `task/slop3-016-actor-host`.
- Inventoried every place that touches an actor's VM (`grep 'a\.vm\b|\.VM()'` over `pkg/actor` and `pkg/doors/actors`, then every helper that reads the VM: `export`, `toJS`, `asError`, `jsError`, `errValue`, `throw`, `ctxObject`, `fn`, `def`). Line numbers are from `origin/main`:

  | # | Entry from Go | Where (before) | Reached from |
  |---|---|---|---|
  | 1 | build: `goja.New()`, globals, `Date.now`, `RunScript(actor.js)` under an interrupt timer, `mergeRoutes`, `readShape` | `actor.go:170-232`, `express.go:84-111`, `actor.go:235-279` | `manager.go:188` (`get`, a caller's goroutine), `manager.go:402` (`activate`, inside the kernel's activation turn) |
  | 2 | activation: `ctxObject`, `setup` and `smoke` under interrupt timers, promise states, `def.every` read for alarms | `manager.go:405-470` | `kernel/apps.go:191` (`k.Activate`, the kernel's turn on the caller's goroutine) |
  | 3 | a turn: `ctxObject`, interrupt timer, `ev.run`, savepoints, root promise; **after the commit** `asError`/`jsError` (read exception objects), `export` of the result, root promise state | `actor.go:396-494` | `loop` on the actor goroutine (`actor.go:354-393`) |

  Everything else runs inside one of these three. The `ev.run` closures: actions (`manager.go:518-523`), routes (`:620-627`), reactors (`:705-711` → `react` `:724-764`), alarms (`Fire` `:887` → `alarm` `:892-947`), system reactors (`sysreact.go:85-150`), continuations (`continueWith` `actor.go:511-514`). Module code runs inside turns or the load: `io` (`actor.go:518-541`), `modules.go`, `catalog.go:286`, `database.go:51,104`, `express.go:35-41`, `storage.go:43-65`, `pathmod.go`, `memfs.go:283,456-468`, and the door's modules (`pkg/doors/actors/platform.go:25`, `sample.go:57,79`, `room.go:13,24`, `modules.go:54,158`).

  Goroutines other than the actor's that never touch the VM: the I/O worker in `io` (`actor.go:527`, it only pushes a `cont` event), `onCommit` (`manager.go:695`, reads the Go copy `a.keys`), the due-alarm check in `alarm` (`manager.go:938`), the system follower (`sysreact.go:34`), `push` starting an actor (`inbox.go:42`), and `Call`/`MatchRoute`/`Actions`/`mayCall`, which read the Go copies `groups`, `routes`, `requires` made at build.
- Wrote `pkg/actor/host.go`:
  - `vmHost` (`VM`, `Run`, `Interrupt`, `ClearInterrupt`, `Close`) and `directHost`;
  - `Actor.enter(ctx, op, fn)`: `host.Run`, through `Manager.Around` when set;
  - `Actor.limited(reason, fn)`: arms the turn limit through the host, stops and clears it after;
  - `Actor.release()`: closes the host (nil-safe).
- `actor.go`: `Actor.host`; `build` makes the host and runs `Actor.load` (the old body) as the `"load"` entry; `loop` defers `release`; `handle` runs the whole event as one `"turn <kind>"` entry (the old body is now `turnFor`), and replies `actor_error` if the host cannot run it at all.
- `manager.go`: `activate` runs the old tail, now `Manager.setup`, as the `"setup"` entry and releases the activation's throwaway actor; `get` releases a build it discards (stale generation, or someone else's build won); `Manager.Around` hook.
- Test `pkg/host/actor_host_test.go`, `TestActorHostEntries`: an actor with setup, an action, an action that awaits `time.sleep`, an HTTP route, a `doc:items/*` reactor, an `every` alarm and an endless loop. It checks the results and that the entries `load`, `setup`, `turn action`, `turn cont`, `turn http`, `turn reactor`, `turn alarm` all went through the host. It runs twice: `handoff=false`, and `handoff=true`, where `Around` runs each entry on a new goroutine and waits for it, carrying a panic back to the caller.

### Why
- **The whole event is one `Run`, not only the part inside `store.Do`.** Doc 02 (§5.1, §5.6) put `host.Run` inside `store.Do`. But `handle` reads the VM after the commit too: it exports the result, reads the state of the root promise, and turns a thrown exception into an error (`asError` → `jsError` reads `message` and `code` from the exception object). With `Run` inside `store.Do`, one event would need two or three `Run`s, each a goroutine hand-off on the engine host. With `store.Do` inside `Run`, there is one hand-off per event, and a turn's transaction is opened, used and committed on one goroutine. Design risk 1 ("transaction across goroutines") then applies only to activation, where the kernel opens the turn.
- **`Around` instead of an injectable host:** `vmHost` is unexported and the actor tests live in `pkg/host`, which cannot name it. A hook with no package types is enough to count entries and to simulate a hand-off, and phase 3 can use it for measurements. It sits with the manager's other host hooks (`Policy`, `LLM`, `Secret`, `Grant`).
- **`Manager.TurnLimit`:** phase 2's parity tests need the interrupt in both modes (doc 02 §9, "an infinite loop is interrupted … three times marks the actor broken"), and a 5 s loop per case would slow the suite; a per-manager limit is race-free where the package variable is not.
- **`release` everywhere a runtime is dropped:** a no-op for `directHost`, but a go-go-goja runtime has a loop goroutine to stop; finding these places now keeps phase 2 small.

### What worked
- `go build -buildvcs=false ./...`, `go vet ./pkg/actor/`.
- `go test -buildvcs=false ./... -count=1`: all packages pass (`pkg/host` in 19.3 s).
- `TestActorHostEntries`: both variants pass (0.51 s and 0.46 s).
- `golangci-lint run --allow-parallel-runners ./...`: 0 issues; `golangci-lint fmt --diff`: nothing.
- `go test -buildvcs=false -race ./pkg/host/ ./pkg/store/ -count=1` (after the fix below): `ok pkg/host 29.5 s`, `ok pkg/store 1.2 s`. This includes the hand-off variant, so a turn's JavaScript, its transaction and activation's crossing were checked by the race detector.

### What didn't work
- The first run of the new test failed: `docs.get map[path:stats/tick store:hosted]: 404 … no document stats/tick`. The helper used `h.call`, which fails the test on any non-200 answer, inside `waitFor`, where "not there yet" is expected. The helper now calls `api` and returns nil on a non-200.
- **The race detector found a race in my test, not in the actor.** The first `-race` run failed with `WARNING: DATA RACE`: `Write at … by goroutine 3569: TestActorHostEntries.func1.1() actor_host_test.go:63` (the `Cleanup` restoring `actor.TurnLimit`) against `Previous read … by goroutine 3704: (*Actor).turnFor.func1() actor.go:452` (a turn reading the limit). The test had set the package variable to 300 ms so that its endless loop would not take 5 s. Every running actor reads that variable in every turn, and the test's HTTP round trips give the race detector no happens-before edge between them, so any later write to it is a race. The fix, `fc143e6`, is a per-manager `Manager.TurnLimit` (0 means the package's), set before actors start. The timeout message now names the limit in force: "turn took longer than 300ms" in the test, unchanged "5s" in production.
- `make lint` stopped with `Error: parallel golangci-lint is running` (another session's lint). `golangci-lint run --allow-parallel-runners` ran it.

### What I learned
- **`pkg/store` does not depend on goroutine identity.** It has no `runtime.LockOSThread`. The write side is one `*sql.Conn` (`store.go:78`), which any goroutine may use in turn. The SQLite authorizer is registered per connection (`store.go:94`) and reads the store's `cur` turn, not goroutine state. `Store.mu` is a plain `sync.Mutex` (`store.go:61`). The hand-off test exercises the one crossing that remains, activation's `setup` on another goroutine inside the kernel's turn, and passes.
- **Panics are part of the turn contract.** `store.doLocked` recovers a panic in the turn function and returns `turn panicked: …` (`turn.go:91-96`), and `handle` counts that string as a crash (`actor.go`, `strings.Contains(err.Error(), "turn panicked")`). With the whole event inside `Run`, that recover sits on the same goroutine as the JavaScript, whatever the host.

### What was tricky to build
- **Keeping the interrupt window identical.** The turn limit used to be armed inside `store.Do` after the ctx object was built and disarmed after the root-promise check. `limited` wraps exactly that span, so a turn's 5 s still exclude `BEGIN IMMEDIATE` and the ctx object, as before. The load and setup windows are likewise unchanged.
- **The host error path in `handle`.** `Run` can only fail without running the function on a host whose runtime is closed. The reply then goes to the event that waits, which for a continuation is the parked event (`ev.parent.park.ev`), not the continuation. With `directHost` the path is unreachable.

### What warrants a second pair of eyes
- `handle`/`turnFor` in `pkg/actor/actor.go:414-520`: the move of the old body into `turnFor` is mechanical, but check that the settle/park logic still reads `pk` and `ctxObj` as before.
- `Manager.TurnLimit` and `Manager.Around` are exported fields read by actor goroutines without a lock; they are safe only when set before any actor starts, as their comments say.
- `Manager.setup` (`manager.go:430-…`): it uses `a.st.ID` where the old code used `r.Store`; both name the same store (`m.K.Store(ctx, r.Store)`).

### What should be done in the future
- **Phase 2 (`engineHost`):**
  - `Run` must carry a panic from the loop goroutine back to the caller (re-panic, as the test's hand-off does), or return an error the callers treat the same way. Otherwise a panic in `setup` stops being a rolled-back activation, and a panic in a turn could kill the process if the owner does not recover it.
  - `Close` must be idempotent and safe after the loop has stopped: `release` is called from `loop`'s defer, from `get` for discarded builds, and from `activate`.
  - `Around` runs inside `Run`, so on the engine host it runs on the loop goroutine.
- **Hook latency for phase 3:** `Around` can time each entry by op; a benchmark of an empty action in both modes gives the hand-off cost.
- **Doc 02 needs updating** (§5.1, §5.6, D1's consequences, §10 risk 1): one `Run` per event wraps `store.Do`; only activation crosses goroutines.

### Code review instructions
- Start with `pkg/actor/host.go`, then `handle`/`turnFor` and `build`/`load` in `pkg/actor/actor.go`, then `activate`/`setup` and `get` in `pkg/actor/manager.go`.
- Validate:
  ```sh
  go test -buildvcs=false ./pkg/host/ -run TestActorHostEntries -count=1 -v
  go test -buildvcs=false ./... -count=1
  go test -buildvcs=false -race ./pkg/host/ ./pkg/store/ -count=1
  ```

### Technical details
- The entries and their ops: `"load"` (`build` → `Actor.load`), `"setup"` (`activate` → `Manager.setup`), `"turn " + ev.kind` with kind `action`, `http`, `alarm`, `reactor`, `cont` (`handle` → `turnFor`). System reactors are `"turn reactor"`, as their event kind is `reactor`.
- The `vmHost` interface:
  ```go
  type vmHost interface {
  	VM() *goja.Runtime
  	Run(ctx context.Context, op string, fn func(vm *goja.Runtime) error) error
  	Interrupt(reason any)
  	ClearInterrupt()
  	Close(ctx context.Context) error
  }
  ```

## Step 2: Phase 2, the engine host behind `actors.runtime`

This step adds the second host: a go-go-goja `engine.Runtime` driven through its owner, chosen with `actors: {runtime: engine}` in `slop.yaml` (default `direct`). The whole `pkg/host` suite passes on both runtimes, and under the race detector on the engine. Phase 1's layout, where one host run wraps the whole event including `store.Do`, made this step small.

### Prompt Context
**User prompt (verbatim):** (the coordinator) "Continue with actor VM migration phases 2–4 on your branch task/slop3-016-actor-host … Phase 2: engineHost on engine.Runtime (Owner.Call per Run, panics carried back and re-raised, idempotent Close), the actor runtime factory with all default modules off (D6) and WithoutDefaultGlobals(all), slop's globals as before, turnOwner via WithRuntimeBridgeOwner whose Post becomes a continuation turn (D2), and the `actors.runtime: direct|engine` flag in slop.yaml (default direct). Run the actor/host suites in both modes (a mode switch in the test harness) and under -race in engine mode. Update your deviation note (host runs the whole event) accordingly."
**Assistant interpretation:** Implement doc 02 phase 2 against go-go-goja PR #107 (head `822e67c`), test both runtimes, keep the default `direct`.
**Inferred user intent:** Have a working, switchable engine runtime whose behaviour is provably the same as today's.
**Commit (code):** `1a50756` — "actor: an engine host on go-go-goja, behind actors.runtime (SLOP3-016 actor VM phase 2)"

### What I did
- Read the upstream API in the go-go-goja worktree (`pkg/engine/options.go`, `factory.go` `NewRuntime`, `runtime.go` `Close`, `pkg/runtimeowner/runner.go` `Call`/`Post`/`invoke`, `pkg/runtimebridge`).
- Added the dependency (see "What didn't work" for the replace).
- `pkg/actor/enginehost.go`:
  - `RuntimeDirect`/`RuntimeEngine`; `Manager.newHost(a)` picks the host from `Manager.Runtime`.
  - `engineFactory`: one `engine.RuntimeFactory` per manager, built on first use with `WithImplicitDefaultRegistryModules(false)`, `WithDataOnlyDefaultRegistryModules(false)`, `WithoutDefaultGlobals(engine.DefaultGlobals()...)`, no modules, no initializers.
  - `engineHost.Run`: `rt.Owner.Call(context.WithoutCancel(ctx), op, …)`; inside, it records the loop's goroutine id once, sets `inRun`, recovers a panic into variables that the caller re-raises after `Call` returns.
  - `Interrupt`/`ClearInterrupt` on `rt.VM`; `Close` is `rt.Close` (its `closeOnce` makes it idempotent).
  - `turnOwner` (installed with `engine.WithRuntimeBridgeOwner`): `Post` on the loop inside a run captures the handled event (`a.cur.ev`, or its parent for a continuation) and calls `a.continueWith`, exactly as `io` does; `Post` from any other goroutine is refused (`errOutsideTurn`) and logged. `Call` delegates to the engine's owner, but the function runs only while `inRun` is true.
  - `Actor.Runtime()` reports `direct` or `engine`.
- `build` makes the host through `m.newHost(a)` after the actor exists (the turn owner needs it).
- `pkg/config`: `Actors{Runtime}` (`actors.runtime`), default `direct`; `Load` rejects other values.
- `Manager.Runtime` is read from `k.Cfg.Actors.Runtime` in `actor.New`.
- Test harness: `SLOP_TEST_ACTORS_RUNTIME=engine` puts the harness's actors on the engine; `make test-engine`; CI's `test_command` also runs `pkg/host` in engine mode.
- New tests (`pkg/host/actor_runtime_test.go`):
  - `TestActorRuntimeGuarantees` (both runtimes): `setTimeout`, `setInterval`, `setImmediate`, `performance`, `Buffer`, `URL`, `process`, `console.time` are all undefined; `Date.now()` equals `ctx.now`; `console.log`/`console.warn` reach `app.logs`; `Actor.Runtime()` is the configured one.
  - `TestEngineModulePostIsATurn` (engine): a test module settles a promise through `runtimebridge.Lookup(vm).Owner.Post`; the action's writes before and after the `await` are two commits; a throw after the `await` rolls back only the second turn; a `Post` from a goroutine is refused with "outside a turn".
  - `TestActorCrashPath` (both): a Go panic in `setup` fails the activation (`app.status` broken, "panicked"); a Go panic in an action fails that turn and the actor goes on; an endless loop is interrupted at the (per-manager, 200 ms) limit; the third crash marks the actor broken.

### Why
- **`context.WithoutCancel` in `Run`:** `Owner.Call` returns early when its context ends, while the function keeps running on the loop. During activation the context is the request's; returning early would let the kernel finish a transaction the loop is still using. The turn limit bounds a run instead.
- **Panics re-raised, not returned:** `store.doLocked` turns a panic into "turn panicked" with a rollback, and `handle` counts that string as a crash. With the whole event inside `Run`, a turn's panic is still recovered by `doLocked` on the loop; only activation's `setup` (inside the kernel's turn, on the caller's goroutine) needs the re-raise, and the setup-panic test checks it.
- **The globals stay in `load`, not in a runtime initializer (D5 changed):** they close over the actor (`defineActor` sets `a.def`, `use` calls `a.module`, `console` writes `a.log`), and initializers receive only the VM; the factory is shared per manager. Installing them in `load` keeps one code path for both hosts. With `WithoutDefaultGlobals(all)` the engine installs only goja_nodejs's `require`, which `load` replaces with slop's (D4 holds).
- **Post from a goroutine refused:** the adapter cannot tell which event such a settlement belongs to. Refusing is loud; running it between turns would silently break the transaction guarantee. No bridged module posts from a goroutine (phase 4 bridges synchronous modules only).

### What worked
- `go build -buildvcs=false ./...`; `GOFLAGS=-buildvcs=false go list -deps ./cmd/slop | grep -c tree-sitter` → `0`.
- `go test -buildvcs=false ./... -count=1`: all pass (direct).
- `SLOP_TEST_ACTORS_RUNTIME=engine go test -buildvcs=false ./pkg/host/ -count=1`: `ok` (15.5 s; 19.3 s on a later run).
- `SLOP_TEST_ACTORS_RUNTIME=engine go test -buildvcs=false -race ./pkg/host/ -count=1`: `ok … 29.155s`.
- `go test -race` of the new tests in the default mode, and of `TestActorHostEntries` in engine mode: `ok`.
- `golangci-lint run --allow-parallel-runners ./...`: 0 issues.
- Binary size, `go build` plain: 59,786,440 → 60,835,864 bytes (+1,049,424, +1.8 %). With the Dockerfile's `-trimpath -ldflags "-s -w"`: 42,326,392 → 43,075,512 (+749,120, +1.8 %). Before = `fc143e6` (phase 1), after = this step.

### What didn't work
- `go get github.com/go-go-golems/go-go-goja@822e67c611a83c13917f63f167eba2deb1a191c9` failed: `invalid version: unknown revision 822e67c611a83c13917f63f167eba2deb1a191c9`, through the proxy and again with `GOPROXY=direct`. The commit is reachable in the parent repository only as `refs/pull/107/head`, which neither the proxy nor `go`'s git fetch looks at. It is a branch head on the `wesen` fork, which the proxy serves (`go: downloading github.com/wesen/go-go-goja v0.0.4-0.20261107193645-822e67c611a8`).
  - Instead of a local replace, `go.mod` requires `github.com/go-go-golems/go-go-goja v0.10.8-0.20261107193645-822e67c611a8` (a pseudo-version above the latest tag, `v0.10.7`; something in the graph already requires `v0.4.6`) and replaces it with `github.com/wesen/go-go-goja v0.0.4-0.20261107193645-822e67c611a8`. This builds anywhere the proxy is reachable, CI included. When #107 is merged and tagged, the replace goes and the require becomes the tag.
  - A first attempt with the bare hash as the replacement version was rejected: `replace github.com/wesen/go-go-goja: version "822e67c…" invalid: must be of the form v1.2.3`.
- `go mod tidy` also raised indirect versions that go-go-goja requires: `go-jose/v4` 4.1.4 → 4.1.8, `x/crypto` 0.57 → 0.58, `x/net` 0.60 → 0.62, `x/sys` 0.48 → 0.49, `grpc` 1.83.1 → 1.85.0, `protobuf` 1.36.11 → 1.36.12, genproto.
- `TestEngineModulePostIsATurn` first failed with `save made 3 commits, want 2`: the store's lazy activation commit (`activated post@1`) fell inside the count. The test now counts only commits that wrote documents under `a/`.

### What I learned
- go-go-goja's owner identifies "already on the loop" by goroutine id, parsed from `runtime.Stack` (`runtimeowner/runner.go:286`). The engine host uses the same technique for `turnOwner.Post`, once per runtime for the loop and once per `Post`.
- `NewRuntime` with all defaults off still calls `reg.Enable(vm)`, so a global `require` exists until `load` replaces it.
- A commit on a store starts its actor (`onCommit` calls `m.Get` in a goroutine), so "live actors" in a test cannot be counted from store creation onwards (phase 3).

### What was tricky to build
- **Which goroutine may `Post`.** `inRun` alone is not enough: a module's goroutine could post while some *other* event's turn is running, and the adapter would attach the settlement to the wrong event. `onLoop` requires both `inRun` and the loop's goroutine id.
- **`turnOwner.Call`.** It must work inline for a module calling it inside a turn (the engine owner runs it at once on the loop, with the owner context), and must not run JavaScript between turns for a module calling from elsewhere (the engine owner would queue it on the loop, which runs it after the turn). Wrapping the function with an `inRun` check covers both: queued work runs when no turn is running, sees `inRun` false and fails.

### What warrants a second pair of eyes
- `pkg/actor/enginehost.go` as a whole, especially `Run` (the panic carry and `WithoutCancel`) and `turnOwner`.
- The `go.mod` replace to the fork: acceptable on a branch, must not be merged to `main` as is unless #107 stays unmerged for long.

### What should be done in the future
- Replace the fork replace with a go-go-goja tag once #107 is merged.
- Doc 02 updates (the coordinator's): one `Run` per event wrapping `store.Do`; D1's goroutine crossing only in activation; D5's globals in `load`; the fork replace.

### Code review instructions
- `pkg/actor/enginehost.go`, then `build` in `pkg/actor/actor.go`, `pkg/config/config.go`, the harness switch in `pkg/host/harness_test.go`, and `pkg/host/actor_runtime_test.go`.
- Validate:
  ```sh
  go test -buildvcs=false ./... -count=1
  SLOP_TEST_ACTORS_RUNTIME=engine go test -buildvcs=false ./pkg/host/ -count=1
  SLOP_TEST_ACTORS_RUNTIME=engine go test -buildvcs=false -race ./pkg/host/ -count=1
  GOFLAGS=-buildvcs=false go list -deps ./cmd/slop | grep -c tree-sitter   # 0
  ```

### Technical details
- `slop.yaml`:
  ```yaml
  actors:
    runtime: engine   # or direct (default)
  ```
- Deviation note, updated: the host runs the whole event (`handle` → one `Run` → `store.Do` inside). On the engine host a turn's transaction is opened, used and committed on the loop goroutine; only activation's `setup` runs on the loop inside a transaction the kernel opened on the caller's goroutine. The race detector found nothing in either layout.

## Step 3: Phase 3, measurements

This step measures what the engine costs. The short answer: about 6.4 µs per turn for the hand-off, which is lost in the noise of a 100–400 µs turn, one more goroutine and about 18 KiB more heap per live actor, and identical interrupt timing.

### Prompt Context
**User prompt (verbatim):** (the coordinator) "Phase 3: measurements in both modes — turn latency microbenchmark (empty action), db_bench_test.go, goroutines and memory per live actor, interrupt timing (5 s loop), crash path. Record numbers in your diary."
**Assistant interpretation:** Benchmarks for both runtimes, numbers recorded here.
**Inferred user intent:** Decide whether the engine is cheap enough to become the default.
**Commit (code):** `5e2a03f` — "actor: measurements of the two runtimes (SLOP3-016 actor VM phase 3)"

### What I did
- `pkg/actor/host_test.go`: `BenchmarkHostRun` (one empty `Run`) and `BenchmarkHostNew` (make and close a runtime), both hosts.
- `pkg/host/actor_bench_test.go`, `TestBenchActorRuntime` (`SLOP_BENCH=1`), both runtimes:
  - turn latency through `Manager.Call` (no HTTP): `noop` (empty action), `put` (one document write), `later` (awaits `time.sleep(0)`: two turns and a goroutine);
  - goroutines and heap of 200 live actors (all running, then all stopped with `Restart`, after GC);
  - an endless loop at the real 5 s limit.
- Ran `TestBenchPageDBQuery` (`db_bench_test.go`) in both modes.
- Machine: the development host, 8 CPUs (`GOMAXPROCS=8`), Go 1.26.6; other sessions were running, so absolute numbers are noisy.

### Why
- The host benchmark isolates the hand-off; the turn benchmarks show whether it matters next to SQLite.
- Stopping the actors gives their own cost: a commit on a store starts its actor, so counting from store creation measured nothing (the first run reported "+0 goroutines").

### What worked
Results (three runs of the turn benchmarks; `ns/op` ranges):

| Measure | direct | engine |
|---|---|---|
| `Run` with nothing to do | 2.2–2.5 ns, 0 allocs | 6,258–6,499 ns, 585 B, 14 allocs |
| make + close a runtime | 0.77–0.88 µs, 2,120 B | 31.5–35.8 µs, 24,304 B |
| turn `noop` | 117.7–130.5 µs | 100.1–126.1 µs |
| turn `put` (one write) | 309.8–330.6 µs | 338.0–409.0 µs |
| turn `later` (two turns) | 141.3–153.5 µs | 141.2–167.2 µs |
| allocations per `noop` turn | 26,916 B, 516 | 27,496 B, 530 |
| goroutines per live actor | 1.00 | 2.00 |
| heap per live actor (200 actors) | 30.2–31.1 KiB | 47.6–48.9 KiB |
| endless loop interrupted after | 5.001–5.004 s | 5.002–5.005 s |
| crash path (`TestActorCrashPath`, 200 ms limit) | 0.59 s | 0.43 s |

`TestBenchPageDBQuery` (page `db.query`/`db.get`, which do not involve actors): direct `query-own` 501.6 µs, `query-alias` 521.0 µs, `get-own` 24.0 µs, `get-alias` 121.3 µs; engine 475.2, 557.0, 29.8, 130.7 µs. Same allocations; the differences are noise.

### What didn't work
- The first version of the live-actor count measured from store creation and reported `+0 goroutines (0.00 each)`; see "Why".
- `benchActor` already exists in `workshop_module_test.go` (`vet: … benchActor redeclared in this block`); renamed to `runtimeBenchActor`.

### What I learned
- The hand-off (6.4 µs, 14 allocations) comes from the owner: a result channel, a context with the owner value, goroutine-id parsing on the loop (`runtime.Stack`), `runtimebridge.WithCallContext`, plus `context.WithoutCancel`. A turn spends 100 µs or more in SQLite (`BEGIN IMMEDIATE`, the log row, `COMMIT`), so the hand-off is at most a few percent, below the run-to-run noise.
- Interrupt timing is the same: the timer calls `vm.Interrupt` from its own goroutine on both hosts.

### What was tricky to build
- Making the live-actor numbers mean something: GC twice and wait 300 ms before each reading so that stopped loops have exited and released their runtimes.

### What warrants a second pair of eyes
- The `put` engine range includes one 409 µs run; the other two were 338 and 389 µs. A dedicated quiet machine would tell whether there is a real ~10 % difference on write turns.

### What should be done in the future
- For phase 6, repeat `TestBenchActorRuntime` on a quiet machine, and watch goroutine counts on production (2 per active store) after a switch.

### Code review instructions
- `pkg/actor/host_test.go`, `pkg/host/actor_bench_test.go`.
  ```sh
  go test -buildvcs=false ./pkg/actor/ -run '^$' -bench BenchmarkHost -count=3
  SLOP_BENCH=1 go test -buildvcs=false ./pkg/host/ -run TestBenchActorRuntime -count=1 -v
  ```

### Technical details
- Raw outputs were kept in the scratchpad during the session (`slopvm-bench1.txt`, `-bench2`, `-bench3`, `-bench-host`); the table above has every number from them.

## Step 4: Phase 4, go-go-goja's data modules in the catalog

This step bridges three go-go-goja modules, `yaml`, `crypto` and `events`, into slop's module catalog as data-class modules, plus goja_nodejs's `buffer`, which `crypto` needs. They work with `use()` and `require()` on both runtimes: the bridge only calls a module's `Loader` on the actor's VM, so it does not depend on the engine.

### Prompt Context
**User prompt (verbatim):** (the coordinator) "Phase 4: bridge synchronous data modules from go-go-goja (yaml if present, crypto, events — check each for globals and event-loop use) into slop's catalog with their TypeScript/docs, classes data; tests that apps can require/use them in both modes."
**Assistant interpretation:** Doc 02 §5.5's `bridged()` for the three modules, after reading each for side effects.
**Inferred user intent:** The first concrete gain of the migration: go-go-goja's library available to app actors.
**Commit (code):** `15db2e2` — "actor: go-go-goja's yaml, crypto and events in the module catalog (SLOP3-016 actor VM phase 4)"

### What I did
- Read the three modules at `822e67c` (`modules/yaml/yaml.go`, `modules/crypto/crypto.go`, `modules/events/events.go`) and goja_nodejs's `buffer` (`buffer.go` `mod`, `WrapBytes`, `Require`) and `require.Require`.
- `pkg/actor/bridge.go`:
  - `bridged(mod, class, plain, extraTS...)`: `Name`/`Doc` from the module; `Load` makes `{exports: {}}`, calls `mod.Loader(vm, obj)` and returns `obj.exports` (read after the call, because `events` replaces `exports` with its constructor).
  - `typeScriptOf`: renders the module's `TypeScriptModule()` descriptor with go-go-goja's `tsgen/render.Bundle` and strips the header; crypto gets an `import { Buffer } from "buffer";` line, since its descriptor names `Buffer`.
  - `registerBridged`: `yaml`, `crypto`, `events` from `modules.DefaultRegistry` (their packages are blank-imported), and `buffer` loaded with `buffer.Require(vm, obj)`, with a hand-written declaration of the methods goja_nodejs actually has.
- `Module.Plain` (`pkg/actor/catalog.go`): a default-class module whose object is given to the app unwrapped. `events` and `buffer` are plain.
- `reservedModules` gains `yaml`, `crypto`, `events`, `buffer`.
- `doc/design/slop-v3.md` §7's capability table lists the four modules. This is the repository's platform reference, not a SLOP3-016 design doc.
- Test `pkg/host/bridged_modules_test.go`, `TestBridgedModules`, on both runtimes:
  - `yaml` parse, stringify and validate;
  - `EventEmitter` `on`, `once`, `emit`, and the named export;
  - `crypto.randomUUID`, `randomBytes(8)` (a `Buffer`), `createHash('sha256')` with `digest('hex')` and `digest()`;
  - `require('buffer').Buffer.from('hi').toString('base64')`;
  - `require('yaml') === use('yaml')`, and `typeof Buffer` is still `undefined`;
  - `app.modules` lists all four as class `data`, on by default, with a `declare module` block each.

### Why
- **`buffer` as a module, not a global:** goja_nodejs's `WrapBytes` looks for a global `Buffer` and, failing that, calls the global `require('buffer')` (`buffer.go` `mod`). In an actor the global `require` is slop's, so answering `buffer` there is enough. Adding a global `Buffer` would change what every existing actor sees, and `TestActorRuntimeGuarantees` checks that it does not.
- **`Plain`:** `intercept` replaces every function of a module object with a Go wrapper, to count calls and to re-check grants per call. A wrapper is not a constructor, so `new EventEmitter()` and `Buffer`'s prototype chain would break. Only default-class modules may be plain, because the wrapper is also where a withdrawn grant takes effect for scoped and trusted modules.
- **Reserved names:** scripts written for go-go-goja `require('yaml')` and the others by bare name. No app or example in the repository has a file with those names (`find apps examples -name …` found none).

### What worked
- `TestBridgedModules` passes on both runtimes.
- `go test -buildvcs=false ./... -count=1`: all pass.
- `SLOP_TEST_ACTORS_RUNTIME=engine go test -buildvcs=false ./pkg/host/ -count=1`: `ok … 17.971s`.
- `SLOP_TEST_ACTORS_RUNTIME=engine go test -buildvcs=false -race ./pkg/host/ -count=1`: `ok … 32.407s`.
- `golangci-lint`: 0 issues after one fix (below). No tree-sitter: `go list -deps ./cmd/slop | grep -c tree-sitter` → `0`.
- Binary after this step: 60,878,808 bytes plain, 43,108,344 with `-trimpath -ldflags "-s -w"`. Against phase 1 (59,786,440 and 42,326,392): +1,092,368 (+1.8 %) and +781,952 (+1.8 %).

### What didn't work
- `TypeError: Object has no member 'isBuffer'`: goja_nodejs's `Buffer` has only `from`, `alloc` and `concat` as statics. The test now uses `instanceof`, and the declaration lists only what exists. Its codecs are `utf8`/`utf-8`, `hex` and `base64`, so the declared `Encoding` has only those.
- `yaml.stringify({…, n: 42})` gave `"n": 42`: yaml.v3 quotes `n`, a YAML 1.1 boolean. The keys also come out sorted, because the value passes through a Go map. The test uses `count` and expects sorted keys.
- Lint: `QF1001: could apply De Morgan's law` on `!(mod.Plain && mod.Class.Default())`, rewritten as `!mod.Plain || !mod.Class.Default()`.

### What I learned
- go-go-goja's modules depend on goja_nodejs through the global `require` in places one does not see from their own code (`crypto` → `buffer.WrapBytes` → `require('buffer')`). Bridging a module means reading its dependencies too.
- `yaml.stringify` is not order-preserving (maps), which matters for apps that diff YAML.

### What was tricky to build
- Making `crypto`'s `Buffer` path work without the global: the chain is `WrapBytes` → `mod(r)` → `r.Get("Buffer")` (nil) → `require.Require(r, "buffer")` → global `require` (slop's) → `reservedModules["buffer"]` → `a.module("buffer")` → the catalog module, which carries goja_nodejs's API symbol, so `WrapBytes` finds its fast path.

### What warrants a second pair of eyes
- `Module.Plain` and the changed condition in `catalogModule` (`pkg/actor/catalog.go`): plain modules skip call counting, so `app.modules` shows no calls for `events` and `buffer`.
- The reserved names: an app that ships its own `events.js` and requires it by bare name would now get the module. Relative requires (`./events`) are unaffected.

### What should be done in the future
- **Phase 5:** jsverbs inside actors (`InvokeInVM`).
- **Phase 6 (the default switch) is blocked or pending on:**
  1. go-go-goja #107 merged and tagged, and the fork replace removed from `go.mod`;
  2. CI running `pkg/host` in both modes (the workflow's `test_command` now has `&& SLOP_TEST_ACTORS_RUNTIME=engine go test ./pkg/host/`, not yet seen running in CI);
  3. a run on a staging or production-like server with `actors.runtime: engine`: two goroutines and about 48 KiB of heap per live actor instead of one and about 30 KiB;
  4. the doc 02 updates (one run per event; globals in `load`; the fork replace);
  5. optionally, the write-turn benchmark on a quiet machine (`put`: 310–331 µs direct, 338–409 µs engine).
- Asynchronous go-go-goja modules (`fetch`, `timer`, `database` with its own handle) stay unbridged. Any of them needs a way to tell the turn owner which event it belongs to before it can be offered (a `Post` from a goroutine is refused today).

### Code review instructions
- `pkg/actor/bridge.go`, then the `Plain` field and its use in `pkg/actor/catalog.go`, `reservedModules` in `pkg/actor/database.go`, `pkg/host/bridged_modules_test.go`.
  ```sh
  go test -buildvcs=false ./pkg/host/ -run 'TestBridgedModules|TestModuleCatalog' -count=1 -v
  ```

### Technical details
- In an actor:
  ```js
  const yaml = require('yaml'), crypto = require('crypto'), EventEmitter = require('events');
  const { Buffer } = require('buffer');
  crypto.createHash('sha256').update('slop').digest('hex');   // 64 hex characters
  crypto.randomBytes(8) instanceof Buffer;                    // true
  ```
