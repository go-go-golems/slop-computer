# Artifact Files — Guide

Oct 10, 2026 · @Manuel Odendahl

## Overview

Two capabilities move files between a page and people: `files` reads a Claude Code project's files with the viewer's own access, and `downloads` hands the viewer a file the page generated. Files that people upload into the artifact are a third thing, `assets` (see the State Storage guide).

| Capability | Direction | The page sees bytes? | Viewer prompt |
| --- | --- | --- | --- |
| `files` | Project → page (read), project → viewer's device (`download`) | Yes for `read`; no for `download` | Once, on the first call; every `download` asks to save |
| `downloads` | Page → viewer's device | It made them | Every save shows name and size to confirm |
| `assets` | Viewer's upload → artifact store, shared | Yes | None (writers only) |

Neither `files` nor `downloads` can write files anywhere except the viewer's own device, and only after they confirm. Page code never triggers a download directly.

## files: reading a project's files

`files` reads the files of one Claude Code project, as the viewer. Each viewer sees only what they themselves can open; the page never holds the author's access.

**Declare it** with the project's id. Declare it only when you know that id (for example, your own session's). Only project members can publish an artifact that declares `files`.

```js
// manifest: { "files": { "project": "chan_..." } }
const files = await claude.use("files"); // null: e.g. a viewer outside the org — hide it
```

**Access.** A viewer who can't open the project's files gets `not_found` from every call and is never prompted. A viewer who can is asked once, on the first call, so make that call from a click or after the page has loaded, never in a loop. A decline rejects `not_granted`, and calling again doesn't ask again.

### Methods

| Method | Resolves | Notes |
| --- | --- | --- |
| `list({path?, recursive?, cursor?})` | `{entries, cursor?}` | At most 500 entries per page; pass `cursor` back for the next. Omit `path` for the top level. |
| `read(path, {offset?, length?})` | `{bytes, size, revision}` | Up to 25 MiB per read. Decode text yourself with `TextDecoder`. |
| `download(path)` | `{status: "saved"}` | Shows the viewer the file's name and size; saves only if they accept. The page never gets the bytes. |
| `asSampleTools()` | Two `sample` tools | `list_project_files` and `read_project_file` (text, \~12 KB per call). Declare `sample` too. |

```ts
interface Entry {
  path: string;        // pass back verbatim to the other methods
  isDirectory: boolean;
  size: number;        // bytes
  createdAt?: string;  // RFC 3339, when known
}
```

### Reading large files

A file over 25 MiB takes several reads: advance `offset` until it reaches `size`. Compare `revision` between reads; if it changes, the file changed underneath you, so start over.

```js
async function readAll(path) {
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

**Freshness.** A file written in the last few seconds may not be visible yet, or may briefly return its previous bytes. Retry a `not_found` for a file you expect once, after a short wait.

### Letting Claude browse the project

```js
// manifest: { "files": { "project": "chan_..." }, "sample": {} }
const sample = await claude.use("sample");
const { text } = await sample("Which module handles auth? Cite file paths.", {
  tools: await files.asSampleTools(),
});
```

### Downloads

- Programs and scripts (.exe, .js, .bat and similar) can't be saved from an artifact; they reject `bad_request`.
- The project's limit is 512 MiB per file (about 210 MB in the Claude Android app); larger rejects `too_large`.
- One save prompt at a time; another download while one is open rejects `rate_limited`.
- `saved` means handed to the device; a browser can still block it, and the page isn't told.

### Privacy

Don't copy file contents into the artifact's `db`, assets or published versions unless the user asks: anyone the artifact is shared with could then read them, including people who can't open the project.

### Errors

| Code | Page should |
| --- | --- |
| `not_found` | No such path, or this viewer can't open the project (indistinguishable). Retry once if the file is new. |
| `not_granted` | Viewer declined; hide the feature. |
| `changed` | File changed mid-read; try again. |
| `rate_limited` | Wait `retryAfterMs` if given, then retry. |
| `too_large` | `download` only: over the size limit. |
| `declined` | `download` only: viewer said no. Never auto-retry. |
| `bad_request` | Bad path, cursor or range; a folder passed to `read`/`download`; or a blocked file type. Don't retry. |
| `unavailable` / `capability_*` | Show a short error with a retry; hide the feature if it keeps happening. |

## downloads: handing the viewer a file

`downloads` offers a file the page generated (a CSV export, a rendered PNG, a zip). The viewer sees the final filename and size and decides; nothing saves silently.

```js
// manifest: { "downloads": true }
const downloads = await claude.use("downloads"); // null: hide the save button
```

### save({filename, data, request?}) → Promise<{status}>

| Field | Rules |
| --- | --- |
| `filename` | Suggested name with extension, ≤ 512 chars. Sanitized (invisible characters dropped, whitespace collapsed, ≤ 240 bytes UTF-8) and checked against the allowlist. The viewer confirms the final name. |
| `data` | Non-empty. A string is saved as UTF-8. An `ArrayBuffer` is **transferred** (detached afterwards; pass `buf.slice(0)` to keep it). Typed-array views are copied. A `Blob` is handed over as-is, so prefer it for large files. MIME type comes from the extension, not the Blob. |
| `request` | Only when answering an export the platform asked the page for: the token that came with the request, verbatim. Omit for ordinary saves. |

It resolves `{status: "saved"}` when the viewer accepts (handed to the browser download, the iOS share sheet, or Android's own file write) or `"delivered"` for an answered export request. Every other outcome rejects. Only one undecided prompt at a time.

### Allowed extensions

| Group | Extensions |
| --- | --- |
| Always | gif, png, jpg, jpeg, webp, mp4, webm, txt, json, md |
| Usually (the platform can switch these off per view) | docx, pptx, epub, csv, ttf, html, svg, pdf, xlsx, zip |

Offer the format the content wants (a table is a `.csv`, a workbook an `.xlsx`). Don't pre-build fallback formats.

**Size.** Ordinary saves have no limit except about 200 MiB in the Claude Android app. Export answers are capped by the destination (16 MiB today). Never trim or re-encode up front; on `too_large`, offer a smaller version.

### Rules

- Call `save` from an explicit viewer action, like a Download button.
- A decline is final for that attempt. Never auto-retry.
- `saved` means handed to the device; a browser can still drop it, and the page can't tell.

### Errors

| Code | Page should |
| --- | --- |
| `declined` | Viewer said no. Do nothing. |
| `rate_limited` | A prompt is already open, or too many recently. Wait, then let them retry. |
| `rejected_extension` | Missing or disallowed extension. Use an allowed format. |
| `extension_not_enabled` | The second extension list is off here. Say that format is unavailable; no fallback chain. |
| `too_large` | Offer a smaller version. |
| `bad_request` | Bad filename or data, malformed `request`, or wrong format for an export. Fix the call. |
| `request_unknown` | The export request expired or was already answered. Drop the work. |
| `unavailable` / `not_granted` / `capability_*` | Hide save controls. |

## Patterns and full example

| Need | Use |
| --- | --- |
| Browse a project's tree | `files.list({recursive: true})`, paging with `cursor` |
| Preview a log or CSV from the project | `files.read(path, {length: 65536})` + `TextDecoder` |
| Let people grab a build output | `files.download(path)` (page never sees the bytes) |
| Ask Claude about the codebase | `sample` with `files.asSampleTools()` |
| Export the table the page shows | `downloads.save({filename: "report.csv", data: csvText})` |
| Save a chart image | `canvas.toBlob()` → `downloads.save({filename: "chart.png", data: blob})` |
| Keep a file in the artifact for everyone | `assets.upload` + a `db` row (State Storage guide) |

### Example: project file browser with preview and CSV export

Manifest: `{"files": {"project": "chan_..."}, "downloads": true}`.

```html
<button id="load" hidden>Show project files</button>
<table><thead><tr><th>Path</th><th>Size (bytes)</th><th></th></tr></thead><tbody id="rows"></tbody></table>
<button id="more" hidden>Load more</button>
<button id="export" hidden>Export list as CSV</button>
<pre id="preview"></pre><p id="msg"></p>
<script>
const $ = (id) => document.getElementById(id);
const entries = [];
let cursor;

