---
Title: "app.json: the app manifest, field by field"
Slug: "app-manifest"
Short: "Every field of app.json (title, type, page, actor, notFound, capabilities, slop.*) with its form, default, validation error and an example."
Topics:
- apps
- manifest
- capabilities
Commands:
- push
- app
- policy
- vendor
Flags:
- type
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
A store is an **app** when its tree holds `app.json`. The manifest says which
file is the page, which file is the actor, which capabilities the code asks
for, and what slop-specific extras it needs (command-line verbs, Go modules,
outbound fetch, secrets, vendored packages). This page lists every field the
server reads, the form each takes, what happens when it is missing, and the
error you get when it is wrong.

Two facts to keep in mind while reading:

- **Only platform admins push app code.** Once a store's tree or `main`
  holds `app.json`, any change to its tree or refs by someone else is refused
  with `permission_denied: only admins change app code (this store holds
  app.json; decision D9)`.
- **A bad manifest does not stop the push.** `slop push` stores the tree;
  the manifest is checked when a store activates that snapshot. The error
  shows in `slop app status <store>` as `broken: 'app.json: …'`, and the
  store keeps running its last good snapshot (`n` does not move). Run
  `slop app status` after every push.

## A complete example

This manifest uses every common field. It is the RSVP app from
`slop help tutorial-first-app`, with a few extras added for illustration.

```json
{
  "title": "RSVP",
  "type": "rsvp",
  "page": "index.html",
  "actor": "actor.js",
  "capabilities": {
    "db":     { "rules": [
                  { "path": "rsvps", "read": "view", "write": "admin" },
                  { "path": "notes", "read": "admin", "write": "admin" },
                  { "path": "notes/{self}", "read": "self", "write": "self" }
              ] },
    "user":   { "scopes": ["profile"] },
    "room":   { "topics": { "cheer": "interact" } },
    "sample": {},
    "downloads": true
  },
  "slop": {
    "verbs":   { "alias": "rsvp", "include": ["verbs/*.js"] },
    "fetch":   ["https://api.example.com"],
    "secrets": ["MAIL_TOKEN"]
  }
}
```

Fields the parser does not know are ignored, not rejected. A field of the
wrong JSON type is an error: `{"title": 5}` gives
`app.json: json: cannot unmarshal number into Go struct field Manifest.title of type string`.

## Top-level fields

These decide what the app is and which files run. All are optional; a
manifest of `{}` is valid (a plain static site).

| Field | Form | Default | Meaning |
| --- | --- | --- | --- |
| `title` | string | `""` | The app's name: the live shell's title bar and browser tab, `slop app ls`, the "create one" offer of a mount with `createApp`. |
| `type` | string | `""` | The **store type** the app runs on. Mounts made with `--createApp` give new stores this type (unless the mount names another), `slop dev` gives the dev instance this type, and an app's CLI alias finds stores by title only among stores of this type. `slop store new --app X` does **not** copy it: pass `--type` yourself. |
| `page` | relative path | `index.html` | The HTML entry: what a request for the mount root serves. |
| `actor` | relative path | none | The server-side code (`actor.js`). Without it the app has no actor. See `slop help actors`. |
| `notFound` | relative path | none | Static sites: the page a missing path gets, with status 404. Without it, a path with no file extension gets the entry page (client-side routes) and other missing files get a plain 404. |

`page`, `actor` and `notFound` must be relative paths inside the tree
(no leading `/`, no `..`, already clean). Otherwise:
`app.json: page must be a relative path in the tree`.

**Live or static.** The manifest decides which kind of host may serve the
app. An app is **live** when it declares at least one capability or has an
`actor`; it must be mounted on a live host. Anything else (no `app.json`,
or one with only `title`, `page`, `notFound`, `type`) is **plain content**
for the static host. `slop mount set` refuses the wrong host:
`… runs a live app (capabilities or an actor): mount it on a live host` or
`… is plain content: mount it on a static host`.

## capabilities

`capabilities` is an object whose keys are capability names; each value
configures one. It keeps the shape of claude.ai's artifact manifest, so
pages written for claude.ai carry over. A capability that is not declared
is `null` in the page (`await claude.use('x')`) and in the actor
(`use('x')`).

