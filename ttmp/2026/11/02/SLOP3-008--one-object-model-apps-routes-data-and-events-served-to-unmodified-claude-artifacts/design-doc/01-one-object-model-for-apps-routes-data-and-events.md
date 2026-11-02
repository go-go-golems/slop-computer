---
Title: One object model for apps, routes, data and events
Ticket: SLOP3-008
Status: review
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
    - Path: repo://design/slop-v3-design.md
      Note: The v3 design this review measures; sections 4 (store), 8 (events), 9 (access), 10 (serving)
    - Path: repo://doc/claude-apis/README.md
      Note: What slop's runtime serves differently from the claude.ai artifact contract
    - Path: repo://pkg/store/store.go
      Note: The per-store schema (_docs, _files, _log, _changes, _snapshots, _refs, _migrations, _cursors, _alarms)
    - Path: repo://pkg/system/migrations/001_init.sql
      Note: The registry (stores, mounts, bindings, grants) and the system log
    - Path: repo://pkg/actor/modules.go
      Note: The actor's use() catalog, including stores.open(alias)
    - Path: repo://web/runtime/src/index.ts
      Note: The page's use() resolver; bindings reach pages only as slop.stores.open
ExternalSources: []
Summary: 'A from-scratch answer to "how would you unify apps, routes, data and events", measured against slop v3: keep the store as the one object, make the registry a store, give bindings a namespace that unmodified Claude artifacts see through their own db and files APIs, and treat Durable Objects as a shape v3 already has.'
LastUpdated: 2026-11-02T18:00:00-05:00
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
   a store. A *binding* gives code a *namespace*: which paths of which stores
   its `db` and `files` calls reach, and at what level. A *route* (a mount)
   maps a URL to code plus a namespace. An "instance" is not an object; it is
   the tuple (code, namespace, principal) worked out for each request.
3. **The registry is a store too.** Apps, stores, mounts, grants and
   policies are documents in a `system` store, written through validators.
   An admin console then is an ordinary app that a namespace gives the
   `system` store, and it can be a plain Claude artifact.
4. **Durable Objects are a shape v3 already has.** A store with an actor is
   a Durable Object with JS as the only language. Matching the API *shape*
   is a small adapter. Matching it *one-to-one* means hosting the Workers
   runtime, which is a different project.

What v3 lacks is not a new primitive. It is three seams where the one
primitive is not used uniformly:

| Seam | Today | Proposed |
|---|---|---|
| The registry | `system.db` is store-shaped (it has `_log` and `_changes`) but is not a store; apps reach it through verbs or a trusted `system` module | a `system` store whose registry rows read as documents |
| Bindings | `alias → target`, reachable only through slop's own API (`slop.stores.open` in pages, read-only; `stores.open` in actors) | a namespace: path prefixes mapped to stores, served through the page's own `db` and `files` |
| App source | the actor's `files` module and `slop.read` | Claude's `files` capability, served over a bound store's tree |

## 2. The test cases

Every proposal below is checked against three apps:

- **The admin console.** Admins use it to list apps, edit their metadata,
  read their source, change grants and mounts. Written in claude.ai, with no
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

