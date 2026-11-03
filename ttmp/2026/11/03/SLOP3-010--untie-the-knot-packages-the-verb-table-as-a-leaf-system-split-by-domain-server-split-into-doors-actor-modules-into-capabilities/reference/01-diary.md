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

### What worked
- PR #22 opened: `gh pr create --base main --head task/slop3-009-typed-verbs` → https://github.com/go-go-golems/slop-computer/pull/22
- The ticket and its docs: `docmgr ticket create-ticket --ticket SLOP3-010 …`, plus `docmgr doc add` for the design doc and the diary. They were written in a temporary worktree of `origin/main` and pushed to main as 1ddf9b1, because ticket-doc commits go straight to main.
- The guide was uploaded to reMarkable by a small-model subagent: `OK: uploaded SLOP3-010 Untying the knot packages - intern guide.pdf -> /ai/2026/11/03/SLOP3-010`, on the first attempt.

### What didn't work
- The first count of verbs in the guide ("about 150") was a guess. It came from a grep that also counted the `Name:` fields of arguments. `slop verbs | grep -c verb:` gave 86, and the guide was corrected before committing.

### What I learned
- `pkg/system`'s files map almost one-to-one onto domains by the tables their SQL touches. Three files cross domains:
  - `guests.go` (people, sessions, grants);
  - `modules.go` (app_modules, people);
  - `stores.go` (stores, grants, links).
- 95 distinct `Sys.X` methods are called outside `pkg/system`, which is the size of PR 2's call-site work.

### What was tricky to build
- **Making the guide readable from zero without inventing anything.** Every term in Part 2 is introduced only after the terms it uses, and every claim names its file. The two request traces (Part 3) follow the code path by path (`views.go` → `caps/db` → `store.Do`, and `api.go` → `verbs.Call` → `Def.Run` → `system.Tx` → the follower).

### What warrants a second pair of eyes
- **Part 8.5** (`access.Directory`) is the one design change in the plan, not a move. `pkg/access` reads `system.Person`, `StoreRow`, `Grant`, the role constants, `GroupsOf`/`InGroup` and `ErrNotFound`. `pkg/authz` imports `access`, and `pkg/store` imports `authz`. So the boundary decision affects core.

### What should be done in the future
- Step 2: PR 1.

### Code review instructions
- Read the guide's Part 7, then check each call site in its table 7.5 against the code.

### Technical details
- **Line counts** (non-test Go on the branch):

  | Package | Lines |
  |---|---:|
  | `server` | 5,872 |
  | `verbs` | 3,634 |
  | `system` | 3,129 |
  | `actor` | 3,024 |
  | `store` | 1,716 |
  | `rt` | 1,670 |
  | `kernel` | 561 |
  | `registry` | 472 |
  | `caps/db` | 421 |
  | `caps/sample` | 201 |
- **Imports of `pkg/verbs` before PR 1** (slop and third-party): access, actor, apps, authz, billing/stripe, blobs, config, ids, kernel, rt, store, system, goja, jsonschema.
- **The SQL of each `pkg/system` file** maps to these tables:
  - `billing.go`: comps, stripe_*, checkout_attempts;
  - `bindings.go`: bindings, schedules;
  - `ledger.go`: llm_holds, llm_usage;
  - `policy.go`: app_policy, llm_access, llm_usage, secrets;
  - `stores.go`: stores, grants, links;
  - `sessions.go` and `people.go`: people, sessions, tokens;
  - `system.go`: `_log`, `_changes`, `_schema`.
- The guide's file is `design-doc/01-untying-the-knot-packages-an-intern-s-guide-to-slop-computer-and-its-reorganization.md`. Diagrams are ASCII, so they render in the reMarkable PDF.

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

### Technical details
- **The table** (`pkg/verbs/verb.go`):
  ```go
  type Run func(ctx context.Context, p *access.Principal, a Args) (any, error)
  type Stores interface {
      Check(ctx context.Context, p *access.Principal, store string, need rt.Level, what string) error
  }
  type Table struct { Stores Stores; byName map[string]*Verb }
  func NewTable() *Table
  func (t *Table) Register(vs ...*Verb)
  func (t *Table) Get(name string) (*Verb, bool)
  func (t *Table) All() []*Verb
  func (t *Table) Check(p, name, a) error
  func (t *Table) Callable(p, v) bool
  func (t *Table) Call(ctx, p, name, a) (any, error)   // Stores.Check on the verb's store, then Run
  var Default = NewTable()                            // the CLI's listing table; no package-level Call/Get/Check
  ```
