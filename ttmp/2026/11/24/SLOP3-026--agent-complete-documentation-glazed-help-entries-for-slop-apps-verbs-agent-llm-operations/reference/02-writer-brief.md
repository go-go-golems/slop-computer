---
Title: Writer brief for slop help pages
Ticket: SLOP3-026
Status: active
Topics:
    - documentation
DocType: reference
Intent: short-term
Summary: "The shared instructions every writer of a slop help page follows: audience, verification, conventions, local server, safety."
---

# Writer brief for slop help pages (SLOP3-026)

Read the design doc first: `design-doc/01-design-making-slop-usable-by-an-agent-without-the-source.md`
(section 3.4 is the page plan: every slug, its type and its sources).
Then read `pkg/doc/topics/01-slop-overview.md`: it fixes the vocabulary. Use its words.

## Audience

An LLM agent that has the `slop` binary and a login, and **no source code**. It
reads `slop help <slug>`. Everything it needs to build, deploy, use and debug
must be on the page or on a page it links. So:

- Never tell the reader to read source files. Name commands, verbs, manifest
  fields, JavaScript APIs and error codes instead.
- Show complete, runnable examples: whole `app.json` files, whole small
  `actor.js` / `index.html` / `verbs/*.js` files, exact command lines with
  their output (trimmed). Prefer examples you actually ran.
- State limits, defaults and error codes exactly. If something is unverified,
  leave it out or mark it plainly ("not checked").

## Truth comes from the code, not the old docs

`doc/building-apps.md`, `doc/production.md`, `doc/claude-apis/*.md` are good
material; `doc/design/slop-v3.md` is design history and is **out of date** in
places (for example grant subjects are `@guest`, `@member`, `@subscriber`
groups, not `*signed-in`). Check every claim against the code (`pkg/`,
`cmd/slop/`, `pkg/doors/pages/assets/claude.js` for the page runtime, `apps/`
for working examples) and, where possible, by running it.

## Conventions (Glazed help entries)

File: `pkg/doc/<topics|tutorials|examples|applications>/NN-<slug>.md`.
Frontmatter, exact keys:

```yaml
---
Title: "…"
Slug: "the-slug-from-the-plan"
Short: "One sentence; not a copy of the first paragraph."
Topics:
- …
Commands:      # real slop commands the page uses: store, push, mount, policy, llm, on, …
- …
Flags:
- …
IsTopLevel: false     # true only where the plan says "Top: yes"
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic   # or Tutorial, Example, Application, per the plan
---
```

- No top-level `#` heading (Glazed renders the title). Use `##` sections.
- Present tense, active voice. Each major section opens with what it covers,
  how it works, and why it matters. Explain failure modes.
- End every page with `## Troubleshooting` (a `Problem | Cause | Solution`
  table) and `## See Also` (other slugs, as `slop help <slug>`).
- Refer to other pages by slug from the plan, even if not written yet.
- Do not restate every flag of a verb (that is `slop <group> <verb> --help`);
  show the verb in use and say which arguments are positional.
- After writing, run `GOWORK=off go test ./pkg/doc/` (every page parses, slugs unique)
  and look at the page with your own build: `<your-slop> help <slug>`.

## Your own local server (never the default login)

The default login on this machine points at a real server. **Never use it.**
Always set all three variables in every shell that runs `slop`:

```bash
W=<your scratch dir>; P=<your port>
export SLOP_CREDENTIALS=$W/creds.json SLOP_SERVER=http://slop.localhost:$P XDG_CONFIG_HOME=$W/config
cd /home/playback/code/tulip/slop-computer
GOWORK=off go build -tags sqlite_fts5 -o $W/slop ./cmd/slop
$W/slop serve --local --llm fake --data $W/data --listen 127.0.0.1:$P --admin-email admin@example.com > $W/server.log 2>&1 &
echo $! > $W/server.pid
until curl -s -o /dev/null http://slop.localhost:$P/; do sleep 0.5; done
# CLI login: device flow, approved by a headless browser signing in as admin@example.com
$W/slop auth login --name writer > $W/login.log 2>&1 &
until grep -q 'code=' $W/login.log; do sleep 0.2; done
PW=/tmp/claude-1001/-home-playback-code-tulip-slop-computer/cd6dab48-60b6-4f72-b76b-2de328524958/scratchpad/pw
(cd $PW && CHROME=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome node approve.mjs "$(grep -o 'http[^ ]*device?code=[A-Z0-9-]*' $W/login.log)")
wait %2; $W/slop whoami
```

Hosts on that server: main `slop.localhost:$P`, live `apps.localhost:$P`,
static `site.localhost:$P`, sandbox `*.sbx.localhost:$P`. `--llm fake`
answers "slop is connected." to sample, and in agent sessions a message
`/tool <name> {json}` calls that tool. To drive a page in a browser, Playwright
is installed in `$PW` (`import { chromium } from 'playwright'`, launch with
`executablePath: process.env.CHROME`); `$PW/drive.mjs` is a working example
(signs in, finds the app frame, drives Pinboard's agent panel).
Stop your server when done: `kill $(cat $W/server.pid)`.

## Scope rules

- Write only your assigned pages under `pkg/doc/`. Do not edit any other file
  (code, `doc/`, apps, other pages). Do not commit.
- If you find a bug, a confusing behaviour, or a contradiction between the old
  docs and the code, do not fix it: put it in your report.

## Your report (final message)

1. Pages written (path, slug, one line each).
2. What you verified by running, and what you could not.
3. Contradictions found (old docs vs code), with the correct behaviour.
4. Bugs or rough edges in slop worth fixing (command, what happened, expected).
5. Anything a reader would still have to guess.
