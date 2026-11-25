---
Title: "Using an app's command-line verbs"
Slug: "using-app-verbs"
Short: "Run any app's verbs with slop on or an alias such as slop pb: discovery, the cache, positional arguments, --help at each level, other servers."
Topics:
- app-verbs
- cli
- apps
Commands:
- "on"
- app
- store
Flags:
- server
- format
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
Apps can ship command-line verbs: Pinboard has `clip add`, `coll query`,
`board ask` and more. You run them on one store that runs the app, as
yourself, with your level on that store. This page explains how to find them,
how the CLI gets them, and how their arguments work. To write verbs for your
own app, see `slop help app-verbs`.

## Two ways to call them

```sh
slop on <store> <command> [args] [flags]       # any app, by store id
slop <alias> <store> <command> [args] [flags]  # the app's alias, e.g. slop pb
```

`slop on` works for every app and every store you may view. An app may
declare an **alias** (Pinboard's is `pb`); `slop pb kitchen clip ls` is then
the same as `slop on kitchen clip ls`. With an alias you may also name the
store by its **title** instead of its id (`slop pb Kitchen …`, matched
case-insensitively among your stores of that app's type).

```sh
$ slop pb s-e3owvugb clip add --text "Buy oat milk" --tags shopping,errand --title Milk
+-----------------+------+
| id              | kind |
+-----------------+------+
| clip:vldtwysxg1 | note |
+-----------------+------+
$ slop pb Kitchen clip ls --kind link --format csv
id,kind,tags,title,url
clip:d2q0j8s9sc,link,[recipe],Lentil soup,https://example.com/recipe
```

A store with no verbs says so: `error: pinboard-home runs pinboard-home,
which ships no command-line verbs`. An id the server does not know, without
an alias: `error: no store "Kitchen" (give a store id; titles work with an
app's alias, such as slop pb <title>)`.

## --help at each level

Every level of the command line has its own help; use them top-down.

```sh
$ slop on s-e3owvugb --help            # the app's command groups, and the store's title
pinboard's verbs on Kitchen (s-e3owvugb)

Usage:
  slop on s-e3owvugb [command]

Available Commands:
  board       All commands for board
  clip        All commands for clip
  coll        All commands for coll
$ slop pb s-e3owvugb clip --help       # the verbs of one group
$ slop pb s-e3owvugb coll query --help # one verb: its positional arguments and flags
Rows of one collection. Conditions are field<op>value, for example
--where 'minutes<30' --where 'tags~easy' (~ is "contains").

Usage:
  slop pb s-e3owvugb coll query <coll> [flags]
  …
```

`slop pb --help` (no store) only prints the usage line; the verbs depend on
the app the store runs, so the store comes first. `slop --help` lists the
aliases this machine knows (`pb  The pinboard app's verbs: …`).

## Positional arguments and flags

In a verb's usage line, words in angle brackets are **positional** and come
right after the verb; everything else is a `--flag`. A positional argument
without a default is required.

```sh
slop pb kitchen coll query recipes --where 'minutes<30'   # <coll> is positional
slop pb kitchen coll insert recipes --set name=Omelette --set minutes=10
slop pb kitchen clip rm clip:kega1uqadb                   # <id> is positional
slop pb kitchen board ask "what is on this board?"        # <question> is positional
```

Getting it wrong:

```text
$ slop pb kitchen clip rm --id clip:kega1uqadb
error: unknown flag: --id
$ slop ty t1 counter add
error: accepts between 1 and 1 arg(s), received 0
```

- Flag names are kebab case: a field `orderBy` is `--order-by`.
- List flags repeat or take commas: `--tags a --tags b` = `--tags a,b`.
- `--format table|json|jsonl|csv|tsv|yaml` chooses the output of verbs that
  return rows (`--output-fields` picks columns). `-o json` works too: on an
  app verb it means `--format json`.
- Verbs that print text (Pinboard's `board ask`, `board describe`) have no
  `--format` (`unknown flag: --format`). Their help shows no `--format` flag.
- A verb that returns nothing prints nothing.
- Errors print `error: <code>: <message>` and exit 1, like the built-in verbs.

## How the CLI finds verbs

App verbs are not built into the binary. On every `slop on <store> …` the CLI:

1. Asks the server (`app.verbs`) which app and **snapshot** the store runs,
   telling it which `app@snapshot` it already has cached for that store.
2. If the snapshot changed (or nothing is cached), downloads the verb files
   (the JavaScript listed in the app's `slop.verbs.include`) and caches them
   as `apps/<app>@<snapshot>.json`. A snapshot never changes, so a cached one
   is reused for every store that runs it.
3. Records the alias, if the app has one, in `aliases.json`.
4. Builds the commands and runs yours locally, in a sandbox that reaches the
   server only through that store's actions and documents, with your token.

So **a new push is picked up automatically**: the next command on a store
that follows `main` sees the new snapshot and fetches its verbs. There is
nothing to refresh by hand.

The cache lives under your config directory (`$XDG_CONFIG_HOME`, else
`~/.config` on Linux), one directory per server URL:

```text
$XDG_CONFIG_HOME/slop/verbs/
  slop.localhost_18606-895203180b6d/      # <host>_<port>-<hash of the server URL>
    aliases.json                          # {"pb": {"app": "pinboard", "type": "pinboard", "title": "board/meta"}}
    apps/pinboard@1.json                  # the verb sources of one snapshot
    apps/tally@2.json
    stores/s-e3owvugb                     # the app@snapshot that store ran last: "pinboard@1"
```

Clearing the cache is always safe: `rm -rf ~/.config/slop/verbs` (or the one
server's directory). The next `slop on` fetches again; aliases are forgotten
until then.

## A fresh machine: aliases are learned

The CLI keeps the aliases it has seen in its config directory. On a fresh
machine, or with an empty config directory, it does not know `pb` yet, so it
asks the server: when the first word is not a command and a store follows it,
the CLI fetches that store's verbs, and if the store's app has that alias it
learns it and runs the command. Nothing has to run first:

```text
$ slop pb s-e3owvugb board describe       # first use on this machine: works, and learns pb
```

If the store runs another app, the error names that app's alias:

```text
$ slop pb scores ls
error: unknown command "pb": scores runs tally, whose alias is tally (slop tally scores …), or use slop on scores …
```

`slop on <store> …` always works, with or without an alias. A word with no
store after it (`slop pb` alone) stays `unknown command` until the alias is
learned.

To find which stores run which app: `slop store ls` (the `app` and `type`
columns). Board-like apps usually have a mount where people create their
stores; `slop mount ls` shows them. An alias that collides with a built-in
command is never added: use `slop on` for that app.

## Other servers and MCP

- `--server <url>` works anywhere on the line (`slop on t1 --server
  https://slop.example.com report summary`); `$SLOP_SERVER` and the default
  login apply as for every command. Each server has its own cache directory,
  so the same alias may mean different apps on different servers.
- `slop app verb <store> "<words>" --values '<json>'` runs a verb **on the
  server** with JSON values instead of flags (keys are the flag names:
  `{"coll": "recipes", "order-by": "minutes"}`), and returns
  `{output, result}`. MCP clients use this.
- `slop app tools` lists the verbs of the apps your stores run as MCP tools
  (`pb_clip_add`, `pb_coll_query`, …; only apps with an alias), each with a
  JSON schema whose `store` property names the store.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `unknown command "pb" for "slop"` | No store after the alias (`slop pb` alone), or the word is not an alias of any app the CLI knows | Give a store: `slop pb <store> …` (the CLI asks the server); or `slop on <store> …`; `slop store ls` to find a store of that app |
| `no store "X" (give a store id; …)` | A title given to `slop on`, or a typo | Use the id (`slop store ls`), or the alias with the title |
| `none of your pinboards is called "X"` | No store of yours of that type has that title | `slop store ls`; titles are case-insensitive but exact |
| `N of your pinboards are called "X": a, b` | Two stores share a title | Give the id |
| `… which ships no command-line verbs` | The app has no `slop.verbs` | Use the app's pages or `slop call <store> <action>` |
| `unknown flag: --x` / `accepts between 1 and 1 arg(s)` | A positional argument given as a flag, or missing | Read the usage line: `<name>` is positional |
| `unknown flag: --format` | A text verb | It prints text only |
| `permission_denied: … needs interact; you have view` | Your level on that store | `slop explain can <store> interact`; ask the owner for a grant |
| `<app>@N's verbs: …` | The app's verb files have an error | Tell the app's author; `slop call <store> <action>` still works |
| Old verbs after a push | The store does not follow `main`, or the push went to another ref | `slop app status <store>` shows the snapshot it runs |

## See Also

- `slop help app-verbs` — writing verbs for your own app
- `slop help pinboard` — Pinboard's verbs, one by one
- `slop help cli-reference-guide` — the built-in verbs, output formats, errors
- `slop help agent-quickstart` — logging in, `--server`, `SLOP_SERVER`
- `slop help actors` — the actions behind the verbs
