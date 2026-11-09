---
Title: Diary
Ticket: SLOP3-018
Status: active
Topics:
    - apps
    - sqlite
    - architecture
    - publishing
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/apps/catalog/kit/views.js
      Note: The kit reads the API
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/host/catalog_data_test.go
      Note: Host tests of catalog-data and MCP
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-08T20:53:24.810024444-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Goal

The working record of SLOP3-018: the francois catalog's data moves from a JSON file, built on a laptop and copied into four stores, to SQL tables in the catalog store, which the release importer pushes into and every view reads.

## Step 1: Ticket and design: where the data lives, who writes it, who reads it

The ticket comes from a question the user asked while the restyled catalog was being deployed (SLOP3-015 step 11). Before writing the design I checked the platform's actual cross-store access, which corrected what I had first told the user.

### Prompt Context
**User prompts (verbatim):**
- "3. could we use sql and a db instead of catalog.json? and manage the data \"on the host\" instead of having to check it in? what do you think?"
- "Ok, create a new ticket to build that, and that would allow us to have the same store for all apps, instead of reusing the file multiple times?"
- mid-turn: "explain this: - One platform question is open: whether the catalog actor can read the release stores. …"
**Assistant interpretation:** Create the ticket and a design doc for moving the catalog's data into one store with SQL. Answer whether one store can serve every view. Explain precisely how an actor reads other stores.
**Inferred user intent:** Stop copying the data around; give the catalog a home on the host that the views share.
**Commit (docs):** see `git log` for "SLOP3-018: ticket, design doc, tasks, diary step 1".

### What I did
- **Read the platform's cross-store access:**
  - `pkg/doors/actors/platform.go`: `platformOps` is `stores.create`, `mounts.set` and `grants.set`. There are no reads.
  - `pkg/actor/modules.go`, `storesModule`: `use('stores').open(alias)` needs a binding (`bind.set <store> <alias> <target>`) and a view grant to `store:<id>` on the target. It is checked again on every call, and the target's read rules apply. The handle offers `docs.get` and `docs.query`, `files.text` and `files.list`, `rev`, `log` and `call(action, args)`.
  - `ownPath`: an actor writes only its own store.
- **Read how the catalog's data travels today:**
  - `catalog-mcp/actor.js` and `catalog-curator/actor.js` `require('./data/catalog.json')`;
  - the Shelf page fetches `data/catalog.json`;
  - `02-deploy.py` puts the file into four stores.
- **Checked:**
  - `pkg/actor/memfs.go`: `use('fs')` is in-memory, not the store's served files;
  - `pkg/store/sqlpolicy.go`: migrations may create FTS5 tables;
  - `doc/design/slop-v3.md` §6.4: migrations run at activation;
  - `03-import.py` in SLOP3-013 writes `francois.json`.
- **Ticket and plan:** created SLOP3-018 (`docmgr ticket create-ticket`), a design doc and this diary, and added six phase tasks.

### Why
- **Push, not pull:** pulling needs a binding and a grant per release store (about 100 now, two more per release). The importer already has the admin login and the facts.
- **Endpoint, not a regenerated file:** an actor cannot write its store's served files.

### What worked
- The code answered each question directly. The design doc cites the functions it relies on.

### What didn't work
- **What I first told the user:** that actors reach other stores "only through the platform module". In fact `platform` cannot read, and reads go through `use('stores')` with a binding and a grant. I corrected this in my answer and in the design doc.

### What I learned
- slop already has every piece this needs: SQL with FTS5 through migrations, express routes on actors, cross-store reads and calls through bindings, CORS and rate-limit middleware. Only one question needs a check: whether one store can be mounted on both hosts.

### What was tricky to build
- Nothing yet.

### What warrants a second pair of eyes
- **Moving MCP into the catalog actor retires a store (`catalog-mcp`)** and changes its mount. Its public URL `/catalog/mcp` should keep working, either by mount or by redirect.

### What should be done in the future
- Phase 0's checks, then phase 1.

### Code review instructions
- Read the design doc: the summary, §2 (writes), §3 (reads) and the decisions.

### Technical details
- The design keeps today's item shape in a `facts` JSON column, so the `/catalog.json` endpoint can match the file and no view changes beyond the URL.

## Step 2: Phase 0, the platform checks: three findings that change the design

Before writing any code I checked the design's assumptions against the platform's code. Two of the four checks failed, and a third turned up a constraint on how the mounts must be set. The design stays the same in substance: one store holds the data, the importer pushes, every view reads. What changes is which store, how search works, and the order the deploy sets things in.

### Prompt Context
**User prompt (verbatim):** "Ok, implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Build SLOP3-018 phase by phase (checks, tables and writes, reads, one copy, importer push), committing at milestones, with a detailed diary.
**Inferred user intent:** End with the catalog's data living on the host in one store, no data in the deploy, and a record of how it was built.
**Commit (code):** none in this step (findings only).

