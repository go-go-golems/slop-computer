---
Title: Diary
Ticket: SLOP-001
Status: active
Topics:
    - backend
    - frontend
    - auth
    - architecture
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://Dockerfile
      Note: Step 19 image
    - Path: repo://cmd/slop/cmds/devseed.go
      Note: Step 14 seed
    - Path: repo://cmd/slop/cmds/push.go
      Note: Step 14 push/watch
    - Path: repo://cmd/slop/cmds/routes.go
      Note: Step 14 routes and comments wait
    - Path: repo://doc/production.md
      Note: Step 19 production doc
    - Path: repo://examples/tools/board/index.html
      Note: Step 18 release board
    - Path: repo://pkg/blobs/blobs.go
      Note: Step 19 blob GC
    - Path: repo://pkg/render/assets/tool.js
      Note: Step 17 tool client
    - Path: repo://pkg/server/safe.go
      Note: Step 16 safe mode
    - Path: repo://pkg/server/tools.go
      Note: Step 17 tools API
    - Path: repo://pkg/server/workshop.go
      Note: Step 15 workshop serving
    - Path: repo://web/workshop/src/screens/ToolScreen.tsx
      Note: Step 18 ToolScreen
    - Path: repo://web/workshop/src/screens/WatchScreen.tsx
      Note: Step 15 Watch screen
ExternalSources: []
Summary: 'Chronological implementation diary for SLOP-001: analysis, design revisions with the owner, and phase-by-phase implementation of slop.computer v1.'
LastUpdated: 2026-10-28T16:30:00-04:00
WhatFor: Tracing how the v1 design was derived and how each phase was implemented and validated.
WhenToUse: When resuming SLOP-001, reviewing a commit, or questioning a decision in the design doc.
---

# Diary

## Goal

Record, step by step, how slop.computer v1 is designed and built: francois's backend cut down to admins, a new artifact/version/route/comment kernel, local mode with SQLite and nicknames, tools, and the Workshop UI in React + RTK Query.

> Format note (2026-10-28, step 9): Steps 1–8 were first written in a free-form style. At the owner's request ("IT'S MANDATORY to follow the diary skill format at each point") they were rewritten into the diary skill's investigation format from the same facts. No evidence was added or removed.

## Step 1: Gather sources for the analysis

I started from an almost empty repository and needed the three inputs the owner named: the Directions brainstorm, the Workshop prototype and the francois backend. I read the Directions document in full, unpacked both zips into the session scratchpad, and copied the Directions doc and the Workshop prototype into the ticket so the guide could cite stable paths.

The Workshop zip turned out to be the same code as direction A in the workspace zip, so the workspace zip was only skimmed; the Desk, CC5, Shop Next and the transcripts were not read because the Desk is out of scope.

### Prompt Context
**User prompt (verbatim):** "Create a new docmgr ticket to implement a new version of slop-computer, by taking the backend of francois and killing all the membership stuff and just keeping the API and admin users parts (code is in ../francois, feel free to literally `cp` stuff over) And add the slop.computer workshop UI (for now, we will add the Desk later on), see @~/Downloads/slop.computer Directions.md  and @~/Downloads/slop.computer Workshop.zip  and @~/Downloads/slop-computer-workspace.zip  (Which has the desk and all entire workspace, so it might be a bit too much).

Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable.

Then give me an overview in your own words of what we are going to build, and stop so I can validate."
**Assistant interpretation:** Analysis and design only: create a docmgr ticket, write an intern-ready guide, upload it to reMarkable, summarise, then stop for validation.
**Inferred user intent:** Validate the shape of slop.computer v1 before any code is written.
**Commit (code):** none (analysis only)

### What I did
- Checked repository state: worktree on `task/slop-computer`, only `ttmp/` and `.ttmp.yaml`, commit `158845d`. Sibling `../francois` at `106776a`.
- Read `~/Downloads/slop.computer Directions.md` (revision 2) and copied it to `sources/slop-computer-directions.md`.
- Unzipped `slop.computer Workshop.zip` (8 files, 2,927 lines) and `slop-computer-workspace.zip` (59 MB) into separate scratchpad directories; copied the Workshop to `sources/workshop/`.
- Read `api.js` and `render.js` fully, `agent.js` partly, `app.js` structure plus the admin screen and event wiring, and `seed.js` data shapes.

### Why
- The fake API in `api.js` is effectively the contract the real server must satisfy, so it had to be read completely.

### What worked
- `diff -rq` showed the Workshop zip equals `projects/slop-computer-a/` except for `index.html`'s document skeleton.

### What didn't work
- A first `cat … ; echo =====; …` failed with `(eval):3: ===== not found` because a line began with `=====`; rerun with `echo XXXXX` worked.

### What I learned
- The Directions doc studied francois at `ca05239`; the local checkout is at `106776a`. Differences were not reviewed.

### What was tricky to build
- N/A (reading only).

### What warrants a second pair of eyes
- Whether skipping the Desk/CC5/Shop Next sources missed something the core kernel needs.

### What should be done in the future
- N/A

### Code review instructions
- Compare `sources/workshop/` with the zip if provenance matters.

### Technical details
- Workshop files: `index.html` 14, `style.css` 285, `boutique-css.js` 359, `seed.js` 630, `api.js` 230, `render.js` 264, `agent.js` 125, `app.js` 1020 lines.

## Step 2: Map the francois backend

I surveyed francois's catalog server to decide what to keep: auth, sessions, tokens, device login, admin users and audit, blobs. I read the request guard, OIDC login/callback/logout, the migrations that define users, tokens and device authorizations, `UpsertIdentity`, and the hosted runtime's HTML injection.

The kept code turned out small and well isolated (~2.5k lines), while the dropped code (billing, storefront, instances, React portal) is most of the 20.7k lines.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Identify francois's API/admin-user parts precisely enough to cite them.
**Inferred user intent:** Copy only what slop.computer needs.
**Commit (code):** none

### What I did
- `find pkg -name '*.go' ! -name '*_test.go' | xargs wc -l | sort -n` (20,722 lines in `pkg/catalog`).
- Read `pkg/catalog/routes.go:21-135`, `auth.go` (guard 102-162, login/callback/logout 186-291), `store/migrations/{001,004,008,019}.sql`, `store/users.go:41-73`, `hosted/routes.go:166-222`, grep of `admin.go`, `tokens.go`, `device.go` route registrations.

### Why
- Every claim in the guide needed a file reference an intern can open.

### What worked
- `guard(level, scope, h)` already separates cookie sessions from bearer tokens and applies CSRF only to sessions; only levels and scope names need to change.

### What didn't work
- No failures observed.

### What I learned
- The role default lives in the migration (`subscriber`), not in Go.
- `releases.Blobs` is self-contained and reusable.
- The catalog store is pgx/Postgres-specific (arrays, `bytea`, advisory locks).

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Whether the device-login flow should keep its rate limiter in v1.

### What should be done in the future
- N/A

### Code review instructions
- Start at `../francois/pkg/catalog/auth.go:102`.

### Technical details
- Admin routes registered at `admin.go:23-49`; device routes at `device.go:29-33`; token routes at `tokens.go:17-25`.

## Step 3: Write the first design and deliver it

I wrote the intern guide (`design-doc/01-…`) with orientation, current state, gaps, schema, API reference, pseudocode, decision records D1–D7, phases, tests and open questions. Then I ran `docmgr doctor` and uploaded the guide plus diary to reMarkable, and gave the owner an overview.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Produce and deliver the guide, then stop.
**Inferred user intent:** A reviewable plan.
**Commit (code):** none

### What I did
- `docmgr ticket create-ticket --ticket SLOP-001 …`, `docmgr doc add` for the design doc and diary, added vocabulary topics `frontend`, `auth`, `architecture`.
- Wrote the guide; related files; `docmgr doctor --ticket SLOP-001 --stale-after 30`.
- `remarquee upload bundle … --name "SLOP-001 slop computer v1 intern guide" --remote-dir "/ai/2026/10/28/SLOP-001"`.

### Why
- Decision records make the choices (separate module, mirror store, embedded Workshop, sandbox origins, Postgres, two-step push, roles/scopes) reviewable.

### What worked
- Upload: `OK: uploaded SLOP-001 slop computer v1 intern guide.pdf -> /ai/2026/10/28/SLOP-001`.
- Doctor passed after fixing related-file paths.

### What didn't work
- `docmgr doctor` reported 15 `missing_related_file` warnings: RelatedFiles paths like `../francois/pkg/catalog/auth.go` and `sources/workshop/api.js` were resolved relative to the repository root. Fixed by rewriting them to absolute paths.

### What I learned
- docmgr resolves relative RelatedFiles against the repo root, not the document.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- Always pass absolute paths to `docmgr doc relate`.

### Code review instructions
- Read sections 1–3 of the guide first.

### Technical details
- Upload proves cloud delivery, not device sync.

## Step 4: Owner review — React, live deploy question

The owner accepted a separate copy and Postgres, chose React + RTK Query with atomic design, and asked for a Vite proxy and DB-based deployment so things can be worked on live. I rewrote §6.8 for React/RTKQ, added §6.11 describing the Workshop as a live "shell" artifact with guard rails, and uploaded a v2 PDF.

### Prompt Context
**User prompt (verbatim):** "1. yes, separate independent copy
2. react + rtkq, please. atoms molecules organisms. should be fairly simple. 
3. make it possible with vite proxy as well for quick iteration. use db for artifact deploy, so we can work on it live.
4. ok.

what does 3. switching to live work entail? The main goal for this is being able to iterate on pages live quickly without having to work on them through the normal deploy channel..."
**Assistant interpretation:** Update decisions; explain what serving the Workshop from the DB would require.
**Inferred user intent:** Fast live iteration without deploys.
**Commit (code):** none

### What I did
- Replaced §6.8 (component tree, `slopApi.ts`, event → tag invalidation), added §6.11 (shells, Try it/Promote, recovery), updated D1–D3, D5, phases, open questions, added §12.
- Uploaded `SLOP-001 slop computer v1 intern guide v2`.

### Why
- RTK Query's tag invalidation maps directly onto the server's event stream.

### What worked
- Upload OK; doctor passed.

### What didn't work
- No failures observed.

### What I learned
- "Use db for artifact deploy" was ambiguous between "the Workshop" and "artifacts" (clarified in Step 5).

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- §6.8 of the guide.

### Technical details
- N/A

