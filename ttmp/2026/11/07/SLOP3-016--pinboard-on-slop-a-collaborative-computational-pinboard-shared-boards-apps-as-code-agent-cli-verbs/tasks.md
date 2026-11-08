# Tasks

## TODO
- [x] Phase 0: prototype as an app store on slop (/pb/:id), db instead of IndexedDB, one person (PR #36) <!-- t:b9ic -->
- [x] Phase 1: core.js with storage adapter; remote apply; queued writes; shared log; collaborative undo; ids (PR #36) <!-- t:qn32 -->
- [x] Phase 2: presence, cursors, follow; assets for images; c.local (PR #36) <!-- t:pvjd -->
- [x] Phase 3: apps as admin-written versions; trust prompt; narrowed scope (PR #36) <!-- t:bkuj -->
- [x] Phase 4: actor actions over the core; share dialog via platform; my boards (slop.stores runtime call) (PR #36; M8 sharing options pending a decision) <!-- t:82uq -->
- [x] Phase 5: app commands (manifest, app.commands verb, CLI dynamic commands + alias, MCP tools) (PR #37: slop.verbs, app.verbs, slop on / slop pb, app.verb, MCP tools pb_*) <!-- t:842z -->
- [x] Phase 6: server agent (actor sample tools), log pruning, iframe isolation for app windows (PR #39) <!-- t:rx3v -->
- [x] Analysis/design guide written and uploaded to reMarkable <!-- t:o85w -->
- [x] Actor VM migration phase 0: upstream go-go-goja U1 (runtimebridge owner option) and U2 (skip default globals) (go-go-golems/go-go-goja#107, U1-U4) <!-- t:4qot -->
- [x] Actor VM migration phase 1: vmHost interface + directHost, all VM entry points through host.Run (no behaviour change) (PR #38) <!-- t:cfik -->
- [x] Actor VM migration phase 2: engineHost, empty engine factory, slop globals initializer, turnOwner, actors.runtime flag (PR #38) <!-- t:gnlu -->
- [x] Actor VM migration phase 3: measurements (turn latency, goroutines, memory, interrupts, crash path) (PR #38) <!-- t:ukbq -->
- [x] Actor VM migration phase 4: bridge data modules (yaml, crypto, events, buffer) (PR #38) <!-- t:6k5w -->
- [ ] Actor VM migration phase 5: jsverbs in actors (app verbs run inside the actor turn)
- [ ] Actor VM migration phase 6: switch the default to engine (blocked: #107 merged and tagged, engine CI seen green, staging soak, doc 02 updates)
- [x] Consolidated: #36, #37 and #38 folded into #39 (now against main) with the SLOP3-017 review fixes on top; #36–#38 closed <!-- consolidated -->
