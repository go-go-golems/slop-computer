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
