---
Title: 'Untying the knot packages: an intern''s guide to slop-computer and its reorganization'
Ticket: SLOP3-010
Status: active
Topics:
    - architecture
    - backend
    - hosting
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/internal/archtest/deps_test.go
      Note: The ratchet each PR tightens
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/actor/modules.go
      Note: Actor modules PR 4 moves into capabilities
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/server.go
      Note: Host dispatch and assembly; PR 3's pkg/host
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/system/system.go
      Note: system.db core; PR 2's sysdb
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/verbs/env.go
      Note: verbs.Env, the god object PR 1 removes
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/verbs/verb.go
      Note: The table today; PR 1's starting point
ExternalSources: []
Summary: An intern-level guide to slop-computer (stores, turns, the artifact contract, views, access, actors, the verb table, doors, capabilities) and the design and implementation plan for untying its four knot packages in four pull requests.
LastUpdated: 2026-11-03T14:53:39.381298811-05:00
WhatFor: Understanding the whole system well enough to implement SLOP3-010, and reviewing its four pull requests.
WhenToUse: Before working on pkg/verbs, pkg/system, pkg/server or pkg/actor, or before reviewing a SLOP3-010 PR.
---

# Untying the knot packages: an intern's guide to slop-computer and its reorganization

This document has two purposes.

- **Parts 1 to 4** explain slop-computer from the ground up: what it hosts, the objects it is built from, how a request travels through it, and which package holds what.
- **Parts 5 to 10** use that understanding to explain the reorganization this ticket carries out: why four packages have become "knots", what shape replaces them, and how to get there in four pull requests without changing behaviour.

You should be able to read Part 1 to 4 on your first day, with no prior knowledge of slop, and then follow any request from the bytes that reach the server to the row or document it changes. Read Part 5 to 10 before you write or review a line of SLOP3-010.