### What I did
- **One store on both hosts?** Read `pkg/commands/mounts.go`, `checkMount`. It refuses this: `"%s runs a live app (capabilities or an actor): mount it on a live host"`. The `catalog` store, whose pages are on the static host, cannot gain an actor.
- **FTS5 from an actor?** `pkg/store/sqlpolicy.go` lets migrations create virtual tables only `USING fts5`, but `grep` found no build tag anywhere (Makefile, Dockerfile, workflows). I added a probe test in `pkg/store` (deleted afterwards):
  ```
  $ go test ./pkg/store/ -run TestFTS5Probe -v
      zz_fts5_probe_test.go:17: fts5: no such module: fts5
      zz_fts5_probe_test.go:17: fts4: <nil>
      zz_fts5_probe_test.go:17: fts3: <nil>
  $ go test -tags sqlite_fts5 ./pkg/store/ -run TestFTS5Probe -v
      zz_fts5_probe_test.go:17: fts5: <nil>
  ```
  mattn/go-sqlite3 v1.14.52 compiles FTS5 only with `-tags sqlite_fts5` (`sqlite3_opt_fts5.go`). The server is built without it, so no app can have full-text search today: the policy allows only FTS5, and the binary has only FTS3/4.
- **`stores.open().call()`:** read `storesModule` in `pkg/actor/modules.go`. `call(action, args)` runs the target's action as visitor `store:<caller>` at the level the grant gives, through `a.io` (a promise; the turn continues in a new one). `use('stores')` is never null. `TestActorsEndToEnd` covers binding reads, not `call`, so my tests cover it.
- **CORS:** catalog-mcp's test already proves the `cors` middleware on a live mount.
- **Mount API policies,** which I had not planned to check:
  - `pkg/registry/api.go`: a mount's API policy has `prefix`, `routes` (an allowlist), `responseTypes` (default json and text), and `forwardHeaders` (default content-type, accept, user-agent and referer). It also says "the same app mounted twice can expose two different APIs".
  - `pkg/actor/routes.go`, `checkRoutePolicies`: an actor route that no serving mount allows is a load error. `pkg/actor/manager.go` caches the failure per app version in `m.broken`, until the next push.
  - `pkg/doors/pages/actors.go`: on an API mount, the actor may set Cache-Control, Content-Type and Etag, among others.

### Why
- I read the code instead of trying it on slop.yolo: each question had one function that decides it.

### What worked
- Every question had a definite answer in code, with the exact error message.

### What didn't work
- The design's first assumption (one store on both hosts) and its second (FTS5) are both false on this platform.

### What I learned
- **The data's store:** `catalog-data`, the design's fallback, is a new live store. `catalog` stays pages only.
- **Search:** `instr()` on a lower-case `search` column. This is the views' own semantics (every word is a substring of the title, description, id or tags), and the old MCP server's. FTS5 would have changed results: it matches tokens, so "shader" would not find "shaders" without a prefix query. 100 apps need no index.
- **MCP's URL can stay:** `catalog-data` gets two mounts, `/catalog/api` (data routes) and `/catalog/mcp` (only `POST /` and `GET /`). The old `/catalog/mcp` URL then keeps working, with no redirect.
- **Mount order matters:** because a route-policy failure is cached until the next push, the first mount set must allow every route. So `/catalog/api`'s allowlist includes MCP's `POST /` and `GET /` as well.
- **ETag needs a forwarded header:** for 304s, `/catalog/api` must forward `if-none-match` (it is not a default), and its `responseTypes` must add `application/atom+xml` for the feed.

### What was tricky to build
- Nothing was built. The tricky part was noticing the cached route-policy failure (`m.broken`): without it, setting the two mounts in the wrong order breaks the actor until the next push, with no obvious cause.

### What warrants a second pair of eyes
- **The FTS5 gap is a platform bug, not a catalog problem.** `sqlpolicy.go` promises FTS5 to migrations, and `export.go` rebuilds FTS5 indexes, but no build includes it. Fixing it means adding `-tags sqlite_fts5` to the Dockerfile, the Makefile and the CI test command, so that tests and builds agree. I left it for a separate change.

### What should be done in the future
- Add a task: build with `sqlite_fts5` (or narrow the SQL policy to what is compiled in).

### Code review instructions
- `pkg/commands/mounts.go` `checkMount`; `pkg/store/sqlpolicy.go` the `SQLITE_CREATE_VTABLE` case; `pkg/actor/routes.go`; `pkg/registry/api.go` `MountAPI`, `WithDefaults`.

### Technical details
- The probe was `CREATE VIRTUAL TABLE x USING fts5(a)` on `sql.Open("sqlite3", ":memory:")`, with and without `-tags sqlite_fts5`.

## Step 3: catalog-data: tables, admin writes, read routes and MCP from SQL

