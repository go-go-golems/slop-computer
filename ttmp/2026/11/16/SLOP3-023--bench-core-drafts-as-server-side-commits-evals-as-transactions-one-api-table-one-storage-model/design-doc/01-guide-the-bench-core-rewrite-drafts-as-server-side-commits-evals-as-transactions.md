---
Title: 'Guide: the bench core rewrite — drafts as server-side commits, evals as transactions'
Ticket: SLOP3-023
Status: active
Topics:
    - architecture
    - apps
    - agents
    - tools
    - publishing
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: web/bench/src/core/draft.js
      Note: Draft and Tx — an app ref's files as the server has them, changed by files.commit (replaced 03b-slop.js's Sync and Outside)
    - Path: web/bench/src/core/api.js
      Note: the host API as one declared table and the one dispatcher (replaced 06-agent.js's API_SIGS, checkArgs and hand-placed guards)
    - Path: web/bench/src/agent/eval.js
      Note: runEval — one eval as one Tx (replaced 06-agent.js's rollback)
    - Path: web/bench/src/model/project.js
      Note: the project on Drafts, proposals as refs, threads and the timeline from the actor (replaced 04-project.js)
    - Path: apps/bench/actor.js
      Note: the bench's server half; commit, instances by kind, proposals as refs, project storage in SQL
    - Path: pkg/commands/files.go
      Note: files.push (manifest push with ifAt) and ref.move — the server verbs underneath
    - Path: pkg/store/files.go
      Note: snapshots, refs and the tree zone inside a store turn
ExternalSources: []
Summary: "For a new engineer: what the bench is, how it gets an app's edits to draft today, why 26 review findings cluster in its client-side sync, and the rewrite that replaces it: a server-side draft.commit of explicit changes, evals as write-buffer transactions, one declared host-API table, and project state on the server."
LastUpdated: 2026-11-16T13:21:23.284258901-05:00
WhatFor: "Understand the bench end to end and implement SLOP3-023 phase by phase."
WhenToUse: "Before changing how the bench stores, syncs or commits anything; before touching runEval, Sync or the bench actor."
---

# Guide: the bench core rewrite — drafts as server-side commits, evals as transactions

> **Status (2026-11-16): implemented** on branch `task/slop3-023-core`. The diary is `reference/01-diary.md` (steps 1–9) and the server half's is `reference/02-diary-server-phase-files-commit.md`. Remaining: a scripted smoke test, and a run on staging. The code departs from this design in four places:
> - The Draft core is `web/bench/src/core/draft.js`, not `03c-draft.js`. Section 6's layout replaced the numbered files.
> - API entries have no `needs: 'app'`, since every project is an app now.
> - API entries have no `dry: 'refuse'` flag. A dry run refuses every entry whose `writes` is not `files`, which follows from what a dry run can capture.
> - Threads stayed in `model/project.js`; there is no `model/threads.js`.
>
> The examples below that show `needs` or `dry` describe the design as first written.

This guide is for an engineer who is new to slop and to the bench. It explains what the bench is, how it works today, why most of the bugs found in its code reviews come from one design decision, and how we will replace that decision. It ends with a phased implementation plan and the tests that should hold the new design in place.

You do not need to have read the bench's earlier tickets. You need to know JavaScript and Go, and what a git commit is. Every slop-specific term is explained where it first matters.

The code references point at `main` as of commit `084eaa2` (2026-11-16). PR #50, still open when this was written, changes some of `Sync`'s internals (section 3.4 notes where); the design here replaces those internals anyway.

## 1. The short version

The **bench** is a web IDE that runs on slop. A developer opens it, picks an app, and asks a coding agent to change the app; the agent edits the app's files, the developer watches a live copy of the app update, and publishes when it is good.

Today the bench keeps a **copy of the app's files in the browser** and continuously reconciles that copy with the server's copy. Every edit lands in the browser first and is pushed to the server later by a background loop. To know whether an edit has "made it", the browser compares four maps of file state. To stop a half-finished agent step from being pushed, it uses holds. To merge changes made elsewhere, it downloads the whole file list and merges in the browser.

Code review found 26 bugs across three of the bench's pull requests (#47, #48 and #50). Eighteen are in that browser-side replica (`web/bench/src/03b-slop.js` and `04-project.js`). They are all versions of the same problem: two copies of the truth that must be kept in step by inference.

The rewrite removes the replica:

- **The server is the only place an app's files live.** The browser keeps a cache of past versions, which never change, plus the edits that are not committed yet.
- **An edit reaches the server as an explicit commit:** "starting from version 41, put this file, delete that one". The server applies it atomically or says exactly which files conflict.
- **An agent step (an eval) is a transaction** that buffers its writes and commits them at the end. A step that fails drops its buffer. A step started by another step (delegation) commits into its parent.
- **The calls the agent can make are declared once,** in one table that drives validation, permissions, timeouts and the agent's own documentation.
- **Everything the bench stores about a project** (conversations, timeline, proposals) lives in server-side tables and refs, not in size-limited browser documents.

The rest of this guide builds up to that in order: the slop concepts (section 2), the bench as it is (section 3), the evidence (section 4), the design (section 5), how the source is organized (section 6), the plan (section 7) and the tests (section 8).

## 2. Slop concepts you need

Slop is a server that hosts apps. Five of its ideas carry this whole design: stores, snapshots and refs, apps and instances, verbs, and actors. This section explains each with a small example.

### 2.1 Stores hold files; snapshots freeze them; refs name snapshots

A **store** is slop's unit of storage. Each store is its own SQLite database. It can hold documents, SQL tables and files. An app's code lives in a store; so does the data of each copy of the app that people use.

A store's files live in a **zone** called `tree`: a working set of files, each stored as a content hash (sha256) pointing at a blob. A **snapshot** freezes the tree: it gets the next number (1, 2, 3, …), and its file list is copied into `_snapshot_files`. Snapshots never change.

A **ref** is a name that points at a snapshot number, like a git branch points at a commit. Two refs matter here:

- `draft` points at the version being worked on.
- `main` points at the published version.

Here is a store after three pushes and one publish:

```text
_snapshots                     _refs
 n  tree-hash   message         name   n
 1  9f3a…       first files     main   1
 2  c21e…       board + timer   draft  3
 3  77b0…       number pad
```

`main` still serves snapshot 1 to players; `draft` is at 3. Publishing moves `main` to 3. Rolling back moves it back to 1.

All writes to a store happen in a **turn**: `Store.Do(ctx, who, fn)` (`pkg/store/turn.go:70`) runs `fn` under the store's mutex inside one SQL transaction. Either everything in the turn commits, or nothing does. Inside a turn you can:

- read where a ref points: `Turn.RefAt` (`pkg/store/files.go:238`);
- change the tree: `Turn.PutFile`, `Turn.PutBlob`, `Turn.RemoveFile` (`pkg/store/files.go:72`, `:97`, `:129`);
- freeze the tree as a snapshot and point a ref at it: `Turn.Snapshot(message, ref)` (`pkg/store/files.go:189`). If the ref already points at an identical tree, no new snapshot is made and the existing number comes back.
- point a ref at an existing snapshot: `Turn.MoveRef` (`:248`).

Because `RefAt` and the write happen in the same turn, a turn can do **compare-and-set**: "move `draft` only if it still points at 41". Nothing else can move the ref between the check and the write. The whole design relies on this primitive.

### 2.2 Apps and instances

An **app** is a store whose files include an `app.json` manifest: a page (`index.html`), optionally an actor (`actor.js`, section 2.4), SQL migrations (`sql/*.sql`) and the capabilities it needs (a document database, SQL, the current user, …).

People do not use the app store directly. They use an **instance**: another store that *runs* the app's code at some ref, with its own data. `app.follow` (`pkg/commands/actors.go:132`) makes a store follow an app's ref. A production instance follows `main`. Each developer gets a **dev instance** that follows `draft`. Its id is `<app>-dev-<first six characters of the user id>`, for example `sudoku-dev-d4776d`.

When the ref an instance follows moves, the instance **activates** the new snapshot on its next use, or at once when a push names it in `activate`: it runs any new migrations and starts the new actor code. `app.status` (`pkg/commands/mounts.go:104`) reports which snapshot an instance runs (`n`) and why it is broken if activation failed (`broken`).

```text
 app store "sudoku"            instances
 ┌───────────────────┐        ┌──────────────────────────────┐
 │ snapshots 1..3    │ main ─▶│ sudoku (production, data A)  │
 │ refs main=1       │        └──────────────────────────────┘
 │      draft=3      │ draft ▶┌──────────────────────────────┐
 └───────────────────┘        │ sudoku-dev-d4776d (data B)   │
                              └──────────────────────────────┘
```

A **mount** gives an instance a URL (`slop mount set <host> /sudoku sudoku`). That detail matters for the dev-link follow-up (SLOP3-022 task `hm4w`), not for this rewrite.

### 2.3 Verbs: the server's API

Everything a client can ask slop to do is a **verb**: a named, typed operation with declared input and output types, a permission scope and an authorization rule. Verbs are defined with `verbs.Def[In, Out]{Name, Doc, Scope, Action, Run}`. The ones that matter here are in `pkg/commands/files.go`:

| Verb | What it does |
|---|---|
| `files.push` (`:140`) | Replace a store's tree with a **manifest** (the full file list) and snapshot it onto a ref. Optional `ifAt`: only if the ref still points at that snapshot. Optional `activate`: instances to bring up on the new snapshot. |
| `files.ls`, `files.cat` | List or read the files of a snapshot (`at`). |
| `ref.move` (`:227`) | Point a ref at a snapshot; optional `ifAt`. Publishing is `ref.move main n`. |
| `snap.ls`, `ref.ls` | List snapshots and refs. |

The manifest form of `files.push` matters for this design. You send every file of the new tree, either as `{path, text}` for a changed file or as `{path, sha256, size}` for one the server already has. **A file you do not list is deleted** (`prune`, `files.go:418-431`). The CLI (`slop push`) and the bench both use this verb today.

### 2.4 Actors, modules and how the bench page reaches the server

An app can have an **actor**: server-side JavaScript (`actor.js`) that runs in slop's goja runtime and exposes **actions** the app's page can call. An action declares the access level it requires (`view`, `interact`, `admin`) and receives a `ctx` with the visitor and the app's capabilities. Example from the Sudoku dry run (SLOP3-022 step 27): a `tags` action with `requires: 'view'` that runs `sql.all(...)` and returns rows.

An actor reaches slop's verbs through **modules** it has been trusted with. The bench's actor is trusted with the **workshop module** (`pkg/doors/actors/modworkshop.go:17`). Workshop is a table of JavaScript functions, each mapped to a verb and called *as the visiting person*:

```js
{ JS: "push",    Verb: "files.push", Pos: ["store", "files"],
  Default: { ref: "draft" } },
{ JS: "files",   Verb: "files.ls",   Pos: ["store", "at"] },
{ JS: "publish", Verb: "ref.move",   Pos: ["store", "n"],     Fixed: { ref: "main" } },
```

This means the bench can do nothing its user could not do with the CLI. Adding a verb to the bench means adding one row here.

The page side reaches its actor through the runtime: `window.claude.use('slop')` returns `{actions}`, and `Slop.call(name, args)` (`web/bench/src/03b-slop.js`) calls `actions[name](args)`. One call goes through these layers:

```text
browser: Slop.call('sync', {...})
  → page runtime → bench actor action  sync   (apps/bench/actor.js:118)
    → workshop.push(app, files, {ifAt, activate})
      → verb files.push  (pkg/commands/files.go:140)
        → Store.Do(turn: RefAt, PutBlob…, RemoveFile…, Snapshot)
```

### 2.5 Pages, embeds and the probe

The bench shows an app inside **frames** on a canvas. For an app project, each frame is an **embed**: a view of the developer's dev instance that slop serves on a sandbox origin (`pkg/doors/pages/embed.go:125`). Slop injects a small script, the **probe** (`pkg/doors/pages/assets/probe.js`, built from `web/bench/src/05a-probe.js`), into every embedded page. The bench talks to the probe with `postMessage`, which is how the agent's `frames.click`, `frames.text`, `frames.check` and so on work. Frames show what the dev instance runs, which is whatever `draft` points at. They never show the browser's unpushed edits.

## 3. The bench today

### 3.1 What the bench is made of

The bench's source is `web/bench/src/`, about 7,400 lines of plain JavaScript in numbered files. `web/bench/build.mjs` concatenates them into `apps/bench/app.js`, bundles the sandbox worker into `apps/bench/sandbox.js`, and writes the probe into `pkg/doors/pages/assets/probe.js`. The server half is `apps/bench/actor.js` (about 360 lines). The bench is installed as an app like any other (`make deploy-apps`).

| File | Role |
|---|---|
| `03-store.js` | `Store`: persistence for project data, in the bench store's documents (per user, under `data/users/<id>/`), with a write queue |
| `03b-slop.js` | `Slop` (calls to the actor), `Sync` (push edits to draft), `Outside` (notice and merge draft changes made elsewhere), `Embeds` (dev-instance frames), `Publish` |
| `04-project.js` | `Project`: files, proposals ("overlays"), mock data tables, threads, the timeline; `Projects`: open/create |
| `05-site.js`, `05a-probe.js` | Building pages for non-app projects; the probe |
| `06-agent.js` | The eval sandbox's page side, the **host API** (every call the agent can make), `runEval`, `Agent.turn`, `delegate` |
| `worker.js`, `core.js` | The QuickJS sandbox worker the agent's code runs in |
| `07`–`11` | Dock, canvas, views, agent UI, app shell (`11-app.js`) |

### 3.2 Projects

A **project** is what the bench has open. It started life in Sitebench, the bench's predecessor, which ran in a claude.ai artifact with no server. A project therefore has a full in-browser model (`class Project`, `04-project.js:35`):

- `files`: path → text, the main workspace.
- `overlays`: **proposals**. A proposal is a separate workspace of changes the developer reviews and accepts or rejects.
- `tables`: small mock data tables, for sites without a real backend.
- `threads`: agent conversations.
- `events`: the **timeline**. Every write is an event carrying the new text, which is what makes `blame`, `stateAt(i)` and `restore(i)` possible (`04-project.js:315-400`).

On slop, a project can instead be an **app project** (`meta.app` is set). Its main files are then the app store's tree at `draft`, and four more fields track the server (`04-project.js:41-45`):

```js
this.tree   = new Map()  // path → {sha256, size}: the server's tree at P.refs.draft
this.synced = new Map()  // path → text as last pushed
this.extern = new Map()  // path → {sha256, size}: files not kept as text
                         // (binary or over 240 KB), pushed back by hash
this.refs   = null       // {draft, main}
```

`Projects.openApp` (`04-project.js:496`) loads an app project: the actor's `open` action returns the tree, `Slop.readAll` fetches the texts, and each file goes either into `files` + `synced` or into `extern`.

### 3.3 Where project data is stored

Threads, the timeline, proposals and boards are saved through `Store` (`03-store.js:3`) as documents in the bench's own store. The **document size limit** is 262,144 bytes of UTF-8 JSON. Timeline events carry whole file texts, so the timeline is stored in chunks, and an event too big for a chunk is stored in pieces whose byte size is counted by hand (`04-project.js:1-34`: `LOG_CHUNK`, `LOG_EVENT`, `LOG_PIECE`, `utf8Len`, `logPieces`). `Store` keeps its own pending and in-flight maps and flushes on a debounce and on `pagehide`. That makes a second replication layer, separate from `Sync`.

### 3.4 How an edit reaches draft today

This is the part the rewrite replaces, so follow one edit through it. The agent runs `files.write('index.html', html)` inside an eval:

1. `P.write` puts the text into `P.files` immediately. The editor shows it, and the timeline records it (`04-project.js:63`).
2. `P.write` itself calls `Sync.schedule(P)` (`04-project.js:69`), which queues the project. A 300 ms timer calls `Sync.runAll`, which calls `Sync.run(P)` for each queued project that is not **held** (`03b-slop.js:55-115`).
3. `Sync.run` builds the full manifest. For each file in `P.files`: if the server has it unchanged (`P.tree` entry and `P.synced` text match), send `{path, sha256, size}`; otherwise send `{path, text}`. Every `extern` entry goes by hash. Anything not listed will be deleted.
4. It calls the actor's `sync` action with `base: P.refs.draft`. The actor calls `workshop.push(app, files, {ref: 'draft', ifAt: base, activate: [devId]})`.
5. If `draft` moved since `base`, the push fails with `conflict`. The actor then answers `{conflict, n, files}`: **the whole tree of the current draft**. `Outside.merge` (`03b-slop.js:170`) merges it into `P.files` in the browser, and `Sync` pushes again.
6. On success, `P.tree` becomes the new tree, `P.synced` records what was sent, `P.refs.draft` becomes the new `n`, and the dev instance's activation result goes to the header.

While all this happens, other things can change `P.files`: the developer typing, another eval, an `Outside` poll that found a push from the CLI (`Outside` polls the actor's `head` action). So `Sync` needs to know whether everything is pushed. It infers this in `Sync.pending(P)` (`03b-slop.js:118`), by comparing maps:

```js
pending(P) {
  for (const [p, t] of P.files) if (P.synced.get(p) !== t) return true     // edited
  for (const p of P.synced.keys()) if (!P.files.has(p)) return true       // removed
  for (const p of P.tree.keys())                         // removed, incl. hash-only
    if (!P.files.has(p) && !P.extern.has(p)) return true
  return false
}
```

Callers that need the edits in draft, such as an eval reporting what it did or a publish checking the draft, call `Sync.flush(P)` (`03b-slop.js:131`). It loops: wait while a push is in flight (the global `busy` flag) or a merge runs, stop if the project is held or nothing is pending, otherwise run a push. Its limits are `FLUSH_WAIT = 60000` ms and `FLUSH_TRIES = 20` (`:47`). It returns `{n, act, error}`.

**Holds** keep a running eval's writes out of draft, because the eval may still fail and roll back. `runEval` calls `Sync.hold(P)` before the sandbox runs and `Sync.release(P)` after (`06-agent.js:476-530`). On `main` the hold is a counter (`03b-slop.js:68`). PR #50 turns it into tokens and passes a parent's tokens to delegated evals.

### 3.5 Evals: the agent's unit of work

The agent works by writing small JavaScript programs, **evals**, that run in a QuickJS sandbox in a web worker (`worker.js`). An eval calls the **host API**: about 100 functions in namespaces such as `files.*`, `frames.*`, `app.*`, `publish.*`, `agents.*` and `ui.*` (`hostAPI`, `06-agent.js:117`). The model emits one eval per tool call. Slop's sampler runs up to 10 rounds per model call (`pkg/llm/gepp/sample.go:120`).

`runEval` (`06-agent.js:476`) makes an eval behave like a transaction, using an **undo log**:

- Writes go straight into the project. Before a file's first write, `touchFile` records its old text in `ctx.tx`.
- If the eval fails, every recorded file is reverted (`P.revert`, `04-project.js:94`) and recorded tables are restored.
- After a successful eval on an app project, `runEval` calls `Sync.flush(P)`, waits for the dev instance's frames to reload, measures what changed in the frames, and returns **effects**: files written, the draft number, the actor's activation state and new frame issues.

On top of that sit two more mechanisms:

- `tx.begin/commit/rollback` (`06-agent.js:404`): nested undo frames inside an eval, so a step can be atomic.
- `dry.begin/end/apply/discard` (`:407`): a **dry run**. Writes go to a separate buffer, `ctx.scratch`, that reads see but the project does not, and the eval can apply some of them later.

**Delegation**: `agents.delegate(role, task)` starts a subagent with its own thread and sandbox (`Agent.delegate`, `06-agent.js`; roles at `:721`, depth capped at 2). A QA or tests subagent works in its parent's workspace, so its evals write to the same project while the parent's eval is still running.

The host API's rules are spread out:

- **Signatures** are in `API_SIGS` (`:75`).
- **Timeouts:** "long" calls that pause the 20-second eval budget are in two lists, `LONG_CALLS` on the page (`:73`) and `LONG` in the worker (`worker.js:242`).
- **Guards** (`writable`, `noDryData`, `needApp`) are called by hand inside each function that needs them.
- **The agent's documentation** of the API is a separate string, `API_GUIDE`, plus `slopGuide` (`:583`).

### 3.6 Publishing

`Publish.preflight(P)` (`03b-slop.js:258`) flushes, refuses if edits are still pending, and asks the actor's `preflight` action (`actor.js:284`). Preflight reads the draft snapshot, compares migrations with what production already ran, and lists blockers. `Publish.run` calls the actor's `publish` action (`actor.js:323`), which calls `workshop.publish(app, n, {ifAt: main})`: `ref.move main n` with compare-and-set.

## 4. What the reviews found

Codex reviewed every push of the bench's PRs. Across #47 (phases 0–3), #48 (phases 4–5) and #50 (the overlapping-eval fix) it raised 26 findings. Every one was a real bug, and every one was fixed:

| File | Findings |
|---|---|
| `web/bench/src/03b-slop.js` (Sync, Outside, Publish) | 12 |
| `web/bench/src/04-project.js` (project state, timeline storage) | 6 |
| `apps/bench/actor.js` | 5 |
| `web/bench/src/06-agent.js` | 2 |
| `web/bench/src/09-views.js` | 1 |

Grouped by cause, they tell one story. Each group lists the findings by their review titles.

**A. "Is draft caught up?" is inferred, not known (10 findings).**
- "Include hash-only deletions in the pending-tree check"
- "Encode empty files in a form the push handler accepts"
- "Preserve queued edits when flushing an in-flight push"
- "Recheck local changes after fetching an outside update"
- "Remove hash-only entries when replacing a file with text"
- "Restore hash-only entries when rolling back file replacements"
- "Defer draft pushes until the eval transaction succeeds"
- "Wait for in-flight pushes before checking for a clean draft"
- "Return an error when flush exhausts its wait budget"
- "Abort publishing preflight when flushing draft fails"

Each is a case where comparing `files`, `synced`, `tree` and `extern` gave the wrong answer, or where a caller treated "flush returned" as "my edits are in draft".

**B. Locks without owners (4).**
- "Scope eval sync holds to the project being evaluated"
- "Wait for held evals before detaching the outgoing project"
- "Avoid acknowledging edits while another eval holds the project"
- "Exclude awaiting ancestor evals from the hold wait"

Holds went from a global counter, to a counter per project, to tokens with an "own" list. An anonymous counter cannot say *whose* hold it is, and that is exactly what each fix needed to know.

**C. Defaults to "whatever is open now" (2).**
- "Persist eval results to the project that started the run"
- "Flush the previous project's edits before detaching it"

`flush(P = this.P)`, `App.P` and `App.ws` read at the end of an async operation pointed at a different project than the one that started it.

**D. Rules kept in several places (2).**
- "Account for preflight waits in sandbox timeout budgets": `LONG` and `LONG_CALLS` disagreed.
- "Refuse dev-data mutations inside dry runs": a guard was missing on some functions.

**E. Storage workarounds (3).**
- "Split initial project snapshots across storage documents"
- "Bound log pieces by serialized UTF-8 bytes"
- "Apply bounded event storage when importing project history"

All three come from storing a growing timeline in size-limited documents.

**F. Server-side reads that were not pinned or not pure (5, in `actor.js`).**
- "Check the draft base atomically with the push"
- "Read the returned manifest at the acknowledged snapshot"
- "Read preflight files from the captured snapshot numbers"
- "Keep production status collection from activating instances"
- "Check migration history across rollbacks"

Four read `draft` or `main` (names that move) where a fixed snapshot number was needed. The fifth was a status read with a side effect: asking `app.status` activated production instances during a preflight, fixed with a `peek` that only looks.

### 4.1 One bug, step by step

The most recent finding ("Wait for in-flight pushes before checking for a clean draft", PR #50) shows how group A works. Start with `README.md` = "Hello", pushed as draft 21:

| Step | `P.files` | `P.synced` | in flight | `pending()` | draft |
|---|---|---|---|---|---|
| start | Hello | Hello | — | false | 21 |
| eval writes "Hello!" | Hello! | Hello | — | true | 21 |
| `Sync.run` starts pushing "Hello!" | Hello! | Hello | push → 22 | true | 21 |
| developer presses undo | Hello | Hello | push → 22 | **false** | 21 |
| `flush()` returns "clean" | Hello | Hello | push → 22 | false | 21 |
| push lands | Hello | Hello! | — | true | **22 = "Hello!"** |

When `flush` returned, the editor said "Hello" and so did `synced`, so the comparison said there was nothing to do. Draft was about to become "Hello!", the opposite of what the developer wanted. A preflight run at that moment checks a draft that does not match the editor.

The fix was to wait for the in-flight push first. That fix is correct, but it is the tenth patch to the same comparison. The comparison cannot be made reliable, because "is the server caught up with the editor?" is a question about time, and the four maps record only current values.

### 4.2 Why the server side had almost no bugs

The Go verbs underneath had none of these problems, because they have the properties the browser lacks:

- **Writes happen in one atomic turn.**
- **Versions are explicit.** Snapshots are numbered and immutable.
- **A write can carry `ifAt`.**
- **Verbs are typed and declared once.**

The actor's five bugs (group F) were places where it read a moving name instead of a number, or used a read that changed state. The design below gives the browser the same properties by moving the state to where those properties already exist.

## 5. The design

Five principles, each answering one group of findings:

1. **One source of truth.** An app's files exist on the server only. The browser holds an immutable cache keyed by snapshot number, plus uncommitted buffers. (Answers A and C.)
2. **Explicit operations against versions.** A write says which snapshot it starts from and exactly what it changes. A read says which snapshot it reads. The answer names the snapshot it produced. (Answers A and F.)
3. **Transactions with owners.** An eval is a transaction object, so ownership is identity, not a count. Nesting is a parent pointer. (Answers B.)
4. **Declare once.** Each host-API call has one declaration, and everything else (validation, guards, timeouts, documentation) is derived from it. (Answers D.)
5. **Store data where it fits.** The timeline goes in append-only SQL rows, history in snapshots, proposals in refs. (Answers E.)

```text
                      BEFORE                                      AFTER
 ┌──────────── browser ────────────┐          ┌──────────── browser ────────────┐
 │ P.files ◀──▶ editor, evals      │          │ SnapshotCache (n → files, R/O)  │
 │ P.synced / P.tree / P.extern    │          │ Tx buffers (per eval, nested)   │
 │ Sync queue, holds, flush        │          │ Draft.commit(tx) ──────────┐    │
 │ Outside.merge (whole tree)      │          └────────────────────────────┼────┘
 │ Store queue (docs, pieces)      │                                       │
 └───────────┬─────────────────────┘                                       ▼
             │ full manifest + ifAt              ┌──────────── server ────────────┐
             ▼                                   │ files.commit {base, changes}   │
 ┌──────────── server ─────────────┐             │  → one turn: check, merge per  │
 │ files.push (replace whole tree) │             │    file, snapshot, move draft, │
 └─────────────────────────────────┘             │    activate dev instance       │
                                                 │ bench actor SQL: threads,      │
                                                 │   timeline, proposals (refs)   │
                                                 └────────────────────────────────┘
```

### 5.1 Server: `files.commit`, an explicit change list against a base

A new verb replaces the manifest push for incremental work. It takes a **change list** instead of a whole tree:

```text
files.commit {
  store:   "sudoku",
  ref:     "draft",            // default draft
  base:    41,                 // required: the snapshot these changes start from
  message: "bench: index.html styles.css",
  changes: [
    { path: "index.html", text: "<!doctype html>…" },     // put text ("" is valid)
    { path: "logo.png",   blob: "9f3a…", size: 2048 },    // put a blob the server has
    { path: "old.js",     delete: true }                  // remove
  ],
  activate: ["sudoku-dev-d4776d"]
}
```

```text
→ { ok: true,  n: 43, base: 41, merged: 42,
    activated: [{ store: "sudoku-dev-d4776d", n: 43, broken: "" }] }
→ { ok: false, code: "conflict", n: 42,
    conflicts: [{ path: "index.html", changedIn: 42 }] }
→ { ok: false, code: "missing_blobs", missing: ["9f3a…"] }
```

The semantics, in one store turn:

```go
// files.commit, inside Store.Do (pkg/commands/files.go; new)
at := t.RefAt(in.Ref)                       // where the ref points now
if at != in.Base {
    // someone committed since base: which paths did they change?
    theirs := diff(t.SnapshotFiles(in.Base), t.SnapshotFiles(at))   // path → changed
    for _, c := range in.Changes {
        if theirs[c.Path] && !sameResult(c, t.SnapshotFile(at, c.Path)) {
            conflicts = append(conflicts, Conflict{Path: c.Path, ChangedIn: at})
        }
    }
    if len(conflicts) > 0 { return conflictError(at, conflicts) }   // nothing written
}
t.ResetTree(at)                             // the tree zone := snapshot at's files
for _, c := range in.Changes {
    switch {
    case c.Delete: t.RemoveFile("tree", c.Path)
    case c.Blob != "": t.PutBlob("tree", c.Path, c.Blob, c.Size, typeOf(c.Path))
    default: t.PutFile("tree", c.Path, []byte(*c.Text), typeOf(c.Path))
    }
}
n := t.Snapshot(in.Message, in.Ref)          // freezes the tree, moves the ref
```

What to notice:

- **The merge is per path.** If someone else changed `styles.css` and you changed `index.html`, your commit applies on top of theirs, and the answer says it was `merged` over 42. A conflict happens only when both sides changed the same path to different results, and then nothing is written.
- **Deletion is a change you state.** Omitting a file means "unchanged", never "delete". The empty string is a valid text. Findings "Include hash-only deletions…", "Remove hash-only entries…" and "Encode empty files…" cannot be expressed in this format.
- **`base` is required.** There is no "push whatever is there" mode for incremental writes.
- **The answer carries the snapshot it made.** "In draft at 43" can only come from a successful commit.
- **The store helpers this needs** (`Turn.SnapshotFiles` inside a turn, and `Turn.ResetTree(n)`) are small additions to `pkg/store/files.go`, next to `Snapshot` and `RefAt`.

`files.push` stays for whole-tree imports (`slop push` from the CLI), and its `ifAt` becomes required whenever `ref` is given. `ref.move` gets a required `ifAt` too. Reads that return snapshot content (`files.ls`, `files.cat`, the bench actor's `read`) always take a number. The actor converts `draft`/`main` to numbers once, at the start of an action.

Two smaller server additions:

- **`workshop.commit`:** one row in `workshopFuncs` mapping to `files.commit`.
- **A ref-moved event:** `Outside` polls `head` today. A server-sent stream of `{store, ref, n, by}` would let the browser invalidate its cache and update the header without polling. Polling `head` every few seconds remains an acceptable first version, because with this design a poll only invalidates a cache entry and never merges.

### 5.2 Browser: the Draft core

All of the app-file logic moves into one module, `web/bench/src/core/draft.js`. Its server calls go through an injected `call(name, args)` function, so it can run under Node in tests (section 8). It has three parts.

**The snapshot cache.** It maps `n → Map(path → entry)`. An entry is one of three shapes, never spread over parallel maps:

```js
{ kind: 'text', text }          // loaded as text
{ kind: 'blob', sha256, size }  // binary or large: content stays on the server
// absence from the map = the file does not exist at n
```

Snapshots never change, so a cached entry is correct forever. There is no invalidation logic beyond memory pressure.

**Transactions.** A `Tx` is a buffer of changes against a base snapshot, with an optional parent:

```js
class Tx {
  constructor(draft, { base, parent = null, label }) {
    this.draft = draft; this.base = base; this.parent = parent
    this.changes = new Map()   // path → entry | { kind: 'deleted' }
    this.state = 'open'        // open → committed | aborted
  }
  read(path) {                 // own change → parent's view → the base snapshot
    if (this.changes.has(path)) return show(this.changes.get(path))
    return this.parent ? this.parent.read(path) : this.draft.cache.read(this.base, path)
  }
  write(path, text) {
    this.mustBeOpen(); this.changes.set(path, { kind: 'text', text })
  }
  remove(path)      { this.mustBeOpen(); this.changes.set(path, { kind: 'deleted' }) }
  abort()           { this.state = 'aborted' }   // rollback = forget the buffer
  async commit() {
    this.mustBeOpen()
    if (this.parent) {                            // nested: fold into the parent
      for (const [p, c] of this.changes) this.parent.changes.set(p, c)
      this.state = 'committed'
      return { status: 'folded', into: this.parent.label }
    }
    const r = await this.draft.commitChanges(this.base, this.changes, this.label)
    this.state = r.status === 'committed' ? 'committed' : 'open'
    return r
  }
}
```

**The Draft object.** There is one per app, created by `Draft.for(app)`. It owns the cache, knows where `draft` points (`head`), and commits:

```js
async commitChanges(base, changes, message) {
  const r = await this.call('commit', { app: this.app, base, message,
                                        changes: toWire(changes) })
  if (r.ok) {
    this.head = r.n
    this.cache.remember(r.n, base, changes, r.merged)   // derive n's files locally
    return { status: 'committed', n: r.n, dev: r.activated[0] || null }
  }
  if (r.code === 'conflict')
    return { status: 'conflict', n: r.n, conflicts: r.conflicts }
  return { status: 'failed', error: r.error || r.code }
}
```

The result is one of four shapes, and callers branch on `status`:

| `status` | Meaning | Who sees it |
|---|---|---|
| `committed` | In draft at `n`; dev instance activation in `dev` | runEval effects, the editor's header |
| `folded` | Nested transaction; the parent will commit | a delegated eval |
| `conflict` | Nothing written; these paths changed since `base` | the eval (the agent rereads and retries), the editor (merge view) |
| `failed` | Nothing written; why | everyone |

Compare with today's `flush`, which returned `{n, error: ''}` both when the edits were in draft and when they were not.

Two details of `commitChanges`:

- **Deriving the new snapshot's files.** `cache.remember` builds snapshot `n`'s file map from `base` plus the changes. When the commit merged over someone else's snapshot (`merged: 42`), it needs 42's files first; if 42 is not cached, it fetches its file list once with `files.ls at 42`.
- **After a conflict, the transaction stays open.** The caller decides: an eval reports the conflict and drops the transaction, while the editor keeps it open and shows the merge view.

**The editor.** The developer's typing also goes through transactions. The code view keeps one open `Tx` per file being edited. It commits 400 ms after the last keystroke, and on blur and on save. Its base is the head when editing started. On `conflict` it shows the developer the change in draft next to their own, rather than merging silently.

### 5.3 Two overlapping evals and a delegation, step by step

Draft is at 50. The developer's agent thread runs eval A; a second thread runs eval B; eval A delegates a QA subagent whose eval is A1:

```text
time  eval A (base 50)          eval A1 (parent A)        eval B (base 50)      draft
 t1   begin, write index.html                                                     50
 t2   agents.delegate('qa') ─▶  begin(parent: A)                                  50
 t3                             write scenarios/a.json    begin, write app.css    50
 t4                             commit → folded into A                            50
 t5                                                        commit → committed 51   51
 t6   delegate returns;
      commit {base 50:
        index.html, scenarios/a.json}
        → server: 51 changed only app.css → merged → committed 52                 52
```

What to notice:

- **No eval waits for another.** Nothing like holds, `flush` or `FLUSH_WAIT` exists.
- **A1's result is `folded`,** a fact about where its changes went, not an error and not a stale draft number.
- **A's commit lands on top of B's,** because they touched different files. Had B also written `index.html`, A's commit would return `conflict` and write nothing, and A's agent would read draft 51 and retry. Under today's code, both threads write into the same `P.files`, so the later write silently replaces the earlier one.

### 5.4 Evals as transactions

`runEval` becomes:

```js
async function runEval(ctx, code, api, opts) {
  const tx = ctx.draft.begin({ parent: ctx.parentTx, base: ctx.draft.head,
                               label: ctx.thread || 'eval' })
  ctx.tx = tx
  const r = await Sandbox.run(code, api, opts)           // writes go to tx
  if (!r.ok) {
    tx.abort(); r.effects = { rolledBack: [...tx.changes.keys()] }; return r
  }
  const c = await tx.commit()
  r.effects = effectsOf(tx, c)        // {files, draft: c.n, actor: c.dev}
                                      // or {folded} or {conflict}
  if (c.status === 'committed') await framesReload(ctx, c.n)   // dev instance on c.n
  return r
}
```

This changes four things:

- **Rollback is free.** The undo log (`touchFile`, `P.revert`, the saved snapshots) goes away.
- **In-eval transactions become nested `Tx` objects.** `tx.begin()` inside an eval opens a child transaction, `tx.commit()` folds it, and `tx.rollback()` aborts it.
- **A dry run is a transaction that is never committed.** `dry.end()` returns its changes; `dry.apply(id, paths)` copies selected changes into the parent; `dry.discard` drops it. `ctx.scratch` and its special cases go away.
- **Frames show committed state only.** That's already true for app projects today, since frames show the dev instance. What changes is that an eval's own reads see its uncommitted writes through `tx.read`, while its frame checks see draft. An agent that writes and then checks frames in the same eval will check the old version. The API guide says so: write in one eval, check in the next. Section 9 discusses previews of a transaction as a later option.

**Table writes.** The dev instance's real data (`app.sql`, `app.seed*`) is not part of the file transaction. Those calls act on the dev instance immediately, as they do today, and are refused inside dry runs (declared in the table below). The mock `tables` of non-app projects go away (section 5.6).

### 5.5 The host API as one table

Each host-API call is declared once:

```js
const API = defineAPI({
  'files.write':   { sig: 'path, text', writes: 'files',
                     run: (ctx, path, text) => ctx.tx.write(path, text) },
  'files.read':    { sig: 'path', run: (ctx, path) => ctx.tx.read(path) },
  'app.seedTable': { sig: 'table, rows', writes: 'dev', needs: 'app', dry: 'refuse',
                     run: (ctx, table, rows) => ctx.slop.call('seedTable', …) },
  'publish.check': { sig: '', needs: 'app', long: true,
                     run: ctx => Publish.check(ctx.draft) },
  'agents.delegate': { sig: 'role, task, opts?', long: true, run: … },
})
```

One dispatcher reads the declaration:

```js
async function dispatch(ctx, name, args) {
  const d = API[name]; if (!d) throw unknown(name)
  checkSig(d.sig, args)                     // replaces API_SIGS/checkArgs
  if (d.needs === 'app' && !ctx.draft) throw policy(name + ' needs an app project')
  if (d.writes && ctx.mode === 'read') throw policy('read-only thread')
  if (d.writes === 'files' && ctx.mode === 'tests' && !testPath(args[0]))
    throw policy('tests threads write only scenarios/ and fixtures/')
  if (d.dry === 'refuse' && ctx.tx.isDry)
    throw policy(name + ' is refused in a dry run')
  return d.run(ctx, ...args)
}
```

Derived from the same table:

- **`long`:** the worker receives the list of long names when a session starts, instead of keeping its own `LONG` set. This would have prevented "Account for preflight waits…".
- **The agent's API reference:** the signature lines in `API_GUIDE` are generated from `sig` plus a `doc` field.
- **Guards:** `writes`, `needs` and `dry` replace the hand-placed `writable()`, `needApp()` and `noDryData()` calls. This would have prevented "Refuse dev-data mutations inside dry runs".

### 5.6 One storage model for project state

**Every project is an app store.** The static-site templates (Corner Coffee and the rest) become app stores whose `app.json` has only a page. The artifact mode (`Slop.on === false`, local projects in `localStorage`) is removed. With it go the `Slop.on` branches, the mock `tables` model and the page builder for non-app projects (`05-site.js`'s srcdoc path): frames always show a dev instance.

**Conversations and the timeline move into the bench actor's SQL.** The bench store gets migrations:

```sql
-- apps/bench/sql/001_bench.sql
CREATE TABLE threads (id TEXT PRIMARY KEY, app TEXT NOT NULL, owner TEXT NOT NULL,
                      title TEXT, role TEXT, mode TEXT,
                      created INTEGER, updated INTEGER);
CREATE TABLE messages (thread TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL,
                       PRIMARY KEY (thread, seq));
CREATE TABLE events (app TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL,
                     who TEXT, kind TEXT NOT NULL, thread TEXT,
                     n INTEGER,            -- the snapshot this event produced, if any
                     paths TEXT,           -- JSON list of paths it touched
                     note TEXT, PRIMARY KEY (app, seq));
```

What changes for the timeline:

- **Events store the snapshot number, not file text.** "eval 3 wrote index.html → draft 52" is a small row. The text is in snapshot 52.
- **`blame` and `stateAt`** read snapshots on the server (`files.cat at n`) instead of replaying texts. That is the earlier plan's "history on snapshots".
- **The pieces and splitting go away:** `LOG_CHUNK`, `LOG_PIECE`, `utf8Len`, `logPieces`, the `logx` collection, and the bounded import.

**Proposals become refs** (the planned Phase 6). A proposal is a ref named `proposal/<id>` on the app store. It is created at the current draft and receives commits like draft does. A proposal can have its own instance (`<app>-prop-<id>`) that follows its ref, so its frames run real code. That fixes today's "Auto mode writes a proposal the dev instance can't run" (SLOP3-022 step 23).

**Accepting a proposal** is one `files.commit` onto draft, with `base` = the draft the proposal started from and `changes` = the proposal's diff. The same per-file merge applies.

**What stays in the browser:** `localStorage` for UI preferences (dock layout, theme), and nothing else.

## 6. Restructuring the source: layers, modules, documentation

The design above changes what the bench does. This section changes how its source is organized, so that the next engineer can find, read and change any part of it without first reading all of it. The two go together: most of the review findings in section 4 were possible because any file could reach any state, and the rewrite touches more than half of the files anyway.

### 6.1 What is wrong with the current layout

`web/bench/build.mjs` concatenates `src/NN-*.js` in filename order into one function. Every top-level name in every file is visible to every other file, and nothing records who uses what. Running a dependency count over the files (which top-level names each file uses from the others) shows the shape:

| Observation | Measured | Consequence |
|---|---|---|
| `App` (`11-app.js`), the page shell, is used by 13 of the other 19 files | `App.P`, `App.ws`, `App.hostFor`, `App.canvas`, `App.sel` | Any code can ask "what is open now?" at any time. Review findings "Persist eval results to the project that started the run" and "Flush the previous project's edits before detaching it" are exactly this |
| `06-agent.js` is 972 lines, 98 KB | the sandbox bridge, ~100 host-API functions, `runEval`, the prompt text, Agent turns and delegation | Five concerns that change for different reasons share one file; the host API's rules are spread through it (section 4, group D) |
| The average line is 80–100 bytes; many are 250–400 | one-line methods with several statements | Hard to read, and hard to review: a diff hunk is one enormous line |
| Nothing can run outside a browser | every file assumes `document`, `window.claude` and the other globals | The Draft core needed an `eval` with stubbed globals to be tested under Node |
| No file says what it owns | a one-line banner comment per file | A newcomer reads 7,000 lines to learn where a concept lives |

None of this is a matter of taste. Each row is a way a bug was introduced or a review was made harder.

### 6.2 Principles

1. **Layers, with dependencies in one direction.** The source is split into layers. A module imports only from its own layer or the layers below it. The page shell is at the top, and it is the only module that knows "what is open now".
2. **One concept per module, named after it.** A module owns one concept (the Draft, the project, the frame host, the eval) and is named after it. It stays under about 400 lines; a module that grows past that is two concepts.
3. **Explicit imports and exports.** No globals. A module's imports are its complete list of dependencies, and its exports are its public API.
4. **No ambient state below the shell.** Functions below `ui/` take what they act on as parameters: a project `P`, an eval context `ctx`, a Draft. They never read "the current project".
5. **Pass capabilities down; never import up.** When a lower layer needs something only the page can do (focus a frame on the canvas, show a toast, open a view), the upper layer passes it in as a function or an object (`ctx.ui.focusFrame(id)`). The lower layer depends on that interface, not on the page.
6. **Pure core.** `core/` touches no DOM, no `window`, no network. It receives I/O as injected functions (`call`, `hash`), so it runs under Node and is tested there.
7. **Typed results and errors.** An operation that can end in several ways returns an object with a `status` field (`committed | folded | conflict | failed`), not a flag or a string. Errors carry a `kind` (`invalid`, `policy`, `missing`, `conflict`, …) the caller can branch on.
8. **Rules as data.** A set of rules that applies to many items lives in one table (the host API's signatures, guards and timeouts; the agent roles; the scenario step kinds). Validation, documentation and UI are derived from the table.
9. **Code that reads top to bottom.** One statement per line in new and rewritten code; lines under about 120 characters; early returns instead of nested conditions; named intermediate values instead of long expressions. Comments say why, not what.
10. **Documented where it lives.** Every module starts with a header comment; every folder has a `README.md`; the agent's API reference is generated from the API table.

### 6.3 The layout

```text
web/bench/
  build.mjs            bundles src/main.js (esbuild) → apps/bench/app.js;
                       src/worker/ → apps/bench/sandbox.js; the probe → pkg/doors/pages/assets/probe.js
  tools/imports.mjs    checks (or --write: rewrites) every module's imports and the layer rules
  test/                node --test *.test.mjs (core, model); smoke/ drives a real server
  src/
    main.js            boot: Slop.init, then App.boot
    lib/               util.js (ids, time, emitter, debounce, …), dom.js (h, $, modal, toast, menus),
                       text.js (diffs, highlighting, markdown, YAML)
    core/              draft.js (Draft, Tx), api.js (defineAPI, signatures, dispatch),
                       scenario.js (fixture and scenario specs: checks, step labels)
    server/            slop.js (actor calls, Drafts registry), instances.js (instances, Watch),
                       publish.js, records.js (Prefs, Records)
    model/             project.js (Project, Projects), timeline.js (events, versions, blame, why),
                       threads.js (thread records, message saving), templates.js (new-app templates)
    frames/            probe.js (runs inside frames), host.js (FrameHost, Headless),
                       layout.js (layout maps, diffs, Snaps), scenarios.js (fixtures on the test instance, runs)
    agent/             sandbox.js (the worker bridge), api/*.js (the host API, one file per namespace),
                       eval.js (runEval, effects), agent.js (turns, delegation, summaries),
                       roles.js, guide.js (the agent's instructions; the API reference is generated)
    ui/                app.js (the shell: header, project menu, wiring), dock.js, canvas.js,
                       code.js, data.js, history.js, threads.js, review.js, panels.js,
                       scenarios.js, archive.js
    worker/            worker.js, core.js: the sandbox side, built separately into sandbox.js
```

The layers and what each may import:

```text
  main ──▶ ui ──▶ agent ──▶ frames ──▶ model ──▶ server ──▶ core ──▶ lib
                                                                      ▲
  every layer may import lib; nothing imports main or ui except main ─┘
```

| Layer | Owns | May use the DOM | Tested |
|---|---|---|---|
| `lib/` | helpers with no bench concepts | `dom.js`, `text.js` only | by use |
| `core/` | the Draft and transactions; the API table machinery; spec checks | no | Node (`test/*.test.mjs`) |
| `server/` | everything that calls the bench actor | no | Node, with a fake actor |
| `model/` | the project and what the bench records about it | no | Node, with a fake actor |
| `frames/` | iframes of instances, the probe, layouts, scenario runs | yes | browser smoke |
| `agent/` | the sandbox, the host API, evals, the agent | yes (approval cards, through `ctx.ui`) | browser smoke; the API table in Node |
| `ui/` | views, the dock, the canvas, the shell | yes | browser smoke |

`tools/imports.mjs` enforces the table: a module that imports from a higher layer fails the check, and so does a name that resolves to nothing (a `ReferenceError` waiting to happen). `build.mjs` runs the check before it bundles.

### 6.4 Anatomy of a module

Every module has the same three parts. Here is `core/draft.js`, shortened:

```js
// core/draft.js — an app ref's files as the server has them, and transactions
// that change them (SLOP3-023).
//
// Owns: the snapshot cache (listings by n, texts by hash), Tx (a buffer of
// changes over a base), and the person's live edits.
// Does not own: where the files are shown (ui/code.js), what a commit means for
// the timeline (model/timeline.js).
// Public API: Draft (open, refresh, read, list, begin, edit, settle, …), Tx,
// textish. Results are typed: {status: committed | folded | conflict | failed}.
import { emitter } from '../lib/util.js';

export const textish = f => !BINARY_EXT.test(f.path) && f.size <= TEXT_MAX

export class Tx { … }
export class Draft { … }
```

1. **The header comment** says what the module is, what it owns, what it deliberately does not own (and where that lives), and its public API in one line.
2. **The imports** are the module's complete dependencies. They are maintained by `node tools/imports.mjs --write`, which also sorts them, so they are never stale.
3. **The body** exports only what other modules use. A helper used by one module stays unexported in it.

### 6.5 How the shell hands state down

The shell (`ui/app.js`) holds the open project and the selection. Everything below it gets them as arguments. Two examples show the pattern.

An eval context carries the project, the transaction and a small `ui` interface the shell implements:

```js
// ui/app.js builds it; agent/ only ever reads ctx
const ctx = {
  project: P, draft: P.draftOf(ws), tx, who: 'agent', thread: th.id, mode: th.mode,
  ui: {                                   // what only the page can do
    hostFor: fid => App.canvas.hostFor(fid),
    focusFrame: fid => App.canvas.focusFrame(fid),
    openView: name => Dock.open(name),
    selection: () => App.sel,
    notify: text => toast(text),
  },
}
```

A view receives its project when it is shown, instead of reading `App.P` whenever it repaints:

```js
// ui/history.js
export function historyView({ project, onOpenFile }) { … }   // the shell passes both
```

The rule that makes this work: below `ui/`, `App` is never named. The import check makes a slip visible immediately.

### 6.6 Documentation

- **Module headers** (section 6.4) are the first thing to read in a file.
- **One `README.md` per folder** says what the layer is for, lists its modules with one line each, and states the layer's rules (for example `core/README.md`: "no DOM, no network; I/O is injected; every module has a test").
- **`web/bench/README.md`** is the map: the layers diagram, how to build, how to test, where to start reading.
- **The agent's API reference is generated** from the host-API table: each entry's `sig` and `doc` become a line of the prompt and of the API panel in the Eval view, so the reference cannot drift from the code.
- **This guide** describes the design and links to the folders; it does not repeat what the READMEs say.

### 6.7 Tooling

| Command | What it does |
|---|---|
| `node tools/imports.mjs` | checks every module's imports against what it uses, and the layer rules; exits 1 on a difference |
| `node tools/imports.mjs --write` | rewrites the import lines to exactly what each module uses |
| `node --test test/` | the Node tests (core and model) |
| `node build.mjs` (or `make bench`) | runs the import check, bundles with esbuild, writes the probe |
| `go test ./pkg/host -run Bench` | the bench actor against a real server, and that the committed build is fresh |

### 6.8 How we get there

The restructuring happens in the same branch as the rewrite, layer by layer from the bottom, so each layer is in its final form before anything is built on it:

1. `lib/`: split `01-util.js` into `util.js`, `dom.js` and `text.js` (moved, with exports).
2. `core/`: `draft.js` (written, tested), then `api.js` and `scenario.js`.
3. `server/` and `model/`: written new for the design (sections 5.2 and 5.6).
4. `frames/`: the frame host loses the in-browser page builder (frames always show an instance); the probe and layout code move with exports.
5. `agent/`: `06-agent.js` split into the sandbox bridge, the API table by namespace, the eval, the agent and its roles, and the prompt.
6. `ui/`: the views move and take their project as a parameter; the shell is the last module written.
7. `README.md` files, the generated API reference, and the old `NN-*.js` files deleted.

Code moved without a behavior change keeps its form, and gets the line-length and one-statement rules when it is next changed for a reason. Rewritten code follows every rule from the start.

## 7. Implementation plan

Four phases, each one PR. Each phase leaves the bench working. We may wipe the bench's stored projects and threads at any phase (the bench reached staging on 2026-11-16, with no real users). App stores, which hold the actual apps, are never touched.

### Phase 1: the server commit

**Code:**
- `pkg/store/files.go`: `Turn.SnapshotFiles(n)`, `Turn.ResetTree(n)`, and a per-path diff helper.
- `pkg/commands/files.go`: `files.commit` (`FilesCommitIn/Out`) with the semantics of section 5.1.
- `files.push`: required `ifAt` when `ref` is given.
- `ref.move`: required `ifAt`. Update the CLI's push and ref commands to read the ref first and pass it.
- `pkg/doors/actors/modworkshop.go`: `{JS: "commit", Verb: "files.commit", Pos: ["store", "changes"], Default: {ref: "draft"}}`.
- `apps/bench/actor.js`: a `commit` action (as the visitor; it activates the dev instance like `sync` does). Convert refs to numbers at the start of `open`, `read`, `preflight`.

**Tests:** Go tests for `files.commit`, next to `TestPushIfAt` and `TestRefMoveIfAt` in `pkg/host/devloop_test.go`:
- a clean commit;
- the merge of disjoint changes;
- a conflict on the same path, with nothing written;
- delete versus edit;
- empty text;
- a blob that is missing (`missing_blobs`);
- the required `base`;
- two concurrent commits from goroutines, where exactly one wins per path;
- an identical-tree commit returning the existing number.

**Done when:** `go test ./pkg/store ./pkg/host` passes, and the CLI's push and ref commands work against a local server.

### Phase 2: the Draft core and the switch-over

**Code:**
- `web/bench/src/core/draft.js`: `Draft`, `Tx`, the snapshot cache, `toWire`.
- `runEval` on transactions (section 5.4); `tx.*` and `dry.*` remapped to nested transactions.
- `Agent.delegate` passes `parentTx`.
- The code view commits through a per-file `Tx`.
- `Publish.check` commits the open editor transactions, then preflights the draft head.
- `Outside` becomes a head poll (or the event stream) that only updates `draft.head` and the header.

**Delete:**
- `Sync` and `Outside.merge`;
- `P.tree`, `P.synced`, `P.extern` and the hash-only handling in `04-project.js`;
- `P.revert` for app files, `touchFile` and `ctx.scratch`;
- the actor's `sync` and `head` merge answers.

**Tests:** the Node property test (section 8.2), plus a browser smoke test through `window.__SB`:
- an eval commits and its frames reload;
- a failed eval writes nothing;
- delegation folds;
- a conflict between two threads is reported to the second.

**Done when:** the property test passes 10,000 random runs, and the Sudoku walkthrough (SLOP3-022 step 27) works end to end on a local server.

### Phase 3: the host-API table

**Code:**
- `web/bench/src/06-agent.js`: `defineAPI` and `dispatch`, with every `hostAPI` function moved into the table.
- The worker receives its long-call set at session start.
- The `API_GUIDE` reference section is generated.

**Delete:** `API_SIGS`, `checkArgs`, `LONG_CALLS`, the worker's `LONG`, and the hand-placed guards.

**Tests:**
- a table-driven test: every declared call with wrong arity fails with its signature;
- every `writes` call is refused in read-only mode;
- every `dry: 'refuse'` call is refused in a dry run.

**Done when:** no host-API function checks a guard by hand.

### Phase 4: storage on the server

**Code:**
- `apps/bench/sql/` migrations (section 5.6), and actor actions `threads`, `messages`, `events`.
- `Project` loads threads and the timeline from them.
- Every template becomes an app; the artifact mode is removed.
- Proposals as refs, with an instance per proposal; accept via `files.commit`.

**Delete:**
- `03-store.js` except for preferences;
- `LOG_CHUNK`/`LOG_PIECE` and their helpers;
- the mock-table model and the srcdoc page builder;
- `10b-archive.js`'s timeline import path, rewritten against the new tables.

**Cutover:** delete the bench store's per-user documents (or start from a fresh bench store), then `make deploy-apps`.

**Tests:**
- actor tests for the new actions;
- a timeline of 10,000 events loads without splitting;
- accepting a proposal merges like any commit.

**Done when:** a project's whole history survives a reload and a second browser.

## 8. Testing strategy

### 8.1 Server

`files.commit` is the one place concurrency is decided, so its tests carry the design. Write them beside the existing push tests (`pkg/host/devloop_test.go`) and the snapshot tests (`TestFilesAndSnapshots`, `pkg/store/store_test.go`). For the concurrency test, start two goroutines committing against the same `base`. They are serialized by `Store.Do`, so assert that both land when their paths are disjoint, and that exactly one lands when they share a path.

### 8.2 The Draft core under Node

The Draft core is pure once `call` is injected. A fake server implements `commit`, `files` and `head` with the same rules as section 5.1, in memory, with random delays. A property test then runs random programs:

```js
// operations a generator draws from, with random interleaving and latency
op := write(tx, path, text) | write(tx, path, '') | remove(tx, path)
    | begin(parent?) | commit(tx) | abort(tx)
    | outsideCommit(paths)          // a CLI push or another browser
    | slowServer(ms)
```

The invariants checked after every step:

1. **Committed means committed.** Whenever a `commit` returns `{status: 'committed', n}`, the server's snapshot `n` equals the transaction's base, plus the changes of every transaction committed since, plus this transaction's changes.
2. **Nothing aborted is ever visible.** No snapshot contains a change from an aborted transaction, or from a nested transaction whose parent aborted.
3. **Conflicts write nothing.** After `{status: 'conflict'}`, the server's head is unchanged by this commit.
4. **Reads are consistent.** `tx.read(path)` equals its own change, else its parent's view, else the base snapshot. It never shows another transaction's uncommitted change.

These four invariants cover every finding in group A. Under today's design they could not be written down, because no state records "committed".

### 8.3 In the browser

Keep a short smoke script that drives the real bench through `window.__SB` on a local server (`make run-local`), as SLOP3-022 did. Its one end-to-end case: create an app, run an eval that writes two files, check `effects.draft` and that the dev frame shows the change, run a failing eval and check that nothing changed, then publish.

## 9. Decisions and open questions

These need a decision before or during implementation:

- **Commit granularity for typing.** The proposal is 400 ms of idle, plus blur and save. Every commit creates a snapshot. Snapshots are cheap (rows of hashes, deduplicated identical trees), but a long typing session creates hundreds. Option: squash editor commits older than a day into the next agent commit. This is not needed for phase 2.
- **Conflict presentation in the editor.** A side-by-side view is the minimum. Line-level three-way merge is a later improvement; the server stays per-file.
- **Seeing an uncommitted transaction in a frame.** `preview.url` already serves a private preview of any snapshot (`pkg/commands/preview.go:21`). A transaction could be committed to a temporary ref (`tx/<id>`) for a preview frame. Not in scope; agents check after committing.
- **Several developers on one app.** `draft` is one ref per app. With per-file merge, two developers committing to it is safe, but they see each other's work as soon as it commits. Per-developer refs (`draft/<user>`) are possible later. This design does not prevent them.
- **The event stream.** Polling `head` is enough for phase 2. A stream needs a server-sent-events channel from the page door. That decision belongs with the temporary dev link work (SLOP3-022 `hm4w`), which wants the same "ref moved" notification.

## 10. Reference

### 10.1 APIs

| Name | Where | Today | After |
|---|---|---|---|
| `files.push` | `pkg/commands/files.go:140` | whole-tree manifest, optional `ifAt` | CLI imports only; `ifAt` required with `ref` |
| `files.commit` | new, `pkg/commands/files.go` | — | `{store, ref, base, changes, message, activate}` → `{ok, n, merged, activated}` or conflict |
| `ref.move` | `pkg/commands/files.go:227` | optional `ifAt` | `ifAt` required |
| `workshop.*` | `pkg/doors/actors/modworkshop.go:17` | `push`, `files`, `read`, `publish`, … | adds `commit` |
| bench actor `sync`, `head` | `apps/bench/actor.js:118`, `:148` | push manifest, merge answers | removed; `commit` and a plain `head` |
| `Sync`, `Outside` | `web/bench/src/03b-slop.js:55`, `:170` | replica and merge | removed |
| `Draft`, `Tx` | new, `web/bench/src/core/draft.js` | — | section 5.2 |
| `runEval` | `web/bench/src/06-agent.js:476` | undo log, holds, flush | section 5.4 |
| `hostAPI`, `API_SIGS`, `LONG_CALLS` | `web/bench/src/06-agent.js:117`, `:75`, `:73` | spread out | one table (section 5.5) |
| worker `LONG` | `web/bench/src/worker.js:242` | separate list | sent by the page |
| `Store` | `web/bench/src/03-store.js:3` | project data in documents | preferences only |
| timeline storage | `web/bench/src/04-project.js:1-34`, `:255` | chunks and pieces | actor SQL `events` |

### 10.2 Files to read first

1. `pkg/store/files.go` (snapshots, refs, the tree) and `pkg/store/turn.go` (`Do`).
2. `pkg/commands/files.go`: `push` (`:334`) and `ref.move` (`:227`).
3. `apps/bench/actor.js`: the header comment and `sync` (`:118`).
4. `web/bench/src/03b-slop.js`: `Sync` and `Outside`, the code being replaced.
5. `web/bench/src/06-agent.js`: `hostAPI` (`:117`) and `runEval` (`:476`).

A useful first command, from the repository root:

```bash
GOWORK=off go test -tags sqlite_fts5 ./pkg/store ./pkg/host \
  -run 'FilesAndSnapshots|PushIfAt|RefMoveIfAt|PushActivates' -v 2>&1 \
  | grep -E '^(--- |ok)'
```

Then start a local server (`make run-local`, a development server on `*.localhost:18300`), run `make deploy-apps` against it, open `/bench`, and watch `Sync`'s state in the console through `window.__SB.Sync` while you edit a file. Seeing the four maps change is the fastest way to understand why we are removing them.

### 10.3 Related tickets

- SLOP3-022: the bench (phases 0–5). Its diary steps 14–28 record the review rounds summarized in section 4. Its tasks hold the follow-ups this design enables: the temporary dev link (`hm4w`), first-publish URLs (`ltcr`), agent screenshots of frames (`6q5p`) and the 10-round cap (`28ip`).
- SLOP3-009: the typed verb table on the server, the model for section 5.5.
