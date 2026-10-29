---
Title: Diary
Ticket: SLOP-006
Status: active
Topics:
    - tools
    - frontend
    - routing
    - architecture
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological diary for SLOP-006: site-aware Pinup apps ($site, URL links, filters, list repeats, rich text)."
LastUpdated: 2026-10-29T11:10:18.699322949-04:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Record how SLOP-006 was designed and built: a `$site` data source that lists a host's public URLs, plus links to any URL, repeat filters, list-field repeats and rich text in Pinup apps, so a Pinup app can navigate the site.

## Step 1: What pages can see today, the design, the intern guide

The user asked whether Pinup pages can read and show artifacts and other slop data, so that apps can navigate the site. I checked what a page can read. A Pinup app reads only data artifacts through `reads`. The server adds `$tokens` and nothing else: no artifacts, routes or projects. The storefront at `/` lists apps because the francois import wrote a curated data artifact (`francois-catalog`, 104 records) that the storefront page reads.

The design adds a server-built `$site` source and four Pinup features. It is written up as the intern guide (`design-doc/01-intern-guide-site-aware-pinup-apps.md`) and uploaded to reMarkable.

### Prompt Context
**User prompt (verbatim), 1:** "can the pinup pages access and display artifact and other slop.yolo data, to make apps to actually navigate the site?"
**User prompt (verbatim), 2:** "Create new docmgr ticket and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**User prompt (verbatim), 3 (mid-turn):** "then implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)(diary format: MANDATORY)"
**Assistant interpretation:** Write the ticket and guide for site-aware Pinup apps, upload it, then implement it with commits and this diary.
**Inferred user intent:** Pinup apps that are the site's navigation (home page, indexes, catalogues) and link to real pages.
**Commit (code):** none yet (this step adds the ticket).

### What I did
- **Read** `pkg/server/serve.go`:
  - `bindings`, `renderPage` and `records` (the `$tokens` special case);
  - `admits`, `target`, `pageFromReads` and `serveSite` (public routes only);
  - the `publish` hook in `server.go:101`.
- **Read** `pkg/routing/routing.go` (`Resolve`, `TemplateMatcher`, `fill`), `pkg/store/events.go` (event types), and `pkg/store/artifacts.go` (`Artifact`, `Artifacts(project)`).
- **Workshop:** read where route `data` is shown (`RoutesScreen.tsx:72`, `:150`) and used for preview samples (`WatchRight.tsx:20`).
- **Local data:** listed the routes on `site.localhost:18120` (20 routes: static, record routes `/journal/:slug` and `/apps/:id`, page-from `/r/:page`, fallback `*`) and the storefront manifest (`reads: catalog, media, media2, media3`).
- **Ticket:**
  - `docmgr ticket create-ticket --ticket SLOP-006 …`, plus the design doc and this diary;
  - 12 tasks;
  - `remarquee upload bundle … --name "SLOP-006 Site-aware Pinup apps intern guide" --remote-dir /ai/2026/10/29/SLOP-006` → `OK: uploaded SLOP-006 Site-aware Pinup apps intern guide.pdf -> /ai/2026/10/29/SLOP-006`.

### Why
- **A virtual source, not a generated data artifact.** A data artifact rewritten after every route change would add a version per change and fill the event log. `$token`-style resolution at render time, with a per-host cache invalidated in `publish`, has no storage cost.
- **Enumerate concrete URLs, not route patterns.** A navigator needs links, and slop already knows how to turn record routes (records matching the pattern) and page-from routes (admitted project pages) into URLs.
- **`href` is a separate node field from Pinup's `link`.** Pinup's player and canvas arrows treat `link.to` as a frame id, so a URL there would confuse upstream code.

### What worked
- The design reuses existing pieces: `records` and its cache, `admits`, `TemplateMatcher`, `Resolve` (for the shadowing check), and `publish` as the single invalidation point.

### What didn't work
- **A wrong help-topic name in the uploaded guide.** It referred to `slop help pages`, which does not exist (`ls pkg/doc/topics/` → `agents.md pinup.md`). The ticket copy now says `slop help agents`; the reMarkable copy still has the old line.

