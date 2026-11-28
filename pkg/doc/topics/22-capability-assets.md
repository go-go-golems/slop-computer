---
Title: "The assets capability: files people add"
Slug: "capability-assets"
Short: "Upload images, PDFs, fonts and data files from a page, keep their ids in db, show them at /_blob/<id>: methods, accepted types, sizes, the policy cell and error codes."
Topics:
- apps
- pages
- capabilities
- assets
- files
Commands:
- policy
- files
- bind
- explain
Flags:
- zone
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
`assets` stores files that viewers add from a page (a photo, a PDF, a CSV)
in the store's **assets zone** and gives back a durable id. The asset store
keeps no names or meaning: write the id into a `db` document right after the
upload, and that document is the asset's index. Pages show an asset at
`/_blob/<id>` on their own origin.

> **Uploading and showing are separate.** Uploading needs `interact` on the
> store and the app's `assets` policy cell for the viewer's audience (on for
> members by default, off for guests). Showing an uploaded file needs
> nothing: any page that knows the id shows `/_blob/<id>`, so a guest with
> `view` sees the photos while `claude.use("assets")` is `null` for them.
> The photo wall below is the whole pattern: guests look, members add.

This page covers who gets the capability, its three methods with their
return shapes, the accepted types and sizes, how assets are served, how to
see them from the CLI, and the error codes.

## Declaring it and who gets it

```json
{
  "capabilities": {
    "db": {},
    "assets": {}
  }
}
```

Declare `db` with it, or the ids are lost on reload. A viewer gets the
`assets` object only when all of these hold:

- the viewer has an id (a signed-in person, or a guest with a `vis_…` id);
- the viewer holds `interact` or more on the store;
- the app's `assets` **policy cell** is on for the viewer's audience. By
  default it is on for `@member`, `@subscriber` and `@admin`, off for
  `@guest` and for a store acting on its own.

Otherwise `claude.use("assets")` is `null`: hide upload and delete controls.
To let guests upload on a store where they hold `interact`:

```bash
slop policy ls myapp                       # the matrix, with defaults
slop policy set myapp assets @guest on
```

Showing an asset needs none of this (see "Serving").

## API

```js
const assets = await claude.use("assets");   // null: this viewer cannot upload
```

| Method | Resolves to | Notes |
| --- | --- | --- |
| `upload(blob, {type?})` | `{id, url, sizeBytes, contentType}` | `blob` is a `Blob` or `File`. The type is `type`, else `blob.type`. Write `id` into its db row right after; the upload and the db write are separate commits |
| `list()` | `{assets: [{id, url, sizeBytes, contentType}], usage: {files, bytes, maxFiles, maxBytes}}` | Every upload of the store, for housekeeping (a storage meter, orphans no row points at). `maxFiles` (1000) and `maxBytes` (1 GiB) are reported figures |
| `delete(idOrUrl)` | `{deleted: true}` or `{deleted: false}` | Takes the id or a `/_blob/<id>` URL. `false` means nothing was there; both are success. Irreversible and store-wide: update the rows that held the id |

Example result of `upload`:

```json
{ "id": "afa3100987b9cb4477d6e62a5a9f4ab89", "url": "/_blob/afa3100987b9cb4477d6e62a5a9f4ab89",
  "sizeBytes": 70, "contentType": "image/png" }
```

An id is `a` followed by 32 hex digits (128 random bits).

## Accepted types and sizes

| Kind | Content types | Max size |
| --- | --- | --- |
| Images | `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif` | 20 MiB |
| Video, PDF | `video/mp4`, `video/webm`, `application/pdf` | 20 MiB |
| Fonts | `font/woff2`, `font/woff`, `font/ttf`, `font/otf` | 20 MiB |
| Data | `text/csv`, `text/markdown`, `application/json`, `text/plain` | 20 MiB |
| Code | `text/css`, `text/javascript`, `application/javascript` | 16 MiB |

- **SVG is refused** (`unsupported_type: SVG uploads are not accepted yet`).
- Parameters after `;` are ignored (`text/csv; charset=utf-8` is `text/csv`).
- A `Blob` without a type is sent as `application/octet-stream` and
  refused. Files from `<input type=file>` often have an empty or odd type
  (`.csv` as `application/vnd.ms-excel`): pass `{type}` from the extension.

## Serving

`/_blob/<id>` on the page's sandbox origin serves the bytes:

- Use it as-is in `<img src>`, `<video src>`, CSS `url()`, or `fetch()`.
  Build it from the stored id (`"/_blob/" + id`), not from a saved URL.
- Images, video, audio and PDF are served inline; other types (CSV, JSON,
  text, fonts, code) are served as downloads, never as a page. `fetch()` the
  URL and parse the text yourself.
- Responses are `Cache-Control: private, no-cache`: a deleted asset is gone
  at once (404). Show a placeholder on `onerror`.
- The URL is the capability: anyone with the full sandbox URL can fetch it,
  without a view. Treat ids like unguessable links, not like access control.
- `/_blob/<id>` also finds uploads of stores this store's aliases share
  (`slop bind set <store> <alias> <target> --assets`, which needs admin on
  the target), so a page can show an id it read through an alias.

## From the command line

Uploads live in the store's `assets` zone, named by their id:

```bash
slop files ls photos --zone assets -o table
# PATH                               REV  SHA256          SIZE  TYPE       ZONE
# a3c5a537f43c49bc85f71867fe9c37d23  4    …               70    image/png  assets
slop files cat photos a3c5a537f43c49bc85f71867fe9c37d23 --zone assets > dot.png
slop files put photos aseed0001 --zone assets --text $'a,b\n1,2\n' --type text/csv
slop files rm photos aseed0001 --zone assets
```

