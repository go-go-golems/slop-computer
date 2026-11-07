---
Title: Diary
Ticket: SLOP3-016
Status: active
Topics:
    - apps
    - collaboration
    - architecture
    - frontend
    - backend
    - agents
    - security
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-07T11:40:53.714007489-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

The working record of SLOP3-016: turning the Pinboard prototype into a collaborative slop app, and the platform machinery that needs.

## Context

The prototype and its design document were downloaded by the user to `~/Downloads/Pinboard.zip` and `~/Downloads/Pinboard · API examples and wireframes.{md,html}` on 2026-11-07. Copies are in `sources/`.

## Step 1: Study the prototype and slop, and write the intern guide

This step reads the Pinboard prototype in full, its design document's 14 examples, and the slop pieces it would need. The prior art inside slop is Pinup and Blocks, the CLI's verb machinery and the runtime. The result is the intern guide `design-doc/01-…`: what exists, what is missing, a proposed architecture with five decision records, flows in pseudocode, seven phases and a test strategy. Nothing is implemented.

### Prompt Context
**User prompt (verbatim):** "Study the pinboard zip and md I downloaded in ~/Downloads (the last 2 files). How would I transform this into its slop.computer app so that multiple people can collaborate no a board / create multiple boards and share them / I can access it through a CLI (with js verbs maybe? mounted in the slop CLI) and my device login? THis might need new machinery both on the frontend and the backend, so consider that too. Create a new docmgr ticket for the analysis and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. The goal is to build kind of an interactive shareable computational pinboard / are.na thing, where multiple users can collaborate and build apps and such."
**Assistant interpretation:** An analysis and design guide only (no implementation), for making Pinboard a multi-user slop app with sharing and CLI access, including new platform machinery, uploaded to the reMarkable.
**Inferred user intent:** A plan precise enough that an intern can build it phase by phase.
**Commit (code):** none (documents only)

### What I did
- Extracted `Pinboard.zip` into a fresh scratch directory (untrusted input, nothing executed) and read all seven modules (`js/store.js` 225 lines, `dsl.js` 298, `render.js` 199, `board.js` 661, `apps.js` 313, `agent.js` 200, `main.js` 54).
- The downloaded `.md` turned out to be only the HTML document's table of contents. The examples are in the HTML's `<script type="text/x-src">` blocks; I extracted all 14 with Python's `re` and `html.unescape` to `sources/pinboard-api-examples-code.txt`.
- Read slop's pieces:
  - `doc/claude-apis/README.md` (Blocks and Pinup);
  - Pinup's `09-collab.js`, `14-log.js` and `02-store.js`;
  - `scripts/deploy-apps.sh` (the `createApp` mounts);
  - `pkg/doors/pages/live.go:443-460` (store creation; the creator is the owner);
  - `cmd/slop/cmds/root.go:49-64` (CLI commands from the verb table);
  - `extra.go` (`eval`, `call`);
  - `pkg/doors/actors/sample.go` (no tools in actors);
  - `web/runtime/src/sample.ts:70-71` (page tools, at most 16);
  - `limits.ts`, `db.ts`;
  - `pkg/apps/manifest.go:45` (the platform list);
  - `slop verbs` and the help of `store new`, `link new`, `docs set`, `docs query`, `import files`, `call`, `eval`.
- Created the ticket in a new worktree from `origin/main` (`8e01dca`), branch `task/slop3-016-pinboard`. Copied the prototype and the examples into `sources/`, and wrote the guide (about 7,700 words).

### Why
- **The guide copies Pinup's shape** (store per document, document per object, shared revertible log, presence): it is the slop app closest to Pinboard and already runs within slop's limits.
- **App commands are designed as a general platform feature, not a Pinboard binary:** the CLI's auth, output formats and the MCP door then serve every app.

### What worked
- The prototype is cleanly layered. Only `write()` and `PB.S` tie the mutation recorder to IndexedDB (`js/store.js:83-86, 93-170`), which is what makes the isomorphic core of guide §6.11 feasible.
- The page agent maps directly onto slop's page `sample` with tools; no platform change is needed for it.

### What didn't work
- `slop $c --help` in a loop failed with `unknown command "store new"`, because zsh does not split words in a quoted variable. `${=c}` fixed it.
- The first text extraction of the HTML found no example code: it was in `<script type="text/x-src">` elements, which the HTML-to-text pass skipped.

### What I learned
- **The design document is ahead of the code:** IR dependency edges, `ui.ref`, tiled layouts, paste handlers and strict state checks exist in the examples only (guide §4.6).
- **No existing machinery covers three needs:** listing a person's stores from a page, sharing from a page (`links.new` and `grants.rm` are not in the platform module), and app-defined CLI commands.

### What was tricky to build
- **Apps written by other collaborators:** the prototype evaluates app source with the whole `PB` in scope. On a shared board that code runs as each viewer. The guide makes it a decision record: admin-written versions, a per-viewer trust prompt, a narrowed scope first, and iframe isolation later.

### What warrants a second pair of eyes
- Decision 6.8 (the trust model) and 6.12 (app commands): both change the platform's surface.
- Whether viewers should run apps at all (guide §10, question 7).

### What should be done in the future
- Phase 0 of the plan: the prototype as a single-person board on slop.

### Code review instructions
- Read the guide's sections 3 and 6 first, then compare its claims with the referenced lines in `sources/pinboard-prototype/js/` and in slop.

### Technical details
```
prototype: 2,221 lines (index.html 61, style.css 210, js 1,950); 14 examples; 6 wireframe sheets
slop refs: live.go:443-460 createApp · root.go:49-64 CLI · actors/sample.go:42-106 · runtime sample.ts:70-71 · manifest.go:45 platform
```

## Step 2: How share links and board creation actually work; guide corrected

The user asked how link sharing works, and said each person should be able to make several boards and share links to them separately. Reading the code showed two mistakes in step 1's guide:

- **Sharing already exists.** The live shell has a Share dialog for store owners, so §6.10 overstated the new machinery for sharing.
- **Creation generates ids.** A `createApp` mount creates a store with a generated id, so a URL is not a board's name, which §6.2 and §7.1 had assumed.

The guide was corrected in place: §3.2, the §5 gap table (R2 and R3), §6.1, §6.2 with a new §6.2.1 on many boards per person, §6.9, a rewritten §6.10, §7.1, and the M8 row and phase 4 in §8.

### Prompt Context
**User prompt (verbatim):** "how does the link sharing work, and each user shoudl be able to create multiple boards and shake links separately." then "iI guess update the current design guide"
**Assistant interpretation:** Explain share links from the code, make sure the design covers many boards per person with separate links, and update the guide.
**Inferred user intent:** Confidence that sharing and multiple boards work as expected before building.
**Commit (code):** none (documents only)

### What I did
- Read the link code:
  - `pkg/registry/links.go`: `CreateLink` stores a hash of a `k_` token, only for the levels view and interact. `RedeemLink` writes a grant `via=<link id>` and never lowers a level. `RevokeLink` deletes the grants with that `via`. `Links` counts uses.
  - `pkg/commands/access.go:115-160`: `link.new/ls/rm`, action `StoreOwner`.
  - `pkg/doors/pages/sitelinks.go`: `/_site/links`, revoke, redeem, guest claim.
  - `pkg/doors/pages/live.go`: routes `:210-213`; view opening with a link `:285-305`; `managed` requires owner `:487-501`.
  - `pkg/doors/pages/assets/shell.js`: `k` taken out of the address bar `:27-35`; the Share dialog `:150-198`.
- Read board creation:
  - `live.go:425-466`: `POST /_site/create {path}` → `CreateStore(Type, App)` with no id.
  - `pkg/kernel/kernel.go:152-157`: id `ids.Slug("s-", 8)`, owner the creator.
  - `shell.js:60-66, 96`: "Create a new one", then `location.assign(body.path)`.
  - `pkg/registry/stores.go:12`: the id pattern.
- Edited the guide in the sections named above. `docmgr doctor` passes.

### Why
- **Separate links per board follow from "a board is a store":** grants and links are per store. The guide now says so with a worked table.

### What worked
- The shell's Share dialog covers the owner's needs: everyone signed in or guests at a level, the people with access, links with a level (30 days), and revoking.

### What didn't work
- My first guide claimed that visiting `/pb/kitchen` creates a store `kitchen`. The code generates the id instead. Corrected.

### What I learned
- **A link is a way to obtain a grant,** not a standing key. After someone opens it, their grant (`via` the link) is what lets them in, and revoking the link deletes those grants at once.
- **Only owners see the Share dialog;** board admins who are not owners cannot share without a change to `managed`.

### What was tricky to build
- Choosing the home page's path: `/pb` next to the mount `/pb/:id` would depend on mount precedence for every board URL. `/boards` avoids the question.

### What warrants a second pair of eyes
- Whether board admins (not only owners) should share: M8 in the guide.

### What should be done in the future
- Re-upload the corrected guide (done as a new document, see below).

### Code review instructions
- Compare guide §6.10 with `pkg/registry/links.go` and `shell.js:150-198`; and §6.2 and §7.1 with `live.go:425-466` and `kernel.go:152-157`.

### Technical details
```
link:   links(id lnk_…, store, level view|interact, token_hash, created_by, expires_at, revoked_at)
redeem: grants(store, subject, level, via=lnk_…)   revoke: DELETE grants WHERE store=? AND via=?
create: POST /_site/create {path} → store s-xxxxxxxx (owner = creator) → 201 {store, path}
```

## Step 3: App CLI verbs with go-go-goja's jsverbs

