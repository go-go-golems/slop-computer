# Changelog

## 2026-11-08

- Initial workspace created

## 2026-11-08

Ticket, design doc (data in one store with SQL, pushed by the importer, read over HTTP or one binding), six phase tasks, diary step 1.

## 2026-11-08

Phases 0-4 built (branch task/slop3-018-catalog-data): catalog-data store (SQL, admin writes, public routes with ETag, MCP moved in); views read the API; Shelf and Curator through bindings; deploy ships code only, catalog-data first, readers wait for data; 01-import-catalog.py (backfill or build from host); 03-import.py --catalog. Rehearsed on a local server. Phase 0: no store on both hosts, no FTS5 in the build.

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/apps/catalog-data/actor.js — the catalog's one copy

## 2026-11-08

Deployed on slop.yolo (deploy, backfill 100 apps, deploy): views, Shelf, Curator and MCP read catalog-data; old static data URLs 404; catalog-mcp unmounted