Each value may be `true`, `{}`, `null` or an object with options; the first
three mean "declared, default options". An unknown name is an error:
`app.json: capabilities: unknown capability "storage"`.

| Name | Options | Notes |
| --- | --- | --- |
| `db` | `rules`, `stores` | The store's documents. Page: `slop help capability-db`. |
| `user` | `scopes`: `["profile"]`, `["email"]` or both | Who is viewing. Without `user` the page sees no id; without `profile`, no name; `email` also needs the policy cell `user.email`. `slop help capability-user`. |
| `room` | `topics`: `{name: level}` | Presence and events. `slop help capability-room`. |
| `assets` | none | Uploads. Served to viewers at `interact` or above with an id, when the policy cell `assets` is on (members and up by default). `slop help capability-assets`. |
| `downloads` | none | Save a file through the shell's confirmation. `slop help capability-downloads`. |
| `files` | `project` (required) | Read another store's tree as a project. `slop help capability-files`. |
| `sample` | `images`: bool | Model calls. Needs the policy cell `sample` and the person's LLM access. `slop help capability-sample`. |
| `agent` | none | Server-held agent sessions (slop's extension). Governed by the `sample` policy cell. `slop help capability-agent`. |
| `artifact` | none | `publish(html)` of the app's own entry page; only in the app's own store, only for platform admins. `slop help capability-artifact`. |
| `comments` | `composer_only`: bool | Accepted for claude.ai compatibility; slop never grants it (`use('comments')` is `null`). `slop help capability-comments`. |
| `mcp` | none | Accepted; not served on slop (`null`). |
| `slop` | `permissions`: list | See below. Not needed for actor actions: every app view has `claude.use('slop')`. `slop help capability-slop`. |

### db

`db` takes `rules` (a list, at most 64) and `stores` (a level).

```json
"db": {
  "rules": [
    { "path": "board", "read": "view", "write": "admin" },
    { "path": "shelves", "read": "view", "write": "owner" },
    { "path": "shelves/{self}", "write": "interact" }
  ],
  "stores": "view"
}
```

- A rule gives the minimum **level** to read and to write a path and
  everything below it. Levels: `view`, `interact`, `admin`, `owner`, and
  `self` (nobody holds it: only a `{self}` rule below can meet it). A level
  left out is inherited from the rule above.
- Without any rule, every path needs `view` to read and `interact` to write.
- The deepest matching rule wins.
- `{self}` is allowed only as the **last** segment and matches the viewer's
  own id, so `shelves/{self}` is each person's own document.
- When a `{self}` rule has a rule at its prefix, that prefix rule must set
  both `read` and `write`.
- Segments use `A–Z a–z 0–9 _ . ~ : @ + -`, at most 200 bytes each.
- `data/users/<id>/…` is private to that person by default.
- Actor code writes as the store and is not limited by these rules; they
  govern pages and the document verbs (`slop docs …`).
- `stores` (`view`, `interact` or `admin`) asks to reach other stores'
  documents under `_stores/<id>/…` from the page, as the viewer. It also
  needs the policy cell `stores` (`slop policy set <app> stores @member on`).

Errors, as `slop app status` shows them:

| Manifest | Error |
| --- | --- |
| `{"path": "a/{self}/b"}` | `capabilities.db: rule "a/{self}/b": {self} must be the last segment` |
| `notes` with only `read`, plus `notes/{self}` | `capabilities.db: rule "notes/{self}": the rule at "notes" must set both read and write` |
| `"read": "everyone"` | `capabilities.db: rule "notes": unknown level "everyone"` |
| `"stores": "owner"` | `capabilities.db.stores: "owner" is not view, interact or admin` |

### user, room, files, sample, comments

```json
"user":   { "scopes": ["profile", "email"] },
"room":   { "topics": { "ops": "interact", "published": "admin" } },
"files":  { "project": "_stores" },
"sample": { "images": true },
"comments": { "composer_only": true }
```

- `user.scopes`: only `profile` and `email`. Otherwise
  `capabilities.user: unknown scope "phone"`.
- `room.topics`: presence is open to everyone who can view; **event topics
  are admin-only** unless listed here. A topic name matches
  `[a-z][a-z0-9_.-]{0,47}`, its level is `interact` or `admin`, at most 16
  topics. Otherwise `capabilities.room: topic "chat": level must be interact or admin`.
- `files.project` is required: `_stores` (every store the viewer may open,
  as `<store>/<path>`; the app must also be allowed `_stores` through
  `db.stores`) or the name of one of the store's read aliases
  (`slop bind set`). `{}` gives
  `capabilities.files.project: "" is not _stores or an alias name`.
- `sample.images: true` lets the page send images to the model.

### slop (the capability)

`"slop": { "permissions": ["versions:read"] }` lists management-API
permissions, checked against this set: `artifacts:read`, `versions:read`,
`versions:push`, `routes:read`, `routes:write`, `threads:read`,
`threads:write`, `events:read`. An unknown name is
`capabilities.slop: unknown permission "users:write"`. Declaring `slop` is
**not** needed to call the actor: `claude.use('slop')` (actions, `call`,
`visitor`, `signIn`, `stores`) is on every app view.

## slop: slop's own fields

Everything that is not part of the claude.ai contract sits under the
top-level `slop` object.

| Field | Form | What it does |
| --- | --- | --- |
| `slop.verbs` | `{alias?, include, title?}` | Command-line verbs for `slop on <store> …`. |
| `slop.modules` | list of `system`, `workshop` | Trusted Go modules the actor may `use()` once an admin runs `slop app trust`. |
| `slop.fetch` | list of origins | Origins the actor may request with `use('fetch')`. |
| `slop.secrets` | list of names | Secrets the actor may read with `use('secrets')`. |
| `slop.platform` | list of `stores.create`, `mounts.set`, `grants.set` | Platform operations through `use('platform')`, as the visitor. |
| `slop.imports` | `{page?: {name: path}, actor?: {name: path}}` | Bare import names for vendored packages. |
| `slop.reads` | `{alias: {type}}` | Read aliases the app expects, each with a store type. Checked for shape only. |

### slop.verbs

```json
"slop": { "verbs": { "alias": "pb", "include": ["verbs/*.js"], "title": "board/meta" } }
```

- `include` (required): 1 to 16 globs of the verb files **and** every file
  they `require`, relative to the tree (no leading `/`, no `..`).
- `alias`: a short command, so `slop pb <store> …` works like
  `slop on <store> …`. A lowercase letter followed by up to 15 lowercase
  letters, digits or `-`.
- `title`: a document path whose `title` field names a store, so the alias
  accepts a title instead of an id (`slop pb Kitchen clip ls`), searched
  among your stores of the app's `type`.

Errors: `slop.verbs.include: 1 to 16 globs`,
`slop.verbs.alias: a lowercase word of at most 16 letters, digits or -`,
`slop.verbs.include: "/x" is not a relative glob in the tree`,
`slop.verbs.title: "…" is not a document path`. Writing the verbs
themselves: `slop help app-verbs`.

### slop.modules

```json
"slop": { "modules": ["workshop"] }
```

Declares a trusted module; it stays `null` in the actor until a platform
admin runs `slop app trust <app> workshop`. `system` covers people, grants,
links, mounts, policy, LLM budgets and secrets; `workshop` covers stores,
snapshots, refs and files (drafts, publishing, dev instances). Both act as
the visitor. Anything else is `slop.modules: unknown "shell"`.

Modules that are on by default (`database`, `express`, `fs`, `path`,
`buffer`, `crypto`, `events`, `yaml`) need no declaration;
`slop app trust <app> database --config '{"maxRows":500}'` only configures
one. `slop app modules` lists the catalog with each module's TypeScript
declaration and configuration schema.

### slop.fetch, slop.secrets, slop.platform

```json
"slop": {
  "fetch":    ["https://api.example.com"],
  "secrets":  ["MAIL_TOKEN"],
  "platform": ["stores.create", "grants.set"]
}
```

Each list makes a policy row appear for the app (`slop policy ls <app>`),
and each is **off for every audience** until an admin turns it on:

```bash
slop policy set myapp fetch @member on
slop secret set myapp MAIL_TOKEN …      # the value; the actor reads it by name
```

Until then `use('fetch')`, `use('secrets')` and `use('platform')` are `null`
in the actor. `fetch` reaches only the listed origins (scheme, host and
port). `platform` calls run as the visitor (or as the store for alarms and
reactors), so they can do only what that person could. An unknown platform
entry is `slop.platform: unknown "people.set"`.

### slop.imports

Written by `slop vendor add`, which bundles npm packages into `vendor/`:

```json
"slop": { "imports": { "page": {
  "preact": "vendor/preact@10.24.3/preact.js",
  "preact/hooks": "vendor/preact@10.24.3/hooks.js"
} } }
```

Pages get `page` as an import map (`import { h } from 'preact'` in a
`<script type="module">`); the actor's `require` finds `actor` names after
slop's own modules. At most 256 names per side; names are bare package names
with an optional subpath (`lit`, `@lit/context`, `preact/hooks`), paths are
relative paths in the tree. Errors:
`slop.imports.page: "./x" is not a bare import name`. Edit this block
through `slop vendor`, not by hand (`slop help deploying-apps`).

## Other files the server reads from the tree

The manifest is not the only file with a meaning:

| Path | Meaning |
| --- | --- |
| `sql/*.sql` | Migrations for the store's SQL tables, applied in name order when a store activates a snapshot, in the same transaction as the actor's `setup`. Only files directly in `sql/`. An applied migration must never change: add a new file. |
| `verbs/*.js` (or whatever `slop.verbs.include` names) | Command-line verbs. |
| `vendor/` | Packages written by `slop vendor`, with `vendor/vendor.json` as the lock. |

`slop app status <store> --migrations` lists the migrations a store has
applied, with their sha256.

## Examples by kind of app

A static site needs no manifest, or only a not-found page:

```json
{ "title": "Notes", "notFound": "404.html" }
```

A page-only app (live host, no actor):

```json
{ "title": "Boards", "page": "index.html", "capabilities": { "user": { "scopes": ["profile"] } } }
```

An actor-only API (routes built with `require('express')`):

```json
{ "title": "Hello API", "actor": "actor.js" }
```

An app with an actor that uses the trusted `workshop` module:

```json
{ "title": "Blocks site", "type": "blocks-site", "actor": "actor.js",
  "capabilities": { "db": {} }, "slop": { "modules": ["workshop"] } }
```

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `slop app status` shows `broken: 'app.json: …'` | The manifest failed a check above; the store stays on its last good snapshot | Fix the field the message names, push again |
| `broken: 'actor_error: actor.js is not in myapp@22'` | `actor` names a file the tree does not have | Push the file, or fix the path |
| `permission_denied: only admins change app code` | You are not a platform admin, and the store holds `app.json` | Ask an admin to push; app code is admin-only |
| `… is plain content: mount it on a static host` | No capability and no actor, or the app has never had a good manifest | Declare what the page uses; check `slop app status` |
| `claude.use('x')` is `null` | Not declared, or its policy cell is off for the viewer's audience | Add it under `capabilities`; `slop policy ls <app>` |
| `use('fetch')` / `use('secrets')` / `use('platform')` is `null` in the actor | The list is empty, or the policy cell is off | Fill `slop.fetch` etc.; `slop policy set <app> fetch @member on` |
| `use('workshop')` is `null` | Declared but not trusted | `slop app trust <app> workshop` (platform admin) |
| `invalid_argument: <app> does not declare fetch, so it cannot be turned on` | `policy set` for a capability the running version does not declare | Push a manifest that declares it first |
| A store made with `store new --app` is not found by a typed mount | `store new` does not copy the manifest's `type` | `slop store new <id> --app <app> --type <type>`, or `slop store type <id> <type>` |
| Activation fails: `migration sql/001_x.sql changed after it was applied` | An applied migration was edited | Restore it and add `sql/002_…sql` |

## See Also

- `slop help building-apps` — choosing a kind of app and its capabilities
- `slop help deploying-apps` — push, stores, mounts, grants, policy
- `slop help tutorial-first-app` — a manifest in use, end to end
- `slop help actors` — what `actor` points at
- `slop help app-verbs` — what `slop.verbs` points at
- `slop help page-runtime` — `claude.use(name)` in the page
- `slop help access-control` — levels, groups and policy cells
