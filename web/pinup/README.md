# Pinup

Pinup is a screen-design tool that runs as a single HTML page: frames, auto layout, components and instances, colour and text tokens with light and dark modes, a prototype player, an inspect panel, code export, pinned feedback items, and a shared history in which every step can be reverted on its own. Ramon wrote it in one Claude Code session on 2026-10-28, as a claude.ai Artifact.

This folder is that source, copied here so Pinup can be maintained next to slop. SLOP-004 adapts it into a Workshop tool for designing pages served on slop's site hosts. The design is in `ttmp/2026/10/29/SLOP-004--…/design-doc/01-intern-guide-integrating-pinup-into-slop-as-a-workshop-tool.md`.

## Provenance

| | |
|---|---|
| Copied from | `~/code/others/ramon/pinup-export/` (export of 2026-10-28) |
| Published original | https://claude.ai/artifact/UVDCAmJEaKWj1eeP9QHB9P (v3) |
| Copied | `workspace/pinup/{src,build.js,vendor/package*.json}` and `tests/*`, unchanged except `tests/wrap.js`, which now reads `../dist/pinup.html` instead of the session's `/home/claude/pinup/dist/pinup.html` |
| Not copied | `dist/` (build output) and the session transcript (16 MB; still at the export path) |
| Check | `node build.js` here produces a `dist/pinup.html` byte-identical to the published one (sha256 `531ef701b5c1417e…`) |
| Write-up | `go-go-parc/Projects/2026/10/28/PROJECT REPORT - Pinup - A Shared Design File Inside a Claude Artifact - A Technical Deep Dive.md` |

## Build

```sh
cd vendor && npm ci && cd ..   # lucide-static: the icon set the build inlines
node build.js                  # → dist/pinup.html (the page) and dist/check.js (for node --check)
```

`build.js` concatenates `src/head.html`, `src/body.html`, the Lucide icons as a JSON script element, and `src/NN-*.js` in lexical order inside one IIFE. There is no module system: the modules share one scope, and the number prefixes give the load order.

## Test

The scripts in `tests/` drive the built page in Chromium through Playwright. `mock.js` stands in for the Artifact runtime (`window.claude.use`: `db`, `room`, `user`, `comments`, `sample`, `downloads`), and `seed.json` is the example file "Pace Club" as database documents. Playwright is not a dependency of this repo; use any install:

```sh
cd tests
NODE_PATH=/path/to/node_modules node t1.js    # also t2…t7, fb1, fb2, final
```

If the installed Playwright's browser build isn't downloaded, preload a shim that passes `executablePath` to `chromium.launch` (see the SLOP-004 diary, step 1).

## Where things are

| File | What it does |
|---|---|
| `src/02-store.js` | state, `norm()`, `commit()` and undo, the database write queue |
| `src/03-render.js` | `cssFor()` (node → CSS), tokens, instances, incremental render |
| `src/06-proto.js` | the prototype player |
| `src/07-export.js` | HTML, React + Tailwind, handoff Markdown, images |
| `src/08-import.js` | HTML → layers (how Claude writes designs) |
| `src/09-collab.js` | `cap()`: every use of the host runtime, presence, inbox, share |
| `src/10-claude.js` | the in-page Claude prompt bar and its tools |
| `src/13-feedback.js`, `src/14-log.js` | feedback items, steps, revertible history |
