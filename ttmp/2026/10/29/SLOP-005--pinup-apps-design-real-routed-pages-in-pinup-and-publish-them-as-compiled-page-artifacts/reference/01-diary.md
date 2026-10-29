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
