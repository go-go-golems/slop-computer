---
Title: Diary
Ticket: SLOP3-010
Status: active
Topics:
    - architecture
    - backend
    - hosting
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-03T14:53:39.600209094-05:00
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

## Step 1: the ticket and the intern's guide

SLOP3-010 makes the package reorganization that SLOP3-009 left to "split as you go" deliberate. The user decided to override that rule after SLOP3-009 steps 4 to 6 showed the knots growing instead of shrinking. This step writes the plan and the guide. The code starts in Step 2.

### Prompt Context
**User prompt (verbatim):** "ok, PR. Then open SLOP3-010 as four PRs, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. (use dumb subagent for remarkable-upload) Then step1"
**Assistant interpretation:** Open the PR for SLOP3-009 steps 2–6 (done: #22). Create the SLOP3-010 ticket with four tasks, one per PR. Write the guide, upload it to reMarkable through a small-model subagent, then implement PR 1.
**Inferred user intent:** A reorganization that a newcomer can understand and review, done now rather than piecemeal.

### What I did
- PR #22 opened for SLOP3-009 steps 2–6: https://github.com/go-go-golems/slop-computer/pull/22
- Measured the knots on `task/slop3-009-typed-verbs`:
  - package and file line counts;
  - `go list` imports per package;
  - the tables each `pkg/system` file touches (from its SQL);
  - the 86 verbs (`slop verbs`), 81 of which have the regular `Run` signature PR 1 rewrites;
  - the outside uses of `verbs.Call`, `verbs.Env` and `Confirmations()`;
  - the 95 distinct `Sys.X` methods called outside `pkg/system`.
- Wrote `design-doc/01-untying-the-knot-packages-…md` (about 970 lines):
  - Parts 1–4: the system from stores to doors, with two traced requests;
  - Part 5: the knots, measured;
  - Part 6: the target map and rules;
  - Parts 7–10: one PR each;
  - Part 11: move rules;
  - Parts 12–13: API and file references;
  - Part 14: open questions.
- Added the four tasks.

### Why
- **`pkg/commands` as a staging package in PR 1.** Domain packages don't exist until PR 2, so commands can't move to their owners yet. Moving them all at once makes the table a leaf in one PR, and PRs 2 and 4 then empty `pkg/commands`.
- **`Run` without `Env`.** The `*Env` parameter is the only reason `pkg/verbs` imports domains. Capturing dependencies when a verb is built removes the edge. It also makes a second table (a second host) possible.

### What should be done in the future
- Step 2: PR 1.

### Code review instructions
- Read the guide's Part 7, then check each call site in its table 7.5 against the code.