`apps/catalog-mcp` became `apps/catalog-data`. It is a live store whose actor keeps the catalog in SQL and serves every read the views and agents need. The MCP server moved in as a module that reads the tables, so it is as fresh as the last write. Both host tests pass on the engine and direct runtimes.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Phase 1 (tables and writes) and the server half of phase 2 (routes).
**Inferred user intent:** see Step 2.
**Commit (code):** e0c1403 — "catalog-data: the catalog's one copy, SQL tables with an actor (SLOP3-018 phases 1-2)"

### What I did
- **`sql/001_catalog.sql`:**
  - `apps`: columns for queries, plus `facts`, the item as JSON without its releases, and `search`, the lower-case haystack;
  - `app_tags`, `app_caps` and `releases`, each `ON DELETE CASCADE`;
  - `catalog_meta`: the rev, the update time and the origins.
- **`catalog.js`** (no store access):
  - `normalize(item)`: the item shape, with today's key order;
  - `haystack`, `words` and `matches`;
  - `atom`, `searchIndex` and `llmsTxt`, ported from `01-build-catalog.py`.
- **`actor.js`:**
  - admin actions: `upsertApp`, `removeApp`, `importCatalog` and `configure`;
  - view actions: `catalog` and `app`;
  - public express routes: `/catalog.json`, `/apps`, `/apps/:id`, `/feed.xml`, `/llms.txt`, `/search-index.json`, and MCP's `POST /` and `GET /`;
  - `fresh()` sets `ETag: "c<rev>"` and `Cache-Control: public, no-cache`, and answers 304 when the ETag matches.
- **`mcp.js`:** catalog-mcp's actor, with the express parts removed and `catalog` replaced by a `lib` of the actor's reads (`catalog()`, `item(id)`, `search(filters)`). The site origin comes from the catalog instead of a hard-coded `https://site.slop.yolo.scapegoat.dev`.
- **`pkg/host/catalog_data_test.go`:** replaces `catalog_mcp_test.go`. `deployCatalogData` sets the store up as the deploy will (both mounts, then the import). `TestCatalogData` covers the data, and `TestCatalogMCPEndpoint` keeps the old MCP checks and adds a few. `mcpCatalog` is renamed `catalogFixture`.
- **Parity, before the Go test, with node against the live `catalog.json`** (`$S/catalog-data/catalog.json`, 100 items):
  - `normalize` returns all 100 items unchanged;
  - `atom` is byte-identical to Python's `atom()` (73,010 bytes);
  - `searchIndex` is byte-identical to `search_index()`, compared by `cmp`;
  - bad items are refused: a `javascript:` link, an unknown field, `free: "yes"` and a bad time.

### Why
- **The item as JSON** keeps `/catalog.json` exactly today's shape, so the views change only the URL. The columns and side tables exist only for `/apps` and MCP.
- **Upsert, not `INSERT OR REPLACE`:** REPLACE deletes the row first, and with `_foreign_keys=on` (`pkg/store/store.go`) the delete cascades the releases away. Releases accumulate across upserts, so they must survive.
- **Unknown fields are refused, not dropped:** the actor defines the shape the views read, and a field silently lost in the importer would be hard to notice.
- **Links must be `https://` or `/…`:** items become hrefs and srcs in twelve pages. Writes are admin-only, but a bad import should not put `javascript:` into a page.
- **`Cache-Control: no-cache` with an ETag,** rather than a max-age: the catalog is then as fresh as the last release, and a revalidation costs one `SELECT` and a 304.

### What worked
- `go test ./pkg/host/ -run TestCatalog -count=1` passes on engine (the default) and with `SLOP_TEST_ACTORS_RUNTIME=direct`. That covers 5 tests, including the unchanged curator, shelf and views tests.
- 304 with an empty body, CORS for the site origin only, `Etag` passed through the API mount, and the feed's `application/atom+xml` allowed by `responseTypes`: all as read in step 2.

### What didn't work
- **First run** (`go test ./pkg/host/ -run 'TestCatalogData|TestCatalogMCPEndpoint'`). Two failures, both in my test assertions:
  - `catalog_data_test.go:196: prune: map[created:1 removed:[weft] rev:4 upserted:1]`. `fmtAny` is `json.Marshal`, so it gave `["weft"]`, not `[weft]`. I now compare the slice.
  - `list_capabilities: {...}` failed on `"name":"sample","apps":2`: Go re-marshals `structuredContent` with sorted keys. I now check the decoded value.
- **Second run:** `catalog_data_test.go:278: GET: 405 {"api":null,…}`. The migration seeded no `api` row in `catalog_meta`, so `setMeta`'s `UPDATE` changed nothing. I fixed it both ways: the migration seeds `('api','')`, and `setMeta` upserts (`INSERT … ON CONFLICT(key) DO UPDATE`), so a key added later needs no migration.

### What I learned
- An express handler's `res.status(304).end()` becomes a bodiless 304 through `toRes` and the pages door, with no extra work.
- `h.call` on `actor.call` returns the action's value, decoded by Go, so numbers are `float64`.

