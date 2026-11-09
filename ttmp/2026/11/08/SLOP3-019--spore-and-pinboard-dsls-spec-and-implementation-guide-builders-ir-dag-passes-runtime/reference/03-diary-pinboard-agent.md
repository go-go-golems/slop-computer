---
Title: 'Diary: Pinboard agent'
Ticket: SLOP3-019
Status: active
Topics:
    - apps
    - architecture
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "The Pinboard sub-agent's diary for SLOP3-019: reading apps/pinboard's DSL, running it in Node to verify the IR and runtime, and drafting various/drafts/pinboard.md."
LastUpdated: 2026-11-08T23:59:00-05:00
WhatFor: "How the Pinboard half of the spec was researched and verified, with the failures on the way."
WhenToUse: "When merging or reviewing various/drafts/pinboard.md, or when re-running its experiments."
---

# Diary: Pinboard agent

## Step 1: Orientation — reading the grammar, finding the guide, running the tests

I read Pinboard's DSL and everything it touches, located the design guide whose chapters the lead listed, and ran the existing JavaScript tests. Reading this way settled the main question early: the IR is built only for inspection. Its `deps` are always empty, and the "DAG" is a per-window set of dependency keys collected at render time.

The guide is not in `apps/pinboard`. It is the SLOP3-016 source document `sources/pinboard-api-examples-and-wireframes.html`, and its example code is extracted in `sources/pinboard-api-examples-code.txt`. It has 14 chapters (00–13), not the 13 the lead listed: chapter 13 is "everything at once: a moodboard".

### Prompt Context
**User prompt (verbatim, opening):** "You are drafting one half of a detailed spec and implementation guide, in Markdown, for a JavaScript DSL in the slop-computer repo. Your half is **Pinboard's DSL** (its builders, IR, DAG and runtime). Another agent drafts Spore (a different DSL) in parallel; I (the lead) will merge both drafts into one document, so write yours to stand on its own." The request goes on to name the files, the draft path `various/drafts/pinboard.md`, this diary's path and its mandatory format, the experiments to run, and the limits: read-only, no commits, no network.
**Assistant interpretation:** Write a cited, verified spec and implementation guide for `apps/pinboard`'s grammar, plus this diary. Run the DSL where possible.
**Inferred user intent:** One merged SLOP3-019 document that an intern can implement against, with bugs and guide/code mismatches made explicit.
**Commit (code):** none (read-only task); worktree at `f5bc6b2`.

### What I did
- Read in full, from the worktree `…/scratchpad/slop019`:
  - `apps/pinboard/js/dsl.js`, `render.js`, `apps.js`, `store.js`, `steps.js`, `frame.js`, `frames.js`, `agent.js`, `main.js`, `presence.js`;
  - `apps/pinboard/core.js`, `actor.js`, `app.json`, `index.html`;
  - the relevant parts of `js/board.js` (fragments 1-35, windows 68-150, side panel 151-194, drop targets 242-306, menus 504-590, board API and describe 592-665, invalidation 670-696).
- Located the guide with `grep -rln "pin and tile\|Pin and tile\|pin-and-tile" --exclude-dir=node_modules --exclude-dir=.git .`. Read its `.md` and the extracted code (`.txt`), and the pipeline section of the HTML (`:728-765`).
- Diffed the prototype against today's code: `diff sources/pinboard-prototype/js/dsl.js apps/pinboard/js/dsl.js` shows only `.local()` and the `app()` builder moving in. `render.js` gained read-time defaults, `c.local` and the narrow context.
- Read the SLOP3-016 intern guide (§3.1, §4.3-4.6, §6.7-6.8, §13) and the SLOP3-017 design doc (findings table, F6, F7, as built).
- Ran the JS tests: `for f in core steps render frames; do node --test $R/apps/pinboard/test/$f.test.js …; done`.

### Why
- The renderer, the store and the frame determine what the IR and the "DAG" actually mean, so `dsl.js` alone would not do.
- The prototype diff shows which parts of the grammar are original and which came with the slop port.

