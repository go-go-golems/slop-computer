---
Title: Diary
Ticket: SLOP3-021
Status: active
Topics:
    - build
    - actor
    - ops
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-15T18:30:48.609904436-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

SLOP3-021 collects the small follow-ups left by SLOP3-016, SLOP3-018 and SLOP3-020: the FTS5 build tag, file content types the image did not know, removing the direct actor runtime, the francois import runbook, and two staging settings.

## Step 1: Staging settings, then the code follow-ups (one branch)

This step changed two staging settings by hand and made the code follow-ups on branch `task/slop3-021-followups` (from origin/main `97c4458`) in three commits: `1f667d0` (FTS5 tag and content types), `377586c` (direct runtime removed) and `39ccd28` (runbook). The full suite passes with `-tags sqlite_fts5`, and lint reports 0 issues.

### Prompt Context

**User prompt (verbatim):** "check codex, merge #44. yes model access for @member on staging. remove catalog-mcp. do all the small items basically."

**Assistant interpretation:** Merge the MathML PR after a clean Codex review. On staging, give `@member` LLM access and delete the leftover `catalog-mcp` store. Then do the open small items from the recent diaries: the FTS5 build tag, the font content type, removing `directHost`, the `--catalog` runbook, the GitOps bumps and cleaning up worktrees.

**Inferred user intent:** Clear the backlog of small, already-decided items in one pass so staging and main are tidy before the next feature.

### What I did

- **Staging, by hand** (logs in the session scratchpad, `small/00-staging-before.log` and `small/01-staging-llm-catalog-mcp.log`):
  - `slop llm set --subject @member --value on --budget 2000000`. Before this, only `@admin` was listed. The budget is in tokens per person per month.
  - `slop store rm --id catalog-mcp`. It had no mounts and one `@guest view` grant. It is deleted, and a second `store` lookup answers `not_found`.
- **Content types** (`pkg/store/files.go`): `TypeOf` checks a `fileTypes` map before `mime.TypeByExtension`. The map covers woff2, woff, ttf, otf, ico, txt, csv, mp4, webm, mp3, ogg, wav and zip, plus the existing js, mjs, json, md, sql and wasm. `TestTypeOfWithoutMimeTypes` is in `pkg/store/build_test.go`.
- **FTS5:** `-tags sqlite_fts5` was added to the Dockerfile's build, the Makefile (`TAGS := sqlite_fts5` for test, build and run-local), CI's `test_command`, `AGENT.md` and `doc/building-apps.md`. `TestSQLiteHasFTS5` creates an fts5 table and runs a `MATCH`.
- **Direct runtime removed** (SLOP3-016 task `vgrz`):
  - `directHost`, `RuntimeDirect`, `Manager.Runtime` and `Actor.Runtime()` are gone, and `newHost` always makes an engine host.
  - `config.Load` accepts `actors.runtime: engine` or nothing. `direct` fails with "direct was removed (SLOP3-021)".
  - The tests that looped over both runtimes now run once.
  - `SLOP_TEST_ACTORS_RUNTIME`, `make test-engine` and CI's direct pass are gone.
  - `TestActorRuntimeDefault` became `TestActorRuntimeDirectRemoved`.
- **Runbook:** `doc/production.md` gained "Importing francois releases": inventory, a dry run with `--catalog`, an apply with `--catalog`, then verify.

### Why

- The image is Debian slim without `/etc/mime.types`. Go's `mime` package then knows only a built-in handful of types, so the catalog kit's `ibm-plex-mono-latin-500-normal.woff2` went out as `application/octet-stream` with `nosniff`.
- SLOP3-018's sqlpolicy allows fts5 tables in app migrations. Without the tag, such a migration fails on the server. Under the tag it is caught at test time.
- The design kept `direct` for one release after #40 made engine the default. Staging runs `sha-8b15c8b`, which includes #40, and its configmap sets no runtime.

### What worked

- `TestSQLiteHasFTS5` fails without the tag ("SQLite was built without FTS5 …") and passes with it.
- `GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./... -count=1`: every package passes, `pkg/host` in 19.1 s.
- `golangci-lint run --build-tags sqlite_fts5`: 0 issues.

### What didn't work

- Removing the loops left unused imports one at a time, so vet had to run four times: `"fmt" imported and not used` in `enginehost.go`, then `pkg/config` in `actor_bench_test.go`, then `pkg/actor` and `pkg/config` in `bridged_modules_test.go`. I fixed them one by one.

### What I learned

- `make lint` does not need the tag. `sqlite_fts5` changes only go-sqlite3's C build, so the Go code type-checks the same with or without it.

### What was tricky

- **Rewriting the test loops by script.** The loops used the pattern `for _, rt := range … { t.Run(rt, func…) { … }) }`. The script removed the loop and the `t.Run` line, dedented the body by two tabs, and replaced the per-runtime harness with `newHarness(t)`. The leftover uses of `rt` (the bench's `t.Logf` lines and one `a.Runtime() != rt` check) had to be removed by hand.

### Second pair of eyes

- `config.Load` now rejects any value but `engine`. Check that no deployed `slop.yaml` sets `actors.runtime: direct`. Staging's configmap sets none, and production has not been checked.
- `fileTypes` takes precedence over `mime.TypeByExtension` for every extension in the map, so the host's mime.types can no longer change these types.

### Future

- After the image is built: merge the slop-yolo GitOps PR, and re-push the catalog kit so that woff2 files are stored with `font/woff2`.

### Code review

- `pkg/actor/enginehost.go` `newHost`; `pkg/config/config.go` `Load`; `pkg/store/files.go` `TypeOf`; `pkg/store/build_test.go`.

### Technical details

```sh
GOWORK=off go test -buildvcs=false -tags sqlite_fts5 ./... -count=1
GOWORK=off go test -buildvcs=false ./pkg/store -run TestSQLiteHasFTS5   # fails: built without FTS5
GOWORK=off golangci-lint run --build-tags sqlite_fts5
```
