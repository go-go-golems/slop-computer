---
Title: 'Authorization redesign: one decision function, permits at the resource boundary, deny-by-default origins'
Ticket: SLOP3-005
Status: complete
Topics:
    - access
    - auth
    - architecture
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Make the PR #13 classes of access bugs impossible by construction: one decision function over current state, credentials with ceilings, permits at the resource boundary, author authority for SQL, deny-by-default trusted origins; plus rev-guarded sync and idempotent mutations.'
LastUpdated: 2026-11-03T17:10:26.632385969-05:00
WhatFor: ""
WhenToUse: ""
---

# Authorization redesign: one decision function, permits at the resource boundary, deny-by-default origins

## Overview

The review of PR #13 (the slop v3 cutover) found eleven bugs. Six share one cause: authorization decisions are made at many entry points, and some reuse a copy computed earlier. Views kept a stale level, imports skipped the app-code rule, queries limited before filtering, a kernel-table trigger ran with kernel authority, and store files ran as pages on the live host. This ticket designs the reorganization that removes the cause, and plans it in phases A0 to A7. S1 and S2 cover the adjacent sync and delivery problems.

Status: the guide is written and uploaded; implementation has not started.

## Key Links

- **Guide**: [design-doc/01-authorization-redesign-design-and-implementation-guide-for-interns.md](./design-doc/01-authorization-redesign-design-and-implementation-guide-for-interns.md)
- **Diary**: [reference/01-diary.md](./reference/01-diary.md)
- **Origin**: the cutover diary, `ttmp/2026/11/01/SLOP3-004--…/reference/01-diary.md`, steps 2 to 4

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- access
- auth
- architecture

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
