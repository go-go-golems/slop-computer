# The bench (Sitebench)

A coding-agent workbench that started as a Claude artifact, Sitebench, and
is becoming slop's environment for developing slop apps (SLOP3-022: the
guide is `ttmp/2026/11/15/SLOP3-022-…/design-doc/01-…`). Claude works
through one `eval` tool that runs JavaScript in a QuickJS sandbox, against a
project of HTML, CSS and JS files plus small data tables, shown live in
frames on a canvas.

The source came from `sitebench-workspace.zip` (sha256 `048f3d25…`, see the
ticket's `sources/MANIFEST.md`): `sitebench/src`, `sitebench/test` and the
two build scripts, merged into `build.mjs`. The archive's other folders
(reference material) are not here.

## Layout

- `src/`: the source.
  - `NN-*.js` files are concatenated in order into `apps/bench/app.js`.
  - `index.html` holds all the CSS.
  - `worker.js` and `core.js` are the sandbox worker and the term core.
- `build.mjs` writes `apps/bench/{app.js, index.html, sandbox.js}`, each
  stamped with the hash of the sources (`../build-stamp.mjs`); `go test`
  fails when they are stale. `apps/bench/app.json` (and later `actor.js`)
  are written by hand.
- `test/`: Sitebench's Playwright scripts (`run-*.mjs`) with a stand-in for
  Claude (`mock.js`), plus the screenshots they write (ignored).

## Build and test

```
make bench                      # npm ci + node build.mjs
cd ../../apps/bench && python3 -m http.server 8765 &
node test/run-app.mjs           # or any test/run-*.mjs
```

The scripts expect Chrome at `/usr/bin/google-chrome` and Playwright at
`/opt/npm-tools/node_modules/playwright`; adjust the paths at the top of a
script to run elsewhere. On slop, push `apps/bench` as an app (`slop push
apps/bench --store bench`) and mount it on the live host.

## Source files

| File | What it holds |
|---|---|
| `01-util.js` | DOM helpers, diffs, syntax highlighters, Markdown, YAML |
| `02-templates.js` | project templates (Corner Coffee, Landing, Blank) |
| `03-store.js` | storage: the artifact database, with local and in-memory fallbacks |
| `04-project.js` | projects: files, proposals, tables, event log, marks, threads, blame |
| `05-site.js` | frames: page building, the in-frame helper script, frame hosts |
| `05b-snapshots.js` | snapshots and layout diffs |
| `05c-scenarios.js` | fixtures, scenarios, recording |
| `06-agent.js` | the sandbox bridge, the host API, the agent loop, compaction, subagents, the API guide |
| `07-dock.js` | the dock: tiles, tabs, layouts |
| `08-canvas.js` | the canvas: frames, flows, matrix, playhead |
| `09-views.js` | Code (with blame), Data, Inspector, Layers, Console, Eval, Docs |
| `10-agentviews.js` | Agent, Review, Timeline |
| `10b-archive.js` | zip export and import, transcripts |
| `10c-scenarioview.js` | the Scenarios panel |
| `10d-panels.js` | panels, live sources, charts |
| `11-app.js` | the app shell, header and boot |
