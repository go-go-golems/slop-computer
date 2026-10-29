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
RelatedFiles: []
ExternalSources: []
Summary: "Chronological diary for SLOP-007: a live preview panel in Pinup that shows the compiled app page with real data beside the canvas."
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
