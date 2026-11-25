---
Title: Diary
Ticket: SLOP3-026
Status: active
Topics:
    - documentation
    - cli
    - apps
    - agent
    - llm
    - deployment
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/commands/actors.go
      Note: actor.call --as anonymous
    - Path: repo://ttmp/2026/11/24/SLOP3-026--agent-complete-documentation-glazed-help-entries-for-slop-apps-verbs-agent-llm-operations/scripts/persona/judge.mjs
      Note: the judge, shared with rejudge.mjs
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-24T18:41:24.30862646-05:00
WhatFor: ""
WhenToUse: ""
---


# Diary

## Goal

Make slop usable by an agent that has the binary and a login but no source:
Glazed help entries embedded in `slop` (`slop help <slug>`), plus the small
fixes found while testing on the DGX (design doc section 2, G1–G11).

## Step 1: Design, help wiring, the anchor page

The user asked, after the Pinboard agent port and the verb tests on the DGX:
"make a new docmgr ticket, and go through them all (write up a design doc), and
use glazed help entries. It should be possible pretty much for a LLM agent
without access to the source code to use the system perfectly and build apps,
set up verbs, interact with apps, etc..."

### What I did

- Ticket SLOP3-026 (topics `documentation`, `cli` added to the vocabulary), on
  branch `task/slop3-026-agent-docs` from `task/pinboard-agent-capability`.
- Design doc: the gap inventory (G1–G11), decisions (help in the binary, one
  source of truth, pages vs the generated verb reference), a page plan of 29
  slugs, code changes C1–C5, verification including an agent acceptance test.
- C1: `pkg/doc` embeds `topics/ tutorials/ examples/ applications/`
  (`all:` patterns, so empty dirs with `.keep` compile); `Root()` calls
  `setupHelp` → `help_cmd.SetupCobraRootCommand`. The root `Long` points at
  `slop-overview` and `agent-quickstart`. `pkg/doc/doc_test.go` parses every
  page (the loader drops bad frontmatter silently), requires Slug/Title/Short,
  unique slugs, no top-level `#`.
- Wrote `topics/01-slop-overview.md` myself (vocabulary for all other pages),
  checking each claim: groups nest guest ⊂ member ⊂ subscriber ⊂ admin plus
  `@store` (`sysdb.GroupsOf`); roles pending/member/admin/disabled; `push`
  moves `main`; pages reach the actor via `claude.use('slop').call(...)`;
  `explain can <store> [level]`.
- Six writer agents in parallel (clusters A–E, ports 18601–18606), each with
  its own server and credentials; shared rules in `reference/02-writer-brief.md`.

### What didn't work

- `go:embed` of a directory with only `.keep`: "contains no embeddable files";
  fixed with `all:` patterns.
- First build: missing `go.sum` entries for Glazed's help stack (glamour,
  bubbletea, modernc sqlite); `go get github.com/go-go-golems/glazed/pkg/help@v1.4.3`
  + `go mod tidy`. modernc registers driver `sqlite`, slop uses `sqlite3`: no clash.

### What I learned

- The binary grows from 78 MB to 92 MB with the help renderer and TUI.
- `doc/design/slop-v3.md` is behind the code (grant subjects are `@groups`,
  not `*signed-in`); writers are told to trust code over it.

## Step 2: Code fixes C2, C4, C5

### What I did

- C2 (G9): `cmds.Explain(err)` adds, to `unknown command "x" for "slop"`, how
  aliases are learned (`slop on <store> --help` once) and `slop help
  using-app-verbs`; `main` prints it. Test `TestUnknownCommandHintsAtAliases`.
- C4 (G10): SLOP3-025's `02-approve-device-login.mjs` takes `CHROME`, and both
  scripts load Playwright with `createRequire(import.meta.url)`, because an ES
  `import` ignores `NODE_PATH` (the old header's "playwright on NODE_PATH"
  never worked). New `03-pinboard-agent-e2e.sh/.mjs` there: ran green
  (`eval returned: "42"`, second message on the same session).
- C5 (G11): dgx-side-k3s `104ba6d`: recovery.md 4.5 (DNS token rotation,
  stuck challenges, expired orders, replacing `Issuing`) and
  `refreshAfter: 1m` on `cert-manager-digitalocean`.

### What didn't work

- `NODE_PATH=… node script.mjs` → `ERR_MODULE_NOT_FOUND: playwright`.

## Step 3: The writers' pages, their findings, and the CLI fixes they led to

All six writers finished (28 pages, about 9,100 lines). Each ran every
example on its own `slop serve --local --llm fake` and reported findings;
they are in `reference/03-writer-findings.md` (about 55 open, triaged by kind).
The user pointed at the persona-run reports (playback-vault Factory Shots
playbook, Asset Studio, go-minitrace) and tulip/playback PR #1193
(`tools/agent-eval`, `agent-prompt-playbook.md`); design section 4.1 now
makes the acceptance test a persona matrix.

