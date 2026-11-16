---
Title: "Diary: slop surface for a dev loop"
Ticket: SLOP3-022
Status: active
Topics:
    - architecture
    - apps
    - tools
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "A subagent's record of mapping slop-computer's current surface (stores, refs, push, activation, serving, page runtime, live updates, actors, doors, access, Pinboard) for a Sitebench-style live dev environment, with file:line evidence and the gaps."
LastUpdated: 2026-11-15T20:00:00-05:00
WhatFor: "Evidence trail behind the 'slop surface' section of the SLOP3-022 guide."
WhenToUse: "When checking a claim about what slop already does for a page+actor dev loop, or where a missing piece would go."
---

# Diary: slop surface for a dev loop

## Step 1: Read the docs, then check every claim against the code

### Prompt Context

**User prompt (verbatim):**

> You are helping write an intern-facing analysis/design guide (ticket SLOP3-022): how to turn "Sitebench" (a coding-agent IDE that ran as a Claude artifact: a project of HTML/CSS/JS files + small tables, edited by a person and an agent, shown live in frames on a canvas, with proposals/review, history, scenarios) into a live dev environment for real slop-computer apps, frontend (page) AND backend (actor), with a dev/staging copy that updates live while you work and "instant publish" when happy. Your share: map slop-computer's CURRENT surface that such a tool would build on, precisely, with file:line references. Other agents cover Sitebench itself.
>
> Repository (read-only for you): R=/tmp/claude-1000/-home-manuel-workspaces-2026-10-28-slop-computer-slop-computer/7fa934c5-45f7-43c5-9ffb-d734dcfbe139/scratchpad/slop022 (go-go-golems/slop-computer at origin/main). Start with doc/design/slop-v3.md, doc/building-apps.md, doc/production.md, README.md, AGENT.md, then pkg/ and web/ and apps/. Useful prior tickets in ttmp/: SLOP3-016 (Pinboard: shared boards, apps as code in sandboxed frames, an agent, CLI verbs — the closest precedent; read its design docs), SLOP3-017, SLOP3-019/020. Do NOT contact any server; do not run the server; you may run `go doc`, grep, and read tests.
>
> Answer, with file:line refs for every claim (cite the doc AND the code where they agree; flag where they disagree):
> 1. Core model: what a store is (files tree, snapshots, refs incl. main, documents db, SQL, blobs); what an app is (app.json fields: title, type, page, actor, capabilities, sql migrations...); how a push works (files.push, missing_blobs, files.blobs), what creates a snapshot and how main moves; activation of a new version (sql migrations, actor restart) and what happens on failure (broken, app.status, app.logs).
> 2. Serving: the live host and the static host; mounts (host, path, store, storeParam, type, ref?) and whether a mount or URL can serve a ref/snapshot other than main (preview of a branch/dev ref). The shell: how an app page is put in a sandboxed frame, origins, CSP, the frame protocol between shell and page (SLOP3-017 "frame protocol").
> 3. The page runtime: the full `slop.*` API available to a page (docs/db, sql, rooms/presence, actor calls, sample/LLM, files, stores.list, user, links, etc.), and whether slop provides a `window.claude`-compatible shim for Claude artifacts (apps/upstream "unmodified Claude artifacts"; search for window.claude, claude.use, 'db', 'user'). This matters: Sitebench uses window.claude.use('db') and ('user').
> 4. Live updates: how a page learns that documents/SQL changed (subscriptions/.on/watch/SSE/websocket); whether there is any "files changed / new version activated" event a page or tool could subscribe to (for hot reload); actor restarts on new versions.
> 5. Actors: actor.js / defineActor, actions, ctx (db, sql, now, use(module)), modules/capabilities, turn limits, actor.call from page and CLI, logs; the engine runtime (go-go-goja) and what "bridged modules" exist; anything like an eval door or MCP door (pkg/doors/mcp, "agents — Coding agents and eval doors") — what can an external agent do through MCP today.
> 6. CLI and API for development: `slop` commands relevant to a dev loop (push, pull/export, store new/fork/copy?, ref, snap, mount, grant, link, logs, actor call, verbs/jsverbs), the HTTP API shape (/api calls, tokens/credentials, scopes read/write/admin), and whether a "watch and push" or dev mode exists.
> 7. Access: levels (owner/edit/interact/view), grants, links, @guest/@member/@subscriber, audiences; what a dev copy would need so only the developer sees it while the published app keeps its users.
> 8. Pinboard (SLOP3-016/017): how it runs app code in sandboxed frames, its agent and CLI verbs, its storage model — what can be reused for a dev environment.
> 9. Gaps: list concrete missing features for "edit page+actor in a dev copy, see it live, publish instantly" (e.g. per-ref mounts/preview URLs, ref promotion = publish, file-change events, actor hot reload in a dev store without touching prod data, data copy/fixtures for dev stores, a store fork/clone verb) — for each, say what exists, what is missing, and where in the code it would go.
>
> Output: a detailed structured report (aim for 3500-5500 words), headings matching the questions, small code/JSON excerpts (<= 15 lines) where they clarify, and file:line refs. Be exact about names (verbs, fields, endpoints). Clearly separate "exists today" from "would need".
>
> Diary (mandatory): keep your own diary in the file
>   $R/ttmp/2026/11/15/SLOP3-022--sitebench-on-slop-a-live-dev-environment-for-slop-apps-page-and-actor-with-instant-publish/reference/04-diary-slop-surface-for-a-dev-loop.md
> Use docmgr-style YAML frontmatter (Title, Ticket: SLOP3-022, Status: active, Topics: [architecture, apps, tools], DocType: reference, Intent: long-term, Summary). Body: "# Diary: slop surface for a dev loop" then numbered steps, each with these sections in this order: Prompt Context (your prompt quoted verbatim the first time, then your interpretation and inferred intent), What I did, Why, What worked, What didn't work, What I learned, What was tricky, Second pair of eyes, Future, Code review, Technical details. One or two steps is enough. Do not write anywhere else; do not run git.

