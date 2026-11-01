---
Title: 'slop v3 core: design and implementation guide for interns'
Ticket: SLOP3-001
Status: active
Topics:
    - architecture
    - hosting
    - access
    - sqlite
    - goja
    - agents
    - llm
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/go-go-golems/francois/pkg/catalog/billing/policy.go
      Note: Subscription decision copied into pkg/billing
    - Path: abs:///home/manuel/code/wesen/go-go-golems/francois/pkg/catalog/payments/service.go
      Note: Stripe Checkout, Portal, webhook ingest and worker copied into pkg/billing/stripe
    - Path: abs:///home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/live.go
      Note: SLOP-011 live sites, guests and handoff to port
    - Path: repo://design/slop-v3-design.md
      Note: The full slop-v3 design this guide cuts down
    - Path: repo://lab/dist/styles.css
      Note: The Form Skate design system, the back office's look
    - Path: repo://lab/src/kernel/actors.js
      Note: Turns, continuations and reactors to port into pkg/actor
    - Path: repo://lab/src/kernel/sqlite.js
      Note: Authorizer policy to port into pkg/sqlpolicy
    - Path: repo://lab/src/seeds/journal/actor.js.txt
      Note: Example actor; becomes examples/journal
ExternalSources: []
Summary: 'What slop v3 core is, how its parts fit together, and how to build it: stores, apps, actors, mounts, audiences, the app policy matrix, LLM budgets, the verb table with CLI/HTTP/eval, the back office, and a phased plan reusing slop-computer, francois and go-go-goja.'
LastUpdated: 2026-11-01T13:00:00-05:00
WhatFor: Onboarding an intern who will implement slop v3 core; the reference for its data model, APIs and phases.
WhenToUse: Before writing any v3 code, and whenever a design question about stores, access, policy or serving comes up.
---

# slop v3 core: design and implementation guide

This guide explains slop v3 core: what it is for, the handful of ideas it is
built from, how a request travels through it, and how to build it in phases.
It is written for an intern who has not seen slop before. Read sections 1 to 3
first: they give the whole picture in a few pages. The later sections go deep
on one part each, and the appendices are the reference you will code against.

## 1. Executive summary

slop v3 core is a single Go binary, `slop`, that is both a server and a
command-line tool. As a server it hosts **apps**: small web applications made
of HTML, JavaScript and, optionally, server-side JavaScript. Each app runs
against a **store**, a SQLite file that holds its data, its files and a log of
every change.

The everyday loop looks like this:

1. You start the service with `slop serve`.
2. You sign in once in the browser.
3. You run `slop auth login`, which gives your coding agent a token.
4. The agent creates apps, pushes their files, imports data and **mounts**
   them at URLs on your sites. It uses the same commands you would, from the
   CLI, over HTTP, or by sending a JavaScript program to `slop eval`.

People who visit those sites fall into four **audiences**: guests (anyone
not signed in), members (signed in), subscribers (members with a standing
subscription, as in francois) and admins. The service tells every app who is visiting. A back office lets an
admin decide three things:

- who may open which store, and at what level;
- what each app may do for each audience;
- who may use the LLM, and how many tokens they have left.

The design is deliberately small:

- **Five nouns:** store, app, mount, person and grant.
- **One access check:** a single function, `can()`.
- **One list of operations:** a table of **verbs**, from which the CLI, the
  HTTP API and the `eval` scope are all generated.
- **One rule for model access:** a person either has LLM access or not, with
  a maximum token budget. There are no call counts, no instance quotas and no
  time windows.

slop v3 core is the cut-down successor of two things in this repository's
history:
- the slop-v3 design (`design/slop-v3-design.md`, imported from the
  31 October session), whose central idea it keeps;
- slop-computer v2, which runs in production today, and which it replaces.

Section 16 maps exactly what is reused from v2, francois, go-go-goja and the
slop-v3 lab.

## 2. Problem and scope

### 2.1 Requirements

These are the requirements this design answers. Later sections refer to them
by number.

1. **R1. A service you can start:** one binary and one data directory.
2. **R2. Sign in, then a token for a coding agent.** The agent acts as you,
   with the scopes you give it.
3. **R3. Agents make apps of every kind and mount them on sites:** static
   pages, interactive pages, apps with server code, APIs, and apps that make
   apps.
4. **R4. A CLI that does everything,** including importing data and
   everything the agent can do through `eval()`.
5. **R5. Audiences:** admins, guests, signed-in members, and subscribers as
   in francois. Access rights depend on them.
6. **R6. Trivial LLM control:** access or no access, plus a maximum token
   budget. Nothing else.
7. **R7. A manageable back office** to control all of the above.
8. **R8. Apps learn who is visiting.**
9. **R9. Per-app control:** which app may use which capability, by audience.
10. **R10. Streamlined:** every mechanism must earn its place.

### 2.2 Out of scope for the core

These are designed to be addable later. Nothing in the core may block them,
but none of them is built now:

- process or VM isolation for untrusted app code (only admins push code; see
  decision D9);
- other apps opening a store they don't own ("openers"), and a stock "site"
  app with configurable routes (section 5.6 sketches both);
- structured SQL queries from pages (pages use documents and actor actions);
- reverting an agent's work as a step;
- an MCP door (an `eval` tool is the natural first MCP tool);
- billing beyond projecting Stripe subscription state (as francois does);
- replication and multiple server processes.

### 2.3 Where the ideas come from

You don't need to know these systems to read on. They explain why things look
the way they do:

- **slop-computer v2** (`go-go-golems/slop-computer`): today's production
  system. Pages are versioned file trees, a route table maps URLs to page
  versions, and `pkg/rt` implements the claude.ai artifact runtime contract
  (`window.claude.use(...)`) on the server. SLOP-011 added live sites: apps
  running on site hosts with sign-in, guests, grants and share links.
- **The slop-v3 design** (`design/slop-v3-design.md` in this repo): replaces
  v2's many nouns with one, the store, and adds server code as a per-store
  actor. It also designs much more than we need now; section 17 lists what we
  cut and why.
- **francois** (`go-go-golems/francois`): v1. We take its subscription logic
  from `pkg/catalog/billing/policy.go`.
- **go-go-host** (`go-go-golems/go-go-host`): hosts goja sites with one SQLite
  file per site, and swaps a new version in only after its smoke check passes.
- **go-go-goja** (`go-go-golems/go-go-goja`): the goja runtime factory and the
  single-owner pattern we use to run actors.

## 3. Orientation: the system in five minutes

### 3.1 The central idea

Think of each store as a small, private computer for one thing: a guestbook, a
team's board, a blog, one person's Blocks workspace. The store holds that
thing's data and its history in one SQLite file. If the thing needs server
code, one instance of that code (its **actor**) runs next to the file and
handles one event at a time. Cloudflare calls this model Durable Objects;
slop's version uses JavaScript for code and SQLite for state.

An **app** is just a store whose files include `app.json`. Its code runs
against any store that names it as its app. A **mount** gives a store a URL. A
**grant** says who may open a store and at what level. Everything else either
describes one of these or decides what someone may do with them.

### 3.2 Vocabulary

The terms below are used throughout. Each means one thing everywhere: in the
code, the CLI, the UI and this document.

- **Store.** The unit of state. A SQLite file, `stores/<id>/store.db`,
  holding documents, files, the app's own SQL tables and a log of changes.
  The id is a slug such as `guestbook-main`.
- **Document.** A JSON object at a path such as `entries/e1`, with the
  semantics of the claude.ai artifact contract (the `db` capability).
- **File.** Bytes at a path. Files live in one of two zones:
  - the **tree** zone: content and code, versioned by snapshots;
  - the **assets** zone: uploads made while using an app.

  The bytes themselves are kept once, by hash, in a shared blob directory.
- **Snapshot, ref.** A snapshot freezes the tree zone; snapshots are numbered
  `1, 2, 3…`. A ref is a movable name for a snapshot. `main` is the ref that
  stores running the app follow.
- **App.** A store whose tree contains `app.json`. Its files are its code:
  pages, static assets, and optionally `actor.js`.
- **App store, data store.** An app store holds an app's code. A data store
  holds data and names an app to run. An app store runs its own code, so a
  simple site can be a single store.
- **Actor.** The server half of an app: `actor.js`, running in a goja
  JavaScript runtime, with one instance per store.
- **Turn.** One piece of work against a store: an actor handling one event,
  one page write, or one verb. A turn is one SQLite transaction.
- **Commit, rev.** What a turn writes, atomically. Each commit gets the
  store's next revision number (rev) and an entry in the store's log.
- **Log.** The store's list of commits and the changes in them. It is also the
  event system: reactors, live pages and agents all follow it.
- **Mount.** A host plus a path pattern, pointing at a store, for example
  `apps.example.com /guestbook → guestbook-main`.
- **Host.** A domain the server answers. There are four kinds:
  - **main:** the back office, sign-in and the API;
  - **live:** apps for visitors, with sign-in sessions;
  - **static:** files only, with no sessions;
  - **sandbox:** one origin per store, where app pages actually run.
- **View.** One open page of an app in one browser tab, for one person. It
  has a secret, a stream of events, and an RPC endpoint.
- **Person.** Someone who acts:
  - a **user**, signed in through OIDC, with an id `usr_…`;
  - a **guest**, anyone who is not signed in. On a live host, a guest who
    needs an identity (to write, or to keep private data) is remembered by a
    cookie and gets an id `vis_…`; otherwise a guest has no id.

  Agents act as the user who made their token.
- **Role.** A user's standing on the platform: `pending`, `member`, `admin`
  or `disabled`.
- **Audience.** What kind of visitor someone is right now: `guest`,
  `member`, `subscriber` or `admin`. It is computed from the role,
  any subscription and the session; it is never stored.
- **Level.** What someone may do on one store: `view` < `interact` < `admin`
  < `owner`.
- **Grant.** Gives a level on a store to a subject. A subject is a person or
  an audience, such as `@member`.
- **Capability.** A named API an app uses: `db`, `user`, `room`, `assets`,
  `sample` (the LLM), `fetch`, `secrets`, `platform`. Pages get them from
  `claude.use(name)`, actors from `use(name)`.
- **Policy.** The admin's matrix of app × capability × audience. It decides,
  for example, whether the guestbook may use `sample` for subscribers.
- **LLM access.** Per person (or per audience by default): allowed or not,
  plus a token budget, and a ledger of tokens used.
- **Verb.** One operation of the platform, such as `docs.set`, `mount.set` or
  `grant.set`. One table of verbs generates the CLI, the HTTP API and the
  `eval` scope.
- **Door.** A way into the verbs: the CLI, HTTP, or `eval`.
- **Token.** A bearer credential for an agent or script. It acts as its user,
  limited to its scopes (`read`, `write`, `admin`).

### 3.3 The parts and how they connect

```text
   browsers (visitors, admins)                  coding agents
        |            |             |                  |
        v            v             v                  v
  +-----------+ +-----------+ +-----------+    slop CLI, HTTP,
  | main host | | live host | |static host|    slop eval
  | back      | | shell,    | | files,    |          |
  | office,   | | sessions, | | no        |          |
  | sign-in,  | | guests    | | sessions  |          |
  | API       | |           | |           |          |
  +-----+-----+ +-----+-----+ +-----+-----+          |
        |             |             |                |
        +------+------+------+------+----------------+
               |             |
        +------v------+ +----v--------------------+
        | doors:      | | serve:                  |
        | verb table  | | mounts, resolve, views, |
        | CLI, HTTP,  | | page runtime, sandbox   |
        | eval        | | origins                 |
        +------+------+ +----+--------------------+
               |             |
        +------v-------------v--------------------+
        | kernel                                  |
        |  access: people, audiences, grants,     |
        |          can(), app policy, LLM budget  |
        |  turns:  one writer per store           |
        |  actors: goja runtime per active store  |
        |  log:    commits, reactors, alarms      |
        +------+--------------+--------------+----+
               |              |              |
        +------v-----+ +------v------+ +-----v--------+
        | system.db  | | stores/<id>/| | blobs/       |
        | people,    | | store.db    | | sha256/..    |
        | grants,    | | docs, files,| | file bytes   |
        | mounts,    | | app tables, | | by hash      |
        | policy,llm | | log         | |              |
        +------------+ +-------------+ +--------------+

  App pages run in iframes on sandbox origins, s<label>.sbx.example.com,
  one origin per store and app, talking to the kernel through their view.
```

Reading the diagram from the outside in:

- **Hosts** are the server's front doors. They are separated by role, because
  a sign-in session must never share an origin with arbitrary static pages
  (section 11.1 explains the incident that taught us this).
- **Doors** accept work from people and agents and turn it into verb calls.
- **Serve** maps URLs to stores through mounts, serves files, and opens views
  for live apps.
- **The kernel** owns all state changes. It checks access, runs each store's
  turns one at a time, runs actors, and fans each commit out to the log's
  followers.
- **Storage** is plain files:
  - `system.db` holds identity and configuration;
  - one `store.db` per store holds the content;
  - a blob directory holds file bytes.

### 3.4 One example from start to finish: a guestbook

This walk-through touches every part once. The commands are the real CLI the
guide specifies (Appendix G).

**Start the service and sign in.**

```sh
slop serve --config slop.yaml
# The config names the main host (slop.example.com), a live host
# (apps.example.com), a static host (site.example.com), the sandbox domain
# (sbx.example.com), the OIDC issuer, and --admin-email you@example.com.
# Open https://slop.example.com and sign in: that email becomes an admin.

slop auth login --server https://slop.example.com --name "claude on laptop"
# Opens a browser page that asks you to approve the token's scopes. The token
# is saved in ~/.config/slop/credentials.json and the agent uses it from then on.
```

**Write the app.** An app is a folder:

```text
guestbook/
  app.json       the manifest
  index.html     the page
  style.css      a static file
  actor.js       server code (optional)
```

```json
{
  "title": "Guestbook",
  "page": "index.html",
  "actor": "actor.js",
  "capabilities": {
    "db":     { "rules": [{ "path": "entries", "read": "view", "write": "admin" }] },
    "user":   {},
    "sample": {}
  }
}
```

The page reads entries as documents and signs through an actor action, so the
actor can validate input:

```html
<link rel="stylesheet" href="style.css">
<ul id="entries"></ul>
<form id="f"><input name="text"><button>Sign</button></form>
<script>
(async () => {
  const db = await claude.use('db'), user = await claude.use('user');
  const slop = await claude.use('slop');
  const me = await user.me();       // { id, name, audience, level, ... }
  db.collection('entries').orderBy('at', 'desc').limit(50)
    .onSnapshot(s => render(s.docs.map(d => d.data())));
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    await slop.actions.sign({ text: e.target.text.value });
  };
  if (me.audience === 'subscriber') { /* show "AI reply" toggle */ }
})();
</script>
```

