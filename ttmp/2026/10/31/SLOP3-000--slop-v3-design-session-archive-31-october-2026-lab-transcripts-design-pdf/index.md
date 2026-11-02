---
Title: 'slop v3 design session archive (31 October 2026): lab, transcripts, design PDF'
Ticket: SLOP3-000
Status: complete
Topics:
    - architecture
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Frozen material from the 31 October 2026 session that designed slop v3: the in-browser lab, the session log and test runs, the design PDF (rev 37) and its diagram renders."
LastUpdated: 2026-11-02T17:45:50.980259181-05:00
WhatFor: "History: where the v3 design and its JS reference kernel came from."
WhenToUse: "Only for history. The current design is doc/design/slop-v3.md; the reference implementation is the Go kernel."
---

# slop v3 design session archive (31 October 2026)

The session of 31 October 2026 designed slop v3 in claude.ai and built an
in-browser lab: a JS kernel used as the executable specification. Its files
were imported into the repository root (`design/`, `lab/`, `transcripts/`,
`references/`) by cb8f428. They are archived here, unchanged, because:

- the Go kernel and its tests are now the reference implementation;
- the lab could not be rebuilt from the repository (it needs sqlite-wasm in
  `../vendor` and the Kiln CSS from the session's uploads), and `lab/dist`
  had drifted from `lab/src`;
- the PDF (revision 37) and the renders predate later edits to the design.

The design itself stays current at `doc/design/slop-v3.md`. The lab is
still published as the claude.ai "slop lab" artifact.

## Where things went

| Was | Now |
|---|---|
| `design/slop-v3-design.md` | `doc/design/slop-v3.md` (kept current) |
| `design/slop-v3-design.pdf`, `design/widget-renders/`, `design/WORKSPACE.md` | `sources/design/` |
| `lab/` | `sources/lab/` (its Kiln CSS also copied to `web/admin/src/kiln.css`) |
| `transcripts/` | `sources/transcripts/` |
| `references/repos.md` | removed (2026-11-02) |

`sources/design/WORKSPACE.md` describes the files with their old paths:
read `design/`, `lab/` and `transcripts/` there as `sources/design/`,
`sources/lab/` and `sources/transcripts/`.
