# Changelog

## 2026-11-01

- Initial workspace created

## 2026-11-01

Ticket, investigation script and intern guide (uploaded to reMarkable); tasks B1-B4

## 2026-11-01

B1: libraries (fold, site, render), req.base, rev(); TestBlocksSiteLibs (843de56)

## 2026-11-01

B2: live reader; TestBlocksSiteReader (bb18f4c)

## 2026-11-01

B3: static publishing, settings page, cross-origin rule for actor routes; TestBlocksSitePublish (d065c7c)

## 2026-11-01

B4: demo deployment, end-to-end script (16 checks), screenshots (29afe15)

## 2026-11-01

B5: uploaded files; bindings share uploads only with --assets (admin on target); {asset} route answers; TestBlocksSiteUploads (16fdc06, 6ef1ed5)

## 2026-11-01

Runtime: no thinking placeholder through onText (Blocks dropped the first 9 characters of every Claude answer) (d3c270b)

## 2026-11-01

Reader: en-US numbers in goja (toLocaleString threw), per-block failure isolation, stat/progress as Fruit (19a8f86)

## 2026-11-01

B6: deep links inside apps. The runtime mirrors the view's fragment into the address bar and the shell passes its own fragment in (fragments only, max 1024 chars); Blocks keeps its open page in the fragment via web/blocks/slop/deep-links.js (slop-computer PR #11). e2e 07 passes. v3 798c459.

### Related Files

- /home/manuel/code/wesen/2026-10-31--slop-v3/pkg/server/assets/shell.js — hash message and hashchange in the shell
- /home/manuel/code/wesen/2026-10-31--slop-v3/web/runtime/src/url.ts — fragment sync in the runtime
