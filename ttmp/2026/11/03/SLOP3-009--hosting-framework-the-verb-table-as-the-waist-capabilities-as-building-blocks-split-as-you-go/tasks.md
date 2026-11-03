# Tasks

## TODO
- [ ] Step 0 (ops, outside this ticket): #20 is deployed (sha-35a4347, 2026-11-03); remaining: make deploy-apps; SLOP3-006 /f/:id migration --apply (dry run 2026-11-03: 103 mounts) <!-- t:n9h7 -->
- [x] Step 1: write SLOP3-009 (this design doc) <!-- t:vfcn -->
- [x] Step 2: spike verbs.Def[In,Out] + Call/Effect/Subject + schema from Go types + compat layer, on grant.set, docs.query, sample.run; check generated CLI help and MCP listing <!-- t:2ufd -->
- [x] Step 3: pkg/registry from server/registry.go (+ LastChange, mount templates); page door follows system _changes (live registry docs, AccessChanged removed); dependency ratchet test <!-- t:8drp -->
- [x] Step 4: caps/db — one db for page RPCs and actor use('db') via rt.Space; db.* as Subject: View verbs; actors get aliases and _stores; benchmark db.query <!-- t:e9pk -->
- [x] Step 5: caps/sample behind Backend and Meter, streaming via Emit; same sample for pages, actors, CLI <!-- t:m67c -->
- [x] Step 6: MCP door generated from the verb table <!-- t:v231 -->
- [ ] Step 7 (ongoing): type remaining verbs as touched — all 86 typed (inputs; 76 results) in PR #29; check when it merges. The ratchet allowlist is empty since SLOP3-010 PR 3; policy/person changes reach views through the log follower <!-- t:xmr1 -->
- [ ] Step 8 (when there is a reason): a desktop host (identity's reuse rule is in the ratchet and pkg/host exists since SLOP3-010 PR 2/3) <!-- t:edbl -->
- [ ] Step 4b (deferred from step 4): page db.* RPCs as hidden Subject: View verbs, removing the RPC switch — when a door needs it (MCP shipped without it) <!-- t:sa3u -->
