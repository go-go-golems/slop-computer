---
Title: 'Blocks publishing: a content-only live reader and static publishing for Claude Blocks workspaces'
Ticket: SLOP3-003
Status: complete
Topics:
    - architecture
    - goja
    - tools
    - apps
    - publishing
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/01/SLOP3-003--blocks-publishing-a-content-only-live-reader-and-static-publishing-for-claude-blocks-workspaces/design-doc/01-blocks-publishing-design-and-implementation-guide-for-interns.md
      Note: the intern guide
    - Path: repo://ttmp/2026/11/01/SLOP3-003--blocks-publishing-a-content-only-live-reader-and-static-publishing-for-claude-blocks-workspaces/reference/01-diary.md
      Note: the implementation diary
ExternalSources: []
Summary: 'Publish a Claude Blocks workspace as web pages: a blocks-site app folds the workspace server-side and serves content-only HTML (live reader), and pushes the same pages into a static store (static publishing).'
LastUpdated: 2026-11-03T17:10:26.501957424-05:00
WhatFor: ""
WhenToUse: ""
---

# Blocks publishing: a content-only live reader and static publishing for Claude Blocks workspaces

## Overview

A Blocks workspace can only be shown today by granting access to the editor. This ticket adds `apps/blocks-site`: an app whose instance is bound to a workspace, folds its op log in the actor (the editor's own Hypha kernel, vendored), and serves the pages as JavaScript-free HTML (the live reader). The same renderer produces static files that the `publish` action pushes into a static store through the workshop module (static publishing). Members can publish their own workspaces once an admin has installed the app and set two param mounts.

Start with the guide: `design-doc/01-blocks-publishing-design-and-implementation-guide-for-interns.md`. Progress is in `reference/01-diary.md`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- architecture
- goja
- tools
- apps

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
