# Building and deploying apps on slop

A developer guide, written while building the fifteen stores of the slop
catalog (SLOP3-015): twelve static ones (the landing page with the shared kit
and data, and eleven views), an MCP server, a shelf and a curator. It covers what an app is, which host it belongs on, how to declare
what it needs, how to deploy it repeatably, how to test it with real
sessions, and what we learned the hard way. Every claim here was checked
against the server; the evidence is in
`ttmp/2026/11/06/SLOP3-015--…/reference/01-diary.md`.

Read first, for the platform itself: `doc/design/slop-v3.md` (stores,
mounts, grants), `doc/claude-apis/README.md` (the page runtime and how slop
differs from claude.ai), `doc/claude-apis/state-storage.md` (`db`),
`doc/claude-apis/people-and-collaboration.md` (`user`, `room`).

## 1. Four kinds of app

| Kind | Host | Store holds | Example | Who can see it |
|---|---|---|---|---|
| Static files | static (`site.…`) | HTML, JS, CSS, data; no `app.json` | `apps/catalog-*` views | whoever the store's grants admit as a guest (`@guest view`) |
| Page-only app | live (`apps.…`) | `app.json` with `page` and `capabilities` | `apps/catalog-shelf` | per grant level; the page gets the runtime (`db`, `user`, `room`, `sample`) |
| Page + actor | live | `app.json` with `page`, `actor` | `apps/catalog-curator`, `apps/examples/guestbook` | as above; the actor runs server-side, one turn at a time |
| Endpoint | live | `app.json` with `actor`, HTTP routes, a mount API policy | `apps/catalog-mcp` | public routes for anyone; others by level |

Rules that decide the kind:

- **The static host serves files only.** No sessions, no runtime: a guest is
  the only visitor, and the store needs `@guest view`. It cannot host a store
  that runs an app: `mount.set` refuses with `… runs a live app (capabilities
  or an actor): mount it on a live host`.
- **The live host wraps a page in the shell.** The page runs in an iframe on
  a sandbox origin (`s<hmac(store, app)>.<sandbox>/v/<snapshot>/`), and the
  shell sends `frame-ancestors 'none'`, so a live page cannot be framed by
  another site.
- **An actor is for what the server must do:** shared decisions (a daily
  pick everyone sees), work on behalf of a visitor with checks
  (`requires: 'interact'`), HTTP endpoints, alarms. Prefer the page for
  per-person work: it is simpler and the visitor's own limits apply.

## 2. The manifest, `app.json`

```json
{
  "title": "Shelf — slop catalog",
  "page": "index.html",
  "actor": "actor.js",
  "capabilities": {
    "db":     { "rules": [ { "path": "shelves", "read": "view", "write": "owner" },
                           { "path": "shelves/{self}", "write": "interact" } ] },
    "user":   { "scopes": ["profile"] },
    "room":   {},
    "sample": {}
  }
}
```

- `capabilities` uses the claude.ai artifact names; undeclared capabilities
  are `null` in the page and the actor.
- **Pushing a tree with `app.json` needs an admin.** Every line of actor code
  on a server was installed by an admin.
- `db` rules: the deepest rule wins; `{self}` is the visitor's own id as the
  last segment; a rule at the prefix of a `{self}` rule must set both `read`
  and `write`. `data/users/<id>/` is private to that person by default.
- `user`: with `{}` the page sees the person's id; with `scopes: ["profile"]`
  also names (SLOP3-014, PR #34: without `user` the page sees no id, without
  `profile` no name). On slop, `avatarUrl` is `""`; draw initials on the
  profile's `color`.
- `room`: presence is open to all; event topics are admin-only unless
  `room.topics` opens them.

## 3. Deploying

### 3.1 The verbs

| Step | Verb | Notes |
|---|---|---|
| create | `store.new {id}` | fails if it exists: check `store.ls {all: true}` first |
| upload | `files.push {store, files, message}` | a whole tree; entries are `{path, text}` or `{path, sha256}`; missing blobs come back as `missing_blobs` with the list in `error.extra.missing` (upload with `files.blobs`); an unchanged tree reuses the ref's snapshot |
| or | `slop push <dir> --store <id> -m …` | the CLI does the same from a folder, sending only changed bytes |
| who may see | `grant.set {store, subject, level}` | `@guest view` for static stores; `@member interact` to let signed-in people write |
| capabilities with a cost | `policy.set {app, capability, audience, value}` | `sample`, `assets`, `user.email`, `fetch`, `secrets`, `platform`, `stores`; off by default except `assets` for members |
| model access | `llm.set {subject, value, budget}` | per person or audience; **`sample` needs the policy cell and the payer's access** |
| where | `mount.set {host, path, store, api?}` | static or live host; a literal segment beats `:param`, longer beats shorter |