The user asked whether the guide had considered go-go-goja's jsverbs pattern for CLI verbs. It had not: section 6.12 proposed a JSON `commands.json` mapping command names to actor actions. After reading jsverbs, I rewrote 6.12 around it. App verbs are plain JavaScript functions with `__verb__` metadata in the app's tree. The CLI scans them, builds Glazed commands, and runs them with a `slop` module scoped to one board. A server-side invoker serves MCP. The JSON design is recorded as superseded.

### Prompt Context
**User prompt (verbatim):** "look at using the go-go-goja jsverbs pattern to register CLI verbs for apps in the codebase or so, or is that what you considered??" then "continue"
**Assistant interpretation:** Evaluate jsverbs for app CLI verbs and revise the design if it fits.
**Inferred user intent:** Reuse the existing go-go-golems verb machinery instead of inventing a new format.
**Commit (code):** none (documents only)

### What I did
- Read go-go-goja at `e9bc789`:
  - `pkg/doc/08-jsverbs-example-overview.md` and `10-…developer-guide.md`;
  - `examples/jsverbs/basic/basics.js` and `packaged.js`;
  - `pkg/jsverbs/model.go`: `ScanOptions` `:76-83`, `SourceFile`, `Registry`, `FieldSpec`, `VerbSpec`;
  - `command.go`: `VerbInvoker` `:22`, `CommandsWithInvoker` `:49`;
  - `runtime.go`: `InvokeInRuntime` `:48`;
  - `scan.go`: `ScanFS` `:86`, `ScanSources` `:158`;
  - `pkg/jsverbscli/command.go`: `NewLazyCommand`, `InvokerFactory`;
  - `pkg/jsverbscli/runtime.go:24-70`;
  - `pkg/jsverbrepos/bootstrap.go`.
- Compared dependencies. slop's `go.mod` has `github.com/dop251/goja v0.0.0-20261103151521-97b96e1e55f5` and glazed v1.4.3 as an indirect dependency, and no go-go-goja. go-go-goja requires the same goja revision, glazed v1.3.5 and tree-sitter v0.25.0.
- Rewrote guide §6.12. Updated:
  - the executive summary;
  - the R5 gap row and the overview diagram;
  - the manifest (`slop.verbs`);
  - M6, flow 7.4, phase 5 (5a local and 5b server and MCP);
  - the tests and risk 8 (the new dependency);
  - the API rows (`app.verbs`, `app.verb`, the `slop` module, MCP tool names);
  - the references (go-go-goja files).
- Fixed my first example's `__package__("clip", {…})`: the real form is `__package__({name, short, …})`.

### Why
- **jsverbs keeps a verb and its metadata in one place,** and already gives flags, help, Glazed output and pluggable invokers. The JSON design needed a parallel schema and a server round trip even for help.
- **A store-scoped module is what makes local execution safe enough:** the CLI's token can call any verb the person may call, and the module narrows that to one board.

### What worked
- jsverbs' `VerbInvoker` and `jsverbscli.NewLazyCommand` match the two needs exactly: commands discovered at run time, and execution either local (the CLI) or remote (the server, for MCP).

### What didn't work
- Nothing failed. One limit found: jsverbs makes every public top-level function a command. Helper files such as `lib/core.js` would then expose commands, so the guide asks for an upstream "only functions with `__verb__`" option and gives a workaround meanwhile.

### What I learned
- slop deliberately avoided importing go-go-goja for actor modules (SLOP3-012 §17). Using jsverbs would be its first go-go-goja import. The goja revisions already match.

