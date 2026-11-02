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

## Step 3: Phase 1, groups replace the audience ladder

Every "is this person in this class?" question now goes through one nesting function, `system.GroupsOf`. A policy cell or LLM row on `@member` reaches subscribers and admins. Before this change, paying took access away because those lookups matched the audience exactly. The audience string survives as the name of the highest group, so views, the runtime and actor code see no API change.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Phase 1 of the plan (decisions 1 and 2).
**Inferred user intent:** One rule for class membership, in one place.
**Commit (code):** 43331d3 — "SLOP3-007 phase 1: groups replace the audience ladder"

### What I did
- `pkg/system/policy.go`:
  - `GroupsOf(audience)`, the nesting: guest; guest+member; …; admin has all four; "store" has only itself;
  - `InGroup`;
  - `Policy` is on when any group's cell (or that group's default) is on;
  - `PolicyMatrix` sets `Effective` on every cell;
  - `LLMFor`: a person's own row wins (even off), else `groupLLMRow`, the most generous row that is on (no budget beats any budget).
- `pkg/access/check.go`:
  - `Group` constants, `Audience.Groups()`, `Audience.In(g)`, `Checker.Groups`, `Checker.In`;
  - `Matches` tests group membership;
  - `AtLeast` and `audRank` deleted; `ValidAudience` is a switch.
