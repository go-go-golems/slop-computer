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

## Step 16: Closing embeds, and Codex on #47 and #48

Two pieces of work. First, `closeEmbed`: the bench now closes a frame's old view when the frame reloads, where before every edit left a view open for an hour (`cd08e7a`, on #48). Second, eight Codex findings, four per PR, all P2 and all real. #47's are about losing edits in `Sync` and an empty file failing a push (`e3d5f8a`). #48's are about publishing: what gets approved versus what gets published, a preflight that activated instances, and dry runs that wrote (`c6d3542`). Phases 0–3 are on #47 and Phases 4–5 on #48; #48 is stacked on #47 and has #47's fixes merged in (`243c089`).

### Prompt Context

**User prompt (verbatim):** "check codex review comments on the PRs"

**Assistant interpretation:** Read Codex's findings on #47 and #48, fix the real ones, and push.

**Inferred user intent:** Get both PRs to mergeable.

### What I did

- **`closeEmbed`:**
  - `Door.CloseEmbed` (`pkg/doors/pages/embed.go`) closes the view and drops its embed addresses, for the person and the tool that opened it; a token gets `not_granted`.
  - `workshop.closeEmbed`, and an actor action `close`.
  - `FrameHost.swap` closes the previous view once the reloaded one takes its place, and `dispose` closes both.
  - `TestBenchDevInstance`: after a close, renew is `not_found` and the frame's address is 404.
- **#47, Sync:**
  - `pending(P)` is true when some text differs from what was last pushed, or a pushed file was removed since.
  - `flush()` loops on `pending`, not on the status.
  - `run()` ends in `dirty` when edits arrived during the push.
  - `Outside.merge` records each file's text before the read and skips any file edited meanwhile; `Outside.merging` holds pushes.
  - `openProject` flushes first, and a hidden tab pushes.
- **#47, `files.push`:** `pushFile.Text` is now a `*string`, so `""` is an empty file.
- **The test hook:** `window.__SB` is now set on `*.localhost` (where a local slop serves the bench), with `Sync`, `Slop` and `Outside`. That made the page-side races scriptable from Playwright.
- **#48, publishing:**
  - The preflight reads `files` at `String(refs.draft)` and `String(refs.main)`.
  - `kernel.Peek` and `app.status {peek}`; the actor's `statusOf(ctx, id, peek)`; production entries carry `next`.
  - `Publish.preflight` refuses on a flush error or pending edits.
  - `flush()` clears a stale error when nothing is pending.
  - `noDryData()` guards `app.seedDocs`, `app.seedTable`, `app.resetDev` and `publish.run`.
- **PR comments** map each finding to its fix and ask `@codex review`.

### Why

- **`Peek` in the kernel, not in the bench:** only the kernel knows the store's `app_version` against the ref, plus recorded failures.
- **One flag on `app.status`:** cheaper than a new verb, and the CLI gets it for free (`slop app status <store> --peek true`, a string flag like every boolean in this CLI).

### What worked

- **Each Go fix has a test that fails without it:**
  - the empty file: "actor.call … sync …" failed at the old `files.go`;
  - the peeking preflight: `production = [… n:3 next:0 store:jot-1]` with the activating status.
- **The browser runs through `__SB`:**
  - a queued edit during a push reached draft ("two");
  - an empty file synced (`""`);
  - an edit made during the outside read was kept ("local while reading" on the page and in draft);
  - the edit made before a project switch was in draft;
  - with a failing push: "Could not check bench-demo: your edits are not in draft (simulated push failure); fix that before publishing";
  - "bench-demo-1 @11 (1 on its next view)", still `{n:11, next:1}` after the dialog;
  - the four writes in `.dry()` were refused ("policy: dry runs capture file writes only…"), with 0 documents before and after.

### What didn't work

