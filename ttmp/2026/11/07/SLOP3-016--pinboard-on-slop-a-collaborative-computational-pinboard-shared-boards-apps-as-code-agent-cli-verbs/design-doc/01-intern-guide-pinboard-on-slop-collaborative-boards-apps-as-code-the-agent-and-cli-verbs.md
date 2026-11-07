---
Title: 'Intern guide: Pinboard on slop — collaborative boards, apps as code, the agent and CLI verbs'
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
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/upstream/pinup/src/09-collab.js
      Note: 'prior art: subscriptions, presence, inbox'
    - Path: repo://apps/upstream/pinup/src/14-log.js
      Note: 'prior art: shared revertible log'
    - Path: repo://cmd/slop/cmds/root.go
      Note: CLI commands generated from the verb table (app commands extend this)
    - Path: repo://pkg/apps/manifest.go
      Note: platform module list (links.new, grants.rm missing)
    - Path: repo://pkg/doors/actors/sample.go
      Note: actor sample without tools (server agent needs them)
    - Path: repo://pkg/doors/mcp/mcp.go
      Note: MCP door (app commands as tools)
    - Path: repo://pkg/doors/pages/live.go
      Note: 'createApp mounts: a member creates a board by visiting /pb/:id'
    - Path: repo://web/runtime/src/sample.ts
      Note: page sample with up to 16 tools (the page agent)
ExternalSources: []
Summary: 'How to turn the single-user Pinboard prototype into a slop app: one store per board, documents instead of IndexedDB, presence, shared apps-as-code with a trust model, the page agent, sharing through grants and links, and CLI access through app commands and the device login. Includes the new platform machinery this needs.'
LastUpdated: 2026-11-07T12:30:00-05:00
WhatFor: Designing and implementing the slop Pinboard app and the platform pieces it needs
WhenToUse: Before writing any Pinboard-on-slop code, or when changing the CLI, actor sample tools or the page runtime for it
---

# Intern guide: Pinboard on slop — collaborative boards, apps as code, the agent and CLI verbs

## 1. Executive summary

Pinboard is a single-page prototype (`sources/pinboard-prototype/`, 2,221 lines of plain JavaScript) of a computational pinboard in the spirit of Are.na. Clips (notes, links, images, documents) and small app windows sit freely on a canvas. A fluent builder grammar describes those apps, and the apps are kept as source code and evaluated in the page. An agent with a single tool, `eval`, organises clips into collections and writes apps, using the same mutation API a person uses. All of it lives in one browser's IndexedDB, for one person.

The goal of this ticket is to make Pinboard a slop app in which:

- several people work on the same board at the same time;
- a person has many boards and shares each one with chosen people or by link;
- the apps people build on a board are shared with everyone on it;
- the board can be read and changed from the terminal, through the `slop` CLI and its device login.

slop already provides most of the substrate. A **store** per board holds the board's documents, uploaded images and room. A **mount** with `createApp` lets members create new boards by visiting a URL. **Grants** and **share links** decide who may open a board. The page **runtime** gives the page `db`, `user`, `room`, `assets` and `sample`. The **Pinup** app already proves the pattern of one store per design, one document per object, a shared revertible log and presence.

Three things are missing, and they are the new machinery this guide designs:

1. **A collaborative store layer for Pinboard itself.** The prototype's in-memory state, transactions and undo must be rebuilt over slop documents, with remote changes flowing into the same reactivity system, undo limited to one's own changes, and a split between state everyone shares and state that belongs to one viewer.
2. **A trust model for apps written by other people.** On a shared board, app source written by one collaborator runs in every other collaborator's browser, with that viewer's identity and model budget. Shared code needs authorship, review and a narrower capability bridge than the board page itself.
3. **App commands in the CLI and over MCP.** Today the CLI's commands are compiled from the server's verb table (`cmd/slop/cmds/root.go:49-64`). A Pinboard board needs commands defined by the app (`slop pb clip add …`), discovered at run time, executed as actor actions, and offered to agents over MCP with the same schemas. A server-side agent additionally needs tools in the actor's `sample` (`pkg/doors/actors/sample.go:42-106` accepts none today).

The guide explains the prototype, the slop pieces, the gaps, a proposed architecture with decision records, the key flows in pseudocode, an implementation plan in seven phases, and a test strategy.

## 2. Problem statement and scope

### 2.1 What the user asked for

The request, paraphrased into requirements:

| Id | Requirement |
|---|---|
| R1 | Several people collaborate on one board, live. |
| R2 | A person creates several boards. |
| R3 | A board can be shared: with named people, with members, by link, at view or edit level. |
| R4 | The board is reachable from a CLI, authenticated by the existing device login. |
| R5 | CLI access uses JavaScript "verbs" mounted into the `slop` CLI. |
| R6 | It stays a computational pinboard: people and the agent build apps on the board, together. |
| R7 | New machinery on the frontend and the backend is allowed where needed. |

### 2.2 In scope

- The data model of a board on slop, and the rewrite of the prototype's store layer.
- Presence, cursors and following another person.
- Images as slop assets.
- Apps as shared source: storage, versions, authorship, trust, isolation.
- The agent on slop: the page agent, budgets and consent, and a later server-side agent.
- Sharing and the list of a person's boards.
- The CLI and MCP surfaces.
- The platform changes these require.

### 2.3 Out of scope (for this ticket)

- Implementing any of it. This ticket delivers the design and the plan.
- Publishing boards as static sites (Blocks has a path for that; it can be copied later).
- Real-time co-editing of a single text field character by character (a CRDT). Section 6.4 explains why last-writer-wins per document is acceptable for a first version.
- Comments (slop does not grant `comments`; `doc/claude-apis/README.md`).

## 3. Orientation

This section defines the terms used in the rest of the guide. Read it before the design sections.

### 3.1 The Pinboard prototype

The prototype is seven script files loaded in order by `index.html` (`sources/pinboard-prototype/index.html:53-59`). They share one global namespace, `window.PB`.

```text
 index.html
   │ loads, in order
   ▼
 store.js ── state (PB.S), IndexedDB, mutations, history, undo/redo, events
 dsl.js   ── the grammar: ui.* builders (Proxy), fragments, IR, db queries, schema builder
 render.js── builder → DOM; the context `c`; dependency tracking per window
 board.js ── canvas, clips, drag/drop, paste, selection, pins, quicklaunch, board API, describe()
 apps.js  ── app() builder, registry (source → eval), built-in apps, the reference text
 agent.js ── agent panel; sample() with one tool `eval`; steps, modes, revert
 main.js  ── boot: load, seed, init board and agent
```

