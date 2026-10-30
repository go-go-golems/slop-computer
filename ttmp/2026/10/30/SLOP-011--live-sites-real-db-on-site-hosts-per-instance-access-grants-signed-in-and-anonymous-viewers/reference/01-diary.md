---
Title: Diary
Ticket: SLOP-011
Status: active
Topics:
    - architecture
    - auth
    - routing
    - collaboration
    - frontend
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/10/30/SLOP-011--live-sites-real-db-on-site-hosts-per-instance-access-grants-signed-in-and-anonymous-viewers/design-doc/01-intern-guide-live-sites-instances-and-access-grants.md
      Note: The intern guide this diary records
ExternalSources: []
Summary: "Chronological diary for SLOP-011: live apps on site hosts, instances and access grants."
LastUpdated: 2026-10-30T14:50:00-04:00
WhatFor: "How the SLOP-011 design was produced, with evidence"
WhenToUse: "Before continuing SLOP-011 or reviewing its guide"
---

# Diary

## Goal

Record how SLOP-011 was designed. The ticket makes apps on the public site host run live against the real database, with viewers who are signed-in people or anonymous sessions, databases named by instance id (`/blocks/<db>`), and a per-instance grant table that answers "who has access to this db".

## Step 1: What is published and what is live (investigation on the local server)

This ticket came out of four questions about the local test server (`slop20` on `127.0.0.1:18140`, tmux window `slop:server`). The user could not tell what was published, and Ask Claude in Blocks refused to run on the Workshop page they had open. The investigation established the three ways a page is seen (preview, live app, site route), added a read-only Blocks route as a demonstration, and showed that the site host never sees a principal. That last fact is the gap this ticket designs around.

No repository code changed in this step. All changes were to the local server's data: one saved version of `ws-team` and one route.

### Prompt Context

**User prompts (verbatim, in order):**
1. "so on localhost, can we make a route to blocks? I don't understand what is published and what isn't"
2. "so for exampe when I go http://localhost:18140/watch/blocks and I use \"ask claude\" it tellsme that it needs to run inside claude, but didn't we make that API available?"
3. "how does the DB binding work for artifacts? if I log in as an admin, if I am an anonymous user, if I am a normal user"
4. "so an admin on the real site doesn't get the real data, but in the backend, the same data is used each time? so it's long lived? Could we expose the full live view on the site?"
5. "what would it take to make site.* live with real db, and bind them to the user or to an anonymous session, maybe by assigning them live ids so that one could even imagine doing /blocks?db=XXX and check who has access to the db. That would actually be a more general mechanism for use(\"db\") and other rooms and such functionality?"

**Assistant interpretation:** Explain the publishing layers with evidence from the running server, make Blocks reachable on the site host, then explain and design live site apps.

**Inferred user intent:** One general mechanism by which any app (Blocks first) can be shared on a public URL, live, with access that can be inspected.

**Commit (code):** none in this step.

### What I did

- **Minted a local token** (local mode only, loopback): `curl -X POST localhost:18140/api/local/token -d '{"nickname":"agent","scopes":["read","write","admin"],"days":1}'`, saved to the scratchpad as `local.tok`. The stored login in `~/.config` points at the production server, so the local server needed its own token.
- **Listed state:** `slop artifacts list` showed 14 artifacts, among them `blocks` (page, main 1), six Blocks workspaces `ws-*` (data, `app = blocks`, main 0) and `design-live` (pinup data). `slop route list` showed only two routes, both `site.localhost:18140/proto/live[/:screen] → pinup-player` with `target = design-live`.
- **Read the serving code:**
  - `pkg/server/serve.go:334` `serveSite`: keeps only routes with `Access == "public"` and renders in `render.ModeSite`. It never reads a principal.
  - `pkg/server/serve.go:144-150`: on a site route, a `target` binding switches the page to `render.ModeStatic` through `staticRuntime`.
  - `pkg/server/serve.go:589` `staticRuntime`: `Docs` is the `db.json` file of the bound target version, or `{}`.
  - `web/runtime/src/static.ts`: in static mode `db` is read-only, `user` has no id, and every other capability resolves `null`.
  - `pkg/server/rt.go:27` `POST /api/rt/views` is `guard(admin, noToken, …)`; `levelOf` (`rt.go:97`) gives `LevelNone` to anyone whose role is not admin.