- **`frame.evaluate` could not see `App`** ("ReferenceError: App is not defined"): the build wraps the bench in an IIFE, and the old hook only matched a bare `localhost`.
- **A stale `error` status blocked publishing.** In the first refusal run, the test edit was removed after the simulated failure, but `Sync` stayed in `error`. The next Publish refused, and the script timed out waiting for "Publish draft". That is the flush fix above.
- **"Activate now" was missing after a publish,** because bench-demo was already "@11 · on 11". It was not the preflight: `reloadApp` (`pkg/doors/pages/views.go:525`) activates every store with an open view of the app when its ref moves. My earlier test tabs had left views on bench-demo. A fresh instance without views (`bench-demo-1`) showed the waiting state.
- **My first draft of `statusOf` called `Running` and then `Peek`,** which would still activate. I caught it on reread and changed it to choose one.
- **`dry.begin()` in an eval:** "'dry' is not defined". The form is `step.dry()`, e.g. `app.resetDev().dry()`.
- **Toasts are `#toast`,** not `.toast`.

### What I learned

- **"On its next use" includes open views:** publishing reloads them right away. The rollout dialog's "activates on its next view" holds only for stores nobody has open.
- **Views of closed tabs stay registered** until they expire or their stream ends. That is the same reason `closeEmbed` was worth doing for frames.

### What was tricky

- **Never-activated production instances have no manifest under `Peek`.** The production filter is now `manifest || next`.

### Second pair of eyes

- **`Kernel.Peek` reports a recorded failure for `next`** as `Running` does (`Failed` set, `N` the current version). It does not report `next` in that case. Is that what a rollout list wants?
- **The `__SB` hook on `*.localhost`:** a production host never ends in `.localhost`, but check that no deployment serves the bench under such a name.

### Future

- Phase 4b (fixtures and scenarios), Phase 6 (proposals on refs).
- Offering a mount after a first publish.
- An `actor.Manager` shutdown for the `TestBlocksSiteReader` flake.

### Code review

