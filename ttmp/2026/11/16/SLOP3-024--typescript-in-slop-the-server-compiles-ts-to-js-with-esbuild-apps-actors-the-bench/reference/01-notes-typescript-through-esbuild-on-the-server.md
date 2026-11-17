---
Title: 'Notes: TypeScript through esbuild on the server'
Ticket: SLOP3-024
Status: active
Topics:
    - architecture
    - goja
    - apps
    - frontend
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/16/SLOP3-024--typescript-in-slop-the-server-compiles-ts-to-js-with-esbuild-apps-actors-the-bench/scripts/01-ts-check-latency.cjs
      Note: measures cold and warm TypeScript checks of a small app (notes §8)
ExternalSources: []
Summary: 'Parked idea: everyone writes TypeScript (people, the agent, the bench) and the slop server compiles it to JavaScript with esbuild''s Go API when it serves pages and loads actors. What runs JS today, where esbuild would plug in, what is known, what the full design must settle.'
LastUpdated: 2026-11-16T15:09:17.665766763-05:00
WhatFor: Taking up TypeScript support later without redoing the first investigation.
WhenToUse: Before writing the full SLOP3-024 design, or when deciding how the bench source becomes TypeScript.
---

# Notes: TypeScript through esbuild on the server

These are notes, not a design. They record an idea raised while the bench was being restructured (SLOP3-023), what is already known about it, and what a design has to settle. The full design is to be written later (see `tasks.md`).

## 1. The idea in one paragraph

Everyone who writes code for slop writes TypeScript: the person, the agent, and the bench's own source. The slop server turns it into JavaScript at the moment it is needed. A page's `.ts` file is compiled when it is served; an actor's `actor.ts` is compiled before goja runs it. The compiler is esbuild, which is written in Go and has a Go API (`github.com/evanw/esbuild/pkg/api`), so it runs inside the slop process with no Node and no build step. Snapshots never change, so each file is compiled once per content hash and cached.

## 2. How it came up

On 2026-11-16, during the SLOP3-023 refactor, the person asked whether the bench could be TypeScript, then whether the server itself could use esbuild "to serve js while we actually always deal with ts". The decision for now: leave TypeScript aside, finish SLOP3-023 in JavaScript, and keep this ticket to remember the idea. Nothing here is implemented.

The motivation is concrete. During the same session, `tsc` would have caught two of the bugs found by hand:

- `!(P.proposals.get(what) || {}).status === 'open'`, which is always false (a boolean compared with a string);
- `cur.layout` where the value was `cur.doc.layout` (a property that does not exist).

The import checker (`web/bench/tools/imports.mjs`) caught a third class, names used without being imported, which `tsc` also reports.

## 3. What runs JavaScript today

| Code | Written by | Where it runs | How it gets there |
|---|---|---|---|
| An app's pages (`*.html`, `*.js`) | the person, the agent | the browser | served as stored: `pkg/doors/pages/storebytes.go`, `writeStoreBytes` sets `Content-Type` from the stored file's type |
| An app's actor (`actor.js`, required files) | the person, the agent | goja, on the server | `pkg/actor/actor.go`: `(*Actor).load` runs `vm.RunScript(entry, src)`; `requirer` wraps each required file as CommonJS and runs it; `.json` files go through `RunString` |
| The server's eval verb | callers of `pkg/commands/eval.go` | goja | `vm.RunScript("eval.js", "(function(){" + source + "\n})()")` |
| The bench page (`web/bench/src`) | us | the browser | `web/bench/build.mjs` (esbuild 0.25.12 from npm) builds `apps/bench/app.js` |
| The sandbox core (`web/bench/src/worker/core.js`) | us | QuickJS inside a Web Worker | inlined as source text (`__CORE_SRC__`) into `apps/bench/sandbox.js`, then evaluated by QuickJS |
| The probe (`web/bench/src/frames/probe.js`) | us | inside every dev frame | its source text is spliced into `pkg/doors/pages/assets/probe.js` by `build.mjs` |
| The bench actor (`apps/bench/actor.js`) | us | goja | pushed as written |
| The agent's evals | the model | QuickJS in the bench's worker | sent as text per eval; saved helpers live in `.agent/lib/<name>.js` |

