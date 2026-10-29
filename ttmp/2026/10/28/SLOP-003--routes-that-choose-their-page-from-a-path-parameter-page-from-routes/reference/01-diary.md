---
Title: Diary
Ticket: SLOP-003
Status: active
Topics:
    - routing
    - architecture
    - backend
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological implementation diary for SLOP-003: page-from routes."
LastUpdated: 2026-10-28T20:01:17.638208354-04:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Record, step by step, how SLOP-003 was designed and built: routes that choose their page artifact from a path parameter. Include the evidence, the failures and the review notes.

## Step 1: Why the import needed 100 routes, and the design that removes them

The question came while I was finishing the SLOP-002 admin how-to. I first read the routing code end to end: `pkg/routing`, `serveSite` and `serveSandbox` in `pkg/server/serve.go`, `pkg/store/routes.go`, the route API in `kernel.go` and `preview.go`, the CLI in `cmd/slop/cmds/routes.go`, and the Workshop's Routes and Site screens. I also re-read the storefront agent's NOTES (§4–§8, §14). The gap is exact: a route's `record` can be chosen by a parameter, but its `page` is fixed when the route is written. So the francois import, which has one page artifact per release, needed one route per release.

I opened SLOP-003, wrote the intern guide (`design-doc/01-…`) and uploaded it to reMarkable. The design is a `pageFrom` template on the route (`{page}`), limited to the project of the route's own page. That page also serves as the 404 "else" page. Resolution stays server-side, so no JavaScript router is needed.

### Prompt Context
**User prompt (verbatim), 1:** "did we have to make individual pages for all artifacts, can we make wildcard / keyword matching cards?
  and if so, would we need some JS in the mix to handle the route -> render part?"
**User prompt (verbatim), 2:** "create a new docmgr ticket and a Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable.


Then implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)

Use the diary format from the skill, this is MANDATORY"
**Assistant interpretation:** Explain whether the 100 `/r/<page>` routes were necessary, design a wildcard route that picks its page from the URL, document the whole serving path for an intern, upload the guide, then build it.
**Inferred user intent:** Get rid of per-release routes so the catalogue scales and stays current, and leave a document that someone new can learn slop's routing from.
**Commit (code):** none yet (design only); the docs commit follows this entry.

### What I did
- Read `pkg/routing/routing.go` (Match, Specificity, Resolve), `pkg/server/serve.go` (serveSite :256, gates :279–316, relative assets :328–347, serveSandbox :386), `pkg/store/routes.go`, `002_kernel.sql:57` (`page … REFERENCES artifacts(id)`), `kernel.go:40-44,467-505`, `preview.go:62`, `cmd/slop/cmds/routes.go`, `pkg/seed/seed.go:66,196`, and `RoutesScreen.tsx`, `SiteScreen.tsx`, `types.ts:46`.
- Checked whether following `main` would change what is served. I joined the SLOP-002 `release-routes.tsv` pins with the local `refs` table (`name='main'`): `100 pinned; 100 equal to main`. The local server has 106 page artifacts in project `francois`.
- `docmgr vocab add --category topics --slug routing`, `docmgr ticket create-ticket --ticket SLOP-003 …`, and `docmgr doc add` for the design doc and this diary. Ten tasks added; task 1 is checked.
- Wrote the guide. Its 13 sections cover:
  - the host classes;
  - the nouns;
  - routes and matching;
  - the site request pipeline: boot data, `/_d/`, `/_v/`, relative assets, sandbox;
  - API and CLI tables;
  - the francois import;
  - the problem, and why JS can't fix it;
  - four options;
  - the design: model, semantics, validation, exposure, gates, resolution, an end-to-end trace, API and CLI;
  - the plan by file, the tests, the rollout, future work and a glossary.
- `remarquee upload bundle … --name "SLOP-003 Page-from routes intern guide" --remote-dir /ai/2026/10/28/SLOP-003` → `OK: uploaded SLOP-003 Page-from routes intern guide.pdf -> /ai/2026/10/28/SLOP-003`.

