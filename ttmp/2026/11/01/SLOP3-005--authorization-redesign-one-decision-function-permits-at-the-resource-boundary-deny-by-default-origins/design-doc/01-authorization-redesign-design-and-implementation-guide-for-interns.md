---
Title: 'Authorization redesign: design and implementation guide for interns'
Ticket: SLOP3-005
Status: active
Topics:
    - access
    - auth
    - architecture
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/access/check.go
      Note: audience ladder, levels, grants, Can (wrapped by Decide)
    - Path: repo://pkg/server/live.go
      Note: credentials on the live host, handoff, reviewViews/recheck
    - Path: repo://pkg/server/views.go
      Note: views cache Level/Role/Policy; RPC dispatch (phases A3, A4)
    - Path: repo://pkg/store/sqlpolicy.go
      Note: SQL authorizer and caller kinds (phase A7)
    - Path: repo://pkg/verbs/mounts.go
      Note: needCodeRight, D9 (phase A5)
    - Path: repo://pkg/verbs/verb.go
      Note: the verb gate (phase A4)
    - Path: repo://web/runtime/src/db.ts
      Note: runtime mirror and cursor (phase S1)
ExternalSources: []
Summary: 'How authentication and authorization work in slop v3 today, why the eleven findings of the PR #13 review happened, and a design (one decision function over current state, credentials with ceilings, permits at the resource boundary, author authority for SQL, deny-by-default trusted origins, rev-guarded sync, idempotent mutations) with a phased implementation plan.'
LastUpdated: 2026-11-01T21:26:30.101173303-05:00
WhatFor: 'Onboarding an intern to slop''s access control and guiding the redesign that makes the PR #13 classes of bugs impossible by construction.'
WhenToUse: Before changing anything that decides who may read, write, run or serve something in slop; when implementing phases A0 to S2.
---

# Authorization redesign: design and implementation guide for interns

## 1. What this document is for

This document explains how slop decides who may do what, why that decision process produced eleven findings in the code review of pull request #13, and how to reorganize it so that those classes of bugs cannot be written again. It is written for an engineer who knows Go, HTTP and cookies but has never seen slop. By the end you should be able to trace any request from the bytes that arrive at the server to the decision that allows or refuses it, name the file and function where each rule lives, and implement the redesign phase by phase.

The review of PR #13 (the cutover from slop v2 to v3) found real problems: a page kept writing after its user was downgraded, a member could deploy server code through an import, uploaded HTML ran on a trusted origin, and so on. Each one was fixed with a small patch and a regression test. The patches are correct, but they share a pattern: a rule existed, and one more entry point forgot to apply it, or applied a copy of a decision that had gone stale. Fixing the eleventh instance does not prevent the twelfth. The design in section 6 changes where decisions are made so that forgetting becomes a compile error or a failing structural test instead of a review finding.

How to read it:

- Sections 2 to 4 describe the system as it is today. Read them in order; each builds on the vocabulary of the previous one.
- Section 5 walks through the review findings and groups them by root cause.
- Section 6 is the design. Section 7 is the implementation plan, section 8 the test strategy.
- Sections 9 and 10 are references (APIs and files) for when you are working on a phase.

Every claim about current behavior names the file and line where it can be checked. Line numbers are those of branch `task/slop-v3` at commit `8301cf0`; they drift, so search by function name when they do.

## 2. The system in five minutes

slop v3 is a hosting service built around one noun, the **store**. A store is a SQLite database (`stores/<id>/store.db` under the data directory) that holds documents (JSON at paths such as `notes/a`), files with snapshots and refs (a tree zone that is versioned and an assets zone for uploads), and app tables created by migrations. An **app** is a store whose tree holds an `app.json` manifest and, optionally, an `actor.js`: server code that runs on goja, one **turn** at a time per store. A store can run its own app or another store's app; a Claude Blocks workspace such as `ws-team` is a store of type `blocks` that runs the app stored in the store `blocks`.

The server answers on four kinds of **host**, chosen by the `Host` header (`config.HostKind`, `pkg/config/config.go:127`):

| Host kind | Example | Serves | Trust |
|---|---|---|---|
| main | `slop.yolo.scapegoat.dev` | back office, sign-in, `/api/v1/<verb>`, device login | trusted origin, holds the main session |
| live | `apps.slop.yolo.scapegoat.dev` | the **shell** that frames apps, `/_site/*` calls, actor HTTP routes, `/_s/` store files | trusted origin, holds the site session |
| static | `site.slop.yolo.scapegoat.dev` | published snapshots of stores | no sessions |
| sandbox | `s<label>.sbx.slop.yolo.scapegoat.dev` | an app's pages, one origin per store and app; `/_rt/*` runtime calls | untrusted by design |

A browser that opens an app on the live host gets the shell, a small trusted page. The shell asks the server to open a **view** (a server-side record of "this person is looking at this store through this app") and frames the app's page on its sandbox origin. The page talks to the server through the **runtime** (`window.claude`, built from `web/runtime`), which calls `/_rt/rpc` and streams `/_rt/events` on the sandbox origin with the view's secret. Agents and the CLI call verbs on the main host with personal tokens.

```text
 browser                         server (one Go binary)                       disk
 ───────                         ──────────────────────                       ────
 back office ──── main host ───▶ /api/v1/<verb> ─▶ verbs.Call ─┐
 CLI / agent ──── main host ───▶ (token)                       │
                                                               ├─▶ kernel ──▶ system.db (people, sessions,
 shell ───────── live host ───▶ /_site/* , actor routes ───────┤              grants, mounts, policy)
                                /_s/<store>/... files          │
 app page ────── sandbox ─────▶ /_rt/rpc , /_rt/events ────────┤          ──▶ stores/<id>/store.db
   (view secret)                (view → method table)          │          ──▶ blobs/
 public site ─── static host ─▶ published snapshots ───────────┘
```

The rest of this document is about the arrows: what identity each one carries, and where the server decides whether the request may proceed.

### 2.1 Vocabulary

| Term | Meaning | Where |
|---|---|---|
| principal | whoever acts: a user, a guest, a token, a store's actor, or the kernel | `access.Principal`, `pkg/access/principal.go:21` |
| audience | a ladder computed per request: none < guest < member < subscriber < admin | `access.AudienceOf`, `check.go:66` |
| level | a principal's access to one store: none < view < interact < admin < owner (and `self`, held by nobody) | `rt.Level`, `pkg/rt/rules.go` |
| grant | a row "subject has level on store"; subjects are person ids, `@guest`, `@member`, `@subscriber`, `store:<id>` | `system.Grants` |
| share link | a token that, when redeemed, creates a grant for the redeemer | `pkg/server/sitelinks.go` |
| token scope | a CLI token's ceiling: read, write, admin | `system.ScopeRead/Write/Admin`, `pkg/system/sessions.go:78` |
| db rule | per-path minimum levels for reading and writing documents, from the manifest | `rt.Rules`, `pkg/rt/rules.go:145` |
| policy cell | may app X use capability Y for audience Z (assets, sample, user.email, fetch, secrets, platform) | `system.Policy`, `pkg/system/policy.go:41` |
| D9 | decision 9 of the v3 design: only admins write app code | `needCodeRight`, `pkg/verbs/mounts.go:210` |
| view | a page's authorized session with one store | `rt.View`, `pkg/rt/views.go:27` |
| view secret | the bearer (`slv_…`) a page's runtime sends | `rt.SecretPrefix`, `pkg/rt/views.go:13` |
| turn | one serialized unit of work in a store; SQL inside it runs under a **caller** kind | `store.Turn`, `pkg/store/turn.go` |
| caller | who prepared a SQL statement: kernel, actor, migration, admin-read, admin-write | `pkg/store/sqlpolicy.go:9` |

