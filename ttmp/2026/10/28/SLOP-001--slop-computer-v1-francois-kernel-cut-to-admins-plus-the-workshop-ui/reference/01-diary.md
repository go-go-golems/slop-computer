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
RelatedFiles: []
ExternalSources: []
Summary: "Chronological implementation diary for SLOP-001: analysis, design revisions with the owner, and phase-by-phase implementation of slop.computer v1."
LastUpdated: 2026-10-28T16:30:00-04:00
WhatFor: "Tracing how the v1 design was derived and how each phase was implemented and validated."
WhenToUse: "When resuming SLOP-001, reviewing a commit, or questioning a decision in the design doc."
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
