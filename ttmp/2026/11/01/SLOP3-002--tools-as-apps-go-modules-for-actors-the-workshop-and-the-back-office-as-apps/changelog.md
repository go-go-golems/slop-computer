# Changelog

## 2026-11-01

- Initial workspace created

## 2026-11-01

Design guide written: tools as apps via trusted Go modules (registry, system/workshop modules, system: selector, previews, log.wait, app.follow, confirmations), back office and Workshop as apps; phases W1–W8

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/ttmp/2026/11/01/SLOP3-002--tools-as-apps-go-modules-for-actors-the-workshop-and-the-back-office-as-apps/design-doc/01-tools-as-apps-design-and-implementation-guide-for-interns.md — the guide

## 2026-11-01

W1 (632cfaf): module registry, app.trust/untrust/modules, actAs with token scopes, async verb calls

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/modules.go — actAs and the verb-module builder

## 2026-11-01

W2 (2405607): system module with call allowlist; SetRole/RevokeToken now log the real via

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/modsystem.go — the system module table

## 2026-11-01

W3 (fe7db89): system: reactors; fixed pre-existing goja data races by copying the actor definition's shape at build

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/actor/sysreact.go — system log follower and reactors

## 2026-11-01

W4 (1d619c5): workshop module, log.wait, app.follow

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/modworkshop.go — the workshop module

## 2026-11-01

W5 (e7d4a7a): inspect previews (random p-labels, per-request access check, bridge, frame-ancestors for tool and shells)

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/preview.go — preview serving

## 2026-11-01

W6 (7f4a42e): confirmations (verbs.Check first, approvals per person/view/call, shell dialog, runtime retry, confirm.approve)

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/verbs/confirm.go — confirmation book and verb