### 4.1 The registry is not a store

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
binding    (holder store, namespace)             what code running for the holder can reach
route      (host, path) → (code, data, namespace template)
```

A request resolves to three things, never stored as a row:

- **code**: an app store at a ref (`blocks@live`);
- **namespace**: the binding of the store the request is for;
- **principal**: the visitor, or the store itself for alarms and reactors.

That tuple is the "instance". Because it is computed, there is nothing to
keep in sync when an app is upgraded, a binding changes or a grant is
revoked; the next request sees the new tuple. The SLOP3-007 epoch already
invalidates cached decisions when authority changes.

### 5.2 Namespaces: several stores behind one `db`

A namespace maps path prefixes of the page's `db` (and `files`) to stores:

```json
{ "bindings": {
    "dash-team": {
      "":         { "store": "dash-team" },
      "contacts": { "store": "crm-team",  "prefix": "contacts", "level": "view" },
      "pages":    { "store": "ws-team",   "prefix": "chunks",   "level": "view" }
} } }
```

The dashboard's code stays as Claude wrote it:

```js
const db = await claude.use('db');
db.collection('contacts').where('stage', '==', 'lead').onSnapshot(render);   // → crm-team: contacts
await db.collection('notes').add({ text, at: Date.now() });                  // → dash-team: notes
```

**The code's paths are the contract.** The page never learns that
`contacts` lives elsewhere. Whoever binds the app decides where each prefix
lives. A runtime that records which collections a page touches can suggest
the mapping when someone binds an app for the first time.

Five rules make this exact:

1. **Longest prefix wins.** `""` is the holder's own store and is always
   present.
2. **Parity is preserved.** In the contract, a path with an odd number of
   segments is a collection and an even number is a document. A mount's
   source prefix and target prefix must have the same parity, or the code's
   paths would change meaning. `contacts → contacts` (1 → 1) is valid;
   `contacts → crm/contacts` (1 → 2) is refused when the binding is set.
3. **One query, one store.** The contract has no cross-collection queries,
   so every `get`, `query` and `onSnapshot` falls in exactly one store.
   A namespace never merges results.
4. **One write, one store.** A batch or a lease spanning two mounts is
   refused with `invalid_argument`. There are no cross-store transactions
   (design §8.5); this keeps it that way.
5. **Rules and levels compose by minimum.** On a mounted store, that store's
   own rules apply (the rules of the app *it* runs), and the effective level
   is the minimum of the binding's `level` and the principal's level on that
   store, computed with the SLOP3-007 rule (maximum of sources, then the
   ceiling).

Rule 5 needs one choice, made per mount: whose level is the principal's?

| `as` | Principal on the target | Fits |
|---|---|---|
| `viewer` (default) | the visitor's own grant on the target | the dashboard: you see contacts only if you may see the CRM |
| `store` | the holder store's grant on the target (`store:<id>`, as for alarms) | publishing: a site's readers have no grant on the workspace; the site does (blocks-site today) |

`as: "store"` is delegation: anyone who can open the holder reads the target
up to the binding's level. Setting it therefore requires `owner` on the
holder and `admin` on the target, and `explain.can` shows the path.

Private data follows: `data/users/<id>/` on a mounted store is private to
`<id>` there, as anywhere. A viewer's id is the same in every store, so a
mounted store's private subtree works without translation.

### 5.3 The registry as documents of the `system` store

The registry tables stay tables: they need constraints, indexes and
transactions across rows that documents do not give. What changes is how
code reads and writes them. The `system` store presents them as documents:

| Document | From |
|---|---|
| `apps/<id>` | the app's `app.json`, its type, current version and refs, its policy cells, its modules |
| `stores/<id>` | type, app, owner, created; and `stores/<id>/bindings/<alias>` |
| `stores/<id>/grants/<subject>` | one grant, with `via` and whether its link still stands |
| `mounts/<key>` | one mount; `<key>` encodes `host` and `path` (`apps.example~b~:id`) |
| `people/<id>` | a person's profile, role, audience (admins only) |
| `llm/<subject>` | an LLM access row and this month's usage, read-only for balances |

Three properties make this safe:

- **Reads are computed, not copied.** A document is the current row, read
  through the caller's level. A row the caller may not see reads as missing,
  as the contract requires of hidden documents.
- **Writes go through the verb that owns the row.** A `set` on
  `stores/ws-team/grants/@member` runs `grant.set`, with its checks, its
  confirmation rules and its log entry. A write the verb refuses fails with
  the verb's error code. Fields the verb does not accept are refused, not
  ignored.
- **Writes require `ifVersion`.** A document's version is the registry
  revision that last changed its row. An admin console overwriting a grant
  someone else just changed fails with `conflict`, instead of silently
  undoing it.

Changes already land in `system.db`'s `_changes`. Mapping a change's `key`
to its document path gives `onSnapshot` on registry documents for free, and
`system:<kind>` reactors keep working unchanged.

The admin console is then:

```json
{ "title": "Console", "type": "console",
  "capabilities": { "db": {}, "files": {}, "user": { "scopes": ["profile"] } } }
```

bound with `{ "": {store: "console"}, "apps": {store: "system", prefix: "apps", level: "admin"}, "stores": {store: "system", prefix: "stores", level: "admin"} }`,
and its code is plain contract code: `db.collection('apps').onSnapshot(...)`,
`db.doc('stores/ws-team/grants/@member').set({level: 'interact'}, {ifVersion})`.
It can still be built in claude.ai against a seeded database and pushed
unchanged.

### 5.4 Source through the `files` capability

`files` in the contract reads a project's tree: `list({path, recursive,
cursor})`, `read(path, {offset, length}) → {bytes, size, revision}`,
`download(path)`. On slop, a *project* is a store and the manifest's
`files: {project: "…"}` names a namespace entry instead of a claude.ai
project id:

```json
"capabilities": { "files": { "project": "apps" } }
```

`files.read('blocks/index.html')` then reads the `blocks` app store's tree
at its current ref, as the viewer, at the binding's level. `revision` is the
snapshot number. Writing source stays outside `files` (the contract has no
write), on the existing paths: `slop push`, the workshop module, or
`artifact.publish` on the app's own store.

### 5.5 Routes stay mounts

Mounts already carry the right information. One field is added: a
namespace template, so a parameterised mount can bind what it creates:

```text
/d/:id  type dashboard  createApp dashboard
        namespace { "contacts": {store: "crm-team", prefix: "contacts", level: "view"} }
