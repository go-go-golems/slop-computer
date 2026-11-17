# Devon — the board keeps growing (devon3)

## Step 1: Get back to my own board
I want to pick up my kanban board app where I left off, in the same long thread — I'm deliberately trying to see whether a long conversation holds up this time.
**Did:** `benchdrive devon3 help`, then `look`, then `open-app devon-kanban2`
**Expected:** my board app with two frames (Window A / Window B) and my thread.
**Happened:** The bench had opened on some other app ("Food Bank Shift Sign-up aisha-shifts") — not mine. `open-app devon-kanban2` brought mine up: Frame 1 "Window A (you)", Frame 2 "Window B (teammate)", and Claude was still "working for 54 min 15 s" on my last message (the race test).
**Felt:** relieved to find it, but that 54 minutes is a bad sign.

## Step 2: Is the thread even alive?
The chat was stuck on "Working for 54 min … Summarizing 6 earlier messages…". Last session this is exactly how the thread died, so I was ready to call it.
**Did:** `wait 20`, `wait 60`, `click "Stop"` (not there), `shot s1.png`, `key Escape`, then `ask "Hey - are you stuck? ..."`
**Expected:** after the poke, either a short "the thread is too big" or an answer.
**Happened:** it answered — the race test had actually been run: "Window A: MOVE-RESULT: ok, card #2 -> doing" / "Window B: MOVE-RESULT: conflict — card #2 was moved by someone else — showing their change", row version 2→3, count 2→2. Draft 33 → 35. Console showed MOVE-RESULT and PROBE-ENV lines.
**Felt:** whiplash. The screen said "working" for an hour and it was actually done. I nearly gave up on a working thread.
STRUGGLE: no Stop button anywhere on screen, and no way to tell "stuck" from "finished but the bubble never cleared".
STRUGGLE: the "working for 56 min" timer lies — it kept counting on a finished job.

## Step 3: Read the code so I know what I'm building on
Before asking for anything I reread what's there: types.ts (Card has id/title/owner/column/version/movedBy/movedAt; BoardEvent is moved|added) and actor.ts (123 lines; `list`, `add`, `move` with compare-and-set on version).
**Did:** `view Code`, `click types.ts`, `read 1 90`, `click Files`, `click actor.ts`, `read 1 70`, `read 71 123`
**Expected:** the same three actions I had, no surprise drafts.
**Happened:** exactly that. Draft 35, 0 issues, types ok. move still does `UPDATE ... WHERE id = ? AND version = ?` and fails `conflict`.
**Felt:** good, I can hold this in my head. Ready to add on top of it.

## Step 4: Feature 1 — assignees
I want cards to have an assignee, picked only from people who've really opened the board. Server-side or it doesn't count.
**Did:** `ask "Feature 1 of 4: card assignees. ..."` then `wait 150`, `wait 150`, `reply`
**Expected:** a roster table, an assign action, an assign menu on each card, one scenario, type count 0.
**Happened:** 6 min 10 s. Draft 35 → 39. New sql/004_assignees.sql, new scenarios/assign-card.json. Reply claims: roster records everyone who opens the board, per-card assign menu ("Unassigned" + roster), server refuses unknown names (actor.ts:171), 0 type errors, 3 scenarios pass, and it made assign-card fail on purpose once to prove it can. It also admits it left probe console.logs in main.ts and cleaned them up, and that one eval got cut off by a limit before committing.
**Felt:** genuinely good work — but the "eval got cut off by the limit" line is the exact smell from last time.
STRUGGLE: every turn is 6+ minutes and I have no progress bar, just "Working · draft 37".

## Step 5: Does feature 1 actually hold up?
I don't take "it works" on trust, so I checked the code and pushed it through the two windows myself.
**Did:** `read 140 200` (actor.ts), `frame-text 1`, `frame-text 2`, `frame-type "select.assign" "admin" 1`, `frame-text 1`+`2`, `frame-type "select.assign" "" 2`, `view Scenarios`
**Expected:** the assign action really refuses unknown names, and a change in Window A shows in Window B.
**Happened:** actor.ts:171 really is `SELECT name FROM visitors WHERE name = ?` → `invalid_argument: <name> has not opened this board`. After assigning in Window A, BOTH frames read "Maya — assigned to admin" and both selects showed "admin"; clearing in Window B cleared both. Scenarios: assign-card ✓ (8 steps, fixture "board"), kanban-flow ✓, move-existing ✓.
**Felt:** that's the first time a claim of his has survived my own hands without a wrinkle. Fine, I trust this one.

