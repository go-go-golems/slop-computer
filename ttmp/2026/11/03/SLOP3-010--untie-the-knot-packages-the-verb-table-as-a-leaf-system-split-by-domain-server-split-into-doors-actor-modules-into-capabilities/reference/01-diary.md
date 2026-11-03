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

## Step 2: PR 1, the verb table as a leaf

`pkg/verbs` now imports only `access`, `authz`, `rt` and `jsonschema`. The 85 commands are in `pkg/commands`, bound to an Env by closures, and every door holds a `*verbs.Table`. The verb table is byte-identical before and after. Two things went wrong on the way: the package-level delegates silently read the wrong table, and a mis-staged commit. A flaky test from SLOP3-009 turned up and was fixed separately.

### Prompt Context
**User prompt (verbatim):** see Step 1 ("… Then step1").
**Assistant interpretation:** Implement the guide's Part 7 as a pull request stacked on #22.
**Inferred user intent:** The first knot untied, reviewable as a move.
**Commit (code):** c0f7926 — "TestRegistryDocumentsLive: step through the changes, one event each"; bce5df8 — "SLOP3-010 PR 1: the verb table as a leaf". PR #23 (base: #22's branch).

### What I did
- **Baseline first.** I built the binary on #22's head and captured `slop verbs -o json`, `slop verbs tools -o json`, and `--help` for all 86 verbs.
- **`git mv`** of 13 command files plus `actions_test.go` from `pkg/verbs` to `pkg/commands`.
- **Qualification by AST, not by regex.** A throwaway go/ast program (`$CLAUDE_JOB_DIR/tmp/qualify`) rewrote unresolved identifiers naming `pkg/verbs` exports to `verbs.X`. It skips selectors, struct-literal keys, field names and anything the target package declares, and made 513 rewrites across 14 files. A regex would have rewritten `Read` inside doc strings and `Args:` field keys.
- **A Python pass** turned each `func init() { … Register( … ) }` into `func xVerbs(e *Env) []*verbs.Verb { … return []*verbs.Verb{ … } }`, removed `e *Env, ` from 81 Run signatures, and turned `a.obj(k)`/`a.list(k)` into `argObj(a, k)`/`argList(a, k)`. Methods can't be defined on another package's type.
- **`pkg/verbs/verb.go`:** `Run`, `Stores`, `Table` (Register, Get, All, Check, Callable, Call) and `Default`. The admin-role check compares `"admin"` instead of importing `system`.
- **`pkg/verbs/def.go`:** `Req{Context, Principal}`.
- **`pkg/verbs/confirm.go`:** `NewConfirmations`. The `confirm.approve` verb moved to `commands/confirm.go`.
- **`pkg/commands/commands.go`:** `Verbs(e)`, `Install(t, e)`, `(*Env).Check` (implements `verbs.Stores`), `sampleDeps`.
- **`pkg/caps/sample`:** `Verbs(Deps{Sys, Backend func() llm.Backend, Access})` replaces its `init()`.
- **Call sites:**
  - `Server.Verbs`; `New` installs into a fresh table;
  - `registry.Docs{Verbs, Confirm, Access}`;
  - api, mcp, modules, platform, live, rtfiles;
  - `cmd/slop` root (`sync.Once` Install into Default) and serve;
  - the harness.
- **Tests:**
  - `pkg/verbs/def_test.go` was rewritten on test-only types: TestDefArgs, TestDecodeArgs, and TestTable (scope, required args, no leak into Default, duplicate panic);
  - the real-verb tests moved to `pkg/commands/def_test.go` (TestDefArgs, TestCondForms, TestToolForms, TestEffects, which now sees `sample.run`);
  - `authz_test.go` registers its throwaway verb on `h.srv.Verbs`.
- **Ratchet:** five entries removed; the commands rule added; `pkg/server -> pkg/commands` allowed until PR 3.

### Why
- **No package-level delegates.** See "What didn't work".
- **A fresh table in `server.New`, never `Default`.** The `slop` binary installs the commands into `Default` for the CLI (unbound). `slop serve` runs in the same binary, so installing again into `Default` would panic on the first duplicate name.

