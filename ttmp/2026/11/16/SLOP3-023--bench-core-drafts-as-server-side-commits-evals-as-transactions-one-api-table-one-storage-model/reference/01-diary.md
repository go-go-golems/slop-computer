---
Title: Diary
Ticket: SLOP3-023
Status: active
Topics:
    - architecture
    - apps
    - agents
    - tools
    - publishing
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of SLOP3-023: from the review-findings analysis to the guide and its delivery."
LastUpdated: 2026-11-16T13:21:23.643632289-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: The guide — from review findings to a rewrite plan

The user asked whether the recent code-review rounds pointed at an API failure, then how I would refactor with no legacy burden, then for this ticket and a guide a new intern could follow. I tallied every Codex finding on #47, #48 and #50, traced them to the bench's browser-side replica of the app's files, and read the server's store and verb code to make sure the replacement (`files.commit` in one store turn) is built from primitives that already exist. The guide is in `design-doc/01-…`, revised once after a full reread, and uploaded to reMarkable.

### Prompt Context

**User prompts (verbatim):**
- "is there something in the last couple of code review rounds that poiint towards ann api failure / refactoring things to make such errors impossible to express / handling them in a systemic fashion around a core modular component core / simplicity and robustness in API design"
- "how would you refactor / tighten things up (remembhr we don't have any legacy burden and can do any cutover we want, even if that means invalidating deployed data or APIs)."
- "Create a new docmgr ticket for that and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

**Assistant interpretation:** Write the refactor I proposed as a self-contained guide: slop concepts, the bench today, the evidence, the design with APIs and pseudocode, a phased plan and tests. File it in a new ticket and deliver it to reMarkable.

**Inferred user intent:** A document someone else (or a later session) can implement from, without this conversation.

### What I did

- **Tallied the findings:** saved each PR's review comments with `gh api --paginate repos/go-go-golems/slop-computer/pulls/<n>/comments` and grouped the 26 Codex findings by file and cause.
  - 12 in `03b-slop.js`, 6 in `04-project.js`, 5 in `apps/bench/actor.js`, 2 in `06-agent.js`, 1 in `09-views.js`.
  - Causes: inferred sync state (10), ownerless holds (4), "current project" defaults (2), rules in several places (2), document-size workarounds (3), unpinned or impure server reads (5).
- **Read the server primitives the design needs** (at `main` 084eaa2):
  - `pkg/store/files.go`: the tree zone, `Snapshot` (deduplicates an identical tree), `RefAt` and `MoveRef`, `SnapshotFiles`.
  - `pkg/store/turn.go:70`: `Store.Do`, one serialized SQL transaction.
  - `pkg/commands/files.go`: `push`, a manifest with `prune`; `ifAt` checked in the same turn.
  - `pkg/doors/actors/modworkshop.go:17`: the workshop table.
  - `apps/bench/actor.js`: `sync`, `head`, `preflight`, `publish`.
- **Read the client:**
  - `03b-slop.js`: `Sync`, `Outside.mergeIn`, `Embeds`, `Publish`.
  - `04-project.js`: the `Project` fields, the log chunks and pieces, `openApp`.
  - `03-store.js`: the per-user documents and write queue.
  - `06-agent.js`: `hostAPI`, the `tx.*` and `dry.*` APIs, `runEval`, `delegate`, `API_SIGS`, `LONG_CALLS`.
  - `worker.js:242`.
- **Ticket and documents:** created SLOP3-023 (`docmgr ticket create-ticket`) with the design doc and this diary, in a worktree from origin/main (`task/slop3-023-docs`).
- **First draft:** about 800 lines, then a full reread with review notes before revising (below). 17 passages revised; 10 code lines wrapped to 88 characters for the PDF.
- **Checks:**
  - `docmgr doctor --ticket SLOP3-023 --stale-after 30`: all checks passed.
  - The guide's suggested first command runs and passes (`TestFilesAndSnapshots`, `TestRefMoveIfAt`, `TestPushActivates`, `TestPushIfAt`).
- **Upload:** `remarquee upload bundle … --name "SLOP3-023 Bench core rewrite guide" --remote-dir /ai/2026/11/16/SLOP3-023 --toc-depth 2` → `OK: uploaded SLOP3-023 Bench core rewrite guide.pdf -> /ai/2026/11/16/SLOP3-023`.

### Review notes (second pass, before revising)

**Accuracy:**
- Group F was labelled "reads of names instead of numbers", but "Keep production status collection from activating instances" is a read with a side effect (`app.status` activating). Relabelled, with the fifth case explained.
- "About 120 host-API functions": the namespaced calls number about 100.
- Prune line reference: `files.go:418-431`, not `425-437`.
- Activation happens on an instance's next use (or at once when a push names it in `activate`), not the moment the ref moves.
- `slop publish` and "slop store rm of documents" are not real commands; rewritten.
- The first command used `./pkg/commands -run 'Push|Ref'`; the push tests are in `pkg/host/devloop_test.go` and the snapshot test in `pkg/store`. Phase 1's test location was fixed the same way.
- "Under today's code the last push wins": in one browser the later *write* wins inside `P.files`.

**Comprehension:**
- It didn't say who calls `Sync.schedule` (`P.write` does, `04-project.js:69`).
- `cache.remember` hid that a merged-over snapshot's files may need one `files.ls`.
- It didn't say what happens to a transaction after a conflict (it stays open; the eval drops it, the editor shows a merge).

### Why

- **ASCII diagrams, not Mermaid:** the reMarkable PDF goes through pandoc, which renders code blocks as-is.
- **Line numbers pinned to `main` 084eaa2:** #50 (holds as tokens) was still open, and the design replaces those internals anyway.

### What was tricky

- **Keeping current and proposed apart** in sections that discuss the same names (`tx.*`, `runEval`, `Outside`). Each section says whether it describes today or the design.
- **The frame-visibility consequence:** with write buffers, an eval's frame checks see draft, not its own uncommitted writes. The guide states it, the API guide will need to say it, and previews of a transaction are left as an open question.

### Future

- Phases 1–4 (tasks `xzku`, `7wa5`, `xv3h`, `ozs3`).
- Open decisions are listed in the guide's section 8: commit granularity for typing, conflict presentation, previewing a transaction, per-developer refs, the event stream.

## Step 2: Starting the implementation — scope, branch, and the server half delegated

The user asked to implement the rewrite in this session and to remove deprecated and compatibility code on the way. I based the work on PR #50's head (still open, approved by Codex) so it would not conflict with #50's changes to `Sync`, cherry-picked the guide commit onto it, and split the work: a subagent builds the server half (`files.commit` and the precondition clean-up) in its own worktree while I rebuild the bench. Reading the bench end to end changed the scope. Most of its code is Sitebench, the browser-only artifact it grew from (local projects in browser storage, mock `site.db` tables, an in-browser page builder, coffee-shop templates), and for an app project the mock path is already wrong: scenarios and fixture frames tested a mock of the data, not the app.

### Prompt Context

**User prompt (verbatim):** "Ok, let's implement the refactor while we are at it. Use the occasion to clean any deprecated or backwards compatiblity code, the goal is clean simple composable robust core apis"

**Assistant interpretation:** Implement SLOP3-023's four phases now, removing legacy paths rather than keeping them alongside.

**Inferred user intent:** A bench whose core APIs are small and hard to misuse, with no second (artifact) mode to maintain.

**Commit (code):** none in this step (setup and delegation).

