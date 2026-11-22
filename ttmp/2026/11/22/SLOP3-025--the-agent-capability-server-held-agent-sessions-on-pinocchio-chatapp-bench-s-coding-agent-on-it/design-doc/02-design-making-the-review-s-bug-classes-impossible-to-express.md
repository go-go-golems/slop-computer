---
Title: "Design: making the review's bug classes impossible to express"
Ticket: SLOP3-025
Status: active
Topics:
    - agent
    - runtime
    - chatapp
DocType: design-doc
Intent: long-term
Owners:
    - manuel
RelatedFiles: []
ExternalSources: []
Summary: Three structural changes after the review of pinocchio#221 and slop-computer#56. httpapi reaches sessions only through a per-principal guard; each runtime capability gets a consent bound to its own name; the agent runtime follows runs with one reducer over the snapshot and the events.
LastUpdated: 2026-11-22T18:30:00-05:00
WhatFor: Reviewing the guard, grant and reducer changes, and keeping them in place.
WhenToUse: Before adding an httpapi route, a runtime capability, or agent client logic.
---

# Design: making the review's bug classes impossible to express

**Status:** changes 1–3 implemented (pinocchio cedda17; slop c7a9d79, 6a62fcb). Changes 4–6 (section 7, from the
second review) in progress.

## 1. Why

The review of pinocchio#221 and slop-computer#56 found four bugs, and all four are fixed. Each one was possible
because the code let it be written:

| Bug | What allowed it |
|---|---|
| Anonymous `GET /sessions` listed everyone's sessions | handlers called the session store directly, and only some of them called the authorizer |
| A deleted id could be re-created and its history read | id lifetime was the store's business; no layer said that ids are permanent |
| An agent-only app could never send | `consent("sample")` is a free string, so any module can name any permission |
| `send()` hung after a reconnect | the client had two paths, one for live events and one for snapshots, and the snapshot path ignored runs |

The fixes closed the four instances. This design closes the classes: after it, a route cannot reach session metadata
without authorization, a capability cannot ask for another capability's consent, and the agent client has one code
path for "how did my run end".

## 2. Change 1: the session guard (pinocchio `pkg/chatapp/httpapi`)

### Rule

Request handlers never hold a `sessions.Store`. They hold an `Access`, a guard bound to the request's principal.
Every operation on an `Access` authorizes before it touches the store.

### Package and types

A new internal package, `pkg/chatapp/httpapi/internal/sessionguard`, owns the principal, action and authorizer types.
httpapi re-exports them as aliases, so its public API does not change.

```go
package sessionguard

type Principal struct{ ID string; Attrs map[string]string }
type Action string // create, list, read, send, stop, delete, tools
type Authorizer func(ctx context.Context, p Principal, a Action, s *sessions.Info) error
type CreateHook func(ctx context.Context, p Principal, info *sessions.Info) error

type Guard struct { /* store, authorize, createHook, autoCreate: unexported */ }
func New(store sessions.Store, authorize Authorizer, opts ...Option) *Guard
func (g *Guard) For(p Principal) Access
func (g *Guard) Unchecked() sessions.Store // only httpapi.Server.Sessions(), for embedding programs

type Access struct { /* guard, principal */ }
func (a Access) Create(ctx, req sessions.Info) (Session, error) // authorize create; Owner := p.ID; hook; store; read back
func (a Access) Open(ctx, id string, action Action) (Session, error) // get (or auto-create); authorize action
func (a Access) List(ctx, f sessions.Filter) ([]sessions.Info, error) // authorize list; Owner := p.ID, AllOwners := false; each row authorized as a read

type Session struct { /* info, access, action */ } // only Access makes one
func (s Session) Info() sessions.Info
func (s Session) Update(ctx, fn func(*sessions.Info) error) error // only if opened for send, tools or stop
func (s Session) Delete(ctx) error                                // only if opened for delete
```