### What I did

- Fixed in the CLI, because the error is where an agent learns (4.1):
  - bare bool flags of server verbs mean true (`NoOptDefVal`); `--desc`
    used to take the next word, `store ls --all` failed outright. Checked on
    a local server: `--desc`, `--desc=false`, `--desc --limit 1`.
  - `-o` with an unknown format is refused in the root `PersistentPreRunE`,
    before the verb runs (it printed YAML after the verb had acted).
  - command help is markdown under Glazed: Examples are now code blocks,
    Short/Long are escaped at first render (`mdEscape`: `<x>` kept, `@` as
    `&#64;`, indented runs fenced), the footer names `slop help --all`.
  - the alias hint matches the first line (cobra appends "Did you mean").
  - `AddDocToHelpSystem` recovers: a bad page costs the help, not the CLI.
- Updated seven pages that said bool flags need a value.
- `topics/90-troubleshooting.md`: built from the 260 troubleshooting rows of
  all pages, indexed by code; each row names the command that settles it.
- Old guides point at `slop help`; `doc/claude-apis/*` spec copies stay.
- C3: Pinboard `board ask-json` (answer, model, steps).
- A fresh reviewer cross-checks the pages against each other and the code.

### What didn't work

- `slop help` and every command panicked at startup: writer B's page had
  `Commands: - on`, a YAML bool, and Glazed's parser panics
  (`interface {} is bool, not string`).
- `@` escaped as `\@` prints the backslash in glamour; an entity works.
- My alias-hint test passed on my machine only because it read the real
  `~/.config/slop` (where `pb` is learned); now `t.Setenv("XDG_CONFIG_HOME")`.
- I started a local server without `--admin-email`: the first person is a
  member, the approval page offers no admin scope, and pushes fail with
  `only admins change app code`. Not a bug; the brief has the flag.

### What I learned

- The overview I wrote said `sampling_disabled`; the server never sends it.
  Writers checked claims more thoroughly than I had.
- No CLI verb lists an actor's actions (E-10): an agent without source must
  read `actor.js`. A candidate fix for the persona round.

## Step 4: The persona tester, two pilots, three rounds

The acceptance test of design 4.1 runs as `scripts/persona/` (README there).
A coding agent (pi, lunaroute deepseek-4.1-flash, thinking high) works in a
bubblewrap box for a simulated person (pi, no tools), on its own fresh
local server, with the `slop` binary and `slop help` and no source. A
checker settles the facts on the server; the agent debriefs; a judge (pi,
no tools) scores goal, grounding, honesty, efficiency and communication,
trusting the checker. Ten scenarios, one (`ai-chat`) held out until round 3.
The long account, for a later user guide, is the vault report
"PROJECT REPORT - slop v3 - Persona-Based Testing of the Help" (go-go-parc,
Projects/2026/11/24).

### What I did

- Pilot 1 and 2 (4 runs each, read in full): fixed the tester first, then
  the CLI. Findings P-1 to P-13 in `03-writer-findings.md`.
- Round 1 (9 runs, baseline): all checks passed; 375 commands, 16 source
  probes, 13 of them in `tally-verb`. Fixes R-1 to R-16 (top-level
  `index.js` verbs, `explain can --action <actor action>`, alias learning
  on a fresh machine, `store new` type default, flag errors with the usage
  line, `slop --version`, …), commit `a2e3b08`.
- Round 2: 313 commands, 4 probes; `tally-verb` 41 → 22 commands with no
  probe. Fixes R-14, R-17, R-18 (`-o` on app verbs, `policy ls` on an
  instance, "ships no verbs" hint), commit `d32e29b`.
- Round 3 (10 runs, with `ai-chat`): all checks passed after three tester
  fixes. Fixes R-15 and R-19 to R-26 (`slop call --as anonymous`, strict
  groups, four error messages, the manifest page's actor sentence, top-level
  app-verb pages, `policy ls` why), commits `26a6576`, `0331d7c`.

### What didn't work

- `batch.sh` with `xargs -I` stripped the quotes: every run failed in a
  second and the batch exited 0.
- Checkers guessed JSON shapes (`mount ls` nests under `mount`, `store
  export` under `bundle`) and failed runs that had succeeded; `recheck.sh`
  reruns a checker on a finished run (it needs the run's port: logins are
  keyed by URL).
- The sandbox leaked four times, each found by the agent: the inherited
  environment, the CLI verb cache, provider-side fetch (`--tools` now lists
  only built-ins), `git clone` (code hosts resolve to 0.0.0.0), and in round
  3 the global npm packages of the host's Node (now node, npm and pi are
  bound one by one).
