---
Title: "The db capability: documents, rules and live queries"
Slug: "capability-db"
Short: "A page's realtime JSON documents: paths, read and write rules, {self}, other stores, the full API with return shapes, limits, errors, and seeding from the CLI."
Topics:
- apps
- pages
- capabilities
- db
- documents
Commands:
- docs
- explain
- bind
- policy
- push
Flags:
- where
- orderBy
- desc
- batch
- ifVersion
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
`db` gives a page the store's **documents**: JSON objects at paths like
`tasks/t1`, readable and writable from the page, live across every open
view, and the same documents the actor (`use('db')`) and the CLI
(`slop docs …`) see. Use it for anything shared or durable: lists, settings,
votes, per-person data. Files go in `assets` (with their id in a document);
browser storage is only for one viewer's conveniences.

This page covers the declaration and rules (who may read and write what),
the API with exact return shapes, the limits, the error codes, and how to
seed and inspect the same documents from the command line.

## Declaring it

In `app.json`:

```json
{
  "capabilities": {
    "db": {
      "rules": [
        { "path": "board", "read": "view", "write": "admin" },
        { "path": "votes", "read": "view", "write": "owner" },
        { "path": "votes/{self}", "write": "interact" }
      ],
      "stores": "view"
    },
    "user": {}
  }
}
```

- `"db": {}` (or `true`) is enough: everyone admitted to the store reads,
  `interact` and above write.
- `rules` (optional, at most 64) sets levels per path; see below.
- `stores` (optional: `view`, `interact` or `admin`) asks to reach other
  stores under `_stores/<id>/…`; it also needs an admin to turn on the
  `stores` policy cell. See "Other stores".
- Declare `user` too when the page needs the viewer's id (per-person paths).

`claude.use("db")` is granted whenever the app declares it; what a viewer
may do is then decided per path.

## Paths

- A **document** path has an even number of segments: `tasks/t1`,
  `boards/b1/columns/c2`. A **collection** path has an odd number: `tasks`,
  `boards/b1/columns`.
- Segments use letters, digits and `_ - . ~ : @ +`; at most 200 bytes per
  segment, 1,000 bytes and 16 segments per path. `.` and `..` are refused.
- `db.doc()` and `db.collection()` throw a `TypeError` at once on a bad
  path (`notes has 1 segments: a document path has an even number`). That is
  a bug in the page, not a store condition.
- A top-level name beginning with `_` belongs to the platform. Using one
  rejects `invalid_argument` (`_x is reserved: top-level names beginning with
  _ are the platform's`), except `_stores` and `_people` when the app may
  reach them.
- Collections need no creating. Deleting a document leaves the documents
  nested under it.

## Levels and rules

A viewer holds one **level** on the store (`view` < `interact` < `admin` <
`owner`), from the store's grants, share links and audience groups (see
`slop help access-control`). Rules say which level a path needs:

- A rule sets the minimum level to `read` and to `write` at a path and
  everything below it. A deeper rule overrides a shallower one; a level a
  rule leaves out is inherited. The root defaults to `read: "view"`,
  `write: "interact"`. Write is never below read.
- `{self}` as the last segment matches the viewer's own id (`usr_…`, or
  `vis_…` for a guest): `votes/{self}` is `votes/<my id>`. It may only be
  the last segment.
- A rule at the prefix of a `{self}` rule must set both `read` and `write`,
  or the push fails (`the rule at "votes" must set both read and write`).
- The level `self` is one nobody holds: `{"path": "log", "read": "view",
  "write": "self"}` makes `log` read-only to every page and CLI user, even
  the owner. The actor still writes it (an actor writes its own store
  without rules), so this is the way to say "only through an action".
- `data/users/<id>/…` is private to that person: everyone else, the owner
  included, finds nothing there and cannot write it. Use
  `db.doc("data/users/" + uid + "/prefs")` with `uid` from `user.id()`.
- The owner meets every level except `self`, and never sees others'
  `data/users/` subtrees.

