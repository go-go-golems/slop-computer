---
Title: Diary
Ticket: SLOP3-017
Status: active
Topics:
    - pinboard
    - security
    - actor
    - cli
    - review
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological diary of SLOP3-017: the fixes for the Codex review findings on the SLOP3-016 PRs, and their consolidation into one PR"
LastUpdated: 2026-11-07T18:44:25.87170891-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Chronological record of SLOP3-017. It covers the fixes for the eight open Codex findings on the SLOP3-016 PRs (#36, #37, #39), each made at its root cause (design doc 01). It also covers folding #36–#39 into one PR. The code is on `task/slop3-016-phase6` (worktree `scratchpad/slop016`); the ticket docs go to `main` from the docs worktree (`scratchpad/slop016docs`, branch `task/slop3-017-docs`).

## Context

- **Findings:** design doc 01 §2 has the table, F1–F8, and their weights.
- **Prior work:** SLOP3-016 diary steps 10–14; the actor VM diary steps 5–6; GOJA-069 step 6, which fixed the go-go-goja half of the review in go-go-golems/go-go-goja#107.

## Step 1: Ticket, design doc and task list

The Codex findings on #36, #37 and #39 had not been assessed when the go-go-goja review was. This step records which are real, what they cost in practice, and how each is fixed at its root cause.

### Prompt Context
**User prompt (verbatim):** "Ok, then let's create a ticket for these and a design doc that writes up how to address these (now that we studied them). Then impement and commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). we can stack the fixes on the last one and in fact reduce this to a single PR by merging, now that we've had respective reviews of the PRs"
**Assistant interpretation:** Create a ticket and a design doc for the eight findings, fix them on #39's branch, fold #36–#39 into one PR, and keep this diary.
**Inferred user intent:** Ship one reviewed PR with the findings fixed at their causes, and a written record of why each fix has the shape it has.

### What I did
- Read every finding against the code on `task/slop3-016-phase6` (fdaacf5):
  - **F1:** `apps.js:56-60` trusts `a.uid` and `a.sha256`. `app.json` gives admins write access to `apps`.
  - **F2:** `board.js:601` and `:297` classify `blob:` references by `PB.blobs[src]`. With the asset store, drawing images never fills `PB.blobs` (`store.js:217`).
  - **F3:** `core.js:255` checks `JSON.stringify(e).length > 200000`.
  - **F4:** reproduced with a throwaway test. `Execute(…, use=["slop","pb","Kitchen Board"], args=["clip","ls"])` prints `pb`'s help, returns nil and makes no call.
  - **F5:** `verbsDir` keeps only `u.Host`.
  - **F6:** core's `update` accepts a function (`core.js:194`), and so does `promote` (`:197`). The frame recorder sends functions as they are, and they arrive as `null`. Its `promote` drops the function.
  - **F7:** `framedDef` uses `a.state || {}`. `m.open` copies `def.state` into the new window. `framedMeta` never fills in window state.
  - **F8:** `toolRunner`'s pending branch reports a rejection through `then`. `handle` only checks the root promise.
- Measured the weights:
  - Pinboard's agent tools are synchronous actions; `ask`, the one async action, is not a tool.
  - The built-in Moodboard (in-page, `SRC.moodboard`) uses `c.board.clip(ui.image(im.src))`, which F2 breaks. It also uses `update(id, r => …)`, which F6 breaks only in framed apps.
- Platform facts the design depends on:
  - The `self` rule level is held by nobody (`pkg/rt/rules.go`).
  - The actor writes its own store through `turn.SetDoc`, without page rules (`pkg/actor/modules.go:337`).
  - The page reaches actor actions through `PB.rt.slop.call` (`web/runtime/src/caps.ts` `slop()`).
  - Pages do not see a document's writer: the wire `Entry` and `DocSnap` have no `by`, although `store.Doc.By` exists.
  - `Actor.Later` posts continuation events whose `parent` is the root event.
- Wrote design doc 01 (root causes, one design per finding, alternatives, plan, PR consolidation) and twelve tasks with docmgr.

### Why
- **F1 through the actor, not a writer field for pages.** A writer field is the more general primitive, but it changes the db stream protocol, the runtime's `DocSnap` and `claude.js`. Actor-owned registration stays inside Pinboard and uses only existing levels.
- **F6 as a shared step table.** Patching `update` alone would leave the next function-taking step broken in the same silent way.

### What worked
- Every finding checked out against the code; none was a false positive.

### What didn't work
- Nothing yet.

### What I learned
- Codex had reviewed #36, #37 and #39 hours earlier, and I had not looked: the earlier question was about #107 only. Review state is worth checking on every PR of a stack.

### What was tricky to build
- Weighing F1's two designs. The writer-field primitive is cleaner as a concept; the actor path is cheaper and keeps the platform untouched.

### What warrants a second pair of eyes
- Design §3.5: refusing log reverts that touch `apps`. App changes stop being undoable from the log, and only re-registering an earlier version brings an app back.

### What should be done in the future
- A platform ticket for document writers in page snapshots (design §11).

### Code review instructions
- Read design doc 01 §2 (the table), then §3 and §8, the two that change contracts.

### Technical details
- Ticket: `ttmp/2026/11/07/SLOP3-017--review-fixes-for-slop3-016-app-trust-frame-protocol-read-time-defaults-turn-outcomes-cli-verb-dispatch/`.

## Step 2: #38 merged into #39's branch (step 0)

The actor VM PR is folded into the Pinboard stack first, so that F8 changes the reconciled `handle`, not one of two diverging copies.

### Prompt Context
**User prompt (verbatim):** (see step 1)
**Assistant interpretation:** Design §9.1: merge #38 into `task/slop3-016-phase6` before the fixes.
**Inferred user intent:** One branch, one PR.
**Commit (code):** `c61574c`, "Merge task/slop3-016-actor-host (#38) into the Pinboard stack (SLOP3-017 step 0)".

### What I did
- Ran `git merge --no-ff origin/task/slop3-016-actor-host` on the phase6 branch.
- Resolved `go.mod` by keeping glazed 1.4.3 from #37, go-jose 4.1.8, and #38's go-go-goja require line. The replace to the wesen fork at 0d995b4 is the same on both sides.
- Resolved `go.sum` by taking ours.
- Ran `go mod tidy`.

### Why
- F8 changes `handle`, which #38 split into `handle` (the host run) and `turnFor` (the transaction).

### What worked
- `pkg/actor/actor.go` merged with no textual conflict. #39's `Later` and `ev.failed` branches landed inside #38's `turnFor`, under the host run.
- `go build ./...` and `go vet ./pkg/actor/ ./pkg/doors/actors/` pass.
- `go test ./pkg/...` passes (direct runtime), and so does `SLOP_TEST_ACTORS_RUNTIME=engine go test ./pkg/host/...` (16.4 s).

### What didn't work
- Nothing.

### What I learned
- The conflict predicted in SLOP3-016, "#39's `ev.failed` branches must move into `turnFor`", did not occur as text. Git placed them correctly because #38 moved the block without changing it.

### What was tricky to build
- Reading the merged `handle` for semantic gaps. I found one: when the host cannot run a turn at all (its runtime is closed), the new error path replies to the parked handler but not to a `Later` turn's `failed` callback. A tool would then wait out its 60 s timeout. It is left for F8, which changes that code.

### What warrants a second pair of eyes
- That gap, until F8 lands.

### What should be done in the future
- Nothing beyond F8.

### Code review instructions
- `git show c61574c --stat`; `git diff c61574c^1 c61574c -- pkg/actor/actor.go`.

### Technical details
- Codex finished its re-review of go-go-goja#107 at 0d995b4 with `has_any_findings: false`.

## Step 3: F2 and F3, one definition per question

Two small fixes with the same shape: an answer was computed two different ways in two places.

### Prompt Context
**User prompt (verbatim):** (see step 1)
**Assistant interpretation:** Design §4.
**Inferred user intent:** Fix the two #36 P2s and anything else with the same cause.
**Commit (code):** `c5f5933`, "Pinboard: assets by reference, log sizes in bytes (SLOP3-017 F2, F3)".

### What I did
- **F2:** `board.js` `clip(ui.image(src))` and the drop of image items classify with `PB.isAssetRef`. A comment in `store.js` says `PB.blobs` is a byte cache only.
  - **The agent had the same bug:** `imagesToSend` only attached image clips whose bytes were cached. It now selects image clips by reference, and `A.send` fetches the missing bytes with `PB.fetchBlob`, dropping any that fail.
- **F3:**
  - `core.byteLength(str)` is the UTF-8 length in plain JavaScript: surrogate pairs count 4 bytes and a lone surrogate counts 3, as Go's replacement character does.
  - `logEntry` trims when the serialized entry is over `MAX_LOG_BYTES = 200 KiB`.
  - `byteLength` is exported for the actor (F1 uses it).
- Tests in `apps/pinboard/test/core.test.js`:
  - `byteLength` against `Buffer.byteLength`, for ASCII, é, CJK, emoji and a lone surrogate.
  - A log entry of 2 × 40,000 CJK characters is trimmed. That is 80,000 UTF-16 units but about 240 KB of UTF-8.

### Why
- **F2:** with the asset store, drawing images never fills `PB.blobs` (`blobURL` returns `/_blob/<id>`). Classifying by the cache was therefore wrong on every reload.
- **F3:** the limit the store enforces is in bytes.

### What worked
- `node --test apps/pinboard/test/core.test.js`: 13 pass.
- With the old check (`JSON.stringify(e).length > 200000`) the CJK test fails, so the test catches the bug.
- `go test ./pkg/host -run Pinboard`: ok.

### What didn't work
- Nothing.

### What I learned
- Offline blob ids (`blob:mem…`) also match `isAssetRef`, so one classifier covers both modes.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- `A.send` now awaits image fetches before the message appears. A slow asset delays the send by that fetch.

### What should be done in the future
- Nothing.

### Code review instructions
- `git show c5f5933`.

### Technical details
- `node --test apps/pinboard/test/core.test.js` (the directory form `node --test test/` does not work here).

## Step 4: F1 (P1), the actor registers apps

The consent prompt depended on two fields that any board admin could write. Now only the actor writes them, and the page hashes the source it is about to run.

### Prompt Context
**User prompt (verbatim):** (see step 1)
**Assistant interpretation:** Design §3.
**Inferred user intent:** Close the P1 at its cause.
**Commit (code):** `5ac4b14`, "Pinboard: the actor registers apps; trust hashes the source (SLOP3-017 F1, P1)". It was amended before the push to include the updated `pinboard_test.go`.

### What I did
- **`app.json`:** `{ "path": "apps", "read": "view", "write": "self" }`.
- **`actor.js`:**
  - `registerApp` (admin):
    - checks the name with `/^[a-z][a-z0-9_-]{0,59}$/i`, and the source size with `byteLength` against 160 KiB (the source is held twice, in the record and in its version);
    - computes `sha256 = C.sha256(source)`, and sets `uid = ctx.visitor.id` and `by` = the visitor's name, email or id;
    - bounds the size fields and copies `state` and `params` as plain data;
    - writes the record through `commit()`, so the log records it, and writes `apps/<name>/versions/<n>`.
  - `unregisterApp` (admin): closes the app's windows and removes the record through `commit()`.
- **`apps.js`:**
  - `sourceHash` is memoized per source text, capped at 64 entries.
  - `trusted` and `trust` hash `a.source` and never read `a.sha256`.
  - `registerSource` is async: on a board it calls `PB.rt.slop.call('registerApp', …)`; offline it writes locally as before. `unregister` is the same.
  - `registerFromEditor` awaits the registration.
- **Callers:** first-load seeding in `main.js` awaits the registration. So does the agent's app-registering step, which now registers once instead of once per captured definition.
- **`store.js`:**
  - `writable('apps')` is false on a board, so the page never sends app writes.
  - `revertLogEntry` refuses entries that touch `apps`.
  - `PB.saveVersion` is removed.
- **Tests:**
  - New `pkg/host/pinboard_apps_test.go` `TestPinboardAppRegistration`.
  - In `pinboard_test.go`, the assertion "ada (owner) registers an app" with a direct page write is now "the owner's page write is refused".

### Why
- The other way to make `uid` trustworthy is to show pages each document's server-stamped writer (`store.Doc.By`). That is a protocol change across the db stream, `DocSnap` and `claude.js`. The actor path uses only existing levels (design §3, alternatives).

### What worked
- `TestPinboardAppRegistration` covers:
  - `uid` and `sha256` stamped by the actor;
  - `docs.set` under `apps/` refused for Bob (admin) and Ada (owner), including `versions/9`;
  - Bob's registerApp names Bob even when he sends `uid: <Ada>`, `sha256: <hers>`, `by: "Ada"`;
  - Carol (view) refused;
  - a bad name and an empty source refused;
  - the log has `register hello v1` and `v2`;
  - `unregisterApp` removes the record and keeps `versions/2`.
- With the rule set back to `write: admin`, the test fails at the forged write (line 52), so it catches the hole.
- `go test ./pkg/host/` passes (17.0 s), and so does `SLOP_TEST_ACTORS_RUNTIME=engine go test ./pkg/host/ -run 'Pinboard|Actor'`.

### What didn't work
- The first full host run failed `TestPinboardApp` (`pinboard_test.go:92`): "this viewer cannot write "apps/greeter"". The SLOP3-016 test asserted the old contract. The commit had already been made, because the pre-commit hook does not run `pkg/host`. I fixed the test and amended the unpushed commit.
- My new test first panicked at `logs["docs"]`: `docs.query` returns a list, not an object.

### What I learned
- `docs.set` (the CLI's and a client's write) applies the app's db rules (`pkg/commands/docs.go:158`), as page writes do. The manifest rule therefore closes every non-actor path.
- Everything under `data/users/<id>/` is private to that user at the platform level (`privateOwner` in `CanRead`/`CanWrite`). For a moment I thought each viewer's trust document was writable by other members; it is not.

### What was tricky to build
- Keeping offline mode working. Offline the page is the board, so local writes and local versions stay. The `PB.rt.db && PB.rt.slop` test separates the two modes.

### What warrants a second pair of eyes
- **Records written before this change** carry a page-written `uid`. An admin could have planted one with someone else's id beforehand. Pinboard is not deployed yet, so only dev data has such records.
- **The display metadata** (title, icon, state, params) still comes from the registering page. It is the registering admin's own code, and none of it is security-relevant; the source and the hash are what the viewer checks.

### What should be done in the future
- A browser check of the editor flow, which now waits for a network call (task "Browser pass").

### Code review instructions
- Read `apps/pinboard/actor.js` (`registerApp`), `apps/pinboard/js/apps.js` (`registerSource`, `trusted`, `sourceHash`) and `apps/pinboard/app.json`.
- `go test ./pkg/host -run 'TestPinboardApp' -v`.

### Technical details
- The level `self` is never met (`meets` in `pkg/rt/rules.go`), so `write: "self"` with no `{self}` rule below it blocks every caller, the owner included.

## Step 5: F7, defaults are read-time

A window's state now falls back to the app's declared defaults when it is read, so no record needs a migration.

### Prompt Context
**User prompt (verbatim):** (see step 1)
**Assistant interpretation:** Design §7.
**Inferred user intent:** Fix the missing-state class, not only old records.
**Commit (code):** `b7d7316`, "Pinboard: window state defaults are read-time (SLOP3-017 F7)".

### What I did
- `render.js` `makeCtx`:
  - `ctx.state[k]` is the stored value when the window has the key, else `def.state[k]`.
  - `has` and `ownKeys` include the defaults; `getOwnPropertyDescriptor` reads through the same `stateGet`.
  - An object default is copied (JSON) once per context and cached.
- New `apps/pinboard/test/render.test.js`. It loads `render.js` in a `vm` context with a stub `window.PB` and no DOM: `makeCtx` touches only `PB` until something renders.

### Why
- The frame's `def` is the evaluated source, so it has the real defaults whatever the record holds. Applying them on read fixes old records, missing fields and defaults added in later versions, all in one place.

### What worked
- 2 tests pass. On the previous `render.js` the defaults test fails.

### What didn't work
- My first assertion compared an array from the `vm` context with `deepStrictEqual`, which failed: values made in another realm have that realm's prototypes. I compare them as JSON now.

### What I learned
- `render.js` can be unit-tested in node without a DOM shim, which is useful for later work.

### What was tricky to build
- Copying object defaults. Without the copy, `c.state.items.push(x)` in a window that never stored `items` would change the app's definition for every window. With a copy per get, `push` followed by `set('items', c.state.items)` would lose the push. One copy per context avoids both.

### What warrants a second pair of eyes
- `m.open` still copies defaults into new windows (readers of stored state: describe, verbs). The stored and read-time values agree unless an app changes a default and an old window never stored that key, which is exactly the case this fixes.

### What should be done in the future
- Nothing.

### Code review instructions
- `git show b7d7316`; `node --test apps/pinboard/test/render.test.js`.

### Technical details
- The cache is per context: `makeCtx` builds a new one per render, and handlers receive the context of the render that drew them.

## Step 6: F6, one step table for the frame protocol

The frame and the page each had their own idea of what a step looked like. Now both read one table, `js/steps.js`.

### Prompt Context
**User prompt (verbatim):** (see step 1)
**Assistant interpretation:** Design §6.
**Inferred user intent:** Make the frame protocol a contract, so this kind of silent no-op cannot come back.
**Commit (code):** `15911c4`, "Pinboard: one step table for the frame protocol (SLOP3-017 F6)".

### What I did
- **New `apps/pinboard/js/steps.js`**, a UMD module (`window.PinboardSteps`, or `module.exports` in node).
  - `OPS` maps 21 steps to argument kinds (`id`, `str`, `obj`, `bool`, `point`, `size`, `ids`, `data`, `patch`, `nullable`; `?` marks an optional argument and `...` takes the rest), with an optional `record` (frame side) and `check` (page side).
  - **`update`:** `record` runs a function patch on a copy of the record. It mimics core's `Object.assign(r, fn(r))` and sends `diff(before, after)` as `{ set, unset }`. `check` builds the page's own function: delete `unset`, then return `set`.
  - **`promote`:** `record` runs the mapping on a copy of the clip and sends `[clipId, coll, data|null, recId]`. `check` returns a function that uses `data`, or `page.fromClip(c)`, under `recId`. `promote` therefore now returns its record id in the frame.
  - **`place`, `open`, `insert`** make fresh ids in the frame. `check` drops an id that is taken or malformed, refuses `kind: app` in `place`, and strips `id`, `kind` and `app` from `setAttr`.
  - **`record`** refuses a function in any position other than `update`'s and `promote`'s third. **`check`** refuses unknown names (`hasOwnProperty`, so `__proto__` is refused too), wrong kinds, missing arguments and extra arguments.
  - **`recorder(read)`** returns `{ m, steps }`. Within one transaction it keeps an overlay of what earlier calls placed, inserted or updated, so `insert` followed by `update` works.
- **`frame.js`**: `PB.mutate` uses `PinboardSteps.recorder` over the frame's copy of the board. The old list of step names and the old recorder are gone.
- **`frames.js`**: `handle` checks each step with `PinboardSteps.check(op, args, { has, fromClip })`. The old `STEPS` table and `freshClip` are gone. The frame document includes `steps.js` before `frame.js`.
- **`index.html`** loads `js/steps.js` before `frames.js`.
- **New `apps/pinboard/test/steps.test.js`**: eight differential cases, the wire form of function patches, `promote` without a mapping, eleven refusals, the stripped fields, and the frame-side refusals.

### Why
- One table, read by both sides, is the contract: a new step either has a shape and a check, or it is refused.

### What worked
- 13 of 13 pass on the first run. Two deliberate breakages in `steps.js` show the test catches bugs:
  - dropping `update`'s deletions fails 1 case;
  - ignoring function patches, the reported bug, fails 3.
- All Pinboard node tests pass (28), and so does `go test ./pkg/host -run Pinboard`.

### What didn't work
- Nothing.

### What I learned
- Comparing the two paths needs equal ids. The test cases give explicit fresh ids, and `record` keeps a valid provided id, so both paths create the same records. `promote` without a mapping is checked on its own, because its record id is random.

### What was tricky to build
- **`update`'s two styles:** a function may return a partial patch or the mutated record. Applying `Object.assign(copy, out || {})` and then diffing against the original covers both, and also a function that deletes and returns nothing.
- **The `nullable` kind:** `promote`'s data argument is required in shape but may be `null`.

### What warrants a second pair of eyes
- **Stricter checks for apps already written:**
  - `tag` now takes strings only; core used to coerce with `String`.
  - `update` with a raw object patch is no longer accepted on the wire; the frame always sends `{ set, unset }`.
  - An app that called `m.update` on a record id the frame does not know now gets "no record" in the frame. The page would have thrown the same error later.
- **The frame's record copy may be one sync behind the page.** A function patch is computed on that copy, which is the race the design accepts.

### What should be done in the future
- A browser check that a framed app's `update(id, r => …)` changes the record (task "Browser pass").

### Code review instructions
- Read `apps/pinboard/js/steps.js` top to bottom; then `git show 15911c4 -- apps/pinboard/js/frame.js apps/pinboard/js/frames.js`.
- `node --test apps/pinboard/test/steps.test.js`.

### Technical details
- Built-in apps run in the page and never use this path.

## Step 7: F4 and F5, identifiers for dispatch

The two CLI findings both came from deriving an identifier from something else: a display name in one case, part of a URL in the other.

### Prompt Context
**User prompt (verbatim):** (see step 1)
**Assistant interpretation:** Design §5.
**Inferred user intent:** `slop pb "<title with spaces>" …` works, and two servers never share cached code.
**Commits (code):** `a1b2efe` (F4) and `71a0a72` (F5).

### What I did
- **F4:**
  - `appverbs.Execute` calls `dispatchWords(use, b)`, which keeps a one-word store name and replaces one that is empty, contains whitespace or starts with `-` with `b.ID`.
  - `TestExecuteStoreNameWithSpaces`: the verb runs (`actor.call clips`), `--help` reads `slop pb s-1 clip ls`, and a one-word name is kept.
- **F5:**
  - `serverKey(server)` lower-cases the scheme and host, drops the query, the fragment and trailing slashes, and returns `<host with : and / as _>-<hex of the first 6 bytes of the sha256>`. `verbsDir` uses it.
  - `cmd/slop/cmds/appverbs_test.go` is the package's first test: five URLs that differ only in scheme, path or port get five keys; equivalent URLs get one key; the name is a readable directory name.

### Why
- **F4:** Cobra's `Name()` is the first word of `Use`, so a display name cannot double as a command name.
- **F5:** the cache holds executable sources, so its key must identify the server as precisely as the trust decision that uses it.

### What worked
- Both tests pass. Making `dispatchWords` a no-op reproduces the Codex symptom: `calls []`, output "Usage: slop pb [command] … Kitchen".

### What didn't work
- Nothing.

### What I learned
- Glazed's help goes to Cobra's writer, while its rows go to `os.Stdout` (step 10 of SLOP3-016). The help assertion can therefore read the buffer.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- After this change, existing caches under `verbs/<host>/` are orphaned on disk. They are harmless and are not cleaned up.

### What should be done in the future
- Nothing.

### Code review instructions
- `git show a1b2efe 71a0a72`.

### Technical details
- `dispatchWords` changes only the last word of `use`: the store word in `["slop", "<alias or on>", "<store>"]`.

## Step 8: F8, watched promises

A turn's outcome used to be decided by one promise, the handler's. Now an event can watch more promises, and any of them rejecting rolls back the turn it rejected in.

### Prompt Context
**User prompt (verbatim):** (see step 1)
**Assistant interpretation:** Design §8, on the merged code from step 2.
**Inferred user intent:** A tool the model is told failed leaves no writes; the platform contract is consistent for synchronous and asynchronous tools.
**Commit (code):** `46207f0`, "Actor: a turn rolls back when a promise its event watches rejects (SLOP3-017 F8)". It was amended for gofmt before the push.

### What I did
- **`pkg/actor/actor.go`:**
  - `event.watches`, plus a `watch{p, done}` type.
  - Helpers: `root()`, `rejectedWatch()`, `takeSettled()` and `dropWatches(err)`.
  - Inside the transaction, after the handler's root check, a rejected watch returns `errWatchRejected`.
  - After `store.Do` the settled watches are taken:
    - on error, rejected watches get their own error and fulfilled ones get the turn's error; when the error is `errWatchRejected`, the turn ends there and the handler is unaffected;
    - on success, `done(result, nil)` runs after `cur.out`.
  - `handle`'s "could not run" path drops the root's watches as lost and calls a `Later` turn's `failed` instead of replying to the parked handler. That was the gap from step 2.
  - The loop's lost-continuation branch drops the root's watches too.
- **`pkg/actor/modules.go`:** `Actor.Watch(p, done)`.
- **`pkg/doors/actors/sample.go`:**
  - `toolRunner` watches every result; a plain value becomes a resolved promise. The `then` callbacks and the state switch are gone.
  - `errorMessage` keeps a thrown error's own code (`permission_denied: …`) and drops the generic `actor_error`. `errorText` is removed.
- **`TestActorSampleTools`**, new mode `late`: the tool awaits `sample`, writes `notes/after`, then throws. Expected: an error for the model, `written` true (the write before the await), `after` false.

### Why
- The rejection has to be seen inside the transaction of the turn it happened in. Only then can that turn roll back.
- Reporting a fulfilment after the commit also fixes a smaller inconsistency: a synchronous tool's success used to be sent before its turn committed.

### What worked
- `go test ./pkg/...` passes (direct), as does `SLOP_TEST_ACTORS_RUNTIME=engine go test ./pkg/host/` (16.9 s) and `go test -race -run 'TestActorSampleTools|TestActorCrashPath' -count=3`.
- With the old `toolRunner`, the new case fails: `after:true text:The browser tool reported an error.`, exactly the finding.
- `golangci-lint run ./...`: 0 issues, after the gofmt fix.

### What didn't work
- The first lint run found `sample.go:285` not gofmt-formatted (a blank line left by removing `errorText`). I ran gofmt and amended the commit.
- This repository has no commit hook. `make lint` and the tests have to be run by hand before pushing, as they were here.

### What I learned
- `store.Do` and `Actor.limited` both return the callback's error as is, so `errors.Is(err, errWatchRejected)` holds.

### What was tricky to build
- **Which turn a rejection belongs to.** A watched promise settles in a continuation turn of the same root event: `io` posts continuations for `ev.parent`, or `ev`. Checking after every turn of that event therefore sees the rejection in the turn that caused it.
- **Settled watches in a turn that rolled back for another reason.** A fulfilled one would report a success whose writes are gone, so it gets the turn's error instead.

### What warrants a second pair of eyes
- A watched promise settled by a different event's turn would be noticed at its own event's next turn, and would roll back that turn. Tools cannot do this today: their continuations belong to the event that called `sample`.
- A watch's `done` for a dropped (lost) runtime runs on another actor's goroutine, after the old loop stopped. `toolRunner`'s callback only sends on a channel.

### What should be done in the future
- Design open question 2 is now answered: a stopped actor reports its watches as "lost".

### Code review instructions
- `git show 46207f0 -- pkg/actor`; then `pkg/doors/actors/sample.go` (`toolRunner`).
- `go test ./pkg/host -run TestActorSampleTools -v`.

### Technical details
```go
if ev.root().rejectedWatch() {
	return errWatchRejected // inside store.Do: this turn rolls back
}
```

## Step 9: Browser pass on a local server running the branch

The unit and host tests cover each fix's logic. This pass checks the parts that only exist in a browser: the frame protocol, the frame's redraw, and the asset cache after a reload.

### Prompt Context
**User prompt (verbatim):** (see step 1)
**Assistant interpretation:** Task "Browser pass": the trust prompt, the Moodboard pop-out after a reload, a framed `update(id, fn)`, and counter defaults on an old record.
**Inferred user intent:** Evidence that the fixes work in the real page and frames, not only in tests.
**Commit (code):** none (verification only).

### What I did
- **Setup:**
  - Built `pbslop` from `46207f0` and restarted the local server (`serve --local --llm fake`, background task `bxhifj0wq`).
  - Pushed `apps/pinboard` with `lslop push apps/pinboard --store pinboard`: snapshot 16, `files: 22`. The Kitchen board (`s-5povfcfc`) runs n=16 on `main`.
  - In Playwright as Ada (the board's admin), working in the Pinboard frame (`*.sbx.localhost/v/16/`).
- **Registration (F1):** `await PB.apps.registerSource(tally)` took 23 ms. The record arrived with `uid` = Ada's id, `sha256` = `PinboardCore.sha256(src)`, `version` 1 and `state {n:0}`. The log's newest entry is "Ada Admin (page) · register tally v1".
- **Direct write (F1):** `PB.rt.db.doc('apps/forged').set(…)` was refused with `invalid_argument this viewer cannot write "apps/forged"`.
- **Trust hash (F1):**
  - `PB.trust.set('zz-trust', sha(srcA))`;
  - `trusted({source: srcB, sha256: sha(srcA), uid: other})` is false;
  - `trusted({source: srcA, sha256: 'not-the-hash', uid: other})` is true.
- **Framed functional update (F6):** opened `tally`, framed with origin `null`, and clicked inside its frame:
  - **seed** inserted `rec:push85bky8` with `{title: 'Soup', minutes: 20, old: 'x'}`;
  - **fix** ran `update(rid, r => { r.name = r.title; delete r.title; delete r.old; r.minutes += 5; return r; })`, giving `{minutes: 25, name: 'Soup'}` with `title` and `old` gone, the same in the page's `PB.S.records`;
  - **bump** gave `n=1`.
- **Old record (F7):**
  - Registered `oldcount` through `registerApp` without `state` (record `state {}`), then opened it (window `state {}`).
  - The frame showed `n=0` from the declared default. Clicks stored `{n: 1}`, then `{n: 2}`, and the frame showed `n=2`.
- **Asset after a reload (F2):**
  - Made a 40×30 PNG with `PB.putBlob` (`blob:aca9…`) and reloaded; `PB.blobs` was empty.
  - `PB.boardAPI.clip(PB.ui.image(ref))` stored `blobId` = the reference and `url: null`. The `<img>` loaded `/_blob/aca9…` at 40×30.
- **Screenshot:** `various/01-browser-pass-framed-apps-and-image.png` shows Tally (n=1, the renamed record), Old counter (n=2) and the popped-out image.
- Closed the browser.

### Why
- The frame protocol runs only across a real `MessageChannel` and a sandboxed `srcdoc` frame, and the reload behaviour of `PB.blobs` only shows in a page.

### What worked
- Every check above, on the first attempt, except the redraw below.

### What didn't work
- **The redraw scare:**
  - After the first click, Old counter's frame still showed `n=0` although its state was `{n: 1}`. `makeCtx` in the frame returned `n: 2` after the second click, so the state and the context were right.
  - There was one frame and it was attached, which ruled out a stale frame.
  - The window was at x 600 in a 714 px wide page, mostly off screen. Chromium throttles `requestAnimationFrame` in off-screen cross-origin frames, and the frame redraws on rAF. After moving the window to x 80, it showed `n=2`.
- **The screenshot path:** Playwright refuses paths outside the main checkout and `.playwright-mcp`, so I saved the screenshot there and moved it into the ticket.

### What I learned
- An app frame that is off screen does not redraw until it is visible. For a board that is harmless, but a browser check of a framed app must keep its window in view.

### What was tricky to build
- Telling F7's behaviour (the default read) apart from the rAF throttling. Comparing the frame's `makeCtx(c).state.n` with its DOM separated the two.

### What warrants a second pair of eyes
- The log labels a page registration "Ada Admin (page)", because `registerApp` goes through `commit(ctx, args)` with `via: 'page'`. Other page edits are labelled with the bare name. This is cosmetic.

### What should be done in the future
- A Bob-side check of the trust prompt in a second browser context. Phase 6b covered it with the old flow; the hash logic is checked above.

### Code review instructions
- The screenshot; this step's numbers.

### Technical details
- The test apps `tally`, `oldcount` and the trust key `zz-trust` remain on the local Kitchen board (local data only).

## Step 10: One PR (#39); #36, #37 and #38 closed; a new Codex review

The four SLOP3-016 PRs are now one, with the review fixes on top, and Codex has been asked to review the whole of it.

### Prompt Context
**User prompt (verbatim):** (see step 1), and during the work: "once everything is consolidated in a PR, restart a code review, btw"
**Assistant interpretation:** Retarget #39 to `main` with a description of everything in it, close the others pointing to it, and comment `@codex review`.
**Inferred user intent:** Review the merged whole once, with fresh eyes.
**Commit (code):** none. #39's head is `46207f0`.

### What I did
- `git merge-tree --write-tree origin/main origin/task/slop3-016-phase6` merges cleanly: 42 commits, 77 files, +10,015/−94.
- `gh api -X PATCH …/pulls/39 -f base=main -f title=… -F body=@pr-consolidated-body.md`. The new title is "Pinboard on slop, actor VM on go-go-goja, and the review fixes (SLOP3-016, SLOP3-017)". The body has the parts, the F1–F8 table with commits, the before-merging list (go-go-goja tag, binary size, engine default), the tests and a review guide.
- `gh pr close 36|37|38 --comment "Folded into #39 …"`.
- Commented `@codex review` on #39 at 00:18:14Z and started a background wait (`bbav2cfcc`) for its result and CI.

### Why
- Merging, not rebasing, keeps the commits that the earlier reviews saw, so their threads still point at real commits.

### What worked
- #39 is the only SLOP3-016 PR open; #35 (SLOP3-015) is unrelated.

### What didn't work
- `gh pr edit` still fails (Projects classic deprecation), so I used `gh api -X PATCH` as before.

### What I learned
- Nothing new.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- The PR description's claim that every regression test fails on the code before its fix. Each case is recorded in steps 3–8.

### What should be done in the future
- Assess Codex's review of #39 (step 11).

### Code review instructions
- https://github.com/go-go-golems/slop-computer/pull/39

### Technical details
- The body is in the session scratchpad (`pr-consolidated-body.md`).

## Step 11: Codex on the consolidated #39: two findings, both fixed

Codex's first review of the whole of #39 found two problems. Both were in the frame code: one from phase 6b, and one that F6 created.

### Prompt Context
**User prompt (verbatim):** "once everything is consolidated in a PR, restart a code review, btw"
**Assistant interpretation:** Assess Codex's review of #39, fix what is real, and ask for another review.
**Inferred user intent:** Converge on a PR the reviewer has nothing left to say about.
**Commits (code):** `b31910f` (P1) and `8288aa7` (P2).

### What I did
- **The review:** Codex reviewed #39 at `46207f0`. CI `release / publish` passed.
  - **P1, `frames.js:35`:** the frame snapshot sent `PB.S.meta`, into which `store.js:167` merges the viewer's `data/users/<id>/view` document: agent threads (messages, code, results), view and panel settings. Any board app could read them from `window.PB.S.meta.threads` and publish them.
  - **P2, `frame.js:59`:** each `c.db` call is its own `mutate`, and the frame's copy changed only on the page's sync. Two consecutive functional increments therefore both sent `n: 1`, and `insert` followed by an `update` of its id threw "no record". F6 introduced this: function patches read the frame's copy.
- **P1 fix:** `store.js` exports `PB.sharedMeta` (`SHARED_META`: title, seeded, about), and `snapshot()` uses it. New test `test/frames.test.js` loads `frames.js` in a `vm` context with stubs and asserts the snapshot has no thread text and no app sources. `snapshot` is now exported on `PB.frames`.
- **P2 fix:**
  - `steps.js`:
    - `applyLocal(step, read, put)` covers placed and removed clips, and inserted, updated, promoted and removed records.
    - `recorder` uses it for its per-transaction overlay.
    - `optimistic(S)` keeps pending batches (`seq`), applies each at once, re-applies the ones not yet acknowledged over each adopted copy, and drops those with `seq <= ack`.
  - `frame.js` sends `{t: 'mutate', seq, ops}`, adopts syncs through `board.adopt(m.S, m.ack)`, and redraws right after a mutate.
  - `frames.js` sets `f.ack` at the start of handling a batch and calls `sync()` in a `finally`, so a refused batch is acknowledged too. Syncs carry `ack`.
  - Two new tests in `steps.test.js`:
    - consecutive increments; insert then update across calls; a stale copy (ack 0) keeps the writes on top; the page, applying the batches in order, ends equal to the frame; acks drop the pending batches;
    - a refused batch disappears once acknowledged.
- **Checks:**
  - `node --test apps/pinboard/test/*.test.js`: 31 pass. The frames test fails when `meta: PB.S.meta` is put back.
  - Browser, on the local server at snapshot 17 (`lslop push`):
    - the page's meta keys were `seeded, title, agentMode, agentTier, minimap, threads, view`, and the frame's were `title, seeded`; "threads" appears nowhere in the frame's `PB.S`;
    - the `twice` app (insert, then two `update(id, r => ({n: r.n + 1}))`) showed `n=2` in the frame, and the page's record has `n: 2`.
  - `go test ./pkg/host -run Pinboard` passes. `golangci-lint`: 0 issues.
- Pushed. I replied on both threads and commented `@codex review` again at 00:25:03Z (background wait `bhdp9ebfw`).

### Why
- **P1:** the frame's purpose (design §6, phase 6b) is that an app sees the board and nothing of the person. The viewer's view document is the person's.
- **P2:** an acknowledgement is the only correct way to drop optimistic writes. Replacing the copy on every sync would lose writes that a sync already in flight does not contain.

### What worked
- Every check above.

### What didn't work
- The P1 commit picked up all of `frames.js` with `git add`, including the `ack` half of P2. At `b31910f` alone, the page sends an `ack` the frame ignores, which is harmless, and both commits were pushed together.

### What I learned
- `PB.S.meta` is a merged object, shared board keys plus the viewer's own. Anything that sends board state out of the page has to pick the shared part (`PB.sharedMeta`), as `saveMeta` already does when it writes.

### What was tricky to build
- **The ordering of ack and snapshot.** The page computes the snapshot and reads `f.ack` in the same `requestAnimationFrame` callback, after handling the batch. The copy therefore always contains exactly the batches it acknowledges.

### What warrants a second pair of eyes
- `applyLocal` covers only what later steps read: clips placed or removed, and records. Other changes, such as a move or `setAttr`, still show in the frame only after the sync, as before.
- Window state has its own optimistic path (`PB.setState` in the frame). It is not acknowledged, so a stale sync can briefly show an old state. That is pre-existing and was not reported.

### What should be done in the future
- Assess Codex's second review (step 12).

### Code review instructions
- `git show b31910f 8288aa7`.
- `node --test apps/pinboard/test/steps.test.js apps/pinboard/test/frames.test.js`.

### Technical details
- The test apps `twice` and `counts` remain on the local Kitchen board.

## Step 12: Codex's second review of #39: two more findings, both fixed

The second review, of the head with the step 11 fixes, found two older gaps: one on the Boards page from phase 4 and one in the frames from phase 6b.

### Prompt Context
**User prompt (verbatim):** (see step 10)
**Assistant interpretation:** Assess the second review, fix, and ask again.
**Inferred user intent:** As in step 11.
**Commits (code):** `4952b17` (Boards page) and `4572aee` (drops into frames).

### What I did
- **The review:** completed at `8288aa7` with two P2 findings. CI passed.
  - **`apps/pinboard-home/index.html:58`:** after building a guest's sign-in prompt, the code fell through to `stores.list()` and `render()`, which replaced the prompt with empty sections.
  - **`frames.js:107`:** a board drag could not reach a `ui.dropzone` inside an app's frame. `hitTarget` uses the page's `elementsFromPoint`, and the frame protocol had no drop message.
- **Boards page:** `return` after the guest prompt.
- **Drops into frames:**
  - `style.css`: `.dragging .appframe iframe { pointer-events: none }` and `.appframe.droptarget` (outline).
  - `board.js`: `hitTarget` returns `{type: 'frame', el: .appframe, frame: iframe}`; `setTarget` outlines it; both drop paths (clips and items) call `PB.frames.drop`.
  - `frames.js`: `drop(iframe, item, clientX, clientY)` scales the point by `offsetWidth / rect.width`, posts `{t: 'drop', x, y, item}`, and retries without the image if cloning fails. `'dropped'` toasts the answer.
  - `frame.js`: on `drop`, `elementFromPoint(x, y).closest('.dz')` and `PB.dropzones.get(dz).fire(item)`, then answers `{t: 'dropped', ok}`.
- **Browser checks:** local server, Pinboard n=18 and the Boards page n=2.
  - **Real mouse events:** dragging a note's title bar onto a framed `catcher` app outlined the window during the drag. The app's state became `got: "clip:note clip:iwglk9o2oc"`, the note stayed at (560, 60), and the page showed "dropped into catcher".
  - **At zoom 0.6:** aimed at the small text inside the dropzone, the drop still arrived (`clip:kvp9gj8vz2`), so the scaling is right.
  - **The Boards page in a fresh, signed-out browser context:** the prompt and its Sign in button stay, and New board is hidden.
- **Other checks:** `node --test`: 31 pass. `go test ./pkg/host -run Pinboard`: ok. Lint: 0 issues.
- Pushed, replied on both threads, and commented `@codex review` at 00:32:46Z (background wait `bwjnhougr`, which this time waits for "completed" on the new head).

### Why
- **Pointer events:** without `pointer-events: none` on the iframes, the page loses `pointermove` and `pointerup` the moment the pointer enters a frame (the board does not capture the pointer). The drop would never end in the page.
- **The point:** it is converted with the iframe's own `offsetWidth`, which a transform does not change, against its rendered rectangle. That holds at any zoom.

### What worked
- Every check above.

### What didn't work
- **Playwright and the opaque frame:** `boundingBox()` returned null for a locator inside the opaque-origin app frame. I computed the page coordinates from the board frame's box, the iframe's rectangle and the element's rectangle in the frame.
- **The first wait loop** stopped as soon as a review was posted while its status still read "running". The review turned out to be complete with those two findings; the new loop waits for "completed" on the head commit.

### What I learned
- Each review of the whole diff surfaces different older gaps: phase 4's Boards page and phase 6b's drops were in #36 and #39 all along.

### What was tricky to build
- **Hit testing with `pointer-events: none`.** With the iframes ignoring the pointer, `elementsFromPoint` returns the `.appframe` wrapper, not the iframe, so `hitTarget` matches the wrapper.

### What warrants a second pair of eyes
- **Over a framed window, any drop goes to the frame.** Where the frame has no dropzone at that point, the page shows "<app> takes nothing dropped there" and the clip goes back. Before, dropping a clip on a window moved it on the board under the window.
- **Hover feedback inside the frame:** the dropzone's own highlight while hovering is not bridged; the whole window is outlined instead.

### What should be done in the future
- Assess the third review (step 13).

### Code review instructions
- `git show 4952b17 4572aee`.

### Technical details
- The test apps `catcher` and the notes "drag me" and "zoomed drag" remain on the local Kitchen board.

## Step 13: Codex's third review of #39: collection steps and page-side syncs

The third review found two more frame gaps: one that step 11 left open, and one from phase 6b.

### Prompt Context
**User prompt (verbatim):** (see step 10)
**Assistant interpretation:** As step 12.
**Inferred user intent:** As step 11.
**Commits (code):** `6db52e7` (collections) and `3ddb939` (sync on mutation).

### What I did
- **The review:** completed at `4572aee` with two P2 findings. CI passed.
  - **`steps.js:195`:** `applyLocal` ignored `collection` steps. The schema builder (`dsl.js` `schemaBuilder`) reads `PB.S.collections[name]` back after each commit, so in a frame a new collection threw, and `.field().field()` lost the first field.
  - **`frames.js:96`:** the page's `PB.mutate` emits `mutation`, and frames synced only on `change` and `selection`.
- **Collections fix:** `applyLocal` handles `collection` (core's defaults `{name, fields: [], indexes: [], store: 'db', version: 1}`, with the patch merged over the existing collection) and makes the collection on a first `insert`, as core's `m.insert` does, with every data key as a text field, `id` included.
- **Sync fix:** `PB.on('mutation', sync)` in `frames.js`.
- **Tests:**
  - A differential case, "schema builder in one transaction".
  - An optimistic test: fields accumulate across calls, and after the page applies everything and a stale copy is adopted, the frame's collections equal the page's, and so do its records apart from `added`.
  - `frames.test.js` records `PB.on` subscriptions and checks `change`, `mutation` and `selection`.
  - 34 pass. On the previous `steps.js` and `frames.js`, the two new tests fail.
- **Browser** (Pinboard n=19): a framed `schema` app's `c.db.collection('tasks2').field('title').field('done', 'bool')` gave the page `title:text, done:bool`. An update made in the page (`n: 41`) showed in the open frame within 600 ms.
- Lint: 0 issues. Pushed, replied on both threads, and commented `@codex review` at 00:39:11Z (background wait `be49asimg`).

### Why
- **Collections:** the optimistic copy must cover everything an app reads back from its own changes, and the schema builder is such a reader.
- **Sync on mutation:** the page's own writes produce no `change` event, because their echo matches local state. Without it, nothing told the frames.

### What worked
- Every check above.

### What didn't work
- My first comparison of records failed on `added`: the page's timestamp, which the frame cannot know. The next sync brings it, so the test compares records without it.

### What I learned
- The page has two event streams, `change` (remote or quiet) and `mutation` (its own transactions). Anything that mirrors the page has to follow both.

### What was tricky to build
- Matching core's collection made by a first insert exactly, `id` field included, so that the frame's copy and the page's agree.

### What warrants a second pair of eyes
- `applyLocal` still does not cover clip edits (`move`, `setAttr`, `setParam`) and `group`. Nothing reads those back synchronously today, and the page's sync corrects the display.

### What should be done in the future
- Assess the fourth review.

### Code review instructions
- `git show 6db52e7 3ddb939`.

### Technical details
- The test apps `schema`, `tasks2` and `counts2` remain on the local Kitchen board.
