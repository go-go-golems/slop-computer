---
Title: 'Diary: server phase (files.commit)'
Ticket: SLOP3-023
Status: active
Topics:
    - architecture
    - apps
    - agents
    - tools
    - publishing
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Implementation diary of SLOP3-023 phase 1 (server): files.commit, required ifAt on every ref write, ref.rm, ref-name validation, verb error details in actor JavaScript, removal of snap.new and the self capability alias."
LastUpdated: 2026-11-16T13:40:03.41911302-05:00
WhatFor: "Reviewing and continuing the server half of SLOP3-023 (branch task/slop3-023-server)."
WhenToUse: "Before reviewing the server PR, or when the bench rewrite (phase 2) needs the exact server contract."
---

# Diary: server phase (files.commit)

This diary belongs to the engineer who implemented the server half of
SLOP3-023 in the worktree `t23s` (branch `task/slop3-023-server`). The lead
engineer keeps `01-diary.md`; the bench rewrite (phase 2) is another
engineer's, in parallel, against the contract recorded here.

## Step 1: Reading the spec and the code, and a green baseline

I read the guide's sections 2, 5.1, 6 (phase 1) and 7.1, then every file the
brief named, to find out what the new verb could be built from and how far
the "required ifAt" change would reach. The store already had everything a
per-path merge needs except two turn-level helpers; the reach of the ifAt
change was the surprise: about 140 `files.push` calls in `pkg/host` tests
and three JavaScript callers outside the bench.

Before changing anything I ran the packages the brief names and recorded a
green baseline, so every later failure is mine.

### Prompt Context

**User prompt (verbatim):** the brief came from the lead engineer, not the
user directly. It opens: "You are implementing the server half of SLOP3-023
in the slop-computer Go repo (a self-hosted app server)." It asks for
`files.commit` (a change list against a required `base`, merged per path in
one store turn), a required `ifAt` on `files.push` / `ref.move` / `snap.new`
(or the removal of `snap.new`), the removal of push's `prune`, `snapshot`
and `zone`, every caller updated, `workshop.commit`, the removal of the
`self` capability alias, Go tests, `make lint`, and this diary.

**Assistant interpretation:** build phase 1 of the guide on the existing
store primitives, make every ref write state where the ref is, and delete
the knobs and aliases nothing needs; leave `apps/bench` and `web/bench`
alone (another engineer rewrites them).

**Inferred user intent:** "clean simple composable robust core APIs" with no
legacy burden, so the bench rewrite has one write primitive whose answer
means "committed".

**Commit (code):** none in this step (reading only).

### What I did

- Read `pkg/store/files.go` and `pkg/store/turn.go`: the tree zone,
  `Snapshot` (dedups when the ref already points at an identical tree),
  `RefAt`, `MoveRef`, `Store.SnapshotFiles` (reads through `s.ro`, outside
  any turn), `guardCode`.
- Read `pkg/commands/files.go`: `push()` shared by `files.push` (full=true)
  and `import.files` (full=false) through `pushArgs{prune, snapshot, ifAt}`;
  `ref.move` with an optional `ifAt`; `snap.new`.
- Read `pkg/verbs/def.go`: "A field without omitempty is required" and
  `Table.Check` refuses a missing required argument with `invalid_argument`
  before `Run`; `decodeArgs` uses `DisallowUnknownFields`.