- **#47:** `Sync.pending`/`flush`/`run`, `Outside.merge`/`mergeIn` in `web/bench/src/03b-slop.js`; `pushFile.Text` in `pkg/commands/files.go`.
- **#48:** `Kernel.Peek` and `running(ctx, id, activate)` in `pkg/kernel/apps.go`; `statusOf(..., peek)` in `pkg/commands/mounts.go`; `preflight` in `apps/bench/actor.js`; `Publish.preflight` in `03b-slop.js`; `CloseEmbed` in `pkg/doors/pages/embed.go`.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run 'TestBench|TestEmbeddedViews|TestBuildOutputsFresh' -count=1
slop app status bench-demo-1 --peek true    # {"n": 11, "next": 1, …} after a rollback to 1
```

Screenshot: `various/bench-p5-preflight-next.png` (the preflight with an instance waiting).

## Step 17: Codex round 2 on #47 and #48

Codex's second pass found four more real P2s:
- three on #47: a sync base check that was not atomic, a duplicate manifest entry when a hash-only file is rewritten, and an opening snapshot too large to save;
- one on #48: a migration that production ran, which a rollback took out of `main`.

All are fixed with tests and a browser check. #47 is at `e0e274e`; #48 is at `145551a` (the fix `6689d59`, plus a merge of #47).

### Prompt Context

**User prompt (verbatim):** see Step 16 ("check codex review comments on the PRs").

**Assistant interpretation:** Keep going until Codex's findings are dealt with.

**Inferred user intent:** Mergeable PRs.

### What I did

- **`files.push` takes `ifAt`.** It is checked in the push's own `s.Do` turn, before the blobs, against `t.RefAt(ref)`; a mismatch is a `conflict` with `Extra.at`, and nothing is written. `ifAt` without a snapshot is `invalid_argument`. The bench's `sync` passes `ifAt: base ?? 0` and turns a `conflict` (`e.code` in actor JS) into `{conflict, n, files}`.
- **`Project.write` on `main`** deletes the path from `extern`.
- **The log storage** (`04-project.js`):
  - Limits are `LOG_CHUNK` 150000, `LOG_EVENT` 60000 and `LOG_PIECE` 100000 characters.
  - `stored(e)` returns the event, or a stub `{$ext, n}` after saving its JSON in pieces `logx/<id>-<k>`. A `WeakMap` remembers what was saved, so an unchanged big event is not rewritten.
  - `loadLog(logs, parts)` serves both loaders, and `remove` also clears `logx`.
  - The coalesced-write path adds the event's growth to its chunk's size.
- **`app.status {migrations}`** returns `applied` (from `_migrations` via `st.ReadQuery`). In the preflight, each production instance's `applied` is checked against the draft's sha256s, giving the blocker "migration X differs from the one that ran on …". It skips paths already blocked as changed against `main`.
- **PR comments** with `@codex review`. I first posted #48's with an invented hash ("0a1f1b6+") and corrected it to `6689d59` by `PATCH`ing the comment.

### Why

- **`ifAt` on `files.push`,** not a lock in the bench: only the store's turn makes check-and-write atomic. `ref.move` already had the same shape.
- **Splitting at storage,** not splitting `init` events: `init` events are read in several places (`stateAt`, history at `04-project.js:321`, `pageEvents`, the timeline labels). Keeping events whole in memory changed none of them. It also covers a single large `write`.
- **Instances' applied migrations,** not `main`'s history: `activate` checks `_migrations`, so that is the ground truth.

### What worked

- **`TestPushIfAt`:** a match, `ifAt` 0 on an existing ref, a stale `ifAt` (the tree still has one file), and `ifAt` with `snapshot: false`.
- **`TestBenchPublish`:** "differs from the one that ran on jot, jot-1". With the blockers loop emptied, it fails (`blockers:[]`).
- **Browser, `bench-big`** (`a.txt` and `b.txt` at 140000 bytes, `big.js` at 250007):
  - replacing `big.js` gave `flushError: ""`, `extern: []`, and draft `"// small now\n"`;
  - after a reload, events were `["init","write:big.js"]` with `initA`/`initB` 140000.
- **Browser, `bench-demo` after the merge:** a push from a stale base came back as a conflict and was merged. Draft had both the bench's CSS edit and `outside2.txt`; the test changes were removed afterwards. The Publish dialog showed "production: bench-demo @1, bench-demo-1 @11 (1 on its next view)".

### What didn't work

- **The first assertion for the migration blocker** expected "ran on jot-1". The app store `jot` had also run `002`, so the message lists "jot, jot-1".
- **`fmt` was missing twice** (`files.go`, `mounts.go`): "undefined: fmt".
- **The CLI's `push` does not expose `ifAt`:** it is a hand-written client command. The verb takes it.
- **A `sed` on the PR comment did not match** my own wording; replacing only the hash worked.

### What I learned

- **`_migrations` and other `_` tables are invisible to `sql.query`** (`appName` in `pkg/store/sqlpolicy.go:24`). Kernel facts need a verb.
- **The app store itself counts as a production instance** when it serves `main` (mounted), and it records its own migrations.

### What was tricky

- **Piece size against the document limit:** the store checks `JSON.stringify(data).length` ≤ 255000. A 100000-character slice of JSON at worst doubles when stringified again, which stays under the limit.

### Second pair of eyes

- **`Store.listRaw` reads at most 1000 documents per collection** in db mode, so `logx/` over 1000 pieces (about 100 MB of history) would lose events. That is unlikely, but the bound is not enforced.
- **The "removed after it ran on main" blocker is stricter than activation,** which ignores missing migrations. Keep it, or make it a warning?

### Future

- Wait for Codex round 3, then the user merges #47 and #48.
- Phase 4b; Phase 6.

### Code review

- `push`'s `ifAt` in `pkg/commands/files.go`;
- the `sync` action in `apps/bench/actor.js`;
- `stored`/`loadLog` in `web/bench/src/04-project.js`;
- `app.status` migrations in `pkg/commands/mounts.go`;
- the `ranElsewhere` loop in the preflight.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./pkg/host -run 'TestPushIfAt|TestBenchPublish' -count=1
slop app status jot-1 --peek true --migrations true   # applied: {"sql/001.sql": "…", "sql/002.sql": "…"}
```

## Step 18: Codex round 3 (#48 clean; two more on #47)

Codex's third pass found no major issues on #48 (`145551a`). On #47 (`e0e274e`) it found two more real P2s, now fixed in `843c669`, with `b8ed113` for the `probe.js` stamp I first forgot to commit. The first: tree reads went through the mutable `draft` ref instead of the snapshot they report. The second: log pieces were sized in characters while storage limits UTF-8 bytes. #48's head `38c7edf` merges them.

