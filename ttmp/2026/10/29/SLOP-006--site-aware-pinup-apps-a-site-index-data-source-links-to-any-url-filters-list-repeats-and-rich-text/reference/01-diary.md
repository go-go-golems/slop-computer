---
Title: Diary
Ticket: SLOP-006
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
Summary: "Chronological diary for SLOP-006: site-aware Pinup apps ($site, URL links, filters, list repeats, rich text)."
LastUpdated: 2026-10-29T11:10:18.699322949-04:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Record how SLOP-006 was designed and built: a `$site` data source that lists a host's public URLs, plus links to any URL, repeat filters, list-field repeats and rich text in Pinup apps, so a Pinup app can navigate the site.

## Step 1: What pages can see today, the design, the intern guide

The user asked whether Pinup pages can read and show artifacts and other slop data, so that apps can navigate the site. I checked what a page can read. A Pinup app reads only data artifacts through `reads`. The server adds `$tokens` and nothing else: no artifacts, routes or projects. The storefront at `/` lists apps because the francois import wrote a curated data artifact (`francois-catalog`, 104 records) that the storefront page reads.

The design adds a server-built `$site` source and four Pinup features. It is written up as the intern guide (`design-doc/01-intern-guide-site-aware-pinup-apps.md`) and uploaded to reMarkable.

### Prompt Context
**User prompt (verbatim), 1:** "can the pinup pages access and display artifact and other slop.yolo data, to make apps to actually navigate the site?"
**User prompt (verbatim), 2:** "Create new docmgr ticket and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**User prompt (verbatim), 3 (mid-turn):** "then implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)(diary format: MANDATORY)"
**Assistant interpretation:** Write the ticket and guide for site-aware Pinup apps, upload it, then implement it with commits and this diary.
**Inferred user intent:** Pinup apps that are the site's navigation (home page, indexes, catalogues) and link to real pages.
**Commit (code):** none yet (this step adds the ticket).

### What I did
- **Read** `pkg/server/serve.go`:
  - `bindings`, `renderPage` and `records` (the `$tokens` special case);
  - `admits`, `target`, `pageFromReads` and `serveSite` (public routes only);
  - the `publish` hook in `server.go:101`.
- **Read** `pkg/routing/routing.go` (`Resolve`, `TemplateMatcher`, `fill`), `pkg/store/events.go` (event types), and `pkg/store/artifacts.go` (`Artifact`, `Artifacts(project)`).
- **Workshop:** read where route `data` is shown (`RoutesScreen.tsx:72`, `:150`) and used for preview samples (`WatchRight.tsx:20`).
- **Local data:** listed the routes on `site.localhost:18120` (20 routes: static, record routes `/journal/:slug` and `/apps/:id`, page-from `/r/:page`, fallback `*`) and the storefront manifest (`reads: catalog, media, media2, media3`).
- **Ticket:**
  - `docmgr ticket create-ticket --ticket SLOP-006 …`, plus the design doc and this diary;
  - 12 tasks;
  - `remarquee upload bundle … --name "SLOP-006 Site-aware Pinup apps intern guide" --remote-dir /ai/2026/10/29/SLOP-006` → `OK: uploaded SLOP-006 Site-aware Pinup apps intern guide.pdf -> /ai/2026/10/29/SLOP-006`.

### Why
- **A virtual source, not a generated data artifact.** A data artifact rewritten after every route change would add a version per change and fill the event log. `$token`-style resolution at render time, with a per-host cache invalidated in `publish`, has no storage cost.
- **Enumerate concrete URLs, not route patterns.** A navigator needs links, and slop already knows how to turn record routes (records matching the pattern) and page-from routes (admitted project pages) into URLs.
- **`href` is a separate node field from Pinup's `link`.** Pinup's player and canvas arrows treat `link.to` as a frame id, so a URL there would confuse upstream code.

### What worked
- The design reuses existing pieces: `records` and its cache, `admits`, `TemplateMatcher`, `Resolve` (for the shadowing check), and `publish` as the single invalidation point.

### What didn't work
- **A wrong help-topic name in the uploaded guide.** It referred to `slop help pages`, which does not exist (`ls pkg/doc/topics/` → `agents.md pinup.md`). The ticket copy now says `slop help agents`; the reMarkable copy still has the old line.

### What I learned
- The local data has two routes with the same pattern shape and specificity (`/apps/:id` and `/apps/:slug`). Only one of them serves `/apps/x`, so the index has to check each URL against `Resolve`.
- The francois catalogue marks entries `visibility: hidden`. An index of every record-route URL would make those discoverable, hence the unlisted rules (`draft`, `listed`, `hidden`, `visibility`).

### What was tricky to build
- **Exposure.** The index only lists URLs a visitor can already open, but it changes them from guessable to listed. The rules have to be explicit and documented, and private routes, the fallback, and a page-from route's else page are never listed.

### What warrants a second pair of eyes
- The unlisted conventions in guide §3.5: are `visibility`, `draft`, `listed` and `hidden` the right set?

### What should be done in the future
- Implement (tasks 2–12).

### Code review instructions
- Read guide §3 (server) and §4 (Pinup).

### Technical details
- Record shape: `{id=path, path, title, kind: page|record|project-page, route, page, project, projectName, section, depth, updated, record?}`.
- Cache: per host, generation bumped in `publish` on route, ref, version, artifact or project events, with a 30-second ceiling.
