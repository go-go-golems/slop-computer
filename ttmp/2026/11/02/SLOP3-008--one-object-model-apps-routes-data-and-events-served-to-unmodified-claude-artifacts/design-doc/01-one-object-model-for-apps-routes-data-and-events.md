---
Title: One object model for apps, routes, data and events
Ticket: SLOP3-008
Status: active
Topics:
    - architecture
    - sqlite
    - routing
    - hosting
    - access
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://doc/claude-apis/README.md
      Note: What slop's runtime serves differently from the claude.ai artifact contract
    - Path: repo://doc/design/slop-v3.md
      Note: The v3 design this review measures; sections 4 (store), 8 (events), 9 (access), 10 (serving)
    - Path: repo://pkg/actor/modules.go
      Note: The actor's use() catalog, including stores.open(alias)
    - Path: repo://pkg/actor/storage.js
      Note: phase 5, the Durable-Object-shaped storage adapter
    - Path: repo://pkg/server/registry.go
      Note: phase 3, registry rows as documents
    - Path: repo://pkg/store/store.go
      Note: The per-store schema (_docs, _files, _log, _changes, _snapshots, _refs, _migrations, _cursors, _alarms)
    - Path: repo://pkg/system/migrations/001_init.sql
      Note: The registry (stores, mounts, bindings, grants) and the system log
    - Path: repo://web/runtime/src/index.ts
      Note: The page's use() resolver; bindings reach pages only as slop.stores.open
ExternalSources: []
Summary: 'A from-scratch answer to "how would you unify apps, routes, data and events", measured against slop v3: keep the store as the one object; one db path space per page, its own store at the root and every store under _stores/<id>/ (registry rows in _-prefixed subcollections); aliases so unmodified Claude artifacts reach other stores through their own db and files APIs; Durable Objects as a shape v3 already has.'
LastUpdated: 2026-11-02T23:30:00-05:00
WhatFor: Deciding the next structural step for slop v3's data model, before building an admin console or a multi-store app as plain Claude artifacts.
WhenToUse: Read before changing bindings, the system database, the page runtime's db or files capabilities, or before promising Durable Objects compatibility.
---

# One object model for apps, routes, data and events

## 1. Summary

The question was: if we started from scratch, how would we unify **apps**,
**routes**, **data** and **events** so that apps straight out of claude.ai
run unmodified (their `db` API included), custom apps get Durable-Object-like
behaviour, and admin tools and multi-database apps are ordinary apps?

The answer has four parts.

1. **One object, the store.** A store is a SQLite file holding documents,
   a file tree with snapshots, the app's own SQL tables, a log, cursors and
   alarms, and it has one writer at a time. An app is a store whose files are
   code. A data store is a store that runs an app. slop v3 already has
   exactly this (`pkg/store/store.go`), and it is the right foundation. A
   from-scratch design arrives at the same place.
2. **Three relations on top of it.** A *grant* says who holds which level on
   a store. A *binding* gives code aliases into one path space: the page's
   own store at the root, every other store under `_stores/<id>/`. A
   *route* (a mount) maps a URL to code plus a binding. An "instance" is not
   an object; it is the tuple (code, binding, principal) worked out for each
   request.
3. **The registry reads as documents of the stores it describes.** A
   store's row is `_stores/<id>`, its grants `_stores/<id>/_grants/*`, its
   aliases `_stores/<id>/_bindings/*`; writes go through the verbs that own
   the rows. An admin console is then an ordinary app approved to reach
   `_stores`, and it can be a plain Claude artifact.
4. **Durable Objects are a shape v3 already has.** A store with an actor is
   a Durable Object with JS as the only language. Matching the API *shape*
   is a small adapter. Matching it *one-to-one* means hosting the Workers
   runtime, which is a different project.

What v3 lacks is not a new primitive. It is three seams where the one
primitive is not used uniformly:

| Seam | Today | Proposed |
|---|---|---|
| The registry | `system.db` is store-shaped (it has `_log` and `_changes`) but apps reach it only through verbs or a trusted `system` module | registry rows read as documents under `_stores/<id>/`, written through their verbs |
| Bindings | `alias → target`, reachable only through slop's own API (`slop.stores.open` in pages, read-only; `stores.open` in actors) | aliases into one path space (`_stores/…`), served through the page's own `db` and `files` |
| App source | the actor's `files` module and `slop.read` | Claude's `files` capability, served over a bound store's tree |

## 2. The test cases

Every proposal below is checked against three apps:

