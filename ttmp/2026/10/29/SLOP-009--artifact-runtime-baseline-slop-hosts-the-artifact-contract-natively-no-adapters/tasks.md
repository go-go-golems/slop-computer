# Tasks

## TODO
- [x] Design: study the contract (Downloads guides, contract 0.2.92), francois and slop; intern guide; diary <!-- t:mihd -->
- [ ] Phase 1: web/rt-conformance (51 checks + Playwright runner run.mjs) exists and passes on slop; OPEN: the francois run of the same pages (needs a runner for francois's own host) <!-- t:a3kt -->
- [x] Phase 2: pkg/rt core (limits, paths, levels, rules, query, diff, db store) + migration 007_runtime; exit: Go tests on SQLite and Postgres, diff property test, rt_docs concurrency <!-- t:byhr -->
- [x] Phase 3: origins per target, /v/<n>/, views, view stream, RPC, web/runtime claude.js (db, user), Workshop AppScreen; exit: conformance db/user, two tabs on one target <!-- t:b9ce -->
- [x] Phase 4: room (+ agent views) and downloads via the shell; Blocks as upstream files + manifest; exit: conformance room/downloads, Blocks two-tab edit, reload converges, checkpoint, diff bytes/op measured <!-- t:m599 -->
- [x] Phase 5: slop db / slop room CLI (ArtifactData parity), sendToClaude and sendToClaudeSession as agent-request threads, slop help runtime; exit: agent completes Blocks' chat protocol, as-level hides private data <!-- t:ohzt -->
- [x] Phase 6: slop capability + approvals; delete docs store, tools/grants, tool.js, sandbox labels, Pinup adapter, slop docs (section 12); Pinup on the runtime; exit: Pinup browser checks pass, git grep finds no docs:read/tool_grants/slg_ <!-- t:xabs -->
- [x] Phase 7: assets (/_blob), artifact.publish (html form), comments capability, static mode for players (db.json); exit: conformance assets/comments, TestRuntimePublish, Pinup player from db.json <!-- t:g9i7 -->
- [x] Phase 8: sample through the Pi worker (any model and effort, admins only, no budget by decision; page tools, images, cancel, cache) and permissions/consent; exit: 20 sample checks on lunaroute models, TestRuntimeSample (fake), Blocks fills a Claude block <!-- t:26o1 -->
- [ ] Decide: roles beyond admin, sample key and budget, SVG sanitizer, files mapping (guide 16.2) <!-- t:76g1 -->
- [ ] Deploy: the image has no Node/Pi worker, so sample is off on the cluster; add node + web/piworker to the image and mount a Pi agent dir as a secret <!-- t:5jc7 -->
- [ ] Deploy: migration 007 drops the docs table; live Pinup designs on the cluster keep only their saved versions (no db.json before this branch); decide re-seed from pages/*.json or accept <!-- t:h74u -->
- [ ] Workshop: the top bar's artifact picker shows the last artifact while /run/<target> is open (cosmetic) <!-- t:1efr -->
- [ ] Pinup: decide whether the inbox and nodes docs should declare rules (today: defaults, interact writes) <!-- t:g2kj -->
- [ ] artifact.publish(files) (the files form with ifMatch) is not served: it rejects invalid_content <!-- t:8t4o -->
- [ ] sample: no per-user admission queue yet (guide 6.15: two active, four queued); calls run as they come <!-- t:escv -->
