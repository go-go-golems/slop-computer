---
Title: 'Intern guide: Claude Blocks on slop'
Ticket: SLOP-008
Status: active
Topics:
    - tools
    - collaboration
    - architecture
    - frontend
    - backend
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/10/29/SLOP-008--claude-blocks-on-slop-notion-shaped-live-pages-over-a-hypha-log-as-a-workshop-tool/scripts/01-hypha-headless.js
      Note: Experiment 1, the Hypha kernel in Node on Blocks' example workspace (replay, checkpoint, turns, permissions)
    - Path: repo://ttmp/2026/10/29/SLOP-008--claude-blocks-on-slop-notion-shaped-live-pages-over-a-hypha-log-as-a-workshop-tool/scripts/02-hypha-goja.go
      Note: Experiment 2, the same kernel inside Go through goja, with a 5,000-op replay timing
    - Path: repo://web/pinup/slop/js/00-slop-host.js
      Note: Pinup's window.claude adapter, the model and the starting point for Blocks' adapter
    - Path: repo://pkg/store/docs.go
      Note: The docs store Blocks' log would live in (DocTypes, limits, path rule)
    - Path: repo://pkg/server/docs.go
      Note: Docs API, docs stream and presence endpoints
    - Path: repo://pkg/server/serve.go
      Note: serveSandbox serves a version's sibling files, so Blocks can ship as its upstream files
    - Path: repo://pkg/store/tools.go
      Note: ToolPermissions, the permissions a tool manifest can ask for
ExternalSources:
    - /home/manuel/code/others/ramon/claude-blocks
    - /home/manuel/code/wesen/go-go-golems/go-go-parc/Projects/2026/10/29/PROJECT REPORT - Claude Blocks - Notion-Shaped Pages Over a Live Hypha Log - A Technical Deep Dive.md
Summary: "How Claude Blocks works (Hypha log, pages as scopes, blocks as cells, Claude blocks, its window.claude host contract), which parts of slop it lands on, what the two experiments showed (the kernel runs headless in Node and in goja), the gaps against Pinup's adapter, and a phased plan to run Blocks as an admin-only Workshop tool with agents, snapshots and an optional site viewer."
LastUpdated: 2026-10-29T16:30:00-04:00
WhatFor: "Onboarding and the implementation plan for Claude Blocks on slop"
WhenToUse: "Before working on web/blocks, the shared slop host adapter, the slop blocks CLI or the headless Hypha package"
---

# Intern guide: Claude Blocks on slop

This guide is for someone who has not seen slop's tool system or Claude Blocks before. It explains both well enough to build the integration, then proposes the design and a phased plan. It assumes you can read JavaScript and Go. Read sections 1 to 3 before anything else; they define the words the rest of the guide uses.

The guide distinguishes three kinds of statement:

- **Observed:** read in the code (with a file and line) or measured in the two experiments in `scripts/`.
- **Proposed:** the design in sections 6 to 9. Nothing in it is implemented yet.
- **Open:** questions in section 12 that need a decision or a measurement.

## 1. Executive summary

**Claude Blocks** ("Blocks" below) is a claude.ai Artifact built on Ramon Marc's CC5 (the files do not say who wrote the Blocks layer itself). It shows a shared workspace as Notion-like pages: a sidebar of nested pages, a column of blocks, a slash menu, databases shown as tables and boards. Every page, property and block is a cell in one **Hypha** log that people and Claudes write together. Blocks talks to its host only through `window.claude.use(name)`, the same door Pinup uses.

slop already runs Pinup this way (SLOP-004): an admin opens a **tool** in the Workshop, slop hands it a short-lived **grant**, and a host adapter (`web/pinup/slop/js/00-slop-host.js`) implements `window.claude.use` over slop's **docs store**. Blocks asks for the same capabilities (`db`, `user`, `room`, and optionally `sample`, `mcp`, `assets`, `downloads`) and stores its log in the same shape: small JSON documents under `collection/id` paths. So most of the integration exists.

The proposal, in one paragraph: ship Blocks' ten upstream files unchanged as a page artifact with a tool manifest. Add a host adapter that closes five concrete gaps against Pinup's (section 5), and let the docs store keep workspaces of a new type `blocks`. Then give agents a way in. First, the CLI speaks Blocks' existing chat protocol, which needs an open tab. Next, the CLI embeds the Hypha kernel through goja, so an agent can read and write a workspace with no browser open. Experiment 2 shows the kernel runs in goja unchanged. An in-page Claude (`sample`) and a public read-only viewer are later, optional phases. The tool is admin-only by construction, which matches "only for us on the backend".

## 2. Orientation: the two systems

### 2.1 slop in one page

slop (`slop-computer`) is a Go server with a Postgres (or SQLite) store, a React admin UI called the **Workshop**, and a CLI (`slop`). Its core objects:

- **Artifact:** a named thing with versions. `kind: page` artifacts are HTML pages; `kind: data` artifacts hold files that become **records** (one record per file: Markdown with front matter, JSON, CSV or text; `pkg/records/records.go:80-112`). Each version is immutable; the `main` ref points at the current one.
- **Route:** maps a URL on a site host to a page artifact (and optionally binds data artifacts to it).
- **Sandbox host:** pages are served on `s<label>.<sandbox domain>`, an origin separate from the Workshop. `serveSandbox` (`pkg/server/serve.go:458`) renders a version's `index.html` and serves its sibling files by path (`serve.go:501-508`: any path with an extension other than `.html` that is a file of the version).
- **Boot data:** `render.Inject` (`pkg/render/render.go:57`) inserts a `<script id="slop-boot">` JSON block and `/_slop/runtime.js` right after `<head>`; in tool mode it also adds `/_slop/tool.js` (`render.go:68-69`).
- **Tool:** a page version whose `slop.json` has a `tool` section (title, icon, permissions). An admin enables a version (`PUT /api/tools/{id}`, session-only, `pkg/server/tools.go:21`). Opening `/tools/<id>` in the Workshop puts the page in an iframe (`web/workshop/src/screens/ToolScreen.tsx:119`, `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"`). The Workshop then posts a **grant** (`slg_…`, one hour, `pkg/store/tools.go:21`) into it. `tool.js` keeps the grant in a closure and exposes `slop.tool.ready() → api` with `get/put/post/del/stream/beacon/can/user/people/args/setArgs` (`pkg/render/assets/tool.js:1-15`).
- **Permissions** a tool can ask for are a fixed list (`pkg/store/tools.go:26-37`), for example `docs:read`, `docs:write`, `versions:push`, `threads:write`.
- **Docs store** (SLOP-004): live, mutable JSON documents per data artifact, addressed `collection/id`, with revisions, tombstones, leases and a change stream. Section 4.2 has the details.
- **Threads and `comments wait`:** an agent (a coding agent like Claude Code) blocks on `slop comments wait`. It wakes when someone comments, does the work, and replies. Pinup's "Send to Claude" becomes such a thread.

### 2.2 Claude Blocks in one page

The export (`/home/manuel/code/others/ramon/claude-blocks`, received 2026-10-29, no git history) holds ten files. Seven are byte-identical to CC5 (the "godprompt computer"); `blocks-kit.js`, `blocks.js` and `index.html` are new.

