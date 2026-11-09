# Tasks

## TODO
- [x] Phase 0: checks (one store on static and live host; FTS5 query from an actor; stores.open().call() with a binding; CORS site to apps) <!-- t:7f9g -->
- [x] Phase 1: catalog actor with sql/001_catalog.sql; upsertApp, removeApp, importCatalog (admin-only), catalog_rev; host test; backfill slop.yolo from today's catalog.json <!-- t:lyu7 -->
- [x] Phase 2: routes /catalog.json, /apps, /apps/:id, feed.xml, llms.txt, search-index.json (ETag, CORS); kit load() and Shelf read the endpoint; host test; browser checks <!-- t:2xgn -->
- [x] Phase 3: MCP moves into the catalog actor; Curator reads through a binding; 02-deploy.py ships no data; catalog-mcp retired <!-- t:scop -->
- [x] Phase 4: the SLOP3-013 importer pushes upsertApp/removeApp per release; 01-build-catalog.py retired <!-- t:u0d2 -->
- [ ] Phase 5 (optional): visitor-aware items; a document mirror if a page wants live updates <!-- t:s2v8 -->
- [ ] Deploy on slop.yolo: 02-deploy.py --apply; 01-import-catalog.py --from <live catalog.json> --prune --apply; 02-deploy.py --apply; browser checks; then store.rm catalog-mcp <!-- t:q3qu -->
- [ ] Platform: build with -tags sqlite_fts5 (Dockerfile, Makefile, CI test command), or narrow sqlpolicy to what is compiled in (FTS5 is allowed but not built) <!-- t:rkw0 -->
