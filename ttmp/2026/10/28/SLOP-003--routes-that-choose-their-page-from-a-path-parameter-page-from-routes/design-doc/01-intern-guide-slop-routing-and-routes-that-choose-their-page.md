---
Title: 'Intern guide: slop routing, and routes that choose their page'
Ticket: SLOP-003
Status: active
Topics:
    - routing
    - architecture
    - backend
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/routing/routing.go
      Note: Match, Specificity, Resolve — the pure path matcher
    - Path: repo://pkg/server/serve.go
      Note: serveSite and serveSandbox — where a resolved route becomes bytes
    - Path: repo://pkg/store/routes.go
      Note: Route model, validation, route log and undo
    - Path: repo://ttmp/2026/10/28/SLOP-002--test-deployment-of-slop-computer-with-francois-identities-and-importing-francois-s-real-data/various/agent-import/NOTES.md.txt
      Note: The storefront agent's notes; section 6 is the motivating gap
ExternalSources: []
Summary: "How slop turns a request into a page, why the francois import needed 100 routes, and the design of page-from routes, which let one route choose its page artifact from a path parameter."
LastUpdated: 2026-10-28T20:01:17.561695665-04:00
WhatFor: "Onboarding to slop's serving path, and the implementation plan for page-from routes"
WhenToUse: "Before touching routing, site serving, the route API, or the Workshop's Routes screen"
---

# Intern guide: slop routing, and routes that choose their page

## Executive Summary

slop.computer ("slop") is a small Go server that hosts **artifacts**, which are versioned folders of HTML or data that people and coding agents push. It publishes those artifacts on public **site hosts** through a **route table**. Each route maps a host and a path pattern to *one* page artifact. A route may choose a data **record** from a path parameter (`/journal/:slug → journal-post`, record `posts/{slug}.md`). It cannot choose *which page* to serve from a parameter.

We imported 113 francois releases into slop. Each release's HTML became its own page artifact (`weft`, `lattice-deck`, …), so the agent that built the storefront had to write **100 routes**, `/r/<page> → <page>@<n>`, one per release, pinned by hand. Those routes go stale whenever a release is added, and they crowd the route table (NOTES §6, §14).

This ticket adds **page-from routes**. A route may carry a template, `pageFrom: "{page}"`, which is filled from the path parameters to name the page artifact to serve. The candidates are limited to the project of the route's own page, which doubles as the page shown when the parameter names nothing. One route replaces the hundred:

```
slop route set /r/:page release-missing --page-from '{page}'
```

The resolution happens on the server, so **no client-side JavaScript router is needed**. This guide first explains the parts of slop you need to understand the change (sections 1–5), then the problem (6), the options (7), the design (8), the implementation plan with file references (9), tests (10) and rollout (11).

---

## 1. What slop is, in one page

slop is one Go binary (`cmd/slop`) that is both a **server** (`slop serve`) and a **CLI** (`slop push`, `slop route set`, …). The server keeps its state in Postgres or SQLite and stores file bytes in a content-addressed blob store. It answers on three kinds of host:

| Host class | Example | What it serves | Who uses it |
|---|---|---|---|
| **main** | `slop.yolo.scapegoat.dev` | the Workshop (React SPA), `/api/*`, login, Safe mode `/_/`, `/help/*` | admins, agents with tokens |
| **site** | `site.slop.yolo.scapegoat.dev` | public pages, through the route table | anyone |
| **sandbox** | `s<20 hex>.sandbox…` | one page version per unguessable label, for Workshop previews | the Workshop's iframes |

The dispatch is in `pkg/server/server.go` (`Handler`, around lines 140–170). It checks the sandbox label first, then site hosts, then falls through to the main mux (`routes()`, line 179).

```
              ┌────────────── Handler(host) ──────────────┐
request ──▶   │ sandbox label?  → serveSandbox (serve.go)  │
              │ site host?      → serveSite   (serve.go)   │
              │ main host       → mux: /api, Workshop, …   │
              └────────────────────────────────────────────┘
```

### 1.1 The nouns