Two facts matter for the design:

- **Every engine runs JavaScript only.** goja and QuickJS have no TypeScript support, and neither do browsers.
- **The server already publishes TypeScript declarations for the actor modules.** In `pkg/actor/catalog.go`, each Go module an actor can `use()` or `require()` carries a `TypeScript string` field. An actor written in TS could be type-checked against the real module APIs.

## 4. Where esbuild would plug in

**Single files: `api.Transform`.** It takes one file's text and returns JavaScript:

```go
r := api.Transform(src, api.TransformOptions{
    Loader:     api.LoaderTS,          // or api.LoaderTSX
    Sourcefile: path,                  // names the file in errors and source maps
    Target:     api.ES2020,            // what goja (or browsers) accept
    Format:     api.FormatESModule,    // pages; actors want CommonJS or an IIFE
    Sourcemap:  api.SourceMapInline,   // keeps error positions on the TS source
})
// r.Code, r.Errors
```

It removes types only. It needs no other file, so it is fast and fits a per-request cache.

**Module graphs: `api.Build`.** It bundles an entry and everything it imports into one file. A plugin's `OnResolve`/`OnLoad` callbacks would read the imported files from the snapshot instead of a disk, so slop could bundle an app (and the bench) itself, keyed by `(snapshot n, entry)`.

The hook points:

1. **Pages:** `writeStoreBytes` (or `resolveStoreFile` before it). A `.ts`/`.tsx` request gets the compiled output, served as `text/javascript`.
2. **Actors:** `(*Actor).load` and `requirer` in `pkg/actor/actor.go`. Compile `actor.ts` and each required `.ts` before `RunScript`.
3. **The eval verb:** `pkg/commands/eval.go`, if callers should be able to send TS.
4. **The agent's evals** (browser, QuickJS). Decided in section 8: the bench's type-check worker compiles them (`ts.transpileModule`), so there is no server request.

## 5. Questions the full design must settle

- **Caching.** Key the output by the source's sha256 plus a version of the compiler options. Where does it live: memory only (an LRU), or beside the blobs in the store? A bundle's key is the snapshot number plus the entry; snapshots are immutable, so a bundle never goes stale.
- **Content types.** Check which type the store assigns to `.ts` files. On Linux, `/etc/mime.types` maps `.ts` to `video/mp2t`, and browsers refuse to run a module served with that type. The served response must say `text/javascript` whatever the stored type is.
- **Import specifiers.**
  - In the browser, `import './x.ts'` works if the server compiles on request.
  - TypeScript-style `import './x'` (no extension) needs resolution, either by rewriting imports or by bundling.
  - Bare imports (`import 'lit'`) need bundling plus somewhere to get packages from. Decide whether to support them at all.
- **Type checking.** esbuild does not check types. Options:
  - `tsc --noEmit` in CI and in the bench (through Node in CI, nowhere on the server);
  - the Go port of the TypeScript compiler (typescript-go). Check its state at design time; it may allow checking on the server or in a verb.
  - The agent sees type errors in its eval effects, checked in the bench by a browser worker (decided in section 8).
- **What a single-file transform cannot do.** Under the `isolatedModules` rules, `const enum` across files, namespace merging and `export =` do not work. Document the subset, or turn on `isolatedModules` in the declared `tsconfig`.
- **Error positions.**
  - Actor logs and stack traces report positions in the compiled JS. Check whether goja can apply an inline source map; if not, map positions on the server.
  - The probe's `data-src` attributes point at HTML lines and are unaffected, but script errors in frames report JS lines.
- **Which files the server compiles.** All `.ts`/`.tsx`, or only those `app.json` names (a `"typescript": true` switch, or an `"entry"`)? Plain `.js` stays as it is either way.
- **The agent.** Its guide says to write JavaScript (`web/bench/src/agent/guide.js`). Switching it to TS for app files is a guide change, plus effects that report compile errors (and type errors, if checked).
- **Templates.** `web/bench/src/model/templates.js` would offer TS versions.

## 6. The bench's own source

Two routes, and they do not conflict:

- **At build time, possible today.** esbuild already builds the page, so `.ts` modules compile with no other change. Add `typescript` as a dev dependency and run `tsc --noEmit` next to `tools/imports.mjs`. Text that is inlined (`worker/core.js`, `frames/probe.js`) goes through `esbuild.transform` first. The actor could be `actor.ts`, built into `apps/bench/actor.js`.
- **Through the server feature.** Once slop compiles TS itself, the bench could be pushed as TS and served directly, perhaps bundled by the server, and `build.mjs` would shrink.

SLOP3-023 left the bench in layered ES modules (lib → core → server → model → frames → agent → ui). The natural seams for types are the Draft and Tx, the API table entries (`core/api.js`), the eval context (`agent/eval.js`), and the bench actor's action arguments and results. Convert layer by layer, bottom up.

## 7. Types and API shape: what the review of #51 showed

The review of #51 (SLOP3-023, diary steps 10 and 11) found two bugs. They show what types would catch and what needs a different shape instead.

**What happened:**

- **The bench actor's `commit` rebuilt the change list** of `files.commit` with code that knew only two of its four kinds. A file kept by hash was committed as the text `undefined`. With the change type shared by every hop, this is a compile error: `c.text` doesn't exist on every variant.
- **`restore` read an unknown snapshot (`null`) as 0**, the empty tree, and deleted every file. `?? 0` on a `number | null` is well-typed, so types alone would not have caught it. It needed a different shape, which #51 now has:
  - `events.n` and `events.ref` are `NOT NULL` (n > 0);
  - every event belongs to one workspace and records that workspace's snapshot;
  - `restoreTo(P, ref, n)` and `changesSince(P, ref, n)` take a snapshot number and refuse 0 and `null`.

**What remains:**

1. **Declared argument types for the bench actor's actions,** checked by one function before `run`. The bench's host API got this in SLOP3-023 (`web/bench/src/core/api.js`). The actor's 35 actions did not: they take untyped JSON and convert it by hand (`text()` is `String(v ?? '')`), so a wrong shape becomes a different value instead of an error. This can be done before TypeScript, in JavaScript.

   It might belong in slop itself: actions declare their `args`, as the host API declares `sig`, and the actor runtime answers `invalid_argument`.