### Prompt Context

**User prompt (verbatim):** see Step 16.

**Assistant interpretation:** Keep fixing until Codex is clean.

**Inferred user intent:** Mergeable PRs.

### What I did

- **Snapshot-consistent tree reads** in `apps/bench/actor.js`:
  - `open` reads `files` at `String(refs.draft)`;
  - `sync` reads its answer at `String(res.n)`;
  - the conflict answer and `head` read at `String(refs.draft)`.
  - `openApp` reads texts at `String(p.refs.draft)`.
- **Byte-based log sizes:**
  - `utf8Len` and `logPieces(json, max)` in `04-project.js`;
  - `LOG_PIECE` is 200000 bytes;
  - `stored()` skips the byte count for short events (`json.length <= LOG_EVENT / 3`);
  - `loadLog` counts chunk sizes in bytes.
- **`scripts/03-log-pieces-check.mjs`** loads `utf8Len`/`logPieces` out of the source and checks four corpora against `Buffer.byteLength(JSON.stringify({text}))`.

### Why

- **The SDK limit is the one that counts:** `claude.js` `checkBody` rejects more than 262,144 bytes of UTF-8 JSON. `03-store.js`'s own 255,000-character check is looser for non-ASCII text.

### What worked

- **The piece check:**
  - cjk: 3 pieces, at most 200009 bytes;
  - quotes: 7 pieces, at most 200011;
  - emoji: 3 pieces, at most 200011;
  - ascii: 3 pieces, at most 200011.
  
  All of them join back exactly.
- **Browser:** `bench-cjk` (`a.txt`/`b.txt` at 210000 bytes each, 70000 characters) gave `initA` 70000 and `initB` 70000 after a reload, with no storage errors in the console.

### What didn't work

- **I committed `843c669` without the rebuilt `pkg/doors/pages/assets/probe.js`:** I staged `apps/bench` and `web/bench` only. `TestBuildOutputsFresh` would have failed in CI. Fixed in `b8ed113`. From now on I stage `pkg/doors/pages/assets/probe.js` with every bench rebuild.
- **My wait loop's `created_at` filter (03:40Z) was later than Codex's comments (03:16Z),** so the background check printed none. I found them by commit id.

### What I learned

- **A ref read after a write can belong to someone else's write.** Every read that pairs with a number should be read at that number.

### Code review

- `logPieces`/`utf8Len` in `web/bench/src/04-project.js`;
- the four `w.files(app, String(…))` calls in `apps/bench/actor.js`.

### Technical details

```sh
node ttmp/…/scripts/03-log-pieces-check.mjs web/bench/src/04-project.js
```

## Step 19: Codex round 4 on #47: eval writes held until commit; imported history bounded

Codex's fourth pass on #47 (`b8ed113`) found two more real P2s:
- an eval that waits past the 300 ms debounce and then fails had its intermediate writes pushed, and the dev instance activated on them, before the rollback;
- import and duplicate wrote history around the new bounded storage.

Fixed in `3fbba56`. #48 merges it (`0114524`) and adds a clearer refusal for publishing in the same eval as writes (`470be35`).

### Prompt Context

**User prompt (verbatim):** see Step 16.

**Assistant interpretation:** Keep fixing until Codex is clean.

**Inferred user intent:** Mergeable PRs.

### What I did

- **Holding pushes during an eval:**
  - `Sync.holds` with `hold()`/`release()`: `schedule()` marks the project dirty but sets no timer while held, and `run()` and `flush()` do nothing while held.
  - `release()` schedules a push when something is pending; otherwise it turns `dirty` back to `synced`.
  - `runEval` holds around `Sandbox.run` for app projects on `main`. The rollback moved into the `finally`, so it also runs if the sandbox throws, and the hold is released after it.
- **`Project.saveLog()`** rebuilds every chunk with `storedSize`/`stored()`. `Projects.create` uses it instead of its own `JSON.stringify(e).length` chunking.
- **The test hook** also exposes `Projects` and `Store`.
- **On #48, `Publish.preflight` inside a held eval with pending writes** now says "files written in this eval reach draft when it ends: publish in a later eval".

### Why

