---
Title: Diary
Ticket: SLOP3-018
Status: active
Topics:
    - apps
    - sqlite
    - architecture
    - publishing
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-08T20:53:24.810024444-05:00
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

## Goal

The working record of SLOP3-018: the francois catalog's data moves from a JSON file, built on a laptop and copied into four stores, to SQL tables in the catalog store, which the release importer pushes into and every view reads.

## Step 1: Ticket and design: where the data lives, who writes it, who reads it

The ticket comes from a question the user asked while the restyled catalog was being deployed (SLOP3-015 step 11). Before writing the design I checked the platform's actual cross-store access, which corrected what I had first told the user.

### Prompt Context
**User prompts (verbatim):**
- "3. could we use sql and a db instead of catalog.json? and manage the data \"on the host\" instead of having to check it in? what do you think?"
- "Ok, create a new ticket to build that, and that would allow us to have the same store for all apps, instead of reusing the file multiple times?"
- mid-turn: "explain this: - One platform question is open: whether the catalog actor can read the release stores. …"
**Assistant interpretation:** Create the ticket and a design doc for moving the catalog's data into one store with SQL. Answer whether one store can serve every view. Explain precisely how an actor reads other stores.
**Inferred user intent:** Stop copying the data around; give the catalog a home on the host that the views share.
**Commit (docs):** see `git log` for "SLOP3-018: ticket, design doc, tasks, diary step 1".

### What I did
- **Read the platform's cross-store access:**
  - `pkg/doors/actors/platform.go`: `platformOps` is `stores.create`, `mounts.set` and `grants.set`. There are no reads.
  - `pkg/actor/modules.go`, `storesModule`: `use('stores').open(alias)` needs a binding (`bind.set <store> <alias> <target>`) and a view grant to `store:<id>` on the target. It is checked again on every call, and the target's read rules apply. The handle offers `docs.get` and `docs.query`, `files.text` and `files.list`, `rev`, `log` and `call(action, args)`.
  - `ownPath`: an actor writes only its own store.
- **Read how the catalog's data travels today:**
  - `catalog-mcp/actor.js` and `catalog-curator/actor.js` `require('./data/catalog.json')`;
  - the Shelf page fetches `data/catalog.json`;
  - `02-deploy.py` puts the file into four stores.
- **Checked:**
  - `pkg/actor/memfs.go`: `use('fs')` is in-memory, not the store's served files;
  - `pkg/store/sqlpolicy.go`: migrations may create FTS5 tables;
  - `doc/design/slop-v3.md` §6.4: migrations run at activation;
  - `03-import.py` in SLOP3-013 writes `francois.json`.
- **Ticket and plan:** created SLOP3-018 (`docmgr ticket create-ticket`), a design doc and this diary, and added six phase tasks.

### Why
- **Push, not pull:** pulling needs a binding and a grant per release store (about 100 now, two more per release). The importer already has the admin login and the facts.
- **Endpoint, not a regenerated file:** an actor cannot write its store's served files.

### What worked
- The code answered each question directly. The design doc cites the functions it relies on.

### What didn't work
- **What I first told the user:** that actors reach other stores "only through the platform module". In fact `platform` cannot read, and reads go through `use('stores')` with a binding and a grant. I corrected this in my answer and in the design doc.

### What I learned
- slop already has every piece this needs: SQL with FTS5 through migrations, express routes on actors, cross-store reads and calls through bindings, CORS and rate-limit middleware. Only one question needs a check: whether one store can be mounted on both hosts.

### What was tricky to build
- Nothing yet.

### What warrants a second pair of eyes
- **Moving MCP into the catalog actor retires a store (`catalog-mcp`)** and changes its mount. Its public URL `/catalog/mcp` should keep working, either by mount or by redirect.

### What should be done in the future
- Phase 0's checks, then phase 1.

### Code review instructions
- Read the design doc: the summary, §2 (writes), §3 (reads) and the decisions.

### Technical details
- The design keeps today's item shape in a `facts` JSON column, so the `/catalog.json` endpoint can match the file and no view changes beyond the URL.