```js
// actor.js: one instance per store, one event at a time.
const db = use('db'), sample = use('sample');   // null only if never allowed (8.3)

defineActor({
  actions: {
    sign(ctx, { text }) {
      ctx.need('interact');                     // guests may sign (see grants)
      text = String(text || '').trim().slice(0, 500);
      if (!text) ctx.fail('invalid_argument', 'empty entry');
      const id = 'e' + ctx.now.toString(36);
      db.doc('entries/' + id).set({ text, by: ctx.visitor.id, at: ctx.now });
      return { id };
    },
    async reply(ctx, { id }) {                  // an await ends the turn
      if (!sample || !sample.allowed()) ctx.fail('permission_denied', 'no LLM for you');
      const e = db.doc('entries/' + id).get().data();
      const r = await sample('Reply kindly, in one line: ' + e.text);
      db.doc('entries/' + id).update({ reply: r.text });   // a new turn
    },
  },
});
```

**Push, create a store, grant, mount, set policy.**

```sh
slop push ./guestbook -m "first version"          # app store "guestbook", snapshot 1
slop store new guestbook-main --app guestbook     # a data store running it
slop grant set guestbook-main @guest interact     # anyone may read and sign
slop mount set apps.example.com /guestbook guestbook-main
slop policy set guestbook sample @subscriber on   # AI replies for subscribers
slop llm set @subscriber on --budget 2000000      # each subscriber: 2M tokens
```

The agent can do the same in one `eval` program, which runs on the server as
the token's user:

```js
// slop eval -f setup.js
slop.store.new({ id: 'guestbook-main', app: 'guestbook' });
slop.grant.set({ store: 'guestbook-main', subject: '@guest', level: 'interact' });
slop.mount.set({ host: 'apps.example.com', path: '/guestbook',
                 store: 'guestbook-main' });
return slop.mount.ls({ host: 'apps.example.com' });
```

**A visitor arrives** at `https://apps.example.com/guestbook`:

1. The live host finds the mount, and through it the store `guestbook-main`
   and its app `guestbook` at snapshot 1.
2. The visitor has no cookie. The store grants `@guest interact`, so the
   server creates a guest (`vis_…`), sets the site cookie and serves the
   **shell**, a small page that hosts the app.
3. The shell asks for a view: `POST /_site/views`. The kernel checks the
   visitor's level (`interact`) and returns:
   - a view id and a secret;
   - the store's sandbox origin, `https://s4f…e1.sbx.example.com/v/1/`;
   - the capabilities this view may use.
4. The shell loads the app in an iframe on that origin and hands it the secret
   by `postMessage`. The page's runtime, `window.claude`, opens one event
   stream and one RPC endpoint with that secret.
5. `user.me()` returns `audience: "guest"`. `claude.use('sample')` returns
   `null`, because the policy allows `sample` only for subscribers.
6. Signing calls the actor's `sign` action. That runs one turn, which writes
   one document as one commit. Every open view of the store receives the new
   entry through its stream.

The rest of this guide explains each of these steps in detail.

## 4. The store

A store is one SQLite file that holds everything about one durable thing.
Keeping it in one file means a store can be copied, exported, backed up,
size-limited and deleted as a unit. Who may use a store, where it is mounted,
and what its app may do live outside it, in `system.db`, so access can be
decided without opening every store.

### 4.1 On disk

```text
<data>/
  system.db                    people, sessions, tokens, stores registry,
                               grants, links, mounts, policy, LLM access,
                               subscriptions, schedules, system log
  stores/<id>/store.db         one file per store (WAL mode)
  blobs/<ab>/<sha256>          file bytes by content hash, shared by all stores
```

- **Store ids** are slugs: `[a-z0-9][a-z0-9-]{0,62}`. A store made without a
  name gets `s-` plus eight base32 characters. The id is the address
  everywhere: CLI arguments, mounts, `stores.open(id)`.
- **The blob directory** is v2's `pkg/blobs`, which v2 adapted from francois:
  files are kept at `<root>/blobs/<first two hex digits>/<sha256>`. `system.db`
  keeps a reference count per blob, and blobs at zero for seven days are
  deleted. No scan of store files is needed.

### 4.2 Inside `store.db`

Every table whose name starts with `_` belongs to the kernel. App code may
read some of them through views and may write none. Every other table belongs
to the app, created by its migrations. The full DDL is in Appendix B; the
tables are:

- `_meta`: the store's settings as key/value pairs: `id`, `type`, `app`,
  `app_ref` (default `main`), `app_version` (the snapshot running now),
  `last_good`, `owner`, `epoch` and `schema_version`.
- `_docs`: one row per document: `path`, `coll`, `body` (JSON, or NULL for a
  deleted document), `version`, `rev`, `size`, `by`, `at`.
- `_files`: one row per file: `zone` (`tree` or `assets`), `path`, `sha256`,
  `size`, `type`, `rev`, `by`, `at`.
- `_log`: one row per commit: `rev`, `at`, `principal`, `via`, `app`,
  `summary`.
- `_changes`: one row per changed thing in a commit: `rev`, `seq`, `kind`
  (`doc`, `file`, `table`, `ref`, `snapshot`, `schema`), `key`, `op`,
  `version`.
- `_snapshots`, `_snapshot_files`: frozen trees, and the files in each.
- `_refs`: named pointers to snapshots.
- `_migrations`: the app migrations applied to this store.
- `_cursors`: where each reactor has read the log up to.
- `_alarms`: timed wake-ups for the actor.

### 4.3 Documents

Documents keep the claude.ai contract's semantics exactly, because the apps we
host (Blocks, Claude Computer, Pinup and others) are written against it. v2
already implements these semantics in `pkg/rt`, and we copy that package (see
section 16):

- **Paths alternate** between collection and document: `entries/e1` is a
  document; `entries` is a collection. There are at most 16 segments, see
  `pkg/rt/paths.go`.
- **Bodies are JSON objects,** at most 256 KiB, see `pkg/rt/body.go` and
  `pkg/rt/limits.go`.
- **Operations:** `set`, `update` (a deep merge), `delete`, and queries with
  `where` filters, `orderBy` and `limit` (`pkg/rt/query.go`).
- **Rules:** each path pattern needs a level to read and a level to write, and
  `{self}` stands for the reader's own id (`pkg/rt/rules.go`). The path
  `data/users/<id>/…` is private to that person by default.
- **Live updates send differences:** a view that mirrors a document receives a
  structural patch rather than the whole body (`pkg/rt/diff.go`).

What changes from v2 is the storage underneath. v2 evaluates queries in Go
over documents loaded from Postgres. v3 stores documents in `_docs` and
translates a query into SQL with `json_extract`, keeping the same filter
operators and ordering rules. Port `pkg/rt/query.go`'s semantics test by test.

### 4.4 Files and snapshots

- **The tree zone is the versioned content:** code, pages, Markdown, images
  that belong to the content. Writing tree files does not change what
  visitors see, because what they see is a snapshot.
- **A push** writes the tree zone and takes a snapshot `n` in one turn, then
  moves the ref `main` to `n`:
  1. `_snapshot_files` records the path → hash list;
  2. `_snapshots.tree` records the hash of that list in canonical order, so
     identical trees have identical hashes.
- **Refs:** `main` moves on every push unless the push names another ref.
  Moving a ref back is how you roll back: `slop ref move guestbook main 3`.
- **The assets zone** holds uploads made through the `assets` capability.
  Snapshots ignore it.

### 4.5 The log

Every change goes through a turn, and a turn that changes anything ends in one
commit with one new rev.

- **`_log` records who and through what:**
  - `principal` is a user, a guest, `store:<id>` or `system`;
  - `via` is `page`, `actor`, `reactor:<name>`, `alarm:<name>`, `cli`,
    `http` or `eval`, followed by the token id when an agent acted.
- **`_changes` records what changed.** Document changes carry the new
  `version`; file changes carry the hash. For app tables the kernel records
  one `table` change per table written (it learns which ones from the SQLite
  authorizer, section 4.6).
- **What makes a commit:** a change to documents, files, app tables, refs,
  snapshots or schema. Writes to `_cursors`, `_alarms` and `_migrations` ride
  along with a commit but never make one on their own.
- **Retention:** the newest 100,000 changes or 7 days, whichever comes first.
  A follower whose cursor is older than that gets `reset: true` and must
  reload.
- **Restores:** restoring a store from a backup increments `_meta.epoch`.
  Cursors carry `(epoch, rev)`, so after a restore they reset instead of
  silently skipping commits.

### 4.6 App tables and SQL

Every store is a real SQLite database, and three kinds of caller get three
strengths of SQL on it. The kernel installs an **authorizer** (a SQLite
callback that approves or denies each action while a statement is prepared) on
every connection, and sets the caller kind before preparing each statement.

| Caller | Reads | Writes | DDL |
|---|---|---|---|
| actor | app tables, `_docs`, `_files`, `_log` | app tables | no |
| migration | app tables | app tables | app names, FTS5 |
| admin (`sql.*` verbs) | everything | app tables, with `--write` | no |

Rules that apply to every caller:

- no `ATTACH`, no extensions and no `TEMP` objects;
- no writes to `_*` or `sqlite_*` tables;
- no `PRAGMA` except read-only introspection (`table_info`, `index_list` and
  similar);
- the writer connection sets `SQLITE_LIMIT_ATTACHED=0`.

`trusted_schema` stays at SQLite's default (on). Turning it off would forbid
`slop_principal()` in views, triggers and column defaults, because only
functions flagged `SQLITE_INNOCUOUS` may run from the schema then, and
mattn/go-sqlite3 cannot set that flag. The authorizer is the guard instead:
schema only enters a store through migrations, every statement in a view or
trigger body is authorized when the outer statement is prepared, and the
`slop_*` functions have no side effects. Store files are only ever opened by
the kernel; an imported SQLite export is copied table by table, never opened
as-is.

Pages never send SQL in the core: they read documents and call actor actions.
The slop-v3 lab already implements this policy in JavaScript; read
`lab/src/kernel/sqlite.js` before changing the Go version in
`pkg/store/sqlpolicy.go`.

Three SQL functions are bound to the acting person before each statement, so
views written in migrations can filter by who is asking:
- `slop_principal()` returns the acting person's id;
- `slop_level()` returns their level on the store;
- `slop_now()` returns the turn's time.

```sql
-- A migration: sql/001_entries.sql
CREATE TABLE notes(id INTEGER PRIMARY KEY, owner TEXT NOT NULL, text TEXT);
CREATE VIEW my_notes AS SELECT id, text FROM notes WHERE owner = slop_principal();
```

### 4.7 Limits

The core keeps only limits that protect the server. There are none on calls,
instances or durations of use.

| Limit | Default | Where enforced |
|---|---|---|
| store database size | 256 MiB | `PRAGMA max_page_count` |
| document body | 256 KiB | `pkg/rt` |
| file size | 50 MiB tree, 20 MiB assets | kernel |
| actor CPU per turn | 1 s | goja interrupt |
| SQL statement from admin verbs | 5 s | context deadline |
| `eval` program | 60 s | goja interrupt |

## 5. Apps

### 5.1 What makes a store an app

A store is an app when its tree contains `app.json`. Two arrangements cover
every case:

- **Self-running app.** A store that contains `app.json` and names no other
  app runs its own code on its own data. A static website, or a one-off tool,
  is one store.
- **App plus data stores.** An app store holds code. Data stores name it in
  `_meta.app`, and each runs the app's `main` snapshot (or a pinned snapshot)
  against its own data. Twenty guestbooks are one app and twenty data stores.

`_meta.app_version` records the snapshot a store runs now. It changes only
through **activation** (section 5.4), so a store always runs exactly one
version of exactly one app.

### 5.2 The manifest, `app.json`

The `capabilities` block keeps the claude.ai contract's shape, so a page
written for claude.ai runs here unchanged. Everything specific to slop sits
under `slop`. The full field list is in Appendix C.

```json
{
  "title": "Journal",
  "page": "index.html",
  "actor": "actor.js",
  "type": "journal.blog",
  "capabilities": {
    "db":     { "rules": [{ "path": "posts", "read": "view", "write": "admin" }] },
    "user":   {},
    "room":   { "topics": { "cursor": "interact" } },
    "assets": {},
    "sample": {}
  },
  "slop": {
    "reads":   { "catalog": { "type": "francois.catalog" } },
    "fetch":   ["https://api.github.com"],
    "secrets": ["GITHUB_TOKEN"],
    "platform": ["stores.create", "mounts.set"]
  }
}
```

- `page` and `actor` are both optional.
- `type` names the kind of store this app runs on. Stores created for the app
  get this type, and mounts can require a type (section 11.2).
- A capability the manifest does not declare is `null` in `use()`, as the
  contract requires.
- Declaring a capability is necessary but not sufficient: the admin's policy
  must also allow it for the visitor's audience (section 8).

### 5.3 Kinds of apps

All of these are the same mechanism with different files present:

| Kind | Files | Example |
|---|---|---|
| static site | `app.json`, HTML, CSS, images | a landing page, docs |
| page app | `index.html`, uses `claude.use()` | Blocks, Pinup, a game |
| app with server code | adds `actor.js`, maybe `sql/` | the journal, a tracker |
| API only | `actor.js` with `http` routes | a webhook receiver |
| app builder | uses the `platform` capability | an app that publishes apps |

### 5.4 Versions and activation

When a store's app has a new `main` snapshot, the store moves to it by
**activation**. Activation happens immediately for the app's own store when
you push, and for any other store the next time it wakes.

```text
activate(store, app, n):
  take a backup image of store.db          # VACUUM INTO, between turns
  BEGIN IMMEDIATE
    apply app@n's pending sql/*.sql migrations, in name order
    run actor.setup(ctx)  if actor.js exists
    run actor.smoke(ctx)  if defined
    _meta.app_version := n
  COMMIT                                   # on any error: ROLLBACK, stay on old
  swap the actor runtime to app@n          # build new, then retire old
  record the result in the system log      # visible in Activity
```

SQLite DDL is transactional, so migrations, setup and the smoke check succeed
or fail together. There are no down-migrations: rolling back means restoring
the image taken just before. go-go-host's
`internal/runtime/supervisor.go` follows the same build, check, then swap
order.

### 5.5 One owner app per store, and reading other stores

Each store has exactly one app (its owner). That app's migrations define the
store's tables, its actor is the only server code that runs there, and its
`db.rules` govern every view. This keeps schemas, versions and rules
unambiguous.

Apps often need to **read** other stores. A storefront reads a catalog; a
site reads blog posts. The core supports this through **read aliases**:

- The app declares an alias and the type it expects:
  `"slop": { "reads": { "catalog": { "type": "francois.catalog" } } }`.
- Each store that runs the app binds the alias to a real store:
  `slop bind set storefront-main catalog francois-catalog`. Bindings live in
  `system.db` (`bindings` table).
- Code opens the alias: `use('stores').open('catalog')` in an actor, or
  `(await claude.use('slop')).stores.open('catalog')` in a page. The result
  offers documents, files and (in actors) the log, read-only.

Who is checked:

- **For a page**, the visitor's own level on the target store. A public
  catalog is public because it grants `@guest view`, not because some public
  page happens to read it.
- **For an actor**, the principal is `store:<id>` of the reading store (here
  `store:storefront-main`). Grant that principal `view` on the catalog.