### What was tricky to build
- **Where the verbs run.** Locally (no server code, the person's token, but MCP cannot use it) or on the server (MCP works, more server code). The answer is both behind one `slop` module contract, so a verb behaves the same either way.

### What warrants a second pair of eyes
- The `slop` module's surface (§6.12, API table): it becomes an API that app verbs depend on.
- The binary-size and build cost of go-go-goja and tree-sitter in the slop CLI (risk 8).

### What should be done in the future
- Upstream in go-go-goja: a scan option to take only functions with `__verb__` metadata.

### Code review instructions
- Read guide §6.12 next to `go-go-goja/pkg/jsverbs/command.go`, `runtime.go` and `pkg/jsverbscli/command.go`.

### Technical details
```
declaration: verbs/**/*.js in the app tree; app.json "slop": {"verbs": {"alias": "pb", "include": [...]}}
discovery:   app.verbs {store} → {app, snapshot, alias, files}
CLI:         slop app <board> … | slop pb <board> … → jsverbs.ScanSources → CommandsWithInvoker(local)
MCP:         pb_<group>_<verb> {store, …} → app.verb (server invoker)
```

## Step 4: Design for migrating the actor VM to a go-go-goja engine runtime

The user asked whether moving the actor VM to a go-go-goja runtime would be hard, then asked for a second design document for it. I also answered a side question on making tree-sitter optional in go-go-goja; the findings are in the conversation and in design-doc 02 §7 (U4).

The result is `design-doc/02-design-migrating-the-actor-vm-to-a-go-go-goja-engine-runtime.md`. It covers:
- the two runtimes;
- a table of the twelve points where they differ;
- six decisions: the turn as one `Owner.Call`, async settlement as a continuation turn, no timers, slop's `require`, slop's globals, and empty engine runtimes;
- the host interface with a flag;
- the upstream changes U1–U4;
- seven phases and a parity test plan.

### Prompt Context
**User prompt (verbatim):** "would updating the actor VM to be a go-go-goja runtime be hard?" then "can tree-sitter be made optional in go-go-goja (see ~/code/wesen/go-go-golems/go-go-goja)" then "Ok, create a second design doc to migrate the actor VM to go-go-goja runtime."
**Assistant interpretation:** Assess the migration, then write it up as a design in the same ticket.
**Inferred user intent:** Decide whether to adopt go-go-goja's runtime in slop, with jsverbs inside actors as the motivating use.
**Commit (code):** none (documents only)

### What I did
- **slop's actor:**
  - `pkg/actor/actor.go`: limits `:32-34`, `Actor` `:110-153`, `build` `:170-233`, `requirer` `:281-334`, `loop` `:354-394`, `handle` `:396-494`, `rootOr` `:496-507`, `continueWith` `:509-516`, `io` `:518-541`, `crashed` `:543-557`;
  - `modules.go:27-129`, `catalog.go:1-80`, `registry.go`;
  - the outlines of `database.go`, `memfs.go` and `express.go`.
- **go-go-goja at `e9bc789`:**
  - `pkg/engine/factory.go` (`NewRuntime` `:184-292`: loop start `:209-212`, `runtimebridge.Store` `:232`, require registry `:238`, globals `:260-270`, initializers `:274-290`);
  - `runtime.go:20-47`, `options.go:59-90`, `module_middleware.go`, `module_specs.go:164`, `performance.go`;
  - `pkg/runtimeowner/runner.go:90-230`, `pkg/runtimebridge/runtimebridge.go`, `modules/express/express.go:69-87`;
  - `pkg/jsverbs/runtime.go:48-70`.
- **For the tree-sitter question:**
  - listed every tree-sitter importer (12 files; only `pkg/jsverbs/scan.go` matters as a library);
  - `go list -deps ./pkg/jsverbs` (300 packages, including tree-sitter, the `exec`/`os`/`fs`/`database` modules and `mattn/go-sqlite3`);
  - confirmed jsverbs ignores comments;
  - checked that goja's `parser`/`ast` have the needed node types (`TemplateLiteral`, `ParameterList`, `Binding`, `ObjectLiteral`, `PropertyKeyed`, `CallExpression`, `LexicalDeclaration`).

### Why
- **Keep slop's semantics by construction.** The design keeps slop's inbox, turns, `require` and globals, and uses go-go-goja only as the VM host. Apps then see no change, and the existing actor suites are the parity test.

### What worked
- go-go-goja already has most of the hooks: runtime initializers, options to turn default modules off, and an owner-adapter precedent in express.

### What didn't work
- Nothing failed. Two upstream gaps were found:
  - `NewRuntime` stores its own runtimebridge owner before modules register, so slop cannot substitute one (U1);
  - it always installs console, console timers, `performance`, `Buffer` and `URL` (U2).
- Even go-go-goja's "data-only" default module set includes `timer`, so actors need all defaults off.

### What I learned
- **Settlement is where the runtimes really differ.** In slop the code after an `await` runs in a new transaction; go-go-goja modules settle on the event loop. Everything else is configuration.

### What was tricky to build
- **Decision D2** (an owner whose `Post` becomes a continuation turn) needs the waiting event to be known when a module starts its work, not when it settles. The doc limits phase 4 to synchronous modules until each asynchronous one is reviewed.

### What warrants a second pair of eyes
- **D1:** the store transaction is opened on the actor goroutine and used from the loop goroutine while the actor goroutine waits. `pkg/store` has no `LockOSThread`, but goroutine assumptions should be checked under `-race`.
- **Is it worth it at all** (risk 6)? U3 alone would give jsverbs on slop's existing VM.

### What should be done in the future
- Phase 1, the host interface, is cheap and useful on its own; decide on the rest after it.

### Code review instructions
- Read design-doc 02 §4 (the difference table) against `actor.go:170-541` and `go-go-goja/pkg/engine/factory.go:184-292`.

### Technical details
```
turn:   actor goroutine ─store.Do→ host.Run(Owner.Call) ─loop goroutine→ handler JS (interrupt armed)
settle: module Post → turnOwner → continueWith(ev) → inbox → new turn
engine: WithImplicitDefaultRegistryModules(false), WithDataOnlyDefaultRegistryModules(false), U1 owner, U2 no globals, slop initializer
```

## Step 5: Implementation starts; phase 0, the prototype on slop

The user asked to implement the ticket. I split the work three ways:
- **go-go-goja upstream** (U1–U4 and a verbs-only scan option): a background agent with its own worktree (`scratchpad/gogoja-up`, branch `task/host-runtime-options`) and its own diary in a go-go-goja ticket.
- **Actor VM migration phase 1** (the `vmHost` interface): a background agent with its own worktree (`scratchpad/slopvm`, branch `task/slop3-016-actor-host`) and its own diary, `reference/02-diary-actor-vm-migration.md`.
- **The Pinboard app**, phases 0–4: me, in `scratchpad/slop016` on `task/slop3-016-pinboard`. This diary covers that.

Phase 0 puts the prototype on slop for one person per board. The UI files stay the prototype's; `js/store.js` is rewritten so that `PB.S` is filled from and written to the board's `db`.

### Prompt Context
**User prompt (verbatim):** "Ok, do the tickets, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)". Later, mid-turn: "it's ok, you can PR into go-go-goja", "what worktree / dirrectory are you working on?", "use diaries for subagents and such as well, diary format according to skill is mandatory".
**Assistant interpretation:** Implement SLOP3-016's tasks (Pinboard phases 0–6, actor VM migration phases 0–6), in parallel where independent, with every agent keeping a diary in the mandatory format.
**Inferred user intent:** Get the collaborative Pinboard and the runtime work built, reviewable as PRs, with a record of how.
**Commit (code):** `4a29c45` (prototype copied unchanged, as a baseline), `d154cd6` (phase 0)

### What I did
- Copied `sources/pinboard-prototype` to `apps/pinboard/` unchanged and committed it alone (`4a29c45`), so the port's diff shows only slop changes.
- `apps/pinboard/app.json`: `type: pinboard`; rules `board` and `apps` written by `admin`; `user` with `profile`, `room`, `assets`, `downloads`, `sample`.
- Rewrote `apps/pinboard/js/store.js`:
  - `PB.connect()` gets `db user assets slop room` with `claude.use`, the person (`user.me()`) and the level (`slop.visitor().level`);
  - `PB.load()` reads `clips`, `apps`, `colls`, `records` and `board/meta` once; this viewer's keys from `data/users/<me>/view`, or browser storage for viewers;
  - writes: `PB.save(store, id, delay)` debounces per document path (40 ms for mutations, 300 ms for typing and app state) and then calls `ref.set`/`ref.delete`; the runtime itself already serialises writes per document (`web/runtime/src/db.ts`, `serial`);
  - `PB.meta`: `title`, `seeded`, `about` go to `board/meta` (admins only); `view`, `minimap`, agent `threads` and modes go to the viewer's document, trimmed below 200 KB;
  - images: `PB.putBlob` uploads with `assets.upload` and returns `blob:<asset id>`; `PB.blobURL` maps that to `/_blob/<id>`; `PB.fetchBlob` fetches bytes when copy or the agent needs them;
  - ids: `PB.id(p)` gives ten base-36 characters from `crypto.getRandomValues`;
  - `PB.seg`/`PB.unseg` escape free-text collection names into db path segments (`~xx` per byte);
  - level checks in the recorder (`interact` for clips and records, `admin` for apps) so a refused write fails before the screen changes.
- `apps.js`: built-in apps are evaluated into memory (`PB.builtins`) instead of being registered into each board.
- `board.js`, `render.js`, `agent.js`: asset references in `resolveSrc`; selected image clips fetched ahead of copy and agent use (`B.cacheBlobs(ids)` on `selection`, event `blobs`); the clip id pattern `clip:[a-z0-9]{5,10}`.
- `main.js`: boot connects, loads, seeds only as an admin, makes the title editable only for admins, and shows `saving…`/`saved`/`view only` in the status line.
- Local server: `go build -buildvcs=false -o scratchpad/pbslop ./cmd/slop`; `pbslop serve --local --llm fake --data scratchpad/localdata --admin-email admin@example.com`; with `SLOP_CREDENTIALS=scratchpad/local-creds.json`: `store new pinboard`, `push apps/pinboard --store pinboard`, `mount set apps.localhost:18300 /pb/:id --storeParam id --type pinboard --createApp pinboard`, `policy set pinboard sample @member on`, `llm set ada@example.com on --budget 2000000`.
- Browser check (Playwright, a separate context): signed in as Ada, opened `/pb/new-ada1`, pressed "Create a new one" → board `s-5povfcfc`, owner Ada, three welcome clips. Added a note, a record in `recipes`, a PNG image and the title "Kitchen", reloaded: all five clips, the record, the collection, the title and the image (`/_blob/a770…`, 64 px wide) came back. Screenshot `various/01-phase0-board-on-slop.png`. The agent ran one step with the fake model in Ask mode after "Run this step".

### Why
- **Keep the prototype's split.** The prototype already separates state (`PB.S`) from persistence (`write`, `PB.save`, `PB.load`). Replacing only those keeps the 200 KB of UI code unchanged, so later phases can be reviewed as store-layer diffs.
- **Built-ins in memory.** Writing seven built-in apps into every board would need an admin on first visit, fill the board's `apps/` and freeze old versions of the code in old boards.
- **Flat `records/<id>`** instead of the guide's `colls/<name>/rows/<id>`: the prototype keeps all records in memory and queries them there, so one subscription for all records is simpler. The guide's per-collection layout only helps when collections are not loaded, which nothing does yet.

### What worked
- The runtime's `db` needed no adapter beyond `set`/`delete`: snapshots are frozen, so `PB.clone` on load is enough.
- `/_blob/<id>` resolves inside the sandbox frame; an `<img>` with that path loads without any extra call.
- The shell already shows Share (owner) and the createApp flow; nothing in the app had to do that.

### What didn't work
- The first agent message answered `token budget used up for this month`: `llm set … --budget 1000` is in tokens and the prompt (reference text plus board description) is larger. `--budget 2000000` worked.
- `globalThis` in Playwright's `browser_run_code_unsafe` does not survive between calls (`TypeError: Cannot read properties of undefined (reading 'pages')`); I find the context again by a page URL each time.
- `PB.agent.send()` in Ask mode waits for the person, so an evaluation that awaits it hangs until the step is approved (the tool call went to the background; stopped it and clicked "Run this step").

### What I learned
- db path segments allow `:` (`letters, digits and _ - . ~ : @ +`, `doc/claude-apis/state-storage.md`), so `clips/clip:k3x…` is valid and ids need no change.
- Asset ids look like `a770510a7c37117824e9b1f94fb16234c` (`ids.New("a", 16)`, `pkg/doors/pages/rtassets.go:64`).
- A guest or viewer cannot write `data/users/<id>/` by default (root write is `interact`), so per-viewer settings for viewers must stay in the browser.

### What was tricky to build
- **Who may write what, before writing.** The recorder changes `PB.S` and the screen at once, and the store refuses later. Checking the level in `m.set` turns a refused write into a thrown error inside the mutation, which the prototype already shows as a toast, instead of a screen that silently diverges from the board.
- **Debounce and order.** The runtime orders writes per document, but a debounced write that has not been sent is invisible to it. `PB.isDirty(path)` exposes that window for phase 1, where remote snapshots must not overwrite a local edit that is still waiting to be sent.

### What warrants a second pair of eyes
- `PB.save` drops writes silently for viewers (z-order, typing). The UI still lets a viewer type into a note and the change stays local. Phase 1 should make editors read-only for viewers.
- `viewDoc()` trims agent threads by dropping the oldest until the JSON is under 200 KB; a single huge thread could still exceed it.

### What should be done in the future
- Phase 1: subscriptions and remote apply, the shared log, collaborative undo, `core.js`.
- Update the guide's data model table for `records/<id>`, built-in apps and `blob:<asset id>`.

### Code review instructions
- Start with `apps/pinboard/js/store.js`, then `git diff 4a29c45 d154cd6 -- apps/pinboard/js/{apps,board,render,agent,main}.js` (small).
- Run: build slop, `serve --local`, deploy as above, open `http://apps.localhost:18300/pb/new-x`, create, add clips, reload.

### Technical details
- Board store created by the shell: `s-5povfcfc` (`POST /_site/create`), app `pinboard`, type `pinboard`.
- Status line format: `<n> clips · <n> collections[ · <n> changes] · saved|saving…[ · view only]`.

## Step 6: Phase 1, live collaboration

Phase 1 makes a board shared in real time. The operations moved into `apps/pinboard/core.js`, a file with no DOM that the actor and CLI verbs will load too. The page store now subscribes to the board's collections, applies other people's changes, writes every transaction to a shared log, and undoes by a rule that keeps other people's work.

### Prompt Context
**User prompt (verbatim):** (same as step 5)
**Assistant interpretation:** Pinboard phase 1 of the guide's plan: core.js with a storage adapter, remote apply, queued writes, shared log, collaborative undo, ids.
**Inferred user intent:** Several people on one board, each seeing the others' changes, without losing work to undo.
**Commit (code):** `2b4472f`

### What I did
- `core.js` (UMD: `window.PinboardCore` in the page, `module.exports` elsewhere):
  - `createCore(storage)` with `mutate`, `recorder`, `revert`, `check`; storage adapter `{get, put, list, level, now, id, z, appDef}`;
  - the recorder from the prototype, plus `need()` so that operations on a missing clip throw instead of crashing;
  - `mutate` puts back what a failing transaction changed and rethrows;
  - `revert(ops, mayOverwrite)` puts a document back only if it still holds what the op wrote, or if `mayOverwrite(op, current)` allows it;
  - `canon`/`same` (sorted keys), `seg`/`unseg` (now with `encodeURIComponent`, no `TextEncoder`, so it runs in goja), `pathOf`/`parsePath`, `keysFor`, `fromClip`, `logEntry`, `describe`, `query`, `newId`.
- `js/store.js` rewritten around the core:
  - `PB.subscribe()`: `onSnapshot` on `clips`, `apps`, `colls`, `records`, `board/meta`, and `log` ordered by `at` descending, limit 200;
  - `applyRemote`: per `docChanges()` entry, skip a path with an unsent local edit (`dirty`), skip when equal to `PB.S`, otherwise update `PB.S`, note `remoteAt[path]`, and emit the render keys (`change` and `remote`); deleted board apps fall back to the built-in of that name;
  - every transaction becomes `log/<tx id>` (`C.logEntry`), with `by` as a name (`Ada Lovelace`, `agent (Ada Lovelace)`) and `uid`;
  - `PB.undo`/`PB.redo` revert my own transaction with `mayOverwrite = nobody else changed this document since the transaction` (`remoteAt <= tx.at`), mark the log entry `undone`, and say how many changes were kept;
  - `PB.revertLogEntry(id)` reverts anyone's step by the strict rule (value still as written), records the revert as a transaction with `revertOf`, and marks the entry `undone`.
- Log app: "Board log", everyone's steps with a revert button per step; board API `log(n)` (tracks the render key `log`) and `revert(id)`.
- `board.js`: a clip being dragged keeps its on-screen place when a remote change re-renders it.
- `test/core.test.js`: nine `node:test` cases (equality, segments, ids, transactions, rollback, revert with and without conflicts, levels, query and describe, log trimming). `node --test apps/pinboard/test/core.test.js`: 9 pass.
- Two-person browser check on the local server: Ada made an interact link in the shell's Share dialog; Bob signed in and opened it (`level: interact`, `k` removed from the address). Results:
  - Bob's new note appeared on Ada's screen; Ada's move of it appeared on Bob's;
  - Ada placed a note, Bob moved it, Ada pressed undo: the note stayed at Bob's position, toast "1 change was not undone: someone changed it since";
  - Ada placed a note and undid it: gone for Bob; redo: back for Bob;
  - Bob reverted Ada's "place" from the log: gone for Ada; the log shows `Bob Builder · revert: place clip:…` and Ada's entry as reverted;
  - Ada typing into Bob's note (`PB.quiet`) showed in Bob's note within 1.5 s.
- Screenshot `various/02-phase1-bob-board-log.png`.

### Why
- **Undo by "nobody else changed it since", not by value.** The guide proposed "undo only if the document still holds the value the op wrote". My own quiet edits (typing in a note I just placed, bringing it to the front) change the value too, and would make every undo of my own work fail. `remoteAt` records only other people's changes, so my own later edits do not block my undo while anyone else's do. Reverting someone else's step from the log uses the strict value rule, because there is no local record of what else happened.
- **Log entries with values.** Reverting a step from another tab or another person needs the before and after values; keeping them in the entry avoids reading history from elsewhere. Entries over 200 KB keep only paths and cannot be reverted by others.

### What worked
- The runtime's pending-write overlay (`hasPendingWrites`) means my own writes come back as equal values and are skipped by the equality check; no echo suppression by id was needed.
- `PB.rerender` already keeps focus and caret for elements with `data-key`, so a remote re-render of a note being read does not lose the caret.

### What didn't work
- The first two-person run: Ada's undo of her own just-placed note did nothing for Bob (`bobAfterUndo2: true`). Cause: equality was `JSON.stringify(a) === JSON.stringify(b)`, and documents come back from the server with their keys sorted, so Ada's own echo looked like someone else's change: `remoteAt` was set and the undo was treated as a conflict. Fixed with `canon()` (sorted keys) in `core.same`.
- `slop link new <board> interact` as the server admin: `permission_denied: link.new on s-5povfcfc needs owner … admins are admin on every store`. Only the owner makes links; I used the shell's Share dialog as Ada instead, which is the real flow anyway.
- `node --test test/` with a directory argument ran nothing useful under Node 24 (`test at test:1:1 … 'test failed'`); naming the file works.

### What I learned
- Server documents have sorted keys; anything comparing documents must be order-independent.
- The shell's Share dialog shows "Share Pinboard" (the app's title), not the board's title. Worth a small M8 change.

