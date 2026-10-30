# Tasks

## TODO
- [x] Design: study the contract (Downloads guides, contract 0.2.92), francois and slop; intern guide; diary <!-- t:mihd -->
- [x] Phase 1: web/rt-conformance (51 checks + Playwright runner run.mjs) passes on slop. Closed: the francois run of the same pages is dropped (francois is read-only, no runner for its host). <!-- t:a3kt -->
- [x] Phase 2: pkg/rt core (limits, paths, levels, rules, query, diff, db store) + migration 007_runtime; exit: Go tests on SQLite and Postgres, diff property test, rt_docs concurrency <!-- t:byhr -->
- [x] Phase 3: origins per target, /v/<n>/, views, view stream, RPC, web/runtime claude.js (db, user), Workshop AppScreen; exit: conformance db/user, two tabs on one target <!-- t:b9ce -->
- [x] Phase 4: room (+ agent views) and downloads via the shell; Blocks as upstream files + manifest; exit: conformance room/downloads, Blocks two-tab edit, reload converges, checkpoint, diff bytes/op measured <!-- t:m599 -->
- [x] Phase 5: slop db / slop room CLI (ArtifactData parity), sendToClaude and sendToClaudeSession as agent-request threads, slop help runtime; exit: agent completes Blocks' chat protocol, as-level hides private data <!-- t:ohzt -->
- [x] Phase 6: slop capability + approvals; delete docs store, tools/grants, tool.js, sandbox labels, Pinup adapter, slop docs (section 12); Pinup on the runtime; exit: Pinup browser checks pass, git grep finds no docs:read/tool_grants/slg_ <!-- t:xabs -->
- [x] Phase 7: assets (/_blob), artifact.publish (html form), comments capability, static mode for players (db.json); exit: conformance assets/comments, TestRuntimePublish, Pinup player from db.json <!-- t:g9i7 -->
- [x] Phase 8: sample through the Pi worker (any model and effort, admins only, no budget by decision; page tools, images, cancel, cache) and permissions/consent; exit: 20 sample checks on lunaroute models, TestRuntimeSample (fake), Blocks fills a Claude block <!-- t:26o1 -->
- [ ] Decide: SVG sanitizer for assets, files mapping (guide 16.2). Roles beyond admin and the sample budget moved to SLOP-011 (guide 12.2 questions 2 and 4). <!-- t:76g1 -->
- [x] Deploy: sample on the cluster. Closed as superseded: SLOP-010 phase 7 (Go model calls, --models pi default, no Node worker) plus a Pi credentials secret. <!-- t:5jc7 -->
- [x] Deploy: migration 007 drops the docs table. Closed: accepted for the test deployment and shipped with sha-2ac2611 (hetzner-k3s PR #401). <!-- t:h74u -->
- [ ] Workshop: the top bar's artifact picker shows the last artifact while /run/<target> is open (cosmetic) <!-- t:1efr -->
- [ ] Pinup: decide whether the inbox and nodes docs should declare rules (today: defaults, interact writes) <!-- t:g2kj -->
- [ ] artifact.publish(files) (the files form with ifMatch) is not served: it rejects invalid_content <!-- t:8t4o -->
- [ ] sample: no per-user admission queue yet (guide 6.15: two active, four queued); calls run as they come <!-- t:escv -->
