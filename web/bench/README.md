# The bench

slop's environment for developing slop apps, itself a slop app
(`apps/bench`: a page, and an actor with SQL). A person opens one of their
app stores in it and sees its pages live, in frames of their own dev
instance. They edit the app's files and talk to Claude, who works through a
single `eval` tool: JavaScript run in a QuickJS sandbox against the host API
(files, instances, frames, scenarios, the timeline).

It began as a Claude artifact, Sitebench (SLOP3-022 brought it onto slop).
SLOP3-023 rewrote its core and gave the source the layout below. The guide is
`ttmp/2026/11/16/SLOP3-023-…/design-doc/01-guide-…md`: section 5 covers the
design, section 6 the code layout.

## The model in four sentences

- **The server is the only place an app's files live.** Each workspace is a
  ref of the app store: `draft`, or `proposal/<id>`. A `Draft`
  (`core/draft.js`) reads a ref's snapshots and changes it with
  `files.commit`, which sends an explicit change list against a base and is
  merged on the server file by file.
- **Every write is a transaction (`Tx`).** The person's typing is one live
  Tx, committed a moment after the last keystroke. Each eval is one Tx:
  committed if the eval succeeds, dropped if it fails. A subagent's Tx folds
  into its caller's.
- **The host API is one declared table** (`core/api.js`, entries in
  `agent/api/`). One dispatcher checks arguments and enforces the thread's
  mode and the dry-run rules. The reference the agent reads is generated
  from the same table.
- **Project state** lives in the bench actor's SQL
  (`apps/bench/actor.js`): threads, the timeline, snapshots, proposals and
  meta. Per-viewer preferences (layout, theme) stay in localStorage.

## Layout

Each module says what it is for in its header comment and exports a small
API. The layers import downward only:

```
lib → core → server → model → frames → agent → ui → main.js
```

`tools/imports.mjs` writes and checks every module's import lines (run it
with `--write` after adding a name). The build runs the check and stops on a
name that resolves nowhere.

| Directory | What it holds |
|---|---|
| `lib/` | helpers with no bench concepts: DOM (`dom.js`), text (diffs, Markdown, YAML, highlighting), CSS rules, utilities |
| `core/` | the pure core, testable under Node: `Draft` and `Tx`, the API table and dispatcher, scenario and fixture specs |
| `server/` | the line to the server: the actor's actions and the Drafts registry (`slop.js`), instances and the watch, publishing, records |
| `model/` | an app being developed (`project.js`: workspaces, proposals, threads, events), its history (`timeline.js`), templates |
| `frames/` | frames of instances (`host.js`), the in-frame probe, layout maps and snapshots, scenario runs, frame event streams |
| `agent/` | the sandbox bridge, one eval as a Tx (`eval.js`), its effects, the API tables (`api/`), the agent loop, roles, the guide |
| `ui/` | the shell (`app.js`), the dock, and one module per view: canvas, code and docs, history, inspector, console and eval, data, threads, review, panels, scenarios |
| `worker/` | the sandbox worker (QuickJS) and the core it runs in every session; built separately |
| `main.js` | the entry point: registers the views, adds the panel calls to the API, boots the shell |

`index.html` holds the page and all its CSS.

## Build and test

```
make bench          # npm ci + node build.mjs
npm test            # the core under Node: Draft and Tx, the API table, evals against an in-memory server
```

`build.mjs` writes `apps/bench/{app.js, index.html, sandbox.js}` and
`pkg/doors/pages/assets/probe.js`. Each file's first line is a stamp: the
hash of the sources (`../build-stamp.mjs`). `go test ./pkg/host` fails when
an output is stale. `pkg/host/bench_test.go` tests the actor.

To try it, push `apps/bench` to a store on a slop server (local or staging),
trust it with `workshop`, allow `sample` for admins, and mount it on the
live host. `scripts/deploy-apps.sh` shows the commands.