- **The admin console.** Admins use it to list apps, edit their metadata,
  read their source, change grants. Written in claude.ai, with no
  slop-specific code.
- **The multi-store dashboard.** A claude.ai artifact that reads contacts
  from a CRM store and pages from a Blocks workspace, and writes notes to its
  own store, using only `db.collection(...)` as Claude wrote it.
- **A Durable-Object-style app.** A custom app with an actor: per-object SQL,
  alarms, an HTTP handler, a WebSocket-ish channel, one object per name
  (a room per game, a counter per page).

## 3. The four base objects, and what v3 makes of them

Each of the four objects in the question already has a place in v3. Before
proposing changes, it helps to see that place precisely, because most of
the unification is already done.

### 3.1 Data is a store

A store is one SQLite file (`pkg/store/store.go`). Its system tables:

| Table | Holds |
|---|---|
| `_docs` | path → JSON body, with `version` (per document) and `rev` (the commit that wrote it) |
| `_files` | the file tree (`zone = 'tree'`) and uploaded assets (`zone = 'assets'`), each a path → blob hash |
| `_snapshots`, `_snapshot_files`, `_refs` | immutable snapshots of the tree, and named pointers (`main`, `live`) |
| `_log`, `_changes` | one row per commit (who, via, which app), and what each commit changed |
| `_migrations` | the app's own SQL schema, applied in order |
| `_cursors` | how far this store's reactors have read another log |
| `_alarms` | timers |

Documents serve claude.ai pages. App tables serve data with shape, joins and
full-text search. Both commit in the same transaction (design §5.8).

### 3.2 An app is a store whose files are code

An app is a store whose tree holds `app.json`, pages and optionally
`actor.js`. The registry row `stores(id, type, app, owner)` says which code
a store runs: `app = NULL` means the store runs its own files (an app, or a
self-contained page), `app = blocks` means it runs the `blocks` app's
current version against its own documents. "Apps are also pure data" is
therefore literally true: an app's metadata is its `app.json`, its source is
its tree, and both are versioned by the same snapshots as any other store.

### 3.3 A route is a mount

`mounts(host, path, store, store_param, type, create_app, create_audience)`
maps a URL to a store, either a fixed one or one named by a path parameter
(`/b/:id`, of type `blocks`, created on first open by members). Resolving a
request gives a *view*: the target store, the app it runs, the version, and
the visitor's level (design §10).

### 3.4 Events are the log

Every commit appends to its store's `_log` and `_changes` in the same
transaction. Views stream it, reactors read it with a cursor saved in their
own turn (exactly once), agents tail it from the CLI, other stores read it
by grant. The registry has its own `_log` in `system.db`, and
`system:<kind>` reactors follow it (`pkg/actor/sysreact.go`). Live-only
messages and presence travel on the store's channel (the contract's `room`)
and are never stored (design §8).

### 3.5 Where the four objects meet

```text
               ┌────────────── system.db ──────────────┐
               │ stores  mounts  bindings  grants  …   │
               │ _log  _changes                        │
               └──────┬──────────────┬─────────────────┘
          route (mount)│              │ grant / binding
                       ▼              ▼
  GET /b/ws-team ──► view = (target: ws-team, app: blocks@17, level: interact)
                                    │
               ┌────────────────────┴──────────────────┐
               ▼                                       ▼
       ws-team/store.db                         blocks/store.db
       _docs  _files(assets)  _log …            _files(tree) = code
```

So the question "how would you unify them" has a short answer for v3:
it already is unified around the store. The remaining work is where the
registry and the bindings sit outside it.

## 4. The seams

### 4.1 The registry is out of reach

`system.db` has a store's log tables, but its registry rows (`stores`,
`mounts`, `bindings`, `grants`, `app_policy`, `llm_access`, …) are reachable
only through verbs (`pkg/verbs`) and through trusted modules. The back
office shows the consequence: its manifest asks for `"slop": {"modules":
["system"]}`, and its actor calls a slop-only module to read and change the
registry. An admin console written in claude.ai cannot do this, because the
claude.ai contract has no registry API.

### 4.2 Bindings are slop-only

A binding is `(store, alias) → target` (plus an `assets` flag). Code reaches
a bound store in two ways:

- an actor: `use('stores').open('source')`, with `rev()`, `docs.get`,
  `docs.query`, `assets.get` (`pkg/actor/modules.go`);
- a page: `(await claude.use('slop')).stores.open('source')`, read-only
  `doc`, `query`, `file`, `files` (`web/runtime/src/caps.ts`).

