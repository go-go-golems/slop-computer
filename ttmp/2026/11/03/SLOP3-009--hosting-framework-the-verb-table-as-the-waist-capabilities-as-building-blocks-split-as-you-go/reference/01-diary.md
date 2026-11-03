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
