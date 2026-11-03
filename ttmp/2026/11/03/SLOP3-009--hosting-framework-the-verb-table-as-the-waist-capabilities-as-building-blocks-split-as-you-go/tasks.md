# Tasks

## TODO
- [ ] Step 0 (ops, outside this ticket): deploy #20 via its GitOps PR; make deploy-apps; SLOP3-006 /f/:id migration --apply (dry run 2026-11-03: 103 mounts) <!-- t:n9h7 -->
- [x] Step 1: write SLOP3-009 (this design doc) <!-- t:vfcn -->
- [ ] Step 2: spike verbs.Def[In,Out] + Call/Effect/Subject + schema from Go types + compat layer, on grant.set, docs.query, sample.run; check generated CLI help and MCP listing <!-- t:2ufd -->
- [ ] Step 3: pkg/registry from server/registry.go (+ LastChange, mount templates); page door follows system _changes (live registry docs, AccessChanged removed); dependency ratchet test <!-- t:8drp -->
- [ ] Step 4: caps/db — one db for page RPCs and actor use('db') via rt.Space; db.* as Subject: View verbs; actors get aliases and _stores; benchmark db.query <!-- t:e9pk -->
- [ ] Step 5: caps/sample behind Backend and Meter, streaming via Emit; same sample for pages, actors, CLI <!-- t:m67c -->
- [ ] Step 6: MCP door generated from the verb table <!-- t:v231 -->
- [ ] Step 7 (ongoing): type remaining verbs as touched; shrink the ratchet allowlist; PolicyChanged/PersonChanged → log followers <!-- t:xmr1 -->
- [ ] Step 8 (when there is a reason): identity to the reuse rules; host.New and a desktop host <!-- t:edbl -->
