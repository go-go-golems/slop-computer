---
Title: 'TypeScript in slop: the server compiles TS to JS with esbuild (apps, actors, the bench)'
Ticket: SLOP3-024
Status: active
Topics:
    - architecture
    - goja
    - apps
    - frontend
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/actor/actor.go
      Note: (*Actor).load and requirer run actor source in goja; actors would compile .ts here
    - Path: repo://pkg/actor/catalog.go
      Note: each actor module carries TypeScript declarations (Module.TypeScript)
    - Path: repo://pkg/doors/pages/storebytes.go
      Note: writeStoreBytes serves app files with their stored type; pages would compile .ts here
    - Path: repo://web/bench/build.mjs
      Note: the bench is already built with esbuild (npm)
ExternalSources: []
Summary: 'Parked: the slop server compiles TypeScript to JavaScript with esbuild''s Go API, so apps, actors and the bench are written in TS. Notes only; the full design is to be written later.'
LastUpdated: 2026-11-16T15:09:17.340734316-05:00
WhatFor: ""
WhenToUse: ""
---

# TypeScript in slop: the server compiles TS to JS with esbuild (apps, actors, the bench)

## Overview

Everyone who writes code for slop (the person, the agent, the bench) would write TypeScript, and the server would compile it to JavaScript with esbuild's Go API when it serves a page or loads an actor, caching each file by its content hash.

**Status: parked.** On 2026-11-16 the person asked for a ticket that remembers the idea; SLOP3-023 goes on in JavaScript. The notes in `reference/01-notes-typescript-through-esbuild-on-the-server.md` hold what is known; the full design is a task.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- architecture
- goja
- apps
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
