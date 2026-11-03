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

## Step 9: Phase 2, the files capability

The user asked for all remaining phases on the same branch. Phase 2 serves the contract's `files` capability: a page that declares `files: {project: …}` lists and reads a store's files as the viewer, with the contract's shapes and error codes. The project is `_stores` or one of the holder's aliases.

### Prompt Context
**User prompt (verbatim):** "do all phases, we don't need so many PRs" and, mid-step, "commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Implement phases 2–6 of SLOP3-008 on `task/slop3-008-data-assets` (PR #20) rather than in new PRs, committing at milestones and keeping this diary.
**Inferred user intent:** One reviewable PR that delivers the whole design, not a stream of small ones.
**Commit (code):** 915a96e — "SLOP3-008 phase 2: the contract's files capability over store snapshots"

### What I did
- `pkg/rt/manifest.go`: `Caps.Files` from `capabilities.files.project` (`_stores` or a plain segment).
- `pkg/server/views.go`: `grantedCaps` grants `files` when a project is set (for `_stores` only when the view's space reaches `_stores`); RPCs `files.list`, `files.read` (action `DocRead`).
- `pkg/server/rtfiles.go`: `reachableStores` (owned or granted stores, every store for a platform admin, each at least view after the ceiling), `filesStore` (project path → store, inner path; viewer's level there capped by the alias's level or `db.stores`), `treeOf` (the main snapshot), `listTree` (direct children with synthesized folders, or everything below), paging by an offset cursor, `rpcFilesRead` (offset/length ≤ 25 MiB, base64 bytes, `revision` = sha256).
- `pkg/verbs/stores.go`: `visibleStores` → `VisibleStores` (exported), callers in `stores.go` and `mounts.go`.
- `web/runtime/src/caps.ts` `files()`, `index.ts`: `list`, `read` (bytes as `Uint8Array`), `download` (chunked read with revision check, then `ask("download")`; program extensions refused with `bad_request`), `asSampleTools` (`list_project_files`, `read_project_file` at 12 KB); errors mapped to the contract's codes.
- `pkg/server/pathspace_test.go`: `TestFilesCapability` (alias project: not_found without a grant, top level, a folder, recursive, a ranged read, four error cases; `_stores` project: not granted before the policy cell, then the stores as folders and a read).

### Why
- The store's `main` snapshot is what `slop.read`'s `file`/`files` ops already read, and what a mount serves: "the project's files" for an app store.
- `revision` as the content hash satisfies the contract ("differs once the file's contents change") without tracking snapshot numbers per file.
- No consent prompt: on slop every granted capability is reported `granted` (`permissionStates`), because an admin installs and approves apps.

### What worked
- `GOWORK=off go test ./pkg/server -run TestFilesCapability -count=1`: ok. Mutation (`if false && min(held, ceil) < rt.LevelView`) → FAIL `without a grant on crm: map[result:map[entries:[…]]]`, restored.
- `pnpm check` clean, `pnpm test` 12 pass; `make runtime`; `TestBuildOutputsFresh` ok; `go test ./...` ok; lint 0 issues after one fix.

### What didn't work
- `golangci-lint`: `pkg/server/rtfiles.go:62:1: named return "storeID" with type "string" found (nonamedreturns)`; rewrote `filesStore` with plain returns.
- First `sed` to export `visibleStores` missed `pkg/verbs/mounts.go:109:18: undefined: visibleStores`; fixed there too.

### What I learned
- `grantedCaps` is the single gate for runtime methods: `viewRPC` refuses `<cap>.<method>` when `<cap>` is not granted, so `files` needed only a grant rule, not per-RPC checks.

### What was tricky to build
- Folder synthesis: snapshots hold files only. A non-recursive list emits each file directly in the folder plus one folder entry per first segment below it; a recursive list emits every file and every intermediate folder. A path that is a file is `bad_request` for `list`, a path with nothing under it `not_found`.

### What warrants a second pair of eyes
- `reachableStores` for a platform admin lists every store; for others it lists owned and granted stores. A store a viewer reaches only through a share link does not appear at the top level, although it can still be read by path.

### What should be done in the future
- N/A for this phase.

### Code review instructions
- `pkg/server/rtfiles.go`, then `TestFilesCapability`; `web/runtime/src/caps.ts` `files()`.
- `GOWORK=off go test ./pkg/server -run TestFilesCapability -count=1 -v`

### Technical details
- List page: `{entries: [{path, isDirectory, size}], cursor?}`; read: `{bytes (base64 on the wire, Uint8Array in the page), size, revision}`.

## Step 10: Phase 3, the registry as documents

Phase 3 makes the registry rows an app may see readable through the db API: `_stores`, `_stores/<id>`, `_stores/<id>/_grants|_bindings|_llm/…` and `_people/…`. A dashboard written for claude.ai's db can therefore list stores and their grants, and change them, without a slop-specific API. Each read and write runs the verb that owns the row as the viewer, so the db path adds no authority of its own.

### Prompt Context
**User prompt (verbatim):** see Step 9 ("do all phases, we don't need so many PRs"; "commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)").
**Assistant interpretation:** Phase 3 of the design, on the same branch, with an investigation entry.
**Inferred user intent:** The registry as data under one object model, decided earlier as "no need to keep these live for now" (open question 6).
**Commit (code):** 6acea8e — "SLOP3-008 phase 3: the registry as documents"

### What I did
- `pkg/rt/space.go`: `Resolve` returns `Target{Registry: true}` for `_stores` (when the path is the collection itself), `_stores/<id>` (a document: the row), `_stores/<id>/_grants|_bindings|_llm[/…]` and `_people[/…]`; other `_`-segments under a store stay refused. `space_test.go` gained the cases.
- `pkg/server/registry.go` (new): `registryColl` / `registryDoc` for reads; `registryWriteOf` maps a write to `{verb, args, change kind, key}`; `registryWrite` gates and runs it.
- `pkg/server/views.go`: `dbGet` and `readable` (query/subscribe snapshot) answer registry targets from `registry.go`; `dbWrite` resolves the route first and hands registry targets to `registryWrite`, returning `{version, rev: 0}`.
- `pkg/system/stores.go`: `LastChange(kind, key)` = `max(rev)` in system `_changes` for a row, used as the document's version and for `ifVersion`.
- `web/runtime/src/db.ts`: `writeRPC` answers `confirmation_required` with `ask("confirm", {confirm})` and retries (a deny rejects `confirmation_declined`); `test/db.test.ts`'s transport mock gained `ask`. `make runtime` rebuilt `pkg/server/assets/claude.js`.
- `pkg/server/pathspace_test.go`: `TestRegistryDocuments`, `TestRegistryWritesNeedAdminStores`, helper `adminView`; `TestStoresSpace`'s phase-1 placeholder ("registry documents read as missing") now expects the row.

### Why
- Running the owning verb as the viewer (`personAs(ctx, user, "app:"+app)`) keeps a single place for every registry rule: `grant.ls` needs admin on the store, `people.ls` needs a platform admin, and the db path inherits both. A read the verb refuses shows nothing, the way an unreadable document does.
- Confirmation: changing grants or roles changes who may do what, so it is confirmed in the shell like module calls that change governance (`Confirmations().Check`, the same store `slop.call` uses). Refusing with `verbs.Check` first means nobody is asked to approve something that would fail anyway.
- Versions from `_changes`: every registry verb already logs a change with a stable key (`store`=id, `grant`="<store> <subject>", `binding`="<store> <alias>", `person`=id), so `ifVersion` costs one indexed query rather than a version column on each table.
- Writable set (closes open question 2): grants, aliases, a store's type, a person's role. Owner, app, ids and the LLM budget are read-only; a grant from a share link (`<subject>~<via>`) is changed by revoking the link.

### What worked
- `GOWORK=off go test ./pkg/server -run TestRegistry -count=1 -v`: both pass.
- Mutations, each restored from `$CLAUDE_JOB_DIR/tmp/registry.go.bak`:
  - confirmation skipped → `a registry write without confirmation: map[result:map[rev:0 version:11]]`
  - ifVersion ignored → `stale ifVersion: map[error:map[code:confirmation_required …]]`
  - `db.stores` gate removed → `TestRegistryWritesNeedAdminStores: a registry write with stores view: map[error:map[code:confirmation_required …]]`
- `make runtime`, `pnpm test` (12 pass), `GOWORK=off go test ./... -count=1` ok (incl. `TestBuildOutputsFresh`), `golangci-lint run --new-from-rev=origin/main ./...` 0 issues.

### What didn't work
- `TestStoresSpace` failed after the change: `pathspace_test.go:226: _stores/crm: map[body:map[… id:crm level:view …] exists:true …]` — the test pinned phase 1's "missing" behavior; updated to expect the row and two stores (`crm` and the console app's own store, which the guest also holds).
- My `sed` for that count matched the same `len(docs) != 1 {` text in `TestAliasRevokeReopens` (line 308) too, failing it with `subscribe: [map[body:map[name:Ada] …]]`; reverted that line by number.

