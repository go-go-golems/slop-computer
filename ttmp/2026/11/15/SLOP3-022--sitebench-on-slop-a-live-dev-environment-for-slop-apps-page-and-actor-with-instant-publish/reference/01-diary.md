---
Title: Diary
Ticket: SLOP3-022
Status: active
Topics:
    - tools
    - agents
    - apps
    - architecture
    - publishing
    - collaboration
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T18:41:54.215950931-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

SLOP3-022 analyses Sitebench, a coding-agent IDE that ran as a Claude artifact, and designs how to rebuild it as a live development environment for slop apps (page and actor), with a dev copy that updates while you work and an instant publish. This file is the main diary. Three reader subagents keep their own diaries in `02-…`, `03-…` and `04-…`.

## Step 1: Ticket, sources, first reading, three readers

This step created the ticket and unpacked the archive into it. I then read Sitebench's storage, project model, frame runtime and sandbox bridge myself, and started three reader subagents for the rest.

### Prompt Context

**User prompt (verbatim):** "ok, now, look at ~/Downloads/sitebench-workspace.zip, create a new docmgr ticket, unzip it, and analyze it, and see how we could transpose the tool to work on proper slop compouter apps, both frontend / backend, having for example a live updating staging / dev environment that we can work on and then basically "insta publishing" the results when happy. For a really fluid coding experience. Analyze deep and then Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

**Assistant interpretation:** Unpack and study Sitebench, then design how its workflow (live frames, an agent acting through one eval tool, proposals, history) maps onto slop apps that have a page and an actor. The design should give each app a dev copy that updates live while you work, and a one-step publish. The deliverable is an intern guide in the ticket, also uploaded to reMarkable.

**Inferred user intent:** Make developing slop apps as fluid as Sitebench made developing artifact pages: edit, see the change immediately on a real dev instance with a backend, and publish when it looks right.

### What I did

- Created worktree `task/slop3-022-sitebench` from origin/main, and ticket SLOP3-022 with the guide `design-doc/01-…` and this diary.
- Unzipped the archive into `sources/sitebench-workspace/`. The archive is 10,211,077 bytes and 429 entries, sha256 `048f3d25…`. That folder is git-ignored. `sources/MANIFEST.md` lists the source files.
- Read `sitebench/README.md`, `build.mjs`, `build-worker.mjs`, `src/03-store.js`, `src/04-project.js` (all of it), `src/05-site.js` (`instrument`, `buildDoc`, the start of `PROBE`, and `FrameHost`, `fxOp` and `Headless`), and `src/06-agent.js` lines 1–135: `Sandbox`, `LONG_CALLS`, `API_SIGS`, `libEntries` and the start of `hostAPI`.
- Started three readers, each with its own diary:
  - the agent and sandbox: `06-agent.js`, `worker.js`, `core.js`, and the eval API design document;
  - the workbench UI: canvas, dock, views, review, snapshots, scenarios, panels, archive and tests, plus `att/` (form-skate, shop-next);
  - the slop surface a dev loop builds on: stores, refs, mounts, the page runtime, actors, the CLI, access, Pinboard, and the gaps.

### Why

- **The sources are not committed** because the slop-computer repository is public and the archive is private design material: the agentalg textbook, form-skate and the shop app. The guide cites paths relative to the archive root, so anyone with the zip can follow them.
- **I read the central files myself.** Store, Project and FrameHost are the parts the port changes most. Delegating them would have left the design resting on a summary.

### What worked

- The archive's README has a file table that made the split between the readers clean.

### What didn't work

- The first `MANIFEST.md` came out with only 7 lines. In `find`, a `-maxdepth` placed after other tests does not apply as intended, and the `-o` chain matched almost nothing. I rewrote the manifest with a plain `find` piped into `grep -E`.

### What I learned

- Sitebench's storage is `window.claude.use('db')` with collections under `data/users/<id>/…`, saved in debounced batches. Each file is one document, keyed `p_<id>/files/<encKey(path)>`.
- A project is files plus tables, plus overlays (proposals with their own copies of files and tables), plus an append-only event log in chunks of about 180 KB. History, blame, the playhead and restore are all computed from that log.
- Pages run as `srcdoc` iframes (`allow-scripts allow-forms`). `buildDoc` inlines every stylesheet and script, and `PROBE` gives the page `window.site.{db,store,nav}` over postMessage. The page has no backend: its `site.db` is the project's tables, which the IDE serves.

### What was tricky

- In Sitebench, "the site" and "the project" are the same object: the page's data is the IDE's tables. On slop, an app's code (store files) is separate from its data (documents and SQL in the same store), and from the actor that runs beside it. The port has to split these.

### Second pair of eyes

- Check that leaving the sources out of git is right. If the user wants them in the repository, `sitebench/src` and the eval document are about 600 KB.

### Future

- Merge the three readers' reports, write the guide, review it a second time, and upload it to reMarkable.

### Code review

- Not applicable: no code in this step.

### Technical details

```sh
unzip -q ~/Downloads/sitebench-workspace.zip   # into sources/sitebench-workspace/
sha256sum ~/Downloads/sitebench-workspace.zip  # 048f3d252df01cde48899bea54692e108dd7f34510c07b6d52d2821d012b8bdf
```

## Step 2: The three readers' reports, and checking the claims the design rests on

The three readers finished, each with its own diary (`02-…` agent and sandbox, `03-…` workbench UI, `04-…` slop surface). I then reread the three claims the design depends on in the slop code myself, because a design built on a wrong summary would be wrong throughout.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Same task. This step turns the reading into checked facts.

**Inferred user intent:** A guide an intern can trust, which means its claims must match the code.

### What I did

- Received the three reports. Their headline findings:
  - **Agent and sandbox:**
    - Every model call is `window.claude.use('sample')` with one tool, `eval`, whose `execute` the host's tool loop calls (`06-agent.js:733-769`).
    - Evals run in a QuickJS worker, one context per thread. Top-level declarations persist through an acorn rewrite and a JSON snapshot (`worker.js:136-166`).
    - Every eval is a transaction. `frameEffects` tells the model what its writes did to the live frames.
    - `core.js` implements the algebra part of agentalg. The rest of the design document is design only.
  - **Workbench UI:**
    - The canvas holds live frames. Frames reload double-buffered, keeping state. Proposals are reviewed with layout checks and scenarios, and there is a timeline playhead, blame, why cards, panels, fixtures and scenarios.
    - The UI layers are host-independent. Only `buildDoc`/PROBE (srcdoc pages) and `Store`/`sample` depend on the artifact host.
  - **Slop surface:**
    - The dev loop already exists as primitives: push to `draft`, `store.new {app}`, `app.follow <store> draft`, `ref.move main`, a `reload` view event on ref moves, and the Workshop app.
    - The page runtime is natively the Claude artifact contract (`window.claude.use`).
    - What is missing is tooling and policy: a watch-and-push loop, an activation result from push, a live preview of a ref, a code right for developers, dev isolation of secrets and policy, and migrations that can be edited in dev.
- Checked myself, in the worktree at origin/main:
  - `pkg/host/workshop_module_test.go:84-129`: a scratch store follows `draft`, gets migration `002`, while the app store keeps running `main`.
  - `pkg/doors/actors/modworkshop.go:3-19`: `push` defaults to `ref:"draft"`, and `publish` is `ref.move` with `ref:"main"`.
  - `pkg/doors/pages/views.go:510-539`: `reloadApp` sends `reload {version}` to the views whose app's ref moved.
  - `web/runtime/src/index.ts:15-71`: `window.claude.use` resolves `db`, `user`, `sample`, `slop` and the others.
  - `web/runtime/src/sample.ts:11-22,70-87,162`: `sample` takes page-side `tools` with `execute`, at most 16.
  - `pkg/doors/pages/sandbox.go:114`: the app origin's only CSP is `frame-ancestors`, so Workers, wasm and srcdoc frames are not blocked.

### Why

- These checks carry the guide's central claim: Sitebench needs a different backend for its project, not a different runtime.

### What worked

- The three reports fit together without contradictions. The UI reader's porting notes and the slop reader's gaps name the same missing pieces from opposite sides: addressable versions, data isolation for fixtures, and the probe in a real page.

### What didn't work

- Nothing failed in this step.

### What I learned