## 3. Authentication today: how a request becomes a principal

Authentication answers "who is this?" and produces an `access.Principal`. Authorization (section 4) then answers "may they?". In slop the two are entangled in places, which is part of the problem; this section separates them.

### 3.1 The principal

```go
// pkg/access/principal.go:21
type Principal struct {
	Kind    string         // user, guest, token, store, system
	Person  *system.Person // the user or guest (the token's user for tokens)
	TokenID string         // tokens only
	Scopes  []string       // tokens only
	Store   string         // store principals: the store id
	Via     string         // the door: cli, http, eval, page, actor, ...
}
```

`ID()` is what logs and `slop_principal()` record: the person id for users, guests and tokens (a token acts as its user), `store:<id>` for a store's actor, `system` for the kernel. Two helper predicates matter later: `IsAdmin()` (`principal.go:67`) is true for the kernel and for any principal whose person has the admin role, *regardless of token scopes*; `HasScope(need)` (`principal.go:73`) is true for every non-token principal and checks the ordered scopes (admin implies write implies read) for tokens.

### 3.2 Credentials

| Credential | Carried as | Resolved by | Becomes |
|---|---|---|---|
| main session | cookie `__Host-slop_session` on the main host | `principalOf`, `pkg/server/auth.go:34` | `KindUser` (or `KindGuest`), `Via: http` |
| CLI token | `Authorization: Bearer <token>` on the main host | `principalOf` (same function, checked first) | `KindToken` with `Scopes` |
| site session | cookie `__Host-slop_site` on a live host | `sitePrincipal`, `pkg/server/live.go:74` | `KindUser` or `KindGuest`, `Via: page` |
| guest session | the same site cookie, for a person of kind guest created on first use | `newGuest` (rate-limited per IP) | `KindGuest` |
| view secret | `Authorization: Bearer slv_…` on the sandbox origin | `viewOf`, `pkg/server/views.go:201`, then `viewPrincipal`, `pkg/server/actors.go:30` | the view; a principal rebuilt from `v.User` when needed |
| module call | an actor calling a trusted Go module | `actAs`, `pkg/server/modules.go:148` | the visitor's principal, with the visitor's token scopes, labelled `app:<app>`; reactors and alarms read only |
| store principal | an actor reading a bound store | `access.Matches`, `check.go:94` | `KindStore`; holds only grants made to `store:<id>` |
| kernel | internal work | `access.System` | `KindSystem`, owner everywhere |

Each resolver builds the principal itself. The code that turns a `system.Person` into a principal (`kind := KindUser; if p.Kind == "guest" { kind = KindGuest }`) appears four times: in `principalOf`, `sitePrincipal`, `viewPrincipal` and `recheck` (`live.go:576`). They agree today; nothing keeps them agreeing.

### 3.3 Sign-in flows

**OIDC on the main host** (ZITADEL in production). `GET /auth/login` starts a flow: a random state, nonce, PKCE verifier and a browser-binding secret are stored in `system.db` as a login flow, the binding goes into a `__Host-slop_flow` cookie, and the browser is redirected to the provider. `GET /auth/callback` (`oidcCallback`, `pkg/server/oidc.go:84`) checks that the state names a live flow started in this browser, exchanges the code with the verifier, requires a verified email, and calls `signIn` (`auth.go:130`), which finds or creates the person (by email; admins from `admin_emails`), creates a main session and keeps the ID token for logout. `POST /auth/logout` (`auth.go:155`) deletes the session and, after an OIDC sign-in, redirects to the provider's end-session endpoint with the ID token as hint.

**Local sign-in** (`localSignIn`, `auth.go:107`) is a development form enabled by `--local`.

**Live-host handoff.** Live hosts never talk to the identity provider. They borrow the main session:

```text
 browser            live host                         main host
    │  GET /_site/login                                   │
    │ ───────────────▶ siteLogin (live.go:341)            │
    │                  state cookie (HMAC, guest id)      │
    │ ◀─────────────── 303 main/auth/handoff?host&state   │
    │  GET /auth/handoff ───────────────────────────────▶ handoff (live.go:354)
    │                                                     principalOf(r): main session?
    │                                                     no  → /auth/login, back here
    │                                                     yes → one-time code for (person, host, state)
    │ ◀────────────────────────────────────────────────── 303 live/_site/callback?code
    │  GET /_site/callback                                │
    │ ───────────────▶ siteCallback (live.go:376)         │
    │                  code matches state cookie?         │
    │                  CreateSession(person, live host,   │
    │                    fromGuest) → site cookie         │
    │ ◀─────────────── 303 return path                    │
```

The `fromGuest` value lets a guest's data move to the person who signs in (the claim, `siteClaim`, `pkg/server/sitelinks.go:115`).

**Device login** (`pkg/server/device.go:21`): `slop auth login` shows a code that a signed-in person approves in the browser; the CLI receives a token with the requested scopes.

### 3.4 Origins and cross-site requests

Sandbox origins (`s<label>.sbx.<domain>`) are *same-site* with the live host when both are subdomains of one registrable domain. `SameSite=Lax` cookies therefore do not stop an app's page from sending a POST to the live host with the visitor's site session. Two helpers guard against that, with different rules:

- `sameOrigin` (`live.go:117`) guards `/_site/*` calls: an `Origin` header must equal the live host's origin, and a POST body must be JSON.
- `crossOrigin` (`live.go:133`) guards actor routes: if `Sec-Fetch-Site` is present and not `same-origin`, or `Origin` differs, the request is served as a guest (`serveLive`, `live.go:164`).

Two helpers for one concern is a smaller instance of the pattern in section 5: the rule "a cookie credential only counts on a same-origin request" is restated per route family.

## 4. Authorization today: who may do what

### 4.1 The audience ladder

`AudienceOf` (`check.go:66`) computes the audience on every request; it is never stored.

| Principal | Audience |
|---|---|
| nil (anonymous), guest, a person of kind guest, a pending person | guest |
| the kernel | admin |
| a store's actor | member |
| a member | member, or subscriber when `Checker.Subscribed` says so (a paid subscription or a comp) |
| an admin | admin |
| a disabled person | none |

### 4.2 Levels on a store

`Level(ctx, p, store)` (`check.go:124`) computes a principal's level on one store and records a trace of why (shown by `slop explain can`):

1. The kernel is owner everywhere. A disabled account holds nothing.
2. The store's owner is owner. An admin-audience principal is admin on every store.
3. Otherwise every grant on the store whose subject matches (`Matches`, `check.go:94`: `@guest` matches every audience from guest up, `@member` from member up, a person id matches that person; a store principal matches only `store:<id>`) contributes its level, and the highest wins.
4. The level is capped by the audience (`capOf`): guests at interact, members and subscribers at admin, admins at owner.
5. A token's level is capped by its scopes (`scopeCap`): read caps at view, write or admin at owner.

`Can(ctx, p, store, need, what, hidden)` (`check.go:182`) wraps `Level` with a threshold and turns a refusal into `permission_denied`, or `not_found` when the caller should not learn that the store exists.

### 4.3 The verb gate and verb bodies

Every main-host API call, CLI command and `eval` door runs a **verb** (`pkg/verbs`): 84 verbs, of which 36 have scope Read, 34 Write and 14 Admin, and 24 are `AdminOnly`. `verbs.Call` runs `verbs.Check` (`pkg/verbs/verb.go:227`) before the verb's `Run`:

```go
// pkg/verbs/verb.go:227 (abridged)
if !p.HasScope(string(v.Scope))           { return permission_denied }
if v.AdminOnly && !p.IsAdmin()            { return permission_denied }
if v.Scope != Read && p.Kind == KindGuest { return permission_denied }
// required arguments ...
```

Everything that depends on the store or the path happens inside `Run`. Most verbs call `e.open(ctx, p, store, need, what)` (`pkg/verbs/env.go:46`), which runs `Access.Can` and opens the store. Some add their own rules: `files.put` and `files.push` call `needCodeRight` (D9); `docs.ls` and `docs.query` filter results with `rules.CanRead` (`queryDocs`, `pkg/verbs/docs.go:106`). The verb gate knows nothing about stores or paths, so each verb is responsible for remembering every rule that applies to the resources it touches.

### 4.4 Inside a store: db rules

An app's manifest may declare db rules: for a path prefix, the minimum level to read and to write (`rt.Rule{Path, Read, Write}`). `Rules.CanRead(path, user, level)` and `CanWrite` (`pkg/rt/rules.go:145`) are pure functions: documents under `data/users/<id>/` are private to that user, the most specific rule wins, and `self` is a level nobody holds, met only by a `{self}` rule on the user's own path. These functions are well designed; the problem is the `level` argument passed into them, which in several places is a value computed earlier and cached (section 4.6).

### 4.5 The app policy matrix

Some capabilities need an administrator's consent per app and audience: `assets`, `sample`, `user.email`, `fetch`, `secrets`, `platform` (`system.PolicyCaps`, `pkg/system/policy.go:19`). `Policy(app, capability, audience)` reads a cell; without a row, `assets` is on for members and up and everything else is off. `slop policy set <app> <capability> @<audience> on|off` writes a cell (`policy.set`, `pkg/verbs/policy.go:66`) and restarts the app's actors, because actors evaluate `use()` at start.

### 4.6 Views: a decision computed once

When the shell opens a view (`openView`, `pkg/server/views.go:137`), the server computes the person's access once and stores it in the view:

```go
// pkg/server/views.go:137 (abridged)
d, _, _ := s.Env.K.Access.Can(ctx, p, storeID, rt.LevelView, "opening", true)
pol := map[string]bool{}
for _, c := range system.PolicyCaps {
	pol[c] = s.Sys.Policy(ctx, run.App, c, string(d.Audience))
}
v := s.rt.views.Open(&rt.View{Target: storeID, App: run.App, User: p.ID(),
	Role: string(d.Audience), Level: d.Level, Caps: caps, Policy: pol, ...})
```

From then on the view's `Level`, `Role` and `Policy` authorize every call the page makes. `viewRPC` (`views.go:444`) looks the view up by its secret, refuses methods whose capability the view was not granted (`grantedCaps`, computed from the same snapshot), and the method then checks `v.Level` against the db rules (for example `dbWrite`, `views.go:593`). `v.Level`, `v.Role` and `v.Policy` are read on 27 lines in 5 files of `pkg/server`.