Both are slop's own API. A page written in claude.ai calls
`db.collection('contacts')` and expects it to be *its* data. It has no way
to reach a second store, so the dashboard test case fails today.

### 4.3 Source is not served as Claude's `files`

The claude.ai contract already has a capability for reading someone else's
files: `files` reads a Claude Code project's tree as the viewer
(`files.list`, `files.read`, `files.download`; see `doc/claude-apis/files.md`).
slop does not serve it (`use('files')` is `null`). The admin console's
"view source" needs exactly this capability, pointed at an app store's tree.

## 5. The proposed model

### 5.1 One object, three relations

```text
store      one SQLite file: docs, tree + snapshots, assets, tables, log, alarms
grant      (store, principal) → level            who may do what
binding    (holder store, aliases)               what code running for the holder can reach
route      (host, path) → (code, data, alias template)
```

A request resolves to three things, never stored as a row:

- **code**: an app store at a ref (`blocks@live`);
- **binding**: the aliases of the store the request is for, plus `_stores`
  if the code is approved for it;
- **principal**: the visitor, or the store itself for alarms and reactors.

That tuple is the "instance". Because it is computed, there is nothing to
keep in sync when an app is upgraded, a binding changes or a grant is
revoked; the next request sees the new tuple. The SLOP3-007 epoch already
invalidates cached decisions when authority changes.

### 5.2 One path space: the page's store at the root, every store under `_stores`

A page's `db` sees one path space. Its own store sits at the root, exactly
as the contract has it. The platform's names sit beside it, under top-level
segments that begin with `_`:

```text
chunks/c41                         this store's own documents, unchanged
data/users/u1/prefs                its private documents, unchanged
_stores                            every store this page may reach
_stores/ws-team                    a store's registry row (§5.4)
_stores/ws-team/chunks/c41         another store's documents
_stores/ws-team/_grants/@member    its grants (§5.4)
_people/<id>                       profiles and roles (§5.4)
```

**One reservation rule.** A top-level segment that begins with `_` belongs
to the platform: at the page's root, and at every store's root. Since
`_stores/<id>/` is a store's root, the rule holds at any depth of nesting,
and app data never collides with platform names. Pages written for
claude.ai never see a `_` name unless they are given one.

**Nesting keeps parity.** In the contract, a path with an odd number of
segments is a collection and an even number is a document. `_stores/<id>`
has two segments, so a store's paths keep their meaning when nested:
`chunks/c41` (a document, 2 segments) is `_stores/ws-team/chunks/c41`
(4 segments, still a document). A store's top-level collections become
subcollections of its registry document, and `_stores/<self>/chunks` and
`chunks` are the same documents, with the same versions and events.

**Aliases for unmodified apps.** Claude's code says `contacts`, not
`_stores/crm-team/contacts`. A binding gives it aliases: prefix rewrites
inside the one path space.

```json
{ "bindings": {
    "dash-team": {
      "contacts": { "to": "_stores/crm-team/contacts", "level": "view" },
      "pages":    { "to": "_stores/ws-team/chunks",    "level": "view" }
} } }
```

The dashboard's code stays as Claude wrote it:

```js
const db = await claude.use('db');
db.collection('contacts').where('stage', '==', 'lead').onSnapshot(render);   // → _stores/crm-team/contacts
await db.collection('notes').add({ text, at: Date.now() });                  // → its own notes
```

**The code's paths are the contract.** The page never learns that
`contacts` lives elsewhere; whoever binds the app decides. A runtime that
records which collections a page touches can suggest the aliases when
someone binds an app for the first time. Apps written for slop can skip
aliases and name `_stores/crm-team/contacts` directly, if they may reach
`_stores` (below).

**`_stores` is opt-in.** If every page could read `_stores`, any app a
visitor opens could read every store that visitor can see: the app would
act with the visitor's authority on data the visitor never gave it (a
confused deputy). So:

- an alias reaches only the prefix it names, and is set by the holder's
  owner;
- the whole of `_stores` (and `_people`) is reached only by an app that
  declares it, `"db": {"stores": "view"}`, `"interact"` or `"admin"`, and
  that an admin allowed: the `stores` cell of the app policy matrix
  (`slop policy set <app> stores @<audience> on`), off by default;
- an unmodified Claude app gets only the aliases its binding names.

Five rules make this exact:

