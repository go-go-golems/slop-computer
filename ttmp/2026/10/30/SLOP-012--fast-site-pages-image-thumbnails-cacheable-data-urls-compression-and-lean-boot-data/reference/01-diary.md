---
Title: Diary
Ticket: SLOP-012
Status: active
Topics:
    - architecture
    - backend
    - routing
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/10/30/SLOP-012--fast-site-pages-image-thumbnails-cacheable-data-urls-compression-and-lean-boot-data/design-doc/01-intern-guide-serving-site-pages-fast.md
      Note: The intern guide this diary records
    - Path: repo://ttmp/2026/10/30/SLOP-012--fast-site-pages-image-thumbnails-cacheable-data-urls-compression-and-lean-boot-data/scripts/01-measure-site.py
      Note: Page-weight measurement, before and after
ExternalSources:
    - https://site.slop.yolo.scapegoat.dev/
    - https://github.com/wesen/2026-03-27--hetzner-k3s/pull/401
Summary: "Chronological diary for SLOP-012: making site pages fast (thumbnails, cache policy, compression, lean boot data)."
LastUpdated: 2026-10-30T17:10:00-04:00
WhatFor: "How the SLOP-012 design was produced, with measurements"
WhenToUse: "Before continuing SLOP-012 or reviewing its guide"
---

# Diary

## Goal

Record how SLOP-012 was designed. The storefront at `site.slop.yolo.scapegoat.dev` takes a long time to load. The ticket designs one consistent way for slop to serve site pages fast: image thumbnails by URL, one cache policy keyed on whether a URL names content or a place, gzip for text, and boot data that is cacheable instead of inlined.

## Step 1: Measuring the storefront, finding a cache bug, deploying main

The user asked how the landing page works, why it is slow, and how to get thumbnails and proper image caching. I measured the live page with curl, read the code paths that serve it, and found the cost: 76 MB of full-size cover images, no compression, a 664 KB inline data block on every page, and `main` data URLs that revalidate on every visit. While mapping cache headers I also found a correctness bug: page-relative files such as `/boutique.css` are served `immutable` for a year at a URL that does not change between versions.

In the same step:
- **Workshop dropdown:** the user reported that it shows only the three "No project" pages. The menu drops artifacts whose project is not in the projects list.
- **Deploy:** the user pointed out that the cluster does not run the latest build. With their approval I opened the GitOps PR for `sha-2ac2611`.
- **Token:** the stored token for the cluster had expired. A device login is waiting for approval.

### Prompt Context

**User prompt (verbatim, the question):** "how does the landing page on site.slop.yolo.scapegoat.dev work, and how can I have it show thumbnails and properly handle image caching, because it takes for ever to load, and I don't see it as a page in the backend either."

**User prompt (verbatim, this ticket):** "ok, you can acquire a new token for slop.yolo. then create a new ticket and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. We want consistent, elegant, simple, expressive. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill) Diary Format (skill) is MANDATORY"

**Mid-step prompts (verbatim):**
- "I was able to see storefront once in the dropdown list, but now i only see the \"no project\" 3 pages, why is that? Where do I see the rest of the pages?"
- "oh it doesn't show, because I think we might now have deployed the latest version. Ths finished but not gitops PR was done : https://github.com/go-go-golems/slop-computer/actions/runs/41079389089"

**Answers to my questions (AskUserQuestion):**
- Deploy `sha-2ac2611`, accepting that migration 007 drops the old docs and tools tables: "Open GitOps PR (Recommended)".
- Device login: "I'll approve it now".

**Assistant interpretation:** Write an intern guide for SLOP-012 (design only, no implementation), upload it, and keep this diary. Get a cluster token for evidence. Open the GitOps PR the CI run skipped.

**Inferred user intent:** A design for fast site pages that fits slop's model cleanly (one cache rule, one thumbnail mechanism, one data mechanism) rather than storefront-specific hacks.

**Commit (code):** none. Commit (docs): see the changelog.

### What I did

- **Measured the page:**
  - `curl -D - https://site.slop.yolo.scapegoat.dev/`: 200 with `cache-control: no-store`, 670,476 bytes, 1.7–4.0 s. Headers: `x-slop-environment: test`, `x-robots-tag: noindex, nofollow` (from the Traefik middleware `test-headers`).
  - The boot block is `"version":{"artifact":"storefront","n":1}`, route `/`.
- **Parsed the boot block** (Python, scratchpad). It is 664,252 bytes:
  - `catalog`: 104 records, 380,339 bytes;
  - `media`: 304 records, 136,971 bytes;
  - `media2`: 360 records, 163,641 bytes;
  - `media3`: 28 records, 12,565 bytes.
  The page script reads only `slop.data.catalog.list()`.
- **Covers:** 100 listed apps, 94 with a cover, **76.3 MB** at full size. They are `.webp` and `.jpg`, mostly 130–800 KB each, shown in tiles about 400 px wide (CSS `aspect-ratio: 8/5`, 3 columns).
- **Cover URLs** come from the catalog records as `/_d/francois-media-N/main/files/med_….webp`. The importer writes `/main/` (`pkg/francois/extract.go:73`). The file records' own `src` uses numbered versions (`records()`, `pkg/server/serve.go:72-78`).
- **Cache headers** (`curl -D -`):
  - `/_d/…/main/…`: `cache-control: no-cache`, ETag = sha256.
  - `/_d/…/1/…`: `cache-control: private, max-age=31536000, immutable`.
  - A revalidation with `If-None-Match` returns 304 in 0.57 s.
  - `/boutique.css` (page-relative): `private, max-age=31536000, immutable`. **This is the bug.**
- **Latency vs bytes** (three rounds each):
  - `/healthz` TTFB 0.42–0.50 s with connect 0.11–0.12 s;
  - `/_slop/runtime.js` 0.57–0.69 s;
  - a `/_d/` 304 0.55–0.72 s;
  - a 404 route 0.36–0.50 s.
  - Download speed varied between 40 KB/s (624 KB in 16.6 s) and 500 KB/s (798 KB in 1.6 s).
- **Compression:** `Accept-Encoding: gzip, br` returns no `Content-Encoding`. `gzip -c` of the page is 171,254 bytes (about 4×). There is no gzip in `pkg/server` or `pkg/httpx`, and no compress middleware in the Traefik ingress (`hetzner-k3s-slop/gitops/kustomize/slop/ingress.yaml`, `test-headers.yaml`).
- **The entry page** `/apps/bench-twin` is `storefront-entry`. It is 676,499 bytes with the same four bindings inlined, although it shows one record (`record: bench-twin.json`). Its gallery uses full-size images in 160 px tiles.
- **Read the serving code:**
  - `serveSite` (`serve.go:334-448`), `serveData` (`serve.go:234-259`), `serveBlob` (`kernel.go:240-251`);
  - `serveAsset` (`rt_more.go:393-413`), `writePage` (`serve.go:213-218`);
  - `records` and the record cache (`serve.go:29-81`), `bindings` (`serve.go:99-123`);
  - `pkg/blobs/blobs.go`: `Open`, `Read`, and `Collect`, which walks only `blobs/`;
  - `pkg/render/assets/runtime.js`: `slop.data.<name>.list/get/all`.
- **Who uses `.all` synchronously:** Pinup's compiled apps, `web/pinup/slop/js/96-slop-app.js:268` (`d.all.slice()`). Any lazy-data design must keep `.all` synchronous.
- **Deployment facts** (`hetzner-k3s-slop/gitops/kustomize/slop/`):
  - Traefik ingress for the three hosts;
  - memory limit 512 Mi;
  - blobs on a 5 Gi `local-path` PVC at `/var/lib/slop/blobs`.
- **Measurement script:** `scripts/01-measure-site.py`. Baseline output:
  ```text
  page https://site.slop.yolo.scapegoat.dev/: 200, 670476 bytes on the wire, 670476 raw, 170738 if gzipped, 3.26s
    cache-control: no-store  content-encoding: None  etag: None
    boot block: 664252 bytes
      data.catalog: 104 records, 380339 bytes
      data.media: 304 records, 136971 bytes
      data.media2: 360 records, 163641 bytes
      data.media3: 28 records, 12565 bytes
    covers: 94, 76.3 MB at full size
    first cover /_d/francois-media-3/main/files/med_fc427b42fb1d4fdb36e63b71.webp: 200 cache-control=no-cache 0.67s
    first cover ?w=480: 200 285314 bytes type=image/webp cache-control=no-cache 2.33s
  ```
  `?w=480` is ignored today: it returns the full 285 KB original.
