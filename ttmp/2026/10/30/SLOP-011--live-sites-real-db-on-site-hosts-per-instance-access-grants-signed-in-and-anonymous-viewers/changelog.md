# Changelog

## 2026-10-30

- Initial workspace created

## 2026-10-30

Ticket created; intern guide written (current system: hosts, routes, modes, runtime views, identity; design: site shell, site sessions by handoff, anonymous visitors, rt_grants and levelOf, instance routes, share links, capability policy, quotas, access API; 8 decisions, API reference, migration sketch, 5 phases, tests, open questions). Diary steps 1-2.

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/ttmp/2026/10/30/SLOP-011--live-sites-real-db-on-site-hosts-per-instance-access-grants-signed-in-and-anonymous-viewers/design-doc/01-intern-guide-live-sites-instances-and-access-grants.md — The guide

## 2026-10-30

Uploaded the intern guide to reMarkable: /ai/2026/10/30/SLOP-011/SLOP-011 Live sites intern guide.pdf (remarquee: OK: uploaded).

## 2026-10-30

Phase 1: live routes on site hosts for admins signed in by handoff; site shell; site sessions (cb350c4)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/render/assets/shell.js — the site shell
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/live.go — handoff, /_site/ API, shell

## 2026-10-30

Phase 2 (3d5c8bc): rt_grants and the member role (migration 009, SQLite runner switches foreign keys off and checks them), levelOf with role caps, access API and slop access CLI, admin-only sample/publish/slop perms, CSP sandbox for non-shell pages on hosts with live routes

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/access.go — levelOf, reviewViews and the access API
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/live.go — siteHeaders sandboxes non-shell pages on live hosts
