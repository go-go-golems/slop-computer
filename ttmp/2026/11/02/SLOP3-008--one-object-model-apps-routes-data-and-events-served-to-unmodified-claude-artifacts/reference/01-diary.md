---
Title: Diary
Ticket: SLOP3-008
Status: active
Topics:
    - architecture
    - sqlite
    - routing
    - hosting
    - access
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/02/SLOP3-008--one-object-model-apps-routes-data-and-events-served-to-unmodified-claude-artifacts/design-doc/01-one-object-model-for-apps-routes-data-and-events.md
      Note: The design this diary records
ExternalSources: []
Summary: Chronological record of the SLOP3-008 review.
LastUpdated: 2026-11-02T18:00:00-05:00
WhatFor: How the one-object-model review came about and what it was checked against.
WhenToUse: Resuming SLOP3-008 or revisiting why SLOP-008 was dropped.
---

# Diary

## Goal

Answer, against slop v3's actual code, how apps, routes, data and events
should be unified so that claude.ai artifacts run unmodified, admin tools
and multi-store apps are ordinary apps, and custom apps get
Durable-Object-like behaviour.

## Step 1: The request, and dropping SLOP-008

The user asked (verbatim):

> basically i'm trying to figure out how to best unify our data model on the backend, and serving apps that come straight out of claude without having to adapt them (and its DB API), while also allowing potentially custom apps to have more durable objects ike behaviour or maybe making it possible to have 1:1 durable objects API compatibility as well. [...] How would you potentially unify everything, if you could start from scratch. Things I want to be abl eto do for example is create an app, that admins can use, to edit the metadata of other apps, view their source. Or an app that can be given access to multiple databases that are then exposed to its actual code (which comes straight from claued.ai) using the claude artifact db API.

and then pointed at an earlier review, SLOP-008
(`ttmp/2026/11/02/SLOP-008--artifact-state-storage-api-vs-slop-content-model-architect-review/`
in `/home/manuel/code/wesen/slop-computer`).

SLOP-008 turned out to review slop **v2**. It cites `pkg/store/artifacts.go`,
`docs`/`doc_heads`, `refs`, `tool_grants` and `DocTypes = {pinup}`, none of
which exist in v3. It was committed as 2f68cd9 on a local `main` that was
227 commits behind `origin/main` and predated `73c4c11` (the v2 removal);
it was never pushed. Most of its gaps (per-document `ifVersion`, nested
paths, queries, path rules with `{self}`, 10-minute leases, assets,
`artifact.publish`) are closed in v3.

The user then said: "oh omg, ok, rebase main, and let's do it again, from scratch. kill that file."

### What I did

- Checked 2f68cd9 held only the SLOP-008 ticket (8 files under `ttmp/`),
  then `git -C /home/manuel/code/wesen/slop-computer reset --hard origin/main`
  (now 7e1f912) and removed the empty directory skeleton left behind.
  `.idea/` (untracked) was left alone.
- Read v3's model: `pkg/store/store.go` (store schema),
  `pkg/system/migrations/001_init.sql` (`stores`, `mounts`, `bindings`,
  `grants`, the system `_log`/`_changes`), `pkg/actor/modules.go`
  (`use()` catalog, `stores.open`), `pkg/actor/sysreact.go`,
  `web/runtime/src/index.ts` and `caps.ts` (page capabilities,
  `slop.stores.open`), `apps/backoffice/app.json` (the `system` module),
  `doc/design/slop-v3.md` §1, §5.5–5.8, §8.
- Wrote the design doc from scratch.

### Why

The question is about v3, and v3 already unifies around one noun, the
store. A review of v2 would argue for things v3 has.

### What worked

The from-scratch design and v3 converge: one SQLite file per object, one
writer, the log as the event system. That made the review about the three
places v3 does not use its own primitive: the registry, bindings, and
source access.

### What didn't work

Nothing failed. One draft error was caught before commit: the worked
example used `export default { migrations: [...] }`, but ES modules are a
v3.0 non-goal and migrations are `sql/NNN_name.sql` files. Fixed to
`defineActor({...})` with a separate SQL file, after reading
`examples/guestbook/actor.js` and `examples/journal/`.

