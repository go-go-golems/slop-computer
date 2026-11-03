# Tasks

## TODO
- [ ] Decide the open question left (design §10): writable registry docs (2); decided: 1 delegated reads (not now), 3 mounts (not mapped), 4 reserving _ (yes), 5 depth (18), 6 registry docs (not live), 7 assets (aliases only) <!-- t:zfna -->
- [x] Phase 1: data and assets across stores (reserve top-level _; aliases with to, level, as, assets; _stores for approved apps; caps/db shared by pages and actors; /_blob across reachable stores; vector cursors) <!-- t:3l9z -->
- [ ] Phase 2: serve the contract's files capability over store trees (project = _stores or an alias) <!-- t:haqi -->
- [ ] Phase 3: registry rows as documents under _stores/<id>/_grants, _bindings, _llm and _people (no mounts) (writes through verbs with ifVersion) <!-- t:prd8 -->
