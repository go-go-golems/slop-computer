---
Title: Diary
Ticket: SLOP3-001
Status: active
Topics:
    - architecture
    - hosting
    - access
    - sqlite
    - goja
    - agents
    - llm
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of designing slop v3 core: research, decisions, writing and delivery of the intern guide."
LastUpdated: 2026-11-01T12:30:00-05:00
WhatFor: "Following how the SLOP3-001 design was produced and what evidence it rests on."
WhenToUse: "Before changing the design doc, or when resuming SLOP3-001."
---

# Diary

## Goal

Record how the slop v3 core design was produced: the request, the evidence
read, the decisions taken and the delivery.

## Step 1: Ticket setup and evidence gathering

I set up docmgr in the new repository and gathered the evidence the guide
rests on: the imported slop-v3 design and lab, slop-computer v2 (what can be
reused), francois (how "subscribed" works there), go-go-goja (the runtime APIs
the actor host will use) and go-go-host (the hosting precedent).

The main finding that shapes the design is francois's entitlement model: a
pure function derives access from Stripe subscription projections and
admin-granted complimentary windows. That maps directly onto the "subscriber"
audience the user wants, without plans, quotas or daily allowances.

### Prompt Context

**User prompt (verbatim):** "ok, create a new docmgr ticket in the new repo, and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable.

The goal is to have a service I can start, then log in and get a token for myh coding agent, and generate new apps and mount them on the site, all kinds of apps, and I have a CLI also to do all that and import data and all the things the agent can do through eval().

Also, I want to manage: admins, guests, signed in, subscribed like on francois, so that we can control access rights. In terms of LLM budget, be absolutely trivial: either access to LLM, or not, with max token budget. No instances / call count / durations etc limits. We go for streamlined and effective and so we have a manageable UI in the back, where we can control and also provide the apps the information of who is visiting, and also control which app has access to what, also based on visitor.

Anyway, go forth and design."

**Assistant interpretation:** Create a docmgr ticket in `~/code/wesen/2026-10-31--slop-v3`, write an intern-facing design and implementation guide for a streamlined v3 (a service, sign-in, agent tokens, apps and mounts, a CLI with eval, data import, audiences including subscribers, trivial LLM budgets, a back-office UI with a per-app, per-audience capability matrix), store it in the ticket, and upload it to reMarkable.

**Inferred user intent:** Get a buildable, cut-down v3 plan that an intern can implement, replacing the over-broad slop-v3 design with the core the user actually needs.

### What I did

- `docmgr init --seed-vocabulary` in the new repo; added topics `architecture`, `hosting`, `access`, `sqlite`, `goja`, `agents`, `llm`.
- `docmgr ticket create-ticket --ticket SLOP3-001 ...`, then `doc add` for the design doc and this diary.
- Read the skill references: `writing-style.md`, `phase-checklists.md`, `deliverable-checklist.md`.
- francois (`~/code/wesen/go-go-golems/francois`, `106776a`):
  - `pkg/catalog/entitlement.go`: `resolveEntitlement` maps disabled, staff, guest, subscription, trial, complimentary and free to a plan.
  - `pkg/catalog/billing/policy.go`: `Policy.Access(account, subs, comps, now) Decision`, pure and table-tested; reason codes `subscriber`, `complimentary`, `payment_past_due`, `subscription_expired` and others.
  - `pkg/catalog/store/migrations/002_billing_usage.sql`: `billing_customers`, `billing_subscriptions` (Stripe projections), `checkout_attempts`.
- go-go-goja (`c265ae0`):
  - `pkg/engine/factory.go`: `NewRuntimeFactoryBuilder`, `WithModules`, `WithRuntimeInitializers`, `Build`, `RuntimeFactory.NewRuntime`;
  - `pkg/engine/runtime.go`: `Runtime{VM, Loop, Owner}`;
  - `pkg/runtimeowner`: `RuntimeOwner.Call(ctx, op, fn)` and `Post`.
- slop-computer (`18f97d4`):
  - `pkg/rt` has no internal dependencies (body, paths, rules, query, diff, views);
  - `web/runtime/src/*.ts` is about 1,970 lines;
  - `pkg/server/rt_sample.go` says slop "keeps no per-person budget" today;
  - `pkg/blobs` was adapted from francois;
  - `pkg/server/{auth,device,tokens}.go` handle OIDC, device login and tokens.
- go-go-host (`4fa1bf0`): read the README, the example bundle `examples/hello-beta`, and HOST-013 (lambda control plane) §1–4.
- slop-v3 lab: `lab/src/kernel/kernel.js` (`resolve`, `pageHtml`), `lab/src/seeds/journal/*` (actor, manifest, migration).

### Why

- The guide must point at real files to copy or port, so the reuse claims needed checking: `pkg/rt` really has no internal dependencies; identity code depends on `pkg/store`.
- "Subscribed like on francois" needed the actual francois mechanism, not a guess.

### What worked

- francois's billing policy is self-contained and pure; it can be copied as is.
- go-go-goja's `RuntimeOwner.Call` is the single-goroutine ownership the actor turn loop needs.

### What didn't work

- `grep -rl ... --include=*.go .` failed in zsh with `no matches found: --include=*.go`; I reran it without the glob, using explicit package paths.
- `docmgr status` before init: `Error: root directory does not exist: .../ttmp`, which is expected; I ran `docmgr init`.

### What I learned

- francois's guest is a "demo visitor" with a token allowance, not a stored role of a person.
- v2 has no per-person model budget at all; the budget ledger is new work.

### What was tricky to build

- N/A (research only).

### What warrants a second pair of eyes

- Whether per-app (not per-version) capability approval is acceptable. The guide argues it is, because only admins and their tokens push code.

### What should be done in the future

- Write the guide (Step 2).

### Code review instructions

- N/A: no code.

### Technical details

- Repos and commits read: francois `106776a`, go-go-goja `c265ae0`, slop-computer `18f97d4`, go-go-host `4fa1bf0`, slop-v3 import `cb8f428`.

## Step 2: Writing the guide