### What I learned
- `rt.Doc.Version` is per-document; for registry rows the system revision works because system `_changes` is the registry's single ordered log, so versions are monotonic per row, as `ifVersion` needs.

### What was tricky to build
- Ordering in `dbWrite`: page writes validated the path with `validPath` before routing, which rejects `_` segments. Registry targets had to be recognised by the space first, then sent past the document-store path entirely (there is no store turn, so `rev` is 0 and no `doc` event is published).
- The confirmation retry: the page's `db.set` promise must stay pending while the person decides in the shell. The runtime does it with `ask("confirm")` (which resolves after the shell's approve/deny) and a retry, at most four rounds, the same loop `caps.ts` uses for `slop.call`; a deny rejects with `confirmation_declined`.

### What warrants a second pair of eyes
- A guest view of `_stores/<id>` shows `owner` (a person id) for any store the guest can open. Person ids are opaque but stable; review whether `owner` should be dropped below admin.
- Registry documents are not live: a `db.subscribe` on `_stores/…` gets one snapshot and no updates, by the earlier decision. A page polling with `get` is fine; a page waiting on `onSnapshot` will not see a grant it just wrote.

### What should be done in the future
- Live registry documents if a page needs them: publish a synthetic `doc` event from the system `_changes` hook to views whose space reaches `_stores`.

