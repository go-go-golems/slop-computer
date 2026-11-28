# Diary — Theo, security review of "inventory2"

## Step 1: open the app and look around
The hardware store wants a security review of their inventory app before staff accounts go live. I opened inventory2 on the bench.

**Did:** `benchdrive theo open-app inventory2`
**Expected:** the app opens, files listed in Code view
**Happened:** Frame shows an Inventory app (Name/Qty/Price/Add + a table). Files: actor.js, app.json, index.html, sql/001_init.sql, 002_loc.sql
**Felt:** ready to read code before touching anything

## Step 2: read all the code
Read index.html, actor.js, app.json, both SQL files in the Code view.

**Did:** opened each file in Code view and read it
**Expected:** a picture of what the contractor built
**Happened:** index.html builds the table by string-concatenating `it.Nm`, `it.Qty`, `it.Prc`, `it.upd` straight into `innerHTML` (draw(), line 36). actor.js `del` does `DELETE FROM tbl_inv WHERE ID=' + a.id` — string concatenation into SQL, not parameterized like `save` is. Columns are all TEXT, no validation anywhere.
**Felt:** two classic findings already; XSS in the page, SQLi in the delete action

## Step 3: switch to Play mode
The frame clicks kept getting captured by Select mode.

**Did:** clicked "Play" in the header
**Expected:** to use the app like a staff member would
**Happened:** mode Play now, frame clicks go into the app
**Felt:** fine
STRUGGLE: first Add click just selected the button for the inspector; had to find the Play toggle in the header

## Step 4: stored XSS attack via product name
I typed a product name containing `<img src=x onerror=...>` and added it, then edited that row with a payload that logs to console, to prove execution and not just markup injection.

**Did:** typed the payload into the Name field in Play mode, clicked Add; then edited the same row with an onerror that calls console.log
**Expected:** the page to render the tag as HTML — and if onerror runs, the script executes for anyone who views the list
**Happened:** the row shows as "[image]" in the table (tag interpreted, not shown as text), and the console shows `Uncaught ReferenceError: XSS is not defined index.html:1` — that error IS my injected script running (the quote stripping in my payload made it `console.log(XSS-EXECUTED)`). Confirmed: stored XSS executes.
**Felt:** exactly what I suspected — any staff member's browser executes code planted by whoever typed that product name
STRUGGLE: my payload's quotes got mangled when typing, but the ReferenceError was still proof of execution

## Step 5: agent demonstrated the SQL injection
I can't send a crafted delete id from the page (the buttons only pass the row's numeric ID), but a staff user could call the action from devtools, so I asked the agent to demonstrate it on a scratch instance before fixing anything.

**Did:** asked the agent to run del with id "1 OR 1=1" on a COPY of the data and show row counts
**Expected:** WHERE ID=1 OR 1=1 → all rows deleted
**Happened:** confirmed on a scratch instance seeded with a copy of the 8 rows: control call (numeric id 3) went 8→7, attack call went 8→0. Agent also noted save() is properly parameterized and doStuff has the same concat pattern but only in a commented-out line.
**Felt:** both findings proven; time to fix

## Step 6: asked for the two fixes plus tests
Connection dropped mid-turn but the message went through; the agent worked ~12 minutes and produced a proposal.

**Did:** asked for: parameterized delete + server-side integer validation (not a client-side hide), output-escaping for XSS (server keeps storing odd names), and a test per fix that fails without it
**Expected:** a proposal with modified actor.js and index.html plus scenario/test files
**Happened:** proposal with 5 files: actor.js M, index.html M, fixtures/xss-payload.json, scenarios/delete-row-via-ui-still-works.json, scenarios/stored-xss-renders-as-text.json. Agent says it ran a red/green on the XSS test (red against old code: payload became a real <img>, count 1) and green on the fixed code. It also built a "probe" that extracts the del function body and feeds it a mock SQL to prove the crafted id is rejected before reaching SQL.
**Felt:** promising, but I check fixes myself — next step is reading the actual diff
STRUGGLE: waited ~12 min across several reconnects for the long turn; the message I sent right as my connection dropped actually went through, which I only realized after re-looking

## Step 7: reviewed the proposal myself
Read every changed file in the Code/Review views before accepting anything.

**Did:** opened actor.js diff, index.html diff, both scenario files, the fixture
**Expected:** server-side validation for del (not a page-side hide) and real output escaping for XSS
**Happened:** actor.js: args schema `id: {type:'integer'}` + explicit `Number.isInteger` check that throws + `DELETE FROM tbl_inv WHERE ID=?` parameterized. index.html: new `esc()` escaping &<>"' applied to Nm/Qty/Prc/upd on output — the server still stores odd names raw, as I asked. Scenarios: stored-xss-renders-as-text (no img element, no data-xss-ran marker, literal tag visible as text) and delete-row-via-ui-still-works (8→7 rows). Fixture seeds a payload row with ID 9001.
**Felt:** this is what a fix should look like — minimal and on the server

## Step 8: ran the scenarios myself and pushed on the SQLi test
The scenario panel showed a stale ✗ from the agent's deliberate red run, so I re-ran everything. Then I refused to accept without an end-to-end test for the injection fix.

