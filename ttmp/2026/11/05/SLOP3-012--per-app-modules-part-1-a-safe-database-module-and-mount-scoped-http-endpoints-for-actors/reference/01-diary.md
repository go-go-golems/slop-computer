---
Title: Diary
Ticket: SLOP3-012
Status: active
Topics:
    - goja
    - apps
    - architecture
    - security
    - routing
    - hosting
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-05T19:42:35.25094165-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The chronological record of SLOP3-012: the first implementation of per-app modules in slop, a `database` module with go-go-goja's JavaScript API over the actor's own store, and an express-style HTTP module whose routes are bounded by a policy on the mount. The research and the decisions behind it are in SLOP3-011 (its diary, Steps 1–8).

## Step 1: The ticket and the intern guide

The user asked for a new ticket and a detailed guide for a new intern: what the system is, every part needed to understand it, and the design and implementation plan, with prose, bullets, pseudocode, diagrams, API and file references, then uploaded to the reMarkable. SLOP3-011 keeps the research. This ticket is for the implementation, starting with the guide.

### Prompt Context
**User prompt (verbatim):** "Alright, create a new docmgr ticket and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**Assistant interpretation:** Create SLOP3-012; write an intern-level analysis, design and implementation guide for per-app modules (database and mount-scoped HTTP first); store it in the ticket; upload it to the reMarkable.
**Inferred user intent:** A document someone new can read on paper and then implement from.

### What I did
- `docmgr ticket create-ticket --ticket SLOP3-012 --title "Per-app modules part 1: a safe database module and mount-scoped HTTP endpoints for actors" --topics goja,apps,architecture,security,routing,hosting`; `docmgr doc add` for the design doc (`design-doc/01-intern-guide-…`) and this diary.

### Why
- Separate tickets keep the research record (SLOP3-011) apart from the implementation work and its tasks.

### What worked
- Ticket created at `ttmp/2026/11/05/SLOP3-012--per-app-modules-part-1-a-safe-database-module-and-mount-scoped-http-endpoints-for-actors`.

### What didn't work
- No failures observed.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Write the guide (Step 2) and upload it.

### Code review instructions
- N/A.

### Technical details
- Related: SLOP3-011 diary, and the vault report "PROJECT REPORT - slop v3 - Per-App Modules - Safe Database and HTTP Endpoints for Sandboxed Actors - A Technical Deep Dive".

## Step 2: The intern guide, written, reviewed and uploaded

The writer agent that had just written the SLOP3-011 vault report, and so had read all four repositories, wrote the guide into `design-doc/01-intern-guide-…`. It is organized in five parts: the system, go-go-goja background, the design, a five-phase implementation plan, and an API reference. It has 14,487 words (11,187 outside code blocks) and five mermaid diagrams. I reviewed the outline, spot-checked four of its new code claims, committed it, and uploaded it to the reMarkable.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Write the guide, store it in the ticket, upload it.
**Inferred user intent:** A paper-readable document to review the design and to implement from.
**Commit (docs):** `4f61410` — "SLOP3-012: intern guide (analysis, design, implementation plan for database and mount-scoped HTTP endpoints)"