- Slop already has a draft and publish flow (SLOP3-002's Workshop). What it lacks is the fluid part: Sitebench's sub-second loop of edit, live frames, effects and review.

### What was tricky

- The slop reader flags several places where `doc/design/slop-v3.md` disagrees with the code: no page SQL, no `store.fork`, a turn limit of 5 s rather than 250 ms, and no `opens`. The guide follows the code and says so where it matters.

### Second pair of eyes

- The readers' reports are summaries. The guide cites file:line for every claim that carries weight, and those citations should be spot-checked.

### Future

- Test the strongest claim in practice: run Sitebench's own build on a local slop.

### Code review

- Not applicable.

### Technical details

- The reader diaries are `reference/02-diary-sitebench-agent-and-sandbox.md`, `reference/03-diary-sitebench-workbench-ui.md` and `reference/04-diary-slop-surface-for-a-dev-loop.md`.

## Step 3: Stage 0, Sitebench's build running unchanged as a slop app

I pushed Sitebench's `dist/` with one added `app.json` to a local slop, and drove it with Playwright. It boots inside slop's shell, saves its projects as slop documents, runs evals in its QuickJS worker (the writes reach the live frames, and the effects report a fixed issue), and runs an agent turn through slop's `sample` with its page-side `eval` tool. So stage 0 of the plan is a fact, not a hope.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Same task. An experiment strengthens the guide's starting point.

**Inferred user intent:** Know what works today before designing what is missing.

**Mid-task user message (verbatim):** "as you work, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)

(backfill diary if necessary)"

### What I did

1. Built slop from this worktree (origin/main): `GOWORK=off go build -buildvcs=false -o $S/rep/slop022 ./cmd/slop`.
2. Started it on the earlier local experiment's data folder: `slop022 serve --local --llm fake --data $S/lslop/data --listen 127.0.0.1:18490 --admin-email admin@example.com`.
3. Copied `sitebench/dist` to a scratch folder and added `app.json`: `{"title":"Sitebench","type":"bench","page":"index.html","capabilities":{"db":{},"user":{},"sample":{},"downloads":true}}`. It is saved as `various/stage0-app.json`.
4. Ran `store new --id bench --type bench`, `push bench --store bench`, `policy set bench sample @admin on`, and `mount set --host apps.localhost:18490 --path /bench --store bench`. The script is `scripts/01-stage0-sitebench-as-a-slop-app.sh`.
5. Opened `http://apps.localhost:18490/bench` in Playwright, signed in as the local admin.
6. In the Eval tab, ran:

   ```js
   const files0 = await files.list();
   await files.replace('styles.css', '.cats {', '.cats { flex-wrap: wrap;');
   return { files0, menu: (await frames.list()).length }
   ```

7. Sent the agent "Make the menu title bigger."
8. Counted the store's documents with `slop sql query --store bench`.
9. Closed the browser.

### Why

- The guide's plan starts from "Sitebench already runs on slop". That had to be tested rather than inferred from reading.

### What worked

- **Boot.** The shell frames the app at `s545f6cf450c119eda9dd.sbx.localhost:18490`. The header shows "Corner Coffee 7 files", "1 issue" (the template's deliberate overflow at 375 px), "Idle Claude" and "saved · Account". "Account" means `Store.mode === 'db'`. Screenshot: `various/stage0-01-boot.png`.
- **Eval.** The Eval tab says "Sandbox: QuickJS (wasm) in a worker". The eval returned `ok 26 ms · quickjs · main` with the effects line "styles.css +1 −1 · fixed 1 issue · layout changed on menu.html". The header went to "0 issues", the menu's category chips wrap, and the scope shows `files0`. Screenshot: `various/stage0-02-eval.png`.
- **Agent.** The turn shows "✓ eval 1 · return 1; · 17 ms", then "The browser tool completed successfully." (the fake backend's canned reply), and "was discarded" (an empty proposal). Slop's `sample` therefore drove Sitebench's page-side tool loop. Screenshot: `various/stage0-03-agent.png`.
- **Storage.** The `bench` store holds the project as documents under `data/users/<usr>/p_<pid>/{files,tables,log,threads,snaps}/…` plus `data/users/<usr>/prefs`. These are private per person under slop's `data/users/{self}` rule.

### What didn't work

- `slop docs ls bench -o json` printed something that was not JSON to my parser (`JSONDecodeError: Expecting value: line 1 column 1`). I counted the documents with `sql query` over `_docs` instead.
- Playwright's screenshot tool refused a path outside its roots ("File access denied: … is outside allowed roots"). I took the screenshots with `page.screenshot` inside `browser_run_code_unsafe`.
- **A token reached my output.** Inspecting `$S/lslop/creds.json` printed the local server's token, because my redaction only looked at top-level keys and the token is nested. It is a throwaway loopback admin token for `admin@example.com` on 127.0.0.1:18490, not a staging credential. It is not written into any file in this ticket. A scan of the ticket for `slp_`, `k_…` and `Bearer` found nothing.

### What I learned

- With an `app.json`, Sitebench's build runs unmodified on slop: storage, worker, wasm, srcdoc frames and the model loop all work. The port's real work is therefore not making Sitebench run. It is making Sitebench's *project* a slop app: files in a store's tree, data in an actor or documents, frames showing a real view of a dev store.

### What was tricky

- The fake backend's answer is canned, so this does not test model quality, only the contract: tools, `execute`, and the result going back to the loop.

### Second pair of eyes

- On staging, `sample` runs on the real model backend under budgets. A real turn there is the next validation, after this design.

### Future

- Write the guide. Stage 0 is the first stage of its plan.

### Code review

- `various/stage0-app.json` and `scripts/01-stage0-sitebench-as-a-slop-app.sh`.

### Technical details

```sh
slop store new --id bench --type bench
slop push bench --store bench -m "Sitebench dist, unchanged, plus app.json"
slop policy set bench sample @admin on
slop mount set --host apps.localhost:18490 --path /bench --store bench
slop sql query --store bench --sql "SELECT … FROM _docs GROUP BY 1"
```

## Step 4: The guide's first draft, and the user's question about stores as projects

I wrote the guide in four parts, committing after each: `33b814c` (parts 1–2), `1f2bd13` (parts 3–4), `a0506ed` (part 5) and `989d468` (parts 6–7, appendices, open questions). The draft is about 11,500 words. While I was writing, the user asked how stores and apps would map to projects. That became §5.3, "Projects are apps".

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Mid-task user message (verbatim):** "can we basically load stores / create stores/apps as projects? how would you map those?"

**Assistant interpretation:** Make the store-to-project mapping explicit:

- which stores show up as projects;
- what opening one does;
- how creating one works;
- where each piece of Sitebench's project state lives on slop.

**Inferred user intent:** The bench should open the apps that already exist on slop (Pinboard, reports, the catalog) and create new ones, not keep a parallel world of projects.

### What I did

- Checked `store.ls`'s fields (`id, type, app, owner, createdAt, level`, `pkg/commands/stores.go:24-47`). An app store has `app == ""` and an `app.json` in its tree; its instances have `app == <id>`.
- Checked the store id rule (`^[a-z0-9][a-z0-9-]{0,62}$`, `pkg/registry/stores.go:12`) and that `import.docs`, `import.table` and `store.rm` exist (`pkg/commands/data.go:133,176`; `stores.go:64`).
- Checked that `app.follow` resolves the ref name on the app store and then runs `Running`, so it activates (`pkg/commands/actors.go:132-163`).
- Checked how far framing is allowed: `frameOrigins` is the main host plus the live hosts (`pkg/doors/pages/sandbox.go:62-68`).
- Read the shell's message switch (`pkg/doors/pages/assets/shell.js:206-250`), the sandbox's `/v/<n>/` handling with `n == 0` meaning main (`sandbox.go:124-135`), and the runtime's `reload` handling (`web/runtime/src/transport.ts:270-280`).
- Wrote §5.3:
  - a mapping table from Sitebench to the bench to the slop mechanism;
  - pseudocode for `open`;
  - create, opening a store that is not an app, and export.

### Why

- Each claim in Part 3 that the design leans on was rechecked in the code before the design used it.

### What worked

- The mapping is one-to-one with existing slop objects except two: embedded views and instance seeding. Both are listed in Appendix C.

### What didn't work

- Nothing failed in this step.

### What I learned

- `frameOrigins` decides the central design question. A bench on its own sandbox origin cannot frame another app's view today. That is why §5.5 proposes embedded views, opened by a trusted app, with the bench acting as the shell for its frames.

### What was tricky

- **One working tree serves every ref of a store** (§3.1). A push to `draft` replaces it, so a later `snap.new` without `--ref` would publish draft. The guide warns about this.

### Second pair of eyes

- **§5.5's embed design** should be reviewed by someone who knows the shell and sandbox code. In particular: `renew`, and the bench forwarding `confirm` to its own shell.

### Future

- The second pass (Step 5).

### Code review

- `design-doc/01-guide-…md`, §5.3 to §5.5 and Appendix C.

### Technical details

- Review notes for the second pass, written before revising.

  **Comprehension gaps (where a newcomer would stop):**
  - **G1.** In §1.2, step 6 shows the one-line effects summary. The model receives JSON (shown in §2.4). Say so.
  - **G2.** "Instance" is this guide's word. Slop's code says "a store whose `_meta.app` names another store". Say so where the term is introduced (§3.2).
  - **G3.** §3.4 uses "view" without saying what it is: the server's record of one open page, with an id, a version and a secret.
  - **G4.** In §5.4, why don't production frames reload when draft moves? `reloadApp` checks them too, but `Running` returns main's unchanged `n`. Say so.
  - **G5.** In §5.5, why must the bench answer `hello`? The boot script gives the page `parentOrigin`. In an embed that is the bench's origin, so the page's runtime talks to the bench. Say so.
  - **G6.** In Part 4, why `policy set … sample @admin on`? `sample` is gated per app and audience by the policy matrix. Say so.
  - **G7.** The summary uses "store", "tree" and "ref" before Part 3 defines them. Point there.
  - **G8.** The snapshot numbers in §5.2, §5.4 and §5.8 are illustrative. Say so once.

  **Technical corrections:**
  - **T1.** §2.4's effects JSON has illustrative values (`757 → 791` was not taken from a run). Label it.
  - **T2.** "84 verbs in 15 groups" should be 14 groups: agents, data, dry, files, fixtures, frames, lib, llm, log, scenarios, session, snapshots, tx, ui. Counted from `API_SIGS`.
  - **T3.** The summary's "accept and publish become ref moves": accept is a push to `draft`, which moves `draft`. Reword to "accept and publish move refs".
  - **T4.** Checked and correct as written: `ctx.now` is an accessor property (`pkg/actor/actor.go:731`), and reactors are `on: {'<selector>'(ctx, e) {}}` (`apps/backoffice/actor.js:21-24`; `pkg/actor/manager.go:788-800`).

## Step 5: Second pass, bookkeeping, upload

I applied the review notes from Step 4, plus one inconsistency found on the full read. I related the key files, ran the ticket checks, and uploaded the guide to reMarkable.

### Prompt Context

**User prompt (verbatim):** see Step 1. The mid-task messages are quoted in Steps 3 and 4.

**Assistant interpretation:** Finish the guide, store it in the ticket, upload it.

**Inferred user intent:** A finished document to read on the reMarkable, with the work in the repository.

### What I did

- **Applied G1–G8 and T1–T3** (Step 4 lists them):
  - "accept and publish move refs", plus a pointer to Part 3 for the terms;
  - the effects one-liner versus the JSON;
  - illustrative values labelled;
  - 14 groups of host-API verbs;
  - "instance" introduced as this guide's word;
  - "view" defined;
  - why production frames do not reload on a draft push;
  - why the bench answers `hello` (`parentOrigin`);
  - why `policy set` is needed;
  - the snapshot numbers declared illustrative.
- **Fixed one inconsistency from the full read.** Phase 1 claimed srcdoc frames render app pages "without their backend". A srcdoc frame has no slop runtime, so only static apps render. Pages that call `window.claude` error until Phase 2.
- **`docmgr doc relate`** on the guide, with seven files: `modworkshop.go`, `workshop_module_test.go`, `views.go`, `sandbox.go`, `apps.go`, `web/runtime/src/index.ts`, and the stage-0 script.
- **`docmgr changelog update`.**
- **`docmgr doctor`.** It warned that the slop reader's diary listed 20 related files without notes. I cleared that list (the guide relates the key files with notes), and doctor then reported "All checks passed".
- **Committed** `6b70cd2`.
- **Uploaded:**

  ```
  remarquee upload bundle <guide> --name "SLOP3-022 Sitebench on slop - live dev environment guide" --remote-dir "/ai/2026/11/15/SLOP3-022" --toc-depth 2 --non-interactive
  ```

  Result: `OK: uploaded SLOP3-022 Sitebench on slop - live dev environment guide.pdf -> /ai/2026/11/15/SLOP3-022`.

### Why

- The writing guidance asks for a whole-document second reading, with notes before revisions. The notes are in Step 4.

### What worked

- The upload succeeded on the first try.

### What didn't work

- Nothing failed in this step. The rendered PDF was not inspected: the upload policy is upload-only unless something is reported broken. The guide's diagrams use box-drawing characters in code blocks, so check those pages when reading.

### What I learned

- The second pass found mostly comprehension gaps, not factual errors. The one factual error (Phase 1's srcdoc claim) appeared only when Part 7 was read against Part 2.

### What was tricky

- Keeping the snapshot numbers in §5.2, §5.4, §5.8 and §5.10 consistent: 37 for main, 41 for draft, 42 for the next edit.

### Second pair of eyes

- **§5.5 and Appendix C.1, embedded views:** this is the part of the design that touches security-relevant code (framing, view secrets, probe injection).
- **§5.8, publish:** the migration preflight is the protection for production data.

### Future

- The user's decisions:
  - whether Sitebench's source may go into this public repository (Open question 1);
  - then Phases 1–3 of the plan.
- The local server used for stage 0 was stopped after this step.

### Code review

- The guide: `design-doc/01-guide-sitebench-and-how-to-make-it-a-live-dev-environment-for-slop-apps.md`.

### Technical details

- Commits in this ticket: `336149d`, `33b814c`, `1f2bd13`, `a0506ed`, `989d468`, `9484a46`, `6b70cd2`, and this step's.

## Step 6: Server pieces C.3, C.2 and C.4 (ref.move ifAt, push activation, workshop dev instances)

The user asked me to work on the ticket. Committing Sitebench's source to this public repository is still the user's decision (open question 1), so I started with the server work the guide's plan needs, which does not depend on it. Three of Appendix C's additions are built and tested on branch `task/slop3-022-dev-loop`, cut from origin/main `0dfce36` after #45 merged:

- `6c688e7`: `ref.move --ifAt`;
- `3835fd8`: `files.push --activate`;
- `d591503`: the `workshop` module's dev-instance functions with a guarded `drop`.

### Prompt Context

**User prompts (verbatim):**

- "merge #45, let's close all gitops since we are working on it. clean worktrees."
- "Then work on the ticket, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)."

**Assistant interpretation:** After the SLOP3-021 housekeeping, implement SLOP3-022's plan. Commit at feature boundaries, and record each step here.

**Inferred user intent:** Turn the design into working server pieces, in the order that unblocks the bench.

### What I did

- **C.3, `ref.move {…, ifAt?}`.**
  - Added `Turn.RefAt(ref)` (`pkg/store/files.go`), which returns the current snapshot inside the turn, or 0 if the ref is missing.
  - In the `ref.move` verb (`pkg/commands/files.go`), with `ifAt` set and different from the current snapshot, the move fails with `conflict: main points at 7, not 5: it moved since you looked`.
  - `ifAt: 0` means "only if the ref does not exist".
  - The result gains `from`, the previous snapshot, which is what a rollback moves back to.
- **C.2, `files.push {…, activate?: [store]}`.**
  - After the snapshot, each listed store is opened at `view` (the level `app.status` needs) and brought up through `statusOf`.
  - The result gains `activated: [{store, app, ref, n, broken}]`, or `{store, error}` for a store the caller cannot see.
  - `statusOf` (`pkg/commands/mounts.go`) is `app.status`'s body, moved out so both share it.
  - The files group now gets `filesEnv{kernelEnv, A}`, the actor manager for post-activation build failures. This follows `env.go`'s rule that a group's environment lists what it can reach.
- **C.4, the `workshop` module** (`pkg/doors/actors/modworkshop.go`):
  - one-to-one functions `newStore`, `logs`, `restart`, `doc`, `docs`, `sql`, `importDocs` and `importTable`;
  - `workshopModule(a)` with a custom `drop(id)`. It reads `app.status` as the visitor and refuses unless the store runs *another* store's app *and* follows a ref other than `main`. Only then does it call `store.rm`.
  - `modules.go` loads the module through `workshopModule`. Its doc line now mentions dev instances.
- **Tests** (`pkg/host/devloop_test.go`, new):
  - `TestRefMoveIfAt`: publish with the right `ifAt`; a stale `ifAt` gets `conflict` and main does not move; `ifAt 0` creates once only; a move without `ifAt` reports `from`.
  - `TestPushActivates`: a good migration is reported as `{ref: draft, n, broken: ""}` and the tables appear. A broken `sql/003_bad.sql` is reported as broken with its name, the instance stays on the last good `n`, and its tables are unchanged. An unknown store gives an `error` entry.
  - `TestWorkshopDevInstances`, through a trusted tool app:
    - `newStore` and `follow draft`;
    - `importTable` and `importDocs`, checked with `sql`, `doc` and `docs`;
    - `push` with `activate`;
    - `publish` with a stale `ifAt` (`conflict`), then the right one (`from` = main);
    - `drop` of the dev instance, after which `app.status` answers `not_found`;
    - `drop` of a production instance and of the app store, both `permission_denied`.

### Why

- **`drop` is guarded** because platform admins hold `admin` on every store (`pkg/access/check.go:187-189`). A bug in a tool acting as an admin could otherwise delete any store. "Runs unpublished code" (`app_ref != main`) describes exactly the instances a dev loop makes.
- **`files.push --activate`** spares tools a second call. Its exact purpose is the bench's effects line ("actor ok" or "broken: …") right after a sync.
- **`ifAt`** closes the publish race named in the guide (§5.8). The Workshop's `publish` had the same gap.

### What worked

- All three new tests passed on their first run. I checked that `h.fail` really compares the error code (`pkg/host/harness_test.go:169-177`), so the refusals are tested.
- The full suite `GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./... -count=1` passed (`pkg/host` in 18.6 s), and `golangci-lint run --build-tags sqlite_fts5` reported 0 issues.

### What didn't work

- **First build after C.2:**

  ```
  pkg/commands/mounts.go:350:52: undefined: actor
  pkg/commands/mounts.go:350:71: undefined: store
  pkg/commands/files.go:175:24: cannot use e (variable of struct type filesEnv) as kernelEnv value in argument to putBlobs
  pkg/commands/files.go:185:22: cannot use e (variable of struct type filesEnv) as kernelEnv value in argument to push
  ```

  Fixed by adding the imports and passing `e.kernelEnv` at the two call sites.
- **First build after C.4:** "no required module provides package github.com/go-go-golems/slop-computer/pkg/web". The package is `pkg/doors/web`.

### What I learned

- `modArgs` already turns a trailing plain object into options (`pkg/doors/actors/modules.go:76-100`). So `push(store, files, {activate})` and `publish(store, n, {ifAt})` needed no new plumbing.
- `pkg/actor` now reports `[no tests to run]` under `go test`, because after #45 its only test file holds benchmarks. That is expected.

### What was tricky

- **`app.status` activates.** It calls `Running`, so reading a status brings the store up. `drop` uses `app.status` for its guard, which can activate an instance just before deleting it. That is harmless, but worth knowing.

### Second pair of eyes

- **The `drop` guard** relies on `app_ref` as an instance's own statement of what it runs. A production instance someone moved to `draft` by hand would become droppable. Is that acceptable, or should drop also require that the caller created the store?
- **`files.push --activate`** opens each listed store at `view`, the same as `app.status`, which also activates. A viewer could thus trigger activation of a store they can view. That was already true through `app.status`.

### Future

- C.1, embedded views: the big piece. Then C.5, `slop dev`.

### Code review

- `pkg/commands/files.go`: `ref.move`, and `files.push`'s activation loop.
- `pkg/commands/mounts.go`: `statusOf`.
- `pkg/doors/actors/modworkshop.go`: `workshopModule` and `drop`.
- `pkg/host/devloop_test.go`.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run 'TestRefMoveIfAt|TestPushActivates|TestWorkshopDevInstances' -count=1
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./... -count=1
GOWORK=off golangci-lint run --build-tags sqlite_fts5
```

- In the GitOps repository, CI's bump for `0dfce36` (#436) was closed by the watcher, so no slop-yolo PR is open.

## Step 7: C.1, embedded views, with a browser check of the live loop

A tool app trusted with `workshop` can now frame a real view of another store in its own page, and act as the shell for it. Commit `b5c0588`. A dev embed adds `data-src` lines and a small probe. On a local server, a push to `draft` from the CLI reached the embedded frame of a scratch tool **291 ms** after the push started.

### Prompt Context

**User prompt (verbatim):** see Step 6.

**Assistant interpretation:** Continue the plan with C.1, the piece that lets the bench show real frames.

**Inferred user intent:** The fluid loop: see the app under development, live, inside the tool.

### What I did

- **Read the existing code paths:**
  - `openView` already takes a `parent` origin and passes it as `?parent=` (`pkg/doors/pages/views.go:147-191`).
  - The sandbox resets `parent` to the main host unless it is in `frameOrigins()`, and sets `frame-ancestors` from that list (`sandbox.go:114` before this change).
  - The runtime takes its secret from `{slop:1, type:"view"}` sent by its parent, and asks for `renew` (`web/runtime/src/transport.ts:91-134`).
  - `views.Renew` extends a view's expiry without rotating its secret (`pkg/rt/views.go:361-365`).
- **`pkg/doors/pages/embed.go` (new):**
  - `Embed(ctx, p, store, toolStore, toolApp, dev)`. It requires admin on the store for `dev`, computes the tool's origin `toolOrigin(toolStore, toolApp)`, and calls `openView` with that parent. It registers a token `emb_…` with `{label, parent, dev, view, until}` and returns `{src, view, secret, version, expiresAt, origin, level, caps, dev}`. `src` is `/e/<token>/v/<n>/?mode=app&parent=…`.
  - `RenewEmbed(ctx, p, view, toolStore, toolApp)` works only for the same person and the same tool. It re-checks access as the shell's renew does, and extends the token with the view (`embeds.extend`).
  - `instrument(page, file)`, over `golang.org/x/net/html`'s tokenizer. It adds `data-src="file:line"` to body elements and leaves every other byte as it was.
  - `verbErr`, which turns the door's `rtFail` into a `verbs.Error` with its code.
- **`sandbox.go`:**
  - `/e/<token>/…` resolves the token on its own origin only (the label must match), then serves the rest of the path as usual.
  - `frame-ancestors` is `frameOrigins()` plus the tool's origin, because every ancestor in the chain must match.
  - The boot's `parentOrigin` is the embed's parent, whatever the URL says.
  - Dev embeds are instrumented and get `/_slop/probe.js` after the runtime. `inject` takes extra tags.
  - The `/` redirect keeps the `/e/<token>` prefix.
- **`assets/probe.js` (new, written for this protocol):**
  - messages marked `slopProbe: 1`;
  - `ready` (on load);
  - `log` (console output, `error`, `unhandledrejection`);
  - ops `state` (scroll, plus form values keyed by `data-src|name`), `restore` and `src(x, y)`;
  - the origin and source checked on every message.
- **The `workshop` module:** `embed(store, {dev})` and `renewEmbed(view)` in `workshopModule`, with the same trust check as `drop`. The actors door gets `Embed` and `RenewEmbed` from the pages door (`pkg/host/host.go`).
- **`go.mod`:** `golang.org/x/net` moved from indirect to direct (`go mod tidy` changed only that line).
- **Tests:**
  - `TestInstrument` (`pkg/doors/pages/embed_test.go`):
    - line numbers across a tag that spans two lines;
    - head and script content untouched;
    - an existing `data-src` kept;
    - `<img …/>`;
    - the unquoted `type=text/>`, whose slash belongs to the value;
    - a page without a body;
    - an escaped file name.
  - `TestEmbeddedViews` (`pkg/host/devloop_test.go`):
    - a dev embed as an admin: CSP lists the main host and the tool origin, the boot names the tool, the probe and `data-src` are there;
    - `app.js` loads under the embed address;
    - the token on another origin, and an unknown token, both give 404;
    - a plain embed as a viewer: framed by the tool, with no probe and no `data-src`;
    - a viewer asking for a dev embed gets `not_granted`;
    - renew works for the opener and is `not_found` for another person.
- **The browser check** (local server built from this branch; scripts in `scripts/02-embed-test/`):
  - Apps: `jot`, whose page writes and reads a document; `jot-dev`, which follows `draft`; and `embedtest`, a tool that embeds `jot-dev` as a dev view, answers `hello`, and re-embeds on `reload`.
  - Playwright: the frame chain was the live shell, then the tool (its own sandbox origin), then the dev view (`/e/emb_…/v/2/`). The tool's log showed `runtime: hello`, `probe: ready`, `probe state: {"scroll":[0,0],"fields":[["index.html:2|q",""]]}` and `probe: log jot loaded`. The embedded page's `db` worked ("from the dev instance, version ONE"), and its elements carried `data-src`.
  - **The live edit:** `slop push jot --store jot --ref draft` with "version THREE". The tool got `runtime: reload`, opened `embed v4`, and the frame showed "version THREE" 291 ms after the push command started (polling every 100 ms). Screenshot, cropped to the frame: `various/c1-embed-live-v3.png`.

### Why

- **Embeds are opened through the trusted module, as the visitor.** The tool's identity, and so its origin, comes from the calling actor (`a.Store().ID`, `a.App()`), never from a parameter. A page cannot ask to be framed by an arbitrary origin.
- **The token binds the frame address to one store's origin**, and expires with the view.

### What worked

- The design in the guide (§5.5) held up against the code. The only additions were the ancestor chain in `frame-ancestors` and extending the token on renew.
- The full suite passed, and lint reported 0 issues after the fixes below.

### What didn't work

- **The first build:** "embed already declared through import of package embed" (`sandbox.go` imports `embed` for `go:embed`). Renamed the type to `embedAddr`.
- **The first `TestEmbeddedViews` run:**

  ```
  want not_granted, got 500 map[error:map[code:internal message:not_granted: a dev view of jot-dev needs admin on it]]
  ```

  The pages door's `rtFail` is not a `verbs.Error`. Added `verbErr`.
- **Lint:** "named return "out" with type "map[string]any" found (nonamedreturns)", twice. The exported functions now wrap unexported ones.
- **`TestInstrument` passed at first while blessing a bug.** `type=text/>` became `type=text data-src=…/>`, which changes the unquoted value from `text/` to `text`. Fixed `withAttr`: a slash closes the tag only after whitespace or a quote. The test's expected line for `<img>` was also wrong (8, actually 9, because the input before it spans two lines). The code was right.
- **The first `reload` in the browser** left "version ONE" on screen, because my scratch tool did not re-embed. The runtime's fallback reloaded its own URL, which names snapshot 2. A real bench must answer `reload` with a new embed, and the tool now does.

### What I learned

- **The sandbox injects the runtime only into the entry page.** Other `.html` files are served as plain bytes (`sandbox.go`, `writeStoreBytes`). A slop app is therefore one entry page. The bench's frames show deep links into it (`#…`), not separate HTML routes as in Sitebench. The guide should say so (§5.3 and §5.5).
- **`frame-ancestors` checks every ancestor**, so a tool's embed must allow the shell's hosts too.

### What was tricky

- **The probe had to come after the boot data it reads.** `insertHead` puts tags first in `<head>`, which would have put the probe before `#slop-boot`. `inject` now appends extra tags after the runtime.

### Second pair of eyes

- **The scope of `embed`.** Any app trusted with `workshop` can now frame any store its visitor can view, in the tool's own page, and read it through the frame's runtime only as that visitor. Is that the right scope for `workshop`, or should embedding be its own module or permission?
- **The probe is deliberately small.** Sitebench's `PROBE` (checks, layout, inspect, trace, recording) would replace it if the user allows that source in this repository.

### Future

- C.5 `slop dev`, then the PR.
- Correct the guide on single-entry apps.

### Code review

- `pkg/doors/pages/embed.go`;
- the embed handling in `pkg/doors/pages/sandbox.go`;
- `pkg/doors/pages/assets/probe.js`;
- `embed` and `renewEmbed` in `pkg/doors/actors/modworkshop.go`.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/doors/pages -run TestInstrument -count=1
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run TestEmbeddedViews -count=1
# browser: scripts/02-embed-test/README.md; latency = probe-seen time − push start = 291 ms
```

## Step 8: C.5, `slop dev`

The terminal side of the loop: `slop dev <dir> --app <id>`. Commit `972e80e`. It pushes the folder to `draft` now and on every change, makes and maintains the person's dev instance, and prints where the instance is, or why it broke, followed by its new log lines.

### Prompt Context

**User prompt (verbatim):** see Step 6.

**Assistant interpretation:** Continue the plan with C.5.

**Inferred user intent:** The same live loop for people who edit in their own editor.

### What I did

- **`pkg/client/dev.go` (new).** It holds the logic, so `pkg/host` tests can drive it; they cannot import `cmd/slop/cmds`, which imports `pkg/host`.
  - `DevInstanceID(app, person)` returns `<app>-dev-<first 6 of the id>`, within 63 characters.
  - `Client.Dev(ctx, dir, DevOptions{App, Instance, Every, Once, Out})`:
    1. `whoami`, to name the instance.
    2. A first push to `draft` with `activate: [instance]`.
    3. `devInstance`: if `app.status` answers `not_found`, it runs `store.new {id, app, type}` (the type from the app's manifest) and `app.follow draft`. An instance that runs another app is an error. One on another ref is set to follow `draft`.
    4. One status line.
    5. Unless `Once`: a ticker that compares a folder stamp (path, size, mtime, with the same skip rules as `ReadDir`) and pushes on change. It reads `app.logs` after each push and about every 2 s, printing lines newer than the last one printed.
  - The output, as `TestSlopDev` printed it:

    ```
    made dev instance jot-dev-5340a1 (runs jot)
    draft 1 · jot-dev-5340a1 on 1 · ok
    dev instance jot-dev-5340a1 follows jot@draft; publish with: slop ref move jot main 1
    draft 2 · jot-dev-5340a1 on 2 · ok
      log warn  action ping declares no requires; callers need admin
      log log   setup ran
    draft 3 · jot-dev-5340a1 stays on 2 · broken: activation of jot@3 failed: migration sql/003_bad.sql: near "TABL": syntax error
    ```

- **`cmd/slop/cmds/dev.go` (new):** cobra flags `--app` (default: the folder's name), `--instance`, `--every` (500 ms) and `--once`. It runs under SIGINT/SIGTERM. It is registered next to `push` and `pull` in `extra.go`.
- **`TestSlopDev`** (`pkg/host/devloop_test.go`), through a `client.Client` on the harness, using the existing `hostTransport`:
  - `--once` makes the instance on `draft`, and `main` does not exist afterwards;
  - in the loop, a new migration is reported "ok" with the instance's `setup` log line;
  - a broken migration is reported as "stays on … broken: …" with the file named.
- **The guide's Appendix C** marks C.5 as built.

### Why

- **Polling instead of fsnotify:** no new dependency (the slop reader noted `fsnotify` is not in `go.mod`). A stat walk twice a second is cheap for an app folder.
- **Logs about every 2 s, not every tick,** to keep the request rate low on a shared server.

### What worked

- After the fix below, the test passed. The full suite passed, and lint reported 0 issues.

### What didn't work

- **The first run of `TestSlopDev`** printed "draft 0 · jot-dev-190bc0 on 0 · ok" and never showed a log line:

  ```
  devloop_test.go:348: waited for "log log   setup ran":
  ```

  The client decodes answers with `dec.UseNumber()` (`pkg/client/client.go:254-255`), so numbers arrive as `json.Number`. `toInt` read them as 0, and every log line's `at` was "older" than `since`. `toInt` now handles `json.Number`.
- **`pkill -f "rep/s22 serve --local"`** killed its own shell (exit 144), because the pattern appeared in the command line. This happened again after Step 5. Anchoring the pattern (`^/tmp/…/rep/s22 serve`) avoids it.

### What I learned

- `client.Call` answers carry `json.Number`. Any client-side code reading numbers must handle it.

### What was tricky

- **Not printing the status twice.** When the instance already exists and follows `draft`, the first push's activation entry already says where it is. When it does not exist yet, that entry is an error, and a status read after `devInstance` gives the line. `devPush` reports whether it printed.

### Second pair of eyes

- **The publish hint** printed by `slop dev` is `slop ref move <app> main <n>`, without `--ifAt`. Should it print the current `main` so the hint is a compare-and-swap?

### Future

- Open the PR with C.1–C.5, and wait for Codex.
- The bench app itself waits on the user's decision about Sitebench's source.

### Code review

- `pkg/client/dev.go`;
- `cmd/slop/cmds/dev.go`;
- `TestSlopDev`.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run TestSlopDev -count=1 -v
slop dev ./myapp --app myapp            # Ctrl-C to stop
slop dev ./myapp --app myapp --once     # push, report, exit
```

## Step 9: PR #46, two rounds of Codex findings, and a CI flake

PR #46 carries C.1–C.5. Codex reviewed it twice and found four real bugs, all fixed with tests:

- **Round 1** (`7718910`), both in `slop dev`: a failed push was never retried, and a new app's dev instance got no type.
- **Round 2** (`f94887e`), both in embeds: a token caller could open an embed with more authority than the token had (P1), and `<g/>` lost its self-closing slash.

CI's first run failed in `TestBlocksSiteReader`, a test this PR does not touch. Its `TempDir` cleanup raced with something still writing. The rerun after `7718910` passed. On `f94887e` Codex found no major issues ("Didn't find any major issues. Hooray!"), and CI passed (run 43786562382).

### Prompt Context

**User prompt (verbatim):** see Step 6.

**Assistant interpretation:** Open the PR, answer the review, and leave the merge to the user.

**Inferred user intent:** A reviewed, green PR ready to merge.

### What I did

- **Opened #46** (<https://github.com/go-go-golems/slop-computer/pull/46>).
- **Codex P2: "Update the folder stamp only after a successful push"** (`pkg/client/dev.go:107`).
  - The loop advanced `stamp` before `devPush`, so a failed push was never retried.
  - Now a change sets `pending`. A failed push stays pending and is retried after a backoff (1 s, doubling to 30 s), or at once on another edit. `devErr` prints a repeated error once.
- **Codex P2: "Read the draft manifest when determining the dev instance type"** (`pkg/client/dev.go:160`).
  - The type came from `app.status` on the app store, which reads `main`. A new app with only a `draft` gave the instance no type, and `pkg/doors/pages/site.go:53` refuses typed mounts for it.
  - Now `manifestType(dir)` reads the folder's `app.json`, the manifest being pushed.
- **`TestSlopDev` additions:**
  - a check of the instance's type in `store.ls`. Against the previous `dev.go` it fails: `devloop_test.go:349: the instance's type is "", not app.json's`;
  - a `pushFails` transport that fails `files.push` while a flag is set. The test writes a file with the flag on, waits for "push failed, will retry", clears the flag, and waits for "on 3 · ok" with no further edit.
- **Codex P1: "Preserve token authority when opening embedded views"** (`pkg/doors/pages/embed.go:131`).
  - A view keeps only `v.User`, and `viewPrincipal` (`pkg/doors/pages/actors.go:22-31`) rebuilds a full person with `Web.PersonAs`.
  - So an embed opened by an action called with a token (say `write` without `admin`) gave the frame's `slop.call` more authority than the token had.
  - `renewEmbed` had the same hole: its answer carries the secret, so a scoped token of the same person could take over that person's browser embed.
  - Codex offered two fixes: keep the token's authority in the view, or reject tokens. I rejected tokens (`tokenEmbed` in both). An embed is a frame in a browser, opened by a person's page, and a view that kept a token's scopes would also outlive the token's revocation.
- **`TestEmbeddedViews`, rewritten.**
  - It now signs the admin and Bob in (`personView`), opens the tool's page view, and calls `embed`/`renew` over `slop.call` as a page does.
  - It checks that an admin's token gets `not_granted` for both.
  - `jot-dev` is granted to `@member` rather than to Bob's id, so the test does not depend on a browser sign-in and `tokenFor` making the same person.
  - The previous version of the test opened embeds with tokens successfully, which demonstrates the hole.
- **Codex P2: "Preserve self-closing tags without attributes"** (`pkg/doors/pages/embed.go:237`).
  - `withAttr` treated a slash as self-closing only after whitespace or a quote, so `<g/>` became `<g/ data-src=…>`. In inline SVG, the elements after `<defs/>` would become its children.
  - The token type cannot tell the cases apart: `x/net/html` returns `SelfClosingTagToken` whenever the byte before `>` is `/`, even when an unquoted value took it.
  - `closesTag(head)` follows HTML's tokenizer: the slash closes after whitespace, a quote, the tag name or a valueless attribute, and belongs to an unquoted value otherwise.
  - Test: `<defs/>`, `<g/>`, `<rect hidden/>`, `<circle r="1" />`, `<path d=M0/>` (the slash is the value's), `<use x=1 />`.
- **`doc/building-apps.md`** says embeds are for a person on a page.
- **The CI failure** (run 43782893587, job "release / publish", step "Run tests"):

  ```
  --- FAIL: TestBlocksSiteReader (0.36s)
      testing.go:1464: TempDir RemoveAll cleanup: unlinkat /tmp/TestBlocksSiteReader399659965/001: directory not empty
  ```

  - `gh run view --log-failed` printed nothing. `gh api repos/go-go-golems/slop-computer/actions/jobs/<id>/logs` gave the log.
  - Locally the test passed 60 times out of 60 (`-count=60`).
  - It is the only failed `publish-image` run in the last 30.
  - The next run, on `7718910`, passed (run 43783586702).

### Why

- **Backoff rather than retrying every tick:** a server that is down would otherwise get a full manifest every 500 ms and fill the terminal with the same error.

### What worked

- Both fixes pass, with the full suite passing and lint reporting 0 issues.

### What didn't work

- `gh pr checks 46 --json …` is not supported by this `gh` version ("unknown flag: --json").

### What I learned

- **A view carries a person, not a principal.** Anything that turns a module call into a view must make sure the caller had a person's full authority. Here that means refusing tokens.
- **The test harness never stops the actor manager.** `newHarnessWith` (`pkg/host/harness_test.go:49-75`) registers cleanups for `ts.Close`, `k.Close` and `sys.Close`, but `actor.Manager` has no shutdown at all. An actor turn still running at teardown can reopen a store through the kernel after `k.Close` and recreate its files while `RemoveAll` runs. This is the likely cause of the flake, but it is not proven.

### What was tricky

- **Telling a flake from a regression.** The failing test calls `app.status`, whose code this PR moved into `statusOf`. That shared function only reads, and the test passes 60 times locally.

### Second pair of eyes

- **A shutdown for `actor.Manager`** (stop timers, wait for running turns), called by `serve` on exit and by the harness, would fix the flake at its cause. It belongs in its own change.

### Future

- The merge is the user's: #46 is reviewed clean and green at `f94887e`.
- After the merge: one slop-yolo bump, then re-push the catalog kit.

### Code review

- `pkg/client/dev.go`: the loop's `pending`/`retryAt`/`backoff`, `devErr` and `manifestType`.
- `pkg/doors/pages/embed.go`: `tokenEmbed` in `embed` and `renewEmbed`, and `closesTag`.
- `TestEmbeddedViews`: embeds through signed-in pages.

### Technical details

```sh
gh api repos/go-go-golems/slop-computer/actions/jobs/133023896936/logs > ci46.log
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run 'TestBlocksSiteReader$' -count=60   # ok
```

## Step 10: merging #46, and importing Sitebench as the bench

The user merged the server side and approved committing Sitebench's source, which unblocked the bench app. Sitebench now lives in the repository as `web/bench/` (source) building `apps/bench/` (the app), with the same stamped-output convention as `web/admin`. Commit `33ee76c`.

### Prompt Context

**User prompt (verbatim):** "merge #46, then tell me where we are at with the coding agent?"

Then: "1. yes you can commit it. then move on."

**Assistant interpretation:** Merge #46. Report the bench's status. Then commit Sitebench's source (the open question I numbered 1) and carry on with the bench phases.

**Inferred user intent:** Get the coding agent working on real slop apps, not just designed.

### What I did

- **Merged #46** (`dee7f72`), after checking it was mergeable and green at `fee1c98`.
- **Re-extracted the archive.** The unzipped copy had lived in a worktree I removed. `~/Downloads/sitebench-workspace.zip` still matched the manifest (sha256 `048f3d25…`). I extracted only `sitebench/` into an empty scratch directory.
- **Scanned for secrets** before anything went into the public repository: key and token patterns, emails, hosts and home paths. The only hits were `you@example.com`, `localhost`, `w3.org`, and the probe masking password fields.
- **`web/bench/`:**
  - `src/` and `test/` unchanged;
  - `test/.gitignore` for the screenshots and zips the scripts write;
  - a README with the provenance;
  - `package.json` pinning `@tootallnate/quickjs-emscripten` 0.23.0 (its only release since 2023), acorn 8.18.0 (what the bundle contained) and esbuild 0.25.12 (as `web/admin`), plus its lockfile;
  - `build.mjs`, merging Sitebench's two builds. It writes `apps/bench/{app.js, index.html, sandbox.js}` with the source stamp. `index.html` carries the stamp in an HTML comment before the doctype, which keeps standards mode, and `stampRe` is unanchored.
- **The rest of the plumbing:** `make bench` (also in `.PHONY`), a `TestBuildOutputsFresh` entry, and `apps/bench/app.json` from stage 0.

### Why

- **A committed build output, like `web/admin` → `apps/backoffice`:** `go test` needs no node, and the app folder pushes as it is.

### What worked

- `app.js` and `index.html` are byte-identical to Sitebench's own `dist/` after the stamp line.
- On the local server the pushed app booted ("Corner Coffee 7 files", "0 issues"), and an eval ran in the QuickJS worker: "ok 23 ms · quickjs · main", "7 files, 3646 bytes of css".

### What didn't work

- **`sandbox.js` differs from Sitebench's** after the stamp: same size within 7 bytes, different minified names, probably another esbuild version. The eval above shows it works.
- **A secrets scan with `F="…"; grep … $F`** found nothing, because zsh does not split words. `set -- …; "$@"` fixed it.
- **Playwright's `fill` on the Eval textarea timed out** ("element is not visible"): the Eval tab sat behind Agent. Clicking the tab first fixed it.

### What I learned

- Nothing in the repository walks `apps/`. `scripts/deploy-apps.sh` lists apps by hand, so the bench is added there only when it should deploy.

### What was tricky

- **Deciding what "Sitebench's source" means.** It is the `sitebench/` folder only. The archive's reference folders (form-skate, the shop, the textbook) are other material and stay out.

### Second pair of eyes

- **The `npm install` warning `allow-scripts`.** esbuild's binary came from its optional platform package, so the build works without install scripts. CI's `npm ci` should behave the same.

### Future

- Phase 1.

### Code review

- `web/bench/build.mjs`;
- `web/bench/package.json`.

### Technical details

```sh
make bench    # cd web/bench && npm ci && node build.mjs
for f in app.js index.html sandbox.js; do tail -n +2 apps/bench/$f | cmp - sbzip/sitebench/dist/$f; done
```

## Step 11: Bench Phase 1, projects are app stores

A project in the bench can now be an app store on the server. Its files are the app's tree at `draft`, every edit is pushed there, and the bench's own documents keep threads, timeline, boards and proposals. Commit `8ce82aa`.

### Prompt Context

**User prompt (verbatim):** see Step 10.

**Assistant interpretation:** Guide Phase 1: the bench's actor, and the page's projects over it.

**Inferred user intent:** Open a real slop app in the coding agent.

### What I did

- **`apps/bench/actor.js`,** trusted with `workshop`, acting as the visitor:
  - `apps`: the stores the visitor administers that run no other store's app, with refs and instances, leaving the bench out;
  - `open`: `draft` from `main` the first time, with `ifAt: 0`, then the tree;
  - `read`: texts in 4 MB answers, with binary files named;
  - `sync`: `files.push` to `draft` with `activate` on the dev instance when it exists, answering with the new tree;
  - `create`: `store.new` plus a push to `draft`.
- **The page, a new `src/03b-slop.js`:**
  - `Slop`: the actor bridge. It is off without an actor, so the bench stays plain Sitebench on claude.ai.
  - `Sync`: debounce 300 ms, one push at a time. Changed files go as text; the rest by `sha256` and `size` from the server's tree.
  - `slopAppFiles`, the "New slop app" template.
- **`04-project.js`:**
  - `Project` gains `tree`, `synced` and `extern`. `extern` holds binary and over-240 KB files, which are pushed back by hash.
  - `write` and `remove` call `Sync.schedule` for app projects instead of saving file documents.
  - `Projects.openApp` (files from `draft`, the rest from `p_<app>/`) and `createApp`.
- **`11-app.js`:**
  - the project menu shows "Apps on this server" and "New slop app…";
  - the storage pill shows "draft n" and the dev state;
  - "Forget" for an app project leaves the store alone.
- **`TestBenchProjects`** (`pkg/host/bench_test.go`):
  - `apps` lists `jot` but not the bench or an instance;
  - `open` makes `draft` equal to `main`;
  - `read` names a real PNG (pushed with `blobs`) as binary;
  - `sync` pushes one change and one removal while `main` stays put and the PNG keeps its hash;
  - with a dev instance, `sync` reports `activated`;
  - `create` gives `draft` without `main`, and a bad id is `invalid_argument`.
- **Browser check:**
  - The menu listed the local apps ("jot: draft 4 · main 1 · 1 instance").
  - Opening `jot` gave "jot 2 files" and the pill "draft 4".
  - An eval's `files.replace` turned the pill into "draft 5" after 412 ms. On the server, `draft` held the edit, the snapshot message was "bench: index.html", and `main` was still "version ONE".

### Why

- **The project id is the app id,** so the bench's documents for `jot` are `p_jot/…`, as the guide's mapping says.
- **Frames stay srcdoc in Phase 1,** as planned. The console errors "Cannot read properties of undefined (reading 'use')" are `jot`'s page calling `window.claude` in a srcdoc frame.

### What worked

- The actor stayed small because `workshop` already had everything.

### What didn't work

- **The first PNG in the test was a Go string with invalid UTF-8.** JSON turned it into U+FFFD, so the server stored text. I pushed a real PNG with `blobs` instead.
- **A hash-only entry needs its size:** `no blob 6b7fa434… of 0 bytes for logo.png`. The page's `Sync` had the same bug. It now sends `size`.
- **My second sync in the test** overwrote `push[0]`, an arbitrary entry because Go map order is random, and so listed `index.html` twice (`index.html appears twice`). It now builds the manifest from the returned tree, and the test passes three runs in a row.

### What I learned

- **`files.push` entries by hash need `size`.**
- **Module functions take positional arguments plus a trailing options object** (`pkg/doors/actors/modules.go:92-98`), so `moveRef(app, 'draft', n, {ifAt: 0})` works.

### What was tricky

- **Edits made outside the bench.** On open, the bench compares `draft` with its timeline's last state. If they differ, it logs an `init` event by "push" noting that draft changed outside the bench. Live outside edits are Phase 3.

### Second pair of eyes

- **`sync` prunes:** files missing from the manifest are deleted. A push from a terminal between the bench's open and its next sync is overwritten. Phase 3 should compare `draft` before pushing, or reload on outside commits.

### Future

- Phase 2: frames as embedded views.

### Code review

- `apps/bench/actor.js`;
- `web/bench/src/03b-slop.js`;
- `openApp` in `web/bench/src/04-project.js`.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run TestBenchProjects -count=3
slop push apps/bench --store bench && slop app trust bench workshop && slop mount set --host <live> --path /bench --store bench
```

## Step 12: Bench Phase 2, canvas frames are the dev instance, live

The canvas now shows the real app. For an app project, the frames on its entry page are embedded views of the person's dev instance, served by slop with the instrumented page, the runtime and Sitebench's own probe. An edit reached both frames in 515 ms. Commit `be4d4a5`.

### Prompt Context

**User prompt (verbatim):** see Step 10.

**Assistant interpretation:** Guide Phase 2, the page half; the server half was C.1.

**Inferred user intent:** The live dev environment: edit, and see the running app change.

### What I did

- **One probe source.** `PROBE` moved from `05-site.js` into `src/05a-probe.js` (33,346 bytes). `build.mjs` also writes it into `pkg/doors/pages/assets/probe.js`, stamped, wrapped to start in embedded mode, with the nonce from the frame address (`sbn`) and the origin from the boot data's `parentOrigin`. It replaces C.1's small probe. `TestBuildOutputsFresh` covers it.
- **Embedded mode inside PROBE:**
  - it posts to and accepts messages from `CFG.origin` only;
  - there is no `window.site`;
  - links are not intercepted;
  - `sheetFile` maps a `<link>` stylesheet to its file from the URL (`/e/<token>/v/<n>/<path>`);
  - snapshots inline linked stylesheets.
- **`FrameHost`:**
  - `embeddable`: on slop, an app project, the entry page, `main`, and not headless, a fixture or the playhead;
  - `load` gets an embed through `Embeds.open`, which makes the dev instance once, sets `sbn`, and keeps the deep-link hash;
  - `swap` keeps the embed and origin and pushes mode, pins and preview;
  - `post` targets the frame's origin.
- **The bench as shell,** a listener for `slop: 1` messages from the iframes of its embeds:
  - `hello` gets the view and secret;
  - `renew` goes through the actor;
  - `reload` and `reopen` reload in place, keeping state;
  - `consent`, `confirm` and `download` are declined with a toast; `compose` and `permissions` are answered as the shell does.
- **Edits no longer reload embedded frames themselves.** They reload when the runtime says `draft` moved (`11-app.js`).
- **The actor:** `dev` makes the instance once (type from `draft`'s `app.json`, following `draft`), plus `embed` and `renew`.
- **`TestBenchDevInstance`:** a typed instance on `draft`, made once; `embed` and `renew` through a signed-in page's `slop.call`; `not_granted` for a token.
- **Browser check** (`various/bench-p2-embedded-frames.png`):
  - Both frames ran `jot` with its `db` ("from the dev instance, version FOUR (from the bench)"), 4 `data-src` elements and the probe. The pill read "draft 5 dev ok", and the Console showed "jot loaded" twice.
  - An eval replaced the text, and both frames showed "version FIVE, live" 515 ms after Run, with the pill at "draft 6 dev ok".
  - Clicking the `h1` showed "Source index.html:2" in the Inspector.
  - "New slop app…" created `bench-demo` ("4 files", "draft 1 dev ok"). In its frames, `frames.inspect` returned `styles.css main`, `frames.check` returned 0 issues, and `frames.outline` showed `main @index.html:10`.

### Why

- **Sitebench's PROBE, not the small one:** the bench's Inspector, checks, layout diffs, select, text edit and snapshots all speak its protocol. With one source, srcdoc and embedded frames behave the same.
- **Consent, confirm and downloads go through main-host endpoints** (`/_site/views/<id>/consent`, `/_site/confirm`) that the bench's origin cannot call with the person's session. They are declined rather than faked.

### What worked

- PROBE needed only six small changes for embedded mode.

### What didn't work

- **The build's first probe** failed `node --check`: "SyntaxError: Invalid regular expression flags". In a JS template literal, `\/` is `/`. The route now comes from `pathname.split('/').slice(5)`.
- **An eval whose output I searched for in the whole page text** seemed to return nothing. The result was in the Eval panel, as a JSON string inside the output.

### What I learned

- **Every edit opens new views for embedded frames:** one embed per frame per reload. Views expire after an hour, and the old iframes are removed. A `closeEmbed` would free them sooner.

### What was tricky

- **Which load a runtime message belongs to.** During a reload two iframes exist. The listener matches `e.source` against both the current and the next iframe and checks the origin of that load's embed. Only the current one may trigger a reload.

### Second pair of eyes

- **The double reload.** The server sends `reload` to every view of the dev instance, so with two frames there are two reloads per push. Each is coalesced by `reloadSoon`, which is fine, but worth watching with many frames.

### Future

- Phase 3: actor status and logs in effects and the Console; reloading on outside pushes; resetting dev data.
- Phase 4: the agent's API for slop apps (`app.*` instead of `data.*`).
- Closing embeds.

### Code review

- `web/bench/src/05a-probe.js` (the embedded-mode changes);
- `FrameHost` and the runtime listener in `web/bench/src/05-site.js`;
- `Embeds` in `03b-slop.js`;
- `dev`/`embed`/`renew` in `apps/bench/actor.js`.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run 'TestBench|TestEmbeddedViews|TestBuildOutputsFresh' -count=1
# browser: local server built from this branch; /bench mounted; open jot, then an eval: files.replace('index.html', …)
```

## Step 13: Bench Phase 3, the live backend loop, and a kernel cache bug

The bench now reports what the server did with each edit: which draft, whether the dev instance came up, and the actor's warnings. It also picks up pushes made outside it, and can reset a dev instance whose migrations no longer fit. The reset uncovered a kernel bug that cached a deleted store's failures by id. Commit `fd2bd78`.

### Prompt Context

**User prompt (verbatim):** see Step 10.

**Assistant interpretation:** Guide Phase 3.

**Inferred user intent:** The backend half of the live loop: migrations and actors, not just pages.

### What I did

- **Effects (`06-agent.js`).** An eval that wrote an app project's files calls `Sync.flush()`, which pushes now and waits. Each embedded frame then waits with `waitVersion(n)` until it shows the activated version, and only then does `frameEffects` measure. The effects gain `draft`, `actor {on, broken}`, `push {error}` and `actorLogs` (warnings and errors since the eval began), and `effectsLine` prints them.
- **Outside pushes (`Outside`, `03b-slop.js`).**
  - A poll every 3 s calls `head {app, base}`. When `draft` moved, `merge` takes files changed there and not here, logged as `who: 'push'` with "pushed outside the bench (draft n)", and keeps local edits.
  - `sync` sends `base`. The actor answers `{conflict, n, files}` instead of pushing when `draft` moved, and `Sync.run` merges and pushes again.
  - `head` also returns the dev instance's `{n, broken}`.
- **The dev instance's log** goes to the Console, as frame "actor".
- **Health:** a failed activation counts in the health pill, and its menu offers "Reset dev data". The project menu does too. `resetDev` uses workshop's guarded `drop`, and the next frame makes a fresh instance.
- **The kernel fix.** `forgetStore(id)` drops `failed`, `m` and `e` cache entries prefixed `id@`, and `DeleteStore` calls it.
- **`TestBenchOutsidePushesAndReset`:**
  - `head` at `base` returns no files;
  - after an outside push, `head` returns files and `sync` from the old `base` is a conflict that pushes nothing;
  - `logs` contains the setup's `console.warn`;
  - `resetDev` drops only the instance;
  - after a changed applied migration and a reset, the fresh instance is on `draft` and not broken. Without the kernel fix this fails with "migration sql/001.sql changed after it was applied".
- **Browser check:**
  - Effects line: "index.html +1 −1 · draft 7 · dev ok · layout changed on index.html".
  - `slop push --ref draft` from a terminal: the frames showed "version SEVEN, from a terminal". The project's file had it, and the timeline had `[write, push, index.html, "pushed outside the bench (draft 8)"]`.
  - A changed migration gave "draft 10 · dev instance stays on 9: activation of jot@10 failed: migration sql/001_notes.sql changed after it was applied; add a new migration instead", and the header showed "1 issue … dev broken".
  - Reset, after the fix: "0 issues … draft 11 dev ok".

### Why

- **Waiting for the frames before measuring:** otherwise the layout diff compares the old page with itself, and the effects say nothing.
- **A merge, file by file:** the guide's collaboration limit (open question 4). It is safe for the common cases of a terminal and a bench, or two people on different files.

### What worked

- The server already had everything (activation results, logs, guarded drop). Phase 3 is page and actor code plus the one kernel fix.

### What didn't work

- **"dev on 7" after an outside push.** The CLI push activated nothing through the bench, so the bench's `act` was stale. `head` now carries the dev status.
- **"dev on 9" instead of "dev broken", and "0 issues".** `Outside.logs` copied `app.logs`' `broken`, which is the actor's crash state, empty here, over the activation failure. Logs may now set it but never clear it.
- **Reset left the instance broken, on main** ("version ONE" in the frames, `app status`: `"n": 1`, the same "changed after it was applied"). `Running` caches failed activations by `id@n` (`pkg/kernel/apps.go:113-125`), and nothing cleared them on delete. That is the kernel fix.
- **Playwright's `getByRole('button', { name: 'Reset' })` matched "Reset scope" too.** It needed `exact: true`.
- **In `Sync.run`, a `return` in the conflict branch skipped the retry,** which sits after `try/finally`. I found it by reading before running; the branch now falls through.

### What I learned

- `app.logs`' `broken` and `app.status`' `broken` are different things: an actor in a crash loop versus a version that failed to activate.

### What was tricky

- **The manifest cache had the same flaw for app stores:** a store made again numbers its snapshots from 1, so `id@1` could return a deleted store's manifest. `forgetStore` covers it, but I have no test for that case.

### Second pair of eyes

- **Two pollers per open app** (`head` and `logs` every 3 s) per bench tab. That is fine for a few developers. A `log.watch` stream (guide, Appendix C) would replace them.

### Future

- Open the PR for Phases 0–3.
- Phase 4: the agent's API for slop apps.

### Code review

- `runEval` in `06-agent.js`;
- `Outside` and `Sync.flush` in `03b-slop.js`;
- `sync`/`head`/`logs`/`resetDev` in `apps/bench/actor.js`;
- `forgetStore` in `pkg/kernel/apps.go`.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run TestBenchOutsidePushesAndReset -count=1
# without k.forgetStore(id) in DeleteStore: bench_test.go:254: the fresh dev instance = map[… broken:migration sql/001.sql changed after it was applied …]
```

## Step 14: PR #47 (Phases 0–3), and Bench Phase 4, the agent on slop apps

I opened #47 with Phases 0–3 and continued on a stacked branch, `task/slop3-022-bench-p4`. Phase 4 teaches the agent what a slop app is and gives it the dev instance's data. Commit `9d7f431`. The guide's other Phase 4 half, fixtures and scenarios on run instances, is not done.

### Prompt Context

**User prompt (verbatim):** see Step 10.

**Assistant interpretation:** Keep going through the phases; put a reviewable checkpoint up.

**Inferred user intent:** The coding agent working on real slop apps.

### What I did

- **PR #47:** <https://github.com/go-go-golems/slop-computer/pull/47>. `scripts/deploy-apps.sh` installs the bench at `/bench` (trusted with `workshop`, `sample` for `@admin`), and `doc/building-apps.md` §3.2 has a paragraph on it. CI passed; Codex was still running when I wrote this.
- **The prompt.** `slopGuide(P)` is appended to the agent's prompt for app projects. It covers:
  - where writes go (`draft`; `main` and publishing are the person's);
  - what the frames show, and the effects fields;
  - how a slop app runs (`app.json`, one entry page with `window.claude`, `actor.js`, migrations never edited once run);
  - the `app.*` verbs, and rules.

  The Eval panel's "API reference (what the agent sees)" shows it too. It is filled when opened, because the panel is built before a project is open.
- **Host verbs:**
  - `app.info`, `app.status`, `app.logs`, `app.docs`, `app.doc`, `app.sql`, `app.seedDocs`, `app.seedTable`, `app.resetDev`, with signatures in `API_SIGS`;
  - `data.*` throws a policy error pointing to them in app projects.
- **Actor:** `docs`, `doc`, `sql`, `seedDocs` and `seedTable`, all on `<app>-dev-<you>`.
- **Headless frames of an app project are embedded too,** so the agent's reads work when the canvas tab is hidden. Like canvas frames, they rely on the runtime's `reload`, not on stale marks.
- **`TestBenchDevData`:** seeded documents and rows are found in the dev instance and not in the app store, and a `DELETE` through `sql` is `invalid_argument` ("not authorized").
- **Browser:**
  - `app.info`/`seedDocs`/`docs`/`status` answered `{"app":"jot","entry":"index.html","dev":"jot-dev-2915cc","notes":["notes/hello","notes/seeded"],"status":{"broken":"","n":11,…}}`;
  - `data.tables` gave "policy: data.tables is Sitebench's own tables, which this slop app does not see. …";
  - the reference panel contained "THIS PROJECT IS A SLOP APP: the app store "jot" …";
  - an agent turn on the fake model ran (built with the new prompt).

### Why

- **A stacked branch,** so #47 stays as described while review runs.

### What worked

- The host-API pattern made new verbs one line each. The bridge already awaits promises (`06-agent.js:20-43`).

### What didn't work

- **The reference panel did not show the slop section at first** (`ref: false`). It was built once at boot, before a project was open.
- **My first read of an eval's output looked before "Edit again"; the value comes after it.**

### What I learned

- **Two `srcdoc` errors appear during an agent turn** ("Cannot read properties of undefined (reading 'use')" from `about:srcdoc`). They come from frames built from files (a snapshot, the playhead or an isolated run). A slop page cannot run there, as the prompt says.

### What was tricky

- **The headless stale marking.** Embedded headless frames must not be marked stale on an edit, or `Headless.get` reloads them before the push lands.

### Second pair of eyes

- **`app.sql` is read-only (`sql.query`).** The agent changes table data through the app's own actions or migrations, as people would. Is that enough for debugging?

### Future

- Phase 4's other half: fixtures and scenarios on run instances.
- Phase 5.

### Code review

- `slopGuide` and the `app.*` verbs in `06-agent.js`;
- the data actions in `apps/bench/actor.js`.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run TestBenchDevData -count=1
```

## Step 15: Bench Phase 5, publish from the bench

The "insta publish" half of the user's request: from the bench, a preflight, a compare-and-swap publish, a rollout with "Activate now", and rollback. The agent can check and propose, and publishes only behind the person's approval. Commit `1a3ab68`.

### Prompt Context

**User prompt (verbatim):** see Step 10, and the ticket's first prompt: "… having for example a live updating staging / dev environment … and then basically 'insta publishing' the results".

**Assistant interpretation:** Guide Phase 5.

**Inferred user intent:** Ship from the same place you build, safely.

### What I did

- **Actor:**
  - `preflight` compares files at `draft` and `main` (added, changed, removed). It lists new migrations, and blocks on a migration changed or removed after `main` ran it. It lists production instances (the app store when it serves `main`, plus instances whose ref is `main`) and the visitor's dev status.
  - `publish {app, n, ifAt}`: both required; `ifAt: 0` for a first publish.
  - `activate {store}`.
- **Page:** `Publish` (`03b-slop.js`) with `preflight`, `run` (marks the timeline "Published draft n to main"), `rollback` and `lines`. A header button shown for app projects opens the dialog. After a publish, a rollout dialog offers "Activate now" per instance, and "Roll back to n" when there was a `main` before.
- **Agent:**
  - `publish.check()` returns the preflight plus a `summary`;
  - `publish.run({note})` shows `approvalCard` with the summary, publishes only on approve, and otherwise throws kind `approval`. It is in `LONG_CALLS` so the wait does not count against the eval's time.
  - The prompt says to check first and never edit a migration `main` has run.
- **`TestBenchPublish`:** see the commit.
- **Browser** (`various/bench-p5-publish-preflight.png`):
  - `bench-demo` (draft only): the preflight showed "draft 1 → main (first publish)", "files: +README.md +app.json +index.html +styles.css", "your dev instance runs draft 1: ok", "no production instance yet: nothing serves main". Publishing gave "bench-demo @1 · on 1".
  - Mounting failed before the publish ("bench-demo is plain content: mount it on a static host"), because a store without `main` has no manifest to serve. After the publish it mounted.
  - An eval edited the `h1` and returned `publish.check().summary`: "draft 2 → main (now 1)", "files: ~index.html", "your dev instance runs draft 2: ok", "production: bench-demo @1".
  - After publishing, the mount showed "Bench demo, version two". After "Roll back to 1", it showed "Bench demo".

### Why

- **Blocking only changed or removed migrations:** that is what makes production instances refuse a version (Step 13). Everything else is information.
- **An approval card for the agent:** publishing affects other people. The agent proposes, the person decides.

### What worked

- #46's `ref.move --ifAt` and `from` made publish and rollback two calls.

### What didn't work

- **A Playwright click on the Eval tab timed out** ("<div class="modal">… intercepts pointer events"): the rollout dialog was still open. I closed it first.

### What I learned

- **A store with only a `draft` cannot be mounted on the live host:** without a manifest at `main` it counts as plain content. The first publish is what makes it mountable. The bench could offer the mount after a first publish.

### What was tricky

- **Which instances are "production".** I used those whose ref is `main` (empty means `main`) and that have a manifest. Dev, proposal and run instances follow other refs.

### Second pair of eyes

- **The preflight activates every production instance it reads** (`app.status` runs `Running`). That is what their next view would do anyway, but on an app with many instances the preflight is slower and the activations happen earlier. A status that does not activate would be better.

### Future

- Phase 4's fixtures and scenarios; Phase 6 (proposals on refs).
- Offering a mount after a first publish.
- Closing embeds.
- The PR for Phases 4–5 after #47.

### Code review

- `preflight`/`publish`/`activate` in `apps/bench/actor.js`;
- `Publish` in `03b-slop.js`;
- `publishDialog`/`rolloutDialog` in `11-app.js`;
- `publish.*` in `06-agent.js`.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run TestBenchPublish -count=1
```
