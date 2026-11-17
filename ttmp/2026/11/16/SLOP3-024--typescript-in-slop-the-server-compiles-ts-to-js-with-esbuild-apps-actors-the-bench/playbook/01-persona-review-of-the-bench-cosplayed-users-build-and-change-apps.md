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
LastUpdated: 2026-11-16T21:41:43.634333253-05:00
WhatFor: "Finding where the bench, its agent and its guide fail real kinds of users, before real users do."
WhenToUse: "After a change to the bench, its agent, its guide or the platform under it (a new phase, a new template), and before a staging rollout."
---

# Persona review of the bench: cosplayed users build and change apps

## Purpose

<!-- What does this playbook accomplish? -->

## Environment Assumptions

<!-- What environment or setup is required? -->

## Commands

<!-- List of commands to execute -->

```bash
# Command sequence
```

## Exit Criteria

<!-- What indicates success or completion? -->

## Notes

<!-- Additional context or warnings -->

# Persona review of the bench: cosplayed users build and change apps

A persona review puts the bench in front of people who want something from it, and watches where they get stuck. The people are played by a coding model ("cosplayed"). Each persona has a background, a goal, and a way of working. Each one drives the bench's real page, talks to the bench's real agent, and keeps a diary of what it tried, what it expected, and what happened. We read the diaries, not the apps they built: the struggles are the result.

This playbook says how to set one up, how to write personas that find different problems, how to run them, and how to turn their diaries into fixes. SLOP3-024's phase 3 (type checking in the bench) is the first review run with it; the run's diary step records what this playbook got wrong.

## Why personas, and why not tests

The bench's tests check what we thought of. A persona finds what we did not think of, because it brings a goal we did not design for and reads the screen the way its background suggests.

Three properties make the method work:

- **The persona wants an outcome, not a feature.** "A preorder page for my bakery that I can share on Instagram" exercises templates, the agent's questions, publishing and sharing in an order no test follows. "Test the publish button" exercises the publish button.
- **The persona has limits.** A baker does not read stack traces. A TypeScript developer does read them, and also opens the Code view and edits by hand. Different limits push on different parts of the bench: the agent's explanations for one, the editor and the type checker for the other.
- **The persona writes down its confusion as it happens.** "I expected the page to change after the agent said it was done; it did not, until I reloaded" is a bug report with a reproduction. A test would have passed, because the page did change, just not where the persona was looking.

What a persona review does not do: it does not prove the bench works (the tests do that), and its personas are not real users. A model playing a baker still knows what a CSS selector is. The diaries are leads to check, not verdicts.

## The pieces

```
  persona (pi, deepseek-4.1-flash, thinking medium)
     │  bash: benchdrive <persona> <command>
     ▼
  benchdrive daemon (Playwright, one browser context per persona)
     │  clicks, types, reads the bench page
     ▼
  the bench (apps/bench on a local slop server built from the branch)
     │  its agent's turns call sample
     ▼
  slop's sample backend (llm: pi; tiers → lunaroute/deepseek-4.1-flash:medium)
```

There are two models in play, and they must not be confused:

1. **The persona** is a pi coding agent. It decides what to do next as the person would, and it can only touch the bench through `benchdrive` (a command-line driver for the page). It does not read the bench's source or the app's files on disk: a person could not.
2. **The bench's agent** is the agent inside the bench page, the one the person chats with. It runs on the local server's model tiers. Its quality is part of what is under review.

Both run on `lunaroute/deepseek-4.1-flash` with medium thinking: a capable, cheap model, so several personas can run at once and failures are not hidden behind a model that guesses around them.

## Setting up

### 1. A local server built from the branch

```sh
make runtime bench                       # the committed outputs are fresh
GOWORK=off go build -tags sqlite_fts5 -o $W/slop ./cmd/slop
cat > $W/config.yaml <<EOF
listen: 127.0.0.1:18492
data: $W/data
llm: pi
pi:
  models:
    quick: lunaroute/deepseek-4.1-flash:medium
    default: lunaroute/deepseek-4.1-flash:medium
    complex: lunaroute/deepseek-4.1-flash:medium
EOF
$W/slop serve --config $W/config.yaml --local --admin-email admin@example.com
```

