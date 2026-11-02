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

## 2026-11-01

S1: catch-up order held by a test (425f66f). A5: D9 in the store via authz.CodeRight (067b50d); Query/GetDoc take the caller's read rule (1cb71d7, 61c9548); closed two holes (actor files.write of app code; stores module ignoring target rules)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/store/docs.go — read predicate
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/store/files.go — guardCode

## 2026-11-01

A2: authz.Floor shared by viewMay, verbs.Check, explain.can --action (1e57f5d, c1294ff); cross-origin cookie rule in sitePrincipal (b8adb03); guide section 12 records the implementation

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/authz/actions.go — Floor

## 2026-11-02

Admin power needs the admin scope (Principal.Role caps the role); verb scopes are read/write only (d67c05e). Actor build race fixed (c80d717). #13 P2s fixed on task/slop-v3 (6f4cd0d, 3046a21) and merged (9c07a2e)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/access/principal.go — Role caps the role by token scope
