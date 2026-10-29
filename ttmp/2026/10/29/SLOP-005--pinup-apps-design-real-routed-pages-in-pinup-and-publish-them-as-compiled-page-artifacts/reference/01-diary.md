---
Title: Diary
Ticket: SLOP-005
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
Summary: "Chronological diary for SLOP-005: Pinup apps, designs compiled into routed slop pages."
LastUpdated: 2026-10-29T10:33:31.190032658-04:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Record how SLOP-005 was designed and built: Pinup designs published as real, routed slop pages (Pinup apps), with screen paths, a compiler, an in-page runtime, data binding, and the editing loop between the Workshop and Pinup.

## Step 1: Design of Pinup apps, the intern guide, and the ticket

The user asked how real slop pages relate to Pinup designs, given that the only design in Pinup was the Pace Club example. The honest answer was that there is no link: a design is a separate data artifact, and the only bridge is Hand off, which asks an agent to build a page. I proposed a bridge (import rendered pages into Pinup). The user preferred Pinup-only apps, where the design is the source and the page is compiled output.

This step settled that design and wrote it down as the intern guide (`design-doc/01-…`, 591 lines), uploaded to reMarkable. No code changed yet.

### Prompt Context
**User prompt (verbatim), 1:** "Ok, how can we design real pages in pinup / how is the link between our normal pages and editing them in pinup? Currently I see Pace Club which is not really related?"
**User prompt (verbatim), 2:** "we could also just have apps that are pinup only, instead of trying to bridge directly. But basically I want to create/edit real routed pages in pinup"
**User prompt (verbatim), 3:** "Ok, create a new ticket, and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable.

Then implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)

Diary format is mandatory!"
**Assistant interpretation:** Turn "Pinup apps" into a ticket with an intern-level design and implementation guide, upload it, then implement it with commits and this diary.
**Inferred user intent:** Make Pinup the way to create and change real pages on the site, without a hand-written-code step in between.
**Commit (code):** none yet (this step adds the ticket only).

### What I did
- **Pinup, read for the compiler:**
  - `07-export.js`: `expand`, `tagFor`, `exportHTMLParts`, `exportHTMLDoc`. Links are exported only as `data-link="<frame name>"`.
  - `03-render.js:92` `cssFor`: the root is `position: relative` plus fixed `width/height`; `clip` → `overflow: hidden`.
  - `02-store.js` `norm` and `applyRemoteFile`: both keep unknown fields, so `node.route` and `S.file.app` survive.
  - `06-proto.js`: links `{to, on, tr, dur}` and `flow`.
  - `05-panels.js:818` `protoPanel`: returns an array of `sec()` sections.
  - `04-canvas.js:1079` `imageSrcFor`: without an asset store, images are JPEG data URLs of at most ~180 KB.
- **slop, read for routing and serving:**
  - `pkg/routing/routing.go` (`Match`, `Specificity`);
  - `pkg/server/serve.go`:
    - `renderPage`, which serves only `index.html`;
    - boot `record`, which is a path string;
    - the file lookup by path, then base name at the version root, then the `Referer`'s page;
    - `/_v/`;
  - `pkg/render/assets/runtime.js` (`window.slop`) and `pkg/records/records.go` (record shape; file records get `src`);
  - `pkg/server/kernel.go`: the push body (`create`, `base`, `moveMain`, `manifest`), manifest warnings, and the routes API (`GET/PUT/DELETE /api/routes`);
  - `pkg/server/preview.go:16`: records need `versions:read`;
  - Workshop `PageToolbar` (`WatchRight.tsx:40`), which already has the "Open as tool" pattern.
- **Ticket and upload:**
  - `docmgr ticket create-ticket --ticket SLOP-005 --title "Pinup apps: …" --topics tools,frontend,routing,architecture`, plus the design doc and this diary;
  - 12 tasks;
  - `remarquee upload bundle … --name "SLOP-005 Pinup apps intern guide" --remote-dir /ai/2026/10/29/SLOP-005` → `OK: uploaded SLOP-005 Pinup apps intern guide.pdf -> /ai/2026/10/29/SLOP-005`.