### What was tricky to build
- **Which changes count as someone else's.** A snapshot can carry my own pending write (overlay), my own confirmed write, or another person's write. The page cannot tell them apart by metadata reliably (a confirmed own write has `hasPendingWrites: false`). Comparing with `PB.S` (canonically) separates "nothing new" from "new"; only new values set `remoteAt`.
- **Redo order.** `core.revert` walks ops backwards. Redo needs the original order, so it passes the inverted ops reversed.

### What warrants a second pair of eyes
- `applyRemote` skips a document while it is dirty and never re-applies the skipped value. If my debounced write then fails (refused), `PB.S` keeps my value while the server has the other person's. A failed write should re-read the document.
- The log subscription loads the newest 200 entries for every viewer; on a busy board that is a lot of data per page load. Pruning (phase 6) bounds the total; a smaller page size for the log app could follow.

### What should be done in the future
- Phase 2: presence (cursors, selection, follow, live drag), `c.local`.
- Re-read a document after a failed write.

### Code review instructions
- `apps/pinboard/core.js` (the shared semantics), then `apps/pinboard/js/store.js` sections "loading and others' changes" and "transactions".
- `node --test apps/pinboard/test/core.test.js`.
- Two people: deploy as in step 5, share with the shell's dialog, open in two browser profiles.

### Technical details
- Log document: `{id, by, uid, at, label, ops: [{store, id, before, after, label}], undone, revertOf?, trimmed?, undoneBy?, undoneAt?}`.
- Render keys: `clips`, `clips:<id>`, `records`, `records:<id>`, `coll:<name>`, `apps`, `apps:<name>`, `collections`, `log`.

## Step 7: Phase 2, presence and per-viewer state

Phase 2 shows who else is on a board and what they are doing, and separates per-viewer UI state from shared state. Images were already assets since phase 0.

### Prompt Context
**User prompt (verbatim):** (same as step 5)
**Assistant interpretation:** Pinboard phase 2: presence, cursors, follow; `c.local`.
**Inferred user intent:** Working together on a board should feel live: see others' cursors and selections, follow someone, and not fight over search boxes.
**Commit (code):** `02737bc`

### What I did
- `js/presence.js`:
  - presence object `{cursor, sel, view, drag}`, patched and flushed every 66 ms at most;
  - cursors drawn in a layer inside the transformed canvas, scaled by `1/zoom` to keep their size;
  - others' selections drawn as a `box-shadow` outline in their colour (survives `renderClip`, which resets `className` but not that style);
  - others' drags move their clips on my screen with a short transition; when the drag ends the clip is re-rendered from `PB.S` (the drop's db write follows);
  - names from `user.profiles(ids)` (cached), colour from the profile or a hash of the id;
  - `#people` strip in the header; clicking a person follows their `view`; wheel or a click on the empty canvas stops following.
- `board.js`: `applyView` emits `view`; a clip drag emits `drag` with world deltas while moving and `null` on release; `B.dragIds()`; notes are `contentEditable=false` below `interact`.
- `c.local`: `ctx.local` (tracked as `local:<id>:<key>`), `ctx.setLocal`, `PB.local`/`PB.setLocal` in the store, `.local()` in the grammar (common to all builders), `keyGet`/`keySet` honour it. The built-in Collections, Moodboard and Reading apps keep `q`, `sel`, `tag` and `caption` there (36 replacements in their sources); the reference text explains shared versus local state.
- `store.js`: `reread(path)` after a failed write, so `PB.S` shows what the board holds.
- A wrapper `scratchpad/lslop` that always targets the local server (see "What didn't work").
- Two-person check (Ada, Bob): Bob saw Ada's cursor at the right world position with her name, her selection outlined in her colour, her drag in progress (`left: 880px` for `x: 760, dx: 120`) and the clip back at 760 after the drag ended; Bob followed Ada to `{x: -300, y: -120, z: 0.75}`; Ada's moodboard search `red` stayed in `PB.local` on Ada's tab (`state: {}` shared, Bob's input empty). Screenshot `various/03-phase2-bob-follows-ada.png`.

### Why
- **Drags through presence, drops through the db.** A drag produces dozens of positions a second; writing them would churn the clip document and the log. Presence carries them, the drop writes once (risk 1 in the guide).
- **`c.local` in memory only.** Persisting it would need a write per keystroke into the person's view document; a search box does not need to survive a reload.

### What worked
- `room.onPeers` delivers the full peer list on every change; drawing from the full list is simple and fast at board scale.

### What didn't work
- A push ran with the default login instead of the local one because `SLOP_CREDENTIALS` was set in an earlier shell, not this one: `Error: not_found: no store pinboard` came from the production server. Nothing was changed there (the store does not exist in production). Since then every local command goes through `scratchpad/lslop`, which sets the credentials and `--server http://slop.localhost:18300` itself.

### What I learned
- The runtime applies one's own presence locally at once and sends a patch; `null` deletes a key (`room.ts`), which is how `cursor` and `drag` are cleared.

### What was tricky to build
- **Outlines that survive re-rendering.** Windows are re-rendered on most changes and `renderClip` rewrites `className`. A style property that `renderClip` never touches (`box-shadow`) keeps the outline, and `draw()` runs again after every `change`/`mutation` to catch new windows.