- Call sites moved from `AtLeast` to `In`:
  - `verbs/stores.go` (`store.new`), `verbs/data.go` (`import.folder`);
  - `server/live.go` (create-audience, twice);
  - `server/actors.go` (route audiences);
  - `actor/actor.go` (`ctx.needAudience` uses `system.InGroup`; the actor's `audRank` is deleted).
- Back office: the policy matrix shows a cell that is on through a group as "inherited", with a note that groups nest. Rebuilt `pkg/server/admin`.
- Tests:
  - phase 1's two exit tests are unskipped;
  - `TestGroupsByKind` (server, through `explain.can`);
  - `pkg/system/groups_test.go`: `TestGroupsOf`, `TestPolicyThroughGroups`, `TestLLMRowThroughGroups`.

### Why
- Nesting is linear (decision 1), so an audience determines its groups. I kept the audience string as the carrier and derived groups from it, instead of adding `View.Groups`, `Visitor.Groups` and a new `Policy` hook signature as the plan sketched. Fewer moving parts, the same semantics, and no change to stored views or the JS runtime.
- `GroupsOf` lives in `pkg/system` rather than `pkg/access`. `system` answers policy and LLM questions and can't import `access` (`access` imports `system`).

### What worked
- `GOWORK=off go test ./... -count=1`: all green, including the phase 1 exit tests.
- `cd web/runtime && pnpm test`: 9/9.
- `go vet` clean; `gofmt` fixed `check.go`.

### What didn't work
- `TestLLMBudgets` failed on purpose: `p6_test.go:80: admin, policy off for admin: map[result:map[text:slop is connected. …]]`. The admin now gets `sample` through the `@member` cell. The assertion now expects success, as the plan's "tests that change on purpose" table says.

### What I learned
- The `"store"` audience isn't produced yet: `AudienceOf` still returns `member` for `KindStore`. Making stores `@store` changes what alarms and cross-store calls may do, so it belongs with phase 4's tests.

### What warrants a second pair of eyes
- `groupLLMRow`: a group row that is off adds nothing, while a person's own row that is off switches them off. That is the plan's rule, and now executable in `TestLLMRowThroughGroups`.
- In the matrix, turning `@subscriber` off while `@member` is on changes nothing for subscribers. The cell shows "inherited" so this isn't hidden.

### What should be done in the future
- Phase 4: `KindStore` → `@store`; `DefaultPolicy` already keeps `assets` off for "store" (its rule is `audience != "guest"`, so it would be on for "store" too; check this in phase 4).

### Code review instructions
- `pkg/system/policy.go` (`GroupsOf`, `Policy`, `groupLLMRow`), then `pkg/access/check.go` (`Matches`, `In`).
- Validate with `GOWORK=off go test ./pkg/system ./pkg/server -count=1`.

## Step 4: Phase 2, one level rule and live link grants

`access.Level` is now the plan's expression: the max over sources, then the min with one ceiling, and no other branch. Link grants count only while their link is live and its creator still holds the link's level. The phase-2 exit tests pass. A new property test checks `Level` against an independent model, and it fails on `main` with exactly the pending-owner bug.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Phase 2 (decisions 2 and 7).
**Inferred user intent:** Make the owner-skips-cap bug unwritable, and make derived authority die with its origin.
**Commit (code):** 2fb7a86 — "SLOP3-007 phase 2: one level rule, and links that end with their creator"

### What I did
- `pkg/access/check.go`:
  - `Level` → `level(ctx, p, st, withLinks)`. Sources are the kernel, a store on itself, the owner column, `@admin` and live matching grants, each grant capped at admin. Then `kindCap`: none for disabled or a scope-less token, interact for guest/pending, otherwise owner.
  - `deadLink` checks the link: revoked or expired, else the creator's level computed with `withLinks=false`.
  - `GrantInactive` exposes that for `grant.ls`.
  - `capOf` deleted.
- `pkg/system/stores.go`:
  - `Grants` LEFT JOINs `links` on `g.via = l.id`;
  - `Grant.Link *GrantLink` (creator, level, revoked_at, expires_at), with `GrantLink.Live(now)`;
  - `Grant.Inactive` for listings.
- `pkg/verbs/stores.go`: `grant.ls` fills `inactive`.
- Tests:
  - the three phase-2 exit tests are unskipped;
  - the expired-link test also checks `grant.ls` shows the reason;
  - `pkg/access/level_test.go`: `TestLevelNeverAboveCap`, 300 seeded cases (role × owner × grant level × grant to self or `@member` × token shape) against a model written separately from `Level`.

### Why
- The trace keeps the lines tests read: `audience …`, `grant <subject> <level> on <store> (<via>)`, `owner of …`, `no grant on … matches`. A ceiling line appears only when it lowers the level, so traces stay short.
- The creator's level ignores link grants, so links can't hold each other up and there is no recursion. A link created by `system` (or with no creator) always qualifies.
- I didn't add the per-creator/epoch cache the plan suggests. Every check is one extra `Grants` query and one `Person` lookup per matching link grant, cheap on SQLite. Worth revisiting only if `reviewAll` shows up in profiles.

### What worked
- All Go tests and vet pass.
- The property test copied into a `main` worktree (adapted to `AtLeast`) fails: `case 3: role pending owns true …: level owner, want interact`.

### What didn't work
- `TestModuleTrust` became flaky: 1 failure in 10 runs, then 1 in 30, against 0 in 20 and 0 in 30 on `main` (a separate worktree at `$CLAUDE_JOB_DIR/tmp/main-wt`). The failing log had `store tool runs tool@1` (via `activate`) among the last three rows, pushing out the `trust tool with system` row the test looks for.
  - Cause: `Kernel.Running` activates lazily in whichever caller arrives first. When a background caller wins, the test's own call sees the version already active and continues, while the background caller writes its system log row later.
  - That race exists on `main`; the new `Level` (a join per check) changed the timing enough to expose it.
  - Fix: the test reads 10 rows. After the fix: 0 failures in 40.

### What I learned
- `MoveGrants` keeps `via`, so a guest's link grant keeps its provenance after they sign up; the liveness rule still applies.

### What warrants a second pair of eyes
- New behavior, by decision 7:
  - grants from expired links stop counting (they used to stay);
  - links made by someone later disabled or removed stop working;
  - a pending creator still holds interact on their own store, so their interact links keep working.
- `grant.set` still accepts `owner`. Such a grant now counts as admin (as before for members via `capOf`). The plan suggests refusing it; I left that for a separate change because existing tests set owner grants on purpose (`p4_test.go:116`).

### What should be done in the future
- Consider refusing `owner` in `grant.set`.
- Cache creator levels per epoch if profiling shows a need.

### Code review instructions
- `pkg/access/check.go` from `Level` to `deadLink`; `pkg/system/stores.go` (`Grants`, `GrantLink`).
- Validate with `GOWORK=off go test ./pkg/access ./pkg/server -count=1`.
