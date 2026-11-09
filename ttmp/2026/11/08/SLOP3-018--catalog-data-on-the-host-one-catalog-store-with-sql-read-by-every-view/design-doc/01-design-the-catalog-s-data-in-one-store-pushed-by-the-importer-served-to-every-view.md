---
Title: 'Design: the catalog''s data in one store, pushed by the importer, served to every view'
Ticket: SLOP3-018
Status: active
Topics:
    - apps
    - sqlite
    - architecture
    - publishing
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/apps/catalog-mcp/actor.js
      Note: 'Today''s MCP actor: express routes over a bundled catalog.json copy'
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/actor/modules.go
      Note: 'storesModule: cross-store reads through a binding and a grant to store:<id>'
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/commands/actors.go
      Note: 'bind.set: the read alias a consumer store needs'
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/doors/actors/platform.go
      Note: 'platformOps: stores.create, mounts.set and grants.set only (no reads)'
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/store/sqlpolicy.go
      Note: Migrations may create FTS5 tables
ExternalSources: []
Summary: The francois catalog moves from a JSON file, built on a laptop and uploaded into four stores, to SQL tables in the catalog store. The release importer pushes into them, and every view reads them over HTTP or through a store binding.
LastUpdated: 2026-11-08T21:05:00-05:00
WhatFor: Deciding and building where the catalog's data lives and how the views reach it.
WhenToUse: Before changing the catalog views' data loading, the release importer, or the catalog deploy.
---

# Design: the catalog's data in one store, pushed by the importer, served to every view

## Executive Summary

Today the catalog of the 100 francois apps is a file. `01-build-catalog.py` builds `catalog.json` on a laptop from the release stores, using the admin's login. `02-deploy.py` then uploads it, with four other derived files, into four stores (`catalog`, `catalog-mcp`, `catalog-shelf` and `catalog-curator`), and every deploy has to carry the data along with the code.

This design moves the data onto the host. The `catalog` store gets an actor with SQL tables (with FTS5 for search), and the release importer **pushes** each app into it through admin-only actions. Every view then reads that one copy:
- the static views and the Shelf page fetch the actor's HTTP endpoints, including one in today's `catalog.json` shape, so the views change one URL;
- the MCP server becomes routes on the same actor;
- the Curator's actor reads through a store binding.

After this, the deploy ships only code, nothing has to be built on a laptop, and the data is as fresh as the last release.

## Problem Statement

The catalog's data has no home on the host:

- **It is built off the host.** `ttmp/2026/11/06/SLOP3-015…/scripts/01-build-catalog.py` reads `store.ls --all`, every release store's `francois.json` and boutique's `_data/francois-catalog.json` with the admin's CLI login, and writes five files: `catalog.json`, `views.json`, `feed.xml`, `search-index.json` and `llms.txt`.
- **It is copied four times.** `02-deploy.py` puts `data/catalog.json` into `catalog` (with the other four files), `catalog-mcp`, `catalog-shelf` and `catalog-curator`. The MCP and Curator actors `require('./data/catalog.json')` at load. The pages `fetch()` it.
- **It is only as fresh as the last manual run.** A new release appears in the catalog only after someone rebuilds and redeploys. The 2026-11-09 deploy had to download the live data first, so as not to change it by accident.
- **It is queried on the client only.** Search, filters and sorting run in each view's JavaScript, and the MCP actor searches its own bundled copy.

## Proposed Solution

### 1. The data: SQL tables in the `catalog` store

The `catalog` app gains an actor (`apps/catalog/actor.js`) and migrations (`apps/catalog/sql/001_catalog.sql`). Each migration runs once, at activation, in one transaction, and is recorded in `_migrations` (`doc/design/slop-v3.md` §6.4). Migrations may create FTS5 tables (`pkg/store/sqlpolicy.go`, `CallerMigration`).

```sql
CREATE TABLE apps (
  id TEXT PRIMARY KEY,          -- the release store id
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  version TEXT, published_at TEXT, bytes INTEGER,
  free INTEGER NOT NULL,        -- 0: for subscribers
  featured INTEGER NOT NULL DEFAULT 0,
  open_url TEXT, preview_url TEXT, download_url TEXT,
  cover TEXT,                   -- JSON {src, width, height} or NULL
  facts TEXT NOT NULL,          -- the item as the views read it (JSON), the source of truth for the endpoints
  updated_at TEXT NOT NULL
);
CREATE TABLE app_tags (app TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (app, tag));
CREATE TABLE app_caps (app TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE, cap TEXT NOT NULL, PRIMARY KEY (app, cap));
CREATE TABLE releases (app TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE, version TEXT NOT NULL, published_at TEXT, changelog TEXT, PRIMARY KEY (app, version));
CREATE VIRTUAL TABLE apps_fts USING fts5(id UNINDEXED, title, description, tags);
```

