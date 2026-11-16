---
Title: 'Design: TypeScript in slop — the server compiles, slop''s APIs come with types, the bench checks'
Ticket: SLOP3-024
Status: active
Topics:
    - architecture
    - goja
    - apps
    - frontend
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/actor/actor.go
      Note: 'load, requirer, ctxObject, readShape: TS entry, resolution, actor.d.ts, args schemas (§4.4, §5.2, §5.4)'
    - Path: repo://pkg/actor/manager.go
      Note: the code-file filter accepts .ts (§4.4)
    - Path: repo://pkg/doors/actors/modules.go
      Note: 'modArgs: how module functions map to verbs, for generated declarations (§5.3)'
    - Path: repo://pkg/doors/pages/storebytes.go
      Note: 'writeStoreBytes: the compile step for pages sits in front of it (design §4.3)'
    - Path: repo://pkg/store/files.go
      Note: 'TypeOf/fileTypes: .ts gains an explicit type (design §4.2)'
    - Path: repo://pkg/verbs/def.go
      Note: 'verb schemas: the source of generated module declarations (§5.3)'
    - Path: repo://ttmp/2026/11/16/SLOP3-024--typescript-in-slop-the-server-compiles-ts-to-js-with-esbuild-apps-actors-the-bench/scripts/02-esbuild-transform-time/main.go
      Note: 'probe: esbuild transform time on web/runtime/src (§4.1)'
    - Path: repo://ttmp/2026/11/16/SLOP3-024--typescript-in-slop-the-server-compiles-ts-to-js-with-esbuild-apps-actors-the-bench/scripts/03-goja-runs-esbuild-output/main.go
      Note: 'probe: goja runs esbuild output and maps stack traces to .ts lines (§4.1)'
ExternalSources: []
Summary: 'TypeScript as a foundational slop feature: the server compiles .ts with esbuild''s Go API (per file, cached by hash) for pages, actors, app verbs and slop eval; slop publishes declarations for the page runtime, the actor API, its modules (generated from the verbs'' JSON Schemas) and each app''s actions; types are checked in the bench by a browser worker and with tsc locally, never on the serving path.'
LastUpdated: 2026-11-16T17:58:08.605033044-05:00
WhatFor: 'Deciding and implementing TypeScript support in slop: what the server compiles and how, which declarations slop publishes and where they come from, where type checking runs, and the phased plan.'
WhenToUse: Before implementing any part of SLOP3-024, or when touching how slop serves page files, loads actor code, or describes its modules and verbs to app authors.
---

# Design: TypeScript in slop

**The server compiles, slop's APIs come with types, and the bench checks.**

Status: proposed, 2026-11-16. Nothing here is implemented. The evidence was gathered against slop-computer `main` at 407a3f9.

## 1. Summary

Slop hosts apps. An **app** is a tree of files kept in a **store**. Every change makes a new numbered **snapshot**, and names such as `main` or `draft` (**refs**) point at snapshots. Two kinds of code in that tree run:

- **Pages:** HTML and JavaScript that slop serves to visitors' browsers.
  - A page reaches slop through `window.claude`, a runtime that slop injects into every page.
  - `claude.use('slop')` returns the app's own namespace, whose `actions` call the app's actor.
- **The actor:** server-side JavaScript named by the app's `app.json` (`"actor": "actor.js"`), which slop runs in goja, a JavaScript engine written in Go.
  - It declares named **actions** with `defineActor({actions: {...}})`.
  - It keeps data in its own SQL database.
  - It calls slop's server functions through **modules** (`use('workshop')`). Modules wrap slop's **verbs**, the typed server commands that the CLI also calls.

People write apps in their editors and push them with the `slop` CLI. They can also develop them in **the bench**, slop's development environment, which is itself a slop app. There, an agent works by running JavaScript **evals** against the bench's host API.

All of that code is JavaScript, and nothing checks it before it runs. This design makes TypeScript a foundational part of slop:

- Anyone who writes code for slop can write TypeScript wherever slop runs code, with no build step of their own.
- They get types for everything slop provides.
- JavaScript keeps working unchanged.

The design has three parts:

1. **Compile.** The server turns a `.ts` file into JavaScript when it needs to run it: when it serves the file to a browser, and when it loads it into an actor.
   - The compiler is esbuild, linked into the slop binary through its Go API.
   - It removes the types and nothing else, in about 2 ms per file.
   - The output is cached by the file's content hash.
2. **Types.** Slop publishes TypeScript declarations (`.d.ts` files) for everything it provides: the page runtime, the actor API, every module, and later each app's own actions. Most of them are generated from what the server already knows about itself, chiefly the JSON Schemas of its verbs.
3. **Check.** TypeScript's checker finds type errors, and it runs apart from compiling:
   - in the bench, in a browser worker: the agent sees type errors in its eval results, and the person sees them in the editor;
   - with ordinary `tsc` on a laptop or in CI.

   Serving never waits for a check, and a type error never takes an app down.

