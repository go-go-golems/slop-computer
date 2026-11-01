# slop v3 workspace

Everything from the session of 31 October 2026 that exists as files: the design, the in-browser lab (source, build and tests), the transcripts available, and pointers to what was read.

## What's here

| path | what it is |
|---|---|
| `design/slop-v3-design.pdf` | The design doc, "slop v3: a computer made of stores", revision 37, with its diagrams. |
| `design/slop-v3-design.md` | The same doc as Markdown. The three diagrams are text placeholders here; see the PDF. |
| `design/widget-renders/` | Renders of the doc's diagrams captured while it was being written. They may predate later revisions: the PDF is current. |
| `lab/src/kernel/` | The kernel: stores (`store.js`), the SQL policy (`sqlite.js`), access (`access.js`), actors (`actors.js`, `prelude.js`), turns, mounts, the clock and steps (`kernel.js`), and the verb table (`verbs.js`). |
| `lab/src/seeds/` | The seed world: the journal and tracker apps, and the stores, principals, grants and mounts. |
| `lab/src/runtime/shim.js.txt` | The runtime injected into hosted pages: `window.claude.use()` over a MessagePort. |
| `lab/src/ui/` | The lab shell (React, Kiln CSS): the dock, the views and the agent. |
| `lab/src/worker.js`, `lab/build.mjs` | The worker entry and the build: esbuild, plus the design system CSS from your uploads. |
| `lab/dist/` | The build published as the "slop lab" artifact. Serve the folder over HTTP to run it locally. |
| `lab/spike/` | The first feasibility spike: authorizer, update hook and QuickJS in a worker. |
| `lab/test/` | Tests: `k.sh` with `ktest.html` (the kernel), plus the Playwright suites `ui.mjs`, `agent.mjs`, `dock.mjs` and `dl.mjs`. `shots/` holds screenshots. |
| `transcripts/session-log.md` | A written account of the whole session: your messages, what was built, and the problems found. Not verbatim (see below). |
| `transcripts/lab-agent-thread-counter.md` | The in-lab agent thread you sent (counter and counter-display), complete, as Markdown. |
| `transcripts/lab-agent-thread-counter.original.html` | The same thread as you sent it. |
| `transcripts/test-runs/` | The output of the last run of each test suite. |
| `references/repos.md` | Repositories read during the session, with remotes and commits. |

## What's not here, and why

- **The raw session transcript and the subagent transcripts.** This session's conversation, including the subagent runs, is kept in the claude.ai chat, not in the workspace. There was no transcript file to copy. `transcripts/session-log.md` is the closest substitute: written from Claude's working context, it quotes your messages and describes the work. The early part of the session was compacted mid-way, so that part is reconstructed from the summary.
- **The cloned repositories** (249 MB) and sqlite-wasm: re-clone them from `references/repos.md`. The build expects sqlite-wasm at `../vendor/sqlite-wasm` relative to `lab/`.
- **Your uploads** (the design systems, the handbook, claude-computer and the zips): you have the originals. The build reads the Kiln CSS from where they were unpacked; adjust the paths in `build.mjs`.
- **The lab's world** (stores, threads): it lives in your private artifact storage. Get it with World ▾ › Export world in the lab.

## Running the lab locally

```sh
cd lab
# needs esbuild and React on the module path, sqlite-wasm in ../vendor/sqlite-wasm, and the Kiln CSS (paths in build.mjs)
node build.mjs dist
npx http-server dist    # or any static server that serves .wasm as application/wasm
```

The kernel test: `test/k.sh`. The browser suites: `node test/ui.mjs dist test/shots` (and agent, dock, dl). They use Playwright with Chromium.
