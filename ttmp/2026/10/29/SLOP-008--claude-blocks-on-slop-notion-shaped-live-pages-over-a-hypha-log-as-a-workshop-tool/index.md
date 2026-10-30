---
Title: 'Claude Blocks on slop: Notion-shaped live pages over a Hypha log as a Workshop tool'
Ticket: SLOP-008
Status: active
Topics:
    - tools
    - collaboration
    - architecture
    - frontend
    - backend
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Run Claude Blocks (a Notion-shaped workspace of live pages over one Hypha log) on slop as an admin-only Workshop tool over the docs store, with agents through the slop CLI and a headless Hypha kernel (goja)."
LastUpdated: 2026-10-29T15:13:08.318311931-04:00
WhatFor: ""
WhenToUse: ""
---

# Claude Blocks on slop: Notion-shaped live pages over a Hypha log as a Workshop tool

## Overview

Claude Blocks is a claude.ai Artifact built on Ramon Marc's CC5: pages, properties and blocks are cells in one Hypha log that people and Claudes write together. This ticket designs running it on slop the way SLOP-004 ran Pinup: the upstream files unchanged as a tool page, a `window.claude` adapter over the docs store, and agents through the `slop` CLI, first by Blocks' own turn protocol, then with the Hypha kernel embedded through goja.

**Status:** research done; the intern guide is the deliverable. Nothing is implemented yet.

- **Guide:** [design-doc/01-intern-guide-claude-blocks-on-slop.md](./design-doc/01-intern-guide-claude-blocks-on-slop.md)
- **Diary:** [reference/01-diary.md](./reference/01-diary.md)
- **Experiments:**
  - [scripts/01-hypha-headless.js](./scripts/01-hypha-headless.js) (the kernel in Node);
  - [scripts/02-hypha-goja.go](./scripts/02-hypha-goja.go) (the kernel in Go through goja; 5,000 ops in 274 ms).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- tools
- collaboration
- architecture
- frontend
- backend

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