### Why
- **All screens in one `index.html`, chosen by an inline runtime.** A route serves only `index.html` (`serve.go:126`), so a version cannot hold one HTML file per screen. Putting screens in `<template>` keeps the hidden screens' images from loading.
- **The runtime matches the path itself** instead of relying on `--record` routes. Every route of an app is then a plain route to the app page, and the page's `reads` provide all data.
- **One route per screen** rather than `base` + `base/*`. Unknown paths get the server's 404, and the Routes screen shows the app's structure.
- **Images become root-level files named by hash and referenced by bare name.** `fileFor` falls back only to the base name at the version root. `/_v/<artifact>/<n>/` would need a version number the compiler doesn't know before the push.
- **Its own emitter.** `exportHTMLParts` writes links as frame names, which are ambiguous and carry no URL. Copying its 25-line emitter is cheaper than post-processing its output.

### What worked
- Every fact the design depends on was confirmed in code:
  - unknown fields survive `norm` and `applyRemoteFile`;
  - push stores unknown manifest keys;
  - the `warnings` channel already reaches the CLI;
  - `protoPanel` is a wrappable binding that returns sections.

### What didn't work
- No failures in this step.

### What I learned
- `window.slop.record` is a path (`"posts/x.md"`), not a record object. The page has to find it in `slop.data`.
- The grant permissions Pinup has today are not enough for data binding or route reconciliation; it needs `versions:read` and `routes:read`.

### What was tricky to build
- **Asset URLs on nested paths.** A relative URL from `/pace-club/runs/7` arrives as `/pace-club/runs/i-….jpg`. That works only because the server falls back to the base name at the version root, and to the `Referer`'s page when the path resolves to a different page. Placing images anywhere but the version root would break this.

### What warrants a second pair of eyes
- **Publish deletes routes.** Route reconciliation deletes routes that point at the app page on its host but are no longer screens. It must never touch a route that points elsewhere, and it must refuse when a screen URL is already routed to another page.

### What should be done in the future
- See guide §12: breakpoints, self-hosted fonts, server-side template choice for no-JS clients, and sample data on the canvas.

### Code review instructions
- Read `design-doc/01-intern-guide-pinup-apps-compiling-designs-into-routed-slop-pages.md` §4–§10.

### Technical details
- Node fields added by this ticket: `route` (screen path), `record` (source of a record screen), `repeat` (source of a repeated frame), and `fills[i].bind` (image field).
- The file field is `S.file.app = {page, host, base, data}`.
- The app page manifest is `{pinup: {design, version}, reads}`.

## Step 2: The compiler and the in-page runtime

I wrote `web/pinup/slop/js/96-slop-app.js`, which checks and compiles a design into an app page, and a browser test that drives it. The test loads Pinup's example app, gives its screens paths, adds a list screen whose list repeats records, and compiles. It then serves the compiled page with boot data, the way slop injects it, and checks what visitors would see. All 24 checks pass, after two failures that are recorded below.

The compiled Pace Club example is one `index.html` with four `<template>` screens, one stylesheet and a 3 KB runtime. Welcome's button is a real `<a href="/pace/home">`. Each card in the list links to `/pace/runs/<id>`, and the run screen fills in the run's title.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Implement guide §5–§6 and §8: the compiler, the runtime and data binding.
**Inferred user intent:** Designs become real routed pages.
**Commit (code):** `51fbeac` — "Pinup apps: compile screens with paths into one page (templates, links, images, inline runtime with data binding)"

### What I did
- **`96-slop-app.js` compiles the design:**
  - `slopAppPath`, `slopAppValidPath`, `slopAppJoin`, `slopAppPattern` (duplicate detection that ignores parameter names);
  - `slopAppScreens`: top-level frames with `route`, visible, not components;
  - `slopAppCheck` → `{errors, warnings, screens}`;
  - `slopAppCompile(chk, designVersion)`, which uses Pinup's `expand`, `cssFor`, `tagFor`, `iconSVG`, `cleanSVG`, `tokensCSS`, `usedFonts`, `fontLink` and `paintCSS` from the shared scope.