| File | Lines | Role |
|---|---:|---|
| `hypha.js` | 1,058 | The kernel: parser, tree of cells, formulas, log, streams, checkpoints. No DOM. |
| `fruit.js`, `fruit-kit.js` | 492 + 600 | Views as cells: the element library (slider, table, board, chart…). |
| `browser.js` | 172 | The person's own browser through MCP. |
| `computer.js` | 378 | Clock, jobs, files, programs (JavaScript in Web Workers). |
| `lego.js` | 220 | Components (`lib.NAME`). |
| `spore.js` | 2,687 | Spore, a JavaScript app language; code runs through `new Function`. |
| `blocks-kit.js` | 171 | Prose block kinds (`p`, `bullet`, `todo`, `callout`, `fold`, `columns`, `page`, `toc`), rich text, colours. |
| `blocks.js` | 2,381 | The workspace UI, storage, sync, Claude, undo, history. Calls `boot()` at the end. |
| `index.html` | 1,658 | Layout and CSS, the README for Claude (a comment), the Spore textbook (`script#spore-docs`), nine `<script src>` tags (lines 1125-1133). |

The vault report (`PROJECT REPORT - Claude Blocks - … - A Technical Deep Dive.md`) covers the editor in depth. This guide repeats only what the integration depends on.

### 2.3 Hypha: the four ideas you need

1. **An op is one line of text.** `lisbon.days = 5` sets a value. `lisbon.total = sum(costs.*.amount) + stay` sets a formula. `lisbon.days -` deletes. An op is stored as `[id, peer, clock, text, at]`. The state is the result of applying the log.
2. **The tree holds only leaves.** A record written to `lisbon.costs.0` becomes the cells `lisbon.costs.0.what`, `.cat`, `.amount`.
3. **A formula resolves names outward from its scope.** Inside `lisbon`, `days` means `lisbon.days`. A name that does not exist yet makes the formula *unfinished* rather than an error. A **hole**, `?"intent"`, is a cell that is "not written yet".
4. **A view is a subtree of cells.** Inside `ui:`, each line is an element: `lisbon.ui.0 is p "…"` stores `lisbon.ui.0.k = p` and `lisbon.ui.0.text`.

Two more kernel rules matter for sync:

- **Last writer wins per path.** Each write carries a stamp `[clock, peer]`. The newest stamp wins per path, so peers may apply ops in any order and converge (`hypha.js:1-9`).
- **Peers have permissions.** A peer has `can` globs (`"*"`, `"lisbon"`, `"lisbon.*"`, `"!x"` forbids). The kernel refuses a write outside them (`hypha.js:432-443`).

### 2.4 Blocks' data model on top of Hypha

- **A page is a top-level scope** that is not reserved (`desk sys clock spaces theme fn lib jobs ws`; `blocks.js:15`).
- **Metadata cells:** `title icon cover parent full order ui serif small` (`blocks.js:16`). A sub-page has `parent = "other"`.
- **Properties** are the page's other cells: data and formulas.
- **The body** is `page.ui`: blocks in numeric order. New blocks take a number between their neighbours, with a step of 1,024 (`STEP`, `slot`: `blocks.js:833, 856`). When no number is free, the list is renumbered (`relayout`, `blocks.js:873`).
- **A Claude block** is a hole in `ui`. Up to four Claudes fill holes in parallel (`fillHoles`, `blocks.js:401`). Each fills only its hole's paths, and each claims its hole first (`Claims.take`, `blocks.js:390`).

### 2.5 Words this guide uses

