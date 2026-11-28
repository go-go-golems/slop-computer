---
Title: 'Design: the agent capability on chatapp'
Ticket: SLOP3-025
Status: active
Topics:
    - llm
    - agent
    - runtime
    - bench
DocType: design-doc
Intent: long-term
Owners:
    - manuel
RelatedFiles:
    - Path: repo://pkg/doors/pages/agent.go
      Note: door checks and route
    - Path: repo://pkg/doors/pages/agent/meter.go
      Note: per-round ledger holds
ExternalSources: []
Summary: 'A second LLM capability next to sample(): claude.use(''agent'') gives a page server-held agent sessions (pinocchio chatapp/httpapi in-process) with page-executed tools, metered per model round in slop''s ledger; bench''s coding agent moves onto it.'
LastUpdated: 2026-11-22T09:00:00-05:00
WhatFor: Building and reviewing the agent capability and bench's move to it.
WhenToUse: Before changing pkg/doors/pages/agent, web/runtime/src/agent.ts, the /_rt/agent routes or bench's agent loop.
---

# Design: the agent capability on chatapp

**Status (2026-11-22):** implemented (phases 1–6) and checked end to end in bench on a local server with the fake
model. Differences from the plan below are listed in section 9.

## 1. Summary

slop offers pages one LLM capability today, `sample()`: one stateless, streamed model call, in which the page sends
the whole conversation every time and runs its own tools during the call. This ticket adds a second one,
`claude.use('agent')`. A page opens an **agent session** that lives on the server. It sends one message at a time,
the server keeps the conversation and runs the tool loop, and the page runs the tools it registered when the model
calls them. This is the shape homolog-bench's agent page has with `pinocchio agent serve`. Here the service runs
inside slop, and slop's view authentication, LLM policy and per-person token ledger apply to it.

The server side is pinocchio's `pkg/chatapp/httpapi` (since PIN-20261121, the one chat HTTP API), mounted on the
sandbox origin at `/_rt/agent`. slop supplies four things: the principal (from the view), the authorization (the
person's own sessions, in this app), the runtime of each message (engine from slop's model backend, the page's
system prompt, limits), and metering (a hold on the ledger before every model round, settled with the round's
usage).

bench, the coding agent, moves onto it. Its threads become agent sessions. It stops sending and summarizing its
own history, so prompt caching works across messages. `sample()` stays unchanged for everything else, including
bench's quick one-off calls.

## 2. Why not keep using sample() for bench

- **Cost and latency.** bench rebuilds the prompt every message: the guide (several thousand tokens), the history it
  keeps, and the project context. The history is rewritten when bench summarizes it, so the prefix changes and the
  provider's prompt cache misses. A server-held append-only conversation keeps the prefix stable.
- **Lifecycle.** A `sample()` call lives as long as one HTTP response. A stop is a client abort. A reload loses the
  call, and the page has no way to see "an answer is running".
- **Limits in one place.** Round limits, a final answer at the limit, tool timeouts and result cuts are chatapp
  mechanisms already. bench currently re-implements some of them in the page.

## 3. Architecture

```text
 page (sandbox origin)                         slop server
 ─────────────────────                         ────────────────────────────────────────────────
 claude.use('agent')                           pages.Door.serveAgentRoute (/_rt/agent/…)
   agent.open(id?, {system, tools, …}) ──POST /sessions──────▶ httpapi.Server
   s.send(prompt, {context}) ─────────POST /messages─────────▶   ├─ Authenticator: viewOf(r) → Principal{user, app, role}
   event stream (fetch, SSE) ◀────────GET /events─────────────   ├─ Authorizer: owner == user && labels.app == app
   tool.execute(input) on                                       ├─ CreateHook: labels.app, defaults, size checks
     ChatFrontendToolCallRequested                              ├─ Resolver: per message
   POST /tools/results ──────────────────────────────────────▶   │    engine  = meter(backend.Engine(tier, model, effort))
   s.stop() ──────────────────────────POST /stop─────────────▶   │    system  = session data.system
                                                                │    loop    = maxRounds, final answer at the limit
                                                                │    tools   = deadline + result cut around the bridge
                                                                ├─ Blocks: message context → a user block
                                                                └─ stores: SQLite in <data>/agent/
```

A metered engine wraps the backend's engine. Each `RunInference` is one model round:

```text
RunInference(ctx, turn):
    l := sampler.Check(payer, audience)                 // refuse: no access / budget used up
    hold := ledger.Reserve(payer, l.Budget, estimate(turn), maxOutput)   // quota_exceeded → coded error
    turn.InferenceConfig.MaxResponseTokens = min(maxOutput, hold.Output)
    out, err := inner.RunInference(ctx + usage sink, turn)   // the sink settles the hold with the round's usage
    meter.Close()                                       // no usage seen → charged in full (as sample does)
```

This keeps the ledger semantics of `sample()` (SLOP3-007): a hold before the provider is contacted, an output cap
the round cannot exceed, settlement with input + output tokens, and full charge for a round that reported no usage.

## 4. Server API