### What worked
- Test results: core 13 pass, steps 17 pass, render 2 pass, frames 2 pass (`ℹ tests 13 ℹ pass 13 ℹ fail 0`, and so on).
- `grep -n "\._b\b\|\.path\b\|\.build()\|\.describe()\|\.nodes\b\|\.node(" js/*.js` showed that nothing outside `dsl.js` consumes the IR except the editor's *Describe IR* button (`apps.js:220`).

### What didn't work
- `grep -rn "deps\|PB.track\|\.edges" apps/pinboard --include=*.js` failed with `(eval):1: no matches found: --include=*.js`: zsh expands the glob. I used plain `grep -n … js/*.js` from the app directory instead.
- `D=ttmp/2026/11/07/SLOP3-016*/sources; ls -la $D …` failed with `ls: cannot access 'ttmp/2026/11/07/SLOP3-016*/sources': No such file or directory`, because the glob is not expanded in an assignment. `D=$(echo ttmp/2026/11/07/SLOP3-016*)/sources` worked. The same mistake with `G=$(echo …)/design-doc/01*.md` gave `wc: '…/design-doc/01*.md': No such file or directory`; fixed with `for G in …/design-doc/01-*.md`.
- `grep -rn … --include=Makefile --include=*.yml …` failed with `(eval):1: no matches found: --include=*.yml` (zsh again).
- The first summary loop printed nothing. My pattern `^# (tests|pass|fail)` does not match Node 24's `ℹ tests 13` lines; `^ℹ (tests|pass|fail) ` does.

### What I learned
- `buildIR` sets `deps: []` and never fills it (`dsl.js:215`), and `edges` is a getter over those empty arrays (`dsl.js:222`). The SLOP3-016 guide already called the guide's DAG a wish (`…/design-doc/01-…md:123, 184`).
- Invalidation is per window (`board.js:680-694`): a fresh dependency Set per render (`render.js:14`), matched against change keys.
- Some tracked keys (`param:*`, `clip:*`) have no emitter anywhere: I grepped `emit('change'` and `keysFor`.
- JS tests must be run one file at a time (SLOP3-016 diary `:410`).

### What was tricky to build
- Telling the IR apart from the render path. Both start from the same builders. The proof that render never builds an IR is that `PB.render` switches on `b.kind` and reads `b.props` directly (`render.js:89-185`), and that `apps.view` passes `def.view` (a builder) to it (`apps.js:129-131`).

### What warrants a second pair of eyes
- None yet at this step (see Step 3).

### What should be done in the future
- The guide's chapter list in the request ends at 12; the merged document should include chapter 13.

### Code review instructions
- Start with `apps/pinboard/js/dsl.js:149-160` (mk), `:210-233` (IR), `apps/pinboard/js/render.js:13-54` (context and tracking), and `apps/pinboard/js/board.js:680-694` (invalidation).
- Re-run: `node --test apps/pinboard/test/core.test.js` (and the same for steps, render and frames).

### Technical details
- Guide code: `ttmp/2026/11/07/SLOP3-016--…/sources/pinboard-api-examples-code.txt`. Its "EXAMPLE 14" (`:358-383`) is the guide's highlighter script, not a chapter.

## Step 2: Running the DSL in Node — IR, grammar, queries, runtime, frame

I wrote a small harness that loads the page scripts into a Node `vm` context with a DOM stub, then ran experiments against the real files. The IR schema, YAML, diff, diagnostics, dependency keys, invalidation and the frame protocol are therefore verified by running, not only by reading. No DOM library exists in the repo (no jsdom or happy-dom), so the stub covers only what `render.js` and the context need.

Three experiments first gave misleading results because of mistakes in my test code, not in the product. They are recorded below.