## Step 5: Correction — Workshop embedded, only artifacts in the DB

The owner clarified that the Workshop should not go through the database. I reverted D3 to an embedded Workshop with a Vite proxy, removed the shell concept (`trust` column, overrides) and rewrote §6.11 as live iteration on artifacts (`slop push --watch`, `--no-main`).

### Prompt Context
**User prompt (verbatim):** "no the workshop should not be through the db actually. only the artifacts"
**Assistant interpretation:** Embed the Workshop; keep artifacts as the only DB-deployed content.
**Inferred user intent:** The core tool must stay stable.
**Commit (code):** none

### What I did
- Python section replacements in the guide; removed every `trust`/shell reference; doctor.

### Why
- Keeps pushed code off the main origin.

### What worked
- Doctor passed.

### What didn't work
- No failures observed.

### What I learned
- N/A

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- D3 and §6.11.

### Technical details
- N/A

## Step 6: Local mode and SQLite

The owner asked for a local mode without authentication but with nicknames, and SQLite instead of Postgres if possible. I confirmed feasibility from francois's own local store and designed one `database/sql` store for both databases plus a nickname identity provider.

### Prompt Context
**User prompt (verbatim):** "also make it possible to launch a local version of slop without needing authentication, but still being able to provide a nickname / identity (so we can test collaborative stuff locally too), and without requiring postgresql and instead using sqlite, if that's possible."
**Assistant interpretation:** Add `slop serve --local` with nickname sign-in and SQLite.
**Inferred user intent:** Test collaboration locally with zero setup.
**Commit (code):** none

### What I did
- Checked `../francois/pkg/store/store.go:29-48` (modernc sqlite, WAL, busy_timeout, one connection).
- Counted pgx-specific call sites: `grep -c` over users/sessions/tokens/device/store.go → 29+12+9+13+13.
- Added §6.2.1 (portability rules), §6.12 (local mode), revised D5, added D8, updated phases and tests.

### Why
- Everything after sign-in stays production code, so local tests exercise it.

### What worked
- Doctor passed.

### What didn't work
- No failures observed.

### What I learned
- The francois catalog store must be ported, not copied verbatim.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Local-mode guard rails (loopback-only, no override).

### What should be done in the future
- N/A

### Code review instructions
- §6.2.1, §6.12.

### Technical details
- `--local` defaults: sqlite `./var/slop.db`, blobs `./var/blobs`, listen `127.0.0.1:8080`, site `site.localhost:8080`, sandbox `sandbox.localhost:8080`.

## Step 7: Explaining shells with an example

