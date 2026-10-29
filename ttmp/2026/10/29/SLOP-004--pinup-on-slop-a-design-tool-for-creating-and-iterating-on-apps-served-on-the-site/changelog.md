# Changelog

## 2026-10-29

- Initial workspace created

## 2026-10-29

Pinup copied to web/pinup (91c42b3, byte-identical build); intern guide written and uploaded (/ai/2026/10/29/SLOP-004)

## 2026-10-29

Phases 1–2 implemented (6de88a3, f87ad27, ef8a8d2, 2f1f2b9, ea9c141); verified end to end on the local server

## 2026-10-29

PR #3 review fixes (2fe5f5a): the docs stream catches up from the table when an event skips a rev (no lost revs when writers publish out of order); DeleteDoc takes the head lock first (no put/delete deadlock on Postgres). Tests TestDocEventsOutOfOrder, TestDocPutDeleteRace; diary step 4.

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/docs.go — docEvents catch-up on a rev gap
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/store/docs.go — DeleteDoc lock order
