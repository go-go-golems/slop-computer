# Changelog

## 2026-11-01

- Initial workspace created

## 2026-11-01

A3: view decisions are a cache keyed by the system epoch (50ff337); A1a: one person-to-principal path, disabled refused everywhere (a9e00de)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/auth.go — personAs
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/live.go — confirm and recheck

## 2026-11-01

A0/A4: every verb and runtime method declares an authz action; dispatch checks its floor (eae9621). A7: no app SQL runs as the kernel: kernel never writes app tables, app tables cannot reference kernel tables (7a3c37d)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/authz/actions.go — the action table
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/store/sqlpolicy.go — kernel rule and checkAppForeignKeys

## 2026-11-01

S2: keyed calls run once (runtime keys, server onceCache); store-owned actor inbox replaces the resend loop (d200761)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/actor/inbox.go — store-owned inbox
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/once.go — keyed call cache