- Round 3's `csv-overdue` scored goal 3 because setup computed "today" in
  EST and the box in UTC: the checker was wrong. `TZ=UTC` for both.
- Round 3's 133-command `llm-budget` run got an empty judge reply.
  `judge.mjs` caps a turn at 45 commands, retries, records why;
  `rejudge.mjs` judges a finished run again.
- The broken-manifest scenario said the page was blank; the server serves
  the last good snapshot. The round-2 debrief blamed my correct status text;
  the code settled it (`kernel/apps.go`: a failed newest version keeps
  `N = cur, Active = true`), and the scenario was fixed instead.
- I ran the round-3 binary once without isolated credentials (it would
  have used the default DGX login); the permission check refused it. Every
  slop call outside a run now uses `env -i` with an empty config.

### What I learned

- This agent reads the help: 8–30 help reads per run. When the help was
  silent (top-level verbs), it went to the binary; when it was fixed, it
  stopped.
- The most useful debrief claims name a concrete output; the least useful
  propose a redesign. Every claim gets checked in code before a fix.
- Four of ten agents needed to act as a guest; `explain can` predicts, and
  they said so. `--as` takes only `anonymous`: acting as a person is a
  product decision left to the user.

### How to review

- `go test -tags sqlite_fts5 ./...`.
- `node summarize.mjs round-3` (runs are not committed; they hold throwaway
  tokens of local servers).
- `reference/03-writer-findings.md`, sections "Persona runs" through
  "Round 3", for each finding, its fix and its status.

## Step 5: The JS API rounds (js-1, js-2, js-3): browsers, four new personas, a review page

The rounds before this one tested the CLI and the help. The JS rounds test
the page and actor APIs: seven builder scenarios on apps with data already in
place (a standup room, a photo wall, an orders export, a morning digest, an
inventory migration, a team dashboard, a shopping assistant), with
`form-webhook` held out. In js-1 the persona could not see the site, so the
agent described it in words. js-2 runs the same seven with a browser for both:
the agent has a `look` command (Playwright with a read-only Chrome in the box),
and the persona can look up to three times per turn. js-3 adds four personas
with two scenarios each: a team lead who does not code, a manager who asks for
too much access, a web developer who thinks in Express/Firebase/node-cron
terms, and a colleague who inherited an app nobody explained.

### Prompt Context

**User prompt (verbatim):** "ok. run the JS API round."

**Assistant interpretation:** Run the persona round against the JS APIs (page runtime, capabilities, actors), with checkers in a real browser, and report what the docs got wrong.

**Inferred user intent:** Find out whether the help is good enough for an agent to build real apps with the JS APIs, not just run CLI commands.

**Commit (code):** 333c6b7 — "SLOP3-026: refcheck.sh: prove a checker on a reference app"; a3252ad — "SLOP3-026: four new personas and eight scenarios (js-3)"; df40639 — "SLOP3-026: read the persona's first complete JSON object"; 13af5fa — "SLOP3-026: the server's cron zone is America/New_York; accept CRON_TZ"

### What I did
- Browser checkers (`scripts/persona/checks/browse.mjs`, `checks/js/*.mjs`): sign in as a member or stay a guest, open the mount, read the text of every frame (including input values), click, upload, download, screenshot.
- `look.mjs`/`look.sh`: the same browser for the agent (in the box) and the persona (`{"browse":[…]}` replies); `BROWSER=1` turns it on.
- `review.mjs` + `review/template.html`: one page per batch with checks, judge, screenshots (in-page viewer), the agent's code (highlighted) and the conversation; `PLAYBOOK.md` documents the whole loop.
- `refcheck.sh SCENARIO DEPLOY`: runs a checker against a reference deploy, so a checker is proven (and the restraint checks shown to fail the wide fix) before agents meet it.
- Four personas (`personas/requester|pusher|wrongpicture|inheritor.json`) and eight scenarios on the js-1 apps; `setup/taskboard-count` is the inherited app's update that never activated.

### Why
- js-1 showed the persona accepting descriptions it could not check; a person would open the page.
- The new personas test what builder personas never do: plain language, restraint with access, correcting a wrong mental model, and orientation in an unknown app.

### What worked
- js-1, after checker fixes: all seven met their checks except shop-assistant (a checker bug, then 8/8 on recheck); goals 4–5.
- js-2/js-3: agents used `look` 4–14 times a run to check their own work. The pusher scenarios kept access narrow (9/9, 7/7).