### Code review instructions
- Start at `pkg/server/registry.go` (top comment lists the paths), then the three registry branches in `pkg/server/views.go` (`dbGet`, `readable`, `dbWrite`), then `TestRegistryDocuments`.
- `GOWORK=off go test ./pkg/server ./pkg/rt -run 'TestRegistry|TestSpace|TestStoresSpace' -count=1 -v`

### Technical details
- Write mapping:

| Path | op | verb |
|---|---|---|
| `_stores/<id>` | update `{type}` | `store.type` |
| `_stores/<id>/_grants/<subject>` | set `{level}` / delete | `grant.set` / `grant.rm` |
| `_stores/<id>/_bindings/<alias>` | set `{target, prefix?, level?, assets?}` / delete | `bind.set` / `bind.rm` |
| `_people/<id>` | update `{role}` | `people.role` |
| `_stores/<id>/_llm/budget` | — | read-only |

- Error codes: `invalid_argument` (no `db.stores` "admin", a field the verb does not take, read-only document), `permission_denied` (no signed-in person), `conflict` (stale `ifVersion`), `confirmation_required` + `confirm` id (until approved), then whatever the verb returns.

## Step 11: People read-only, and phase 4, alias templates on mounts

Two commits. First, a correction to step 10: `_people/<id>` had been writable (`update {role}` → `people.role`). The design's open question 2 says people stay read-only through `db`, so I removed that write. Second, phase 4: a parameterised mount that creates stores now binds each new store from a template, so a dashboard created at `/d/:id` reads `contacts/…` from `crm` from its first view.

### Prompt Context
**User prompt (verbatim):** see Step 9.
**Assistant interpretation:** Phase 4 of the design, plus aligning phase 3 with the design's stated answer to open question 2.
**Inferred user intent:** Stores created from a URL come wired to the data they are meant to show, without an admin binding each one.
**Commit (code):** 3d524e0 — "SLOP3-008 phase 3: people stay read-only through db"; cf8eaaa — "SLOP3-008 phase 4: alias templates on mounts"

