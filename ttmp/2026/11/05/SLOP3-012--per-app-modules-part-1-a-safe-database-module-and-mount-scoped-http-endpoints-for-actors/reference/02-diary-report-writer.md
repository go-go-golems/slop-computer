---
Title: "Diary: report writer"
Ticket: SLOP3-012
Status: active
Topics:
    - goja
    - apps
    - architecture
    - security
    - routing
    - hosting
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "The report-writer subagent's own record: writing the vault deep-dive report on PR #31 (SLOP3-012 part 1)."
LastUpdated: 2026-11-05T21:40:00-05:00
WhatFor: "Retracing how the PR #31 vault report was researched, verified, written and published."
WhenToUse: "When reviewing the vault report or checking which claims were verified against the branch."
---

# Diary: report writer

## Goal

This is the separate diary of the subagent that wrote the Obsidian vault report on PR #31 (SLOP3-012 part 1: the `database` module, the `express` route builder, mount API policies and host middlewares). The parent session keeps `01-diary.md`; this file records only the report writer's work: what it read, what it checked against the branch, what it wrote, and how it committed and pushed the vault.

## Step 1: Orientation and reading

The parent session asked for a textbook-style deep-dive report on PR #31 for the go-go-parc vault, with a separate diary for this subagent. I loaded the four skills it named, listed the PR's commits and files, and read the implementation diary in full, the intern guide's design sections, and every implementation file the brief listed.

The PR is open (`state: OPEN`, head `cf99f05`), ten commits over `origin/main` `ecb5df9`: four code commits (one per phase, plus a phase-4 follow-up for token scopes) and diary commits. 34 files change, 3,036 lines added and 85 removed; 27 of those files are Go.

### Prompt Context
**User prompt (verbatim):** "write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill). Commit and push the bsidian vault when done (go-go-parc vault)."
**Assistant interpretation:** Write a foundation-first, analogy-free deep-dive note on PR #31's implementation at the exact vault path the parent gave, verify every code claim against the branch, then commit only that note in the vault and push.
**Inferred user intent:** A durable, readable explanation of how part 1 of per-app modules was actually built, complementing the SLOP3-011 research report rather than repeating it.

### What I did
- Loaded skills `pr-deep-dive-report`, `textbook-authoring`, `obsidian-vault-writing`, `diary` (and read `diary/references/investigation-entry.md`).
- In the worktree `…/scratchpad/slop012`: `git log --oneline origin/main..HEAD`, `git diff --stat origin/main..HEAD`, `git status --short` (clean), `git rev-parse HEAD` (`cf99f05`), `gh pr view 31 -R go-go-golems/slop-computer --json state,title,url,additions,deletions,headRefOid`.
- Read `reference/01-diary.md` in full (475 lines, Steps 1–6).
- Read the intern guide's outline and §§2, 4.2, 17, 21–22, 24.2–24.3, 25–26, 30.
- Read in full: `pkg/actor/database.go`, `express.go`, `express.js`, `routes.go`, `pkg/registry/api.go`, `routes.go`, `pkg/doors/pages/apichain.go`, `ratelimit.go`, `cors.go`, `apitoken.go`, the migration `011_mount_api.sql`; the diffs of `pkg/actor/actor.go`, `manager.go`, `modules.go`, `pkg/registry/mounts.go`, `pkg/store/sqlpolicy.go`, `pkg/sysdb/records.go`, `pkg/commands/{commands,env,mounts}.go`, `pkg/doors/pages/{actors,door}.go`, `doc/design/slop-v3.md`.
- Read the tests `pkg/host/mount_api_test.go`, `mount_api_middleware_test.go`, the start of `database_module_test.go` and `express_module_test.go`, `pkg/registry/api_test.go` (`TestCovers`, `TestFloorOf`), `pkg/doors/pages/ratelimit_test.go`, and the `site.do` helper in `pkg/host/harness_test.go`.
- Read the SLOP3-011 vault report's frontmatter, opening and outline (12,338 words) for tone and to avoid repeating it; confirmed the Tools-as-Apps report exists at `Projects/2026/11/01/`.

