---
Title: Diary
Ticket: SLOP-001
Status: active
Topics:
    - backend
    - frontend
    - auth
    - architecture
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological implementation diary for SLOP-001: analysis, design revisions with the owner, and phase-by-phase implementation of slop.computer v1."
LastUpdated: 2026-10-28T16:30:00-04:00
WhatFor: "Tracing how the v1 design was derived and how each phase was implemented and validated."
WhenToUse: "When resuming SLOP-001, reviewing a commit, or questioning a decision in the design doc."
---

# Diary

## Goal

Record, step by step, how slop.computer v1 is designed and built: francois's backend cut down to admins, a new artifact/version/route/comment kernel, local mode with SQLite and nicknames, tools, and the Workshop UI in React + RTK Query.

> Format note (2026-10-28, step 9): Steps 1–8 were first written in a free-form style. At the owner's request ("IT'S MANDATORY to follow the diary skill format at each point") they were rewritten into the diary skill's investigation format from the same facts. No evidence was added or removed.

## Step 1: Gather sources for the analysis

I started from an almost empty repository and needed the three inputs the owner named: the Directions brainstorm, the Workshop prototype and the francois backend. I read the Directions document in full, unpacked both zips into the session scratchpad, and copied the Directions doc and the Workshop prototype into the ticket so the guide could cite stable paths.

The Workshop zip turned out to be the same code as direction A in the workspace zip, so the workspace zip was only skimmed; the Desk, CC5, Shop Next and the transcripts were not read because the Desk is out of scope.

### Prompt Context
**User prompt (verbatim):** "Create a new docmgr ticket to implement a new version of slop-computer, by taking the backend of francois and killing all the membership stuff and just keeping the API and admin users parts (code is in ../francois, feel free to literally `cp` stuff over) And add the slop.computer workshop UI (for now, we will add the Desk later on), see @~/Downloads/slop.computer Directions.md  and @~/Downloads/slop.computer Workshop.zip  and @~/Downloads/slop-computer-workspace.zip  (Which has the desk and all entire workspace, so it might be a bit too much).

Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable.

Then give me an overview in your own words of what we are going to build, and stop so I can validate."
**Assistant interpretation:** Analysis and design only: create a docmgr ticket, write an intern-ready guide, upload it to reMarkable, summarise, then stop for validation.
**Inferred user intent:** Validate the shape of slop.computer v1 before any code is written.
**Commit (code):** none (analysis only)

### What I did
- Checked repository state: worktree on `task/slop-computer`, only `ttmp/` and `.ttmp.yaml`, commit `158845d`. Sibling `../francois` at `106776a`.
- Read `~/Downloads/slop.computer Directions.md` (revision 2) and copied it to `sources/slop-computer-directions.md`.
- Unzipped `slop.computer Workshop.zip` (8 files, 2,927 lines) and `slop-computer-workspace.zip` (59 MB) into separate scratchpad directories; copied the Workshop to `sources/workshop/`.
- Read `api.js` and `render.js` fully, `agent.js` partly, `app.js` structure plus the admin screen and event wiring, and `seed.js` data shapes.

### Why
- The fake API in `api.js` is effectively the contract the real server must satisfy, so it had to be read completely.

### What worked
- `diff -rq` showed the Workshop zip equals `projects/slop-computer-a/` except for `index.html`'s document skeleton.

### What didn't work
- A first `cat … ; echo =====; …` failed with `(eval):3: ===== not found` because a line began with `=====`; rerun with `echo XXXXX` worked.

### What I learned
- The Directions doc studied francois at `ca05239`; the local checkout is at `106776a`. Differences were not reviewed.

### What was tricky to build
- N/A (reading only).

### What warrants a second pair of eyes
- Whether skipping the Desk/CC5/Shop Next sources missed something the core kernel needs.

### What should be done in the future
- N/A

### Code review instructions
- Compare `sources/workshop/` with the zip if provenance matters.

### Technical details
- Workshop files: `index.html` 14, `style.css` 285, `boutique-css.js` 359, `seed.js` 630, `api.js` 230, `render.js` 264, `agent.js` 125, `app.js` 1020 lines.

## Step 2: Map the francois backend

I surveyed francois's catalog server to decide what to keep: auth, sessions, tokens, device login, admin users and audit, blobs. I read the request guard, OIDC login/callback/logout, the migrations that define users, tokens and device authorizations, `UpsertIdentity`, and the hosted runtime's HTML injection.

The kept code turned out small and well isolated (~2.5k lines), while the dropped code (billing, storefront, instances, React portal) is most of the 20.7k lines.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Identify francois's API/admin-user parts precisely enough to cite them.
**Inferred user intent:** Copy only what slop.computer needs.
**Commit (code):** none