- **`slopAppRuntime` runs in the compiled page.** It is a real function in the bundle, copied into the page with `toString()`. It handles path matching (mirroring `pkg/routing`), record lookup by `id` then `slug`, repeats with `sort` and `limit`, `{{field}}` placeholders, `data-href`, `data-img`, back links and not found.
- **`slopPush`** (`00-slop-host.js`) now takes bytes as well as strings, a `manifest`, and `moveMain: false`.
- **`slop/build.js`** refuses any module that contains a closing script tag (see below).
- **`slop/tests/app.js`** is the browser test. It builds a harness from `dist/slop/index.html` with the outer function removed, so `page.evaluate` can call `loadExample`, `patchMany`, `slopAppCompile` and the rest.
  - Run: `NODE_PATH=$S/pw/node_modules PW_CHROMIUM=…/chromium_headless_shell-1234/… node -r $S/pw/use-cached.js slop/tests/app.js` → `all passed` (24 checks).
- Screenshots `various/s5-app-home.png`, `s5-app-runs.png`, `s5-app-run-8.png`.

### Why
- **The runtime is a function, not a string.** It gets syntax-checked with the bundle (`node --check dist/slop-check.js`), and the test exercises exactly the code that ships.
- **Bound attributes are removed after binding.** Repeats are bound inner-first, so an outer pass would otherwise re-fill a copy's `{{title}}` without the row in scope and blank it.

### What worked
- 24/24 checks, including:
  - `/pace/runs` lists both runs sorted by date, and the sample copy is gone;
  - `/pace/runs/8` → title `Sunrise 5K · Pace Club`;
  - `/pace/runs/99` → `Not found` on the site, and the first record in preview;
  - a path outside the app → `Not found` on the site, and Welcome in preview;
  - a 1×1 `data:` PNG became `i-<16 hex>.png`, and the CSS names it.

### What didn't work
- **The compiler's HTML template ended Pinup's own script element.** The first test run failed with `page.evaluate: ReferenceError: loadExample is not defined`. A debug run showed the page errors: `PAGEERROR Unexpected end of input` and `PAGEERROR Unexpected token '{'`. The compiler's template contains `<script …>…</script>`, and the whole bundle is inlined in one `<script>` element, so the HTML parser closed the element at the first literal `</script>`. This would have broken the real Pinup tool, not only the test. Fix: write `<\/script>` in `96-slop-app.js`. `slop/build.js` now throws `<module> contains </script>` for any module with the literal.
- **Icon buttons collapsed in the compiled page.** The run screen's back and share buttons rendered as flat 40×20 pills (screenshot before the fix). Their CSS was `width: 40px; align-self: stretch`, inside a top bar that hugs its content. In CSS a stretched child of a hugging flex container gets the content's height (the 20 px icon); Pinup's canvas uses the designed 40 px. Pinup's own `exportHTMLDoc` has the same quirk. Fix in the compiler: a node with `sh: 'fill'` inside an auto-layout parent with `sh: 'hug'` gets `min-height: <designed h>px`. The fix is for height only, because a `min-width` would stop fill widths from shrinking on narrow screens.

### What I learned
- Pinup's top-level script bindings become page globals when the outer function is removed, which makes Pinup's internals testable from Playwright without changing upstream code.
- The example design exercises most of the compiler: instances with overrides, a back link, a link inside an instance, dark-mode tokens, icons and an SVG.

### What was tricky to build
- **Binding order.** `querySelectorAll` does not enter `<template>` content, so a repeat's copies are bound before they are inserted. The outer pass then finds them in the fragment, and it is the removal of `data-t`, `data-href` and `data-img` that makes a second pass harmless.

### What warrants a second pair of eyes
- **The `min-height` rule** applies whenever `sh === 'fill'` and the parent hugs. Check designs where a fill child is meant to be shorter than its stored height after content changes.
- **Placeholder values are inserted with `textContent` and `style.background`, never as HTML.** A `"` in an image URL is escaped to `%22`.