Errors are typed, and httpapi maps them to HTTP statuses: `ErrForbidden` (wrapped), `CreateRejectedError` (a
create hook's refusal, with its code), `sessions.ErrNotFound`, `sessions.ErrExists`.

### What enforces it

- **The compiler.** The store lives in an unexported field of `Guard`, in another package. The only exported way to
  get the store is `Unchecked()`.
- **A test.** `TestOnlySessionsReachesTheStoreUnchecked` walks httpapi's non-test files with `go/ast` and fails if
  `Unchecked` is called anywhere except `Server.Sessions`. httpapi no longer keeps a raw store field.
- **Types.** `Session` values come only from `Access.Open` or `Access.Create`. `Update` and `Delete` are methods on
  the authorized `Session`, never on an id, so mutating a session you were not authorized for cannot be written.

### Route mapping

| Route | Guard call |
|---|---|
| `POST /sessions` | `Access.Create` |
| `GET /sessions` | `Access.List` |
| `/sessions/{id}/*` (via `s.session(action, …)`) | `Access.Open(id, action)`; the handler gets the `Session` |
| websocket subscribe | `Access.Open(sid, ActionRead)` |
| title on the first message | `Session.Update` (opened for send) |
| `DELETE /sessions/{id}` | `Session.Delete` (opened for delete) |
| usage recording (engine, no request) | the raw store, wired once in `New` before the guard exists |

## 3. Change 2: a grant per capability (slop `web/runtime`)

### Rule

A capability's namespace is built with a `Grant` that is bound to its own name. Nothing else can ask for consent.

```ts
// consent.ts: the only module that knows permission states
export type Grant = { readonly name: string; consent(code?: string): Promise<void> };
export function grantFor(name: string): Grant;      // used by index.ts's resolve(name) only
export const permissions;                           // the public permissions namespace
export function initPermissions(h: Hello | null);

// index.ts
case "sample":   return sample(h, grantFor("sample"));
case "agent":    return agent(grantFor("agent"));
case "comments": return comments(h, grantFor("comments"));
```

`consent()` is no longer exported. `caps.ts` loses its permission state and its `consent`/`request` helpers, which
move to `consent.ts`. The `comments` factory, which lives in the same file as those helpers today, takes its grant
like the others.

### What enforces it

- **Exports.** `consent` and the state map are private to `consent.ts`.
- **A runtime test.** It reads every `src/*.ts` except `consent.ts` and `index.ts`, and fails on `grantFor(` or on an
  import of `consent.ts` other than the `Grant` type.

## 4. Change 3: one reducer for the agent client (slop `web/runtime/src/agent.ts`)

### Rule

The client keeps a local copy of the session's timeline entities. Snapshots replace the copy; UI events update it
through one function, `apply(event)`. Everything a caller waits for is derived from the copy after every change:

```text
apply(snapshot) | apply(event)
  → entities (ChatRun, ChatMessage segments, ChatFrontendToolCall)
  → settle(): for each pending send whose run id is known:
        text = the run's assistant segments, in creation order, joined by a blank line → onText when it changed
        ChatRun[runId].status terminal → resolve / reject with its code
  → tools(): every ChatFrontendToolCall requested and assigned to this page, not yet run → execute once
```

The run id comes only from the `202` (`messageId`). There is no "first `ChatRunStarted` after the POST" heuristic, and
no `ownedBy` prefix check. Events for a run that arrive before its `202` are kept in the copy, and `settle()` runs
again when the id arrives. A reconnect is a snapshot like any other: there is no recovery path of its own.

### Event → entity mapping (mirrors chatapp's projection for the kinds the client needs)

| Event | Entity update |
|---|---|
| `ChatRunStarted` | `ChatRun[id] = {status: running}` |
| `ChatRunFinished` / `Failed` / `Stopped` | `ChatRun[id].status = finished / failed / stopped` (+ `truncated`, `reason`, `code`, `error`) |
| `ChatTextSegmentStarted` / `Patch` / `Finished` | `ChatMessage[segmentId]`: text (append at `offset`, or replace), `parentMessageId` = the id before `:text:` |
| `ChatFrontendToolCallRequested` | `ChatFrontendToolCall[toolCallId] = {status: requested, executor, input, toolName}` |
| `ChatFrontendToolResultReceived` | `ChatFrontendToolCall[toolCallId].status = the result's status` |

## 5. Phases and tests

1. Guard (pinocchio). Tests: the existing auth tests unchanged; `Session.Delete` refused on a session opened for read
   (unit); the AST test.
2. Grant (slop runtime). Tests: an agent-only and a sample-only app (the existing tests); the source scan.
3. Reducer (slop runtime). Tests: the existing five, plus events that arrive before the `202`, and a tool call that
   is requested while the stream is down and assigned to this page (picked up from the snapshot).

## 6. Not covered

- Purging a deleted session's turns and timeline. It needs delete operations in the turn store and in sessionstream's
  hydration store.
- Other runtime capabilities that keep their own event logic (db, room). The reducer rule applies to agent only.

## 7. Second review: changes 4–6

The second Codex review found four more bugs. They fall into three classes, and each gets a structural fix.

| Bug | What allowed it | Change |
|---|---|---|
| pinocchio#221: `budget.tokensPerSession` is skipped when a session has no tools | the round guard is attached to geppetto's tool loop, not to the model call; with no tool registry, `enginebuilder` makes one plain call and never runs the guard | 4 |
| slop#56: two `send()`s without awaiting lose the first run | `send()` checks state, awaits consent, readiness and registration, and only then claims the run | 5 |
| slop#56: an abort during those awaits is ignored | the abort listener is installed after the awaits | 5 |
| slop#56: a tool result that fails to post is lost | running a tool and delivering its result are one step, and a failed delivery is dropped | 6 |

### Change 4: the round guard wraps the engine (pinocchio `pkg/chatapp`)

**Rule:** a run's guard runs before every model call of the run, whatever path geppetto takes.

chatapp no longer passes `ComposedRuntime.RoundGuard` to `enginebuilder.Builder`. It wraps the run's engine:

```go
type guardedEngine struct {
    inner engine.Engine
    guard toolloop.RoundGuard
    round int // model calls of this run so far; one guardedEngine per run
}

func (g *guardedEngine) RunInference(ctx, t) (*turns.Turn, error) {
    if err := g.guard(ctx, t, g.round); err != nil {
        return t, err // the turn so far stays the conversation (chatapp saves it)
    }
    g.round++
    return g.inner.RunInference(ctx, t)
}
```

The round index equals the loop's: calls are counted from 0, and the final answer at the limit is call
`maxRounds`, the index geppetto's loop passes. This is the same structure as slop's metered engine, which was not
affected by the bug. A guard error from the engine path reaches `decideOutcome` like any other engine error, so its
`CodedError` code (`quota_exceeded`) is kept.

Tests: in agentserver, a session over budget with no in-process tools and no browser tools fails its next message
with `quota_exceeded` without calling the engine (Codex's repro). The existing "budget stops between rounds" test keeps
passing.

A follow-up in geppetto: its builder should not drop the guard on the single-call path either. It is not needed here,
since chatapp no longer depends on that.

### Change 5: a send claims its run first and owns its lifecycle (slop `agent.ts`)

**Rule:** the first thing `send()` does is claim the session's run slot, synchronously, with a `Run` object. Nothing
awaits before that. The run's stage is explicit, and an abort is handled by the run at any stage.

```text
send():
  if #run → run_active          (synchronous: a second send is refused at once)
  run = new Run(stage: preparing); #run = run; listen for abort now
  await consent, readiness, registration       // each await is followed by "still mine and not aborted?"
  if aborted → settle cancelled (nothing posted)
  stage = posting; POST /messages → 202 {messageId} → stage = running, id = messageId
  abort while running → POST /stop; the ChatRun entity settles it (cancelled)
  abort while posting → settle cancelled once the 202 arrives, then POST /stop for that id
  409 / error → settle rejected (the slot is this run's, so clearing it cannot drop another run)
```

`#run` is cleared only by its own run's `settle`, which checks identity (`if (this.#run === run)`). Waiting for the
first snapshot becomes cancellable, because the wait races the run's abort.

Tests: two `send()`s without awaiting (the second is refused with `run_active`, the first resolves); an abort before
the first snapshot (no `/messages` is posted, the send rejects `cancelled`); an abort while the `202` is pending (the
send rejects `cancelled`, and `/stop` is posted).

### Change 6: tool results go through an outbox (slop `agent.ts`)

**Rule:** a tool runs once. Its result is kept in an outbox until the server has it, and the outbox is delivered from
`#derive`, the same place that decides which tools to run.

```text
#derive():
  for each ChatFrontendToolCall in the local copy:
    status requested, assigned here, not run → run it once; result → outbox[id]; deliver
    status requested, outbox[id] present, no delivery in flight → deliver again (after a reconnect)
    status not requested (the server has it, or gave up) → drop outbox[id]
deliver(id): POST /tools/results; 2xx or a 4xx (late, unknown, invalid) → drop outbox[id];
             network/5xx → keep, back off (200 ms × 2^tries, at most 5 s) and schedule a #derive for then
snapshot:    resets every backoff (the connection is back)
```

A tool's side effects therefore happen at most once, and its result is delivered at least once while the server still
waits for it. The server dedupes, since a second result for a call is refused.

Tests: a result post that fails at the network is retried after the next snapshot shows the call still requested,
without running the tool again; a call the server no longer waits for is not resent.

