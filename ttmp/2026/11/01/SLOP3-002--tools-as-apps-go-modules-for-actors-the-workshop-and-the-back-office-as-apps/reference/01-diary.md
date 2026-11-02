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
RelatedFiles:
    - Path: repo://apps/workshop/app.js
      Note: the Workshop page
    - Path: repo://pkg/actor/sysreact.go
      Note: system log reactors
    - Path: repo://pkg/server/modules.go
      Note: actAs, callVerb, confirmations
    - Path: repo://pkg/server/preview.go
      Note: inspect previews
    - Path: repo://pkg/verbs/confirm.go
      Note: confirmations
ExternalSources: []
Summary: 'Chronological record of SLOP3-002: the design guide and the implementation of phases W1 to W8.'
LastUpdated: 2026-11-01T16:20:14.512508729-05:00
WhatFor: Reviewing what was built in SLOP3-002, why, and what failed along the way.
WhenToUse: When resuming SLOP3-002 or reviewing one of its commits.
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

## Step 5: W4, the workshop module, log.wait and app.follow

A tool app trusted with `workshop` can now list a store's snapshots and
refs, read files at any snapshot, push to `draft`, and publish by moving
`main`. An agent can block on `slop log wait <store> --after <rev>`. An
admin can make a scratch instance run an app's draft with
`slop app follow <store> draft`. Commit `1d619c5`.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Phase W4: the module, the long-poll verb,
and the verb that sets `app_ref`.

**Inferred user intent:** The Workshop's loop (agent pushes a draft,
person reviews, person publishes) must work without server code specific
to the Workshop.

**Commit (code):** `1d619c5` — "W4: workshop module, log.wait,
app.follow".

### What I did

- `pkg/server/modworkshop.go`: `workshopFuncs` (11 functions).
  `push` uses a new `modFunc.Default` (`ref: "draft"`), applied only when
  the caller gives no `ref`; `publish` uses `Fixed` (`ref: "main"`).
- `pkg/verbs/stores.go`: `log.wait` (store, after, timeout ≤ 300 s,
  limit). It subscribes to `Kernel.Subscribe` for that store, then loops:
  read `Log(after)`; return if non-empty; otherwise wait for a commit,
  the timer or the request's cancellation.
- `pkg/verbs/actors.go`: `app.follow` (write scope, admin only, needs
  `admin` on the store). It refuses a ref the app store does not have,
  writes `app_ref` in a store turn ("follows jot@draft"), then calls
  `Running`, which activates the store at that snapshot.
- `pkg/verbs/mounts.go`: `app.status` returns `ref`.
- `pkg/server/w4_test.go`: `TestWorkshopModule`.

### Why

- `workshop.stores()` lists the stores the visitor can see; admins pass
  `{all: true}`. A `Fixed` `all` would make the function fail for every
  non-admin (`store.ls` refuses `all` to them).
- `app.follow` checks that the ref exists, because `Running` treats a
  missing ref as "no app", which would silently turn an instance into
  plain content.

### What worked

- `GOWORK=off go test ./pkg/server -run TestWorkshopModule -count=1`: `ok`.
- `GOWORK=off go test ./... -count=1`: all `ok`;
  `go test -race ./pkg/server -run 'TestWorkshopModule|TestSystemReactor'`: `ok`.
- `slop log wait --help` shows the generated command with `--after`,
  `--timeout` and `--limit`.

### What didn't work

- The test actor called `use('sql').query(…)`:
  `TypeError: Object has no member 'query' at tables (actor.js:1:63(6))`.
  The sql module's functions are `all`, `one` and `run`.

### What I learned

- Sites are served from the snapshot of the ref the store follows
  (`res.run.N` in `pkg/server/site.go`), never from the working tree. A
  push to `draft` therefore replaces the working tree without changing
  what visitors get, which is exactly what the Workshop needs.

### What was tricky to build

