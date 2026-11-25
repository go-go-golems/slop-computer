---
Title: "The page runtime: window.claude"
Slug: "page-runtime"
Short: "How an app page reaches the server: the frame it runs in, claude.use(name), which capabilities a viewer gets, errors, and how slop differs from claude.ai Artifacts."
Topics:
- apps
- pages
- runtime
- capabilities
Commands:
- push
- mount
- policy
- app
- explain
Flags:
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
An app's pages talk to slop through one global object, `window.claude`. A
page asks for a **capability** by name with `claude.use(name)` and gets
either an API object or `null`. Everything a page does to the server (read
and write documents, upload files, call the actor, ask a model) goes through
an object it got this way. This page explains where that object comes from,
when `use()` answers `null`, the list of capabilities, and the error codes
the calls reject with. Each capability has its own page, named below.

The API is the claude.ai Artifact runtime contract, so a page written for a
claude.ai Artifact runs on slop, and the reverse mostly holds too. The
section "How slop differs from claude.ai" lists the differences.

## How a page gets window.claude

You never load the runtime yourself. When slop serves an HTML document of
an app (a `.html` file that begins with `<!doctype`, `<html` or `<head>`),
it inserts two tags first in its `<head>`:

```html
<script type="application/json" id="slop-boot">{"mode":"app","parentOrigin":"http://apps.example", …}</script>
<script src="/_slop/claude.js?v=…"></script>
```

so `window.claude` exists before any of your scripts run. This happens for
the entry page (`app.json` `page`, default `index.html`) and for every other
HTML page of the app (`about.html`).

The page runs inside a frame:

1. A visitor opens a **mount** on the **live host**, for example
   `https://apps.example/notes`. The live host answers with the **shell**: a
   small top-level page that handles sign-in, sharing and confirmation
   dialogs.
2. The shell opens a **view** (one open page of one store for one person)
   and frames the app at `/v/<snapshot>/` on the store's **sandbox origin**,
   `s<20 hex>.<sandbox host>`. Each store and app pair has its own origin, so
   one app's pages cannot read another's cookies or storage. The origin
   stays the same across versions, so `localStorage` survives a new push.
3. The shell hands the frame a view secret. The runtime sends it as a bearer
   token on every call (to `/_rt/rpc`, `/_rt/events`, `/_rt/assets` on the
   sandbox origin) and never sends cookies.
4. The runtime opens one event stream for the view. Document changes, room
   events and reload notices arrive on it.

Consequences worth knowing:

- An app with capabilities or an actor can only be mounted on a live host.
  `slop mount set` on a static host refuses it (`invalid_argument: … runs a
  live app (capabilities or an actor): mount it on a live host`).
- Opening the sandbox URL directly, without the shell around it, gives a
  page whose every `claude.use(...)` resolves to `null` (only `permissions`
  is an object). Always test through the mount.
- When the app's `main` ref moves (a `slop push`, a publish from a page),
  every open view of the app is told to reload and the shell reopens it on
  the new snapshot.
- When the viewer's access changes (a grant removed, a sign-in), the shell
  opens a fresh view and the frame reloads.
- When the view is closed for good (access withdrawn), calls reject with
  `revoked` and subscriptions end with that code.
- The page's URL fragment (`#…`, at most 1024 characters) is mirrored into
  the shell's address bar, so deep links into a page work.

## claude.use(name)

```js
const db = await claude.use("db");   // the API object, or null
```

- Returns a Promise that never rejects. It resolves to the capability's
  object, or to `null` when this view cannot use it: the app does not
  declare it in `app.json`, the server does not grant it to this viewer
  (level, policy, sign-in), the name is unknown, or the page is not in a
  shell. A failure while connecting is logged as a console warning and
  resolves to `null`.
- The answer is computed once per name and remembered for the life of the
  page. Calling `use()` again is cheap.
- The first call waits for the shell to hand over the view (up to about 10
  seconds) and for the stream's first message (up to about 15 seconds more).
- `"self"` is an old name for `"artifact"` and still works.

Treat `null` as "this feature is off for this viewer" and render something
useful without it. A guest, a viewer below `interact`, or a person without
LLM access sees a page with fewer capabilities, not a broken one.

## Declaring capabilities in app.json

A page gets only what its app declares under `capabilities` in `app.json`.
A value is `{}`, `true`, or an object with options:

```json
{
  "title": "Notes",
  "page": "index.html",
  "capabilities": {
    "db": { "rules": [{ "path": "notes", "read": "view", "write": "interact" }] },
    "user": { "scopes": ["profile"] },
    "assets": {},
    "sample": {}
  }
}
```

