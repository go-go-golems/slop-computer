# Sam — operations lead, shipments dashboard

## Step 1: Find my way around the bench
I want a small dashboard of our shipments and I want to be able to check the numbers are right.
**Did:** `benchdrive sam help`, then `benchdrive sam look`
**Expected:** a fresh bench with my app
**Happened:** a different app was open (devon-kanban). Menu has New app…, views Agent/Canvas/Code/Data etc.
**Felt:** fine, just need to open my own thing

## Step 2: Make a new app
**Did:** `benchdrive sam new-app sam-shipments2 "Page with server code"`
**Expected:** an empty app I can build in
**Happened:** "New app sam-shipments2 (on draft; publish to make it visible)". Canvas shows a page with one field "Add an item" and an Add button. Files listed: actor.ts, sql/001_items.sql, main.ts, index.html.
**Felt:** good — there's real server code and SQL, that's the kind of thing I understand

## Step 3: Ask for the shipments app
**Did:** `benchdrive sam ask "I'm Sam, I run operations at a small warehouse. Each shipment has id, destination, weight kg, status packed/shipped/delivered, date. (1) a table of all shipments (2) a page showing counts per status and total weight shipped this week."`
**Expected:** a table and a summary page
**Happened:** Agent built it and left a *Proposal* ("6 files to review", Review tab shows Accept all / Reject). Canvas has two frames: "Shipments" (form: Destination, Weight kg, date field 2026-11-16) and "This week" (1 packed / 3 shipped …). Its note says it also made fixtures and scenarios, one for an empty week.
**Felt:** quick, but I don't trust those little numbers until I see the rows behind them

## Step 4: Check the numbers myself in the Data view
**Did:** `view Data`, clicked "shipments"
**Expected:** to see the raw rows
**Happened:** 5 rows — Bristol 30 packed, Leeds 120.5 shipped, Manchester 85 delivered, Plymouth 210 shipped (dated 2025-01-14), Exeter 12.5 shipped. Draft shows "No rows", the proposal instance has the rows.
**Felt:** good. By hand: 1 packed, 3 shipped, 1 delivered; this week = 30+120.5+85+12.5 = 248 → matches the 248 kg card. First time I trust it.

## Step 5: Ask for test data and an automatic check
**Did:** `benchdrive sam ask "...more test data, a few dozen shipments, including edge cases like a week with nothing in it... I saw a Scenarios tab that says 'No scenarios yet' and no fixtures — I want an automatic check that the counts and the week total on the page match what is actually in the table"`
**Expected:** a bigger fixture and something that checks the page against the rows
**Happened:** Agent went back and forth a long time. Admitted its earlier fixture/scenario saves never landed (an eval had died), said so plainly. Now: 35-row fixture "week-spread" with an empty week, an 18,000 kg oversize, a 22,000 kg kiln from ~10 months ago, an older-than-a-year row. Three scenarios: add-shipment, empty-dashboard, stats-match-table. Also warned "this week" moves with the calendar so fixed-date fixtures go stale.
**Felt:** a bit lost watching all that, but at least it told me when it had been wrong

STRUGGLE: Scenarios tab said "No scenarios yet" even though the agent had said it made them; nothing said the save had failed until I asked.

## Step 6: Run the checks myself
**Did:** `view Scenarios` (saw stats-match-table had a failed step "expect #rows tr:has-text("22000 kg")"), then clicked "Run all"
**Expected:** all green
**Happened:** "All 3 scenarios passed". Step lists show checks like `expect #rows tr count 35`, `sql SELECT COUNT(*) FROM shipments WHERE status='packed' = 11`, `expect #card-week .n has "18865 kg" (exactly)`, `expect #view-stats has "9 shipments since"`.
**Felt:** pleased they check SQL and the page against each other — that's the only kind of test I believe. But the first time I looked, one of those checks was red and then went green on a re-run after the agent changed something; I want to see the row it was complaining about.