- **Artifact** (`store.Artifact`, `pkg/store/artifacts.go:30`). It has an id (`^[a-z0-9][a-z0-9-]{0,62}$`), a title, and a kind, either `page` or `data`. It also has an optional **project**, `Main` (the version the `main` ref points at) and `Latest`.
- **Version** (`store.Version`). An immutable snapshot of one artifact: a file tree (`Files map[path]FileEntry{SHA256, Size, Type}`), a manifest (`slop.json`), a message, an author and `via` (`claude`, `agent`, `import`, …). Versions are numbered 1, 2, 3…; pushing makes a new one and normally moves `main`.
- **Project** (`projects` table). A grouping, such as `lab-site` or `francois`. Artifacts belong to at most one.
- **Route** (`store.Route`, `pkg/store/routes.go:23`): `(host, path) → page [@version] + bindings + record + access`. See section 2.
- **Binding**. A route's override of which data artifact (and version) a page's read-name means.
- **Record**. One file of a data artifact, parsed into a JSON object (`pkg/records`).

### 1.2 The page manifest

A page's `slop.json` declares what it needs:

```json
{
  "artifact": "storefront-entry",
  "kind": "page",
  "project": "francois",
  "reads": { "catalog": "francois-catalog", "media": "francois-media" },
  "tokens": "lab-tokens"
}
```

`reads` names data artifacts the page wants as `window.slop.data.<name>`. `tokens` names a data artifact whose `tokens.json` becomes CSS variables. The server reads only these two keys (`pageManifest`, `serve.go:83`).

---

## 2. Routes

A route row (Postgres DDL in `pkg/store/migrations/postgres/002_kernel.sql:57`):

```sql
CREATE TABLE routes (
    host text NOT NULL,
    path text NOT NULL,                       -- "/", "*", "/a/:param", "/a/*"
    page text NOT NULL REFERENCES artifacts(id),
    version integer,                          -- NULL = follow main
    bindings text NOT NULL DEFAULT '{}',      -- JSON {name: {artifact, version}}
    record text NOT NULL DEFAULT '',          -- e.g. "posts/{slug}.md"
    access text NOT NULL DEFAULT 'public' CHECK (access IN ('public','admins')),
    changed_by text REFERENCES users(id),
    changed_at timestamptz NOT NULL,
    PRIMARY KEY (host, path)
);
```

Every change is written to `route_log` with the full before and after state, and to the audit log and the event stream. That is what powers `slop route undo` and the Workshop's route history (`setRoute`, `logRoute`, `UndoRoute` in `pkg/store/routes.go`).

### 2.1 Path patterns

`store.ValidRoutePath` accepts:

- `/`: the root;
- `*`: the host's fallback (matches everything, served with status 404);
- `/literal/segments`;
- `/a/:name`: one segment captured as `params.name`;
- `/a/*`: a trailing rest segment captured as `params["*"]`.

### 2.2 Matching: `pkg/routing`

`routing` is a pure package with no database. It is a Go port of the Workshop prototype's matcher.

```go
func Match(pattern, path string) (map[string]string, bool)   // routing.go:18
func Specificity(pattern string) int                         // routing.go:57
func Resolve(rows []store.Route, host, path string) (Resolution, bool) // routing.go:88

type Resolution struct {
    Route    store.Route
    Params   map[string]string
    Record   string   // route.Record with {param} filled in
    Fallback bool     // matched the "*" route
}
```

`Specificity` scores each literal segment 3, each `:param` 2 and a trailing `*` 1. The fallback `*` scores −1. `Resolve` sorts the host's routes by score, highest first, and returns the first that matches. So `/journal/feed` (6) beats `/journal/:slug` (5), which beats `/journal/*` (4).

> **Note.** Two patterns with the same shape and score, such as `/apps/:id` and `/apps/:slug`, tie. The stable sort keeps their order from the database (`ORDER BY host, path`), so `:id` silently wins over `:slug`. The storefront agent hit this (NOTES §7). It is a separate issue, listed under Future work.

### 2.3 Records

