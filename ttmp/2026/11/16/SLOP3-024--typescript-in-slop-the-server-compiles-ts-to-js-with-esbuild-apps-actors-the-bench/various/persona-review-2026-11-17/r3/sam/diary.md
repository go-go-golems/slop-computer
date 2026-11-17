# Sam's diary — shipments dashboard (app: sam-shipments3)

## Step 1: create the app
I need a small shipments dashboard for the warehouse: a table of shipments (id, destination, weight kg, status, date), a summary page (counts per status, total weight shipped this week), and — most importantly — a way to check the numbers against the rows. Started from a new app.
**Did:** `benchdrive sam new-app sam-shipments3 "Page with server code"` (server code + SQL, since shipments are shared data and I want to query it).
**Expected:** an empty starter app with a table behind it.
**Happened:** app created, draft mode, starter page with "Add an item".
**Felt:** good, the SQL-backed template was the right call for me.

## Step 2: describe what I want to the agent
**Did:** asked the agent for: shipments table (id, destination, weight_kg, status packed/shipped/delivered, date), a summary page with counts per status and total weight shipped this week, a few dozen rows of realistic test data including an empty week, and an automatic check that the summary numbers match the data.
**Expected:** it would build it and I could then go count rows by hand.
**Happened:** agent worked ~7 min, made a proposal: new SQL migration, actor, page, two fixtures (32 mixed rows + empty), three scenarios. Review showed 11 changed files.
**Felt:** thorough — it even said it corrupted each expectation once to prove the checks can fail. That's my kind of testing.

## Step 3: accept the proposal
**Did:** clicked "Accept all" in the Review view.
**Expected:** the draft app becomes the dashboard.
**Happened:** "Accepted 11 changes into draft 6". Page now shows Shipments counts, add form, table, and a "Raw rows (JSON) — count by hand" section. But all zeros — the sample data isn't in the visible instance yet.
**Felt:** fine, expected the seed to be separate.

## Step 4: run the scenarios, read what they assert
**Did:** Scenarios view → "Run all".
**Expected:** green, but I read the steps anyway.
**Happened:** all 3 passed. The checks are real SQL cross-checks: e.g. "expect #count-shipped has '12'" followed by "sql SELECT count(*) FROM shipments WHERE status = 'shipped' = 12", and this week's weight recomputed with SUM. The add scenario even adds 12.5 kg shipped today and checks count 11→12 and week weight 0→12.5.
**Felt:** this is what I asked for — numbers verified against the rows, not a screenshot.

## Step 5: load sample data onto the dashboard
**Did:** asked the agent to seed the visible instance and give me the SQL-derived totals to verify against.
**Expected:** page fills with rows.
**Happened:** it loaded 33 rows but the canvas still showed zeros — it discovered the frame was showing the *proposal preview* (a scratch copy with its own empty database), not the draft. After the turn ended, the draft view showed the data. It also gave exact expected numbers: packed 8, shipped 12, delivered 13, total 840.9 kg, shipped this week 21.3 kg (ids 22 and 33).
**Felt:** that preview-vs-draft mixup cost me a confusing five minutes — I was staring at an empty dashboard that had data behind it.
STRUGGLE: canvas showed a proposal preview with its own empty database, not the draft, so the page looked empty while the data existed.

## Step 6: hand count + my own SQL
**Did:** Data view → raw shipments table (33 rows). Counted by hand: packed = ids 1,3,12,14,16,18,29,31 → 8; shipped = 12; delivered = 13. Then ran my own SQL (GROUP BY status; and shipped WHERE date >= '2026-11-16').
**Expected:** page numbers equal my counts.
**Happened:** exact match — packed 8 (248.5 kg), shipped 12 (233.1 kg), delivered 13 (359.3 kg), week 21.3 kg (11.3 + 10). The page's "Raw rows (JSON) — count by hand" section also lists every row.
**Felt:** finally, numbers I can stand behind.

## Step 7: use the app myself (Play mode)
**Did:** switched to Play, added "Cardiff, UK", 5 kg — my first click on the "shipped" radio didn't register, so it went in as **packed** (page correctly showed packed 8→9). Second try: clicked the shipped radio input directly, added "Newport, UK", 6.7 kg shipped.
**Expected:** shipped 12→13, week weight 21.3→28.0.
**Happened:** exactly that — page shows 9/13/13 and 28 kg, and my SQL now gives packed 9 (253.5), shipped 13 (239.8), delivered 13. Page matches rows again.
**Felt:** the mis-tap was mine, but a label click on "shipped" really should toggle the radio — minor annoyance worth reporting.
STRUGGLE: clicking the visible "shipped" label didn't toggle the radio button; had to click the input itself.

## Step 8: prove a check can go red
**Did:** opened scenarios/summary-matches-rows.json in the Code view, changed the packed expectation from "8" to "9" by hand, and clicked "Run all". The panel was first confusing: it showed my edited step with a stale green tick from an earlier run.
**Expected:** the corrupted scenario to fail at that step.
**Happened:** after the fresh run — "1 scenario failed", and the failure message was exactly right: 'expected expect #count-packed has "9" (exactly), got text "8"'. I reverted my edit ("9" → "8") and re-ran: all 3 green again.
**Felt:** now I trust it. A test I've never seen fail is only a rumor.
STRUGGLE: the Scenarios panel showed stale ✓ marks next to the edited step before the re-run — I nearly read that as "test passes that should fail".