- `log.wait` must not miss a commit between reading the log and starting
  to wait. Subscribing first, with a one-slot channel and a non-blocking
  send (subscribers run on the committing goroutine and must not block),
  closes that gap; the loop re-reads after every wake.

### What warrants a second pair of eyes

- `app.follow` on an app store itself (not an instance) changes which
  version of its own tree it runs. That is allowed (admin only), and is
  the way to run a draft of a single-store app.

### What should be done in the future

- W5: previews.

### Code review instructions

- `pkg/verbs/stores.go` `log.wait`, `pkg/verbs/actors.go` `app.follow`,
  `pkg/server/modworkshop.go`; run
  `GOWORK=off go test ./pkg/server -run TestWorkshopModule -count=1`.

### Technical details

```text
workshop.push('site', [{path:'index.html', text:'<h1>two</h1>'}])
  → files.push {store: site, files, ref: draft}     static host still serves "one"
workshop.publish('site', n)
  → ref.move {store: site, ref: main, n}             static host serves "two"
slop app follow jot-scratch draft
  → _meta.app_ref = draft → Running → migrations 002_tags.sql → tables [notes, tags]
```

## Step 6: W5, inspect previews

A tool can now show any snapshot the person may read in an iframe, with
v2's bridge for pick mode and pins: `preview.url` (or
`workshop.preview(store, at, location.origin)`) returns
`http://p<label>.sbx…/`, which serves that snapshot at the root of its own
origin for an hour. Commit `e7d4a7a`.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Phase W5: previews table, verb, sandbox
route, bridge, injection, CSP.

**Inferred user intent:** Reviewing an agent's draft by pointing at
elements, as in v2's Workshop, without exposing unpublished work.

**Commit (code):** `e7d4a7a` — "W5: inspect previews on their own sandbox
origins, with v2's pick-and-pin bridge".

### What I did

- `pkg/system/migrations/004_previews.sql`, `pkg/system/previews.go`:
  `previews (label, store, n, person, parent, expires_at)`,
  `CreatePreview` (also deletes expired rows), `PreviewByLabel` (only
  unexpired).
- `pkg/verbs/preview.go`: `preview.url` (store, at, parent). It needs a
  person, `view` on the store, a `parent` that is an origin of this server
  (`Env.serverOrigin`: main, a live host, or `<label>.<sandbox host>` with
  a lowercase alphanumeric label), and resolves `at` (default `draft`,
  else `main`).
- `pkg/server/preview.go`: `servePreview` and `injectPreview`;
  `serveSandbox` sends labels starting with `p` there (store origins start
  with `s`). `insertHead` is factored out of `inject` and shared.
- `pkg/server/assets/bridge.js`: v2's file, with a new header comment.
- `workshop.preview(store, at, parent)`.
- `pkg/server/w5_test.go`: `TestPreviews`.

### Why

- A random label rather than the guide's HMAC: the row is stored anyway,
  so the label only has to be unguessable; there is nothing to recompute.
- Access is re-checked per request, so revoking a grant ends a preview
  immediately instead of after the hour.
- A `window.claude` stub that resolves every capability to `null`: pages
  of apps call `claude.use(…)`; in a preview they get the documented
  "unavailable" answer instead of a `ReferenceError`.

### What worked

- `GOWORK=off go test ./pkg/server -run TestPreviews -count=1`: `ok`.
- `GOWORK=off go test ./... -count=1`: all `ok`.

### What didn't work

- The first version sent `frame-ancestors <parent>` only, and the test
  passed. It would have failed in a browser: CSP `frame-ancestors` is
  checked against every ancestor, and a preview is framed by the tool's
  sandbox page, which is itself framed by the shell on the live host. The
  header now lists the parent plus the main and live origins
  (`frameOrigins`), and the test checks the exact header for a tool
  origin.

### What I learned

