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
RelatedFiles:
    - Path: repo://pkg/access/check.go
      Note: Level, groups, deadLink
    - Path: repo://pkg/actor/actor.go
      Note: readShape requires
    - Path: repo://pkg/server/core_test.go
      Note: exit tests and worked examples
    - Path: repo://pkg/server/modules.go
      Note: actAs, trusted modules
    - Path: repo://pkg/system/ledger.go
      Note: Reserve/Settle/Meter
ExternalSources: []
Summary: 'Chronological work log for SLOP3-007, the authority core: groups, one level rule, live links, declared requires, self and visitor, budget ledger.'
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

## Step 5: Phase 3, actions declare what they require

An action now states its level (`{ requires, run }`), and the kernel checks it before any of the action's code runs. Undeclared actions need admin. Every shipped actor, and every test actor that members call, declares its levels. The conversion was done by a small script, kept as `scripts/01-declare-requires.py`.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Phase 3 (decision 4, amended to admin).
**Inferred user intent:** An action is closed unless it says otherwise, and the check can't be forgotten in a refactor.
**Commit (code):** 0c0fcd5 — "SLOP3-007 phase 3: actions declare what they require"

### What I did
- `pkg/actor/actor.go`:
  - `Actor.requires map[string]rt.Level` and `Actor.undeclared`;
  - `readShape` returns an error. It reads `requires` from object-form actions. Missing → admin, recorded as undeclared. `none`, `self` or an unknown word → `action X requires "self": use view, interact, admin or owner`, which fails the build and so the activation.
- `pkg/actor/manager.go`:
  - `Actor.mayCall` runs in `Manager.Call` before the event is sent. Level none → `not_found`; undeclared → `… declares no requires, so it needs admin; you have …`; otherwise `… needs X; you have Y`.
  - `activate` logs a `warn` line per undeclared action.
