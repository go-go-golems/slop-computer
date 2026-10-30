---
Title: 'Live sites: real db on site hosts, per-instance access grants, signed-in and anonymous viewers'
Ticket: SLOP-011
Status: active
Topics:
    - architecture
    - auth
    - routing
    - collaboration
    - frontend
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/server/rt.go
      Note: levelOf and newView; where grants come in
    - Path: repo://pkg/server/serve.go
      Note: serveSite and serveSandbox; where live routes and the shell plug in
    - Path: repo://web/workshop/src/screens/AppScreen.tsx
      Note: The shell whose handshake the site shell copies
ExternalSources: []
Summary: 'Run apps live on site hosts: site sessions for signed-in and anonymous viewers, instances named in the URL, per-instance grants, a site shell that keeps one origin per instance.'
LastUpdated: 2026-10-30T14:44:58.435481085-04:00
WhatFor: Landing page for SLOP-011
WhenToUse: Start here for live sites and access grants
---

# Live sites: real db on site hosts, per-instance access grants, signed-in and anonymous viewers

## Overview

Today an app like Claude Blocks runs live only in the Workshop at `/run/<target>`, for admins. On the public site host it can only run in static mode from a frozen `db.json`, with no viewer identity and no rules. This ticket designs live apps on site hosts: site sessions for signed-in users (handed over from the main host) and anonymous visitors (`vis_…`), instances named in the URL (`/blocks/:db`), a per-instance grant table with share links and an access API, and a site shell that frames each instance's own origin.

Status: design written; implementation not started. Open product questions are in the guide, section 12.2.

## Key Links

- **Intern guide (start here)**: [design-doc/01-intern-guide-live-sites-instances-and-access-grants.md](./design-doc/01-intern-guide-live-sites-instances-and-access-grants.md)
- **Diary**: [reference/01-diary.md](./reference/01-diary.md)
- **Prerequisite**: SLOP-009 intern guide, `ttmp/2026/10/29/SLOP-009--artifact-runtime-baseline-slop-hosts-the-artifact-contract-natively-no-adapters/design-doc/01-intern-guide-the-slop-artifact-runtime.md`
- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- architecture
- auth
- routing
- collaboration
- frontend

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
