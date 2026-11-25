---
Title: "LLM access: who may spend model tokens, and how much"
Slug: "llm-access"
Short: "The llm table (people, groups, @store, one store), monthly budgets, the sample policy cell, how a model call is decided, and checking it with slop sample run."
Topics:
- llm
- access
- administration
- budgets
Commands:
- llm
- policy
- sample
- log
Flags:
- budget
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
Model calls cost money, so slop asks two separate questions before any call
from a page or an actor:

- **May this app use the model for this audience?** That is the app's policy
  cell `sample` (`slop policy set <app> sample @member on`).
- **May this person spend, and is budget left?** That is the person's
  **LLM access**, a row in the `llm` table with an optional monthly token budget
  (`slop llm set @member on --budget 200000`).

Both must say yes. This page covers the `llm` table, budgets, how a call is
decided, and how to check it. All `llm` verbs except `llm usage` are for
platform admins.

## A new server

A new server has exactly one row: `@admin` on, without a limit. Nobody else
may spend, and every app's `sample` cell is off for every audience, admins
included. So the first model call needs two commands:

```bash
$ slop llm ls
- allowed: true
  budget: null
  changedAt: 0
  changedBy: system
  subject: '@admin'

$ slop policy set pinboard sample @admin on      # the app may use the model for admins
```

To open it to members with a budget:

```bash
slop policy set pinboard sample @member on       # members, subscribers and admins
slop llm set @member on --budget 200000          # 200,000 tokens per member per month
```

The server also needs a model backend: `slop serve --llm pi`
(`slop help llm-backend-pi`); without one, every call fails "this server has
no model backend".

## The llm table

Each row is a subject, `on` or `off`, and a budget in tokens per calendar
month (UTC). No budget means no limit; `--budget 0` means nothing can be spent.

| Subject | Example | Applies to |
| --- | --- | --- |
| a person | `usr_…`, `vis_…`, or an email | that person; `llm set` resolves an email to the id |
| a group | `@guest`, `@member`, `@subscriber`, `@admin` | everyone in that audience **and above**: groups nest, as sets of people `@admin` ⊆ `@subscriber` ⊆ `@member` ⊆ `@guest` |
| `@store` | `@store` | every store acting on its own (alarms, reactors, setup) |
| one store | `store:<id>` | that store acting on its own |

```bash
slop llm set alice@example.com on --budget 50000   # one person
slop llm set @subscriber on                        # subscribers (and admins): no limit
slop llm set @store on --budget 50000              # each store's alarms, per store
slop llm set store:pinboard-home on --budget 1000  # one store's own budget
slop llm set bob@example.com off                   # bob may not, whatever his group says
slop llm rm usr_8f5978090db63b0193b213fa           # bob falls back to his group's row
slop llm ls -o table
```

```text
ALLOWED  BUDGET  CHANGEDAT      CHANGEDBY                     SUBJECT
true             0              system                        @admin
true     200000  1795564399260  usr_44540efa03b111b3b7faabf8  @member
true     50000   1795564399347  usr_44540efa03b111b3b7faabf8  @store
true             1795564399283  usr_44540efa03b111b3b7faabf8  @subscriber
true     1000    1795564399381  usr_44540efa03b111b3b7faabf8  store:lab1
```

`llm set` takes the subject and `on`/`off` as positional arguments and
`--budget` as a flag. `llm rm` takes the subject **as stored** (`usr_…`, an
`@group`, `store:<id>`): it does not resolve emails, and it answers
`removed: …` even when no row matched, so check with `slop llm ls`. Every
change is in the platform log (`slop log system`: `llm @member on`,
`llm usr_… removed`).

## How a person's access is decided

For one person in one audience:

1. **Their own row wins**, on or off. An `off` row denies even when a group
   row is on.
2. Otherwise, the **most generous row that is on** among the groups of their
   audience: a row without a budget beats any budget; a bigger budget beats a
   smaller one. A member is in `@guest` and `@member`; an admin in all four.
3. No row: no access.

A store acting on its own is decided the same way, with `store:<id>` as its
own row and `@store` as its group.

What is left is the budget minus this month's usage minus the holds of calls
in flight. Usage counts input plus output tokens as the provider reports
them. A new month starts at zero; `slop llm reset <person>` sets the current
month to zero now.

## How one model call is decided

