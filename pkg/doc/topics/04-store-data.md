---
Title: "Working with a store's data: documents, files, snapshots, tables, the log"
Slug: "store-data"
Short: "The CLI verbs for what a store holds: stores, documents (docs), files and the tree (files, push, pull), snapshots and refs, SQL tables, the log and log wait, alarms, secrets, import and export."
Topics:
- data
- stores
- cli
Commands:
- store
- docs
- files
- push
- pull
- snap
- ref
- app
- sql
- log
- alarm
- secret
- import
Flags:
- data
- ifVersion
- where
- orderBy
- desc
- limit
- at
- zone
- ifAt
- after
- timeout
- write
- args
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
A **store** holds five kinds of data, each with its own verbs: **documents**
(JSON at paths), **files** (a versioned tree, plus runtime assets),
**snapshots and refs** of the tree, **SQL tables** made by an app's
migrations, and a **log** of every commit. Alarms and secrets belong to the
app a store runs. This page shows each from the CLI, with output from a real
local server (trimmed). For who may do what, see `slop help access-control`;
for the command-line grammar, `slop help cli-reference-guide`.

Every write is a **commit** with a number, the store's **rev**, which rises
by one per commit and appears in each answer (`rev: 12`). The log lists
commits by rev, so "what changed since rev 11" is one call.

## Stores

A store has an id (lowercase letters, digits and dashes, starting with a
letter or digit), an owner (whoever made it), an optional **type**, and an
optional **app** it runs.

```bash
$ slop store new notes
createdAt: 1795564112513
id: notes
madeBy: usr_968742abdb3c7862154e0636
owner: usr_968742abdb3c7862154e0636
$ slop store new kitchen --app shelf        # a store that runs the app store "shelf"
$ slop store ls -o table                    # yours and those you hold a grant on; admins: --all
$ slop store meta notes                     # head rev, collections, refs, your level
audience: admin
collections:
    items: 2
    tasks: 3
docs: 5
head: 18
level: owner
…
$ slop store rm notes2
deleted: notes2
```

- `store new` without an id makes `s-xxxxxxxx`. An id that is taken answers
  `conflict: store notes exists`.
- `store new --app X` does not check that `X` is an app yet; a store whose
  app is missing fails later (`slop app status` answers an error).
- `store rm` deletes the store with its documents, files and grants, at
  once, with no confirmation. Owners and admins only.
- `store type <id> <type>` (admins) sets the type that typed mounts select
  on (see `deploying-apps`).

## Documents (`slop docs`)

`slop docs` is the **document** verbs, not documentation. A document is a
JSON object at a path of segments, `collection/id`, and may have
subcollections: `tasks/t1`, `tasks/t1/notes/n1`. A path with an odd number of
segments is a collection, not a document (`invalid document path "tasks"`).
Each document has a `version` that rises on every write.

```bash
$ slop docs set notes tasks/t1 --data '{"title":"buy milk","done":false,"n":3}'
count: 1
rev: 2
versions:
    tasks/t1: 1
$ slop docs get notes tasks/t1
at: 1795564118342
body:
    done: false
    "n": 3
    title: buy milk
by: usr_968742abdb3c7862154e0636
path: tasks/t1
rev: 2
version: 1
$ slop docs update notes tasks/t1 --data '{"done":true,"tags":{"a":1}}'   # deep merge
$ slop docs ls notes tasks -o table
$ slop docs rm notes tasks/t2
```

| Verb | Positional | What |
| --- | --- | --- |
| `docs get` | `<store> <path>` | One document: `body`, `version`, `rev`, `at`, `by` |
| `docs ls` | `<store> <coll>` | A collection's documents (`--limit`) |
| `docs query` | `<store> <coll>` | Filtered and ordered: `--where`, `--orderBy`, `--desc`, `--limit` |
| `docs set` | `<store> [path]` | Replace whole documents: `--data '{…}'`, or `--batch '[{path, data, ifVersion?}]'` |
| `docs update` | `<store> [path]` | Deep-merge `--data` into documents (creating them); or `--batch` |
| `docs rm` | `<store> [path]` | Delete a document, or `--paths '["a/1","a/2"]'` |

Rules and limits:

- `--data` must be a JSON object; a body is at most 256 KiB and 32 levels
  deep.