1. **Resolution order.** `_stores` first (if declared and allowed); any
   other `_` name is refused as reserved; then an alias, matched on the
   first segment (an alias is one top-level name mapped to a collection,
   and it hides the holder's own collection of that name); otherwise the
   path is the store's own.
2. **Parity is preserved.** An alias maps a prefix to a prefix of the same
   parity: `contacts → _stores/crm-team/contacts` (1 → 3) is valid;
   `contacts → _stores/crm-team/crm/contacts` (1 → 4) is refused when the
   alias is set.
3. **One query, one store.** The contract has no cross-collection queries,
   so every `get`, `query` and `onSnapshot` falls in exactly one store.
   The path space never merges results. Listing `_stores` itself is a
   query over the registry (§5.4).
4. **One write, one store.** A batch or a lease spanning two stores is
   refused with `invalid_argument`. There are no cross-store transactions
   (design §8.5); this keeps it that way.
5. **Rules and levels compose by minimum.** Under `_stores/<id>/`, that
   store's own rules apply (the rules of the app *it* runs), and the
   effective level is the minimum of the alias's or the declaration's
   level and the principal's level on that store, computed with the
   SLOP3-007 rule (maximum of sources, then the ceiling).

Rule 5 needs one choice: whose level is the principal's? *Phase 1
implements `as: viewer` only* (decided 2026-11-02, open question 1):
publishing as the store stays an actor's job, as blocks-site does it.

| `as` | Principal on the target | Fits |
|---|---|---|
| `viewer` (default) | the visitor's own grant on the target | the dashboard: you see contacts only if you may see the CRM |
| `store` | the holder store's grant on the target (`store:<id>`, as for alarms) | publishing: a site's readers have no grant on the workspace; the site does (blocks-site today) |

`as: "store"` is delegation: anyone who can open the holder reads the target
up to the alias's level. Setting it therefore requires `owner` on the
holder and `admin` on the target, and `explain.can` shows the path. The
declared `_stores` space is always `as: viewer`.

**Another store's private documents are reachable by no route** (decided
2026-11-02). `data/users/<id>/…` in a store is that person's, read
through that store's own app. An app reaching in through an alias or
`_stores` could otherwise read the viewer's private documents there on
their behalf and copy them out; the viewer never chose that app for that
data. Such paths read as missing and cannot be written. The holder's own
private documents are its own, also at `_stores/<holder>/…`.

**Losing access reopens.** A view records the viewer's level on each
store it follows when it starts following it; when that level changes,
the view reopens, as it does when the viewer's level on its own store
changes, so a page never keeps showing documents its viewer may no longer
read.

### 5.3 Assets across stores

The first phase is about data and assets: what a page reads through an
alias or `_stores` includes the uploads its documents point at.

**Before phase 1.** An upload lives in its store's assets zone (`_files`,
`zone = 'assets'`) under an id `a` + 8 random bytes as hex (64 bits;
`ids.New("a", 8)` in `pkg/server/rtassets.go`; an earlier draft of this
section said "8 random characters", which was wrong). `/_blob/<id>` on a sandbox origin resolves the
id in that origin's store only (`serveAssetBlob`). A binding has an
`assets` flag, used by blocks-site's actor to read a workspace's uploads
(SLOP3-003 B5); pages have no such path.

**The problem.** A contract page stores asset ids in documents and renders
`"/_blob/" + id`. When the document came through an alias
(`contacts → _stores/crm-team/contacts`), the id belongs to `crm-team`, and
the dashboard's own origin answers 404.

