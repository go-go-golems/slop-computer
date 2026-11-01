# Changelog

## 2026-11-01

- Initial workspace created

## 2026-11-01

Wrote the intern design and implementation guide for slop v3 core: stores, apps, goja actors, mounts on live/static hosts, audiences (anonymous, guest, member, subscriber, admin), the per-app policy matrix, LLM access plus token budget, the verb table (CLI, HTTP, eval), back office, import/export, reuse map and phases P0-P8.

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/ttmp/2026/11/01/SLOP3-001--slop-v3-core-a-streamlined-store-based-hosting-service-design-and-implementation-guide/design-doc/01-slop-v3-core-design-and-implementation-guide-for-interns.md — The guide

## 2026-11-01

Uploaded the guide to reMarkable at /ai/2026/11/01/SLOP3-001 (fixed a LaTeX escape in section 11.6 first).

## 2026-11-01

Applied the product owner's answers: anonymous folded into guest; lab is reference plus design system for the back office; francois Stripe integration copied into the core (comps + stripe tables); open sign-up accepted (Zitadel); binary slop, v2 CLI as slop2 for cut-over.

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/ttmp/2026/11/01/SLOP3-001--slop-v3-core-a-streamlined-store-based-hosting-service-design-and-implementation-guide/design-doc/01-slop-v3-core-design-and-implementation-guide-for-interns.md — Revised guide

## 2026-11-01

Uploaded the revised guide as 'SLOP3-001 slop v3 core design guide v2' to /ai/2026/11/01/SLOP3-001 (first upload kept).

## 2026-11-01

P0 implemented: slop serve, system.db schema and migrations, local sign-in, sessions with CSRF, device login, tokens, verb table with HTTP door and generated CLI; tests and a manual device-login run pass.

## 2026-11-01

P1 implemented (9f454de): stores on SQLite with turns and a log, documents with contract queries, files/snapshots/refs, the SQL authorizer, access with traces, the kernel, store/docs/files/sql/grant/import verbs, eval on goja, and CLI push/pull/eval/import/export. Guide corrected: trusted_schema stays on; files.blobs and snap.new; typed CSV import.

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/store/sqlpolicy.go — the SQL authorizer
- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/store/turn.go — turns and commits
- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/verbs/eval.go — eval programs

## 2026-11-01

P2 implemented (98f3859, e9ae7b3): app.json and running versions, mounts with history, static host (trailing slash, /_s/, cache classes), live host (shell, site sessions, guests, handoff), sandbox origins, views/stream/RPC with v2's runtime unchanged, assets. Conformance passes in Chromium; Blocks with guests and Pinup run.

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/live.go — live host and handoff
- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/views.go — the page protocol

## 2026-11-01

P3 actors (34f35c0): goja runtime per store, turns across awaits, migrations and setup on activation, reactors with cursors, alarms, HTTP routes, read aliases, slop call; guide §6.3 rewritten to match

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/actor/actor.go — turn loop and the I/O bridge
- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/actor/manager.go — activation, reactors, alarms

## 2026-11-01

P3 exit completed (23c0c67): examples guestbook/journal/static-site; tests for a missed alarm (late), a failing smoke check, reactor retry exactly once; fixes for sqlite_autoindex in migrations and silent reactor failures. Decision: no v2 bridge; P8 deploys from source

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/examples/journal/actor.js — the journal example on v3
- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/p3_examples_test.go — P3 exit tests

## 2026-11-01

P4 (4ff910e): OIDC sign-in with PKCE, share links, guest limit/sweep/claim, explain.can; fixed store principals matching audience grants and needless link grants

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/p4_test.go — P4 exit tests incl. fake OIDC provider
- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/sitelinks.go — links and the claim on the live host

## 2026-11-01

P5 (a5e5299): comps and Stripe subscriptions from francois (policy unchanged, payments cut to subscriptions, storage in system.db); views follow audience changes. Open: one Stripe test-mode run (no keys in this session)

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/billing/stripe/service.go — checkout, webhooks, worker
- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/billing.go — subscribe page and view reviews

## 2026-11-01

P6 (a90186a): app policy matrix, LLM access with monthly budgets (Pi worker backend from v2, fake for tests), page and actor sample with charging, encrypted secrets, platform capability, visitor llm info

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/sample.go — page sample with budget checks
- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/system/policy.go — policy, LLM ledger, secrets

## 2026-11-01

P7 (64ff450): back office on the main host (seven surfaces, lab design system, esbuild + React, every button a verb call); Playwright exit passes

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/ttmp/2026/11/01/SLOP3-001--slop-v3-core-a-streamlined-store-based-hosting-service-design-and-implementation-guide/scripts/01-p7-backoffice-e2e.mjs — P7 exit run
- /home/manuel/code/wesen/2026-10-31--slop-v3/web/admin/src/views.jsx — the back office surfaces

## 2026-11-01

P8 (5b6505d): deployed from source with the CLI — slop.boutique (seed → one static store with app.json notFound), the francois apps, Claude Blocks and Pinup with guest instances; presence now follows the view's stream

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/rt/views.go — AsPeer lists only views with a stream
- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/site.go — notFound page for static sites
- /home/manuel/code/wesen/2026-10-31--slop-v3/ttmp/2026/11/01/SLOP3-001--slop-v3-core-a-streamlined-store-based-hosting-service-design-and-implementation-guide/scripts/02-build-boutique.py — the boutique rendered at build time
