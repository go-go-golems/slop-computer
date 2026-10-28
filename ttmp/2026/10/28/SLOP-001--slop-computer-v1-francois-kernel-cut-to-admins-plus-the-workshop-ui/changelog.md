# Changelog

## 2026-10-28

- Initial workspace created

## 2026-10-28

Created ticket; copied Directions rev 2 and Workshop prototype into sources/; wrote intern guide (design-doc/01) and diary

### Related Files

- ttmp/2026/10/28/SLOP-001--slop-computer-v1-francois-kernel-cut-to-admins-plus-the-workshop-ui/design-doc/01-slop-computer-v1-intern-guide-architecture-francois-carve-out-and-workshop-integration.md — intern guide

## 2026-10-28

docmgr doctor passes; uploaded guide + diary bundle to reMarkable /ai/2026/10/28/SLOP-001 (OK: uploaded)

## 2026-10-28

Owner review: D1/D5 accepted; D2 → React + RTK Query (atomic design); D3 → Workshop as live shell artifact in DB + embedded bootstrap + Vite proxy. Added §6.11 live shells, rewrote §6.8 and phase 5, added §12.

## 2026-10-28

D3 revised: Workshop embedded + Vite proxy, only artifacts in DB; shell concept removed from v1; §6.11 now live iteration on artifacts

## 2026-10-28

Added local mode (nickname identities, loopback-only) and SQLite support via one database/sql store; D5 revised, D8 added

## 2026-10-28

Added tools (§6.13, D9): pushed screens with admin-approved, permission-limited grants; core Workshop stays embedded

## 2026-10-28

Phase 0 (ca57479) and Phase 1 (2c6ff88): module skeleton; store on database/sql for Postgres+SQLite; auth carve-out; local mode; auth CLI

## 2026-10-28

Phase 2 (82dd101): kernel store, blobs, events broker, SSE, comments wait

## 2026-10-28

Phase 3 (dcb7c1a): routing, records, rendering, site + sandbox hosts

## 2026-10-28

Phase 4: agent CLI (push/pull/route/comments/projects, push --watch), dev seed from the prototype, unchanged pushes (bfc8a96)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/cmd/slop/cmds/devseed.go — dev seed
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/cmd/slop/cmds/push.go — push, pull, watch

## 2026-10-28

Phase 5: Workshop (React + RTK Query) embedded, safe mode /_/, via=agent; exit check with two pi agents (b7b8bd6, aaa76f6, 8f17564)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/safe.go — safe mode
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/workshop/src/api/slopApi.ts — Workshop API

## 2026-10-28

Phase 6: tools (manifests, grants, permissions, CORS, tool.js, Tools menu, ToolScreen), release board example; exit check passed (f631ded, 2c87ccf)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/tools.go — tools API
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/workshop/src/screens/ToolScreen.tsx — ToolScreen
