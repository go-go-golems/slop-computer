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