## Step 6: Feature 2 — WIP limits, and the hole I care about
A limit per column that the server enforces. The bit I actually care about: no SELECT-count-then-UPDATE, because that's a TOCTOU hole and two people racing for the last slot would both get in.
**Did:** `ask "Feature 2 of 4: a WIP limit per column... check must not be a SELECT count and then an UPDATE in a separate step ... prove it by firing both moves at once"`, `wait 150` x2, `reply`
**Expected:** an atomic check, a refusal with a readable reason, a scenario, and two-move proof.
**Happened:** 10 min, draft 39 → 46. New sql/005_wip_limits.sql (column_limits table, seeded todo 5 / doing 2 / done 99), fixtures/wip-full.json, scenarios/wip-limit.json. It says the check rides inside the same UPDATE (actor.ts:133-136). Race: Window A ok, Window B refused "Doing is full (2/2)", Doing = 2/2 after. 0 type errors, 4 scenarios pass, wip-limit made to fail once on purpose. It also said its own eval got cut off by a limit mid-scenario-write and the scenario file silently did not commit — it caught it.
**Felt:** the "write never committed" bit is precisely how I lost an hour last time, so at least it's checking now. But it also left a README line undone and told me to send a message to finish it.
STRUGGLE: a turn can hit its budget mid-file-write; nothing on screen tells me a write was lost.

## Step 7: I check feature 2 with my own hands, and find a wrinkle
**Did:** `read 110 165` (actor.ts), `frame-text 1`, added a card "WIP probe" (fumbled: clicks did nothing in Select mode, then nothing again because the Owner input is `required`), read index.html, set Doing's limit to 0 with `frame-type "input[aria-label='WIP limit for Doing']" "0" 1`, then `frame-click "[data-move=doing]" 2`
**Expected:** the server, not the page, says no.
**Happened:** the UPDATE really is one statement: `WHERE id = ? AND version = ? AND (SELECT count(*) FROM cards WHERE status = ? AND id != ?) < coalesce((SELECT max_cards FROM column_limits WHERE name = ?), 999)`. Live: the other window got "Doing is full (0/0) — move a card out first" and the card stayed put. Also: Done's seeded limit is 5, not the 99 it claimed.
**Felt:** the enforcement is exactly the shape I asked for — I'm impressed. The little UI stuff is where it wobbles.
STRUGGLE: typing into the WIP limit box leaves the header reading "Doing 0/2" with the box showing 0, then later "Doing 0/0" with the box showing 2 — the tally lags one render behind and the box never re-syncs to the server's number.
STRUGGLE: clicking "Add" just did nothing, twice, with no message; the Owner field is `required` and the browser refused silently. If I hadn't read index.html I'd have called that a bug.
STRUGGLE: there's no way to delete a card in the app, so my "WIP probe" card is stuck on the board.

## Step 8: Feature 3 — activity log, plus my two complaints
**Did:** `ask "Feature 3 of 4: an activity log of the last 20 moves ... Two things from my own testing: 1. the WIP header bug 2. remove my 'WIP probe' card"`, `wait 150` x2, `reply`, `frame-text 1`, `frame-click "[data-move=doing]" 1`, `frame-text 2`
**Expected:** a log table, a panel, a cap, a scenario, and my two items handled.
**Happened:** 5 min 40 s, draft 46 → 51. New sql/006_activity.sql, fixtures/activity-full.json, scenarios/activity-cap.json, plus a README section. Moves only (its call, explained). My "WIP probe" card is gone ("No moves yet" panel, two cards, both Done). It says it fixed my header bug by serializing the loads ("an older fetch finishing late could paint stale numbers over fresh ones"). Live: moving a card in Window A put "admin moved “Write README” Done → Doing · 2:24:06 AM" in Window B's panel by itself.
**Felt:** good. The "I reproduced it, then found the actual race" is the kind of answer I wanted, not just "fixed".
STRUGGLE: the panel says "No moves yet — the last 20 will appear here" while the cards above it say "moved by admin 2:15:51 AM" — the log doesn't backfill history, so those two disagree on screen.

