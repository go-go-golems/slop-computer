---
Title: Diary
Ticket: SLOP3-017
Status: active
Topics:
    - pinboard
    - security
    - actor
    - cli
    - review
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological diary of SLOP3-017: the fixes for the Codex review findings on the SLOP3-016 PRs, and their consolidation into one PR"
LastUpdated: 2026-11-07T18:44:25.87170891-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Chronological record of SLOP3-017. It covers the fixes for the eight open Codex findings on the SLOP3-016 PRs (#36, #37, #39), each made at its root cause (design doc 01). It also covers folding #36–#39 into one PR. The code is on `task/slop3-016-phase6` (worktree `scratchpad/slop016`); the ticket docs go to `main` from the docs worktree (`scratchpad/slop016docs`, branch `task/slop3-017-docs`).

## Context

- **Findings:** design doc 01 §2 has the table, F1–F8, and their weights.
- **Prior work:** SLOP3-016 diary steps 10–14; the actor VM diary steps 5–6; GOJA-069 step 6, which fixed the go-go-goja half of the review in go-go-golems/go-go-goja#107.

## Step 1: Ticket, design doc and task list

The Codex findings on #36, #37 and #39 had not been assessed when the go-go-goja review was. This step records which are real, what they cost in practice, and how each is fixed at its root cause.

### Prompt Context
**User prompt (verbatim):** "Ok, then let's create a ticket for these and a design doc that writes up how to address these (now that we studied them). Then impement and commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). we can stack the fixes on the last one and in fact reduce this to a single PR by merging, now that we've had respective reviews of the PRs"
**Assistant interpretation:** Create a ticket and a design doc for the eight findings, fix them on #39's branch, fold #36–#39 into one PR, and keep this diary.
**Inferred user intent:** Ship one reviewed PR with the findings fixed at their causes, and a written record of why each fix has the shape it has.

### What I did
- Read every finding against the code on `task/slop3-016-phase6` (fdaacf5):
  - **F1:** `apps.js:56-60` trusts `a.uid` and `a.sha256`. `app.json` gives admins write access to `apps`.
  - **F2:** `board.js:601` and `:297` classify `blob:` references by `PB.blobs[src]`. With the asset store, drawing images never fills `PB.blobs` (`store.js:217`).
  - **F3:** `core.js:255` checks `JSON.stringify(e).length > 200000`.
  - **F4:** reproduced with a throwaway test. `Execute(…, use=["slop","pb","Kitchen Board"], args=["clip","ls"])` prints `pb`'s help, returns nil and makes no call.
  - **F5:** `verbsDir` keeps only `u.Host`.
  - **F6:** core's `update` accepts a function (`core.js:194`), and so does `promote` (`:197`). The frame recorder sends functions as they are, and they arrive as `null`. Its `promote` drops the function.
  - **F7:** `framedDef` uses `a.state || {}`. `m.open` copies `def.state` into the new window. `framedMeta` never fills in window state.
  - **F8:** `toolRunner`'s pending branch reports a rejection through `then`. `handle` only checks the root promise.
- Measured the weights:
  - Pinboard's agent tools are synchronous actions; `ask`, the one async action, is not a tool.
  - The built-in Moodboard (in-page, `SRC.moodboard`) uses `c.board.clip(ui.image(im.src))`, which F2 breaks. It also uses `update(id, r => …)`, which F6 breaks only in framed apps.
- Platform facts the design depends on:
  - The `self` rule level is held by nobody (`pkg/rt/rules.go`).
  - The actor writes its own store through `turn.SetDoc`, without page rules (`pkg/actor/modules.go:337`).
  - The page reaches actor actions through `PB.rt.slop.call` (`web/runtime/src/caps.ts` `slop()`).
  - Pages do not see a document's writer: the wire `Entry` and `DocSnap` have no `by`, although `store.Doc.By` exists.
  - `Actor.Later` posts continuation events whose `parent` is the root event.
- Wrote design doc 01 (root causes, one design per finding, alternatives, plan, PR consolidation) and twelve tasks with docmgr.

### Why
- **F1 through the actor, not a writer field for pages.** A writer field is the more general primitive, but it changes the db stream protocol, the runtime's `DocSnap` and `claude.js`. Actor-owned registration stays inside Pinboard and uses only existing levels.
- **F6 as a shared step table.** Patching `update` alone would leave the next function-taking step broken in the same silent way.

### What worked
- Every finding checked out against the code; none was a false positive.

### What didn't work
- Nothing yet.

### What I learned
- Codex had reviewed #36, #37 and #39 hours earlier, and I had not looked: the earlier question was about #107 only. Review state is worth checking on every PR of a stack.

### What was tricky to build
- Weighing F1's two designs. The writer-field primitive is cleaner as a concept; the actor path is cheaper and keeps the platform untouched.

### What warrants a second pair of eyes
- Design §3.5: refusing log reverts that touch `apps`. App changes stop being undoable from the log, and only re-registering an earlier version brings an app back.

### What should be done in the future
- A platform ticket for document writers in page snapshots (design §11).

### Code review instructions
- Read design doc 01 §2 (the table), then §3 and §8, the two that change contracts.

### Technical details
- Ticket: `ttmp/2026/11/07/SLOP3-017--review-fixes-for-slop3-016-app-trust-frame-protocol-read-time-defaults-turn-outcomes-cli-verb-dispatch/`.
