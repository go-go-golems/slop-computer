---
Title: 'Intern guide: integrating Pinup into slop as a Workshop tool'
Ticket: SLOP-004
Status: active
Topics:
    - tools
    - collaboration
    - architecture
    - frontend
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://web/pinup/README.md
      Note: Pinup as copied into this repo, with provenance and build/test instructions
    - Path: repo://web/pinup/src/09-collab.js
      Note: Every use of the host runtime (cap, initData, presence, inbox)
    - Path: repo://web/pinup/tests/mock.js
      Note: The whole host contract Pinup expects, in 46 lines
    - Path: repo://pkg/server/tools.go
      Note: Tools, grants and CORS — what Pinup runs as
    - Path: repo://pkg/render/assets/tool.js
      Note: The tool client inside the iframe (slop.tool.ready, api.get/put, api.on)
    - Path: repo://pkg/events/broker.go
      Note: Live fan-out; ephemeral (Seq 0) events already supported
ExternalSources: []
Summary: "How Pinup works, which parts of slop it lands on, and the design and phased plan for running it as a Workshop tool: a live document store, a host adapter for window.claude, presence, an agent channel, versioned snapshots, and publishing designs to the site."
LastUpdated: 2026-10-29T09:30:00-04:00
WhatFor: "Onboarding and the implementation plan for Pinup on slop"
WhenToUse: "Before working on web/pinup, the docs store, tools, or publishing designs to a site host"
---

# Intern guide: integrating Pinup into slop as a Workshop tool

## Executive summary

**Pinup** is a screen-design tool in a single HTML page. It has frames on an infinite canvas, auto layout, components, colour and text tokens, a prototype player, code export, pinned feedback items, and a history in which every step can be reverted on its own. Ramon built it on 2026-10-28 as a claude.ai Artifact, and its source now lives in this repository at `web/pinup/` (commit `91c42b3`).

**slop** is our server for versioned pages and data, published on site hosts through a route table. Its **Workshop** is where admins and coding agents create and change those pages. This ticket makes Pinup a second way to create and iterate on what slop serves:

- design the screens in Pinup,
- review them with pinned feedback,
- let coding agents apply changes step by step,
- publish the result to `site.slop.yolo.scapegoat.dev`, either as a live clickable prototype or as the brief for a real app.

The integration is mostly a matter of *mapping*, not rewriting, because Pinup reaches its host through exactly one function, `window.claude.use(name)`. The test double for that host, `web/pinup/tests/mock.js`, is 46 lines, so the whole contract is small and known. Four pieces of work follow from it:

1. **A live document store in slop** (`/api/docs/...`). slop has immutable versions but nothing mutable and live. This is the one real gap.
2. **A host adapter**, `web/pinup/src/00-slop-host.js`. It implements `window.claude.use` on top of slop's tool client (`slop.tool`) and the new docs API. It is the only fork point in Pinup's code.
3. **Packaging.** Pinup is pushed as a slop *tool*, a page artifact with a `tool` section, opened at `/tools/pinup?file=<design>`. Each design file is a slop *data* artifact.
4. **Getting designs onto the site.** There are three ways:
   - *Save version* snapshots the live file into the data artifact;
   - a **player page** renders a design from data at a route;
   - a *Hand off* posts the design's handoff to a coding agent, which builds the real app as an ordinary slop page.

Sections 1–4 explain the parts you need to understand: slop, Pinup, the Artifact runtime contract, and the slop features we build on. Section 5 lists the gaps. Section 6 is the design, 7 walks through a whole session end to end, 8 is the phased plan with files, 9 covers tests, 10 risks, and 11 how we keep Pinup maintainable here.

### As built (2026-10-29)

Phases 1 and 2 are implemented. They differ from the design below in these points; the diary (`reference/01-diary.md`, steps 2–3) has the details.

- **Docs API paths.** Paths are exactly `collection/id`. The lease endpoint is `POST /api/docs/{artifact}/{coll}/{id}/acquire`, and the stream is `GET /api/docs/{artifact}/events`. Revs come from a `doc_heads` counter row, whose upsert serializes writers until commit.
- **No separate player bundle.** There is no `--player` bundle or `90-player.js`. The one slop build (`web/pinup/slop/build.js`) runs in **tool mode** in the Workshop and in **player mode** on a site route that binds a design. `pinup-player` is the same `index.html` with a plain page manifest. The reason: `06-proto.js` depends on a dozen editor functions.
- **Adapter location.** The adapter is `web/pinup/slop/js/00-slop-host.js`, and the menu is `95-slop-ui.js`. Both are spliced into Pinup's IIFE, so upstream `src/` is unchanged.
- **Snapshots** are `file.json`, `pages/<pageId>.json` and `handoff.md`. **Feedback is not snapshotted**, because a published route makes the version public.
- **Tool manifest:** `docs:read`, `docs:write`, `artifacts:read`, `versions:push`, `threads:write` and `routes:write`. It has no `events:read`; presence and changes arrive on the docs stream.
- **Grant message:** the Workshop forwards `args` (the query of `/tools/<id>`), `config` (site hosts) and `people`. `tool.js` gains `api.stream`, `api.putRaw`, `api.beacon` and `api.setArgs`.
- **Not built yet:** Open version, static publish (C), phase 3, a scripted Playwright test, and scheduled tombstone pruning.

---

## 1. slop in five minutes

If you read SLOP-003's guide, skim this section. slop is one Go binary (`cmd/slop`) that is both server and CLI. It answers on three kinds of host:

| Host | Example | Serves |
|---|---|---|
| main | `slop.yolo.scapegoat.dev` | the Workshop (React, `web/workshop`), `/api/*`, login, Safe mode, `/help/*` |
| site | `site.slop.yolo.scapegoat.dev` | public pages through the **route table** |
| sandbox | `s<20 hex>.sbx.slop.yolo.scapegoat.dev` | one page version per unguessable origin, for previews and **tools** |

