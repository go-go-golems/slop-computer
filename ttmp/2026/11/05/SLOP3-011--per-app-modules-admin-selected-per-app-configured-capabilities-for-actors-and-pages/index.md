---
Title: 'Per-app modules: admin-selected, per-app configured capabilities for actors and pages'
Ticket: SLOP3-011
Status: active
Topics:
    - goja
    - apps
    - architecture
    - security
    - hosting
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-05T19:28:27.840160688-05:00
WhatFor: ""
WhenToUse: ""
---

# Per-app modules: admin-selected, per-app configured capabilities for actors and pages

## Overview

Let each mounted app use a chosen set of modules in its actor (and, through verbs, its page): go-go-goja-compatible APIs such as `database` and `express`, configured safely or replaced by slop's own sandboxed versions, with an admin granting and configuring each module per app. Research is done (diary steps 1–7): slop already has a `use(name)` catalog with manifest declarations, `app.trust` and per-audience policy; go-go-goja/xgoja supply the module contract (`providerapi.Module` with per-instance config) but are unsafe by default; go-go-host has the data model without runtime enforcement. Decided so far: database and HTTP endpoints first, as slop's own modules with go-go-goja's JavaScript API (no fs except an in-memory one, no handle to other databases).

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