The terms:

- **Board.** The canvas and everything on it. The prototype has exactly one, persisted in the IndexedDB database `pinboard.v1` (`js/store.js:5`).
- **Clip.** One window on the canvas. Kinds are `note`, `link`, `image`, `doc`, `app` and `group` (`js/board.js:5`). Every clip has an id, a position and size (`x y w h`), a stacking order `z`, a title, tags, a note, and kind-specific fields (`text`, `url`, `md`, `blobId`, `app`, `state`, `params`, `children`) (`js/store.js:107-113`, `js/apps.js:307-308`).
- **Builder.** An immutable description of user interface, made with `ui.*` (`js/dsl.js:161-192`). Every call returns a new builder; builders are `Proxy` objects so that a misspelt method produces a helpful error (`js/dsl.js:130-146`).
- **IR.** What `builder.build()` returns: a tree of nodes with ids, props and handlers (`js/dsl.js:209-223`). The design document describes dependency edges in the IR; the code computes dependencies at render time instead (the `deps` array in the IR is always empty, `js/dsl.js:214`).
- **Context (`c`).** The object passed to runtime lambdas: `c.state`, `c.set`, `c.param`, `c.db`, `c.board`, `c.window`, `c.mutate` and more (`js/render.js:13-33`). Reading through the context records a dependency key such as `state:<clip>:<key>` or `coll:<name>`.
- **Mutation and transaction.** All durable changes go through `PB.mutate(fn, by)`. The function receives a recorder `m` with operations (`place`, `move`, `tag`, `insert`, `register`, …). Each operation records the document's value before and after. One call is one transaction and one undo step (`js/store.js:93-189`).
- **Quiet change.** A persisted change that is not in the history: typing in a note, panning, z-order (`js/store.js:204-215`).
- **Collection and record.** Small user databases: a collection has a schema (`fields`, `indexes`), records belong to a collection (`js/store.js:149-165`, `js/dsl.js:234-296`). Queries are filters and sorts over all records in memory.
- **Fragment.** A reusable extension of builders: attributes, methods, queries and decorations (`js/dsl.js:195-206`). Every clip carries four: `taggable`, `sourced`, `bound`, `annotated` (`js/board.js:10-24`).
- **App.** A builder chain `app('name')….register()` describing an app window: state, params, toolbar, view, side column, menu, and hints for the agent (`js/apps.js:7-32`). Apps are stored **as source text** and evaluated with `new Function` when the board loads (`js/apps.js:38-58`).
- **Agent.** A side panel that calls `claude.use('sample')` with the conversation and one page tool, `eval`, whose input is JavaScript run against the board API (`js/agent.js:69-85`, `:132-141`). Modes: `auto`, `ask` (each step waits for approval), `read-only` (mutations throw).
- **Describe.** `PB.describe()` produces the board summary the agent receives as context (`js/board.js:621-631`).

### 3.2 slop

slop hosts **stores**. A store holds documents (a Firestore-like `db`), files, uploaded assets, a room for real-time messages, and optionally runs an **app**: a manifest `app.json`, a page and an actor (`doc/design/slop-v3.md`).

