# Changelog

## 2026-11-16

- Initial workspace created

## 2026-11-16

Ticket created. Guide (design-doc/01) written for a new engineer: slop's stores/snapshots/refs, apps and instances, verbs and the workshop module; the bench's current sync, eval and storage design; the 26 review findings grouped by cause; the rewrite (files.commit, Draft/Tx core, host-API table, server-side storage); a four-phase plan and the property-test invariants. Second-pass review fixed 17 passages (accuracy and missing explanations).

### Related Files

- /tmp/claude-1000/-home-manuel-workspaces-2026-10-28-slop-computer-slop-computer/7fa934c5-45f7-43c5-9ffb-d734dcfbe139/scratchpad/t23/ttmp/2026/11/16/SLOP3-023--bench-core-drafts-as-server-side-commits-evals-as-transactions-one-api-table-one-storage-model/design-doc/01-guide-the-bench-core-rewrite-drafts-as-server-side-commits-evals-as-transactions.md — the guide

## 2026-11-16

UI layer ported to ui/ modules with main.js and an esbuild bundle; merged main (#50). Browser smoke test on a local server built from the branch (new app, evals, edits and a conflict, proposals accepted and rejected, history, blame, a scenario, agent turns, zip): fixed probe waitFor (body never visible), duplicate outside events (actor dedupes), Code view versions refresh and Take theirs, headless frames of closed proposals. Removed legacy CSS and Sitebench's Playwright scripts; README rewritten. Diary step 9.

### Related Files

- /tmp/claude-1000/-home-manuel-workspaces-2026-10-28-slop-computer-slop-computer/7fa934c5-45f7-43c5-9ffb-d734dcfbe139/scratchpad/t23/web/bench/build.mjs — bundles main.js after the import check
- /tmp/claude-1000/-home-manuel-workspaces-2026-10-28-slop-computer-slop-computer/7fa934c5-45f7-43c5-9ffb-d734dcfbe139/scratchpad/t23/web/bench/src/main.js — entry point: views, panel API, boot