- **Made a Blocks snapshot route:**
  ```sh
  for c in chunks meta snaps; do slop data list ws-team $c --limit 1000; done \
    | jq -s '[.[].docs[]] | map({key: .path, value: .body}) | from_entries' > ws-team/db.json
  slop push ws-team -a ws-team -m "snapshot of the live log for a public route"   # → ws-team v1
  slop route set /blocks/team blocks --bind target=ws-team --note "public read-only Blocks snapshot"
  ```
  `curl -H 'Host: site.localhost:18140' localhost:18140/blocks/team` returned a boot block with `"mode":"static"` and the one chunk in `docs`. Playwright loaded the page with the title "👋 Welcome to Claude Blocks · Claude Blocks"; the only console error was `favicon.ico` 404.
- **Answered the Ask Claude question:** `/watch/<id>` asks `/api/sandbox-url` for `mode: preview` (`web/workshop/src/components/organisms/PreviewStage.tsx:30`). Preview mode opens no view, so every `claude.use()` resolves `null`, and Blocks shows "Asking Claude works when this page is open inside Claude." (`web/blocks/src/blocks.js:318`). In the live app at `/run/ws-team`, evaluating in the sandbox frame gave `sample: true, db: true`, and `sample.limits()` listed the Pi models (tiers `lunaroute/glm-5.3-flash`, `glm-5.3`, `deepseek-4.1-flash`).
- **Read the rules engine** (`pkg/rt/rules.go`): levels `none < view < interact < admin < owner < self`; default read `view`, write `interact`; `data/users/<id>/` private to that id; `meets` lets the owner meet everything but `self`.
- **Read the runtime schema** (`pkg/store/migrations/postgres/007_runtime.sql`): `rt_heads`, `rt_docs`, `rt_leases` and `rt_assets` are keyed by `target_id` (an artifact id); `rt_origins` maps one sandbox label to one target (`UNIQUE`).

### Why

- A data artifact (`kind = data`, `app = blocks`) already is a database instance: every table the runtime writes is keyed by its id. So "live ids" (`/blocks?db=XXX`) need no new storage concept, only a way to name the instance from a URL and decide who may open it.
- The snapshot route answered "can we make a route to blocks" without code, and made the difference between static and live concrete for the user.

### What worked

- The snapshot route served in static mode on the first try.
- `slop push` accepted a folder with only `db.json` for a data artifact.

### What didn't work

- `slop artifacts list` with no token: `not logged in to http://localhost:18140: run slop auth login --server http://localhost:18140, or set SLOP_TOKEN`. Fixed by minting a local token (above).
- `slop routes list`: `unknown command "routes" for "slop"`. The command is `slop route list`.
- `slop data list ws-team chunks --output json`: `unknown flag: --output`. `slop data list` prints JSON already.

### What I learned

- **A snapshot is frozen and has no rules.** Whatever `db.json` holds is readable by anyone, including `data/users/<id>/…` paths if they were copied in. My snapshot copied only `chunks`, `meta` and `snaps`.
- **The site host has no identity at all.** Even `--access admins` routes are simply not served there (`serveSite` filters them out); the admin-only flag is only meaningful inside the Workshop.
- **The live database is long-lived and shared.** Every `/run/ws-team` view and every `slop data` call reads and writes the same `rt_docs` rows.
- **The "normal user" role does not exist yet.** Roles are `admin`, `pending` and `disabled`. The rules engine already has `view` and `interact`, but nothing grants them.

### What was tricky to build

