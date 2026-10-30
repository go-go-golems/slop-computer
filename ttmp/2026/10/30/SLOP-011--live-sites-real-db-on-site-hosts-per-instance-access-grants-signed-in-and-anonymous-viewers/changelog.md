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

## 2026-10-30

Phase 3 (5cbdbdc): live targets named in the path (/blocks/:db), create policy and POST /_site/instances (random i- ids, creator owns), share links (rt_links, migration 010, slop access link/unlink, ?k= redeemed into a grant via the link); test helper SSE race fixed

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/render/assets/shell.js — no_instance and create screens, ?k= kept across sign-in and stripped
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/store/links.go — share links: create, revoke (with their grants), redeem without lowering

## 2026-10-30

Phase 4 (722c158): visitors (vis_, migration 011) on public live routes, capped at interact without assets/comments/models; limits on visitors, opens and instances; hourly sweep of idle visitors; explicit claim on sign-in

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/store/visitors.go — visitors, private docs, moving grants, sweep
