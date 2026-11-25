---
Title: "Agent quickstart: log in, find your way, read errors"
Slug: "agent-quickstart"
Short: "For an agent with the slop binary: getting a token through a person, choosing the server, finding verbs, and reading what slop answers."
Topics:
- agent
- cli
- getting-started
Commands:
- auth
- whoami
- verbs
- verb
- store
- docs
- explain
- help
Flags:
- server
- output
- json
- days
- scopes
- name
IsTopLevel: true
IsTemplate: false
ShowPerDefault: true
SectionType: Tutorial
---
This page takes an agent from "I have a `slop` binary" to "I can work on a
server and understand its answers". It covers the login (which needs a person),
choosing the server, the output formats, finding the right command, reading
errors, and a first short session. Read `slop help slop-overview` first if the
words store, level or grant are new.

## 1. Log in: a person approves your token

The CLI never sees a password. `slop auth login` uses a *device login*: the
CLI asks the server for a code, a person who has an account on that server
opens a page in their browser and approves it, and the CLI receives a token
(`tok_…`) that acts as that person. You cannot complete this step alone.

```bash
slop auth login --server https://slop.example.com --name "agent on build-box"
```

The CLI prints, on stderr, and then waits:

```text
Open https://slop.example.com/device?code=LSHR-69WN
and approve the code LSHR-69WN.
Waiting…
```

**What to tell the person.** Relay the URL and the code exactly, and say what
they are approving. For example:

> Please open https://slop.example.com/device?code=LSHR-69WN, sign in if
> asked, check that the page shows the code LSHR-69WN and the name
> "agent on build-box", choose the scopes and lifetime you want me to have,
> and press Approve. I am waiting for it now (the code expires in 10 minutes).

When they approve, the CLI finishes:

```text
Logged in to https://slop.example.com as Admin with scopes [read write admin] (token tok_5e7c4971f946bcb10268f4db).
```

Keep the `auth login` process running while the person approves: it polls
every two seconds and gives up after about 11 minutes. If it gave up, run it
again; a code is good for one login only.

What the person decides on the approval page:

