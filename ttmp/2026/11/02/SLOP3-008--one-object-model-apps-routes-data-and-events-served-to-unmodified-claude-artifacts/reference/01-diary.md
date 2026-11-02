---
Title: Diary
Ticket: SLOP3-008
Status: active
Topics:
    - architecture
    - sqlite
    - routing
    - hosting
    - access
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/02/SLOP3-008--one-object-model-apps-routes-data-and-events-served-to-unmodified-claude-artifacts/design-doc/01-one-object-model-for-apps-routes-data-and-events.md
      Note: The design this diary records
ExternalSources: []
Summary: Chronological record of the SLOP3-008 review.
LastUpdated: 2026-11-02T18:00:00-05:00
WhatFor: How the one-object-model review came about and what it was checked against.
WhenToUse: Resuming SLOP3-008 or revisiting why SLOP-008 was dropped.
---

# Diary

## Goal

Answer, against slop v3's actual code, how apps, routes, data and events
should be unified so that claude.ai artifacts run unmodified, admin tools
and multi-store apps are ordinary apps, and custom apps get
Durable-Object-like behaviour.

## Step 1: The request, and dropping SLOP-008

The user asked (verbatim):

> basically i'm trying to figure out how to best unify our data model on the backend, and serving apps that come straight out of claude without having to adapt them (and its DB API), while also allowing potentially custom apps to have more durable objects ike behaviour or maybe making it possible to have 1:1 durable objects API compatibility as well. [...] How would you potentially unify everything, if you could start from scratch. Things I want to be abl eto do for example is create an app, that admins can use, to edit the metadata of other apps, view their source. Or an app that can be given access to multiple databases that are then exposed to its actual code (which comes straight from claued.ai) using the claude artifact db API.

and then pointed at an earlier review, SLOP-008
(`ttmp/2026/11/02/SLOP-008--artifact-state-storage-api-vs-slop-content-model-architect-review/`
in `/home/manuel/code/wesen/slop-computer`).

SLOP-008 turned out to review slop **v2**. It cites `pkg/store/artifacts.go`,
`docs`/`doc_heads`, `refs`, `tool_grants` and `DocTypes = {pinup}`, none of
which exist in v3. It was committed as 2f68cd9 on a local `main` that was
227 commits behind `origin/main` and predated `73c4c11` (the v2 removal);
it was never pushed. Most of its gaps (per-document `ifVersion`, nested
paths, queries, path rules with `{self}`, 10-minute leases, assets,
`artifact.publish`) are closed in v3.

The user then said: "oh omg, ok, rebase main, and let's do it again, from scratch. kill that file."

### What I did

- Checked 2f68cd9 held only the SLOP-008 ticket (8 files under `ttmp/`),
  then `git -C /home/manuel/code/wesen/slop-computer reset --hard origin/main`
  (now 7e1f912) and removed the empty directory skeleton left behind.
  `.idea/` (untracked) was left alone.
- Read v3's model: `pkg/store/store.go` (store schema),
  `pkg/system/migrations/001_init.sql` (`stores`, `mounts`, `bindings`,
  `grants`, the system `_log`/`_changes`), `pkg/actor/modules.go`
  (`use()` catalog, `stores.open`), `pkg/actor/sysreact.go`,
  `web/runtime/src/index.ts` and `caps.ts` (page capabilities,
  `slop.stores.open`), `apps/backoffice/app.json` (the `system` module),
  `design/slop-v3-design.md` §1, §5.5–5.8, §8.
- Wrote the design doc from scratch.

### Why

The question is about v3, and v3 already unifies around one noun, the
store. A review of v2 would argue for things v3 has.

### What worked

The from-scratch design and v3 converge: one SQLite file per object, one
writer, the log as the event system. That made the review about the three
places v3 does not use its own primitive: the registry, bindings, and
source access.

### What didn't work

Nothing failed. One draft error was caught before commit: the worked
example used `export default { migrations: [...] }`, but ES modules are a
v3.0 non-goal and migrations are `sql/NNN_name.sql` files. Fixed to
`defineActor({...})` with a separate SQL file, after reading
`examples/guestbook/actor.js` and `examples/journal/`.

### What I learned

- `system.db` already has `_log` and `_changes`, and `system:` reactors
  follow it. Making it a store is mostly presentation (documents over
  tables), not a storage change.
- The claude.ai contract's `files` capability (a Claude Code project's
  tree) is exactly the "view source" API an admin console needs.
- The contract has no cross-collection query, which is what makes
  prefix-mounted namespaces exact: every query lands in one store.

### What was tricky

- Whose level applies on a mounted store. Settled as a per-mount `as`
  (`viewer` by default, `store` for delegation like blocks-site), with the
  minimum of the binding's level.
- Doc/collection parity across mounts: a mount must keep segment-count
  parity or the page's paths change meaning.

### What warrants review

- §5.2 rules 1–5 and the `as` table.
- §5.3: registry writes through verbs with `ifVersion`; which documents are
  writable at all (open question 2).
- §6.2: the claim that 1:1 Durable Objects compatibility needs the Workers
  runtime, not storage work.

### What should be done in the future

Decide the open questions in §10, then phase 1 (namespaces for pages).
