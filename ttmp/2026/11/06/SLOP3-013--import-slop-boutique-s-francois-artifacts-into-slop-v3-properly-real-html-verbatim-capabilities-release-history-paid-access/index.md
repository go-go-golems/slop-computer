---
Title: 'Import slop.boutique''s francois artifacts into slop v3 properly: real HTML, verbatim capabilities, release history, paid access'
Ticket: SLOP3-013
Status: active
Topics:
    - data-migration
    - deployment
    - architecture
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Re-import slop.boutique's catalog from francois's database and volume (read-only) into the 103 existing release stores: real HTML for 8 placeholders, verbatim capabilities, provenance, paid access, history where safe."
LastUpdated: 2026-11-06T17:07:33.513671013-05:00
WhatFor: ""
WhenToUse: ""
---

# Import slop.boutique's francois artifacts into slop v3 properly: real HTML, verbatim capabilities, release history, paid access

## Overview

The 103 `release` stores on slop.yolo came from slop v2's API import (SLOP-002) via the v3 cutover (SLOP3-004). Eight hold placeholders instead of paid apps, six carry altered capabilities (two lost `db.rules`), and all are public. This ticket reads francois's Postgres and release volume read-only and makes each store match its latest published release, with paid releases restricted to subscribers.

- Guide: `design-doc/01-intern-guide-importing-francois-s-catalog-into-slop-v3-stores.md`
- Diary: `reference/01-diary.md`
- Scripts: `scripts/01-inventory.sh`, `scripts/03-import.py`, `scripts/04-verify.py`

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- data-migration
- deployment
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