- Confirmed `Manager.Call` is the only path into actions: the `actor.call` verb, page `rpcSlopCall` (`server/actors.go:62`) and store-to-store `call` (`actor/modules.go:570`).
- Shipped actors converted with `scripts/01-declare-requires.py`: a leading `ctx.need('x')` becomes `requires: 'x'`. The workshop has 11 actions, the journal 6, blocks-site 3, the back office 1; the guestbook's 2 were done by hand. Every action had a leading `ctx.need`. A check listed each file's action keys and `requires` lines: all object form, counts equal.
- Test fixtures declared:
  - p3 tracker `add` and `vote`;
  - p6 `ask`, `can` (view), `token`, `make`;
  - w1 `people`, `role`, `grant`;
  - w2 `letIn`, `verb`, `mount`.
  These tests check refusals from inside the action (the verb's own rule), so the caller must get in.
- Tests: `TestActionWithoutRequiresNeedsAdmin` (unskipped) and `TestActionRequiresBadLevelFailsActivation` (new).
- `design/slop-v3-design.md`: both actor examples use `requires`; the access table's "Call an action" row says `requires`, default `admin`.

### Why
- One check in `Manager.Call` rather than per entry point: the pattern doc's "evidence at the resource", applied to actions.
- `TestActors` asserts the message contains "needs interact". The kernel's message for a declared action (`add needs interact; you have view`) keeps that, so the test's meaning is unchanged.

### What worked
- All Go tests, vet and gofmt pass; `web/runtime` passes 9/9.

### What didn't work
- First run after the kernel change: 9 failures, every one an undeclared action that its test expected a member or viewer to reach. For example `p6_test.go:85: member: … ask declares no requires, so it needs admin; you have interact` and `w2_test.go:65: letIn as member: …`. The fix was declarations in the fixtures, not changes to the rule.

### What I learned
- `Actor.fn` already accepted `{ run }` objects. That makes the deploy order safe: the converted actors run unchanged on the current production image.

### What was tricky to build
- Checking `requires` before `send`. `Manager.Call` runs outside the actor's goroutine, so `readShape` stores the levels as Go data at build time, as it already did for routes; the call path never touches the JS object.

### What warrants a second pair of eyes
- **Deploy order for production.** Stores hold the old actor code. With the new image alone, every action in workshop, blocks-site and the back office becomes admin-only until the apps are re-pushed. Re-pushing first (`ttmp/…SLOP3-004…/scripts/02-deploy-apps.sh`) is safe, because the old image ignores `requires` and runs `run`.
- Imported francois apps have no actors, so they're unaffected.

### What should be done in the future
- Phase 7: bring `lab/src/kernel/prelude.js` and the lab seeds to the object form.

### Code review instructions
- `Actor.readShape` and `Actor.mayCall`; then the diff of `apps/*/actor.js` and `examples/*/actor.js` (mechanical).
- Validate with `GOWORK=off go test ./pkg/server -run 'TestAction|TestActors|TestJournalExample|TestGuestbookExample' -count=1`.

## Step 6: Phase 4, self and visitor in actors

Code with no person behind it now acts as `store:<id>`, everywhere: alarms, reactors, setup, platform calls, trusted-module calls and store-to-store calls. Nothing borrows the owner. Trust in a module gained provenance, the same rule as links: it counts only while the admin who made it is still an admin, checked on every call. Cross-store handles decide again on every use.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Phase 4 (decisions 3 and 5), with the amendment that trusted modules act as the store.
**Inferred user intent:** One rule for whose authority code uses, and no confused deputy.
**Commit (code):** fd9c626 — "SLOP3-007 phase 4: self and visitor in actors"

### What I did
- Tests first (`core_test.go`), each failing on phase 3's code:
  - `TestAlarmPlatformActsAsStore`: `policy.set … @store` refused, `audience is guest, member, subscriber or admin`;
  - `TestAlarmSampleNeedsStoreCellAndBudget`: the alarm sampled through the owner's `@admin` cell;
  - `TestStoresOpenRechecks`: a kept handle still read after `grant.rm` (`got 200 map[result:true]`).
- `pkg/system`:
  - migration `007_store_audience.sql` rebuilds `app_policy` so its CHECK allows `store`;
  - `PolicyAudiences` gains `store`;
  - `DefaultPolicy` gives `assets` to `InGroup(aud, "member")`, so not to stores;
  - `Trusted` joins `people` and requires `granted_by` to be `system` or still `role = 'admin'`.
- `pkg/access`:
  - `AudStore`;
  - `AudienceOf(KindStore)` is `store`, or `admin` when `Principal.Trusted`;
  - `IsAdmin` is true for a trusted store principal.
- `pkg/actor`:
  - `storeVisitor` is `store:<id>`, level owner, audience `store`, payer `store:<id>`;
  - the policy fallback outside a turn is `store` (was `admin`);
  - `stores.open` gets `fresh()`, which re-runs `Can` and reloads the target's rules in the calling turn; every handle function uses it, and `call` passes the fresh level with audience `store`.
- `pkg/server`:
  - `verbModule` and `callVerb` take the module name;
  - every module call re-checks `Trusted`;
  - `actAs` returns a store principal for `store:` visitors (read-only as before; `Trusted` set from the live trust row);
  - `platformModule` acts as the store principal for `store:` visitors;
  - a `Confirm` function refuses when there is no person.
- `pkg/verbs/policy.go`: `llm.set` accepts `@store` and `store:<id>` (checked to exist); `llm.usage store:<id>` for admins.
- Back office: a `store` column in the policy matrix, and `@store` in the LLM subject list.
- Added `TestTrustEndsWithItsAdmin`: ada (an admin) trusts the tool app; after ada is demoted, the next module call is refused with `… is no longer trusted with system`.

### Why
- The doc's original rule for trusted modules ("act as `granted_by`") borrows a person; the amendment keeps one rule. The back office's system reactor (`w2_test.go`) still lists stores, as a trusted store principal with admin reads, and its write attempt (`grants.set`) is still refused (module writes need a person).
- Re-checking `Trusted` on every call. Without it, trust revoked by demotion would persist in a running actor until restart, because `use()` is evaluated only at start.

### What worked
- All Go tests, vet, gofmt and runtime tests pass.

### What didn't work
- `TestAlarmPlatformActsAsStore` first expected `permission_denied` and got `code:not_found`. That is correct behavior: a principal with no level on a store isn't told it exists. The test now accepts either refusal, but not success.
- `TestLLMBudgets` timed out at `p6_test.go:123` (`waiting for the digest`): the alarm no longer had the owner's cell. Updated on purpose, as the plan's table says: the test sets the `@store` cell and a `store:ai` row, checks the owner and sam aren't charged, and that `store:ai` is.
- My phase-1 `TestPolicyThroughGroups` expected `effective` true for every non-guest column; the new `store` column is outside `@member`. Fixed the expectation to `InGroup(aud, "member")`.

### What I learned
- `stores.open` captured the opening turn's `ctx`. Using the calling turn's context in `fresh()` also fixes handles used in a later turn, which ran with the older context.

### What warrants a second pair of eyes
- A trusted store principal is `IsAdmin()` and audience admin, but only for reads (`actAs` refuses writes for `store:` visitors). If a later change lets store principals write through modules, `Trusted` would grant admin writes; that must stay deliberate.
- `Trusted` now hides trust rows whose admin was demoted. `app.modules` still lists the row (it reads `app_modules` directly). Showing it as inactive would mirror `grant.ls`.

### What should be done in the future
- `app.modules`: mark trust rows that no longer count.
- Production: before alarms that sample keep working, the operator sets the `@store` cell and a `store:<id>` or `@store` LLM row (today's production has no sampling alarms).

### Code review instructions
- `pkg/server/modules.go` (`callVerb`, `actAs`), `pkg/server/platform.go`, `pkg/actor/manager.go` (`storeVisitor`), `pkg/actor/modules.go` (`fresh`), `pkg/system/modules.go` (`Trusted`).
- Validate with `GOWORK=off go test ./pkg/server -run 'TestAlarm|TestStoresOpen|TestTrust|TestModuleTrust|TestSystemModule|TestLLMBudgets' -count=1`.

## Step 7: Phase 5, the budget ledger

Model budgets are hard now. Each model round holds what it may cost before the provider is contacted, its output is capped at that hold, and it settles with its actual usage. Parallel calls can no longer spend past a limit. The phase-0 overspend test passes 30 runs in 30.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Phase 5 (decision 6): a ledger with a hold per model round.
**Inferred user intent:** Budgets that mean what they say, however many tabs or alarms run at once.
**Commit (code):** f43f854 — "SLOP3-007 phase 5: model budgets as a ledger, held per round"

### What I did
- Migration `008_ledger.sql`: `llm_usage.reserved_tokens` and `llm_holds` (id = `<call>/<round>`, account, period, amount, output, used, state, created/expires).
- `pkg/system/ledger.go`:
  - `Reserve(account, limit, input, maxOut, key)`. In one transaction: the existing hold for the key (a retry), else read used+reserved; avail = limit − used − reserved − input; avail ≤ 0 → `ErrQuota`; output cap = min(maxOut, avail); amount = input + cap; insert the hold; add to reserved.
  - `Settle(id, used)`, where used < 0 means the whole hold; `Release(id)`; `ExpireHolds()`.
  - `Meter`, implementing `llm.Meter`: `Before` settles a previous round that reported no usage in full, then reserves; `Usage` settles the open round; `Close` settles anything still open in full.
  - All through `ledgerTx` (no epoch move, no `OnLog`).
- `pkg/llm`:
  - `Request.Meter`, the `Meter` interface and `Estimate`;
  - gepp calls `Before` before each round with `contextBytes(t)` plus 2000 per image, and lowers `perRound` to the returned cap;
  - `Fake` calls it once and truncates its text to the cap.
- `pkg/server/sample.go` and `pkg/actor/sample.go`:
  - make a meter for the payer and limit;
  - settle on each `usage` event and `Close` after `Sample`;
  - a `*llm.Failure` with `quota_exceeded` is reported with that code (the page stream used to say `upstream_error`);
  - `AddLLMUsage` deleted.
- `LLMFor`: remaining = budget − used − reserved.
- The minute ticker calls `ExpireHolds`.
- Tests:
  - `TestConcurrentSamplesCannotOverspend` unskipped: 0 failures in 30 runs;
  - `pkg/system/ledger_test.go`: `TestReservationsDoNotMoveEpoch`, `TestHoldExpiresAtFullAmount` (with the settable clock), `TestRetryReusesHold`, `TestConcurrentReservationsStayWithinLimit` (50 goroutines, limit 500, input 20, output up to 80; the sum of holds stays ≤ 500 and some are refused).

### Why
- **Holds cap output.** Without the cap, a round could settle more than it held, and the invariant (spent + reserved ≤ limit) would depend on estimates. With the cap, only the input estimate must be conservative.
- **One token per byte as the input estimate, not bytes/3 as the plan suggested.** The fake model counts bytes as tokens, so bytes/3 would let it settle above its hold. For real models one per byte overestimates about 3–4×. That's the safe direction: it only refuses a little earlier near the end of a budget.
- **Settling from the caller's usage events, not inside the backend.** Both backends already emit one usage event per round, so the backend change is a single `Before` call per round.

### What worked
- All Go tests, vet, gofmt and runtime tests pass. `go test ./pkg/system -count=3` is green.

### What didn't work
- `TestLLMBudgets`: `p6_test.go:96: call 2: 200 map[result:map[text:slop is conn usage:map[input:4 output:12]]]`. This is the intended change: with 16 tokens left and 4 held for input, the third call may write 12. It is cut short and spends exactly the budget (used 60, not 66). Test updated to expect it.

### What I learned
- With no `maxTokens` from the page, a budgeted caller's round holds everything that's left. Parallel calls from one person then run one after another rather than overspending. The plan's note stands: the server should set an output cap per call (today 65,536 when the page sends 0).

### What warrants a second pair of eyes
- `Meter.Close` charges an open round in full. If `Sample` fails after `Before` but before the provider was contacted (for example engine construction fails), the payer is charged the hold. That's conservative; `Release` exists if we later want to tell the cases apart.
- `ResetLLMUsage` zeroes used but leaves reserved, so open holds still count after a reset.

### What should be done in the future
- A server-side default output cap per call.
- Phase 6 (cost units) stays deferred: every tier is deepseek-4.1-flash.

### Code review instructions
- `pkg/system/ledger.go`; the `Before` call in `pkg/llm/gepp/sample.go`; the meter wiring in `pkg/server/sample.go` and `pkg/actor/sample.go`.
- Validate with `GOWORK=off go test ./pkg/system ./pkg/server -run 'Ledger|Reserv|Hold|Retry|TestConcurrent|TestLLMBudgets|TestPageSample' -count=1`.

## Step 8: Phase 7, explanations, worked examples as data, the lab spec

`explain.can` reports groups, and six of the plan's worked examples now run as data-driven cases. The lab's executable spec computes levels by the same max-then-min rule as Go. Phase 6 (cost units) stays deferred, as amended.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Phase 7: explain, shared cases, reconcile `lab/src/kernel/access.js`.
**Inferred user intent:** Executable examples that keep the rules honest, and one spec that agrees with the code.
**Commit (code):** efe2a7e — "SLOP3-007 phase 7: explain shows groups, worked examples as data, the lab agrees"

### What I did
- `pkg/verbs/access.go`: both `explain.can` result shapes add `groups`.
- `pkg/server/testdata/authz/cases.json`: examples 1, 2, 4, 5, 6 and 9. Each step gives `as` (admin or an email, optional `scopes`), a verb, args (`@id:<email>` substitution; `files` as a path → content map) and an expectation (`code`, or a `result` subset).
- `TestWorkedExamples` runs each case on a fresh server; `contains` does subset matching, maps as subsets, everything else exact.
- `lab/src/kernel/access.js` `level()`:
  - sources first (platform admin, owner, grants capped at admin), then ceilings (disabled none, pending interact, token `max_level`, the kind cap);
  - pending users are no longer `none` but guest-like (in `*anyone` only).
- `scripts/02-lab-level-check.mjs` checks the lab's `level()` on a stub database with five cases (pending owner → interact; a member's owner grant → admin; disabled → none; an admin owner → owner; pending on someone else's public store → view).

### Why
- Cases as verb sequences, not fixtures written straight into the database, so they go through every entry check, the way an agent or the CLI would.
- The lab keeps `*anyone`/`*signed-in`. Renaming touches 18 places in 6 files including its UI, and there is no runner for the lab kernel yet (it needs its SQLite build), so a rename couldn't be verified. The rule, which is the part that disagreed with Go, is reconciled.

### What worked
- `TestWorkedExamples`: 6/6.
- The lab check: 5/5 (`node scripts/02-lab-level-check.mjs <repo>/lab/src/kernel/access.js`).
- Full gate: Go tests, vet, gofmt, runtime 9/9.

### What didn't work
- No failures observed. (A first-try pass deserved a check: each case asserts something the earlier phases changed, namely the guest ceiling on a mistaken admin grant, `groups: ["@store"]`, the pending cap, and `@subscriber` inheriting the `@member` cell with the larger row.)

### What should be done in the future
- A node runner that replays `cases.json` against the lab kernel, after renaming its groups to `@guest`/`@member`.
- Example 3 (share links) and example 8 (nightly digest) as data, once the case format can drive a site session and fire alarms.

### Code review instructions
- `pkg/server/testdata/authz/cases.json`, `TestWorkedExamples`, `lab/src/kernel/access.js` `level()`.

## Step 9: Pull request

Pushed `task/slop3-007-authority-core` (17 commits on `main` at 9d0db5e+) and opened https://github.com/go-go-golems/slop-computer/pull/17. The PR body lists the behavior changes, the tests changed on purpose, and the deploy order: re-push the built-in apps first, so their declared `requires` is in place before the image that enforces it. The plan's done-when checks hold:
- no `AtLeast(`, `audRank` or `capOf` remain;
- `AddLLMUsage` is gone;
- no code sets a payer to a store's owner.

`AudienceOf` stays, as the function that names a principal's highest group.

## Step 10: Review on #17, holds that count tools and quota codes that survive

Codex left two findings on the ledger, and both were real. A round's hold left out the tool definitions sent with that round (P1). And the production backend turned the meter's `quota_exceeded` into `upstream_error`, so the new quota handling never ran with gepp (P2). The fake backend returns errors directly instead of as events, which is why phase 5's tests didn't catch the second.

### Prompt Context
**User prompt (verbatim):** "Address code review comments on https://github.com/go-go-golems/slop-computer/pull/17"
**Assistant interpretation:** Fix the two findings, with tests; reply on the threads.
**Inferred user intent:** A sound hard-budget guarantee before merge.
**Commit (code):** 5493c1a — "Budget holds count tool definitions; quota refusals keep their code (review on #17)"

### What I did
- `pkg/llm/gepp/sample.go`:
  - `toolBytes` (name + description + schema, plus 64 per tool) is added to the input estimate on rounds that offer tools;
  - `framingTokens` (256) is added on every round;
  - `offersTools` is computed once, and decides both the estimate and the tool registry;
  - `Sample` passes an `*llm.Failure` through with its code.
- `pkg/actor/sample.go`: an `error` event with `quota_exceeded` keeps that code (others stay `unavailable`). The page stream already forwards the event's code (`case "error": send("error", e.Error)`).
- `pkg/llm/gepp/gepp_test.go`: a `meterFunc` test double.
  - `TestMeterRefusalKeepsQuotaCode`: the code is `quota_exceeded` and `p.bodies` is empty, so the provider was never contacted.
  - `TestMeterHoldsToolDefinitions`: round 0's estimate exceeds a tool-less request's by at least the definition size; round 1 (no tools) doesn't.
- Replied on both threads (discussion_r4448283091, discussion_r4448283449).

### What I learned
- Phase 5's tests exercised only the fake backend. It returns the meter's error straight from `Sample`, while gepp turns every error into an event. Different error boundaries need separate tests; now each backend has one.

### What warrants a second pair of eyes
- Settlement still charges actual usage without bounding it by the hold, which keeps the accounting honest. The invariant rests on the estimate being conservative: now context + images + tools + framing at one token per byte.

### Code review instructions
- `GOWORK=off go test ./pkg/llm/gepp -run TestMeter -count=1`.