### What was tricky to build
- **Two mounts of one store, with different allowlists.** Every route key must be in some mount's allowlist, or the actor fails to load and stays failed (step 2). `/catalog/api` therefore lists all eight keys. `/catalog/mcp` lists only `POST /` and `GET /`, which the test checks with `GET /catalog/mcp/catalog.json` → 404. `GET /` is MCP's 405 answer on both mounts, and it now also lists the data URLs.

### What warrants a second pair of eyes
- **`importCatalog`'s atomicity:** every item is normalized before the first write, and the action runs in one turn, so a refusal leaves nothing behind. The test checks this with a second item that has no title.
- **`withReleases` for many rows reads every release** (one query), then filters in JS. That is fine for 100 apps and about 150 releases, and it would need a `WHERE app IN (…)` at a larger scale.

### What should be done in the future
- The views, Shelf and Curator read from here (the rest of phase 2, and phase 3).

### Code review instructions
- Start at `apps/catalog-data/actor.js`: `put` (the upsert and the releases), `find`, `catalog`, `fresh`, and the actions.
- Then `catalog.js` `normalize`, then the test.
- Validate: `GOWORK=off go test ./pkg/host/ -run TestCatalog -count=1`, once more with `SLOP_TEST_ACTORS_RUNTIME=direct`.

### Technical details
- **Route keys on `/catalog/api`:** `GET /`, `POST /`, `GET /catalog.json`, `GET /apps`, `GET /apps/:id`, `GET /feed.xml`, `GET /llms.txt`, `GET /search-index.json`.
- **The rest of its policy:**
  - `responseTypes`: `application/json`, `text/plain`, `application/atom+xml`;
  - `forwardHeaders`: `content-type`, `accept`, `user-agent`, `if-none-match`.
- **`/catalog.json`'s top-level keys** are today's (`generated`, `source`, `appsOrigin`, `mcp`, `siteOrigin`, `count`, `totalBytes`, `tags`, `items`) plus `api` and `rev`.

## Step 4: The views read catalog-data. Shelf and Curator go through their bindings

The kit's `load()` now fetches `<API>/catalog.json` from the live host, and every data link on the static pages points at the API. The Shelf and the Curator could not simply fetch the endpoint, as the design had assumed: live pages run on per-store sandbox origins. So each reads the catalog through an action of its own actor, which calls `catalog-data` through a binding.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Phase 2's client half (the views) and phase 3's Curator binding.
**Inferred user intent:** see Step 2.
**Commit (code):** 847077c — "catalog views read catalog-data: kit, links, Shelf and Curator (SLOP3-018 phases 2-3)"

### What I did
- **`apps/catalog/kit/views.js`:**
  - `API` is `<meta name="catalog-api">` if present, else `https://apps.slop.yolo.scapegoat.dev/catalog/api`;
  - `load()` fetches `API + "/catalog.json"`, and still reads `views.json` from the static host;
  - `SlopCatalog.API` is exported.
