---
Title: Diary
Ticket: SLOP-007
Status: active
Topics:
    - tools
    - frontend
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/doc/topics/pinup.md
      Note: 'help: The live preview'
    - Path: repo://web/pinup/slop/js/96-slop-app.js
      Note: slopAppCompile inline mode, slopAppRows
    - Path: repo://web/pinup/slop/js/97-slop-preview.js
      Note: the live preview panel
    - Path: repo://web/pinup/slop/tests/app.js
      Note: browser test, SLOP-007 section
ExternalSources: []
Summary: 'Chronological diary for SLOP-007: a live preview panel in Pinup that shows the compiled app page with real data beside the canvas.'
LastUpdated: 2026-10-29T15:10:00-04:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Record how SLOP-007 was designed and built. SLOP-007 adds a panel in Pinup that compiles the app after every edit and shows the compiled page, with the data the server would inject, in a sandboxed iframe beside the canvas.

## Step 1: How a designer sees the page today, the design, the intern guide

The user asked whether Pinup can show a rendered preview. Today it cannot do so inside Pinup:

- **Preview app** pushes a version without moving `main` and opens the Workshop in another tab.
- **Publish app** puts the page on the site.
- **The canvas** shows `{{field}}` placeholders and sample repeat copies.

I offered a live panel as SLOP-007, and the user agreed. Before starting, they asked for a vault report on SLOP-005 and SLOP-006. That report is done and pushed (`031b9ac` in go-go-parc, plus a runtime-size correction in this repo's SLOP-005 diary, `2deae09`).

The design compiles in the browser and adds no server change. The panel calls `slopAppCompile` in a new inline-image mode. It loads each source's records (and `$site`) through the tool grant, and wraps the result in the same boot JSON plus `runtime.js` that `render.Inject` adds. It shows the page in an `allow-scripts`-only `srcdoc` iframe and rerenders, debounced, on every store change. The guide is `design-doc/01-intern-guide-the-live-preview-panel-in-pinup.md`, and it is uploaded to reMarkable.

### Prompt Context

- **User prompt (verbatim), 1:** "Is there a way to view rendered preview in pinup?"
- **User prompt (verbatim), 2:** "yes," (in reply to my offer: build the live preview panel as SLOP-007, with the same guide, diary and commits)
- **User prompt (verbatim), 3 (mid-turn):** "actually,  first, write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill). Commit and push the bsidian vault when done (go-go-parc vault)."
- **Standing instruction from SLOP-005/006 (verbatim):** "then implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)(diary format: MANDATORY)"
- **Assistant interpretation:** After the vault report, write the SLOP-007 ticket and guide, upload the guide, then implement the panel with commits and this diary.
- **Inferred user intent:** See the real page, with real data, while designing, without pushing versions or leaving Pinup.
- **Commit (code):** none yet (this step adds the ticket).

### What I did

- **Read the Pinup layout and stacking order** (`web/pinup/src/style.css`):
  - the `#app` grid (`248px minmax(0,1fr) 284px`, rows `44px minmax(0,1fr)`);
  - z-indexes: overlays ≤ 6, `#left`/`#right` 30 on narrow screens, `#present` 50, `.menu` 60, `.scrim` 70, `#toast` 80;
  - the CSS variables `--panel`, `--line`, `--ink`, `--muted`, `--shadow`, `--r`.
- **Read the store and canvas entry points:**
  - `commit` (`02-store.js:127`), `applyStates` (`:170`), `applyRemoteNode` (`:256`) and `applyRemoteFile` (`:264`);
  - `select` (`04-canvas.js:70`), `scheduleRender` (`03-render.js:269`), `boot` (`99-boot.js:78`);
  - `lsGet`/`lsSet` (`01-util.js:19`).
- **Read the server pieces the panel relies on:**
  - `serve.go:463`: sandbox hosts serve `/_slop/runtime.js`;
  - `preview.go:16`: `GET /api/artifacts/{id}/versions/main/records` accepts `main` and returns records with `src`;
  - `render.Inject` and `runtime.js`: the boot JSON shape.
- **Ticket:**
  - `docmgr ticket create-ticket --ticket SLOP-007 --title "Live preview in Pinup: the compiled app page with real data beside the canvas" --topics tools,frontend`, plus the design doc and this diary;
  - 12 tasks (task 1 checked);
  - `remarquee upload bundle …/01-intern-guide-the-live-preview-panel-in-pinup.md --name "SLOP-007 Live preview in Pinup intern guide" --remote-dir "/ai/2026/10/29/SLOP-007" --toc-depth 2 --non-interactive` → `OK: uploaded SLOP-007 Live preview in Pinup intern guide.pdf -> /ai/2026/10/29/SLOP-007`.

### Why

- **Compile in the browser rather than push preview versions.** A version per keystroke would fill the event log and the version list. The compiler is already a pure function of the design, and the two data endpoints already return what the server injects. Nothing is missing on the server side.
- **`srcdoc` plus `sandbox="allow-scripts"` and no `allow-same-origin`.** The tool holds an API grant in memory. A preview document with an opaque origin cannot reach it, even though it runs the same scripts as the published page.
- **Inline images.** Publish turns `data:` images into hashed files. A `srcdoc` document has nowhere to serve those files from, so the preview mode keeps the data URLs.
- **Wrap the four store functions, not `scheduleRender`.** `scheduleRender` also fires on hover and selection redraws, which would recompile for no reason.

### What worked

- No server change was needed. Every piece (the compiler, the records and site endpoints, `runtime.js` on sandbox hosts) already exists.

### What didn't work

- Nothing failed in this step.

### What I learned

- A `srcdoc` document resolves relative URLs against the parent's URL unless it has a `<base>`. Image URLs from data records (`/_d/<artifact>/<n>/<path>`) are relative, so the preview sets `<base href>` to the site host.
- `/_d/` serves files only for data artifacts that some public route reads. Images of an unpublished app's data may therefore not load in the preview. This is noted as a risk in guide §6.

### What was tricky to build

- **Stale renders.** A slow data load or compile must not overwrite a newer render. Each render gets a sequence number, and a render whose number is no longer the latest drops its result.

### What warrants a second pair of eyes

- Guide §3.4: the message protocol and the `event.source` check.

### What should be done in the future

- Implement tasks 2–12.

### Code review instructions

- Read guide §1.3 (sandboxing) and §3 (design).

## Step 2: The panel, the compiler's inline mode, and the browser test

This step built the panel as `web/pinup/slop/js/97-slop-preview.js`. Three supporting changes went with it:

- `slopAppCompile` gained `opts.inline`, which keeps `data:` images in the CSS.
- `slopAppRows(id, host)` is the one loader for "the rows a source gives the page", now shared with the Prototype tab's field list.
- The slop menu has a *Live preview* item.

The browser test (`slop/tests/app.js`) gained 29 checks and passed on its first run. I did not trust that, so I ran two mutation checks; both made the expected checks fail.

The first build failed on a name clash (below). The other notable fix was a selection bug I found while writing the test plan: Pinup re-selects the same layers in places, and following every `select` would have pulled the preview back to the selected screen after a link click.

### Prompt Context

- **User prompt (verbatim):** see Step 1 (the standing instruction to implement with commits and a diary).
- **Assistant interpretation:** Implement guide §3 and test it in the existing Playwright harness.
- **Inferred user intent:** A working panel, with evidence that it works.
- **Commit (code):** `3dee0ab` — "Pinup: live preview panel — the compiled app page with real data beside the canvas".

### What I did

- **`96-slop-app.js`:**
  - `slopAppCompile(chk, designVersion, opts = {})`: `if (!opts.inline) trees.forEach(collect)`, so nothing is collected and nothing is renamed;
  - `slopAppRows(id, host)`: `$site` → `GET /site?host=`, other `$…` → `[]`, else `GET /artifacts/{id}`, then `/versions/{main}/records`;
  - `slopAppFields` now calls `slopAppRows`.
- **`97-slop-preview.js` (367 lines):**
  - **State and panel:** state `LP`; CSS scoped to `#slopPreview` (z-index 40, `resize: both`); a draggable header (pointer capture; iframes ignore pointers while moving); geometry and device width saved in `localStorage` under `pinup.slop.preview`.
  - **Header controls:** device segment 390, 768 and 1280; reload data; open on the site; close.
  - **Navigation row:** Back, Screen select, and a Record select for record screens.
  - **Rendering:** `lpRender` checks with `slopAppCheck`. It loads data (`lpLoad`, cached per `[host, app.data]`) and `runtime.js` (`fetch('/_slop/runtime.js')`, with a shim fallback), then compiles inline and builds the boot JSON with `mode: 'preview'`. A sequence number drops stale renders.
  - **Document:** `lpDocument` inserts `<base href>`, the boot JSON with `<` escaped, `runtime.js`, and the bridge after `<head>`, using a replacement *function* so `$&` in the page cannot be expanded.
  - **Swap:** `lpSwap` loads a hidden `sandbox="allow-scripts"` srcdoc iframe over the old one and swaps it in on `ready` or `load`.
  - **Bridge** (`lpBridge`, copied as source): restores scroll, reports scroll, posts `ready`, and captures every link click (`preventDefault` plus `stopImmediatePropagation` in the capture phase, before the runtime's Back handler). `#` links scroll in place.
  - **Message handler:** accepts only messages whose `e.source` is the current or pending frame's `contentWindow`. Navigation is honoured only from the visible frame.
  - **Navigation:** `lpMatch` mirrors the runtime's matcher and specificity. A link into the app pushes history and moves the preview. Any other `/…` link opens `<proto>//<host><href>`, and http(s) or mailto links open as they are.
  - **Hooks:** `commit`, `applyRemoteNode` and `applyRemoteFile` → `lpSoon()` (350 ms); `select` → `lpFollow()` when the selection changed; `onLoaded` reopens the panel if it was open; `boot` adds `#bPreview` (icon `app-window`) before `#bSlop`.
- **`95-slop-ui.js`:** a menu item, *Live preview* / *Hide live preview*.
- **`slop/tests/app.js`:**
  - moved the Pace design setup into `paceDesign(png)`, which runs in the page through `page.evaluate(paceDesign, PNG)`;
  - added the SLOP-007 section: a stub `SLOP.api.get` serving `data-runs` fixtures, a stub `window.open`, and `LP.runtime` set to the real `runtime.js`;
  - `lpFrame(want)` polls the visible iframe's `contentFrame()` (Playwright reaches opaque-origin frames).
- **Ran:** `node slop/build.js && NODE_PATH=$S/pw/node_modules PW_CHROMIUM=… node -r $S/pw/use-cached.js slop/tests/app.js` → `all passed` (37 existing + 29 new).
- **Mutation checks** (edited with exact text replacement, restored the same way):
  1. Follow on every `select` (guard removed) → `FAIL an edit shows up in the preview, on the same screen` (the preview jumped to `Harbour 10K`) and `FAIL a compile error is shown and the last page stays`.
  2. `sandbox: 'allow-scripts allow-same-origin'` → `FAIL the preview frame may run scripts and nothing else` and `FAIL the preview cannot reach Pinup’s document — "reached"`.
  3. Restored → `all passed`.

### Why

- **An opaque origin rather than a separate host.** A sandbox subdomain per preview would need server work and a version to serve. `srcdoc` with `allow-scripts` gives isolation at no cost, and `postMessage` is the only channel.
- **`LP.at = {id, params}` instead of a path.** Renaming a screen's route while the panel shows it should keep that screen on show.
- **Store hooks outside tool mode.** The test harness has no grant (`SLOP.mode` is null). The hooks only schedule work while `LP.open` is true, so local Pinup pays nothing.

### What worked

- The compiled page, `runtime.js` and the boot JSON combine without changes: the runtime's preview fallbacks (start screen, first record) apply unchanged.
- Playwright's `elementHandle.contentFrame()` evaluates inside the opaque-origin srcdoc frame, so the test can read what the visitor would see.

### What didn't work

- **First build:**

  ```text
  node -e "new Function(require('fs').readFileSync('dist/slop-check.js','utf8'))"
  SyntaxError: Identifier 'PV' has already been declared
  ```

  Pinup's Present mode (`src/06-proto.js`) owns `PV` and `pvBack`, `pvFit`, `pvClose`, `pvFlow`, `pvScale`, `pvName` and `pvComment`. I renamed everything to `LP`/`lp*` with word-boundary regexes and checked that no `LP` or `lp[A-Z]` name existed before.
- **A first draft of the test had two nonsense lines.** It patched `href` on the list screen's root and waited on a condition that was always true. I replaced them with one patch before running anything.

### What I learned

- `applyStates` (undo and redo) calls `commit`, so wrapping `commit` covers history moves.
- `select` returns early when the selection is unchanged, but a wrapper still runs after it. Wrappers of early-returning functions need their own "did anything change" check.

### What was tricky to build

- **Ordering the bridge against the app runtime.** The runtime adds its own click handler for `data-back` links, which calls `history.back()`. In a srcdoc frame, that would navigate the frame's history. The bridge registers on `window` in the capture phase and calls `stopImmediatePropagation`, so it sees every link click first. Then `lpNavigate` treats `back` as "pop the preview's own history", or follows the link's `href` (the app's base) when there is none.
- **Stale work in two places.** A render can be overtaken while it awaits data or the compiler (`seq`), and a frame can be overtaken while it loads (`LP.next !== f`). Each check guards its own window.

### What warrants a second pair of eyes

- **The message handler.** It accepts only `e.source` equal to one of our two frames and ignores everything else. `tool.js` checks `e.origin === PARENT && e.source === window.parent`, so the two listeners cannot answer each other's messages.
- **`lpDocument` runs `runtime.js` text inline.** It escapes `</script` and uses a function replacement. The bridge's source is ours.

### What should be done in the future

- Showing data on the canvas itself (out of scope, see guide §6).

### Code review instructions

- **Start in** `web/pinup/slop/js/97-slop-preview.js`: `lpRender`, `lpDocument`, `lpSwap`, the `message` listener, then the hooks at the bottom.
- **Validate:** from `web/pinup`, `node slop/build.js && node slop/tests/app.js` (needs Playwright; see the command above).

## Step 3: End to end on the local server, docs, as-built notes

I pushed the build to the local slop server as Pinup v9, enabled it in the Workshop, and drove the panel on both local apps: Site map (`$site` plus the journal) and Pace Club (data-runs). The panel showed every case the browser test covers, and two the test cannot:

- **Real `$site` and record data:** 242 site rows and 8 posts.
- **An agent's inbox step** appearing in the open preview.

The Workshop console had no errors or warnings. I documented the panel in `slop help pinup` and added an as-built section to the guide.

### Prompt Context

- **User prompt (verbatim):** see Step 1.
- **Assistant interpretation:** Prove the panel in the real tool, document it, and record the differences from the guide.
- **Inferred user intent:** Something they can use now in the local Workshop.
- **Commit (code):** `3dee0ab` (the panel). This step adds docs and ticket files only.

### What I did

- **Pushed and enabled the build:**
  - `$S/slop12 push web/pinup/dist/slop -a pinup -m "SLOP-007: live preview panel"` → `pushed pinup v9 · 1 files · 793 KB`;
  - `PUT /api/tools/pinup` from the page → `403 csrf_failed` (it needs the Workshop's CSRF token);
  - so I used Workshop → Tools → *pinup v9* → *Update to v9…* → *Update to v9*. The header then read `enabled v9`.
- **Site map** (`/tools/pinup?file=design-site-map`), after clicking `#bPreview`:
  - footer `/site-map · compiled 11:53:09 AM · pages 242 · posts 8`;
  - a click on `/journal/pages-and-data` inside the preview opened a new tab at `http://site.localhost:18120/journal/pages-and-data` ("Pages and data · slop.boutique"), and the Workshop stayed on the tool;
  - Screen → *Read* listed the 8 posts in the Record select; picking *Notes on Orbits* gave title `Notes on Orbits · Site map`, path `/site-map/read/orbits-notes`, rich text present;
  - the Read screen's "← Everything on this site" link (`href="/site-map"`) moved the preview to the Site map screen and enabled Back;
  - an agent-style step, `slop docs put design-site-map inbox/s7e2e step.json` (`update durFxQWrHL text "The whole site, live"`), showed in the open preview at the first poll (70 ms after the poll started). A second step (`inbox/s7e2e-back`) restored "Everything on this site" (checked with `GET /api/docs/design-site-map/nodes/durFxQWrHL`), and the inbox was empty afterwards.
- **Pace Club** (`?file=design-pace-club`):
  - the panel reopened by itself (`#bPreview` `aria-pressed="true"`), with footer `/pace-club · compiled … · runs 4`;
  - Welcome → `/pace-club/home` → `/pace-club/runs/sunrise-5k` by clicking links inside the preview; the Record select followed to `sunrise-5k`;
  - `browser_console_messages(level: warning)` → `Total messages: 0`.
- **Screenshots** (`various/`):
  - `s7-01-site-map-preview.png` (phone);
  - `s7-02-agent-step-desktop.png` (desktop width, scaled, after the agent's step);
  - `s7-03-read-record.png` (record screen with Record select);
  - `s7-04-pace-club-run.png`.
- **Docs:** `pkg/doc/topics/pinup.md`, a "The live preview" paragraph. Before writing its last sentence, I checked the `/_d/` gate in `serve.go:356` (a data file is served only when a public route's page reads the artifact).
- **Guide:** §8 "As built" (the table of differences).

### Why

- **Use the Workshop dialog rather than the API.** Enabling a tool version is an admin action guarded by session plus CSRF, deliberately not reachable with a token.

### What worked

- Everything in the Prompt Context worked against real data, with no server change.

### What didn't work

- `PUT /api/tools/pinup` with `fetch` from the Workshop page → `403 {"error":{"code":"csrf_failed","message":"Missing or invalid CSRF token"}}`. The dialog worked.

### What I learned

- An inbox step is applied by the open tab through `commit`, so the preview picks it up through the `commit` hook. A direct `nodes/` write from another tab would arrive through `applyRemoteNode`, which is hooked too.
- At phone width, the Site map design clips its 72 px title ("Everything on thi…"). The design is desktop-only, and the published page does the same at that width. The panel makes that visible while designing.

### What was tricky to build

- Nothing new in this step. The Workshop's tool frame is found by its sandbox URL, and the preview frame is a child of that frame. Playwright reaches both through `frames()` and `contentFrame()`.

### What warrants a second pair of eyes

- The help text's claim that images of unpublished data do not load. It follows from `serve.go:356–372`.

### What should be done in the future

- Deploy: `make pinup-push` on the cluster and update the tool there (the same open item as SLOP-005 and SLOP-006).
- The Site map design could use auto-layout text widths so it reads on phones.

### Code review instructions

- Look at the four screenshots in `various/`.
- Reproduce: open a Pinup app design in the Workshop and click the window icon left of *slop*.