All routes are httpapi's, under `/_rt/agent` on the view's sandbox origin, with the view secret as bearer token
(the runtime's `request()`). Errors are `{error, code}`.

| Route | Notes |
|---|---|
| `POST /sessions {id?, title?, labels?: {tier, model, effort}, data?: {system, maxRounds, toolTimeout, maxTokens}}` | 201. `labels.app` and the owner are set by the server |
| `GET /sessions` | the person's sessions in this app (`?label=k:v`) |
| `GET /sessions/{id}` | `{session, running, snapshot}` |
| `DELETE /sessions/{id}` | |
| `POST /sessions/{id}/tools/manifest` | the page's tools for this connection; the last registrant runs them |
| `POST /sessions/{id}/messages {prompt, context?}` | 202; 409 `run_active` |
| `POST /sessions/{id}/stop` | |
| `GET /sessions/{id}/events` | SSE: snapshot, then UI events |
| `POST /sessions/{id}/tools/results` | `{toolCallId, toolName, status, result, error?, executor}` |

Limits set by slop (session data may lower them, not raise them): system prompt ≤ 256 KiB, message context ≤
64 KiB, `maxRounds` default 30 and at most 60, `toolTimeout` default 10 min and at most 30 min, tool result cut
16 000 characters.

Capability declaration: `"agent": {}` in the app manifest (a slop extension, like `slop`). The grant follows the
`sample` policy exactly: a person with an id and the `sample` policy for their audience. Spending asks the viewer's
`sample` consent, because it is the same money.

## 5. The page API

```js
const agent = await claude.use('agent')          // null: not declared, not granted, no backend
const s = await agent.open(threadId, {           // resumes the session, or creates it with these settings
  title, system, modelTier: 'default', model, effort, maxRounds, toolTimeout,
  tools: [{ name: 'eval', description, inputSchema, execute: async (input, { signal }) => value }],
})
const r = await s.send('fix the header', {       // resolves when the run ends
  context: 'Files: …',                           // appended after the message, kept in the conversation
  onText: ({ text, delta }) => …,                // the answer so far (all rounds), like sample's onText
  signal,                                        // abort → stop
})                                               // → { text, truncated }; rejects with e.code on failure
s.running; await s.stop(); await s.delete(); s.close()
await agent.list()                               // [{id, title, updated, running, usage}]
await agent.limits()                             // sample.limits
```

The runtime registers the tools for each event-stream connection, and registers them again before every `send`, so
the tab that sends runs the tools. It runs a tool when a `ChatFrontendToolCallRequested` event names its own
assignment. It posts the tool's return value as the result (any JSON), or the thrown error as `failed`.

## 6. bench

- `Agent.init`: `this.agent = await claude.use('agent')` next to `sample`.
- `Agent.turn`: when `this.agent` exists, `open(th.id, {system: head + guide, tools: [eval], …})` and
  `send(text, {context: this.context(P, ws, th), onText, signal})`. The history is no longer sent, and `compact()`
  is not called for agent threads. The eval tool function is unchanged (budget, ask mode, effects).
- Subagents (`delegate`) get their own sessions (`th.id` of the delegated thread), so they keep their own history
  and caching.
- `app.json` declares `"agent": {}`. Without the capability (an older server), bench keeps the sample path.

## 7. Phases

1. Dependency: slop-computer requires pinocchio (workspace) and geppetto v0.14.3.
2. `pkg/llm/gepp`: `Backend.Engine(ctx, llm.Options)`; the fake backend's agent engine is pinocchio's scripted
   engine.
3. `pkg/doors/pages/agent` (planned as `pkg/caps/agent`, see 9): server construction, auth, create hook, resolver, metered engine. Tests with the scripted
   engine through HTTP, including the ledger.
4. `pkg/doors/pages`: routes, grant, manifest name, wiring in host.
5. `web/runtime/src/agent.ts`, built into `claude.js`; runtime tests.
6. bench: the agent path; rebuild `apps/bench`.
7. End-to-end check on a local server with `--llm fake`, then with a real model.

## 8. Risks and open points

- **Release dependency.** slop now depends on an unreleased pinocchio (branch `task/merge-agentd-into-chatapp`).
  The workspace's `go.work` builds it. The Docker and CI builds need a pinocchio release first.
- **Reload during a run.** A tool call that was requested before a reload is not run by the new page and ends at the
  tool timeout. bench shows the thread from its own stored messages.
- **Long threads.** The conversation grows without bound. A thread that reaches the model's context gets
  `prompt_too_large`. bench can then start a new session, seeded with a summary, as caller content.
- **Images** are not part of the agent capability yet (sample has them).

## 9. As built

| Planned | Built | Why |
|---|---|---|
| `pkg/caps/agent` | `pkg/doors/pages/agent` | slop's layering: capabilities may not import `net/http`; the service is httpapi, and only the pages door serves it (`internal/archtest`) |
| `agent.open(id?, …)` with page-chosen session ids | `agent.open(key, …)`: list by `labels.key`, else create; the server id is a uuid | httpapi ids are global; two people or apps choosing the same id would collide. The create hook refuses a second session per key, person and app (409 `session_exists`) |
| `agent.limits` = `sample.limits` | an `agent.limits` RPC with the same answer | RPC methods are gated by their capability's name |
| — | `Session.fresh` | bench seeds a session it just created with the thread's earlier messages, once |
| — | `policy.set … sample` allowed for apps that declare only `agent` | the agent spends under the sample policy |
| ledger call id `agent:<session>` | `agent:<session>:<message id>` | hold keys are idempotent; a second message's round 0 got the first's settled hold and was never charged (found in the bench run) |
| bench: one session per thread | one per thread, tier and model | labels are fixed at creation; a tier change starts a new session, seeded with the earlier messages |

Checked in bench (local server, `--llm fake`, benchdrive): `/tool eval {…}` ran in bench's sandbox and the answer
carried its result; a second message continued the same server conversation; after a server restart and page reload
the thread reopened the same session; every round has its own settled hold. The stored conversation is the system
prompt (bench's guide, 36.8 KB) once, then per message the person's words, the current state (~550 bytes), tool
calls and the answer.