**The design (implemented).** The page keeps writing `"/_blob/" + id`;
the sandbox origin resolves the id in its own store first, then in each
store an alias of the holder shares uploads with (`bind.set … --assets`,
the binding's existing flag, which needs admin on the target), in alias
order. The first store holding the id serves it; otherwise the answer is
404, as for a missing asset. Resolution walks only those stores, never
all stores.

A blob request carries no view credential: an `<img>` cannot send the
view's secret, and the sandbox origin's label only names the holder store
and app. So, as for a store's own uploads, the URL is the capability, and
the viewer's level cannot be checked at fetch time. What bounds a shared
store's uploads is that someone with admin on it chose to share them with
the holder. (An earlier draft said "if the viewer's effective level …
reaches"; that cannot be checked.)

Uploads through `_stores` (an id of any store) are **not** served in
phase 1: with no viewer at fetch time, resolving an id in any store would
make every store's uploads reachable through any allowed app's origin.
A store-qualified URL (`/_blob/_stores/<id>/<asset>`) with a view-bound
check is left for when an app needs it.

New uploads get 16 random bytes (128 bits; `ids.New("a", 16)`): 64 bits
already made collisions between a page's few reachable stores negligible,
and 128 bits is the right strength for an id that is the capability. The
walk's fixed order (own store first) keeps old ids deterministic.

**Writes stay local.** `assets.upload`, `assets.list` and `assets.delete`
act on the view's own store only, as the contract's per-artifact asset
store does. A page that wants to attach a file to another store's document
uploads it to its own store and stores the id; the other store's readers
then reach it only if their binding reaches the uploading store. An actor
that must copy bytes into another store does it explicitly (blocks-site's
publication already copies uploads by hash, B5).

### 5.4 Registry rows under the store they belong to

The registry tables stay tables: they need constraints, indexes and
transactions across rows that documents do not give. What changes is how
code reads and writes them: each row reads as a document under the store it
belongs to, in `_`-prefixed subcollections next to the store's own data.

| Document | From | A write runs | Level to write |
|---|---|---|---|
| `_stores/<id>` | type, app, owner, created; for an app store also its `app.json`, current version, refs, policy cells and modules | `store.type`, `app.follow`, a new `app.describe` | admin on the store |
| `_stores/<id>/_grants/<subject>` | one grant, with `via` and whether its link still stands | `grant.set`, `grant.rm` | owner |
| `_stores/<id>/_bindings/<alias>` | one alias (§5.2) | `bind.set`, `bind.rm` | owner |
| `_stores/<id>/_llm` | the store's own LLM access, budget and this month's usage | `llm.set` (the balance is read-only) | platform admin |
| `_people/<id>` | a person's profile, role and audience | `people.role` | platform admin |

Three properties make this safe:

- **Reads are computed, not copied.** A document is the current row, read
  through the caller's level. A row the caller may not see reads as missing,
  as the contract requires of hidden documents. `db.collection('_stores')`
  lists the stores the caller holds a level on.
- **Writes go through the verb that owns the row.** A `set` on
  `_stores/ws-team/_grants/@member` runs `grant.set`, with its checks, its
  confirmation rules and its log entry. A write the verb refuses fails with
  the verb's error code. Fields the verb does not accept are refused, not
  ignored. Creating a store is `add` on `_stores` (→ `store.new`); a
  delete on `_stores/<id>` is `store.rm`.
- **Writes require `ifVersion`.** A document's version is the registry
  revision that last changed its row. An admin console overwriting a grant
  someone else just changed fails with `conflict`, instead of silently
  undoing it.

Mounts and hosts are not mapped. A mount is a host's routing table, not a
property of a store, and only platform admins change it; it stays on
`mount.set`/`mount.ls` and the back office (decided 2026-11-02, open
question 3).

**Not live, for now** (decided 2026-11-02, open question 6). `get` and
queries compute registry documents when called; `onSnapshot` on them
delivers the current state once and then nothing, as `onSnapshot` does on
the static host (`web/runtime/src/static.ts`). A console re-reads after its
own writes or on demand. Live updates can come later: changes already land
in `system.db`'s `_changes`, and mapping a change's `key` to its document
path would feed `onSnapshot` without changing the API pages see.
`system:<kind>` reactors keep working unchanged. `system.db` itself stays
where it is: it is not a store in this design, only the source of the
`_stores/<id>`, `_stores/<id>/_…` and `_people` documents.

**As implemented (phase 3, `pkg/server/registry.go`).** A narrower first
cut of the table above:

| Document | Body | A write runs |
|---|---|---|
| `_stores` | the stores the viewer may open (every store for a platform admin) | — |
| `_stores/<id>` | `id`, `type`, `app`, `owner`, `createdAt`, and the viewer's `level` there | `update {type}` → `store.type` |
| `_stores/<id>/_grants/<subject>` | the `grant.ls` row; a link's grant is `<subject>~<via>` | `set {level}` → `grant.set`, `delete` → `grant.rm`; link grants read-only |
| `_stores/<id>/_bindings/<alias>` | the `bind.ls` row | `set {target, prefix?, level?, assets?}` → `bind.set`, `delete` → `bind.rm` |
| `_stores/<id>/_llm/budget` | `llm.usage` for `store:<id>` | read-only |
| `_people/<id>` | the `people.ls` row (platform admins) | read-only (open question 2) |

Reads run the owning listing verb as the viewer (`app:<app>`), so a row the
verb would not show reads as missing. Writes need `db.stores` `admin`, pass
`verbs.Check`, then ask the person in the shell (`confirmation_required`;
the runtime answers with `ask("confirm")` and retries), honour `ifVersion`
when given (not required: the contract's `set` has no mandatory version),
and refuse fields the verb does not take. Not built: `app.json`, refs,
policy cells and modules in the store row; `app.follow`/`app.describe` and
`llm.set` writes; creating or deleting stores through `_stores`.

The admin console is then:

```json
{ "title": "Console", "type": "console",
  "capabilities": { "db": { "stores": "admin" }, "files": {}, "user": { "scopes": ["profile"] } } }
```

approved once by a platform admin, with no aliases. Its code is contract
code over `_` paths: `db.collection('_stores').onSnapshot(...)`,
`db.doc('_stores/ws-team/_grants/@member').set({level: 'interact'}, {ifVersion})`.
It can still be built in claude.ai against seeded documents at those paths
and pushed unchanged.

### 5.5 Source through the `files` capability

`files` in the contract reads a project's tree: `list({path, recursive,
cursor})`, `read(path, {offset, length}) → {bytes, size, revision}`,
`download(path)`. A file tree does not follow the document parity rule
(`a/b/c.js` would land on a collection), so source is not mapped into
`_stores` as documents. Instead, a *project* is a store: the manifest's
`files: {project: "…"}` names `_stores` (any store the app may reach) or one
alias, instead of a claude.ai project id:

```json
"capabilities": { "files": { "project": "_stores" } }
```

`files.read('blocks/index.html')` then reads the `blocks` app store's tree
at its current ref, as the viewer, at the level the declaration allows.
`revision` is the file's content hash (as implemented in phase 2: a hash
changes exactly when the contents do, which is all the contract promises,
without tracking snapshot numbers per file). Writing source stays outside `files`
(the contract has no write), on the existing paths: `slop push`, the
workshop module, or `artifact.publish` on the app's own store.

### 5.6 Routes stay mounts

Mounts already carry the right information. One field is added: an alias
template, so a parameterised mount can bind what it creates:

```text
/d/:id  type dashboard  createApp dashboard
        aliases { "contacts": {to: "_stores/crm-team/contacts", level: "view"} }
```

Each store created from the mount gets those aliases, which its owner can
then change. Without a template, a new store gets none.

*As implemented (phase 4):* the template is a list of bindings in
`bind.set`'s shape, `mount.set --aliases '[{"alias": "contacts", "target":
"crm-team", "prefix": "contacts", "level": "view"}]'`, only with
`createApp`. It is checked like `bind.set` against the admin setting the
mount, stored in `mounts.aliases` (migration 010), restored by `mount.undo`,
and written as ordinary bindings by `/_site/create`.