### What I learned
- The local data has two routes with the same pattern shape and specificity (`/apps/:id` and `/apps/:slug`). Only one of them serves `/apps/x`, so the index has to check each URL against `Resolve`.
- The francois catalogue marks entries `visibility: hidden`. An index of every record-route URL would make those discoverable, hence the unlisted rules (`draft`, `listed`, `hidden`, `visibility`).

### What was tricky to build
- **Exposure.** The index only lists URLs a visitor can already open, but it changes them from guessable to listed. The rules have to be explicit and documented, and private routes, the fallback, and a page-from route's else page are never listed.

### What warrants a second pair of eyes
- The unlisted conventions in guide §3.5: are `visibility`, `draft`, `listed` and `hidden` the right set?

### What should be done in the future
- Implement (tasks 2–12).

### Code review instructions
- Read guide §3 (server) and §4 (Pinup).

### Technical details
- Record shape: `{id=path, path, title, kind: page|record|project-page, route, page, project, projectName, section, depth, updated, record?}`.
- Cache: per host, generation bumped in `publish` on route, ref, version, artifact or project events, with a 30-second ceiling.

## Step 2: The `$site` source on the server, `GET /api/site`, `slop site ls`

I implemented guide §3. A page that reads `"$site"` now gets one record per URL a visitor can reach on its host. `TestSiteIndex` builds a small site that exercises every route kind and exclusion, and checks the exact index. It passed on its first run, so I made sure it can fail (below).

### Prompt Context
**User prompt (verbatim):** see Step 1 (prompts 2 and 3).
**Assistant interpretation:** Guide §3 and tasks 2–6: the routing helpers, the index, the binding, push validation, the Go tests, the Workshop display, and the CLI.
**Inferred user intent:** Pages, and so Pinup apps, can list and link to everything public on the site.
**Commit (code):** `aecbd55` — "Site index: a $site data source listing a host's public URLs; GET /api/site; slop site ls"

### What I did
- **`pkg/routing`:** `RecordMatcher(pattern)` (one `[^/]+` per `{name}`; a repeated name matches nothing) and `FillPath(pattern, params)` (escapes values; false for a missing value, a value containing `/`, or a `*`), with a table test.
- **`pkg/server/siteindex.go`:**
  - `SiteSource = "$site"`, `siteMax = 2000`, `siteTTL = 30s`;
  - `siteRoutes` and `GET /api/site?host=` (`routes:read`);
  - `siteHost`;
  - `siteCache` (`gen`, per-host entries) and `changed(evs)`;
  - `siteIndex` and `siteEntries`, which enumerate per guide §3.2;
  - helpers `sitePage`, `siteProjectPages`, `siteRecord`, `truthy`, `listedRecord`, `listedPage`.
- **`server.go`:** a `site siteCache` field; `publish` calls `s.site.changed(evs)` before broadcasting; `s.siteRoutes(m)` is registered.
- **`serve.go` `renderPage`:** a binding whose artifact is `$site` gets `s.siteIndex(ctx, s.siteHost(host))`, handled before the `N == 0` skip.
- **`kernel.go` push:** `reads` values starting with `$` other than `$site` warn: `reads.x: $nope is not a known source (the one there is: $site)`.
- **Workshop:**
  - `RoutesScreen.tsx`: the table shows `site index`; the detail shows "the site index: every public URL on this host" instead of a version select;
  - `WatchRight.tsx`: preview samples skip `$` sources.
- **CLI:** `pkg/client/site.go` (`SiteIndex`), `cmd/slop/cmds/site.go` (`slop site ls [--host]`), and the `site` group in `fields.go`.

### Why
- **The URL check, not route order, decides which route an entry belongs to.** `routing.Resolve(public, host, path)` must return the producing route, so the index agrees with what the server would serve.
- **`siteRecord` drops `body`, `html`, `text`, `csv` and `error`.** The index is embedded in every page that reads it.
- **Invalidation sits in `publish`,** the one place committed kernel events pass through. Doc and presence events go straight to `Events.Publish` and do not touch the index.

