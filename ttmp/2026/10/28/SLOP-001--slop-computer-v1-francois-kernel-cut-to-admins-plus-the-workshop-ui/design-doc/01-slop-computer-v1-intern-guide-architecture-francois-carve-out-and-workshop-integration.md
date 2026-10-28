---
Title: 'slop.computer v1 intern guide: architecture, francois carve-out and Workshop integration'
Ticket: SLOP-001
Status: active
Topics:
    - backend
    - frontend
    - auth
    - architecture
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/francois/pkg/catalog/auth.go
      Note: guard(), Principal, OIDC login/callback/logout — copied and cut down
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/francois/pkg/catalog/store/tokens.go
      Note: API token scopes and ResolveToken — scopes renamed to read/write/admin
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/francois/pkg/catalog/store/device.go
      Note: device-code CLI login storage — copied as is
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/francois/pkg/catalog/device.go
      Note: device-code HTTP endpoints — copied
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/francois/pkg/catalog/admin.go
      Note: admin users/tokens/audit endpoints — only the user, token and audit routes survive
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/francois/pkg/catalog/store/users.go
      Note: UpsertIdentity, SetUserRole, Audit — copied, default role becomes pending
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/francois/pkg/catalog/releases/releases.go
      Note: Blobs content-addressed store (lines 22-197) — copied into pkg/blobs
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/francois/pkg/catalog/hosted/routes.go
      Note: inject() and page() show how francois injects a runtime into served HTML
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/francois/pkg/catalog/identity/oidc.go
      Note: ZITADEL OIDC provider (PKCE) — copied as is
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/francois/cmd/francois/cmds/auth.go
      Note: CLI device login commands — copied and renamed to slop auth
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/ttmp/2026/10/28/SLOP-001--slop-computer-v1-francois-kernel-cut-to-admins-plus-the-workshop-ui/sources/workshop/api.js
      Note: the fake API whose surface the real server must answer
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/ttmp/2026/10/28/SLOP-001--slop-computer-v1-francois-kernel-cut-to-admins-plus-the-workshop-ui/sources/workshop/render.js
      Note: how a version is rendered (runtime injection, preview bridge, tokens CSS)
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/ttmp/2026/10/28/SLOP-001--slop-computer-v1-francois-kernel-cut-to-admins-plus-the-workshop-ui/sources/workshop/app.js
      Note: the Workshop screens (Watch, Routes, Artifacts, Site, Admin)
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/ttmp/2026/10/28/SLOP-001--slop-computer-v1-francois-kernel-cut-to-admins-plus-the-workshop-ui/sources/workshop/seed.js
      Note: fake data whose shapes define the API payloads
    - Path: /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/ttmp/2026/10/28/SLOP-001--slop-computer-v1-francois-kernel-cut-to-admins-plus-the-workshop-ui/sources/slop-computer-directions.md
      Note: the product brainstorm (revision 2) this ticket implements a slice of
ExternalSources: []
Summary: "Intern-facing analysis, design and phased implementation guide for slop.computer v1: francois's catalog server cut down to admins (auth, tokens, device login, users, audit), a new artifact/version/route/comment kernel, and the Workshop UI (direction A) wired to the real API. The Desk is out of scope."
LastUpdated: 2026-10-28T15:30:00-04:00
WhatFor: "Onboarding an engineer who will build slop.computer v1 from francois and the Workshop prototype."
WhenToUse: "Read before touching any code in this repository; keep open while implementing phases 1-7."
---

# slop.computer v1: intern guide

This guide explains what slop.computer is, which parts of it already exist (in francois and in the Workshop prototype), and how to build the first real version. Read sections 1–3 first; they give you the whole picture. Sections 4 onward are the detail you will need while implementing.

Paths starting with `../francois/` are relative to this repository's root and point into the sibling checkout at `/home/manuel/workspaces/2026-10-28/slop-computer/francois` (commit `106776a`). Paths starting with `sources/` are relative to this ticket directory, where the Workshop prototype and the Directions brainstorm are copied.

---

## 1. Executive summary

slop.computer is a private workshop for two people (Manuel and Ramon) and their coding agents. Agents (Claude Code with a `slop` CLI) **push versions** of web artifacts to a server; the humans **look at those versions in the browser, comment on them by pointing at elements**, and decide **which version each URL serves**. The agent waits for comments, fixes things, and pushes again.

We build it from two existing things:

1. **francois** (`../francois`), a Go server that hosts HTML artifacts for paying subscribers. It already has the hard, boring parts: ZITADEL sign-in, browser sessions with CSRF, scoped API tokens, device-code login for a CLI, an admin API for users and tokens, an audit log and a content-addressed blob store. It also has a lot we do not want: Stripe billing, plans, per-user instances, members, demos, a storefront, analytics, email sign-in. **We copy the parts we want into this repository and leave the rest behind.**
2. **The Workshop** (`sources/workshop/`, from `slop.computer Workshop.zip`), a browser-only prototype of the UI ("direction A, the contact sheet"). It has five screens — Watch, Routes, Artifacts, Site, Admin — running on a fake in-browser API (`api.js`) seeded with fake data (`seed.js`). **We keep its design and behavior and rebuild it in React + RTK Query against the real server.**

The v1 deliverable is: one Go binary, `slop`, that runs the server (`slop serve`) and is also the CLI agents use (`slop push`, `slop route set`, `slop comments wait`, …), with the Workshop as its web UI, embedded in the binary (and run from a Vite dev server proxying to the API during development). Only artifacts — the pages and data the Workshop manages — live in the database and change live by pushing. `slop serve --local` runs the whole thing on a laptop with SQLite and nickname sign-in instead of Postgres and ZITADEL, so collaboration can be tested locally. Extra screens can be pushed as **tools** that run inside the Workshop with only the API permissions an admin approved. The Desk (direction B) and the Board (direction C) are explicitly later.

---

## 2. Orientation: the concepts you need first

Before any code, learn these nouns. Every table, endpoint and screen is built from them.

| Term | Meaning | Example |
| --- | --- | --- |
| **Artifact** | A named, versioned thing. Two kinds: **page** (HTML/CSS/JS with an `index.html`) and **data** (records stored as files: Markdown with front matter, JSON, CSV). | `pricing` (page), `journal` (data, type `post`) |
| **Version** | An immutable snapshot of one artifact: a **file tree** `{path → sha256}` plus a manifest, a message, an author and "via" (browser, cli, claude). Numbered `1, 2, 3…` per artifact. | `pricing v7` |
| **Ref** | A movable name pointing at one version of an artifact. v1 only uses `main`. | `pricing@main → v7` |
| **Manifest** | JSON stored with a version. For pages: `reads` (which data artifacts it reads, by name) and `tokens` (which tokens artifact gives it CSS variables). For data: `type`. | `{"reads":{"posts":"journal"},"tokens":"lab-tokens"}` |
| **Route** | A row in the route table: `(host, path pattern) → page artifact`, either following `main` or **pinned** to a version, with optional **data bindings** and a **record pattern**. | `slop.boutique /journal/:slug → journal-post@main, record posts/{slug}.md` |
| **Binding** | Which version of a data artifact a page's read-name means on this route. Defaults to the data artifact's `main`. | `posts → journal@3` |
| **Record** | One file of a data artifact, parsed into an object (front matter + rendered Markdown, or JSON fields). | `posts/routes-not-templates.md` |
| **Thread / comment** | A comment thread on one artifact version, **anchored** to an element (CSS selector + relative x/y) or to a record. Replies follow. Threads resolve. | "too much air between the tiers" on `section.tiers` |
| **Project** | A group of artifacts with a **brief** that agents read. In v1 each artifact belongs to one project. | `lab-site`, `play`, `workshop` |
| **Tool** | A pushed page that declares API permissions in `slop.json`; once an admin enables it, it appears in the Workshop's Tools menu and calls the API with a short-lived, permission-limited grant (§6.13). The core Workshop itself is never an artifact. | Release board |
| **Principal** | Who is calling: a browser session, an API token, or a tool grant, all resolving to a user. | Manuel via "claude code agent" token |
| **Role** | `admin` (full access), `pending` (signed in, sees nothing), `disabled`. | — |
| **Scope** | What a token may do: `read`, `write`, `admin`. | Claude Code gets `read,write` |

### 2.1 The loop, end to end

```
 Manuel's laptop                          slop.computer server                      Ramon's browser
 ─────────────────                        ─────────────────────                      ───────────────
 Claude Code edits ./pricing/
 $ slop push ./pricing -a pricing  ──▶  POST /api/blobs/missing, /api/blobs
       -m "three tiers"                   POST /api/artifacts/pricing/versions
                                          → version 6 stored, main → 6
                                          → event version.created  ──────────────▶  Watch: v6 lands in filmstrip
                                                                                     Ramon presses C, clicks tiers,
                                                                                     types "too much air"
                                          POST /api/artifacts/pricing/threads ◀────  (selector, fx, fy, styles)
 $ slop comments wait -p lab-site ◀──── long-poll returns thread th_8k2
 Claude Code reads anchor + styles,
 edits CSS
 $ slop push … --reply th_8k2      ──▶  version 7 + reply on th_8k2  ─────────────▶  reply appears; v7 in filmstrip
                                                                                     "Point /pricing at v7"
                                          PUT /api/routes  (slop.boutique,/pricing → v7)
                                          route_log row written            visitor: GET slop.boutique/pricing
                                                                                     → route table → pricing v7
```

### 2.2 What runs where

```
                 ┌───────────────────────────────────────────────────────────────────┐
                 │                         slop (one Go binary)                        │
                 │                                                                     │
 browser ──────▶ │  MAIN HOST  (slop.computer / localhost:8080)                         │
 (session        │    /                 Workshop SPA (embedded, /static/workshop/*)    │
  cookie)        │    /auth/*           ZITADEL OIDC login/callback/logout             │
                 │    /device           approve a CLI login                            │
                 │    /_/               safe mode (server-rendered, no JS)             │
                 │    /api/*            JSON API  ◀── also the CLI and MCP              │
                 │    /api/events       server-sent events                              │
                 │                                                                     │
 CLI / agent ──▶ │  /api/*  with  Authorization: Bearer slp_…                          │
                 │                                                                     │
 visitor ──────▶ │  SITE HOSTS (slop.boutique, boutique.localhost:8080)                 │
                 │    any path  → route table → page version → rendered HTML + files   │
                 │                                                                     │
 Workshop  ────▶ │  SANDBOX HOST (v7--pricing.slop.run, *.sandbox.localhost:8080)       │
 iframes         │    one origin per version; previews with the comment bridge         │
                 │                                                                     │
                 │  Postgres or SQLite      blobs on disk (sha256-addressed)           │
                 └───────────────────────────────────────────────────────────────────┘
```

Three host classes matter because of browser security. The main host carries the session cookie, so **no artifact code ever runs there** in v1. Site hosts and the sandbox host are different registrable domains (or, in development, different `*.localhost` names), so artifact JavaScript cannot read the session cookie or call the API as you.

---

## 3. Scope

### 3.1 In v1

- Copy from francois: OIDC sign-in (ZITADEL, PKCE), browser sessions with CSRF and Origin checks, API tokens with scopes, device-code CLI login and `credentials.json`, users with roles, the admin endpoints for users and tokens, the audit log, the blob store, the migration runner, `httpx` helpers, the Go API client base.
- New kernel: projects, artifacts (page/data), versions as file trees, `main` ref with compare-and-set, routes with bindings, record patterns and history, comment threads with anchors, an event log with SSE and long-poll, records parsing, server-side rendering of versions for site hosts and previews.
- The Workshop UI (Watch, Routes, Artifacts, Site, Admin) rebuilt in React + RTK Query with atoms/molecules/organisms, embedded in the binary, with a Vite dev proxy for quick iteration (§6.8, D3).
- The `slop` CLI: `serve`, `migrate`, `db users promote`, `auth login|status|logout`, `push`, `pull`, `artifacts list`, `route list|set|undo`, `comments wait|reply`.
- Safe mode at `/_/`.
- Tools: pushed pages with declared permissions, enabled by an admin, shown in the Workshop with permission-limited grants (§6.13).
- Local mode: `slop serve --local` with nickname identities (no ZITADEL) and SQLite (no Postgres); production uses ZITADEL and Postgres (§6.12).