- **Workshop dropdown:** read `ArtifactMenu` (`web/workshop/src/components/organisms/TopBar.tsx:114-133`) and `ArtifactsScreen` (`:14-29`). Both build groups from `useProjectsQuery()` plus "No project", and `arts.filter(a => a.project === g.id)` drops artifacts whose project is not in the list. The cluster's cause (projects request failing, or the old build) is to be confirmed with the token.
- **Deploy:**
  - `gh run view 41079389089`: `release / publish` succeeded and built tags `sha-2ac2611`, `latest` and `main`; `Open GitOps PR` was skipped.
  - The cluster runs `sha-96eab85` (`origin/main` of hetzner-k3s, PR #400).
  - Between the two builds: 29 commits, migration `007_runtime.sql`, and new optional `--models`/`--pi-*` flags only.
  - Asked the user about the destructive migration; they chose to open the PR.
  - In `hetzner-k3s-slop`: `git switch -c slop/image-2ac2611 origin/main`, a one-line image bump, commit, push, `gh pr create` → **https://github.com/wesen/2026-03-27--hetzner-k3s/pull/401**.
- **Token:** `slop auth login --server https://slop.yolo.scapegoat.dev --days 7` (device flow, background). The first code `MRWH-ZGRJ` expired. The second, `JTLX-FSHP`, is waiting for approval.
- **Ticket:** `docmgr vocab add --category topics --slug performance`; `docmgr ticket create-ticket --ticket SLOP-012 …`; the design doc and this diary.

### Why

- **Measure before designing.** The obvious fix ("add thumbnails") covers the largest cost, but the measurements show four independent costs: image bytes, uncompressed text, inline data on every page, and revalidation of `main` URLs. One of them, page-relative files, is a correctness bug, not only a speed problem.
- **The deploy PR was the user's call** because migration 007 drops tables. Asked first, then opened it.

### What worked

- Every number above comes from the live cluster with read-only GETs and HEADs.
- The GitOps PR is a one-line diff that follows the previous bump commits' naming.

### What didn't work

- `slop route list` against the cluster: `the server rejected the token (revoked or expired); run slop auth login, or update SLOP_TOKEN or --token-file: token_invalid: The API token is invalid, expired or revoked`. The stored token's expiry was 2026-10-30.
- First device login: `the code expired; run slop auth login again` (code `MRWH-ZGRJ`, not approved within 10 minutes). Restarted with `--no-browser`.
- First cover-measurement script: `KeyError: 'src'`. Some media records have no `src` (`.get` fixed it).
- `gh run view --job … --log | grep 'ghcr.io/…:sha-'` found no tag in the log. The tags came from `gh api /orgs/go-go-golems/packages/container/slop-computer/versions`.

### What I learned

- **Bandwidth is the dominant cost on the cluster.** About 0.45 s per new connection plus 40–500 KB/s. Every byte saved matters more than server CPU.
- **`main` URLs are the problem, not `/_d/` itself.** Numbered `/_d/` URLs are already immutable.
- **Two URL kinds need opposite cache rules:**
  - content-addressed URLs (a version number, or a hash) can be cached forever;
  - place-addressed URLs (`main`, page-relative paths, page HTML) must be revalidated.
  The current code mixes them up in one place (page-relative files) and over-corrects in another (HTML is `no-store`).
- **Pinup apps read `slop.data.<name>.all` synchronously,** so data loading must stay synchronous for the page.

### What was tricky to build

- **Nothing was built.** The design question that took the most thought: making boot data cacheable without breaking synchronous `.all`. Inline JSON is uncacheable because the HTML is a place-addressed URL. A synchronous `<script src="/_d/<artifact>/<n>/_records.js">` per binding is content-addressed (immutable), gzippable, and still runs before the page's own scripts.

### What warrants a second pair of eyes

- **Migration 007 on the cluster** (PR #401): the old `docs` and `tools` tables are dropped on start.
- **The `/boutique.css` cache bug:** browsers that loaded the storefront may hold stale page-relative files for up to a year. After the fix, those users keep the old copy until it expires or they clear their cache. Only a new URL helps them.

### What should be done in the future

- Confirm the Workshop dropdown cause once the token works (`GET /api/projects`).
- The guide (Step 2).

### Code review instructions

- Re-run `python3 -I ttmp/2026/10/30/SLOP-012--…/scripts/01-measure-site.py` and compare with the baseline above.

### Technical details

| URL | Names | Header today | Correct? |
|---|---|---|---|
| site page HTML `/` | a place | `no-store` | too strict: no 304 possible |
| `/_d/<a>/<n>/<f>` | content | `private, max-age=31536000, immutable` | yes (but `private` blocks shared caches) |
| `/_d/<a>/main/<f>` | a place | `no-cache` | correct but costly: a revalidation per image per visit |
| `/<file>` page-relative on a site | a place | `private, max-age=31536000, immutable` | **no**: stale for a year after a new version |
| `/_v/<a>/<n>/<f>` | content | immutable | yes |
| sandbox `/v/<n>/<f>` | content | immutable | yes |
| `/_blob/<id>` (runtime asset) | an id that can be deleted | `private, no-cache` | yes |

## Step 2: The intern guide, built on one rule per concern

This step wrote the design and implementation guide. The user asked for "consistent, elegant, simple, expressive", so I organised the design as four rules, each decided in one place:

1. **Cache class by what the URL names.** Content, Place and Document, set in one `serveFile` plus `writePage`.
2. **`?w=` on any image URL.** Variants in a derived store beside the blobs.
3. **gzip for text.** Explicit in handlers, never a mux-wide middleware.
4. **Data bindings as content-addressed scripts.** `/_r/<artifact>/<n>.js` keeps `slop.data.<name>.all` synchronous.

The storefront changes then shrink to `slop.image` and `slop.srcset` and one manifest key (`files`). In the same step the GitOps PR was merged and the new build rolled out. The cluster now runs `sha-2ac2611`.

### Prompt Context

**User prompt (verbatim):** see Step 1 (the SLOP-012 request).

**Assistant interpretation:** Design only. Every rule should apply on every host and URL that serves bytes, not only to the storefront.

**Inferred user intent:** A small number of general mechanisms that make every site page fast, which the storefront then uses with minimal page changes.

**Commit (docs):** see the changelog entry for this step.

### What I did

- **Read** the rest of the serving path:
  - `serveSlopAsset` and `writePage` (`serve.go:196-218`);
  - `records.IsText` / `Parse` (`pkg/records/records.go:72-90`);
  - `Blobs.PutReader`, `Stat`, `Missing`, `Collect` (`pkg/blobs/blobs.go:80-190`);
  - every `Cache-Control` and `ServeContent` call in `pkg/server`;
  - `serveAsset` (`rt_more.go:392-413`);
  - `gc-blobs` (`cmd/slop/cmds/db.go:138-146`);
  - the event constants (`pkg/store/events.go:25-41`);
  - Workshop `DataShot` (`ArtifactsScreen.tsx:86-94`).
- **Checked usage:**
  - which pages read `.all`: `grep` found only Pinup's `96-slop-app.js:268`;
  - `golang.org/x/sync` is in `go.mod` (for `singleflight`); `golang.org/x/image` is not.
- **Wrote the guide**: `design-doc/01-intern-guide-serving-site-pages-fast.md`, 673 lines. It has:
  - orientation (hosts, versions vs `main`, bindings, records, rendering, a table of every URL that serves bytes);
  - the measurements explained;
  - principles;
  - the four rules with Go/JS pseudocode;
  - the storefront after the change, with a weight table and a request-flow diagram;
  - the Workshop grouping fix;
  - API and file reference, phases, tests, risks, open questions and a glossary.
- **Fixed one reference after writing:** the event constants are `EvRouteSet`, `EvRouteRemoved`, `EvVersionCreated` and `EvRefMoved` in `pkg/store/events.go`, not in `routes.go`.
- **Tasks:** phases 1–5 and an open-questions task. **Index:** filled. **Related files:** `serve.go`, `kernel.go`, `runtime.js`.
- **Deploy follow-up:**
  - `gh pr view 401`: `MERGED 2026-10-30T19:26:33Z`.
  - `/healthz` 200 and `/readyz` `{"status":"ready"}`.
  - `/_slop/claude.js` is now served (63,716 bytes), so the SLOP-009 build is live.
  - Re-measured: same weights, 11.56 s for the HTML this time.
- **Token:** the second device login failed with `http_503: no available server` during the rollout. A third login (`LNTS-MNVX`) is waiting for approval.

### Why

- **Classes, not file types.** The bug (page-relative CSS cached immutable) came from treating "a file from a version" as content although the URL does not name the version. Deciding by what the URL names fixes the bug and every future case.
- **Synchronous data scripts instead of `fetch`.** They keep `.all` synchronous for Pinup apps, are cached by the browser at a content URL, and are shared between the storefront and every `/apps/<id>` page.
- **JPEG/PNG thumbnails, not WebP.** The standard library encodes them, and at thumbnail sizes JPEG is small. A WebP encoder would need cgo or WebAssembly.
- **Explicit gzip.** SSE streams must not be buffered and media byte ranges must not be compressed; a middleware would have to special-case both.
- **Derived files outside `blobs/`.** `Blobs.Collect` deletes unreferenced files under `blobs/`.

### What worked

- Every claim in the guide's current-state sections was checked against the code or measured on the cluster.
- The rollout of `sha-2ac2611` succeeded: health and readiness are good.

### What didn't work

- `slop auth login` (second attempt) exited with `http_503: no available server`, while the pod was being replaced after PR #401 merged. Restarted the login.

### What I learned

- **The new build changes nothing on the storefront's path.** Same weights, as expected: SLOP-009 did not touch site serving.
- **The page's own time varies widely on this link** (1.7 s to 11.6 s for the same 670 KB). The design should cut bytes, not tune the server.

### What was tricky to build

- **Keeping `.all` synchronous while moving data out of the HTML.** The order is boot JSON, then `runtime.js` (defines `slop.records` and `all` as a getter), then the `/_r/` scripts (fill the registry), then the page's scripts. That order is guaranteed only for synchronous scripts in `<head>`, which is where `Inject` already writes.

### What warrants a second pair of eyes

- **The Place freshness value** (60 s with a one-day `stale-while-revalidate`). It trades how quickly an edit shows up against revalidation traffic.
- **`public` on the site host.** Correct for public pages. SLOP-011 (live sites) would need `private` for per-viewer responses. The class function is the one place to change.
- **Memory for resizing** under the 512 Mi limit. Two slots plus the 50 MP guard should hold; test with `GOMEMLIMIT`.

### What should be done in the future

- Confirm the Workshop dropdown cause on the cluster once the token works.
- Decide the open questions in section 14, then implement phase 1.

### Code review instructions

- Read the guide's section 2.5 table against `grep -n "Cache-Control" pkg/server/*.go`.
- Validate: `docmgr doctor --ticket SLOP-012 --stale-after 30`.

### Technical details

- Expected weights after all phases (guide section 9):
  - HTML about 1.5 KB gzipped;
  - catalog script about 70 KB gzipped, cached;
  - about 40 KB per visible cover;
  - all covers about 3.5 MB instead of 76 MB.

## Step 3: Open questions decided; the cluster token and the dropdown data

The user left the open questions to me. I recorded the decisions in the guide (new section 14.1) and added the importer change as a task. In the same step the device login finally completed. With a working token I checked the data behind the Workshop dropdown: the cluster's projects and artifacts are consistent. The remaining question is whether the menu still hides the francois group on the new build.

### Prompt Context

**User prompt (verbatim):** "then create a new ticket and Create  a detailed analysis / design / implementation guide … You chose the best cases. Also, when I logged in with the link, i first opened in the wrong browser, then took it to another browser, and it redirected with \"flow_missing\" but that then didn't show an error or even a warning, i just happened to catch it from the corner of myh eye. Before implementing, let's tackle that token thing. Also, I merged the  deploy PR" (the full prompt is recorded in SLOP-013's diary, Step 1).

**Mid-step prompt (verbatim):** "I approved the last token again I think maybe it was just the link that I copy pasted wrong from the first browser"

**Assistant interpretation:** Decide SLOP-012's open questions. The sign-in problem becomes its own ticket (SLOP-013).

**Inferred user intent:** Unblock SLOP-012's implementation with decisions, and fix sign-in first.

**Commit (docs):** see the changelog.

### What I did

- **Guide section 14.1:**
  - ladder 160–1920 kept;
  - Place freshness 60 s with one-day SWR;
  - no WebP output;
  - the importer writes numbered `/_d/<media>/<n>/` URLs (media pushed first, then the catalog rewritten).
- **Tasks:** checked the open-questions task; added the importer task.
- **Token:** the third device login (`LNTS-MNVX`) completed. `slop auth status` shows `tok_64be4cf3dac0527e2d93ff9a`, admin, read/write/admin, expiring 2026-11-06.
- **Dropdown data:**
  - `slop projects list` → one project `francois` ("francois import").
  - `slop artifacts list --format json` → 114 artifacts: 111 with project `francois`, 3 without.
  - `GET /api/artifacts` returns `project` as `'francois'` or `null`. This matches what `ArtifactMenu` expects.

### Why

- **Each decision picks the option that adds no mechanism:**
  - the ladder already bounds disk;
  - 60 s keeps edits visible;
  - JPEG and PNG need no dependency;
  - numbered URLs make covers Content, so no special case is needed.

### What worked

- The token works.
- The projects and artifacts data are consistent.

### What didn't work

- Nothing new in this step.

### What I learned

- **The dropdown's data is fine on the new build.** So the "only No project" view was either the old build or the client: a failed or loading projects query, or the menu's scroll position.
- **The grouping fix in phase 1 is still right.** It makes the menu independent of the projects query.

### What was tricky to build

- N/A (decisions and checks only).

### What warrants a second pair of eyes

- **The importer change rewrites URLs inside records.** It must leave non-media URLs and external links untouched.

### What should be done in the future

- Ask the user to re-check the dropdown on `sha-2ac2611`.

### Code review instructions

- Guide section 14.1; `docmgr task list --ticket SLOP-012`.

### Technical details

- Token: `tok_64be4cf3dac0527e2d93ff9a`, 7 days, created by `slop auth login --server https://slop.yolo.scapegoat.dev --days 7 --name "claude-code slop-012" --no-browser`.

## Step 4: Phases 1 and 2: cache classes, gzip, and thumbnails

This step implemented the first two phases on the branch `task/fast-sites-and-sign-in` (from `origin/main`).
- **Phase 1** routes every stored file through one `serveFile` with two URL classes, which fixes the page-relative cache bug. Pages get an ETag and `no-cache` instead of `no-store`, text is gzipped, runtime assets are named by a content hash, and the Workshop groups artifacts by the projects they name.
- **Phase 2** adds `?w=` thumbnails on every image URL, image sizes in records, and `slop.image`/`slop.srcset`.

### Prompt Context

**User prompt (verbatim):** "Ok, do SLOP-12 and SLOP-13"

**Assistant interpretation:** Implement SLOP-012's phases after SLOP-013, with tests at each phase.

**Inferred user intent:** A fast storefront and a sound caching model, ready to deploy.

**Commit (code):**
- 3e3aacb — "SLOP-012 phase 1: cache classes by what a URL names, document ETags, gzip"
- b050095 — "SLOP-012 phase 2: ?w= thumbnails on any image URL, image sizes in records"

### What I did

- **`pkg/server/files.go` (new):**
  - `urlClass` (`contentURL`, `placeURL`), `classOfVersion(n)` (0 = main = place), `cacheControl(r, c)` (public on site hosts, private elsewhere), `isSiteHost`;
  - `serveFile(w, r, f, class)`;
  - `variant`, which picks a thumbnail, then a gzipped copy, then the stored file;
  - `derive(name, build)` with `s.derived` (singleflight), `gzipBlob`, `compressible`, `acceptsGzip`, `writeBody` (pooled in-memory gzip) and `etagMatch`.
- **`pkg/blobs/derived.go` (new):** `Derived(name)`, `PutDerived(name, write)` (temp file and rename), `CollectDerived(kept, dryRun)`. Names must match `^[0-9a-f]{64}(\.[a-z0-9]+)+$`, stored under `derived/<sha[:2]>/`.
- **Callers moved to `serveFile`:**
  - `getFile` (API) → content;
  - `serveData`: number → content, `main` → place;
  - `/_v/` → class by version;
  - page-relative files on a site → place, plus `Vary: Referer` for the referer-resolved branch;
  - sandbox `/v/<n>/<file>` → class by version.
  - `serveBlob` is deleted.
- **`writePage(w, r, status, body)`:** ETag = first 32 hex characters of sha256(body), `no-cache`, 304 on a match, `writeBody` gzip.
- **`render.AssetHash`/`AssetURL`:** 12-character sha256 of each embedded asset, computed once. `Inject` writes `/_slop/<name>?h=<hash>`. `serveSlopAsset` treats a matching `h` as content and anything else as place, and adds an ETag, 304 and gzip.
- **`gc-blobs`:** `CollectDerived` with `kept` = still stored and not removed in this run, so a dry run lists derived files correctly too.
- **Workshop:** `web/workshop/src/app/groups.ts` `projectGroups(arts, projects)` builds the groups from the artifacts' own projects, with "No project" last. `ArtifactMenu` (`TopBar.tsx`) and `ArtifactsScreen` use it.
- **`pkg/server/thumbs.go` (new):**
  - ladder `160…1920`, `snapWidth`, `thumbable` (jpeg, png, webp);
  - `thumb(f, width)` looks for `<sha>.w<W>.jpg|png|same` and otherwise builds once under `s.thumbSlots` (2);
  - `makeThumb`: `DecodeConfig` → original if not wider or over 50 MP; `draw.CatmullRom` into NRGBA; JPEG q80 if `Opaque()`, else PNG (best compression); a `.same` marker if not smaller;
  - `imageSize` for records (also GIF).
  - WebP decoding via `golang.org/x/image/webp`; dependency `golang.org/x/image v0.47.0` (`go get` also raised `x/sys` to v0.49.0).
- **`serveAsset` (`/_blob/<id>`)** uses `variant` (so `?w=` and gzip), keeping `private, no-cache`.
- **`records()`** adds `width`/`height` to image file records.
- **`runtime.js`:** `slop.image(src, w)` and `slop.srcset(src, widths)`. Checked in node with `vm`: `/_d/a/1/x.webp?w=480` and `/a.jpg?v=2&w=320 320w, /a.jpg?v=2&w=640 640w`.
- **Tests:**
  - `TestCacheClassesAndCompression` (`pkg/server/files_test.go`):
    - page ETag, 304 and gzip, and the page naming the hashed runtime;
    - page-relative CSS is place with `Vary: Referer`, and new bytes appear after a push (the bug's regression test);
    - `/_v/` is content and gzipped, a range request is not gzipped, hashed vs bare `/_slop/`, API files private.
  - `TestThumbnails`:
    - 800×500 → `?w=480` is a 480×300 JPEG, immutable, ETag `.w480`, kept in `derived/`;
    - `?w=500` → 640; transparent → PNG; 100 px → the original bytes;
    - `main` → place; `?w=` on text ignored; records carry sizes.
  - `TestDerived` (`pkg/blobs`): `Collect` ignores `derived/`, an invalid name is refused, `CollectDerived` keeps live blobs' files.
  - `TestDataFiles` updated for the new `main` header.

### Why

- **One function writes stored bytes,** so the class rule cannot drift between handlers again (the bug came from one handler choosing its own header).
- **`Vary: Referer` only on the referer branch.** There the same URL means different files for different pages. A shared cache must not mix them, but the rest of the site keeps its hit rate.
- **The `.same` marker.** "The original is better" is remembered without storing a copy.

### What worked

- `GOWORK=off go test ./... -count=1`: all ok after each phase.
- `make lint`: `0 issues` after each phase.
- `npx tsc --noEmit -p .` in `web/workshop`: clean.

### What didn't work

- `TestDataFiles` failed after phase 1: `import_test.go:35: data file at main 200 map[… Cache-Control:[public, max-age=60, stale-while-revalidate=86400] …]`. The test encoded the old `no-cache`; updated to the new class.
- `make lint`: `pkg/server/kernel.go:240:1: File is not properly formatted (gofmt)` after deleting `serveBlob`. Fixed with `gofmt -w`.
- `go test ./pkg/blobs/`: `pkg/blobs/blobs_test.go:59:45: undefined: io`. Added the import.
- `npx tsc`: `src/screens/ArtifactsScreen.tsx(25,12): error TS2304: Cannot find name 'projectGroups'`. My scripted import insertion matched the wrong line; fixed. The group heading now uses `g.name`.
- **`TestThumbnails` first run:** the "thumbnail" was the original PNG (`Content-Type:[image/png] … Content-Length:[5576]`, 800×500). My test image was a smooth gradient, which PNG compresses to 5.5 KB, so the JPEG copy was larger and the server rightly served the original. The test now uses deterministic noise, like a photo.

### What I learned

- **"Never serve a larger copy" matters in practice.** Flat graphics and screenshots compress better as the original PNG than as any JPEG thumbnail.
- **`http.ServeContent` handles `If-None-Match` and ranges for variants as well.** The derived file is just another `*os.File`.

### What was tricky to build

- **Gzip and ranges.** A range over gzipped bytes is meaningless to a browser expecting the identity encoding. `variant` uses the gzipped copy only when there is no `Range` header, and the test checks that a range request gets plain bytes (206, `body`).
- **Dry-run accuracy for `gc-blobs`.** In a dry run, `Collect` does not delete, so `CollectDerived` would see the source blobs still present. The command passes `kept = stored && !removed-in-this-run`.

### What warrants a second pair of eyes

- **`cacheControl` decides `public` by host.** A per-viewer response on a site host (SLOP-011) would need `private`.
- **Decoding cost and memory** under the pod's 512 Mi limit (two slots, 50 MP). Not load-tested.
- **`imageSize` opens every image** of a data version once per `artifact@n` when records are built. For the francois media (692 images) that is 692 header reads on first render after a push.

### What should be done in the future

- Phase 3 (data scripts, `files` key), phase 4 (storefront v2, importer, docs), deploy and measure.

### Code review instructions

- `pkg/server/files.go`, `pkg/server/thumbs.go`, `pkg/blobs/derived.go`; the callers via `git show 3e3aacb -- pkg/server/serve.go`.
- `go test ./pkg/server/ -run 'TestCacheClasses|TestThumbnails'` and `go test ./pkg/blobs/`.

### Technical details

| URL | Class | Site host header |
|---|---|---|
| `/_d/<a>/<n>/…`, `/_v/<a>/<n>/…`, `/v/<n>/…`, `/_slop/x.js?h=<hash>` | content | `public, max-age=31536000, immutable` |
| `/_d/<a>/main/…`, page-relative files, `/_slop/x.js` without the hash | place | `public, max-age=60, stale-while-revalidate=86400` |
| pages | document | `no-cache` + ETag |
| `/_blob/<id>` | its own | `private, no-cache` |

## Step 5: Phases 3 and 4: data scripts, pinned links, storefront v2, help; verified locally

This step finished the code:
- **Phase 3:** data bindings load as `/_r/<artifact>/<n>.js` content scripts (`.all` stays synchronous); the manifest gets a `files` key.
- **Importer decision:** seed pushes pin `/_d/<a>/main/` links to the version pushed.
- **Help:** the `site-pages` topic, plus a fix for help topics that never loaded.
- **Storefront v2:** both pages written, and tested on the local server against a copy of the cluster's catalog and one media shard. Both runtime conformance suites still pass on the new build.

### Prompt Context

**User prompt (verbatim):** see Step 4 ("Ok, do SLOP-12 and SLOP-13").

**Assistant interpretation:** Phases 3–4. The storefront push and the cluster measurement wait for the deploy, because v2 calls `slop.image`, which the deployed server does not serve yet.

**Inferred user intent:** The storefront fast on the cluster.

**Commit (code):**
- 4b5076b — "SLOP-012 phase 3: data as cacheable scripts; manifest files key"
- e3d7bd8 — "SLOP-012: seed pushes pin data links to the version pushed"
- 2004edf — "SLOP-012: help topic site-pages; help topics with ': ' in titles load again; storefront v2 sources"

### What I did

- **`pkg/render/render.go`:**
  - `Boot.Data` is `map[string]any`;
  - `DataRef` (`"<artifact>@<n>"`, `NewDataRef`, `Script()`);
  - `RecordsScript(ref, rows)` → `slop.records("<ref>",[…]);` with `<` escaped;
  - `Inject` writes one `<script src="/_r/…">` per distinct ref, sorted by binding name, right after `runtime.js`;
  - fixed the old no-op escape `ReplaceAll(raw, "<", "<")` to `<` (harmless before, because `json.Marshal` escapes `<`).
- **`pkg/server/serve.go`:**
  - `renderPage` puts refs in the boot (the site index stays inline);
  - `recordsPath` and `serveRecords` (ETag `"<ref>"`, 304, content class, gzip);
  - `serveSite` shares one `readByRoute(data)` between `/_d/` and `/_r/`;
  - the sandbox uses `sandboxReads(ctx, app, data)` for both (replaces `serveSandboxData`);
  - `pageManifest.Files`, added to `reads()`.
- **`runtime.js`:** a `store` registry, `slop.records(ref, rows)`, and `all` as an enumerable getter, so inline arrays (older boots, Pinup's preview shim) still work. Checked in node: a ref and an inline binding both resolve; `get('b')` works.
- **`pkg/seed/pin.go`:** `pinLinks`, `isText`, `linksToData`.
  - `Push` ranks data that other data links to first, and keeps `mains`.
  - `UploadDir(ctx, api, dir, pin)` rewrites text files in memory; the seed directory is unchanged.
  - `pushArtifact` records each artifact's main.
  - `extract.go` comment updated.
- **Help:**
  - `pkg/doc/topics/site-pages.md` (new);
  - `agents.md` points to it;
  - titles with `: ` quoted in `runtime.md` and `site-pages.md`;
  - `doc.Topic` strips the quotes;
  - `TestHelpTopicsLoad` loads every topic into a glazed `HelpSystem`.
- **Tests:**
  - `TestServeSiteAndSandbox`, `TestDataFiles` and `TestThumbnails` moved from inline records to `/_r/`, plus 404s for `/_r/<a>/0.js`, an unknown version, an unread artifact, and the sandbox;
  - `TestInject` checks the script order and `RecordsScript`;
  - a `files` case (no `/_r/`, files served; unread data 404);
  - `TestSeedPinsDataLinks` (catalog listed before media still gets `/_d/media/1/`, the seed dir is unchanged, media v2 → catalog v2 with `/_d/media/2/`).
- **Local server** (`slop21`, built with `go generate ./pkg/web` and `go build -tags embed`; tmux window `slop:server` recreated):
  - `s12` test page: title `ok 3 1200x750` (sync `.all`, sizes); `?w=480` gives a 480×300 JPEG of 52,792 bytes from a 2.6 MB PNG; on reload the runtime, data script and image have `transfer=0`.
  - `PW_CHROMIUM=…/chromium_headless_shell-1234/… NODE_PATH=$S/pw/node_modules node web/rt-conformance/run.mjs http://localhost:18140` → 51 ok, `all passed`; the `rt-sample` suite → 20 ok, `all passed`.
- **Storefront v2:**
  - `slop pull` of `storefront`, `storefront-entry`, `francois-catalog` (v2), `francois-media-3` and `lab-tokens` from the cluster;
  - edited the pages: `files` instead of media `reads`, `boutique.css?v=2`, `slop.image`/`slop.srcset` only for `/_d/` URLs, `fetchpriority="high"` for the first six cards; on the entry page the cover at 1280, gallery at 320/640, Markdown images at 960;
  - pushed copies (without `project`) to the local server, routes `/` and `/apps/:id`.
- **Measured locally** (script updated to follow `/_r/` and read headers case-insensitively):
  ```text
  page http://site.localhost:18140/: 200, 3164 bytes on the wire, 7099 raw, 3131 if gzipped, 0.02s
    cache-control: no-cache  content-encoding: gzip  etag: "d616e7b05f6179d3adce2053c77ad3f1"
    revalidation: 304
    boot block: 514 bytes
      data.catalog: 104 records from /_r/francois-catalog/1.js, 99819 bytes on the wire (gzip), cache-control=public, max-age=31536000, immutable
    covers: 94
    first cover …/med_fc427b42fb1d4fdb36e63b71.webp: 200 285314 bytes image/webp …
    first cover …/med_fc427b42fb1d4fdb36e63b71.webp?w=640: 200 30057 bytes image/jpeg …
  ```
- **v2 sources** stored in `various/storefront-v2/{storefront,storefront-entry}/`.

### Why

- **Pin at push time, not in the importer's extract step.** The version numbers are only known when pushing. Doing it in `seed.Push` makes it work for any seed (the dev seed too), and keeps the extracted directory reproducible.
- **`files` instead of serving any data a page's records link to.** Gating stays a declaration in the manifest, readable without parsing records.

### What worked

- All tests (`GOWORK=off go test ./...`), `make lint` (`0 issues`), both conformance suites, and the browser checks above.
- **Mutation check for the help test:** removing the quotes from `runtime.md`'s title fails `TestHelpTopicsLoad` with `topic runtime does not load: section not found`.

### What didn't work

- **After phase 3, three tests failed as expected:**
  - `TestDataFiles`: `import_test.go:28: gallery 200 … "data":{"media":"media@1"} … <script src="/_r/media/1.js">`;
  - `TestServeSiteAndSandbox`: `serve_test.go:63: site page 200 …`;
  - `TestThumbnails`: `files_test.go:188: records lack sizes`;
  - and `pkg/render/render_test.go:11:40: cannot use map[string][]records.Record{…} … as map[string]any value`.

  All assumed inline records; updated to `/_r/`.
- **`serve_test.go:74: /_r/lab-tokens/1.js: 200`.** I expected a 404, but `lab-tokens` is read (`$tokens`), so its records are as public as its `/_d/` files. My expectation was wrong; the test now uses an unread artifact.
- **Conformance run, first try:** `Error: Cannot find module 'playwright'` (wrong `NODE_PATH`). Then `browserType.launch: Executable doesn't exist at …/chromium_headless_shell-1248/…`. Fixed with `NODE_PATH=$S/pw/node_modules` (found in this session's transcript) and `PW_CHROMIUM` pointing at the installed `chromium_headless_shell-1234`.
- **Measurement script on the new shape:** `AttributeError: 'str' object has no attribute 'get'` (data refs), and `etag: None` (I copied headers into a `dict`, which is case-sensitive). Rewritten.
- **Storefront v2 locally:** covers whose media shard was not copied showed their alt text instead of the monogram. With `fetchpriority` (eager) images, some fail before the page attaches its `error` listener. The page now also applies the fallback to images that are already `complete` with `naturalWidth` 0. Result: 12 failed covers replaced, 18 monograms shown.
- **`slop help site-pages` → `Unknown help topic`; so did `slop help runtime`.** `slop help --list` showed only `agents` and `pinup`: the `: ` inside an unquoted `Title:` is invalid YAML, and the topic is dropped silently. Fixed and tested (above).

### What I learned

- **The storefront page is in project `francois`.** I had told the user it was in "No project" (Step 1 of this ticket's conversation); the pulled `slop.json` says `"project": "francois"`.
- **The catalog script is 99.8 KB gzipped** (the guide estimated about 70 KB). It is downloaded once and shared by `/` and every `/apps/<id>`.

### What was tricky to build

- **Pinning without changing the seed directory,** while keeping `UploadDir`'s missing-blob upload. Rewritten files are hashed and uploaded from memory (`pinned` map); unchanged files keep the streaming path.
- **Order among data artifacts.** A one-level rank (data that links to other data goes after data that does not) is enough for the importer: media shards have no links, and catalog and journal link to them.

### What warrants a second pair of eyes

- **`linksToData` reads every text file of every version** of each data artifact once per push (the francois catalog: 104 files). Fine at this size.
- **Pinning rewrites links in page versions too** (pushed after data). Already imported releases are skipped by their key, so only new releases are affected.

### What should be done in the future

- Merge and deploy, then push `various/storefront-v2/*` to the cluster, re-run `slop import francois push` (pins the catalog's media links), and measure with `scripts/01-measure-site.py`.

### Code review instructions

- `git show 4b5076b e3d7bd8 2004edf`.
- `go test ./pkg/server/ -run 'TestServeSiteAndSandbox|TestDataFiles|TestThumbnails|TestSeedPins|TestHelp'` and `go test ./pkg/render/`.

### Technical details

- Inject order: boot JSON, `runtime.js?h=`, `/_r/` scripts (sorted by binding name, deduplicated), `claude.js?h=` (apps), `bridge.js?h=` (previews), then the page's own head.

## Step 6: The records table shows what records have; projects have no Workshop UI

The user opened `francois-media-3` in the Workshop (Watch → Records) and saw an
empty table. The table was built for two shapes only: posts (title, date, tags)
and the "experiments" sample (no, title, kind, date). A data artifact of image
files has none of those fields, so its 28 rows rendered as blank cells. The
fix derives the columns from the records themselves. Image files get a
thumbnail through the `?w=` scaling this ticket added, plus their name and
size. When no viewer page is set, a selected image shows large on the right.

The same message asked how projects are created. Nothing in the Workshop
creates a project or moves an artifact into one. The CLI and the API can, so I
checked those paths against the code, and I will offer the Workshop UI as
follow-up work rather than build it unasked.

### Prompt Context
**User prompt (verbatim):** "I wouldn't even know how to create projects? Also, when looking at data the records table doesn't show anything: http://localhost:18140/watch/francois-media-3"
**Follow-up while working (verbatim):** "don't forget the diary, and the diary format! (MANDATORY) commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Make the records table useful for any data shape, starting with file-only media; explain how projects are made today.
**Inferred user intent:** The Workshop should show what is in a data artifact without the user knowing its schema. Projects should be something a person can find and use, not only an agent.
**Commit (code):** addd400 — "SLOP-012: the records table shows what records have; image files get thumbnails"

### What I did
- Changed `web/workshop/src/components/organisms/DataPanes.tsx`:
  - The fixed `cols` array is now `columns(a, recs)`, which returns `Column{key, label, main?, cell(r, a, v)}`.
  - **Posts:** title, date and tags, as before.
  - **Mostly files** (`file` records > half): a thumbnail (`fileURL(a, v, r, 160)`), the base name (`.brk`, breaks anywhere), and `W×H · KB` (`.nowrap`). Non-file rows show only their name.
  - **Other records:**
    - The first column is the name: `title`, else `id`.
    - Up to three more fields: values of 40 characters or fewer, no booleans, nothing in `hidden`.
    - Order: familiar keys first (`known`: no, kind, date, tags, type, status, visibility), then by how many records have the field.
  - `text(x)` joins arrays and cuts ISO timestamps to their date.
  - `fileURL` builds `/api/artifacts/<id>/versions/<n>/files/<path>?w=`, with path segments URL-encoded.
  - New `ImagePreview` replaces `ViewerPreview` in the right pane when `!a.viewer` and the selected record is a JPEG, PNG, WebP or GIF file. It shows `?w=960`, links to the original, and names the `src` that pages use.
- Changed `web/workshop/src/styles/workshop.css`: added `.rt .nowrap`, `.rt .brk`, `.rt td .rthumb` (48×36, cover) and `.imgstage`.
- Checked:
  - `npx tsc --noEmit -p .`;
  - `go generate ./pkg/web`;
  - `go build -tags embed -o $S/slop21 ./cmd/slop`;
  - a restart of tmux `slop:server`;
  - Playwright checks on `francois-media-3`, `francois-catalog`, `s12-data` and `ws-team`.
- For projects, read:
  - `slop projects --help` and `slop projects put --help` (flags `--name`, `--brief`);
  - `cmd/slop/cmds/push.go:47` ("Project, when the push creates the artifact");
  - `pkg/server/kernel.go:34`: `PATCH /api/artifacts/{id}`, admin only, with `{"project": "<id>"|null}`;
  - `web/workshop/src/api/slopApi.ts`: its only PATCH is `users/{id}`.

### Why
- The data decides the columns. A per-type list would go stale with every import (francois catalog, media, creators). Picking short, common fields generalises without a schema.
- The thumbnails use the main-host API URL, not the record's `src`:
  - `src` is `/_d/<a>/<n>/…`, which only site hosts serve, and only for routed readers.
  - The API URL works with the Workshop session and already supports `?w=`, because `serveFile` applies `variant` to every image URL.
- Files win when they are the majority, not only when every record is a file. `francois-media-3` holds 27 images and an `index.json` that maps media ids to alt texts, so an "every record" rule never applied.
- The image preview replaces "No viewer page is set". For a media collection, the image itself is the record's view.

### What worked
- `francois-media-3`:
  - Columns: `["", "File", "Size"]`.
  - Row 2: `med_f4f9f619b57aa8d740e38020.webp`, `2400×1500 · 779.0 KB`.
  - Thumbnail requests `…/files/files/med_….webp?w=160` returned `naturalWidth` 160.
  - The preview requested `?w=960` and returned `naturalWidth` 960.
- `francois-catalog`: columns `Title, Visibility, Tags, createdAt`; a row reads `asd | hidden | | 2026-10-19`.
- `s12-data` (mixed): `Title, Type`. `ws-team`: `Title`.
- Horizontal overflow of `.dlist .scroll` is 0 for all three after the fixes.

### What didn't work
- **"Every record is a file" rule.** The first version used `recs.every(r => r.file === true)`. `francois-media-3` still showed a `Title | Type` table, because `index` is a JSON record:
  `{"n":28,"files":27,"index":"{\"id\":\"index\",\"med_f4f9…\":{\"alt\":…`.
  Fixed with the majority rule.
- **Long names.** Full paths (`files/med_<24 hex>.webp`) wrapped the size column and scrolled the table sideways. The `index.json` row showed `0.0 KB`. Fixed with base names that break anywhere, a size on one line, and no size for non-file rows.
- **Catalog picks.** The first generic picks for the catalog were `Tags, createdAt, demoEnabled`, which showed `2026-10-23T23:28:14.805764Z` and `false` (overflow 12 px). Fixed: booleans are skipped, timestamps show their date, and `visibility` is a familiar key.
- **Server restart.** The first restart left no server: `curl` gave `000` and `tmux capture-pane -t slop:server` said `can't find window: server`. `C-c` ended the `exec`'d script, which closed the window, so the `send-keys` of the restart command went nowhere. I now restart with `tmux kill-window -t slop:server; tmux new-window -d -t slop -n server "$S/rt1/run-tmux.sh"`.
- **Early screenshot.** One screenshot showed "0 records" because it was taken before the query resolved. Later checks wait for `img.rthumb`.

### What I learned
- Data artifacts from the francois import mix shapes: the media folders carry an `index.json` beside the images. Any "all records are X" rule will miss them.
- Projects:
  - **Create** with `slop projects put <id> --name "…" [--brief "…"]`.
  - **Join at creation:** the first push with `--project` (or `"project"` in `slop.json`), or the project select in the Workshop's new-artifact flow.
  - **Move an existing artifact:** only `PATCH /api/artifacts/<id> {"project": "<id>"}` with an admin token. There is no CLI command and no Workshop control for it.

### What was tricky to build
- **Which URL to load from.** A record's `src` is a site-host URL. Inside the Workshop (main host) it 404s, because `/_d/` is not mounted there and the data may not be routed. The cell builds an API URL from `path` instead, and splits on `/` before encoding so the slashes stay.
- **Choosing columns without a schema.** "Familiar first, then most common" is enough only together with the length cap (≤40), dropping booleans and the `hidden` set. Without them, long descriptions and flags crowd out the useful fields.

### What warrants a second pair of eyes
- **Thumbnail load.** Each data artifact opened in the Workshop now decodes up to N thumbnails on first view (2 decode slots; derived files are kept afterwards). For an artifact with hundreds of large images, the first open is slow, though `loading="lazy"` limits it to rows on screen.
- **The 40-character cap and ranking** are heuristics. A catalog whose useful fields are long gets only the name column.

### What should be done in the future
- Workshop project UI:
  - a "New project" control;
  - "Move to project" on an artifact, using the existing admin PATCH;
  - a project switcher in the artifact menu, so projects are reachable without the CLI.
- Optionally, a CLI `slop artifacts set <id> --project <p>` that wraps the same PATCH.
- Optionally, alt text from a sibling `index.json` as the media rows' title.

### Code review instructions
- Start at `columns`, `fileURL`, `isImage` and `ImagePreview` in `web/workshop/src/components/organisms/DataPanes.tsx`, then the four new rules at the end of `web/workshop/src/styles/workshop.css`.
- Validate:
  1. `cd web/workshop && npx tsc --noEmit -p .`
  2. Rebuild with `go generate ./pkg/web && go build -tags embed`.
  3. Open `/watch/francois-media-3` and `/watch/francois-catalog` on a local server with the imported data.

### Technical details
- Column rule: posts → `[Title, Date, Tags]`. More than half files → `[thumb, File, Size]`. Otherwise → `[Title] + top 3` of the non-hidden fields with short, non-boolean values.
- `hidden` = id, path, title, body, html, file, src, size, width, height, summary, description.
- Thumbnail URL: `/api/artifacts/francois-media-3/versions/1/files/files/med_f565d5e727a5cfbe72561bfc.jpg?w=160`. The cache class is private because this is the main host (`TestCacheClassesAndCompression`, "Off the site host, everything is private").

## Step 7: Projects in the Workshop: a scope, new projects, moving artifacts

Step 6 found that projects existed only for the CLI. `slop projects put`
created them, and only an admin `PATCH /api/artifacts/{id}` moved an existing
artifact. The Workshop showed one long list grouped by project, with no way to
switch, create or move. The user asked for it in PR #5. This step adds three
things on top of the endpoints that already exist; the server is unchanged:
- a project scope that narrows both artifact lists;
- a dialog to create or edit a project;
- a dialog to change an artifact's title, project and viewer.

I verified it in the browser on the local server:
- created "The lab" and moved `blocks` and `pinup` into it;
- switched the scope;
- edited the project's brief.

SQLite shows each change. `tsc` and the server tests pass.

### Prompt Context
**User prompt (verbatim):** "Sure, #5. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Build the offered Workshop project UI (switcher, New project, Move to project) in PR #5, with commits and a diary entry.
**Inferred user intent:** Using projects should not need the CLI. A person in the Workshop should see, choose and organise projects.
**Commit (code):** dfd2ade — "SLOP-012: projects in the Workshop: a project scope, new project, move an artifact"

### What I did
- `web/workshop/src/api/slopApi.ts`: two mutations, `putProject` (`PUT projects/{id}` `{name, brief}`) and `updateArtifact` (`PATCH artifacts/{id}` `{title?, project?: string|null, viewer?}`). Like the existing mutations they invalidate nothing; `api/events.ts` already maps `project.updated` and `artifact.updated` to invalidations.
- `web/workshop/src/app/ui.ts`: `UIState.project: string | null` (null means all, `''` means no project), read from `localStorage['slop:workshop:project']` at start and written by `projectPicked`.
- New `web/workshop/src/components/organisms/Projects.tsx`:
  - `useProjectScope()` and `inScope(a, scope)`;
  - `ProjectPicker` (a select: "All projects · N", each project with its count, "No project · N");
  - `ProjectDialog` (create, or edit name and brief; the id follows the name until edited and is fixed once the project exists; shows the equivalent `slop projects put` command);
  - `ArtifactDialog` (title, project with "A new project…", and viewer for data; sends only the fields that changed).
- `web/workshop/src/components/organisms/TopBar.tsx`: `ArtifactMenu` gets a "Project" picker row and filters by scope. It shows "Nothing in this project yet. Show all projects" when empty, and gains two actions, "Title and project of <current>…" and "New project…". TopBar renders the dialogs, so they outlive the menu.
- `web/workshop/src/screens/ArtifactsScreen.tsx`:
  - toolbar: `ProjectPicker` and "New project…";
  - group headers: "Edit project" for real projects;
  - each card: wrapped in `.acell` with a "Move…" button beside it, visible on hover, on focus and always on touch;
  - an empty state with "Show all projects";
  - `PushDialog` and `NewTargetDialog` default their Project select to the scope.
- `web/workshop/src/styles/workshop.css`: `.menu .mhead`, `.menu .mhead + .grp`, `.menu .grp:empty`, `.menu .mnote .link`, `.grp-h .link`, `.acell`, `.acell > .amove`.

### Why
- **A scope, not a separate screen.** The two places that list artifacts (menu, Artifacts screen) share one choice, so switching project in one switches the other. It is kept per browser (`localStorage`), like other Workshop conveniences. "All projects" is the first option and every empty state links back, so a scope cannot hide work unnoticed.
- **"Move…" is a sibling of the card button.** `.acard` is a `<button>`, and a button inside a button is invalid HTML; the card stays one big click target.
- **The viewer is in the same dialog.** Step 6's image preview tells people to "set a viewer page", and nothing in the Workshop could. It is the same PATCH, so one dialog for an artifact's metadata stays simple.
- **No server change.** `PUT /api/projects/{id}` validates the id (`ValidArtifactID`) and the name; `PATCH` validates the project through the FK. Both already publish events.

### What worked
- Artifacts screen before: options `["All projects · 21", "Demo project · 7", "No project · 14"]`, groups `Demo project, No project`.
- New project "The lab": the id field derived `the-lab`. After Create, the scope was `the-lab` and the empty state read "No artifacts in The lab yet. Show all projects".
- Move… on `blocks` and `pinup`, choosing The lab:
  - toasts "blocks moved to The lab." and "pinup moved to The lab.";
  - groups became `Demo project (7)`, `The lab (2) · Experiments with Blocks and Pinup.`, `No project (12)`;
  - the scoped list showed `["blocks", "pinup"]`;
  - the artifact menu followed the scope: items `blocks, pinup`, plus the two actions.
- Edit project: the name was prefilled and `#projId` disabled. A changed brief showed in the header after the `project.updated` event.
- The `s12-data` dialog showed Title, Project and Viewer (11 options: None plus 10 pages).
- SQLite: `the-lab|The lab|Experiments with Blocks and Pinup. Ask before routing.`, `blocks|the-lab`, `pinup|the-lab`.
- `npx tsc --noEmit -p .` was clean, and `GOWORK=off go test ./pkg/web/... ./pkg/server/...` reported `ok`.

### What didn't work
- No failures in this step's code.
- The browser console showed errors during the checks; I attribute both to the card previews, not to this change:
  - 404s for `/_d/francois-media/main/files/…png?w=4…` and `/_d/francois-media-2/main/…`. The local server holds only `francois-media-3`, but the storefront preview asks for the other shards.
  - `TypeError: Cannot assign to read only property 'claude' of object '#<Window>'` at `_slop/claude.js:1695/1698`, inside sandbox iframes of page thumbnails.
- One audit query failed with `Error: in prepare, no such column: target`. I had guessed a column name; not needed.

### What I learned
- The "No agent listens on <project>" line under Comments follows the artifact's project. Moving `blocks` changes which `slop comments wait -p` hears its comments, which is why the dialog says the project decides "whose agents hear its comments".
- The Workshop has no browser tests of its own (`package.json` has only `tsc`). `web/rt-conformance` covers the page runtime, not Workshop screens.

### What was tricky to build
- **Sentinels in one select.** `null` (all) and `''` (no project) share a `<select>` with project ids. "All" uses `*`, and "a new project" in the artifact dialog uses `*new`. Neither can be a project id (`ValidArtifactID` allows lowercase letters, digits and `-`), so they cannot collide, while an id like `all` stays valid.
- **Dialogs owned by the menu.** The menu closes on any document click, so a dialog rendered inside it would unmount at once. `ArtifactMenu` reports `onDialog('artifact'|'project')`, and `TopBar` owns the dialog state.
- **Scope after a nested create.** Creating a project from inside the artifact dialog must not switch the scope, which would hide the artifact being edited. `ProjectDialog` switches the scope only when no `onSaved` callback is given.

### What warrants a second pair of eyes
- **A remembered scope can hide artifacts.** The scope persists across visits, so someone may come back to a narrowed list. The picker is always visible with counts, and the empty states offer "Show all projects". Is that enough, or should the scope reset per session?
- **Projects cannot be deleted** (no endpoint). A mistyped project stays; it can only be renamed.
- **`viewer` is not checked by the server.** It accepts any string; the dialog offers only existing pages.

### What should be done in the future
- The `window.claude` read-only error in thumbnail iframes deserves its own look. It predates this step, but it is noisy.
- Possibly: project delete (or archive) once projects are used.
- Possibly: `slop artifacts set <id> --project` in the CLI, with the same PATCH.
- On the local server, `blocks` and `pinup` are now in project "The lab". This is test state on the local server only.

### Code review instructions
- Start with `web/workshop/src/components/organisms/Projects.tsx`.
- Then read `ArtifactMenu` in `TopBar.tsx`, `ArtifactsScreen` (toolbar, `.acell`, empty state) in `ArtifactsScreen.tsx`, `projectPicked` in `app/ui.ts`, and the two mutations in `api/slopApi.ts`.
- Validate:
  1. `cd web/workshop && npx tsc --noEmit -p .`
  2. `go generate ./pkg/web && go build -tags embed ./cmd/slop`
  3. On a local server: Artifacts → New project…, then Move… on a card, then switch the picker and open the artifact menu.

### Technical details
- Scope state: `ui.project: string | null`, persisted as JSON under `slop:workshop:project`.
- The rule: `inScope = a => scope == null || (a.project ?? '') === scope`.
- `updateArtifact` sends only changed fields, e.g. `{"project": "the-lab"}` or `{"project": null}` for no project. The server takes `project` as `*json.RawMessage`, so an explicit `null` clears it (`pkg/server/kernel.go`, `patchArtifact`).

## Step 8: Code review: previews read their own version's data; thumbnails keep EXIF orientation

The Codex review of PR #5 (commit 657ec23) left two P2 findings, and both
hold.

1. **Older previews lost their records.** Phase 3 moved records out of the
   page into `/_r/<artifact>/<n>.js` scripts. On a sandbox origin those
   scripts were authorized by `sandboxReads`, which asked only what main and
   the site routes read. A Workshop preview of an older page version whose
   data main no longer reads therefore got 404s and empty `.all`. Before,
   the records were inlined from the selected version.
2. **Sideways photos.** `?w=` thumbnails of JPEGs with an EXIF orientation
   came out sideways: Go's decoder ignores EXIF, and the re-encoded copy
   carries none.

Both are fixed with tests. The orientation fix also corrects a twin bug the
review did not name: image records reported their stored dimensions rather
than the displayed ones.

### Prompt Context
**User prompt (verbatim):** "Address code review issues: https://github.com/go-go-golems/slop-computer/pull/5"
**Assistant interpretation:** Read the review comments on PR #5, verify each, and fix the valid ones on the branch, with tests, commits and a diary entry.
**Inferred user intent:** Get PR #5 to a mergeable state with the reviewer's correctness concerns resolved.
**Commit (code):** 13dc440 — "SLOP-012 review: previews read their version's data; thumbnails keep EXIF orientation"

### What I did
- Read the review comments with `gh api repos/go-go-golems/slop-computer/pulls/5/comments`: #4428052009 at `pkg/server/serve.go:574` and #4428397971 at `pkg/server/thumbs.go:139`.
- `pkg/server/serve.go`:
  - Added `previewRoute(ctx, q url.Values) (*routing.Resolution, string)`, factored out of the preview branch of `serveSandbox` (`?host=` and `?path=` resolved like a visitor's request).
  - `sandboxReads(r, app, data)` now takes the request. It first parses the Referer. If the Referer has the same host and its path matches `appPath` (`/v/<n>/…`), it loads that version and checks `s.reads(ctx, v, route)` with the route from the Referer's query. Then it falls back to main and the routes as before.
  - Both callers (the `/_d/` and `/_r/` branches) pass `r`.
- `pkg/server/thumbs.go`:
  - `jpegOrientation(io.ReadSeeker)` walks the JPEG segments up to SOS and reads APP1.
  - `exifOrientation(seg)` reads TIFF II/MM, IFD0, tag 0x0112 of type SHORT, valid values 1–8.
  - `turns(o)` is true for 5–8.
  - `orient(*image.NRGBA, o)` maps each output pixel to its source, following the EXIF table.
  - `makeThumb` computes the displayed size, compares the ladder width with the displayed width, scales in stored orientation to the swapped target size, then calls `orient` on the small copy.
  - `imageSize` swaps width and height for a turned JPEG.
- `pkg/server/files_test.go`: added `TestPreviewReadsItsVersion`, `withOrientation` (inserts an APP1 with a big-endian IFD0 holding one orientation entry), `TestThumbnailOrientation` and `TestOrient`.
- Ran:
  - `GOWORK=off go test ./...` (all ok);
  - `make lint` (`0 issues.`);
  - a mutation check of the Referer branch.

### Why
- **Referer, not a new URL.** Putting the version into the script URL (`/v/<n>/_r/…`) would have made the rendered page depend on where it is served. The Referer already carries the full context (version, host, path) on a same-origin request, because `server.go:197` sets `Referrer-Policy: same-origin`.
- **Trusting the Referer is safe here.** It can be forged, but a forged one claims only a version the sandbox label already serves at `/v/<n>/`, with that version's data rendered in. Unguessable labels remain the boundary.
- **Scale first, then turn.** Turning a 160–1920 px copy is cheap; turning the full decoded original would cost a second full-size buffer under the decode slots.
- **No EXIF library.** Reading one tag from IFD0 is about 60 lines, and any parse failure falls back to orientation 1, the old behaviour.

### What worked
- `TestPreviewReadsItsVersion`. A page `board` v1 reads `notes`; v2 is main and reads nothing. Its v1 sandbox page contains `src="/_r/notes/1.js"`, and:

  | Request | Referer | Status |
  |---|---|---|
  | `/_r/notes/1.js` | `/v/1/` | 200 |
  | `/_d/notes/1/x.png` | `/v/1/` | 200 |
  | `/_r/notes/1.js` | none | 404 |
  | `/_r/notes/1.js` | `/v/2/` | 404 |
  | `/_r/notes/1.js` | another host | 404 |

- Mutation check: with the Referer branch disabled (`false &&`), the test failed on exactly the two 200 rows (`404, want 200`). Restoring the file brought it back to passing.
- `TestThumbnailOrientation`. A 640×320 JPEG (red left, blue right) with orientation 6 came back from `?w=160` as 160×320 JPEG, red on top and blue below. Its record says `"width":320`, `"height":640`.
- `TestOrient`: all eight orientations of a 3×2 image match a reference built only from `mirror` and `right`.

### What didn't work
- The first `TestOrient` failed for orientation 5:
  `orientation 5: (0,0)-(2,3) [0 1 2 3 12 13 14 15 4 5 6 7 …], want … [20 21 22 23 8 9 10 11 …]`.
  The output puts `src(0,1)` at `(1,0)`, which is a transpose, so `orient` was right and the reference wrong: I had composed `right³(mirror(right²(src)))`. "Mirror top-bottom, then turn right" is `right(right(right(mirror(src))))`. I fixed the reference and its comment.

### What I learned
- The `/_d/` file branch had the same gap before this PR: an older preview's images 404'd when only that version read the data. The same fix covers it.
- On a sandbox, `Version(ctx, app, 0)` is main, and `appPath` accepts `/v/0/`, so a Referer of `/v/0/` asks main as well. That is harmless.

### What was tricky to build
- **Where the orientation applies.** The ladder width is the displayed width, so the "never enlarge" check (`shownW <= width`) and the height (`shownH*width/shownW`) use displayed sizes. The scaler writes in stored orientation, so its target is the swapped pair, and only then is the copy turned. Getting any one of those three in the wrong orientation still gives a picture of the right shape, just stretched or the wrong size, so the test checks both size and colour.
- **The order of turns in the reference.** As above, the composition reads inside-out.

### What warrants a second pair of eyes
- **The Referer only names a version.** A page served with `<meta name="referrer" content="no-referrer">` loses the version context and falls back to main and the routes, as before this fix.
- **Stale derived copies.** The derived key `<sha>.w<width>` has no algorithm version, so copies made before this fix of oriented JPEGs would be served sideways until `gc-blobs` or a manual delete. No cluster has run thumbnails yet (PR #5 is not deployed). Locally, `rt1/blobs/derived` may hold such copies, though the francois media are WebP and PNG.
- **WebP and PNG.** Their EXIF orientation is not read. Browsers honour it in those formats too, but it is rare.

### What should be done in the future
- Reply on the two review threads: done after the user agreed (discussion_r4428657262, discussion_r4428657477).
- If derived formats ever change again, add a version to the derived key.

### Code review instructions
- `pkg/server/serve.go`: `previewRoute`, `sandboxReads` and the preview branch of `serveSandbox`.
- `pkg/server/thumbs.go`: `makeThumb`, `jpegOrientation`, `exifOrientation`, `orient` and `imageSize`.
- Validate:
  1. `GOWORK=off go test ./pkg/server -run 'TestPreviewReadsItsVersion|TestThumbnailOrientation|TestOrient|TestThumbnails' -count=1`
  2. `make lint`

### Technical details
- EXIF layout read: APP1 `FF E1 <len>` then `Exif\0\0`, then TIFF (`II`/`MM`, 42, IFD0 offset ≥ 8), then IFD0 entries of 12 bytes (tag, type, count, value). The value is SHORT in the first 2 bytes.
- Mapping, for source W×H and output (x, y):

  | o | Name | Source pixel |
  |---|---|---|
  | 2 | mirror | (W-1-x, y) |
  | 3 | turn half way | (W-1-x, H-1-y) |
  | 4 | flip | (x, H-1-y) |
  | 5 | transpose | (y, x) |
  | 6 | turn right | (y, H-1-x) |
  | 7 | transverse | (W-1-y, H-1-x) |
  | 8 | turn left | (W-1-y, x) |
