---
Title: Diary
Ticket: SLOP3-002
Status: active
Topics:
    - architecture
    - goja
    - access
    - tools
    - agents
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of SLOP3-002: the design guide and the implementation of phases W1 to W8."
LastUpdated: 2026-11-01T16:20:14.512508729-05:00
WhatFor: "Reviewing what was built in SLOP3-002, why, and what failed along the way."
WhenToUse: "When resuming SLOP3-002 or reviewing one of its commits."
---

# Diary

## Goal

This diary records the work on SLOP3-002: making slop v3's tools (the back
office, a v2-style Workshop) into ordinary apps by giving trusted apps Go
modules that act as the visiting person. Each step follows the
investigation format: what was asked, what was done, what failed, and how
to review it.

## Step 1: The ticket and the design guide

The ticket and its intern guide come first. The guide
(`design-doc/01-tools-as-apps-design-and-implementation-guide-for-interns.md`)
has five parts: slop v3 in the detail the change needs (Part I), the
problem (Part II), eight primitives (Part III), the back office and the
Workshop as apps (Part IV), and the threat model, phases W1 to W8 and the
test approach (Part V). It was uploaded to reMarkable as "SLOP3-002 Tools
as apps guide" in `/ai/2026/11/01/SLOP3-002`.

### Prompt Context

**User prompt (verbatim):** "Ok, create a new docmgr ticket, and Create  a
detailed analysis / design / implementation guide that is for a new
intern, explaining all the parts of the system needed to understand what
it is, with prose paragraphs and bullet point sand pseudocode and diagrams
and api references and file references. It should be very clear and
technical. Store in the ticket and the nupload to remarkable. Then
implement, commit at appropriate intervals and keep a detailed diary as
you work (using the diary format from the skill)"

The request follows a discussion in which the user proposed, in order:
porting the Workshop against store snapshots; making the Workshop itself
an app; managing permissions through an app; and finally (verbatim) "making
it possible to configure go-side go-go-goja modules to be mounted into an
app, and one of these modules is to deal with the system itself (instead
of exposing the system as a store to be manipulated with the generic store
stuff), so that we have audit and control and don't expose the lower-level
data, while keeping the flexibility of writing JS code."

**Assistant interpretation:** Write the guide for the design discussed
(trusted Go modules for actors, a system module, a workshop module and the
supporting primitives), then build it in phases with a commit and a diary
step per phase.

**Inferred user intent:** Tools should be pushed and versioned like apps,
so that variants can be built (by agents too) without changing the server,
while every platform change stays audited and checked.

### What I did

- `docmgr ticket create-ticket --ticket SLOP3-002 --title "Tools as apps: Go modules for actors, the Workshop and the back office as apps" --topics architecture,goja,access,tools,agents`
  (the topic `tools` was added to the vocabulary).
- Read the code the guide cites to get names and line numbers right:
  `pkg/actor/modules.go` (`Actor.module`), `pkg/server/platform.go`,
  `pkg/actor/manager.go` (`react`, `selects`, `_cursors`),
  `pkg/kernel/apps.go` (`Running`, `app_ref`), `pkg/verbs/verb.go`
  (`Verb`, `Call`), `pkg/verbs/mounts.go` (`needCodeRight`),
  `pkg/system/system.go` (`Log`, `Change`), `pkg/server/views.go`
  (`label`, `rpcTable`), `pkg/server/assets/shell.js`, and v2's
  `pkg/render/assets/bridge.js` and Workshop bridge protocol.
- Wrote the guide: 29 sections, two mermaid diagrams, a verb table with
  arguments taken from the verb definitions, pseudocode for `actAs`, the
  module tables, the preview label scheme, the confirmation sequence, the
  Workshop thread schema and ASCII screens.
- Added tasks W1 to W8 and a changelog entry; uploaded the guide.

### Why

- Verbs remain the only way to change the platform. A module function is a
  named verb call made as the visitor, so access checks, D9 and the audit
  log apply without new code paths (guide section 13).
- Trust is separate from the policy matrix, because an app that can set
  policy through the system module could otherwise grant itself trust.

### What worked

- `remarquee upload bundle … --non-interactive` returned
  `OK: uploaded SLOP3-002 Tools as apps guide.pdf -> /ai/2026/11/01/SLOP3-002`.

### What didn't work

- The first `Write` of the guide failed with "File has not been read yet.
  Read it first before writing to it." because docmgr had created the file
  and the editor tool requires a read before overwriting. Reading it and
  writing again worked.
- `slop verbs -o json` lists verbs under the key `verb` with no arguments,
  so the argument table was built from the `Args` in `pkg/verbs/*.go`
  rather than from the CLI.

### What I learned

- `_cursors` already has a `source` column, set to `'self'` everywhere, so
  following the system log needs no schema change to stores.
- `Kernel.Running` already honours a store's `app_ref`; only a verb to set
  it is missing. Draft instances are therefore a small change.

### What was tricky to build

- Previews. Sites written for a root use absolute paths (`/_slop/page.js`,
  `/_data/…`), so a preview cannot live under a path prefix. Giving each
  preview its own sandbox origin, with the label as the capability, solves
  both that and the privacy of unpublished snapshots.

### What warrants a second pair of eyes

- The confirmation rule that an approval stays valid for the same
  (person, view, call) for two minutes rather than being consumed on use.
  It makes multi-call actions work with retries; it also means a page can
  repeat an approved call within that window.

### What should be done in the future

- Decide whether `platform` becomes a trusted module, and whether the
  contract's `comments` capability is backed by Workshop threads (guide
  section 29).

### Code review instructions

- Read the guide's Part III and Part V; compare the verb table in section 4
  with `pkg/verbs/*.go`.

### Technical details

- Ticket path:
  `ttmp/2026/11/01/SLOP3-002--tools-as-apps-go-modules-for-actors-the-workshop-and-the-back-office-as-apps/`.
