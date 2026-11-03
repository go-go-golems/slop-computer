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