### What warrants a second pair of eyes
- Presence is visible to everyone admitted to the board, guests included; it carries clip ids and coordinates, nothing else.
- Built-in apps now behave differently for search and selection (local). An app written by someone else keeps using `c.state` unless its author switches.

### What should be done in the future
- Phase 3: apps by others, trust prompt, narrowed scope.

### Code review instructions
- `apps/pinboard/js/presence.js`; `git diff 2b4472f 02737bc -- apps/pinboard/js/{board,render,dsl,store}.js`.

### Technical details
- Presence patch example: `{"cursor":{"x":460,"y":308},"sel":["clip:…"],"view":{"x":-300,"y":-120,"z":0.75},"drag":{"ids":["clip:…"],"dx":120,"dy":40}}`.

## Step 8: Phase 3, apps written by other people

Phase 3 implements the guide's security decision for shared app code: admins register apps, every version records its author and hash, and each person runs someone else's version only after accepting it. Meanwhile the go-go-goja upstream agent finished; I opened its PR (go-go-golems/go-go-goja#107) after the agent's own attempt was blocked, since the user had allowed it, and sent the actor VM agent on to phases 2–4.

### Prompt Context
**User prompt (verbatim):** (same as step 5; "it's ok, you can PR into go-go-goja")
**Assistant interpretation:** Pinboard phase 3: apps as admin-written versions, trust prompt, narrowed scope. Open the upstream PR.
**Inferred user intent:** Building apps together without letting one collaborator silently run code as another.
**Commit (code):** `2728fe5`

### What I did
- `core.js`: `sha256` in plain JavaScript (round constants computed from the primes' cube and square roots), checked against `node:crypto` on six inputs including astral characters and the padding boundaries 55/56; `m.register` replaces the record whole.
- `store.js`: the storage adapter hides built-in apps from the core (`isBuiltin`), so a registration over a built-in name records `before: null` and its undo deletes the board document and shows the shipped app again; `PB.saveVersion`, `PB.versions(name)`; `PB.trust` (`data/users/<me>/trust` with `{apps: {name: sha256}}`, browser storage below `interact`), loaded at boot.
- `apps.js`:
  - `registerSource` evaluates the source narrowed, computes `version` (previous + 1), `sha256`, `by`, `uid`, `at`, writes the record and `apps/<name>/versions/<n>`;
  - `trusted(a)`: the built-in object itself (identity, not a `builtin` field a document could claim), the author's own `uid`, or a trust record for that `sha256`;
  - `def(name)` returns an `untrusted` stub (not cached) instead of evaluating; `view` shows the prompt with "Run it" and "View source";
  - `evalSource(src, {narrow})` passes `PB` as `undefined`; `render.js` gives narrowed apps no `agent()` and `apps.narrow` (`open`, `list`);
  - remote changes to `apps:<name>` drop the cached definition; `board.js` re-renders that app's windows on `apps:<name>`.
- Tests: 11 `node:test` cases now (added sha256 and whole-record register).
- go-go-goja: wrote a PR body from the agent's report (its body file was missing) and opened go-go-golems/go-go-goja#107 from `wesen:task/host-runtime-options` (`822e67c`).
- Two-person check: Bob's `registerSource` → "Only board admins register apps."; Ada's "Greeter" ran at once for her and printed `PB is undefined`; versions `1 Ada Lovelace 3b669e00dfb7`; Bob's window showed "Greeter v1 was written by Ada Lovelace, just now. … Run it only if you trust Ada Lovelace."; after "Run it" the app ran and `trust` held `greeter`; Ada's v2 brought the prompt back for Bob. Screenshot `various/04-phase3-trust-prompt.png`.

### Why
- **Identity, not a flag, for built-ins.** A `builtin` field in a board document could be written by any admin through the CLI; comparing with the in-memory object shipped with the code cannot be forged from the board.
- **Whole-record register.** The prototype merged the new definition into the old record. With trust tied to fields of the record, a merge could carry a field (such as `builtin`) from an old record into a new version.

### What worked
- Hiding built-ins from the storage adapter fixed undo and registration over built-in names with one function.

### What didn't work
- The upstream agent's PR body file (`scratchpad/gogoja-pr.md`) did not exist when I looked; I wrote a new body from its report.

### What I learned
- A `new Function` parameter named `PB` shadows the global for `typeof PB` and plain `PB.x`, but `window.PB` stays reachable: the narrowed scope is a guard, as the guide says, not isolation.

### What was tricky to build
- **When the stub is not cached.** The untrusted stub must not be cached, or accepting would not take effect until reload; the trusted definition must be cached, or every render would re-evaluate source. `trust()` deletes the cache entry and emits `apps:<name>`.

### What warrants a second pair of eyes
- An app registered by a board admin can still read `window.PB`, `claude.use('sample')` and the page's db as the viewer once trusted. The prompt says so; phase 6's iframe isolation is the real fix.
- Versions are written as separate documents with a 40 ms debounce; if that write fails the record exists without its version document.

### What should be done in the future
- Restore an earlier version from `apps/<name>/versions` (the data is there; no UI yet).
- Phase 4: actor actions over the core, "my boards", sharing.

### Code review instructions
- `git show 2728fe5 -- apps/pinboard/js/apps.js apps/pinboard/js/store.js`, then `core.js` (`sha256`, `register`).
- `node --test apps/pinboard/test/core.test.js`.

### Technical details
- App record: `{name, source, icon, title, about, shortcut, hidden, order, version, by, uid, at, sha256}`; version document: `{source, by, uid, at, sha256, note}`; trust document: `{apps: {<name>: <sha256>}}`.

## Step 9: Phase 4, actor actions, "my boards", board names

Phase 4 gives callers without a page (the CLI, MCP, other apps) the board's vocabulary through actor actions over the same core, adds the platform call that lets a page list a person's boards (M5), and the `/boards` home page.

### Prompt Context
**User prompt (verbatim):** (same as step 5)
**Assistant interpretation:** Pinboard phase 4: actor actions over the core; "my boards" (`slop.stores` runtime call); sharing through the shell's dialog.
**Inferred user intent:** Many boards per person, each found again and shared separately, and the board reachable from outside the page.
**Commit (code):** `f6fc10a`

### What I did
- `apps/pinboard/actor.js`: `require('./core.js')` with a storage adapter over the actor's `db` (one turn, so one transaction); actions `describe`, `clips` (kind, tag, q), `addClip` (text, url or an asset id; placed below everything if no position), `removeClip`, `tagClip`, `collections`, `query` (where, orderBy, desc, limit), `insert`, `update`, `log`. Mutating actions require `interact` and write a log entry with `by: "<name> (<via>)"`.
- `pkg/doors/pages/storesrpc.go`: the view RPC `slop.stores {type, title?}`: `K.VisibleStores` (owned, granted, audience), narrowed to the type, newest first, at most 200; each row `{id, app, level, mine, createdAt, title?}`; the title is the `title` field of the document at `title`, read with `K.Open` and the store's rules as the viewer (`storeTitle`). Registered in `rpcTable` with `authz.DocRead`.
- `web/runtime/src/caps.ts`: `slop.stores.list({type, title})`; `pnpm build` regenerated `pkg/doors/pages/assets/claude.js`.
- `apps/pinboard-home`: the `/boards` page (yours, shared with you, search, New board → `/pb/new-<random>`), linking with `target="_top"` to the live host taken from the frame's `parent` parameter.
- `main.js`: a new board is titled "Untitled board" and the title is selected for typing.
- `pkg/host/pinboard_test.go` (`TestPinboardApp`): Ada creates two boards through `/_site/create`; Bob `interact` and Carol `view` on one; rules (Bob cannot write `apps/evil`, `apps/evil/versions/1` or `board/meta`; Carol cannot write clips; Bob cannot read Ada's trust document); actor actions per level (Carol refused `addClip` and `insert`; `query` with a `where`; `describe`; `clips` by tag; `log` with `bob (cli)`); `slop.stores` for Ada (`Work notes:owner:mine,Kitchen:owner:mine`), Bob (`Kitchen:interact:shared`), Dave (none), and a missing type refused.
- Validation: `go test -buildvcs=false ./...` all pass; `GOFLAGS=-buildvcs=false golangci-lint run` 0 issues; `pnpm build` ok (`pnpm check` fails on `test/vectors.test.ts` missing `node:fs` types, unrelated and unchanged).
- Browser check on the local server (rebuilt and restarted): `/boards` for Ada listed "Work notes" and "Kitchen", for Bob "Kitchen · can edit" under shared; New board → Create → the title selected → typed "Moodboard" + Enter → listed as the newest. Screenshot `various/05-phase4-boards-home-ada.png`. From the CLI (`lslop call s-5povfcfc …`): `describe`, `addClip` with `via: cli`, `query`, `log`.

### Why
- **Actions instead of raw documents for the CLI.** The CLI's verbs (phase 5) can call `describe` once instead of reading every document over HTTP, and the server applies the same validation and log as the page.
- **A runtime call, not an index document** (the guide's decision for M5): it is computed from grants the server already has, so sharing from the CLI or by link shows up without the app keeping anything in sync.
- **Title by document path.** The platform should not know Pinboard's layout; `title: "board/meta"` names the document, and the read goes through the store's rules as the viewer, so a title hidden from someone stays hidden.

### What worked
- `/_site/create` and the shell's "Create a new one" needed nothing new; the home page only links to an unused id.
- The test harness's `openView`/`rpc` reached the new RPC with no harness change.

### What didn't work
- First version of the RPC returned nothing, in the browser and in the test. Debug output showed `ok=false level=owner trace=[… owner of s-4jlxsv5j]`: `Access.Level` computes the level but leaves `Decision.OK` false, which only a check against a needed level sets. The filter now compares `d.Level` only, as `store.ls` does.
- My first log assertion expected the newest entry to be the CLI's; the newest was an `insert`. Rewrote it to look for `"by":"bob (cli)"` in the four entries.

### What I learned
- `pkg/access` `Decision`: `Level()` fills `Level` and `Trace`; `OK` belongs to `Check`.
- The live shell's iframe has no `sandbox` attribute, so a page link with `target="_top"` navigates the top window on a click.

### What was tricky to build
- **Whose rules apply to the title.** Reading `board/meta` from many stores in one call could leak if read with the platform's rights. Each read opens the store as the viewer (`K.Open(..., LevelView, ...)`) and filters by `rules.CanRead(path, id, level)`, like `slop.read`.

### What warrants a second pair of eyes
- `slop.stores` opens up to 200 stores per call to read titles. For a person with many boards that is many store opens per page load; a cache or a title in the registry row (`store.meta`) would be cheaper.
- `VisibleStores` includes stores open to an audience the person is in. A board shared with `@member view` appears under "Shared with you" for every member.
- M8 is not done: the Share dialog is owner-only, says "Share Pinboard" (the app's title, not the board's), cannot invite a named person and has a fixed 30-day link. These are the guide's optional items; they need the user's decision on whether board admins should share.

### What should be done in the future
- Phase 5: app verbs in the CLI (jsverbs) and MCP tools.
- The Share dialog's title (board title) and the M8 options, if wanted.

### Code review instructions
- `pkg/doors/pages/storesrpc.go`, `apps/pinboard/actor.js`, `pkg/host/pinboard_test.go`.
- `go test -buildvcs=false ./pkg/host -run TestPinboardApp`.

### Technical details
- RPC: `{"method":"slop.stores","args":{"type":"pinboard","title":"board/meta"}}` → `{"stores":[{"id":"s-…","app":"pinboard","level":"owner","mine":true,"createdAt":…,"title":"Kitchen"}]}`.
- Actor log `by` for an action: `ctx.visitor.name || email || id` + ` (via)`, `via` from the arguments (default `actor`).

## Step 10: Phase 5a, app verbs in the CLI (`slop on`, `slop pb`)

Phase 5a lets an app ship command-line verbs, as JavaScript files in its own tree, and lets the slop CLI run them on one store. Pinboard ships `clip`, `coll` and `board` verbs. `slop pb Kitchen clip add --url …` now reaches the board's actor as the person running it.

### Prompt Context
**User prompt (verbatim):** (same as step 5); during this step: "it's ok, you can PR into go-go-goja"
**Assistant interpretation:** Pinboard phase 5: app verbs in the CLI, built on go-go-goja's jsverbs (the upstream changes U1–U4 are PR go-go-goja#107), with the board as the scope. The remote invoker and MCP tools come in a later step (5b).
**Inferred user intent:** The same board vocabulary from a terminal or a script as in the page, without hand-written RPC calls, and without a CLI release for each app change.
**Commit (code):** `c8ec9c7`

### What I did
- **Manifest** (`pkg/apps/manifest.go`): `slop.verbs {alias, include, title}`.
  - `alias` matches `^[a-z][a-z0-9-]{0,15}$`.
  - `include` holds 1–16 relative doublestar patterns, with no `..` and no leading `/`.
  - `title` must be a document path.
  - Tests are in `pkg/apps/verbs_test.go`.
- **`app.verbs {store, have?}`** (`pkg/commands/appverbs.go`):
  - Opens the store at `view` and finds the app it runs (`K.Running`).
  - Reads that app's snapshot files (`SnapshotFiles`/`ReadFile`) that match `include`, with at most 200 files and 2 MB.
  - Returns `{store, type, app, snapshot, alias, title, include, files:[{path, source}]}`.
  - If `have` equals `<app>@<snapshot>`, it returns `unchanged: true` with no files.
  - It reads as the platform, so a person who can view a board gets the verbs even when the app's own store is hidden from them.
- **`pkg/appverbs`**:
  - `Fetch`: `app.verbs` plus a cache keyed by `app@snapshot` under `<UserConfigDir>/slop/verbs/<host>/`.
  - `Scan`: jsverbs `ScanSources`.
  - `Execute`: builds the cobra chain `slop <name> <store>` and adds the glazed commands with `glazedcli.AddCommandsToRootCommand`.
  - `Invoker`: a fresh goja runtime per call, with a goja_nodejs `require` registry and `WithLoader(reg.RequireLoader())`, so verb files can `require('./lib.js')` among themselves. It registers the native `slop` module, sends the console to stderr and calls `InvokeInVM`.
  - The `slop` module's `board(x?)` returns the store the command runs on, by id or title. Naming another store throws "this command runs on … only".
  - The board object has `id`, `title`, `type`, `app`, `call(action, args)` (`actor.call`), `me()`, `meta()`, and `docs.get/query/set/update/rm`.
  - Errors keep the server's `code`, and `json.Number` becomes a JS number.
- **CLI** (`cmd/slop/cmds/appverbs.go`):
  - `slop on <store> …` is always present.
  - `slop <alias> <id|title> …` is added for each alias the CLI has seen (`aliases.json`), unless it shadows a built-in command.
  - Flag parsing is off, because the verbs have their own flags, so `--server` is stripped by hand.
  - A title is resolved over `store.ls`, narrowed to the alias's type, matching the `title` field of the app's title document. An ambiguous title lists the ids.
- **Pinboard verbs** (`apps/pinboard/verbs/`):
  - `clip.js`: `add`, `ls`, `rm`, `tag`.
  - `coll.js`: `ls`; `query <coll> --where field<op>value` (with `~` for contains); `insert <coll> --set k=v`.
  - `board.js`: `describe` (text) and `log`.
  - Every mutation goes through an actor action with `via: "cli"`, so the board log says `bob (cli)`.
- **Tests:**
  - `pkg/appverbs/appverbs_test.go`, against a fake `Caller`:
    - Scan finds all nine verbs.
    - `clip add` sends `addClip` with the tags and `via`.
    - `--where` conditions are parsed into `[field, op, value]`.
    - Rows come back with numbers as numbers.
    - A `permission_denied` reaches the person.
    - The `slop` module refuses another store, and `require('fs')` fails.
    - `Fetch` caches and sends `have`.
  - `pkg/host/pinboard_verbs_test.go` (`TestPinboardVerbs`), against a real server through the host harness:
    - Carol (view) gets the verbs while `files.ls` on the app store is `not_found` for her.
    - `have` gives `unchanged`.
    - Dave gets `not_found`.
    - Bob runs `clip add` and `coll insert`.
    - Carol runs `coll query`, `board describe` and `board log`, and her `clip add` is refused.
- **Validation:**
  - `GOFLAGS=-buildvcs=false go test ./...` passes.
  - `golangci-lint run` reports 0 issues.
  - `GOFLAGS=-buildvcs=false go list -deps ./cmd/slop | grep -c tree-sitter` gives 0.
  - On the local server through the `lslop` wrapper, these worked:
    - `lslop on s-5povfcfc clip ls`;
    - `lslop pb Kitchen board describe`;
    - `lslop pb Kitchen clip add --text …` appeared on the open board at once;
    - `lslop pb Kitchen clip rm --help` reads `slop pb Kitchen clip rm <id>`.

### Why
- **Verbs come from the app's snapshot, not from the CLI.** A new verb ships with an app update, and the CLI only caches it per snapshot. That is the guide's decision ("apps as code" all the way to the terminal).
- **They run locally, with a store-scoped module.** The JavaScript runs in the person's CLI, but every effect is an RPC as that person. The verbs therefore have no rights the person lacks, and a verb written by the app's author cannot reach other stores: `board()` is the only door, and it opens one store.
- **The commands are `slop on`, not `slop app`:** `slop app` is already the app-management group (publish, ls, …).
- **No board argument in each verb.** The board is the command's second word, so verbs take only their own arguments. The guide had `clip add <board> …`.
- **Explicit `parents`.** jsverbs derives default parents from the file's directory, which would make every command `verbs clip add`. Each `__verb__` therefore says `parents: ["clip"]`.

### What worked
- go-go-goja#107's `RequireLoader` and `InvokeInVM` were enough to run verbs in a runtime slop builds itself, with only its own native module. No engine factory and no default modules (fs, exec, …) are linked into the CLI.
- The host harness's client satisfied `Caller` through a three-line adapter, so the host test runs the same `appverbs.Execute` as the CLI.

### What didn't work
- `go get github.com/go-go-golems/go-go-goja@822e67c` failed with "unknown revision": the commit exists only as the PR head. I replaced the module with the wesen fork at the same commit (`v0.0.4-0.20261107193645-822e67c611a8`), which the module proxy serves.
- My first command name was `slop app <store>`, which collided with the existing `slop app` group. Renamed to `slop on`.
- `titleOf` read `data.title`, but `docs.get` returns the document under `body`, so title lookup found nothing.
- Glazed writes rows to `os.Stdout`, not to cobra's writer, so the first tests saw empty output. Tests now capture `os.Stdout` with a pipe. Glazed's output flag is `--format`, not `-o`.
- Title lookup by the local admin found no board: `store.ls` lists only owned and granted stores, and the admin had neither on Ada's board. That behaviour is correct, so the try-out gave the admin a grant.
- I first expected Carol's `files.ls` on the hidden app store to be `permission_denied`. It is `not_found`: the store is invisible to her, not merely forbidden.

### What I learned
- jsverbs builds glazed `cmds.Command`s whose run calls a `VerbInvoker`. The invoker owns the runtime, so the host decides the runtime's modules.
- goja_nodejs `require.WithLoader` composes with jsverbs' loader. Relative requires between verb files resolve inside the scanned sources and never touch the disk.
- `json.Number` from the client's decoder must be converted before reaching goja. Otherwise rows print numbers as strings.

### What was tricky to build
- **Who may see the verbs.** The app's store is usually private to the author, but every viewer of a board needs its verbs. `app.verbs` therefore authorizes on the board (`view`) and reads only the files `include` names from the running snapshot. It never lists the app store. The host test checks both sides: Carol gets the verbs, and her own `files.ls` on the app store is still `not_found`.
- **Flags before the store.** With cobra flag parsing off, `slop pb --server X Kitchen clip ls` has to strip `--server` by hand before the store is resolved. The verbs' own flags then reach glazed unchanged.
- **Aliases before the server is known.** Commands are added before flags are parsed, so aliases are read from every cached server's `aliases.json`. An alias seen on one server appears for all of them, and resolving it still goes to the server given.

### What warrants a second pair of eyes
- **Binary size:**
  - `cmd/slop` grows from 59,784,224 to 73,293,120 bytes (+22.6%).
  - The release build (`-trimpath -s -w`) grows from 42,326,392 to 51,803,480 bytes (+9.5 MB).
  - goja and grpc were already linked. The growth is glazed's CLI glue: `glazed/pkg/cli` → `pkg/cmds/sources` → `hashicorp/vault/api`, and `formatters/table` → `jedib0t/go-pretty` → `go-openapi/strfmt` → `mongo-driver/bson`; plus sprig and jsverbs.
  - A glazed-free runner (flags from the verb specs, JSON or text output) would avoid most of it, at the cost of glazed's output formats.
- **The go-go-goja replace** must be removed once #107 is merged and tagged. The actor VM branch (`task/slop3-016-actor-host`) requires a different pseudo-version (`v0.10.8-…`) of the same commit, so whichever merges second has to reconcile go.mod.
- **Verbs run on the person's machine**, as code written by the app's author. They have only the `slop` module (no fs, exec or network), but a verb can still loop or print misleading output. Trust in the CLI is "I trust this board's app"; there is no sha256 consent prompt as in the page (phase 3).
- **The alias cache is shared across servers** (see above).

### What should be done in the future
- Phase 5b: `app.verb` on the server (verbs run without a CLI, for MCP and agents) and MCP tools named `<alias>_<group>_<verb>`.
- Swap the go-go-goja replace for the tag after #107.
- Decide on the binary size (keep glazed, or write a slim runner).

### Code review instructions
- Start with `pkg/appverbs/appverbs.go` (`Execute`, `Invoker`, `Module`, `boardObject`), then `pkg/commands/appverbs.go` and `cmd/slop/cmds/appverbs.go`.
- Run `GOFLAGS=-buildvcs=false go test ./pkg/appverbs ./pkg/apps` and then `GOFLAGS=-buildvcs=false go test ./pkg/host -run TestPinboardVerbs`.
- To try it on a local server: run `slop pb <board title> --help`, then `slop pb <title> board describe`.

### Technical details
- Cache layout:
  - `<UserConfigDir>/slop/verbs/<host>/aliases.json` contains `{"pb":{"app":"pinboard","type":"pinboard","title":"board/meta"}}`;
  - `apps/<app>@<snapshot>.json` holds the files;
  - `stores/<store>` holds the last key.
- `app.verbs` request: `{"store":"s-…","have":"pinboard@3"}`. Response when cached: `{"store":"s-…","app":"pinboard","snapshot":3,"unchanged":true,"files":[]}`.
- A verb's call to the actor: `actor.call {"store":"s-1","action":"addClip","args":{"tags":["a","b"],"url":"…","via":"cli"}}`.
- Limits: 200 files and 2 MB per `app.verbs`.

## Step 11: Phase 5b, app verbs on the server and as MCP tools

Phase 5b runs an app's verbs on the server (`app.verb`), for callers that cannot run JavaScript themselves, and lists them as MCP tools named `<alias>_<group>_<verb>`. On the way it closes a file-reading hole that also existed in phase 5a's CLI.

### Prompt Context
**User prompt (verbatim):** (same as step 5)
**Assistant interpretation:** Guide §6.12 "Running a verb: two invokers, one module" (the remote invoker) and "MCP" (tools per app with a `store` argument).
**Inferred user intent:** An agent connected over MCP can work on a board with the board's own vocabulary, as the person whose token it holds.
**Commit (code):** `f4499a3`

### What I did
- **`pkg/appverbs/remote.go`:**
  - `Values(reg, verb, map)`:
    - finds each field's section in the verb's glazed description (`CommandDescriptionForVerb`);
    - converts JSON values to the field's type: float64 to int when integral, `[]any` to `[]string`/`[]int`/`[]float64`, choices checked;
    - applies `sources.FromMap` and `sources.FromDefaults`;
    - checks required fields.
  - `InputSchema(reg, verb, extra, required…)`: JSON Schema built from the fields (types, `enum`, `default`, `description`, `additionalProperties: false`).
  - `Run(ctx, reg, path, values, caller, board, logs, limit)`: the remote invoker. It is the same `Invoker` as the CLI's, with a timeout. The result goes through JSON. A missing verb is `not_found`; bad values are `invalid_argument`.
  - `Cache`: registries per `app@snapshot`, at most n, oldest out first. `ToolName`.
  - `plainTypes` and `checkTypes`, called from `Scan`.
- **`pkg/appverbs/appverbs.go`:**
  - `Board.Via`, exposed to verbs as `board().via`.
  - The invoker interrupts the VM when ctx ends (`context.AfterFunc`).
  - `jsError` also understands `*verbs.Error`.
  - `unwrap` keeps an escaped error's `code` (as `*verbs.Error`), so a nested refusal reaches the MCP client as `permission_denied`, not as an internal error.
- **`pkg/commands/appverbs.go`:**
  - `app.verbs` now shares `verbSources`/`verbFiles` with the new verbs.
  - **`app.verb {store, verb, values, alias?}`**: Read scope, write effect, StoreRead at view.
    - Builds the board, with its title read as the caller.
    - Runs with a `tableCaller`: each module call is `Table.Call` as the caller (`Via` kept: `mcp`, `http`, `cli`), and the result is decoded with `UseNumber` as the CLI client decodes it.
    - Output is capped at 64 KB of logs; the timeout is 30 s (`AppVerbTimeout`).
  - **`app.tools`** (Account action):
    - looks at up to 200 visible stores, keeping only those where the caller has view or more;
    - takes each app with an alias, at the newest snapshot any of those stores runs;
    - skips aliases that equal a verb group (`store`, `docs`, …);
    - lists one tool per verb.
  - `appVerbsEnv{kernelEnv, Table, Cache}` in `env.go`; `commands.go` builds it with `appverbs.NewCache(64)`.
- **MCP door (`pkg/doors/mcp/mcp.go`):**
  - tools/list appends the app tools, except names a verb tool already has.
  - tools/call of a name that isn't a verb tool looks it up among the caller's app tools and calls `app.verb` with the listed verb path and alias. An unknown name is still JSON-RPC `-32602 no tool …`.
- **Pinboard verbs:** `via: b.via || "cli"`.
- **Tests:**
  - `pkg/appverbs/remote_test.go`:
    - value conversion and defaults;
    - `via`;
    - five refusals with their codes;
    - codes kept from `verbs.Error` and `client.APIError`;
    - an endless verb interrupted at 100 ms with its console output kept;
    - six file-reading field types refused at scan;
    - the input schema;
    - the cache bound.
  - `pkg/host` `TestPinboardVerbsRemote`:
    - Bob adds and inserts through `app.verb`; Carol queries and describes (the text output);
    - refusals (`permission_denied`, `invalid_argument` ×2, `not_found` ×2);
    - `app.tools` lists 9 tools for Carol and none for Dave;
    - MCP: `pb_clip_add` is listed with `"required":["store"]`; Bob's call succeeds; Carol's comes back as a tool error with `permission_denied`;
    - the log says `bob (mcp)`.
- **Validation:**
  - `go test ./...` passes and golangci-lint reports 0 issues.
  - On the local server (rebuilt, restarted, app pushed), the official MCP Python SDK run (`scripts/05-mcp-app-verbs-check.py`, `uvx --with mcp --with httpx`) listed the nine `pb_*` tools. `pb_clip_add` (`store` required) added a note, `pb_board_describe` showed it, `pb_clip_ls --tag mcp` found 1 row, a bad field came back as a tool error, and the log said `(mcp)`.
  - `lslop app verb s-5povfcfc "board log" --values '{"limit":2}'` showed `Ada Admin (mcp)` and `Ada Admin (cli)`.

### Why
- **The same invoker on both sides.** Only the `Caller` changes: HTTP with the token in the CLI, `Table.Call` as the principal on the server. A verb therefore behaves the same from a terminal and from an agent, and every nested call passes the same scope and level checks as a direct call.
- **Tools per app, not per store** (guide §10 risk 3). A person with 50 boards gets 9 Pinboard tools, not 450.
- **tools/call only routes names it lists.** The first version split any unknown name at its first `_`, so `no_such_tool` became `app.verb` with alias `no` and returned "which store?". `TestMCPDoor` caught that. Looking the name up among the listed tools also uses the exact verb path rather than guessing words from `_`.
- **Plain types only.** See "What was tricky to build".

### What worked
- `sources.FromMap` and `FromDefaults` produce the same `values.Values` the cobra parser does, so jsverbs' `buildArguments` didn't need to know the values came from JSON.
- `TestMCPDoor`, which predates this work, caught the routing regression at once.

### What didn't work
- `TestInputSchema` assumed `coll query`'s `limit` default was 50; it is 100 (`clip ls`'s is 50).
- The first MCP SDK script used camelCase attributes (`init.serverInfo`). This SDK version uses snake_case (`server_info`, `structured_content`, `is_error`, `input_schema`).
- `lslop pb Kitchen clip ls --fields id,kind` gave `unknown flag: --fields`. Glazed's column flags are `--filter`/`--select`; I used `--format json` instead.
- My first sed for `via: b.via` turned three one-line verbs into `require("slop").board().call(… b.via …)` with no `b` in scope. I caught it before running, and rewrote them as `const b = …; return b.call(…)`.

### What I learned
- Glazed reads files while parsing for `stringFromFile`, `objectFromFile`, the `…FromFiles` types, `file`/`fileList`, and `keyValue` when the value starts with `@` (`fields.Type.NeedsFileContent`, `parse.go:289`).
- jsverbs' description of a verb has only the verb's own sections, with no glazed output section, and field names are kebab-cased (`order-by`).
- `Table.Call` from inside a verb's `Run` is the established pattern (`eval` does it). The nested call carries the principal, so its scope, admin and store checks all apply.

### What was tricky to build
- **The file-reading types.** A verb field declared `{type: "stringFromFile", default: "/home/me/.ssh/id_ed25519"}` would make the CLI's parser read that file when the person runs the verb. The verb's JavaScript could then write the contents to the board through `docs.set`. On the server, an MCP caller could name a server path. `Scan` now refuses any field outside `plainTypes`, so both invokers are covered and the test uses that exact default. Phase 5a had the hole for the CLI.
- **Codes through JavaScript.** A nested refusal becomes a JS Error with `.code` (`jsError`). If the verb lets it escape, `unwrap` rebuilds a `verbs.Error` from `.code`/`.message`; otherwise the HTTP status and the MCP error text would say `internal`.

### What warrants a second pair of eyes
- **tools/list and tools/call each run `app.tools`.** That means `VisibleStores` plus `Running` for up to 200 stores, with the scan cached per snapshot, on every MCP list or call. Fine for tens of stores. For many, a per-principal cache or a cheaper "which apps" query is needed. `Running` can also activate a store as a side effect, as other listing paths already do.
- **A verb runs synchronously on the server for up to 30 s, with no memory bound** (goja has none). An app admin could ship a verb that allocates without limit. Verbs are admin-installed code (D9), as actors are, but actors run under a turn limit in their own goroutine. Consider a lower limit, or a concurrency cap per principal.
- **The verb's title lookup** (`docs.get` of `board/meta` as the caller) adds one call per `app.verb`.
- **`app.tools` picks the newest snapshot any visible store runs.** A store on an older snapshot may have fewer or different verbs; `app.verb` then answers `not_found` for a missing one.

### What should be done in the future
- Phase 6: server agent (actor `sample` tools), log pruning, iframe isolation.
- Cache `app.tools` per principal for a short time if MCP listing gets slow.

### Code review instructions
- `pkg/appverbs/remote.go` (`plainTypes`, `Values`, `coerce`, `Run`).
- `pkg/commands/appverbs.go` (`runVerb`, `tools`, `tableCaller`).
- `pkg/doors/mcp/mcp.go` (`appTools`, the tools/call branch).
- Run `go test -buildvcs=false ./pkg/appverbs ./pkg/host -run 'Pinboard|MCP|Run|Values|Input|Cache|File'`.
- MCP by hand: `uvx --with mcp --with httpx python -I scripts/05-mcp-app-verbs-check.py http://slop.localhost:18300/mcp <creds.json> <store>`.

### Technical details
- `app.verb` request: `{"store":"kitchen","verb":"coll query","values":{"coll":"recipes","where":["minutes<30"],"limit":10}}`. Response: `{"result":[…rows…],"output":"glaze","logs":[…]}`. Text verbs return `"output":"text"` and a string result.
- MCP: `tools/call {"name":"pb_clip_add","arguments":{"store":"kitchen","url":"…"}}` becomes `app.verb {"store":"kitchen","verb":"clip add","alias":"pb","values":{"url":"…"}}`.
- Allowed field types: `string`, `bool`, `int`, `float`, `stringList`, `intList`, `floatList`, `choice`, `choiceList`, `date`.

## Step 14: Review fixes from go-go-goja#107, and why the plain-VM path stays

The Codex review of go-go-golems/go-go-goja#107 found three problems. Two of them come from `InvokeInVM`, the plain-VM invoke that every app verb runs through (#37). I fixed all three upstream, pinned the fixed fork here, and closed the same kind of hole in slop's own error unwrapping.

### Prompt Context
**User prompt (verbatim):** "what's the plain VM path in go-go-goja? (read design docs / diaries if necessary) do we need it? or was it optional and we did too much? (See code review comments and how they are because of the plain one)", then "ok, address the issues".
**Assistant interpretation:** Explain U3 and whether slop needs it, then fix the review findings in #107 and wherever they reach slop.
**Inferred user intent:** Keep only what is needed, and make sure nothing that the plain path skips (the owner's recovery and its call context) leaves a hole in slop.
**Commit (code):** `0e07f78` (slop); go-go-goja `3992113`, `363f343`, diary `0d995b4` (GOJA-069 step 6).

### What I did
- **Answered the question:**
  - U3 (`Registry.InvokeInVM`) was optional for the actor migration (doc 02 §7) and is not used by #38.
  - It is what #37's app verbs run on, in the CLI and in `app.verb`/MCP (`pkg/appverbs/appverbs.go`, `Invoker`). Each call uses a fresh `goja.New()` with a goja_nodejs `require` whose only native module is `slop`.
  - The alternative is `InvokeInRuntime` on an engine runtime with its defaults switched off. It would cost an event-loop goroutine per call, owner scheduling and 5 ms promise polling, and its safety would hang on remembering the opt-outs: the engine's default builder enables every module, `fs` and `exec` included.
- **Probes, as throwaway tests not committed:**
  - What a verb's `require` can load: `fs`, `exec`, `os`, `database` and `child_process` fail with "Invalid module", and `node:fs` with "No such built-in module". goja_nodejs's own `url`, `util`, `buffer` and `console` load.
  - What a getter in a verb's result does: one that throws, sync or async, and one that loops until the timeout all panicked out of `appverbs.Run` (`*goja.Exception`, `*goja.InterruptedError`).
- **Upstream (GOJA-069 step 6):**
  - `InvokeInVM` recovers JavaScript panics and makes `ctx` the runtimebridge call context on bound VMs.
  - The default parser reads a file as the CommonJS function body, so a top-level `return` is legal.
  - I replied on the three review threads.
- **Here:**
  - `go.mod` now replaces go-go-goja with `github.com/wesen/go-go-goja v0.0.4-0.20261107231049-0d995b4b7706`.
  - `unwrap` runs `unwrapException` under a recover. A thrown value whose `code`, `message` or `toString` throws or loops becomes "the verb threw a value that cannot be read".
  - `TestRunRecoversVerbPanics`, six cases.

### Why
- **`app.verb` runs on the request goroutine.** No door dispatches verbs to goroutines of their own, so a panic there is caught only by net/http's recovery. The client then gets a dropped connection instead of an error. In the CLI the panic kills `slop`.
- **The thrown-value cases are slop's own.** After the go-go-goja bump the getter cases passed, but the thrown-value cases still panicked inside `unwrap`, which reads properties of the thrown object after `InvokeInVM` has returned. That made a slop-side recover necessary, not merely redundant.

### What worked
- On go-go-goja 0d995b4 with the new `unwrap`, `TestRunRecoversVerbPanics` passes.
- `go test ./pkg/appverbs/... ./pkg/commands/...`: ok.
- `go test ./pkg/host -run 'Pinboard|Verb|MCP|App'`: ok. That includes scanning Pinboard's verbs with the wrapped parser.

### What didn't work
- `go build ./...` in this worktree fails with "error obtaining VCS status: exit status 128". It is environmental (worktree under the scratchpad), and `GOFLAGS=-buildvcs=false` works around it.

### What I learned
- goja runs getters and `toString` with the VM's own machinery even when Go calls `Export`, `Get` or `String`. Outside a JavaScript frame, their throw is a Go panic. Inside a native function called from JavaScript, goja turns the same panic back into a JavaScript throw.

### What was tricky to build
- Telling which panics the upstream fix covers. The probe test had to be rerun after the bump, and that is what showed slop's own `unwrap` as a second site.

### What warrants a second pair of eyes
- `unwrap`'s recover is narrow: it covers only reading the thrown value. Anything else in the `Invoker` that runs verb code from Go (none today) would need the same care.

### What should be done in the future
- After #107 is merged and tagged, replace the fork with the tag on #37, #38 and #39.

### Code review instructions
- `git show 0e07f78 -- pkg/appverbs`.
- `go test ./pkg/appverbs -run TestRunRecoversVerbPanics -v`.

### Technical details
- **Correction to step 10.** "No engine factory and no default modules (fs, exec, …) are linked into the CLI" is wrong. `pkg/jsverbs` imports `pkg/engine` (for `InvokeInRuntime`), so `go list -deps ./pkg/jsverbs` includes go-go-goja's `modules/fs`, `exec`, `database` and the rest. They are linked, but they are not reachable from a verb, as the probe above shows: slop's VM uses its own require registry, and those modules register only in go-go-goja's.