**Assistant interpretation:** Produce an evidence-backed inventory of what slop-computer already offers a page+actor dev loop (code first, docs second), separated cleanly into "exists" and "would need", for the guide's author to fold into the SLOP3-022 design doc. Read-only: no server, no git, one diary file.

**Inferred user intent:** The guide must not promise or redesign things slop already has, and must not rely on design-doc features the code never built. The author needs the seams (file:line) where a dev mode would plug in.

### What I did

- Read `README.md`, `AGENT.md`, `doc/building-apps.md`, `doc/production.md`, `doc/claude-apis/README.md`, and `doc/design/slop-v3.md` (all 1,841 lines).
- Listed `pkg/` and `cmd/` with line counts, then read the store layer (`pkg/store/store.go`, `files.go`), the kernel (`pkg/kernel/kernel.go`, `apps.go`), the manifest (`pkg/apps/manifest.go`, `pkg/rt/manifest.go`), and the actor manager (`pkg/actor/manager.go` activation, setup, Call, onCommit, logs).
- Grepped every verb name (`Name: "`) to get the real verb table and compared it to the design's §12.1 table.
- Read the file verbs (`pkg/commands/files.go` whole), mount verbs (`mounts.go` whole), actor verbs (`actors.go:1-215`), store/grant/log verbs (`stores.go`), export/import (`data.go:50-135`), `preview.go`, `eval.go`.

### Why

The design doc is aspirational (it describes a browser workbench, images, steps, page SQL). The guide's readers will build on the Go code, so each design claim had to be checked against code before it could be cited.

### What worked

- The verb-name grep was the fastest map of the real surface: one command showed that `store.fork`, `step.*`, `comments.*`, `room.*` and `approve.*` do not exist, and that `preview.url`, `app.follow` and `log.wait` do.
- `pkg/doors/actors/modworkshop.go:6-19` turned out to be a ready-made list of the dev-loop verbs ("push writes to the draft ref unless told otherwise: mounts serve main, and only publish moves it").

### What didn't work

- An awk one-liner to renumber `sed` output of `manager.go` mangled tab-separated lines and printed empty bodies; I switched to the Read tool with offsets.
- First grep with `--include=*.go` failed under zsh (`no matches found: --include=*.go`); quoting the glob (`--include='*.go'`) fixed it.

### What I learned

Doc/code disagreements that matter for SLOP3-022:

- No page SQL: no `slop.sql.expose`, no `slop.sql.select/watch` (design §5.1, §5.5, App. E) — `rt.ContractCaps` (`pkg/rt/manifest.go:39-40`) and the runtime's `slop()` (`web/runtime/src/caps.ts:281-319`) have none.
- Manifest field is `type`, not `opens` (`pkg/apps/manifest.go:244` vs design §6.1); platform permissions are `stores.create`, `mounts.set`, `grants.set` (`manifest.go:277`) not `stores:create`, `mounts:request`, ….
- Turn limit is 5 s (`pkg/actor/actor.go:32`), not 250 ms (design §4.8).
- Activation is lazy (on the next `kernel.Running` call), not inside the push (design §6.4); no `VACUUM INTO` images exist.
- `comments` is never granted (`doc/claude-apis/README.md:32`).
- Design MCP "about twenty tools"; code exposes every verb the token may call (`pkg/doors/mcp/mcp.go:3-9`).

### What was tricky

Figuring out which snapshot a mount serves: a mount has no ref field; the served version is `kernel.Running(store)`, which reads the *store's* `_meta.app_ref` and resolves it on the *app store* (`pkg/kernel/apps.go:57-108`). So "serve a branch" means "make a store that follows that ref".

### Second pair of eyes

