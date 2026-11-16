---
Title: 'Bench core: drafts as server-side commits, evals as transactions, one API table, one storage model'
Ticket: SLOP3-023
Status: active
Topics:
    - architecture
    - apps
    - agents
    - tools
    - publishing
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Rewrite of the bench core: the server becomes the only place app files live (files.commit: an explicit change list against a required base, merged per file), evals become write-buffer transactions (delegation folds into the parent), the host API becomes one declared table, and project state moves into the bench actor's SQL and refs."
LastUpdated: 2026-11-16T13:21:19.260163573-05:00
WhatFor: ""
WhenToUse: ""
---

# Bench core: drafts as server-side commits, evals as transactions, one API table, one storage model

## Overview

The bench (SLOP3-022) keeps a replica of an app's files in the browser and reconciles it with the app store's draft. Code review on #47, #48 and #50 found 26 bugs; 18 are in that replica (`web/bench/src/03b-slop.js`, `04-project.js`), all forms of inferring whether the server is caught up. This ticket replaces the replica, with no legacy burden: deployed bench data may be wiped.

- **Server:** `files.commit` — a change list against a required base snapshot, applied in one store turn with a per-file merge; `ifAt` required on ref writes.
- **Browser:** a Draft core — an immutable snapshot cache plus `Tx` write buffers; an eval is a transaction, a delegated eval folds into its parent, a dry run is a transaction never committed.
- **Host API:** one declared table drives validation, guards, timeouts and the agent's API reference.
- **Storage:** threads and the timeline in the bench actor's SQL (events carry snapshot numbers, not texts); proposals as refs.

**Start here:** [design-doc/01 — the guide](./design-doc/01-guide-the-bench-core-rewrite-drafts-as-server-side-commits-evals-as-transactions.md) (for a new engineer: slop concepts, the bench today, the review evidence, the design, the phased plan, tests). [Diary](./reference/01-diary.md).

Status: guide written and delivered; implementation not started (phases 1–4 in tasks.md).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- architecture
- apps
- agents
- tools
- publishing

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