- A batch is one commit, all or nothing, at most 500 documents.
- **Optimistic writes:** `--ifVersion n` writes only if the document is at
  version `n`; otherwise
  `conflict: conflict: tasks/t1 is at version 2, not 1`, and nothing is written.
- `--where` is a JSON list of `[field, op, value]` (or `{field, op, value}`)
  conditions that must all hold. Ops: `==`, `!=`, `<`, `<=`, `>`, `>=`,
  `array-contains`, `in`, `not-in` (a list of 1–30 values). At most 10
  conditions; fields are top-level (no `a.b`), and `--orderBy` takes a
  top-level field. A query that breaks these answers
  `invalid_argument: invalid query`.
- `<`, `<=`, `>`, `>=` compare values of the same kind only: numbers as
  numbers, strings byte by byte. A value of another kind, or a missing field,
  never matches. There is no date type and no "today": store dates as ISO
  strings (`"2026-11-24"`), which order correctly as strings, and put the
  date in the query (`[["due","<","2026-11-24"]]`).
- `--limit` is at most 1000.
- Who may read and write each path is decided by the app's document rules;
  see `access-control`.

```bash
$ slop docs query notes tasks --where '[["n",">",4]]' -o table
AT             BODY                                      BY                            PATH      REV  VERSION
1795564118374  {"done":true,"n":5,"title":"write docs"}  usr_968742abdb3c7862154e0636  tasks/t2  3    1
$ slop docs query notes tasks --json '{"orderBy":"n","desc":true,"limit":1}'
```

## Files and the tree

A store's files live in two **zones**:

- **tree**: the app's code and published files. It is versioned: a working
  tree, plus **snapshots** of it.
- **assets**: files a running app uploads at runtime (images, attachments).
  Not snapshotted.

The usual way to change the tree is a whole folder at once, with `push`, which
makes a snapshot and moves a ref (default `main`). Only the bytes the server
lacks are sent; files the folder does not have are deleted from the ref's tree.

```bash
$ slop push site --store notes -m "first"     # --store defaults to the folder's name
files: 2
"n": 1
removed: 0
rev: 9
$ slop pull notes out                         # write main's tree into ./out (--at <n|ref>; --at '' is the working tree)
dir: out
written: 2
```

- `push` needs an existing store (`not_found: no store journal` otherwise);
  make it with `store new` first.
- `push` applies only if the ref has not moved since it was read; `--ifAt n`
  says where you expect it (0: the ref does not exist yet). A ref that moved
  answers `conflict`, and nothing is written.
- A tree that contains `app.json` is app code: only admins push it (see
  `access-control`).

Single files and inspection:

```bash
$ slop files ls notes -o table                  # the working tree; [prefix] narrows it
PATH        REV  SHA256          SIZE  TYPE                      ZONE
data.csv    9    5be08c96…       4     text/csv; charset=utf-8   tree
index.html  9    186ea20d…       15    text/html; charset=utf-8  tree
$ slop files ls notes --at main                 # a snapshot: --at 3, or a ref
$ slop files ls notes --zone assets
$ slop files cat notes index.html               # raw bytes to stdout (--at, --zone)
<h1>hello</h1>
$ slop files put notes readme.txt --text 'hi'   # or --data <base64>; --zone assets
$ slop files rm notes readme.txt                # a file, or everything under a path
```

`files put` and `files rm` on the tree change the **working tree**; pages
and actors run a snapshot, so the change shows after the next snapshot.
To change a few files and snapshot in one step, use `files commit`:

```bash
$ slop files commit notes --base 1 --message c2 \
    --changes '[{"path":"hello.txt","text":"hi"},{"path":"data.csv","delete":true}]'
at: 1
base: 1
merged: false
"n": 2
rev: 14
```

`--base` (required) is the snapshot your changes start from (0: the ref does
not exist yet). If the ref moved since, the changes are applied on top unless
someone changed the same path differently: then `conflict` and nothing is
written. Files not listed stay as they are. (`files commit` has no `-m`
shorthand; use `--message`.) For other read formats call the verb directly:
`slop verb files.cat --json '{"store":"notes","path":"data.csv","as":"csv"}'`
(`as`: `text`, `base64`, `json`, `csv` rows, `lines`).

## Snapshots and refs