I wrote the guide as one design doc of about 2,500 lines, in five appended
parts:
1. orientation and an end-to-end example;
2. the store, apps and actors;
3. access, policy, LLM and visitor information;
4. serving, the doors, sign-in, the back office and import;
5. reuse, decisions, phases, tests and appendices.

The design cuts the slop-v3 design down to what the user's requirements
(R1–R10) need, and adds the three things it lacked: audiences including
subscribers, a per-app policy matrix by audience, and LLM access as on/off
plus a token budget.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Turn the evidence and the earlier chat analysis (concern 4, static files, the new-repo plan) into a buildable intern guide.

**Inferred user intent:** An intern can start P0 tomorrow without re-deriving the design.

### What I did

- Structured the guide per the writing-style reference:
  - summary, requirements (R1–R10) and scope;
  - orientation with a vocabulary and an architecture diagram;
  - the guestbook walk-through;
  - subsystem sections 4–15, the reuse map (16), decision records (17),
    phases P0–P8 with exit tests (18), testing (19), risks and open
    questions (20);
  - Appendices A–G (DDL, `app.json`, actor and page APIs, endpoints, CLI).
- Folded in the chat answers:
  - one owner app per store with read aliases, and `store:<id>` principals
    instead of `app:<id>` (the confused-deputy fix);
  - openers and the site app as deferred designs;
  - `/_s/<store>/…` for a store's own files;
  - the trailing-slash redirect;
  - one kind per host, citing the SLOP-011 incident.
- New design for the user's additions:
  - audiences, computed by `audienceOf`;
  - grant subjects `@anyone`, `@guest`, `@member` and `@subscriber`;
  - subscriptions using francois's `billing.Policy.Access` (comps in the
    core, Stripe in P5b);
  - `app_policy(app, capability, audience)`;
  - `llm_access` and `llm_usage`, with "who pays" rules;
  - the visitor object in pages, actors and HTTP routes.
- Diagrams are ASCII in `text` blocks so they render in the reMarkable PDF
  (pandoc does not render Mermaid). Code lines are kept to 92 columns or
  fewer.
- Fixed the guestbook example after writing section 8.3. `use('sample')` in
  actors runs before any visitor exists, so per-visitor checks need
  `sample.allowed()`.
- Ticket bookkeeping: related 6 files to the design doc and the doc to the
  index, added tasks z0n1 to faws (writing, upload, P0–P8), checked z0n1,
  updated the changelog. `docmgr doctor` passes.

### Why

- Go-first rather than workbench-first (D3), because R1 asks for a service.
- Per-app policy instead of per-version approval, because only admins push
  code (D9).
- Manual LLM budget resets, because R6 asks for the most trivial rule; the
  monthly-reset question is left open.

### What worked

- francois's billing policy slots in as the subscriber test without its plans
  and allowances.
- SLOP-011's live-site work maps one-to-one onto the live-host section, so
  most of it is a port, not new design.

### What didn't work

- The first `doc relate` for the index stored a broken path ending in `.mdrimary deliverable`. `docmgr doctor` reported `missing_related_file`. The cause was zsh: in `"$D:Primary deliverable…"`, `:P` is a zsh history modifier (realpath) applied to `$D`, which swallowed the `P`. I removed the entry with `--remove-files` and re-added it as `"${D}:Primary deliverable, …"`. The doctor then passed.
- A first retry without braces failed with `Error: malformed --file-note value "...mdrimary deliverable, the intern design and implementation guide": expected 'path:note'`, for the same reason.

### What I learned

- In zsh, write `${VAR}:note`, never `$VAR:note`, when a colon follows a variable.
- In actors, capability presence and per-visitor permission have to be split
  (`use()` versus `.allowed()`). Pages get per-visitor `null` for free,
  because each view resolves its own capabilities.

### What was tricky to build

- Keeping the access model to one function while adding audiences.
  - The solution: audiences are computed, and appear in exactly three
    places (grant subjects, policy columns, LLM defaults).
  - Grant subjects use "at least" semantics: `@member` includes subscribers
    and admins.
  - LLM defaults are exact per audience, so members and subscribers can
    differ.
- Who pays for LLM calls made by alarms and reactors: the store's owner.
  Anonymous visitors never call the LLM.

### What warrants a second pair of eyes

- Section 7.5: audience caps (guest at most `interact`, anonymous at most
  `view`), and whether pending users should count as guests.
- Section 9.3: allowing a call that starts with budget left to finish over
  budget.
- Section 11.3: static hosts require `@anyone view` on the store, which
  replaces v2's implicit publicity through routes.

### What should be done in the future

- Upload to reMarkable (Step 3).
- Get answers to the five open questions in section 20.

### Code review instructions

- Read sections 1–3 first; check that the guestbook walk-through matches
  sections 7–11.
- Check the DDL in Appendices A and B against sections 4, 7, 9 and 11.

### Technical details

```text
docmgr doc relate --doc <design-doc> --file-note ... (6 files)
docmgr task add ... (11 tasks); docmgr task check --id z0n1
docmgr changelog update --ticket SLOP3-001 --entry "Wrote the intern design ..."
docmgr doctor --ticket SLOP3-001 --stale-after 30   -> All checks passed
```

## Step 3: Uploaded to reMarkable (milestone)

The guide is on the reMarkable cloud as one PDF with a table of contents. The
first attempt failed while building the PDF; the fix was a one-character
quoting change in the guide.

**User prompt (verbatim):** see Step 1.

- **First attempt:** `remarquee upload bundle <design-doc> --name "SLOP3-001 slop v3 core design guide" --remote-dir "/ai/2026/11/01/SLOP3-001" --toc-depth 2 --non-interactive` failed:

  ```text
  Error: pandoc failed: Error producing PDF.
  ! Undefined control sequence.
  l.2537   HMAC-SHA256(server key, store + "\x
  ```

  The text `"\x00"` sat in prose (section 11.6), so LaTeX read `\x` as a command.
- **Fix:** wrapped `store + "\x00" + app` in backticks. A scan for
  backslashes outside code blocks found no others.
- **Second attempt** (the same command): `OK: uploaded SLOP3-001 slop v3 core design guide.pdf -> /ai/2026/11/01/SLOP3-001`. That proves cloud delivery, not device sync.
- Checked task 0hh4 and updated the changelog.
- **Next:** the user answers the open questions in section 20; then P0.