- `inject` in `pkg/server/sandbox.go` had
  `bytes.ReplaceAll(raw, []byte("<"), []byte("<"))`, a no-op that looked
  like escaping. `json.Marshal` already escapes `<`, `>` and `&` as
  `<…`, so the boot JSON cannot close its script tag; the line is
  replaced by a comment saying so (in both injectors).

### What was tricky to build

- Path resolution at the root: `/` is the manifest's entry (or
  `index.html`), a trailing slash adds `index.html`, an extensionless path
  falls back to `<path>/index.html`, and a missing file serves the
  manifest's `notFound` page with 404 when there is one. Only
  `/_slop/bridge.js` is served from the server's assets; every other path,
  including other `/_slop/*` files a site carries (the boutique's
  `_slop/page.js`), comes from the snapshot.

### What warrants a second pair of eyes

- `frame-ancestors` includes every live host and the main host, so any
  shell of this server may be an ancestor; only the requesting sandbox
  origin may be the direct sandbox parent. The bridge itself only posts to
  `parentOrigin`.

### What should be done in the future

- W6: confirmations. W8 will exercise previews in a real browser.

### Code review instructions

- `pkg/server/preview.go`, `pkg/verbs/preview.go`; run
  `GOWORK=off go test ./pkg/server -run TestPreviews -count=1`.

### Technical details

```text
GET http://p5c1e…24hex.sbx.localhost:18399/
  → previews row (unexpired) → person may view store? → snapshot n
  → index.html with <script id=slop-boot>{"mode":"preview","parentOrigin":…}</script>
                    <script>window.claude=…null stub…</script>
                    <script src="/_slop/bridge.js?v=…"></script>
  Content-Security-Policy: frame-ancestors <tool origin> <main> <live…>
  Cache-Control: private, no-store
```

## Step 7: W6, confirmations for governance changes made through apps

When an app's actor changes a role, a policy cell, an LLM budget, a comp
or a secret for the person using it, the call now fails with
`confirmation_required` until that person allows it. They allow it in the
shell, which the app cannot draw or click, or from the CLI with
`slop confirm approve <id>`. The page's runtime asks the shell and repeats
the call, so app code just awaits. Commit `7f4a42e`.

### Prompt Context

**User prompt (verbatim):** see Step 1. The design goal it serves, from
the user's previous message (verbatim): "so that we have audit and control
and don't expose the lower-level data".

**Assistant interpretation:** Phase W6: the confirmation record, the error
path to the page, the runtime retry, the shell dialog, `/_site/confirm`,
`confirm.approve`.

**Inferred user intent:** A compromised or buggy tool app must not be able
to silently change governance state with an admin's authority.

**Commit (code):** `7f4a42e` — "W6: governance calls made through apps
need the person's confirmation in the shell".

### What I did

- `pkg/verbs/confirm.go`: `Confirmation`, `Confirmations` (`Check`,
  `Get`, `Approve`), `summarize` (sorted `key=value`, `secret.set`'s
  `value` shown as `(hidden)`), `Env.Confirmations()` (lazy, `sync.Once`),
  verb `confirm.approve` (write scope, own confirmations only).
- `pkg/verbs/verb.go`: `verbs.Check` holds the checks `Call` made before
  `Run`; `Call` uses it.
- `pkg/server/modules.go` `callVerb`: for `Confirm` functions, `Check`
  first, then `Confirmations().Check(person, visitor.View, app, title,
  verb, args)`; if not approved, `ThrowError(&actor.Error{Code:
  "confirmation_required", Message: title + " asks to " + summary,
  Confirm: id})`.
- The id's path: `actor.Error.Confirm` → `errValue` sets `.confirm` on the
  JS error → `jsError` reads it back when the action does not catch →
  `actorFail` → `rtFail.Confirm` → the RPC error's `confirm` field; for
  `actor.call`, `actorErr` puts it in `Error.Extra` and appends the
  `slop confirm approve` hint to the message.
