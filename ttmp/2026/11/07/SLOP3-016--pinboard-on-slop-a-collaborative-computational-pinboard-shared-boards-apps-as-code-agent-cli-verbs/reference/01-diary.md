---
Title: Diary
Ticket: SLOP3-016
Status: active
Topics:
    - apps
    - collaboration
    - architecture
    - frontend
    - backend
    - agents
    - security
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-07T11:40:53.714007489-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The working record of SLOP3-016: turning the Pinboard prototype into a collaborative slop app, and the platform machinery that needs.

## Context

The prototype and its design document were downloaded by the user to `~/Downloads/Pinboard.zip` and `~/Downloads/Pinboard · API examples and wireframes.{md,html}` on 2026-11-07. Copies are in `sources/`.

## Step 1: Study the prototype and slop, and write the intern guide

This step reads the Pinboard prototype in full, its design document's 14 examples, and the slop pieces it would need. The prior art inside slop is Pinup and Blocks, the CLI's verb machinery and the runtime. The result is the intern guide `design-doc/01-…`: what exists, what is missing, a proposed architecture with five decision records, flows in pseudocode, seven phases and a test strategy. Nothing is implemented.

### Prompt Context
**User prompt (verbatim):** "Study the pinboard zip and md I downloaded in ~/Downloads (the last 2 files). How would I transform this into its slop.computer app so that multiple people can collaborate no a board / create multiple boards and share them / I can access it through a CLI (with js verbs maybe? mounted in the slop CLI) and my device login? THis might need new machinery both on the frontend and the backend, so consider that too. Create a new docmgr ticket for the analysis and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. The goal is to build kind of an interactive shareable computational pinboard / are.na thing, where multiple users can collaborate and build apps and such."
**Assistant interpretation:** An analysis and design guide only (no implementation), for making Pinboard a multi-user slop app with sharing and CLI access, including new platform machinery, uploaded to the reMarkable.
**Inferred user intent:** A plan precise enough that an intern can build it phase by phase.
**Commit (code):** none (documents only)

### What I did
- Extracted `Pinboard.zip` into a fresh scratch directory (untrusted input, nothing executed) and read all seven modules (`js/store.js` 225 lines, `dsl.js` 298, `render.js` 199, `board.js` 661, `apps.js` 313, `agent.js` 200, `main.js` 54).
- The downloaded `.md` turned out to be only the HTML document's table of contents. The examples are in the HTML's `<script type="text/x-src">` blocks; I extracted all 14 with Python's `re` and `html.unescape` to `sources/pinboard-api-examples-code.txt`.
- Read slop's pieces:
  - `doc/claude-apis/README.md` (Blocks and Pinup);
  - Pinup's `09-collab.js`, `14-log.js` and `02-store.js`;
  - `scripts/deploy-apps.sh` (the `createApp` mounts);
  - `pkg/doors/pages/live.go:443-460` (store creation; the creator is the owner);
  - `cmd/slop/cmds/root.go:49-64` (CLI commands from the verb table);
  - `extra.go` (`eval`, `call`);
  - `pkg/doors/actors/sample.go` (no tools in actors);
  - `web/runtime/src/sample.ts:70-71` (page tools, at most 16);
  - `limits.ts`, `db.ts`;
  - `pkg/apps/manifest.go:45` (the platform list);
  - `slop verbs` and the help of `store new`, `link new`, `docs set`, `docs query`, `import files`, `call`, `eval`.
- Created the ticket in a new worktree from `origin/main` (`8e01dca`), branch `task/slop3-016-pinboard`. Copied the prototype and the examples into `sources/`, and wrote the guide (about 7,700 words).

### Why
- **The guide copies Pinup's shape** (store per document, document per object, shared revertible log, presence): it is the slop app closest to Pinboard and already runs within slop's limits.
- **App commands are designed as a general platform feature, not a Pinboard binary:** the CLI's auth, output formats and the MCP door then serve every app.

### What worked
- The prototype is cleanly layered. Only `write()` and `PB.S` tie the mutation recorder to IndexedDB (`js/store.js:83-86, 93-170`), which is what makes the isomorphic core of guide §6.11 feasible.
- The page agent maps directly onto slop's page `sample` with tools; no platform change is needed for it.

### What didn't work
- `slop $c --help` in a loop failed with `unknown command "store new"`, because zsh does not split words in a quoted variable. `${=c}` fixed it.
- The first text extraction of the HTML found no example code: it was in `<script type="text/x-src">` elements, which the HTML-to-text pass skipped.

### What I learned
- **The design document is ahead of the code:** IR dependency edges, `ui.ref`, tiled layouts, paste handlers and strict state checks exist in the examples only (guide §4.6).
- **No existing machinery covers three needs:** listing a person's stores from a page, sharing from a page (`links.new` and `grants.rm` are not in the platform module), and app-defined CLI commands.

### What was tricky to build
- **Apps written by other collaborators:** the prototype evaluates app source with the whole `PB` in scope. On a shared board that code runs as each viewer. The guide makes it a decision record: admin-written versions, a per-viewer trust prompt, a narrowed scope first, and iframe isolation later.

### What warrants a second pair of eyes
- Decision 6.8 (the trust model) and 6.12 (app commands): both change the platform's surface.
- Whether viewers should run apps at all (guide §10, question 7).

### What should be done in the future
- Phase 0 of the plan: the prototype as a single-person board on slop.

### Code review instructions
- Read the guide's sections 3 and 6 first, then compare its claims with the referenced lines in `sources/pinboard-prototype/js/` and in slop.

### Technical details
```
prototype: 2,221 lines (index.html 61, style.css 210, js 1,950); 14 examples; 6 wireframe sheets
slop refs: live.go:443-460 createApp · root.go:49-64 CLI · actors/sample.go:42-106 · runtime sample.ts:70-71 · manifest.go:45 platform
```
