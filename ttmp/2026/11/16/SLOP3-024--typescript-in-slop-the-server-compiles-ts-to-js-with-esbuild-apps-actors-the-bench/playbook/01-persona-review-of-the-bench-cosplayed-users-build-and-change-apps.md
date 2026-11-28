---
Title: 'Persona review of the bench: cosplayed users build and change apps'
Ticket: SLOP3-024
Status: active
Topics:
    - architecture
    - goja
    - apps
    - frontend
DocType: playbook
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "How to run a persona review of the bench: model-driven personas, each with a goal and a background, build or change a slop app through the bench's page while keeping a diary of what confused or blocked them; their struggles become bench and guide fixes."
LastUpdated: 2026-11-17T04:00:00-05:00
WhatFor: "Finding where the bench, its agent and its guide fail real kinds of users, before real users do."
WhenToUse: "After a change to the bench, its agent, its guide or the platform under it (a new phase, a new template), and before a staging rollout."
---

# Persona review of the bench: cosplayed users build and change apps

A persona review puts the bench in front of people who want something from it, and watches where they get stuck. The people are played by a coding model ("cosplayed"). Each persona has a background, a goal and a way of working. Each drives the bench's real page, talks to the bench's real agent, and keeps a diary of what it tried, what it expected and what happened. We read the diaries more than the apps they built: the struggles are the result.

This playbook says how to set one up, how to write personas that find different problems, how to run rounds of them, and how to turn their diaries into fixes. SLOP3-024 ran the first rounds with it. The diary's Step 12 and later steps record what happened; the section "What the first rounds taught" collects the lessons.

## Why personas, and why not tests

The bench's tests check what we thought of. A persona finds what we did not think of, because it brings a goal we did not design for and reads the screen the way its background suggests.

Three properties make the method work:

- **The persona wants an outcome, not a feature.** "A preorder page for my bakery that I can share on Instagram" exercises templates, the agent's explanations, proposals, publishing and the live link, in an order no test follows. "Test the publish button" exercises the publish button.
- **The persona has limits.** A baker does not read stack traces. A TypeScript developer does, and also opens the Code view and edits by hand. Different limits push on different parts of the bench.
- **The persona writes down its confusion as it happens.** "I expected the page to change after the agent said it was done; it did not" is a bug report with a reproduction.

Round 1 showed the method finds real bugs, not only usability notes. A developer persona read his proposal's code and saw `slop.actions.list` called while the footer said "types ok". The actor had no `list`: the type checker was reading draft's actor, not the proposal's. An ops persona's tests ran once and then failed with "sql: connection is already closed", a server bug in how a reset instance's actor was kept.

What a persona review does not do: it does not prove the bench works (the tests do that), and its personas are not real users. A model playing a baker still knows what a CSS selector is. The diaries are leads to check, not verdicts.

## The pieces

```
  persona (pi -p, a lunaroute model, a thinking level)
     │  bash: benchdrive <persona> <command>        (BENCHDRIVE_RECORD → steps.jsonl + shots/)
     ▼
  benchdrive daemon (Playwright, one browser context per persona)
     │  clicks, types, reads the bench page as text; a screenshot after each command
     ▼
  the bench (apps/bench on a local slop server built from the branch)
     │  its agent's turns call sample
     ▼
  slop's sample backend (llm: pi; tiers → lunaroute models)
```

There are two models in play, and they must not be confused:

1. **The persona** is a pi coding agent. It decides what to do next as the person would. It can only touch the bench through `benchdrive`, a command-line driver for the page. It does not read the bench's source or the app's files on disk: a person could not.
2. **The bench's agent** is the agent inside the bench page, the one the person chats with. It runs on the local server's model tiers. Its quality is part of what is under review.

Change one of them per round, not both, when you want to know which one a difference comes from. Round 1 ran both on `deepseek-4.1-flash` at medium thinking. Round 2 moved the bench's agent to `glm-5.3` and mixed the personas' models.

