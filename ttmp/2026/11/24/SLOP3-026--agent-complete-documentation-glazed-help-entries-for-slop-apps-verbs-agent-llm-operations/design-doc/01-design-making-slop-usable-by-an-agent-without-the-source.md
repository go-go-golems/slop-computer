---
Title: 'Design: making slop usable by an agent without the source'
Ticket: SLOP3-026
Status: active
Topics:
    - documentation
    - cli
    - apps
    - agent
    - llm
    - deployment
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Put everything an agent needs to use slop, build apps, write CLI verbs and operate a server into Glazed help entries embedded in the slop binary (slop help <slug>), fix the small CLI and app rough edges found while testing on the DGX, and verify it by having an agent without source access build and deploy an app."
LastUpdated: 2026-11-24T18:41:24.034620317-05:00
WhatFor: "Deciding what the slop help system contains, where it lives, and how it is checked."
WhenToUse: "Before writing or reorganising slop documentation, or adding a page to slop help."
---

# Design: making slop usable by an agent without the source

## 1. Goal

An agent that has the `slop` binary, a login and nothing else — no checkout,
no ticket history, no Go or JavaScript source — must be able to:

- understand what slop is (stores, apps, snapshots, mounts, hosts, people,
  levels, grants, policy, LLM access) well enough to reason about errors;
- use a server from the CLI: log in, list and inspect stores, read and write
  documents, files and tables, follow logs, explain access decisions;
- build an app (page, actor, manifest, capabilities), deploy it (store, push,
  refs, mounts, grants, policy), iterate on it (draft, `slop dev`), and test it;
- give the app command-line verbs, and use any app's verbs;
- use the LLM from pages (`sample`, `agent`) and from actors, and administer
  who may (the `llm` table, policy cells, budgets);
- run a server: configuration, hosts and TLS, OIDC, the Pi model backend,
  health, backups, upgrades.

The binary is the delivery vehicle: whatever `slop help` shows is what the
agent knows. The per-verb reference already ships (`slop verbs`, every
`slop <group> <verb> --help`, typed schemas); what is missing is everything
around it.

## 2. What is missing today (inventory)

Found while deploying slop-computer on the DGX on 2026-11-23/24 (dgx-side-k3s
diary steps 20–22) and porting Pinboard to the agent capability (branch
`task/pinboard-agent-capability`, 8ab3ae1). Each item cost a source read, a
wrong guess, or a retry.

| # | Gap | Where it was learned | Cost |
| --- | --- | --- | --- |
| G1 | App command-line verbs (`slop.verbs`, `__verb__`, the `slop` module, `slop on`, aliases) are documented nowhere in `doc/` | `pkg/appverbs`, `cmd/slop/cmds/appverbs.go`, SLOP3-016/017 | source read |
| G2 | How the CLI discovers verbs (server, `app@snapshot` cache, `aliases.json`, fresh machine) | `knownAliases`, `rememberAlias` | source read, then a test |
| G3 | Verb arguments: some are positional (`coll insert <coll>`, `board ask <question>`), `board ask` has no `--format` | trial and error | three failed commands |
| G4 | `agent` capability: messages are text only (no images); tier/model/effort fixed at `open`; `s.fresh`; tools fixed at `open`; open sessions hold an event stream | `claude.js`, `pkg/doors/pages/agent` | source read |
| G5 | LLM on a server: which Pi agent-dir files are read, read-only mount is fine, never share a rotating OAuth credential, `llm` table defaults to `@admin` only, `sample` policy also governs `agent`, `slop sample run` to verify | geppetto `providers/pi`, `pkg/host` | source read |
| G6 | `slop docs …` is the store-document verbs, not documentation | `slop docs --help` | a wrong turn an agent will take first |
| G7 | Actor API (`use`, `actions`, `ctx`, `db`, alarms, endpoints, `sample` in an actor) has 18 lines in `building-apps.md` | Pinboard's `actor.js` | source read |
| G8 | Manifest fields (`app.json`) beyond capabilities: `type`, `page`, `actor`, `slop.verbs`, `title` | `pkg/apps/manifest.go`, Pinboard | source read |
| G9 | Unknown alias on a fresh machine: `unknown command "pb"` with no hint | test | confusion |
| G10 | SLOP3-025 e2e approve script cannot find a browser on arm64 | test | patching the script |
| G11 | (dgx-side-k3s) cert-manager after a DNS token rotation: VSO `refreshAfter: 1h`, expired ACME orders, manual `Issuing` trigger | the 2026-11-24 import | 20 minutes |

