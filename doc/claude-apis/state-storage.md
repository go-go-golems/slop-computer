# Artifact State Storage — Guide

Oct 10, 2026 · @Manuel Odendahl

## Choosing a store

Put shared data in `db`, unless it is a file (`assets`, with its id in a `db` row) or the page itself is the whole record (`artifact`). Browser storage is only for one viewer's conveniences.

&#91;embedded content: choosing a store, 3 questions and 4 outcomes\]

Ask the questions top to bottom; the first yes decides. All three capabilities need the viewer signed in to claude.ai, and every page must still render something useful when they are unavailable.

## Browser storage

`localStorage`, `sessionStorage` and IndexedDB work in a published artifact, but only for per-viewer conveniences. Each artifact has its own origin, and what it stores stays in one viewer's browser: it never reaches other viewers, other devices or Claude.

**Good uses:** a remembered tab, filter or sort; a collapsed section; an unsent draft; input to stash before an `artifact.publish` reload.

**Never for:** anything shared, durable, or that Claude must read back. Use `db` or `artifact` for those.

**Always wrap it.** Storage can come back empty, or the accessor itself can throw, in a private window, with blocked site data, in previews and during thumbnail capture. The page must render correctly without it.

```js
const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let tab = store.get("tab", "overview");
```

It survives republishes to the same URL. A page that's only previewed in a conversation, not published, doesn't keep browser storage reliably.

## The artifact capability: the page is the record

