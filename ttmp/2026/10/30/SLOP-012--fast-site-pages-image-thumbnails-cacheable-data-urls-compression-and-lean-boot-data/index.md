---
Title: 'Fast site pages: image thumbnails, cacheable data URLs, compression and lean boot data'
Ticket: SLOP-012
Status: complete
Topics:
    - architecture
    - backend
    - routing
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/render/assets/runtime.js
      Note: window.slop data API and the new helpers
    - Path: repo://pkg/server/kernel.go
      Note: serveBlob, becomes serveFile
    - Path: repo://pkg/server/serve.go
      Note: serveSite, serveData, records, writePage
ExternalSources: []
Summary: 'Make site pages fast and correct: three cache classes decided by what a URL names, ?w= thumbnails on any image URL, gzip for text, and data bindings as cacheable scripts.'
LastUpdated: 2026-10-30T18:54:59.397386808-04:00
WhatFor: Landing page for SLOP-012
WhenToUse: Start here for site performance and caching
---

# Fast site pages: image thumbnails, cacheable data URLs, compression and lean boot data

## Overview

The storefront on the test cluster (`site.slop.yolo.scapegoat.dev/`) loads slowly: 76 MB of full-size covers, a 670 KB uncompressed `no-store` HTML page that inlines 664 KB of data (three bindings unused), and `main` data URLs revalidated on every visit. Page-relative files such as `/boutique.css` are also cached `immutable` for a year at a URL that does not change (a correctness bug). This ticket designs one consistent fix: cache classes by what a URL names, `?w=` thumbnails, gzip, and data as content-addressed scripts.

Status: design written; implementation not started. Open questions are in the guide, section 14.

## Key Links

- **Intern guide (start here)**: [design-doc/01-intern-guide-serving-site-pages-fast.md](./design-doc/01-intern-guide-serving-site-pages-fast.md)
- **Diary**: [reference/01-diary.md](./reference/01-diary.md)
- **Measurement**: [scripts/01-measure-site.py](./scripts/01-measure-site.py)
- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- architecture
- backend
- routing
- performance

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
