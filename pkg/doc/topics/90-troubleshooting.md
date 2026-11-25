---
Title: "Troubleshooting: from an error to the page that explains it"
Slug: troubleshooting
Short: "Every error code and silent failure slop produces, what usually causes it, the command that settles it, and the page to read."
Topics:
- troubleshooting
- errors
Commands:
- whoami
- explain
- app
- verbs
IsTopLevel: true
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
Use this page when something fails and you do not know where to look. Each
row names the usual cause and the page that explains it in depth. The other
pages have their own Troubleshooting tables with the exact messages; this one
is the index.

## Four commands that settle most problems

Run these before changing anything. They answer from the server, not from
what you remember about it.

| Command | Answers | Who may run it |
| --- | --- | --- |
| `slop whoami` | Who you act as, on which server, with which token scopes | anyone with a login |
| `slop explain can <store> [level]` | Your level on a store and the trace of grants and rules that decided it. Add `--path p --op write` for one document, `--action store.admin` (or another platform floor: `doc.write`, `code.push`, …) for a platform operation, `--action sign` for an action of the store's actor (its `requires`; an unknown name lists the actor's actions), `--subject usr_…`/`anonymous`/`store:<id>` for someone else | anyone, for yourself; `--subject` (someone else) is for platform admins |
| `slop app status <store>` | Which app and snapshot a store runs, and `broken: …` with the reason if activation failed (manifest, actor, migration). A push can succeed and still leave the store broken; this is where it shows | `view` on the store |
| `slop app logs <store>` | The actor's recent `console.log` / `ctx.log` lines and errors | `admin` on the store |

`slop policy ls <app>` and `slop mount routes` are for platform admins: a
member who needs them asks an admin.

## How an error looks

A failed command exits 1 and prints one block on stderr:

```text
error: <code>: <message>
  <trace line>
```

Branch on the **code**, not the message. Errors from the CLI itself (a bad
flag, too many arguments, an unknown command) have no code. A page sees the
same codes as `err.code` on a rejected promise, except as noted below.

## By error code

| Code | Usual cause | Settle it with | Read |
| --- | --- | --- | --- |
| `unauthenticated` | No login for this server, an expired or revoked token, or a guest opening something that needs sign-in | `slop whoami`; `slop auth login --server …` | `agent-quickstart` |
| `permission_denied: … needs <level>; you have <level>` | Your level on the store is below what the verb, path or action needs | `slop explain can <store> <level>` (with `--path` or `--action`) | `access-control` |
| `permission_denied: this token lacks the write scope` / `… admin scope` | The token's scopes, not your role | `slop whoami`; log in again with `--scopes` | `agent-quickstart` |
| `permission_denied: only admins change app code` | Pushing `app.json`, `actor.js` or `verbs/` to a store with an app needs a platform admin | `slop whoami` | `access-control`, `deploying-apps` |
| `permission_denied: <action> declares no requires, so it needs admin` | An actor action without `requires` | Add `requires: 'interact'` (or `view`) to the action | `actors` |
| `permission_denied: no LLM access` | The person (or `store:<id>` for alarms) has no LLM access | `slop llm usage`; an admin runs `slop llm set` | `llm-access` |
| `not_found: no store X` | It does not exist, or you hold no level on it (both answer the same) | `slop store ls`; `slop explain can X` as an admin | `access-control` |
| `not_found: <store> has no actor` / `no action "x"` | `app.json` has no `actor`, the store runs another app, or a typo | `slop app status <store>`; the actor's `actions` in its `actor.js` | `actors` |
| `not_found` for a document someone else wrote | A private path (`data/users/<id>/…`) or a rule that hides it from you | `slop explain can <store> --path p` | `capability-db` |
| `not_granted` / `claude.use('x')` is `null` | The capability is not in `app.json`, its policy cell is off for this audience, or the viewer's level is too low | `slop policy ls <app>`; `slop app status <store>` | `page-runtime`, `app-manifest` |
| `invalid_argument` | A bad value; the message names it. `docs.ls needs coll` lists the store's collections. Also: a `db` write a rule refuses (`this viewer cannot write "p"`), `sql exec` without `--write` (`not authorized`), a grant subject that is not an id | The message; `slop <group> <verb> --help` | `cli-reference-guide`, `capability-db` |
| `conflict` | `--ifVersion` / `--ifAt` did not match: the document or ref moved, or a store follows another ref | Read the current version (`docs get`, `ref ls`) and retry | `store-data`, `deploying-apps` |
| `missing_blobs` | A push or commit named file contents the server does not have | Retry the push; it uploads what is missing | `store-data` |
| `quota_exceeded` / "token budget used up for this month" | The monthly LLM budget is spent | `slop llm usage` | `llm-access` |
| `rate_limited` | Too many requests: the provider, the API policy of a mount, a second download dialog | Wait and retry | `llm-backend-pi`, `deploying-apps` |
| `resource_exhausted` | A runtime limit, such as the 65th live `db` subscription | Close what you no longer need | `capability-db` |
| `unavailable` | The server has no model backend, or an app turned its agent off | `slop serve` logs; the app's settings | `server-configuration` |
| `upstream_error` | A `sample` call from a page: the server's own code is folded into this one, and the message keeps the reason ("no LLM access", "token budget used up", "no model backend") | Read `err.message` | `capability-sample` |
| `actor_error` | The actor threw, did not call `defineActor`, or a turn ran over 5 s | `slop app logs <store>` | `actors` |
| `eval_error` | `slop eval` program failed (syntax, a thrown error) | The message has the line | `cli-reference-guide` |
| `run_active` | An agent session is still running a `send` (another tab, or no `await`) | Wait for it, or abort it | `capability-agent` |
| `revoked` | The page's view was closed (access changed, link revoked) | Reload the page | `page-runtime` |
| `internal` | A server bug, or a store whose app does not exist (`store new --app nosuch`) | `slop app status <store>` | — |