If a route has `record: "experiments/{slug}.json"`, `Resolve` fills `{slug}` from the params and puts the result in `Resolution.Record`. The page receives it as `window.slop.record` and looks it up in its data. This is how **one** page artifact (`app-page`) renders **many** URLs (`/apps/weft`, `/apps/orbits`, …): the page is fixed, and the data varies.

```
/apps/:slug  ──▶  page app-page (fixed)
                  record experiments/{slug}.json  (chosen by the URL)
```

---

## 3. What happens on a site request

`serveSite` (`pkg/server/serve.go:256`) handles every site-host request. In order:

```
serveSite(req):
  if method not GET/HEAD           → 405
  if path starts with /_slop/      → runtime JS (window.slop)        [serveSlopAsset]
  routes := Store.Routes(host); public := routes with access=public
  if path ~ /_d/<artifact>/<n|main>/<file>:                          [§3.2]
        if some public route's page version reads <artifact> → serve the data file
        else 404
  if path ~ /_v/<artifact>/<n>/<file>:                               [§3.3]
        if <artifact> is the page of some public route → serve that page file
        else 404
  res := routing.Resolve(public, host, path)
  if path has an extension:                                          [§3.4]
        try the file in the resolved route's page version
        try the file in the page the Referer was on
  if no route → 404 "Nothing is routed here."
  v := version of res.Route.Page (pinned or main)
  body := renderPage(v, res)  → index.html with boot data injected   [§3.1]
  status := 404 if res.Fallback else 200
```

### 3.1 Rendering and boot data

`renderPage` (`serve.go:125`) reads the version's `index.html` and calls `render.Inject` (`pkg/render/render.go`). Inject inserts two things right after `<head>`:

- a `<script type="application/json" id="slop-boot">` holding a `render.Boot` object;
- `<script src="/_slop/runtime.js">`, which turns that JSON into `window.slop`.

```go
type Boot struct {
    Route   RouteInfo                   // {host, path, params}
    Data    map[string][]records.Record // every binding's records
    Record  string                      // the route's filled record path
    Version VersionInfo                 // {artifact, n} — the page being served
    Mode    string                      // site | preview | thumb | tool
    Tokens  *records.Tokens
}
```

`bindings` (`serve.go:98`) decides what goes into `Data`. It starts from the page manifest's `reads` (at `main`), adds `tokens` as `$tokens`, and lets the route's `Bindings` override names. Each binding is then resolved to a concrete version number.

The important consequence: **the page is rendered by the server**, with its data already inside. A page needs no fetch layer, and it needs no router.

### 3.2 `/_d/`: data files

Records of binary files (images, for example) get a `src` of `/_d/<artifact>/<n>/<path>` (`records`, `serve.go:50`). A site host serves such a file only when **some public route's page reads that artifact**. A site therefore exposes exactly the data its routed pages use, and nothing else that happens to sit in the store.

### 3.3 `/_v/`: page files by version

`/_v/<artifact>/<n>/<file>` serves a file of a page version, but only if `<artifact>` is the page of some public route (`routedPage`, `serve.go:279`). Numbered versions only.

### 3.4 Relative assets

A page that writes `<link href="style.css">` at `/pricing` makes the browser request `/style.css`. `serveSite` first tries the file in the page that `/style.css` itself resolves to. Failing that, it tries the page the **Referer** was on (`serve.go:328-347`), using `fileFor`: the full path, then the last segment. That is why page files should sit at the artifact root (NOTES §5).

### 3.5 Previews on the sandbox host

The Workshop never frames a site host directly. It asks `GET /api/sandbox-url` for a sandbox URL for `(artifact, n)`, optionally with `?host=` so the preview gets that host's route context (params, record, bindings). `serveSandbox` (`serve.go:386`) runs `routing.Resolve` against that host's routes, purely to build boot data for the fixed version it serves.

`GET /api/resolve?host=&path=` (`resolveRoute`, `pkg/server/preview.go:62`) answers "what would a visitor get here?". It returns `{resolution, n, bindings}`, and the Workshop's **Site** screen uses that answer to decide which artifact and version to preview.

---

## 4. The route API and the CLI

