---
Title: Diary
Ticket: SLOP3-015
Status: active
Topics:
    - architecture
    - frontend
    - deployment
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of SLOP3-015: catalog views on slop.yolo's static host (index, table, viewer)."
LastUpdated: 2026-11-06T18:58:55.647540714-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Step 1: Study, constraints and the guide

This step turns the study of Ramon's site into a design that slop can host today, and writes the intern guide. Three facts about the platform shaped the design, and each was checked against the running server rather than assumed. Nested mounts on the static host resolve to the most specific one. The live shell refuses to be framed. And the static host serves a free app's raw HTML at `/_s/<store>/main/index.html` while refusing a paid one.

### Prompt Context
**User prompt (verbatim):** "alright do it. Create a new ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. Then implement, deploy, ccommit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Build the catalog store, the view switcher and views 1, 2 and 5 from the earlier list (index, viewer, table); write and upload a guide first; deploy to slop.yolo; keep the diary.
**Inferred user intent:** Show that slop can put several interfaces over one body of content cheaply, as Ramon's site does, using the francois catalog imported in SLOP3-013.
**Commit (code):** this entry's commit (ticket and guide).

### What I did
- **Studied html.moldandyeast.com,** saving copies of `/`, `app.js`, `llms.txt`, `/agents` and `search-index.json` in the scratchpad.
  - It is one index of 42 artifacts (`slug, title, description, tags, bytes, added, thumb, hash, listed`).
  - It has an editorial index (sort, tag filter, rows), a `?open=<slug>` modal viewer with Phone/Tablet/Desktop sizes, Info, Copy HTML and Download, ⌘K search, and views for agents (`llms.txt`, JSON, MCP, WebMCP, `/agents`).
- **slop.yolo's mounts** (`mount.ls`): the static host has `/` → `boutique`, `/examples/static-site` and `/s/:id --type site`. `boutique` holds 938 files, among them `_data/francois-catalog.json` (104 records, 96 with a `cover` whose `src` is a same-origin `/_d/…` path, which returned 200 `image/png`).
- **Framing:** `curl -D - https://apps.slop.yolo.scapegoat.dev/f/weft/` → `content-security-policy: frame-ancestors 'none'`.
- **Raw HTML:**
  - `/_s/weft/main/index.html` → 200 `text/html`, no CSP;
  - `/_s/craftkit-workbench/main/attachments/…zip` → 200 `application/zip`;
  - `/_s/polis/main/index.html` → 404 (paid, `@subscriber`);
  - `/s/weft/` → 404, because `/s/:id` requires type `site`.
- **The raw page in a browser:** Playwright opened `/_s/weft/main/index.html`. The app rendered fully (code editor, live stage, params) without slop's runtime; the only console error was a missing `favicon.ico`.
- **Code read:**
  - `pkg/doors/pages/site.go` `serveStatic` (line 68) and `serveStoreFile` (159);
  - `pkg/registry/mounts.go` `BestMount` (211; literal beats param, longer beats shorter);
  - `pkg/apps/manifest.go` `Entry` (86; `index.html` by default, so no `app.json` is needed);
  - `pkg/doors/pages/sandbox.go` `frameOrigins` (62);
  - `pkg/host/production_test.go` `TestStaticNotFoundPage`, the pattern for static tests.
- **Ticket SLOP3-015,** guide `design-doc/01-intern-guide-catalog-views-on-slop-s-static-host.md` and 9 tasks.

### Why
- **Static host rather than live host:** the views need no session, no runtime and no writes, and the static host caches and serves anonymously. All views share one origin, so they share the kit and the data without CORS.
- **One store per view:** this is the "couple of lines" property. A view is one HTML file plus `store.new`, `files.push`, `grant.set @guest view` and `mount.set`.
- **Previews in a sandboxed iframe rather than a running app:** a running app needs its shell, and the shell refuses framing on purpose. Allowing it from the static host would let pages that other people push there frame a signed-in shell. The raw-HTML preview needs no platform change, and with `sandbox="allow-scripts"` (no `allow-same-origin`) it is isolated from the catalog page.

### What worked
- Every constraint in the guide (§2.2–2.4) is backed by a command run in this step.