Compiling is the small part: a few days of work. The value is in parts 2 and 3. They catch the class of bug that the review of SLOP3-023 found, a value of the wrong shape passed between the page, the actor and the server, before anything runs.

This document builds on the ticket's notes (`reference/01-notes-typescript-through-esbuild-on-the-server.md`). They record:

- how the idea came up;
- what runs where;
- the API lessons from the SLOP3-023 review (notes §7);
- the decision to check types in a browser worker (notes §8).

Where the two disagree, this document is current.

## 2. What happens to a TypeScript file today

Take a small app that someone writes in TypeScript and pushes today:

```
app.json      {"title": "Notes", "page": "index.html", "actor": "actor.ts"}
index.html    <script type="module" src="main.ts"></script>
main.ts       const slop = await claude.use('slop')
              const rows = await slop.actions.list({ max: 20 })
actor.ts      import { slug } from './lib/text.ts'
              defineActor({ actions: { list: { requires: 'view', run(ctx, args: { max?: number }) { … } } } })
lib/text.ts   export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
```

The push succeeds, because the store keeps any file. Then three things go wrong.

**The type the store records for each `.ts` file depends on the machine.** `TypeOf` in `pkg/store/files.go` first looks the extension up in slop's own table, which has no `.ts`. Next it asks the operating system's MIME database, which lists two equally weighted types for `.ts`: `text/vnd.trolltech.linguist` (a Qt translation file) and `video/mp2t` (an MPEG transport stream). On the development machine Go picks the first. The server's image (`debian:bookworm-slim`) installs no MIME package, so it probably has no database at all. There, Go's built-in table applies, which has no `.ts` either, and the type becomes `application/octet-stream`.

**The browser refuses `main.ts`.** Pages are served by `writeStoreBytes` (`pkg/doors/pages/storebytes.go`) with the stored type and `X-Content-Type-Options: nosniff`. A browser runs a module script only when it is served with a JavaScript type, and none of the three types above is one.

**The actor never loads.** The actor manager gives the actor only the snapshot's `.js`, `.json` and `.sql` files (`pkg/actor/manager.go`, the loop over `SnapshotFiles`), so `actor.ts` is not among them. If it were, goja would stop at the first type annotation.

The same holds for every other place that runs code, because every engine slop uses runs JavaScript only: browsers, goja, and QuickJS in the bench's sandbox.

| Code | Runs in | How it gets there today |
|---|---|---|
| Page files | the browser | `writeStoreBytes`, as stored |
| The actor and the files it `require`s | goja, on the server | the manager's file filter; `(*Actor).load` and `requirer` in `pkg/actor/actor.go` |
| An app's CLI verbs (`slop.verbs` in `app.json`, e.g. pinboard's `verbs/*.js`) | goja, inside the `slop` CLI | the `app.verbs` verb returns their sources; `pkg/appverbs` scans them with go-go-goja's jsverbs |
| `slop eval` programs | goja, on the server | `pkg/commands/eval.go` runs the source as a function body |
| The agent's evals | QuickJS, in a Web Worker in the bench | sent as text |
| The bench's own source | all of the above | built by `web/bench/build.mjs`, with esbuild from npm |

## 3. The design at a glance

```
             write                compile (server, esbuild)            run
 person ─┐                 ┌──── page file served ──────────────▶ browser
 agent  ─┼── .ts in the ───┼──── actor file loaded ─────────────▶ goja (server)
 bench  ─┘   app's store   ├──── app verb sources returned ─────▶ goja (CLI)
                           └──── slop eval source ──────────────▶ goja (server)

             check (separately; never on the serving path)
   declarations, served by slop: page runtime, actor API, modules, app actions
        │
        ├──▶ the bench: TypeScript's checker in a browser worker (eval results, editor)
        └──▶ a laptop or CI: tsc against the files `slop types` writes
```

Two properties keep this simple:

- **The source is what is stored; compiled output is a cache.** Nothing new is written to stores, and no migration is needed. A file's compiled output depends only on three things: its content (sha256), the place it runs (page, actor…) and the compiler version. So it can be computed again at any time.
- **Compiling never depends on the types being right.** esbuild strips annotations without checking them. A page with a type error is served and runs exactly as its JavaScript would. Checking is advice to the author, delivered where the author works.

## 4. Part 1: the server compiles

### 4.1 One file, one transform

esbuild offers two APIs. `api.Build` bundles an entry file and everything it imports into one file. `api.Transform` turns one file's text into JavaScript without looking at any other file. This design uses only `Transform`:

```go
r := api.Transform(src, api.TransformOptions{
    Loader:     api.LoaderTS,
    Sourcefile: "lib/text.ts",        // names the file in errors and source maps
    Format:     api.FormatCommonJS,   // depends on where the file runs (table below)
    Target:     api.ES2020,
    Sourcemap:  api.SourceMapInline,
})
// r.Code, r.Map, r.Errors
```

A per-file transform suits slop for three reasons:

- **Nothing needs bundling.** The browser and the actor's `require` already resolve imports file by file.
- **The cache is exact.** The output depends on one file's content.
- **It is fast.** On the 12 TypeScript files of slop's own page runtime (`web/runtime/src`, 84.6 KB), a warm transform took 17.5 ms in total as ES modules and 25 ms as CommonJS, with inline source maps. That is about 2 ms per file (`scripts/02-esbuild-transform-time`).

Each place that runs code gets a **profile**, a fixed set of options:

| Profile | Used for | Format | Target | Source map |
|---|---|---|---|---|
| `page` | page files served to browsers | ES module | es2022 | linked: `//# sourceMappingURL=<name>.map`, served on request |
| `actor` | the actor's entry and the files it requires; app CLI verbs | CommonJS | es2020 | inline |
| `eval` | `slop eval` programs | CommonJS, inside the verb's function wrapper | es2020 | inline |

The formats follow the engines:

- **ES modules are what browsers load.**
- **CommonJS is what the actor's `require` already implements.** esbuild turns `import { x } from './y.ts'` into `require('./y.ts')`.

The source maps follow the size of the output:

- **Pages get linked maps.** Inline maps triple the output (84.6 KB became 258 KB), and a browser fetches a linked map only when its developer tools are open.
- **Actors get inline maps,** because the server reads them in memory.

The actor's target matters because goja implements ES5.1 and most, but not all, of the later editions. A probe (`scripts/03-goja-runs-esbuild-output`) tested this:

- **What it did:** it compiled two TypeScript files with the `actor` profile and ran them in goja, through the same CommonJS wrapper that slop uses.
- **What the files used:** an enum, a class with parameter properties, optional chaining, `??`, spread, async/await, and an `import type`.
- **The result:** both files ran. An error thrown in the second one reported its position in the TypeScript source:

```
Error: too many changes: 2
	at check (rows.ts:9:24(16))
	at actor.ts:11:55(7)
```

Line 9 of `rows.ts` is the line with the `throw`, so goja reads the inline map. That answers an open question from the notes (§5, "Error positions"). The implementation keeps a probe like this as a test, and the test fixes the target at the newest level that goja runs correctly.

### 4.2 Which files compile

A file compiles when three things hold:

- its name ends in `.ts`, `.mts` or `.cts`;
- its name does not end in `.d.ts`;
- its content is valid UTF-8.

The last two conditions keep two kinds of file out:

- **`.d.ts` files** are declarations, never code, and are served as stored text.
- **A `.ts` file that is not text** is most likely a video (an MPEG transport stream), and is served as stored, as it is today.

The decision depends on the name and the content, not on the type recorded when the file was stored. So files pushed before this change compile correctly too.

There is no switch in `app.json`. The extension already says what the file is. A switch would only add a state in which a `.ts` file is served as something the browser refuses to run.

`.tsx` is not compiled in this design. JSX needs a runtime: React's `jsx` function, or a factory the page defines. In practice that means a bare import (`import … from 'react'`), and the browser cannot resolve one without bundling. `.tsx` therefore belongs with bundling and npm packages, which this design leaves out (section 9).

slop's own file-type table gains entries for the three extensions, so the stored type no longer depends on the machine:

```go
".ts": "text/typescript; charset=utf-8", // and the same for .mts and .cts
```

Listings and downloads report the stored type. A compiled response always says `text/javascript; charset=utf-8`, whatever type is stored.

### 4.3 Pages

Every response that carries a store's bytes goes through one function, `writeStoreBytes`. It derives every header from two facts about the bytes:

- who may see them (`visibility`);
- whether they can change (`mutability`).

The compile step sits in front of it and uses the same facts:

```
GET …/main.ts on a page host
  → resolveStoreFile: the file at the ref or snapshot (sha256 abc…)
  → does it compile? (.ts, not .d.ts, UTF-8; not the trusted host; not an upload)
      yes → the cache (abc…, page, esbuild version), or compile now
          → JavaScript: Content-Type text/javascript, ETag "abc….page.<version>",
            and the same Cache-Control, CSP and nosniff as today
      no  → served as stored (today's path)
GET …/main.ts.map → the same lookup; the map, as JSON
```

**Only page hosts compile.** On slop's trusted origin, store bytes are downloads under a sandbox CSP and never run (the first branch of `writeStoreBytes`), so there the source is served as stored. Uploads (the `assets` zone) never compile.