### Prompt Context
**User prompt (verbatim):** see Step 1 (the "Experiments" paragraph: load `js/dsl.js` in node with stubs for `window`/`document`, build a small app, print the IR, its YAML and a diff).
**Assistant interpretation:** Ground every schema and runtime claim in execution where possible, and mark the rest as read.
**Inferred user intent:** No speculative IR schema in the spec.
**Commit (code):** none.

### What I did
- Created `/tmp/claude-1000/-home-manuel-workspaces-2026-10-28-slop-computer-slop-computer/7fa934c5-45f7-43c5-9ffb-d734dcfbe139/scratchpad/agent-pinboard/harness.js`.
  - It loads `core.js`, `js/store.js`, `dsl.js`, `render.js`, `board.js`, `presence.js`, `apps.js`, `steps.js`, `frames.js` and `agent.js`, in `index.html` order and without `main.js`.
  - The context sets `window = self = sandbox` and passes `Blob`, `crypto`, `URL`, `performance`, a fake `localStorage` and a fake `requestAnimationFrame`.
  - A small `El` class implements `append`, `classList`, `dataset`, `addEventListener`, `textContent` and `innerHTML`.
  - Helpers: `html()` serialises a tree, `find()` and `fire()` locate elements and dispatch events, and `J()` prints values from the vm as JSON.
  - An `opts.setup` hook lets a script replace `addEventListener` and `getElementById` (needed for the frame).
- Experiments, each run as `node <script> <checkout>/apps/pinboard > <script>.out`:
  - `exp1-ir.js`: IR keys, nodes, ids, paths, `node()`, `edges`, `toYAML`, `diff`, duplicate ids, shared builders, strict mode, the guide's chapter 06.
  - `exp1b-query-prop.js`: a query as `ui.each`'s source.
  - `exp2-grammar.js`, `exp2b-kids.js`: immutability, diagnostics, fragments, `app()`, children.
  - `exp3-db.js`, `exp3b-record.js`: schema builder, queries, tracking keys, change keys.
  - `exp4-runtime.js`, `exp4b-branch.js`: render a test app installed as a built-in, read `ctx.deps`, click buttons, and replay `B.onChange` with `renderClip`/`renderAll` stubbed to record calls.
  - `exp7-frame.js`: load `steps.js`, `frame.js`, `dsl.js` and `render.js` in the frame document's order, send `init` with a fake port, click buttons, then send `sync` with different `ack`s.
  - `exp9-counter-ir.js`: the counter template's IR, its *Describe IR* YAML and two diffs.

### Why
- The lead asked for a real IR. The counter template (`apps.js:154-171`) is the app every board starts with, so its IR is the natural example.
- Stubbing `renderClip` and `renderAll` tests the invalidation rule itself without a full board DOM. The stubbed calls run before `onChange` reaches `$pins` (`board.js:692`), which is set only by `B.init`, so I catch that `TypeError` after the calls are recorded.

### What worked
- The IR: ids are pre-order and nodes are post-order, `deps` is always `[]`, `edges` is `[]`, and `ir.edges()` throws `TypeError: ir.edges is not a function`. Diffs read `[{"op":"set","at":"/props/gap","from":10,"to":12}]`, and `ir.diff(builder)` throws `stack has no method "root". Did you mean "grow"?` (`exp1-ir.out`).
- B3: `TypeError: v.all is not a function` for `describe()` of `ui.each(db.links.where(…), …)` and of `ui.table(db.x.orderBy(…))`. The lambda form is fine (`exp1b-query-prop.out`).
- Diagnostics reproduced word for word. `colums` suggests `"class"`, not `"cols"`. Fragment hooks are never called. A global fragment cannot override `size` (`exp2-grammar.out`).
- Tracking:
  - `Query.all/get` → `coll:<name>`, `db.collections()` → `collections`;
  - `db.record`, `db.has` and `.schema()` → nothing;
  - outside `withCtx` → nothing;
  - change keys: insert → `records, records:<id>, coll:<name>`; move → `clips, clips:<id>`; `setState` → `state:<id>:<k>`, with no history entry (`exp3-db.out`, `exp3b-record.out`).
