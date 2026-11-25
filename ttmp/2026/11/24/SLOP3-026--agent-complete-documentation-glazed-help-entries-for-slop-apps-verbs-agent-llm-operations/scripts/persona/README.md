# Persona runs against `slop help` (SLOP3-026, design 4.1)

A run is one conversation: a coding agent works for a simulated person on
its own fresh local slop server, with the `slop` binary and its help pages
and **no source code**. Afterwards a checker settles the facts on the
server, the agent is asked what it wished it had known, and a judge scores
the conversation against the facts. The method follows the Factory Shots
cosplay playbook and tulip/playback PR #1193 (`tools/agent-eval`).

All three models are lunaroute's `deepseek-4.1-flash` through pi:

| Role | How | Sees |
| --- | --- | --- |
| Agent under test | `pi -p --mode json`, thinking high, read/bash/edit/write, in `box.sh` | its work dir, a private home, `slop` on PATH, logged in as the server's admin |
| Persona | `pi -p --no-tools`, thinking low | its card, the scenario's opening, goal and follow-ups, the agent's replies (not its commands) |
| Judge | `pi -p --no-tools`, thinking high | the checklist, the facts, the checker's results, the transcript with every command |

## The box

`box.sh` runs the agent in bubblewrap with only the system (`/usr`, `/etc`
read-only), node and pi, pi's npm packages, the slop binary, a work dir and
a home. The repository, `~/.config` (real slop logins), `~/.claude` and the
real `~/.pi` (sessions, every provider's credentials) are not there. The
environment is empty but for `HOME`, `PATH`, `TERM` and `SLOP_SERVER`.

The agent's pi config (`AGENT_DIR`) holds only the lunaroute entries of
`auth.json` and `models-store.json` and a minimal `settings.json`. Make it
without printing the files:

```bash
A=<scratch>/agentdir; mkdir -p $A; chmod 700 $A
(umask 077; jq '{lunaroute: .lunaroute}' ~/.pi/agent/auth.json > $A/auth.json
 jq '{lunaroute: .lunaroute}' ~/.pi/agent/models-store.json > $A/models-store.json)
echo '{"defaultProvider":"lunaroute","defaultModel":"deepseek-4.1-flash","quietStartup":true}' > $A/settings.json
```

Delete it when done. `--no-extensions -e <lunaroute>` keeps the user's own
pi extensions (session summaries, direnv, …) out of the agent.

## Running

```bash
export SLOP_BIN=<built slop> AGENT_DIR=<scratch>/agentdir PW_DIR=<dir with node_modules/playwright> \
       CHROME=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome
node run.mjs tally-verb --slop $SLOP_BIN --port 18701 --batch pilot-1   # one run
./batch.sh round-1 3                                                      # every scenario not heldOut
node summarize.mjs round-1
```

Each run writes `runs/<batch>/<scenario>/`: `run.json` (turns, commands,
checks, metrics, debrief, judge), `transcript.md`, the agent's raw pi events
(`agent-NN-*.jsonl`), `server.log`. `runs/` is not committed (it holds
tokens of throwaway local servers).

## Cards

- `personas/*.json`: `id`, `name`, `knows`, `style`, `patience`, `text`.
- `scenarios/*.json`: `persona`, `maxTurns`, `setup` (shell, run on the host
  as the admin before the conversation; `$SLOP`, `$PORT`, `$WORK`, `$SETUP`,
  `$RUN`), `opening` (in the person's words, never slop's), `goal`, `later`,
  `checklist`, `facts` (for the judge only), `personaKnows`, `heldOut`.
- `checks/<scenario>.sh`: prints one JSON line per fact,
  `{"check", "ok", "detail"}`, using `checks/lib.sh`.

## Reading a round

1. Read the pilot runs in full before believing any number (the tester can
   be wrong: Asset Studio's first "declines" were a tester bug).
2. `summarize.mjs` lists every failed command with the one after it. Classify
   each by what would have prevented it, and fix in this order: a command
   that makes the mistake impossible, the error message (naming the
   `slop help` page), a check for a silent mistake, and only then a page.
3. Check every debrief claim against the transcript before acting on it.
4. Rerun the same scenarios; compare.