- `pkg/actor`: `Visitor.View`, set by `rpcSlopCall`; `Actor.ThrowError`.
- `web/runtime/src/transport.ts`: `rpc` keeps `confirm` on the error;
  `caps.ts`: `slop.call` loops (at most 4 asks): on
  `confirmation_required` it `ask("confirm", {confirm})`s the shell and
  repeats, or throws `confirmation_declined`. Rebuilt `claude.js`.
- `pkg/server/assets/shell.js`: `case "confirm"`; `pkg/server/live.go`:
  `siteConfirm` (GET shows, POST allows, the signed-in person's only).
- Tests: `TestConfirmations` (new); `TestSystemModule` now approves before
  `letIn`.

### Why

- Keying approvals by (person, view, call hash) makes the retry a plain
  repeat and makes multi-call actions work (each call is confirmed once,
  then every retry passes). It also confines an approval to the view in
  which it was given: the test shows the same call from the CLI asks
  again.
- The summary is written by the server from the verb and its arguments, so
  the app cannot describe a change as something else.

### What worked

- `GOWORK=off go test ./pkg/server -run TestConfirmations -count=1`: `ok`
  on the first run.
- `GOWORK=off go test ./... -count=1`: all `ok`; runtime tests: 3 pass;
  `go test -race … -run 'TestConfirmations|TestSystemModule'`: `ok`.

### What didn't work

- After adding confirmations, `TestSystemModule` would have produced
  `confirmation_required` for the member's `letIn` instead of the verb's
  "people.role is for admins". Asking someone to allow a call that cannot
  succeed is wrong, so the static checks were factored out of `verbs.Call`
  as `verbs.Check` and run before the confirmation.

### What I learned

- The live host's `sameOrigin` guard (`Sec-Fetch-Site` must be
  `same-origin`, `Origin` must match) is what keeps a sandboxed page from
  approving its own confirmation: it knows the id from its error, but its
  requests to the live host carry its own origin. The test sends such a
  POST and gets 403.

### What was tricky to build

- Carrying a structured field through four error representations
  (`actor.Error`, a goja `Error` object, `rtFail`, `verbs.Error`). A
  rejected promise inside an action loses everything but what `jsError`
  reads back, so `.confirm` had to be set by `errValue` and read by
  `jsError`.

### What warrants a second pair of eyes

- Confirmations are in memory. A restart forgets pending and approved
  ones (the person is asked again); several server processes would not
  share them. slop runs one process.
- The runtime gives up after four confirmations in one call, to avoid an
  endless loop if an action makes ever-new governance calls.

### What should be done in the future

- W7 exercises the shell dialog and the runtime retry in a browser.

### Code review instructions

- `pkg/verbs/confirm.go`, `callVerb` in `pkg/server/modules.go`, the
  `confirm` case in `shell.js`, `slop()` in `web/runtime/src/caps.ts`.
- `GOWORK=off go test ./pkg/server -run 'TestConfirmations|TestSystemModule' -count=1`.

### Technical details

```text
page: slop.actions.letIn({id})
  → RPC slop.call → actor → system.people.setRole → verbs.Check ok
  → not approved → {error: {code: confirmation_required, confirm: cfm_…, message: "Tool asks to people.role id=… role=member"}}
runtime → shell {type: confirm, confirm} → GET /_site/confirm/cfm_… → dialog
  → POST /_site/confirm/cfm_… → {approved: true}
runtime → RPC slop.call (same) → approved (person, view, hash) → verb runs → result
```

## Step 8: W7, the back office as an app

The back office now also exists as an ordinary app, `apps/backoffice`,
built from the same React UI as the built-in one. Installed with three
commands (push, trust, mount), it runs at `/admin` on the live host. A
browser test lets a pending person in, grants a comp, and toggles a
policy cell. Each of these is asked in the shell, and the test declines
once. Activity then shows them `via app:backoffice`, and a change made
from the CLI appears without a reload. Commit `da05ae9`.

