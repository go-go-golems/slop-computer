---
Title: "Pinboard: shared boards with an agent"
Slug: "pinboard"
Short: "Deploy and use Pinboard: boards of clips, collections and small apps, its agent panel, its LLM setup, and every slop pb verb."
Topics:
- pinboard
- apps
- app-verbs
- agent
- llm
Commands:
- "on"
- store
- push
- mount
- grant
- policy
- llm
- link
- docs
Flags:
- storeParam
- type
- createApp
- format
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: Application
---
Pinboard is the app that ships with slop to show what a full app looks like:
pages, an actor, a database, presence, uploads, an LLM agent and
command-line verbs. Each **board** is its own store, shared on its own. On a
board you paste things and they become **clips**: notes, links, images
(screenshots), docs (long text or HTML), groups, and windows of small
**apps**. Clips can be promoted into **collections** (small databases of
**records**), and apps written in a short JavaScript grammar show and edit
them. An agent panel on the right organises the board and builds apps.

This page covers deploying it, what a board is, the agent panel, what the LLM
needs, and every `slop pb` verb with real output.

## The pieces

| Store | What it is |
| --- | --- |
| `pinboard` | The app store: `index.html` and `js/` (the page), `actor.js` (the board's operations for the CLI, MCP and the `ask` agent), `verbs/` (the command-line verbs). Its manifest declares `db`, `user`, `room`, `assets`, `downloads`, `sample`, `agent`, type `pinboard`, and the verbs alias `pb` with titles at `board/meta`. |
| `pinboard-home` | A small page listing your boards ("Yours", "Shared with you") with a New board button. |
| one store per board | Type `pinboard`, app `pinboard`, owned by whoever created it. Clips, collections, records, the board's apps and its shared log are documents in it. |

## Deploying

Run as an admin, from a checkout's `apps/` folder (or wherever the two
folders are). `apps.example.com` is your live host (`slop mount ls` shows
the hosts in use; on a local server it is `apps.localhost:<port>`).

```sh
slop store new pinboard
slop push ./pinboard --store pinboard
slop store new pinboard-home
slop push ./pinboard-home --store pinboard-home

# Who may use what: members get the model and uploads in this app.
slop policy set pinboard sample @member on      # the agent panel and board ask
slop policy set pinboard assets @member on      # pasted images and files (on for members by default)
slop llm set @member on --budget 200000         # members may spend tokens (once per server)

# Boards: /pb/<id> opens a board; a member may create one there.
slop mount set apps.example.com /pb/:id --storeParam id --type pinboard --createApp pinboard

# The board list, for signed-in members.
slop grant set pinboard-home @member view
slop mount set apps.example.com /boards pinboard-home
```

What each mount does:

- `/pb/:id` names the store from the path (`--storeParam id`), serves only
  stores of type `pinboard` (`--type`), and offers to create one
  (`--createApp pinboard`, for `--createAudience member` by default).
- `/boards` serves `pinboard-home`, which lists the boards you can open. The
  grant lets members view it; guests are told to sign in.

All of these commands are idempotent except `store new` (it fails if the
store exists; skip it on a re-deploy). To upgrade, push again: every board
follows `pinboard`'s `main` and picks up the new snapshot on its next use.

## Boards

**Creating.** A member opens `/boards` and clicks New board, or opens any
`/pb/<id>` that does not exist and clicks "Create a new one". The server
creates a store with a **fresh id** (`s-e3owvugb`; the id in the URL is not
used) and redirects to it. The creator owns it. The first time an admin or
owner opens it, the page seeds a "Read me" doc, two sample clips, a sample
app, and the title "Untitled board" in `board/meta`.

A board can also be made from the CLI. It then starts empty (no seed, no
title until someone sets one):

```sh
$ slop store new garden --app pinboard --type pinboard
$ slop pb garden clip add --text "plant tomatoes"
$ slop pb garden board describe
Untitled board  (garden)
1 clips · 0 collections · 0 records · 0 apps

  clip:8xazr8j99c  note   plant tomatoes
```

**Titles.** The title is the `title` field of the board's `board/meta`
document, edited in the page (admins) or with
`slop docs update <board> board/meta --data '{"title":"Kitchen"}'`. With
the `pb` alias a title works in place of the id: `slop pb Kitchen …`.

**Sharing** is per board; nobody but the owner and platform admins can open
a new board.

```sh
slop grant set s-e3owvugb usr_… interact        # one person may edit
slop grant set s-e3owvugb @member view          # every member may look
slop link new s-e3owvugb interact --days 7      # a share link (token shown once)
```

Levels on a board: `view` reads everything and may ask the agent read-only
questions; `interact` adds, moves, tags and removes clips and records;
`admin` also edits the title and registers board apps; `owner` is the
creator. Every change is a step in the board's shared log (`board log`),
which says who made it and from where (`Admin (cli)`, `agent (for Ana)`).
The log keeps at least the newest 500 steps and anything newer than 30 days.