### What I did
- `pkg/server/registry.go`: dropped the `_people` write case (it falls through to "read-only"); `TestRegistryDocuments` now asserts the refusal.
- `pkg/system/migrations/010_mount_aliases.sql`: `mounts.aliases TEXT NOT NULL DEFAULT ''` (a JSON array of bindings without their store).
- `pkg/system/mounts.go`: `Mount.Aliases []Binding`; scanned and written by `SetMount` and by `UndoMount`'s re-insert (`aliasesJSON`).
- `pkg/system/bindings.go`: `Binding.Store` is `omitempty`, so template entries don't carry `"store": ""`.
- `pkg/verbs/actors.go`: bind.set's validation moved into `checkAlias(ctx, e, p, *Binding)`, which checks the alias and prefix, takes a level only with a prefix, and requires the caller to hold that level on the target (admin if assets are shared). bind.set itself is unchanged.
- `pkg/verbs/mounts.go`: `mount.set --aliases` (json), parsed by `aliasTemplate`. Only the fields alias, target, prefix, level and assets are allowed; an alias may not appear twice; each entry goes through `checkAlias` against the admin. Aliases require `createApp`.
- `pkg/server/live.go`: `/_site/create` writes the template's bindings on the new store with via `mount:<host><path>`.
- `TestMountAliasTemplate`: four invalid templates, aliases without createApp, and a missing target (`not_found`). mount.ls shows the template. A signed-in admin creates at `/d/new` and the store comes bound, so the new page reads `contacts/c1` from crm. Replacing the mount drops the template and `mount.undo` brings it back.
- Docs: `doc/claude-apis/README.md` was missing phases 2–4. The `files` row still said "Not served"; it now describes the project mapping, and the `db` row gains the registry documents and templates. `doc/design/slop-v3.md` §4.3 is updated to match.

### Why
- The template is checked when the admin sets the mount, not when a member creates a store: the creator usually holds nothing on `crm`. Holding nothing doesn't matter, because aliases never grant access. Every read through one is as the viewer, capped by the alias's level. So the check only has to stop an admin from templating a level they don't hold themselves, which is the same rule bind.set applies.
- The bindings are written as ordinary bindings, so the new store's owner can change or remove them with bind.set and bind.rm, and they show up in `_stores/<id>/_bindings`.

### What worked
- `GOWORK=off go test ./pkg/server -run TestMountAliasTemplate -count=1`: ok.
- Mutations, each restored from `$CLAUDE_JOB_DIR/tmp/*.bak`:
  - `range m.Mount.Aliases[:0]` → `pathspace_test.go:572: the new store's bindings: []`
  - `checkAlias` removed from `aliasTemplate` → `mount.set … alias:_stores …: want invalid_argument, got 200`
- `GOWORK=off go test ./... -count=1` ok; `golangci-lint run --new-from-rev=origin/main ./...` 0 issues. (A plain `golangci-lint run ./pkg/server/` reports 3 issues in older code, ineffassign ×2 and nonamedreturns ×1. None is on this branch.)

### What didn't work
- My first pass at `system.SetMount` missed `UndoMount`, which re-inserts the previous mount with its own column list; undo would have silently dropped a template. I caught it reading the file before testing, and the undo assertion in the test now covers it.

### What I learned
- `mount_log` stores whole mounts as JSON (`mountJSON`), so a new field on `Mount` round-trips through undo for free. Only the SQL column lists need updating.

### What was tricky to build
- Keeping bind.set's error messages unchanged when its checks moved into `checkAlias`. The messages still say `--level`/`--prefix`, which reads a little oddly for a JSON template but is still accurate.

### What warrants a second pair of eyes
- If writing a template binding fails after `CreateStore`, `/_site/create` returns the error, but the store has already been created without its bindings. That's recoverable (the owner binds it), but not atomic.
- A template's target can be removed after the mount is set. The bindings are then written at creation against a store that is gone, and the alias resolves to `not_found` (empty) until it is rebound.

### What should be done in the future
- N/A for this phase.

### Code review instructions
- `pkg/verbs/mounts.go` `aliasTemplate`, `pkg/verbs/actors.go` `checkAlias`, `pkg/server/live.go` `siteCreate`, then `TestMountAliasTemplate`.
- `GOWORK=off go test ./pkg/server -run 'TestMountAliasTemplate|TestRegistry' -count=1 -v`