- `git grep` for callers: `pkg/client/folder.go` `Push`, `pkg/client/dev.go`
  `devPush`, `cmd/slop/cmds/extra.go` (`slop push --no-prune`, `import
  files`), `apps/blocks-site/actor.js` (`w.push`, `w.publish`),
  `apps/workshop/actor.js` (`w.push`, `w.publish`; not in the brief's list),
  `pkg/doors/actors/modworkshop.go`, `pkg/host/testdata/authz/cases.json`.
- `git grep -n 'snap.new'`: only its own definition and a table row in
  `doc/design/slop-v3.md`. Nothing calls it.
- `git grep -n '"self"'` in apps: only `pinboard`'s rule level
  (`"write": "self"`), no capability. The alias is dead.
- Baseline:
  `GOWORK=off go test -tags sqlite_fts5 ./pkg/store ./pkg/commands ./pkg/host ./pkg/client ./pkg/doors/... ./cmd/... ./pkg/rt`
  → all `ok` (`pkg/host` 21.881s).

### Why

- A green baseline separates my failures from existing ones.
- Counting callers first decided the test strategy (a harness helper rather
  than editing 140 argument maps by hand).

### What worked

- The guide's claim holds: `RefAt` plus a write in the same `Store.Do` turn
  is a compare-and-set, and `Snapshot`'s dedup gives "a no-op commit
  returns at" for free.

### What didn't work

- No failures in this step.

### What I learned

- `Store.SnapshotFiles` reads through the read pool (`s.ro`); inside a turn
  it would not see a snapshot the same turn made, hence `Turn.SnapshotFiles`
  through the writer connection.
- A `*int64` field without `omitempty` is reported as required by the verb
  table, so "required ifAt" is a struct tag plus a nil check for an explicit
  `null`.
- `apps/bench/actor.js`'s `create` pushes without `ifAt`, and its `sync`
  passes `ifAt` only when the page sends `base`: `pkg/host/bench_test.go`
  will break on the required `ifAt`, and I may not edit `apps/bench`.

### What was tricky to build

- Nothing built yet. The trap identified: the tree zone is a scratch area
  that `files.put`, `import.files` and the actor `files` module also write,
  so `files.commit` must not trust it; it resets it from snapshot `at`.

### What warrants a second pair of eyes

- The decision to remove `snap.new` (Step 5) rests on `git grep` of this
  repository only; scripts outside it are not visible to me.

### What should be done in the future

- N/A for this step.

### Code review instructions

- None (no code).

### Technical details

- Ref writers before this work: `Turn.Snapshot` (via `MoveRef`), `ref.move`,
  `pkg/actor/modules.go:521` (an actor's own `files.snapshot`, main),
  `pkg/commands/data.go:115` (import), `pkg/doors/pages/rtassets.go:205`
  (artifact publish, with its own CAS against the view's version).

## Step 2: Store helpers — SnapshotFiles and ResetTree in a turn, HasSnapshot, RemoveRef, ValidRefName

I added the turn-level helpers `files.commit` and `ref.rm` need, next to
`Snapshot` and `RefAt`, and made `MoveRef` the one place ref names are
checked (every ref creation goes through it, as every tree write goes
through `guardCode`). The artifact publish in the page door already did a
hand-written "reset the tree to main, replace one file, snapshot"; it now
uses `ResetTree`. Store tests pass.

The ref-name rule and `RemoveRef` came from the lead's second message
(below); I folded them into this store-layer commit because they live in
the same file and the same test.

### Prompt Context

**User prompt (verbatim):** see Step 1. The lead engineer then sent
(verbatim, abridged to the store part): "Ref-name validation. Today
`_refs.name` accepts any string … Add `store.ValidRefName` (proposal:
`^[a-z][a-z0-9._-]{0,62}(/[a-z0-9][a-z0-9._-]{0,62}){0,3}$` …), enforce it
in every verb that creates or moves a ref … New verb `ref.rm` … A store Turn
method `RemoveRef(name)` next to MoveRef, recorded as a change like MoveRef
does. Tests for both." A third message withdrew a proposed `from` option for
`files.commit` ("do NOT add the `from` option … A proposal ref is created
with `ref.move {ref: "proposal/<id>", n: <draft's n>, ifAt: 0}`").

**Assistant interpretation:** store primitives first, small and documented;
validation at the single choke point (`MoveRef`).

**Inferred user intent:** refs named `proposal/<id>` for the bench, and no
ambiguity between a ref called `42` and snapshot 42 in `Store.Ref`.

**Commit (code):** see Step 3 (hash recorded there).

### What I did

- `pkg/store/files.go`:
  - `Turn.SnapshotFiles(n)` (through the writer; `n = 0` has no files),
    sharing `snapshotFiles(ctx, querier, n)` with `Store.SnapshotFiles`.
  - `Turn.ResetTree(n)`: tree zone := snapshot n; puts only paths whose
    sha256 or type differ, removes paths n lacks, in path order.
  - `Turn.HasSnapshot(n)`; `MoveRef` uses it.
  - `ValidRefName` (the lead's regexp) and the check in `MoveRef`.
  - `Turn.RemoveRef(ref)`: `guardCode`, delete, record
    `Change{Kind: "ref", Op: "remove"}` when a row went.
- `pkg/doors/pages/rtassets.go`: the artifact publish reads main with
  `t.RefAt` inside its turn (it read `st.Ref` through the read pool before)
  and uses `t.ResetTree(cur)` instead of 25 lines doing the same.
- `pkg/store/store_test.go`: `TestTurnSnapshotsAndRefs`.

### Why

- `ResetTree` writes only differences so a commit on the snapshot the tree
  already holds records no file changes, and the no-op commit can return
  `at` with no rev.
- Checking names in `MoveRef` means `Snapshot`, `ref.move` and any future
  writer cannot create an invalid ref.

### What worked

- `GOWORK=off go test -tags sqlite_fts5 ./pkg/store -run 'TestTurnSnapshotsAndRefs|TestFilesAndSnapshots|TestStoreGuardsAppCode' -v -count=1`
  → three `PASS`.
- The artifact publish tests in `pkg/host` (whole package run, Step 5) pass
  with the `ResetTree` version.

### What didn't work

- No failures in this step.

### What I learned

- `ResetTree` on a tree already equal to n makes `Store.Do` return a nil
  commit (no changes): the test asserts exactly that.

### What was tricky to build

- Deterministic change order: iterating a Go map for removals would record
  changes in random order; removals iterate the sorted `TreeFiles` list.

### What warrants a second pair of eyes

- `ResetTree` compares content type as well as sha256, so a type-only
  difference is rewritten. `Snapshot`'s tree hash covers path and sha256
  only, so a type-only change still dedups to the old snapshot (unchanged
  behaviour, pre-existing).
- `RemoveRef` is guarded like `MoveRef` (no code right: refused on an app
  store), so a non-admin cannot drop refs of app code.

### What should be done in the future

- N/A.

### Code review instructions

- Start at `pkg/store/files.go` `ValidRefName`, `HasSnapshot`,
  `SnapshotFiles`, `ResetTree`, `MoveRef`, `RemoveRef`.
- `GOWORK=off go test -tags sqlite_fts5 ./pkg/store`.

### Technical details

- Ref names: `^[a-z][a-z0-9._-]{0,62}(/[a-z0-9][a-z0-9._-]{0,62}){0,3}$`.
  Valid: `main`, `draft`, `proposal/p8k2x1`, `x/1/2/3`. Invalid: `""`, `1`,
  `Main`, `x/`, `/x`, `x//y`, `x/.y`, `a/b/c/d/e`, 64 × `x`.

## Step 3: The `self` capability alias goes

`pkg/rt/manifest.go` accepted `self` as "the old name of artifact" and
rewrote it. No app in `apps/` declares a `self` capability (pinboard's
`"write": "self"` is a rule level, which I left alone), so the alias, its
rewrite and its entry in `ContractCaps` are gone, and a manifest declaring
`self` is now refused as an unknown capability.

This is independent of the rest of the work, so it is its own commit.

### Prompt Context

**User prompt (verbatim):** see Step 1 (brief item 3: "Remove the alias if
no app in `apps/` declares the `self` capability … leave levels alone").

**Assistant interpretation:** delete the compatibility alias and its test
use; keep the rule level `self`.

**Inferred user intent:** no backwards-compatibility code.

**Commit (code):** the previous step's store layer is `9aae6b8` — "Store:
SnapshotFiles and ResetTree in a turn, RemoveRef, ref names". This step's
hash is in Step 4.

### What I did

- `git grep -n '"self" *:'` outside `ttmp`: only `pkg/rt/core_test.go:206`
  (the test that used the alias) and the alias itself.
- `pkg/rt/manifest.go`: removed `"self": true` from `ContractCaps` and the
  `if name == "self" { name = "artifact" }` rewrite.
- `pkg/rt/core_test.go` `TestManifest`: declares `"artifact":{}` instead,
  and `{"capabilities":{"self":{}}}` joins the manifests that must be
  refused.

### Why

- The brief and the user's standing direction: no legacy aliases.

### What worked

- `GOWORK=off go test -tags sqlite_fts5 ./pkg/rt` → `ok`.

### What didn't work

- No failures.

### What I learned

- `self` survives in two unrelated places that must stay: the rule level
  (`pkg/rt/rules.go` `levelNames`) and the `{self}` path variable in rules.

### What was tricky to build

- Nothing.

### What warrants a second pair of eyes

- A deployed app outside this repository that still declares `self` now
  fails to parse (the brief accepts that).

### What should be done in the future

- N/A.

### Code review instructions

- `pkg/rt/manifest.go` `ContractCaps`, `ParseManifest`;
  `GOWORK=off go test -tags sqlite_fts5 ./pkg/rt -run TestManifest`.

### Technical details

- N/A.

## Step 4: A verb's error details reach actor JavaScript as `e.extra`

The bench actor will catch `files.commit` conflicts, which carry their
substance in `verbs.Error.Extra` (`at`, `conflicts`). The path from a verb
into actor JavaScript dropped it: `actor.Error` had only code, message and
confirm. It now has `Extra map[string]any`, every place in the module door
that turns a verb error into an actor error goes through one helper,
`verbFail`, and the runtime sets `e.extra` on the thrown JS `Error`. An
action that rethrows the error keeps the details on its way back to an
`actor.call` caller.

The end-to-end test (a workshop module conflict caught in JavaScript, and
rethrown to the caller) needs `files.commit`, so it lands with Step 5
(`TestWorkshopCommit`); this commit carries the unit test of `verbFail`.

### Prompt Context

**User prompt (verbatim):** see Step 1. The lead engineer's fourth message
(verbatim, abridged): "verb errors lose their structured data on the way
into actor JavaScript. `pkg/actor/actor.go` `type Error struct {Code,
Message, Confirm}` has no extra field … Please add `Extra map[string]any
\`json:"extra,omitempty"\`` to `actor.Error`, copy `ve.Extra` in every place
a verb error becomes an actor error … and make the JS error object the
actor sees expose it as `e.extra` … keep `e.code`/`e.message` as they are.
A test in the actors package that a workshop verb's conflict reaches JS
with `extra.at` and `extra.conflicts`. Also confirm the change shape for
deletions in files.commit is `{path, delete: true}`."

**Assistant interpretation:** one conversion helper, the runtime exposes
the field, and the reverse direction (a rethrown JS error) keeps it too.

**Inferred user intent:** `try { await w.commit(...) } catch (e) { e.code
=== 'conflict' && e.extra.conflicts }` in the bench actor.

**Commit (code):** Step 3's alias removal is `d34c438` — "Manifest: drop
the self capability alias". This step's hash is in Step 5.

### What I did

- `pkg/actor/actor.go`: `Error.Extra map[string]any \`json:"extra,omitempty"\``;
  `errValue` sets `extra` (through `toJS`, i.e. JSON into native objects);
  `jsError` reads `extra` back from a thrown object, so a rethrow keeps it.
- `pkg/doors/actors/modules.go`: `verbFail(err) *actor.Error`, which copies
  `verbs.Error.Extra` through JSON (a typed `[]CommitConflict` becomes
  `[{path}]`). Used by `callVerb` (both the pre-confirmation `Check` and the
  call itself) and by every conversion in `modworkshop.go` (`drop`, `embed`,
  `renewEmbed`; the local `fail` closure is gone).
- `pkg/commands/actors.go` `actorErr`: an `actor.Error`'s `Extra` becomes
  the `verbs.Error`'s `Extra` (`actor.call` callers see it); a confirmation
  still replaces it with `{confirm}` as before.
- `pkg/doors/actors/modules_test.go`: `TestVerbFailKeepsExtra`.

### Why

- One helper instead of five copies of `ve := verbs.AsError(err); return
  &actor.Error{Code: ve.Code, Message: ve.Message}` is the reason the field
  was dropped in the first place.
- JSON normalization: `Extra` is `any`; a typed value handed to goja would
  surface Go field names, not JSON names.

### What worked

- `GOWORK=off go test -tags sqlite_fts5 ./pkg/doors/actors -count=1` → `ok`.
- Step 5's `TestWorkshopCommit` shows the whole path: caught in JS,
  `{"at":<n>,"conflicts":[{"path":"index.html"}]}`; rethrown, the
  `actor.call` error has `extra.at`.

### What didn't work

- No failures in this step.

### What I learned

- All I/O rejections go through `a.errValue(a.asError(err))` in `io`
  (`pkg/actor/actor.go`), so setting the field in `errValue` covers every
  module, not only workshop.

### What was tricky to build

- `pkg/doors/actors` had no test file and its integration lives in
  `pkg/host`; the unit test covers the conversion, the host test covers the
  runtime.

### What warrants a second pair of eyes

- The page door (`pkg/doors/pages`, `rtFail`) still sends only code,
  message and confirm to the browser runtime: a browser `slop.call` does not
  see `extra`. Adding it needs a runtime change in `web/runtime` (built
  output is committed), which I left out of scope.
- When an action rethrows a `confirmation_required` error, `actorErr` keeps
  replacing `Extra` with `{confirm}` (as before).

### What should be done in the future

- If the bench page needs a conflict's details directly (not through its
  actor), carry `extra` through `rtFail` and the page runtime.

### Code review instructions

- `pkg/doors/actors/modules.go` `verbFail`; `pkg/actor/actor.go` `errValue`,
  `jsError`; `pkg/commands/actors.go` `actorErr`.
- `GOWORK=off go test -tags sqlite_fts5 ./pkg/doors/actors ./pkg/host -run 'TestVerbFailKeepsExtra|TestWorkshopCommit'`
  (the second needs Step 5).

### Technical details

- The deletion shape for `files.commit` is `{path, delete: true}`
  (`FileChange.Delete`), confirmed in Step 5's tests.
