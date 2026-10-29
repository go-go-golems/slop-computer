---
Title: 'Intern guide: the slop artifact runtime'
Ticket: SLOP-009
Status: active
Topics:
    - architecture
    - backend
    - frontend
    - tools
    - collaboration
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://web/pinup/slop/js/00-slop-host.js
      Note: The adapter this ticket deletes; shows what a per-app adapter has to reimplement
    - Path: repo://pkg/store/docs.go
      Note: The docs store, replaced by the runtime's db
    - Path: repo://pkg/server/docs.go
      Note: Docs API, docs stream and presence hub, replaced by views, the view stream and rooms
    - Path: repo://pkg/server/tools.go
      Note: Tools and grants, replaced by the slop capability and approvals
    - Path: repo://pkg/render/render.go
      Note: Page modes and boot injection; tool mode becomes app mode
    - Path: repo://pkg/store/sandbox.go
      Note: Per-version sandbox labels, replaced by one origin per target
    - Path: repo://pkg/render/assets/tool.js
      Note: The tool client, folded into the runtime as claude.use("slop")
    - Path: repo://ttmp/2026/10/29/SLOP-008--claude-blocks-on-slop-notion-shaped-live-pages-over-a-hypha-log-as-a-workshop-tool/design-doc/01-intern-guide-claude-blocks-on-slop.md
      Note: Blocks, the first app that must run on the runtime without adapter code
ExternalSources:
    - /home/manuel/Downloads/Artifact State Storage — Guide.md
    - /home/manuel/Downloads/Artifact People & Collaboration — Guide.md
    - /home/manuel/Downloads/Artifact Claude API (sample) — Spec.md
    - /home/manuel/Downloads/Artifact Files — Guide.md
    - /home/manuel/code/wesen/go-go-golems/francois
Summary: "Replace slop's per-app adapters (Pinup's window.claude shim, the docs store, tool grants) with a native implementation of the claude.ai Artifact runtime contract: one page runtime (/_slop/claude.js), one server package (pkg/rt) with views, a contract-shaped db with rules, rooms, assets, comments, downloads, artifact.publish and sample, plus slop's own management API as one extension capability. No backwards compatibility; the old pieces are deleted."
LastUpdated: 2026-10-29T18:30:00-04:00
WhatFor: "The design and phased plan for slop's artifact runtime baseline"
WhenToUse: "Before working on pkg/rt, web/runtime, the Workshop's app shell, or moving an app (Pinup, Blocks) onto the runtime"
---

# Intern guide: the slop artifact runtime

This guide explains a large refactor of slop-computer and how to build it. After the refactor, any HTML page written for claude.ai Artifacts runs on slop unchanged. That includes Claude Blocks, Pinup, CC5 and the pages Claude writes every day. slop provides the same runtime those pages expect, rather than a shim per app.

The refactor is deliberately brutal. Nothing old is kept for compatibility: the docs store, the tool grants and Pinup's adapter are deleted, not wrapped. Read sections 1 to 4 first; they define what the rest depends on.

The guide separates three kinds of statement:
- **Observed:** read in slop's code, in francois, or in the contract documents, with a reference.
- **Proposed:** sections 6 to 13; none of it exists yet.
- **Open:** section 16.

## 1. Executive summary

A claude.ai Artifact is an HTML page that reaches its host through one function: `window.claude.use(name)`. That function returns a **capability**, an object with a documented API, or `null` when the host cannot provide it:
- **Storage:** `db`, `assets`, `artifact`;
- **People:** `user`, `room`, `comments`;
- **Claude:** `sample`;
- **Files:** `files`, `downloads`;
- **Connectors:** `mcp`;
- **Consent:** `permissions`.

The set of these APIs is the **runtime contract**. Pages are written against it, and every capability is optional: a page must work when `use()` returns `null`.

slop runs two such pages today, Pinup (SLOP-004) and, as designed, Claude Blocks (SLOP-008). It runs them through **adapters**:
- **Per app:** a script per app that installs its own `window.claude` (`web/pinup/slop/js/00-slop-host.js`, 290 lines).
- **Partial:** it implements part of the contract over slop-specific endpoints: the docs store, the presence hub and tool grants.

The SLOP-008 analysis found twelve gaps between that adapter and what Blocks calls. Every new app would bring a new list.

**The proposal:**
- **One runtime client.** `/_slop/claude.js` implements the whole contract in the page.
- **One server package.** `pkg/rt` implements views, a contract-shaped `db` with access rules, rooms, assets, comments, downloads, `artifact.publish`, `sample` and permissions.
- **slop's own API** (routes, versions, pushes) is offered to trusted apps as one extension capability, `claude.use("slop")`, replacing tools and grants.
- **Apps need a manifest, not adapter code.** Blocks becomes its upstream files plus a `slop.json` with `capabilities`. Pinup becomes its upstream files plus its slop-specific panels (Publish app, live preview), which talk to `claude.use("slop")`.

The plan has eight phases (section 14), each with an exit test. A **contract conformance suite**, browser pages that exercise every capability, is written first. It gates every phase and can be run against francois (a sibling project that already implements most of the contract) to prove the suite itself is right.

## 2. Orientation

### 2.1 The runtime contract in one page

The contract is defined by the claude.ai platform. Our references are four guides (in `~/Downloads`, dated 2026-10-10) and the platform's type definitions for runtime contract 0.2.92. Its shape:

- **Discovery.**
  - `window.claude` has exactly one member, `use(name)`.
  - `use()` resolves later, never during the page's first synchronous run, and resolves `null` for anything the view cannot run.
  - A resolved namespace is frozen and platform-owned.
  - Consent prompts appear on a capability's first *call*, never from `use()`.
- **The manifest.**
  - Pages are published with `capabilities: {name: config}`, for example `{"db": {"rules": [...]}, "user": {"scopes": ["profile"]}, "room": {"topics": {"ops": "interact"}}}`.
  - A capability the manifest does not declare resolves `null`, except `user`, which a page can always ask for, and `permissions`, which is built in.
- **Access levels.**
  - People hold one of four levels on an artifact: `view` < `interact` < `admin` < `owner`.
  - Rules in the manifest set the minimum level to read or write a db path.
  - `room` topics are admin-only unless opened to `interact`.
- **Absence is normal.** Every capability can be missing; pages render without it and "light up" when it resolves.
- **Limits are part of the contract:**
  - db documents of 256 KiB and 32 levels deep; at most 25,000 per artifact;
  - db paths of at most 16 segments, 200 bytes per segment, 1,000 bytes in all;
  - room messages and presence of 4 KiB each;
  - assets of 20 MiB;
  - `sample` prompts of 256 KiB.

Section 4 lists each capability's API.

### 2.2 slop today

slop-computer (`slop`) is a Go server, a React admin SPA (the **Workshop**), and a CLI. The parts that matter here:

| Layer | What it is | Main code |
|---|---|---|
| Kernel | Artifacts (`kind` `page` or `data`), immutable versions of files in a content-addressed blob store, refs (`main`), projects, threads and comments, an event log | `pkg/store` (`artifacts.go`, `threads.go`, `events.go`), migrations `001`-`002` |
| Site | Routes map URLs on site hosts to page versions; data artifacts become records; pages read them through `window.slop` (`pkg/render/assets/runtime.js`, 22 lines) | `pkg/routing`, `pkg/records`, `pkg/server/serve.go`, `pkg/render` |
| Sandbox | Workshop previews and tools run on `s<label>.<sandbox domain>`, one label per *artifact version* (`pkg/store/sandbox.go:39-48`) | `pkg/server/serve.go:458-533` |
| Tools | A page version with a `tool` manifest section, enabled by an admin; the Workshop iframes it and posts a one-hour grant (`slg_…`); `tool.js` calls the API with it | `pkg/store/tools.go`, `pkg/server/tools.go`, `pkg/render/assets/tool.js`, `web/workshop/src/screens/ToolScreen.tsx` |
| Docs store | Live JSON documents per data artifact (`collection/id` paths), a docs stream, leases, presence | `pkg/store/docs.go`, `pkg/server/docs.go`, migration `006_docs` |
| Agents | API tokens, `slop` CLI, `slop comments wait` (blocks until someone comments) | `cmd/slop/cmds`, `pkg/server/stream.go` |

