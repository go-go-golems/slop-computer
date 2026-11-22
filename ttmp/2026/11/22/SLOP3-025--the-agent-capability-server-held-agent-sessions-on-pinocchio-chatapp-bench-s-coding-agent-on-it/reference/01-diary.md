---
Title: Diary
Ticket: SLOP3-025
Status: active
Topics:
    - llm
    - agent
    - runtime
    - bench
DocType: reference
Intent: long-term
Owners:
    - manuel
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-22T01:16:03.679118649-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Give slop pages a second LLM capability next to `sample()`: server-held agent sessions with page-executed tools,
on pinocchio's chatapp/httpapi (PIN-20261121), and move bench's coding agent onto it.

## Step 1: Server side and the pages door (phases 1–4)

This step built the agent capability's server: pinocchio's `httpapi` mounted at `/_rt/agent` on the sandbox origin,
with the view's person and app as principal and every model round held on the person's LLM ledger. The pages door
declares, grants and routes it. Both a package-level HTTP test (scripted engine, real ledger) and a host-level test
(a real view, through the sandbox origin) pass.

Commits: pinocchio 63fddd3 (hook codes map to their HTTP status); slop 3aef663 (server), 8922ce0 (door).

### Prompt Context
**User prompt (verbatim):** "it should offer claude sample() and the richer chat agent in the way that homolog-bench
did, but with the new chatapp, so that bench/ the coding agent for example has a proper agent backend"
(preceded by "does slop-computer work with chatapp now?", answered no: slop did not import pinocchio).
**Assistant interpretation:** Keep `sample()`; add `claude.use('agent')` backed by chatapp in-process, under slop's
auth/policy/budget; move bench's agent to it.
**Inferred user intent:** bench gets server-held conversations (caching, stop, reload) instead of re-sending and
summarizing history from the page.
**Commit (code):** 3aef663, 8922ce0 (slop); 63fddd3 (pinocchio)

### What I did
- Read slop's sample path end to end: `pkg/doors/pages/sample.go` (view checks, SSE, tool round trip),
  `pkg/caps/sample` (Sampler.Check/Run), `pkg/llm` (Ledger, BudgetMeter holds per round), `pkg/llm/gepp` (engine per
  round via Pi), `web/runtime/src/sample.ts`, and bench's agent (`web/bench/src/agent/agent.js`: page-held history,
  `compact()` summaries, one `sample()` per message with an `eval` tool, subagents via `delegate`).
- `gepp.Backend.Engine(ctx, llm.Options)` and `llm.EngineInfo`; `level` moved onto Backend.
- The service (`pkg/doors/pages/agent`): authenticator from a `View` in the context; authorizer = owner and
  `labels.app`; listings forced to the view's app; create hook (app label, one session per `labels.key`, settings
  clamped: maxRounds 30/60, toolTimeout 10m/30m, maxTokens 16384/65536, system ≤ 256 KiB); context blocks (≤ 64 KiB);
  resolver (engine, system prompt middleware, loop with final answer, deadline + result cut 16000).
- `meteredEngine`: per round `LLMFor` check → `NewMeter` → `Before(estimate)` → cap MaxResponseTokens → run with a
  usage sink → `Close`.
- Door: `"agent"` in `rt.ContractCaps`, grant like sample, `/_rt/agent` route before the GET-only switch,
  `agent.limits`, service built on first use in `<data>/agent`; `policy.set sample` allowed for apps declaring agent.

### Why
- Sessions keyed by the page (`labels.key`) instead of page-chosen ids: httpapi ids are global, and two people or two
  apps choosing "t1" would collide.
- The hold per round, not per message: the same semantics as sample (SLOP3-007), and the output cap can be applied.

### What worked
- `TestAPageToolRoundTripIsMeteredOnTheLedger`: system prompt, context block and `eval returned: 42` in the turn;
  usage charged; no hold left open. `TestARunStopsWithoutLLMAccessOrBudget`: `permission_denied`, then
  `quota_exceeded` with nothing charged. `TestPageAgentSession` (host): grant off → 403, on → answer and charge.

### What didn't work
- Duplicate key answered 400 instead of 409: httpapi answered every create-hook error with 400. Fixed in pinocchio
  (63fddd3): a coded error's code picks its status.
- `policy.set ... capability sample` → `400 ... ag does not declare sample, so it cannot be turned on`. The policy
  matrix only listed sample for apps declaring sample; now also for agent.
- My host test called `sample.limits` on an agent-only app (refused: RPC methods are gated by their capability
  name); added `agent.limits`.
- `TestDependencyRules`: the package started in `pkg/caps/agent`, but "capabilities know nothing of HTTP"; moved to
  `pkg/doors/pages/agent` (same door). Checked the rules with the workspace by a temporary, reverted edit (the test
  itself runs `go list` with `GOWORK=off`).
