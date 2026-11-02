---
Title: Diary
Ticket: SLOP3-004
Status: active
Topics:
    - deployment
    - auth
    - architecture
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://Dockerfile
      Note: cgo build for SQLite
    - Path: repo://doc/production.md
      Note: v3 production, ZITADEL, Kubernetes, cutover
    - Path: repo://pkg/server/auth.go
      Note: signIn keeps the ID token; logout ends the ZITADEL session
    - Path: repo://pkg/server/server.go
      Note: /readyz on the pod address
ExternalSources: []
Summary: 'Moving slop v3 into slop-computer as a hard cutover: v2 removed, v3 merged with its history, CI/CD and production config adapted, ZITADEL logout and probes fixed, GitOps drafted.'
LastUpdated: 2026-11-01T19:49:51.993409239-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Two PRs for a hard cutover, and what ZITADEL needed

slop v3 had only ever lived in a local repository with no remote:
71 commits on `main`, module `github.com/go-go-golems/slop`, a GitHub repo
that does not exist. The user asked for it to land in slop-computer, as a
separate PR that deletes v2 first and then one PR with the whole of v3,
keeping slop-computer's CI/CD, and then asked that it work with ZITADEL
"and all that". The result is three PRs:

- slop-computer #12, which removes v2;
- slop-computer #13, v3 stacked on #12, carrying its full history, the
  adapted CI/CD, the production doc, and the ZITADEL logout and probe fixes;
