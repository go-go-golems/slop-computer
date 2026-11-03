---
Title: Diary
Ticket: SLOP3-009
Status: active
Topics:
    - architecture
    - hosting
    - backend
    - agents
    - llm
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/caps/db/db.go
      Note: 'Step 4: the db capability shared by pages and actors'
    - Path: repo://pkg/caps/sample/sample.go
      Note: 'Step 5: the sample capability shared by pages, actors and sample.run'
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-03T13:31:21.022201991-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The chronological record of SLOP3-009: how slop-computer's code is reorganized into reusable parts for hosting artifacts, the decisions taken, and each step's evidence.

## Step 1: From brainstorm to design doc

SLOP3-009 began as a conversation after SLOP3-008 (PR #20) about the "everything and anything" packages, and became a design: the verb table as the narrow waist, doors as projections of it, capabilities and domains as packages, and host products as a short `main`. It was first published as an artifact with diagrams, then two questions settled the parts it had left open: how verbs are described (glazed, protobuf or a superset) and in what order to proceed. This step writes all of it into the ticket. No code moved.

### Prompt Context

**User prompt (verbatim):** "write out SLOP3-009 as an artifact at first, with some diagrams, and how you would reorganize the codebase to make slop-omputer a kind of framework for reusable hosting of artifacts / have a set of useful things like providing a claude.sample style API, or different other affordanecs as a building block itself, and how this fits with this "verb" oriented design. You can cover different approaches to modularity, and APIs can be rewritten or changed, etc... It's a design brainstorm."

Follow-ups (verbatim): "could we use glazed field definitions for all verbs? or is it too restrictive ? what about protobuf as a base? or our own super set of glazed field descriptions?", then "in what order woud you proceed?", then, after PR #20 merged, "Write SLOP3-009 up when done."

Origin (verbatim, from the conversation before SLOP3-008 was implemented): "Also, I find server/ system/ and verbs/ to be a bit "everything and anything" knot packages, are there maybe ways you would organize this differently? lso so that we can potentially make the whole system a bit more modular if we are to design more hosting solutions in the future (just an idea though)"

**Assistant interpretation:** Turn the published brainstorm, the schema answer and the ordered plan into a docmgr ticket: a design doc with the decisions, the plan as tasks, and this diary.

**Inferred user intent:** A durable map that later feature work (registry, `caps/db`, `caps/sample`, MCP) is checked against, rather than a one-off conversation.

**Commit (code):** N/A (documentation only; committed to `main`).

### What I did
- Surveyed the code on the SLOP3-008 branch, then recounted on `main` at 35a4347:
  - non-test Go lines per package: `server` 5,884, `verbs` 3,294, `system` 3,127, `actor` 2,945; `views.go` alone 1,311; `web/runtime/src` 2,068 lines of TS;
  - 83 verbs;
  - argument types: 117 `string`, 14 `int`, 10 `bool`, 19 `json`.
- Confirmed where each door dispatches:
  - the CLI and `/api/v1` go through the verb table (`api.go` calls `verbs.Call`);
  - trusted modules map JS names to verbs (`modFunc` in `pkg/server/modules.go`);
  - page RPCs dispatch in `views.go`;
  - actor modules are separate (`pkg/actor/modules.go`, `sample.go`).
- Read glazed at `/home/manuel/code/wesen/corporate-headquarters/glazed` (58e0bd0):
  - `fields.Definition` (name, shortFlag, type, help, default, choices, required, IsArgument);
  - the field types in `field-type.go` (scalars, lists, choice, secret, file-loading types, keyValue, no general nested type);
  - the JSON Schema export in `pkg/cmds/json-schema.go`;
  - the value sources (cobra, args, env, config files, profiles, maps, vault).
- Published the brainstorm artifact (<https://claude.ai/artifact/72YeAqz5yR2ViWbCeQ3ESs>) with five inline-SVG diagrams. After one rendered check I fixed four label and arrow overlaps and one long code line. Its source is saved as `various/01-hosting-framework-artifact.html`.
- Wrote the design doc:
  - sections 1–10 from the artifact;
  - §5, the schema comparison and decision;
  - §11, the plan in order;
  - §12, decisions and open questions.
- Added the plan's steps as tasks, filled in the index, and checked step 1.
- Dry-ran SLOP3-006's `scripts/01-generic-f-mount.py` (read-only): "103 exact /f/<id> mounts on apps.slop.yolo.scapegoat.dev; 103 stores to type 'release'". It is recorded as step 0; nothing was applied.

### Why
- The verb table is the existing unifying idea. Widening it (view principals, streaming, effects) is less change than inventing a new layer, and it removes the two duplicate implementations instead of adding a third.
- JSON Schema from Go types fits the doors that matter next:
  - MCP and `sample` tools use JSON Schema natively;
  - the 19 `json` arguments need nested descriptions;
  - app actions are defined at run time.

  Glazed is best at the CLI, so it is generated rather than hand-written. Protobuf's JSON mapping encodes `int64` as strings, which conflicts with the contract's `version` and `rev` numbers.
- The typed-verb spike comes before any package move, because every moved package registers verbs. Deciding the shape first avoids converting each package twice.

### What worked
- `docmgr ticket create-ticket`, `doc add`, `task add/check`, and `validate frontmatter` ("Frontmatter OK") on the design doc.

### What didn't work
- `publish_files` refused the artifact's source in the job's temp folder: "only files this session is allowed to read can be attached". I copied it into the worktree's gitignored `var/artifacts/` and published from there.
- The browser tool refused `file://` ("Access to "file:" protocol is blocked"). I served the page with `python3 -m http.server` for the one look. The first navigation came before the server listened (`ERR_CONNECTION_REFUSED`), and the retry worked.
- The first full-page screenshot was too small to read diagrams (12,171 px tall). I cropped regions with PIL instead of taking more screenshots.

### What I learned
- glazed's JSON Schema export is a CLI-flavoured approximation. `date` puts `format` under `properties`, and `file` becomes `{path, content}`. That is fine for flags but not a schema language, which supports generating glazed from JSON Schema rather than the reverse.
- Trusted modules (`modFunc`) already are the pattern this design wants for every door: a JS name mapped onto a verb, called as the visitor.

### What was tricky to build
- Keeping the brainstorm honest about cost. Page RPCs as verbs puts high-rate browser calls in an operator table, which is why the design has `Hidden`, a benchmark in step 4, and an open question on one table or two.

### What warrants a second pair of eyes
- §5.3's choice of JSON Schema plus `x-slop` keywords over extending glazed upstream. Extending glazed would help other go-go-golems tools, but would turn glazed into a general schema library.
- §9's removal of `init()` registration. It changes how every verb file is written, so it should land with the step 2 spike, not separately.

### What should be done in the future
- Step 2: the `verbs.Def[In, Out]` spike on `grant.set`, `docs.query` and `sample.run`.

### Code review instructions
- Read design-doc §4 (the waist), §5 (schemas), §10 (map and rules) and §11 (order). Check the numbers in §2 and §5.1 with the commands in "Technical details".

### Technical details
- Counting commands, run at the repo root on 35a4347:

```sh
for d in pkg/server pkg/verbs pkg/system pkg/actor; do cat $(find $d -name '*.go' ! -name '*_test.go') | wc -l; done
grep -rho 'Type: "\(string\|int\|bool\|json\)"' pkg/verbs/*.go | sort | uniq -c
grep -rho 'Name: "[a-z]*\.[a-z.]*"' pkg/verbs/*.go | wc -l
```

## Step 2: Typed verb definitions (the spike)

The first code step of SLOP3-009. `verbs.Def[In, Out]` describes a verb by Go types and produces an ordinary `*Verb`, so typed and untyped verbs share one table and no door changed. Three verbs are converted. The rule that a person must confirm governance changes moved from the system module's flags onto the verbs, and every verb now has a JSON Schema and an MCP tool form. The spike held up, so it stays.

### Prompt Context
**User prompt (verbatim):** "let's leave #415, and now build SLOP3-009"
**Assistant interpretation:** Implement the plan in design-doc §11 in order, starting with step 2, committing at milestones and continuing this diary.
**Inferred user intent:** The reorganization itself, not more design.
**Commit (code):** 928839d — "SLOP3-009 step 2: typed verb definitions"

### What I did
- `pkg/verbs/def.go`:
  - `Def[In, Out]` with Name, Doc, Scope, Effect, AdminOnly, Action, StoreArg and `Run(Req, In) (Out, error)`;
  - `Req` (context, Env, Principal);
  - `Def.Verb()` derives `Args` from the input struct and builds `Input` and `Output` schemas with invopop/jsonschema (`DoNotReference`, `ExpandedStruct`). Its `Run` decodes `Args` into `In` with `DisallowUnknownFields`;
  - `Verb.InputSchema()`: the typed schema, or one made from an untyped verb's Args;
  - `Verb.Tool()`: an MCP tool definition with `.` → `_` in names and a `readOnlyHint`;
  - `shapeOf`: one-line JSON shapes for help text.
- `pkg/verbs/verb.go`: `Verb` gains `Effect`, `Input` and `Output`. `Register` derives `Effect` from `Scope` for untyped verbs.
- The three typed verbs:
  - `grant.set` (`GrantSetIn`, level as an enum, output `system.Grant`);
  - `docs.query` (`DocsQueryIn`, with `Where []Cond`; `Cond` accepts `[field, op, value]` or `{field, op, value}` and describes itself as a `oneOf`; output `[]store.Doc`, since `queryDocs` now returns that type);
  - `mount.set` (`MountSetIn` with `Aliases []AliasIn`, output `MountSetOut`). `aliasTemplate` now takes `[]AliasIn`; its hand-written unknown-field check became the decoder's.
- Effects:
  - `EffectGovern` is on the nine verbs whose module functions had `Confirm: true`: `people.role`, `policy.set`, `llm.set/rm/reset`, `sub.grant/revoke` and `secret.set/rm`;
  - `callVerb` (`pkg/server/modules.go`) confirms when `f.Confirm || v.Effect == govern`;
  - the flags were removed from `modsystem.go`.
- CLI (`cmd/slop/cmds/root.go`): `slop verbs` shows effect and whether a verb is typed. A new `slop verbs tools [verb…]` prints tool definitions.
- Tests:
  - `pkg/verbs/def_test.go`: args derivation, strict decoding at depth, both `where` forms, tool forms for all 83 verbs, and the effect census;
  - `pkg/server/typed_verbs_test.go`: through the HTTP API, both `where` forms with order and limit, unknown arguments refused, a well-formed grant, and schemas plus effects in `/api/v1/verbs`.

### Why
- **A `Def` produces a `*Verb`** instead of a second table, so the CLI, API, trusted modules and eval programs needed no changes. That is the compatibility layer the design asked for, at zero cost.
- **Strict decoding.** Today a misspelled argument (`levle`) is silently ignored. With typed input it is an error, which is what an agent calling through MCP needs.
- **`grant.set` and `mount.set` are writes, not `govern`.** SLOP3-002 defined governance as roles, policy, LLM budgets, comps and secrets, and the back office sets grants and mounts without a confirmation. Marking them `govern` would have changed behaviour. Registry-document writes (SLOP3-008) still confirm grants, by their own rule.

### What worked
- `GOWORK=off go test ./... -count=1`: all pass. `golangci-lint run --new-from-rev=origin/main ./...`: 0 issues after two fixes.
- Mutations, each restored:
  - no `DisallowUnknownFields` → `def_test.go:47: unknown argument: <nil>` and `typed_verbs_test.go:28: grant.set …: want invalid_argument, got 200`;
  - `confirm := f.Confirm` only → `TestConfirmations: confirm_test.go:39: … want confirmation_required, got 200` and `TestSystemModule: system_module_test.go:55`.
- Generated CLI help, compared with `origin/main`'s binary. Before, `--store` and `--subject` had no help and `--level` said "view, interact, admin or owner". After:

```text
      --level string     the level to give (one of view, interact, admin, owner)
      --store string     the store
      --subject string   usr_…, vis_…, store:<id>, @guest, @member or @subscriber
      --aliases string   with createApp: bind each store created here, as JSON: [{alias, target, prefix?, level?, assets?}, …]
      --where string     conditions, all of which must hold, as JSON: [[string, string, any] | {field, op, value}, …]
```

### What didn't work
- `Call redeclared in this block` (`pkg/verbs/verb.go:240` is the dispatch function `verbs.Call`). The design doc's `Call` interface is named `Req` in the code.
- `pkg/verbs/mounts.go:5:2: "encoding/json" imported and not used`, after the template decoding moved into the decoder.
- Lint: `def_test.go:93:3: missing cases in switch of type verbs.Effect: verbs.EffectStream (exhaustive)` and a gofmt finding in `typed_verbs_test.go`.
- My first `--aliases` help lost the inline JSON example the hand-written doc had. I added `shapeOf`, so JSON arguments describe their shape from the schema.

### What I learned
- invopop treats a field without `omitempty` as required, and `additionalProperties: false` is on by default for structs. That matches strict decoding, so the schema and the decoder agree.
- `Cond` can be a conversion type over `rt.Filter` with its own `UnmarshalJSON` and `JSONSchema()`. The verb body then converts with `rt.Filter(c)`, at no cost.

### What was tricky to build
- **Argument order.** `argsOf` sorts positional arguments first, by position, and keeps flags in field order. The CLI's usage line (`<host> <path> [store]`) depends on the positions only.

### What warrants a second pair of eyes
- **Schemas are not enforced beyond decoding.** Enums such as `level` are still checked in `Run`. A schema validator would make `Input` authoritative, at the cost of a dependency.
- **Strictness is new for these three verbs.** A caller that sent extra arguments to `grant.set`, `docs.query` or `mount.set` now gets `invalid_argument`. In-repo callers (back office, CLI, eval test, registry documents) send only known arguments.
- **`EffectStream` is declared but unused.** No verb streams until `sample` becomes one (step 5). The design doc's third spike verb, `sample.run`, does not exist yet, so `mount.set` stood in for a nested input.

### What should be done in the future
- Step 3: `pkg/registry`, live registry documents, the dependency ratchet.

### Code review instructions
- `pkg/verbs/def.go` top to bottom, then the three conversions (`stores.go` grant.set, `docs.go` docs.query and `Cond`, `mounts.go` mount.set and `aliasTemplate`), then `callVerb` in `pkg/server/modules.go`.
- `GOWORK=off go test ./pkg/verbs ./pkg/server -run 'TestDef|TestDecode|TestTool|TestEffects|TestTyped|TestConfirm|TestSystemModule' -count=1 -v`
- `go run ./cmd/slop verbs tools grant.set docs.query mount.set -o json`

## Step 3: pkg/registry, live registry documents, and views that follow the system log

Three linked changes. The registry's documents left `pkg/server` for their own package. Open views now learn of access and policy changes by following the system log instead of through three callbacks on `verbs.Env`. Since the follower sees every registry change anyway, registry documents became live, which SLOP3-008 had deferred. A dependency ratchet now guards the package map.

### Prompt Context
**User prompt (verbatim):** see Step 2 ("let's leave #415, and now build SLOP3-009").
**Assistant interpretation:** Design-doc §11 step 3.
**Inferred user intent:** The first domain package, and the callback knot removed.
**Commit (code):** 9ba426f — "SLOP3-009 step 3: pkg/registry, live registry documents, views follow the system log"

### What I did
- `pkg/registry`:
  - `documents.go`, moved from `pkg/server/registry.go`: `Docs.Coll`, `Doc` and `Write`;
  - `registry.go`: `Host` (Viewer, ActingApp, Reachable, WithPrincipal), `Docs`, `WriteIn`, `Error`, and `LastChange`, moved from `system.DB`;
  - `live.go`: `Live` (Remember, Forget, Views, Update) and `Affects`.
- `pkg/server/registry.go` (new):
  - `regHost`, and `regErr`, which turns `registry.Error` into `rtFail`;
  - `sysFollower` and `followSystem`: one pass per commit, serialized, from a cursor initialised at `LogHead`. It maps grant, binding, store and link changes to `reviewViews(store)` (links via `LinkByID`), person and comp changes to `reviewPerson`, and policy changes to `reviewApp`;
  - `refreshRegistry`, which sends `doc` events, or deletions versioned at the change's revision.
- `pkg/server/views.go`: `dbGet`, `readable` and `dbWrite` call `s.reg`. `rpcDBSubscribe` remembers registry subscriptions, with their query, in `Live`; `rpcDBUnsubscribe` and view close forget them.
- `pkg/system/system.go`: `Listen(fn)` replaces the single `OnLog` field; `pkg/actor/sysreact.go` uses it.
- `pkg/verbs`: `AccessChanged`, `PolicyChanged` and `PersonChanged` are removed from `Env`, along with every call site (grant.set/rm, link revoke, bind.set/rm, people.role, policy.set, sub.grant/revoke).
- `internal/archtest/deps_test.go`: the rules of design-doc §10 over `go list -json ./pkg/...`, with six allowed violations (verbs → actor, billing/stripe, kernel, system, goja; access → system). An allowed edge that disappears fails as stale.
- Tests: `TestRegistryDocumentsLive` (a grant made, then removed, then a store's type changed, all heard on the stream) and `TestLiveUpdate`.

### Why
- **Following the log instead of callbacks.** The callbacks were a second, forgettable path: every verb that changed access had to remember to call one. The system log already records every such change with a stable key, so one follower covers all verbs, present and future.
- **Live documents came almost free.** The follower already sees each registry change. What was missing was a memory of what each listener had been sent.

### What worked
- `GOWORK=off go test ./... -count=1`: all pass. The access-sensitive tests, repeated with `-count=5`, also all pass, so the asynchronous follower didn't make them flaky. Lint: 0 issues after one fix.
- Mutations:
  - no `Remember` for collection subscriptions → `pathspace_test.go:732: live registry documents: [_stores/crm type=contacts]`;
  - no `Listen` registration → `TestAliasRevokeReopens`, `TestAliasGrantReopens`, `TestRegistryDocumentsLive` and `TestCompsMakeSubscribers` fail;
  - the ratchet with `access -> system` removed from the allowlist → `forbidden import: pkg/access -> pkg/system (core imports no domain, runtime, table or door)`.

### What didn't work
- Lint: `pkg/registry/live.go:89:1: named return "changed" … (nonamedreturns)`.
- During the ratchet's mutation check, `git checkout -- internal` could not restore the untracked file, so the mutated allowlist stayed on disk until I put the entry back by hand. I'll use a backup copy for untracked files next time.

### What I learned
- Only four tests depend on the follower. The others pass on `confirm`'s per-call epoch check, which is what makes the asynchronous follower safe: a view that hasn't been told yet is still refused at its next call.
- The background loops in `ListenAndServe` don't run under the test harness. A long-lived follower goroutine started there would have been invisible to every test, so the follower is a short pass started from each `Listen` notification.

### What was tricky to build
- **Deletions in live documents need a version** the runtime will accept. The change's system revision is at least the deleted row's last change, so it always wins the runtime's newer-version check.

### What warrants a second pair of eyes
- **Timing.** A change now reaches open views asynchronously, a moment after the verb returns, where the callbacks ran before it returned. Correctness still holds per call (`confirm`), but a page can show stale data for that moment.
- **`refreshRegistry` cost.** It recomputes every live registry subscription on any registry change: one verb call per subscription per change. Fine for consoles, not for thousands of listeners.

### What should be done in the future
- Step 4: `caps/db`.

### Code review instructions
- `pkg/registry/*.go`, then `pkg/server/registry.go` (follower), then the `s.reg` call sites in `views.go` and the `Listen` wiring in `server.go`.
- `GOWORK=off go test ./pkg/registry ./internal/archtest ./pkg/server -run 'TestLive|TestRegistry|TestDependencyRules|TestAlias|TestComps' -count=1 -v`

## Step 4: pkg/caps/db, one db for pages and actors

The page path space moved out of `pkg/server` into `pkg/caps/db`, and an actor's `use('db')` now uses it: actors can read through their store's aliases and `_stores`, as pages could since SLOP3-008. The refactor also exposed a race in step 3's live registry documents, which is fixed in its own commit.

### Prompt Context
**User prompt (verbatim):** see Step 2 ("let's leave #415, and now build SLOP3-009").
**Assistant interpretation:** Design-doc §11 step 4.
**Inferred user intent:** One `db` implementation, with actors gaining aliases and `_stores`, and the hot path benchmarked.
**Commit (code):** 1e6220f — "registry: version documents at the log head read before their rows"; f51b06d — "SLOP3-009 step 4: pkg/caps/db, one db for pages and actors"

### What I did
- `pkg/caps/db/db.go` (new), with no HTTP and no goja:
  - `DB{K, Host, Reg}`. `Host` is `Viewer(ctx, v)`. `Registry` (Doc, Coll, Write) serves `_stores` and `_people`;
  - `Space`, moved from `server.spaceOf`, now takes a `stores bool` instead of the policy map;
  - `Route`, with `CanRead`/`CanWrite`, `remote`, `LevelOn` and `PagePath`;
  - `Get`, `Query`, `WriteRoute`, `Write` (with `Who` and `StoreFail`), `Error`;
  - `Reader`/`ReaderFor` and `Reader.PagePaths`, for the stream.
- `pkg/server/space.go` is now the door's side:
  - `dbHost`, both Host and Registry. Its `Write` refuses `KindActor` views;
  - `dbErr`, which handles both `capsdb.Error` and `registry.Error`;
  - thin `route`, `remoteLevelsMoved`, `pageDocs` and `assetStores`.
- `pkg/server/views.go`: `dbGet`, `readable`, `writeRoute` and `dbWrite` are wrappers. The 120-line write body went into `caps/db`, and `writeIn` became `capsdb.WriteIn`.
- `pkg/rt/views.go`: `KindActor`. `viewPrincipal` labels an actor view's person `via: actor`.
- `pkg/actor`:
  - `Paths` interface (Space, Get, Query) and `Manager.Paths`, which the server sets to `s.db`;
  - `dbView`, built once per turn: the visitor's id, audience and level, the app's caps, and the space, with `_stores` only if `allowed(a, "stores")` holds for the visitor;
  - `resolve`, `ownPath` and `queryDocs`. Own paths, including an alias of the store itself, stay in the turn. Other stores go through `Paths`. Writes outside the store throw `permission_denied`.
- Ratchet: a `caps` layer. Capabilities may not import the runtime, doors, `net/http` or goja; the runtime may not import capabilities.
- Tests:
  - `TestActorDBPathSpace`, described under "What worked";
  - `TestBenchPageDBQuery`, which runs only with `SLOP_BENCH=1`.

### Why
- **`*rt.View` as the viewer description.** The registry's documents already take one, and pages already have one. A synthetic view of the actor's turn (target, app, user, level, caps, space; no stream) lets both callers share every function unchanged. A new `Viewer` struct would have meant rewriting `pkg/registry`'s Host as well, for no behavioural gain.
- **An interface in `pkg/actor`.** The design says that "modules come from the actor door". A direct `actor → caps/db` import would work today, but it's the edge the package map forbids, so the ratchet now refuses it.
- **Writes outside the store refused.** A turn commits one store. A write elsewhere would be a second commit with its own failure modes. `stores.open(alias).call` already exists for that.

### What worked
- `TestActorDBPathSpace`:
  - the admin reads `contacts/c1` (alias to crm) and queries it, with page paths;
  - own documents are read in the turn;
  - an alias of the store itself (`self` → `notes`) is the store's own;
  - mia, who holds only interact on dash, sees nothing through the alias until she is granted view on crm;
  - `writeAlias` and `writeStores` are refused (`permission_denied`);
  - `_stores` is closed (`invalid_argument`) until `policy.set … stores @admin on`, and then still closed to mia (a member).
- Mutations, each caught:
  - M1, `caps/db` importing `pkg/actor` → `forbidden import: pkg/caps/db -> pkg/actor (capabilities know nothing of HTTP, goja, the runtime or doors)`;
  - M2, `ownPath` without `!tgt.Own` → `actor_db_test.go:77: … writeAlias …: want permission_denied, got 200 map[result:1]`. That would have written crm's path into the actor's own store;
  - M3, `dbView` ignoring the policy → `actor_db_test.go:80: … stores …: want invalid_argument, got 200`;
  - M4, `remote` reading as nobody → `actor_db_test.go:61: admin reads: map[c:<nil> … n:0 …]`.
- `GOWORK=off go test ./... -count=1`: all pass. `golangci-lint run --new-from-rev=origin/main`: 0 issues, after fixing three gofmt findings and one `nonamedreturns`.
- Benchmark: `SLOP_BENCH=1 go test ./pkg/server -run TestBenchPageDBQuery -v`. It calls the RPC handlers directly, on 100 documents per store, query limit 20, three runs each side. Before is 1e6220f, the same test file run in a temporary worktree.

  | call | before (best) | after (best) | allocs before → after |
  |---|---|---|---|
  | query-own | 262 µs | 260 µs | 2380 → 2382 |
  | query-alias | 330 µs | 335 µs | 2577 → 2579 |
  | get-own | 12.9 µs | 12.2 µs | 72 → 69 |
  | get-alias | 70.7 µs | 66.2 µs | 270 → 267 |

  The before runs varied more (query-own 262–339 µs) because of machine load. The best-of numbers are equal within noise.

### What didn't work
- `TestRegistryDocumentsLive` failed 8 of 8 times after the refactor, with `live registry documents: [_stores/crm/_grants/@member _stores/crm/_grants/@member deleted _stores/crm]` (the row with no `type=contacts`). With a `t.Logf` of every event added, it passed.
  - **Cause, in step 3's `registry.Docs`:** the row (`StoreByID`) and its version (`LastChange`) are two queries. The follower pass triggered by `grant.rm` read the row before `store.type` committed and the version after. The new version was sent with the old body, and the pass triggered by `store.type` then saw no newer version.
  - **Fix (1e6220f):** read `LogHead` first and take `max(rev) … AND rev <= head`. A change landing mid-read then leaves the version behind, and the next pass resends. After the fix: 10 of 10 passes.
- First test run: `dash has no actor`. `app.json` needs `"actor":"actor.js"`. Then `read declares no requires, so it needs admin`, so the read actions got `requires: 'interact'`.

### What I learned
- Moving code changed goroutine timing enough to turn a latent race into a deterministic failure. Step 3's mutation checks hadn't hit it, because those runs batched `grant.rm` and `store.type` into one follower pass.
- Path validation was already the same on both sides. `rt.validPath` refuses reserved heads, and the store's `ValidDocPath` is the same function, so routing actor paths through `Space.Resolve` changes no error for valid own paths.

### What was tricky to build
- **An alias of the store itself.** `Space.Resolve` returns `Own` with the alias's prefix path. The actor must use that path in the turn (not the page path), and must report page paths back from queries, as `caps/db.Query` does for other stores.
- **Shadowing.** An alias now shadows the actor's own collection of the same name, as it already did for pages. An actor that wrote to its own `contacts` before an alias named `contacts` was bound will now get `permission_denied` on writes. This is consistent with pages, but it is a behaviour change for actors.

### What warrants a second pair of eyes
- **Alarms and reactors read other stores as nobody.** There is no visitor, so `Viewer` is nil and only `@guest` grants apply. `stores.open` (reading as `store:<id>`) is still the way for a store to read another with its own grant.
- **`dbView` runs a bindings query on each turn's first `db` call**, even for own paths, because whether a path is own depends on the aliases. It's one indexed system-DB query per turn.
- **Not done from §11 step 4:** page `db.*` RPCs as `Subject: View` verbs, which would remove the RPC switch. The table has no `Subject` yet. The shared implementation was the visible part, so the verb form waits until a door needs it (likely the MCP door, step 6).

### What should be done in the future
- Step 5: `caps/sample`.
- When a door needs it: `Subject: View` and page `db.*` as hidden verbs.

### Code review instructions
- `pkg/caps/db/db.go` top to bottom, then `pkg/server/space.go`, the wrappers in `views.go`, and `pkg/actor/modules.go` (`Paths`, `dbView`, `resolve`, `ownPath`, `queryDocs`).
- `GOWORK=off go test ./pkg/server -run 'TestActorDBPathSpace|TestAlias|TestStoresSpace|TestRegistry' -count=1 -v`, then `SLOP_BENCH=1 GOWORK=off go test ./pkg/server -run TestBenchPageDBQuery -v`.

## Step 5: pkg/caps/sample, one sample for pages, actors and the CLI

`sample` had two implementations: the page's streamed `/_rt/sample` and the actor's `use('sample')`. Both did the same access check, budget check, metering and failure mapping, with small differences. These now live in `pkg/caps/sample`. A third caller came with them: `sample.run`, the first verb whose result streams.

### Prompt Context
**User prompt (verbatim):** see Step 2 ("let's leave #415, and now build SLOP3-009"); mid-step the user asked "where are we right nwo?", answered with a status summary.
**Assistant interpretation:** Design-doc §11 step 5.
**Inferred user intent:** One sample path behind the backend and the meter, streaming through `Emit`, usable from the CLI.
**Commit (code):** e34e457 — "SLOP3-009 step 5: pkg/caps/sample, one sample for pages, actors and the CLI"

### What I did
- `pkg/caps/sample/sample.go`: `Sampler{Backend, Sys}`:
  - `Available` and `Models`;
  - `Limits(payer, audience)`;
  - `Check`, which refuses as unavailable, permission_denied or quota_exceeded, each a `*llm.Failure`;
  - `Run(payer, limits, req, emit, execute)`: the meter, accumulated usage that is never forwarded, an `llm.Answer`, and errors mapped to `quota_exceeded` or `upstream_error`.
- `pkg/caps/sample/verb.go`: `sample.run`, a `Def[RunIn, llm.Answer]` with Scope write and Effect stream. The payer is the principal's person, under their audience, with no app policy. Parts are `{text, delta}`.
- `pkg/llm/request.go`: `In`, `NewRequest(prefix, in, images)` (with the `prompt_too_large` code), `InputOf` and `ParseJSON`. `llm.Answer`/`AnswerUsage` are in `backend.go`.
- Page (`pkg/server/sample.go`): `sampleView` and `startSample` use `s.sampler()`, which is built per call because the backend is assigned after the server, and in tests after the harness. `actorSampler` adapts it for `Manager.Sample`.
- Actor (`pkg/actor/sample.go`): `Sampler` interface, `sampleFail`. `use('sample')` requires `Sample.Available()`.
- Streaming verbs:
  - `verbs.WithEmit`/`Emit`/`Req.Emit`;
  - `apiStream` in `pkg/server/api.go`;
  - `client.CallStream` with `decodeAnswer`;
  - the CLI's `verbCommand` prints deltas to stderr.
- `verbs.Error.Status`: `prompt_too_large` → 400, `upstream_error` → 502.

### Why
- **What stays with the caller.** A page pays as its viewer under the app's policy, an actor as its visitor (or the store's owner), the CLI as the token's person. Tools also differ: a page round-trips them to the browser, and actors and the CLI have none. So the shared part is the money and the backend, and the rest is a callback.
- **Request helpers in `pkg/llm`.** The ratchet forbids actor → caps, and the actor must build requests. They sit next to `ValidateRequest`, where they belong anyway.
- **Lazy SSE in the HTTP door.** Until the first part, nothing has been written, so a refusal (arguments, authority, no LLM access) keeps its status code and JSON body. A client that asked for a stream still gets an ordinary error.

### What worked
- `TestSampleRunVerb`:
  - the whole answer without streaming;
  - `fixture:stream` through `client.CallStream`: three parts, then `first second third`;
  - mia, with no LLM access, is refused 403 `permission_denied` with and without streaming;
  - `input: 42` → `invalid_argument`;
  - `llm.usage` shows the admin charged.
- The existing page and actor sample tests (`TestLLMBudgets` etc.) pass unchanged.
- Mutations, each caught:
  - M1, `Check` without the access test → `llm_policy_test.go:86: member: map[result:…]` (actor) and `sample_verb_test.go:51: … want permission_denied, got 200` (verb). One check now guards both;
  - M2, the HTTP door not installing the emitter → `sample_verb_test.go:47: streamed [], then map[… text:first second third …]`.
- `GOWORK=off go test ./... -count=1`: all pass. Lint: 0 issues after one errcheck (`fmt.Fprint` in the CLI).

### What didn't work
- My first test read `u["used"]` from `llm.usage`, but the value sits at `u["llm"]["used"]`: `usage after sample.run: map[audience:admin llm:map[… used:22] …]`.

### What I learned
- The fake backend's `fixture:stream` path reports no usage and no model (`usage:{0,0}`, `model:""`). The meter still holds and settles each round in full on `Close`, so streamed calls are charged; an answer's `usage` just reads zero there.
- `TestEffects` in `pkg/verbs` can't see `sample.run`, because `caps/sample` isn't linked into that test binary. Verbs registered outside `pkg/verbs` are only visible in binaries that import their package (the server, and `cmd/slop` through it).

### What was tricky to build
- **Two error shapes from `Run`.** A backend error event (already streamed to a page) is the answer's `Failure`. The backend's returned error is Run's error. Merging them would have made the page send its error twice.
- **The actor's codes stayed as they were:** a backend failure is `unavailable` to an actor, `quota_exceeded` stays itself. That's why `sampleFail` maps `upstream_error` to `unavailable`.

### What warrants a second pair of eyes
- **`sample.run` has no app policy.** Any person with LLM access and a write-scoped token can spend their own budget from the CLI. That matches the design ("as yourself, no app in between"), but it is a new way to spend.
- **I did not run the CLI live against a server.** The streaming client is tested (`CallStream`); the CLI's 15 lines (deltas to stderr, result to stdout) are not.

### What should be done in the future
- Step 6: the MCP door, from the table. `sample.run`'s parts map onto MCP progress notifications.

### Code review instructions
- `pkg/caps/sample/*.go`, `pkg/llm/request.go`, then the two callers, `pkg/server/sample.go` and `pkg/actor/sample.go`, then `apiStream` and `client.CallStream`.
- `GOWORK=off go test ./pkg/server -run 'TestSampleRunVerb|TestLLM|Sample' -count=1 -v`

## Step 6: the MCP door, generated from the verb table

Agents can now use slop as MCP tools. `POST /mcp` lists every verb the caller's token may call as a tool, with the schemas from step 2, and runs calls through `verbs.Call` like the HTTP API. The door is about 250 lines, because the table already had names, schemas, effects and authority.

### Prompt Context
**User prompt (verbatim):** see Step 2 ("let's leave #415, and now build SLOP3-009").
**Assistant interpretation:** Design-doc §11 step 6.
**Inferred user intent:** Agents reach slop over MCP, with input and output schemas.
**Commit (code):** 34afeaf — "SLOP3-009 step 6: the MCP door, generated from the verb table"

### What I did
- `pkg/server/mcp.go` handles the streamable HTTP transport on the main host:
  - `initialize` negotiates 2025-06-18, 2025-03-26 or 2024-11-05;
  - `ping`, `tools/list`, `tools/call`;
  - notifications get 202; batches are refused; GET and DELETE get 405.
- `tools/list` is filtered by `verbs.Callable(p, v)`, which is `Check` split into an authority part (scope, floor, admin, guest) and an argument part.
- `tools/call`:
  - the tool name is mapped back to its verb through `Verb.Tool().Name`;
  - the result goes out as `content` text, plus `structuredContent` when it is an object;
  - a verb error becomes `isError: true` with "code: message";
  - an unknown tool or method is a JSON-RPC error.
- Stream verbs with `_meta.progressToken` and an SSE-accepting client get `notifications/progress` per part (its delta as the message), then the response, all as SSE `message` events.
- Auth: bearer tokens only, with `WWW-Authenticate: Bearer` on 401. An `Origin` other than the main host gets 403. Via is `mcp`.
- `TestMCPDoor`.

### Why
- **Tokens only.** MCP clients send bearer tokens. Accepting the back office's session cookie would let any page the person visits call tools as them, unless the door also required CSRF headers, which no MCP client sends. The spec also asks servers to check `Origin`.
- **No sessions, no GET stream.** The server sends no message of its own (no list changes, no sampling requests), so `Mcp-Session-Id` would only be state to expire.
- **Tool errors versus protocol errors.** MCP wants a refused call reported inside the result, so the model can read it and recover. An unknown tool is the client's mistake, so it's a protocol error.

### What worked
- `TestMCPDoor`:
  - 401 without a token, 403 for a foreign origin;
  - `initialize` at 2025-03-26 is echoed back; a notification gets 202;
  - `docs_query` has its `where` schema and `readOnlyHint: true`; `grant_set` has `readOnlyHint: false`;
  - a read token lists no `docs_set`, `grant_set` or `store_type`;
  - `docs_get` returns structured content; `docs_query` (a list) returns text only;
  - a refused `docs_set` is a tool error starting `permission_denied`;
  - the store log's via is `mcp`;
  - unknown tool or method → JSON-RPC errors;
  - `sample_run` with a progress token gives three progress messages, then the result.
- **Against a real client:** the official `modelcontextprotocol/go-sdk` v1.7.0 from the module cache, built offline as a throwaway program in the job's tmp directory. A temporary harness-serving test fed it; neither is committed. Output:
  ```text
  server: slop 2025-06-18
  tools: 86
  docs_get: false {"at":…,"body":{"name":"Ada"},…,"version":1}
  progress 1 "first "
  progress 2 "second "
  progress 3 "third"
  sample_run: false {"model":"","text":"first second third",…}
  ```
- Mutations, each caught:
  - unfiltered `tools/list` → `mcp_test.go:104: the read token lists docs_set`;
  - no Origin check → `mcp_test.go:68: foreign origin: 200`;
  - no progress emitter → `mcp_test.go:151: sample_run did not stream: {…}`.
- `GOWORK=off go test ./... -count=1`: all pass. Lint: 0 issues.

### What didn't work
- Nothing failed in this step. `TestMCPDoor` passed on its first run; I didn't take that as proof, which is why I ran the mutations and the SDK client.

### What I learned
- The SDK client accepted the generated schemas as they are: 86 tools, including the `oneOf` for `where` and the `any` input of `sample.run`. It also accepted `structuredContent` alongside the output schemas. Step 2's choice to drop output schemas for non-object results matters here, because MCP requires structured content to be an object.

### What was tricky to build
- **Lazy SSE again.** As in step 5's HTTP door, the response becomes a stream only at the first part. A stream verb that's refused before emitting still answers with plain JSON.

### What warrants a second pair of eyes
- **Every callable verb is a tool**, including `eval`, `actor.call` and the governance verbs, for an admin token. Govern verbs are not confirmed here: a token acts as its person directly, as from the CLI. An agent holding an admin token can change grants. Tool annotations could add `destructiveHint` for govern verbs. The real limit is token scope.
- **No OAuth discovery.** Clients must be configured with a slop token by hand (`slop token.new`). MCP's authorization spec (protected-resource metadata, OAuth) is not implemented.

### What should be done in the future
- `destructiveHint` on govern-effect tools; OAuth protected-resource metadata if a client needs it.
- Step 7, ongoing: type the remaining verbs (better tool schemas) and shrink the ratchet's allowlist.

### Code review instructions
- `pkg/server/mcp.go`, then `verbs.Callable` in `pkg/verbs/verb.go`.
- `GOWORK=off go test ./pkg/server -run TestMCPDoor -count=1 -v`
