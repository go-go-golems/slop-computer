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

## Step 2: How share links and board creation actually work; guide corrected

The user asked how link sharing works, and said each person should be able to make several boards and share links to them separately. Reading the code showed two mistakes in step 1's guide:

- **Sharing already exists.** The live shell has a Share dialog for store owners, so §6.10 overstated the new machinery for sharing.
- **Creation generates ids.** A `createApp` mount creates a store with a generated id, so a URL is not a board's name, which §6.2 and §7.1 had assumed.

The guide was corrected in place: §3.2, the §5 gap table (R2 and R3), §6.1, §6.2 with a new §6.2.1 on many boards per person, §6.9, a rewritten §6.10, §7.1, and the M8 row and phase 4 in §8.

### Prompt Context
**User prompt (verbatim):** "how does the link sharing work, and each user shoudl be able to create multiple boards and shake links separately." then "iI guess update the current design guide"
**Assistant interpretation:** Explain share links from the code, make sure the design covers many boards per person with separate links, and update the guide.
**Inferred user intent:** Confidence that sharing and multiple boards work as expected before building.
**Commit (code):** none (documents only)

### What I did
- Read the link code:
  - `pkg/registry/links.go`: `CreateLink` stores a hash of a `k_` token, only for the levels view and interact. `RedeemLink` writes a grant `via=<link id>` and never lowers a level. `RevokeLink` deletes the grants with that `via`. `Links` counts uses.
  - `pkg/commands/access.go:115-160`: `link.new/ls/rm`, action `StoreOwner`.
  - `pkg/doors/pages/sitelinks.go`: `/_site/links`, revoke, redeem, guest claim.
  - `pkg/doors/pages/live.go`: routes `:210-213`; view opening with a link `:285-305`; `managed` requires owner `:487-501`.
  - `pkg/doors/pages/assets/shell.js`: `k` taken out of the address bar `:27-35`; the Share dialog `:150-198`.
- Read board creation:
  - `live.go:425-466`: `POST /_site/create {path}` → `CreateStore(Type, App)` with no id.
  - `pkg/kernel/kernel.go:152-157`: id `ids.Slug("s-", 8)`, owner the creator.
  - `shell.js:60-66, 96`: "Create a new one", then `location.assign(body.path)`.
  - `pkg/registry/stores.go:12`: the id pattern.
- Edited the guide in the sections named above. `docmgr doctor` passes.

### Why
- **Separate links per board follow from "a board is a store":** grants and links are per store. The guide now says so with a worked table.

### What worked
- The shell's Share dialog covers the owner's needs: everyone signed in or guests at a level, the people with access, links with a level (30 days), and revoking.

### What didn't work
- My first guide claimed that visiting `/pb/kitchen` creates a store `kitchen`. The code generates the id instead. Corrected.

### What I learned
- **A link is a way to obtain a grant,** not a standing key. After someone opens it, their grant (`via` the link) is what lets them in, and revoking the link deletes those grants at once.
- **Only owners see the Share dialog;** board admins who are not owners cannot share without a change to `managed`.

### What was tricky to build
- Choosing the home page's path: `/pb` next to the mount `/pb/:id` would depend on mount precedence for every board URL. `/boards` avoids the question.

### What warrants a second pair of eyes
- Whether board admins (not only owners) should share: M8 in the guide.

### What should be done in the future
- Re-upload the corrected guide (done as a new document, see below).

### Code review instructions
- Compare guide §6.10 with `pkg/registry/links.go` and `shell.js:150-198`; and §6.2 and §7.1 with `live.go:425-466` and `kernel.go:152-157`.

### Technical details
```
link:   links(id lnk_…, store, level view|interact, token_hash, created_by, expires_at, revoked_at)
redeem: grants(store, subject, level, via=lnk_…)   revoke: DELETE grants WHERE store=? AND via=?
create: POST /_site/create {path} → store s-xxxxxxxx (owner = creator) → 201 {store, path}
```