Use a fresh data folder per review, so one run's apps do not show up in the next run's app list. Pick a port no other local server uses (`ss -ltnp | grep 1849`).

### 2. The bench, installed

```sh
export SLOP_CREDENTIALS=$W/creds.json SLOP_SERVER=http://slop.localhost:18492   # same line as each call
slop store new bench && slop push apps/bench --store bench
slop app trust bench workshop
slop policy set bench sample @admin on
slop mount set --host apps.localhost:18492 --path /bench --store bench
```

All personas sign in as the local admin and work on different app stores. That keeps setup short; it also means the review cannot find problems with sharing or permissions between people. A review of those needs one account per persona.

### 3. Fixtures for "change an existing app" personas

A persona that modifies an app needs one to exist first. Push it before the run (`slop store new quiz && slop push <folder> --store quiz`) from a folder under the ticket's `scripts/`, so the next review starts from the same app.

### 4. benchdrive

`scripts/04-benchdrive/` holds the driver. `benchdrive serve` starts a daemon holding one Playwright browser; each persona gets its own browser context (its own tab and storage). The client commands are what a person can do and see:

| Command | What the person does |
|---|---|
| `look` | reads the screen: the visible text of the bench's panels, the open view, the chat, the canvas frames' text, as compact text |
| `shot <file.png>` | takes a screenshot (the persona's model reads images) |
| `click <text or selector>`, `type <selector> <text>`, `key <key>` | uses the page |
| `new-app <id> <template>`, `open-app <id>` | the project menu, as a person would click through it |
| `ask <message>` | types into the agent's chat, sends, waits for the turn to end, and prints the reply with its eval effects |
| `frame-text`, `frame-shot <file>` | reads or screenshots the app's own page in the canvas |
| `view <Code\|Data\|Timeline\|Docs\|…>` | opens a view |

Each command prints what changed on screen as text, so a persona does not need to take a screenshot after every click. The driver adds nothing a person lacks: it reads only what the page shows.

## Writing personas

A persona is a short brief: who they are, what they want, how they work, and what they will not do. Four to six fields are enough:

```
Name and background:  Maya, owns a two-person bakery; uses Instagram and Square; has never written code.
Goal:                 A page where regulars preorder weekend bread by Thursday night, and a list she can print Friday morning.
Starts from:          a new app.
Works by:             asking the bench's agent in plain words; looking at the page in the canvas; never opening the Code view unless told to.
Gives up when:        the agent asks her something she cannot answer twice in a row, or nothing she can see changes for three turns.
Writes down:          every moment she did not know what to do next, in her own words.
```

Choose personas so that together they press on different parts of the bench:

| Axis | One end | The other end |
|---|---|---|
| Skill | never coded | writes TypeScript daily |
| Start | a new app from a template | changing an existing app |
| Surface | only the chat | the Code view, the Data view, scenarios, the Timeline |
| Risk | private tinkering | publishing to people who use it |
| Shape | a page only | a page, an actor, SQL migrations |

A review with three to five personas that differ on most axes finds more than ten that differ on one. For SLOP3-024's run:

1. **Maya, the baker** (never coded; new app; chat only; publishes). Tests the agent's plain-language explanations and the publish flow.
2. **Devon, the frontend developer** (TypeScript; new app with an actor and SQL; edits code by hand; reads type errors). Tests phase 3: the type checker in eval effects and in the Code view.
3. **Priya, the teacher** (some HTML; changes an existing quiz app to add a leaderboard; uses proposals because a class depends on the app). Tests changing a live app safely.
4. **Sam, the operations lead** (SQL, no JavaScript; a dashboard over a table; writes scenarios and fixtures to check it). Tests the Data view, fixtures and scenarios.

## The persona's instructions

Every persona gets the same frame around its brief (`scripts/05-persona-prompt.md`):

- **Stay in character.** Act on what the person would know. Do not read the bench's source, the server, or the app's files on disk; use only `benchdrive`.
- **Pursue the goal, not the review.** Do not test features for their own sake; do what the person would do next to get what they want.
- **Keep a diary** at `diary.md` in your workspace, in the diary format: one step per attempt, with the prompt you sent or the action you took, what you expected, what happened (quote the screen), and how you felt about it as the person ("I'm lost", "that was easy"). Write it as you go, not at the end.
- **Mark struggles** with `STRUGGLE:` and a one-line summary, so they can be collected with grep. A struggle is any moment the person would have needed help, retried, or been surprised.
- **Stop** when the goal is met, when the brief's "gives up when" fires, or after a turn budget (40 driver commands by default). End with a short verdict: did you get what you wanted, and would you come back.

## Running

```sh
scripts/05-cosplay-run.sh maya devon priya sam
```

The script starts the benchdrive daemon, then one pi process per persona, in parallel, each in `$W/personas/<name>/`:

```sh
pi -p --model lunaroute/deepseek-4.1-flash --thinking medium \
   --no-context-files --no-skills --tools bash,read,write \
   --append-system-prompt "$(cat persona-prompt.md personas/maya.md)" \
   --session-dir $W/personas/maya/session \
   "Begin. Your benchdrive name is maya."
```

`--no-context-files` and `--no-skills` keep the repository's own agent instructions out of the persona: it should know what its brief says, nothing more. Each run's pi session is kept, so a persona that stopped early can be continued with `--continue`.

A run of four personas takes 20 to 60 minutes. Watch the first five minutes of one persona's diary: a persona that cannot sign in or cannot find the chat is a harness bug, and every other persona will hit it too.

## Reading the results

Collect the struggles first:

```sh
grep -h "STRUGGLE:" $W/personas/*/diary.md | sort | uniq -c | sort -rn
```

Then read each diary in full, once. The grep finds the problems a persona named; the full read finds the ones it did not notice it had (an agent reply that was wrong but sounded right, a persona that worked around a broken button without saying so).

Sort what you find into four kinds:

| Kind | Example | Where the fix goes |
|---|---|---|
| A bench bug | the canvas frame did not reload after a commit | `web/bench`, with a test that reproduces it |
| A bench agent failure | the agent edited `actor.js` in a TypeScript app | the agent's guide (`web/bench/src/agent/guide.js`) or the API's errors |
| A missing feature | the baker wanted to print the order list | the ticket's tasks, with the persona's words as the reason |
| A harness or persona artifact | the persona read a file on disk; benchdrive missed a dialog | `scripts/04-benchdrive` or the persona prompt; not the bench |

Every bench bug and agent failure gets a reproduction before it is fixed: the persona's diary step, reduced to the smallest sequence that shows it. A struggle that only one persona hit once, and that cannot be reproduced, is recorded and left.

## Recording the review

The review's step in the ticket's diary lists:

- the branch and commit under review, the model and thinking level of both the personas and the bench's agent;
- each persona's brief, verdict and number of struggles, with a link to its diary under `various/persona-review-<date>/`;
- the sorted findings, each with its fix's commit or its task;
- what this playbook got wrong, and the change made to it.

Copy the diaries into the ticket (`various/persona-review-<date>/<name>.md`). They are the evidence; the run's working folder is not kept.

## Costs and limits

- **Model calls.** Each persona makes one model call per step and the bench's agent several per turn; a four-persona review is a few hundred calls on deepseek-4.1-flash.
- **A model is not a person.** Personas understate confusion (the model knows what "commit" means even when the baker would not) and overstate patience. Read "it went fine" from the baker as weak evidence.
- **One account.** Sharing, roles and multi-person editing are out of reach until personas get accounts of their own.
- **The harness can lie.** If benchdrive's `look` misses part of the screen, the persona will report a missing feature that is there. Check a surprising struggle in a real browser before fixing the bench.
