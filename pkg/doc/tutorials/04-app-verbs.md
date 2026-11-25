---
Title: "Writing command-line verbs for an app"
Slug: "app-verbs"
Short: "Give an app its own CLI commands: the slop.verbs manifest block, __verb__ and its fields, the slop module, output, testing and pushing."
Topics:
- app-verbs
- apps
- cli
- javascript
Commands:
- "on"
- app
- push
- store
- call
Flags:
- format
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: Tutorial
---
An app can ship its own command-line verbs: small JavaScript functions in its
tree that become commands under `slop on <store> …` (and under a short alias,
such as Pinboard's `slop pb <board> …`). Anyone who can view a store that
runs the app can use them; each verb runs **on their machine**, as them, and
reaches the store only through its actor's actions and its documents, with
their level. The same verbs are also served to MCP clients as tools.

This tutorial builds a small app, "Tally" (counters in SQL, items in
documents), gives it five verbs, deploys it and runs them. Every file and
every output below is real. You need a login with permission to push apps
(an admin: see `slop help deploying-apps`).

## What a verb is

A verb is a JavaScript **function** in a file the manifest includes, marked
with `__verb__(functionName, {…})`. The CLI downloads the app's verb files
from the server, turns each marked function into a command (its parameters
become flags or positional arguments), and runs the function in a sandboxed
JavaScript runtime inside the CLI. The function's only way out is
`require("slop")`, scoped to the one store the command was run on.

Verbs are for what a person or an agent does from a shell: list, add, query,
ask. The logic that must be trusted lives in the actor (`slop help actors`);
a verb is a thin client that calls actions and formats the result.

## Step 1: the app and its actor

Make a folder `tally/` with four files.

`tally/app.json`:

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
    "user": { "scopes": ["profile"] }
  },
  "slop": { "verbs": { "alias": "ty", "include": ["verbs/*.js"], "title": "meta/info" } }
}
```

`tally/sql/001_hits.sql`:

```sql
CREATE TABLE hits(
  name TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  by TEXT,
  at INTEGER
);
```

`tally/actor.js`:

```js
const db = use('db'), sql = use('sql');

defineActor({
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
    items: {
      requires: 'view',
      run(ctx, args) {
        const q = db.collection('items').orderBy('at', 'desc').limit(Number((args && args.limit) || 20));
        return q.get().docs.map(d => Object.assign({ id: d.id }, d.data()));
      },
    },
  },
});
```

`tally/verbs/tally.js` comes in step 3.

## Step 2: the manifest block

`"slop": {"verbs": {…}}` in `app.json` turns verbs on for the app.

| Field | Required | What it does |
| --- | --- | --- |
| `include` | yes | 1 to 16 globs (relative to the tree, `**` allowed) of the files the CLI downloads: the verb files and also every file they `require` (both must match). Only functions marked with `__verb__` become commands; other files are libraries. At most 200 files and 2 MiB. |
| `alias` | no | A short top-level command: `slop ty <store> …` as well as `slop on <store> …`. A lowercase word of at most 16 letters, digits or `-`. An alias that is a built-in command (`app`, `store`, `on`…) is never added: use `slop on`. Without an alias the verbs work only through `slop on`, and are not offered as MCP tools. |
| `title` | no | A **document path** in each store (here `meta/info`) whose `"title"` field names that store. The CLI shows it in help (`tally's verbs on Pantry (t1)`), and lets people write the title instead of the id with the alias: `slop ty Pantry …` finds, among *their* stores of the app's `type`, the one titled `Pantry` (case-insensitive). Pinboard uses `board/meta`. |

Title lookup looks only at your stores of the app's `type` (without a type,
at all your stores, reading each one's title document), so give the app a
`type` and create its stores with it (`slop store new t1 --app tally --type
tally`; a mount with `--createApp` sets it for you). Two of your stores with
the same title make the lookup fail with both ids: use the id.

## Step 3: the verbs file

`tally/verbs/tally.js`:

```js
// Tally's command-line verbs: slop ty <tally> <verb> (or slop on <store> <verb>).
// Each runs on your machine and reaches the store only through require("slop").

doc`---
verb: addCounter
---
Adds to a counter (made at 0 if new). The name is positional:
slop ty <tally> counter add coffee --by 2`;

function addCounter(name, by) {
  return require("slop").board().call("count", { name, by });
}
__verb__("addCounter", {
  name: "add",
  parents: ["counter"],
  short: "Add to a counter",
  fields: {
    name: { argument: true, help: "The counter" },
    by: { type: "int", default: 1, help: "How much to add" },
  },
});

function totals() {
  return require("slop").board().call("totals", {});
}
__verb__("totals", { name: "ls", parents: ["counter"], short: "Every counter, largest first" });

function add(text, tags) {
  return require("slop").board().call("add", { text, tags });
}
__verb__("add", {
  parents: ["item"],
  short: "Add an item",
  fields: {
    text: { argument: true, help: "The item's text" },
    tags: { type: "stringList", help: "Tags (repeat or comma-separate)" },
  },
});

function ls(limit) {
  return require("slop").board().call("items", { limit });
}
__verb__("ls", {
  parents: ["item"],
  short: "List items, newest first",
  fields: { limit: { type: "int", default: 20, help: "At most this many" } },
});

// output: "text" prints the returned string as is (no --format, no rows).
function summary(style) {
  const b = require("slop").board();
  const rows = b.call("totals", {});
  const meta = b.docs.get("meta/info");
  const lines = rows.map(r => style === "short" ? r.name + "=" + r.n : r.name.padEnd(12) + String(r.n).padStart(5));
  return (meta.body.title || b.id) + " (" + b.id + ", via " + b.via + ")\n" + lines.join("\n") + "\n";
}
__verb__("summary", {
  parents: ["report"],
  short: "A plain-text summary",
  output: "text",
  fields: { style: { type: "choice", choices: ["long", "short"], default: "long", help: "Layout" } },
});

function me() {
  const b = require("slop").board();
  const w = b.me();
  return { id: b.id, title: b.title, type: b.type, app: b.app, via: b.via, person: w.person && w.person.email };
}
__verb__("me", { parents: ["report"], short: "Who and where this verb runs" });
```

### `__verb__(functionName, options)`

The first argument is the **name of a function declared in the same file**
(`function addCounter(…) {…}`), not the command's name; a name that matches no
function breaks every verb of the app (`verbs/tally.js references unknown
function "docs"`). The scanner reads the file without running it, so the
options must be a literal object.

