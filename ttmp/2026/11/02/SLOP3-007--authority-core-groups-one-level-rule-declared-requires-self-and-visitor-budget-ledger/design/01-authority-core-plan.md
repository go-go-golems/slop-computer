---
Title: 'Authority core: plan'
Ticket: SLOP3-007
Status: active
Topics:
    - backend
    - security
    - authz
DocType: design
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "The authority core plan for slop (groups, one level rule, live links, declared requires, self and visitor, budget ledger), imported from the Nov 2 design doc and amended: strict default for undeclared actions, store-principal trusted modules, SLOP3-007 numbering."
LastUpdated: 2026-11-02T16:27:42.821572752-05:00
WhatFor: ""
WhenToUse: ""
---
# Slop authority core: one grammar for access, identity and budgets

> **SLOP3-007 working copy.** Imported from `sources/local/authority-core-original.md` (Nov 2, 2026) and amended where marked **Amended (SLOP3-007)**. Changes against the original:
> 1. Ticket SLOP3-007 (SLOP3-006 is the production-polish ticket); branch `task/slop3-007-authority-core`.
> 2. PR #14 is merged and deployed (`main`, image `sha-30defba` and later).
> 3. Decision 4: an action that declares no `requires` needs **admin**, not interact (a public store grants `@guest interact`, so interact would open undeclared actions to every visitor). Every shipped actor declares its actions in phase 3, so the strict default costs nothing.
> 4. Phase 4: with no visitor, trusted-module calls act as `store:<id>`, never as a person. The trust row is the fact that lets them, and it counts only while the admin who made it is still an admin (provenance, as for links).
> 5. Phase 6 (cost units) is deferred: since GitOps #411 every tier is `deepseek-4.1-flash`, so a token costs the same on every tier.

Nov 2, 2026 · @Manuel Odendahl

## Summary

Slop's access code reads about 20 separate authority inputs today; all of them fit into three kinds of state and one judgment.

- **Facts** (grants, ownership, admin role, policy cells, LLM allotments, trust) are reusable and combine by **max**.
- **Credentials** (sessions, tokens, views, links, module calls, delegates) only narrow, and combine by **min**.
- **Balances** (token or money budgets) are conserved and move only through reserve, settle and release.

Because level = max of sources, then min of ceilings, no source can skip a ceiling and no delegate can exceed its parent. That holds by the shape of one expression, not by every caller remembering a rule. Audiences become groups, so the policy matrix, LLM access rows and mount create-audiences turn into ordinary grants to groups. In actors, every effect states whose authority it draws on: the store's own, or the visitor's.