- Nothing was built. The subtle point for the design: the live secret must never be injected into HTML served from the site host, because every routed page shares that origin and could fetch another instance's page and read its secret. Live apps must keep one origin per target, behind a shell, as `/run` does.

### What warrants a second pair of eyes

- The snapshot route `site.localhost:18140/blocks/team` exists on the local server only. Remove it with `slop route undo /blocks/team` (with `SLOP_SERVER=http://localhost:18140` and the local token).

### What should be done in the future

- The design (Step 2): site shell, grants, instances, anonymous sessions, capability policy.
- Possibly a `slop data snapshot <target>` command that writes `db.json` and skips private and above-`view` paths.

### Code review instructions

- Nothing to review in code. To see the three layers: `http://localhost:18140/watch/blocks` (preview), `http://localhost:18140/run/ws-team` (live), `http://site.localhost:18140/blocks/team` (static).

### Technical details

| Layer | URL | Mode (`render.Mode*`) | Who | Data |
|---|---|---|---|---|
| Preview | `localhost:18140/watch/<id>` | `preview` (sandbox origin) | admins | none (`use()` → `null`) |
| Live app | `localhost:18140/run/<target>` | `app` (target origin `s<label>.sandbox.localhost`) | admins | live `rt_docs` of the target, rules applied |
| Site route | `site.localhost:18140/<path>` | `site`, or `static` with a `target` binding | anyone | `db.json` of a saved target version, no rules |

## Step 2: The intern guide, from three fact sheets

This step wrote the design and implementation guide. The guide had to cite about twenty files across three areas, so I sent three read-only search agents to collect fact sheets with `file:line` references in parallel: identity and host dispatch, the runtime server, and site serving with the shell handshake. I wrote the guide from those sheets, checked the claims the design depends on against the code, and corrected one of my own statements from Step 1.

The guide explains:
- the three hosts, artifacts, routes and bindings, and the five page modes;
- views, secrets and the shell handshake, static mode, levels and rules, and identity.

It then proposes the design:
- a site shell that keeps one origin per instance;
- site sessions by handoff for users and `vis_…` visitors;
- `rt_grants` and `levelOf` with caps;
- templated `target` bindings for `/blocks/:db`, and share links;
- a capability policy table, quotas, and an access API and CLI.

It closes with eight decision records, an API reference, a migration sketch, pseudocode, five phases, tests and open questions.

### Prompt Context

**User prompt (verbatim):** "Ok, create a new docmgr ticket and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

**Mid-step prompts (verbatim):** "what are fact sheets?" and "what's a fact sheet?" I answered that a fact sheet is a working note of verified facts with `file:line` references, gathered by read-only search agents, and not part of the ticket.

**Assistant interpretation:** Create SLOP-011 with an intern-level guide covering the current system and the design from the previous answer. Upload it to the reMarkable. No implementation.

**Inferred user intent:** A document someone new can implement from, and that the user can read on the reMarkable to decide the open questions.

**Commit (docs):** see the changelog entry for this step.

### What I did

- `docmgr ticket create-ticket --ticket SLOP-011 …`, then `docmgr doc add` for the design doc and the diary.
- **Collected three fact sheets** (Explore agents, read-only), each a structured list with `file:line`:
  1. host dispatch, cookies, `Principal`, guards, roles, OIDC and local sign-in, tokens, limiter, auth tables;
  2. `rtRoutes`, `openView`/`newView`/`levelOf`/`grantedCaps`/`viewOf`/`viewEvents`/`viewRPC`, the RPC table, rooms, `sample` gates, `rt_origins`, the runtime store and migration 007;
  3. routes and bindings, `serveSite`/`serveSandbox`/`renderPage`/`staticRuntime`, `render.Inject`, `transport.ts`/`index.ts`/`static.ts`, `AppScreen.tsx`, `runtime.md`, and Blocks' mode switch.
