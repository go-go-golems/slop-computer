---
Title: Diary
Ticket: SLOP3-023
Status: active
Topics:
    - architecture
    - apps
    - agents
    - tools
    - publishing
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of SLOP3-023: from the review-findings analysis to the guide and its delivery."
LastUpdated: 2026-11-16T13:21:23.643632289-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: The guide — from review findings to a rewrite plan

The user asked whether the recent code-review rounds pointed at an API failure, then how I would refactor with no legacy burden, then for this ticket and a guide a new intern could follow. I tallied every Codex finding on #47, #48 and #50, traced them to the bench's browser-side replica of the app's files, and read the server's store and verb code to make sure the replacement (`files.commit` in one store turn) is built from primitives that already exist. The guide is in `design-doc/01-…`, revised once after a full reread, and uploaded to reMarkable.

### Prompt Context

**User prompts (verbatim):**
- "is there something in the last couple of code review rounds that poiint towards ann api failure / refactoring things to make such errors impossible to express / handling them in a systemic fashion around a core modular component core / simplicity and robustness in API design"
- "how would you refactor / tighten things up (remembhr we don't have any legacy burden and can do any cutover we want, even if that means invalidating deployed data or APIs)."
- "Create a new docmgr ticket for that and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

**Assistant interpretation:** Write the refactor I proposed as a self-contained guide: slop concepts, the bench today, the evidence, the design with APIs and pseudocode, a phased plan and tests. File it in a new ticket and deliver it to reMarkable.

**Inferred user intent:** A document someone else (or a later session) can implement from, without this conversation.

### What I did

- **Tallied the findings:** saved each PR's review comments with `gh api --paginate repos/go-go-golems/slop-computer/pulls/<n>/comments` and grouped the 26 Codex findings by file and cause.
  - 12 in `03b-slop.js`, 6 in `04-project.js`, 5 in `apps/bench/actor.js`, 2 in `06-agent.js`, 1 in `09-views.js`.
  - Causes: inferred sync state (10), ownerless holds (4), "current project" defaults (2), rules in several places (2), document-size workarounds (3), unpinned or impure server reads (5).
- **Read the server primitives the design needs** (at `main` 084eaa2):
  - `pkg/store/files.go`: the tree zone, `Snapshot` (deduplicates an identical tree), `RefAt` and `MoveRef`, `SnapshotFiles`.
  - `pkg/store/turn.go:70`: `Store.Do`, one serialized SQL transaction.
  - `pkg/commands/files.go`: `push`, a manifest with `prune`; `ifAt` checked in the same turn.
  - `pkg/doors/actors/modworkshop.go:17`: the workshop table.
  - `apps/bench/actor.js`: `sync`, `head`, `preflight`, `publish`.
- **Read the client:**
  - `03b-slop.js`: `Sync`, `Outside.mergeIn`, `Embeds`, `Publish`.
  - `04-project.js`: the `Project` fields, the log chunks and pieces, `openApp`.
  - `03-store.js`: the per-user documents and write queue.
  - `06-agent.js`: `hostAPI`, the `tx.*` and `dry.*` APIs, `runEval`, `delegate`, `API_SIGS`, `LONG_CALLS`.
  - `worker.js:242`.
- **Ticket and documents:** created SLOP3-023 (`docmgr ticket create-ticket`) with the design doc and this diary, in a worktree from origin/main (`task/slop3-023-docs`).
- **First draft:** about 800 lines, then a full reread with review notes before revising (below). 17 passages revised; 10 code lines wrapped to 88 characters for the PDF.
- **Checks:**
  - `docmgr doctor --ticket SLOP3-023 --stale-after 30`: all checks passed.
  - The guide's suggested first command runs and passes (`TestFilesAndSnapshots`, `TestRefMoveIfAt`, `TestPushActivates`, `TestPushIfAt`).
- **Upload:** `remarquee upload bundle … --name "SLOP3-023 Bench core rewrite guide" --remote-dir /ai/2026/11/16/SLOP3-023 --toc-depth 2` → `OK: uploaded SLOP3-023 Bench core rewrite guide.pdf -> /ai/2026/11/16/SLOP3-023`.

### Review notes (second pass, before revising)

**Accuracy:**
- Group F was labelled "reads of names instead of numbers", but "Keep production status collection from activating instances" is a read with a side effect (`app.status` activating). Relabelled, with the fifth case explained.
- "About 120 host-API functions": the namespaced calls number about 100.
- Prune line reference: `files.go:418-431`, not `425-437`.
- Activation happens on an instance's next use (or at once when a push names it in `activate`), not the moment the ref moves.
- `slop publish` and "slop store rm of documents" are not real commands; rewritten.
- The first command used `./pkg/commands -run 'Push|Ref'`; the push tests are in `pkg/host/devloop_test.go` and the snapshot test in `pkg/store`. Phase 1's test location was fixed the same way.
- "Under today's code the last push wins": in one browser the later *write* wins inside `P.files`.

**Comprehension:**
- It didn't say who calls `Sync.schedule` (`P.write` does, `04-project.js:69`).
- `cache.remember` hid that a merged-over snapshot's files may need one `files.ls`.
- It didn't say what happens to a transaction after a conflict (it stays open; the eval drops it, the editor shows a merge).

### Why

- **ASCII diagrams, not Mermaid:** the reMarkable PDF goes through pandoc, which renders code blocks as-is.
- **Line numbers pinned to `main` 084eaa2:** #50 (holds as tokens) was still open, and the design replaces those internals anyway.

### What was tricky

- **Keeping current and proposed apart** in sections that discuss the same names (`tx.*`, `runEval`, `Outside`). Each section says whether it describes today or the design.
- **The frame-visibility consequence:** with write buffers, an eval's frame checks see draft, not its own uncommitted writes. The guide states it, the API guide will need to say it, and previews of a transaction are left as an open question.

### Future

- Phases 1–4 (tasks `xzku`, `7wa5`, `xv3h`, `ozs3`).
- Open decisions are listed in the guide's section 8: commit granularity for typing, conflict presentation, previewing a transaction, per-developer refs, the event stream.