## Step 4: The product owner's answers: guests, lab, Stripe, sign-up, binary name

The user answered the open questions. Four changes followed:
- the anonymous audience is folded into guest;
- the lab is reference only, and its design system is the back office's look;
- francois's Stripe integration is copied into the core;
- open sign-up and the `slop` / `slop2` naming are accepted.

I applied all of them to the guide in two scripted edit passes (34 exact
replacements, each asserted to match once) and verified that no stale
reference remains.

The guide now has four audiences (guest, member, subscriber, admin). A guest
may or may not have an id, and only guests with an id can write or be
charged for LLM calls. Subscriptions come from comps and from a Stripe
projection copied from francois's `pkg/catalog/payments`.

### Prompt Context

**User prompt (verbatim):** "anonymous = guest. 

inbrowser lab is indeed just reference, and design system
copy stripe as well
4. yes (zitadel anyway)
5. just slop again, and indeed slop2 if needed (?) for cut-over."

A follow-up arrived while I was working: "commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill, mandatory)"

**Assistant interpretation:**
- Merge the anonymous audience into guest.
- Treat the lab as reference, with its design system as the back office's look.
- Make Stripe part of the core by copying francois's integration.
- Accept open sign-up, since Zitadel controls account creation.
- Name the binary `slop`, with v2's CLI as `slop2` during the cut-over.
- Keep the diary in investigation format, and commit at intervals.

**Inferred user intent:** settle the design so P0 can start. Questions 1
(monthly budget reset) and 2 (guests and LLM) were not answered and stay
open.

### What I did

- **Researched francois's Stripe integration** (`106776a`):
  - `grep -rl -i stripe pkg cmd` led to `pkg/catalog/payments/{gateway,service,year_payment}.go`, `pkg/catalog/store/billing.go` and `pkg/catalog/routes.go`;
  - `go.mod` has `github.com/stripe/stripe-go/v86 v86.1.1`;
  - read the `Gateway` interface (`CreateCustomer`, `CreateCheckout`, `RetrieveCheckout`, `ExpireCheckout`, `CreatePortal`, `SubscriptionCustomer`) and the `Service` methods (`Checkout`, `Portal`, `Refresh`, `Ingest`, `Run`, `reconcile`, plus `Support`, `SupportEnterprise`, `FundYear`);
  - read the routes: `POST /api/billing/checkout`, `/api/billing/portal`, `/webhooks/stripe`;
  - read the tables: `billing_customers`, `billing_subscriptions`, `checkout_attempts`, `stripe_events` (002) and the price rename (007).
- **Researched the lab's design system:**
  - `lab/dist/styles.css` (73,344 bytes) starts with the `form-skate-workbench/tokens.css` header;
  - `lab/build.mjs` concatenates the workbench tokens and components, the agent components, and `src/ui/lab.css`;
  - listed the exported components in `lab/src/ui/{ui,dock,views1,views2,views3}.jsx`.
