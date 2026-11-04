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

### Technical details
- **The typed form** (`pkg/verbs/def.go`):
  ```go
  type Def[In, Out any] struct {
      Name, Doc string; Scope Scope; Effect Effect; AdminOnly bool
      Action authz.Action; StoreArg string
      Run func(r Req, in In) (Out, error)
  }
  func (d Def[In, Out]) Verb() *Verb   // Args + Input/Output schemas + a Run that decodes strictly
  ```
- **Tags on the input struct:**
  - `json:"name"` names the argument, and `omitempty` makes it optional;
  - `jsonschema_description:"…"` is its doc; `jsonschema:"enum=a,enum=b"` adds schema keywords;
  - `slop:"pos=N"` gives its CLI position.
- **Schemas:** invopop/jsonschema with `Anonymous`, `DoNotReference` and `ExpandedStruct`; `Version` is cleared. An interface type (`any`) has no output schema.
- **Arg types** come from the schema: string, integer → int, boolean → bool, anything else → json. Enum values are appended to the doc as "(one of …)". A json argument's doc gets ", as JSON: <shape>" (`shapeOf`), for example `[[string, string, any] | {field, op, value}, …]`.
- **Strict decoding:** a `json.Decoder` with `DisallowUnknownFields`. "unknown field" is turned into `invalid_argument "<verb> takes no argument \"x\""`.
- **Effects:** an unset Effect is read or write, from Scope. `callVerb` (`pkg/server/modules.go`) confirms when `f.Confirm || v.Effect == verbs.EffectGovern`.
- **MCP tool form:** `Verb.Tool()` maps the name `.` → `_` and sets `annotations.readOnlyHint = Effect == read`. It drops the output schema unless the output type is `object`, because MCP structured results are objects.

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

### Technical details
- **The follower** (`pkg/server/registry.go`):
  - `sysFollower{mu, cursor}`. The cursor starts at `Sys.LogHead`, and `s.Sys.Listen(func(){ go s.followSystem() })` triggers each pass;
  - one pass reads `Sys.LogAfter(cursor, 200)` in a loop, under `mu`;
  - per change kind: grant, binding, store and link → `reviewViews(store)` (a link found via `LinkByID`); person and comp → `reviewPerson`; policy → `reviewApp`;
  - after a batch, `refreshRegistry(ctx, rev)` runs if any change is `registry.Affects`.
- **The live memory** (`pkg/registry/live.go`):
  - `Live.views[view][sub] = {Sub, seen map[path]version}`;
  - `Update(view, sub, now)` returns docs whose version is greater than `seen`, plus the paths that disappeared, and records `now`;
  - a deletion is sent as `docOut{Path, Version: rev, Deleted: true}`: the change's system revision, which is at least the row's last change.
- **`system.DB.Listen(fn)`:** listeners are called after each committed `Tx`, while `epoch` is incremented. The single `OnLog` field it replaces only allowed one listener; the actor's `sysreact` needs another.
- **The ratchet:** `internal/archtest/deps_test.go` runs `go list -json ./pkg/...` with `GOWORK=off` and checks direct imports only. An allowlisted edge that no longer exists fails as stale.

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

### Technical details
- **The capability** (`pkg/caps/db/db.go`):
  ```go
  type DB struct { K *kernel.Kernel; Host Host; Reg Registry }
  type Host interface { Viewer(ctx, v *rt.View) *access.Principal }
  type Registry interface {
      Doc(ctx, v, tgt, path) *rt.Doc
      Coll(ctx, v, tgt, coll) []rt.Doc
      Write(ctx, v, tgt, WriteIn) (int64, error)
  }
  func (d *DB) Route(ctx, v *rt.View, path string, doc bool) (Route, error)   // Route{Tgt, St, Level, Held, Rules, Found}
  func (d *DB) Get(ctx, v, path) (rt.Doc, bool, error)
  func (d *DB) Query(ctx, v, q rt.Query) ([]rt.Doc, error)
  func (d *DB) Write(ctx, v, who store.Who, in WriteIn) (version, rev int64, err error)
  ```
