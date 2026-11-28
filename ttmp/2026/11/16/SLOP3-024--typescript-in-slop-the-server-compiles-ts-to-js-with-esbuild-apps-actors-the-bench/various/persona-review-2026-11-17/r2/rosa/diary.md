# Rosa's diary — fixing the "inventory" app

## Step 1: Open the existing app
Owner hired me to fix the inventory app a vanished contractor built. Three complaints: (1) total stock value sometimes shows crazy millions, (2) they want a CSV export for the accountant, (3) items under 5 in stock should stand out. Real stock data must survive. First: open the app and look at the code before touching anything.
**Did:** `benchdrive rosa open-app inventory`
**Expected:** the inventory app opens with its live page and file list.
**Happened:** opened fine. Files: actor.js, app.json, index.html, sql/001_init.sql, sql/002_loc.sql. Canvas shows an Inventory page with Name/Qty/Price fields and a table.
**Felt:** okay, small app, let's read it first like always.

## Step 2: Read the code (found the total bug already)
frame-text showed the total as "$0179.8819.5057.7577.50178.00190.0020.80" — that's string concatenation of every row's value, exactly the "crazy millions" the owner meant. It grows with each item. Tried to read the rest of index.html in the Code view but it only ever shows the first 12 lines and won't scroll; screenshots are no use to me here.
**Did:** `frame-text`, `view Code`, clicks and PageDown attempts
**Expected:** see the whole script section.
**Happened:** only lines 1–12 visible, "(… 49 more lines)".
**Felt:** annoyed — how do I read the bottom of the file?
STRUGGLE: Code view shows only the top 12 lines of a file; no way found to scroll it.

## Step 3: Nearly destroyed index.html by accident
I tried `type "code" ""` to see if the code field was a search box. It wasn't — it REPLACED the whole file with empty text. The canvas went blank instantly.
**Did:** `benchdrive rosa type "code" ""` (trying to navigate), then `key Control+z`
**Expected:** maybe focus/jump to a line; instead the file was wiped and the app rendered 0 elements.
**Happened:** file emptied, page blank; Ctrl+z restored it and the table came back.
**Felt:** cold sweat — ten years of instinct said "undo first, ask questions later". Never typing into that field again.
STRUGGLE: nearly destroyed the app's main file; recovered only via Ctrl+Z.

## Step 4: Verify the store's data survived
The items live in a SQL table, not the HTML, so the scare shouldn't have touched them — but I check, I don't assume.
**Did:** `view Data`
**Expected:** 7 rows in tbl_inv.
**Happened:** all 7 items there (Hammer 12 @14.99, Wood screws 3 @6.5, Paint roller 7 @8.25, Masking tape 25 @3.1, Cordless drill 2 @89, Sandpaper 40 @4.75, Wall plugs 4 @5.2).
**Felt:** relieved. Data is safe in tbl_inv (dev instance).