### What I learned

- `system.db` already has `_log` and `_changes`, and `system:` reactors
  follow it. Making it a store is mostly presentation (documents over
  tables), not a storage change.
- The claude.ai contract's `files` capability (a Claude Code project's
  tree) is exactly the "view source" API an admin console needs.
- The contract has no cross-collection query, which is what makes
  prefix-mounted namespaces exact: every query lands in one store.

### What was tricky

- Whose level applies on a mounted store. Settled as a per-mount `as`
  (`viewer` by default, `store` for delegation like blocks-site), with the
  minimum of the binding's level.
- Doc/collection parity across mounts: a mount must keep segment-count
  parity or the page's paths change meaning.

### What warrants review

- §5.2 rules 1–5 and the `as` table.
- §5.3: registry writes through verbs with `ifVersion`; which documents are
  writable at all (open question 2).
- §6.2: the claim that 1:1 Durable Objects compatibility needs the Workers
  runtime, not storage work.

### What should be done in the future

Decide the open questions in §10, then phase 1 (namespaces for pages).

## Step 2: One path space instead of a system store

The user proposed mapping the registry as `stores/XXX/...` under the usual
document conventions instead of a separate `system` store ("we could actually
just map them as stores/XXX/... and then the usual convention?"), and then
keeping the page's own store at the root with the platform under `_stores`
("it's still possible to have the defafult store collections at the top
level, maybe it should be _stores or so to make it easier to separate?").
Then: "ok, update."

### What I did

Rewrote design §5.2–§5.4 and the parts that depended on them (summary,
seams, §5.1, §5.5, §5.6, §7.1, §7.2, invariants, plan, open questions):

- a page's `db` is one path space: its own store at the root, unchanged;
  every store at `_stores/<id>/…`; registry rows in `_`-prefixed
  subcollections (`_grants`, `_bindings`, `_mounts`, `_llm`) and `_people`;
- bindings become aliases (`contacts → _stores/crm-team/contacts`);
- `_stores` as a whole is opt-in: declared by the app and approved by an
  admin, or the app would act as a confused deputy with the visitor's
  authority over every store they can see.

### What I learned

- `_stores/<id>` has two segments, so nesting keeps every store path's
  document/collection parity: the convention needs no translation.
- Document segments may start with `_` today (`segmentRe` in
  `pkg/rt/paths.go`), so reserving top-level `_` names is a small breaking
  change (open question 4).
- Verbs exist for every writable row except app metadata: `grant.set/rm`,
  `bind.set/rm`, `mount.set/rm`, `llm.set`, `people.role`, `store.new/rm`,
  `store.type`, `app.follow`; `store.meta` is read-only, so `app.describe`
  would be new.

### What was tricky

Files do not fit the parity rule (`a/b/c.js` lands on a collection), so
source stays on the `files` capability, with `project` naming `_stores` or
an alias.

### What warrants review

§5.2's resolution order and the opt-in rule; §5.3's write table (which
level each registry write needs).

## Step 3: Data and assets first; mounts stay out

The user, on open question 3: "yeah no need to map mounts into stores, nor
hsots. It's really about data and assets at first."

### What I did

- Removed `_stores/<app>/_mounts` from §5.4 and the plan; open question 3 is
  marked decided. Mounts stay on `mount.*` and the back office.
- Added §5.3, assets across stores (later sections renumbered): `/_blob/<id>`
  resolves across the stores a view reaches (own first, then aliases with
  `assets`, then approved `_stores`), at the reader's level; uploads, lists
  and deletes stay local; new ids get 16 characters.
- Phase 1 is now "data and assets across stores", with `caps/db` shared by
  page RPC and actors.

### What I learned

`serveAssetBlob` (`pkg/server/rtassets.go`) resolves an id only in the
sandbox origin's own store, and ids are `a` + 8 random characters
(`ids.New("a", 8)`): unique per store, not across stores. A contract page
rendering `"/_blob/" + id` from an aliased document would get a 404 today.

### What warrants review

§5.3's resolution order and whether a 16-character id is enough (open
question 7).

## Step 4: Registry documents are not live

The user, on open question 6: "no need to keep these live for nwo".

§5.4, §5.7, §7.1 and the plan now say registry documents are computed on read, and `onSnapshot` on them delivers one snapshot and no changes, as on the static host. Open question 6 is marked decided, with a note that `_changes` keys should keep naming the affected store and subject, so live updates can be added later without an API change.

## Step 5: Decisions for phase 1, the production scan, and rt.Space

Implementation of phase 1 (data and assets across stores) starts here. I took the open questions that block phase 1 and decided them, checked production before reserving top-level `_` names, and wrote the path space as a pure type in `pkg/rt` so it could be tested before any server code uses it. The scan found no store with a top-level `_` path, and the space's unit tests caught one real routing bug (shadowed own documents) before it reached the stream.

From this step on, entries use the diary skill's investigation format.

### Prompt Context
**User prompt (verbatim):** "you chose what's best. Impement. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill) (diary format from skill mandatory)"
**Assistant interpretation:** Decide the remaining phase-1 open questions myself, implement SLOP3-008 phase 1 (data and assets across stores), commit at milestones, and keep this diary in the investigation-entry format.
**Inferred user intent:** Get the path space working end to end (an unmodified Claude artifact reading other stores and showing their uploads), with a reviewable trail of decisions and failures.
**Commit (code):** e8ca8ef — "SLOP3-008: the path space (rt.Space), top-level _ names reserved, db.stores"

### What I did
- Decided the open questions that block phase 1:
  - **1, delegated reads:** not in phase 1. Every alias reads as the viewer (`min(alias level, the viewer's level on the target)`); publishing stays an actor's job (blocks-site). No `as` field yet.
  - **4, reserving `_`:** reserve now, after a scan (below).
  - **5, depth:** allow 18 segments under `_stores/<id>/` (the target path itself stays ≤ 16).
  - **7, asset ids:** new uploads get 16 random characters.
  - **New, private documents across stores:** another store's `data/users/<id>/…` is reachable by no route. An app reaching into a store could otherwise read the viewer's private documents there on their behalf and copy them out (a confused deputy), and the viewer never chose that app for that data.
- Wrote `ttmp/…/SLOP3-008…/scripts/01-scan-reserved-paths.py`: `store.ls --all`, then per store `sql.query "SELECT path, body IS NULL AS deleted FROM _docs WHERE path LIKE '\_%' ESCAPE '\'"`, read-only, with the CLI's admin token.
- `pkg/rt/space.go`: `Space{Holder, Aliases, Stores}`, `Alias{Name, Store, Prefix, Level, Assets}`, `Target{Store, Path, Own, Cap, Via, Registry}`, `Resolve(path, doc)`, `PagePaths(store, path)`, `AssetStores()`, `Equal`, `ValidAlias`, `Reserved`, `PathError{Code, Msg}`.
- `pkg/rt/paths.go`: `validPath` refuses a first segment beginning with `_`.
- `pkg/rt/manifest.go`: `Caps.Stores` from `capabilities.db.stores` (`view`, `interact` or `admin`).
- `pkg/rt/space_test.go`: resolution (own, aliases, `_stores`, registry targets, parity, reserved names, private documents), depth, a closed space, `PagePaths` including a round trip back through `Resolve`, asset-store order, alias validation.

### Why
- A pure `Space` in `pkg/rt` (which has no I/O and already owns paths and rules) can be shared by page RPC, the stream and later actors, and tested without a server. That is the "resolve once" part of the plan's `caps/db`, without moving the whole db implementation yet.
- Aliases are one top-level segment mapped to a collection path. A single segment keeps lookup trivial (the first segment), and mapping a collection (odd segments) to a collection preserves every path's document/collection parity by construction.
- Reserving in `validPath` covers every writer at once (pages, actors, `docs.set`, imports), so no store can grow a `_grants` collection that phase 3's registry documents would collide with.

### What worked
- The scan: `scanned 112/112 stores; 0 with top-level _ paths`. Two positive controls on `guestbook`: `LIKE 'e%'` returned `entries/emvzmc4z8`, `entries/emvzmco6w`; and `'_x' LIKE '\_%' ESCAPE '\'` counted 2 (one per row), so the escaped pattern matches a literal underscore.
- `GOWORK=off go test ./pkg/rt -count=1`: ok. `GOWORK=off go test ./... -count=1`: every package ok after the reservation, so no existing test or fixture writes a top-level `_` path.

### What didn't work
- First `slop store ls --all -o json` failed: `Error: accepts at most 0 arg(s), received 1`. The bool flag did not take a separate value in that position; `slop store ls --json '{"all":true}' -o json` worked.
- First scan run: `(eval):1: no such file or directory: …/scripts/01-scan-reserved-paths.py`. The ticket's empty `scripts/` folder had never been committed; `mkdir -p` and rerun.
- First `go test ./pkg/rt` run, 5 failures. Four were my test cases using the wrong parity (`people/users/u1/prefs` has four segments, so it is a document, not a collection). One was a real bug:
  `space_test.go:128: dash contacts/c1 → contacts/c1 → {Store:crm Path:contacts/c1 …}`.

### What I learned
- `/_blob/<id>` carries no view credential (an `<img>` cannot send the Bearer secret): the sandbox origin's label names the store and app, and the unguessable id is the capability (`serveSandbox` → `serveAssetBlob(storeID, id)` in `pkg/server/sandbox.go`, `rtassets.go`). Cross-store asset resolution therefore cannot check the viewer's level at fetch time; it has to rest on what the binding allows. This corrects §5.3's "at the reader's level" wording, to be fixed in the design doc.
- Asset ids are `ids.New("a", 8)`: unique per store only.
- The view stream resumes with one `after=<rev>` of the target store, and the runtime only advances `lastRev` from doc events that carry a `rev`. A remote store's changes can travel without `rev`, with a per-store cursor kept on the server-side view (which outlives stream reconnects), so the runtime needs no vector cursor.

### What was tricky to build
- Shadowing. When the holder has its own `contacts` collection and an alias named `contacts`, the page path `contacts/c1` means the alias. `PagePaths(holder, "contacts/c1")` first returned `contacts/c1` too, so a change to the hidden own document would have been delivered to subscribers of the aliased collection, under a path that resolves to another store. Fix: `PagePaths` skips the own path when an alias has the same top-level name (`aliasNamed`); the round-trip test (every page path resolves back to the same store and path) guards it.

### What warrants a second pair of eyes
- The private-documents rule in `Space.target`: refusing `data/users/<id>/…` of any other store, including through `_stores` for an admin console.
- Whether reserving `_` in `validPath` (all writers, not just pages) could surprise an importer or a migration.

### What should be done in the future
- Fix §5.3 of the design doc (asset resolution cannot check the reader's level).

### Code review instructions
- Start at `pkg/rt/space.go` (`Resolve`, `target`, `PagePaths`), then `pkg/rt/space_test.go`.
- `GOWORK=off go test ./pkg/rt -run 'TestSpace|TestValidAlias' -count=1 -v`
- Rerun the scan: `python3 -I ttmp/2026/11/02/SLOP3-008--*/scripts/01-scan-reserved-paths.py` (admin token).

### Technical details
- Resolution order: `_stores` (if `Stores > none`), then any other `_` name (reserved), then an alias by first segment, then the holder's own path.
- `_stores` (a collection) and `_stores/<id>` (a document) resolve to `Registry: true` targets: the registry's documents, phase 3.
- `_stores/<holder>/…` and an alias pointing at the holder resolve to `Own: true` with the route's ceiling as `Cap`.

## Step 6: Aliases and _stores in the page protocol, the stream and /_blob

This step wires `rt.Space` into the server: bindings become aliases (a prefix and a level), every db RPC resolves its page path through the view's space, the stream follows the other stores a page subscribed into, and `/_blob/<id>` falls back to the stores an alias shares uploads with. Five integration tests pass, and three deliberate breakages each made the intended test fail.

### Prompt Context
**User prompt (verbatim):** see Step 5.
**Assistant interpretation:** Continue phase 1: the server half of the path space.
**Inferred user intent:** An unmodified Claude page reads, writes and watches other stores and shows their uploads, with access as the viewer.
**Commit (code):** 2dadf12 — "SLOP3-008: pages read other stores through aliases and _stores; uploads by bare id"

### What I did
- `pkg/system/migrations/009_binding_prefix.sql`, `pkg/system/bindings.go`: `bindings.prefix` (default `''`), `bindings.level` (default `view`); `Binding.Prefix`, `Binding.Level`. A binding without a prefix keeps its old meaning (an actor/`slop.stores` read alias, e.g. blocks-site's `source`).
- `pkg/verbs/actors.go`: `bind.set --prefix --level` (validated by `rt.ValidAlias`; the caller needs `--level` on the target, admin with `--assets`); `bind.set`/`bind.rm` call `AccessChanged` so the holder's open views are rechecked.
- `pkg/system/policy.go`, `pkg/verbs/policy.go`: a `stores` policy cell, a matrix row when `capabilities.db.stores` is declared, off by default.
- `pkg/rt/views.go`: `View.Space`; per-view `remote` cursors (`Watch`, `Watching`, `Caught`, `Remotes`); `Out.Store`; `Registry.Reaching(store)` (own views plus views following the store).
- `pkg/server/space.go`: `spaceOf` (bindings with a prefix → aliases; `_stores` when declared and the cell is on), `route`/`remoteRoute` (store, path, `min(level there, ceiling)`, that store's rules), `storeReader.pageDocs` (a committed document → the subscribed page paths that show it), `assetStores`.
- `pkg/server/views.go`: `openView` sets `Space`; `dbGet`, `readable`, `dbWrite` (new `writeRoute`, `writeWho`), `rpcDBAcquire` (lease key = target store + path), `rpcDBSubscribe` (`v.Watch(store, head)` before reading); `viewEvents` uses `own.pageDocs`, plus `catchUpRemote` on connect and a `remote` handler for other stores' commits; `publish` sets `Out.Store` and sends to `Reaching`.
- `pkg/server/live.go`: `recheck` also reopens a view whose space changed.
- `pkg/server/rtassets.go`: `serveAssetBlob` walks the origin's store, then `assetStores`; new ids `ids.New("a", 16)`.
- `pkg/rt/query.go`: `ValidateShape` (everything but the collection path, which the space checks).
- `pkg/server/pathspace_test.go`: `TestAliasReadsAnotherStore`, `TestAliasNeedsTheLevelOnTheTarget`, `TestAliasStream`, `TestStoresSpace`, `TestAliasAssets`.

### Why
- Remote cursors live on the server-side `rt.View`, which survives stream reconnects; remote docs carry no `rev`, so the runtime's single `lastRev` (the holder's) stays correct and the runtime needs no change for catch-up.
- Own commits go through the same `pageDocs` mapping as remote ones, so an alias onto the holder and `_stores/<holder>/…` subscriptions are fed without a special case.
- The view's space is decided at open, like its level, and compared on recheck; a changed binding reopens the view instead of patching a live one.

### What worked
- `GOWORK=off go test ./pkg/server -run 'TestAlias|TestStoresSpace' -count=1 -v`: all five PASS.
- Mutation checks, each restored afterwards:
  - no remote catch-up on connect → `TestAliasStream` FAIL (`catch-up after reconnect: [map[_type:hello …]]`);
  - no level ceiling (`level: v.Level`, `r.level = d.Level`) → `TestAliasReadsAnotherStore` FAIL (`write through a view alias: map[result:…]`) and `TestStoresSpace` FAIL (`write under a view _stores: …`);
  - no blob fallback → `TestAliasAssets` FAIL (`with --assets: 404 …`).
- `GOWORK=off go test ./... -count=1`: all ok. `golangci-lint run --new-from-rev=origin/main ./...`: 0 issues after two fixes (below).

### What didn't work
- `golangci-lint --new-from-rev=origin/main` first reported `pkg/rt/views.go:43:1: File is not properly formatted (gofmt)` and `pkg/rt/space.go:123:45: param cap has same name as predeclared identifier (predeclared)`. Fixed with `gofmt -w` and renaming the parameter to `ceil`.
- `Query.Validate` rejected page collections like `_stores/crm/contacts` (`ValidCollPath`); split out `ValidateShape` for page queries.

### What I learned
- `ids.New("a", 8)` is 8 random **bytes** as 16 hex characters (64 bits), not 8 characters as I wrote in the design and in Step 5. Cross-store collisions were already negligible; 16 bytes (128 bits) is chosen for the id's role as a capability.
- `confirm` runs on stream delivery and RPC once the epoch moves, and `recheck` already closes and reopens a view whose level, audience or policy changed; adding the space to that comparison was enough for alias changes.

### What was tricky to build
- Ordering for a remote subscription: `Subscribe` (so live changes reach the view), then `Watch(store, head)` with the head read **before** the documents, then the read. A commit after the head arrives on the stream; one before it is in the documents; a gap (commits while no stream is attached) triggers `catchUpRemote` from the cursor. `Watch` keeps an existing cursor, so a second subscription into the same store cannot move it backwards past changes the first one has not been sent.
- Another store's private documents: `Resolve` returns a `not_found` `PathError`; `route` turns it into an empty route, so reads are missing and queries empty (as the contract treats hidden documents), and `writeRoute` refuses writes.

### What warrants a second pair of eyes
- `serveAssetBlob`'s fallback: the bytes of another store's upload are served to anyone with the holder's sandbox origin and the id, as the holder's own uploads already are. It relies on `--assets` needing admin on the target.
- `remoteRoute` computes the viewer's level per RPC and per streamed commit (`Access.Level`), with no cache. Fine at today's scale; a view following a busy store pays it per commit.
- `Registry.Reaching` walks every open view per commit, as `Of` did.

### What should be done in the future
- The runtime still caps paths at 16 segments, so `_stores/<id>/` + 16 fails in the browser before reaching the server (next step).
- Design doc §5.3 and §10 need the corrections above (asset capability model; 8 bytes).

### Code review instructions
- Start at `pkg/server/space.go` (`route`, `remoteRoute`, `pageDocs`), then `viewEvents` in `pkg/server/views.go` (`catchUpRemote`, `remote`), then `pkg/server/pathspace_test.go`.
- `GOWORK=off go test ./pkg/server -run 'TestAlias|TestStoresSpace' -count=1 -v`

### Technical details
- Effective level on a route: own store `min(v.Level, Cap)` (Cap is `owner` for plain own paths); another store `min(Access.Level(viewer, store), Cap)`. Rules are those of the app the target store runs (`Kernel.Rules`).
- `bind.set dash contacts crm --prefix contacts --level interact` logs `bound dash contacts → crm:contacts (in pages at contacts, interact)`.

## Step 7: The runtime's depth, the browser check, and reopening on revocation

The runtime got the 18-segment limit for `_stores/<id>/` paths, and then the whole case ran in a browser: an unmodified, claude.ai-style page (`claude.use('db')`, `onSnapshot`, `"/_blob/" + id`) on a local server, reading a CRM store through an alias. Reading, pictures, live changes and the page's own writes all worked. The check found one real gap: after the viewer lost access to the CRM store, the open page kept showing its contacts. Fixed and tested; the browser then showed the page reopening to "0 contacts".

### Prompt Context
**User prompt (verbatim):** see Step 5.
**Assistant interpretation:** Finish phase 1 in the runtime and validate it end to end in a real browser.
**Inferred user intent:** Evidence that a page made in claude.ai works unchanged across stores, not only that unit tests pass.
**Commit (code):** 0d0776d — "SLOP3-008 runtime: _stores/<id>/ paths keep a store's full depth (18 segments)"; da5ea10 — "SLOP3-008: losing access to a store a page reads reopens the page"

### What I did
- `web/runtime/src/util.ts` `checkPath`: for paths starting `_stores/`, 2 more segments and `"_stores/".length + MaxSegmentBytes + 1` more bytes. `web/runtime/test/paths.test.ts` (3 tests). `make runtime` rebuilt `pkg/server/assets/claude.js` with a new source stamp.
- `ttmp/…/scripts/02-dashboard/` (`app.json`, `index.html`): the dashboard as claude.ai would write it. `ttmp/…/scripts/02-local-alias-dashboard.sh <slop>`: creates `crm` (a contact with a 32×32 PNG upload at a 16-byte id, via `files.put --zone assets`), pushes `dash`, mounts it at `/dash`, grants guests, `bind.set dash contacts crm --prefix contacts --assets`.
- Local server: `slop serve --local --listen 127.0.0.1:18320 --data $CLAUDE_JOB_DIR/tmp/e2e/data --admin-email admin@example.com`; CLI login by device code approved in the browser, with `SLOP_CREDENTIALS` pointing at a separate file (the production credentials untouched).
- Browser (Playwright tools), as a guest at `http://apps.localhost:18320/dash`: list, picture, a live `docs.set crm contacts/c2`, a note added through the page; then `grant.rm crm @guest`.
- The revocation fix: `rt.View` remote state now holds `{rev, level}` (`Watch(store, rev, level)`, `RemoteLevels`); `route.held` (the viewer's level before the ceiling); `remoteLevelsMoved` in `recheck`; `reviewViews(id)` walks `Registry.Reaching(id)`, rechecking each view against its own store's row. `TestAliasRevokeReopens`.
- Screenshots: `various/01-dashboard-alias.png`, `various/02-dashboard-after-revoke.png`.

### Why
- The browser check was the point of the phase: the server tests drive the RPC protocol, but only the real runtime shows that an unmodified page's `onSnapshot`, `orderBy` and `<img>` work through an alias.
- Reopening (rather than pushing deletions for what the viewer lost) reuses the existing mechanism for the view's own store: the shell reopens the frame and the page subscribes again under the new levels.

### What worked
- `node --test … test/paths.test.ts`: 3 pass; `pnpm test`: 12 pass; `pnpm check`: clean; `TestBuildOutputsFresh` ok after `make runtime`.
- Browser, first load: "Ada Lovelace" with her picture; `img.complete: true, naturalWidth: 32, src: "/_blob/a0123456789abcdef0123456789abcdef"`; "1 contact".
- Live: after `docs.set crm contacts/c2` the page showed Grace Hopper and "2 contacts" without a reload.
- Own write: the note "call Grace about COBOL" appeared; `docs.ls` found `notes/r7TrhYAqi3JyvW4RF0gY` in `dash` and nothing in `crm`.
- After the fix, `grant.rm crm @guest` with the page open: within 3 s the page showed "0 contacts", its note still there.
- `TestAliasRevokeReopens` passes; mutations (no level comparison in `recheck`; `reviewViews` back on `Of(id)`) each make it fail with `after losing crm: [map[_type:hello …]]`.

### What didn't work
- The gap itself: after `grant.rm crm @guest`, a new contact (Katherine Johnson) was correctly not delivered, but Ada and Grace stayed on screen until a reload.
- `slop serve` on 18300: `LISTEN … 127.0.0.1:18300 … users:(("slop",pid=1390210…))`, an older server; used `--listen 127.0.0.1:18320`, which re-derives the `*.localhost` hosts.
- `--test`'s documented `X-Slop-As` header is not implemented anywhere (`git grep -i "slop-as"` finds only the flag's help text and a config comment), so the CLI logged in by device code instead.
- The Playwright tools' schemas had changed (`browser_type`: `Invalid input: expected string, received undefined → at target`); loaded the current schemas with ToolSearch and used `target`.
- `browser_wait_for text: "2 contacts"` timed out after 5000 ms: it searches the top frame, and the page is in the shell's iframe; the snapshot showed the text was there.
- After the reopen, the console showed `404 … /_site/views/vjatpsgdui4sy6ipl`: the shell's `DELETE` of the view the server had already closed (`shell.js:129`). Existing behaviour for any access-driven reopen; harmless.

### What I learned
- `/_blob` resolution needed nothing from the runtime: the page composes `"/_blob/" + id` relative to its own sandbox origin, and the server's fallback does the rest.
- `reviewViews` is the "tell idle pages now" path; `confirm` alone would only have caught the change at the page's next RPC or the next commit of either store.

### What was tricky to build
- Which level to record. The ceiling-capped level would hide changes above the cap (a guest's crm level going from interact to view under a view alias); the raw level the viewer holds on the store (`route.held`) is what the documents shown depend on, so that is recorded and compared.

### What warrants a second pair of eyes
- `reviewViews` now rechecks views of other stores on every grant change of a followed store: one `StoreByID` per distinct holder, then `recheck` per view.
- Reopening on any level change (up or down) is coarser than needed for an increase; it matches the own-store behaviour.

### What should be done in the future
- Implement or remove the documented `X-Slop-As` test header (out of scope here).

### Code review instructions
- `web/runtime/src/util.ts` `checkPath`; `pkg/rt/views.go` (`remoteState`, `Watch`, `RemoteLevels`); `pkg/server/space.go` (`remoteLevelsMoved`); `pkg/server/live.go` (`recheck`, `reviewViews`).
- `GOWORK=off go test ./pkg/server -run 'TestAlias|TestStoresSpace' -count=1 -v`; `cd web/runtime && pnpm test`.
- Browser: run a `--local` server, log the CLI in, run `scripts/02-local-alias-dashboard.sh <slop>`, open `http://apps.localhost:<port>/dash`.

### Technical details
- The PNG is generated in the script (32×32, colour 217,119,87) and uploaded with `files.put --json '{"store":"crm","path":"a0123…","data":"<base64>","type":"image/png","zone":"assets"}'`.

## Step 8: Documentation and the design doc brought in line

The docs now say what was built: the v3 design's documents section and the claude.ai comparison describe the path space, and SLOP3-008's design records the phase-1 decisions and two corrections from implementation.

### Prompt Context
**User prompt (verbatim):** see Step 5.
**Assistant interpretation:** Keep the design and reference docs truthful about the implemented behaviour.
**Inferred user intent:** The next phase (files, registry documents) starts from an accurate design.
**Commit (code):** see the commit after this entry — "SLOP3-008: docs for phase 1 …"

### What I did
- `doc/design/slop-v3.md` §4.3: a "One path space per page" item (aliases, `_stores`, reserved `_`, levels, private documents, reopening).
- `doc/claude-apis/README.md`: the `db` and `assets` rows mention the path space and bare-id uploads through `--assets` aliases.
- SLOP3-008 design doc: §5.2 (resolution order as built; `stores` policy cell instead of "as `slop app trust`"; `as: viewer` only; private documents rule; reopening), §5.3 rewritten as implemented (capability model for blobs; no `_stores` uploads in phase 1; 8 bytes → 16 bytes), §7.1 step 3, §8 invariants, §9 phase 1 marked implemented with what is not done, §10 questions 1, 4, 5, 7 decided. Tasks and changelog updated.

### Why
- Two statements in the design were wrong once the code was read closely: asset ids were 8 random bytes, not 8 characters; and a blob fetch cannot be checked against the viewer's level, because it carries no view credential.

### What worked
- `docmgr doctor --ticket SLOP3-008`: all checks passed.

### What didn't work
- No failures observed.

### What I learned
- N/A beyond the corrections above.

### What was tricky to build
- Saying honestly what phase 1 did not do: actors' `use('db')` is unchanged, and `caps/db` became a shared resolver (`rt.Space`) rather than one shared db implementation.

### What warrants a second pair of eyes
- §5.3's decision to leave `_stores` uploads unserved in phase 1.

### What should be done in the future
- Open question 2 (writable registry documents) before phase 3.

### Code review instructions
- Read §5.2, §5.3, §9 and §10 of the design doc against `pkg/rt/space.go` and `pkg/server/space.go`.

### Technical details
- N/A.