Why `store:<id>` and not `app:<id>`: if the grant went to the app, every store
running the app would inherit it. With per-person stores (one Blocks
workspace each), a workspace owner could then point their own actor at
someone else's store. That is a confused-deputy hole, and per-store
principals close it.

### 5.6 Deferred, but designed: openers and the site app

Two extensions are deliberately left out of the core. They fit without
changing anything above:

- **Openers.** An app whose manifest lists `"opens": ["blocks.workspace"]`
  could open views on stores of that type that it does not own. It would run
  pages only, with no actor and no migrations there. The owner app's
  `db.rules` would still apply, the opener's own policy would decide its
  capabilities, and its pages would run on their own origin
  (HMAC of store and app). Writes to app tables would go through the owner's
  actions.
- **A stock site app.** A platform-provided app whose routes are a document
  (`{"/journal/:slug": {"template": "post.html", "record": "posts:{slug}.md"}}`)
  and which reads content stores through read aliases. This is how v2's route
  features (`record`, `page_from`, data bindings) come back as configuration
  of one app rather than kernel features. Meanwhile, a static mount with a
  store parameter already covers v2's `page_from`: `/r/:store` with
  `type: francois.release`.

## 6. Actors, turns and events

### 6.1 `actor.js`

An actor is the code of one store's server half. Everything it does hangs off
one call, `defineActor({...})`:

```js
const sql = use('sql'), db = use('db'), room = use('room');

defineActor({
  setup(ctx) { /* once per new version, inside activation */ },
  smoke(ctx) { /* optional check, inside activation; throw to refuse */ },

  actions: {                       // called by pages and by `slop call`
    addTask(ctx, { title }) {
      ctx.need('interact');
      return sql.run('INSERT INTO tasks(title, owner, at) VALUES (?,?,?)',
                     title, ctx.visitor.id, ctx.now);
    },
  },

  http: {                          // HTTP on the store's mounts
    'GET /feed.json': { level: 'public',
      run: (ctx, req) => ({ json: sql.all('SELECT * FROM published') }) },
    'GET /members':   { audience: 'subscriber',
      run: (ctx, req) => ({ html: '<h1>Hello, subscriber</h1>' }) },
  },

  on: {                            // reactors: follow the log, exactly once
    'table:tasks'(ctx, commit) { room.emit('changed', { rev: commit.rev }); },
  },

  every: {                         // alarms: at least once
    nightly: { cron: '0 3 * * *', run(ctx) { /* clean up */ } },
  },
});
```

`ctx` carries what differs per event:

- `visitor`: `{ id, name, audience, level, guest, subscribed }`. For alarms
  and reactors this is the store itself.
- `store`: `{ id, type }`; `app`: `{ id, version }`.
- `now`: the turn's start time. `Date.now()` returns the same value.
- `rev`: the store's rev when the turn began.
- `need(level)` and `needAudience(audience)`, which throw
  `permission_denied`.
- `fail(code, message)`, which throws an error with that code.
- `log(...)`, which writes to the actor's log, shown in the back office.

An actor's turns run with full rights on its own store: document rules do not
apply to the actor's own writes. The actor is the app's trusted backend, so it
checks the visitor itself with `ctx.need(...)`. Pages, on the other hand, are
always held to the rules.

### 6.2 Turns are transactions

These rules give actors the same guarantees Durable Objects give, made
concrete with SQLite:

1. **One event at a time.** Each store has one inbox: action calls, HTTP
   requests, page writes, reactor deliveries and alarms. Nothing else runs on
   that store while a turn runs.
2. **A turn is one transaction:** `BEGIN IMMEDIATE`, call the handler, run the
   promise jobs it queued, then `COMMIT`. The commit gets one rev.
3. **An `await` on real I/O ends the turn.** Real I/O means `sample`, `fetch`,
   another store's action, or `time.sleep`. The writes before the await
   commit. The continuation runs later as a new turn, with a new `ctx.now`.
4. **A throw rolls back that turn only.** Earlier turns of the same handler
   stay committed.
5. **Output waits for the commit.** Responses, room messages and log fan-out
   are released only after the commit succeeds.
6. **Reactors are synchronous.** A reactor's writes and its cursor move commit
   in the same turn. That is what makes reactors exactly once. A reactor that
   needs I/O writes a task row and sets an alarm.
7. **Alarms may be async.** An alarm is marked running until its last turn
   finishes. A crash in between makes it fire again, so alarm handlers must be
   idempotent.

Rule 3 is the one that surprises people. Teach it with the journal example
from the lab (`lab/src/seeds/journal/actor.js.txt`, `slowPublish`): the title
change commits first, and the publish commits a minute later in a second turn.

### 6.3 Running actors on goja

Each active store has one goja runtime, built from a factory per app version
and owned by one goroutine:

```go
// pkg/actor/factory.go: one factory per (app, version)
f, err := engine.NewRuntimeFactoryBuilder().
    WithModules(slopModules(manifest)...).     // the use(name) catalog
    WithRuntimeInitializers(defineActorInit). // installs defineActor, use, require
    Build()
rt, err := f.NewRuntime()                      // *engine.Runtime{VM, Loop, Owner}
```

These are go-go-goja's types: `engine.NewRuntimeFactoryBuilder` and
`RuntimeFactory.NewRuntime` in `pkg/engine/factory.go`, and the `Runtime`
struct with its `VM`, `Loop` and `Owner` fields in `pkg/engine/runtime.go`.
`runtimeowner.RuntimeOwner.Call(ctx, op, fn)` (`pkg/runtimeowner`) runs a
function on the runtime's own goroutine. Every turn goes through it.

The turn loop, one goroutine per active store:

```text
loop:
  ev := inbox.next()                                # blocks; idle 60 s -> hibernate
  tx := writer.BeginImmediate()
  kernel.setTurn(store, ev.principal, now())        # binds slop_principal() etc.
  result, err := owner.Call(ctx, ev.kind, func(vm) {
      v := handler(ev)(ctxObject, ev.args)          # may return a promise
      return v                                      # goja runs queued jobs here
  })
  if err != nil or failFault():
      tx.Rollback(); reply(ev, err); continue
  changes := kernel.collectChanges()                # docs, files, tables
  if changes non-empty: rev := writeLog(tx, ev, changes)
  tx.Commit()
  release(ev.outputs)                               # replies, room, fan-out
  if result is a pending promise:                   # awaiting real I/O
      park(ev, promise)                             # not finished, not failed
```

**How an `await` becomes a new turn.** A host operation such as `sample()`
returns a goja promise and starts its work in a separate goroutine. When the
work finishes, it does not touch the runtime directly. It posts a
**continuation event** to the store's inbox. That event's turn resolves the
promise inside `owner.Call`, and goja then runs the JavaScript after the
`await`, inside the new transaction. go-go-goja's `runtimebridge` package has
the helpers for posting work back to the owner.

goja runs pending promise jobs when the outermost call from Go returns. That
gives rule 2 for free: awaiting a promise that is already resolved (such as
`db` reads inside the actor) stays in the same turn.

### 6.4 The log is the event system

There is no separate message bus. A commit and the events describing it land
in the same transaction, so nothing can be lost between them. Followers read
the log:

| Follower | How it follows | Cursor kept in | Delivery |
|---|---|---|---|
| a view (page) | its document subscriptions | the page (resumes with `after`) | at least once, by rev |
| a reactor | the `on` selectors | `_cursors`, in the reactor's turn | exactly once |
| an agent | `slop log watch` | the caller | at least once |

One selector grammar serves `on`, `log.watch` and `slop log watch`:
- `doc:<glob>` and `file:<glob>`;
- `table:<name>`;
- `ref:<name>`, `snapshot` and `schema`;
- `*` for everything.

A prefix `store:<id> ` reads another store's log, by grant (section 5.5).

**Rooms** are the exception: room messages and presence are live only and
never stored. That is the contract's `room` capability, and v2's
implementation carries over.

### 6.5 Alarms and the scheduler

- **Where alarms come from:** `every` declares recurring alarms, and
  `use('alarm').at(t, name, data)` sets one-off ones. Both live in the store's
  `_alarms` table.
- **Waking only what is due:** each store's next alarm time is mirrored into
  `system.db` `schedules(store, next_at)`. The scheduler reads that one table
  and wakes only the stores that are due.
- **After downtime:** an alarm missed while the server was down runs once on
  start, with `ctx.event.late = true`, not once per missed period.

### 6.6 Actor lifecycle

| State | Meaning | Leaves when |
|---|---|---|
| cold | no runtime in memory | an event or alarm arrives |
| active | runtime built, handling its inbox | 60 s without events |
| broken | 3 crashes in 1 minute, or activation failed | a new version, or an admin restart |

A crashed turn (a panic in Go or an interrupt in goja) rolls back. An action
waiting on an await that is lost in a crash fails with `actor_error: lost`.

### 6.7 What actors can `use()`

| Name | What it gives | Controlled by |
|---|---|---|
| `sql` | synchronous SQL on app tables | always |
| `db` | documents, same API as pages | always |
| `files` | read and write the store's files, snapshot | always |
| `room` | emit to and see the store's room | always |
| `alarm`, `time`, `log` | wake-ups, `sleep`, the log | always |
| `stores` | read aliased stores; call their actions | grants to `store:<id>` |
| `sample` | the LLM | policy and LLM access (section 9) |
| `fetch` | HTTP to the origins listed in `app.json` | policy |
| `secrets` | values an admin set for this app | policy |
| `platform` | create stores, set mounts and grants | policy |

## 7. People, audiences and access

Every access decision answers one question: may this person do this operation
on this store, through this app? Four inputs answer it:

- the person's **audience**: what kind of visitor they are;
- their **level** on the store, from grants;
- the **rule** the store's app sets for the operation;
- the app's **policy** for the capability involved, for that audience.

This section covers the first three; section 8 covers policy.

### 7.1 People and other principals

A **principal** is anything that can act. The kernel knows six kinds:

| Kind | Id | Comes from |
|---|---|---|
| user | `usr_…` | OIDC sign-in on the main host |
| guest | `vis_…` | a cookie set on a live host, on a public store |
| token | `tok_…` | `slop auth login`; acts as its user, within its scopes |
| link | `lnk_…` | a share link; opening it grants the opener a level |
| store | `store:<id>` | an actor acting in its store's own name |
| system | `system` | the kernel itself: migrations, activation, sweeps |

More detail on each:

- **Users** are kept in `system.db` `people`, with a role (section 7.2).
- **Guests** are created only when needed: on a live host, when the store
  would give a guest some level (a grant to `@guest`, or a share link in
  the URL). Before that, and on static hosts, a visitor who is not signed in
  is still a guest, just one without an id.
  - One address may create at most 30 guests an hour. This protects the
    server; it is not a usage quota.
  - Guests unseen for 90 days are deleted, with their grants and private
    documents.
  - When a guest signs in, the site asks whether to keep what they did as a
    guest. Nothing moves without a yes. This is SLOP-011's claim flow.
- **Tokens** never appear as the actor in documents or in `slop_principal()`.
  Those show the token's user, and the log's `via` names the token.

### 7.2 Roles

A user's role is their standing on the platform:

- `pending`: signed in, but not let in. The service treats them like a
  guest.
- `member`: let in. This is the "signed-in" audience.
- `admin`: runs the platform. Admins are `admin` level on every store and
  the only people who can push app code (decision D9).
- `disabled`: may do nothing.

The `signup` setting decides what a first sign-in gives: `open` (the default)
makes new users members; `approval` keeps them pending until an admin lets
them in. `--admin-email` names the first admin.

### 7.3 Audiences

An audience is computed for every request and every turn; it is never stored.
The four audiences form a ladder, where each includes the powers of the ones
below it:

```text
   guest  <  member  <  subscriber  <  admin

   guest       anyone not signed in (with a guest cookie or not), or a
               pending user
   member      a signed-in user who was let in
   subscriber  a member with standing access (subscription or comp)
   admin       an admin
   (disabled accounts match no audience and may do nothing)
```

```text
audienceOf(p, now):
  if p is nil:                       return guest      # no id: read-only
  if p.kind == guest:                return guest
  switch p.role:
    case disabled:                   return none
    case pending:                    return guest
    case admin:                      return admin
    case member:
      if subscribed(p, now):         return subscriber
      return member
```

Audiences appear in three places:
- as **grant subjects** (`@member`, section 7.5);
- as **policy columns** (section 8);
- as **LLM defaults** (section 9).

Apps also see them, through `user.me().audience` (section 10).

### 7.4 Subscriptions, as in francois

"Subscriber" means a member with standing access. As in francois, standing
access comes from two sources:

- **Complimentary access (comps):** an admin grants a person access until a
  date: `slop sub grant usr_02… --until 2027-06-30 --note "beta tester"`.
- **Stripe subscriptions:** a member subscribes through Stripe Checkout from
  the main host's subscribe page. Stripe's webhooks keep a local projection
  of the subscription current, and the Customer Portal lets the member change
  or cancel it.

Both are in the core. The Stripe integration is copied from francois's
`pkg/catalog/payments`:

- `gateway.go`: the `Gateway` interface over `stripe-go/v86`
  (`CreateCustomer`, `CreateCheckout`, `RetrieveCheckout`, `ExpireCheckout`,
  `CreatePortal`, `SubscriptionCustomer`, …). Tests use a fake gateway.
- `service.go`: `Service`, with:
  - `Checkout`;
  - `Portal`;
  - `Refresh`, called when the browser comes back from Checkout;
  - `Ingest`, which verifies a webhook's signature and stores the event;
  - `Run`, a worker that leases pending events, fetches the customer's
    current state from Stripe and projects it;
  - `reconcile`.

  Webhooks are treated as requests to refresh, never as the truth.
- `pkg/catalog/store/billing.go` and the migrations
  `002_billing_usage.sql` and `007_checkout_price.sql`: the projection's
  storage, ported from Postgres to `system.db` (Appendix A).

```text
 member              main host                              Stripe
   | billing.checkout {price}                                  |
   | ---------------> ensureCustomer, checkout_attempts row    |
   |                  CreateCheckout -------------------------> |
   | <--------------- redirect to the Checkout URL             |
   | pays ----------------------------------------------------> |
   |                  <-------- POST /webhooks/stripe (signed)  |
   |                  Ingest: verify, store event (pending)     |
   |                  Run: lease it, retrieve the customer,     |
   |                       project stripe_subscriptions         |
   |                  re-check the member: now a subscriber     |
   | back on /subscribe?session=… -> Refresh (beats the webhook)|
```

```yaml
# slop.yaml: without this block, only comps exist and the
# subscribe page says how to ask an admin
stripe:
  secret_key_file: /run/secrets/slop/stripe-secret-key
  webhook_secret_file: /run/secrets/slop/stripe-webhook-secret
  prices: [price_1Q…]      # accepted recurring prices: the subscriber tier
  trials: false
```

The decision itself is francois's pure function, copied unchanged:
`billing.Policy.Access(account, subs, comps, now) Decision` from
`francois/pkg/catalog/billing/policy.go`, with its table tests
(`policy_test.go`). It returns `Allowed`, a reason (`subscriber`,
`complimentary`, `payment_past_due`, `subscription_expired`, …) and `Until`.
In slop:

```text
subscribed(p, now):
  subs  := [toBilling(r) for r in stripe_subscriptions where person = p.id]
  comps := [{Until: c.until, Revoked: c.revoked_at is not NULL}
            for c in comps where person = p.id]
  pol   := billing.Policy{AcceptedPrices: cfg.Stripe.Prices,
                          TrialAllowed: cfg.Stripe.Trials}
  d     := pol.Access(billing.Account{Disabled: p.role == 'disabled'},
                      subs, comps, now)
  return d.Allowed
```

We deliberately do not copy:
- francois's plans and daily token allowances (`model_allowance_periods`);
- members-per-instance limits and early-access windows;
- its one-off support payments (`Support`, `SupportEnterprise`, `FundYear`,
  `year_payment.go`). In slop, being a
subscriber is only an audience. What subscribers get is decided by grants,
policy and LLM access like everything else.

Audiences change over time: a comp expires, an admin changes a role, a
subscription lapses. When that happens, open views must notice. The kernel
re-checks a person's views whenever their role, comps or Stripe projection
change, and schedules a re-check at the earliest `until` among their comps
and the `access_until` of their subscriptions. A view whose level changes is closed and reopened at the new
level, and a view that loses access entirely is told it was revoked. That is
SLOP-011's `reviewViews` (`slop-computer/pkg/server/access.go`).

### 7.5 Levels and grants

Levels are the contract's: `view` < `interact` < `admin` < `owner`.

- A store's creator is its `owner`.
- Admins are `admin` on every store (and `owner` of what they created).
- Everyone else gets the highest level their grants give, after a cap that
  depends on their audience.

**Grant subjects:**

| Subject | Matches |
|---|---|
| `usr_…`, `vis_…` | that person |
| `store:<id>` | that store's actor (cross-store reads and calls) |
| `@guest` | everyone: visitors who are not signed in, and all signed-in people |
| `@member` | members, subscribers and admins |
| `@subscriber` | subscribers and admins |

**Caps by audience:** guests at most `interact`; members and subscribers at
most `admin`; admins up to `owner`. A guest without an id can only read:
every write records who made it, so on a live host the server gives the
visitor a guest id first (section 7.1).

```text
levelOf(p, aud, store):
  if aud == none:                         return none
  if store.owner == p.id:                 base := owner
  else if aud == admin:                   base := admin
  else:
    base := max(level of g for g in grants(store) if matches(g.subject, p, aud))
  return min(base, cap(aud))

matches(subject, p, aud):
  subject == p.id
  or (subject == '@guest'      and aud >= guest)
  or (subject == '@member'     and aud >= member)
  or (subject == '@subscriber' and aud >= subscriber)
```

A grant can come from a share link (`via = lnk_…`). A person can hold several
grants on one store, and the highest one counts. Revoking a link deletes only
the grants it gave.

### 7.6 Rules

Rules come from the store's app. They say which level each operation needs:

| Operation | Where the rule comes from | Default |
|---|---|---|
| read or write a document | `capabilities.db.rules`, with `{self}` | read `view`, write `interact` |
| call an actor action | `ctx.need(level)` inside the action | none: the action decides |
| an HTTP route | `level` or `audience` on the route | `view` |
| a room topic | `capabilities.room.topics` | `admin` |
| read the tree files | none | `view` |
| push files, move refs | platform | `admin` |

A read that the rules hide returns `not_found`, not `permission_denied`, so
private paths look missing (contract behaviour).

### 7.7 Share links

A link is a secret URL, `…/guestbook?k=<token>`, that gives its opener a level
(`view` or `interact`), optionally until a date. Opening it writes a grant
whose `via` is the link id. A link never lowers a level someone already has.
The shell strips `k=` from the address bar after use and keeps it through
sign-in. This is SLOP-011's design; port it with its tests.

### 7.8 The check

There is one access function. Pages, actors, verbs, mounts and the SQL
functions all call it. It returns a decision with a **trace**, the list of
facts that decided it, so the back office can explain any denial.

```text
can(p, store, op, target) -> Decision{ok, code, trace}:
  if p.kind == system: return allow
  who  := p.user if p.kind == token else p
  aud  := audienceOf(who, now)
  lvl  := levelOf(who, aud, store)                  # 7.5
  if p.kind == token: lvl := min(lvl, scopeCap(p.scopes))
  need := rule(ownerApp(store), op, target, who)    # 7.6; {self} = who.id
  if lvl < need:
    return deny(hidden(op) ? not_found : permission_denied,
                trace: grants that matched, the cap, the rule)
  if c := capabilityOf(op); c is not always-on:
    app := appOfView or ownerApp(store)
    if c not declared in app.manifest:  return deny(permission_denied)
    if not policy(app, c, aud):         return deny(permission_denied)  # 8
  return allow(trace)
```

For example, the trace for a guest who tried to write a document that only
admins may write:

```text
✗ permission_denied
  audience guest (vis_2k7… has a guest cookie)
  grant @guest interact on guestbook-main (direct)
  cap guest <= interact
  rule entries/*: write needs admin
  interact < admin
```

## 8. What apps may do: the policy matrix

Grants decide what a person may do to a store. The **policy** decides what an
app may do for a person: whether this app may call the LLM, upload files,
reach the network, read secrets, see email addresses, or manage the platform,
for each audience. It is one matrix per app, edited in the back office or with
`slop policy set`.

### 8.1 Which capabilities the policy controls

| Capability | What turning it on allows | Default |
|---|---|---|
| `assets` | uploading files into the store | on for member and up |
| `sample` | calling the LLM (section 9) | off |
| `user.email` | the app sees visitors' email addresses | off |
| `fetch` | actor HTTP requests to the origins in `app.json` | off |
| `secrets` | actor reads the app's secrets | off |
| `platform` | the app creates stores, sets mounts or grants | off |

Everything else is always on when the app declares it: `db`, `user` (ids,
names and audience), `room`, `downloads`, `files`, `alarm`, `time`, `log` and
`stores`. Data access is controlled by grants and rules, not by policy.

### 8.2 The matrix

```text
  app: guestbook          guest  member  subscriber  admin
  -----------------------------------------------------
  assets                     -      on       on        on
  sample                     -      -        on        on
  user.email                 -      -        -         -
  fetch                      -      -        -         -
```

- Rows appear only for capabilities the app declares. A capability the app
  does not declare cannot be turned on.
- A cell is on or off. There are no quotas in the matrix; LLM budgets belong
  to people (section 9).
- **Turns without a visitor** (alarms and reactors) use the store owner's
  audience. So an alarm on Ramon's workspace may use `fetch` exactly when
  Ramon could.
- Storage: `app_policy(app, capability, audience, allowed)` in `system.db`.
  An absent row means the default from the table in 8.1.

```text
policy(app, cap, aud):
  row := SELECT allowed FROM app_policy WHERE app=? AND capability=? AND audience=?
  return row.allowed if row exists else defaultPolicy(cap, aud)
```

### 8.3 How capabilities appear to code

- **In pages**, `claude.use(name)` resolves to `null` when the view's visitor
  may not use the capability, as the contract requires. Pages already handle
  `null`.
- **In actors**, `use(name)` runs once when the runtime starts, before any
  visitor exists. So in actors:
  - `use(name)` is `null` only when the app does not declare the capability,
    or the policy allows it for no audience at all;
  - each call is checked against the current turn's visitor, and fails with
    `permission_denied` when not allowed;
  - `sample.allowed()` (and likewise for `fetch`) reports whether the current
    visitor may use it, so code can branch without catching errors.

### Decision: policy is per app, not per app version

- **Context:** the slop-v3 design required an admin to approve each new
  version's sensitive capabilities. That is safe, but it means every push
  waits for an approval.
- **Options considered:**
  1. approve per version;
  2. a per-app matrix that survives pushes;
  3. no policy at all.
- **Decision:** a per-app matrix (option 2).
- **Rationale:** only admins and their tokens push code (D9), so a push is
  already an admin act. Re-approving every version adds friction without
  adding a check by a different person.
- **Consequences:** a push can start using a capability that is already on.
  Activity shows every push, with its author and token. If untrusted
  authors are ever allowed to push, add a "reset policy on push" flag per app.
- **Status:** proposed.

## 9. LLM access: on or off, and a token budget

The whole model fits in three questions, asked on every LLM call:

1. Does the app's policy allow `sample` for this visitor's audience?
2. Does the person paying for the call have LLM access?
3. Do they have budget left?

There is nothing else: no call counts, no rate windows, no per-instance
allowances, no time limits.

### 9.1 Who has access, and how much

```sql
CREATE TABLE llm_access (
  subject TEXT PRIMARY KEY,      -- 'usr_…' or 'vis_…' (a person), or '@member' etc.
  allowed INTEGER NOT NULL,      -- 0 or 1
  budget_tokens INTEGER,         -- per calendar month; NULL = no limit
  changed_by TEXT, changed_at INTEGER NOT NULL);

CREATE TABLE llm_usage (
  person TEXT NOT NULL,          -- 'usr_…' or 'vis_…'
  period TEXT NOT NULL,          -- '2026-11': the calendar month, UTC
  used_tokens INTEGER NOT NULL DEFAULT 0,   -- input + output, all models
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (person, period));
```

```text
llmFor(person):
  row := llm_access[person.id]                     # a personal setting wins
      or llm_access['@' + audienceOf(person)]      # else the audience default
  if row is nil or not row.allowed: return {allowed: false}
  used := llm_usage[person.id, period(now)].used_tokens or 0   # this month
  if row.budget_tokens is NULL: return {allowed: true, remaining: unlimited}
  return {allowed: true, budget: row.budget_tokens,
          remaining: max(0, row.budget_tokens - used)}
```

- Audience defaults are exact, not "at least". The `@subscriber` row applies
  to subscribers and the `@member` row to members, so you can give members
  none and subscribers two million tokens.
- **Seed values:** `@admin` allowed with no limit; everyone else off.
  Guests may be given access too (`slop llm set @guest on --budget 20000`),
  but only guests with an id can be charged, so on static hosts guests never
  call the LLM.
- **Budgets are monthly.** Usage is counted per calendar month (UTC), so a
  new month starts every budget from zero without any job running. Old
  months stay in the table as history. `slop llm reset usr_…` sets the
  current month's usage to 0 by hand.

### 9.2 Who pays for a call

- **A turn started by a person** (an action, a page call, an HTTP request
  with a session): that person.
- **A turn started by an alarm or a reactor:** the store's owner.
- **A guest without an id** (on a static host, or before a guest cookie is
  set) never calls the LLM: there is no one to charge.

### 9.3 The call

```text
sample(input, opts) during a turn with visitor v:
  app := the store's app;  aud := audienceOf(v)
  if 'sample' not declared or not policy(app, 'sample', aud):
      fail permission_denied "this app may not use the LLM for <aud>"
  payer := v if v is a person else store.owner
  llm := llmFor(payer)
  if not llm.allowed:       fail permission_denied "no LLM access"
  if llm.remaining <= 0:    fail quota_exceeded "token budget used up"
  -- the turn ends here; the call runs outside any transaction --
  resp := backend.Complete(ctx, input, opts, onDelta)    # streams deltas to pages
  INSERT INTO llm_usage (person, period, used_tokens, updated_at)
    VALUES (payer, period(now), resp.in + resp.out, now)
    ON CONFLICT DO UPDATE SET used_tokens = used_tokens + excluded.used_tokens
  return {text: resp.text, usage: {input: resp.in, output: resp.out}}
```

- A call that starts with budget left always completes, even if it ends over
  budget. The next call is refused. That keeps the rule trivial and never
  cuts an answer off halfway.
- `opts.max_tokens` and the model choice pass through to the backend
  unchanged.

### 9.4 The backend

