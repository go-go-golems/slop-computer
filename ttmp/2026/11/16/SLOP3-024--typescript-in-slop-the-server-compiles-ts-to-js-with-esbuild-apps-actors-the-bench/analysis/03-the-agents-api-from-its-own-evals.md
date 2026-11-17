---
Title: "The agent's API, from its own evals"
Ticket: SLOP3-024
Status: active
Topics:
    - frontend
    - apps
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: web/bench/src/core/api.js
      Note: the API table; `ret` and the reference line
    - Path: web/bench/src/worker/rewrite.js
      Note: shadowed API names; lib.def's free-name analysis
    - Path: web/bench/src/agent/agent.js
      Note: turn continuation past one call's 9 evals
    - Path: web/bench/src/frames/probe.js
      Note: Playwright-style text selectors
ExternalSources: []
Summary: "690 eval steps of the bench agent from the persona reviews, mined for where the JS API and its documentation failed the agent; what each failure pattern was and the fix in the API rather than in more guide rules."
LastUpdated: 2026-11-17T00:15:00-05:00
WhatFor: "Improving the bench agent's API and its reference from evidence."
WhenToUse: "Before changing the agent's API or guide; to repeat the mining after a persona round."
---

# The agent's API, from its own evals

The persona reviews showed the bench through the eyes of the people using it. The bench's own agent left a second record: every eval it ran, with its code and outcome, sits in the app's threads. That record shows where the JavaScript API and its documentation mislead the agent. This document covers the mining, what it found, and what changed.

## The method

`scripts/06-api-mining/mine.mjs` signs in to the review server in a headless browser, opens each app through the bench's own `Projects.open`, loads every thread, and writes one JSON line per eval step: app, thread, turn, status, code, output. It only reads. `analyze.py` groups the failures by message, shows the failing line of each, counts the calls, and gives the number of evals per turn.

```sh
node scripts/06-api-mining/mine.mjs steps.jsonl <app> <app> …
python3 scripts/06-api-mining/analyze.py steps.jsonl
```

Rounds 1 and 2 gave 520 steps, 52 of them failed. The first apps of round 3 gave 170, 18 of them failed.

## What it found

| Pattern | Evals | What the agent did | The fix |
|---|---|---|---|
| Turns cut at 9 evals | 60 of 97 turns | Stopped mid-task at exactly 9 evals; the person had to say "continue" | A turn continues a call that used all its evals, up to its budget (e8575e7) |
| A wrong return shape | 7 | `layout.filter(…)`: the doc said "every rendered element", but `frames.layout` returns `{…, items}` | `ret` in the API table, shown in the reference and in `help()` (c182885) |
| A shadowed API name | 5 | `const frames = await frames.list()`; `const [info, app] = await par([app.info()])`: "files is not initialized" | The eval is refused before it runs, naming the variable (c182885) |
| A regression | 4 | Every `lib.def` failed: "collectPattern is not defined" | The helper moved with `rewrite()`; now exported and tested (50481c3) |
| ASI in the eval rewrite | ~7 | "not a function" on a `])` line | Fixed in round 2 (8185257) |
| No instance yet | 2 | `app.sql` right after `app.reset()`: "no store …-dev-…" | `app.reset` waits for the fresh instance; data calls start a missing one and retry |
| A list given as an object | 2 | `fixtures.capture(name, {tables: {orders: …}})`: "not iterable" | An object's keys are accepted |
| Playwright selectors | 2 | `article:has(h2:has-text("…")) input`: "bad selector" | `:has-text()` followed by more selector, inside `:has()`, and `:text()` |
| A bare refusal | 2 | A write through `app.sql`: "not authorized" | It says to use `app.exec` |
| No `Intl` | 1 | `Intl.DateTimeFormat()` in the sandbox | The guide says so; the person's local time is in the context |

The table's `doc` strings already reached the agent in the guide's reference, but `help()` showed only signatures, and no entry said what a call returns unless its doc happened to.

## How agents use the API

The 25 most used calls, over rounds 1 to 3:

> files.read 509, files.replace 182, app.sql 164, frames.text 146, files.write 101, scenarios.run 98, frames.type 98, frames.click 90, files.lines 70, app.status 66, types.check 61, frames.check 55, frames.query 48, frames.list 40, scenarios.save 40, files.grep 37, frames.inspect 35, frames.reload 34, app.info 30, files.list 30, session.mark 29, app.logs 28, app.exec 25, scenarios.runAll 24, frames.waitFor 22

`help()` appeared in 24 evals: agents rely on the reference in their instructions, so the reference has to carry the return shapes. `Promise.all` (170) is used more than `par` (87); both work.

## What the fixes deliberately don't do

- **No more rules in the guide for these.** Each failure was a mismatch between what the API did and what a careful reader of its reference would expect. The API changed, or says more, so the next agent doesn't need a rule to avoid the trap.
- **No higher server limit.** A page's sample call keeps its 10 rounds, which bound cost per call. The bench continues a full call within its own turn budget of 30 evals.

## Repeating it

After each persona round, mine the round's apps and compare with the table above: a new pattern with more than one eval is worth a fix. The verification scripts beside `mine.mjs` are:

- `qsa-test.mjs`: the selector forms against a real DOM;
- `e2e.mjs`: `help()`, refusals and `lib.def` through the bench's Eval view on a second bench;
- `cont.mjs`: a 12-eval request in one turn.
