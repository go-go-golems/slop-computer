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
RelatedFiles: []
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
