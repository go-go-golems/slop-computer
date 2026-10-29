# Changelog

## 2026-10-29

- Initial workspace created

## 2026-10-29

Designed the runtime baseline: contract per capability, verdict on every slop part, apps and targets, origins per target, views and one stream, contract db with rules, mirrors and diff sync, rooms, assets, comments, downloads, publish, sample, the slop capability replacing tools, static mode, agents (slop db); 11 decisions; delete list; 8 phases with exit tests. Diary step 1.

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/ttmp/2026/10/29/SLOP-009--artifact-runtime-baseline-slop-hosts-the-artifact-contract-natively-no-adapters/design-doc/01-intern-guide-the-slop-artifact-runtime.md — the intern guide

## 2026-10-29

Implemented the runtime: pkg/rt, migration 007, store, views/stream/RPC, claude.js, slop data/room; deleted docs, presence, tools and grants (1f3b039). Workshop shell and conformance suite (f7484d5). sample through the Pi worker, tested on lunaroute models (70025b3). Pinup on the runtime with static-mode player (ccefd86). Claude Blocks from upstream files (9cf5485). Asset revalidation, more conformance, publish test (ec9a91b). Diary steps 2 and 3.

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/rt.go — views, stream, RPC
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/runtime/src/db.ts — the runtime's db
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/rt-conformance/run.mjs — browser conformance runner