### What I did
- **Branch:** `task/slop3-023-core` from `origin/task/slop3-022-overlap` (90f2598, #50's head) in worktree `$S/t23`; cherry-picked the guide commit 501f877 as 11edca9.
- **Server subagent:** worktree `$S/t23s`, branch `task/slop3-023-server` from 11edca9. Its brief:
  - `files.commit` (change list against a required `base`, per-file merge in one `Store.Do` turn, typed output, conflict `Extra {at, conflicts}`), with `Turn.SnapshotFiles`/`Turn.ResetTree`;
  - required `ifAt` on `files.push`, `ref.move` and `snap.new`; `files.push` loses its unused `prune`/`snapshot`/`zone` knobs; every caller updated (CLI push and ref move, `slop dev`, blocks-site);
  - `workshop.commit`; removing the `self` capability alias; Go tests including two goroutines committing against one base;
  - its own diary.
- **Follow-up messages to the subagent:**
  - `ref.rm` (required `ifAt`, refuses `main`) with `workshop.dropRef`, and `store.ValidRefName` (an all-digit ref name is ambiguous with a snapshot number in `Store.Ref`);
  - a `from` option on `files.commit`, then retracted: `ref.move {ref: proposal/<id>, n, ifAt: 0}` creates a proposal ref already;
  - verb error extras through to actor JS: `pkg/actor/actor.go`'s `Error` is `{Code, Message, Confirm}`, so a conflict's `at` and paths were lost inside an actor;
  - the diary format and commit cadence (after the user's diary request, Step 5).
- **Scope reading:** `05-site.js` (`embeddable` is true only for the dev instance's entry page; every other frame is a `srcdoc` build from project files with mock tables), `05c-scenarios.js`, `06-agent.js` in full, the actor, `02-templates.js`, `11-app.js`'s new-app dialog.
- **Ticket tasks** `t0du`, `ro74`, `hsvy`, `dyjb`, `3y88`, `qtpr`, `uksw`: actor; client storage; Project on Draft; frames are always instances; evals on transactions and the API table; views and shell; tests and docs.

### Why
- **Based on #50, not `main`:** #50 rewrites `Sync`'s holds; branching from `main` would conflict in the very code being deleted. When #50 merges, a rebase drops its commits and the cherry-pick (same patch).
- **Server delegated:** its contract fits in a page, it touches only Go and the CLI, and it runs while the client is rewritten against the same contract (with a fake server in the Node test).
- **Every frame shows an instance** (dev, test, prop): the mock-data path cannot test a real app (its actor, its SQL), and removing it removes the largest legacy surface.

### What worked
- The contract was stable enough to write the Draft core and the actor before the server landed.

### What didn't work
- No failures in this step.

### What I learned
- `actor.Error` has no field for structured data, so any verb error's `Extra` is lost on the way into an actor. The old `sync` action worked around it by re-reading refs after a conflict.
- Ref names are not validated anywhere (`MoveRef` inserts any string).

### What was tricky to build
- Choosing the base branch: the refactor deletes code #50 is still changing, so either base risks conflicts. Basing on #50 keeps the conflict-free path.

### What warrants a second pair of eyes
- Dropping Sitebench features: the playhead (frames at a past timeline point), fixture clocks, `site.store`, Sitebench JSON import/export, project duplication. These are listed in the ticket and the PR; any that should survive needs an instance-based design.

### What should be done in the future
- After #50 merges: `git rebase origin/main` on `task/slop3-023-core`.

### Code review instructions
- The subagent's brief is the specification of the server half: compare it with its diary, `reference/02-…`.

### Technical details
- The new instance names are `<app>-<kind>-<first six characters of the user id>`; dev keeps `slop dev`'s name.

## Step 3: The Draft core and its property test

I wrote the browser half of the design as one module with its I/O injected, then tested it against a fake server under random interleavings before building anything on it. The test found a real bug in the person's edits, which I fixed. 3×1000 random programs now pass the four invariants.

### Prompt Context

**User prompt (verbatim):** see Step 2.

**Assistant interpretation:** Phase 2's core first, proven in isolation.

**Inferred user intent:** Robust core APIs: the part that decides what reaches the server must be correct by construction and by test.

**Commit (code):** 4776dd5 — "Bench: the Draft core — snapshot cache, transactions, the person's edits (SLOP3-023)"; the wire vocabulary `delete: true`, commit events and head sources in 0426050.

### What I did
- **`Draft`** (now `web/bench/src/core/draft.js`):
  - listings by snapshot number and texts by sha256, with `load(n)` reading in pages (`read` answers `more`);
  - `moveHead(n, source)`, serialized through a promise queue;
  - `refresh()` ignores a poll that a commit overtook (an `epoch` counter);
  - `commitChanges` sends `{path, text} | {path, delete: true}` and returns a typed result.
- **`Tx`:**
  - reads: own change, then the parent's view, then the base snapshot (`live` Txs read the head);
  - `child()` and folding commits;
  - `abort()`; `diff()`.
- **The person's edits:**
  - one live Tx, committed after `EDIT_PAUSE`;
  - `settle()`, `keepMine()`, `takeTheirs()`;
  - `rebaseEdits()` on each head move;
  - `conflict` kept as state for the header.
- **`test/draft.test.mjs`:**
  - a fake server with `files.commit`'s rules and random latency, and a seeded generator;
  - random programs: two eval loops with delegated sub-transactions, outside commits, typing, polling;
  - invariants: committed means committed; nothing aborted reaches the server; conflicts write nothing; reads are own > parent > base;
  - plus four directed tests (fold into an ended parent; empty commit; edits follow the head; keepMine/takeTheirs).

### Why
- **Content-addressed text cache:** a snapshot never changes, so the cache needs no invalidation.
- **A conflict comes back as a value (`{conflict: {at, paths}}`), not a thrown error:** actor errors could not carry the paths (Step 2).

### What worked
- `RUNS=1000 node --test test/draft.test.mjs`, three times: `runs 1000 { committed: 3469, conflicts: 5536, folded: 3596, aborted: 5378 }`, `ℹ pass 5`, `ℹ fail 0` (and similar).

### What didn't work
- **Run 1:** `AssertionError: the person's edits reach the server` (`true !== false`).
  - The person kept keepMine-ing against writers that were still committing. That is a legitimate conflict, so the test now settles after the writers finish.
- **Run 2:** `AssertionError: the person's last edit of data/a.json` (`actual: 'a:47:652280'`, `expected: null`).
  - The check was too strong: an eval whose base already had the removal may write the path again.
  - The check now uses the server log: the last edit was committed, and only a later commit changed the path.
- **Run 3:** `the person's edits reach the server` at `FAILED at SEED=180`, while `SEED=180 RUNS=1` alone passed (timer ordering, not the seed).
- **Real cause:** `settle()` set `this.edits = null` while a commit was in flight. Keystrokes typed meanwhile started a new Tx at the old base, so the next commit conflicted with the person's own previous commit, and the view briefly showed the old text.
- **Fix:** one live Tx that stays. `settle()` sends a copy, removes the sent changes that were not retyped, and moves the base to `r.n` unless someone else changed one of the remaining paths.

### What I learned
- A test of "the latest value is on the server" is only valid once concurrent writers stop. During concurrency the right check is the commit log.

### What was tricky to build
- **Edits typed during an in-flight commit.** They were typed over a view that already shows the sent text.
  - So their base is the new snapshot `n`, unless someone else changed one of their paths between the old base and `n`.
  - `others = changed(base, r.n) minus sent paths`; the base moves only when the remaining paths avoid `others`.

### What warrants a second pair of eyes
- `commitChanges` moves the head only when `r.n > head`. That relies on snapshot numbers growing, and on a rollback being seen by a poll, not a commit.
- The `epoch` rule in `refresh()` drops a poll that a commit overtook. Check that a later poll always follows.

### What should be done in the future
- A per-path view of conflicts in the code view (keep mine / take theirs per file).

### Code review instructions
- Read `src/core/draft.js` top to bottom, then the invariants in `test/draft.test.mjs`.
- Run `cd web/bench && RUNS=1000 node --test test/draft.test.mjs`; replay one program with `SEED=… RUNS=1`.

### Technical details
- Result shapes:
  - `{status: 'committed', n, at, merged, activated, event, paths}`
  - `{status: 'folded', paths}`
  - `{status: 'conflict', at, conflicts: [path], paths}`
  - `{status: 'failed', code, error, paths}`
- Events: `'head' (n, prev, paths, source)`, `'commit'`, `'edits'`, `'conflict'`, `'error'`.

## Step 4: The bench actor rewritten for commits, instances and SQL records

The actor is the bench's whole server surface, so I rewrote it in one piece against the design:
- files read at snapshot numbers;
- commits through `workshop.commit`, with the timeline event written by the actor itself;
- the person's instances by kind;
- proposals as refs;
- everything the bench records about a project in its own SQL tables.

It is untested until the server branch lands (`workshop.commit`, `dropRef`, `e.extra`).

### Prompt Context

**User prompt (verbatim):** see Step 2.

**Assistant interpretation:** Phases 1 (actor side) and 4 (storage) of the guide.

**Inferred user intent:** No browser-side copies of anything the server has; per-person records the bench can rely on.

**Commit (code):** a31db9b — "Bench actor: commits at numbers, instances by kind, proposals as refs, records in SQL (SLOP3-023)"

### What I did
- **`apps/bench/sql/001_bench.sql`:** `projects`, `threads`, `messages`, `events`, `snaps`, `proposals`; every row keyed by app and owner.
- **`apps/bench/actor.js` actions** (each listed in its header comment):
  - files: `head {app, ref} → {n}`, `files`, `read` (numbers only, via `snap()`);
  - writes: `commit` (conflict as a value; activates the visitor's instances that follow the ref, by peeking their status; logs `{kind: 'commit', n, paths, base, at, merged}`);
  - instances: `status`, `instance`, `reset`, `embed`/`renew`/`close`, `logs`, `docs`/`doc`/`sql`, `seed`;
  - proposals: `propose`, `proposals`, `closeProposal`;
  - publishing: `preflight`, `publish` (logs a `publish` event), `activate`, `create` (a first commit with base 0);
  - records: `project`, `saveProject`, `forget`, `thread`, `saveThread` (messages replaced from a position), `dropThread`, `logEvents`, `events`, `snaps`, `snap`, `saveSnap`.
- **Removed:** `sync`, `head`'s merge answer, `dev`/`resetDev`/`seedDocs`/`seedTable`.

### Why
- **Events per owner:** `msg` and `turn` events carry the person's own request text, so a shared timeline would leak private threads. Other people's commits show up as `outside` events.
- **The actor writes the commit event:** the page cannot forget to, and the event carries the snapshot number the server returned.

### What worked
- `node --check apps/bench/actor.js`.

### What didn't work
- `closeProposal` first selected `owner, status` but used `p.title`. Fixed before the commit.

### What I learned
- An app gets `use('sql')` from its `sql/` migrations alone; no capability is declared (`apps/catalog-data`).

### What was tricky to build
- **Activating followers without side effects.** A plain `status` activates the instance, so `followers()` peeks the three kinds and passes the ones on the ref to `activate`.

### What warrants a second pair of eyes
- **Two stores, no shared transaction:** the commit (app store) and its event row (bench store). A failure between them leaves a commit without an event.
- The `create` action calls `workshop.commit` with `base: 0` on a brand-new store.

### What should be done in the future
- Rewrite `pkg/host/bench_test.go` for these actions once the server branch is merged.

### Code review instructions
- Start at the header comment of `apps/bench/actor.js`, then `commit` and `followers`, then the records actions against `sql/001_bench.sql`.

### Technical details
- Instance ids: `instanceId(app, person, kind)`.
- Bench refs: `draft` and `/^proposal\/[a-z0-9][a-z0-9-]{0,40}$/`.

## Step 5: Restructuring the source into layers, and the design doc section on it

Mid-rewrite, the user asked how big the bench's files are and whether to modularize them, then asked for a design-doc section on restructuring and to apply it as the work goes on. I measured the files and the dependencies between them, wrote section 6 of the guide (principles, layout, layer rules, module anatomy, documentation, tooling, migration order), and built a tool that writes and checks every module's imports, including the layer rule. The bottom three layers (lib, core, server) are in place and check clean. The rest still uses the old globals, and `build.mjs` still concatenates.

### Prompt Context

**User prompts (verbatim):**
- "how big are our js files and would modularizing them / structuring them a bit more coherently make sense?"
- "ok, add a detailed section to the design doc on restructuring the codebase to make it more readable and manageab eand easily documented and understood. then apply those principles as you move on"
- "commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill) (also for subagents who should write their own diaries in the same format0. backfill if necessary (for both)"
- "continue"

**Assistant interpretation:** Answer with numbers, document the principles in the guide, restructure while rewriting, and keep commits and diaries current (backfilled from Step 2).

**Inferred user intent:** Source a newcomer can navigate and that documents itself, written once rather than reorganized later.

**Commit (code):** 0426050 — "Bench source: ES modules in layers — lib, core, server (SLOP3-023, design doc section 6)"

### What I did
- **Measured:** 7,100 lines, 550 KB of source.
  - `06-agent.js` is 972 lines and 98 KB, mixing five concerns.
  - A Python scan of top-level names showed `App` used by 13 of the other 19 files.
- **Guide section 6** (inserted before the plan; sections 7–10 renumbered, cross-references updated):
  - principles; layout; layer table; module anatomy; how the shell hands state down (`ctx.ui`);
  - documentation (headers, folder READMEs, a generated API reference); tooling; migration order.
- **`web/bench/tools/imports.mjs`** (acorn, already a devDependency):
  - free identifiers per module, resolved against other modules' exports;
  - `--write` rewrites the import block; the default mode checks;
  - it reports unresolved names, double exports, modules outside a layer, and imports from a higher layer.
- **The three layers:**
  - `lib/util.js`, `lib/dom.js`, `lib/text.js`, split out of `01-util.js`;
  - `core/draft.js`, whose test imports it as a module;
  - `server/slop.js`, `instances.js` (`Watch.onLog` replaces `App.consoleAdd`), `publish.js` and `records.js`.
- **The worker:** `src/worker/{worker,core}.js`.
- **`package.json`:** `"type": "module"`, plus `test` and `imports` scripts.

### Why
- **Restructure now:** the rewrite touches most files anyway, so restructuring later would touch every file twice.
- **A tool, not hand-written imports:** 20 files, each using 10–40 names from others, would go stale by hand. The check turns a missing import into a build error instead of a runtime `ReferenceError`.

### What worked
- `node tools/imports.mjs` reports nothing for `lib/`, `core/` and `server/`.
- `node --test test/draft.test.mjs` passes against the moved module.

### What didn't work
- **acorn was missing:** `node -e "require('acorn')"` gave `Error: Cannot find module 'acorn'`, because the bench's `node_modules` was not installed.
  - `npm ci --no-audit --no-fund` fixed it, with an `npm warn allow-scripts` notice about esbuild's install script.
- **The first `--write` reached files it should skip:** `core.js` and `worker.js` were still in `src/`, so the skip list (`worker/…`) did not match. It reported `core.js: uses sleep from lib/util.js, a higher layer` and `worker.js: unresolved __CORE_SRC__, acorn, getQuickJS, …`, and rewrote both.
  - Fixed with `git checkout -q src/core.js src/worker.js`, then `git mv` to `src/worker/`.
  - It also added lib imports to every old `NN-*.js` file; I restored those with `git checkout` before committing, since they move later.
- **A heredoc chain deleted an uncommitted file.** The splitting script failed with `ValueError: substring not found` (it looked for the old comment `// Publishing (Phase 5)`).
  - The `git rm -q -f 03-store.js 03b-slop.js && cd .. && node tools/imports.mjs --write` line after the heredoc is a separate command, so it ran anyway and deleted my new, uncommitted `03b-slop.js`.
  - I recreated `server/slop.js`, `instances.js` and `publish.js` from that file's text, which I had written earlier in the session. `server/records.js` had been written before the failure.

### What I learned
- After a heredoc, the next line is a new command: `&&` on the line before the heredoc does not guard it. Destructive commands go in their own call, after checking the previous result.

### What was tricky to build
- **Separating references from property names in the tool.** A free identifier is any `Identifier` except a non-computed member property, a non-computed object/class key, a label, or an import/export specifier.
  - Names declared in any scope count as local, so an inner variable that shadows an export suppresses its import.
  - That's a known approximation: harmless when another use in the module is top-level, but it can hide a missing import when the only use is shadowed.

### What warrants a second pair of eyes
- The layer order `lib → core → server → model → frames → agent → ui → main`.
- `model/` imports `server/` (the Project calls the actor through `Slop` and gets Drafts from `Drafts`). That's deliberate: the model is the client's view of server state.

### What should be done in the future
- Migrate the remaining layers (model, frames, agent, ui).
- Switch `build.mjs` to esbuild with the import check, add folder READMEs, and generate the API reference.

### Code review instructions
- Guide section 6, then `web/bench/tools/imports.mjs`, then the headers of `src/lib/*.js`, `src/core/draft.js` and `src/server/*.js`.
- Run `cd web/bench && node tools/imports.mjs` (it lists every not-yet-migrated `NN-*.js` problem; the three migrated layers must not appear).

### Technical details
- Layers: `LAYERS = ['lib', 'core', 'server', 'model', 'frames', 'agent', 'ui', 'main.js']`; `layerOf(file)` is the index of the file's top folder.

## Step 6: The model and frames layers

With the bottom layers in place, I wrote the project model and the frames layer for the new design. A project is now its Draft plus the person's records on the server. A frame now always shows one of the person's instances (dev, test or prop), so the in-browser page builder, the mock data, the playhead and the probe's `window.site` mode are gone. Scenarios run on the test instance, reset and seeded with their fixture. Both layers pass the import check, including the layer rule.

### Prompt Context

**User prompt (verbatim):** see Steps 2 and 5.

**Assistant interpretation:** Phases 2 and 4 on the client, written to section 6's rules.

**Inferred user intent:** A model with one source of truth, and frames that show what really runs.

**Commit (code):** 825040b — "Bench source: the model layer — project, timeline, templates (SLOP3-023)"; 696018e — "Bench source: the frames layer — every frame is an instance (SLOP3-023)"

### What I did
- **`model/project.js`** has two parts.
  - `Project`, with workspaces named by ref (`draft`, `proposal/<id>`):
    - files: `draftOf`, `view`, `read`, `entry`, `list`, `write`, `remove`;
    - proposals: `propose`, `changes`, `accept` (one commit over the proposal's base, by `Tx.copy` for files kept by hash), `reject`, `close`;
    - the timeline: `log` (numbered by the server through an outbox), `addEvent` (commit events from the answer), `mark`;
    - threads: `newThread`, `loadThread`, `saveThread` (messages sent from the first one that changed, compared as JSON); the canvas.
  - `Projects`: `open`, `create`, `forget`, `recent`.
- **`model/timeline.js`:** `snapshotAt`, `versions` (listings only), `blame` (texts by hash, cached per path and head), `why`, `since`, `restore`.
- **`model/templates.js`:** two working app templates (a page with the db; a page with an actor and a SQL migration). I checked the runtime's `collection().get()` (`.docs`) and `add()` in `pkg/doors/pages/assets/claude.js`.
- **`core/draft.js`:** `Tx.copy`, `Draft.listingOf`, `Draft.text`; a test for copy (6 tests pass).
- **`frames/`:**
  - `host.js`: FrameHost is embed-only, with `FrameHost.ui` hooks and recording;
  - `probe.js`: embedded-only;
  - `layout.js`: diffs, plus Snaps through the actor;
  - `streams.js`;
  - `scenarios.js`: `Fixtures.apply`, `runScenario`, `runAllScenarios`.
- **`core/scenario.js`:** specs. Fixtures are `{docs, tables}`; the `data` and `store` steps became `sql` and `docs`.
- **Actor:** `snaps.doc`; test instances may follow a proposal.

### Why
- **`FrameHost.ui` hooks:** the frame host used `App` for twelve things. Hooks with no-op defaults keep `frames/` below `ui/`, as the layer rule requires.
- **One snapshot document per row, CSS inline:** the old CSS deduplication by hash existed to fit 256 KB documents. The actor's limit is 4 MiB.
- **A reset before every scenario:** the old runs used a private copy of the mock data. The equivalent for a real app is fresh instance data.

### What worked
- `node tools/imports.mjs` reports nothing for `lib`, `core`, `server`, `model` and `frames`.
- `node --test test/draft.test.mjs`: 6 pass.

### What didn't work
- **The import tool imported a local name.**
  - Symptom: `server/publish.js: uses why from model/timeline.js, a higher layer`, with `import { why }` written into `publish.js`, which only has a local `const why`.
  - Cause: the tool resolved names against other modules' exports before checking local declarations.
  - Fix: real scope resolution. A probe module with an undefined `zzz`, a shadowing `why` and a block-scoped `Slop` is now reported correctly.
- **Every `--write` rewrote the unmigrated `NN-*.js` files.** Each run added lib imports to them. I restored them with `git checkout`, and the tool now only reports files outside a layer.
- **The extraction script for `frames/layout.js` stopped on its own assertion.** `'cssText' not in render` was meant to prove the old CSS cache was gone, but the drawing script sets `d.style.cssText`. I dropped that check.

### What I learned
- An import tool that only approximates scoping is worse than none: its mistakes look like real imports. Hoisting and the scope chain are 60 lines.

### What was tricky to build
- **Accepting a proposal over its base, not over draft's head.** The commit's `base` is the proposal's base snapshot. The server then merges per file with everything that reached draft since, and a conflict means both changed a file.
  - Files kept by hash need `Tx.copy`, because the Tx used to carry text only.
- **Proposal Drafts are made lazily** (`draftOf`) and dropped on close. Each Draft's events are wired to the project once (`watch`).

### What warrants a second pair of eyes
- **The outbox in `Project.log`:** events show at once with `seq: null` and get their number when saved; a failed batch is put back and retried.
  - Sorting by `seq ?? Infinity` keeps unsaved events last.
- **Every scenario resets the test instance.** That's correct, but costs a store drop and create per scenario. Measure it on staging.

### What should be done in the future
- `compareModal` (DOM, in the old snapshots file) and the recording dialog move to `ui/`.

### Code review instructions
- `src/model/project.js` (accept, log/flushEvents, saveThread).
- `src/model/timeline.js`.
- `src/frames/host.js` (load, swap, `FrameHost.ui`).
- `src/frames/scenarios.js` (`Fixtures.apply`, `runScenario`).
- `node tools/imports.mjs` must report nothing for these layers.

### Technical details
- An embed's URL for a page: `new URL(route, e.src)` with `sbn=<nonce>` and the route's hash.
- The test instance follows `draft` or the proposal given (actor `instance`: dev → draft; test → ref or draft; prop → ref).

## Step 7: The server half lands; the actor proven against a real server

The server subagent finished (its diary is `reference/02-diary-server-phase-files-commit.md`, six steps) and I merged its branch. With `files.commit`, `ref.rm`, required preconditions and error extras in actor JS available, I replaced the old bench tests (written for `sync`, `dev`, `resetDev`) with tests of the new actions against a real server. All seven pass. One of them found a real bug in `closeProposal`, fixed in the same commit.

### Prompt Context

**User prompt (verbatim):** see Steps 2 and 5.

**Assistant interpretation:** Integrate phase 1 and prove phase 4's actor before building the client on it.

**Inferred user intent:** Each layer correct before the next depends on it.

**Commit (code):** 9d40191 — "Merge branch 'task/slop3-023-server' into task/slop3-023-core"; ce066db — "Bench actor: tests against a real server; closing a proposal its test instance follows (SLOP3-023)"

### What I did
- **Merged** `task/slop3-023-server` (9aae6b8, d34c438, e8c6e9a, 81b64e6, cd9d93a) with no conflicts.
- **Checked the merged tree:**
  - `go build ./...`;
  - `go test` over store, commands, client, doors, cmd, rt and actor: all ok;
  - `pkg/host`: the four old bench tests and `TestBuildOutputsFresh` failed, as expected.
- **Rewrote `pkg/host/bench_test.go`:** `TestBenchFiles`, `TestBenchCreate` (un-skipped), `TestBenchInstances`, `TestBenchProposals`, `TestBenchInstanceData`, `TestBenchRecords`; `TestBenchPublish` unchanged.
- **Fixed the actor:** `closeProposal` moves the visitor's test instance back to draft before `dropRef`; `seed` names documents by `id`.

### Why
- **Test the actor through `actor.call` on the test harness:** it is the whole server surface the page uses, so the page code can then be debugged against known-good answers.

### What worked
- `go test -count=1 -v ./pkg/host -run TestBench`: `--- PASS` for all seven (0.13–0.17 s each). The two `SKIP`s are the pre-existing `SLOP_BENCH=1` benchmarks.

### What didn't work
- The first test run printed only `ok … 1.101s`. That was too fast to trust, so I reran with `-v`: the tests had run.
- No failures in the new tests.
- The bug was found while writing the proposal test, before running it. `ref.rm` (server) refuses a ref that a store follows (`extra.stores`). A reviewer's scenario runs make the test instance follow the proposal, so closing that proposal would have failed.

### What I learned
- From the subagent's report:
  - a commit whose ref was removed since `base` (`at == 0`, `base > 0`) is a conflict, so it cannot silently recreate the ref;
  - `rtFail` in the page door does not carry `extra` to a page, so actors must turn conflicts into values (as the bench actor does);
  - `slop dev` reads `ifAt` just before each push, so it still overwrites commits made by others since its last push.

### What was tricky to build
- **Activation by commit.** The actor passes the instances that follow the committed ref (peeked) to `activate`.
  - The test checks that the answer's `activated` names the dev instance at the new `n`.
  - It also checks that `status` afterwards (a peek) reports the same `n`.

### What warrants a second pair of eyes
- **The subagent's decisions:**
  - `apps/workshop/actor.js` file edits now commit with `base: n`, merging where they used to replace;
  - tree-zone writes (`files.put`, `files.rm`, `import.files` into the tree) are replaced or reset by the next push or commit; the subagent suggests removing them;
  - ticket scripts under `ttmp` for SLOP3-004/013/015/018 call `files.push` without `ifAt` and will fail now.

### What should be done in the future
- `TestBuildOutputsFresh` passes once the module build produces `apps/bench`.
- Decide on the tree-zone verbs (follow-up).

### Code review instructions
- `pkg/host/bench_test.go` top to bottom, against `apps/bench/actor.js`.
- `GOWORK=off go test -tags sqlite_fts5 -count=1 -v ./pkg/host -run TestBench`.

### Technical details
- A conflict from the actor: `{conflict: {at, paths}}`, e.g. `{"at":5,"paths":["README.md"]}`; `ref.ls` is unchanged afterwards.

## Step 8: The agent layer — evals as transactions, one API table

This step turned the 979-line `06-agent.js` into `agent/`, following guide sections 5.4 and 5.5. An eval is now a `Tx` on the workspace's Draft, and every host-API call is declared once in a table. The rollback machinery, sync holds, flushes, `API_SIGS`, `checkArgs`, `LONG_CALLS`, the worker's `LONG` set and every hand-placed guard are gone. The API table and the transaction side of the API have Node tests (11 tests); the sandbox and frames need a browser and are not run yet.

### Prompt Context

**User prompt (verbatim):** see Steps 2 and 5.

**Assistant interpretation:** Phases 3 and the eval half of phase 2, in the agent layer, following section 6.

**Inferred user intent:** The agent's writes are atomic and composable on the server's terms, and its API cannot drift from its checks.

**Commit (code):**
- cd23abd — "Bench source: the host API as one declared table (SLOP3-023)"
- 1820989 — "Bench source: the agent layer — evals as transactions, the host API as one table (SLOP3-023)"

### What I did
- **`core/api.js`:** `defineAPI(...tables)` takes entries `{sig, doc, writes, pathOf, long, internal, run}`. One `call(ctx, name, args)` does three things:
  - checks the arguments against `sig`;
  - guards the modes: a read thread changes nothing; a tests thread writes only `scenarios/` and `fixtures/`;
  - applies the dry-run rule: only `writes: 'files'` passes inside a dry run.

  `long()` and `reference(notes)` are derived from the same table.
- **`agent/api/*.js`:** one table per namespace (files, app, frames, tests, session, ui, lib, tx, agents), assembled in `index.js`.
  - Reads and writes go through `ctx.tx`.
  - `tx.*` and `dry.*` are child Txs on a `ctx.stack`.
  - `dry.end` keeps the child's changes as a changeset; `dry.apply` copies them in.
- **`agent/eval.js`:**
  - `makeContext`, plus `AgentUI` hooks that the shell sets;
  - `runEval`: begin (or a child of `parentTx`), run, then on failure drop the Tx;
  - on success, commit. A `folded` result becomes an effect. A `committed` result waits for the frames to reach `c.n`, then measures effects. A `conflict` result fails the eval with kind `conflict` and refreshes the head.
- **`agent/effects.js`, `agent/roles.js`, `agent/guide.js`:** `guide.js` is slop-only; the reference is generated, with a note per namespace.
- **`agent/agent.js`:** turns; summaries; proposals as refs (an empty one is discarded); threads loaded on use; `delegate` passes `parentTx` when the subagent works in the caller's workspace.
- **`agent/sandbox.js`:** the worker bridge, dispatching through the run's API. `worker.js` reads `long` from the eval message.
- **Actor:** `closeProposal` accepts `discarded` and logs no event for it. `Instances.ensure` passes `ref` for test instances.

### Why
- **Dry-run refusal derived from `writes` rather than a `dry: 'refuse'` flag:** what may happen inside a dry run follows from what the transaction can capture (files). A flag would be one more thing to forget, which is the very bug class this phase removes.
- **Write categories named by target (`files`, `dev`, `main`):** the tests-mode and read-mode rules then read directly off the declaration.
- **Scenario runs are not writes.** The guide's reviewer, a read-only role, runs scenarios, and the test instance is scratch space.
- **The guide's `needs: 'app'` is dropped:** every project is an app now.
- **`ctx.agent` carries the agent to `llm` and `agents.delegate`.** This avoids an import cycle between `agent.js` and the API it runs.

### What worked
- `npm test`: 17 tests pass (draft 6, api 6, eval-api 5).
- `node tools/imports.mjs`: no findings in `lib`, `core`, `server`, `model`, `frames` or `agent`. It reports only the nine unmigrated `NN-*.js` UI files.
- `go test ./pkg/host -run TestBench`: ok, including the new `discarded` case.

### What didn't work
- **`node --test test/` failed in Node 24:** `Error: Cannot find module '…/web/bench/test'`. Node 24 no longer takes a directory there. The npm script now uses `test/*.test.mjs`.
- **A precedence slip, caught on review before running anything:** in `frames.compare`, `!(P.proposals.get(what) || {}).status === 'open'` is always false. Fixed to `… .status !== 'open'`.
- **My first `dry.end` classified changes with nested ternaries** and mislabelled copies kept by hash. I rewrote it to branch on the change's kind.

### What I learned
- The import tool earned its keep again. It added `blame` and `why` to `files.js`, which I had used without importing; in the browser that would have been a `ReferenceError` on the first `files.blame`.
- Documents from the actor are `{path, body}` (`store.Doc`), not `{id, data}`. The fixture capture and the scenario `docs` step now read `path` and `body`.

### What was tricky to build
- **A subagent's transaction is the caller's *current* one** (`pctx.tx` when `delegate` runs). Inside an atomic step or a dry run, the subagent's writes fold into that step, which is the semantics a reader of the code would expect.
- **A fixture written earlier in the same eval must be found.** So `Fixtures.apply` and `runScenario` take a `read` function, and the API passes `tx.read`. The scenario still runs on the committed code; the guide says so.

### What warrants a second pair of eyes
- **`afterCommit` waits only for frames whose `ws` matches and whose kind is not `test`,** and only when some activated instance came up unbroken. If no instance follows the ref yet (no dev instance made), effects have no frame part.
- **After a `conflict`, `runEval` calls `d.refresh()`** so the agent's next eval begins at the new head. Check that this cannot race with the person's live-edits Tx.

### What should be done in the future
- The UI layer (dock, canvas, views, panels: these add `ui.panel` and friends with `API.add`, and the panel note to `NOTES.ui`).
- `main.js`, the build, a browser smoke test.

### Code review instructions
- Start with `src/agent/eval.js` (`runEval`), then `src/agent/api/tx.js`.
- Then `src/core/api.js` (`guard`).
- Then `test/eval-api.test.mjs`.
- Run `cd web/bench && npm test && node tools/imports.mjs`.

### Technical details
- An eval's effects when it commits: `{files: [{path, change, add, del}], commit: {ref, n, merged}, instances: [{store, n, broken}], actorLogs, newIssues, fixedIssues, newErrors, layout}`.
- A conflict: `{ok: false, error: {kind: 'conflict', message: 'draft moved to 57 since this eval began on 55, and that also changed index.html: nothing was written. …'}, effects: {conflict: {ref, at, paths}}}`.

## Step 9: The UI layer, the bundling build, and a browser smoke test

This step ported the last concatenated files (`07-dock.js` through `11-app.js`, about 2,500 lines) into `ui/`. It wrote `main.js`, replaced the concatenating build with an esbuild bundle, and ran the bench in a browser for the first time since the rewrite began, on a local slop server built from this branch. The smoke test found four bugs. One predates the rewrite: a new scenario could never pass its first step. All four are fixed. Main (#50, and the SLOP3-024 ticket) is merged in. The Go suite, `go vet`, the Node tests and the import check all pass.

### Prompt Context

**User prompts (verbatim), in order, during this step:**
- "is this the refactoring? in fact, can we turn this into typescript? would that work with slop-computer? or are we currently required to use js"
- "ok let's leave the TS aside for now."
- "like, actually, could we have the server itself use esbuild (which I think is go) as a tool to serve js while we actually always deal with ts?"
- "ok, make a docmgr ticket for the TS stuff, and just make a note to write out the full design later on, for now we just want to remember it."
- "write up a doc with your current notes and knowledge so we can take it up later on."
- "merged #50 btw"

The standing request is in Steps 2 and 5.

**Assistant interpretation:** Answer the TypeScript question, park it as a ticket with notes, finish the UI port in JavaScript, then bring main in.

**Inferred user intent:** Finish the refactor first. Keep the TypeScript idea (the server compiling TS with esbuild) where it can be taken up later.

**Commits:**
- 3d754eb (on main) — "SLOP3-024: ticket and notes — TypeScript compiled to JavaScript by the server (esbuild)"
- 787d6ba — "Bench: the UI layer as modules (ui/), main.js, a bundling build"
- 4dc9716 — merge of origin/main (#50, SLOP3-023/024 ticket docs)
- 19020fd — "Bench: fixes from the browser smoke test; legacy CSS and test scripts gone"

### What I did
- **TypeScript, answered and parked as SLOP3-024.** The bench page could be TypeScript today, since esbuild already builds it; checking types would need `tsc --noEmit`. The actor runs in goja, which runs JavaScript only. The inlined worker core and the probe would need a transform step.
  - The person's idea, the server compiling TS with esbuild's Go API, has its own ticket. `reference/01-notes-typescript-through-esbuild-on-the-server.md` records:
    - what runs JavaScript today, and where;
    - the hook points: `pkg/doors/pages/storebytes.go` `writeStoreBytes`, `pkg/actor/actor.go` `load`/`requirer`, `pkg/commands/eval.go`;
    - the questions a design must settle.

    The full design is a task. It went to main from a worktree off origin/main.
- **`ui/`, one module per view or concern:**
  - `app.js` (the shell) and `dock.js`;
  - `canvas.js` and `snaps.js`;
  - `code.js` (Code and Docs) and `history.js` (Timeline and the blame card);
  - `inspect.js` (Inspector and Layers) and `console.js` (Console and Eval);
  - `data.js`, `threads.js`, `review.js`, `panels.js`, `scenarios.js`, `archive.js`.

  `lib/css.js` took the CSS helpers. On the new model, the views change as follows:
  - **Code:** edits go through `P.write` to `Draft.edit`. A conflict shows Keep mine / Take theirs; both now refresh the head first. History and blame read snapshots (`model/timeline.js`), and a proposal can revert a file to draft's version.
  - **Review:** proposals are refs; their changes are read asynchronously (`P.changes`), and accept commits over the proposal's base. Checks compare layouts against draft and run the scenarios on both.
  - **Data:** reads the person's dev and test instances (`sql`, `docs` actions). It can seed dev from a fixture, save rows as a fixture, and reset dev.
  - **Threads:** load their messages on first show; the composer offers Proposal or Draft.
  - **Panels:** lose the `store` and `fixture` bindings. Widgets read `{sql}` and `{docs}` from an instance. The panel calls are `PANEL_API`, which `main.js` adds with `API.add`, and `PANEL_NOTE` becomes `NOTES.ui`.
  - **Scenarios:** fixtures apply to the test instance. `saveRecording` lives here.
  - **Archive:** a download holds draft's files, the open proposals' changes, the threads with transcripts, the timeline and the meta. An import takes a zip's text files.
- **`main.js`** registers the views by the ids that saved layouts use.
- **`build.mjs`:**
  - runs `tools/imports.mjs`;
  - bundles `src/main.js` (IIFE, not minified) and the worker (`src/worker/`, with `core.js` inlined);
  - splices `frames/probe.js`, minus `export`, into the server probe, and refuses a probe with imports.
- **Merged origin/main.** Main had added the SLOP3-023 ticket docs at their first version, so `design-doc/01`, `reference/01-diary.md` and `tasks.md` were add/add conflicts. Main's copies had nothing this branch lacks: the only differing lines came from the earlier section numbering and the old `03c-draft.js` name. I took the branch's copies.
- **Smoke test on a local server.**
  - I built `slop023` from this branch, stopped my earlier local test server, and copied its data folder to `$S/lslop23/data`; the old folder is untouched.
  - I started the build with the same config, pointed at the copy (port 18490, model `pi` → `lunaroute/deepseek-4.1-flash`). Then I pushed `apps/bench` as store `bench23` with `workshop` trust and `sample` for `@admin`, mounted at `apps.localhost:18490/bench23`.
  - In Playwright:
    1. a new app from the "Page and actor" template;
    2. an eval;
    3. typing in Code;
    4. a forced conflict and Keep mine;
    5. a proposal by hand, changed by an eval and accepted;
    6. Timeline and Data;
    7. a reload;
    8. History and Blame;
    9. a new scenario, run;
    10. two agent turns (read-only, then a write into its own proposal), then Reject;
    11. selection and the Inspector, Docs, and the zip download.

### Why
- **Each view registered from `main.js`**, not by a side effect of being imported: the import tool rewrites import lines to what a module uses, so a side-effect import would be dropped. An explicit `registerViews` is also the one place that names every view.
- **The app bundle is not minified:** the bench is read in the browser's tools while it is being worked on, and its size is not what makes it load slowly.
- **Dedupe of `outside` events in the actor rather than the page:** only the server sees every tab's reports, and events are per person, so a commit by someone else remains an `outside` change on my timeline, as it should.

### What worked
- **Boot:** the shell, the dock with all 13 views, the old `bench` store opened as the first project, no console warnings or errors.
- **A new app:** `notes23` at draft 1, dev instance ok, 0 issues, files including `sql/001_items.sql`.
- **An eval** (`files.replace` + `files.write` + `frames.check`) committed as one snapshot: `created NOTES.md · styles.css +1 −1 · draft 2 · instances ok`, 40 ms.
- **Typing in Code:** "saving…", then draft 3, nothing pending.
- **The conflict:** I called the actor's `commit` as an outside writer at base 3 while an edit was buffered.
  - The edit was refused, and the footer said "Your edit conflicts with draft 4: someone else changed README.md too. Keep mine Take theirs".
  - Keep mine committed draft 5 with the person's text, and the conflict cleared.
- **A proposal by hand:** created at base 5; an eval in it made snapshot 6; Review showed `styles.css +2 −0` with the diff. Accept all gave draft 7, the proposal `accepted`, and the view back on draft.
- **Timeline:** every step in order, with seq, ref and n.
- **Reload:** the app, 10 events and the thread came back from the server.
- **History:** two versions of `styles.css`, the older one read-only from its snapshot. Blame attributes runs of lines.
- **Data:** shows the `items` table of the dev instance.
- **Agent, read-only:** one eval (`files.list`, 30 ms) and a one-sentence answer.
- **Agent, write turn:** opened its own proposal, committed `index.html` there (snapshot 9), checked the frames, left draft alone. Reject closed it and deleted its ref.
- **Inspector:** source `index.html:11` and the rule from the accepted proposal at `styles.css:8`.
- **The zip:** 14 entries (`files/` ×8, a thread, a transcript, `project.json`, `timeline.{json,md}`, `bench.json`).
- **Gates:** `go vet ./...` clean; `go test ./... -count=1` all ok; `npm test` 17/17; `node tools/imports.mjs` clean.

### What didn't work
- **A new scenario never passed:**
  - The step failed with "✗ wait for body · 2021 ms · nothing visible matches body after 2000 ms".
  - The cause: the probe's `waitFor` counted an element as visible only if it had an `offsetParent` or was fixed, and `body`'s `offsetParent` is always null.
  - This predates SLOP3-023. The template scenario starts with `{ waitFor: 'body' }`, so it failed for everyone. `waitFor` now uses the rule `expect` uses: a box with an area. After the fix: "✓ wait for body 2 ms · ✓ expect h1 1 ms".
- **One outside change logged twice:** events 4 (`commit`, who `push`, logged by the actor) and 5 (`outside`, logged by the page's poll) for the same snapshot. The same happens with two tabs of one person. `logEvents` now answers an `outside` at a `(ref, n)` already on the timeline with the event there, and the page keeps the server's version. A new case in `TestBenchRecords` covers it.
- **The Code view's History button stayed hidden after the person's own commits.** Versions were reloaded only when the text differed from the editor's. The view now remembers the head its versions were read at.
- **Take theirs did not await `takeTheirs`**, which is async now, so the editor reloaded before the head moved.
- **A rejected proposal's headless frame stayed in the pool:** still loaded, still showing "Made in the bench". `Headless.prune` drops frames of refs that are no longer open, on every proposals change.
- **Test-driving mistakes (mine, not the bench's):**
  - I read `frames.check()` as an array; it returns `{route, errors, issues}`.
  - Playwright would not click inside the canvas frame (it waits for a stable element under the canvas transform), so I dispatched the click in the frame.
  - I first picked a headless frame, whose play-mode click came back as `act`.
  - `App.newProposal('title')` ignores its argument and prompts.
  - The download waited on slop's "Save a file?" dialog until I pressed Save.
- **Console noise from restarting the server:** `ERR_INCOMPLETE_CHUNKED_ENCODING` and 401s on `/_rt/events` until the page reloaded.
- **One error from the reject race:** "the app is broken: activation of notes23@8 failed: sql: connection is already closed". It came from the proposal's headless frame, whose instance was dropped mid-request; `Watch.status.dev.broken` stayed empty.

### What I learned
- **The import tool can't see property names.** It checks free names. So I checked the properties the views use against the members the model defines (Project, Draft, Fixtures, Instances, Snaps, the `App.*` handles), with a small script. All were present.
- **An iframe in a hidden dock tab measures 0 × 0, and `innerText` falls back to `textContent`.** The Inspector's "Box 0 × 0" and the canvas frame's "visible" script source were both that, not bugs.

### What was tricky to build
- **The merge with main:** main had the ticket docs at their first version. Only by reading the lines unique to main could I tell they were superseded, not missing.
- **Event dedupe in the page:** a deduplicated answer can name an event the page already holds (from the poll) or one it does not. The page drops its own copy in the first case. In the second, it takes the server's fields, removing keys the server's version lacks.

### What warrants a second pair of eyes
- **`ui/panels.js` `Sources`:** `{sql}` and `{docs}` read the instance on every timeline event and frame event, debounced per widget. A busy page could make a lot of actor calls.
- **`ui/review.js` `runChecks`** loads a headless frame per board frame per workspace and runs every scenario twice. Long for big apps; the person starts it by hand.

### What should be done in the future
- Deploy to staging (slop.yolo) and repeat the smoke test there.
- Turn the smoke test into a script under the ticket's `scripts/`, driven through `window.__SB`.
- Write SLOP3-024's design when TypeScript is taken up.

### Code review instructions
- Start with `web/bench/src/main.js` and `ui/app.js` (`wire`, `boot`, `openProject`).
- Then `ui/code.js` (edits, the conflict footer, history) and `ui/review.js` (accept).
- Then `apps/bench/actor.js` `logEvents` and `model/project.js` `flushEvents`.
- Run `cd web/bench && npm test && node build.mjs`, then `go test ./pkg/host`.

### Technical details
- The local server: `$S/rep/slop023 serve --config $S/lslop23/config.yaml --local --admin-email admin@example.com`; the CLI with `SLOP_CREDENTIALS=$S/lslop/creds.json SLOP_SERVER=http://slop.localhost:18490`.
- The push: `slop store new bench23 && slop push apps/bench --store bench23 && slop app trust bench23 workshop && slop policy set bench23 sample @admin on && slop mount set apps.localhost:18490 /bench23 bench23`.
- Sizes: `apps/bench/app.js` 439,575 bytes (not minified); `src/ui/` 14 modules, 2,832 lines.

## Step 10: Review of #51 — files kept by hash, and restoring to an unrecorded state

Codex's review of #51 found two P1 bugs. Both are real, and both are fixed with tests that fail on the old code. The person asked whether they are systemic. They are, but not in the core. Each sits at an edge where a value changed meaning without anyone saying so, and each has its own pattern. Neither touches the Draft/Tx/`files.commit` semantics or the API table.

### Prompt Context

**User prompt (verbatim):** "Address code review comments: https://github.com/go-go-golems/slop-computer/pull/51 Are these systemic / sign of a problematic API or compositionality issue?"

**Assistant interpretation:** Fix both findings at their cause, check where else the same patterns occur, and say whether they point at a flaw in the design.

**Inferred user intent:** Know whether the new core composes, before merging it.

**Commit (code):** 424191a — "Bench: commits pass files kept by hash through; events record their snapshot (review of #51)"

### What I did
- **Finding 1 (`apps/bench/actor.js:214`):**
  - **The bug:** `commit` rebuilt every change as `{path, text: String(c.text)}` unless it was a delete. A file kept by hash (from `files.copy`, accepting a proposal with an image, or a restore) was committed as the text `undefined`.
  - **Actor:** a `changeList` helper, used by `commit` and `create`, passes the kinds on as given and fails a change with no path. `files.commit` checks the rest strictly, and answers `missing_blobs` for an unknown hash.
  - **Draft:** keeps `type` on hash entries.
  - **`TestBenchFiles`:** commits `{path: img/copy.png, sha256, size, type}` through the real actor and refuses a change of no kind.
- **The stand-in servers.** `draft.test.mjs` and `eval-api.test.mjs` each had one, and both accepted whatever the Draft sent. `test/fake-actor.mjs` now holds one stand-in, and `checkChanges` (exactly one of text/data/sha256/delete; a known blob) is applied by both servers. It at once caught `draft.test.mjs` copying a blob named `ab12`, which no server holds.
- **Finding 2 (`web/bench/src/model/timeline.js:104`):**
  - **The bug:** `snapshotAt` inferred an event's snapshot from the latest earlier event that had one, and `restore`/`since` read `null` as `?? 0`, the empty tree. On an app opened for the first time, a bookmark made before any commit therefore restored to nothing: every file deleted.
  - **`stampEvent`:** every event records its ref and that ref's head when logged; `Project.log` uses it.
  - **`knownAt`:** throws kind `missing` for an unknown state; `history.js` shows the message.
  - **`create`** logs the first snapshot as a commit event.
  - **`versions`:** marks a state that was only observed, not made by a commit or outside change. `blame` gives its lines to no one. History labels it "as it was at n, seen at …".
  - **`test/timeline.test.mjs`:** 4 tests.
- **Where else the patterns occur:**
  - `?? 0` on snapshot numbers appears in `draft.js`, `publish.js` and `instances.js`. There it means "this ref doesn't exist", which is what 0 means to the server. Only the two in `timeline.js` meant "unknown".
  - Of the actor's 35 actions, only `commit` and `create` rebuilt page input. `seed` passes rows through; the other maps shape answers for the page or clamp limits.

### Why
- **The actor forwards rather than validates:** `files.commit` already defines the change kinds and checks them. A second, partial definition in the middle hop can only drift; here it drifted by dropping a kind.
- **Events carry their state rather than the timeline inferring it:** the inference assumed the timeline saw every move of the ref. It doesn't: the bench may have been closed, another tab may have committed, someone may have pushed. A stamped event is correct regardless.
- **Unknown is refused, not defaulted:** 0 is a meaningful snapshot number (the ref doesn't exist). Using it for "unknown" made a destructive action plausible.

### What worked
- `npm test`: 21 pass (draft 6, api 6, eval-api 5, timeline 4).
- `go test ./pkg/host`: ok.
- **Run against the old code:**
  - The old actor: `TestBenchFiles` fails ("a commit of a file kept by hash = …"), and so does `TestBenchCreate` ("the new app's timeline = []").
  - The old `timeline.js`: 2 of the 4 timeline tests fail.
- **In the browser** (local bench23), on `outside24`, an app pushed with the CLI:
  1. The timeline was empty; the bookmark became event 1 with `n: 1`.
  2. An edit made draft 2.
  3. Restore, from the Timeline: "2 files go back…", then draft 3 with the three original files and `new.txt` gone.
  4. History lists "as it was at 1, seen at mark · before my edit".
- **On GitHub:** replies on both review threads.

### What didn't work
- **The first run of the stricter stand-in failed `draft.test.mjs`'s hash test:** `'failed' !== 'committed'`. The test copied `{sha256: 'ab12', size: 3}`. That was the test's fault, not the Draft's. It now copies a blob the server holds, and also checks that a missing one fails.
- **My blame expectation in the new test was `[undefined, seq]`;** the right one is `[undefined, seq, undefined]`, because the final newline leaves an empty last line, which the editor's gutter counts too.

### What I learned
- **A stand-in server should encode the consumer's contract,** not the producer's assumptions. The stand-in here was written next to the Draft and agreed with it, so the Node tests could not catch a mismatch with the real actor. Only a test through the real hop (the Go test) or a stand-in held to the real rule could.
- **TypeScript (SLOP3-024) would have caught finding 1** if the page and the actor shared a `Change` type: `{path, text: String(c.text)}` doesn't satisfy a union with a `sha256` variant. It would not have caught finding 2, since `?? 0` is an explicit choice. That needs a test.

### What was tricky to build
- **`versions` and `blame` with stamped events.** Once every event has an `n`, they would have counted a mark or a message as a version and made it the author of lines. "Observed" separates a state the timeline saw from one a commit made.

### What warrants a second pair of eyes
- **An event on a proposal still infers draft's state** from the latest earlier draft event. Every event the page logs is now stamped, so that is usually recent, but it is still an inference. Stamping draft's head on every event as well would remove it.

### What should be done in the future
- Staging deploy and the scripted smoke test (unchanged from Step 9).

### Code review instructions
- Start with `apps/bench/actor.js` `changeList`, then `web/bench/src/model/timeline.js` (`stampEvent`, `knownAt`, `versions`).
- Then `web/bench/test/fake-actor.mjs` and `test/timeline.test.mjs`.
- Run `cd web/bench && npm test`, then `go test ./pkg/host -run TestBench`.