- **Data links:**
  - the landing page, list, caps and timeline (including the feed's `<link rel="alternate">`, which feed readers find without JavaScript) name the API's URLs as literals;
  - the agents page builds its boxes from `catalog.api`, and gains a Search box (`/apps`).
- **Shelf and Curator:**
  - I read `pkg/doors/pages/sandbox.go`, `views.go` (`sandboxURL`) and `actors.go` (`rpcSlopCall`, `rpcSlopRead`). A live app's page runs in an iframe at `s<label>.<sandbox host>`, one origin per store and app. `slop.call` calls the page's own store's actor; `slop.read` reads an alias's docs and files, not SQL.
  - The Curator's actor gains `catalog` (`requires: 'view'`), which returns `use('stores').open('catalog').call('catalog', {})`. `today` now awaits the same call instead of `require('./data/catalog.json')`.
  - The Shelf gains a one-action `actor.js`, and `"actor": "actor.js"` in `app.json`.
  - Both pages get `slop` from `claude.use` first, then `await slop.actions.catalog({})`. Without slop's runtime (the local preview) they fall back to `data/catalog.json`.
- **Tests:**
  - the curator test deploys catalog-data, sets the binding, checks the `permission_denied` before the grant, then a guest's `catalog` through `slop.call`;
  - the shelf test checks a guest's `catalog`;
  - the views test now ships only `views.json`, and checks that the kit and pages name the API.

### Why
- **Literal URLs in the HTML** (rewritten by the deploy for other hosts), not set by JavaScript: the feed's discovery link must be in the HTML for feed readers.
- **An action through a binding, not CORS for the sandbox origins:** sandbox labels are an HMAC of store and app (`secret_key_file`). Listing them in a CORS config would tie the deploy to a server secret and a label scheme. The binding is the platform's own way to read another store, and its grant is checked on every call.

### What worked
- `go test ./pkg/host/ -run TestCatalog -count=1` passes on engine and on direct.

### What didn't work
- **The design's assumption that the Shelf page "fetches the same endpoint".** It does not hold. The page's origin is `s<label>.sbx…`, so `fetch("/catalog/api/catalog.json")` would reach the sandbox host. I found this by reading the code before running anything, and wrote the binding route instead.

### What I learned
- A live store with only a page (the Shelf) can gain an actor for one cross-store read. Nothing else about the app changes: its capabilities and db rules stay as they were.

### What was tricky to build
- **The page's start-up order.** Both pages used to fetch the catalog before calling `claude.use(...)`. The catalog now needs `slop`, so the `claude.use` line moves up, and its old copy had to be removed from further down. Two edits per page, each checked to occur exactly once.

### What warrants a second pair of eyes
- **A guest's page load now costs two actor calls** (Shelf, then catalog-data, which builds the catalog of 100 items). That is fine at this scale. If it shows, the Shelf's actor could cache by `stores.open('catalog').rev()`.

### What should be done in the future
- N/A for this step.

### Code review instructions
- `apps/catalog/kit/views.js` (the top and `load()`), `apps/catalog-shelf/actor.js`, `apps/catalog-curator/actor.js`, and the two pages' `slop.actions.catalog` lines.
- Tests: `pkg/host/catalog_curator_test.go`, `catalog_shelf_test.go`, `catalog_views_test.go`.

### Technical details
- **The binding each live view needs:**
  ```
  bind.set  <store> catalog catalog-data
  grant.set catalog-data store:<store> view
  ```
- **The cross-store call** (`storesModule.call`) runs catalog-data's `catalog` action as visitor `store:<store>`, at the grant's level (view), under `requires: 'view'`.

## Step 5: The deploy ships code only. The import script. A local rehearsal of the whole migration

`02-deploy.py` lost its data directory: it deploys `catalog-data` first and makes everything that reads the catalog wait until `catalog-data` has apps. The new `01-import-catalog.py` writes the catalog, either from a `catalog.json` (the backfill) or built from the host, and `03-import.py --catalog` calls it after releases. I rehearsed the whole migration on a local server built from this branch, starting from main's layout. It worked: the served catalog equals the live file, and every view, the Shelf, the Curator and MCP read it.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Phases 3 and 4, plus evidence that the migration works before it touches slop.yolo.
**Inferred user intent:** see Step 2.
**Commit (code):**
- 70c9fb3 — "catalog deploy ships code only; import script; importer --catalog (SLOP3-018 phases 3-4)"
- b62f864 — "SLOP3-018 scripts/02-local-fixtures.py: what the catalog build reads, on a local server"

### What I did
- **`02-deploy.py`:**
  - `stores(hosts)` lists `catalog-data` first, with two mounts and a `configure` (the origins). Then come `catalog` (with `views.json` from the script's own `VIEWS`), the views, and the Shelf and Curator with `binds`.
  - `needs: catalog-data` makes an entry, or a mount, wait while `catalog-data`'s `catalog` action counts 0 apps.
  - `replaces: catalog-mcp` lets `/catalog/mcp` change stores.
  - Bindings are diffed with `bind.ls`, and target grants with `grant.ls`.
  - `--scheme http` targets a local server. `rewrite()` turns slop.yolo's two origins into the target's in `.html` and `.js` files, and the kit's `?v=` stamp is hashed after the rewrite.
- **`01-import-catalog.py`:**
  - `item()` and `history()` come from `01-build-catalog.py`; `history` is keyed by store id.
  - `build()` reads the release stores, their `francois.json` and boutique's covers.
  - `sync()` plans against the `catalog` action, and writes per id (`--only`: `upsertApp`/`removeApp`) or all at once (`importCatalog`, `--prune`).
- **`03-import.py --catalog`:** loads that script by path (`parents[5]` is `ttmp/`), and runs `build` and `sync` for the plan's stores, with the inventory's history.
- **Retired and adjusted:**
  - `01-build-catalog.py` is deleted;
  - `03-devserve.py` serves `/catalog/api/catalog.json` from its data dir and rewrites the kit's API.
- **The local server** (`$S/lslop`):
  - a binary built from this branch;
  - `slop serve --local --listen 127.0.0.1:18490 --data $S/lslop/data --admin-email admin@example.com`;
  - a wrapper `lslop` with its own `SLOP_CREDENTIALS`. The token came from `slop auth login`'s device flow, approved through the local sign-in form in Playwright.
- **The rehearsal, in order:**
  1. main's `02-deploy.py` and `$S/catalog-data-prod` (the live data downloaded on 2026-11-09): the before state, with catalog-mcp at `/catalog/mcp`;
  2. the new deploy's dry run;
  3. the first pass: catalog-data created and mounted at `/catalog/api`, everything else "waits until catalog-data has apps";
  4. the backfill `--from catalog.json --prune --apply`: 100 upserted, and a second dry run finds "0 new, 0 changed, 100 the same";
  5. the second pass: `/catalog/mcp` moves "(from catalog-mcp)", 12 static stores pushed, 2 bindings and 2 grants set;
  6. the third pass: all "up to date".
- **The build-from-host path:**
  - `02-local-fixtures.py` makes boutique's covers file and release stores from the inventory, for a free app, an app for subscribers and one with several releases;
  - `01-import-catalog.py --only … --history inventory --apps-origin https://apps.slop.yolo.scapegoat.dev` gives "3 the same";
  - an apply with the local origin gives `upsertApp claude-computer` and `removeApp shop-next`, the second having no release store locally;
  - `03-import.py inventory --only lattice-deck --catalog` (dry run) plans "1 changed".

### Why
- **`catalog-data` first, readers waiting:** without it, the first deploy would switch the views to an API with no data, and point `/catalog/mcp` at an empty catalog, until someone ran the import.
- **A real local server, not slop.yolo, for the rehearsal:** the deploy rewires mounts and removes files. The local server shows the exact plan and result first.

### What worked
- **The served `/catalog/api/catalog.json` against the live `catalog.json`:**
  - items equal, in order and content;
  - tags, count, totalBytes and source equal;
  - only `api` and `rev` added;
  - headers `Etag: "c2"` and `Cache-Control: public, no-cache`.
- **In the browser (Playwright), all eleven views loaded 100 apps across origins from `http://site.localhost:18490`.** The only failed requests were 18 cover images under `/_d/` on the list page, from francois's media store, which the local server doesn't have.
- **A reload sends `If-None-Match: "c2"` with its `Origin`** (the 304 itself is covered by the host test).
- **The Shelf (sandbox frame `s92f39d4d8760a68c4c8e.sbx.localhost`) shows 100 apps,** and the Curator, for a guest, three picks seeded by the date.
- **The agents page's MCP client:** "connected: slop catalog, protocol 2025-06-18, 4 tools", and "Call tool" returns results. Screenshot: `various/screenshots/01-agents-local.png`.
- **`go test ./... -count=1`** passes in full on engine; `pkg/host` passes on direct (17 s).

### What didn't work
- `$S/lslop/lslop login …` gave `Error: unknown command "login" for "slop"`. The command is `slop auth login`.
- **A zsh separator:** `echo ===` failed with `(eval):1: == not found` (zsh's `=cmd` expansion). The dry run before it had already printed. I reran with `---`.
- **`02-local-fixtures.py`, first run:** `IndexError: list index out of range` on `found[0]`. I had used `parents[4]` (the year directory) instead of `parents[5]` (`ttmp/`).
- **`02-local-fixtures.py`, second run:** `IndexError` on `rel = pub[-1]` for `aasd`, an artifact with no published release. It now skips such ids.
- **Playwright:** `browser_type`/`browser_click` needed `target`, not `ref`. A screenshot path in the scratchpad was refused ("outside allowed roots"), so I saved under `.playwright-mcp/` and moved it into the ticket.
- **One check, `locator('main').innerText`, timed out** on a view without `<main>`. I switched to `document.body.innerText`.
- **Two problems the rehearsal surfaced and I fixed before the commit:**
  - **`http` on a local server:** the actor accepted only `https` origins and links, and the deploy wrote `https://` everywhere. `catalog.js` now accepts `http` only on `*.localhost` hosts, and the deploy has `--scheme`.
  - **`//evil.example/x` passed as a "path on the site host":** it is a protocol-relative link to another host, and it was there from step 3. `PATH` now refuses a second leading slash, and `TestCatalogData` refuses a cover `src` of `//evil.example/x.png`.

### What I learned
- The static host answers 421 to `curl -H "Host: site.localhost:18490" http://127.0.0.1:18490/…`. `curl http://site.localhost:18490/…` resolves to loopback and works.
- A cross-origin resource without `Timing-Allow-Origin` shows `transferSize: 0`, so resource timing cannot tell a 304 from a cache hit. Request headers can.

### What was tricky to build
- **The deploy's ordering:**
  - **Inside `catalog-data`:** `/catalog/api` (every route) must be set before `/catalog/mcp`, because of the cached route-policy failure (step 2). `/catalog/mcp` also needs data, so it waits.
  - **Across stores:** readiness is a cached count, refreshed after `catalog-data`'s own steps, so the same run can't skip ahead.
- **`same()` in the import plan:** without `--history`, a built item has no releases, while the served one does. Comparing them as they are would report every app as changed, so the releases are compared only when the built item has them.

### What warrants a second pair of eyes
- **`replaces: catalog-mcp`** is the one place the deploy takes a mount from another store. Afterwards `catalog-mcp` stays as an unmounted store, and the script says so; deleting it is left to the user.
- **The first apply of the new deploy removes `data/catalog.json`, `feed.xml`, `search-index.json` and `llms.txt` from the static host.** Their old URLs (`site…/catalog/data/…`, `site…/catalog/llms.txt`) then answer 404. They are two days old; the agents page lists the new ones.

### What should be done in the future
- Deploy to slop.yolo with the three-step order (deploy, import, deploy). This needs the user's go-ahead.
- `store.rm catalog-mcp` after that, and the FTS5 build tag (step 2).

### Code review instructions
- `ttmp/…SLOP3-015…/scripts/02-deploy.py`: `stores()`, `ready()`, the mounts loop and `rewrite()`.
- `ttmp/…SLOP3-018…/scripts/01-import-catalog.py`: `build`, `same`, `plan` and `sync`.
- `03-import.py`: `catalog_module` and `catalog_sync`.
- To repeat the rehearsal: build `slop`, `serve --local` on a free port, log in with its own `SLOP_CREDENTIALS`, then run the six steps above with `--static site.localhost:PORT --live apps.localhost:PORT --scheme http`.

### Technical details
- **The first deploy on slop.yolo:**
  ```
  02-deploy.py <repo> --apply
  01-import-catalog.py --from <catalog.json> --prune --apply
  02-deploy.py <repo> --apply
  ```
  The `catalog.json` can be `$S/catalog-data-prod/catalog.json`, or the host-built catalog: no `--from`, with `--history inventory.json`.
- **Logs:** `$S/lslop/deploy-dry.log`, `deploy-pass1.log` and `deploy-pass2.log`.

## Step 6: PR #41, and Codex's finding: names from Object.prototype as data

I opened PR #41 (branch `task/slop3-018-catalog-data`). Codex's first review had one finding, and it was right: the actor grouped releases in a plain object keyed by app id, so an app named `constructor` broke every catalog read. Two more lookups had the same pattern. All three now use `Map`, and a test imports such an app: 500 before the fix, 200 after.

### Prompt Context
**User prompt (verbatim):** see Step 2.
**Assistant interpretation:** Put the work up for review, as in earlier tickets, and answer the reviews.
**Inferred user intent:** see Step 2.
**Commit (code):** 6a3075a — "catalog-data: data-keyed lookups are Maps (Codex on #41)"

### What I did
- **Pushed and opened the PR:** pushed the branch (the pre-push hooks passed), and opened https://github.com/go-go-golems/slop-computer/pull/41. The body covers what changed, what phase 0 changed, the tests, and the deploy order, which is not done yet.
- **Waited for Codex,** with a background loop on the bot comment's `codex-review-state:v1` for the head SHA: `status=completed after 5 checks` on 405dc93. One inline comment, 4509227757 (P2), on `apps/catalog-data/actor.js:46`: "Use a prototype-free map to group releases by app ID".
- **Looked for the same pattern elsewhere** with `grep -n "byApp\|const n = {}\|CAPS\[c\]"`. The tag counts in `catalog()` and MCP's `list_capabilities` counts are plain objects keyed by data as well.
- **Fixed all three:** `withReleases`'s `byApp`, `catalog()`'s tag counts and `list_capabilities`'s counts are now `Map`s, and `CAPS[c]` is read with `hasOwnProperty`.
- **Test:** `TestCatalogData` upserts an app with id `constructor`, tags `constructor`, `__proto__` and `toString`, and capability `hasOwnProperty`. It checks `/catalog.json` (count, the tags counted once each), `/apps/constructor` (with its release), and MCP's `list_capabilities` at `/catalog/api/` (`"meaning":""`). Then it removes the app.
- **Showed the test catches the bug:** with HEAD's `actor.js` and `mcp.js` swapped in (copies backed up in `$S/bak41`, then restored), it fails with `catalog_data_test.go:191: prototype names: 500 <nil>`.

### Why
- Ids and tags come from francois's artifacts: they are data, and `normalize` accepts `constructor` as an id and `__proto__` as a tag. A tag `__proto__` would have done worse than throw: `n['__proto__'] = …` sets the object's prototype.

### What worked
- `go test ./pkg/host/ -run TestCatalog -count=1` passes on engine and direct.

### What didn't work
- My own review missed this in step 3. Nothing failed while fixing it.

### What I learned
- In actor JS, any object keyed by an id, tag or name that comes from data should be a `Map` (or `Object.create(null)`).

### What was tricky to build
- **Checking the test against the old code without `git stash`:** the stash is shared with other sessions, so I swapped the files from `git show HEAD:…` and restored them from scratchpad copies.

### What warrants a second pair of eyes
- `catalog.js` builds no data-keyed objects (it uses `Set` and arrays), and `mcp.js`'s `TOOLS.find` compares names. Those are the only other places data meets property names.

### What should be done in the future
- A re-review by Codex on the fix.

### Code review instructions
- `git show 6a3075a`; validate with `GOWORK=off go test ./pkg/host/ -run TestCatalogData -count=1`.

### Technical details
- The finding: "If an imported app has the valid store ID `constructor` and a release, `byApp[r.app]` resolves to the inherited `Object` constructor rather than an empty entry, so `.push()` throws."

## Step 7: Deployed on slop.yolo: deploy, backfill, deploy, checks

After the user merged #41 (f5bc6b2) and said yes to the deploy, I ran the three steps on slop.yolo from the merged tree. The result matches the local rehearsal. The served catalog equals the live file. Every view, the Shelf, the Curator and MCP read `catalog-data`, and the old static data URLs answer 404. `catalog-mcp` is unmounted but still exists.

### Prompt Context
**User prompts (verbatim):**
- "I merged #41 btw."
- The answer to "Should I deploy the new catalog layout to slop.yolo now …?" was "Yes, deploy now (Recommended)".
**Assistant interpretation:** Run the first deploy (deploy, import, deploy) on slop.yolo and check it end to end.
**Inferred user intent:** Have the new layout running on staging.
**Commit (code):** none (deploy only); the code is f5bc6b2 on main.

### What I did
- **Preconditions:**
  - `git diff --stat HEAD origin/main` was empty in the `slop018` worktree (its branch tip, 4111421, has the merge's tree);
  - the default login is `https://slop.yolo.scapegoat.dev`, read from the credentials file without printing the token;
  - a fresh `site…/catalog/data/catalog.json` (100 apps, generated 2026-11-07T02:03:54Z) equals the copy used in the rehearsal.
- **The three steps.** Logs are in `various/deploy-2026-11-09/`, numbered 01–08.
  1. **`02-deploy.py .` (dry run, then `--apply`):**
     - `catalog-data`: store.new, files.push (5 files), grant `@guest view`, mount `/catalog/api`, configure (origins), giving snapshot 1;
     - everything else waits.
  2. **`01-import-catalog.py --from catalog.json --prune` (dry run, then `--apply`):** `importCatalog: 100 upserted (100 new), removed [], rev 2`. A second dry run gives "0 new, 0 changed, 100 the same".
  3. **`02-deploy.py .` again (dry run, then `--apply`):**
     - `/catalog/mcp` moves "(from catalog-mcp)";
     - `catalog` pushed (6 changed: the four data files removed, plus `index.html` and `kit/views.js`), and each view's `index.html`;
     - Shelf and Curator: files, bind.set and grant.
     A third dry run: every store "up to date".
- **HTTP checks** (`07-http-checks.log`):
  - `site…/catalog/` 200 and `data/views.json` 200; `data/catalog.json` 404 and `llms.txt` 404;
  - `apps…/catalog/api/` `catalog.json`, `/apps?q=shader`, `/apps/claude-computer` and `search-index.json` 200 `application/json`; `feed.xml` 200 `application/atom+xml`; `llms.txt` 200 `text/plain`;
  - `/catalog/mcp` GET 405, as designed;
  - CORS: allowed for `https://site.slop.yolo.scapegoat.dev`, none for `https://evil.example`;
  - `If-None-Match: "c2"` gives 304.
- **The served `catalog.json` against the file:** items equal, tags equal, count 100, extra keys `api` and `rev`, `ETag "c2"`, `Cache-Control: public, no-cache`.
- **MCP:** `uvx --with mcp python -I 04-mcp-check.py https://apps.slop.yolo.scapegoat.dev/catalog/mcp` reports `server: slop-catalog 2025-06-18`, the four tools, `get_app weft`, and five room apps.
- **Browser (Playwright):**
  - the landing page and all 11 views report `SlopCatalog.API = https://apps.slop.yolo.scapegoat.dev/catalog/api`, `count 100`, and no response with status ≥ 400, covers included;
  - the agents page's "Call tool" returns results;
  - the Shelf's sandbox frame shows 100 apps, and the Curator, for a guest, three picks seeded by the date;
  - screenshot: `various/screenshots/02-landing-yolo.png`.

### Why
- **The dry run before each apply,** to compare the plan with the rehearsal's before writing to staging. Each plan matched.

### What worked
- Everything above, on the first try.
- `data/views.json` was not in pass 2's change list, so the deploy's own `VIEWS` list reproduces the file `01-build-catalog.py` wrote, byte for byte.

### What didn't work
- No failures. One check came back empty: the Playwright locator `text=connected`. The "Call tool" output was there, so the client was connected.

### What I learned
- On slop.yolo the covers load, because francois's media store exists there. Locally they were the only 404s.

### What was tricky to build
- N/A (the order and the waits were settled in the rehearsal, step 5).

### What warrants a second pair of eyes
- **Browsers that cached the old pages:** the static host lets them keep a page for up to 11 minutes (60 s, then stale for 600 s), so they may show the old views until then. The old pages fetch `data/catalog.json`, which is now 404.

### What should be done in the future
- `store.rm catalog-mcp`, when the user agrees. It is unmounted and holds only the old actor and a copy of the data.
- The FTS5 build-tag task (`rkw0`).
- Point 03-import.py's runbook at `--catalog`, so that the next release lands in the catalog.

### Code review instructions
- Read the logs in `various/deploy-2026-11-09/` in order. To check again: `curl -s https://apps.slop.yolo.scapegoat.dev/catalog/api/catalog.json | jq .count`, and `02-deploy.py .` should report everything up to date.

### Technical details
- `catalog-data` on slop.yolo: rev 2, 100 apps; mounts `apps.slop.yolo.scapegoat.dev/catalog/api` and `/catalog/mcp`.