- **The commands** (`pkg/commands/commands.go`): `Verbs(e *Env)` concatenates 13 group functions and `capsample.Verbs(sampleDeps(e))`. `Install(t, e)` registers them, and with an Env sets `e.Confirm` (if nil), `e.Verbs = t` and `t.Stores = e`.
- **The rewriter**, `$CLAUDE_JOB_DIR/tmp/qualify/main.go` (not committed): it parses `pkg/verbs` for exported top-level names, then rewrites every `*ast.Ident` in `pkg/commands` with `Obj == nil`, unless it is skipped or the target declares the name. Selectors' `Sel`, `KeyValueExpr` keys and `Field` names are skipped.
- **Byte counts of the identity check:** `verbs -o json` 13,963, `verbs tools -o json` 49,815, the help of 86 verbs 42,166 (1,308 lines).

## Step 3: PR 2, system.db split by domain (the moves)

`pkg/system` held six domains' queries in one package. Seven commits moved them out. Each commit compiles and passes the full gate:

- `pkg/sysdb` takes the core and the shared rows;
- `pkg/identity`, `pkg/registry`, `pkg/llm`, `pkg/policy` and `pkg/billing` take their queries;
- one commit gives `pkg/access` a `Directory` instead of a database handle.

Callers have not changed yet. `system.DB` is a temporary composite that embeds every domain type and forwards the moved names. The next step points each caller at its domain and deletes `pkg/system`.

