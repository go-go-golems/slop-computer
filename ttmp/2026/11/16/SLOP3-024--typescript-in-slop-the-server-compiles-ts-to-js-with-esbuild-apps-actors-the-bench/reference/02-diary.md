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