| Method & path | Permission | Handler | Body / query |
|---|---|---|---|
| `GET /api/routes[?host=][&resolve=1]` | `routes:read` | `listRoutes` (`kernel.go:467`) | `resolve=1` adds `n` and resolved `data` |
| `PUT /api/routes` | `routes:write` | `putRoute` (`kernel.go:492`) | a `store.Route` plus `note` |
| `DELETE /api/routes?host=&path=&note=` | `routes:write` | `deleteRoute` | |
| `GET /api/routes/log?host=&path=` | `routes:read` | `routeLog` | |
| `POST /api/routes/undo` | `routes:write` | `undoRoute` | `{host, path}` |
| `GET /api/resolve?host=&path=` | `routes:read` | `resolveRoute` (`preview.go:62`) | |

The Go client mirrors these as `client.Route` (`pkg/client/kernel.go:58`), `Routes`, `SetRoute`, `RemoveRoute` and `UndoRoute`. The CLI lives in `cmd/slop/cmds/routes.go`:

```
slop route list [--host H]
slop route set <path> <page|page@main|page@N> [--record R] [--bind name=artifact[@N]]... [--access public|admins] [--note …]
slop route undo <path>
slop route rm <path>
```

Seed folders (`pkg/seed`, used by `slop dev seed` and the francois importer) carry routes as `seed.Route` (`pkg/seed/seed.go:66`) and push them with `Admin.SetRoute` (`seed.go:196`).

In the Workshop, the routes code is:

- `web/workshop/src/screens/RoutesScreen.tsx`: the table and the detail editor. The editor `PUT`s `{...route, ...patch}`.
- `SiteScreen.tsx`: a visitor's view, through `/api/resolve`.
- `api/types.ts:46` (`Route`, `RouteView`, `Resolution`).
- `api/events.ts:41`: the event-feed sentence for `route.set`.

---

## 5. The francois import, briefly

SLOP-002 imported francois's catalogue through `slop import francois extract|push` (`pkg/francois`). It produced:

- **one page artifact per release**, with the release's standalone HTML as `index.html` (e.g. `weft`, `lattice-deck`), all in project `francois`;
- **data artifacts**: `francois-catalog` (one JSON record per app, including `page`, its page artifact id), `francois-journal`, `francois-creators`, and `francois-media`, `-2`, `-3` (sharded images).

An agent then built two pages on top:

- `storefront` at `/`: the catalogue grid;
- `storefront-entry` at `/apps/:id --record '{id}.json'`: one page per app, which links to "Open release" at `/r/<record.page>`.

---

## 6. The problem

`/r/<page>` has to serve **a different page artifact for each value**. Records can't do that: a record changes the *data* a fixed page sees, not the page. So the agent wrote 100 routes (`release-routes.tsv`):

```
/r/weft             weft@1
/r/lattice-deck     lattice-deck@3
/r/visiting-hours   visiting-hours@1
… ×100
```

The costs:

1. **Staleness.** Each route is pinned to the version that was latest at import time. A new release moves the artifact's `main`, but the route keeps serving the old version until someone re-runs the script (NOTES §6). (Measured on the local server on 2026-10-28: all 100 pins currently equal `main`, so following `main` would serve exactly what is live today.)
2. **New releases need a route.** A 101st release has no URL until someone adds one.
3. **Noise.** The route table now has 111 rows, 100 of them identical apart from the name. `route list`, Safe mode and the Workshop's Routes screen bury the real site (NOTES §14).
4. **Cost of creation.** 100 sequential CLI calls; there is no bulk apply.

### 6.1 Why a JavaScript router page doesn't solve it

An obvious workaround is one page at `/r/:page` that reads `slop.route.params.page` and then loads the right release. That fails, or is worse, for three reasons:

- **It can't get the HTML.** A public page has no API access. `/_v/<page>/<n>/index.html` returns 404 unless `<page>` is already routed (§3.3), and making it routed is exactly the problem.
- **Even if it could,** it would have to inject a whole standalone document into an iframe or `document.write` it. Boot data, relative assets (§3.4), the page's title and status codes would all break or need to be re-implemented.
- **Status codes and caching.** A missing release would return 200 from the router page, not 404.