| Step | Page (`sample`, `agent`) | Actor (`use('sample')`) | `slop sample run` |
| --- | --- | --- | --- |
| 1. The app declares it | `sample` or `agent` in `app.json` | `sample` in `app.json` | no app |
| 2. The policy cell `sample` | for the viewer's audience on the store | for the visitor's audience; `@store` for alarms and reactors | none |
| 3. Who pays | the viewing person | the visitor (a person); the store (`store:<id>`) for alarms, reactors and setup | you |
| 4. LLM access | the payer's row, as above | same | same |
| 5. Budget | held before each model round, settled after | same | same |
| 6. A backend | `--llm pi` or `fake` | same | same |

A guest without an id is never charged and cannot call the model. The
`agent` capability has no cell of its own: it spends under `sample`.

**Holds.** Before each round the server sets aside the round's estimated
input plus the most output it may write, and caps the round's output to what
the hold covers; the real usage settles the hold. A hold whose outcome never
arrives is charged in full after 10 minutes, because the provider may have
billed it. So the budget is never overspent, even by parallel calls, and a
call near the end of a budget gets a shorter answer, not an overrun.

## Checking access and usage

Everyone can see their own standing; admins can name a person or a store:

```bash
$ slop llm usage member@example.com
audience: member
llm:
    allowed: true
    budget: 200000
    remaining: 200000
    source: '@member'
    used: 0
person: usr_8f5978090db63b0193b213fa

$ slop llm usage store:lab1
audience: store
llm:
    allowed: true
    budget: 1000
    remaining: 1000
    source: store:lab1
    used: 0
person: store:lab1
```

`source` names the row that decided; `remaining: null` means no limit. A page
reads the same answer, for its viewer, from `sample.limits()`
(`allowed`, `available`, `remaining`).

To test the whole path as yourself, with no app in between:

```bash
$ slop sample run "hello there"
slop is connected.
model: test/fake
text: slop is connected.
usage:
    input: 13
    output: 18
```

It answers `permission_denied: no LLM access` or `quota_exceeded: token
budget used up for this month` when that is the case, and charges the tokens
to you. On a server with `--llm fake` the answer is always `slop is
connected.`

## Recipes

**Let members use one app's model features, with a budget:**

```bash
slop policy set pinboard sample @member on
slop llm set @member on --budget 200000
```

**Give one person more:** `slop llm set alice@example.com on --budget 1000000`
(her row wins over `@member`'s).

**An actor that calls the model from an alarm** (nobody is behind it, the
store pays):

```bash
slop policy set digest sample @store on
slop llm set store:digest-home on --budget 20000   # or @store for every store
```

**Stop all spending by members now:** `slop llm set @member off` (people
with their own `on` row keep theirs; `slop llm ls` shows them).

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `slop sample run` fails `permission_denied: no LLM access` | No row for you or your group | `slop llm set <you or @group> on` |
| A page's call fails `upstream_error` "no LLM access" | The viewer has no LLM access (pages report this as `upstream_error`) | `slop llm usage <person>`, then `slop llm set` |
| `claude.use('sample')` / `use('agent')` is `null` | The policy cell `sample` is off for that audience | `slop policy set <app> sample @member on` |
| `quota_exceeded` / "token budget used up for this month" | The month's budget is spent (or held by calls in flight) | Raise it with `slop llm set`, or `slop llm reset <person>` |
| An admin cannot sample in an app | The cell is off for `@admin` too by default | `slop policy set <app> sample @admin on` |
| An alarm's model call is refused | The store pays: needs the `@store` cell and a `store:<id>` or `@store` row | See the recipe above |
| `llm rm <email>` changed nothing | `llm rm` takes the stored subject, not an email | `slop llm ls`, then `slop llm rm usr_…` |
| `llm reset store:<id>` fails | `llm reset` is for people only | Raise the store's budget instead |
| Every call fails "this server has no model backend" | The server runs without `--llm` | `slop serve --llm pi` (`slop help llm-backend-pi`) |

## See Also

- `slop help access-control` — audiences, groups and the policy matrix
- `slop help capability-sample` — model calls from pages and actors
- `slop help capability-agent` — server-held sessions, paid the same way
- `slop help llm-backend-pi` — configuring the models
- `slop help server-configuration` — `slop serve` and `slop.yaml`