The nouns:

- **Artifact.** A named, versioned `page` or `data` collection (`pkg/store/artifacts.go`). Pages have an `index.html`; data artifacts hold files that become **records**. A `.json` file becomes one record; `pkg/records/records.go:80` `Parse`.
- **Version.** An immutable file tree with a manifest, `slop.json`. Pushing creates `n+1` and usually moves the `main` ref.
- **Route.** `(host, path pattern) → page [+ bindings + record]`. A page receives its data as boot data in `window.slop` (`pkg/render/render.go`, `pkg/render/assets/runtime.js`).
- **Threads.** Comment threads anchored on a page version (`pkg/store/threads.go`). Coding agents wait for them with `slop comments wait` (`pkg/server/stream.go:205`) and answer by pushing a version together with a reply.
- **Events.** Every change appends an event. `pkg/events/broker.go` fans them out live to the Workshop's server-sent stream (`/api/events`, `stream.go:50`) and to waiting agents.

Limits you will meet: a version tree holds at most **2,000 files** and **200 MB** (`pkg/server/kernel.go:21-22`), and a push body is at most 4 MB of JSON.

---

## 2. Pinup in ten minutes

Read `web/pinup/README.md` and the project report it links for the full picture. The points that matter for this ticket:

### 2.1 The page and its build

- **Source.** `web/pinup/src/` holds 14 numbered JavaScript modules, plus `head.html` (styles) and `body.html` (markup, and a README comment addressed to Claude).
- **Build.** `web/pinup/build.js` concatenates them inside one IIFE, inlines the Lucide icon set as a JSON script element, and writes `dist/pinup.html`, about 705 KB.
- **No modules.** There is no framework or module system; the modules share one scope, and the numeric prefixes give the load order.
- **A fragment, not a document.** The page has no `<!doctype>` or `<html>`, because the Artifact host wraps pages in a document skeleton. `tests/wrap.js` does the same for the tests. **slop does not wrap pages**, so our build has to (§6.5).

### 2.2 The data model: one document per layer

```text
meta/file      { name, pages:[{id,name}], tokens:{colors, type}, v:1 }
nodes/<id>     one layer: type frame|rect|ellipse|line|text|icon|svg|instance, page, parent, z, geometry, paint, layout…
feedback/<id>  a review item pinned to a layer (n, text, cat, node, dx, dy, area, marks, status, reply, log)
log/<id>       one shared history step with before/after for each changed layer
inbox/<id>     HTML to import, or a "step" (ordered ops linked to a feedback item) for an editor tab to apply
```

The full schema is the README comment at the top of `web/pinup/src/body.html`. Three rules hold everything together:

- **`norm()`** (`02-store.js:29`) fills defaults for every node that enters the client, so any writer — a person, Claude, an older version — can omit fields.
- **`commit(changes)`** (`02-store.js:127`) is the single write path. It normalises, updates memory, records undo, and queues a database write.
- **The write queue** (`02-store.js:199`) holds at most one pending write per document and at most 12 in flight. While a document's write is pending, echoes of it are ignored (`applyRemoteNode`, `02-store.js:256`). The model is **last-writer-wins per document**.

### 2.3 How Claude edits a Pinup file

- **HTML in.** Claude writes HTML with inline styles and a few `data-*` attributes (`data-name`, `data-icon`, `data-component`, `data-instance`, `data-link`, `data-flow`). `importHTML` (`08-import.js:20`) lays it out in a sandboxed iframe and turns the computed boxes into layers. Flexbox becomes auto layout.
- **Steps.** A step document in `inbox/` carries `ops`: `update`, `set`, `delete`, `html` or `tokens`. An open editor tab takes a **lease** on it, applies it as one history group (`applyStep`, `13-feedback.js:383`), marks the linked feedback item done, and deletes the inbox document (`inboxPump`, `09-collab.js:75`).
- **Revert.** Every group is logged to `log/`. Any step can be reverted alone, with conflict detection (`logConflicts` and `revertLog`, `14-log.js:42-44`).
- **In-page Claude.** The page can also run Claude itself, with seven tools (`claudeTools`, `10-claude.js:65`), through the `sample` capability.

### 2.4 Exports Pinup already has

These are all in `07-export.js`:

- `exportHTMLDoc(ids)` (`:71`) produces a standalone HTML document. Prototype links survive as `data-link="<frame name>"`.
- React with Tailwind, and CSS tokens.
- **`handoffMarkdown()`** (`:212`), a build brief written for Claude Code.
- PNG and SVG images.
- `saveFile()` (`:242`) saves through `downloads`, or copies to the clipboard when that capability is missing.

---

## 3. The contract: the Artifact runtime as Pinup uses it

Everything Pinup needs from its host goes through this function (`09-collab.js:3`):

```js
function cap(name) {   // cached; null when the host lacks the capability
  if (!(name in CAPS)) CAPS[name] = (window.claude && typeof window.claude.use === 'function')
    ? Promise.resolve(window.claude.use(name)).catch(() => null) : Promise.resolve(null);
  return CAPS[name];
}
```

Every feature checks for `null` and degrades. With no `db`, for example, Pinup keeps the file in `localStorage` (`initData`, `09-collab.js:23`). The exact call shapes, taken from `tests/mock.js` and the call sites:

| Capability | Calls | Shapes |
|---|---|---|
| `db` | `doc(path)`: `get()`, `set(data)`, `update(data)`, `delete()`, `onSnapshot(next, err)`, `acquire({holder, ttlMs}) → {acquired}` | snapshot: `{id, exists, data()}` |
| | `collection(path)`: `onSnapshot(next, err)`, `get()`, `doc(id)` | `next({docChanges: () => [{type: 'added'\|'modified'\|'removed', doc}]})` |
| | errors | `err.code`: `not_granted`, `revoked`, `capability_disabled`, `quota_exceeded`, `invalid_argument` (with a message mentioning size), `resource_exhausted`, `unavailable` (`02-store.js:236-243`) |
| `user` | `me() → {id, name, color, avatarUrl}`, `canEdit()`, `can('data.write')`, `profiles(ids) → {id: profile}` | |
| `room` | `presence(payload)`, `onPeers(h) → unsubscribe` with `h({peers:[{peer, isMe, kind, presence}], joined, left, updated})`, `canSendToClaudeSession() → 'available'…`, `sendToClaudeSession(data, {deliver: 'send'\|'stage'})` | presence payload: `presencePayload()`, `09-collab.js:153` |
| `comments` | `customAnchors({...}) → {compose, placed, areas, …}` | optional |
| `sample` | `sample(messages, {tools:[{name, description, input_schema, execute}], signal, onText, cache}) → {text}` | the runtime runs the tool loop and calls `execute` |
| `downloads` | `save({filename, data}) → {status}` | optional |
| `assets` | `upload(file) → {url}` | optional |

**Key insight.** If slop can answer `db` and `user`, Pinup gets real shared editing on slop without any change to its 14 modules.

---

## 4. The slop features we build on

### 4.1 Tools and grants

A **tool** is a page artifact whose `slop.json` has a `tool` section:

```json
{ "artifact": "pinup", "kind": "page",
  "tool": { "title": "Pinup", "icon": "pen-tool",
            "permissions": ["docs:read", "docs:write", "artifacts:read", "versions:push", "threads:write"] } }
```

Phase 2 adds `routes:write` if *Publish* sets routes from inside the tool. Without it, publishing is a CLI recipe that an admin or agent runs.

- **Approval.** An admin enables a tool version in the Workshop (`PUT /api/tools/{id}`). Tools, tokens and users can't approve tools, and the grantable permissions are a fixed list (`ToolPermissions`, `pkg/store/tools.go:26`).
- **The frame.** The Workshop opens the tool at `/tools/<id>`, in an iframe on the version's **sandbox origin** (`web/workshop/src/screens/ToolScreen.tsx:65-96`), with `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`.
- **The grant.** The tool's `tool.js` posts `tool-hello`. The Workshop answers with a **grant** (`POST /api/tools/{id}/grant`, `tools.go:124`): an `slg_…` bearer secret, valid for one hour and renewed while the tool is open, carrying only the approved permissions.
- **Calls.** The tool calls `https://<main>/api/...` with `Authorization: Bearer slg_…`. CORS allows sandbox origins, without credentials (`cors`, `tools.go:185`).
- **Endpoint gating.** A grant reaches only endpoints registered with `guardPerm` and a permission it carries. Endpoints registered with plain `guard`, such as `GET /api/users` and `GET /api/agents`, answer a grant with `403 grant_not_allowed` (`pkg/server/auth.go`, `guardPerm`). That shapes §6.4 and §6.6.

Inside the tool, `pkg/render/assets/tool.js` provides the client:

```js
const api = await slop.tool.ready();          // rejects outside the Workshop
await api.get('/artifacts', { project: 'x' }); // GET with query params
await api.put('/routes', {...});               // JSON body
api.on('version.created', ev => …);            // SSE over fetch (needs events:read)
api.user; api.permissions; api.can('docs:write');
```

**Sandbox origins are per (artifact, version)** (`pkg/store/sandbox.go:39`). Everyone using Pinup v7 shares one origin, and Pinup v8 gets a new one. `localStorage` (Pinup keeps view positions there) therefore resets when the tool is upgraded. That is harmless once the file itself lives in slop.

### 4.2 Events and ephemeral events

`events.Broker` (`pkg/events/broker.go:33,55`) has `Subscribe(filter)` and `Publish(evs...)`. Stored events have `Seq > 0`. **Ephemeral events have `Seq == 0` and are never stored** (`pkg/store/events.go:12`); agent presence already uses them (`agent.waiting`, `agent.left`). `eventStream` replays stored events after a cursor and then streams live ones, and passes ephemeral events through. This is exactly the shape we need for presence and for live document changes.

### 4.3 Data artifacts, records and pushing

To create or update a data artifact:

1. `POST /api/blobs/missing {sha256: [...]}`;
2. `PUT /api/blobs/{sha}` for each missing blob;
3. `POST /api/artifacts/{id}/versions {tree: {path: sha}, base, message, create?: {title, kind: "data", type, project}}` (`kernel.go:329`).

Each `.json` file becomes one record. A page reads records through `reads` in its manifest, or through a route **binding** (`bindings`, `pkg/server/serve.go:98`).

### 4.4 Threads and the agent loop

- **Creating threads.** `POST /api/artifacts/{id}/threads` creates a thread on an artifact version. The anchor is free-form JSON, and the text is the first comment.
- **The agent waits.** A coding agent runs `slop comments wait -p <project>`, blocking on `GET /api/comments/wait`. It wakes with the whole thread, does the work, and replies: `slop push … --reply <thread> --reply-text "…"`.
- **Visible in the Workshop.** Waiting agents are listed (`GET /api/agents`) and appear in the Workshop.

---

## 5. Gap analysis

