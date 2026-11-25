---
Title: Diary
Ticket: SLOP3-026
Status: active
Topics:
    - documentation
    - cli
    - apps
    - agent
    - llm
    - deployment
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-24T18:41:24.30862646-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Make slop usable by an agent that has the binary and a login but no source:
Glazed help entries embedded in `slop` (`slop help <slug>`), plus the small
fixes found while testing on the DGX (design doc section 2, G1–G11).

## Step 1: Design, help wiring, the anchor page

The user asked, after the Pinboard agent port and the verb tests on the DGX:
"make a new docmgr ticket, and go through them all (write up a design doc), and
use glazed help entries. It should be possible pretty much for a LLM agent
without access to the source code to use the system perfectly and build apps,
set up verbs, interact with apps, etc..."

### What I did

- Ticket SLOP3-026 (topics `documentation`, `cli` added to the vocabulary), on
  branch `task/slop3-026-agent-docs` from `task/pinboard-agent-capability`.
- Design doc: the gap inventory (G1–G11), decisions (help in the binary, one
  source of truth, pages vs the generated verb reference), a page plan of 29
  slugs, code changes C1–C5, verification including an agent acceptance test.
- C1: `pkg/doc` embeds `topics/ tutorials/ examples/ applications/`
  (`all:` patterns, so empty dirs with `.keep` compile); `Root()` calls
  `setupHelp` → `help_cmd.SetupCobraRootCommand`. The root `Long` points at
  `slop-overview` and `agent-quickstart`. `pkg/doc/doc_test.go` parses every
  page (the loader drops bad frontmatter silently), requires Slug/Title/Short,
  unique slugs, no top-level `#`.
- Wrote `topics/01-slop-overview.md` myself (vocabulary for all other pages),
  checking each claim: groups nest guest ⊂ member ⊂ subscriber ⊂ admin plus
  `@store` (`sysdb.GroupsOf`); roles pending/member/admin/disabled; `push`
  moves `main`; pages reach the actor via `claude.use('slop').call(...)`;
  `explain can <store> [level]`.
- Six writer agents in parallel (clusters A–E, ports 18601–18606), each with
  its own server and credentials; shared rules in `reference/02-writer-brief.md`.

### What didn't work

- `go:embed` of a directory with only `.keep`: "contains no embeddable files";
  fixed with `all:` patterns.
- First build: missing `go.sum` entries for Glazed's help stack (glamour,
  bubbletea, modernc sqlite); `go get github.com/go-go-golems/glazed/pkg/help@v1.4.3`
  + `go mod tidy`. modernc registers driver `sqlite`, slop uses `sqlite3`: no clash.

### What I learned

- The binary grows from 78 MB to 92 MB with the help renderer and TUI.
- `doc/design/slop-v3.md` is behind the code (grant subjects are `@groups`,
  not `*signed-in`); writers are told to trust code over it.

## Step 2: Code fixes C2, C4, C5

### What I did

- C2 (G9): `cmds.Explain(err)` adds, to `unknown command "x" for "slop"`, how
  aliases are learned (`slop on <store> --help` once) and `slop help
  using-app-verbs`; `main` prints it. Test `TestUnknownCommandHintsAtAliases`.
- C4 (G10): SLOP3-025's `02-approve-device-login.mjs` takes `CHROME`, and both
  scripts load Playwright with `createRequire(import.meta.url)`, because an ES
  `import` ignores `NODE_PATH` (the old header's "playwright on NODE_PATH"
  never worked). New `03-pinboard-agent-e2e.sh/.mjs` there: ran green
  (`eval returned: "42"`, second message on the same session).
- C5 (G11): dgx-side-k3s `104ba6d`: recovery.md 4.5 (DNS token rotation,
  stuck challenges, expired orders, replacing `Issuing`) and
  `refreshAfter: 1m` on `cert-manager-digitalocean`.

### What didn't work

- `NODE_PATH=… node script.mjs` → `ERR_MODULE_NOT_FOUND: playwright`.
