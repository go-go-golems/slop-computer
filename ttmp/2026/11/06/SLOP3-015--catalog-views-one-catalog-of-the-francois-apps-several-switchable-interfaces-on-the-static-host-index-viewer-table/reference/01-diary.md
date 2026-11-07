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
**Commit (code):** `5ff4fc0` (kit, views, builder, test); `c69d4f8` (deploy script, the `srcdoc` preview, loading states, versioned kit URLs, evidence). PR: https://github.com/go-go-golems/slop-computer/pull/35

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

## Step 3: Second batch — palette, pager, contact sheet, capability map, zine (local)

This step adds the four views proposed after the first deploy: a command palette in the shared kit, a contact sheet of live previews, a map of the runtime capabilities the apps declare, and a printable zine. The user asked for pagination midway, because a hundred items is too many on one page, especially on the sheet; the pager went into the kit and now serves the index, the table and the sheet. Everything was tested locally with `03-devserve.py` against production data. The deploy waits until the post-#31 image is running (deploy PR wesen/2026-03-27--hetzner-k3s#426, `sha-8e01dca`).

### Prompt Context
**User prompt (verbatim):** "ok, llet's continue with the #35 branch, and more moldandyeast stuff." followed by the pasted list of views (3 palette, 6 capability map, 7 contact sheet, 12 print/zine as the suggested batch); then "i guess we can test locally first, until we can then deploy the latest version when built"; then "we need gto paginate these apps btw, there's too many per page especially on like, sheet"; then "remember to commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Build views 3, 6, 7 and 12 on the #35 branch, add pagination, test them locally, and deploy after the new image is out.
**Inferred user intent:** More of Ramon's "many interfaces over one content" idea on slop.yolo, kept small and static, and usable with a hundred apps.
**Commit (code):** `84fb146` — palette, pager, contact sheet, capability map, zine

### What I did
- **Kit (`apps/catalog/kit/views.js`, `views.css`):**
  - `palette`: ⌘K or Ctrl K, plus a header button, opens a dialog. It searches the views, the 100 apps, the 125 tags, and (when a `caps` view exists) the capabilities. `fuzzy(text, q)` ranks substring matches first (more for a prefix or a word start), then subsequence matches with points for word starts and runs. If an app's title doesn't match, every word may instead match its id, tags, capabilities or description, at score 1. On a page with a bound viewer an app opens in the viewer; elsewhere it goes to the first view with `?open=`. Keys: ↑↓, Enter, Esc. `/` now only focuses the search box, and only when the focus is not in a field.
  - `paged(items, size, hosts, redraw)`: reads `?page=`, clamps it, draws "‹ Prev 1 2 … n Next › from–to of N" into each host, and returns the slice. `paged.reset()` drops `?page`, so a view goes back to page 1 when its filters change.
  - The viewer dispatches `catalog:viewer` `{open, id}` on window. `previewDoc`, `DEVICES` and `fuzzy` are now exported.
- **`apps/catalog-sheet/`:** tiles at desktop (1280×800) or phone (390×844) aspect.
  - An `IntersectionObserver` (100 px margin, settled for 150 ms) marks visible tiles.
  - `schedule()` keeps the visible tiles running whose apps are free and at most 1.5 MB, in page order, `MAX_LIVE = 8` at once. It starts them one at a time: it fetches the HTML through `previewDoc`, sets `srcdoc` on an `allow-scripts`-only iframe, and waits for `load` or 4 s.
  - Tiles that leave the screen lose their frame. While the viewer is open, everything stops.
  - "Covers" mode, the default under `prefers-reduced-motion`, runs nothing.
  - 24 tiles per page, 36 at phone aspect.
- **`apps/catalog-caps/`:**
  - One card per declared capability, with a count of the total, a bar, what it gives a page on slop (from `doc/claude-apis/README.md`, including the SLOP3-014 identity rules) and the apps as chips.
  - A combinations table: one row per exact set, with dots per capability, a count bar and examples. A row expands into its apps.
  - `#<cap>` anchors, which the palette links to.