### Technical details
- CLI: `slop mount set apps.example /d/:id --storeParam id --createApp dash --aliases '[{"alias":"contacts","target":"crm","prefix":"contacts","level":"view"}]'`.

## Step 12: Phase 5, Durable-Object-shaped storage for actors

Phase 5 gives actors `use('storage')`, also available as `ctx.storage`, with the shape of Cloudflare's `DurableObjectStorage`: key-value get/put/delete/list, transactions, a synchronous `kv`, `sql.exec` cursors and the single alarm. It is a JavaScript adapter over the actor's existing `db`, `sql` and `alarm` modules. Only the cursor needed new Go code, to keep column order and count rows written.

### Prompt Context
**User prompt (verbatim):** see Step 9.
**Assistant interpretation:** Design §6.2's recommendation, "the adapter … Durable-Object-shaped, never compatible", built and tested.
**Inferred user intent:** Code written with the DO storage model reads naturally on slop, without claiming Workers compatibility.
**Commit (code):** e339f8a — "SLOP3-008 phase 5: Durable-Object-shaped storage for actors"

### What I did
- `pkg/actor/storage.js` (embedded) is a factory over `(db, sql, alarm, keyID, sqlTable)` that returns a frozen storage object:
  - `get` and `put` take a single key, an array or an object; `delete` takes a key or an array. Both return settled promises.
  - `list`, with `start`, `startAfter`, `end`, `prefix`, `reverse` and `limit`; `deleteAll`.
  - `transaction` (writes buffered in an `overlay`) and `transactionSync` (the overlay inside an SQL savepoint).
  - `kv`, the synchronous API.
  - `sql.exec` returns a cursor.
  - `getAlarm`, `setAlarm` and `deleteAlarm` work on the alarm named `alarm`; `sync()`.
- `pkg/actor/storage.go`:
  - `storageKeyID` returns the key itself, or `~`+sha256 when the key isn't a valid segment or starts with `~`;
  - `storageModule` builds the object once per VM and caches it on `Actor.storage`;
  - `sqlTable` wraps `QueryTable`.
- `pkg/actor/modules.go`: a `case "storage"`. `pkg/actor/actor.go`: the `storage` field, and a `ctx.storage` accessor in `ctxObject`.
- `pkg/store/turn.go`: `Turn.QueryTable(caller, q, args)` returns the columns, rows as arrays in column order, and rows written (the change in `total_changes()`).
- `pkg/server/durable_storage_test.go`: `TestDurableStorage`, with these actions:
  - `kv`: batches; UTF-8 order with U+FF01 vs U+1F600; each list option; delete return values.
  - `clear`.
  - `tx`: a failed transaction leaves nothing; `rollback()`; reads its own writes; isolated from `storage.get`.
  - `sync`: savepoint rollback of SQL and kv together; cursor shapes.
  - `alarm`: set, get, fire through `alarms.alarm`, delete.
  - `bad`: seven `invalid_argument` cases, and DDL refused.
- `doc/design/slop-v3.md`: a `storage` row in the capability table, and a paragraph in §6 listing the differences.

### Why
- **Documents rather than a kernel table.** The design maps `storage.get/put` to `db` documents, and documents bring the log, export, reactors and the back office for free. A hidden `_storage` collection would need `Turn.SetDoc` to accept `_`-prefixed paths, which `validPath` refuses everywhere (the phase 1 reservation). So the collection is the ordinary `storage/`, and the docs say how to close it with a `self` rule.
- **`{key, value}` bodies and hashed ids.** DO keys are arbitrary strings up to 2 KiB; path segments are at most 200 bytes from `[A-Za-z0-9_.~:@+-]`. Keeping the real key in the body lets `orderBy('key')` sort on the server with `strings.Compare`, which is UTF-8 byte order, the same as DO.
- **Buffered transactions.** Rolling `_docs` back to an SQL savepoint would leave the Turn's in-memory change records (`t.record`) out of step with the database, publishing events for writes that never happened. A JS-side buffer avoids touching savepoints for documents. `transactionSync` still uses the existing `sql.transaction` savepoint for app tables, which the Turn reports only as "tables written", where over-reporting is harmless.
- **Settled promises.** goja runs the job queue before a turn ends, so `await storage.get(k)` resolves in the same turn. `actors_test`'s `boom` (`await Promise.resolve(1)`) already relies on this.

