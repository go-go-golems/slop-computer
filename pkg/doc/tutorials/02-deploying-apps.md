---
Title: "Deploying apps: push, refs, stores, mounts, grants and policy"
Slug: "deploying-apps"
Short: "Put an app on a server and keep it there: push and snapshots, refs and drafts, stores that run the app, mounts on live and static hosts, grants, policy, trust, a repeatable script."
Topics:
- apps
- deployment
- mounts
Commands:
- push
- pull
- store
- app
- ref
- snap
- dev
- mount
- grant
- link
- policy
- llm
- secret
- vendor
Flags:
- ifAt
- ref
- app
- type
- storeParam
- createApp
- createAudience
- api
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: Tutorial
---
Deploying an app on slop is five separate decisions, each with its own
command: **where the code lives** (a store you push to), **which version
runs** (refs and snapshots), **whose data it runs on** (stores that run the
app), **where people reach it** (mounts on a host), and **who may do what**
(grants, policy cells, trust). This page walks through each, with commands
run on a local server, and ends with a script that does all of it again
without changing anything that is already right.

If you have never deployed an app, do `slop help tutorial-first-app` first:
it uses the same commands on a small app. Commands below use the hosts of a
local server (`apps.localhost:18300` live, `site.localhost:18300` static);
`slop server hosts` prints yours.

```bash
$ slop server hosts
live:
    - apps.localhost:18300
main: slop.localhost:18300
sandbox: sbx.localhost:18300
static:
    - site.localhost:18300
```

## 1. The app's store and `slop push`

An app's code is the **tree** of a store: a set of files, versioned. `slop
push <dir>` replaces the tree with the folder and freezes it as a new
**snapshot**, then points a **ref** (`main` unless you say `--ref`) at it.

```bash
$ slop store new guestbook
id: guestbook
owner: usr_d9f77f667dc0772b2db2fee6
$ slop push guestbook -m "first version"
files: 4
"n": 1
removed: 0
rev: 2
$ slop push guestbook -m "again"          # nothing changed
files: 4
"n": 1
removed: 0
```

How push behaves:

- **The store id defaults to the folder's name.** `slop push ./src --store
  guestbook` pushes another folder.
- **The folder replaces the tree.** Files the folder does not have are
  deleted (`removed` counts them). Files and folders whose name starts with
  `.` are skipped (so `.git` never goes up), and so are symlinks.
- **Only changed bytes travel.** The CLI sends the list of paths with their
  sha256; the server answers with the blobs it lacks, and only those are
  uploaded, in 32 MiB requests.
- **An unchanged tree keeps the ref's snapshot.** The second push above
  answers `n: 1` again and makes no snapshot. Reruns are free.
- **Push is a compare-and-swap on the ref.** `--ifAt N` pushes only if the
  ref points at snapshot `N` now (`0`: the ref does not exist yet). Without
  `--ifAt`, the CLI reads the ref just before pushing. If someone moved it
  in between, nothing is written:

  ```bash
  $ slop push guestbook -m "v2" --ifAt 0
  error: conflict: main points at 1, not 0: it moved since you looked
  ```

  Use `--ifAt` in scripts when you want "only if nobody published since I
  looked".
- **Only platform admins push app code.** A store whose tree or `main`
  holds `app.json` refuses tree and ref changes from anyone else:
  `permission_denied: only admins change app code (this store holds
  app.json; decision D9)`. Static sites without `app.json` can be pushed by
  anyone with `admin` on the store (its owner, for example).

Related commands: `slop snap ls <store>` lists snapshots, `slop ref ls
<store>` lists refs, `slop pull <store> <dir>` writes a tree back into a
folder, and `slop files commit <store> …` changes some files without
replacing the rest (it takes `--base`, the snapshot your change starts
from, and merges over newer snapshots unless the same paths changed).

## 2. Is it running? `slop app status`

`slop push` never parses your code. The manifest and the actor are checked
when a store **activates** a snapshot: on its next page view or event, or
right away when you ask for its status:

```bash
$ slop app status guestbook
app: guestbook
broken: ""
manifest:
    actor: actor.js
    capabilities:
        - db
        - sample
        - user
    live: true
    page: index.html
    slop: {}
    title: Guestbook
    type: guestbook