### What didn't work
- The js-2 queue never started: it waited with `pgrep -f 'batch.sh js-1'`, which matched its own command line. Replaced with one script that runs the steps in order.
- 9 of 15 browser runs ended after one turn, recorded as the persona giving up: `persona reply was not JSON`. The persona often wrote its `{"browse":…}` twice (plain and in a code block); `json()` took everything from the first `{` to the last `}`. It now takes the first complete object with a `message` or `browse` (df40639). The nine reruns are in progress.
- My scenario facts said cron runs in UTC; the server runs in America/New_York (`timedatectl`: `Time zone: America/New_York (EST, -0500)`). The judge marked js-2 daily-digest's correct answer wrong (3/2/2); rejudged with correct facts: 5/5/5.
- The digest checker failed `CRON_TZ=America/New_York 0 7 * * *`, which robfig/cron v3 accepts (`parser.go:95: if strings.HasPrefix(spec, "TZ=") || strings.HasPrefix(spec, "CRON_TZ=")`).
- The checkers read `innerText` only, so the inventory values in `<input>` fields were invisible (goal 2, then 5 after the fix).

### What I learned
- The checker's and judge's facts need the same checking as the agent's claims: two of the worst scores in these rounds were my errors, not the agent's.
- With a browser the agent checks its own pages without being asked; the persona's looks found nothing the checker missed, but made the conversation realistic (it reports what it saw).

### What was tricky to build
- Sign-in on the live host goes through the main host (`/auth/login`, then `/_site/login?return=/`), which lands on `/`, a 404 on the live host. Every run logged that 404 as a page error until `person()` cleared the errors after sign-in.
- The Artifact viewer does not open links to the page's own files; screenshots open in an in-page `<dialog>` instead, and the data is embedded as JSON with `<` escaped.

### What warrants a second pair of eyes
- `recheck.sh` reuses the run's port (logins are keyed by URL); running it while a batch uses the same ports would collide. Nothing guards this.

### What should be done in the future
- Finish the nine reruns, recheck/rejudge `digest-nodecron`, publish the js-2 and js-3 review pages, compare js-1 with js-2.

### Code review instructions
- Start with `scripts/persona/PLAYBOOK.md`, then `run.mjs` (`json()`, `personaTurn`), `checks/browse.mjs`, `look.mjs`.
- Validate: `./refcheck.sh tasks-admin-all '$SLOP grant set taskboard @member interact'` (PASS) and with `@member admin` (FAIL on the restraint checks).

### Technical details
- Summary tables: `node summarize.mjs js-2`, `node summarize.mjs js-3`; review: `node review.mjs js-2`.

## Step 6: Alarms: readable next run, last run, fire --at, and a retry storm

The digest scenarios produced the most doc complaints of the JS rounds: no
page says what time zone a cron alarm runs in, `alarm ls` printed the next
run as epoch milliseconds, and there was no way to try a 7 o'clock job
without changing its schedule. This step makes the CLI answer those
questions itself, before any help page says it.

While testing the "last run" record I found a real bug: a scheduled alarm
whose handler throws rolled back its own rescheduling, so it stayed due and
the scheduler ran it again at once. The test counted 500 runs in 3 seconds.
It now retries a minute later.

### Prompt Context

**User prompt (verbatim):** "new features are fine too. Implement the fixes and btw commit at appropriate intervals and keep a detailed diary as you work
    (using the diary format from the skill)."

**Assistant interpretation:** Implement the findings I recommended (command and error fixes, new features such as `alarm fire --at`, help pages), committing per group and recording each step here.

**Inferred user intent:** Turn the persona findings into a better product and better help, with a reviewable trail of what changed and why.

**Commit (code):** cf21f87 — "alarms: readable next run with zone, last run, fire --at, retry after a failure"

### What I did
- `pkg/store/store.go`: a new internal table `_alarm_runs (name, at, now, via, ok, error, late)`, created with the schema on every open, so existing stores get it.
- `pkg/actor/manager.go`: `alarmDone` records each alarm's outcome in its own turn (a failed handler's turn rolled back); `FireAt(ctx, id, name, at)`; `ScheduleZone(spec)`; `via` is `alarm` for the scheduler and `alarm fire` for a person.
- `pkg/actor/actor.go`: `event.now` and `turn.now()`: with `--at`, `ctx.now` and `use('time').now()` return the given time; the store's clock (doc timestamps, rescheduling) stays real. `alarmDone` is called where a root event ends: failure without a reply, no promise, or a settled promise.
- `pkg/commands/actors.go`: `alarm.ls` joins `_alarm_runs` and adds `next` (`2026-11-26 07:00 EST`), `zone`, `in`, `last`, `lastVia`, `lastOk`, `lastError`, `lastLate`, `lastAsOf`; `alarm.fire` takes `--at next|HH:MM|"YYYY-MM-DD HH:MM"|RFC3339`, refuses an unknown alarm name, and waits up to 15 s to answer `status: ok|failed|running` with the error.
- Tests in `pkg/host/actors_test.go`: `TestAlarmFireAtAndLastRun`, `TestFailingAlarmBacksOff`.