### Prompt Context
**User prompt (verbatim):** "go ahead. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"; mid-step: "backfill the diary using the right format from the diary skill, if necessary" (done: db8b394 on main, 4610d52 on #22's branch), "#22 merged", "merged #23 as well", and then "oh sorry i haven't merged #22".
**Assistant interpretation:** Implement PR 2 of the guide (Part 8), committing per domain, with a diary entry per milestone.
**Inferred user intent:** Continue untying the knots, reviewably and with a record.
**Commit (code):** on `task/slop3-010-pr2-sysdb`, stacked on #22's branch (which now also holds #23):

| Commit | Change |
|---|---|
| 9179752 | (1/7) `pkg/sysdb` |
| e2c1476 | (2/7) identity |
| d4622f5 | (3/7) `access.Directory` |
| 9a4883b | (4/7) registry |
| 0d382f8 | (5/7) llm |
| ed9a240 | (6/7) policy |
| 2cb14e5 | (7a/7) billing |

### What I did
- **`pkg/sysdb`**:
  - `system.go` moved here: `Open`, migrations, `Tx`, `Listen`, `Epoch`, `Log`/`LogAfter`/`LogHead`/`Logs`, `Change`, `Execer`, `LogEntry`, `ErrNotFound`. The unexported helpers are exported as `NullStr`, `NullInt` and `SplitScopes`;
  - `migrations/001…010` moved unchanged;
  - new `records.go` holds the rows several domains and `access` read: `Person` and the roles, the scopes, `StoreRow`, `Grant`, `GrantLink`, `Link`, `LevelRank`/`ValidLevel`, `GroupsOf`/`InGroup`.
- **The transitional composite** (`pkg/system/compat.go`): `type DB struct{ *sysdb.DB; *identity.Accounts; *registry.Registry; *llm.Ledger; *policy.Governance; *billing.Book }`, with `Open` building every domain over one `*sysdb.DB`, plus aliases for every exported name that moved.
- **The domains.** Each moved file's methods hang off its domain type, an `*sysdb.DB` with a constructor in `<type>_db.go`:

  | Package | Type | Files from `pkg/system` |
  |---|---|---|
  | `pkg/identity` (next to `oidc.go`) | `identity.Accounts` | people, sessions, device, flows, handoffs, guests |
  | `pkg/registry` (next to the registry documents) | `registry.Registry` | stores, links, bindings, previews, mounts |
  | `pkg/llm` | `llm.Ledger` | `ledger.go`, plus the LLM half of `policy.go` (split out first as `llmaccess.go`) |
  | `pkg/policy` (new) | `policy.Governance` | `policy.go` (cells and secrets), `modules.go` |
  | `pkg/billing` | `billing.Book` | `billing.go` |
- **`access.Directory`:** `access.Directory{StoreByID, Grants, Person, NowMs}` replaces `Checker.Sys`; the kernel passes `sys`. `access` imports only `rt` and `sysdb`. The ratchet's `pkg/access -> pkg/system` entry is gone, so the allowlist is down to `pkg/server -> pkg/commands`.
- **`registry.Docs.Sys` is now `*registry.Registry`.** `LastChange`, `lastChangeUpTo` and `storeVersion` take `*sysdb.DB`, so `registry` no longer imports `system`, which would have been a cycle.
- **`TestLevelNeverAboveCap` is now an external test** (`package access_test`). It opens system.db through `pkg/system`, which imports `registry`, which imports `access`: an internal test would be a cycle.
- **Ratchet:**
  - `pkg/sysdb` joins core and `pkg/policy` joins domains;
  - the identity rule now allows exactly `sysdb` and `ids` (design §8), with a `without` helper.
- **Tools** (job tmp, not committed):
  - `movedom.py <dir> <pkg> <Type> <files>` does `git mv`, renames the package, rewrites `(d *DB)` → `(d *Type)` and the four unexported helpers, qualifies `sysdb` names with the go/ast qualifier, writes the domain type, and extends the composite and aliases;
  - `gate.sh` runs build, vet, the full suite and lint, failing on the first non-zero exit.

### Why
- **Shared rows in `sysdb` rather than copies in `access`.** The guide (Part 8.5) proposed that `access` keep its own `Person`, `StoreRow` and `Grant`. `Principal.Person` is used across the code (`p.Person.ID`, `.Role`, `.Name`), so copies would have rippled everywhere for no gain. `sysdb` is core, so `access` may import it. The queries go through `Directory`, which is the part that matters for the layering.
- **The composite.** It keeps every commit compiling and every caller untouched, so each domain commit is a pure move that reviewers can read as one. The rewire is then one compiler-driven commit.
- **Type names that don't collide with methods.** An embedded field takes its type's name, so `policy.Policy` would have shadowed the promoted `Policy(ctx, app, capability, audience)` method. Hence `Governance`, `Accounts`, `Book`.

### What worked
- `gate.sh` printed `GATE: ok` after every commit: build, vet, `go test ./... -count=1`, and `golangci-lint run --new-from-rev=origin/main` with 0 issues.
- **Ratchet mutation:** `pkg/access` importing `pkg/system` again → `forbidden import: pkg/access -> pkg/system (core imports no domain, capability, runtime, table or door)`.
- `pkg/access` imports `context errors fmt pkg/rt pkg/sysdb slices`; `pkg/sysdb` imports the standard library and sqlite3.

### What didn't work
- **The qualifier rewrote a declaration's own name.** `panic: format.Node internal error (25:25: expected '(', found '.')` on `pkg/identity/people.go`: the method `func (d *Accounts) Person(…)` matched sysdb's `Person` type. The tool now skips `FuncDecl`, `TypeSpec`, `ValueSpec` and label names. The four files it had already processed couldn't have been affected, since `format.Node` would have failed on them too.
- **A lint failure was committed.** The identity commit's chain `… | tail -3 && git commit` committed despite `3 issues: nonamedreturns: 1, unused: 2`, because the pipe hid lint's exit status. I fixed it (`Origin` without named returns; two unused aliases) and amended the unpushed commit (e2c1476). After that, every commit went through `gate.sh`.
- **The ratchet's old identity rule failed:** `forbidden import: pkg/identity -> pkg/sysdb (identity imports no other slop package)` (and `-> pkg/ids`). The rule was relaxed as described above.
- **A nil pointer in the composite.** After the registry move, `TestWorkshopModule`: `http: panic serving …: runtime error: invalid memory address or nil pointer dereference` at `pkg/registry/stores.go:36` (`AddStore`). `movedom.py` set the composite's new field by replacing `return &DB{DB: d}, nil`, which no longer existed after the first domain, so `Registry` was never set. I fixed `compat.go` and made the script replace with a regex that asserts one match.
- **An untracked file can't be `git mv`'d:** `fatal: not under version control, source=pkg/system/llmaccess.go` (created by the split). The script had already moved `ledger.go`, so I moved it back, ran `git add`, and reran.
- **My regex mangled the meter rename:** `\bMeter\b(?!\))` turned `var _ llm.Meter = (*Meter)(nil)` into `var _ llm.BudgetMeter = (*Meter)(nil)`. Fixed by hand: `var _ llm.Meter = (*BudgetMeter)(nil)`, `func (m *BudgetMeter)`.
- **Moved code counts as new to lint,** which flagged pre-existing code:
  - `errcheck` on `defer rows.Close()` (`pkg/llm/llmaccess.go:145`, `pkg/policy/policy.go:80,208`), now `defer func() { _ = rows.Close() }()`;
  - `nonamedreturns` on `Origin`;
  - each `unused` compat alias, once its last user moved.

### What I learned
- `pkg/system`'s files are nearly independent. A script found only shared types crossing files, plus two calls that stay inside one domain (device → sessions in identity, `LLMFor` → `LLMReserved` in llm). That's why every domain could move as a single `git mv` plus a rename of the receiver.
- `golangci-lint --new-from-rev` treats a moved file as new, so a pure move inherits lint debt. Expect small cleanups in every move PR.

### What was tricky to build
- **The order of the domains, driven by cycles:**
  - `system` (composite) imports `registry`, `registry` imports `access`, and `access` imported `system`. So `access.Directory` had to land before the registry move;
  - `registry.Docs` held a `*system.DB`, the same cycle. Pointing it at `*registry.Registry` fixed that.
- **Packages that call into themselves after the move.** `pkg/llm` and `pkg/billing` already existed, and the moved files referred to `llm.Usage` and `billing.Comp`. Inside their own package those would be self-imports, so the `llm.`/`billing.` qualifiers were stripped.

### What warrants a second pair of eyes
- **Cross-domain SQL stays.** Moved queries still touch other domains' tables, for example `registry.DeleteStore` (grants, links), `identity` guests (grants), and `policy` modules (people). The ratchet can't see SQL. These are the next seams if a domain ever leaves.
- **Shared record types in `sysdb` widen its role** from the database handle to the platform's row shapes. Review whether `Grant`/`Link` belong there or should stay in registry behind `Directory`.

### What should be done in the future
- Step 4: rewire the callers to the domain types, delete `pkg/system`, move `groups_test.go` and `ledger_test.go`.
- Moving domain commands next to their domains (guide 8.6) is not done. It is a candidate for PR 2's last commit or its own PR.

### Code review instructions
- Read commit by commit; each is mostly renames. Start with `git show -M 9179752 -- pkg/sysdb/records.go pkg/system/compat.go`, then `git show -M d4622f5 -- pkg/access`.
- `GOWORK=off go test ./pkg/access ./pkg/registry ./internal/archtest ./pkg/server -count=1`

### Technical details
- **The composite during the transition:**
  ```go
  type DB struct {
      *sysdb.DB
      *identity.Accounts
      *registry.Registry
      *llm.Ledger
      *policy.Governance
      *billing.Book
  }
  ```
  `sysdb`'s methods are found at depth 1; each domain embeds `*sysdb.DB` too, at depth 2, so the shallower one wins with no ambiguity.
- **`access.Directory`:**
  ```go
  type Directory interface {
      StoreByID(ctx, id) (sysdb.StoreRow, error)
      Grants(ctx, store) ([]sysdb.Grant, error)
      Person(ctx, id) (sysdb.Person, error)
      NowMs() int64
  }
  ```
- **The qualifier now skips** `SelectorExpr.Sel`, `KeyValueExpr` keys, `Field` names, `FuncDecl`/`TypeSpec`/`ValueSpec` names and labels. It rewrites only idents with `Obj == nil` that are exported by the source and not declared by the target.

## Step 4: PR 2, callers use the domains; pkg/system is gone

The last commit of PR 2 removed the composite. Every caller now names the domain it uses, through the kernel's handles (`k.People`, `k.Registry`, `k.Ledger`, `k.Gov`, `k.Book`). `pkg/system` is deleted, and its two tests were split among `sysdb`, `policy` and `llm`. PR #24 is open, stacked on #22.

Against the plan, the commands did not move into their domains. Most of them coordinate the kernel and several domains, so they can't live in a domain the kernel imports. The guide is updated.

### Prompt Context
**User prompt (verbatim):** see Step 3 ("go ahead. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)").
**Assistant interpretation:** Finish PR 2: rewire, delete `pkg/system`, validate, open the PR.
**Inferred user intent:** The second knot untied.
**Commit (code):** 9172a9c — "SLOP3-010 PR 2 (7/7): callers use the domains; pkg/system is gone". PR #24: https://github.com/go-go-golems/slop-computer/pull/24

### What I did
- **`rewire.py`** (job tmp, not committed):
  - built a map of 109 domain methods to their handle field from the domain packages' source (`func (d *Accounts) X(`, …), the sysdb members from `pkg/sysdb/sysdb.go`, and the forwarded names from `compat.go`;
  - rewrote `<holder>.Sys.M(` per package: `k.`/`….K.` → `k.<Field>`, the server's `s` → `s.<Field>`, commands' `e` → `e.K.<Field>`, tests' `h.sys` → `h.k.<Field>`, the sampler's `s` → `s.Ledger`;
  - rewrote `system.X` → `sysdb.X` or `<domain>.X`, fixing imports. 52 files changed. The items it listed as unplaced were strings and comments ("system.db", JS names like `system.call`) and `registry.Docs`'s `d.Sys.StoreByID`, which is already right.
- **By hand, compiler-driven:**
  - `kernel.Kernel` fields and `kernel.New(cfg, *sysdb.DB)`, which builds the five domains; a `directory{k}` adapter for `access`;
  - `server.Server` fields, from `env.K` or built over `sys` when there is no kernel;
  - `commands.Env` lost `Sys` (`e.Sys.` → `e.K.Sys.`);
  - `stripe.Service.Store` is now `*billing.Book`;
  - `capsample.Sampler`/`Deps` carry a `Ledger`;
  - `env.A.Policy`/`Secret` closures call `s.Gov`.
- **Tests:**
  - `pkg/system/groups_test.go` was split: `TestGroupsOf` → `pkg/sysdb`, `TestPolicyThroughGroups` → `pkg/policy` (with its own `openTestDB`), `TestLLMRowThroughGroups` → `pkg/llm`, next to the ledger tests;
  - `pkg/access/level_test.go` builds identity and registry over `sysdb.Open` with a `dir` Directory.
- **Cleanups lint asked for in moved code:** deleted `commands.(*Env).personChanged` (empty, a leftover of SLOP3-009 step 3), `gofmt` on files with rewritten imports, a stray blank import line in `pkg/verbs/confirm.go` (from PR 1), and the named returns of a test helper.
- **Ratchet:** `pkg/system` removed from the domain layer.
- **Docs:** the guide's Parts 6.1, 8.5 and 8.6 gained "as built" notes; task kbpu is checked; PR #24 is open.

### Why
- **Handles on the kernel.** Commands (`e.K`), actors (`a.m.K`), `caps/db` (`d.K`) and the kernel itself already reach system.db through the kernel. The server's own fields are copies for readability (`s.People.Person(…)`).
- **No commands in domains.** See What I learned.

### What worked
- `gate.sh`: `0 issues.` and `GATE: ok`.
- `ls pkg/system` → `No such file or directory`, and no file imports it.
- **Verb table:** `slop verbs -o json | cmp - verbs-before.json`, then the same for `tools`: `table identical`.
- **Ratchet mutation:** `pkg/identity` importing `pkg/registry` → `forbidden import: pkg/identity -> pkg/registry (identity imports no slop package but sysdb and ids (design §8: it can leave as its own module))`.
- **Imports now:**
  - `pkg/identity`: `pkg/ids`, `pkg/sysdb`, and zitadel/oauth2;
  - `pkg/sysdb`: the standard library and sqlite3;
  - `pkg/access`: `pkg/rt` and `pkg/sysdb`.

### What didn't work
- **My first kernel edit didn't match.** It searched for `Sys    *system.DB`, but the rewire script had already made it `*sysdb.DB`. The build said `k.People undefined (type *Kernel has no field or method People)` (and similar) until I applied it to the real text. Likewise the server struct (`AssertionError: sys field`): its field alignment differed from my pattern, and `cat -A` showed the real text.
- **The rewire script duplicated imports:** `billing redeclared in this block` (`pkg/billing/stripe/service.go:11`), `llm redeclared` (`pkg/caps/sample/sample.go:20`). A file that already imported the target package got a second line. A dedupe pass over every import block fixed it.
- **Test fixes:**
  - `pkg/access/level_test.go:28:28: cannot use d (variable of type *sysdb.DB) as access.Directory value … (missing method Grants)` → a `dir` adapter that embeds `*registry.Registry`, which provides `StoreByID`, `Grants` and `NowMs`;
  - `pkg/policy/policy_test.go:39:14: undefined: InGroup` → `sysdb.InGroup`.
- **Lint rounds:** first `5 issues: gofmt 3, nonamedreturns 1, unused 1`, then `3 issues: gofmt 3` on different files (`site.go`, `sitelinks.go`, `views.go`). `gofmt -l pkg cmd` listed them all at once, and should have been run first.

### What I learned
- **Commands don't belong to one domain.** A count per command file:
  - `stores.go`: 3 kernel calls, plus `Registry`;
  - `billing.go`: 4 kernel calls, plus `Book` and `People`;
  - `policy.go`: 1 kernel call, plus `Gov`, `Ledger` and `Registry`;
  - `mounts.go`: 4 kernel calls, plus `Registry`;
  - `access.go`: 2 kernel calls, plus `People` and `Registry`;
  - only `people.go` uses one domain (`People`) and no kernel.

  The kernel imports the domains, so commands sit above both. Guide Part 8.6 had this wrong.
- **The composite made the final rewire mechanical.** Every forwarded name in `compat.go` was a line of the rewrite map.

### What was tricky to build
- **Holder rules differ per package.** `s.Sys` means the server in `pkg/server` but the sampler in `pkg/caps/sample`; `e.Sys` in commands has no domain fields of its own, so it routes through `e.K`. The script keys the rule on path plus holder, and refuses (`UNPLACED`) anything else.
- **The ledger's `Epoch` in tests.** `pkg/llm`'s ledger test calls `d.Epoch()` on a `*Ledger`, which works because `Ledger` embeds `*sysdb.DB`. Each domain type exposes `sysdb`'s methods that way, deliberately: `NowMs`, `Tx` and `QueryRowContext` are what the queries use.

### What warrants a second pair of eyes
- **Embedded `*sysdb.DB`.** Every domain type exposes all of system.db: `Tx`, raw SQL, and each other's tables. Domain separation is a convention plus the ratchet's import rules, not encapsulation. Unexported embedding (`db *sysdb.DB`) would enforce it, at the cost of rewriting every query's receiver.
- **`server.New` builds a second set of domain handles when `env` has no kernel.** Only tests without an Env do that. The handles are stateless over one `*sysdb.DB`, so two sets are equivalent.

### What should be done in the future
- PR 3: `pkg/server` split into doors (guide Part 9). PR 3 then removes the last allowlist entry (`pkg/server -> pkg/commands`).

### Code review instructions
- `git show 9172a9c -- pkg/kernel/kernel.go pkg/server/server.go pkg/commands/env.go pkg/access`, then skim the mechanical rest (`git show --stat 9172a9c`).
- `GOWORK=off go test ./... -count=1`; then rebuild `cmd/slop` and compare `slop verbs -o json` with a build of #22's head.

### Technical details
- **The kernel after PR 2:**
  ```go
  type Kernel struct {
      Cfg      *config.Config
      Sys      *sysdb.DB
      People   *identity.Accounts
      Registry *registry.Registry
      Ledger   *llm.Ledger
      Gov      *policy.Governance
      Book     *billing.Book
      Blobs    *blobs.Blobs
      Access   *access.Checker  // Dir: directory{k}
      …
  }
  ```
- **Holder rewrite rules** (`rewire.py`), for `<holder>.Sys.<Method>(` when `Method` belongs to a domain:
  - `k`, `K`, or a holder ending in `.K` → `<holder>.<Field>`;
  - `s` in `pkg/server` → `s.<Field>`;
  - `e` in `pkg/commands` → `e.K.<Field>`;
  - `h.sys` in tests → `h.k.<Field>`;
  - `s`/`d` in `pkg/caps/sample` → `<holder>.Ledger`;
  - anything else is `UNPLACED`.

  sysdb members (`Tx`, `NowMs`, `Listen`, `LogHead`, `LogAfter`, `Logs`, `Epoch`, `Now`, the `sql.DB` methods) are not rewritten.
- **PR 2's commits:** 9179752 (sysdb), e2c1476 (identity), d4622f5 (Directory), 9a4883b (registry), 0d382f8 (llm), ed9a240 (policy), 2cb14e5 (billing), 9172a9c (rewire).