- **Edit pass 1** (`edit1.py`, 23 replacements):
  - audiences in §1, §3.2, §3.4 (dropped `@anyone view`), §5.5, §7.1, §7.3 (the ladder and `audienceOf(nil) = guest`), §7.5 (subjects, caps, `matches`), §8.2 (matrix columns), §9.2 (who pays), §11.3 (`resolve`) and D5;
  - Stripe in §7.4 (the copied integration, a flow diagram, the config block, the new `subscribed()`, what is not copied), §10 (the subscribe page), P5 (merged into one phase with a fake-gateway exit test) and Appendix A (`subscriptions` replaced by `comps` plus the four Stripe tables, ported from francois's DDL);
  - D10 accepted, with Zitadel;
  - §20: a "decided" list, with two questions still open.
- **Edit pass 2** (`edit2.py`, 11 replacements):
  - the guest definition in §3.2 and Zitadel in §13.1;
  - a "Look" subsection in §14: where the design system lives, its rules, which lab components to reuse, and which screenshots to compare against;
  - the reuse map in §16: the francois payments path, and the lab UI and design system;
  - D3 accepted, as reference for behaviour and look;
  - P7 styled from `lab/dist/styles.css`;
  - P8: `slop` / `slop2`, and the shared credentials format;
  - the `billing` verbs, the `/subscribe` and `/webhooks/stripe` endpoints, and the references.
- **Checks:** grepped for `anonymous|@anyone|five audiences|P5b|P5a|subscriptions WHERE`; only the intended mentions in the decision records remain. No code line is over 92 columns, there are 92 fences (an even number), and the only backslash outside fences is inside inline code.

### Why

- I kept francois's table shapes for Stripe (renamed `billing_*` to `stripe_*` and `user_id` to `person`), so `store/billing.go` ports almost line for line. Comps got their own table, because francois's `Comp` is a separate input to `Policy.Access` anyway.
- I left out francois's one-off support payments and its model allowance periods. They aren't subscriptions, and the user asked for trivial LLM budgets.
- An id-less guest can only read. Every write records a person, and that matches how live hosts already create guest ids on demand.

### What worked

- The exact-match edit scripts made 34 changes in one pass each, with no stray edits. A miss would have stopped the script before writing.
- francois's billing policy already takes subscriptions and comps as separate lists, so the new `subscribed()` is a direct call.

### What didn't work

- `mkdir -p $S/slop3 && cat > $S/slop3/edit1.py` failed with `mkdir: cannot create directory '.../scratchpad/slop3': File exists`. `slop3` was a 54 MB binary left in the scratchpad from 28 October. Because the `&&` chain stopped, the script was never written, and `python3` then failed with `[Errno 20] Not a directory`. I re-sent the script into `scratchpad/slop3-edits/`.

### What I learned

- The lab's design system survives in the repo only as the built `lab/dist/styles.css`. The source folders were session uploads, so the back office must start from the built file.
- francois treats a Stripe webhook as a request to refresh, and always re-reads the customer from Stripe. Keep that property when porting: never project webhook payloads directly.

### What was tricky to build

- Merging the anonymous audience into guest without losing the difference that matters: whether we can name the visitor.
  - The solution keeps a single audience, `guest`, and makes "has an id" a property of the principal, not an audience.
  - Writes need an id, and so does LLM charging.
  - Static hosts never create ids; live hosts create one when the store gives guests a level.

### What warrants a second pair of eyes

- Section 7.5: with `@guest` now matching everyone, `@guest interact` on a live host gives every visitor a guest id on first open. That's SLOP-011's existing behaviour, but it should be a conscious choice per store.
- Appendix A: the Stripe tables use INTEGER milliseconds instead of `timestamptz`. The port of `store/billing.go` must convert consistently.
- Section 7.4: whether `trials: false` matches how the user wants Stripe trials handled.

### What should be done in the future

- Upload the revised guide (Step 5).
- Answer the two remaining questions: monthly budget reset, and guests' LLM access.

### Code review instructions

- In the design doc, review §7.3–7.5 (audiences, subjects, caps), §7.4 (Stripe), §14 ("Look"), P5 and P8 in §18, §20, and Appendix A (`comps` and the `stripe_*` tables).
- `git diff 340eec8 -- ttmp/2026/11/01/SLOP3-001--*/design-doc/` shows every change since the first version.

### Technical details

```text
python3 -I scratchpad/slop3-edits/edit1.py <design-doc>   -> applied 23
python3 -I scratchpad/slop3-edits/edit2.py <design-doc>   -> applied 11
git diff --stat: 1 file changed, 231 insertions(+), 81 deletions(-); doc now 2,711 lines
```

## Step 5: Uploaded the revised guide (milestone)

The revised guide is on the reMarkable cloud as a second document, next to the
first, so any notes made on the first copy are kept.

**User prompt (verbatim):** see Step 4.

- **Command:** `remarquee upload bundle <design-doc> --name "SLOP3-001 slop v3 core design guide v2" --remote-dir "/ai/2026/11/01/SLOP3-001" --toc-depth 2 --non-interactive`
- **Result:** `OK: uploaded SLOP3-001 slop v3 core design guide v2.pdf -> /ai/2026/11/01/SLOP3-001`. That proves cloud delivery, not device sync.
- **No `--force`:** the first upload, `SLOP3-001 slop v3 core design guide.pdf`, stays as it is.
- **Guide revision:** `ba21061`.
- **Next:** answers to the two open questions in §20; then P0.

## Step 6: Last decisions, and how the implementation starts

The user settled the two open questions and asked for the implementation:
- LLM budgets are monthly;
- guests may be given LLM access.

Before writing code I recorded both in the guide (6 replacements). I also
made two implementation choices that differ slightly from the guide's
wording: the SQLite driver, and how the actor runtime is owned.

### Prompt Context

**User prompt (verbatim):** "1. monthly
2. yes

Now implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"

**Assistant interpretation:** Make budgets monthly, allow `@guest` LLM access, then build slop v3 core phase by phase (P0 onwards), committing at phase boundaries and writing a full investigation-format diary entry per step.

**Inferred user intent:** Get a running service as soon as possible, following the guide.

### What I did

- **`edit3.py` (6 replacements) in the guide:**
  - `llm_usage` gains `period` ('YYYY-MM', UTC), with primary key
    `(person, period)`;
  - `llmFor` reads the current month;
  - the charge is an upsert;
  - §9.1 says budgets are monthly and that guests may be given access;
  - D6 now says "per calendar month";
  - §20 has no open questions left.
- **Checked the toolchain:** `go version` gives `go1.26.6`; gcc is present
  and `CGO_ENABLED=1`.
- **Checked SQLite drivers:**
  - v2 uses `modernc.org/sqlite v1.54.0`. `grep` over its sources shows
    `RegisterPreUpdateHook`, `RegisterCommitHook`, `Serialize` and
    `NewBackup`, but no authorizer API.
  - `go list -m -versions` reaches `github.com/mattn/go-sqlite3`
    (latest `v1.14.52`) and `github.com/ncruces/go-sqlite3` (`v0.36.0`).

### Why

- **mattn/go-sqlite3**, as the guide specifies. It has
  `RegisterAuthorizer`, `RegisterUpdateHook`, `RegisterFunc`, limits and
  backup. The authorizer is how actor SQL is confined, and how the kernel
  learns which app tables a turn wrote. modernc cannot do either. The cost is
  cgo in builds, which this machine supports.
- **goja directly, without go-go-goja's engine and `runtimeowner`.** In the
  design each store already has one turn-loop goroutine, and that goroutine
  is the only code that touches the store's VM. A second ownership layer adds
  nothing. go-go-goja's module registry would also bring Node-style modules
  that actors must not have. I'll correct the guide's §6.3 once the actor
  code exists.
- **Monthly periods instead of a reset job:** keying usage by month makes the
  reset automatic, and keeps history for free.

### What worked

- All six replacements applied, and no code line is longer than 92 columns.

### What didn't work

- N/A.

### What I learned

- modernc's pure-Go driver trades away the authorizer. Any design that
  depends on `sqlite3_set_authorizer` needs mattn or ncruces.

### What was tricky to build

- N/A (decisions only).

### What warrants a second pair of eyes

- Dropping go-go-goja's `runtimeowner`: correct as long as no goroutine
  other than the store's loop ever calls into its VM. Continuations must go
  through the inbox.

### What should be done in the future

- P0: the Go module skeleton, config, `system.db`, local sign-in, sessions,
  tokens, device login, `whoami`.

### Code review instructions

- In the guide: §9.1, D6 and §20.

### Technical details

```text
python3 -I scratchpad/slop3-edits/edit3.py <design-doc>   -> applied 6
go list -m -versions github.com/mattn/go-sqlite3          -> ... v1.14.51 v1.14.52
```

## Step 7: P0, skeleton, sign-in, tokens and the verb door

P0 is done. One binary, `slop`, runs the server (`slop serve`) and is also
its CLI. A person signs in on the main host (with the local form for now;
OIDC/Zitadel comes in P4) and approves a device login. The CLI stores the
token and every verb in the table becomes a command.

The exit test from the guide passes twice:
- in a Go test, through HTTP;
- by hand with the real binary: `slop serve --local`, curl standing in for
  the browser, `slop auth login`, then `slop whoami`, which prints an admin.

### Prompt Context

**User prompt (verbatim):** see Step 6.

**Assistant interpretation:** Build P0 from the guide: the skeleton, config,
`system.db`, local sign-in, sessions, CSRF, device login, tokens and
`whoami`.

**Inferred user intent:** A service that can be started, with an agent token,
as the base for everything else.

### What I did

- **The module:** `go.mod` (`github.com/go-go-golems/slop`, go 1.26.6) with
  `mattn/go-sqlite3 v1.14.52`, `dop251/goja`, `spf13/cobra v1.10.2` and
  `gopkg.in/yaml.v3`. `.gitignore` excludes the binary, data and `*.db`.
- **`pkg/system`:**
  - `migrations/001_init.sql` holds the whole schema from Appendix A,
    including `comps`, the four Stripe tables, `llm_usage` keyed by
    `(person, period)`, and the seed `@admin` LLM access.
  - `system.go`: `Open` (WAL, a busy timeout, foreign keys, immediate
    transactions) and a migration runner ported from SLOP-011 (foreign keys
    off, then `foreign_key_check` before commit). Also `Log` and `Logs` for
    the system log, and `Tx`.
  - `people.go`: `SignInUser`. Admin emails become admins; open sign-up
    makes members, approval mode makes pending users. Also `SetRole`
    (disabling deletes sessions and revokes tokens) and `CreateGuest`.
  - `sessions.go`:
    - sessions are hashed and bound to one host, with a CSRF token;
    - `ScopesForRole`;
    - `CheckTokenGrant`, ported from v2's `tokenGrant`: admin-scope tokens
      expire within 1–90 days;
    - `CreateToken`, `TokenBySecret` (which records last use) and
      `RevokeToken`.
  - `device.go`: `StartDevice`, `DeviceByUserCode`, `ApproveDevice` and
    `PollDevice`. A token is handed out exactly once; the poll answers
    pending, denied or expired otherwise.
- **`pkg/ids`:** prefixed hex ids (`usr_`, 12 bytes, like v2), `slp_`
  secrets, `XXXX-XXXX` user codes, sha256 hashes.
- **`pkg/config`:** the slop.yaml types (hosts, OIDC, Stripe) and defaults
  for local development on `*.localhost:18300`; `HostKind`.
- **`pkg/access/principal.go`:** `Principal` with `ID()`, `ViaLabel()`
  (the door plus the token id) and `HasScope` (admin ⊃ write ⊃ read;
  sessions hold every scope).
- **`pkg/verbs`:**
  - `Verb`, `Arg` and `Args` with typed getters;
  - `Error`, with codes mapped to HTTP status;
  - `Call`, which checks scope, admin-only, write verbs from guests and
    required arguments, then runs the verb;
  - the verbs `whoami`, `token.ls`, `token.new` (a token cannot mint more
    scopes than it has), `token.rm`, `people.ls`, `people.role` (no
    self-demotion) and `log.system`.
- **`pkg/server`:**
  - the host router, which dispatches main, live, static and sandbox hosts;
    the last three are nil until P2;
  - `auth.go`: `principalOf` (a bearer token or a session cookie), the
    local sign-in form, logout, and `/auth/session` (the person and CSRF
    token for the back office);
  - `device.go`: `/auth/device`, `/auth/device/token`, and `/device` for
    approval, with scope checkboxes and days;
  - `api.go`: `GET /api/v1/verbs` and `POST /api/v1/{verb}`, which requires
    `X-CSRF-Token` for session calls.
- **`pkg/client`:** the credentials file in v2's exact format (so `slop2`
  can share it), `SLOP_CREDENTIALS` and `SLOP_TOKEN` overrides, and `Call`.