The owner asked what the dropped shell would have done. I answered with a release-board example and the attack it enables (minting admin tokens with the viewer's session). No document changes were made in this step.

### Prompt Context
**User prompt (verbatim):** "what would the shell have done in : - I dropped the \"shell\" idea completely: no trust column, no running pushed code on slop.computer itself, no \"Try it\" or \"Promote\" steps. That also removes the security problem from my last answer, because pushed code can never act with your login.

?

show me an example."
**Assistant interpretation:** Explain the shell concept concretely.
**Inferred user intent:** Decide whether the capability matters.
**Commit (code):** none

### What I did
- Wrote the example in chat.

### Why
- N/A

### What worked
- N/A

### What didn't work
- No failures observed.

### What I learned
- The owner wants the capability (Step 8).

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- N/A

### Technical details
- N/A

## Step 8: Tools with limited permissions

The owner wants Ramon's release board, with the core Workshop still embedded. I designed tools: pushed pages with a permission manifest, enabled by an admin in the browser, running on the sandbox origin inside a Workshop iframe with one-hour permission-limited grants. I then listed the restrictions for the owner.

### Prompt Context
**User prompt (verbatim):** "ok i do want that scenario where ramon makes a publish release board or so, it's just the core workshop should be in the app embedded to avoid corruption."
Follow-up (verbatim): "what's the restrictions you are adding?"
**Assistant interpretation:** Design pushed tool screens without making the core replaceable; explain the restrictions.
**Inferred user intent:** Extensibility without corruption risk.
**Commit (code):** none

### What I did
- Added §6.13, D9, concept row, Phase 6 (tools), hardening → Phase 7, MCP → Phase 8, test bullets, open question 10.

### Why
- (b) in D9 bounds damage to approved, logged, undoable actions enforced by the server.

### What worked
- Doctor passed.

### What didn't work
- No failures observed.

### What I learned
- N/A

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Whether the restrictions are too strict for two people (listed as relaxable in the chat answer).

### What should be done in the future
- N/A

### Code review instructions
- §6.13, D9.

### Technical details
- Grants: `slg_` prefix, 1 h, permissions ⊆ manifest; never users/tokens/audit/tools.

## Step 9: Phase 0 — module skeleton, workspace, diary format

Implementation starts here. I uploaded the v3 guide, rewrote steps 1–8 of this diary into the skill's investigation format at the owner's explicit request, and created the Go module with the `slop` root command, Glazed field helpers copied from francois, a Makefile, lint config and AGENT.md. The module builds both inside the parent `go.work` and with `GOWORK=off`.

### Prompt Context
**User prompt (verbatim):** "yes. Then implemen task by task, and commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)

IT'S MANDATORY to follow the diary skill format at each point."
Follow-up during the work (verbatim): "make sure to write a diary at frequent intervals and MANDATORY: follow diary skill format"
**Assistant interpretation:** Upload the v3 guide, then implement the phases in order, committing at sensible boundaries, with a diary entry in the skill's investigation format for every step.
**Inferred user intent:** A working slop v1 with a reviewable trail of how it was built.
**Commit (code):** ca57479 — "SLOP-001: ticket docs and slop module skeleton"

### What I did
- `remarquee upload bundle … --name "SLOP-001 slop computer v1 intern guide v3"` → `OK: uploaded SLOP-001 slop computer v1 intern guide v3.pdf -> /ai/2026/10/28/SLOP-001`.
- Rewrote diary steps 1–8 in investigation format (format note at the top).
- Created `go.mod` (`github.com/go-go-golems/slop-computer`, go 1.26.3, toolchain go1.26.10 — same as francois), `cmd/slop/main.go` (cobra root + glazed logging + help, as `../francois/cmd/francois/main.go`), `cmd/slop/cmds/fields.go` (the `in` accessor and `flag/list/boolean/integer` helpers from `../francois/cmd/francois/cmds/api.go:40-61,222-240`), `Makefile`, `.golangci.yml` and `.golangci-lint-version` (copied), `.gitignore`, `AGENT.md` (francois's, retargeted).
- `cd .. && go work use ./slop-computer`.

### Why
- Same toolchain as francois so the shared `go.work` keeps one Go version.
- Glazed helpers copied rather than re-invented, per AGENT.md ("Use glazed command framework").

### What worked
- `GOWORK=off go build ./... && GOWORK=off go run ./cmd/slop --help` printed the root help.
- `go work use` then `go build ./...` → `WORK-OK` (the go command switched to go1.26.10 automatically: `go: francois/go.mod requires go >= 1.26.3; switching to go1.26.10`).

### What didn't work
- The editor's gopls reports `packages.Load error: … go: go.work requires go >= 1.26.3 (running go 1.25.5)`. This is the editor running the system Go 1.25.5 without toolchain switching; the `go` command itself builds. Not fixed (francois has the same requirement).
- `go mod tidy` resolved glazed to `v1.4.4` rather than francois's pseudo-version `v1.4.4-0.20260823170018-a7fdfda5e3c6`; builds fine, noted only.

### What I learned
- The parent `go.work` had `go 1.25` although francois requires 1.26.3; `go work use` bumped it to `go 1.26.3`.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- `../go.work` (outside this repository) was modified by `go work use`.

### What should be done in the future
- Point gopls at go1.26 (`GOTOOLCHAIN=auto` in the editor environment) to get diagnostics back.

### Code review instructions
- `cmd/slop/main.go`, `cmd/slop/cmds/fields.go`, `Makefile`.
- `go build ./... && go run ./cmd/slop --help`.

### Technical details
- `Register(root)` is still empty at this commit; commands arrive in Step 11.

## Step 10: Phase 1a — store ported to database/sql for Postgres and SQLite

I ported francois's catalog store files (users, sessions, tokens, device logins, audit, migration runner) from pgx to `database/sql`, so one implementation runs on Postgres (`pgx/v5/stdlib`) and SQLite (`modernc.org/sqlite`). Migrations live in `migrations/postgres` and `migrations/sqlite`. A `storetest` package gives every test a fresh database: SQLite by default, Postgres when `TEST_DATABASE_URL` is set. The auth store tests pass on both.

The one real bug was time handling in SQLite: times written with a local offset compared wrongly against UTC values as text. I fixed it centrally by converting every time argument to UTC in the store's query wrapper.

### Prompt Context
**User prompt (verbatim):** see Step 9
**Assistant interpretation:** Phase 1, first part: the storage layer for auth.
**Inferred user intent:** Local mode on SQLite and production on Postgres with one code base (D5).
**Commit (code):** pending (committed with the rest of Phase 1)

### What I did
- `pkg/store/store.go`: `Open(url)` picks the dialect from `sqlite:` / `postgres://`; `db` wrapper with `exec/query/row`, `rebind` (`?` → `$n` for Postgres), `forUpdate` (Postgres only), `InTx`, `scanAll`, `Migrate`/`Pending` with checksum ledger (Postgres advisory lock kept), `StringList` and `JSON` column types, `isUnique` for both drivers.
- `pkg/store/migrations/{postgres,sqlite}/001_auth.sql`: `users` (role `admin|pending|disabled`, default `pending`, plus `last_seen_at`), `login_flows`, `sessions`, `api_tokens` (scopes as JSON text), `device_authorizations`, `audit` (adds `via`).
- `users.go` (`UpsertIdentity(id, role)`, `SetUserRole` revoking sessions + tokens on demotion, `Users`, `UsersByIssuer`, `touchUser`), `sessions.go`, `tokens.go` (prefix `slp_`, scopes `read|write|admin`, write implies read), `device.go`, `audit.go` (`WithAuditToken`, `WithAuditVia`).
- `pkg/store/storetest/storetest.go`; `pkg/store/auth_test.go` (users/sessions/tokens/demotion/audit, device login issue-once, migration-name parity).
- Started a throwaway Postgres for tests: `docker run -d --name slop-test-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55432:5432 postgres:17-alpine`.

### Why
- D5 (accepted): Postgres in production, SQLite for local mode and tests, one store.
- `UpsertIdentity` takes the initial role so local mode can create admins (`--local-role`) while OIDC sign-ins start pending.
- francois's advisory lock and email-collision check in `UpsertIdentity` were dropped (no email sign-in here).

### What worked
- `go test -count=1 ./pkg/store/...` → `ok` (SQLite).
- `TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable' go test -count=1 ./pkg/store/...` → `ok`.

### What didn't work
- First SQLite run failed while Postgres passed:
  ```
  --- FAIL: TestUsersSessionsTokens (0.01s)
      auth_test.go:45: resolve token {ID: UserID: Name: Scopes:[] CreatedAt:0001-01-01 00:00:00 +0000 UTC …} not found
  ```
  Cause: the test passed `time.Now().Add(time.Hour)` (offset `-04:00`) as `expires_at`; `ResolveToken` compares `expires_at > ?` with a UTC `now`. SQLite compares the two as text, so `…17:xx-04:00` sorted before `…20:xx+00:00` and the token looked expired. Fix: `utcArgs` in `db.exec/query/row` converts every `time.Time` / `*time.Time` argument to UTC. Both databases pass after the fix.

### What I learned
- modernc's default time format is `time.Time.String()` (with zone name and monotonic clock); `_time_format=sqlite` writes `2006-01-02 15:04:05.999999999-07:00`, and parsing back to `time.Time` happens only for columns declared `DATE`, `DATETIME` or `TIMESTAMP` (`modernc.org/sqlite@v1.54.0/rows.go:152-196`). Hence `TIMESTAMP` in the SQLite DDL.
- With UTC everywhere, text comparison of that format is chronological (fraction digits compare correctly; `+` sorts before `.` and digits).

### What was tricky to build
- SQLite runs with one connection (`SetMaxOpenConns(1)`). Inside `InTx`, calling back into `s.DB` (instead of the transaction's `db`) would deadlock waiting for the only connection. `getUser(ctx, tx, id)` exists for that reason, and `InTx`'s comment says so.

### What warrants a second pair of eyes
- `rebind` assumes no literal `?` in SQL text.
- `Pending` treats a missing `schema_migrations` table as "all pending" by ignoring the query error.

### What should be done in the future
- A schema-parity test that compares actual columns (information_schema vs pragma_table_info), not just migration names.

### Code review instructions
- Start at `pkg/store/store.go` (`Open`, `db`, `utcArgs`, `Migrate`), then `users.go`, `device.go`.
- `go test ./pkg/store/...` and the same with `TEST_DATABASE_URL` pointing at a Postgres.

### Technical details
- SQLite DSN: `file:<path>?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate&_time_format=sqlite&_texttotime=1`.

## Step 11: Phase 1b — server, local mode and auth CLI

I built the HTTP server on top of the ported store: francois's request guard reduced to three levels (public, session, admin) and three token scopes (read, write, admin), OIDC sign-in copied as is, nickname sign-in for local mode, tokens, device login with a server-rendered approval page, and the users/audit API. The CLI gained `serve --local`, `migrate`, `db users list|promote|disable|pending` and francois's `auth login|status|token|logout` with a new `--as <nickname>` for local servers.

An end-to-end run in tmux and Go tests (guard matrix, local tokens, device approval through the form, local-mode guard rails) pass on SQLite and Postgres.

### Prompt Context
**User prompt (verbatim):** see Step 9
**Assistant interpretation:** Finish Phase 1 (auth carve-out + local mode) and commit.
**Inferred user intent:** Sign in locally with nicknames, give agents distinct tokens, and keep production auth intact.
**Commit (code):** 2c6ff88 — "SLOP-001 phase 1: auth carve-out from francois, local mode, SQLite"

### What I did
- `pkg/httpx`, `pkg/credentials` (env `SLOP_TOKEN`, `SLOP_SERVER`, `SLOP_CONFIG_DIR`, dir `~/.config/slop`), `pkg/client/{client,errors}.go` copied from francois with a `// Copied from …@106776a` header; francois's Studio/Admin/Account services and multipart upload removed; `pkg/client/auth.go` new (Me, Config, DeviceAuthorize, DevicePoll, LocalToken, RevokeSelf).
- `pkg/identity/oidc.go` copied; `pkg/identity/local.go` new (`LocalIdentity`, `IsLoopbackHost`, `CheckLocalSafe`).
- `pkg/server`: `server.go` (Config, Validate, origins incl. extra/dev origins, Handler, routes), `auth.go` (Principal, `guard`, scopes, OIDC login/callback/logout, `signIn`), `local.go` (`POST /auth/local`, `POST /api/local/token`, login page), `tokens.go` (`/api/me`, `/api/config`, token CRUD, `tokenGrant`), `device.go` (JSON endpoints + `GET/POST /device` form), `users.go` (`/api/users`, PATCH role with self-lockout, revoke-sessions, `/api/audit`), `limiter.go` (francois's), `pages.go` + `templates/*.tmpl` + `static/pages.css`.
- `cmd/slop/cmds`: `serve.go`, `db.go`, `auth.go` (ported), `common.go`; `Register` wires them.
- Tests: `pkg/server/harness_test.go` (httptest server in local mode, cookie-jar "browsers", store-minted tokens), `pkg/server/auth_test.go`.

### Why
- Kept the guard's shape so francois reviewers recognise it; levels collapse because roles are only admin/pending/disabled (D7).
- Separate `Config.OIDC` and `Config.Local` fields instead of the `identity.Provider` interface sketched in §6.12: only the login page and the callback differ, and an interface would have wrapped two methods for one caller. Recorded as a deviation from the guide.
- The device approval page is server-rendered (francois's was React) so phase 1 has no frontend dependency.
- `revokeToken` lets an admin revoke anyone's token, because the Admin screen lists every token (`GET /api/tokens?all=1`).

### What worked
- Manual run: `slop serve --local --listen 127.0.0.1:18080`; `curl` sign-in as manuel → 303 and `/api/me` with role admin; cross-origin `POST /auth/local` → 403; invalid nickname → form problem; `slop auth login --server http://localhost:18080 --as claude-manuel` → token with `read write`; rw token: `/api/users` 200, `/api/audit` 403 `token_scope`, `/api/tokens` 401 `token_not_allowed`; cookie POST without CSRF → 403 `csrf_failed`; self-demotion → 409 `self_lockout`; `slop auth logout` → `revoked`.
- Guard rails: `--local --listen 0.0.0.0:18081` → `local mode (no authentication) only listens on a loopback address`; `--public-url https://slop.computer` → `local mode needs an http://localhost or http://127.0.0.1 public URL`.
- `go test ./...` and the same with `TEST_DATABASE_URL=postgres://…:55432/…` → all `ok`.

### What didn't work
- `slop auth login … --output json` → `unknown flag: --output` (glazed's flag is `--output-format`); reran without it.
- The Postgres test container exited by itself (`Exited (255)`, logs show only normal checkpoints); `docker start slop-test-pg` fixed it.
- `golangci-lint run` reports 10 `unused` findings for helpers the API commands of phases 2/4 will use (`apiClient`, `serverFlags`, `arg`, `optArg`, `integer`, `esc`, `itoa`, `download`); the multipart upload was removed instead. Lint is therefore not clean at this commit.

### What I learned
- In local mode both `localhost:PORT` and `127.0.0.1:PORT` are main-host origins; each gets its own cookie, so one browser can hold two identities.

### What was tricky to build
- The local sign-in form posts before any session (so no CSRF token) — it checks `Origin` against the main-host origins instead, the same rule francois applied to its public demo endpoint.
- Server-rendered forms send the CSRF token as a `csrf` form field; the guard accepts `X-CSRF-Token` or that field. `logout` redirects for form posts and answers JSON for the Workshop.

### What warrants a second pair of eyes
- `guard` lets a pending user's session reach `session`-level routes (`/api/me`, logout, `GET /device` renders a refusal). Kernel routes will all be `admin` level.
- `POST /device` is admin-only; francois also allowed non-admin approvals because subscribers could hold tokens. Here only admins can mint tokens at all.

### What should be done in the future
- Phase 7: rate-limit `/auth/local` too (it is loopback-only, so low priority).

### Code review instructions
- Start with `pkg/server/auth.go` (`guard`), then `local.go`, `device.go`, `tokens.go`.
- `go test ./pkg/server/ -run TestGuardMatrix -v`; manual: `go run ./cmd/slop serve --local`, open http://localhost:8080.

### Technical details
- Cookies: `__Host-slop_session` on HTTPS, `slop_session_dev` otherwise; flow cookie likewise.
- Local tokens default to `read,write` for 30 days; admin-scoped tokens must expire within 1–90 days.

## Step 12: Phase 2 — artifact kernel, blobs, events, SSE and comments wait

This step built the core of slop: artifacts with versions stored as file trees, the `main` ref with compare-and-set, routes with history and undo, comment threads, and an event log written in the same transaction as every change. On the server side there is a content-addressed blob store, the kernel API, a server-sent event stream with replay, and `GET /api/comments/wait`, the long-poll Claude Code blocks on.

All tests (store kernel, broker, API integration with SSE ordering, comments wait) pass on SQLite and Postgres at the first full run, after one compile error.

### Prompt Context
**User prompt (verbatim):** see Step 9 (and the follow-up quoted there)
**Assistant interpretation:** Phase 2 of the guide.
**Inferred user intent:** A working backend for the Workshop and the agent loop.
**Commit (code):** 82dd101 — "SLOP-001 phase 2: artifact kernel, blobs, events, SSE and comments wait"

### What I did
- `pkg/blobs` (adapted from francois `releases.Blobs`: key = sha256; `PutReader` verifies an expected hash; `Stat`, `Missing`, `Open`, `Read`).
- Migrations `002_kernel.sql` (both dialects): `projects`, `artifacts`, `versions`, `version_files`, `refs`, `routes`, `route_log`, `threads`, `comments`, `events`.
- `pkg/store`: `events.go` (`appendEvent` inside transactions, `EventsAfter`, `LastSeq`, ephemeral seq-0 events), `projects.go`, `artifacts.go` (`Push` with row lock / CAS → `MainMovedError`, `SetRef`, `Versions` with trees), `routes.go` (`SetRoute`, `RemoveRoute`, `RouteLog`, `UndoRoute`, path validation), `threads.go` (`CreateThread`, `Reply`, `ResolveThread`, `Threads`), `InvalidError` for validation failures.
- `pkg/events/broker.go`: in-process fan-out; a subscriber that falls 256 events behind is dropped (its channel closed) and replays from the store.
- `pkg/server/kernel.go` (all §6.4 kernel endpoints except records/resolve/sandbox-url), `stream.go` (`/api/events`, `/api/comments/wait`, `/api/agents`, waiter registry), events for user-role and token changes; `serve --blobs` (default `./var/blobs`).
- Tests: `pkg/store/kernel_test.go`, `pkg/events/broker_test.go`, `pkg/server/kernel_test.go` (`TestKernelAPI`, `TestCommentsWait`).

### Why
- Events in the same transaction as the change (D: §6.6) so replay after reconnect is exact; publishing only after commit so subscribers never see rolled-back changes.
- Subscribe-then-replay ordering in both SSE and wait so an event committed between the two is not lost; duplicates are skipped by seq.
- `comments wait` ignores comments written with the caller's own token, not the caller's user: in production Claude Code uses Manuel's token and must still see Manuel's browser comments. A browser caller ignores its own user.
- A comment or thread made with a token is marked `agent: true`.
- The server, not the client, decides `via`: `browser` for sessions, `cli` or `claude` (if the CLI says so) for tokens.
- Typed `InvalidError` instead of matching error strings (I first wrote a string-sniffing `badRequest` helper and replaced it before committing).

### What worked
- `go test -count=1 ./...` and with `TEST_DATABASE_URL=postgres://…:55432/…` → all `ok` (server package ~2.1–2.6 s because of the 1 s wait timeouts).
- `TestKernelAPI` observes `project.updated, artifact.created, version.created ×2, route.set, thread.created, comment.created` in order over SSE; path traversal `../x` → 400; push without base after v1 → 409 `main_moved`; push with an unuploaded blob → 409 `missing_blobs` with the list; served file has `ETag: "<sha256>"`.
- `TestCommentsWait`: 204 on timeout; the waiter appears in `/api/agents`; a browser comment wakes the agent with the full thread; the agent's own reply does not; the owner's later reply is found by replay with `after=<seq>`.

### What didn't work
- Compile error: `pkg/store/artifacts.go:392:22: invalid operation: cannot call reply (variable of type string): string is not a function` — a local variable `reply` in `Push` shadowed the `reply` function; renamed to `replyThread`.
- First draft of the HTTP error mapping guessed validation errors from message text (`strings.Contains(msg, "constraint")`); replaced by `store.InvalidError` + `invalidf` in `artifacts.go`, `routes.go`, `threads.go`.

### What I learned
- SQLite's `RETURNING` and `ON CONFLICT … DO UPDATE … excluded.x` behave like Postgres for everything used here.

### What was tricky to build
- Payload shape for comment events: `thread.created` carries the whole thread under `thread`, `comment.created` carries the thread ID under `thread` plus `comment`. `commentMatches` handles both; the wait answer always re-reads the full thread. Consistent shapes would be nicer (see future).
- The broker drops slow subscribers instead of blocking `Publish` (which runs on request goroutines). SSE clients reconnect with `Last-Event-ID`; a dropped wait answers 204 and the CLI retries from its cursor.

### What warrants a second pair of eyes
- `Push` reads blob sizes from disk outside the transaction; a blob GC running concurrently could remove a blob between the check and the commit (no GC exists yet).
- `SetRoute` on Postgres locks the route row with `FOR UPDATE` inside `getRoute`, and `getRoute` is reused after the upsert; harmless but worth knowing.
- Events table grows without bound; fine for two people.

### What should be done in the future
- Make `comment.created` payload carry `artifact`, `thread` (ID) and `comment` consistently with a `threadId` field on `thread.created`.
- Blob GC (phase 7).

### Code review instructions
- `pkg/store/artifacts.go` `Push`, `pkg/store/routes.go` `setRoute`/`UndoRoute`, `pkg/server/stream.go` `eventStream`/`waitComments`, `pkg/server/kernel.go` `push`.
- `go test ./pkg/server -run 'TestKernelAPI|TestCommentsWait' -v`.

### Technical details
- Limits: 25 MB per file, 200 MB per version, 2000 files; paths ≤ 512 chars, no leading `/`, no `..`, no `\`, `_slop/` reserved.
- SSE: `id: <seq>` per stored event, `event: <type>`, `data: <Event JSON>`; a `ready` event marks the end of the replay; `: ping` every 25 s.

## Step 13: Phase 3 — routing, records, rendering, site and sandbox hosts

This step makes pushed versions visible. Site hosts (`site.localhost:<port>` in local mode) answer every path through the route table. The sandbox domain serves one version per host label as a Workshop preview. Both inject the boot data and `runtime.js`, which defines `window.slop`; previews also get the preview bridge, which talks only to the Workshop's origin.

I changed two things from the guide: preview access uses unguessable per-version host labels instead of signed cookies, and assets of routed pages are found via the resolved page, the Referer's page, or `/_v/…`.

### Prompt Context
**User prompt (verbatim):** see Step 9
**Assistant interpretation:** Phase 3 of the guide.
**Inferred user intent:** Pages pushed by agents can be seen, on the site and in previews.
**Commit (code):** dcb7c1a — "SLOP-001 phase 3: routing, records, rendering, site and sandbox hosts"

### What I did
- `pkg/routing`: `Match`, `Specificity`, `Resolve` (port of `sources/workshop/api.js:105-144`), tested with every route of `seed.js:553-570`.
- `pkg/records`: `FrontMatter`, `Markdown` (goldmark + GFM), `Parse`, `FromFiles`, `Tokens.CSS` (names/values with `< ; { }` skipped).
- `pkg/render`: `Inject` (boot JSON with `<` escaped, runtime, bridge in preview/thumb, tokens style before `</head>`), `assets/runtime.js`, `assets/bridge.js` (port of `render.js:80-193`; posts only to `parentOrigin`, accepts messages only from it; adds the element box to picks).
- Migration `003_sandbox.sql`: `server_keys`, `sandbox_labels`; store `ServerKey`, `SandboxLabel` (`"s"` + 20 hex of HMAC(key, artifact‖n)), `SandboxTarget`.
- `pkg/server/serve.go`: record cache for immutable data versions, `bindings`, `renderPage`, `serveSite`, `serveSandbox`; `preview.go`: `GET /api/sandbox-url`, `/api/resolve`, `…/versions/{n}/records`; host dispatch in `Handler`; `serve --site-host`, `--sandbox-domain` with local defaults; `/api/config` reports them.
- `pkg/server/serve_test.go`.

### Why
- **Labels instead of signed cookies (deviation from §6.7):** the Workshop frames previews from another site; cookies there are third-party and increasingly blocked by browsers. An unguessable host label is a capability URL that needs no cookie, and still gives each version its own origin.
- **Asset lookup (answers open question 6 for v1):** a page routed at `/pricing` that links `style.css` makes the browser ask for `/style.css`, which no route serves. The server tries the file in the page the path resolves to (works for `/journal/style.css` under `/journal/:slug`), then in the page the `Referer` resolves to, and `/_v/<artifact>/<n>/<file>` always works. A `<base>` element was rejected because it breaks `#fragment` links.
- Admins-only routes are invisible on site hosts (no viewer sessions there in v1), including through `/_v/`.

### What worked
- `go test -count=1 ./...` and with `TEST_DATABASE_URL` → all `ok`.
- `TestServeSiteAndSandbox`: record/params/data/tokens in the boot data; `/journal/style.css` and `/style.css` with Referer served; `/_v/journal-post/1/style.css` 200, `/_v/secret/1/index.html` 404; admins-only and unrouted paths 404; unknown host 421; sandbox URL host ends in `.sandbox.test` and renders with the bridge, the parent origin and the route context; unknown label 404.

### What didn't work
- Compile error in my first `render.go`: `tail = strings.ReplaceAll(tail, "&#34;", …).ReplaceAll(…)` (no such method on string) — and HTML-escaping CSS inside `<style>` was wrong in the first place (style content is raw text). Removed; `Tokens.CSS` already rejects dangerous characters.
- `TestServeSiteAndSandbox` first failed on my own assertion: I expected `<strong>table`, but Go's JSON encoder escapes `>` too (`<strong>table`). The output was right; fixed the test.

### What I learned
- `encoding/json` HTML-escapes `<`, `>` and `&` by default, so the boot JSON was already safe; the extra `<` replacement in `Inject` is belt and braces.

### What was tricky to build
- Route context for previews: a preview of `journal-post` at `/journal/other?host=site.test` resolves that host's route for the path to get params, record and route bindings, while the page itself is the sandbox's version, not the route's.
- `frame-ancestors` lists every main-host origin (public URL, 127.0.0.1 spelling, dev origins), since the Workshop may run on any of them.

### What warrants a second pair of eyes
- Previews are capability URLs: anyone with a sandbox URL can see that version (they do not expire). Acceptable for two admins; revisit if drafts become sensitive.
- The Referer fallback trusts the Referer only to pick which routed page's files to look in; it cannot reach unrouted artifacts.

### What should be done in the future
- Update the guide's §6.7 with the label scheme and the asset rule (done in a later doc pass).

### Code review instructions
- `pkg/server/serve.go` (`serveSite`, `serveSandbox`, `renderPage`), `pkg/render/render.go`, `pkg/render/assets/bridge.js`, `pkg/store/sandbox.go`.
- `go test ./pkg/server -run TestServeSiteAndSandbox -v`.

### Technical details
- Sandbox URL: `<scheme>://s<20 hex>.<sandbox domain>/<path>?parent=<main origin>&mode=preview|thumb&host=<site host>`.
- Site responses: `Content-Security-Policy: frame-ancestors 'self' <main origins>`, `Cache-Control: no-store`; blobs: `ETag "<sha256>"`, `immutable`.

## Step 14: Phase 4 — agent CLI and dev seed

This step gives the agent its side of the loop from the Directions doc: pull a page, edit the folder, push it as a new version (optionally replying on the thread that asked for it), move routes, and block on `slop comments wait` until a human comments. `slop dev seed` loads the prototype's whole lab site into a local server, so later phases (Workshop UI) have realistic data from the first minute.

I ran the "contact sheet" round end to end against a local server with two identities: Ramon commented on `section.tiers` from a browser session, the waiting `claude-manuel` token woke up with the anchor and computed styles, edited the folder, pushed v8 with `--reply`, and moved/undid `/pricing`.

### Prompt Context
**User prompt (verbatim):** see Step 9 (and "make sure to write a diary at frequent intervals and MANDATORY: follow diary skill format")
**Assistant interpretation:** Phase 4 of the guide (agent CLI + seed), with the exit check run for real, then commit and record.
**Inferred user intent:** An agent in a terminal can iterate on live pages with humans commenting in the browser, locally, before the Workshop UI exists.
**Commit (code):** bfc8a96 — "SLOP-001 phase 4: agent CLI (push/pull/route/comments/projects), dev seed"

### What I did
- `pkg/client/kernel.go`: typed calls for projects, artifacts, versions, files, blobs (`MissingBlobs`, `PutBlob`), `Push`, routes (set/rm/undo), threads (create/reply/resolve), `WaitComments`, `SandboxURL`, `PatchArtifact`.
- `cmd/slop/cmds/folder.go`: `readFolder` (skips dotfiles, `.slop/`, `node_modules`; `slop.json` becomes the manifest), `.slop/artifact.json` state (server, artifact, base).
- `cmd/slop/cmds/push.go`: `push` (hash → `blobs/missing` → parallel `PUT` (4) → `versions`; base from state or main; `--reply`, `--reply-text`, `--no-main`, `--force`, `--session`/`SLOP_SESSION`; `via=claude` when `CLAUDECODE=1`), `push --watch` (fsnotify on every non-skipped dir, re-adds dirs on Create, 300 ms debounce), `pull [--version]`, `artifacts list`.
- `cmd/slop/cmds/routes.go`: `route list/set/undo/rm` (`--host` is the site host, default the server's first site host from `/api/config`; the Host-header override became `--host-header`), `comments wait/reply/list` (wait keeps a cursor per scope in `cursors.json`, `--from-now`), `projects list/put`.
- `cmd/slop/cmds/devseed.go` + `scripts/export-seed.mjs` → `examples/seed/` (seed.json + `artifacts/<id>/v<n>/` trees): 14 artifacts, 41 versions, 10 routes, 6 threads. In local mode each version is pushed as its author via `/api/local/token`.
- Store: a push whose tree and manifest equal main's stores nothing and returns `unchanged` (HTTP 200 instead of 201); test in `kernel_test.go`.

### Why
- **Unchanged pushes:** `push --watch` pushes once on start, and editors re-save files without changes (touch); both created identical versions (v11 duplicated v10 in the first run). Comparing with *main* (not the base) keeps `--force` from an old base meaningful. Pushes with `--reply` always store a version so the reply has one to point at.
- **Seed as files, not SQL:** the seed goes through the same push path as agents, so it exercises blobs, versions, routes and threads, and stays valid when the schema changes.

### What worked
- Exit check (local server on `127.0.0.1:18080`, config in the scratchpad):
  - `slop dev seed` → `seeded 41 versions, 10 routes on site.localhost:18080, 6 threads`; curl 200 for `/`, `/pricing`, `/journal`, `/journal/routes-not-templates`, `/apps/orbits`, `/play/orbits`; 404 for `/nowhere`; `/boutique.css` via Referer.
  - `comments wait -a pricing --from-now` listed in `/api/agents`; Ramon's browser comment (cookie + CSRF) woke it with `anchor: section.tiers`, `computed styles: gap=24px paddingTop=64px`, and the reply hint.
  - `push pricing -m … --reply th_…` → `pushed pricing v8 … replied on th_377b…`; `comments list --open` shows "Done: gap 24 → 12px" as the last comment.
  - `route set /pricing pricing@8` → `pricing v5 → pricing v8 (slop route undo /pricing goes back)`; `route undo` → back to v5.
  - Stale folder after someone else pushed v9 → refused with `main_moved`, exit 1; `--force` → v10.
  - `push --watch`: two writes 100 ms apart → one version; a later write → another; a touch → `pricing unchanged · main is v14`.
- `make lint` → 0 issues (the 8 `unused` findings from phase 2 are now used). Tests pass on SQLite and Postgres.

### What didn't work
- `defer` inside the seed loop (restoring each artifact's viewer) would have run only at the end; replaced with a viewers map applied after the loop.
- `--host` collided: it meant the Host-header override (from francois) and the site host for routes. Renamed the override to `--host-header`.
- Playwright refused to save a screenshot outside its allowed roots; saved under `.playwright-mcp/` in the repo and git-ignored it.
- `make test-postgres` failed with `dial tcp 127.0.0.1:5432: connect: connection refused`: the test container `slop-test-pg` publishes `127.0.0.1:55432`. Ran with `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable`.
- The tmux session holding the server had died between checks; the first re-run of the watch test printed `connection refused` and left an extra `<!-- w4 -->` in the folder, which is why the next "same" push created v14 (verified by pulling v13 and diffing: exactly that line).
- The first conflict hint read `slop pull pricing pricing`, which looked like a typo; reworded to name the artifact and say pull overwrites edits.

### What I learned
- fsnotify does not watch recursively; directories created after start must be added on their `Create` event, which `watchPush` does.
- glazed's output flag is `--output-format`, not `--output`.

### What was tricky to build
- Ordering in `comments wait`: the server ignores comments made with the caller's own token, so an agent's `--reply` never wakes itself; the CLI's cursor makes a restarted wait not replay what it already handled.
- Seeding as several people needs one token per author: the seed uses local mode's loopback-only `/api/local/token`, and falls back to the caller's own token when the server is not local.

### What warrants a second pair of eyes
- `sameVersion` compares paths and SHA-256 sums plus the manifest as decoded JSON (`reflect.DeepEqual`), so key order and whitespace do not count as changes; a changed media type alone would not either (it is derived from the path).
- `examples/seed` is 1.8 MB of prototype content committed to the repo.

### What should be done in the future
- Phase 5: the Workshop (React + RTK Query) on top of these APIs.
- Consider making the Makefile's Postgres port configurable or matching the container (55432).

### Code review instructions
- Start at `cmd/slop/cmds/push.go` (`pushOnce`, `watchPush`), then `routes.go` (`waitCmd`, `printWait`), `devseed.go`, `pkg/store/artifacts.go` (`Push`, `sameVersion`).
- Validate: `slop serve --local`; `slop dev seed`; `slop auth login --as claude-you`; `slop comments wait -p lab-site` in one terminal, comment as another nickname, `slop push … --reply`.

### Technical details
- Push request: `{"tree":{path:sha},"manifest":{…},"message","via","session","base":n,"reply":{"thread","text"},"create":{title,kind,type,project},"moveMain":bool,"force":bool}` → `201 {artifact,version,created,unchanged:false,warnings}` or `200 {…,unchanged:true}`; `409 main_moved`.
- Cursor file: `$SLOP_CONFIG_DIR/cursors.json`, keyed by server + scope (`project:<id>` / `artifact:<id>` / `all`).

## Step 15: Phase 5 — the Workshop in React + RTK Query, embedded

This step replaces the server's placeholder home page with the Workshop: the prototype's five screens (Watch, Routes, Artifacts, Site, Admin) rebuilt in React 19 + Redux Toolkit Query against the real API, built by Vite, and embedded in the binary. The prototype's `style.css` is used unchanged, so the screens look like the prototype; the code is new.

Everything that changes on the server reaches the UI the same way: `/api/events` (SSE) → `api/events.ts` → `invalidateTags`. Mutations never invalidate anything themselves, so a comment from Ramon's browser, a push from an agent and your own click all refresh the cache through one code path.

### Prompt Context
**User prompt (verbatim):** see Step 9 (and, mid-step: "to test the coding agent interactino with the API, yu can run pi agent with deepsee-4.1-flash thinking medium to create a few pages, and potentially add a set of artifacts if necessary with real data (or get real data from https://slop.computer/, with the francois CLI)" and "you can actually run multiple coding agents (simulating ramon or manuel) in tmux tabs.")
**Assistant interpretation:** Phase 5 of the guide; the two mid-step messages define the exit check: real coding agents (pi) as Manuel's and Ramon's agents, in tmux windows, driven by comments made in the Workshop.
**Inferred user intent:** A Workshop that two people and their agents can actually use together, tested with real agents rather than scripted ones.
**Commit (code):** b7b8bd6 — "SLOP-001 phase 5: Workshop in React + RTK Query, embedded in the binary"

### What I did
- `web/workshop/` (pnpm, Vite 8.3.5, @vitejs/plugin-react 6.1.2, React 19.3.1, RTK 2.13.0, react-redux 9.3.1, TypeScript 5.9.3; versions pinned exactly):
  - `src/api/types.ts` (hand-written to match the Go JSON), `slopApi.ts` (every endpoint; `push` is a `queryFn` mutation: SHA-256 via `crypto.subtle`, `blobs/missing`, `PUT` missing blobs, `POST versions`, carrying unchanged files over as `keep`), `events.ts` (event → tags table, console lines, "Claude Code pushed …" toasts).
  - `src/app/`: `boot.ts` (`/api/me` + `/api/config`, CSRF token), `store.ts`, `ui.ts` (toasts, console, live flag — the only non-RTKQ state), `router.ts` (path router via `useSyncExternalStore`: `/watch/<artifact>/<n>`, `/routes`, …), `hooks.ts`, `format.ts`, `App.tsx` (+ `PendingScreen`).
  - `src/components/atoms` (Button, Tag, Count, Avatar, Select, Seg, Toggle, Tabs, …), `molecules` (ThreadItem + ReplyBox, Composer, VersionRow, FilmFrame), `organisms` (PreviewStage + Thumb, CommentsPane, VersionsPane, ConsolePane, PageToolbar, VisitLine, Filmstrip, FilesPane, RecordsPane + RecordForm, TokensEditor, TopBar, ToastHost), `screens` (Watch, Routes, Artifacts + PushDialog, Site, Admin).
  - `src/preview/bridge-protocol.ts`: the message types `pkg/render/assets/bridge.js` speaks.
- `pkg/web`: `go generate ./pkg/web` runs `pnpm install --frozen-lockfile && pnpm build` and copies `dist/` (without source maps) to `pkg/web/workshop/` (git-ignored); `embed.go` (`-tags embed`) embeds it, `embed_none.go` reads it from disk (found via go.mod) or leaves `Workshop` nil.
- `pkg/server/workshop.go`: `index.html` for `/`, `/watch[/…]`, `/routes`, `/artifacts`, `/site`, `/admin` (signed out → `/auth/login?return=…`; no build → the old placeholder with a hint); `/static/workshop/{path...}` with `immutable` caching for `assets/`. `Config.Workshop fs.FS`.
- `GET /api/routes?resolve=1`: each route plus `n` (served version) and `data` (resolved bindings), so Routes, Watch and Artifacts don't each resolve bindings client-side.
- Makefile: `generate`/`web`, `build` (embedded binary `./slop`), `dev-backend` (`serve --local --dev-origin http://localhost:5173`), `dev-frontend` (`pnpm dev`, proxying `/api /auth /device /_/ /_slop /static`).
- `pkg/server/workshop_test.go`: sign-in redirect with return path, index on every client path, immutable assets, `?resolve=1`.

### Why
- **Path router, no react-router:** five screens and one parameterised path; 40 lines with `useSyncExternalStore` keep the dependency list to React + RTK.
- **`?resolve=1` on the server:** the prototype's `bindingsFor` needed every page version's manifest on the client; the server already has `bindings()` for rendering, so it answers it once per route.
- **Dev base `/`, build base `/static/workshop/`:** Vite's SPA fallback in dev serves `/watch/...` directly; in production the server owns those paths and serves assets under `/static/` (AGENT.md web guideline).
- **iframe `sandbox="allow-scripts allow-same-origin …"`:** previews are on their own sandbox origin, so `allow-same-origin` gives them *their* origin (needed for `e.origin` checks and the page's own storage), never the Workshop's.

### What worked
- `pnpm check` and `pnpm build` clean on the first run; `go test ./...` on SQLite and Postgres; `make lint` 0 issues.
- Browser walkthrough (Playwright, local server with `slop dev seed`, signed in as manuel via the nickname page, which returned to `/watch/pricing`): screenshots in `various/screenshots/p5-01…06-*.png`.
  - Watch: threads with agent replies, pins drawn in the sandbox preview, "/pricing serves v5, pinned · Point /pricing at v15", filmstrip thumbnails.
  - C → click the headline → composer "On v15 of pricing · h1.sb-h1" → ⌘↩ → thread 4 appears through SSE, pin 4 outlined on the heading.
  - Routes: resolved bindings (`experiments@main journal@main`), "v15 newer" on the pinned route, preview, binding selects, history.
  - Artifacts: grouped by project with live thumbnails and record summaries; Site: following "Journal" inside the frame navigates the Site screen (`/journal → journal-index v6 (main) · posts = journal v3 · tokens v2`); Admin: people with role selects.

### What didn't work
- Playwright could not click inside the preview at Desktop width: `<p class="tier-price">… subtree intercepts pointer events` — its hit-testing does not account for the CSS `transform: scale()` on the device box. Switching to Fit (scale 1) made the click land. A real mouse is not affected.
- Console warning `Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('http://s8e76….sandbox.localhost:18080') does not match the recipient window's origin ('http://localhost:18080')`: pins were posted before the iframe left `about:blank`. Now nothing is sent until the bridge's `ready`, and `ready` resets when the URL changes.
- `#root` had no height, so the layout did not fill the window in the first screenshot; added `#root { height:100% }` (`styles/react.css`).
- The running server embeds the build, so UI changes need regenerate + rebuild + restart; scripted in the scratchpad (`restart.sh`).
- `ERR_INCOMPLETE_CHUNKED_ENCODING` on `/api/events` after a restart: the stream was cut; EventSource reconnects by itself (expected).

### What I learned
- Thumbnails need a route context too: pages behind `:param` routes (app-page, journal-post) show their "No post called …" state in thumbnails because a thumb has no path.

### What was tricky to build
- Keeping one event path: the push mutation, thread mutations and route mutations return data but invalidate nothing; the UI updates when the server's own event comes back over SSE. That means a slow or broken stream shows stale data — the TopBar's live dot (green when `ready` was received) makes that visible.
- The Watch screen's state (picking, pending anchor, focus, scroll-to-pin requests, missing pins) has to survive version changes but reset on artifact changes: the screen is keyed by artifact id in `App`.

### What warrants a second pair of eyes
- `PreviewStage` origin checks: messages are accepted only if `e.source` is our iframe's window *and* `e.origin` ends with `.` + sandbox domain; messages are sent with the sandbox URL's exact origin as target.
- The browser push keeps every unchanged file of the version it edits (`keep`) and sends `base`; a stale base is refused (`main_moved`) and the form says to open the newest version.

### What should be done in the future
- Thumbnails for `:param` routes: pass a sample path (the Watch toolbar already computes one).
- Safe mode `/_/` (Phase 5 task, next step).
- Design-token drafts can't be previewed before saving (the prototype injected them; the sandbox serves stored versions) — a bridge message to set CSS variables would bring it back.

### Code review instructions
- Start at `web/workshop/src/api/slopApi.ts` and `api/events.ts`, then `components/organisms/PreviewStage.tsx`, `screens/WatchScreen.tsx`; server side `pkg/server/workshop.go`, `pkg/web/*`.
- Validate: `make build && ./slop serve --local` (then `slop dev seed`), open http://localhost:8080; or `make dev-backend` + `make dev-frontend` and open http://localhost:5173.

### Technical details
- Event → invalidation table: `version.created` → `Version:<artifact>`, `Artifact:LIST`, `Route:LIST`, `Audit`; `route.set|removed` → `Route:LIST`, `RouteLog`; `thread.*|comment.created` → `Thread:<artifact>`, `Thread:ALL`; `agent.waiting|left` → `Agent`; `user.role` → `User`; `token.*` → `Token`.
- Bundle: 375 KB JS (116 KB gzip), 22.5 KB CSS.

## Step 16: Phase 5 exit check — two real coding agents, safe mode, agent attribution

This step closes Phase 5 with the test the owner asked for: real coding agents, one per person, working against the Workshop. Two pi agents (`lunaroute/deepseek-4.1-flash`, thinking medium) ran in tmux windows as `claude-manuel` (project lab-site) and `claude-ramon` (project play). Each built a new page from a short brief, routed it, then blocked on `slop comments wait`. I commented as Manuel (on `localhost`) and as Ramon (on `127.0.0.1`, so the same browser holds a second identity); each agent answered every comment with a new version and a reply in the thread. Safe mode `/_/` was built while they worked.

### Prompt Context
**User prompt (verbatim):** see Step 15 (pi agents; "you can actually run multiple coding agents (simulating ramon or manuel) in tmux tabs."), and mid-step: "keep screenshots for the diary and for the report writeup once we are done"
**Assistant interpretation:** Run two independent agents as the two people's agents, drive them only through the Workshop and the CLI, keep every screenshot and the agents' transcripts in the ticket.
**Inferred user intent:** Evidence that the agent loop works with agents other than Claude Code, and material for a later report.
**Commit (code):** aaa76f6 — "SLOP-001 phase 5: safe mode /_/, via=agent for coding agents"; 8f17564 — "SLOP-001: thumbnails in route context; guide 6.7 as built (sandbox labels, asset lookup)"

### What I did
- `SLOP_VIA=agent|claude` (CLI) and `via: "agent"` (server) mark pushes from any coding agent; the Workshop shows "claude-manuel’s agent" (`isAgent()` in `format.ts`, used by avatars, toasts, console, cards).
- Agent workspaces in the scratchpad: `agents/<who>/{AGENTS.md, prompt.txt, cfg/ (own login via slop auth login --as claude-<who>), bin/slop}`; started with `pi -p --model lunaroute/deepseek-4.1-flash --thinking medium --session-dir …` in tmux windows `manuel` and `ramon` (env `PATH`, `SLOP_CONFIG_DIR`, `SLOP_VIA=agent`).
- Round 1 through the Workshop UI (C → click → comment): Manuel on colophon's `p.line-label` ("Way too much space between each section title and its text…"), Ramon on release-board's `#rb-planned` ("…the three columns should sit side by side…").
- Round 2 through the browser session's API (same calls the UI makes): Manuel asked for a "last pushed" line, Ramon for per-column counts.
- Safe mode `/_/` (`pkg/server/safe.go`, `templates/safe.tmpl`): routes per host with a version select + Point, Undo last change, token revoke; forms with the `csrf` field, same guard, store calls and events as the API; `safe_test.go`.
- Thumbnails get the route context (host + sample path) like the Watch preview, so `:param` pages show a record (`PageShot`, `Filmstrip ctx`).
- Guide §6.7 updated to the as-built sandbox labels and asset lookup (open item from Step 13).
- Screenshots renamed into `various/screenshots/p5-*.png`; agent evidence in `various/agent-test/<who>/` (brief, prompt, final report `pi.log`, full `session.jsonl`, the agents' own screenshots).

### Why
- **`via=agent`** instead of pretending to be Claude Code (`CLAUDECODE=1`): attribution in the audit log, the thread and the version list should say what actually pushed.
- **Two origins for two people:** local mode already adds the 127.0.0.1 spelling as an extra origin; cookies are per host, so one browser holds Manuel and Ramon at once — no second browser profile needed.

### What worked
- Agents, from the transcripts: Manuel's agent 63 tool calls in 4m53s (24 bash; slop: push ×4, pull, route set, comments wait ×2); Ramon's 38 tool calls in 4m31s (22 bash; slop: pull ×3, push ×3, route set, comments wait ×2). Both used only the commands in AGENTS.md.
- Task 1: `colophon` v1 (lab-site, /colophon) and `release-board` v1 (play, /play/releases, 36.9 KB, 12 cards) built on the site's look by pulling `about` / `orbits` and reusing `boutique.css`; `/api/agents` then listed both waiters (`project: lab-site`, `project: play`).
- Round 1: replies "Fixed. The space came from the default top/bottom margins on the label and on the first paragraph…" (colophon v2) and "Columns now sit side by side on any screen wider than 700px…" (release-board v2), each a push with `--reply`; the Workshop showed them live (`p5-09`, `p5-10`).
- Round 2: Manuel's agent was not waiting when the comment was made; its next `comments wait` still returned it (the cursor replays from the last seen event) → colophon v4 with "Last pushed 28 October 2026 · v4"; release-board v3 with the tally "3 planned · 3 in review · 6 out".
- `go test ./...` (SQLite) green, `make lint` 0 issues; `TestSafeMode`: point → pinned v1, undo → follows main, POST without CSRF → 403, revoked token → 401.

### What didn't work
- The agents found and used the Playwright MCP browser — the *same* browser I was driving. My viewport changed under me (resized to ~711 px; `p5-08` is the stacked layout) and Ramon's agent reported "Browser is already in use" and fell back to curl checks. Next run: give agents their own browser profile or no browser tools.
- `button:has-text("ramon")` matched both `ramon` and `claude-ramon` on the sign-in page (strict mode violation); used the snapshot ref.
- A first screenshot of Artifacts after a restart showed every card "not routed" / "0 records" — taken before the queries returned; retaken 3 s later.
- My first sentence on the top-bar pill read "No agent · waiting on comments" (ambiguous); now "listening for comments".

### What I learned
- An agent without any slop-specific training can do the whole loop from a 30-line AGENTS.md: the `comments wait` output (selector, computed styles, the exact reply command) is enough context.
- Agents do not resolve threads (correct: the person who asked resolves), so open-thread counts stay up until a human looks — the Workshop shows the agent reply right under the request.

### What was tricky to build
- Telling when "the agent has answered": polling `/api/threads` for an `agent: true` comment per thread, not `/api/agents` (a waiter disappears while the agent works and reappears after the push).

### What warrants a second pair of eyes
- `via` comes from the client: a person can push with `SLOP_VIA=agent`. It is attribution, not a permission — the token's owner and scopes are what count.
- Safe mode's Point keeps the route's page, bindings and access and only changes the version; it cannot create routes or change pages (by design: it is the fuse box, not a second Workshop).

### What should be done in the future
- Isolate agents' browsers (or drop browser tools from their tool list) in the multi-agent test.
- Manuel's agent flagged that its "last pushed" line is static text: the runtime could expose the version number and push time (`window.slop.version`) so pages can show it without editing.
- Phase 6: tools (Ramon's release board as a *tool* with API grants rather than a page with an embedded JSON array).

### Code review instructions
- `pkg/server/safe.go`, `pkg/server/templates/safe.tmpl`, `pkg/server/safe_test.go`; `cmd/slop/cmds/push.go` (`via`), `pkg/server/kernel.go` (push `via`).
- Re-run the agent test: see `various/agent-test/<who>/prompt.txt` and the tmux command in this step.

### Technical details
- Agent start: `PATH=$A/bin:$PATH SLOP_CONFIG_DIR=$A/cfg SLOP_VIA=agent pi -p --model lunaroute/deepseek-4.1-flash --thinking medium --session-dir $A/sessions "$(cat prompt.txt)"`.
- Threads after the test: colophon `th_73d40cc8…` (v1 → v2/v3), `th_10e853e0…` (v2 → v4); release-board `th_31fe97…` (v1 → v2), `th_f5a5c7…` (v2 → v3).

## Step 17: Phase 6, server half — tools, grants, permissions, CORS

This step lets a pushed page become a **tool**: a screen that runs inside the Workshop (in a sandbox-domain iframe) and calls the API with a short-lived grant that carries only the permissions an admin approved. It implements §6.13 on the server: manifests, tables, endpoints, a third kind of principal in the guard, CORS for preview origins, and the `tool.js` client injected into tools.

### Prompt Context
**User prompt (verbatim):** see Step 9; the tool scenario is from the earlier "ok i do want that scenario where ramon makes a publish release board or so, it's just the core workshop should be in the app embedded to avoid corruption."
**Assistant interpretation:** Phase 6 of the guide; server first, with the exit-check rules as tests.
**Inferred user intent:** Ramon (or his agent) can ship new screens without a binary deploy, and a pushed screen can never do more than an admin approved.
**Commit (code):** f631ded — "SLOP-001 phase 6: tools on the server (manifests, grants, permissions, CORS)" (+ 56c7a22 gofmt)

### What I did
- Migration `004_tools.sql` (both dialects): `tools(artifact_id, version, permissions, title, icon, enabled_by, enabled_at)`, `tool_grants(token_hash, artifact_id, version, user_id, permissions, created_at, expires_at)`.
- `pkg/store/tools.go`: `ToolPermissions` (8 permissions with plain-word descriptions), `ToolManifestOf`/`Validate`, `Tools`, `Tool`, `EnableTool` (permissions are taken from the version's manifest, deduplicated; other versions' grants revoked; audit + `tool.enabled` event), `DisableTool` (grants revoked; `tool.disabled`), `CreateGrant` (`slg_` + 32 random bytes, 1 h), `ResolveGrant`, `RevokeGrants`.
- `pkg/server/auth.go`: `Principal.Grant`; `guardPerm(level, scope, perm, h)` (`guard` = `guardPerm` with no permission). A `Bearer slg_…` is accepted only if the route names a permission the grant carries; the user must still be an admin; audit via `tool <artifact>@<n>`; no CSRF/Origin check (not an ambient credential).
- Every kernel route got its permission (e.g. `PUT /api/routes` → `routes:write`, `GET …/records` → `versions:read`, `GET /api/events` → `events:read`); users, tokens, audit, projects PUT, artifact PATCH, sandbox-url, agents, comments wait and tools themselves have none.
- `pkg/server/tools.go`: `GET /api/tools` (enabled + newest manifest + `newPermissions`, and the permission descriptions), `PUT /api/tools/{id}` `{n}`, `DELETE /api/tools/{id}`, `POST /api/tools/{id}/grant` `{n, try}` (session only, `noToken`), `GET /tools/…` → Workshop; `cors()` for `/api/*` from `s<label>.<sandbox domain>` origins.
- Push refuses an invalid tool section (unknown permission → 400); a push made with a grant records `via: "tool"`; a role change revokes the user's grants.
- `pkg/render`: `ModeTool` injects `/_slop/tool.js` instead of the bridge; the sandbox accepts `mode=tool`.
- `pkg/render/assets/tool.js`: `slop.tool.ready()` sends `tool-hello` to the Workshop and resolves when a `grant` message arrives (only from the parent origin); `api.get/post/put/patch/del` (bearer grant, `credentials: 'omit'`), `api.on(type, h)` (SSE parsed from a `fetch` stream, since `EventSource` cannot send headers), `api.can(perm)`.

### Why
- **Permissions from the manifest, not the request:** an admin approves exactly what the tool asked for; the API has no way to grant more (the guide had the client send the list and the server compare — taking it from the manifest removes the comparison).
- **Grant check before the token check:** a grant on a `noToken` route (tokens, tools) must fail as "tools cannot call this" (403), not fall through to the token rules.
- **Refuse at push:** an unknown permission is a typo or an overreach; failing the push tells the agent immediately.

### What worked
- `TestToolsGrantsAndCORS`: listed with 3 new permissions; grant before enable 404; grant with an API token 401; try grant → `GET /api/routes` 200, `PUT /api/routes` 200 and the route log entry is `via: "tool board@1"`, by ramon; with the grant, `/api/threads` 403 (not granted), `/api/tokens`, `/api/users`, `/api/audit`, `PUT /api/tools/board` 403; preflight from `http://sabc.sandbox.test` → 204 with the origin, no `Allow-Credentials`; from `http://evil.test` → no CORS headers; a session PUT with `Origin: http://sabc.sandbox.test` → 403; enable → 3 permissions; disable → the open grant gets 401; enabling a plain page → 400; a role change → 401.
- `TestPushRefusesBadToolSection`: `users:write` → 400.
- All tests on SQLite and Postgres; lint 0 issues.

### What didn't work
- My test first expected 401 for a grant on `/api/tokens` (`GET /api/tokens with a grant: 403, want 401`); the guard answers 403 `grant_not_allowed` before the token rules, which is the better answer. Fixed the expectation.
- I committed once without gofmt (`pkg/server/kernel.go`), hence the separate "gofmt" commit.

### What I learned
- A preview origin and the main host may count as the same *site* in local mode (`*.localhost`), so cookies could ride along on a credentialed fetch; safety comes from the guard's Origin check for sessions and from never sending `Access-Control-Allow-Credentials`, not from SameSite.

### What was tricky to build
- The guard order: grant → token → session rules, so each credential type gets its own clear error and grants can never reach a route that did not opt in.

### What warrants a second pair of eyes
- The permission map per route (kernel.go, preview.go, stream.go): a route given a permission by mistake becomes reachable by tools.
- `tool.js` trusts only `message` events whose `origin` is the boot data's parent origin *and* whose source is `window.parent`.

### What should be done in the future
- Workshop half (next step): Tools menu, ToolScreen with the grant handshake and renewal, EnableToolDialog; the release board example; the exit check.

### Code review instructions
- `pkg/server/auth.go` (`guardPerm`), `pkg/server/tools.go`, `pkg/store/tools.go`, `pkg/render/assets/tool.js`; `go test ./pkg/server -run 'TestTools|TestPushRefuses' -v`.

### Technical details
- Grant response: `{grant: "slg_…", expiresAt, permissions, n, try, user: {id, name}}`; messages: tool → Workshop `{slop:1, type:'tool-hello', version}`, Workshop → tool `{slop:1, type:'grant', grant, expiresAt, permissions, user}` (sent again on renewal).

## Step 18: Phase 6, Workshop half and exit check — Ramon's release board as a tool

This step finishes Phase 6: the Workshop can list, try, enable, open and disable tools, and the release board from §6.13 exists as `examples/tools/board`. The exit check ran in one browser with two identities: Ramon's agent identity pushed the board, Ramon tried and enabled it on `127.0.0.1`, Manuel opened it from his Tools menu on `localhost` and shipped /pricing with it; the route log records `via: tool board@1`; the board got 403 for anything outside its grant; disabling removed it.

### Prompt Context
**User prompt (verbatim):** see Step 17
**Assistant interpretation:** Workshop side of §6.13 plus the Phase 6 exit check.
**Inferred user intent:** Ramon can ship a screen without a deploy, and Manuel can use it safely.
**Commit (code):** 2c87ccf — "SLOP-001 phase 6: tools in the Workshop, release board example"

### What I did
- `api/types.ts` (`Tool`, `ToolView`, `ToolList`, `ToolGrant`), `slopApi.ts` (`tools`, `enableTool`, `disableTool`, `grantTool`; `sandboxUrl` takes `mode: 'tool'`), `events.ts` (`tool.enabled|disabled` → `Tool`, console lines; `version.created` also refreshes `Tool`).
- `router.ts`: `/tools/<id>[?try=n]` (`toolPath`); `App.tsx` routes it to `ToolScreen`.
- `TopBar`: `ToolsButton` (count of new/updated tools) and `ToolsMenu` (enabled tools with icon, version, permissions; "New and updated" with what they add).
- `screens/ToolScreen.tsx`: chrome (tags "enabled v1" / "not enabled" / "trying v1 · only you", Try vN, Back to vN, Enable/Update…, Disable, Watch the code), `ToolFrame` (sandbox URL `mode=tool`; on `tool-hello` from its own iframe and sandbox origin → `POST /api/tools/{id}/grant` → `postMessage` grant to that exact origin; renewal every 45 min), `EnableToolDialog`.
- `runtime.js`: `slop.tool` stub that rejects with "This is a tool: open it from the Workshop’s Tools menu (/tools/<id>)." so tools don't crash in previews, thumbnails or on the site.
- Watch toolbar: "Open as tool" when the version's manifest has a tool section.
- `examples/tools/board/` (`slop.json` with `tool: {title, icon: ship, permissions: [routes:read, routes:write, versions:read, events:read]}`, `index.html`, `boutique.css`): routes per host with served vs newest version, "only routes with something to ship", Ship (PUT /routes with a note), live reload on `route.set`/`version.created` via `api.on`.

### Why
- **Grant only after `tool-hello` from the frame's own window and origin:** the Workshop never volunteers a grant to whatever is in an iframe; a tool that navigated elsewhere would not get one.
- **Disable unmounts the frame:** the enabled version is gone, so the screen shows the not-enabled state; the server has already revoked every grant (Step 17), so a copy of the tool open elsewhere fails on its next call.

### What worked
- `SLOP_VIA=agent slop push … -a board` as claude-ramon → `pushed board v1 (new artifact) · 2 files · 34 KB`.
- Ramon (127.0.0.1): Tools menu "new · board v1 · not enabled · try it" (`p6-01`); `/tools/board?try=1` renders the board "as ramon · routes:read routes:write versions:read events:read", only /pricing shippable (v5 pinned, v15 newest) (`p6-02`); Enable dialog lists the four permissions in words (`p6-03`); enabled.
- Manuel (localhost): Tools menu lists "Release board v1" (`p6-04`); Ship v15 → "/pricing now serves pricing v15." (`p6-05`); route log: `tool board@1  shipped v15 from the release board  to v15`.
- Inside the board's frame (Playwright `frame.evaluate`): `routes: ok 12 rows`, `tokens: 403 grant_not_allowed`, `users: 403 grant_not_allowed`, `threads: 403 grant_permission`, `push: 403 grant_permission`; `fetch('http://localhost:18080/api/me', {credentials: 'include'})` → `blocked: Failed to fetch` (no Allow-Credentials).
- Disable → frame removed, "not enabled" chrome with Try v1 / Enable v1… (`p6-06`). Grant revocation itself is covered by `TestToolsGrantsAndCORS` (401 after disable).

### What didn't work
- The board's preview and thumbnail on Watch threw `TypeError: Cannot read properties of undefined (reading 'ready')` (no `slop.tool` outside tool mode; `p6-01` still shows it) → the runtime stub.
- My in-frame "next call after disable" probe could not run: `frame.evaluate: Target page, context or browser has been closed` — the Workshop had already unmounted the frame. The 401 is shown by the Go test instead.
- `/api/audit` with my CLI token → an error object (the token has no `admin` scope); used the route log, which carries the same `via`.
- First ToolScreen screenshot was blank: taken before the iframe painted; the snapshot showed the board was already loaded.
- After a disable the chrome said "Nobody enabled this tool yet" — reworded to "This tool is not enabled."

### What I learned
- Running the tool's own client from the test (`frame.evaluate(() => slop.tool.ready())`) is the most direct way to check grant enforcement end to end: it exercises postMessage, CORS, the bearer and the guard together.

### What was tricky to build
- Keeping the grant handshake inside one effect keyed by the sandbox URL: the message listener, the first grant and the renewal timer must all be torn down when the version (and therefore the origin) changes.

### What warrants a second pair of eyes
- `ToolFrame` posts the grant with `targetOrigin = sb.origin` (the exact sandbox origin); `tool.js` accepts it only from `PARENT` and `window.parent`.
- Seeded agent comments now read "manuel’s agent" (fallback name) instead of "Claude Code (manuel’s)": the comment has no `via`; only a live waiter's name can say which agent it was.

### What should be done in the future
- Let pi build a second tool from AGENTS.md + tool.js docs (a real "Ramon's agent makes the board" run).
- Phase 7: hardening, Dockerfile, production doc, blob GC.

### Code review instructions
- `web/workshop/src/screens/ToolScreen.tsx`, `components/organisms/TopBar.tsx` (ToolsMenu), `examples/tools/board/index.html`, `pkg/render/assets/runtime.js`.
- Try it: `slop push examples/tools/board -a board`, then Tools → board v1 → Enable.

### Technical details
- Screenshots: `various/screenshots/p6-01…06-*.png`.

## Step 19: Phase 7 — hardening, blob GC, Dockerfile, production doc

This step makes slop deployable: a garbage collector for unreferenced blobs, the remaining security headers (HSTS, a CSP for the Workshop page), server limits, a Docker image with the Workshop embedded, and an operator's guide. The image was built from a clean checkout and run against Postgres, which caught one real bug the local builds had hidden.

### Prompt Context
**User prompt (verbatim):** see Step 9
**Assistant interpretation:** Phase 7 of the guide (§ Phase 7: rate limits, size limits, headers per host class, HSTS, blob GC, readyz/healthz, Dockerfile, production doc with wildcard TLS).
**Inferred user intent:** Be able to put slop.computer on a server.
**Commit (code):** 45c3e18 — "SLOP-001 phase 7: hardening, blob GC, Dockerfile, production doc"

### What I did
- `pkg/blobs.Collect(referenced, before, dryRun)`: walks the blob tree, removes (or lists) blobs not in `referenced` and older than `before`; `store.BlobSums` (`SELECT DISTINCT sha256 FROM version_files`); `slop db gc-blobs` (`--blobs`, `--grace 24h`, `--dry-run`, the usual `--database-url[-file]`); `blobs_test.go`.
- Headers: `Strict-Transport-Security: max-age=31536000` on every host when the public URL is https (no `includeSubDomains`: site hosts may be other people's domains); the Workshop's `index.html` gets `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src <scheme>://*.<sandbox>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'` (test added).
- `http.Server`: `IdleTimeout 2m`, `MaxHeaderBytes 64 KB` (no `WriteTimeout`: SSE and long-polls). Existing: `ReadHeaderTimeout`, per-handler body limits (JSON 4 KB–1 MB, files 25 MB), the device-authorize rate limiter from Phase 1, `/healthz`, `/readyz`.
- `Dockerfile` (node 24 + pnpm 10.15.1 → `pnpm build`; golang 1.26.10, `GOWORK=off CGO_ENABLED=0 go build -tags embed`; debian bookworm-slim, uid 10001, `/var/lib/slop`, HEALTHCHECK on `/healthz`), `.dockerignore`.
- `doc/production.md`: the three host classes, why the sandbox must be a separate registrable domain, wildcard DNS + DNS-01 certificate, Caddy config (`flush_interval -1` for streams), OIDC registration, bootstrapping the first admin, flags, Docker run, health, headers, backups/upgrades, GC, safe mode, agents.

### Why
- **Grace period in GC:** a push uploads blobs first and stores the version afterwards; without a grace a GC between the two would delete blobs the version is about to reference.
- **`'unsafe-inline'` for styles only:** React writes inline `style` attributes (device sizing, widths); scripts stay `'self'`.
- **No `WriteTimeout`:** `/api/events` and `comments wait` hold responses open for minutes.

### What worked
- `go test ./...` (SQLite) green; `make lint` 0 issues; `TestCollect`: dry run lists only the old orphan; the real run removes it and keeps the referenced and the young orphan.
- `slop db gc-blobs` against the live local server: an orphan uploaded with `PUT /api/blobs/469ffa…` → with `--grace 0s --dry-run` "would remove"; with the default grace nothing; `--grace 0s` → "removed", file gone.
- Watch under the new CSP: previews, thumbnails and SSE work; console: 0 errors, 0 warnings (`p7-01`).
- `docker build -t slop:dev .` → 128 MB image. `docker run --network host slop:dev serve --local --listen 127.0.0.1:18090 --database-url postgres://…/slop_docker` → "Applied migration migration=004_tools.sql", `/healthz` ok, `/readyz` ready; `slop dev seed` from the host → "seeded 41 versions, 10 routes on site.localhost:18090, 6 threads"; the embedded Workshop from the image works on Postgres (`p7-02`).

### What didn't work
- First image build: `vite.config.ts(9,16): error TS2591: Cannot find name 'process'`. Locally `tsc` had found `@types/node` somewhere outside the project; a clean install doesn't have it. Pinned `@types/node@24.19.2` and added `"node"` to `types`.
- My first orphan-blob attempt wrote the file to `/tmp/claude-1000/orph` (an `a || b` that never reached `b`) and `sha256sum` failed on the other path; reran with one path.
- `--output-format` is not a flag of these commands; used the default table.
- The container's HEALTHCHECK stayed "starting" in the test run because I moved the listen port off 8080 for local mode; in the default configuration it checks the right port.

### What I learned
- A clean-room build (the Dockerfile) is the only reliable check that the frontend's dependencies are declared; worth running in CI.

### What was tricky to build
- Local mode inside a container: it must listen on loopback, so the test used `--network host`; production uses OIDC and `0.0.0.0`.

### What warrants a second pair of eyes
- HSTS without `includeSubDomains` and the CSP's `frame-src` wildcard; both are in `pkg/server/server.go` / `workshop.go`.
- GC runs against a live database: it only removes blobs older than the grace that no version references at the moment it reads `version_files`.

### What should be done in the future
- CI: build the Docker image (it would have caught the `@types/node` gap).
- Phase 0 leftover: deploy/compose with Postgres + ZITADEL, now that the image exists.
- Phase 8 (optional): MCP tools.

### Code review instructions
- `pkg/blobs/blobs.go` (`Collect`), `cmd/slop/cmds/db.go` (`gcBlobsCmd`), `pkg/server/workshop.go` (`workshopCSP`), `Dockerfile`, `doc/production.md`.
- `docker build -t slop:dev . && docker run --rm --network host slop:dev serve --local --listen 127.0.0.1:18090`.

### Technical details
- Image layers: node:24-bookworm-slim (web), golang:1.26.10 (server), debian:bookworm-slim (runtime, ca-certificates + curl).