| Pinup needs | slop has | Gap | Phase |
|---|---|---|---|
| `db`: live, mutable JSON documents with listeners and leases | immutable versions | **a docs store, its API and a change stream** (§6.3) | 1 |
| `user` | the grant's `user` and permissions; `GET /api/users` | small adapter | 1 |
| A full HTML document | serves `index.html` as written | build wrapper (§6.5) | 1 |
| Which design file to open | `/tools/<id>` takes no arguments | pass `?file=` through to the grant message (§6.10) | 1 |
| `room.presence` / `onPeers` | ephemeral events, agent waiters | presence endpoint and adapter (§6.6) | 2 |
| `sendToClaudeSession` | threads plus `comments wait` | map "send" to a thread on the design (§6.7) | 2 |
| Getting designs to the site | routes, bindings, data artifacts | Save version, the player, the handoff (§6.8–6.9) | 2 |
| `downloads` | Blob download needs `allow-downloads` | iframe attributes (§6.10) | 2 |
| `sample` (in-page Claude) | none | `/api/sample` proxy (§6.11) | 3 |
| `assets` (images) | blobs plus data artifacts | upload adapter (§6.11) | 3 |
| `comments.customAnchors` | threads have JSON anchors | optional; Pinup's feedback items cover review | 3 or never |
| Roles: editor / contributor / commenter | admins only | a reviewer role (§10) | 3 |

---

## 6. Design

### 6.1 Architecture

```
 Workshop  slop.yolo.scapegoat.dev                      sandbox origin of pinup vN
 ┌──────────────────────────────────┐   grant (postMessage)  ┌─────────────────────────────────────┐
 │ Tools ▸ Pinup                    │──────────────────────▶ │ index.html  (built from web/pinup)  │
 │ /tools/pinup?file=design-pace…   │   args {file}          │   runtime.js + tool.js (injected)   │
 └──────────────────────────────────┘                        │   00-slop-host.js → window.claude   │
                                                             │   01…99  Pinup, unchanged           │
                                                             └──────────────────┬──────────────────┘
                                                  Bearer slg_… (CORS)           │
 ┌──────────────────────────────────────────────────────────────────────────────▼────────────────┐
 │ slop API                                                                                      │
 │  /api/docs/{design}/…        live docs (NEW)       /api/docs/{design}/events   SSE (NEW)      │
 │  /api/presence/{design}      ephemeral (NEW)       /api/artifacts…/versions     Save version  │
 │  /api/artifacts…/threads     "Send to agent"       /api/routes                  Publish       │
 └───────┬──────────────────────────────┬────────────────────────────────────┬───────────────────┘
         │ docs table                   │ data artifact design-pace-club     │ routes on site host
         ▼                              ▼  v1 v2 v3: file.json pages/*.json  ▼
   working copy (live)           snapshots (immutable)          /proto/pace-club/:screen → pinup-player
                                                                       (binding design=design-pace-club)
   coding agent ── slop docs get/put/watch ── slop comments wait ── slop push / route set
```

Two stores, two jobs:

- the **docs table** is the live working copy: mutable, last-writer-wins, the thing Pinup edits;
- the **data artifact** holds immutable snapshots: the history, the thing pages and routes read.

That split mirrors how slop already treats pages, as versioned snapshots that routes follow. It also keeps the live document store out of the publishing path.

### 6.2 A design file is a data artifact

- **Creating.** A new design file is a data artifact with `type: "pinup"`, for example `design-pace-club`, created by pushing v1. That snapshot holds the empty file.
- **Addressing.** Its id is the namespace of its live documents (`/api/docs/design-pace-club/nodes/…`).
- **Workshop.** It shows up in the Artifacts screen and has versions, a project and comment threads like everything else.
- **Previews.** Later, its `viewer` field can point at `pinup-player`, so the Workshop's data panes preview designs (`DataPanes.tsx`).

### 6.3 The live document store

**Schema** (`pkg/store/migrations/{postgres,sqlite}/006_docs.sql`):

```sql
CREATE TABLE docs (
    artifact_id text NOT NULL REFERENCES artifacts(id),
    path        text NOT NULL,            -- "meta/file", "nodes/k9TzQ", "inbox/s1"; 1–3 segments
    data        text,                     -- JSON object; NULL = tombstone (deleted)
    rev         bigint NOT NULL,          -- per-artifact, strictly increasing
    updated_by  text REFERENCES users(id),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL,
    lease_holder text, lease_until TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (artifact_id, path)
);
CREATE INDEX docs_rev ON docs(artifact_id, rev);
```

**Semantics:**