A file you put this way with a name that has no `/` shows up in the page's
`list()` too; names with `/` are hidden from it.

## Example: a photo wall

Guests and everyone else see the photos; signed-in members add them; each
photo row records who added it, and only that person or an admin removes
it. The page uploads the file, then asks the actor to write the row: an
action writes as the store, so nobody can forge a row in someone else's
name (the `write: "self"` rule keeps pages from writing `photos` at all).

`app.json`:

```json
{
  "title": "Photos",
  "page": "index.html",
  "actor": "actor.js",
  "capabilities": {
    "db": { "rules": [{ "path": "photos", "read": "view", "write": "self" }] },
    "assets": {},
    "slop": {}
  }
}
```

`actor.js`:

```js
const db = use('db');
defineActor({
  actions: {
    add: { requires: 'interact', run(ctx, { asset, name }) {
      if (!/^a[0-9a-f]{32}$/.test(asset || '')) ctx.fail('invalid_argument', 'asset is an upload id');
      // the upload id is unique: it is the row's id too
      db.doc('photos/' + asset).set({ asset, name: String(name || '').slice(0, 200), by: ctx.visitor.id, at: ctx.now });
      return { id: asset };
    } },
    remove: { requires: 'interact', run(ctx, { id }) {
      const d = db.doc('photos/' + id).get();
      if (!d.exists) return { removed: false };
      if (d.data().by !== ctx.visitor.id) ctx.need('admin');   // others' photos: admins only
      db.doc('photos/' + id).delete();
      return { removed: true, asset: d.data().asset };
    } },
  },
});
```

`index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Photos</title>
<style>img { width: 120px; height: 120px; object-fit: cover; margin: 4px; }</style></head>
<body>
<input type="file" id="pick" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
<div id="grid"></div><p id="msg"></p>
<script>
const $ = (id) => document.getElementById(id);
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
(async () => {
  const [db, slop] = await Promise.all([claude.use("db"), claude.use("slop")]);
  if (!db) { $("msg").textContent = "Open this page through its mount."; return; }
  const assets = await claude.use("assets"); // null for guests: they only look

  db.collection("photos").orderBy("at", "desc").onSnapshot((snap) => {
    $("grid").replaceChildren(...snap.docs.map((d) => {
      const img = new Image();
      img.alt = d.data().name;
      img.src = "/_blob/" + d.data().asset;           // the stored id, never a saved URL
      img.onerror = () => { img.alt = "(deleted)"; };
      if (assets) img.ondblclick = () => remove(d.id);
      return img;
    }));
  }, (e) => { $("msg").textContent = e.code; });

  if (!assets) return;
  $("pick").hidden = false;
  $("pick").onchange = () => [...$("pick").files].forEach(add);

  async function add(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      const up = await assets.upload(file, { type: TYPES[ext] || file.type });
      await slop.call("add", { asset: up.id, name: file.name });   // the row is the index
    } catch (e) {
      $("msg").textContent = { too_large: "Over 20 MiB.", unsupported_type: "Not an image type this app takes." }[e.code] || "Upload failed: " + e.code;
    }
  }
  async function remove(id) {
    try {
      const r = await slop.call("remove", { id });
      if (r.removed) await assets.delete(r.asset);
    } catch (e) { $("msg").textContent = e.code === "permission_denied" ? "Only the person who added it can remove it." : e.code; }
  }
})();
</script>
</body></html>
```

```bash
slop store new photos
slop push ./photos --store photos -m "first"
slop grant set photos @guest view          # anyone sees the wall, signed in or not
slop grant set photos @member interact     # members add (the assets policy cell is on for them by default)
slop mount set apps.example /photos photos
slop explain can photos interact --subject @guest    # false: guests cannot add
```

Guests see the pictures although `claude.use("assets")` is `null` for them:
showing `/_blob/<id>` needs no level (see "Serving"); only uploading needs
`interact` and the policy cell.

## Errors

| Code | Meaning | Page should |
| --- | --- | --- |
| `invalid_request` | `upload` was not given a `Blob` | Fix the call |
| `unsupported_type` | The type is not in the table, SVG, or missing | Pass `{type}`; keep small data in `db` instead |
| `too_large` | Over 20 MiB (16 MiB for CSS and JavaScript) | Compress or split |
| `not_granted` | The view was not granted `assets` (level, sign-in, policy) | Hide upload controls |
| `revoked` | The view was closed | Render the read-only view |
| `upstream_error` | The upload failed without a reason | Retry once |
| `unavailable` | Transient | Retry once after a short delay |

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `claude.use("assets")` is `null` for a signed-in member | They hold `view`, not `interact` | `slop grant set <store> @member interact`; check with `slop explain can <store> interact --subject <usr_…>` |
| `null` for guests | The `assets` cell is off for `@guest` by default | `slop policy set <app> assets @guest on` and grant guests `interact` |
| `unsupported_type: unsupported content type application/octet-stream` | The `Blob` has no type | Pass `{type}` from the file extension |
| `unsupported_type: SVG uploads are not accepted yet` | SVG is refused on slop | Convert to PNG, or keep the SVG source in a db document |
| An image shows on upload but not after reload | The id was never written to a db row | Write `{asset: up.id}` right after `upload` |
| A CSV link downloads instead of displaying | Data types are served as attachments | `fetch(url).then(r => r.text())` and render it yourself |
| `/_blob/<id>` is 404 | The asset was deleted, or it belongs to a store not shared through an alias | Show a placeholder; `slop files ls <store> --zone assets` |

## See Also

- `slop help capability-db` — where the ids live
- `slop help page-runtime` — `claude.use`, common errors
- `slop help capability-downloads` — handing the viewer a file to save
- `slop help access-control` — levels, `policy set`, audiences
- `slop help store-data` — the tree and assets zones from the CLI