### What didn't work
- `curl https://site.slop.yolo.scapegoat.dev/s/weft/` → `404`. `/s/:id` is `--type site`, and release stores are type `release`. That route can't preview apps; `/_s/` can.
- Two references in the first draft of the guide were wrong: "§9.8" (the passage is §13.2, "How content becomes an app") and `site.go:157` (`serveStoreFile` is at 159). Both were corrected before committing.

### What I learned
- The static host already exposes free apps' HTML, attachments and `francois.json` under `/_s/`, consistent with the store grants SLOP3-013 set. The preview and download links reuse that; nothing new is exposed.

### What was tricky to build
- N/A (design step).

### What warrants a second pair of eyes
- Guide §2.4, the reason for not framing the live shell. If running previews are wanted, an admin-only, per-mount framing allowance needs its own threat model.

### What should be done in the future
- Thumbnails for covers; views for agents after #31 and #32 are deployed.

### Code review instructions
- Read guide §2–3 against `pkg/doors/pages/site.go` and `pkg/registry/mounts.go`.

### Technical details
```
static mounts: / → boutique · /examples/static-site → static-site · /s/:id --type site
/f/weft/ (live): frame-ancestors 'none'
/_s/weft/main/index.html: 200 text/html · /_s/polis/main/index.html: 404
```

## Step 2: Kit, views, test, deploy, and two fixes found on production

This step builds the catalog, the kit and the two views, tests the static-host serving, and deploys everything to slop.yolo. Deploying was three API calls per store, the "couple of lines" the ticket set out to demonstrate. Checking on production found two problems that the local preview had hidden: apps that use `localStorage` render blank in an opaque-origin preview, and browser caching delays a changed kit by up to 11 minutes. Both are fixed and redeployed.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Implement the guide's §4 plan and deploy it.
**Inferred user intent:** Working catalog views on slop.yolo.
**Commit (code):** `5ff4fc0` (kit, views, builder, test); this entry's commit (deploy script, the `srcdoc` preview, loading states, versioned kit URLs, evidence).

### What I did
- **`scripts/01-build-catalog.py`** reads `store.ls`, each release store's `francois.json`, and `boutique`'s `_data/francois-catalog.json`, and writes `catalog.json` and `views.json`. Output: `100 listed apps (7 for subscribers, 94 with covers), 125 tags; left out (hidden): craftkit-studio, polis, stackchan-pet-studio`. A copy is in `various/catalog-2026-11-06.json`.
- **`apps/catalog/`:**
  - `index.html` is the landing page: counts and a card per view.
  - `kit/views.css` uses system fonts and has a dark scheme.
  - `kit/views.js` defines `SlopCatalog.load`, `header` (switcher, search, `/` and ⌘K focus), `viewer` (`?open=`, pushState and popstate, Esc, Phone/Tablet/Desktop, scale-to-fit, info, Open, Download HTML, Copy link), and the helpers.
- **`apps/catalog-list/index.html`:** sort, the 14 most common tags plus "+111 more", rows with lazy covers or a monogram, and a "subscribers" mark.
- **`apps/catalog-table/index.html`:** sortable columns (title, the five capabilities, access, version, date, size, attachments), a "needs" capability filter, and rows that open the viewer.
- **`pkg/host/catalog_views_test.go` `TestCatalogViewsOnStaticHost`:** three stores on nested static mounts. Each path is served by the right store, no runtime is injected, `/catalog/list` redirects with 308 to `/catalog/list/`, and the page is 404 without `@guest view`.
- **`scripts/03-devserve.py`:** a local preview that maps the mounts to the repository directories and passes `/_d/` and `/_s/` through to the production static host (GET only).
- **`scripts/02-deploy.py`:** dry run by default. It creates the store, pushes if the tree differs, grants `@guest view` and mounts, and refuses to replace a mount that points at another store.

### Why
- **Versioned kit URLs rather than shorter cache lifetimes:** the static host's cache headers serve every site on it. Changing them would be a platform decision, and stamping the URL needs no platform change.
- **`srcdoc` with a storage shim rather than adding `allow-same-origin`:** same-origin would let any previewed app script the catalog page and read the site host's storage, which other static sites share.