### What worked
- `GOWORK=off go test ./pkg/server -run TestSiteIndex` → ok. The index is exactly:
  - `/ page Home`
  - `/about page About us`
  - `/apps/a record App A` (`b` is `visibility: hidden`)
  - `/index page Index`
  - `/journal/first record The first post` (the draft is out, and `notes/other.md` does not match `posts/{slug}.md`)
  - `/journal/second page Shadow` (the static route shadows the record route)
  - `/r/one project-page Release one` (`release-two` has `listed: false`, and the else page `missing` is not listed)
- **Left out, as intended:** `/secret` (admins only), `*`, and `/runs/:id` (no record).
- **Embedding:** the page `index`, which reads `$site`, gets all seven rows in its `#slop-boot`.
- **Invalidation:** a new route `/journal` appears in the next `GET /api/site` without waiting for the TTL.
- `make lint` 0; `go test ./pkg/server ./pkg/routing ./cmd/...` ok; `tsc --noEmit` 0.

### What didn't work
- **The first mutation check proved nothing.** Replacing the shadow condition with `if !ok {` left `res` unused, so the run ended in `FAIL … [build failed]`, a compile error rather than a test failure. A second mutation, `if !ok || res.Route.Path == "" {`, compiled and failed the test: the got list showed `/journal/second record The second post` instead of `/journal/second page Shadow`. I restored the condition by replacing the exact text back (no `git checkout`), and the test passes again.

### What I learned
- `store.TemplateParams` and `routing.TemplateMatcher` give the names and groups of a page-from template in the same order, which is enough to recover the route parameter from an admitted page id.
- A route's record pattern is matched against the record **paths** of every data binding of its page. That is how `/apps/:id` with record `{id}.json` finds catalogue entries, while media files (`.png`) don't match.

### What was tricky to build
- **Where the data comes from for record routes.** Data can come from either side: the page's `reads` (journal-post reads `posts`) or the route's own `bindings` (`/apps/:id` binds `catalog`). Using `s.bindings(ctx, v, &rt)` covers both, plus `$tokens`, which is skipped.

### What warrants a second pair of eyes
- **Cost on a cache miss.** `siteEntries` calls `admits` per project artifact, and that looks up the artifact again. For about 100 release pages this is about 200 small queries per miss; it is cached, but it is worth watching.
- The unlisted rules accept string flags (`"true"`, `"False"`), because the francois import wrote booleans as strings.

### What should be done in the future
- The Pinup side (tasks 7–10), then the end-to-end run.

### Code review instructions
- `pkg/server/siteindex.go` (`siteEntries`), then `siteindex_test.go`; `renderPage` in `serve.go`; `publish` in `server.go`.
- Validate: `GOWORK=off go test ./pkg/server ./pkg/routing -count=1`.

### Technical details
- `GET /api/site?host=site.test` → `[{id, path, title, kind, route, page, section, depth, updated, project?, projectName?, record?}]`, or 400 `host must be one of the site hosts`.

## Step 3: The Pinup features, and a Site map app on the local server

I implemented guide §4 in `web/pinup/slop/js/96-slop-app.js`:
- `href` links to any URL;
- `where` filters;
- repeats over a list field;
- rich text from a field;
- `$site` as a source in App settings and the field hints.

I extended the browser test, then built a real app on the local server: a new design, `design-site-map`, published at `site.localhost:18120/site-map`. It lists every public page, journal post, app and release read from `$site`, and each card links to its real URL. A second screen, `/site-map/read/:id`, shows a journal post as rich text.

The run found three problems:
- the visibility rule hid every catalogue entry;
- agent steps silently dropped the new fields;
- the filter row's inputs collapsed.

All three are fixed and recorded below.

### Prompt Context
**User prompt (verbatim):** see Step 1 (prompts 2 and 3).
**Assistant interpretation:** Guide §4–§6 (tasks 7–12): the Pinup features, tests, docs, and the end-to-end run.
**Inferred user intent:** Design the site's navigation in Pinup, live from what is on the site.
**Commit (code):**
- `f9ba57f` — "Pinup apps: links to any URL, repeat filters, list-field repeats, rich text, $site as a source"
- `409bb65` — "Site index: hide records by an explicit set of visibility values, not by 'anything but public'"
- `f5e8662` — "Pinup apps: agent steps may set the app fields; condition rows on a grid"

