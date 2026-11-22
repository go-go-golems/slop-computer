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
LastUpdated: 2026-11-22T17:00:00-05:00
WhatFor: Reviewing the guard, grant and reducer changes, and keeping them in place.
WhenToUse: Before adding an httpapi route, a runtime capability, or agent client logic.
---

# Design: making the review's bug classes impossible to express

**Status:** implemented. Change 1 in pinocchio cedda17, change 2 in slop c7a9d79, change 3 in slop 6a62fcb.

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
