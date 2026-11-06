---
Title: 'Per-app modules part 1: a safe database module and mount-scoped HTTP endpoints for actors'
Ticket: SLOP3-012
Status: active
Topics:
    - goja
    - apps
    - architecture
    - security
    - routing
    - hosting
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-05T19:42:34.993543724-05:00
WhatFor: ""
WhenToUse: ""
---

# Per-app modules part 1: a safe database module and mount-scoped HTTP endpoints for actors

## Overview

First implementation of per-app modules (research: SLOP3-011). Part 1: a `database` module with go-go-goja's JavaScript API over the actor's own store (savepoint-backed `begin`, no `configure`, no handle to other databases), an `express`-style route builder compiled into the actor's route table, and a policy on the mount (`Mount.API`: route allowlist, level floors, a fixed host middleware chain, response and request policy). Part 2: the module type and admin grants with configuration. Start with the intern guide in `design-doc/01-intern-guide-…`. Status: design written; implementation not started.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- goja
- apps
- architecture
- security
- routing
- hosting

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
