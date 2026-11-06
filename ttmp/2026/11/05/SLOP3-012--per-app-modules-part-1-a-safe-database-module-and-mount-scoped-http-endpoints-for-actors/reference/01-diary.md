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