### Why
- The implementation diary is the narrative source, but the brief requires every code claim to be checked against the branch, so I read the code rather than relying on the diary's summaries.

### What worked
- All listed files exist on the branch; the worktree was clean before and after reading.

### What didn't work
- `G=ttmp/2026/11/05/SLOP3-012*/design-doc/01-*.md; grep -n '^#' $G` failed with `ugrep: warning: ttmp/2026/11/05/SLOP3-012*/design-doc/01-*.md: No such file or directory` because zsh does not glob in an assignment. Fixed with `G=$(ls …)`.

### What I learned
- The journal app in `apps/examples/journal/actor.js` is not changed by the PR; the "rewritten journal" of the guide's §30 is a design example. The report must label it as such.

### What was tricky to build
- N/A (reading step).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Verify the specific claims the report will make (Step 2).

### Code review instructions
- `cd <worktree> && git diff --stat origin/main..HEAD`.

### Technical details
- Commits: `106e72e` phase 1, `58285cd` phase 2, `cb48952` phase 3, `a5f66cc` + `1b4cdcc` phase 4, diary commits `1ea96b3`, `ce3beb2`, `c1bf89b`, `02bea7f`, `cf99f05`.

## Step 2: Verifying the claims against the branch

Before writing, I checked the claims the report would rest on: I ran the PR's tests to quote real output, ran one scratch program against the branch's `registry` package to confirm a floor-resolution edge case, and compared the implementation diary's statements with the code and tests. Two statements in the implementation diary are inaccurate (one materially for the reader of the test, one an off-by-one line number), and one test property changed between phases without the diary noting it.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Verify every code claim before stating it.
**Inferred user intent:** A report a reviewer can trust line by line.

### What I did
- `cd <worktree> && GOWORK=off go test ./pkg/host/ -run 'TestDatabaseModule|TestExpressModule|TestMountAPIPolicy|TestMountAPIMiddleware' -count=1 -v` — all four `PASS`, `ok github.com/go-go-golems/slop-computer/pkg/host 0.198s`; `TestExpressModule` logs the four load-error messages.
- `GOWORK=off go test ./pkg/registry/ ./pkg/doors/pages/ ./pkg/store/ -run 'TestValidRouteKey|TestCovers|TestMatchPattern|TestFloorOf|TestValidateAPI|TestRateLimiter|TestAppSQLAuthorizer' -count=1 -v` — all `PASS`.
- Scratch program `…/scratchpad/floorcheck/main.go` (module with `replace` to the worktree, `go.sum` copied) calling `registry.FloorOf` and `registry.Covers`.
- Checked `Manager.Restart`/`RestartApp`/`Broken` (`pkg/actor/manager.go:250-279`), `sitePrincipal`/`crossOrigin` (`pkg/doors/pages/live.go:82-102, 145-151`), `VisitorOf` scopes (`manager.go:338-340`), `Principal.HasScope` (`pkg/access/principal.go:97-109`), the minute ticker that calls `Pages.Tick` (`pkg/host/host.go:239-247`), `ctxObject` accessors (`pkg/actor/actor.go:567-574`).
- `git show cb48952:pkg/host/mount_api_test.go | grep -n '0123\|"ok"'` and `git show 106e72e:pkg/store/sqlpolicy.go | grep -n 'a2 == ""'`.

### Why
- The brief asks for real test output and path:line references from the branch, and for any wrong claim in the implementation diary.

### What worked
- Every test the diary names passes at `cf99f05`.
- Confirmed by code: restarts clear both failure records (`Restart` deletes `m.broken[id]` and calls `m.K.ClearFailure(id)`; `RestartApp` does neither); the read-scope check sits in `apiTokenStep` (`pkg/doors/pages/apitoken.go:41-50`); `VisitorOf` copies scopes only for modules.

