---
Title: Diary
Ticket: SLOP3-005
Status: active
Topics:
    - access
    - auth
    - architecture
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of the SLOP3-005 authorization redesign: the guide, then the phases."
LastUpdated: 2026-11-01T21:26:30.219028565-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: The guide (current authn/authz, the PR #13 findings, the design, the plan)

The user asked whether the PR #13 review findings could be fixed at a
systemic level by reorganizing authentication and authorization around
core components. The answer in the conversation was yes, for six of the
eleven. The other five belong to two adjacent families: sync protocol and
delivery semantics. The user then asked for a ticket and an intern guide.

This step reads the access code end to end and writes the guide:
- today's credentials and rules, with file and line references;
- the eleven findings grouped by six root causes;
- a design: `Decide` over current state with an epoch, credentials with
  ceilings, permits at the resource boundary, author authority for SQL,
  and a host-class response policy;
- phases A0 to A7 and S1 to S2, each with an exit test.

The guide is uploaded to reMarkable.

### Prompt Context

**User prompt (verbatim):** "Ok, create a new docmgr ticket for the auth fixing. Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

The question before it (verbatim): "Are these issues https://github.com/go-go-golems/slop-computer/pull/13 something that could be fixed at a systemic level, maybe by rethinking / reorgnizing the way authentication and authorization is handled to make it simple and composable based on core components?"

**Assistant interpretation:** A design ticket with an intern guide;
analysis and design only, no implementation.

**Inferred user intent:** Decide whether and how to restructure access
control before more features accumulate on the current structure.

### What I did

- Read the access model:
  - `pkg/access/check.go`: `AudienceOf`, `Level`, `Can`, `Matches`,
    `capOf`, `scopeCap`;
  - `pkg/access/principal.go`.
- Read the verb gate (`verbs.Check`, `pkg/verbs/verb.go:227`) and
  `Env.open`.
- Read the credential resolvers: `principalOf`, `sitePrincipal`,
  `viewOf`/`viewPrincipal`, `actAs`.
- Read the handoff (`siteLogin`, `handoff`, `siteCallback`), the view
  opening and RPC dispatch (`openView`, `viewRPC`, `rpcTable`), the db
  rules (`rt/rules.go`), the policy matrix (`system/policy.go`) and the
  SQL authorizer (`store/sqlpolicy.go`).
- Counted the decision points with
  `git grep -c -E '<pattern>' -- 'pkg/*.go' ':!*_test.go'` (section 4.10).
- Checked the main host's headers on the running demo:
  `curl -D - -H 'Host: slop.localhost:18300' http://127.0.0.1:18300/admin`
  shows no CSP, `X-Frame-Options`, `Referrer-Policy` or HSTS.
- Checked the admin-only verbs by scope: 6 Read, 4 Write, 14 Admin. So an
  admin's read token can call `people.ls` and `secret.ls` (names only).
  Recorded as an open question, not a bug.
- Wrote the guide (779 lines), the tasks (A0 to A7, S1, S2), the index
  overview and the file relations. `docmgr doctor` passes.
- Uploaded: `remarquee upload bundle <guide> --name "SLOP3-005
  Authorization Redesign Intern Guide" --remote-dir "/ai/2026/11/01/SLOP3-005"
  --toc-depth 2` printed `OK: uploaded SLOP3-005 Authorization Redesign
  Intern Guide.pdf -> /ai/2026/11/01/SLOP3-005`.

### Why

- **Why phase A2 calls the existing functions.** `Decide` calls
  `access.Level`, `Rules.CanRead` and `system.Policy` rather than
  reimplementing them, so a differential test can show it agrees before
  any old check is removed.
- **Why the epoch is the key design element.** It replaces "every writer
  must remember to call a review hook" with "every cache key includes the
  epoch", which cannot be forgotten by a new reader of the state.

### What didn't work

- **The first pass at file:line references found almost nothing.**
  `grep -n -E` treated `(c \*Checker)` as a group, so most lookups
  matched nothing. Redone with `grep -F`.
- **The first counts summed per-pattern totals** (31 view-snapshot reads).
  One combined regex gives 27 lines in 5 files; the guide uses the
  combined figures.

### What I learned

- `IsAdmin()` ignores token scopes, and 10 admin-only verbs have scope
  Read or Write.
- v3's back office sends no protective headers, where v2's production doc
  lists them.

### What warrants a second pair of eyes

- **The action table in section 6.3** is a sketch. Phase A2 must derive it
  from all 84 verbs and every RPC method, not from the examples.
- **Phase A7 depends on a SQLite driver decision** (patch, fork or
  switch).

### What should be done in the future

- Start with phase A0 (structural tests) so progress on the later phases
  is measurable.

### Code review instructions

- Read the guide's sections 4 and 5 against the referenced files at
  `8301cf0`; check the counts with the command in section 4.10.

## Step 2: Guide v2, and phase L (one lifecycle state)

The user agreed to fold the caching, serving and lifecycle refactors into
the plan and asked for implementation with commits and a detailed diary.
Guide v2 adds:
- findings 12 and 13, and root causes R7 (response facts decided per
  handler) and R8 (lifecycle state as loose fields);
- sections 6.8 (visibility, mutability, one resolver) and 6.9 (one
  lifecycle state);
- phase L and an extended phase A6;
- the change feed as an open question.

It is uploaded as "SLOP3-005 Authorization Redesign Intern Guide v2", a
new name so the annotations on v1 survive. Phase L then replaced
`Running.Broken`/`Fallback` with `Active`, `Failed` and `Usable()`. That
showed the actor manager never checked failures: it built actors for
never-activated versions. Work happens on branch `task/slop3-005-authz`,
stacked on #13. Commits: `2145b10` (guide v2), `272cb51` (phase L).

### Prompt Context

**User prompt (verbatim):** "Go ahead. then implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"

The proposal it answers: fold refactors 1 (caching facts) and 2 (one
resolver) into phase A6, add 3 (lifecycle) as its own phase, and keep 4
(the change feed) as an open question. Then update the guide and
re-upload it.

**Assistant interpretation:** Update the guide and re-upload it. Then
implement the SLOP3-005 phases in order of value and risk, each with
tests, commits and a diary entry.

**Inferred user intent:** Get the systemic fixes into the code, not just
the design.

### What I did

- **Guide v2:** edited with anchored replacements; uploaded
  (`OK: uploaded SLOP3-005 Authorization Redesign Intern Guide v2.pdf ->
  /ai/2026/11/01/SLOP3-005`); added tasks L and A6b.
- **Phase L** (`pkg/kernel/apps.go`):
  - `Running{Store, App, N, Manifest, Active, Failed *Failure}`, with
    `Usable()` = `N > 0 && Active` and `Broken()` = `Failed.Why`.
  - `Running()` sets `Active` when the newest version is already active
    or activates, and otherwise sets `Failed` and falls back to the last
    active version (`Active` again) when there is one.
- **Callers:**
  - `openView` refuses `!Usable()`.
  - `serveStatic` serves only a usable version.
  - The status verbs (`app.status`, `app.follow`, `mount.status`) report
    `Broken()`.
  - The actor manager's `Get` refuses a store with something pushed but
    nothing usable.
- **Test:** `TestNothingUsableAfterFirstActivationFails`.

### Why

- **Keep `N` and `Manifest` as fields.** About 40 call sites read them
  (actors, the static host, status). Their meaning, "the version
  served", did not change, so making them methods would have been churn
  without benefit.
- **Make `Broken` a method.** `Broken()` keeps the status output, but no
  caller can mistake it for "nothing usable" any more.

### What worked

- The full Go suite passes.
- Negative control: with the `Get` check disabled, the never-activated
  actor ran (`ReferenceError: sql is not defined at count (actor.js:1:46(1))`,
  an error from inside the actor). With it, `actor_error: the app is
  broken: ...`.

### What didn't work

- **A silent JSON break.** The status verbs put `r.Broken` into a
  `map[string]any`, which still compiled once `Broken` became a method:
  the map would hold a method value and the JSON encoding would fail at
  runtime. I found it by listing every field use before relying on the
  compiler.

### What I learned

- `kernel.Running` is called on every request to a mount, and it is also
  what activates a store, so its result is the natural place for "can
  serve".

### What was tricky to build

- The order inside `Running()`. `r.Manifest` must be set before
  `activate`, which reads it, and reset to the fallback version's
  manifest after a failure.

### What warrants a second pair of eyes

- **The static host no longer serves a store whose only version failed
  activation.** Before, it served that snapshot's files. That is
  consistent with views and actors, but it is a behavior change for sites
  with failing migrations.
- **The actor manager still keeps its own `broken` map** for actor build
  failures. Merging it into `Failure` is left for later.

### Code review instructions

- `pkg/kernel/apps.go` (`Running`), `pkg/actor/manager.go` (`Get`),
  `pkg/server/views.go` (`openView`), `pkg/server/site.go`.
- **Tests:** `GOWORK=off go test ./pkg/server -run 'TestActors|TestViewsOpenOnFallbackVersion|TestNothingUsableAfterFirstActivationFails' -count=1`.
