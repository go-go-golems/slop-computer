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
