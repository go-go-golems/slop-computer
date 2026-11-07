# Changelog

## 2026-11-07

- Initial workspace created

## 2026-11-07

Analysis and intern guide: Pinboard on slop (collaborative boards, apps as code with a trust model, page agent, sharing, app commands for CLI and MCP); prototype copied into sources/

## 2026-11-07

Guide uploaded to reMarkable: /ai/2026/11/07/SLOP3-016/SLOP3-016 Pinboard on slop intern guide

## 2026-11-07

Guide corrected: share links and the shell's Share dialog already exist (owners); createApp makes generated ids, many boards per person each with its own grants and links (§6.2.1); home page at /boards

## 2026-11-07

sources/: added the original HTML design document and a provenance README (checksums); the prototype's 9 files verified byte-identical to Pinboard.zip

## 2026-11-07

Guide §6.12 rewritten: app CLI verbs use go-go-goja jsverbs (verbs/*.js with __verb__ metadata; app.verbs/app.verb; lazy slop app / slop pb commands; store-scoped slop module; local and server invokers; MCP tools); JSON commands design superseded

## 2026-11-07

Design doc 02: migrating the actor VM to a go-go-goja engine runtime (difference table, six decisions, upstream U1-U4, phases, parity tests)

## 2026-11-07

Implementation: Pinboard phases 0-4 in PR #36, app verbs (slop on / slop pb, app.verb, MCP pb_* tools) in PR #37, actor VM phases 1-4 in PR #38 (engine behind actors.runtime; activation race fixed), go-go-goja#107 (U1-U4). Guide §13 and doc 02 §12 record where the implementation differs from the design; tasks checked with PR references.

## 2026-11-07

Phase 6 in PR #39 (stacked on #37): actor sample tools (Actor.Later; a tool call per turn), Pinboard's server agent (ask, board ask, pb_board_ask), log pruning alarm, apps written by other people in sandboxed frames (frames.js/frame.js); actor db orderBy nil crash fixed. Guide §13 updated; phase 6 task checked.
