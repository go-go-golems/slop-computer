---
Title: 'Design: addressing the Codex review findings on the SLOP3-016 PRs'
Ticket: SLOP3-017
Status: active
Topics:
    - pinboard
    - security
    - actor
    - cli
    - review
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "How the eight Codex findings on the SLOP3-016 PRs are fixed, by root cause: the actor writes app records, the frame protocol has one step table, defaults are read-time, a turn rolls back when a watched promise rejects, and CLI dispatch uses identifiers"
LastUpdated: 2026-11-07T18:44:25.577278003-05:00
WhatFor: "Reviewing and implementing the SLOP3-017 fixes"
WhenToUse: "Before changing Pinboard app registration, the frame protocol, window state defaults, actor tool turns, or the CLI app-verb command tree"
---

# Design: addressing the Codex review findings on the SLOP3-016 PRs

## 1. Executive summary

Codex reviewed the SLOP3-016 PRs and left eight findings that are still open: three on #36, two on #37, three on #39, and none on #38. All eight are real. Two were reproduced with throwaway tests and the other six were confirmed by reading the code. One is P1: board admins can bypass the consent prompt for apps. The other seven are P2.

Most of them are instances of four root causes. This design fixes each cause where it lives, not just the reported line:

| Root cause | Findings it explains | Fix |
|---|---|---|
| A security decision reads data the other side can write | the trust bypass (P1); the verb cache shared between servers | Only the actor writes app records, so `uid` and `sha256` become facts it vouches for, and the page hashes the source it runs. The CLI cache is keyed by the full server URL. |
| A boundary without one contract | functions crossing the frame become `null`; a board title becomes a command name; log size is measured in UTF-16 units; images are classified by a cache | One step table shared by the frame and the page, with a differential test. Identifiers for dispatch, labels for display. One byte-length helper. One asset classifier. |
| Defaults copied into data when a window opens | old app records without `state` | Defaults are applied when the state is read, never stored |
| One promise decides a turn's outcome | an async tool that fails keeps its writes | A turn also rolls back when any promise its event watches rejects in it |

The same work consolidates the SLOP3-016 PRs into one. The fixes go on top of #39's branch, #38 is merged in, and #39 becomes the single PR against `main`. #36, #37 and #38 are closed and point to it.

## 2. The findings

| # | PR | Priority | Where | Finding | Practical weight |
|---|---|---|---|---|---|
| F1 | #36 | **P1** | `apps/pinboard/js/apps.js` `trusted()` | Trust reads the writable `sha256` and `uid` fields of an app record. A board admin can keep an approved hash while changing the source, or set `uid` to the viewer's id. | Security: another admin's code runs as the viewer without consent |
| F2 | #36 | P2 | `apps/pinboard/js/board.js` (`ui.image` on the board, drops) | `blob:<id>` is treated as an asset only when its bytes happen to be cached. | Must fix: the built-in Moodboard's "pop out" makes broken images after every reload |
| F3 | #36 | P2 | `apps/pinboard/core.js` `logEntry` | The size check uses `JSON.stringify(e).length`, UTF-16 units, against a byte limit. | Negligible: only near-limit non-ASCII documents |
| F4 | #37 | P2 | `pkg/appverbs/appverbs.go` `Execute` | The board's title is a Cobra `Use` word; Cobra names a command after the first word only. | Must fix: `slop pb 'Kitchen Board' clip ls` prints help and exits 0 |
| F5 | #37 | P2 | `cmd/slop/cmds/appverbs.go` `verbsDir` | The verb cache directory is keyed by host only, so the scheme and base path are lost. | Negligible: needs one host with two servers, plus the same store id and snapshot |
| F6 | #39 | P2 | `apps/pinboard/js/frame.js` recorder | `update(coll, id, fn)` is serialized with its function, which arrives as `null`; `promote`'s function is dropped. | Must fix: a documented API silently does nothing in framed apps |
| F7 | #39 | P2 | `apps/pinboard/js/apps.js` `framedDef` | App records saved before #39 have no `state`, so a new window starts empty. | Negligible if the stack ships together |
| F8 | #39 | P2 | `pkg/doors/actors/sample.go` `toolRunner` | An async tool that writes after an `await` and then throws keeps those writes. | Negligible for Pinboard today; a gap in the platform contract |

## 3. F1: the actor writes app records

### Current state

`A.trusted(a)` returns true for a built-in, for `a.uid === PB.myId()`, or for `PB.trust.has(a.name, a.sha256 || sha256(a.source))`. The record is written by the page: `registerSource` writes `apps/<name>` through `PB.mutate(m => m.register(rec))` and `apps/<name>/versions/<n>` through `PB.saveVersion`. Pinboard's manifest gives admins write access to `apps` (`{ "path": "apps", "read": "view", "write": "admin" }`). Any admin can therefore write any field.

### Design