- **Production:** reuse v2's Pi worker: `slop-computer/pkg/piworker` and
  `pkg/piworker/gepp` (geppetto with Pi's credentials), plus
  `pkg/credentials`. Today v2 lets only admins sample and keeps no budget
  (`slop-computer/pkg/server/rt_sample.go`). The budget ledger above is new
  work.
- **Interface:**

  ```go
  // pkg/llm/backend.go
  type Backend interface {
      Complete(ctx context.Context, req Request, onDelta func(text string)) (Response, error)
  }
  type Request struct { Messages []Message; Model string; MaxTokens int; Tools []Tool }
  type Response struct { Text, Model string; InputTokens, OutputTokens int }
  ```
- **Tests:** a fake backend that returns scripted text and token counts.

### 9.5 What apps see

`(await claude.use('sample')).limits()` and `user.me().llm` both return
`{ allowed, remaining }`. A page can then show "AI replies are for subscribers"
or "you have 12,400 tokens left" without guessing.

## 10. Telling apps who is visiting

R8 asks that apps know who is visiting, and R9 that what they may do depends
on it. Section 8 handled R9. For R8, the same visitor object appears in pages,
actors and HTTP routes:

```json
{
  "id": "usr_02657c47",
  "name": "Ramon",
  "audience": "subscriber",
  "guest": false,
  "subscribed": true,
  "level": "interact",
  "llm": { "allowed": true, "remaining": 1834000 }
}
```

- **Pages:** `(await claude.use('user')).me()`. The contract's `id()`,
  `profiles()`, `isOwner()`, `canEdit()` and `can(name)` keep their meanings.
  `email` appears only when the app declares the `user` capability with the
  `email` scope and the policy allows `user.email` for this audience.
- **Actors:** `ctx.visitor`. For alarms and reactors it describes the store
  itself (`{ id: "store:<id>", audience: <owner's audience> }`).
- **HTTP routes:** `{ audience: 'subscriber' }` on a route admits that
  audience and above. Below it, the route answers 403 with
  `{ "error": { "code": "audience_required", "audience": "subscriber" } }`.
- **Asking for more:** `(await claude.use('slop')).signIn()` asks the shell to
  start sign-in and return to the same page.
  `(await claude.use('slop')).subscribeUrl()` gives the main host's subscribe
  page. That page offers Stripe Checkout, and the Customer Portal to people
  who already subscribe. Without Stripe configured, it says how to ask an
  admin.

## 11. Serving

A mount maps a host and path to a store. That is all it does: which code runs
is the store's app at its running version, and who gets in is the store's
grants.

### 11.1 Hosts, and why each has one kind

```yaml
# slop.yaml (excerpt)
hosts:
  main:    slop.example.com        # back office, sign-in, /api/v1, /auth
  live:    [apps.example.com]      # apps for visitors: shell, sessions, guests
  static:  [site.example.com]      # files only: no cookies, no sessions
  sandbox: sbx.example.com         # s<label>.sbx.example.com, one per store+app
```

### Decision: a host is either live or static, never both

- **Context:** in v2, a site host could serve static pages and live apps
  together. Live apps need a sign-in session on the host. Any static page on
  the same origin could use that session, so v2 sandboxed the static pages
  (CSP `sandbox`). On 31 October that broke the public storefront. Sandboxed
  pages send no `Referer`, and v2 found a page's relative files (its CSS) by
  `Referer`, so every relative file returned 404. We undid the route and moved
  Blocks to its own host (slop-computer SLOP-011 diary, steps 10–11).
- **Options considered:**
  1. sandbox static pages on mixed hosts;
  2. path-scoped cookies;
  3. one kind per host.
- **Decision:** one kind per host, set in configuration. `mount set` refuses a
  live mount on a static host and the reverse.
- **Rationale:** path-scoped cookies do not stop same-origin scripts. The
  sandbox breaks ordinary pages. Separate hosts cost one DNS name each.
- **Consequences:** a deployment has at least four names (main, one live, one
  static, the sandbox wildcard). A wildcard DNS record covers them.
- **Status:** proposed.

### 11.2 Mounts

```sql
CREATE TABLE mounts (
  host TEXT NOT NULL,
  path TEXT NOT NULL,           -- '/guestbook', '/r/:store', '/docs/*'
  store TEXT,                   -- a fixed store, or NULL when store_param is set
  store_param TEXT,             -- the path parameter that names the store
  type TEXT,                    -- with store_param: the store type required
  create_app TEXT,              -- live hosts: offer to create a store of this app
  create_audience TEXT,         -- who may create: member, subscriber or admin
  changed_by TEXT, changed_at INTEGER NOT NULL,
  PRIMARY KEY (host, path));
```

- **Patterns:**
  - literal segments;
  - `:name`, which matches one segment;
  - a trailing `*`, which matches the rest of the path.

  A literal beats `:name`, which beats `*`; among equals, the longer pattern
  wins. v2's `pkg/routing` matcher is a good starting point.
- **Creating stores from the URL:** `/blocks/:store` with
  `create_app = blocks` and `create_audience = member` offers "Create a new
  one" to members on a path that names no store yet. The new store gets a
  random id, the app's type, and the creator as owner. There is no daily cap.
- **History:** every change is recorded in `mount_log` and in the system log,
  so `slop mount undo <host> <path>` restores the previous value.

### 11.3 Resolving a request

```text
resolve(host, path, person):
  kind := hostKind(host)                              # live or static
  m, params, rest := bestMount(host, path)
  if m is nil: return 404
  id := m.store or params[m.store_param]
  if id names no store, or (m.type set and type(id) != m.type):
    if kind == live and m.create_app and audienceOf(person) >= m.create_audience:
      return shell(create: m.create_app)
    return 404
  app, n := runningApp(id)                            # activates first if behind
  if kind == static:
    if not can(guest, id, 'tree.read'): return 404     # public = @guest view
    if rest == '' and not path.endsWith('/') and app has a page:
      return 308 → path + '/'          # so relative URLs resolve under the mount
  1. an actor http route matches (method, rest)
       -> run it as a turn; its response
          (as the session's person on live hosts; as an id-less guest on static)
  2. static host: rest names a file in app@n's tree -> that file
  3. live host: -> the shell, which opens a view on store id
  4. static host, rest has no extension -> app@n's index.html (client routing)
  5. -> 404
```

The trailing-slash redirect is the structural fix for the bug class above. A
page at `/r/weft/` that links `style.css` asks for `/r/weft/style.css`, which
resolves under the mount without any `Referer`. On live hosts the question
never comes up: the app's files load inside the iframe from the sandbox
origin, under `/v/<n>/`.

### 11.4 Files, caching and images

- **App files** on static hosts are served with the caching rules v2 adopted
  in SLOP-012:
  - a URL that names a version or a hash is immutable for a year;
  - a URL that names a place that moves (a mount path following `main`) is
    cached 60 s, then revalidated in the background;
  - actor responses are `no-store` unless the handler sets something else.
- **A store's own files** (content and uploads) have URLs on every site host
  and on sandbox origins. Each is served when `can(person, store,
  'tree.read')` allows it:
  - `/_s/<store>/<n|ref>/<path>` for the tree zone (immutable when `n` is a
    number, 60 s when it is a ref);
  - `/_s/<store>/assets/<path>` for the assets zone.
- **Images** take `?w=` (160 to 1920, snapped to steps) for thumbnails, cached
  by hash. Port `slop-computer/pkg/server/thumbs.go` (`snapWidth`, `thumb`,
  `makeThumb`) and `covers.go`.

### 11.5 Live hosts: the shell, sessions and guests

Live hosts carry over SLOP-011 almost unchanged. Port it from
`slop-computer/pkg/server/live.go`, `access.go` and `siteaccess.go`, and the
shell from `slop-computer/pkg/render/assets/shell.js` and `shell.css`:

- **The shell** is a small page served at the mount path. It has a bar with
  the app's title, Sign in or the person's menu, and Share for owners and
  admins. It opens a view and hosts the app's iframe.
- **The site session** is the cookie `__Host-slop_site` (`SameSite=Strict`).
  Every `/_site/*` call must:
  - come from the same origin (both `Origin` and `Sec-Fetch-Site` checked);
  - send JSON.
- **Sign-in handoff:**
  1. `/_site/login` sets a short-lived state cookie, bound to this browser.
  2. The main host's `/auth/handoff?host&return&state` signs the person in
     if needed and returns a one-time code.
  3. `/_site/callback?code` checks that the code matches the state cookie,
     then sets the site session.

  The v2 functions are `siteLogin`, `handoff` and `siteCallback`.
- **Guests** are created in `openSiteView` when the store gives guests a
  level (v2's `newVisitor`). The claim offer appears after sign-in
  (`/_site/claim`).

| Endpoint (live host) | Purpose |
|---|---|
| `GET /_slop/shell.js`, `/_slop/shell.css` | the shell |
| `POST /_site/me` | who am I here: none, guest or user, plus audience |
| `POST /_site/views` | open a view on the mount's store |
| `GET /_site/login`, `/_site/callback` | the sign-in handoff |
| `POST /_site/logout`, `/_site/claim` | sign out; keep guest work after sign-in |
| `POST /_site/create` | create a store from the URL (11.2) |
| `POST /_site/access`, `/_site/grants`, `/_site/links` | sharing, for owners |

### 11.6 Views and sandbox origins

A **view** is one open page of an app for one person. Opening one:

```text
POST /_site/views {path}            (live host)
POST /api/v1/views {store}          (main host: back-office previews)
  -> { view, secret, origin, base: "/v/<n>/", caps: [...], level, visitor }

shell: <iframe src="https://s<label>.sbx.example.com/v/<n>/">
shell -> iframe: postMessage({secret}) once the frame has loaded,
                 after checking the frame's origin
page runtime:
  GET  /_rt/views/<view>/events?after=<epoch>.<rev>   (fetch-streamed; Bearer secret)
  POST /_rt/views/<view>/rpc  {method, args}          (Bearer secret)
```

- **The label** is `s` plus the first 20 hex digits of HMAC-SHA256(server
  key, `store + "\x00" + app`). It is stable for as long as the server key is,
  so a store's `localStorage` survives new versions.
  - `system.db` `origins(label, store, app)` maps a label back to its store
    and app.
  - v2 stores random labels and looks them up (`RTOriginTarget`, the
    `sandboxLabel` and `serveSandbox` functions in
    `slop-computer/pkg/server/serve.go`). The HMAC avoids writing a row on
    first use, but either works.
- **The sandbox origin serves:**
  - `/v/<n>/…`, the app's files, immutable, with the runtime injected into
    `index.html`;
  - `/_rt/…`, the view's stream and RPC;
  - `/_s/…`, the store's files.
- **Stream events:**
  - `hello`;
  - `doc` (the body, or a patch against the version the page holds);
  - `room` and `peers`;
  - `sample` (text deltas);
  - `access` (your level changed: reopen);
  - `revoked`;
  - `reload` (a new version was activated);
  - `reset`.
- **Security:** the secret is never in a URL, and the sandbox domain is a
  different registrable domain from the main host, so cookies never reach
  app code. Responses send `frame-ancestors` naming only the main and live
  hosts.

### 11.7 The page runtime

Copy v2's runtime, `slop-computer/web/runtime/src/*.ts`:
- `caps.ts`, `db.ts`, `diff.ts`, `query.ts`, `room.ts`, `sample.ts`;
- `transport.ts`, which includes reconnect and the `access` reopen;
- `static.ts`, `limits.ts`, `index.ts`.

It builds to `/_slop/claude.js`. It implements `window.claude.use(name)` for
the contract's capabilities. Add one namespace, `claude.use('slop')`:

```ts
interface Slop {
  actions: Record<string, (args?: object) => Promise<unknown>>; // the store's actor
  stores: { open(alias: string): ReadonlyStore };                // read aliases (5.5)
  visitor(): Promise<Visitor>;                                   // same as user.me()
  signIn(): void;                                                // ask the shell to sign in
  subscribeUrl(): string;                              // the subscribe page
}
```

## 12. Doors: one verb table for the CLI, HTTP and eval

Everything a person or an agent can do is a **verb**. One table of verbs,
defined once in Go, generates:
- the CLI (`slop <group> <verb>`);
- the HTTP API (`POST /api/v1/<group>.<verb>`);
- the scope of `eval` programs (`slop.<group>.<verb>({...})`).

The back office calls the same HTTP API. So anything the UI can do, an agent
can do, under the same checks.

### 12.1 A verb

```go
// pkg/verbs/verb.go
type Verb struct {
    Name   string          // "grant.set"
    Doc    string          // one sentence, shown in help, --help and /api/v1/verbs
    Args   []Arg           // name, type, required, positional, doc
    Scope  Scope           // read | write | admin: what a token needs
    Need   func(a Args) Need   // the can() check: store, op, target; or AdminOnly
    Run    RunFunc         // (ctx, *kernel.Kernel, access.Principal, Args) (any, error)
}

var GrantSet = Verb{
    Name: "grant.set", Doc: "Give a subject a level on a store.",
    Args: []Arg{{Name: "store", Pos: 1}, {Name: "subject", Pos: 2},
        {Name: "level", Pos: 3}},
    Scope: ScopeWrite,
    Need: func(a Args) Need { return Need{Store: a.S("store"), Op: "grants.write"} },
    Run: func(ctx context.Context, k *kernel.Kernel, p access.Principal,
        a Args) (any, error) {
        return k.System().SetGrant(ctx, a.S("store"), a.S("subject"), a.S("level"), p)
    },
}
```

Each adapter does the same four things, in this order:
1. parse the arguments;
2. check the token's scope;
3. run `can()` through `Need`;
4. call `Run`.

Errors carry a code from one shared set:
- `permission_denied`, `not_found`, `invalid_argument`, `conflict`;
- `quota_exceeded`, `unavailable`, `actor_error`.

`permission_denied` also carries the trace from section 7.8.

### 12.2 The verbs

| Group | Verbs |
|---|---|
| `whoami` | `whoami` |
| `store` | `ls`, `new`, `rm`, `meta`, `export`, `fork` |
| `docs` | `get`, `ls`, `query`, `set`, `update`, `rm` |
| `files` | `ls`, `cat`, `put`, `rm`, `push`, `blobs` (`pull` is CLI-side: `files.ls` plus `files.cat`) |
| `snap`, `ref` | `snap.new`, `snap.ls`, `ref.ls`, `ref.move` |
| `app` | `ls`, `status`, `activate`, `logs` |
| `actor`, `alarm` | `actor.call`, `alarm.ls`, `alarm.fire` |
| `sql` (admin) | `query`, `exec`, `schema` |
| `log` | `show`, `watch` |
| `mount` | `ls`, `set`, `rm`, `undo` |
| `bind` | `ls`, `set`, `rm` |
| `grant`, `link` | `grant.ls`, `grant.set`, `grant.rm`, `link.new`, `link.rm` |
| `people` (admin) | `ls`, `role`, `guests`, `rm` |
| `sub` (admin) | `ls`, `grant`, `revoke` |
| `billing` (members, in a browser session) | `checkout`, `portal` |
| `policy` (admin) | `ls`, `set` |
| `llm` (admin) | `ls`, `set`, `usage`, `reset` |
| `token` | `ls`, `new`, `rm` |
| `secret` (admin) | `ls`, `set`, `rm` |
| `import` | `folder`, `docs`, `table`, `files` |
| `explain` | `can` (the trace for a hypothetical call) |

### 12.3 The CLI

- `slop serve` runs the server. Every other command is a client of the HTTP
  API, using the stored token for the chosen server.
- Verbs map to commands: `grant.set` becomes `slop grant set <store>
  <subject> <level>`. Glazed provides `--output table|json|yaml` and
  `--fields`, following v2's `cmd/slop/cmds` conventions.
- Short aliases cover what agents run most:
  - `slop push <dir>` (`files.push` plus a snapshot);
  - `slop pull <store> <dir>`;
  - `slop call <store> <action> --args '{...}'`;
  - `slop eval -f prog.js` or `-e '...'`;
  - `slop import <kind> ...`.
- Local commands that are not verbs:
  - `slop auth login|logout|status`;
  - `slop app new <name> <dir>`, which scaffolds `app.json`, `index.html`
    and, with `--actor`, `actor.js`;
  - `slop lint <dir>`, which checks the manifest and parses `actor.js`.
- `slop verbs` lists every verb the server offers, from
  `GET /api/v1/verbs`. `slop verb <name> --json '{...}'` calls any verb by
  name, so a CLI older than its server is never stuck.

### 12.4 The HTTP API

- `POST /api/v1/<verb>`, where the body is the arguments as JSON.
- The response is `{"result": ...}` or `{"error": {"code", "message",
  "trace"?}}`.
- Authentication is either:
  - `Authorization: Bearer slp_…` (a token);
  - the main host's session cookie plus `X-CSRF-Token` (the back office).
- `GET /api/v1/verbs` returns every verb with its arguments as JSON Schema.
- Streaming verbs (`log.watch`) answer with newline-delimited JSON.

### 12.5 `eval`: programs on the server

`eval` runs a JavaScript program on the server, as the token's user, with the
whole verb table in scope. One program can do what would otherwise take dozens
of round trips: import a file, reshape the records, write them, set grants,
mount the result, and report. It is the agent's main tool, and you can use it
from the CLI too.

```text
POST /api/v1/eval {source, args?, readOnly?}
  -> {result, logs: [...], error?}

slop eval -f migrate.js --args '{"store":"journal"}'
slop eval -e 'return slop.store.ls().map(s => s.id)'
```

Inside the program:

- `slop.<group>.<verb>(args)` calls a verb synchronously and returns its
  result. A failure throws an `Error` with `.code` (and `.trace` for
  `permission_denied`).
- `args` holds the caller's arguments; `console.log` output goes to `logs`.
- The program body is wrapped in a function, so a top-level `return` works.
  The return value must be JSON-serialisable.
- There is no `require`, file system, network or timer. The program reaches
  the world only through verbs.
- `readOnly: true` (or a token with only the `read` scope) gives a scope in
  which writing verbs throw `permission_denied`.

```text
evalProgram(p, source, args, readOnly):
  rt := evalFactory.NewRuntime()                 # a fresh goja runtime per call
  scope := {}
  for v in verbs:                                # synchronous host functions
    scope[v.group][v.name] = (a) =>
      if readOnly and v.Scope != read: throw permission_denied
      return callVerb(v, p, a, via = 'eval:' + p.tokenID)
  install 'slop' = scope, 'args' = args, console -> logs
  timer := after 60 s: rt.VM.Interrupt('eval timeout')
  result := rt.VM.RunString('(function(){' + source + '\n})()')
  return {result: export(result), logs}
```

Each verb an eval calls is its own turn on its store, exactly as if the CLI
had called it. A program that writes twenty documents makes twenty commits,
all tagged `via eval:<token>` in the log. Batching writes into one turn is
what `docs.set` with a `batch` argument is for: all of its documents commit
in one turn.

```js
// An example: import a CSV of books into documents and mount a browser app.
const rows = slop.files.cat({ store: 'inbox', path: 'books.csv', as: 'csv' });
slop.store.new({ id: 'library', app: 'bookshelf' });
slop.docs.set({ store: 'library', batch: rows.map(r => (
  { path: 'books/' + r.isbn, data: { title: r.title, author: r.author } })) });
slop.grant.set({ store: 'library', subject: '@member', level: 'view' });
slop.mount.set({ host: 'apps.example.com', path: '/library', store: 'library' });
return { books: rows.length, url: 'https://apps.example.com/library' };
```

An MCP door is deferred. When it comes, its first tool is `eval`, with the
verb list as its description, plus `verb` for single calls.

## 13. Signing in and tokens

### 13.1 People sign in on the main host

- **OIDC with PKCE**, server-side sessions with CSRF tokens, and an absolute
  expiry. In production the provider is Zitadel (`https://auth.slop.boutique`,
  as v2 uses today), and it decides who may create an account. Port `slop-computer/pkg/server/auth.go` (`resolve`, `guard`,
  `authRoutes`, `safeReturn`) and `pkg/identity`. Replace their store calls
  with `system.db`.
- **Development without OIDC:** `slop serve --local` offers a local sign-in
  form. Port `pkg/server/local.go` (`localSignIn`, `localToken`).
- **The first admin:** `--admin-email` makes that address an admin when it
  first signs in. After that, admins promote others with
  `slop people role usr_… admin`.

### 13.2 Agents get tokens with device login

```text
 agent CLI                    main host                     you, in a browser
 ---------                    ---------                     -----------------
 POST /auth/device
   {name, scopes}  ------->   user_code, device_code,
                              verification URL
 print "open URL,
  enter WXYZ-1234"                                   ---->  sign in, see name and
                                                            scopes, pick days,
                                                            Approve
 POST /auth/device/token
   {device_code}   ------->   (pending ... approved)
                   <-------   {token: "slp_…", id: "tok_…",
                               scopes, expiresAt}
 save to ~/.config/slop/credentials.json (0600), per server
```

- Port `slop-computer/pkg/server/device.go` (`deviceAuthorize`,
  `deviceToken`, `devicePage`, `deviceDecide`) and `tokens.go` (`tokenGrant`,
  `createToken`, `revokeToken`).
- Scopes are `read`, `write` and `admin`. A token's scopes can never exceed
  what its user's role allows: only admins can hold `admin`.
- A token acts as its user: its level on a store is the user's level, capped
  by its scopes. Revoking a token stops it at once.
- `slop token ls|rm` and the People surface list and revoke tokens. The log's
  `via` names the token, so you can always see what an agent did.

## 14. The back office

The back office is a React app on the main host. Every button in it is a call
to `/api/v1/<verb>`, so the UI holds no rules of its own. Build it with Vite,
React and RTK Query, embedded with `go:embed` (the team's
`go-web-frontend-embed` pattern). RTK Query's base query posts to the verb
endpoint.

**Look.** The back office uses the design system the lab was built with: the
Form Skate Workbench (tokens and components) and the Form Skate Agent
components.

- **Where it is:** the only copy in this repo is the lab's built stylesheet,
  `lab/dist/styles.css` (73 KB). It holds the workbench `tokens.css`, the
  workbench `components/bundle.css`, the agent `components/bundle.css`, and
  then `lab/src/ui/lab.css`, in the order `lab/build.mjs` lists them. Start
  from that file. The original design-system folders were uploads to the
  31 October session and are not in the repo.
- **The rules:**
  - a white ground (`--bg`) and one ink (`--ink`, with `--ink-2` for quiet
    text);
  - red (`--accent`, `#e2001a`) only for trouble and selection;
  - Arial in two weights;
  - 1 px hairlines (`--hair`, `--rule`);
  - one window holding a dock of tiles, each tile a strip of tabs.
- **Patterns to reuse,** from the lab's React code:
  - `lab/src/ui/dock.jsx`: the dock, with drag and drop of tabs and tiles;
  - `lab/src/ui/ui.jsx`: `Table`, `Trace` (a `can()` trace), `Seg`, `Menu`,
    `Err`, `Empty`;
  - `lab/src/ui/views1.jsx`: `StoresView`, `DataView`, `SiteView`;
  - `lab/src/ui/views2.jsx`: `LogView`, `ActorView`, `CodeView`;
  - `lab/src/ui/views3.jsx`: `AccessView`, `ConsoleView`, `AgentView`.
- **What it looks like:** the screenshots in `lab/test/shots/`, for example
  `06-access.png`, `07-data.png`, `09-actor.png` and `11-stores.png`.

These are patterns, not code to import. The lab talks to an in-browser
kernel, and the back office talks to `/api/v1`.

| Surface | What you see | What you can do |
|---|---|---|
| Activity | the system log merged with store logs: pushes, activations, grants, errors | filter by store, person or token |
| Apps | apps; versions with messages; files; manifest; actor status | roll back (`ref.move`), restart, set secrets |
| Apps ▸ Policy | the matrix of section 8 | toggle cells |
| Stores | stores by app and type; documents as a tree and a table; files; log | edit a document, run SQL (admins), export, import |
| Stores ▸ Access | owner, grants, links, read aliases, who has it open now | grant, revoke, make a link, bind |
| Sites | hosts with their kind; mounts per host | set, remove, undo; open |
| People | users with role, audience, subscription, last seen; guests; tokens | let in, make admin, disable; grant a comp; revoke a token |
| LLM | audience defaults; per-person overrides; tokens used and remaining | set access and budget; reset usage |
| Explain | `can()` for any person, store and operation, with its trace | — |

Keep the UI plain: one table per surface, a detail pane, and the actions next
to the row they change. The People and LLM surfaces are where R5 and R6 become
visible. The Policy tab answers R9, and Explain answers "why can't they?"
without reading code.

## 15. Import and export

- **Export a store**, in one of two formats:
  - `slop store export <id> --sqlite out.zip`: `store.db` (taken between
    turns with `VACUUM INTO`) plus the blobs it references. This is the
    backup format, and the way to move a store between servers.
  - `--folder out/`: `store.json` (meta), `tree/` (files), `assets/`,
    `docs.jsonl`, and `tables/<name>.jsonl` with `schema.sql`. People and
    agents can edit and diff this format.
- **Import:**

  | Command | Input | Result |
  |---|---|---|
  | `slop import folder <dir> --store <id>` | the folder format | a new store |
  | `slop import docs <file> --store <id> --coll books --id isbn` | JSON array, JSONL or CSV | documents, in one turn per 500 |
  | `slop import table <file> --store <id> --table books` | CSV or JSONL | rows; the table must exist (from a migration) |
  | `slop import files <dir> --store <id> [--zone assets]` | a folder | tree files (then `slop snap`), or assets |
- **CSV cells are typed** by `import docs` when their text round-trips
  exactly: `42` and `1.5` become numbers, `true` and `false` booleans, and
  `007` stays a string. `--raw` keeps every cell a string. (Contract queries
  only compare values of the same type, so `year >= 2000` never matches the
  string `"2004"`.)
- **Pushes send hashes first.** `files.push` takes a manifest of
  `{path, sha256, size}` and answers `missing_blobs` with the hashes it lacks;
  the CLI uploads those with `files.blobs` in 32 MiB chunks and repeats the
  push. An `eval` program cannot hash, so a manifest entry may instead carry
  its content inline as `text` or base64 `data`.
- **Transforms** are `eval` programs (section 12.5). The importers move bytes
  and rows; anything that reshapes data is a program you can read and rerun.
- **From v2:** add one command to slop-computer, `slop export --folder` per
  artifact, writing this folder format. Then `slop import folder` brings the
  storefront, the francois releases, the journal and the Blocks workspaces
  across. Nothing else of v2 is imported (no backwards compatibility).

## 16. What exists today, and what to reuse

Most of the hard edge cases are already solved somewhere. Copy code when it
has no dependency on the old data model; port it (keep the logic, rewrite the
storage calls) when it does. The commits read for this guide are listed at
the end.

**Copy almost unchanged:**

- `slop-computer/pkg/rt/*.go` (about 1,130 lines, no internal imports) →
  `pkg/rt`. These are the contract's semantics: `body.go`, `paths.go`,
  `rules.go`, `query.go`, `diff.go`, `limits.go`, `views.go`, `manifest.go`.
  `query.go` needs a SQL executor over `_docs`. `manifest.go` moves from
  `slop.json` to `app.json`.
- `slop-computer/web/runtime/src/*.ts` (about 1,970 lines) → `web/runtime`.
  Add the `slop` namespace, `sample.limits()` and the visitor fields.
- `slop-computer/web/rt-conformance/` → `conformance/contract/`. These are
  the contract's conformance pages and their runner, `run.mjs`.
- `slop-computer/pkg/blobs` → `pkg/blobs`. Add reference counting in
  `system.db`.
- `slop-computer/pkg/piworker`, `pkg/piworker/gepp` and `pkg/credentials` →
  `pkg/llm` (the backend behind the `Backend` interface).
- `francois/pkg/catalog/billing/policy.go` and `policy_test.go` →
  `pkg/billing` (the subscription decision, section 7.4).
- The subscription path of `francois/pkg/catalog/payments` → `pkg/billing/stripe`:
  - `gateway.go`: the `Gateway` interface over `stripe-go/v86`;
  - `service.go`: Checkout, Portal, `Refresh`, `Ingest` and the `Run`
    worker;
  - the projection storage from `pkg/catalog/store/billing.go`, ported to
    `system.db`;
  - the `checkout`, `portal` and `webhook` handlers from
    `pkg/catalog/routes.go`, which become the `billing.*` verbs and
    `/webhooks/stripe`.

  Leave out the one-off support payments (section 7.4).
- From slop-computer, the project tooling: `Makefile`, the lint
  configuration, `lefthook.yml`, the GoReleaser and GitHub workflow files,
  and logcopter generation.

**Port (keep the logic, change the storage):**

- **Identity:** `slop-computer/pkg/server/auth.go`, `local.go`, `device.go`,
  `tokens.go`, `users.go` and `pkg/identity` → `pkg/identity` on
  `system.db`.
- **Live sites:** `slop-computer/pkg/server/live.go` (`siteLogin`, `handoff`,
  `siteCallback`, `newVisitor`, `openSiteView`), `access.go` (`levelOf`,
  `reviewViews`) and `siteaccess.go` → `pkg/serve/live` and `pkg/access`,
  extended with audiences.
- **The shell:** `slop-computer/pkg/render/assets/shell.js` and `shell.css` →
  `web/shell`.
- **Images:** `slop-computer/pkg/server/thumbs.go` and `covers.go` →
  `pkg/serve/images`.
- **Sandbox serving:** `slop-computer/pkg/server/serve.go` (`sandboxLabel`,
  `serveSandbox`) → `pkg/serve/sandbox`.
- **Route history:** v2's route log and undo semantics → `mount_log` and
  `mount.undo`.
- **Tests:** `slop-computer/pkg/server/live_test.go` and `rt_test.go` →
  scenarios in `conformance/` (section 19).

**Read as reference; don't copy:**

- **The slop-v3 lab** in this repo, `lab/src/kernel/`:
  - `sqlite.js`: the authorizer policy, in JavaScript;
  - `store.js`: documents, files, snapshots and the log;
  - `actors.js` and `prelude.js`: `defineActor`, turns and continuations;
  - `kernel.js`: `resolve`, activation and steps;
  - `access.js`: the `can()` trace.

  Its journal app, `lab/src/seeds/journal/`, becomes `examples/journal`.
- **The lab's UI and design system:** `lab/dist/styles.css` and
  `lab/src/ui/*.jsx` are the back office's look and patterns (section 14).
- **The slop-v3 design**, `design/slop-v3-design.md`: sections 4–6 for
  stores and actors, section 15 for goja.
- **go-go-host:** `internal/runtime/supervisor.go` (build, check, then swap)
  and `internal/sitejs/dbguard` (per-site SQLite quotas).
- **go-go-goja:** a dependency, not a copy. Use `pkg/engine`
  (`NewRuntimeFactoryBuilder`, `RuntimeFactory.NewRuntime`, `Runtime`),
  `pkg/runtimeowner` (`RuntimeOwner.Call`, `Post`) and `pkg/runtimebridge`.

**Leave behind:**
- v2's `pkg/store` (artifacts, versions and the Postgres schema);
- route resolution in `serve.go` (bindings, `record`, `page_from`, the
  `Referer` lookup, `readByRoute`);
- `pkg/records`, `pkg/render` and `pkg/events`;
- the React Workshop;
- `pkg/francois`, the v1 importer.

## 17. Decisions, and what was cut

Two decision records appear where they matter most: policy per app (section
8) and one kind per host (section 11.1). The rest are here.

### Decision D1: the store is the only durable noun

- **Context:** v2 has artifacts with kinds, versions, targets, instances,
  routes with bindings, and projects. Each new feature added a noun.
- **Options considered:** keep v2's model; go-go-host's sites and
  deployments; stores.
- **Decision:** stores. An app is a store with `app.json`.
- **Rationale:** one inspector, one history, one export and one access check
  cover apps, data and content alike.
- **Consequences:** types and conventions replace tables. A "project" is just
  a store of type `project` if one is ever needed.
- **Status:** proposed.

### Decision D2: one SQLite file per store, plus `system.db`

- **Context:** v2 runs on Postgres; go-go-host and the slop-v3 design use
  SQLite per site or store.
- **Options considered:** Postgres for everything; SQLite per store.
- **Decision:** SQLite per store, plus one `system.db` for identity and
  configuration.
- **Rationale:** per-store limits, export, backup and moves are file
  operations. A single node with a persistent volume is the deployment we
  already run.
- **Consequences:** no Postgres in the cluster. Backups copy `VACUUM INTO`
  images. Open files are kept in an LRU (512 by default).
- **Status:** proposed.

### Decision D3: build the Go server first; keep the lab as reference

- **Context:** the slop-v3 design builds an in-browser workbench first, then
  a Go server that must pass the same conformance suite.
- **Options considered:** workbench first; both in lockstep; Go first.
- **Decision:** Go first. The lab is reference material only: for behaviour
  (its kernel) and for the look (its design system and UI patterns).
- **Rationale:** R1 asks for a service. Two implementations double the cost
  of every change.
- **Consequences:** the conformance scenarios target the Go server over
  HTTP. The lab may drift from the server, and nobody needs to keep it in
  sync.
- **Status:** accepted (1 November).

### Decision D4: one owner app per store; reads by alias

- **Context:** apps need other stores' data. Two apps writing one store's
  tables would collide on schema and versions.
- **Options considered:** several apps per store; one owner with read
  aliases; full openers now.
- **Decision:** one owner app, read aliases in the core, and openers deferred
  (section 5.6).
- **Rationale:** it keeps schema, version and rules unambiguous, and covers
  the storefront and site cases now.
- **Consequences:** apps that want to edit another app's data call its
  actions until openers exist.
- **Status:** proposed.

### Decision D5: audiences are computed; grants may name them

- **Context:** R5 asks for admins, guests, members and subscribers. v2 had
  `*signed-in` and `*anyone`; francois had entitlement sources. The product
  owner decided (1 November) that anonymous visitors are guests: there is no
  separate anonymous audience.
- **Options considered:** store an audience per person; compute it.
- **Decision:** compute it from role, subscription and session. Grants,
  policy and LLM defaults can name audiences (`@member`, `@subscriber`).
- **Rationale:** a lapsed subscription or a role change takes effect without
  any data migration.
- **Consequences:** open views must be re-checked when the inputs change
  (section 7.4).
- **Status:** proposed.

### Decision D6: LLM control is access plus a token budget

- **Context:** francois had plans, daily allowances and demo budgets. R6
  asks for something trivial.
- **Options considered:** francois's plans; rate limits; access plus a
  budget.
- **Decision:** per person or per audience: allowed or not, a total token
  budget per calendar month, and a usage ledger by month.
- **Rationale:** it is the smallest rule that still prevents runaway spend.
- **Consequences:** no per-app or per-day budgets. If those are ever needed,
  they are new rows in the same tables.
- **Status:** proposed.

### Decision D7: `eval` runs on the server with synchronous verbs

- **Context:** agents should be able to do in one program what the CLI does
  in many calls (R4).
- **Options considered:** client-side scripts calling HTTP; server-side goja
  with the verbs bound.
- **Decision:** server-side goja, a fresh runtime per call, and synchronous
  verbs.
- **Rationale:** one round trip; the same checks as every door; no async
  plumbing for agents to get wrong.
- **Consequences:** a program's writes are separate turns, not one
  transaction. Batch verbs exist for atomic groups.
- **Status:** proposed.

### Decision D8: keep the claude.ai contract's names

- **Context:** the apps we host call `claude.use('db' | 'user' | 'room' |
  'sample' | ...)`.
- **Decision:** keep every contract name, including `sample` for the LLM.
  slop's additions live only under `claude.use('slop')`.
- **Rationale:** Blocks, Claude Computer and Pinup run unchanged.
- **Consequences:** the back office labels `sample` as "LLM".
- **Status:** proposed.

### Decision D9: only admins push app code

- **Context:** actors run in-process on goja, which has no memory limit.
- **Options considered:** anyone may push, with process isolation; only
  admins and their tokens push.
- **Decision:** only admins (and tokens with the `admin` or `write` scope
  held by admins) may write tree files or move refs on app stores. Members
  create stores of existing apps; they do not ship code.
- **Rationale:** code is trusted, so in-process goja with interrupts and
  input limits is enough. This keeps the core small.
- **Consequences:** an app builder for members needs the `platform`
  capability, granted per app in the policy. Process isolation is the path
  if untrusted code is ever needed.
- **Status:** proposed.

### Decision D10: open sign-up by default

- **Decision:** `signup: open` makes a new user a member. `approval` keeps
  them pending.
- **Rationale:** "signed in" is meant to be a real audience, as on a forum.
  Members cannot push code (D9), and LLM access is off unless granted. Who
  may create an account at all is decided by the OIDC provider (Zitadel, as
  for v2 today), not by slop.
- **Status:** accepted (1 November).

**What we cut from the slop-v3 design, and why:**

- **Per-version approvals and per-user consent:** replaced by the policy
  matrix and LLM access.
- **`spawn` and delegates** (child apps with narrowed tokens): no current app
  needs them.
- **Slots, the `slop.ui.v1` widget pack, and the shell as an app:** the back
  office is a plain admin UI.
- **Steps with keep and revert, questions, and agent conversations stored as
  stores:** the log, together with `via eval:<token>`, already shows what an
  agent did.
- **Structured SQL queries from pages:** pages use documents and actions.
- **The workbench as the specification, and the textbook:** see D3.
- **Fork-on-open, durable room topics, MCP and `export --html`:** later.

## 18. Implementation plan

### 18.1 Repository layout

```text
cmd/slop/               main.go; cmds/: serve, auth, app new, lint, verb adapters
pkg/config/             slop.yaml and flags
pkg/system/             system.db: migrations, people, sessions, tokens, stores,
                        grants, links, bindings, mounts, origins, policy, llm,
                        subscriptions, schedules, system log
pkg/store/              store.db: open, schema, turn API, docs, files, log,
                        snapshots, refs, export; sqlpolicy.go: the
                        authorizer and the slop_* functions
pkg/rt/                 contract semantics (copied from slop-computer)
pkg/blobs/              content-addressed files (copied from slop-computer)
pkg/kernel/             open-store LRU, turn loops, fan-out, scheduler
pkg/actor/              goja actors: factory, defineActor, use() modules, inbox
pkg/access/             audiences, levels, can() with trace, policy, llmFor
pkg/billing/            subscription decision (copied from francois)
pkg/llm/                Backend, Pi worker adapter, fake, usage ledger
pkg/identity/           OIDC, sessions, local login, device login, tokens
pkg/serve/              hosts, mounts, resolve, static, images, live, views, sandbox
pkg/verbs/              the verb table; adapters for cli, http, eval
pkg/importer/           folder, docs, table, files
web/runtime/            window.claude (copied from slop-computer)
web/shell/              the live-host shell
web/admin/              the back office (Vite, React, RTK Query)
conformance/            scenarios/*.yaml, contract/ pages, the runner
examples/               guestbook, journal, static-site
lab/, design/           the 31 October workbench and design (reference only)
```

### 18.2 Phases

Each phase ends with a test you can run. Don't start a phase before the
previous phase's exit test passes.

**P0. Skeleton and sign-in (R1, R2).**
- Copy the project tooling and set the module path.
- `pkg/config`, and `slop serve` with a host router (main host only) and
  `/healthz`.
- `pkg/system` migrations for people, sessions, tokens and device codes. Use
  the migration runner from slop-computer: it turns foreign keys off around
  each migration and runs `foreign_key_check` before committing.
- `pkg/identity`: port local login, OIDC, sessions, CSRF, device login and
  tokens.
- The verbs `whoami` and `token.*`; the CLI's `auth login` and `whoami`.
- **Exit:** `slop serve --local`, sign in, `slop auth login`, then
  `slop whoami` prints an admin. Revoking the token makes the next call fail
  with 401.

**P1. Stores, verbs and eval (R4).**
- `pkg/store`: schema, open, the turn API (`BEGIN IMMEDIATE`, collect
  changes, write the log, commit), documents on SQL (port `pkg/rt` query
  tests), files with blobs, snapshots and refs, export.
- `pkg/sqlpolicy` for the admin caller; the `sql.*` verbs.
- `pkg/verbs` with the CLI, HTTP and eval adapters.
- Importers for folders, documents and files.
- **Exit:**
  - one `eval` program creates a store, imports a CSV as documents, queries
    them, pushes a folder and lists snapshots;
  - export followed by import reproduces documents, files and tables exactly.

**P2. Apps and serving (R3).**
- `app.json` parsing and `slop lint`; activation for apps without an actor.
- `mounts`, `mount_log`, `origins` and `bindings`, with their verbs.
- `pkg/serve`: host kinds, `resolve`, static files, the trailing-slash
  redirect, `/_s/`, caching, thumbnails.
- Views, streams and RPC (port `pkg/rt/views.go`); sandbox origins;
  injecting the runtime; copy `web/runtime`.
- The live-host shell and the sign-in handoff for users.
- **Exit:**
  - a static site serves on the static host with its relative CSS;
  - a page app (v2's `web/blocks`) runs on a live host, and two browsers see
    each other's edits;
  - the contract conformance pages pass in headless Chromium.

**P3. Actors (R3).**
- `pkg/actor`:
  - a factory per (app, version), `defineActor`, and the `use()` modules
    (`sql`, `db`, `files`, `room`, `alarm`, `time`, `log`, `stores`);
  - the inbox and turn loop on `RuntimeOwner`, and continuation events;
  - actions, HTTP routes, reactors with cursors, alarms with the scheduler;
  - activation with migrations, setup and smoke; the broken state.
- `pkg/sqlpolicy` for the actor and migration callers.
- `slop.actions` in the runtime.
- **Exit:**
  - `examples/guestbook` and `examples/journal` work;
  - a crash in the middle of a turn leaves reactor writes applied exactly
    once;
  - an alarm missed during a restart fires once, with `late = true`;
  - a failing smoke check keeps the old version.

**P4. People, audiences and grants (R5).**
- Roles and sign-up modes; guests (port SLOP-011: creation, limits, the
  90-day sweep, claim).
- Audiences; grants to audience subjects; links.
- `can()` with its trace, `reviewViews`, and the verb `explain.can`.
- **Exit:** the scenario suite passes for every audience and subject
  combination, the cross-site guest claim, link redemption, and reopen versus
  revoked.

**P5. Subscriptions: comps and Stripe (R5).**
- `comps` and the Stripe tables (Appendix A); francois's `billing` policy
  with its tests; the subscriber audience; the re-check at `until`; the
  `sub.*` verbs.
- Copy francois's `payments` package (gateway, service, worker) and port its
  storage. Add `billing.checkout`, `billing.portal`, `POST /webhooks/stripe`
  and the subscribe page.
- **Exit:**
  - granting a comp makes the person a subscriber at once, and their open
    views reopen; an expired comp demotes them within a minute;
  - with the fake gateway, a webhook for an active subscription makes a
    member a subscriber, and a cancellation past `access_until` demotes them;
  - one end-to-end run against Stripe's test mode.

**P6. Policy and LLM (R6, R8, R9).**
- `app_policy` with its defaults and `policy.*` verbs; `use()` returning
  `null` or `allowed()`; checks on every turn.
- `pkg/llm`: the `Backend` interface, the Pi worker adapter and the fake;
  `llm_access`, `llm_usage` and the `llm.*` verbs; `sample` in pages (with
  streaming) and in actors; `limits()`.
- The visitor object everywhere; the `user.email` policy; `signIn()` and
  `subscribeUrl()`.
- **Exit:** scenarios show that:
  - a subscriber samples until their budget is used up, then gets
    `quota_exceeded`;
  - a member is denied;
  - policy off denies even a person with access;
  - an alarm's call is charged to the store's owner.

**P7. Back office (R7).**
- `web/admin` with the surfaces of section 14, embedded with `go:embed`,
  styled from `lab/dist/styles.css` (the Form Skate design system).
- **Exit:** a Playwright run lets in a member, grants a comp, sets an LLM
  budget, turns a policy cell on, mounts an app, and finds each change in
  Activity.

**P8. The v2 bridge and cut-over.**
- `slop export --folder` in slop-computer, then import the storefront, the
  francois releases, the journal and the Blocks workspaces.
- Run v3 on its own hosts next to v2, and move sites over one at a time.
- **CLIs:** v3's binary is `slop`. On a machine that needs both, install v2's
  CLI as `slop2`. Both read `~/.config/slop/credentials.json`, which keeps
  v2's format (`{version, default, servers: {<url>: {token, tokenId, name,
  user, scopes, expiresAt}}}`), so their logins never collide: they are
  keyed by server URL.
- **Exit:** the storefront serves from a v3 static host, styled and complete,
  and Blocks runs live with Ramon as a member.

## 19. Testing strategy

- **Unit tests** per package, as Go table tests:
  - `billing` (copied with its tests);
  - `access` (`audienceOf`, `levelOf`, `can`, `llmFor`);
  - `serve` (`bestMount`, `resolve`, the trailing slash);
  - `sqlpolicy` (one case per row of the authorizer table);
  - `store` (turns, commits, retention).
- **Conformance scenarios** are YAML files of verb calls made by named
  personas, with expected results, denials and log entries. The runner drives
  `slop serve --test`, a loopback-only mode that adds:
  - a virtual clock;
  - the fake LLM backend;
  - an `X-Slop-As: <persona>` header for impersonation.

  For example:

  ```yaml
  name: subscriber samples until the budget is used up
  given:
    people: { kim: member, sam: subscriber }
    apps: [{ dir: examples/guestbook }]
    stores: [{ id: gb, app: guestbook }]
    policy: [[guestbook, sample, subscriber, on]]
    llm: [["@subscriber", on, 100]]
    fake_llm: { tokens_per_call: 60 }
  steps:
    - { as: sam, call: actor.call, args: { store: gb, action: reply, args: { id: e1 } }, expect: ok }
    - { as: sam, call: actor.call, args: { store: gb, action: reply, args: { id: e1 } }, expect: ok }
    - { as: sam, call: actor.call, args: { store: gb, action: reply, args: { id: e1 } },
        expect: { error: quota_exceeded } }
    - { as: kim, call: actor.call, args: { store: gb, action: reply, args: { id: e1 } },
        expect: { error: permission_denied } }
  ```

  The second call starts with 40 tokens left and is allowed to finish over
  budget (section 9.3). The third is refused.
- **Contract conformance:** v2's `rt-conformance` pages in headless Chromium,
  run against a live host.
- **Browser flows** with Playwright: sign-in handoff, guest claim after a
  cross-site return, share links, reopening on a level change, and the back
  office run of P7.
- **Ported from v2:** the cases in `slop-computer/pkg/server/live_test.go`:
  - `TestHandoffCodes`, `TestVisitors`, `TestVisitorLimit`,
    `TestVisitorClaim`;
  - `TestShareLinks`, `TestGrantsAndMembers`, `TestOwnerShares`;
  - `TestSitePagesIsolated`.

  They become scenarios or Go tests, keeping their edge cases.
- **Operations:** a restore drill (export to SQLite, delete the store,
  import, compare), done once per release.

## 20. Risks and open questions

**Risks:**

- **Writes before an `await` commit on their own,** which surprises authors.
  Mitigations: the journal example, a lint warning when a handler writes,
  awaits, then writes again, and the task-row-plus-alarm pattern for work
  that must finish.
- **goja has no memory limit.** Only admins push code (D9), and input limits
  apply.
- **Many store files.** Keep an LRU of open stores; hibernated actors release
  their connections.
- **Audiences change by time** (expiring comps). The scheduled re-check
  (section 7.4) must be tested with the virtual clock.

**Decided by the product owner on 1 November:**

- Anonymous visitors are guests; there is no separate anonymous audience
  (D5, section 7.3).
- The lab is reference material, and its design system is the back office's
  look (D3, section 14).
- Stripe is copied from francois into the core, next to comps (section 7.4,
  P5).
- Sign-up is open; Zitadel decides who can create an account (D10).
- The binary is `slop`. During the cut-over, v2's CLI is installed as `slop2`
  if both are needed on one machine (P8).

- LLM budgets are monthly (section 9.1).
- Guests may be given LLM access (`@guest`), charged to their guest id. The
  seed leaves it off.

## Appendix A. `system.db`

```sql
CREATE TABLE people (
  id TEXT PRIMARY KEY,                       -- usr_… or vis_…
  kind TEXT NOT NULL CHECK (kind IN ('user','guest')),
  email TEXT UNIQUE, oidc_subject TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('pending','member','admin','disabled','guest')),
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  created_ip TEXT, claimed_by TEXT);         -- guests: who claimed their work
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY, person TEXT NOT NULL REFERENCES people(id),
  host TEXT NOT NULL, csrf TEXT, from_guest TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE tokens (
  id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE,
  person TEXT NOT NULL REFERENCES people(id), name TEXT NOT NULL,
  scopes TEXT NOT NULL,                      -- 'read write admin'
  created_at INTEGER NOT NULL, expires_at INTEGER,
  last_used_at INTEGER, revoked_at INTEGER);
