---
Title: Diary
Ticket: SLOP3-002
Status: active
Topics:
    - architecture
    - goja
    - access
    - tools
    - agents
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of SLOP3-002: the design guide and the implementation of phases W1 to W8."
LastUpdated: 2026-11-01T16:20:14.512508729-05:00
WhatFor: "Reviewing what was built in SLOP3-002, why, and what failed along the way."
WhenToUse: "When resuming SLOP3-002 or reviewing one of its commits."
---

# Diary

## Goal

This diary records the work on SLOP3-002: making slop v3's tools (the back
office, a v2-style Workshop) into ordinary apps by giving trusted apps Go
modules that act as the visiting person. Each step follows the
investigation format: what was asked, what was done, what failed, and how
to review it.

## Step 1: The ticket and the design guide

The ticket and its intern guide come first. The guide
(`design-doc/01-tools-as-apps-design-and-implementation-guide-for-interns.md`)
has five parts: slop v3 in the detail the change needs (Part I), the
problem (Part II), eight primitives (Part III), the back office and the
Workshop as apps (Part IV), and the threat model, phases W1 to W8 and the
test approach (Part V). It was uploaded to reMarkable as "SLOP3-002 Tools
as apps guide" in `/ai/2026/11/01/SLOP3-002`.

### Prompt Context

**User prompt (verbatim):** "Ok, create a new docmgr ticket, and Create  a
detailed analysis / design / implementation guide that is for a new
intern, explaining all the parts of the system needed to understand what
it is, with prose paragraphs and bullet point sand pseudocode and diagrams
and api references and file references. It should be very clear and
technical. Store in the ticket and the nupload to remarkable. Then
implement, commit at appropriate intervals and keep a detailed diary as
you work (using the diary format from the skill)"

The request follows a discussion in which the user proposed, in order:
porting the Workshop against store snapshots; making the Workshop itself
an app; managing permissions through an app; and finally (verbatim) "making
it possible to configure go-side go-go-goja modules to be mounted into an
app, and one of these modules is to deal with the system itself (instead
of exposing the system as a store to be manipulated with the generic store
stuff), so that we have audit and control and don't expose the lower-level
data, while keeping the flexibility of writing JS code."

**Assistant interpretation:** Write the guide for the design discussed
(trusted Go modules for actors, a system module, a workshop module and the
supporting primitives), then build it in phases with a commit and a diary
step per phase.

**Inferred user intent:** Tools should be pushed and versioned like apps,
so that variants can be built (by agents too) without changing the server,
while every platform change stays audited and checked.

### What I did

- `docmgr ticket create-ticket --ticket SLOP3-002 --title "Tools as apps: Go modules for actors, the Workshop and the back office as apps" --topics architecture,goja,access,tools,agents`
  (the topic `tools` was added to the vocabulary).
- Read the code the guide cites to get names and line numbers right:
  `pkg/actor/modules.go` (`Actor.module`), `pkg/server/platform.go`,
  `pkg/actor/manager.go` (`react`, `selects`, `_cursors`),
  `pkg/kernel/apps.go` (`Running`, `app_ref`), `pkg/verbs/verb.go`
  (`Verb`, `Call`), `pkg/verbs/mounts.go` (`needCodeRight`),
  `pkg/system/system.go` (`Log`, `Change`), `pkg/server/views.go`
  (`label`, `rpcTable`), `pkg/server/assets/shell.js`, and v2's
  `pkg/render/assets/bridge.js` and Workshop bridge protocol.
- Wrote the guide: 29 sections, two mermaid diagrams, a verb table with
  arguments taken from the verb definitions, pseudocode for `actAs`, the
  module tables, the preview label scheme, the confirmation sequence, the
  Workshop thread schema and ASCII screens.
- Added tasks W1 to W8 and a changelog entry; uploaded the guide.

### Why

- Verbs remain the only way to change the platform. A module function is a
  named verb call made as the visitor, so access checks, D9 and the audit
  log apply without new code paths (guide section 13).
- Trust is separate from the policy matrix, because an app that can set
  policy through the system module could otherwise grant itself trust.

### What worked

