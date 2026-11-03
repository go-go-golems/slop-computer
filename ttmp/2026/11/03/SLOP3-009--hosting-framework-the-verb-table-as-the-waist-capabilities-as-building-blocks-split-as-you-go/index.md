---
Title: 'Hosting framework: the verb table as the waist, capabilities as building blocks, split as you go'
Ticket: SLOP3-009
Status: active
Topics:
    - architecture
    - hosting
    - backend
    - agents
    - llm
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources:
    - https://claude.ai/artifact/72YeAqz5yR2ViWbCeQ3ESs
Summary: "Target shape for slop-computer as a reusable artifact-hosting framework: the verb table as the narrow waist, doors as projections, capabilities and domains as packages, Go types → JSON Schema for verb descriptions, and a split-as-you-go plan."
LastUpdated: 2026-11-03T13:31:20.61987015-05:00
WhatFor: "The package map, dependency rules, verb description format and order of work for reorganizing slop-computer."
WhenToUse: "Before moving code between packages, adding a capability or door, or changing verbs.Verb."
---

# Hosting framework: the verb table as the waist, capabilities as building blocks, split as you go

## Overview

SLOP3-009 records how slop-computer's code should be organized so its parts can be reused to host artifacts: the claude.ai contract runtime, `db` over SQLite stores, `sample` with budgets, sign-in, and the verb table. It started as a design brainstorm after SLOP3-008 (PR #20) and is now the map that feature work moves code toward.

- **Design:** [design-doc/01-slop-computer-as-a-framework-for-hosting-artifacts.md](design-doc/01-slop-computer-as-a-framework-for-hosting-artifacts.md)
- **Diary:** [reference/01-diary.md](reference/01-diary.md)
- **Brainstorm artifact:** <https://claude.ai/artifact/72YeAqz5yR2ViWbCeQ3ESs> (source: `various/01-hosting-framework-artifact.html`)

Decided: the verb table is the one place an operation exists; verbs are described by Go types turned into JSON Schema with `x-slop` keywords (glazed generated for the CLI, protobuf deferred); modularity is packages and plugins now; split as you go, in the order of design §11. Nothing in the code has moved yet: step 2 (a typed-verb spike) is next.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- architecture
- hosting
- backend
- agents
- llm

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
