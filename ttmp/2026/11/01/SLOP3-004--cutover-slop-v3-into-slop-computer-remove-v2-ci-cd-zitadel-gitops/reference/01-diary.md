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
