---
Title: "The files capability: reading a store's files from a page"
Slug: "capability-files"
Short: "List, read and download the files of another store's tree (one alias, or every store through _stores) as the viewer, and hand them to sample as tools."
Topics:
- capabilities
- page-runtime
- files
Commands:
- bind
- push
- policy
- mount
- app
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
`files` lets a page read **files** — the versioned tree that `slop push`
writes — of a store other than its own documents, with the viewer's own
access. On claude.ai the capability reads a Claude Code project; on slop a
"project" is a store's `main` snapshot, named in the manifest either by an
**alias** of the viewed store or by `_stores` (every store the viewer may
open). The page reads bytes; it never writes. Each viewer sees only what they
can open themselves: the page never borrows the author's access.

What `files` does **not** read: a store's documents (that is `db`), its
uploaded assets (`assets`), a draft, or older snapshots. Only the tree at the
ref `main`.

## Declaring it

`files` takes one field, `project`, and it is required.

| Declaration | The project is |
| --- | --- |
| `"files": { "project": "src" }` | the store that the viewed store's alias `src` points at; paths are that store's tree paths (`readme.txt`, `docs/a.md`) |
| `"files": { "project": "_stores" }` | every store the viewer may open, each a top-level folder: paths are `<store>/<path>` |

Rules checked when the app runs (a failure makes the app broken, see
`slop app status <store>`):

- `project` missing or empty: `capabilities.files.project: "" is not _stores or an alias name`.
- Names starting with `_` other than `_stores` are reserved and refused.
- Any other well-formed name is accepted. If the viewed store has no binding
  of that name, every call answers `not_found`.

### An alias project

An alias is a binding **on the store being viewed** (not on the app):

```bash
slop store new handbook          # the store whose files the page shows
slop push handbook               # its tree: readme.txt, docs/a.md, ...
slop bind set reader src handbook    # store "reader" now has the alias src -> handbook
```

Stores that a mount creates (`slop mount set … --createApp`) get their
aliases from `--aliases '[{"alias":"src","target":"handbook"}]'`. The viewer
also needs `view` on the target store itself (`slop grant set handbook
@member view`); a binding never lends access.

### The `_stores` project

`_stores` needs two more things, or `claude.use("files")` resolves `null`:

1. the app declares how far it reaches into other stores:
   `"db": { "stores": "view" }` (`view`, `interact` or `admin`);
2. the policy cell `stores` is on for the viewer's audience:
   `slop policy set <app> stores @member on`.

The top level then lists, as folders, the stores the viewer owns or reaches
through a grant to them or to one of their groups (`@guest`, `@member`,
`@subscriber`); a platform admin sees every
store.

## A complete minimal page

`app.json` (the app store `reader`, viewed directly):

```json
{
  "title": "Reader",
  "page": "index.html",
  "capabilities": {
    "files": { "project": "src" },
    "downloads": true
  }
}
```

`index.html`:

```html
<!doctype html>
<html><body>
<ul id="tree"></ul>
<pre id="preview"></pre>
<p id="msg"></p>
<script>
const $ = (id) => document.getElementById(id);
(async () => {
  const files = await claude.use("files");
  if (!files) { $("msg").textContent = "No files here."; return; }
  const fail = (e) => { $("msg").textContent = e.code === "not_found"
    ? "You cannot open these files, or they are gone." : "Could not read files (" + e.code + ")."; };
  try {
    let cursor, entries = [];
    do {                                              // 500 entries per page
      const page = await files.list({ recursive: true, cursor });
      entries.push(...page.entries); cursor = page.cursor;
    } while (cursor);
    for (const e of entries.filter((e) => !e.isDirectory)) {
      const li = document.createElement("li");
      const open = document.createElement("button");
      open.textContent = e.path + " (" + e.size + " bytes)";      // textContent: paths are untrusted
      open.onclick = async () => {
        try {
          const r = await files.read(e.path, { length: 65536 });
          $("preview").textContent = new TextDecoder().decode(r.bytes) + (r.size > 65536 ? "\n…" : "");
        } catch (err) { fail(err); }
      };
      const save = document.createElement("button");
      save.textContent = "Download";
      save.onclick = () => files.download(e.path).catch((err) => err.code !== "declined" && fail(err));
      li.append(open, " ", save);
      $("tree").append(li);
    }
  } catch (e) { fail(e); }
})();
</script>
</body></html>
```

Deploy and try it on a local server:

```bash
mkdir -p handbook/docs && echo "hello notes" > handbook/readme.txt && echo "# doc" > handbook/docs/a.md
slop store new handbook && slop push handbook
slop store new reader && slop push reader          # the folder above
slop bind set reader src handbook
slop mount set apps.example.com /reader reader
```

## API reference

`await claude.use("files")` resolves the object, or `null` when `files` is
not declared or (`_stores`) the app may not reach other stores for this
viewer. There is no consent prompt.

### list({path?, recursive?, cursor?})

Resolves `{entries, cursor?}`.

- `path`: a folder; omit it (or `""`) for the top level.
- `recursive: true` lists everything below `path`; otherwise only its
  direct children.
- At most 500 entries per call, sorted by path. When more remain, `cursor`
  is set: pass it back for the next page.
- Folders are derived from file paths and have `size: 0`.

```ts
interface Entry { path: string; isDirectory: boolean; size: number }  // pass path back verbatim
```

A recursive list of the example above:

