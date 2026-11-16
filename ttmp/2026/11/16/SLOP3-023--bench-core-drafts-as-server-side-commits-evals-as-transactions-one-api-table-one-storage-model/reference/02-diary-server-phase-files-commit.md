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
RelatedFiles:
    - Path: repo://cmd/slop/cmds/extra.go
      Note: slop push --ifAt, slop ref move
    - Path: repo://pkg/commands/files.go
      Note: files.commit, files.push/ref.move with required ifAt, ref.rm, import.files
    - Path: repo://pkg/doors/actors/modules.go
      Note: 'verbFail: verb error details as e.extra'
    - Path: repo://pkg/doors/actors/modworkshop.go
      Note: workshop commit and dropRef; preconditions of each write
    - Path: repo://pkg/host/commit_test.go
      Note: files.commit, ref.rm and workshop conflict tests
    - Path: repo://pkg/store/files.go
      Note: Turn.SnapshotFiles, ResetTree, HasSnapshot, RemoveRef, ValidRefName
ExternalSources: []
Summary: 'Implementation diary of SLOP3-023 phase 1 (server): files.commit, required ifAt on every ref write, ref.rm, ref-name validation, verb error details in actor JavaScript, removal of snap.new and the self capability alias.'
LastUpdated: 2026-11-16T13:40:03.41911302-05:00
WhatFor: Reviewing and continuing the server half of SLOP3-023 (branch task/slop3-023-server).
WhenToUse: Before reviewing the server PR, or when the bench rewrite (phase 2) needs the exact server contract.
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

## Step 5: files.commit, a required ifAt on every ref write, ref.rm, and every caller

This is the verb layer. `files.commit` applies a change list against a
required `base` in one store turn: where the ref is now (`at`); if it moved,
a per-path check against the files of `base` and `at`; then the tree is
reset to `at`, the changes applied, and the tree snapshotted onto the ref.
`files.push` and `ref.move` now require `ifAt`; `ref.rm` is new; `snap.new`
is gone; push lost `prune`, `snapshot` and `zone`; `import.files` has its
own code path. Every caller in the repository passes the precondition: the
Go client and CLI, `apps/workshop`, `apps/blocks-site`, the workshop module
table, the tests and the authz fixture.

All target packages pass, `make lint` reports 0 issues. One bench test is
skipped on purpose: `apps/bench`'s `create` pushes without `ifAt`, and the
bench is being rewritten by another engineer (I may not edit it).

### Prompt Context

**User prompt (verbatim):** see Step 1 (brief items 1 and 2), and the lead's
messages quoted in Steps 2 and 4 (`ref.rm`, `ValidRefName` enforcement in
the verbs, no `from` option, the `{path, delete: true}` deletion shape).

**Assistant interpretation:** one typed write primitive; exact
preconditions (`ifAt`) on every other ref write; delete what nothing uses.

**Inferred user intent:** the bench's writes become explicit operations
whose answers mean "committed at n", and no write can silently overwrite
another.

**Commit (code):** Step 4's actor error details are `e8c6e9a` — "Actors: a
verb's error details reach JavaScript as e.extra". This step's hash is in
Step 6.

### What I did