`facts` keeps the whole item as the views read it today, so the `catalog.json` endpoint can return exactly what the views expect. The columns and side tables exist for queries: filtering by tag or capability, sorting, and search.

### 2. Writes: the importer pushes

The actor has admin-only actions (each checks `ctx.visitor.level === "admin"`):

| Action | Does |
|---|---|
| `upsertApp(item)` | Validates one item (today's `catalog.json` item shape) and replaces its rows and its FTS row |
| `removeApp({id})` | Removes an app that is no longer listed |
| `importCatalog({items, prune})` | Many `upsertApp`s in one turn. With `prune`, it removes apps not in `items` |

Each action records a `catalog_rev` (a counter in a one-row table), which becomes the endpoints' ETag.

**Who calls them:**
- **The SLOP3-013 importer** (`ttmp/…SLOP3-013…/scripts/03-import.py`), which writes each release store's `francois.json`. After a release, it calls `actor.call catalog upsertApp` with the item. The item-building logic moves from `01-build-catalog.py` into a shared helper that both use.
- **A backfill**, once: `scripts/01-backfill.py` sends today's `catalog.json` to `importCatalog`.
- **By hand:** `slop actor call catalog upsertApp …` or `importCatalog`.

### 3. Reads: one copy, three ways in

**HTTP routes on the catalog actor.** The actor uses `require('express')`, as `catalog-mcp` does. All routes are `.public()`, rate-limited per IP, with CORS for the site host:

| Route | Returns |
|---|---|
| `GET /catalog.json` | Today's `catalog.json` shape (items ordered as now, the tags with counts, `count`, `totalBytes`, the origins) |
| `GET /apps?q=&tag=&cap=&free=&sort=&limit=&offset=` | A page of items. `q` searches FTS5 |
| `GET /apps/:id` | One item, with its releases |
| `GET /feed.xml`, `/llms.txt`, `/search-index.json` | Built from the tables on request; today `01-build-catalog.py` writes them |
| `POST /mcp` | The MCP server, moved here from `catalog-mcp` (same tools, read from SQL) |

Responses carry `ETag: "<catalog_rev>"` and `Cache-Control: public, max-age=60, must-revalidate`, so a browser revalidates cheaply.

**Who reads what:**
- **The static views** (`catalog` and the 11 view stores): the kit's `load()` fetches `<api>/catalog.json` instead of `/catalog/data/catalog.json`. The `<api>` origin is in `views.json`, or in a `<meta>` tag the deploy writes. Nothing else in the views changes.
- **The Shelf page** fetches the same endpoint. Its stars and shelves stay in its own db.
- **The Curator actor:** `use('stores').open('catalog')`, then `.call('apps', {…})`, or the `facts` of all apps through an action. This needs `bind.set catalog-curator catalog catalog` and `grant.set catalog store:catalog-curator view`, which make one binding and one grant (`pkg/actor/modules.go`, `storesModule`; `pkg/commands/actors.go`, `bind.set`).
- **MCP:** the routes above. The `catalog-mcp` store is retired, and its live-host mount `/catalog/mcp` points at `catalog`, or redirects to `/catalog/api/mcp`.

### 4. Mounts

The `catalog` store's pages stay on the static host at `/catalog`. Its actor's routes need a live-host mount, `apps.slop.yolo.scapegoat.dev/catalog/api`, pointing at the same store with an API policy (`routes`, `defaultMin: public`, rate limit, CORS). Phase 0 checks that one store can be mounted on both hosts. If it cannot, the data lives in a new store, `catalog-data` (actor and SQL), and `catalog` stays pages only. That changes nothing else in this design.

### 5. What the deploy becomes

`02-deploy.py` drops every `extra` data file. It ships code (pages, the kit, the actor, `sql/`), grants, policies, mounts and the bindings above. It never uploads data again, and `01-build-catalog.py` retires: its logic lives on in the importer's helper.

## Design Decisions

1. **Push, not pull.** For the catalog's actor to read about 100 release stores, it would need one `bind.set` and one `grant.set … store:catalog view` per store. Every new release would need both, since there is no grant for "every release store". The importer already holds the admin login and the facts, so pushing costs one call per release and no new grants.
2. **SQL tables, plus the item as JSON.** The tables answer queries (tag, capability, sort, FTS5 search). The `facts` JSON keeps today's item shape exact, so no view has to change beyond the URL.
3. **One store owns the data. The others read it over HTTP or through one binding.** Actors write only their own store (`ownPath` refuses other stores), so the copies cannot be kept in sync by writes anyway. Reading the one copy removes the problem.
4. **The MCP server moves into the catalog actor.** It is a read interface to the same data. A separate store only meant a separate copy.
5. **The static views fetch an endpoint, not a regenerated file.** An actor cannot write its store's served files: `use('fs')` is an in-memory tree that the actor owns (`pkg/actor/memfs.go`). The endpoint returns the same shape, with an ETag.

## Alternatives Considered

- **Pull with bindings** (the catalog actor reads every release store): works with today's platform, but costs about 100 bindings and 100 grants, and two more per new release. Rejected for that bookkeeping.
- **Keep the laptop build, but write into SQL** (`01-build-catalog.py` calls `importCatalog` instead of writing files): a fine first step, and the backfill is exactly this. As the end state it leaves freshness manual.
- **A platform grant like "read every store of type release"**: a new access concept for one consumer. Not needed if the importer pushes.
- **Documents (`apps/<id>`) instead of SQL:** pages could subscribe to them live, and a binding with `--prefix` would let pages read them directly. But filters, sorts and full-text search are SQL's strength, and no view needs live updates of the catalog. A document mirror can be added later if one does.
- **The actor writes a snapshot `catalog.json` into the static store:** not possible (actors write only their own store, and `fs` is in-memory). It would also bring back a second copy.

## Implementation Plan

**Phase 0: checks.**
- A store mounted on the static host (files) and the live host (API) at once.
- An FTS5 query from an actor (`CallerActorRead`) on a migration's virtual table.
- `stores.open(…).call()` from a live store into `catalog` with a binding and grant.
- CORS from `site.` to `apps.` with the `cors` middleware (catalog-mcp already does this).

**Phase 1: tables and writes.**
- `apps/catalog/sql/001_catalog.sql`, `actor.js` with `upsertApp`, `removeApp` and `importCatalog` (admin-only), and `catalog_rev`.
- Go host test: import, upsert, remove, admin-only, FTS search.
- The backfill script. Deploy, then backfill slop.yolo.

**Phase 2: reads.**
- Routes: `/catalog.json`, `/apps`, `/apps/:id`, the feeds.
- The kit's `load()` and the Shelf read the endpoint.
- Host test: shape equal to today's file, ETag, CORS.
- Browser checks on every view.

**Phase 3: one copy.**
- MCP moves into the catalog actor (tools unchanged; host test like `catalog_mcp_test.go`).
- The Curator reads through a binding.
- `02-deploy.py` drops all data `extra`s, adds the bindings, grants and the API mount, and retires `catalog-mcp`.

**Phase 4: push from the importer.**
- `03-import.py` calls `upsertApp` after each release (and `removeApp` on unlisting).
- `01-build-catalog.py` retires.

**Phase 5 (optional):**
- Items that depend on the visitor (links for subscribers).
- A document mirror, if a page wants live updates.

## Open Questions

1. Can one store be mounted on both the static and the live host? (Phase 0. If not, use `catalog-data`.)
2. Does `views.json` (the list of views) move into SQL as well, or stay a file in `catalog`? It is code-like (it changes with the views), so the proposal keeps it a file.
3. Should `upsertApp` also accept a release store id and read `francois.json` itself, through a binding the importer sets for that one store? (A later convenience. Not needed for push.)

## References

- `ttmp/2026/11/06/SLOP3-015--…/scripts/01-build-catalog.py` (today's build), `02-deploy.py` (today's deploy), `reference/01-diary.md` steps 5–11.
- `ttmp/2026/11/06/SLOP3-013--…/scripts/03-import.py`: the release importer, the push's caller.
- `apps/catalog-mcp/actor.js` (express routes, `require('./data/catalog.json')`), `apps/catalog-curator/actor.js`, `apps/catalog-shelf/index.html` (`fetch("data/catalog.json")`).
- `pkg/actor/modules.go`: `storesModule` (`open`, `docs`, `files`, `call`; reads as `store:<id>`, checked on every call); `ownPath` (writes only to the actor's own store).
- `pkg/doors/actors/platform.go`: `platformOps` holds only `stores.create`, `mounts.set` and `grants.set`.
- `pkg/commands/actors.go`: `bind.set` (alias, `--prefix`, `--assets`).
- `pkg/actor/database.go` (`use('database')`, SQL in the turn), `pkg/store/sqlpolicy.go` (migrations, FTS5), `pkg/actor/memfs.go` (`fs` is in-memory).
- `doc/design/slop-v3.md` §6.4: migrations at activation.