- **`cmd/slop`:**
  - `serve` (`--local`, `--admin-email`, `--data`, `--listen`, `--config`);
  - `auth login|status|logout`;
  - `verbs`, and `verb <name> --json`;
  - generated `slop <group> <verb>` commands with positional arguments, a
    flag per argument, `--json` and `-o yaml|json|table`.
- **Tests:** `pkg/server/p0_test.go`:
  - `TestDeviceLoginWhoamiRevoke`: pending before approval, approve, collect
    once, `whoami`, refuse escalation, refuse a read token on a write verb,
    revoke, refuse a session call without CSRF;
  - `TestSignupRoles`.
- **Manual run:** the server runs in tmux session `slop3` with
  `scratchpad/v3run/data`. `slop auth login` ran with
  `SLOP_CREDENTIALS=scratchpad/v3run/creds.json` and was approved via curl
  (local sign-in, then the CSRF token from `/device`, then POST). Then I ran
  `slop whoami`, `slop token ls -o table` and `slop people ls -o table`.

### Why

- Cobra commands generated from the verb table, rather than Glazed, for
  now. The table is the single source and the adapter is about 150 lines. A
  Glazed adapter can replace it without touching the verbs.
- In-process verbs rather than a separate `Need` hook: verbs call the access
  checks themselves. That keeps the table simple; `Call` enforces only the
  cross-cutting rules.
- The test uses its own credentials file. The user's real
  `~/.config/slop/credentials.json` holds their v2 production token, and
  must never be rewritten by a test.

### What worked

- `go build`, `go vet` and `go test ./...` passed on the first run.
- Device login end to end with the real binary:

  ```text
  Logged in to http://slop.localhost:18300 as Admin with scopes [read write admin] (token tok_344e7f96f8c02b370b64e85d).
  ```

  and `slop whoami` then showed `role: admin`, `kind: token`,
  `via: cli:tok_344e…`.

### What didn't work

- Starting the server in tmux failed twice:
  - `tmux has-session -t slop3 || tmux new-session ...` followed by
    `tmux kill-window -t slop3:server` printed `can't find window: slop3`;
  - `tmux new-window -d -t 'slop3:'` then printed
    `can't find session: slop3`.

  `tmux ls` showed no `slop3` session, so the `has-session` check must have
  succeeded on something else (most likely a prefix match on the existing
  session `slop`). Fixed with an explicit
  `tmux new-session -d -s slop3 -n server <script>`.