- **Holding at `Sync`,** not deferring `P.write`: the eval's reads have to see its own writes, and only the push must wait.

### What worked

- **Browser (`bench-demo`):**
  - write `held.txt`, `setTimeout` 1.5 s, throw: draft stayed 15, with no `held.txt`;
  - the same eval returning: draft 16 with `held.txt` "kept".
- **The import check:** `Projects.create({data})` with an `init` of two 140000-character files, then a reload: `initA`/`initB` were 140000, with 2 pieces under `logx`. The test project was removed.
- **Publishing in the same eval:** in the writing eval, `publish.check()` was refused with the new message; the next eval's check showed "draft 18 → main (now 1)", "files: +held2.txt ~index.html".

### What didn't work

- **My eval-output scraper picked up the earlier result line** ("rolled back held.txt Error") for the second eval. I relied on the draft reads instead.

### What I learned

- **Two places wrote log chunks** (`log()` and the import path). Codex found the second one after the first was fixed. Both now go through `stored()`.

### Second pair of eyes

- **Local (non-app) projects save each file as its own document:** a CJK file near the 240,000-character cap is ~720 KB and would be refused. That is pre-existing Sitebench behaviour, not touched here.

### Code review

- `Sync.hold`/`release` in `03b-slop.js`;
- the `try`/`finally` in `runEval` (`06-agent.js`);
- `saveLog` in `04-project.js`.

## Step 20: Codex round 5 on #47: Sync per project; rollback restores hash-only files

Codex's fifth pass on #47 (`3fbba56`) found two consequences of the round-4 hold:
- a rollback of an overwritten hash-only file did not bring it back, so a later push deleted it;
- switching projects during a held eval detached the project before its writes were pushed.

Fixed in `aa56b77`. #48 merges it (`651cec3`, one source conflict in `Sync.flush`).

### Prompt Context

**User prompt (verbatim):** see Step 16.

**Assistant interpretation:** Keep fixing until Codex is clean.

**Inferred user intent:** Mergeable PRs.

### What I did

- **`Sync` is per project:**
  - `queue` holds app projects with edits not in draft; `schedule(P)` queues any app project, not only the attached one.
  - `soon()` sets one debounce timer, and `runAll()` pushes the queued projects, the attached one first.
  - `run(P)` and `flush(P)` take a project. Errors and the last activation live on the project (`P.syncError`, `P.lastAct`); `status`, `n` and `act` still describe the attached project for the header.
  - `attach` no longer clears the timer, so an outgoing project's push still happens.
  - `runEval` calls `Sync.flush(P)`; on #48, so does `Publish.preflight`.
- **The hash-only rollback:** the `touchFile` snapshot gains `ext` (the `extern` entry on `main`), and `Project.revert` restores it when the path ends up without text.

### Why

- **I did not make the switch wait for the held eval:** an agent turn spans many evals and can take minutes, and the agent keeps writing to its own project between evals anyway. Pushing per project covers both cases.

### What worked

- **Browser (`bench-big`, `big.js` re-pushed at 250007 bytes):**
  - writing `big.js` and throwing left `extern` at `["big.js"]`; the next edit (draft 4) kept `big.js` at 250007;
  - an eval writing `switch2.txt`, with a switch to `bench-demo` at 0.7 s, gave draft 5 with `switch2.txt` (13 bytes), an empty queue, and `bench-demo` synced.
- **The round-1 checks rerun:** "two", `""`, "local while reading", "before switching". `bench-demo`'s draft was back to its four files.
- **#48 rechecked:** the failing-push refusal toast; `synced` after undoing the edit; the dialog with "draft 26 → main (now 1)".

### What didn't work

- **The #48 merge conflicted in `Sync.flush`'s return:** #48's stale-error clearing against #47's per-project version. I took #47's, which carries the same clearing per project.

### What I learned

- **Every hold needs an answer to "and if the context moves meanwhile?"** Codex found the switch case within one pass.

### Second pair of eyes

- **The queue holds project objects:** reopening a project creates a new object, so an old object with unpushed edits can still push after the new one opened. The new one then merges it as an outside push. Check that this ordering never loses an edit made in the new object in the meantime: its base is newer, so its own push conflicts and merges.

### Code review