**Did:** clicked "Run all" in Scenarios; then told the agent: prove the del action rejects id "1 OR 1=1" end-to-end, and make that test durable
**Expected:** all green, and a crafted-id test that survives in the proposal
**Happened:** All 2 scenarios passed. The agent then ran a genuine red/green through a temporary page hook: GREEN on fixed code — server rejects with "at /id: got string, want integer", all 8 rows intact; RED on old code — "CALL SUCCEEDED: ok" and 8→0 rows wiped. It saved a durable probe at .agent/lib/probeDelInjection.js (mocks sql.run, asserts crafted id throws before any SQL, numeric id issues exactly one parameterized DELETE). lib.def turned out to only accept single-return function bodies, which is why the first probe attempts crashed.
**Felt:** exactly the proof I wanted; the agent was straight with me that only the two scenarios run on Check automatically
STRUGGLE: the first probe attempts hit internal errors (lib.def limitations) — took three turns of pushing before I had a durable crafted-id test

## Step 9: accepted the fixes and verified everything myself
Accepted the 6-file proposal into the draft. Then verified from the app itself, not the chat.

**Did:** Accept all, then in Play mode: reloaded the app and checked my stored payload row, added a "Test widget", deleted it via the UI, ran all scenarios, ran Check
**Expected:** payload row shows as literal text with no script error; normal add/delete still works; scenarios green
**Happened:** all true. The row `<img src=x onerror="console.log(XSS-EXECUTED)">` renders as literal text, console clean on reload (no new ReferenceError). Add + delete: 8→9→8 rows, exactly the junk row removed. "All 2 scenarios passed." The only Check issue was a pre-existing cosmetic overflow (page 420px wide in a 375px viewport) - not security, noted for the store.
**Felt:** the fix is real end to end; nothing was just hidden in the page

## Step 10: final end-to-end crafted-id run and cleanup
The agent's writes were locked to a proposal copy after acceptance, so it couldn't reach the dev store directly. I rejected the empty copy to free its writes, then asked for the crafted-id call through a real page runtime. The agent added a temporary #delprobe hook to a proposal copy, ran it, and I read the result right off the frame.

**Did:** rejected the stale proposal copy; then `frame-text`: REJECTED: del: at /id: got string, want integer / ROWS AFTER: 7 (the preview store's copy) / PROBE DONE
**Expected:** the server itself to refuse "1 OR 1=1", rows untouched
**Happened:** exactly that. The hook proposal was then REJECTED by me so the draft page stayed exactly as accepted (I checked the diff - only the temp hook, nothing else). Deleted my payload row from the dev store via the UI afterwards; back to the 7 original products.
**Felt:** belt and braces complete - fix, red test, green test, live rejection, clean store
STRUGGLE: the proposal/acceptance workspace model confused both me and the agent - twice its writes silently landed in a proposal copy instead of the draft, and the canvas flipped between the preview store and the dev store mid-check

## Step 11: security report for the store
Asked the agent to write up the findings for the hardware store; first attempt only produced chat text, no file.

**Did:** asked again to save it as SECURITY-REVIEW.md; accepted the 1-file proposal
**Expected:** the report in the Docs view
**Happened:** SECURITY-REVIEW.md (77 lines) in Docs: both findings, fixes with exact line numbers, proof per fix (red/green, durable probe, scenario names), current state, and a "notes - not fixed" section (inert commented-out UPDATE in doStuff, TEXT columns with no validation, the total-adds-strings bug, the 375px overflow). The agent re-verified every line reference before saving.
**Felt:** done - this is what I hand the store owner

## Verdict
**Yes - I got exactly what I wanted.** Two real vulnerabilities found, both fixed minimally (no rewrite), each with proof that fails without the fix:

1. **SQL injection in del (actor.js)** - `DELETE FROM tbl_inv WHERE ID=' + a.id` concatenated. Proven real (crafted id wiped 8/8 rows on a scratch copy), fixed with three server-side layers (integer args schema, explicit Number.isInteger check, parameterized query). Proof: end-to-end red/green through the page runtime, plus a durable probe (.agent/lib/probeDelInjection.js) plus a UI-regression scenario.
2. **Stored XSS in draw() (index.html)** - item fields concatenated into innerHTML. Proven real from the UI myself (injected onerror executed, ReferenceError in console). Fixed by output escaping (esc() on all four fields); the server still stores odd names raw, as it should. Proof: red/green scenario (stored-xss-renders-as-text) plus my own UI check that the stored payload row renders as harmless text.

The store also gets a written report (SECURITY-REVIEW.md) and flagged-but-not-fixed notes (doStuff's commented-out concat, TEXT columns without validation, the total-string-concat bug, the 375px overflow). Hardest moment: the proposal-copy workspace model - after accepting, the agent's writes kept landing in invisible proposal copies, and the canvas silently switched between the preview store and the dev store, so several "verifications" needed re-checking to know which data I was actually looking at. The three struggles that mattered most: (1) Select vs Play mode when first trying to attack the app through the UI, (2) the lib.def internal errors that blocked the durable injection probe until the agent found the single-return format, and (3) figuring out which store instance (dev vs proposal preview) a given test or frame was actually hitting. Would I come back? Yes - the agent proved the vulns before touching anything, fixed them the way I asked (server-side, minimal), and was honest about what it couldn't do from its seat.