**The ETag names the profile and the compiler version,** so a server upgrade that changes esbuild also changes the ETag. A numbered snapshot's URL is served as `immutable`, so a browser may keep an older compile of the same source. That is harmless: the source is unchanged, and both outputs implement it.

**A compile error becomes a module that throws.** If `main.ts` does not parse, the response is still JavaScript, with status 200:

```js
throw new SyntaxError("main.ts:3:14: Expected \";\" but found \"rows\"")
```

A failed module request (a 4xx or 5xx status) shows up in the browser console only as a network error, without the message. A module that throws shows the message where page errors already appear: in the browser console, and in the bench, whose probe (a script slop adds to the frames the bench shows) reports a frame's errors.

**Imports name their files with the extension:** `import { slug } from './lib/text.ts'`.

- **With the extension,** the browser requests exactly that path, and the server compiles that file.
- **Without it** (`'./lib/text'`), the import fails: no such file exists, and a per-file transform does not rewrite import paths.

This is TypeScript's `allowImportingTsExtensions` style, which `web/runtime/tsconfig.json` already uses. The `tsconfig` that slop writes for an app (section 5.5) turns it on, so the checker accepts these imports and flags the ones without an extension.

### 4.4 Actors

Today an actor loads in three steps:

1. the manager collects the snapshot's code files;
2. `(*Actor).load` installs the globals (`defineActor`, `use`, `require`, `console`) and runs the entry;
3. `requirer` loads other files when they are required, wrapping each as CommonJS.

TypeScript changes each step a little:

1. **Collecting files** (`pkg/actor/manager.go`): the filter also accepts `.ts`, `.mts` and `.cts`, under the same 4 MB limit.
2. **The entry** (`load`): an entry named `*.ts` is compiled with the `actor` profile, then run inside the same CommonJS wrapper as required files. The wrapper is needed because a compiled file that uses `export` refers to `module.exports`, which a plain script lacks. JavaScript entries keep running as plain scripts, so nothing changes for them.
3. **`require`** (`requirer`):
   - A path with an extension is loaded as named. A path without one tries `.ts`, then `.js`. Today `requirer` appends `.js` to anything that doesn't end in `.js` or `.json`, which would turn `./x.ts` into `./x.ts.js`.
   - A `.ts` file is compiled before it is wrapped.
   - Module names still come first, so `import { commit } from 'workshop'` compiles to `require('workshop')`. That is `use('workshop')`, just as `require('database')` is today.

Two smaller changes support the types in section 5:

- **`defineActor` returns its argument.** Today it returns `undefined`. The change costs nothing at runtime, and it makes the declaration `defineActor<D>(def: D): D` true.
- **goja's source-map loader is set explicitly** on every runtime slop creates for app code: actors, `slop eval`, and app verbs in the CLI. The loader returns no files at all. Inline maps (`data:` URLs) don't go through the loader, so they keep working, as the probe above shows. Slop never needs goja to read a map from anywhere else.

An actor's errors then read as they do for JavaScript, with TypeScript positions:

- **A syntax error** fails the load with `actor_error`, e.g. `actor.ts:12:3: Expected ")" but found "{"`.
- **A runtime error's** stack trace points at the `.ts` lines.

### 4.5 App verbs and `slop eval`

**App verbs** are an app's command-line commands. `app.json` lists their files; pinboard has `"slop": {"verbs": {"include": ["verbs/*.js"]}}`. Running one takes three steps today:

1. the CLI fetches the sources with the `app.verbs` verb;
2. it scans them with go-go-goja's jsverbs for `__verb__(…)` declarations;
3. it runs the verb in goja, inside the CLI (`pkg/appverbs`).

The simplest place to compile is the server: `app.verbs` returns the compiled JavaScript of each `.ts` source, using the `actor` profile, and the CLI does nothing differently. The scan reads function names, parameters and the `__verb__` calls, and stripping types keeps all three. The plan includes a test on a TypeScript copy of a pinboard verb.

**`slop eval`** runs a program as the body of a function, which allows a top-level `return`. A TypeScript program is placed inside the same function wrapper first and compiled afterwards, with the `eval` profile, because a bare top-level `return` does not parse outside a function. The CLI marks a source as TypeScript when the file ends in `.ts`, through a new `ts: true` field on the verb's input.

### 4.6 The cache and its limits

The compile cache lives in memory, in the server process.