### What didn't work
- First scratch run: `go: module …/slop012 requires go >= 1.26.6 (running go 1.26.0)` because my scratch `go.mod` said `go 1.26`. Setting `go 1.26.6` fixed it (toolchain switch).

### What I learned
- **Diary inaccuracy 1 (Step 5):** "an 11-byte JSON body against a 10-byte limit gives 413". The test sends the string `"0123456789abc"`, which `site.do` JSON-encodes (`pkg/host/harness_test.go:217-219`), so the body is 15 bytes (13 characters plus quotes). The 4-byte figure for `"ok"` is right.
- **Diary inaccuracy 2 (Step 3, minor):** the `a2 == ""` pragma check is at `pkg/store/sqlpolicy.go:124` on the branch (and in `106e72e`), not `:123`; line 123 is the `case sqlite3.SQLITE_PRAGMA:` line.
- **Unnoted change between phases:** at phase 3 the API mount's 413 in `TestMountAPIPolicy` came from `serveActorRoute`'s read (`LimitReader(limit+1)`). Since phase 4, the request carries a `Content-Length` (it is built from a `bytes.Reader`), so `maxBodyStep` refuses it first. At HEAD no test exercises the read-based 413 on an API mount (a chunked body without `Content-Length`); the plain-mount 1 MiB case still exercises the read path.
- **Floor edge case (by design, tested, but surprising):** with floors `GET /api/*` min `admin` and `GET /api/members` audience `subscriber`, the scratch program printed `FloorOf(GET /api/members) = {Route:GET /api/members Min:view Audience:subscriber}`. The most specific floor wins whole, and an audience-only floor takes `DefaultMin`, not the broader floor's `admin`. `TestFloorOf` encodes the audience-only → default behaviour (`api_test.go:98`).

### What was tricky to build
- Keeping the worktree unmodified while testing a library edge case: a test file in the worktree was not allowed, so I used a separate module with a `replace` directive in the scratchpad.

### What warrants a second pair of eyes
- The floor edge case above: an admin who writes a broad `min: admin` floor and a narrower audience-only floor lowers that route to `view`.
- No test covers a chunked over-limit body on an API mount.