- **`apps/catalog-zine/`:**
  - A cover page, contents pages (34 lines each) with page numbers, and one page per app: title, description, cover or monogram, then open URL, runtime, version and date, size and attachments, access and tags.
  - Pages are sized in mm from `--pw`/`--ph`, with `@page { size; margin: 0 }` set from the paper choice: reMarkable 158×210 mm, A5, A4 or Letter. `?size=`, `?tag=` and search narrow or resize it.
  - "Print or save as PDF" first switches every cover to eager loading and waits for all of them (`SlopZine.ready()`).
- **Pagination in the existing views:** index 20 per page, table 50, each with a pager above and below. Sort, tag, capability and search changes reset to page 1.
- **Wiring:** `01-build-catalog.py` VIEWS gains `sheet`, `caps` and `zine`. `02-deploy.py` STORES gains `catalog-sheet`, `catalog-caps` and `catalog-zine` on `/catalog/sheet`, `/catalog/caps` and `/catalog/zine`. `03-devserve.py` derives its mounts from a VIEWS list. `TestCatalogViewsOnStaticHost` serves six stores and checks each new page's title and that it loads the kit.
- Rebuilt the catalog data (same counts: 100 listed, 7 subscribers, 94 covers, 125 tags), ran the dev server on :8765 and checked every view in Playwright.

### Why
- **The palette in the kit, not a view:** every view gets it with one change, and it makes a hundred apps reachable without scrolling or pages.
- **A frame budget on the sheet:** 93 free apps add up to tens of MB of HTML, and several run animation loops. Running only the visible ones, a few at a time, keeps a laptop responsive, and leaving apps over 1.5 MB to the viewer avoids multi-MB fetches for a thumbnail.
- **A pager rather than infinite scroll:** a page is a URL (`?page=3`) that can be shared and returned to. The sheet's frame budget also works best with a bounded set of tiles.
- **Millimetres in the zine:** what the screen shows is what the printer gets, and Chromium's `preferCSSPageSize` takes the size from `@page`.

### What worked
- **Sheet, page 1:** "7 running" with the 2.6 MB Shop Next on its cover, marked "2.6 MB · view to run" (`various/screenshots/07-sheet-local.png`). On page 2, 24 tiles and the pager "‹ Prev 1 2 3 4 5 Next › 25–48 of 100".
- **Palette:** on `/catalog/caps/`, Ctrl K and then "wft" gives Weft as the only result (`08-palette-local.png`). Enter opens the viewer at `?open=weft`, and `history.back()` closes it.
- **Capability map:** the cards read sample 100, downloads 18, db 11, user 7, room 5. There are 9 combinations: sample alone 78, sample+downloads 9, sample+downloads+db+user 3, and so on (`09-caps-combos-local.png`).
- **Zine:** Playwright's `page.pdf({preferCSSPageSize: true})` after `SlopZine.ready()` produced 104 pages at 448×595 pt (158×210 mm): cover, 3 contents pages and 100 app pages (`10-zine-pages-local.png`).
- **Pagination:** list with `?tag=game`: 7 rows and no pager. Table `?page=2`: 50 rows, "51–100 of 100". After a capability filter: 5 rows, `?page` dropped, no pager.
- `go test ./pkg/host` → `ok`. `make lint` → `0 issues.`