### Why
- **Keep `page` as an FK and add `page_from`.** A template can't live in `routes.page`, because the column references `artifacts(id)`, and dropping a foreign key in SQLite means rebuilding the table. Keeping the FK also gives a page-from route the two things it needs anyway: a scope (the page's project) and a page to show when nothing matches.
- **Server-side, not JS.** A public page can't fetch another page's HTML: `/_v/` returns 404 unless the page is routed. A JS router would also break boot data, relative assets and 404 status codes.
- **The template comes from the URL, not from the record (option D).** The URL already carries the page id. D would need data to be loaded before a page is chosen.

### What worked
- The pins-against-main check means the switch to one follow-`main` route changes nothing a visitor sees today.

### What didn't work
- My first query used guessed column names. The real names are `refs.n` and `project_id`, not `main_version` and `r.version`:
  - `ERROR:  column "main_version" does not exist`
  - `ERROR:  column r.version does not exist`
  
  Fixed by checking `\d refs`.
- The first guide draft named `POST /api/preview`. The real endpoint is `GET /api/sandbox-url` (`preview.go:14`), and I corrected it before uploading.

### What I learned
- `routing.Resolve` breaks ties between equal-specificity patterns by database order (`ORDER BY host, path`). That is the cause of the agent's silent shadowing in NOTES §7: `/apps/:id` sorts before `/apps/:slug`.
- Relative assets under a param route already work through the Referer fallback. `/r/style.css` from `/r/weft` resolves the Referer path, so the design only has to swap `versionOf(route)` for the new `target(res)`.

### What was tricky to build
- Gating. `/_v/` and `/_d/` both decide what is public by asking which pages are routed. A page-from route makes a whole set of pages routed, so both gates need an `admits(route, artifact)` rule. For `/_d/` that means a scan over the project's pages, done only after the static routes have failed to match.

### What warrants a second pair of eyes
- Exposure. `{page}` in project `francois` publishes every francois page at `/r/<id>`, including `storefront`, `storefront-entry` and the agent's `probe-media`. These are already public or harmless, but it's a publishing decision, so the guide's §8.4 makes it visible in the CLI echo, the list column and the Workshop.
- The cost of the `/_d/` fallthrough: one query per candidate page, on misses only.

### What should be done in the future
- Implement tasks 2–9. The rollout (task 10) waits for PR merges by the user.

### Code review instructions
- Read the guide, sections 8 and 9, then compare them with `pkg/server/serve.go:256-367`.

### Technical details
```
local check: join release-routes.tsv pins with refs(name=main) → 100 pinned; 100 equal to main
reMarkable: /ai/2026/10/28/SLOP-003/SLOP-003 Page-from routes intern guide.pdf
```

## Step 2: Page-from routes, built and tried on the local francois copy

This step builds the design from step 1. It adds a `page_from` column and validation in the store, and `Resolution.Page` with `TemplateMatcher` in the routing package. In the server it adds `admits`, `target` and `pageFromReads`, which are used by the site render, both gates, relative assets, the sandbox and `/api/resolve`. It then covers the CLI, the seed format, the Workshop, Safe mode and the agents help topic. On the local server, which holds the francois import, one route `/r/:page → {page}, else release-missing` replaced the 100 static routes, and every release body is unchanged.

The behaviour is as designed:

- All 100 old URLs return 200.
- The three releases that never had a route (`craftkit-studio`, `polis`, `stackchan-pet-studio`) now have a URL.
- `/r/nope`, a data artifact id (`/r/francois-catalog`) and a page from another project (`/r/about`) get the else page with 404.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Implement the guide's plan, sections 9 and 10, and run the rollout of section 11 locally.
**Inferred user intent:** One route instead of a hundred, current with `main`, working on real data.
**Commit (code):**
- `c708f11` "Page-from routes: a route can choose its page from a path parameter";
- `3772573` "Page-from routes in the CLI, seeds, Workshop, safe mode and help";
- this commit (diary, screenshots, the else page and the swap script).

### What I did
- **Store:**
  - `pkg/store/migrations/{postgres,sqlite}/005_route_page_from.sql`.
  - `pkg/store/routes.go`: `Route.PageFrom`, `TemplateParams`, `validPageFrom`, the version and project checks, and the extra column in `routeColumns`, `scanRoute` and the upsert.
  - Test: `TestPageFromRoutes` in `pkg/store/kernel_test.go`. It covers five refusals, set, undo, which restores `pageFrom`, and list.