The `doc/` tree (2,065 lines: `building-apps.md`, `production.md`,
`claude-apis/*`) is good material but is not in the binary and not
discoverable from the CLI; `doc/design/slop-v3.md` is design history, not
user documentation.

## 3. Decisions

### 3.1 The help lives in the binary, as Glazed help entries

- A package `pkg/doc` embeds `topics/`, `tutorials/`, `examples/` and
  `applications/` (Glazed's directory convention) with `//go:embed`, and
  `AddDocToHelpSystem(hs)` loads them.
- `cmd/slop/cmds.Root()` creates the help system, loads the pages and calls
  `help_cmd.SetupCobraRootCommand(hs, root)` once. `slop help` lists the
  top-level pages, `slop help <slug>` shows one, `slop help --all` lists
  everything, `slop help --topics x` filters.
- The root `Long` text points at `slop help slop-overview` and
  `slop help agent-quickstart`, so the first `slop --help` an agent runs tells
  it where to go.
- App verb commands (`slop on`, aliases) keep their own `--help` (flag parsing
  is off there); the root help must not swallow it. Checked by a test.

### 3.2 One source of truth

The content of `doc/building-apps.md`, `doc/production.md` and
`doc/claude-apis/*.md` moves into help pages (rewritten to the Glazed style,
split by subject, corrected against the code). The old files become one-line
pointers (`slop help <slug>`, and the page's path), so there is never a second
copy to drift. `doc/design/slop-v3.md` stays as it is: it is design history.
`README.md` gains a "Documentation: `slop help`" line.

As built: `doc/claude-apis/{state-storage,files,people-and-collaboration,sample-spec}.md`
stay, because they are claude.ai's contract, copied unchanged so the runtime can
be checked against it; only their README's slop-differences table became a
pointer. `doc/production.md` keeps its "Importing francois releases" section,
which uses this repository's scripts.

### 3.3 Two layers, no duplication with the verb table

- **Reference per verb** stays generated: `slop <group> <verb> --help` and
  `slop verbs`. Pages never restate a verb's flags; they show it in use and
  name it (`Commands:` frontmatter), so `slop help --command store` finds them.
- **Pages** carry what the verb table cannot: concepts, workflows, the page
  runtime and actor APIs, the manifest, app verbs, operations, troubleshooting.

### 3.4 Page plan

Slugs are stable names an agent can be told about. Types follow Glazed:
GeneralTopic (concept/reference), Tutorial (steps), Example (one task),
Application (an end-to-end use).

| Slug | Type | Top | Content | Sources |
| --- | --- | --- | --- | --- |
| `slop-overview` | GeneralTopic | yes | what slop is; the glossary (server, hosts, store, app, snapshot, ref, draft, mount, person, role, audience, group, level, grant, policy, capability, actor, verb, LLM access); how to find things (`slop help`, `slop verbs`, `--help`, `slop on <store> --help`); `docs` = documents | README, slop-v3.md, `pkg/access`, `pkg/verbs` |
| `agent-quickstart` | Tutorial | yes | for an agent: log in (device login needs a person to approve; `--server`, `SLOP_SERVER`, `SLOP_CREDENTIALS`), `whoami`, `-o json`, discovering verbs, reading errors (`code`, `message`), `explain can`, `slop verb <name> --json` | `cmd/slop/cmds/*`, `pkg/client` |
| `cli-reference-guide` | GeneralTopic | no | how verbs map to commands, positional arguments vs flags, `--json`, output formats, `slop eval`, `slop verb`, exit codes and error shape | `cmd/slop/cmds/root.go`, `pkg/verbs` |
| `access-control` | GeneralTopic | yes | people, roles, audiences and groups (`@guest` ⊂ …), levels (view, interact, admin, owner), grants, share links, guests, `policy` (capability × app × audience), trust, `explain can` | `pkg/access`, `pkg/policy`, `pkg/authz` |
| `store-data` | GeneralTopic | no | documents (`docs`), files and the tree (`files`, `pull`, `push`), snapshots and refs (`snap`, `ref`), tables (`sql`), the log (`log`, `log wait`), alarms, secrets | `pkg/commands`, `pkg/store` |
| `building-apps` | GeneralTopic | yes | four kinds of app, the files of an app, page vs actor, choosing capabilities, patterns that held, caching, testing, production checklist | `doc/building-apps.md` |
| `app-manifest` | GeneralTopic | no | every `app.json` field with an example; every capability's declaration form | `pkg/apps/manifest.go`, `pkg/rt/manifest.go` |
| `deploying-apps` | Tutorial | no | store, push, refs, follow, draft and publish, `slop dev`, mounts (static, live, `storeParam`, `createApp`), grants, policy, trust, an idempotent deploy script, several stores as one site | `doc/building-apps.md` §3, `pkg/commands/mounts.go` |
| `page-runtime` | GeneralTopic | no | `window.claude`, `claude.use(name)`, consent, how slop differs from claude.ai, errors | `doc/claude-apis/README.md`, `claude.js` |
| `capability-db`, `capability-assets`, `capability-artifact` | GeneralTopic | no | state storage, split by capability | `doc/claude-apis/state-storage.md` |
| `capability-user`, `capability-room`, `capability-comments` | GeneralTopic | no | people and collaboration | `doc/claude-apis/people-and-collaboration.md` |
| `capability-files`, `capability-downloads` | GeneralTopic | no | files | `doc/claude-apis/files.md` |
| `capability-sample` | GeneralTopic | no | `sample`, `sample.json`, limits, options, page tools, errors, `mcp` | `doc/claude-apis/sample-spec.md` |
| `capability-agent` | GeneralTopic | no | server-held sessions; the G4 rules; session keys; `fresh`; routing tools; closing; limits; with `--llm fake` | `claude.js`, `pkg/doors/pages/agent`, bench, Pinboard |
| `capability-slop` | GeneralTopic | no | the management API from a page (`slop.call`, `slop.read`, `slop.stores`), permissions | `pkg/doors/pages/views.go` |
| `actors` | GeneralTopic | no | `actor.js`: `use()`, actions and `requires`, `ctx` (visitor, fail), `db`, alarms, endpoints, `sample` in an actor, turns, limits | `pkg/actor`, `pkg/jsrt`, Pinboard and examples |
| `app-verbs` | Tutorial | no | writing verbs (G1): manifest block, `__verb__`, fields (`argument`, types), `doc` blocks, the `slop` module, what verbs cannot do, testing | `pkg/appverbs`, Pinboard `verbs/` |
| `using-app-verbs` | GeneralTopic | no | running verbs (G2, G3, G9): discovery, cache, aliases, positional arguments, `--help` at each level | `cmd/slop/cmds/appverbs.go` |
| `llm-access` | GeneralTopic | no | the `llm` table, budgets, usage, policy cells, `sample run`, what a page and an actor need (G5) | `pkg/llm`, `pkg/policy` |
| `server-configuration` | GeneralTopic | no | `slop.yaml`, hosts, DNS and TLS, OIDC (ZITADEL), Kubernetes, health, backups, upgrades, importing | `doc/production.md` |
| `llm-backend-pi` | GeneralTopic | no | `llm: pi`, the agent dir, tiers and thinking, credentials guidance (G5), `--llm fake` | `pkg/llm/gepp`, geppetto `providers/pi` |
| `tutorial-first-app` | Tutorial | yes | from an empty folder to a deployed app with a page, an actor, a db rule, a verb and a mount, on a local server | written and executed |
| `pinboard` | Application | no | boards, mounts, the agent panel (agent capability), its verbs, LLM setup for it | `apps/pinboard` |
| `troubleshooting` | GeneralTopic | yes | error codes and what to do, by symptom | collected from all pages |

Every page ends with a troubleshooting table and See Also, per the Glazed
style guide.

### 3.5 Code changes that belong with the docs

- **C1** `pkg/doc` + root wiring (3.1), with a test that every embedded `.md`
  parses (the loader skips bad frontmatter silently), slugs are unique, every
  `Commands:` entry names a real command, and `slop on --help` still reaches
  the app verbs.
- **C2** (G9) an unknown command that looks like an app alias answers with a
  hint: `slop on <store> …` teaches the CLI an app's alias.
- **C3** (G3) Pinboard's `board ask` returns structured output like the other
  verbs, or the help says why not.
- **C4** (G10) the SLOP3-025 approve script takes `CHROME` for the browser
  path; Pinboard's agent-panel drive script joins it as `03-pinboard-agent-e2e.mjs`.
- **C5** (G11, dgx-side-k3s) a recovery.md section for DNS-token rotation and
  `refreshAfter: 1m` on `cert-manager-digitalocean`.

## 4. Verification

1. `go test ./pkg/doc/... ./cmd/slop/...` (C1's checks).
2. Every command shown in a page is either run during writing against a local
   `slop serve --local --llm fake` or marked as illustrative.
3. **The acceptance test is a persona matrix, not one run** (section 4.1).

### 4.1 Persona runs against the help

The method comes from the Factory Shots cosplay batches and the Asset Studio
persona runs (playback-vault `ARTICLE - Factory Shots - Playbook - Evaluating
and Improving the Agent With Cosplay Batches`; tulip/playback PR #1193,
`tools/agent-eval/` and `docs/operations/agent-prompt-playbook.md`). Three of
its findings decide the design here:

- **Agents learn from errors, not docs.** In 230 Factory Shots evals the agent
  read the docs 4 times and fixed nearly every failure on the next eval from
  the message alone. So a run's failed commands are the main evidence, and a
  fix goes to the strongest place first: a command that makes the mistake
  impossible, then the error message (with the `slop help <slug>` it should
  read), then a check for a silent mistake, and only then a page.
- **A judge without settled facts rewards plausible stories.** Here the facts
  are cheap and objective: whether the store and mount exist, whether the page
  answers 200, whether the db rule refuses the write, whether the verb runs and
  what it prints. A checker script settles the checklist; the model judge only
  scores what a command cannot (did it ask, was the answer honest, how many
  commands were wasted).
- **Check the tester before believing it.** In Asset Studio 33 of 49 "declined"
  edits were a tester bug. Read a pilot of 4 runs in full before a batch.

**The subject is a coding agent, not an in-app agent.** Each run is a headless
coding agent (Claude Code `-p`, or pi) in an empty directory with only the
built `slop` on `PATH`, `SLOP_SERVER`/`SLOP_CREDENTIALS`/`XDG_CONFIG_HOME` set
to its own local server (`slop serve --local --llm fake`, one port per run),
and no access to the repository (enforced by the sandbox, and counted: any
read outside the run directory is a finding). The persona writes the task and
the follow-ups; there is no browser except where a scenario needs one (the
checker drives it with Playwright).

**Personas** (each finds different failures):

| Persona | Knows | Writes | Exposes |
| --- | --- | --- | --- |
| App builder | HTML/JS, nothing about slop | "I want a shared todo list my team can use" | building-apps, manifest, deploy, mounts |
| Data scripter | Shell and JSON | "Load these 200 rows into the board and list the overdue ones" | store data verbs, app verbs, `--format` |
| Operator | Servers, OIDC, budgets | "Let members use the LLM, 50k tokens each a month" | server config, llm, policy, grants |
| Verb author | Writes CLIs | "Add a command so I can do this from my terminal" | actors, `__verb__`, aliases |
| Skeptic | Enough to check | "Can a guest really not write to it? Show me." | `explain can`, honesty, verification |

**Scenarios** (10–12, a difficulty ladder over the page plan; one or two
`heldOut`): deploy a static page; a page with a db rule; a page that calls its
actor; an app with an LLM call (fake model, `/tool`); an agent-capability page;
a command-line verb with a positional argument; using an existing app's verbs
(Pinboard); granting and checking access; LLM budgets for a group; an
`app.json` that fails to load and must be fixed. Openings are in the persona's
words, never the API's ("a todo list my team shares", not "use the db
capability").

**Per run, recorded:** every command with its exit status and stderr; the
`slop help` slugs read (and when: before or after a failure); reads outside the
run directory; the checker's facts; the judge's scores (goal, grounding,
honesty, efficiency, communication) with the facts; a debrief turn ("what did
you wish you had known, which error or page misled you").

**Analysis per round:** list every failed command with the next command,
classify by what would have prevented it (cause table of
`agent-prompt-playbook.md` section 3), fix in the order above, rerun the same
seeds, compare. A debrief claim is a hypothesis to check against the trace.
Done when a round has no failure whose cause is "missing reference" or
"ambiguous reference" and the held-out scenarios pass.

Cost: with `--llm fake` the server is free; the subject agent and the persona
and judge models are the cost (about 8–12 runs per round).

## 5. Non-goals

- Serving the help over HTTP from the server (later: the same embedded FS
  could back `/help`).
- Rewriting `doc/design/slop-v3.md`.
- Generating pages from the verb table (it already has its own help).