### 5.7 Events across stores

A listener on an aliased or `_stores` path subscribes to the target store's
log, filtered to the target prefix, and its events are rewritten to the
page's path before they reach it. A listener on a registry document gets
one snapshot and no changes (§5.4). The view's cursor becomes a vector, one
`epoch.rev` per store it listens to, so reconnects stay resumable. The
channel (`room`) stays the holder's own; aliases do not reach other
stores' channels.

Across processes, the rule is the one Durable Objects use: **each store has
one owning process**, chosen by its id. Views and subscriptions for a store
are forwarded to its owner, whose broker is in-process. No Redis, and no
shared bus: a store's log is already the totally ordered stream, and only
its owner appends to it. v3.0's non-goal of a single process stays intact;
this is the shape that scaling out would take.

## 6. Durable Objects

### 6.1 The shapes match

| Durable Objects | slop v3 |
|---|---|
| a class | `actor.js` in an app store |
| `env.NS.idFromName(n)`, `.get(id)` | a store id within a type; a parameterised mount with `createApp` creates it on first use |
| `stub.fetch(req)` | the actor's `http` handlers on a mount |
| RPC methods on the stub | `actions`, through `stores.open(alias).call(name, args)` |
| single-threaded, input and output gates | one turn at a time; nothing leaves a turn before it commits |
| writes coalesced between awaits | an `await` on real I/O ends the turn and commits (design §6.3) |
| `storage.sql.exec` | `use('sql')` over the store's own tables, with migrations |
| `storage.get/put/delete/list` | `use('db')` documents |
| `storage.setAlarm` | `use('alarm')` and `every` |
| `acceptWebSocket` (hibernation) | the store's channel: presence and messages, the actor joins with `channel:<topic>` |
| the object's location | one process per store (single process in v3.0) |

The two models agree on what matters most: one writer per object, state and
code co-located, writes atomic between awaits, the object addressed by name.

