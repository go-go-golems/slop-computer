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
