---
Title: Diary
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
    - Path: repo://ttmp/2026/11/16/SLOP3-024--typescript-in-slop-the-server-compiles-ts-to-js-with-esbuild-apps-actors-the-bench/design-doc/01-design-typescript-in-slop-the-server-compiles-slop-s-apis-come-with-types-the-bench-checks.md
      Note: the design this diary records
ExternalSources: []
Summary: 'Chronological record of SLOP3-024: the type-checking decision (notes §8) and the full design (design-doc/01), with the probes behind them.'
LastUpdated: 2026-11-16T17:58:08.859287946-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Where type checking runs (notes §8)

The ticket existed only as notes. The person asked where the bench should check types, in a browser worker or through a request to the server. I measured TypeScript's checker on a small app and recommended the browser worker. On "ok, add that", the decision went into the notes as §8, with the latency script in `scripts/`. While I was committing, the person observed that checking seems to belong on both the client and the server. §8 now separates compiling (on the server, always) from checking (in the bench and with `tsc`; on the server only at gates).

### Prompt Context
**User prompt (verbatim):** "ok, add that. Did we already write out SLOP3-024?" — and mid-step: "so i guess typechecking should run on both client (for the agent stuff), and backend (for serving apps and the like?)"
**Assistant interpretation:** Record the browser-worker decision in the ticket, say whether the full design exists, and answer the client/server question.
**Inferred user intent:** Keep decisions in the ticket as they are made, so the design later starts from them.
**Commit (docs):** 407a3f9 — "SLOP3-024: notes §8 — type checking in the bench is a browser worker; compile vs check by place; latency script; task"

### What I did
- `scripts/01-ts-check-latency.cjs`: a TypeScript language service over three in-memory files, with the es2022 and DOM libs. It plants a bug (`r.txt`) and times a cold check and re-checks after edits.
- Notes §8 covers the decision, the measurements, the reasons, the compile-vs-check table, the server's part, and implementation notes. It updated two places in §4 and §5 that had left the question open, and added a task.

### Why
- A warm checker re-checks in 30–90 ms and sees an eval's uncommitted writes. A server would pay the cold check per request, or keep about 80 MB warm for every person and app.

### What worked
- First run, TypeScript 5.9.3: cold check 1255 ms; after an edit, 88 ms and 1 error ("Property 'txt' does not exist on type '{ text: string; by: string; }'. Did you mean 'text'?"); after a second edit, 32 ms; heap 79 MB. Sizes: `typescript.js` 9,112,572 bytes (1,633,773 gzipped); lib files 2,413,666 bytes (318,455 gzipped).
- Second run: cold check 361 ms, with the libs in the OS file cache.

### What didn't work
- The first run of the script from the ticket used a path that doesn't exist: `Error: Cannot find module '…/scratchpad/t23/web/runtime/node_modules/typescript'`. The `t23` worktree has no `node_modules`. It was rerun against the main checkout's `web/runtime/node_modules/typescript`.

### What I learned
- The cold time varies about 3.5× with the OS file cache, so §8 gives the range.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The timings come from Node on this machine. A browser worker runs the same engine, but its startup costs differ.

### What should be done in the future
- See Step 2: the design adopts §8.

### Code review instructions
- `node scripts/01-ts-check-latency.cjs <web/runtime/node_modules/typescript>`

### Technical details
- See notes §8.

## Step 2: The full design

The person asked for the full design and an upload to the reMarkable. I checked the facts the design depends on against the code and wrote two probes for the open questions:

- esbuild's transform time;
- whether goja runs esbuild's output and applies its source maps.

The design (`design-doc/01-…md`) has three parts:

- the server compiles each `.ts` file with esbuild's Go API, cached by hash, for pages, actors, app verbs and `slop eval`;
- slop publishes declarations, with the verb-backed modules generated from their verbs' JSON Schemas, and each app's actions later declared as schemas;
- checking runs in the bench's worker and with `tsc`, with no checker on the server for now.

The tasks were restructured by phase.

### Prompt Context
**User prompt (verbatim):** "ywrite it now, upload to remarkable when done"
**Assistant interpretation:** Write SLOP3-024's design document now (its first task), then upload it.
**Inferred user intent:** Turn the notes into a plan that someone can implement from, and read it on paper.
**Commit (docs):** see the changelog entry for this step (pushed to main).