Users have one working role, `admin` (plus `pending` and `disabled`; `pkg/store/users.go:12-15`). Nearly every API route requires an admin; the exceptions are login, the device flow, `/api/config`, `/api/me` and help.

### 2.3 Why adapters are the wrong shape

1. **Each app reimplements the host.** Pinup's adapter builds snapshots, mirrors, presence, error mapping and a design picker (`00-slop-host.js:13-290`). Blocks would need the same plus nested paths, `where`, `snap.docs`, longer ids and room topics (SLOP-008 G1-G12).
2. **slop's primitives are not the contract's.**
   - The docs store has two-segment paths, no queries, no rules, and leases capped at one minute (`pkg/store/docs.go:20-46`). The contract has nested paths, ten-filter queries, per-path rules and ten-minute leases.
   - Tool grants model *slop API permissions*. The contract models *access levels on an artifact*.
3. **The sandbox origin changes with every version.** `SandboxLabel` hashes `(artifact, n)`. A new version gets a new origin, and the page's localStorage and IndexedDB start empty. The contract promises one origin per artifact whose storage "survives republishes".
4. **Some limits match, others don't.** Documents of 256 KiB and presence bodies of 4 KiB already match the contract. Leases (1 minute against 10), paths (2 segments of ≤ 128 characters against 16 segments of ≤ 200 bytes) and error codes don't:
   - where an error maps to the wrong code, the app silently changes behaviour. SLOP-008 G8: a 413 mapped to `invalid_argument` makes Blocks go read-only.

The fix is to make the contract slop's own baseline, implemented once, tested once, and shared by every app.

### 2.4 Terms

| Term | Meaning |
|---|---|
| **contract** | The claude.ai Artifact runtime API (`window.claude.use` and its capabilities), contract 0.2.92. |
| **capability** | One namespace returned by `use(name)`. |
| **manifest** | The `capabilities` section of a page version's `slop.json`. |
| **app** | A page artifact whose manifest declares capabilities: Blocks, Pinup, a Claude-written tracker. |
| **target** | The artifact whose state a view works on: its db, rooms, assets and comments. A self-contained app is its own target. A data artifact can name an app that runs it (a Blocks workspace, a Pinup design). Section 6.2. |
| **view** | One open page: one tab, one app version, one target, one user. It has a secret, an event stream and an RPC endpoint. |
| **level** | `view`, `interact`, `admin` or `owner`: a user's access to a target. |
| **shell** | The Workshop around the view's iframe. It holds the session, shows consent prompts, the comment composer and download confirmations. |
| **agent** | A coding agent using the `slop` CLI with a user token. It is Claude's side of the contract (ArtifactData). |
| **conformance suite** | Pages and a runner that check a host against the contract. |

## 3. Goals, non-goals, principles

**Goals**
1. Any contract-conforming page runs on slop without slop-specific code.
2. Blocks runs as its upstream files plus a manifest, and Pinup as its upstream files plus its slop panels.
3. One runtime, one transport, one set of limits and error codes, tested by a conformance suite.
4. Agents get Claude's side of the contract: read and write a target's db, appear in its room, and receive `sendToClaude`.

**Non-goals (for this ticket)**
- **Users beyond admins.** Levels are implemented, but every signed-in user is still an admin (16.2).
- **More than one server process.** Rooms and views stay in memory, as the broker already assumes (`pkg/events/broker.go:9`).
- **`files` and `mcp`.** They resolve `null` until there is a use for them (section 6.17).
- **Compatibility of any kind.** Old tables, routes, CLI commands and the Pinup adapter are deleted. Live Pinup designs on the cluster are lost; there are none of value yet.

**Principles**
- **Contract first.** Where the contract defines a behaviour, a limit or an error code, slop does exactly that. slop-only features go behind `claude.use("slop")`, never as extra members on contract namespaces.
- **One of each:** one page runtime, one view stream, one RPC endpoint, one rules engine, one place for limits.
- **The server enforces, the client is honest.** Rules, levels, limits and sender stamps are checked on the server. The client only mirrors.
- **Delete what the runtime replaces** in the same phase that replaces it.

## 4. The contract, per capability (reference)

The tables below are the API to implement. The Downloads guides and the type definitions are the authority; this is a working summary.

### 4.1 `db`: a realtime JSON document store per target

- **Paths.**
  - A *document* path has an even number of segments (`tasks/t1`, `boards/b1/columns/c2`); a *collection* path has an odd number.
  - Segment characters are letters, digits and `_ - . ~ : @ +`.
  - Up to 200 bytes per segment, 1,000 bytes and 16 segments per path.
  - A bad path throws `TypeError` synchronously in the page.
- **Private subtree.** `data/users/<id>/…` is private to that user, hidden even from the owner.
- **Documents.**
  - `get()` returns `{id, exists, data(), metadata: {fromCache, hasPendingWrites}}`.
  - `set(obj)` replaces; `update(obj)` deep-merges objects and replaces arrays, and rejects `invalid_argument` if the document is missing; `delete()` is idempotent.
  - `onSnapshot(next, error)`.
  - `acquire({holder, ttlMs 1 s–10 min (default 30 s), data})` → `{acquired}`.
  - `collection(path)` gives a subcollection.
- **Collections and queries.**
  - `doc(id?)`, `add(obj)`.
  - `where(field, op, value)`: at most 10, on top-level fields; ops `==` `!=` `<` `<=` `>` `>=` `in` `not-in` (≤ 30 values) `array-contains`.
  - `orderBy(field, dir)`: at most one; missing fields sort last; default order is by id.
  - `limit(1..1000)`, `get()`, `onSnapshot`.
  - A query snapshot has `docs`, `size`, `empty`, `docChanges()` (`added`/`modified`/`removed` with indexes).
- **Snapshot identity.** Snapshots are frozen. An unchanged document is the same object across deliveries.
- **Rules** (manifest `db.rules`, at most 64):
  - Each rule is `{path, read?, write?}`; the deeper rule wins, unset levels inherit, and write is never below read.
  - The root defaults to read `view`, write `interact`.
  - `{self}` as the last segment means "the viewer's own id".
  - A read the viewer may not make behaves like a missing document. A write the viewer may not make rejects `invalid_argument`.
- **Limits:** 256 KiB per body (a top-level object), 32 levels deep, 25,000 documents per target, 64 subscriptions per view.
- **Errors:** `invalid_argument`, `resource_exhausted`, `quota_exceeded`, `unavailable`, `revoked`, `not_granted`, `capability_disabled`, `capability_removed`.

### 4.2 `user`: who is viewing

- **Calls:**
  - `id()`, `name()`, `avatarUrl()`, `email()`, `me()`;
  - `isOwner()`, `canEdit()`;
  - `can("data.write" | "files.write" | "assets.write" | "people.add")` → `true`, `false` or `null`;
  - `profiles(ids)`: an entry for every id;
  - `search(q)`: at most 8 results.
- **`me()`** returns `{id, name, avatarUrl, color, email, isOwner, canEdit}` and is never `null`.
- **Scopes:**
  - `{user: {}}` gives `id()`;
  - `scopes: ["profile"]` adds names, avatars and `search`;
  - `["profile", "email"]` adds emails.
- **Reads never reject;** missing values are `""`, `null` or `false`.

### 4.3 `room`: everyone here now

- **Events.** `emit(topic, data ≤ 4 KiB)` and `on(topic, handler, onError)`. Topics match `^[a-z][a-z0-9_.-]{0,47}$`, at most 16 in a manifest. Nothing is stored or replayed.
- **Presence.**
  - `presence(patch)`: merge semantics, ≤ 4 KiB merged;
  - `peers()` is synchronous; `onPeers(handler)` delivers `{peers, joined, left, updated}`.
