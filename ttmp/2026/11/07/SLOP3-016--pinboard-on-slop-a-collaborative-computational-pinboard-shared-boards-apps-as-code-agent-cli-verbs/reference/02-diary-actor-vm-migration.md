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
