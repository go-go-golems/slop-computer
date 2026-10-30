---
Title: 'Artifact runtime baseline: slop hosts the Artifact contract natively, no adapters'
Ticket: SLOP-009
Status: active
Topics:
    - architecture
    - backend
    - frontend
    - tools
    - collaboration
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "slop implements the claude.ai Artifact runtime contract natively (one page runtime, pkg/rt, a contract db with rules, rooms, assets, comments, downloads, publish, sample; slop API as claude.use(\"slop\")), deleting the per-app adapters, docs store and tool grants."
LastUpdated: 2026-10-29T15:42:53.643919021-04:00
WhatFor: ""
WhenToUse: ""
---

# Artifact runtime baseline: slop hosts the Artifact contract natively, no adapters

## Overview

Replace slop's per-app adapters with a native implementation of the claude.ai Artifact runtime contract, so any artifact-style page (Claude Blocks, Pinup, CC5, Claude-written pages) runs unchanged. The refactor is brutal: the docs store, tool grants, per-version sandbox origins and Pinup's adapter are deleted, not wrapped.

**Status:** designed; nothing implemented. Next: phase 1, the contract conformance suite.

- **Guide:** [design-doc/01-intern-guide-the-slop-artifact-runtime.md](./design-doc/01-intern-guide-the-slop-artifact-runtime.md)
- **Diary:** [reference/01-diary.md](./reference/01-diary.md)
- **Related:** SLOP-008 (Claude Blocks), whose plan moves onto this baseline; SLOP-004 (Pinup on slop), whose adapter this ticket deletes.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- architecture
- backend
- frontend
- tools
- collaboration

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