SLOP3-005, implemented in [PR #14](https://github.com/go-go-golems/slop-computer/pull/14) (30 commits, merged and deployed), settles *where* decisions run: a floor on every verb and runtime method, an epoch that retires stale view decisions, and D9 and read rules held by the store. It keeps every rule's meaning on purpose, so the 21 inputs and their combining rules are still there. This model is the next step, changing the rules themselves, and it extends PR #14's action table rather than replacing it.

## Vocabulary

Slop has one durable thing, the **store**. Everything else is code that runs against a store, a way into one, or a fact about who may do what there.

&#91;embedded content: how the nouns fit · one store, three ways in\]

An app is code kept in its own store; the stores that run it hold the data. Pages and doors reach a store directly or through its actor, and each of those calls is decided against `system.db` first.

### Slop's own terms

| Term | What it is | Example |
| --- | --- | --- |
| Store | One SQLite file holding JSON documents, files, the app's own SQL tables, and a log of every change | `ws-team`, a Blocks workspace; `j-ana`, Ana's journal |
| Document | A JSON object at a path inside a store | `notes/a`; `data/users/usr_ana/draft`, private to Ana |
| App | A store whose files include `app.json`. Its code runs against every store that names it as its app | The `blocks` store holds the Blocks app; `ws-team` and `ws-design` run it |
| Manifest | `app.json`: the capabilities the app declares, its document rules, allowed fetch origins, secret names | `data/users/{self}` readable only by that user |
| Page | The app's browser half, framed on its own sandbox origin, calling the server through `window.claude` | The Blocks editor in a browser tab |
| View | One open page: one person, one store, one app version, and a secret (`slv_…`) its calls carry | Ana's tab on `ws-team` |
| Actor | The app's server half, `actor.js`: one instance per store, one event at a time | `ws-team`'s actor answering a `summarize` call |
| Turn | One event handled by an actor as one SQLite transaction. An `await` on network I/O ends it, and the code after runs as a new turn | Signing the guestbook is one turn |
| Commit, rev | What a turn writes, numbered per store | Rev 412 of `ws-team` |
| Action | A named function an actor offers to pages and the CLI | `sign` in the guestbook, `summarize` in the journal |
| Reactor | An actor handler that runs once for each matching change in the log | Reindex when anything under `notes/` changes |
| Alarm | A timed wake-up of an actor, one-off or on a cron schedule | A nightly digest at 03:00 |
| Door, verb | The ways in for people and agents: CLI, HTTP API, `eval`. All run verbs from one table of 84 | `slop docs get ws-team notes/a` |
| Mount | A host and path pattern pointing at a store | `apps.example.com/blocks/:store` |
| Binding | An alias that lets one store's actor read another store | `site-team` reads `ws-team` as `source` |
| Principal | Who acts, as the code says today: user, guest, token, store or the kernel | `usr_ana`, `vis_q7`, `store:site-team` |
| Level | Standing on one store: view < interact < admin < owner | Carl has interact on `ws-team` |
| Grant | A row giving a subject a level on a store | `@guest` interact on `guestbook` |
| Audience | Today's ladder: guest < member < subscriber < admin | Ana is a subscriber |
| Policy cell | Whether an app may use a capability for an audience | `sample` on for members in `journal` |
| Token scope | `read`, `write` or `admin` on a CLI or agent token | Ana's agent token has `read` |

### Terms this doc adds

| Term | What it is | Example |
| --- | --- | --- |
| Subject | Someone accountable in the log: a person, a guest, a store, or the kernel | `usr:ana`, `vis:q7`, `store:ws-team` |
| Group | A set of subjects computed from role, kind and subscription; replaces the audience | `@member`, `@subscriber` |
| Fact | A reusable row saying who holds what. Facts combine by max | `@anyone holds interact on store:guestbook` |
| Credential | How a request arrived: a subject plus caveats. Caveats only narrow, and combine by min | Ana's agent token: `root(usr:ana) ▷ read ops only` |
| Caveat | One narrowing on a credential | `within store:ws-team`, `level ≤ view` |
| Operation | A row of the operation table: floor level, capability, cost, reach | `doc.write`, `model.sample` |
| Local, personal effect | Whether an actor's effect draws on the store's own authority or on the visitor's | Writing `notes/a` is local; a model call is personal |
| Epoch | A counter that moves on every `system.db` write; a cached decision is re-made when it has moved | `system.DB.Epoch()` in PR #14 |
| Allotment, balance | A spending limit derived from facts, and the spent and reserved amounts against it per month | `@subscriber allotted 5,000,000 µUSD per month` |
| Reservation | Budget held for one model round, settled with what the round actually used | 100,000 µUSD held before a round |

µUSD is a millionth of a US dollar, so 5,000,000 µUSD is $5.

## Verdict on the colleague's study

Keep its diagnosis and its split between authority and budgets; drop most of the formal apparatus, the new nouns and the estimates. It also never mentions SLOP3-005, the repo's own authorization redesign, which already covers half of it more concretely and is now implemented in PR #14.

### Its code claims, checked against `main` at `1833212`

| Claim | Holds? | Where | Note |
| --- | --- | --- | --- |
| Ownership skips the audience cap | Yes | `pkg/access/check.go`, `Level` | The owner case runs before `capOf`. Guests can't create stores today, but a member who owns stores and is set back to `pending` keeps `owner`. The lab spec applies the cap after ownership. |
| The LLM budget can be overspent | Yes, on purpose | `pkg/server/sample.go:213`, `pkg/actor/sample.go:100` | Check, call, then charge. Concurrent calls all pass the check. |
| Audiences mix unrelated dimensions | Yes, and worse | `check.go`, `system/policy.go` | Grants, mount create-audience and `needAudience` treat it as a ladder; policy cells and LLM rows match it exactly. Turning `sample` on for `@member` leaves subscribers and admins off. |
| Actions authorize themselves | Yes | `pkg/verbs/actors.go:32` | `actor.call` checks only `view`; the rest is `ctx.need` inside the action. |
| Alarms spend the store owner's budget | Yes | `pkg/actor/manager.go:259` | `storeVisitor` sets `Payer` to the owner. |

All five still hold at PR #14's head, `dff7fcc`.

### Where it goes wrong

- **It re-derives SLOP3-005 without citing it.** That ticket (`ttmp/2026/11/01/SLOP3-005…`) already designs one `Decide`, credentials with ceilings, permits at the store boundary, author authority for SQL triggers and deny-by-default headers, with phased exit tests. Its best mechanism, an access **epoch** that invalidates every cached decision at once, appears in the study only in passing, as a field, not as the thing that retires stale views.
- **The math mostly decorates.** "Authority is a subset of the request space" is true of every access system. The typing judgment Γ;A;B ⊢ e : T ! E and the `Pure | Perform | Bind` grammar are never used again, and goja actors can't be typed that way. Proving A ∩ C ⊆ A in Lean is one line; the real risks (complete mediation, stale decisions) aren't algebra.
- **It contradicts itself on delegation.** It says non-amplification holds by construction, then has the kernel verify A\_child ⊆ A\_parent and reject escalations. If you must check it, it isn't by construction. Store a delegate as its parent plus caveats, evaluated live, and there is nothing to verify.
- **It adds nouns instead of removing them.** Identity, credential, grant, delegation, app declaration, approval, subscription, entitlement, budget, permit, operation spec, effect, caveat, binding: about 14 concepts to replace about 20 mechanisms. A core model passes when today's mechanisms become derived forms of a few primitives (section 5).
- **Actor option A vs B is the wrong axis.** Confining an actor to the caller's effects breaks the store-server model: an actor legitimately reads every user's documents to build a summary. The split belongs per effect: does it draw on the store's authority or the visitor's (section 6)?
- **The threat model is off.** Only admins push app code (D9), so actor code is trusted but possibly buggy or AI-written. Fail-closed defaults matter more here than process isolation.
- **The estimates are not derived from anything.** 20–35 days, 25–45 files and 1,500–3,000 lines cite no inventory. For scale, PR #14 implemented all of SLOP3-005 in 30 commits between 21:42 on Nov 1 and 12:00 on Nov 2.
- **One fact is stale:** PR #13 merged into `main` today at 12:43.

### What it missed in the code

- **Two rules for the same situation.** With no person behind an event, `actAs` (`pkg/server/modules.go:148`) refuses writes, while `platformModule` (`pkg/server/platform.go:23`) acts as the store owner and allows `grant.set`, `store.new` and `mount.set`. So an alarm on an admin's store, with the platform cell on for admins, can set mounts or grant admin on any store with nobody behind it and no confirmation step. PR #14 routes both through one `personAs` but keeps the difference.
- **Cross-store reads skipped the target's rules.** `stores.open` (`pkg/actor/modules.go:467`) read `GetDoc` and `Query` directly. PR #14 fixes this: the target's read rule now applies. The level is still decided once at open, so a handle kept in JS outlives a revoked grant.
- **The executable spec and Go disagree.** `lab/src/kernel/access.js` gives pending users no level, caps after ownership, names groups `*anyone` and `*signed-in`, and makes apps `app:<id>`. Go gives pending users the guest audience, caps before ownership, uses `@guest`/`@member`/`@subscriber` and `store:<id>`. PR #14 doesn't touch either.
- **Budget units.** `llm_usage` sums input and output tokens across model tiers, so 50,000 tokens means very different spend on `quick` and `complex`.

## What the code has today

The design names five nouns, but the Go code reads 21 authority inputs and combines them in eight different ways. The combining rules, not the number of tables, are what make it hard to reason about.

| # | Input | Lives in | Combines as |
| --- | --- | --- | --- |
| 1 | Platform role (pending, member, admin, disabled) | `people.role` | Ladder rank; admin and disabled are branches in `Level` |
| 2 | Person kind guest | `people.kind` | Audience guest; built inline in four principal constructors |
| 3 | Store owner | `stores.owner` | Branch, ahead of the audience cap |
| 4 | Grants | `grants` | Max; `@guest`/`@member`/`@subscriber` match "at least" |
| 5 | Share links | `links` | Redemption writes a grant whose `via` is the link |
| 6 | Token scopes | `tokens.scopes` | Min (read caps at view); the admin check ignores scopes |
| 7 | Same-origin rule for cookies | `sameOrigin`, `crossOrigin` in `live.go` | Two helpers, two rules |
| 8 | View snapshot | `rt.View` Level, Role, Policy | Cached until a review hook runs |
| 9 | Subscription or comp | `stripe_subscriptions`, `comps` | Lifts member to subscriber |
| 10 | Policy cells | `app_policy` | Exact audience; default on for `assets`, non-guests |
| 11 | Manifest declarations | `app.json`: caps, fetch origins, secret names, platform ops | Checked per module |
| 12 | Module trust | `app_modules` | Per app, admin-set |
| 13 | Mount create audience | `mounts.create_audience` | At least |
| 14 | Member check in `store.new` | inline in the verb | At least member |
| 15 | LLM access | `llm_access` | Person row overrides, else exact audience |
| 16 | LLM usage | `llm_usage` | Charged after the call |
| 17 | Bindings | `bindings`, `assets` flag | Alias plus a grant to `store:<id>` |
| 18 | Code push (D9) | `needCodeRight` | Admin role, checked in two verbs |
| 19 | Action checks | `ctx.need`, `ctx.needAudience` | Voluntary, inside each action |
| 20 | Who a module acts as | `actAs`, `platformModule`, `storeVisitor` | Three constructions that differ |
| 21 | SQL caller kinds | `store/sqlpolicy.go` | SQLite authorizer; kernel bypasses |

The eight ways: max, min, branch, at-least, exact match, override, cached snapshot and voluntary. Rows 1, 2, 9, 10, 13, 14 and 15 are the same question asked seven times with different answers: is this person in this class? Rows 18–20 are the same question asked three times: whose authority does this code use?

PR #14 changes how rows 6, 8, 17, 18 and 20 are enforced (scope as a ceiling on the admin role, an epoch-checked view cache, the target's read rule on bindings, D9 in the store, one `personAs`), but not what any row means. The count of inputs and the eight combining rules stay.

## The core model

Three kinds of state, each with exactly one way of combining, and one judgment that reads all three.

| Kind | Holds | Combines by | Changes only by |
| --- | --- | --- | --- |
| Fact | Who holds what: a level, the use of a capability, an allotment | Max (join) | Grant and revoke, each with provenance |
| Credential | How a request arrived and how far it may reach | Min (meet) | Narrowing |
| Balance | What is left to spend in a period | Addition, conserved | Reserve, settle, release |

### The grammar

```
-- who is accountable (authentication produces one of these)
subject  s ::= usr:<id> | vis:<id> | store:<id> | system
group    g ::= @anyone | @member | @subscriber | @admin | @store
holder   h ::= s | g

-- where, and how much
scope    σ ::= * | store:<id> | store:<id>/<zone>/<prefix> | app:<id> | model:<tier>
level    ℓ ::= none < view < interact < admin < owner

-- facts: reusable, the only rows admins and owners write
fact     f ::= h holds ℓ on σ                 -- grants, ownership, admin role, bindings
           |  h uses cap through app:<id>     -- policy cells, approvals, module trust, instantiate
           |  h allotted n unit per period    -- LLM access and budgets
           [ via f' ]                         -- lives only while f' lives

-- credentials: can only narrow
caveat   c ::= level ≤ ℓ | within σ | caps ⊆ C | until t | app = a@v | no admin ops
cred     κ ::= root(s) | κ ▷ c

-- what is asked
effect   e ::= op(σ)         -- op from one finite table
turn     τ ::= ⟨ code = a@v, store = id, visitor = κ or none ⟩
```

### What each choice removes

- **Few subjects.** Tokens, views, links and module calls are credentials, not subjects. A guest is a person with a `vis:` id. Every subject is something accountable in the log.
- **Groups replace audiences.** One function computes a subject's groups from role, kind and subscription. It is the only code that reads those three columns.
- **Three fact forms cover every authority row.** Ownership is `usr:x holds owner on store:s`. The admin role is `@admin holds admin on *`. A policy cell is `@member uses sample through app:journal`.
- **Provenance replaces revocation code.** A link's grants, a delegate and a binding each hang off a parent fact; revoke the parent and the rest stop counting at the next decision.
- **Operations are one finite table.** Each row gives a base level, a capability, a cost and whether the effect draws on the store's or the visitor's authority. Verbs, RPC methods, actor modules and HTTP routes all point at rows of it.

Storage can be one `facts` table with a `form` column, or the existing tables behind one loader. With no compatibility to keep, one table is simpler: one write path, and one query feeds `explain`.

## Semantics and laws

A request's level is one expression: the max over every fact that reaches the subject, then the min over every ceiling the credential carries. Everything else follows from that shape.

### The level

```latex
L(\kappa,\sigma) \;=\; \min\Big(\, \max\{\,\ell \mid (h\ \mathrm{holds}\ \ell\ \mathrm{on}\ \sigma') \in F_e,\; h \in \mathrm{who}(\kappa),\; \sigma' \sqsupseteq \sigma\,\},\;\; \min\{\,\ell_c \mid (\mathrm{level} \le \ell_c) \in \kappa\,\},\;\; \mathrm{kindcap}(\mathrm{subj}\,\kappa) \,\Big)
```

Here who(κ) is the subject plus its groups, F\_e is the set of live facts at the current epoch e, and kindcap gives `vis:` subjects interact, pending people interact, like guests, and disabled people none. There are no branches: ownership and the admin role are just facts in the first term.

### The judgment

An effect e = op(σ) in turn τ is allowed when, with κ the credential the effect draws on (section 6):

1. L(κ, σ) ≥ need(a@v, e, subject). `need` reads the operation table, the manifest's db rules with `{self}`, and the `data/users/<id>` privacy rule. D9 is a need too: `code.push` asks for admin level and membership of `@admin`.
2. The capability of op is declared by a@v, some h in who(κ) has `h uses cap through app:a`, and κ's caveats allow it.
3. If op has a cost, a reservation on the payer's balance succeeds.

### Laws

| Law | Statement | Why it holds |
| --- | --- | --- |
| Ceilings can't be skipped | L(κ, σ) ≤ every ceiling in κ, whatever the facts | Ceilings sit in the outer min. The owner-before-cap bug cannot be written. |
| Narrowing never widens | L(κ ▷ c, σ) ≤ L(κ, σ), and caps(κ ▷ c) ⊆ caps(κ) | ▷ adds a min term; caveats have no form that adds a source. Nothing to verify at delegation time. |
| Grants never lower | Adding a fact never lowers any level | Facts only enter the max. An owner can grant without reasoning about side effects. |
| Revocation reaches everything | Removing f removes every fact via f, at the next epoch | Facts are read live at epoch e; provenance is followed, not copied. |
| Spend is conserved | spent + reserved ≤ limit per account, unit and period | Section 7. |

The model has **no deny facts**. A deny breaks the max, and with it the second and third laws. What looks like a deny is a ceiling on the subject: a disabled account is kindcap none, not a grant of none.

The one place I'd allow an override is an allotment: a per-person LLM limit that replaces the group's. It touches only the balance limit, never a level, so the first four laws stay intact.

## Every current mechanism as a derived form

All 21 inputs reduce to the three fact forms, a handful of caveats and the operation table; none keeps a code path of its own.

| # | Today | In the core |
| --- | --- | --- |
| 1 | Admin role | `@admin holds admin on *`; membership of `@admin` from the role |
| 2 | Disabled, pending | Disabled: kindcap none. Pending: kindcap interact, member of `@anyone` only |
| 3 | Guest person | Subject `vis:<id>`, member of `@anyone`, kindcap interact |
| 4 | Store owner | `usr:x holds owner on store:s via creation`, capped like any grant |
| 5 | Grants | `h holds ℓ on store:s` |
| 6 | Share links | The link is a fact; redeeming writes `usr:y holds ℓ on store:s via <link>` |
| 7 | Token scopes | Caveats: read is `level ≤ view`; anything short of admin scope is `no admin ops` |
| 8 | Origin rules | Authentication: a cookie on an unsafe cross-origin request yields no credential |
| 9 | View snapshot | κ = root(visitor) ▷ within store:s ▷ caps ⊆ declared(a@v) ▷ app = a@v; no stored level |
| 10 | Subscription, comp | Membership of `@subscriber` |
| 11 | Policy cells | `g uses cap through app:a`; with `@subscriber` inside `@member`, a cell on `@member` reaches subscribers |
| 12 | Manifest declarations | The code's ceiling, caps ⊆ declared(a@v); fetch origins and secret names are scopes under their cap |
| 13 | Module trust | `@anyone uses workshop through app:a`; the module still acts with the visitor's authority |
| 14 | Create audience, `store.new` check | `g uses instantiate through app:a` (the design's own instantiate grant) |
| 15 | LLM access | `h allotted n unit per month`; `h uses sample through app:a` stays the policy |
| 16 | LLM usage | The balance (section 7) |
| 17 | Bindings | `store:a holds view on store:b` plus an alias; reads go through `need`, so the target's rules apply |
| 18 | D9 | `need(code.push)` = admin and `@admin` |
| 19 | `ctx.need` | A declared `requires` on the action, checked before entry, default admin |
| 20 | `actAs`, `platformModule`, `storeVisitor` | One rule: self effects vs visitor effects (section 6) |
| 21 | SQL caller kinds | Unchanged inside a store; trigger bodies run as app code (SLOP3-005 A7) |

What disappears: the audience ladder, `capOf`, `scopeCap`, `IsAdmin`, the policy matrix as a separate concept, `needCodeRight`, the view's Level/Role/Policy, and three of the four principal constructors. What stays: levels, db rules, the manifest and the SQL authorizer, which are already well designed.

## Two principals per turn

Inside an actor turn every effect draws on exactly one authority, and the operation table says which: the store's own for local effects, the visitor's for personal ones.

&#91;embedded content: actor turn · two authorities, one per effect\]

Personal effects never fall back to the store owner. A turn with no person behind it draws only on facts granted to the store itself, and by default there are none.

- **Pages and doors have one principal.** No server code stands between the person and the store, so every effect is the caller's. That is why db rules apply to pages and not to actors, as the current design already has it.
- **Local effects use the store's authority**: `store:<id>`, narrowed to what the manifest declares. The actor reads every user's documents because it is the store's server. The visitor's level reaches the code as information, and through the action's `requires`, checked before entry.
- **Personal effects use the visitor's live credential**, narrowed by app = a@v and the declared capabilities. Spending, platform operations, the visitor's email and trusted-module verbs are personal; in an alarm or reactor they draw on the store's own facts.
- **What it replaces.** `actAs`, the principal built inside `platformModule` and `storeVisitor`'s payer collapse into `turn.Self()` and `turn.Visitor()`. The alarm inconsistency from the verdict can no longer be written: there is one rule, and it never names the owner.
- **What it keeps from the colleague's study.** Their confused-deputy point was right: an app acting for a user must not hold the union of both authorities. This is the per-effect form of their intersection rule.

## Budgets as a ledger

A hard budget is a reservation taken before each model round, priced in one cost unit, and charged to a payer named by the effect. The limit is authority (derived from allotment facts); the balance is state (conserved).

### State and operations

Per account, unit and period the ledger keeps `limit` (computed from facts), `spent` and `reserved`, with the invariant spent + reserved ≤ limit.

| Operation | Effect | Rule |
| --- | --- | --- |
| reserve(account, n, key) | reserved += n | One conditional `UPDATE … WHERE limit - spent - reserved >= n`; the key makes a retry a no-op |
| settle(r, m) | spent += m, reserved -= n | m is the round's actual usage, priced at that model's rate |
| release(r) | reserved -= n | Only when no request reached the provider |
| expire(r) | settle(r, n) | A reservation with an unknown outcome is charged in full; the provider may have billed it |

`system.db` is one SQLite writer, so the conditional update is atomic without extra locking. Today's `llm_usage` table gains a `reserved` column and a `reservations` table keyed by idempotency key.

### Reserve per round, not per call

A page call runs up to 10 model rounds (`MaxRounds`) with up to 150 s per page tool between them (`toolWait`). Reserving all 10 rounds up front would lock most of a small budget for minutes. Instead, reserve before each round: tokens so far times the input rate, plus the round's output cap times the output rate. Settle from that round's usage event. If a reserve fails mid-call, the call ends with `quota_exceeded` and whatever result it has.

The round loop lives inside the backend (`pkg/llm/gepp/sample.go`), which already caps each round's output through `budget.next`. The change is one hook there, called before each round with the round's input size and output cap, that may refuse. The output cap itself should come from the server: today the page's `maxTokens` of 0 means 65,536 generated tokens per call.

### Units

Charge in one cost unit (micro-dollars, or credits with a rate per model), not raw tokens. `llm_usage` now adds input and output tokens across tiers, so the same allotment buys very different spend on `quick` and `complex`. Pages and actors can still be shown tokens left, computed from the rate of the model they ask about.

### Payers

The payer is part of the effect, not inferred later. A turn with a visitor charges the visitor. A turn without one (alarm, reactor) charges `store:<id>`, which has a balance only if an admin allotted one. That replaces today's rule that background work silently spends the store owner's budget.

## Worked examples

Eleven situations, from a public guestbook to a child app inside another app. Each shows the facts involved, what `slop explain` would print under the proposed model, and what happens today on `main` and PR #14. Commands in the fact grammar are proposed; names like `grant.set` are today's verbs.

The explain output always has the same three parts: the facts that entered the max, the caveats that entered the min, and the need they were compared with.

### 1. A public guestbook

A guestbook app is mounted at `apps.example.com/guestbook`. Anyone may sign; a visitor without an account gets a guest id on first visit.

```
$ slop grant @anyone holds interact on store:guestbook

$ slop explain vis:q7 actor.call store:guestbook --action sign
facts    @anyone holds interact on store:guestbook       max  interact
caveats  kindcap vis: ≤ interact                         min  interact
need     action sign requires interact
allow
```

Same result as today, where the grant reads `grant.set guestbook @guest interact`. Today's audience cap also holds guests at interact if someone grants `@anyone admin` by mistake. The model applies that cap to every source, ownership included, which is where today's code misses (example 5).

### 2. A private journal

Ana creates a journal. Bob, a member, guesses its URL. An admin opens it to debug something.

```
fact     usr:ana holds owner on store:j-ana via creation

$ slop explain usr:bob doc.read store:j-ana/posts/p1
facts    (none reach usr:bob)                             max  none
deny     not_found

$ slop explain usr:admin1 doc.read store:j-ana/data/users/usr_ana/draft
facts    @admin holds admin on *                          max  admin
need     data/users/usr_ana/… is private to usr:ana
deny     not_found
```

Bob learns nothing, not even that the store exists. The admin sees the journal at admin, but Ana's private drafts stay hidden: the privacy rule is a need, not a level, so no grant overrides it. This is today's behavior too; the model only removes the admin branch from `Level`.

### 3. A share link in a team workspace

Ana owns `ws-team`. She sends Carl, a contractor, an interact link; a month later she revokes it while Carl still has a tab open.

```
$ slop link.new ws-team interact        → lnk_7
fact     lnk_7 holds interact on store:ws-team via usr:ana's ownership

Carl opens the link
fact     usr:carl holds interact on store:ws-team via lnk_7

$ slop link.rm lnk_7                    → both facts end; the epoch moves
Carl's tab, next call                   → re-decided: none → the shell closes the view
```

Today, with PR #14, the outcome is the same: removing the link removes the grants made through it, and the view re-decides on its next call. What the model adds is the general rule: anything with a `via` dies with its parent. If Ana herself lost `ws-team`, links she made would stop working too. That last part is decided (decision 7).

### 4. A read-only token for a coding agent

Ana is an admin. She gives Claude Code a read token so it can look around without changing anything.

```
credential tok_3 = root(usr:ana) ▷ read ops only ▷ no admin ops

$ slop explain tok_3 doc.write store:ws-team/notes/a
facts    usr:ana holds owner on store:ws-team             max  owner
caveats  read ops only: doc.write writes                  deny

$ slop explain tok_3 people.ls
caveats  no admin ops                                     deny
```

PR #14 already behaves this way, through two separate mechanisms: the verb's `Scope` and `Principal.Role` treating a non-admin token as a member. The model expresses both as caveats on one chain, so `explain` reports them in one place, and a delegate made from this token inherits both.

### 5. An owner set back to pending

Dan created `s-dan` while he was a member. An admin later sets his role back to `pending`.

```
$ slop explain usr:dan grant.set store:s-dan
facts    usr:dan holds owner on store:s-dan via creation  max  owner
caveats  kindcap pending ≤ interact                       min  interact
need     grant.set requires admin
deny     interact < admin

$ slop explain usr:dan doc.write store:s-dan/notes/a      allow (interact)
```

Dan can still edit notes in his store, as any guest could in a public one, but he can no longer manage access, push files or delete the store. Today, on `main` and PR #14, Dan keeps owner: `Level` returns owner before it applies the audience cap. His existing CLI tokens keep working too, since `SetRole` revokes tokens only when an account is disabled. In the model there is no order to get wrong, and the pending cap applies to every credential Dan holds.

### 6. AI for members, more for subscribers

An admin turns on model calls in the journal app for members and gives subscribers a bigger budget.

```
$ slop grant @member uses sample through app:journal
$ slop grant @member allotted 500,000 µUSD per month
$ slop grant @subscriber allotted 5,000,000 µUSD per month

$ slop explain usr:ana model.sample store:j-ana          # Ana subscribes
groups   @anyone @member @subscriber
uses     @member uses sample through app:journal          allow
limit    max(500,000, 5,000,000) = 5,000,000 µUSD this month
```

Today the same setup surprises: `policy.set journal sample @member on` leaves subscribers and admins off, because policy cells match the audience exactly. LLM rows also match exactly, so a subscriber with no `@subscriber` row gets no model access at all. Paying can therefore take access away: a member who subscribes moves to the subscriber audience and loses every `@member` cell and row. With nested groups, one line covers everyone at or above member.

### 7. Five tabs on a small budget

Bea, a member, has 250,000 µUSD left this month. She opens five tabs and asks each to summarize a long note at once. Rates here are illustrative: a round with about 20,000 input tokens and a 4,000-token output cap reserves 100,000 µUSD.

```
balance  limit 500,000   spent 250,000   reserved 0          (µUSD)

tab 1  reserve 100,000   reserved 100,000                   ok
tab 2  reserve 100,000   reserved 200,000                   ok
tab 3  reserve 100,000   250,000 left − 200,000 held        quota_exceeded, no provider call
tab 4, tab 5             same                               quota_exceeded
tab 1  settle 61,000     spent 311,000   reserved 100,000
tab 2  settle 58,000     spent 369,000   reserved 0
```

Bea ends at 369,000 of 500,000, and three tabs told her why at once. Today all five pass the check, since each sees 250,000 left, and each is charged afterwards: about 300,000 spent against 250,000, and more if the tabs run tool rounds.

### 8. A nightly digest

`ws-team`'s actor summarizes the day's notes at 03:00. Nobody is behind the alarm.

```js
every: {
  nightly: { cron: '0 3 * * *', async run(ctx) {
    const day = new Date(ctx.now).toISOString().slice(0, 10);
    const notes = db.collection('notes').where('day', '==', day).get().docs;
    const r = await sample('Summarize:\n' + notes.map(n => n.data().text).join('\n'));  // personal effect
    db.doc('digests/' + day).set({ text: r.text });                                      // local effect, a new turn
  } },
},
```

```
alarm turn: no visitor, so it acts as store:ws-team, in the group @store

without setup    → permission_denied: sample is not on for @store in app:blocks
with the cell    → quota_exceeded: store:ws-team has no allotment
with both        → reserve and settle against store:ws-team's own balance

admin setup:
$ slop grant @store uses sample through app:blocks
$ slop grant store:ws-team allotted 2,000,000 µUSD per month
```

Today the digest is charged to the workspace owner's personal budget, without the owner agreeing to it. If the same alarm called `platform.grants.set`, today it would run as the owner. In the model it needs a fact granted to `store:ws-team`, and by default there is none.

### 9. A site published from a workspace

`site-team` runs the `blocks-site` app and reads `ws-team` through the alias `source` to build public pages.

```
$ slop bind.set site-team source ws-team
$ slop grant store:site-team holds view on store:ws-team

build reads ws-team/pages/home         allow (view, page rules)
build reads ws-team/data/users/usr_ana/notes   not_found (private)
Ana removes the grant; next build      permission_denied on the first read
```

PR #14 already applies the target's read rules, so private documents stay out. What the model adds is that every read is decided at the current epoch, so a handle an actor kept from an earlier turn stops working once the grant is gone.

### 10. A trusted app acting for a member

The Workshop app is trusted with the `workshop` Go module, which runs verbs for whoever is using it. Bea, a member, asks the Workshop's agent to replace the code of the `journal` app.

```
fact     @anyone uses workshop through app:workshop      (an admin trusted it)
effect   code.push on store:journal                       personal: Bea's credential
need     admin level and membership of @admin
deny     usr:bea is not in @admin
```

Trust lets the app call the module; it adds nothing to what Bea may do. Today the outcome is the same, since PR #14 puts the code-push rule in the store. The model states why in one rule: personal effects use the visitor's authority, and app trust is never a source.

### 11. A child app inside Claude Computer (designed for v3.1)

Ana's Claude Computer store `cc-ana` opens a calculator app that was made inside it. The child gets `apps/calc/` only, with `db` and `room`, and at most interact.

```
κ_child = κ_ana ▷ within store:cc-ana/docs/apps/calc ▷ caps ⊆ {db, room} ▷ level ≤ interact

child reads apps/calc/state      allow
child reads notes/diary          deny: outside within
child calls sample               deny: not in caps
Ana loses her grant on cc-ana    child's next call: deny (its chain starts at Ana)
```

Delegation needs no code of its own: it is three caveats on Ana's credential, and the narrowing law already guarantees the child never exceeds Ana. Nothing checks for escalation, because no caveat can express one.

## What is guaranteed, and by what

PR #14 already delivers freshness and most of complete mediation. The other six guarantees need the model in sections 3 to 7: four come from Go's package boundaries and one expression, one from the database, and one from a test. None needs a proof assistant.

| Guarantee | Kind | Mechanism | After PR #14 |
| --- | --- | --- | --- |
| Ceilings can't be skipped | Construction | `Level` is the only way to get a level, and it is one max-then-min expression. Property test over generated facts and credentials. | Open: ownership still skips the audience cap |
| Narrowing never widens | Construction | `Credential` has unexported fields and one method, `Narrow(Caveat) Credential`. `Caveat` is a closed set: an interface with an unexported method. | Open: scopes live in `Principal.Role` and the verb gate |
| Every effect is decided | Construction | A floor per operation, and the store holds the rules no caller may skip. A structural test fails when an operation names no action. | Done for 84 verbs and 21 runtime methods; module functions and actor routes left |
| Decisions are fresh | Epoch | Every committed `system.db` transaction moves the epoch; a cached decision is re-made on its next use. | Done: `system.DB.Epoch()` |
| Effects use the right principal | Construction | `turn.Self()` and `turn.Visitor()` return different handles; visitor operations exist only on the second, and in an alarm it is the store itself. | Open: the alarm rule still differs between modules |
| Actions fail closed | Construction | The kernel checks an action's declared `requires` before entering it; an undeclared action needs admin. | Open: the `actor.call` floor is view |
| Spend is conserved | Database | The conditional `UPDATE` in section 7; a test runs 50 parallel reservations against a small limit. | Open |
| Spec and code agree | Test | Differential test of Go against `lab/src/kernel/access.js` on generated cases, once the two are reconciled. | Open |

### What it does not guarantee

- **That an action's business logic is right.** "Only a post's author may edit it" depends on a row, and the kernel sees levels and paths. That stays in app code or in an exposed SQL view.
- **Confidentiality against the store's own code.** An actor reads everything in its store by design; it is the store's server.
- **Isolation from hostile code.** Goja runs in the server process. That matters once people other than admins can push code, which D9 currently rules out.

## How this builds on PR #14

[PR #14](https://github.com/go-go-golems/slop-computer/pull/14) implements every SLOP3-005 phase (L, A0–A7, S1, S2) by a lighter route than the design: action floors instead of one `Decide`, an epoch-checked view cache instead of views without decisions, and two store-held rules (`CodeRight`, a read predicate) instead of general permits. It keeps every rule's meaning on purpose, and that is the part this model changes.

| Topic | PR #14 | Still to do |
| --- | --- | --- |
| Where decisions run | Floors on 84 verbs and 21 runtime methods (`authz.Specs`); the store holds D9 and read rules | Floors for module functions and actor routes |
| Stale decisions | `system.DB.Epoch()` moves on every committed transaction; views re-decide on next use | Done |
| Token scopes | The admin role needs the admin scope (`Principal.Role`); the read scope no longer caps the level | Express both as caveats on one credential chain; same behavior |
| Who a module acts as | One `personAs`, which refuses disabled payers | Alarms: `actAs` refuses writes, `platformModule` acts as the owner. One acting principal (phase 4) |
| Cross-store reads | The target's read rule applies | The level is decided once at `stores.open`; check per call |
| Computing a level | Unchanged | Ownership skips the audience cap; one max-then-min expression, grants still stopping at admin (phase 2) |
| Audiences | Unchanged | Groups; policy cells, LLM rows and create-audiences read through groups (phase 1) |
| Actions | `actor.call` floor is view; the action checks itself | Declared `requires`, checked before entry, admin when undeclared (phase 3) |
| Budgets | Unchanged | Ledger with per-round reservation and cost units (phases 5, 6) |
| Spec vs Go | Unchanged | Reconcile `lab/src/kernel/access.js`, then test Go against it |

The implementation plan at the end of this doc turns this table into eight phases, using the decisions just before it.

`authz.Specs` in `pkg/authz/actions.go` is the start of the operation table in section 10; grow it rather than start a second table. The lab's `access.js` is the executable spec the v3 design calls for; a model in Lean would be a third copy to keep in sync.

## Authoring surface

The surface people write is small: an action's requirement and capabilities, a row in the operation table, a grant. Plain data is the IR for all three; a fluent builder is optional sugar on the JavaScript side and not worth it on the Go side.

### Actions in `actor.js`

```js
defineActor({
  actions: {
    summarize: {
      requires: 'interact',   // checked by the kernel before run; omitted means 'admin'
      uses: ['sample'],       // must also be declared in app.json
      run(ctx, { id }) { /* business logic only */ },
    },
    stats: { requires: 'view', run(ctx) { /* … */ } },
  },
});
```

If you want the builder style, `action('summarize').requires('interact').uses('sample').run(fn)` can compile to exactly this object and report an unknown level or an undeclared capability at load. The kernel checks the object again at activation and at every call, so the builder is about earlier, clearer errors, not security.

### The operation table in Go

```go
var Ops = authz.Table{
	{Name: "doc.read", Need: rt.LevelView, Rule: authz.DocRules, Reach: authz.Local},
	{Name: "doc.write", Need: rt.LevelInteract, Rule: authz.DocRules, Reach: authz.Local},
	{Name: "code.push", Need: rt.LevelAdmin, Group: "@admin", Reach: authz.Personal},
	{Name: "model.sample", Need: rt.LevelView, Cap: "sample", Cost: authz.PerRound, Reach: authz.Personal},
	{Name: "grant.set", Need: rt.LevelAdmin, Cap: "platform", Rule: authz.NoMoreThanOwn, Reach: authz.Personal},
}
```

This grows out of PR #14's `authz.Specs`, whose rows today hold `Store`, `Level` and `Admin`. `Group` generalizes `Admin`, `Cap` and `Rule` move per-operation checks into the row, `Reach` says whose authority the effect draws on inside an actor (section 6), and `Cost` how it is charged. Verbs already name their row through `Verb.Action` and `StoreArg`. A struct literal is greppable and diffable, and the compiler checks its field names and types. A generic fluent builder in Go cannot add type parameters per method, so it would end up as this literal with more ceremony.

### Grants

The fact grammar doubles as the CLI and the `explain` output:

```
slop grant usr_ana holds interact on store:ws-team
slop grant @subscriber uses sample through app:journal
slop grant @subscriber allotted 2000000 microusd per month
slop explain usr_ana doc.write store:ws-team/notes/a
```

`explain` prints the facts that entered the max, the caveats that entered the min, and the need they were compared with: the same three things the judgment reads.

## Decisions

Settled on 2026-11-02; the implementation plan below assumes all of them.

| # | Question | Decision | What it means in code |
| --- | --- | --- | --- |
| 1 | Group nesting | Nested: `@admin` ⊆ `@subscriber` ⊆ `@member` ⊆ `@anyone` | One membership function; every audience check becomes "is in group". A person's budget is their own row, else the largest among their groups |
| 2 | Pending users | Same as guests | Member of `@anyone` only, kind cap interact. `@signed-in` is dropped: everyone signed in is now either guest-like or a member |
| 3 | Who pays for background work | The store's own budget, set by an admin | Alarms and reactors act as `store:<id>`, in the group `@store`. Model calls charge `store:<id>`; no allotment, no call |
| 4 | Default `requires` for actions | admin (**Amended (SLOP3-007)**; was interact) | The kernel checks an action's declared level before running it; an undeclared action needs admin, and activation warns about it |
| 5 | Private data across stores | Never | PR #14's read rule stays; the level is re-checked on each read, not once at open |
| 6 | Budgets | Hard, reserved per model round | Members and guests stop between rounds when the budget runs out; rows without a budget (admins by default) stay unlimited |
| 7 | Share links | Grants with provenance, ending with the creator's access | A link's grants count only while the link is live and its creator still holds the link's level |
| 8 | Bans | Deferred | Belongs to a later hardening phase, with rate limits and abuse controls |

## Implementation plan

Eight phases on top of PR #14, each a pull request that merges on its own with its exit tests green. Phases 1 to 4 change who may do what, 5 and 6 budgets, 7 explanations. Line numbers are at PR #14's head, `dff7fcc`; search by function name when they drift.

**Before starting:** merge PR #14 and branch from `main`. Run `GOWORK=off go test ./... -count=1` and `cd web/runtime && pnpm test` before and after every phase. Record each phase in a ticket diary, as SLOP3-005 did.

| Phase | Decisions | Main files | Exit tests |
| --- | --- | --- | --- |
| 0. Failing tests first | all | new `pkg/server/core_test.go`, `pkg/access/level_test.go`, `pkg/system/ledger_test.go` | the tests themselves, skipped until their phase |
| 1. Groups | 1, 2 | `pkg/access`, `pkg/system/policy.go`, `pkg/rt/views.go`, call sites | `TestSubscriberKeepsMemberPolicy`, `TestSubscriberKeepsMemberLLMRow`, `TestGroupsByKind` |
| 2. One level rule, live links | 2, 7 | `pkg/access/check.go`, `pkg/system/stores.go`, `links.go` | `TestPendingOwnerCappedAtInteract`, `TestLinkGrantsEndWithCreator`, `TestExpiredLinkGrantsInert`, `TestLevelNeverAboveCap` |
| 3. Declared `requires` | 4 | `pkg/actor/actor.go`, `manager.go`, shipped `actor.js` files | `TestActionWithoutRequiresNeedsAdmin` |
| 4. Self and visitor | 3, 5 | `pkg/actor/manager.go`, `modules.go`, `pkg/server/modules.go`, `platform.go` | `TestAlarmPlatformActsAsStore`, `TestAlarmSampleNeedsStoreCellAndBudget`, `TestStoresOpenRechecks` |
| 5. Budget ledger | 6 | new `pkg/system/ledger.go`, `pkg/llm`, `pkg/server/sample.go`, `pkg/actor/sample.go` | `TestConcurrentSamplesCannotOverspend`, `TestReservationsDoNotMoveEpoch`, `TestHoldExpiresAtFullAmount` |
| 6. Cost units (optional) | 6 | `pkg/system/ledger.go`, `pkg/llm` | `TestTiersChargeDifferently` |
| 7. Explain and the spec | — | `pkg/verbs/access.go`, `testdata/authz/`, `lab/src/kernel/access.js` | `TestWorkedExamples`, explain golden test |

&#91;embedded content: phase order · 8 phases, what blocks what\]

Two people can split the work after phase 1: one takes 2 and 7, the other 4 and 5; phase 3 can start on day one. The alarm budget test in phase 0 passes only once both 4 and 5 are in.

### Phase 0: failing tests first

Write every exit test below before changing code, each marked `t.Skip("SLOP3-007 phase N")`, so CI stays green and progress shows as skips turn into passes. Each must fail on today's code when unskipped:

- `TestPendingOwnerCappedAtInteract`: a member creates a store, an admin sets them to `pending`; `Level` must return interact. Today it returns owner.
- `TestSubscriberKeepsMemberPolicy`: `policy.set journal sample @member on`; a subscriber's view must get `sample`. Today it doesn't.
- `TestSubscriberKeepsMemberLLMRow`: an `@member` LLM row only; a subscriber must get its budget. Today `LLMFor` finds no row.
- `TestActionWithoutRequiresNeedsAdmin`: a guest holding interact on a public store calls an action that declares nothing; the call must fail `permission_denied` before the handler runs.
- `TestAlarmPlatformActsAsStore`: an alarm calls `platform.grants.set` on another store; it must fail unless `store:<id>` holds admin there. Today it runs as the owner.
- `TestAlarmSampleNeedsStoreCellAndBudget`: an alarm calls `sample`; it must fail without the `@store` cell, then without a `store:<id>` row, and charge `store:<id>` with both.
- `TestStoresOpenRechecks`: an actor keeps a `stores.open` handle in a module variable; after the grant to `store:<id>` is removed, the next `docs.get` must fail.
- `TestLinkGrantsEndWithCreator` and `TestExpiredLinkGrantsInert`: a redeemed link's grant must stop counting when its creator loses owner, or when the link expires.
- `TestConcurrentSamplesCannotOverspend`: with the fake backend at a fixed usage per call, 20 parallel calls against a limit worth 5 calls; exactly 5 may start, and spent must stay at or under the limit.

### Phase 1: groups replace audiences

**Add** `pkg/access/groups.go`:

```go
type Group string

const (
	GroupGuest      Group = "@guest"      // everyone, signed in or not (the doc's @anyone)
	GroupMember     Group = "@member"
	GroupSubscriber Group = "@subscriber"
	GroupAdmin      Group = "@admin"
	GroupStore      Group = "@store"      // a store acting on its own: alarms, reactors, setup
)

// Groups is the one place that reads role, kind and subscription.
func (c *Checker) Groups(ctx context.Context, p *Principal) []Group
func In(gs []Group, g Group) bool
```

| Principal | Groups |
| --- | --- |
| anonymous, guest kind, person kind guest, role pending | `@guest` |
| role member | `@guest`, `@member`, plus `@subscriber` when `Checker.Subscribed` says so |
| role admin, as returned by `Principal.Role()` | all four person groups. A token without the admin scope gets member's groups, as PR #14 already does |
| role disabled | none |
| `KindStore` | `@store` only |
| `KindSystem` | all four person groups |

Keep the name `@guest` for the everyone group: it already means "anyone" in grants, and renaming it touches the CLI, the back office and every stored grant for no change in behavior.

**Replace every audience check** with a group check:

| Where | Today | After |
| --- | --- | --- |
| `access.Matches`, `check.go:82` | ladder by audience | `subject == p.ID()` or `In(groups, Group(subject))`; `@store` is never a valid grant subject |
| `store.new`, `verbs/stores.go:50`; `import.folder`, `verbs/data.go:81` | `AtLeast(AudMember)` | `In(groups, GroupMember)` |
| mount create, `server/live.go:261` and `:437` | `AtLeast(create_audience)` | `In(groups, "@"+create_audience)` |
| actor HTTP routes, `server/actors.go:163` | `AtLeast(route.Audience)` | `In(visitor groups, …)` |
| `ctx.needAudience`, `actor/actor.go:522`, and `audRank` at `:539` | ladder by audience | `In(visitor groups, …)`; delete `audRank` |
| `Policy`, `system/policy.go:41` | one cell for one audience | `Policy(app, cap, groups []Group)`: on when any of the groups' cells is on. With no row, `assets` is on for `@member` |
| `LLMFor`, `system/policy.go:154` | own row, else the audience's row | own row, else the largest among the groups' rows; a row without a budget is unlimited and beats any number |
| `rt.View`, `rt/views.go:36` | `Role string` | `Groups []string`; `openView`, `recheck`, `samePolicy`, `viewMay` and `viewLLM` follow |
| `actor.Visitor` | `Audience string` | add `Groups []string`; keep `Audience` as the highest group, derived, for existing actor code |

**Also update** these places that read an audience today: `Checker.Subscribed` (`check.go:50`, installed at `kernel/kernel.go:53`); `validSubject` and `visibleStores` (`verbs/stores.go:189`, `:205`); `policy.set` and `llm.set` validation (`verbs/policy.go:87`, `:108`); `createAudience` validation (`verbs/mounts.go:159`); `PolicyMatrix` and `SetPolicy` (`system/policy.go:76`, `:93`); the `Policy` hooks (`server/server.go:110`, `actor/manager.go:47`), which now take groups; and the hard-coded `"admin"` fallback in `allowed` (`manager.go:75`). `Checker.Subscribed` reaches billing, so compute `@subscriber` only when a check asks for it.

**Keep `audience` as a compatibility field.** `Decision`, `Visitor`, `siteMe` (`live.go:216`, `:224`), `userInfo` (`views.go:893`) and `explain.can` keep returning `audience`, now the name of the highest group, next to a new `groups` list. That keeps `web/runtime` (`caps.ts:27`, `transport.ts:26`), `apps/workshop/actor.js:40` and the tests that assert audience strings working unchanged. `View.Role` doubles as an admin flag (`views.go:103`, `:481`, `rtassets.go:143`): replace it with `View.Groups` plus `View.IsAdmin`, and make `recheck` and `samePolicy` (`live.go:610`, `:623`) compare group sets.

**Subjects and defaults.** Grants accept `@guest`, `@member`, `@subscriber` and `@admin`, never `@store`: cross-store access stays explicit (`check.go:83`). `llm.set` accepts `@store` and `store:<id>`. With no row, `DefaultPolicy` turns `assets` on for `@member` and keeps it off for `@store`; today's `audience != "guest"` test would turn it on for stores. An LLM row with `allowed` off contributes nothing to the max; only a person's own row can switch a person off.

**Migration** `007_groups.sql`: rebuild `app_policy` so its `audience` check also allows `store`. `llm_access.subject` has no check and already accepts `@store` and `store:<id>`.

**Back office** (`web/admin/src/views.jsx`): the policy matrix hard-codes four audience columns (`:151` to `:163`); add `@store` and show a cell as inherited when a lower group turns it on. Add `@store` to the LLM subject list (`:76`). `api-app.js:14` keeps working because `audience` stays. Rebuild the committed bundles (`Makefile:34`): `pkg/server/assets/claude.js`, `pkg/server/admin/app.js` and `apps/backoffice/app.js`.

**Exit:** `TestSubscriberKeepsMemberPolicy`, `TestSubscriberKeepsMemberLLMRow`, `TestGroupsByKind`, and the existing `TestCompsMakeSubscribers` and `TestPolicyChangeClosesViews`. `p6_test.go:76` to `:81` changes on purpose: an admin now inherits a capability turned on for `@member` (see "Existing tests that change on purpose").

### Phase 2: one level rule, and links that end with their creator

**Rewrite** `Checker.Level`, `pkg/access/check.go:112`, as one expression with no branches:

```go
// Level is the max over every source, then the min over every ceiling.
func (c *Checker) Level(ctx context.Context, p *Principal, st system.StoreRow) Decision {
	d := Decision{Groups: c.Groups(ctx, p)}
	d.Audience = Top(d.Groups) // compatibility field
	src := rt.LevelNone
	from := func(l rt.Level, why string) { src = max(src, l); d.Trace = append(d.Trace, "source: "+why) }
	switch {
	case p != nil && p.Kind == KindSystem:
		from(rt.LevelOwner, "the kernel")
	case p != nil && p.Kind == KindStore && p.Store == st.ID:
		from(rt.LevelOwner, "a store on itself")
	}
	if st.Owner != "" && st.Owner == p.ID() {
		from(rt.LevelOwner, "owner of "+st.ID)
	}
	if In(d.Groups, GroupAdmin) {
		from(rt.LevelAdmin, "@admin is admin on every store")
	}
	for _, g := range c.liveGrants(ctx, st.ID) { // link grants already filtered
		if g.Subject == p.ID() || In(d.Groups, Group(g.Subject)) {
			// owner comes only from the owner column, as today
			from(min(g.Level, rt.LevelAdmin), fmt.Sprintf("grant %s %s (%s)", g.Subject, g.Level, g.Via))
		}
	}
	ceil, why := kindCap(p)
	d.Trace = append(d.Trace, "ceiling: "+why)
	d.Level = min(src, ceil)
	return d
}
```

| `kindCap(p)` | Ceiling |
| --- | --- |
| the kernel, a store | owner |
| role disabled; a token with no scopes | none |
| anonymous, guest kind, person kind guest, role pending | interact |
| everyone else | owner |

Grants contribute at most admin, so owner still comes only from creation, as today: `p4_test.go:116` keeps passing, and an admin holding an owner grant stays admin. `grant.set` should refuse `owner` rather than store a grant that can never count. A store principal holds owner on its own store, which phase 4 needs. Delete `capOf` and `AudienceOf`; keep the `Audience` string only as the compatibility field. A disabled person's ownership and grants still enter the max, and the ceiling of none removes them, so no early return is needed. Keep a trace line that starts `audience <highest group>`, or update `p1_test.go:137`.

**Live link grants.** Change `system.Grants`, `pkg/system/stores.go:168`, to join `links`:

```sql
SELECT g.store, g.subject, g.level, g.via, l.created_by, l.level, l.revoked_at, l.expires_at
FROM grants g LEFT JOIN links l ON l.id = g.via
WHERE g.store = ?
```

A grant whose `via` is a link counts only if the link is not revoked, not expired, and its creator's level on the store, computed without any link grants, is at least the link's level. Read the creator from `links.created_by`: on the grant row itself, `created_by` is the redeemer (`links.go:123`). A link created by `system` always qualifies. No recursion is possible: `link.new` needs owner or the admin role, links carry at most interact, and the creator's level excludes link grants. `reviewAll` re-checks every open view each minute (`server/server.go:223`), so cache each creator's level per creator, store and epoch.

Two results are new behavior, by decision 7: grants from an expired link stop counting (today they stay after expiry), and links made by an admin who is later demoted stop working.

`RevokeLink`, `pkg/system/links.go:77`, keeps deleting the grants it made, as cleanup. An expired link's grants stay in the table but no longer count; `grant.ls` shows them as inactive.

**Exit:** `TestPendingOwnerCappedAtInteract`; `TestLinkGrantsEndWithCreator` (Ana makes a link, Carl redeems it, Ana's ownership moves to Bea, Carl's next call is refused); `TestExpiredLinkGrantsInert`; `TestLevelNeverAboveCap`, a property test over generated owners, roles, tokens and grants that checks Level = min(max(sources), ceiling); and the existing `TestShareLinks` and `TestDowngradeClosesView`.

### Phase 3: actions declare what they require

**Read the declaration.** In `Actor.readShape`, `pkg/actor/actor.go:203`, read `requires` from each object-form action into `a.requires map[string]rt.Level`. Plain-function actions and objects without `requires` get **admin** (**Amended (SLOP3-007)**) and are added to `a.undeclared`. An unknown level, `self` or `none` sets a shape error that fails activation, which rolls back like any other activation error.

**Check before entry.** In `Manager.Call`, `pkg/actor/manager.go:480`, after the action-exists check:

```go
need := a.requires[action]
have, _ := rt.ParseLevel(vis.Level)
if have < need {
	if have == rt.LevelNone {
		return nil, fail("not_found", "%s has no action %q", storeID, action)
	}
	return nil, fail("permission_denied", "%s needs %s; you have %s", action, need, have)
}
```

That one check covers the `actor.call` verb, the page's `rpcSlopCall` (`pkg/server/actors.go:46`) and store-to-store calls. `ctx.need` stays for checks inside an action that depend on data.

**Warn at activation.** In `Manager.activate`, `manager.go:351`, log one line per undeclared action to the actor log (`app.logs`): `action X declares no requires; callers need admin`.

**Update the shipped actors.** Give every action an explicit `requires`, `view` for read-only ones:

| File | `ctx.need` calls today |
| --- | --- |
| `apps/workshop/actor.js` | 11 |
| `examples/journal/actor.js` | 7 (its post-reading actions become `view`) |
| `apps/blocks-site/actor.js` | 3 |
| `apps/backoffice/actor.js` | 1 |
| `examples/guestbook/actor.js` | 1 |

Update the actor reference (design doc appendix D, SLOP3-001 guide) to show the object form.

**Exit:** `TestActionWithoutRequiresNeedsAdmin`; `TestActionRequiresBadLevelFailsActivation`; `p3_examples_test.go` with the updated examples.

### Phase 4: self and visitor in actors

**The store as its own visitor.** Replace `Manager.storeVisitor`, `pkg/actor/manager.go:293`, so alarms, reactors and setup never borrow the owner:

```go
func (m *Manager) storeVisitor(ctx context.Context, id string) Visitor {
	v := Visitor{ID: "store:" + id, Name: id, Level: "owner", // its own store: local effects
		Groups: []string{"@store"}, Audience: "store", Payer: "store:" + id}
	m.withLLM(ctx, &v)
	return v
}
```

`Manager.allowed` (`:69`) evaluates policy cells for the visitor's groups, so a store turn needs the `@store` cell. `allowedAny` (`:82`) includes the `store` column, so `use('sample')` is not null for an app whose only cell on is `@store`.

**One acting principal.** In `pkg/server/modules.go`, replace `actAs` (`:148`) with `actingPrincipal(a, module)`. With a visitor it returns the visitor's person, with their token scopes, as today. Without one:

- **Platform operations** (`platformModule`, `pkg/server/platform.go:22`) act as `&access.Principal{Kind: access.KindStore, Store: id, Via: "app:" + app}`. A store principal holds owner on its own store (phase 2) and only what was granted to `store:<id>` elsewhere; the verb gate refuses the rest.
- **Trusted-module calls** (`workshop`, `system`) act as `store:<id>` (**Amended (SLOP3-007)**; the original acted as the admin in `app_modules.granted_by`, which borrows a person). The trust row is the fact that admits them: it counts only while `granted_by` is still an admin, checked live, like a link and its creator. The log names `store:<id>` via `app:<id>`, never a person. Module functions that need the platform admin floor accept a store principal only through a live trust row for that module, so the back office's `system:*` reactor keeps working (`w2_test.go:83`).

In `callVerb` (`:112`), guard `p.Person == nil` before the `Confirm` path reads `p.Person.ID` (`:129`): a store has no one to confirm. Every `Confirm` verb is admin-only today, so `Check` refuses first, but the guard should not depend on that.

**Model calls from store turns.** `sampleCheck`, `pkg/actor/sample.go:22`, already reads the payer from the visitor; with the new `storeVisitor` that is `store:<id>`, and `LLMFor("store:<id>", [@store])` finds the store's own row, else an `@store` row.

**Cross-store handles decide per call.** In `storesModule`, `pkg/actor/modules.go:467`:

- Every function on the handle (`docs.get`, `docs.query`, `files.*`, `assets.*`, `log`, `call`) calls `Access.Can` for `store:<id>` with the current turn's context, not the one captured at open, and reloads the target's rules.
- `call` (`:566`) builds its visitor with `Groups: ["@store"]` and the fresh level, instead of the hard-coded `Audience: "member"`, so phase 3's check applies.

**Exit:** `TestAlarmPlatformActsAsStore`, `TestAlarmSampleNeedsStoreCellAndBudget`, `TestStoresOpenRechecks`, `TestConfirmNeedsAPerson`, `w2_test.go` unchanged, and `p6_test.go:117` to `:133` updated (see "Existing tests that change on purpose").

What changes on purpose for code with no person behind it: it can't create stores, since a store is not in `@member` and stores never own stores; it can't set mounts, which are admin-only; it can set grants only where `store:<id>` holds admin; and a store-to-store call no longer passes `needAudience('member')` in the callee, since stores have levels, not audiences.

### Phase 5: a budget ledger with a hold per model round

**Migration** `008_ledger.sql`. `llm_usage.person` already holds any account id, so `store:<id>` needs no new column.

```sql
ALTER TABLE llm_usage ADD COLUMN reserved_tokens INTEGER NOT NULL DEFAULT 0;
CREATE TABLE llm_holds (
  id TEXT PRIMARY KEY,             -- idempotency key: <call id>/<round>
  account TEXT NOT NULL,           -- usr_…, vis_…, store:<id>
  period TEXT NOT NULL,            -- 'YYYY-MM' when taken; settles there
  amount INTEGER NOT NULL,
  used INTEGER,
  state TEXT NOT NULL CHECK (state IN ('held', 'settled', 'released')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL);
CREATE INDEX llm_holds_open ON llm_holds (expires_at) WHERE state = 'held';
```

**Add** `pkg/system/ledger.go`:

| Function | Does |
| --- | --- |
| `Reserve(ctx, account, limit *int64, n int64, key string) (Hold, error)` | Inserts the hold, then `UPDATE llm_usage SET reserved_tokens = reserved_tokens + :n WHERE person = ? AND period = ? AND (:limit IS NULL OR :limit - used_tokens - reserved_tokens >= :n)`. No row updated: roll back, return `ErrQuota`. A repeated key returns the existing hold |
| `Settle(hold, used int64)` | `held` to `settled`: `used_tokens += used`, `reserved_tokens -= amount`, in the hold's period |
| `Release(hold)` | `held` to `released`: `reserved_tokens -= amount` |
| `ExpireHolds(now)` | Settles every `held` row past `expires_at` at its full amount: the provider may have billed it |

All four run in a `ledgerTx` that does **not** move the epoch, does not call `OnLog`, and writes no `_log` rows. PR #14's epoch moves on every committed `Tx`, so a write per model round would make every open view decide again; a `_log` row per round would also wake every `system:*` reactor. Balances are never part of a cached decision, so this is safe; say so in the function's comment and test it. Today's `AddLLMUsage` already uses a plain `ExecContext`. The limit comes from `LLMFor` (phase 1); `nil` means unlimited, and holds are still recorded.

**Add a meter to** `pkg/llm/backend.go`, and a `Meter Meter` field (`json:"-"`) to `Request` (`:39`):

```go
// Meter is asked before each model round; an error from Before ends the
// call before the provider is contacted.
type Meter interface {
	Before(ctx context.Context, round int, est Estimate) (Hold, error)
}
type Estimate struct {
	Model           string
	InputTokens     int64 // conservative: context bytes / 3, plus a fixed allowance per image
	MaxOutputTokens int64 // the round's output cap
}
type Hold interface {
	Settle(Usage) // with the round's usage event
	Release()     // the round never reached the provider
}
```

**Call it in the round loop**, `pkg/llm/gepp/sample.go:98` to `:147`, just before `eng.RunInference` (`:118`), using `contextBytes(t)` and `perRound`. Settle from the round's usage event, emitted by the `sink` (`:337` to `:346`). If the round errors and no usage arrived, settle at the held amount; expiry covers crashes. When `Before` refuses, emit an `error` event with code `quota_exceeded`, preceded by a `result` marked `Truncated` if any text was produced. `pkg/llm/fake.go` emits one usage event and at most one tool call today; give it a multi-round fixture (N rounds, fixed usage each) that calls the meter the same way.

**Wire the callers:**

- `startSample`, `pkg/server/sample.go`: set `req.Meter` for the viewer's account and delete the charge after the call (`:214` to `:216`). `sampleView` (`:90`) keeps its quick remaining-greater-than-zero check for a fast error.
- The actor `sample` module, `pkg/actor/sample.go`: the same, for the visitor's payer; delete the charge at `:102` to `:104`.
- `sample.limits`: report remaining as limit minus used minus reserved.
- Call `ExpireHolds` from the existing one-minute ticker (`server/server.go:214` to `:226`); holds expire 10 minutes after they are taken. Tickers don't run in the `httptest` harness, so tests call `ExpireHolds` directly.

**Exit:** `TestConcurrentSamplesCannotOverspend`; `TestReservationsDoNotMoveEpoch`; `TestHoldExpiresAtFullAmount`; `TestRoundRefusedEndsWithPartialResult`; `TestRetryReusesHold`.

### Phase 6: cost units (optional; deferred in SLOP3-007)

**Amended (SLOP3-007):** deferred. Since GitOps #411 all three tiers use `lunaroute/deepseek-4.1-flash` (low, medium, high thinking), so a token costs the same on every tier. Pick this up when tiers use different models again.

Today one token costs the same on every model. To charge in money, price each hold and settlement at the model's rates and keep the ledger in µUSD; `llm.Usage` already has an unused `Cost` field.

- **Decide first:** where rates come from. Either the model configuration that `pkg/llm/gepp` loads, or a new `llm_rates` table with an admin verb.
- Convert `llm_access.budget_tokens` to `budget_microusd` once, at a stated rate. Show pages tokens left at the requested model's rate.
- **Exit:** `TestTiersChargeDifferently`.

### Phase 7: explain and the spec

- `explain.can` (`pkg/verbs/access.go:42`) returns groups, sources, ceiling, level, need and result. The CLI prints the three lines this doc uses: facts entering the max, caveats entering the min, and the need.
- Add `testdata/authz/cases.json` with the eleven worked examples as fixtures: people, roles, stores, grants, links, policy cells, allotments, the request and the expected answer. `TestWorkedExamples` sets each up through verbs and checks the answer.
- Bring `lab/src/kernel/access.js` to the same rules: pending is guest-like (interact ceiling) instead of none, groups use the `@` names, and app principals become store principals. A node runner for the shared cases is a follow-up, since the lab kernel needs its SQLite build.
- **Exit:** `TestWorkedExamples` and a golden test of the explain output.

### Existing tests that change on purpose

Most existing tests keep passing, because `audience` stays as a compatibility field and grants still stop at admin. Two change on purpose; update them in the phase that changes the behavior.

| Test | Today it expects | After | Phase |
| --- | --- | --- | --- |
| `p6_test.go:76` to `:81` | An admin is refused a capability that is on only for `@member` and `@subscriber` | Allowed: admins are in `@member` | 1 |
| `p6_test.go:117` to `:133` | An alarm's model call is charged to the owner, behind the `@admin` cell | Charged to `store:ai`; needs the `@store` cell and an `@store` or `store:ai` row | 4 |
| `p1_test.go:137` | A trace line `audience member` | Unchanged if the trace keeps that line | 2 |
| `p4_test.go:116` to `:117` | An owner grant to a member stops at admin | Unchanged: grants contribute at most admin | 2 |
| `w2_test.go:83` to `:95` | A reactor lists stores through the system module, as the owner | Unchanged in outcome: it acts as `store:<id>`, admitted by the live trust row the fixture's admin made | 4 |
| `p2b_test.go:179`, `p3_test.go:42` and `:93`, `p5_test.go:141` and `:155` | Audience strings | Unchanged: `audience` is the highest group's name | 1 |

### Not in this plan

- One `facts` table. After phases 1 and 2 every input is read through groups and one `Level`, so moving rows into one table is a mechanical cutover for later.
- App-declared rights, path-scoped grants and owner-defined groups.
- Bans and abuse controls (decision 8).
- Delegates, designed for v3.1.
- Owners funding their stores from their own budget.
- Whether platform calls made for a person should ask that person to confirm, as trusted-module functions marked `Confirm` do.

### Handoff checklist

- [x] PR #14 merged; branch `task/slop3-007-authority-core` from `main`.
- [x] Ticket `SLOP3-007` created under `ttmp/` with this plan, a diary and a task per phase.
- [ ] Phase 0 tests written, each skipped with its phase name.
- [ ] Each phase merged as its own pull request, with its exit tests unskipped and the full Go and runtime suites green.
- [ ] Done when every phase 0 test passes and `git grep -E 'AudienceOf|AtLeast\(|audRank|capOf'` finds nothing outside history; `AddLLMUsage` is called only from `Settle`; and no code sets `Payer` to a store's owner.