| Option | Meaning |
| --- | --- |
| `name` | The command word (default: the function's name). Lets two groups each have an `add`. |
| `parents` | The command path above it: `["counter"]` makes `counter add`. Without it (or with `[]`) the verb is placed under its file's name inside the verbs folder: `verbs/tally.js` puts `count` at `tally count`, and `verbs/index.js` puts it **at the top**: `slop ty <store> count`. That is the only way to a top-level verb. |
| `short` | One line for the command list. |
| `long` | The help text (or use a `doc` block, below). |
| `output` | `"glaze"` (default): the result is rows, printed by `--format`. `"text"`: the result is printed as a string, and the command has no `--format`. |
| `fields` | The function's parameters, by name (below). |

### Fields

Each **parameter of the function** is filled from the field of the same name.
A parameter without a field entry becomes a string flag. A field's flag is
the parameter name in kebab case (`orderBy` → `--order-by`).

| Field option | Meaning |
| --- | --- |
| `type` | `string` (default), `bool`, `int`, `float`, `stringList`, `intList`, `floatList`, `choice`, `choiceList`, `date`. File-reading types (`file`, `stringFromFile`, `objectFromFile`, `keyValue`…) are refused: `--path is a file field, which reads files; app verbs take plain values`. |
| `argument: true` | Positional instead of a flag, in declaration order. Required unless it has a `default` (usage then shows `[b (default: dflt)]`). |
| `default` | The value when not given. |
| `help` | The flag's help text. |
| `choices` | For `choice` and `choiceList`. |
| `required: true` | A flag that must be given (`required field(s) missing: name`). |
| `short` | A one-letter flag shorthand (`short: "N"` gives `-N`). |

List flags take repeats or commas: `--tags a --tags b` and `--tags a,b`
are the same.

### `doc` blocks

A tagged template ``doc`…` `` with front matter `verb: <functionName>` sets
the long help of that function's command (shown by `--help`):

```js
doc`---
verb: addCounter
---
Adds to a counter (made at 0 if new). The name is positional:
slop ty <tally> counter add coffee --by 2`;
```

## The slop module

`require("slop")` is the verb's only connection to the server. Every call is
a server verb made with your token, so the store's rules and your level apply
exactly as in the page.

| API | What it does |
| --- | --- |
| `.board()` | The store the command was run on. `.board(idOrTitle)` checks that it is that store, and throws `this command runs on <store> only` otherwise: a verb reaches no other store. |
| `b.id`, `b.title`, `b.type`, `b.app` | The store's id, title (from the `title` document), type and app. |
| `b.via` | How the verb was reached: `cli`, `mcp` or `verb`. Pass it to actions that log where a change came from (Pinboard does). |
| `b.call(action, args)` | Calls an action of the store's actor (`actor.call`) and returns its result. Synchronous. |
| `b.docs.get(path)` | A document: `{path, body, version, rev, at, by}`. |
| `b.docs.query(coll, q)` | Documents of a collection, as a list of the same shape. |
| `b.docs.set(path, data, {ifVersion})`, `b.docs.update(path, data)`, `b.docs.rm(path)` | Writes, checked against the app's `db` rules at your level. |
| `b.meta()` | The store's metadata (`store.meta`). |
| `b.me()` | Who you are (`whoami`): `{person, scopes, …}`. |

A server refusal throws an `Error` with `.code` and `.message`; catch it to
handle it, or let it escape and the CLI prints `error: <code>: <message>`
and exits 1. A verb may throw its own: `const e = new Error("nope"); e.code =
"permission_denied"; throw e` prints `error: permission_denied: nope`.
`console.log(...)` writes to stderr (objects as JSON). A verb may be `async`;
its promise must settle before it returns.

## What verbs cannot do

- No file system, process, network or timers: `require("fs")`, `"path"`,
  `"os"`, `"http"`, `"child_process"` fail with `Invalid module`; `fetch`,
  `process`, `setTimeout`, `Buffer` are undefined.
- No other store: `board()` is the one store on the command line.
- No file-reading flag types (above).
- `require` reaches only files matched by `include` (a relative path such as
  `require("./util.js")`); a file outside it fails with `Invalid module`.
- The language is the same goja dialect as actors (`slop help actors`, "The
  JavaScript dialect"): no `import`, no async generators.

## Step 4: deploy and run

```sh
$ slop store new tally
$ slop push ./tally --store tally
$ slop store new t1 --app tally --type tally
```

On a machine that has never run this app's verbs, the alias does not exist
yet. One `slop on` teaches it:

```sh
$ slop ty t1 counter ls
error: unknown command "ty" for "slop"
$ slop on t1 --help
tally's verbs on Untitled tally (t1)

Usage:
  slop on t1 [command]

Available Commands:
  counter     All commands for counter
  item        All commands for item
  report      All commands for report
$ slop ty t1 counter add --help
Adds to a counter (made at 0 if new). The name is positional:
slop ty <tally> counter add coffee --by 2

Usage:
  slop ty t1 counter add <name> [flags]

Flags:
      --by int                  How much to add - <int> (default 1)
      --format string           Structured output format - <choice> (table,json,jsonl,csv,tsv,yaml) (default "table")
  …
```

Run them:

```sh
$ slop ty t1 counter add coffee --by 2
+---+--------+
| n | name   |
+---+--------+
| 2 | coffee |
+---+--------+
$ slop ty t1 counter add tea
$ slop ty t1 item add "Buy beans" --tags shop,coffee
+-----------+
| id        |
+-----------+
| imwvconcu |
+-----------+
$ slop ty t1 item ls --format json
[
{
  "at": 1795564401726,
  "by": "Admin",
  "id": "imwvconcu",
  "tags": ["shop", "coffee"],
  "text": "Buy beans"
}
]
$ slop ty t1 report summary --style short
Untitled tally (t1, via cli)
coffee=2
tea=1
$ slop ty t1 report summary --style bogus
error: Argument style has invalid choice bogus
$ slop ty t1 counter add
error: accepts between 1 and 1 arg(s), received 0
```

Name the store by its title once it has one:

```sh
$ slop docs update t1 meta/info --data '{"title":"Pantry"}'
$ slop ty pantry counter ls --format csv
at,n,name
1795564397241,2,coffee
1795564433295,1,tea
```

## How output is rendered

- **Rows** (`output: "glaze"`, the default). The CLI turns the return value
  into rows: an array gives one row per element, an object one row, a plain
  value one row with a `value` column. `--format table|json|jsonl|csv|tsv|yaml`
  chooses the form, `--output-fields a,b` the columns. An empty array prints
  nothing. `-o json` and `--output json` are read as `--format json`, as on
  the rest of the CLI (unless the verb has its own `output` field).
- **Text** (`output: "text"`). The returned string is printed as is, and
  there is no `--format` flag (`unknown flag: --format`). Use it for answers
  meant to be read, such as Pinboard's `board ask` and `board describe`.
  End the string with `"\n"` yourself.

Agents should prefer row verbs with `--format json`; text verbs are for
people.

## Testing a verb

There is no local runner: a verb runs against a store on a server. The loop:

1. Edit the files and `slop push ./tally --store tally` (or run `slop dev`
   on the folder; see `slop help deploying-apps`).
2. Run the verb: `slop on t1 <words> …`. The CLI sees the new snapshot on the
   next command (the store follows `main`), downloads the verbs again and
   caches them per snapshot; nothing to clear.
3. Check the action alone with `slop call t1 count '{"name":"x"}'` when a
   verb misbehaves: if the action is wrong, the verb is not to blame.
4. `slop app verb t1 "counter add" --values '{"name":"x","by":2}'` runs the
   verb **on the server** with JSON values (what MCP clients do); its keys
   are the flag names (`"order-by"`, not `"orderBy"`).

A syntax error or a bad `__verb__` in any included file breaks every verb of
the app, with the file and the reason: run `slop on <store> --help` after
each push.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `unknown command "ty" for "slop"` | No store after the alias, or the store's app has another alias (the error then names it) | `slop ty <store> …`; `slop on <store> …`; see `slop help using-app-verbs` |
| `<store> runs <app>, which ships no command-line verbs` | No `slop.verbs` in the running snapshot's `app.json` | Add the block, push, and check `slop app status <store>` shows the new snapshot |
| Verbs appear under the file's name (`tally count`) | `parents` was not given, so the file names the group | Give `parents: ["group"]`, or move the verbs to `verbs/index.js` to put them at the top |
| A verb you want at the top (`slop ty <store> add`) is under a group | Only `verbs/index.js` without `parents` reaches the top level | Move it to `verbs/index.js` and drop `parents` |
| `references unknown function "x"` | `__verb__`'s first argument is not a function declared in the file | Use the function's name; set the command word with `name:` |
| `unknown flag: --x` | The flag name differs (kebab case), or the field is positional | `slop on <store> <words> --help` |
| `accepts between 1 and 1 arg(s), received 0` | A positional argument is missing | Give it, or give the field a `default` |
| `unknown flag: --format` | The verb has `output: "text"` | It prints text only |
| `Invalid module` | `require` of a Node module or a file outside `include` | Verbs have only `slop`; add shared files to `include` |
| `this command runs on <store> only` | `board()` was given another store | A verb works on the store on its command line only |
| `is a file field, which reads files` | A file-reading field type | Take the content as a string flag |
| `permission_denied: <action> needs interact; you have view` | Your level on the store | `slop explain can <store> interact`; ask for a grant |

## See Also

- `slop help using-app-verbs` — running any app's verbs: discovery, aliases, the cache
- `slop help actors` — the actions verbs call
- `slop help app-manifest` — every `app.json` field
- `slop help pinboard` — a complete app with verbs (`slop pb <board> …`)
- `slop help deploying-apps` — store, push, `slop dev`