- **Checked by hand:**
  - `rt.go:160-196` (`targetURL`, `viewOut`, `newView`);
  - `serve.go:18-30` (the "neither carries the session cookie" comment);
  - `002_kernel.sql:10-19` (`artifacts.created_by REFERENCES users(id)`);
  - `kernel.go:140-156` (`createArtifact`);
  - `routing.go:93` (`fill` is unexported), `:167-186` (`FillPath`);
  - `push.go:268-276` (`slop pull`), `Makefile:31-33` (`make conformance`), `server.go:105-115` (sweep every 5 s);
  - `blocks.js:507-521`, `transport.ts:86-105`, `AppScreen.tsx:45-64`.
- **Wrote the guide**: `design-doc/01-intern-guide-live-sites-instances-and-access-grants.md`.
- **Tasks:** phase 1–5 tasks and an open-questions task; checked the guide task.
- **Index:** filled the overview and links.
- **Related files:** `serve.go`, `rt.go`, `AppScreen.tsx`.

### Why

- **Fact sheets via agents** kept the full contents of about twenty files out of the main context, while still giving exact references. The claims the design depends on were checked directly.
- **ASCII diagrams instead of Mermaid**: the guide goes to the reMarkable as a PDF, where Mermaid blocks would render as source text.
- **Linked, not repeated**: the guide links the SLOP-009 guide for per-capability runtime detail.

### What worked

- The three fact sheets agreed with each other and with the spot checks, with one exception (below).

### What didn't work

- **Correction to Step 1.** I said `site.localhost:18140/blocks/team` shows `ws-team`'s snapshot. It does not. In static mode `staticUser.me()` has no id, and Blocks switches to memory mode when `!db || !S.userId` (`web/blocks/src/blocks.js:514`). It then seeds its welcome example and ignores `runtime.docs`. The page title "👋 Welcome to Claude Blocks" matches the seeded example. The route serves the snapshot in its boot block (verified with curl in Step 1), but Blocks does not read it.
- My first draft referenced `routing.fill` and a non-existent `routing.FillTemplate`. `fill` is unexported (`routing.go:93`). The guide now says to export it as `routing.Fill`.

### What I learned

- **Every runtime table is already keyed by `target_id`**, and a data artifact with `app` is already an instance. So "live ids" need routing and access, not storage.
- **`viewOf` already binds a secret to its target's origin** (`rt.go:328`). Keeping apps on their own origin behind a shell is therefore enough to stop cross-instance secret use. It does not stop a same-origin page from asking `/_site/views` for a fresh view with the visitor's cookie. That is why decision D8 (CSP `sandbox` for non-shell site pages) is needed before non-admins are let in.
- **`sample` has no per-person budget** (`rt_sample.go:17-21`). Opening it beyond admins needs a budget first.
- **Two foreign keys block anonymous principals:** `rt_consents.user_id` and `artifacts.created_by` reference `users(id)`.

### What was tricky to build

- **Where to put the secret.** The tempting design renders the app on the site origin with the secret in the boot block. Tracing who shares an origin (every routed page on a site host) ruled it out. The shell plus per-target origins keeps the SLOP-009 invariant, at the cost of one iframe and a small copy of the `AppScreen` protocol.

### What warrants a second pair of eyes

- **Section 6.3** (same-origin risk and the CSP `sandbox` mitigation): whether opaque-origin site pages break anything existing. Candidates are pages that use `localStorage`, or that fetch `/_d/` without CORS.
- **Section 6.6** (`levelOf` caps and owner-by-grant for visitors).
- **The handoff flow** in section 6.4 (open redirect and code replay).

### What should be done in the future

- Decide the open questions in section 12.2, then implement phase 1.
- Remove or keep the local demo route `site.localhost:18140/blocks/team` (`slop route undo /blocks/team`).

### Code review instructions

- Read the guide's sections 2–5 against the cited files, then sections 6–7.
- Validate with `docmgr doctor --ticket SLOP-011 --stale-after 30`.

### Technical details

- The fact sheets were working notes and are not stored in the ticket. The guide's file reference (section 13) lists every file they covered.