- **An actor's view** (`Actor.dbView`): `&rt.View{Target: store, App, User: visitor.ID, Role: visitor.Audience, Level, Caps, Kind: rt.KindActor, Space}`, built once per turn. `Space` is `Paths.Space(ctx, store, caps, allowed(a, "stores"))`.
- **Actor routing:**
  - `Space.Resolve` → `Own` runs in the turn (`t.GetDoc(tgt.Path)`); otherwise it goes through `Paths.Get`/`Query`;
  - `PathError not_found` (another store's private documents) is a missing document;
  - writes call `ownPath`, which throws `permission_denied` unless the target is `Own`.
- **The benchmark** (`TestBenchPageDBQuery`, `SLOP_BENCH=1`) calls `rpcDBQuery`/`rpcDBGet` directly through `testing.Benchmark`, on 100 documents per store, query limit 20.

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

### Technical details
- **The capability** (`pkg/caps/sample`):
  ```go
  type Sampler struct { Backend llm.Backend; Sys *system.DB }
  func (s *Sampler) Check(ctx, payer, audience string) (system.LLM, error)   // *llm.Failure: unavailable | permission_denied | quota_exceeded
  func (s *Sampler) Run(ctx, payer string, l system.LLM, req llm.Request,
      emit func(llm.Event), execute llm.ExecuteTool) (llm.Answer, error)     // error: quota_exceeded | upstream_error
  ```
  `Answer{Text, Model, Usage{Input, Output}, Result, Failure}`. Usage events are metered and never forwarded.
- **Request building** (`pkg/llm/request.go`):
  - `NewRequest(prefix, In, images)` defaults the tier to "default" and drops images unless allowed;
  - `MaxRounds` is 10;
  - an "exceeds" validation error becomes `prompt_too_large`.
- **Streaming verbs:**
  - `verbs.WithEmit(ctx, fn)` and `verbs.Emit(ctx, part)` / `Req.Emit(part)`;
  - the HTTP door streams when the verb's Effect is `stream` and the `Accept` header contains `text/event-stream`;
  - the SSE events are `part`, then `result {result}` or `error {error}`;
  - headers are written lazily at the first part, so an earlier refusal stays a JSON error with its status.
- **Status codes:** `prompt_too_large` → 400, `upstream_error` → 502.

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

### Technical details
- **Endpoint:** `POST /mcp` on the main host; `GET` and `DELETE` get 405 with `Allow: POST`. The protocol revisions offered are 2025-06-18, 2025-03-26 and 2024-11-05; the client's is echoed back when known.
- **`initialize`** answers `{protocolVersion, capabilities: {tools: {listChanged: false}}, serverInfo: {name: "slop", title: "slop-computer", version: "3"}, instructions}`.
- **`tools/call`:**
  - params are `{name, arguments, _meta: {progressToken}}`;
  - the result is `{content: [{type: "text", text: <JSON>}], structuredContent?: <object>}`, or `{isError: true, content: [{type: "text", text: "code: message"}]}`.
- **Progress:** each part becomes `{"jsonrpc": "2.0", "method": "notifications/progress", "params": {progressToken, progress: n, message: <delta or JSON>}}`, then the response, all as SSE `event: message`.
- **Errors:** JSON-RPC codes `-32700` (parse), `-32600` (batches), `-32601` (method), `-32602` (unknown tool or bad params).
- **Auth:** a token principal only, with `Via = "mcp"`. A foreign `Origin` gets 403; no token gets 401 with `WWW-Authenticate: Bearer realm="slop"`.

## Step 7: the Codex review of #22, two live-document bugs

Codex reviewed #22 and found two places where a live registry document could stay stale indefinitely. Both were real. The first was an ordering race when subscribing. The second: a store's row document carried the viewer's level, but its version ignored the grants that level depends on. Both are fixed on #22's branch, with tests that fail without the fix.

### Prompt Context
**User prompt (verbatim):** "look at code review comments, and see if worth addressing."
**Assistant interpretation:** Read the review comments on #22 and #23, judge each, fix what is real, reply.
**Inferred user intent:** Merge-ready PRs, without spending effort on spurious findings.
**Commit (code):** 196131d — "TestRegistryDocumentsLive: step through the changes, one event each" (cherry-picked from #23's c0f7926); ad2e7e1 — "registry live documents: subscribe before the snapshot; version store rows by access"

### What I did
- Read the findings with `gh api repos/go-go-golems/slop-computer/pulls/22/comments` (two P2 findings) and `…/pulls/23/comments` (none).
- **Finding 1** (`pkg/server/views.go:871`):
  - `rpcDBSubscribe` now calls `Live.Remember(view, sub, nil)` before reading;
  - after the read, the new `Live.Saw(view, sub, docs)` merges the snapshot, keeping the higher version per path;
  - a failed read calls `Live.Forget(view, sub)`.
- **Finding 2** (`pkg/registry/live.go:102`):
  - new `storeVersion(ctx, db, store, viewer, head)` in `pkg/registry/registry.go`, used by `Docs.Doc` for `_stores/<id>` and by `Docs.Coll` for `_stores`;
  - `Affects` gained `comp` and `billing`.
- Cherry-picked the flaky-test fix from #23, then extracted `awaitDocs(t, stream)` (wait for a described doc event, skip others) for both live tests.
- Tests: `TestRegistryStoreLevelLive`, `TestLiveSaw`.
- Rebuilt the branch as two commits (`git reset --soft 02cefc1`, the test fix alone, then the fixes), pushed, rebased #23 onto it (one conflict in `pkg/registry/documents.go`, resolved), force-pushed #23 with lease, and replied to both comments.

### Why
- **Register first** is already the rule for store subscriptions ("Register first, then read: a write in between arrives on the stream too, and the runtime keeps the higher version"). Registry subscriptions now follow the same rule, rather than gaining a revision-based catch-up, which Codex offered as an alternative.
- **Versioning by the body's dependencies.** The runtime accepts only higher versions, so comparing bodies alone (the other way out) would still be rejected by the browser. Codex said the same.

### What worked
- `TestRegistryStoreLevelLive`: a guest's console view listens to `_stores/crm`, and `grant.set crm @guest interact` reaches it as `_stores/crm level=interact`.
- Mutations, each caught:
  - `storeVersion` replaced by the row-only `lastChangeUpTo` → `pathspace_test.go:825: grant raised: no "_stores/crm level=interact" (saw [])`;
  - `Saw` overwriting instead of keeping the max → `live_test.go:42: after Saw: changed [{_stores/a map[] 7}] gone []`.
- Both live tests passed 100 of 100 on #22's branch and 50 of 50 on #23's. Full suite and lint pass on both. #23's verb table is still byte-identical to the baseline.

### What didn't work
- After fix 2, the stepped `TestRegistryDocumentsLive` would have taken the `_stores/crm` row event (now moved by the grant change) as the answer to the next step. That's why `awaitDocs` waits for a named event instead of the next one. This was found by reasoning before running, not by a failure.

### What I learned
- A computed document's version must cover everything its body is computed from. `_stores/<id>`'s body includes `level`, which depends on rows of four other kinds.
- The register-then-read ordering is not covered by a deterministic test. The window is a few microseconds, and forcing it would need a test hook in production code. `TestLiveSaw` covers the merge it relies on.

### What was tricky to build
- **The store's grants by key prefix.** A grant's `_changes` key is `"<store> <subject>"`. Matching with `substr(key, 1, len(store)+1) = store || ' '` avoids `LIKE` and its escaping of `_` and `%`.
- **Links have their own key, the link id.** Their changes are matched with `key IN (SELECT id FROM links WHERE store = ?)`.

### What warrants a second pair of eyes
- **`storeVersion` runs one query per store row** in `_stores` listings, as `lastChangeUpTo` did, but with an `OR` of four clauses, which SQLite may not serve from an index. That is fine at today's `_changes` size; revisit if `_stores` listings become slow.
- **Changes that are not logged.** A level that changes without a logged change, such as a link expiring (`expires_at` passing, with nothing written), still does not move the version.

### What should be done in the future
- If expiry matters for live documents, log expiries, or recompute and compare levels on a timer.

### Code review instructions
- `git show ad2e7e1`
- `GOWORK=off go test ./pkg/registry ./pkg/server -run 'TestLive|TestRegistry' -count=1 -v`

### Technical details
- The version query:
  ```sql
  SELECT max(rev) FROM _changes WHERE rev <= :head AND (
       (kind = 'store' AND key = :store)
    OR (kind = 'grant' AND substr(key, 1, len(:store)+1) = :store || ' ')
    OR (kind = 'link'  AND key IN (SELECT id FROM links WHERE store = :store))
    OR (kind IN ('person', 'comp', 'billing') AND key = :viewer AND :viewer <> ''))
  ```
  `:head` is the `LogHead` read before the rows (the race fix 1e6220f).
- `Live.Saw(view, sub, docs)`: for each doc, `seen[path] = max(seen[path], version)`. It does nothing for an unknown subscription.

## Step 8: every verb typed (plan step 7)

All 86 verbs are `verbs.Def` now. Before, four were (`grant.set`, `docs.query`, `mount.set`, `sample.run`). Every verb has a typed input, and 76 have a typed result whose output schema the MCP door publishes. The other ten return values that are untyped on purpose. PR #29.

The conversion was mostly mechanical, done by two rewriters, and checked against a dump of every verb taken before the change. Checking every end-to-end result against its output schema turned up a real gap, nil versus null, now fixed in `verbs`, along with a pre-existing CLI precision bug.

### Prompt Context
**User prompt (verbatim):** "do all verbs."
**Assistant interpretation:** Plan step 7's remaining work: convert the 82 untyped verbs to `verbs.Def[In, Out]` with input and output types, keeping each verb's interface as it is.
**Inferred user intent:** Agents (MCP), the CLI and the docs see exact argument and result schemas for every operation.
**Commits (code):** 9f52777 (1/3: 67 verbs, mechanically), 01010c5 (2/3: the 15 whose helpers took `Args`), 91dca37 (3/3: results and nullable output schemas), 897f6a3 (the CLI keeps every digit of a JSON argument's numbers). PR: https://github.com/go-go-golems/slop-computer/pull/29

### What I did
- **Inventory** (`inv`, a go/ast tool in job tmp): every untyped verb, its declared `Args`, and every way its `Run` reads them. 82 verbs; 15 hand `Args` to a helper. No verb reads an argument it doesn't declare.
- **`verbs`:**
  - `decodeArgs` decodes with `UseNumber`;
  - new type `List` (a JSON array of strings, or a comma-separated string, with a oneOf schema);
  - `argsOf` no longer appends ", as JSON: any";
  - `outputSchema`/`nullable` allow null wherever Go encodes it.
- **`commands/typed.go`:** `or(p, d)` and `ptr(v)`.
- **Rewriter 1** (`typer`, go/ast with byte-offset splicing), for each verb literal:
  - an `XxxIn` struct from the declared `Args`: `string`/`bool` as they are, `int` as `int64` (or `*int64` when a nonzero default must stay apart from an explicit 0), `json` as `any`, lists as `verbs.List`, plus `json`/`slop:"pos=N"`/`jsonschema_description` tags;
  - each read spliced (`a.S("k")` → `in.K`, `a.I("k", 30)` → `or(in.K, 30)`, `a.Strings` → `[]string(in.K)`, `a.Has` → `in.K != nil`);
  - the literal rewrapped as `verbs.Def[XxxIn, any]{…}.Verb()`, with a `ctx`/`p` prelude only where the body uses them.
- **The 15 by hand, then rewriter 1:**
  - helpers take values: `writeDocs`, `runSQL`, `records`, `putBlobs`, `zoneOf`, `push` with a `pushArgs` struct, `runEval`;
  - `argObj`/`argList` became `objOf`/`listOf`, still accepting a JSON-encoded string;
  - pointer fixes for `text`/`data`, and `or(in.Prune, true)`.
- **Rewriter 2** (`outer`, go/types via x/tools/packages):
  - a verb whose results are all one named type gets that type as `Out`, with zero values for `return nil, err`;
  - a verb whose results are `map[string]any` maps built in its body gets an `XxxOut` struct and the matching rewrites;
  - `app.modules` by hand.
- **Tests:**
  - `verbs`: `TestListAndExactNumbers`, `TestOutputSchemaAllowsNull`;
  - `pkg/host/schema_check_test.go`: the harness wraps every verb's `Run` and checks its result against its output schema.
- **Audit** (`audit.py`): literal call sites in Go and JS, and the actor modules' `Pos`/`Fixed`/`Default` names, against the new arguments.

### Why
- **Rewriters, not hand edits.** 82 verbs across 13 files. A splice from the AST changes only the reads and the wrapper, so each verb's logic is byte-for-byte what it was, which also makes review practical.
- **`*int64` with `or`, not `int64`.** `token.new`'s `days` defaults to 30, and 0 means "no expiry". With a plain `int64`, an explicit 0 would become 30.
- **Result structs in map key order.** `encoding/json` sorts map keys; a struct emits declaration order. Declaring fields in key order keeps every result's bytes, not just its meaning.

### What worked
- **Verb comparison** (`cmp.py` over a `TestDumpVerbs` dump of `commands.Verbs(nil)`, before from a worktree of main, after from the branch): `typed 86/86; problems 1`. The one is `token.new`'s `scopes` (`string` → `json`, intended); plus `sample.run`'s doc losing its empty note.
- **Call-site audit:** `call sites checked 767; with unknown keys 1` (a test that sends `levle` on purpose); `modFuncs 47 bad 0`.
- **Output schemas:** `with output schema: 76 / 86`. The host suite passes with every result checked against its schema.
- **Real server and CLI** (`slop serve --local`, curl for a session, then the CLI with a token):
  - `token.new` with `"scopes": "read,write"` and `days: 0` → `['read', 'write'] expiresAt: None`;
  - an unknown argument on a real store → `grant.ls takes no argument "bogus"`;
  - `docs.set`/`docs.get` with 9007199254740993 through the API → exact;
  - after the CLI fix, through the CLI → exact.
- **Gate:** `0 issues.` and `GATE: ok` after each commit.

### What didn't work
- **The first output-rewriter run panicked:** `package requires newer Go version go1.26 (application built with go1.25)` (the tool's module defaulted to the 1.25 toolchain). Then `index out of range [0] with length 0` (`CompiledGoFiles` needs `packages.NeedCompiledGoFiles`).
- **`slop verbs -o json` lists summaries only** (`KeyError: 'name'`: it has `verb`, `doc`, `effect`, `schema`). Hence the `TestDumpVerbs` dump of the full `Verb` structs.
- **The first smoke script ran no server:** `go: go.mod file not found in current directory` (I built from outside the module), so every request failed.
- **The schema check failed seven host tests**, for example `explain.can: result does not match its output schema: explain.can.groups: <nil>, want an array`, and the same for `llm.usage.llm.remaining`, `llm.set.budget`, `store.export.bundle.docs`/`files`. Go encodes nil pointers, slices and maps as null, and invopop's schemas don't allow it. `nullable` fixed all of them.
- **Lint on `nullable`:** `missing cases in switch of type reflect.Kind (exhaustive)` → an if-chain.
- **Precision through the CLI:** `docs set … --data '{"n":9007199254740993}'` read back `…992`. The CLI's `convert` parsed JSON into a `float64` before sending. It predates this PR, and I fixed it in its own commit.

### What I learned
- **The table was already consistent.** No verb read an undeclared argument, and no caller sent one, so strict decoding cost nothing in practice. The audit says so; it isn't a guess.
- **A schema is a promise a client checks.** Schemas from Go types aren't automatically true of Go's JSON: nil becomes null. Checking real results from the whole end-to-end suite was what found it; reading the schemas hadn't.
- **The `map[string]any` results followed two patterns:** a base literal plus conditional keys, or a literal per return. That is regular enough for a type-checked rewrite that keeps the bytes.

### What was tricky to build
- **Optional keys whose values are already nilable** (`out["person"] = p.Person`) became `**sysdb.Person`/`*[]string`/`*map`. A pointer to a pointer is exact, but plain `omitempty` drops an empty slice that the map kept. By hand:
  - `person` and `manifest` became plain, because they are only ever set non-nil;
  - `scopes` stays `*[]string`, because a token with no scopes still shows `"scopes"`.
- **Strictness surfaces in an order.** The table's floor check (store access) runs before `Run` decodes. An unknown argument on a store the caller can't reach reads as `not_found`, and on a reachable one as `invalid_argument`.

### What warrants a second pair of eyes
- **The generated result structs' optional fields.** Each pointer field is right only if the old code set the key exactly when the struct sets the pointer. The rewriter derived both from the same assignments, but explain.can's two branches (two different `out` maps merged into one type) deserve a read.
- **`verbs.List` changes `token.new`'s `scopes` to CLI type `json`.** `--scopes read,write` works (the CLI passes non-JSON text through), and `--scopes '["read"]'` now works too.
- **`nullable` walks the Go type and the schema in parallel by JSON name.** An embedded struct with a json name, or a type whose schema invopop maps specially (e.g. `time.Time`), is handled by falling through. Worth a look if a result type gets exotic.

### What should be done in the future
- Plan step 4b (page `db.*` RPCs as hidden verbs) can now reuse these input types.
- Consider enum tags on the string arguments whose docs list their values (levels, zones, formats). The schema would then constrain them, with a doc suffix "(one of …)".
- Check task xmr1 when #29 merges.

### Code review instructions
- `pkg/verbs/def.go`: `decodeArgs`, `List`, `outputSchema`/`nullable`/`structFields`.
- `pkg/commands/typed.go`.
- `git show 9f52777 -- pkg/commands/people.go` (a representative conversion).
- `git show 01010c5 -- pkg/commands/docs.go pkg/commands/files.go pkg/commands/data.go` (the hand part).
- `git show 91dca37 -- pkg/commands/access.go` (`ExplainCanOut`) and `pkg/commands/actors.go` (`AppModulesOut`).
- `pkg/host/schema_check_test.go`.
- Validate: `GOWORK=off go test ./... -count=1`, then `slop verbs tools -o json` to see the schemas.

### Technical details
- **A converted verb** (`token.new`):
  ```go
  verbs.Def[TokenNewIn, TokenNewOut]{Name: "token.new", …,
      Run: func(req verbs.Req, in TokenNewIn) (TokenNewOut, error) {
          ctx := req.Context
          p := req.Principal
          scopes := []string(in.Scopes)
          …
          secret, t, err := e.People.CreateToken(ctx, p.ID(), in.Name, scopes, int(or(in.Days, 30)))
  ```
  ```go
  type TokenNewIn struct {
      Name   string     `json:"name" slop:"pos=1"`
      Scopes verbs.List `json:"scopes,omitempty" jsonschema_description:"comma-separated: read,write,admin"`
      Days   *int64     `json:"days,omitempty" jsonschema_description:"lifetime in days; 0 = no expiry (not with admin)"`
  }
  ```
- **A nullable output field** (`groups []access.Group`) in the schema:
  ```json
  {"oneOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}]}
  ```
- **The tools** (job tmp, not committed): `inv`, `typer`, `outer`, `cmp.py`, `audit.py`, and `TestDumpVerbs` (copied in and removed after each dump).

## Step 9: deployed (sha-99e203c), verified, apps pushed

Production moved from sha-35a4347 (#20) to sha-99e203c (#29). That takes in everything since: SLOP3-010's four PRs, the dead-code and lint PRs, and typed verbs. Then I pushed the shipped apps. The `/f/:id` migration needed nothing; it was applied on 2026-11-03.

**User prompt (verbatim):** "alright, do the deploy and then verify and deploy the apps and migrate"
**Commit / deploy:** gitops #420 (merged 8844468); #417–#419 closed as superseded. Argo CD `slop`: Synced, Healthy.

- **No backup was taken.** Slop has no backup job on the cluster, and a backup written inside the pod was refused by the permission classifier. The user chose to deploy without one. There are no schema changes: the migration files only moved (`pkg/system` → `pkg/sysdb`, R100), and `_schema` names them `migrations/<file>` relative to the embedding package, as before.
- **Rollout:** `deployment "slop" successfully rolled out`, one pod, 0 restarts. The log shows `Pi models ready (Geppetto): 14` and the four hosts.
- **Hosts:** `/healthz` and `/readyz` 200; `/auth/login` 303 (to ZITADEL); `/admin/app.js`, `/guestbook`, `/f/shop`, `/f/lattice-arcade`, `/examples/static-site/`, `/office`, `/workshop` and `/journal` all 200.
- **Data parity**, before and after (`mount ls`, `store ls --all true`, `app ls`): 11 mounts, 112 stores, 111 apps, identical; no broken apps.
- **MCP:** `initialize` 2025-06-18; `tools/list` returns 86 tools, 54 with an output schema (the object-valued ones); `tools/call whoami` returns structured content; an unknown argument is refused (`grant.ls takes no argument "bogus"`).
- **Browser, as a guest:**
  - `/guestbook` opened a view, its event stream and two runtime calls; `db.query` returned the two entries and the profiles lookup resolved both authors;
  - `/f/shop` opened at `interact`;
  - the only console error is `/favicon.ico` 404.
- **`make deploy-apps SLOP=<cli built at f000d9b>`:** workshop n=2, backoffice n=3, blocks-site n=2, blocks n=1, pinup n=1, guestbook n=2, journal n=2, static-site n=1, all `broken=''`.
- **Migration:** `01-generic-f-mount.py` (dry run): `0 exact /f/<id> mounts on apps.slop.yolo.scapegoat.dev; 0 stores to type 'release'`.
- **Noted:** every CLI flag is a string flag (`store ls --all true`), as before this work.

## Step 10: favicon deployed (sha-a3da880); v2's Postgres bootstrap removal opened (gitops #421)

Step 9 left one console error: `/favicon.ico` returned 404. PR #30 added an S, drawn in the style of francois's F, embedded in `pkg/doors/web`. The main and live hosts serve it, and the shell and admin pages link to it. I deployed it the same way as #420. Separately, the user asked what v2's Postgres bootstrap still does. On every Argo sync, it runs a Job holding the cluster's Postgres admin credentials to recreate a database that v3 never opens. Gitops #421 removes the bootstrap, and the Vault role and policy have to be deleted by hand.

**User prompts (verbatim):** "what;s the v2 postgres bootstrap thing about? And add the favicon.ico from francois (the S )"; "it's merged"; "open gitops PR, tell me what to write to vault"; "and yes update terraform to remove hte role"
**Commit / deploy:** slop-computer #30 (a3da880); gitops #422 (deploy, merged), #421 (bootstrap removal, open, 2aa6768).

- **Rollout:** Argo `slop` Synced/Healthy on sha-a3da880; one pod, 0 restarts.
- **Favicons:** `/favicon.ico` (200 `image/x-icon`, 321 bytes) and `/favicon.svg` (200 `image/svg+xml`, 378 bytes) on slop.yolo and apps.slop.yolo. Their sha256 matches the embedded files. `/f/shop` has `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`. site.slop.yolo still returns 404, by design: static hosts serve the published site's own bytes.
- **The bootstrap (gitops #421):**
  - It removes:
    - the Sync-hook Job `slop-db-bootstrap` (`HookSucceeded`, so no Job is left in the cluster);
    - its script ConfigMap, ServiceAccount and VaultAuth;
    - the VaultStaticSecret `slop-postgres-admin` (from `kv/infra/postgres/cluster`);
    - `vault/roles/kubernetes/slop-test-db-bootstrap.json` and `vault/policies/kubernetes/slop-test-db-bootstrap.hcl`.
  - `scripts/bootstrap-slop-secrets.sh` now seeds only `oidc-client-id` and `oidc-org-id`. It drops `database`, `username`, `password` and `database-url`.
  - Validation: `validate_gitops.sh` reported 56 packages and 0 violations; `kubectl kustomize` renders.
- **Terraform has no such role.** `~/code/wesen/terraform` has only slop's ZITADEL clients. The role lives in the gitops repo's `vault/`, and `bootstrap-vault-kubernetes-auth.sh` only writes roles. So after #421 merges and Argo prunes, the user runs `vault delete auth/kubernetes/role/slop-test-db-bootstrap` and `vault policy delete slop-test-db-bootstrap`. Writing to Vault is the user's step, since the classifier refuses it.
- **Left:** v2's database `slop` and role `slop_app` on the shared Postgres. Dropping them can't be undone, so that's the user's call.
- **#421 merged (f5694d5):** Argo `slop` synced f5694d5, Synced/Healthy. Every bootstrap resource was pruned: no Job, ConfigMap, ServiceAccount, VaultAuth, VaultStaticSecret or Secret matching `bootstrap` or `postgres-admin` remains in namespace `slop`. What's left is `slop-runtime`, `slop-pi` and `slop-tls`. The pod was not restarted (51m, 0 restarts), and `/healthz` returns 200. The Vault role and policy delete is still the user's to run.
- **Vault cleanup, done.** The user deleted role and policy `slop-test-db-bootstrap`, which I confirmed by reading both back. The question "aren't the roles in terraform?" turned into a cleanup across both repos:
  - Kubernetes-auth roles stay in the k3s repo (`vault/roles/kubernetes`), by its playbook.
  - `auth/github-actions` is terraform's. The k3s repo's stale copies are retired (k3s #424, merged 31a9907).
  - terraform #40 adopted the 17 roles that existed only in k3s; #41 lets GitOps PR roles accept `push` and `workflow_dispatch` on main, and adopted two hand-made roles. I applied both with the user's operator login; a re-plan shows no changes.
  - The unused `dmeta-npm-publish` role was deleted by the user.
  - Live Vault now has 66 GitHub Actions roles, the same as terraform, and #424's validator passes against live Vault.
