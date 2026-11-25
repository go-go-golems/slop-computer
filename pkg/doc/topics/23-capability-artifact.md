---
Title: "The artifact capability: a page that republishes itself"
Slug: "capability-artifact"
Short: "publish(html) from a page replaces the app's entry page and moves main: who may call it, what it changes, versions and rollback, the size limit, and error codes."
Topics:
- apps
- pages
- capabilities
- artifact
- publishing
Commands:
- push
- ref
- files
- mount
Flags:
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
With `artifact`, a page saves by publishing a new version of itself: the
state lives in the HTML, and each save is a new snapshot of the app with the
entry page replaced. It fits small self-contained pages where what people
see is the whole record (a checklist, a sign-up sheet edited by one admin).
For anything many people write, use `db` instead: on slop only a platform
admin can publish.

This page covers who gets the capability, what `publish` changes on the
server, how versions and rollback work, the limits, and the errors. It also
lists what slop does not implement from the claude.ai contract.

## Declaring it and who gets it

```json
{
  "title": "Checklist",
  "page": "index.html",
  "capabilities": { "artifact": {} }
}
```

(`"self"` is an old name and still works.) A view gets the `artifact`
object only when both hold:

- the store being viewed **is the app's own store** (the store whose tree
  holds this `app.json`, mounted directly), not a store that runs the app;
- the viewer is a **platform admin** (audience `admin`).

Everyone else gets `null` and should see the page read-only.

## publish(html)

```js
const artifact = await claude.use("artifact");      // null: render read-only
const { version } = await artifact.publish(html);   // version: "2" (a string)
```

- `html` is the complete next page as a string, beginning with
  `<!doctype` (case and leading spaces do not matter).
- On the server, one commit of the app store: start from the snapshot
  `main` points at, replace the entry file (`app.json` `page`, default
  `index.html`) with `html`, keep every other file (`app.json`, scripts,
  `actor.js`), take a new snapshot with the message `published from the
  page`, and move `main` to it. `version` is the new snapshot number.
- It is compare-and-set: it succeeds only if `main` still points at the
  snapshot this view is showing. Otherwise it rejects `conflict` and
  nothing changes.
- Every open view of the app reloads to the new snapshot, this one
  included, and so do views of other stores that run the app. Make
  `publish` the last act of an interaction; stash unsent input in
  `sessionStorage` if it must survive the reload.

### Building the next page

Keep the state as data in the page (a JSON `<script>` block) and build the
whole next document from it with a template function. **Never serialize the
live DOM** (`document.documentElement.outerHTML`): slop inserted its boot
data and runtime script into the head, and they would be saved into the next
version, which then loads the runtime twice.

Rules that keep versions sane:

- Publish only after a viewer acts, never on load or on a timer.
- Batch rapid edits into one publish: every call is a new snapshot.
- Keep the head, styles and structure the same; change only the data.

## Other members

| Member | On slop |
| --- | --- |
| `publish(filesMap)` | Not implemented: anything but a string rejects `invalid_content` (`this runtime publishes a complete HTML document`) |
| `edit(ops)` | Rejects `capability_removed` |
| `sync(fn)` | Calls `fn()` and resolves |
| `metadata(ids)` | A stub: `{id: {id, title: id, type: null}}` for each id |

## Versions and rollback

A publish is an ordinary snapshot, so the CLI sees and undoes it:

```bash
slop ref ls checklist                       # main: 2
slop files cat checklist index.html --at main | head
slop ref move checklist main 1              # back to the version before; views reload
slop push ./checklist --store checklist -m "from source"   # overwrites the page with your file
```

A later `slop push` from your folder replaces the published page with the
file on disk: pull the published version first if you want to keep it
(`slop files cat <app> index.html --at main > index.html`).

## Limits

- The page must start with `<!doctype`.
- In practice a publish is limited to about **320 KiB** of HTML: the
  runtime's request body cap is 256 KiB plus 64 KiB, and a larger page
  rejects `invalid_argument` (`send {method, args}`). The server's own
  16 MiB check (`too_large`) is never reached. Keep big data in `db` or
  `assets`.