### 3.2 An idempotent deploy script

`ttmp/…/SLOP3-015…/scripts/02-deploy.py` is the pattern to copy. One record
per store:

```python
{"store": "catalog-curator", "src": "apps/catalog-curator", "host": "live",
 "path": "/catalog/curator",
 "extra": {"data/catalog.json": "catalog.json"},          # generated files
 "grants": {"@guest": "view", "@member": "interact"},
 "policy": [("sample", "member", True)],
 "api": None}                                              # or a mount API policy
```

For each record it plans, then (with `--apply`) runs: `store.new` if missing;
`files.push` only if `files.ls` differs (path and sha256); each grant that
differs; each policy cell that differs; `mount.set` if the mount is missing
or its API policy differs (compared by inclusion: the server adds defaults).
It refuses to replace a mount that serves another store. A rerun that prints
`up to date` for every store is the check that the deploy is complete.

Point it at a local server with `SLOP_CREDENTIALS=<file>` (a separate login)
and `--live apps.localhost:18300 --static site.localhost:18300`.

### 3.3 Several stores as one site

The catalog is one store (`catalog`: the kit, the data, the landing page)
plus one store per view, on nested mounts (`/catalog`, `/catalog/list`, …).
A view loads the shared kit by absolute path (`/catalog/kit/views.js`), so
each view is a few kilobytes and deploys alone. A mount root without its
slash answers `308` to the slash, so relative URLs work.

Live apps cannot fetch from the static host without CORS. Ship the data they
need in their own store (`data/catalog.json`) and fetch it relatively; load
images from the static host by absolute URL (images need no CORS).

## 4. Caching

Measured on production (SLOP3-015 step 7):

| Served | Cache-Control | Validator |
|---|---|---|
| everything on the static host, including `/_s/` and `/_d/` | `public, max-age=60, stale-while-revalidate=600` | strong ETag (sha256), `If-None-Match` → 304; text is zstd-compressed |
| live shell pages, actor routes | `no-store` (actor routes may set their own) | — |

Consequences and what we did:

- **A changed shared file lags by up to 11 minutes** in browsers that saw the
  old one. Name shared assets by their hash: the deploy rewrites
  `"/catalog/kit/views.js"` to `"/catalog/kit/views.js?v=<sha256[:12]>"` in
  every HTML file (`stamps()`).
- **Content-addressed URLs are still revalidated** every 1–10 minutes
  (cheaply, 304), because the static host has one policy for every file.
  `immutable` for `/_d/<id>` and `?v=` URLs is a server change worth making.
- **Images are sent as uploaded.** The 94 catalog covers weigh 76 MB, the
  largest 17 MB. Generate thumbnails at build time (for example 480 and 960
  px WebP) and use `srcset`; nothing on the server resizes.
