---
Title: Diary
Ticket: SLOP3-007
Status: active
Topics:
    - backend
    - security
    - authz
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological work log for SLOP3-007, the authority core: groups, one level rule, live links, declared requires, self and visitor, budget ledger."
LastUpdated: 2026-11-02T16:27:42.938218785-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Work log for SLOP3-007, which implements the authority-core plan (`design/01-authority-core-plan.md`) in phases. Each phase changes what an access rule means, not just where it is enforced, and lands with exit tests that fail on the code before it.

## Step 1: Ticket, imported plan, amendments

I set up the ticket around the user's design doc. The doc is imported unchanged under `sources/local/`, beside the pattern-language doc it builds on. The working copy in `design/` carries the five amendments agreed in conversation, each marked **Amended (SLOP3-007)**. No code changed in this step.

### Prompt Context
**User prompt (verbatim):** "ok, create a new docmgr ticket, import the document, update it as suggested, then implement it step by step, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Create SLOP3-007, import "Slop authority core: one grammar for access, identity and budgets", apply my review's suggestions, then implement phases 0–7 with commits and an investigation-format diary.
**Inferred user intent:** Turn the reviewed plan into working code, one reviewable phase at a time.

### What I did
- `docmgr ticket create-ticket --ticket SLOP3-007 …`.
- `docmgr import file` for both Downloads docs: `authority-core-original.md` and `pattern-language-hosted-apps.md`.
- `design/01-authority-core-plan.md` is the original with these amendments:
  1. ticket number and branch (`task/slop3-007-authority-core`);
  2. PR #14 merged;
  3. decision 4: undeclared actions need **admin**, not interact;
  4. phase 4: trusted-module calls with no visitor act as `store:<id>`, admitted by the live trust row, instead of acting as the admin in `granted_by`;
  5. phase 6 deferred.
- Tasks: one per phase (kxm9, bmt0, 5wfg, hex7, bqdv, xs46, afob, 20bp).

### Why
- **Decision 4.** A public store grants `@guest interact`, so an interact default opens every undeclared action to anonymous visitors. That is the pattern-language doc's argument (its pattern 10). Phase 3 declares every shipped action anyway, so the strict default breaks nothing we ship.
- **Phase 4.** The original's "act as the admin who trusted the app" is the confused-deputy shape the plan rules out elsewhere ("never borrows the owner"). Acting as the store, with the trust row as a fact that has provenance, keeps one rule.
- **Phase 6.** Since GitOps #411 every tier is deepseek-4.1-flash, so token budgets mean the same amount of money on every tier.

### What warrants a second pair of eyes
- Phase 4's trust-as-fact rule is new design. The original authors should agree that a store principal admitted by a trust row may run `system` module functions in reactors (the back office's `system:*` reactor depends on it).

### What should be done in the future
- Phases 0–7 follow in later steps.