## Step 5: Read the rest of the code via the agent (Read-only mode)
Couldn't scroll the Code view, so I switched the agent to Read-only (so it physically can't change anything) and asked it to paste lines 13-61 of index.html and all of actor.js verbatim.
**Did:** clicked Read-only, `ask "paste lines 13 to 61 verbatim…"` and follow-ups
**Expected:** the script section.
**Happened:** got it. Found the total bug: `var line = (it.Qty * it.Prc).toFixed(2); total = total + line;` — toFixed returns a STRING, so the "total" is glued text ("$0179.8819.50…" — exactly the owner's "crazy millions" once it grows). Also found: actor.js INSERT is malformed (`INSERT INTO tbl_inv (Nm, Qty=?, Prc=?, upd) VALUES (?,?,?,?)`), and a mystery `doStuff` action that returns items with Qty < 5 (its dangerous UPDATE loop is commented out, thankfully).
**Felt:** classic contractor mess. The fix for the total is one line — I'll do that one by hand.

## Step 6: Fix the total by hand (3 small edits)
One-liner territory, no agent needed. In index.html: accumulate `it.Qty * it.Prc` as a number instead of gluing `.toFixed(2)` strings, and format once at display time.
**Did:** three `edit` commands (line 38-39 accumulate numbers; line 42 `total.toFixed(2)` for display)
**Expected:** total = 179.88+19.50+57.75+77.50+178.00+190.00+20.80 = 723.43.
**Happened:** page now shows "Total stock value: $723.43" — matches my hand calc exactly.
**Felt:** good. That's the owner's first complaint gone, and I know exactly what changed because I changed it.

## Step 7: Test Add in Play mode
The INSERT in actor.js looked malformed (`INSERT INTO tbl_inv (Nm, Qty=?, Prc=?, upd) VALUES (?,?,?,?)`), so before touching it I tested the thing itself: added "Test widget", 10 @ 9.99.
**Did:** Play mode, typed into the fields, clicked Add
**Expected:** an SQL error, honestly.
**Happened:** it worked — item appeared, total went to $823.33 (= 723.43 + 99.90, correct again). Framework tolerates the weird SQL. But now a test row pollutes the store, and the [x] delete does nothing from Play mode (its confirm() seems swallowed).
**Felt:** surprised the ugly INSERT works; mildly worried about the test row I need to clean out.
STRUGGLE: the app's delete button can't be triggered from the bench (confirm() dialog never appears), so my test row is stuck in the data for now.

## Step 8: Low-stock highlight + CSV export, by hand
Four more small edits in index.html, all mine: (a) CSS `tr.low td{background:#ffe0e0;color:#900}`; (b) rows with Qty < 5 get class="low"; (c) an "Export CSV" button next to Add; (d) a real exportCsv() replacing the contractor's `// function exportCsv() { TODO }` — builds ID,Nm,Qty,Prc,upd rows, quotes fields containing commas/quotes, downloads inventory.csv.
**Did:** four `edit` commands on index.html
**Expected:** page renders with the new button; no JS errors.
**Happened:** canvas shows "[Add] [Export CSV]", table and total intact, no console errors.
**Felt:** steady. Still refusing to let the agent near files until my changes are verified.

## Step 9: Agent proposes a data reset — I say no
I switched the agent to Ask mode (every eval needs my Run/Skip) and asked it to (1) delete only my Test widget row and (2) click Export CSV and report the CSV. Its direct SQL DELETE came back "not authorized" (fine — writes aren't allowed from the sandbox). Then it proposed: hardcode the current 7 rows, `app.reset()` the whole dev data, and only AFTER the reset check if the data still matches. That's backwards — if the reset is wrong, the store's inventory is already gone.
**Did:** clicked **Skip** on the reset eval, told it: no reset, delete only the test row, try the app's own [x] button, and if that fails, stop and report.
**Expected:** it to comply.
**Happened:** it poked around (session.stream, frames.list) and ended its turn with "Nothing in the app changed" — no delete. Test widget still in the table.
**Felt:** wary but vindicated — this is why I keep it on a leash. A "trust me, I hardcoded the rows" reset is exactly how live data dies.
STRUGGLE: agent's only working idea for cleanup was a full data reset; I refused and had to find a safer route.

## Step 10: Understanding the data model — and why the test row is hard to kill
Long turn with the agent in Ask mode. Learned: (a) its SQL writes are "not authorized", (b) proposals run on a throwaway trial copy built from the app's setup files, (c) publishing copies files only — every running copy keeps its own data, so my dev copy's test row can never reach the store's data anyway. The app's own [x] delete needs a confirm() box that never surfaces for me (bench auto-dismisses it), and the Data view's SQL box is read-only.
**Did:** lots of Run/Skip on read-only evals; one Skip on its `app.reset()` idea; asked it to explain accept/publish semantics
**Expected:** a clean way to delete one row.
**Happened:** no direct write path exists for the test row; but it explained exactly how data flows.
**Felt:** this bench guards data like a bank vault — annoying, but the right default.
STRUGGLE: no authorized way found to delete a single row from the draft's live data (SQL read-only, UI delete blocked by confirm()).

## Step 11: Verify the seed files myself, then plan a safe reset
Read sql/001_init.sql and sql/002_loc.sql in the Code view myself: the seeds reproduce the live data's 7 items EXACTLY (same names, quantities, prices, dates; loc='A1' for IDs 1-3, matching the live rows). So "Reset dev data" rebuilds precisely the owner's inventory — my Test widget is the only thing that would disappear.
**Did:** opened both sql files in Code view
**Expected:** seeds matching live data.
**Happened:** they match, line for line, value for value.
**Felt:** confident enough to reset — with a fixture backup first, like a grown-up.

## Step 12: Backup, reset, verify
Saved all 8 rows as fixtures/rosa-backup-8rows.json first, then Reset dev data (dialog confirmed: only my dev instance is dropped, fresh one runs the draft). Verified afterwards.
**Did:** Save as fixture → Reset dev data → Refresh → frame-text
**Expected:** exactly the 7 original items, total $723.43.
**Happened:** exactly that — Data view shows the 7 originals (with loc values intact), frame ends "Total stock value: $723.43".
**Felt:** tidy. Test widget gone, real data provably intact, backup on the shelf.

## Step 13: Agent verifies my work + writes the proof test
Asked the agent (Ask mode, every eval approved by me) to verify in the trial preview: (1) clicked Export CSV — produced a clean inventory.csv, header `ID,Nm,Qty,Prc,upd` plus all 7 rows; (2) exactly 3 rows carry class 'low' — Wood screws (3), Cordless drill (2), Wall plugs (4); (3) it wrote scenarios/total-stock-value.json — a permanent test that asserts the page total equals SQL's SUM(Qty*Prc) and the row count. Ran it: "✓ total-stock-value", all 4 steps green. The proposal contained only that one new file; I reviewed and accepted it.
**Did:** Run/Skip through its evals, Review → Accept all, then Scenarios → Run all myself
**Expected:** all three checks pass.
**Happened:** "All 1 scenario passed" — green from my own hand, not just the agent's word.
**Felt:** this is the proof the owner can re-run any time the total looks crazy again.

## Step 14: Cleanup, final check, publish
Deleted my temporary backup fixture (it still held the bogus Test widget row — didn't want that re-appliable). Final file list: actor.js, app.json, index.html, scenarios/total-stock-value.json, sql/001_init.sql, sql/002_loc.sql. Final page check: 7 original items, Export CSV button present, total $723.43. Published draft 15 to main — files moved are just ~index.html and +scenarios/total-stock-value.json; production keeps its own data, and there's a Roll back button if the owner objects.
**Did:** Delete fixture (confirmed by filename in the dialog), frame-text, Publish → "Publish draft 15"
**Expected:** a clean, published app.
**Happened:** "Published draft 15 to main"; production instance inventory now on 15; rollback available.
**Felt:** done. Owner gets: correct total, CSV export, low-stock highlighting, and a re-runnable test that proves the total.

## Verdict
**Yes** — all three of the owner's complaints are fixed, the data survived, and the fix is published.
- The total: the bug was `.toFixed(2)` gluing strings together ("$0179.8819.50…"); now it's a real sum, $723.43, proven by a permanent scenario test that cross-checks the page against SQL's SUM(Qty*Prc).
- CSV export: "Export CSV" button downloads inventory.csv (ID,Nm,Qty,Prc,upd, quoting where needed) — verified by the agent clicking it, and by me seeing the output.
- Low stock: rows with Qty < 5 (Wood screws, Cordless drill, Wall plugs) get class="low" with a red-tinted style; verified in the live DOM.
**Hardest moment:** getting my own test row back out of the draft's live data — no authorized single-row delete existed (SQL read-only, the app's confirm() unreachable), and the agent's first idea was a full data reset it would only verify afterwards. Resolved by verifying the seed files myself, fixture backup, then reset — and by refusing the "trust me" reset the first time.
**Would I come back?** Yes. The Ask-mode proposals with per-eval Run/Skip and throwaway trial data are exactly how you keep an agent on a leash with live data around.
**Three struggles that mattered most:**
STRUGGLE: Code view shows only the first 12 lines of a file and wouldn't scroll — had to get the rest by having the agent paste it in Read-only mode.
STRUGGLE: typing into the code field wiped index.html entirely (recovered with Ctrl+Z) — the field replaces the whole file, it isn't a search box.
STRUGGLE: deleting a single row from the draft's live data had no sanctioned path; only a verified-safe reset (with fixture backup) after reading the seed files myself worked.
