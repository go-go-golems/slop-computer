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

## Step 3: Phase A6b (store bytes by facts), a sign-out bug from #13, phase A6 (trusted origins deny by default)

Phase A6b gave store bytes two facts: visibility (may an anonymous
visitor read the store) and mutability (snapshot, moving ref or upload,
no-store). One writer, `writeStoreBytes` (`pkg/server/storebytes.go`),
now derives every header from those facts and the host. Converting the
six serving paths found two more holes of the finding-12 class:
- an actor could label a private store's upload `public, immutable`;
- an actor could label its own page public on a private store.

Reading the back office before adding a CSP showed that my ZITADEL logout
change in #13 broke its sign-out: it uses `fetch`, which cannot follow
the redirect to the provider. I fixed that on the #13 branch and merged
it here. Phase A6 then made trusted origins deny by default, and the back
office passed a Chromium walk-through under its new CSP. Commits:
- `0527971` (A6b);
- `5e85b02` (sign-out fix, on `task/slop-v3`, pushed to #13);
- `209ce57` (merge);
- `f61c5a2` (A6).

### Prompt Context

**User prompt (verbatim):** see step 2 ("Go ahead. then implement ...").

**Assistant interpretation:** Continue the phases. A6b and A6 come first
because they follow directly from the last two review findings.

**Inferred user intent:** Systemic fixes, landed one phase at a time.

### What I did

- **`storebytes.go`:**
  - the `visibility` type (`private`, `public`) and the `mutability` type
    (`moving`, `immutable`, `noStore`);
  - `storeBytes{st, f, vis, mut}` and `cacheControl()`;
  - `visibilityOf(ctx, store)` = `Access.Can(nil, store, view)`;
  - `trustedHost(host)`;
  - `resolveStoreFile(ctx, st, at, name)`;
  - `writeStoreBytes`: sandbox CSP and attachment on trusted hosts and
    for uploads anywhere, then ETag, cache class, conditional and range
    requests.
- **Callers converted:**
  - `serveStatic` (public, moving);
  - `serveStoreFile` (no more `isolate` flag);
  - sandbox app files (public, immutable; see below);
  - `serveAssetBlob` (private);
  - previews (no-store);
  - `serveBoundAsset`: the actor's caching is honored only if anyone may
    read the serving store.
  - `serveBlob` is removed.
- **Actor route responses:** an actor's public `Cache-Control` becomes
  `private, no-cache` when the store is not anonymously readable.
- **Sign-out fix (on #13):** `/auth/logout` answers `{ok, next}` when
  asked for JSON. The back office's `signOut` sends
  `Accept: application/json` and navigates to `next`. The bundle was
  rebuilt; its diff is one line.
- **A6:** `trustedDefaults` in `ServeHTTP` for main and live hosts.
  - frame-ancestors 'none', nosniff, a same-origin referrer policy, HSTS
    on HTTPS, and `X-Frame-Options: DENY` on main;
  - the back office CSP: `default-src 'self'; style-src 'self'
    'unsafe-inline'; img-src 'self' data: https:; object-src 'none';
    base-uri 'none'; frame-ancestors 'none'`.
- **Tests:**
  - `TestStoreBytesFacts`: an actor's upload and page on a private store;
    an uploaded page on the static host.
  - `TestTrustedHostHeaders`.
  - `TestOIDCSignIn`: the JSON logout answer.
- **Browser check:** `scripts/01-backoffice-csp-check.mjs` against a
  `--local` server on :18350 built from this branch.

### Why

- **Sandbox app files stay public.** The sandbox serves an app's files to
  anyone who has its origin, with no access check; the origin label works
  as a capability. A shared cache therefore exposes nothing more.
  `TestLiveHostViews` expects this.
- **The back office CSP has no `form-action`.** The billing forms post to
  `/billing/checkout`, which redirects to Stripe, and Chrome applies
  `form-action` to redirects after a submission.

### What worked

- **Negative control** (the new test run against `HEAD` in a scratch
  worktree): `an upload through a store nobody anonymous may read: 200
  "public, max-age=31536000, immutable"`.
- **Browser walk-through:** Activity, People, Stores, Apps, Explain, then
  sign-out to `/auth/login` with `signedIn:false`; no console errors or
  CSP reports. The screenshot is `various/a6-backoffice-csp.png`.
- The full Go suite passes after each phase.

### What didn't work

- **First conversion of the sandbox app files** used
  `visibilityOf(app)`, which failed `TestLiveHostViews` (`p2b_test.go:153:
  app file: 200 "body{}"`: the cache header was private). Reverted to
  public, with the reason in a comment.
- **A name clash in `serveBoundAsset`:** the variable `b` already held the
  binding (`no new variables on left side of :=`). Renamed it to `out`.
- **`pkill -f` matched its own shell**, which then exited with 144. The
  server was stopped all the same: `healthz` gave `000`.

### What I learned

- The sign-out regression from #13 could not show up in Go tests: they
  post without `fetch` semantics. Reading the client code was what found
  it.

### What was tricky to build

- **Ordering the trusted defaults.** They are set before dispatch so
  handlers can replace them. `writeStoreBytes` replaces the CSP with the
  sandbox policy, so that response carries no frame-ancestors, which is
  harmless for attachments and media.

### What warrants a second pair of eyes

- **The static host now isolates uploads** (`/_s/<store>/assets/...`):
  sandbox CSP, and a download unless media. Before, an uploaded HTML file
  ran as a page there.
- **`img-src` in the back office CSP allows `https:`**, for avatars.
  Narrow it if no remote images are used.
- **The sandbox host serves app files without an access check.** That is
  a design question (capability URLs), noted but not changed.

### What should be done in the future

- Phase A0's verb/RPC inventory, then A1 to A3.

### Code review instructions

- `pkg/server/storebytes.go`, `site.go`, `actors.go` (`serveBoundAsset`,
  the actor route headers), `server.go` (`trustedDefaults`), `admin.go`,
  `auth.go` (`logout`), `web/admin/src/api.js`.
- **Tests:** `GOWORK=off go test ./pkg/server -run 'TestStoreBytesFacts|TestTrustedHostHeaders|TestOIDCSignIn|TestLiveStoreFilesIsolated|TestGuestGrantFilesNotPublic|TestLiveHostViews' -count=1`.

## Step 4: Phase A3 (view decisions keyed by the system epoch), phase A1 (one person-to-principal path)

A view held its level, audience and policy from the moment it opened,
and they stayed correct only if every writer that could change them
remembered to call `reviewViews`. Phase A3 removes that dependence. Every
committed `system.db` transaction now moves an epoch. A view records the
epoch its decision was made at. `viewOf`, and the event stream before
each commit it sends, confirm the view and decide again when the epoch
has moved. The hooks stay, but only to tell idle pages early.

Phase A1 then found ten hand-written copies of "person → user-or-guest
principal". Only three of them refused a disabled account. There is now
one pure mapping (`access.PersonPrincipal`) and one loader that refuses
gone or disabled people (`server.personAs`). Commits: `50ff337` (A3),
`a9e00de` (A1).

### Prompt Context

**User prompt (verbatim):** see step 2 ("Go ahead. then implement ...").

**Assistant interpretation:** Continue with the phases in the order the
guide gives. A3 and A1 come next; A3 closes the root cause (R3,
decisions cached without a validity condition) behind three of the #13
findings.

**Inferred user intent:** Make access follow the state by construction,
not by convention.

### What I did

- **Surveyed** the `system.db` writers that change a decision:
  - grants, roles, policy, LLM access, links, comps, Stripe events;
  - stores and their apps, sign-in.
  All of them go through `DB.Tx`. Writes outside `Tx` (sessions, device
  codes, login flows, schedules, usage counters) do not change a view's
  decision.
- **Epoch:** `system.DB.epoch` (`atomic.Int64`). `Tx` adds 1 after a
  commit, before `OnLog`. `Epoch()` reads it.
- **View:** `rt.View.Epoch` (`atomic.Int64`). `openView` reads the epoch
  *before* deciding and stores it on the view before `Open` publishes the
  secret.
- **`confirm(ctx, v)`** (`pkg/server/live.go`):
  - same epoch: true, at the cost of one atomic load;
  - store gone: close the view as revoked;
  - transient error: refuse this call, ask again next time;
  - otherwise `recheck`, which closes the view if the answer changed, and
    record the epoch only when it did not.
- **Callers:**
  - `viewOf` (every RPC, upload, sample and stream open);
  - the stream loop for each commit (`case o.Rev > 0 && !s.confirm(ctx, v)`
    drops the commit; the access or revoked event queued by `recheck`
    follows).
- **A1:**
  - `access.PersonPrincipal(p, via)`;
  - `server.personAs(ctx, id, via)`;
  - converted `principalOf` (both branches), `sitePrincipal`, `newGuest`,
    `viewPrincipal`, `recheck`, preview, platform verbs, app modules,
    `explain`'s subject, `billing.status`, `llm.usage` and the actor
    manager's store visitor.

### Why

- **The epoch is coarse on purpose.** Any write moves it. One recheck
  per view after an unrelated write costs a few indexed reads, and
  correctness no longer depends on knowing which writes matter. A
  finer key, such as one per store or per person, could miss a writer.
  Group grants and policy cells cross stores and people, so they would
  be the likely misses.
- **The epoch is read before deciding.** A write that lands during the
  decision leaves the view with the older epoch, so the next use decides
  again. Reading it after the decision would bless a stale answer.
- **The view keeps its fields.** The guide proposed removing
  Level/Role/Policy from `rt.View` and computing them per call. Making
  them a cache with an explicit validity condition gives the same
  guarantee: no call acts on a decision older than the last write. It
  touches two lines in the hot path instead of about 25 read sites.

### What worked

- **`TestDowngradeClosesView`, new part:**
  - grant `@subscriber` interact, open, write (200);
  - `h.sys.SetGrant(... "view")` directly, with no review;
  - the next write gives 401;
  - after an unrelated `SetPolicy` on another app, a fresh view keeps
    writing (200).
- **`TestStreamFollowsSystemState`:** a subscribed stream gets
  `notes/a`. After a direct grant change, `notes/b` is not sent; an
  `access` event with level `view` is.
- **`TestDisabledAccountActsNowhere`:**
  - the view stops at the next call (401) with no review;
  - the site reopens as anonymous;
  - `personAs` gives nil.
- **Negative controls:**
  - with `if true || v.Epoch.Load() == e` in `confirm`:
    `p5_test.go:244: write after the grant changed underneath: 200`;
  - with the stream case disabled, the stream test fails (doc sent).
- **Checks:**
  - full suite: `GOWORK=off go test ./... -count=1` passes;
  - race run: `go test -race ./pkg/server -run 'Downgrade|StreamFollows|PolicyChange|ShareLinks|LiveHost'`
    passes.

### What didn't work

- **The first stream test** waited for a `doc` that never came: `no doc
  event within 2s`. A stream only carries paths the view subscribed to
  (`View.Wants`), so the test now calls `db.subscribe` first.
- **`SetPolicy` in the test** first had the wrong shape:
  - it returns only an error;
  - the audience is `member`, not `@member`.

### What I learned

- `recheck` already refused disabled accounts: `AudienceOf` maps them to
  `AudNone`, which holds no level. The real gap was elsewhere. App
  modules and platform verbs acting for a payer built the principal
  without the check, so a disabled payer's app could still call platform
  verbs that touch no store.

### What was tricky to build

- **Closing the stream mid-flight.** `Registry.Close(v, false)` does not
  close the channel. The access event `recheck` queued is already in it,
  and the registry sends the view nothing more. So the loop drops the
  commit that triggered the check and lets the next receive deliver the
  access event.

### What warrants a second pair of eyes

- **A transient `system.db` error** in `confirm` refuses the call but
  keeps the view. In `recheck`, a failed person lookup still reads as
  anonymous, which can close a view with an access event. That was true
  before.
- **Behavior change:** a disabled account's site session now becomes an
  anonymous visitor in `recheck`. Before, it was a principal with
  audience none, which closed the view as revoked. Either way the person
  keeps no level of their own.

### What should be done in the future

- **A0:** the inventory test.
- **A2:** `Decide` beside the checks, with a differential test.
- **A4:** dispatch declares actions.

### Code review instructions

- `pkg/system/system.go` (`Epoch`, `Tx`), `pkg/rt/views.go`
  (`View.Epoch`), `pkg/server/live.go` (`confirm`, `recheck`,
  `reviewViews` comment), `pkg/server/views.go` (`openView`, `viewOf`,
  the stream loop), `pkg/server/auth.go` (`personAs`),
  `pkg/access/principal.go` (`PersonPrincipal`).
- **Tests:** `GOWORK=off go test ./pkg/server -run 'TestDowngradeClosesView|TestStreamFollowsSystemState|TestDisabledAccountActsNowhere' -count=1`.

### Technical details

```go
func (s *Server) confirm(ctx context.Context, v *rt.View) bool {
	e := s.Sys.Epoch()
	if v.Epoch.Load() == e {
		return true
	}
	row, err := s.Sys.StoreByID(ctx, v.Target)
	if errors.Is(err, system.ErrNotFound) {
		s.rt.views.Close(v, true)
		return false
	}
	if err != nil {
		return false
	}
	if s.recheck(ctx, v, row) {
		return false
	}
	v.Epoch.Store(e)
	return true
}
```

## Step 5: Phases A0 and A4 (every operation declares an action), phase A7 (no app SQL runs as the kernel)

Every verb (84) and every runtime method (21) now declares an action
from one table in `pkg/authz`. Each action has a floor: whether it is on
a store, the least level there, and whether it needs the admin role. The
dispatchers check the floor before the operation runs: `verbs.Call` for
verbs, `viewRPC` for methods. A verb whose `Run` forgot its check is
still refused. The A7 spike confirmed that mattn drops the authorizer's
trigger-name argument. It also found a live hole: a foreign-key cascade
from a kernel table into an app table ran the app's trigger with kernel
authority. Two invariants close it without that argument. Commits:
- `eae9621` and `749c0b0` (A0 and A4);
- `7a3c37d` (A7).

### Prompt Context

**User prompt (verbatim):** see step 2 ("Go ahead. then implement ...").

**Assistant interpretation:** Continue with the phases. A0/A4 give the
structural "every operation declares its access" property. A7 is the
spike the guide planned for SQL author authority.

**Inferred user intent:** Make a missing or wrong check visible and
impossible to forget.

### What I did

- **`pkg/authz/actions.go`:**
  - `Action`;
  - store actions: `store.read`, `doc.read`, `doc.write`, `actor.call`,
    `room`, `user.read`, `sample`, `asset.write`, `store.admin`,
    `code.push` (admin role, D9), `store.owner`;
  - other actions: `store.create`, `account`, `platform`,
    `platform.admin`, `program`;
  - `Spec{Store, Level, Admin}` and `Of`.
- **Verbs:**
  - `Verb.Action` and `Verb.StoreArg` (`""` means `store`; `"-"` means
    `Run` finds the store, as for `link.rm`);
  - `Check` refuses an undeclared action and enforces `Spec.Admin`;
  - `Call` opens the declared store at the floor before `Run`;
  - each verb's action was assigned from what its `Run` checks today:
    I extracted every `e.open(..., rt.LevelX)` call per verb literal and
    mapped the 84 verbs by script.
- **Runtime methods:**
  - `rpcTable` maps to `rpcMethod{act, fn}`;
  - `viewMay(v, act)` compares the view's (epoch-confirmed) level and
    role with the floor;
  - `viewRPC` refuses with `not_granted` before the method runs.
- **A7 spike:**
  - read mattn v1.14.52 `callback.go`: `authorizerTrampoline(handle, op,
    arg1, arg2, arg3)`. The C prototype has four strings; the Go side
    reads three, so the trigger/view name is dropped;
  - wrote a throwaway test: kernel table `_k`, app table `c REFERENCES
    _k(id) ON DELETE CASCADE`, and a trigger on `c` inserting into
    `_k2`;
  - deleting from `_k` logged `9 c` (DELETE on the child) and `18 _k2`
    (the trigger's INSERT). The trigger wrote one row.
- **A7 fix:**
  - `authorize`: a kernel caller's INSERT, UPDATE or DELETE on an app
    name is denied;
  - `Turn.checkAppForeignKeys` runs at the end of any turn that changed
    the schema. It reads `pragma_foreign_key_list` for every table and
    refuses an app table that references a non-app table.

### Why

- **Floors, not full decisions.** Many verbs need more than one level
  check: db rules per path, D9 when the tree holds app code, `store.rm`
  needing owner unless the caller is an admin. Declaring the least level
  any caller needs keeps the table honest. Run keeps its finer checks.
  The floor turns a forgotten check into a refusal instead of an open
  door.
- **Invariants instead of the sixth argument.** Patching or forking the
  driver to pass it is a maintenance burden. Reading the raw `sqlite3*`
  through `unsafe` and installing our own trampoline is fragile. SQLite
  authorizes a trigger body, and a cascade, at prepare time under the
  outer statement's caller. So the guarantee "no app SQL runs as the
  kernel" follows from two facts. The kernel's statements never touch an
  app table, directly or by cascade. App triggers can only sit on app
  tables, which was already enforced at `CREATE TRIGGER`.

### What worked

- **`TestEveryVerbDeclaresAnAction`:** verbs by action are
  `account:12 actor.call:1 doc.read:3 doc.write:4 platform:3
  platform.admin:21 program:2 store.admin:23 store.create:1
  store.owner:3 store.read:11`.
- **`TestEveryRPCDeclaresAnAction`** passes. A viewer and a non-admin
  owner do not clear `code.push`.
- **`TestCallChecksTheFloor`:** a registered verb with `Run` returning
  `"ran"` is refused to a stranger (`not_found`) and to a member with
  interact (`permission_denied`), and runs for an admin. With the `Call`
  check disabled: `want not_found, got 200 map[result:ran]`.
- **`TestNoAppSQLRunsAsTheKernel`** passes. With the foreign-key check
  removed it fails at `store_test.go:251` (the reference to `_docs` was
  accepted). With the kernel rule removed it fails at `store_test.go:272`.
- The full suite passed with the kernel rule before the foreign-key check
  existed. No kernel path writes app tables: restores insert rows as
  `CallerMigration`, `import.table` as `CallerAdminWrite`.

### What didn't work

- **`grant.set` with an email subject:** `invalid_argument: a subject is
  usr_…, vis_…, store:<id>, @guest, @member or @subscriber`. The test
  uses `@member`.
- **A stray field:** a `Write` field I had dropped from `Spec` was left
  on `StoreCreate` and broke the build until I removed it.
- **Formatting:** `gofmt` flagged `authz_test.go` after the commit. A
  follow-up commit formats it.

### What I learned

- Foreign-key cascades are authorized: SQLite codes them like trigger
  programs, and the authorizer sees the child DELETE. Before this phase,
  the kernel caller returned `SQLITE_OK` for everything, so the cascade
  hole was real.

### What was tricky to build

- **Mapping 84 verbs without changing behavior.** An over-declared floor
  silently refuses calls that used to work. The full suite is the check
  that no floor exceeds what the tests exercise. Declarations were taken
  from the lowest `e.open` level in each `Run`.

### What warrants a second pair of eyes

- **`store.rm` is `store.admin` on `id`.** An owner who is not an admin
  has owner level, which clears it, and `Run` still requires owner for
  them.
- **`app.modules` declares `store.read` on the `app` argument.** When the
  argument is empty, `Run` decides.
- **Unchanged:** the 10 admin-only verbs with Read or Write scope (an
  open question in the guide).
- **`checkAppForeignKeys` reads every table's foreign keys** on each
  schema change. Stores have few tables, so this is cheap.

### What should be done in the future

- **A2:** `Decide` composing the floor with the finer rules (db rules,
  policy cells, D9). `explain.can` could print it.
- **A5:** permits at the store boundary.
- **S1 and S2.**

### Code review instructions

- `pkg/authz/actions.go`, `pkg/verbs/verb.go` (`Call`, `Check`,
  `store`), the `Action:` fields in `pkg/verbs/*.go`,
  `pkg/server/views.go` (`rpcTable`, `viewMay`, `viewRPC`),
  `pkg/store/sqlpolicy.go` (`authorize` kernel branch,
  `checkAppForeignKeys`), `pkg/store/turn.go`.
- **Tests:**
  - `GOWORK=off go test ./pkg/verbs ./pkg/store -count=1`;
  - `GOWORK=off go test ./pkg/server -run 'TestEveryRPCDeclaresAnAction|TestCallChecksTheFloor' -count=1`.

### Technical details

The spike's authorizer log, for `DELETE FROM _k WHERE id = 'a'`:

```text
9 _k  main        DELETE _k
20 _k id main     READ _k.id
20 c k main       READ c.k        (the cascade's scan)
9 c  main         DELETE c        (the cascade)
...
18 _k2  main      INSERT _k2      (the trigger body on c)
rows written by the trigger: 1
```
