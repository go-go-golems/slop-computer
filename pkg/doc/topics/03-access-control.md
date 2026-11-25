---
Title: "Access control: people, levels, grants, rules, policy and explain can"
Slug: "access-control"
Short: "How slop decides who may do what: roles and audiences, tokens and scopes, levels and grants, share links, document rules, action requires, the policy matrix, trust, and how to read an explain can trace."
Topics:
- access
- security
- concepts
Commands:
- people
- grant
- link
- policy
- explain
- token
- app
- guest
Flags:
- subject
- path
- op
- action
- via
- days
- scopes
IsTopLevel: true
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
Every request to slop, from a page, an actor, the CLI or an `eval` program,
is decided the same way: **who is acting** (a principal and its audience),
**what they hold on the store** (a level, from ownership and grants), and
**what the operation needs** (a floor, then the app's own rules, then the
policy for costly capabilities). This page walks through each layer, with
the commands that change it, and ends with `slop explain can`, which shows
the whole decision as a trace.

Read it when a command answers `permission_denied`, `not_found` for
something that exists, or `not_granted`.

## Who is acting: principals, roles and audiences

A **principal** is whoever makes a call:

| Kind | Id | Who |
| --- | --- | --- |
| user | `usr_…` | A person who signed in, in the browser |
| token | `tok_…` (acts as its user) | The CLI or a script, through `slop auth login` or `slop token new` |
| guest | `vis_…` | A visitor without an account, given an id when they open a store that admits guests or bring a share link |
| store | `store:<id>` | A store's actor acting on its own (alarms, reactors, calls to other stores) |

A user has a platform **role**, which an admin sets:

| Role | Meaning |
| --- | --- |
| `pending` | Signed up on a server with approval signup; waits for an admin. Acts as a guest, holds at most `interact`, and cannot make tokens (so cannot log in the CLI). |
| `member` | A normal account. |
| `admin` | Runs the server: `admin` level on every store, the admin-only verbs, and the only role that may push app code. |
| `disabled` | Holds nothing. Disabling a person also ends their sessions and **revokes all their tokens**; setting the role back does not bring the tokens back, so they must log in again. |

From the role (and a subscription, if billing is on) slop computes the
caller's **audience**, one of `guest`, `member`, `subscriber`, `admin`, plus
`store` for a store acting on its own. Audiences are also **groups** that
nest:

```text
@admin ⊆ @subscriber ⊆ @member ⊆ @guest        (as sets of people; @store stands apart)
```

so a grant or a policy cell for `@member` also covers subscribers and
admins, and a grant for `@guest` covers everyone, signed in or not. There is
no deny: whatever `@guest` holds, members hold too. "Guests may read the
entries, members may not" cannot be expressed with grants or rules; it needs
an actor action that checks `ctx.visitor` itself.

People commands (admins):

```bash
slop people ls -o table                     # users; --kind guest for guests
slop people role usr_3fb66e2782b745b1925754e4 member
slop guest sweep                            # delete guests unseen for 90 days (--days)
slop log system --limit 20 -o table         # sign-ups, roles, tokens, grants, mounts, policy
```

`people role` takes the `usr_…` id, not an email. Who signs up as what is
server configuration: `signup: open` (the default; new people are members)
or `signup: approval` (new people are `pending` until an admin runs
`slop people role <id> member`), and `admin_emails` (or `slop serve
--admin-email`) for people who become admins on first sign-in. See
`slop help server-configuration`.

## Tokens and scopes

A token acts as its person, limited by its **scopes**:

| Scope | Allows |
| --- | --- |
| `read` | Verbs with effect `read` |
| `write` | Also verbs that change things (implies `read`) |
| `admin` | Acting with the person's admin role. **Without it, an admin's token acts as a member**: no admin level on other stores, no admin-only verbs, no code push. |