- The editor's language server keeps reporting
  `go.work requires go >= 1.26.6 (running go 1.25.5)`. It runs an older Go
  against a `go.work` higher up the tree. Builds use `GOWORK=off` with Go
  1.26.6 and are unaffected.

### What I learned

- `tmux has-session -t <name>` is not safe when another session's name is a
  prefix of it; create named sessions explicitly.
- The device flow needs no token on the polling side. The CLI must clear any
  stored token before starting it.

### What was tricky to build

- **Handing out the device token once.** The device row stores the token's
  plain secret only until the first successful poll, then clears it. A
  second poll gets 404 ("expired or already used"). The plain secret lives
  in `system.db` for at most the time between approval and the first poll
  (about two seconds).
- **CSRF for the back office.** Session calls to `/api/v1` must send
  `X-CSRF-Token`. The token comes from `/auth/session`, which needs the
  cookie, so a cross-site page cannot read it.

### What warrants a second pair of eyes

- `token_plain` in `device_codes`: a short-lived plaintext secret at rest.
  An alternative is to mint the token at poll time instead of approval time.
- `principalOf`: a disabled user's token returns not-found (401), and a
  disabled user's session behaves as signed out.

### What should be done in the future

- P1: stores, the turn API, documents, files, snapshots and refs, the log,
  the store verbs, eval, and the importers.

### Code review instructions

- Start with `pkg/server/p0_test.go`, then `pkg/system/sessions.go` and
  `device.go`, then `pkg/verbs/verb.go` (`Call`).
- To run it:
  1. `GOWORK=off go build -o slop ./cmd/slop`
  2. `./slop serve --local --admin-email you@x`
  3. in another shell:
     `SLOP_CREDENTIALS=/tmp/c.json ./slop auth login --server http://slop.localhost:18300`

### Technical details

```text
GOWORK=off go test ./...  ->  ok  github.com/go-go-golems/slop/pkg/server  0.033s
server: tmux session slop3, data in scratchpad/v3run/data, listen 127.0.0.1:18300
hosts:  slop.localhost:18300 (main), apps.localhost:18300 (live),
        site.localhost:18300 (static), *.sbx.localhost:18300 (sandbox)
```

## Step 8: P1, stores, documents, files, the SQL policy, verbs and eval

P1 is done (code commit `9f454de`). A store is now a real SQLite file under
`<data>/stores/<id>/store.db`. Every write goes through a turn, and a turn
that changes anything becomes one commit with one rev and a log entry.
Documents, tree and asset files, snapshots, refs and app tables all live in
the store. Access is checked once, by `access.Checker`, and every denial
carries a trace.

The exit test from the guide passes twice. In `pkg/server/p1_test.go`,
through HTTP, one `eval` program:
- creates a store;
- imports a CSV;
- writes the rows as documents in one commit;
- queries them;
- pushes a folder twice;
- lists the snapshots.

The export → import round trip gives an identical bundle, app tables,
triggers and AUTOINCREMENT included. By hand, against the real binary, push,
pull, rollback, the importers, eval, and `store export --folder` / `import
folder` all work.

### Prompt Context

**User prompt (verbatim):** "1. monthly
2. yes

Now implement, commit at appropriate intervals and keep a detailed diary as
you work (using the diary format from the skill)"

**Assistant interpretation:** Continue the phased implementation from the
guide. P1 is stores, verbs and eval.

**Inferred user intent:** An agent with a token can create stores, load
data, query it and push content with one CLI or one eval program.

### What I did

- **`pkg/rt` and `pkg/blobs`** were copied from slop-computer, with their
  tests and testdata. `github.com/pkg/errors` was replaced by stdlib
  wrapping.
- **`pkg/store`** (new):
  - `store.go`: the schema from Appendix B. `Open` uses one writer
    connection (`*sql.Conn`, `MaxOpenConns 1`) carrying the authorizer, the
    `slop_*` functions and `SQLITE_LIMIT_ATTACHED=0`, plus a read-only pool
    for reads.
  - `turn.go`: `Store.Do(ctx, who, fn)`:
    - holds a mutex, runs `BEGIN IMMEDIATE`, rev = max + 1;
    - runs `fn`, then collects doc/file/meta changes plus the app tables the
      authorizer saw written;
    - writes `_log`/`_changes` and commits;
    - calls `OnCommit` outside the lock;
    - rolls back on any error or panic.
  - `docs.go`:
    - `SetDoc`, with `ifVersion`;
    - `UpdateDoc`, a deep merge through `rt.Merge`;
    - `DeleteDoc`, which leaves a tombstone with the version incremented;
    - `RestoreDoc`, for imports;
    - the 25k-document quota, counted once per turn;
    - `Query`: SQL selects the collection, then `rt.Query.Apply` filters
      and sorts;
    - `DocsSince`, `Collections`.
  - `files.go`:
    - `PutFile` and `PutBlob`, which references an existing blob;
    - `RemoveFile`;
    - `Snapshot`: a canonical tree hash over sorted `path\tsha256` lines.
      It is a no-op when the ref already points at an identical tree.
    - `MoveRef`, `Ref` (a name or a number), `SnapshotFiles`;
    - `Log` and `RecentLog`.
  - `export.go`: `Bundle` holds meta, docs (with versions), files, the app
    schema and table rows.
    - `AppSchema` uses `pragma_table_list` to drop FTS shadow tables.
    - `Restore` order: tables, then rows, then indexes, views and triggers,
      then an FTS `rebuild` for external content, then docs and files.
  - `sqlpolicy.go`: the authorizer for five callers (kernel, actor,
    migration, admin-read, admin-write), and the `slop_principal/level/now`
    functions.
- **`pkg/system/stores.go`:** the stores registry (`AddStore`,
  `StoreByID`, `Stores`, `StoresGranted`, `RemoveStore`) and grants
  (`Grants`, `SetGrant`, `RemoveGrant`). Each write logs to the system log.
- **`pkg/access/check.go`:**
  - `AudienceOf`, with a `Subscribed` hook that billing fills in at P5;
  - `Matches`, for grant subjects;
  - `Checker.Level`: owner, then admin, then the best matching grant,
    capped by audience and then by token scopes (read → view, write and
    admin → owner);
  - `Checker.Can`, which returns a `Decision` with a trace. A store you
    hold no level on reads as `not_found`.
