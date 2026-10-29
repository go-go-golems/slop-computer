---
Title: Diary
Ticket: SLOP-009
Status: active
Topics:
    - architecture
    - backend
    - frontend
    - tools
    - collaboration
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/10/29/SLOP-009--artifact-runtime-baseline-slop-hosts-the-artifact-contract-natively-no-adapters/design-doc/01-intern-guide-the-slop-artifact-runtime.md
      Note: The intern guide this diary records
ExternalSources:
    - /home/manuel/code/wesen/go-go-golems/francois
Summary: "Chronological diary for SLOP-009: the slop artifact runtime baseline."
LastUpdated: 2026-10-29T18:40:00-04:00
WhatFor: "How the SLOP-009 design was produced, with evidence"
WhenToUse: "Before continuing SLOP-009 or reviewing its guide"
---

# Diary

## Goal

Record how SLOP-009 was designed. The ticket replaces slop's per-app adapters with a native implementation of the claude.ai Artifact runtime contract, as a baseline every app runs on.

## Step 1: The contract, francois and slop studied; the runtime designed

This ticket follows three conversations about Claude Blocks (SLOP-008):
1. how to integrate it;
2. what core APIs JS artifacts need, using francois as a reference;
3. what to build locally to make Blocks work "well and elegantly".

In each answer the conclusion moved further from adapters. The last answer proposed a native runtime: a page runtime, a server package, mirrors instead of re-queries, diff sync, apps and targets. The user then asked for a ticket "to properly upgrade slop-computer to have a solid baseline, not adapters", with a brutal refactor and no backwards compatibility. This step turns that answer into a design checked against the code, with a delete list, decision records and an eight-phase plan.