| Term | Meaning |
|---|---|
| **workspace** | One Blocks log: all pages. On slop, one data artifact of type `blocks` (proposed). |
| **peer** | A writer in the log: `<u>:<role>`. `u` is `"u" + base36(fnv1a32(userId))` (`blocks.js:11, 512`). Roles: `you`, `claude`, `f1…f4` (hole fillers), `chat`, `ex` (example), `clock`, `p-<app>` (programs). |
| **chunk** | One JSON document holding up to 500 ops of one tab (`chunks/<id>`). |
| **checkpoint** | The folded state: `meta/snap` plus parts `snaps/<id>-<i>`. |
| **turn** | Hypha text an agent outside the page writes for an open tab to apply (Blocks' chat protocol). |
| **capability** | One object returned by `window.claude.use(name)`. |
| **adapter** | Our script that installs `window.claude` on slop. |
| **grant** | The tool's bearer token, held by `tool.js`. |

## 3. Scope

**In scope:**

1. Blocks as an admin-only Workshop tool over the docs store.
2. Agents reading and writing workspaces through the `slop` CLI.
3. A headless Hypha kernel in Go.
4. Versioned snapshots of a workspace.

**Optional, specified but deferred:**

- an in-page Claude (`sample` through an API proxy);
- a read-only site viewer;
- workspace pages as records for the site and Pinup apps.

**Out of scope:**

- changing Blocks' upstream files (defects go to Ramon, section 12.3);
- the MCP browser;
- multi-process presence;
- non-admin users.

## 4. Current state, with evidence

### 4.1 What Blocks asks of its host

`Net.start` (`blocks.js:507-527`) asks for every capability at once and degrades when one is missing:

```js
// blocks.js:510
const [db, user, room, sample, mcp, assets, downloads] = await Promise.all(
  [use("db"), use("user"), use("room"), use("sample"), use("mcp"), use("assets"), use("downloads")]);
// no window.claude            → memory mode: "In this tab · not saved", plays the example
// no db, or no user.me().id   → memory mode
// user.can("data.write") === false → read-only
```

The README for Claude in `index.html` (lines 8-31) lists the capabilities a claude.ai publish should declare:

```text
db: {}, user: { scopes: ["profile"] }, room: { topics: { ops: "interact" } }, sample: { images: true },
assets: {}, downloads: true, mcp: { servers: [{ server: "host:claude_browser", tools: [...] }] }
```

These are the exact calls Blocks makes on each capability (from reading `blocks.js` and `computer.js`):

| Capability | Calls | Used for |
|---|---|---|
| `db` | `doc(p).get()`, `.set(obj)`, `.update(obj)`, `.delete()`, `.acquire({holder, ttlMs}) → {acquired}` | chunks, checkpoint, claims, leases, chat view and turns |
| `db` | `collection(c).onSnapshot(next, err)`: `next` reads **both** `snap.docChanges()` (`blocks.js:546`) and `snap.docs` (`blocks.js:725`) | live chunks; chat turns |
| `db` | `collection("chunks").where("at", ">=", t).onSnapshot(…)` (`blocks.js:541`) | load only chunks newer than the checkpoint |
| `db` | `collection("chunks").get() → {docs}` (`blocks.js:664`) | "Full history" |
| `user` | `me() → {id, name}`, `isOwner()`, `can("data.write")`, `profiles(ids) → {id: {name}}` | identity, read-only, names |
| `room` | `onPeers(cb)` with `{peers: [{peer, isMe, kind, by, presence}]}` | presence, ghosts, claims of others |
| `room` | `on("ops", cb, err)`, `emit("ops", {ops}) → Promise` | a ~50 ms fast path for ops (`blocks.js:612-632`) |
| `room` | `presence(obj) → Promise` | `{u, page, sel, intents, claims, progs}` (`blocks.js:680-690`) |
| `sample` | `sample(prompt, {cache, modelTier: "quick"\|"default", signal, images, tools, onText({text})}) → {text}`; `sample.limits() → {images}` | in-page Claude and hole fillers |
| `mcp` | passed to `CC5Browser.setMcp` | web browsing for `@web` holes |
| `assets` | `upload(file, opts) → {id}`; the file's URL is then `/_blob/<id>` (`computer.js:141-145`) | dropped files |
| `downloads` | `save({filename, data: Blob})` | "Save" of files and exports |

### 4.2 Where Blocks keeps its log

The comment at `blocks.js:498-501` and the code below it define the storage layout:

| Document | Content | Written |
|---|---|---|
| `chunks/<c-u…-tab-seq>` | `{by, tab, seq, at, n, ops: [[id, peer, clock, text, at], …]}`, at most 500 ops or 150,000 characters (`CHUNK_OPS`, `CHUNK_BYTES`, `blocks.js:503`) | the whole chunk again on every flush, 250 ms after the last op (at most 1 s apart; `blocks.js:581-614`) |
| `meta/snap` | `{id, at, clock, parts, folded, prev}` | by the one tab that wins the lease `meta/compact`, every 3,000 ops (`blocks.js:633-660`) |
| `snaps/<id>-<i>` | parts of the checkpoint, at most 180,000 characters each | with `meta/snap`; the previous checkpoint's parts are deleted |
| `claims/<path>` | lease only, TTL 2 min | a hole filler (`blocks.js:390-397`) |
| `leases/<key>` | lease only | programs (`program-<path>`, 20 s) and jobs (`job-<name>-<next>`, 10 min; `computer.js:54`) |
| `data/users/<uid>/blocks` | the chat view: workspace as Hypha (≤120,000 chars), pages, holes, focus, last 30 ops, people, last turn's result, `next` id | an open tab, 1.5 s after changes (`blocks.js:706-721`) |
| `data/users/<uid>/blocks/turns/<t…>` | `{text}`, then `{applied: {ops, errors}}` | an agent writes `text`; a tab leases it for 60 s, streams it as `<u>:chat`, marks `applied` (`blocks.js:722-750`) |

Loading (`Net.load`, `blocks.js:529-561`) restores `meta/snap` and its parts into a fresh kernel. It then subscribes to chunks newer than the checkpoint minus a 15-minute margin, skips ops already folded, and applies the rest in `(clock, peer)` order. `owns(by, peer)` (`blocks.js:563`) accepts an op only when its peer's `u` part equals the hash of the chunk's `by`. That `by` field is how Blocks keeps one user from writing as another. On claude.ai the platform attests the author of a document. In the chunk body it is just a field the client wrote.

The clock (`clock.now` and friends) is **local**: `Clock.apply` calls `K.local` (`computer.js:23`, `hypha.js:723`), which never enters the log. Jobs and programs run only in an open tab, under a lease.

### 4.3 The Hypha kernel API the integration uses

From `hypha.js` (exports at line 1038):

```text
new Kernel()
  .peer({id, kind, can})                 register a peer and its write globs           :432
  .commit(stmt|text, peerId, {coalesce}) write as a local peer → op {id, ok, err, path} :743
  .receive({id, peer, clock, text, at})  apply a remote op (dedupe by id)              :766
  .batch(fn)                             apply many, recompute once                    :731
  .valueAt(path)  .exists(p)  .children(p)  .holes()  .cells  .log  .clock
  .toHypha(opts)  .toHyphaWithin(budget, focus, {paths})  the tree as Hypha text        :843, :915
  .checkpoint() → {clock, ops, stamps}   .restore(cp, tag)                             :890, :906
  .replay(n) → Kernel                    the state at op n                             :923
new Stream(kernel, peerId, {base})       text arriving in pieces: .feed(chunk) … .end() → ops   :935
Hypha.POS, Hypha.CONTAINERS              the parser's element registry (blocks-kit adds to it)
```

`blocks-kit.js:11-13` makes the only parser change Blocks needs: positional arguments for `p bullet numbered todo callout fold columns page toc`, and which kinds can hold children.

### 4.4 What slop provides today

**The docs store** (`pkg/store/docs.go`):

- `DocTypes = {"pinup": true}` (line 17): only data artifacts of these types keep live documents.
- **Limits** (lines 20-26): 256 KiB per document, 20,000 live documents and 64 MB per artifact, leases of at most 1 minute, tombstones kept 7 days.
- **Paths** must match `^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_.:-]{1,128}$` (line 46), that is exactly two segments with an id of at most 128 characters.
- **Writes** take the artifact's `doc_heads` row lock first, then the document. Revisions are contiguous and commit in order (fixed in PR #3).

**The docs API** (`pkg/server/docs.go:22-31`), each route guarded by a permission:

```text
GET    /api/docs/{artifact}?prefix=&after=      docs:read   → {docs: [{path, data|null, rev, by, at}], rev}
GET    /api/docs/{artifact}/{coll}/{id}         docs:read
PUT    /api/docs/{artifact}/{coll}/{id}         docs:write  body: a JSON object → {path, rev}
DELETE /api/docs/{artifact}/{coll}/{id}         docs:write  → tombstone
POST   /api/docs/{artifact}/{coll}/{id}/acquire docs:write  {holder, ttlMs} → {acquired}
GET    /api/docs/{artifact}/events?after=       docs:read   SSE: doc {path, rev, data|big, by}, ready {rev}, presence
GET    /api/presence/{artifact}                 docs:read   → {peers}
POST   /api/presence/{artifact}                 docs:write  {peer, presence} | {peer, left}   body ≤ 4 KiB (docs.go:344)
```

- **Doc events** carry the data inline up to 64 KiB (`docEventData`, `docs.go:35`), and `big: true` above that. The client then GETs the document.
- **Event order:** the stream sends revisions strictly increasing and catches up from the table when an event skips ahead (`docEvents`).
- **`by`:** the server records it as the writer's user id (`updated_by`), whether the writer is a grant or a token.

**Pinup's adapter** (`web/pinup/slop/js/00-slop-host.js`, 290 lines), the template for Blocks:

- **Install** (lines 13-36): in tool mode, `window.claude.use(name)` waits for `slop.tool.ready()` and the design picker (`slopPick`, line 250), then builds the capability once.
- **`slopCap`** (lines 38-46): `db` needs `docs:read`; `room` needs `docs:write`; `user` always; `downloads`; nothing else.
- **`slopDb`** (line 72) mirrors every document of the artifact from the docs stream. Snapshots look like the Artifact runtime's (`slopSnap`, line 59). `slopChanges` (line 63) returns `docs: []`, so callers only see `docChanges()`.
- **`slopUser`** (line 150) and **`slopRoom`** (line 175): presence through `/api/presence`, heartbeats every 15 s; `sendToClaudeSession` → a thread.
- **Player mode** (lines 16-21): `slopStaticDb` serves a saved version read-only.

**The `slop docs` CLI** (`cmd/slop/cmds/docs.go`, client in `pkg/client/docs.go:45-113`) lists, gets, puts, deletes and watches documents with a user token. The Pinup help topic is `pkg/doc/topics/pinup.md`.

**Pinup's build** (`web/pinup/slop/build.js`, 57 lines) inlines Pinup's modules into one `index.html` and writes `slop.json` with the tool manifest. It refuses any module containing `</script`.

### 4.5 Experiments: the kernel without a browser

Both scripts are in this ticket's `scripts/` and use the export unchanged.

**Experiment 1, Node** (`scripts/01-hypha-headless.js`): `node 01-hypha-headless.js ~/code/others/ramon/claude-blocks`. It loads `hypha.js` with `require`, adds `blocks-kit.js:11-13`, and plays the example workspace (`SEED` in `blocks.js`) as peer `u1:ex`. Results:

```text
ok   seed applies  102 ops, 226 cells, 0 rejected, 11 ms
     pages: welcome, lisbon, lisbon_prep, reading
ok   welcome.bill = cups * price  = 13.5
ok   lisbon.total, per_person  = 1298, 649
ok   lisbon_prep.ready reads its own todo blocks  = 0.444
ok   holes are listed  welcome.ui.8 lisbon.ui.12 reading.ui.4
ok   lisbon.days = 12 recomputes  total = 2138, per_person = 1069
ok   replayed log converges  103 rows, chunk 12386 bytes
ok   checkpoint restores  226 ops, 101 stamps, 16212 bytes
ok   a turn applies line by line  ok: lisbon.ui.9000 is p "…" | ok: lisbon.budget = 2500 | rejected: not a line (…)
ok   a filler is refused outside its hole  … | refused: welcome.cups = 99 (may only write welcome.ui.8, welcome.ui.8.*)
ok   welcome.cups unchanged
```

- **Values:** they match the vault report (1,298 / 649, then 2,138 after `days = 12`). The report counted 238 cells because its browser run also loaded `computer.js`, which adds 12 local `clock.*` cells.
- **Stored rows replay:** the log, serialised as Blocks stores it and replayed into a fresh kernel in `(clock, peer)` order, gives the same tree, and so does a checkpoint restore.
- **Peer rules:** a turn applies line by line and reports the bad line, and a `can`-limited peer is refused outside its globs.

**Experiment 2, goja** (`scripts/02-hypha-goja.go`, `//go:build ignore`). It runs from a scratch module (instructions in its header) with goja `v0.0.0-20251103141225-af2ceb9156d7`, the version go-go-goja pins:

```text
ok   seed applies  102 ops, 226 cells
ok   lisbon.total, per_person  = 1298, 649
ok   a write recomputes  total = 2138
ok   a turn applies, a bad line is rejected
ok   replayed log converges  104 rows
ok   checkpoint restores  228 ops
ok   5,000 ops replay  274 ms
hypha.js loaded in 10ms; total 395ms
```

goja runs `hypha.js` without modification. Loading it takes about 10 ms. A replay costs about 55 µs per op, so a workspace of 100,000 ops would load in about 5.5 s from scratch. That is why the CLI should start from the checkpoint, as Blocks does.

## 5. Gap analysis

Each row compares what Blocks needs (4.1, 4.2) with Pinup's adapter and the docs store (4.4).

| # | Blocks needs | Today | Consequence if unfixed | Fix (where) |
|---|---|---|---|---|
| G1 | A workspace artifact accepted by the docs store | `DocTypes = {pinup}` | every `db` call fails with 400 | add `blocks` (`pkg/store/docs.go:17`) |
| G2 | Paths `data/users/<uid>/blocks[/turns/<t>]` (4 and 6 segments) | exactly 2 segments | chat view and turns fail | map in the adapter: `chat/<uid>`, `turns/<uid>.<t>` |
| G3 | `claims/<path>` and `leases/<key>` ids up to 180 characters | ids ≤ 128 | a deep hole cannot be claimed; with a 400, Blocks may also go read-only (G8) | the adapter hashes ids over 128 characters |
| G4 | `snap.docs` in collection snapshots | `slopChanges` returns `docs: []` | turns are never seen (`blocks.js:725` iterates `snap.docs`) | return the collection's live documents |
| G5 | `collection(…).where("at", ">=", t)` | no `where` | `TypeError` in `Net.load` as soon as a checkpoint exists | filter in the adapter's mirror |
| G6 | `room.on("ops")`, `room.emit("ops")` | no `on`, no `emit` | `TypeError` in `Net.start` (`room.on` is called unconditionally when `room` exists) | phase 1: accept and drop (chunk events deliver ops within ~0.3-1.3 s); later: an ephemeral broadcast (D4) |
| G7 | An attested author for each chunk and peer | `by` inside the chunk body is client-written | an admin's tab could forge ops as another admin's peer | the adapter overwrites `data.by` with the server's `by`; presence uses the server's `user` |
| G8 | Chunk and snapshot parts under the size limit | 256 KiB per document | `CHUNK_BYTES`/`PART_BYTES` count UTF-16 units: non-ASCII text can make a 150,000-unit chunk ~450 KB of UTF-8. The 413 maps to `invalid_argument`, which `Net.denied` (`blocks.js:576`) treats as "read-only": the tab silently stops saving | a per-type limit for `blocks` (640 KiB), and the adapter maps 413 to a code Blocks does not treat as read-only |
| G9 | Presence up to ~6 KB (6 intents, 20 claims, 12 programs) | 4 KiB body | presence posts fail, so others see no ghosts or claims | raise to 16 KiB (`pkg/server/docs.go:344`) |
| G10 | `sample` | none | no in-page Claude; holes wait for an agent | phase 4 (D6) |
| G11 | `assets` with `/_blob/<id>` URLs | none | dropped files stay in the tab, with a toast | deferred; return `null` |
| G12 | `mcp` | none | no web browsing | out of scope; return `null` |

G4 and G7 are latent in Pinup too: Pinup never reads `snap.docs`, and its documents are not authorship-checked. Fixing them in a shared adapter (D2) improves both.

## 6. Proposed architecture

```text
 Workshop (React)                    sandbox host s<label>.sbx…                       slop server (Go)
┌──────────────────────┐   iframe   ┌───────────────────────────────────────┐        ┌────────────────────────────┐
│ /tools/blocks?ws=ws-x│──────────▶│ index.html (upstream, + 1 script tag)  │        │ /api/docs/ws-x/…           │
│  posts the grant ───────────────▶│  /_slop/tool.js   grant in a closure   │  HTTPS │   docs table (type blocks) │
└──────────────────────┘ postMessage│  slop-host.js     window.claude.use ───┼──────▶│   doc events, presence     │
                                    │  hypha.js … blocks.js  (unchanged)     │◀──SSE──│ /api/presence/ws-x         │
                                    └───────────────────────────────────────┘        │ /api/artifacts, versions   │
                                                                                      │ threads, comments wait     │
 coding agent ──▶ slop CLI ─────────────────────────────────────────────────────────▶│                            │
                  slop blocks view / turn / print / get / save                        └────────────────────────────┘
                  (phase 3: embeds hypha.js through goja and writes chunks as its own peer)
```

**The parts:**

1. **`web/blocks/`.** It holds the upstream export (`upstream/`, unchanged, with `SOURCE.md` and sha-256 hashes), the adapter (`slop/slop-host.js`), a small slop UI (`slop/slop-ui.js`: the workspace picker and *Save version*), and the build (`slop/build.js`).
2. **The shared capability layer** (D2), moved out of Pinup's adapter: the mirror over the docs stream, user, room and presence, error mapping.
3. **Server changes, all small:**
   - the `blocks` document type and its size limit;
   - the presence limit;
   - the `ToolPermissions` wording ("live documents (Pinup, Blocks)");
   - later, an ephemeral room broadcast and a sample proxy.
4. **The `slop blocks` CLI** and a help topic `slop help blocks`.
5. **`pkg/hypha`** (phase 3): `hypha.js` embedded, run through goja, behind a Go API.

**Data:** one workspace is one data artifact, for example `ws-team` (kind `data`, type `blocks`).
- **Its live state** is documents in the docs store: chunks, checkpoint, claims, leases, chat view and turns.
- **Its versions** are snapshots pushed by *Save version* or `slop blocks save`:
  - `workspace.hypha` (`K.toHypha()`);
  - `checkpoint.json` (`K.checkpoint()`);
  - one Markdown file per page, `pages/<name>.md`, with front matter `title`, `icon`, `parent` and the page's Markdown export as body.

Each `pages/*.md` becomes a record (4.4), so site pages and Pinup apps can read a workspace's pages through the existing records API.

## 7. Decision records

### Decision D1: ship the upstream files unchanged, as a multi-file page

- **Context:**
  - Pinup's build inlines its modules into one `index.html`, because Pinup is a module concatenation.
  - Blocks is nine plain scripts plus a page.
  - The vault report's main criticism of Blocks is that it forked CC5 and drifted.
- **Options considered:**
  - (a) inline everything into one HTML file;
  - (b) push the upstream files as siblings of `index.html`, which the sandbox serves (`serve.go:501-508`);
  - (c) patch `blocks.js`.
- **Decision:** (b).
  - The build copies the nine scripts byte for byte and verifies their sha-256 against `upstream/SOURCE.md`.
  - It writes `index.html` = upstream `index.html` with one inserted line before `<script src="hypha.js">`: `<script src="slop-host.js"></script>`.
  - It adds `slop-ui.js` after `blocks.js`.
  - The insertion anchor must occur exactly once, or the build fails.
- **Rationale:** an update from Ramon is a copy plus a hash update. Diffs against upstream stay empty. The browser caches the large scripts across versions.
- **Consequences:**
  - A version has 12 files instead of 1.
  - `render.Inject` still finds `<head>` (upstream line 1).
  - Google Fonts (`index.html`) load from outside; acceptable for an admin tool, noted in 12.2.
- **Status:** proposed.

### Decision D2: one shared host capability layer for Pinup and Blocks

- **Context:** Blocks needs the same `db`, `user` and `room` objects as Pinup, plus fixes G2-G7. Copying `00-slop-host.js` would repeat the fork problem inside slop.
- **Options considered:**
  - (a) copy and adapt;
  - (b) extract the capability layer into `web/slop-host/caps.js`, a plain script with no Pinup names, included by Pinup's build as a module and by Blocks' build as a file.
- **Decision:** (b), as the first step of phase 1. Pinup's browser test (`web/pinup/slop/tests/app.js`, 67 checks) must still pass afterwards.
- **Rationale:** the fixes for G4 and G7 benefit Pinup too, and one copy keeps the docs protocol in one place.
- **Consequences:**
  - `caps.js` must not touch the DOM and must take its configuration (the artifact, the api, the path mapping) as arguments.
  - Pinup keeps its own picker and player mode, and Blocks gets its own.
- **Status:** proposed.

### Decision D3: the log lives in the docs store, in Blocks' own chunk format

- **Context:** Hypha is an append-only log. The docs store is a set of mutable documents.
- **Options considered:**
  - (a) Blocks' chunk documents as they are;
  - (b) a new append-only `hypha_ops` table with an ops API, which would mean replacing `Net` in `blocks.js`.
- **Decision:** (a).
- **Rationale:** it needs no server work beyond G1, G8 and G9. It keeps `blocks.js` unchanged. Checkpoints, folding and full history keep working as Ramon tested them.
- **Consequences:**
  - Each flush rewrites the tab's whole chunk. A 500-op chunk of ~100-byte ops reaches ~50 KB, so a long session uploads roughly the sum of growing chunk sizes. With one flush per op that is about n²/2 × 100 bytes per chunk, or 12.5 MB for 500 ops; in practice flushes batch several ops.
  - This is the price of (a). Phase 1 must measure it (task in 9.1), and (b) remains the escape if it hurts.
- **Status:** proposed.

### Decision D4: no room broadcast at first

- **Context:** Blocks emits every op on the `ops` topic within 50 ms. The chunk document follows 250 ms to 1 s later. The store dedupes by op id.
- **Options considered:**
  - (a) adapter `on`/`emit` that do nothing, so ops arrive with the chunk's doc event;
  - (b) `POST /api/docs/{artifact}/broadcast {topic, data}`, published as an ephemeral event on the docs stream, like presence.
- **Decision:** (a) in phase 1. Add (b) if two people editing side by side find the lag noticeable.
- **Rationale:** (b) is about 40 lines of Go, but it is a new endpoint that relays arbitrary payloads. Measure first.
- **Status:** proposed.

### Decision D5: agents use Blocks' turn protocol, applied by a tab (phase 2) or by the CLI (phase 3)

- **Context:**
  - Blocks already has a protocol for an agent outside the page: read the view document, write a turn document; an open tab leases and applies it.
  - On slop, the agent is a coding agent with the `slop` CLI.
  - Pinup's equivalent (inbox steps) also needs an open tab.
- **Options considered:**
  - (a) the CLI reads the view and writes turns (needs an open tab, about 150 lines of Go);
  - (b) a fake `sample` in the adapter that forwards prompts to a thread and waits for the agent's reply. The latency is minutes, and the hole claims expire after 2 min (`blocks.js:394`), so another tab could fill the same hole.
  - (c) the CLI embeds the kernel (goja), loads checkpoint and chunks, and writes its own chunk as peer `<u>:chat`. Experiment 2 shows this works.
- **Decision:** (a) in phase 2, then (c) in phase 3. In (c) the CLI also applies pending turns itself when no tab takes the turn's lease within a few seconds.
- **Rationale:**
  - (a) uses code Ramon wrote and tested.
  - (c) removes the open-tab dependency without a second protocol: the same turn documents, two possible appliers, and the lease decides which.
  - (b) misuses `sample`.
- **Consequences:**
  - (c) must reproduce Blocks' chunk format and peer naming exactly: `u = "u" + base36(fnv1a32(userId))`, `by` = the user id.
  - A golden test against Node output is needed (10.3).
- **Status:** proposed.

### Decision D6: the in-page Claude through a server proxy, later

- **Context:** `sample` needs a model API key. Pinup's phase 3 has the same need.
- **Options considered:**
  - (a) none: holes wait for agents;
  - (b) `POST /api/sample`, a streaming proxy with the key in Vault, a new tool permission `sample:use`, per-user rate limits, and model tiers `quick → claude-haiku-5-5`, `default → claude-sonnet-5-5`.
- **Decision:** (a) until a key and a budget are decided, then (b).
- **Consequences:** `tool.js` needs a POST stream helper (its `stream` is GET-only today), or the proxy returns plain chunked text.
- **Status:** proposed.

### Decision D7: admin-only, with an optional viewer

- **Context:** the request is "maybe only for us on the backend".
- **Decision:**
  - The tool is admin-only, as every slop tool is: `grantTool` is `guard(admin, …)` (`pkg/server/tools.go:23`).
  - A public, read-only `blocks-viewer` (phase 5) runs without a grant, like `pinup-player`.
- **Consequences:**
  - Every admin with `docs:read` can read every workspace's chat channel. The claude.ai version keeps `data/users/<uid>` private to that user; on slop it is private only by convention. Acceptable for a small admin team; stated in the help topic.
- **Status:** proposed.

## 8. Design details

### 8.1 Files and build

```text
web/blocks/
  README.md                provenance, build, test
  upstream/                the export, unchanged
    SOURCE.md              where from, date, sha-256 per file
    hypha.js fruit.js fruit-kit.js browser.js computer.js lego.js spore.js blocks-kit.js blocks.js index.html
  slop/
    build.js               → dist/slop (the tool) and dist/viewer (phase 5)
    slop-host.js           Blocks' adapter: install, path mapping, capabilities (uses web/slop-host/caps.js)
    slop-ui.js             workspace picker, Save version button
    tests/app.js           browser test (Playwright), like Pinup's
web/slop-host/caps.js      the shared capability layer (D2)
Makefile                   blocks, blocks-push, blocks-check
```

The build, in pseudocode:

```text
build():
  for f in UPSTREAM_SCRIPTS + ["index.html"]:
      assert sha256(upstream/f) == SOURCE.md[f]          // refuse a silently changed upstream
  html := read(upstream/index.html)
  anchor := '<script src="hypha.js"></script>'
  assert count(html, anchor) == 1
  html := html.replace(anchor, '<script src="caps.js"></script><script src="slop-host.js"></script>' + anchor)
  anchor2 := '<script src="blocks.js"></script>'; assert count(html, anchor2) == 1
  html := html.replace(anchor2, anchor2 + '<script src="slop-ui.js"></script>')
  out := dist/slop/
  write out/index.html = html
  copy upstream scripts, web/slop-host/caps.js, slop/slop-host.js, slop/slop-ui.js → out/
  write out/slop.json = {title: "Blocks", kind: "page",
       tool: {title: "Blocks", icon: "layout-list",
              permissions: ["docs:read", "docs:write", "artifacts:read", "versions:read", "versions:push", "threads:write"]}}
```

Make targets mirror Pinup's (`Makefile:38-45`):

```make
blocks:        ; node web/blocks/slop/build.js
blocks-push:   blocks
	$(SLOP) push web/blocks/dist/slop -a blocks --title Blocks -m "Blocks $$(git rev-parse --short HEAD)"
blocks-check:  ; node ttmp/…/SLOP-008…/scripts/01-hypha-headless.js web/blocks/upstream   # kernel regression
```

### 8.2 The adapter: installing `window.claude`

`slop-host.js` runs before `hypha.js` and must install `window.claude` synchronously, because `blocks.js` calls `boot()` → `Net.start()` at load. The capabilities resolve later, once the grant has arrived and a workspace is chosen.

```js
// slop-host.js (sketch)
(function () {
  const sl = window.slop;
  if (!sl || window.claude) return;                          // not on slop: Blocks runs in memory mode
  if (sl.mode === 'tool' && sl.tool) return installTool(sl);
  if (sl.data && sl.data.workspace) return installViewer(sl); // phase 5
})();

function installTool(sl) {
  const ready = sl.tool.ready().then(async api => {
    const ws = api.args.ws || await pickWorkspace(api);       // slop-ui.js; api.setArgs({ws}) keeps the URL
    return { api, ws, caps: SlopCaps.open(api, ws, { mapPath: blocksPath, docLimitCode: 'too_large' }) };
  });
  const made = {};
  window.claude = { use: name => ready.then(c => (name in made ? made[name] : (made[name] = cap(c, name))))
                                        .catch(() => null) };
}

function cap(c, name) {
  const { api, caps } = c;
  switch (name) {
    case 'db':        return api.can('docs:read') ? caps.db() : null;
    case 'user':      return caps.user();
    case 'room':      return api.can('docs:write') ? caps.room({ topics: true }) : null;  // on/emit accepted (D4)
    case 'downloads': return { save: caps.download };
    default:          return null;                            // sample, mcp, assets (G10-G12)
  }
}
```

### 8.3 Path mapping (G2, G3)

Blocks names documents with up to six segments. The docs store wants `collection/id`. The mapping is a pure function in both directions, so the CLI (Go) and the adapter (JS) must implement it identically. Its test vectors live in one JSON file both test suites read.

```text
blocksPath(p):                               // Blocks path → docs store path
  "data/users/<uid>/blocks"             → "chat/<uid>"
  "data/users/<uid>/blocks/turns/<t>"   → "turns/<uid>.<t>"
  "<coll>/<id>" with len(id) ≤ 128      → unchanged          (chunks, meta, snaps, claims, leases)
  "<coll>/<id>" with len(id) > 128      → "<coll>/~" + base36(fnv1a32(id)) + "-" + id[0:100]
collection mapping:
  "data/users/<uid>/blocks/turns"       → prefix "turns/<uid>."   (list, then strip the prefix from ids)
  "<coll>"                              → prefix "<coll>/"
```

Hypha paths use only `[A-Za-z0-9_.]` (`hypha.js:32`), and lease keys are already reduced to `[\w.:-]` (`blocks.js:825`). So the only rewrite needed is length.

### 8.4 The db capability (G4, G5, G7, G8)

The shared mirror (today's `slopDb`) needs four changes:

```text
mirror entry: path → {data, rev, by}                       // keep the server's by (list API and doc events carry it)

deliver(path, data, rev, by):                              // every snapshot the page sees goes through here
  if data and path starts with "chunks/": data.by = by       // G7: the chunk's author is who the server says wrote it

collection(c).onSnapshot(next):
  snapshot := { docChanges() → changes, docs → live docs of c (sorted by path), size, empty }   // G4
collection(c).where(field, op, value) → same collection with a filter predicate on data[field]  // G5 (>=, <=, ==, >, <)
collection(c).get() → GET /api/docs/<ws>?prefix=<c>/ → {docs}

errors (G8): 413 → code "too_large" (Blocks retries flushes, it does not go read-only); 401/403 → "not_granted"
```

`update(obj)` stays get-merge-set, as in Pinup (`00-slop-host.js` `docRef.update`). Blocks only uses it to mark a turn applied, while holding the turn's lease, so the race is harmless.

### 8.5 User, room and presence

- **`user`:**
  - `me()` → `{id: api.user.id, name}`;
  - `can("data.write")` → `api.can("docs:write")`;
  - `isOwner()` → `false`;
  - `profiles(ids)` → names from `api.people` (all admins).
- **`room.presence(obj)`:** merged into the peer's presence and posted with a 250 ms debounce (as Pinup does). The server limit rises to 16 KiB (G9).
- **`room.onPeers(cb)`:** peers carry `by: p.user`, the server-attested user (G7). Blocks reads `p.by` before `presence.u` (`blocks.js:696, 761`). `kind` stays `viewer` for people. Agents waiting on the workspace appear as `kind: agent`, which Blocks ignores.
- **`room.on/emit`:** accepted and dropped in phase 1 (D4). The sketch for phase 1b:

```text
POST /api/docs/{artifact}/broadcast {topic: "ops", data}     docs:write, body ≤ 8 KiB
  → ephemeral event EvRoom {topic, data, by: actor, peer} on the docs stream (never stored)
adapter: room.emit(t, d) → POST;  docs stream "room" events → handlers[t]({data, by, sameTab: peer === mine})
```

### 8.6 The slop UI additions (`slop-ui.js`)

- **The workspace picker** (when `?ws=` is missing) is a small overlay. It lists data artifacts of type `blocks` (`GET /api/artifacts`) and offers *New workspace* (`slop push` of an empty version: `README.md` only), then `api.setArgs({ws})`. It runs before `window.claude.use` resolves, while Blocks shows "Opening…".
- **Save version** is a button injected into Blocks' top bar (`#top`, `index.html:1021`). It uses the handle Blocks exports at boot, `window.blocks` (`blocks.js:2377`): `tree()` for `workspace.hypha`, `md(page)` for each page, and `S.K.checkpoint()` for `checkpoint.json`. It then pushes a version through the same `versions:push` path Pinup's *Save version* uses.

### 8.7 Agents (phase 2): the turn protocol on the CLI

```text
slop blocks ls                              data artifacts of type blocks
slop blocks new <ws> --title "…"            create the workspace artifact
slop blocks view <ws> [--json]              the chat view an open tab keeps (chat/<me>): tree, pages, holes, focus, recent, last
slop blocks turn <ws> [file|-] [--wait]     write turns/<me>.t<ms> = {text}; with --wait, wait until applied, print {ops, errors}
slop blocks holes <ws>                      the view's holes: path and intent
```

A session, end to end:

```text
person:  in Blocks, presses space on an empty line, asks "a packing list", gets a Claude block (a hole)
         no sample → the hole stays: "Claude writes these when the page is open inside Claude"
person:  (phase 2) clicks "Send to agent" in slop-ui.js → thread on ws-x: "fill lisbon.ui.12"
agent:   slop comments wait -p … wakes
         slop blocks view ws-x            → sees lisbon.ui.12 = ?"a packing list…" and the page around it
         writes lisbon.ui.12: + indented blocks into turn.hypha
         slop blocks turn ws-x turn.hypha --wait   → {ops: 7, errors: []}
         replies in the thread
open tab: leases turns/<me>.t…, streams it as <u>:chat, marks applied, rewrites the view
```

The view is written by a tab 1.5 s after changes. Without a tab, `view` reports the age of the view (`asOf`) and `turn --wait` times out with a clear message. Phase 3 removes that limit.

**The help topic `slop help blocks`** teaches:
- the Hypha subset (adapted from `REF()`, `blocks.js:239-313`);
- the page model;
- block paths;
- shape first;
- one worked turn.

### 8.8 The headless kernel (phase 3): `pkg/hypha`

```go
// pkg/hypha: hypha.js (embedded, from web/blocks/upstream via go:embed or a copy at build time) run by goja.
type Kernel struct{ vm *goja.Runtime; k goja.Value }         // one VM per kernel; not safe for concurrent use

func New() (*Kernel, error)                                    // load hypha.js + the blocks-kit POS/CONTAINERS lines
func (k *Kernel) Restore(cp json.RawMessage, tag string) error
func (k *Kernel) Receive(ops []Op) error                       // sorted by (clock, peer); dedupes by id
func (k *Kernel) Write(peer, text string) ([]Result, error)    // a Stream as peer: one Result per line {ok, text, err, op}
func (k *Kernel) Hypha(budget int, focus string, paths bool) string
func (k *Kernel) Value(path string) (any, error)
func (k *Kernel) Holes() []Hole
func (k *Kernel) Checkpoint() (json.RawMessage, error)
type Op struct{ ID, Peer string; Clock int64; Text string; At int64 }

// pkg/blocks: the workspace on the docs store, shared by CLI and (optionally) server
func Load(ctx, api *client.Client, ws string) (*Workspace, error)   // meta/snap + parts, then chunks with at ≥ snap.at − 15 min
func (w *Workspace) Apply(ctx, peerRole, text string) (Result, error) // Write, then PUT chunks/c-<u>-cli<rand>-<seq>
func PeerU(userID string) string                                      // "u" + base36(fnv1a32(userID)), as blocks.js:11, 512
```

How `Apply` keeps Blocks' invariants:

- **Chunk format:** it writes ops as `[id, peer, clock, text, at]` rows into its own chunk, `{by: userID, tab: "cli…", seq, at, n, ops}`. Open tabs receive the chunk through the docs stream and apply it like any other tab's.
- **Peer:** the peer is `<u>:chat`, so Blocks names it "Claude in chat" and colours it as such (`blocks.js:46, 58`).
- **Clocks:** they come from the kernel after loading, so they sort after everything the CLI has seen. Last-writer-wins handles concurrent writers.
- **Turns:** a turn that no tab has leased within 5 s is leased by the CLI, applied, and marked `applied`.
- **Golden test:** for the same inputs, `pkg/hypha` must produce byte-identical `toHypha` output to `scripts/01` in Node.

Phase 3 commands:

```text
slop blocks print <ws> [--page p] [--paths]    replay → Hypha
slop blocks get <ws> <path>                    a cell's value (JSON)
slop blocks turn <ws> file --apply             apply now as <u>:chat (no tab needed)
slop blocks save <ws>                          push workspace.hypha, checkpoint.json, pages/*.hypha (no Markdown: the exporter lives in blocks.js)
```

### 8.9 The in-page Claude (phase 4)

```text
POST /api/sample            perm sample:use (new ToolPermission), admin, grant
  body {prompt, tier: "quick"|"default", images?: [dataURL ≤ 3], max_tokens?}
  → text/event-stream:  event: text  data: {"text": "<all text so far>"}   …   event: done  data: {usage}
adapter sample(prompt, opts): POST, feed every text event to opts.onText({text}); abort on opts.signal; resolve {text}
sample.limits() → {images: true}
server: key from Vault (never in the page), per-user concurrency 4 (Blocks runs 4 fillers), daily token budget, audit row per call
```

`tools` (web search) stays unsupported, so `@web` holes are written without browsing.

### 8.10 The viewer and records (phase 5, optional)

- **`blocks-viewer`** is the same files with `slop.json` `{kind: "page"}` and no tool section. A route binds a workspace: `slop route set /notes/:page blocks-viewer --bind workspace=ws-x`.
- **The adapter in viewer mode:**
  - `db` is static: the bound version's `checkpoint.json` served as `meta/snap` plus one part, and no chunks;
  - `user.can("data.write")` → `false`, so Blocks is read-only;
  - `Host.lease` fails, so programs and jobs never run.
- **Records:** the saved version's `pages/*.md` are records, so Pinup apps (SLOP-005/006) can list a workspace's pages as a data source with no new code.

## 9. Implementation plan

### 9.1 Phase 1: Blocks as a tool (admin only)

1. Import the export into `web/blocks/upstream/` with `SOURCE.md` (origin, 2026-10-29, sha-256 per file).
2. Extract `web/slop-host/caps.js` from `00-slop-host.js` (D2). Pinup's build includes it; `make pinup` and Pinup's 67 browser checks still pass.
3. In `caps.js`: snapshot `docs` (G4), `where` (G5), `by` attestation (G7), 413 → `too_large` (G8), path mapping hook (G2, G3).
4. Server:
   - `DocTypes["blocks"]` (G1);
   - a per-type document limit (`blocks`: 640 KiB) (G8);
   - presence body 16 KiB (G9);
   - permission wording.

   With Go tests.
5. `web/blocks/slop/`: `build.js` (D1), `slop-host.js`, `slop-ui.js` (picker, Save version), Make targets.
6. Browser test `web/blocks/slop/tests/app.js` (10.2).
7. End to end on the local server:
   - two contexts edit one workspace;
   - reload converges;
   - a 3,000-op session triggers a checkpoint;
   - measure bytes uploaded per op (D3) and the edit-to-other-tab latency (D4).
8. Docs: `web/blocks/README.md`, a `slop help blocks` stub, the diary.

### 9.2 Phase 2: agents through the turn protocol

`pkg/client` methods for the mapped paths; `slop blocks ls/new/view/turn/holes`; *Send to agent* in `slop-ui.js` (a thread on the workspace); the full help topic; a CLI test against `slop serve --local` with a headless browser tab applying the turn.

### 9.3 Phase 3: the headless kernel

`pkg/hypha` (goja) with the golden test against Node; `pkg/blocks` (load, apply, peer naming); `slop blocks print/get/save` and `turn --apply`. Measure load time on a large workspace; checkpoint-first loading is mandatory.

### 9.4 Phase 4: sample proxy (needs a key and a budget decision)

### 9.5 Phase 5: viewer and records (optional)

## 10. Test strategy

### 10.1 Go

- **Docs store:** `TestDocs` gains `blocks` acceptance and the per-type limit. A 400 KiB document is accepted for `blocks` and refused for `pinup`.
- **Presence:** a 10 KiB presence is accepted and a 20 KiB one refused.
- **Path mapping:** a table test over the shared vectors file.
- **Phase 3:**
  - `pkg/hypha` golden tests: seed → `toHypha` equal to Node's; replay equals checkpoint restore;
  - a `can`-limited peer is refused;
  - 5,000-op replay time as a benchmark.

### 10.2 Browser (`web/blocks/slop/tests/app.js`, Playwright, the same harness as Pinup's)

1. The page boots in tool mode with a stub `slop.tool` whose api is an in-memory docs store (or against `slop serve --local`), and status reads "Shared · live".
2. Typing in tab A appears in tab B, and the chunk document holds the op with `by` = the user.
3. A forged chunk (`by` of user 1, peer of user 2) delivered by the stub is ignored by tab B (G7).
4. A turn document written by the stub is applied once, marked `applied`, and reported in the view.
5. A claim on a 170-character hole path succeeds (G3).
6. A 413 on a flush does not make the tab read-only (G8).
7. With a checkpoint present, loading uses `where` (G5) and converges.
8. Read-only grant (`docs:read` only): status "Shared · view only", and no writes are attempted.
9. *Save version* pushes `workspace.hypha`, `checkpoint.json` and `pages/*.md`.

Each check should be shown to fail by breaking its fix once, as in SLOP-007.

### 10.3 Kernel regression

`make blocks-check` runs `scripts/01-hypha-headless.js` against `web/blocks/upstream/`. An upstream update that changes kernel behaviour fails here before it ships.

## 11. Key flows

### 11.1 Opening a workspace

```text
Workshop          tool iframe (sandbox)                         server
   │ open /tools/blocks?ws=ws-x │                                   │
   │──── iframe src ───────────▶│ index.html: tool.js, caps.js, slop-host.js, hypha.js … blocks.js
   │                            │ blocks.js boot() → Net.start() → window.claude.use(×7)  (pending)
   │── postMessage grant ──────▶│ tool.ready() resolves → ws from args → caps open
   │                            │── GET /api/docs/ws-x/events?after=0 ────────────────────▶│ replay docs, ready
   │                            │ db, user, room resolve; sample, mcp, assets → null
   │                            │ Net.load: meta/snap + snaps/* → restore; chunks where at ≥ snap.at−15min → apply
   │                            │ Net.channel: watch turns/<me>.*;  presence: POST /api/presence/ws-x
```

### 11.2 One edit reaching another tab

```text
tab A: keystroke → writeText → K.commit → onOp → chunk c-uA-t1-0 grows → flush after 250 ms
tab A: PUT /api/docs/ws-x/chunks/c-uA-t1-0  {by, tab, seq, at, n, ops}      (whole chunk, ≤ 640 KiB)
server: rev n+1, doc event {path, rev, data | big, by}
tab B: mirror update (data.by := server by) → onSnapshot docChanges → Net.load's handler:
       skip seen ids, owns(by, peer) → K.receive → re-render
```

### 11.3 An agent's turn (phase 2)

```text
agent: slop blocks turn ws-x t.hypha → PUT turns/<uid>.t1730… {text}
tab:   onSnapshot(turns/<uid>.*) → snap.docs has t1730… without applied
       acquire(turns/<uid>.t1730…, 60 s) → get → Stream as <u>:chat, 160 chars / 16 ms → ops → chunk → PUT
       update {applied: {id, at, ops, errors}} → rewrite chat/<uid> view
agent: (--wait) GET turns/<uid>.t1730… until applied → prints {ops, errors}
```

## 12. Risks and open questions

### 12.1 Risks

- **Write amplification (D3).** Every flush rewrites the whole chunk. Measure in phase 1; the escape is an ops table.
- **Code runs with the tool's grant.** Spore apps execute through `new Function` in the page (`spore.js:305`), in the same window as `tool.js`, so a Spore app in a workspace can call `slop.tool.ready()` and act with the grant's permissions. Programs run in Workers and cannot. Acceptable because only admins write workspaces. The viewer (phase 5) runs without a grant.
- **Jobs and programs need an open tab** (`computer.js:54`; programs lease 20 s). A `jobs.NAME = {every: "daily 08:00"}` does nothing on slop unless a tab is open at 08:00. Phase 3's kernel could run Hypha-only jobs (`run:` lines) headless; JavaScript programs would still need a browser.
- **Concurrent renumbering** (vault report §4.3): a page renumbered while another peer types into it can lose or duplicate the edit. Agents writing turns into Claude-written pages (which have no gaps) make this likelier. Mitigation without touching upstream: the help topic tells agents to write `page.ui.N` with fresh numbers above the last block, which `REF()` already says (`blocks.js:312`).
- **Large workspaces in the CLI:** replay costs ~55 µs/op in goja; loading must start from the checkpoint.

### 12.2 Open questions

1. Is the D3 amplification acceptable in practice? (measure in phase 1)
2. Is the ~0.3-1.3 s edit lag between tabs acceptable without the broadcast (D4)? (measure in phase 1)
3. Who holds a model API key for `sample`, and with what budget? (D6)
4. Should the Google Fonts request (`index.html` `<link>` to fonts.googleapis.com) be replaced by self-hosted fonts? That would mean a patched `index.html`, which D1 tries to avoid.
5. Should workspace chat channels be private per user (a server-side rule on `chat/` and `turns/` paths), or is admin-visible acceptable? (D7)
6. Should *Save version* run on a schedule (for example hourly while a tab is open), or only by hand?

### 12.3 Upstream defects to report to Ramon (not patched here)

From the vault report §11, all observed:

- the in-page Claude is taught `$.workspace` for Spore, which does not exist;
- the Markdown export ignores `when` blocks and drops `pre:` units;
- renaming a page moves it to the end of its siblings;
- renumbering races concurrent edits.

These affect slop users exactly as they affect claude.ai users.

## 13. References

### Claude Blocks (`/home/manuel/code/others/ramon/claude-blocks`)

- `blocks.js:15-16` reserved names and page metadata · `:28-35` state · `:102-115` `writeText` · `:239-313` `REF()`, the language card · `:314-360` `Claude.ask` · `:385-400` `Claims` · `:401-436` `fillHoles` · `:498-503` storage layout and constants · `:507-527` `Net.start` · `:529-561` `Net.load` · `:563` `owns` · `:576` `denied` · `:581-611` `onOp`, `flush` · `:612-632` room `send/emit/heard` · `:633-660` checkpoint · `:680-702` presence and peers · `:706-750` chat view and turns · `:786-829` `Host` · `:833-890` `STEP`, `slot`, `relayout` · `:2203` `Seed` · `:2367-2379` `boot`, `window.blocks`
- `hypha.js:1-11` design notes · `:32` path grammar · `:411-454` `Kernel`, peers, `allowed` · `:723` `local` · `:743-775` `commit`, `receive` · `:890-930` `checkpoint`, `restore`, `toHyphaWithin`, `replay` · `:935` `Stream` · `:1038-1039` exports
- `blocks-kit.js:11-13` parser registrations · `computer.js:16-23` clock (local) · `:41-60` jobs · `:137-146` files and `assets` · `:295-305` programs in Workers · `spore.js:305` `new Function`
- `index.html:1` head · `:8-31` README for Claude (capabilities, the two-call protocol) · `:1021` `#top` · `:1125-1133` script tags · `:1136` Spore textbook

### slop (`slop-computer`)

- `pkg/store/docs.go:17` `DocTypes` · `:20-26` limits · `:46` path rule · `PutDoc`, `DeleteDoc`, `Docs`, `AcquireDoc`
- `pkg/server/docs.go:22-31` routes · `:35` `docEventData` · `docEvents` · `:344` presence body limit
- `pkg/store/tools.go:21` `GrantTTL` · `:26-37` `ToolPermissions` · `pkg/server/tools.go:20-23` tool routes · `:124` `grantTool`
- `pkg/server/serve.go:458-533` `serveSandbox` (sibling files at `:501-508`) · `pkg/render/render.go:24, 57, 68-69` modes and `Inject`
- `pkg/render/assets/tool.js` the tool client · `web/workshop/src/screens/ToolScreen.tsx:119` the iframe
- `web/pinup/slop/js/00-slop-host.js` (`:13-36` install, `:38-46` `slopCap`, `:59-63` snapshots, `:72` `slopDb`, `:125` `slopStaticDb`, `:150` `slopUser`, `:175` `slopRoom`, `:198` `slopSendToAgent`, `:250` `slopPick`) · `web/pinup/slop/build.js` · `Makefile:38-45`
- `cmd/slop/cmds/docs.go`, `pkg/client/docs.go:45-113` the docs CLI and client · `pkg/records/records.go:80-112` files → records · `pkg/doc/topics/pinup.md`

### Documents

- Vault: `Projects/2026/10/29/PROJECT REPORT - Claude Blocks - Notion-Shaped Pages Over a Live Hypha Log - A Technical Deep Dive.md`
- SLOP-004 guide (Pinup on slop): `ttmp/2026/10/29/SLOP-004--…/design-doc/01-intern-guide-integrating-pinup-into-slop-as-a-workshop-tool.md`
- This ticket's experiments: `scripts/01-hypha-headless.js`, `scripts/02-hypha-goja.go`