### What should be done in the future
- N/A for this step; the publish flow and the UI are next.

### Code review instructions
- Start with `slopAppCompile` and `slopAppRuntime` in `web/pinup/slop/js/96-slop-app.js`, then `web/pinup/slop/tests/app.js`.
- Validate: `cd web/pinup && node slop/build.js && node slop/tests/app.js` (with Playwright available).

### Technical details
- Compiled layout:
  - `<template id="s-<frameId>" data-bg="<css colour>"><main class=…>…</main></template>` per screen;
  - `<script type="application/json" id="pinup-app">{name, base, start, screens:[{id, name, route, record?}]}`;
  - the runtime in `<script>`.
- Data attributes: `data-t` (text template), `data-href` (link template), `data-img` + `data-img-fit`, `<template data-repeat data-sort data-limit>`, `data-back`.

## Step 3: Publishing, the editor sections, the Workshop buttons, the push warning, and the end-to-end run

This step made Pinup apps usable from the editor and proved them on the local server (Postgres `slop_fr`, `127.0.0.1:18120`). In the browser I took the Pace Club design through the whole flow:

- made it an app, with `data-runs` (four club runs) as a data source;
- wrapped Home's three run cards in an auto-layout list and set it to repeat `runs` sorted by `date`;
- gave Run detail the path `/runs/:id` showing a `runs` record;
- put `{{field}}` placeholders in the card and on Run detail with an agent step through `inbox/`;
- previewed, then published.

On `site.localhost`, `/pace-club/home` lists the four runs from the data in date order. Each card links to `/pace-club/runs/<id>`, which shows that run, and Back returns to Home.

The run also found an inconsistency, which I fixed. The server's warning on a hand push said Publish app would replace the page, but Publish app refused to. Publishing over a hand-written `main` now asks the person first.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Guide §7, §9 and §10: the publish flow, the editor UI, the Workshop links, the server warning and help; then check it end to end.
**Inferred user intent:** Create and edit real routed pages in Pinup.
**Commit (code):**
- `5b90016` — "Pinup apps: publish flow, app settings and Prototype-tab sections; Edit in Pinup; push warning on compiled pages"
- `7e012b5` — "Pinup apps: ask before replacing a hand-written page; warning and help say so; clearer repeat limit field"

### What I did
- **`96-slop-app.js`, publishing:**
  - `slopAppPublish(preview, replace)`: check; refuse when the page is a different kind or comes from another design; refuse route collisions; save the design; compile; push (create, or `base`; `moveMain: false` for a preview); put the screen routes (skipping routes that are already right); delete this page's routes that no screen has any more.
  - `slopAppReplaceSheet`: the confirmation for a hand-written `main`.
- **`96-slop-app.js`, settings:**
  - `slopAppAssignPaths`: the first time, `/` for the flow start, slugs for the rest;
  - `slopAppSheet`: page id, host, base path, data sources;
  - `slopAppRun`: toasts; a preview opens `<publicUrl>/watch/<page>/<n>`.
- **`96-slop-app.js`, the Prototype tab.** `protoPanel` is wrapped in tool mode to add:
  - **App** (nothing selected): screens with their URLs, errors and warnings, Preview, Publish app, the live link;
  - **Page path** (top-level frame): path field, full URL, and the "Shows a record of" select;
  - **Repeat** (frame inside a screen): source, sort, at most;
  - **Image from data** (image fill);
  - **Data** (text): placeholder hint with the source's field names, read from its records.
- **`95-slop-ui.js`:** slop menu items Make this an app… / App settings…, Preview app, Publish app. Publish prototype's icon is now `presentation`.
- **`slop/build.js`:** the tool asks for `versions:read` and `routes:read` as well.
- **Workshop:**
  - `pinupDesign` and `pinupPath` in `WatchRight.tsx`;
  - **Edit in Pinup** in `PageToolbar`;
  - **Open in Pinup** on `type: pinup` data artifacts in `WatchScreen.tsx`.