### What worked
- **Identity check.**
  - `cmp` of before and after: `verbs-after.json: identical (13963 bytes)`, `tools-after.json: identical (49815 bytes)`, `help-after.txt: identical (42166 bytes)`.
  - Rechecked after the last code change: `table identical`.
- **Ratchet mutations:**
  - `pkg/verbs` → `pkg/actor`: `forbidden import: pkg/verbs -> pkg/actor (the verb table imports no domain, capability, runtime or door)`;
  - `pkg/registry` → `pkg/commands`: `forbidden import: pkg/registry -> pkg/commands (commands are installed by the host and reached through the table, …)`.
- **Suite:** `GOWORK=off go test ./... -count=1` passes. Lint: 0 issues, after `gofmt -s`, which simplified `&verbs.Verb{` in slice literals, and two plain gofmt fixes.

### What didn't work
- **The package-level delegates.** The first version kept `verbs.Register/Get/All/Call/Check` delegating to `Default`, as Part 7.3 of the guide first proposed. Four server tests failed:
  - `confirm_test.go:39: … want confirmation_required, got 404 … no verb "people.role"`;
  - the same in `TestModuleTrust`, `TestSystemModule` and `TestRegistryDocuments` (`no verb "grant.set"`).

  `verbs.Check(p, name, args)` in `pkg/server/modules.go` and `pkg/registry/documents.go` still compiled, but read the empty `Default` instead of the server's table. I removed every delegate so the compiler finds such calls (`modules.go`, `documents.go`, `mcp.go`'s `Callable`, `cmd/slop`'s `All`), and updated the guide.
- **A mis-staged commit.** My first commit of the test fix (a07e42d) also contained the 14 staged `git mv` renames, at their original `package verbs` content, so it didn't build. It wasn't pushed. I redid it with `git reset --soft HEAD~1 && git reset`, committing the test file alone (c0f7926, verified to build and pass in its own worktree), then PR 1 (bce5df8, renames detected). Lesson: `git mv` stages; commit nothing else until the move's commit.
- **`TestRegistryDocumentsLive` failed once in 30 runs:** `pathspace_test.go:732: live registry documents: [_stores/crm type=contacts]`, after 5.04 s.
  - On #22's head it passed 40 and then 60 times, and on PR 1 60 times, so it was rare and not PR 1's.
  - First hypothesis: `View.Send` drops events while no stream is attached, and the test started its changes after a fixed 200 ms. Waiting for `hello` still failed once in 100.
  - **Cause:** the follower is asynchronous. When `grant.rm` commits before the pass triggered by `grant.set` reads the grants, that pass sees no grant before and after, and sends nothing. The final state is right; the test demanded every intermediate state.
  - Fix (test only): each change waits for its event, after `hello`. 150 of 150.

### What I learned
- An empty default table is worse than no default. The delegates made the move compile while silently changing behaviour, and only the end-to-end tests saw it.
- The follower coalesces by design. A page sees the registry's states at the follower's passes, not every commit. This belongs in the registry documents' description (SLOP3-009 step 3).

### What was tricky to build
- **Qualifying identifiers safely.** `Scope: Read` needs `Read` → `verbs.Read` but must keep `Scope`. `Args: []Arg{…}` needs `Arg` → `verbs.Arg` but must keep `Args:`. The go/ast tool handles both because the parser marks struct-literal keys and leaves package-level names unresolved (`Ident.Obj == nil`).

### What warrants a second pair of eyes
- **The CLI's listing table is unbound.** If a future CLI-side feature calls `verbs.Default.Call`, every command would dereference a nil Env. The table's `Stores` is nil there, so store verbs refuse with `unavailable`, but a verb without a store would panic.

### What should be done in the future
- PR 2: `system.db` split by domain (guide Part 8).

### Code review instructions
- `git show -M bce5df8 -- pkg/verbs`: the table.
- `git show -M bce5df8 -- pkg/commands/commands.go pkg/commands/env.go`: Install and the Env.
- One command file, e.g. `git show -M bce5df8 -- pkg/commands/stores.go`: the mechanical change.
- To repeat the identity check: build `cmd/slop` on #22's head and on #23's, then `cmp` the outputs of `slop verbs -o json` and `slop verbs tools -o json`.