### Why
- Three agents in three rounds got or gave the time zone wrong or not at all; one reversed a correct answer. The server can state it.
- "Does the 7 AM job work?" needed a temporary every-minute schedule and log archaeology (js-2 debrief).

### What worked
- `go test -tags sqlite_fts5 ./...` passes.
- `alarm fire digest morning --at 07:00` on a `CRON_TZ=Europe/Berlin 0 7 * * *` alarm: the handler saw 07:00 Berlin, the answer was `status: ok`, `alarm ls` showed `lastVia: alarm fire`, `lastAsOf: … 07:00 CET`.

### What didn't work
- First test run: `alarm ls morning = map[]`: alarms are registered when the actor starts, which happens shortly after activation. The test now waits for them.
- `ReferenceError: db is not defined at run (actor.js:2:69(1))`: the test actor needed `const db = use('db')`. (The new `fire` answer reported it, which was the point.)
- The backoff test timed out at first: the test harness serves without the scheduler (`ListenAndServe` starts it; `httptest` does not). The test starts `h.a.Start(ctx)` itself.
- Then: `the failing alarm ran 500 times in ~3 s, want 1` — the retry storm (500 is the log's cap).

### What I learned
- An alarm's reschedule is part of the handler's transaction, so a failure undoes it. "At-least-once" was true, but with no delay.

### What was tricky to build
- Recording a failure: the failing turn rolls back, so the record must be written in a second turn. Kernel writes to `_` tables are not app changes, so that turn adds no revision and wakes no reactor (`doLocked` writes a log entry only when `allChanges()` is non-empty).
- The retry is in the same second turn: `UPDATE _alarms SET at = now+60s WHERE name = ? AND at < now+60s`, only for `via = alarm` (a person's `fire` does not move the schedule). `alarmDone` runs before `afterTurn`, so `refreshSchedule` sees the new time.
- `--at` must not change data timestamps or rescheduling, or firing "as of tomorrow 7:00" would move the next run to the day after. Only the handler's view of time (`turn.now()`) changes.

### What warrants a second pair of eyes
- `alarmDone` for a parked (async) handler is called when its promise settles in a later turn (`default:` branch with `pk != nil`); check that a handler that parks and is then lost (`lost` path) leaves no stale `running` record.
- `alarm.fire` polls `_alarm_runs` for up to 15 s inside a request.
- Commit cf21f87 includes `TestPointersForSQLAndActions`, which needs the next commit (ff03404); tests pass from ff03404 on.

### What should be done in the future
- The help (Step 8): the zone, `CRON_TZ=`, `fire --at`, the retry.

### Code review instructions
- Start with `alarmDone` and `FireAt` in `pkg/actor/manager.go`, then `alarmRows`/`fireTime` in `pkg/commands/actors.go`.
- `go test -tags sqlite_fts5 ./pkg/host/ -run 'TestAlarm|TestFailingAlarm|TestActors$' -count=1`.

### Technical details
Real output, dev binary on a scratch copy of a dry-run server (the server's zone is America/New_York; the server's zone printed as `Local` until `ZoneName` in e1aa0f1):
```text
$ slop alarm ls digest
- at: 1795672800000
  every: CRON_TZ=Europe/Berlin 0 7 * * *
  in: 9h 56m
  name: berlin
  next: 2026-11-26 07:00 CET
  running: 0
  zone: Europe/Berlin
- at: 1795694400000
  every: 0 7 * * *
  in: 15h 56m
  name: morning
  next: 2026-11-26 07:00 EST
  running: 0
  zone: America/New_York
$ slop alarm fire digest morning --at 07:00
fired: morning
now: "2026-11-26T07:00:00-05:00"
status: ok
$ slop alarm fire digest berlin          # its handler throws
error: 'Error: no data yet at run (actor.js:4:72(3))'
fired: berlin
status: failed
$ slop alarm fire digest morning --at seven
error: invalid_argument: --at "seven": give next, HH:MM (e.g. 07:00), "YYYY-MM-DD HH:MM" or RFC 3339 (2026-11-26T07:00:00-05:00)
$ slop log show digest -o json | jq -c '.[0] | {rev, via, summary}'
{"rev":5,"via":"alarm fire","summary":"set doc digest/today"}
```

## Step 7: Errors that say what to do next

Six errors from the debriefs and two older open findings (P-6, R-16) each
cost an agent at least one round trip. Each now names the next command or
the real reason.

### Prompt Context

**User prompt (verbatim):** (see Step 6)

**Assistant interpretation:** The error-message group of the fixes.

**Inferred user intent:** Fewer wasted steps for an agent without source.

**Commit (code):** ff03404 — "errors that say what to do next"

### What I did
- `cmd/slop/cmds/extra.go`: `slop call` takes `--json` for the action's arguments (the third argument and `--json` together are refused).
- `pkg/verbs/def.go`: `actor.call takes no argument "name": the action's own arguments go in --args '{…}' (or slop call <store> <action> '{…}'); --json holds the verb's arguments store, action, args, as`.
- `pkg/store/export.go` `AppTables`; `pkg/commands/docs.go` `noColl`: `docs.ls needs a collection (slop docs ls inv <coll>), but inv has no documents; its SQL tables are items (1 rows) (slop sql query inv 'SELECT * FROM <table>', slop sql schema inv)`.
- `pkg/commands/appverbs.go`: `app.verbs` adds `note` and `actions` when the app ships no verbs (the env now carries the actor manager).
- `cmd/slop/cmds/root.go` `usageOnArgErrors`: every positional-argument check appends `usage: slop pull <store> <dir> [flags] (slop pull --help)`.
- `pkg/commands/mounts.go` (P-6): nothing pushed → "push the app first"; newest version failed → "snapshot N did not activate: <why>; fix it and push again (slop app status X)"; otherwise plain content, naming why.
- `pkg/rt/views.go` (R-16): `CloseFor(v, revoked, why)` and `Why(key)`; reasons kept an hour, by view id and secret. `pkg/doors/pages/*`: every "closed or expired" answer uses `closedMsg`, e.g. `the view is closed: the viewer no longer has access to notes (a grant, mount or policy changed)`.
- Tests: `TestPointersForSQLAndActions`; additions to `serving_test.go` (P-6) and `access_test.go` (R-16).

### Why
- js-2 inventory-migration: "has no documents yet" while the table held six rows; `app verbs` returned `{"files":[]}`. js-3 inventory-inherited: `actor call --json '{"name":…}'` failed. js-3 digest-nodecron: `accepts 2 arg(s), received 1` with no usage.

### What worked
- `go test -tags sqlite_fts5 ./...` passes; the dev binary prints the usage line for `slop pull taskboard` and `slop docs get a b c d`.

### What didn't work
- My test actor used `sql.exec`/`sql.query`; the module has `sql.run`/`sql.all` (`TypeError: Object has no member 'exec'`).

### What I learned
- `strictGroups` replaces group `Args` with `ArbitraryArgs`; wrapping `Args` after it covers groups too without changing their behaviour.

### What was tricky to build
- A closed view is removed from both maps, so the reason has to live elsewhere: `gone`, pruned in `Sweep`. An expired view is still in `bySecret` until the sweep, so `Why` checks that first.

### What warrants a second pair of eyes
- `gone` grows with every closed view for an hour (two entries each); bounded by the view rate, pruned each sweep.
- The access-changed reason names the new level; it is shown to the page's own viewer only.

### What should be done in the future
- N/A

### Code review instructions
- `git show ff03404`; tests: `go test -tags sqlite_fts5 ./pkg/host/ -count=1`.

### Technical details
- Changed messages are listed in "What I did".

## Step 8: store show, and output that says what a row is

The inheritor persona needed four commands (`store ls`, `mount ls`, `app
status`, `explain can`) to learn what `/tasks` is, and two agents complained
that `mount ls -o table` printed a truncated object and that `store ls`
left APP and TYPE blank. This step adds one command for "what is this
store?" and makes the list output name what each row is.

### Prompt Context

**User prompt (verbatim):** (see Step 6)

**Assistant interpretation:** The output group of the fixes, with `store show` as the new feature.

**Inferred user intent:** An agent should orient itself in an unknown store in one step.

**Commit (code):** e1aa0f1 — "store show; mount ls, store ls and tables that say what a row is"

### What I did
- `pkg/commands/mounts.go`: `store.show` (`mountEnv.show`): app, snapshot, broken, title, capabilities, and where the code is (`slop pull <id>` or the app store); mount URLs; collections and SQL tables with rows; aliases; grants and alarms (admins); actor actions; a `next` list of commands.
- `app.status --migrations` adds `pending`: `sql/*.sql` files of the newest snapshot (failed or not yet activated) that the store has not run.
- `pkg/commands/stores.go`: `store.ls` adds `kind` (`app`, `instance`, `content`) and fills a blank `type` from the manifest (`K.Peek`, which does not activate); `store.meta` adds `tables`.
- `cmd/slop/cmds/root.go`: every `ls` verb also answers to `list`. `cmd/slop/cmds/output.go`: `leadCols` put `id, name, store, host, path, url, app, type, kind, level, …` first in tables.
- `pkg/actor/manager.go` `ZoneName`: the server's zone from `$TZ` or `/etc/localtime` (it printed `Local`).
- Tests: `TestPointersForSQLAndActions` (store show, store ls kinds, pending migrations).

### Why
- js-3 tasks-inherited / inventory-inherited and js-2 orders-export debriefs (quoted in Step 5's run data).

### What worked
- On a scratch server: `slop store show inventory` lists `tables: items: 7`, `actions: [add, list, set]`, `mounted: [http://apps.localhost:18787/inventory]` and `code: 'in this store: slop pull inventory <dir>, …'`.

### What didn't work
- Setting `app` to the store's own id for a store that is its own app broke `TestBenchFiles` (`jot in apps = map[]`): the bench app's actor treats a non-empty `app` as "an instance" (`apps/bench/actor.js:154`, `if (s.app) …`). Reverted; the new `kind` field carries the information and `app` keeps its meaning.
- The pending-migrations test first used `"storage":1` at the top level of `app.json`, which is ignored, so the snapshot activated and nothing was pending. A broken snapshot needs the unknown capability inside `capabilities`.
- I also made `mount ls` rows flat, on a debrief's claim that `mount set` answers flat. It does not (`{"mount": {…}, "note", "url"}`), so this made the two inconsistent and broke two tests; reverted in Step 9. The commit message of e1aa0f1 still says "mount ls rows are flat".

### What I learned
- A debrief's claim about output shape needs the same check as any other claim: run the command.
- Field meanings are contracts with apps in the tree (the bench), not only with the CLI.

### What was tricky to build
- `store show` has to work for a viewer, not only admins: grants and alarms are added only at `admin`; everything else needs `view`.
- `Peek` for each row of `store ls` opens every store; acceptable for the store counts here, but it is a cost per listed store.

### What warrants a second pair of eyes
- `store ls` now opens each store (Peek) on every call.
- `pending` compares names only; an applied migration whose content changed shows as applied (activation reports that case as broken).

### What should be done in the future
- N/A

### Code review instructions
- `mountEnv.show` in `pkg/commands/mounts.go`; `store.ls` in `pkg/commands/stores.go`.
- `go test -tags sqlite_fts5 ./pkg/host/ -run TestPointersForSQLAndActions -count=1`.

### Technical details
```text
$ slop store ls -o table
ID         APP  TYPE       KIND  LEVEL  CREATEDAT      OWNER
inventory       inventory  app   owner  1795632800536  usr_a283cee15cc2347a3f8fa347
```

## Step 9: Positionals given as flags, group help, tables that spread nested rows

Three CLI fixes, and the correction of Step 8's mistaken flattening. A
js-1 agent lost a round trip to `preview url dash --at main <parent>`
(`preview.url needs parent`): the parent filled `at`'s positional slot and
`--at` then replaced it. Every group's help said only "The alarm verbs".

### Prompt Context

**User prompt (verbatim):** (see Step 6)

**Assistant interpretation:** Continue the fixes; correct the mount ls shape.

**Inferred user intent:** Commands behave the way their usage line suggests.

**Commit (code):** 49a2a7e — "CLI: positionals skip slots given as flags; group help names its page; tables spread nested rows"

### What I did
- `cmd/slop/cmds/root.go` `verbCommand`: positional words fill the slots whose flag was not given; with more words than free slots, they fill all slots in order as before.
- `groupShort`: a sentence and a help page for 17 groups (`alarm - Scheduled jobs of a store's actor: … (slop help alarms)`).
- `pkg/commands/mounts.go`: `mount.ls` back to `{kind, mount, url}`; `cmd/slop/cmds/output.go` `spread` lifts a nested object's fields into the table row, so `mount ls -o table` shows `STORE HOST PATH URL KIND CHANGEDAT CHANGEDBY`.
- `pkg/actor/actor.go`: `__slopNow` (behind `Date.now()`) returns `turn.now()`, so it follows `alarm fire --at` like `ctx.now`; the test checks both are equal.
- `bind.set`'s doc says `--prefix` reads as the viewer, who needs their own grant on the target.

### Why
- See the opening paragraph; `Date.now()` differing from `ctx.now` under `--at` would have been a trap the help had to explain.

### What worked
- `slop preview url photos --at main http://slop.localhost:18787` and `slop preview url photos main http://slop.localhost:18787` both return a URL.

### What didn't work
- My first `sub()` for the test revert matched `m := x.(map[string]any)` more than once (`AssertionError … mount_api_test.go`); with more context it applied. The partial run had already removed the `encoding/json` use in `mounts.go` (`"encoding/json" imported and not used`).

### What I learned
- The table printer was the actual problem behind "mount ls is unreadable"; fixing it there fixes every verb with a nested result.

### What was tricky to build
- Positional slots and flags: the old code assigned positionals first and flags after, so a flag silently overwrote a positional that was meant for the next slot. The fix keeps the old behaviour when every slot is filled positionally.

### What warrants a second pair of eyes
- `spread` drops a nested object's own key from the table (its fields replace it); a row with two nested objects whose fields share a name shows only one.

### What should be done in the future
- N/A

### Code review instructions
- `git show 49a2a7e -- cmd/slop/cmds/`; `go test ./cmd/... -count=1`.

### Technical details
```text
$ slop mount ls -o table
STORE      HOST                  PATH        URL                                    KIND  CHANGEDAT      CHANGEDBY
inventory  apps.localhost:18787  /inventory  http://apps.localhost:18787/inventory  live  1795632801099  usr_a283…
```

## Step 10: The help: alarms and recipes pages, the examples that misled

Two new pages and fixes to twelve others. The alarms page answers the
digest scenarios' questions in order (declare, zone, try, check, failure).
The recipes page maps requests to patterns and pages, including how
Firebase, Express and node-cron ideas map onto slop for the "wrong picture"
persona, and what to run on an inherited app.

### Prompt Context

**User prompt (verbatim):** (see Step 6)

**Assistant interpretation:** The help-page group of the fixes.

**Inferred user intent:** The help leads agents to the safe pattern first time.

**Commit (code):** 38f5a3b — "help: alarms and recipes pages; examples and wording the JS rounds tripped on"

### What I did
- New: `pkg/doc/topics/42-alarms.md` (`slop help alarms`), `pkg/doc/topics/05-recipes.md` (`slop help recipes`).
- `22-capability-assets.md`: the photo wall now writes rows through actor actions `add`/`remove` (`write: "self"` rule; the upload id is the row id), with `@guest view` and `@member interact`; a callout that showing `/_blob/<id>` needs no level.
- `21-capability-db.md`: a table of the ways to read another store (reads as, live, what the viewer needs, use for); `24-capability-slop.md` and `bind set --help` point to it.
- `31-capability-agent.md`: async members marked; "What the fake engine cannot test".
- `26-capability-room.md`: a late page gets everyone's presence, not past events.
- `03-tutorial-first-app.md`, `10-building-apps.md`: one store is enough for one app.
- `04-store-data.md`: "Changing tables: migrations" (rows too, failures, instances, pending); `40-actors.md` and `02-deploying-apps.md` point to it.
- `40-actors.md`: alarm zone and `CRON_TZ=`, real `alarm ls`/`fire` output, `Date.now()` vs `new Date()`, no `Intl`.
- `02-cli-reference-guide.md`, `01-agent-quickstart.md`, `90-troubleshooting.md`, `20-page-runtime.md`: `slop call --json`, `list`, the usage line, positionals as flags, `store show`, `store ls` kinds, the `revoked` reason.

### Why
- Each change answers a debrief or judge finding of js-1..js-3 (Step 5); the photo wall example was the one an agent said it had to "reconcile" with the actor guidance.

### What worked
- The photo wall example, extracted from the page and deployed on the scratch server: `slop call photos add` as admin wrote a row; with a malformed id → `invalid_argument: asset is an upload id`; `--as anonymous` → `permission_denied: add needs interact; you have view`; `slop docs set photos photos/forged` → `writing photos/forged needs self`. In Chrome (look.mjs), Sam (a member) uploaded `team-photo.png` through the page; the row has Sam's id; a guest sees the picture.
- `go test ./pkg/doc/` passes; a script found no `slop help <slug>` reference to a missing page.

### What didn't work
- First draft of the photo actor used `db.collection('photos').doc()` for a new id; the actor db has no auto-id (`dbModule` has `doc(path)` and `collection(coll)` only). The upload id is unique, so it is the row id.
- I first wrote that a reactor could follow the sales store; reactors follow only their own store's commits. Removed.
- The alarms page said an empty `alarm ls` after a push meant "activates on its next use"; what I saw is that the actor registers them a moment after activation. Reworded.

### What I learned
- Checking an example by running it found the API mistake the reviewer would have missed (`doc()`).

### What was tricky to build
- The cross-store table had to be exact about who reads as whom: `--prefix` and `_stores` read as the viewer; a binding without `--prefix` is for the actor, which reads as the store. That distinction is the whole safety argument of the dashboard scenario.

### What warrants a second pair of eyes
- `05-recipes.md`'s Firebase/Express table is a mapping of concepts; each row points to a page that has the facts.

### What should be done in the future
- Rerun the scenarios whose findings changed, on a binary at 38f5a3b, to see whether the fixes help (daily-digest, digest-nodecron, inventory-*, photo-wall, shop-assistant, dash-public, tasks-inherited).

### Code review instructions
- `git show 38f5a3b --stat`; read `slop help alarms`, `slop help recipes` and the photo wall in `slop help capability-assets`.

### Technical details
- The extraction script for the example: the code blocks after `` `app.json`:``, `` `actor.js`:``, `` `index.html`:`` in "Example: a photo wall".