- **Server:** `compiledWarning` in `pkg/server/kernel.go`, with `TestPushWarnsOnPinupPages`.
- **Help:** a "Pinup apps" section in `pkg/doc/topics/pinup.md` covering the fields, the placeholders, and the ownership rule.
- **End to end:**
  - binaries `slop8`, `slop9`, `slop10` (`GOWORK=off go generate ./pkg/web && go build -tags embed`);
  - `make pinup-push SLOP=…`: Pinup v3, v4 and v5, each updated in the Workshop (screenshot `s5-01`: the dialog marks `versions:read` and `routes:read` as **new**);
  - `slop push $S/data-runs -a data-runs --kind data --type records --project play` (4 runs);
  - the app flow, screenshots `s5-02`…`s5-11`.

### Why
- **Routes are written only when they differ.** Republishing an unchanged app adds nothing to the route log. The second publish logged exactly `/pace-club/top` (added) and `/pace-club/leaderboard` (removed).
- **Collisions are checked before the design is saved and before anything is pushed,** so a refused publish leaves no trace. Verified: page still v2, design still v3, `/` still points at `storefront`.
- **The placeholders came in as an agent step, on purpose.** It is the realistic way an agent edits a design. It also showed that instance overrides (`ov`) can carry placeholders: the repeat clones the instance, and each copy fills its own `{{title}}`.

### What worked
- **Site responses:**
  - `/pace-club`, `/pace-club/home`, `/pace-club/runs/sunrise-5k`, `/pace-club/leaderboard` → 200; `/pace-club/other` → 404.
  - Titles: `Welcome · Pace Club`, `Home · Pace Club`, `Hill Repeats · Pace Club`.
  - Home's cards come out in date order: `/pace-club/runs/sunrise-5k`, `track-tuesday`, `hill-repeats`, `long-run`.
  - Back from a run → `/pace-club/home`.
  - No page errors on the site pages.
- **Collision:** with base `/`, "Publish failed: / is routed to storefront. Change the paths or the base path, or move those routes first."
- **Rename:** Leaderboard `/leaderboard` → `/top` → "Published pace-club v3 … · removed /pace-club/leaderboard". The route log entries carry `via tool pinup@3` and the note `Pinup app design-pace-club…`.
- **Hand push:** `slop push $S/hand -a pace-club` printed `warning: pace-club is compiled from the Pinup design design-pace-club; this version is not, …`. The next Publish app opened "Replace a hand-written version?" (`s5-10`), and Replace published `pace-club v6`.
- **Workshop:** Edit in Pinup (on `/watch/pace-club`) and Open in Pinup (on `/watch/design-pace-club`) both land on `/tools/pinup?file=design-pace-club`.
- **Checks:** `make lint` 0; `go test ./...` 0; Postgres (`TEST_DATABASE_URL=…:55432`) `pkg/server` and `pkg/store` ok; `tsc --noEmit` 0; `slop/tests/app.js` all passed; upstream `dist/pinup.html` sha256 still `531ef701b5c1417e`.

### What didn't work
- **The warning and the publish code disagreed.** The first warning text said "the next Publish app in Pinup replaces this version", while `slopAppPublish` refused any page whose `main` manifest lacked `pinup`. The refusal then told the user to "set its main back to a Pinup version in the Workshop", which the Workshop cannot do: there is no set-main action (`grep` found none in `web/workshop/src` or `pkg/server/kernel.go`). Fix in `7e012b5`:
  - a hand-written `main` over a page that has Pinup versions from this design → confirmation sheet, then publish;
  - a page with no version from this design → refused;
  - a page compiled from a different design → refused.
  The warning and help now say Publish app *asks*.