### 6.2 Shape compatibility is small; 1:1 compatibility is not

An adapter giving actors a `ctx.storage` with `get/put/delete/list/
transaction/sql/setAlarm` over documents, SQL and alarms is a few hundred
lines, and a Durable-Object-minded author would find it familiar.

One-to-one compatibility (running code written for Cloudflare unchanged)
is a different project. Storage is the easy part. The rest is the Workers
runtime: `Request`/`Response`/`Headers`, streams, `fetch`, `crypto.subtle`,
`WebSocketPair`, ES modules and npm bundles, all with Workers' semantics.
goja implements none of these, and approximating them invites subtle
mismatches.

If one-to-one is ever needed, the clean route is to run `workerd` (the
open-source Workers runtime) as a second executor for apps that ask for it,
with its Durable Object storage backed by the store through a narrow API.
Until a concrete app needs porting, the recommendation is the adapter, and
to describe it as "Durable-Object-shaped", never "compatible".

## 7. Worked examples

### 7.1 The admin console, end to end

1. Build `console` in claude.ai against seeded documents at `_stores/*`
   and `_stores/*/_grants/*`. Its manifest declares `"db": {"stores":
   "admin"}` and `"files": {"project": "_stores"}` (§5.4, §5.5).
2. `slop push ./console --store console`.
3. A platform admin allows it to reach `_stores`:
   `slop policy set console stores @admin on` (phase 1).
4. Mount it at `/console`, grant `@admin` `view`.
5. An admin opens it. `db.collection('_stores')` lists every store, each at
   `min(admin, the admin's level on it)`. A member who somehow opens it
   lists only the stores they hold a level on, and can change none of
   their grants unless they own them: the console adds no authority.
6. Editing a description: `db.doc('_stores/blocks').update({description}, {ifVersion})`
   → the verb that owns app metadata (a new `app.describe`; none exists
   yet) → a `system` log entry. Registry documents are not live (§5.4):
   the console re-reads the document after its write; other open consoles
   see the change when they next read.
7. Viewing source: `files.list({path: 'blocks', recursive: true})`, then
   `files.read('blocks/blocks.js')`.

### 7.2 The dashboard

The aliases from §5.2; no approval needed, since the app never sees
`_stores` itself. A viewer with `view` on `crm-team` and on `ws-team` sees
both. A viewer without a CRM grant sees an empty `contacts`
collection; the dashboard must already handle an empty collection, as
every contract page does.

### 7.3 A game room per name

```sql
-- sql/001_moves.sql in app "tables"; mount /t/:id --type table --createApp tables
CREATE TABLE moves (n INTEGER PRIMARY KEY, by TEXT, move TEXT, at INTEGER);
```

```js
// actor.js: one per table store, one turn at a time
const sql = use('sql'), room = use('room');
defineActor({
  actions: {
    move: { requires: 'interact', run(ctx, { move }) {
      sql.run('INSERT INTO moves(by, move, at) VALUES (?,?,?)', ctx.visitor.id, move, ctx.now);
      room.emit('moved', { move });          // sent after the turn commits
    } },
  },
  every: { idle: { every: '1m', run(ctx) { /* time out idle players */ } } },
});
```

One store per table id, created on first open, one writer, SQL, alarms and
a live channel: the Durable Object pattern, already expressible.

## 8. Invariants

- A store has exactly one writer at a time, and one owning process.
- A commit and its log entry land in the same transaction.
- A snapshot never changes; a blob hash always identifies its bytes.
- An alias never gives more than the minimum of its level and the
  principal's level on the target (`as: viewer`), or the holder store's
  level (`as: store`).
- A top-level segment beginning with `_` belongs to the platform, at the
  page's root and at every store's root.
- Code reaches `_stores` as a whole only when its app declares it and an
  admin has approved it; otherwise only through the aliases its binding
  names.
- One query reads one store; one write or batch writes one store.
- `/_blob/<id>` serves an upload only from the origin's store or a store
  whose uploads one of its aliases shares (shared by an admin there);
  uploads write only the view's own store.
- Another store's `data/users/<id>/…` is reachable by no route.
- A write to a registry document runs the verb that owns the row, with its
  checks, and never writes a table directly.
- Balances (the LLM ledger) are state, not authority: readable as
  documents, never written through them, and never moving the epoch.
- A page sees only the contract's API: the platform appears to it only as
  documents at `_` paths, and only if it was given them.

## 9. Plan

Each phase is useful without the next.