## Example: a checklist that republishes itself

`app.json` as above. `index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Checklist</title></head>
<body>
<script type="application/json" id="state">{"items":[{"text":"Book venue","done":false},{"text":"Send invites","done":false}]}</script>
<ul id="list"></ul><p id="msg"></p>
<script id="app">
const APP = document.getElementById("app").textContent; // this script, reused in every version
const state = JSON.parse(document.getElementById("state").textContent);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function render(writable) {
  document.getElementById("list").innerHTML = state.items.map((it, i) =>
    `<li><label><input type=checkbox data-i=${i} ${it.done ? "checked" : ""} ${writable ? "" : "disabled"}> ${esc(it.text)}</label></li>`).join("");
}

// The whole next version, built from state: never from the live DOM, which
// holds the runtime slop injected into this page's head.
function pageFor(s) {
  const json = JSON.stringify(s).replace(/</g, "\\u003c");
  return '<!doctype html>\n<html><head><meta charset="utf-8"><title>Checklist</title></head>\n<body>\n'
    + '<script type="application/json" id="state">' + json + '<\/script>\n'
    + '<ul id="list"></ul><p id="msg"></p>\n'
    + '<script id="app">' + APP + '<\/script>\n</body></html>\n';
}

(async () => {
  const artifact = await claude.use("artifact"); // null unless a platform admin views the app's own store
  render(!!artifact);
  if (!artifact) return;
  document.getElementById("list").onchange = async (e) => {
    state.items[Number(e.target.dataset.i)].done = e.target.checked;
    try {
      await artifact.publish(pageFor(state)); // every open view reloads to the new version
    } catch (err) {
      if (err.code === "conflict") return;    // someone published first: this view is reloading
      render(false);
      document.getElementById("msg").textContent = err.code === "not_writer" ? "View only." : "Could not save: " + err.code;
    }
  };
})();
</script>
</body></html>
```

Deploy it as its own store, so the page runs on the app store itself:

```bash
slop store new checklist
slop push ./checklist --store checklist -m "first"
slop mount set apps.example /checklist checklist
slop grant set checklist @member view      # members see it; only admins can tick
```

After an admin ticks a box, `slop ref ls checklist` shows `main: 2` and the
stored `index.html` holds the new state.

## Errors

| Code | Meaning | Page should |
| --- | --- | --- |
| `conflict` | `main` moved since this view loaded (someone published or pushed); all views are reloading | Nothing: drop optimistic UI, do not retry |
| `not_writer` | The viewer is not an admin here | Switch to read-only |
| `not_granted` | The view was not granted `artifact` | Switch to read-only |
| `invalid_content` | Not a string, or it does not start with `<!doctype` | Fix the call |
| `invalid_argument` | The request was too large to read (over about 320 KiB) | Move data out of the page |
| `capability_removed` | `edit` was called | Use `publish` |
| `unavailable` | Transient | Retry once after a short random delay |

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `claude.use("artifact")` is `null` | The viewer is not a platform admin, or the page runs in a store that runs the app rather than in the app store itself | Mount and open the app store; sign in as an admin |
| Every publish rejects `conflict` | The store follows a ref other than `main` (a draft), or `main` moved after the page loaded | Publish from a view of `main`; reload and try again |
| The new version loads the runtime twice | The page saved `outerHTML` of the live DOM | Build the next page from a template, as in the example |
| `invalid_argument: send {method, args}` on publish | The page is over about 320 KiB | Keep the bulk in `db` or `assets` |
| A `slop push` wiped what people saved | The push replaced the entry page with the file on disk | `slop files cat <app> index.html --at main > index.html` before pushing; or roll back with `slop ref move` |

## See Also

- `slop help page-runtime` — `claude.use`, reloads, common errors
- `slop help capability-db` — state many people write
- `slop help deploying-apps` — refs, snapshots, rollback
- `slop help access-control` — who is a platform admin