- **The "At most" field showed `items0 items`.** `numField`'s label and suffix were both "items". Now the label is `≤`, the title reads "At most this many records (0 shows all)", and the aria label is "At most".
- **"Record source" timed out while I drove the page** (`locator.selectOption: Timeout 30000ms exceeded … getByLabel('Record source')`). Pinup defers re-rendering the inspector while a text field has focus (`renderInspector`, `INSP.pending`). The path was saved, but the record select appears only after the field loses focus; pressing Tab fixed the run. A person tabs or clicks away, so I left it.
- **Wrapping the cards made them narrow.** ⇧A (`wrapSelection('autolayout')`) creates a hug-width frame, so the cards shrank to 291 px. I set the list and the cards to Fill width in the Design tab, which is the designer's job and not a compiler bug.
- **Tooling gaps, worked around:**
  - `slop docs ls` prints a table without document data, so I read layers with `GET /api/docs/design-pace-club?prefix=nodes/` through a small token script (`$S/api.sh`);
  - there is no CLI command to enable a tool (`unknown command "tools"`), so I used the Workshop dialog.

### What I learned
- The tool-update dialog already marks new permissions, so asking for `versions:read` and `routes:read` cost the admin one visible approval.
- A preview of a new page creates the artifact with `main` 0 (`Store.Push` sets `main` only when `MoveMain`). The page then exists but nothing serves it until the first Publish.
- Republishing with no design change reuses the design version ("Nothing changed since v3"), so `manifest.pinup.version` stays 3 across page versions v1, v2 and v3.

### What was tricky to build
- **Deciding who owns a page,** using only manifests:
  - the current `main`'s `pinup.design` says who compiled it;
  - when it is missing, whether any earlier version has this design's `pinup` key tells "changed by hand" apart from "someone else's page".
  That takes one extra `GET …/versions` in the rare case.

### What warrants a second pair of eyes
- **The `routes:write` reach.** Pinup can remove routes. The filter is `x.page === app.page` on `app.host`, and the paths come from `GET /api/routes?host=`. A different page that happens to have the same id as `app.page` is protected by the ownership check that runs before any route change.
- **No re-check before pushing.** The design version is saved and the page pushed even when a route `PUT` fails later. The page then has a new `main` that some routes may not serve yet, and retrying Publish app completes it.

### What should be done in the future
- A Workshop or CLI action to set `main` to an earlier version. It would also make "roll back an app" possible.
- `slop docs ls --data`, or JSON output with data, for agents.
- Self-hosted fonts, breakpoints, and the no-JS server-side screen choice (guide §12).
- Deploy: new image, `make pinup-push` on the cluster, update the tool.

### Code review instructions
- `web/pinup/slop/js/96-slop-app.js`: `slopAppPublish`, `slopAppSections`, `slopAppSheet`.
- `pkg/server/kernel.go` `compiledWarning`, and `TestPushWarnsOnPinupPages`.
- `web/workshop/src/components/organisms/WatchRight.tsx` (`pinupDesign`, `pinupPath`).
- Validate: `make lint && go test ./... && (cd web/workshop && npx tsc --noEmit -p .) && (cd web/pinup && node slop/build.js && node slop/tests/app.js)`.

### Technical details
- Route body: `{host, path, page, version: null, access: 'public', bindings: {}, note: 'Pinup app <design>'}`. Removal: `DELETE /api/routes?host=&path=&note=…`.
- App page versions on the local server:
  - v1: preview, not main;
  - v2, v3: published;
  - v4, v5: hand pushes;
  - v6: published again after "Replace with the design".
- Screenshots:
  - `s5-01` update dialog;
  - `s5-02` Make this an app;
  - `s5-03` Repeat section;
  - `s5-04` Data fields;
  - `s5-05` Preview in the Workshop;
  - `s5-06` App section after publish;
  - `s5-07` site Welcome;
  - `s5-08` site Home with data;
  - `s5-09` site Run detail;
  - `s5-10` replace sheet;
  - `s5-11` Workshop Edit in Pinup.

## Correction (2026-10-29, while writing the SLOP-006 vault report)

Step 2 says the compiled page carries "a 3 KB runtime". That was an estimate, not a measurement. Measured on the compiled test page at `f5e8662`, `slopAppRuntime` is 9,541 bytes. The SLOP-006 sanitizer and filters account for part of that.