### What didn't work
- **The sheet's status read "0 running" while 3 frames were up:** `status()` ran only after `schedule()` finished its loop, and the loop was still waiting on loads. Fixed: `badge()` updates the status, and it counts only frames that have finished loading.
- **The zine PDF was 88,833,182 bytes,** because Chromium embeds the covers at full size (some PNGs are 2,736 px wide). Ghostscript `-dPDFSETTINGS=/ebook -dColorImageResolution=150` brought it to 4,868,440 bytes with the same 104 pages. Kept outside the repository: `scratchpad/zine-remarkable.pdf`.
- **Two writes the classifier blocked:** a screenshot written straight to the scratchpad (Playwright may only write under the checkout's `.playwright-mcp`, which is git-ignored; I copied it from there), and closing the superseded deploy PR #425 (external write; left for the user).

### What I learned
- **`beton-brut-studio` refers to `core.js`, `render.js`, `presets.js` and `ide.js`, and none of them is in its store.** The store holds only `index.html`, `app.json` and `francois.json`.
  - On the static host they are 404.
  - On the live host, `/f/beton-brut-studio/core.js` answers 200 with `text/html`, the app's own page, which nosniff refuses as a script.
  - The preview still draws its static layout.
  - I have not checked francois's `release_files` for this release, so I can't yet say whether this is a SLOP3-013 import gap or the app as published on slop.boutique.
- Of the 100 apps, 78 declare only `sample`. Few use the shared-data or identity services.

### What was tricky to build
- **Starting frames one at a time:** a fast scroll changes the visible set while a load is in flight. `schedule()` is a single loop guarded by `busy`, and it recomputes the wanted set on every turn. A stopped tile clears `loading`, so `start()` notices and doesn't attach a stale frame. A tile that scrolls away mid-load is stopped on the next turn, at most 4 s later.
- **Scaling sheet frames:** each iframe keeps its device size and is scaled to the tile's width (`clientWidth / w`) from the top-left. A `ResizeObserver` on the grid rescales the tiles when the layout changes.

### What warrants a second pair of eyes
- **The sheet runs third-party HTML** in `allow-scripts`-only frames: an opaque origin, no forms, no modals. Up to eight run at once, so a heavy app can still load the CPU while visible.
- **The zine's eager loading** fetches up to 94 cover images (tens of MB) when someone presses Print.

### What should be done in the future
- Deploy the three new stores with `02-deploy.py --apply` once #426 is merged, then check them on production.
- Upload the zine PDF to the reMarkable once it is generated from production.
- Thumbnails for covers would help the sheet's cover mode and the zine size alike.
- Check `beton-brut-studio`'s release files in francois.

### Code review instructions
- `apps/catalog/kit/views.js`: `fuzzy`, `entries`, `palette`, `paged`.
- `apps/catalog-sheet/index.html`: `schedule`, `start` and `stop`.
- `apps/catalog-caps/index.html` and `apps/catalog-zine/index.html`.
- Validate locally: `python3 -I scripts/01-build-catalog.py <data>`, then `python3 -I scripts/03-devserve.py <repo> <data> 8765`, then open `/catalog/sheet/`, `/catalog/caps/` and `/catalog/zine/`, and press Ctrl K.

### Technical details
```
views:  list (20/page) · table (50/page) · sheet (24/page desktop, 36 phone; MAX_LIVE 8, MAX_BYTES 1.5 MB) · caps · zine
zine:   104 pages = cover + 3 contents (34/page) + 100 apps; 158×210 mm; 88.8 MB → 4.9 MB (gs /ebook, 150 dpi)
caps:   sample 100 · downloads 18 · db 11 · user 7 · room 5; 9 combinations, sample-only 78
```

## Step 4: Zine layouts to print and fold, and the second deploy

The user asked for zine templates to print and fold: an 8-page zine from one sheet, and a 16-page booklet printed on both sides. Both are now layouts of the zine view. Each layout imposes the zine's pages onto landscape sheets, and the chosen apps are taken a part at a time. The user had merged the deploy PR #426, so once `sha-8e01dca` was running, the batch went to slop.yolo and was checked there. The source is in the repository on #35's branch, and the deploy only pushes those files.

### Prompt Context
**User prompt (verbatim):** "Add the ptions to output a 16 foldable zine or a 8 foldable zine template (you know to print out and fold, or print out two sided. for the zine version. Also, I merged #426 and closed al the rest." Then, during the deploy: "did you store the source in git as well?"
**Assistant interpretation:** Two print layouts for the zine view (an 8-page single-sheet fold, a 16-page two-sided booklet), then deploy the batch now that the new image is out.
**Inferred user intent:** Paper zines of the catalog to print at home, and the views live.
**Commit (code):** `31295b9` — zine layouts; `f047016` — deploy log

### What I did
- **`apps/catalog-zine/index.html`, rewritten around a layout choice:**
  - `pages`: as before.
  - `fold8`: one landscape A4 or Letter side, a 4×2 grid. Pages 5 4 3 2 run across the top, turned 180°, and 6 7 8 1 across the bottom. Fold lines are dashed and the cut between the middle panels is a solid line marked ✂. Pages are drawn at twice their printed size, so A4's 74.25×105 mm panel holds a 148.5×210 mm page at `scale(.5)`. A `.mini` class sets larger type and drops the version, size and tags.
  - `booklet16`: sheet *s* has pages n−2s | 2s+1 on the front and 2s+2 | n−2s−1 on the back, two half-sheet pages per landscape side, with a fold line and a "sheet k front/back" label.
  - `zinePages()`: page 1 is a cover with "Part k of K", then the part's apps (6 or 14), then blank pages to fill a short part, then a back cover listing the apps by page number with the catalog URL.
  - The screen shows the folding steps for the chosen layout. `?layout=`, `?part=` and `?size=` stay in the address, and the paper list shrinks to A4 and Letter for the folding layouts.
- **Checked locally**, with PDFs through Playwright's `page.pdf({preferCSSPageSize: true})`:
  - `fold8` for `#game` part 1: one A4 landscape page (841.92×594.96 pt). The cover says "6 of 7 … Part 1 of 2".
  - `booklet16` part 2: 8 A4 landscape pages. Sheet 1 front is 16 | 1, back 2 | 15; sheet 2 front 14 | 3, back 4 | 13.
- **Deploy:**
  - `kubectl -n slop get pods` showed `sha-8e01dca` running.
  - `01-build-catalog.py` (same counts) and `02-deploy.py`: the dry run, then `--apply` (`various/deploy-2026-11-07.txt`). `catalog`, `catalog-list` and `catalog-table` went to snapshot 4. `catalog-sheet`, `catalog-caps` and `catalog-zine` were created, granted `@guest view`, mounted and pushed to snapshot 1. A rerun printed `up to date` six times.
- **Production checks in Playwright:**
  - all six pages and `views.json` answer 200;
  - the sheet shows "8 running" with 24 tiles;
  - Ctrl K "latice" finds Lattice Deck, Lattice Rift, Lattice Arena and Lattice Arcade, and Enter opens `?open=lattice-deck`;
  - `fold8` has 8 slots and 17 parts;
  - the landing page has five view cards.
- **PDFs from production**, compressed with Ghostscript `/ebook`, are in `scratchpad/zine-pdfs/`:
  - `remarkable`, 104 pages, 4.9 MB;
  - `fold8-part1`, 123 KB;
  - `booklet16-part1`, 521 KB.

  The reMarkable one is uploaded to `/ai/2026/11/07/slop-catalog-zine-remarkable`.

### Why
- **Imposition in the page rather than relying on the print dialog's booklet option:** browsers have no booklet printing, and the 8-page fold needs the upside-down top row, which no print dialog offers.
- **Pages drawn at twice size in `fold8`:** the same `appPage` builder serves every layout, and only the type scale changes.
- **Parts rather than an n-page booklet:** 8 and 16 are what the user asked for, a single sheet or four sheets, and a part is a page-sized slice anyone can pick with `?part=`.

### What worked
- **The 8-page order** (`11-zine-fold8-game-part1.png`): after folding along the long side, the cover leaf is panels 1/2, the end leaf 5/6, and the cut middle panels pair 3/4 (top) and 7/8 (bottom), so pages run 1–8.
- **The booklet** (`12-zine-booklet16-part2-sheets1-2.png`) follows the saddle-stitch order above.
- **Production** answered as listed in What I did. `go test ./pkg/host -run TestCatalogViews` → `ok`.

### What didn't work
- Nothing failed in this step. The fold has been checked only on screen and in the PDF, not on paper.

### What I learned
- Chromium's `page.pdf` honours `@page { size }` per document only, so each layout writes its own `@page` rule into `<style id="paper">` when it renders.

### What was tricky to build
- **The upside-down panels:** `transform: translate(w, h) rotate(180deg) scale(.5)` with `transform-origin: 0 0`. The transforms apply right to left: scaled at the origin, turned to occupy (−w, −h)…(0, 0), then moved back into the cell.

### What warrants a second pair of eyes
- **Duplex:** the booklet assumes "flip on the short edge" for landscape pages. A printer set to the long edge prints every back side upside down.
- **Print scaling:** the folding layouts have no margins, so a printer that cannot print to the edge clips about 3–5 mm at the borders. The type sits inside 11–13 mm of padding (5.5–6.5 mm at the 8-page scale).

### What should be done in the future
- Print one of each on paper and fold it.
- Thumbnails for covers would cut the PDF size before compression.

### Code review instructions
- `apps/catalog-zine/index.html`: `zinePages`, `slot`, `fold8`, `booklet`, `render`.
- Open https://site.slop.yolo.scapegoat.dev/catalog/zine/?layout=fold8&tag=game and `?layout=booklet16`, and print to PDF (landscape, no margins).

### Technical details
```
stores: catalog, catalog-list, catalog-table (snapshot 4); catalog-sheet, catalog-caps, catalog-zine (snapshot 1); all @guest view
mounts: site.slop.yolo.scapegoat.dev /catalog{,/list,/table,/sheet,/caps,/zine}
kit:    views.js?v=3b402fa0396f
fold8:  A4 landscape, panel 74.25×105 mm, page 148.5×210 mm at 0.5; order 5 4 3 2 (180°) / 6 7 8 1
book16: sheet s: front 16-2s | 2s+1, back 2s+2 | 15-2s
```

## Step 5: Production checks after #31–#34, and the remaining static views

This step starts the batch the user approved: all the remaining static views, then views 4 (agents), 14 (shelf) and 15 (curator). First came the production checks promised once `sha-8e01dca` was running. The SLOP3-013 verifier passes again. The module and privacy checks are covered by the live apps of this batch rather than by throwaway probe stores. Then five static views: timeline with an Atom feed, a size treemap, roulette, a text terminal and a desktop. All five are deployed and checked on slop.yolo.

### Prompt Context
**User prompt (verbatim):** "go ahead.  all the static pages, and then also 4. 14. 15. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)."
**Assistant interpretation:** Build views 8, 9, 10, 11 and 13 as static pages, then 4, 14 and 15 on the live host; run the post-deploy checks first.
**Inferred user intent:** The whole list from the moldandyeast study, live on slop.yolo.
**Commit (code):** `37b95ef` (merge of main into the branch, for #31's modules); `4fe3ea9` — timeline + feed, sizes, roulette, terminal, desktop

### What I did
- **Merged `origin/main` into the branch** (a plain merge, no force push), so the branch has #31's `database`, `express` and `fs` modules and their tests.
- **SLOP3-013 verifier on `sha-8e01dca`:** `04-verify.py inventory-2026-11-06.json https://apps.slop.yolo.scapegoat.dev` → `103 stores, 0 failing; anonymous view status: {('free', 200): 95, ('paid', 401): 8}`.
- **Builder:**
  - `--history <inventory.json>` reads SLOP3-013's francois inventory, a file in the repository, and adds `releases` (published only, newest first, with changelog) to each item.
  - `atom()` writes `feed.xml`: one entry per release, `tag:` ids, links to the viewer and to the app, the changelog or else the description as summary, tags as categories.
  - Result: 96 apps with one release, 3 with three, 1 with two; 107 entries; `xmllint --noout` passes.
  - Production has no `francois/<ver>` refs (SLOP3-013 skipped history), which is why the inventory file is the source.
- **Kit:**
  - `live(box, item, device)`: a scaled sandboxed preview in any box, the cover for paid apps, and a `stop()`.
  - `related(item, items)`: tag Jaccard plus a quarter of capability Jaccard.
  - The view switcher scrolls sideways, since there are now ten views.
- **`catalog-timeline`:** a stacked bar per day (new app in ink, update in accent) linking to the day, then days with releases by time, changelogs as quotes, a "Subscribe · Atom feed" button and `<link rel="alternate" type="application/atom+xml">`.
- **`catalog-treemap`:** a squarified layout (Bruls, Huizing and van Wijk). Area is HTML bytes; shade is the number of capabilities; hatching marks subscriber apps. It can group by capabilities, first tag or access, and shows a tooltip, a legend, and the largest and smallest app.
- **`catalog-roulette`:** one or two random apps running (`live`), a "Like X" row (the 4 most related apps) and "…but different" (the 3 least related). The picks stay in `?a=&b=`. Space spins. "Free only" is on by default. Frames stop while the viewer is open.
- **`catalog-term`:** the commands `help ls grep find cat open run tags caps du new random cd whoami history clear`. Tab completes commands, ids, tags, capabilities and views; ↑↓ walk the history; Ctrl L clears; links in the output are clickable; `?cmd=` runs a command on load.
- **`catalog-desktop`:**
  - Icons (All apps, Games, Studios, Read me, and the 10 newest free apps).
  - Explorer windows with a filter.
  - Windows that drag by the title bar, resize from the corner, and minimize, maximize and close; a double click maximizes.
  - A Start menu with fuzzy search, a taskbar with a clock, and `?w=` remembering the open windows.
  - At most 5 app windows run. Older ones pause with "click to run", and minimized ones stop.
  - While dragging, `.busy` turns off pointer events on the iframes.
- Registered all five in `VIEWS`, `STORES`, `03-devserve.py` and `TestCatalogViewsOnStaticHost`.
- **Deploy** (`various/deploy-2026-11-07b.txt`): the six existing stores were pushed again (kit and data changed). Five new stores were created, granted and mounted; a rerun planned nothing.

### Why
- **The inventory as the history source, not new refs on production:** SLOP3-013 decided not to import history into the stores. The inventory is a read-only file already in the repository.
- **The feed built at build time:** the static host can serve it, and it changes only when the catalog does.
- **One `live()` helper:** roulette and the desktop need the same scaled frame the sheet and the viewer use. Keeping it in the kit keeps the storage shim and the sandbox flags in one place.

### What worked
- **Local** (`03-devserve.py`, Playwright, no page errors):
  - the timeline shows "100 apps, 7 updates, over 7 days" with 10 bars and 5 changelogs;
  - the flat treemap has 100 cells covering 100 % of the area, and grouped by capabilities it has 9 groups;
  - roulette started at `?a=weft` with one frame and 7 picks, and "Two" gave `?a=weft&b=thought-machines`;
  - the terminal ran `ls game` (7), `caps`, `cat lattice-deck` with its changelog, and `du 3`, and Tab turned `cat lat` into `cat lattice-`;
  - on the desktop, two icons opened two running windows, a title-bar drag moved one, and Start → "tabula" → Enter opened Tabula Workbench as a fourth window; the address became `?w=claude-computer,shop-next,tabula-workbench`.
- **Production** (Playwright):
  - all five pages answer 200 and render (7 days, 100 cells, a card, the terminal, a window), with no page errors;
  - `term/?cmd=caps` prints the capability bars;
  - `/catalog/data/feed.xml` answers 200 as `text/xml`.
- `go test ./pkg/host` → `ok`; `make lint` → `0 issues.`

### What didn't work
- **The terminal printed its class names** ("hiweftdim sample"): `print` flattened its parts with `.flat()`, which also flattened the `[class, text]` pairs. Fixed by making styled spans objects (`S(c, t, f)`) and flattening with `flat(Infinity)`. A small script rewrote each `["dim", …]` to `S("dim", …)`, closing each call with a parenthesis instead of a bracket, and `node --check` passed on the extracted script.
- **One `make lint` run** failed with `cmd/slop/main.go:1: error obtaining VCS status: exit status 128`. `git status` was clean, and the next two runs reported `0 issues`. Not investigated further.

### What I learned
- **Béton Brut Studio is the smallest app at 20 KB.** That fits Step 3's finding that its HTML loads four scripts its store does not hold.
- Release activity peaks on Oct 23–24 (the import days on slop.boutique), and only 7 of the 107 releases are updates.

### What was tricky to build
- **Pointer capture over iframes on the desktop:** an iframe under the pointer swallows `pointermove`, so the desktop takes the `busy` class during a drag, and also while the viewer is open.
- **The squarified layout's row flush:** a row becomes a column on the left when the remaining rectangle is wider than tall, and a row on top otherwise. Each flush shrinks the rectangle on that side.

### What warrants a second pair of eyes
- **The desktop can run five previews at once.** Heavy apps (several MB) can still load a laptop.
- **The feed is served as `text/xml`** by the static host's type table rather than `application/atom+xml`. Feed readers accept it.

### What should be done in the future
- The header switcher holds ten views now and scrolls; a "More" menu may read better.
- Views 4, 14 and 15 next (Step 6 on).

### Code review instructions
- `scripts/01-build-catalog.py`: `history`, `atom`.
- `apps/catalog/kit/views.js`: `live`, `related`.
- The five `apps/catalog-*/index.html`; in the treemap, `squarify`; on the desktop, `win`, `drag` and `budget`.
- Check: https://site.slop.yolo.scapegoat.dev/catalog/timeline/, `…/treemap/?group=caps`, `…/roulette/`, `…/term/?cmd=cat%20weft`, `…/desktop/`, and `…/data/feed.xml` in a feed reader.

### Technical details
```
verify (SLOP3-013): 103 stores, 0 failing; free 200 ×95, paid 401 ×8 (sha-8e01dca)
stores: catalog (5), list (5), table (5), sheet (2), caps (2), zine (2), timeline/treemap/roulette/term/desktop (1); all @guest view
feed:   107 entries; text/xml; history for tabula-workbench, lattice-deck, lattice-rift (3), lattice-phantasmagoria (2)
```

## Step 6: View 4, the catalog for agents

View 4 makes the catalog readable by programs. Three static files come from the builder: `llms.txt`, a flat `search-index.json`, and the feed from Step 5. An `/agents` page explains them. The fourth piece is a read-only MCP server, written as an express actor (#31's module) behind a mount API policy (#31's rate limiter and CORS). It is the first use of those features on production. The official Python MCP SDK connects to it there, and the agents page calls it from the browser through CORS.

### Prompt Context
**User prompt (verbatim):** see Step 5
**Assistant interpretation:** View 4: llms.txt, search-index.json, a read-only MCP endpoint and an /agents page.
**Inferred user intent:** Agents can find and use the catalog without scraping pages.
**Commit (code):** `4bed408` — view 4; `2640087` — lint fix in its test

### What I did
- **`apps/catalog-mcp/`:** `app.json` (title and actor) and `actor.js`.
  - `require('express').app()` with `app.post('/').public()` and `app.get('/').public()`; `require('./data/catalog.json')` loads the deployed catalog with the actor.
  - JSON-RPC 2.0: `initialize` (picks the client's version among 2025-06-18, 2025-03-26 and 2024-11-05, otherwise the newest), `ping`, `tools/list` (annotations `readOnlyHint: true`, `openWorldHint: false`) and `tools/call`.
  - Four tools: `search_apps` (query, tag, capability, free_only, limit ≤ 50), `get_app` (full record with absolute links to the HTML, viewer, cover and attachments, plus release history), `list_tags`, `list_capabilities`.
  - Batches answer each request. Notifications get `202` with an empty body. An unknown method gets `-32601`. An unknown app is a tool result with `isError: true`, as the protocol asks for tool failures.
  - `GET` answers `405` with `Allow: POST` and a short description.
- **`pkg/host/catalog_mcp_test.go` `TestCatalogMCPEndpoint`:** the store on a live mount with the deploy's API policy. It covers initialize, the notification, tools/list, search, get_app (found and not found), an unknown method, a batch, the CORS preflight from the allowed origin (`204`), a POST from the allowed origin (with `Access-Control-Allow-Origin`) and from another (without it), and the GET.
- **Builder:**
  - `llms.txt`: summary, "For agents" links, and one line per app with tags, runtime and access;
  - `search-index.json`: flat records with a lower-case `text` field, 72 KB;
  - `catalog.json` gains `"mcp"`.
- **`apps/catalog-agents/`:** cards with copy buttons for the endpoint and files; connection snippets (`claude mcp add --transport http slop-catalog <url>`, an `mcpServers` JSON and `curl`); a console that runs `initialize` and `tools/list`, then calls the chosen tool with JSON arguments.
- **`02-deploy.py`, rewritten around store records:** either host, wanted grants (default `@guest view`), policy cells, mount API policies (compared with `covers()`, since the server may add defaults) and `--only`. `catalog-mcp` goes to `apps.slop.yolo.scapegoat.dev/catalog/mcp` with routes `POST /` and `GET /`, `defaultMin: public`, `rateLimit {per: ip, limit: 60, window: 1m, burst: 120}` and `cors {origins: [site]}`.
- **Deploy** (`various/deploy-2026-11-07c.txt`): `catalog` went to snapshot 6 (llms.txt, the search index and views.json). `catalog-agents` and `catalog-mcp` were created at snapshot 1.
- **`scripts/04-mcp-check.py`:** a client on the official SDK.

### Why
- **The live host:** `mount.set` refuses an actor store on a static host (`catalog-mcp runs a live app (capabilities or an actor): mount it on a live host`). A public route on the live host needs no session.
- **The catalog shipped with the actor, not read from the `catalog` store:** `require` of a tree JSON file is the simplest read with no binding or grant. A new catalog means a new snapshot of `catalog-mcp`, which rebuilds the actor.
- **A rate limit on an open endpoint:** anyone can call it, and each call is an actor turn.
- **CORS for one origin:** the agents page needs it, and the policy allows no wildcard.

### What worked
- `go test ./pkg/host -run TestCatalog` → both tests pass; `make lint` → `0 issues.` after the fix below.
- **Production by `curl`:** `initialize` → 200 with `serverInfo.name: slop-catalog`. `search_apps {query: shader, limit: 3}` → total 14: `ds-shader-sketchbook, on-twos, no-shade`. `GET` → 405. The preflight from the site → `204` with `access-control-allow-origin: https://site.slop.yolo.scapegoat.dev`. `llms.txt` → 200 `text/plain`.
- **Production with the official SDK** (`uvx --with mcp`, mcp 2.3.0): `server: slop-catalog 2025-06-18`; tools `search_apps, get_app, list_tags, list_capabilities`; `get_app weft` → `Weft free https://site.slop.yolo.scapegoat.dev/_s/weft/main/index.html`; `search_apps {capability: room}` → `mimeo-studio, mimeo, hypercore-studio, living-comic-studio, lattice-deck`.
- **The agents page on production:** the console's `search_apps {query: game, limit: 3}` answered in 339 ms through CORS (`various/screenshots/20-agents-prod.png`).

### What didn't work
- **The first test mounted the endpoint on the static host** and `mount.set` refused it (quoted above). Moved to the live host.
- **Lint:** `catalog_mcp_test.go:59:5: ineffectual assignment to out (ineffassign)`. Fixed in `2640087`. I committed `4bed408` before reading the lint output, which I should have read first.
- **The SDK script needed three tries:** `streamablehttp_client` is now `streamable_http_client`, it yields two streams instead of three, and results use snake_case (`server_info`, `structured_content`). All three are SDK API changes, not server problems.
- **My first browser check** waited for /connected/, which "not connected" also matches, so it read the status before the handshake. The tool call afterwards worked, and a second read showed the status line.

### What I learned
- A mount API policy's `defaultMin` is `view`, so public routes behind a policy need `defaultMin: "public"`, or every guest gets 404.
- The CORS middleware answers preflights before the actor is built, so a preflight costs no turn.

### What was tricky to build
- **The `202`:** MCP wants an empty `202 Accepted` for a POST that holds only notifications. `res.status(202).end()` gives exactly that.

### What warrants a second pair of eyes
- **`get_app` returns absolute site URLs** built from a constant in `actor.js`. If the site host changes, the actor needs a new push.
- **The rate limit counts per IP,** so agents behind one NAT share 60 calls per minute.

### What should be done in the future
- The site has no `favicon.ico` (404 on every page). Each page could link the slop favicon.

### Code review instructions
- `apps/catalog-mcp/actor.js`: `answer`, `TOOLS`, the two routes.
- `pkg/host/catalog_mcp_test.go`.
- `scripts/02-deploy.py`: the `catalog-mcp` record, `covers`, `main`.
- Validate: `uvx --with mcp python -I scripts/04-mcp-check.py https://apps.slop.yolo.scapegoat.dev/catalog/mcp`, then open https://site.slop.yolo.scapegoat.dev/catalog/agents/ and call a tool.

### Technical details
```
POST https://apps.slop.yolo.scapegoat.dev/catalog/mcp   (JSON-RPC; JSON answers; stateless)
api policy: routes [POST /, GET /], defaultMin public, rateLimit ip 60/1m burst 120, cors [https://site.slop.yolo.scapegoat.dev]
files: /catalog/llms.txt (28.8 KB) · /catalog/data/search-index.json (72 KB) · /catalog/data/feed.xml (73 KB)
```