A **snapshot** is the tree frozen at a point, numbered 1, 2, 3… per store. A
**ref** is a name pointing at one (`main`, `draft`, `proposal/x1`: lowercase,
starting with a letter). A store that runs an app runs the snapshot its
followed ref points at (default `main`).

```bash
$ slop push journal --ref draft -m v2
$ slop snap ls journal -o table
AT             BY                            MESSAGE  N  REV  TREE
1795564217539  usr_968742abdb3c7862154e0636  v2       2  4    d141e558…
1795564195470  usr_968742abdb3c7862154e0636  v1       1  2    6afc3b21…
$ slop ref ls journal
draft: 2
main: 1
$ slop ref move journal main 2          # publish: reads where main is, then moves it
main: 1 → 2
$ slop ref move journal main 1 --ifAt 1
error: conflict: main points at 2, not 1: it moved since you looked
$ slop ref rm journal draft --ifAt 2
```

- `ref move <store> <ref> <n>` moves (or creates) a ref; moving `main` back
  is a rollback. Without `--ifAt` the CLI reads the ref first and prints
  `main: 1 → 2` on stderr.
- `ref rm` needs `--ifAt` (where it points now). `main` cannot be removed,
  nor a ref some store follows:
  `conflict: myjournal follows journal@draft: make it follow another ref first (app.follow)`.
- Removing a ref keeps its snapshots.

A store that runs an app follows one of the app's refs:

```bash
$ slop app follow myjournal draft       # admins; run the draft's code on this store
$ slop app status myjournal             # app, snapshot n, ref, manifest, broken: why it does not run
$ slop app follow myjournal main
```

`app status`, `app logs <store>` (the actor's recent `console.log`) and
`app restart <store>` are the first things to run when an app misbehaves;
see `slop help deploying-apps`.

## SQL tables

An app's migrations (`.sql` files in its tree) create **tables** in every
store that runs it. Admins can inspect and change them; apps reach them
through their actor.

```bash
$ slop sql schema myjournal                 # tables, indexes, views, triggers
- name: posts
  sql: |-
    CREATE TABLE posts(
      id TEXT PRIMARY KEY,
      …
  type: table
$ slop sql query myjournal 'SELECT id, title, status FROM posts' -o table
ID              STATUS  TITLE
p_mwvckc6p5x3z  draft   Hello
p_mwvckc7hwo6t  draft   Two
$ slop sql query myjournal 'SELECT title FROM posts WHERE status = ?' --args '["published"]'
$ slop sql exec myjournal "UPDATE posts SET status='published' WHERE title='Two'" --write
rev: 7
rowsAffected: 1
```

- The SQL is positional (`<store> <sql>`); parameters go in `--args` as a
  JSON list for the `?` placeholders.
- `sql query` is read-only. `sql exec` without `--write` refuses
  writes too; both answer `invalid_argument: not authorized` for a statement
  they do not allow.
- `sql query` and `sql exec` are admin-only; `sql schema` needs the `admin`
  level on the store.
- A write through `sql exec` is a commit like any other (it has a rev).

## The log

Every commit is in the store's log: rev, time, who (`principal`), how
(`via`: `cli:tok_…`, `activate`, `page`, …), and what changed.

```bash
$ slop log show notes --limit 3 -o table
AT             CHANGES                                                     PRINCIPAL                     REV  SUMMARY                  VIA
1795564141239  [{"key":"tree:readme.txt","kind":"file","op":"put"}]        usr_968742abdb3c7862154e0636  11   put file tree:readme.txt cli:tok_5e7c…
1795564141051  [{"key":"app_version","kind":"meta","op":"set"}]            system                        10   activated notes@1        activate
1795564141050  [{"key":"tree:data.csv","kind":"file","op":"put"},{"key"…   usr_968742abdb3c7862154e0636  9    2 file, 1 snapshot, 1 ref cli:tok_5e7c…
$ slop log show notes --after 10            # commits after rev 10, oldest first
```

Without `--after` you get the newest commits (newest first); with it, the
commits after that rev, oldest first. `--limit` defaults to 50.

**Waiting for changes.** `log wait` is a long poll: it returns as soon as
there is a commit after `--after` (required), or an empty list after
`--timeout` seconds (default 55, at most 300).

```bash
$ slop log wait notes --after 11 --timeout 10      # a write landed 2 s later
- changes:
    - key: tasks/t5
      kind: doc
      op: set
      version: 1
  rev: 12
  summary: set doc tasks/t5
…
$ slop log wait notes --after 12 --timeout 2       # nothing happened
[]
```

To follow a store, loop: remember the highest `rev` you saw and call
`log wait --after <rev>` again. `slop log system` (admins) is the platform's
own log: sign-ups, roles, tokens, grants, mounts, policy.

## Alarms

Alarms are an app's timers, declared in its actor (`every: { digest: {every:
'1h', run(ctx){…}} }`); each store that runs the app has its own. They are
at-least-once: one missed while the server was down runs late.

```bash
$ slop alarm ls myjournal -o json
[ { "name": "digest", "every": "1h", "at": 1795567795500, "running": 0 } ]
$ slop alarm fire myjournal digest           # run it now
fired: digest
```

`at` is when it next fires (milliseconds since the epoch). Both verbs need
the `admin` level on the store. See `slop help actors`.

## Secrets

Secrets belong to an **app** (the app store), are encrypted at rest, and are
never shown back. An actor reads one only if `app.json` lists it under
`slop.secrets` and the `secrets` policy cell allows. Admins only.

```bash
$ slop secret set journal APIKEY s3cret
app: journal
length: "6"
name: APIKEY
$ slop secret ls journal
- changedAt: 1795564211210
  changedBy: usr_968742abdb3c7862154e0636
  name: APIKEY
