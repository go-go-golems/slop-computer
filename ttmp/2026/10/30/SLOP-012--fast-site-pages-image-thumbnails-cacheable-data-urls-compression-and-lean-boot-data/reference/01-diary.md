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