The files, all under the ticket:

| Path | What |
|---|---|
| `scripts/04-benchdrive/` | the driver (`benchdrive.mjs`, `page.js`, `README.md`); `npm install` pins a Playwright that uses the cached Chromium |
| `scripts/05-cosplay/persona-prompt.md` | the frame every persona gets |
| `scripts/05-cosplay/personas/<name>.md` | the briefs |
| `scripts/05-cosplay/fixtures/<app>/` | existing apps for "change an app" personas (`quiz`, the legacy `inventory`) |
| `scripts/05-cosplay/run.sh` | runs one round |
| `scripts/05-cosplay/browse.mjs` | a small server for browsing rounds |
| `various/persona-review-<date>/r<N>/` | each round's diaries, pi sessions, steps and screenshots |
| `various/persona-review-<date>/findings.md` | the working list of findings across rounds |

## Setting up

### 1. A local server built from the branch

```sh
make runtime bench                       # then check: git status shows no changed outputs
GOWORK=off go build -tags sqlite_fts5 -o $W/slop ./cmd/slop
cat > $W/config.yaml <<EOF
listen: 127.0.0.1:18494
data: $W/data
llm: pi
pi:
  models:
    quick: lunaroute/glm-5.3-flash:low
    default: lunaroute/glm-5.3:medium
    complex: lunaroute/glm-5.3:high
EOF
$W/slop serve --config $W/config.yaml --local --admin-email admin@example.com
```

- Use a fresh data folder per review, so one review's apps don't show up in the next one's app list.
- Pick a port no other local server uses (`ss -ltnp | grep 184`).
- The server's tiers are the bench agent's models. Restart the server to change them, and only between rounds.

### 2. The CLI, signed in without a person

`slop auth login` is a device flow, so someone has to approve it in a browser. Approve it from a script instead: sign in through the local form (`POST /auth/local` with an email), read the CSRF value from `/device?code=…`, and post the approval. Never print the token. Every CLI call then names the server and credentials on its own line:

```sh
SLOP_CREDENTIALS=$W/creds.json SLOP_SERVER=http://slop.localhost:18494 slop …
```

Don't put both variables in one shell variable and expand it. zsh doesn't split it, and every call fails with `no server`.

### 3. The bench, installed

```sh
slop store new --id bench --type bench && slop push apps/bench --store bench
slop app trust bench workshop
slop policy set bench sample @admin on
slop mount set --host apps.localhost:18494 --path /bench --store bench
```

### 4. Fixtures for "change an existing app" personas

A persona that changes an app needs one to exist first: `slop store new --id quiz --type quiz && slop push scripts/05-cosplay/fixtures/quiz --store quiz`. Check that it runs with `slop actor call quiz <action>`. The fixtures:

- **quiz:** a small, clean app (a teacher adds a leaderboard).
- **inventory:** deliberately messy legacy code: globals, inline `onclick`, numbers stored as text, actions without schemas, a planted bug where the total is concatenated as a string. Messy code is where an agent's habits show.

### 5. benchdrive

`benchdrive serve [--port N]` starts the daemon; each persona gets its own browser context. Set `BENCHDRIVE_URL` to the bench's URL and `BENCHDRIVE_PORT` to the daemon's port, in the daemon's environment and on each persona's PATH wrapper. The commands are what a person can do and see:

| Command | What the person does |
|---|---|
| `look` | reads the screen as compact text: header, layout, the open views, the chat, the canvas frames' text, dialogs (the bench's and the page around it) |
| `ask <message>` | types into the agent's chat, sends, waits for the turn to end, prints the reply with its eval effects |
| `click <label> [--in <where>]`, `type <field> <text>`, `key <key>` | uses the page; a dialog's fields are `dialog`, `dialog2`, … |
| `new-app <id> [template]`, `open-app <id>` | the project menu; `new-app <id>` alone lists the templates |
| `view <name>` | opens a view: Code, Data, Timeline, Docs, Scenarios, … |
| `read [from] [to]`, `edit <old> <new>` | reads the open file 80 lines at a time; changes part of it by selecting and typing |
| `frame-text`, `frame-click`, `frame-type`, `frame-shot` | the app's own page in the canvas, in Play mode |
| `shot <file.png>`, `wait [s]`, `close` | a screenshot; wait and report changes; forget the tab |
| `see <file.png>`, `click-at <x> <y>`, `dblclick-at`, `drag <x1> <y1> <x2> <y2>`, `scroll-at <x> <y> <dy>`, `keys <text>`, `pause [s]` | for a persona that works by eye: a screenshot with a 100 px grid to aim by, then the pointer and keyboard at screen coordinates (see below) |

Each action command prints what changed on screen. An `alert`, `confirm` or `prompt` from the page is accepted, as a person clicks OK, and reported. `type code` refuses unless given `--replace`, because it replaces the whole file; one persona nearly lost a file that way.

With `BENCHDRIVE_RECORD=<round dir>` in the client's environment (`run.sh` sets it), every command is appended to `<round>/<persona>/steps.jsonl`, with a JPEG of the bench after it in `shots/`. `BENCHDRIVE_EMAIL` and `BENCHDRIVE_NAME` give a persona an account of its own (see Limits).

Changes to benchdrive take effect when the daemon restarts, and a restart drops every persona's tab, which loses any agent turn in flight (the agent runs in the page). Change it between rounds. The file is also the client every persona runs, so keep it valid at every save during a round.

## Writing personas

A persona is a short brief: who they are, what they want, where they start, how they work, and when they give up.

```
Background:   Maya runs a two-person bakery; uses Instagram, Square and Google Sheets; has never written code.
Goal:         A page where regulars preorder weekend bread by Thursday night, and a list she can print Friday morning;
              then live, so she can put the link on Instagram.
Starts from:  a new app.
Works by:     asking the agent in plain words; looking at the app in the canvas; trying the form herself.
Gives up when: the agent asks her something she cannot answer twice in a row, or nothing she can see changes for three turns.
```

Choose personas so that together they press on different parts of the bench:

| Axis | One end | The other end |
|---|---|---|
| Skill | never coded | writes TypeScript daily |
| Start | a new app from a template | changing an existing app, clean or legacy |
| Surface | only the chat | the Code view, Data, scenarios, the Timeline |
| Risk | private tinkering | publishing to people who use it |
| Shape | a page only | a page, an actor, SQL; live updates; privacy rules |
| Ambition | one small form | a multi-person live app |

The personas so far:

1. **Maya, a baker:** never coded; new app; chat only; publishes and wants the link.
2. **Devon, a frontend developer:** TypeScript; actor and SQL; edits by hand; deliberately plants type errors.
3. **Priya, a teacher:** some HTML; changes the existing quiz; must not break it for her class.
4. **Sam, an ops lead:** SQL, no JavaScript; a dashboard; insists on fixtures and a test shown going red.
5. **Rosa, a freelancer:** inherits the legacy inventory app; fixes a bug, adds a CSV export, keeps the data.
6. **Kenji, a meetup organizer:** a live poll with results updating on every phone at once.
7. **Aisha, a volunteer coordinator:** shift sign-ups with a waitlist and a privacy rule (only she sees phone numbers).

## Making rounds harder

Run the same personas again after fixes, on a different model, to check the fixes from a user's side. Then raise the difficulty when a round goes well:

- **Messier starting points:** legacy fixtures with globals, string-typed numbers, unschemaed actions and planted bugs. An app with existing data the persona must not lose.
- **Ambitious goals:** live multi-person behavior (rooms), privacy and roles, publishing to many users.
- **"Keep going":** the persona prompt asks a persona that reaches its goal early to go on to what their person would want next, and to note it in the diary.
- **Models and thinking levels:** a weaker model as the bench's agent shows what the guide must spell out; a stronger one shows what is left that is the bench's fault.

