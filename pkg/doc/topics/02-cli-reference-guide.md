---
Title: "The slop CLI: how commands, arguments, output and errors work"
Slug: "cli-reference-guide"
Short: "The rules every slop command follows: verbs as commands, positional arguments and flags, --json, output formats, eval, verb, call, the local commands, exit status."
Topics:
- cli
- reference
- verbs
Commands:
- verbs
- verb
- eval
- call
- auth
- serve
- dev
- push
- pull
- vendor
- "on"
- help
Flags:
- server
- output
- json
- read-only
- args
- ts
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
This page is the grammar of the `slop` command line: how a server verb turns
into a command, how arguments are given, what is printed, and what a failure
looks like. Once you know these rules, any verb's `--help` is enough to use
it. Per-verb details (each flag, each type) stay in
`slop <group> <verb> --help` and `slop verbs tools`; this page does not
repeat them.

## Verbs become commands

The server has one table of **verbs**, the operations of the platform, named
`group.name` (`store.new`, `docs.get`, `grant.set`). The same table serves
the HTTP API (`POST /api/v1/<verb>`), server-side `eval` programs, and this
CLI. The CLI is generated from the copy of the table built into the binary:

- A verb `group.name` is the command `slop <group> <name>`:
  `docs.get` is `slop docs get`.
- A verb without a dot is a top-level command: `whoami` is `slop whoami`.
- `slop <group> --help` lists a group's verbs; `slop verbs` lists them all.

Each verb has an **effect**, shown by `slop verbs`:

| Effect | Meaning | Token scope needed |
| --- | --- | --- |
| `read` | Changes nothing | `read` |
| `write` | Changes data | `write` |
| `govern` | Changes who may do what (roles, policy, LLM access, secrets); an app asking for it needs the person's confirmation | `write`, and usually the admin role |
| `stream` | The answer arrives in parts, then whole (`sample run`) | as its scope |

Admin-only verbs also need the admin role and a token with the `admin`
scope: `people.*`, `policy.*`, `llm.ls/set/rm/reset`, `secret.*`,
`sql.query`, `sql.exec`, `app.follow`, `app.trust`, `app.untrust`,
`mount.set`, `mount.routes`, `mount.rm`, `mount.undo`, `store.type`, `log.system`, `guest.sweep`,
`sub.grant/ls/revoke`. Their doc line usually says "(admins)".

## Arguments: positional, flags, and --json

A verb's arguments have names and types (`string`, `int`, `bool`, `json`).
The usage line in `--help` shows which are positional:

```text
slop grant set <store> <subject> <level> [flags]
slop docs set <store> [path] [flags]
slop explain can <store> [level] [flags]
```

- `<name>`: required, positional, in that order.
- `[name]`: optional positional.
- Every argument, positional or not, is **also a flag** of the same name:
  `slop docs get notes tasks/t1` equals
  `slop docs get --store notes --path tasks/t1`.
- Some required arguments are flags only. They are listed in the verb's
  schema (`slop verbs tools files.commit` → `required: [store, base, changes]`)
  and, when missing, the server answers
  `invalid_argument: files.commit needs base`.
- More positional words than the usage line allows is a CLI error:
  `accepts at most 2 arg(s), received 3`.

**Types.** Flags are text on the command line and are converted by type:

| Type | Give it as | Notes |
| --- | --- | --- |
| `string` | `--path tasks/t1` | |
| `int` | `--limit 10` | Text that is not a number is sent as text, and the server decides |
| `bool` | `--desc`, `--desc=false` | A bare flag means true. To give a value, join it with `=` (`--desc=false`); `--desc false` makes `false` a positional word. `true`, `1`, `yes`, `on` mean true |
| `json` | `--data '{"title":"x"}'`, `--where '[["n",">",4]]'` | Parsed as JSON; if it does not parse, it is sent as a string. A list argument also accepts `a,b,c` |

**`--json` gives all arguments at once**, as one JSON object. It is the
safest form for an agent, since nothing depends on shell word splitting or
flag types:

```bash
slop docs query notes tasks --json '{"orderBy":"n","desc":true,"limit":1}'
slop docs set --json '{"store":"notes","path":"tasks/t3","data":{"title":"a"}}'
```

When the same argument is given twice, the later source wins, in this
order: `--json`, then positional words, then named flags. So
`slop docs get notes tasks/t1 --json '{"path":"tasks/t2"}'` reads `tasks/t1`.

Flags without a description in `--help` are still the verb's arguments;
`slop verbs tools <verb>` gives their JSON Schema, including enums and
required fields.

## Output

The result goes to stdout; choose the format with `-o` / `--output`:

| `-o` | Prints |
| --- | --- |
| `yaml` (default) | The result as YAML. Some keys are quoted (`"n": 1`) because YAML would read them as booleans. |
| `json` | The result as indented JSON; numbers keep every digit. Use it to parse. |
| `table` | A list of objects as columns (headers upper-cased, columns sorted, cells cut at 60 characters). Anything else prints as YAML. |

An unknown `-o` value is refused before the verb runs: `invalid_argument: -o "csv": the formats are yaml, json and table`.

Messages that are not the result go to stderr: device-login prompts,
`eval` console output, the parts of a `stream` verb as they arrive, and the
`ref move` note `main: 1 → 2`. So `slop … -o json | jq` always sees clean
JSON.

## Exit status and errors

| Exit | When |
| --- | --- |
| `0` | The verb succeeded. A verb whose answer is "no" is still a success: `slop explain can` exits 0 with `ok: false`. |
| `1` | Anything failed: a server error, a CLI usage error, a network error. |

The error is one block on stderr, prefixed `error:`:

```text
error: <code>: <message>
  <trace line>
  <trace line>
```

- **code** is stable (`invalid_argument`, `unauthenticated`,
  `permission_denied`, `not_found`, `conflict`, `missing_blobs`,
  `quota_exceeded`, `rate_limited`, `unavailable`, `upstream_error`,
  `eval_error`, `internal`, …). Branch on it, not on the message.
- **message** says what happened. Some messages repeat the code
  (`conflict: conflict: tasks/t1 is at version 2, not 1`).
- **trace** lines, on access errors, are the facts that decided: your
  audience, the grants that matched, what the operation needs. See
  `slop help access-control`.

Over HTTP the same error is `{"error": {"code", "message", "trace",
"extra"}}` with a status from the code (400 `invalid_argument`, 401
`unauthenticated`, 403 `permission_denied`, 404 `not_found`, 409 `conflict` and
`missing_blobs`, 429 `quota_exceeded`/`rate_limited`, 503 `unavailable`, 500
otherwise). `extra` carries details some verbs add, such as where a ref is
now after a `conflict`; the CLI prints only code, message and trace, so call
the verb from `slop eval` when you need `extra`.

Errors that come from the CLI itself have no code: `unknown flag: --params`,
`accepts at most 2 arg(s)`, `--json: invalid character …`, `unknown command
"stor" for "slop"` (with "Did you mean" suggestions, and a hint about app
aliases), or a network error such as
`Post "http://…/api/v1/whoami": dial tcp …: connection refused`.

## slop verb: any verb by name

The binary's verb table can be older than the server's. `slop verb <name>`
calls any verb by its full name, with all its arguments as `--json`:

```bash
slop verb docs.get --json '{"store":"notes","path":"tasks/t1"}'
slop verb no.such            # error: not_found: no verb "no.such"
```

Use it for verbs the CLI does not list, or when you already have the
arguments as a JSON object. The output and errors are as for any verb.

## slop verbs and slop verbs tools

`slop verbs` lists every verb this CLI knows: name, effect, whether it is
typed, and one line of doc. `slop verbs tools [verb…]` prints verbs as tool
descriptions: a name (`docs_get`), the full doc, and JSON Schemas for input
(with `required`) and output. It is the most exact reference of a verb's
arguments and result, and what an agent framework can load as tools.

```bash
slop verbs tools docs.query -o json
```

## slop eval: a program on the server

`slop eval` runs a JavaScript (or TypeScript) program **on the server**, with
every verb in scope as `slop.<group>.<verb>(args)`. Each call is a normal
verb call, as you, with all the usual checks; a program is a way to do many
calls in one round trip and compute over the results.

```bash
slop eval -e 'return slop.store.ls().map(s => s.id)'
slop eval -f report.js --args '{"store":"notes"}'
echo 'return 7' | slop eval -f -
```

The rules:

- The program is the **body of a function**: end it with `return value`.
  Without `return` the result is `null`.
- Each verb takes **one object** of named arguments, the same names as the
  command's flags: `slop.docs.get({store: "notes", path: "tasks/t1"})`.
  A verb without a dot is `slop.<name>`: `slop.whoami()`.
- Calls are **synchronous**; there is no `await` (top-level `await` is a
  syntax error).
- `args` is the value of `--args` (any JSON).
- `console.log` and friends print to stderr (at most 1000 lines); `warn` and
  `error` lines are prefixed.
- A failed verb throws an `Error` with `.code`, `.message`, and `.trace` or
  `.extra` when the verb gave them. Uncaught, it ends the program with that
  code; any other uncaught exception is `eval_error`.
- `--read-only` makes every writing verb throw
  `permission_denied: docs.set writes, and this program is read-only`.
- A `.ts` file, or `--ts`, is TypeScript (types are stripped).
- A program has 60 seconds; then it fails with `unavailable: eval timed out`.

