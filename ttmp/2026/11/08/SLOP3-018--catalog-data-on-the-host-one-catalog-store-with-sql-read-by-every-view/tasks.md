# Tasks

## TODO
- [ ] Phase 0: checks (one store on static and live host; FTS5 query from an actor; stores.open().call() with a binding; CORS site to apps) <!-- t:7f9g -->
- [ ] Phase 1: catalog actor with sql/001_catalog.sql; upsertApp, removeApp, importCatalog (admin-only), catalog_rev; host test; backfill slop.yolo from today's catalog.json <!-- t:lyu7 -->
- [ ] Phase 2: routes /catalog.json, /apps, /apps/:id, feed.xml, llms.txt, search-index.json (ETag, CORS); kit load() and Shelf read the endpoint; host test; browser checks <!-- t:2xgn -->
- [ ] Phase 3: MCP moves into the catalog actor; Curator reads through a binding; 02-deploy.py ships no data; catalog-mcp retired <!-- t:scop -->
- [ ] Phase 4: the SLOP3-013 importer pushes upsertApp/removeApp per release; 01-build-catalog.py retired <!-- t:u0d2 -->
- [ ] Phase 5 (optional): visitor-aware items; a document mirror if a page wants live updates <!-- t:s2v8 -->
