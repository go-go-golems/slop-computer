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

## Step 3: Phase 1, live routes for admins signed in by handoff

The user asked to build SLOP-011. The guide's section 12.2 left six product
questions open, and I had answered each with a recommendation the user
accepted with "Ok, build 011":
1. signed-in members create instances;
2. members get no `sample` by default;
3. URLs are `/blocks/:db`;
4. new users stay pending;
5. owners share from the site;
6. visitor data is offered, never claimed automatically.

Phase 1 needs none of them. A route can now be live: the site host serves a
small shell, the shell opens a view for the person signed in on that host,
and it frames the app on its target's own origin. Signing in on a site host
is a handoff from the main host with a one-time code. On the local server,
`site.localhost:18140/blocks/team` runs Blocks live against `ws-team`
("Shared · live"), and Ask Claude works there through the shell's own
consent dialog.

### Prompt Context
**User prompt (verbatim):** "Ok, build 011. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). Diary format from the skill is MANDATORY"
**Later, while working (verbatim):** "can you publish blocks on site.slop.yolo.scapegoat.dev too once you are done?"
**Assistant interpretation:** Implement the SLOP-011 guide phase by phase, with a commit and a diary step per phase. At the end, deploy it and publish Blocks as a live route on the cluster's site host.
**Inferred user intent:** Apps (Blocks first) running with live data on the public site, with access that can be granted and inspected, not only inside the Workshop.
**Commit (code):** cb350c4 — "SLOP-011 phase 1: live routes on site hosts, for admins signed in by handoff"

### What I did
- **Schema:** migration `008_live_sites.sql`, for SQLite and Postgres.
  - `routes` gains `live` and `create_policy`, and `access` gains `signed-in`. SQLite cannot change a CHECK in place, so it rebuilds the table; `routes` is referenced by nothing, so the rebuild is safe inside the migration's transaction with foreign keys on.
  - `site_sessions` is keyed by a principal id with no foreign key, so visitors (`vis_…`) fit later without another rebuild.
  - `site_handoffs` holds the one-time codes.
- **Store:**
  - `pkg/store/sitesessions.go`: `CreateSiteSession`, `ResolveSiteSession` (30 days idle, 90 days absolute), `RevokeSiteSession`, `SaveHandoff` (1 minute) and `ConsumeHandoff` (atomic, bound to its host).
  - `RevokeUserSessions` and `SetUserRole` (leaving admin) also revoke site sessions.
  - `Route` gains `Live` and `Create`. `validate` rejects: `signed-in` without live, `create` without live, a live fallback, and a live page-from route.
- **Server:** new `pkg/server/live.go`.
  - The site cookie: `__Host-slop_site` in production, `slop_site_dev` locally, SameSite=Strict, HttpOnly.
  - `siteOrigin(s)`, and `parentOrigin(r)`, which `targetURL` now uses, so a view opened from a site is framed by the site.
  - `siteResolve`; `shellRequest`, the check for calls that change something (Origin equal to the site origin, `Sec-Fetch-Site: same-origin` when present, JSON).
  - `siteReturn`, which keeps returns local and off `/_site/`.
  - The `/_site/` mux: `me`, `login`, `callback`, `logout`, `views`, plus `renew`, `consent` and `DELETE`, which reuse the main-host handlers through an injected `Principal`.
  - `handoff` (`GET /auth/handoff`); `servedRoutes`, `admitted`, `liveTarget` and `openSiteView`.
  - `serveShell`, the shell page with its own CSP (`frame-src` limited to the sandbox domain).
- **Wiring:**
  - `serveSite` dispatches `/_site/`, resolves among served routes, and answers live routes with the shell. Its `public` set is now static public routes only, so live routes make no files or data public.
  - `serveSandbox` accepts site origins as `parent` and in `frame-ancestors`.
  - `safeReturn` admits `/auth/handoff?`.
  - Assets embed `*.css`, served as `text/css`.
- **Shell:** `pkg/render/assets/shell.js` and `shell.css`. It sends `hello` → `view`, renews (reopening when the server forgot the view), shows consent and download dialogs, declines `compose` and `permissions`, reopens on `reload`, mirrors `args` into the hash, and closes the view on `pagehide`.
- **CLI and Workshop:** `slop route set --live --access --create`, and `describeRoute` shows "live on <target> for <access>". `client.Route` gains `Live` and `Create`. The Workshop route type gains `signed-in`, `live` and `create`; the Routes screen tags live routes and has a Runs switch (static page / live app) with access choices that fit.
- **Tests:** `pkg/server/live_test.go`, with a `siteBrowser` that sets Host, Origin and the site cookie itself, and a `handoff` helper.

### Why
- **`access` gains `signed-in` instead of a new `viewers` field**, so there is one notion of who sees a route. Static routes keep their meaning (`public` served, `admins` Workshop only). On live routes, every value serves the shell and decides who may open the app.
- **Sessions keyed by principal** avoid a later SQLite rebuild when anonymous visitors arrive.
- **Site views reuse the main-host view handlers** (`renewView`, `consentView`, `closeView`) behind `siteOwnView`. Ownership stays the same check: the view's user is the caller.
- **`admitted` treats `signed-in` and `public` as admins-only for now.** Members (phase 2) and visitors (phase 4) widen it; until then no route lets anyone but an admin in.

### What worked
- `GOWORK=off go test ./...` passes; Postgres too, via `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/…` for `./pkg/store/... ./pkg/server/...`. `make lint` reports `0 issues.`; `tsc` is clean.
- `TestLiveRouteForAdmins`:
  - the shell has no `slv_` secret and has `frame-src http://*.sandbox.test`;
  - signed out, `/_site/views` gives 401;
  - signed out on the main host, the handoff goes to `/auth/login?return=%2Fauth%2Fhandoff%3F…`;
  - an unknown host gives 400;
  - after the handoff, `/_site/me` names the user;
  - the view's URL is on `*.sandbox.test` with `parent=http://site.test`, its stream says hello, and `db.write` works;
  - the sandbox page carries `"parentOrigin":"http://site.test"` and lists the site in `frame-ancestors`;
  - renew gives 200;
  - no Origin, another Origin, `Sec-Fetch-Site: cross-site` and a form content type each give 403;
  - leaving admin gives 401; logout clears `/_site/me`.
- `TestHandoffCodes`: `//evil.test/x` returns to `/`, a used code gives 400, and a code made for another host gives 400.
- `TestLiveRouteRules`: three invalid routes give 400, an unrelated target gives 404, and the app's `/_v/` files are 404 on the site.
- Local browser check:
  - Made `/blocks/team` live (access admins, target `ws-team`) through `PUT /api/routes`.
  - Signed out, the shell shows "Sign in to open this.". Sign in → handoff → back; the bar shows "manuel · Sign out", and the frame is on `s164c…sandbox.localhost:18140/v/1/`.
  - Inside the frame: `user.id()` = `usr_02657c…`, `db` is available, and the header reads "Shared · live".
  - After deleting the stored Blocks `sample` consent in the scratch database, `sample` opened the shell's dialog ("Allow Claude Blocks · Team workspace? … Claude (sample): …"). Allow, and the reply was `live sites work`.

### What didn't work
- My test called `db.set`, which is not an RPC method (`capability_removed`); the method is `db.write` with `op: "set"`.
- `leaving admin revokes site sessions too: 403`: `SetUserRole` revoked main sessions and tokens but not site sessions. Fixed in the store, as part of the same rule.
- The first consent check showed no dialog. `rt_consents` already had `blocks/sample granted` for this user from the Workshop, which is correct: consents are per person and app, not per host.
- Lint: gofmt on `live.go`, and `nonamedreturns` on `ConsumeHandoff`; both fixed.
- I first wrote a second `siteHost` helper. One already existed in `siteindex.go`, where `""` means the first site host, so the handoff now requires an explicit `host`.

### What I learned
- Migrations run in one transaction with foreign keys on. SQLite ignores `PRAGMA foreign_keys` inside a transaction, so rebuilding a parent table (`users`, for the `member` role in phase 2) needs the runner to switch foreign keys off around it and run `foreign_key_check` after.
- The harness's cookie jar keys cookies by URL, not by the Host header. Site-host tests need their own cookie handling.
- With SameSite=Strict, the shell's first GET after the cross-site redirect may arrive without the cookie. That does no harm: the shell holds nothing, and its same-origin `fetch` calls do carry the cookie.