With `artifact`, the page saves state by republishing itself as a new version. It fits polls, sign-up sheets, checklists and small boards, where what people see is the whole record. (It was formerly called `self`; that name still works but don't use it in new pages.)

**Declare and get it**

```js
// manifest: { "artifact": {} }
const artifact = await claude.use("artifact"); // null: can't run here
```

A read-only viewer still gets the namespace. Its writes reject `not_writer` or `not_granted`, which is the signal to render read-only.

### publish(html) → Promise<{version}>

- `html` is the complete replacement page, starting with `<!doctype html>`.
- Keep the state as data in the page (for example a JSON `<script>` block) and regenerate the document from it with a template function. Never serialize the live DOM: it holds session state and injected runtime scripts.
- The write is compare-and-set against the version this view loaded. On success, every open view reloads to the new version, this one included, so make `publish` the last act of an interaction.
- Each version is attributed to the viewer who published it. The whole page is replaced atomically.

**Rules**

- Publish only after a viewer acts, never on load.
- Batch rapid edits into one publish; every call mints a version.
- Stash unsent input in `sessionStorage` before publishing if it must survive the reload.
- Keep the head, styles and structure the same; change only the content.

### publish(files) — the files form

For editor-style pages whose HTML stays fixed while data files change, pass `{ "data/doc.json": text, "old.json": null }`. Only the named files change; the rest carry over. This view keeps running and only other views reload. Add `ifMatch` (the file's sha256) to every entry so two people saving different files both land. It is the only form allowed on an artifact made from a type, and it rejects `capability_disabled` on publicly shared artifacts.

**Self-republish format.** A page that republishes itself sends its whole document in this exact skeleton, so a later publish from Claude recognizes and replaces it instead of nesting it: `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>` reset `</style></head><body>`, then the page content (its `<title>` and `<style>` first), then `</body></html>`.

### Errors

| Code | Meaning | Page should |
| --- | --- | --- |
| `conflict` | Someone published first; all views are reloading to the winner | Nothing. Drop optimistic UI; don't retry |
| `not_writer` / `not_granted` | This viewer can't write | Switch to a read-only view |
| `not_declared` | A republish dropped the capability | Hide write affordances |
| `too_large` | Over the size limit | Trim the content |
| `invalid_content` | Not a full HTML page, or bad files map | Fix the call |
| `read_only_path` | Named a type's fixed file | Drop that path |
| `rate_limited` | Publishing too often | Batch changes |
| `upstream_error` | Transient failure | Retry once after a short random delay |

On a platform-created live doc, `artifact` also offers `edit(ops)` and `sync(fn)` for id-addressed edits instead of whole-page publishes. Pages you publish yourself don't use those.

## db: setup, paths and access

`db` is a persistent, realtime JSON document store, one per artifact. It survives reloads, republishes and sessions, shows other viewers' writes live, and is erased only when the artifact is deleted. Use it when Claude seeds or reads the data, when there's more data than the page shows, when data is private per viewer, or when many people write at once.

**Declare and get it.** Declare `user` alongside so the page can get the viewer's id.

```js
// manifest: { "db": {}, "user": {} }
const db = await claude.use("db");     // null: signed out or unavailable
const user = await claude.use("user");
const uid = user ? await user.id() : null;
```

### Paths

- A **document** path has an even number of segments: `tasks/t1`, `boards/b1/columns/c2`.
- A **collection** path has an odd number: `tasks`, `boards/b1/columns`.
- Segments use letters, digits and `_ - . ~ : @ +`; max 200 bytes per segment, 1,000 bytes and 16 segments per path.
- `db.doc()` and `db.collection()` throw a `TypeError` synchronously on a bad path. That's a code bug, not a store condition.
- Collections need no creating. Deleting a document does not delete documents nested under it.

**Per-viewer data.** `data/users/<uid>` is a collection (3 segments) private to that viewer, hidden even from the owner. One doc per viewer: `db.doc("data/users/" + uid + "/profile")`. A list per viewer: `db.doc("data/users/" + uid + "/profile").collection("decks")`. Use the awaited `user.id()`; no other value works. If `uid` is null, disable the per-viewer feature rather than moving its data to a shared path.

### Access levels

| Level | Who holds it (share-menu names) |
| --- | --- |
| `view` | Viewer, Commenter, signed-in visitors from outside the org |
| `interact` | Contributor; org members arriving by a public link |
| `admin` | Editor; anyone granted Owner |
| `owner` | Only the artifact's own owner |

Signed-out visitors have no data at all. The owner meets every level, so rules never limit them except `{self}` privacy.

**Defaults:** everyone admitted reads shared docs; `interact` and above write them; each viewer's `data/users/<id>/` is private.

### Rules

Rules set the minimum level to `read` and `write` at a path and everything below it. A deeper rule overrides a shallower one; unset levels inherit (the root defaults to `read: "view"`, `write: "interact"`). Write is never below read. Max 64 rules. They take effect on the next call after the version goes live.

```json
{ "db": { "rules": [
  { "path": "", "write": "admin" },
  { "path": "data/users/{self}", "write": "interact" },
  { "path": "votes", "read": "view", "write": "owner" },
  { "path": "votes/{self}", "write": "interact" }
] } }
```

This reads: only editors change shared data; everyone at Contributor or above keeps their own private data; everyone reads the votes, each person writes only `votes/<their id>`, and only the owner can change someone else's.

- `{self}` must be the last segment, and works under any prefix.
- A rule at the prefix of a `{self}` rule must set both `read` and `write`, or publish is refused.
- Locking the root alone also stops non-admins writing their own subtree, because it inherits. Add the `data/users/{self}` rule back.
- `read: "admin"` on a path makes it read as non-existent to everyone below admin.

**No permission errors on reads.** A document the viewer can't see behaves exactly like a missing one (`exists: false`, left out of queries). A write below the minimum rejects `invalid_argument`. Gate controls up front with the `user` capability: `can("data.write")` for shared writes, `canEdit()` for admin-only controls, `isOwner()` for the owner. If `can()` returns null, keep the inputs and go read-only after a rejected well-formed write.

## db: API reference

Refs are pure path holders: building them never touches the network; only calls on them do. Bodies are plain JSON objects (not arrays or scalars at the top), at most 256 KiB and 32 levels deep. One artifact holds at most 25,000 documents. Writes are last-writer-wins; there are no transactions.

### DocumentReference — `db.doc(path)`

| Method | Behavior |
| --- | --- |
| `get()` | Read once. Missing isn't an error: branch on `snap.exists`. |
| `set(data)` | Full replace; creates the doc (and the store) if absent. |
| `update(data)` | Merge into an existing doc; rejects `invalid_argument` if it doesn't exist. Nested objects merge; arrays and scalars replace. |
| `delete()` | Idempotent. Nested documents survive. |
| `onSnapshot(next, error?)` | Current state soon after subscribing, then every change, live. Own writes show at once with `hasPendingWrites: true`. |
| `acquire({holder, ttlMs?, data?})` | Cooperative lease (1 s–10 min, default 30 s). Busy resolves `{acquired: false}`. Coordinates callers that all use it; not a security boundary. |
| `collection(path)` | A subcollection under this doc. |

### CollectionReference and Query — `db.collection(path)`

| Method | Behavior |
| --- | --- |
| `doc(id?)` | A doc in this collection; no id mints a client-generated one. |
| `add(data)` | Create with a fresh id; resolves its ref. Sugar for `.doc().set(data)`. |
| `where(field, op, value)` | Up to 10 filters: `==` `!=` `<` `<=` `>` `>=` `in` `not-in` (arrays ≤ 30) `array-contains`. Top-level fields only. |
| `orderBy(field, dir?)` | One per query; `"asc"` default; docs missing the field sort last. Without it, order is by doc id. |
| `limit(n)` | 1–1,000. An ordered, limited query is a window. |
| `get()` | Read the matched set once. |
| `onSnapshot(next, error?)` | Live matched set; `snap.docChanges()` lists `added` / `modified` / `removed` with indexes. |

Builders return new queries. Queries scan without indexes, so keep queried collections to hundreds or low thousands of docs.

**Snapshots.** `DocumentSnapshot` has `id`, `exists`, `data()` and `metadata {fromCache, hasPendingWrites}`. `QuerySnapshot` has `docs`, `size`, `empty`, `docChanges()` and `metadata`. Snapshots and their `data()` are frozen, and an unchanged doc is the same object across deliveries. Clone a body before editing it. A `fromCache: true` snapshot is followed by a definitive one automatically.

### Write rules

- One write at a time per document: await each `set`/`update` before the next to the same doc.
- Write only on a user action or a real state change, never from render code, a snapshot callback, or a timer. Coalesce bursts of input into one write per pause.
- Don't build counters from read-then-update; a retried write can apply twice. Store per-person docs and count them instead.
- Don't map an unbounded stream (events, messages) to one doc per item. Aggregate or prune.
- To claim a slot (a seat, a username): `acquire` it with a short `ttlMs`, `get()` it, and `set` your claim only if unowned. A bare get-then-set races.

### Subscription rules

- Subscribe once per doc or query, keep the `Unsubscribe`, and call it when done.
- Never subscribe from code that runs on every render. In React, subscribe inside `useEffect`, build the query there, depend on stable primitives only, and return the unsubscribe.
- To sort or filter by fast-changing UI state, subscribe once to the wider set and derive the view in render.
- Max 64 active subscriptions per view. Always pass the `error` callback.
- Delivery is realtime when available, falling back to refresh every \~30 s in the foreground.

### Errors

Every rejection is `{code, message}`. Treat unknown codes as `unavailable`.

| Code | Meaning | Page should |
| --- | --- | --- |
| `invalid_argument` | Bad path, body, query, or a write below the viewer's level | Fix the call, or go read-only |
| `resource_exhausted` | Call rate, 64-subscription cap, concurrent writes, or a query scanning too much | Slow down or narrow the query |
| `quota_exceeded` | Collection, database or org cap full (message says which) | Tell the viewer; delete or shrink docs |
| `unavailable` | Transient | Verbs: retry once after a random delay. Subscriptions recover on their own |
| `revoked` | Access withdrawn mid-session | Render the degraded view; calls fail from now on |
| `not_granted` / `capability_disabled` / `capability_removed` | Can't run db in this view | Render without db |

## assets: files people add

`assets` stores binary and text files for the artifact and returns a durable id. Store that id in a `db` row: the row is the asset's index, since the asset store keeps no names or meaning of its own.

**Declare and get it.** Declare `db` too, or the id is lost on reload. A page declaring `assets` is organization-internal and can't be shared publicly.

```js
// manifest: { "assets": {}, "db": {} }
const assets = await claude.use("assets"); // null for read-only viewers: hide upload UI
```

Every method is writer-only. Hide upload and delete controls on `null`, and still handle `not_granted` on each call.

### Methods

| Method | Resolves | Notes |
| --- | --- | --- |
| `upload(blob, {type?})` | `{id, url, sizeBytes, contentType}` | Write `id` to its `db` row right after; use `url` as-is in this view. Not transactional with the db write. |
| `list()` | `{assets: [{id, url, contentType, sizeBytes, createdAt}], usage: {files, bytes, maxFiles, maxBytes}}` | Housekeeping only: a storage meter, or finding assets no row points at. |
| `delete(idOrUrl)` | `{deleted}` | Irreversible and artifact-wide. Only on a deliberate user action, updating the rows that held the id. `false` means nothing was there; both are success. |

**Displaying.** In a later view, build the source from the stored id as `"/_blob/" + id`. That path resolves from every page and version. Treat a 404 as a deleted asset and show a placeholder.

### Accepted types and limits

| Kind | Types | Max size |
| --- | --- | --- |
| Images | png, jpeg, gif, webp | 20 MiB |
| SVG | image/svg+xml (sanitized on upload) | 2 MiB |
| Video, PDF | mp4, webm, pdf | 20 MiB |
| Fonts | woff2, woff, ttf, otf | 20 MiB |
| Data | text/csv, text/markdown, application/json, text/plain | 20 MiB |
| Code | text/css, text/javascript | 16 MiB |

- Types must be exact, with no `;charset`. Pass `{type}` from the file extension when `blob.type` is empty or an alias (Windows `.csv` as `application/vnd.ms-excel`, `.js` as `application/javascript`, fonts as `font/woff2` etc.).
- Text files must be valid UTF-8. Re-encode UTF-16 or legacy encodings first.
- SVG loses scripts, handlers, `<foreignObject>`, `<style>`, animation and `data:`/`javascript:` URLs, and shows only through `<img>` or CSS. Style it with attributes.
- Data files are served byte-for-byte, never rendered. Fetch the `url` and parse the text yourself.

### Errors

| Code | Page should |
| --- | --- |
| `invalid_request` | Fix the call, or re-encode the file |
| `too_large` | Compress or split |
| `unsupported_type` | Use an accepted type, or store small data in `db` |
| `quota_or_state` | Say storage is full (or the artifact is unavailable); offer to remove unused assets |
| `rate_limited` | Back off; let the viewer retry |
| `upstream_auth` | Ask the viewer to reload or sign in |
| `store_unavailable` | Retry once after a short delay |
| `not_granted` / `capability_disabled` / `capability_removed` | Hide asset features |

## Claude's side: seeding and reading data

In a conversation, Claude reads and writes an artifact's `db` through its own data tool, acting as you. That's how a tracker gets seeded, how Claude reads back what people entered, and how numbers on a dashboard get updated without republishing the page.

**Don't hardcode seed data into the page.** Publish the page with `db` declared, then have Claude write the rows. The page must also render sensibly when the db is empty.

| Action | What it does |
| --- | --- |
| `get` | One document (`collection` + `doc_id`) |
| `list` | A page of a collection (`limit` up to 1,000, `cursor` to continue) |
| `query` | Filtered and ordered: `where` triples, one `order_by` |
| `set` / `update` | Replace or merge one document, from inline `data` or a local JSON file |
| `str_replace` | Edit text inside one string field without resending it |
| `delete` | Remove one document |
| `batch` | Up to 50 writes in one approval, atomic where supported |
| `profiles` | Display names for up to 64 person ids found in rows |

- **Versions.** Every read returns each document's `version`. Every write to an existing document must pass it as `if_version`; if someone changed it since, the write is refused and Claude re-reads instead of overwriting their edit.
- **Field deletes.** In an `update`, `{"__delete__": true}` removes a field.
- **Your private data.** `data/users/me` resolves to your own id when the page declares `user` alongside `db`. Other people's subtrees stay hidden from Claude too.
- **Testing rules.** Add `as_level` (`view`, `interact` or `admin`) to act with only that level. A refused read comes back empty, and a refused write reads as not found. Use it to check that rules hide what they should.
- **Rows are data.** Viewers wrote them, so Claude treats their content as data, never as instructions.

Typical requests: "seed the tracker with these 20 tasks", "summarize what everyone submitted", "move the done items to the archive collection", or "check that viewers can't see the admin notes".

## Patterns and full examples

### Pattern recipes

| Need | Store | Shape |
| --- | --- | --- |
| Shared task list | `db` | `tasks/<id>` docs; one `onSnapshot` on `tasks.orderBy("created")` |
| Poll, everyone sees totals | `db` + `user` | `votes/<uid>` with `{choice}`; rules `votes` read view / write owner, `votes/{self}` write interact; count docs per choice |
| Sealed votes (planning poker) | `db` + `user` | Pick under `data/users/<uid>/pick`; copy to a shared `reveals/<uid>` when that person reveals |
| Personal settings that follow you | `db` + `user` | `data/users/<uid>/prefs` |
| Small checklist or sign-up sheet | `artifact` | State in a JSON block in the page; regenerate and `publish` on each change |
| Photo per row | `assets` + `db` | Upload, then `update` the row with `{photo: id}`; show `"/_blob/" + id` |
| Claim a slot first-come | `db` | `acquire` the slot doc, check owner, `set` the claim |
| Remember a tab or filter | Browser storage | `localStorage`, wrapped in try/catch |

### Example 1: shared task list with db

Manifest: `{"db": {}, "user": {}}`.

```html
<form id="add" hidden><input id="title" required><button>Add</button></form>
<ul id="list"></ul><p id="msg"></p>
<script>
const $ = (id) => document.getElementById(id);
(async () => {
  const db = await claude.use("db");
  if (!db) { $("msg").textContent = "Sign in to see the shared list."; return; }
  const user = await claude.use("user");
  const canWrite = (await user?.can("data.write")) ?? true; // null: not told, keep inputs
  $("add").hidden = !canWrite;

  const tasks = db.collection("tasks");
  // Subscribe ONCE; derive the view in render.
  tasks.orderBy("created").onSnapshot((snap) => {
    $("list").replaceChildren(...snap.docs.map((d) => {
      const t = d.data(), li = document.createElement("li");
      const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: !!t.done, disabled: !canWrite });
      box.onchange = () => tasks.doc(d.id).update({ done: box.checked }).catch(fail);
      li.append(box, " ", t.title);
      return li;
    }));
    if (snap.empty) $("msg").textContent = "No tasks yet.";
  }, fail);

  $("add").onsubmit = async (e) => {
    e.preventDefault();
    const title = $("title").value.trim(); if (!title) return;
    $("title").value = "";
    await tasks.add({ title, done: false, created: Date.now() }).catch(fail);
  };

  function fail(e) {
    if (e.code === "invalid_argument") { $("add").hidden = true; $("msg").textContent = "This list is read-only for you."; }
    else if (e.code === "quota_exceeded") $("msg").textContent = "The list is full. Delete some tasks first.";
    else if (e.code === "revoked") $("msg").textContent = "";
    else $("msg").textContent = "Couldn't save. Try again.";
  }
})();
</script>
```

### Example 2: checklist that republishes itself

Manifest: `{"artifact": {}}`. The state lives in the page as JSON; each change regenerates the whole document from it.

```html
<title>Checklist</title>
<script type="application/json" id="state">{"items":[{"text":"Book venue","done":false},{"text":"Send invites","done":false}]}</script>
<ul id="list"></ul><p id="msg"></p>
<script>
const APP = document.currentScript.textContent; // this script's own source, reused in every version
const state = JSON.parse(document.getElementById("state").textContent);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function render(writable) {
  document.getElementById("list").innerHTML = state.items.map((it, i) =>
    `<li><label><input type=checkbox data-i=${i} ${it.done ? "checked" : ""} ${writable ? "" : "disabled"}> ${esc(it.text)}</label></li>`).join("");
}

// Regenerate the whole document from state, never from the live DOM.
function pageFor(s) {
  const json = JSON.stringify(s).replace(/</g, "\\u003c");
  return '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style></style></head><body>'
    + '<title>Checklist</title>'
    + '<script type="application/json" id="state">' + json + '<\/script>'
    + '<ul id="list"></ul><p id="msg"></p>'
    + '<script>' + APP + '<\/script></body></html>';
}

(async () => {
  const artifact = await claude.use("artifact");
  render(!!artifact);
  if (!artifact) return;
  document.getElementById("list").onchange = async (e) => {
    state.items[Number(e.target.dataset.i)].done = e.target.checked;
    try {
      await artifact.publish(pageFor(state)); // every open view reloads to the new version
    } catch (err) {
      if (err.code === "conflict") return; // already reloading to the winner
      const msg = document.getElementById("msg");
      if (err.code === "not_writer" || err.code === "not_granted") { render(false); msg.textContent = "View only."; }
      else if (err.code === "rate_limited") msg.textContent = "Saving too often. Wait a moment.";
      else msg.textContent = "Couldn't save.";
    }
  };
})();
</script>
```

The script captures its own source with `document.currentScript.textContent`, so each new version carries the same code with updated state. Keep the markup `pageFor` writes identical to the page as authored, and add a real `<style>` reset where the skeleton has an empty one.

### Before you hand over a page

After the first publish of a page that declares `db`, list each collection it writes. Where rules hide something from ordinary viewers, repeat the read with a lower `as_level` and confirm the hidden data doesn't show.
