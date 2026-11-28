---
Title: "The downloads capability: handing the viewer a file"
Slug: "capability-downloads"
Short: "Offer a file the page generated (CSV, PNG, JSON, zip) through the shell's save dialog: downloads.save({filename, data}), the extension list, the 50 MiB cap and the error codes."
Topics:
- capabilities
- page-runtime
- downloads
- files
Commands:
- push
- app
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
`downloads` lets a page give the viewer a file it made: an export of the
table on screen, a rendered chart, a JSON backup. The page runs in a
sandboxed frame and cannot start a download itself; it hands the file to the
slop shell around it, which shows the viewer the name and size and saves only
if they press **Save**. Nothing is stored on the server.

For files that already live in a store's tree, use `files.download`
(`slop help capability-files`); for files people upload, `assets`
(`slop help capability-assets`).

## Declaring it

```json
"capabilities": { "downloads": true }
```

`{}` works the same. There is no option, no policy cell and no consent
prompt: every viewer of an app that declares `downloads` gets it, guests
included. The confirmation dialog on each save is the protection.

## A complete minimal page

`app.json`:

```json
{
  "title": "Export",
  "page": "index.html",
  "capabilities": { "downloads": true }
}
```

`index.html`:

```html
<!doctype html>
<html><body>
<table id="t"><tr><th>name</th><th>votes</th></tr><tr><td>Ada</td><td>3</td></tr><tr><td>Bo "B"</td><td>5</td></tr></table>
<button id="csv" hidden>Download CSV</button>
<p id="msg"></p>
<script>
const $ = (id) => document.getElementById(id);
(async () => {
  const downloads = await claude.use("downloads");
  if (!downloads) return;                               // no save button where it is off
  $("csv").hidden = false;
  $("csv").onclick = async () => {                      // only from a click
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const csv = [...$("t").rows].map((r) => [...r.cells].map((c) => q(c.textContent)).join(",")).join("\n");
    try {
      await downloads.save({ filename: "votes.csv", data: csv });
      $("msg").textContent = "Saved.";
    } catch (e) {
      if (e.code === "declined") return;                // the viewer said no: do nothing
      $("msg").textContent = e.code === "rate_limited" ? "A save dialog is already open." : "Could not save (" + e.code + ").";
    }
  };
})();
</script>
</body></html>
```

When the viewer clicks, the shell shows:

```
Save a file?
Export offers votes.csv (1 KB).
                    [Cancel] [Save]
```

## save({filename, data})

Resolves `{status: "saved"}` once the viewer pressed Save and the browser
was handed the file. Every other outcome rejects with a `code`.

| Field | Rules |
| --- | --- |
| `filename` | A string of 1 to 200 characters, without `/`, `\` or NUL, ending in an allowed extension (case does not matter). Used as given: slop does not rename or sanitise it. |
| `data` | A string (saved as UTF-8), a `Blob`, an `ArrayBuffer` or a typed array. It is copied, so an `ArrayBuffer` stays usable. At most 50 MiB (52428800 bytes). An empty string is accepted. |

Only one save waits for the viewer at a time; a second call meanwhile rejects
`rate_limited`. Clicking outside the dialog counts as Cancel.

`saved` means the browser received the file; a browser setting can still
block it, and the page is not told.

## Allowed extensions

```
txt md csv tsv json jsonl html htm css svg png jpg jpeg gif webp pdf
zip ics vcf xml yaml yml log mp3 wav mp4 webm
```

Anything else, including a name with no extension, rejects
`rejected_extension`. Office formats (`docx`, `xlsx`, `pptx`), `epub` and
fonts are not on the list. Offer the format the content wants: a table is
`.csv`, a chart `.png` (`canvas.toBlob()`), structured data `.json`.

## How slop differs from claude.ai

| claude.ai | slop |
| --- | --- |
| Two lists: always (images, video, txt, json, md) and usually (docx, pptx, xlsx, csv, pdf, zip, …), switchable per view | One fixed list (above); no `docx`, `pptx`, `xlsx`, `epub`, `ttf` |
| `filename` up to 512 characters, sanitised, 240 bytes | 1–200 characters, no slashes, not sanitised |
| No size limit (200 MiB on Android) | 50 MiB |
| `data` must be non-empty; an `ArrayBuffer` is transferred | empty is accepted; data is copied |
| `request` answers an export the platform asked for (`delivered`) | Not supported: `request` is ignored and nothing ever asks |
| `extension_not_enabled`, `request_unknown` | never produced |

## Limits

| What | Limit |
| --- | --- |
| File size | 50 MiB |
| Filename | 1–200 characters, allowed extension, no `/` `\` NUL |
| Open save dialogs per page | 1 |

## Errors

| Code | Meaning | Page should |
| --- | --- | --- |
| `declined` | The viewer pressed Cancel or clicked away | Do nothing; never retry on its own |
| `rate_limited` | A save dialog is already open | Wait for it; let the viewer try again |
| `rejected_extension` | No extension, or one not on the list | Use an allowed format |
| `too_large` | Over 50 MiB | Offer a smaller export (fewer rows, a lower resolution) |
| `bad_request` | Filename empty, over 200 characters, or containing a slash | Fix the call |
| `unavailable` | The shell did not answer | Show a short error with a retry |

The size, extension and filename checks run in the page before any dialog,
so they reject at once.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `claude.use("downloads")` is `null` | Not declared in this snapshot, or the app is broken. On the static host `window.claude` is undefined (no runtime) | Declare `"downloads": true`, `slop push`; check `slop app status <store>` |
| `rejected_extension` for `report.xlsx` | Office formats are not offered | Export `.csv` |
| `bad_request` for `exports/2026.csv` | Slashes are not allowed | Use `exports-2026.csv` |
| Nothing happens on click, no error yet | The dialog is open in the shell, outside the frame | Look at the top of the window; the promise settles when the viewer answers |
| `rate_limited` on a second button | The first dialog is still open | Disable the buttons while a save is pending |
| A test script hangs on `save` | The dialog waits for a person | In Playwright, click the shell's **Save** or **Cancel** button in the top page |

## See Also

- `slop help capability-files` — `files.download` for files in a store's tree
- `slop help capability-assets` — files people upload, kept in the store
- `slop help page-runtime` — `claude.use` and how slop differs from claude.ai
- `slop help app-manifest` — every capability's declaration form
