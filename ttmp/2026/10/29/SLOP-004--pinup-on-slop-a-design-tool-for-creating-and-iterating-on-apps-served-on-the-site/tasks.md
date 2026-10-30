# Tasks

## TODO
- [x] Copy Pinup into web/pinup; verify build is byte-identical and tests run in-tree <!-- t:dcr9 -->
- [x] Write the intern guide (design-doc/01) and upload it to reMarkable <!-- t:ui2g -->
- [x] Phase 1: docs store (006_docs migration, pkg/store/docs.go, tombstones, leases, limits) <!-- t:en0z -->
- [x] Phase 1: docs API and SSE stream (pkg/server/docs.go), docs:read/docs:write permissions <!-- t:uj9n -->
- [x] Phase 1: slop docs CLI and client <!-- t:cnbx -->
- [x] Phase 1: tool args/people in grant, iframe allow-downloads + clipboard <!-- t:43ds -->
- [x] Phase 1: 00-slop-host.js (db, user, file picker) and build.js --slop, make pinup <!-- t:4okz -->
- [x] Phase 1: pinup help topic for agents (done: slop help pinup) <!-- t:kwgt -->
- [x] Phase 2: presence, send-to-agent threads, Save version (done; Open version split out) <!-- t:l5na -->
- [x] Phase 2: player (same bundle, player mode), pinup-player page, Publish prototype, hand off (done; static publish split out) <!-- t:9f6t -->
- [x] Phase 3: sample, assets, reviewer role, viewer. Closed as superseded: sample and assets by SLOP-009; roles by SLOP-011 phase 2. <!-- t:uppl -->
- [ ] Open version: restore a saved version into the live documents as one revertible step <!-- t:e5c3 -->
- [x] Static publish (guide 6.9 C). Closed as superseded: SLOP-005 publishes Pinup apps as compiled page artifacts. <!-- t:col4 -->
- [ ] Scripted Playwright test of tool mode against slop serve --local (slop1.js) <!-- t:dly6 -->
- [x] Schedule PruneDocTombstones. Closed as obsolete: migration 007 dropped the docs tables; documents live in the SLOP-009 runtime store. <!-- t:n9jy -->
- [ ] Deploy Pinup and Blocks to the cluster: make pinup-push and make blocks-push against slop.yolo, approve the apps (the cluster has pinup v1 from before capabilities; its apps list is empty). <!-- t:zf91 -->
- [x] PR #3 review: no lost revs on the docs stream, no put/delete deadlock (2fe5f5a) <!-- t:jj1v -->