- Invalidation replay: a record in an unrelated collection re-renders the window (the `records` rule), and any clip move triggers `renderAll` (`exp4-runtime.out`). The reads in `ui.each` item functions and in `ui.when` branch functions are not tracked (`exp4b-branch.out`).
- Frame: `c.set` sends `{t:'set'}`, an insert sends `mutate seq 1` with a frame-made `rec:` id, and an update function crosses as `{set, unset}`. `board.clip(ui.note(…))` and `board.focus` throw. `m.register` is refused. `ack=1` keeps batch 2, and `ack=99` lets the page's copy win (`exp7-frame.out`).

### What didn't work
- Looking for a DOM library: `ls -d /home/manuel/…/web/*/node_modules/{jsdom,happy-dom,linkedom}` gave `(eval):1: no matches found: …` (none exists). I wrote the stub.
- `exp2-grammar.js`'s children test failed with `kids(): …: THROWS TypeError: Cannot read properties of undefined (reading 'value')`. My test assumed deep flattening. `kids()` flattens one level only (`dsl.js:161`), so a nested array becomes an array child. `exp2b-kids.js` confirmed this, and it became S7 in the draft.
- `exp3-db.js` reported `db.record(id) tracks nothing: ok ["coll:recipes"]`. The key came from my own `db.recipes.first()` inside the tracked function. `exp3b-record.js`, with the id computed outside, shows `[]`.
- `exp7-frame.js`'s first run printed `after sync ack=1 (batches >1 re-applied): ["one!","new"]` and `after sync ack=99 (page copy wins): ["one!","new"]`. The frame adopts the `S` object it is sent (`steps.js:248-249`) and writes into it, and my test had passed its own `S` by reference, then "re-sent" that already-mutated object. Sending `JSON.parse(PRISTINE)` copies fixed it: `["one!"]`, then `["one"]`.

### What I learned
- `strip()` copies any plain object it meets, so a `Query` loses its methods but keeps `_isQuery`, and `toYAML` then trips on it (`dsl.js:226, 33`).
- `onChange` treats the `clips` key as "redraw everything" (`board.js:682`). Every clip mutation carries that key (`core.js:98`), so the fine-grained `clips:<id>` rule rarely matters.
- `render.js` and `dsl.js` really are shared by the frame: the frame experiment loaded them unchanged under `frame.js`'s `PB`.

### What was tricky to build
- vm values have the vm's prototypes, so `assert.deepStrictEqual` against host literals fails. As `test/render.test.js` does, I compared through `JSON.stringify` (`J()`).
- The frame listens for its first `message` on `window`, then switches to the port (`frame.js:137-153`). The harness therefore captures the `message` listener in `setup` and calls it with `{data, ports:[port]}`.

### What warrants a second pair of eyes
- The `records` and `clips` over-invalidation (S2) may be deliberate simplicity rather than a bug. It costs re-renders, not correctness.

### What should be done in the future
- Turn `harness.js` into `apps/pinboard/test/dsl.test.js` and `render.test.js` cases. Nothing tests `dsl.js` or `PB.render` today.

### Code review instructions
- Run any script with `node <scratch>/agent-pinboard/expN-….js <checkout>/apps/pinboard` and compare with the `.out` next to it.

### Technical details
- The counter's raw node list and YAML are in the draft §3.6. The replay table is in the draft §4.4.

## Step 3: Following the findings — editor trust, agent app steps, chaining, schema at evaluation

Reading `apps.js` and `agent.js` turned up three paths where app source or the documented API behaves differently from what the docs promise. I verified each by running. The most serious is that the built-in editor's *Describe IR* evaluates the editor window's **shared** `state.src` in the page realm.

### Prompt Context
**User prompt (verbatim):** see Step 1 ("known gaps, bugs, sharp edges, and mismatches between the guide chapters and the code").
**Assistant interpretation:** Find real bugs and prove them, not just list doubts.
**Inferred user intent:** A gap list the lead can act on.
**Commit (code):** none.