Check my reading that `files.put` on an app store does not change what any view serves until a snapshot moves a ref (`pkg/commands/files.go:81`'s doc says so; sandbox serves snapshots only, `pkg/doors/pages/sandbox.go:124-158`).

### Future

Step 2 traces the dev loop end to end.

### Code review

Nothing written but this diary.

### Technical details

```sh
grep -rn 'Name: "' --include='*.go' pkg | grep -v _test   # the real verb table
grep -rn 'expose' --include='*.go' pkg cmd                  # no page SQL exposure
```

## Step 2: Trace the dev loop — draft ref, scratch store, reload, publish — and list the gaps

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** Follow a code change from push to a live page and actor, find where a dev copy is isolated from production, and where "publish" happens.

**Inferred user intent:** Know which parts of "edit live, publish instantly" are already wired and which are new work, with the file to change for each.

### What I did

- Grepped `draft` across Go code: found `preview.url` (default ref `draft`), `app.follow` ("draft runs unpublished code"), the `workshop` module, and tests.
- Read `pkg/host/workshop_module_test.go:60-129`: it pushes migration `002` to `draft`, makes `jot-scratch` with `app: jot`, follows `draft`, and asserts the scratch store has the new table while `jot` still runs `main`. This is the dev-copy loop, tested.
- Read serving: `pkg/doors/pages/site.go` (resolve, static host), `live.go` (shell, views, sign-in), `sandbox.go` (sandbox origins, `/v/<n>/`, injection), `preview.go` (preview origins with a null `window.claude`), `views.go:76-191` (openView, sandboxURL) and `:490-580` (commit fan-out, `reload`, the RPC table).
- Read the runtime: `web/runtime/src/index.ts`, `caps.ts`, `transport.ts`, and the shell `pkg/doors/pages/assets/shell.js` message switch.
- Read the doors: `pkg/doors/mcp/mcp.go`, `pkg/doors/api/api.go`, `pkg/commands/eval.go`, CLI `cmd/slop/cmds/extra.go`, `pkg/client/folder.go`.
- Read access (`pkg/access/check.go:155-272`, `pkg/authz/code.go`), policy (`pkg/policy/policy.go:20-24`), and Pinboard (SLOP3-016 guide §6.3-6.8 and §13 As built; SLOP3-017 §6 and §13; `apps/pinboard/js/frames.js`).

### Why

The question is whether slop needs new architecture for a dev environment or mostly a tool on top of existing verbs.

### What worked

The chain is complete in code: `files.push {ref: "draft"}` moves only `draft` (`pkg/store/files.go:180-228`) → the commit's `ref` change makes `views.publish` call `reloadApp` (`pkg/doors/pages/views.go:493-539`) → `kernel.Running` activates any store following `draft` (migrations, setup, smoke; `pkg/kernel/apps.go:181-209`, `pkg/actor/manager.go:415-557`) → the old actor is stopped (`manager.go:345-356`) → open views get `reload {version}` → the shell reopens the frame (`shell.js:243`). Publishing is `ref.move <app> main <n>` (`pkg/commands/files.go:204-217`), which triggers the same reload for production views.

### What didn't work

Nothing failed; the one dead end was looking for `fsnotify` or any watch loop: none (`grep -c fsnotify go.mod` → 0).

### What I learned

- Code pushes need a **platform admin** (`pkg/authz/code.go:15-17`, `pkg/access/principal.go:91-93`), so a member cannot run a dev loop on an app today.
- A dev store shares the app's policy cells, secrets and module trust with production, because they are keyed by app (`pkg/actor/manager.go:113-122`, `pkg/policy/policy.go:20`).
- Editing an applied migration breaks the dev store (`pkg/actor/manager.go:437-440`).
- `files.push` does not report activation; a tool must call `app.status` after.
- `preview.url` serves any ref on a private origin but with every capability `null` (`pkg/doors/pages/preview.go:234-245`): fine for static pages, useless for apps that need `db`.

### What was tricky

`reloadApp` only fires on `ref` changes in the app store and only for views whose store now resolves to a different `n`; working-tree edits (`files.put`, `import.files`) never reach a page. A Sitebench-style "every keystroke shows" loop therefore needs a snapshot per save (cheap: identical trees reuse their snapshot, `files.go:203-206`).

### Second pair of eyes

- Confirm `onCommit` → `Get` → `Running` really activates the pushed store itself soon after the push (`pkg/actor/manager.go:757-765`), i.e. without a visitor.
- Confirm the static host serves a store following `draft` at its draft snapshot (it uses `res.run.N`, `pkg/doors/pages/site.go:117`).

### Future

The gaps list in the report is the input for the guide's implementation plan: a `slop dev` watch-push loop, push-reports-activation, `store.fork`, per-ref preview with a runtime, dev-only migration reset, a narrower code right, per-store config overrides.

### Code review

Nothing written but this diary.

### Technical details

The tested dev-copy loop, condensed from `pkg/host/workshop_module_test.go:84-129`:

```text
files.push {store: jot, files: app}                      # main = n1, jot runs n1
store.new  {id: jot-scratch, app: jot, type: jot}        # a data store running jot
files.push {store: jot, files: app+002.sql, ref: draft}  # draft = n2, main untouched
app.follow {store: jot-scratch, ref: draft}              # activates n2 on jot-scratch only
actor.call jot-scratch tables  -> ["notes","tags"]
actor.call jot         tables  -> ["notes"]
```