"n": 2
ref: main
store: guestbook
```

- `n` is the snapshot the store runs, `ref` the ref it follows.
- `broken` is empty when all is well. Otherwise it names the failure, and
  the store **stays on its last good snapshot**:
  `broken: 'setup: Error: boom at setup (actor.js:4:31(3))'`,
  `broken: 'app.json: capabilities: unknown capability "storage"'`,
  `broken: 'activation of journal@2 failed: migration sql/001_posts.sql changed after it was applied; add a new migration instead'`.
- `--peek` reports without activating; `--migrations` lists the
  SQL migrations the store has applied, with their sha256.
- `slop app logs <store>` shows the actor's recent `console.log` and
  `ctx.log` lines; `slop app restart <store>` clears a broken actor and
  retries activation.

## 3. Stores that run the app

The app store runs its own app, which is enough for a single instance. For
several instances with separate data (boards, events, workspaces), make
stores that **run** the app:

```bash
$ slop store new lobby --app guestbook --type guestbook
app: guestbook
id: lobby
type: guestbook
```

- `--app` names the app store. The new store follows the app's `main`.
- `--type` sets the store type. It is not copied from the manifest's
  `type`, so pass it if a typed mount or the app's CLI alias should find
  this store. `slop store type <id> <type>` changes it later.
- Without an id, `store new` makes one (`s-maq7jj2a`).

Each store activates a new snapshot of its ref on its next view or event.
To make a store run another ref, `slop app follow <store> <ref>`:

```bash
$ slop app follow lobby draft      # run unpublished code on lobby's data
$ slop app follow lobby main       # back
```

To pin a store to a snapshot, give that snapshot a ref and follow it:

```bash
$ slop ref move guestbook stable 1
stable: 0 → 1
$ slop app follow lobby stable
```

Ref names are lowercase, start with a letter, and have up to four
`/`-separated segments (`main`, `draft`, `proposal/p8k2x1`).
`slop ref rm <store> <ref> --ifAt <n>` removes one (its snapshots stay); it
refuses `main` and any ref a store follows:
`conflict: party follows rsvp@stable: make it follow another ref first (app.follow)`.

## 4. Drafts, `slop dev` and publishing

Mounts serve stores, and stores follow `main`, so pushing to `main` changes
production. While working, push to the `draft` ref instead and run it in a
**dev instance**: your own store of the app, with its own data, that
follows `draft`. `slop dev` does all of that:

```bash
$ slop dev guestbook --once
made dev instance guestbook-dev-d9f77f (runs guestbook)
draft 4 · guestbook-dev-d9f77f on 4 · ok
dev instance guestbook-dev-d9f77f follows guestbook@draft; publish with: slop ref move guestbook main 4
```

- The instance is named `<app>-dev-<first six hex digits of your id>`
  (`--instance` picks another) and gets the manifest's `type`.
- Without `--once`, it watches the folder (`--every`, default 500ms) and
  pushes on every change, printing one line per push and then the
  instance's new log lines.
- When activation fails, the instance stays on its last good snapshot and
  the line says why:

  ```text
  draft 5 · guestbook-dev-d9f77f stays on 4 · broken: activation of guestbook@5 failed: setup: Error: boom at setup (actor.js:4:31(3))
  ```

  `slop dev --once` exits 0 even then, and still suggests publishing: read
  the line, or check `slop app status <instance>`.
- To see the instance in a browser, mount the type with a `:param` (section
  5) and open `/<path>/<instance>`.

**Publish** by moving `main` to the draft's snapshot. Every ref move is a
compare-and-swap: the CLI reads where `main` is unless you pass `--ifAt`,
and prints the move.

```bash
$ slop ref ls guestbook
draft: 6
main: 2
$ slop ref move guestbook main 6 --ifAt 1
error: conflict: main points at 2, not 1: it moved since you looked
$ slop ref move guestbook main 6
main: 2 → 6
from: 2
```

`from` is the snapshot to roll back to: `slop ref move guestbook main 2`.
Stores following `main` pick up the new snapshot on their next view.

**Migrations only add.** `sql/*.sql` files are applied in name order on
activation and recorded with their sha256. Changing one that a store
already applied breaks activation everywhere (`migration … changed after it
was applied`): add `sql/002_….sql` instead. A dev instance whose
migrations you rewrote is easiest to remove (`slop store rm <instance>`)
and let `slop dev` make again.

## 5. Mounts: giving a store an address

A **mount** is a host plus a path pattern pointing at a store. It never
names code; the store's app does. `slop mount set <host> <path> [store]`
takes the host, path and store as positional arguments.

### Live or static host

| Host | Serves | Sessions | Mount there |
| --- | --- | --- | --- |
| live (`apps.…`) | the shell, which frames the app's page on the store's sandbox origin; actor routes | yes: sign-in, guests, share links | stores whose app declares a capability or has an actor |
| static (`site.…`) | the store's files as they are | no: every visitor is an anonymous guest | plain content (no `app.json`, or one without capabilities and actor) |

The server refuses the wrong one:

```bash
$ slop mount set site.localhost:18300 /lobby lobby
error: invalid_argument: lobby runs a live app (capabilities or an actor): mount it on a live host
$ slop mount set apps.localhost:18300 /notes notes-site
error: invalid_argument: notes-site is plain content: mount it on a static host
```

### A fixed store

```bash
$ slop mount set site.localhost:18300 /notes notes-site
mount:
    host: site.localhost:18300
    path: /notes
    store: notes-site
note: 'a static host serves guests only, and guests cannot read notes-site: grant @guest view to publish it'
url: http://site.localhost:18300/notes
$ slop grant set notes-site @guest view
```

The `note` tells you when visitors will be refused. On the static host,
after the grant: `/notes` answers `308` to `/notes/` (so relative URLs
resolve under the mount), `/notes/` serves `index.html`, a path without a
file extension serves the entry page (client-side routes), and a missing
file is `404`, or the manifest's `notFound` page with `404`.

### One mount for many stores: `:param`, `--storeParam`, `--type`

```bash
$ slop mount set apps.localhost:18300 /g/:store --storeParam store --type guestbook
```

- The path names the store: `/g/lobby` opens `lobby`. `--storeParam` must
  name a `:param` of the path (it is not inferred:
  `give a store, or storeParam (a :param of the path)`).
- `--type` restricts it to stores of that type. A store of another type, or
  no store, answers `no_instance: nothing is here yet`.
- `--type` and `--createApp` go only with `--storeParam`.

A path is `/`, or literal segments (`/name`, `/site/list`), optionally ending in
one `:param` or `*` (`/name/:param`, `/name/*`). Among mounts on
one host, a literal segment beats a `:param`, and a longer path beats a
shorter one.

### Letting people create stores from the URL: `--createApp`

```bash
$ slop mount set apps.localhost:18300 /gb/:store --storeParam store --createApp guestbook
mount:
    createApp: guestbook
    createAudience: member
    host: apps.localhost:18300
    path: /gb/:store
    storeParam: store
    type: guestbook
```

At a path with no store yet, the shell offers to create one of the app
(the new store's owner is the person who created it). `--createAudience`
(`member` by default, or `subscriber`, `admin`) says who may. `--type`
defaults to the app's manifest `type`. Only live hosts create stores.
`--aliases '[{"alias":…,"target":…}]'` binds a read alias in every store the
mount creates (`slop help capability-db`, "Other stores"; pages read them with
`stores.open`, `slop help capability-slop`).

### Actor routes and the API policy: `--api`

An actor's HTTP routes are served under its mount. Without `--api`, every
route is served at the level it declares. An API policy narrows that to an
allowlist and adds floors and host middleware:

```bash
$ slop mount set apps.localhost:18300 /journal myjournal --api '{"routes":["GET /feed.json"]}'
$ curl -s -o /dev/null -w "%{http_code}\n" http://apps.localhost:18300/journal/feed.json
404
$ slop mount set apps.localhost:18300 /journal myjournal --api '{"routes":["GET /feed.json"],"defaultMin":"public","middleware":[{"name":"rateLimit","config":{"per":"ip","limit":2}}]}'
$ for i in 1 2 3; do curl -s -o /dev/null -w "%{http_code} " http://apps.localhost:18300/journal/feed.json; done
200 200 429
$ slop mount routes apps.localhost:18300 /journal
- allowed: true
  audiences: []
  declaredLevel: public
  effectiveLevel: public
  key: GET /feed.json
  store: myjournal
```

- **`defaultMin` is `view`** when you write an API policy: a public route
  answers `404` to guests until you set `"defaultMin": "public"`.
- A route outside the allowlist, or a visitor with no level, answers `404`;
  a visitor whose level is too low answers `403` `permission_denied`.
- Fields: `routes` (required allowlist, `"METHOD /pattern"`), `prefix`,
  `floors` (`[{route, min?, audience?}]`), `defaultMin`, `middleware`
  (`rateLimit` `{per: ip|visitor, limit, window?, burst?}`, `cors`
  `{origins, maxAgeSeconds?}`, `apiToken` `{required?}`), `responseTypes`,
  `forwardHeaders`, `maxBodyBytes` (default 1 MiB, at most 8 MiB),
  `maxResponseBytes` (default 4 MiB, at most 32 MiB). API policies go on
  live hosts only.

### Listing, removing, undoing

```bash
$ slop mount ls                                   # every mount, with kind and url
$ slop mount rm apps.localhost:18300 /journal
removed: apps.localhost:18300/journal
$ slop mount undo apps.localhost:18300 /journal   # back to before the last change
restored:
    api: …
```

`mount set`, `rm` and `undo` need a platform admin.

## 6. Grants: who may open and use a store

A mount gives a store an address; **grants** decide who gets in, as a
**level** (`view` < `interact` < `admin` < `owner`). Subjects are people
(`usr_…`; `slop people ls` finds the id, an email is refused), guests
(`vis_…`), `store:<id>`, or groups (`@guest`, `@member`, `@subscriber`;
each group includes the ones after it).

```bash
$ slop grant set lobby @guest view         # anyone, signed in or not, may look
$ slop grant set lobby @member interact    # everyone with an account may take part
$ slop grant ls lobby
$ slop explain can lobby interact --subject bob@example.com
```

- Without a `@guest` grant, visitors must sign in; with none at all, only
  the owner and admins get in.
- A **share link** gives whoever opens it a level without an account:
  `slop link new lobby view` prints a token once; append `?k=<token>` to
  the store's URL. `slop link rm` revokes it at once.
- Actor actions check their own `requires` against these levels; `db`
  rules check them per path. See `slop help access-control`.

## 7. Policy cells, LLM access and secrets

Some capabilities cost money or reach outside the store. Each app has a
**policy matrix**: capability × audience, on or off. Rows exist only for
what the running version declares: `assets`, `sample` (also governs
`agent`), `user.email`, `fetch`, `secrets`, `platform`, `stores`. All are
off by default except `assets` for members and up.

```bash
$ slop policy set guestbook sample @member on
$ slop policy ls guestbook -o json | jq -c '.cells[] | {audience, allowed, effective}'
{"audience":"guest","allowed":false,"effective":false}
{"audience":"member","allowed":true,"effective":true}
{"audience":"subscriber","allowed":false,"effective":true}
{"audience":"admin","allowed":false,"effective":true}
{"audience":"store","allowed":false,"effective":false}
$ slop policy set guestbook fetch @member on
error: invalid_argument: guestbook does not declare fetch, so it cannot be turned on
```

A cell turned on for `@member` is in effect for subscribers and admins too.
The `store` column is the store acting on its own (alarms, reactors).

A model call also needs the **person's LLM access** (or the store's, for
alarms): `slop llm set @member on --budget 200000`. See
`slop help llm-access`. Secrets the actor reads are set per app with
`slop secret set <app> <name> <value>` and must be listed in `slop.secrets`.

## 8. Trusting an app with a Go module

The `system` and `workshop` modules act on the platform as the visitor. An
app declares them in `slop.modules`, and a platform admin trusts it:

```bash
$ slop app trust guestbook workshop
error: invalid_argument: guestbook does not declare workshop in app.json slop.modules
$ slop app trust guestbook database --config '{"maxRows":500}'
app: guestbook
config:
    maxRows: 500
module: database
trusted: true
```

Modules on by default (`database`, `express`, `fs`, …) need no trust; a
trust only configures them, checked against the module's schema
(`database's configuration has no field "bogus"`). `slop app untrust`
withdraws; `slop app modules [app]` lists the catalog and what an app
holds. A trust lapses if the admin who gave it stops being an admin.

## 9. A repeatable deploy script

Deploys should be scripts you can rerun: each step either changes nothing
or sets the same value again. This one deploys the RSVP app from
`slop help tutorial-first-app`:

```bash
#!/usr/bin/env bash
# deploy.sh: put the RSVP app and one event on a server. Safe to run again:
# every step either changes nothing or sets the same value.
set -euo pipefail
LIVE=${LIVE:-apps.localhost:18300}       # slop server hosts lists yours
APP=rsvp EVENT=party DIR=${DIR:-./rsvp}

ensure_store() {                          # ensure_store <id> [store new flags…]
  slop store meta "$1" >/dev/null 2>&1 || slop store new "$@" >/dev/null
}

ensure_store "$APP"
slop push "$DIR" --store "$APP" -m "deploy $(date -u +%FT%TZ)" -o json | jq -c '{n, files, removed}'
ensure_store "$EVENT" --app "$APP" --type rsvp
slop app status "$EVENT" -o json | jq -c '{store, app, n, broken}'
slop grant set "$EVENT" @guest view >/dev/null
slop grant set "$EVENT" @member interact >/dev/null
slop mount set "$LIVE" /party "$EVENT" -o json | jq -c '{url, note}'
```

Run twice; the second run prints the same snapshot, because the tree did
not change:

```text
{"n":2,"files":4,"removed":0}
{"store":"party","app":"rsvp","n":2,"broken":""}
{"url":"http://apps.localhost:18300/party","note":null}
```

Extend it with `slop policy set` and `slop app trust` lines for what the
app needs, and fail the deploy when `broken` is not empty. To deploy to
another server, set `SLOP_SERVER` (and `SLOP_CREDENTIALS` for a separate
login) and `LIVE`.

## 10. Several stores as one site

A site can be one store with the shared files plus one store per section,
on nested mounts. Each section deploys alone; shared files are loaded by
absolute path from the root store:

```bash
$ slop mount set site.localhost:18300 /site site-kit         # index.html, kit.css
$ slop mount set site.localhost:18300 /site/list site-view   # index.html linking /site/kit.css
$ curl -s -o /dev/null -w "%{http_code}\n" http://site.localhost:18300/site/kit.css
200
$ curl -s -o /dev/null -w "%{http_code}\n" http://site.localhost:18300/site/list/
200
```

The longer mount wins under `/site/list/`, so `site-view` has to load the
kit as `/site/kit.css`, not `kit.css`. Live pages run on sandbox origins and
cannot fetch from the static host without CORS: ship the data a live app
needs in its own store and fetch it relatively; images from the static host
load fine by absolute URL.

## 11. npm packages: `slop vendor`

Apps cannot `npm install` on the server. `slop vendor add` fetches a package
and its dependencies from the npm registry, checks each tarball's integrity
hash, bundles the import names you list with esbuild into `vendor/`, and
maps them in `app.json` (`slop.imports`). Run it in the app's folder, then
push:

```bash
$ slop vendor add preact@10.24.3 preact preact/hooks
name: preact
version: 10.24.3
page:
    preact: vendor/preact@10.24.3/preact.js
    preact/hooks: vendor/preact@10.24.3/hooks.js
written: 25
$ slop vendor          # list, and check every file against vendor/vendor.json
- name: preact
  version: 10.24.3
  files: 25
  problems: []
```

- Pages then `import { h, render } from 'preact'` in a
  `<script type="module">`; the import map comes from `slop.imports.page`.
- `--actor` bundles for the actor (CommonJS) instead; `require('zod')`
  then finds it.
- `slop vendor rm <name>` removes a package and its names.
- `--store <app>` works on an app store's `draft` instead of a folder:
  pulled, changed locally, pushed back as one snapshot if the draft has
  not moved.
- No package scripts run; npm itself is never run.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `conflict: main points at N, not M: it moved since you looked` | Someone pushed or published since you read the ref | `slop ref ls <store>`, look at what changed, retry |
| `permission_denied: only admins change app code` | The store holds `app.json`; you are not a platform admin | An admin pushes |
| Push succeeds, nothing changes | The store follows another ref, or activation failed | `slop app status <store>`: check `ref`, `n`, `broken` |
| `… runs a live app …: mount it on a live host` / `… is plain content …` | Wrong host kind for the store | Use the other host from `slop server hosts` |
| `give a store, or storeParam (a :param of the path)` | A `:param` path without `--storeParam` | Add `--storeParam <name>` |
| `no_instance: nothing is here yet` | No store with that id, or its type differs from the mount's `--type` | `slop store meta <id>`; `slop store type <id> <type>` |
| `unauthenticated: sign in to open this` for visitors | No `@guest` grant | `slop grant set <store> @guest view`, or a share link |
| A public actor route answers 404 | The mount's API policy has `defaultMin: view` (the default), or the route is not in `routes` | `"defaultMin":"public"`; `slop mount routes <host> <path>` |
| `ref.rm needs ifAt` | `slop ref rm` does not read the ref for you | `--ifAt <n>` from `slop ref ls` |
| `a subject is usr_…, vis_…, store:<id>, @guest, @member or @subscriber` | `grant set` was given an email | `slop people ls` for the `usr_…` id |
| `<app> does not declare fetch, so it cannot be turned on` | Policy for a capability the running version does not declare | Push a manifest that declares it, then set the cell |
| A dev instance is broken after you edited a migration | Applied migrations must not change | `slop store rm <instance>`, rerun `slop dev` |
| Visitors still see an old static file | The static host sends `max-age=60, stale-while-revalidate=600` | Wait up to 11 minutes, or reference files by snapshot (`/_s/<store>/<n>/<path>`, cached as immutable) |

## See Also

- `slop help tutorial-first-app` — the same steps on a small app, end to end
- `slop help building-apps` — choosing the kind of app and its capabilities
- `slop help app-manifest` — every field of `app.json`
- `slop help access-control` — levels, groups, grants, links, policy
- `slop help store-data` — files, snapshots, refs
- `slop help capability-db` — other stores: aliases and `_stores`
- `slop help llm-access` — model access and budgets
- `slop help actors` — actor routes, alarms, migrations