## The persona's instructions

Every persona gets the same frame (`scripts/05-cosplay/persona-prompt.md`) around its brief:

- **Stay in character.** Act on what the person would know. Use only `benchdrive`; don't read the bench's source, the server or the app's files on disk.
- **Pursue the goal, not the review.** Do what the person would do next to get what they want.
- **Keep a diary** at `diary.md`, written as you go. Each step records what you tried (the exact command or message), what you expected, what happened (quoting the screen), and how it felt, in character.
- **Mark struggles** with a line starting `STRUGGLE:` and a one-line summary.
- **Stop** when the goal is met and there's nothing more the person would want, when the brief's "gives up when" fires, or after about 50 commands. End with `## Verdict`: did you get what you wanted, the hardest moment, would you come back, and the three struggles that mattered most.

## Personas that work by eye

A text persona reads the bench through `look`, which lists every control by name, so it finds a button wherever it is. A person doesn't. In round 3 a persona working only from screenshots couldn't find "New app…": it sat below twenty apps in the menu, out of sight. No text persona had hit that in three rounds. One visual persona per round catches what the text harness hides: layout, overlap, cut-off text, things out of view.

- **Name it `<name>-visual`.** `run.sh` gives it `persona-prompt-visual.md`, and the daemon refuses it every command but `see`, `click-at`, `dblclick-at`, `drag`, `scroll-at`, `keys`, `key` and `pause`. `key` and `pause` answer without describing the screen. Everything it knows comes from reading its screenshots.
- **Use a model that sees.** `deepseek-4.1-flash` reads screenshots natively and worked. Avoid a text model with vision added on.
- **It is slower:** each look is an image. Give it a budget of about 70 commands.

## Running a round

```sh
export PATH=$W/bin:$PATH        # a benchdrive wrapper that sets BENCHDRIVE_URL and BENCHDRIVE_PORT
ROUND_NOTES="what this round is for" ROUND_BENCH="the server's tiers" \
  scripts/05-cosplay/run.sh $W/rounds/r2 lunaroute/glm-5.3-flash medium \
    maya:maya-bakery2 devon:devon-kanban2:lunaroute/glm-5.3:high rosa:inventory:lunaroute/glm-5.3:medium
```

- **What `run.sh` does:** it writes `round.json`, then starts one pi per persona, staggered (`STAGGER`, default 8 s), each in `<round>/<name>/`. Only the lunaroute provider extension is loaded:

  ```
  pi -p --model <model> --thinking <level> --no-context-files --no-skills --no-mcp --no-prompt-templates \
     --no-extensions -e ~/.pi/agent/npm/node_modules/@lunaroute/pi-extension \
     --tools bash,read,write,edit --append-system-prompt "$(cat persona-prompt.md personas/<name>.md)" \
     --session-dir <round>/<name>/session "Begin. Your benchdrive name is <name>. …"
  ```

