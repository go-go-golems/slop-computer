---
Title: Diary
Ticket: SLOP-008
Status: active
Topics:
    - tools
    - collaboration
    - architecture
    - frontend
    - backend
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/10/29/SLOP-008--claude-blocks-on-slop-notion-shaped-live-pages-over-a-hypha-log-as-a-workshop-tool/design-doc/01-intern-guide-claude-blocks-on-slop.md
      Note: The intern guide this diary records
    - Path: repo://ttmp/2026/10/29/SLOP-008--claude-blocks-on-slop-notion-shaped-live-pages-over-a-hypha-log-as-a-workshop-tool/scripts/01-hypha-headless.js
      Note: Experiment 1 (Node)
    - Path: repo://ttmp/2026/10/29/SLOP-008--claude-blocks-on-slop-notion-shaped-live-pages-over-a-hypha-log-as-a-workshop-tool/scripts/02-hypha-goja.go
      Note: Experiment 2 (goja)
ExternalSources:
    - /home/manuel/code/others/ramon/claude-blocks
Summary: "Chronological diary for SLOP-008: Claude Blocks on slop."
LastUpdated: 2026-10-29T16:40:00-04:00
WhatFor: "How the SLOP-008 research and guide were produced, with evidence"
WhenToUse: "Before continuing SLOP-008 or reviewing its guide"
---

# Diary

## Goal

Record how SLOP-008 was researched and designed. SLOP-008 is about running Claude Blocks, a Notion-shaped workspace of live pages over one Hypha log, on slop as a Workshop tool, in the way SLOP-004 did for Pinup.

## Step 1: Blocks and slop studied, the kernel tried headless, the intern guide written

The user first asked how I would integrate Claude Blocks into slop. I answered in chat from a first read of the vault report, `blocks.js`'s storage code and Pinup's adapter. The user then asked me to study harder and turn it into a ticket with an intern guide. This step is that deeper study:
- the rest of `blocks.js` (Claude, claims, hole filling, history, the chat channel, presence, `Host`, boot);
- the kernel API in `hypha.js`;
- `computer.js` (clock, jobs, files, programs);
- `index.html`'s README for Claude;
- the slop parts the integration lands on: tools and grants, the sandbox, the docs store, the stream, presence, Pinup's adapter and build, the docs CLI and records.

It also includes two experiments, and the guide itself.

The most useful result is that the kernel runs without a browser, both in Node and inside Go through goja, with no change to `hypha.js`. That turns "agents need an open tab" from a design constraint into a phase. The second is a list of twelve concrete gaps between what Blocks calls and what Pinup's adapter and the docs store provide. Two of them would fail in ways that are hard to notice: a 413 that makes a tab silently read-only (G8), and turns that are never seen because snapshots have an empty `docs` list (G4).

### Prompt Context

**Earlier user prompt (verbatim):** "Ok, now study ~/code/others/ramon/claude-blocks and the write up in ~/code/wesen/go-go-golems/go-go-parc/Projects/2026/10/29/PROJECT REPORT - Claude Blocks - Notion-Shaped Pages Over a Live Hypha Log - A Technical Deep Dive.md , and tell me how you would integrate that into slop-computer (in a similar manner that you itnegrated pinup, as an additional way to display and manage content on slop-computer,  maybe only for us on the backend)"

**User prompt for this step (verbatim):** "Ok, study a bit harder, then create a new docmgr ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

**Assistant interpretation:** Research only; implementing is not part of this request:
- deepen the study, with experiments where a claim can be checked cheaply;
- create SLOP-008;
- write an intern guide (prose, bullets, pseudocode, diagrams, API and file references);
- keep this diary;
- upload the guide to reMarkable.

**Inferred user intent:** A design solid enough to start implementing from, written for someone new to both systems.

**Commit (docs):** recorded in the changelog entry for this step.

### What I did

- **Read `blocks.js` by section**, using its own section markers (`grep -n "^/\* ----------"`):
  - state and peers (`:28-66`), kernel wiring and `writeText` (`:68-116`);
  - `REF()` and `Claude.ask` (`:239-360`), `Claims` and `fillHoles` (`:385-436`), history and time (`:437-497`);
  - storage and sync, `Net` (`:498-702`), the chat view and turns (`:704-750`), presence (`:753-783`);
  - `Host` (`:786-829`), `Seed` (`:2092-2213`) and `boot` (`:2367-2379`).
