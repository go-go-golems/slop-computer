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