- **Extensions:** `--no-extensions` alone removes the lunaroute provider, and every persona exits with `No API key found for lunaroute`. Name the extension with `-e`.
- **App ids:** every persona needs an app id of its own (`name:app-id`), new or a fixture's. Reusing an id from an earlier round resumes that app.
- **Concurrency:** lunaroute serves up to six at once and throttles (429) above that. A round of six is fine.
- **The operator's command line is not the persona's.** pi's bash tool runs with your environment. In round 3 a persona found the real `slop` CLI on PATH, signed in as the operator against their default server, and ran `whoami`, `store ls` and an `import` that luckily failed. `run.sh` and `resume.sh` now put a `slop` shim first on PATH that answers "command not found", and point `SLOP_SERVER` and `SLOP_CREDENTIALS` nowhere. Do the same for any other CLI with credentials that a persona might reach.
- **A persona that stops early** (lunaroute's "the upstream stream failed before completion", or a restart you need) resumes from its pi session: `resume.sh <round> <name> <model> <thinking> ["message"]` continues it with the same prompt and keeps the earlier `pi.out`/`pi.err` as `.N`. Remove its exit line from `done.log` first, so the watcher counts it right.
- **Watch the start:** watch the first minutes of the daemon's log and the diaries. A persona that cannot sign in or find the chat is a harness bug every persona will hit. Watch with a loop that tolerates folders that don't exist yet (under bash: `shopt -s nullglob`; zsh errors on an empty glob).

## Fixing during a round

Read the struggles as they arrive. Most can be fixed while the round runs:

- **Fix in the worktree; don't deploy.** The server stays on one build for the whole round, so its findings stay comparable. The next round tests the fixes.
- **Check fixes on a second bench.** A bench store of its own on the same server (`benchnext`: `store new --type bench`, push, `app trust … workshop`, `policy set … sample @admin on`, a mount at `/benchnext`) shows a fix in a real browser without touching the bench the personas use.
- **Audit the bench yourself in a real browser** at a few window sizes (1600×1000, 1280×800, 900×900), light and dark: the main screen, Code with a type error, Review, Data, the Publish dialog. It takes minutes, and it found a 12-line Code editor at laptop width, an overflowing header and jargon in the Publish dialog.
- **Reproduce first.** Use the CLI or a probe persona (on an app of its own, so you don't disturb a persona), then write a test that fails without the fix. Round 1's actor bug was reproduced in three CLI calls and caught by a test that fails without the fix.
- **Before deploying a new bench build:**
  - Run a boot smoke: open the bench, create an app, open the Code view. No unit test covers the bench's boot, and round 1's fixes broke it once (`Records.get is not a function`).
  - Commit every build output. `make bench` also writes `pkg/doors/pages/assets/probe.js`, and leaving it out failed CI's freshness test.

## Reading the results

Browse a round:

```sh
node scripts/05-cosplay/browse.mjs various/persona-review-<date> --port 18600
```

The browser has three views of each round:
- **Each persona's verdict and struggles.**
- **Each persona's timeline:** the pi session (thinking folded, messages, every benchdrive command and its output), with the screenshot taken after each command beside it. You can watch the app evolve.
- **The diary, and a gallery of all the screenshots.**

**Mine the bench agent's evals too.** The personas show what people meet; the agent's own threads show where its API misleads it. `scripts/06-api-mining/mine.mjs` writes every eval step of the round's apps to JSONL, and `analyze.py` groups the failures and counts evals per turn. In the first three rounds this found a cap that cut 60 of 97 turns at 9 evals, a misdocumented return shape behind seven failures, and a regression in `lib.def` (analysis/03).

Collect the struggles with `grep -h "STRUGGLE:" <round>/*/diary.md`, then read each diary once in full. The grep finds what a persona named. The full read finds what it didn't notice, such as an agent reply that was wrong but sounded right.

Sort what you find into kinds:

| Kind | Example from the first rounds | Where the fix goes |
|---|---|---|
| A bench bug | a proposal type-checked against draft's actor | `web/bench`, with a test |
| A server bug | a reset instance's actor kept a closed SQL connection | `pkg/`, with a test that fails without the fix |
| A bench agent failure | probe files and test rows left in the app; "Empty completion" | the guide (`web/bench/src/agent/guide.js`), or the sample backend |
| A missing feature | "where is the link to my page?" after publishing | the bench, or the ticket's tasks with the persona's words |
| A harness artifact | the Code view "showed only 12 lines"; `confirm()` dismissed unseen | `scripts/04-benchdrive`, not the bench |

Before fixing a surprising struggle, check whether it's the harness: benchdrive may not show part of the screen. A good test is "would a person in a real browser have hit this?"

## Recording the review

For each round:

- **Don't restart the daemon mid-round.** It closes every persona's tab, and a turn in flight is lost. benchdrive reopens a lost tab on the persona's own app (since round 4; before, it opened the shared account's last app, and a persona's message went to another app's agent). Fixes found mid-round go to `benchnext` until the round ends.
- **Verify probe changes in a real frame** after rebuilding the server (frames load the server's probe): `scripts/06-api-mining/probe-check.mjs` writes a test page into a smoke app's entry page (only the entry page gets the runtime), in its own eval (writes commit at an eval's end), and restores it.
- **Give a migration persona time:** glm-5.3 on high thinking timed out twice at 4200 s with six personas throttled together.
- **Check for faked evals:** `node scripts/06-api-mining/faked.mjs <apps…>` counts agent replies that wrote eval code as text with no evals behind them. A persona's "it said done, but nothing changed" is the symptom.
- **Archive it:** copy the round's folder to `various/persona-review-<date>/r<N>/`, with diaries, pi sessions, `steps.jsonl`, shots and the daemon's log, plus `round.json`. Shrink the screenshots (1120 px wide, JPEG quality 55 roughly halves a round). Then run `OPERATOR_NAME=… OPERATOR_EMAIL=… OPERATOR_ID=… redact.py <archived round>`: it replaces any output of the operator's CLI and masks the operator's identity and standalone link tokens. A `k_` inside a pi session's `thinkingSignature` is base64, not a token.
- **Update the findings:** each finding, fixed (with its commit) or open.
- **Write a diary step:**
  - the branch, commit and models;
  - each persona's verdict and number of struggles;
  - the fixes, with commits;
  - what the harness or this playbook got wrong.

## What the first rounds taught

- **Proposals are the biggest barrier for people who don't code.** The bench's agent works in a proposal by default. All three non-programmers met it before anything else, and nothing told them to look at it and accept it.
- **Silent turns.** The bench's agent on `deepseek-4.1-flash` often ended a turn without a word. The sample backend now asks once for the reply, and the bench summarizes the evals when there's still none.
- **Every check needs a failure first.** A green tick that proves nothing was the ops persona's "most dangerous thing". The fix: scenario checks that can't pass on a substring, steps whose unknown keys are errors, a new stub that fails until it checks something, and a guide rule to show each check failing once.
- **People ask about the bench itself:** how to undo, how to publish, where the link is. The agent must answer those, and the bench must show the link.
- **Hand editing and reading long files** needed harness commands (`read`, `edit`). But the "12 lines" was also real at laptop width, as the visual audit showed.
- **Rotating models finds different bugs.** glm-5.3 writes code without semicolons, which exposed an ASI bug in the eval session's rewrite, and writes tool calls as text. deepseek ends turns silently. Mix them within a round.
- **Long turns need a visible clock.** Turns of 9 to 13 minutes that showed only "Working" made three personas think the bench had hung. A running reply now says how long it has worked and on what.
- **Multi-person apps can't be tried on one account.** A poll's second voter or a privacy rule between volunteers needs frames as different people (design-doc/02).

## Costs and limits

- **Model calls.** lunaroute is free here; the limit is its rate. A round of six personas runs 20 to 40 minutes.
- **A model is not a person.** Personas understate confusion (the model knows what "commit" means) and overstate patience. Read "it went fine" from a non-programmer as weak evidence.
- **Accounts.** By default every persona signs in as the local admin: they share the Recent list, layouts and each app's threads, and nothing about sharing or roles can be tested. `BENCHDRIVE_EMAIL` per persona gives each its own account. Whether a non-admin account can use the bench is itself a finding.
- **The harness can lie both ways.** If `look` misses part of the screen, the persona reports a missing feature that's there. If `look` lists something that is out of sight, the persona finds what a person wouldn't. Check a surprising struggle in a real browser, and keep one visual persona per round.
