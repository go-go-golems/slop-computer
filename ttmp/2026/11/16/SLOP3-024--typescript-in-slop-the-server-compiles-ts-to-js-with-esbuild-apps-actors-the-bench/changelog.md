# Changelog

## 2026-11-16

- Initial workspace created

## 2026-11-16

Ticket created to remember the idea (server-side TS → JS with esbuild); notes written; full design deferred

## 2026-11-16

Notes §7: what the review of #51 showed about types and API shape (actor action argument types, TS for verb-backed modules from Go structs, a tagged change type, a snapshot type, server-side reset to a snapshot); four tasks

## 2026-11-16

Notes §8: type checking in the bench is a browser worker (measured: 1.26 s cold, 30–90 ms warm, ~80 MB, ~2 MB gzipped); it also compiles TS evals. scripts/01-ts-check-latency.cjs. One task.

## 2026-11-16

The full design (design-doc/01): the server compiles .ts per file with esbuild (page/actor/eval profiles, cache by hash); declarations for the page runtime, the actor API, modules generated from verb schemas, and app actions (phase 2: args schemas, validated); checking in the bench worker and with tsc, none on the server for now. Probes: scripts/02 (transform ~2 ms/file), scripts/03 (goja runs the output; stack traces map to .ts). Tasks restructured by phase. Diary steps 1–2.

## 2026-11-16

Decisions (2026-11-16): new apps default to TS; packages only via slop vendor (CLI, a person runs it; the server never fetches; the agent cannot add packages); .tsx in phase 0 (TsconfigRaw + vendored JSX runtime via import map). The goja source-map fix shipped first (PR #52). Design: status, §1, new §4.7 slop vendor, app verbs via jsverbs hooks in the CLI, phase 0b, §11 decisions. Tasks updated. Diary step 3.

## 2026-11-16

Phase 0 implemented (PR #53, on #52): pkg/tscompile; pages compile .ts/.tsx with maps and an import map from slop.imports.page; actors load TS and slop.imports.actor names; slop eval --ts; TS app verbs via jsverbs hooks. Browser-checked on a local server. Design corrected: slop modules via use() only; names under slop.imports. Diary step 4.