- `pkg/commands/files.go`:
  - `files.commit` (`FilesCommitIn/Out`, `FileChange`, `CommitConflict`):
    `readChanges` validates (clean path, once, exactly one of
    text/data/sha256/delete), stores inline contents as blobs, and answers
    `missing_blobs` (`extra.missing`) for sha256 entries the server lacks;
    `commit` runs the turn; `commitConflicts` is the per-path rule.
  - A ref removed since `base` (`at == 0 && base > 0`) is a conflict
    (`extra.at: 0`, `extra.conflicts: []`), not a new ref made of the
    changes alone. The brief did not cover this case; see "second pair of
    eyes".
  - `files.push` → `filesEnv.push`: `ifAt` required, always the tree,
    always pruned, always snapshotted; typed `FilesPushOut`.
  - `import.files` → `filesEnv.importFiles` (zone, add, no prune, no
    snapshot; typed `ImportFilesOut`); both share `readManifest`.
  - `activate` helper, typed `Activated`, used by push and commit.
  - `refIsAt` (the precondition, conflict with `extra.at`) used by push,
    `ref.move` and `ref.rm`; `refArg`/`badRef` for ref names.
  - `ref.move`: `ifAt` required, name must be a `ValidRefName` (no empty
    name defaulting to main), conflict now carries `extra.at`.
  - `ref.rm` → `filesEnv.removeRef`; `following` lists stores whose
    registry row runs this app and whose `app_ref` meta is the ref.
  - `snap.new` removed (no caller; `files.commit` covers "change the tree
    and snapshot it", with a precondition).
- `pkg/doors/actors/modworkshop.go`: `commit` (`files.commit`, default ref
  draft) and `dropRef` (`ref.rm`) rows, and the comment block stating each
  write's precondition. `pkg/doors/actors/modules.go`: the module's doc.
- `pkg/client/folder.go`: `Push` reads the ref (`RefAt`, new) for `ifAt`
  unless given; `pkg/client/dev.go`: `devPush` documented (it uses `Push`).
- `cmd/slop/cmds/extra.go`: `slop push` loses `--no-prune` (nothing used
  it) and gains `--ifAt`; `slop ref move` replaces the generated command:
  `--ifAt`, or it reads the ref and prints `ref: from → to` on stderr after
  the move.
- `apps/workshop/actor.js`: `push` with puts/removes is now
  `w.commit(store, changes, {base: n})` (a merge over draft instead of
  replacing draft with n plus the changes); `replace` is `w.push` with
  `ifAt` = draft now; `publish` passes `ifAt` = main now.
- `apps/blocks-site/actor.js`: reads `w.refs(to)`, pushes with `ifAt:
  refs.draft ?? 0`, publishes with `ifAt: refs.main ?? 0`.
- Tests:
  - `pkg/host/harness_test.go`: `h.refAt`, `h.push` (fills `ifAt` from
    `ref.ls` unless given), `h.commit` (fills `base`). `sed -E
    's/h\.call\(([A-Za-z]+), "files\.push", /h.push(\1, /g'` over
    `pkg/host/*_test.go` (116 call sites).
  - The four `"prune": false` pushes (`actors_test.go`, `serving_test.go`)
    became `h.commit` with the same files as `changes`.
  - `h.fail(... "files.push" ...)` sites pass an explicit `ifAt`;
    `stores_test.go`'s eval program chains `ifAt: site.n`; `cases.json`
    gets `"ifAt": 0`; the JS test actors in `devloop_test.go` and
    `workshop_module_test.go` pass `ifAt`.
  - `pkg/host/commit_test.go` (new): `TestCommitClean`, `TestCommitMerge`,
    `TestCommitArguments`, `TestCommitActivates`, `TestCommitConcurrent`,
    `TestRefRm`, `TestWorkshopCommit`.
  - `devloop_test.go`: `TestRefMoveIfAt` (required ifAt, `extra.at`, bad
    names, `proposal/p8k2x1`), `TestPushIfAt` (required ifAt, the removed
    knobs refused, bad ref name).
  - `cmd/slop/cmds/refs_test.go` (new): the CLI against a fake server.
  - `bench_test.go`: the two `sync` calls pass `base` (the bench actor
    turns it into `ifAt`); `create` moved to `TestBenchCreate`, skipped.
- Docs: `doc/building-apps.md` (verbs table, dev loop, publishing, ref
  names, `ref.rm`, workshop functions and `e.extra`, the deploy script's
  missing `ifAt`), `doc/design/slop-v3.md` (verb table).

### Why

- `ifAt` as a pointer without `omitempty`: the verb table reports it
  required (`invalid_argument: files.push needs ifAt`) before `Run`, and the
  nil check catches an explicit `null`.
- The harness helper keeps 116 test call sites readable and makes the
  precondition explicit at the one place it is computed; the tests of the
  precondition itself pass `ifAt` directly.
- Workshop's file edits as a commit: before, "push onto #n" replaced draft
  with n's files plus the edit, silently dropping anything committed to
  draft since n.
- `slop push --no-prune` removed rather than reimplemented: nothing in the
  repo or scripts uses it, and `files.commit` is the primitive for "add
  these files".

### What worked

- `GOWORK=off go test -tags sqlite_fts5 -count=1 ./pkg/store ./pkg/commands ./pkg/host ./pkg/client ./pkg/doors/... ./cmd/... ./pkg/rt ./pkg/actor`
  → all `ok` (`pkg/host` 21.5s; 145 PASS, 3 SKIP: `TestBenchCreate` (new,
  see below) and the pre-existing env-gated `TestBenchActorRuntime`,
  `TestBenchPageDBQuery`).
- `GOWORK=off go test -race -tags sqlite_fts5 ./pkg/host -run 'TestCommitConcurrent|TestWorkshopCommit' -count=3` → `ok`.
- `make lint` → `0 issues.`; `make fmt-check` → no diff.

### What didn't work

- My first Python edit of the type section raised
  `ValueError: substring not found`: the earlier replacement of the
  `pushFile … SnapLsIn` range had already removed `SnapNewIn`. Re-ran
  without that part.
- The `sed` that rewrote test pushes also rewrote the helper's own
  `return h.call(token, "files.push", args)` into `return h.push(token,
  args)` (infinite recursion); caught by `grep` before running, fixed.
- First full run, two failures:
  - `bench_test.go:106: actor.call map[action:sync …]: 400 map[error:map[code:invalid_argument message:files.push needs ifAt]]`
  - `serving_test.go:126: files.push map[… ifAt:0 store:bobs-site]: want permission_denied, got 409 map[error:map[code:conflict extra:map[at:1] message:main points at 1, not 0: it moved since you looked]]`
    (the precondition is checked before `guardCode`; the test now passes
    main's real position so it still tests D9.)
- `TestBenchCreate` without the skip:
  `bench_test.go:154: actor.call map[action:create …]: 400 map[error:map[code:invalid_argument message:files.push needs ifAt]]`.
- `commit_test.go:103: tree at 2 = map[empty.txt: index.html:<h1>two</h1> style.css:h1{}]`:
  I compared `json.Marshal` output (which escapes `<` as `<`) with a
  literal holding `<`; replaced by `reflect.DeepEqual`.
- `gofmt -l` listed `pkg/host/commit_test.go` (comment alignment); `gofmt -w`.
- `make lint`: `pkg/commands/files.go:521:4: ineffectual assignment to data (ineffassign)`,
  `1 issues:`, `make: *** [Makefile:6: lint] Error 1` (`data := []byte{}`
  before an if/else that always assigns); now `var data []byte`.
- `refs_test.go`: `write /dev/null: bad file descriptor` (I opened
  `/dev/null` read-only to swallow stdout); `os.OpenFile(..., O_WRONLY)`.
- I could not drive the real CLI against `slop serve --local`: the CLI
  needs a token, and the `X-Slop-As` header the config comment mentions is
  not implemented (`git grep -i slop-as` finds only that comment). The CLI
  is tested against a fake server instead, and the client's `Push` against
  the real server through `TestSlopDev`.

### What I learned

- `Snapshot` dedups only against the ref's own current snapshot, so "a
  no-op commit returns at" holds exactly; the same tree on another ref
  still makes a new snapshot number.
- The registry row's `App` plus each instance's `app_ref` meta is enough to
  find a ref's followers; it is read outside the store turn.

### What was tricky to build

- Conflict rule, path by path: "they changed it" is presence or sha256
  differing between `base` and `at`; "same result" is (delete and absent at
  `at`) or (same sha256 at `at`). A path absent from both is untouched.
  `base = 0` over an existing ref treats everything there as theirs, so a
  new path merges and an existing one conflicts.
- Ordering inside the turn: the precondition and conflict check come
  before `ResetTree`, so a refused commit writes nothing (the turn rolls
  back anyway, but nothing is even attempted).
- Inline contents are stored as blobs before the turn (as push did), so a
  refused commit can leave unreferenced blobs, as a refused push could.

### What warrants a second pair of eyes

- The removed-ref conflict (`at == 0 && base > 0`), my addition.
- `ref.rm`'s follower check runs outside the turn: a store that starts
  following the ref between the check and the removal is not seen (it then
  runs nothing until it follows another ref). App stores follow their own
  `app_ref` too and are included.
- `slop dev` still replaces draft wholesale: `Push` reads draft just before
  the push, so `ifAt` only guards that window, not commits made since the
  previous push. Making the loop pass the n of its last push would refuse
  (and keep retrying) after any other writer touched draft; that is a
  product decision.
- `TestBenchCreate` is skipped until the bench rewrite passes `ifAt` in
  `create` (and `sync` without `base` also fails now).
- `ttmp` scripts of SLOP3-004/013/015/018 call `files.push` without `ifAt`
  and would now fail; they are historical and I left them.
- Tree-zone writes outside a snapshot (`files.put`/`files.rm` on the tree,
  `import.files` into the tree) are now transient: the next push replaces
  the tree and the next commit resets it.

### What should be done in the future

- Phase 2 (bench): `w.commit(app, changes, {base, activate})`, catching
  `e.code === 'conflict'` with `e.extra.at` / `e.extra.conflicts`; `create`
  and `sync` with `ifAt`; then remove the skip in `TestBenchCreate`.
- Consider whether `files.put`/`files.rm` on the tree zone should go, now
  that the tree is rebuilt from snapshots on every write.

### Code review instructions

- Start at `pkg/commands/files.go`: `commit`, `commitConflicts`,
  `readChanges`, `push`, `refIsAt`, `removeRef`, `following`, then the
  types at the end of the file.
- Then `pkg/doors/actors/modworkshop.go` (table), `pkg/client/folder.go`
  (`Push`, `RefAt`), `cmd/slop/cmds/extra.go` (`pushCmd`, `refMoveCmd`),
  `apps/workshop/actor.js` (`push`, `publish`), `apps/blocks-site/actor.js`.
- Tests: `pkg/host/commit_test.go`, `pkg/host/devloop_test.go`
  (`TestRefMoveIfAt`, `TestPushIfAt`), `cmd/slop/cmds/refs_test.go`.
- `GOWORK=off go test -tags sqlite_fts5 ./pkg/store ./pkg/commands ./pkg/host ./pkg/client ./pkg/doors/... ./cmd/...` and `make lint`.

### Technical details

`files.commit` input:

```json
{"store": "jot", "ref": "draft", "base": 41, "message": "…",
 "changes": [{"path": "index.html", "text": "…"},
             {"path": "logo.png", "data": "<base64>", "type": "image/png"},
             {"path": "big.bin", "sha256": "<hex>", "size": 2048, "type": "…"},
             {"path": "old.js", "delete": true}],
 "blobs": {"<sha256>": "<base64>"},
 "activate": ["jot-dev-d4776d"]}
```

Output: `{"n", "at", "base", "merged", "rev"?, "activated"?: [{"store",
"app"?, "ref"?, "n", "broken", "error"?}]}`. Errors: `invalid_argument`
(no or negative base, base not a snapshot, bad path, duplicate path, not
exactly one of text/data/sha256/delete, unknown field, bad ref name, bad
base64, too large, too many files); `missing_blobs` with
`extra.missing: [sha256…]`; `conflict` with `extra.at` and
`extra.conflicts: [{"path"}]` (empty list when the ref was removed since
base).

`files.push` input: `{store, files, blobs?, message?, ref? (main), ifAt
(required), activate?}`; output `{n, files, removed, rev?, activated?}`.
`ref.move`: `{store, ref, n, ifAt (required)}` → `{n, from, ref, rev}`.
`ref.rm`: `{store, ref, ifAt (required)}` → `{ref, n, rev}`; errors
`invalid_argument` (no ifAt, main), `not_found`, `conflict` (`extra.at`;
or `extra.stores` when followed). `import.files`: `{store, files, blobs?,
zone?}` → `{files, rev?}`. Workshop: `commit(store, changes, {base, …})`,
`push(store, files, {ifAt, …})`, `moveRef(store, ref, n, {ifAt})`,
`publish(store, n, {ifAt})`, `dropRef(store, ref, {ifAt})`.

## Step 6: Each commit checked on its own, and the full suite

The lead asked for commits at validated boundaries, so the work is four
commits, and I checked that each of them builds and passes on its own, not
only the last one. I checked out each intermediate commit in a throwaway
worktree, built it and ran the affected packages; then ran `make test` on
the branch head. Everything passes.

### Prompt Context

**User prompt (verbatim):** see Step 1. The lead engineer's fifth message:
"The user asked that every agent keep a detailed diary in the diary skill's
investigation format and commit at appropriate intervals … Commit at
meaningful validated boundaries (e.g. store helpers + tests; files.commit +
tests; required ifAt + callers; ref.rm/ValidRefName; actor error extras),
each commit with its diary step, rather than one commit at the end."

**Assistant interpretation:** split the finished work into self-contained
commits, each with its diary step, and prove each one stands alone.

**Inferred user intent:** a reviewable history in which every commit is a
working state.

**Commit (code):** Step 5's verb layer is `81b64e6` — "files.commit; every
ref write states where the ref is; ref.rm". This diary step is committed on
its own after it.

### What I did

- Split the work into four commits:
  - `9aae6b8` store layer (Steps 1–2);
  - `d34c438` the `self` alias (Step 3);
  - `e8c6e9a` actor error details (Step 4);
  - `81b64e6` the verb layer and every caller (Step 5).
- Two files carried changes for two commits (`modules.go`, `modworkshop.go`:
  the `verbFail` conversion for Step 4, the workshop table and doc for Step
  5). I copied the finished files aside, wrote Step 4's versions from
  `HEAD` plus only the `verbFail` changes, committed, and restored the
  finished files for Step 5. No stash.
- `git worktree add --detach <scratchpad>/t23s-verify 9aae6b8`, then for
  each of `9aae6b8 d34c438 e8c6e9a`: `go build -tags sqlite_fts5 ./...` and
  `go test -tags sqlite_fts5 -count=1 ./pkg/store ./pkg/rt ./pkg/doors/...
  ./pkg/commands ./pkg/host`; then `git worktree remove`.
- `make test` on `81b64e6`.
- `docmgr doc relate` of the six primary files to this diary.

### Why

- Splitting the two shared files by hand keeps every commit buildable,
  which `git add` of whole files could not.

### What worked

- All three intermediate commits: build ok; `pkg/store`, `pkg/rt`,
  `pkg/doors/actors` (from `e8c6e9a`), `pkg/doors/pages`, `pkg/commands`,
  `pkg/host` all `ok` (`pkg/host` 20.8s, 20.8s, 23.4s).
- `make test` on `81b64e6`: 22 packages `ok`, no `FAIL`.
- Earlier on the same tree: `make lint` → `0 issues.`, `make fmt-check` →
  no diff.

### What didn't work

- No failures in this step.

### What I learned

- N/A.

### What was tricky to build

- Keeping the intermediate `modworkshop.go` coherent: Step 4's version is
  `HEAD`'s header and table with the finished `workshopModule` function, and
  without the now unused `verbs` import.

### What warrants a second pair of eyes

- See Step 5's list; nothing new here.

### What should be done in the future

- Merge order with the bench rewrite: `TestBenchCreate` is skipped on this
  branch and should be re-enabled by the bench PR.

### Code review instructions

- `git log --oneline 11edca9..` on `task/slop3-023-server`; review commit by
  commit, in order.

### Technical details

- Commits: `9aae6b8`, `d34c438`, `e8c6e9a`, `81b64e6`, then this diary
  step.