**Reads never fail on permission.** A document the viewer may not read
behaves exactly like a missing one (`exists: false`, left out of queries).
A write below the viewer's level rejects `invalid_argument` (`this viewer
cannot write "notes/g"`). To decide up front, use the `user` capability:
`await user.can("data.write")` (may the viewer write shared documents at the
root), `user.canEdit()` (admin or owner), `user.isOwner()`.

The CLI obeys the same rules, so you can check a decision without a
browser:

```bash
slop explain can poll --path votes/usr_someone --op write --subject anonymous
# ok: false  need: owner   trace: … 'rule votes/usr_someone: write needs owner'
```

## Other stores in the same path space

A page sees its own store at the root. Two ways reach other stores:

- **An alias with a prefix.** The store's owner maps a top-level name of
  the page to a collection of another store:
  `slop bind set <store> contacts crm --prefix contacts --level interact`.
  The page then reads and writes `contacts/c1`, which is `contacts/c1` in
  `crm`, at the lower of the viewer's level in `crm` and `--level` (default
  `view`), under `crm`'s rules. The page code does not change.
- **`_stores/<id>/<path>`.** With `"stores": "view"` (or higher) in the
  manifest and `slop policy set <app> stores @member on`, a page reads any
  store the viewer may open: `_stores/crm/contacts/c1`. The manifest level
  is a ceiling: with `view`, even an owner's write there is refused.
  `_stores` (a collection) lists the stores, `_stores/<id>` is a store's
  registry row (`id`, `app`, `type`, `owner`, `level`, `createdAt`), and
  `_stores/<id>/_grants`, `/_bindings`, `/_llm` hold its grants, aliases and
  budget. `_people` lists people, for platform admins.

Another store's `data/users/…` documents are never reachable either way.

## API

```js
const db = await claude.use("db");    // null: not declared, or no shell
```

References are path holders: building one never touches the network; only
the calls do.

### db

| Call | Returns |
| --- | --- |
| `db.doc(path)` | a DocumentReference (throws `TypeError` on a bad path) |
| `db.collection(path)` | a CollectionReference (throws `TypeError` on a bad path) |

### DocumentReference

| Member | Resolves to | Behaviour |
| --- | --- | --- |
| `id`, `path` | strings | the last segment, the full path |
| `get()` | DocumentSnapshot | Read once. A missing or unreadable document is `exists: false`, not an error |
| `set(data)` | `undefined` | Replace the whole document, creating it if absent |
| `update(data)` | `undefined` | Merge into an existing document: nested objects merge, arrays and scalars replace. Rejects `invalid_argument` (`update needs an existing document at "…"`) when it does not exist |
| `delete()` | `undefined` | Idempotent; nested documents survive |
| `onSnapshot(next, error?)` | an unsubscribe function | `next(DocumentSnapshot)` now and on every change |
| `acquire({holder, ttlMs?, data?})` | `{acquired: true, holder, expiresAt, version}` or `{acquired: false, expiresAt}` | A cooperative lease on this path, 1 s to 10 min (default 30 s); `expiresAt` is an RFC 3339 time. The same holder renews it. With `data`, merges `data` into the document (creating it). Coordinates callers that all use it; not a security boundary |
| `collection(sub)` | CollectionReference | `path + "/" + sub` |

### CollectionReference and queries

| Member | Returns | Behaviour |
| --- | --- | --- |
| `path` | string | |
| `doc(id?)` | DocumentReference | without `id`, a fresh 20-character random id |
| `add(data)` | Promise of the new DocumentReference | `doc().set(data)` |
| `where(field, op, value)` | a new query | `==` `!=` `<` `<=` `>` `>=` `in` `not-in` (1 to 30 values) `array-contains`; top-level fields only (no dots); at most 10; a document missing the field never matches; range operators compare values of the same type |
| `orderBy(field, dir?)` | a new query | one per query, `"asc"` (default) or `"desc"`; documents without the field sort last; without it, order is by document id |
| `limit(n)` | a new query | 1 to 1,000 |
| `get()` | QuerySnapshot | read the matched set once |
| `onSnapshot(next, error?)` | an unsubscribe function | the live matched set |

Queries scan the collection without indexes: keep a queried collection to
hundreds or low thousands of documents.

### Snapshots

- **DocumentSnapshot**: `id`, `exists`, `data()` (the body, or `undefined`),
  `metadata {fromCache, hasPendingWrites}`.
- **QuerySnapshot**: `docs` (DocumentSnapshots), `size`, `empty`,
  `docChanges()` (`[{type: "added"|"modified"|"removed", doc, oldIndex,
  newIndex}]`), `metadata`.
- Snapshots and their `data()` are frozen (`Object.isFrozen` is true): clone
  before editing (`structuredClone(d.data())`). An unchanged document is the
  same object across deliveries.

## Writes

- A body is a plain JSON object (not an array or a scalar at the top), at
  most 256 KiB serialized and 32 levels deep; anything else rejects
  `invalid_argument` before it leaves the page.
- Every write commits as its own turn in the store's log, attributed to the
  viewer, `via page`, with the app and snapshot. There are no transactions
  and no batch from a page: the last writer wins. To change several
  documents atomically, or to check before writing, call an actor action
  (`slop help capability-slop`); one action is one atomic commit.
- The page shows its own write at once: listeners get a snapshot with
  `hasPendingWrites: true`, then the confirmed one. Writes to the same
  document from one page are sent in order.
- Do not build counters from read-then-update across viewers; two viewers
  race. Store one document per person and count them, or do it in an
  action.
- Write on a user action or a real state change, never from render code or
  a snapshot callback.
- To claim a slot first-come (a seat, a name): `acquire` it with a short
  `ttlMs`, `get()` it, and `set` your claim only if it is unowned.

## Subscriptions

- `onSnapshot` delivers the current state soon after subscribing, then
  every change, from the page, the actor, other viewers and the CLI alike.
- At most 64 live subscriptions per view; the 65th ends at once with
  `resource_exhausted` on its `error` callback. Keep the unsubscribe
  function and call it when done.
- Subscribe once per document or query, not on every render; to sort or
  filter by fast-changing UI state, subscribe to the wider set and derive
  the view.
- Always pass the `error` callback. A subscription that ends calls it once
  with `{code, message}` and delivers nothing more. A dropped connection is
  not an end: the runtime reconnects (backing off up to 8 s) and catches up
  from where it was.

## Limits

| Limit | Value |
| --- | --- |
| Document body | 256 KiB serialized, 32 levels deep |
| Documents per store | 25,000 (`quota_exceeded`) |
| Path | 1,000 bytes, 16 segments, 200 bytes per segment |
| Rules in a manifest | 64 |
| `where` filters | 10; `in` / `not-in` take 1 to 30 values |
| `limit()` | 1 to 1,000 |
| Live subscriptions per view | 64 |
| Lease `ttlMs` | 1,000 to 600,000 ms (default 30,000) |

## Errors

Every rejection is `{code, message}`; treat unknown codes as `unavailable`.

| Code | Meaning | Page should |
| --- | --- | --- |
| `invalid_argument` | Bad path, body or query; a write below the viewer's level; `update` of a missing document; `_stores` not open to this app | Fix the call, or switch to read-only |
| `resource_exhausted` | More than 64 subscriptions | Unsubscribe what you no longer show |
| `quota_exceeded` | The store holds 25,000 documents | Tell the viewer; delete documents |
| `not_granted` | db is not available in this view (no shell, or not declared) | Render without db |
| `unavailable` | Transient | Retry once after a random delay; subscriptions recover by themselves |
| `revoked` | The view was closed | Render the degraded view |
| `confirmation_required`, `confirmation_declined` | Registry writes under `_stores` with `stores: "admin"` (grants, aliases, a store's type): the shell asks the person first; declining rejects `confirmation_declined` (not checked here) | Leave things as they are |

## From the command line: slop docs

`slop docs` is the group of verbs for these same documents (it is not
documentation). They act as you, at your level, under the same rules. The
store and the path or collection are positional.

```bash
# seed: one document, or several in one commit
slop docs set poll poll/meta --data '{"question":"Lunch?","options":["Pizza","Soup","Salad"]}'
slop docs set poll --batch '[{"path":"notes/a","data":{"text":"one"}},{"path":"notes/b","data":{"text":"two"}}]'
# count: 2
# rev: 23
# versions:
#     notes/a: 1
#     notes/b: 1