## The agent panel

The panel on the right of a board is an agent with one tool, `eval`: it runs
JavaScript steps in the page against the same API the board's apps use, and
shows each step (code and result) in the thread.

- **Engine.** When the viewer's page may use the `agent` capability, each
  thread runs on a server-held session: **one session per thread and tier**
  (keyed `pinboard:<thread>:<tier>`), which keeps the history and runs the
  tool loop. Otherwise the panel falls back to `sample` (the page sends the
  whole thread each time). Without either, the panel is a **console**.
- **Images.** Under `agent`, messages are text only: selected image clips are
  **named, not sent** (the panel warns "the agent cannot see images here: they
  are named, not sent"). Only the `sample` fallback sends image bytes.
- **Modes.** **Auto** runs every step; **Ask** (the default) shows each step
  and waits for Run this step or Decline; **Read-only** runs steps but
  refuses mutations.
- **Tiers.** **Fast**, **Balanced** (default) and **Deep** map to the model
  tiers `quick`, `default` and `complex`. Changing the tier starts a new
  session for the thread, which is given the earlier messages once.
- **Console.** A message starting with `>` runs as a step directly, without
  the model: `> describe()`, `> db.collections()`.
- **Revert.** A step that changed the board has "revert to before this step",
  which undoes it and everything after it. `⌘Z` undoes one step at a time.

## What the LLM needs

The panel and `board ask` both call the model as the **viewer**, who pays
from their own budget. Both need:

1. The app's policy cell for the viewer's audience:
   `slop policy set pinboard sample @member on` (one cell covers members,
   subscribers and admins; add `@guest` for guests with a share link). The
   `sample` cell also governs the `agent` capability.
2. The viewer's LLM access: `slop llm set @member on --budget 200000`
   (by default only `@admin` has access). `slop llm usage` shows spending.
3. A model backend on the server (`slop help llm-backend-pi`).

Missing pieces show as: the panel offering only the console; `board ask`
failing with `unavailable: this board's agent is off: an admin must allow
sample for the pinboard app`; `no LLM access` for a
person without access. With `slop serve --llm fake`, `board ask` answers
`The browser tool completed successfully.` (the fake calls the first tool
once), and in the panel a message `/tool eval {"code":"return 6 * 7"}` runs a
step.

## The verbs: slop pb

`slop pb <board> …` works on a fresh machine: the CLI asks the server which
app the board runs and learns the alias (see `slop help using-app-verbs`). In the commands below `<board>` is an id or,
with `pb`, a title. Positional arguments are shown in angle brackets.

| Verb | Arguments | Level |
| --- | --- | --- |
| `board describe` | — (prints text) | view |
| `board log` | `--limit` (20) | view |
| `board ask <question>` | the question, quoted (prints text; no `--format`) | view (writes need interact) |
| `board ask-json <question>` | the same, as one row: `answer`, `model`, `steps` (each tool the agent called: `tool`, `input`, `write`, `error`) | view (writes need interact) |
| `clip add` | `--text` or `--url`, `--title`, `--tags`, `--note` | interact |
| `clip ls` | `--kind`, `--tag`, `--q`, `--limit` (50) | view |
| `clip rm <id>` | the clip id | interact |
| `clip tag <id>` | `--add`, `--remove` (lists) | interact |
| `coll ls` | — | view |
| `coll query <coll>` | `--where field<op>value` (repeat), `--order-by`, `--desc`, `--limit` (100) | view |
| `coll insert <coll>` | `--set field=value` (repeat); makes the collection if new | interact |

Clips:

```sh
$ slop pb Kitchen clip add --url https://example.com/recipe --title "Lentil soup" --tags recipe --note "from Ana"
+-----------------+------+
| id              | kind |
+-----------------+------+
| clip:d2q0j8s9sc | link |
+-----------------+------+
$ slop pb Kitchen clip ls --tag recipe --format json
[
{
  "id": "clip:d2q0j8s9sc",
  "kind": "link",
  "tags": ["recipe"],
  "title": "Lentil soup",
  "url": "https://example.com/recipe"
}
]
$ slop pb Kitchen clip tag clip:vldtwysxg1 --add urgent --remove errand
+-----------------+------------------+
| id              | tags             |
+-----------------+------------------+
| clip:vldtwysxg1 | shopping, urgent |
+-----------------+------------------+
$ slop pb Kitchen clip rm clip:kega1uqadb
+-----------------+
| removed         |
+-----------------+
| clip:kega1uqadb |
+-----------------+
```

`clip add` needs `--text` or `--url` (`invalid_argument: give text, url or
asset`); a new clip goes below everything on the board and appears at once
on every open copy of it. `clip ls --kind` takes `note`, `link`, `image`,
`doc`, `app` or `group`; `--q` matches any text of the clip.

Collections. Values given to `--set` and `--where` become numbers or
booleans when they look like one. `--where` operators: `=` or `==`, `!=`,
`<`, `<=`, `>`, `>=`, and `~` for "contains":

```sh
$ slop pb Kitchen coll insert recipes --set name="Lentil soup" --set minutes=35 --set vegan=true
+---------+----------------+
| coll    | id             |
+---------+----------------+
| recipes | rec:d0rm1qv1t5 |
+---------+----------------+
$ slop pb Kitchen coll insert recipes --set name=Omelette --set minutes=10 --set vegan=false
$ slop pb Kitchen coll ls
+-------+----------------------+---------+
| count | fields               | name    |
+-------+----------------------+---------+
| 2     | minutes, name, vegan | recipes |
+-------+----------------------+---------+
$ slop pb Kitchen coll query recipes --where 'minutes<30'
+---------------+---------+----------------+---------+----------+-------+
| added         | coll    | id             | minutes | name     | vegan |
+---------------+---------+----------------+---------+----------+-------+
| 1795564343456 | recipes | rec:8tqrht0j6k | 10      | Omelette | false |
+---------------+---------+----------------+---------+----------+-------+
$ slop pb Kitchen coll query recipes --order-by minutes --desc --format yaml
```

The board:

```sh
$ slop pb Kitchen board describe
Kitchen  (s-e3owvugb)
4 clips · 1 collections · 2 records · 1 apps

  clip:d2q0j8s9sc  link   Lentil soup  #recipe
  clip:vldtwysxg1  note   Milk  #shopping #urgent
  clip:5ti1yppf2n  link   Are.na  #inspo
  clip:ov0rp26l70  doc    Read me  #help

collections:
  recipes (2): minutes, name, vegan
$ slop pb Kitchen board log --limit 3
+---------------+-------------+---------------+-------------------------------------+--------+
| at            | by          | id            | label                               | undone |
+---------------+-------------+---------------+-------------------------------------+--------+
| 1795564343456 | Admin (cli) | tx:5s64srb4fb | insert recipes                      | false  |
| 1795564343424 | Admin (cli) | tx:9fycmxcojm | collection recipes · insert recipes | false  |
| 1795564343335 | Admin (cli) | tx:kcatqg442l | remove clip:kega1uqadb              | false  |
+---------------+-------------+---------------+-------------------------------------+--------+
$ slop pb Kitchen board ask "which recipes take under half an hour?"
```

`board ask` runs the board's agent **on the server** (the actor's `ask`
action, with `sample`), with the board's actions as tools: the read tools
for anyone who can view, the write tools only for `interact` and up. Its
changes are logged as `agent (for <you>)`. It prints the answer as plain
text, so it has no `--format`; it may take as long as the model does.
From a script, use `board ask-json`: the same call as one row, with
`steps` listing each tool the agent called (`write: true` for a change,
`error` when the tool failed), so you can tell what it did without reading
the log. The
same verbs are MCP tools (`pb_board_ask`, `pb_clip_add`, …; `slop app tools`).