### What worked
- `GOWORK=off go test ./pkg/server -run TestDurableStorage -count=1`: ok.
- Mutations, each restored from `$CLAUDE_JOB_DIR/tmp/storage.*.bak`:
  - `if (false) t.commit()` → `tx keys = []interface {}{"k"}, want … {"w"}`
  - `r = fn()` (no savepoint) → `rows = [… "x" … "y"], want [… "y"]`, `read = 2`, `raw = [[4]]`
  - `HasPrefix(key, "~~~")` → `docs.get storage/~t: want not_found, got 200`
- `GOWORK=off go test ./... -count=1` ok; `golangci-lint run --new-from-rev=origin/main ./...` 0 issues after one fix.

### What didn't work
- My first `QueryTable` read `rows.Columns()` after `scanMaps` had closed the rows. That would have failed with "Rows are closed", and maps would also have collapsed duplicate column names (`SELECT v, v AS w` is fine, but `SELECT v, v` is not). I rewrote it to scan into arrays before testing.
- Lint: `pkg/store/turn.go:237:19: Error return value of rows.Close is not checked (errcheck)` (and :263); fixed with `defer func() { _ = rows.Close() }()` and a checked explicit close.
- Test harness: `h.call` aborts on a 404, so the "not stored under its own name" check needed `h.fail(…, "not_found")`; `docs.ls` takes `coll`, not `path`.
- The first run of the key-hash mutation printed nothing: removing `strings.HasPrefix` left `strings` unused, so the package didn't compile. I reran it as `HasPrefix(key, "~~~")`.

### What I learned
- `total_changes()` is per connection and cumulative, so the difference before and after one statement on the turn's writer connection is exactly what that statement wrote, which should include `INSERT … RETURNING` (not tested here).

### What was tricky to build
- The order of prefix and reverse in `base.list`. The server query filters `key >= prefix`, so ascending, the first key past the prefix ends the scan. Descending, keys past the prefix come first and are skipped, not treated as the end.
- `transactionSync` sets `current` so that `storage.kv.*`/`storage.put` inside `fn` go to the buffer, resets it in `finally`, and only then commits. That way the commit writes to the base store, and a throw from `fn` leaves nothing behind.

### What warrants a second pair of eyes
- `deleteAll` inside `transactionSync` bypasses the buffer and deletes directly. A throw then still rolls the SQL back but not the deletions, though the turn as a whole rolls back if the throw is not caught.
- The `storage/` collection is readable by pages under the app's rules by default, while DO storage is private. That choice is documented rather than enforced.

### What should be done in the future
- A `storage.collection` setting in `app.json`, if an app already uses `storage/` for something else.

### Code review instructions
- `pkg/actor/storage.js` top to bottom (header comment, `base`, `overlay`, `transaction`, `transactionSync`), then `pkg/actor/storage.go`, `Turn.QueryTable`, and `TestDurableStorage`.
- `GOWORK=off go test ./pkg/server -run TestDurableStorage -count=1 -v`

### Technical details
- Example:

```js
defineActor({
  actions: {
    async incr(ctx) {
      const n = ((await ctx.storage.get('n')) || 0) + 1;
      await ctx.storage.put('n', n);
      if (!(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(ctx.now + 60000);
      return n;
    },
  },
  alarms: { alarm(ctx) { /* runs once, at the time set */ } },
});
```

## Step 13: Addressing the code review of PR #20

The automated review of PR #20 raised five findings. All five were real, and all five are fixed, each with a test that fails without its fix. Three were small: the runtime's deep `freeze` threw on a file's bytes, an empty `files.list` returned `null`, and storage keys with slashes escaped `list`/`deleteAll`. Two concerned another store's stream. An alias subscription made before the viewer could read the target never followed the store, so a later grant did nothing. And a reconnect resumed another store from what the server had written, not from what the browser had received.

