# Changelog

## 2026-11-07

- Initial workspace created

## 2026-11-07

Ticket created: design doc 01 for the eight Codex findings on the SLOP3-016 PRs (F1–F8, by root cause), task list, diary step 1.

## 2026-11-07

Step 0 (#38 merged into #39's branch, c61574c); F2+F3 (c5f5933); F1 P1 actor-owned app registration (5ac4b14). Diary steps 2-4.

## 2026-11-07

F7 read-time defaults (b7d7316); F6 steps.js step table with differential test (15911c4); F4 dispatch token (a1b2efe); F5 verb cache per server URL (71a0a72); F8 watched promises in actor turns (46207f0). Diary steps 5-8.

## 2026-11-07

Browser pass on a local server (F1, F2, F6, F7 confirmed in page and frames; screenshot in various/). #39 retargeted to main and rewritten; #36, #37, #38 closed; @codex review requested on #39. Design doc §13 As built. Diary steps 9-10.

## 2026-11-07

Codex review of consolidated #39: P1 (frames got the viewer's private meta) fixed in b31910f; P2 (framed writes not visible to the next call) fixed in 8288aa7 with an acknowledged optimistic copy; second review requested. Diary step 11.

## 2026-11-07

Codex second review of #39: Boards page guest prompt (4952b17) and board drags into framed apps' dropzones (4572aee) fixed and checked in the browser; third review requested. Diary step 12.

## 2026-11-07

Codex third review of #39: collection steps in the frame's optimistic copy (6db52e7) and frame sync on the page's own mutations (3ddb939); fourth review requested. Diary step 13.

## 2026-11-07

Codex fourth review of #39: version numbering after unregister fixed (158341f). Review rounds 1-4 summarized in diary step 14.

## 2026-11-08

Security: Pinboard's editor describes and registers source in a probe frame, never in the page; evalSource runs built-in apps only (183217e, diary step 15)

## 2026-11-09

#42 merged (05961e9). Pinboard deployed on slop.yolo for the first time: the pinboard store (sample and assets on for @member), the /pb/:id createApp mount, and pinboard-home at /boards; a CLI smoke board passed and was removed (diary step 16, logs in various/pinboard-deploy-2026-11-09/)