- **Writes.** A write replaces the whole document and gets `rev = max(rev)+1` for that artifact, inside the transaction. The model is last-writer-wins per document, which is what Pinup assumes.
- **Deletes.** A delete keeps a **tombstone** (`data NULL`) with a new `rev`, so a client that was offline can learn about it. Tombstones older than 7 days are pruned.
- **Limits.** A document may be at most **256 KiB** (Pinup's mock enforces 262,144). An artifact may hold at most **20,000 live documents** and **64 MB**.
- **Leases.** One statement:

  ```sql
  UPDATE docs SET lease_holder=?, lease_until=? WHERE artifact_id=? AND path=? AND data IS NOT NULL
    AND (lease_until IS NULL OR lease_until < now OR lease_holder = ?)
  ```

  One row affected means `{acquired: true}`.
- **Kept out of audit and events.** Doc writes are **not** audited row by row and **not** appended to `events`; a drag would flood both. The audit log gets one entry per Save version and per Publish instead.

**API** (`pkg/server/docs.go`; permissions `docs:read` and `docs:write`, also available to admin tokens):

```
GET    /api/docs/{artifact}?prefix=nodes/&after=<rev>  → {docs:[{path, data|null, rev}], rev}
GET    /api/docs/{artifact}/{path...}                   → {path, data, rev}            404 if none
PUT    /api/docs/{artifact}/{path...}   body: JSON obj  → {rev}
DELETE /api/docs/{artifact}/{path...}                   → {rev}
POST   /api/docs/{artifact}/{path...}/acquire {holder, ttlMs≤60000} → {acquired}
GET    /api/docs/{artifact}/events?after=<rev>          → text/event-stream
          event: doc    data: {path, rev, data|null}    (data omitted when > 64 KiB; the client GETs it)
          event: ready  data: {rev}
          event: presence data: {...}                    (§6.6)
```

The `artifact` must be a data artifact of type `pinup`, or of a type in an allow-list. That keeps the docs store from becoming a general-purpose backdoor beside versions.

**The stream** follows `eventStream`'s pattern (`stream.go:50`):

```
docEvents(artifact, after):
    sub := Broker.Subscribe(ev.Type in {doc, presence} && ev.Artifact == artifact)
    replay: SELECT path, data, rev FROM docs WHERE artifact_id=? AND rev > after ORDER BY rev
    write "ready {rev}"
    live: forward sub events with rev > last (presence always)
```

A doc write publishes an **ephemeral** event (`Seq 0`) carrying `{path, rev, data}`. The *replay* comes from the `docs` table by `rev`, not from the event log, so a reconnecting client never misses a change.

**Errors → Pinup codes.** The adapter maps them so Pinup's existing messages apply (`02-store.js:236-243`):

| HTTP | `code` | Pinup does |
|---|---|---|
| 401/403 | `not_granted` | switches to read-only ("You can view, present and comment") |
| 413 / `too_large` | `invalid_argument` "document too large" | "That layer is too large to save" |
| 507 / `quota` | `quota_exceeded` | "delete unused layers or images" |
| 429 | `resource_exhausted` | retries with backoff |
| 5xx / network | `unavailable` | retries, then "keep this tab open" |

### 6.4 The host adapter: `web/pinup/src/00-slop-host.js`

This is the only Pinup file we add, and it sorts before `01-util.js`. If `window.slop.tool` exists, it installs `window.claude`. Otherwise it does nothing, and Pinup behaves exactly as upstream, which keeps the tests and the local `localStorage` mode working.

```js
// 00-slop-host.js — Pinup on slop: window.claude.use() over slop.tool and /api/docs.
(function () {
  if (!window.slop || !slop.tool || window.claude) return;
  const ready = slop.tool.ready();                 // grant from the Workshop
  const file = () => ready.then(api => api.args && api.args.file);   // §6.10

  function makeDb(api, artifact) {
    const subs = new Set();          // {prefix | path, next}
    let rev = 0;
    stream(api, artifact, () => rev, ev => {        // SSE: replay then live
      rev = Math.max(rev, ev.rev);
      for (const s of subs) s.deliver(ev);
    });
    const docRef = path => ({
      id: path.split('/').pop(), path,
      get: () => api.get(`/docs/${artifact}/${path}`).then(snap(path), e => e.status === 404 ? snap(path)(null) : Promise.reject(mapErr(e))),
      set: data => api.put(`/docs/${artifact}/${path}`, data).catch(e => Promise.reject(mapErr(e))),
      update: data => docRef(path).get().then(s => docRef(path).set(Object.assign(s.data() || {}, data))),
      delete: () => api.del(`/docs/${artifact}/${path}`).catch(e => Promise.reject(mapErr(e))),
      acquire: o => api.post(`/docs/${artifact}/${path}/acquire`, o),
      onSnapshot: (next, err) => subscribe({ path, next, err }),
    });
    const collection = prefix => ({
      path: prefix, doc: id => docRef(prefix + '/' + (id || uid())),
      get: () => api.get(`/docs/${artifact}`, { prefix: prefix + '/' }).then(r => ({ docs: r.docs.map(...) })),
      onSnapshot: (next, err) => subscribe({ prefix: prefix + '/', next, err }),   // initial "added", then changes
    });
    return { doc: docRef, collection };
  }

  const caps = {
    db: () => Promise.all([ready, file()]).then(([api, f]) => f && api.can('docs:write') ? makeDb(api, f) : null),
    user: () => ready.then(api => ({
      me: async () => ({ id: api.user.id, name: api.user.name, color: '', avatarUrl: '' }),
      canEdit: async () => api.can('docs:write'),
      can: async p => p === 'data.write' ? api.can('docs:write') : false,
      profiles: async ids => Object.fromEntries(ids.map(id => [id, api.people[id] || { id, name: 'Someone' }])),
    })),
    room: () => ready.then(api => api.can('threads:write') ? makeRoom(api) : null),   // §6.6–6.7
    downloads: () => Promise.resolve({ save: blobDownload }),                    // §6.10
    // sample, assets, comments: null until phase 3
  };
  window.claude = { use: name => (caps[name] ? caps[name]() : Promise.resolve(null)).catch(() => null) };
})();
```

Three details matter:

- **Snapshot listeners:** `collection(p).onSnapshot` must first deliver every existing document as `added`, then only changes. A tombstone is delivered as `removed`. This is what `mock.js` does with its `Map`.
- **Echoes:** Pinup ignores echoes of its own pending writes (`applyRemoteNode`), so the adapter can deliver every event, including the client's own.
- **`profiles`:** a grant cannot call `GET /api/users` (§4.1). The grant response therefore gains `people: {id: {id, name}}` for active users, and `tool.js` exposes it as `api.people`. The alternative, a new grantable `users:read`, would widen the grant surface for a list of names; the grant response leaks nothing an admin's tool shouldn't see.

### 6.5 Packaging Pinup as a slop tool

`build.js` stays byte-compatible with upstream; the test in §9 checks that. A second entry point produces the slop build:

```
node build.js            → dist/pinup.html               (upstream page, unchanged)
node build.js --slop     → dist/slop/index.html          (document skeleton + 00-slop-host.js + Pinup)
                           dist/slop/slop.json           (kind page, tool section, title, icon)
node build.js --player   → dist/player/index.html        (§6.9)
make pinup               → runs the builds; `slop push web/pinup/dist/slop` publishes the tool
```

- **The skeleton** is what `tests/wrap.js` writes: `<!doctype html><html><head><meta charset=utf-8><meta name=viewport …>`. Without it the page renders in quirks mode, because `render.Inject` simply prepends the boot data to a fragment (`render.go:80-84`).
- **`00-slop-host.js` is included only in the `--slop` build.** Upstream `dist/pinup.html` stays identical to the published artifact.

### 6.6 Presence

```
POST /api/presence/{artifact}  {peer, payload}            (docs:write; ≤ 4 KiB; rate-limited to 20/s per peer)
    → in-memory table peers[artifact][peer] = {user, payload, seen}; expires after 30 s without a post
    → Broker.Publish({Seq:0, Type:"presence", Artifact, Payload:{peer, user, presence, left?}})
GET  /api/presence/{artifact}  → {peers:[{peer, user, presence, kind}]}  (initial list for onPeers)
```

The adapter's `room.presence(patch)` merges the patch into the tab's payload and posts it. `onPeers` combines the initial list with `presence` events on the docs stream. Agents waiting on this design are added as peers with `kind: 'agent'`, so Pinup shows them with the "Claude" avatar (`decoratePeer`, `09-collab.js`). The *server* adds them: `GET /api/agents` refuses grants (§4.1), so `GET /api/presence` includes the agent waiters whose `artifact` or `project` matches. `agent.waiting` and `agent.left`, which are already ephemeral events, are relayed onto the design's stream as `presence` events.

Presence stays in memory, which is correct for one server process. This is the same assumption the broker makes (`broker.go:8`).

### 6.7 The agent channel

Pinup's "Send to Claude" buttons call `room.sendToClaudeSession(data, {deliver})`. On slop, the coding agent is not in a chat beside the page; it is a process blocked on `slop comments wait`. So the adapter maps the call to a **thread on the design artifact**:

```
sendToClaudeSession(data, {deliver}):
    text := "Pinup · " + data.label + "\n\n" + data.what + "\n\n```json\n" + JSON(data minus label/what) + "\n```"
    POST /api/artifacts/{design}/threads {version: latest, anchor: {pinup: {page, selection ids}}, text}
    → the agent wakes with the thread
canSendToClaudeSession(): "available" if threads:write is granted (agents may join later)
```

Threads accept any artifact kind but need an existing version (`CreateThread`, `pkg/store/threads.go:115`). That is one reason a new design file pushes v1 at once (§6.2).

The agent needs to read and write the live file. A new CLI, `cmd/slop/cmds/docs.go`, wraps §6.3:

```
slop docs ls    <artifact> [prefix]        # paths and revs
slop docs get   <artifact> <path>          # JSON to stdout
slop docs put   <artifact> <path> [file|-] # e.g. an inbox step
slop docs rm    <artifact> <path>
slop docs watch <artifact> [--prefix p]    # tail changes (the SSE stream) as JSON lines
```

The agent applies feedback by writing **inbox steps** in Pinup's own format. The open Pinup tab leases each one and applies it as one revertible history group:

```json
{ "kind": "step", "seq": 1, "feedback": "#1", "label": "More space between run cards",
  "reply": "Raised the gap between cards from 12 to 20px.",
  "ops": [{ "op": "update", "id": "83vCCmagxe", "data": { "layout": { "dir": "col", "gap": 20, "pad": [0,0,0,0] } } }] }
```

A new help topic, `pkg/doc/topics/pinup.md` (served as `slop help pinup` and `/help/pinup`), gives agents the database layout and the step format. It is adapted from the README comment in `body.html`. The agent replies in the thread when it is done.

> **Limitation (also true on claude.ai).** Steps are applied by an open editor tab. With no tab open, they wait in `inbox/`. Applying them on the server would mean running `norm()` and `importHTML()` in Go, or headless, which is out of scope.

### 6.8 Save version: snapshots

A new Pinup action, *Save version* (in the Share menu), writes a snapshot of the live file as a new version of the design artifact:

```text
file.json             meta/file (name, pages, tokens, v)
pages/<pageId>.json   {id, name, nodes:[…every node of that page…]}
feedback.json         {items:[…open and closed feedback…]}
handoff.md            handoffMarkdown()        ← the brief for a coding agent
```

Why bundle by page instead of one file per layer? A version holds at most 2,000 files, and a large design has more layers than that. Pages also make natural records for the player. The push follows §4.3, with sha256 computed by `crypto.subtle.digest` (a sandbox origin is a secure context), and `message` taken from a prompt ("Saved from Pinup: <note>").

*Open version* does the reverse. It replaces the live documents with a snapshot's content, as one step in the log, so it is revertible like any other.

### 6.9 Publishing to the site

Pinup produces screens and clickable prototypes, not apps with behaviour. So there are two kinds of "serve it on site.yolo":

**(B) The live prototype player.** This is recommended for iterating. A second build target bundles only what is needed to render and present:

```
--player:  01-util 02-store 03-render 06-proto 07-export + new src/90-player.js, player body (#pv markup only)
90-player.js:
    rows := slop.data.design.all                  // records of the bound design artifact
    S.file := rows["file"]; for page in rows "pages/*": for n in page.nodes: S.nodes.set(n.id, norm(n.id, n))
    start := frame whose slug(name) == slop.route.params.screen, else flow start, else first frame
    openPresent(start) full-window; on follow(link): history.pushState(…/<slug(target)>)
```

It is pushed once as page artifact `pinup-player`. Each design is then one route:

```
slop route set /proto/pace-club/:screen pinup-player --bind design=design-pace-club --note "Pace Club prototype"
slop route set /proto/pace-club         pinup-player --bind design=design-pace-club
```

- **Updates.** *Save version* moves the design's `main`. The binding follows `main`, so the site updates on the next request. A route can also pin `design@3` for a frozen review link.
- **No special casing.** The player is one page, and designs are data chosen by the route. That is slop's normal model: a renderer page plus data bound by the route, the same as `app-page` and the journal.
- **Check first.** `06-proto.js` reads `S`, `get()` and `buildEl()`, and the markup `#pv`, `#pvclip`, `#pvName` and so on. Run `node --check` on the player bundle, then test that it presents the example, before relying on this build.

**(C) Static export (frozen).** `exportHTMLDoc(ids)` already produces a full document. Prototype links remain as `data-link="<frame name>"`. *Publish static* pushes a page artifact `<design>-site` containing that HTML plus a 40-line script that shows one frame at a time and follows `data-link` (by name, plus `back`), and routes it. There is no data dependency and nothing moves afterwards. It suits a one-off landing page.

**(D) Hand off to a coding agent: real apps.** *Hand off* saves a version (so `handoff.md` and the page JSON are in it) and creates a thread on the design:

> "Build the app from design-pace-club v4: `slop pull design-pace-club` (handoff.md, pages/*.json). Push it as page `pace-club`, route it at `/apps/pace-club`, reply here."

The agent builds a real page artifact, with behaviour, data `reads` and so on, using the normal slop loop. Review then continues on the real page through the Workshop's existing comment pins, and design changes flow back through Pinup.

```
 design in Pinup ──Save──▶ design-x vN ──route──▶ /proto/x/:screen   (B: clickable prototype)
        ▲                       │
        │ inbox steps           └──Hand off──▶ thread ──▶ agent ──push──▶ page x-app ──route──▶ /apps/x
        │                                                                        │
        └──── feedback items ◀── reviewers ◀──────── comments on the real page ──┘
```

### 6.10 Workshop and runtime changes

- **Tool arguments.** `/tools/pinup?file=design-x`: `ToolScreen.tsx` forwards its query string in the grant message as `args`. `tool.js` exposes `api.args`. The query is display state, not authority; the grant still decides what the tool may do.
- **Iframe permissions.** For tools, `ToolScreen.tsx:96` adds `allow-downloads` to `sandbox`, for `downloads.save` as a Blob plus `<a download>`, and `allow="clipboard-read; clipboard-write"`, because Pinup's copy and paste and its handoff copy need the clipboard in a cross-origin frame.
- **File picker.** If `args.file` is missing, the adapter (not Pinup) shows a small chooser before boot. It lists `GET /api/artifacts` filtered by `type == "pinup"`, or creates a new design via §6.2.

### 6.11 Phase 3: in-page Claude, images, comments

- **`sample`.** `POST /api/sample {model, system?, messages, tools:[{name, description, input_schema}]}` proxies to the Anthropic Messages API, using a key from Vault (`kv/apps/slop/test/runtime`) and streaming the result back. The adapter runs the tool loop in the page: on `tool_use`, call the tool's `execute(input)`, append `tool_result`, and call again. The new permission `sample:use` is approved per tool, every request is audited, and a per-user daily budget applies. The default model is `claude-opus-5-5`.
- **`assets`.** `upload(file)` computes the sha256, uploads the blob, and pushes a new version of `<design>-assets` adding `files/<sha>.<ext>`. It returns `/_d/<design>-assets/<n>/files/<sha>.<ext>`. The player route then also binds `assets=<design>-assets`, so the `/_d/` gate serves the images (SLOP-003 guide §3.2).
- **`comments.customAnchors`.** Optional. Pinup's feedback items already cover review.

---

## 7. A session, end to end

1. Manuel opens **Workshop → Tools → Pinup → New file "Pace Club"** in project `pace-club`. The adapter pushes `design-pace-club` v1 and reloads with `?file=design-pace-club`.
2. Pinup boots. `cap('db')` resolves to the docs adapter, `initData` subscribes to `meta/file`, `nodes`, `feedback`, `log` and `inbox`, and the file is empty. Manuel clicks *Load example*, and roughly 105 `PUT /api/docs/design-pace-club/...` calls follow, at most 12 in flight.
3. Ramon opens the same URL. His tab replays the document stream from rev 0 and sees the file, and both see each other's avatars through presence.
4. Ramon pins feedback #1, "cards feel cramped", and clicks **Send 1 open to Claude**. The adapter creates a thread on `design-pace-club`.
5. An agent blocked in `slop comments wait -p pace-club` wakes up. It runs `slop docs get design-pace-club feedback/…` and `slop docs ls design-pace-club nodes/`, then `slop docs put design-pace-club inbox/s1 step.json`, and replies in the thread.
6. Manuel's tab sees `inbox/s1`, leases it, and applies the step. The gap goes from 12 to 20, item #1 is marked done with the agent's reply, and the step appears in History as "#1 More space between run cards · claude", revertible on its own.
7. Manuel clicks **Save version**, and `design-pace-club` v2 holds `file.json`, `pages/p1.json`, `feedback.json` and `handoff.md`.
8. An admin runs `slop route set /proto/pace-club/:screen pinup-player --bind design=design-pace-club`. `https://site.slop.yolo.scapegoat.dev/proto/pace-club/welcome` is now a clickable prototype that follows the design's `main`.
9. Manuel clicks **Hand off**. The agent builds `pace-club` (a page with real behaviour), routes it at `/apps/pace-club`, and replies. Further review happens on that page with Workshop comments, or back in Pinup.

---

## 8. Implementation plan

**Phase 0, done (`91c42b3`).** Pinup is copied to `web/pinup/`, `node build.js` reproduces the published page byte for byte (sha256 `531ef701…`), and `t1`, `t5` and `fb1` pass in-tree.

**Phase 1: Pinup edits a shared file on slop.**

| Step | Files | Notes |
|---|---|---|
| Docs store | `pkg/store/migrations/{postgres,sqlite}/006_docs.sql`, `pkg/store/docs.go` | put, get, list since rev, delete with tombstones, acquire, limits, prune |
| Docs API and stream | `pkg/server/docs.go`; register in `server.go`; `ToolPermissions += docs:read, docs:write` (`pkg/store/tools.go:26`) | the SSE stream follows `eventStream`; ephemeral `doc` events through the broker |
| Client and CLI | `pkg/client/docs.go`, `cmd/slop/cmds/docs.go` | `slop docs ls/get/put/rm/watch` |
| Tool arguments, people and iframe | `web/workshop/src/screens/ToolScreen.tsx`, `pkg/render/assets/tool.js`, `grantTool` in `pkg/server/tools.go:124` | `args`, `people` in the grant response, `allow-downloads`, clipboard |
| Adapter | `web/pinup/src/00-slop-host.js` (only in the `--slop` build) | `db`, `user`, file picker |
| Build | `web/pinup/build.js --slop`, `web/pinup/slop/slop.json`, `Makefile` target `pinup` | document skeleton; upstream output unchanged |
| Docs | `pkg/doc/topics/pinup.md` | the agent brief and step format |

**Phase 2: review, agents and publishing.** Presence (`pkg/server/presence.go`, `room` in the adapter); "Send to agent" as a thread; *Save version* and *Open version* (a small Pinup patch in `05-panels.js`, the Share menu, marked `// slop:`); the `--player` build with `src/90-player.js` and a `pinup-player` page; the route recipe in the help topic; *Publish static*; *Hand off*.

**Phase 3.** `/api/sample` with `sample:use`; `assets`; a reviewer role; `viewer` set to `pinup-player` for `type: pinup` data.

## 9. Tests

| Test | Where | Asserts |
|---|---|---|
| Docs store | `pkg/store/docs_test.go` (SQLite and Postgres via `TEST_DATABASE_URL`) | revs increase; list `after` includes tombstones; size and quota refusals; a lease is exclusive until it expires; prune |
| Docs API | `pkg/server/docs_test.go` | permissions (token, grant with and without `docs:write`); type allow-list; error codes; the stream replays and then goes live with no gap (write between subscribe and replay) |
| Presence | `pkg/server/presence_test.go` | expiry; events reach the right artifact only |
| Upstream build | `web/pinup` CI check | `node build.js` sha equals the README's sha until we deliberately change upstream files |
| Pinup on slop | `web/pinup/tests/slop1.js` (new; Playwright against `slop serve --local`) | open `/tools/pinup?file=…` in the Workshop, load the example, check `GET /api/docs` has ~105 documents; a second page sees a change; a step written by `slop docs put` is applied and reverted |
| Player | `web/pinup/tests/player1.js` | route `/proto/x/:screen` renders, `data-link` navigation changes the URL, 404 page for an unknown screen |

## 10. Risks and open questions

- **Docs store scope.** Per design artifact, as here, or per project? Per artifact keeps a file one unit and its access check one lookup. Collections across files aren't needed.
- **Event volume.** Doc events are ephemeral and never stored, but they still fan out to every subscriber of that design. The broker drops a slow subscriber, which then reconnects and replays by `rev`. That's correct, but it needs a load test with two tabs dragging.
- **Pending-write blind spot** (inherited from Pinup). A remote change to a layer that is pending locally is ignored until the next change. That's acceptable for design work; document it.
- **Roles.** slop has admins only, so everyone is an editor. Pinup's contributor role (feedback only) needs a per-collection rule: `feedback/` writable at a lower role. That needs a role between pending and admin in `pkg/store/users.go`, a bigger decision than this ticket.
- **External requests.** Pinup and its exports load Google Fonts. That's fine in the editor, but published pages are meant to be self-contained (the agents help topic says so). The player could serve fonts from a data artifact or fall back to system stacks.
- **Boot data size.** The player gets the *whole* design as records, the same issue as NOTES §2 in SLOP-002. With images as data URLs that grows quickly, which is why `assets` matters before large designs go public.
- **Inbox needs an open tab.** See §6.7.

## 11. Keeping Pinup maintainable here

- **Upstream stays upstream.** Files in `web/pinup/src/01…99` change only when we import a new export from Ramon, or for small patches marked `// slop:`. slop-specific code lives in `src/00-slop-host.js`, `src/90-player.js` and `web/pinup/slop/`.
- **Re-importing.** Copy the new export over `src/`, run `node build.js`, record the new sha and source in the README's provenance table, then re-apply any `// slop:` patches: `git grep -n "// slop:" web/pinup`.
- **The contract test.** `tests/mock.js` is the host contract. When the adapter grows, keep `mock.js` and the adapter in step, so the upstream test suite keeps describing what slop must provide.

## Glossary

- **Capability**: a named host service obtained with `window.claude.use(name)`; `null` when absent.
- **Design file**: a `type: pinup` data artifact. Its live documents are the working copy; its versions are snapshots.
- **Docs store**: the new mutable, live JSON document table, keyed by (design artifact, path).
- **Grant**: a tool's one-hour bearer secret (`slg_…`) with only the approved permissions.
- **Step**: an inbox document with ordered ops, applied by an editor tab as one revertible history group.
- **Tombstone**: a deleted document kept with `data NULL` and a new `rev`, so that clients that were offline learn of the deletion.