slop docs get poll poll/meta          # path, body, version, rev, by, at (commit time)
slop docs ls poll votes -o table      # a collection's documents
slop docs query poll votes --where '[["choice","==","Pizza"]]' --orderBy at --desc --limit 10
slop docs update poll notes/a --data '{"done":true}'   # deep merge; creates the document if missing
slop docs rm poll notes/a             # or --paths '["notes/a","notes/b"]' in one commit
slop docs set poll notes/a --data '{"text":"x"}' --ifVersion 5
# error: conflict: conflict: notes/a is at version 1, not 5
```

Differences from the page API: `docs update` creates a missing document;
`--batch` and `--paths` write several documents in one commit;
`--ifVersion` refuses a write when the document moved (`conflict`).
A page sees CLI writes live.

## Example: a poll

Everyone reads the question and the votes; only admins change the question;
each person writes only their own vote.

`app.json`:

```json
{
  "title": "Poll",
  "page": "index.html",
  "capabilities": {
    "db": { "rules": [
      { "path": "poll", "read": "view", "write": "admin" },
      { "path": "votes", "read": "view", "write": "owner" },
      { "path": "votes/{self}", "write": "interact" }
    ] },
    "user": {}
  }
}
```

`index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Poll</title></head>
<body>
<h1 id="q">…</h1><ul id="opts"></ul><p id="msg"></p>
<script>
const $ = (id) => document.getElementById(id);
(async () => {
  const db = await claude.use("db");
  const user = await claude.use("user");
  if (!db) { $("msg").textContent = "Open this page through its mount."; return; }
  const uid = await user.id();                        // usr_…, or vis_… for a guest
  const canVote = (await user.can("data.write")) && !!uid;
  let poll = { question: "", options: [] }, votes = [];

  function render() {
    $("q").textContent = poll.question || "No poll yet.";
    const mine = votes.find((v) => v.id === uid)?.data().choice;
    $("opts").replaceChildren(...poll.options.map((o) => {
      const n = votes.filter((v) => v.data().choice === o).length;
      const b = Object.assign(document.createElement("button"), { textContent: o + " (" + n + ")", disabled: !canVote });
      if (o === mine) b.style.fontWeight = "bold";
      b.onclick = () => db.doc("votes/" + uid).set({ choice: o, at: Date.now() })
        .catch((e) => { $("msg").textContent = e.code === "invalid_argument" ? "You cannot vote here." : "Not saved: " + e.code; });
      const li = document.createElement("li");
      li.append(b);
      return li;
    }));
  }
  const fail = (e) => { $("msg").textContent = "Stopped: " + e.code; };
  db.doc("poll/meta").onSnapshot((s) => { poll = s.exists ? s.data() : { question: "", options: [] }; render(); }, fail);
  db.collection("votes").onSnapshot((snap) => { votes = snap.docs; render(); }, fail);
})();
</script>
</body></html>
```

Deploy, seed and check:

```bash
slop store new poll
slop push ./poll --store poll -m "first"
slop mount set apps.example /poll poll
slop grant set poll @member interact
slop docs set poll poll/meta --data '{"question":"Lunch?","options":["Pizza","Soup","Salad"]}'
# after people vote:
slop docs ls poll votes -o table
```

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| A write rejects `invalid_argument: this viewer cannot write "…"` | The viewer's level is below the rule for that path (or the path is someone else's `data/users/…`, or a `self` rule) | `slop explain can <store> --path <path> --op write --subject <who>`; grant a level or change the rule |
| `slop docs set` fails `permission_denied: writing … needs self` | The path's rule is `write: "self"`: only the actor writes it | Call the app's action (`slop on <store> …` or `slop call`) |
| A document you wrote "does not exist" for someone else | Their level is below the path's `read`, or it is under your `data/users/<id>/` | Check with `explain can … --op read`; move shared data out of `data/users/` |
| `TypeError: … a document path has an even number` | A collection path given to `doc()` or the reverse | Count segments: documents even, collections odd |
| `update needs an existing document` | `update` on a missing document | `set` it first, or use `set` with the whole body |
| `_stores is not open to this app` | No `stores` in the manifest, or the `stores` policy cell is off for the viewer's audience | Add `"stores": "view"`; `slop policy set <app> stores @member on` |
| The 65th subscription stops with `resource_exhausted` | 64 live subscriptions per view | Unsubscribe; subscribe to a collection instead of many documents |
| The owner cannot write a path | The rule says `write: "self"`, or `_stores` ceiling is `view` | Write it in an actor action, or raise the level |
| `push` fails: `the rule at "x" must set both read and write` | A `{self}` rule below a rule that sets only one level | Give the prefix rule both `read` and `write` |

## See Also

- `slop help page-runtime` — `claude.use`, errors common to every capability
- `slop help capability-slop` — atomic multi-document changes through an actor action
- `slop help capability-assets` — files, with their ids kept in documents
- `slop help capability-user` — `id()`, `can()`, profiles
- `slop help access-control` — levels, grants, policy cells, `explain can`
- `slop help store-data` — documents, files and tables from the CLI
- `slop help actors` — `use('db')` in `actor.js`