Scopes do not change what a person *owns*: an admin's token without `admin`
is still the owner of the admin's own stores, so it cannot stand in for a
member there. To see what a member or a guest may do, ask the server instead:
`slop explain can <store> <level> --subject <usr_…|anonymous>`, or
`--action <action>` for an action of the store's actor.

Members may give a token `read` and `write`; admins also `admin`. A token
lives 0–366 days (0: no expiry); a token with `admin` must expire within
1–90 days.

```bash
slop token new deploy-bot --scopes read,write --days 30   # the secret (slp_…) is shown once
SLOP_TOKEN=slp_… slop whoami                              # use it
slop token ls -o table                                    # yours; admins: --all
slop token rm tok_80f257a47c77061423422b97                # revoke
```

A missing scope answers `permission_denied: this token lacks the write
scope`, or `… needs a token with the admin scope`.

## Levels: what you hold on one store

Your **level** on a store is one of `view` < `interact` < `admin` < `owner`
(or none). It is computed fresh on every call: the **highest** of every
source, then capped by a **ceiling**.

Sources:

- the store's **owner** (whoever created it): `owner`;
- the **admin** role: `admin` on every store;
- every live **grant** that names you or a group you are in: at most
  `admin`. A grant of `owner` gives `admin`; ownership comes only from
  being the owner;
- a store acting on itself: `owner`.

Ceilings:

- guests and pending people: at most `interact`, whatever the grants say;
- a disabled account, or a token without scopes: nothing.

What each level is for, in the platform's own checks (an app can ask for
more, never less):

| Operation | Least level |
| --- | --- |
| Read metadata, files, refs, the log (`store meta`, `files ls`, `log show`) | `view` |
| Read and write documents | `view`, then the app's document rules decide (default: read `view`, write `interact`) |
| Call an actor action | `view`, then the action's `requires` decides |
| Upload assets | `interact` |
| Files, snapshots, refs, grants, read aliases, alarms, SQL (`push`, `ref move`, `grant set`, `alarm fire`) | `admin` |
| Share links (`link new/ls/rm`) | `owner` |
| Push app code (a tree with `app.json`) | `admin` level **and** the admin role |

The last row is deliberate: owning a store is not enough to change an app's
code. A member who pushes a folder with `app.json` gets
`permission_denied: only admins change app code (this store holds app.json;
decision D9)`. A member may push plain files (no `app.json`) to a store they
own.

A store you hold no level on is invisible: reads answer
`not_found: no store X`, not `permission_denied`.

## Grants

A **grant** gives a **subject** a level on one store. The store's admins
(and owner) make them, and nobody can grant more than they hold.

| Subject | Who |
| --- | --- |
| `usr_…` | One person |
| `vis_…` | One guest |
| `store:<id>` | Another store's actor (cross-store access is always explicit) |
| `@guest` | Everyone, signed in or not (capped at `interact` for guests) |
| `@member` | Every member, subscriber and admin |
| `@subscriber` | Subscribers and admins |

`@admin` and `@store` are not grant subjects: admins already hold `admin`
everywhere, and a store's actor holds only grants made to `store:<id>`.

```bash
$ slop grant set notes @member view
$ slop grant ls notes -o table
CREATEDAT      CREATEDBY                     LEVEL  STORE  SUBJECT  VIA
1795564326045  usr_968742abdb3c7862154e0636  view   notes  @member  direct
$ slop grant rm notes @member            # all of @member's grants on notes
$ slop grant rm kitchen vis_bb26… --via lnk_70626eda09221bd4ec30cff7   # only the one a link gave
```

`VIA` says where a grant came from: `direct` (`grant set`) or the id of the
share link that gave it. `grant ls` marks a grant that no longer counts with
`inactive` and the reason.

## Share links

A **share link** gives whoever opens it `view` or `interact` on one store,
without an account. Only the store's owner (or an admin) makes one.