### Prompt Context

**User prompt (verbatim):** see Step 1. The idea goes back to the user's
earlier question (verbatim): "how would we manage permissions and such
through a UI, can we build an app that can also manipulate that by
accessing a certain system store?"

**Assistant interpretation:** Phase W7: port the back office to an app
whose API client is one actor action, and check it in a browser.

**Inferred user intent:** The admin UI should be replaceable and
versionable like any app, without losing audit or safety.

**Commit (code):** `da05ae9` — "W7: the back office as an app
(apps/backoffice), verified in a browser".

### What I did

- `web/admin/src/api-app.js`: `session()` from `claude.use('user')`
  (`me().audience === 'admin'` gives the role), `call(verb, args)` →
  `slop.actions.verb({name, args})`, `hosts()` → `server.hosts`,
  `signIn()` → `slop.signIn()`, `signOut = null` (the shell's bar signs
  out), `onChange(fn)` → `db.doc('ui/changed').onSnapshot` (skipping the
  first snapshot).
- `web/admin/src/api.js` gained the same `hosts`, `signIn` and
  `onChange` (no-op); `main.jsx` loads hosts through `hosts()` and shows
  Sign out only when `signOut` exists; `ui.jsx`'s `useVerb` reloads on
  `onChange`.
- `web/admin/build.mjs --app <dir>`: an esbuild plugin resolves
  `./api.js` to `src/api-app.js`; writes `app.js` and `styles.css` into
  the app folder.
- `apps/backoffice/`: `app.json` (user profile scope, db rule for `ui`,
  `slop.modules: ["system"]`), `actor.js` (`verb` action with
  `ctx.need('admin')`; `system:*` reactor), `index.html`, and the built
  `app.js` and `styles.css`.
- Verb `server.hosts` (read) and `system.hosts()`: the Sites view needs
  the live and static hosts, which the built-in page gets from its boot
  data.
- `pkg/server/w7_test.go` `TestBackofficeApp`; ticket scripts
  `01-w7-backoffice-e2e.mjs` and `02-w7-builtin-backoffice-smoke.mjs`;
  screenshots in `various/w7/`.
- Demo server: rebuilt `./slop`; its tmux session `slop3` had exited, so
  it was restarted with `tmux new-session -d -s slop3 …/serve.sh`;
  `slop push apps/backoffice --store backoffice`,
  `slop app trust backoffice system`,
  `slop mount set apps.localhost:18300 /admin backoffice`.

### Why

- One UI, two API modules: the views keep calling `call(verb, args)`, so
  the app version needs no UI changes, and the built-in back office stays
  the recovery path.
- `server.hosts` is a verb rather than something passed at build time,
  so the same `apps/backoffice` works on any server.

### What worked

- `01-w7-backoffice-e2e.mjs`: 10 checks, `all passed` (output below).
- `02-w7-builtin-backoffice-smoke.mjs`: 3 checks, `all passed`.
- `GOWORK=off go test ./... -count=1`: all `ok`.

```text
ok   signed out: only the view request failed (401 POST http://apps.localhost:18300/_site/views)
ok   the back office app opens at /admin on the live host
ok   let in: the shell asks "Allow Back office to do this? people.role id=usr_6b480a87136aec427b643d30 role=member Canc…"
ok   let in: Mira is a member after allowing
ok   grant comp: allowed in the shell, the row shows the comp
ok   policy: Cancel leaves the cell off and the app reports confirmation_declined
ok   policy: Allow turns sample on for guests
ok   activity: role, comp and policy changes are logged via app:backoffice
ok   activity: "w7-probe-mvydk4bx" created from the CLI appears without a reload
ok   signed in: no console errors or failed requests
```

### What didn't work