### What I did
- `exp5-editor.js`:
  1. Open the editor and type into its source input; the text lands in `clip.state.src`.
  2. Send a `setState` step through `PinboardSteps.check` as a framed app would, with a source that writes `window.__ran = {PB: typeof window.PB, …}`.
  3. Render the toolbar and fire *Describe IR*.
- `exp6-agent-step.js`: `PB.agent.runCode(code)` for six app steps: plain, with `return`, with `await`, with `log`, with `m(…)`, and an `each` without an id.
- `exp8-mutations.js`:
  - `PB.mutate(m => m.move(id, p).retitle(id, 'new'))` (chaining);
  - `mount` without a context;
  - `board.on`, `board.handle`, `board.layout` and `board.clipDefaults`;
  - a guide-style `promote` mapping.
- `exp10-schema-eval.js`: evaluate a source that starts with `db.collection('moodboard').field(…)` three times, then as a viewer.

### Why
- Trust is the security decision of SLOP3-016 (§6.8) and SLOP3-017 (F1), and the editor is a built-in app, so it runs in the page realm.
- The agent's instructions (`agent.js:10-11`) are what the agent actually follows.

### What worked
- B1: `window.__ran after Describe IR: {"PB":"object","claude":"undefined","rt":["db","user","assets","slop","room","me","visitor","level","online"]}`. `claude` is undefined only because the harness has no `window.claude`; on slop the page has one (`store.js:32`). The framed-app `setState` step on the editor's id was accepted.
- B5:
  - `withAwait: error="await is only valid in async functions and the top level bodies of modules" registered=false`;
  - `withLog: error="log is not defined"`;
  - `withM: error="m is not defined" … clipsAdded=1`: the side effect stayed;
  - `PB.strict during agent steps: undefined`.
- B2: `THROWS TypeError: m.move(...).retitle is not a function`, and the transaction rolled back (`[5,"old"]`).
- B6: one coalesced transaction growing 5 → 9 → 13 ops over three evaluations; as a viewer, `THROWS This board is read-only for you (level view).`
- Guide gaps confirmed: `PB.boardAPI.on`, `.handle`, `.layout` and `.clipDefaults` all throw `… is not a function`; `clip.attr is not a function` in a promote mapping.

### What didn't work
- No failures in this step's scripts. A limit: the harness cannot show B1 against a real `window.claude` or across two browsers. The shared-state part rests on reading (`render.js:86`, `store.js:386-391` save the clip), plus the `setState` step check.

### What I learned
- The narrow mode of `evalSource` only withholds the `PB` *argument*. Code evaluated with `new Function` in the page still reaches `window.PB`, so evaluating someone else's source in the page is never safe, narrow or not.
- `frame.js:45`'s "own window only" applies to `c.set`. The steps table accepts `setState`, `setParam` and `setAttr` for any clip id (`steps.js:80-90`).

### What was tricky to build
- Getting a step through the same check a page applies to a frame's `mutate` message. The script calls `PinboardSteps.check('setState', [id, {src}], page)`, then `PB.mutate(m => m.setState(...args), 'app:other')`, which mirrors `frames.js:232-233`.

### What warrants a second pair of eyes
- B1, which I rate as a security bug. Any `interact` collaborator, or a framed app the viewer trusted, can stage code in a shared editor window. The viewer runs it with page privileges by pressing *Describe IR*. *edit source* also loads an untrusted app's source into the editor. A fix: evaluate in a frame, or describe without evaluating; or make `src` a `.local()` input (it is shared today) and never evaluate source the viewer did not write.
- B2 (the documented `m` chaining) misleads the agent on every multi-op step. Either return `m` from the recorder, or fix the Reference and the instructions.

### What should be done in the future
- File B1–B6 as tasks. Add tests for B2 (chaining), B3 (describe with a query), B4 (`diff(builder)`) and B5 (agent app step with `await`).