## Errors from the CLI itself

| Message | Cause | Fix |
| --- | --- | --- |
| `unknown command "x" for "slop"` | Not a command, and no store followed it (an app's alias is resolved through the store after it) | `slop x <store> …`, or `slop on <store> …`; `slop help using-app-verbs` |
| `unknown command "x" (it may be an app's alias, but the CLI could not ask the server …)` | The alias is unknown on this machine and there is no login to look it up with (a fresh `XDG_CONFIG_HOME` hides `credentials.json` too) | `slop whoami`; `slop on <store> …` |
| `unknown flag: --x` | Not an argument of this verb; the error ends with the verb's usage line | `slop <…> --help` |
| `accepts at most N arg(s), received M` | More positional words than the usage line has, or a bool flag given its value with a space (`--desc false`) | Join it with `=`: `--desc=false` |
| `invalid_argument: -o "csv": the formats are yaml, json and table` | Unknown output format | `-o yaml`, `-o json` or `-o table` |
| `no server: run slop auth login …` | No `--server`, no `$SLOP_SERVER`, no default login | `slop help agent-quickstart` |
| `dial tcp …: connection refused` | The server is not running or the URL is wrong | `slop whoami --server …` |

## Failures without an error

These are the hard ones: every command succeeds and the result is still not
what you expected.

| Symptom | Usual cause | Settle it with | Read |
| --- | --- | --- | --- |
| `push` succeeds, the page does not change | The store follows another ref, or activation failed | `slop app status <store>` | `deploying-apps` |
| `push` succeeds, the store is `broken` | Manifest error, actor error or a changed migration | `slop app status <store>` | `app-manifest` |
| Every `claude.use()` is `null` | The page was opened on its sandbox URL without the shell, or as a file | Open it through its mount on a live host | `page-runtime` |
| `window.claude` is undefined | The page is on the static host, which serves files byte for byte with no runtime | Mount the app on a live host | `building-apps` |
| A page works for you and not for others | Their level or audience: policy cells and `db` rules apply per viewer | `slop explain can <store> --subject usr_…`; `slop call <store> <action> --as anonymous` (or `--as usr_…`) runs it as them | `access-control` |
| Old app verbs after a push | The store runs an older snapshot | `slop app status <store>` | `using-app-verbs` |
| A model answer is empty with `--llm fake` | The fake engine echoes; `/tool <name> {json}` calls a tool, and a session without tools answers nothing | Use a real backend to test answers | `capability-agent` |
| An option above a limit has no effect | Session options over a limit are lowered silently (`maxTokens`) | Stay within the limits on the page | `capability-agent` |
| A setting in `slop.yaml` has no effect | Unknown keys are ignored | Check the key against the page | `server-configuration` |

## See Also

- `slop help slop-overview` — the words used in errors (level, grant, policy)
- `slop help cli-reference-guide` — exit status, error shape, HTTP statuses
- `slop help access-control` — reading an `explain can` trace
- `slop help app-manifest` — every manifest validation error
