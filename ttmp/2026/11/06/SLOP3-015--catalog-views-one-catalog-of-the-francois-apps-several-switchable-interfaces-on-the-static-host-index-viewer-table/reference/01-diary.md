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