- `remarquee upload bundle … --non-interactive` returned
  `OK: uploaded SLOP3-002 Tools as apps guide.pdf -> /ai/2026/11/01/SLOP3-002`.

### What didn't work

- The first `Write` of the guide failed with "File has not been read yet.
  Read it first before writing to it." because docmgr had created the file
  and the editor tool requires a read before overwriting. Reading it and
  writing again worked.
- `slop verbs -o json` lists verbs under the key `verb` with no arguments,
  so the argument table was built from the `Args` in `pkg/verbs/*.go`
  rather than from the CLI.

### What I learned

- `_cursors` already has a `source` column, set to `'self'` everywhere, so
  following the system log needs no schema change to stores.
- `Kernel.Running` already honours a store's `app_ref`; only a verb to set
  it is missing. Draft instances are therefore a small change.

### What was tricky to build

- Previews. Sites written for a root use absolute paths (`/_slop/page.js`,
  `/_data/…`), so a preview cannot live under a path prefix. Giving each
  preview its own sandbox origin, with the label as the capability, solves
  both that and the privacy of unpublished snapshots.

### What warrants a second pair of eyes

- The confirmation rule that an approval stays valid for the same
  (person, view, call) for two minutes rather than being consumed on use.
  It makes multi-call actions work with retries; it also means a page can
  repeat an approved call within that window.

### What should be done in the future

- Decide whether `platform` becomes a trusted module, and whether the
  contract's `comments` capability is backed by Workshop threads (guide
  section 29).

### Code review instructions

- Read the guide's Part III and Part V; compare the verb table in section 4
  with `pkg/verbs/*.go`.

### Technical details

- Ticket path:
  `ttmp/2026/11/01/SLOP3-002--tools-as-apps-go-modules-for-actors-the-workshop-and-the-back-office-as-apps/`.

## Step 2: W1, the module registry and app trust

Apps can now declare Go modules in `app.json` (`"slop": {"modules":
["system"]}`), and `use(name)` returns such a module only after an admin
has run `slop app trust <app> <module>`. A module function calls a verb
as the person behind the event, labelled `app:<app>`, so the verb's own
checks decide and the system log names the app. The `system` module
exists with five functions; W2 fills it in. Commit `632cfaf`.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Phase W1 of the guide: registry, manifest
field, trust table and verbs, `actAs`, and restarting actors when trust
changes.

**Inferred user intent:** The foundation every later phase uses; it must
already refuse what the visitor could not do directly.

**Commit (code):** `632cfaf` — "W1: Go module registry for actors, app
trust (app.trust/untrust/modules), calls as the visitor".

### What I did

- `pkg/apps/manifest.go`: `Slop.Modules []string`, validated against
  `apps.Modules` (`system`, `workshop`) as `slop.platform` is validated
  against `apps.Platform`.
- `pkg/system/migrations/003_app_modules.sql` and `pkg/system/modules.go`:
  table `app_modules (app, module, granted_by, granted_at)`;
  `TrustModule`, `UntrustModule` (both log `Change{Kind: "module"}`),
  `Trusted`, `AppModules`.
- `pkg/actor/registry.go`: `Module{Name, Doc, Load}`, `Manager.Register`,
  `Manager.Modules`, `Manager.Module`, and `Actor.trustedModule`, which
  `Actor.module` calls in a new `default:` case.
- `pkg/actor/manager.go`: `Manager.Trusted` hook; `VisitorOf` copies a
  token's scopes into the new `Visitor.Scopes` (`json:"-"`).