```bash
$ slop link new kitchen view --days 7 --url https://apps.example.com/k -o json
{
  "link": { "id": "lnk_70626eda09221bd4ec30cff7", "level": "view", "store": "kitchen",
            "expiresAt": 1796169161305, "uses": 0, … },
  "token": "k_q9Qc…",
  "url": "https://apps.example.com/k?k=k_q9Qc…"
}
```

- The token is shown **once**. `--url` is the page's address on a live host
  (where the store is mounted); slop appends `?k=<token>`.
- `--days` limits its life (0 or none: until revoked).
- Opening the URL gives the visitor (a new guest `vis_…` if they are not
  signed in) a grant `via lnk_…`. A link never lowers a level.
- A link grant counts only while the link is live **and** its creator still
  holds the link's level on the store.
- `slop link ls kitchen` lists links with `uses` (grants they gave that
  still stand); `slop link rm lnk_…` revokes one and removes the grants it
  gave, at once.

## Document rules: `capabilities.db.rules`

An app's `app.json` decides, per document path, the level needed to read and
to write. Without rules, reading needs `view` and writing `interact`.

```json
{
  "title": "Shelf",
  "page": "index.html",
  "capabilities": {
    "db": { "rules": [
      { "path": "shelves",        "read": "view", "write": "owner" },
      { "path": "shelves/{self}", "write": "interact" },
      { "path": "config",         "read": "view", "write": "admin" }
    ] }
  }
}
```

How rules apply:

- A rule covers its path and everything below it; deeper rules override
  shallower ones, per level. A rule that leaves `read` or `write` out
  inherits it.
- `{self}`, only as the **last** segment, matches the caller's own id
  (`usr_…` or `vis_…`). Above, any interact member may write
  `shelves/<their id>`, but only the owner may write anyone else's shelf. The
  rule at the prefix of a `{self}` rule (`shelves`) must set both `read` and
  `write`.
- The level `self` in a rule is met by nobody; a deeper `{self}` rule is the
  only way through it.
- Write never needs less than read.
- Paths under `data/users/<id>/` are private to that person, whatever the
  rules: everyone else, admins included, reads them as missing.
- At most 64 rules. Levels are `view`, `interact`, `admin`, `owner`, `self`.

The rules come from the app the store runs, at the snapshot it runs; a store
without an app uses the defaults. They apply to pages and the CLI alike. They
do **not** apply to the store's own actor: an action writes any path, which is
how a page makes a checked write it may not make itself (a guestbook entry
through `sign`, with `write: "self"` on `entries`). So "can a guest write X?"
has two answers: the rules for direct writes, and the `requires` of every
action that writes X. An actor reading *another* store through `stores` gets
that store's read rules at the level granted to `store:<id>`.

```text
$ slop docs set kitchen shelves/usr_other --data '{"books":1}'
error: permission_denied: writing shelves/usr_other needs owner
  audience member (usr_3fb66e2782b745b1925754e4)
  grant @member interact on kitchen (direct)
  writing needs view
  rule shelves/usr_other: write needs owner
```

## Actor actions: `requires`

Each action in an app's `actor.js` declares the level a caller needs:

```js
actions: {
  posts: { requires: 'view',     run(ctx) { … } },
  draft: { requires: 'interact', run(ctx, args) { … } },
  purge: { requires: 'admin',    run(ctx) { … } },
}
```

The check runs before any of the action's code, for page calls, `slop call`,
`slop actor call` and app verbs alike. An action without `requires` (or a
plain function) **needs `admin`**: actions fail closed. The errors:

```text
error: permission_denied: draft needs interact; you have view
error: permission_denied: tidy declares no requires, so it needs admin; you have interact
error: not_found: myjournal has no action "posts"      (you hold no level at all)
```

Inside an action, `ctx.need('admin')` asks for more in one branch. See
`slop help actors`.

## The policy matrix: costly capabilities per audience

Most capabilities an app declares are simply on. A few cost money or reach
outside the store; for those, an admin decides per app which audiences may
use them. These are the **policy cells**:

| Capability | Appears when `app.json` declares | Default |
| --- | --- | --- |
| `assets` | `capabilities.assets` | on for `@member` and up |
| `sample` | `capabilities.sample` or `capabilities.agent` (the agent spends under the sample policy) | off |
| `user.email` | `capabilities.user` with scope `email` | off |
| `fetch` | `slop.fetch` | off |
| `secrets` | `slop.secrets` | off |
| `platform` | `slop.platform` | off |
| `stores` | `capabilities.db.stores` | off |

Columns are `guest`, `member`, `subscriber`, `admin`, and `store` (the app's
own actor in alarms and reactors). A cell is **effective** when it, or the
cell of any group the audience is inside, is on: `@member` on reaches
subscribers and admins.

```bash
$ slop policy ls shelf          # only the cells the app declares
app: shelf
declared: [assets, sample, user.email]
cells:
    - capability: sample
      audience: member
      allowed: false
      default: true
      effective: false
    …
$ slop policy set shelf sample @member on
$ slop policy set shelf db @member on
error: invalid_argument: shelf does not declare db, so it cannot be turned on
```

In a cell, `allowed` is the cell's own value, `default: true` means no row
was set and the built-in default applies (it does **not** mean "on by
default"), and `effective` is the answer: on for this audience through its
own cell or a group it is inside.

`policy.set` takes the app (the app store, not an instance), the capability,
the audience (`@member` or `member`) and `on`/`off`; it restarts the app's
actors. A model call needs the policy **and** the person's LLM access (`slop
llm set`); see `slop help llm-access`. A capability that is declared but off
reaches the page or actor as `not_granted`, or as `null` from `use()` in an
actor.

## Trust: Go modules for an app

An actor can `require()` Go modules. Most are on by default (`buffer`,
`crypto`, `database`, `events`, `express`, `fs`, `path`, `yaml`). Two are
**trusted** modules that act across the platform as the visitor: `system`
(people, grants, links, mounts, policy, LLM budgets, secrets, the system log)
and `workshop` (stores, snapshots, refs, files, drafts and dev instances).
An admin grants them per app, and the app must also declare them in
`app.json` under `slop.modules`:

```bash
slop app modules                       # the catalog, and which apps are trusted
slop app modules shelf                 # what one app declares and is trusted with
slop app trust workshop workshop       # app, module (the app declares "slop": {"modules": ["workshop"]})
slop app trust shelf database --config '{"maxRows":100}'   # configure a default module
slop app untrust shelf database
```

Trusting an app is giving its code admin-like reach through that module;
trust only apps you control. Trust restarts the app's actors.

## explain can: the whole decision, as a trace

`slop explain can <store> [level]` answers "does this caller hold this
level here?" and says why. It never fails because the answer is no: it exits
0 with `ok: false`.

| Option | Asks |
| --- | --- |
| `[level]` | `view` (default), `interact`, `admin` or `owner` |
| `--path p` (with `--op read\|write`) | May the caller read or write this document, under the app's rules? |
| `--action a` | Does the platform floor for an action hold (`doc.write`, `store.admin`, `code.push`, `asset.write`, `store.owner`, …)? |
| `--subject s` | Ask about someone else: `usr_…`, `vis_…`, an email, `store:<id>`, or `anonymous`. Only admins may ask about others. |

```yaml
$ slop explain can kitchen --path shelves/usr_3fb66e2782b745b1925754e4 --op write
audience: member
groups: ['@guest', '@member']
level: interact
need: interact
ok: true
trace:
    - audience member (usr_3fb66e2782b745b1925754e4)
    - grant @member interact on kitchen (direct)
    - 'rule shelves/usr_3fb66e2782b745b1925754e4: write needs interact'
```

Reading a trace, line by line:

| Line | Means |
| --- | --- |
| `audience member (usr_…)` | Who is asking, and their audience |
| `owner of notes` | A source: the caller owns the store |
| `admins are admin on every store` | A source: the admin role |
| `grant @member view on notes (direct)` | A source: a grant that matched (subject, level, store, how it was made) |
| `grant vis_… view on kitchen (lnk_…): its link was revoked or has expired` | A grant that matched but does not count, and why |
| `no grant on kitchen matches` | No source at all |
| `ceiling: guests and pending accounts hold at most interact (interact)` | A ceiling lowered the level |
| `rule shelves/x: write needs owner` | What the app's rule for that path needs |
| `store.admin needs admin on the store, not interact` | An action's floor did not hold |
| `view < interact` | The verdict: held < needed |

When the result is `code: not_found`, the caller holds no level at all, and
that is how the store looks to them. Access errors from other commands carry
the same trace lines.

More examples:

```bash
slop explain can notes interact                              # may I write documents here?
slop explain can kitchen --action store.admin                # may I push, grant, fire alarms?
slop explain can kitchen admin --subject store:notes         # can notes' actor administer kitchen?
slop explain can kitchen --subject anonymous                 # can a visitor without an id see it?
```


An action of the store's actor takes the same flag: `--action sign` checks
the action's `requires` against the subject's level, the check `actor call`,
pages and app verbs meet before the action runs. This answers "can a guest
add an entry?" without signing out:

```text
$ slop explain can guestbook --action sign --subject anonymous
action: sign
level: interact
need: interact
ok: true
trace:
    - audience guest (an anonymous visitor)
    - grant @guest interact on guestbook (direct)
    - action sign of guestbook's actor requires interact
```

A name that is neither a platform action nor one of the actor's fails with
`invalid_argument` and lists the actor's actions, which is also the way to
see them from the CLI.
## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `not_found: no store X` but it exists | You hold no level on it | Ask an admin of X: `slop grant set X <you> view` |
| `permission_denied: writing p needs interact` | You hold `view` | A grant of `interact`; or check the app's rule for `p` |
| `permission_denied: writing p needs owner` | A rule like `shelves` write `owner`, and `p` is not under your `{self}` | Write under your own id, or ask the owner |
| A guest cannot get past `interact` | Guests and pending people are capped at `interact` | Sign in, or approve the person (`people role … member`) |
| `permission_denied: only admins change app code …` | Pushing `app.json` needs the admin role (D9) | An admin pushes; or push without `app.json` |
| `permission_denied: … needs a token with the admin scope` | An admin's token without `admin` acts as a member | Log in again with the admin scope |
| `permission_denied: you cannot grant more than your own level` | Grants are capped at the granter's level | Ask someone who holds more |
| `invalid_argument: a subject is usr_…, vis_…, store:<id>, @guest, @member or @subscriber` | `@admin`, an email or a name as subject | Use the id (`slop people ls`) or a group |
| `not_found: no person bob@example.com` from `people role` | `people role` takes the `usr_…` id | `slop people ls -o table` |
| `invalid_argument: X does not declare sample, so it cannot be turned on` | Policy cells exist only for what `app.json` declares | Declare it, push, then `policy set` |
| `not_granted` from a page or actor | Capability not declared, or its policy cell is off for the audience | `slop policy ls <app>` |
| A share link stopped working | Revoked, expired, or its creator lost the level | `slop link ls <store>`; make a new one |
| A person's CLI stopped working after a role change | `disabled` revokes every token | Set the role back, then they log in again |
| `permission_denied: draft declares no requires, so it needs admin` | The action has no `requires` | Add `requires: 'interact'` (or the level meant) |

## See Also

- `slop help slop-overview` — the vocabulary
- `slop help agent-quickstart` — logging in, tokens and scopes from the CLI side
- `slop help app-manifest` — every `app.json` field
- `slop help actors` — `requires`, `ctx.need`, store principals
- `slop help llm-access` — LLM access rows and budgets, the second half of model calls
- `slop help deploying-apps` — grants, policy and trust in a deploy