- **Named rooms.** `join(name)` returns the same API plus `leave()`, up to 16 rooms per page.
- **Connection.** `connected()`, `onConnection(handler)`.
- **Hand-off.** `sendToClaudeSession(data, {deliver})` and `canSendToClaudeSession()`.
- **Sender stamp.** The platform sets `peer`, `by` (the user id when the manifest declares `user`), `isMe`, `sameTab`, `kind` (`viewer` or `agent`) and `guest`. The page cannot forge them.
- **Who may send.** Event topics are admin-only unless the manifest opens them (`{"room": {"topics": {"ops": "interact"}}}`). Presence is open to all.
- **Rate.** Emits and presence share about 40 per second, with bursts of 80.

### 4.4 `comments`: the shared threads

- **Forms.** `{"comments": {"composer_only": true}}` grants `openComposer({element}|{range})` and `anchorFor(el)`. `{"comments": {}}` adds `create`, `reply`, `resolve`, `delete`, `sendToClaude` and `canSendToClaude`.
- **Write-only.** The shell renders the threads; there is no list call.
- **Text.** Plain text, at most 4 KiB.
- **Extensions:** `customAnchors` (for canvas-like pages) and `onSendToClaude` (the page tries the request itself first).

### 4.5 `assets`: files people add

- **Calls.**
  - `upload(blob, {type})` → `{id, url, sizeBytes, contentType}`;
  - `list()` → `{assets, usage}`;
  - `delete(idOrUrl)` → `{deleted}`.
- **Serving.** A stored id is served at `/_blob/<id>` on the artifact's origin.
- **Types and sizes.** Exact types only:
  - images, video, PDF, fonts and data up to 20 MiB;
  - CSS and JS up to 16 MiB;
  - SVG up to 2 MiB, sanitized.
- **Who.** Writers only.

### 4.6 `downloads` and `files`

- **`downloads.save({filename, data})`** saves only after the viewer confirms. Extensions come from an allowlist, and every save shows a prompt.
- **`files`** reads a Claude Code project's files: `list`, ranged `read`, `download`, `asSampleTools`.

### 4.7 `artifact`: the page is the record

- **`publish(html)`** saves a complete document as the next version, compare-and-set against the loaded version. Every open view reloads.
- **`publish(files)`** changes only the named files (with `ifMatch`). Other views reload; this one keeps running.
- **Errors:** `conflict`, `not_writer`, `too_large`, `invalid_content`, `rate_limited`.

### 4.8 `sample`: Claude on the viewer's account

- **Calls.**
  - `sample(input, opts)` → `{text, truncated, modelTierApplied, modelApplied?}`;
  - `sample.json(input, opts)`;
  - `sample.limits()`.
- **`input`** is a string, or `[{role, content}]` turns that start and end on `user`. There is no system prompt. The prompt is at most 256 KiB.
- **Options:**
  - `onText({text, delta})` (`text` is the whole answer so far) and `signal`;
  - `modelTier` (`quick` | `default` | `complex`), `model`, `effort`;
  - `cache` (5 minutes, per viewer), `images`;
  - `tools`: page functions with `{name, description, inputSchema, execute(input, {signal})}`. Each returns ≤ 32 KB, and a round is cancelled after 150 s.
- **Errors:** `cancelled`, `invalid_request`, `prompt_too_large`, `not_granted`, `rate_limited`, `refused`, `empty_completion`, `invalid_json`, `upstream_error`, and others.

### 4.9 `permissions` (built in)

- **`state(name?)`** reads consent without prompting.
- **`request(names?)`** asks at most once, in one dialog.
- **`manage()`** opens the shell's permissions panel.
- **A denial is final** for the page load.

## 5. Current state: the verdict on every part

| Part | Files | Verdict | Why |
|---|---|---|---|
| Auth, sessions, users, tokens, device flow, OIDC | `pkg/identity`, `pkg/store/{users,sessions,tokens,device}.go`, `pkg/server/{auth,device,users,local}.go` | **Keep** | Views authenticate through them |
| Artifacts, versions, refs, projects, blobs | `pkg/store/{artifacts,projects}.go`, `pkg/blobs` | **Keep**; rename `artifacts.viewer` → `app` | A target names its app |
| Routes, routing, records, site index, `window.slop` | `pkg/routing`, `pkg/records`, `pkg/server/{serve,siteindex}.go`, `pkg/render/assets/runtime.js` | **Keep** | The public site is a separate, read-only layer (D9) |
| Threads, comments, `comments wait`, events log, broker | `pkg/store/{threads,events}.go`, `pkg/server/stream.go`, `pkg/events` | **Keep** | The `comments` capability and agent hand-off build on them |
| Sandbox labels per version | `pkg/store/sandbox.go`, migration `003` (`sandbox_labels`), `pkg/server/preview.go` | **Rebuild** as one origin per target (D3) | Storage must survive versions |
| Render modes and boot | `pkg/render/render.go:18-24, 28-36, 57` | **Rebuild**: `ModeTool` → `ModeApp`; the boot gains the view | One runtime for apps |
| Tools and grants | `pkg/store/tools.go`, `pkg/server/tools.go`, migration `004` (`tools`, `tool_grants`), `pkg/render/assets/tool.js` | **Delete**; replaced by `claude.use("slop")` and approvals (D8) | Grants model API permissions, not access levels |
| Docs store, docs API, docs stream, presence hub | `pkg/store/docs.go`, `pkg/server/docs.go`, migration `006` (`docs`, `doc_heads`), `pkg/client/docs.go`, `cmd/slop/cmds/docs.go` | **Delete**; replaced by the runtime's db and rooms, and `slop db` | Not the contract |
| Pinup adapter | `web/pinup/slop/js/00-slop-host.js` | **Delete** | Pinup speaks the contract |
| Pinup's slop panels | `web/pinup/slop/js/95-slop-ui.js`, `96-slop-app.js`, `97-slop-preview.js` | **Keep**, call `claude.use("slop")` | slop-only features |
| Workshop tool screen | `web/workshop/src/screens/ToolScreen.tsx` | **Rebuild** as the app shell (`AppScreen`) | Views, consent, downloads, composer |
| Pinup help topic | `pkg/doc/topics/pinup.md` | **Rewrite** around `slop db` | Agents use the contract's data side |

**What we reuse from francois** (`~/code/wesen/go-go-golems/francois`, read-only):
- **The page side, about 1,630 lines of TypeScript:**
  - `ui/src/runtime.ts` (828): the capability table, `sample` with page tools, `user`, `comments`, assets, `artifact`;
  - `runtime-db.ts` (404): refs, queries, snapshots, pending writes;
  - `runtime-rooms.ts` (172), `runtime-files.ts` (141), `runtime-images.ts` (89).
- **The server's query semantics:** `pkg/store/documents.go` (341): path validation `:38`, merge `:64`, query validation `:112`, `Apply` `:142`, depth `:184`, `matches` `:277`, `Acquire` `:313`.
- **The tool round trip for `sample`:** `pkg/host/routes.go:187-228`.

**What we do not reuse:**
- **francois's live queries.** On any write it broadcasts `db_changed` (`pkg/host/rpc.go:113`), and every subscription re-runs its query over RPC (`ui/src/runtime-db.ts:263-268`). For Blocks' `chunks` collection, hundreds of 50-150 KB documents, that re-downloads the log on every flush from every tab.
- **francois's server model.** It is a single-owner, loopback service with one port per artifact and no tokens.

## 6. Target architecture

### 6.1 The picture

```text
 Workshop (main host, session cookie)                      slop server
┌───────────────────────────────────────────┐            ┌────────────────────────────────────────────────┐
│ AppScreen  /run/<target>                   │  POST      │ pkg/rt                                          │
│  1. POST /api/rt/views ────────────────────┼──────────▶│   views      view registry, secrets, levels      │
│  2. iframe src = https://s<hmac(target)>…  │            │   db         rt_docs, rules, leases, rev log,    │
│        /v/<n>/                             │            │              queries, diffs                     │
│  3. postMessage {view, secret} ──┐         │            │   room       rooms, presence, topics (memory)    │
│  consent · composer · downloads  │         │            │   assets     rt_assets over pkg/blobs            │
└──────────────────────────────────┼─────────┘            │   comments   → threads/comments (kernel)         │
                                   ▼                       │   publish    → versions (kernel)                │
 app page on its target's origin                           │   sample     provider, tools round trip, queue   │
┌───────────────────────────────────────────┐  RPC        │   slop       existing /api/* with view permissions│
│ /_slop/claude.js                           │──────────▶│                                                │
│   window.claude.use(name) → capability     │◀── SSE ────│   one stream per view: doc, room, peers, reload, │
│   mirrors, pending writes, diffs           │  (view)    │   sample, tool_use                               │
│ upstream app files (Blocks, Pinup, …)      │            └────────────────────────────────────────────────┘
└───────────────────────────────────────────┘                     ▲
                                                                   │ user token (no view)
 coding agent ── slop db / slop room / slop comments wait ─────────┘ /api/rt/targets/<t>/…
```

