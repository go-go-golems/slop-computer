---
Title: The artifact runtime: apps, targets, and their data
Slug: runtime
Short: How apps run on slop (window.claude), where their state lives, and how an agent reads and writes it with slop data and slop room.
Topics:
- runtime
- apps
- agents
Commands:
- data
- room
- push
IsTemplate: false
IsTopLevel: true
ShowPerDefault: true
SectionType: GeneralTopic
---

slop hosts the claude.ai Artifact runtime contract natively. A page that
declares `capabilities` in its `slop.json` is an **app**: when the Workshop
opens it, the page gets `window.claude.use(name)` for `db`, `user`, `room`,
`comments`, `assets`, `downloads`, `artifact`, `sample` and `permissions`,
with the contract's limits and error codes. A page written for claude.ai runs
unchanged.

```json
{ "title": "Tracker", "kind": "page",
  "capabilities": { "db": { "rules": [{ "path": "notes", "write": "owner" }] },
                    "user": { "scopes": ["profile"] }, "room": {}, "sample": {} } }
```

## Apps and targets

- **A target** is the artifact whose state a view uses: its db, its room, its
  assets. An app opened on itself is its own target.
- **A data artifact can name its app** (`app`), so one app serves many
  targets: a Pinup design runs `pinup`, a Blocks workspace runs `blocks`.
  The app's manifest gives the rules.
- **The Workshop** opens a target at `/run/<target>`, on the target's own
  origin (`s<label>.<sandbox domain>/v/<n>/`). The page's runtime talks only to
  that origin.

New targets: Artifacts ▸ *New with an app…*, or
`POST /api/artifacts {"id", "title", "kind": "data", "app"}`.

## Reading and writing an app's data: slop data

The same verbs as Claude's ArtifactData tool, through the same rules and
events as the pages; open tabs update live.

```sh
slop data get    ws-team tasks/t1
slop data list   ws-team tasks
slop data query  ws-team tasks --where 'done == false' --order due:desc --limit 20
slop data set    ws-team tasks/t2 --data '{"title": "Write the brief"}'
slop data update ws-team tasks/t2 --data '{"done": true}'          # merges; the document must exist
slop data str-replace ws-team notes/n1 body --old 'teh' --new 'the'
slop data delete ws-team tasks/t2
slop data batch  ws-team ops.json                                   # [{op, path, data?, if_version?}], at most 50
```

- `data/users/me/…` is your own private subtree (it becomes
  `data/users/<your id>/…`).
- `--if-version N` writes only if the document is at version N (0: absent).
- `--as-level view|interact|admin` checks what a lower level could do.
- **Paths:** documents have an even number of segments (`tasks/t1`),
  collections an odd number (`tasks`). Bodies are JSON objects up to 256 KiB.

## Being in the room: slop room

```sh
slop room watch ws-team --presence '{"status": "reading"}'   # join as an agent peer; print events
slop room emit  ws-team ping '{"n": 1}'
```

What a page hands to Claude (`room.sendToClaudeSession`,
`comments.sendToClaude`) becomes a thread on the app, anchored
`{"claude": true, "target": …}`; `slop comments wait` returns it. A page sees
"available" only while an agent waits on the target, its app or its project.

## The slop capability

An app may ask for slop's own API: `"slop": {"permissions": ["routes:write",
…]}` in its capabilities. An admin approves each version (Apps menu ▸
*Approve vN…*); until then `claude.use("slop")` is null and everything else
still works. `slop` gives `get/post/put/patch/del(path)`, `stream`, `on`,
`can(permission)`, `open(target)` and `config`.

## sample

`sample` runs on Pi's models and credentials (`slop serve --models pi`, Go on
geppetto; `--models pi-node` for the Node worker):
any model and effort Pi has credentials for, with page tools, for admins
only. `(await sample.limits()).models` lists them.