Without the verbs, the same operations are actor actions:
`slop call <board> describe`, `clips`, `addClip`, `removeClip`, `tagClip`,
`collections`, `query`, `insert`, `update`, `log`, `ask`.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `unknown command "pb" for "slop"` | No board after `pb`, or the store is not a pinboard (the error then names its app) | `slop pb <board> …`; `slop on <board> …` |
| `/pb/kitchen` opened a board called `s-…` | Boards created from the page get a fresh id | Use the id it redirected to, or `slop store new kitchen --app pinboard --type pinboard` |
| "There is nothing here yet" without a create button | You are not signed in, or not in the mount's create audience | Sign in; `slop mount set … --createAudience member` |
| `/boards` asks guests to sign in, or shows nothing | No grant on `pinboard-home` | `slop grant set pinboard-home @member view` |
| The agent panel is only a console | No `sample` policy for your audience, or no LLM access | `slop policy set pinboard sample @member on`; `slop llm set @member on` |
| `unavailable: this board's agent is off` from `board ask` | The `sample` policy is off for every audience | As above |
| `unknown flag: --format` on `board ask` | It prints text | `board ask-json … --format json` for the answer and the steps |
| `unknown flag: --id` on `clip rm` | The id is positional | `slop pb <board> clip rm clip:…` |
| `permission_denied: addClip needs interact; you have view` | You may only view this board | Ask the owner: `slop grant set <board> <you> interact` |
| A new snapshot is not used | The board does not follow `main` | `slop app status <board>` |

## See Also

- `slop help using-app-verbs` — aliases, discovery and arguments of app verbs
- `slop help app-verbs` — how Pinboard's verbs are written
- `slop help actors` — Pinboard's actor and its `ask` action, in general terms
- `slop help capability-agent` — the agent capability the panel runs on
- `slop help llm-access` — policy cells, LLM access and budgets
- `slop help deploying-apps` — mounts, `--createApp`, grants
- `slop help access-control` — levels, groups and share links