## Step 9: reset to the fixture, see the empty-week case live
**Did:** Data view → "Reset dev data" (confirm), then "Seed from fixture" → shipments-mixed. First seeding attempt failed with a UNIQUE constraint because seed adds rather than replaces — reset first, then seed.
**Expected:** page shows 8 packed / 11 shipped / 13 delivered and, because the fixture rows are all March 2025, **0 kg shipped this week**.
**Happened:** exactly that. And my own SQL confirms: 32 rows total, 0 shipped this week, week_kg = 0. The page's 0 is the SQL truth, not a blank or an error.
**Felt:** the edge case I asked for at the start, working end to end.
STRUGGLE: "Seed from fixture" doesn't replace existing rows — had to discover Reset first after a UNIQUE constraint error.

## Step 10: label fix accepted and verified hands-on
**Did:** accepted the 5-file proposal (explicit for/id labels, click handler, pointer cursor, and the add scenario now clicks the word). In Play mode I clicked "shipped" — at first it still showed packed, but that was my own click landing on the "11 shipped" summary text, not the form label. Clicking the actual label toggles the radio properly now. Added "Dover, UK", 3.2 kg shipped: page went 11→12 shipped and 0→3.2 kg this week.
**Expected:** word click selects the radio, numbers move by exactly what I typed.
**Happened:** both, once I aimed at the right element.
**Felt:** good — though "shipped" as visible text appears twice on the page; as a keyboard-and-SQL person I'd never have noticed which one ate my click the first time.

## Step 11: close the future-date hole
**Did:** the agent honestly listed what the checks don't cover; the one I care about is that a shipped row dated in the future still counts toward "this week" (filter is date >= Monday). Asking it to cap the week at today and guard it with a scenario, since a future-dated row is a data-entry error and must not inflate the week total.
**Expected:** a small change plus a new check with a future-dated shipped row in the fixture.
**Happened:** (pending)

## Step 12: accept the future-date fix and audit it
**Did:** accepted the 6-file proposal (actor.ts week window now capped at today, new shipments-future-date fixture, new scenario, same cap added to the other scenarios' SQL). Read the fixture and scenario before accepting: two in-week shipped rows (10 kg today + 5.5 kg Monday = 15.5) and two poisoned future-dated ones (99 kg and 42 kg).
**Expected:** page week weight 15.5; the scenario also asserts SQL uncapped = 156.5 (10+5.5+99+42), proving the cap removes exactly the poisoned rows.
**Happened:** "All 4 scenarios passed", and the scenario steps show page 15.5, capped SQL 15.5, uncapped SQL 156.5, counts 4 shipped / 1 packed / 1 delivered / 6 rows. Status counts still include all rows — only the week window is capped, which is the right semantics.
**Felt:** this is the kind of edge-case discipline I'd write myself if I ran the warehouse SQL by hand.

## Step 13: final live sanity check
**Did:** on the draft instance (mixed fixture + my Dover row: 33 rows) ran my own SQL with the capped window.
**Expected:** 3.2 kg this week, matching the page.
**Happened:** SQL: 33 rows, capped_week_kg 3.2. Page: 8 packed / 12 shipped / 13 delivered / 3.2 kg. Match.
**Felt:** done. The dashboard, the data and the checks all tell the same story.

## Verdict
**Did I get what I wanted? Yes.** A shipments table with an add form, a summary (counts per status, total weight shipped this week, Monday-to-today), a raw-rows section I can count by hand, 32+ rows of realistic test data, an empty-week fixture, and four automatic scenarios that recompute every page number from the actual rows via SQL — plus the future-date edge case I asked for after the agent flagged it. I verified the numbers three ways: hand count, my own SQL, and a sabotage test (corrupted one expectation, watched it fail at exactly the right step, reverted it, all green again).

**Hardest moment:** the canvas showing the proposal *preview* — a scratch copy with its own empty database — while I thought I was looking at my data. Five minutes of "where are my rows?" before the agent diagnosed it. Second hardest: the Scenarios panel showing stale green ticks against an edited step; I nearly took that as a test passing that should fail, but a fresh run gave the honest red.

**Would I come back?** Yes. The Data view with read-only SQL is exactly my kind of tool — I never had to trust a screenshot, and every number on the page had a SELECT behind it. The publish button is there when the warehouse team needs it.

**The three struggles that mattered most:**
STRUGGLE: canvas showed a proposal preview with its own empty database, not the draft, so the page looked empty while the data existed.
STRUGGLE: the Scenarios panel showed stale ✓ marks next to the edited step before the re-run — I nearly read that as "test passes that should fail".
STRUGGLE: "Seed from fixture" doesn't replace existing rows — had to discover "Reset dev data" first after a UNIQUE constraint error.
