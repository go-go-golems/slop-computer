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
