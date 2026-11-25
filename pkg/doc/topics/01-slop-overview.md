---
Title: "slop: what it is and how to find your way"
Slug: slop-overview
Short: "The words slop uses (store, app, snapshot, mount, level, grant, policy, verb) and where to read more."
Topics:
- overview
- concepts
Commands:
- help
- verbs
- whoami
IsTopLevel: true
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
slop is a server that hosts apps on **stores**. A store is a durable object
with documents, files and tables; an **app** is code that runs against a
store: pages in the browser and, optionally, an **actor** on the server. The
same table of **verbs** serves this CLI, the HTTP API and server-side
`eval`, so anything a page or an admin can do has a command.

This page defines the words every other page uses. Read it once; when an
error mentions a level, a grant or a policy, come back here.

## The nouns

Each word means one thing everywhere: in the CLI, in errors, in the back
office and in these pages.

| Word | Meaning |
| --- | --- |
| **Server** | One `slop serve` process with its data directory. The CLI talks to one server at a time (`--server`, `$SLOP_SERVER`, or your default login). |
| **Host** | A name the server answers on, with a role: **main** (sign-in, back office, API, CLI device login), **live** (apps in the shell, guests, share links), **static** (published files, no sessions), **sandbox** (`s<label>.<sandbox host>`: every store's pages run on their own origin). |
| **Store** | The unit of data and access: an id, a type, an app, an owner. It holds documents (JSON at paths like `tasks/t1`), files (a versioned **tree**, plus runtime **assets**), SQL tables, a log of commits, and alarms. |
| **App** | A store whose tree contains `app.json`. Other stores *run* it: a Pinboard board is a store whose app is the store `pinboard`. An app's code is its tree: `index.html` and friends for pages, `actor.js` for the server side, `verbs/*.js` for command-line verbs. |
| **Snapshot** | The tree frozen at a point, numbered `1, 2, 3…`. `slop push` makes one. A store runs one snapshot of its app at a time. |
| **Ref** | A movable name for a snapshot, like `main`. `slop push` moves `main` by default; a store can follow a ref (`slop app follow`). |
| **Draft** | A working copy of an app you push to on every save while developing (`slop dev`), before you publish it to `main`. |
| **Mount** | A host plus a path pattern pointing at a store: `/boards` → the store `pinboard-home`, or `/pb/:id` → whichever store the path names. A mount never names code; the store's app does. |
| **Person** | Someone who signed in (`usr_…`), with a **role**: `pending` (signed up, waiting), `member`, `admin` or `disabled`. Visitors without an account are **guests** (`vis_…`). |
| **Token** | What the CLI holds after `slop auth login` (`tok_…`). It acts as its person, limited by its **scopes** (`read`, `write`, `admin`). |
| **Audience and groups** | Every caller falls in one audience: guest, member, subscriber or admin. Groups nest: `@guest` ⊂ `@member` ⊂ `@subscriber` ⊂ `@admin`, so a rule for `@member` covers subscribers and admins too. `@store` is a store acting on its own. |
| **Level** | Your standing on one store: `view` < `interact` < `admin` < `owner`. A store's creator owns it; platform admins are admin everywhere. |
| **Grant** | Gives a subject (a person, a guest, `store:<id>`, or a group like `@member`) a level on a store: `slop grant set <store> @member view`. |
| **Capability** | A named API an app's pages or actor ask for with `use(name)` / `claude.use(name)`: `db`, `user`, `room`, `assets`, `sample`, `agent`… An app declares what it uses in `app.json`. |
| **Policy** | Which audiences may use a capability in one app: `slop policy set pinboard sample @member on`. |
| **LLM access** | Who may spend model tokens, and how many per month: `slop llm set @member on --budget 200000`. A model call needs both the app's policy and the person's LLM access. |
| **Actor** | The live server-side instance of one store, running its app's `actor.js`, one **turn** (event) at a time. |
| **Verb** | One operation of the server: `store.new`, `mount.set`, `docs.get`. `slop store new` is the verb `store.new`. |
| **App verbs** | Commands an app ships for the CLI (`slop on <store> …`, or an alias like `slop pb <board> …`). They run on your machine and reach the store only through its actor. |

## How to find things

slop documents itself on three levels; use them in this order.

1. **Pages (this help).** `slop help` lists the main pages, `slop help --all`
   lists every page, `slop help <slug>` opens one. Start with
   `agent-quickstart`, then `building-apps` if you are writing an app.
2. **Verbs.** `slop verbs` lists every server verb with a one-line doc;
   `slop <group> --help` lists a group, and `slop <group> <verb> --help`
   shows its arguments. Arguments marked `<name>` in the usage line are
   positional; the rest are flags.
3. **App verbs.** `slop on <store> --help` lists the commands of the app that
   store runs, whatever the app.

To see who you are acting as, run `slop whoami`. To see why something is
allowed or refused, run `slop explain can <store> [level]` (add `--path` and
`--op write` for a document, `--subject` for someone else).

One trap: **`slop docs` is not documentation.** It is the group of verbs for
a store's *documents* (`docs.get`, `docs.set`, `docs.query`). Documentation is
`slop help`.

## How the pieces fit

A request for `https://apps.example/pb/kitchen` goes through these steps:

1. The **live host** finds the **mount** `/pb/:id`, which names the store
   `kitchen` from the path.
2. `kitchen` runs the app `pinboard` at some **snapshot**; that snapshot's
   `index.html` is served in a frame on `kitchen`'s **sandbox origin**.
3. The page calls `claude.use('db')`; the server checks the viewer's
   **level** on `kitchen` against the app's `db` rules.
4. The page calls an action of the actor through the `slop` capability
   (`(await claude.use('slop')).call('addClip', {…})`); the **actor** runs it
   as one turn, which commits atomically to `kitchen`'s log.
5. A model call (`sample`, `agent`) also needs the app's **policy** for the
   viewer's audience and the viewer's **LLM access**.

The CLI goes through the same checks: `slop on kitchen clip add …` calls the
same actor action, as you, with your level.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `permission_denied` | Your level on the store is below what the operation needs | `slop explain can <store> <level>` shows your level and the trace; ask the owner for a grant |
| `not_granted` on a capability | The app does not declare it, or the policy is off for your audience | Check `app.json`; `slop policy ls <app>` |
| Model calls refused: `permission_denied: no LLM access` (CLI, `agent`), `upstream_error` "no LLM access" (`sample`) | No LLM access for you, or the budget is used up | `slop llm usage`; an admin runs `slop llm set`; see `llm-access` |
| `unknown command` for an app alias | The CLI has not seen that app yet | Run `slop on <store> --help` once; see `using-app-verbs` |
| You looked for docs under `slop docs` | `docs` is the document verbs | Use `slop help` |

## See Also

- `slop help agent-quickstart` — logging in and the first commands
- `slop help access-control` — levels, grants, groups and policy in depth
- `slop help building-apps` — writing an app
- `slop help using-app-verbs` — running an app's command-line verbs
- `slop help troubleshooting` — every error code, what causes it, which page to read
