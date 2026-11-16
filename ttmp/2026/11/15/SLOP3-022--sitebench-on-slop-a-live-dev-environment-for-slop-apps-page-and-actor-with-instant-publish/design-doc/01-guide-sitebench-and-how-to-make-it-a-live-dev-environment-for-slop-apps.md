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
RelatedFiles: []
ExternalSources: []
Summary: "What Sitebench is and how it works; how slop stores, apps, refs, views and actors work; and the design and plan for a bench where a slop app (page and actor) is a project with a live dev instance and a one-step publish."
LastUpdated: 2026-11-15T19:30:00-05:00
WhatFor: "An intern who will build the bench, or review its design"
WhenToUse: "Before working on SLOP3-022 or on slop's development tooling"
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
>   - "accept" and "publish" become ref moves.

**Sources.** Sitebench paths are relative to the archive root: `sources/sitebench-workspace/` in this ticket, which is git-ignored. `sources/MANIFEST.md` lists the files. Slop paths are relative to the repository root at origin/main (`97c4458`, 2026-11-15).

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
6. **Claude hears what happened.** The tool result Claude receives includes:

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

**The host API** is 84 verbs in 15 groups, listed in Appendix A (`API_SIGS`, `06-agent.js:75-94`). The page implements every verb in `hostAPI(ctx)` (`:114-419`). The sandbox only forwards calls, so authority lives on the page side.

**Every eval is a transaction.**

- Before the first write to a file or table, the page records its previous state (`06-agent.js:131-144`). If the eval throws, every write is rolled back, and the rollback is logged as ordinary events.
- `tx.begin/commit/rollback` nests transactions inside an eval.
- `dry.begin/end/apply` captures file writes as a changeset without applying them.

**Effects.** After an eval that wrote something, `frameEffects` waits 260 ms, re-runs checks and layout on every frame of the board, and tells the model what changed (`06-agent.js:473-494`):

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