- **`pkg/kernel/kernel.go`:**
  - opens stores lazily by id;
  - `CreateStore` writes the registry row, the file and the meta in a first
    commit;
  - `DeleteStore`;
  - `Subscribe`, which fans every commit out;
  - a `Rules` hook that returns the defaults until P2 reads app manifests.
- **Verbs**, all through `Env.open`, which checks the level, opens the
  store and attaches the trace on denial:
  - `store.ls/new/rm/meta/export`;
  - `docs.get/ls/query/set/update/rm`, with batches of up to 500 in one
    commit and app rules checked per path;
  - `files.ls/cat/put/rm/push/blobs`, `snap.new/ls`, `ref.ls/move`;
  - `grant.ls/set/rm` (you cannot grant above your own level), `log.show`;
  - `sql.query/exec` (admin-only, run through the authorizer in a turn) and
    `sql.schema`;
  - `import.docs/table/files/folder`;
  - `eval`.
- **`eval`** (`pkg/verbs/eval.go`):
  - a fresh goja runtime per call;
  - every verb mounted as `slop.<group>.<verb>(args)`, synchronous and
    calling `verbs.Call` as the same principal with via `eval` (the log
    shows `eval:tok_…`);
  - verb errors thrown as JS `Error`s with `.code` and `.trace`; an
    uncaught one keeps its code;
  - console capture, which is returned with the error too;
  - a 60 s interrupt and context cancellation;
  - `readOnly`.
- **CLI** (`cmd/slop/cmds/extra.go`):
  - `push <dir>`: hashes first; on `missing_blobs` it uploads those through
    `files.blobs` in 32 MiB chunks and repeats;
  - `pull <store> <dir> --at`;
  - `eval -f/-e/--args/--read-only`, with logs on stderr;
  - `import docs|table|files|folder`, which read local files;
  - `store export --folder`;
  - `files cat`, which writes raw bytes.

  Where a verb has the same name, these replace the generated commands.
- **`pkg/client/folder.go`:** `ReadDir`, `Push`, `Pull`, `ExportFolder` and
  `ImportFolder`, using the folder format: `store.json` (authoritative:
  meta, the file index, the schema), `docs.jsonl`, `tree/`, `assets/`,
  `schema.sql` (for people to read) and `tables/<name>.jsonl`.
- **The guide:**
  - §4.6 now keeps `trusted_schema` at its default (see below);
  - §12.2 lists `files.blobs` and `snap.new`;
  - §15 explains typed CSV cells and the hashes-first push;
  - the layout puts the SQL policy in `pkg/store`.

### Why

- **One writer connection per store:** the authorizer and the `slop_*`
  functions are per connection. One writer guarded by a mutex means "the
  turn in progress" is a single pointer (`Store.cur`) that the authorizer
  and the functions can read. Readers use a separate read-only pool, so
  reads never wait on a turn.
- **Recording table writes in the authorizer:** the authorizer sees every
  INSERT, UPDATE and DELETE target while statements are prepared. Recording
  them there gives the commit a list of tables changed without parsing SQL.
- **Queries in Go:** `rt.Query.Apply` is v2's tested contract semantics.
  Selecting by `coll` in SQL and then applying in Go kept the semantics
  exact. Translating to `json_extract` is an optimization for later.
- **`eval` in the verbs package:** it needs the verb table. The kernel does
  not need verbs, so `Env` holds `*kernel.Kernel` directly, and the P0
  placeholder interface is gone.

### What worked

- The authorizer approach. The tests show:
  - migrations create app tables, indexes, triggers and views;
  - actors write app tables but not `_*`;
  - `CREATE TEMP`, `ATTACH`, `PRAGMA writable_schema`, `COMMIT` and
    `DROP TABLE` from actors are all denied;
  - recursive CTEs are allowed;
  - admin reads cannot write.
- Restoring tables before triggers: the round-trip test checks that the
  audit trigger did not fire on restored rows (2 audit rows, not 4), and
  that AUTOINCREMENT continues from 3.
- The idempotent snapshot: the second, unchanged `slop push` answered
  `n: 1` with no new rev.