### What I did
- **Read the code paths the design changes:**
  - `writeStoreBytes`/`resolveStoreFile` and their seven callers;
  - the actor manager's file filter, `load`, `requirer`, `ctxObject`, `readShape`;
  - `modArgs`;
  - `verbs.Def` and the invopop reflector;
  - `app.modules`;
  - `pkg/appverbs`;
  - the eval verb;
  - `ReadDir` and the walk in `slop dev`;
  - the manifest's `actor` field (no default entry);
  - `web/runtime` (tsconfig, `caps.ts`'s `slop.actions` proxy);
  - pinboard's `app.json`, actor and verbs.
- **File types:** `TypeOf` falls back to `mime.TypeByExtension`.
  - Here `/etc/mime.types` maps `ts` to `text/vnd.trolltech.linguist`, and `/usr/share/mime/globs2` lists both `text/vnd.trolltech.linguist:*.ts` and `video/mp2t:*.ts` at weight 50.
  - The server's image is `debian:bookworm-slim` with no MIME package, so Go's built-in table applies, which has no `.ts`, giving `application/octet-stream`. That is deduced from the Dockerfile, not checked on staging.
- **`scripts/02-esbuild-transform-time/`:** `api.Transform` (esbuild v0.25.12) on `web/runtime/src`'s 12 files.
- **`scripts/03-goja-runs-esbuild-output/`:**
  - compiles two TypeScript files (CommonJS, es2020, inline maps) and runs them in goja (the version slop pins) through slop's CommonJS wrapper;
  - sets a source-map loader that returns no files.
- **Binary size:** a stripped binary using `pkg/api`, against a minimal one.
- **TypeScript 7:** searched the web for the status of typescript-go's API.
- **Docs:** wrote the design, reread it as a newcomer, fixed three passages, restructured `tasks.md` by phase, related files, and updated the changelog.

### Why
- **A per-file transform rather than bundling:** the browser and `require` already resolve files one at a time, a per-file cache is exact, and bundling raises package and supply-chain questions that belong in their own ticket.
- **Declarations generated from verb schemas:** the server already reflects every verb's input and output into JSON Schema, so declarations generated from them cannot drift from the server.

### What worked
- **Transform time, warm, inline maps:** 12 files, 84,579 bytes in. As ES modules: 17.53 ms, 258,323 bytes out. As CommonJS: 25.05 ms, 274,308 bytes out. No errors.
- **goja ran the output:**
  - enum, parameter properties, optional chaining, `??`, spread, async/await, `import type`;
  - the async result was `a.txt text,sha256 true`;
  - the thrown error's stack read `at check (rows.ts:9:24(16))` / `at actor.ts:11:55(7)`, and line 9 of `rows.ts` is the `throw`.
- **Binary size:** 8,130,825 bytes against a 1,732,770-byte baseline, so esbuild adds about 6.1 MiB (an upper bound).

### What didn't work
- **The first esbuild timing build failed offline:** `go: downloading golang.org/x/sys v0.0.0-20220715151400-c0bba94af5f8 … module lookup disabled by GOPROXY=off`. Pinning `golang.org/x/sys` to slop's version (v0.49.0, in the module cache) fixed it. The goja probe hit the same error and got the same fix.
- **The goja probe first printed `ok: undefined`:** `out` was read in the same `RunString` that started the promise, before goja ran the job queue. Reading it in a second call gave the result.

### What I learned
- **goja applies inline source maps** to stack traces. Its parser looks for the `sourceMappingURL` line past a trailing `})`, so the map survives slop's CommonJS wrapper. That answers notes §5, "Error positions".
- **Two places the notes don't list:**
  - app CLI verbs (`slop.verbs`) also run JavaScript, in goja inside the CLI;
  - the actor entry has no default; it is whatever `app.json` names.
- **The server decides text from binary by UTF-8 validity** (`files.go`), not by type, so `.ts` files already read as text in the bench.
- **TypeScript 7** (the Go port) shipped in July 2026 without a programmatic API; 7.1's API is reported to be in beta. So server-side checking would run `tsgo` as a separate binary.

### What was tricky to build
- **The offline Go builds:** a module outside slop's tree resolves `x/sys` to an older version that isn't cached. Copying slop's `go.sum` and pinning its `x/sys` keeps everything in the module cache.

### What warrants a second pair of eyes
- **goja's source-map loading defaults.** The design (§4.4) sets a loader that returns no files on every runtime for app code. A related observation was reported to the person separately.
- **The page-host rule in §4.3** has to match exactly the hosts that run pages: the static host, the sandbox host and previews.

### What should be done in the future
- The tasks in `tasks.md`, phases 0–3, and the two decisions in design §11.

### Code review instructions
- Read the design, sections 1–3, then 4.3–4.4 and 5.3–5.4.
- Rerun the probes:
  - `cd scripts/03-goja-runs-esbuild-output && GOWORK=off GOFLAGS=-mod=mod go run .`
  - the same for `scripts/02-esbuild-transform-time <dir of .ts files>`.

### Technical details
- Compile profiles:
  - page: ES module, es2022, linked map;
  - actor and app verbs: CommonJS, es2020, inline map;
  - eval: CommonJS inside the verb's function wrapper.
- Cache key: (sha256, profile, esbuild version).

## Step 3: The source-map fix (#52), and the decisions on packages and .tsx

The person decided three things: fix the goja issue first, then implement; new apps default to TypeScript. They then asked for an explanation of bundling, npm packages and `.tsx` before any work started. After reading it, they settled packages: `slop vendor`, a command only a person runs with the CLI. The agent can't add packages.

This step covers four pieces of work:

- the fix, as PR #52;
- the explanation;
- the design update with the decisions: new §4.7 for `slop vendor`, `.tsx` in phase 0, and app verbs compiled in the CLI through jsverbs' hooks;
- the tasks restructured to match.

### Prompt Context
**User prompts (verbatim):**
- "yes, fix first, then implement, new apps default to TS, \n\nexplain the bundling / npm packages / tsx ? (do this before starting the work, stop, so I can read)"
- "slop vendor then works for an app?"
- "ok, then build that. an agent cannot do that, it's CLI. Update the design doc."

**Assistant interpretation:**
1. Make the fix as its own PR.
2. Record the decisions in the design: TypeScript as the default; packages only through `slop vendor` in the CLI; `.tsx`.
3. Then implement phase 0, followed by `slop vendor`.

**Inferred user intent:** Close the security issue before building on goja's source maps. Keep supply-chain decisions in a person's hands.

**Commit (code):** e44a89f, "goja runtimes for app code read no files for source maps" (PR #52, branch `task/goja-sourcemaps`).

### What I did
- **The fix:**
  - `pkg/jsrt`: `ForAppCode(vm)` sets `parser.WithSourceMapLoader` to a loader that returns `(nil, nil)`.
  - It is called in `newHost` (`pkg/actor/enginehost.go`), `runEval` (`pkg/commands/eval.go`) and `Invoker` (`pkg/appverbs/appverbs.go`).
- **The fix's tests:**
  - `pkg/jsrt`: a control (plain goja reads the map file) and the fix, for three routes: a script's last line, `eval`, and `new Function`. Inline maps still work.
  - `pkg/host` `TestAppCodeOpensNoFiles`: an actor's entry, a required file, `eval` in an action, and the eval verb.
  - `pkg/appverbs` `TestVerbOpensNoFiles`.
- **The explanation's facts:**
  - Page hosts set only `frame-ancestors` in their CSP.
  - blocks-site vendors libraries by hand, with `SHA256SUMS`; pinup builds its packages locally.
  - esbuild's `TransformOptions` has the `JSX*` fields and `TsconfigRaw`.
  - `inject` (`sandbox.go`) puts tags at the top of every served page.
  - The kernel has one `Blobs` store.
- **Found while updating the design:** go-go-goja already depends on esbuild v0.25.12. Its `pkg/tsscript` and `pkg/xgoja/app/typescript.go` wire TypeScript into jsverbs through `ScanOptions.SourceTransform` and `RuntimeTransform`. `go list -deps ./cmd/...` shows that slop doesn't link esbuild yet.
- **The design update:**
  - status, §1, §4.1–4.7, §5.5, §6.2, §7, §9, §10 (a new phase 0b), §11 (now the decisions), and §12;
  - `tasks.md`.

### Why
- **The loader returns nothing, rather than turning source maps off:** inline maps are how TypeScript stack traces will work (§4.1), and goja decodes `data:` URLs without calling the loader.
- **App verbs compile in the CLI:** jsverbs' `RuntimeTransform` needs the original source together with the metadata jsverbs appends to it. Compiling on the server in `app.verbs` would have to reproduce that.

### What worked
- **Control and fix:** the jsrt tests pass. With the three calls removed, the end-to-end tests fail with stacks such as `at entry (outside.ts:1:0(3))`, `at required (outside.ts:1:0(3))`, `eval verb: … at outside.ts:1:0(2)`, `where: … at outside.ts:1:0(2)`. With the calls restored, they pass.
- **Full suite:** `go vet ./...` passes, and `go test -tags sqlite_fts5 ./...` passes in all 22 packages.

### What didn't work
- **The `new Function` control** first failed with `default runtime: the map was not read, so this test checks nothing: "Error: x\n\tat anonymous (<eval>:3:8(7))…"`. `new Function` puts the body on line 3 of the source it builds, and the test map covered only line 1. A map that covers lines 1–4 fixed it.
- **The app-verb test** first printed help: the verb's path is folder, file, function (`verbs where where`).
- **`go test ./...` without tags** fails `TestSQLiteHasFTS5`. The Makefile runs `go test -tags $(TAGS)`.
- **Inserting the import with sed and goimports** left a duplicate and a stray group. The three import blocks were rebuilt with a script.

### What I learned
- **Wrappers decide reachability.**
  - `slop eval` wraps its source in `(function(){…\n})()`. Its last line, `})()`, hides a trailing map comment, but `eval` inside the program still reaches the loader.
  - The actor's `require` wrapper ends in `})`, which goja deliberately skips when it looks for the map line, so required files were reachable directly.
- **jsverbs' own scan** already parses with `WithDisableSourceMaps`, and goja_nodejs's `require` uses the registry's in-memory loader.

### What was tricky to build
- **Proving the end-to-end tests detect the bug:** commit, comment the calls out temporarily, run the tests, then `git checkout -- pkg`.

### What warrants a second pair of eyes
- **No other place** where app code is parsed by goja outside these three runtimes. A search found no `goja.Compile`/`goja.Parse` in slop.

### What should be done in the future
- **Deploy #52 to staging** once it is merged.
- **Phase 0, then phase 0b**, per `tasks.md`.

### Code review instructions
- **#52:** `pkg/jsrt/jsrt.go`, the three call sites, and the three tests.
- **Run:** `go test -tags sqlite_fts5 ./pkg/jsrt ./pkg/host ./pkg/appverbs -run 'OpensNoFiles|KeepsInline' -count=1`

### Technical details
- **`slop vendor` (design §4.7):**
  - fetches registry tarballs and checks them against `dist.integrity`;
  - bundles with `api.Build` (ESM with splitting; CJS with `--actor`);
  - writes `vendor/<pkg>@<ver>/`, `vendor/vendor.json`, and `app.json` `imports.page` and `imports.actor`.
- **The server:**
  - injects an import map from `imports.page`;
  - the actor's `require` resolves `imports.actor`;
  - `slop types` writes `paths` from `vendor.json`.

## Step 4: Phase 0, slop compiles TypeScript (PR #53)

Phase 0 is built and tested, both in Go tests and in a real browser:

- **`pkg/tscompile`:** a per-file esbuild transform with three profiles and a cache.
- **Page routes:** they serve `.ts` and `.tsx` compiled, with source maps and an import map.
- **Actors:** they load TypeScript and resolve vendored names.
- **`slop eval` and app verbs:** both take TypeScript.

The branch builds on #52. Two things in the design were wrong and are corrected:

- slop's own modules can't be `import`ed;
- the names live under `slop.imports`.

### Prompt Context
**User prompt (verbatim):** see Step 3 ("ok, then build that. an agent cannot do that, it's CLI. Update the design doc.")
**Assistant interpretation:** Implement the design, starting with phase 0, which `slop vendor` relies on (the import map, and `require` resolving vendored names).
**Inferred user intent:** Real TypeScript support in slop, built in reviewable steps.
**Commit (code):** ed9e9ee (tscompile), e9c45f4 (pages), 8d81ea3 (actors), 40369cd (eval and verbs), on `task/slop3-024-compile`, PR #53.

### What I did
- **`pkg/tscompile`:**
  - `Compile(name, src, profile, tsconfig)`, with an LRU bounded by bytes, `singleflight`, and `GOMAXPROCS` slots;
  - `Is` for which names compile;
  - `ErrorModule` for files that don't compile;
  - `Version` (`esbuild-0.25.12.1`), checked against `go.mod`.
- **Pages:**
  - `pkg/doors/pages/code.go` (`appCode`, `codeBytes`, `serveSourceMap`, `writeDerived`, `importMap`);
  - `storeBytes.code`;
  - the static host (`site.go`), the sandbox and previews pass an `appCode`.
- **Manifest and file types:** `slop.imports {page, actor}` in `pkg/apps/manifest.go`; file types in `pkg/store/files.go`.
- **Actors:**
  - `codeFile` and `resolveFile`;
  - the TypeScript entry is loaded through `require`;
  - `requirer` compiles TypeScript and resolves `actorImport`;
  - `syntaxError`;
  - `defineActor` returns its argument.
- **`slop eval` and app verbs:**
  - `EvalIn.TS`;
  - `scanOptions()` in `pkg/appverbs`, with jsverbs' `SourceTransform` and `RuntimeTransform`.
- **Tests:** in `pkg/tscompile`, `pkg/apps`, `pkg/appverbs`, and `pkg/host` (`typescript_pages_test.go`, `typescript_actors_test.go`).
- **The browser check:**
  - built `slop024` and ran it on a copy of the #51 server's data, on port 18491;
  - wrote a credentials file for that address (the token was never printed);
  - pushed a demo app (`$S/tsdemo`: `main.tsx`, `lib/text.ts`, `actor.ts`, a small JSX runtime in `vendor/`), mounted it at `/tsdemo` on the live host, and opened it in Playwright.

### Why
- **`appCode` on routes, not a host check inside `writeStoreBytes`:** the routes that serve an app's pages know the snapshot, the manifest and the app's root URL. Store files (`/_s/`), uploads and actor routes don't, and keep serving bytes as stored.
- **The import map goes into every HTML page,** not only the injected entry. The sandbox serves other HTML files raw, and so does the static host.
- **A TypeScript entry runs through `require`,** so its compiled `module.exports` exists. JavaScript entries keep running as scripts, because a JavaScript app may share top-level names between its entry and the files it requires.

### What worked
- **Tests:** `go test -tags sqlite_fts5 ./...` passes in all 23 packages. `go vet` passes, and `golangci-lint` reports 0 issues. The new code passes under `-race`.
- **The browser:**
  - the frame rendered `<div id="hello" data-slug="type-script"><p>Hello, Type Script!</p><small>from actor.ts (type-script)</small></div>`;
  - the import map was `{"imports":{"mini/jsx-runtime":"/v/1/vendor/mini/jsx-runtime.js"}}`;
  - `main.tsx` came back `200 text/javascript; charset=utf-8`, starting `import { jsx, jsxs } from "mini/jsx-runtime"`;
  - `main.tsx.map` came back `200 application/json`;
  - the console had 0 errors and 0 warnings.

### What didn't work
- **The actor stack read `lib/lib/rows.ts:9:24`.** goja resolves a map's `sources` relative to the file. The fix is to set `Sourcefile` to the base name for every profile; messages keep the full path, because the code formats them itself.
- **`mount.set` on the static host failed** with `tsapp runs a live app (capabilities or an actor): mount it on a live host`. The test now uses a second store without capabilities as the site.
- **A wrong expectation in my test:** esbuild writes `const slug = …; export { slug }`, not `export const`.
- **A broken version's status first read `actor.ts: GoError: lib/rows.ts:10:1: Expected identifier but found end of file at github.com/…requirer.func8.1 (native)`.** It now throws a JavaScript `SyntaxError`. My expected position (9:2) was also wrong: esbuild reports the unclosed brace at the end of the file (10:1).
- **Lint:** `nonamedreturns` (twice) and `predeclared` (`max`), all fixed.

### What I learned
- **`require` reserves only the bridged modules** (`database`, `express`, `fs`, `path`, `yaml`, `crypto`, `events`, `buffer`). `sql` and `workshop` are reached only with `use()`. The design said otherwise, and is now corrected.
- **The static host serves only sites.** Live apps must be mounted on a live host.
- **The sandbox injects the runtime only into the app's entry page.** Its other HTML files are served raw.

### What was tricky to build
- **Keeping one writer of store bytes:** compiled bytes go through `writeDerived`, which uses the same `cacheControl()` and the same nosniff and 304 handling as stored bytes. The ETag names the compiler version and the tsconfig, so a change to either one revalidates.

### What warrants a second pair of eyes
- **Numbered snapshots are served `immutable`.** After an esbuild upgrade, a browser may keep the older compile of the same source. That is harmless, but it is a deliberate choice.
- **`/v/0/` in the sandbox resolves to `main` and is still served as `immutable`.** That was so before this change, and compiled files inherit it.
- **The import-map base comes from the URL path minus the file's path.** If that suffix doesn't match, no map is injected; compiling still works.

### What should be done in the future
- Phase 0b (`slop vendor`), phase 1 (declarations), and the templates and guide defaulting to TypeScript.

### Code review instructions
- **Start with:** `pkg/tscompile/tscompile.go`, `pkg/doors/pages/code.go`, the `writeStoreBytes` hunk, and the `requirer` and `load` hunks in `pkg/actor/actor.go`.
- **Run:** `go test -tags sqlite_fts5 ./pkg/tscompile ./pkg/host -run 'TypeScript|Compile|Profile|TSX|Cache|Errors|Version' -count=1`

### Technical details
- **ETags:**
  - compiled files: `"<sha256>.<Version>.<tsconfig digest or 0>"`;
  - source maps: `"<sha256>.map.<Version>.<digest>"`;
  - pages with the import map: `"<sha256>.im<digest>"`.

## Step 5: Phase 0b, `slop vendor` (PR #54)

`slop vendor` is built and tested against a fake registry, then against npm's real registry on a local server. Real Preact with hooks ran in a browser, and real zod validated an actor's arguments in goja. The CLI's eval command also gained `--ts`; it is in #53. In testing, `--store` read the draft's snapshot as `float64` while the client decodes `json.Number`, so it never saw the draft. That is fixed.

### Prompt Context
**User prompt (verbatim):** see Step 3 ("ok, then build that. an agent cannot do that, it's CLI. Update the design doc."), and mid-step: "howfar are we?"
**Assistant interpretation:** Build `slop vendor` in the CLI only, and give a status update while working.
**Inferred user intent:** Packages for TypeScript apps, with the supply chain in a person's hands.
**Commit (code):** ca613a5 (`slop eval --ts`, on #53); 07a1326 and 9b9ee52 on `task/slop3-024-vendor`, PR #54.

### What I did
- **`pkg/npmvendor`:**
  - `registry.go`: metadata, tarballs, `checkIntegrity`, `pick` (dist-tags, exact versions, ranges), and `resolveAll`, which places packages as npm does and notes missing peers;
  - `build.go`: `unpack`, `outName`, `bundle` (ESM with splitting, or CommonJS per entry), and `declarations`;
  - `appjson.go`: `setImports`, which edits only `slop.imports` with a small JSON scanner;
  - `vendor.go`: `Add`, `Remove`, `Check`, the lock, and `save`.
- **`cmd/slop/cmds/vendor.go`:** `slop vendor` (list and check), `add` (`--actor`, `--registry`), `rm`, and `--dir`/`--store` (`onApp`: pull the draft, run, push back with `ifAt`).
- **Tests:** `pkg/npmvendor/vendor_test.go`, with a fake registry.
- **A probe first:** esbuild resolves bare package names as entry points through `exports`, and with splitting two entries share one chunk.
- **Real runs:**
  - `slop vendor add preact@10.24.3 preact preact/hooks preact/jsx-runtime` in a copy of the demo app; `tsc` against `vendor/tsconfig.vendor.json`; push; Playwright clicks.
  - `slop vendor --store tsdemo add --actor zod@3.23.8`, then a second `--store` add; an actor validating with zod; `slop call` with good and bad arguments.

### Why
- **The `app.json` edit is textual and minimal:** the file is written by hand, and re-serializing it would reorder and reformat it.
- **Declarations go in a `node_modules` tree under `types/`,** so that a vendored package's declarations resolve its dependencies' declarations as they would from npm. The app's tsconfig needs `paths` only for the top-level names.
- **`--store` pulls, changes and pushes with `ifAt`,** because `files.commit` isn't on main yet (#51). `ifAt` keeps a draft that moved from being overwritten.

### What worked
- **Tests:** 5 tests in `pkg/npmvendor`, then 6 with `TestHandMappedNamesStay`. `go test -tags sqlite_fts5 ./...` passes in all 24 packages, `golangci-lint` reports 0 issues, and `-race` passes.
- **Real Preact:**
  - 26 files in 0.43 s;
  - `tsc` passes, and catches a planted error with `Argument of type 'string' is not assignable to parameter of type 'StateUpdater<number>'`;
  - in the browser, three clicks took "clicked 0 times" to "clicked 3 times"; the page loaded one chunk, and the console had no errors.
- **Real zod:**
  - `--store` pushed the draft from 2 to 3, and the second add from 3 to 4;
  - `slop call tsdemo greet '{"name": "Zod"}'` returned `{"by": "actor.ts (zod), checked by zod", "text": "Hello, Zod!"}`;
  - `{"name": 5}` failed with `actor_error: Error: invalid arguments: name Expected string, received number at run (actor.ts:10:33(22))`.

### What didn't work
- **The first `--store` check of the draft listed only preact.** `ref.ls`'s number arrived as `json.Number` (the client uses `UseNumber`), not `float64`, so `onApp` took `main`. Pulling with `--at draft`, `--at 3` and `--at main` showed that the draft was right and that the check was reading `main`. `onApp` now re-decodes the refs into `map[string]int64`.
- **My expected strings for one-line `app.json` files** lacked the space after `"imports":` that `insertMember` writes. I updated the expectations.
- **Lint:** De Morgan (QF1001) in `declarations`, fixed with `isDeclaration`.
- **`go get` marked `semver/v3` as `// indirect`.** `go mod tidy` fixed it, in its own commit.
- **A design flaw I caught before the real runs:** `save` dropped every name under `vendor/`, which would have deleted names mapped by hand (blocks-site keeps hand-vendored files in `vendor/`). Now only names in folders the lock manages are rewritten.

### What I learned
- **The CLI's `eval` is hand-written** (`evalCmd` in `extra.go`) and replaces the generated command, so new verb fields need flags there.
- **The client decodes numbers as `json.Number`** throughout (`client.go`, `folder.go`, `dev.go`'s `toInt`).

### What was tricky to build
- **Placing dependencies:** a dependency is placed beside the package that needs it when any nearer copy has another version, not only when the top slot is taken. Otherwise the nearer copy would shadow it.
- **Editing `app.json` in place:** a member scanner over valid JSON, with indentation taken from the file. A one-line `slop` object stays on one line.

### What warrants a second pair of eyes
- **Trust:** tarball URLs come from the registry's metadata and are checked against the same metadata's integrity hash. Trusting the registry is the trust boundary, as with npm.
- **`--actor` bundles each entry separately,** so two entries of one package each carry their own copy. That's fine for stateless libraries; a note in the docs may be due.
- **`removeFiles` deletes only paths under `vendor/`** that the lock recorded.

### What should be done in the future
- Phase 1: declarations, `slop types` (which also writes the `extends`), and TypeScript templates and guide as the default.
- Maybe `slop vendor` notes for packages that need Node's APIs.

### Code review instructions
- **Start with:** `pkg/npmvendor/vendor.go` (`Add`, `save`), `registry.go` (`resolveAll`, `checkIntegrity`), `build.go` (`unpack`, `bundle`) and `appjson.go`.
- **Run:** `go test -tags sqlite_fts5 ./pkg/npmvendor -count=1 -v`

### Technical details
- **Output names:** a package's root becomes the last segment of its name (`@lit/context` → `context.js`); a subpath becomes its remaining path with the extension dropped and `/` turned into `-`.
- **ES-module chunks** are named `chunk-[hash].js`.
- **Lock:** `{registry, packages: {name: {version, integrity, dependencies: {dir: name@version}, page, actor, files: {path: sha256}}}}`.

## Step 6: Review of #53, the import map on directory pages; #52 merged

The person merged #52 and asked me to address the Codex review of #53. It found one bug, which was real: on the static host, a directory page (`/ts/docs/`) got no import map. The fix passes each route's known base to `newAppCode`, and the pages test now covers directory pages on every route.

### Prompt Context
**User prompt (verbatim):** "Address code review issue: https://github.com/go-go-golems/slop-computer/pull/53 / Merged #52" (first sent as "Merged #62", corrected to #52)
**Assistant interpretation:** Fix the review finding on #53, then push and reply.
**Inferred user intent:** Get #53 ready to merge.
**Commit (code):** 49cca0b, "pages: the static host's import map resolves against the mount's base", pushed to `task/slop3-024-compile`.

### What I did
- **Read the finding:** `registry.BestMount` returns `Rest: "docs"` for `/ts/docs/` (no trailing slash), so `newAppCode`'s check that the URL path ends in rest failed, `base` stayed empty, and `importMap()` returned nothing.
- **`newAppCode(st, n, man, base)`** now takes the app's root URL directly:
  - the static host passes `res.m.Base + "/"` (`Match.Base` is "the request path the mount matched, without a trailing slash");
  - the sandbox passes `prefixBase(r.URL.Path, rest)`, because its `versionPath` rest keeps the slash;
  - a preview passes `/`.
- **`TestTypeScriptPages`:** `docs/index.html` is now in `tsApp`, and `checkTSFiles` checks `docs/` for the import map, on the sandbox, the static host and a preview.
- **The worktree moved:** the session's scratchpad was withdrawn, so this work is in a new worktree under the job folder (`~/.claude/jobs/7fa934c5/tmp/p53`, local branch `fix/pr53-import-map-base`), pushed to `task/slop3-024-compile`.

### Why
- **Each route already knows where the app's root is;** reconstructing it from a normalized suffix is what broke.

### What worked
- **The test catches the bug:** with the old derivation put back on the static host, it fails with `docs/ (200) has no import map <script type="importmap">{"imports":{"preact":"/ts/vendor/preact.js",…}}</script>`. With the fix it passes.
- **Full suite:** `go vet` passes, `golangci-lint` reports 0 issues, and `go test -tags sqlite_fts5 ./...` passes in all 23 packages.
- **Replied** on the review thread (discussion_r4593819396).

### What didn't work
- No failures beyond the reproduction above.

### What I learned
- **`registry.Match.Base`** exists, and is the right source for a mount's root.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- **Mounts with parameters** (`/r/:store`): `Base` is the matched request path (`/r/abc`), which is the app's root for that request.

### What should be done in the future
- #54 is stacked on #53. Once #53 merges, #54 shows only its own commits. It doesn't touch the page code, so no conflict is expected.

### Code review instructions
- **Read:** `pkg/doors/pages/code.go` (`newAppCode`, `prefixBase`) and the three call sites.
- **Run:** `go test -tags sqlite_fts5 ./pkg/host -run TestTypeScriptPages -count=1`

### Technical details
- N/A.

## Step 7: Review of #54, peers, optional dependencies and refused adds

The person asked me to address the Codex review of #54 before going on with #51's findings. All three findings were real, and they're fixed in ec894d5. A package's peers stay imports, which the app resolves to its own copy. An optional dependency that can't be had is left out, with everything placed for it. An add that the new `app.json` would refuse now changes nothing.

### Prompt Context
**User prompt (verbatim):** "Actually first address code review issues on https://github.com/go-go-golems/slop-computer/pull/54" (sent while I was starting on "what about the findings on #51")
**Assistant interpretation:** Fix #54's review findings first, then come back to #51.
**Inferred user intent:** Get the stacked PRs ready to merge in order.
**Commit (code):** ec894d5, "slop vendor: peers stay imports, optional dependencies fail soft, a refused add changes nothing", pushed to `task/slop3-024-vendor`.

### What I did
- **Peers (P2, `registry.go:298`):** a package that imports a peer the tree doesn't hold used to fail to bundle, and vendoring the peer separately didn't help.
  - `resolveAll` now returns a `tree` that carries the peer names.
  - `bundle` marks each peer as external, along with its subpaths (`name/*`), and reads the bundle's external imports from esbuild's metafile.
  - `Add` prints one note per peer package that lists the names the app doesn't map yet, with an `addCommand` that maps them all.
- **Optional dependencies (P2, `registry.go:305`):** a missing tarball for an optional dependency used to fail the whole add.
  - Each tarball is now fetched as its package is placed.
  - A failed optional dependency is rolled back together with everything placed for it. The code records the placement order and truncates it to a mark.
- **Refused adds (P2, `vendor.go:195`):** `Add` used to delete the old version's files before `save` refused the new `app.json`.
  - `save` is split into `prepare` and `commit`. `prepare` computes and checks the new files and writes nothing; `commit` writes them.
  - `Add` writes the new files first, then removes the old ones. `removeFiles` takes a `keep` set, so a re-add at the same version doesn't delete what it just wrote.
  - `Remove` uses the same order.
- **Tests:** `TestPeersStayImports`, `TestOptionalDependencies` and `TestRefusedAddChangesNothing`.
- **Design doc §4.7:** new paragraphs on peers, optional dependencies and refused adds.

### Why
- **Externalizing every peer, even one the tree also holds,** follows from what a peer is: the host provides it, and bundling it gives the package its own copy, which breaks identity whenever the app uses the peer too.
- **Fetching during placement** makes "optional" a matter of scope. Everything that can fail for an optional dependency fails inside its own visit, which is exactly the part that gets rolled back.

### What worked
- **Each new test fails on the old code,** with the problem the review describes:
  - `bundling ui: Could not resolve "core"; Could not resolve "core/extra"`;
  - `GET …/-/notar-1.0.0.tgz: 404 Not Found`;
  - and the refused add, which had already rewritten the files.
- **Against npm:** I vendored `@preact/signals` 2.11.4 before `preact` into a fresh app.
  - Its bundle imports `from "preact"` and `from "preact/hooks"`.
  - The note's command, `slop vendor add preact preact preact/hooks`, mapped both names, and re-adding signals then gave no note.
  - `slop vendor` reports no problems.
- **Full suite:** `golangci-lint` reports 0 issues; `go test -tags sqlite_fts5 ./...` passes in all 24 packages; `-race` on `pkg/npmvendor` passes.
- **Replied** on the three threads (discussion_r4593923230, …3430, …3612).

### What didn't work
- **The first note named one command per import:** `slop vendor add preact preact/hooks` for `preact/hooks`. Given import names, an add maps only those names, so that command left `preact` unmapped, and the npm run showed it. The notes are now grouped per peer package, with one command for all its names.
- **`bundle` with named results** would have failed `nonamedreturns`; I changed it before linting.

### What I learned
- **esbuild's metafile** lists each output's imports with `external: true`. That is the exact set of names the app must map, so optional peers a package never imports produce no notes.

### What was tricky to build
- **Rolling back an optional subtree:**
  - **The obstacle:** the resolver dedupes against what is already placed, so removing entries could break something that relies on them.
  - **Why it's safe:** the walk is depth first. Everything placed after the mark was placed by the failed visit itself, and no other branch has looked at it yet. So truncating the order to the mark is enough.

### What warrants a second pair of eyes
- **A peer the tree also holds is now external too.** Example: a package that depends on react and also on react-dom, which peers react. Before this change, react was bundled into the package. Now the app must vendor react, and a note says so.

### What should be done in the future
- **Peer ranges are not checked** against the version the app has vendored. npm warns about an unmet peer; a later change could too, since the lock has the versions.
- **Shared non-peer dependencies:** two packages vendored separately that both depend on the same library, such as `@codemirror/state`, each get their own copy of it. Vendoring them in one add would share it, but `slop vendor add` takes one package per add.

### Code review instructions
- **Read:**
  - `pkg/npmvendor/registry.go` (`resolveAll`, `tree`);
  - `pkg/npmvendor/build.go` (`bundle`: `External`, metafile);
  - `pkg/npmvendor/vendor.go` (`Add` after `count`, `prepare`/`commit`, `removeFiles`).
- **Run:** `go test ./pkg/npmvendor -run 'Peers|Optional|Refused' -count=1 -v`

### Technical details
- The note's format: `<pkg>'s page bundles import its peer <peer> (<names>), and the app does not map it yet: slop vendor add <peer> <names…>`. The actor's note says "require" and "for the actor".

## Step 8: Phase 1, declarations for apps (PR #55); #51 merged with main

The person answered "yes." to starting phase 1, and while I was reading the code they merged #53 and #54. Phase 1 went onto main as PR #55. An app now gets three declaration files from `app.types`:
- **`page.d.ts`**, `window.claude`, built from `web/runtime`'s own types;
- **`actor.d.ts`**, the actor runtime, written by hand and checked against the runtime;
- **`modules.d.ts`**, the Go modules the app can load, partly generated from the verbs' JSON Schemas.

`slop types` writes them into `.slop/types/` with two `tsconfig` files, and `slop dev` refreshes them. A fixture app is checked with `tsc` in `go test`. The TypeScript templates and the agent's guide wait for #51, which holds `web/bench`'s rewrite. Before starting, I merged main into #51 and resolved its conflicts with #53.

### Prompt Context
**User prompts (verbatim):** "yes." (to: start phase 1 now, stacked on #54, or after the merges), then "#54 and #53 merged" (sent mid-turn).
**Assistant interpretation:** Start phase 1 now. With #53 and #54 merged, branch from main instead of #54. Keep #51 mergeable after #53, since I had offered the manual merge.
**Inferred user intent:** Keep SLOP3-024 moving while the earlier PRs land.
**Commits:**
- 1391d9b on `task/slop3-023-core`: "Merge main (#52, #53, #54) into the bench core".
- 3d7df87 and 9583c06 on `task/slop3-024-types` (PR #55).

### What I did
- **#51 merged with main.** `sandbox.go`'s non-entry branch now keeps #53's handling (compiled TypeScript, the source-map fallback, the import map in derived HTML) and #51's (an HTML document goes down the entry path). Tests from main that called `files.push` directly now use #51's `h.push`, which supplies `ifAt`.
- **The converter, `verbs.TypeScript`:** JSON Schema to TypeScript for what verbs reflect to.
  - It handles objects, maps, arrays, tuples, enums, consts, primitives, and `oneOf`/`anyOf` unions. Descriptions become doc comments; anything else is `unknown`.
  - Its golden file type-checks with `tsc`.
- **The push manifest:** `files.push` and `import.files` declare it as a union, through a `JSONSchemaExtend` hook: `{path, text} | {path, data} | {path, sha256, size}`.
- **Workshop and system:** declarations generated from their verbs (`moduleTypeScript`), the way `modArgs` calls them, with the hand-written functions (`drop`, `embed`, `call`) declared alongside.
- **`ModulesTypeScript(app, declared)`** on the actor manager. Two older declarations needed fixes along the way:
  - `buffer` is now valid as an interface plus a value;
  - go-go-goja's `events` had `export =` together with `export { X }`, which TypeScript refuses; it is rewritten as a namespace merged with the class.
- **`pkg/apptypes`:**
  - `actor.d.ts` declares the globals, `Ctx`, the definition, `ActorOf`, and every built-in `use()` module. `TestActorTypesDrift` checks it against the runtime.
  - `page.d.ts` comes from `web/runtime/src/types.ts`, emitted by the runtime's build through the TypeScript API.
- **`app.types`, `slop types`, and the `slop dev` refresh.** CI's test command is now `make test-ci`.
- **The fixture app** is `pkg/host/testdata/tsnotes`, checked by `TestAppTypes`.

### Why
- **`actor.d.ts` by hand, with a drift test:** the actor's surface is Go code that builds JavaScript objects, so there is nothing to generate from. The test compares the property names the runtime has with the declaration's members, and caught both members I removed on purpose (`needAudience`, `rowsWritten`).
- **`page.d.ts` from the implementation's own types:** a hand-written copy would drift. Where the runtime is untyped, the declaration is honest and loose.
- **Modules renamed `slop:page/…`:** names like `db`, `query` and `util` could meet a package an app vendors.
- **`pkg/apptypes`:** `pkg/commands` cannot import the pages door, and the verb should not depend on it.

### What worked
- **tsc on the fixture:** both programs pass. The planted mistakes are caught: a misspelled argument (`'txt' does not exist`), a wrong result type (`string` for `number`), and `use('system')` when only workshop is declared and granted.
- **A sample page:** checked against `page.d.ts`, it catches a `Date` result that arrives as a string, and an unknown capability.
- **The sample actor:** checked against `actor.d.ts` and `modules.d.ts`. Returning `{rows}` from a route is an error there; the runtime would send it as an empty body.
- **Full suites:** `go test -tags sqlite_fts5 ./...` passes in all 24 packages, and `golangci-lint` reports 0 issues; `pnpm check` and `pnpm test` (17) pass in `web/runtime`.
- **The CI install:** the npm step, run in a clean copy, writes no lockfile and installs TypeScript 5.9.3.

### What didn't work
- **The first `modules.d.ts` failed `tsc`:**
  - `buffer`: "Class static side 'typeof Buffer' incorrectly extends base class static side". Fixed by declaring an interface and a value.
  - `events`: "An export assignment cannot be used in a module with other exported elements". Fixed with `fixExportAssignment`.
- **`tsc` on the golden file picked up a stray `@types/node`** in `/home/manuel/node_modules`, outside the repo. `types: []` keeps it out, and the generated `tsconfig` files set it too.
- **The print test failed:** `app.trust` needs an app (an `app.json`), and main's harness has no `h.push`.
- **Two wrong expectations in `TestPushFilesSchema`:** the generated `})[]` and the indentation were right, and the test was wrong.
- **Lint:** staticcheck QF1003 (an if/else on one character) in `paren`, now a tagged switch.
- **A test run that tested nothing:** `-run TestDevLoop` matched no test and passed in 0.03 s. The test is `TestSlopDev`.

### What I learned
- **TS globs skip dot directories,** so the pages' `include` never picks up `.slop/types/actor.d.ts`. That matters: its `console` would clash with the DOM's.
- **`satisfies ActorOf<Actions>`** gives handlers their parameter types by context, as the design hoped.

### What was tricky to build
- **Overloads for verb-backed functions:**
  - **The obstacle:** TypeScript forbids a required parameter after an optional one, and a function can take either an object or positions.
  - **The fix:** each function gets an object form and, when it has positions, a positional form whose parameters turn optional from the first optional one. A needed option after an optional position drops the positional form.

### What warrants a second pair of eyes
- **CI now runs `make test-ci`,** which runs `npm install` before the tests. It can't be tried before the PR runs, but the step itself works in a clean copy.
- **`page.d.ts`'s `db`, `user`, `comments` and `room` are loose.** There's a task to annotate them in `web/runtime`.
- **`modules.d.ts` follows today's grants:** a module granted later appears at the next `slop types` or `slop dev`.

### What should be done in the future
- **After #51 merges:**
  - TypeScript templates as the default for new apps, and the agent's guide;
  - `files.commit`'s `FileChange` as a union.
- **Phase 2:** typed actions (`args` schemas, `actions.d.ts`, `FromSchema`).

### Code review instructions
- **Read:**
  - `pkg/verbs/typescript.go`;
  - `pkg/doors/actors/modtypes.go`;
  - `pkg/actor/types.go`;
  - `pkg/apptypes/actor.d.ts`;
  - `web/runtime/src/types.ts` and `build.mjs`;
  - `pkg/commands/actors.go` (`app.types`);
  - `pkg/client/types.go`;
  - `pkg/host/apptypes_test.go`.
- **Run:** `make runtime && go test -tags sqlite_fts5 ./pkg/host -run 'TestAppTypes|TestActorTypesDrift|TestSlopDev' -count=1 -v`

## Step 9: #51 merged; TypeScript templates, the agent's guide, FileChange as a union; a review fix

With #51 on main, the last two phase 1 items could land on #55: the TypeScript templates with the agent's guide, and `files.commit`'s `FileChange` as a union. While I worked, the person forwarded a Codex comment on #55: `system:` reactors were typed as receiving store commits. That is fixed too.

The new template test found a real problem. TypeScript treats a page script with no imports as a script rather than a module, and refuses its top-level `await`. The generated `tsconfig` files now set `moduleDetection: force`.

### Prompt Context
**User prompts (verbatim):** "mergeed #51"; then, sent mid-turn, "Also thiscomment [the Codex comment on pkg/apptypes/actor.d.ts: Distinguish system-log events from store commits] (fix and answer when done) on https://github.com/go-go-golems/slop-computer/pull/55".
**Assistant interpretation:** Merge main into #55 and finish phase 1's remaining items. Fix the comment and reply on the PR.
**Inferred user intent:** Close out phase 1 in one PR.
**Commits (on `task/slop3-024-types`):**
- 76b03c3: the merge, the `FileChange` union, and the reactor fix;
- 8ebc4b9: the templates and the guide.

### What I did
- **The merge:** main into #55. One conflict, in `modules.go`: my `TypeScript:` fields against #51's new workshop doc ("commit or push"). I kept both.
- **The `FileChange` union:** `FileChange.JSONSchema()` returns the four kinds `files.commit` enforces: text, data, sha256 with size, and `delete: true`.
- **The reactor fix:** `SystemEntry` and `SystemReactor` declared from `sysdb.LogEntry`. `Reactors` has a `` `system:${string}` `` index signature beside the string one.
- **The templates, in TypeScript:**
  - `index.html` with `<script type="module" src="main.ts">`;
  - in the actor template, `api.ts`, `actor.ts` and `main.ts`, plus READMEs on checking with `slop types` and `tsc`.
- **`TestTemplateTypes`:** it renders the templates with node, runs each on the server (the actor template's add and list included), and runs `tsc` on its pages and actor against its own `app.types`.
- **The guide:**
  - write TypeScript, which is compiled but not checked;
  - imports carry extensions;
  - there is no npm: ask the person to vendor a package, and never copy one in;
  - the contract pattern;
  - `server/` holds files only the actor uses;
  - `.js` apps are not converted unless asked.
- **`make bench`:** only the stamps changed in `sandbox.js`, `index.html` and `probe.js`.

### Why
- **The pattern index signature:** a union of reactor types in the string index loses contextual typing; handlers' parameters became implicit `any`. With two index signatures, each key picks its own. That requires `SystemReactor` to be assignable to `Reactor`, so `SystemEntry.summary` is optional.
- **Templates checked by a Go test:** CI runs only `go test` (`make test-ci`), and the test checks the templates against the declarations the server actually returns.

### What worked
- **The reactor fix under `tsc`:** `entry.store` in a `system:grant` handler is "Property 'store' does not exist on type 'SystemEntry'", and a `table:` handler still gets `commit.store` and `commit.epoch`.
- **The suites:** `go test -tags sqlite_fts5 ./...` passes; `golangci-lint` reports 0 issues; the bench's Node tests pass (25).
- **CI:** #55's CI passed before these commits, which was the first run of `make test-ci`.

### What didn't work
- **The first reactor typing:** `{ [K in \`system:${string}\`]: SystemReactor } & { [K: string]: Reactor | SystemReactor }` gave TS7006 (implicit `any`) on every handler parameter.
- **After the merge,** `TestAppTypes` and `TestActorTypesDrift` failed with "files.push needs ifAt". They now push through `h.push`.
- **`TestTemplateTypes` first run:** the blank template's `main.ts` failed with "error TS1375: 'await' expressions are only allowed at the top level of a file when that file is a module". Fixed with `moduleDetection: force` in `client.Tsconfigs`.
- **`gh pr edit`:** it failed on the Projects (classic) GraphQL deprecation; the REST API worked.

### What I learned
- **A module-typed page needs `moduleDetection: force`:** without it, TypeScript decides module-ness from imports and exports, which differs from how the browser loads `<script type="module">`. The fixture app had imports, so `TestAppTypes` could not catch this; the import-less template could.

### What warrants a second pair of eyes
- **The blank template's `db`** is typed `any` by `page.d.ts`, so its `d: { data(): Note }` annotation is the only typing there. This is the existing task to annotate the runtime's namespaces.

### What should be done in the future
- **Annotate `web/runtime`'s `db`, `user`, `comments` and `room`.**
- **Phase 2:** typed actions.

### Code review instructions
- **Read:**
  - `web/bench/src/model/templates.js`;
  - `web/bench/src/agent/guide.js`;
  - `pkg/host/apptypes_test.go` (`TestTemplateTypes`);
  - `pkg/apptypes/actor.d.ts` (`Reactors`);
  - `pkg/commands/files.go` (`FileChange.JSONSchema`).
- **Run:** `make runtime && go test -tags sqlite_fts5 ./pkg/host -run 'TestAppTypes|TestTemplateTypes' -count=1 -v`

## Step 10: Phase 1's last item, and phase 2: typed actions

The person asked me to continue ("ok, continue?"), and then mid-turn: "yeah just pile it all on #55 i think, we don't need all that many PRs and granularity". All of this went onto #55.

Two pieces of work:
- **Phase 1's last item:** `page.d.ts` no longer types the runtime's namespaces as `any`.
- **All of phase 2, typed actions:**
  - actions declare JSON Schemas for their arguments and results;
  - the server checks the arguments before `run`;
  - `actions.d.ts` gives pages typed calls;
  - `FromSchema` with `defineAction` types `run`;
  - the bench actor's 35 actions declare their arguments.

### Prompt Context
**User prompts (verbatim):** "ok, continue?"; then, mid-turn, "yeah just pile it all on #55 i think, we don't need all that many PRs and granularity".
**Assistant interpretation:** Finish phase 1, then do phase 2, all on #55. I saved the preference as a memory.
**Inferred user intent:** Progress with less PR overhead.
**Commits (on `task/slop3-024-types`):**
- 0d05a98: the runtime types;
- 0e62c9a: the `args` schemas and validation;
- 92ea520: `actions.d.ts`;
- acba8c7: `FromSchema` and `defineAction`, and the template;
- c988b4e: the bench actor.

### What I did
- **The runtime's types (`web/runtime`):**
  - `db.ts` declares `Db`, `DocumentReference<T>`, `CollectionReference<T>`, `Query<T>`, the snapshots, `WhereOp` and `Lease`. The result shapes come from the server's RPCs.
  - `caps.ts` declares `User`, `Viewer`, `UserProfile`, `Comments`, `Asset`, `BoundStore`, `StoreDoc`, `StoreFile` and `StoreListing`.
  - `room.ts` declares `Lobby`, `NamedRoom`, `RoomChannel`, `RoomMessage<T>` and `PeersChange`.
  - `sample.ts` declares `SampleLimits`.
- **Action schemas (`pkg/actor/argschema.go`):** `readSchema` and `compileSchema`, with `noLoader`, Draft 2020 and the vm's `JSON.stringify` to keep property order. `checkArgs` runs in `Manager.Call`; `describe` lists the failing places.
- **`ActionDecls` and `ActionsTypeScript`.** `app.types` gains `instance` and returns `actions.d.ts`; the client passes the dev instance.
- **`page.d.ts`:** a global `AppActions`, and `DefaultActions`.
- **`actor.d.ts`:** `JsonSchema`, `FromSchema` and `defineAction<const S, const RS>`. `sql.all<T>` and `sql.one<T>` are now generic. The runtime gets a `defineAction` global.
- **The actor template** uses `defineAction` with schemas. The guide presents the schemas as the contract.
- **The bench actor:** shared schema pieces (`S`, `args()`, `INSTANCE`), and `args` on all 35 actions.

### Why
- **`actions.d.ts` comes from a running actor:** the manager cannot read a snapshot's actor definition without running it. The dev instance runs `draft`, and `slop dev` refreshes the types just after it activates.
- **`defineAction`:** TypeScript would not infer each action's schema type through a mapped type over `defineActor`'s actions. I tried two shapes (t2, t3); `run`'s parameters came out `unknown` or fell back to the constraint. A generic helper per action, with `const` type parameters, infers the literal without `as const`.
- **The bench's free text is still cut to length, not refused:** callers send agent-written notes that are longer, and refusing them would change behaviour.
- **The bench's schemas allow extra properties:** I couldn't check every caller.
- **`if`/`then` is avoided:** the converter declares it as `unknown`, so those checks stay in code.

### What worked
- **`TestActionArgsSchema`:**
  - six wrong shapes are each refused with their place;
  - a schema'd action called without arguments gets `{}`;
  - a bad schema, a remote `$ref`, and a schema that isn't an object each break the version.
- **`TestActionsTypes`:** a JavaScript actor's page passes `tsc` with typed calls; a wrong argument and an unknown action are errors.
- **`TestBenchArgs`:** eight wrong shapes are refused with their place, and the bench's `actions.d.ts` passes `tsc`.
- **`TestTemplateTypes`:** the schema template runs on the server, and `tsc` passes both programs.
- **The suites:** the full suite passes, `golangci-lint` reports 0 issues, and the bench's Node tests pass (25), as do its Go tests.

### What didn't work
- **`describe` panicked:** `LocalizedString(nil)` crashed with a nil `*message.Printer` (golang.org/x/text). It now uses an English printer.
- **A test case:** a string `args` "just text" arrived as `{}`. `actor.call` reads a string `args` as JSON text (the CLI relies on that), so the test now uses a number.
- **The first `actions.d.ts`:**
  - Properties came out in the wrong order: `goja` `Export` and `json.Marshal` sort keys. Fixed with `JSON.stringify`.
  - `additionalProperties: false` declared an index signature: JSON-read `true`/`false` schemas are copies of invopop's `TrueSchema`/`FalseSchema`, not the same pointers. Fixed with `isTrue`/`isFalse` by value.
- **A test expectation:** `apps(args?: {})` was wrong; an object schema with no properties is `Record<string, unknown>`.

### What I learned
- **Contextual return types infer generics:** `sql.all<T>()` in `run` picks up `T` from the result schema's `FromSchema`, so no cast is needed.
- **TypeScript 5's `const` type parameters** make `FromSchema` usable on inline schemas.

### What was tricky to build
- **Per-action inference:**
  - **The obstacle:** the natural API, `defineActor({ actions: { add: { args, run } } })`, cannot type `run` from `args`, because inference through a mapped type over the actions does not reach a sibling property.
  - **What I tried:** two shapes, both failing in `tsc`.
  - **The fix:** a `defineAction` wrapper, which costs one identity global in the runtime.

### What warrants a second pair of eyes
- **The bench's call sites:** schemas now refuse what used to be coerced. The Go and Node bench tests pass, but I reviewed the page's call sites by reading, not by clicking through on staging.
- **Staleness of `actions.d.ts`:** it reflects whichever actor runs, so it's stale until the dev instance has activated the new draft.

### What should be done in the future
- **Phase 3:** checking in the bench (the checker worker and `types` in eval effects).
- **Deploy #55 to staging** after it merges, and click through the bench.

### Code review instructions
- **Read:**
  - `pkg/actor/argschema.go`;
  - `pkg/actor/types.go` (`ActionsTypeScript`);
  - `pkg/apptypes/actor.d.ts` (schemas section);
  - `web/runtime/src/types.ts` and `db.ts`;
  - `apps/bench/actor.js` (`S` and `args`).
- **Run:** `make runtime && go test -tags sqlite_fts5 ./pkg/host -run 'TestActionArgsSchema|TestActionsTypes|TestBenchArgs|TestTemplateTypes' -count=1 -v`

## Step 11: Phase 3, type checking in the bench

Phase 3 puts TypeScript's own checker into the bench, so the person and the agent see type errors while they work, not only when `slop types` and `tsc` run on a laptop. The checker runs in a worker of its own, built into `apps/bench/checker.js`. It checks an app the way `slop types` sets it up: two programs, the pages and the actor, against the declarations the server writes (`app.types`). Its results reach three places:
- each eval's effects, as the type errors it introduced and how many it fixed;
- the agent's `types.check()`;
- the Code view: gutter marks, a footer count that jumps to each error, and the type under the caret.

A browser smoke test of the built bench found one real bug: a fresh app's declarations were fetched before its dev instance existed, so `actions.d.ts` was empty and the template showed a false error. The declarations are now cached per version of the dev instance.

### Prompt Context
**User prompt (verbatim):** "what's left total? then do phase 3"
**Assistant interpretation:** List what remains of SLOP3-024, then implement phase 3 (design §6.2) on PR #55.
**Inferred user intent:** Finish the ticket's main line: TypeScript in the bench itself, so its agent and its person get the benefit of the types phases 1 and 2 produced.
**Commit (code):** a883762 — "SLOP3-024 phase 3: type checking in the bench"; 3be0f65 — "SLOP3-024 phase 3: the declarations follow the dev instance"

### What I did
- **`web/bench/src/checker/checker.js` (new): the worker.**
  - `plan()` builds two root sets and option sets:
    - pages: ES2022 + DOM, with `page.d.ts` and `actions.d.ts`;
    - actor: ES2020, with `actor.d.ts` and `modules.d.ts`.
    The options are the ones `client.Tsconfigs` writes, plus the app's JSX options and the vendored packages' `paths`.
  - Each program is a `ts.LanguageService` kept warm, through one `DocumentRegistry`.
  - Messages:
    - `check` returns `{diags}`;
    - `info` returns the type at a position;
    - `transpile` strips an eval's types: it wraps the code in `async function __slop_eval__() {…}`, then unwraps it.
- **`web/bench/build.mjs`:** bundles TypeScript 5.9.3 into `checker.js`.
  - The lib files are inlined as `__TS_LIBS__`: the closure of `es2022`, `dom`, `dom.iterable`, `es2020` and `es2022.full`, following `/// <reference lib>`.
  - Node built-ins are stubbed.
  - The output is minified: 6.0 MB raw, 1.35 MB gzipped.
- **`web/bench/src/agent/types.js` (new):** the page's side.
  - It spawns the worker; `post(msg, ms)` times out to `{skipped}`.
  - `declarations(P)` comes from the bench actor's new `types` action.
  - `check`, `info`, `transpile`, and `diff(before, after)`, keyed on file, code and message, so an error that only moved lines is the same error.
- **`agent/eval.js`:** checks before the eval (in parallel with the run) and after its commit, then sets `effects.types = {new, fixed, total} | {skipped}`. The effects line shows it.
- **The agent:**
  - `agent/api/types.js`: `types.check({file})` (a long call).
  - `agent/agent.js`: the eval tool takes `ts: true` and transpiles before running.
  - `agent/guide.js`: what the type effects mean, and that the agent fixes the errors it introduced.
- **The person's side:**
  - `ui/code.js`: `typeView` (the person's unsaved edits included), `typesSoon`, `infoSoon`, the gutter class `terr`, and the footer's count and jump menu.
  - `ui/app.js`: warms the checker when a TypeScript project opens.
- **The server side:**
  - `apps/bench/actor.js`: a `types` action.
  - `pkg/doors/actors/modworkshop.go`: `{JS: "types", Verb: "app.types", Pos: ["app"]}`.
- **Tests:**
  - `web/bench/test/types.test.mjs` (4 tests): runs the built `checker.js` in a `vm` against the TypeScript fixture app.
  - `TestBenchArgs`: covers the `types` action.
  - `buildstamp_test.go`: includes `checker.js`.
- **3be0f65:**
  - The declarations are cached per app and per `devKey(status)`. The status reaches `Types` through a hook the shell sets (`Types.status`), so `agent/types.js` keeps no import of `server/instances.js`, which touches `addEventListener` and broke the Node test.
  - The Code view re-checks when the dev instance's version changes.

### Why
- **A worker of its own:** the QuickJS sandbox is restarted when an eval overruns, and a restart must not throw away a checker that takes about a second to warm.
- **The real TypeScript, not a subset:** the declarations from phases 1 and 2 (`FromSchema`, `defineAction`, the generated `actions.d.ts`) need the real checker to mean anything.
- **Informative only:** checking a commit too would make TypeScript a gate, which the design rejects (§6.2). Results inform and never fail anything.

### What worked
- The full Go suite, 0 lint issues, and 29 bench Node tests pass at a883762.
- In Node, a cold check took 505 ms and a warm one about 20 ms. The planted page and actor errors are found.
- **Browser smoke** (`$J/smoke/smoke.mjs`, Playwright against a local server built from a883762):
  - Before 3be0f65, a fresh "Page and actor" app showed `'rows' is of type 'unknown'` on `main.ts`.
  - After 3be0f65 the footer says "types ok". Planting `{ txt: input.value }` gives one error, on line 21: "Object literal may only specify known properties, but 'txt' does not exist in type '{ text: string; }'".

### What didn't work
- `node tools/imports.mjs`: `checker/checker.js: not in a layer`. It is added to `SKIP`, since it is a worker entry, not a page module.
- The vm test's `assert.deepEqual` failed across realms: objects from the vm's context are not `Object.prototype` objects of the test's realm. The results are copied out through JSON.
- My transpile comment claimed that lines keep their numbers. They don't when an interface line drops out, so the comment now says so.
- First smoke attempt: no frame had `__SB`. The live host's bench page asks you to sign in through a link first. The smoke now follows it.
- 3be0f65, first try: `ReferenceError: addEventListener is not defined` in `types.test.mjs`. `agent/types.js` imported `Watch` from `server/instances.js`, which registers a visibility listener at load. The fix is the `Types.status` hook.

### What I learned
- `actions.d.ts` depends on a running instance's actor, not on the files: it is what the instance's `defineActor` registered. Anything that caches it must key on the instance's version.

### What was tricky to build
- **Unwrapping the transpiled eval:** an eval body has top-level `await` and `return`, so it can't be compiled as a module. It is wrapped in an async function, compiled, and unwrapped by taking the text between the first `{\n` and the last `}`. The result is checked to start with the wrapper's name, or the transpile fails rather than guessing.
- **Libs in a worker:** TypeScript asks for libs by file name. The build follows `/// <reference lib>` from the five roots to inline exactly what the two programs reference.

### What warrants a second pair of eyes
- `checker.js` is 6 MB in the bench store. It is fetched only for TypeScript apps, but it's in every bench install.
- `Types.diff` keys errors on (file, code, message). Two identical errors in one file count as two, and fixing one of them leaves one.

### What should be done in the future
- Point the checker at a proposal's own declarations. Done in Step 12 (a persona review found it).

### Code review instructions
- Start at `web/bench/src/agent/types.js` and `web/bench/src/checker/checker.js`, then the `effects.types` lines in `agent/eval.js`.
- Validate:
  - `cd web/bench && node build.mjs && node --test test/*.test.mjs`
  - `GOWORK=off go test -tags sqlite_fts5 ./pkg/host -run 'TestBench|TestBuildOutputsFresh'`

### Technical details
- Worker protocol, each message answered with `{id, ok, …}`:
  - `{type:'check', files, decl}` → `{diags:[{file,line,col,code,message,program}], ms}`
  - `{type:'info', files, decl, path, pos}` → `{text, doc}`
  - `{type:'transpile', code}` → `{code}`
- At most 200 diagnostics; messages are cut at 600 characters.

## Step 12: Persona reviews of the bench: the harness, round 1, and what it found

The person asked for model-played personas to actually build apps in the bench. The harness:
- **benchdrive** (built by a subagent): a daemon holding a headless Chromium, which a persona drives from the shell;
- **one pi process per persona**: `lunaroute/deepseek-4.1-flash` at thinking medium, with the persona prompt and a brief;
- **a runner** (`scripts/05-cosplay/run.sh`).

Round 1 had four personas on a server built from 3be0f65, with the bench's own agent on the same model:
- Maya, a baker who doesn't code, wanted a bread preorder page;
- Devon, a TypeScript developer, wanted a kanban board;
- Priya, a teacher, wanted a leaderboard added to an existing quiz app;
- Sam, an operations lead, wanted a shipments dashboard with tests.

Priya got what she wanted. Sam got nearly all of it; Maya and Devon got part of it. Together they logged 53 struggles.

Most struggles were fixable, and while the round ran I fixed them in the worktree in five commits (ab4ca68, 5a157d1, 5d0e593, a033d65, 9cbe08a). Two are bugs that no test had caught:
- **A phase-3 bug:** a proposal was type-checked against draft's actor, so it showed "types ok" over a call to an action that no longer existed.
- **A server bug:** after an instance reset, its actor kept the deleted store's closed SQL connection, so every scenario ran once and then failed.

### Prompt Context
**User prompts (verbatim):**
- "make sure to actually use cosplay subagents against the bench application and have them build different applications, you can use the pi coding agent and the lunaroute deepseek-4.1-flash thinking medium agent."
- "write a playbook on using cosplayed persona based review where we have different personas that want to use bench to create or modify applications, so that we can learn from their struggles."
- "run the whole spiel a couple of times, makng adjustments at each iteration (without losing the plot, obv), you can switch to glm-5.3 or glm-5.3-flash or different thinking levels as well, depending on how things go. it's good to cover a wide range of scenarios, and lunaroute doesn't cost us anything!"
- Mid-turn: "alright i'm going swimming. make this fucking sick. .If things are going well, have the personas get more ambitious, or provide them with messier "legacy" code or so."
- "commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
- "Keep a very detiled diary and also keep the transcripts available and such"
- "also take screenshots for the reports you make me, i would like to be able to browse the sessions people did in the browser and see how the app evolved"
- "anyway keep on rocking, lunaroute is free, we can have up to 6 concurrent, but we get 429 throttled anyway so feel free to maxx"
- "write a little server to allow me to browse the persona cosplay transcripts"

**Assistant interpretation:**
- Run several rounds of personas building and changing apps in the bench through pi on lunaroute models.
- Fix what they find between rounds, on #55.
- Make the rounds harder as they go.
- Keep every transcript, diary and screenshot.
- Give the person a way to browse them.

**Inferred user intent:** Learn what it is like to use the bench from people unlike its developers, and turn that into fixes, with evidence the person can look through later.

**Commit (code):**
- ab4ca68 — "SLOP3-024: fixes from the first persona review of the bench"
- 5a157d1 — "SLOP3-024: scenario checks for numbers; type errors in the header; guide"
- 5d0e593 — "SLOP3-024: a deleted store's actor lets go; scenario steps checked strictly"
- a033d65 — "SLOP3-024: after a publish, the bench shows the app's web address"
- 9cbe08a — "SLOP3-024: fix the bench's boot (Prefs, not Records); honest new scenarios; guide"

### What I did
- **The harness:**
  - **benchdrive** (`$J/bd/benchdrive`, built by a subagent with its own diary at `$J/bd/DIARY.md`). Its commands: `look`, `ask`, `click`, `type`, `key`, `new-app`, `open-app`, `view`, `frame-text`, `frame-click`, `frame-type`, `shot`, `wait`, `close`. Each prints what the page renders, as text.
  - **`scripts/05-cosplay/persona-prompt.md`:** stay in character; a diary with `STRUGGLE:` lines and a `## Verdict`; a budget of commands.
  - **The briefs:** `personas/{maya,devon,priya,sam}.md`.
  - **`fixtures/quiz`:** Priya's existing app, pushed to the server before the round.
  - **`run.sh`:** one pi per persona, with `--no-extensions -e <the lunaroute extension>` and only the bash, read, write and edit tools.
- **The review server:** port 18494, `$J/rev3`, `--local`. The CLI is signed in through a device login approved by a Playwright script. benchdrive's daemon is on 18498.
- **Round 1:** `$J/rounds/r1b`, started 03:01 UTC; all four exited 0 by 03:20.
  - I watched each diary's steps and struggles through a monitor.
  - I wrote the findings into `$J/rounds/findings.md` as they came in, and fixed them in the worktree. The server stayed on one build for the whole round.
- **Fixes, by commit:**
  - **ab4ca68:**
    - The `types` action takes a ref and reads `actions.d.ts` from the proposal's own instance, falling back to dev, then the app. The page caches declarations per (app, ref, that instance's version).
    - gepp asks a model that ended silently after using tools for its reply, once and without tools.
    - The bench writes a summary from the evals when a turn still has no reply.
    - The proposal line explains itself, with Show it, Review and Accept.
    - A turn that changed nothing says so, instead of `"<your message>" was discarded`.
    - The Data view follows the workspace into a proposal's preview.
    - Template names in plain words; the profile scope in the server-code template, so lists show names.
    - Guide lines: plain words; don't shadow API names.
  - **5a157d1:**
    - Scenario `{text, exact: true}` and `{match}`.
    - The header counts type errors, and its menu lists them.
    - New files start with an empty name.
    - Guide: leave no testing debris; page first; tell the person what they need; answer questions about the bench.
  - **5d0e593:**
    - `Kernel.OnDeleted`, called by `DeleteStore`; the manager sets it to `Restart`.
    - Scenario steps reject keys their kind doesn't take.
    - `{sql, value}` and `{sql, rows}`.
  - **a033d65:** `workshop.mounts` (`mount.ls`), the bench's `addresses` action, the publish dialog's "Your app is live at …", and the agent's `app.addresses()`.
  - **9cbe08a:**
    - The boot fix (Prefs).
    - New scenario stubs fail until they check something.
    - Guide: test data goes in the test instance; show each scenario failing once; keep README.md true.
- **Tests added:**
  - `TestBenchTypesFollowRef`, `TestBenchResetRestartsTheActor`, `TestBenchAddresses` (pkg/host);
  - `TestSilentEndAsksForAReply` (gepp);
  - `expect: text contains, exact and match` and `checkScenario: unknown step keys` (bench Node tests).
- **The transcript browser:** `scripts/05-cosplay/browse.mjs` (`node browse.mjs <rounds dir> --port 18600`). It shows rounds, personas, a timeline that interleaves the pi session with benchdrive's recorded steps and their screenshots, the diary, and a gallery.
- **benchdrive, between rounds:**
  - With `BENCHDRIVE_RECORD` (sent by each client, set by `run.sh`), every command goes to `<round>/<persona>/steps.jsonl` with a JPEG of the bench.
  - `new-app <id>` without a template lists the templates.
  - Dialog fields are named `dialog`, `dialog2`, … and `type` accepts them.
  - `edit <old> <new>` changes the open file the way a person would: select the text, then type over it.
  - `look` and `click` see the shell's dialogs.
- **Round 1's material** went to `various/persona-review-2026-11-17/r1/` after a scan for `k_` tokens and bearer tokens (none found): diaries, `pi.out`, pi session JSONL, the personas' own screenshots, and the benchdrive log.

### Why
- **Fixing during the round, on a server that stays on one build:** a round's findings stay comparable, and the next round tests the fixes.
- **The silent model, fixed in gepp rather than the bench:** an `empty_completion` error loses the turn's work from the person's view. Asking once more without tools gives the model's own account, and is cheaper than replaying.

### What worked
- **The personas found real bugs, not just usability notes:**
  - Devon read his proposal's `main.ts`, saw it call `slop.actions.list`, and saw that the actor had no `list` while the footer said "types ok" (round 1, devon step 5).
  - Sam's agent reported "sql: connection is already closed" from the test instance. I reproduced it with the CLI:
    ```
    $ slop actor call tsmoke2-test-1082d4 list --args '{}'
    error: actor_error: sql: connection is already closed
    ```
    This happened after `bench reset` and `bench instance`.
  - `TestBenchResetRestartsTheActor` fails without the `OnDeleted` hook and passes with it. I checked by commenting the hook out and rerunning.
- **The verdicts:**
  - Priya: yes ("The quiz is live (quiz @9)…").
  - Sam: "Partly — nearly all of it".
  - Maya: partly ("What I did not get is the plain web address").
  - Devon: partly.
- **Final suite:** pkg/host, pkg/llm/gepp and the bench's 31 Node tests pass. The boot smoke passes after 9cbe08a.

### What didn't work
- **The first launch** (`$J/rounds/r1`): every persona exited 1 with `No API key found for lunaroute.` `--no-extensions` had dropped the lunaroute provider extension. The fix is `--no-extensions -e ~/.pi/agent/npm/node_modules/@lunaroute/pi-extension` (tested with a "pong" prompt).
- **CLI calls with variables in one string** (`E="SLOP_CREDENTIALS=… SLOP_SERVER=…"; env $E slop …`) all failed with `error: no server`. zsh doesn't split `$E`; the variables have to be written inline.
- **benchdrive's subagent restarted its own server and daemon** after I had stopped them (I had moved the review to a newer build). I told it to stand down and stopped them again.
- **The boot bug, my own:** ab4ca68 used `Records.get`/`Records.set`, but the per-person settings object is `Prefs`. The bench failed to start: `TypeError: Records.get is not a function at Object.openProject`. I found it with a benchdrive probe before round 2, and fixed it in 9cbe08a. The broken commit had never been pushed.
- **The round-2 monitor's first try** exited at once: zsh's `nomatch` on an empty `$R/*/` glob. It runs under bash with `nullglob` now.
- **`TestBenchAddresses`'s first assertion** expected `"/jot","kind":"live"`, but the JSON orders `kind` before `url`.

### What I learned
- A persona's struggle often has a bench cause and an agent cause. Priya's "Submit does nothing" was the score appearing below the fold of a 375×720 frame, plus an agent that never said so.
- **The proposal flow is the biggest barrier for people who don't code.** All three non-programmers met it before anything else. The default target is a proposal, and nothing told them to look at it and accept it.
- **The bench's agent on deepseek-4.1-flash often ends a turn without a word** (maya steps 3, 5, 10; devon 6; sam 6). Every bench-side fix for that is a workaround for the model.

### What was tricky to build
- **The proposal's declarations.** A proposal's preview instance is created on first use, so it may not exist when the Code view checks. The `types` action falls back from the proposal's instance to the dev instance to the app store, so the checker always has some declarations. The cache key includes the ref and that instance's version from the polled status (`status.props[].n`), so the check redoes itself when the proposal's instance comes up on new code.
- **The deleted store's actor.** `DeleteStore` closes the store, but the actor manager's map still held the actor built over it. The next store with the same id got the old actor, and its `sql` module held the old `*sql.Conn` (`store.go:58`). `OnDeleted` is called after the close and before the directory is removed, and `Manager.Restart` drops the actor and its broken mark.

### What warrants a second pair of eyes
- **`Kernel.OnDeleted`** is called while the kernel's map lock is released. Something could reopen the store between the close and the call; check whether that matters for `Restart`.
- **The gepp nudge** adds a user message that says it comes from the system. A model may quote it to the person.

### What should be done in the future
- **A bench boot test in CI.** The boot bug would have shipped without the smoke run.
- **The shell's Share button** shares the bench, not the person's app. Maya expected the latter.
- **Mounting from the bench** (an admin action) is a governance decision for the person. The bench now only shows existing addresses.

### Code review instructions
- **Start with:**
  - `apps/bench/actor.js` (`types`, `addresses`);
  - `web/bench/src/agent/types.js` (`devKey`, `declarations`);
  - `pkg/kernel/kernel.go` (`OnDeleted`);
  - `pkg/llm/gepp/sample.go` (`nudgeReply`);
  - `web/bench/src/core/scenario.js` (`STEP_KEYS`).
- **Validate:**
  - `GOWORK=off go test -tags sqlite_fts5 ./pkg/host -run 'TestBench' && GOWORK=off go test ./pkg/llm/gepp`
  - `cd web/bench && node --test test/*.test.mjs`
- **Browse the round:** `node scripts/05-cosplay/browse.mjs various/persona-review-2026-11-17 --port 18600`.

### Technical details
- **Round 1:** 4 personas; 53 `STRUGGLE:` lines (maya 15, devon 11, priya 13, sam 14).
- **The findings list:** `various/persona-review-2026-11-17/findings.md`.
- **Persona exit times:** devon 22:15:00, priya 22:15:06, maya 22:18:20, sam 22:20:49 (local time).

## Step 13: Round 2: six personas, harder goals and a legacy app; what they found

Round 2 ran six personas on the bench from 9cbe08a, with the round-1 fixes. The bench's own agent moved to glm-5.3, and the personas' models were mixed:

| Persona | Model, thinking | Goal |
|---|---|---|
| Maya | glm-5.3-flash, medium | rerun: the bakery preorder page |
| Devon | glm-5.3, high | rerun: the TypeScript kanban |
| Sam | deepseek-4.1-flash, medium | rerun: the shipments dashboard |
| Rosa (new) | glm-5.3, medium | inherits the legacy inventory app |
| Kenji (new) | deepseek-4.1-flash, high | a live meetup poll |
| Aisha (new) | glm-5.3-flash, medium | shift sign-ups with a waitlist and a privacy rule |

Rosa's app has deliberately messy code: globals, inline `onclick`, quantities and prices stored as text, actions without schemas, and a planted bug (`toFixed(2)` returns a string, so the total concatenates: "0179.8819.50").

Five personas answered "yes" (Maya, Devon, Rosa, Kenji, Aisha), where round 1 had one. The struggle counts were maya 6, devon 7, rosa 8, kenji 9, aisha 1, and Sam 6 so far; Sam was still running when this was written.

The round found four more bugs in the bench and the sample backend that no test had caught, and I fixed them during the round. Eleven commits, 29f2eb7..c4f7117, all with tests where a test could reach them.

### Prompt Context
**User prompts (verbatim):** see Step 12. Also, mid-round: "how are things going?" (answered with a status report).
**Assistant interpretation:** Continue the rounds, harder each time, fixing between and during them; keep the diary and transcripts.
**Inferred user intent:** As in Step 12.
**Commit (code):**
- 29f2eb7 — Select mode says how to press a button (Play)
- 3fe5457 — a tool call written as text is retried; proposals say their data stays
- 23ebd79 — the bench tells a member that only admins create apps
- 8185257 — fix the eval session's rewrite (ASI); name the line in "not a function"
- 7cd102f — app.reset asks first; the guide forbids reset as cleanup
- 7e465da — Review takes a file in or out only by its checkbox; partial accepts ask; seeds reload
- 28c9c3b — the guide: say only what the effects show
- cd978d0 — delete one row of an instance's data (workshop.exec, the Data view, app.exec)
- 8a68886 — scenario text checks read whole texts; an over-budget turn replies
- a78152c — the guide: live updates through room moments or onSnapshot, not polling
- c4f7117 — an administrator gives a published app its web address from the bench

### What I did
- **Before the round:**
  - Rebuilt the server: `OnDeleted`, the gepp nudge, `workshop.mounts`.
  - Set the tiers to glm-5.3 (quick: glm-5.3-flash at low; default: glm-5.3 at medium; complex: glm-5.3 at high), and restarted the server and the daemon.
  - Pushed the bench and the `inventory` fixture.
  - Probed with benchdrive, which found the boot bug (Step 12).
  - Launched with `run.sh` (round.json, recording on).
- **During the round:**
  - Watched struggles through a monitor.
  - For each surprising one, read the persona's recorded steps (`steps.jsonl`) and screenshot, the agent's thread (`smoke/thread-errors.mjs` reads the failed eval steps through `__SB` without touching the persona's tab), or reproduced it with a probe persona on an app of its own.
- **Three findings, reproduced:**
  - **The eval session's rewrite (Aisha's agent failed five evals with `TypeError: not a function (line 2)`).** Reproduced with the exact code in the Eval view, then read `rewrite()` in `worker/worker.js`:
    - A top-level `const [ih, css] = await Promise.all(…)` becomes `([ih, css] = …)`.
    - After `const mt = await files.read('main.ts')` with no semicolon, that line continues the previous one as a call, `files.read('main.ts')(…)`.
    - The removed keyword is now `;`.
    - The rewrite moved to `worker/rewrite.js` so a Node test can run it; on the old rewrite the test fails with `TypeError: read(...) is not a function`.
  - **glm-5.3 writes tool calls as text** (Maya's turn ended with `<tool_call>eval … </tool_call>` as its reply). gepp now tells the model and runs the round again, at most twice (`TestToolCallAsTextIsRetried`).
  - **Review's file names unticked their files** (Devon: "Accept 9" dropped `actor.ts`, and the draft broke with "no such table: items"). The name was inside the checkbox's `<label>`. Now:
    - only the checkbox includes or excludes a file;
    - a partial accept asks first, naming what will be discarded;
    - the button says "Accept 9 of 10".
- **Other fixes:**
  - **Scenarios' text checks** read `info().text`, cut at 120 characters. The probe now has `texts()`, and older probes fall back.
  - **"exceeds local context budget"** now gives one last round without tools to reply (`TestOverBudgetTurnReplies`).
  - **`app.reset` shows an approval card.** Two agents had wiped the person's data to "clean up".
  - **Deleting single rows:** `workshop.exec` (with drop's rule, now shared as `unpublished`), the Data view's ✕ per row, and `app.exec`.
  - **Seeds reload the dev frames.**
  - **The publish dialog** offers "Give it a web address" to admins: `workshop.mountApp`, which mounts `/<app>` on the first live host, is idempotent and refuses a taken path; `TestBenchPutOnline`.
  - **The `me` action:** the New app dialog tells members that only admins build (D9).
  - **The guide:**
    - say only what effects show;
    - remove test rows with `app.exec`, never by a reset;
    - live updates through `room.emit`/`room.on` with the topic declared, or `onSnapshot`, never polling.
- **For round 3, not yet live:**
  - **benchdrive:**
    - `read` and `edit`;
    - `type code` needs `--replace`;
    - dialogs are accepted and reported;
    - `ask` returns after 150 s and `wait` follows the turn;
    - `frame-type` picks `<select>` options and reports hidden fields;
    - per-persona accounts.
  - **New personas (Lena, Theo, Grace)** and the `members` fixture (document database, duplicates).
  - **`boot-smoke.mjs`.**
  - **`design-doc/02-proposal-frames-as-different-people.md`.**
- **A member's account:** opening the bench needed `slop grant set bench @member interact` and `slop policy set bench sample @member on` on the review server, and then Create failed: "only admins change app code (this store holds app.json; decision D9)".

### Why
- **Fixing while personas ran without redeploying** kept round 2 on one build. The same personas on round 3 test the fixes.
- **`mountApp` and not `mount.set` in the workshop:** the bench gets one narrow action (its own app, `/<app>`, the first live host, never over another store), and `mount.set`'s admin rule still decides who.

### What worked
- **The verdicts.** For example:
  - Devon: "I proved it by hand-editing a call site to `column: 'oops'` and getting `Type '"oops"' is not assignable to type '"todo" | "doing" | "done"'`. The bench type-checks every edit, mine included."
  - Rosa: "all three of the owner's complaints are fixed, the data survived, and the fix is published … proven by a permanent scenario test that cross-checks the page against SQL's SUM(Qty*Prc)."
  - Aisha: "All four rules I asked for work and I tested each one by hand."
- **The recording:** 658 commands recorded with 462 screenshots. The transcript browser shows each persona's session with the bench after each command.
- **Tests:** the full Go suite and lint pass, and the 33 bench Node tests pass at c4f7117. CI was green on 0e3977b.

### What didn't work
- **The member probe:** "You do not have access to this." at the bench until the grant; then "only admins change app code (… decision D9)" from Create.
- **The persona shell's command timeout.** pi's bash tool gives up after 180 s, and the old daemon's `ask` waits up to 15 minutes. Devon's and Kenji's next commands queued behind running turns: Devon at 03:29 with "Command timed out after 180 seconds"; Sam's `ask` took 777928 ms.
- **The 120-character text check** made Sam's agent conclude "plain text checks only reach roughly the top ~1,000 characters". Its guess at the limit was wrong, but the conclusion that checks missed rows was right.
- **My own mistakes:**
  - A `sed` that put an unescaped `'` into `agent/api/app.js`. The build failed, but `node build.mjs | tail -1` hid it, and the commit went in; I amended it before pushing. Build chains now use `set -o pipefail`.
  - Two commits left the rebuilt `pkg/doors/pages/assets/probe.js` unstaged, so CI's `TestBuildOutputsFresh` failed ("probe.js is stale"). Fixed in 0e3977b; I now stage `apps pkg web` and check `git status` after each commit.
  - My first members fixture used a document API that doesn't exist (`collection.add`, `count`, `all`).
  - My first round-2 monitor died on zsh's `nomatch`.

### What I learned
- **The same few barriers recur across personas and models:**
  - proposals (every non-programmer);
  - Select versus Play (Priya, Maya, Kenji);
  - "where is my link" (Maya twice, Aisha, Kenji);
  - long silent turns.
- **The model shapes the bugs found.** glm-5.3 writes without semicolons, which surfaced the rewrite bug, and writes tool calls as text; deepseek ends turns silently. Rotating models finds different classes of bugs.
- **Frames as one person is now the main gap** for multi-person apps (Kenji's two voters, Aisha's privacy check). That's a server design decision, so it's a proposal (design-doc/02), not built.

### What was tricky to build
- **The rewrite fix.** Replacing `const` with `;` is safe in all three rewritten forms (identifier, destructuring, class), and keeps line numbers. A leading `;` is an empty statement even at the start of the code, and the error lines still match the person's code.
- **The over-budget round.** It is allowed only after round 0 and only once, within a 160 KiB allowance, so a single huge first prompt still fails as before.
- **`mountApp`'s guards.** It checks that the store is an app (`App == Store`), that main exists, that there's a live host, and that the path is free; the same mount again returns `existed: true`.

### What warrants a second pair of eyes
- **`workshop.exec`** lets the bench write SQL on instances of unpublished code as the visitor. The `unpublished` rule is drop's, but writes are new, and admin-only through `sql.exec`.
- **`workshop.mountApp`** expands what a trusted workshop app can do. It is scoped to its own app's `/<app>` path, but it is still a platform-level change.
- **The gepp nudges** (silent end, text calls, over budget) add messages marked "From the system, not the person"; check they can't loop. Each has a counter or a flag.

### What should be done in the future
- A decision on design-doc/02 (frames as different people).
- Progress text during long turns, so a person doesn't watch "Working" for 13 minutes.
- Round 3, with the fixes and the new harness live.

### Code review instructions
- **Start with:**
  - `web/bench/src/worker/rewrite.js`;
  - `pkg/llm/gepp/sample.go` (`nudgeTextCall`, `nudgeFull`, `wrapped`);
  - `pkg/doors/actors/modworkshop.go` (`unpublished`, `exec`, `mountApp`);
  - `web/bench/src/ui/review.js` (`accept`);
  - `web/bench/src/frames/scenarios.js` (`expectStep`).
- **Validate:**
  - `GOWORK=off go test -tags sqlite_fts5 ./pkg/host -run 'TestBench|TestWorkshopDevInstances'`
  - `GOWORK=off go test ./pkg/llm/gepp`
  - `cd web/bench && node --test test/*.test.mjs`

### Technical details
- **Round 2:** started 03:28:35 UTC; Devon, Maya, Aisha, Rosa and Kenji exited 0 at 03:50–04:13 UTC.
- **The archive:** `various/persona-review-2026-11-17/r2/`, with screenshots shrunk to 1120 px at JPEG quality 55 (the originals were 66 MB).

## Step 14: Round 3: a visual persona, a credentials leak in the harness, and the agent's API from its own evals

Round 3 ran six personas on the bench from c4f7117, with the round-2 fixes live. It added a persona who works only by eye (screenshots and pointer commands on deepseek-4.1-flash), and three harder goals:
- a security review of the legacy inventory app;
- a messy document-database member list;
- charts with an npm library.

Five of the six said "yes". Lena timed out (exit 124) after her chart worked and her questions were answered, without writing a verdict.

The round also exposed a serious harness leak: a persona reached the operator's own `slop` CLI. Midway, the user asked me to "focus on improving the agent's JS API and documentation too". Mining the bench agent's own evals then found the biggest single problem of the review so far: a server limit that cut 60 of 97 turns at exactly 9 evals.

### Prompt Context
**User prompts (verbatim):**
- "do you think in addition to benchdrive we should try playwright as well, to see if we maybe missed something?"
- "use deepseek-4.1-flash for vision, not glm-5.3-vision which is bolted on vision" (said twice)
- "how far are we?"
- "focus on improving the agent's JS API and documentation too, not just what user experience"

**Assistant interpretation:**
- **Playwright:** add what benchdrive's text view hides. That meant a persona that sees only pixels, plus my own visual audit in a real browser.
- **The API request:** the agent's API matters as much as the UI. Find evidence of where the API misleads the agent, and fix it.

**Inferred user intent:** cover the bench from every side (people, pixels, the agent itself), and keep improving between rounds.

**Commit (code):**
- db44437 — a narrow Code view gives an open file the whole width
- 3a9d472 — the guide: no `slop vendor` for a person who only has the bench
- cd9e57c, 261ade7 — the publish dialog in plain words; a 900 px header fits (and keeps the agent pill)
- 9205fd7 — a running reply says how long it has worked and on what
- 8d1d809 — New app and Import come first in the app menu
- d602552 — a frame on a page's #route is not "(missing)"
- fa3268d — a new app's page says it is a starting point
- f856b2c — the agent knows the person's local date and time zone
- f48c5d5 — stale scenario results lose their marks; seeding offers to replace
- c182885 — the agent's API from its own failures: return shapes, clear refusals, selectors
- 50481c3 — fix lib.def ("collectPattern is not defined"), a regression of mine
- e8575e7 — a turn continues past one model call's 9 evals, up to its budget
- db8701c — documents as a table in the Data view; Accept is a button in the chat
- eebd686 — files.lines says it returns one string

**Docs commits on main:** 5c26c20 (playbook: visual personas, the CLI shim, resuming, redaction), e0b577f (analysis/03 and the mining scripts), and this step.

### What I did
- **Round 3 setup:**
  - Rebuilt the server at c4f7117 and pushed the bench (rev 1455); the boot smoke passed.
  - Added `see`, `click-at`, `dblclick-at`, `drag`, `scroll-at`, `keys` and `pause` to benchdrive. The daemon refuses any other command to a persona named `*-visual`.
  - Launched maya-visual (deepseek, medium), theo (glm-5.3, high, on inventory2), grace (deepseek, on members), lena (glm-5.3-flash), kenji (deepseek, high) and sam (glm-5.3).
- **Theo's first start** died on lunaroute's "the upstream stream failed before completion" after 38 commands. I resumed his pi session with `--continue` (now `resume.sh`).
- **The leak:**
  - What happened: Lena's diary said "my slop login (default server) shows no lena-charts store". She had run the operator's real `slop` CLI from her bash tool: `whoami`, `store ls`, `app ls`, help, and an `import` that failed with not_found. The output of `whoami` (name, email, user id) and the store list went into her transcript, and through it to the persona's model provider. No token was printed, and nothing was written.
  - The fix: a `slop` shim first on PATH, with `SLOP_SERVER` and `SLOP_CREDENTIALS` pointing nowhere. I stopped all six personas, resumed them with the shim, and checked each pi's environment (`/proc/<pid>/environ`: PATH[0] is the shim).
  - The archive: `redact.py` replaces the CLI outputs (15) and masks the operator's identity. I checked it on a copy before using it on the archive.
- **My visual audit** with Playwright, at 1600×1000, 1280×800 and 900×900, light and dark, on a second bench (`benchnext`, a bench store mounted at `/benchnext`) so the personas' bench stayed unchanged. It found:
  - at laptop width the Code editor was 180 px by 12 lines: a 480 px container rule came before the base rule and never applied;
  - the 900 px header overflowed;
  - the Publish dialog was in jargon.
  My first header fix hid the agent's Working/Idle pill (it shares `hide-s`); a re-audit caught it.
- **Maya-visual** found what no text persona had: "New app…" below twenty apps, out of sight. Her screenshots first landed in the operator's repo checkout, because `see` didn't resolve its path in the client. I moved them out and fixed the client.
- **The agent's evals:**
  - `scripts/06-api-mining/mine.mjs` reads every eval step of the apps' threads through the bench in a headless browser: 520 steps from rounds 1–2, 250 from round 3.
  - `analyze.py` groups the failures by message with the failing line, and counts evals per turn.
  - The fixes are listed in analysis/03. Each was checked through the Eval view on `benchnext`, and the turn continuation with a real 12-eval request: 15 evals in one turn.

### Why
- **Fix the API, not the guide.** Every mined failure was a mismatch between what a call did and what its reference said or implied. A rule in the guide would have to be remembered; a return shape in the reference, or an eval refused with its reason, needs nothing.
- **Continue turns in the bench rather than raise the server's 10-round limit.** The limit bounds the cost of any page's single call. The bench already had its own turn budget of 30 evals; it just never used it.
- **A second bench store** let me look at fixes in a real browser mid-round without changing what the personas were testing.

### What worked
- **The verdicts:**
  - Theo: "Two real vulnerabilities found, both fixed minimally (no rewrite), each with proof that fails without the fix".
  - Grace: "12 rows down to 9 real gardeners, no one lost and no payment lost".
  - Sam: "every number on the page had a SELECT behind it".
  - Kenji's live poll pushes updates through room moments, as the round-2 guide line said.
- **The visual persona on deepseek-4.1-flash** read its screenshots reliably and found layout problems the text harness can't see.
- **Mining** turned "the agent was slow and stopped" into one number: 60 of 97 turns ended at 9 evals.
- **Tests:** 36 Node tests pass, the Go host tests pass, and `TestTemplateTypes` passes with the new starter note.

### What didn't work
- **The CLI leak** (above): the persona prompt said to use only benchdrive, but a prompt is not a boundary.
- **My own regression:** `collectPattern is not defined` broke every `lib.def` in the deployed round-3 bench. I had moved `rewrite()` with its helper and missed that `lib.def`'s checker in `worker.js` used it too. The build's import check doesn't catch undefined calls, and no test covered `lib.def`. Mining found it, not a person.
- **Interruptions:** restarting the personas for the shim cut one ask in flight. Theo and Grace logged "command aborted"; those are harness artifacts.
- **Lena timed out** (3300 s) before her verdict.
- **Script and shell slips:**
  - zsh's word splitting broke a two-fixture push loop.
  - `benchdrive stop` stopped the whole daemon when I meant to tidy up a probe.
  - My first end-to-end script read the oldest result card instead of the newest.

### What I learned
- **Text and pixels find different bugs.** Three rounds of text personas never noticed a menu item out of sight. One visual persona found it in ten minutes.
- **An agent's evals are a better API review than the agent's replies.** The replies explained around the failures; the steps showed them.
- **A shared limit can hide behind a local one.** The bench's budget said 30, and the server said 10 rounds. Nobody saw both until the per-turn counts showed a spike at 9.

### What was tricky to build
- **The continuation** had to keep the reply text across calls, give the model what it did (its evals, rendered as in history) and say how much budget is left. It stops after two continuations, and when a call made fewer than 9 evals, so a turn that ends by itself is never continued.
- **The selector parser** handles `:has-text()` at the end, followed by more selector, and inside `:has(…)`, recursively and scoped to each match. It stays inside `probe.js`'s single function, between markers a Playwright check extracts.

### What warrants a second pair of eyes
- **`onInstance`** in `agent/api/app.js` retries a data call once after starting a missing instance. A "no store" for another reason would also retry, once.
- **The refusal of evals that shadow an API name** is broad: any top-level declaration of a reserved name, including core terms like `step` and `par`.
- **`redact.py`** masks only what it is told (`OPERATOR_*`). A future persona that reaches some other credentialed tool needs the shim treatment first.

### What should be done in the future
- Decisions for the user: frames as different people (design-doc/02), and npm packages from the bench.
- A server listing of a store's collections for the Data view.
- A proposal preview seeded from the dev data, or an offer to do it: Sam's top struggle in two rounds.
- Round 4 on the fixed bench: theo-ts (a TypeScript migration of the legacy app, with scenarios first), priya2 (weekly quizzes on a published app with data), devon2 (a live team board over rooms), ines-visual, and reruns of Aisha and Lena.

### Code review instructions
- **Start with:**
  - `web/bench/src/agent/agent.js` (`CALL_EVALS`, the continuation loop);
  - `web/bench/src/core/api.js` (`ret`);
  - `web/bench/src/worker/rewrite.js` (shadows, `freeNames`);
  - `web/bench/src/frames/probe.js` (the `qsa:begin` … `qsa:end` block);
  - `web/bench/src/agent/api/app.js` (`onInstance`, `readOnly`).
- **Validate:**
  - `cd web/bench && node --test test/*.test.mjs`
  - `node scripts/06-api-mining/qsa-test.mjs web/bench/src/frames/probe.js`

### Technical details
- **Round 3:** started 04:28 UTC; the personas were restarted with the shim at about 04:36. Exits:

  | Persona | Exit | Time (UTC) |
  |---|---|---|
  | Grace | 0 | 04:55 |
  | Sam | 0 | 04:59 |
  | Kenji | 0 | 05:14 |
  | Maya-visual | 0 | 05:16 |
  | Theo | 0 | 05:22 |
  | Lena | 124 | 05:31 |

- **Struggles/commands:** grace 8/70, kenji 9/140, lena 5/102, maya-visual 17/150, sam 7/152, theo 5/145.
- **Archive:** `various/persona-review-2026-11-17/r3`, redacted. Embedded screenshots were dropped from the sessions, and the shots are 960 px at quality 50 (37 MB).

## Step 15: Round 4: the agent faked its evals, a long thread died, and four more API fixes

Round 4 ran six personas on the bench from eebd686 (rev 2257), with the round-3 fixes live. The goals were harder:
- Theo-ts migrates the legacy inventory app to TypeScript, scenarios first.
- Priya2 reworks her published quiz into weekly quizzes, keeping the pupils' scores.
- Devon2 builds a live team board over rooms, with a race between two movers.
- Inès-visual, a florist working only by eye, builds an order page and a private orders page.
- Aisha and Lena return with harder versions of their round-2 and round-3 goals.

Four said "yes" (Priya2, Aisha, Devon2 "mostly", and Theo-ts's steps up to his timeout). Inès-visual and Lena said "partly". Theo-ts timed out (exit 124) halfway through the migration: actor converted, 8 scenarios green before and after, the page not yet started.

The round's worst finding was in the bench's agent, not its UI. In five replies across three apps since round 2, the model never called its tool: it wrote "[eval #1 …code…]" into its reply, imitating the history, and reported results it made up. Theo-ts was told his CSV export was "written and verified" when nothing had run.

### Prompt Context
No new user prompts in this step; it continues the work under Step 14's prompts ("make this fucking sick…", "focus on improving the agent's JS API and documentation too"), at the user's direction to keep iterating rounds.

**Commit (code):**
- 6d1660b, 955a8ab — evals written as text are caught (`FAKED_EVAL`): the reply is dropped, the model is told nothing ran, and a past fake reply isn't fed back as an example
- 0610de7 — the narrow Code view's file list stays open once shown
- 6b2d95a — Fit leaves room for the canvas's mode bar
- 0609a08 — the guide: check a change by using it, not by reading it back
- 4975b20 — the Data view's query box runs a change of the instance's data (asked first)
- 3ae5473 — the guide gives the real options for a page library
- 26efee7 — a finished reply's evals fold into one line; `print()` in a frame says why it does nothing
- 3f948af — a scenario step checks a download: `{ download: name, text | exact | match }`
- 4da058f — a long thread keeps working: `fitPrompt`, a 96 KB cap on the kept variables, a spent turn reports
- 52400a9 — four API fixes from the round's evals (`par` objects destructure, frame objects, `attrs`, proposal logs) and a narrower shadow refusal

### What I did
- **During the round**, I fixed what the personas reported but didn't deploy: the personas' tabs keep the bench they loaded, and a mid-round restart is what lost Priya2's message (below).
- **The faked evals:** `lastturn.mjs` showed Theo-ts's turn had zero steps and text full of "[eval #1 …]" blocks. `faked.mjs` scanned every agent reply in 16 apps: 5 such replies (inventory 1 in round 2, inventory2 3 in rounds 3–4, lena-charts 1 in round 3).
- **The dead thread:** Devon2's thread answered only "a prompt is at most 262144 bytes". I measured the prompt the bench would send for that thread now (`promptsize2.mjs`, the bench's model call stubbed): 57 KB. The failing state was never saved: the message has neither text nor an error, and the screen showed a summary (1–8) the saved thread doesn't have. So I guarded every path instead of guessing one.
- **After the round:**
  - rebuilt the server (scenario frames load its probe) and verified the download step;
  - restarted the benchdrive daemon with its round-4 fixes;
  - mined the round's 347 evals (41 failed);
  - fixed the four API patterns;
  - archived and redacted the round.

### Why
- **Drop a faked reply rather than show it.** The person can't tell invented results from real ones, so a reply with code but no evals isn't safe to show. The model gets one retry with the reason.
- **Fit the prompt in the bench.** The runtime's 256 KB limit is right for pages. The bench is the one caller that builds prompts from long histories, so it must fit its own.
- **No mid-round deploy.** A persona's tab keeps the bench it loaded, and restarting the daemon closes the tabs.

### What worked
- **The verdicts:**
  - Priya2: "Weekly quizzes are live… Published, with my pupils' existing scores untouched."
  - Aisha: "The agent proved privacy at the data level (volunteer's browser receives only first name and status, no phone field at all)."
  - Devon2: "the round's first half was the best I've had here (it tested with two frames and doubted its own fix)."
  - Theo-ts: "All 8 scenarios passed… today's behaviour is pinned before any file is converted, exactly the order I wanted."
- **The round-3 fixes held:** no persona was stopped at 9 evals, and no `lib.def` or selector failures came from round-4 threads.
- **Verification on `benchnext`:**
  - a 34-eval request ended with the new tool-less report ("Not done / not verified: those 4 returns");
  - the download step passes on a matching export and fails with what was downloaded;
  - `par({…})` destructures both ways;
  - `const s = 42` stays local and the API `s` is intact in the next eval.
- **Tests:** 39 Node tests pass.

### What didn't work
- **The faked evals** went unnoticed for two rounds. The personas reported "it said done but nothing changed", and I read that as a proposal problem until Theo-ts's turn showed zero steps.
- **My mid-round daemon restart** (to fix `openApp`) closed every tab. benchdrive reopened Priya2's on the shared account's last app, and her "build it" message went to another app's agent. benchdrive now remembers each persona's app.
- **Lena's library:** the guide line from round 3 ("the person can't add one from the bench") led the agent to call a CDN library impossible, then possible, then refuse it. Pages can load a pinned CDN script (their CSP sets only `frame-ancestors`); the guide now gives the three real options.
- **Inès-visual's "Accept does nothing":** her clicks landed about 23 px above the button. A person sees the pointer turn into a hand; a screenshot doesn't. benchdrive's `click-at` now says when nothing clickable was under the point.
- **The exact trigger of Devon2's 256 KB prompt** is not known. The guard records the part sizes (`promptCut`) when it trips.

### What I learned
- **A model imitates its history's format.** "[evals: …]" notes of past calls became a template for fake calls. The history now replaces such a reply with a plain note.
- **"Read it back" isn't a check.** Theo-ts found two bugs in code the agent had "confirmed" by reading its own writes.
- **A refusal can be too broad.** Agents named a variable `s` 21 times, and every one was refused, because `s` is a flat API name.

### What was tricky to build
- **`FAKED_EVAL`** must match API calls in fenced code or "[eval" blocks, but not page code a reply shows the person (`claude.use`, `db.doc`). It matches only bench namespaces after `await`.
- **The narrower shadow rule:** a declaration of a flat name stays a local `const` (not rewritten into the kept scope), so the API is untouched in later evals. It's refused only when the name is used before its declaration ends (the dead zone that broke `const [info, app] = await par([app.info()])`). Namespaces are still refused outright.
- **`fitPrompt`** cuts the largest turns in the middle, never the person's current message first, and counts UTF-8 bytes, not characters.

### What warrants a second pair of eyes
- **The tool-less final call** in `turn()` costs one more model call per spent turn.
- **The download recorder** in `probe.js` wraps `URL.createObjectURL` and `HTMLAnchorElement.prototype.click` in every frame.
- **The Data view's writes** go through the workshop's `exec`, which refuses the published app's instance; the confirm names the instance kind.

### What should be done in the future
- **Decisions for the user:**
  - frames as different people (design-doc/02). Devon2 is the fourth persona to hit it: "both frames are the same visitor ('admin'), so 'moved by admin' doesn't prove the name is the mover's".
  - CDN scripts in app pages: allow, as now, or restrict to vendored packages.
- Round 5 on this bench: Theo-ts finishes the page migration; a persona whose goal needs two people.

### Code review instructions
- **Start with:**
  - `web/bench/src/agent/agent.js` (the turn loop: the faked-eval retry, the final report, `fitPrompt`);
  - `web/bench/src/agent/hints.js` (`FAKED_EVAL`, `fitPrompt`);
  - `web/bench/src/worker/rewrite.js` (the shadow rule);
  - `web/bench/src/frames/probe.js` (downloads, `print`);
  - `web/bench/src/frames/scenarios.js` (the download step).
- **Validate:**
  - `cd web/bench && node --test test/*.test.mjs`
  - `node scripts/06-api-mining/faked.mjs <apps…>` on a review server

### Technical details
- **Round 4:** started 05:35 UTC. Exits:

  | Persona | Model, thinking | Exit | Time (UTC) |
  |---|---|---|---|
  | Lena | deepseek-4.1-flash, medium | 0 | 06:03 |
  | Priya2 | glm-5.3-flash, medium | 0 | 06:05 |
  | Aisha | glm-5.3, medium | 0 | 06:06 |
  | Inès-visual | deepseek-4.1-flash, medium | 0 | 06:16 |
  | Devon2 | deepseek-4.1-flash, high | 0 | 06:22 |
  | Theo-ts | glm-5.3, high | 124 | 06:35 |

- **Struggles/commands:** aisha 4/112, devon2 12/149, ines-visual 10/179, lena 10/74, priya2 3/117, theo-ts 7/246.
- **Archive:** `various/persona-review-2026-11-17/r4`, redacted. Shots are 1120 px at quality 55 (PNGs 256 colours), and embedded screenshots were dropped from the sessions (52 MB). The scan found no standalone link token and no operator identity. One `lr_` match is inside a base64 `thinkingSignature`.
- **Evals mined:** 347 (41 failed); `scripts/06-api-mining/steps-r4.jsonl`.