So the fix belongs where every other routing decision is made: on the server, in resolution.

---

## 7. Options considered

| | Option | Pros | Cons |
|---|---|---|---|
| A | Keep static routes, add `route apply <file>` (bulk, declarative) | no new routing concept | still stale, still 100 rows, still needs regenerating per release |
| B | JS router page (§6.1) | no server change | doesn't work today; fragile; wrong status codes |
| C | **Page-from template**: the route's page is filled from params, limited to a project | one row; follows `main`; new releases appear on their own; server-side render unchanged | a new column; gating for `/_v/` and `/_d/` must learn about it |
| D | Page from the record (`--page-field page`: load the record, read its `page`) | the URL can stay `/apps/:id`; the catalogue decides | resolution must load and parse data before choosing a page; harder to reason about and cache |

**Choice: C.** It is the smallest change that fixes all four costs, and the URL already carries the page id. D stays possible later, because it can be built on the same "a route chooses its page at request time" machinery.

---

## 8. Design: page-from routes

### 8.1 Data model

One new column and field:

```sql
ALTER TABLE routes ADD COLUMN page_from text NOT NULL DEFAULT '';
```

```go
type Route struct {
    …
    Page     string `json:"page"`               // the fixed page; for page-from routes, the "else" page
    PageFrom string `json:"pageFrom,omitempty"` // template naming the page from params, e.g. "{page}" or "release-{page}"
    …
}
```

Why keep `page` and give it a second job instead of storing the template in it? `routes.page` is a foreign key to `artifacts(id)`, and dropping a foreign key in SQLite means rebuilding the table. More importantly, a page-from route needs two more things, and `page` supplies both:

- **a scope:** which pages a parameter is allowed to name. We use the **project of `page`**.
- **an else page:** what to show, with status 404, when the parameter names no such page.

### 8.2 Semantics

For a route with `PageFrom` set, a request is resolved like this:

```
candidate := PageFrom with every {name} replaced by params[name]
served    := candidate if all hold:
                 candidate is a valid artifact id
                 artifact(candidate).kind == page
                 artifact(candidate).project == artifact(route.Page).project
                 artifact(candidate).main > 0
             else route.Page   (status 404, Resolution.Missing = true)
version   := main of served    (page-from routes always follow main)
```

Everything else is unchanged: `record` is still filled from params, and `bindings` still override the *served* page's reads. Boot data's `version.artifact` is the served page.

### 8.3 Validation (on `PUT /api/routes`)

