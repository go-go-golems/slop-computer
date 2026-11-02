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

## Step 2: Phase 0, failing exit tests first

I wrote the exit tests for phases 1, 2, 3 and 5 in `pkg/server/core_test.go`, each behind `t.Skip("SLOP3-007 phase N")`. Before adding the skips I ran each one against `main`: all seven fail for the reason they describe. The overspend test fails only by timing, which is the nature of the bug. Phase 4's tests are deferred to the start of phase 4; they need the platform and trusted-module call paths, which I hadn't read yet.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Phase 0 of the plan: failing tests first, skipped until their phase.
**Inferred user intent:** Every behavior change lands with a test that proves it was broken before.
**Commit (code):** 4a48262 — "SLOP3-007 phase 0: exit tests for phases 1, 2, 3 and 5, skipped by phase"

### What I did
- Helpers:
  - `personID` (via `h.sys.PersonByEmail`);
  - `llmAllowed` (reads `llm.usage`);
  - `linkStore` (a mounted `notes` store with a chosen owner).
- Tests:
  - `TestSubscriberKeepsMemberPolicy`, `TestSubscriberKeepsMemberLLMRow` (phase 1);
  - `TestPendingOwnerCappedAtInteract`, `TestExpiredLinkGrantsInert`, `TestLinkGrantsEndWithCreator` (phase 2);
  - `TestActionWithoutRequiresNeedsAdmin` (phase 3), with an actor (`undeclaredActor`) that has one undeclared action and one `requires: 'view'` action;
  - `TestConcurrentSamplesCannotOverspend` (phase 5): 20 parallel `ask` calls against a budget worth 5.

### What worked
- Each test fails unskipped on `main` (`go test -run '…' -count=1`):
  - **Policy:** `allowed:false`, though the visitor's `llm` shows `allowed:true source:@subscriber`. The cell alone blocks.
  - **LLM row:** `allowed:false remaining:<nil>`.
  - **Pending owner:** `level:owner ok:true`, with trace `audience guest … owner of s-dan`. The cap never applies.
  - **Expired link:** the view opens with `level:interact` 48 h after a 1-day link.
  - **Link creator disabled:** the view still opens with `level:interact`.
  - **Undeclared action:** `want permission_denied, got 200 map[result:poked]`.
  - **Overspend:** `ok=6 used=132` against 110.
- With the skips, all seven skip, and `go vet` is clean.

### What didn't work
- The first unskipped run of `TestConcurrentSamplesCannotOverspend` passed, by timing. A rerun with a log line gave `ok=6 used=132`. The test asserts the invariant (used ≤ budget), which can fail on `main` but must hold after phase 5. I kept the `t.Logf` line so failures show the counts.

### What I learned
- The actor-side `sample` path (`pkg/actor/sample.go:22` check, `:103` charge) has the same check-then-charge race as the page path. The fake model charges 22 tokens for `q: "hi"`.
- `explain.can` with `subject: <email>` is the cheapest way to read anyone's level in a test, with no browser session.
- `h.sys.Now` is a settable clock: the link-expiry test moves it 48 h ahead.

### What was tricky to build
- Link redemption needs a site session. A guest `h.site(live)` redeeming through `openView(…, token)` is enough: the grant goes to the guest's `vis_` id, and reopening without the token shows whether the grant still counts.

### What should be done in the future
- Phase 4's tests (`TestAlarmPlatformActsAsStore`, `TestAlarmSampleNeedsStoreCellAndBudget`, `TestStoresOpenRechecks`), at the start of phase 4.
- `TestGroupsByKind` and `TestLevelNeverAboveCap` are unit tests against APIs that don't exist yet; they come with phases 1 and 2.

### Code review instructions
- `pkg/server/core_test.go`. To see a failure, remove a `t.Skip` and run `GOWORK=off go test ./pkg/server -run <name> -count=1 -v`.