| Choice | Meaning |
| --- | --- |
| **Scopes** | `read` (read verbs), `write` (verbs that change things; implies read), `admin` (act with the person's admin role; only offered to admins). A member can give `read` and `write`. A `pending` person cannot make tokens at all. |
| **Lifetime** | Days until the token expires; `0` means never. A token with the `admin` scope must expire within 1–90 days. |

You can ask for less up front: `--scopes read` (comma-separated) and
`--days 7`. `--days` defaults to 30 and accepts 0–366. `--name` labels the
token in `slop token ls` (default `slop CLI on <hostname>`).

**An admin's token without the `admin` scope acts as a member**: it holds no
admin level on other people's stores, and admin-only verbs answer
`permission_denied: … needs a token with the admin scope`.

### Where the token is kept, and which server you talk to

The login is saved in a credentials file (mode 0600), keyed by server URL, and
the server becomes the **default login**. Every later command picks its
server in this order:

1. `--server <origin>` on the command line;
2. `$SLOP_SERVER`;
3. the default login (the last server you logged in to).

| Variable | Effect |
| --- | --- |
| `SLOP_SERVER` | The server origin, e.g. `https://slop.example.com`. |
| `SLOP_CREDENTIALS` | The credentials file (default `~/.config/slop/credentials.json`, or under `$XDG_CONFIG_HOME` when that is set). Point it at your own file to keep your logins apart from anyone else's on the machine. |
| `SLOP_TOKEN` | A token secret (`slp_…`) used instead of the stored one. Useful for a token made with `slop token new`. |

If none of these gives a server, every command answers
``no server: run `slop auth login --server <url>` or set SLOP_SERVER``.

### Checking and ending the login

```bash
slop auth status     # every stored login: server, default, token id, name, scopes
slop auth logout     # revoke the token on the server and forget it
```

```yaml
- default: true
  name: bob-cli
  scopes:
    - read
    - write
  server: http://slop.localhost:18601
  token: tok_e8e9a55943121e0a0189e222
```

`auth status` only reads the file; it does not ask the server whether the
token still works. `slop whoami` does.

## 2. Who am I?

`slop whoami` asks the server who your token acts as. Run it first in every
session: it proves the server is reachable and the token is alive.

```yaml
$ slop whoami
id: usr_968742abdb3c7862154e0636
kind: token
person:
    email: admin@example.com
    id: usr_968742abdb3c7862154e0636
    name: Admin
    role: admin
scopes:
    - read
    - write
    - admin
token: tok_5e7c4971f946bcb10268f4db
via: cli:tok_5e7c4971f946bcb10268f4db
```

`person.role` is your platform role (`pending`, `member`, `admin`,
`disabled`); `scopes` is what the token may do. Your **audience** (guest,
member, subscriber, admin) is not in `whoami`; `slop explain can <store>`
shows it.

## 3. Output formats

Every command prints its result on stdout as YAML by default. Choose with
`-o` (or `--output`):

| `-o` | Use |
| --- | --- |
| `yaml` | Default; easy to read. Note YAML quotes some keys, e.g. `"n": 1`. |
| `json` | For parsing. Numbers keep every digit. Prefer this in scripts. |
| `table` | Columns, for lists of objects; cells longer than 60 characters are cut with `...`. A result that is not a list prints as YAML. |

Any other value is refused before the command runs. Errors and progress always go to stderr.

```text
$ slop store ls -o table
APP      CREATEDAT      ID         LEVEL  OWNER                         TYPE
journal  1795564191299  myjournal  owner  usr_968742abdb3c7862154e0636
         1795564112513  notes      owner  usr_968742abdb3c7862154e0636
```

## 4. Finding the right command

Every server operation is a **verb** named `group.name`, and every verb is a
command `slop <group> <name>`. Look things up in this order:

```bash
slop help                     # the main pages; slop help --all lists every page
slop verbs -o table           # every verb, its effect (read/write/govern/stream) and one line of doc
slop store --help             # the verbs of one group
slop docs set --help          # one verb: positional arguments and flags
```

In a verb's usage line, `<name>` is a required positional argument and
`[name]` an optional one; everything else is a flag:

```text
slop docs set <store> [path] [flags]
slop grant set <store> <subject> <level> [flags]
```

Every argument is also a flag (`--store notes` works as well as `notes`), and
`--json '{…}'` passes all arguments as one JSON object. (`slop call <store>
<action>` is the one shortcut where `--json` is the action's own arguments.) A boolean flag alone
means true (`--desc`); turn one off with `--desc=false`. See `slop help cli-reference-guide`.

**Verbs newer than your CLI.** The verb table is built into the binary. If
the server has a verb your CLI does not list, call it by name:

```bash
slop verb docs.get --json '{"store":"notes","path":"tasks/t1"}'
```

`slop verbs tools` prints every verb as a tool description with JSON Schemas
for its input and output, which is the most exact description of a verb's
arguments.

**App verbs.** Apps can ship their own commands. `slop on <store> --help`
lists the commands of the app that store runs. See `slop help using-app-verbs`.

**`slop docs` is not documentation.** It is the document verbs of a store
(`docs get`, `docs set`, `docs query`). Documentation is `slop help`.

## 5. Reading errors

A failed command prints one line on stderr and exits with status 1:

```text
error: <code>: <message>
```

The **code** is stable and machine-readable; the **message** says what
happened in words. Access errors add a **trace**, one fact per indented line,
that says how your level was decided:

```text
$ slop docs set notes tasks/b --data '{"x":1}'
error: permission_denied: writing tasks/b needs interact
  audience member (usr_3fb66e2782b745b1925754e4)
  grant @member view on notes (direct)
  writing needs view
  rule tasks/b: write needs interact
```

Read it top to bottom: who you are (audience member), what you hold (a grant
of view through the group `@member`), what the operation needs (interact,
from the app's rule for that path). The fix is a grant of `interact`, which
the store's owner or an admin gives.

The codes you will meet most:

| Code | Means | Usual next step |
| --- | --- | --- |
| `invalid_argument` | A missing or malformed argument: `docs.get needs store`, a bad store id, bad JSON | `slop <group> <verb> --help` |
| `unauthenticated` | No token, or the token expired or was revoked | `slop auth login` again |
| `permission_denied` | You are known, but your level, role or token scope is too low | Read the trace; `slop explain can <store> <level>` |
| `not_found` | No such store, document, verb or action, **or** you hold no level on the store (a store you may not see reads as missing) | Check the name; `slop store ls`; ask for a grant |
| `conflict` | Something moved under you: a store id is taken, a document is not at the version you said (`--ifVersion`), a ref moved since you read it | Re-read, then retry |
| `not_granted` | An app's page or actor asked for a capability its manifest does not declare, or the policy is off for your audience | `slop policy ls <app>`; see `access-control` |
| `quota_exceeded`, `rate_limited` | A budget or rate limit | Wait, or ask an admin (`slop llm usage`) |
| `unavailable` | The app is broken, or the server could not do it now | `slop app status <store>`, `slop app logs <store>` |
| `internal` | A server bug | Report it, with the command |

Errors from the CLI itself (not the server) have no code: `accepts at most 2
arg(s), received 3` (too many positional arguments), `unknown flag: --params`,
`unknown command "stor" for "slop"` (with suggestions). Run the command's
`--help`.

`slop help troubleshooting` lists errors by symptom.

## 6. A first session

The commands below ran against a local server; outputs are trimmed. The
`explain can` example ran as a member, Bob, who holds a `view` grant on
`notes`. Start with what you can see:

```text
$ slop store ls -o table
ID       APP    TYPE   KIND      LEVEL  CREATEDAT      OWNER
kitchen  shelf  shelf  instance  owner  1795564336711  usr_968742abdb3c7862154e0636
notes                  content   owner  1795564112513  usr_968742abdb3c7862154e0636
```

`store ls` lists the stores you own or hold a grant on (admins add
`--all` for every store). `LEVEL` is your level on each; `KIND` is `app`
(the store holds an app's code and runs it), `instance` (it runs the app
named in `APP`) or `content` (documents and files, no app). Look inside one:

```bash
slop store show kitchen          # everything at once: app, code, mounts, data, grants, actions, what to run next
slop store meta notes            # head rev, collections, SQL tables, refs, your level
slop docs ls notes tasks         # the documents of the collection tasks
slop docs get notes tasks/t1     # one document
```

`store show` is the place to start with a store you did not build: it says
where its code is (`slop pull …`), where it is mounted, whether its data are
documents or SQL tables, and which commands come next.

```yaml
$ slop docs get notes tasks/t1
at: 1795564118342
body:
    done: false
    "n": 3
    title: buy milk
by: usr_968742abdb3c7862154e0636
path: tasks/t1
rev: 2
version: 1
```

Before you change anything, ask whether you may. `explain can` takes a store
and a level (default `view`), or a document path with `--path` and
`--op write`:

```yaml
$ slop explain can notes interact
audience: member
code: permission_denied
groups:
    - '@guest'
    - '@member'
level: view
need: interact
ok: false
trace:
    - audience member (usr_3fb66e2782b745b1925754e4)
    - grant @member view on notes (direct)
    - view < interact
```

`explain can` succeeds (exit 0) even when the answer is no: `ok` is the
answer, `level` what you hold, `need` what was asked, `trace` why. Then
write, and watch the log:

```bash
slop docs set notes tasks/t9 --data '{"title":"from the agent"}'
slop log show notes --limit 3 -o table
```

## Where to go next

| You want to | Read |
| --- | --- |
| Understand the nouns | `slop help slop-overview` |
| Know every CLI rule (arguments, `--json`, `eval`, exit status) | `slop help cli-reference-guide` |
| Work with documents, files, snapshots, tables, the log | `slop help store-data` |
| Understand levels, grants, policy, share links | `slop help access-control` |
| Build and deploy an app | `slop help building-apps`, `slop help tutorial-first-app` |
| Find the page for a task ("a photo wall", "every morning at 7") | `slop help recipes` |
| Run something on a schedule | `slop help alarms` |
| Look after an app someone else built | `slop store show <store>`, then `slop help recipes` ("You inherited an app") |
| Run an app's own commands | `slop help using-app-verbs` |

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `--server is required the first time` | `auth login` has no server from `--server` or `$SLOP_SERVER` | Pass `--server https://…` |
| `auth login` prints the code and nothing happens | Nobody has approved it yet | Give the person the URL and code; keep the command running; rerun after 10 minutes |
| `the login expired; run it again` | The code was not approved in time | Run `slop auth login` again and relay the new code |
| `no server: run slop auth login …` | No `--server`, no `$SLOP_SERVER`, no default login in the credentials file | Log in, or set `SLOP_SERVER` and `SLOP_CREDENTIALS` |
| `unauthenticated: sign in, or send Authorization: Bearer <token>` | The token expired, was revoked (`auth logout`, `token rm`), or its person was disabled | Log in again; disabling a person revokes all their tokens for good |
| `permission_denied: this token lacks the write scope` | The token was approved with `read` only | Log in again and ask for `write` |
| `permission_denied: … needs a token with the admin scope` | You are an admin but the token has no `admin` scope | Log in again with the admin scope (1–90 days) |
| `not_found: no store X` for a store that exists | You hold no level on it | `slop explain can X`; ask its owner for a grant |
| The command you expect is missing | The CLI is older than the server, or it is an app's verb | `slop verb <group.name> --json '{…}'`; `slop on <store> --help` |
| You looked under `slop docs` for documentation | `docs` is the document verbs | `slop help` |

## See Also

- `slop help slop-overview` — the vocabulary
- `slop help cli-reference-guide` — how verbs become commands, `eval`, exit status
- `slop help access-control` — levels, grants, tokens and scopes, `explain can`
- `slop help store-data` — documents, files, snapshots, SQL, the log
- `slop help using-app-verbs` — an app's own commands
- `slop help troubleshooting` — errors by symptom
