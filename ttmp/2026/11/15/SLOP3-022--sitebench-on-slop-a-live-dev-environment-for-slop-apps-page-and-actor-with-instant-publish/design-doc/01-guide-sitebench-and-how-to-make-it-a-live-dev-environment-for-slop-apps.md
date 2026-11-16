---
Title: 'Guide: Sitebench, and how to make it a live development environment for slop apps'
Ticket: SLOP3-022
Status: active
Topics:
    - tools
    - agents
    - apps
    - architecture
    - publishing
    - collaboration
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/doors/actors/modworkshop.go
      Note: The workshop module the bench builds on (push to draft, publish, follow, status)
    - Path: repo://pkg/doors/pages/sandbox.go
      Note: The sandbox origin, frameOrigins, /v/<n>/; where embeds would be served
    - Path: repo://pkg/doors/pages/views.go
      Note: Views and reloadApp (reload on ref moves); where embeds would be opened
    - Path: repo://pkg/host/workshop_module_test.go
      Note: The draft/follow/publish loop proven as a test
    - Path: repo://pkg/kernel/apps.go
      Note: Running and lazy activation
    - Path: repo://ttmp/2026/11/15/SLOP3-022--sitebench-on-slop-a-live-dev-environment-for-slop-apps-page-and-actor-with-instant-publish/scripts/01-stage0-sitebench-as-a-slop-app.sh
      Note: 'Stage 0 experiment: Sitebench dist as a slop app'
    - Path: repo://web/runtime/src/index.ts
      Note: 'window.claude.use: the artifact contract slop implements'
ExternalSources: []
Summary: What Sitebench is and how it works; how slop stores, apps, refs, views and actors work; and the design and plan for a bench where a slop app (page and actor) is a project with a live dev instance and a one-step publish.
LastUpdated: 2026-11-15T19:30:00-05:00
WhatFor: An intern who will build the bench, or review its design
WhenToUse: Before working on SLOP3-022 or on slop's development tooling
---

# Sitebench on slop: a live development environment for slop apps

This guide is for an engineer new to both systems. It explains Sitebench, a coding-agent IDE that ran as a Claude artifact. It then explains the parts of slop-computer that an app runs on. Finally it designs a version of Sitebench, called **the bench** in this document, that works on real slop apps.

A real slop app has a page in the browser and an actor on the server. In the bench, an app is a project. Every edit lands within a second in a private **dev instance** of the app, which has its own data. When the result looks right, one step publishes it to the app's users.

Read the guide in order. Parts 1 and 2 teach Sitebench. Part 3 teaches the slop machinery the design uses. Part 4 reports an experiment: Sitebench's own build already runs on slop. Parts 5 and 6 are the design, and Part 7 is the implementation plan. The appendices are reference tables.

> **Summary.**
> - Sitebench gives a person and an agent one shared loop. Edit a file, and every live frame of the site reloads in place, keeping its state. The agent hears what its edit did ("fixed 1 issue, layout changed on menu.html"). Changes can wait in a proposal for review.
> - Slop already has the version machinery a dev loop needs:
>   - pushing code to a `draft` ref;
>   - a separate store that runs the draft against its own data (`app.follow`);
>   - publishing by moving `main`;
>   - pages that reload when their ref moves.
> - Sitebench's build runs unchanged as a slop app (tested in Part 4), because slop's page runtime implements the same `window.claude` contract.
> - The work is to make a Sitebench **project** a slop **app**:
>   - its files become the app store's tree on the `draft` ref;
>   - its live frames become embedded views of a dev instance;
>   - its data becomes that instance's documents and SQL;
>   - accepting a proposal and publishing both move refs.
>
> Part 3 defines store, tree, snapshot, ref, instance and view.

**Sources.** Sitebench paths are relative to the archive root: `sources/sitebench-workspace/` in this ticket, which is git-ignored. `sources/MANIFEST.md` lists the files. Slop paths are relative to the repository root. The code cited is that of origin/main at `97c4458` (2026-11-15).

**Evidence.** Three reader diaries back this guide: `reference/02-…` (agent and sandbox), `03-…` (workbench UI) and `04-…` (slop surface). The main diary is `reference/01-diary.md`, and the experiment's screenshots are in `various/`.

---

## Part 1. What Sitebench is

### 1.1 The idea in one paragraph

Sitebench is a workbench for building small websites: HTML, CSS and JavaScript files plus a few data tables. It shows the site **live**, as real pages running in frames on a zoomable canvas, several sizes side by side. A person and Claude edit the same files. Claude has exactly one tool, `eval`, which runs JavaScript in a sandbox against an API for files, data and frames. Every change is recorded in an event log, so the workbench can show who changed which line, and why. It can play the site back at any earlier moment, and it can hold the agent's changes in a **proposal** that a person reviews before accepting. Everything runs in the browser, inside a Claude artifact, with no server of its own (`sitebench/README.md:1-3`).

### 1.2 One session, followed through

The archive's tests replay a session with the Corner Coffee template (`sitebench/test/run-app.mjs`; `src/02-templates.js:2-30`). Corner Coffee has four pages (`index.html`, `menu.html`, `cart.html`, `orders.html`), one stylesheet, one script, and two tables (`menu`, `orders`). On purpose, its category chips overflow a 375-pixel phone screen.

1. **The project opens.** The canvas shows four frames: three phones at 375×720 and the orders page at 960×600. Each frame is a real page. The header's health pill reads **1 issue**, because each frame ran its built-in checks (overflow, contrast, missing alt text and unlabelled buttons) and the menu page overflows.
2. **The person asks.** They type "fix the overflow" in the Agent panel and press Send.
3. **Claude acts.** Claude runs one `eval`:

   ```js
   await files.replace('styles.css', '.cats {', '.cats { flex-wrap: wrap;')
   ```

4. **The write lands in a proposal.** The thread's target is "proposal", so the write goes to a new proposal: an overlay of files on top of the main version. Only frames that show this proposal reload.
5. **The frames reload in place.** Each reloads double-buffered: a new hidden frame loads, the old one's scroll position and form inputs are copied into it, and then the two are swapped.
6. **Claude hears what happened.** The tool result includes the effects of the eval, which the UI summarises in one line (§2.4 shows the JSON the model actually receives):

   ```
   effects: styles.css +1 −1 · fixed 1 issue · layout changed on menu.html
   ```

7. **The person reviews.** The Review view shows a diff of `styles.css`. A **Checks** button runs layout comparisons and the scenarios in the proposal against main, and the person presses **Accept**.
8. **The history remembers.** Weeks later, the Code view's **Blame** gutter shows "Claude · 2m" beside the new line. Clicking it opens a card: the request ("fix the overflow"), Claude's reply, and the proposal the line came through.

That loop is what this project wants for slop apps:

- **Edit.** A person or the agent changes the code.
- **Live.** Within a second, every open view of the app shows the change, state intact.
- **Effects.** The editor learns what the change did: issues fixed or added, layout changes, errors.
- **Review.** Changes can wait in a proposal and be checked against the current version.
- **History.** Every line remembers who wrote it and why.

### 1.3 The screen