### What I did
- **Compiler:**
  - `slopAppHref` / `APP_URL` (`^(/|https?://|mailto:|#)`); `href` wins over `link`; external links get `rel="noopener"`;
  - `data-where` (JSON) and `data-repeat-field` on repeat templates;
  - rich text: a `div` with class `pinup-rich` and `data-html`, plus `.pinup-rich` rules;
  - `slopAppCheck` refuses a static `href` that is neither a site path nor an http(s) URL, and a list repeat without a field.
- **Runtime:**
  - `cmp` and `sortRows` with dotted fields (`-record.date`);
  - `test(v, op, want)` for `=`, `!=`, `contains`, `<`, `>`, `exists`, `missing`, with arrays handled by element;
  - `items(v)` for list fields (primitives become `{value, index}`);
  - `LINK`, checked again after filling `data-href`;
  - `clean` and `rich`: a `DOMParser` document, allowlisted tags, removal of dangerous elements, `a[href|title]` and `img[src|alt|title]` with safe URLs, then `adoptNode` into the page.
- **Editor:**
  - App settings offer *This site's public pages ($site)*;
  - `slopAppFields` reads `GET /api/site?host=` for `$site` (top-level keys plus `record.*`);
  - `slopAppScope` / `slopAppScopeNote`;
  - the Repeat section has "For each" (record of a source, or item of a list field…), condition rows, Sort and At most;
  - new sections "Link to a URL" and "Rich text from".
- **Steps:** `ALLOWED_KEYS.add` for `route`, `record`, `repeat`, `href`, `html`.
- **Tests:** `slop/tests/app.js` gained 10 checks (37 in all). Docs: `slop help pinup` (table rows, "Reading the site") and `slop help agents` (`$site`).
- **End to end:**
  - binaries `slop11` and `slop12`; Pinup v6, v7 and v8, each updated in the Workshop;
  - created `design-site-map` (project Play) in the picker;
  - as the agent, imported the Site map screen (`inbox/h1`, 38 layers) and the Read screen (`inbox/h2`);
  - in the UI, made it an app (`pages` = `$site`, `posts` = `journal`) and set the Pages repeat (where `kind = page`, sort `title`);
  - as the agent, set the other repeats and the `{{path}}` links (`inbox/s2`) and the Read screen (`inbox/s3`);
  - published.

### Why
- **Filter values are filled from the enclosing scope, not the row.** A screen `/topics/:tag` can then use `record.tags contains {{params.tag}}`.
- **Rich text is cleaned in an inert `DOMParser` document,** so handlers like `onerror` never run, before the nodes are adopted into the page.
- **App fields are added to Pinup's `ALLOWED_KEYS` instead of the steps code being changed,** because the upstream sources stay untouched (sha256 still `531ef701b5c1417e`).

### What worked
- **Browser test:** all 37 checks pass, including:
  - journal rows only, sorted by path, linking to their paths;
  - a `javascript:` path loses its `href`;
  - tags repeat per row;
  - rich text keeps `<strong>` and drops `script`, `onerror`, `onclick`, `iframe`, `style` and the `javascript:` link (`window.__pwned` stays unset).
- **Mutation check of the sanitizer.** With attribute removal disabled (`… void 0;`), 2 checks fail (`onerror` kept; `["javascript:alert(1)","/ok"]`). Restored by replacing the text back, and the test passes again.
- **`slop site ls` on the local data:** 241 URLs (12 pages, 123 records, 106 project pages). Sections: r 106, apps 101, experiments 14, journal 9, …. A cache miss takes 0.20 s, a hit 0.04 s.
- **`/site-map` on the site:**
  - PAGES 13, sorted by title;
  - JOURNAL 9, newest first by `record.date`;
  - APPS 12 (limit), with `record.title exists`, so the catalogue's `index` record is skipped;
  - RELEASES 24 (limit), newest first;
  - following links works: `/journal/pages-and-data` → "Pages and data · slop.boutique", `/r/storefront` → 200, `/apps/agent-gym-works` → 200;
  - no page errors.