- `locator.click: Error: strict mode violation: getByText('Sign in')
  resolved to 3 elements` (the bar's link, "Sign in to open this.", and
  the note's link). The script now clicks `#me a:has-text("Sign in")`.
  Its `finally` block restored the demo state.
- `FAIL no console errors Failed to load resource: the server responded
  with a status of 401 (Unauthorized)`. Logging failed responses showed it
  was `401 POST /_site/views` made while signed out (the store has no
  grants, so a guest gets no view): expected. The script now checks that
  this is the only failure before sign-in, and that nothing fails after.

### What I learned

- The runtime retry and the shell dialog work end to end in Chromium: the
  dialog shows the server's summary ("people.role id=usr_… role=member"),
  Cancel turns into `confirmation_declined` in the app's toast, and Allow
  completes the original click with no extra code in the UI.

### What was tricky to build

- Live refresh without polling: the actor's `system:*` reactor writes
  `ui/changed`, pages subscribe to it, and `useVerb` reloads. The first
  snapshot must be ignored or every view loads twice at start.

### What warrants a second pair of eyes

- `apps/backoffice/app.js` and `styles.css` are built artifacts committed
  next to their sources (as `pkg/server/admin` already is); rebuild with
  `cd web/admin && node build.mjs --app ../../apps/backoffice` after UI
  changes.
- Each `system:*` event writes `ui/changed`, so every open view of every
  surface reloads on any platform change. Fine for an admin tool; a busier
  tool should filter by kind.

### What should be done in the future

- W8: the Workshop app.

### Code review instructions

- `web/admin/src/api-app.js`, `apps/backoffice/actor.js`,
  `web/admin/build.mjs`.
- Run the scripts against a demo server (commands in their headers).

### Technical details

```text
page (sandbox) call('policy.set', {...})
  → slop.actions.verb → actor: ctx.need('admin'); system.call('policy.set', args)
  → verbs.Check ok → confirmation_required (cfm_…) → shell dialog → Allow
  → retry → policy.set as Ada, via app:backoffice → system log
  → system:* reactor → ui/changed → every open page's useVerb reloads
```

## Step 9: W8, the Workshop app with an agent loop

The Workshop is now an app, `apps/workshop`. The browser check drives the
whole loop:
1. An admin opens a static site's draft in an inspect preview, switches
   to pick mode, clicks the site's button, and writes a comment.
2. An agent waiting in `slop log wait workshop` wakes, reads the thread
   with `slop docs ls`, pushes a darker button to `draft` with
   `slop push --ref draft`, and replies with `slop call workshop reply`,
   naming the new snapshot.
3. The admin opens that snapshot from the reply, publishes it, and the
   static host serves it.

A fix to the actor runtime came out of this: data read from documents
could not be changed in place. Commit `69c2316`.

### Prompt Context

**User prompt (verbatim):** see Step 1. The Workshop itself traces back
to the user's earlier messages (verbatim): "but i think maybe porting the
workshop against store snapshots (and whatever apps are declared or so)
would be possible pretty straightforwardly, no?" and "ccould the workshop
just be itself an app? so we don't even need to really "bake it into" the
server itself, but can provide it as an app itself (and thus build
various versions of the tool)?"

**Assistant interpretation:** Phase W8: the Workshop app on the new
primitives, checked in a browser together with a CLI agent.

**Inferred user intent:** v2's review loop with coding agents, rebuilt as
an ordinary, replaceable app.

**Commit (code):** `69c2316` — "W8: the Workshop app (apps/workshop),
verified with a CLI agent loop".

### What I did

- `apps/workshop/app.json` (`slop.modules: ["workshop"]`, user profile,
  `threads` rule), `actor.js` (actions `overview`, `store`, `preview`,
  `comment`, `reply`, `resolve`, `publish`, `follow`), `index.html`,
  `app.js` (vanilla JS, no build), `styles.css`.
- The page's bridge handling: it accepts messages only from the preview's
  origin and window; `pick` opens the composer with the anchor; `pin`
  focuses a thread; `nav` reloads the frame only within the preview
  origin; `ready` re-sends pins.
- `pkg/actor/actor.go` `toJS`: `JSON.parse` instead of `vm.ToValue` on
  decoded Go data.
- `pkg/server/w8_test.go` `TestWorkshopApp`; ticket script
  `03-w8-workshop-e2e.mjs`; screenshots in `various/w8/`.
- Demo: `slop push apps/workshop --store workshop`,
  `slop app trust workshop workshop`,
  `slop mount set apps.localhost:18300 /workshop workshop`; the agent used
  the admin person's read/write token (`agent/creds-rw.json`), as in
  SLOP3-001's agent task 2.

### Why

- Levels per action (view to read, interact to comment, admin to publish)
  are checked on the Workshop store. The module then applies the
  visitor's own level on the store under review, so the Workshop grants
  no rights there.
- The agent uses only generic commands (`log wait`, `docs ls`, `push`,
  `call`), so any coding agent with the CLI can take part.

### What worked

- `03-w8-workshop-e2e.mjs`, final run: 9 checks, `all passed`:

```text
ok   the Workshop opens at /workshop and lists wsite
ok   the preview shows draft #10 on its own origin (pe566a06…)
ok   pick: "On a Buy a skein" becomes thread 5, drawn as pin 5 in the preview
ok   agent: log wait woke after 1 commit(s); the thread anchors a.cta
ok   agent's snapshot #11 previews with the darker button (rgb(31, 58, 138))
ok   publish #11: the static host switched from the pale to the darker button
ok   the open thread notes the publication
ok   the thread is resolved
ok   no console errors
```

- `GOWORK=off go test ./... -count=1` and
  `go test -race ./pkg/server -count=1`: `ok`.

### What didn't work

- `TestWorkshopApp` first failed: the thread kept one comment after
  `reply` and `publish`, though `updatedAt` changed. `toJS` turned
  documents into JS values wrapped around Go maps and slices
  (`vm.ToValue` on `map[string]any`/`[]any`), and `push` on a wrapped,
  non-addressable slice does not reach the map the object is serialized
  from. Every app reading a document and appending to a nested array would
  hit this; `toJS` now parses the JSON with the runtime's `JSON.parse`.
- Run 1 of the browser script: `Timeout 8000ms exceeded … waiting for
  locator('#snaps li.on[data-n="3"]')`. The page's snapshot list predated
  the agent's push. The page now reloads snapshots and refs when a thread
  names a snapshot it does not know.
- Run 2: the pick click on `.cta` timed out because
  `<button … title="White on this pale blue…">1</button> from
  <div id="__slop_pins">… intercepts pointer events`: a pin of the
  previous run's (resolved) thread covered the button. The page now draws
  pins for open threads and the focused one only.
- Run 3: the pin check looked for "1", but the new thread was number 2.
  The script reads the focused thread's number.
- Run 4: `waiting for locator('.thread.focus')` timed out. The thread's
  snapshot arrived before the comment action resolved, so it was drawn
  before `state.focus` was set. The composer now calls `focus(id)`, which
  redraws.
- The resolve check matched an older resolved thread; it now waits for
  `.thread.focus.resolved`.

### What I learned

- The nested framing works in Chromium as designed: shell (live host) →
  Workshop page (`s…` sandbox origin) → preview (`p…` origin) with
  `frame-ancestors <workshop origin> <main> <live>`, and postMessage in
  both directions with origin checks.

### What was tricky to build

- Pins over the page intercept clicks, in pick mode as in normal use;
  limiting them to open threads keeps finished work out of the way.

### What warrants a second pair of eyes

- `overview` calls `workshop.refs` once per visible store (in parallel).
  It is fine for tens of stores, but slow for hundreds.
- The bridge's `nav` handling resolves links against the preview root,
  because the tool cannot read the frame's current URL cross-origin.
  Relative links on nested pages may resolve differently than in the
  site.

### What should be done in the future

- Merge v3 into slop-computer.git (the user's earlier request, not yet
  started) so that these apps can be deployed with the existing CI.
- Decide the open questions in guide section 29.

### Code review instructions

- `apps/workshop/actor.js`, `apps/workshop/app.js` (message handler,
  `pins`, `watch`), `toJS` in `pkg/actor/actor.go`.
- Run the scripts against a demo server (commands in their headers).

### Technical details

```text
agent                                   admin (browser)
slop log wait workshop --after R  ⟵    comment(store, n=#10, anchor=a.cta)
slop docs ls workshop threads
slop push ./wsite --ref draft     →    (reply names #11: page reloads snapshots)
slop call workshop reply {...n:11}→    view #11 → Publish #11 → ref.move main
                                        static host serves #11
```

## Step 10: the Workshop's Files view

The Workshop could preview, comment and publish, but not show a store's
files or change them from the browser. It now has a Files view: the files
of the selected snapshot, each shown read-only, and three ways to push
onto that snapshot. "Add files…" puts files into the selected file's
folder, replacing same-named ones. "Push a folder…" makes a folder the
whole tree, as `slop push` does. "Remove" deletes the selected file. Each
makes a new draft, and `main` does not move until someone publishes.

### Prompt Context

**User prompt (verbatim):** "how can I edit a site in workshop? I am
admin but I can only comment on elements, I don't think I see the files of
the store?" and, while it was being built, "files view, push, no editor
though."

**Assistant interpretation:** Add a file browser and browser-side pushing
to the Workshop, without an in-page text editor (an editor was started,
then replaced after the second message).

**Inferred user intent:** Admins should be able to change a site from the
Workshop by pushing files, while editing itself happens in their own
tools or by agents.

### What I did

- `apps/workshop/actor.js`: actions `files({store, n})`,
  `read({store, n, path})` and `push({store, n, put, remove, replace,
  message})`. `push` rebuilds snapshot n's tree with unchanged files by
  hash (`{path, sha256, size, type}`), so nothing is uploaded again; `put`
  entries are `{path, text}` or `{path, data}` (base64); paths with `..` or
  empty segments are refused; `ref` defaults to `draft` through the module.
- `apps/workshop/index.html`, `app.js`, `styles.css`: a Preview/Files
  switch; the file list; a read-only viewer (files over 512 KB are not
  shown); "Add files…", "Push a folder…" (dotfiles skipped), "Remove", and
  a confirmation bar in the page for the last two.
- `pkg/server/w8_test.go`: file list, read, push one file, remove one,
  replace the tree, refuse `../x`, and `main` unchanged.
- `scripts/05-workshop-files-e2e.mjs`, screenshot `various/files/`.

### Why

- A confirmation bar in the page rather than `confirm()`: browsers limit
  dialogs opened by cross-origin frames, and the Workshop runs in one.
- Pushing onto the selected snapshot (not onto the working tree) makes
  each push a precise change from a version the person is looking at.

### What worked

- `05-workshop-files-e2e.mjs`: 7 checks, `all passed` (add files → new
  draft with a green button in the preview; remove; folder push;
  static host unchanged). `go test ./pkg/server`: `ok`.

### What didn't work

- The first screenshot showed the middle column scrolling sideways: long
  lines in the viewer and the toolbar widened the grid track (a `1fr`
  track's minimum is its content). Fixed with `minmax(0, 1fr)` tracks,
  `min-width: 0`, and a wrapping toolbar on its own row.
- The second run failed at `waiting for locator('#flist
  li[data-path="style.css"]')`: the first run's folder push had left a
  draft without `style.css`. The script now pushes a known draft first.

### What warrants a second pair of eyes

- Uploads travel as JSON through the actor (base64 for binary files), so
  large images are slow; `slop push` remains the path for big trees.

### Code review instructions

- `push` in `apps/workshop/actor.js`; the Files section of `app.js`.