### What I did
- `find pkg -name '*.go' ! -name '*_test.go' | xargs wc -l | sort -n` (20,722 lines in `pkg/catalog`).
- Read `pkg/catalog/routes.go:21-135`, `auth.go` (guard 102-162, login/callback/logout 186-291), `store/migrations/{001,004,008,019}.sql`, `store/users.go:41-73`, `hosted/routes.go:166-222`, grep of `admin.go`, `tokens.go`, `device.go` route registrations.

### Why
- Every claim in the guide needed a file reference an intern can open.

### What worked
- `guard(level, scope, h)` already separates cookie sessions from bearer tokens and applies CSRF only to sessions; only levels and scope names need to change.

### What didn't work
- No failures observed.

### What I learned
- The role default lives in the migration (`subscriber`), not in Go.
- `releases.Blobs` is self-contained and reusable.
- The catalog store is pgx/Postgres-specific (arrays, `bytea`, advisory locks).

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Whether the device-login flow should keep its rate limiter in v1.

### What should be done in the future
- N/A

### Code review instructions
- Start at `../francois/pkg/catalog/auth.go:102`.

### Technical details
- Admin routes registered at `admin.go:23-49`; device routes at `device.go:29-33`; token routes at `tokens.go:17-25`.

## Step 3: Write the first design and deliver it

I wrote the intern guide (`design-doc/01-…`) with orientation, current state, gaps, schema, API reference, pseudocode, decision records D1–D7, phases, tests and open questions. Then I ran `docmgr doctor` and uploaded the guide plus diary to reMarkable, and gave the owner an overview.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Produce and deliver the guide, then stop.
**Inferred user intent:** A reviewable plan.
**Commit (code):** none

### What I did
- `docmgr ticket create-ticket --ticket SLOP-001 …`, `docmgr doc add` for the design doc and diary, added vocabulary topics `frontend`, `auth`, `architecture`.
- Wrote the guide; related files; `docmgr doctor --ticket SLOP-001 --stale-after 30`.
- `remarquee upload bundle … --name "SLOP-001 slop computer v1 intern guide" --remote-dir "/ai/2026/10/28/SLOP-001"`.

### Why
- Decision records make the choices (separate module, mirror store, embedded Workshop, sandbox origins, Postgres, two-step push, roles/scopes) reviewable.

### What worked
- Upload: `OK: uploaded SLOP-001 slop computer v1 intern guide.pdf -> /ai/2026/10/28/SLOP-001`.
- Doctor passed after fixing related-file paths.

### What didn't work
- `docmgr doctor` reported 15 `missing_related_file` warnings: RelatedFiles paths like `../francois/pkg/catalog/auth.go` and `sources/workshop/api.js` were resolved relative to the repository root. Fixed by rewriting them to absolute paths.

### What I learned
- docmgr resolves relative RelatedFiles against the repo root, not the document.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- Always pass absolute paths to `docmgr doc relate`.

### Code review instructions
- Read sections 1–3 of the guide first.

### Technical details
- Upload proves cloud delivery, not device sync.

## Step 4: Owner review — React, live deploy question

The owner accepted a separate copy and Postgres, chose React + RTK Query with atomic design, and asked for a Vite proxy and DB-based deployment so things can be worked on live. I rewrote §6.8 for React/RTKQ, added §6.11 describing the Workshop as a live "shell" artifact with guard rails, and uploaded a v2 PDF.

### Prompt Context
**User prompt (verbatim):** "1. yes, separate independent copy
2. react + rtkq, please. atoms molecules organisms. should be fairly simple. 
3. make it possible with vite proxy as well for quick iteration. use db for artifact deploy, so we can work on it live.
4. ok.

what does 3. switching to live work entail? The main goal for this is being able to iterate on pages live quickly without having to work on them through the normal deploy channel..."
**Assistant interpretation:** Update decisions; explain what serving the Workshop from the DB would require.
**Inferred user intent:** Fast live iteration without deploys.
**Commit (code):** none

### What I did
- Replaced §6.8 (component tree, `slopApi.ts`, event → tag invalidation), added §6.11 (shells, Try it/Promote, recovery), updated D1–D3, D5, phases, open questions, added §12.
- Uploaded `SLOP-001 slop computer v1 intern guide v2`.

### Why
- RTK Query's tag invalidation maps directly onto the server's event stream.

### What worked
- Upload OK; doctor passed.

### What didn't work
- No failures observed.

### What I learned
- "Use db for artifact deploy" was ambiguous between "the Workshop" and "artifacts" (clarified in Step 5).

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- §6.8 of the guide.

### Technical details
- N/A

## Step 5: Correction — Workshop embedded, only artifacts in the DB