### 3.2 Explicitly out of v1

- **The Desk** (direction B), the Board/Site mode (direction C), holes, takes as refs beyond `main`, turns and Keep/Drop review, project stage.
- **`window.claude`** for app artifacts (db, room, assets, sample/Pi worker). francois's hosted runtime is deliberately not copied in v1; it is the biggest non-membership subsystem and nothing in the Workshop needs it.
- Static export (`slop export --static`), `slop import`.
- MCP server (francois's plumbing is reusable; we add it once the CLI is stable — phase 7 is optional).
- Everything membership-related: billing, plans, credits, support tiers, instances, members, launch codes, grants, demos, storefront pages, journal/feeds, SEO, analytics, email sign-in, Google/GitHub IdP shortcuts, settings documents.

---

## 4. Current state: what exists today

### 4.1 francois, the parts we keep

francois's hosted server is `francois catalog serve`. Its HTTP surface is registered in `../francois/pkg/catalog/routes.go:21-135`; its Go is ~20.7k lines in `pkg/catalog/...` (non-test). The survivors are small and well-isolated:

| Concern | francois file | What it does | Lines |
| --- | --- | --- | --- |
| Request guard | `pkg/catalog/auth.go:102-162` | `guard(level, scope, h)`: resolves cookie session **or** bearer token, checks role/disabled, enforces Origin + `X-CSRF-Token` on browser mutations, puts a `*Principal` in the context. | 60 |
| Access levels and scopes | `pkg/catalog/auth.go:68-100` | `public < session < enabled < creator < admin`; scopes `noToken`, `anyToken`, `studio`, `account`, `admin` (`admin:read` for GET, `admin:write` otherwise). | 30 |
| OIDC login | `pkg/catalog/auth.go:186-267`, `pkg/catalog/identity/oidc.go` | `/auth/login` stores a login flow (state, nonce, PKCE verifier, binding cookie), redirects to ZITADEL; `/auth/callback` consumes the flow, exchanges the code, `UpsertIdentity`, `CreateSession`, sets `__Host-…_session`. | ~250 |
| Logout | `pkg/catalog/auth.go:269-291` | Revokes session, returns IdP end-session URL. | 22 |
| Sessions store | `pkg/catalog/store/sessions.go` | Login flows, sessions (hashed token, CSRF, idle + absolute expiry). | 119 |
| Users store | `pkg/catalog/store/users.go:41-73,124-218` | `UpsertIdentity`, `SetUserRole`, `SetUserDisabled`, `Audit`, `AuditQuery`. | ~200 |
| Tokens | `pkg/catalog/store/tokens.go`, `pkg/catalog/tokens.go` | `slp`-style prefixed secrets stored hashed, scopes array, `Allows(need)`, `ResolveToken`; `/api/me`, `/api/tokens` CRUD. | ~290 |
| Device login | `pkg/catalog/store/device.go`, `pkg/catalog/device.go:29-33`, migration `019_device_authorizations.sql` | `POST /api/device/authorize` → user code + device code; browser approves at `/device`; CLI polls `POST /api/device/token` and receives a token. | ~480 |
| CLI credentials | `pkg/catalog/credentials/credentials.go` | `~/.config/francois/credentials.json`, 0600, atomic save, per-server entries. | 299 |
| CLI auth commands | `cmd/francois/cmds/auth.go` | `auth login/status/token/logout` (glazed). | — |
| Admin users/tokens/audit | `pkg/catalog/admin.go:24-29,48-49` and handlers `242-…` | list/get/patch users (self-lockout guard), revoke sessions, list/revoke tokens, audit query. | ~250 of 713 |
| Blobs | `pkg/catalog/releases/releases.go:22-197` | `Blobs{Root}`: `Put`, `PutReader`, `Open`, `Read`, `Missing` — sha256-keyed files on disk. | 175 |
| DB + migrations | `pkg/catalog/store/store.go:30-135` | pgx pool, embedded SQL migrations applied in order, `NewID`, `RandomHex`, `Hash`. | 159 |
| HTTP helpers | `pkg/catalog/httpx/httpx.go` | `OK`, `Fail(w, status, code, msg)`, `Read` with size limit. | ~50 |
| API client | `pkg/catalog/client/client.go` | Base URL + token, retries, JSON and multipart helpers. | 250 |

Key existing behavior to keep in mind:

- **Users are created on first sign-in** by `UpsertIdentity` (`users.go:41`). The `role` column default comes from the migration (`subscriber` in `001_core.sql:9`, widened in `004_storefront.sql:6`). In slop.computer the default becomes `pending`.
- **The first admin is promoted from the deployment**, not the UI: `francois catalog db users promote --issuer … --subject …` (`cmd/francois/cmds/catalog.go:382-425`). We keep this as `slop db users promote`.
- **Tokens never pass CSRF**; they are not ambient credentials (`auth.go:146-158`). Audit rows record the token ID via `store.WithAuditToken` (`auth.go:129`, `store/audit.go`).
- **Self-lockout protection**: an admin cannot demote or disable themselves (`admin.go:252`).

### 4.2 francois, the parts we drop

For orientation only — do not copy these: `billing/`, `payments/`, `settings/` (plans, credit weights, storefront copy), `content/` (markdown/media for storefront; we only reuse goldmark as a dependency), `hosted/` (instances runtime — deferred, see §3.2), `mcpserver/` (later), `web/` templates and the React portal in `ui/catalog/` (~6.5k lines TSX), `pages.go`, `studio.go`, `feed.go`, `seo.go`, `analytics.go`, `demos.go`, `share.go`, `support.go`, `entitlement.go`, `instances.go`, `email_signin.go`, `fonts.go`, and migrations 002–007, 009–018, 020–021. Also the local `francois serve` mode (`pkg/host`, `pkg/store`, `pkg/piworker`) is unrelated to us.

### 4.3 The Workshop prototype

Eight files, ~2.9k lines of plain JavaScript, no build step (`sources/workshop/`). Since the owner's review (§12) the Workshop is **rewritten** in React + RTK Query; the files below are the reference for look, behavior and data shapes, not code we keep (except `style.css` and the bridge). `index.html` loads them in order:

| File | Role today | Role in v1 |
| --- | --- | --- |
| `style.css` (285) | The Boutique Workbench look. | Kept as is. |
| `boutique-css.js` (359) | slop.boutique's stylesheet as a JS string, used by seed pages. | Only needed by the dev seed; moves to the seed tool. |
| `seed.js` (630) | Fake data: 3 users, 3 projects, 11 page + 3 data artifacts with histories, 5 shell artifacts (dropped by the dev seed: the Workshop is not an artifact), routes on `slop.computer` and `slop.boutique`, threads, tokens, audit, console lines, 2 fake agents. | Becomes a **dev seed** (`slop dev seed`) that pushes the same content through the real API, so the Workshop looks the same on day one. |
| `api.js` (230) | Fake `window.slop`: in-memory state, op log in `localStorage`, `on/emit` events, route matching. | **Replaced** by `client.js`, same surface, backed by HTTP + SSE (decision D2). |
| `render.js` (264) | Builds a `srcdoc` for a version: inlines CSS/JS, injects `window.slop` (route, params, data, tokens), adds the preview **bridge** (pick element, pins, link interception), parses Markdown/front matter. | Rendering moves to Go (`pkg/serve`); the **bridge** and **runtime** scripts move to embedded static files the server injects. `render.js` shrinks to URL helpers. |
| `agent.js` (125) | Two simulated Claude Codes that answer comments with regex → CSS rules. | **Dropped.** Real Claude Code + `slop comments wait` replaces it. The console pane shows real waiters (see §6.6). |
| `app.js` (1020) | The five screens, hash-routed (`#watch`, `#routes`, …), DOM built with a tiny `h()` helper. | Kept; edited where it reads file contents synchronously or builds `srcdoc`. |
| `index.html` (14) | Loads the scripts. | Served at `/`, scripts under `/static/workshop/`. |

The fake API's public surface (`api.js:147-227`) is effectively the **contract** the real server must satisfy:

```js
slop.users.list() / get(id) / setRole(id, role, by)
slop.projects.list() / get(id)
slop.artifacts.list() / get(id) / latest(id)
slop.versions.list(id) / get(id, n) / main(id)
slop.push(id, { files, base, message, by, via, session, reply, create, manifest, remove, moveMain })
slop.routes.list(host) / hosts() / get(host, path) / set(route, by, note) / remove(host, path, by)
           / log(host, path) / using(id) / readers(id) / resolve(host, path) / bindingsFor(v, r) / match(p, path)
slop.comments.list(id) / get(tid) / create(id, {version, anchor, by, text}) / reply(tid, {...}) / resolve(tid, by, resolved)
slop.tokens.list() / revoke(id, by) / create({by, name, scopes, days}) → { token, secret }
slop.audit.list()
slop.on(type, fn) / off(type, fn)        // types: push, route.set, route.remove, thread.create, thread.reply, thread.resolve, ...
```

Data shapes come from `seed.js:451-629`. The important ones:

```js
artifact = { id, title, kind: 'page'|'data', project, trust: 'app'|'shell'|null, type?, viewer?, refs: { main: n }, versions: [...] }
version  = { n, files: { path: contents }, manifest, message, by, via: 'claude'|'cli'|'browser', session, at, reply }
route    = { host, path, page, version: n|null, bindings: { name: { artifact, version } }, record: 'posts/{slug}.md'|null,
             access: 'public'|'admins', changedBy, changedAt }
thread   = { id, artifact, version, anchor: { selector, fx, fy, text } | { record, field }, by, at, resolved,
             comments: [{ by, agent?, at, text, version? }] }
token    = { id, owner, name, scopes: ['read','write','admin'], created, lastUsed, expires, revoked? }
```

How it renders a page today (`render.js:211-232`): take `files['index.html']`, inline `<link rel=stylesheet>` and `<script src>` siblings from the tree, compute bindings (`api.js:125-132`), parse each bound data version into records (`render.js:49-65`), then prepend two scripts to `<head>` — the **runtime** (`render.js:186-193`, defines `window.slop = { route, data, record, version, mode, tokens }`) and the **bridge** (`render.js:80-183`, talks to the parent via `postMessage`) — and append tokens CSS (`render.js:70-77`). The iframe has `sandbox="allow-scripts"` (`app.js:75-79`).

How routing resolves (`api.js:105-144`): split pattern and path into segments; `:name` captures, `*` captures the rest; `'*'` alone is the fallback; rows are tried in descending **specificity** (literal = 3, `:param` = 2, `*` = 1 per segment, fallback = −1). The record pattern is filled from params.

---

## 5. Gap analysis

| Needed by the Workshop / directions | francois has | Gap |
| --- | --- | --- |
| Admin-only access with pending users | Roles `subscriber/creator/admin/guest` + `disabled` bool | New role set `admin/pending/disabled`; guard levels collapse to `public`, `session`, `admin`. |
| Token scopes `read/write/admin` | `studio/account/admin:read/admin:write` | Rename scopes; method-based mapping (GET → read, mutation → write, admin routes → admin). |
| Artifacts with kind/project | `catalog_artifacts` (storefront columns) | New table. |
| Versions as file trees | `releases` + `release_files` (only `html`, `manifest`) | New `versions` + `version_files`; blobs reused. |
| Refs with compare-and-set | none | New `refs`. |
| Route table with bindings and history | Hardcoded `routes.go` | New `routes`, `route_log`, resolver, site-host handler. |
| Data records | none | New `pkg/records` (front matter + goldmark). |
| Comment threads with anchors | `instance_*` comments per instance (hosted runtime) | New `threads`, `comments` keyed by artifact. |
| Live updates to the UI | none on the portal | New `events` table + broker + SSE. |
| `comments wait` | none | Long-poll endpoint on the same events. |
| Serving a version with injected runtime | `hosted/routes.go:166-222` (`inject`) | Reuse the injection idea; new `pkg/serve` with bridge + tokens. |
| Workshop reads synchronously | n/a | Client mirror store (D2). |

---

## 6. Proposed architecture

### 6.1 Repository layout

This repository becomes a Go module (`github.com/go-go-golems/slop-computer`, binary `slop`) and is added to `../go.work` next to francois. Follow `../AGENT.md`: one top-level `go.mod`, cobra/glazed commands, `github.com/pkg/errors`, zerolog with `--log-level`, errgroup for goroutines, static files under `/static/`.

```
cmd/slop/main.go
cmd/slop/cmds/
    serve.go migrate.go db_users.go           # operator
    auth.go                                     # copied from francois cmds/auth.go
    push.go pull.go artifacts.go routes.go comments.go dev_seed.go
pkg/store/              # database/sql, Postgres + SQLite; ported: store.go users.go sessions.go tokens.go device.go audit.go
                        # new: projects.go artifacts.go versions.go refs.go routes.go threads.go events.go
pkg/store/migrations/   # postgres/ and sqlite/, each: 001_auth.sql (carved from francois) 002_kernel.sql (new)
pkg/identity/           # Provider interface; oidc.go (copied) and local.go (nicknames, §6.12)
pkg/httpx/              # copied as is
pkg/blobs/              # Blobs from francois releases.go
pkg/credentials/        # copied; Dir → ~/.config/slop
pkg/client/             # copied base client.go + new typed calls
pkg/routing/            # Match, Specificity, Resolve (Go port of api.js:105-144)
pkg/records/            # front matter + Markdown/JSON/CSV → records (port of render.js:8-69)
pkg/serve/              # render a version: inject runtime/bridge/tokens; site + sandbox handlers
pkg/events/             # broker: append to events table, fan out to SSE and long-pollers
pkg/server/             # http: routes(), guard, auth, device, tokens, users, kernel endpoints, safe mode
pkg/web/                # go:embed: Workshop build (workshop/), runtime.js, bridge.js, templates (/_/, /device)
web/workshop/           # Vite + React + RTK Query + TypeScript, pnpm (§6.8)
web/preview/            # runtime.js bridge.js (plain JS injected into served pages)
deploy/compose/         # postgres + zitadel + zitadel-setup (from francois, minus stripe)
```

### 6.2 Database schema

The DDL below is the Postgres dialect; the SQLite files follow §6.2.1. Migration `001_auth.sql` is carved from francois (`001_core.sql`, `004_storefront.sql`, `008_token_scopes.sql`, `019_device_authorizations.sql`); `002_kernel.sql` is new.

```sql
-- 001_auth.sql
CREATE TABLE users (
  id text PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
  email text NOT NULL DEFAULT '', email_verified boolean NOT NULL DEFAULT false,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'pending' CHECK (role IN ('admin','pending','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz,
  UNIQUE (issuer, subject));
CREATE TABLE login_flows (...);            -- as francois 001_core.sql
CREATE TABLE sessions (...);               -- as francois, plus id_token text (003_session_id_token.sql)
CREATE TABLE api_tokens (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), name text NOT NULL,
  token_hash bytea NOT NULL UNIQUE, scopes text[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz);
CREATE TABLE device_authorizations (...);  -- as francois 019
CREATE TABLE audit (id bigserial PRIMARY KEY, actor_id text, token_id text, via text NOT NULL DEFAULT 'browser',
  action text NOT NULL, subject text NOT NULL, summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now());

-- 002_kernel.sql
CREATE TABLE projects (id text PRIMARY KEY, name text NOT NULL, brief text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE artifacts (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title text NOT NULL, kind text NOT NULL CHECK (kind IN ('page','data')),
  type text,                                 -- data: post | records | tokens
  viewer text REFERENCES artifacts(id),      -- data: the page that shows one record
  project_id text REFERENCES projects(id),
  created_by text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE versions (
  artifact_id text NOT NULL REFERENCES artifacts(id), n integer NOT NULL,
  parent integer, manifest jsonb NOT NULL DEFAULT '{}', message text NOT NULL DEFAULT '',
  author_id text NOT NULL REFERENCES users(id), token_id text, via text NOT NULL,   -- browser|cli|claude
  session text, reply_thread text, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artifact_id, n));
CREATE TABLE version_files (
  artifact_id text NOT NULL, n integer NOT NULL, path text NOT NULL,
  sha256 text NOT NULL, size bigint NOT NULL, media_type text NOT NULL,
  PRIMARY KEY (artifact_id, n, path), FOREIGN KEY (artifact_id, n) REFERENCES versions);
CREATE TABLE refs (artifact_id text NOT NULL REFERENCES artifacts(id), name text NOT NULL, n integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (artifact_id, name));
CREATE TABLE routes (
  host text NOT NULL, path text NOT NULL, page text NOT NULL REFERENCES artifacts(id),
  version integer,                          -- NULL = follow main
  bindings jsonb NOT NULL DEFAULT '{}',     -- {name: {artifact, version|null}}
  record text, access text NOT NULL DEFAULT 'public' CHECK (access IN ('public','admins')),
  changed_by text REFERENCES users(id), changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (host, path));
CREATE TABLE route_log (id bigserial PRIMARY KEY, host text NOT NULL, path text NOT NULL,
  from_state jsonb, to_state jsonb, note text NOT NULL DEFAULT '', by_user text, token_id text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE threads (id text PRIMARY KEY, artifact_id text NOT NULL REFERENCES artifacts(id), version integer NOT NULL,
  anchor jsonb NOT NULL, created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, resolved_by text);
CREATE TABLE comments (id bigserial PRIMARY KEY, thread_id text NOT NULL REFERENCES threads(id),
  author_id text NOT NULL REFERENCES users(id), token_id text, agent boolean NOT NULL DEFAULT false,
  version integer, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE events (seq bigserial PRIMARY KEY, type text NOT NULL, project_id text, artifact_id text,
  actor_id text, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
```

Why `sessions` vs work "session": francois's `sessions` table means *browser login sessions*. The Directions doc also uses "session" for a sitting of work. In v1 the work session is only a free-text label on a version (`versions.session`); it gets its own table (`work_sessions`) when turns arrive. Never name a new table `sessions`.

#### 6.2.1 One schema, two databases

The store targets both Postgres (production) and SQLite (local mode and the default test database). Rules that keep one store implementation working on both:

| Concern | Postgres | SQLite | Rule in our code |
| --- | --- | --- | --- |
| Driver | `pgx/v5/stdlib` | `modernc.org/sqlite` (pure Go, no cgo) | `database/sql` everywhere; no `pgx.Row`, `pgxpool`, `pgx.Tx` |
| Placeholders | `$1` | `?` | write `?`; `store.rebind()` rewrites to `$n` for Postgres (sqlx-style) |
| Auto IDs | `bigserial` | `INTEGER PRIMARY KEY AUTOINCREMENT` | per-dialect DDL; text IDs from `NewID()` otherwise |
| Arrays (`scopes`) | `text[]` | — | store as JSON text in both; scan through a `JSONList` type |
| JSON (`manifest`, `anchor`, `bindings`, `payload`) | `jsonb` | `TEXT` | JSON text in both; never query inside JSON in SQL |
| Bytes (hashes) | `bytea` | `BLOB` | `[]byte` |
| Time | `timestamptz` | `TEXT` (RFC 3339, UTC) | pass `time.Time` from Go; never `now()` in queries |
| Upsert / returning | `ON CONFLICT … DO UPDATE`, `RETURNING` | same (SQLite ≥ 3.35) | allowed |
| Row locks | `SELECT … FOR UPDATE` | n/a (writers serialised) | `store.forUpdate()` appends ` FOR UPDATE` on Postgres only |
| Advisory locks | `pg_advisory_xact_lock` | n/a | not used; francois needed them for email collisions we no longer have |
| Regex `CHECK` | `~` | not available | validate IDs in Go, not in DDL |
| Case-insensitive email | `lower(email)` index | `lower(email)` index | same |

Migrations live in `pkg/store/migrations/postgres/*.sql` and `pkg/store/migrations/sqlite/*.sql` with the same file names; a test asserts both directories list the same migrations and that the resulting schemas have the same tables and columns (`information_schema` vs `pragma_table_info`).

This means francois's store files are **ported, not copied verbatim**: the SQL text and the logic carry over, the pgx-specific calls (≈75 call sites across `users.go`, `sessions.go`, `tokens.go`, `device.go`, `store.go`) become `database/sql`, `text[]` becomes JSON, and `UpsertIdentity`'s advisory lock and email-collision check are dropped.

### 6.3 Authentication and authorization

The guard stays francois's shape (`auth.go:102-162`) with fewer levels:

```go
const ( public = iota; session; admin )   // pending/disabled users fail `admin`

type scope string
const ( noToken scope = ""; anyToken = "*"; scopeRW = "rw"; scopeAdmin = "admin" )

// required: scopeRW → "read" for GET/HEAD, "write" otherwise; scopeAdmin → "admin"
func (s *Server) guard(level int, sc scope, h http.HandlerFunc) http.HandlerFunc {
    p := sessionPrincipal(r)                         // cookie
    if p == nil && bearer startsWith "slp_" {
        if sc == noToken → 401 token_not_allowed
        t, u := Store.ResolveToken(secret)            // 401 token_invalid
        if sc != anyToken && !t.Allows(sc.required(r.Method)) → 403 token_scope
        p = {User: u, Token: &t}; ctx = WithAuditToken(ctx, t.ID)
    }
    if level >= session && p == nil          → 401 login_required
    if level >= admin && p.User.Role != "admin" → 403 admin_required   // pending + disabled stop here
    if mutation && p.Token == nil            → check Origin + X-CSRF-Token
    h(w, r.WithContext(withPrincipal(ctx, p)))
}
```

Rules worth memorizing:

- **Every kernel route is `admin` level.** Pending users only reach `/api/me` (`session, anyToken`) and see a "waiting to be let in" screen.
- **Token scopes are ceilings, not grants.** A `write` token of a pending user still fails `admin`.
- **`admin` scope** gates users, tokens of other people and the audit log. Claude Code's token is `read,write`, so an agent can push and route artifacts but never let users in or mint tokens.
- **Scopes a role may mint** (`ScopesForRole`, `tokens.go:26`): admin → `read, write, admin`; others → none.
- Bearer tokens skip CSRF (they aren't ambient). Cookies are `__Host-slop_session` in production, `SameSite=Lax`, `HttpOnly`.

Sign-in sequence (unchanged from francois):

```
browser            slop                            ZITADEL
  │ GET /auth/login?return=/  │                         │
  │──────────────────────────▶│ SaveLoginFlow(state,    │
  │                           │  nonce, verifier, H(b)) │
  │◀── 303 + cookie flow=b ───│                         │
  │──────── authorize?state&code_challenge ────────────▶│
  │◀─────── 303 /auth/callback?code&state ──────────────│
  │ GET /auth/callback        │ ConsumeLoginFlow(state,H(b))
  │──────────────────────────▶│ Exchange(code, verifier) ─▶ id token
  │                           │ UpsertIdentity → role pending on first sign-in
  │◀── 303 return + session ──│ CreateSession
```

Device login (unchanged, renamed): `slop auth login --server https://slop.computer` → `POST /api/device/authorize {client, scopes, days}` → prints `ABCD-EFGH` and `https://slop.computer/device?code=ABCD-EFGH` → the signed-in admin approves (picks scopes ≤ role) → CLI polling `POST /api/device/token` receives `slp_…` → stored in `~/.config/slop/credentials.json` (0600). `SLOP_TOKEN` and `--token-file` override, as `FRANCOIS_TOKEN` does today.

### 6.4 API reference (v1)

All JSON. Errors are `{"error":{"code","message"}}` from `httpx.Fail`. Level/scope column uses the guard notation.

**Identity, users, tokens (mostly copied)**

| Method & path | Guard | Body → Response |
| --- | --- | --- |
| `GET /auth/login?return=` | public | redirect to IdP |
| `GET /auth/callback` | public | sets session, redirects |
| `POST /auth/logout` | session, noToken | `{ok, redirect?}` |
| `GET /api/me` | session, anyToken | `{user:{id,name,email,role}, token?:{id,scopes}, csrfToken?}` |
| `GET /api/users` | admin, admin | `[{id,name,email,role,lastSeen,created}]` |
| `PATCH /api/users/{id}` | admin, admin | `{role}` → `{ok}`; 409 `self_lockout` |
| `POST /api/users/{id}/revoke-sessions` | admin, admin | `{tokens?:bool}` |
| `GET /api/tokens` | admin, noToken | the caller's tokens; `?all=1` lists everyone's (admin) |
| `POST /api/tokens` | admin, noToken | `{name, scopes, days}` → `{token, secret}` (secret shown once) |
| `DELETE /api/tokens/{id}` | admin, noToken | revoke |
| `POST /api/device/authorize`, `POST /api/device/token` | public | as francois |
| `GET /api/device/requests/{code}`, `POST …/approve`, `POST …/deny` | session/admin, noToken | as francois |
| `GET /api/audit?limit=&subject=` | admin, admin | `[{at, actor, via, action, subject, summary}]` |

**Kernel (new)**

| Method & path | Guard | Body → Response |
| --- | --- | --- |
| `GET /api/projects`, `GET /api/projects/{id}` | admin, rw | project + brief |
| `GET /api/artifacts?project=` | admin, rw | list |
| `POST /api/artifacts` | admin, rw | `{id,title,kind,type?,viewer?,project}` |
| `PATCH /api/artifacts/{id}` | admin, rw | title/project/viewer |
| `GET /api/artifacts/{id}/versions` | admin, rw | `[{n, parent, message, by, via, session, at, reply, manifest, files:{path:{sha256,size,type}}}]` |
| `GET /api/artifacts/{id}/versions/{n}` | admin, rw | one version (`n` may be `main`) |
| `GET /api/artifacts/{id}/versions/{n}/files/{path...}` | admin, rw | raw bytes, `ETag: sha256` |
| `GET /api/artifacts/{id}/versions/{n}/records` | admin, rw | parsed records (data artifacts) |
| `POST /api/blobs/missing` | admin, rw | `{sha256:[...]}` → `{missing:[...]}` |
| `PUT /api/blobs/{sha256}` | admin, rw | raw body; server verifies hash |
| `POST /api/artifacts/{id}/versions` | admin, rw | push, see below |
| `PUT /api/artifacts/{id}/refs/{name}` | admin, rw | `{n, expect?}` compare-and-set |
| `GET /api/routes?host=` | admin, rw | rows |
| `PUT /api/routes` | admin, rw | `{host,path,page,version?,bindings?,record?,access?,note?}` |
| `DELETE /api/routes?host=&path=` | admin, rw | |
| `GET /api/routes/log?host=&path=` | admin, rw | history |
| `POST /api/routes/undo` | admin, rw | `{host,path}` → applies the last log entry's `from_state` |
| `GET /api/resolve?host=&path=` | admin, rw | `{route, params, page, n, bindings, record}` — what a visitor would get |
| `GET /api/threads?artifact=&project=&open=` | admin, rw | threads with comments |
| `POST /api/artifacts/{id}/threads` | admin, rw | `{version, anchor, text}` |
| `POST /api/threads/{id}/replies` | admin, rw | `{text, version?, agent?}` |
| `POST /api/threads/{id}/resolve` | admin, rw | `{resolved}` |
| `GET /api/comments/wait?project=&artifact=&after=&timeout=` | admin, rw | long-poll; returns the next `thread.created`/`comment.created` event by someone else, or 204 |
| `GET /api/events?after=` | admin, rw | `text/event-stream`; each event `id: seq`, `event: type`, `data: payload` |
| `GET /api/agents` | admin, rw | current long-poll waiters: `{user, token name, project, since}` |
| `GET /api/sandbox-url?artifact=&n=&mode=` | admin, noToken | signed preview URL for a Workshop iframe |

**Push request** (`POST /api/artifacts/{id}/versions`):

```json
{ "base": 6,                                   // version the tree was edited from; null for a new artifact
  "tree": { "index.html": "9f2c…", "boutique.css": "41aa…" },   // complete tree: path → sha256
  "manifest": { "reads": {"posts":"journal"}, "tokens": "lab-tokens" },
  "message": "Tiers: gap 48 → 24px",
  "via": "claude",                             // browser | cli | claude
  "session": "sess-manuel-1028",
  "reply": { "thread": "th_8k2", "text": "Done in v7: …" },
  "create": { "title": "Pricing", "kind": "page", "project": "lab-site" },   // only if the artifact is new
  "moveMain": true, "force": false }
```

Response `201 {artifact, version:{n,…}, main: 7}`; `409 missing_blobs {missing:[…]}` if a sha is not uploaded; `409 main_moved {main: 8}` if `base != main` and `force` is false.

### 6.5 Push, pseudocode

```go
func (s *Server) push(w, r) {
    in := read[PushRequest](r)
    p  := principal(r)
    tx := Store.Begin()
    a, err := tx.ArtifactForUpdate(id)                   // SELECT … FOR UPDATE serializes pushes per artifact
    if notFound { if in.Create == nil → 404; a = tx.CreateArtifact(id, in.Create) }
    if missing := Blobs.Missing(values(in.Tree)); len(missing) > 0 → 409 missing_blobs
    main := tx.Ref(id, "main")
    if in.Base != main && !in.Force → 409 main_moved
    n := tx.MaxVersion(id) + 1
    tx.InsertVersion(id, n, parent=in.Base, manifest, message, p.User.ID, p.TokenID, via, session)
    for path, sha := range in.Tree { tx.InsertVersionFile(id, n, cleanPath(path), sha, size, mediaType(path)) }
    if in.MoveMain { tx.SetRef(id, "main", n) }
    if in.Reply != nil { tx.InsertComment(in.Reply.Thread, p, agent = via=="claude", version=n, text) }
    tx.Audit(p, "version.push", id+" v"+n)
    ev := tx.AppendEvent("version.created", {artifact:id, n, by, via, message, project})
    tx.Commit()
    Broker.Publish(ev)                                   // after commit only
    201 {…}
}
```

Validation to copy from francois's `releases.Validate` spirit: path must be relative, no `..`, no leading `/`, ≤ 512 chars; a page version must contain `index.html`; per-file and per-version size limits; manifest must be a JSON object; `reads` values must name existing data artifacts.

### 6.6 Events, SSE and `comments wait`

One mechanism serves the Workshop's live updates and the agent loop.

```
 handler (in tx) ── AppendEvent → events table (seq)      commit ── Broker.Publish(ev)
                                                                     │
                       ┌─────────────────────────────────────────────┼───────────────────────────┐
                       ▼                                             ▼                           ▼
            SSE /api/events?after=seq                 long-poll /api/comments/wait        (later) MCP notifications
            replays rows > after, then live           filter: type ∈ {thread.created,
                                                       comment.created}, project/artifact,
                                                       actor ≠ caller; first match → 200
```

```go
type Broker struct { mu sync.Mutex; subs map[*sub]struct{} }
func (b *Broker) Subscribe(after int64, filter func(Event) bool) (<-chan Event, func())
// Subscribe first, then replay from the table (seq > after), then forward live events with seq > lastReplayed.
// This ordering prevents losing an event that commits between replay and subscribe.
```

`comments wait` registers its caller in an in-memory `waiters` map while blocked; `GET /api/agents` lists it, and the Workshop's console pane shows "Claude Code (Manuel's) is waiting on lab-site" — the real version of the prototype's fake agents. Timeout defaults to 55 s so proxies don't cut it; the CLI loops. Event types: `version.created`, `ref.moved`, `route.set`, `route.removed`, `thread.created`, `comment.created`, `thread.resolved`, `user.role`, `token.created`, `token.revoked`, `artifact.created`, `artifact.updated`.

Single replica is assumed (two users). If we ever run two replicas, swap the in-process broker for Postgres `LISTEN/NOTIFY`; the events table already gives ordering.

### 6.7 Serving versions: routing, records and rendering

This is the part that turns the Workshop's `render.js` into server code.

**Routing** (`pkg/routing`, port of `api.js:105-144`):

```go
func Match(pattern, path string) (map[string]string, bool)   // ":x" captures a segment, "*" the rest, "*" alone = fallback
func Specificity(pattern string) int                         // literal 3, :param 2, * 1; fallback -1
func Resolve(rows []Route, host, path string) (*Resolution, bool) {
    sort rows of host by Specificity desc
    for r in rows { if params, ok := Match(r.Path, path); ok {
        return &Resolution{Route: r, Params: params, Record: fill(r.Record, params)}, true } }
    return nil, false
}
```

Port the JS tests first (§8): same inputs must produce the same outputs in both languages.

**Bindings** (port of `api.js:125-132`): start from the page version's `manifest.reads` (`name → artifact @ main`), add `$tokens` from `manifest.tokens`, override with `route.bindings`, then resolve each to a concrete `n`.

**Records** (`pkg/records`, port of `render.js:33-65`): for each file of a data version, sorted by path: `.md` → front matter (YAML-ish key: value, `[a, b]` lists, booleans) + body + `html` (goldmark, which francois already depends on) + `minutes`; `.json` → parsed object + `id`, `path`; `.csv` → `{id, path, csv}`; otherwise `{id, path, text}`. `id` is the file's base name without extension. `tokens` data returns no records; its `tokens.json` becomes CSS variables (`render.js:70-77`).

**Rendering** (`pkg/serve`):

```go
type Ctx struct { Mode string /* site|preview|thumb */; Host, Path string; Params map[string]string; Record string; Bindings map[string]Binding }

func (s *Serve) Index(a Artifact, v Version, c Ctx) ([]byte, error) {
    html := Blobs.Read(v.Files["index.html"])
    data := map[string][]Record{}; var tokens *Tokens
    for name, b := range c.Bindings { if name == "$tokens" { tokens = tokensOf(b) } else { data[name] = records(b) } }
    boot := json(Boot{Route:{Host,Path,Params}, Data: data, Record: c.Record, Version:{a.ID, v.N}, Mode: c.Mode, Tokens: tokens})
    head := `<script type="application/json" id="slop-boot">` + escapeLT(boot) + `</script>` +
            `<script src="/_slop/runtime.js"></script>`
    if c.Mode != "site" { head += `<script src="/_slop/bridge.js" data-mode="` + c.Mode + `"></script>` }
    tail := tokensCSS(tokens)                               // <style data-slop="tokens">html:root{--ink:…}</style>
    return injectHead(html, head, tail), nil                // same approach as francois hosted/routes.go:201 inject()
}
```

Unlike the prototype, the server **does not inline** sibling files: it serves them at their tree paths, so `<link href="boutique.css">` fetches `…/boutique.css` from the same origin. Images, fonts and multi-file artifacts then work without special cases. `/_slop/runtime.js` and `/_slop/bridge.js` are reserved paths on site and sandbox hosts, embedded from `pkg/web` (they are `render.js:186-193` and `render.js:80-183`, lifted into files; the runtime reads `#slop-boot` instead of a function argument).

**Site hosts** (configured with `--site-host slop.boutique`; dev `boutique.localhost:8080`):

```
GET https://slop.boutique/journal/routes-not-templates
  → Resolve(routes for host, "/journal/routes-not-templates")  → journal-post@main, params{slug}, record posts/routes-not-templates.md
  → if route.access == "admins" → 404 for everyone (v1 has no viewer sessions on site hosts)
  → if the request path is a file in the page's tree (e.g. /journal/boutique.css)? see below
  → Index(...) with Mode "site"
```

Sibling files under parameterized routes are awkward (`/journal/boutique.css` would match `/journal/:slug`). Rule for v1: the server first tries the request path's **last segment** as a file of the resolved page's tree, but only for paths with an extension; otherwise renders `index.html`. Page authors should prefer root-relative asset paths under a reserved prefix: `/_v/<artifact>/<n>/<path>`, which the server rewrites nothing for — it simply serves that file. `slop push` warns about relative asset links in pages that are routed with parameters. (Open question Q6.)

**Sandbox host** (`--sandbox-domain slop.run`; dev `sandbox.localhost:8080`): `s<label>.<sandbox>/<path>` serves one version of one artifact with Mode `preview` (or `thumb` with `?mode=thumb`). The label is `"s"` + 20 hex characters of HMAC-SHA256(server key, artifact‖n), stored in `sandbox_labels` (`pkg/store/sandbox.go`); `GET /api/sandbox-url?artifact=&n=&mode=&host=&path=` (admins only) returns the URL, with `?parent=<Workshop origin>` so the bridge knows whom to talk to. Each version gets its own origin, so `localStorage` and cookies of one draft never leak into another. *As built (phase 3):* the label itself is the access check — an unguessable capability URL — instead of the signed-cookie exchange first planned here, because the Workshop frames previews from another site and cookies there are third-party (blocked by more and more browsers). A preview for a route context passes `?host=&path=` so bindings and params match what the route would serve.

**Assets of routed pages** (as built): a page routed at `/pricing` that links `style.css` makes the browser ask for `/style.css`, which no route serves. The site host looks for the file in the page the path resolves to (works for `/journal/style.css` under `/journal/:slug`), then in the page the `Referer` resolves to; `/_v/<artifact>/<n>/<file>` always works. Admins-only routes stay invisible through all three.

### 6.8 The Workshop in React + RTK Query

The prototype's screens are the **design and behavior reference**; the code is rewritten in TypeScript with React, Redux Toolkit Query and pnpm, following `../francois/AGENT.md`. Components are organised by atomic design. The prototype's `style.css` carries over as the stylesheet; its class names (`btn`, `tag`, `av`, `tile`, `rt`, `dtab`, …) map onto atoms almost one to one.

```
web/workshop/
  package.json  pnpm-lock.yaml  tsconfig.json  vite.config.ts  index.html
  src/
    main.tsx                    # loads boot data, creates the store, mounts <App/>
    app/store.ts  app/boot.ts   # boot = GET /api/me + GET /api/config: {me, csrfToken, sandboxDomain, siteHosts}
    app/App.tsx                 # hash or path router: /watch/:artifact?/:n?, /routes, /artifacts, /site, /admin
    api/slopApi.ts              # createApi: every endpoint in §6.4, tag types below
    api/events.ts               # EventSource → cache updates / invalidations
    api/types.ts                # Artifact, Version, Route, Thread, User, Token, AuditEntry, Event
    preview/bridge-protocol.ts  # postMessage message types shared with bridge.js
    components/atoms/           # Button, IconButton, Tag, Avatar, Count, Select, Toggle, Input, TextArea, Kbd, Toast, Spinner
    components/molecules/       # FilmFrame, ThreadItem, ReplyBox, CommentComposer, RouteRow, TokenRow, UserRow,
                                #   DeviceSwitch, VersionMeta, RecordField, BindingEditor, NewTokenForm
    components/organisms/       # TopBar, Filmstrip, CommentsPane, VersionsPane, ConsolePane, PreviewStage,
                                #   RouteTable, RouteDetail, AddRouteForm, ArtifactGrid, PushDialog, RecordsPane,
                                #   FilesPane, TokensPanel, PeopleTable, AuditTable, ToastHost
    screens/                    # WatchScreen, RoutesScreen, ArtifactsScreen, SiteScreen, AdminScreen, PendingScreen
    styles/workshop.css         # from the prototype's style.css
```

Rule of thumb for the layers: an **atom** has no data dependencies and no knowledge of slop concepts (a `Tag` doesn't know what a scope is). A **molecule** renders one slop object from props (`ThreadItem` takes a `Thread`). An **organism** may call RTK Query hooks and dispatch mutations (`CommentsPane` calls `useListThreadsQuery({artifact})`). A **screen** lays organisms out and owns URL state. Keep screen-local UI state (picked element, open reply box, device width) in `useState`/`useReducer`; only server state goes through RTK Query. No extra Redux slices are needed in v1 apart from a small `ui` slice for toasts.

**RTK Query API** (`api/slopApi.ts`):

```ts
const baseQuery = fetchBaseQuery({
  baseUrl: '/api',
  credentials: 'same-origin',
  prepareHeaders: h => { h.set('X-CSRF-Token', boot.csrfToken); return h },
})
export const slopApi = createApi({
  reducerPath: 'slopApi', baseQuery,
  tagTypes: ['Me', 'User', 'Token', 'Audit', 'Project', 'Artifact', 'Version', 'Route', 'RouteLog', 'Thread', 'Agent'],
  endpoints: b => ({
    me:            b.query<Me, void>({ query: () => 'me', providesTags: ['Me'] }),
    artifacts:     b.query<Artifact[], {project?: string}>({ query: p => ({ url: 'artifacts', params: p }),
                     providesTags: r => [...(r ?? []).map(a => ({ type: 'Artifact' as const, id: a.id })), { type: 'Artifact', id: 'LIST' }] }),
    versions:      b.query<Version[], string>({ query: id => `artifacts/${id}/versions`, providesTags: (_r, _e, id) => [{ type: 'Version', id }] }),
    file:          b.query<string, {id: string; n: number; path: string}>({ query: a => ({ url: `artifacts/${a.id}/versions/${a.n}/files/${a.path}`, responseHandler: 'text' }) }),
    records:       b.query<Rec[], {id: string; n: number}>({ query: a => `artifacts/${a.id}/versions/${a.n}/records` }),
    routes:        b.query<Route[], {host?: string}>({ query: p => ({ url: 'routes', params: p }), providesTags: [{ type: 'Route', id: 'LIST' }] }),
    resolve:       b.query<Resolution, {host: string; path: string}>({ query: p => ({ url: 'resolve', params: p }), providesTags: [{ type: 'Route', id: 'LIST' }] }),
    threads:       b.query<Thread[], {artifact?: string}>({ query: p => ({ url: 'threads', params: p }), providesTags: (_r, _e, a) => [{ type: 'Thread', id: a.artifact ?? 'ALL' }] }),
    sandboxUrl:    b.query<{url: string}, {artifact: string; n: number; mode: 'preview'|'thumb'; host?: string; path?: string}>({ query: p => ({ url: 'sandbox-url', params: p }) }),
    push:          b.mutation<PushResult, {id: string} & PushRequest>({ query: ({ id, ...body }) => ({ url: `artifacts/${id}/versions`, method: 'POST', body }) }),
    setRoute:      b.mutation<Route, RouteInput>({ query: body => ({ url: 'routes', method: 'PUT', body }) }),
    createThread:  b.mutation<Thread, {artifact: string; version: number; anchor: Anchor; text: string}>(…),
    reply:         b.mutation<Comment, {thread: string; text: string}>(…),
    resolveThread: b.mutation<Thread, {thread: string; resolved: boolean}>(…),
    users / setRole / tokens / createToken / revokeToken / audit / agents …
  }),
})
```

Mutations do **not** invalidate tags themselves. The server echoes every change as an event, and `api/events.ts` turns events into invalidations, so a change made by Ramon's browser, Manuel's Claude Code or your own click refreshes the cache through one code path:

```ts
const INVALIDATES: Record<string, (p: any) => TagDescription[]> = {
  'version.created':  p => [{ type: 'Version', id: p.artifact }, { type: 'Artifact', id: p.artifact }],
  'ref.moved':        p => [{ type: 'Version', id: p.artifact }, { type: 'Artifact', id: p.artifact }, { type: 'Route', id: 'LIST' }],
  'route.set':        () => [{ type: 'Route', id: 'LIST' }, { type: 'RouteLog' }],
  'route.removed':    () => [{ type: 'Route', id: 'LIST' }, { type: 'RouteLog' }],
  'thread.created':   p => [{ type: 'Thread', id: p.artifact }, { type: 'Thread', id: 'ALL' }],
  'comment.created':  p => [{ type: 'Thread', id: p.artifact }, { type: 'Thread', id: 'ALL' }],
  'thread.resolved':  p => [{ type: 'Thread', id: p.artifact }, { type: 'Thread', id: 'ALL' }],
  'user.role':        () => ['User', 'Me'],
  'token.created':    () => ['Token'],  'token.revoked': () => ['Token'],
  'agent.waiting':    () => ['Agent'],  'agent.left':    () => ['Agent'],
}
export function startEvents(store: AppStore) {
  let after = 0
  const es = new EventSource('/api/events?after=' + after)       // EventSource resends Last-Event-ID on reconnect
  for (const type of Object.keys(INVALIDATES))
    es.addEventListener(type, (e: MessageEvent) => {
      const p = JSON.parse(e.data)
      store.dispatch(slopApi.util.invalidateTags(INVALIDATES[type](p)))
      store.dispatch(eventSeen({ type, p }))                       // toasts ("Claude Code pushed pricing v8") and the console pane
    })
}
```

The server honours `Last-Event-ID` on reconnect as well as `?after=`. This replaces the mirror-store idea (old D2) and the `/api/snapshot` endpoint is not needed.

**Previews** use `<iframe src={sandboxUrl}>` (D4). `PreviewStage` owns the iframe, listens to `message` events, checks `e.origin` ends with `.` + `boot.sandboxDomain`, and speaks the protocol in `preview/bridge-protocol.ts` (`pick`, `pins`, `focus`, `ready`, `nav`, `external`), exactly the messages `render.js:80-183` already uses. The bridge posts to the parent origin it receives in its boot data, never `'*'`.

**Screens and the endpoints behind them:**

| Screen | Reads | Writes |
| --- | --- | --- |
| Watch (prototype `renderWatch`, `app.js:197`) | artifacts, versions, threads, sandboxUrl, file, records, agents | createThread, reply, resolveThread, push (browser edits), setRoute (point/pin) |
| Routes (`app.js:646`) | routes, route log, resolve | setRoute, removeRoute, undoRoute |
| Artifacts (`app.js:802`) | artifacts, versions (latest), sandboxUrl `mode=thumb` | createArtifact, push |
| Site (`app.js:764`) | resolve, sandboxUrl with `host`/`path` | — |
| Admin (`app.js:905`) | users, tokens (`all=1`), audit | setRole, createToken, revokeToken |

**Development and production builds.**

1. **Vite dev server** (`pnpm dev`, port 5173) with HMR. `vite.config.ts` proxies `/api`, `/auth`, `/device`, `/_`, `/_slop` to `slop serve` on 8080, with `changeOrigin: false` so the Go server sees `Host: localhost:5173`. Start the server with `--dev-origin http://localhost:5173`: it then accepts that Origin for CSRF checks, uses it for OIDC redirect URIs, and sets the non-`__Host-` dev cookie. Register `http://localhost:5173/auth/callback` on the dev ZITADEL client (the compose setup script does it). The dev server talks to whatever database `slop serve` uses, so UI work happens against real artifacts.
2. **Production build.** `go generate ./pkg/web` runs `pnpm build` and copies `dist/` into `pkg/web/workshop/`, embedded with `go:embed`. The main host serves `index.html` for `/` and the Workshop's client-side paths (`/watch/…`, `/routes`, `/artifacts`, `/site`, `/admin`), and the hashed assets under `/static/workshop/` (`vite.config.ts` sets `base: '/static/workshop/'`). Changing the Workshop means a new binary; changing an artifact never does.

Shared TypeScript types for the API live in `web/workshop/src/api/types.ts` and are written by hand to match the Go JSON structs; a Go test marshals one example of each struct and a TS test type-checks the same JSON fixtures, so drift fails CI.

### 6.9 The CLI

Glazed commands under `slop` (francois's `cmd/francois/cmds/*.go` show the patterns). Every network command uses `pkg/client` with the stored credentials.

```
slop serve --database-url … --public-url https://slop.computer --site-host slop.boutique --sandbox-domain slop.run \
           --oidc-issuer … --oidc-client-id … --blobs ./var/blobs --log-level info
slop migrate
slop db users promote --issuer … --subject …          # bootstrap the first admin (direct DB)
slop auth login --server https://slop.computer [--scopes read,write]
slop auth status | token | logout
slop artifacts list [--project lab-site]
slop pull pricing ./pricing [--version 6]             # writes the tree + .slop/artifact.json {id, base}
slop push ./pricing -a pricing -m "…" [--reply th_8k2 --reply-text "…"] [--session s] [--force]
slop route list [--host slop.boutique]
slop route set /pricing pricing@7 [--host slop.boutique]     # pricing@main follows main
slop route undo /pricing
slop comments wait [-p lab-site | -a pricing] [--json]       # blocks; prints one thread/comment; exit 0
slop comments reply th_8k2 "…"
slop dev seed                                         # pushes the Workshop's seed data through the API
```

`slop push` pseudocode:

```go
tree := walk(dir, ignore(".slop", ".git", "node_modules"))      // path → sha256 (+ bytes)
missing := client.MissingBlobs(values(tree))
for sha in missing { client.PutBlob(sha, bytes[sha]) }           // bounded parallelism via errgroup
base := readLocalBase(dir)  // .slop/artifact.json, else server main
res, err := client.Push(id, {base, tree, manifest: readManifest(dir), message, via: detectVia(), session, reply})
if err is main_moved → print "main is at vN; pull, or push --force"
writeLocalBase(dir, res.Version.N)
print "pushed pricing v7 · 3 files · 41 KB · https://slop.computer/#watch/pricing/v7"
```

`detectVia()` returns `claude` when `CLAUDECODE=1` (set by Claude Code), else `cli`. `manifest` is read from `slop.json` in the folder if present.

### 6.10 Safe mode `/_/`

A server-rendered page (Go `html/template`, no JavaScript) that works when the Workshop is broken: sign in, list routes per host, point any route at an earlier version or undo, revoke tokens. It uses the same store functions as the API and the same guard (`admin`, `noToken`), with a normal form POST + CSRF hidden field. It is ~200 lines and is the "fuse box" the seed's journal post describes.

### 6.11 Live iteration on artifacts

The point of the database is that **artifacts change without a deploy**. The loop for a page:

1. `slop push ./pricing -a pricing` → new version; `main` moves; every route that follows `main` serves it at once. Pinned routes don't change until someone points them.
2. Open Watch screens get `version.created` and reload the preview iframe for that artifact (only when you're viewing the newest version, so a version you're commenting on doesn't jump).
3. `slop push ./pricing -a pricing --watch` re-pushes whenever a file in the folder changes (debounced ~300 ms, fsnotify). With the Watch screen open, saving a file updates the preview within a second, with each save kept as a version you can compare, comment on or point a route at.
4. Data works the same way: `slop push ./journal -a journal` publishes posts; pages reading `journal@main` show them immediately.

`--watch` pushes many small versions; that is intended (they are cheap: only changed blobs upload). `--watch --no-main` pushes without moving `main`, for iterating on a page that is live through a following route without visitors seeing every save.

### 6.12 Local mode: no ZITADEL, nicknames, SQLite

**Goal.** `slop serve --local` starts a complete slop.computer on a laptop with no identity provider and no Postgres, where several people (or several browser windows, or several agents) can still act as **different users**, so collaboration — comments from one, pushes from another, live updates in both — can be tried and tested locally.

```
$ slop serve --local
slop.computer (LOCAL MODE — no authentication, do not expose)
  workshop  http://localhost:8080
  site      http://site.localhost:8080       (route table, host "site.localhost")
  sandbox   http://*.sandbox.localhost:8080  (previews)
  database  sqlite ./var/slop.db
  blobs     ./var/blobs
```

`--local` only sets defaults: `--db sqlite:./var/slop.db`, `--blobs ./var/blobs`, `--listen 127.0.0.1:8080`, `--public-url http://localhost:8080`, `--site-host site.localhost:8080`, `--sandbox-domain sandbox.localhost:8080`, `--auth local`. Every flag can still be overridden, for example `--db postgres://…` to run local mode against Postgres. Browsers resolve any `*.localhost` name to the loopback address, so the site and sandbox hosts need no DNS or `/etc/hosts` changes.

**Identity without authentication.** `--auth local` replaces the OIDC provider with a nickname provider. Everything after "who is this?" is unchanged: the same users table, sessions, CSRF, tokens, guard and audit.

```
GET  /auth/login            → server-rendered page: "Who are you?" — buttons for existing local users + a nickname field
POST /auth/local {nickname} → UpsertIdentity(Identity{Issuer: "local", Subject: nick, Name: nick, Email: nick+"@local"})
                              role on first sign-in = --local-role (default admin; set pending to test the waiting room)
                              CreateSession → same cookie as production → redirect to return path
POST /auth/logout           → ends the session; the login page offers the nickname list again
```

```go
// pkg/identity: the server depends on this interface; OIDC and Local both implement it.
type Provider interface {
    Kind() string                                   // "oidc" | "local"
    Start(w http.ResponseWriter, r *http.Request)   // OIDC: redirect to IdP; Local: render the nickname form
    Finish(w http.ResponseWriter, r *http.Request) (store.Identity, string /*idToken*/, error)
    LogoutURL(ctx context.Context, idToken, postLogout string) (string, error)   // Local: ""
}
```

Nicknames match `^[a-z0-9][a-z0-9_-]{0,31}$`. Local users are ordinary rows with issuer `local`, so a database used in local mode never mixes with ZITADEL identities.

**Several identities at once.** Session cookies are per host, so:

- Use a private window or a second browser profile for the second person (simplest).
- Or open the Workshop on two loopback names, `http://localhost:8080` and `http://127.0.0.1:8080`; local mode accepts both as the main host, each with its own cookie, so one browser holds two identities side by side.
- The Workshop's top bar shows a **LOCAL** badge and a "Switch user" menu (from `GET /api/config → {mode: "local"}`), which posts `/auth/local` with another nickname.
- Playwright tests use one browser context per nickname.

**Agents and the CLI in local mode.** The device flow works unchanged (approve in the browser as whoever you are). For scripts and agents there is a shortcut that exists only in local mode and only for loopback clients:

```
$ slop auth login --server http://localhost:8080 --as claude-manuel [--scopes read,write]
→ POST /api/local/token {nickname, scopes, days}     // 404 unless --auth local; 403 unless RemoteAddr is loopback
→ creates the user if needed (role --local-role), mints a normal slp_ token, stores it in credentials.json
```

So `--as claude-manuel` and `--as claude-ramon` give two agents distinct identities, and the Workshop shows who pushed what exactly as in production.

**Guard rails, so local mode never leaks into production:**

- `--auth local` refuses to start unless `--listen` is a loopback address and `--public-url` is `http://localhost…` or `http://127.0.0.1…`. There is no flag to override this; a shared demo uses ZITADEL.
- Every response carries `X-Slop-Mode: local`; the Workshop and `/_/` show a red LOCAL banner.
- `/api/local/token` and `/auth/local` are not registered at all outside local mode (not just guarded).

**SQLite instead of Postgres.** See D5 (revised) and §6.2.1 for how the store supports both. In short: one store implementation on `database/sql`, portable SQL, two migration directories, chosen by the `--db` URL scheme (`sqlite:` or `postgres://`). SQLite runs with WAL, `busy_timeout=5000`, `foreign_keys=ON`, `BEGIN IMMEDIATE` transactions, and a single open connection, as francois's own local store does (`../francois/pkg/store/store.go:33-38`). Write concurrency is one writer at a time, which is plenty for a laptop. Everything else in the server is unaffected because the event broker is in-process in both modes.

**What a fresh local start looks like end to end:**

```
slop serve --local                                  # creates ./var/slop.db, migrates, starts
slop dev seed --server http://localhost:8080 --as manuel   # the prototype's demo content, as manuel
open http://localhost:8080          → "Who are you?" → manuel
open private window → localhost:8080 → ramon
slop auth login --server http://localhost:8080 --as claude-manuel
slop comments wait -p lab-site      # ramon comments in his window → returns here
```

### 6.13 Tools: pushed screens with limited API access

**Goal.** Ramon (or his Claude Code) can build a new screen — a release board, a link checker, a post scheduler — push it like any page, and have it show up inside the Workshop with the API access it needs, without a binary deploy. The **core Workshop stays embedded** and can never be replaced or broken by a push.

**What a tool is.** A page artifact whose folder has a `slop.json` with a `tool` section. When an admin enables it, it appears in the Workshop's **Tools** menu at `/tools/<id>`.

```json
// board/slop.json
{ "tool": { "title": "Release board", "icon": "rocket",
            "permissions": ["routes:read", "routes:write", "versions:read"] } }
```

**How it differs from the "shell" idea (§10, D9).** A shell would have run on the main origin with the viewer's whole session. A tool:

| | Shell (rejected) | Tool |
| --- | --- | --- |
| Runs on | main origin | the sandbox domain (`v3--board.sandbox.localhost`), inside an iframe in the Workshop's chrome |
| API access | everything the viewer can do | only the **permissions it declared and an admin approved**, through a short-lived grant token |
| Can touch users, tokens, audit, tool approval | yes | **never** (not grantable) |
| Can break the Workshop | yes, if it replaced it | no — the Workshop's menus, "Disable tool" and "Back to v2" are outside the iframe |
| Worst case if malicious | act as you, mint admin tokens, let others in | do what its approved permissions allow (e.g. repoint routes); every change is in the route log/audit, attributed to the tool and the viewer, and undoable |

**Permissions** (the only ones that exist; each maps to endpoints):

| Permission | Endpoints |
| --- | --- |
| `artifacts:read` | `GET /api/artifacts…`, `GET /api/projects…` |
| `versions:read` | `GET …/versions…`, files, records |
| `versions:push` | blobs, `POST …/versions`, refs |
| `routes:read` | `GET /api/routes…`, `/api/resolve`, route log |
| `routes:write` | `PUT/DELETE /api/routes`, undo |
| `threads:read` / `threads:write` | threads, replies, resolve |
| `events:read` | `GET /api/events` |

**Ramon's release board, end to end:**

```
 Ramon's Claude Code                     slop                                       Workshop (Ramon, then Manuel)
 writes board/index.html + slop.json
 $ slop push ./board -a board ─────────▶ board v1 stored (a page with a tool manifest)
                                         event version.created ───────────────────▶ Tools menu: "board v1 — new tool, not enabled"
                                                                                    Ramon opens /tools/board?try=1
                                         POST /api/tools/board/grant {n:1} ◀──────── Workshop asks for a grant for Ramon only
                                         → slg_… (1 h, routes:read, routes:write,
                                           versions:read; user ramon; tool board@1)
                                                                                    iframe v1--board.sandbox… gets the grant via postMessage
                                                                                    Ramon clicks Ship on /pricing (try mode)
                                         PUT /api/routes  Authorization: Bearer slg_…
                                         → allowed (routes:write); audit: "ramon via tool board@1"
                                                                                    Ramon clicks "Enable for everyone"
                                         PUT /api/tools/board {n:1, permissions:[…]}  (admin, browser session only)
                                         event tool.enabled ──────────────────────▶ Manuel's Tools menu now lists "Release board"
 later: $ slop push ./board  (v2) ────▶ board v2 stored; enabled tool stays on v1  ▶ "Release board: v2 available (asks for versions:push — new)"
                                                                                    Ramon tries v2, then "Update to v2" (approves the new permission)
```

**The tool's code** uses a tiny client the server injects (`/_slop/tool.js`), so tools never handle cookies, CSRF or token refresh:

```html
<!-- board/index.html -->
<h1>Release board</h1>
<table id="rows"></table>
<script type="module">
  const api = await slop.tool.ready()            // waits for the grant from the Workshop; rejects if opened outside it
  for (const r of await api.get('/routes', { host: 'slop.boutique' })) {
    const [latest] = await api.get(`/artifacts/${r.page}/versions`, { limit: 1 })
    const row = rows.insertRow()
    row.innerHTML = `<td>${r.path}</td><td>${r.version ? 'v' + r.version : 'main'}</td><td>v${latest.n}</td><td><button>Ship</button></td>`
    row.querySelector('button').onclick = () => api.put('/routes', { ...r, version: latest.n, note: 'shipped from release board' })
  }
  api.on('route.set', () => location.reload())   // events:read would be needed for this line
</script>
```

`api.get/put/post/delete` call `https://<main host>/api/...` with `Authorization: Bearer slg_…`. The main host answers CORS preflights only for origins under the sandbox domain, without credentials (cookies are never sent cross-origin), allowing only the `Authorization` and `Content-Type` headers.

**Server side:**

```sql
CREATE TABLE tools (artifact_id text PRIMARY KEY REFERENCES artifacts(id),
  version integer NOT NULL, permissions text NOT NULL,      -- JSON list, approved set
  title text NOT NULL, icon text NOT NULL DEFAULT '',
  enabled_by text NOT NULL REFERENCES users(id), enabled_at timestamp NOT NULL);
CREATE TABLE tool_grants (token_hash blob PRIMARY KEY, artifact_id text NOT NULL, version integer NOT NULL,
  user_id text NOT NULL REFERENCES users(id), permissions text NOT NULL, expires_at timestamp NOT NULL);
```

| Method & path | Guard | Purpose |
| --- | --- | --- |
| `GET /api/tools` | admin, rw | enabled tools + tool-manifest pages that aren't enabled or have newer versions |
| `PUT /api/tools/{id}` | admin, **noToken** | enable / update: `{n, permissions}`; the permissions must equal the version's manifest (an admin can't grant more than asked) |
| `DELETE /api/tools/{id}` | admin, **noToken** | disable; revokes its grants |
| `POST /api/tools/{id}/grant` | admin, **noToken** | `{n, try?}` → `{grant, expiresAt, permissions}`; `n` must be the enabled version, or any version with `try` (then only for the caller) |

The guard learns a third kind of principal:

```go
// bearer "slg_…": a tool grant. Each kernel route declares the permission it needs, next to its scope.
m.HandleFunc("PUT /api/routes", s.guard(admin, scopeRW, perm("routes:write"), s.setRoute))
...
if strings.HasPrefix(secret, "slg_") {
    g, u := Store.ResolveGrant(secret)                      // expired/revoked → 401
    if route.perm == "" || !g.Has(route.perm) → 403 grant_permission   // users, tokens, audit, tools: perm "" → never
    p = &Principal{User: u, Grant: &g}                      // u must still be admin, checked below as for any principal
    ctx = WithAuditVia(ctx, "tool "+g.Artifact+"@"+g.Version)
}
```

Grants last one hour; the Workshop renews them before expiry and drops them when the iframe closes. Disabling a tool or changing a user's role revokes outstanding grants.

**In the Workshop:** a `ToolsMenu` organism in the `TopBar`, a `ToolScreen` (iframe + grant handshake + chrome with the version, "Try v2", "Update", "Disable"), and an `EnableToolDialog` that lists the requested permissions in plain words ("can repoint routes on every host") and highlights new ones when updating.

---

## 7. Decision records

### D1: Copy francois code into a new module instead of adding a mode to francois

- **Context:** Directions Q5 asks whether slop.computer is a separate binary or `francois computer serve`. The user asked to "take the backend of francois", "kill all the membership stuff" and "feel free to literally `cp` stuff over".
- **Options:** (a) new module, copy the kept packages; (b) a mode inside francois; (c) import francois packages as a library.
- **Decision:** (a).
- **Rationale:** The kept code is ~2.5k lines and changes shape (roles, scopes, table names). Importing (c) would drag billing and settings dependencies through `store` and `auth`. A mode (b) keeps membership code one refactor away from our auth paths.
- **Consequences:** Security fixes in francois's auth must be ported by hand; note the francois commit each file was copied from in a header comment. One login does not cover both sites.
- **Status:** accepted (2026-10-28: "separate independent copy")

### D2: Workshop rebuilt in React + RTK Query, atomic design

- **Context:** `app.js` (1,020 lines) is vanilla JS on a synchronous fake API; `../francois/AGENT.md` prescribes pnpm, React, RTK Query and TypeScript.
- **Options considered:** (a) keep vanilla JS behind a synchronous mirror store; (b) rewrite in React + RTK Query.
- **Decision:** (b), components in atoms / molecules / organisms / screens (§6.8).
- **Rationale:** Owner's choice; RTK Query's tag invalidation maps directly onto the server's event stream, so live updates need no hand-written store.
- **Consequences:** Phase 5 is a rewrite (~3–4k lines TSX), with the prototype as the visual and behavioral spec. No `/api/snapshot` endpoint.
- **Status:** accepted (2026-10-28)

### D3: The Workshop is embedded in the binary, with a Vite dev proxy; only artifacts live in the database

- **Context:** The Directions doc proposed making every screen an artifact (a "shell") on the main origin. The owner wants the Workshop embedded instead, with a Vite proxy for quick iteration; only artifacts go through the database.
- **Options considered:** (a) Workshop embedded; (b) Workshop as a shell artifact in the DB.
- **Decision:** (a).
- **Rationale:** Owner's choice: the core must not be corruptible by a push. It also keeps pushed code off the main origin entirely.
- **Consequences:** Workshop changes ship with the binary. Artifacts always run on site hosts or the sandbox domain. New screens without a deploy come from tools (D9), which run in an iframe inside the Workshop with limited API access.
- **Status:** accepted (2026-10-28)

### D4: Server-side rendering on per-version sandbox origins instead of `srcdoc`

- **Context:** The prototype inlines CSS/JS into `srcdoc`, which breaks images, fonts, fetches and multi-file artifacts (Directions: "Releases are single files … versions here should be file trees").
- **Options:** (a) keep `srcdoc` and inline more; (b) serve each version on its own sandbox origin.
- **Decision:** (b).
- **Rationale:** Real file trees, real relative URLs, per-version storage isolation, and the same code path as site hosts.
- **Consequences:** Needs wildcard DNS/TLS for the sandbox domain in production and `*.localhost` in development; preview access needs the signed-key exchange.
- **Status:** proposed

### D5: Postgres in production, SQLite for local mode and tests

- **Context:** Directions Q6. The owner accepted Postgres, then asked for a local mode without Postgres.
- **Options considered:** (a) Postgres only; (b) SQLite only, everywhere; (c) one `database/sql` store with portable SQL and per-dialect migrations.
- **Decision:** (c). Postgres via `pgx/v5/stdlib` in production; `modernc.org/sqlite` (pure Go, already a francois dependency) for `--local` and as the default test database.
- **Rationale:** Local mode needs zero setup. The store is small, and the Postgres-only features francois used (arrays, advisory locks, `FOR UPDATE`) are either replaceable (JSON text) or unnecessary (single writer in SQLite). Tests that run on SQLite in memory need no Postgres for an intern to get started; CI runs the suite against both.
- **Consequences:** The francois store is ported rather than copied (§6.2.1). Some SQL must stay in the common subset; a schema-parity test guards drift. (b) stays possible later: with two users, production on SQLite with a volume would work too.
- **Status:** accepted (2026-10-28)

### D8: Local mode with nickname identities

- **Context:** The owner wants to run slop locally without authentication but with distinct identities, to test collaborative behavior.
- **Options considered:** (a) a fixed single local user; (b) a header such as `X-Slop-User` trusted from loopback; (c) a nickname identity provider behind the same `identity.Provider` interface as OIDC, producing ordinary users and sessions.
- **Decision:** (c), plus a loopback-only `/api/local/token` shortcut for the CLI (§6.12).
- **Rationale:** Everything downstream of sign-in (sessions, CSRF, guard, tokens, audit, events) runs exactly as in production, so local tests exercise the real code. (a) can't test collaboration; (b) bypasses the session and CSRF code we most want tested.
- **Consequences:** Local mode must be impossible to enable on a reachable address (loopback-only listen and public URL, enforced at startup, no override).
- **Status:** accepted (2026-10-28)

### D6: Content-addressed two-step push

- **Decision:** `POST /api/blobs/missing` → `PUT /api/blobs/{sha}` for missing ones → `POST …/versions` with the full tree.
- **Rationale:** A one-line CSS change uploads one file. Versions stay complete trees (no deltas to replay). Blobs dedupe across artifacts.
- **Consequences:** Orphan blobs from aborted pushes; a later `slop db blobs gc` can sweep unreferenced shas older than a day.
- **Status:** proposed

### D7: Roles `admin | pending | disabled`, scopes `read | write | admin`

- **Decision:** As the Directions and the Workshop's Admin screen (`app.js:916`) specify. `disabled` becomes a role value (francois's separate `disabled` boolean is folded in).
- **Consequences:** `SetUserDisabled` disappears; revoking sessions and tokens on `disabled` stays (copy `admin.go:264-272` behavior into the role change).
- **Status:** proposed

### D9: Tools get declared, admin-approved permissions instead of the viewer's session

- **Context:** The owner wants pushed tool screens (e.g. Ramon's release board) that use the API, while the core Workshop stays embedded.
- **Options considered:** (a) shells: pushed pages on the main origin with the viewer's full session; (b) tools on the sandbox origin, inside a Workshop iframe, with a short-lived grant limited to permissions declared in the tool's manifest and approved by an admin; (c) tools that call the API through the Workshop via `postMessage`, with the Workshop checking permissions.
- **Decision:** (b).
- **Rationale:** The worst case of (a) is account takeover (mint admin tokens, let users in). (b) bounds the damage to approved, logged and undoable actions, enforced by the server. (c) would put enforcement in browser code.
- **Consequences:** CORS on `/api` for sandbox origins (bearer only, no cookies); a third principal type in the guard; per-route permission declarations; `tools` and `tool_grants` tables. Enabling and updating tools is browser-only for admins, so an agent can build a tool but never activate it.
- **Status:** proposed (2026-10-28)

---

## 8. Implementation plan

Each phase ends with something runnable and a commit. Do them in order; phases 4 and 5 can overlap once phase 3's API is stable.

### Phase 0 — Module skeleton and local mode first

1. `go mod init github.com/go-go-golems/slop-computer`; add `./slop-computer` to `../go.work`.
2. `cmd/slop/main.go` with cobra root, zerolog, `--log-level`. Copy `Makefile`, `lefthook.yml`, `.golangci` config from francois, trimmed.
3. `deploy/compose/compose.yaml`: postgres + zitadel + zitadel-setup from francois (drop `stripe`, `francois` services; add `slop`). Change test users to `manuel@slop.test`, `ramon@slop.test`, `pending@slop.test`. Compose is only needed to test the production configuration; day-to-day work uses `slop serve --local`.

### Phase 1 — Auth carve-out (copy, then cut)

1. `cp` `pkg/catalog/{httpx,identity,credentials}` → `pkg/…`; fix imports.
2. Port `pkg/catalog/store/{store,users,sessions,tokens,device,audit}.go` → `pkg/store/` on `database/sql` (§6.2.1): `Open(url)` picks the dialect from the scheme; `rebind`, `forUpdate`, `JSONList` helpers; delete grant/plan/email/instance functions; write `migrations/{postgres,sqlite}/001_auth.sql` and the schema-parity test.
3. Change `UpsertIdentity` default role to `pending`; `SetUserRole` accepts `admin|pending|disabled`; on `disabled` revoke sessions and tokens.
4. Scopes → `read|write|admin`; `ScopesForRole(admin)` → all three.
5. `pkg/identity`: `Provider` interface; wrap the copied OIDC code; add `local.go` (nickname form, `/auth/local`, `/api/local/token`) and the loopback startup checks.
6. `pkg/server`: `server.go` (Config with one site, `PublicURL`, `SiteHosts`, `SandboxDomain`), `auth.go` (guard with three levels), `tokens.go`, `device.go`, `users.go` (from `admin.go` user/token/audit handlers only).
7. Commands: `serve` (with `--local`), `migrate`, `db users promote`, `auth login|status|token|logout` (with `--as` for local servers).
8. Server-rendered `/device` approval page and a minimal `/` that says "signed in as X (role)".
9. **Exit check (local):** `slop serve --local`; sign in as `manuel` in one window and `ramon` in a private window; `slop auth login --as claude-manuel`; `curl -H "Authorization: Bearer $(slop auth token)" localhost:8080/api/me` shows `claude-manuel`. Starting with `--auth local --listen 0.0.0.0:8080` fails.
10. **Exit check (production config):** sign in through compose ZITADEL as Manuel → pending; `slop db users promote` → admin; `slop auth login` → token in `~/.config/slop/credentials.json`; `curl -H "Authorization: Bearer $(slop auth token)" /api/me` works.

### Phase 2 — Kernel storage and API

1. `pkg/blobs` from `releases.go:22-197`.
2. `002_kernel.sql`; store functions for projects, artifacts, versions, version files, refs, routes, route log, threads, comments, events.
3. `pkg/events` broker; `GET /api/events`; `GET /api/comments/wait`; `GET /api/agents`.
4. All kernel endpoints in §6.4 except `sandbox-url`.
5. Audit every mutation with `via` (browser, token name).
6. **Exit check:** an integration test pushes two versions, sets a route, opens a thread, replies through a token, and observes the five events in order over SSE.

### Phase 3 — Routing, records, rendering

1. `pkg/routing` with table tests ported from the prototype's behavior (fixtures from `seed.js` routes).
2. `pkg/records` with fixtures from `seed.js` journal posts and experiments.
3. `web/runtime.js`, `web/bridge.js` lifted from `render.js`; `pkg/serve` `Index()` and file serving.
4. Site-host handler; sandbox-host handler with the signed-key exchange; `GET /api/sandbox-url`.
5. **Exit check:** `boutique.localhost:8080/journal/routes-not-templates` renders the post from `journal@main` with lab tokens; `v6--pricing.sandbox.localhost:8080` renders pricing v6 with pins.

### Phase 4 — CLI for agents

1. `pkg/client` typed calls.
2. `push`, `pull`, `artifacts list`, `route list|set|undo`, `comments wait|reply`.
3. `slop dev seed`: port the content builders from `seed.js` (they are plain string templates) and push them through the client, so a fresh database looks like the prototype.
4. **Exit check:** the round in Directions §"Contact sheet" works from two terminals.

### Phase 5 — Workshop in React

1. `web/workshop`: Vite + React + RTK Query + TypeScript (pnpm); `vite.config.ts` with the dev proxy; `--dev-origin` support in `slop serve`.
2. Atoms from the prototype's `style.css` classes; then molecules, organisms, and the five screens, screen by screen against the prototype (run the prototype side by side: `python3 -m http.server` in `sources/workshop`).
3. `api/slopApi.ts`, `api/events.ts` (event → tag invalidation), `PreviewStage` with the origin-checked bridge.
4. `go generate ./pkg/web` embeds the build; main host serves it at `/` and `/static/workshop/`.
5. Safe mode `/_/` (§6.10).
6. `slop push --watch` (§6.11).
7. **Exit check:** (a) the prototype README walkthrough works in two browsers signed in as two admins, with updates appearing in both without reload; (b) `slop push --watch` on a page with the Watch screen open shows each save within a second; (c) the same works through `pnpm dev`.

### Phase 6 — Tools

1. `tool` section in `slop.json`, parsed at push; `tools`, `tool_grants` tables; `/api/tools` endpoints; grant principal and per-route `perm(...)` in the guard; CORS for sandbox origins.
2. `/_slop/tool.js` client; `ToolsMenu`, `ToolScreen`, `EnableToolDialog` in the Workshop.
3. Build the release board from §6.13 as the first tool, in `examples/tools/board/`.
4. **Exit check (local mode):** ramon pushes the board, tries it, enables it; manuel sees it and ships a route with it; the route log says "via tool board@1"; a board version that calls `/api/tokens` gets 403; disabling the tool kills an open board's next call.

### Phase 7 — Hardening

1. Rate limits on device authorize (francois `deviceLimiter`), request size limits, `X-Frame-Options`/CSP per host class, `HSTS` in production.
2. Blob GC command. `readyz`/`healthz`.
3. Dockerfile and a production doc (wildcard TLS for the sandbox domain).

### Phase 8 (optional) — MCP

Copy `mcpserver` plumbing (go-go-mcp) and expose ~10 tools that map 1:1 onto the CLI: `whoami, list_artifacts, read_version, push_version, list_routes, set_route, undo_route, list_comments, reply, wait_for_comments`.

---

## 9. Test strategy

- **Unit (no DB):** `pkg/routing` (matching, specificity, fallback, record filling; reuse every route in `seed.js:553-570` as a fixture), `pkg/records` (front matter forms, Markdown, JSON errors, tokens CSS), `pkg/serve` injection (head present/absent, `<` escaping in boot JSON, reserved `/_slop/` paths), scope mapping (`required(method)`), push path validation.
- **Integration (SQLite in a temp file by default; Postgres too when `TEST_DATABASE_URL` is set, one database per test as francois does; CI runs both):** identities are created with the local provider, so no ZITADEL is needed. auth guard matrix — {no auth, pending session, admin session, read token, rw token, admin token, revoked token} × {GET kernel, POST kernel, admin endpoint} → expected status codes; CSRF and Origin on cookie mutations; self-lockout; push compare-and-set (`main_moved`), missing blobs, concurrent pushes to one artifact (two goroutines, one wins, the other 409s); route set/undo round trip and `route_log`; events ordering and replay after reconnect; `comments wait` returns another user's comment, ignores your own, times out with 204.
- **HTTP end to end:** `httptest.Server` + `pkg/client` (francois's `client.WithHandler` lets the client call a handler directly, `client.go:56`).
- **Browser:** Playwright scripts like the prototype's `tests/a-sc/t*.js` in the workspace zip, against `slop serve --local` + `slop dev seed`, with one browser context per nickname (manuel, ramon) and a CLI agent (`--as claude-manuel`) driven from the test: the Phase 5 walkthrough as a real two-person session, with screenshots in the ticket.
- **Tool grants:** a grant reaches only its declared permissions; never users/tokens/audit/tools; expires; is revoked on disable and on role change; `PUT /api/tools` rejects tokens and permission sets that differ from the manifest; CORS preflight is refused for origins outside the sandbox domain.
- **Local-mode safety:** startup refuses non-loopback listen/public URL with `--auth local`; `/auth/local` and `/api/local/token` return 404 in OIDC mode; `/api/local/token` returns 403 for a non-loopback `RemoteAddr`.
- **Manual:** the compose stack with real ZITADEL sign-in for both test admins plus a pending user.

---

## 10. Risks, alternatives and open questions

**Risks**

- *Bridge security.* The preview bridge accepts messages from the parent and posts to it. With per-version origins, the Workshop must check `e.origin`, and the bridge must only accept messages from the main origin. Write a test that a page on the sandbox host cannot make the Workshop do anything other than show a pick/pin.
- *Route-table assets under parameterized routes* (§6.7). Pick the rule early; it affects how agents write pages.
- *Snapshot growth.* Fine for months of two people; add pagination for audit and versions when the snapshot passes ~1 MB.
- *Copied auth drift.* Record the francois commit in each copied file.

**Open questions** (please answer by number)

1. ~~Module path and binary name~~ — separate independent copy accepted; module path `github.com/go-go-golems/slop-computer` and binary `slop` assumed unless you say otherwise.
2. ~~Vanilla JS or React~~ — React + RTK Query, atomic design (D2).
3. ~~Embedded Workshop~~ — embedded + Vite proxy; only artifacts in the DB (D3).
4. Hosts: production main host `slop.computer`, sandbox `slop.run` (or another spare domain), and which site hosts on day one — a staging name for slop.boutique?
5. ZITADEL: reuse francois's instance/project with a new OIDC client, or a separate instance?
6. Asset paths in pages served under `/:param` routes: the "last segment with an extension" rule, or require `/_v/<artifact>/<n>/…` absolute paths on site hosts?
7. Should a push from a `read,write` token be allowed to create a new artifact, or only admins in the browser?
8. Directions Q8–Q11 (one data artifact per collection; static export method; what a session is; Shop Next projects) do not block v1; confirm they can wait.
9. Do you want a per-browser preview on **site hosts** (your browser sees `/pricing` at v8 on the real site while visitors see v7)? It needs a viewer cookie on site hosts, which v1 otherwise avoids; without it you check versions in the Workshop preview before pointing a route.
10. Tools: is the permission list in §6.13 the right granularity, or should permissions also be limited per host (e.g. `routes:write` only on `site.localhost`) from the start?

---

## 11. References

- Directions brainstorm, revision 2: `sources/slop-computer-directions.md`
- Workshop prototype: `sources/workshop/` (README in the workspace zip: `projects/slop-computer-a/README.md`)
- Workspace archive with the Desk, tests and transcripts: `~/Downloads/slop-computer-workspace.zip` (not copied; the Desk is out of scope)
- francois at `106776a`: `README.md` (catalog section), `pkg/catalog/routes.go`, `auth.go`, `tokens.go`, `device.go`, `admin.go`, `store/*.go`, `store/migrations/{001,004,008,019}.sql`, `releases/releases.go`, `hosted/routes.go`, `identity/oidc.go`, `credentials/credentials.go`, `client/client.go`, `cmd/francois/cmds/auth.go`, `deploy/compose/compose.yaml`
- Workspace guidelines: `../AGENT.md`, `../francois/AGENT.md`

---

## 12. Owner decisions, 2026-10-28

| # | Question | Answer |
| --- | --- | --- |
| D1 | Separate module or francois mode | Separate, independent copy |
| D2 | Workshop technology | React + RTK Query, atoms / molecules / organisms; should stay fairly simple |
| D3 | How the Workshop is deployed | Embedded in the binary, Vite proxy for quick iteration. Not through the DB — only artifacts are (revised the same day after a first answer suggested otherwise) |
| D5 | Database | Postgres; then: also SQLite for local use, if possible → both, one `database/sql` store |
| D9 | Pushed tool screens | Wanted ("Ramon makes a release board"), but the core Workshop stays embedded to avoid corruption |
| D8 | Local testing | Local mode without authentication but with nicknames, to test collaboration locally |