- `pkg/verbs/actors.go`: `app.trust` and `app.untrust` (admin scope, admin
  only, restart the app's actors), `app.modules` (read).
- `pkg/server/modules.go`: `modFunc{JS, Verb, Pos, Fixed}`, `verbModule`
  (builds nested objects from `group.name`), `modArgs` (argument mapping),
  `callVerb`, `actAs`, `registerModules` (called from `server.New`).
- `pkg/server/w1_test.go`: `TestModuleTrust`.

### Why

- `app.trust` refuses a module the app does not declare, as `policy.set`
  refuses an undeclared capability. The deployment order (push, trust,
  mount) already puts the declaration first.
- The module list sits in `pkg/apps` beside `apps.Platform`, because
  `apps.Parse` must validate names and cannot import the server, which
  registers the implementations. A name in `apps.Modules` with no
  registered implementation just makes `use()` return null.

### What worked

- `GOWORK=off go test ./pkg/server -run TestModuleTrust -count=1`: `ok`.
- `GOWORK=off go test ./... -count=1`: all packages `ok`.

### What didn't work

- The first run of the test failed with
  `w1_test.go:57: trusted: keys = ["grants","log","people"]`, because the
  harness's `fmtAny` renders JSON, not Go's `%v`. The expectation was
  corrected.

### What I learned

- `Visitor.Payer` is the person for person visitors and the store's owner
  for reactors and alarms, which is why `platform` acts as `Payer`. The new
  modules use `ID` instead, and fall back to `Payer` only for reads, so a
  reactor cannot write as the owner.

### What was tricky to build

- **Token scopes.** Without them, a token with `read, write` could call an
  action that calls `policy.set` (admin scope) and act with the full rights
  of its person. The visitor now carries the token's scopes and `actAs`
  builds a token principal with them; the test checks that a write token
  gets "this token lacks the admin scope" through the app.
- **Synchronous or asynchronous functions.** A verb that writes the actor's
  own store, called during a turn, would wait for the turn's own
  transaction. Module functions therefore run the verb through `Actor.IO`
  and return a promise: the turn commits, the verb runs on another
  goroutine, and the result settles in a continuation turn that keeps the
  visitor. The guide's synchronous examples must become `await` calls; the
  guide is updated in W2.

### What warrants a second pair of eyes

- `actAs` labels a token principal's `Via` as `app:<app>` without the token
  id (`TokenID` is left empty so `ViaLabel` does not append it). The
  person is still recorded; the token is not.
- `Trusted` is read when `use()` runs, at actor start; a trust change takes
  effect through `RestartApp`, the same mechanism `policy.set` uses.

### What should be done in the future

- W2: the full system module and the guide update for promises.

### Code review instructions

- Start at `pkg/server/modules.go` (`actAs`, `callVerb`), then
  `pkg/actor/registry.go` and the `default:` case in
  `pkg/actor/modules.go`.
- Run `GOWORK=off go test ./pkg/server -run TestModuleTrust -count=1`.

### Technical details

```text
use('system') returns an object iff
  "system" ∈ app.json slop.modules        (apps.Parse rejects unknown names)
  ∧ "system" is registered                (Manager.Register in server.New)
  ∧ app_modules has (app, "system")       (app.trust, admin only)
```

## Step 3: W2, the system module

`use('system')` now holds 34 functions over the governance verbs, plus
`call(verb, args)` for code that names verbs. Functions that change roles,
policy, LLM budgets, comps or secrets carry a `Confirm` flag that W6 will
enforce. The test exposed a pre-existing audit bug: `people.role` and
token revocation logged `via: verb` whatever the door, so the "via
app:office" the design promises was missing. Both now take the via. Commit
`2405607`.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Phase W2: the full function table, `call`
with an allowlist, and the tests the guide lists for it.

**Inferred user intent:** An app should reach exactly the platform
operations a back office needs, no more, and every change should be
traceable to the app.

**Commit (code):** `2405607` — "W2: the system module (34 functions and
call), via passed through SetRole/RevokeToken".

### What I did

- Listed the verbs the existing back office calls
  (`grep -rhoE "'(people|grant|…)\.[a-z]+'" web/admin/src`): 31 verbs, all
  of which are in the module, so the back-office port (W7) can use `call`
  unchanged.
- `pkg/server/modsystem.go`: `systemFuncs` (JS name, verb, positional
  names, fixed arguments, `Confirm`), and `systemModule`, which adds
  `call`. `call` looks the verb up in a map built from `systemFuncs` and
  throws `permission_denied: system.call: <verb> is not in the system
  module` otherwise.
- `pkg/server/modules.go`: `modFunc.Confirm`; `callVerb` takes the
  `modFunc` so W6 can read the flag.
- `pkg/system/people.go` `SetRole` and `pkg/system/sessions.go`
  `RevokeToken` take a `via` argument; `pkg/verbs/people.go` passes
  `p.ViaLabel()`.