- The trace on denial. Bob's failed write explains itself: `audience
  member` / `grant @member view on library (direct)` / `rule books/2:
  write needs interact` / `view < interact`.

### What didn't work

- **`go vet ./pkg/store`:** `undefined: sqlite3.SQLITE_RECURSIVE`.
  mattn/go-sqlite3 comments that constant out, so I defined
  `sqliteRecursive = 33` locally.
- **`trusted_schema=OFF` broke the guide's own example.** The first store
  test failed with `unsafe use of slop_principal()`. With
  `trusted_schema=OFF`, only functions flagged `SQLITE_INNOCUOUS` may run
  from the schema (defaults, views, triggers), and mattn's `RegisterFunc`
  cannot set that flag. The guide asked for both `trusted_schema=OFF`
  (§4.6) and `CREATE VIEW … WHERE owner = slop_principal()`. I kept
  SQLite's default and documented why the authorizer is the guard instead.
- **AUTOINCREMENT was denied:** `not authorized` on `CREATE TABLE entries
  (id INTEGER PRIMARY KEY AUTOINCREMENT, …)`. A temporary deny logger
  showed `action=2 a1="sqlite_sequence"`: SQLite creates `sqlite_sequence`
  itself. The authorizer now allows that one `CREATE_TABLE` for
  migrations. Later updates to `sqlite_sequence` are not authorized
  separately; the round-trip test inserts into an AUTOINCREMENT table under
  admin-write without trouble.
- **Queries returned nothing for numbers:** `where year >= 2000` matched no
  documents in the first eval test. v2's `rt.compare` ranks `float64`, but
  v3 decodes bodies with `UseNumber`, so values were `json.Number`. `rt`
  now normalizes with `numify` in `compare`, `sameKind` and `canon`.
- **Panic in `evalError`:** `invalid memory address or nil pointer
  dereference`. `obj.Get("trace")` returns nil when the property is absent,
  and `.Export()` on nil panics. Fixed with a guard.
- **A rejected write:** my first `Write` of `cmd/slop/cmds/extra.go` was
  rejected ("File has not been read yet"), and the build still had the stub.
  I restored the content from the session transcript after reading the
  file.
- **Two `eval` commands:** the generated root `eval` and the hand-written
  one were both added. `addExtraCommands` now removes the generated one.
- **Found by hand with the binary:**
  - CSV import stored `year` as `"2004"`, so the eval query found 0 rows.
    The contract compares only same-type values, so this was correct but
    useless. `import.docs` now types CSV cells that round-trip exactly, and
    `--raw` turns that off.
  - Eval errors printed `not_found: not_found: …`, because the JS message
    repeated the code. The message no longer carries it.
- **Wrong tests of mine:** `data/users/<id>/notes/n1` has five segments,
  so it is a collection path; and I asked `audit` for an `id` column it
  does not have.

### What I learned

- In mattn/go-sqlite3, `RegisterAuthorizer` passes four arguments: action,
  arg1, arg2 and the database name; the trigger or view name is dropped.
  For `ALTER TABLE` the table name is arg2.
- Statements inside a trigger body are authorized when the outer statement
  is prepared. So the trigger in the round-trip test, which inserts into
  `audit`, is checked as the caller of the outer insert.
- `pragma_table_list` (SQLite 3.37+) tells shadow tables apart from virtual
  tables. That is what makes FTS5 exportable without copying its internal
  tables.
- goja: a native function that panics with a `*goja.Object` throws it as a
  JS exception. `obj.Get` returns nil, not undefined, for absent
  properties.

### What was tricky to build

- **The order of a restore:** creating triggers before inserting rows
  would fire them on every restored row. Creating indexes first would
  slow the inserts. The order is tables, then rows, then
  indexes/views/triggers, then an FTS rebuild.
- **The pushes:** they had to be cheap for the CLI (send only missing
  blobs), possible from eval (no hashing in JS), and safe (hashes verified
  on upload; `PutBlob` checks that the blob exists at the declared size).
  That gave three entry shapes: a hash only, inline `text`, inline `data`.
- **Counting documents:** the quota check `count(*)` per write was O(n²) on
  a big import. The turn now counts once and tracks additions. A deletion
  before the first count must not subtract, because the count already
  excludes the deleted row.

### What warrants a second pair of eyes

- `trusted_schema` stays on. The argument rests on three points: schema
  only enters through migrations under the authorizer; the `slop_*`
  functions have no side effects; and store files are opened only by the
  kernel. Check `pkg/store/sqlpolicy.go`.
- **The token scope cap** (`access.scopeCap`): read → view, write → owner.
  A write-scoped token can therefore act as the person's full level,
  including `grant.set` and `store.rm`. That matches "scopes say what the
  token may do; levels say where" but deserves review.
- **`store.rm` for admins** needs only `admin` level (admins are admin on
  every store), so admins can delete anyone's store.
- `sql.query` goes through a turn on the writer (to get the authorizer)
  and holds the store's lock for the length of the query.

### What should be done in the future

- Blob garbage collection: the guide's refcount (`blob_refs`) or a scan of
  every store. Nothing is collected yet.
- Translate queries to SQL with `json_extract`. The current approach loads
  a collection per query and is fine up to the 25k-document quota.
- `import.folder` sends its blobs in the request body (96 MiB limit). Large
  stores need `files.blobs` chunking there too, once the store exists.
- `store.fork`, `log.watch` (streaming) and the `--sqlite` export.
- P2 replaces `Kernel.Rules` with the owner app's manifest rules and
  enforces D9 (only admins push app code).

### Code review instructions

- Start with `pkg/store/turn.go` (the turn and commit), then
  `pkg/store/sqlpolicy.go` and `pkg/access/check.go`.
- Then `pkg/verbs/env.go` (`open`, the one access path for verbs),
  `pkg/verbs/docs.go`, `pkg/verbs/files.go` (`push`) and
  `pkg/verbs/eval.go`.
- Validate:
  - `GOWORK=off go test ./...`
  - `GOWORK=off go vet ./...`
  - by hand: `slop serve --local`, then `slop push`, `slop eval -f`,
    `slop store export --folder`, `slop import folder`.

### Technical details

The exit program (from `TestEvalProgram`):

```js
slop.store.new({ id: 'inbox' });
slop.files.put({ store: 'inbox', path: 'books.csv', text: args.csv });
const rows = slop.files.cat({ store: 'inbox', path: 'books.csv', as: 'csv' });
slop.store.new({ id: 'library' });
slop.docs.set({ store: 'library', batch: rows.map(r => (
  { path: 'books/' + r.isbn, data: { title: r.title, year: Number(r.year) } })) });
const recent = slop.docs.query({ store: 'library', coll: 'books',
  where: [['year', '>=', 2000]], orderBy: 'year', desc: true });
slop.files.push({ store: 'library', message: 'site', files: [
  { path: 'index.html', text: '<h1>Library</h1>' }, { path: 'style.css', text: 'h1 { color: red }' }] });
```

The run by hand (scratch data directory and scratch credentials; the user's
real credentials file was not touched):

```text
$ slop push site --store demo -m first        → n: 1, rev: 2
$ slop push site --store demo -m unchanged    → n: 1 (no rev: identical tree)
$ slop push site --store demo -m navy         → n: 2, rev: 3
$ slop ref move demo main 1                   → rev: 4
$ slop files cat demo css/site.css --at main  → h1{color:teal}
$ slop import docs books.csv --store demo --coll books --id isbn → imported: 3
$ slop eval -f q.js --args '{"store":"demo"}' → found 2 / Newer (2019), New (2004)
$ slop eval -e 'slop.docs.get({store:"demo", path:"books/999"})'
error: not_found: no document books/999
$ slop store export demo --folder exported && slop import folder exported --store demo-copy
→ docs: 3, files: 2, tables: 0; demo-copy refs {main: 1}
```

The authorizer denial that revealed AUTOINCREMENT:

```text
DENY action=2 a1="sqlite_sequence" a2="" db="main"
CREATE TABLE entries (id INTEG… not authorized
```