### What was tricky to build
- **Two origins for one view.** `targetURL` took the parent from `requestOrigin(r)`, which falls back to the main host for any other host. A site view would have told the page to trust the Workshop as parent and ignore the shell. `parentOrigin` picks the site origin for site requests, and the sandbox must accept it both in `?parent=` and in `frame-ancestors`.
- **Which routes make what public.** Live routes must resolve on the site but must not make their app's files or data public. Two sets: `served` (static public plus live) for resolving paths, and `public` (static public only) for `/_d/`, `/_r/` and `/_v/`.

### What warrants a second pair of eyes
- **The shell's same-origin exposure** is still there for non-admin pages. Any page on the site host can `fetch('/_site/views')` with the visitor's cookie. Phase 1 only admits admins, whose pages are admin-authored; phase 2 must serve non-shell site pages with CSP `sandbox` (D8) before members get in.
- **The `/_site/` handlers' ownership check.** `siteOwnView` injects a `Principal{User}` so `ownView` compares view owner and caller. Check that nothing else reads a missing `Session` from that principal.

### What should be done in the future
- Phase 2: grants, the `member` role (with the migration-runner change), `levelOf` with grants and caps, the access API and CLI, the capability policy, and CSP `sandbox` on non-shell site pages.
- At the end: deploy, then publish Blocks live on `site.slop.yolo.scapegoat.dev` (the user's request).

### Code review instructions
- Start with `pkg/server/live.go` top to bottom, then the `serveSite` and `serveSandbox` changes in `serve.go`, `pkg/render/assets/shell.js`, and `pkg/store/sitesessions.go`.
- Then read migration 008.
- Validate:
  1. `GOWORK=off go test ./pkg/server -run 'TestLiveRoute|TestHandoff' -count=1`
  2. On a local server: `slop route set /blocks/team blocks --bind target=ws-team --live --access admins`, then open `http://site.localhost:<port>/blocks/team`.

### Technical details
- The handoff:

  ```text
  shell "Sign in" → /_site/login?return=/x
    → main /auth/handoff?host=<site>&return=/x   (signed out: /auth/login?return=/auth/handoff?…)
    → <site>/_site/callback?code=<48 hex>        (code hash stored, 60 s, host-bound, single use)
    → Set-Cookie slop_site; 303 /x
  ```

- Shell CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src <scheme>://*.<sandbox>; frame-ancestors 'self' <main origins>; base-uri 'none'; form-action 'self'`.

## Step 4: Phase 2, grants, members, and pages sandboxed on live hosts

Phase 2 lets someone other than an admin open a live app. A person can now be
a `member`. A target holds explicit grants (`rt_grants`) for a person, for
everyone signed in, or for anyone. A person's level on a target is the
highest that their role, authorship and grants give them, capped by their
role. Admins inspect and change grants through `GET /api/rt/targets/{t}/access`
and `slop access ls|grant|revoke`. Members get no models, no publishing and no
`slop` permissions, whatever their level.

One correction to my earlier reasoning changed the order of work. I had
treated the site host as admin-authored. On the cluster it serves francois
releases, which are third-party code, on the same origin as the shell and its
`/_site/` API. So D8 (CSP `sandbox` on every non-shell page of a host with a
live route) is in this phase, not deferred. It is a precondition for
publishing Blocks on `site.slop.yolo.scapegoat.dev`.

### Prompt Context
**User prompt (verbatim):** see Step 3 ("Ok, build 011. …"; "can you publish blocks on site.slop.yolo.scapegoat.dev too once you are done?").
**Assistant interpretation:** The second phase of the guide: grants, the member role, the access API and CLI, the capability policy, and the CSP sandbox.
**Inferred user intent:** Ramon or another member can be let in and given one app, without being able to use models or the Workshop as an admin.
**Commit (code):** 3d5c8bc — "SLOP-011 phase 2: grants, member role, access API and CLI, CSP sandbox for site pages"

### What I did
- **Migration 009** (`009_grants.sql`):
  - SQLite rebuilds `users` so its role CHECK admits `member`, and recreates `users_email`. Postgres drops and re-adds `users_role_check`.
  - Both create `rt_grants(target_id → artifacts, subject, level CHECK, via, created_by, created_at, PK(target_id, subject))`.
- **Migration runner** (`pkg/store/store.go`), on SQLite only:
  - `PRAGMA foreign_keys=OFF` before the transaction, re-enabled by a defer.
  - `PRAGMA foreign_key_check` before commit; any row fails the migration ("migrations left a broken foreign key in %s").
  - `Migrate` now calls `migrate(ctx, until)`, so a test can stop at 008.
- **Store:**
  - `RoleMember`.
  - `pkg/store/grants.go`: `ValidSubject` (`usr_…`, `vis_…`, `*signed-in`, `*anyone`), `RTGrants`, `RTGrantsFor`, `RTSetGrant` (upsert, audit `access.grant`) and `RTRemoveGrant` (audit `access.revoke`).
  - Both publish `access.changed`.
- **Server, `pkg/server/access.go`:**
  - `subjectsOf`, `levelCap` (admin up to owner, member up to admin), `levelOf`, and `reviewViews`, which closes a target's views whose level changed so the shell renews them.
  - The access API, admin-only through `guard(admin, scopeRW)`.
  - `putGrant` refuses a `usr_` id that does not exist.
  - The listing names `*signed-in` and `*anyone` in plain words.
- **Capability policy** (`rt.go`, `rt_more.go`, `rt_sample.go`). `View` carries `Role`:
  - `sample` (including `sample.limits`), `artifact.publish` and the `slop` permissions require the admin role;
  - `assets` (and `userInfo`'s `assets.write`) require level ≥ interact.
- **Live hosts:**
  - `admitted` lets members in on `signed-in` and `public` routes.
  - `siteHeaders`: when a host has any live route, every page that is not the shell gets `Content-Security-Policy: frame-ancestors …; sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads` and `Access-Control-Allow-Origin: *`; `serveShell` drops the ACAO.
  - `runtime.js` gives a page memory-backed `localStorage` and `sessionStorage` when touching them throws, which is what an opaque origin does.
- **CLI:** `cmd/slop/cmds/access.go` (`ls`, `grant`, `revoke`), the client methods in `pkg/client/access.go`, and a `live` column in `route list`.
- **Workshop:** the role select has `member`. A pending person gets "Let in as member" (primary) and "as admin". `home.tmpl` tells members the Workshop is not for them.
- **Tests:**
  - `TestGrantsAndMembers`, `TestMemberCapabilityPolicy` and `TestSitePagesIsolated` in `live_test.go`.
  - `TestUsersRebuildKeepsReferences` in `pkg/store/migrate_internal_test.go`.

### Why
- **Cap by role, not just max of grants.** A mistaken `owner` grant to a member must not make them more than an admin of that target. Owner on a target means "may manage its access", which phase 5's share dialog relies on.
- **Admins are admin on every target, not owner.** Owner stays meaningful (the creator, or an explicit grant), while admins can still do everything through the Workshop.
- **Capabilities follow the role, not only the level.** `sample` spends the server's model budget and `slop` permissions reach the kernel. Decision 2 says members get no `sample`. A level-only check would hand both to any member with an admin grant.
- **Sandbox the pages, not the shell.** The shell is ours and needs the site origin for its cookie and `/_site/`. Everything else on that host, including francois releases, gets an opaque origin, so it can neither read the shell's cookie-bearing API nor script the shell's window. `ACAO: *` keeps those pages' own `fetch` calls to `/_d/` and `/_r/` working from the opaque origin. Those files are public anyway, and no credentials are sent.
- **Only on hosts with a live route.** A host with no live route has nothing to protect, and its releases keep real `localStorage`.

### What worked
- `GOWORK=off go test ./...` passes; Postgres (`TEST_DATABASE_URL=… go test ./pkg/store/... ./pkg/server/...`) passes; `make lint` reports `0 issues.`; `tsc` is clean.
- `TestGrantsAndMembers`:
  - a member without a grant gets 403;
  - with `*signed-in view` they open the view, with no `sample` or `assets`;
  - after `interact` they can `db.write`;
  - an `owner` grant gives a member `admin`, not owner;
  - the access listing names grants;
  - revoking closes their view, and the next open is 403;
  - an unknown `usr_` gives 400, and a malformed subject gives 400.
- `TestMemberCapabilityPolicy`: an admin-level member gets `assets` but not `sample`, `artifact` or `slop`; an admin gets all of them.
- `TestSitePagesIsolated`: no sandbox without a live route; with one, pages get `sandbox allow…` and `ACAO *`; the shell is not sandboxed; `/_site/` has no ACAO.
- `TestUsersRebuildKeepsReferences`: after 009, a session and a token made under 008 still resolve, and `PRAGMA foreign_keys` is back on. I checked that the test can fail: with the runner's foreign-key switch removed, the migration fails with `FOREIGN KEY constraint failed`.
- On the local server:
  - 009 applied to the scratch database (`schema_migrations` lists it), both users are kept, and `foreign_key_check` is empty.
  - `slop access grant ws-team '*signed-in' view` → `ls` shows owner, the grant, my open view and the live route → `revoke` works. `grant … usr_nope view` → `invalid_request: No such person`; `grant … boss` → `a level is view, interact, admin or owner`.
  - `route list --output-fields host,path,page,access,live` shows `/blocks/team … admins true`.
- The storefront on `site.localhost:18140`, now sandboxed because `/blocks/team` is live, renders with no console errors: `/` showed 94 covers in 588 ms, and `/apps/blocks` showed its "No app called blocks" page, which is right because Blocks is not in the francois catalog.

### What didn't work
- In `grantedCaps`, `sample` came back for members: the block that adds per-capability options re-added it. Options are now added only for capabilities still in `out`.
- `TestSitePagesIsolated` first passed for the wrong reason. It looked for "sandbox" in the CSP, which matched `frame-src http://*.sandbox.test` on the shell. It now looks for `sandbox allow`.
- The local CLI token was stale (`token_invalid`). I signed in with local mode and minted a 7-day token through `POST /api/tokens` with the session's CSRF.
- `slop access ls --output json`: `unknown flag: --output`. Glazed uses `--output-fields` and `--format`.

### What I learned
- SQLite rebuilds of a parent table are only safe with foreign keys off and a `foreign_key_check` afterwards. With them on, `DROP TABLE users` either fails or cascades into sessions and tokens, depending on the schema. `PRAGMA foreign_keys` is a no-op inside a transaction, so the switch has to sit outside it.
- An opaque-origin page throws on `localStorage` access, not on `window.localStorage` being undefined. The shim has to try it and fall back.

### What was tricky to build
- **Where the trust line runs on a site host.** Phase 1 left a gap: any page on the host could call `/_site/views` with the visitor's cookie and receive a view secret. Making the shell the only page with the real origin closes the gap. The cost is that releases on a live host lose persistent storage.
- **Closing views on a grant change.** A view's level is fixed when it opens. `reviewViews` compares each open view's level with `levelOf` now and closes those that differ (up or down). The shell renews, and the new view carries the new caps. Closing only on demotion would leave a promoted member without the capabilities they were just given.

### What warrants a second pair of eyes
- **`siteHeaders` CSP vs. what francois releases need.** `allow-same-origin` is deliberately absent. Releases that use `localStorage`, `IndexedDB`, cookies or service workers lose persistence on a live host. Check this before publishing Blocks on the cluster's site host. The alternative is a separate host just for live routes.
- **`levelOf` errors.** A store error reading grants falls back to role and authorship (logged), which fails closed for members.
- **`ACAO: *` on site pages.** It makes them readable cross-origin. They are already public pages, and no credentials flow, but it is a new header on that host.

### What should be done in the future
- Phase 3: `/blocks/:db` with `routing.Fill` in `liveTarget`, `create` policy and `POST /_site/instances`, share links (`rt_links`, `?k=`).
- Tell the user about the storage trade-off before publishing Blocks on `site.slop.yolo.scapegoat.dev`.

### Code review instructions
- Read in this order:
  1. `pkg/server/access.go`;
  2. the `grantedCaps` and `newView` hunks in `rt.go`;
  3. `siteHeaders` in `live.go`;
  4. the storage shim at the top of `runtime.js`;
  5. the runner change in `pkg/store/store.go` with both `009_grants.sql`.
- Validate:
  1. `GOWORK=off go test ./pkg/server -run 'TestGrants|TestMember|TestSitePages' -count=1`
  2. `GOWORK=off go test ./pkg/store -run TestUsersRebuild -count=1`
  3. Locally: `slop access grant <target> '*signed-in' view`, and `curl -sI http://site.localhost:<port>/` shows the sandbox CSP.

### Technical details
- The level, in pseudocode:

  ```text
  levelOf(u, t):
    pending/disabled            → none
    u created t                 → min(owner, cap(role))
    base = admin if role=admin else none
    best = max(base, grants for {u.id, *signed-in, *anyone} on t)
    → min(best, cap(role))      cap: admin→owner, member→admin
  ```

- The capabilities a view gets, by role and level:

  | | member, view | member, interact+ | admin |
  |---|---|---|---|
  | db, user, room, comments | per level | per level | all |
  | assets | no | yes | yes |
  | sample, artifact.publish, slop perms | no | no | yes |

## Step 5: Phase 3, instances named in the path, and share links

A live route can now name its target in the path: `/blocks/:db` with
`--bind 'target={db}'` opens any Blocks workspace by its id, and nothing that
is not a Blocks workspace. On a path with nothing behind it, the shell offers
"Create a new one" to whoever the route's create policy admits. That creates
an empty data artifact with a random `i-…` id, owned by its creator, and goes
there. An admin can make a share link to any target. Whoever opens the link
(signed in, and admitted by the route) gets the link's level as a grant
recorded "via" the link. Revoking the link takes those grants away.

On the local server:
1. `site.localhost:18140/blocks/new` showed "There is nothing here yet. Sign in to create one."
2. After the handoff: "Create a new one".
3. Clicking it landed on `/blocks/i-tmtocfaazmgvi6ip`, an empty Blocks workspace.
4. `slop access link i-tmtocfaazmgvi6ip --level interact --days 7` printed the URL.
5. Ramon, a member, opened it signed out, signed in, and was in at `interact`. The token survived the handoff and left the address bar.

### Prompt Context
**User prompt (verbatim):** see Step 3.
**Assistant interpretation:** Phase 3 of the guide: templated target bindings, the create policy with `POST /_site/instances`, and share links with their API and CLI.
**Inferred user intent:** Anyone let in can start their own Blocks workspace on the site and share it with a link, without an admin creating artifacts by hand.
**Commit (code):** 5cbdbdc — "SLOP-011 phase 3: targets named in the path, instances, share links"

### What I did
- **Routes** (`pkg/store/routes.go`): `TemplatedTarget(r)` returns the path parameter a target names. `validTemplatedTarget` admits a `{param}` only:
  - in the `target` binding,
  - on a live route,
  - as exactly one placeholder,
  - for a parameter the path has,
  - with no version.

  `create` now requires a templated target, and `SetRoute` skips its existence check for templated bindings.
- **`liveTarget`** fills the target from `res.Params`. A templated route only opens data artifacts whose `app` is the routed page; `/blocks/blocks` (the app itself) is not an instance.
- **`openSiteView`:**
  - resolves the principal first;
  - answers a missing instance with `404 {error: {code: "no_instance"}, create, mayCreate}`;
  - redeems `link` (the `?k=` token) before opening the view. An unknown, revoked or expired token gives `403 link_invalid`.
- **`createInstance`** (`POST /_site/instances {path}`, behind `shellOnly`):
  - requires a live templated route with a create policy, a principal, and `mayCreate` (admitted, and the policy's role);
  - creates `i-<16 base32>` with `app` = the page, the app's project, `created_by` = the person, and title "<name>, <date>";
  - returns `201 {id, path}`.
- **`levelOf`:** a creator is owner whatever their role, so a member owns the instances they create. Grants are still capped at admin for members.
- **Share links:**
  - Migration `010_links.sql`: `rt_links(id lnk_…, target_id, token_hash UNIQUE, level view|interact, created_by, created_at, expires_at, revoked_at)`.
  - `pkg/store/links.go`: `RTLinks`, `RTCreateLink`, `RTRevokeLink` (also deletes grants `via` the link) and `RTRedeemLink`, which never lowers an existing grant.
  - API: `POST /api/rt/targets/{t}/links {level, days}` → `{link, token, urls}`, and `DELETE …/links/{id}`.
  - `targetAccess` lists links and the live routes with their concrete URLs (`liveRoutesOf`).
- **CLI:** `slop access link <target> --level --days` and `slop access unlink <target> <id>`. `access ls` shows links (active / until / expired / revoked) and route URLs. `describeRoute` reads "live on the blocks data named by :db for signed-in, created by signed-in".
- **Shell** (`shell.js`):
  - takes `?k=` out of the URL at load and sends it with the first open;
  - keeps it in the sign-in return while unused;
  - shows "Create a new one" or "Sign in to create one" for `no_instance`;
  - runs `me()` before `open()`, so it knows whether someone is signed in.
- **Workshop** (`RoutesScreen.tsx`): a templated target shows as "named in the path (:db)", plus a "New ones" switch (no one / signed in / admins).
- **Tests:** `TestInstances`, `TestShareLinks`, and the race fix in `rt_test.go` (below).

### Why
- **Only `{param}`, not `ws-{db}`.** A prefix would need the created id to fit the template. One placeholder covers the use (`/blocks/:db`) and keeps creation, link URLs and listing simple.
- **Random ids for instances.** Decision 3 is `/blocks/:db`. With a guessable id, anyone who knows the pattern could find instances once phase 4 lets visitors in. A grant still decides access, but unguessable ids keep the existence of instances private too.
- **Creators own, even members.** Decision 5 is that owners manage access from the site. A member capped at admin on their own instance could never share it. The cap still stops grants from making a member owner of someone else's target.
- **Link → grant, not link → view.** The link is redeemed once, and the person keeps their level without the token, so the token can leave the URL. The grant's `via` names the link, so revoking the link can find and remove exactly those grants.
- **Never lower.** Someone with `admin` who opens a `view` link must not drop to `view`.

### What worked
- `GOWORK=off go test ./...` passes (server run three times in a row after the race fix), as do Postgres store and server tests; `make lint` reports `0 issues.`; `tsc` is clean.
- `TestInstances`:
  - five invalid templated routes give 400 (not live, unknown param, prefixed, another binding, create on a fixed target);
  - `/board/ws` opens, and the owner (Manuel created it) gets owner;
  - `/board/board` and another app's data give `no_instance`;
  - a member gets `mayCreate`, creates `i-…` at `/board/i-…` with `created_by` set, opens it as owner and writes;
  - the member gets 403 on someone else's workspace;
  - `create: admins` gives the member 403, no policy gives 404, and signed out gives 401.
- `TestShareLinks`:
  - the link URL is `http://site.test/board/team?k=<token>`; an `admin` link gives 400;
  - without the link, 403; a wrong token, `link_invalid`; with it, `interact`, which stays without the link;
  - an existing `admin` grant is not lowered;
  - the access listing shows one link and the grant `via` it;
  - revoking gives 403 for the person and for the token; revoking twice gives 404.
- Mutation checks:
  - dropping the "templated targets are data" check fails `TestInstances` (`/board/board: 200`);
  - dropping the never-lower check fails `TestShareLinks` ("a link lowered a grant").
- Browser (Playwright, local server): the create flow and the link flow described above. `slop access ls i-tmtocfaazmgvi6ip` then showed the owner, Ramon's grant "by share link lnk_a9fd…", the link "until 2026-11-06", both open views, and the route URL.

### What didn't work
- `TestInstances` first expected `admin` for Manuel on `/board/ws`. He created `ws`, so owner is right; the test was wrong.
- A full `go test ./...` run panicked: `send on closed channel` at `rt_test.go:78`. The test helper's SSE reader read `vc.events` at send and close time. A reconnect on the same `viewClient` replaced the channel, and the old reader closed the new one. This was pre-existing (`streamFrom` is from SLOP-009) and depends on timing; it showed up now because more tests reconnect. Each reader now owns its channel.
- `gofmt` on `pkg/client/access.go` after replacing a struct with `Links []Link` (alignment).
- In Playwright, signing in with `fetch('/auth/local')` from the main host's page failed ("Failed to fetch"). Using `context.request.post(…, {form})`, which shares the cookie jar, works.
- The first instance's title came out as "Claude Blocks · Claude Blocks · manuel" in the shell bar, because the instance title repeated the app's title. New instances are titled "<name>, <date>".

### What I learned
- A share-link token in a URL has three leaks to close: the address bar (bookmarks and copy), `Referer` (the shell's policy is `same-origin`, and the app runs elsewhere), and the sign-in round trip. The shell removes it at load, but has to carry it through the handoff until it is redeemed.
- Opening a view and creating an instance both need "who is this" before "what is this". Resolving the principal first lets a missing instance answer with `mayCreate`.

### What was tricky to build
- **The shell's first screen depends on two answers.** `no_instance` with `create` but `mayCreate: false` means either "sign in" or "you may not", and only `/_site/me` tells which. `me()` runs first, which costs one request on load.
- **Revoking a link vs. grants that already exist.** A grant created via a link and later raised by an admin keeps `via` (the upsert in `RTSetGrant` writes `via = ""`, so an admin's explicit grant clears it). Revoking the link only removes grants still marked as coming from it.

### What warrants a second pair of eyes
- **`createInstance` has no quota yet.** A member can create instances without limit. Phase 4 adds quotas and a limiter. Until then, `create: signed-in` should only be set where members are trusted.
- **`RTRedeemLink` audits as the redeemer** (`actor = subject`). That is accurate (they used the link), but the audit log then shows a member "granting" themselves; the `via` field explains it.
- **`liveRoutesOf` reads all routes of all hosts** per access listing and per link. Fine at this size.

### What should be done in the future
- Phase 4: visitors (`vis_…`), access `public` for the signed-out, quotas and a limiter (instances per principal), garbage collection, and the explicit claim.
- Phase 5: the Workshop Access panel, owners sharing from the site (a share dialog in the shell for owners), and help pages.

### Code review instructions
- Read in this order:
  1. `createInstance`, `liveTarget`, `mayCreate` and `openSiteView` in `pkg/server/live.go`;
  2. `pkg/store/links.go`;
  3. `TemplatedTarget` and `validTemplatedTarget` in `pkg/store/routes.go`;
  4. `postLink`, `deleteLink` and `liveRoutesOf` in `access.go`;
  5. the top of `shell.js` (the token handling).
- Validate:
  1. `GOWORK=off go test ./pkg/server -run 'TestInstances|TestShareLinks' -count=1`
  2. Locally: `slop route set /blocks/:db blocks --bind 'target={db}' --live --access signed-in --create signed-in --host site.localhost:<port>`, open `/blocks/new`, create, then `slop access link <id> --level interact`.

### Technical details
- The flow:

  ```text
  GET /blocks/new                → shell
  POST /_site/views {path}       → 404 {error:{code:no_instance}, create:true, mayCreate:true}
  POST /_site/instances {path}   → 201 {id: i-tmtocfaazmgvi6ip, path: /blocks/i-tmtocfaazmgvi6ip}
  location.assign(path) → shell → POST /_site/views → view (owner)

  slop access link <id> --level interact --days 7  → http://site…/blocks/<id>?k=<48 hex>
  shell: strip ?k= → POST /_site/views {path, link} → RTRedeemLink → grant(via=lnk_…) → view (interact)
  ```

## Step 6: Phase 4, guests on public live routes

Someone who is not signed in can now open a live route whose access is
`public`, if a grant to `*anyone` or a share link lets them in. They become a
**visitor**: an id `vis_…` and a site session, with no row in `users`. Apps
see them as "Guest" with `guest: true`. They get at most `interact`, and no
files, comments, consent, models or publishing. They cannot create instances.

Abuse limits are in place:
- 30 new visitors per address an hour;
- 120 view opens per principal an hour;
- 50 instances per member a day.

Visitors unseen for 90 days are swept with their sessions, grants and private
documents. A guest who signs in is offered what they did as a guest (their
private documents and grants). It is kept only if they say so (decision 6).

On the local server, a fresh browser opening `/blocks/i-tmtocfaazmgvi6ip`
(with `*anyone interact`) got the bar "Guest · Sign in", and Blocks ran live
("Shared · live") in its frame.

### Prompt Context
**User prompt (verbatim):** see Step 3.
**Assistant interpretation:** Phase 4 of the guide: visitors, guest-aware runtime, quotas and limits, garbage collection, and the explicit claim.
**Inferred user intent:** A Blocks workspace can be shown to people without accounts, safely: they can look or edit as allowed, but cannot run up costs or fill the server.
**Commit (code):** 722c158 — "SLOP-011 phase 4: guests on public live routes, limits, sweep, claim"

### What I did
- **Migration `011_visitors.sql`:** `visitors(id, created_at, last_seen_at, claimed_by → users)`, plus `site_sessions.from_visitor`.
- **Store:**
  - `pkg/store/visitors.go`: `VisitorPrefix`, `IsVisitor` and `RoleVisitor` (never stored); `CreateVisitor` and `TouchVisitor`.
  - `PrivateDocs(id)`: `data/users/<id>/…` across targets, matched with `substr`, not `LIKE`, because `_` is a wildcard in `LIKE`.
  - `MoveGrants(from, to)`, which keeps the higher level; `ClaimVisitor`; and `SweepVisitors(idle)`, which deletes sessions, grants, private docs and the row, with one audit entry `visitor.expire`.
  - `SubjectGrants(subject)`.
  - `CreateSiteSession` takes `fromVisitor`; `SettleFromVisitor`.
  - Routes refuse `create: public` ("visitors cannot create instances").
- **Server, `live.go`:**
  - `siteResolve` turns a `vis_` session into `visitorUser(id)` after `TouchVisitor`.
  - `newVisitor` (rate-limited per address).
  - `openSiteView` makes a visitor only on a `public` route where a link is present or `*anyone` gives a level, then limits opens per principal.
  - `admitted("public")` admits visitors.
  - `createInstance` sends visitors to sign in and limits members per day.
  - `siteMe` reports `visitor`, or `user` with a `claim` summary.
  - `signedInOnly` guards site consent.
  - `siteCallback` records the visitor a person signed in over and revokes the visitor's session.
  - `siteClaim`: `{keep: true}` copies private docs to `data/users/<usr>/…` where the person has none (through `RTWrite`, published to open views), moves grants and marks the visitor claimed. Either answer settles the offer.
- **`access.go`:**
  - `subjectsOf(visitor)` = `{id, *anyone}` and `levelCap(visitor)` = interact.
  - `viewer(id)` resolves people or visitors; `reviewViews` uses it.
  - The listing names visitor grants "a guest".
- **Runtime:**
  - `grantedCaps` drops `assets` and `comments` for visitors.
  - `profileOf` gives visitors `{name: "Guest", guest: true}`, with no avatar or email.
  - `userInfo` adds `guest`; `user.profiles` answers `vis_` ids.
  - `room.emit` and `AsPeer` set `guest` (in `pkg/rt` by prefix, since `rt` does not import `store`).
- **Server loop:** `SweepVisitors(VisitorIdle)` hourly, next to the view sweep. A `siteLimits` limiter sits on the server.
- **Shell:**
  - shows "Guest · Sign in";
  - refreshes `me` after the first open that made this browser a guest;
  - offers the claim in a dialog ("Keep it" / "Leave it"; dismissing asks again next time, so `ask` now returns `null` for dismissal).
- **Tests:**
  - `TestVisitors`, `TestVisitorLimit` and `TestVisitorClaim` (with a `handoffOver` helper that signs in over a guest cookie);
  - `TestSweepVisitors` in the store.

### Why
- **No `users` rows for visitors** (guide 6.5). The people list stays the people let in, visitors expire, and none of the foreign keys to `users` matter: visitors get no consents, comments, assets, versions or authorship, and `rt_docs.updated_by`, audit and event actors have no foreign key.
- **Visitors never create.** Decision 1 is that signed-in people create instances. It also removes the need for visitor-owned artifacts (`artifacts.created_by` references `users`) and for collecting abandoned anonymous instances.
- **Create a visitor only where it gets in.** A public route with no `*anyone` grant and no link would mint a visitor and a session for nothing. `openSiteView` first asks `levelOf` for a fresh visitor.
- **The claim copies, it does not move.** The guest's documents stay where they were until the sweep, so a mistaken "Keep it" loses nothing. Documents the person already has win: the guest's copy is skipped.
- **Limits in memory.** The guide's limiter was per-process already (`deviceLimiter`). One replica serves the cluster, and a restart resetting counters is acceptable for abuse limits.

### What worked
- `GOWORK=off go test ./...`, Postgres (`./pkg/store/... ./pkg/server/...`), `make lint` (`0 issues.`) and `tsc` all pass.
- `TestVisitors`:
  - with no `*anyone` grant, a guest gets 401 and no cookie;
  - with `*anyone admin`, a guest gets `interact`, has `db`, `user`, `room` and `downloads`, and lacks `assets`, `comments`, `sample`, `artifact` and `slop`;
  - hello's `me` is `{id: vis_…, guest: true, profile.name: Guest}`, and `user.profiles` marks the id `guest`;
  - the guest writes its own `data/users/<vis>/draft`; `/_site/me` says `visitor`; a second open is the same visitor;
  - consent gives 403, create gives 401, and `create: public` gives 400;
  - a `signed-in` route gives the guest 403;
  - the listing names `*anyone`.
- `TestVisitorLimit`: 30 guests from one address get in; the 31st gets 429.
- `TestVisitorClaim`:
  - a guest with an `interact` link writes a private draft;
  - after signing in over it, `me.claim` = `{docs: 1, grants: 1, places: 1}`;
  - keeping copies the draft to `data/users/<alex>/draft` (`{"x":1}`) and moves the grant (Alex `interact`, the guest none);
  - there is no second offer, a second claim gives 404, and Alex then opens at `interact`.
- `TestSweepVisitors`: after `VisitorIdle + 1h`, the old visitor and its grant and private doc are gone, and a fresh one stays.
- Mutation check: capping visitors at owner instead of interact fails `TestVisitors` (`a guest: … level:admin`).
- Browser: the guest flow described above.

### What didn't work
- `TestVisitorClaim` reported "offered twice". The server was right: the test decoded the second `/_site/me` into the same struct, and `json.Unmarshal` leaves a field the reply omits (`claim`) as it was. The test now resets it.
- `pkg/rt/views.go` cannot use `store.IsVisitor`: `rt` does not import `store`. It uses the `vis_` prefix, with a comment.
- Lint: `predeclared` on a test variable named `real`, and gofmt on the `const` block in `live.go`.
- My first CLI call passed `--server` through a zsh variable (`$X`), which zsh does not split, so it arrived as one argument (`unknown flag: --server http://…`).

### What I learned
- `json.Unmarshal` into a reused struct is a trap for "this field is gone now" assertions.
- With SameSite=Strict, the visitor cookie set on the shell's first same-origin `fetch` is the one used for everything after. The shell must refresh its own "who am I" after that first open, because `/_site/me` ran before the cookie existed.

### What was tricky to build
- **One person, two principals, one cookie.** Signing in over a guest replaces the cookie. The visitor has to be remembered on the new session (`from_visitor`), not looked up from the old cookie later, and the old visitor session revoked so it cannot be reused.
- **The claim and open views.** Copied documents go through `RTWrite` and `rtPublish`, so the person's open views see them arrive. Moved grants go through `reviewViews` for each target, so the person's views reopen at the new level.

### What warrants a second pair of eyes
- **`TouchVisitor` on every site request of a visitor** is one write each. That is fine at this scale, and could be throttled later.
- **`clientAddress` behind the cluster's proxy** needs `TrustProxyHeaders` on. Otherwise every visitor shares the proxy's address, and the 30-per-hour limit applies to the whole site.
- **`siteClaim` caps at 2000 documents** per claim, and copies them one write each.

### What should be done in the future
- Phase 5: the Workshop Access panel, an "Open live" link, owners sharing from the shell, and the help pages (`live-sites`, runtime).
- Check `TrustProxyHeaders` in the cluster config before publishing a public route.

### Code review instructions
- Read in this order:
  1. `newVisitor`, `siteResolve`, `openSiteView`, `siteMe`, `claimable`, `siteClaim` and `siteCallback` in `pkg/server/live.go`;
  2. `pkg/store/visitors.go`;
  3. the visitor branches in `access.go` and `rt.go`.
- Validate:
  1. `GOWORK=off go test ./pkg/server -run TestVisitor -count=1`
  2. Locally: `slop route set /blocks/:db blocks --bind 'target={db}' --live --access public --create signed-in`, `slop access grant <id> '*anyone' interact`, then open the URL in a private window.

### Technical details
- What a principal gets:

  | | visitor | member | admin |
  |---|---|---|---|
  | subjects | id, `*anyone` | id, `*signed-in`, `*anyone` | same |
  | level cap | interact | admin (owner of what they create) | owner |
  | assets, comments | no | interact+ / yes | yes |
  | sample, publish, slop | no | no | yes |
  | create instances | no | by policy, 50/day | by policy |

## Step 7: Phase 5, the Access panel, sharing from the site, and help

Phase 5 makes access visible and manageable without the CLI.

**In the Workshop**, app data and apps get an **Access** tab on Watch. It
shows:
- the live URLs;
- the owner;
- every grant, with a level select and Remove;
- a form to grant to a person, everyone signed in, or anyone;
- share links (make one, copy it, revoke it);
- who has the target open now.

**Open live** opens the first live URL. A live instance (which has no versions)
now shows its Access panel instead of "has no versions yet".

**On the site**, the shell shows a **Share** button to the target's owner and
to admins. The dialog sets "Everyone signed in" and "Anyone, guests too" to
No / Can view / Can edit, lists people and links with Remove and Revoke, and
makes a 30-day link with a Copy button (decision 5).

**Help:** `slop help live-sites` exists (the route CLI already pointed to
it), `runtime.md` points to it, and `slop db users member` sets the new role
from the server.

### Prompt Context
**User prompt (verbatim):** see Step 3.
**Assistant interpretation:** Phase 5 of the guide: the Workshop Access panel and Open live link, owners sharing from the site, and the help pages.
**Inferred user intent:** The user and Ramon can see and change who has access to a workspace without the terminal. An owner (also a member who created an instance) can share it themselves.
**Commit (code):** 76291b1 — "SLOP-011 phase 5: Access panel, Open live, sharing from the site, help"

### What I did
- **Workshop:**
  - `web/workshop/src/components/organisms/Access.tsx`: `AccessPane`, `OpenLive`, `liveApp`, and an `Item` row (name and controls on one line, a dim detail below), styled by `.acc-item` in `workshop.css`.
  - `slopApi.ts`: `access` (tag `Access`), `putGrant`, `removeGrant`, `createLink` and `revokeLink`.
  - `events.ts`: `access.changed` invalidates `Access` and `Audit` and writes a console line.
  - `WatchScreen.tsx`: the Access tab when `liveApp(a, v.manifest)`; Open live in the data toolbar; and an Access-only layout for live data without versions.
- **Site** (`pkg/server/siteaccess.go`): `POST /_site/access {path}`, `/_site/grants {path, subject, level}`, `/_site/links {path, level, days}` and `/_site/links/{id}/revoke {path}`, all behind `shellOnly` and `managed` (route → target → principal → `mayManage`: owner level, or admin role; never a visitor).
  - Owners give `view` or `interact`, only to `*signed-in` or `*anyone`; `level: ""` removes any subject's grant.
  - The link URL is this route's own URL plus `?k=`.
- **Shell:**
  - a `#share` button in the bar, shown when `view.level === "owner"` or `/_site/me` says admin;
  - `share()` builds the dialog from `/_site/access` and re-renders after each change;
  - levels read "Can view" / "Can edit" everywhere in it.
- **CLI:** `slop db users member`.
- **Help:** `pkg/doc/topics/live-sites.md` and a "Live on a site" section in `runtime.md`.
- **Test:** `TestOwnerShares`.

### Why
- **Owners give at most interact, to groups or by link.** Naming one person needs a people picker, which would show the member list to members. Links cover "share with Ramon" without that. Admin and owner grants change who manages the target, so they stay with admins.
- **`POST` for reading access on the site.** Every `/_site/` call that touches a target goes through `shellOnly` (Origin, `Sec-Fetch-Site`, JSON). A `GET` would skip the Origin check, and the answer names people.
- **Access-only view for instances.** An instance created on the site has no versions (its content is its database), and the watch screen used to stop at "has no versions yet", which hid the one thing to manage.

### What worked
- `GOWORK=off go test ./...`, Postgres, `make lint` (`0 issues.`) and `tsc` pass.
- `TestOwnerShares`:
  - a member creates an instance;
  - another member gets 403 on its access and on opening it;
  - the owner shares `*signed-in view`, and the other member opens at `view`;
  - `admin` level and a one-person subject give 400;
  - the owner makes an `interact` link (`http://site.test/board/i-…?k=…`), and the other member redeems it at `interact`;
  - the access listing shows two grants and one link;
  - revoking the link and unsharing `*signed-in` gives the other member 403.
- Browser (Playwright, local server):
  - as the owner on `/blocks/i-tmtocfaazmgvi6ip`, Share showed the two group selects, "ramon (by link) · Can edit · Remove", the links, and a new link with Copy;
  - in the Workshop, `/watch/i-tmtocfaazmgvi6ip` showed the Access layout (screenshots `share.png` and `access.png` in the scratchpad), with one Open live button.
- `slop help live-sites` renders, and `slop db users --help` lists `member`.

### What didn't work
- The Workshop check first failed with `waiting for locator('text=Access')`. The instance had no versions, and `WatchScreen` returned "has no versions yet" before rendering tabs. That is the Access-only layout above.
- The first Access pane wrapped badly in the narrow side tile (selects and buttons on separate lines, details squeezed). It now uses `Item` rows.
- My first help draft named `slop db users set-role` and `slop db users ls`, which do not exist (the command is `list`, and no CLI set the member role), then `--email`, which is not a flag (`--user-id` is). I added `member` and corrected the text against `slop db users --help`.

### What I learned
- An instance is data without versions. Any Workshop screen that assumes "data has a version" hides instances. The Artifacts list and Watch were the two places that mattered here.

### What was tricky to build
- **Who sees Share.** The view's level is in the open response, the role in `/_site/me`. Both arrive asynchronously, and `me()` runs first, so `open()` can decide from both.

### What warrants a second pair of eyes
- **Owners can remove any grant** (`level: ""` for any subject), including one an admin gave. That matches "owner manages access", but an admin's explicit grant can be undone by the owner.
- **`siteAccess` loads all users for names.** That is fine at this size.

### What should be done in the future
- PR for `task/live-sites` (the user merges), then deploy and publish Blocks on `site.slop.yolo.scapegoat.dev`, after:
  1. checking `TrustProxyHeaders` in the cluster config (the visitor limit is per address);
  2. telling the user the D8 trade-off for releases on that host.

### Code review instructions
- Read `pkg/server/siteaccess.go`, then `share()` in `shell.js`, then `Access.tsx` and the `WatchScreen.tsx` hunk.
- Validate:
  1. `GOWORK=off go test ./pkg/server -run TestOwnerShares -count=1`
  2. Locally, as the owner of an instance on a live route, click Share; in the Workshop, open the instance on Watch.

### Technical details
- The decisions from guide section 12.2, as adopted (task `e6xd`):

  | # | Question | Decision | Where |
  |---|---|---|---|
  | 1 | who creates instances | signed-in members and admins (`--create signed-in`); guests never | phase 3 and 4 |
  | 2 | members and `sample` | no, admins only | phase 2 |
  | 3 | URL shape | `/blocks/:db` | phase 3 |
  | 4 | new OIDC users | stay pending; admins let them in as member or admin | phase 2 |
  | 5 | owners share from the site | yes: the Share dialog, view or edit, groups and links | phase 5 |
  | 6 | guest data on sign-in | offered, kept only on yes | phase 4 |

## Step 8: PR #8 review, reopening on access changes and binding sign-in to the browser

Codex reviewed PR #8 and raised two findings. Both were real, and both are fixed in
7d2e8b8.

1. **A level change killed the open app.** `reviewViews` closed a changed view with `revoked`. The runtime treats that as terminal: no more RPCs or streams until a manual reload. My Step 4 note assumed "the shell renews", which was wrong. Now a change that keeps access sends a new `access` event. The runtime posts `reopen` to its shell, and the site shell and the Workshop's `/run` open a new view in a fresh frame. Losing access still sends `revoked`.
2. **A guest could be lost on sign-in.** When the sign-in returns cross-site, the browser withholds the site's `SameSite=Strict` cookie at `/_site/callback`, so the guest was not found and the claim was never offered. Now `/_site/login` sets a `SameSite=Lax` state cookie (`__Host-` in production) holding a random state and the guest id, and passes the state through `/auth/handoff`. The handoff row stores it (migration 012), and the callback consumes a code only with the matching cookie. This also closes login CSRF on the callback: a code made in one browser does not sign in another.

### Prompt Context
**User prompt (verbatim):** "addrses code review comments, merge, deploy"
**Assistant interpretation:** Fix the review findings on PR #8 and reply on the threads. Then merge PR #8, wait for the image, and merge the GitOps PR to deploy (explicitly asked this time).
**Inferred user intent:** Ship SLOP-011 to the cluster.
**Commit (code):** 7d2e8b8 — "SLOP-011: PR #8 review: reopen on access changes, bind sign-in to the browser"

### What I did
- `web/runtime/src/transport.ts`: a `case "access"` that stops the stream, posts `reopen`, and falls back to `location.reload()`. Rebuilt `pkg/render/assets/claude.js` with `node build.mjs`.
- `pkg/server/access.go`, `reviewViews`: same level → nothing; none → `Close(v, true)`; otherwise `Send({type: "access", level})` then `Close(v, false)`.
- `shell.js` handles `reopen` with `open(false)`. `AppScreen.tsx` handles `reopen` with a new view and a new frame.
- `pkg/server/live.go`:
  - `siteStateCookie` and `setSiteState`;
  - `siteLogin` mints the state and records the guest;
  - `handoff` requires a 32-character `state` ("start signing in from the site");
  - `siteCallback` reads and clears the state cookie, passes the state to `ConsumeHandoff`, and takes `from` from the cookie's guest (or from the session cookie when it is present).
- `pkg/store/sitesessions.go`: `SaveHandoff(…, state)`. `ConsumeHandoff(…, state)` matches `state=? AND state<>''`, so a wrong state does not consume the code.
- Tests:
  - `siteBrowser` tracks the state cookie and can withhold the session cookie (`strict`), as a cross-site navigation does;
  - `signInOn` runs the real flow through `/_site/login`;
  - `TestHandoffCodes` covers: no state, another state, a foreign return, reuse, and another host;
  - `TestVisitorClaim` signs in cross-site;
  - `TestGrantsAndMembers` expects `access` with the new level on changes, and `revoked` only when no access is left.

### Why
- **A new event instead of making `revoked` recoverable.** `revoked` means "stop" to every runtime already deployed and to claude.ai-style pages. A distinct event keeps that meaning and lets the shell decide how to reopen.
- **A fresh frame, not just a new secret.** Capabilities can change with the level (`assets` at interact). A page's namespaces are memoized at `use()`, so a new document is the honest way to show new capabilities.
- **A state cookie, not a longer-lived session cookie.** Lax only matters for top-level GETs, and the state cookie unlocks nothing but one callback with a matching code made within the last minute.

### What worked
- `GOWORK=off go test ./...`, Postgres, `make lint` (`0 issues.`), `tsc` for the Workshop and the runtime, and the runtime's tests (3 pass).
- Mutation check: ignoring the state cookie's guest fails `TestVisitorClaim` (`the offer: {Kind:user Claim:map[]}`).
- Browser (local server): Ramon had the instance open at `interact` (`can("data.write")` true). After `slop access grant … view`, the frame was a new document (my marker was gone), `can("data.write")` was false, and reads still worked.

### What didn't work
- The first browser run showed no change. `*anyone interact` still gave Ramon `interact`, so lowering his own grant changed nothing; that was correct. After revoking `*anyone`, the change showed.
- `user.can()` returns a promise, so my first probe printed `{}`.
- Lint: staticcheck wanted a tagged switch on `level`, and `exhaustive` then wanted every `rt.Level` case. An `if` chain satisfies both.
- The first `TestGrantsAndMembers` update expected `revoked` after removing Alex's grant, but `*signed-in` still let him view, so the event was `access` (level `view`). The test now reopens in between.

### What I learned
- A runtime event name is a contract with every page already deployed. Changing behavior means a new name, not a new meaning for an old one.
- `SameSite=Strict` on the site cookie and a sign-in that crosses sites means the callback must not depend on the session cookie for anything.

### What was tricky to build
- Keeping the code unconsumed on a wrong state. The `UPDATE … WHERE state=?` leaves the row alone, so an attacker's browser cannot burn a victim's code.

### What warrants a second pair of eyes
- The `access` fallback `location.reload()` after 5 s, for shells that do not handle `reopen` (older Workshop bundles in open tabs). The reload asks the shell to renew, which fails and reopens.
- `handoff` now refuses requests without `state`. Any bookmark or tool that went straight to `/auth/handoff` must start at `/_site/login` instead.

### What should be done in the future
- Merge PR #8, deploy, and then ask whether to publish Blocks on the cluster's site host (the D8 trade-off).

### Code review instructions
- Read `siteLogin`, `handoff` and `siteCallback` in `live.go`, then `reviewViews` in `access.go` and `case "access"` in `web/runtime/src/transport.ts`.
- Validate: `GOWORK=off go test ./pkg/server -run 'TestHandoffCodes|TestVisitorClaim|TestGrantsAndMembers' -count=1`.

### Technical details
- The sign-in:

  ```text
  shell Sign in → GET /_site/login?return=/x     Set-Cookie state=<32 hex>[.vis_…] (Lax, 10 min)
    → main /auth/handoff?host&return&state         SaveHandoff(code, user, host, ret, state)
    → site /_site/callback?code                    cookie state must equal the handoff's; from = cookie guest
  ```

## Step 9: Merged and deployed (milestone)

PR #8 is merged as `1128a04`, and its image runs on the cluster. The live
features are deployed, but no live route is set there yet. Publishing Blocks
on `site.slop.yolo.scapegoat.dev` waits for the user to accept the D8
trade-off.

**User prompt (verbatim):** "addrses code review comments, merge, deploy" (Step 8).

- **CI:** both review threads were answered. `release / publish` passed on `95e8bca`; PR #8 was merged with a merge commit, `1128a04`.
- **Image:** `publish-image` run 41152020573 succeeded, and `ghcr.io/go-go-golems/slop-computer:sha-1128a04` exists.
- **GitOps:** PR #404 (`wesen/2026-03-27--hetzner-k3s`, commit `f15b549`, a one-line image bump in `gitops/kustomize/slop/deployment.yaml`) passed `validate` in 18 s and was merged as `4bdba2f`. #403 (`sha-5b14471`) was closed as superseded, since `1128a04` includes #6.
- **Rollout:** the image changed after about 40 s, and `kubectl -n slop rollout status deploy/slop` reported "successfully rolled out". The logs show `Applied migration` for 008_live_sites, 009_grants, 010_links, 011_visitors and 012_handoff_state on Postgres, then "slop serving".
- **Smoke checks:**
  - `https://slop.yolo.scapegoat.dev/healthz` gives 200, and the site `/` gives 200 with `frame-ancestors` and no sandbox (no live route yet);
  - `/_site/me` gives `{"kind":"none"}`;
  - `/auth/handoff` without `state` gives 400;
  - the storefront probe: 94 covers, 22 shown, network idle in 3808 ms, 22 images and 433 KB with no non-200, and no console errors.
- **Correction to Step 4:** `siteHeaders` sends `Access-Control-Allow-Origin: *` on every site page, not only on hosts with a live route. Only the CSP `sandbox` depends on a live route. Those pages are public and no credentials flow, so this is harmless.
- **Next:** with the user's yes to the trade-off (or a separate host), set `/blocks/:db` live on the cluster (`--access signed-in --create signed-in`), and let Ramon in as admin or member.

## Step 10: Blocks live on site.slop broke the storefront's CSS; route undone, a separate host proposed

The user accepted the D8 trade-off, so I set `/blocks/:db` live on
`site.slop.yolo.scapegoat.dev`. The Blocks shell worked. The storefront,
however, rendered without its stylesheet: under the sandbox the page's
relative files no longer resolve. I undid the route after about 5 minutes,
which restored the site. I then proposed a separate site host for live apps
(GitOps PR #405, not merged).

The trade-off I described to the user (memory-only `localStorage`) was
incomplete. D8 also breaks every relative file of a static page whose file
lookup depends on `Referer`, and on this host that is most of them.

### Prompt Context

**User prompt (verbatim):** "yes"

**Assistant interpretation:** A yes to the question at the end of Step 9:
accept that site.slop's other pages become sandboxed, and set `/blocks/:db`
live there for signed-in people, who may also create workspaces.

**Inferred user intent:** Have Blocks usable on the public site for Ramon
and other signed-in people, without breaking what the site already serves.

### What I did

- Built the CLI from `33e6657` into the scratchpad (`slop-prod`). It talks to the main host with the stored login.
- **Mistake:** a one-liner meant to show the stored CLI login without its secret only masked top-level keys, so it printed the production API token into the session transcript. It is in no file or commit. The user should revoke that token in the Workshop.
- `slop artifacts list` shows `blocks` ("Claude Blocks", page, main 1).
- `slop route set '/blocks/:db' blocks --bind 'target={db}' --live --access signed-in --create signed-in` returned `→ blocks@main live on the blocks data named by :db for signed-in, created by signed-in`.
- Headers checked with curl:
  - `/blocks/new`: 200, the shell CSP (`frame-src https://*.sbx…`), `shell.js` and `shell.css`;
  - `/`, `/apps/blockout-studio` and `/r/nothing-here`: `sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads`;
  - `/_site/me`: `{"kind":"none"}`.
- Browser (`$S/probe/blocks-prod.cjs`): `/blocks/new` and `/blocks/ws-nope` show "There is nothing here yet. Sign in to create one." The one 404 in the console is the shell's open call, which is how it learns there is no instance.
- Browser (`$S/probe/site.cjs /`): 94 covers, no console errors. The screenshot, however, showed an **unstyled** page: default serif type, no grid.
- `curl $B/boutique.css?v=2` returned 404. With `-H "Referer: $B/"` it returned 200.
- `$S/probe/ref.cjs` showed the sandboxed page at `self.origin === "null"`, with `referer=null` on both `boutique.css` and `/_r/francois-catalog/3.js`.
- Ran `slop route undo '/blocks/:db'`, which reported `is now (none)`. Then:
  - the CSP on `/` is back to `frame-ancestors` only;
  - `ref.cjs` shows `referer="https://site.slop.yolo.scapegoat.dev/"`, `boutique.css` 200, and the origin back to the site's.
- Local experiment (`$S/reftest/srv.py`, `$S/probe/reftest.cjs`): a `sandbox allow-scripts` page with `Referrer-Policy` unset, `unsafe-url`, `no-referrer-when-downgrade` or `origin`. Chrome sent no `Referer` on its stylesheet request in every case.
- Proposed a separate site host. GitOps branch `slop/apps-host`, PR #405 (`wesen/2026-03-27--hetzner-k3s`):
  - a second `--site-host=apps.slop.yolo.scapegoat.dev`;
  - an ingress rule and a TLS host for it;
  - the name added to the `slop-tls` certificate.

  `getent hosts apps.slop.yolo.scapegoat.dev` already gives `91.98.46.169`, the node, through the `*.yolo` wildcard.
- Corrected `pkg/doc/topics/live-sites.md` § "The rest of the site": relative files break; give live apps their own host.

### Why

- I undid the route rather than fixing forward, because the public storefront and every release with relative assets were broken for anyone visiting.
- A separate host needs no code and matches the doc's existing advice for releases. It also keeps the D8 sandbox where it is meant to apply: only on a host whose other pages could otherwise use a visitor's session.

### What worked

- `slop route undo` restored the site in one step.
- Relative files on `site.slop` were back as soon as the route was gone. Cached HTML wasn't a factor, because the CSP is set per response from the route table.

### What didn't work

- The D8 assumption that static pages only lose persistent storage. In `serveSite` (`pkg/server/serve.go`), a page's relative files are found in two ways:
  - by resolving the file's own path to a route, which works for `/apps/:id`-style patterns;
  - otherwise through the `Referer` (`// relative links from /pricing to style.css arrive as /style.css; from /r/weft as /r/style.css`).

  A document with an opaque origin sends no `Referer`, so the second path fails. The storefront at `/` depends on it, as do releases at `/r/:page`.
- My earlier local verification ("the storefront under the sandbox", Step 7) checked covers and console errors, not styling. A missing stylesheet logs no console error, because the 404 arrives as an HTML page.
- `Referrer-Policy` can't restore the header (local experiment above).

### What I learned

- In Chrome, a CSP-sandboxed document without `allow-same-origin` sends no `Referer` at all, whatever the `Referrer-Policy`.
- My probes should measure styling too (for example, a computed style on `body`), not only console errors.

### What was tricky to build

- Nothing new was built. The tricky part was seeing the failure: the page loaded, 94 covers counted, no errors were logged, and only the screenshot showed it.

### What warrants a second pair of eyes

- `route set --live` on a host that also serves public static pages silently changes those pages. A guard is worth considering: refuse, or warn and require `--force`, when the host has public non-live routes.
- PR #405: ingress and certificate for the new name; the server loops over `SiteHosts` everywhere, and `site.slop` stays first.

### What should be done in the future

- Once the user approves the deploy and #405 is merged: `slop route set /blocks/:db blocks --host apps.slop.yolo.scapegoat.dev --bind 'target={db}' --live --access signed-in --create signed-in`, then a browser check of the shell, and of the storefront on `site.slop` (styled).
- Ramon needs the admin or member role. The user sets it in Admin ▸ People.
- Add a computed-style check to the site probes.
- Decide on the guard against mixing live and static routes on one host.

### Code review instructions

- `pkg/doc/topics/live-sites.md` § "The rest of the site".
- `pkg/server/serve.go` `serveSite`, the `path.Ext` branch: Referer-based file lookup.
- GitOps: `gitops/kustomize/slop/{deployment,ingress,certificate}.yaml` on `slop/apps-host`.

### Technical details

```text
route set  22:31  /blocks/:db → blocks@main live (signed-in, create signed-in)
route undo ~22:36 /blocks/:db is now (none)
sandboxed:  boutique.css?v=2  referer=null  → 404 (HTML)   self.origin = "null"
restored:   boutique.css?v=2  referer=https://site.slop.yolo.scapegoat.dev/ → 200
```

## Step 11: Blocks live on apps.slop.yolo.scapegoat.dev (milestone)

Blocks runs live on its own site host, and `site.slop` is unchanged:
styled, with no sandbox.

**User prompt (verbatim):** "yes" (to merging #405 and deploying). The
auto-mode classifier refused my `gh pr merge` as "Production Deploy", so the
user ran it: `gh pr merge 405 --repo wesen/2026-03-27--hetzner-k3s --merge`.

- **GitOps:** #405 merged as `db7f304`. Argo CD synced in about 220 s, and the deployment args gained `--site-host=apps.slop.yolo.scapegoat.dev`. `rollout status` reported "successfully rolled out".
- **TLS:** `slop-tls` is Ready, with SANs `*.sbx…`, `apps.slop…`, `site.slop…` and `slop.yolo…`, valid until 2027-01-29.
- **Route:** `slop route set '/blocks/:db' blocks --host apps.slop.yolo.scapegoat.dev --bind 'target={db}' --live --access signed-in --create signed-in` returned `→ blocks@main live on the blocks data named by :db for signed-in, created by signed-in`.
- **Headers:**
  - `apps/blocks/new`: 200 with the shell CSP;
  - `apps/`: 404 with the sandbox;
  - `site/`: 200, `frame-ancestors` only;
  - `site/blocks/new`: 404.
- **Browser** (`$S/probe/apps-prod.cjs`):
  - the storefront: origin `https://site.slop.yolo.scapegoat.dev`, body font `"ABC Areal", …`, stylesheets with 304, 14 and 1 rules, 94 covers. This is the computed-style check that Step 10 asked for.
  - `apps/blocks/new`: "There is nothing here yet. Sign in to create one."; no page errors.
- **Sign-in hop:**
  - `apps/_site/login?return=/blocks/new` gives 303 to `https://slop.yolo.scapegoat.dev/auth/handoff?host=apps.slop.yolo.scapegoat.dev&…` and sets `__Host-slop_site_state` (Lax, 600 s);
  - the main host answers that with 303 to `/auth/login?return=…`, accepting the new host.

  A full signed-in round trip needs the real login provider, so it was not run headless.
- **Next:** the user signs in at `https://apps.slop.yolo.scapegoat.dev/blocks/new` and creates a workspace. Ramon gets the admin or member role in Admin ▸ People.