The default layout (`src/07-dock.js:8-12`, captured in `sitebench/test/s1.png` and in this ticket's `various/stage0-01-boot.png`):

```
┌ Sitebench │ Corner Coffee 7 files ▾ │ ● main ▾ │[Select|Play|Comment]│ … [1 issue][Idle Claude][saved][+ Mark][Layout][◐] ┐
├──────── 24% ───────┬────────────── 47% ─────────────────────┬──────────── 29% ─────────────────────┤
│ [Agent] [Eval]     │ [Canvas] [Timeline]                    │ [Code] [Review] [Docs]               │
│ thread tabs        │ +Frame  Zoom − 27% + Fit  Flows Check  │  file list │ editor with gutter,     │
│ chat and eval      │  ┌index┐→┌menu┐→┌cart┐   ┌orders 960┐ │            │ blame, history          │
│ steps              │  │ 375 │ │375 │ │375 │   │          │ ├──────────────────────────────────────┤
│ context chips      │  └─────┘ └────┘ └────┘   └──────────┘ │ [Inspector] [Layers] [Panels]        │
│ composer           ├────────────────────────────────────────┤  the selected element: source line,  │
│ Auto|Ask|Read-only │ [Console] [Data] [Scenarios]           │  box, matching CSS rules (editable)  │
│ Proposal|Main  Send│  logs from every frame                 │                                      │
└────────────────────┴────────────────────────────────────────┴──────────────────────────────────────┘
```

**The header (`src/11-app.js:187-216`).** From left to right:

- the project menu: list projects, create from a template, duplicate, rename, export as zip, import, delete;
- the workspace selector: `main`, or one of the open proposals;
- the mode switch: **Select** (click an element to inspect it; double-click text to edit it in place), **Play** (use the site), **Comment** (drop a pin that asks for a change);
- the health pill;
- the agent pill;
- the storage pill;
- **+ Mark**, which bookmarks this moment in the timeline.

**The dock (`src/07-dock.js`).** A tree of splits and tabbed tiles. Tabs can be dragged to split a tile or to float. Five named layouts exist (Build, Code, Review, Data, Canvas), and people can save their own.

---

## Part 2. How Sitebench works

Sitebench is one page. Its source is concatenated from `src/NN-*.js` into `dist/app.js` (`build.mjs`). A second build bundles the sandbox worker and the QuickJS engine into `dist/sandbox.js` (`build-worker.mjs`). Five subsystems matter for the port:

```
                 ┌────────────────────────── the Sitebench page ──────────────────────────────┐
 window.claude   │  Store ──── Project ──── FrameHost ×N ──postMessage──▶ iframe (srcdoc)      │
 use('db')  ◀────┤  (03)        (04)          (05)                       PROBE + the site's    │
 use('user')     │   │            ▲  ▲          ▲                         HTML/CSS/JS inlined   │
 use('sample')◀──┤   │            │  └─ views: Code, Data, Review, Timeline, Canvas (07–11)   │
                 │   │            │                                                           │
                 │   │      hostAPI(ctx) ◀── Sandbox ──postMessage──▶ Worker: QuickJS + core.js │
                 │   │        (06)            (06)                    (worker.js, core.js)      │
                 └───┴────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Storage: `Store` (`src/03-store.js`)

`Store` keeps everything as JSON documents in the artifact's database.

**Where it saves.**

- With an account: `window.claude.use('db')`, under the path `data/users/<user id>/…`, which only that person can read (`03-store.js:6-15`).
- Without one: `localStorage` (keys prefixed `sb1|`), or memory.

**How it saves.**

- Writes are queued and flushed 700 ms after the last change, by four parallel writers (`03-store.js:64-91`).
- Reads see queued writes before they are flushed: `shadow()` (`03-store.js:35`).

**Limits.** A document may not exceed about 256 KB (`03-store.js:94`). File paths are encoded into one key segment by `encKey`: `/` becomes `~`, and other characters become `+hhhh` (`03-store.js:109-114`).

### 2.2 The project model: `Project` (`src/04-project.js`)

A **project** is a site under construction: files, tables, proposals, conversation threads, and an append-only log of everything that happened. Its documents, under `data/users/<id>/`:

| Document | Holds |
|---|---|
| `index` | the list of projects, and the current one |
| `p_<pid>` | metadata: title, boards and frames on the canvas, pins, the page key-value store, panels, snapshot index, scenario results |
| `p_<pid>/files/<encKey(path)>` | `{path, text}`, one per file of `main` (each at most 240 KB, `04-project.js:27`) |
| `p_<pid>/tables/<name>` | `{name, cols, rows, seq}` |
| `p_<pid>/ov/<oid>` | a proposal (overlay): `{id, title, by, thread, status, files, base, tables, tbase}` |
| `p_<pid>/threads/<tid>` | a conversation with Claude: messages, eval steps, mode, target, model tier, summary |
| `p_<pid>/log/c0000…` | the event log in chunks of at most about 180 KB |
| `p_<pid>/snaps/<id>`, `p_<pid>/css/<hash>` | frozen pages with their layout maps; stylesheets stored once by hash |

**Workspaces.** Files are always read through a workspace, either `main` or a proposal id:

- `read(path, ws)` returns the proposal's copy if it has one, and otherwise main's (`04-project.js:14-18`).
- A write to a proposal records main's text at that moment in `ov.base[path]` (`:33`).
- `changes(oid)` compares base, main and proposal. It flags a **conflict** when main has changed since the proposal copied it (`:78-84`).
- `accept(oid, paths)` writes the chosen files into main and marks each event `via: oid`, so blame can follow lines through the proposal (`:85-105`).

**The event log** is the project's memory. Every write, accept, message, eval, mark and canvas change is an event `{i, t, kind, ws, who, path?, after?, note?, thread?, via?}` (`:212-223`). From the log alone, Sitebench computes:

| Function | What it computes |
|---|---|
| `stateAt(i)` | the files of main just after event *i*; this drives the timeline's **playhead** (`:230-246`) |
| `versions(path)`, `lineage`, `blame(path)` | for each line, the event that wrote it (`:249-271`, `:313-320`) |
| `why(i)` | for an event, the person's request in that thread, Claude's reply, the proposal, and the marks made in between (`:279-297`) |
| `restore(i)` | rewrites main back to `stateAt(i)`, as new events, so a restore can itself be undone (`:299-311`) |

### 2.3 Live frames: `buildDoc`, `PROBE` and `FrameHost` (`src/05-site.js`)

A frame shows one page of the project in a sandboxed `<iframe srcdoc>` with `sandbox="allow-scripts allow-forms"` (`05-site.js:29`). The frame has an opaque origin and no network, so it can talk to the workbench only through `postMessage`.

**Building the page.** `buildDoc(project, route, ws)` builds the page as one document (`05-site.js:30-59`):

1. It reads the route's HTML through the workspace.
2. It instruments it: `instrument()` adds `data-src="menu.html:25"` to every element in `<body>`, recording the element's source line (`:4-27`).
3. It inlines every `<link rel=stylesheet>` and `<script src>` from the project's files.
4. It injects the **probe**.

**The probe.** `PROBE` is a self-contained function, stringified into the page (`:63-471`). It has three jobs:

- **It gives the page a tiny backend.** `window.site` has three parts:
  - `db`: rows, insert, update and remove on the project's tables, as calls to the workbench;
  - `store`: a key-value store shared by all frames;
  - `nav`: navigation.
- **It reports.** Console output and errors, clicks in Play mode, the element a person picked in Select mode, pins and inline text edits.
- **It answers operations from the workbench:**
  - `check` (overflow, contrast, alt text, labels);
  - `layout` (a map of up to 2,500 visible elements with boxes, text and styles);
  - `state` and `restore` (scroll and inputs);
  - `snapshot`, `inspect` (computed styles and matching rules), `outline` and `trace` (outline the elements one source line renders);
  - `click`, `type`, `text`, `query`, `waitFor` and `count`;
  - `preview` (temporary CSS variables and rules).

**Hosting the frame.** `FrameHost` owns one frame (`05-site.js:480-592`). `load({keepState})` asks the old page for its `state`, builds a new iframe at opacity 0, and waits for its `ready` message. `swap()` then shows the new frame, removes the old one and posts `restore`. A missing `ready` forces the swap after 4 s. Calls into the frame are `call(op, args, timeout)`, matched to replies by id and routed by a per-load **nonce**.

**Off-screen frames.** `Headless` keeps off-screen frames for the agent, for workspaces nobody is looking at, and for scenario runs (`:609-627`).

**What triggers a reload** (`11-app.js:66-70`). A write to a file reloads every visible frame of the affected workspace after a 180 ms debounce. A table change does not reload anything: it is pushed into the pages, which re-query.

### 2.4 The agent: one tool, a sandbox, a host API (`src/06-agent.js`, `worker.js`, `core.js`)

**The model call.** Every model call is `window.claude.use('sample')`. An agent turn makes **one** call, handing over one tool object (`06-agent.js:733-769`):

```js
{ name: 'eval',
  description: 'Run a JavaScript async function body in the Sitebench sandbox ... Returns {ok, value, logs, error, effects}.',
  inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  execute: async ({ code }) => JSON.stringify(await runEval(ctx, code, hostAPI(ctx))).slice(0, 8000) }
```

The host runs the tool-use loop and calls `execute` once per tool call. A turn may make at most 30 evals (`:742`).

**The sandbox** is QuickJS compiled to wasm, running in a Web Worker (`worker.js`). The page and the worker exchange six message types:

| Message | Direction | Fields |
|---|---|---|
| `eval` | page → worker | `id, code, api[] (the verb names), timeoutMs, sid, restore, lib[], sigs, roles` |
| `call` | worker → page | `id, eid, name, args`: one host-API call from the model's code |
| `reply` | page → worker | `id, ok, value` or `error {kind, message}` |
| `result` | worker → page | `id, ok, value \| error {kind, message, line}, logs[], engine, ms, scope, fresh` |
| `engine` | worker → page | `quickjs` or `worker` (the fallback realm) |
| `drop` | page → worker | `sid`: forget a session |

**Sessions and timeouts.**

- Each thread has its own QuickJS context (`sid` = thread id), with 64 MiB of memory.
- Top-level `const`/`let`/`function` declarations persist between evals: acorn rewrites them into globals (`worker.js:136-166`). They are also saved as JSON with the thread, so they survive a reload (`:113-116`).
- An eval runs for at most 20 s. The page has a watchdog that restarts a stuck worker (`06-agent.js:52-65`).

**The host API** is 84 verbs in 14 groups, listed in Appendix A (`API_SIGS`, `06-agent.js:75-94`). The page implements every verb in `hostAPI(ctx)` (`:114-419`). The sandbox only forwards calls, so authority lives on the page side.

**Every eval is a transaction.**

- Before the first write to a file or table, the page records its previous state (`06-agent.js:131-144`). If the eval throws, every write is rolled back, and the rollback is logged as ordinary events.
- `tx.begin/commit/rollback` nests transactions inside an eval.
- `dry.begin/end/apply` captures file writes as a changeset without applying them.

**Effects.** After an eval that wrote something, `frameEffects` waits 260 ms, re-runs checks and layout on every frame of the board, and tells the model what changed (`06-agent.js:473-494`). The example below shows the shape; its values are illustrative:

```json
{ "files": [{"path":"styles.css","change":"edited","add":1,"del":1}],
  "fixedIssues": ["menu.html 375px|overflow|.cats"],
  "layout": [{"frame":"menu.html 375px","changes":["div.cats @menu.html:12: size 343×34 → 343×76","page height 757 → 791"]}],
  "errors": [] }
```

**Modes and proposals.**

- A thread has a **mode**: `auto`, `ask` (each eval waits for Run or Skip), `read`, or `tests` (writes only under `scenarios/` and `fixtures/`).
- It also has a **target**: a proposal or main. With the target "proposal", a turn writes into the thread's open proposal, or creates one (`06-agent.js:782-787`).
- `ui.approve(title)` shows an Approve/Decline card and waits for the answer.

**Subagents.** `agents.delegate(role, task)` runs a child thread with its own budget carved from the parent's (`:817-865`). The roles are explorer (read-only), reviewer (read-only, returns a verdict), qa (writes tests only) and builder (works in its own proposal). The depth is capped at 2.

**The term core.** `core.js` is a small combinator library modelled on the agentalg textbook (`tb/textbook.txt`). Every API verb returns a `Step`, and awaiting a Step runs it. Steps compose:

- `seq`, `par`, `alt`, `loop`, `dyn`;
- `` llm`…` ``, `delegate`;
- `.then/.map/.fold/.retry/.timeout/.fallback/.atomic/.dry/.explain`;
- schemas `s.*`.

`eval-agent-api-examples.md` designs much more: a compiler, traces, teams, shared lattices and modules. Only the algebra and a minimal `delegate` are built. The table at the end of `reference/02-diary-sitebench-agent-and-sandbox.md` separates what is built from what is only designed.

**Context.** Each turn's prompt is the API guide (`API_GUIDE`, `06-agent.js:513-620`), the conversation (compacted into a summary above 28,000 characters), and a "Current state" block. That block lists the files with line counts, the tables, the frames with their issues, the open proposals, the person's selection and pins, the saved lib functions and the persisted variables (`:640-652`).

### 2.5 Review and history

These features are described in full in `reference/03-diary-sitebench-workbench-ui.md`. The port keeps them, so an intern should know they exist:

| Feature | What it does | Where |
|---|---|---|
| **Review** | One card per open proposal: per-file checkboxes, diffs, conflict tags, **Checks** (layout diff per frame, all scenarios in the proposal and in main: "fixed by this proposal", "regression"), Accept and Reject | `10-agentviews.js:216-273` |
| **Timeline** | Lanes per actor (you, each agent thread, pages, marks), a story list, a playhead that reloads every frame as of an event | `10-agentviews.js:299-437`, `08-canvas.js:178-199` |
| **Blame and why** | A gutter of authors per line run; a card with request, reply and proposal | `09-views.js:57-84, 480-501` |
| **Snapshots** | Frozen pages plus layout maps; `layoutDiff` names what moved, resized, or changed colour or text | `05b-snapshots.js` |
| **Fixtures** | `fixtures/<name>.json`: tables, store and clock for a frame or a run, isolated from live data | `05c-scenarios.js:2-21` |
| **Scenarios** | `scenarios/<name>.json`: steps `go, click, type, waitFor, wait, expect, data, store, snapshot`, run headless on a fixture, or recorded by clicking through a frame | `05c-scenarios.js:57-174` |
| **Panels** | Controls (sliders, toggles, …) the agent declares with `ui.panel`; they preview CSS variables live, with **Keep** writing them into the stylesheet | `10d-panels.js` |
| **Archive** | A project as a `.sitebench.zip`: `files/`, `tables/`, `proposals/`, `threads/`, `transcripts/*.md`, `timeline.json` | `10b-archive.js:86-134` |

### 2.6 What ties Sitebench to the artifact host

| Dependency | Where | Why it matters for a port |
|---|---|---|
| `window.claude.use('db' \| 'user')` | `03-store.js:10-15` | Storage of projects, prefs, snapshots |
| `window.claude.use('sample')` with tools | `06-agent.js:635, 769` | The model and its tool loop |
| `use('downloads')` | `10b-archive.js:136-147` | Export; it already falls back to a download link |
| srcdoc pages built from project files | `05-site.js:30-59` | The site has no server and no origin of its own |
| `window.site.db/store` answered by the workbench | `05-site.js:78-90, 575-605` | The site's "backend" is the workbench's tables |

The first three are the Claude artifact contract. The last two are Sitebench's own design. They are what has to change for a site that is a real app with a real backend.

---

## Part 3. How slop runs an app

This part teaches the slop machinery the design uses, and nothing else. The longer inventory, with every verb and the places where the design document and the code disagree, is `reference/04-diary-slop-surface-for-a-dev-loop.md`. Where the two disagree, this guide follows the code.

### 3.1 Stores, trees, snapshots and refs

**A store** is one SQLite file (`stores/<id>/store.db`, `pkg/kernel/kernel.go:87,112`). It holds four kinds of data:

- **documents** (`_docs`): JSON at paths like `threads/th_1`;
- a **tree** of files (`_files`), whose bytes live in a shared content-addressed blob store;
- **SQL tables** created by an app's migrations;
- a **log** of every change (`_log`, `_changes`).

The kernel schema is in `pkg/store/store.go:20-49`.

**A snapshot** freezes the tree. `Turn.Snapshot(message, ref)` hashes the sorted list of `path<TAB>sha256` lines, stores the list, and moves a **ref** to the new snapshot number (`pkg/store/files.go:180-228`). A ref is a name pointing at a snapshot number. Two refs matter here:

- **`main`**: the published version. Everything that serves the app serves `main` unless told otherwise.
- **`draft`**: the conventional name for unpublished work. The Workshop's `push` defaults to it (`pkg/doors/actors/modworkshop.go:12`), and so does `preview.url` (`pkg/commands/preview.go`).

**Snapshot rules worth knowing:**

- Snapshotting a tree identical to the one a ref already points at writes nothing and returns the existing snapshot (`files.go:203-206`).
- Moving a ref records a change of kind `ref`, and that change is what makes open pages reload (§3.5).
- **There is one working tree per store, shared by all refs.** A push to `draft` replaces the working tree, then snapshots it onto `draft`. Serving never reads the working tree; it reads snapshots. But a later `snap.new` *without* `--ref` would snapshot that draft tree onto `main`. Tools must always name the ref.

### 3.2 Apps, app stores and instances

**What makes an app.** A store becomes an **app** when the snapshot it runs contains `app.json`. The manifest names the page, the actor and the capabilities (`pkg/apps/manifest.go:20-48`, `pkg/rt/manifest.go:39-161`). A small app with a backend looks like this:

```
corner/                      ← the app store's tree (snapshot on main)
  app.json                   {"title":"Corner Coffee","type":"corner","page":"index.html","actor":"actor.js",
                              "capabilities":{"db":{"rules":[...]},"user":{"scopes":["profile"]}}}
  index.html  menu.html  cart.html  orders.html  styles.css  app.js
  actor.js                   defineActor({ actions: { menu: {...}, order: {...}, orders: {...} } })
  sql/001_menu.sql           CREATE TABLE menu (...); CREATE TABLE orders (...);
```

**Code and data are separated by one meta key.** Each store has `_meta.app`, the store whose code it runs. When `_meta.app` is empty, the store runs its own tree. Each store also has `_meta.app_ref`, the ref of that app it follows, `main` by default. `kernel.Running(store)` resolves both to a snapshot number `n` (`pkg/kernel/apps.go:57-108`).

This gives two kinds of store:

- **The app store** holds the code. It may also hold data, if it runs itself.
- **Instances** are stores made with `store.new {id, app: "corner"}`. "Instance" is this guide's word; the code speaks of a store whose `_meta.app` names another store. Each runs the app's code against its **own** documents and SQL (`pkg/commands/stores.go:48-63`).

Pinboard and the reports work this way: one app store, one instance per board or report. `store.ls` returns `{id, type, app, owner, createdAt, level}` for every store you can see (`stores.go:24-47`). The `app` field is how a tool finds an app's instances.

**`app.follow {store, ref}`** sets an instance's `app_ref` and activates it at that ref (`pkg/commands/actors.go:132-163`). An instance that follows `draft` runs unpublished code against its own data, while every other instance keeps running `main`.

### 3.3 Push and activation

**A push.** `files.push {store, files, ref?, message?, prune?, blobs?}` replaces the tree and snapshots it onto `ref` (default `main`) (`pkg/commands/files.go:139-145, 300-396`).

- A file entry is either `{path, sha256, size}` or inline `{path, text}`.
- If the server lacks a blob, the call fails with `missing_blobs` and the list of missing hashes. The client uploads them with `files.blobs` and retries (`pkg/client/folder.go:64-120`).
- `slop push <dir> --store <id> --ref <ref>` does all of this from a folder.

**Pushing code needs a platform admin.** On a store whose tree holds `app.json`, writing the tree or a ref is allowed only to platform admins (`guardCode`, `files.go:430-453`; `pkg/authz/code.go:15-17`).

**Activation** is what turns a snapshot into a running version. It is lazy: it happens the first time something needs the store to run, such as opening a view, resolving a mount, `app.follow`, `actor.call`, or an event. When `Running` finds that the snapshot `n` of the followed ref differs from the store's `app_version`, it activates in one turn (`pkg/kernel/apps.go:181-209`; `pkg/actor/manager.go:415-464`):

1. It applies the new `sql/*.sql` files in name order and records each name and hash. **An edited migration that was already applied fails** with "add a new migration instead" (`manager.go:435-449`).
2. It builds the actor and runs its `setup` and `smoke` functions.
3. It reconciles recurring alarms and reactor cursors.
4. It sets `app_version = n` and stops the old actor; the next event builds the new one.

**When activation fails.** The store **keeps serving its previous version**. The failure shows in `app.status {store}` as `broken`, with the reason (`pkg/commands/mounts.go:101-129`). `app.logs {store}` returns the last 500 console and `ctx.log` lines. `app.restart` retries.

### 3.4 Serving: mounts, the shell, views, the sandbox origin

**Hosts.** A server has a main host (back office, sign-in, API), live hosts (apps in a shell), static hosts and a wildcard **sandbox** host (`doc/production.md:24-53`).

**Mounts.** A **mount** maps a path on a live host to a store: `mount.set {host, path, store}`. A pattern mount can serve many stores, for example `/r/:id` with `storeParam`. Mounts are admin-only, and **a mount names a store, never a ref** (`mounts.go:36-66`). To serve a draft, you serve an instance that follows `draft`.

**Opening a page.** When a person opens a mounted path:

1. The live host answers with the **shell**: a small page with a header and one `<iframe id="app">` (`pkg/doors/pages/live.go:670-703`).
2. The shell POSTs `/_site/views {path}`. The server resolves the mount, checks the person's level, runs `Running` (which activates if needed) and creates a **view** (`views.go:147-191`). A view is the server's record of one open page: an id, the store it shows, the version `n` it runs, and a secret the page uses to call the server.
3. The view's frame source is `https://s<label>.<sandbox host>/v/<n>/…`. The label is an HMAC of the store and the app, so each store gets its own origin (`views.go:76-87`). The sandbox serves any snapshot `n` of the app store at `/v/<n>/`, and injects a boot script and the runtime `/_slop/claude.js` (`pkg/doors/pages/sandbox.go:73-209`).
4. The sandbox page's only Content-Security-Policy is `frame-ancestors` (the main and live hosts) (`sandbox.go:62-68, 114`). So the page may start Workers, compile wasm and create its own frames.

**The shell handshake.** The page's runtime posts `{slop:1, type:"hello"}` to the shell. The shell answers with the view id and a per-view **secret** (`assets/shell.js:206-257`). The page then calls:

- `POST /_rt/rpc {method, args}`;
- `GET /_rt/events`, a stream, with `Authorization: Bearer <secret>` (`web/runtime/src/transport.ts:41-200`).

The shell also handles `download`, `confirm` (a person approves a change an app asks for), `consent`, `reload`, `reopen`, `hash` and `signin`.

### 3.5 The page runtime is the Claude artifact contract

Slop's page runtime defines `window.claude = { use(name) }`, the same contract Claude artifacts use (`web/runtime/src/index.ts:15-71`). `use` returns `null` for a capability the manifest does not declare.

| `use(…)` | What a page gets | Notes for this project |
|---|---|---|
| `db` | Firestore-like documents with `onSnapshot` listeners and rules, `data/users/<id>/` private per person | The same surface Sitebench's `Store` already uses |
| `user` | `me()`, `isOwner`, `canEdit`, profiles | Gives the bench the person's id |
| `sample` | the model, with page-side `tools` (`{name, description, inputSchema, execute}`, at most 16), tiers, `onText` streaming | `web/runtime/src/sample.ts:11-22, 70-87, 162`; slop's model backend, metered against the person's monthly budget |
| `slop` | `actions.<name>(args)` (the app's own actor), `stores.open`, `stores.list({type})`, `visitor()` | How a page calls its actor (`caps.ts:281-319`) |
| `room`, `assets`, `downloads`, `files`, `artifact`, `permissions` | presence and messages, uploads, file saves, read a store's tree, publish HTML | `files` lists and reads a tree; `artifact.publish` is admin-only |

**There is no page SQL.** Pages read documents. SQL is reached through actor actions.

**Live updates.** A commit fans its document changes out to every view that reaches the store (`views.go:493-519`). When a commit moves a ref, `reloadApp` finds the open views whose app is that store and activates their instance. If the version changed, it sends each one a `reload {version}` event (`views.go:521-539`). The runtime passes it to the shell as `{type:"reload"}`. The shell reopens the view, which means a new frame on the new version (`transport.ts:274-279`, `shell.js:243`). If no shell answers within 5 s, the page reloads itself.

### 3.6 Actors

An app's actor is one JavaScript file run by the go-go-goja engine on the server, one actor per store (`pkg/actor`). Here is the shape:

```js
defineActor({
  actions: {                                  // callable from pages, the CLI and MCP
    order: { requires: 'interact', run(ctx, { name, items }) {
      const sql = use('sql')
      sql.run('INSERT INTO orders (name, items, at) VALUES (?, ?, ?)', [name, JSON.stringify(items), ctx.now])
      return { ok: true } } },
  },
  on: { 'doc:orders/*': (ctx, ev) => {} },    // reactors: documents, files, tables, refs
  every: { tidy: { every: '1h', run(ctx) {} } },
  setup(ctx) {}, smoke(ctx) {},               // run at activation
})
```

**Modules.** Actors reach the store through `use(…)`: `sql`, `db`, `files`, `alarm`, `storage`, `time`, `log`, `stores.open`, and, when declared and allowed, `fetch`, `secrets`, `room`, `sample` and `platform` (`pkg/actor/modules.go:27-60`).

**Trusted modules.** `system` and `workshop` are available only to apps an admin trusted with `app.trust` (`pkg/commands/actors.go:80-116`). Their functions call verbs **as the visiting person** (`pkg/doors/actors/modules.go:126-166`).

**Limits.** A turn may run for 5 s (`pkg/actor/actor.go:31-35`). A page calls an action with `claude.use('slop').actions.order({...})`. The CLI calls it with `slop call <store> order '{...}'`.

### 3.7 The Workshop: draft, follow and publish already exist

SLOP3-002 built the **Workshop** (`apps/workshop/`): a review app trusted with the `workshop` module. That module is the closest existing piece to this project (`pkg/doors/actors/modworkshop.go:3-19`):

| `use('workshop').…` | Verb | Note |
|---|---|---|
| `push(store, files)` | `files.push` | `ref: "draft"` by default: "mounts serve main, and only publish moves it" |
| `publish(store, n)` | `ref.move` with `ref: "main"` | |
| `follow(store, ref)` | `app.follow` | |
| `status`, `files`, `read`, `snapshots`, `refs`, `log`, `preview`, `stores`, `moveRef` | `app.status`, `files.ls`, `files.cat`, `snap.ls`, `ref.ls`, `log.show`, `preview.url`, `store.ls`, `ref.move` | |

A test proves the whole dev-copy loop on the server side (`pkg/host/workshop_module_test.go:84-129`):

```go
h.call(admin, "files.push", {"store": "jot", "files": app})                         // main: sql/001
h.call(admin, "store.new", {"id": "jot-scratch", "app": "jot", "type": "jot"})      // an instance
app["sql/002_tags.sql"] = `CREATE TABLE tags (note TEXT, tag TEXT);`
h.call(admin, "files.push", {"store": "jot", "files": app, "ref": "draft"})         // draft: sql/002
call("follow", {"store": "jot-scratch", "ref": "draft"})                            // the instance runs draft
tables("jot-scratch") == ["notes","tags"];  tables("jot") == ["notes"]              // main is untouched
```

### 3.8 Doors for agents

**Through the API.** An external agent with a token can call any verb it may use:

- `POST /api/v1/<verb>` (`pkg/doors/api/api.go`);
- MCP on the main host, which turns every verb into a tool named `<group>_<verb>` (`pkg/doors/mcp/mcp.go`).

**The `eval` verb.** It runs a JavaScript program server-side with every verb as `slop.<group>.<verb>(args)`, as the caller (`pkg/commands/eval.go:23-112`).

**Watching for changes.** `log.wait {store, after, timeout}` long-polls until the store commits. On an app store that means a file, snapshot or ref change (`stores.go:168-200`).

---

## Part 4. Stage 0: Sitebench's build already runs on slop

**The question.** Since slop's runtime is the artifact contract, does Sitebench run on slop as it is? I tested it on a local server built from origin/main. The full record is diary step 3; the screenshots are in `various/`, and the script is `scripts/01-stage0-sitebench-as-a-slop-app.sh`.

**The setup.** `sitebench/dist/` (`index.html`, `app.js`, `sandbox.js`) plus one file:

```json
{ "title": "Sitebench", "type": "bench", "page": "index.html",
  "capabilities": { "db": {}, "user": {}, "sample": {}, "downloads": true } }
```

**The commands.** `policy set` is needed because the policy matrix gates `sample` per app and audience.

```sh
slop store new --id bench --type bench
slop push bench --store bench
slop policy set bench sample @admin on
slop mount set --host apps.localhost:18490 --path /bench --store bench
```

**Results:**

| Check | Result |
|---|---|
| Boot | The shell frames Sitebench on its sandbox origin. The header shows "Corner Coffee 7 files", "1 issue", "Idle Claude", "saved · Account" (`Store.mode === 'db'`). |
| Sandbox | "Sandbox: QuickJS (wasm) in a worker". The eval `files.replace('styles.css', '.cats {', '.cats { flex-wrap: wrap;')` returned `ok 26 ms · quickjs · main` with effects "styles.css +1 −1 · fixed 1 issue · layout changed on menu.html". The pill went to "0 issues", and `files0` persisted in the scope. |
| Agent | With `--llm fake`, a turn ran "✓ eval 1 · return 1; · 17 ms", then the canned reply. Slop's `sample` drove Sitebench's page-side tool loop. |
| Storage | The project is in store `bench` as documents `data/users/<usr>/p_<pid>/{files,tables,log,threads,snaps}/…`. |

**What this proves.** The workbench needs no new runtime. Sitebench's page, worker, wasm sandbox, srcdoc frames, storage and agent loop all work inside slop's shell. The fake backend tested the tool-calling contract, not model quality.

**What it does not do.** It edits a Sitebench project kept in documents: a site with `window.site.db` tables, not a slop app. Nothing it builds has an actor, a migration, an instance or a publish step. The rest of this guide is about closing that distance.

---

## Part 5. The design: a bench for slop apps

### 5.1 What we want

**Goals:**

1. **A project is a slop app**, with a page and an actor. Opening an existing app, or creating a new one, gives a project.
2. **Every edit is live within about a second**, in a **dev instance** of the app with its own data. Every open frame reloads in place, keeping its state. This holds whether the edit came from the bench's editor, from the agent, or from `slop push` in a terminal.
3. **The editor hears what the edit did:**
   - the page's checks and layout, as in Sitebench;
   - the actor's activation result, its errors and its log lines;
   - a failed migration.
4. **Publish is one step.** It moves `main` to the version under test, shows each instance coming up on it, and can be undone by moving `main` back.
5. **Keep Sitebench's strengths:** proposals and review, the agent with one `eval` tool, the history with blame and why, scenarios and fixtures, panels.

**Non-goals for the first version:**

- several people editing one project at the same time;
- a hot module swap of JavaScript inside a running page (a frame reload with state restore is enough);
- a server-side agent (the page-side loop works, Part 4).

### 5.2 Three versions of an app

The design rests on keeping three things apart: **draft**, **dev instance** and **main**. Each has a slop object behind it.

```
                    app store "corner"  (code; its own data too if it runs itself)
                    ┌──────────────────────────────────────────────────────────┐
  bench / CLI ──────▶ working tree ── snapshot ──▶ ref draft = 41               │
   files.push       │                              ref main  = 37  ◀── publish: ref.move main 41
   {ref:"draft"}    │                              ref proposal/ov7 = 40        │
                    └───────┬─────────────────────────────┬────────────────────┘
                            │ follows draft               │ follows main
                ┌───────────▼───────────┐     ┌───────────▼──────────────────────────┐
                │ corner-dev-d4776d     │     │ corner (itself), corner-shop-1, …     │
                │ dev instance:         │     │ production instances: real users,     │
                │ fixture data, private │     │ real data, mounted at /corner, /c/:id │
                └───────────┬───────────┘     └──────────────────────────────────────┘
                            │ embedded views (5.5)
                ┌───────────▼───────────┐
                │ the bench's canvas    │
                └───────────────────────┘
```

- **Draft** is a ref on the app store. Its snapshot is the code being worked on. The bench pushes every edit there. Each push makes a snapshot, so every saved state of the code has a number.
- **The dev instance** is an ordinary store with `_meta.app = corner` and `app_ref = draft`. It belongs to the developer, so nobody else can open it. Its data comes from a fixture, not from production.
- **Main** is what every production instance follows. Publishing moves it to draft's snapshot. Production instances reload on their next view or event.

The snapshot numbers (37, 40, 41) are illustrative, and the rest of Part 5 continues from them: the next edit makes snapshot 42.

This is exactly the arrangement `workshop_module_test.go:84-129` already exercises. What is new is the speed of the loop, embedding real views in the canvas, and the bench around it.

### 5.3 Projects are apps: mapping stores to projects

In Sitebench, a project was a set of documents in the artifact's database. In the bench, **a project is an app store**, identified by its store id. Everything Sitebench kept about a project maps onto something slop already has, or onto the bench's own documents:

| Sitebench | The bench on slop | Slop mechanism |
|---|---|---|
| project id | the app store id (`corner`) | `store.ls` row with `app == ""` whose tree holds `app.json` |
| project list (`index`) | the app stores the person may administer, each with its instances | `store.ls` (or `stores({all:true})` for admins), grouped by the `app` field |
| `files` of main | the app store's tree at `draft` (or at `main` before the first edit) | `files.ls {store, at:"draft"}`, `files.cat` |
| a file write | a push of the whole tree to `draft` (changed files inline, the rest by hash) | `files.push {store, ref:"draft", files}` |
| proposals (overlays) | a ref `proposal/<oid>` per proposal, plus the overlay document for review | `files.push {ref:"proposal/ov7"}`; `ref.ls` |
| accept a proposal | push the merged tree to `draft` | `files.push {ref:"draft"}` |
| the site's tables (`site.db`) | the dev instance's own documents and SQL tables | the page's `claude.use('db')`; actor `use('sql')`; `docs.*`, `sql.query` |
| `meta.store` (key-value shared by pages) | documents in the instance | `db` |
| fixtures (`fixtures/*.json`) | files in the app's tree, used to seed instances | `import.docs`, `import.table` (or a seeding action) |
| frames (srcdoc) | embedded views of an instance (5.5) | proposed `workshop.embed` |
| event log, threads, marks, pins, panels, snapshots, boards | the bench's own documents, keyed by the app store id | the bench store's `data/users/<id>/p_<app>/…` (today's layout, with `pid = app id`) |
| "publish" (none in Sitebench) | move `main` to draft's snapshot | `ref.move {store, ref:"main", n}` |

**Opening a project.** Opening an app such as `corner` runs this sequence. It is pseudocode for the bench's actor action `open`, which calls the `workshop` module as the visiting person:

```js
open(ctx, { app }) {
  const w = use('workshop')
  const refs = w.refs(app)                                 // ref.ls
  if (!refs.draft) w.moveRef(app, 'draft', refs.main)      // draft starts as main
  const files = w.files(app, 'draft')                      // [{path, sha256, size}]
  const inst  = w.stores({}).filter(s => s.app === app)    // production and dev instances
  const devId = app + '-dev-' + ctx.visitor.id.slice(4, 10)
  if (!inst.some(s => s.id === devId)) {
    w.newInstance(app, devId, { ref: 'draft' })            // proposed: store.new {app} + app.follow draft
    w.seed(devId, 'fixtures/default.json')                 // proposed; see 5.6
  }
  return { files, refs: w.refs(app), instances: inst, dev: devId, status: w.status(devId) }
}
```

The page then reads the file texts it needs (`files.cat`), builds its in-memory `Project`, and loads the bench's own documents for this project (threads, event log, boards). This takes the place of Sitebench's `Projects.open` (`04-project.js:394-411`).

**Creating a project.** "New project" with a template or an imported zip works like this:

1. Choose an id, which must match `^[a-z0-9][a-z0-9-]{0,62}$` (`pkg/registry/stores.go:12`).
2. `store.new {id, type}` creates the app store.
3. Push the template's tree to `draft`. Templates are folders such as `apps/bench/templates/<name>/`, with `app.json`, pages, `actor.js`, `sql/001_*.sql` and `fixtures/default.json`.
4. Create the dev instance and seed it, as in `open`.

`main` does not exist until the first publish, so nothing is visible to anyone else until then.

**Opening a store that is not an app.** There are three cases:

- **An instance** (`_meta.app` set): the bench opens its app, and lists this store among the instances.
- **A store without `app.json`**, for example a plain data store: the bench offers "Make this an app", which pushes an `app.json` and an `index.html` to `draft`.
- **A static app** without an actor, such as a report: it is still an app. The bench works the same way, with nothing for the actor parts to show.

**Exporting.** The bench keeps Sitebench's `.sitebench.zip` layout (`10b-archive.js:86-102`), with `files/` taken from `draft`. `slop pull <store> <dir> --at draft` gives the same tree for use outside the bench.

### 5.4 The live loop

This is the path of one keystroke, with the time each step is allowed. The budgets are targets for the implementation, not measurements.

```
 person / agent      bench page                    bench actor          slop server                  dev view frame
 ──────────────      ──────────                    ───────────          ───────────                  ──────────────
 edit styles.css ──▶ Project.write (memory, log)
                     debounce 300 ms
                     [css fast path: push the new
                      stylesheet into frames via the
                      probe's preview op ─────────────────────────────────────────────────────────▶ repaint (≈50 ms)]
                     sync() ──────────────────────▶ action sync
                                                    workshop.push ───────▶ files.push draft
                                                                           snapshot n=42, ref move
                                                                           reloadApp: Running(dev)
                                                                             migrations, setup, smoke
                                                                           ◀── {n:42, activated:[…]} (proposed)
                     ◀───────────────────────────── {n, activation}
                                                                           reload {version:42} ─────────▶ runtime posts
                     ◀─────────────────────────────────────────────────────────────────────────────── {type:"reload"}
                     FrameHost.load({keepState}):
                       state ← old frame; embed new view (n=42) hidden; restore; swap        ◀──── ready
                     frameEffects: checks, layout diff, + actor status and new log lines
 sees effects ◀───── "styles.css +1 −1 · fixed 1 issue · layout changed on menu.html · actor ok"
```

**Timing budget.**

| Step | Target |
|---|---|
| Debounce | 300 ms |
| Push and snapshot (small tree, mostly hashes) | 50–150 ms |
| Activation with no new migration (actor rebuilt lazily) | 10–100 ms |
| Frame reload | about 200–400 ms |

That puts an edit on screen in about one second. Stylesheet edits can skip the round trip: the probe already supports a `preview` push of CSS (`05-site.js:230-237`). The bench sends the whole new stylesheet to the frames at once, and the push follows in the background.

**Where the reload comes from.** The dev view's runtime receives `reload` from the server whenever draft moves. `reloadApp` also checks the production views of the same app, but for them `Running` still returns main's unchanged `n`, so they do not reload. The cause does not matter: the bench's own sync, the agent, or a `slop push --ref draft` from a terminal. So edits made outside the bench also show up live. The bench, not the shell, owns these frames (5.5). It turns `reload` into Sitebench's double-buffered `FrameHost.load({keepState:true})` instead of a plain reload.

**When activation fails.** A failed migration or a `setup` that throws leaves the dev instance on its previous version (§3.3). The bench shows this in four places:

- the **health pill**, which counts actor failures next to page issues;
- the **effects** the agent receives: `actor: {broken: "sql/002_tags.sql: near \"TABL\": syntax error", n: 41}`;
- the **Console**, which merges `app.logs` lines with page logs;
- the frames, which keep showing version 41 with a banner "draft 42 failed to activate".

**Activation result from a push (gap 2).** Today `files.push` does not report activation. The bench can call `follow` or `status` on the dev instance after a push, because `Running` activates. The cleaner fix is a field on the push result (Appendix C, C.2).

**Edits from outside the bench.** `log.wait {store: app, after}` wakes when the app store commits. The bench page polls it through its actor, or a `log.watch` stream verb could deliver the commits as they happen (Appendix C). On a commit whose author is not the bench, it reloads its files from `draft` and logs an event `who: "push"`.

### 5.5 Frames: embedded views of an instance

**The problem.** A Sitebench frame is an `<iframe srcdoc>` the workbench builds from text. A slop app page cannot be built that way, for three reasons:

1. It needs its runtime.
2. It needs a view with a secret.
3. It needs its sandbox origin, for `localStorage`, for `/_rt/rpc` and for the event stream.

The canvas must therefore frame the **real view**. Three things stand in the way today:

- The sandbox origin allows framing only by the main and live hosts (`sandbox.go:62-68, 114`). The bench runs on its own sandbox origin, so it cannot frame another app's view.
- Views are opened by the shell through `/_site/views` on the live host, with the person's session cookie (`live.go:256-315`). The bench page has no cookie on that host.
- A view's runtime says `hello` to its parent and expects a shell to answer.

**The proposal.** Add *embedded views*, opened by a trusted tool app for itself (Appendix C, C.1):

```
workshop.embed(store, { dev: true }) → { src, view, secret, version, expires }
```

1. **The bench's actor** calls `workshop.embed('corner-dev-d4776d', {dev:true})` as the visiting person.
2. **The server** does what `/_site/views` does: checks the person's level on the store, runs `Running` and creates a view. It records the **calling app's sandbox origin** as the view's parent. The parent is not a parameter: the server knows which app's actor is calling.
3. **The `src`** carries a token naming the embed, for example `https://s<label>.<sandbox>/e/<token>/v/<n>/menu.html`. When the sandbox serves it, it adds the parent origin to `frame-ancestors`. With `dev: true` it also injects `/_slop/probe.js` and instruments HTML responses with `data-src="file:line"`, a Go port of `instrument()` (`05-site.js:4-27`).
4. **The bench page acts as the shell for its frames.** The sandbox's boot script tells the page its `parentOrigin`, which for an embed is the bench's origin, so the page's runtime sends its `hello` to the bench. The bench answers the runtime's `hello` with `{type:"view", view, secret}` and handles `reload`, `reopen` and `renew` (renew through `workshop.embed` again). It forwards `download` and `confirm` to its own shell, so a confirmation inside a dev frame still reaches the person.
5. **The probe.** `/_slop/probe.js` is Sitebench's `PROBE` without `window.site`. Real apps use `window.claude`. It keeps the operations:
   - `check`, `layout`, `state` and `restore`, `snapshot`, `inspect`, `outline`, `trace`, pins and `preview`;
   - `click`, `type`, `text`, `query`, `waitFor` and `count`;
   - recording.

   It talks to the bench with `postMessage`, using the bench's exact origin instead of `'*'`, and checks `event.origin`.

**One entry page per app.** The sandbox injects the runtime only into an app's entry page (`app.json`'s `page`). Other `.html` files in the tree are served as plain files, without `window.claude` (`sandbox.go`). So a slop app is a single page. The bench's frames show that page at different deep links (`#/menu`, `#/cart`), not separate HTML routes as Sitebench's Corner Coffee had. Templates for the bench should be single-page apps.

**Security notes:**

- Only apps trusted with `workshop` may embed. An admin decides that with `app.trust`.
- Embeds are opened as the visiting person, so they never grant more than the person already has.
- The probe and the instrumentation are injected only into `dev` embeds, never into production views.

**The interim without server changes.** An admin mounts `/dev/:store` once (a `storeParam` mount). The bench then shows dev frames as new browser tabs, or uses `preview.url` for static pages, which has no runtime. This is enough to prove the sync loop of 5.4 before the embed work lands.

### 5.6 Data: dev instances, fixtures, resets and scenarios

**Instances are cheap.** An instance is one SQLite file: `store.new {app}` creates it, and `store.rm` deletes it. The bench uses that freely.

| Instance | Id (example) | Follows | Data | Lifetime |
|---|---|---|---|---|
| dev | `corner-dev-d4776d` | `draft` | seeded from `fixtures/default.json`, then whatever the person does in it | kept; "Reset data" recreates it |
| fixture frame | `corner-fx-3a9c1e2b` (hash of fixture and app) | `draft` | seeded from one fixture | kept while a frame uses it |
| scenario run | `corner-run-<run id>` | `draft` or `proposal/<oid>` | seeded from the scenario's fixture | deleted after the run |
| proposal | `corner-p-ov7` | `proposal/ov7` | seeded like dev | deleted on accept or reject |

**The fixture format** extends Sitebench's (`05c-scenarios.js:2-3`) to slop's two kinds of data:

```json
{ "description": "two drinks on the menu, one order",
  "docs":  { "settings/shop": { "open": "07:00", "close": "18:00" } },
  "sql":   { "menu":   [ { "id": 1, "name": "Flat white", "price": 4.2 }, { "id": 2, "name": "Chai", "price": 4.5 } ],
             "orders": [ { "id": 1, "name": "Ana", "items": "[1]", "status": "new" } ] },
  "clock": "2026-05-01T09:30" }
```

**Seeding.** Seeding runs `import.docs` for `docs`, and `import.table` for each SQL table (`pkg/commands/data.go:133-176`). It must run *after* activation, because the tables come from the migrations. `clock` keeps Sitebench's meaning, a fixed time inside the page, which the probe applies (`05-site.js:66-69`). Actors use `ctx.now`. A per-instance clock offset for actors is a later addition (Appendix C, C.6).

**Edited migrations.** Editing a migration that the dev instance already applied fails activation (§3.3). In development that is normal. The bench detects the error and offers **Reset dev data**: `store.rm` on the instance, then `store.new`, then follow `draft`, then seed. Production is protected by the publish check in 5.8, which refuses to publish a changed applied migration.

**Production data in dev.** `store.export` followed by `import.folder` can copy a production instance into a dev instance (`data.go:53-131`). That copies real people's data into a developer's store. The bench must show this as an explicit admin action with a warning, never as a default.

**Scenarios** keep Sitebench's format: `go, click, type, waitFor, wait, expect, snapshot` (`05c-scenarios.js:7`). Their data checks now query the instance:

- `{"docs": "orders", "where": {...}, "count": 1}` on documents;
- `{"sql": "SELECT count(*) AS n FROM orders WHERE name = 'Ana'", "expect": {"n": 1}}`;
- `{"call": "orders", "expect": {...}}`, which runs an actor action and checks its result.

**A scenario run:**

1. Create a run instance from the scenario's fixture.
2. Open an embedded dev view of it in a headless frame.
3. Run the steps.
4. Collect the page logs and the actor logs (`app.logs`).
5. Snapshot on failure.
6. Delete the instance.

### 5.7 Proposals

Proposals keep their Sitebench role: the agent's changes wait in one for review, unless the thread targets the draft directly. On slop, a proposal is three things:

1. **The overlay document**, in the bench store as today. It holds `{files, base}`, which drive the review diff and conflict detection.
2. **A ref** `proposal/<oid>` on the app store, pushed on every write in the proposal: the draft tree with the overlay's files applied.
3. **An instance** `<app>-p-<oid>` following that ref, created when someone looks at the proposal's frames or runs its checks. That gives the proposal live frames with a backend.

**Review checks** run the scenarios twice: on a fresh instance following `proposal/<oid>`, and on one following `draft`. The labels stay the same: "fixed by this proposal" and "regression: passes in draft". Layout checks compare the two in headless embedded frames.

**Accept** applies the picked files to the draft tree and pushes it to `draft`. The proposal's ref and instance are then deleted, unless files remain open. **Reject** marks the overlay rejected and deletes the ref and the instance.

### 5.8 Publish

Publishing is `ref.move {store: app, ref: "main", n: <draft's n>}`. Everything around it exists to make that one move safe.

**Preflight.** The bench checks four things and shows a card the person must approve:

1. **The dev instance activated** draft's `n` and is not broken (`app.status`).
2. **No applied migration changed or disappeared.** The bench compares the `sql/` files at `main` and at `draft` by name and sha256. A changed or deleted file would fail activation on every production instance. That failure is safe, because instances keep their old version, but it is useless.
3. **Scenarios pass** on draft, or the person overrides.
4. **The change summary:** files changed since `main` (`files.ls` at both, compared by sha), new migrations, and how many production instances will move. Those are the stores with `app == app` that follow `main`, plus the app store itself if it runs itself.

**The move.** `ref.move` with a compare-and-swap: "move `main` to 42 only if it is still 37". Today `ref.move` has no such condition (Appendix C, C.3). Without it, two publishers can race. The Workshop's `publish` has the same gap.

**After the move:**

- Production views reload on their own (§3.5).
- Instances that nobody is viewing activate on their next event or view.
- The bench lists each production instance with `app.status`: "on 42", "broken: …", or "not yet activated". It offers **Activate now**, which runs `app.follow` with the same ref and so activates.

**Rollback** is `ref.move main 37`. Instances follow back. A migration that already ran in an instance is not undone. Rolling back past a migration leaves tables the old code ignores, which is why migrations should only add. The preflight card says so when it lists new migrations.

**Who may publish.** Today, pushing code and moving `main` on an app store need a platform admin (`guardCode`). That is acceptable for the first version. Gap 8 in the slop reader's report proposes a narrower developer right.

### 5.9 The agent on slop

The agent stays in the page. Part 4 showed that slop's `sample` drives Sitebench's tool loop, and the person's monthly LLM budget applies (`slop llm set`). Changes to the host API (Appendix A has the full list):

| Group | Change |
|---|---|
| `files.*` | Same verbs, backed by the project (draft or a proposal). Each write is synced as in 5.4. |
| `data.*` | Replaced by `app.*` on the current instance: `app.docs(coll, where?)`, `app.doc(path)`, `app.setDoc(path, body)`, `app.sql(query, args?)` (read-only), `app.call(action, args)` (the actor, as the person), `app.status()`, `app.logs({since})`, `app.reset(fixture?)`. Writes refused in `read` mode, as `writable()` does today (`06-agent.js:117-120`). |
| `frames.*` | Same verbs. The probe answers them inside embedded views. |
| `fixtures.*`, `scenarios.*` | Same, with the slop fixture and step formats of 5.6. |
| new: `publish.check()` | The preflight of 5.8. |
| new: `publish.run()` | Always behind `ui.approve`; refused in `read`, `ask` and `tests` modes, and to subagents. |

**Effects** gain an `actor` part, so the agent hears about the backend the way it hears about the page:

```json
"actor": { "n": 42, "activated": true, "broken": "", "migrations": ["sql/002_tags.sql"],
           "logs": ["warn: order without items", "error: TypeError: x is undefined (actor.js:31)"] }
```

**The API guide** (`06-agent.js:513-620`) is rewritten for slop apps. It describes pages that use `window.claude`, an actor with `defineActor`, migrations that only add, and fixtures for data. It keeps the rules that make the loop work: small evals, read the effects, prefer proposals.

### 5.10 History

The bench's event log keeps its Sitebench role: blame, why cards, marks and the timeline. Each write event gains one field, the snapshot number its sync produced:

```json
{ "i": 812, "kind": "write", "ws": "main", "who": "agent", "thread": "th3", "path": "styles.css", "after": "…", "snap": 42 }
```

**What the snapshot number enables:**

- **The playhead** can show the past with a real runtime: an instance following snapshot 42, or `preview.url {at: 42}` for static pages.
- **Restore** becomes `ref.move draft 42`.
- **Edits from outside** (`slop push`) appear in the timeline as events with their snapshot number and `who: "push"`.

**What it costs.** One snapshot per sync means many snapshots per day. Snapshots are small rows over shared blobs. Pruning old draft snapshots that no ref or event names is left for later (decision D4).

### 5.11 Where the bench lives, and who may use it

**The bench is a slop app**, pushed to a store `bench` and trusted with `workshop`:

```json
{ "title": "Bench", "type": "bench", "page": "index.html", "actor": "actor.js",
  "capabilities": { "db": {}, "user": { "scopes": ["profile"] }, "sample": {}, "downloads": true },
  "slop": { "modules": ["workshop"] } }
```

**Its actor is thin.** Its actions wrap `use('workshop')`: `open`, `sync`, `embed`, `instances`, `seed`, `reset`, `publish`. The page keeps Sitebench's structure.

**Its documents** stay per person under `data/users/<id>/p_<app>/…`, as in Part 4.

**Who can use it.** Everything it does runs as the visiting person through the module. Until a developer right exists, the people who can push code are platform admins, so in practice the bench is an admin tool. That matches the Workshop.

### 5.12 The same loop from a terminal

People who prefer their own editor need a loop too, and it shares the server pieces. `slop dev <dir> --app corner` (Appendix C, C.5) would:

1. Create the dev instance if missing.
2. Watch the folder, by polling, so no new dependency is needed.
3. Push each change to `draft`.
4. Print the activation result and new `app.logs` lines.
5. Print the instance's URL (a `/dev/:store` mount, or a tab of the bench).

The bench, if open, shows the same changes live through `log.wait` (5.4). So a person can edit in their editor and watch the bench's canvas, frames, effects and scenarios.

---

## Part 6. Decisions

Each record states the choice, the alternatives that were considered, and its status.

**D1. The bench is a slop app trusted with `workshop`, not a page built into the server.**
- *Context.* The bench needs to push code, create instances and open views as the person.
- *Alternatives.* (a) A system page on the live host, next to `shell.js`. It could open views with the session cookie and be the shell for its frames without new server code. But it would have to drop the `window.claude` storage and model that Sitebench is built on, and it would ship inside the server binary. (b) A slop app, as proved in Part 4.
- *Decision.* (b), plus the embed feature (C.1).
- *Consequences.* The bench updates like any app. It needs one server feature, embedded views, and adds functions to the `workshop` module.
- *Status.* Proposed.

**D2. Every edit makes a snapshot on `draft`.**
- *Context.* The loop must be live, and history should point at real versions.
- *Alternatives.* (a) Write the working tree with `files.put` and snapshot rarely. But views serve snapshots, not the working tree, so nothing would reload. (b) One snapshot per sync.
- *Decision.* (b).
- *Consequences.* Many small snapshots; pruning is D4.
- *Status.* Proposed.

**D3. Dev data comes from fixtures, never from production by default.**
- *Context.* A dev instance that follows `draft` runs untested code against its data.
- *Decision.* Seed from fixtures. Copying production data is an explicit admin action with a warning (5.6).
- *Status.* Proposed.

**D4. Pruning draft snapshots is postponed.**
- *Decision.* Keep every snapshot at first. Later, prune draft snapshots older than N days that no ref, mark or proposal names.
- *Status.* Open, not blocking.

**D5. One dev instance per person per app.**
- *Alternatives.* One shared dev instance per app: simpler, but two people's data and sessions would mix.
- *Decision.* Per person: `<app>-dev-<6 characters of the user id>`. Proposals and scenario runs get their own instances.
- *Consequence.* Two people editing one app still share `draft`. That is a non-goal for the first version.
- *Status.* Proposed.

**D6. The probe is injected by the server into dev embeds only.**
- *Alternatives.* Apps include a script. That breaks "any app opens in the bench", and leaks a dev tool into production.
- *Decision.* The server injects it into dev embeds only.
- *Status.* Proposed.

**D7. The agent runs in the page.**
- *Alternatives.* A server agent through actor `sample` with tools (Pinboard phase 6).
- *Decision.* The page, because the frames, panels and approvals the host API drives live there, and Part 4 shows it works.
- *Consequence.* A server agent can come later for headless jobs.
- *Status.* Proposed.

---

## Part 7. Implementation plan

Each phase ends with something a person can use, and with the tests that prove it. Phases 1–3 deliver the fluid loop. Phases 4–6 deliver review and publish at Sitebench's level.

### Phase 0: Sitebench as an app (done as an experiment)

- **What exists.** `scripts/01-stage0-sitebench-as-a-slop-app.sh` and `various/stage0-app.json`.
- **To keep it.** Add Sitebench's source as `apps/bench/` with a build step that writes `apps/bench/dist/` (`build.mjs`, `build-worker.mjs`). Whether the source goes into this public repository is the user's decision. It is not committed today (`sources/MANIFEST.md`).
- **Test.** Push, open, check that `Store.mode === 'db'` and that an eval runs (Part 4).

### Phase 1: projects are app stores (no server changes)

- **The bench actor** (`apps/bench/actor.js`): actions `projects`, `open`, `sync`, `create` and `importZip`, over `use('workshop')` (`stores`, `refs`, `files`, `read`, `push`, `moveRef`, `status`).
- **The page:**
  - Replace `Projects.load/create/open` (`04-project.js:361-420`) with calls to those actions.
  - Keep `Project` in memory.
  - Add `Sync`, a debounced full-tree push to `draft`: unchanged files by `{path, sha256, size}` computed with `crypto.subtle`, changed files inline as `{path, text}`.
  - Keep the event log and threads in the bench's documents under `p_<app>/`.
- **Frames stay srcdoc** in this phase. A srcdoc frame has no slop runtime, so only pages that need no backend render correctly: static apps such as reports. Pages that call `window.claude` show errors until Phase 2.
- **Tests.** A Go test in `pkg/host` that pushes a minimal bench, calls `open` and `sync` through `actor.call`, and checks `ref.ls` (draft moved) and `files.cat` (the new text). A Playwright script like `test/run-app.mjs` against a local server.

### Phase 2: dev instances and embedded views (server)

- **`workshop` additions** (`pkg/doors/actors/modworkshop.go`): `newInstance`, `drop`, `embed`, `logs`, `restart`, `docs`, `sql`, `seed`. Appendix C has the contracts.
- **Embeds** (`pkg/doors/pages`):
  - a view kind "embed" that records the parent origin and the dev flag;
  - `/e/<token>/v/<n>/` routing in `sandbox.go`;
  - `frame-ancestors` from the embed;
  - probe injection and a Go port of `instrument()` for dev embeds;
  - `renew` for embeds.
- **The probe** (`pkg/doors/pages/assets/probe.js`): Sitebench's `PROBE` (`05-site.js:63-471`), minus `window.site` and `fxOp`, with exact-origin messaging.
- **The bench page:**
  - `FrameHost` loads `iframe.src` from `embed()` instead of `srcdoc`;
  - a small shell for its frames (hello, reload, reopen, renew, download, confirm);
  - the Data view reads the instance's documents and tables.
- **Tests.** Go tests for embed access (another person's dev instance is refused), frame-ancestors, probe injection only with `dev`, and `instrument` (port the cases from `test/run-steps.mjs` trace checks). Playwright: edit `styles.css`, and see the embedded frame reload with its input values kept.

### Phase 3: the live backend loop

- **`files.push` reports activation** (`pkg/commands/files.go:300-396`): an optional `activate: [store…]` input that runs `Running` on each and returns `{store, n, broken}`.
- **Effects** gain `actor` (5.9). The health pill counts actor failures. The Console merges `app.logs`.
- **Reset dev data.** Offer it automatically when activation fails on a changed migration.
- **Outside edits.** The bench actor long-polls `log.wait` on the app store, and the page reloads files when someone else pushes.
- **Tests.** A migration that fails shows in effects, and the frame stays on the old version. A `slop push --ref draft` from the CLI reloads the bench's frames.

### Phase 4: fixtures, scenarios and the agent's app verbs

- **Fixture seeding** (`docs` and `sql`, 5.6), fixture frames on their own instances, scenario runs on run instances with the new `docs`/`sql`/`call` checks.
- **Host API.** `app.*` replaces `data.*`. Rewrite `API_GUIDE` for slop apps.
- **Tests.** Port `test/run-scen.mjs` to a template app with an actor, for example Corner Coffee with `actor.js` and `sql/001_menu.sql`.

### Phase 5: publish

- **`ref.move` gains `ifAt`** (compare-and-swap).
- **The bench** gets the preflight and approval card, the rollout list (`app.status` per instance, "Activate now"), and rollback.
- **The agent** gets `publish.check`, and `publish.run` behind `ui.approve`.
- **Tests:**
  - publish moves `main`, and a production view gets `reload`;
  - a changed applied migration is refused by the preflight;
  - two publishers racing: one fails with a conflict;
  - rollback moves `main` back.

### Phase 6: proposals on refs, history on snapshots, and `slop dev`

- **Proposals** as `proposal/<oid>` refs with their own instances. Review checks across instances.
- **Events** carry `snap`. The playhead uses snapshot instances. Restore is `ref.move draft n`.
- **`slop dev <dir> --app <id>`** in `cmd/slop/cmds/`, built on `pkg/client/folder.go`.
- **Later:**
  - a developer code right (`pkg/authz/code.go`);
  - per-instance secrets and policy, so dev never spends production secrets (gap 9);
  - snapshot pruning (D4).

---

## Appendix A. Sitebench's host API (84 verbs) and what happens to each

Source: `API_SIGS`, `06-agent.js:75-94`. Bold verbs are long calls that pause the eval's timer.

| Group | Verbs | On slop |
|---|---|---|
| files | `list read exists lines write replace remove grep blame` | kept; backed by draft or a proposal, synced by push |
| data | `tables rows define insert update remove drop` | replaced by `app.docs/doc/setDoc/sql/call/status/logs/reset` |
| frames | `list open update move label close arrange focus outline inspect check click type text query console reload waitFor count layout snapshot compare data` | kept; answered by the injected probe in embedded views |
| snapshots | `list` | kept |
| fixtures | `list save capture` | kept; slop fixture format (5.6); `capture` reads the instance |
| scenarios | `list read save` **`run runAll`** | kept; runs on run instances |
| ui | `panel values set` **`ask`** `panels closePanel selection pins resolvePin notify pin` **`approve`** | kept |
| llm | **`llm`** | kept; slop's `sample` |
| agents | **`delegate`** `roles` | kept |
| tx, dry | `begin commit rollback`; `begin end apply discard` | kept; a rollback re-syncs the reverted files |
| session | `recall message stream` **`waitFor`** `mark marks events diff workspace` | kept |
| lib | `def list remove source` | kept; `.agent/lib/*.js` are files in the app's tree, so they ship with the app (exclude them from the page, see open questions) |
| log | `log` | kept |
| new | — | `publish.check`, `publish.run` (5.8) |

## Appendix B. Slop verbs and APIs the bench uses (exist today)

| Verb or API | Use in the bench | Source |
|---|---|---|
| `store.ls` | project list; instances by `app` | `pkg/commands/stores.go:23-47` |
| `store.new {id, type, app}`, `store.rm` | app stores and instances | `stores.go:48-63, 64` |
| `files.ls`, `files.cat` | read a project's tree at a ref | `pkg/commands/files.go` |
| `files.push {store, files, ref, message}`, `files.blobs` | sync to draft or a proposal | `files.go:139-158, 300-396` |
| `snap.ls`, `ref.ls`, `ref.move` | history, refs, publish, restore | `files.go:165-217` |
| `app.follow`, `app.status`, `app.logs`, `app.restart` | instances and their state | `pkg/commands/actors.go:53-79, 132-163`; `mounts.go:101-129` |
| `actor.call`, `claude.use('slop').actions.x` | call actions | `actors.go:36-52`; `web/runtime/src/caps.ts:281-319` |
| `import.docs`, `import.table`, `store.export`, `import.folder` | seed and copy data | `pkg/commands/data.go:53-176` |
| `log.wait`, `log.show` | outside edits | `stores.go:154-200` |
| `preview.url` | static previews (interim) | `pkg/commands/preview.go:19-60` |
| `app.trust` | trust the bench with `workshop` | `actors.go:80-116` |
| `window.claude.use('db' \| 'user' \| 'sample' \| 'downloads')` | the bench's own storage, identity, model, export | `web/runtime/src/index.ts:15-71` |

## Appendix C. Proposed additions (contracts to refine during implementation)

**C.1 `workshop.embed(store, {dev?})` → `{src, view, secret, version, expiresAt, origin, level, caps, dev}`.** *Built: `b5c0588` (diary step 7). The `path` option was dropped: frames use deep links into the entry page (§5.5).*
- Opens a view of `store` as the visiting person, for the calling app's origin.
- Requires the calling app to be trusted with `workshop`, and the person to hold `view` on the store.
- `src` is `https://s<label>.<sandbox>/e/<token>/v/<n>/<path>`; the sandbox adds the calling app's origin to `frame-ancestors`.
- `dev: true` also requires `admin` on the store, and makes the sandbox inject `/_slop/probe.js` and add `data-src` to HTML.
- Code: `pkg/doors/pages/views.go` (open), `sandbox.go` (serve), `pkg/doors/actors/modworkshop.go` (module), `pkg/doors/pages/assets/probe.js`.

**C.2 `files.push {…, activate?: [store]}`.** *Built: `3835fd8` (diary step 6).*
- After the push, runs `Running` on each listed store that follows the moved ref.
- Returns `activated: [{store, n, broken}]`.
- Code: `pkg/commands/files.go:300-396`.

**C.3 `ref.move {store, ref, n, ifAt?}`.** *Built: `6c688e7` (diary step 6). The result also carries `from`.*
- Fails with `conflict` when the ref is not at `ifAt`.
- Code: `files.go:204-217`, `pkg/store/files.go:230-251`.

**C.4 `workshop` module additions.** *Built: `d591503` (diary step 6). Instead of `newInstance` and `seed`, the module has the one-to-one functions `newStore`, `importDocs` and `importTable`. A tool composes them.*
- `newInstance(app, id, {ref, type})`: `store.new {app}` then `app.follow`.
- `drop(id)`: `store.rm`.
- `seed(id, fixture)`: `import.docs` and `import.table`.
- `logs(id)`, `restart(id)`, `docs(id, coll)`, `sql(id, query)`: read-only `sql.query`.
- Code: `pkg/doors/actors/modworkshop.go`.

**C.5 `slop dev <dir> --app <id>`.** *Built (diary step 8): `client.Dev` (`pkg/client/dev.go`) and `cmd/slop/cmds/dev.go`; flags `--instance`, `--every`, `--once`.*
- Poll, push to `draft`, print the activation result and new log lines.
- Code: `cmd/slop/cmds/`, `pkg/client/folder.go`.

**C.6 Later additions.**
- `log.watch`, a stream verb, so tools need not poll.
- A developer code right.
- Per-instance secrets and policy for dev.
- An actor clock offset for fixtures.
- Snapshot pruning.

## Appendix D. File reference

**Sitebench** (archive root; `sources/MANIFEST.md`):

| File | Read it for |
|---|---|
| `sitebench/README.md` | layout, build, the file table |
| `sitebench/src/03-store.js` | storage over `window.claude.use('db')` |
| `sitebench/src/04-project.js` | the project model: workspaces, proposals, tables, the event log, blame, why, restore |
| `sitebench/src/05-site.js` | `instrument`, `buildDoc`, `PROBE` (the in-frame script and its operations), `FrameHost`, `Headless` |
| `sitebench/src/05b-snapshots.js`, `05c-scenarios.js` | layout diffs, snapshots; fixtures, scenarios, recording |
| `sitebench/src/06-agent.js` | sandbox bridge, `API_SIGS`, `hostAPI`, `runEval`, `frameEffects`, `API_GUIDE`, `Agent` |
| `sitebench/src/worker.js`, `core.js` | the QuickJS worker, scope persistence, the term core |
| `sitebench/src/07-dock.js` … `11-app.js` | dock, canvas, views, agent views, archive, panels, app shell |
| `sitebench/test/mock.js`, `test/run-*.mjs` | the stand-in for Claude, and the Playwright scripts |
| `eval-agent-api-examples.md`, `tb/textbook.txt` | the one-tool API design and the agentalg textbook |
| `att/fs/formskate/app/host.js`, `app/ui/dock.jsx`; `att/shop/shop.html` | the two apps Sitebench's dock, canvas, matrix, flows, pins and scenarios came from |

**Slop** (repository root):

| File | Read it for |
|---|---|
| `pkg/store/files.go` | trees, snapshots, refs, the code guard |
| `pkg/kernel/apps.go`, `pkg/actor/manager.go` | `Running`, activation, migrations, actor lifecycle |
| `pkg/commands/files.go`, `stores.go`, `actors.go`, `mounts.go`, `data.go`, `preview.go` | the verbs |
| `pkg/doors/pages/live.go`, `views.go`, `sandbox.go`, `assets/shell.js` | shell, views, the sandbox origin, reload on ref moves |
| `web/runtime/src/index.ts`, `transport.ts`, `caps.ts`, `sample.ts` | the page runtime (`window.claude`) |
| `pkg/doors/actors/modworkshop.go`, `apps/workshop/` | the Workshop module and app |
| `pkg/host/workshop_module_test.go` | the draft, follow and publish loop as a test |
| `doc/building-apps.md`, `doc/claude-apis/` | how apps are written; the runtime contract |

## Open questions

1. **Should Sitebench's source go into this repository?** It is public. The decision blocks Phase 0's packaging, not the design.
2. **`.agent/lib/*.js` and the other bench files in the app tree** (`fixtures/`, `scenarios/`, `.agent/`) are pushed with the app. They are harmless, but they are visible under `/_s/`. Either keep them, or keep them in the bench's documents. This is a decision for Phase 4.
3. **Embeds for people without `admin` on the store**, for example reviewers who should see a proposal's frames. C.1 requires `view` for normal embeds and `admin` for dev embeds. That may need a review level.
4. **Collaboration.** Two people on one app share `draft`, so the second push wins, file by file. Sitebench has the same limit within one browser. Locking or merging is future work.