The stream resume needed a design change. Diary step 5 kept remote documents rev-less so that the runtime's single cursor stays the view's own store's rev. That left the server-side cursor as the only record, and it moved on `writeSSE`, which is not delivery. Remote documents now carry an opaque store key (`remote`) and, on a commit's last document, that store's rev (`remoteRev`). The runtime keeps the newest per key and sends them back as `?remote=key:rev,…`. The server resumes from those values, capped by what it sent and floored at where the view started following. That makes delivery at-least-once, never lossy, and `db.ts`'s version checks make a repeat a no-op.

### Prompt Context
**User prompt (verbatim):** "Address code review for https://github.com/go-go-golems/slop-computer/pull/20 in a subagent (medium thinking)"
**Assistant interpretation:** Fix each of the five chatgpt-codex-connector comments on PR #20 with a test and a mutation check. Commit and push to the branch. Do not post anything on GitHub.
**Inferred user intent:** The PR merges without known data-loss or crash bugs in the new path-space, files and storage features.
**Commits (code):** 730f216 (freeze), 1db065b (empty listing), 6fc5642 (storage keys), a05da03 (grant reopens), 0cf5ccd (remote resume)

### What I did
- **Freeze (P1, 4458467545).** `web/runtime/src/util.ts` `freeze` skips `ArrayBuffer.isView` values. New `web/runtime/test/files.test.ts` covers `files.read`, `download` and `read_project_file` on a non-empty file, and empty listings.
- **Empty listing (4458467570).** `rpcFilesList` (`pkg/server/rtfiles.go`) turns a nil `entries` into `[]`. The runtime's `list` also reads `r.entries ?? []`. `TestFilesListEmpty` binds an alias to a store with no snapshot.
- **Storage keys (4458467559).** `storageKeyID` (`pkg/actor/storage.go`) uses a key as its own id only when it has no `/`, as well as the existing checks. `TestDurableStorage` now puts `a/b/c` and `x/y`, expects them in `list()` and ranges, and checks `docs.ls storage/a/b` is empty after `deleteAll`. Comments in `storage.go`/`storage.js` and `doc/design/slop-v3.md` §6 now say "a single valid path segment (no `/`)".
- **Grant reopens (4449653057).** `route` has a `found` flag, set by `remoteRoute` once the store row exists. `rpcDBSubscribe` follows a found store even when `r.st` is nil (no access), opening it for its head and calling `v.Watch(id, head, r.held)` with `held` = none. A grant then moves the level, so `remoteLevelsMoved` → `recheck` sends `access`, just as a revoke does. Test: `TestAliasGrantReopens`.
- **Remote resume (4449653067).**
  - `pkg/rt/views.go`: `remoteState` gains `base` (the rev it started following from) and `key` (`"1"`, `"2"`, … in Watch order). Added `RemoteKey`. `Remotes()` was replaced by `Resume(confirmed)`, which returns `max(base, min(confirmed[key], sent))`.
  - `pkg/server/views.go`: `docOut` gains `remote`/`remoteRev`. A new `sendRemote` tags remote documents, both live (`remote`) and in catch-up (`catchUpRemote`, which now collects and then sends). The reconnect loop reads `remoteCursors(?remote=)`.
  - `web/runtime/src/transport.ts`: `remoteRevs`, updated in `dispatch("doc")`, appended to the stream URL, and cleared on `newview`.
  - Tests: `TestAliasResumeFromClientCursor` and `web/runtime/test/resume.test.ts`.

### Why
- **Opaque keys, not store ids.** The page shares a realm with the runtime and could read the wire. An alias should not tell the page which store it points at, so the key is per view and means nothing outside it.
- **At-least-once rather than exact.** The server cannot know what reached the browser unless the browser says so. A tag only on a commit's last document means "everything up to this rev arrived", because the stream is in order. Commits with no visible documents never move the runtime's cursor, so a resume can repeat more than it needs to. That costs bandwidth, never correctness. In `db.ts`, `intoMirror` drops anything with `version <= seen`, deletions included, and catch-up sends full bodies, never patches, so a repeated document is a no-op.
- **Floored at `base`, capped at what was sent.** A client value below `base` would replay history that is older than its snapshot. A value above what was sent is either a lie or belongs to another view. Neither helps.
- **Following at no access, rather than a new mechanism.** `recheck` already reopens a view whose remote level moved (step 6, `TestAliasRevokeReopens`). Recording the dependency at none reuses that mechanism. Remote commits at none are filtered out by `pageDocs` (`level == none`), so nothing leaks before the grant.

