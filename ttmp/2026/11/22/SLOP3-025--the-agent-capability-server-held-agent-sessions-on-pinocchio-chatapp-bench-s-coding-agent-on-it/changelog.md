# Changelog

## 2026-11-22

- Initial workspace created

## 2026-11-22

Agent capability implemented: server (pkg/doors/pages/agent, 3aef663/8922ce0, hold-key fix 501e81a), runtime claude.use('agent') (f903096), bench on it (ee6de7d); end-to-end in bench with the fake model; doc/building-apps.md

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/doors/pages/agent/agent.go — the service and resolver
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/bench/src/agent/agent.js — bench's agent on sessions
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/runtime/src/agent.ts — the page API