An unknown name breaks the app: the push succeeds, then `slop app status <store>` shows `broken: 'app.json: capabilities: unknown capability "x"'` and the store stays on its last good snapshot.
`slop app status <store>` shows the capabilities of the snapshot a store
runs. Every option is described on `slop help app-manifest` and on each
capability's page.

## The capabilities

Declaring a capability is necessary, not sufficient: the server decides per
viewer. "Granted when" is what the server checks when it opens the view.

| Name | What it is | Granted when (besides being declared) | Page |
| --- | --- | --- | --- |
| `db` | Realtime JSON documents of the store, with per-path rules | always | `capability-db` |
| `user` | Who is viewing: id, level, profile names, `can()` | always (the `email` scope also needs the `user.email` policy cell) | `capability-user` |
| `room` | Presence and live events between open views | always | `capability-room` |
| `assets` | Files people upload (images, PDFs, data) | the viewer has an id, holds `interact` or more, and the `assets` policy cell is on for their audience | `capability-assets` |
| `downloads` | Hand the viewer a file to save | always (the shell asks the viewer) | `capability-downloads` |
| `files` | Read a store's snapshot files | the manifest names a `project` the view can reach | `capability-files` |
| `artifact` | The page republishes itself as a new app version | the viewed store is the app's own store and the viewer is a platform admin | `capability-artifact` |
| `sample` | One model call | the viewer has an id and the `sample` policy cell is on for their audience; each call also needs LLM access | `capability-sample` |
| `agent` | Server-held agent sessions | as `sample` | `capability-agent` |
| `slop` | slop's own API: call the actor, read bound stores, the visitor | always, on every app view, declared or not | `capability-slop` |
| `comments` | Comment threads | never in this version: `use("comments")` is `null` | `capability-comments` |
| `mcp` | The viewer's connectors | never: `null` | — |
| `permissions` | Built in, never declared: capability states | always | below |

Policy cells are set per app and audience by an admin:
`slop policy ls <app>`, `slop policy set <app> assets @guest on`. See
`slop help access-control`.

## permissions (built in)

`permissions` is always an object, even outside a shell.

| Call | Resolves to |
| --- | --- |
| `state()` | `{name: state}` for every capability the view was granted, e.g. `{"db": "granted", "slop": "granted", "user": "granted"}` |
| `state(name)` | `"granted"`, `"denied"` or `"unavailable"` (not granted to this view) |
| `request(names?)` | the same map for `names` (default: all), after asking the viewer about any in state `"prompt"` |
| `manage()` | resolves once the shell answers; rejects `unavailable` without a shell |

In this version every capability the server grants is reported `granted`
from the start, so no consent dialog appears and `request()` returns at once.
Write pages so they still work if a capability later starts in `prompt`.

## Errors

Every rejection is an `Error` with a string `code` and a `message`. A few
carry more (`confirm` on `confirmation_required`, `text` on some `sample`
errors). Branch on `code`, show `message` only in developer tools, and treat
an unknown code like `unavailable`.

```js
try {
  await db.doc("notes/n1").set({ text: "hi" });
} catch (e) {
  if (e.code === "invalid_argument") showReadOnly();   // below the rules, or a bad body
  else if (e.code === "revoked") showClosed();
  else showRetry();
}
```

Codes common to every capability:

| Code | Meaning | What the page should do |
| --- | --- | --- |
| `unavailable` | No shell around the page, no view yet, the server did not answer, or a transient failure | Retry once after a short random delay; subscriptions retry on their own |
| `revoked` | The view was closed: access withdrawn or expired for good | Render the read-only or signed-out state; every call fails from now on |
| `not_granted` | The view was not granted that capability, or the call needs more access than the view has (`assets.list needs more access than this view has`) | Hide the feature |
| `capability_removed` | A method this server does not serve (`artifact.edit`) | Do not call it |
| `invalid_argument` | Bad arguments, or a write the viewer may not make | Fix the call, or switch to read-only |
| `permission_denied` | An actor action needs a higher level (`addNote needs interact; you have view`) | Hide the control for this level |
| `not_found` | No such action, actor, alias or file | Fix the name |
| `confirmation_declined` | The person said no to a change the app asked to make for them | Leave things as they are |

Each capability page lists its own codes. Synchronous mistakes in your own
code (a db path with the wrong number of segments) throw a `TypeError` at
once instead of rejecting.

## A minimal page

`app.json`:

```json
{
  "title": "Hello",
  "page": "index.html",
  "capabilities": { "db": {}, "user": { "scopes": ["profile"] } }
}
```