- **Routing:** `pkg/routing/routing.go` gains `Resolution.Page`, `Resolution.Missing`, `fill` and `TemplateMatcher`. Test: `TestPageFrom`.
- **Server:**
  - `pkg/server/serve.go`: `projectOf`, `admits`, `target` and `pageFromReads`.
  - `routedPage` (the `/_v/` gate) now also accepts admitted pages.
  - The `/_d/` gate falls through to `pageFromReads`.
  - Asset lookups skip a missing target; the Referer branch uses `target`.
  - The main render returns 404 when `Missing`.
  - The sandbox `/_d/` check accepts `admits`.
  - `pkg/server/preview.go` `resolveRoute` reports the served page.
  - Test: `TestPageFromRoutes` in `pkg/server/serve_test.go`. It covers PUT, a bad param (400), 200 with `version.artifact == weft`, four else-page cases with 404, a relative asset through the Referer, `/_v/` 200 and 404, `/_d/` 200, and `/api/resolve` for a served page and a missing one.
- **CLI:**
  - `--page-from`, with an extended long help;
  - a `page_from` column in `route list`;
  - `describeRoute` shows the template;
  - after `route set`, the CLI prints "Every page of project X whose id fits T is now public at …".
- **Client and seed:** `PageFrom` on `client.Route` and on `seed.Route`, which `Push` passes on.
- **Workshop:**
  - `types.ts`: `pageFrom`, plus `page` and `missing` on `Resolution`.
  - `RoutesScreen.tsx`:
    - the table cell shows `{page}` and "else X", with "main of each" under Points at;
    - the detail shows "Page from" and "Else page", and hides the version picker.
  - `SiteScreen.tsx`: previews and watches the served page, and explains a miss.
  - `events.ts`: the event-feed sentence.
- **Safe mode:** `safe.tmpl` shows the template, and the version form is hidden for these rows.
- **Help:** `pkg/doc/topics/agents.md` gains a cheat-sheet line and replaces "a route serves one page" with how to use page-from routes and what they publish.
- **Local rollout:**
  - pushed `release-missing` v1 to project `francois`;
  - `slop route set /r/:page release-missing --page-from '{page}'`;
  - hashed all 100 `/r/<page>` bodies, with the `#slop-boot` script stripped;
  - `slop route rm` ×100;
  - re-hashed: identical.
- **Saved:**
  - `various/release-missing/index.html`, the else page;
  - `scripts/01-swap-release-routes.sh`, the cluster swap;
  - screenshots `various/s3-01…s3-03`.

### Why
- `target` returns `(version, missing, err)` rather than mutating the resolution. The asset path calls it on a candidate resolution, and an earlier draft that set `res.Missing` inside `target` would have carried stale state into a second call.
- Asset lookups skip a *missing* target in the same way they already skip the `*` fallback. Otherwise `/r/style.css` would take the else page's `style.css` before trying the Referer's page.
- The CLI's exposure notice exists because a page-from route is a publishing decision for a whole project (guide §8.4).

### What worked
- `go test ./...` passes on SQLite. `TEST_DATABASE_URL=postgres://…:55432/postgres go test ./pkg/store/... ./pkg/server/... ./pkg/francois/...` passes on Postgres.
- A mutation check: forcing `admits` to return false makes `TestPageFromRoutes` fail on `/r/weft 404 … "version":{"artifact":"release-missing"…`. So the test exercises the new path.
- `make lint` → exit 0 (after the fix below). `npx tsc --noEmit` → exit 0. `make web` → 0.
- Local server: `Applied migration migration=005_route_page_from.sql` on start.
- The swap:
  - `rm failures: 0`; 15 route rows left, down from 114;
  - `100/100 bodies identical (boot data aside)` and `200s: 100/100`;
  - `/r/craftkit-studio`, `/r/polis` and `/r/stackchan-pet-studio` return 200;
  - `/r/nope`, `/r/francois-catalog` and `/r/about` return 404;
  - `/` and `/apps/weft` still return 200.