### Code review instructions
- B1: `apps/pinboard/js/apps.js:220` and `:35-44`; `apps/pinboard/js/steps.js:90`; `apps/pinboard/js/board.js:168, 555`.
- B2: `apps/pinboard/core.js:130-184` against `apps/pinboard/js/apps.js:381` and `apps/pinboard/js/agent.js:10`.
- B5: `apps/pinboard/js/agent.js:69-79` and `apps/pinboard/js/apps.js:52-53`.
- B6: `apps/pinboard/js/dsl.js:262-274`.
- Re-run `exp5`, `exp6`, `exp8` and `exp10` as in Step 2.

### Technical details
- The full gap table is in the draft §8. The chapter-by-chapter mismatch table is in §9.

## Step 4: Writing the draft

I wrote `various/drafts/pinboard.md`, with each claim cited and marked as run, read or covered by a test. It is self-contained so that the lead can merge it with the Spore half. Code citations use the `apps/pinboard/` prefix implicitly, and `ex:<line>` names the guide's code file.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Tables over prose, short excerpts, every claim cited, verified versus read stated.
**Inferred user intent:** A document an implementer can trust line by line.
**Commit (code):** none (no commits by instruction).

### What I did
- Wrote the draft:
  - §0 conventions;
  - §1 mental model, who writes apps and where they run;
  - §2 the grammar (record, constructors, modifiers, kind methods, lambdas, slots, fragments, `app()`, db, diagnostics);
  - §3 the IR (pass, object and node schemas, strip/YAML, diff, the counter's IR);
  - §4 the dependency graph (keys table, tracking, invalidation replay);
  - §5 the runtime;
  - §6 host integration (manifest, registration and trust, the frame protocol, the agent, the actor, permissions);
  - §7 implementation guide and invariants;
  - §8 gaps and bugs; §9 guide versus code by chapter; §10 references; §11 the experiment index.
- Checked the doubtful citations again: `grep -n "App menus and" …/design-doc/01-*.md` → `:815`; the node `--test` directory note → SLOP3-016 diary `:410`; the steps test cases → `test/steps.test.js:51-106`.
- Dropped `ex:155` from B3's guide examples: that line is a query, not a query in a prop.

### Why
- The lead merges two drafts, so the conventions are stated once at the top, and the frontmatter uses the ticket's vocabulary (`design-doc`, `draft`, `short-term`).

### What worked
- Every IR field, YAML sample, diff op, diagnostic message and invalidation row in the draft comes from a `.out` file.

### What didn't work
- Nothing failed while writing. Not done, by scope: the Go host tests (`GOWORK=off go test ./pkg/host/ -run Pinboard`) were not run, and nothing was checked in a browser.

### What I learned
- The in-app Reference (`apps.js:343-388`) is a better guide to the code than the design guide, but it shares B2 and B3.

### What was tricky to build
- Keeping "the DAG" honest. The lead's outline asks how dependencies are found, ordered and kept acyclic. The accurate answer is a bipartite key → window graph with no ordering and no cycle handling. The draft says so and points at what would be needed for node-level deps (§7.4).

### What warrants a second pair of eyes
- S13: re-entrant render through a state write in a lambda. It is read only, not run, and should be confirmed in a browser.
- S17: the offline trust prompt for one's own app. Read only.

### What should be done in the future
- The lead may copy the scratch experiments into the ticket's `scripts/`. They are outside the repo now, because I was limited to two files in the ticket.

### Code review instructions
- Read the draft's §8 and §9 first, then spot-check citations against `apps/pinboard/js/dsl.js` and `render.js`.

### Technical details
- Draft: `ttmp/2026/11/08/SLOP3-019--…/various/drafts/pinboard.md`.
- Scratch: `/tmp/claude-1000/-home-manuel-workspaces-2026-10-28-slop-computer-slop-computer/7fa934c5-45f7-43c5-9ffb-d734dcfbe139/scratchpad/agent-pinboard/` (`harness.js`, 14 scripts, 14 outputs).