- a draft GitOps PR (wesen/2026-03-27--hetzner-k3s #406) that runs v3 once
  its image exists.

Checking v3 against the v2 deployment found two production blockers, both
fixed in #13:

- **Probes:** `/readyz` answered 421 on the pod address, which the
  deployment probes, so the pod would never have become ready.
- **Logout:** signing out did not end ZITADEL's session.

### Prompt Context

**User prompts (verbatim), in order:**

- "so  when do we open our big PR though? with v3?"
- "can we PR slop-computer-v3 into slop-computer, merging the two repos basically?"
- "deleting v2 is fine. make maybe a separate PR for deleting v2 first, and then you can do a PR with the full app at once for a hard cutover. don't worry about tokens except the lunaroute one."
- "well we want to keep CICD and all that setup from slop-computer v2"
- "make sure it integrates with zitadel and all that?"

**Assistant interpretation:** Bring v3 into slop-computer in two PRs that
delete v2 and then add v3. Keep `publish-image.yaml` and adapt the
Dockerfile and Makefile. Make sure sign-in, logout, probes and the
deployment work in production. Before publishing v3's history, scan it for
the lunaroute token.

**Inferred user intent:** One repository, deployable by the existing
pipeline, with no surprises at cutover.

### What I did

- **Lunaroute token.** Scanned the history of v3 that was about to be
  published (`git log --all -p`) with long values masked. No credentials
  were found and no credential files are committed. v3 reads Pi's agent
  directory at runtime (`pkg/llm/gepp/backend.go`); the only `apiKey` is
  the test's `"test-key"`.
- **#12 (`task/remove-v2`).**
  - Deleted: `cmd/`, `pkg/`, `go.mod`/`go.sum`, `examples/`, `scripts/`,
    `web/{workshop,runtime,piworker,rt-conformance,examples}`,
    `web/pinup/slop` (377 files).
  - Kept: `.github/`, `Dockerfile`, `.dockerignore`, `Makefile`,
    golangci config, `AGENT.md`, `doc/`, `ttmp/`, `web/blocks`,
    `web/pinup`.
- **#13 (`task/slop-v3`).**
  - `git fetch <v3> main` then `git merge --allow-unrelated-histories`.
    Conflicts were only in `.gitignore` and `ttmp/vocabulary.yaml`, both
    resolved as a union.
  - Module renamed to `github.com/go-go-golems/slop-computer` (74 files).
  - Merged `origin/task/blocks-deep-links` (#11).
  - Dockerfile: cgo, `golang:1.26.10-bookworm` → `debian:bookworm-slim`.
  - `.dockerignore`.
  - Makefile: v3 targets, `blocks`, `pinup`.
  - `web/blocks/app.json` replaces `slop.json`.
  - `web/pinup/build-app.sh` and `app.json`; both builds are byte-identical
    to the SLOP3-001 deploy build.
  - New README; the old one moved to `design/WORKSPACE.md`.
  - `doc/production.md` rewritten.
- **ZITADEL review.**
  - `pkg/identity/oidc.go` is v2's port: PKCE, lazy discovery, the
    userinfo fallback.
  - `pkg/server/oidc.go` is new code: flow binding, nonce, verified email.
  - Missing: RP-initiated logout. Added migration
    `006_session_id_token.sql`, `SetSessionIDToken`/`SessionIDToken`, the
    ID token passed through `signIn`, and `/auth/logout` redirecting to
    `LogoutURL`.
- **Probes.** The GitOps Deployment probes `/readyz` on the pod address;
  v3 only answered `/healthz` there. Moved `/readyz` into `s.ready` and
  answered it in the unknown-host branch.
- **Lint.** golangci-lint found 33 issues. Three were fixed:
  - the shadowed `err` in `files.cat` at a snapshot (a real bug: 500
    instead of 404);
  - the nil `env` in `server.New`;
  - the unchecked `m.Fire`.
- **GitOps (draft #406).** Worktree `slop/v3-cutover` from `origin/main`;
  the local checkout was left alone.
  - `configmap.yaml` with `slop.yaml`.
  - Deployment args, mounts and image TODO.
  - README.

### Why

- **History kept as is.** The SLOP3 diaries cite v3 commit hashes, and an
  unrelated-history merge keeps them. A `filter-repo` into a subdirectory
  would not.
- **Data under `/var/lib/slop/v3`.** v2's blobs at `/var/lib/slop/blobs`
  and its Postgres database stay untouched. A rollback is reverting the
  GitOps commit.
- **The org id literally in the ConfigMap.** v3's scope is a config value
  with no env substitution. The id is not secret: production's public
  authorize redirect carries it.

### What worked

- `go vet ./...`, `go test ./...` and the runtime tests (3/3) pass.
- Docker image: builds, starts, and `/healthz` and `/readyz` answer on the
  container address.
- Negative controls:
  - Without the ID token, `TestOIDCSignIn` fails with `logout: 303 /`.
  - Without the probe change, `TestProbesOnAnyHost` fails with
    `/readyz on the pod address: 421`.
  - Without the `files.cat` fix, `TestEvalProgram` fails with
    `missing file at snapshot 1: 500 map[error:map[code:internal message:invalid sha256]]`.
- **The image with the GitOps `slop.yaml`** (`scratchpad/zcheck/check.sh`):
  - `/auth/login` → `https://auth.slop.boutique/oauth/v2/authorize`, with
    `redirect_uri=https://slop.yolo.scapegoat.dev/auth/callback`,
    `scope=openid profile email urn:zitadel:iam:org:id:394966170567966836`
    and S256;
  - the cookie is `__Host-slop_flow ... HttpOnly; Secure; SameSite=Lax`.
  - The redirect is the same as production's current one, read from
    `curl -w '%{redirect_url}' https://slop.yolo.scapegoat.dev/auth/login`.
- `kubectl kustomize gitops/kustomize/slop` builds.

### What didn't work

- **The first image smoke test** showed `readyz 421` for
  `curl http://127.0.0.1:18399/readyz`. That led to the probe fix.
- **One unexplained `pkg/server` failure.** It happened during
  `go test ./pkg/server ./pkg/actor ./pkg/verbs` (`FAIL ... 4.687s`), and
  its output was not captured. It then passed 3 times, 10 times
  (`-count=10`), and in 12 full-suite runs (6 at `-cpu=1`).
- **Unused-variable compile error in the first negative control:**
  `pkg/server/oidc.go:106:6: declared and not used: idToken`. Rewrote the
  control as `"" + idToken[:0]`.

### What I learned

- v3's `slop docs` has no `data/users/me` substitution (v2's `slop data`
  had one), so the Blocks README no longer promises the agent loop on v3.
- v3 needs no Vault entry for its HMAC key: without `secret_key_file` it
  writes `data/secret.key` once.

### What was tricky to build

- **Stacking around #11.** #13 had to change `web/blocks/build.sh`, which
  #11 also changes. Merging #11's branch into #13 avoids a conflict
  whichever merges first.
- **The ignore leftovers.** v2's `.gitignore` hid `pkg/web/`,
  `web/examples/*/.slop`, `web/rt-conformance/*/.slop` and
  `web/pinup/slop/tests/out`. After the merge they showed up as untracked;
  I removed them from the worktree (build output and v2 push state).

### What warrants a second pair of eyes

- **`admin_emails` in the GitOps ConfigMap** is the user's address. It must
  be their ZITADEL login, or nobody can approve sign-ups.
- **Live-host "Sign out"** still only drops the live session. The main
  session, and with it ZITADEL's, stays until the person signs out on the
  main host.
- **No HSTS in v3.** v2 sent it on HTTPS; the proxy may already add it.

### What should be done in the future

- **The 30 remaining golangci-lint findings:** errcheck on `Close`, named
  returns, De Morgan, two unused symbols.
- **After the cutover,** push Blocks, Pinup and the apps, and remove v2's
  Postgres bootstrap and `database-url`.
- **An FTS5 build tag** (`sqlite_fts5`) once an app migration uses FTS5.

### Code review instructions

- **#13:**
  - `pkg/server/auth.go` (`signIn`, `logout`), `pkg/server/oidc.go`,
    `pkg/system/sessions.go`, `pkg/system/migrations/006_session_id_token.sql`;
  - `pkg/server/server.go` (`ready`);
  - `pkg/verbs/files.go`;
  - `Dockerfile`, `Makefile`, `doc/production.md`.
- **Tests:** `GOWORK=off go test ./pkg/server -run 'TestOIDCSignIn|TestProbesOnAnyHost|TestEvalProgram' -count=1`.
- **GitOps #406:** `configmap.yaml`, `deployment.yaml`.

### Technical details

- **Commits on `task/slop-v3`:**
  - `5712c5e` merge;
  - `75d641d` module rename;
  - `8207646` merge of #11;
  - `af550e7` CI/CD and docs;
  - `7d280c2` ZITADEL logout and probes;
  - `7753876` `files.cat`;
  - `621db35` the doc's Vault path.
- **Other commits:** `73c4c11` on `task/remove-v2`; `fa7c596` on GitOps
  `slop/v3-cutover`.

## Step 2: Codex's review of #13, the "conflict", and a CI failure

The user merged #12, which retargeted #13 to `main`, and asked about the
review comments and the conflicts. GitHub's "conflicting" status was an
artifact of the history: `main` held only commits that #13 already
contained. A no-op merge commit settled it.

Codex raised five findings, and all held:
- views kept their old level after a downgrade;
- catch-up could skip a commit;
- member files ran on the live host's origin;
- the runtime's resume cursor moved too early;
- a collection's first snapshot could delete a streamed creation.

CI also failed once, on a real race in the actor lifecycle (a call queued
just as its actor stopped). Each fix has a test that fails without it.

### Prompt Context

**User prompts (verbatim):**

- "Look at code review comments https://github.com/go-go-golems/slop-computer/pull/13 and also those conflicts?"
- "More code review comments if you haven't seen them: https://github.com/go-go-golems/slop-computer/pull/13

  Then retrigger @codex review to start a new review"

**Assistant interpretation:** Make #13 mergeable again. Verify each review
finding, then fix it and reply, or explain why it does not hold. Ask Codex
for a fresh review.

**Inferred user intent:** Merge #13 with the reviewer's concerns settled.

### What I did

- **Conflict.** `origin/main` = `39ae926`: merges of #11 (`4e23e3c`) and
  #12 (`73c4c11`), both already in `task/slop-v3`.
  - `git merge --no-commit origin/main` was clean with an empty diff.
  - Committed it as `4538c21`; GitHub then reported `MERGEABLE`.
- **P1, view downgrades** (`live.go` `reviewViews`). A level change only
  sent an `access` event, while `v.Level` (fixed at open) kept authorizing
  `db.write`, and renewal did not recheck.
  - New `recheck`: a view whose level or audience differs is revoked when
    no level is left, otherwise closed after the event.
  - Renewal calls `recheck` (404 → the shell reopens).
  - `notified` removed.
  - The SLOP3-001 guide (line 1155) and `transport.ts` already described
    closing.
- **P2, catch-up cursor** (`views.go`): `catchUp` reads `st.Head()`
  before `DocsSince`. `Head()` is `max(rev)` of committed `_log` rows.
- **CI failure**: `TestModuleTrust` (`w1_test.go:47`) failed with
  `actor.call ...: 500 ... lost: the actor stopped`.
  - Cause: the call queued just as the actor's `stop` closed, after a
    version activated right after the push.
  - `errStopped` now marks events that never ran (refused by `send`, or
    drained without a parent); `Call` and `Serve` resend them up to twice
    via `Get`.
  - Continuations (`ev.parent`) still fail with `lost`.
  - Probably also the unexplained local failure from step 1.
- **P1, live-host files** (`site.go` `serveStoreFile`). New `isolate`
  argument, true only on the live host: CSP `sandbox; default-src 'none'`,
  and an attachment for non-media.
- **P2 × 2, runtime** (`db.ts`):
  - `register` no longer calls `seenRev`.
  - A per-listener `streamed` set keeps entries that the stream changed
    while `db.subscribe` was out.
  - `test/db.test.ts` mocks `transport.ts` with
    `--experimental-test-module-mocks`, now in the `test` script.
- **Replies and re-review.** Replied on each thread with the fixing commit,
  then commented `@codex review` for `1b71424`.

### Why

- **Close views rather than lower their level in place.** `v.Level`,
  `v.Role` and `v.Policy` are read without locks across handlers, so
  changing them in place would race. The shell already reopens on
  `access`.
- **Resend only events that never ran.** That keeps actions at-most-once.

### What worked

- **Each fix's test failed on the old code:**
  - `TestDowngradeClosesView`: `write through the downgraded view: 200`.
  - `TestCallsSurviveActorRestart`: `a call queued when the actor stopped:
    actor_error: the actor stopped` (twice in 3 runs).
  - `TestLiveStoreFilesIsolated`: `live /_s/pub/assets/up.html: 200
    text/html; charset=utf-8, csp "", disposition ""`.
  - `db.test.ts`: `actual: [], expected: [ 'n1' ]`, and the cursor moved
    to 9.
- `go vet ./...`, `go test ./...` and the runtime tests (5/5) pass.

### What didn't work

- **`TestShareLinks` failed after the P1 change:**
  `view with @guest view left: map[error:map[code:revoked ...]]`. It
  asserted the old rule (a level change keeps the view open). Updated it:
  the interact view stops writing once the link is revoked, and a new view
  opens at `view`.
- **The first restart test hit the turn limit** (`turn took longer than
  5s`): the harness's virtual clock does not move `Date.now()`. It now
  spins by counting, calibrated to about 400 ms.
- **`toolApp` with no modules** writes `"modules":[""]`
  (`busy has no actor`), so the test pushes its app directly.

### What I learned

- `gh run view --log` returned nothing for that job;
  `gh api repos/.../actions/jobs/<id>/logs` had the log.

### What was tricky to build

- **Retry safety.** `drain()` also fails continuation events, which belong
  to an action that already ran up to an `await`. Only parentless queued
  events may be resent.

### What warrants a second pair of eyes

- **Closing views on audience changes too.** Anything that recomputes a
  different audience than the view's open did will now close views on
  every review, where before it re-sent an `access` event. Equally noisy,
  but more visible.
- **No deterministic test for the catch-up race.** The fix rests on
  `Head()` reading committed state.

### What should be done in the future

- Retire actors on idle with a close and drain, so an event queued in that
  window cannot wait until `CallTimeout`.

### Code review instructions

- `pkg/server/live.go` (`recheck`, `reviewViews`, renew),
  `pkg/server/views.go` (`catchUp`), `pkg/server/site.go`
  (`serveStoreFile`), `pkg/actor/actor.go` and `manager.go`
  (`errStopped`, `Call`, `Serve`), `web/runtime/src/db.ts`.
- **Tests:** `GOWORK=off go test ./pkg/server -run 'TestDowngradeClosesView|TestShareLinks|TestCallsSurviveActorRestart|TestLiveStoreFilesIsolated' -count=1`
  and `cd web/runtime && pnpm test`.

### Technical details

- **Commits:** `4538c21` (merge of main), `ac0b5a9` (views, catch-up),
  `1d47c2e` (actors), `50de31d` (live files), `1b71424` (runtime).
- **Codex review threads:** `4438074257`, `4438074260`, `4438227643`,
  `4438227647`, `4438227649`.

## Step 3: Codex's second review (three more findings)

The re-review of `1b71424` finished with CI green (run 41374232349) and
raised three new findings. All held, and each is fixed with a test that
fails on the old code. A third review was requested afterwards.

### Prompt Context

**User prompt (verbatim):** see step 2 ("More code review comments ...
Then retrigger @codex review").

**Assistant interpretation:** Same as step 2, for the new findings.

**Inferred user intent:** Merge #13 with no open findings.

### What I did

- **D9 through imports** (`pkg/verbs/data.go` `import.folder`). A member's
  bundle restored `app.json` and `actor.js` and snapshotted them onto
  `main`, skipping `needCodeRight`. A non-admin bundle whose tree holds
  `app.json` is now refused (`permission_denied`). The check is extended
  in `TestOnlyAdminsPushAppCode`; without it: `want permission_denied, got
  200 ... store:bobs-app`.
- **Read rules before the limit** (`queryDocs` for `docs.ls` and
  `docs.query`, and `rpcSlopRead` `query`). `Store.Query` applied the
  limit before the read rules.
  - Now the query is validated, then run without its limit; unreadable
    documents are dropped, then the result is cut to the limit.
  - `TestQueryLimitAfterReadRules`: without the fix, `docs.query limit 1
    as a member: []`.
  - `rpcSlopRead` has the same change, without its own test.
- **Network retries** (`web/runtime/src/transport.ts` `rpc`). A fetch that
  threw was resent for every method, so an action could run twice. Only
  the methods in `resendable` (reads, subscriptions, room membership and
  presence) are resent now. The 401-and-renew resend stays for all,
  since the server refused those requests.
  - `test/transport.test.ts` stubs `document`/`window`, hands the module a
    view through a `message` event, and scripts `fetch`.
  - On the old code, an action that failed once was resent and resolved.

### What warrants a second pair of eyes

- **Methods outside `resendable`** now fail as `unavailable` on one
  network error, where they used to get a second try. Pages that call
  `slop.call` or `db.write` must handle that, as they always had to for a
  second failure.
- **The bundle check covers `app.json` in the tree only**, as
  `needCodeRight` does. A bundle's `schema` (tables, triggers) goes through
  `Restore` as before.

### Code review instructions

- `pkg/verbs/data.go`, `pkg/verbs/docs.go`, `pkg/server/actors.go`,
  `web/runtime/src/transport.ts`.
- **Tests:** `GOWORK=off go test ./pkg/server -run 'TestOnlyAdminsPushAppCode|TestQueryLimitAfterReadRules' -count=1`
  and `cd web/runtime && pnpm test` (7 tests).