## Step 7: My own SQL against the test data
**Did:** Data → Test instance → shipments (35 rows) → "SQL query…": `SELECT status, COUNT(*) AS n, SUM(weight) AS kg FROM shipments GROUP BY status`; then `SELECT COUNT(*) AS n, COALESCE(SUM(weight),0) AS kg FROM shipments WHERE date >= '2026-11-16'`; then `SELECT id, destination, weight, status, date FROM shipments WHERE weight >= 18000`
**Expected:** my numbers to match what the checks and page claim
**Happened:** delivered 13 / 26085 kg, packed 11 / 800.6 kg, shipped 11 / 20066.5 kg. The week (from Mon 2026-11-16): 9 rows, 18865 kg. Both match the scenario's SQL and the page cards (11/11/13 and 18865 kg, "9 shipments since"). The 22,000 kg kiln is id 30, dated 2026-01-15.
**Felt:** this is the part I actually trust — I wrote the query myself and got the page's numbers

## Step 8: Accept, then look at the big fixture on the real page
**Did:** Review → "Accept all" (Notice: Accepted 11 changes into draft 7), then Data → "Seed from fixture" → week-spread, then Play mode, clicked "Shipments" and "This week"
**Expected:** the page to look like the test data
**Happened:** seeded fine ("Seeded the dev instance from week-spread"), but the preview frame at first still said "No shipments yet — add the first one above." until I clicked in Play mode. Then 35-row table, and This week: 11 packed / 11 shipped / 13 delivered / 18865 kg / "9 shipments since Nov 16" — exactly my SQL.
**Felt:** good, but two surprises. The other preview pane (frame 2, "This week") still shows 0 / 0 / 0 / 0 kg.

STRUGGLE: After seeding, the page kept showing old data ("No shipments yet") until I happened to click around in Play mode. Nothing told me the preview needed a refresh.

STRUGGLE: I have two "This week" panes: one says 18865 kg, the other 0 kg. I don't know which one is the app.

## Step 9: Prove the check bites
**Did:** `ask "Before I rely on this, I need to know the check actually bites. Please break the week total on purpose ... run stats-match-table, and show me it goes RED, then put it back and show it green. (a) which of my two preview panes is my app? (b) what do I do when the fixed-date fixture goes stale, in plain steps, no code?"`
**Expected:** a red run, then a green run, and two plain answers
**Happened:** Agent changed actor.ts to count 8 days instead of since Monday, ran the check and quoted the failure: `✗ expect #card-week .n has "18865 kg" (exactly) — got "790 kg"`, with the data steps still passing. Then it restored actor.ts ("net change zero") and saved .agent/lib/refreshWeekFixture.js and a README section. I re-ran all 3 scenarios on the proposal → "All 3 scenarios passed". The reply then ended with "Tool conversation exceeds local context budget" — it never actually answered (a) or (b) in words.
**Felt:** that's the moment I started trusting it: I saw it go red on the right line and only the right line. Annoyed that the two questions got dropped.

STRUGGLE: The agent ran out of room mid-answer ("exceeds local context budget"), so I got the red/green demo but no answer to my two questions.

## Step 10: Accept and re-run
**Did:** Review → "Accept all"; then "Run all" in Scenarios on the proposal before accepting
**Expected:** everything still green after the restore
**Happened:** "All 3 scenarios passed"
**Felt:** okay

## Step 11: Two panes disagree — and the answer keeps getting cut off
**Did:** `ask "Which of my two This week panes is my app? And tell me in plain steps what I do when the fixture goes stale. Also 1 issue: table runs 17px past 375px — make it not stick out."`
**Expected:** a plain answer and a fix
**Happened:** 6 minutes of evals (some frames.text/layout evals errored), then the reply ended in a stray "code" fragment. No answer. But Frame 2 now reads 11 / 11 / 13 — so the 0/0/0 pane was just a stale copy of the app after I seeded the data. Overflow issue still open.
**Felt:** annoyed. Second time in a row the answer just stops. I still don't know the plain-steps answer for the week rolling over.

STRUGGLE: agent replies twice in a row ended mid-sentence ("exceeds local context budget", then a stray code fragment); nothing on screen told me the turn had been cut.

## Step 12: Read the README myself
**Did:** Code → README.md → "Open in Docs"
**Expected:** the plain-language notes
**Happened:** It says the week total is "shipments dated this week (weeks run Monday to today, every status counts — say the word if 'this week' should mean shipped only)". And for the fixture: "The week-spread dates are relative to the week it was generated in: when a week rolls over, regenerate them (lib.refreshWeekFixture in the bench) and re-run."
**Felt:** two useful things. (1) It spotted my wording was sloppy: I said "weight shipped this week" and it counted everything, packed included. (2) "Regenerate with lib.refreshWeekFixture in the bench" is not something I can do — I don't write code.

