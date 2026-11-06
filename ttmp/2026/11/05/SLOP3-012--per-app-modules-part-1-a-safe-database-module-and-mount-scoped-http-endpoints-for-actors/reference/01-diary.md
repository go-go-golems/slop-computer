---
Title: Diary
Ticket: SLOP3-012
Status: active
Topics:
    - goja
    - apps
    - architecture
    - security
    - routing
    - hosting
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-05T19:42:35.25094165-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The chronological record of SLOP3-012: the first implementation of per-app modules in slop, a `database` module with go-go-goja's JavaScript API over the actor's own store, and an express-style HTTP module whose routes are bounded by a policy on the mount. The research and the decisions behind it are in SLOP3-011 (its diary, Steps 1–8).

## Step 1: The ticket and the intern guide

The user asked for a new ticket and a detailed guide for a new intern: what the system is, every part needed to understand it, and the design and implementation plan, with prose, bullets, pseudocode, diagrams, API and file references, then uploaded to the reMarkable. SLOP3-011 keeps the research. This ticket is for the implementation, starting with the guide.

### Prompt Context
**User prompt (verbatim):** "Alright, create a new docmgr ticket and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**Assistant interpretation:** Create SLOP3-012; write an intern-level analysis, design and implementation guide for per-app modules (database and mount-scoped HTTP first); store it in the ticket; upload it to the reMarkable.
**Inferred user intent:** A document someone new can read on paper and then implement from.

### What I did
- `docmgr ticket create-ticket --ticket SLOP3-012 --title "Per-app modules part 1: a safe database module and mount-scoped HTTP endpoints for actors" --topics goja,apps,architecture,security,routing,hosting`; `docmgr doc add` for the design doc (`design-doc/01-intern-guide-…`) and this diary.

### Why
- Separate tickets keep the research record (SLOP3-011) apart from the implementation work and its tasks.

### What worked
- Ticket created at `ttmp/2026/11/05/SLOP3-012--per-app-modules-part-1-a-safe-database-module-and-mount-scoped-http-endpoints-for-actors`.

### What didn't work
- No failures observed.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Write the guide (Step 2) and upload it.

### Code review instructions
- N/A.

### Technical details
- Related: SLOP3-011 diary, and the vault report "PROJECT REPORT - slop v3 - Per-App Modules - Safe Database and HTTP Endpoints for Sandboxed Actors - A Technical Deep Dive".

## Step 2: The intern guide, written, reviewed and uploaded

The writer agent that had just written the SLOP3-011 vault report, and so had read all four repositories, wrote the guide into `design-doc/01-intern-guide-…`. It is organized in five parts: the system, go-go-goja background, the design, a five-phase implementation plan, and an API reference. It has 14,487 words (11,187 outside code blocks) and five mermaid diagrams. I reviewed the outline, spot-checked four of its new code claims, committed it, and uploaded it to the reMarkable.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Write the guide, store it in the ticket, upload it.
**Inferred user intent:** A paper-readable document to review the design and to implement from.
**Commit (docs):** `4f61410` — "SLOP3-012: intern guide (analysis, design, implementation plan for database and mount-scoped HTTP endpoints)"

### What I did
- Briefed the writer with the parts and requirements: dependency-ordered orientation, one running example (the journal's `GET /feed.json`, then rewritten with `database` + `express` under an API mount), decision records, file-by-file phases with pseudocode and tests, API tables, glossary, pandoc-friendly layout. I also gave it the seven corrections from SLOP3-011 Step 9.
- Reviewed the outline (41 sections) and checked these claims against `/tmp/slop011` (origin/main):
  - `pkg/actor/manager.go:172-174`: a broken build is cached in `m.broken`, and only `Restart` deletes it (`manager.go:261-264`).
  - `pkg/actor/inbox.go:7,36`: `inboxLimit = 256`, `"the actor is busy"`.
  - `pkg/commands/mounts.go:140-143`: `checkMount` accepts only live or static hosts.
  - `apps/blocks-site/actor.js:191-210`: `GET/POST /_site` and `POST /_publish` at level `admin`.
- Ticket bookkeeping: filled the index overview, added six tasks (phases 1–5, confirm decisions), related five files, changelog entry; `docmgr doctor --ticket SLOP3-012` passed.
- Uploaded: `remarquee upload bundle <guide> --name "SLOP3-012 Intern Guide - Per-App Modules, Database and HTTP Endpoints" --remote-dir "/ai/2026/11/05/SLOP3-012" --toc-depth 2 --non-interactive`.

### Why
- Reusing the report writer avoided reading the four repositories a second time.

### What worked
- All four spot-checked claims hold.
- The writer built a PDF locally (`remarquee upload md --pdf-only`, 42 pages) and rewrapped code lines to 88 columns or less after the first build cut lines off at the margin.
- Upload: `OK: uploaded SLOP3-012 Intern Guide - Per-App Modules, Database and HTTP Endpoints.pdf -> /ai/2026/11/05/SLOP3-012`.

### What didn't work
- No failures observed in this step.

### What I learned
- New facts the guide records:
  - `readShape` never validates a route's level, so a typo makes the route unreachable instead of failing the load.
  - SLOP3-001's design doc says the actor's authorizer denies `SAVEPOINT` and allowlists functions; the code allows both.
  - An authorizer denial surfaces as `actor_error` (`actors_test.go:116`).

### What was tricky to build
- Keeping blocks-site working: it serves HTML from actor routes on its host and posts forms to its own `/_site` and `/_publish` routes, so forcing a sandbox CSP on all actor routes would break it. The guide limits the response policy to API mounts in part 1.

### What warrants a second pair of eyes
- The guide's 15 decisions (task "Confirm the guide's 15 decisions with the user"), especially:
  - `database` and `express` on by default in part 1;
  - allowlist entries match route keys by containment (`Covers()`);
  - a fixed host middleware order that runs before `MatchRoute`;
  - 413 for over-limit bodies on every actor route;
  - `require("database")`/`require("express")` resolving before tree files.

### What should be done in the future
- Implement Phase 1 (`database`) after the decisions are confirmed.

### Code review instructions
- Read the guide's decision records (search "### Decision:") and Part IV. Spot-check citations against origin/main.

### Technical details
- Guide: `ttmp/2026/11/05/SLOP3-012-…/design-doc/01-intern-guide-per-app-modules-the-database-module-and-mount-scoped-http-endpoints.md`.
- reMarkable: `/ai/2026/11/05/SLOP3-012/SLOP3-012 Intern Guide - Per-App Modules, Database and HTTP Endpoints`.