- **`/site-map/read/routes-not-templates`** → "Routes, not templates · Site map", three `<p>`s with the post's bold `/journal/:slug`, and Back → `/site-map` (screenshot `s6-04`).
- **Checks:** `make lint` 0; `go test ./...` 0; Postgres (`pkg/server`, `pkg/store`, `pkg/routing`) ok; `tsc` 0.

### What didn't work
- **The visibility rule hid the whole catalogue.** The first `slop site ls` on the local data listed 141 URLs with a single `/apps/…` entry (`/apps/index`). The francois catalogue's values are `{'listed': 100, 'hidden': 4}`, and my rule kept only `visibility` = `public`. Fix (`409bb65`): an explicit hiding set (`hidden`, `private`, `draft`, `unlisted`, `internal`). The test adds `visibility: "listed"` (listed) and `draft: "True"` (hidden). Now 241 URLs, with 101 under `/apps`.
- **`slop site ls --output json` failed:** `unknown flag: --output`. The glazed flag is `--format`; the command's help example is fixed.
- **Agent steps dropped the new fields.** After `inbox/s1` was consumed, `slop docs get … nodes/Ya5e3gbNf4` showed no `repeat`. Pinup's step code copies only keys in `ALLOWED_KEYS` (`src/10-claude.js:64`; `13-feedback.js:382` `STEP_KEYS = ALLOWED_KEYS`), so `route`, `record`, `repeat`, `href` and `html` were dropped silently. This had also been wrong since SLOP-005, whose help said agents could set these with steps; that run used only `text` and `ov`, which are allowed. Fix (`f5e8662`): `96-slop-app.js` adds the keys to the set at load. Re-sent as `inbox/s2` and `s3` (`seq` 2 and 3), and the fields landed.
- **Condition inputs collapsed** (screenshot taken before the fix): the field and value inputs shrank to a few pixels next to a full-width operator select. Fix: a grid `minmax(0,1fr) 84px minmax(0,1fr) 28px` with explicit widths (`s6-02`).
- **Tree driving:** expanding every collapsed row in a loop got stuck on leaf rows, whose expand button is hidden. I expanded the ancestors by id instead.

### What I learned
- **`$site` sections follow the first path segment,** so a section mixes kinds. The JOURNAL list included the `/journal` index page (kind `page`) at the end; `kind = record` filters it out.
- **The index shows real route-table quirks.** `/apps/:slug` (app-page) is fully shadowed by `/apps/:id` (same specificity, earlier in order), so none of the 14 experiments appear under `/apps/`; they appear under `/experiments/`.

### What was tricky to build
- **Scope for filter values versus rows.** `lookup([row], c.field)` reads the row, and `fill(c.value, chain)` reads the enclosing scope. Mixing them up would let `{{title}}` in a condition mean the row's own title.

### What warrants a second pair of eyes
- **The rich-text allowlist and URL rule** (`clean` in `slopAppRuntime`), especially `img src` with relative paths and `data:` URLs (refused today).
- **Index size in pages:** `/site-map` embeds 241 rows. The catalogue record fields are kept (minus body/html), which makes every reader's boot JSON larger.

### What should be done in the future
- Per-reader filters on `$site` (guide §7), and deploying to the cluster (new image, `make pinup-push`, update the tool).

### Code review instructions
- `96-slop-app.js`: `emit` (`href`, rich text, repeat attributes), `slopAppRuntime` (`test`, `items`, `clean`, `rich`, `bind`), `slopAppSections` (Repeat, Link to a URL, Data).
- Validate: `cd web/pinup && node slop/build.js && node slop/tests/app.js`, then `GOWORK=off go test ./pkg/server -run TestSiteIndex`.

### Technical details
- Screenshots:
  - `s6-01` App settings with the `$site` source;
  - `s6-02` Repeat with a condition;
  - `s6-03` `/site-map` on the site (full page);
  - `s6-04` the rich-text Read screen.
- Steps used: `inbox/s2` (repeats with `where`, `sort`, `limit`; `href: "{{path}}"`) and `inbox/s3` (`route: "/read/:id"`, `record: "posts"`, `html: "html"`, Back `href: "/site-map"`).