## Step 9: Feature 4, and the answer in short lines
**Did:** `ask "Last one, feature 4 of 4, and keep this turn SHORT. ... 3. what happens when two people move the SAME card at once? 4-6 lines"`, `reply`, `frame-text 1`, `frame-text 2`, `view Scenarios`, `click "Run all"`
**Expected:** short, and the three scenarios named.
**Happened:** 1 min 1 s this time — by far the fastest turn. Draft 51 → 52. New sql/007_done_unlimited.sql; Done now reads "Done 2" with no /5, both frames. Run all → "Notice: All 5 scenarios passed". The race answer came back in 5 lines (version column, one UPDATE with WHERE id AND version, first commit wins and bumps, second matches zero rows → "conflict", loser toasts and re-lists, both windows converge). Log starts empty by design (the "moved by" line is the older column, not the log).
**Felt:** that's the answer I wanted, and it's the same mechanism I read in the code. A 1-minute turn after 6-minute ones is a nice surprise.

## Step 10: Beyond the brief — a delete button (I kept hitting the wall)
My "WIP probe" card only came off the board because the agent ran raw SQL. I want a real delete, and I want to know if this thread is going to die on me again.
**Did:** `ask "Beyond the four: I keep needing to delete a card and the app can't. ... And answer this in two lines: how full is this thread now, and what happens to it when it hits the limit?"`, `reply`, `view Scenarios` + `click "Run all"`, `frame-type title/owner` + `frame-click "Add"` + `frame-click "✕"` + `frame-click "Delete?"`
**Expected:** a confirm-style delete that pushes to the other window, a scenario, and a straight answer about the thread.
**Happened:** 2 min 26 s, draft 52 → 56, scenarios/delete-card.json added, 6/6 on run all ("Notice: All 6 scenarios passed"). Live: I added "delete me" in Window A, clicked ✕ → it read "Delete?", clicked again → gone from BOTH windows, To do 0/5. The thread answer: "this thread is near its limit — the early messages are already folded into a summary, and my per-turn tool budget shrank as history grew. When it's exhausted the chat can't continue: the app is safe, but you'd open a fresh thread with no memory of this conversation."
**Felt:** the delete is exactly what I wanted, and it's the honest answer about the thread I was afraid to hear. But it also answered my goal's real question: a long session holds only so long.
STRUGGLE: the ✕ arms for 4 seconds; my second click came too late and it just went back to ✕ with no hint that the arm had timed out. I had to do both clicks in one go to make it stick.
STRUGGLE: card rows have no label on the ✕ / ← / → buttons in the accessible text — three identical "✕" with nothing saying which card.

## Verdict
**Did I get what I wanted?** Yes, all four: assignees from people who've opened the board (server refuses strangers), a per-column WIP limit enforced inside a single atomic UPDATE, an activity log of the last 20 moves with the oldest falling off, and a scenario for each (6/6, plus delete). And I got the short-lines answer I asked for: version column, one guarded UPDATE, first commit wins, the loser gets "conflict" and re-lists, both windows converge. Nothing I tested contradicted a reply, which is the thing that went wrong last time.
**Hardest moment:** the first hour of this session, when the chat sat on "Working for 56 min · Summarizing 6 earlier messages…" on a job that had actually finished. I nearly wrote the thread off.
**Would I come back?** Yes. The long thread did hold — four features in — but it told me plainly it is near the end, so I'd start the next body of work in a fresh thread and keep the README as the handover.
**Three struggles that mattered most:**
1. No way to tell "stuck" from "finished but the bubble never cleared", and no Stop button anywhere — the working timer kept counting on a finished job.
2. Turns hitting their budget mid-write, silently: twice a file write did not commit and once a scenario write was lost; only his own re-check caught it, nothing on my screen did.
3. The small UI stuff was where I couldn't tell "bug" from "me": Add silently refused because Owner is `required`, the WIP box lagged the header, the ✕ arm times out in 4 s without saying so.
**Type count and scenarios at the end:** 0 issues / types ok on draft 56, 6/6 scenarios, published copy still at 15 (my call, not done).
