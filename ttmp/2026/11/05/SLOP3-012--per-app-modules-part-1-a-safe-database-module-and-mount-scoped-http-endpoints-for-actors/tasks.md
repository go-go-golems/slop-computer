# Tasks

## TODO
- [x] Phase 1: database module over the turn (savepoint handles, array args, require resolution) <!-- t:r09g -->
- [x] Phase 2: express builder compiled into def.http <!-- t:ax00 -->
- [x] Phase 3: Mount.API policy (migration 011, validation, allowlist by containment, floors) <!-- t:4w0c -->
- [x] Phase 4: host middleware chain before MatchRoute (rateLimit, cors, methods, maxBody, apiToken) <!-- t:0muu -->
- [x] Phase 5 (part 2): module type, catalog and admin grants with config_json <!-- t:x8pk -->
- [ ] Confirm the guide's 15 decisions with the user <!-- t:2kn3 -->
- [ ] Separate ticket: the shared live-host origin (actor-route HTML on the live host; /_site same-origin calls) <!-- t:a47c -->
- [ ] Separate fix: filter actor response headers on non-API mounts (fetch redirects: done in phase 5c, 39b2daf) <!-- t:b4cu -->
- [ ] Follow-up: verbs.decodeArgs matches argument names case-insensitively (encoding/json); match exactly as module configs do <!-- t:vbbx -->
- [ ] Review: floors do not combine (an audience-only floor falls back to DefaultMin for the level; report-writer finding) <!-- t:f8pw -->
- [ ] Review: express ctx.body parsing depends on forwardHeaders including content-type (report-writer finding) <!-- t:4nwl -->
- [ ] Later: go-go-goja imports (goja version bump) and scoped modules such as bleve <!-- t:uwr5 -->