2. **TypeScript declarations for the verb-backed modules** (workshop, system), generated from the Go input structs of the verbs they call.
   - The module's functions map to verbs: `{JS: "commit", Verb: "files.commit"}` in `pkg/doors/actors/modworkshop.go`.
   - `FileChange` in `pkg/commands/files.go` carries JSON-schema tags.
   - Today only the go-go-goja bridged modules and `database` carry declarations (`pkg/actor/bridge.go` `typeScriptOf`, the catalog's `Module.TypeScript`); workshop has none.

   With them, an actor written in TypeScript gets a typed `w.commit(store, changes: FileChange[], …)`.
3. **A tagged change type,** `{kind: 'text' | 'data' | 'blob' | 'delete', …}`, handled exhaustively (a `never` check). It would be shared by the page's Draft, the actor and the Node tests' stand-in actor. On the wire, `files.commit` takes "exactly one of text, data, sha256 or delete", a Go struct standing in for a sum type. The tag could live on the client side only, or be added to the verb.
4. **A snapshot type only the server hands out** (a branded `Snapshot`), distinct from "the ref doesn't exist".
   - `files.commit`'s `base: 0` means "the ref must not exist". That marker number is what made 0 look like a plausible default elsewhere; a separate value (`base: null`, or `absent: true`) would not.
   - The page checks snapshots at runtime (`web/bench/src/model/timeline.js` `checkSnap`); a type would check them at build time.
5. **"Set a ref's tree to snapshot n" as one server commit.** The store's `ResetTree` exists. Restore would then not compute deletions on the client from a listing it might have wrong.

**What types would not catch:**

- **A stand-in that accepts more than the real server.** That is a difference in behaviour. #51 handles it with one stand-in that applies `files.commit`'s rule (`web/bench/test/fake-actor.mjs`); running the same tests against both would be stronger.
- **An explicit default** such as `?? 0` on `number | null`.

## 8. Type checking in the bench: a browser worker (decided 2026-11-16)

The agent's eval results should report the type errors an eval introduced; that is where checking pays off most. The two candidates were a TypeScript checker in a Web Worker in the bench, or a check request to the server. **The decision is the browser worker.**

**Measured** with `scripts/01-ts-check-latency.cjs` (TypeScript 5.9.3, a three-file app with the es2022 and DOM libraries; browsers run the same engine):

| | |
|---|---|
| Download | `typescript.js` 1.6 MB gzipped (9.1 MB raw); lib `.d.ts` files 0.3 MB gzipped; cached after the first load |
| First check (cold) | 1.26 s, mostly parsing the DOM's types |
| Check after an edit (warm) | 30–90 ms |
| Memory | about 80 MB |

The planted bug (`r.txt` for `r.text`) came back as "Property 'txt' does not exist on type '{ text: string; by: string; }'. Did you mean 'text'?": the message the agent should get.

**Why the browser worker:**

- **Speed.** A checker kept warm re-checks in 30–90 ms per eval. A server would pay about 1.3 s per request, or keep an 80 MB checker warm for every person and app.
- **It sees the eval's own writes.** It can check the eval's transaction before the commit (dry runs too), and report errors new or fixed since the eval began. That is how the bench already computes effects. A server sees committed snapshots only, unless the page uploads the files.
- **One worker, three uses:**
  - type errors in the agent's eval results;
  - error underlines and hover types for the person in the Code view;
  - compiling the agent's TypeScript eval code (`ts.transpileModule`) before QuickJS runs it, which settles section 4, item 4.
- **Nothing new on the server.** It needs no Node or typescript-go dependency. TypeScript's type system can be pushed into very long checks; in the browser that costs one person's tab, not the server.

**Costs:** the 2 MB download and the 80 MB of memory. Both are paid only for apps that have `.ts` files, and the 1.3 s first check runs in the background when the app opens.

**Compiling and checking are different jobs, and they run in different places.** Compiling strips types (esbuild) and is needed wherever code runs. Checking finds type errors and never changes what runs. So serving never waits on a check, and a type error never takes an app down.

| | Compile (strip types) | Check (find type errors) |
|---|---|---|
| The server | every page file served and every actor file loaded (section 4), cached by hash | only at gates, on request and cached by snapshot: before publishing (a warning, or a block if the app opts in), `slop check`, agents working without a browser |
| The bench (browser worker) | the agent's eval code | every change: eval results and the Code view |
| Locally and in CI | (the server does it) | plain `tsc` |

All three check against the same declarations and `tsconfig`, so they agree.

**The server's part:** it serves the declarations (`slop.d.ts`: the page runtime, the actor API, the modules, the app's actions; section 7) and the `tsconfig`. The bench worker, local `tsc` and CI then all check against the same inputs. A server-side checker comes later, only for users without a browser, such as a check before publishing or an agent working from the CLI. That would be typescript-go once it can be built into the binary, with results cached by snapshot, since a snapshot never changes.

**Implementation notes:**

- **Its own worker,** separate from the QuickJS sandbox: the bench kills the sandbox when an eval overruns its time, and that must not throw away the warm checker.
- **Inputs:** the worker holds the workspace's files by path and version (sha256). The page sends changes: head moves, the person's edits, and for an eval, the transaction's writes.
- **Results inform; they never fail an eval.** The effect is `types: {new: [{file, line, message}], fixed: n}`, capped, like `newIssues`. If a check takes longer than about 2 s, the eval says its types were not checked. The agent can also ask with a `types.check()` call in the API table.
- **Versions:** the TypeScript version is pinned with the bench build, and the declarations carry a version from the server.

## 9. Related

- SLOP3-023 (the bench core rewrite): `ttmp/2026/11/16/SLOP3-023--bench-core-drafts-as-server-side-commits-evals-as-transactions-one-api-table-one-storage-model/`. Its diary records when this came up.
- Files named above: `pkg/doors/pages/storebytes.go`, `pkg/actor/actor.go`, `pkg/actor/catalog.go`, `pkg/commands/eval.go`, `web/bench/build.mjs`.