- **Key:** the source's sha256, the profile and esbuild's version. The output (code and map) is a pure function of the key.
- **Size:** a least-recently-used cache, bounded by bytes. 64 MB is a reasonable start. After a restart the cache is empty and refills on demand, at about 2 ms per file.
- **Concurrency:**
  - Concurrent requests for the same uncached file wait for one compile (Go's `singleflight`).
  - Compiles share a semaphore with `GOMAXPROCS` slots, so a burst of first requests cannot take every core.
- **Input size:** actor code files are already limited to 4 MB, and page files compile up to the same 4 MB. A larger `.ts` page file gets a module that throws an error saying so.

esbuild is written in Go, and it never executes the source it compiles. A hostile file can cost time and memory, which these limits bound, since esbuild's time grows linearly with input size.

esbuild adds about 6 MB to a stripped binary. That was measured on a minimal program using only `pkg/api`; slop already links much of the same standard library, so the real increase is somewhat smaller.

## 5. Part 2: types for what slop provides

Compiling alone lets people write TypeScript but checks nothing: every value that comes from slop is still `any`. Types pay off when slop's own interfaces are declared. This part defines four sets of declarations, then describes how they reach a checker.

### 5.1 The page runtime: `page.d.ts`

`window.claude` is already TypeScript: 12 modules in `web/runtime/src`, built into `pkg/doors/pages/assets/claude.js` with esbuild. The types exist, but no app can see them.

The runtime's build gains a step that emits only declarations (`tsc --emitDeclarationOnly`), producing `page.d.ts`. A sketch of what it declares:

```ts
declare global {
  const claude: Claude
}
interface Claude {
  use(name: 'slop'): Promise<SlopNamespace>
  use(name: 'db'): Promise<Db>
  // … one overload per capability
}
```

The file is embedded in the binary beside `claude.js`, under a freshness check like the existing `TestBuildOutputsFresh`.

### 5.2 The actor API: `actor.d.ts`

The actor's globals and the `ctx` that each action receives are defined in Go:

- `load` installs the globals;
- `ctxObject` (`pkg/actor/actor.go`) builds `ctx`: `visitor`, `app: {id, version}`, `fail(code, msg)`, and more.

There are few of them, and they rarely change, so the declaration is written by hand. A sketch:

```ts
declare function defineActor<D extends ActorDef>(def: D): D
declare function use<N extends keyof SlopModules>(name: N): SlopModules[N]
interface Ctx { visitor: Visitor; app: { id: string; version: number }; fail(code: string, msg: string): never /* … */ }
type Action<A = unknown, R = unknown> =
  | ((ctx: Ctx, args: A) => R | Promise<R>)
  | { requires?: 'view' | 'interact' | 'admin' | 'owner'; run(ctx: Ctx, args: A): R | Promise<R> }
```

A Go test keeps the declaration honest. It lists the properties that `ctxObject` sets, and fails when one of them is missing from the declaration.

### 5.3 Modules: generated from the verbs' schemas

An actor's modules come in two kinds:

- **Bridged go-go-goja modules,** and `database`, already carry a declaration. `typeScriptOf` (`pkg/actor/bridge.go`) renders it from the module's descriptor, and the `app.modules` verb returns it.
- **Verb-backed modules** (`workshop`, `system`) have none.
  - Each of their functions is a slop verb: `{JS: "commit", Verb: "files.commit"}` in `pkg/doors/actors/modworkshop.go`.
  - `modArgs` (`pkg/doors/actors/modules.go`) maps the arguments. A single plain object is the argument object. Otherwise the arguments fill the function's `Pos` names in order, and a plain object after them adds options.

Each verb is defined in Go with typed input and output structs (`verbs.Def[In, Out]`, `pkg/verbs/def.go`). The `invopop/jsonschema` library already reflects them into JSON Schemas, with descriptions taken from struct tags.

A small converter from JSON Schema to TypeScript turns each module function into a declaration. For `workshop`, the result is roughly this (simplified):

```ts
interface Workshop {
  /** Commit changes to a ref of a store, merged over what was committed since base. */
  commit(args: { store: string; ref: string; base: number; changes: FileChange[]; activate?: boolean }): CommitResult
  files(store: string, at?: string, opts?: { /* … */ }): FileEntry[]
  // …
}
```

The converter handles the subset of JSON Schema that the verbs use:

- objects, with required and optional properties;
- arrays, enums and primitives;
- descriptions, which become doc comments;
- `oneOf`, which becomes a union.

A verb with an untyped output (`any`) gets `unknown`. A function's `Pos` names become positional parameters followed by an optional options object, matching `modArgs`.

`FileChange` shows what generation can and cannot do. The Go struct makes every field optional:

```ts
interface FileChange { path: string; text?: string; data?: string; sha256?: string; size?: number; delete?: boolean }
```

The rule "exactly one of `text`, `data`, `sha256` or `delete`" lives in the verb's code, not in the struct. The bug from the SLOP3-023 review sat in exactly that gap: the bench actor rebuilt change lists with code that knew only two of the four kinds, and a file kept by hash was committed as the text `undefined` (notes §7).

For the declaration to become the union `{path, text} | {path, data} | {path, sha256, size} | {path, delete: true}`, the schema has to say `oneOf`, so the struct gains a JSON Schema hook that declares it. Then code that builds a text change from a variant without `text` no longer compiles. This improves the verb itself, and it is worth doing because the declaration then states what the server enforces (notes §7, item 3).

The declarations depend on the app. Which modules an app may use is a governance decision (`Gov.AppModules`), so `modules.d.ts` declares only those. Using any other module is a type error, which matches what happens at runtime.

### 5.4 The app's own actions

The last boundary belongs to the app. The page calls the actor's actions through `claude.use('slop')`. Its `actions` is a proxy, typed `(args?: unknown) => Promise<unknown>` (`web/runtime/src/caps.ts`). This is where an app's page and actor disagree about shapes. Slop cannot know the shapes, because the app defines them.

**In phase 1: a pattern, not a mechanism.** The app keeps its contract in one file that holds only types, and both sides import it:

```ts
// api.ts: types only, imported with `import type`
export interface Actions {
  list(args: { max?: number }): Note[]
  add(args: { text: string }): { id: string }
}

// actor.ts
import type { Actions } from './api.ts'
defineActor({ actions: { list: { requires: 'view', run: (ctx, args) => /* … */ }, /* … */ } } satisfies ActorOf<Actions>)

// main.ts
import type { Actions } from './api.ts'
const slop = await claude.use<Actions>('slop')
const rows = await slop.actions.list({ max: 20 })   // rows: Note[]
```

How the pattern works:

- **Neither side loads the other's code.** The compiler erases `import type`.
- **The declarations supply the rest** (both names are proposed here, in `actor.d.ts` and `page.d.ts`).
  - `ActorOf` types `run`'s arguments and results.
  - The generic `use` types the page's calls. It also turns each result type into its JSON form, since every result crosses the wire as JSON: a `Date` arrives as a string.
- **The contract is a separate file on purpose.** The page could instead infer its types from `typeof` the actor. But then the page's program would see the actor's globals, and a page calling `use('workshop')` would type-check and then fail at runtime.

**In phase 2: declared and enforced.** An action may declare its arguments as a JSON Schema, and optionally its result:

```js
add: {
  requires: 'interact',
  args: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 2000 } } },
  run(ctx, args) { /* … */ },
}
```

The schema then does three jobs:

1. **The actor runtime checks the arguments before `run`.** A wrong shape is answered with `invalid_argument` and the failing path, instead of being converted into a different value. The bench actor converts its 35 actions' arguments by hand today (`String(v ?? '')`, notes §7, item 1).
   - `readShape` already reads `requires` from each action, and it reads `args` the same way.
   - Slop has no JSON Schema validator yet (invopop only generates schemas), so a library such as `santhosh-tekuri/jsonschema` is added.
2. **`slop types` generates the page's `Actions` type from the schema,** with the converter from section 5.3. This replaces the hand-written `api.ts`. It works for JavaScript actors too: a JavaScript app gets typed `slop.actions` in an editor without writing any TypeScript.
3. **The actor's own `run` gets typed arguments in the editor,** through a type-level `FromSchema<S>` in `actor.d.ts`. It covers the same subset as the converter, and needs the schema written `as const` in TypeScript.

App actions then work the way slop's verbs already do: a schema is the one source, the server enforces it, and the TypeScript is generated from it.

### 5.5 How declarations reach a checker

A new verb, `app.types {app}`, returns an app's declaration files as `{path, text}`:

```
page.d.ts      the page runtime                        (section 5.1)
actor.d.ts     the actor's globals, Ctx, FromSchema     (5.2)
modules.d.ts   the modules this app may use             (5.3)
actions.d.ts   the app's actions, from their schemas    (5.4, phase 2)
```

The running server generates them, so they describe that server's version, and each file's header records it. They reach a checker in three ways:

- **The bench** fetches them into its checker worker (section 6).
- **`slop types <app> [dir]`** writes them into `<dir>/.slop/types/`.
  - It also writes the two `tsconfig` files described below, if they don't exist yet.
  - `slop dev` refreshes the types when it starts.
  - Push and `slop dev` both skip dot directories (`ReadDir` in `pkg/client/folder.go`, and the walk in `pkg/client/dev.go`). So `.slop/` is never pushed: the types describe the server, not the app.
- **Editors and CI** use the written files with ordinary `tsc`.

An app has two TypeScript programs, because a page and an actor run in different environments:

- **A page** has the DOM and `window.claude`.
- **An actor** has `defineActor` and `use`, and no DOM.

`slop types` writes one `tsconfig` for each:

```
tsconfig.json         pages: lib ES2022 + DOM; page.d.ts; excludes the actor entry and server/
tsconfig.actor.json   the actor: lib ES2020, no DOM; actor.d.ts and modules.d.ts; the actor entry
```

Both turn on `strict`, `isolatedModules`, `allowImportingTsExtensions` and `noEmit`, the settings `web/runtime/tsconfig.json` already uses. `isolatedModules` makes the checker reject what a per-file transform cannot compile: `const enum` across files, namespace merging, and `export =`. The limits of section 4 thus show up as type errors with an explanation, not as surprises at runtime.

By convention, files only the actor uses live under `server/`, which the pages' program leaves out. A file that both the page and the actor use belongs to both programs (pinboard, for example, has `core.js`). Such a file may therefore use neither the DOM nor the actor's globals, a discipline worth having anyway.

## 6. Part 3: checking

### 6.1 Where checks run

Compiling and checking are different jobs, and they run in different places (notes §8):

| | Compile (strip types) | Check (find type errors) |
|---|---|---|
| The server | every page file served and every actor file loaded; cached by hash | not in this design (section 6.3) |
| The bench | the agent's TypeScript eval code | on every change: the agent's eval results and the person's editor |
| A laptop, or CI | (the server does it) | `tsc -p tsconfig.json && tsc -p tsconfig.actor.json`, against `slop types` output |

All of them check against the same declarations and settings, so they agree.

### 6.2 The bench

The bench checks with TypeScript's own checker, in a Web Worker. Notes §8 records that decision, the measurements and the reasons. In brief:

- **Cost:**
  - about 2 MB to download (gzipped, and cached);
  - about 80 MB of memory;
  - 0.4–1.3 s for the first check, depending on whether the type libraries are already in the OS file cache;
  - 30–90 ms for each check after an edit.

  The worker loads only for apps that contain `.ts` files.
- **Inputs:** the worker holds the workspace's files by path and sha256, plus the declarations from `app.types`. The page sends it changes: head moves, the person's edits, and an eval's writes before they are committed.
- **Output:** each eval's effects gain `types: {new: [{file, line, message}], fixed: n}`, the errors the eval introduced and how many it fixed. The list is capped like the existing list of new layout issues.
  - The results inform the agent; they never fail an eval.
  - A check that takes longer than about 2 s is reported as not done.
- **TypeScript evals:** the same worker compiles the agent's TypeScript evals (`ts.transpileModule`) before QuickJS runs them.
- **The Code view** shows the same diagnostics as underlines, and the type under the cursor on hover.

The checker gets its own worker, separate from the QuickJS sandbox. The bench kills the sandbox worker when an eval overruns its time limit, and that must not throw away a warm checker.

### 6.3 No checker on the server, for now

The server would need a checker only for a gate (a check before publishing) or for callers without a browser (an agent working from the CLI). Neither is needed yet: CLI users and CLI agents can run `tsc`, and publishing works without any check today.

When a gate is wanted, there are three options:

- **typescript-go as a separate binary (the one to pick).** TypeScript 7 is the Go port of the compiler.
  - It shipped in July 2026 without a programmatic API; a new API is planned for 7.1, which is reported to be in beta.
  - Running its `tsgo` binary on a temporary copy of the snapshot's files and the declarations needs no API.
  - Results would be cached by snapshot, since a snapshot never changes.
- **The TypeScript compiler inside goja.** goja's README says it can run TypeScript's compiler, so no new binary is needed. But an interpreter is far slower than V8. Not measured.
- **Node and `tsc` in the server image.** This adds a whole runtime just for type checking.

## 7. The agent and the bench

TypeScript changes what the agent is told and what it sees.

- **The guide** (`web/bench/src/agent/guide.js`) tells the agent to write JavaScript. For an app with `.ts` files it says instead:
  - write TypeScript, with extensions in imports;
  - keep the page–actor contract in `api.ts`, or, after phase 2, declare `args` schemas;
  - read `types` in the eval effects.
- **Templates** (`web/bench/src/model/templates.js`) gain TypeScript versions, including the two `tsconfig` files.
- **Eval results** carry `types` (section 6.2). The agent sees a type error it introduced in the same turn, before the person sees a broken page.

The bench's own source (`web/bench/src`) can move to TypeScript independently, at build time, as notes §6 describes. That does not depend on this design.

## 8. What stays the same

- **JavaScript apps work as before.**
  - A file is TypeScript by its name, and an app can mix JavaScript and TypeScript files.
  - A JavaScript page can import a `.ts` module.
- **Stores, snapshots and pushes** are unchanged: the source is stored as pushed.
- **goja, QuickJS and the browsers** are unchanged; they only ever see JavaScript.
- **Page response headers** come from the same facts (`visibility`, `mutability`), through the same function.

## 9. Not in this design

- **Bundling and npm packages** (`import 'lit'`). These need `api.Build` with a plugin that reads files from the snapshot, a source for the packages, and decisions about their supply chain.
- **`.tsx` and JSX,** which in practice need bundling.
- **Type checking on the server** (section 6.3).
- **Types for the bench's host API** in the agent's eval code. The API table (`web/bench/src/core/api.js`) already generates the agent's reference. Generating declarations from it too would let the checker check eval code against the host API, a natural step after phase 3.

## 10. Implementation plan

Each phase is useful on its own and builds on the one before.

**Phase 0: compile (a few days).**

Changes:

- `pkg/store/files.go`: `.ts`, `.mts` and `.cts` in `fileTypes`.
- A new package, `pkg/tscompile`:
  - `Compile(src, name, profile) (Output, error)`, with the three profiles, the cache, `singleflight` and the semaphore;
  - esbuild added to `go.mod`, at a pinned version.
- Pages: the compile step in front of `writeStoreBytes`, the `.map` path, and modules that throw on a compile error.
- Actors:
  - the manager's file filter;
  - a TypeScript entry run in the CommonJS wrapper;
  - `requirer`'s resolution;
  - `defineActor` returning its argument;
  - the source-map loader on every runtime for app code.
- `app.verbs` and `slop eval`: compile `.ts` sources.

Tests:

- a page `.ts` served as JavaScript, with the headers and the ETag;
- a parse error served as a module that throws;
- a `.d.ts` file and a binary `.ts` file served as stored;
- an `actor.ts` that imports `./lib/rows.ts` and `workshop`;
- a stack trace with `.ts` positions (from `scripts/03`);
- a TypeScript app verb, scanned and run;
- a cache hit.

**Phase 1: declarations (about a week).**

- `page.d.ts` from `web/runtime`'s build, embedded and checked for freshness.
- `actor.d.ts`, written by hand, with the drift test against `ctxObject`.
- The JSON Schema → TypeScript converter (`pkg/verbs`), with golden tests.
- `modules.d.ts` per app.
- The `FileChange` schema as a union.
- The `app.types` verb and `slop types`; `slop dev` refreshes the types.
- A fixture TypeScript app that CI checks with `tsc` against the generated declarations. `web/runtime` already has `typescript` as a dev dependency.

**Phase 2: typed actions (about a week).**

- `args` and `result` schemas on actions: read in `readShape`, and validated before `run` with a validator library.
- `actions.d.ts` and `FromSchema`.
- The bench actor converted first, replacing its hand conversion (notes §7, item 1).

**Phase 3: checking in the bench (about a week).**

- The checker worker, `types` in eval effects, the Code view's diagnostics, and TypeScript evals.
- The guide and the templates.

The ticket's `tasks.md` follows these phases.

## 11. Decisions needed

1. **Should new apps default to TypeScript** in the bench's templates and the agent's guide? I recommend yes, once phase 1 has shipped, so that new apps start with types. The JavaScript templates stay.
2. **Bundling and `.tsx`:** do they get a ticket of their own now, or only when an app needs a package?

Everything else in this document is a recommendation. An implementer can follow it, or revise it with a reason.

## 12. References

**Ticket documents:**

- The notes, `reference/01-notes-typescript-through-esbuild-on-the-server.md`: §3 what runs where, §7 the review's lessons, §8 the checker decision.
- The measurements:
  - `scripts/01-ts-check-latency.cjs`: checker latency;
  - `scripts/02-esbuild-transform-time/`: transform time;
  - `scripts/03-goja-runs-esbuild-output/`: goja runs esbuild's output and applies its source maps.

**Code:**

- `pkg/store/files.go`: `TypeOf`, `fileTypes`.
- `pkg/doors/pages/storebytes.go`: `resolveStoreFile`, `writeStoreBytes`.
- `pkg/actor/manager.go`: the code-file filter.
- `pkg/actor/actor.go`: `load`, `requirer`, `ctxObject`, `readShape`.
- `pkg/actor/bridge.go`: `typeScriptOf`.
- `pkg/doors/actors/modules.go`: `modArgs`. `pkg/doors/actors/modworkshop.go`: the workshop functions.
- `pkg/verbs/def.go`: schemas.
- `pkg/commands/files.go`: `FileChange`. `pkg/commands/actors.go`: `app.modules`.
- `pkg/appverbs/appverbs.go`, `pkg/commands/eval.go`.
- `pkg/client/folder.go` and `pkg/client/dev.go`: both skip dot directories.
- `web/runtime/`: the page runtime and its `tsconfig.json`.

**TypeScript 7 status:**

- Microsoft's announcement: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- InfoQ: https://infoq.com/news/2026/08/typescript-7-released/