- **Read the `hypha.js` kernel:** the constructor, peers and `allowed`, `commit`, `receive`, `local`, `checkpoint`, `restore`, `toHyphaWithin`, `replay`, `Stream`, and the exports at `:1038-1039`. It has no DOM use; `performance` is guarded, and it exports through `module.exports` when that exists.
- **Read the rest of the export:**
  - `blocks-kit.js:11-13`: the only parser registrations Blocks adds;
  - `computer.js`: `Clock.apply` writes local cells only (`:23`); jobs run under a 10-minute lease (`:54`); files use `assets.upload` with `/_blob/<id>` URLs (`:141-145`); programs run in Workers from `blob:` URLs (`:295-305`);
  - `index.html`: `<head>` is on line 1, the README for Claude at `:8-31`, the nine script tags at `:1125-1133`, and fonts from fonts.googleapis.com.
- **slop:**
  - `pkg/store/tools.go:21-37` (grant TTL, `ToolPermissions`) and `pkg/server/tools.go:20-23, 124` (tool routes, `grantTool`);
  - `pkg/server/serve.go:458-533` (`serveSandbox` serves sibling files at `:501-508`) and `pkg/render/render.go` (`Inject`, tool mode adds `tool.js`);
  - `pkg/render/assets/tool.js` (its `stream` is GET-only, `:106-123`) and `ToolScreen.tsx:119` (the iframe `sandbox` includes `allow-same-origin`, so Workers work);
  - `pkg/server/serve.go:204` (sandbox pages get no script CSP: `new Function` and `blob:` Workers work);
  - `web/pinup/slop/js/00-slop-host.js` and `web/pinup/slop/build.js`;
  - `cmd/slop/cmds/docs.go`, `pkg/client/docs.go`, and `pkg/records/records.go:80-112` (one record per file).
- **Created the ticket and its docs:**
  ```bash
  docmgr ticket create-ticket --ticket SLOP-008 --title "Claude Blocks on slop: Notion-shaped live pages over a Hypha log as a Workshop tool" --topics tools,collaboration,architecture,frontend,backend
  docmgr doc add --ticket SLOP-008 --doc-type design-doc --title "Intern guide: Claude Blocks on slop"
  docmgr doc add --ticket SLOP-008 --doc-type reference --title "Diary"
  ```
- **Experiment 1:** `node scripts/01-hypha-headless.js ~/code/others/ramon/claude-blocks`.
- **Experiment 2:** `scripts/02-hypha-goja.go` (`//go:build ignore`), run from a scratch module offline:
  ```bash
  cp 02-hypha-goja.go $S/hg/main.go && cd $S/hg && sed -i 's|^//go:build ignore$||' main.go
  GOWORK=off GOFLAGS=-mod=mod GOPROXY=off go mod init hg && go get github.com/dop251/goja@v0.0.0-20251103141225-af2ceb9156d7
  go run . ~/code/others/ramon/claude-blocks
  ```