### What worked
- `go test ./pkg/host -run TestCatalogViewsOnStaticHost` → `ok`. Full suite: no failures. `make lint` → `0 issues.`
- **First deploy:** each store got `store.new, files.push …, grant.set @guest view, mount.set site.slop.yolo.scapegoat.dev/catalog[/list|/table]` → snapshot 1. The next dry run printed `up to date` three times.
- **Production URLs:** `/catalog/` 200, `/catalog/list/` 200, `/catalog/table/` 200, `/catalog/data/catalog.json` 200 (87,449 B, Brotli), `/catalog/kit/views.js` 200, `/catalog/list` 308.
- **In a browser on production** (`various/screenshots/`): the landing page (01), Lattice Arena at phone size (02), Claude.Computer at desktop size (03). Mimeo, a paid app, shows its cover with the "subscribers" note (04, local preview against production data), and so do the table (05) and Weft's preview (06).

### What didn't work
- **Blank preview:** Lattice Arena (capabilities `db, downloads, sample, user`) rendered an empty white frame at phone size. Its HTML calls `localStorage.getItem(PREFS_KEY)` while starting, and in a sandbox without `allow-same-origin` that throws a `SecurityError`. Playwright collects no console messages from the cross-origin frame (`Total messages: 0`), so the evidence is the code: `curl …/_s/lattice-arena/main/index.html | grep -o "localStorage[^;]{0,40}"`.
  - Fix: `previewDoc` fetches the HTML and inserts `<base href="/_s/<id>/main/">` and `SHIM` (in-memory `localStorage`/`sessionStorage` when the real ones throw) after `<head>`, then sets `srcdoc`.
  - After the redeploy, the iframe has `srcdoc` of 360,009 chars, and Lattice Arena renders, showing "3 robots staged. Claude is not available here".
- **The redeploy didn't show up:** the browser kept running the previous `views.js` (the iframe still had `src="/_s/lattice-arena/main/index.html"` and `srcdoc` length 0), because of `Cache-Control: public, max-age=60, stale-while-revalidate=600`. Fix: `02-deploy.py` rewrites the kit references in HTML to `?v=<sha256[:12]>`. Production now serves `views.css?v=86942171e22c` and `views.js?v=793e71cf135a`.
- **Blank screenshots that were not bugs:**
  - Covers blank on the list: the images were `complete` with real `naturalWidth` a few seconds later.
  - The landing page empty: the first visit waited on `catalog.json`.
  - A Claude.Computer screenshot showing "Loading the catalog…" while the DOM had 100 rows and the viewer open: the screenshot was captured mid-render.

  In each case I checked the DOM with `browser_evaluate` before drawing conclusions. The pages now say "Loading the catalog…" until the data arrives.

### What I learned
- Requests from here take ~0.6 s to the first byte, mostly connection and TLS (`connect 0.24 s, tls 0.37 s`). The server's own time is small. A first visit therefore takes 1–2 s before the catalog renders.
- **Two levels of preview quality:** apps that start without storage or the runtime (Weft) run fully; apps that touch storage now run with in-memory storage; anything needing `window.claude` shows its own "Claude is not available" state.

### What was tricky to build
- **Scaling the device frame:** the iframe keeps the device's real CSS size (390×844, for example), so the app lays out as on a phone. The frame is then scaled with `transform: scale(s)`. Negative margins remove the space the unscaled box would still reserve, and `s` is never above 1.

### What warrants a second pair of eyes
- **`srcdoc` with `<base>`:** a previewed app's relative URLs load from `/_s/<id>/main/` on the site host, in an opaque origin. Absolute third-party URLs load as they would in the app.
- **The shim** replaces storage only when access throws, so a browser that allows storage in opaque origins is unaffected.

### What should be done in the future
- The views for agents (task `8mz5`) after #31 and #32 are deployed.
- Thumbnails for the covers (up to 2,736 px wide PNGs today).
- Running previews would need an admin-only framing allowance per mount (guide §7).

### Code review instructions
- `apps/catalog/kit/views.js`: `previewDoc`, `SHIM`, `viewer.show` and `fit`; `scripts/02-deploy.py`: `stamps` and `tree`; `pkg/host/catalog_views_test.go`.
- Run: `python3 -I scripts/02-deploy.py <repo> <data>` should report three `up to date`. Then open https://site.slop.yolo.scapegoat.dev/catalog/list/?open=lattice-arena and choose Phone.

### Technical details
```
stores: catalog (snapshot 3) · catalog-list (3) · catalog-table (3), each @guest view
mounts: site.slop.yolo.scapegoat.dev /catalog · /catalog/list · /catalog/table
kit:    views.js?v=793e71cf135a · views.css?v=86942171e22c
```