`index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Hello</title></head>
<body>
<p id="who">…</p><ul id="list"></ul>
<form id="add" hidden><input id="text" required><button>Add</button></form>
<script>
const $ = (id) => document.getElementById(id);
(async () => {
  const db = await claude.use("db");
  const user = await claude.use("user");
  if (!db) { $("who").textContent = "Open this page through its mount."; return; }
  const me = await user.me();                        // {id, name, audience, level, guest, …}
  $("who").textContent = (me.name || "Guest") + " · " + me.level;
  $("add").hidden = !(await user.can("data.write"));
  db.collection("lines").orderBy("at").onSnapshot((snap) => {
    $("list").replaceChildren(...snap.docs.map((d) =>
      Object.assign(document.createElement("li"), { textContent: d.data().text })));
  }, (e) => { $("who").textContent = "Stopped: " + e.code; });
  $("add").onsubmit = async (e) => {
    e.preventDefault();
    await db.collection("lines").add({ text: $("text").value, at: Date.now() })
      .catch((err) => alert(err.code));
    $("text").value = "";
  };
})();
</script>
</body></html>
```

Deploy and open it:

```bash
slop store new hello
slop push ./hello --store hello -m "first"
slop mount set apps.example /hello hello
slop grant set hello @member interact     # signed-in people may add lines
```

## How slop differs from claude.ai

The call shapes are the same; what differs is who may call and what backs
the call. claude.ai's viewer roles map to store **levels** (`view` <
`interact` < `admin` < `owner`) from grants, share links and audiences, and
db rules and room topic levels use the same level names, so manifests carry
over.

| Capability | On slop |
| --- | --- |
| `db` | Same API and limits. The documents are the store's own, visible to the CLI (`slop docs …`) and the actor. A page can also reach other stores through aliases and `_stores/<id>/…`. Seeding and reading from outside is `slop docs`, not a data tool. |
| `user` | Same calls. `me()` adds `audience`, `level`, `guest`, `subscribed` and `llm {allowed, remaining}`. `avatarUrl` is `""`; draw initials on `color`. |
| `room` | Same calls; `room.topics` levels are enforced. `canSendToClaudeSession` always answers no. |
| `assets` | Same methods; SVG is refused (`unsupported_type`); granted by level and the `assets` policy cell. |
| `downloads` | Same, with the shell's "Save a file?" dialog. |
| `artifact` | Only `publish(html)`; the files form is refused; only a platform admin on the app's own store. `edit` is `capability_removed`, `metadata` is a stub. |
| `sample` | Same call shape, but slop's configured model backend answers, not Claude. Needs the policy cell and the person's LLM access; metered against a monthly budget (`quota_exceeded`). |
| `comments`, `mcp` | Not served: `null`. |
| `permissions` | Same calls; every granted capability reads `granted`. |
| `slop`, `agent` | slop only. |

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| Every `claude.use()` is `null` | The page was opened on its sandbox URL, not through the mount, or it never got a view | Open the mount URL (`slop mount ls`); look for a sign-in prompt in the shell |
| `claude.use("db")` is `null` but others work | `db` is not in `app.json` `capabilities`, or the store runs an older snapshot | `slop app status <store>` shows the running manifest; push again |
| `assets` or `sample` is `null` for some people | Level below `interact`, a guest, or the policy cell is off for their audience | `slop policy ls <app>`; `slop explain can <store> interact --subject <who>` |
| `artifact` is `null` | The store is not the app's own store, or the viewer is not a platform admin | Open the app store itself as an admin; see `capability-artifact` |
| `window.claude` is undefined | The file is not served as an app document (a fragment, not starting with `<!doctype`/`<html>`/`<head>`) or the mount is on a static host | Start the page with `<!doctype html>`; mount on a live host |
| The page reloads by itself | `main` moved (a push or a publish) or the viewer's access changed | Expected; keep unsent input in `sessionStorage` if it must survive |
| Calls fail with `revoked` | The view was closed for good | Render the degraded state; a reload opens a new view if access remains |
| `slop app status` shows `broken: … unknown capability` after a push | A typo, or a name slop does not know | Use one of the names in the table above |

## See Also

- `slop help capability-db` — documents, rules, queries, subscriptions
- `slop help capability-slop` — calling the actor from a page
- `slop help capability-assets`, `slop help capability-artifact`
- `slop help capability-user`, `slop help capability-room`, `slop help capability-sample`, `slop help capability-agent`
- `slop help app-manifest` — every `app.json` field
- `slop help access-control` — levels, grants, policy cells
- `slop help building-apps` — choosing capabilities, page vs actor
