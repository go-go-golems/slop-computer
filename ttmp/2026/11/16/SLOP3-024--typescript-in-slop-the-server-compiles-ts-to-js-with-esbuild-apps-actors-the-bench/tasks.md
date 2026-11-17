# Tasks

The phases follow the design (design-doc/01, section 10).

## Design

- [x] Write the full design (design-doc/01-design-typescript-in-slop-…md, 2026-11-16)
- [x] Settle the questions in section 5 of the notes (settled in the design, sections 4–6; bundling and .tsx left out on purpose, section 9)
- [x] Decide: TypeScript as the default for new apps (decided 2026-11-16: yes; templates and guide switch in phase 1)
- [x] Decide: packages and .tsx (decided 2026-11-16: packages only through `slop vendor`, run by a person with the CLI; the server never fetches, the agent cannot add packages; .tsx in phase 0) (design §4.7, §11)
- [x] Fix first: goja runtimes for app code read no files for source maps (PR #52, `pkg/jsrt`)

## Phase 0: the server compiles (PR #53)

- [x] `.ts`, `.mts`, `.cts` in `fileTypes` (pkg/store/files.go): `text/typescript; charset=utf-8`
- [x] `pkg/tscompile`: esbuild (pinned) `api.Transform` with the page/actor/eval profiles; in-memory LRU by (sha256, profile, esbuild version); singleflight; GOMAXPROCS semaphore; 4 MB cap
- [x] Pages: compile step in front of `writeStoreBytes` on page hosts (not the trusted host, not uploads; not `.d.ts`; UTF-8 only); `.map` path; compile errors as a module that throws; ETag with profile and version
- [x] Actors: the manager's code-file filter; a `.ts` entry in the CommonJS wrapper; `requirer` resolution (`.ts` then `.js`; explicit extensions); `defineActor` returns its argument (the source-map loader is done: PR #52)
- [x] App verbs: jsverbs' `SourceTransform`/`RuntimeTransform` hooks in the CLI (as go-go-goja's xgoja does); `slop eval` takes `ts: true` (the CLI sets it for `.ts` files)
- [x] `.tsx` (`text/tsx`); the app's `tsconfig.json`/`tsconfig.actor.json` passed as `TsconfigRaw`, their sha256 in the cache key
- [x] `slop.imports` in `app.json`: validate; inject an import map (from `imports.page`) into served HTML; bare names in the actor's `require` (from `imports.actor`)
- [x] Tests (design §10, phase 0), including the stack-trace check from scripts/03

## Phase 0b: `slop vendor` (CLI only)

- [ ] Registry metadata and tarballs checked against `dist.integrity`; semver ranges; dependencies
- [ ] `api.Build` over a temporary node_modules: ESM with splitting (pages), CJS (`--actor`)
- [ ] Declarations copied; `vendor/vendor.json`; `imports` in `app.json`; folder form and `--store` (commits to the draft)
- [ ] `slop vendor` (list + verify), `slop vendor rm`
- [ ] Tests: a fixture registry, a package with a dependency and subpath exports, a corrupted tarball refused, the output loading in a page and an actor

## Phase 1: declarations

- [ ] `page.d.ts` from web/runtime's build (`tsc --emitDeclarationOnly`), embedded, freshness-checked
- [ ] `actor.d.ts` by hand (globals, Ctx, Action, ActorOf), with a Go drift test against `ctxObject`
- [ ] JSON Schema → TypeScript converter in pkg/verbs (golden tests); `modules.d.ts` per app (bridged modules' existing declarations + verb-backed modules from their verbs' schemas, `Pos` as positional parameters) (notes §7.2)
- [ ] `FileChange` schema as a `oneOf` union (part of notes §7.3)
- [ ] The `app.types` verb; `slop types <app> [dir]` writing `.slop/types/` and the two tsconfig files; `slop dev` refreshes them
- [ ] A fixture TypeScript app checked by `tsc` in CI against the generated declarations
- [ ] TypeScript templates as the default for new apps; the agent's guide to match (TS, extensions in imports, vendored packages; ask the person for new ones)

## Phase 2: typed actor actions

- [ ] `args` (and optional `result`) JSON Schemas on actions: read in `readShape`, validated before `run` (`invalid_argument` with the failing path); add a validator library (notes §7.1; the validation can come before TypeScript)
- [ ] `actions.d.ts` generated from the schemas; `FromSchema<S>` in `actor.d.ts`
- [ ] Convert the bench actor's actions first, replacing its hand conversion

## Phase 3: checking in the bench

- [ ] Type checking in the bench: a TypeScript worker (lazy, warm, its own worker); `types` in eval effects (new/fixed); Code view diagnostics; transpiles TS evals (notes §8, design §6.2)
- [ ] The guide's part on `types` in eval effects (design §7)

## Related, outside the phases

- [ ] Decide the bench's route (build-time TS, or served by this feature) once SLOP3-023 has merged (notes §6)
- [ ] A tagged change type shared by the Draft, the actor and the test stand-in; a snapshot type distinct from "ref absent" (files.commit base 0) (notes §7.3–7.4)
- [ ] "Set a ref's tree to snapshot n" as one server commit, for restore (notes §7.5)