Everything here was checked against the code on the branch `task/slop3-009-typed-verbs` (PR #22), which SLOP3-010 builds on. File paths are relative to the repository root. Line counts are non-test Go lines on that branch.

---

## Part 1. What slop-computer is

### 1.1 The problem it solves

claude.ai can produce **artifacts**: self-contained web pages (HTML, CSS, JavaScript) that run inside claude.ai and can call a small set of platform services through a JavaScript object, `window.claude`. A page asks for a service with `await claude.use("db")`, `claude.use("sample")`, `claude.use("room")`, and so on. Those services are defined by a published contract: TypeScript declaration files that say what `db.collection("tasks").where(...).get()` returns, what errors exist, and how permissions work.

slop-computer is a **hosting service for such pages outside claude.ai**. An unmodified artifact, uploaded to slop, runs the same way it ran in claude.ai: its `claude.use("db")` reaches a real database on slop's server, its `sample` calls reach a real model, its `room` connects the people who have the page open. On top of that contract slop adds what a hosting service needs:

- accounts and sign-in;
- per-store access grants;
- mounts that put an app at a URL;
- a back office for administrators;
- a command-line interface;
- server-side code ("actors") that an app can ship next to its page;
- an LLM budget per person.

### 1.2 The one-paragraph model

Everything slop hosts lives in a **store**: one SQLite file holding an app's documents, files and history. A **person** opens a page of a store's app. The server creates a **view** for that visit, decides the person's **level** on the store, and serves the page from an isolated **sandbox origin**. The page's `claude.js` runtime talks to the server over two channels on that origin: an event stream and an RPC endpoint. Every change is one **turn**: one SQLite transaction that produces one **commit** in the store's log. Every commit is streamed to the views that follow the store. Administrative operations (create a store, grant a level, mount an app at a path) are **verbs** in one table. The CLI, the HTTP API, MCP agents and server-side code all call that table.

```text
          person's browser                               slop-computer server
 ┌────────────────────────────────┐        ┌──────────────────────────────────────────────┐
 │ shell page (live or main host) │        │  doors: pages · HTTP API · MCP · CLI · actors │
 │  └─ iframe: sandbox origin     │ events │                    │                         │
 │      the artifact + claude.js ◀├────────┤   verb table ◀─────┤ capabilities (db,       │
 │      claude.use("db") ─────────├──rpc──▶│      │             │  sample, files, room…)  │
 └────────────────────────────────┘        │      ▼             ▼                         │
                                           │  system.db      stores/<id>.db  blobs/       │
                                           │  (registry,     (docs, files,   (content-    │
                                           │   people, …)     log)           addressed)   │
                                           └──────────────────────────────────────────────┘
```

---

## Part 2. The objects, in dependency order

Each term below uses only the terms defined before it. The Go type or file that implements it follows in brackets.

### 2.1 Store, document, collection [`pkg/store`]

A **store** is one SQLite database file, `stores/<id>.db`, opened by `store.Open(ctx, id, path, blobs)`. It holds:

- **documents**: JSON objects at slash-separated **paths**. A document path has an even number of segments (`tasks/t1`, `boards/b1/columns/c2`); a collection path has an odd number (`tasks`, `boards/b1/columns`). A top-level segment beginning with `_` belongs to the platform (`rt.Reserved`). The rules are in `pkg/rt/paths.go` (`ValidDocPath`, `ValidCollPath`, `IDOf`, `CollOf`).
- **files** in **zones**: `tree` (the app's source: `app.json`, `index.html`, `actor.js`), `assets` (uploads). A file's bytes live in the content-addressed blob store (`pkg/blobs`), keyed by SHA-256; the store records path, type, size and hash.
- **snapshots** and **refs**: a snapshot freezes the tree; a ref (`main`) names the snapshot the app runs.
- the **log**: one row per commit.

Each document carries a **version** (how many times it was written) and the **rev** of the commit that last wrote it.

### 2.2 Turn and commit [`pkg/store/turn.go`]

A **turn** is one write transaction on one store. All writes go through:

```go
func (s *Store) Do(ctx context.Context, who store.Who, fn func(t *store.Turn) error) (*store.Commit, error)
```

`Do` takes the store's mutex, opens a SQLite transaction, runs `fn`, and commits. Inside `fn` the turn offers `GetDoc`, `SetDoc`, `UpdateDoc`, `DeleteDoc`, `QueryDocs`, `PutFile`, `Snapshot`, `MoveRef`, and more. If `fn` returns an error, nothing is written. If the transaction changed anything, it produces a **commit**:

```go
type Commit struct {
    Store     string // which store
    Rev       int64  // the store's revision counter after this commit
    Principal string // who: usr_…, vis_…, store:<id>, system
    Via       string // which door: page, actor, cli, http, mcp, eval…
    App       string // app@version that ran, if any
    Summary   string
    // plus the changed documents and files
}
```

`who` (`store.Who`) is recorded in the commit: the principal's id, the door, the level they acted at, the app. After the commit, `s.OnCommit` fires; the kernel fans that out to subscribers, and the page door uses it to stream changes to open views.

Two consequences matter everywhere in the code:

- **One write writes one store.** A turn cannot span two stores. Cross-store work is two turns, or a call into the other store's actor.
- **Reads outside a turn see committed state** (`Store.GetDoc`, `Store.Query` use a read-only connection). Reads inside a turn see the turn's own uncommitted writes.

### 2.3 Levels, rules, the app [`pkg/rt/rules.go`, `pkg/rt/manifest.go`, `pkg/apps`]

A **level** is how much someone may do on a store, ordered:

```go
const (
    LevelNone rt.Level = iota // nothing
    LevelView                 // read
    LevelInteract             // read and write data
    LevelAdmin                // edit the app, manage the store
    LevelOwner                // everything, including granting owner
)
// LevelSelf: a rule level nobody holds; used for "only the person whose path this is"
```

An **app** is what a store's tree holds: `app.json` (the **manifest**) plus pages and optional server code. The manifest declares **capabilities** (`"capabilities": {"db": {...}, "sample": {}}`), and the db capability carries **rules**: per-path minimum levels for reading and writing, with `{self}` placeholders (`data/users/{self}` is readable only by that user). `rt.ParseManifest` turns `app.json` into `rt.Caps`; `rt.Rules.CanRead(path, user, level)` and `CanWrite` apply them.

### 2.4 Principal, audience, grant, decision [`pkg/access`, `pkg/authz`]

A **principal** is who is acting:

```go
type Principal struct {
    Kind    string         // user, guest, token, store, system
    Person  *system.Person // for users, guests, tokens
    Store   string         // for Kind store: store:<id> acting
    Scopes  []string       // a token's scopes: read, write, admin
    TokenID string
    Via     string         // the door
    Trusted bool
}
```

An **audience** is the platform-wide group a principal falls in: `guest`, `member`, `subscriber`, `admin`, `store` (`access.Checker.AudienceOf`). Groups nest: a subscriber is also a member and a guest.

A **grant** gives a level on one store to a **subject**: a person (`usr_…`), a guest visitor (`vis_…`), another store (`store:<id>`), or an audience (`@guest`, `@member`, `@subscriber`). Grants live in `system.db`. A **share link** creates grants too.

`access.Checker.Level(ctx, p, storeRow)` computes a **decision**: the highest level any of p's grants gives (the owner holds owner; admins hold owner everywhere), with a trace of why. `Checker.Can(ctx, p, store, need, what, hidden)` asks "does p hold at least `need`?" and returns `not_found` instead of `permission_denied` when p may not even know the store exists.

`pkg/authz` names **actions** (`authz.Account`, `authz.StoreRead`, `authz.PlatformAdmin`, `authz.Program`, …). Each action has a **floor**: the level or role it needs. Every verb declares its action, so the table can check the floor before running it.

### 2.5 system.db and the system log [`pkg/system`]

`system.db` is the one SQLite database for everything that is not a store's content. Its tables (from `pkg/system/migrations/001…009`):

| Domain | Tables |
|---|---|
| identity | `people`, `sessions`, `tokens`, `device_codes`, `login_flows`, `handoffs` |
| registry | `stores`, `grants`, `links`, `bindings`, `mounts`, `mount_log`, `origins`, `previews`, `blob_refs` |
| app governance | `app_policy`, `app_modules`, `secrets`, `schedules` |
| billing | `comps`, `stripe_customers`, `stripe_subscriptions`, `stripe_events`, `checkout_attempts` |
| LLM | `llm_access`, `llm_usage`, `llm_holds` |
| the log | `_log`, `_changes`, `_schema` |

Every write to `system.db` goes through `system.DB.Tx`, and every administrative change is recorded in the **system log**: one `_log` row per transaction and one `_changes` row per changed entity, with a `kind` (`store`, `grant`, `binding`, `person`, `policy`, `llm`, `link`, `comp`, …), a `key` (`crm`, `crm @member`, `usr_…`) and before/after values. `system.Log(ctx, tx, …, changes...)` writes them; `DB.LogAfter(ctx, rev, limit)` reads them back in order; `DB.Listen(fn)` registers a function called after every committed `Tx`. The page door follows this log to recheck open views (SLOP3-009 step 3).

### 2.6 The kernel [`pkg/kernel`]

The kernel ties stores to the registry:

- `Kernel.Store(ctx, id)` opens a store file (cached);
- `CreateStore`, `DeleteStore` and `SetStoreType` change files and registry rows together;
- `Running(ctx, id)` reports which app version a store runs, and whether it is usable;
- `Rules(ctx, id)` gives the running app's rules;
- `Subscribe(fn)` delivers every commit of every store;
- `Access` is the `access.Checker`.

### 2.7 View [`pkg/rt/views.go`, `pkg/server/views.go`]

A **view** is one open page of one store's app for one person. It is created by `POST /_site/views` when the shell loads a page, and lives in memory only. It holds:

- the target store, app and version;
- the user (`usr_…` or `vis_…`), their **level** and **role**;
- the app's **caps** and the **policy** cells for the viewer's audience;
- a **secret**, which the sandboxed page uses as a bearer token;
- the **path space** (2.8);
- its **subscriptions** (`db.subscribe`), its **rooms**, and a channel of outgoing events.

The page reads `GET /_rt/events` (server-sent events: `hello`, `doc`, `room`, …) and calls `POST /_rt/rpc` with `{method, args}` (`db.get`, `db.query`, `db.write`, `db.subscribe`, `room.emit`, `sample.limits`, …). Both are on the view's **sandbox origin**, a hostname unique to the view, so one page's script cannot read another page's cookies or storage. An **epoch** counter lets the server decide again when access may have changed: a view whose epoch is behind the system's is rechecked at its next call, and closed (`revoked`) if its level moved.

### 2.8 Path space [`pkg/rt/space.go`, `pkg/caps/db`]

A page's db paths resolve through its view's **space** (`rt.Space`):

- The store's own documents sit at the root, as in claude.ai.
- An **alias** maps a top-level name to a collection of another store. For example, `contacts` → `crm: contacts`, set by `bind.set --prefix contacts`. An unmodified page reading `contacts/c1` then reads crm's `contacts/c1`, at most at the alias's level, and at most at the viewer's own level on crm.
- `_stores/<id>/<path>` reaches every store. It is only open to an app that declares `capabilities.db.stores` and that an admin allowed through the `stores` policy cell. `_stores` and `_stores/<id>/_grants…` are **registry documents**: rows of `system.db` shown as documents (`pkg/registry`).

`Space.Resolve(path, doc)` returns an `rt.Target{Store, Path, Own, Cap, Via, Registry}`. `caps/db.DB.Route` turns that into a store handle, the viewer's effective level and the rules to apply.

### 2.9 Actor, event, io [`pkg/actor`]

An app may ship `actor.js`: server-side JavaScript run by goja, one runtime per active store.

```js
defineActor({
  actions: { add: { requires: 'interact', run(ctx, args) { db.doc('tasks/' + args.id).set(args); } } },
  http:    { 'GET /feed': { level: 'public', run: (ctx, req) => ({ json: … }) } },
  alarms:  { nightly: { cron: '0 3 * * *', run(ctx) { … } } },
});
```

Each **event** (an action call, an HTTP request to the actor, an alarm, a reactor, an I/O continuation) runs as one **turn** of the store. `use('db')`, `use('files')` and `use('sql')` act inside that turn. An `await` on real I/O (`sample`, `fetch`, another store's action) ends the turn. The I/O finishes on another goroutine, which posts a continuation event, and the code after the `await` runs in a new turn. Each event has a **visitor**: the person who caused it, with their audience and level. Alarms and reactors have none, and pay as the store's owner.

### 2.10 Verb, door, capability, domain

These four terms describe the architecture. SLOP3-010 is about them.

- A **verb** is one named operation in the **verb table** (`pkg/verbs`): `store.new`, `grant.set`, `docs.query`, `sample.run`: 86 verbs in all. A verb declares:
  - its arguments (or typed input and output, via `verbs.Def[In, Out]`, SLOP3-009 step 2);
  - a token **scope** (read, write, admin) and an **effect** (read, write, govern, stream);
  - an authz **action**, and a `Run` function.

  `verbs.Call(ctx, env, p, name, args)` checks everything and runs it.
- A **door** is a way into the system that turns its own request shape into a principal and a call:
  - the CLI (`cmd/slop`), the HTTP API (`POST /api/v1/<verb>`), the MCP door (`POST /mcp`);
  - the page protocol (`/_rt/rpc`), actor `use()` modules, and trusted Go modules for actors.
- A **capability** is a contract service named after its `use()` name: `db`, `sample`, `files`, `room`, `assets`, `user`, `storage`, `downloads`. Since SLOP3-009, `db` and `sample` each have one implementation (`pkg/caps/db`, `pkg/caps/sample`) shared by every door.
- A **domain** is a part of the platform that owns tables in `system.db` and the rules about them: identity, registry, app governance (policy), billing, LLM.

---

## Part 3. Two requests, traced

### 3.1 A page writes a document

The page runs `await db.doc("tasks/t1").set({title: "Write the guide"})`.

```text
claude.js (web/runtime/src/db.ts)
  POST https://<view-origin>/_rt/rpc   Authorization: Bearer <view secret>
  {"method":"db.write","args":{"path":"tasks/t1","op":"set","body":{"title":"Write the guide"}}}
        │
        ▼
pkg/server/server.go      ServeHTTP: Host is a sandbox origin → s.Sandbox
pkg/server/sandbox.go     /_rt/rpc → the view from the secret (viewOf), confirm its epoch
pkg/server/views.go       rpc switch: "db.write" → rpcDBWrite → s.dbWrite
pkg/caps/db/db.go         DB.Write
   ├─ Route: v.Space.Resolve("tasks/t1", doc) → Target{Store: <own>, Path: "tasks/t1", Own}
   │         level = min(v.Level, target.Cap); rules = v.Caps.Rules
   ├─ WriteRoute: rules.CanWrite("tasks/t1", v.User, level)?  else invalid_argument
   └─ st.Do(ctx, Who{ID: v.User, Via: "page", Level, App}, func(t) { t.SetDoc(...) })
        │ commit rev 42
        ▼
store.OnCommit → kernel subscribers → s.publish (pkg/server/live.go)
   → every view following this store gets  event: doc  {path, version, body, rev}
```

What to notice:

- The page door does **not** call the verb table for `db.*`. That is SLOP3-009's deferred task sa3u.
- Authority is decided twice: whether the view may exist at all (`views.go openView`, from grants), and whether this path may be written (`rules.CanWrite` at the view's level).

### 3.2 An operator grants a level from the CLI

The operator runs `slop grant.set crm @member view`.

```text
cmd/slop/cmds/root.go    verbCommand: positional args → {"store":"crm","subject":"@member","level":"view"}
pkg/client/client.go     Call → POST https://<main host>/api/v1/grant.set   Bearer <token>   X-Slop-Via: cli
        │
        ▼
pkg/server/api.go         apiCall: apiPrincipal (token → Principal{Kind: token, Via: "cli"})
pkg/verbs/verb.go         Call(ctx, s.Env, p, "grant.set", args)
   ├─ Check: verb exists; token has the write scope; authz floor; required args
   ├─ the verb's action is on a store → e.open(ctx, p, "crm", <floor level>) via Access.Can
   └─ v.Run → Def[GrantSetIn, system.Grant].Run (pkg/verbs/stores.go)
        │   strict JSON decode into GrantSetIn; e.Sys.SetGrant(...) in one system Tx
        ▼
system.DB.Tx commits; _changes row {kind: grant, key: "crm @member"}; Listen fires
   → pkg/server/registry.go followSystem: reviewViews("crm") rechecks the open views of crm;
     live registry documents (_stores/crm/_grants) get the new row
```

The verb's code ran once, but it could have been reached through any door. The MCP door would have produced the same `verbs.Call` with `Via: "mcp"`. A trusted actor module would have reached it through `pkg/server/modules.go`, asking the person to confirm first if the verb's effect were `govern`.

---

## Part 4. The packages

### 4.1 Layers

The package map of SLOP3-009 (design doc §10) sorts packages into layers. `internal/archtest/deps_test.go` (the **ratchet**) enforces which layer may import which:

```text
 cmd/slop                         the product: flags, assembly, CLI
   │
 doors      pkg/server            HTTP hosts, page protocol, API, MCP, sign-in, actor wiring
   │
 runtime    pkg/actor             goja, events, turns           (may not import caps)
 caps       pkg/caps/db, sample   contract services             (no HTTP, no goja, no runtime, no doors)
 table      pkg/verbs             the verb table … and today every command
   │
 domains    pkg/system, registry, kernel, billing, llm, identity   (no HTTP, goja, caps, runtime, doors)
   │
 core       pkg/rt, store, access, authz, apps, blobs, ids, config, httpx, client   (no domain and above)
```

The ratchet's rules today:

| Rule | Forbidden imports |
|---|---|
| the verb table imports no domain, capability, runtime or door | `pkg/verbs` → domains, caps, actor, server, goja |
| domains know nothing of HTTP, goja, capabilities, the table's callers or doors | domains → caps, actor, server, `net/http`, goja |
| capabilities know nothing of HTTP, goja, the runtime or doors | caps → actor, server, `net/http`, goja |
| the actor runtime is given its capabilities by a door, through interfaces | actor → caps |
| core imports no domain, capability, runtime, table or door | core → anything above it |
| identity imports no other slop package | `pkg/identity` → any slop package |
| only cmd/ imports the server | anything in pkg → `pkg/server` |

and its allowlist of violations that exist today, which may only shrink:

```go
"pkg/verbs -> pkg/actor", "pkg/verbs -> pkg/billing/stripe", "pkg/verbs -> pkg/kernel",
"pkg/verbs -> pkg/system", "pkg/verbs -> github.com/dop251/goja", "pkg/access -> pkg/system",
```

The test runs `go list -json ./pkg/...` and fails on a forbidden edge that is not listed. It also fails on a listed edge that no longer exists, so the list cannot go stale.

### 4.2 Package by package

| Package | Lines | Role | Key types and functions |
|---|---:|---|---|
| `pkg/rt` | 1,670 | the contract's server-side model, pure | `Level`, `Rules`, `Caps`, `ParseManifest`, `Query`, `Filter`, `Space`, `Target`, `View`, `Patch`, path checks |
| `pkg/store` | 1,716 | one store file | `Open`, `Store.Do`, `Turn`, `Doc`, `File`, `Commit`, `Who`, `Export`/`Restore` |
| `pkg/access` | 394 | who holds what | `Principal`, `Audience`, `Checker.Level/Can/AudienceOf`, `Decision` |
| `pkg/authz` | 112 | actions and floors | `Action`, `Spec`, `Of`, `Floor`, `CodeRight` |
| `pkg/blobs` | 309 | content-addressed bytes, thumbnails | `Blobs.Put/Read` |
| `pkg/apps` | 95 | the app manifest | `Manifest` |
| `pkg/system` | 3,129 | `system.db`, six domains | `DB`, `Tx`, `Log`, `LogAfter`, `Listen`, `Person`, `StoreRow`, `Grant`, `Mount`, `Binding`, `LLMFor`, `NewMeter`, … |
| `pkg/kernel` | 561 | stores ↔ registry | `Kernel.Store/CreateStore/DeleteStore/Running/Rules/Subscribe`, `Access` |
| `pkg/registry` | 472 | registry rows as documents; live documents | `Docs.Coll/Doc/Write`, `Live`, `LastChange` |
| `pkg/llm` | 354 | model backend interface | `Backend`, `Request`, `Event`, `Answer`, `NewRequest`, `Fake`; `llm/gepp` is the real backend |
| `pkg/billing`, `billing/stripe` | 145 + 787 | standing (comps, subscriptions), Stripe | `Policy`, `Decision`, `stripe.Service` |
| `pkg/identity` | 179 | OIDC client | `oidc.go` |
| `pkg/verbs` | 3,634 | the verb table **and every command** | `Verb`, `Def`, `Call`, `Check`, `Callable`, `Env`, `Confirmations`, 85 of the 86 verbs |
| `pkg/caps/db` | 421 | the db capability | `DB.Space/Route/Get/Query/Write/ReaderFor` |
| `pkg/caps/sample` | 201 | the sample capability, `sample.run` | `Sampler.Check/Limits/Run` |
| `pkg/actor` | 3,024 | goja runtime **and its modules** | `Manager`, `Actor`, `Visitor`, `Paths`, `Sampler`, modules for db, sql, files, room, alarm, storage, stores, fetch, secrets |
| `pkg/server` | 5,872 | every door | `Server`, `Build`, `New`, views, live, sandbox, api, mcp, auth, oidc, device, billing webhooks, actor wiring |
| `pkg/client` | 608 | the CLI's HTTP client | `Client.Call/CallStream/Push/Pull` |
| `cmd/slop` | — | the binary | `serve`, `login`, generated verb commands, `verbs`, `verbs tools` |
| `web/runtime` | 2,068 (TS) | `claude.js`, the page side of the contract | `db.ts`, `caps.ts`, `sample.ts`, `room.ts`, `transport.ts` |

---

## Part 5. The knots

### 5.1 What a knot package is

A **knot package** is one that mixes several domains or layers, so that it must import most of the system, and most of the system must import it. Two properties make it a knot rather than just a big package:

1. **Its imports reach every layer.** `pkg/verbs` imports `actor` (runtime), `kernel` and `system` (domains), `billing/stripe`, and goja. Anything that imports `pkg/verbs` therefore depends on all of them.
2. **Its name says a layer, not a subject.** To find everything about identity you read `system/{people,sessions,device,flows,handoffs,guests}.go`, `server/{auth,oidc,device,sitelinks}.go` and `verbs/people.go`. No package is "identity".

The cost is concrete. Each of the following happened or nearly happened in SLOP3-008 and SLOP3-009:

- **A package that wants to register verbs cannot be imported by `pkg/verbs`.** Otherwise there is a cycle: `pkg/registry` imports `pkg/verbs`, so `verbs` can never call into `registry`. SLOP3-009 had to pass `*verbs.Env` into `registry.Docs` to work around it.
- **The actor cannot use a capability package directly** (actor → caps would close a cycle through `verbs`), so capabilities reach actors through interfaces. That is deliberate, but the cycle forces it everywhere.
- **`verbs.Env` is a god object.** Every command receives config, system DB, kernel, actor manager and Stripe service, whether it needs them or not. Until SLOP3-009 step 3 it also carried three callbacks into the server.
- **A second host is impossible.** `host.New()`, a desktop product, or two servers in one test process all need their own verb table. Today the table is a package-global map filled by 14 `init()` functions.

### 5.2 The four knots, measured

| Knot | Lines | Mixes | Imports (slop and third-party, excluding stdlib) |
|---|---:|---|---|
| `pkg/verbs` | 3,634 | the table machinery; commands for registry, identity, billing, policy, LLM, data, files, actors, eval | access, actor, apps, authz, billing/stripe, blobs, config, ids, kernel, rt, store, system, goja, jsonschema |
| `pkg/system` | 3,129 | `system.db` and the system log; identity, registry, governance, billing, LLM tables | billing, ids, llm, sqlite3 |
| `pkg/server` | 5,872 | four HTTP hosts; page protocol; API; MCP; sign-in; Stripe webhooks; actor module wiring | 19 slop packages, goja |
| `pkg/actor` | 3,024 | the goja runtime; modules for db, sql, files, room, alarm, storage, stores, fetch, secrets, sample | access, apps, kernel, llm, rt, store, system, goja, cron |

### 5.3 Why now

SLOP3-009 chose **split as you go**: no pull request only moves code; each feature moves what it touches. That moved the registry documents, the path space and the sampler out of the knots. But features rarely touch the knots' joints. `pkg/verbs` grew from 3,294 to 3,634 lines during SLOP3-009, and the MCP door added 255 lines to `pkg/server`. The seams the moves need now exist:

- typed verbs;
- `verbs.Callable`;
- the registry's `Host` interface;
- the actor's `Paths` and `Sampler` interfaces;
- the ratchet.

So SLOP3-010 makes the remaining moves deliberately, as four pull requests that change no behaviour.

---

## Part 6. The target shape

### 6.1 After SLOP3-010

```text
cmd/slop/                     the product: flags, host assembly, CLI
pkg/
  host/                       assembly: builds the table, domains, capabilities and doors     (PR 3)
  doors/
    web/                      shared HTTP plumbing: principal from request, SSE, errors       (PR 3)
    auth/                     sign-in: local, OIDC, device codes, handoffs, site links        (PR 3)
    api/  mcp/                POST /api/v1/<verb>, POST /mcp                                   (PR 3)
    pages/                    views, live and static hosts, sandbox, the page protocol         (PR 3)
    actors/                   the actor door: use() modules, trusted modules, platform        (PR 3, PR 4)
    billing/                  Stripe webhooks and checkout redirects                          (PR 3)
  verbs/                      the table only: Verb, Def, Table, Call, Check, schemas, Emit    (PR 1)
  commands/                   the commands: they coordinate kernel and domains (PR 1; stays)
  sysdb/                      system.db: open, migrations, Tx, the system log, shared rows   (PR 2, core)
  identity/                   people, sessions, tokens, device codes, flows, handoffs, guests (PR 2)
  registry/                   stores, grants, links, bindings, mounts, previews; documents    (PR 2)
  policy/                     app policy cells, secrets, trusted modules                     (PR 2)
  billing/                    comps, subscriptions, standing; billing/stripe                  (PR 2)
  llm/                        backends, request building; the ledger (access, usage, holds)   (PR 2)
  kernel/                     store lifecycle, app versions                                   (unchanged)
  actor/                      the goja runtime only                                           (PR 4)
  caps/db sample files sql room storage                                                       (PR 4)
  rt/ store/ access/ authz/ apps/ blobs/ ids/ config/ httpx/ client/                          core
```

### 6.2 Dependency rules after SLOP3-010

| Layer | May import | May not import |
|---|---|---|
| core | core | anything else (`access → system` resolved in PR 2) |
| `verbs` (table) | core, jsonschema | domains, caps, runtime, doors, goja |
| `sysdb` | core | everything else |
| domains | core, `sysdb`, `verbs` (to register), other domains' exported functions | caps, runtime, doors, `net/http`, goja; another domain's tables |
| caps | core, domains, `verbs` | runtime, doors, `net/http`, goja |
| `commands` | core, domains, caps, `verbs`, runtime | doors |
| runtime (`actor`) | core, domains | caps, doors |
| doors | everything below | other doors except `doors/web` |
| `host` | everything | — |

The allowlist at the end of SLOP3-010 is empty.

---

## Part 7. PR 1: the verb table as a leaf

### 7.1 Goal

After PR 1, `pkg/verbs` imports only core packages and `invopop/jsonschema`. The five `pkg/verbs → …` allowlist entries disappear. The commands move to `pkg/commands`, and every door reaches them through a `*verbs.Table` value instead of a package global plus `*verbs.Env`.

No behaviour changes: every verb keeps its name, arguments, scope, effect, action, errors and output.

### 7.2 What is wrong with the current API

```go
// pkg/verbs/verb.go today
type Verb struct {
    Name string; Doc string; Scope Scope; Effect Effect; AdminOnly bool
    Action authz.Action; StoreArg string; Args []Arg
    Input, Output *jsonschema.Schema
    Run func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error)
}
var registry = map[string]*Verb{}                 // package global
func Register(vs ...*Verb)                        // called from 14 init() functions
func Call(ctx context.Context, e *Env, p *access.Principal, name string, a Args) (any, error)

// pkg/verbs/env.go today
type Env struct {
    Cfg *config.Config; Sys *system.DB; K *kernel.Kernel; A *actor.Manager
    Billing *stripe.Service
    confirms *Confirmations; confirmsOnce sync.Once
}
```

`Run`'s signature names `*Env`, and `Env` names five domain and runtime types. That single field is why the table package must import them. `Call` also needs the kernel: before running a verb whose action is on a store, it opens the store through `e.open`, which asks `e.K.Access.Can`.

### 7.3 The new API

```go
package verbs // pkg/verbs: imports access, authz, rt, ids, jsonschema only

// Run is a verb's body. Its dependencies are captured when the verb is
// built, not passed per call.
type Run func(ctx context.Context, p *access.Principal, a Args) (any, error)

type Verb struct {
    Name, Doc string; Scope Scope; Effect Effect; AdminOnly bool
    Action authz.Action; StoreArg string; Args []Arg
    Input, Output *jsonschema.Schema
    Run Run
}

// Stores is the table's one dependency: the floor check on the store a
// verb's action is on (today's Env.open).
type Stores interface {
    Check(ctx context.Context, p *access.Principal, store string, need rt.Level, what string) error
}

// Table is a set of verbs. A host owns one.
type Table struct {
    Stores Stores
    byName map[string]*Verb
    order  []*Verb
}

func NewTable() *Table
func (t *Table) Register(vs ...*Verb)          // panics on a duplicate name
func (t *Table) Get(name string) (*Verb, bool)
func (t *Table) All() []*Verb                  // sorted by name
func (t *Table) Check(p *access.Principal, name string, a Args) error
func (t *Table) Callable(p *access.Principal, v *Verb) bool
func (t *Table) Call(ctx context.Context, p *access.Principal, name string, a Args) (any, error)

// Default is the CLI's table (the commands listed, unbound). There are no
// package-level Register, Get, All, Call or Check: a door that used them
// would silently reach Default instead of its host's table. (The first
// draft of PR 1 kept them as delegates; four server tests then failed with
// "no verb people.role", from a verbs.Check left in modules.go.)
var Default = NewTable()

// Typed verbs: Req loses Env; the Def's Run closes over what it needs.
type Req struct {
    context.Context
    Principal *access.Principal
}
type Def[In, Out any] struct {
    Name, Doc string; Scope Scope; Effect Effect; AdminOnly bool
    Action authz.Action; StoreArg string
    Run func(r Req, in In) (Out, error)
}

// Confirmations stays a table-level type (a pending-confirmation book),
// owned by the host and handed to the doors that ask people to confirm.
type Confirmations struct{ … }                 // unchanged
func NewConfirmations() *Confirmations
```

`Table.Call` is today's `Call` with `e.open` replaced by `t.Stores.Check`:

```go
func (t *Table) Call(ctx context.Context, p *access.Principal, name string, a Args) (any, error) {
    if a == nil { a = Args{} }
    if err := t.Check(p, name, a); err != nil { return nil, err }
    v, _ := t.Get(name)
    if spec, _ := authz.Of(v.Action); spec.Store {
        if id := v.store(a); id != "" {
            if err := t.Stores.Check(ctx, p, id, spec.Level, v.Name); err != nil { return nil, err }
        }
    }
    return v.Run(ctx, p, a)
}
```

`Check` today also imports `system` for one comparison (`p.Person.Role == system.RoleAdmin`, choosing the "needs a token with the admin scope" message). Use `p.Person.Role == "admin"` through an `access` helper, `(*Principal).IsAdminPerson()`, so `verbs` stops importing `system`.

### 7.4 pkg/commands

```go
package commands // pkg/commands: every command not yet owned by a domain

// Env is what commands work against: today's verbs.Env, minus the table.
type Env struct {
    Cfg     *config.Config
    Sys     *system.DB
    K       *kernel.Kernel
    A       *actor.Manager
    Billing *stripe.Service
    Confirm *verbs.Confirmations
    Verbs   *verbs.Table // eval and actor.call reach other verbs through it
}

// Verbs builds every command bound to e. With e nil they can be listed
// (names, arguments, schemas, docs: the CLI's help) but not run.
func Verbs(e *Env) []*verbs.Verb {
    var vs []*verbs.Verb
    for _, group := range []func(*Env) []*verbs.Verb{
        storeVerbs, grantVerbs, mountVerbs, accessVerbs, peopleVerbs, billingVerbs,
        policyVerbs, docsVerbs, dataVerbs, filesVerbs, actorVerbs, evalVerbs, previewVerbs, confirmVerbs,
    } {
        vs = append(vs, group(e)...)
    }
    return vs
}

// Install registers the commands (and capabilities' verbs) into t and
// makes e the table's store check.
func Install(t *verbs.Table, e *Env) {
    t.Register(Verbs(e)...)
    t.Register(sample.Verbs(sampleDeps(e))...)   // pkg/caps/sample: no more init()
    if e != nil { t.Stores = e; e.Verbs = t }
}

// Check implements verbs.Stores: today's Env.open, without returning the store.
func (e *Env) Check(ctx context.Context, p *access.Principal, id string, need rt.Level, what string) error
```

Each file's `func init() { Register(...) }` becomes a group function. The closures capture `e`:

```go
// before: pkg/verbs/stores.go
func init() {
    Register(
        &Verb{Name: "store.rm", …, Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
            return map[string]any{"removed": a.S("id")}, e.K.DeleteStore(ctx, p, a.S("id"))
        }},
    )
}

// after: pkg/commands/stores.go
func storeVerbs(e *Env) []*verbs.Verb {
    return []*verbs.Verb{
        {Name: "store.rm", …, Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
            return map[string]any{"removed": a.S("id")}, e.K.DeleteStore(ctx, p, a.S("id"))
        }},
    }
}
```

The typed verbs change the same way: `r.Env.Sys` becomes `e.Sys`.

### 7.5 Call sites that change

| File | Today | After PR 1 |
|---|---|---|
| `cmd/slop/cmds/serve.go:86` | `env := &verbs.Env{Cfg, Sys, K, A}` | `env := &commands.Env{…, Confirm: verbs.NewConfirmations()}`; `commands.Install(verbs.Default, env)` |
| `cmd/slop/cmds/root.go` | `verbs.All()` (filled by `init()`) | `commands.Install(verbs.Default, nil)` once (`sync.Once`) before building the CLI, then `verbs.Default.All()` |
| `pkg/server/server.go` | `Env *verbs.Env`; `Build(ctx, cfg, sys, env)`, `New(cfg, sys, env)` | `Env *commands.Env` and `Verbs *verbs.Table`; `New` installs the commands into a fresh table when the Env has none (never into `Default`: the CLI lists there, and `slop serve` would register every verb twice) |
| `pkg/server/api.go:68,107`, `mcp.go:222`, `platform.go:52`, `modules.go:145` | `verbs.Call(ctx, s.Env, p, name, args)` | `s.Verbs.Call(ctx, p, name, args)` |
| `pkg/server/modules.go:139`, `live.go:705` | `s.Env.Confirmations()` | `s.Env.Confirm` |
| `pkg/registry/registry.go:36`, `documents.go:51,265,268` | `Env *verbs.Env`; `verbs.Call(…, d.Env, p, …)`; `d.Env.Confirmations()`; `d.Env.K.Access` | `Verbs *verbs.Table`, `Confirm *verbs.Confirmations`, `Access *access.Checker` |
| `pkg/caps/sample/verb.go` | `init()` + `r.Env.Sys`, `r.Env.A.LLM`, `r.Env.K.Access` | `func Verbs(d Deps) []*verbs.Verb` with `Deps{Sys, Backend func() llm.Backend, Access}` |
| `pkg/server/harness_test.go:66` | `&verbs.Env{…}` | as `serve.go` |

`pkg/verbs/eval.go` moves to `pkg/commands/eval.go`. It calls verbs through `e.Verbs`, which removes goja from `pkg/verbs`.

### 7.6 Tests that move

- `pkg/verbs/def_test.go` tests real verbs (`grant.set`, `docs.query`, `mount.set`, the effects of all verbs). Split it:
  - the machinery tests (`decodeArgs` with a local input struct, `argsOf`, `InputSchema`, `Tool`) stay in `pkg/verbs` against a test-only `Def`;
  - the tests of real verbs move to `pkg/commands/def_test.go` and run against `commands.Verbs(nil)`.
- `pkg/verbs/actions_test.go` (if it tests real verbs) moves the same way.
- `TestEffects` moves to `pkg/commands`. There it sees `sample.run` too, which ends the "not linked here" exception.

### 7.7 The ratchet after PR 1

```go
var (
    table    = []string{"pkg/verbs"}
    commands = []string{"pkg/commands"}
    …
)
rules += {"commands are reached through the table, never imported by a door", doors, commands} // except host assembly: cmd/ and, from PR 3, pkg/host
rules += {"commands import no door", commands, doors}
allowed = {"pkg/access -> pkg/system": true}  // the five pkg/verbs entries are gone
```

Doors should not import `pkg/commands`: they hold a `*verbs.Table` and a `*commands.Env`. For PR 1, `pkg/server` still needs `commands.Env` as a type, because `Server.Env` serves the actor wiring. Allow `pkg/server -> pkg/commands` as an allowlisted edge that PR 3 removes, when `pkg/host` takes over assembly.

### 7.8 Implementation steps

1. `git mv` every command file from `pkg/verbs` to `pkg/commands`: `access.go actors.go billing.go confirm.go` (the verb only; the type stays) `data.go docs.go eval.go files.go mounts.go people.go policy.go preview.go stores.go`, and from `env.go` the `Env` type and helpers.
2. In `pkg/commands`, change `package verbs` to `package commands`. Qualify the table's names: `Verb` → `verbs.Verb`, `Args` → `verbs.Args`, `Arg`, `Read`, `Write`, `Errf`, `Error`, `Def`, `Req`, `EffectGovern`.
3. Turn each `func init() { Register(a, b, c) }` into `func xVerbs(e *Env) []*verbs.Verb { return []*verbs.Verb{a, b, c} }`.
4. Mechanically change the Run signature. This regular expression covers 81 of the Run functions:
   ```text
   Run: func(ctx context.Context, e *Env, p *access.Principal, a Args)
     → Run: func(ctx context.Context, p *access.Principal, a verbs.Args)
   ```
   The remaining ones (typed `Def`s, helpers taking `e`) are fixed by hand, compiler-driven.
5. Write `pkg/verbs/table.go` (Table, Default, Stores) and cut `pkg/verbs/verb.go` down to it.
6. Write `commands.Verbs`, `commands.Install`, `(*Env).Check`.
7. Update the call sites (7.5), then the tests (7.6), then the ratchet (7.7).
8. `GOWORK=off go build ./... && go vet ./...`, the full test suite, lint, and the checks in 7.9.

### 7.9 How to know it worked

- **The ratchet passes with the five entries removed.** Re-adding an import of `pkg/actor` to `pkg/verbs` must fail it (mutation).
- **The verb table is identical.** Before and after, `slop verbs --output json` and `slop verbs tools` must produce byte-identical output. Diff them; this is the strongest check that nothing moved but code.
- `GOWORK=off go test ./... -count=1` passes. No test is deleted, only moved.
- `TestMCPDoor` and `TestTypedVerbsOverTheAPI` cover the doors end to end.

### 7.10 Risks

- **Init order.** Today every importer of `pkg/verbs` sees a full table, filled by `init()`. After PR 1 the table is empty until `Install`. A door or test that reads `verbs.All()` before `Install` sees nothing. The CLI's root command must call `Install(verbs.Default, nil)` before generating subcommands.
- **The nil Env.** With `e == nil`, building a verb must not dereference `e`. Only `Run` may. A command that computes something from `e` at build time (for example a doc string from config) has to move that into `Run`.
- **`caps/sample` registered itself in `init()`**, so it was in every binary that linked it. Now it is in a table only if `Install` registers it. Forgetting it would silently drop `sample.run`. The byte-identical `slop verbs` check catches that.

---

## Part 8. PR 2: system.db split by domain

### 8.1 Goal

`pkg/system` becomes `pkg/sysdb`, which holds the database handle, migrations, `Tx`, the system log and `Listen`. Each domain's tables and queries move to the domain's package, and each domain's commands move from `pkg/commands` next to them. `access → system` is resolved, which empties the allowlist except for PR 3's temporary entry.

### 8.2 Where each file goes

The table names come from the SQL in each file.

| `pkg/system` file | Tables it touches | Goes to | Notes |
|---|---|---|---|
| `system.go` (287) | `_log`, `_changes`, `_schema` | `pkg/sysdb` | `Open`, migrations, `Tx`, `Log`, `LogAfter`, `LogHead`, `Listen`, `Epoch`, `NowMs`, `Change` |
| `people.go` (176), `sessions.go` (263) | `people`, `sessions`, `tokens` | `pkg/identity` | `Person`, roles, scopes, `SignInUser`, `CreateToken`, `TouchPerson` |
| `device.go`, `flows.go`, `handoffs.go` | `device_codes`, `login_flows`, `handoffs`, `origins` | `pkg/identity` | `origins` is read by handoffs only |
| `guests.go` (127) | `people`, `sessions`, `grants` | `pkg/identity`, with the grant sweep in `pkg/kernel` | crosses domains: guests are identity; their grants are registry (`kernel.SweepGuests` already calls both) |
| `stores.go` (281), `links.go`, `bindings.go`, `previews.go`, `mounts.go` | `stores`, `grants`, `links`, `bindings`, `schedules`, `previews`, `mounts`, `mount_log` | `pkg/registry` | joins the registry documents already there |
| `policy.go` (418) | `app_policy`, `secrets`, `llm_access`, `llm_usage` | `pkg/policy` (cells, secrets), `pkg/llm` (`LLMFor`, access rows) | split the file |
| `modules.go` (75) | `app_modules`, `people` | `pkg/policy` | reads `people` to check the trusting admin: call `identity` |
| `ledger.go` (229) | `llm_holds`, `llm_usage` | `pkg/llm` | `Meter` moves next to `llm.Meter`, its interface |
| `billing.go` (440) | `comps`, `stripe_*`, `checkout_attempts` | `pkg/billing` | `billing/stripe` keeps the gateway |

### 8.3 The domain packages' shape

Each domain is a value over the shared database, with the queries as methods:

```go
package identity

type DB struct{ db *sysdb.DB }
func New(db *sysdb.DB) *DB

func (d *DB) Person(ctx context.Context, id string) (Person, error)
func (d *DB) SignInUser(ctx context.Context, email, name, subject string, admins []string, verified bool) (Person, bool, error)
func (d *DB) CreateToken(ctx context.Context, person, name string, scopes []string, days int) (string, Token, error)
…
// Verbs are identity's commands (today's commands/people.go).
func Verbs(d *DB, …) []*verbs.Verb
```

The 95 distinct `Sys.X` methods called outside `pkg/system` become calls on the owning domain. For example, `s.Sys.Person(ctx, id)` becomes `s.People.Person(ctx, id)`. The compiler finds every one.

### 8.4 Migrations

The SQL files `pkg/system/migrations/001…009` have run in production, so their order and contents cannot change. They move to `pkg/sysdb/migrations` unchanged, as one sequence owned by `sysdb`. Each new migration from PR 2 on is named after its domain (`010_identity_…sql`). Per-domain migration directories, which design doc §8 asked of `identity`, wait until a domain leaves the repository.

### 8.5 access → system

`pkg/access` reads `system.Person`, `system.StoreRow`, `system.Grant` and the role constants. After PR 2 those live in `identity` and `registry`, both domains, and core may not import domains. `access` decides; it should not know where rows come from:

```go
package access

// Directory is what the checker reads: implemented by the host over identity and registry.
type Directory interface {
    Store(ctx context.Context, id string) (StoreRow, error)
    Grants(ctx context.Context, store string) ([]Grant, error)
    Subscribed(ctx context.Context, person string) bool
}
// Person, StoreRow, Grant: access's own small structs, holding the fields
// a decision reads. identity.Person and registry.StoreRow convert to them.
```

This is the one design change in PR 2. Review it as such. Everything else in PR 2 is moves.

> **As built (PR #24).** The shared rows (`Person`, roles, scopes, `StoreRow`, `Grant`, `GrantLink`, `Link`, `GroupsOf`) live in `pkg/sysdb`, which is core, rather than as `access`-owned copies. `Principal.Person` is read everywhere, so copies would have rippled for no gain. `access.Directory` carries only the four queries the checker makes (`StoreByID`, `Grants`, `Person`, `NowMs`). The kernel implements it over `Registry` and `People`.

### 8.6 Order inside PR 2

Make one commit per domain, each compiling and passing tests:

1. `sysdb`;
2. `identity`;
3. `registry`;
4. `policy`;
5. `llm` (ledger);
6. `billing`;
7. `access.Directory`;
8. delete `pkg/system`.

Domain commands move with their domain (`commands/people.go` → `identity/verbs.go`). Commands that span domains, such as `store.new`, which creates a file (kernel) and a registry row, stay in `pkg/commands` or move to `kernel`.

> **As built (PR #24): commands stay in `pkg/commands`.** Five of the six command files call the kernel or several domains; only `people.go` touches a single domain. The kernel imports the registry (and the other domains), so `registry` cannot import `kernel`. `pkg/commands` is therefore the layer that coordinates domains, not a staging package that empties. PR 4 may still move capability commands (`docs.*`, `files.*`, `sql.*`) to their capabilities, which may import the kernel.

---

## Part 9. PR 3: pkg/server split into doors

### 9.1 Goal

`pkg/server` becomes `pkg/host` (assembly and host-header dispatch) plus one package per door. The `Server` struct, which holds every door's state, splits into one struct per door with explicit dependencies.

### 9.2 Where each file goes

| `pkg/server` files | Goes to | Holds |
|---|---|---|
| `server.go` (290) | `pkg/host` | `New` (builds table, domains, caps, doors), `ServeHTTP` (dispatch on `Cfg.HostKind`), `ListenAndServe`, background loops |
| `auth.go`, `oidc.go`, `device.go`, `sitelinks.go`, `once.go` | `pkg/doors/auth` | sign-in pages and flows, device codes, site links, one-time handoffs |
| `api.go` | `pkg/doors/api` | `POST /api/v1/<verb>`, streaming (`apiStream`) |
| `mcp.go` | `pkg/doors/mcp` | `POST /mcp` |
| `views.go`, `live.go`, `sandbox.go`, `site.go`, `space.go`, `registry.go` (the follower), `rtassets.go`, `rtfiles.go`, `sample.go`, `preview.go`, `storebytes.go` | `pkg/doors/pages` | views, the page protocol, live and static hosts, sandbox origins, the system-log follower |
| `actors.go`, `modules.go`, `modsystem.go`, `modworkshop.go`, `platform.go` | `pkg/doors/actors` | the actor door: room emit, trusted modules (with confirmation), the platform module |
| `billing.go` | `pkg/doors/billing` | Stripe webhooks, checkout and portal redirects |
| `admin.go` | `pkg/doors/office` | the back office shell |
| shared helpers: `principalOf`, `withPrincipal`, `rtFail`/`rtErr`, `writeSSE`, `trustedDefaults` | `pkg/doors/web` | used by every door |

### 9.3 Cross-door dependencies

Some doors call into others today, through the shared `Server`:

| Caller | Needs | Resolution |
|---|---|---|
| pages | the principal of a request (`principalOf`, sessions) | `doors/web.Principals` interface, implemented by `doors/auth` |
| actors | open views of a store (room peers, `actorEmit`) | `doors/pages.Rooms` interface passed to the actor door |
| api, mcp | `TouchPerson` | `identity` directly |
| pages (`/_site/views`) | sign-in redirects | URLs from `doors/auth`, as strings |

Rule: a door imports `doors/web` and below, never another door. The host passes each door the interfaces it needs.

### 9.4 Host assembly

```go
package host

func New(ctx context.Context, cfg *config.Config) (*Host, error) {
    db := sysdb.Open(cfg)
    people, reg, pol, ledger, bill := identity.New(db), registry.New(db), policy.New(db), llm.NewLedger(db), billing.New(db)
    k := kernel.New(cfg, db, reg, access.NewChecker(directory{people, reg, bill}))
    a := actor.New(k)
    table := verbs.NewTable()
    confirm := verbs.NewConfirmations()
    // each owner registers its verbs; the table's store check is the kernel's
    table.Register(identity.Verbs(people)...)
    table.Register(registry.Verbs(reg, k)...)
    …
    table.Stores = k
    auth := authdoor.New(cfg, people)
    pages := pagesdoor.New(cfg, k, table, capsdb.New(k, …), capsample.New(…), auth)
    actors := actorsdoor.New(a, table, confirm, pages)
    return &Host{cfg: cfg, main: mux(auth, api.New(table, auth), mcp.New(table, auth), office.New(…), billingdoor.New(…)),
                 live: pages.Live(), static: pages.Static(), sandbox: pages.Sandbox()}, nil
}
```

`cmd/slop serve` becomes `host.New(ctx, cfg)` plus `ListenAndServe`.

### 9.5 Tests

`pkg/server`'s tests (about 40 files) are end-to-end tests over `newHarness`. They do not belong to one door. Move them to `pkg/host` with the harness. Unit tests of one door move with it later.

---

## Part 10. PR 4: actor modules into capabilities

### 10.1 Goal

`pkg/actor` keeps only the runtime: `Manager`, `Actor`, events, turns, `io`, the inbox, alarms, `time` and `log`. Every `use()` module that is a contract capability moves:

- **the Go core** to `pkg/caps/<name>` (no goja: the ratchet forbids it);
- **the JavaScript binding** to the actor door (`pkg/doors/actors/<name>.go`), which turns goja values into calls on the capability.

### 10.2 What moves

| Actor module (`pkg/actor/modules.go`, `sample.go`, `storage.go`) | Capability core | Binding | Page side, merged too |
|---|---|---|---|
| `db` | `caps/db` (exists) | `doors/actors/db.go` | `doors/pages` (already on `caps/db`) |
| `sample` | `caps/sample` (exists) | `doors/actors/sample.go` | already on `caps/sample` |
| `files` | `caps/files` (new) | `doors/actors/files.go` | `rtfiles.go` |
| `sql` | `caps/sql` (new) | `doors/actors/sql.go` | the `sql.*` verbs from `commands/data.go` |
| `room` | `caps/room` (new) | `doors/actors/room.go` | room handling in `views.go` |
| `storage` | `caps/storage` (new) | `doors/actors/storage.go` | — |
| `stores`, `fetch`, `secrets`, `platform` | stay actor-door features (not contract capabilities) | `doors/actors` | — |

### 10.3 The module interface

```go
package actor

// Module is a use() name the door provides. Load runs once per actor and
// returns the module's JavaScript value (null: not available to this app).
type Module interface {
    Name() string
    Load(a *Actor) goja.Value
}
func (m *Manager) Provide(mods ...Module)
```

`Actor.module(name)` looks up provided modules before the built-in ones (`time`, `log`, `alarm`). The `Paths` and `Sampler` interfaces from SLOP3-009 become unnecessary: the bindings in the door hold `*capsdb.DB` and `*capsample.Sampler` directly.

### 10.4 Risk

The actor's in-turn semantics must survive the move. A module that writes the actor's own store must use `a.Turn()`, not a fresh `Store.Do` that would deadlock on the store's mutex. The existing actor tests (`pkg/server/actors_test.go`, `llm_policy_test.go`, `actor_db_test.go`, the examples) cover this; run them under `-race`.

---

## Part 11. Working rules for move pull requests

- **A move PR changes no behaviour.** Renames and signature changes forced by the move are allowed. A fix found during the move goes in its own commit with its own test, as the registry race did in SLOP3-009.
- **Prove the table did not change.** Capture `slop verbs -o json` and `slop verbs tools -o json` before the PR; the output after must be byte-identical.
- **Move with `git mv`, then edit.** Git then shows the file as renamed with a small diff, which is what the reviewer reads. Don't rewrite and move in one step.
- **Let the compiler drive.** After each move, `GOWORK=off go build ./...` lists every call site. Fix them, don't search for them.
- **Tighten the ratchet in the same PR.** Remove the allowlist entries the move deletes and add the rules it makes possible. The stale-entry check fails if an entry is left behind.
- **Mutation-check the new rules.** Add the forbidden import back by hand and watch the ratchet fail.
- **Back up untracked files before mutating them.** `git checkout` does not restore a file git does not know (SLOP3-009 step 3).
- **Run the full suite at each commit.** Use `GOWORK=off go test ./... -count=1` and `golangci-lint run --new-from-rev=origin/main`.

---

## Part 12. API reference

### 12.1 The table (`pkg/verbs`, after PR 1)

| API | Meaning |
|---|---|
| `type Verb struct` | `Name, Doc, Scope, Effect, AdminOnly, Action, StoreArg, Args, Input, Output, Run` |
| `type Run func(ctx, p *access.Principal, a Args) (any, error)` | a verb's body; dependencies captured at build time |
| `type Def[In, Out]`, `Def.Verb()` | a typed verb; arguments and schemas from In and Out; strict decoding |
| `type Req struct{ context.Context; Principal }`, `Req.Emit(part)` | what a typed Run receives; Emit streams a part |
| `WithEmit(ctx, fn)`, `Emit(ctx, part)` | a streaming door installs an emitter; a verb emits |
| `type Effect`: `EffectRead/Write/Govern/Stream` | govern: an app's call needs the person's confirmation; stream: partial results |
| `type Scope`: `Read/Write/Admin` | the token scope a verb needs |
| `type Table`, `NewTable`, `Default` | a set of verbs; `Register`, `Get`, `All`, `Check`, `Callable`, `Call` (methods only; `Default` is the CLI's listing table) |
| `type Stores interface{ Check(ctx, p, store, need, what) error }` | the floor check on a verb's store |
| `Verb.InputSchema()`, `Verb.Tool()` | JSON Schema of the arguments; the MCP tool form |
| `type Error{Code, Message, Trace}`, `Errf`, `AsError`, `Error.Status()` | verb errors and their HTTP status |
| `type Confirmations`, `NewConfirmations`, `Check`, `Approve` | the pending-confirmation book for govern verbs called by apps |

### 12.2 Capabilities

| API | Meaning |
|---|---|
| `capsdb.DB{K, Host, Reg}` | the db capability |
| `DB.Space(ctx, store, caps, stores)` | a view's path space from the store's bindings |
| `DB.Route(ctx, v, path, doc)` → `Route{Tgt, St, Level, Held, Rules, Found}` | where a path lands and at what level |
| `DB.Get`, `DB.Query`, `DB.Write(ctx, v, who, WriteIn)` | read and write through the space |
| `DB.ReaderFor(ctx, v, store)`, `Reader.PagePaths` | the stream's per-store view of commits |
| `capsample.Sampler{Backend, Sys}` | the sample capability |
| `Sampler.Check(ctx, payer, audience)`, `Limits` | LLM access and budget |
| `Sampler.Run(ctx, payer, limits, req, emit, execute)` → `llm.Answer` | a metered model call |
| `llm.NewRequest(prefix, llm.In, images)`, `llm.InputOf`, `llm.ParseJSON` | building a request |

### 12.3 Doors (after PR 3)

| Door | Entry | Principal | Reaches |
|---|---|---|---|
| CLI | `cmd/slop` → `client.Call/CallStream` | the token | HTTP API |
| HTTP API | `POST /api/v1/<verb>`, `GET /api/v1/verbs` | token, or session plus `X-CSRF-Token` | `table.Call` |
| MCP | `POST /mcp` (initialize, tools/list, tools/call) | token only | `table.Callable`, `table.Call` |
| pages | `POST /_site/views`, `/_rt/events`, `/_rt/rpc`, `/_rt/sample` | the viewer (view secret) | `caps/db`, `caps/sample`, rooms |
| actors | `use(name)` in actor.js | the event's visitor | caps through the door's bindings, `table.Call` for trusted modules |

---

## Part 13. File reference

| Path | What to read it for |
|---|---|
| `internal/archtest/deps_test.go` | the layers, the rules, the allowlist |
| `pkg/verbs/verb.go`, `def.go`, `env.go`, `confirm.go` | the table today; PR 1's starting point |
| `pkg/verbs/stores.go`, `docs.go`, `mounts.go` | examples of typed verbs (`grant.set`, `docs.query`, `mount.set`) |
| `pkg/verbs/eval.go` | eval: every verb as `slop.<group>.<verb>()` in goja |
| `pkg/system/system.go` | `Tx`, the system log, `Listen` |
| `pkg/system/migrations/*.sql` | the schema of `system.db` |
| `pkg/store/turn.go`, `docs.go`, `files.go` | turns, commits, documents, files |
| `pkg/access/check.go` | how a level is decided |
| `pkg/rt/space.go`, `rules.go`, `views.go` | path space, rules, views |
| `pkg/caps/db/db.go`, `pkg/caps/sample/*.go` | the two capabilities so far |
| `pkg/registry/*.go`, `pkg/server/registry.go` | registry documents; the system-log follower |
| `pkg/server/server.go` | host dispatch and assembly today |
| `pkg/server/views.go`, `live.go`, `sandbox.go` | the page protocol |
| `pkg/server/api.go`, `mcp.go` | the HTTP and MCP doors |
| `pkg/server/modules.go`, `modsystem.go` | trusted modules and confirmation |
| `pkg/actor/actor.go`, `manager.go`, `modules.go` | the runtime and its modules |
| `cmd/slop/cmds/serve.go`, `root.go` | assembly today; the generated CLI |
| `ttmp/2026/11/03/SLOP3-009--…/design-doc/01-…md` | the framework design this ticket implements |

---

## Part 14. Open questions

1. **Domain commands or one commands package?** PR 1 puts every command in `pkg/commands`, and PRs 2 and 4 empty it into domains and capabilities. If a command spans domains (`store.new`: kernel file plus registry row; `link.new`: registry plus identity guests), it may stay in `pkg/commands`, or move to `pkg/kernel`, the one domain allowed to coordinate stores and the registry. Decide per command in PR 2.
2. **`access` types.** PR 2 gives `access` its own `Person`, `StoreRow` and `Grant` structs behind a `Directory`. The alternative is to reclassify `access` as a domain, which is simpler but leaves core unable to decide anything.
3. **Do the end-to-end tests stay in one package?** Moving them to `pkg/host` (PR 3) is the least work. Splitting them per door gives faster, more focused tests, at the cost of duplicating the harness.
4. **Where does a capability's TypeScript live?** Still open from SLOP3-009 §12. PR 4 is the moment to put `web/runtime/src/db.ts` next to `pkg/caps/db`, if that is wanted.