- **Live host and shell.** A page app is opened at a URL on the live host (`apps.<domain>`). The shell signs the person in and frames the page on a **sandbox origin**, a hostname derived from the store and the app (`s<hmac>.<sandbox>`), so that one app cannot script another or slop itself.
- **Page runtime.** In the page, `claude.use(name)` returns a capability or `null`: `db`, `user`, `room`, `assets`, `sample`, `downloads`, `slop` (`web/runtime/src/index.ts:15-30`). The page can use only what its manifest declares and the server grants.
- **Levels.** A person holds a level on a store: `view` < `interact` < `admin` < `owner`, from grants, share links and audiences (`@guest`, `@member`, `@subscriber`).
- **db.** Documents at paths (`clips/c1`, `colls/recipes/rows/r1`), live subscriptions (`onSnapshot`), rules per path with `{self}`, and a private subtree per person, `data/users/<id>/` (`doc/claude-apis/state-storage.md`). Limits: 256 KiB per document, 25,000 documents per store, 64 rules, 64 subscriptions per view (`web/runtime/src/limits.ts:3-25`). Writes are last-writer-wins per document; the runtime sends them as patches against a known version (`web/runtime/src/db.ts:1-15`).
- **user, room.** `user` tells the page who is looking (an id with `user: {}`, names with the `profile` scope; since SLOP3-014, PR #34). `room` gives presence (one small object per open page) and events on topics.
- **assets.** Uploaded files (images up to 20 MiB, `limits.ts`), served to people the policy allows.
- **sample.** Model calls, metered against the payer's monthly budget. In the page, `sample` accepts up to 16 **tools**, JavaScript functions the page runs when the model calls them (`web/runtime/src/sample.ts:70-71`). In an actor, `sample` takes no tools (`pkg/doors/actors/sample.go:42-106`).
- **Actor.** Server-side JavaScript per store, one event at a time, with actions (`slop call <store> <action>`), HTTP routes, reactors on table changes and alarms.
- **Verbs.** The server's API is a table of verbs (`docs.set`, `grant.set`, `link.new`, …). The CLI's commands, the HTTP API and the MCP door are all generated from it (`cmd/slop/cmds/root.go:49-64`, `pkg/doors/mcp/mcp.go`).
- **Device login.** `slop auth login` prints a code; the person approves it in a browser where they are signed in; the CLI receives a token stored in `~/.config/slop/credentials.json` (or `$SLOP_CREDENTIALS`).
- **createApp mounts.** A mount such as `/p/:id --type design --createApp pinup` serves any store of type `design` by id, and lets a member create a new one by visiting an unused id; the creator becomes its owner (`pkg/doors/pages/live.go:443-460`).

### 3.3 Prior art on slop: Pinup and Blocks

Two upstream Claude artifacts already run on slop as collaborative apps (`doc/claude-apis/README.md`, "Blocks and Pinup on slop"):

- **Pinup** (a design canvas): one store per design at `/p/<file>`; one document per layer (`nodes/<id>`); `meta/file`; `log/*`, a revertible history that anyone can revert step by step; `inbox/*`, items that one tab claims with `acquire` and imports; presence with cursors and the current page (`apps/upstream/pinup/src/09-collab.js:23-36`, `14-log.js:1-25`, `02-store.js:116-177`).
- **Blocks** (a block editor): its operation log lives in documents, and live operations also travel on the room topic `ops`; leases coordinate tabs.

Pinboard on slop should copy Pinup's shape wherever it fits. Pinup is evidence that the store-per-document, document-per-object, shared-log design works within slop's limits.

## 4. Current state

### 4.1 State and persistence in the prototype

`PB.S` holds five maps, `clips`, `apps`, `collections`, `records` and `meta`, loaded from IndexedDB at boot (`js/store.js:43, 70-73`). `PB.save` writes a value 40 ms after its last change (`:58-63`). Ids are a prefix and five random base-36 characters (`PB.id`, `:55`), about 60 million values, which is enough for one person and too few for many people creating clips concurrently without coordination. `PB.zTop` is a global counter for stacking order (`:171`).

### 4.2 Transactions, history and undo

`PB.mutate(fn, by)` creates a recorder, runs `fn`, collects operations `{store, id, before, after, label}`, and pushes one transaction on `PB.history` (`:172-189`). Undo writes each `before` value back in reverse order (`:190-195`). This is correct for one person. With several people, undoing my transaction would overwrite changes others made to the same documents after me.

### 4.3 Reactivity

Each clip window is rendered with a fresh context; everything the render reads through the context is recorded as a dependency key (`js/render.js:13-36`). After a mutation, `B.onChange(keys)` re-renders the windows whose dependency set intersects the changed keys (`js/board.js:646-659`). This is a good fit for collaboration: a remote change only has to produce the same keys.

### 4.4 Apps as source

`apps.registerSource(src)` evaluates the source with `new Function('ui','app','db','fragment','board','PB','helpers', src)` (`js/apps.js:38-46`) and stores `{name, source, icon, …}` in `PB.S.apps` (`:47-52`). The source has access to `PB`, the whole application. On one person's machine that is acceptable. On a shared board it means any collaborator who can register an app can run arbitrary code in every other collaborator's page.

### 4.5 The agent

`agent.js` builds a conversation, adds the board description as context, and calls `sample(turns, {tools: [eval], modelTier, onText})` (`js/agent.js:114-158`). The `eval` tool runs the model's JavaScript with `board, db, ui, app, apps, m, describe, log, fragment, PB, select` in scope, with a 25-second timeout and the result cut at 9,000 characters (`:69-85`). In `ask` mode each step waits for the person (`:137`). This already matches slop's page `sample`, which supports page tools (`web/runtime/src/sample.ts:70-90`).

### 4.6 What the design document describes but the code does not have

The examples (`sources/pinboard-api-examples-code.txt`) go further than the code. The implementation should treat these as wishes, not existing behaviour:

- IR dependency edges and `ui.ref` shared nodes (example 06); the code tracks dependencies at render time only.
- Tiled layouts `split`/`tile` and saved layouts (example 12); the code has pins only.
- `board.on('paste', …)` handlers and `board.targets` (examples 02, 08).
- Strict build-time checks of state keys (example 09); the code has method-name diagnostics only.

### 4.7 The slop CLI today

- Commands are generated from the compiled-in verb table: `addVerbCommands` loops over `verbs.Default.All()` (`cmd/slop/cmds/root.go:49-64`). A verb added on a newer server is reachable through `slop verb <name> --json`.
- `slop call <store> <action> [json]` calls an actor action (`cmd/slop/cmds/extra.go:172`).
- `slop eval -f prog.js` runs JavaScript **on the server** with every verb as `slop.<group>.<verb>(args)` (`extra.go:113`, `pkg/commands/eval.go:24`).
- `slop docs get|ls|query|set|update|rm <store> …` read and write documents; `docs set --batch` writes several in one commit, with `ifVersion` for optimistic concurrency (`pkg/commands/docs.go`).
- The MCP door exposes the same verbs as tools to a token's holder (`pkg/doors/mcp/mcp.go:90-226`).

So a board is already reachable from the terminal at the level of raw documents. What is missing is the board's own vocabulary: "add this link as a clip", "list the recipes collection", "run the moodboard app's describe".

## 5. Gap analysis

| Req. | What exists | What is missing |
|---|---|---|
| R1 live collaboration | db with live subscriptions; presence; Pinup's patterns | Pinboard store layer over db; remote changes into reactivity; collaborative undo; shared vs. per-viewer state; id scheme; presence UI |
| R2 many boards | stores; `createApp` mounts; `store.ls` lists stores you own or hold a grant on | a "my boards" page in the app (the page cannot list stores today); board creation with a title |
| R3 sharing | `grant.set`, `link.new`, levels, audiences | a share dialog the board's admin can use from the page (the page cannot call `grant.set`) |
| R4 CLI with device login | device login; `docs.*`, `call`, `eval` verbs | nothing for raw access; the board vocabulary is missing |
| R5 JS verbs in the CLI | `eval` runs JS on the server; actor actions | app-defined commands: declared, discovered, offered as CLI subcommands and MCP tools |
| R6 apps built together | page `sample` with tools; apps as source | shared app storage with versions and authors; a trust model and isolation for others' code; server-side agent needs actor `sample` tools |
| — images | assets capability | uploads from the page and from the CLI (`import files --zone assets` exists for files); clips that reference asset ids |

## 6. Proposed architecture

### 6.1 Overview

```text
                           apps.<domain>  (live host, shell)
   person A ──browser──▶  /pb/:board  ─┐               ┌──────────────── store "kitchen" (type pinboard, app pinboard)
   person B ──browser──▶  /pb/:board  ─┤ sandbox page  │  db:     board/meta, clips/*, apps/*, colls/*/rows/*,
                                        │ (Pinboard UI) │          log/*, data/users/<id>/*
                                        │  claude.use:  │  assets: uploaded images
                                        │  db user room ├─▶room:   presence {cursor, sel, view}, topic "ops"
                                        │  assets sample│  actor:  pinboard core (actions = commands)
                                        └───────────────┘
   terminal ── slop CLI (device login token) ──▶ /api/v1: docs.*, actor.call, app.commands (new), eval
   agents  ── MCP door ─────────────────────────▶ verbs + app commands as tools (new)
                           app store "pinboard": app.json, index.html, js/*, core.js, actor.js
                           home: /pb  → the "my boards" page (store "pinboard-home")
```

One **app store**, `pinboard`, holds the code. Each **board** is its own store of type `pinboard` that runs the app `pinboard`. The same JavaScript **core** (the mutation recorder, the clip and collection operations, `describe`) runs in three places: in the page against the page's `db`, in the actor against the actor's `db`, and therefore behind the CLI and MCP through actor actions.

### 6.2 Stores, mounts, grants

```sh
slop store new pinboard                       # the app's code
slop push apps/pinboard --store pinboard
slop mount set apps.<domain> /pb/:id --storeParam id --type pinboard --createApp pinboard   # members create boards
slop policy set pinboard sample @member on    # the agent, on each member's own allowance
slop policy set pinboard assets @member on    # default already, stated for clarity
```

- Visiting `/pb/kitchen` as a member creates the store `kitchen` (type `pinboard`, app `pinboard`), and the visitor becomes its owner. This exists today (`live.go:443-460`).
- The owner shares with `grant.set kitchen usr_… interact`, `grant.set kitchen @member view`, or `link.new kitchen interact`. Levels mean: `view` reads the board and runs its apps read-only; `interact` edits clips and records; `admin` also registers apps, changes rules of the board, and shares.

### 6.3 The data model

Paths are chosen so that each kind of thing is one collection, every object is one document (small, independently writable), and the privacy rules can be expressed in the manifest.

| Path | Document | Written by |
|---|---|---|
| `board/meta` | `{title, about, createdAt, layout?, defaults}` | admin |
| `clips/<id>` | `{kind, x, y, w, h, z, title, tags, note, text?, url?, desc?, md?, asset?, dims?, app?, state?, params?, group?, children?, binding?, pinned?, source, by, at}` | interact |
| `apps/<name>` | `{name, source, icon, title, about, version, by, at, reviewedBy?, sha256}` | admin (see 6.8) |
| `apps/<name>/versions/<n>` | `{source, by, at, sha256, note}` | admin |
| `colls/<name>` | `{name, fields, indexes, version}` | interact |
| `colls/<name>/rows/<id>` | the record, plus `{by, at}` | interact |
| `log/<txid>` | `{by, at, label, ops: [{path, before, after}], undone?, revertOf?}` | interact |
| `inbox/<id>` | items dropped by the CLI or the agent, claimed with `acquire` and imported by one tab | interact |
| `data/users/<id>/view` | the viewer's viewport, selection, pins, layouts, agent threads | that person |
| `data/users/<id>/apps/<name>` | the viewer's trust decision for an app version (6.8) | that person |

The manifest:

```json
{
  "title": "Pinboard", "type": "pinboard", "page": "index.html", "actor": "actor.js",
  "capabilities": {
    "db": { "rules": [
      { "path": "board", "read": "view", "write": "admin" },
      { "path": "apps",  "read": "view", "write": "admin" },
      { "path": "log",   "read": "view", "write": "interact" }
    ] },
    "user": { "scopes": ["profile"] },
    "room": { "topics": { "ops": "interact", "agent": "interact" } },
    "assets": {}, "downloads": true, "sample": {}
  },
  "slop": { "commands": "commands.json" }
}
```

`clips`, `colls` and `inbox` take the defaults (read `view`, write `interact`); `data/users/{self}` is private by default. The `slop.commands` field is new (6.12).

**Ids.** Clip, record and transaction ids become `<kind>:<10 base-36 characters>` (about 3.6 × 10¹⁵ values), generated in the page or the actor. Collisions between concurrent writers are then negligible without coordination.

**Size.** A board is limited to 25,000 documents. A busy board with 2,000 clips, 10 collections of 1,000 rows and a log pruned to 2,000 entries uses about half. The log must be pruned (6.4).

### 6.4 The store layer: from IndexedDB to documents

The prototype's architecture already separates "state" from "how it is saved". The rewrite keeps `PB.S` as the in-memory view that rendering reads, and replaces how it is filled and saved.

**Loading and remote changes.** At boot the page subscribes once per collection, as Pinup does (`09-collab.js:23-36`): `clips`, `apps`, `colls`, `log`, `board/meta`, and one subscription per open collection's rows. Each snapshot change updates `PB.S` and emits the same keys a local mutation would (`clips:<id>`, `coll:<name>`, `apps:<name>`), so `B.onChange` re-renders exactly the affected windows. Remote changes from a person's own writes are recognised (`hasPendingWrites`, or by transaction id) and not applied twice.

**Writing.** `PB.mutate` keeps its recorder. Its `write(store, id, value)` (`js/store.js:83-86`) becomes a queued document write: one write at a time per document, the latest value winning, as slop requires ("await each set/update before the next to the same doc", `state-storage.md`). A transaction's operations are written together where possible, and the transaction itself is written to `log/<txid>` (Pinup writes its log entries 450 ms after the last change, `14-log.js:12-15`).

**Shared and per-viewer state.** The prototype stores everything about a window in its clip, including `state` (an app's search box text, its selected row) and quiet changes (z-order, a note being typed). On a shared board those split three ways:

| Kind | Examples | Where | How it travels |
|---|---|---|---|
| shared, durable | a note's text, a clip's position, an app's params, records | the clip or record document | db writes, coalesced while typing (300 ms) |
| shared, momentary | a clip being dragged, a cursor, the selection | presence | `room.presence`, ~30 per second |
| per viewer | viewport, pins, open side panels, an app's local UI state | `data/users/<id>/view` or memory | db, private |

The grammar gets one addition so that app authors can say which is which: `c.state` stays shared (stored in the clip), and **`c.local`** is new, per viewer and per window (kept in memory, optionally in `data/users/<id>/view`). An input bound to a key in `c.local` (`ui.input('q').local()`) no longer writes to the shared document on each keystroke.

**Collaborative undo.** Undo can no longer write `before` values blindly. The rule: a person undoes their own transactions; each operation is undone only if the document still holds the value that operation wrote.

```text
undo(tx):                                   # tx is the person's latest not-undone transaction
  conflicts = []
  for op in reverse(tx.ops):
      cur = PB.S[op.path]
      if equal(cur, op.after): queue_write(op.path, op.before)
      else: conflicts.append(op.path)      # someone changed it since
  write log/<tx.id>.undone = true
  if conflicts: toast("n changes were not undone: someone has changed them since")
```

A log entry anyone can see also allows a "revert this step" for any transaction, by the same rule, as Pinup does (`14-log.js`).

**Log retention.** An actor alarm (`every: {prune: {every: '1h', run}}`) keeps the newest 2,000 log entries and folds older ones into a daily summary document. Restore points for a whole board use slop snapshots (`snap.new` / `ref.move`), which already exist.

### 6.5 Presence and following

Presence carries `{cursor: {x, y}, sel: [ids], view: {x, y, z}, drag?: {id, x, y}}`. The page shows other people's cursors on the canvas with their names (from `user.profiles(by)`), outlines the clips each person has selected, and offers "follow", which applies the other person's `view`. A dragged clip moves for others through presence while it is dragged, and becomes durable with one write when it is dropped. The `ops` topic is reserved for future fine-grained live operations (Blocks uses one).

### 6.6 Images

Pasting or dropping an image uploads it with `assets.upload(blob)` and stores the asset id in the clip (`asset`), replacing the prototype's IndexedDB blobs (`js/store.js:44-54`). `board.putBlob(file)` keeps its name and returns an asset id, so app sources keep working. From the CLI, `slop pb clip add --image photo.png` uploads through the actor (6.12).

### 6.7 Reactivity and rendering

Rendering, the grammar, fragments and the reference stay as they are. Two changes:

- `ui.image(src)` accepts an asset id and resolves it to the asset's URL.
- The renderer re-runs windows on remote keys exactly as on local ones (no change needed beyond 6.4).

### 6.8 Apps written by other people

This is the most important security decision of the design.

**The problem.** The prototype evaluates app source with access to `PB` (`apps.js:41`). On slop the page runs with the viewer's identity: its `db` writes as the viewer, its `sample` spends the viewer's budget, its `assets` upload as the viewer. If Bob registers an app on a board Ada can open, Bob's code runs in Ada's page as Ada.

### Decision: app source is admin-written, versioned, and trusted per viewer

- **Context:** Shared code runs with the viewer's identity and budget. The board page cannot be sandboxed from itself.
- **Options considered:** (a) anyone with `interact` registers apps that run for everyone; (b) only board admins register apps, and everyone runs them; (c) admins register apps, every version records its author and hash, and each viewer runs a version written by someone else only after accepting it once, while an app runs isolated with a narrowed bridge; (d) only the platform's built-in apps run.
- **Decision:** (c) for the first version, with isolation in two steps (below).
- **Rationale:** (a) lets any editor act as every other person. (d) removes the point of the project. (b) is simple but gives every admin silent power over every viewer. (c) keeps building apps together possible, and it makes running someone else's code a visible, per-person decision, as installing software is.
- **Consequences:** The page needs an "app from Bob, version 3, run it?" prompt and a per-viewer trust record (`data/users/<id>/apps/<name>`). Apps written by the viewer, and the built-in apps that ship with the code store, run without a prompt.
- **Status:** proposed

**Isolation, in two steps.**

1. *First version:* app code is evaluated with a narrowed scope instead of `PB`: the grammar, a board API without `PB` internals, `db` limited to the board's collections, no direct `sample`. This prevents accidents and casual misuse, but not a determined author, because the code still runs in the same JavaScript realm as the page.
2. *Later:* each app window runs in its own sandboxed iframe (`sandbox="allow-scripts"`, an opaque origin, as the SLOP3-015 catalog previews do). It talks to the board page over `postMessage` through a capability bridge. The bridge exposes exactly the board API, scoped to what the app's declaration asks for (`.agent.allow([...])` already has the shape of such a declaration). The renderer and grammar run inside the frame. This is real isolation and costs some rendering performance.

### Decision: the page agent stays in the page; a server agent comes later

- **Context:** The prototype's agent runs in the page with `sample` and one page tool. slop's page `sample` supports tools; the actor's does not.
- **Options considered:** (a) keep the page agent only; (b) move the agent to the actor; (c) keep the page agent, and later add a server-side agent for the CLI and for scheduled work.
- **Decision:** (c).
- **Rationale:** The page agent works today with no platform change. It acts with the person's own level and budget, and its `eval` runs against the same API as the person. A server agent is needed only for `slop pb ask "…"` from a terminal and for agents that run without a browser.
- **Consequences:** A later phase adds tools to actor `sample` (`pkg/doors/actors/sample.go`: accept `tools` with JavaScript `execute` functions run in the actor's turn), with the same 16-tool limit and metering.
- **Status:** proposed

On a shared board the agent's steps are transactions by `agent (for Ada)`; they appear in the shared log with that label, and anyone can revert them by the rule in 6.4. The agent's threads are private (`data/users/<id>/view`).

### 6.9 The "my boards" page

`store.ls` lists the stores a person owns or holds a grant on, but a page cannot call verbs. Two options:

### Decision: a runtime call for the person's stores of one type

- **Context:** The home page at `/pb` must list "my boards" and "shared with me".
- **Options considered:** (a) keep an index document per person in a home store, updated when boards are created or shared; (b) let the page read the registry through `_stores` path space (SLOP3-008), which requires the `stores` policy and exposes more than needed; (c) a new runtime call `slop.stores({type})` that returns the stores of that type the viewer holds a level on, with title and level.
- **Decision:** (c).
- **Rationale:** It is one read-only call, scoped by type, computed from grants the server already knows. (a) drifts when someone shares a board from the CLI. (b) is broader than the need.
- **Consequences:** A small change to the page runtime (`web/runtime/src/caps.ts`, the `slop` namespace) and a view RPC in `pkg/doors/pages/views.go` (`rpcTable`), with the authorisation action "list my stores".
- **Status:** proposed

The board title lives in `board/meta`; the call returns it by reading that document when the store is of type `pinboard` (or `store.meta` gains a `title` field, which is simpler and serves Pinup too).

### 6.10 Sharing from the page

The page cannot call `grant.set` or `link.new`. The board's actor can, through the `platform` capability (`app.json slop.platform: ["grants.set", "links.new"]`, a policy cell `platform`, and the shell's confirmation flow for changes made on someone's behalf). The share dialog calls actor actions:

```js
share:   { requires: 'admin', run(ctx, { subject, level }) { platform.grants.set({ store: ctx.store, subject, level }) } },
link:    { requires: 'admin', run(ctx, { level, days }) { return platform.links.new({ store: ctx.store, level, days }) } },
unshare: { requires: 'admin', run(ctx, { subject }) { platform.grants.rm({ store: ctx.store, subject }) } },
people:  { requires: 'view',  run(ctx) { return platform.grants.ls({ store: ctx.store }) } },
```

`links.new` and `grants.rm` must be added to the platform module's list, which today is `stores.create, mounts.set, grants.set` (`pkg/apps/manifest.go:45`). People are picked with `user.search()` (profile scope).

### 6.11 The core, shared by page and actor

### Decision: one isomorphic core with a storage adapter

- **Context:** The page, the actor (CLI and MCP commands) and later the server agent must apply the same operations with the same validation and the same log.
- **Options considered:** (a) separate implementations; (b) one core module that receives a storage adapter.
- **Decision:** (b): `core.js`, loaded by the page as a script and by the actor with `require('./core.js')`.
- **Rationale:** The prototype's recorder (`js/store.js:93-170`) is already pure apart from `write()` and `PB.S`. Parameterising those makes it run in both places.
- **Consequences:** `core.js` must not touch the DOM. The page adapter reads `PB.S` and queues runtime `db` writes; the actor adapter reads with `db.doc(path).get()` and writes in the actor's turn (the actor's `db` is the store's own, with no page rules applied). Tests can run the core in Node with an in-memory adapter.
- **Status:** proposed

```js
// core.js (sketch)
function createCore(storage) {           // storage: { get(path), set(path, value|null), now(), id(kind), by }
  function mutate(fn, label) {
    const ops = [];
    const rec = recorder(storage, ops);  // place, move, tag, untag, setAttr, remove, group, ungroup, pin,
    const out = fn(rec);                 // insert, update, removeRecord, collection, promote, demote, register
    if (ops.length) storage.set('log/' + storage.id('tx'), { by: storage.by, at: storage.now(), label, ops });
    return out;
  }
  return { mutate, describe: (o) => describe(storage, o), query: (coll, q) => query(storage, coll, q) };
}
```

### 6.12 CLI and MCP: app commands

### Decision: app commands are declared actor actions, discovered at run time

- **Context:** R4 and R5 ask for board access from the CLI through JavaScript verbs. The CLI compiles its commands from the verb table (`root.go:49-64`). Board operations are app logic, not platform verbs, and they differ per app.
- **Options considered:** (a) document `slop docs …` and `slop call …` only; (b) a separate `pb` binary; (c) app-defined commands: the app declares commands with argument schemas, the server lists them through a new verb, and the CLI mounts them as subcommands at run time; the MCP door offers them as tools; (d) local JavaScript scripts run by the CLI against the remote verbs.
- **Decision:** (c) now, (d) as a later convenience.
- **Rationale:** (a) works today but makes people learn the board's document layout. (b) duplicates authentication and distribution. (c) reuses actor actions (already authorised per level), the device login and the MCP door, and it works for any app, not only Pinboard.
- **Consequences:** New manifest field, new verb, CLI and MCP changes (below). Commands run in the board's actor with the caller's identity, so levels and budgets apply as in the page.
- **Status:** proposed

**Declaration.** `commands.json` in the app store (referenced from `app.json` as `slop.commands`):

```json
{
  "alias": "pb",
  "commands": {
    "clip add":   { "action": "clip.add",   "doc": "Add a note, link, image or doc to a board",
                    "args": { "text": {"type": "string"}, "url": {"type": "string", "format": "uri"},
                              "image": {"type": "string", "format": "file"}, "title": {"type": "string"},
                              "tags": {"type": "array", "items": {"type": "string"}} } },
    "clip ls":    { "action": "clip.ls",    "doc": "List clips", "args": { "tag": {"type": "string"}, "kind": {"type": "string"} } },
    "coll query": { "action": "coll.query", "doc": "Query a collection", "args": { "name": {"type": "string", "required": true}, "where": {"type": "array"} } },
    "describe":   { "action": "describe",   "doc": "Summarise the board" },
    "app open":   { "action": "app.open",   "doc": "Open an app window on the board", "args": { "name": {"type": "string", "required": true} } },
    "ask":        { "action": "agent.ask",  "doc": "Ask the board's agent (needs actor sample tools)", "args": { "prompt": {"type": "string", "required": true} } }
  }
}
```

**Discovery.** A new verb `app.commands {store}` returns the declaration of the app the store runs (read level on the store). The CLI caches the answer per server and app for a day in `~/.config/slop/commands/`.

**Mounting in the CLI.** `slop app <store> <command> [flags]` always works. A declared alias adds a top-level group: `slop pb <store> clip add --url https://… --tags inspo`. Flags are generated from the JSON Schema (string, number, boolean, array as repeated flags; `format: file` reads a local file and sends it as base64 so the actor can upload it as an asset). Unknown aliases prompt `slop app alias pb pinboard` once. Output uses the CLI's existing `-o yaml|json|table`.

**Execution.** The CLI calls `actor.call {store, action, args}` with the device-login token. The actor's action uses the core, so a clip added from the terminal appears on everyone's open board through the db subscription, with `by: <the person>` in the log.

**MCP.** The MCP door adds, for each store the token's person can open that runs an app with commands, tools named `<alias>_<command>` (`pb_clip_add`), with the same schemas, routed to `actor.call`. To keep the tool list bounded, MCP lists commands per store only when asked for that store (a `store` argument), or for stores the person pins (open question 3).

**Local JS verbs (later).** `slop run script.js` executes a local script in the CLI's own goja runtime, with `slop.*` verbs as remote calls and `pb(store)` returning a client whose methods are the board's commands. This answers "JS verbs" for people who want to script several calls without writing an actor.

### 6.13 New machinery, summarised

| # | Where | Change |
|---|---|---|
| M1 | app (frontend) | store layer over db; remote apply; queued writes; shared log; collaborative undo; `c.local` |
| M2 | app (frontend) | presence, cursors, follow; asset uploads |
| M3 | app (frontend) | trust prompt and narrowed scope for others' app code; later iframe isolation with a bridge |
| M4 | app (both) | `core.js` shared by page and actor; actor actions for commands; share actions through `platform` |
| M5 | platform runtime | `slop.stores({type})` in the page runtime and a view RPC |
| M6 | platform | `slop.commands` in manifests; verb `app.commands`; CLI dynamic commands and aliases; MCP tools from app commands |
| M7 | platform | tools in actor `sample` (server agent) |
| M8 | platform | `links.new` (and `grants.rm`) in the platform module, if missing; optional `title` in `store.meta` |

## 7. Key flows

### 7.1 Creating and opening a board

```text
Ada visits apps/<domain>/pb/kitchen
  shell: no store "kitchen" → mount has createApp → Ada is a member → "Create kitchen?"   (live.go:270-272)
  POST create → CreateStore(type pinboard, app pinboard), owner Ada                     (live.go:451)
  shell opens a view → sandbox page loads index.html, js/*.js, core.js
  page: db, user, room, assets, sample, slop = await claude.use(...)
  page: subscribe clips, apps, colls, log, board/meta; fill PB.S; render
  page: board/meta missing → first visit → seed welcome clips (one transaction)
  page: room.presence({view, cursor:null, sel:[]})
```

### 7.2 A local change

```text
Ada drags clip:k3x… and drops it
  during drag: presence {drag: {id, x, y}} → Bob sees it move
  on drop:  PB.mutate(m => m.move(id, {x, y}), 'Ada')
              recorder: before/after, keys {clips, clips:id}
              PB.S updated → B.onChange → Ada's window re-renders now
              queue_write('clips/' + id, after)  → runtime db patch
              queue_write('log/' + tx, {by, at, label, ops})
Bob's page: onSnapshot(clips) docChanges: modified clips/k3x…
              PB.S.clips[id] = data → emit keys {clips:id} → B.onChange → Bob's window moves
```

### 7.3 Registering an app version

```text
Ada (admin) presses Register in the editor
  core.register({name, source, sha256, version: n+1, by: Ada})
    → apps/<name> and apps/<name>/versions/<n+1>
Bob's page: onSnapshot(apps) → new version by Ada (not Bob)
  if data/users/bob/apps/<name>.trusted == sha256: run it
  else: windows of <name> show "Moodboard v4 by Ada · run it · view source"
  Bob accepts → write data/users/bob/apps/<name> {trusted: sha256} → evaluate in narrowed scope → render
```

### 7.4 A clip from the terminal

```text
$ slop auth login                          # once: device code, approve in the browser
$ slop pb kitchen clip add --url https://are.na/... --tags inspo
  CLI: commands for app "pinboard" cached? else app.commands {store: kitchen}
  CLI: flags → args {url, tags} → actor.call {store: kitchen, action: clip.add, args}
  actor (as Ada, interact checked): core.mutate(m => m.place({kind: 'link', url, tags, source: {from: 'cli'}}))
     → clips/<id>, log/<tx> written in the actor's turn
  every open board page: onSnapshot → the link clip appears, log says "Ada (cli): place clip:…"
  CLI prints {id, kind: link, at: [x, y]}
```

### 7.5 The page agent on a shared board

```text
Ada selects 14 clips, asks "make these a recipes collection and a browser app"
  page: sample(turns, {tools: [eval], modelTier}) on Ada's allowance (needs llm access for Ada's audience)
  step 1 (ask mode: waits for Ada) → eval → core reads → result as YAML
  step 3: m(x => sel.forEach(c => x.promote(c.id, 'recipes'))) → one transaction, by "agent (Ada)"
  step 4: app('recipes')….register() → requires admin; if Ada is not admin: "Error: only admins register apps"
  Bob sees the collection appear, the log entries, and later Ada's app with a trust prompt
```

## 8. Implementation plan

| Phase | Deliverable | Platform change | Check |
|---|---|---|---|
| 0 | The prototype as an app store, single person per board, on slop (`/pb/:id`), IndexedDB replaced by db with the prototype's own undo | none | open, add clips, reload, persist |
| 1 | `core.js` with a storage adapter; page adapter; remote apply; queued writes; shared log; collaborative undo; ids | none | two browser contexts edit one board; undo conflict test |
| 2 | Presence, cursors, follow; assets for images; `c.local` | none | two contexts: cursors, drags, image paste |
| 3 | Apps as admin-written versions; trust prompt; narrowed scope | none | Bob's page refuses Ada's new version until accepted |
| 4 | Actor actions over the core; share dialog through `platform`; "my boards" | M5, M8 | host tests for levels; share by link |
| 5 | App commands: manifest, `app.commands`, CLI dynamic commands and alias, MCP tools | M6 | CLI test against a local server; MCP SDK check |
| 6 | Server agent (`slop pb ask`), log pruning alarm, iframe isolation for app windows | M7 | actor sample tools test; isolation test |

Phase 0 is deliberately small: it proves the app runs on slop and gives a baseline to measure against.

## 9. Test strategy

- **Core, in Node.** `core.js` with an in-memory adapter: each operation, transactions, log entries, collaborative undo with and without conflicts, id format.
- **Host tests** (`pkg/host/*_test.go`, as in `catalog_shelf_test.go`): the manifest's rules (a viewer cannot write clips; an `interact` person cannot write `apps/*`; private `data/users/<id>` stays private); actor actions per level; `app.commands` returns the declaration; `actor.call` of `clip.add` writes `clips/*` and `log/*`.
- **Two-person browser tests** on a local server (`slop serve --local --llm fake`, two Playwright contexts), as done for the SLOP3-015 shelf: concurrent moves, an undo that conflicts, presence, trust prompt. Known pitfall from SLOP3-015: mouse input into a cross-origin frame of a background window is unreliable; bring the page to the front or dispatch events.
- **CLI test:** a Go test that runs the CLI's command builder against a fake `app.commands` answer and checks generated flags; an end-to-end check with a local server and a device-login token in a separate `SLOP_CREDENTIALS` file.
- **MCP:** the official Python SDK (`uvx --with mcp`), as in SLOP3-015's `04-mcp-check.py`.

## 10. Risks and open questions

1. **Document churn.** Coalesce typing (300 ms), drags (presence until drop) and log writes, or a busy board will write hundreds of documents a minute. Measure in phase 1.
2. **Large boards.** Subscriptions cap at 64 per view; one per collection's rows is fine for tens of collections, not hundreds. Rows of closed collections need not be subscribed.
3. **MCP tool explosion.** One tool set per store is too many for a person with 50 boards. Proposal: tools take a `store` argument and are listed once per app.
4. **Same-realm app code (phase 3).** The narrowed scope is not isolation. Until phase 6, only accept code from people you trust; the prompt says so.
5. **Model access.** On production only `@admin` has model access (`slop llm ls`, SLOP3-015). The agent needs `llm set @member on --budget …`, a platform decision.
6. **Concurrent edits of one note.** Last writer wins per document. Two people typing in one note at once will overwrite each other; a per-field merge or a CRDT is deferred.
7. **Should `view` run apps?** Viewers can run apps read-only (mutations throw for them because the store refuses). Apps that only display are useful to viewers; confirm this is wanted.

## 11. API reference

### 11.1 slop verbs used (existing)

| Verb | CLI | Use here |
|---|---|---|
| `store.new {id, app, type}` | `slop store new <id> --app pinboard --type pinboard` | create a board without visiting the URL |
| `store.ls` | `slop store ls` | the person's boards (CLI) |
| `grant.set/rm/ls` | `slop grant set <store> <subject> <level>` | share with people or audiences |
| `link.new/ls/rm` | `slop link new <store> interact --days 7` | share by link |
| `docs.get/ls/query/set/update/rm` | `slop docs query <store> clips --where '[["tags","array-contains","inspo"]]'` | raw access to board documents |
| `actor.call` | `slop call <store> <action> '{…}'` | run a board action |
| `eval` | `slop eval -f prog.js` | server-side scripts with every verb |
| `import.files {zone: assets}` | `slop import files ./imgs --store <id> --zone assets` | bulk image upload |
| `snap.new`, `ref.move` | `slop snap new <store>` | restore points |
| `policy.set`, `llm.set` | `slop policy set pinboard sample @member on` | agent access |

### 11.2 Page runtime used (existing)

`db.doc(path).get/set/update/delete/onSnapshot`, `db.collection(path).where/orderBy/limit/get/onSnapshot`, `acquire`; `user.me/id/profiles/search/can`; `room.presence/onPeers/emit/on`; `assets.upload/list`; `sample(input, {tools, modelTier, onText})`, `sample.limits()`; `slop.actions.<name>(args)`, `slop.visitor()`, `slop.signIn()`.

### 11.3 New (proposed)

| Name | Kind | Shape |
|---|---|---|
| `slop.stores({type})` | page runtime | `→ [{id, title, level, owner, updatedAt}]` |
| `slop.commands` | manifest field | path to `commands.json`: `{alias, commands: {"<words>": {action, doc, args: JSONSchema-properties}}}` |
| `app.commands {store}` | verb (read) | `→ {app, alias, commands}` |
| `slop app <store> <cmd…>`, `slop <alias> <store> <cmd…>` | CLI | dynamic commands; `slop app alias <alias> <app>` |
| `<alias>_<cmd>` | MCP tools | same schemas, with a `store` argument |
| actor `sample(input, {tools})` | actor module | tools `{name, description, inputSchema, execute(input)}`, ≤ 16 |
| `platform.links.new`, `platform.grants.rm` | actor module | as the verbs, on the actor's own store |

### 11.4 Pinboard core (proposed)

`createCore(storage)` → `{ mutate(fn, label), describe(opts), query(coll, q), undo(txid), revert(txid) }`; recorder operations as in the prototype (`js/store.js:93-169`): `place move resize retitle tag untag setAttr remove group ungroup pin open close setParam setState collection insert update removeRecord removeCollection promote demote register unregister`.

## 12. References

**Prototype** (`sources/pinboard-prototype/`):
- `js/store.js` — state, IndexedDB, recorder (`:93-170`), mutate (`:172-189`), undo/redo (`:190-202`), quiet changes (`:204-215`).
- `js/dsl.js` — grammar (`:63-193`), diagnostics proxy (`:129-146`), fragments (`:195-206`), IR (`:208-232`), queries and schema (`:234-296`).
- `js/render.js` — context and dependency tracking (`:12-36`), renderer (`:70-167`), drops (`:186-198`).
- `js/board.js` — clip fragments (`:10-24`), clip rendering (`:81-182`), copy/paste (`:329-361`), board API (`:560-607`), describe (`:608-631`), change handling (`:646-660`).
- `js/apps.js` — app builder (`:7-32`), registry and evaluation (`:34-87`), built-in apps (`:89-264`), reference (`:266-312`).
- `js/agent.js` — instructions (`:5-17`), running code (`:67-85`), the `eval` tool and `sample` call (`:113-158`), init (`:164-199`).
- `sources/pinboard-api-examples-code.txt` — the 14 examples of the design document; `sources/pinboard-api-examples-and-wireframes.md` — the sheet descriptions.

**slop**:
- `doc/claude-apis/README.md`, `state-storage.md`, `people-and-collaboration.md`, `sample-spec.md`.
- `doc/building-apps.md` (branch `task/slop3-015-catalog-views`, PR #35) — building, deploying and testing apps; caching; patterns from the catalog apps.
- `web/runtime/src/index.ts`, `db.ts`, `sample.ts` (`:70-90` page tools), `caps.ts` (assets, slop), `limits.ts`.
- `pkg/doors/pages/live.go:270-272, 443-460` — createApp mounts.
- `pkg/doors/pages/views.go` — view RPC table (where `slop.stores` would go).
- `pkg/doors/actors/sample.go:42-106` — actor sample (no tools).
- `pkg/commands/docs.go`, `pkg/commands/eval.go`, `cmd/slop/cmds/root.go:49-64`, `cmd/slop/cmds/extra.go:113-198`.
- `pkg/doors/mcp/mcp.go` — the MCP door.
- `apps/upstream/pinup/src/02-store.js`, `09-collab.js`, `14-log.js` — the closest prior art.
- `scripts/deploy-apps.sh` — how Pinup and Blocks are mounted with `createApp`.
- SLOP3-014 (PR #34) — what a page learns about its visitors; SLOP3-015 — the catalog apps, the local-server testing method.
