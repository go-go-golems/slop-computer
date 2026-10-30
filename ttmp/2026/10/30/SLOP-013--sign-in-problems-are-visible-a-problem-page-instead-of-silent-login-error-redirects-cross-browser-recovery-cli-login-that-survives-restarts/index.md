---
Title: 'Sign-in problems are visible: a problem page instead of silent login_error redirects, cross-browser recovery, CLI login that survives restarts'
Ticket: SLOP-013
Status: active
Topics:
    - auth
    - backend
    - frontend
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://cmd/slop/cmds/auth.go
      Note: pollDevice quits on 5xx
    - Path: repo://pkg/server/auth.go
      Note: login and callback redirect failures to /?login_error=
ExternalSources: []
Summary: 'Make sign-in failures visible and recoverable: one problem page instead of silent /?login_error= redirects, destination recovered from the flow row, failures logged, and a CLI device login that waits through server restarts.'
LastUpdated: 2026-10-30T15:40:57.668907485-04:00
WhatFor: Landing page for SLOP-013
WhenToUse: Start here for sign-in and device-login failures
---

# Sign-in problems are visible: a problem page instead of silent login_error redirects, cross-browser recovery, CLI login that survives restarts

## Overview

A failed browser sign-in redirects to `/?login_error=<code>`, which nothing reads; the Workshop then signs the person in again silently and their destination (for example `/device?code=…`) is lost. The CLI's device login also quits on a transient 503. This ticket designs a sign-in problem page with a *Continue signing in* button, recovery of the destination from `login_flows.return_path`, failure logging, and a poller that waits through restarts.

Status: design written; implementation not started.

## Key Links

- **Intern guide (start here)**: [design-doc/01-intern-guide-sign-in-device-login-and-their-failures.md](./design-doc/01-intern-guide-sign-in-device-login-and-their-failures.md)
- **Diary**: [reference/01-diary.md](./reference/01-diary.md)
- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- auth
- backend
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