### 6.2 Apps and targets

A view always has an **app** (the page that runs) and a **target** (whose state it uses).

- **A self-contained app** (a Claude-written tracker, a CC5 desktop) is its own target. Its db belongs to the page artifact, exactly as on claude.ai.
- **A data artifact can name the app that runs it.** This is the renamed `artifacts.viewer` column, now `app`.
  - A Blocks workspace `ws-team` has `app = blocks`.
  - A Pinup design `design-pace-club` has `app = pinup`.
  - The view runs the app's approved version against the workspace's db.
- **A target has exactly one app.** So the target fixes the app, the origin and the rules: the rules come from the app's manifest (D2). An agent's call on `ws-team` resolves rules through `ws-team.app = blocks`.

This keeps "one Blocks build, many workspaces" and "one Pinup, many designs". It needs no picker and no `?file=` argument inside the app: the Workshop chooses the target before the page loads.

### 6.3 Origins and URLs

- **One origin per target.** It is `s` + 20 hex digits of `HMAC(server key, target)` on the sandbox domain. Table `rt_origins(label, target_id)` replaces `sandbox_labels`.
  - localStorage, IndexedDB and `/_blob/` URLs survive new versions.
  - Two targets never share storage.
- **The version is in the path:** `https://s<label>.<sbx>/v/<n>/` serves the app's version `n`.
  - `index.html` gets the boot injected.
  - Sibling files resolve under `/v/<n>/` (Blocks' nine scripts).
  - A Workshop preview of a site page version uses the same scheme, with the page as its own target.
- **Fixed paths on every target origin:**
  - `/_slop/claude.js` (the runtime) and `/_slop/runtime.js` (site data, unchanged);
  - `/_blob/<id>` (the target's assets).
- **Header.** `frame-ancestors` allows only the main host's origins, as today (`pkg/server/serve.go:200`).

### 6.4 The manifest

`slop.json` keeps its current fields (`title`, `kind`, `reads`, …). It gains `capabilities` in the contract's own shape, and slop's extension capability:

```json
{
  "title": "Claude Blocks", "kind": "page",
  "capabilities": {
    "db": { "rules": [] },
    "user": { "scopes": ["profile"] },
    "room": { "topics": { "ops": "interact" } },
    "assets": {}, "downloads": true, "sample": { "images": true }
  }
}
```

```json
{
  "title": "Pinup", "kind": "page",
  "capabilities": {
    "db": {}, "user": { "scopes": ["profile"] }, "room": {}, "downloads": true,
    "slop": { "permissions": ["artifacts:read", "versions:read", "versions:push", "routes:read", "routes:write"] }
  }
}
```

- **Parsing.** `pkg/rt/manifest.go` parses the manifest and refuses an invalid one when the version is pushed (`POST /api/artifacts/{id}/versions` → 400):
  - unknown capability names;
  - more than 64 rules, or a `{self}` rule whose prefix rule lacks a `read` or `write`;
  - bad topic names, or more than 16 topics;
  - unknown `slop` permissions.
- **Approval.** `slop` permissions need an admin's approval per version (D8). Everything else is contract and needs none: levels and consent govern it.

### 6.5 Views and authentication

Opening an app in the Workshop:

```text
AppScreen(target, version?):
  POST /api/rt/views {target, version?}            (session cookie, CSRF)
    server: t := artifact(target); app := t.app or t
            v := version or app's approved version (or main when the manifest needs no approval)
            level := levelOf(me, t)   (admin → "admin", t.created_by == me → "owner"; pending/disabled → refuse)
            caps := manifest(app@v).capabilities ∩ what this view may run
            view := {id: "v_…", secret: random, target, app, v, user, level, caps, perms: approved slop permissions}
    ← {view, secret, url: https://s<label>.<sbx>/v/<v>/, caps, expiresAt}
  iframe.src = url
  on iframe "hello" → postMessage({type: "view", view, secret, expiresAt}, origin)
  every 45 min → POST /api/rt/views/{view}/renew → postMessage({type: "view", …})
```

- **The secret** never appears in a URL. It reaches the page by `postMessage`, checked against `e.origin` and `e.source`, as `tool.js` does today (`pkg/render/assets/tool.js:28-35`).
- **Every call** carries `Authorization: Bearer <secret>` with `credentials: omit`.
- **A view lives** while its stream is connected and the secret is valid. The registry drops a view that never connects within 15 s, as francois does (`routes.go:120-134`).
- **Agents use user tokens** on `/api/rt/targets/<t>/…` (6.19). An agent can also open a view (`kind: agent`) to join rooms.

### 6.6 Transport: one stream and one RPC endpoint per view

```text
GET  /api/rt/views/{v}/events?after=<rev>   SSE, fetch-based (headers), id: = target rev for db events
     event: hello      {view, level, caps, me, rev}
     event: doc        {rev, path, version, body | patch+base | null}       (subscribed collections and docs only, rules-filtered)
     event: peers      {room, peers, joined, left, updated}
     event: room       {room, topic, data, peer, by, isMe, sameTab, kind, guest}
     event: reload     {version}                                           (artifact.publish, or a new approved version)
     event: sample     {call, text, delta}  ·  event: tool_use {call, use, tool, input}  ·  event: sample_end {call, result | error}
     event: revoked    {}                                                  (level dropped, view closed)
POST /api/rt/views/{v}/rpc   {method, args}  →  {result} | {error: {code, message}}
```

**Resume.** db events carry the target's revision. After a reconnect the runtime passes `after=<last rev>`, and the server replays the changes since then in the view's subscriptions from `rt_docs`. These are the same mechanics as the docs stream after PR #3:
- revisions commit in order (the head-row lock is taken first);
- the stream only increases;
- a gap triggers a catch-up from the table.

Room events are not replayed, matching the contract.

### 6.7 `db` on the server

**Storage** (migration `007_runtime`, which also drops `docs`, `doc_heads`, `tools`, `tool_grants` and `sandbox_labels`):

```sql
ALTER TABLE artifacts RENAME COLUMN viewer TO app;

CREATE TABLE rt_heads  (target_id text PRIMARY KEY REFERENCES artifacts(id), rev bigint NOT NULL);
CREATE TABLE rt_docs (
  target_id  text NOT NULL REFERENCES artifacts(id),
  path       text NOT NULL,            -- full document path: data/users/usr_1/blocks
  coll       text NOT NULL,            -- its collection:     data/users/usr_1
  body       jsonb,                    -- NULL: a tombstone (kept 7 days for catch-up)
  version    bigint NOT NULL,          -- per document, for diffs and agents' if_version
  rev        bigint NOT NULL,          -- per target, orders every change
  size       integer NOT NULL,
  updated_by text, updated_at timestamptz NOT NULL,
  PRIMARY KEY (target_id, path));
CREATE INDEX rt_docs_coll ON rt_docs (target_id, coll);
CREATE INDEX rt_docs_rev  ON rt_docs (target_id, rev);
CREATE TABLE rt_leases (target_id text, path text, holder text NOT NULL, until timestamptz NOT NULL, data jsonb,
                        PRIMARY KEY (target_id, path));
CREATE TABLE rt_assets (id text PRIMARY KEY, target_id text NOT NULL REFERENCES artifacts(id), sha256 text NOT NULL,
                        content_type text NOT NULL, size bigint NOT NULL, created_by text, created_at timestamptz NOT NULL);
CREATE TABLE rt_origins (label text PRIMARY KEY, target_id text NOT NULL UNIQUE REFERENCES artifacts(id));
CREATE TABLE rt_approvals (app_id text, version integer, permissions text NOT NULL, approved_by text, approved_at timestamptz,
                           PRIMARY KEY (app_id, version));
CREATE TABLE rt_consents (user_id text, app_id text, capability text, state text NOT NULL, at timestamptz,
                          PRIMARY KEY (user_id, app_id, capability));
```

SQLite gets the same tables, with `body text`.

**Writes**, in one transaction:

```text
write(view|agent, path, op, body|patch, base?):
  validate path (document parity, grammar, sizes), body (object, ≤ 256 KiB, depth ≤ 32)
  lvl := level of the writer; need := rules.write(path, writer)          // {self} resolves to writer.user
  if lvl < need → invalid_argument
  tx:
    rev := nextRev(target)                    // upsert rt_heads: row lock FIRST (lock order from PR #3)
    cur := SELECT … FOR UPDATE rt_docs (target, path)
    switch op:
      set:    new := body
      update: if cur missing/tombstone → invalid_argument; new := merge(cur, body)   // objects merge, arrays replace
      patch:  if cur.version != base → conflict_base (client resends full); new := apply(cur, patch)
      delete: if cur missing → ok (idempotent, no rev); new := NULL
    count/size quota (25,000 docs) → quota_exceeded
    upsert rt_docs (body=new, version=cur.version+1, rev, size, by, at)
  publish doc event {target, rev, path, version, body | patch (vs cur.version) | null}
```

**Queries and subscriptions:**

```text
query(viewer, coll, filters, order, limit):           // contract semantics; port francois documents.go Apply/matches/compare
  rows := SELECT path, body, version FROM rt_docs WHERE target=? AND coll=? AND body IS NOT NULL
  keep rows the viewer may read (rules.read)          // hidden == missing
  apply filters, order (missing last, then id), limit
subscribe(view, {kind: doc|coll, path, filters?}):    // ≤ 64 per view
  register (view, path, filters); return the current matching docs WITHOUT limit (the client applies the limit)
on doc event: for each view with a subscription covering path (doc == path, or coll == parent(path)),
  if view may read path → send once per view
```

- **The client evaluates queries.** It applies `where`, `orderBy` and `limit` to its mirror (D5). The server sends each changed document once per view, not once per subscription. The initial load is the filtered set without the limit, so a document entering a limited window is already in the mirror. Collections are modest by contract ("hundreds or low thousands"), so this is bounded.
- **Leases.** `acquire` upserts `rt_leases` where `until < now` or `holder = me`; TTL 1 s–10 min.
- **Rules.** A rule set compiles to a sorted list of path patterns. `read(path, user)` and `write(path, user)` walk the deepest matching rule, with `{self}` matching `user.id`. The defaults are read `view`, write `interact`, and `data/users/{self}` read and write `interact` with everyone else hidden. Table-driven tests use the guide's examples verbatim.

### 6.8 Diff sync (documents that grow)

Apps like Blocks rewrite one growing document again and again (`chunks/<id>`, up to 500 ops). Sending the whole body each time is quadratic in bytes, both upstream and to every other view (SLOP-008 D3). The runtime sends differences.

```text
patch := diff(old, new):          objects: per key  {k: patch | {"$set": v} | {"$del": true}}
                                  arrays:  common prefix p, common suffix s → {"$splice": [p, deleteCount, ...items]}
                                  scalars / type change: {"$set": v}
client write: if the mirror holds (version, body) for path and len(patch) < len(body)/4
                → rpc db.write {op: patch, base: version, patch}     else {op: set, body}
              on conflict_base → resend {op: set, body}
server event: {rev, path, version, base: version-1, patch} when the server computed one (≤ body/4), else full body
client apply: if mirror.version == base → apply patch; else db.get(path) (rare: a view that missed a version)
```

**Property test:** `apply(old, diff(old, new)) == new` for random JSON pairs, and `size(diff)` is small for append-only arrays.

Diffs are invisible to pages. They are a transport detail of the runtime and the server.

### 6.9 `room`

- **The hub** is in memory, per target: rooms are a name mapped to a set of views (the lobby is `""`). Each view in each room has a presence object.
- **`presence(patch)`** merges and validates the result (≤ 4 KiB, depth ≤ 8). It sends `peers` with `updated` to the room, coalesced to at most 30 per second.
- **`emit(topic, data)`:**
  - validates the topic name and 4 KiB size;
  - checks the topic level from the manifest (admin by default; `interact` when opened);
  - rate-limits 40 per second per view, burst 80;
  - fans out to the room's views with the stamp `{peer: view label, by: user id if the manifest declares user, isMe, sameTab, kind, guest: false}`.
- **Joining and leaving.** `join` and `leave` cover up to 16 rooms per view. A view's stream closing removes it from every room and sends `left`.
- **Agents** with an agent view are peers of `kind: "agent"`.
- **`sendToClaudeSession(data)`** creates a thread on the target, marked `agent_request`, with `data` as JSON. `canSendToClaudeSession()` returns `available` when at least one agent waits on the target or its project, else `off`.

### 6.10 `user`

- **Levels.** Today: `admin` for every admin, and `owner` when `artifacts.created_by` is the user.
- **`id()`** is the slop user id.
- **`profiles` and `search`** come from the users table (display name, initials avatar `/_slop/avatar/<id>.svg`, colour = a hue hashed from the id).
- **`email`** only with the `email` scope.
- **`can(name)`:**
  - `data.write`: the rules' root write level ≤ the user's level;
  - `assets.write` and `files.write`: `admin` or above;
  - `people.add`: `false`.

### 6.11 `assets`

- **`POST /api/rt/views/{v}/assets`** takes a raw body with a `Content-Type`. It:
  - checks the type allowlist and size;
  - stores the blob (`pkg/blobs`) and inserts `rt_assets` with an id `a_<random>`;
  - returns `{id, url: "/_blob/" + id, sizeBytes, contentType}`.
- **`GET /_blob/{id}`** on the target's origin serves the blob with `Content-Type` and `X-Content-Type-Options: nosniff`. Data files are served as bytes, never rendered.
- **SVG** is refused (`unsupported_type`) until a sanitizer exists (16.2).

### 6.12 `comments`

- **The verbs map onto the existing tables:**
  - `create({anchor, text})` → `CreateThread(target, app version, anchor, text, user)` (`pkg/store/threads.go:115`);
  - `reply` → a comment; `resolve`, `delete`.
- **`sendToClaude`** creates or replies with `agent_request = true`. `slop comments wait` already wakes on new comments; it shows the flag.
- **`openComposer`** posts `{type: "compose", anchor}` to the shell; the Workshop composer writes the thread.
- **Consent.** The full form asks on its first write (`rt_consents`).
- **Later:** `customAnchors` and `onSendToClaude` resolve absent at first.

### 6.13 `downloads`

`save({filename, data})`:
- the runtime checks the extension against the contract's allowlist;
- it transfers the bytes to the shell with `postMessage` (a Blob);
- the shell shows name and size and, on accept, saves from the main window.

The result is `saved`, `declined` or `rate_limited`, the last when a prompt is already open.

### 6.14 `artifact.publish`

**`publish(html)`** (only when the target is the app itself):
- compare-and-set against the view's version;
- push a new version with the one file `index.html`, keeping the other files, and move `main`;
- send `reload` to every view of the target.

**`publish(files)`** pushes a new version of the target (a self-contained app, or a data artifact) with the named files changed. Each `ifMatch` sha must match. Other views reload.

**Errors:** `conflict`, `not_writer` (below `admin`), `too_large`, `invalid_content`.

### 6.15 `sample`

```text
POST /api/rt/views/{v}/sample  {input, modelTier, model?, effort?, images?, tools?: [{name, description, inputSchema}]}
  → SSE: sample {text, delta} … tool_use {use, tool, input} … sample_end {result | error}
POST /api/rt/views/{v}/sample/{call}/tools/{use}   {value | error}      (≤ 32 KB; 150 s per round)
POST /api/rt/views/{v}/sample/{call}/cancel
```

- **The provider** is an interface in `pkg/rt/sample`. The first implementation calls the Anthropic Messages API with a key held server-side (Vault on the cluster, an environment variable locally).
- **Tiers** map to models in configuration: `quick` → `claude-haiku-5-5`, `default` → `claude-sonnet-5-5`, `complex` → `claude-opus-5-5`.
- **Page tools** go out to the provider as tool definitions. A `tool_use` pauses the stream until the page posts the result, as in francois (`routes.go:200-228`).
- **Client-side parts:** the cache (5 minutes, per viewer, in memory), `sample.json` parsing (whole reply, then a fenced block, then the outermost `{…}`/`[…]`), and image downscaling (port `runtime-images.ts`).
- **Server-side limits:** two active and four queued calls per user, then `rate_limited`; a daily token budget per user, then `rate_limited`; one audit row per call.
- **Consent:** the first call asks; a denial gives `not_granted` for that load.

### 6.16 `slop`: the extension capability (replaces tools)

`claude.use("slop")` returns today's tool API, unchanged in shape:
- `get`, `put`, `post`, `del`, `stream`, `beacon`, `can(perm)`;
- `user`, `people`, `args`, `setArgs`.

The view secret is accepted as a bearer token on the existing `/api/*` routes. `guardPerm` checks the view's approved `slop` permissions where it checks grants today (`pkg/server/auth.go:118-120`).

**Approval** is per app version (`rt_approvals`). The Workshop's "Apps" menu lists apps whose manifest declares `slop`, with *Approve vN…*, which is the current "Update to vN…" dialog. An unapproved version opens with `slop` resolving `null`; the other capabilities still work.

### 6.17 `files` and `mcp`

Both resolve `null` in this ticket. Notes for later:
- **`files`** could read an artifact's version files, or a configured project root as francois does (`--project-root`).
- **`mcp`** needs connector configuration and per-user credentials on the server.

Blocks hides its browser feature when `mcp` is `null`.

### 6.18 The public site and players

Site pages (`ModeSite`) stay outside the runtime: `window.slop` route and record data, as today. The contract agrees: published artifacts served top-level have no runtime ("`use()` resolves `null` for now").

The one exception is **players**: a route that shows an app read-only against a saved version of a target, Pinup's prototype player being the example.

- **`claude.js` static mode.** `db` is read-only and holds the documents saved in the target's version file `db.json` (`{path: body}`).
  - `user` is a viewer with no id; `can` is `false`.
  - Everything else is `null`.
- **The route** binds `--bind target=<data artifact>`.

Pinup's player then works without its `slopStaticDb`. *Save version* writes `db.json` alongside the files it writes today.

### 6.19 Claude's side: agents

**`slop db`**, with the same verbs as Claude's ArtifactData tool:

```text
slop db get     <target> <path>
slop db list    <target> <collection> [--limit N] [--cursor C]
slop db query   <target> <collection> --where 'field op json' … [--order field[:desc]] [--limit N]
slop db set     <target> <path> --data '{…}' | --file f.json [--if-version N]
slop db update  <target> <path> --data '{…}' [--if-version N]        ("__delete__": true removes a field)
slop db str-replace <target> <path> <field> --old … --new …
slop db delete  <target> <path> [--if-version N]
slop db batch   <target> ops.json                                      (≤ 50 writes)
  data/users/me → the token's user; --as-level view|interact|admin to test rules
```

- **Agent routes** under `/api/rt/targets/{t}/db/…` call the same store functions as views, with the token's user and level. Writes publish the same doc events, so open views update live.
- **`slop room watch <target> [--presence '{…}']`** opens an agent view: the agent is a room peer and prints events. `slop room emit <target> <topic> <json>`.
- **Hand-off** works through threads: `sendToClaude` and `sendToClaudeSession` create agent-request threads, and `slop comments wait` returns them.

**With this, Blocks' "README for Claude" works verbatim from a coding agent.** Its two calls become `slop db get ws-team data/users/me/blocks` and `slop db set ws-team data/users/me/blocks/turns/<next> --data '{"text": "…"}'`.

## 7. Decision records

### D1: implement the contract natively; delete the adapters

- **Context:** two apps, two adapters, and twelve gaps for the second (SLOP-008).
- **Options considered:** (a) keep per-app adapters over slop primitives; (b) implement the contract as slop's runtime.
- **Decision:** (b).
- **Consequences:**
  - Apps need no slop code; slop-only features move behind `claude.use("slop")`.
  - The docs store, tools, grants and Pinup's adapter are deleted.
  - Live Pinup designs are lost.
- **Status:** proposed.

### D2: a target has exactly one app, and the app's manifest supplies the rules

- **Context:** The contract ties db, room and rules to one artifact. slop wants one app build serving many data artifacts.
- **Options considered:**
  - (a) one db per app page, a copy of the app per workspace;
  - (b) any page may open any data artifact;
  - (c) data artifacts name their app (`artifacts.app`), and a view is (app, target).
- **Decision:** (c).
- **Rationale:** it keeps the contract's "one artifact, one db, one rule set" and needs no app code.
- **Consequences:**
  - Opening a target with another app is refused.
  - Changing a target's app is an admin action that keeps the db.
- **Status:** proposed.

### D3: one origin per target; the version in the path

- **Context:** storage must survive versions, and assets resolve at `/_blob/` on the page's origin.
- **Decision:** the label is `HMAC(target)`, and pages are served at `/v/<n>/`.
- **Consequences:**
  - Pages must use relative URLs for their own files, which upstream Blocks does.
  - Workshop previews move to the same scheme.
- **Status:** proposed.

### D4: one fetch-based SSE stream and one RPC endpoint per view

- **Context:** the docs stream, the kernel stream and tool calls are separate today.
- **Decision:** one stream per view carries everything live; one RPC endpoint carries every call.
  - Uploads and `sample` get their own endpoints, for raw bodies and streams.
  - Fetch-based SSE is used so the stream can carry an `Authorization` header (`tool.js` does this today).
- **Status:** proposed.

### D5: mirrors, not re-queries

- **Context:** francois re-runs every subscribed query on any write (5 above).
- **Decision:**
  - The server pushes each changed, readable document once per view whose subscriptions cover it.
  - The runtime keeps a mirror per subscription and evaluates queries locally.
  - The initial load is the filtered set without the limit.
- **Consequences:**
  - Correct windows under `limit`; cost proportional to changes.
  - Collection sizes must stay modest, which the contract already requires.
- **Status:** proposed.

### D6: diff sync below the API

- **Context:** growing documents (Blocks' chunks) make whole-body writes quadratic.
- **Decision:** a base-versioned JSON diff, in both directions, invisible to pages (6.8).
- **Consequences:**
  - Needs a per-document `version`, which agents also need for `if_version`.
  - Property tests.
- **Status:** proposed.

### D7: limits and error codes are the contract's

- **Decision:**
  - The contract's numbers live in one Go file and one TypeScript file, with a test that compares the two.
  - Every rejection uses a contract code.
- **Consequences:** the SLOP-008 G8 and G9 class of mismatch disappears.
- **Status:** proposed.

### D8: tools become the `slop` capability with per-version approval

- **Context:** a tool is a page that needs slop's management API.
- **Decision:**
  - A manifest's `capabilities.slop.permissions`, approved per version, replaces the `tool` section, `tools`, `tool_grants` and `tool.js`.
  - The view secret is the bearer.
- **Status:** proposed.

### D9: the public site stays a separate, read-only layer

- **Decision:**
  - `window.slop` and records serve public pages.
  - The runtime runs only in Workshop views, plus a static read-only mode for players.
- **Rationale:** the contract gives top-level pages no runtime, and public visitors have no identity.
- **Status:** proposed.

### D10: port francois's page runtime, write the server new

- **Decision:**
  - Start `web/runtime` from francois's `ui/src/runtime*.ts`, replacing its db subscription model (D5), adding diffs (D6) and the `slop` capability.
  - Write `pkg/rt` new, porting francois's query semantics and tool round trip.
- **Rationale:** francois's server is single-owner and loopback.
- **Status:** proposed.

### D11: migrations stay append-only; data loss is limited to the replaced tables

- **Decision:**
  - Migration `007_runtime` drops `docs`, `doc_heads`, `tools`, `tool_grants` and `sandbox_labels`, and renames `artifacts.viewer`.
  - Artifacts, versions, routes, threads and users, the francois data on the cluster, are untouched.
- **Status:** proposed.

## 8. Server layout and API reference

```text
pkg/rt/
  manifest.go      Manifest, Capabilities, Rule; Parse(slop.json) with every contract check
  limits.go        the contract's numbers (one place)
  paths.go         ValidDocPath, ValidCollPath, parent, segments
  levels.go        Level (view < interact < admin < owner), LevelOf(user, target)
  rules.go         Compile(rules) → Rules; Read(path, user) / Write(path, user) → Level
  query.go         Filter, Query, Validate, Match, Order (port francois documents.go)
  diff.go          Diff(a, b) → Patch; Apply(a, Patch) → b
  db.go            Get, Query, Write(set|update|patch|delete), Acquire; doc events
  views.go         View, Registry (open, renew, close, lookup by secret)
  stream.go        GET /api/rt/views/{v}/events
  rpc.go           POST /api/rt/views/{v}/rpc: method table
  room.go          Hub: rooms, presence, topics, rate limits
  user.go          profiles, search, avatars
  assets.go        upload, list, delete, /_blob/{id}
  comments.go      → store threads
  publish.go       artifact.publish → store versions
  consent.go       permissions state/request
  agent.go         /api/rt/targets/{t}/… for tokens
  sample/          provider.go, anthropic.go, queue.go, budget.go
pkg/store/rt_*.go  SQL for rt_docs, rt_heads, rt_leases, rt_assets, rt_origins, rt_approvals, rt_consents
```

**Routes** (all new, under `pkg/rt`, registered by `pkg/server`):

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/rt/views` | session (admin) | open a view: `{target, version?}` → `{view, secret, url, caps, expiresAt}` |
| `POST /api/rt/views/{v}/renew` | session | a new secret expiry |
| `GET /api/rt/views/{v}/events?after=` | view secret | the view stream (6.6) |
| `POST /api/rt/views/{v}/rpc` | view secret | every capability call (below) |
| `POST /api/rt/views/{v}/assets` | view secret | upload a raw body |
| `POST /api/rt/views/{v}/sample` | view secret | start a call (SSE) |
| `POST /api/rt/views/{v}/sample/{call}/tools/{use}` | view secret | a page tool's result |
| `POST /api/rt/views/{v}/sample/{call}/cancel` | view secret | stop |
| `GET /_blob/{id}` | target origin | an asset of that target |
| `GET /v/{n}/{path...}` | target origin | the app's version files, with the boot injected into `index.html` |
| `GET /api/rt/targets/{t}/db/{path...}`, `PUT`, `PATCH`, `DELETE` | token | agent document calls |
| `POST /api/rt/targets/{t}/db:query`, `db:batch`, `db:list` | token | agent queries and batches |
| `POST /api/rt/targets/{t}/views` | token | an agent view (room peer) |
| `GET/POST /api/apps`, `POST /api/apps/{id}/approve` | session (admin) | list apps and approve a version's `slop` permissions |

**RPC methods:**

```text
db.get {path}                     db.query {coll, filters, order, limit}
db.write {path, op, body|patch, base?}                db.acquire {path, holder, ttlMs, data?}
db.subscribe {sub, path, kind, filters?} → docs       db.unsubscribe {sub}
room.presence {room, patch}   room.emit {room, topic, data}   room.join {room}   room.leave {room}
user.profiles {ids}           user.search {q}
comments.create {anchor, text}  comments.reply {thread, text}  comments.resolve {thread, resolved}
comments.delete {thread}        comments.sendToClaude {anchor|thread, text}
room.sendToClaudeSession {data, label?, deliver}
artifact.publish {html | files, base}
assets.list {}                  assets.delete {id}
permissions.state {names?}      permissions.request {names?}
```

**Deleted routes:** `/api/docs/*`, `/api/presence/*`, `/api/tools*`, `/api/sandbox-url` (the Workshop computes app URLs from views), `GET /tools/{rest...}`.

## 9. The page runtime: `web/runtime`

```text
web/runtime/
  package.json, tsconfig.json, build.mjs     esbuild → pkg/render/assets/claude.js (one IIFE, embedded)
  src/index.ts        boot (#slop-boot), install window.claude (frozen, use() only), capability table from boot.caps
  src/transport.ts    secret handshake (postMessage), fetch-SSE with resume (after=rev), rpc(), backoff, connection state
  src/limits.ts       the contract's numbers (D7)
  src/errors.ts       {code, message} rejections; contract codes only
  src/db/paths.ts     grammar; TypeError on bad paths
  src/db/refs.ts      DocumentReference, CollectionReference, Query builders (pure)
  src/db/mirror.ts    per-subscription mirrors, query eval, frozen snapshots with stable identity, docChanges
  src/db/pending.ts   optimistic overlay, hasPendingWrites, one write at a time per doc
  src/db/diff.ts      diff/apply (the same algorithm as pkg/rt/diff.go; shared test vectors)
  src/user.ts  room.ts  comments.ts  assets.ts  downloads.ts  artifact.ts  permissions.ts  slop.ts
  src/sample/         sample.ts (calls, tools, cache, json), images.ts
  src/static.ts       static mode (6.18)
  test/               vitest: paths, query eval, diff vectors, mirror identity
```

**Injection.** For app mode, `render.Inject` puts `<script id="slop-boot">` (view id, page, target, caps, mode `app`, parent origin) and `<script src="/_slop/claude.js">` right after `<head>`. The runtime is the first script the page runs; `use()` promises resolve after the secret arrives.

**Shell protocol** (postMessage between the iframe and the Workshop, origins checked):

```text
page → shell:  hello · compose {anchor} · download {filename, blob} · consent {names} · navigate {target}
shell → page:  view {view, secret, expiresAt} · download_result {status} · consent_result {states}
```

## 10. The Workshop as the shell

- **`AppScreen`** (`/run/<target>`) replaces `ToolScreen`. It:
  - opens the view and renews the secret;
  - hosts the iframe;
  - answers the shell protocol: a download dialog, a consent dialog, and the existing comment composer anchored to the posted anchor;
  - shows the target's threads in a side panel.
- **Artifacts screen:**
  - "Open" on any target with an app;
  - "New … with <app>" creates a data artifact with `app` set (a Blocks workspace, a Pinup design);
  - "Apps" lists pages whose manifest declares capabilities, with approvals for `slop` permissions.

## 11. Apps on the runtime

**Blocks** (`web/blocks`; SLOP-008 is rewritten on this baseline):
- **Contents:** the ten upstream files and a `slop.json` with the manifest from 6.4, with `"slop"` omitted. The build is a copy plus a sha-256 check.
- **What it uses:**
  - `db`: chunks, checkpoints, claims, leases; the chat view and turns in `data/users/<me>/…`, which is private and valid as written;
  - `user`, `room` (`ops` topic, presence), `downloads`, `assets`;
  - later `sample`.
- **Agents:** they work through `slop db` (6.19).
- **Left for Blocks itself:** the optional headless kernel (SLOP-008 phase 3).

**Pinup** (`web/pinup`):
- **Deleted:** `00-slop-host.js`.
- **Kept:**
  - Designs are data artifacts with `app = pinup`.
  - The Publish app, live preview and Save version panels (`95`-`97`) use `claude.use("slop")` for pushes and routes.
  - *Send to Claude* uses `room.sendToClaudeSession`, which upstream Pinup already calls (`web/pinup/src/09-collab.js:189`, `13-feedback.js:353`). The runtime turns it into an agent-request thread (6.9).
- **The player** is static mode (6.18).
- **Tests:** the browser test (`web/pinup/slop/tests/app.js`) moves its stubs from `window.slop.tool` to a fake runtime transport.

## 12. The delete list (exact)

```text
pkg/store/docs.go, pkg/store/docs_test.go
pkg/server/docs.go, pkg/server/docs_test.go               (incl. presenceHub, docEvents, agentPeer)
pkg/store/tools.go, pkg/server/tools.go (+ tests)          (ToolPermissions move to pkg/rt as slop permissions)
pkg/store/sandbox.go labels → pkg/store/rt_origins.go
pkg/server/preview.go sandboxURL
pkg/render/assets/tool.js; render.ModeTool
pkg/client/docs.go; cmd/slop/cmds/docs.go                  (→ slop db, slop room)
web/workshop/src/screens/ToolScreen.tsx                    (→ AppScreen)
web/pinup/slop/js/00-slop-host.js
pkg/doc/topics/pinup.md                                    (rewritten)
tables: docs, doc_heads, tools, tool_grants, sandbox_labels (migration 007)
```

## 13. What stays exactly as it is

- **Login and identity:** ZITADEL login, sessions, device flow and tokens.
- **The kernel:** artifacts, versions and blobs, projects, routes and route history, records and the site index, threads and `comments wait`, the kernel event stream.
- **The CLI:** push, pull, routes and site commands, and the francois import.
- **Pinup apps (SLOP-005 to 007):** they compile to site pages that read `window.slop`.

## 14. Implementation phases (working up)

Each phase ends with an exit test that must pass before the next phase starts.

1. **Conformance suite first.** `web/rt-conformance/` holds one page per capability that exercises the contract (calls, limits, error codes, absence) and reports results, plus a Playwright runner.
   - **Exit:** it passes against francois for db, user, room, downloads and assets, which proves the suite, and fails cleanly against slop.
2. **`pkg/rt` core, no HTTP.**
   - **Contents:** limits, paths, levels, rules, query, diff, db store functions, migration `007`.
   - **Exit:** Go tests on SQLite and Postgres:
     - rules tables from the guide;
     - query vectors ported from francois;
     - the diff property test;
     - concurrency, with lock order head then document and contiguous revisions.
3. **Views and the runtime's db and user.**
   - **Contents:** origins, `/v/<n>/`, views, stream, RPC, `claude.js` (`db`, `user`), `AppScreen`.
   - **Exit:** conformance passes for db and user, with two tabs on one target seeing each other's writes.
4. **Rooms and downloads; Blocks.**
   - **Contents:** `room` with agent views; `downloads` through the shell.
   - **Exit:**
     - conformance passes for room and downloads;
     - Blocks runs from its upstream files plus a manifest;
     - two tabs edit one workspace;
     - a reload converges;
     - a 3,000-op session checkpoints;
     - diff sync is measured (bytes per op).
5. **Agents.**
   - **Contents:** `slop db`, `slop room`, `comments.sendToClaude` and `room.sendToClaudeSession` → threads; `slop help runtime`.
   - **Exit:** an agent completes Blocks' chat protocol (read the view, write a turn, the tab applies it), and `--as-level` checks hide private data.
6. **The `slop` capability; Pinup cut over.**
   - **Contents:** approvals; delete everything in section 12; Pinup on the runtime.
   - **Exit:** Pinup's browser checks pass on the new transport, and the deleted code is gone (`git grep` for `docs:read`, `tool_grants`, `slg_` finds nothing).
7. **Assets, artifact.publish, comments, static mode.**
   - **Exit:** conformance passes for assets, artifact and comments, and the Pinup player renders from `db.json`.
8. **`sample` and permissions.**
   - **Contents:** provider, queue, budget, page tools, consent.
   - **Exit:** conformance passes for sample (against a fake provider in CI, the real one by hand) and permissions, and Blocks' Claude blocks fill in place.

## 15. Test strategy

- **The conformance suite is the spec in executable form.** Every rule in section 4 that a page can observe gets a check, for example:
  - an `update` of a missing document rejects `invalid_argument`;
  - a hidden document reads as missing;
  - `limit` windows stay correct when a document leaves;
  - `onSnapshot` returns the identical object for an unchanged document;
  - a 4 KiB + 1 room message rejects;
  - presence from another tab arrives with a correct `by`.
- **Go:**
  - tables for rules and levels;
  - query vectors shared with TypeScript (one JSON file under `pkg/rt/testdata`, read by both);
  - diff property tests (Go and TypeScript, same vectors);
  - store concurrency (PR #3's put/delete race, now on `rt_docs`);
  - view lifecycle: a secret expires, a view that never connects is dropped, `revoked` arrives when the level drops.
- **Browser:** the conformance suite, Blocks end to end, Pinup's checks. Each new check is broken once on purpose to show it can fail.
- **Mutation habit:** as in SLOP-007 and PR #3, every fix comes with a test shown failing on the old code.

## 16. Risks and open questions

### 16.1 Risks

- **Scope.** This is the largest change since SLOP-001. The phases keep a working system at every exit; Pinup keeps running on the old adapter until phase 6.
- **Memory-only rooms and views** tie slop to one process. That is the stated assumption today; multi-replica would need a shared bus.
- **Client-side query evaluation** depends on modest collections. A view that subscribes to a 25,000-document collection loads all of it. Mitigation: refuse subscriptions over a threshold with `resource_exhausted`, which the contract allows.
- **The secret in the page.** Any script in the app can use it, including Blocks' Spore apps (`new Function`). The secret's power is the view's level on one target plus approved `slop` permissions, smaller than today's tool grants, which reach the management API for every artifact.

### 16.2 Open questions

1. **Roles beyond admin:** a `member` (interact) and `viewer` (view) role, and sharing a target with them. The levels are built in; the user model is not.
2. **The `sample` key and budget.** Whose key, which limits, and whether to also support francois's Pi worker as a provider.
3. **An SVG sanitizer** for assets: write one, or keep `unsupported_type`.
4. **`files`:** map it to a target's version files, or to a project root?
5. **Rate limits** under load: the contract numbers (40/s room, 64 subscriptions) are per view; slop needs per-user caps too.
6. **Should Workshop previews of site pages also get the runtime,** so a page can be tried with live data before routing?

## 17. References

### Contract

- `~/Downloads/Artifact State Storage — Guide.md`: artifact, db, assets, Claude's side.
- `~/Downloads/Artifact People & Collaboration — Guide.md`: user, room, comments.
- `~/Downloads/Artifact Claude API (sample) — Spec.md`: sample, page tools, mcp (contract 0.2.75 for that spec).
- `~/Downloads/Artifact Files — Guide.md`: files, downloads.
- The platform's type definitions for runtime contract 0.2.92 (`claude.d.ts`, `db.d.ts`, `room.d.ts`, …).

### slop (`slop-computer`)

- `pkg/store/docs.go:20-46` limits and path rule · `pkg/server/docs.go` docs API, stream, presence · `pkg/store/tools.go:21-37` grants and permissions · `pkg/server/tools.go:20-23, 124` tool routes and `grantTool` · `pkg/server/auth.go:78-92, 118-120` guard levels and `guardPerm`.
- `pkg/store/sandbox.go:39-48` labels · `pkg/server/serve.go:200, 458-533` frame-ancestors and `serveSandbox` · `pkg/render/render.go:18-36, 57` modes, boot, `Inject` · `pkg/render/assets/tool.js` · `web/workshop/src/screens/ToolScreen.tsx`.
- `pkg/store/artifacts.go:35, 95-120, 153-166` the `viewer` column · `pkg/store/threads.go:115` `CreateThread` · migration `002_kernel.sql` (threads, comments) · `pkg/store/users.go:12-15` roles · `pkg/events/broker.go:1-9` one-process assumption.
- `web/pinup/slop/js/00-slop-host.js` the adapter · SLOP-008 guide (Blocks, gaps G1-G12).

### francois (`~/code/wesen/go-go-golems/francois`)

- `README.md` "Capabilities" (implemented surface and what is absent).
- `ui/src/runtime.ts`, `runtime-db.ts`, `runtime-rooms.ts`, `runtime-files.ts`, `runtime-images.ts`, `sample-contract.ts`.
- `pkg/store/documents.go` (`ValidatePath :38`, `Merge :64`, `Write :76`, `ValidateQuery :112`, `Apply :142`, `matches :277`, `Acquire :313`).
- `pkg/host/routes.go:98-229` views, view events, sample calls and tool results, rpc · `pkg/host/rpc.go:76-221` RPC methods (`db_changed` broadcast at `:113`) · `pkg/host/rooms.go` · `pkg/piworker`.
