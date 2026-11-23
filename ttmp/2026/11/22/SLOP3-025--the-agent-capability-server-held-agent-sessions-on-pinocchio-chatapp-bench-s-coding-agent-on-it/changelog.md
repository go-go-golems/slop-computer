# Changelog

## 2026-11-22

- Initial workspace created

## 2026-11-22

Agent capability implemented: server (pkg/doors/pages/agent, 3aef663/8922ce0, hold-key fix 501e81a), runtime claude.use('agent') (f903096), bench on it (ee6de7d); end-to-end in bench with the fake model; doc/building-apps.md

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/doors/pages/agent/agent.go — the service and resolver
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/bench/src/agent/agent.js — bench's agent on sessions
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/runtime/src/agent.ts — the page API

## 2026-11-22

Review fixes (9f4b923) and design 02 implemented: session guard (pinocchio cedda17), grant per capability (c7a9d79), one reducer for the agent client (6a62fcb)

## 2026-11-22

Second review: design 02 section 7 implemented: guard wraps the engine (pinocchio ecae347), sends claim their run (a8afc9f), tool results outbox (6c656fe)
