---
Title: Diary
Ticket: SLOP-009
Status: active
Topics:
    - architecture
    - backend
    - frontend
    - tools
    - collaboration
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/10/29/SLOP-009--artifact-runtime-baseline-slop-hosts-the-artifact-contract-natively-no-adapters/design-doc/01-intern-guide-the-slop-artifact-runtime.md
      Note: The intern guide this diary records
ExternalSources:
    - /home/manuel/code/wesen/go-go-golems/francois
Summary: "Chronological diary for SLOP-009: the slop artifact runtime baseline."
LastUpdated: 2026-10-29T18:40:00-04:00
WhatFor: "How the SLOP-009 design was produced, with evidence"
WhenToUse: "Before continuing SLOP-009 or reviewing its guide"
---

# Diary

## Goal

Record how SLOP-009 was designed. The ticket replaces slop's per-app adapters with a native implementation of the claude.ai Artifact runtime contract, as a baseline every app runs on.

## Step 1: The contract, francois and slop studied; the runtime designed

This ticket follows three conversations about Claude Blocks (SLOP-008):
1. how to integrate it;
2. what core APIs JS artifacts need, using francois as a reference;
3. what to build locally to make Blocks work "well and elegantly".

In each answer the conclusion moved further from adapters. The last answer proposed a native runtime: a page runtime, a server package, mirrors instead of re-queries, diff sync, apps and targets. The user then asked for a ticket "to properly upgrade slop-computer to have a solid baseline, not adapters", with a brutal refactor and no backwards compatibility. This step turns that answer into a design checked against the code, with a delete list, decision records and an eight-phase plan.