(async () => {
  const [files, downloads] = await Promise.all([claude.use("files"), claude.use("downloads")]);
  if (!files) return; // feature stays hidden
  $("load").hidden = false;

  const fail = (e) => {
    const copy = {
      not_found: "You don't have access to this project's files, or the file is gone.",
      not_granted: "File access wasn't allowed.",
      changed: "The file changed while reading. Try again.",
      rate_limited: "Busy. Try again in a moment.",
      declined: "",
    };
    if (e.code === "not_granted") $("load").hidden = $("more").hidden = true;
    $("msg").textContent = copy[e.code] ?? "Couldn't reach the project files.";
  };

  async function loadPage() { // first call happens on a click: that's where consent is asked
    try {
      const res = await files.list({ recursive: true, cursor });
      cursor = res.cursor;
      for (const e of res.entries.filter((e) => !e.isDirectory)) {
        entries.push(e);
        const tr = document.createElement("tr");
        const name = document.createElement("td"); name.textContent = e.path;
        const size = document.createElement("td"); size.textContent = String(e.size);
        const act = document.createElement("td");
        const view = Object.assign(document.createElement("button"), { textContent: "Preview" });
        view.onclick = async () => {
          try {
            const r = await files.read(e.path, { length: 65536 });
            $("preview").textContent = new TextDecoder().decode(r.bytes) + (r.size > 65536 ? "\n…" : "");
          } catch (err) { fail(err); }
        };
        const save = Object.assign(document.createElement("button"), { textContent: "Download" });
        save.onclick = () => files.download(e.path).catch(fail);
        act.append(view, " ", save);
        tr.append(name, size, act);
        $("rows").append(tr);
      }
      $("more").hidden = !cursor;
      $("export").hidden = !downloads || entries.length === 0;
    } catch (e) { fail(e); }
  }

  $("load").onclick = () => { $("load").hidden = true; loadPage(); };
  $("more").onclick = loadPage;

  $("export").onclick = async () => {
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const csv = ["path,size_bytes", ...entries.map((e) => q(e.path) + "," + e.size)].join("\n");
    try {
      await downloads.save({ filename: "project-files.csv", data: csv });
      $("msg").textContent = "Saved.";
    } catch (e) {
      if (e.code === "declined") return;
      if (e.code === "unavailable" || e.code === "not_granted") $("export").hidden = true;
      $("msg").textContent = e.code === "rate_limited" ? "A save prompt is already open." : "Couldn't export.";
    }
  };
})();
</script>
```

**What this demonstrates**

- The first `files` call is behind a click, so the consent prompt appears when the viewer expects it.
- `list` pages with `cursor`; `read` previews only the first 64 KiB.
- `files.download` hands project files to the device without the page seeing the bytes.
- `downloads.save` exports something the page built, after the viewer confirms.
- Paths are set with `textContent`, since file names are untrusted text.
