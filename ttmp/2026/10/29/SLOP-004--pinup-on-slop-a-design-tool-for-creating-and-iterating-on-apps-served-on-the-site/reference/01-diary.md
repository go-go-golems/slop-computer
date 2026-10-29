---
Title: Diary
Ticket: SLOP-004
Status: active
Topics:
    - tools
    - collaboration
    - architecture
    - frontend
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological diary for SLOP-004: Pinup on slop."
LastUpdated: 2026-10-29T09:36:32.187250489-04:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Record how SLOP-004 was researched, designed and built: Pinup, Ramon's design tool, running on slop as a Workshop tool for creating and iterating on what the site serves.

## Step 1: Pinup studied, copied into the repo, and the integration designed

I read the Pinup export (`~/code/others/ramon/pinup-export`) and the 699-line project report in the vault. Then I read every slop part the integration lands on: tools and grants, `tool.js`, the Workshop's tool iframe, the event broker and its ephemeral events, push and blobs, records, threads and `comments wait`, and sandbox labels. Pinup reaches its host only through `window.claude.use(name)`, and `tests/mock.js` implements that whole host in 46 lines. So the integration is a host adapter plus one missing slop primitive: a live document store.

Midway, the user asked for Pinup to be copied into this codebase. It is now at `web/pinup/` (commit `91c42b3`). The in-repo build is byte-identical to the published page, and three of the upstream Playwright tests pass in-tree. The intern guide (`design-doc/01-…`, 602 lines) is written and uploaded to reMarkable.

### Prompt Context
**User prompt (verbatim), 1:** "Ok, now let's study ~/code/others/ramon/pinup-export and the writeup about pinup in ~/code/wesen/go-go-golems/go-go-parc/Projects/ from yesterday, and tell me how you would integrate it as another way to edit and create apps on slop.yolo to create and iterate on apps served on site.yolo ? How to adapt it, etc..."
**User prompt (verbatim), 2:** "Alright, create a new docmgr ticket, and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**User prompt (verbatim), 3 (mid-turn):** "integrate / copy pinup over into this codebase as well, so we can keep it going over the long run."
**Assistant interpretation:** Turn the integration proposal into a ticket with an intern guide and upload it. Bring Pinup's source into the repo so it can be maintained here. No implementation of the integration yet.
**Inferred user intent:** Make Pinup slop's design surface for the long term, starting with a plan someone new can follow and a codebase that owns Pinup.
**Commit (code):** `91c42b3` "web/pinup: import Pinup (Ramon's design tool) to maintain alongside slop"; this commit adds the ticket, the guide and this diary.

