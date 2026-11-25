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