```

Each store created from the mount gets that namespace as its binding, which
its owner can then change. Without a template, a new store gets only `""`.

### 5.6 Events across a namespace

A listener on a mounted path subscribes to the target store's log, filtered
to the target prefix, and its events are rewritten to the source prefix
before they reach the page. The view's cursor becomes a vector, one
`epoch.rev` per store it listens to, so reconnects stay resumable. The
channel (`room`) stays the holder's own; a namespace does not mount
channels.

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

1. Build `console` in claude.ai against seeded documents shaped like
   `apps/*` and `stores/*`.
2. `slop push ./console --store console`.
3. `slop bind set console apps system --prefix apps --level admin` and the
   same for `stores`, `mounts` (`--prefix` and `--level` are proposed in §9, phase 1).
4. Mount it at `/console`, grant `@admin` `view`.
5. An admin opens it. `db.collection('apps')` reads the `system` store's
   `apps/*` at `min(admin, the admin's level on system)`. A member who
   somehow opens it reads nothing: their level on `system` is `none`, so
   the documents read as missing.
6. Editing a description: `db.doc('apps/blocks').update({description}, {ifVersion})`
   → the verb that owns app metadata (a new `app.describe`; none exists
   yet) → a `system` log entry → every open console
   sees the change through `onSnapshot`.
7. Viewing source: `files.list({path: 'blocks', recursive: true})`, then
   `files.read('blocks/blocks.js')`.

### 7.2 The dashboard

The binding from §5.2. A viewer with `view` on `crm-team` and on `ws-team`
sees both. A viewer without a CRM grant sees an empty `contacts`
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
- A binding never gives more than the minimum of its level and the
  principal's level on the target (`as: viewer`), or the holder store's
  level (`as: store`).
- One query reads one store; one write or batch writes one store.
- A write to a registry document runs the verb that owns the row, with its
  checks, and never writes a table directly.
- Balances (the LLM ledger) are state, not authority: readable as
  documents, never written through them, and never moving the epoch.
- A page sees only the contract's API: nothing about namespaces, mounts or
  the registry appears in it.

## 9. Plan

Each phase is useful without the next.

1. **Namespaces for pages.** Extend `bindings` with `prefix`, `level`,
   `as`; resolve `db` paths through the namespace in `pkg/server/views.go`
   (reads, queries, subscriptions, writes, leases); vector cursors in the
   runtime. The dashboard works. `slop.stores.open` stays as is.
2. **`files` over bound trees.** Serve the contract's `files` capability;
   `project` names a namespace entry. "View source" works.
3. **The `system` store.** Registry rows as computed documents, writes
   through verbs with `ifVersion`, `_changes` mapped to document paths.
   The admin console works as a plain artifact; the back office can drop
   its `system` module.
4. **Namespace templates on mounts**, so stores created from a mount come
   bound.
5. **The Durable-Object adapter** for actors (`ctx.storage`), if a custom
   app asks for it.
6. **One owning process per store**, when v3 leaves a single process.

## 10. Open questions

1. **Delegated reads.** Is `as: "store"` needed beyond publishing, or should
   publishing stay an actor's job (as blocks-site does) and pages only ever
   read `as: "viewer"`?
2. **Registry writes.** Which registry documents are writable through `db`
   at all? Grants, mounts and descriptions are natural; people, sessions and
   tokens should stay read-only or hidden.
3. **Mount keys.** How to encode `host` + `path` into one path segment so
   it round-trips and stays readable.
4. **Projection cost.** Computed documents over `stores` and `grants` are
   cheap at today's size. At thousands of stores, `onSnapshot` on
   `stores` needs the change mapping to be incremental, not a re-query.
5. **Assets across mounts.** Should `assets.list` on a namespace list the
   holder's assets only (proposed), and `/_blob/<id>` resolve any bound
   store's asset the viewer may read?

## 11. References

- `design/slop-v3-design.md` §4 (the store), §5.8 (two kinds of data), §8
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