STRUGGLE: The instructions for the stale fixture tell me to run a helper "in the bench", which I have no idea how to do.

## Step 13: Ask for the shipped-only week total + the table width
**Did:** `ask "(1) week total only for status shipped or delivered, dated this week; show the check failing on the old number first. (2) fix the 17px table overflow. Don't touch the 35-row fixture numbers."`
**Expected:** a small change with red/green proof
**Happened:** 12 min 44 s, nine evals, several read/sql evals erroring, then the turn died mid-sentence again with a stray code fragment. "Nothing in the app changed in this turn." It did say "this week has 9 shipments — 3 packed (418 kg) and 6 shipped/delivered", and claimed "both panes show my proposal's preview ... 0s/empty" — but my frame 2 now reads 11/11/13, so that answer is out of date.
**Felt:** frustrated. Three turns in a row cut off, longest 12 minutes, and my change never landed.

STRUGGLE: long turns silently expire. Big multi-part asks get no result at all.

## Step 14: One-line change, and I check it myself
**Did:** asked for just the week-weight rule; the agent changed actor.ts:95 to `WHERE date >= ? AND status IN ('shipped','delivered')` (eval 3, +1 −1), accepted it (draft 12), ran all scenarios, then opened the page in Play mode.
**Expected:** page 18447 kg, and the old check to go red
**Happened:** My own SQL on the dev instance: `SELECT COUNT(*), SUM(weight) ... WHERE date >= '2026-11-16' AND status IN ('shipped','delivered')` → 6 rows, 18447 kg (18865 − 418 packed = 18447, consistent). The page now reads 11 packed / 11 shipped / 13 delivered / **18447 kg** / "6 shipments since". The Scenarios tab shows one red scenario (badge "Scenarios 1"); the other two are green (badge counts).
**Felt:** good — the change did exactly what I asked and nothing else, and the check noticed. This is the "red on the right line" proof I wanted, and I did not need the agent to show me.

## Step 15: The check must learn the new rule
**Did:** asked to update the check's own SQL and expected numbers to shipped+delivered, and to fix the 17px table overflow.

## Step 16: Accept, run everything, look with my own eyes
**Did:** Review → "Accept all" (draft 14), Scenarios → "Run all", then read the app's This week pane
**Expected:** 0 issues, three green, page still 18447 kg
**Happened:** header "0 issues", "All 3 scenarios passed". The This week pane reads 11 packed / 11 shipped / 13 delivered / **18447 kg** / "6 shipments since Nov 16" — same as my SQL (6 rows, 18447 kg) and the same as the other pane. The check's SQL and its card expectation now use shipped+delivered and 18,447 kg.
**Felt:** satisfied. I wrote the query, the page agreed, and I watched the check go red and back to green on the exact change I asked for.

## Verdict
**Did I get what I wanted:** Yes — a shipments table (id, destination, kg, status, date), a This week page with counts per status and the week's shipped weight, 35 rows of test data with edge cases (empty week, 18 t oversize, 22 t kiln from 10 months ago, 0.1 kg row, a row older than a year, an all-zero state), and an automatic check that compares every number on the page with SQL over the same rows. I verified the numbers with my own SQL three times and they matched.
**Hardest moment:** the three agent turns in a row that ran for 6–13 minutes and then stopped mid-sentence ("Tool conversation exceeds local context budget", then stray code fragments) with nothing changed. I had to chop my request into one tiny change to get anything done.
**Would I come back:** Yes, for the data + check side. I would keep asks to one thing at a time and I would never take the preview panes at face value — I would run the check and query the data myself. I would not want to depend on the agent for the weekly "refresh the fixture dates" chore.
**Three struggles that mattered most:**
1. Long turns dying silently, three times; a red/green demo and two questions were lost, and twice "nothing in the app changed".
2. Two panes of the same app disagreeing (11/11/13/18865 vs 0/0/0/0) because one was stale after I seeded the data, and the page itself saying "No shipments yet" until I clicked around. Nothing on screen said "refresh".
3. The stale-fixture instructions ("regenerate with lib.refreshWeekFixture in the bench") are not steps I can follow — I don't write code, so a fixed-date fixture that silently rots every week is a trap for me.
(Runner-up: the Scenarios tab said "No scenarios yet" after the agent had told me it made them; the saves had died in a failed eval and nothing said so until I asked.)
