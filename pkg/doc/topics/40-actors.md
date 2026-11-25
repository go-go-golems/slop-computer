---
Title: "Actors: an app's server side (actor.js)"
Slug: "actors"
Short: "Write actor.js: actions with requires, ctx, documents and SQL, migrations, alarms, reactors, HTTP routes, calls to other stores and sample with tools."
Topics:
- actors
- apps
- server
- javascript
Commands:
- call
- actor
- app
- alarm
- mount
- bind
- grant
- policy
- llm
- push
Flags:
- api
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
An **actor** is the server half of an app: the file named by `"actor"` in
`app.json` (usually `actor.js`), run on the server for one store at a time.
Every store that runs the app gets its own actor, with its own data. Pages,
the CLI, app verbs, other stores, HTTP requests, alarms and the store's own
commits all reach the actor as **events**, and the actor handles them one
at a time, each in one transaction.

Write an actor when the server must decide something: a rule pages cannot
be trusted with, a write that must be checked against the caller's level,
data in SQL tables, work on a schedule, an HTTP endpoint, or a model call
paid by the caller. A page-only app does not need one.

This page is the reference for everything an actor can do. For the
manifest, see `slop help app-manifest`; for deploying, `slop help
deploying-apps`.

## The module shape

`actor.js` is a script (not an ES module) that calls `defineActor` exactly
once while it loads. Everything else is optional.

```js
const db = use('db');                 // modules are taken at load time

defineActor({
  setup(ctx) { /* once per new app version, as the store itself */ },
  smoke(ctx) { /* a check after setup; a throw rejects the version */ },
  actions: { /* name: { requires, run(ctx, args) } */ },
  http:    { /* 'GET /path/:p': { level, run(ctx, req) } */ },
  every:   { /* name: { every: '1h' | cron, run(ctx) } */ },
  alarms:  { /* name(ctx, data): one-shot alarms set with alarm.at */ },
  on:      { /* 'doc:items/*'(ctx, commit): reactors */ },
});
```

What happens when a store first uses a new snapshot of its app
(**activation**), in one transaction:

1. The pending migrations run (`sql/*.sql`, see below).
2. `actor.js` loads; it must call `defineActor` or the version is broken.
3. `setup(ctx)` and then `smoke(ctx)` run, as the store itself. They must
   not await I/O. A throw in either rolls back the whole activation, and
   `slop app status <store>` shows the version as broken with the message.
4. The recurring alarms of `every` are recorded, and reactor cursors start
   at the current head (reactors see only what happens after activation).

The actor itself is then built on first use and retired after 60 seconds
without events; it is rebuilt transparently on the next event. Variables at
the top level of `actor.js` therefore live only as long as one runtime:
keep anything that must survive in documents or tables, never in globals.

A complete working actor. It is a fuller Tally than the one in `slop help
app-verbs` (more actions, routes and alarms); the two are separate examples:

```js
// Tally: a counter per name (SQL) and a list of items (documents).
const db = use('db'), sql = use('sql'), alarm = use('alarm');
const sample = use('sample'); // null unless app.json declares sample and the policy allows it for some audience

defineActor({
  // Runs once per new app version, in the activation transaction, as the store itself.
  setup(ctx) {
    if (!db.doc('meta/info').get().exists) db.doc('meta/info').set({ title: 'Untitled tally' });
  },

  actions: {
    count: {
      requires: 'interact',
      run(ctx, args) {
        const name = String((args && args.name) || '').trim();
        if (!name) ctx.fail('invalid_argument', 'count what? (name)');
        const by = Number((args && args.by) || 1);
        sql.run(`INSERT INTO hits(name, n, by, at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(name) DO UPDATE SET n = n + excluded.n, by = excluded.by, at = excluded.at`,
                name, by, ctx.visitor.id, ctx.now);
        return sql.one('SELECT name, n FROM hits WHERE name = ?', name);
      },
    },
    totals: {
      requires: 'view',
      run(ctx) { return sql.all('SELECT name, n, at FROM hits ORDER BY n DESC'); },
    },
    add: {
      requires: 'interact',
      run(ctx, { text, tags }) {
        if (!text) ctx.fail('invalid_argument', 'give text');
        const id = 'i' + ctx.now.toString(36);
        db.doc('items/' + id).set({ text: String(text), tags: tags || [], by: ctx.visitor.name || ctx.visitor.id, at: ctx.now });
        return { id };
      },
    },
    remind: {
      requires: 'admin',
      run(ctx, { inMs, text }) {
        alarm.at(ctx.now + Number(inMs || 2000), 'remind', { text: String(text || 'ping') });
        return alarm.list();
      },
    },
    ask: {
      requires: 'view',
      async run(ctx, { question }) {
        if (!sample) ctx.fail('unavailable', 'sample is off for this app');
        const tools = [{
          name: 'totals', description: 'The counters, largest first.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => sql.all('SELECT name, n FROM hits ORDER BY n DESC'),
        }];
        const r = await sample('Answer from the counters: ' + String(question || ''), { tools });
        return { answer: r.text, model: r.model };
      },
    },
  },

  http: {
    'GET /api/totals': { level: 'public', run(ctx, req) {
      return { status: 200, json: sql.all('SELECT name, n FROM hits ORDER BY n DESC') };
    } },
    'POST /api/count/:name': { level: 'interact', run(ctx, req) {
      sql.run('INSERT INTO hits(name, n, at) VALUES (?, 1, ?) ON CONFLICT(name) DO UPDATE SET n = n + 1', req.params.name, ctx.now);
      return { status: 201, json: { name: req.params.name } };
    } },
  },

  every: {
    snapshot: { every: '1h', run(ctx) { db.doc('meta/last').set({ at: ctx.now, late: ctx.event.late }); } },
  },
  alarms: {
    remind(ctx, data) { db.doc('reminders/' + ctx.now).set({ text: data.text, at: ctx.now }); console.log('reminded:', data.text); },
  },
  on: {
    'doc:items/*'(ctx, commit) { db.doc('meta/stats').set({ items: db.collection('items').get().size, rev: commit.rev }); },
  },
});
```

with `sql/001_hits.sql`:

```sql
-- One row per counted thing. Only migrations create tables; actors read and write them.
CREATE TABLE hits(
  name TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  by TEXT,
  at INTEGER
);
```

and this `app.json`:

```json
{
  "title": "Tally",
  "type": "tally",
  "actor": "actor.js",
  "capabilities": {
    "db": { "rules": [
      { "path": "meta", "read": "view", "write": "admin" },
      { "path": "items", "read": "view", "write": "admin" }
    ] },
    "user": { "scopes": ["profile"] },
    "sample": {}
  }
}
```

Deploy and call it (output trimmed):

```sh
$ slop store new tally && slop push ./tally --store tally
$ slop store new t1 --app tally --type tally
$ slop call t1 count '{"name":"coffee","by":2}'
"n": 2
name: coffee
$ slop actor call t1 count --args '{"name":"coffee"}'
"n": 3
name: coffee
$ slop call t1 count '{}'
error: invalid_argument: count what? (name)
$ slop call t1 nope
error: not_found: t1 has no action "nope"
```

`slop call <store> <action> [json]` and `slop actor call <store> <action>
--args <json>` are the same verb (`actor.call`). Both run the action as you;
a platform admin adds `--as anonymous` to run it as a signed-out visitor
(`ctx.visitor.guest` true, the store's guest level), which is how to test
what a stranger gets (`slop help access-control`).

## Actions

An action is an entry of `actions`: `{ requires, run(ctx, args) }`. `args`
is the JSON the caller sent (an object, possibly empty); the return value
goes back to the caller as JSON (`undefined` becomes `null`). `run` may be
`async`.

`requires` is the level the caller needs on the store: `view`,
`interact`, `admin` or `owner`. It is checked before any of the action's code
runs, for every kind of caller (page, CLI, app verb, another store). An
action that declares no `requires` (or is a plain function) needs `admin`,
and the actor logs a warning at activation:

```sh
$ slop app logs t1
lines:
    - level: warn
      text: action secret declares no requires; callers need admin
```

A caller below `requires` gets `permission_denied: count needs interact; you
have view`. A caller with no level at all gets `not_found` (the action is not
revealed). For finer checks inside an action, use `ctx.need(level)` (see
`apps/examples/journal`: authors publish their own drafts, admins anyone's).

How actions are reached:

| From | How |
| --- | --- |
| CLI | `slop call <store> <action> '<json>'` |
| A page of the app | `(await claude.use('slop')).call('count', {name})` (see `slop help capability-slop`) |
| App verbs | `require("slop").board().call('count', {name})` (see `slop help app-verbs`) |
| Another store's actor | `use('stores').open(alias).call('count', {...})` (below) |
| `slop eval -e '…'` | `return slop.actor.call({store: 't1', action: 'totals', args: {}})` |

The actor's `db` and `sql` are the store's own, **without** the page rules
in `app.json`: an action can write paths no page may write. That is the point
(pages call actions to do checked writes), and it is also the risk: never
write what the caller could not, and validate `args` (types, lengths) before
using them.

## ctx: who, when, what

Every handler gets `ctx` as its first argument.

| Field | Meaning |
| --- | --- |
| `ctx.visitor` | Who the event acts for: `{id, name, audience, level, guest, subscribed, llm}`. `level` is their level on this store (`view`…`owner`, or `""`); `audience` is `guest`, `member`, `subscriber`, `admin`, or `store`. `name` is empty unless the app declares `user` with the `profile` scope. `llm` is their LLM access (`allowed`, `remaining`, `used`, `source`). |
| `ctx.principal` | The same object as `ctx.visitor`. |
| `ctx.store` | `{id, type}` of this store. |
| `ctx.app` | `{id, version}`: the app store and the snapshot running. |
| `ctx.event` | `{kind, name, late}`: `kind` is `action`, `http`, `alarm`, `reactor` or `setup`; `late` is true for an alarm that fired after the server was down. |
| `ctx.now` | The turn's time in ms. `Date.now()` returns the same value inside a turn. |
| `ctx.rev` | The store's revision when the turn began. |
| `ctx.fail(code, msg)` | Throws an error with that code; the caller sees `code: msg`. Use `invalid_argument`, `not_found`, `permission_denied`, `conflict`, `unavailable`. |
| `ctx.need(level)` | Throws `permission_denied: this needs <level>; you have <level>` unless the visitor has at least that level. |
| `ctx.needAudience(group)` | Throws `audience_required` unless the visitor is in the group (`member`, `subscriber`, `admin`). |
| `ctx.log(...)` | A line in the actor's log (`slop app logs`). |
| `ctx.storage` | Durable-Object-shaped key/value storage over the store's documents (`get`, `put`, `delete`, `list`, `transaction`, `getAlarm`, `setAlarm`); its promises are already settled, so awaiting them does not end the turn. |

For setup, alarms and reactors nobody is behind the event: the visitor is
the store itself, `{id: "store:<id>", audience: "store", level: "owner"}`.

Errors: a thrown `Error` with a `.code` keeps its code (`throw
Object.assign(new Error('taken'), {code: 'conflict'})` reaches the caller as
`conflict: taken`); any other throw becomes `actor_error` with the message
and the line (`actor_error: Error: plain error at run (actor.js:31:51(3))`).

## Turns: every event is a transaction

A **turn** is one event handled in one store transaction. Everything the
handler writes (documents, SQL rows, files, alarms) commits together when the
handler returns, or not at all when it throws. Room messages (`room.emit`)
leave only after the commit.

**An await on real I/O ends the turn.** `await sample(...)`, `await
time.sleep(ms)`, `await fetch(...)` and `await other.call(...)` commit what
the handler wrote so far; the code after the `await` runs in a new turn
(a new transaction, a new `ctx.now`). Re-read anything another event may
have changed meanwhile before writing. Awaiting an already settled promise
(the `storage` methods, `Promise.resolve`) does not end the turn.

```js
slowPublish: {
  requires: 'interact',
  async run(ctx, { id }) {
    sql.run("UPDATE posts SET title = title || ' (scheduled)' WHERE id = ?", id);  // commits at the await
    await use('time').sleep(60000);
    sql.run("UPDATE posts SET status = 'published' WHERE id = ?", id);            // a later turn
    return { ok: true, publishedAt: ctx.now };
  },
},
```

Events of one store never run in parallel, so a handler never needs locks;
but between two turns of the same handler other events may run.

## Documents: use('db')

`use('db')` reads and writes the store's documents: JSON objects at paths
like `items/i1` (collection `items`, id `i1`). It is the same data pages see
through `claude.use('db')`, without the page rules.

```js
const db = use('db');
db.doc('items/i1').set({ text: 'beans', at: ctx.now });   // replace; returns the new version
db.doc('items/i1').update({ done: true });                // merge fields
const s = db.doc('items/i1').get();                       // {exists, id, path, version, data()}
if (s.exists) s.data().text;
db.doc('items/i1').delete();                              // true if it existed
const q = db.collection('items').where('done', '==', false).orderBy('at', 'desc').limit(20).get();
q.docs.map(d => ({ id: d.id, ...d.data() }));             // q.size, q.empty
```

`where` operators: `==`, `!=`, `<`, `<=`, `>`, `>=`, `array-contains`,
`in`, `not-in` (at most 10 filters, 30 values for `in`). `limit` is at most
1000. A document body is at most 256 KiB; a store holds at most 25,000
documents (`quota_exceeded` beyond).

Paths in another store (an alias set with `slop bind set`) can be read
through `db` with the visitor's rights, but never written: an actor writes
only its own store (`permission_denied: … an actor writes only its own`).

## SQL tables and migrations: use('sql')

Tables are created only by **migrations**: files `sql/NNN_name.sql` at the
top of the app's tree, applied in name order at activation, each once per
store. A migration may create, alter and drop tables, indexes, views,
triggers and FTS5 virtual tables whose names do not start with `_`,
`sqlite_` or `slop_`. Never edit an applied migration: the next activation
fails with `migration sql/001_hits.sql changed after it was applied; add a
new migration instead`. Add `sql/002_….sql`. `slop app status <store>
--migrations` lists what a store has applied.

Actors read every table and write the app's tables; they cannot run DDL,
`ATTACH`, `PRAGMA` writes or temp objects.

```js
const sql = use('sql');
sql.all('SELECT name, n FROM hits WHERE n > ?', 2);       // rows as objects
sql.one('SELECT n FROM hits WHERE name = ?', 'tea');       // first row or null
sql.run('UPDATE hits SET n = 0 WHERE name = ?', 'tea');    // {changes, lastRowid}
sql.transaction(() => { /* a SAVEPOINT inside the turn: a throw rolls back only this part */ });
```

SQL functions available in queries and views: `slop_principal()` (the
visitor's id), `slop_level()` and `slop_now()`. A view such as
`... WHERE author = slop_principal()` gives each person their own rows.
Admins inspect tables with `slop sql` (see `slop help store-data`).

## Alarms and schedules

**Recurring** alarms are declared in `every`: `{ every: spec, run(ctx) }`.
The spec is a Go duration (`'30s'`, `'5m'`, `'1h'`, at least 1s),
`'@every 5m'`, a descriptor (`'@hourly'`, `'@daily'`) or a five-field cron
line (`'0 9 * * 1'`). They are (re)registered at each activation; names a
new version drops are removed.

**One-shot** alarms are set from code and handled in `alarms`:

```js
const alarm = use('alarm');
alarm.at(ctx.now + 60000, 'remind', { text: 'stretch' });  // name is unique: setting it again moves it
alarm.every('poll', '5m');      // recurring, from code; handled by alarms.poll
alarm.cancel('remind');
alarm.list();                   // [{name, at, every, running}]
```

A recurring alarm set from code is removed at the next activation (a new
snapshot) unless `every` declares it; declare schedules in `every`.

Alarms are at-least-once: a handler that throws rolls back and runs again
later, and an alarm missed while the server was down fires once, late
(`ctx.event.late`). The alarm's handler runs as the store itself. Inspect
and trigger them from the CLI:

```sh
$ slop alarm ls t1
- at: 1795564540641
  every: null
  name: remind
- at: 1795567993266
  every: 1h
  name: snapshot
$ slop alarm fire t1 snapshot
fired: snapshot
```

A failing alarm leaves a line in `slop app logs <store>` (`alarm digest
failed: …`); nobody else sees the error.

## Reactors: on

`on` maps a selector to a handler that runs once for every commit of the
store that matches it, in order, after the commit (exactly once: the
cursor moves in the same transaction). Selectors: `doc:<glob>`
(`doc:items/*`, `doc:items/**`), `file:<glob>`, `table:<name>`,
`ref:<name>`, `snapshot`, `schema`, `*`. The handler gets `(ctx, commit)`;
`commit.rev` is the commit's revision. Reactors are synchronous and run as
the store itself; their own writes do not trigger reactors again.

```js
on: {
  'table:posts'(ctx, commit) { /* recompute stats from SQL */ },
  'doc:items/*'(ctx, commit) { db.doc('meta/stats').set({ items: db.collection('items').get().size, rev: commit.rev }); },
},
```

## HTTP routes and the mount API policy

`http` maps a route key, `"<METHOD> <pattern>"`, to `{ level, audience?,
run(ctx, req) }`. Patterns use `:param` segments and a trailing `*` (the
rest of the path, in `req.params['*']`); the most specific match wins. `*`
as the method matches any, and `GET` also answers `HEAD`. `level` is `public`,
`view` (default), `interact`, `admin` or `owner`. Routes answer on every
**live-host** mount that serves the store (`slop mount set <host> <path>
<store>`), at the path below the mount.

`req` is `{method, path, base, params, query, headers, body}` (`body` is the
raw text, at most 1 MiB by default; `headers` holds only a few forwarded
headers). The handler returns `{status, headers, json | html | text | body}`
(a plain value is sent as JSON).

```sh
$ slop mount set apps.example.com /tally t1
$ curl -s http://apps.example.com/tally/api/totals
[{"n":3,"name":"coffee"},{"n":3,"name":"tea"}]
```

A non-public route needs a signed-in browser session on the live host (a
`Bearer` token is not accepted there unless the mount's API policy enables
the `apiToken` middleware). A visitor with no level gets `404`, one with too
low a level `403 permission_denied`.

`require('express').app()` registers routes into the same table while
`actor.js` loads, for code written for go-go-goja:
`app.get('/hello/:who').public().handle((ctx, res) => res.json({hello: ctx.params.who}))`.

**The mount API policy** (`slop mount set … --api '<json>'`) turns a mount
into an API with an allowlist of route keys, level floors, middlewares
(`rateLimit`, `cors`, `apiToken`) and size limits:

```sh
slop mount set apps.example.com /tally t1 --api '{
  "prefix": "/api",
  "routes": ["GET /api/*", "POST /api/count/:name"],
  "defaultMin": "public",
  "floors": [{"route": "POST /api/*", "min": "interact"}],
  "middleware": [{"name": "rateLimit", "config": {"per": "ip", "limit": 60}}]
}'
slop mount routes apps.example.com /tally      # each route: allowed, declared and effective level
```

Three rules that bite:

- **The default floor is view.** `defaultMin` is `view`: without `"defaultMin": "public"` a public route
  still needs `view` on that mount, so guests get 404. The effective level is
  the higher of the route's `level` and the floor.
- **A mount without `--api` serves every route.** The actor fails to load
  only when every mount serving the store has an API policy and none of them
  lists a route: `route POST /api/count/:name is in no API allowlist of the
  mounts serving t1 (…)`. That breaks the
  store's actions too, not only HTTP. Fix the `--api` (or remove the route),
  then `slop app restart <store>`.
- With a `prefix`, only paths below it reach the actor; other paths go to the
  pages. Below the prefix an unknown route is a JSON 404.

## Calls between stores: use('stores')

An actor reads another store, and calls its actions, through a **binding**:
a named alias on this store that points at the other one. The calling store
acts as itself (`store:<id>`), with only the level granted to it.

```sh
slop bind set pr1 counter t1            # on pr1, "counter" means t1
slop grant set t1 store:pr1 interact    # what pr1 may do on t1
```

```js
relay: { requires: 'interact', async run(ctx, { name }) {
  const t = use('stores').open('counter');
  const info = t.docs.get('meta/info').data();   // reads follow t1's db rules at pr1's level
  const r = await t.call('count', { name });      // t1's action; the await ends this turn
  return { title: info && info.title, counted: r };
} },
```

The handle also has `t.docs.query(coll, q)`, `t.files.text(path)`,
`t.files.list()` (the target's published `main` tree), `t.rev()`, `t.log(after)`
and, when the binding was set with `--assets`, `t.assets`. What happens
without the setup, in order:

```text
error: not_found: no binding for "counter" on pr1
error: permission_denied: store:pr1 cannot read t1 (grant it view)
error: permission_denied: count needs interact; you have view
```

The grant is checked again on every call: revoking it stops a handle that is
already open.

## sample from an actor

`use('sample')` is the model, paid by the visitor (for an alarm or reactor,
by the store). It is `null` unless the app declares `"sample": {}` in
`app.json`, a model backend is configured, and the policy allows `sample` for
at least one audience. Every call then checks the visitor's audience against
the policy and their LLM access and budget.

```js
const r = await sample('Summarize: ' + text, { modelTier: 'quick', maxTokens: 400 });
r.text; r.model; r.usage;                // {input, output}
const obj = await sample.json('Reply with JSON {"ok": true}');   // parsed JSON
sample.allowed();                        // may this visitor sample now (no throw)
sample.limits();                         // {allowed, remaining}
```

Options: `modelTier` (`quick`, `default`, `complex`), `model`, `effort`,
`maxTokens`, `tools`. One call times out after 3 minutes.

**Tools** let the model act through the actor, as Pinboard's `ask` action
does: each tool is `{name, description, inputSchema, execute(input)}`. The
model sees the first three; `execute` is your function. Each tool call runs
as **its own turn** of the same event: its writes commit when it returns, a
throw rolls back only that call and the model reads `{"error": "code:
message"}`. A tool call has 60 seconds. Give a person only the tools their
level allows (Pinboard filters its write tools out for viewers).

```js
const tools = [{
  name: 'totals', description: 'The counters, largest first.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => sql.all('SELECT name, n FROM hits ORDER BY n DESC'),
}];
const r = await sample('Answer from the counters: ' + question, { tools });
```

What it needs, checked in this order:

```sh
slop policy set tally sample @member on     # the app may sample for members (and up)
slop llm set @member on --budget 200000     # members may spend tokens
slop policy set tally sample @store on      # only if alarms or reactors sample
slop llm set store:t1 on --budget 10000     # ... and the store pays for those
```

Changing the policy restarts the app's actors, so `use('sample')` is
re-evaluated. Failures: `unavailable` (`sample` was `null` and the action
said so), `permission_denied: this app may not use sample for <audience>`,
`no LLM access`, `quota_exceeded`. With `slop serve --llm fake`, `sample`
answers `slop is connected.`; with tools it calls the first tool once with
`{}` and answers `The browser tool completed successfully.`

The `agent` capability (server-held sessions) exists only for pages; an
actor uses `sample`.

## Other modules

`use(name)` returns `null` for a module the app may not use; check before
calling. `require(name)` resolves these names too, before the app's own
files.

| Module | What it is | Needs |
| --- | --- | --- |
| `db`, `sql` | Documents and tables (above) | — |
| `alarm`, `time` | Alarms; `time.now()`, `await time.sleep(ms)` (ends the turn) | — |
| `files` | The store's files: `text(path, {zone, at})`, `read`, `write(path, data, {zone: 'assets'})`, `list(prefix)`, `snapshot({message})` | — |
| `log` | `log.info/warn/error/debug(...)` into the actor's log | — |
| `room` | `room.emit(topic, data)` to the store's open pages after the commit; `room.peers()` | — |
| `stores` | Bound stores (above) | `slop bind set`, a grant to `store:<id>` |
| `storage` | Durable-Object-shaped key/value storage (also `ctx.storage`) | — |
| `database` | go-go-goja's `query`, `exec`, `begin` (a savepoint) over the store's tables | — |
| `express` | Route builder (above) | — |
| `fs`, `path` | An in-memory file tree the actor owns (empties on restart; never the host's disk); POSIX paths | — |
| `yaml`, `crypto`, `events`, `buffer` | Parse/stringify YAML; `randomUUID`, `createHash`; EventEmitter; `Buffer` | — |
| `sample` | The model (above) | `sample` in `app.json`, policy |
| `fetch` | `await fetch(url, {method, headers, body})` → `{status, ok, headers, text(), json(), base64()}`; 30 s, 10 MiB | origins listed in `app.json` `slop.fetch`, policy `fetch` |
| `secrets` | `secrets.get(name)` | names in `slop.secrets`, policy `secrets`, `slop secret set` |
| `platform` | Create stores, set mounts and grants as the visitor | operations in `slop.platform`, policy `platform` |
| `system`, `workshop` | Platform administration as the visitor | `slop.modules` in `app.json` and `slop app trust <app> <module>` by an admin |

`slop app modules` lists the module catalog with each module's TypeScript
declaration. `user`, `assets`, `agent` and `comments` are page capabilities:
`use()` returns `null` for them in an actor.

## The JavaScript dialect

Actors run on goja, an ECMAScript engine in Go, not Node.js or a browser.

- **Available:** ES2020-level syntax (classes with private fields,
  `async`/`await`, optional chaining, `??`, `??=`, BigInt, regex lookbehind
  and named groups, `Array.prototype.at`, `replaceAll`), `Promise`, `Proxy`,
  `Reflect`, `Symbol`, `JSON`, `Math`, `Date`, `console.log/info/warn/error`
  (to the actor's log), CommonJS `require('./file.js')` of files in the app's
  tree (`.js`, `.cjs`, `.json`, and TypeScript `.ts`, compiled on load).
- **Not available:** `import`/`export` (ES modules), async generators,
  `setTimeout`/`setInterval` (use alarms or `time.sleep`), `fetch` as a
  global (use `use('fetch')`), `process`, a global `Buffer`, `TextEncoder`,
  `URL`, `atob`, `structuredClone`, `Intl` (`toLocaleDateString` ignores
  locales), npm packages unless vendored into the tree.
- `Date.now()` is the turn's time; `Math.random()` works.

## Limits and timeouts

| Limit | Value | What happens |
| --- | --- | --- |
| One turn's JavaScript | 5 s | `actor_error: turn took longer than 5s`, the turn rolls back |
| Three timed-out turns in a minute | — | the actor is **broken**: `actor_error: the actor is broken: 3 crashed turns in a minute` until `slop app restart <store>` |
| A caller waiting for a result | 60 s | `unavailable: the actor did not answer in time` (the work may still finish) |
| Queued events per store | 256 | `unavailable: the actor is busy` |
| Idle actor | 60 s | retired; rebuilt on the next event |
| `sample` call / tool call | 3 min / 60 s | `unavailable`; the model reads a tool error |
| HTTP request body / response | 1 MiB / 4 MiB (configurable with `--api`) | 413 / 500 |
| Document | 256 KiB, 25,000 per store | `invalid_argument` / `quota_exceeded` |

## Logging and debugging

- `console.log(...)`, `ctx.log(...)` and `use('log').warn(...)` write to the
  actor's log; objects are printed as JSON. `slop app logs <store>` shows the
  last 500 lines (kept in memory: a server restart clears them). Failed
  alarms and reactors are logged here and nowhere else.
- `slop app status <store>` shows the app, snapshot and manifest, and
  `broken:` with the reason when activation or loading failed (a syntax
  error, a throw in `setup`, a changed migration, a route outside an API
  allowlist, repeated timeouts). `--peek` shows it without activating a newer
  snapshot; `--migrations` lists applied migrations.
- `slop app restart <store>` clears a broken state and retries.
- `slop call <store> <action>` is the quickest test; `-o json` shows the
  exact result. An action like `whoami: {requires: 'view', run: (ctx) => ({visitor: ctx.visitor, event: ctx.event})}`
  shows what the actor sees of you.
- `slop alarm ls` / `slop alarm fire` run schedules on demand;
  `slop mount routes <host> <path>` shows what a mount lets through.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `actor_error: actor.js did not call defineActor` | The file threw before reaching it, or never calls it | `slop app status <store>` shows the error; call `defineActor({...})` once at the top level |
| `permission_denied: x declares no requires, so it needs admin` | The action has no `requires` | Add `requires: 'view'` (or the level it needs) |
| `not_found: <store> has no action "x"` | Typo, or you have no level on the store | `slop explain can <store> view`; check the action name |
| `actor_error: turn took longer than 5s` | A loop or a heavy computation in one turn | Split the work (alarms, batches); after three in a minute run `slop app restart <store>` |
| A write after `await` overwrote someone else's change | The await ended the turn | Re-read before writing in the code after an `await` |
| `migration sql/001_x.sql changed after it was applied` | An applied migration was edited | Restore it; add `sql/002_….sql` |
| Guests get 404 on a public route | The mount's API policy has `defaultMin: view` | Add `"defaultMin": "public"` to `--api` |
| `route … is in no API allowlist of the mounts serving …` | A route key is outside a mount's `routes` | Add it to `--api` routes (or remove the route), then `slop app restart` |
| `use('sample')` is `null` | Not declared in `app.json`, or the policy allows it for nobody | Declare `"sample": {}`; `slop policy set <app> sample @member on` |
| `alarm x failed: this app may not use sample for store` | Alarms and reactors run as the store | `slop policy set <app> sample @store on` and `slop llm set store:<id> on` |
| `permission_denied: store:a cannot read b (grant it view)` | No grant for the calling store | `slop grant set b store:a view` (or `interact` to call actions) |
| `ReferenceError: setTimeout is not defined` | No timers in goja | `use('alarm').at(...)` or `await use('time').sleep(ms)` |

## See Also

- `slop help building-apps` — when to write an actor, and the files of an app
- `slop help app-manifest` — `app.json`: `actor`, capabilities, `slop.fetch`, `slop.secrets`
- `slop help deploying-apps` — stores, push, mounts, grants, policy
- `slop help app-verbs` — command-line verbs that call actions
- `slop help capability-slop` — calling actions from a page
- `slop help capability-sample` — `sample` from a page
- `slop help llm-access` — policy cells, the `llm` table and budgets
- `slop help store-data` — documents, tables, the log, alarms from the CLI
- `slop help access-control` — levels, grants and groups