A cached decision must be invalidated when its inputs change. That job belongs to `reviewViews` (`live.go:564`), called after grant, link, role, subscription and (since PR #13) policy changes, and to the renewal of a view's secret (`siteViewCall`, `live.go:304`). Before PR #13 a level change only *sent the page an event*; a page that ignored it kept its old level. PR #13 made `recheck` (`live.go:576`) close the view when the level, audience or policy cells differ, and made renewal recheck too. That is correct, but the security of every view now depends on every access-changing code path remembering to call a review hook.

### 4.7 Actors and trusted modules

An actor (server JavaScript) sees the person behind each event as a **visitor** (`actor.Visitor`, `VisitorOf`, `pkg/actor/manager.go:282`): id, name, audience and level on the actor's store, computed per event from `Access.Level`. Trusted Go modules (`workshop`, `system`) let an app call verbs *as the visitor*: `callVerb` (`modules.go:112`) builds a principal with `actAs` (`modules.go:148`), which carries the visitor's token scopes and labels the call `app:<app>`; reactors and alarms, which have nobody behind them, may only read, as the store's owner. Module calls then go through `verbs.Call`, so they inherit the verb gate and every verb body's checks, including whatever a verb body forgot.

### 4.8 The SQL authorizer

Inside a store, SQL runs under a caller kind set by the turn (`Turn.WithCaller`, `pkg/store/turn.go:178`). SQLite calls the store's authorizer (`authorize`, `pkg/store/sqlpolicy.go:52`) for every action while a statement is prepared:

| Caller | May |
|---|---|
| kernel | everything (returns `SQLITE_OK` before any check) |
| actor | read everything; write app tables (names not starting with `_`, `sqlite_`, `slop_`); savepoints |
| migration | DDL on app names; FTS5 virtual tables; write app tables |
| admin-read | read everything |
| admin-write | write app tables |

A trigger's body is compiled when a statement that fires it is prepared, and its actions are authorized under *that* statement's caller. A trigger on an app table, fired by an actor's insert, runs its body as the actor: safe. A trigger on a kernel table (`_docs`) fires inside the kernel's own writes and runs its body as the kernel: unrestricted. SQLite passes the authorizer a sixth argument, the innermost trigger or view responsible for the access, which would let the policy treat trigger bodies as app code; the `mattn/go-sqlite3` binding drops it (the comment above `authorize` says so). PR #13 closed the immediate hole by refusing triggers and indexes on non-app tables.

### 4.9 Hosts and response headers

Response headers that protect a trusted origin are set by individual handlers:

| Where | Header |
|---|---|
| shell page, `live.go:652` | `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: same-origin` |
| bound uploads, `serveBoundAsset`, `actors.go:244` | `sandbox; default-src 'none'`, attachment for non-media |
| `/_s/` files on the live host, `serveStoreFile`, `site.go:163` | the same, since PR #13 (`isolate`) |
| view uploads, `rtassets.go:85` | `sandbox; default-src 'none'` |
| sandbox pages, `sandbox.go:114` | `frame-ancestors` the shell origins |
| main host back office, `admin.go` | none: observed on the running demo, `/admin` sends no CSP, `X-Frame-Options`, `Referrer-Policy` or HSTS (v2's production doc says v2 sent them) |

A handler that serves bytes from a store on a trusted origin and forgets the sandbox header serves an XSS. That is finding 3 in section 5.

### 4.10 Where the rules are enforced

| Rule | Enforced at | Count today (excluding tests) |
|---|---|---|
| store level | `Access.Can` / `Access.Level` in verbs, views, modules, routes | 17 call sites in 12 files |
| audience | `AudienceOf` | 11 in 7 files |
| admin role | `IsAdmin()` | 17 in 10 files |
| db rules | `Rules.CanRead` / `CanWrite` | 11 in 3 files |
| D9 (app code) | `needCodeRight` | 6 in 2 files (definition included) |
| view snapshot | `v.Level`, `v.Role`, `v.Policy` | 27 lines in 5 files |
| principal resolution | `principalOf`, `sitePrincipal`, `viewPrincipal`, `actAs` | 25 uses in 9 files (definitions included) |
| SQL authority | caller kinds; `CallerKernel` bypass | 22 uses of `CallerKernel` in 5 files |

The counts come from `git grep -c -E '<pattern>' -- 'pkg/*.go' ':!*_test.go'`; rerun them to see whether a phase reduced them.

There is no single choke point. Correctness depends on each of these call sites applying every rule that concerns the resource it touches, with a fresh decision.

## 5. The review findings and their root causes

The review of PR #13 produced thirteen findings over four rounds; CI found one more problem. Each was confirmed with a test that fails on the old code, then fixed.

| # | Finding | Fixed in | Root cause |
|---|---|---|---|
| 1 | a downgraded view kept writing (its `v.Level` authorized `db.write`) | `ac0b5a9` | R1 cached decision |
| 2 | turning a policy cell off did not reach open views (`v.Policy`) | `fba94f6` | R1 cached decision |
| 3 | `/_s/` store files ran as pages on the live host | `50de31d` | R4 per-handler origin policy |
| 4 | `import.folder` restored `app.json` and `actor.js` without D9 | `d161b5e` | R2 rule at the entry point |
| 5 | `docs.ls`, `docs.query`, `slop.read` applied the limit before the read rules | `d161b5e` | R2 rule at the entry point |
| 6 | an imported trigger on `_docs` ran its body as the kernel | `67da8fe` | R3 ambient authority |
| 7 | reconnect catch-up read the head after the documents | `ac0b5a9` | R5 sync protocol |
| 8 | a subscription's snapshot moved the stream's resume cursor | `1b71424` | R5 sync protocol |
| 9 | a collection's first snapshot deleted a streamed creation | `1b71424` | R5 sync protocol |
| 10 | a document subscription's empty read deleted a streamed creation | `8301cf0` | R5 sync protocol |
| 11 | the runtime resent any RPC after a network error | `40c17e0` | R6 delivery semantics |
| 12 | `/_s/` files read through a guest's own grant were marked publicly cacheable | `ded3f45` | R7 response facts decided per handler |
| 13 | after a failed activation no view could open, though the last good version ran | `7571a18` | R8 lifecycle state as loose fields |
| CI | a call queued while its actor stopped failed with "the actor stopped" | `1d47c2e` | R6 delivery semantics |

### 5.1 R1: decisions captured once and reused

A view stores the outcome of an authorization decision (level, audience, policy cells) and uses it for an hour or more. Findings 1 and 2 are two inputs (grants, policy) whose changes did not reach the copy. The fix in PR #13 adds invalidation, which is correct as long as every access-relevant write calls a review hook and `recheck` compares every input. A future input (a new policy capability, a per-path grant, a time-limited grant) brings the bug back unless someone remembers both.

### 5.2 R2: rules enforced at entry points instead of at the resource

D9 is a property of *writing app code into a store's tree*. It is enforced in two verbs, so the third path that writes a tree (`import.folder`) skipped it (finding 4). Read rules are a property of *returning a document to a caller*; they are applied after the query in each caller, and two of three callers applied the limit first (finding 5). In both cases the store already has one function where the effect happens (`Turn.PutBlob`/`PutFile`/`Snapshot`, `Store.Query`); that is where the rule belongs.

### 5.3 R3: ambient authority

The kernel caller bypasses the SQL authorizer completely. Anything that runs inside a kernel statement (a trigger) inherits that authority, even when an untrusted party wrote it (finding 6). The principle that prevents this class is that code runs with the authority of its author, not of whoever happens to trigger it.

### 5.4 R4: origin policy decided per handler

Whether bytes from a store may run as a page depends on the origin they are served from. That is a property of the host, but each handler decides it (finding 3), and the main host's back office has no protective headers at all.

### 5.5 R7: response facts decided per handler

Whether a response may be kept by a shared cache depends on two facts: could an anonymous visitor read the resource (visibility), and can its bytes change (mutability). `Cache-Control` is set in 18 places across 10 files of `pkg/server`, each deriving those facts itself. `serveStoreFile` inferred visibility from the caller's audience ("a guest is reading it, so it is public") instead of asking whether an anonymous visitor could read it; a guest reads private stores through the grant a share link created (finding 12). Four functions serve store bytes (`serveStatic`, `serveStoreFile`, `serveBoundAsset`, `serveAssetBlob`), each resolving a file and choosing headers; finding 3 was one of them forgetting the sandbox.

### 5.6 R8: lifecycle state as loose fields

`kernel.Running` describes what a store runs with `N`, `Manifest` and `Broken` (and, since finding 13, `Fallback`). Callers (16 calls in 8 files) interpret the combinations themselves: `N == 0` means nothing pushed, `Broken != ""` sometimes means "nothing usable" and sometimes "the newest version failed but the previous one runs". `openView` read it the first way when the second was true (finding 13). The actor manager keeps a third notion of broken (an actor that failed to build) in its own map.

### 5.7 R5 and R6: the sync protocol and delivery semantics

These are not authorization problems, but they have the same shape: a local rule ("a snapshot replaces the mirror", "a cursor moves to the newest rev I heard of", "resend on failure") applied without the invariant that makes it safe. They are part of this ticket because the same redesign effort (one invariant, enforced in one place) fixes them, and because the cursor and retry rules interact with view lifecycles. Section 6.7 sketches them; they can be scheduled separately.

## 6. Design

### 6.1 Goals and non-goals

Goals:

- Keep every rule's meaning: the audience ladder, levels and grants, db rules, the policy matrix, D9, token scopes. The redesign changes *where* and *when* rules are evaluated, not *what* they say.
- Make it impossible, not merely unlikely, to touch a resource without the decision for that resource and action, evaluated against current state.
- Make the classes R1 to R4 structurally impossible and R5 and R6 rest on one stated invariant each.
- Keep the app-facing contract (`window.claude`, verbs, CLI) unchanged, except where a hole is closed.

Non-goals:

- Changing the identity provider, the session lifetime or the sign-in flows of section 3.3.
- Per-field access control or row-level security in app tables.

### 6.2 Principles

1. **One decision function over current state.** Every allow or deny comes from `authz.Decide`, which reads the state it needs at the current epoch. Nothing outside it compares levels.
2. **Credentials carry identity and a ceiling, never a decision.** A session, token, view or module call says who is acting and the most they may ask for; it does not say what they are allowed now.
3. **Enforcement at the resource boundary.** The functions that read or change a resource require a permit for that action and resource. A permit can only be obtained from `Decide`.
4. **Code runs with its author's authority.** A trigger body runs as app code; a module call runs as the visitor; a reactor runs with read access.
5. **Trusted origins deny by default.** The host decides the response policy. Store bytes on a trusted origin are sandboxed unless the response is a trusted shell page.
6. **State merges are rev-guarded** (sync): a state at rev R replaces only entries at or below R.
7. **Mutations are idempotent** (delivery): every mutating request carries a key, and the server answers a repeat with the first result.

### 6.3 Core components

```text
            request bytes
                 │
                 ▼
        ┌──────────────────┐   one place that knows credentials
        │ authn.Authenticate│──▶ Subject (who) + Ceiling (the most they may ask)
        └──────────────────┘
                 │
                 ▼
        ┌──────────────────┐   dispatch knows the action and resource
        │ verb / RPC / route│──▶ Action + Resource
        └──────────────────┘
                 │
                 ▼
        ┌──────────────────┐   rule modules, pure over state at an epoch
        │   authz.Decide    │──▶ Decision {allow, level, audience, cells, trace, epoch}
        └──────────────────┘
                 │ allow
                 ▼
        ┌──────────────────┐   unforgeable, bound to (action, resource)
        │      Permit       │
        └──────────────────┘
                 │
                 ▼
        ┌──────────────────┐   the only functions that touch the resource
        │ store / responder │   (Turn.PutFile, Store.Query, Untrusted bytes)
        └──────────────────┘
```

#### Subject

```go
// pkg/authn (new)
type Subject struct {
	Kind   Kind          // User, Guest, Token, Store, System
	Person *system.Person
	Store  string        // Store subjects
	Token  string        // Token subjects: the token id
}

// SubjectOf is the one place that turns a person into a subject.
func SubjectOf(p system.Person) Subject
```

`Subject` replaces the four inline constructions of section 3.2. It is `access.Principal` without `Scopes` and `Via`; those move to the credential, because they describe how the subject arrived, not who it is.

#### Credential and ceiling

```go
type Credential struct {
	Kind    CredKind // MainSession, SiteSession, Token, View, Module, Reactor, Kernel
	ID      string   // session id hash, token id, view id
	Via     string   // for logs: http, page, cli, eval, app:<app>
	Ceiling Ceiling
}

// Ceiling is the most a credential may ask for, whatever grants say.
type Ceiling struct {
	MaxLevel rt.Level          // token read scope: view; reactor: view; others: owner
	Stores   map[string]bool   // a view: its store only; nil: any store
	Actions  map[Action]bool   // a view: what its app declared; a token: what its scopes allow; nil: any
	Admin    bool              // may use admin-only actions (admin scope or a session)
}

func Authenticate(r *http.Request, host HostKind) (Subject, Credential, error)
```

`Authenticate` replaces `principalOf`, `sitePrincipal` and `viewOf`. It applies the cross-origin rule once: a cookie credential presented on an unsafe cross-origin request is ignored (the request proceeds as anonymous), which subsumes `sameOrigin` and `crossOrigin` (section 3.4). Module calls build a credential with the visitor's ceiling and `Via: app:<app>`; reactors and alarms get a read-only ceiling.

The ceiling also makes the relation between role and token scope explicit. Today `AdminOnly` checks the role (`IsAdmin()`) and the verb's `Scope` checks the token separately; 10 of the 24 admin-only verbs have scope Read or Write (`llm.ls`, `log.system`, `people.ls`, `policy.ls`, `secret.ls`, `sub.ls`; `app.follow`, `mount.rm`, `mount.set`, `mount.undo`), so an admin's read token can list people and secret names (never values) and an admin's write token can change mounts. With ceilings, admin-only actions can require both the admin role and `Ceiling.Admin`; whether they should is listed in section 11.

#### Actions and resources

```go
type Action string

const (
	StoreOpen   Action = "store.open"   // open a view, read store metadata
	DocRead     Action = "doc.read"     // a document path
	DocWrite    Action = "doc.write"
	FilePut     Action = "file.put"     // assets zone, or tree without app code
	CodePush    Action = "code.push"    // tree writes and ref moves of an app (D9)
	AssetUpload Action = "asset.upload" // policy cell assets
	UserEmail   Action = "user.email"   // policy cell user.email
	Sample      Action = "sample"       // policy cell sample, plus LLM access and budget
	RoomEmit    Action = "room.emit"    // topic levels from the manifest
	SQLRead     Action = "sql.read"
	SQLWrite    Action = "sql.write"
	SchemaApply Action = "schema.apply" // migrations, imports of schema
	GrantSet    Action = "grant.set"
	// ... one per verb family; the full table is built in phase A2
)

type Resource struct {
	Store string
	Kind  string // "", doc, file, table, topic
	Zone  string // tree, assets
	Path  string
}
```

| Action | Base level | Additional rules |
|---|---|---|
| store.open | view | ceiling stores |
| doc.read / doc.write | view / interact | db rules (`Rules.CanRead`/`CanWrite`), privacy of `data/users/<id>` |
| file.put | admin (tree), interact (assets) | resource is not app code; else becomes code.push |
| code.push | admin | D9: admin role; ceiling admin |
| asset.upload | interact | policy cell `assets` for the audience; a user, not a guest |
| user.email | view | policy cell `user.email`; manifest scope `email` |
| sample | view | policy cell `sample`; LLM access row and budget |
| schema.apply | admin | D9 when the bundle or migration creates code; app objects only |

#### Decision, epoch and Decide

```go
type Decision struct {
	Allow    bool
	Code     string           // permission_denied | not_found
	Level    rt.Level
	Audience access.Audience
	Cells    map[string]bool  // policy cells consulted
	Trace    []string         // what explain.can shows
	Epoch    uint64
}

// Decide answers one question against the current state.
func (a *Authz) Decide(ctx context.Context, s Subject, c Credential, act Action, r Resource) Decision
```

`Decide` is a pipeline of small rule modules, each a pure function of the subject, credential, action, resource and a read-only snapshot of system state:

```go
func (a *Authz) Decide(ctx context.Context, s Subject, c Credential, act Action, r Resource) Decision {
	st := a.state(ctx)                          // grants, roles, subs, policy, rules, at epoch E
	d := Decision{Epoch: st.Epoch, Audience: audienceOf(st, s)}
	d.Level = levelOn(st, s, r.Store)            // owner, admin, grants, audience cap  (today: access.Level)
	d.Level = min(d.Level, c.Ceiling.MaxLevel)   // token scopes, reactors
	if !c.Ceiling.allows(act, r) { return d.deny("not in this credential's ceiling") }
	spec := actions[act]                         // base level and extra rules for this action
	if d.Level < spec.Level(r) { return d.deny("level") }
	for _, rule := range spec.Rules {            // db rules, D9, policy cell, privacy, ...
		if ok, why := rule(st, s, c, r, &d); !ok { return d.deny(why) }
	}
	d.Allow = true
	return d
}
```

The **epoch** is a counter in `system.db`, incremented in the same transaction as any write that can change a decision: grants, links, roles, subscriptions and comps, store ownership, policy cells, LLM access, and the activation of an app version (whose manifest carries db rules and declared capabilities). `a.state(ctx)` caches the snapshot per epoch, and decisions can be memoized per (credential, action, resource, epoch). Because the epoch is part of every cache key, a change of input invalidates every cached decision at once. Nobody has to remember to call a review hook.

#### Views without cached decisions

```go
type View struct {
	ID, Secret   string
	Subject      authn.Subject
	Store, App   string
	Version      int
	Ceiling      authn.Ceiling // its store, the app's declared capabilities
	Expires      time.Time
	// no Level, Role or Policy
}
```

Every RPC asks `Decide(view.Subject, viewCredential(v), action, resource)`. `grantedCaps` becomes a function of the current decision for each capability. `reviewViews` remains, but only for the user experience: when the epoch moves and a view's capabilities differ, the page gets an `access` event and the shell reopens it with the new capability list. If the event is lost, nothing is wrong: the next call is decided against current state.

#### Permits at the resource boundary

```go
// pkg/authz
type Permit struct {
	act Action
	res Resource
	sub Subject
	d   Decision
	_   [0]func() // not comparable, cannot be built outside this package
}

func (a *Authz) Permit(ctx context.Context, s Subject, c Credential, act Action, r Resource) (Permit, error)

// pkg/store: the only exported writers and readers of the resources
func (t *Turn) PutFile(p authz.Permit, data []byte, ctype string) (File, error)  // p: file.put or code.push on (zone, path)
func (t *Turn) PutBlob(p authz.Permit, sum string, size int64, ctype string) (File, error)
func (t *Turn) Snapshot(p authz.Permit, msg, ref string) (int64, error)         // p: code.push when the tree holds app.json
func (s *Store) Query(ctx context.Context, p authz.ReadPermit, q rt.Query) ([]Doc, error) // filters with p, then limits
```

`Turn.PutFile` checks that the permit names its action and resource; a tree write of `app.json` requires a `code.push` permit. `import.folder` cannot restore a bundle's tree without asking for `code.push` when the bundle holds app code, because there is no other way to write a tree file. `Store.Query` takes a read permit that carries the read predicate (`Rules.CanRead` for this subject at this level) and applies it before the limit, in one implementation shared by `docs.query`, `slop.read` and `db.query`.

Kernel work that legitimately bypasses user rules (restoring a backup, running a migration, the system's own bookkeeping) gets permits from a constructor that only package `kernel` can call (`kernel.SystemPermit`), so a grep for it lists every bypass.

#### Dispatch declares actions

```go
type Verb struct {
	Name     string
	Scope    Scope
	Action   authz.Action                          // new
	Resource func(a Args) authz.Resource           // new: which resource the action is on
	Run      func(ctx context.Context, e *Env, permit authz.Permit, a Args) (any, error)
}
```

`verbs.Call` authenticates nothing (the door did that), builds the resource from the arguments, asks `Permit`, and passes the permit to `Run`. A verb that needs several permits (for example `files.push`, which may write code) asks for them through `e.Permit(...)` with the same credential. The RPC table entries and actor HTTP routes declare actions the same way. A structural test (section 8) fails when a verb or RPC method has no action.

#### Host-class response policy

```go
// pkg/server: every response on a trusted host goes through one writer
type Response interface{ isResponse() }

type ShellPage struct{ HTML []byte }          // trusted pages: the shell, the back office, sign-in pages
type JSON struct{ Status int; Body any }
type Untrusted struct{ File store.File; Blobs *blobs.Store } // bytes from a store

func (h hostPolicy) Write(w http.ResponseWriter, r *http.Request, res Response)
```

On main and live hosts, `hostPolicy.Write` sets a deny-by-default policy (`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`, HSTS on HTTPS). A `ShellPage` gets the shell's own CSP that allows its script. `Untrusted` bytes get `sandbox; default-src 'none'` and are sent as attachments unless they are media. Handlers no longer set security headers; they choose a response type. On static and sandbox hosts the policy is the current one.

#### SQL: author authority

The authorizer should evaluate trigger bodies as app code regardless of which statement fires them. That needs the sixth authorizer argument (the innermost trigger or view):

```go
func (s *Store) authorize(action int, a1, a2, db, inner string) int {
	caller := s.cur.caller
	if inner != "" && caller == CallerKernel {
		caller = CallerApp // a trigger or view body: app code, app tables only
	}
	...
}
```

`mattn/go-sqlite3`'s callback drops that argument. The options are a small patch of the binding (a fork pinned in `go.mod`), or a driver that exposes the full authorizer signature. Phase A7 is a spike to choose. Until then the rule from PR #13 (triggers and indexes only on app tables) stays.

### 6.4 How each finding becomes impossible

| # | Finding | Why it cannot recur |
|---|---|---|
| 1, 2 | stale view level or policy | views hold no decision; every call is decided at the current epoch |
| 3 | store files as pages on the live host | store bytes are `Untrusted`; the trusted-host writer always sandboxes them |
| 4 | import without D9 | tree writes need a `code.push` permit for `app.json`; there is no unchecked writer |
| 5 | limit before read rules | `Store.Query` filters with the permit's predicate before the limit, for every caller |
| 6 | kernel-table trigger | trigger bodies run as app code (author authority); kernel-table triggers are refused anyway |
| 7–10 | sync cursors and snapshot merges | rev-guarded merge and atomic catch-up (section 6.7) |
| 11, CI | duplicate actions, lost queued calls | idempotency keys and store-owned inboxes (section 6.7) |
| 12 | private files publicly cached | responses carry visibility from `Decide(anonymous, read, resource)`; handlers do not set cache headers (section 6.8) |
| 13 | views refused on a fallback version | `Running.Usable()` is the one answer to "can this store serve" (section 6.9) |

### 6.5 What stays the same

Error codes (`permission_denied`, `not_found`, `not_granted`, `revoked`), the explain trace, the CLI and the runtime contract stay. Apps see the same capabilities. The shell's reopen-on-`access` behavior stays, now as user experience rather than security.

### 6.6 Costs and risks

- `Decide` runs on every call instead of once per view. The state snapshot is cached per epoch and decisions are memoized, so the steady-state cost is a map lookup; the epoch moves only on access-relevant writes.
- Touching every verb and RPC is a large change. Phase A2 introduces `Decide` beside the existing checks with a differential test, so behavior can be compared before any check is removed.
- A driver change for SQLite (phase A7) affects every store. It is isolated in its own phase and can be skipped while the PR #13 rule stands.

### 6.7 Adjacent: sync and delivery

**Rev-guarded merge (R5).** Every mirror entry in the runtime records the store rev it reflects. A subscription snapshot at rev R may replace or remove only entries whose rev is at or below R; entries the stream delivered with a higher rev survive. The stream's resume cursor moves only with events the stream delivered. On the server, catch-up reads the head and the documents in one read transaction:

```go
func catchUp(st *store.Store, from int64) (docs []Doc, upTo int64, err error) {
	return st.ReadTx(func(tx *store.ReadTx) error {   // one SQLite read transaction
		upTo = tx.Head()
		docs, err = tx.DocsSince(from)
		return err
	})
}
```

**Idempotent mutations (R6).** The runtime gives every mutating RPC a key (`view id + sequence`); the server keeps the result per key for a few minutes and answers a repeat with it. With that, every method can be retried after a network error again, instead of only the safe ones. **Store-owned inboxes:** a store's event queue belongs to the store, not to an actor instance; when a new version replaces an actor, the queue passes to the successor instead of being failed.

### 6.8 Responses: visibility, mutability, one resolver

A response that carries bytes from a store is described by facts, not headers:

```go
type Visibility int // Public: an anonymous visitor may read it; Private: otherwise
type Mutability int // Immutable: snapshot n or a blob; Moving: a ref (main, draft); NoStore

type StoreBytes struct {
	File       store.File
	Blobs      *blobs.Store
	Visibility Visibility
	Mutability Mutability
}
```

`Cache-Control`, the sandbox CSP and the attachment disposition are derived from these facts and the host class in one function (`writeStoreBytes`):

| Host | Visibility | Mutability | Cache-Control | Isolation |
|---|---|---|---|---|
| any | Private | any | `private, no-cache` | as below |
| any | Public | Immutable | `public, max-age=31536000, immutable` | as below |
| any | Public | Moving | `public, max-age=60, stale-while-revalidate=600` | as below |
| main, live (trusted) | any | any | | `sandbox; default-src 'none'`; attachment unless media |
| static, sandbox | any | any | | none (pages run there by design) |

Visibility is never inferred from the caller. It is the answer to "may an anonymous visitor read this store" (today `Access.Can(nil, …)`, later `Decide(anonymous, store.read, resource)`). One resolver, `resolveStoreFile(st, at, path) (File, Mutability, error)`, turns a store, a snapshot number, ref or the assets zone, and a path into a file and its mutability, for every serving path.

### 6.9 App lifecycle: one state, one question

```go
type Version struct {
	N        int64
	Manifest *apps.Manifest
}

type Failure struct {
	N   int64  // the version that failed
	Why string // manifest unreadable, migration, smoke check, actor build
}

type Running struct {
	Store, App string
	Newest     int64    // the newest snapshot on the ref the store follows (0: nothing pushed)
	Active     *Version // what the store runs now; nil: nothing usable
	Failed     *Failure // the newest version, when it failed
}

// Usable is the only answer to "can this store serve its app".
func (r Running) Usable() (Version, bool)
```

`openView`, the static host, actor routes and status verbs ask `Usable()`; status verbs report `Active` and `Failed` separately. The actor manager's build failures become a `Failure` reported through the same type instead of a parallel map.

## 7. Implementation plan

Each phase ends with an exit test that must pass before the next phase starts. Commit after each phase and record it in the diary. Phases A0 to A6 are the authorization work; A7 is a spike; S1 and S2 are the adjacent work and can run in parallel with A3 onwards.

### Phase L: lifecycle state (independent, first)

1. Introduce `Version`, `Failure`, `Running.Active`, `Running.Failed`, `Running.Usable()` in `pkg/kernel/apps.go`; keep `N`, `Manifest`, `Broken` as derived accessors during the change.
2. Convert the callers (`openView`, `serveStatic`, actor `Get`, `app.status`, `mount` status, `site.go`) to `Usable()`.
3. **Exit:** `TestActors`, `TestViewsOpenOnFallbackVersion` pass; no caller reads `Broken` to decide whether to serve.

### Phase A0: inventory and structural tests (red first)

1. A table-driven test that enumerates `verbs.All()` and the RPC table and records, for each, the action it touches. It fails until phase A4 assigns actions; mark it `t.Skip` with a counter so progress is visible.
2. A test that requests every route of the main and live hosts (from the mux registrations) and asserts the protective headers of section 6.3. It documents today's gaps (the back office) and turns green in phase A6.
3. **Exit:** both tests exist and report the current counts.

### Phase A1: one subject, one authenticator

1. Add `pkg/authn` with `Subject`, `SubjectOf`, `Credential`, `Ceiling`, `Authenticate`.
2. Replace the four person-to-principal constructions; make `principalOf`, `sitePrincipal`, `viewOf` thin wrappers over `Authenticate`.
3. Fold `sameOrigin` and `crossOrigin` into `Authenticate`'s cookie rule.
4. **Exit:** all existing tests pass; a new `TestAuthenticate` covers each credential kind, a disabled person, a cross-origin cookie, and a read-scoped admin token (ceiling without admin).

### Phase A2: actions and Decide beside the existing checks

1. Add `pkg/authz` with `Action`, `Resource`, `Decision`, the action table and the rule modules (level, ceiling, db rules, D9, policy cells, privacy, LLM access).
2. Implement `Decide` by calling the existing functions (`access.Level`, `Rules.CanRead`, `system.Policy`), not by reimplementing them.
3. Differential test: for a fixture of subjects, stores, grants, rules and policy cells, `Decide` agrees with the current checks for every action.
4. **Exit:** `TestDecideMatchesToday` passes; `slop explain can` can print a `Decide` trace.

### Phase A3: the epoch, and views without decisions

1. Migration: an `epoch` row in `system.db`; increment it in every access-relevant write (`SetGrant`, `RemoveGrant`, links, `SetRole`, subscriptions and comps, `SetPolicy`, LLM rows, store owner changes, app activation).
2. `Authz.state` caches per epoch; decisions memoized per (credential, action, resource, epoch).
3. Remove `Level`, `Role`, `Policy` from `rt.View`; RPC methods and `grantedCaps` ask `Decide`.
4. `reviewViews` sends `access` events when capabilities differ; renewal no longer rechecks (nothing to recheck).
5. **Exit:** `TestDowngradeClosesView`, `TestPolicyChangeClosesViews`, `TestShareLinks`, `TestCompsMakeSubscribers` pass; a new test changes a grant directly in `system.db` (no hook) and shows the next RPC refused.

### Phase A4: dispatch declares actions

1. `Verb.Action`, `Verb.Resource`; `verbs.Call` obtains the permit; `Run` receives it.
2. RPC table entries and actor HTTP routes declare actions; `viewRPC` obtains permits.
3. Module calls (`callVerb`) pass the module credential; reactors get the read-only ceiling.
4. **Exit:** the A0 enumeration test passes with no unassigned verbs or methods.

### Phase A5: permits at the store boundary

1. Change `Turn.PutFile`, `PutBlob`, `Snapshot` and `Store.Query` to take permits; add `kernel.SystemPermit` for restore, migrations and bookkeeping.
2. Remove `needCodeRight` and the per-caller read filtering; `import.folder` asks for `code.push` when the bundle's tree holds `app.json`.
3. **Exit:** the package compiles only with permits; `TestOnlyAdminsPushAppCode`, `TestQueryLimitAfterReadRules`, `TestEvalProgram` pass; `grep SystemPermit` lists every bypass and the list is reviewed.

### Phase A6: host-class response policy

1. Add the response types and `hostPolicy.Write`; convert handlers on the main and live hosts.
2. Back office headers (frame-ancestors, referrer, nosniff, HSTS on HTTPS).
3. `StoreBytes` with visibility and mutability, `writeStoreBytes`, and `resolveStoreFile`; convert `serveStatic`, `serveStoreFile`, `serveBoundAsset`, `serveAssetBlob`. No handler sets `Cache-Control` for store bytes.
4. **Exit:** the A0 header test passes; `TestLiveStoreFilesIsolated` and `TestGuestGrantFilesNotPublic` pass without per-handler logic.

### Phase A7: SQL author authority (spike)

1. Compare a patched `mattn/go-sqlite3` callback with drivers that expose the full authorizer signature: cgo needs, FTS5, performance on the existing test suite.
2. Implement `inner`-aware authorization in the chosen driver.
3. **Exit:** a test creates an app-table trigger whose body writes `_meta` and shows it refused when fired by a kernel statement; `TestAppSQLAuthorizer` passes.

### Phase S1: rev-guarded sync

1. Runtime: per-entry rev in the mirror; snapshot merge by rev; cursor moved only by stream events (the PR #13 fixes become special cases of the rule).
2. Server: `store.ReadTx` and catch-up in one read transaction.
3. **Exit:** `web/runtime/test/db.test.ts` passes; a new server test commits between the head read and the document read (injected through a test hook) and shows no lost commit.

### Phase S2: idempotent mutations and store-owned inboxes

1. Runtime: a key per mutating RPC; server: a results table keyed by (view, key) with a short expiry; `rpc` resends every method again.
2. Actor manager: the inbox belongs to the store; a replaced actor's queue moves to its successor.
3. **Exit:** `test/transport.test.ts` updated (an action resent after a network error runs once); `TestCallsSurviveActorRestart` passes without the resend loop in `Call`.

## 8. Testing strategy

- **Rule modules** are pure functions: table-driven unit tests over subjects, audiences, levels, rules and cells.
- **Differential tests** (phase A2) compare `Decide` with today's checks until the old checks are removed.
- **Structural tests** make omissions visible: every verb and RPC method declares an action (A0, A4); every response on a trusted host carries the protective headers (A0, A6); store writers do not compile without permits (A5).
- **Regression tests from PR #13** stay and must pass in every phase: `TestDowngradeClosesView`, `TestPolicyChangeClosesViews`, `TestShareLinks`, `TestLiveStoreFilesIsolated`, `TestOnlyAdminsPushAppCode`, `TestQueryLimitAfterReadRules`, `TestAppSQLAuthorizer`, `TestCallsSurviveActorRestart`, `TestOIDCSignIn`, `TestProbesOnAnyHost`, and the runtime's `db.test.ts` and `transport.test.ts`.
- **End to end**: the Playwright scripts of SLOP3-002 and SLOP3-003 (Workshop, Blocks site, deep links) run against a local server after phases A3, A4 and A6.

Commands:

```sh
GOWORK=off go test ./... -count=1
cd web/runtime && pnpm test
```

## 9. API reference

### 9.1 Current (what you will call or replace)

| Function | File | Purpose |
|---|---|---|
| `(*Checker).AudienceOf(ctx, p)` | `pkg/access/check.go:66` | audience ladder |
| `(*Checker).Level(ctx, p, store)` | `pkg/access/check.go:124` | level with trace |
| `(*Checker).Can(ctx, p, store, need, what, hidden)` | `pkg/access/check.go:182` | threshold check |
| `access.Matches(subject, p, aud)` | `pkg/access/check.go:94` | grant subject matching |
| `(*Principal).IsAdmin()`, `HasScope(need)` | `pkg/access/principal.go:67,73` | role and token scope |
| `verbs.Check(p, name, args)` | `pkg/verbs/verb.go:227` | the verb gate |
| `(*Env).open(ctx, p, store, need, what)` | `pkg/verbs/env.go:46` | store level and open |
| `needCodeRight(ctx, s, p, paths...)` | `pkg/verbs/mounts.go:210` | D9 |
| `queryDocs(ctx, e, p, store, q)` | `pkg/verbs/docs.go:106` | docs.ls, docs.query |
| `(Rules).CanRead(path, user, level)`, `CanWrite` | `pkg/rt/rules.go:145` | db rules |
| `(*DB).Policy(ctx, app, cap, aud)` | `pkg/system/policy.go:41` | policy cell |
| `(*Server).principalOf(r)` | `pkg/server/auth.go:34` | main host credential |
| `(*Server).sitePrincipal(r)` | `pkg/server/live.go:74` | live host credential |
| `(*Server).viewOf(r)`, `viewPrincipal(ctx, v)` | `pkg/server/views.go:201`, `actors.go:30` | view credential |
| `(*Server).actAs(a, write)` | `pkg/server/modules.go:148` | module credential |
| `(*Server).openView(ctx, p, store, parent)` | `pkg/server/views.go:137` | opens a view (computes the snapshot) |
| `(*Server).viewRPC`, `rpcTable` | `pkg/server/views.go:444,430` | RPC dispatch |
| `(*Server).reviewViews`, `recheck`, `samePolicy` | `pkg/server/live.go:564,576,602` | view invalidation |
| `(*Server).serveStoreFile(w, r, p, isolate)` | `pkg/server/site.go:163` | `/_s/` files |
| `(*Store).authorize(action, a1, a2, db)` | `pkg/store/sqlpolicy.go:52` | SQL authorizer |
| `(*Turn).WithCaller(caller, fn)` | `pkg/store/turn.go:178` | SQL caller |
| `(*Turn).Restore(bundle)` | `pkg/store/export.go:137` | imports |
| `(*Manager).VisitorOf(ctx, p, store)` | `pkg/actor/manager.go:282` | actor visitor |

### 9.2 Proposed

| Type or function | Package | Phase |
|---|---|---|
| `Subject`, `SubjectOf(person)` | `authn` | A1 |
| `Credential`, `Ceiling`, `Authenticate(r, host)` | `authn` | A1 |
| `Action`, `Resource`, action table | `authz` | A2 |
| `Decision`, `(*Authz).Decide(ctx, s, c, act, r)` | `authz` | A2 |
| epoch row, `(*Authz).state(ctx)` | `system`, `authz` | A3 |
| `Permit`, `ReadPermit`, `(*Authz).Permit(...)` | `authz` | A4, A5 |
| `kernel.SystemPermit(reason)` | `kernel` | A5 |
| `Verb.Action`, `Verb.Resource` | `verbs` | A4 |
| `ShellPage`, `JSON`, `Untrusted`, `hostPolicy.Write` | `server` | A6 |
| `authorize(action, a1, a2, db, inner)` | `store` | A7 |
| `(*Store).ReadTx(fn)` | `store` | S1 |
| idempotency results table | `system` | S2 |

## 10. File reference

| File | Role today | Phases |
|---|---|---|
| `pkg/access/principal.go` | principal, `IsAdmin`, `HasScope` | A1 (subject moves to `authn`) |
| `pkg/access/check.go` | audience, level, grants, `Can` | A2 (wrapped by `Decide`) |
| `pkg/rt/rules.go` | db rules | A2 (a rule module) |
| `pkg/system/policy.go` | policy matrix | A2, A3 (epoch on write) |
| `pkg/system/stores.go`, `sessions.go`, `people.go` | grants, sessions, tokens, roles | A3 (epoch on write) |
| `pkg/verbs/verb.go`, `env.go` | verb gate, `open` | A4 |
| `pkg/verbs/files.go`, `data.go`, `docs.go`, `mounts.go` | file pushes, imports, queries, D9 | A5 |
| `pkg/server/auth.go`, `live.go`, `oidc.go` | credentials, handoff, views review | A1, A3 |
| `pkg/server/views.go`, `actors.go`, `rtassets.go`, `modules.go` | views, RPC, bound reads, uploads, module calls | A3, A4 |
| `pkg/server/site.go`, `sandbox.go`, `admin.go`, `server.go` | responses per host | A6 |
| `pkg/store/sqlpolicy.go`, `turn.go`, `files.go`, `docs.go`, `export.go` | SQL authority, writers, queries, restore | A5, A7, S1 |
| `pkg/actor/manager.go`, `actor.go` | visitors, inbox | A4, S2 |
| `web/runtime/src/db.ts`, `transport.ts` | mirror, cursor, RPC retries | S1, S2 |
| `pkg/server/p2_test.go`, `p4_test.go`, `p5_test.go`, `w1_test.go`, `p2b_test.go`, `pkg/store/store_test.go`, `web/runtime/test/*.test.ts` | the regression tests of section 8 | all |

Design references: the v3 intern guide (`ttmp/2026/11/01/SLOP3-001--…/design-doc/01-slop-v3-core-design-and-implementation-guide-for-interns.md`, sections 7 and 8 on people, audiences and the policy matrix), the cutover diary (`ttmp/2026/11/01/SLOP3-004--…/reference/01-diary.md`, steps 2 to 4 on the review findings), and pull request #13's review threads.

## 11. Open questions

- **Memoization scope.** Per request, per view, or global per epoch? Global per epoch is simplest; a busy server with frequent grant changes would recompute often. Measure before optimizing.
- **Audience changes.** Should an audience change alone (same level) change a view's capabilities? With `Decide` it does automatically when a policy cell differs by audience; confirm that this is the intended product behavior for subscriptions ending.
- **Share links.** Today redemption creates a grant. Should a link instead be a credential with its own ceiling (no grant row), so revoking the link revokes access without a grant cleanup?
- **Owner versus admin.** `Level` makes store owners owner and admins admin. Some actions (deleting a store) may want owner only; the action table is the place to say so.
- **SQLite driver.** Patch, fork or switch for the sixth authorizer argument (phase A7).
- **A change feed for views.** `AccessChanged`, `PersonChanged`, `PolicyChanged`, `reviewViews`, `reloadApp` and the actor manager's activation callback are separate notifications that each code path must remember to call. With the epoch (phase A3) they no longer carry security; the remaining user-experience part (tell pages to reopen or reload) could become one feed over the system log that views subscribe to.
- **Live-host sign-out.** Signing out on a live host ends only the site session; should it end the main session and the identity provider's session too?
- **Admin actions and token scopes.** Should every admin-only action require a token with the admin scope (`Ceiling.Admin`), or only the actions that change people and access? Today an admin's read token can call six admin-only read verbs, including `people.ls` and `secret.ls` (names only).