- `Sync` in `web/bench/src/03b-slop.js`;
- `touchFile` (`06-agent.js:132`) and `Project.revert`.

### Technical details

`bench-big` and `bench-cjk` are local test apps; `bench-big`'s draft keeps the test edits (`switch2.txt`, an HTML comment).

## Step 21: Codex round 6 on #47: holds per project; removed hash-only files are pending

Codex's sixth pass (`aa56b77`) found two more gaps in the round-5 `Sync`:
- a hold was global, so an eval running on app A kept app B's finished eval from pushing;
- `pending()` only looked at text files, so a hash-only file replaced and then removed was never deleted from draft.

Fixed in `b37267a`. #48 merges it (`4f8a180`, with its in-eval publish message moved to `Sync.held(P)`).

### Prompt Context

**User prompt (verbatim):** see Step 16.

**Assistant interpretation:** Keep fixing until Codex is clean.

**Inferred user intent:** Mergeable PRs.

### What I did

- **Per-project holds:** `P.syncHolds`, with `hold(P)`/`held(P)`/`release(P)`. `soon()` arms the timer if any queued project is not held, `runAll` skips held projects, and `run`/`flush` check `held(P)`. `runEval` holds and releases its own project.
- **`pending(P)` checks draft's tree:** any path of `P.tree` absent from both `P.files` and `P.extern` is pending. `run`'s `gone` list and `Outside.mergeIn`'s `mine()` use the same rule.

### What worked

- **Browser:**
  - on `bench-big`, one eval that wrote `big.js` and removed it gave draft 7 without `big.js`;
  - with `bench-big` held through `Sync.hold`, an eval on `bench-demo` pushed (26 → 27, `heldB.txt`), and a later one reported "created probe3.txt · draft 29 · dev ok";
  - on #48, the in-eval `publish.check` was still refused with the "publish in a later eval" message.
- **Cleanup:** `bench-big` got `big.js` back (draft 8), and `bench-demo`'s draft is back to its four files.

### What didn't work

- **"wrote draft 7 · dev ok" looked like the `bench-demo` eval reporting `bench-big`'s draft.** It was my scraper: in the Eval panel, an entry's effects line comes before its "Edit again" and its return value after. I had joined one entry's value to the previous entry's effects. I reran with a unique return value and read around it.

### What I learned

- **The Eval panel's entry layout is effects, "Edit again", value.** Scrape around a unique value, not after the first "Edit again".

### Code review

- `Sync.hold`/`held`/`release`/`pending` in `web/bench/src/03b-slop.js`.

## Step 22: Codex round 7 on #47, and where the real model stands

Codex's seventh pass on #47 (`b37267a`) found two more P2s. First, the Eval panel saved an eval's scope and timeline entry to whatever project was open when it finished. Second, `flush` returned the old draft with no error when its ~12 s wait ran out. Fixed in `acd5951`; #48 merges it (`c1592ee`). The user also asked how to get a real model; the answer is below, with the evidence from staging.

### Prompt Context

**User prompt (verbatim):** "How can we wire up real LLM functionality? or where are we at?" (sent mid-turn, after "how can I test it?")

**Assistant interpretation:** Explain what is needed for the bench's agent to run on a real model, and the current state.

**Inferred user intent:** Try the agent for real, not on the fake backend.

### What I did

