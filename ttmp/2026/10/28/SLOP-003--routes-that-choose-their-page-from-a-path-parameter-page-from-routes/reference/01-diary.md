---
Title: Diary
Ticket: SLOP-003
Status: active
Topics:
    - routing
    - architecture
    - backend
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological implementation diary for SLOP-003: page-from routes."
LastUpdated: 2026-10-28T20:01:17.638208354-04:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Record, step by step, how SLOP-003 was designed and built: routes that choose their page artifact from a path parameter. Include the evidence, the failures and the review notes.

## Step 1: Why the import needed 100 routes, and the design that removes them

The question came while I was finishing the SLOP-002 admin how-to. I first read the routing code end to end: `pkg/routing`, `serveSite` and `serveSandbox` in `pkg/server/serve.go`, `pkg/store/routes.go`, the route API in `kernel.go` and `preview.go`, the CLI in `cmd/slop/cmds/routes.go`, and the Workshop's Routes and Site screens. I also re-read the storefront agent's NOTES (§4–§8, §14). The gap is exact: a route's `record` can be chosen by a parameter, but its `page` is fixed when the route is written. So the francois import, which has one page artifact per release, needed one route per release.

I opened SLOP-003, wrote the intern guide (`design-doc/01-…`) and uploaded it to reMarkable. The design is a `pageFrom` template on the route (`{page}`), limited to the project of the route's own page. That page also serves as the 404 "else" page. Resolution stays server-side, so no JavaScript router is needed.

### Prompt Context
**User prompt (verbatim), 1:** "did we have to make individual pages for all artifacts, can we make wildcard / keyword matching cards?
  and if so, would we need some JS in the mix to handle the route -> render part?"
**User prompt (verbatim), 2:** "create a new docmgr ticket and a Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable.


Then implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)

Use the diary format from the skill, this is MANDATORY"
**Assistant interpretation:** Explain whether the 100 `/r/<page>` routes were necessary, design a wildcard route that picks its page from the URL, document the whole serving path for an intern, upload the guide, then build it.
**Inferred user intent:** Get rid of per-release routes so the catalogue scales and stays current, and leave a document that someone new can learn slop's routing from.
**Commit (code):** none yet (design only); the docs commit follows this entry.

### What I did
- Read `pkg/routing/routing.go` (Match, Specificity, Resolve), `pkg/server/serve.go` (serveSite :256, gates :279–316, relative assets :328–347, serveSandbox :386), `pkg/store/routes.go`, `002_kernel.sql:57` (`page … REFERENCES artifacts(id)`), `kernel.go:40-44,467-505`, `preview.go:62`, `cmd/slop/cmds/routes.go`, `pkg/seed/seed.go:66,196`, and `RoutesScreen.tsx`, `SiteScreen.tsx`, `types.ts:46`.
- Checked whether following `main` would change what is served. I joined the SLOP-002 `release-routes.tsv` pins with the local `refs` table (`name='main'`): `100 pinned; 100 equal to main`. The local server has 106 page artifacts in project `francois`.
- `docmgr vocab add --category topics --slug routing`, `docmgr ticket create-ticket --ticket SLOP-003 …`, and `docmgr doc add` for the design doc and this diary. Ten tasks added; task 1 is checked.
- Wrote the guide. Its 13 sections cover:
  - the host classes;
  - the nouns;
  - routes and matching;
  - the site request pipeline: boot data, `/_d/`, `/_v/`, relative assets, sandbox;
  - API and CLI tables;
  - the francois import;
  - the problem, and why JS can't fix it;
  - four options;
  - the design: model, semantics, validation, exposure, gates, resolution, an end-to-end trace, API and CLI;
  - the plan by file, the tests, the rollout, future work and a glossary.
- `remarquee upload bundle … --name "SLOP-003 Page-from routes intern guide" --remote-dir /ai/2026/10/28/SLOP-003` → `OK: uploaded SLOP-003 Page-from routes intern guide.pdf -> /ai/2026/10/28/SLOP-003`.

### Why
- **Keep `page` as an FK and add `page_from`.** A template can't live in `routes.page`, because the column references `artifacts(id)`, and dropping a foreign key in SQLite means rebuilding the table. Keeping the FK also gives a page-from route the two things it needs anyway: a scope (the page's project) and a page to show when nothing matches.
- **Server-side, not JS.** A public page can't fetch another page's HTML: `/_v/` returns 404 unless the page is routed. A JS router would also break boot data, relative assets and 404 status codes.
- **The template comes from the URL, not from the record (option D).** The URL already carries the page id. D would need data to be loaded before a page is chosen.

### What worked
- The pins-against-main check means the switch to one follow-`main` route changes nothing a visitor sees today.

### What didn't work
- My first query used guessed column names. The real names are `refs.n` and `project_id`, not `main_version` and `r.version`:
  - `ERROR:  column "main_version" does not exist`
  - `ERROR:  column r.version does not exist`
  
  Fixed by checking `\d refs`.
- The first guide draft named `POST /api/preview`. The real endpoint is `GET /api/sandbox-url` (`preview.go:14`), and I corrected it before uploading.

### What I learned
- `routing.Resolve` breaks ties between equal-specificity patterns by database order (`ORDER BY host, path`). That is the cause of the agent's silent shadowing in NOTES §7: `/apps/:id` sorts before `/apps/:slug`.
- Relative assets under a param route already work through the Referer fallback. `/r/style.css` from `/r/weft` resolves the Referer path, so the design only has to swap `versionOf(route)` for the new `target(res)`.

### What was tricky to build
- Gating. `/_v/` and `/_d/` both decide what is public by asking which pages are routed. A page-from route makes a whole set of pages routed, so both gates need an `admits(route, artifact)` rule. For `/_d/` that means a scan over the project's pages, done only after the static routes have failed to match.

### What warrants a second pair of eyes
- Exposure. `{page}` in project `francois` publishes every francois page at `/r/<id>`, including `storefront`, `storefront-entry` and the agent's `probe-media`. These are already public or harmless, but it's a publishing decision, so the guide's §8.4 makes it visible in the CLI echo, the list column and the Workshop.
- The cost of the `/_d/` fallthrough: one query per candidate page, on misses only.

### What should be done in the future
- Implement tasks 2–9. The rollout (task 10) waits for PR merges by the user.

### Code review instructions
- Read the guide, sections 8 and 9, then compare them with `pkg/server/serve.go:256-367`.

### Technical details
```
local check: join release-routes.tsv pins with refs(name=main) → 100 pinned; 100 equal to main
reMarkable: /ai/2026/10/28/SLOP-003/SLOP-003 Page-from routes intern guide.pdf
```