- **Wrote the guide** (`design-doc/01-intern-guide-claude-blocks-on-slop.md`, 847 lines), then checked every line reference I had not read directly against the files with `sed -n "<n>p"` (see What didn't work).
- **Checked the ticket:** `docmgr doctor --ticket SLOP-008` → "All checks passed".
- **Uploaded the guide:**
  ```bash
  remarquee upload bundle design-doc/01-intern-guide-claude-blocks-on-slop.md --name "SLOP-008 Claude Blocks on slop - intern guide" --remote-dir /ai/2026/10/29/SLOP-008 --toc-depth 2 --non-interactive
  ```
  Result: `OK: uploaded SLOP-008 Claude Blocks on slop - intern guide.pdf -> /ai/2026/10/29/SLOP-008`.

### Why

- **The experiments came before the guide.** Whether agents can work on a workspace without an open tab decides the shape of the plan, and checking it took two short scripts.
- **The gap analysis lists the exact calls Blocks makes.** It does not stop at capability names: Pinup's adapter implements `db`, but not `where`, not `snap.docs`, and not attested authors, and Blocks uses all three.
- **The guide keeps Blocks' upstream files unchanged (D1)** and proposes one shared adapter layer (D2). The vault report's main finding was that Blocks forked CC5 and drifted, and slop should not repeat that with Pinup's adapter.

### What worked

- **Experiment 1 (Node):** every check passed.
  - The seed applies as 102 ops with 0 rejected (226 cells, 11 ms).
  - `lisbon.total`/`per_person` are 1298/649, then 2138 after `lisbon.days = 12`; `lisbon_prep.ready` is 0.444.
  - Replaying stored rows converges (103 rows, a 12,386-byte chunk), and a checkpoint restores (226 ops, 101 stamps).
  - A turn applies two lines and rejects `not a line`; a hole filler is refused at `welcome.cups = 99` with "may only write welcome.ui.8, welcome.ui.8.*".
- **Experiment 2 (goja):** every check passed. `hypha.js` loaded in 10 ms, a 5,000-op replay took 274 ms (about 55 µs per op), and the whole run took 395 ms.
- **The values match the vault report.** It counted 238 cells; the 12 `clock.*` cells that `computer.js` adds account for the difference from 226.

### What didn't work

- **Line references needed corrections.** After writing the guide I checked every reference I had not read directly with `sed -n "<n>p"`, and found several off by one to four lines:
  - `S.U` is set at `blocks.js:512`, not 514;
  - `where` is at `:541` and `docChanges` at `:546`;
  - `denied` is at `:576`; the room send/emit/heard code is at `:612-632`;
  - `uid = p.by` is at `:696` and `:761`; the chat name is at `:46`; `STEP` is at `:833`;
  - `serveSandbox`'s sibling-file branch is at `serve.go:501-508`, not 497-503, and it excludes `.html`.

  The first correction script stopped at its own assertion, because one occurrence had no backticks (`AssertionError: as \`blocks.js:11, 514\``). I fixed the pattern and reran it, then fixed the `serve.go` references with `sed`. No stale references remain (`grep -c "497-503\|458-525"` → 0).
- **The editor flagged the experiment file.** The `//go:build ignore` file shows `go: go.work requires go >= 1.26.3 (running go 1.25.5)` in the editor. That comes from the workspace's `go.work` and the local toolchain, not from the file, and the experiment runs with `GOWORK=off`.

### What I learned

- **Agents could become ordinary Hypha peers without a browser** (`hypha.js` runs headless):
  - Blocks' storage is plain documents;
  - op identity is just `[id, peer, clock, text, at]`;
  - authorship is a hash of the user id.

  So the CLI could become one more peer: load the checkpoint and chunks, run the kernel, write its own chunk.
- **Some of Blocks' safety on claude.ai comes from the platform.** It attests document authors (the chunk's `by`) and keeps `data/users/<uid>` private. On slop the adapter has to supply the first (G7); the second becomes a convention among admins (D7).
- **Blocks treats `invalid_argument` as read-only** (`blocks.js:576`). Any error mapping that turns a size or path problem into `invalid_argument` silently stops saving.

### What was tricky to build

- **Extracting the seed workspace.** `SEED` is a template literal inside a function in `blocks.js`. Evaluating its text with `Function("return \`…\`")` (Node) or `vm.RunString` (goja) reproduces it exactly, escapes included; copying it by hand would not.
- **Running goja without touching the slop module.** The experiment is `//go:build ignore` inside the repo and runs from a scratch module with `GOWORK=off GOPROXY=off`, using a goja version already in the module cache (the one go-go-goja pins).

### What warrants a second pair of eyes

- **D3's write-amplification estimate** (the whole chunk rewritten on each flush) is arithmetic, not a measurement. Phase 1 must measure it.
- **The G8 numbers:** 150,000 UTF-16 units can be up to ~450 KB of UTF-8, and the proposed 640 KiB limit for `blocks` documents is derived from that. Check whether JSON escaping changes the worst case.
- **D7:** on slop, every admin can read every admin's chat channel.

### What should be done in the future

- Phase 1 per the guide's section 9.1, starting with the shared capability layer (D2), so Pinup's 67 browser checks guard the extraction.
- Report the four upstream defects (guide 12.3) to Ramon.

### Code review instructions

- Read the guide's sections 1-5, then the decisions (section 7).
- Rerun both experiments; the commands are in each script's header.
- Spot-check any line reference with `sed -n "<n>p" <file>`.

### Technical details

```text
Blocks capabilities: db user room sample mcp assets downloads   (blocks.js:510)
docs store path rule: ^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_.:-]{1,128}$   (pkg/store/docs.go:46)
Blocks paths: chunks/<c-u…-tab-seq>  meta/snap  meta/compact  snaps/<id>-<i>  claims/<≤179>  leases/<≤180>
              data/users/<uid>/blocks  data/users/<uid>/blocks/turns/<t…>
peer u: "u" + base36(fnv1a32(userId))   (blocks.js:11, 512)
goja: v0.0.0-20251103141225-af2ceb9156d7 · hypha.js load 10 ms · 5,000 ops 274 ms
```