- `make lint` and `TestDependencyRules` fail as committed: both run with `GOWORK=off`, and pinocchio v0.11.18 has no
  `pkg/chatapp/httpapi`. Lint with the workspace (pinocchio's `.bin/golangci-lint` 2.11.2): 0 issues in changed
  packages; one older staticcheck QF1012 in `pkg/commands/appverbs.go:375` (newer linter, not this change).

### What I learned
- Sinks added with `events.WithEventSinks` append to the context's sinks, so the meter can listen to one round's
  usage without touching chatapp's sink.

### What was tricky to build
- Where the service lives: it is a capability by meaning but HTTP by construction; slop's layering puts HTTP in
  doors, and doors may not import each other, so it is a sub-package of the one door that serves it.

### What warrants a second pair of eyes
- The service is never closed (the host has no shutdown hook); SQLite in WAL mode tolerates it.
- `estimate()` counts JSON bytes of all blocks: conservative, so holds are large for long sessions (settled after).

### What should be done in the future
- A pinocchio release so `GOWORK=off` builds (Docker, CI, `make lint`, archtest) work.

### Code review instructions
- `pkg/doors/pages/agent/{agent,meter}.go`, `pkg/doors/pages/agent.go`; tests `pkg/doors/pages/agent/agent_test.go`,
  `pkg/host/agent_test.go`.

## Step 2: The runtime, bench, and the end-to-end run (phases 5–7)

This step added `claude.use('agent')` to the page runtime, moved bench's coding agent onto it, and ran bench in a
headless browser against a local slop with the fake model. The run found one real bug: a second message's first
model round was never charged, because ledger hold keys repeated across messages. That is fixed and tested.

Commits: f903096 (runtime), ee6de7d (bench), 501e81a (hold keys).

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The page API, bench on it, and a check that it works in the real bench.
**Inferred user intent:** bench's agent has a proper backend, not only a server that passes unit tests.
**Commit (code):** f903096, ee6de7d, 501e81a

### What I did
- `web/runtime/src/agent.ts`: `open(key, settings)` (list by key, else create; `session_exists` → list again),
  `send(prompt, {context, onText, signal})` resolving on `ChatRunFinished` with every text segment joined (as sample's
  text is every round's), rejecting with `ChatRunFailed.code` / `cancelled`; tools registered on every stream
  snapshot and before each send; a call runs when its `executor.assignmentId` is this page's; pending calls picked up
  from the snapshot after a reconnect. `Session.fresh`. Unit test with a scripted fetch (4 tests).
- bench (`web/bench/src/agent/agent.js`): `Agent.agent`; `session()` one per thread, tier and model, key
  `<app>:<thread>:<tier>:<model>`; system = role head + guide; context = "Current state: …" per message; the
  session's eval calls the eval of the turn running on the thread (`Agent.evals`); `earlier(th)` seeds a fresh
  session once; `compact()` only on the sample path. `apps/bench/app.json` declares `agent`.
- e2e (`scripts/01-bench-agent-e2e.sh`): local server `--llm fake` on :18492; CLI device login approved by a
  Playwright script (`scripts/02-approve-device-login.mjs`); bench pushed, `policy set bench sample @admin on`,
  `llm set @admin on --budget 200000`, `app trust bench workshop`, mounted; SLOP3-024's benchdrive in a scratch copy.
- `doc/building-apps.md`: the agent capability for app authors.

### Why
- bench's session key includes tier and model: labels are fixed at creation, so another model needs another session.
- `send` resolves on the run's end rather than returning a stream: bench's turn already awaits `sample()` the same
  way, so the change to bench is local to `turn()`.

### What worked
- benchdrive `ask '/tool eval {"code":"const fs = await files.list(); return fs.map(f => f.path)"}'` →
  `✓ eval 1 · files.list · 111 ms` and `eval returned: "{\"ok\":true,\"value\":[\"README.md\",\"app.json\",…]}"`.
- A second message continued the conversation (2 turns, 9 blocks); after a server restart and a page reload, a third
  message reopened the same session (1 session, 3 turns).
- Stored blocks: `system` 36841 bytes once; then per message `user` (the words), `user` "Current state: …" (~550
  bytes), `tool_call`/`tool_use`, `llm_text`. Nothing rewritten.

### What didn't work
- Creating an app in bench: `Could not create agentdemo: the bench is not trusted with the workshop module (slop app
  trust <store> workshop)`; fixed by `slop app trust bench workshop` (setup, not code).
- Ledger after two messages: `llm_holds` had `agent:<sid>/0` and `/1` only, but the session's usage had 3 calls
  (`{"input":27995,"output":15,"calls":3}` against `used: 18566` = 9272 + 9294). `Reserve` is idempotent by key
  (`SELECT … FROM llm_holds WHERE id = ?` → "a retry: the hold it already made"), and each message's rounds counted
  from 0 under the same call id. Fixed with a per-message id in the call; the new test assertion fails on the old
  key (`a second message's round reuses no hold of the first`) and passes with the fix. After the restart the new
  round has its own hold `agent:<sid>:md18288692cdacf51/0 | settled | 9586`.
- A first attempt to show the test failing without the fix failed to build (unused `ids` import); redone with the
  import kept in use.

### What I learned
- The scripted engine reports usage through the context's sinks, so the meter's sink sees exactly what chatapp's
  usage observer sees; comparing the session's usage with the ledger is a cheap consistency check.

### What was tricky to build
- bench's eval tool closes over one turn (budget, ask mode, signal, effects), while a session's tools are fixed at
  `open()`. The session's tool is a thin forwarder to the thread's current turn, set for the duration of `send`.

### What warrants a second pair of eyes
- `#call` in agent.ts runs pending calls from a snapshot only when their assignment is this page's, so after a page
  reload a call requested before it ends at the tool timeout (design 8).
- benchdrive prints `"…" was discarded` after each turn: bench discards an agent proposal with no changes. Unrelated
  to this change.

### What should be done in the future
- The same run with a real model (`--llm pi`): it spends real tokens, so it was not run here.
- A pinocchio release, so `GOWORK=off` builds work (Step 1).

### Code review instructions
- `web/runtime/src/agent.ts` with `web/runtime/test/agent.test.ts`; `web/bench/src/agent/agent.js` (`session`,
  `earlier`, the `if (this.agent)` branch of `turn`); `pkg/doors/pages/agent/agent.go` (`call:` in `resolve`).
- `make runtime-test`, `cd web/bench && npm test`, `go test -tags sqlite_fts5 ./pkg/doors/... ./pkg/host`;
  the e2e: `scripts/01-bench-agent-e2e.sh <repo> <scratch>` then benchdrive.