### What I did
- Briefed the writer with the parts and requirements: dependency-ordered orientation, one running example (the journal's `GET /feed.json`, then rewritten with `database` + `express` under an API mount), decision records, file-by-file phases with pseudocode and tests, API tables, glossary, pandoc-friendly layout. I also gave it the seven corrections from SLOP3-011 Step 9.
- Reviewed the outline (41 sections) and checked these claims against `/tmp/slop011` (origin/main):
  - `pkg/actor/manager.go:172-174`: a broken build is cached in `m.broken`, and only `Restart` deletes it (`manager.go:261-264`).
  - `pkg/actor/inbox.go:7,36`: `inboxLimit = 256`, `"the actor is busy"`.
  - `pkg/commands/mounts.go:140-143`: `checkMount` accepts only live or static hosts.
  - `apps/blocks-site/actor.js:191-210`: `GET/POST /_site` and `POST /_publish` at level `admin`.
- Ticket bookkeeping: filled the index overview, added six tasks (phases 1–5, confirm decisions), related five files, changelog entry; `docmgr doctor --ticket SLOP3-012` passed.
- Uploaded: `remarquee upload bundle <guide> --name "SLOP3-012 Intern Guide - Per-App Modules, Database and HTTP Endpoints" --remote-dir "/ai/2026/11/05/SLOP3-012" --toc-depth 2 --non-interactive`.

### Why
- Reusing the report writer avoided reading the four repositories a second time.

### What worked
- All four spot-checked claims hold.
- The writer built a PDF locally (`remarquee upload md --pdf-only`, 42 pages) and rewrapped code lines to 88 columns or less after the first build cut lines off at the margin.
- Upload: `OK: uploaded SLOP3-012 Intern Guide - Per-App Modules, Database and HTTP Endpoints.pdf -> /ai/2026/11/05/SLOP3-012`.

### What didn't work
- No failures observed in this step.

### What I learned
- New facts the guide records:
  - `readShape` never validates a route's level, so a typo makes the route unreachable instead of failing the load.
  - SLOP3-001's design doc says the actor's authorizer denies `SAVEPOINT` and allowlists functions; the code allows both.
  - An authorizer denial surfaces as `actor_error` (`actors_test.go:116`).

### What was tricky to build
- Keeping blocks-site working: it serves HTML from actor routes on its host and posts forms to its own `/_site` and `/_publish` routes, so forcing a sandbox CSP on all actor routes would break it. The guide limits the response policy to API mounts in part 1.

### What warrants a second pair of eyes
- The guide's 15 decisions (task "Confirm the guide's 15 decisions with the user"), especially:
  - `database` and `express` on by default in part 1;
  - allowlist entries match route keys by containment (`Covers()`);
  - a fixed host middleware order that runs before `MatchRoute`;
  - 413 for over-limit bodies on every actor route;
  - `require("database")`/`require("express")` resolving before tree files.

### What should be done in the future
- Implement Phase 1 (`database`) after the decisions are confirmed.

### Code review instructions
- Read the guide's decision records (search "### Decision:") and Part IV. Spot-check citations against origin/main.

### Technical details
- Guide: `ttmp/2026/11/05/SLOP3-012-…/design-doc/01-intern-guide-per-app-modules-the-database-module-and-mount-scoped-http-endpoints.md`.
- reMarkable: `/ai/2026/11/05/SLOP3-012/SLOP3-012 Intern Guide - Per-App Modules, Database and HTTP Endpoints`.

## Step 3: Phase 1 — the `database` module

The user asked for the guide to be implemented. I am doing phases 1–4 (part 1) on one branch, `task/slop3-012-modules` from `origin/main` (`ecb5df9`), committing at the end of each phase with its tests passing. Phase 5 (module catalog and admin grants) is part 2 and out of scope. The guide's decisions are applied as written, since the user asked to implement it without changing any of them. Phase 1 adds `use('database')` and `require('database')`: go-go-goja's API run in the turn as the actor, with savepoint-backed `begin()` handles that never outlive their turn. All tests and lint pass.

### Prompt Context
**User prompt (verbatim):** "Nowimplement it, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill) (Diary format according to skill: MANDATORY)"; then, mid-turn: "subagents in case you use them should also keep their own separate diary"
**Assistant interpretation:** Implement the guide's part 1 (phases 1–4) with tests, committing per phase, and keep this diary in the investigation format. Any subagent writes its own diary file in this ticket.
**Inferred user intent:** Working, reviewable code that follows the design, with a record a reviewer can retrace.
**Commit (code):** `106e72e` — "SLOP3-012 phase 1: use('database'), go-go-goja's database API over the actor's own store"

### What I did
- Worktree `…/scratchpad/slop012` on `task/slop3-012-modules` from `origin/main`. Baseline: `GOWORK=off go test ./...` passed in 20 s.
- `pkg/store/sqlpolicy.go`: `CallerActorRead = "actor-read"`. `SQLITE_SAVEPOINT` is allowed for `actor` and `actor-read`. Writes need no change, because the INSERT/UPDATE/DELETE branch already lists only `actor`, `migration` and `admin-write`.
- `pkg/actor/database.go` (new):
  - `DatabaseConfig{ReadOnly, MaxRows}`;
  - `databaseModule` (built once per actor, cached in `a.database`), `begin`, `endSavepoint`, `popSavepointsFrom`, `closeSavepoints`, `dropSavepoints`, `noOpenTransaction`, `flatParams`;
  - `reservedModules = {"database"}`.
- `pkg/actor/actor.go`:
  - fields `database`, `savepoints`, `seq`;
  - in `handle`'s turn closure, `dropSavepoints()` when `ev.run` fails, `closeSavepoints()` when it succeeds;
  - `requirer` resolves reserved names before tree files.
- `pkg/actor/manager.go`: in the activation hooks, `defer a.dropSavepoints()`, and `a.closeSavepoints()` after `setup`/`smoke`.
- `pkg/actor/modules.go`:
  - `case "database"` in `module()`;
  - `noOpenTransaction("documents")` in `ownPath`, which every document writer (and so `storage`) goes through;
  - `noOpenTransaction("files")` in `files.write`.
- Tests:
  - `pkg/store/store_test.go`, in `TestAppSQLAuthorizer`: `actor-read` may `SELECT`, `PRAGMA data_version` and `SAVEPOINT`/`ROLLBACK TO`/`RELEASE`; it may not `INSERT`, `UPDATE`, `DELETE`, `INSERT … RETURNING`, `CREATE TABLE` or `ATTACH`;
  - `pkg/host/database_module_test.go` (new): `TestDatabaseModule`.

### Why
- Savepoint names use a per-actor counter (`dbsp<seq>`), not the guide's `len(a.savepoints)+1`. After an inner handle is popped, the length-based name could be reused while an outer savepoint of the same name is still open. A counter never repeats.
- The guard sits in `ownPath`, so `db.doc().set/update/delete` and `storage`'s writes, which go through `db`, are all covered by one check. `files.write` gets its own. The guide named only `db` and `storage`, but `PutFile` also records changes in the turn as it runs, so it has the same exposure.
- The module object is cached, so `require('database') === use('database')`. `use('sql')` builds a new object on every call, which is harmless there but would make the equality test meaningless.

### What worked
- `GOWORK=off go test ./pkg/store/` passed. `TestDatabaseModule` passed. Each of these cases is an assertion:
  - `query` returns `[]` for no rows;
  - `exec` returns `{success, rowsAffected: 1, lastInsertId: 1}`;
  - `[1, 2], true` binds as 1, 2, 1;
  - `configure` gives `permission_denied`;
  - `DELETE FROM _docs` and `ATTACH` give `actor_error`;
  - commit keeps, rollback discards, and a handle left open is rolled back;
  - a handle used after `await time.sleep(1)` gives `conflict`, and its pre-await insert is gone;
  - `db.doc().set()` with a handle open gives `conflict`;
  - the outer handle's rollback ends the inner one (`inner.commit()` gives `conflict`);
  - a turn that throws with a handle open rolls back, and the next `begin` works;
  - `require('database') === use('database')`;
  - `require('./database.js')` loads the tree file;
  - the `table:items` reactor counts at least three commits.
- Mutation check: with the `closeSavepoints()` call in `handle` commented out, the test failed with `after commit, rollback, leaveOpen: [one kept left-open], want [one kept]`. I restored the file from a copy.
- Full suite `GOWORK=off go test ./...`: all packages `ok`. `golangci-lint run`: `0 issues.`

### What didn't work
- My first store test used `PRAGMA table_info(items)` and failed with `actor-read reads: not authorized`. `readPragmas` allows a read pragma only without an argument (`a2 == ""`, `sqlpolicy.go:123`), so `table_info(x)` is denied for every app caller, `actor` included. I switched the test to `PRAGMA data_version`. The authorizer is unchanged.
- The editor's language server reports `go: go.work requires go >= 1.26.6 (running go 1.25.5)`. It runs an older Go than the build (`go version go1.26.6`), so this does not affect `go build` or `go test`.

### What I learned
- Actors already read kernel tables (`SELECT count(*) FROM _docs` is allowed for `actor`, `store_test.go:166`), so `database.query` can too. Only writes are restricted.
- A rolled-back write to an app table still sets `t.tables[name]` in the authorizer, which runs at prepare time. The commit then reports a `table` change for a write that was undone, and table reactors fire once with nothing new. This is harmless (reactors re-read), and `sql.transaction` behaves the same way.

### What was tricky to build
- Handle lifetime across `await`. The turn closure returns as soon as the handler awaits real I/O. The rest of the handler runs in a later turn with a different `store.Turn`. `closeSavepoints` runs at the end of every successful closure, so an open handle is rolled back before the first turn commits. `live()` compares the handle's turn with `a.cur.t`, so a later use throws `conflict` instead of running against a savepoint that no longer exists.
- The order on failure. When `ev.run` errors, the store rolls back the whole turn, so the savepoints are gone in SQLite. `dropSavepoints` only clears the Go side. Running `ROLLBACK TO` there would fail on a transaction that is already being rolled back.

### What warrants a second pair of eyes
- `noOpenTransaction` throws `conflict` for any document or file write while a handle is open, including writes the app might expect to be independent of the SQL transaction.
- `sql.transaction` (`modules.go:195`) still allows document writes under its savepoint and has the exposure described above. This is out of scope here and noted in the guide's risks.

### What should be done in the future
- Part 2: pass a real `DatabaseConfig` from the admin's grant, and test `readOnly` and `maxRows` end to end. Today only the store-level caller is tested.

### Code review instructions
- Start at `pkg/actor/database.go`, then the `handle` closure in `pkg/actor/actor.go` (search `closeSavepoints`), `ownPath` in `pkg/actor/modules.go`, and `pkg/host/database_module_test.go`.
- Validate: `GOWORK=off go test ./pkg/store/ ./pkg/host/ -run 'TestAppSQLAuthorizer|TestDatabaseModule' -count=1 -v`.

### Technical details
```js
const db = require('database');
const tx = db.begin();                 // SAVEPOINT dbsp<n>
tx.exec('INSERT INTO items (name) VALUES (?)', 'kept');
tx.commit();                           // RELEASE dbsp<n>
db.query('SELECT ? AS a, ? AS b', [1, 2]);   // [{a: 1, b: 2}]
db.configure('sqlite3', '/x');         // throws permission_denied
```

## Step 4: Phase 2 — the `express` route builder

Phase 2 adds `use('express')` and `require('express')`. The builder is JavaScript (`express.js`, evaluated once per actor as `storage.js` is). Go keeps only what must be checked: `register` validates each route's key, level and audience, and refuses registration after load; `mergeRoutes` writes the routes into `def.http` before `readShape`. Builder routes and `http:` routes therefore form one table, served by the unchanged `MatchRoute`/`Serve`/`toRes`/`serveActorRoute`. The test passed on the first run, and a mutation check confirmed that it catches a missing load-time guard.

### Prompt Context
**User prompt (verbatim):** see Step 3
**Assistant interpretation:** Phase 2 of the guide's plan.
**Inferred user intent:** Apps can expose HTTP endpoints with the express API, inside slop's route machinery.
**Commit (code):** `58285cd` — "SLOP3-012 phase 2: use('express'), go-go-goja's route builder over the actor's route table"

### What I did
- `pkg/registry/routes.go` (new): `RouteMethods`, `SplitKey`, `ValidRouteKey`, `ValidRoutePattern`.
- `pkg/sysdb/records.go`: `ValidGroup(group)` (a group `GroupsOf` knows, with or without `@`).
- `pkg/actor/express.js` (new):
  - `app.use`, `get`/`head`/`post`/`put`/`patch`/`delete`/`options`/`all`/`route`;
  - the staged builder `.public()`/`.allow(level)` → `.audience(g)` → `.handle(fn)`;
  - `compile` (the `app.use` chain, then the handler; promise-aware), `envelope`, `newRes`;
  - `not_supported` stubs for `static`, `staticFromAssetsModule`, `spaFromAssetsModule`, `mount`, `mountHandler`, `listen`, `.auth()` and the `ctx` fields slop lacks.
- `pkg/actor/express.go` (new): `expressModule` (cached), `register`, `checkRouteLevel`, `mergeRoutes`.
- `pkg/actor/actor.go`:
  - fields `express`, `loading`, `pending`;
  - `a.loading = true` around `RunScript`;
  - `mergeRoutes()` after the `defineActor` check, before `readShape`.
- `pkg/actor/modules.go`: `case "express"`. `reservedModules` gains `express`.
- Test: `pkg/host/express_module_test.go` (new), `TestExpressModule`.

### Why
- I kept the builder in JavaScript because it composes functions (the middleware chain, buffered `res`, promise settling). That is natural in JS and awkward through goja's Go bindings. The security-relevant checks stay in Go.
- `register` checks `a.loading`, not `a.cur == nil`, because requires and helper functions also run during load, and an action handler at run time has `a.cur` set too. The flag says exactly "actor.js is running".
- `res.send(object)` sends JSON and `res.send(string)` sends text, as in go-go-goja, except that a string is never sniffed for HTML (guide §23.3).

### What worked
- `TestExpressModule` passed, with an assertion for each of these:
  - a public route answers with params, query and method, and the `app.use` middleware's header `X-Mw: ran`;
  - an `http:` route on the same table answers;
  - `.allow('interact')` gives 404 to nobody and 403 to a signed-in viewer (`@member` at `view`), for GET and POST;
  - at `interact`, `POST` with a JSON body returns 201 and `{id: 1}`, and the row exists;
  - `redirect(303, …)` sets `Location`;
  - an async handler with `await time.sleep(1)` answers;
  - a returned string is `text/plain`;
  - `twice` and `nothing` give 500 `invalid_state`;
  - `object`, `cookies`, `static`, `listen` and `auth` give 500 `not_supported`;
  - registering from an action gives `invalid_state`;
  - four load errors break the actor, with messages in `app.status`:
    - `GET /a is defined both in http: and by express`;
    - `level "superuser": use public, view, interact, admin or owner`;
    - `"GET a/*/b" is not a route`;
    - `unknown audience "vip"`.
- Mutation check: with `if !a.loading` replaced by `if false && !a.loading`, the test failed with `actor.call map[action:late store:ex]: want invalid_state, got 200`. I restored the file.
- Full suite passed. `golangci-lint run` passed after one fix (below).

### What didn't work
- The first lint run on the new `routes.go` reported:
  - `QF1001: could apply De Morgan's law (staticcheck)` on `validParam`;
  - `nonamedreturns` on `SplitKey`.

  I fixed both: named booleans `letter`/`digit`, and unnamed results.

### What I learned
- Load-time errors from a Go function called from JS carry goja's native frame (`at github.com/…/(*Actor).register-fm (native)`) in `app.status`. The message is still readable. Stripping the frame would be cosmetic and affect every Go-thrown error, so I left it.

### What was tricky to build
- One table, two sources. `http:` route objects and builder routes must look identical to `readShape` and `fn`. `mergeRoutes` writes `{level, audience, run}` objects into `def.http`, so `fn("http", key)` finds `run` as it does for hand-written routes. The compiled `run(ctx, req)` returns the same `{status, headers, json|text|html}` shape `toRes` already reads.
- Errors inside `res.result`: they are thrown in JS with `e.code`, so `jsError` turns them into coded errors and `serveActorRoute` writes them as JSON errors with status 500. No new error path was needed.

### What warrants a second pair of eyes
- `ctx` is `Object.create(ctx)`. The actor's accessor properties (`now`, `rev`, `storage`) are Go functions that ignore `this`, so inheriting them works. A future accessor that used `this` would see the envelope.
- `.audience(group)` accepts `store` because `ValidGroup` includes it. A route for `store` makes sense only for store-to-store calls, which HTTP routes do not get.

### What should be done in the future
- Phase 3: the mount policy, which also covers builder routes.

### Code review instructions
- Start at `pkg/actor/express.go` (`register`, `mergeRoutes`), then `pkg/actor/express.js` (`needsSecurity`, `compile`, `newRes`), then `build` in `pkg/actor/actor.go`.
- Validate: `GOWORK=off go test ./pkg/host/ -run 'TestExpressModule$' -count=1 -v`.

### Technical details
```js
const app = require('express').app();
app.use((ctx, res, next) => { res.set('X-Mw', 'ran'); return next(); });
app.post('/items').allow('interact').handle((ctx, res) => {
  const r = require('database').exec('INSERT INTO items (title) VALUES (?)', ctx.body.title);
  res.status(201).json({ id: r.lastInsertId });
});
// merged as def.http['POST /items'] = { level: 'interact', run }
```

## Step 5: Phase 3 — the mount's API policy

Phase 3 puts the HTTP policy on the mount: an optional `api` block with an allowlist of route keys, level floors, request and response rules, and the middleware configurations phase 4 will run. It is persisted, validated in `mount.set`, enforced in the actor (dispatch, and a load-time check over every serving mount) and in the pages door, and listable with a new verb `mount.routes`. Two things in the guide were wrong or incomplete, and testing found them: an unmatched path under an API prefix fell through to the page shell, and `app.status` could not show a route-policy failure. Both are fixed. A mutation check also showed that one assertion first passed for the wrong reason.

### Prompt Context
**User prompt (verbatim):** see Step 3
**Assistant interpretation:** Phase 3 of the guide's plan.
**Inferred user intent:** Admins decide which endpoints an app exposes on which subpath, and how.
**Commit (code):** `cb48952` — "SLOP3-012 phase 3: a mount's API policy (allowlist, floors, request and response rules)"

### What I did
- `pkg/registry/api.go` (new):
  - `MountAPI`, `Floor`, `Middleware`, and `RateLimitConfig`/`CORSConfig`/`APITokenConfig`, each with `Validate`;
  - `decodeStrict` (unknown fields and trailing data refused), `ValidateAPI` (the guide's nine rules, plus "a floor sets min or audience", "an audience is not `store`", "a middleware slot only once"), `WithDefaults`;
  - `UnderPrefix`, `AllowsKey`, `FloorOf`, `patternScore`, `LevelRank`, `MaxLevel`, `Covers`, `MatchPattern` (moved from `pkg/actor/manager.go`).
- `pkg/registry/api_test.go` (new): `TestValidRouteKey`, `TestCovers` (20 cases), `TestMatchPattern`, `TestFloorOf`, `TestValidateAPI` (23 failure cases, each asserting its message).
- `pkg/sysdb/migrations/011_mount_api.sql`. `pkg/registry/mounts.go`: `Mount.API`, `api` in `mountCols`/`scanMount`, the `SetMount` upsert and the `UndoMount` re-insert, `apiJSON`.
- `pkg/actor`:
  - `MatchRoute(…, api)` skips uncovered keys before scoring;
  - `build(ctx, …, checkPolicy)` calls `checkRoutePolicies` after `readShape`, in both build sites (on demand in `get`, and at activation);
  - `routes.go` (new): `servingMounts`, `checkRoutePolicies`, `Routes` (rebuilds once without the check when the actor is broken).
- `pkg/commands`:
  - `mountEnv` gains `A`;
  - `MountSetIn.API`;
  - `checkMount` accepts `api` on live hosts only and validates it;
  - `mountAt`, `servedStores`, `restartServed` (restart and rebuild) after `mount.set`/`mount.rm`/`mount.undo`;
  - `app.status` also reports `A.Broken(id)`;
  - new verb `mount.routes` with `MountRoutesIn`/`MountRoute`.
- `pkg/doors/pages/actors.go`:
  - `serveActorRoute` applies the prefix, a JSON 404 under the prefix, floors and audiences, the body limit with 413, forwarded headers, and the response filters (type, header allowlist, size, HTML sandbox);
  - `responseTypeAllowed`;
  - `serveBoundAsset` takes an `allow` check for the asset's type.
- `pkg/host/mount_api_test.go` (new): `TestMountAPIPolicy`.

### Why
- Restarts happen when the mount's policy is involved before or after the change, or when a served store is broken. The second case lets a new mount without a policy fix a store broken by a narrow one. Restarting on every mount change would kill parked handlers of every store a type-less `:param` mount serves, for changes that cannot matter to them.
- `restartServed` rebuilds each actor right after restarting it. A route-policy failure or its fix shows in `app.status` at once, not at the next request. Without this, the test's "narrow mount breaks the actor" step saw no failure until something requested a route.
- The activation build checks the policy too. A new app version that adds a route outside its mount's allowlist then fails to activate, and the store keeps its old version. This is the same behaviour as a failing migration.
- `WithDefaults` is applied when a request is served, not when the policy is stored. `mount.ls` shows exactly what the admin wrote, and changing a default later applies to existing policies.

### What worked
- `GOWORK=off go test ./pkg/registry/` passed.
- `TestMountAPIPolicy` passed, with an assertion for each of these:
  - an uncovered key gives JSON 404 on the API mount and 200 on the plain mount;
  - a path outside the prefix does not reach the actor;
  - `feed.json` stays public through a public floor;
  - a `public` app route is raised to `view` by the default floor (404 for nobody on `/japi`, 200 on `/j`);
  - the floor's audience gives `audience_required`;
  - HTML gives 500 `response_type_not_allowed` by default;
  - `Set-Cookie`, `X-Custom` and the actor's CSP are dropped and `ETag` is kept, while the plain mount still passes `X-Custom`;
  - forwarded headers are exactly the policy's `accept`/`x-trace` (no `user-agent`, no cookie);
  - an 11-byte JSON body against a 10-byte limit gives 413, and a 4-byte one gives 201;
  - a body over 1 MiB on the plain mount gives 413;
  - `mount.routes` reports `allowed`, `declaredLevel`/`effectiveLevel` and `audiences`;
  - allowing `text/html` serves it with `Content-Security-Policy: sandbox; default-src 'none'`, and `mount.undo` restores the previous policy (checked in `mount.ls`);
  - a store served only by a narrow API mount is broken, with `GET /api/admin is in no API allowlist`, and widening the mount fixes it without `app.restart`;
  - `mount.set` refuses a `Cookie` forward header, empty routes, a `*` CORS origin and an unknown field.
- Mutation check: with the `AllowsKey` filter in `MatchRoute` disabled, the test failed with `admin on the API mount: 200 map[admin:true]`. I restored the file.
- Full suite passed; `golangci-lint run`: `0 issues.`

### What didn't work
- My batch edit of `pkg/commands/mounts.go` failed its own assertion, `AssertionError: ('pkg/commands/mounts.go', '\t\t\t\t\tm := registry.Mount{…')`, because my pattern had five tabs where the file has four. The appended helpers had already been written by the `cat >>` in the same command, so the build failed with `undefined: MountRoutesIn`. I redid those edits with the Edit tool.
- The first test run failed with `admin on the API mount: 200`. The policy had filtered the key, `MatchRoute` returned no match, and the live host's page shell answered with `index.html`. **Fix:** under an API prefix, an unmatched route is a JSON 404 (`not_found`). The guide assumed 404 but did not say where it comes from.
- The first mutation check (dispatch filter disabled) did not make the test fail. With the default floor at `view`, the anonymous request was already refused by the level check, so the assertion proved nothing about the allowlist. I changed it to run as bob (view), and the mutation then failed as it should.

### What I learned
- `app.status` reads `kernel.Running.Broken()`, which reports activation failures only. A build failure after activation lives in the actor manager's `broken` map, and `app.status` did not show it until now.
- Under an API prefix, falling through to the page would also leak the app's page on paths the admin meant to be API-only. The JSON 404 closes that as well.

### What was tricky to build
- **Two places enforce the allowlist, for different reasons.**
  - The load-time check runs over the union of serving mounts (fixed mounts naming the store, plus `:param` mounts of its type). A store also mounted somewhere without a policy therefore passes.
  - Only the dispatch filter keeps a route off a particular API mount.
- **Restarts have to clear two failure records:** the manager's `broken` cache, and the kernel's failed activation. `Restart` does both (`delete(m.broken, id)`, `m.K.ClearFailure(id)`); `RestartApp` does neither.

### What warrants a second pair of eyes
- `restartServed` for a `:param` mount with no type restarts and rebuilds every store when the policy changes. That is correct but potentially many actors at once.
- `responseTypeAllowed` checks the actor's `Content-Type` header if set, else the type implied by its result. An actor that returns `{text}` but sets `Content-Type: text/html` is treated as HTML, and is refused or sandboxed accordingly. That is the intended reading.
- The size limit applies to bodies the actor returns. `{asset}` results are streamed from blobs and only type-checked.

### What should be done in the future
- Phase 4: the host middleware chain before `MatchRoute`.

### Code review instructions
- Start at `pkg/registry/api.go` (`ValidateAPI`, `Covers`, `FloorOf`), then `serveActorRoute` in `pkg/doors/pages/actors.go`, then `pkg/actor/routes.go` and `restartServed` in `pkg/commands/mounts.go`.
- Validate: `GOWORK=off go test ./pkg/registry/ ./pkg/host/ -run 'Test(ValidRouteKey|Covers|MatchPattern|FloorOf|ValidateAPI|MountAPIPolicy)$' -count=1 -v`.

### Technical details
```json
{"host": "apps.example", "path": "/japi", "store": "jr",
 "api": {"prefix": "/api",
         "routes": ["GET /api/feed.json", "GET /api/members", "POST /api/items"],
         "floors": [{"route": "GET /api/feed.json", "min": "public"},
                    {"route": "GET /api/members", "audience": "subscriber"}],
         "maxBodyBytes": 10, "forwardHeaders": ["Accept", "X-Trace"]}}
```

## Step 6: Phase 4 — host middlewares before the actor, a token-scope fix, docs

Phase 4 runs the mount's host middlewares in the pages door, after the prefix check and before `MatchRoute`, which is what builds the actor. A refused request therefore costs no build, no inbox slot and no turn, and the test asserts that directly. The order is fixed: `rateLimit` per ip, `cors`, methods, the body limit, `apiToken`, `rateLimit` per visitor. A self-review afterwards found that a `read`-scoped token could reach `interact` routes with POST, because token scopes do not cap a person's level (SLOP3-005). I fixed that in `apiToken`. The design document now covers both modules and the mount policy.

### Prompt Context
**User prompt (verbatim):** see Step 3
**Assistant interpretation:** Phase 4 of the guide's plan, and the documentation the effort level asks for.
**Inferred user intent:** Slop, not the app, controls rate, origin, method, size and identity on API endpoints.
**Commit (code):** `a5f66cc` — "SLOP3-012 phase 4: host middlewares on API mounts, before the actor is built; docs"; `1b4cdcc` — "SLOP3-012 phase 4: a read token makes safe requests only on API mounts"

### What I did
- `pkg/doors/pages/apichain.go` (new): `apiCall`, `runAPIChain`, `limitStep`, `methodsStep`/`allowedMethods`, `maxBodyStep`.
- `pkg/doors/pages/ratelimit.go` (new): `rateLimiter` (`take`, `sweep`, `size`), `capacity`; token buckets keyed `mount|per|key`. The door's `Tick` sweeps them.
- `pkg/doors/pages/cors.go` (new): `corsStep`.
- `pkg/doors/pages/apitoken.go` (new): `apiTokenStep`, `safeMethod`, `unauthorized`.
- `pkg/doors/pages/actors.go`: the chain runs before `MatchRoute`, and the principal it settles (site cookie, or token) is the one used afterwards. `door.go`: field `limiter`, swept in `Tick`.
- Tests:
  - `pkg/doors/pages/ratelimit_test.go`: `TestRateLimiter`;
  - `pkg/host/mount_api_middleware_test.go`: `TestMountAPIMiddleware`, plus a `harness.raw` helper.
- `doc/design/slop-v3.md`: §6.2 (a paragraph on `database` and `express`), §6.5 (`require` resolution), §7.1 (two catalog rows), §10.2 (the API policy and the chain).

### Why
- **The chain is code in a fixed order, not a configurable list.** CORS preflights carry no `Authorization`; the per-visitor limit needs the principal `apiToken` settles; the body limit must come before anything reads the body. The policy only switches steps on.
- **`maxBodyStep` refuses on `Content-Length`,** before the actor exists. `serveActorRoute` still refuses based on what it actually reads, because `Content-Length` can be absent (chunked bodies) or wrong.
- **An invalid bearer token is a 401,** never a fallback to the cookie. A client that sent a token meant to be that token. Quietly acting as the cookie's person, or as nobody, would hide a client bug.
- **The read-scope fix:** `Access.Level` deliberately ignores scopes (SLOP3-005 step 10), and `VisitorOf` only copies them for modules. Without a check in `apiToken`, a token minted read-only could run an `interact` handler's writes. The rule matches verbs: unsafe methods need `write`.

### What worked
- `TestRateLimiter` passed: two takes then a refusal with exactly `30s` retry (limit 2 per minute); a token back after 30 s; per-key buckets; a changed rule starts full; burst 1 caps; `sweep` after 3 minutes empties it.
- `TestMountAPIMiddleware` passed, with an assertion for each of these:
  - the third request from one ip gives 429 with `Retry-After`, and the table shows 2 hits, so the third never ran;
  - after `h.a.Restart("mw")`, these requests are answered with `h.a.Running("mw") == nil` afterwards (no build):
    - the preflight from an allowed origin gives 204, with `Access-Control-Allow-Origin` and the methods, and no `Allow-Credentials`;
    - another origin gives 403;
    - `DELETE` gives 405 with `Allow: … POST`;
    - a 40-byte body against 16 gives 413;
    - `Bearer nope` gives 401 with `WWW-Authenticate: Bearer`;
  - bob's token, from the allowed origin, posts (201) and gets `Access-Control-Allow-Origin`;
  - a read token's POST gives 403 `insufficient_scope`;
  - per-visitor limit 1: bob's second request gives 429, while ann gets 200 with `level: view` and her `usr_` id;
  - on a mount without `apiToken`, a token means nothing (404);
  - `required: true` without a token gives 401, and with one gives 200.
- Mutation check: with `if !s.runAPIChain(c)` disabled, the test failed with `third hit: 200 … {"level":"","who":null}`. I restored the file.
- Uncached full suite `GOWORK=off go test ./... -count=1`: every package `ok`. `golangci-lint run`: `0 issues.`

### What didn't work
- My first `ratelimit.go` declared `func (rl registry.RateLimitConfig) capacity()`, a method on a type from another package, which Go does not allow. I rewrote it as a plain function before the first build. No other failures.

### What I learned
- The live host already treats an unsafe cross-origin request as nobody (`sitePrincipal`). CORS with credentials would therefore not even work, so "never allow credentials" costs nothing, and token auth is the only cross-origin identity.

### What was tricky to build
- **Where the principal changes.** `serveActorRoute` receives the site principal from its caller. The chain may replace it with the token's, and everything after the chain (the visitor, level, audiences, the per-visitor limit) has to use the replaced one. The chain writes `c.p` and `serveActorRoute` reads it back before `MatchRoute`.
- **Response headers set by the chain survive the response filter.** CORS headers and `Retry-After` are set on `w.Header()` before the actor answers. The phase 3 filter only skips the actor's own headers that are outside the allowlist, so `Access-Control-Allow-Origin` reaches the client while an actor-set `Access-Control-*` header does not.

### What warrants a second pair of eyes
- Rate-limit buckets live in memory, per server process. A restart resets them, and several replicas would not share them. That is fine for slop's single pod today.
- `cors` with `"* …"` routes advertises a fixed method list (`GET, HEAD, POST, PUT, PATCH, DELETE`).
- `ClientIP` decides the per-ip key. It is as trustworthy as the server's proxy configuration (`web.Sessions.ClientIP`).

### What should be done in the future
- Part 2 (phase 5): the module catalog and admin grants with configuration.
- Confirm the guide's decisions with the user. In particular, `database`/`express` are on by default, and every actor route now gets 413 for over-limit bodies.
- Separate tickets: the shared live-host origin; `fetch` re-checking `slop.fetch` on redirects; filtering response headers on non-API mounts.

### Code review instructions
- Start at `runAPIChain` in `pkg/doors/pages/apichain.go`, then `apitoken.go`, `cors.go`, `ratelimit.go`, then the call site in `serveActorRoute`.
- Validate: `GOWORK=off go test ./pkg/doors/pages/ ./pkg/host/ -run 'TestRateLimiter|TestMountAPIMiddleware' -count=1 -v`.

### Technical details
```json
"middleware": [
  {"name": "rateLimit", "config": {"per": "ip", "limit": 120, "window": "1m"}},
  {"name": "cors", "config": {"origins": ["https://client.example"], "maxAgeSeconds": 600}},
  {"name": "apiToken", "config": {"required": false}},
  {"name": "rateLimit", "config": {"per": "visitor", "limit": 10, "window": "1m", "burst": 5}}
]
```
- Answers: 429 `rate_limited` (+ `Retry-After`), 403 `origin_not_allowed`, 405 `method_not_allowed` (+ `Allow`), 413 `payload_too_large`, 401 `unauthenticated` (+ `WWW-Authenticate: Bearer`), 403 `insufficient_scope`.