- `PageFrom` must contain at least one `{name}`, and every `name` must be a `:name` segment of `Path`. Otherwise the error is `pageFrom uses {x}, but the path has no :x`. (This is the agent's NOTES §8 trap, in which `--record '{slug}.json'` on a path without `:slug` silently produced `.json`. We make the new feature strict from day one.)
- The literal parts of `PageFrom` may only use artifact-id characters (`[a-z0-9-]`).
- Each placeholder may appear only once. Admission (§8.5) matches every placeholder on its own, because Go's RE2 has no backreferences. `{page}-{page}` would therefore admit `private-draft`, which no value of `:page` produces. (Added after review; a template with a repeated placeholder that is already stored matches nothing.)
- `Version` must be nil: `page-from routes follow main`.
- The `Page` artifact must be in a project: `page-from routes choose among the pages of the route page's project; <page> has no project`.

### 8.4 What a page-from route publishes

A page-from route makes **every page artifact in that project whose id fits the template** reachable on the site host. That is the point of the feature, but it is also a publishing decision, so it must be visible:

- the CLI echo says `→ {page} in project francois (else release-missing@main)`;
- the route log and audit entries record `pageFrom` (they store the whole route JSON);
- `slop route list` gets a `page_from` column, and the Workshop's Routes table shows the template.

A prefix template such as `release-{page}` narrows exposure to artifacts named `release-*`. For francois, `{page}` also exposes `storefront`, `storefront-entry` and probe pages at `/r/<id>`. They are already public, so that's harmless, but this is why the guide recommends that an importer name release artifacts with a prefix in future.

### 8.5 Gating `/_v/` and `/_d/`

Both gates ask "is this page reachable on this host?". They learn one new rule:

```
admits(route, artifactID):         # does a page-from route serve this page?
    route.PageFrom != "" and
    templateRegexp(route.PageFrom).matches(artifactID) and   # "{page}" → ^(.+)$, "release-{page}" → ^release-(.+)$
    artifact(artifactID).kind == page and
    artifact(artifactID).project == artifact(route.Page).project
```

- **`/_v/<a>/<n>/<f>`**: `routedPage(a)` becomes "some public route has `Page == a`, or admits `a`".
- **`/_d/<d>/<n>/<f>`**: static routes are checked first, as now. Then, for each public page-from route, the pages in its project that it admits are checked: does the page's `main` version read `d`? The fallthrough costs one query per candidate page, but it runs only for data that no static route reads. **Second pair of eyes:** if this shows up in latency, cache "data artifacts read by project P's pages" keyed on the project's max version timestamp.
- **Sandbox `/_d/`** with route context (`serve.go:420`): `rt.Page == v.Artifact` becomes `rt.Page == v.Artifact || admits(rt, v.Artifact)`.

### 8.6 Where resolution happens

`routing.Resolve` stays pure. It fills a new field:

```go
type Resolution struct {
    Route    store.Route
    Params   map[string]string
    Record   string
    Page     string `json:"page"`               // NEW: PageFrom filled in, or Route.Page
    Missing  bool   `json:"missing,omitempty"`  // NEW: set by the server when Page wasn't servable
    Fallback bool
}
```

A new server helper does the store checks:

```go
// target returns the version a resolution serves: the page PageFrom names
// when it is a page of the route page's project, else the route's page.
func (s *Server) target(ctx context.Context, res *routing.Resolution) (store.Version, error)
```

The three call sites that do `versionOf(res.Route)` today all switch to `target(&res)`:

- `serveSite` main render;
- the relative-asset lookups (both the path and the Referer resolution);
- `resolveRoute` (`/api/resolve`).

### 8.7 The request, end to end

```
GET site…/r/weft
  Resolve → route /r/:page (pageFrom "{page}", page release-missing), params {page: weft}
          → res.Page = "weft"
  target  → artifact weft: kind page, project francois == project(release-missing) ✓, main 1
          → version weft@1
  render  → weft/index.html + boot {route.params.page: "weft", version: {artifact: weft, n: 1}}
  200

GET site…/r/nope
  Resolve → res.Page = "nope"; target → no such artifact → release-missing@main, Missing
  404 with release-missing's HTML (it can read slop.route.params.page to say "no release called nope")

GET site…/r/style.css     (Referer: site…/r/weft)
  Resolve(/r/style.css) → candidate "style.css" is not an artifact id → else page; no style.css there
  Resolve(Referer /r/weft) → weft@1 → fileFor("style.css") ✓ → served
```

### 8.8 API and CLI surface

```
PUT /api/routes
{ "host": "site.slop.yolo.scapegoat.dev", "path": "/r/:page", "page": "release-missing",
  "pageFrom": "{page}", "note": "one route for all releases" }

GET /api/resolve?host=…&path=/r/weft
{ "resolution": { "route": {…, "pageFrom": "{page}"}, "params": {"page": "weft"}, "page": "weft" },
  "n": 1, "bindings": {} }
```

```
$ slop route set /r/:page release-missing --page-from '{page}' --note 'one route for all releases'
site…/r/:page  (none) → {page} in francois, else release-missing@main   (slop route undo /r/:page goes back)
```

---

## 9. Implementation plan (files and symbols)

Work in this order. Each step builds and has tests.

1. **Store.**
   - `pkg/store/migrations/{postgres,sqlite}/005_route_page_from.sql`: `ALTER TABLE routes ADD COLUMN page_from text NOT NULL DEFAULT ''`.
   - `pkg/store/routes.go`:
     - add `PageFrom` to `Route`, `routeColumns`, `scanRoute`, and the INSERT/UPSERT in `setRoute`;
     - put the §8.3 rules in `validate` (syntax) and `setRoute` (page project, version);
     - export `PageTemplateParams(t string) []string` for reuse.
   - Undo needs no change, because the log stores whole route JSON.
2. **Routing.**
   - `pkg/routing/routing.go`: `Resolution.Page`, `Resolution.Missing`; fill `Page` in `Resolve` with the same `{name}` replacer as `Record`.
   - New `TemplateMatcher(t string) *regexp.Regexp` for `admits`.
3. **Server.**
   - `pkg/server/serve.go`: `target`, `admits`; update `routedPage`, the `/_d/` gate, the asset lookups, the main render (404 when `Missing`), and the sandbox `/_d/` gate.
   - `pkg/server/preview.go` `resolveRoute`: use `target`.
4. **Client and CLI.**
   - `pkg/client/kernel.go` `Route.PageFrom`.
   - `cmd/slop/cmds/routes.go`: `--page-from` on `set`, a `page_from` column on `list`, and `describeRoute` showing the template and the project.
5. **Seed.** `pkg/seed/seed.go` `Route.PageFrom`, passed through in `Push`.
6. **Workshop.**
   - `api/types.ts`: `pageFrom?: string` on `Route`, `page?: string` and `missing?: boolean` on `Resolution`.
   - `RoutesScreen.tsx`: the Page cell shows `{page}` plus "else X"; the detail shows a "Page from" row and hides the version picker.
   - `SiteScreen.tsx`: preview `res.resolution.page ?? route.page`.
   - `events.ts`: the event-feed sentence.
7. **Safe mode.** The `safe` template shows `pageFrom` next to the page.
8. **Docs.** `pkg/doc/topics/agents.md`: a "One route for many pages" section; `doc/` where routes are described.

## 10. Tests

| Test | Where | Asserts |
|---|---|---|
| Template resolution | `pkg/routing/routing_test.go` | `Resolve` fills `Page` from `{page}` and `release-{page}`; `Page == Route.Page` without `PageFrom`; `TemplateMatcher` |
| Validation | `pkg/store` route tests | rejects an unknown `{x}`, bad literal characters, a pinned version, and a page without a project; accepts and round-trips `pageFrom`; undo restores it |
| Site serving | `pkg/server/serve_test.go` | `/r/a` serves page `a` (200, boot `version.artifact == a`); `/r/nope` serves the else page with 404; a page from another project → else page; a data artifact id → else page |
| Gates | same | `/_v/a/1/x` 200 via a page-from route, and 404 for a page in another project; `/_d/` of data read only by an admitted page → 200 |
| Relative assets | same | `/r/style.css` with Referer `/r/a` → `a`'s file |
| Resolve API | same | `/api/resolve` returns `page` and the served `n` |
| CLI | manual / transcript | `route set --page-from`, `route list` column |

## 11. Rollout

1. Merge, publish the image, bump the gitops tag (same procedure as SLOP-002 step 8).
2. On the cluster:
   - push a small `release-missing` page into project `francois` ("No release called …", reading `slop.route.params.page`);
   - `slop route set /r/:page release-missing --page-from '{page}'`;
   - spot-check `/r/weft`, `/r/lattice-deck`, `/r/nope` (404).
3. Remove the 100 static `/r/<page>` routes with `slop route rm`, using the TSV from SLOP-002. Static routes are more specific (score 6 against 5), so they shadow the template until they are removed. The two can coexist during the switch, and order doesn't matter.
4. Check that `/` and `/apps/:id` still render and that their covers load from `/_d/`.

## 12. Future work (not in this ticket)

- Page chosen by a record field (option D).
- Route conflict warnings for equal-specificity patterns (NOTES §7) and for replacing `/` (§8).
- `route apply` from a file, and `--output json` on list commands (§9).
- Caching the `/_d/` fallthrough for page-from routes (§8.5).

## 13. Glossary

- **else page**: the fixed `page` of a page-from route, served with 404 when the template names no servable page.
- **main**: the ref that marks an artifact's current version; routes that "follow main" serve whatever it points at.
- **boot data**: the JSON the server injects into every page, read by `runtime.js` as `window.slop`.
- **site host / main host / sandbox host**: see section 1.