1. **No direct writes under `apps`.** The rule becomes `{ "path": "apps", "read": "view", "write": "self" }`. `self` is a level nobody holds (`pkg/rt/rules.go`): with no `{self}` rule below it, no page or client can write there. The actor writes its own store through `store.Turn.SetDoc`, which the page rules do not apply to.
2. **Registration is an actor action.** `registerApp` (requires `admin`) takes the source and the display metadata the page read from it: name, title, icon, about, shortcut, hidden, order, w, h, state and params. The actor:
   - checks the name, the source size and the metadata types;
   - computes `sha256` from the source with `core.sha256`;
   - stamps `by` from `who(ctx)` and `uid` from `ctx.visitor.id`;
   - picks the next version;
   - writes `apps/<name>` through `commit()`, so the board log records it, and writes `apps/<name>/versions/<n>`.
   `unregisterApp` (requires `admin`) closes the app's windows and removes the record the same way.
3. **The page hashes what it runs.** `trusted()` and `trust()` use `sha256(a.source)`, memoized per source string, and never read `a.sha256`. The own-app exemption keeps `a.uid === PB.myId()`. That is now sound, because only the actor writes `uid`.
4. **The page asks; it does not write.** When online, `registerSource` evaluates the source locally as before (it is the registering admin's own code) and then awaits `PB.rt.slop.call('registerApp', …)`. `unregister` calls `unregisterApp`. Offline (no runtime) the page still writes locally. Callers (the editor, the agent and first-load seeding) await the result.
5. **The log cannot revert app changes.** Reverting a log entry that touches `apps` would be a direct write, so the page refuses it with a message: an app goes back by registering an earlier version, whose source the version history keeps.

### Why this design

Every way around the prompt depended on the page trusting fields of a document someone else wrote. With this change, `uid` and `sha256` are written by the one party that can authenticate the caller, and the hash is checked against the bytes that will actually run.

### Alternatives considered

- **Hash from source only, without the actor.** This closes the hash bypass, but the `uid` exemption stays forgeable. Dropping the exemption would prompt authors for their own apps.
- **Expose each document's server-stamped writer to the page.** The store keeps `by` (`store.Doc.By`). The page could trust `writer === me` instead of `uid`, which is the cleanest general primitive. It is a platform protocol change, though: the db stream wire format, the runtime's `DocSnap`, a `claude.js` rebuild and the conformance suite. It is worth doing separately, and recorded under open questions.

## 4. F2, F3: one definition per question

- **F2.** `PB.isAssetRef(src)` (`/^blob:[^\s/:]+$/`) is the only test for whether a reference is an asset. `PB.blobs` is a cache of bytes and is never used to classify. This covers `ui.image` placed on the board (`board.js` `clip()`) and a drop of an item that carries `src`.
- **F3.** `core.js` gets `byteLength(str)`, the UTF-8 length computed in plain JavaScript because `core.js` also runs in the actor. `logEntry` compares the serialized entry's byte length against a byte budget below the 256 KiB document limit.

## 5. F4, F5: identifiers for dispatch, labels for display

- **F4.** `appverbs.Execute` builds the command tree with words that cannot contain spaces. The store word is what the person typed when that is one word; otherwise it is the store id. `SetArgs` uses the same token. Help therefore always shows a command that runs, for example `slop pb s-3f… clip add`, and the title stays in the short description ("pinboard's verbs on "Kitchen Board"").
- **F5.** `verbsDir(server)` is `…/slop/verbs/<host>-<sha256(normalized URL)[:12]>`. The normalized URL is the scheme, host and path without a trailing slash. The host prefix keeps the directory readable. `knownAliases` still globs `verbs/*/aliases.json`. Old directories are simply not found again, which is fine for a cache.

## 6. F6: one step table for the frame protocol

### Current state

`frame.js` has its own list of step names and a `Proxy` recorder that pushes `{op, args}` as they are. `frames.js` has a separate `STEPS` table of checks, where most entries pass their arguments through. Function arguments become `null` in `JSON.stringify` and in structured clone. `core.update` then merges `null`, a no-op, and `promote`'s mapping function is dropped.

### Design

A new file, `apps/pinboard/js/steps.js`, defines `PinboardSteps`, which `index.html` and the frame document both load:

- `record(op, args, read)`, used in the frame, returns data-only arguments. A function argument is resolved there, against the frame's copy of the board (`read`):
  - **update with a function:** the function runs on a clone of the record. The result is sent as `{ set, unset }`: the fields the result has, and the fields it deleted.
  - **promote with a function:** the function runs on a clone of the clip, and its data is sent.
- `check(op, args, S)`, used in the page, validates shapes and rebuilds what core expects:
  - a malformed step is refused, not passed through;
  - `{ set, unset }` becomes a page-made function patch that deletes `unset` and assigns `set`;
  - fresh ids keep their current rules.
- `OPS` is the single list of step names, used by both the recorder and the page.

**Differential test** (`apps/pinboard/test/steps.test.js`, `node --test`): every operation is applied twice to equal boards, once directly through `core` and once as `record` → JSON → `check` → `core`. The resulting boards must be equal. Function forms (`update` with a deletion, `promote` with a mapping) are part of the cases.

### Alternatives considered

- **Patch only `update` in the frame.** That fixes the report but not the class: the next function-taking step would break silently in the same way.
- **Send functions as source text.** That would mean evaluating app code in the page, which is exactly what frames exist to prevent.

## 7. F7: defaults are read-time

`PB.makeCtx` (in `render.js`, shared by the page and the frame) reads `ctx.state[k]` from the clip's state. When the clip has no such key, it falls back to `def.state[k]`. `has` and `ownKeys` include the defaults. Writes still store only explicit keys. The frame's `def` is the evaluated source, so its defaults are the real ones whatever the record holds. `m.open` keeps copying `def.state` into new windows, because other readers (`describe`, verbs) look at stored state.

The effect is that an old record, a missing field, or a default added in a later version of the app all read correctly, with no migration.

## 8. F8: a turn rolls back when a watched promise rejects

### Current state

`handle` rolls a turn back when `ev.run` fails, or when the root promise (the handler's own, or the parked one) is rejected. A tool started through `Actor.Later` that awaits I/O runs its later segments in continuation turns of the same event. Its rejection is seen by a `then` callback that reports the error, while the turn commits.

### Design

- **New API: `Actor.Watch(p *goja.Promise, done func(goja.Value, error))`.** It is called inside a turn and records `p` on the event's root, `ev.parent` or `ev` itself.
- **After every turn of that event, inside the transaction, `handle` checks the watched promises:**
  - **rejected:** the turn returns that rejection as its error and rolls back. After the rollback, `done(nil, err)` reports it, and the handler stays parked, as for a failed `Later` turn.
  - **fulfilled:** `done(value, nil)` runs after the commit, so a tool's success is reported only once its writes are durable.
  - **pending:** kept for the next turn.
- **`toolRunner` watches every promise a tool returns.** That replaces the `then` callbacks and the settled/pending switch. The synchronous outcomes (a return or a throw) keep the `Later` paths.

This also lands on the code where #38 and #39 conflict: `handle` after #38's host routing. It is implemented after the merge, on the reconciled code.

## 9. Consolidating the PRs

1. Merge `task/slop3-016-actor-host` (#38) into `task/slop3-016-phase6` (#39). Resolve `pkg/actor/actor.go` by keeping #38's host routing with #39's `ev.failed` branches inside it. Run the actor and host suites in both runtime modes.
2. Put the SLOP3-017 commits on the same branch.
3. Retarget #39 to `main` and rewrite its title and body to cover SLOP3-016 phases 0–6, actor VM phases 1–4 and SLOP3-017. Close #36, #37 and #38 with a comment pointing to #39. Their review threads remain readable there.

The go-go-goja replace stays until go-go-golems/go-go-goja#107 is merged and tagged.

## 10. Implementation plan

| Step | Work | Validation |
|---|---|---|
| 0 | Merge #38 into #39's branch | `go test ./pkg/...` both modes |
| 1 | F1: rule, `registerApp`/`unregisterApp`, page calls, hash from source, revert refusal | host test: a direct page write under `apps/` is refused; registration stamps `uid`/`sha256`; node tests |
| 2 | F2, F3 | node test for `byteLength` and a trimmed CJK entry |
| 3 | F7 | node or browser check: an old record's window reads its defaults |
| 4 | F6: `steps.js`, recorder and checks, differential test | `node --test apps/pinboard/test/*.test.js` |
| 5 | F4, F5 | Go tests: a title with a space dispatches; cache directories differ by scheme and path |
| 6 | F8: `Actor.Watch`, `toolRunner` | `TestActorSampleTools` with an async tool that writes and then throws |
| 7 | Browser pass: trust prompt, Moodboard pop-out after a reload, a framed `update(id, fn)`, a counter with an old record | screenshots in the ticket |
| 8 | PR consolidation | CI green on #39 |

## 11. Open questions

- **Document writers for pages.** Should pages get each document's server-stamped writer (`metadata.writer`)? It would make actor-mediated writes unnecessary for authorship checks in other apps. It is a separate platform ticket.
- **Watched promises of a stopped actor.** Their callbacks never run; `toolRunner`'s timeout covers that today. Should `Watch` report "lost" the way stopped `Later` turns do?

## 12. References

- Codex review threads on go-go-golems/slop-computer #36, #37 and #39. go-go-golems/go-go-goja#107 holds the go-go-goja half, already addressed (GOJA-069 step 6).
- SLOP3-016 diary, steps 10–14. The actor VM diary, steps 5–6.
- `pkg/rt/rules.go` (levels, `self`), `pkg/actor/actor.go` (`handle`), `pkg/actor/modules.go` (`Later`), `pkg/doors/actors/sample.go` (`toolRunner`), `apps/pinboard/js/{apps,frame,frames,render,board}.js`, `apps/pinboard/core.js`.