CREATE TABLE device_codes (
  device_hash TEXT PRIMARY KEY, user_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, scopes TEXT NOT NULL, approved_by TEXT, days INTEGER,
  token_id TEXT, expires_at INTEGER NOT NULL);
CREATE TABLE handoffs (
  code_hash TEXT PRIMARY KEY, person TEXT NOT NULL, host TEXT NOT NULL,
  return_path TEXT NOT NULL, state TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE comps (                       -- complimentary access, by an admin
  id TEXT PRIMARY KEY, person TEXT NOT NULL REFERENCES people(id),
  until INTEGER NOT NULL, revoked_at INTEGER, note TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
-- Stripe: ported from francois pkg/catalog/store/migrations/002 and 007
CREATE TABLE stripe_customers (
  person TEXT PRIMARY KEY REFERENCES people(id),
  customer_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE stripe_subscriptions (
  subscription_id TEXT PRIMARY KEY, person TEXT NOT NULL REFERENCES people(id),
  customer_id TEXT NOT NULL, price_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0, access_until INTEGER,
  trial_until INTEGER, cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  canceled_at INTEGER, livemode INTEGER NOT NULL DEFAULT 0,
  refreshed_at INTEGER NOT NULL);
CREATE TABLE checkout_attempts (
  id TEXT PRIMARY KEY, person TEXT NOT NULL REFERENCES people(id),
  price TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','open','completed','expired','failed')),
  session_id TEXT UNIQUE, session_url TEXT, expires_at INTEGER, error_code TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX checkout_attempts_open ON checkout_attempts (person)
  WHERE state IN ('pending','open');
CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY, type TEXT NOT NULL,
  customer_id TEXT NOT NULL DEFAULT '', subscription_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '', livemode INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','processed','ignored','error')),
  attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL, error_code TEXT, stripe_created_at INTEGER,
  received_at INTEGER NOT NULL, processed_at INTEGER);
CREATE TABLE stores (
  id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT '', app TEXT,
  owner TEXT NOT NULL, created_at INTEGER NOT NULL, made_by TEXT);
CREATE TABLE grants (
  store TEXT NOT NULL REFERENCES stores(id), subject TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('view','interact','admin','owner')),
  via TEXT NOT NULL DEFAULT 'direct', created_by TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (store, subject, via));
CREATE TABLE links (
  id TEXT PRIMARY KEY, store TEXT NOT NULL REFERENCES stores(id),
  level TEXT NOT NULL CHECK (level IN ('view','interact')),
  token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER, revoked_at INTEGER);
CREATE TABLE bindings (
  store TEXT NOT NULL, alias TEXT NOT NULL, target TEXT NOT NULL,
  PRIMARY KEY (store, alias));
CREATE TABLE mounts ( /* section 11.2 */ );
CREATE TABLE mount_log (
  id INTEGER PRIMARY KEY, host TEXT NOT NULL, path TEXT NOT NULL,
  before TEXT, after TEXT, by TEXT, at INTEGER NOT NULL);
CREATE TABLE origins (
  label TEXT PRIMARY KEY, store TEXT NOT NULL, app TEXT NOT NULL,
  UNIQUE (store, app));
CREATE TABLE app_policy (
  app TEXT NOT NULL, capability TEXT NOT NULL, audience TEXT NOT NULL,
  allowed INTEGER NOT NULL, changed_by TEXT, changed_at INTEGER NOT NULL,
  PRIMARY KEY (app, capability, audience));
CREATE TABLE llm_access ( /* section 9.1 */ );
CREATE TABLE llm_usage  ( /* section 9.1 */ );
CREATE TABLE secrets (
  app TEXT NOT NULL, name TEXT NOT NULL, value_enc BLOB NOT NULL,
  changed_by TEXT, changed_at INTEGER NOT NULL, PRIMARY KEY (app, name));
CREATE TABLE schedules (store TEXT PRIMARY KEY, next_at INTEGER NOT NULL);
CREATE TABLE blob_refs (sha256 TEXT PRIMARY KEY, refs INTEGER NOT NULL, zero_since INTEGER);
-- The system log has the same shape as a store's:
CREATE TABLE _log (rev INTEGER PRIMARY KEY, at INTEGER NOT NULL, principal TEXT NOT NULL,
  via TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '');
CREATE TABLE _changes (rev INTEGER NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL,
  key TEXT NOT NULL, op TEXT NOT NULL, before TEXT, after TEXT, PRIMARY KEY (rev, seq));
```

## Appendix B. `store.db`

```sql
CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE _docs (
  path TEXT PRIMARY KEY, coll TEXT NOT NULL,
  body TEXT,                                 -- JSON; NULL = deleted (kept 7 days)
  version INTEGER NOT NULL, rev INTEGER NOT NULL, size INTEGER NOT NULL,
  by TEXT, at INTEGER NOT NULL);
CREATE INDEX _docs_coll ON _docs (coll, path);
CREATE TABLE _files (
  zone TEXT NOT NULL CHECK (zone IN ('tree','assets')), path TEXT NOT NULL,
  sha256 TEXT NOT NULL, size INTEGER NOT NULL, type TEXT NOT NULL,
  rev INTEGER NOT NULL, by TEXT, at INTEGER NOT NULL, PRIMARY KEY (zone, path));
CREATE TABLE _log (
  rev INTEGER PRIMARY KEY, at INTEGER NOT NULL, principal TEXT NOT NULL,
  via TEXT NOT NULL, app TEXT, summary TEXT NOT NULL DEFAULT '');
CREATE TABLE _changes (
  rev INTEGER NOT NULL, seq INTEGER NOT NULL,
  kind TEXT NOT NULL,                        -- doc file table ref snapshot schema
  key TEXT NOT NULL, op TEXT NOT NULL, version INTEGER,
  PRIMARY KEY (rev, seq));
CREATE TABLE _snapshots (
  n INTEGER PRIMARY KEY, rev INTEGER NOT NULL, tree TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '', by TEXT, at INTEGER NOT NULL);
CREATE TABLE _snapshot_files (
  n INTEGER NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL,
  size INTEGER NOT NULL, type TEXT NOT NULL, PRIMARY KEY (n, path)) WITHOUT ROWID;
CREATE TABLE _refs (name TEXT PRIMARY KEY, n INTEGER NOT NULL, at INTEGER, by TEXT);
CREATE TABLE _migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL,
  rev INTEGER NOT NULL);
CREATE TABLE _cursors (name TEXT PRIMARY KEY, source TEXT NOT NULL,
  epoch INTEGER NOT NULL, rev INTEGER NOT NULL);
CREATE TABLE _alarms (name TEXT PRIMARY KEY, at INTEGER NOT NULL, every TEXT,
  data TEXT, running INTEGER NOT NULL DEFAULT 0);
```

## Appendix C. `app.json` fields

| Field | Type | Meaning |
|---|---|---|
| `title` | string | shown in the shell and the back office |
| `page` | string | the HTML entry; optional |
| `actor` | string | the server entry, `actor.js`; optional |
| `type` | string | the store type this app runs on and creates |
| `capabilities` | object | the contract's block: `db` (with `rules`), `user` (with `scopes`), `room` (with `topics`), `assets`, `sample`, `downloads` |
| `slop.reads` | object | read aliases: `{ alias: { type } }` |
| `slop.fetch` | string list | origins the actor may request |
| `slop.secrets` | string list | secret names the actor may read |
| `slop.platform` | string list | `stores.create`, `mounts.set`, `grants.set` |

Migrations are files named `sql/NNN_name.sql` in the tree, applied in name
order.

## Appendix D. Actor reference

```ts
defineActor({
  setup?(ctx): void;
  smoke?(ctx): void;
  actions?: { [name: string]: (ctx, args: any) => any | Promise<any> };
  http?: { [route: string]: { level?: Level | 'public'; audience?: Audience;
                              run(ctx, req: Req): Res | Promise<Res> } };
  on?: { [selector: string]: (ctx, commit: Commit) => void };      // synchronous
  every?: { [name: string]: { cron?: string; every?: string;
                              run(ctx): void | Promise<void> } };
});

ctx = { visitor: Visitor, store: { id, type }, app: { id, version },
        now: number, rev: number, event: { kind, late? },
        need(level), needAudience(aud), fail(code, msg), log(...a) }
Req = { method, path, params, query, headers, body }
Res = { status?, headers?, json? , html?, text?, body? }

sql.all(q, ...p): Row[]    sql.one(q, ...p): Row | null
sql.run(q, ...p): { changes, lastRowid }    sql.transaction(fn)      // a SAVEPOINT
db.doc(path).get() | .set(v) | .update(v) | .delete();  db.collection(p).where(...).get()
files.read(path, { at? }) | .text(path) | .write(path, data)
     | .list(prefix?) | .snapshot({ message })
room.emit(topic, data);  room.peers()
alarm.at(t, name, data?) | .every(name, cron) | .cancel(name) | .list()
time.sleep(ms)                                   // ends the turn
stores.open(alias).docs | .files | .log | .call(action, args)   // by grant to store:<id>
sample(input, opts?) -> Promise<{ text, usage }>;  sample.allowed(): boolean
fetch(url, init?) -> Promise<{ status, headers, text(), json() }>;  fetch.allowed()
secrets.get(name): string
```

## Appendix E. Page reference

- **The contract**, unchanged: `claude.use('db' | 'user' | 'room' |
  'assets' | 'sample' | 'downloads')`, with the shapes in v2's
  `web/runtime/src/*.ts`.
- **Additions:**
  - `user.me()` gains `audience`, `guest`, `subscribed`, `level` and `llm`;
  - `sample.limits()` returns `{ allowed, remaining }`;
  - `claude.use('slop')` returns
    `{ actions, stores.open(alias), visitor(), signIn(), subscribeUrl() }`.

## Appendix F. HTTP endpoints by host

| Host | Path | Purpose |
|---|---|---|
| main | `/auth/login`, `/auth/callback`, `/auth/logout` | OIDC sign-in |
| main | `/auth/device`, `/auth/device/token`, `/device` | agent device login |
| main | `/auth/handoff` | sign-in for live hosts |
| main | `/subscribe` | subscribe page: Checkout, or the Customer Portal |
| main | `POST /webhooks/stripe` | signed Stripe webhooks (section 7.4) |
| main | `/api/v1/<verb>`, `/api/v1/verbs`, `/api/v1/eval` | the doors |
| main | `/` | the back office |
| main | `/healthz`, `/readyz` | probes |
| live | `/_slop/*`, `/_site/*` | shell and site calls (11.5) |
| live | mount paths | shell, actor HTTP routes |
| static | mount paths | app files, actor HTTP routes, index fallback |
| all site hosts | `/_s/<store>/…` | a store's own files (11.4) |
| sandbox | `/v/<n>/…`, `/_rt/views/<v>/…`, `/_s/…` | app files, view stream and RPC |

## Appendix G. CLI reference

```text
slop serve [--config slop.yaml] [--local] [--test]
slop auth login --server URL [--name N] [--scopes read,write,admin]
slop auth status | logout
slop whoami
slop app new <name> <dir> [--actor]          slop lint <dir>
slop push <dir> [--store id] [-m msg] [--ref main]
slop pull <store> <dir> [--at n|ref]
slop store ls | new <id> [--app a] [--type t] | rm <id> | export <id> --sqlite|--folder
slop docs get|ls|query|set|update|rm <store> <path> [--data JSON]
slop files ls|cat|put|rm <store> [path]       slop snap ls <store>
slop ref ls <store>    slop ref move <store> <ref> <n>
slop call <store> <action> [--args JSON]      slop app status|logs <app>
slop sql query|exec <store> "<sql>" [--write]
slop log show|watch <store> [--select 'doc:entries/*']
slop mount ls [host] | set <host> <path> <store> | rm <host> <path> | undo <host> <path>
slop bind set <store> <alias> <target> | ls <store> | rm <store> <alias>
slop grant ls|set|rm <store> [subject] [level]
slop link new <store> --level view|interact [--days N] | rm <store> <id>
slop people ls | role <usr_…> pending|member|admin|disabled | guests | rm <id>
slop sub ls | grant <usr_…> --until DATE [--note N] | revoke <id>
slop policy ls <app> | set <app> <capability> <audience> on|off
slop llm ls | set <@audience|usr_…> on|off [--budget N] | usage | reset <usr_…>
slop token ls | new --name N --scopes … | rm <tok_…>
slop secret ls <app> | set <app> <name> | rm <app> <name>
slop import folder|docs|table|files ...
slop eval -f prog.js | -e '<js>' [--args JSON] [--read-only]
slop explain can <person> <store> <op> [target]
slop verbs        slop verb <name> --json '{...}'
```

## References

Files in this repository:
- `design/slop-v3-design.md`: the full slop-v3 design (31 October).
- `lab/src/kernel/*.js` and `lab/src/seeds/journal/*`: the in-browser lab.
- `transcripts/session-log.md`: how the slop-v3 design was made.

slop-computer (`go-go-golems/slop-computer` at `18f97d4`):
- `pkg/rt/`, `web/runtime/src/`, `web/rt-conformance/`, `pkg/blobs/`;
- `pkg/piworker/`, `pkg/credentials/`;
- `pkg/server/{auth,local,device,tokens,users,live,access,siteaccess,serve,thumbs,covers,rt_sample}.go`;
- `pkg/render/assets/shell.{js,css}`;
- `pkg/server/live_test.go`.

francois (`go-go-golems/francois` at `106776a`):
- `pkg/catalog/billing/policy.go`, `pkg/catalog/entitlement.go`;
- `pkg/catalog/payments/gateway.go`, `pkg/catalog/payments/service.go`;
- `pkg/catalog/store/billing.go`, `pkg/catalog/routes.go`;
- `pkg/catalog/store/migrations/002_billing_usage.sql`,
  `007_checkout_price.sql`.

go-go-goja (`go-go-golems/go-go-goja` at `c265ae0`):
- `pkg/engine/factory.go`, `pkg/engine/runtime.go`;
- `pkg/runtimeowner/`, `pkg/runtimebridge/`.

go-go-host (`go-go-golems/go-go-host` at `4fa1bf0`):
- `README.md`, `internal/runtime/supervisor.go`, `internal/sitejs/dbguard/`;
- `ttmp/2026/06/18/HOST-013-…` (the lambda control plane, not adopted).