- `pkg/server/w2_test.go`: `TestSystemModule`.
- The guide: functions return promises (section 15), token scopes carry
  over, `subs.revoke(id)` takes a comp id, `apps.modules`, the examples use
  `await`, and a note that `app.trust` is not reachable.

### Why

- `app.trust` is left out of the module so that an app trusted with
  `system` cannot widen its own trust or another app's.
- `subs.revoke` takes a comp id because `sub.revoke` does (`cmp_…`); the
  guide had `person`.

### What worked

- `GOWORK=off go test ./pkg/server -run 'TestModuleTrust|TestSystemModule' -count=1`: `ok`.
- `GOWORK=off go test ./... -count=1`: all packages `ok`.

### What didn't work

- `w2_test.go:58: log entry = map[… summary:role of usr_…: pending → member via:verb]`.
  `system.SetRole` hard-coded `"verb"` as the via
  (`pkg/system/people.go:157`), as did `RevokeToken`
  (`pkg/system/sessions.go:226`). Fixed by passing the via.
- `w2_test.go:63: letIn as member: … this token lacks the admin scope`.
  Correct behaviour: the scope check comes before the admin check. The
  member's token now has all scopes so the test reaches the role check.
- `notes is plain content: mount it on a static host`: the test mounted a
  plain store on the live host; it now mounts the app itself.
- Two assertion shapes were wrong (`mount.set` returns `{mount, note, url}`;
  `docs.get` returns `{body, …}`).

### What I learned

- Every `system.DB` method that logs should take `via`; `grep -n '"verb"'
  pkg/system` now finds none.
- A reactor's `try { await system.grants.set(…) } catch (e)` receives
  `e.code === "permission_denied"`, because `actAs` throws before the I/O
  starts and the async function turns the throw into a rejection.

### What was tricky to build

- Argument mapping. `people.list({kind: 'user'})` must pass `kind`, not an
  object named `kind`. The rule is: one plain object is the argument
  object; otherwise arguments fill the positional names, and a plain object
  after them adds options. `mounts.set({host, path, store})` and
  `mounts.set(host, path, store, {type: 'blocks'})` are therefore both
  valid; the test uses the first form.

### What warrants a second pair of eyes

