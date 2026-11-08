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