### What worked
- Mutation checks (originals kept in `/home/manuel/.claude/jobs/7fa934c5/tmp`):
  - `freeze` from HEAD: the three non-empty file tests fail with `code: 'unavailable'`, underlying `Error: Cannot freeze array buffer views with elements`.
  - `rtfiles.go` from HEAD: `pathspace_test.go:424: empty project: map[result:map[entries:<nil>]]`.
  - `storage.go` from HEAD: `all = […"a", "b", "c/d", "x/y"…], want […"a", "a/b/c", "b"…]`, the same for `range` and `left`, and `storage/a/b after deleteAll: [storage/a/b/c]`.
  - `views.go` from HEAD (grant): `after gaining crm: [map[_type:hello …]]`, with no `access` event.
  - `Resume` returning the sent rev: `pathspace_test.go:237: resume without a remote cursor: []`.
  - `transport.ts` from HEAD: `actual '/_rt/events?after=3'`, expected `'/_rt/events?after=3&remote=1%3A5'`.
- `GOWORK=off go test ./... -count=1`: all ok. `golangci-lint run --new-from-rev=origin/main ./...`: 0 issues. `pnpm test`: 17 pass. `pnpm check`: clean. `make runtime` was rebuilt and `TestBuildOutputsFresh` passes.

### What didn't work
- `gofmt` put the new `strconv` import out of order in `pkg/rt/views.go`. `gofmt -w` fixed it.

### What I learned
- `Object.freeze` on a typed array is a TypeError only when the array has elements. An empty file passes, which is why a check that only used empty fixtures would miss this bug.
- `storage/x/y` was always hashed, because it is a collection path and `ValidDocPath` refuses it. Only keys with an even number of extra segments slipped through.

### What was tricky to build
- Tagging only the last document of each commit in both send paths. The tag has to mean "this commit arrived whole". `catchUpRemote` used to write as it scanned, so it now collects `(doc, rev)` pairs first, as `sendAll` does for the view's own store.
- `Resume` must not move the server-side "sent" cursor backwards. Live dedupe (`o.Rev <= from`) still uses it, and `catchUpRemote` reads from the client's value up to the current head, so everything in between is re-sent once.

### What warrants a second pair of eyes
- The client's value is trusted within `[base, sent]`. A lower value only re-reads documents the viewer may read anyway, through `readerFor`. I could not find a way to get anything it may not read.
- A view that follows a store at no access gets that store's commits on its channel, and each costs a `confirm` and a filtered read. It ends at the next reopen.
- `known.delete` in `db.ts`'s doc handler runs even for a repeated deletion. That cache only holds patch bases, so the worst case is one refetch.

### What should be done in the future
- Possibly a cursor-only event (`remote`/`remoteRev` with no document) at the end of `catchUpRemote`, so commits with no visible documents also move the runtime's cursor and repeats get smaller.

### Code review instructions
- `git diff de702b4..0cf5ccd`. Start with `pkg/rt/views.go` (`Resume`), then `viewEvents` in `pkg/server/views.go` (`sendRemote`, `catchUpRemote`, the reconnect loop, `remoteCursors`), then `dispatch` and `startStream` in `web/runtime/src/transport.ts`.
- `GOWORK=off go test ./pkg/server -run 'TestAlias|TestFilesList|TestDurableStorage' -count=1 -v`; `cd web/runtime && pnpm test`

### Technical details
- Wire, a remote commit of two documents:

```
event: doc
data: {"path":"contacts/c1","version":1,"body":{…},"remote":"1"}
event: doc
data: {"path":"contacts/c2","version":1,"body":{…},"remote":"1","remoteRev":5}
```

- The reconnect: `GET /_rt/events?after=3&remote=1%3A5`. The server resumes store `1` from `max(base, min(5, sent))`.