- The `Confirm` flags in `systemFuncs`: which operations count as
  governance. Grants, links and mounts are not flagged (they are
  per-store publishing decisions, already limited by the person's level);
  roles, policy, LLM, comps and secrets are.

### What should be done in the future

- W3: the `system:` selector, so tools can react to changes made
  elsewhere.

### Code review instructions

- `pkg/server/modsystem.go` (the table), then `TestSystemModule`.

### Technical details

```text
system.call('grant.ls', {store:'office'})   → verbs.Call(grant.ls) as the visitor
system.call('token.new', {})                → permission_denied: not in the system module
reactor: await system.stores.list()         → reads as the store's owner
reactor: await system.grants.set(…)         → permission_denied (a write needs a person)
```

## Step 4: W3, reactors on the system log (and a data-race fix)

An actor can now react to platform changes: a handler under
`on: {'system:grant'(ctx, e) {…}}` receives each system log commit that
has a grant change, exactly once, with its cursor in the store. While
building it, the race detector showed that the actor manager read goja
objects from goroutines other than the actor's, already in the P3 tests.
The definition's shape is now copied to Go data when the actor is built.
Commit `fe7db89`.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Phase W3: the `system:` selector, a log
follower in `system.DB`, cursors with `source = 'system'`.

**Inferred user intent:** A tool's pages should update when someone
changes a grant from the CLI or another tool, without polling.

**Commit (code):** `fe7db89` — "W3: system: reactors follow the system
log; actor definition shape read once (fixes data races)".

### What I did

- `pkg/system/system.go`: `DB.OnLog` (called after every committed
  `Tx`), `LogHead`, `LogAfter(rev, limit)` (commits with their changes,
  oldest first). Every system write goes through `DB.Tx`
  (`grep -n BeginTx pkg/system` finds only `Tx` and the migration runner),
  so the hook sees all of them.
- `pkg/actor/sysreact.go`: `followSystem` (one goroutine per manager,
  woken through a one-slot channel; compares `LogHead` with the last head
  seen), `systemKeys`, `followsSystem` (has `system:` keys, declares and is
  trusted with `system`), `queueSystem` (at most one pending event per
  actor), `reactSystem` (200 commits per turn per reactor, then requeues),
  `systemSelects`.
- `pkg/actor/manager.go`: activation gives `system:` reactors a cursor
  with source `system` at the log head; `react` skips `system:` keys;
  `Get` queues a catch-up when an actor that follows the log starts.
- The race fix, `pkg/actor/actor.go` and `manager.go`: `Actor.groups` and
  `Actor.routes` are filled by `readShape` at build; `keys()` reads them;
  `Manager.Call` checks the action name against them and resolves the
  function inside the event; `MatchRoute` uses the copied route levels;
  `Serve` resolves the handler inside the event.
- `pkg/server/w3_test.go`: `TestSystemReactor`.

### Why

- One follower goroutine and a one-slot channel bound the work: a burst
  of system commits wakes running followers once per head change, and each
  actor has at most one system reactor event queued.
- Followers are only running actors; a stopped actor catches up when it
  starts. Starting every store's actor on each system commit would be
  costly and is unnecessary, since cursors make delivery resumable.

### What worked

- `GOWORK=off go test ./pkg/server -run TestSystemReactor -count=1 -v`:
  `PASS` on the first run.
- `GOWORK=off go test -race ./pkg/server -count=1`: `ok`, 0 races (after
  the fix).
- `GOWORK=off go test ./... -count=1`: all packages `ok`.

### What didn't work

- `go test -race … -run TestSystemReactor` reported races
  (`testing.go:1712: race detected during execution of test`). The stacks:
  `goja.(*templatedObject).materialiseProto` read by
  `actor.(*Actor).fn` ← `actor.(*Actor).react` (actor goroutine), written
  by `actor.(*Actor).fn` ← `actor.(*Manager).Call` ← `verbs.Call` ←
  `server.(*Server).apiCall` (HTTP goroutine), and
  `actor.(*Manager).onCommit.func1` ← `Get`. Running
  `go test -race -run 'TestReactorExactlyOnce|TestActors|TestJournalExample' -count=2`
  on the code before the fix printed 8 `DATA RACE` reports: the bug
  predates this ticket. goja runtimes are not safe for concurrent use, even
  for reads, because property access materialises prototypes lazily.

### What I learned

- `Manager.Call`, `MatchRoute`, `Serve` and `onCommit` all touched `a.def`
  outside the actor's goroutine. Any new code that needs to know an actor's
  handlers from outside should use `keys()` and `routes`, never `def`.

### What was tricky to build

- **Cursor source on conflict.** `_cursors` has `name` as its primary key.
  An app activated before W3 has `system:` cursors with source `self`; an
  upsert that kept the old source would then never be found by the
  `source = 'system'` query. The system upsert sets `source` as well.
- **Catch-up after trust.** The cursor is set at activation. If the app is
  trusted later, the first run delivers what happened in between (the test
  sees the `@guest` grant made before `app.trust`). That is bounded by 200
  commits per turn, and is consistent with "the cursor records what was
  delivered".

### What warrants a second pair of eyes

- The catch-up-after-trust semantics above: an alternative is to move
  `system:` cursors to the head on `app.trust`.
- `followSystem`'s goroutine lives as long as the process (one per
  manager); tests create many managers, which leak one idle goroutine each.

### What should be done in the future

- W4: the workshop module, `log.wait`, `app.follow`.

### Code review instructions

- `pkg/actor/sysreact.go` top to bottom; then `readShape` and its users
  (`git show fe7db89 -- pkg/actor`).
- `GOWORK=off go test -race ./pkg/server -count=1`.

### Technical details

```text
grant.set (CLI) → system.DB.Tx commits → OnLog() → wake (cap 1)
  → follower: LogHead changed? → for running actors that followsSystem(): queueSystem
  → actor goroutine: reactSystem: cursor(source=system) → LogAfter(rev,200)
     → handler(ctx, {rev, at, principal, via, summary, changes}) → cursor = last
     (one store transaction: handler writes and cursor commit together)
```