- **Every rebuild changes generated files** that carry a timestamp
  (`catalog.json`'s `generated`), so every rebuild pushes every store that
  ships them. Keep generated output stable unless its content changed.

## 5. Running other people's HTML in a page

The catalog previews 93 free apps inside its own pages. What works:

- `<iframe sandbox="allow-scripts allow-forms allow-modals">` without
  `allow-same-origin`: the app runs in an opaque origin and cannot script the
  catalog or read the site host's storage.
- **`localStorage` throws in an opaque origin**, and many apps read it while
  starting, so they render blank. Fetch the HTML, insert
  `<base href="<its folder>">` and a shim that replaces `localStorage` and
  `sessionStorage` with in-memory stores when access throws, and set
  `srcdoc` (`SlopCatalog.previewDoc` in `apps/catalog/kit/views.js`).
- Keep the frame at the device's real CSS size and scale it with
  `transform`, so the app lays out as on that device.
- **Budget the frames.** Run only what is visible
  (`IntersectionObserver`), a few at a time (the sheet: 8; the desktop: 5),
  start them one by one, and skip large apps (over 1.5 MB) until asked.
- An iframe under the pointer swallows `pointermove`: turn off
  `pointer-events` on frames while dragging.

## 6. Pages with the runtime: patterns that held

- **Check who the visitor is before offering writes.** On slop a guest has an
  id but only `view`; `slop.visitor()` gives `{guest, level, audience, llm}`.
  Offer sign-in (`slop.signIn()`) instead of controls the store will refuse.
- **Own your own document.** For state only this person writes (a shelf),
  read once with `get()` and write in order (`saving = saving.then(…)`).
  Applying `onSnapshot` of your own document rolled the page back when a late
  snapshot arrived after a quick run of changes. Use `onSnapshot` for what
  others write.
- **Re-render on presence only when it matters.** `onPeers` fires on any
  presence change; rebuilding a list between a mousedown and its mouseup
  loses the click. Compare a signature of the fields you show.
- **Resolve names in the render path** with `user.profiles(ids)`; it caches.
- **`sample`** (page or actor) needs: the app declares `sample`; the policy
  cell for the visitor's audience; the payer's LLM access and budget
  (`llm.ls`). The payer is the visitor (an actor action runs as its caller).
  Read model answers leniently (find the JSON object, validate ids against
  your data) and show the raw text when it does not parse. The local `fake`
  backend answers "slop is connected.", which exercises that fallback.

## 7. Actors and endpoints

- `require('./data/catalog.json')` loads data with the actor; a new snapshot
  rebuilds the actor.
- **An `await` on real I/O ends the turn.** Code after it runs in a new turn:
  re-read anything another turn may have written meanwhile (the curator reads
  `picks/<day>` again before storing, so the first answer wins).
- `require('express').app()` builds routes into the same table as `http:`;
  `.public()` routes need no session. A route answers through `res`
  (`res.status(202).end()` for an empty answer).
- **A mount API policy's `defaultMin` is `view`**: set `"defaultMin":
  "public"` for public endpoints, or every guest gets 404.
- CORS takes explicit origins only; preflights are answered before the actor
  is built. Add a `rateLimit` (per `ip` or `visitor`) to anything public.
- The MCP endpoint (`apps/catalog-mcp/actor.js`) is a complete example of a
  stateless Streamable HTTP server: JSON-RPC over one POST route, `202` for
  notifications, tools with `readOnlyHint`.

## 8. Testing

1. **Host tests** (`pkg/host/*_test.go`): `appDir(t, "<app>")` reads an app
   folder; `h.call(admin, verb, args)`; `openView(site, host, path, "")`
   opens a page view and returns `{user, level, secret, url}`;
   `rpc(site, view, "db.write" | "db.get" | "slop.call", args)` calls the
   page runtime; `signInSite` signs a browser in on a live host. See
   `catalog_shelf_test.go` (privacy between two people) and
   `catalog_curator_test.go` (an actor action with the fake model).
2. **A local server with real sign-in:**
   ```sh
   go build -buildvcs=false -o /tmp/slop ./cmd/slop
   /tmp/slop serve --local --llm fake --data /tmp/slopdata --admin-email admin@example.com
   SLOP_CREDENTIALS=/tmp/local-creds.json /tmp/slop auth login --server http://slop.localhost:18300
   ```
   Approve the device code in a browser signed in as the admin. Sign people
   in on the live host at `/_site/login?return=<path>` with any email.
   Give someone the model with `llm set <email> on --budget N`.
3. **Static views** need no server: a small proxy that maps mounts to folders
   and passes `/_d/` and `/_s/` to production (`scripts/03-devserve.py`).
4. **Browser checks** (Playwright): check the DOM with an evaluation before
   trusting a blank screenshot (it may be mid-render); frames go stale after
   a reload; mouse input into a cross-origin iframe of a background window
   may not arrive (`bringToFront`, or dispatch the event); close the extra
   contexts afterwards.

## 9. Before calling it production

- [ ] Thumbnails for every image a list shows; `srcset`.
- [ ] `immutable` caching for content-addressed URLs (server change), or a
      CDN rule that does the same.
- [ ] Generated data stable between identical builds; rebuilds triggered by
      what changes it (for the catalog: a release).
- [ ] Every store's grants and policy cells written down in the deploy
      script, and a rerun that plans nothing.
- [ ] Model access decided per audience (`llm.set`) with budgets, for any app
      that declares `sample`.
- [ ] Public endpoints rate-limited; CORS limited to the origins that need it.
- [ ] A favicon (the static host answers 404 for `/favicon.ico`).
- [ ] Host tests for every rule that keeps people's data apart.