- CLI refusal: `invalid_request: pageFrom uses {nope}, but the path /r/:page has no :nope`.
- Screenshots:
  - `s3-01`: the Routes table and detail for `/r/:page`;
  - `s3-02`: Site `/r/weft` → `weft v1 (main) · from {page}`, with the release running in the preview;
  - `s3-03`: Site `/r/nope` → "{page} names no page here (404)", and the else page says "There is no release called `nope`."

### What didn't work
- **Named results again.** `make lint` → `pkg/server/serve.go:280:1: named return "v" with type "store.Version" found (nonamedreturns)`. This time lint went to a file with `$?` checked (`lint=2`), so nothing was committed with it. I rewrote `target` without named results, and lint gave exit 0.
- **A false typecheck pass.** My first typecheck printed `tsc=0`, but `$?` there was `tail`'s exit code, not `tsc`'s. Rerun with the output going to a file: `tsc=0`, a real pass.
- **CLI flag.** `slop route list --output csv` → `unknown flag: --output`. Glazed's flag is `--format`. This is the same confusion the agent reported in NOTES §9.
- **Server key in credentials.** `SLOP_CONFIG_DIR=…/cfg-manuel slop route list --server http://localhost:18120` → `not logged in to http://localhost:18120`. The credentials are stored under `http://127.0.0.1:18120`, and that origin works.
- **Restart without the Workshop.** As in SLOP-002 step 10, one restart used a binary built without `-tags embed`. This time I caught it from the snapshot ("This binary has no Workshop") before the screenshots.

### What I learned
- `slop serve` migrates on start unless `--no-migrate` is passed, and the gitops deployment doesn't pass it. So the cluster gets 005 with the image bump. The column is additive with a default, so a pod still on the old image keeps working during the rollout.
- Static routes are more specific than the template (score 6 against 5). The page-from route can be added first and the static routes removed one at a time with no window of 404s.

### What was tricky to build
- **The `/_d/` gate.** For data that no static route's page reads, the gate now lists the project's artifacts and fetches each admitted page's `main` version. On the local copy that is up to 106 version reads for a miss. Hits on static routes, such as the storefront's covers, never reach it.
- **The tie between "missing" and "fallback".** Both mean "serve the route's page as a 404". They stay separate fields because the Workshop words them differently: "no route of its own" versus "{page} names no page here".

### What warrants a second pair of eyes
- Cost of `pageFromReads` on `/_d/` misses. It could become a per-request scan if a site had many page-from routes over big projects. A cache keyed on the project's newest version would bound it.
- `admits` does two artifact lookups per call, and `routedPage` calls it for every public page-from route on each `/_v/` request.
- Exposure: `/r/storefront`, `/r/storefront-entry` and `/r/probe-media` are now reachable locally. They are harmless, but the cluster rollout should consider `--page-from` with a prefix if the importer is ever changed to name releases `release-*`.

### What should be done in the future
- Cluster: once PR #2 is merged and the image is published, bump the gitops tag, then run `scripts/01-swap-release-routes.sh` with `HOST=site.slop.yolo.scapegoat.dev`.
- Route conflict warnings (NOTES §7) and page-by-record (option D), per guide §12.

### Code review instructions
- Start with `pkg/server/serve.go`: `admits`, `target`, `pageFromReads`, then `serveSite`. Next `pkg/store/routes.go` (`validPageFrom`, `validate`, `setRoute`), then `pkg/routing/routing.go`.
- Validate:
  - `go test ./pkg/routing ./pkg/store ./pkg/server`;
  - `TEST_DATABASE_URL=… go test ./pkg/store ./pkg/server`;
  - `make lint`;
  - `cd web/workshop && npx tsc --noEmit`.

### Technical details
```
PUT /api/routes {"host","path":"/r/:page","page":"release-missing","pageFrom":"{page}"}
GET /api/resolve?host=site.test&path=/r/nope → resolution.page "release-missing", resolution.missing true
validation: pageFrom ^([a-z0-9-]|\{name\})+$, ≥1 placeholder, each a :param of path; version must be null; page must have a project
local: 114 → 15 routes on site.localhost:18120; 100/100 bodies identical; release-missing@1 in francois
```