- **The Eval panel** captures `P`/`ws` at the start of a run: `replScope`, `P.log`, and the header label (with the project's title when another one is open now). The scope view repaints only if the same project is still open.
- **`flush`:**
  - waits up to `FLUSH_WAIT` (60 s) for other pushes and tries at most `FLUSH_TRIES` (20) pushes;
  - giving up with edits pending returns an error ("still waiting for another push after 60 s…" or "draft kept moving…") and keeps the project queued.
- **Model facts:**
  - `serve --llm pi` (config `llm: pi`) serves `sample` through Geppetto with Pi's `~/.pi/agent` on the server host. `pkg/llm/request.go` takes `modelTier` (quick/default/complex → Pi models, `pkg/llm/gepp/backend.go`), `model`, `effort`, `maxTokens` and `tools` (at most 16), with `MaxRounds` 10.
  - The bench calls `window.claude.use('sample')` with one tool and streams through `onText` (`06-agent.js:668`, `:802`).
  - On staging (read-only CLI with the user's default login), `llm ls` shows `@admin` allowed with no budget and `@member` allowed with 2,000,000; `llm usage` shows 1,200,294 tokens used this month as `@admin`.

### What worked

- **Browser:** a slow eval on `bench-demo`, with `jot` opened 0.6 s in, put its scope (`marker`) and its eval entry on `bench-demo`. `jot`'s latest eval was an older one, and its scope was untouched.

### What didn't work

- **A bench push went to staging by mistake.** In the merge step I chained `$S/rep/bench push apps/bench --store bench` without `SLOP_CREDENTIALS`/`SLOP_SERVER`, so it used the user's default login (staging). Staging answered "error: not_found: no store bench", and nothing was written. `store ls` there shows only `bench-twin`, an existing store of the user's. From now on, every local CLI call sets both variables on the same line.
- **The flush timeout and tries cap were not exercised.** That would need a push held for over 60 s, or a server answering conflicts 20 times.

### What I learned

- **The real-model path needs no new code:** an environment with `llm: pi` plus the bench's `sample` policy for `@admin` is enough. What is untested is the agent's behaviour with a real model on slop apps: the prompt, tool use and the eval loop.

### Future

- **Run the agent on a real model**, locally with `--llm pi` or on staging after deploying, and fix the prompt and tool loop on what a real model does.

## Step 23: The agent on a real model (lunaroute/deepseek-4.1-flash)

The user asked me to test the agent on a real model. It took three fixes before it worked. Once it did, the agent built a tags feature into `jot`, across a migration, an actor and the page. It fixed its own bug after I accepted its proposal, verified the fix through the running page on the dev instance, and stopped short of publishing. Getting there exposed two problems on the model path, one ours (Geppetto) and one in the provider path, plus one gap in the agent's guide.

### Prompt Context

**User prompt (verbatim):** "ccan you test it? with lunaroute/deepseek-4.1-flash". Then, mid-turn:
- "is this working on the backend? how is this rigged up to send to the model and interpret the models response?"
- "does it use geppetto?"
- "so it was the claude completion that was broken?"
- "is it something on our side?"

**Assistant interpretation:** Run the bench's agent on that model locally, find what breaks, and explain the model path.

**Inferred user intent:** Know whether the agent is usable with a cheap real model, and what is broken where.

### What I did

- **Local server on a real model.** `serve --config llm-deepseek.yaml --local` with `llm: pi` and `pi.models` quick/default/complex → `lunaroute/deepseek-4.1-flash`. `listen` and `data` have to be in the YAML: host defaults are computed from the config's `listen` before the flag applies, and I first got "unknown host apps.localhost:18490".
- **Probes from the page:**
  - `sample('pong')` worked (2.1 s, `modelTierApplied: quick`), as did a message array, a tool round trip (`"42"`) and streaming.
  - Any input with an assistant turn failed: "The model provider request failed".
- **Raw provider error, from a debug binary** (`log.Printf` in `classify`, not committed): `responses api error: status=400 … 239 validation errors … 'loc': 'body.input.1…content.0…type', 'msg': "Input should be 'input_text'", 'input': 'output_text'`.
  - Geppetto's Responses encoder (`openai_responses/helpers.go`, `buildResponsesMessageParts`) sends history as `{role: assistant, content: [{type: output_text}]}` with no id or status. That is valid only as an output item; strict validators reject it.
- **A scratch Geppetto copy with a `MarshalJSON`:** an assistant message without an id goes out as string content. I built `rep/bench-gp` against it with `-modfile` (`replace github.com/go-go-golems/geppetto => scratch copy`). The three-turn probe then said "pong".
- **The agent then failed with "Empty completion".** A probe showed the model writing its tool call as text, `<tool calls>{"name":"eval",…}</tool calls>`, which lunaroute's Responses endpoint did not turn into a `function_call`. The same happened with `:low` thinking. The tool call reached the page as prose, so the turn ended after "I'll start by reading the existing files."
- **Why Responses at all:** Pi's `models-store.json` declares `lunaroute/deepseek-4.1-flash` (and `-background`) as `api: openai-responses`, `reasoning: true`, while the provider in `models.json` says `openai-completions`. Geppetto's Pi resolver (`providers/pi/resolve.go`) picks the engine from the model's `api`.
- **A scratch Pi agent dir** (`pi-agent-chat/`): symlinks to every file of `~/.pi/agent`, credentials included (not read by me), except a 0600 copy of `models-store.json` with those two models on `openai-completions`. `pi.agent_dir` points at it. Over Chat Completions, a two-call tool sequence worked (`files.list()`, then reading `app.json`), and so did history.
- **The agent run:**
  - In Auto mode, the turn made 9 evals and put migration `002_tags.sql`, `actor.js` (`addTag`/`tags`), `app.json` (actor, user capability), a 200-line `index.html` and a README into a proposal.
  - I accepted it: draft 12, the dev instance activated it, not broken.
  - On the page, adding a tag failed: "not enough args to execute query: want 2 got 1". The agent had written `sql.run(q, [note, tag])`; slop's `sql` takes each argument as a separate parameter (`pkg/actor/modules.go:205`).
  - I added the `sql` call shape to the slop section of the agent's prompt (`76ce1c6` on #48).
  - A second turn in Main mode fixed `actor.js` (draft 13, dev ok), typed `urgent` into a tag input in the frame, clicked Tag, read it back with SQL, and reported "Draft 13 … Main is still at 1 — nothing published".
- **My own check:** `select note, tag from tags` on `jot-dev-2915cc` gave `notes/seeded`/`urgent`, and `actor call … tags` gave `["urgent"]`. A freshly loaded frame shows "seeded by the agent · urgent". Screenshot: `various/bench-real-model-deepseek-jot.png`.
- **The server now runs the normal binary** with the scratch Chat Completions agent dir.

### Why

- **Patching a copy rather than the module cache or `~/.pi`:** both are shared, and the user's Pi setup is theirs to change.

### What worked

- **The whole bench → slop → Geppetto → lunaroute chain, once on Chat Completions:** streaming, tool rounds through the page (`sample.go` sends `tool`, the page runs the eval and posts the result), `modelTier`, and metering.
- **The agent followed the slop guide:** it used `app.status`/`app.logs`/`app.docs`, read `effects.draft` and the dev status, verified on the dev instance, and did not publish.

### What didn't work

- **`--config` without `listen`** gave "unknown host apps.localhost:18490" (HTTP 421).
- **The Responses history encoding** (Geppetto) and **tool calls as text** (lunaroute's Responses endpoint for this model): see above.
- **My first frame read** still showed "no tags yet": that frame had fetched its tags before the agent added one. The page fetches tags once per note per load.
- **My first `pkill` pattern** didn't match `bench-dbg`/`bench-gp`, and the healthz check could have answered from the old server. I checked `ps` before trusting it.

### What I learned

- **Auto mode in an app project writes a proposal.** The dev instance runs draft, so the agent cannot test proposal code against the running app (a proposal frame has no slop runtime: "Unhandled rejection … reading 'use'"). For app projects, Main should be the default until proposals live on refs (Phase 6).
- **The prompt must give exact module signatures;** a model guesses the rest.
- **Token use:** slop's meter showed 987,621 tokens used by `admin@example.com` on the local server, about 20k tokens of prompt per agent round.

### Future

- **Geppetto:** encode assistant history without an item id as string content (PR to go-go-golems/geppetto, then bump slop).
- **The lunaroute model store:** `deepseek-4.1-flash` as `openai-completions` (the user's Pi config), or a per-model API override in slop's `pi` config.
- **Default to Main mode for app projects;** auto-continue when a reply announces a step without calling the tool.
- **Codex round 8 on #47** (overlapping evals on one app) is still to do.

### Technical details

```yaml
# <scratch>/llm-deepseek.yaml
listen: 127.0.0.1:18490
data: <scratch>/lslop/data
llm: pi
pi:
  models: {quick: lunaroute/deepseek-4.1-flash, default: lunaroute/deepseek-4.1-flash, complex: lunaroute/deepseek-4.1-flash}
  agent_dir: <scratch>/pi-agent-chat
```
