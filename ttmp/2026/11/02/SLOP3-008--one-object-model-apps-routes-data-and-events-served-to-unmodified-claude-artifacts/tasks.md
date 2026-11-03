# Tasks

## TODO
- [x] Decide the open question left (design §10): writable registry docs (2); decided: 1 delegated reads (not now), 3 mounts (not mapped), 4 reserving _ (yes), 5 depth (18), 6 registry docs (not live), 7 assets (aliases only) <!-- t:zfna -->
- [x] Phase 1: data and assets across stores (reserve top-level _; aliases with to, level, as, assets; _stores for approved apps; caps/db shared by pages and actors; /_blob across reachable stores; vector cursors) <!-- t:3l9z -->
- [x] Phase 2: serve the contract's files capability over store trees (project = _stores or an alias) <!-- t:haqi -->
- [x] Phase 3: registry rows as documents under _stores/<id>/_grants, _bindings, _llm and _people (no mounts) (writes through verbs with ifVersion) <!-- t:prd8 -->
- [x] Phase 4: alias templates on mounts (mount.set --aliases, applied by /_site/create) <!-- t:la5f -->
- [x] Phase 5: Durable-Object-shaped storage for actors (use('storage') / ctx.storage) <!-- t:fv7r -->
- [x] Phase 6: one owning process per store — deliberately not built while v3 runs one process (design §9) <!-- t:l7s3 -->