### What should be done in the future
- Correct the two diary statements (parent session's decision).

### Code review instructions
- Re-run the two `go test` commands above; read `pkg/registry/api.go:335-353` (`FloorOf`).

### Technical details
```text
FloorOf(GET /api/members) = {Route:GET /api/members Min:view Audience:subscriber}
FloorOf(GET /api/other)   = {Route:GET /api/* Min:admin Audience:}
Covers(GET /api/:x, GET /api/*) = false
```

## Step 3: Writing the report

I wrote the note at the exact path the parent gave, in eight chapters ordered foundation-first: vocabulary and one running example traced through the code, then each module, the policy, the request path, the middlewares, testing, and lessons. After writing, I re-checked every cited `path:line` range against the branch and fixed four that were off by a few lines, and I removed semicolons from the mermaid sequence diagram, where mermaid treats `;` as a statement separator.

The note has 10,525 words (`wc -w`), three mermaid diagrams (request sequence on an API mount with the chain, the savepoint state machine, load-time vs dispatch-time enforcement), one formula block (token-bucket rate), and a closing section listing the implementation diary's inaccuracies.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Textbook style, no analogies, real code with path:line, mermaid where it helps; do not repeat SLOP3-011's research chapters.
**Inferred user intent:** A report that teaches the implementation to a Go reader new to this code.

### What I did
- Wrote `/home/manuel/code/wesen/go-go-golems/go-go-parc/Projects/2026/11/05/PROJECT REPORT - slop v3 - Per-App Modules Part 1 - Implementing database, express and Mount API Policies - A Technical Deep Dive.md` with frontmatter matching the SLOP3-011 report (aliases include "SLOP3-012 report", "slop PR 31").
- Labelled the rewritten journal as illustrative, since `apps/examples/journal` is not changed by the PR; checked its SQL against `apps/examples/journal/sql/001_posts.sql` (`id TEXT PRIMARY KEY`, so the example generates ids rather than relying on `lastInsertId`).
- Verified cited ranges with a `sed -n` loop over ~30 `path:range` pairs; corrected `mounts.go:286-294` → `283-290`, `actors.go:211-221` → `208-221`, `actors.go:257-290` → `258-290`, `ratelimit.go:41-54` → `41-53`.
- Also verified `inboxLimit = 256` (`pkg/actor/inbox.go:7`) and the 10,000-row limit (`pkg/store/turn.go:216, 243-244`).
- Scanned for analogy wording: `grep -n -i -E 'like a|think of|imagine|analog|metaphor|gatekeeper|kitchen|traffic|bouncer|as if'` — one hit, "as if the key were a path", a literal description of the rejected algorithm, kept.
- Python (`python3 -I`) pass over the mermaid blocks: replaced `;` in sequence-diagram messages and quoted flowchart decision labels containing `:` and `,`.

### Why
- The brief named the eight chapters; I kept them and added a short "Notes on the implementation record" section, because the brief asks for diary inaccuracies and the SLOP3-011 report uses the same device.
- Two findings from Step 2 that are not in the implementation diary went into the report as review points: the `FloorOf` combination edge case, and the `forwardHeaders`-without-`Content-Type` consequence for `ctx.body` (the envelope reads only forwarded headers, `express.js:80-84`).

### What worked
- All cited ranges now match the branch.

### What didn't work
- No mermaid CLI is installed (`which mmdc` → `mmdc not found`), so the diagrams were checked by reading, not by rendering.

### What I learned
- `ctx.body` parsing depends on the mount's `forwardHeaders`: `TestMountAPIPolicy` forwards only `Accept` and `X-Trace`, which is why its handler reads `ctx.rawBody.length`.

### What was tricky to build
- Writing the trace so that every step is code at `cf99f05` while the app is hypothetical: each arrow in Figure 1 corresponds to a function in `serveActorRoute`, `runAPIChain`, `MatchRoute` or the turn closure, and the figure caption says the preflight is answered by step 2.

### What warrants a second pair of eyes
- Mermaid rendering in Obsidian (unrendered locally).

### What should be done in the future
- N/A.

### Code review instructions
- Open the note in Obsidian; check the three diagrams render.

### Technical details
- Word count: 10,525.

## Step 4: Committing and pushing the vault

I committed only the new note in the go-go-parc vault and pushed it. The push was accepted on the first attempt; no rebase was needed.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Stage only the note, commit with the given message and attribution line, push without force or `--no-verify`.
**Inferred user intent:** The report is published in the shared vault.
**Commit (vault):** `9b1f9e8` — "Project report: slop v3 per-app modules part 1 — database, express, mount API policies (SLOP3-012, PR #31)"

### What I did
- `cd /home/manuel/code/wesen/go-go-golems/go-go-parc && git status --short` — only the new note was untracked; branch `main`, previous head `d24cc2a`.
- `git add "<note path>"`, `git diff --cached --stat` (1 file, 873 insertions), `git commit -F -` with the message and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `git push` → `d24cc2a..9b1f9e8  main -> main` to `ssh://github.com/go-go-golems/go-go-parc`.
- `git status --short` afterwards: clean.

### Why
- The brief and the vault skill both require staging only the intended note.

### What worked
- Commit and push succeeded; no other files were staged.

### What didn't work
- No failures observed.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- The parent session commits this diary file (not committed by me, as instructed).

### Code review instructions
- `cd /home/manuel/code/wesen/go-go-golems/go-go-parc && git show --stat 9b1f9e8`.

### Technical details
- Vault commit `9b1f9e8` on `main`, pushed.