```json
{"entries":[{"path":"docs","isDirectory":true,"size":0},
            {"path":"docs/a.md","isDirectory":false,"size":6},
            {"path":"readme.txt","isDirectory":false,"size":12}]}
```

Under `_stores` the same entries read `handbook/docs`, `handbook/docs/a.md`, …

### read(path, {offset?, length?})

Resolves `{bytes, size, revision}`: `bytes` is a `Uint8Array` (decode text
with `TextDecoder`), `size` the whole file's size, `revision` the file's
SHA-256 in hex. `length` defaults to, and is at most, 25 MiB. An `offset`
equal to `size` returns empty `bytes`; past it is `bad_request`.

### download(path)

Reads the whole file, then shows the viewer the shell's dialog
("Save a file? Reader offers a.md (1 KB).") and saves it under the last
segment of `path` if they accept. Resolves `{status: "saved"}`. The page
never sees the bytes. Executables and scripts cannot be saved: paths ending
in `.exe .msi .com .scr .bat .cmd .ps1 .sh .vbs .jar .js .mjs .cjs` reject
`bad_request` before anything is read.

### asSampleTools()

Resolves two tools for `sample` (declare `sample` too, `slop help
capability-sample`):

| Tool | Input | Returns |
| --- | --- | --- |
| `list_project_files` | `{path?, recursive?}` | up to 200 entries |
| `read_project_file` | `{path, offset?}` | `{text, size, next?}`, about 12 KB per call; `next` is the offset to continue from |

```js
const sample = await claude.use("sample");
const { text } = await sample("Which file explains setup? Cite paths.", { tools: await files.asSampleTools() });
```

## Reading large files

A file over 25 MiB takes several reads. Advance `offset` until it reaches
`size`, and start over if `revision` changes (someone pushed a new snapshot):

```js
async function readAll(files, path) {
  const chunks = []; let offset = 0, size = Infinity, rev;
  while (offset < size) {
    const r = await files.read(path, { offset });
    if (rev && r.revision !== rev) { chunks.length = 0; offset = 0; rev = undefined; continue; }
    rev = r.revision; size = r.size; chunks.push(r.bytes); offset += r.bytes.length;
    if (r.bytes.length === 0) break;
  }
  return new Blob(chunks);
}
```

`download` does the same internally and rejects `changed` if the file changes
mid-read.

## How slop differs from claude.ai

| claude.ai | slop |
| --- | --- |
| `project` is a Claude Code project id (`chan_…`) | an alias of the viewed store, or `_stores` |
| The viewer is asked once, at the first call | No prompt; access is the viewer's level on the target store |
| `Entry.createdAt` when known | never set |
| `revision` is opaque | the file's SHA-256 (hex) |
| New files may take seconds to appear | A `slop push` is visible at once |
| Download limit 512 MiB per file | no limit enforced by slop (the browser holds the whole file in memory) |
| `rate_limited`, `too_large` from `files` | not produced |

## Limits

| What | Limit |
| --- | --- |
| Entries per `list` page | 500 |
| Bytes per `read` | 25 MiB (26214400) |
| `list_project_files` tool | 200 entries |
| `read_project_file` tool | 12 KB per call |
| What is read | the target store's `main` snapshot only |

## Errors

| Code | Meaning | Page should |
| --- | --- | --- |
| `not_found` | No such path, no such alias binding, or the viewer cannot open the target store — deliberately indistinguishable | Say the files are unavailable; do not retry in a loop |
| `bad_request` | `list` on a file, `read` / `download` on a folder, a bad cursor, `offset` past the end, `length` over 25 MiB, a blocked file type | Fix the call |
| `changed` | `download` only: the file changed while it was read | Try again |
| `declined` | `download` only: the viewer said no | Do nothing; never auto-retry |
| `unavailable` | Anything else (server error, the save dialog did not answer) | Show a short error with a retry |

Error messages are specific, for example
`readme.txt is a file: list takes a folder` or
`offset 999 is past the end (12 bytes)`.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `claude.use("files")` is `null` with `_stores` | `db.stores` not declared, or the `stores` policy cell is off for this viewer | Add `"db": {"stores": "view"}`; `slop policy set <app> stores @member on` |
| `claude.use("files")` is `null` with an alias | `files` not declared in this snapshot, or the app is broken | `slop app status <store>` |
| Every call is `not_found` | The viewed store has no binding of that name | `slop bind set <viewed-store> <alias> <target>`; for stores a mount creates, `--aliases` on the mount |
| `not_found` for some viewers only | They have no level on the target store | `slop grant set <target> <subject> view` |
| The top level is empty | Nothing pushed to the target yet | `slop push <dir> --store <target>` |
| A file you just wrote is missing | `files` reads the `main` snapshot, not a draft or a document | Push and move `main`; documents are read with `db` |
| `bad_request` on download | A blocked extension (`.js`, `.sh`, …) | Offer a preview with `read`, or rename the file in the tree |
| App broken: `is not _stores or an alias name` | `project` empty or a reserved `_` name | Use an alias name or `_stores` |

## See Also

- `slop help capability-downloads` — saving files the page itself makes
- `slop help capability-assets` — files people upload into a store
- `slop help capability-db` — `db.stores`, aliases and documents
- `slop help capability-sample` — using `asSampleTools()`
- `slop help store-data` — the tree, snapshots and refs
- `slop help deploying-apps` — bindings, mounts with `--aliases`, policy