```bash
$ slop eval -e 'try { slop.docs.get({store:"notes", path:"nope"}) } catch (e) { return {code: e.code, message: e.message} }'
code: not_found
message: no document nope
```

`eval` itself only needs the `read` scope; each verb it calls checks its own.

## slop call: an actor action

`slop call <store> <action> [json]` calls an action of the store's actor
(the verb `actor.call`), with the arguments as one JSON value:

```bash
$ slop call myjournal draft '{"title":"Hello","body":"first post"}'
id: p_mwvckc6p5x3z
$ slop call myjournal draft '{}'
error: invalid_argument: a draft needs a title
$ slop call myjournal nosuch
error: not_found: myjournal has no action "nosuch"
```

The action decides what level it needs (its `requires`); a too-low level
answers `permission_denied: draft needs interact; you have view`. The same
call is `slop actor call <store> <action> --args '{…}'`. An app's own
command-line verbs (`slop on`) are usually friendlier than raw actions.

## Commands that are not verbs

Some commands work with files on your machine or run locally; they still
call verbs underneath and follow the same output and error rules.

| Command | What it does | Read |
| --- | --- | --- |
| `slop serve` | Runs a server (`--local` sign-in form, `--llm fake`, `--data`, `--listen`, `--config slop.yaml`) | `server-configuration` |
| `slop auth login / status / logout` | Device login, stored logins, revoke | `agent-quickstart` |
| `slop push <dir>` | Replace a store's tree with a folder and snapshot it onto a ref (default `main`); only missing bytes are sent | `store-data`, `deploying-apps` |
| `slop pull <store> <dir>` | Write a store's tree (default `--at main`) into a folder | `store-data` |
| `slop dev <dir>` | Push a folder to an app's `draft` on every change and run it in your dev instance | `deploying-apps` |
| `slop vendor add/rm` | Add npm packages to an app as pinned, checked files | `deploying-apps` |
| `slop on <store> …` | Run the command-line verbs of the app a store runs | `using-app-verbs` |
| `slop import docs/table/files/folder` | Load CSV, JSONL, JSON or an exported folder | `store-data` |
| `slop store export <id> --folder <dir>` | Write a store as a folder | `store-data` |
| `slop files cat <store> <path>` | Write a file's raw bytes to stdout | `store-data` |
| `slop ref move <store> <ref> <n>` | Move a ref; reads `--ifAt` for you when you leave it out | `store-data` |
| `slop help [slug]` | These pages: `slop help --all`, `--topics`, `--tutorials`, `--command <cmd>` | |

An app can also give itself an **alias**, a top-level command such as
`slop pb <board> …`, once the CLI has seen it through `slop on`.

## Global flags and environment

| Flag / variable | Effect |
| --- | --- |
| `--server <origin>` | The server for this command |
| `-o, --output yaml\|json\|table` | Output format |
| `--long-help` | With `--help`, every flag including hidden ones |
| `$SLOP_SERVER` | The server, when `--server` is not given |
| `$SLOP_CREDENTIALS` | The credentials file (default `$XDG_CONFIG_HOME/slop/credentials.json`, that is `~/.config/slop/credentials.json`) |
| `$SLOP_TOKEN` | A token secret that replaces the stored one |
| `$XDG_CONFIG_HOME` | The CLI's config directory: the default credentials file and the cache of app verbs and aliases (`slop/verbs/`) |

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `accepts at most N arg(s), received M` | More positional words than the usage line has, or a bool flag given its value with a space (`--desc false`) | Join it with `=` (`--desc=false`); check the usage line |
| `invalid_argument: <verb> needs <arg>` | A required argument is missing; it may be a flag, not positional | `slop verbs tools <verb>` shows `required` |
| `unknown flag: --x` | Not an argument of this verb | `slop <group> <verb> --help` |
| `--json: invalid character …` | The `--json` value is not a JSON object | Quote it in single quotes; check the JSON |
| `eval` prints `null` | The program has no `return` | End the program with `return …` |
| `eval_error: SyntaxError … Unexpected …` with `await` | Calls in `eval` are synchronous | Drop `await` |
| `-o table` prints YAML | The result is not a list of objects | Use `-o json` |
| The command is missing from `slop --help` | It is newer than the CLI, or an app verb | `slop verb <name> --json …`; `slop on <store> --help` |
| `unknown command "x" for "slop"` | Not a command; maybe an app alias the CLI has not seen | `slop on <store> --help` once teaches it the alias |

## See Also

- `slop help agent-quickstart` — logging in and a first session
- `slop help store-data` — the data verbs in use
- `slop help access-control` — reading access traces
- `slop help using-app-verbs` — `slop on` and aliases
- `slop help troubleshooting` — errors by symptom
