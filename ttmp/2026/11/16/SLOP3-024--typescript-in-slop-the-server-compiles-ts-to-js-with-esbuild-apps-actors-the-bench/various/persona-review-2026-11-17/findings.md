# Persona review findings (working list)

## Round 1 (deepseek-4.1-flash medium, personas and bench agent)
- [harness] new-app needed the template name up front (sam). Fixed in benchdrive: new-app <id> without a template lists them.
- [bench] Template names and blurbs are jargon for non-programmers: "actor", "SQL" (maya, step 2).
- [bench, from benchdrive build] "Page and actor" template showed usr_… ids: app.json lacked the profile scope. Fixed in the worktree (not yet pushed to the review server).
- [bench, from benchdrive build] A reload shows draft, not the agent's open proposal; only the Review badge hints at the change.
- [bench, from benchdrive build] A question in Proposal mode makes a proposal and discards it ("… was discarded" in the chat).
- [agent, from benchdrive build] Replies use internal names: "proposal/mwk3…", "the prop instance".
- [agent, from benchdrive build] First eval shadowed the files API: const [info, files] = … → ReferenceError.
- [bench/agent] A turn can end with eval steps and no reply text: maya saw "green ticks everywhere but my page looks the same" and could not tell if it was done (maya, step 3).
- [bench] Changes land in a proposal; nothing tells a non-programmer to look at it and accept it. maya guessed "Accept all" (maya, step 4).
- [bench] Two turns in a row with nothing visible changing for maya (step 5): changes in a proposal while she looks at draft? To check in her diary.
- [bench] Clicking in the app frame selects an element (Select mode); Play mode had to be discovered (priya, step 3).
- [bug?] Submit does nothing in the proposal's preview of the quiz: no score, no error (priya, step 3). Reproduce.
- [agent] Leaderboard shows "Admin" (the visitor's name) rather than a student's first name: all students are the same account here; also how names are captured (priya).
- [bench] A stale "has no action \"list\"" error from the page before the new code loaded stays red in the Console after the page moved on (sam, step 3): errors from an earlier version of a frame should be marked as such or cleared.
- [bench] Data view had no way to see a proposal's preview data: it listed draft's tables (sam, steps 4-5). FIXED in worktree: Data follows the workspace (Proposal source).
- [harness] Dialog fields show as `Field "text"` in look, but `type text` does not find them (sam typed into the chat once). Fix benchdrive: accept the label look prints.
- [BUG, phase 3] Code view said "types ok" on a proposal's main.ts calling slop.actions.list, which the proposal's actor no longer has: declarations came from the dev instance (draft's actor) (devon, step 5; sam's "has no action list" is the same mismatch, a real error not stale). FIXED in worktree: declarations per ref, from the proposal's own instance.
- [not a bug] Priya's Submit "did nothing": the score appears below the fold of the 375×720 frame. Still: results below the fold look like nothing happened.
- [agent] Asked "how do I publish / how do I undo" twice, not answered (priya, step 4). Guide: answer workflow questions about the bench itself.
- [agent] Left a probe action in actor.ts and a deliberate `const all: never` in main.ts; "Empty completion" instead of an explanation (devon, step 6).
- [bench] Header "0 issues" while the Code footer says "1 type error" (devon, step 6): the header's issue count does not include type errors.
- [agent] Maya needed four asks before the page itself changed; the agent built "machinery" first (maya, step 7).
- [bench] '"<title>" was discarded' after a turn that changed nothing: the title is the person's message, so it reads as "your message was discarded" (sam, step 6; benchdrive build). FIXED in worktree: "Nothing in the app changed in this turn."
- [agent] Sam's three asks (fixture, scenario, a check shown going red) got nine evals, one failed app.sql, no reply text and nothing done (sam, step 6).
- [bench/agent] Many turns end without any reply text, or with "Empty completion" (devon 6, maya 3/5/10, sam 6). FIXED in worktree: gepp asks a silent model once, without tools, for its reply; the bench writes a summary from the evals if it still has none.
- [harness] Hand edits: `type code` replaces the whole file; no way to edit at a place (devon, step 9). Add `benchdrive edit <old> <new>` (an edit a person would type).
- [bench] "+ New" prefilled "about.html", so OK created it (devon, step 9). FIXED in worktree: the field starts empty.
- [agent] Never told Maya the kitchen code it put on her private list page (maya, steps 11-12).
- [agent] Never told Priya how to publish, accept or reject (priya, step 5): workflow questions about the bench go unanswered.
- [fixture] Quiz Submit with unanswered questions: the browser's "required" bubble is invisible in text, so nothing seems to happen (priya, step 5). The quiz's, not the bench's; harness could report validation bubbles.
- [bench] Canvas shares a dock tab group with Timeline; opening Timeline hides the canvas (priya, step 5). Layout; worth a hint.
- [bench] Scenario text checks are substring matches; a check passed on the wrong number (sam, step 7). FIXED in worktree: { text, exact: true } and { match: regex }; the guide says numbers use them.
- [agent] Left probe files/actions in the app (sam 7, devon 6). Guide: leave no testing debris.
- [bench] Header issues did not count type errors (devon 6). FIXED in worktree: header counts them; the issues menu lists them and jumps to the line.
- [BUG, server] The test instance's actor kept the deleted store's closed SQL connection after a reset: "sql: connection is already closed", scenarios ran once (sam). FIXED 5d0e593 (kernel OnDeleted → manager Restart).
- [bench] Unknown scenario step keys silently ignored (sam). FIXED 5d0e593: rejected with the keys the kind takes; sql steps get value and rows.
- [bench] After Publish nothing shows the live web address; "Share" does nothing (maya). Check the publish flow and the share button.
- [agent] "I'm not going to guess at the mechanism" when asked why the type check behaved as it did (devon).
- [agent] Test score rows came along into Priya's draft unannounced (priya).
- [bench] "+ New" scenario stub ({expect: 'h1'}) passes at once: a green tick that proves nothing (sam's "most dangerous thing"). FIXED: the stub fails until it checks something.
- [agent] Test data (Sofia, Emma, Noah, Admin) left in dev came along into Priya's published leaderboard. Guide: test data goes in the test instance; scenarios shown failing once.
- [agent] README left describing the old template app (sam). Guide: keep README true.
- [harness+bench] "Share" (the shell's, outside the bench frame) seemed dead: benchdrive does not see the shell's dialogs; and Share shares the bench, not the person's app — confusing (maya).

## Round 2 (personas mixed: glm-5.3-flash, glm-5.3 high, deepseek; bench agent glm-5.3)
- [harness] look/click show only the first 12 lines of a file; no way to read the rest (rosa). Add `benchdrive read [from] [to]` (scrolling, as a person would) — needs a daemon restart: round 3.
- [harness] `type code` replaces the whole file; rosa nearly destroyed index.html (recovered with Ctrl+Z). Steer to `edit`; make `type code` refuse without --replace.