### What I did
- **Read the sources.** `PROJECT REPORT - Pinup - A Shared Design File Inside a Claude Artifact - A Technical Deep Dive.md` in full. In the export: `tests/mock.js`, `build.js`, `vendor/package.json`, `src/09-collab.js` (`cap`, `initData`, the inbox, presence, the send-to-chat payloads), `02-store.js` (the write queue and error codes), `13-feedback.js` (`applyStep` ops), `10-claude.js` (`ALLOWED_KEYS`, the brief), `07-export.js` (`exportHTMLDoc` keeps `data-link`), `06-proto.js` (the player's DOM dependencies), and `body.html` (the README for Claude).
- **Read the slop side:**
  - `pkg/server/tools.go` (grant, CORS) and `pkg/store/tools.go` (`ToolPermissions`);
  - `pkg/render/assets/{runtime,tool}.js` and `web/workshop/src/screens/ToolScreen.tsx` (the iframe sandbox attributes);
  - `pkg/events/broker.go`, `pkg/store/events.go` (ephemeral `Seq 0` events) and `pkg/server/stream.go` (`eventStream`, `waitComments`);
  - `pkg/server/kernel.go` (push, blobs, `maxFiles`), `pkg/records/records.go` (`Parse`: one JSON file, one record), `pkg/store/threads.go` (`CreateThread`), `pkg/store/sandbox.go` (labels per artifact and version), `pkg/render/render.go` (`Inject` on a fragment), and `pkg/server/auth.go` (`guardPerm`).
- **Copied Pinup into `web/pinup/`:**
  - `src/`, `build.js`, `vendor/package{,-lock}.json` and `tests/*`;
  - left out `dist/` (build output) and the 16 MB session transcript;
  - `tests/wrap.js` now reads `../dist/pinup.html` instead of the session's `/home/claude/pinup/dist/pinup.html`;
  - added `README.md` (provenance, build, test, file map) and `.gitignore` (dist, vendor/node_modules, test outputs).
- **Verified the copy.** `cd vendor && npm ci` (`added 1 package`), then `node build.js` → `built 705 KB 1534 icons`. sha256 of the in-repo `dist/pinup.html` and of the export's: both `531ef701b5c1417e`.
- **Ran tests in-tree.** Playwright 1.64.1 installed in the scratchpad, with a preload shim (`use-cached.js`) passing `executablePath` for a cached `chromium_headless_shell-1234`:
  - `t1`: exit 0;
  - `t5`: exit 0, "ask out Added a Settings screen", "after undo … Profile" (Settings removed), handoff 22,660 characters;
  - `fb1`: exit 0, gap 12 → 20 → 12 → 20, item #1 done → open.
- **Ticket:**
  - `docmgr vocab add` topics `tools` and `collaboration`;
  - `docmgr ticket create-ticket --ticket SLOP-004 …`, plus the design doc and this diary;
  - 11 tasks, two checked.
- **The guide** has eleven sections:
  - slop recap, Pinup recap, the capability contract with call shapes, the slop features used, gap table;
  - design: architecture diagram; design file as data artifact; docs store schema, API, stream, errors; adapter pseudocode; packaging; presence; agent channel; Save version; publishing paths B, C and D; Workshop changes; phase 3;
  - an end-to-end session, a plan with files, tests, risks, and how to keep Pinup maintainable here.
- **Upload.** `remarquee upload bundle … --name "SLOP-004 Pinup on slop intern guide" --remote-dir /ai/2026/10/29/SLOP-004` → `OK: uploaded SLOP-004 Pinup on slop intern guide.pdf -> /ai/2026/10/29/SLOP-004`.

### Why
- **Live docs and snapshots are separate.** The live documents are the working copy, mutable and last-writer-wins, which is what Pinup's model needs. Versions stay the published, immutable record that routes follow. Mixing them would mean either a version per drag, or giving up slop's immutability.
- **Doc changes are ephemeral broker events, with replay by `rev` from the docs table.** The broker already passes `Seq 0` events, and the event log and audit would otherwise get one row per pointer move. Replaying by `rev`, with tombstones for deletes, keeps reconnects lossless anyway.
- **The adapter is the only fork point** (`00-slop-host.js`, `--slop` build only). Upstream `dist/pinup.html` stays identical to what Ramon publishes, and re-importing a new export is a copy plus a sha check.
- **The player reads designs as bound data**, rather than exporting HTML per screen. It is slop's normal "renderer page plus bound data" model, and *Save version* updates the site through `main`.

### What worked
- The copy is faithful: build sha `531ef701b5c1417e` on both sides.
- The upstream test suite runs from the repo with no change to the test scripts other than `wrap.js`'s path.

### What didn't work
- **Wrong Playwright browser build.** `node t1.js` (and `t5`, `fb1`) → `browserType.launch: Executable doesn't exist at /home/manuel/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`. Playwright 1.64.1 wants build 1248, and the cache has 1181–1234. A preload shim that wraps `chromium.launch` with `executablePath` pointing at build 1234 fixed it without touching the tests.
- **A hard-coded session path.** `tests/wrap.js` read `/home/claude/pinup/dist/pinup.html`, which only existed in the cloud session. Changed to `__dirname + '/../dist/pinup.html'`.
- **Two wrong claims in my first draft of the guide**, caught by reading `guardPerm` (`pkg/server/auth.go:120`):
  - the adapter sketch called `GET /api/users` and §6.6 called `GET /api/agents`. Both are registered with plain `guard`, which answers a grant with `403 grant_not_allowed`;
  - fixed by adding `people` to the grant response, by having the server include waiting agents in `GET /api/presence`, and by adding `artifacts:read` to the tool manifest for the file picker.
- **The test runs left files in `tests/`** (`*.png`, `index.html`, `dump.json`). I deleted them and added them to `web/pinup/.gitignore`.

### What I learned
- Pinup's build output is a fragment (`head.html` starts with `<title>`). The Artifact host wraps it, but slop's `render.Inject` only prepends to a fragment, so the slop build must add the document skeleton itself.
- A tool's sandbox origin is per (artifact, version). Every Pinup upgrade starts with empty `localStorage`, which is harmless once the file lives in slop.
- Threads can be created on a data artifact, but only on an existing version. That is one reason a new design pushes v1 immediately.
- `exportHTMLDoc` keeps prototype links as `data-link="<frame name>"`, so a static publish needs only a tiny link router.

### What was tricky to build
- Fitting Pinup's per-layer documents into slop's limits. A version holds at most 2,000 files, so snapshots bundle nodes per page (`pages/<pageId>.json`). The live store has no such limit and uses Pinup's per-layer paths unchanged.

### What warrants a second pair of eyes
- **The docs store as a new kernel primitive.** It is mutable, it isn't audited per row, and it is limited to `type: pinup` artifacts. Check that this doesn't become a way around versions for page content.
- **Exposing `people`** (ids and names of active users) in every grant response.
- **Event fan-out under two dragging tabs** (guide §10). This hasn't been measured.

### What should be done in the future
- Phase 1 tasks (docs store, API and stream, CLI, the grant's args and people, adapter, `--slop` build, help topic, Playwright against `slop serve --local`).
- Still pending from SLOP-003: merging gitops PR #399, then running `scripts/01-swap-release-routes.sh` on the cluster.

### Code review instructions
- Read the guide, sections 3, 6.3, 6.4 and 6.9, against `web/pinup/tests/mock.js`, `web/pinup/src/09-collab.js` and `pkg/render/assets/tool.js`.
- Reproduce the copy check: `cd web/pinup/vendor && npm ci && cd .. && node build.js && sha256sum dist/pinup.html` should start `531ef701b5c1417e`.

### Technical details
```
web/pinup: 35 files, 556 KB in git; dist/pinup.html 705 KB (icons 1534)
host contract (mock.js): db{doc,collection,onSnapshot,set,update,delete,acquire,get} room{presence,onPeers,canSendToClaudeSession,sendToClaudeSession}
                         user{me,can,canEdit,isOwner,profiles} comments{customAnchors} sample(messages,{tools,onText}) downloads{save} assets:null
slop limits that shape the design: maxFiles 2000, maxVersionSize 200 MB, push body 4 MiB, grant TTL 1 h, sandbox origin per (artifact, version)
reMarkable: /ai/2026/10/29/SLOP-004/SLOP-004 Pinup on slop intern guide.pdf
```

## Step 2: The docs store, its API and stream, and presence

This step builds the slop primitive Pinup lacked: live, mutable JSON documents per design artifact, with a change stream and leases. The data lives in two tables. `docs` holds one row per document, or a tombstone once it is deleted. `doc_heads` holds the per-artifact revision counter; its upsert locks the row, which serializes an artifact's writers until commit. On top sit `/api/docs/...`, a server-sent stream that replays by revision and then goes live, and in-memory presence per design that also lists agents waiting on it. Document and presence events stay off the Workshop's kernel stream. Tool grants now carry `people`, the names of active users, because a grant cannot list users itself.

Everything passes on SQLite and Postgres, and lint is clean. One check deliberately broke a test to prove it can fail. Undoing that change with `git checkout` also reverted my uncommitted fix, which I caught from `git diff --stat` and reapplied.

### Prompt Context
**User prompt (verbatim):** "Implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill) (use skill iary format, MANDATORY). When done,  write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill).      
 Commit and push the bsidian vault when done (go-go-parc vault)."
**Assistant interpretation:** Implement the SLOP-004 guide, phases 1 and 2. Phase 3 (the `sample` proxy, assets, roles) needs an API key and a role decision. Keep this diary, then write a vault report and push the vault.
**Inferred user intent:** Pinup working on slop end to end, documented well enough to teach from.
**Commit (code):** `6de88a3` "Docs store: live JSON documents for tool working copies"; `f87ad27` "Docs API, docs stream and presence; people in tool grants".

### What I did
- **Migrations** `pkg/store/migrations/{postgres,sqlite}/006_docs.sql`:
  - `doc_heads(artifact_id PK, rev)`;
  - `docs(artifact_id, path, data NULL=tombstone, size, rev, updated_by, updated_at, lease_holder, lease_until)` with index `docs_rev(artifact_id, rev)`.
- **Store** `pkg/store/docs.go`:
  - `DocTypes{pinup}` and the limits: 256 KiB per document, 20k documents and 64 MB per artifact, a 1 min lease cap, tombstones kept 7 days;
  - `PutDoc` (object check, size, quota, rev, upsert), `DeleteDoc` (tombstone), `GetDoc`, `Docs(prefix, after)` (live documents only when `after == 0`, tombstones included otherwise), `AcquireDoc`, `PruneDocTombstones`, `DocArtifact`;
  - errors `ErrDocTooLarge` and `ErrDocQuota`.
- **Events** (`pkg/store/events.go`): `EvDoc` and `EvPresence`, plus `DocStreamOnly`. `eventStream` (`stream.go`) now subscribes with a filter that drops these types.
- **API** `pkg/server/docs.go`, registered with `s.docRoutes(m)` in `server.go`:
  - `GET /api/docs/{artifact}` (`?prefix=&after=`);
  - `GET|PUT|DELETE /api/docs/{artifact}/{coll}/{id}`;
  - `POST …/acquire` with `{holder, ttlMs}`;
  - `GET /api/docs/{artifact}/events` (SSE; `id:` lines carry the rev);
  - `GET|POST /api/presence/{artifact}`;
  - `docFail` maps errors to `413 too_large` and `507 quota_exceeded`;
  - doc events carry the data inline up to 64 KiB, and above that `big: true`.
- **Presence:** `presenceHub` keeps peers per design for 30 s. It refuses a peer id already held by another user (`409 peer_taken`). Agents whose waiter matches the design, its project, or everything are listed as `kind: agent`, and their `agent.waiting` and `agent.left` events are relayed onto the design's stream as `presence` events.
- **Permissions:** `ToolPermissions` gains `docs:read` and `docs:write`. `grantTool` adds `people`.
- **Tests:**
  - `pkg/store/docs_test.go`: `TestDocs` covers type, path, object and size refusals, revs, tombstones, prefix (`_` is not a wildcard), leases (exclusive, renewable, expiring, none on a tombstone) and prune. `TestDocRevsUnderConcurrency` runs 40 parallel writers and checks every rev is unique.
  - `pkg/server/docs_test.go`: `TestDocsAPI` covers stream ready, then live doc, tombstone, replay after rev 1, grant permissions (403 for docs:read only), 400, 404 and 413, leases, presence on the docs stream, nothing on the kernel stream, and leave.

### Why
- **The revision is a counter row, not `MAX(rev)+1`.** Two concurrent transactions computing `MAX` could hand out the same rev. Upserting `doc_heads` locks that row until commit, so revs are unique and *commit in order*. That is what lets the stream skip duplicates with `rev <= last`, as `eventStream` does with `seq`.
- **Prefix matching uses `substr(path,1,n)=prefix`, not `LIKE`.** `_` is a legal path character but a `LIKE` wildcard; the test `no_es/` would otherwise match `noXes/`.
- **Doc events are ephemeral.** Storing them would put every drag in the event log, and they'd reach every Workshop tab. The docs table plus `rev` is the durable record.
- **Presence lives in memory.** One process is the broker's assumption too (`broker.go:8`).

### What worked
- `go test ./pkg/server ./pkg/store` → ok on SQLite. With `TEST_DATABASE_URL=…:55432` → ok on Postgres, including the 40-writer concurrency test.
- `make lint` → exit 0, after `gofmt`.
- A mutation check: with `eventStream` back on `Subscribe(nil)`, `TestDocsAPI` fails with `the kernel stream must skip doc and presence events, got presence …`. So the test guards the filter.

### What didn't work
- **First build:** `pkg/server/docs.go:294:15: assignment mismatch: 2 variables but s.Store.Docs returns 3 values`. I had used `Docs(…, 1<<62)` as a stand-in for "does this artifact keep docs?". I replaced it with a proper `Store.DocArtifact`.
- **First lint:** `pkg/server/docs_test.go:135:1: File is not properly formatted (gofmt)` and `pkg/store/docs.go:65:1: … (gofmt)`. Fixed with `gofmt -w`; lint then returned 0. As in earlier steps, lint went to a file and I checked its exit code, so nothing was committed unformatted.
- **Mutation undo reverted real work.** After the mutation check I ran `git checkout pkg/server/stream.go`, which reset the file to HEAD and so also dropped the *uncommitted* filter change. `git diff --stat` showed nothing changed. I reapplied the edit, and the next runs and the commit include it. Lesson: undo a mutation with the inverse `sed`, not `git checkout`, when the file has uncommitted work.

### What I learned
- The broker already supports filtered subscribers and ephemeral events, so the docs stream needed no broker change. The kernel stream simply had to stop accepting everything.
- `guardPerm` with a permission accepts grants *and* admin tokens. The same endpoints therefore serve Pinup (grant) and the CLI (token).

### What was tricky to build
- **Ordering in the stream.** The subscription must exist before the replay query, and the replay's last rev becomes the cursor. Doc events include their rev in the payload, not in `Seq`, which is 0 for ephemeral events, so the live branch decodes `rev` to dedupe.
- **Agents as peers.** `Waiter` events carry the waiter's artifact and project. `agentFor` treats a waiter with no artifact as matching its project, or every design when it has no project either.

### What warrants a second pair of eyes
- **Quota scan.** `PutDoc` counts and sums an artifact's live documents on every write, up to 20k rows, under the head lock. That's fine at Pinup sizes but should be measured on big files.
- **No server-side expiry timer for presence.** Peers expire lazily on the next post or list for that design. The adapter heartbeats every 15 s, so a closed tab disappears within 30–45 s.
- **No pruning schedule yet.** `PruneDocTombstones` exists but nothing calls it.

### What should be done in the future
- Call `PruneDocTombstones` on a schedule, at startup and daily.

### Code review instructions
- Read `pkg/store/docs.go`, then `pkg/server/docs.go` (`docEvents`, `postPresence`), then the one-line filter in `pkg/server/stream.go`.
- Validate with `go test ./pkg/store ./pkg/server`, then the same with `TEST_DATABASE_URL`, then `make lint`.

### Technical details
```
PUT /api/docs/design-x/nodes/n1 {"type":"frame"}       → {"path":"nodes/n1","rev":1}
SSE  event: doc   id: 1   data: {"path":"nodes/n1","rev":1,"data":{"type":"frame"},"by":"usr_…"}
     event: ready         data: {"rev":3}
     event: presence      data: {"peer":"tab-a","user":"usr_…","name":"manuel","kind":"viewer","presence":{"page":"p1"}}
errors: 400 invalid_request (path, object, type) · 404 not_found · 413 too_large · 507 quota_exceeded · 409 peer_taken
```

## Step 3: Pinup running on slop, end to end on the local server

This step builds everything between the docs API and a person using Pinup:

- **Grants:** the Workshop forwards tool `args`, `config` and `people` with each grant.
- **Tool client:** `tool.js` gains `stream`, `putRaw`, `beacon` and `setArgs`.
- **CLI:** `slop docs` for agents.
- **Pinup adapter:** `00-slop-host.js` (tool mode and player mode) and the `95-slop-ui.js` menu (Save version, Publish prototype, Hand off, a picker).
- **Build:** `slop/build.js` and `make pinup`/`pinup-push`.
- **Help:** `slop help pinup`.

The whole loop then ran on the local server, which holds the francois import:

1. enable the tool;
2. create *Pace Club*;
3. load the example (106 documents);
4. an agent writes HTML to `inbox/` and the open tab imports it as a screen;
5. *Save version*;
6. *Publish prototype*, with the player navigating on the site host;
7. *Hand off*, which wakes an agent waiting in `comments wait`;
8. an agent's inbox step resolves feedback #1, and History shows each step with its actor.

Three bugs surfaced along the way and are fixed: the icon load order, the Workshop dropping `?file=` after enabling, and the `tool <name>` label CSS the user reported.

### Prompt Context
**User prompt (verbatim):** see Step 2. Mid-step: "CSS for \"tool Pinup\" on the left looks a bit weird. [Image #2]" and "can we create apps that display artifacts / itneract with the artifacts db?"
**Assistant interpretation:** Finish phases 1 and 2. Fix the label. Answer the question about apps that use artifacts and the db in the turn summary.
**Inferred user intent:** A usable Pinup in the Workshop, and a sense of what other apps the same machinery allows.
**Commit (code):**
- `ef8a8d2` "Tools get args, config and people; tool.js stream/putRaw/beacon; slop docs CLI";
- `2f1f2b9` "Pinup on slop: host adapter, slop menu, player mode, build and push targets";
- `ea9c141` "Help: slop help pinup (designs for agents); agents topic links it".

### What I did
- **Workshop** (`ToolScreen.tsx`, `App.tsx`):
  - `toolArgs(query)`, the query without `try`, is forwarded in the grant message with `people`, and `config: {siteHosts, publicUrl}` comes from the boot config;
  - `tool-args` messages from the tool replace the Workshop URL's query;
  - enabling a version keeps the args;
  - the iframe gets `allow-downloads` and `allow="clipboard-read; clipboard-write"`.
- **CSS** (`workshop.css`): `.addr span` is vertically centred; `.addr.label` is a compact label with a 6 px gap, used by the tool screen.
- **`tool.js`:**
  - one SSE reader, `sse(path, after, on)`, now serves both `api.on` (kernel events) and the new `api.stream(path, {after, on})`;
  - `api.putRaw` (blob bodies), `api.beacon` (`keepalive`), `api.setArgs`;
  - `api.args`, `api.config` and `api.people`.
- **Client and CLI:** `pkg/client/docs.go` (`Docs`, `Doc`, `PutDoc`, `DeleteDoc`, `WatchDocs` with reconnect from the last rev) and `cmd/slop/cmds/docs.go` (`slop docs ls/get/put/rm/watch`), registered as the `docs` group.
- **`web/pinup/slop/js/00-slop-host.js`.** It is spliced into Pinup's IIFE before `01-util.js`.
  - Tool mode: `db` keeps a mirror of the design fed by `/api/docs/<design>/events`. The replay builds the initial snapshots, then live events become `docChanges()`; big documents are fetched; out-of-order revs are ignored.
  - `user` comes from the grant and its `people`.
  - `room`: presence is posted at most every 250 ms, with a 15 s heartbeat, `pagehide` leave, and stale peers dropped after 45 s. `sendToClaudeSession` becomes a thread on the design.
  - `downloads` uses a Blob download.
  - The picker lists `type: pinup` artifacts or creates a design: it pushes v1 and writes `meta/file`.
  - Player mode: a read-only `db` from `slop.data.design` records (`file.json` and `pages/*.json`), and a `user` who cannot edit.
- **`web/pinup/slop/js/95-slop-ui.js`:**
  - the slop menu: Save version, Publish prototype (PUT two routes `/proto/<slug>` and `/:screen` to `pinup-player` with a `design` binding), Hand off (save, then a thread with the build brief), Copy agent brief, and Open another design;
  - player mode hides `#app` and `#pvClose`, wraps `onLoaded` to present the screen named by `:screen`, and wraps `showFrame` to keep the URL on the current screen;
  - snapshots are `file.json`, `pages/<pageId>.json` and `handoff.md`, with `_m` stripped.
- **`web/pinup/slop/build.js`:** upstream modules plus `slop/js`, sorted by file name, in a document skeleton. It writes `dist/slop/` (tool manifest: docs:read, docs:write, artifacts:read, versions:push, threads:write, routes:write) and `dist/slop-player/`, with the same `index.html`. The Makefile gains `pinup` and `pinup-push` (`SLOP ?= slop`).
- **Help:** `pkg/doc/topics/pinup.md` covers the layout, the inbox (HTML and steps), the loop, building, and publishing. `agents.md` §6 links to it.
- **The local run** (server `slop7`, `slop_fr`), with screenshots `various/s4-01…s4-10`:
  1. `Applied migration migration=006_docs.sql`. `make pinup-push` → `pushed pinup v1 (new artifact)` and `pushed pinup-player v1 (new artifact) … 0 uploaded` (same blob).
  2. Enabled v1. The dialog lists the new permissions in plain words (`s4-01`).
  3. The picker listed the four projects. *Create* "Pace Club" in Play → the URL became `/tools/pinup?file=design-pace-club`.
  4. *Start with an example app* → `slop docs ls` → 106 documents (104 nodes, meta, one log entry).
  5. `slop docs put design-pace-club inbox/h1` (HTML Leaderboard) → the inbox drained, 110 documents, and a "Leaderboard" frame (390×844, auto layout gap 12, padding 24) on the canvas (`s4-04`).
  6. Pushed v2 with the icon fix and updated through the dialog. Then *Save version* → `Saved design-pace-club v2.`. `slop pull` → `file.json`, `pages/p1.json` (77 nodes), `pages/p7ndBvr.json` (31), `handoff.md` (21,670 characters), no `_m`, and versions listed `via tool`.
  7. *Publish prototype* → routes `/proto/pace-club` and `/proto/pace-club/:screen` → `pinup-player`, binding `design-pace-club@main`. On the site host: 200 each, about 849 KB with the design inlined. Clicking "Find a run" in the player went Welcome → Home, and the URL became `/proto/pace-club/home` (`s4-07`, `s4-08`).
  8. With `slop comments wait --artifact design-pace-club` running, the tool showed a "Claude" avatar. *Hand off* woke it with a thread on v2, anchor `{pinup:{file, handoff:true}}`, carrying the build brief and the note.
  9. `slop docs put feedback/Fcli1` (an open item on `Upcoming`), then `inbox/s1` (a step with `feedback "#1"`, gap 12 → 20) → node gap 20; feedback `done` with the reply and `log: ['Lmvtmn5wtqWfB']`. History shows the three steps with their actors (`s4-10`).
- **Checks:** `make lint` 0; `go test ./...` 0; Postgres store and server 0; `npx tsc --noEmit` 0; `node --check` on `tool.js` and on `dist/slop-check.js`; the upstream `dist/pinup.html` still has sha `531ef701b5c1417e`.

### Why
- **One page, two modes.** `06-proto.js` calls a dozen functions from the editor modules (`finishEdit`, `topOf`, `goPage`, `select`, `presenceSoon`, `CA`, …). A cut-down player bundle would have to stub them all. The full page with a read-only `db`, a non-editing `user` and `#app` hidden reuses Pinup unchanged.
- **The adapter is spliced into the IIFE**, not loaded as a separate script. That way slop's modules can call Pinup's `h`, `sheet`, `menuAt`, `toast`, `handoffMarkdown` and `slug`, and wrap `boot`, `onLoaded` and `showFrame`, without touching upstream files.
- **Snapshots leave feedback out.** A published route makes the bound version public, through the boot data and `/_d/`. Review items are internal; the handoff and layers are the design itself.
- **"Send to Claude" becomes a thread.** On slop the agent is a process blocked on `comments wait`. A thread wakes it and records what was asked.

### What worked
- The upstream review flow (feedback → inbox step → leased, applied, linked, revertible) works unchanged against the real server. This is what `fb1.js` exercised against the mock.
- A tool upgrade (v1 → v2) went through the existing approval dialog. The design's documents are unaffected, because they live on the server, not in the sandbox origin's storage.

### What didn't work
- **Missing icon.** The first build's slop button had a blank icon: `ico()` ran at module load, but `boot()` calls `loadIcons()` later (`01-util.js:52`), so `ICONS` was still `{}`. Fixed by creating the button in a wrapper around `boot` (pinup v2).
- **Lost `?file=`.** After *Update to v2* the Workshop navigated to `/tools/pinup` and dropped `?file=`, so the picker reopened: `EnableToolDialog` called `navigate(toolPath(t.artifact))`. It now keeps `toolArgs(location.search)`.
- **The user's CSS report.** The tool label sat at the top of a full-width address box with "tool" and "Pinup" run together: `.addr span` was 26 px tall without vertical centring, and `.addr` is `flex:1`. Fixed with the `.addr.label` variant (`s4-05`).
- **Ambiguous locator.** `locator('textarea').fill(…)` → `strict mode violation: locator('textarea') resolved to 2 elements`, Pinup's prompt bar and the sheet's. I used the placeholder instead.
- **Invalid click argument.** `browser_click` with `element`/`ref` → `Invalid arguments … expected string, received undefined → at target`. I used `browser_run_code_unsafe` with role locators.
- **A guess I caught before it shipped.** The first `slopPush` sent `via: 'pinup'`. I dropped it, because grant pushes are attributed to the tool by the server (`via tool`).

### What I learned
- `comments wait` with a token excludes only comments made *with that token*. Threads created by a tool grant carry no token, so a person's hand-off through Pinup wakes an agent logged in as the same person.
- A binding name doesn't have to be in the page's `reads`: route bindings add names. `pinup-player` needs no `reads` at all, and one player serves every design.

### What was tricky to build
- **Snapshot timing in the mirror.** Pinup registers its five listeners synchronously, before the stream's `ready`. The mirror therefore applies replayed documents silently and delivers each listener's initial `added` set at `ready`. Listeners added later get theirs on the next tick. Live events after `ready` are diffed against the mirror into `added`, `modified` or `removed`. Tombstones stay in the mirror with their rev, so a late fetch of a big document cannot resurrect it.
- **URL state in the player.** `openPresent` sets `#present` after `showFrame`, which the wrapper has already pointed at `/<screen>`. The URL ends up as `/proto/pace-club/welcome#present`, which is harmless.

### What warrants a second pair of eyes
- **`routes:write` in the tool manifest** lets Pinup point routes on every host, not only `/proto/*`. It is approved by an admin, but a narrower permission (routes under a prefix) would match the need better.
- **Toast wording.** Pinup's toasts still say "Sent to Claude — check the conversation". On slop it is a thread; changing that wording means patching upstream text.
- **Player page size:** about 849 KB, the Pinup page plus the design in the boot data. Images as data URLs would grow it; the `assets` capability is phase 3.
- **The docs store is limited to `type: pinup`** (`store.DocTypes`). Other tools need a registration step before they can use it (see the answer in the turn summary).

### What should be done in the future
- A scripted Playwright test of tool mode against `slop serve --local` (this step was verified by driving the browser by hand).
- Phase 3: `sample` (in-page Claude) via an API proxy, `assets`, a reviewer role, `viewer: pinup-player` for design artifacts.
- Deploy: merge, publish the image, bump the gitops tag, then `make pinup-push` against the cluster and enable the tool.

### Code review instructions
- Read `web/pinup/slop/js/00-slop-host.js` against `web/pinup/tests/mock.js` (the contract), then `95-slop-ui.js`, then `slop/build.js`.
- Check `pkg/render/assets/tool.js` (`sse`) and `web/workshop/src/screens/ToolScreen.tsx`.
- Reproduce: `make pinup-push SLOP=./slop` against a local server, enable Pinup, then follow the run in What I did.

### Technical details
```
tool manifest: {"title":"Pinup","kind":"page","tool":{"title":"Pinup","icon":"pen-tool","permissions":["docs:read","docs:write","artifacts:read","versions:push","threads:write","routes:write"]}}
snapshot (design-pace-club v2): file.json · pages/p1.json (77) · pages/p7ndBvr.json (31) · handoff.md (21,670 chars)
routes: /proto/pace-club, /proto/pace-club/:screen → pinup-player, bindings {"design":{"artifact":"design-pace-club","version":null}}
module order (slop build): 00-slop-host 01-util … 14-log 95-slop-ui 99-boot
```