The design has three pillars:
- **One runtime client** (`/_slop/claude.js`, ported from francois's page runtime) and **one server package** (`pkg/rt`).
- **slop's own API as one extension capability** (`claude.use("slop")`), replacing tools and grants.
- **A conformance suite written first**, checked against francois, gating every phase.

### Prompt Context

**User prompt (verbatim):** "Create a new docmgr ticket to properly upgrade slop-computer to hae a solid baseline, not adapaters. You can be brutal in the refactor and no backwards compatibility, we are working our way up."

**Earlier prompts in this thread (verbatim):**
- "what background core APIs would we have to offer for JS artifacts to run fully properly, see for example ~/code/wesen/go-go-golems/francois (whch might also be missing some)."
- "Look at ~/Downloads/Artifact*.md for the claude side API descriptions. What would you implement locally to make blocks work well and elegantly (potentially refactoring other stuff we have to make it more streamline, we don't need to care about legacy support since this is all an experiment, and we care about a strong and streamlined framework)"

**Assistant interpretation:** Create SLOP-009 with a design and implementation guide for the runtime baseline, phased tasks and this diary. No code yet: "working our way up" means phases.

**Inferred user intent:** One strong framework that every artifact-style app (Blocks, Pinup, CC5, Claude-written pages) runs on, instead of growing a shim per app.

**Commit (docs):** recorded in the changelog for this step.

### What I did

- **Read the four contract guides in `~/Downloads`:**
  - *State Storage*: browser storage, `artifact`, db paths, levels, rules, API, errors, assets, Claude's side;
  - *People & Collaboration*: `user`, `room`, `comments`;
  - *Claude API (sample)*: calls, options, page tools, errors, `mcp`;
  - *Files*: `files` and `downloads`.

  Also read the claude.ai type-definition summary for runtime contract 0.2.92 (the `artifact-capabilities` reference, including the db path grammar and limits in `db.d.ts:245-275`, query operators at `:480-490`, and room sizes in `room.d.ts`).
- **francois (read-only):**
  - `README.md` "Capabilities": the implemented surface and what is absent;
  - `ui/src/runtime.ts:751-828`: the capability table and comments, assets, `artifact`;
  - `ui/src/runtime-db.ts` outline and `:250-300, 340-404`: queries and live snapshots;
  - `ui/src/runtime-rooms.ts` outline;
  - `pkg/host/routes.go:98-229`: views, view events, sample calls, tool results, rpc;
  - `pkg/host/rpc.go` method list; `pkg/host/rooms.go`;
  - `pkg/store/documents.go` and `store.go` (functions and schema).
- **slop:**
  - package sizes;
  - every route with its guard (`grep 'm.HandleFunc'`);
  - migrations `003_sandbox`, `004_tools` and `006_docs`;
  - `artifacts` schema (`created_by`, `viewer`) and its uses in `pkg/store/artifacts.go`;
  - roles (`pkg/store/users.go:12-15`), guard levels and scopes (`pkg/server/auth.go:78-92`);
  - render modes and `Boot` (`pkg/render/render.go:18-36`);
  - the broker's one-process assumption (`pkg/events/broker.go:1-9`);
  - the threads schema (`002_kernel.sql`);
  - `ToolScreen.tsx` grant renewal;
  - `tool.js`'s fetch-based SSE (`:65-75`);
  - Pinup's calls to `room.sendToClaudeSession` (`web/pinup/src/09-collab.js:189`, `13-feedback.js:353`).
- **Created the ticket and its docs:**
  ```bash
  docmgr ticket create-ticket --ticket SLOP-009 --title "Artifact runtime baseline: slop hosts the Artifact contract natively, no adapters" --topics architecture,backend,frontend,tools,collaboration
  docmgr doc add --ticket SLOP-009 --doc-type design-doc --title "Intern guide: the slop artifact runtime"
  docmgr doc add --ticket SLOP-009 --doc-type reference --title "Diary"
  ```
- **Wrote the guide** (1,009 lines): the contract per capability, a verdict on every slop part, the target architecture (apps and targets, origins, manifest, views, transport, db with rules, diff sync, room, user, assets, comments, downloads, publish, sample, the `slop` capability, static mode, agents), eleven decision records, server and client layouts, the API and RPC reference, the delete list, phases with exit tests, tests, risks and questions.
- **Added ten tasks:** the design, phases 1-8, and the open decisions.

### Why

- **The conformance suite comes first and runs against francois.** A host that "mostly" implements the contract is how the adapters failed. A suite proven on francois before slop has any of the runtime gives each phase an objective exit test.
- **Apps and targets (D2).** The contract ties a db to one artifact. slop wants one app build serving many data artifacts (Blocks workspaces, Pinup designs). Letting a data artifact name its app keeps "one artifact, one db, one rule set" and needs no app code. The existing `artifacts.viewer` column already carries that idea.
- **Mirrors, not re-queries (D5).** francois answers every write with `db_changed` (`rpc.go:113`), and every subscription re-runs its query (`runtime-db.ts:263-268`). For Blocks' chunk log that would be a full re-download per flush per tab.
- **Diff sync below the API (D6).** It is the generic fix for SLOP-008's D3, invisible to pages.
- **Append-only migration 007 (D11).** Being brutal in code does not justify destroying the cluster's francois data, so only the replaced tables are dropped.

### What worked

- **The existing pieces fit the design:**
  - the contract's document size (256 KiB) and presence size (4 KiB) already match slop;
  - threads already carry an anchor, a version and an `agent` flag;
  - `artifacts.created_by` gives the owner level;
  - `tool.js` already streams over fetch with a bearer header;
  - PR #3's revision-ordering work carries over to `rt_docs` unchanged.
- **The routes list** (`grep 'm.HandleFunc'`) gave an exact delete list: `/api/docs/*`, `/api/presence/*`, `/api/tools*`, `/api/sandbox-url`, `/tools/{rest...}`.

### What didn't work

- **Three claims in my first draft were wrong;** checking them against the code before committing caught all three:
  - "Every API route except login and help requires an admin": `/api/config`, `/api/me` and the device flow are also open to non-admins.
  - "presence bodies match the contract, but documents and leases don't": documents match too (256 KiB). The mismatches are leases, paths and error codes.
  - "Send to Claude uses `comments.sendToClaude` or `room.sendToClaudeSession`": upstream Pinup calls only `room.sendToClaudeSession`.

  All three are corrected in the guide (a Python replace with asserts that each old sentence occurs exactly once).
- **A `grep --include=*.go` in zsh failed** with `no matches found: --include=*.go` (unquoted glob). Rerun with the patterns quoted.

### What I learned

- **The contract's own limits already answer two SLOP-008 questions.** Presence is 4 KiB on claude.ai as well, so raising ours (SLOP-008 G9) would have been wrong. And Blocks' 150,000-character chunks face the same 256 KiB document limit there (G8).
- **The contract says top-level published artifacts have no runtime** ("`use()` resolves `null` for now"). That makes the split between a public site layer and a Workshop runtime a contract-faithful choice, not a shortcut.

### What was tricky to build

- **Where rules live when a target is a data artifact.** Pages declare rules, but agents act on targets with no page open. Resolving them through the target's single app (D2) gives one answer for views and agents alike.
- **Limited windows with client-side evaluation.** With an initial load that obeys `limit`, a document leaving the window cannot be replaced. Loading the filtered set without the limit, and applying the limit in the mirror, keeps windows correct. That is affordable because the contract bounds collection sizes.

### What warrants a second pair of eyes

- **D2:** one app per target. Is there a real case for opening a target with two apps?
- **The view secret's reach.** Any script in the page can use it, Blocks' Spore apps included. It is narrower than today's tool grant, but still the target's full level.
- **Single process.** Rooms and views in memory.

### What should be done in the future

- Phase 1 (the conformance suite) next.
- Rewrite SLOP-008's plan on this baseline once phase 4 lands.

### Code review instructions

- Read the guide's sections 1-5, then 6.2 (apps and targets), 6.7-6.8 (db and diffs), section 7 (decisions), section 12 (the delete list) and section 14 (phases).
- Spot-check references with `sed -n "<n>p" <file>`.

### Technical details

```text
contract capabilities: artifact assets comments db downloads files mcp room sample self(=artifact) user + built-in permissions
limits: doc 256 KiB / depth 32 / 25,000 docs; path 16 segments, 200 B/segment, 1,000 B; room data & presence 4 KiB; ≤16 topics; ≤16 rooms;
        ≤64 rules; ≤64 subscriptions/view; lease 1 s–10 min; assets 20 MiB (SVG 2 MiB, CSS/JS 16 MiB); sample prompt 256 KiB, tool result 32 KB
francois page runtime: runtime.ts 828 · runtime-db.ts 404 · runtime-rooms.ts 172 · runtime-files.ts 141 · runtime-images.ts 89
slop to delete: docs store (006), tools + grants (004), sandbox labels (003), tool.js, ToolScreen, Pinup 00-slop-host.js, slop docs
```