The design has three pillars:
- **One runtime client** (`/_slop/claude.js`, ported from francois's page runtime) and **one server package** (`pkg/rt`).
- **slop's own API as one extension capability** (`claude.use("slop")`), replacing tools and grants.
- **A conformance suite written first**, checked against francois, gating every phase.

### Prompt Context

**User prompt (verbatim):** "Create a new docmgr ticket to properly upgrade slop-computer to hae a solid baseline, not adapaters. You can be brutal in the refactor and no backwards compatibility, we are working our way up."

**Earlier prompts in this thread (verbatim):**
- "what background core APIs would we have to offer for JS artifacts to run fully properly, see for example ~/code/wesen/go-go-golems/francois (whch might also be missing some)."
- "Look at ~/Downloads/Artifact*.md for the claude side API descriptions. What would you implement locally to make blocks work well and elegantly (potentially refactoring other stuff we have to make it more streamline, we don't need to care about legacy support since this is all an experiment, and we care about a strong and streamlined framework)"

**Assistant interpretation:** Create SLOP-009 with a design and implementation guide for the runtime baseline, phased tasks and this diary. No code yet: "working our way up" means phases.

**Inferred user intent:** One strong framework that every artifact-style app (Blocks, Pinup, CC5, Claude-written pages) runs on, instead of growing a shim per app.

**Commit (docs):** recorded in the changelog for this step.

### What I did

- **Read the four contract guides in `~/Downloads`:**
  - *State Storage*: browser storage, `artifact`, db paths, levels, rules, API, errors, assets, Claude's side;
  - *People & Collaboration*: `user`, `room`, `comments`;
  - *Claude API (sample)*: calls, options, page tools, errors, `mcp`;
  - *Files*: `files` and `downloads`.

  Also read the claude.ai type-definition summary for runtime contract 0.2.92 (the `artifact-capabilities` reference, including the db path grammar and limits in `db.d.ts:245-275`, query operators at `:480-490`, and room sizes in `room.d.ts`).
- **francois (read-only):**
  - `README.md` "Capabilities": the implemented surface and what is absent;
  - `ui/src/runtime.ts:751-828`: the capability table and comments, assets, `artifact`;
  - `ui/src/runtime-db.ts` outline and `:250-300, 340-404`: queries and live snapshots;
  - `ui/src/runtime-rooms.ts` outline;
  - `pkg/host/routes.go:98-229`: views, view events, sample calls, tool results, rpc;
  - `pkg/host/rpc.go` method list; `pkg/host/rooms.go`;
  - `pkg/store/documents.go` and `store.go` (functions and schema).
- **slop:**
  - package sizes;
  - every route with its guard (`grep 'm.HandleFunc'`);
  - migrations `003_sandbox`, `004_tools` and `006_docs`;
  - `artifacts` schema (`created_by`, `viewer`) and its uses in `pkg/store/artifacts.go`;
  - roles (`pkg/store/users.go:12-15`), guard levels and scopes (`pkg/server/auth.go:78-92`);
  - render modes and `Boot` (`pkg/render/render.go:18-36`);
  - the broker's one-process assumption (`pkg/events/broker.go:1-9`);
  - the threads schema (`002_kernel.sql`);
  - `ToolScreen.tsx` grant renewal;
  - `tool.js`'s fetch-based SSE (`:65-75`);
  - Pinup's calls to `room.sendToClaudeSession` (`web/pinup/src/09-collab.js:189`, `13-feedback.js:353`).
- **Created the ticket and its docs:**
  ```bash
  docmgr ticket create-ticket --ticket SLOP-009 --title "Artifact runtime baseline: slop hosts the Artifact contract natively, no adapters" --topics architecture,backend,frontend,tools,collaboration
  docmgr doc add --ticket SLOP-009 --doc-type design-doc --title "Intern guide: the slop artifact runtime"
  docmgr doc add --ticket SLOP-009 --doc-type reference --title "Diary"
  ```
- **Wrote the guide** (1,009 lines): the contract per capability, a verdict on every slop part, the target architecture (apps and targets, origins, manifest, views, transport, db with rules, diff sync, room, user, assets, comments, downloads, publish, sample, the `slop` capability, static mode, agents), eleven decision records, server and client layouts, the API and RPC reference, the delete list, phases with exit tests, tests, risks and questions.
- **Added ten tasks:** the design, phases 1-8, and the open decisions.

### Why

- **The conformance suite comes first and runs against francois.** A host that "mostly" implements the contract is how the adapters failed. A suite proven on francois before slop has any of the runtime gives each phase an objective exit test.
- **Apps and targets (D2).** The contract ties a db to one artifact. slop wants one app build serving many data artifacts (Blocks workspaces, Pinup designs). Letting a data artifact name its app keeps "one artifact, one db, one rule set" and needs no app code. The existing `artifacts.viewer` column already carries that idea.
- **Mirrors, not re-queries (D5).** francois answers every write with `db_changed` (`rpc.go:113`), and every subscription re-runs its query (`runtime-db.ts:263-268`). For Blocks' chunk log that would be a full re-download per flush per tab.
- **Diff sync below the API (D6).** It is the generic fix for SLOP-008's D3, invisible to pages.
- **Append-only migration 007 (D11).** Being brutal in code does not justify destroying the cluster's francois data, so only the replaced tables are dropped.

### What worked

- **The existing pieces fit the design:**
  - the contract's document size (256 KiB) and presence size (4 KiB) already match slop;
  - threads already carry an anchor, a version and an `agent` flag;
  - `artifacts.created_by` gives the owner level;
  - `tool.js` already streams over fetch with a bearer header;
  - PR #3's revision-ordering work carries over to `rt_docs` unchanged.
- **The routes list** (`grep 'm.HandleFunc'`) gave an exact delete list: `/api/docs/*`, `/api/presence/*`, `/api/tools*`, `/api/sandbox-url`, `/tools/{rest...}`.

### What didn't work

- **Three claims in my first draft were wrong;** checking them against the code before committing caught all three:
  - "Every API route except login and help requires an admin": `/api/config`, `/api/me` and the device flow are also open to non-admins.
  - "presence bodies match the contract, but documents and leases don't": documents match too (256 KiB). The mismatches are leases, paths and error codes.
  - "Send to Claude uses `comments.sendToClaude` or `room.sendToClaudeSession`": upstream Pinup calls only `room.sendToClaudeSession`.

  All three are corrected in the guide (a Python replace with asserts that each old sentence occurs exactly once).
- **A `grep --include=*.go` in zsh failed** with `no matches found: --include=*.go` (unquoted glob). Rerun with the patterns quoted.

### What I learned

- **The contract's own limits already answer two SLOP-008 questions.** Presence is 4 KiB on claude.ai as well, so raising ours (SLOP-008 G9) would have been wrong. And Blocks' 150,000-character chunks face the same 256 KiB document limit there (G8).
- **The contract says top-level published artifacts have no runtime** ("`use()` resolves `null` for now"). That makes the split between a public site layer and a Workshop runtime a contract-faithful choice, not a shortcut.

### What was tricky to build

- **Where rules live when a target is a data artifact.** Pages declare rules, but agents act on targets with no page open. Resolving them through the target's single app (D2) gives one answer for views and agents alike.
- **Limited windows with client-side evaluation.** With an initial load that obeys `limit`, a document leaving the window cannot be replaced. Loading the filtered set without the limit, and applying the limit in the mirror, keeps windows correct. That is affordable because the contract bounds collection sizes.

### What warrants a second pair of eyes

- **D2:** one app per target. Is there a real case for opening a target with two apps?
- **The view secret's reach.** Any script in the page can use it, Blocks' Spore apps included. It is narrower than today's tool grant, but still the target's full level.
- **Single process.** Rooms and views in memory.

### What should be done in the future

- Phase 1 (the conformance suite) next.
- Rewrite SLOP-008's plan on this baseline once phase 4 lands.

### Code review instructions

- Read the guide's sections 1-5, then 6.2 (apps and targets), 6.7-6.8 (db and diffs), section 7 (decisions), section 12 (the delete list) and section 14 (phases).
- Spot-check references with `sed -n "<n>p" <file>`.

### Technical details

```text
contract capabilities: artifact assets comments db downloads files mcp room sample self(=artifact) user + built-in permissions
limits: doc 256 KiB / depth 32 / 25,000 docs; path 16 segments, 200 B/segment, 1,000 B; room data & presence 4 KiB; ≤16 topics; ≤16 rooms;
        ≤64 rules; ≤64 subscriptions/view; lease 1 s–10 min; assets 20 MiB (SVG 2 MiB, CSS/JS 16 MiB); sample prompt 256 KiB, tool result 32 KB
francois page runtime: runtime.ts 828 · runtime-db.ts 404 · runtime-rooms.ts 172 · runtime-files.ts 141 · runtime-images.ts 89
slop to delete: docs store (006), tools + grants (004), sandbox labels (003), tool.js, ToolScreen, Pinup 00-slop-host.js, slop docs
```

## Step 2: The runtime's server, store and page client, with the old pieces deleted

This step implements phases 2 and 3 of the guide and most of 4 to 7 on the server side. It also deletes the adapters (docs store, presence hub, tools and grants, `tool.js`). `pkg/rt` holds the contract's semantics. `pkg/store/rt.go` holds the SQL behind migration 007. `pkg/server/rt*.go` holds views, the stream and the RPC table. `web/runtime` is the page client that builds into `pkg/render/assets/claude.js`. An app opens on its target's own origin at `/v/<n>/`, receives a view secret from the shell over postMessage, and talks only to `/_rt/…` on that origin. Agents use `slop data` and `slop room`.

Phase 1 of the guide (the conformance suite, run against francois first) is not done. The Go integration test `TestRuntimeViews` and the shared query and diff vectors stand in for it until the Workshop shell exists. The browser suite comes with the Workshop cut-over.

### Prompt Context

**User prompt (verbatim):** "we use pi adapters, we allow full model and thinking choice, no budget but LLM is only usable by admins. Implement,  write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill). Commit and push the bsidian vault when done (go-go-parc vault)."

**Mid-turn question (verbatim):** "we want to load the pi models and credentials, what is \"pi worker\"?" Answered inline: the Pi worker is a Node child process running the Pi SDK (`@earendil-works/pi-ai`, `pi-coding-agent` 0.85.1). It reads `~/.pi/agent` (`auth.json`, `models.json`, `settings.json`) and talks JSON lines over stdio to Go (`pkg/piworker` in francois). Credentials stay on the server host.

**Assistant interpretation:** Implement SLOP-009 for real. `sample` goes through the Pi worker with any model and effort, no token budget, and admins only (slop's only role that opens apps anyway). Then write the vault report and push the vault.

**Commit (code):** `1f3b039` "SLOP-009: artifact runtime server, store and page runtime (claude.js)"

### What I did

- **`pkg/rt`** (no HTTP):
  - `limits.go`, `paths.go`, `rules.go`, `query.go`, `diff.go`, `manifest.go`;
  - `body.go` (`ParseBody`, `Merge`, `Depth`);
  - `views.go`: the view registry, per-view subscriptions and rooms, the emit token bucket, the sweep of views that never connected or went idle.
  - `SlopPermissions` replaces `store.ToolPermissions`; `docs:read`/`docs:write` are gone.
- **Migration 007** (both dialects):
  - drops `docs`, `doc_heads`, `tools`, `tool_grants`, `sandbox_labels`;
  - adds `artifacts.app`;
  - creates `rt_heads`, `rt_docs`, `rt_leases`, `rt_assets`, `rt_origins`, `rt_approvals`, `rt_consents`.
- **`pkg/store/rt.go`:**
  - `RTWrite` locks the head row first (an upsert returning the new rev), then the document row. A delete of nothing takes no rev.
  - `RTChanges`, `RTColl`, `RTDoc`, `RTHead`, `RTAcquire` (returns the expiry in force), `RTPrune`, assets, `RTOrigin` (an HMAC label per target), approvals, consents.
- **`pkg/server/rt.go` and `rt_more.go`:**
  - `POST /api/rt/views` (session) opens a view: level from role and `created_by`, caps from the app version's manifest, `slop` permissions only when approved. Renew, consent and close go through the session too.
  - `GET /_rt/events` streams hello, a catch-up from `after`, then live changes in rev order. A gap is filled from the table. Changes are filtered by subscriptions and read rules. Room, peers, reload and revoked events follow.
  - `POST /_rt/rpc` dispatches every capability call.
  - `/_rt/assets` takes raw uploads; `/_blob/{id}` serves them with `nosniff` and a sandbox CSP.
  - `/_rt/api/…` is the `slop` capability: the request is replayed into the main mux with the view secret, and `guardPerm` accepts `slv_` bearers for approved permissions.
  - `/api/rt/targets/{t}/db` is the agent surface (one POST with an op, as ArtifactData). `/api/rt/targets/{t}/views` opens agent views.
  - `/api/apps` lists apps; `/api/apps/{id}/approve` approves a version. `GET /run/…` serves the Workshop.
- **`serve.go`:** `serveSandbox` maps the label to its target. It serves `/v/<n>/` of the target's app (a page is its own target), with boot `runtime` data and `claude.js` injected first in every non-site mode. `/api/sandbox-url` returns `/v/<n>/` URLs on the per-artifact origin.
- **`web/runtime`** (esbuild IIFE, 53 KB unminified):
  - `transport.ts`: the postMessage handshake, the fetch-SSE stream with resume and renew on 401, `rpc()`.
  - `db.ts`: refs; per-subscription mirrors with version dedupe; a pending-write overlay; one write at a time per document; patch upstream with fallback on `conflict_base`; patches downstream with refetch on a base mismatch.
  - `room.ts`, `caps.ts` (user, permissions, comments, assets, downloads, artifact, slop), `static.ts`, `index.ts` (`window.claude.use` only, frozen, resolving after a macrotask).
  - `test/vectors.test.ts` runs the Go testdata vectors and a 3,000-pair diff property test.
- **CLI:** `slop data get|list|query|set|update|str-replace|delete|batch` and `slop room watch|emit`. `slop docs` and `pkg/client/docs.go` are deleted.
- **Tests:**
  - `TestRuntimeViews`: hello, `/v/1/` and siblings, subscribe/write/event, update of a missing document, a private subtree, patch and stale base, diff sync on the stream, an agent write seen live, `data/users/me`, `as_level`, an agent query, rooms (presence and emit with `by`), the oversized emit, `slop` before and after approval and beyond its permissions, the secret on a foreign origin, revocation on a role change.
  - `TestRTWriteConcurrency` (20 goroutines, puts and deletes on 4 documents, contiguous revs, leases, origins).

### Why

- **The API lives on the target origin (`/_rt/…`), not on the main host with CORS.** The label identifies the target, every call is same-origin, and a secret leaked to another origin is refused there (`viewOf` checks the origin's target).
- **The `slop` capability replays into the main mux.** No second copy of the management API exists, and `guardPerm` stays the one authorization point.
- **One sweep loop per server.** Views live in memory; a restart ends them, and the runtime asks the shell for a new view on a 401 (`renew` → `newview` → re-subscribe, re-join).

### What worked

- **Go:**
  - `go test ./...` passes on SQLite.
  - `TEST_DATABASE_URL=postgres://…:55432/… go test ./pkg/store/... ./pkg/server/...` passes; migration 007 applies on Postgres.
- **TypeScript:** `node --test --experimental-strip-types test/*.test.ts` gives 3 pass. `tsc --noEmit` is clean.
- **Lint:** `golangci-lint run` reports 0 issues after fixing gofmt, `nonamedreturns` and `predeclared`.
- **Mutation check:** disabling the origin-target comparison in `viewOf` makes `TestRuntimeViews` fail with `rt_test.go:275: secret accepted on a foreign origin`. Restoring it passes.

### What didn't work

- **The first version of the foreign-origin check tested an unknown label.** `serveSandbox` answers that with a 404 HTML page and no `{error}` body, so the helper saw no error code and the assertion fired: `rt_test.go:275: secret accepted on a foreign origin`. The test now uses another real target's origin and expects `revoked`.
- **The first role-change check used `PUT /api/users/{id}/role`, which does not exist.** It returned 404 and the check skipped itself. The route is `PATCH /api/users/{id}`, and it now runs with a second admin.

### What I learned

- `slop db` is already the operator group (users, gc-blobs, import-admins). So the agent verbs are `slop data …`, not `slop db …` as the guide says.

### What was tricky to build

- **Ordering the stream without losing writes.** Each view tracks the target's last rev. A live change at `last+1` is sent, an older one is skipped, and a gap triggers `RTChanges(last)`. The table is authoritative because the head row lock serialises commits. The runtime also keeps the highest version per path in each mirror, deletions included. So a duplicate from the subscribe-then-read race is harmless.
- **Optimistic writes without flicker.** The overlay is cleared when the RPC returns. The confirmed set or delete goes into the mirrors first, so the old body never shows before the echo. `update` is not injected: its merged body is the server's, and the echo carries it.

### What warrants a second pair of eyes

- **Agent-request threads.** `sendToClaudeSession` and `comments.sendToClaude` create threads on the app version with an anchor `{"claude": true, "target", "data"}` rather than a new column.
- **Approval semantics.** Approval is all-or-nothing per app version. An app opened at a version whose permissions are not all approved gets no `slop` capability; the other capabilities still work.
- **`can("data.write")`** is probed with a synthetic path under the root rule.

### What should be done in the future

- The Workshop shell (`AppScreen`), the Pinup cut-over, Blocks, `sample` through the Pi worker, the browser conformance pages: the next steps.

### Code review instructions

- **Start with:** `pkg/server/rt.go` (`viewEvents`, `dbWrite`), `pkg/store/rt.go` (`RTWrite`), `web/runtime/src/db.ts`.
- **Run:**
  - `go test ./pkg/rt/ ./pkg/store/ ./pkg/server/`
  - `make runtime-test`
  - `make test-postgres`

### Technical details

- **Origins:** `label = "s" + hex(HMAC(server key "sandbox", "target\x00" + id))[:20]`.
- **View secrets:** `slv_` + 32 base32 characters. A secret lives `ViewTTL` (1 h). A view is dropped 15 s after opening if its stream never connected, or 2 min after its stream ended.
- **Diff sync:** the server sends a patch when the body is over 512 bytes and the patch is at most a quarter of it. The client sends one under the same quarter rule against the last known body and version.

## Step 3: The Workshop shell, conformance in a browser, sample on Pi, Pinup and Blocks on the runtime

This step finishes the implementation. The Workshop got the shell: `AppScreen` at `/run/<target>`, the Apps menu and approvals. The browser conformance suite came next, then `sample` through the Pi worker, tested on real lunaroute models. Pinup was cut over to the runtime, with static mode for its player. Claude Blocks runs from its upstream files with only a manifest added. Every claim below comes from a run against a local server (`slop serve --local --pi-worker …`, SQLite in the scratchpad), plus the Go tests on SQLite and Postgres.

The user added one request mid-step: "use lunaroute models to extensively test the agent / sample part when you get to it, multi tools, multi turn, etc...". The sample suite and the Blocks Claude-block check follow it. The tiers are `quick` lunaroute/glm-5.3-flash, `default` lunaroute/glm-5.3 and `complex` lunaroute/deepseek-4.1-flash; explicit models and effort are used too.

### Prompt Context

**User prompt (verbatim):** see step 2. **Mid-step (verbatim):** "use lunaroute models to extensively test the agent / sample part when you get to it, multi tools, multi turn, etc..."

**Commits (code):**
- `f7484d5`: the Workshop shell and the conformance suite;
- `2448b9a`: ignore `.slop/`;
- `70025b3`: sample through the Pi worker;
- `ccefd86`: Pinup on the runtime, static mode, `slop help runtime`;
- `9cf5485`: Claude Blocks;
- `ec9a91b`: assets revalidate, more conformance, the publish test.

### What I did

- **Workshop:**
  - `screens/AppScreen.tsx` opens a view with the session and hands the secret to the frame by postMessage. It renews every 45 min and reopens the view when the server forgot it. It answers `consent`, `download`, `compose`, `permissions`, `args` and `navigate` with its own dialogs.
  - The Apps menu replaces Tools: apps with their targets, and the count of unapproved versions. `ApproveDialog` approves a version.
  - Artifacts ▸ *New with an app…*; Watch ▸ *Open as app*. `ToolScreen` is deleted.
- **`web/rt-conformance`:**
  - `app/` is one page with 46 checks: db, user, room, permissions, downloads, artifact, assets, comments.
  - `run.mjs` signs in, opens `/run/rt-conformance` and reads the page's results. It accepts the Workshop's consent and save dialogs, then adds 5 checks: a two-tab write, presence with `by`, a moment, a download that reaches the browser, and a reload. That makes 51 checks in all (the commit message of `ec9a91b` says 52; the count from the run log is 51).
  - `sample/` holds 20 checks run on the real models.
- **`pkg/piworker` and `web/piworker`** are ported from francois:
  - Pi SDK 0.85.1, JSON lines on stdio, the lunaroute provider registration.
  - The per-call output bound is raised to 64k tokens, with no per-round 8,192 cap and no per-person budget.
  - Flags: `slop serve --pi-worker/--pi-node/--pi-agent-dir/--model-{quick,default,complex}/--pi-fake`.
- **Server sample:**
  - `POST /_rt/sample` (SSE: call, text, thinking, tool, result, error) plus `/_rt/sample/{call}/tools/{use}` and `/cancel`.
  - `sample.limits` lists Pi's models.
  - A call needs the admin level and consent, and writes one audit row with model, tokens and duration.
  - Runtime `sample.ts`: `onText`, page tools with an `AbortSignal`, cancel, the 5-minute cache, `sample.json`, JPEG image preparation, `limits`.
- **Pinup:**
  - `00-slop-host.js` is deleted; Pinup uses `window.claude` as on claude.ai.
  - `00-slop.js` reads the mode from the boot data. `SLOP.api` is `claude.use("slop")`. The design picker lists data artifacts with `app = pinup` and opens them with `slop.open()`.
  - *Save version* writes `db.json`. Manifests: `pinup` declares db, user, room, downloads, sample and slop (6 permissions); `pinup-player` declares db and user.
- **Static mode:** a site route binding `target=<design>` to an app page renders `ModeStatic` with the bound version's `db.json` (`staticRuntime` in `serve.go`).
- **`web/blocks`:** `src/` holds the 10 upstream files, checked against `SHA256SUMS` by `build.sh`. `slop.json` has no `mcp`. `make blocks blocks-push`; `test/live.js`.
- **Docs:** `pkg/doc/topics/pinup.md` now uses `slop data` and `slop room`; new topic `runtime.md`; `doc/production.md` covers view secrets, assets and the Pi worker.

### Why

- **Pinup's picker opens targets instead of switching files inside the app.** Each design has its own origin, db and room. The `?file=` argument and the in-app file switch were what the adapter needed, not the contract.
- **Static mode is keyed on a binding named `target`.** A site route already names data by binding, and the player needs exactly one target.
- **Assets are revalidated (`no-cache`, ETag) instead of `immutable`.** The contract says a delete removes an asset for good.

### What worked

- **Conformance:** `node web/rt-conformance/run.mjs http://localhost:18140` gives 51 ok, 0 failed (`conformance-final.log`).
- **Sample:** `… run.mjs … rt-sample` passed three runs in a row, 20 of 20 each. From `sample-run1.log`:
  - one tool: "The temperature in Oslo right now is 17.25°C." (9.1 s);
  - two tools in one round: "5555 and 1517" (27.0 s);
  - chained tools: `user:u-77 → city:c-9134: User u-77 lives in Quillmarsh.` (19.7 s);
  - a throwing tool: "UNAVAILABLE";
  - an abort while streaming rejects `cancelled` with 25 characters of partial text;
  - `sample.json` gives `{"planet":"Mars","moons":2}`;
  - deepseek-4.1-flash at effort high gives 289;
  - the cache replays the same object within 50 ms.
- **Pinup:** `slop/tests/app.js` gives 51 ok; `slop/tests/live.js design-live` gives 14 ok. The live run covers the picker, opening a design, an inbox step from `slop data set` applied and deleted, the canvas, `meta/file`, *Save version* with `db.json`, the player in static mode, and the read-only static db.
- **Blocks:** `test/live.js ws-six` gives 15 ok:
  - the README-for-Claude protocol: READ the view, WRITE a turn, `applied` with no errors, the formula `stay` = 480;
  - two tabs, and a reload;
  - a 3,100-line turn applies 3,101 ops and writes `meta/snap`;
  - 8 chunks;
  - diff sync: 22 patches averaging 384 bytes against 12 whole-chunk sets averaging 23,788 bytes;
  - a Claude block filled by the model through `sample`.
- **Go:** `TestRuntimeSample` (fake backend: consent and declaration gates, the tool round trip, a duplicate tool result refused) and `TestRuntimePublish`. `go test ./...`, the Postgres store and server runs, and `golangci-lint` are all clean.
- **Mutation:** in `db.ts`, `(e.snap ??= snapOf(…))` → `snapOf(…)` makes the browser suite fail with `FAIL an unchanged document is the same object across deliveries`. Restored, it passes.

### What didn't work

- **`pkill -f "slop13 serve"` killed its own shell**, because the pattern matched the command line (exit code 144). The server now (re)starts through `rt1/start.sh` and `start-pi.sh` with a pid file.
- **ESM ignores `NODE_PATH`:** `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright'`. Fixed with `createRequire(import.meta.url)("playwright")`.
- **The local login page has hidden quick-pick inputs:** `page.fill: Timeout 30000ms exceeded … <input type="hidden" value="manuel" name="nickname"/>`. Sign-in now posts `/auth/local` through the context's request API.
- **`page.waitForURL: Timeout 10000ms exceeded`:** the shell navigates with `pushState`, so there is no load event. The test polls `p.url()`.
- **The picker click did nothing at first.** The binary embedded a Workshop built before the `navigate` handler (I had run `pnpm check`, not `go generate ./pkg/web`).
- **The player showed nothing.** The static db's query snapshot returned an empty `docChanges()`, and Pinup builds its layers from `docChanges()`. The first snapshot is now all-`added`.
- **The asset check failed:** `{"del":{"deleted":true},"gone":200}`. The browser served a deleted asset from its cache under `immutable`. Fixed by revalidating.
- **Blocks test bugs:**
  - Reading `next` right after a turn reused an id: the page rewrites the view 1.5 s after a change, and `channel()` skips ids it has seen, so the bulk turn was never applied. The test now waits for `next` to change and for `applied`.
  - Only tab A was metered at first (0 patches, 2 sets), but tab B took the turn's lease.
  - A hole appended with `+=` is not filled: `channel()` fills only `set` statements whose value is a hole.
- **Model behaviour, not runtime:**
  - glm-5.3-flash with tier `complex` (thinking on) leaked `</think>` reasoning into `text`: "Hi there! 😊We need answer to "Say hi." … </think>Hi there! 👋".
  - In one Blocks run the model wrote a callout line that Hypha rejected: `(rejected: unexpected "icon")`, a missing comma.

### What I learned

- Pinup's upstream code handles an empty db by itself: the first node write also writes `meta/file`. A new design needs no seed version.
- Blocks deduplicates turns by id for the life of the tab. An agent must always use the `next` the view offers.

### What was tricky to build

- **Consent has to come from the shell, not the page.** The page asks with postMessage; the Workshop shows its own dialog and records the answer with the session (`POST /api/rt/views/{v}/consent`). The server checks `rt_consents` on every sample and comments call. So a page cannot grant itself anything.
- **Page tools cross three processes.** The page runs the tool; the server holds the worker's tool call open on a channel keyed by call and use (150 s); the worker resumes the model. Cancellation flows the other way: an aborted fetch or `/cancel` cancels the context, and the Go client sends `cancel` to the worker.

### What warrants a second pair of eyes

- **`staticRuntime` publishes the bound version's `db.json`** on a public route. That is the same exposure as the version's files, but `db.json` holds every node.
- **The sample audit row** is the only accounting; there is no queue or budget (by decision).

### What should be done in the future

- The open tasks in `tasks.md`:
  - the francois run of the conformance pages;
  - Node and Pi in the image, and Pi credentials on the cluster;
  - the cluster's live designs, lost with the `docs` table;
  - `publish(files)`;
  - the sample admission queue;
  - the top bar's picker on `/run`.

### Code review instructions

- **Start with:** `web/workshop/src/screens/AppScreen.tsx`, `pkg/server/rt_sample.go`, `web/runtime/src/sample.ts`, `web/pinup/slop/js/00-slop.js`, `pkg/server/serve.go` (`staticRuntime`).
- **Run** (local server with `--pi-worker` and the lunaroute tiers; apps pushed as in the tests' headers):
  - `node web/rt-conformance/run.mjs http://localhost:18140 [rt-sample]`
  - `node web/pinup/slop/tests/live.js design-live`
  - `node web/blocks/test/live.js <empty workspace>`

### Technical details

- **Sample on the wire:**
  - `POST /_rt/sample {input, modelTier, model?, effort?, tools?, images?}` streams `call {call}`, then `text {text, delta}` and `thinking`, then `tool {use, name, input}`, then `result {text, truncated, modelTierApplied, modelApplied?, modelUsed}` or `error {code, message, text?}`.
  - A tool's result goes to `POST /_rt/sample/{call}/tools/{use} {value, isError}`, at most 32 KB.
- **Pi:** worker `ready` reported 48 models. The tiers come from `--model-*`; `settings.json` `enabledModels` scopes the default.
