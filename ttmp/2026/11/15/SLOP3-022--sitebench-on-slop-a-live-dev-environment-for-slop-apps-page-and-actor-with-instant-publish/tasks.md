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
- [x] A status that does not activate, for preflight (kernel.Peek, app.status peek)
- [x] Close embeds (workshop.closeEmbed; frames close their old view on reload)
- [x] Codex on #47 (4) and #48 (4) fixed
- [ ] Bench Phase 6: proposals on refs, history on snapshots
- [ ] closeEmbed (free views when frames reload)
- [ ] Follow-up, design needed (not started): the agent sees screenshots of its frames. Write-up: design-doc/02-follow-up-the-agent-sees-screenshots-of-its-frames-design-needed.md <!-- t:6q5p -->
- [ ] Future (research later, not now; user, 2026-11-16): scratchpads with repeatable scripts for the coding agent: scripts it writes once, keeps with the project and reruns, e.g. a solver it uses to solve and check puzzles in the sudoku example. Starting points to look at then: the eval's scratch space (ctx.scratch), the project library runEval loads into the sandbox (libEntries), and the Scenarios panel. <!-- t:ia46 -->
- [ ] Bench gap, design needed: a first publish leaves the app unreachable ('no production instance yet: nothing serves main'); today the person needs the CLI (slop mount set <host> /<app> <app>; slop grant set <app> @guest view to make it public). /f/:id serves only type: release stores. Option: a generic route for app stores at main (like /f/:id), so publishing gives a URL at once; the publish dialog shows it and who can see it (grants), with a 'make public' choice. <!-- t:ltcr -->
- [ ] Bench: temporary dev link (user, 2026-11-16: 'generate temporary dev link so anybody can access the app under development for testing … goes down when I close the dev session / after a timeout'). Proposal: (1) one generic route on the live host for dev-instance stores, e.g. /d/:id, set once by deploy-apps like /f/:id, serving only dev instances; (2) a share link on <app>-dev-<user> (link.new, level interact) opened as /d/<dev store>?k=<token>; guests are created on redeem, and link grants die when the link does (access.deadLink); (3) a lease: link.new takes minutes (today only days), plus a link.extend verb; the bench extends it every minute to now+15 min while open, 'Stop sharing' revokes it (link.rm), and a hard cap of a few hours stops a forgotten tab from holding it open; (4) a 'Dev link' button with copy/QR, time left and Stop sharing. Testers share the dev instance's data (Reset dev data clears it). Not using emb_ embed tokens: they carry the person's full authority. <!-- t:hm4w -->
- [ ] Bench gap: replies end mid-step at slop's 10-round cap per sample call (pkg/llm/gepp/sample.go). Continue automatically (or say so and offer a Continue button); a bare 'continue' from the person let the agent widen the scope. <!-- t:28ip -->
