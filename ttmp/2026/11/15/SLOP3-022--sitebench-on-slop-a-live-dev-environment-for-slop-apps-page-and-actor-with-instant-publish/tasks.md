# Tasks

## TODO
- [x] Ticket, unzip sources (git-ignored) and manifest
- [x] Analysis: agent + sandbox, workbench UI, slop surface (three readers with diaries)
- [x] Stage 0 experiment: Sitebench dist as a slop app on a local server
- [x] Guide: analysis, design, implementation plan for an intern
- [x] Second pass: review notes, revision, consistency read
- [x] Upload the guide to reMarkable (/ai/2026/11/15/SLOP3-022)

## Implementation (branch task/slop3-022-dev-loop)
- [x] C.3 ref.move --ifAt (compare-and-swap) and `from` in the result
- [x] C.2 files.push --activate (instances report n and broken)
- [x] C.4 workshop dev instances: newStore, logs, restart, doc/docs, sql, importDocs/importTable, guarded drop
- [x] C.1 embedded views: workshop.embed, /e/<token>/ sandbox route, frame-ancestors, probe + instrument for dev embeds, renew (browser-checked: push → frame 291 ms)
- [x] C.5 slop dev <dir> --app (poll, push to draft --activate, logs)
- [x] Commit Sitebench's source (user approved): web/bench → apps/bench, stamped build
- [x] Bench Phase 1: projects are app stores (actor apps/open/read/sync/create; Sync to draft)
- [x] Bench Phase 2 (page): canvas frames are embedded dev views; Sitebench's PROBE served by slop
- [x] Bench Phase 3: actor status and logs in effects and Console; outside pushes merged; reset dev data (kernel: forget a deleted store's caches)
- [x] Bench Phase 4a: the agent's API for slop apps (prompt section, app.* verbs, data.* refused, headless embeds)
- [ ] Bench Phase 4b: fixtures and scenarios on run instances
- [x] Bench Phase 5: publish from the bench (preflight, approve, rollout, rollback; agent publish.check/run behind approval)
- [ ] Offer a mount after an app's first publish
- [ ] A status that does not activate, for preflight
- [ ] Bench Phase 6: proposals on refs, history on snapshots
- [ ] closeEmbed (free views when frames reload)