1. **Data and assets across stores.** *Implemented* (task/slop3-008-data-assets;
   diary steps 5–8). Top-level `_` names reserved (a scan of production
   found none); bindings with `prefix` and `level` (`bind.set --prefix
   --level`); `_stores/<id>/…` behind `capabilities.db.stores` and the
   `stores` policy cell; page paths resolved once by `rt.Space`
   (reads, queries, subscriptions, writes, leases); `/_blob/<id>` through
   aliases with `--assets`; per-store cursors on the server-side view
   instead of vector cursors in the runtime. Not done: actors' `use('db')`
   still sees its own store only (actors keep `use('stores').open`), and
   `caps/db` is the shared `rt.Space` resolution rather than one shared
   db implementation. The dashboard works, pictures included.
2. **`files` over store trees.** *Implemented* (diary step 9). Serve the
   contract's `files` capability; `project` names `_stores` or an alias.
   "View source" works.
3. **Registry rows as documents.** *Implemented* (diary steps 10–11; the
   narrower first cut in §5.4). `_stores/<id>`, `_stores/<id>/_grants`,
   `_bindings`, `_llm` and `_people` as computed documents (no mounts);
   writes through verbs, confirmed by the person, with `ifVersion`; read on
   demand, not live. The admin console works as a plain artifact; the back
   office's `system` module is not dropped yet.
4. **Alias templates on mounts.** *Implemented* (diary step 11), so stores
   created from a mount come bound (§5.6).
5. **The Durable-Object adapter.** *Implemented* (diary step 12):
   `use('storage')` / `ctx.storage`, described in `doc/design/slop-v3.md`
   §6.
6. **One owning process per store.** *Not built, deliberately.* v3 runs one
   process, so every store already has exactly one owner and the broker is
   in-process; there is nothing to forward to and no second process to
   test against. The rule (§5.7) is recorded for when v3 scales out: route
   a store's views to the process chosen by its id, without a shared bus.

## 10. Open questions

1. **Delegated reads.** *Decided (2026-11-02): not in phase 1.* Every
   route reads as the viewer; publishing stays an actor's job (blocks-site).
2. **Registry writes.** *Decided (2026-11-02, phase 3):* grants, aliases
   and a store's type are writable through `db`, confirmed by the person;
   people (roles), the LLM budget, mounts, sessions and tokens are not.
   Descriptions wait for an `app.describe` verb.
3. **Mount keys, and mounts with no app.** *Decided (2026-11-02): mounts
   and hosts are not mapped into the path space* (§5.4). The first phases
   are about data and assets; routes stay on `mount.*` and the back office.
4. **Reserving `_`.** *Decided (2026-11-02): reserved,* for every writer
   (`validPath` in `pkg/rt/paths.go`). A read-only scan of all 112
   production stores found no top-level `_` path
   (`scripts/01-scan-reserved-paths.py`).
5. **Depth.** *Decided (2026-11-02): 18 segments under `_stores/<id>/`*
   (server and runtime), so a store's 16-segment documents stay reachable;
   the path inside the store is still at most 16.
6. **Projection cost.** *Decided (2026-11-02): registry documents are not
   live for now* (§5.4): computed on read, one snapshot per listener. When
   they become live, the change mapping should be incremental rather than
   a re-query, so `_changes` keys should keep naming the affected store and
   subject.
7. **Assets across stores.** *Decided (2026-11-02), §5.3:* own store, then
   aliases with `--assets`; not through `_stores` in phase 1; new ids are
   16 random bytes. Open: a store-qualified, view-checked blob URL for
   `_stores` apps, when one needs it.

## 11. References

- `doc/design/slop-v3.md` §4 (the store), §5.8 (two kinds of data), §8
  (events), §9 (identity and access), §10 (serving)
- `doc/claude-apis/` — the claude.ai artifact guides, and slop's
  differences in `README.md`
- `pkg/store/store.go` — the store schema
- `pkg/system/migrations/001_init.sql` — `stores`, `mounts`, `bindings`,
  `grants`, the system log
- `pkg/actor/modules.go` — the actor's `use()` catalog; `stores.open`
- `pkg/actor/sysreact.go` — `system:` reactors
- `web/runtime/src/index.ts`, `caps.ts` — the page's `use()` resolver and
  `slop.stores.open`
- `apps/backoffice/app.json` — the `system` module the console would replace
- `apps/blocks-site/actor.js` — reading a bound workspace as the store
- SLOP3-007 — the authority core (levels, ceilings, the store principal,
  the epoch)