The owner clarified that the Workshop should not go through the database. I reverted D3 to an embedded Workshop with a Vite proxy, removed the shell concept (`trust` column, overrides) and rewrote §6.11 as live iteration on artifacts (`slop push --watch`, `--no-main`).

### Prompt Context
**User prompt (verbatim):** "no the workshop should not be through the db actually. only the artifacts"
**Assistant interpretation:** Embed the Workshop; keep artifacts as the only DB-deployed content.
**Inferred user intent:** The core tool must stay stable.
**Commit (code):** none

### What I did
- Python section replacements in the guide; removed every `trust`/shell reference; doctor.

### Why
- Keeps pushed code off the main origin.

### What worked
- Doctor passed.

### What didn't work
- No failures observed.

### What I learned
- N/A

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- D3 and §6.11.

### Technical details
- N/A

## Step 6: Local mode and SQLite

The owner asked for a local mode without authentication but with nicknames, and SQLite instead of Postgres if possible. I confirmed feasibility from francois's own local store and designed one `database/sql` store for both databases plus a nickname identity provider.

### Prompt Context
**User prompt (verbatim):** "also make it possible to launch a local version of slop without needing authentication, but still being able to provide a nickname / identity (so we can test collaborative stuff locally too), and without requiring postgresql and instead using sqlite, if that's possible."
**Assistant interpretation:** Add `slop serve --local` with nickname sign-in and SQLite.
**Inferred user intent:** Test collaboration locally with zero setup.
**Commit (code):** none

### What I did
- Checked `../francois/pkg/store/store.go:29-48` (modernc sqlite, WAL, busy_timeout, one connection).
- Counted pgx-specific call sites: `grep -c` over users/sessions/tokens/device/store.go → 29+12+9+13+13.
- Added §6.2.1 (portability rules), §6.12 (local mode), revised D5, added D8, updated phases and tests.

### Why
- Everything after sign-in stays production code, so local tests exercise it.

### What worked
- Doctor passed.

### What didn't work
- No failures observed.

### What I learned
- The francois catalog store must be ported, not copied verbatim.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Local-mode guard rails (loopback-only, no override).

### What should be done in the future
- N/A

### Code review instructions
- §6.2.1, §6.12.

### Technical details
- `--local` defaults: sqlite `./var/slop.db`, blobs `./var/blobs`, listen `127.0.0.1:8080`, site `site.localhost:8080`, sandbox `sandbox.localhost:8080`.

## Step 7: Explaining shells with an example

The owner asked what the dropped shell would have done. I answered with a release-board example and the attack it enables (minting admin tokens with the viewer's session). No document changes were made in this step.

### Prompt Context
**User prompt (verbatim):** "what would the shell have done in : - I dropped the \"shell\" idea completely: no trust column, no running pushed code on slop.computer itself, no \"Try it\" or \"Promote\" steps. That also removes the security problem from my last answer, because pushed code can never act with your login.

?

show me an example."
**Assistant interpretation:** Explain the shell concept concretely.
**Inferred user intent:** Decide whether the capability matters.
**Commit (code):** none

### What I did
- Wrote the example in chat.

### Why
- N/A

### What worked
- N/A

### What didn't work
- No failures observed.

### What I learned
- The owner wants the capability (Step 8).

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- N/A

### Technical details
- N/A

## Step 8: Tools with limited permissions

The owner wants Ramon's release board, with the core Workshop still embedded. I designed tools: pushed pages with a permission manifest, enabled by an admin in the browser, running on the sandbox origin inside a Workshop iframe with one-hour permission-limited grants. I then listed the restrictions for the owner.

### Prompt Context
**User prompt (verbatim):** "ok i do want that scenario where ramon makes a publish release board or so, it's just the core workshop should be in the app embedded to avoid corruption."
Follow-up (verbatim): "what's the restrictions you are adding?"
**Assistant interpretation:** Design pushed tool screens without making the core replaceable; explain the restrictions.
**Inferred user intent:** Extensibility without corruption risk.
**Commit (code):** none

### What I did
- Added §6.13, D9, concept row, Phase 6 (tools), hardening → Phase 7, MCP → Phase 8, test bullets, open question 10.

### Why
- (b) in D9 bounds damage to approved, logged, undoable actions enforced by the server.

### What worked
- Doctor passed.

### What didn't work
- No failures observed.

### What I learned
- N/A

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Whether the restrictions are too strict for two people (listed as relaxable in the chat answer).

### What should be done in the future
- N/A

### Code review instructions
- §6.13, D9.

### Technical details
- Grants: `slg_` prefix, 1 h, permissions ⊆ manifest; never users/tokens/audit/tools.