$ slop secret rm journal APIKEY
```

## Import and export

```bash
$ slop import docs rows.csv --store notes --coll items --id id     # CSV, JSONL or a JSON array
imported: 2
revs: [16]
$ slop import table posts.jsonl --store myjournal --table posts    # rows into an existing table
$ slop import files ./pics --store notes --zone assets             # add files, no pruning, no snapshot
$ slop store export notes --folder exp                             # the folder format
$ slop import folder exp --store notes2                            # a new store from it
docs: 3
files: 2
store: notes2
tables: 0
```

- `import docs` makes one commit per 500 records; `--id` names the field
  used as document id (default: generated); in CSV, `true` and `false`
  become booleans and integers and decimals become numbers, unless `--raw`.
  Every other value stays a string (`yes`, `no`, `2026-11-24`). The format comes from the extension, or
  `--format csv|jsonl|json`.
- `import table` needs the table to exist (from a migration).
- `store export --folder` writes `store.json`, `docs.jsonl`, `schema.sql`,
  and `tree/`, `assets/`, `tables/` for whichever the store has: its
  **current** state. Snapshot
  history, refs and grants are not exported; `import folder` makes one
  snapshot named `import` on `main`. Without `--folder`, `store export`
  prints the whole bundle (with file bytes).

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `not_found: no store X` from `push` | `push` does not create stores | `slop store new X` first |
| `invalid_argument: invalid document path "tasks"` | A collection path where a document is needed | Use `coll/id` |
| `conflict: … is at version 2, not 1` | `--ifVersion` did not match | Re-read with `docs get`, retry with the new version |
| `invalid_argument: invalid query` | A dotted field, a bad op, more than 10 conditions, `in` with 0 or more than 30 values, or `--limit` over 1000 | Fix the `--where` JSON |
| `conflict: main points at 2, not 1` | The ref moved since you read it | `slop ref ls`, then move with the right `--ifAt` |
| `conflict: X follows Y@draft …` from `ref rm` | A store follows that ref | `slop app follow X main` first |
| `invalid_argument: not authorized` from `sql` | A write without `--write`, or through `sql query` | `slop sql exec … --write` |
| `unknown shorthand flag: 'm'` on `files commit` | Only `push` has `-m` | `--message` |
| A `files put` does not show on the page | Pages run a snapshot, not the working tree | `slop push`, or `files commit` |
| `permission_denied: only admins change app code …` | The tree has `app.json` | An admin pushes it |
| `log wait` returns `[]` | Nothing was committed within `--timeout` | Call it again with the same `--after` |

## See Also

- `slop help access-control` — who may read and write what
- `slop help cli-reference-guide` — arguments, `--json`, `eval` for many calls at once
- `slop help deploying-apps` — push, refs, follow, draft and publish, `slop dev`
- `slop help capability-db` — the same documents from a page
- `slop help actors` — tables, alarms and secrets from an actor
