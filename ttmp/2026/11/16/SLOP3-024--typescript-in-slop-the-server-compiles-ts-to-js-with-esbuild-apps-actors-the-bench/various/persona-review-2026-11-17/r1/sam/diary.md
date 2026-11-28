# Sam — shipments dashboard (bench diary)

## Step 1: Find my way around the bench
I run ops at a warehouse and I want a small dashboard of shipments I can trust. I've been handed this bench tool and told it's a web page where I describe what I want. I don't write JavaScript — I write SQL and spreadsheets.
**Did:** `benchdrive help`, then `benchdrive sam look`
**Expected:** some kind of blank page or a start screen.
**Happened:** A quiz app is already open ("Weekly Science Quiz", question about H2O). Header says "app Weekly Science Quiz". Panels: Agent, Eval, Canvas, Timeline, Console, Data, Scenarios, Code, Review, Docs, Inspector, Layers, Panels.
**Felt:** Mildly lost. Why is there a science quiz? Nothing says "make a new app" out loud.

## Step 2: Make a new app
I don't want a quiz, I want my shipments dashboard. The project menu had a New app… dialog.
**Did:** `benchdrive sam new-app sam-shipments template` (I guessed a template name), then `look`, then clicked "Page and actor", typed id `sam-shipments`, title `Sam's Shipments`, clicked Create.
**Expected:** a blank app I could start describing to the agent.
**Happened:** First attempt failed: "No template "template" ... Templates: "Page", "Page and actor"". Then the dialog explained: Page = "keeps its data in the app's document database"; Page and actor = "page that calls its actor, which keeps rows in SQL (a migration in sql/)". I picked Page and actor because SQL is what I know. App header now: "app Sam's Shipments sam-shipments · store: draft 1 no dev instance". The page shows "Sam's Shipments / [field "Add an item"] / [Add]" — the starter to-do list.
**Felt:** Relieved that "SQL" was a choice on the menu — that's the first word I've recognised all session.
STRUGGLE: had to guess the template name and failed; the names are only visible once the dialog is open.

## Step 3: Ask for the dashboard in plain words
I wanted to describe it once, properly, and not have to speak JavaScript. SQL I'm fine with.
**Did:** `benchdrive sam ask "I run operations at a warehouse... one row per shipment: id, destination, weight kg, status, date... counts per status, total weight shipped this week (Mon–Sun, status shipped or delivered)... a few dozen test rows with edge cases (empty week, Monday, Sunday, zero weight, big weight, delivered from last week)... every number has to come from the SQL rows so I can check it by hand."`
**Expected:** the app changes and I get a table plus a summary.
**Happened:** It worked through a lot of steps and came back with "Proposal ready: 8 files to review". Header switched to `workspace Proposal: I run operations at a wa…`. Frame 1 now shows: "Summary / Week: Mon 2026-11-16 → Sun 2026-11-22 (UTC) · today 2026-11-17 / Shipments per status: packed 11, shipped 11, delivered 10, all 32 / Shipped this week 12805.2 kg / 6 rows with status shipped or delivered, dated 2026-11-16 to 2026-11-22 (both days included) / All shipments 32 rows" and a table. Console showed "Uncaught Error: ... has no action "list"".
**Felt:** Pleasantly surprised — it even printed *which* rows it counted, which is exactly how I check things. But "Proposal" and "8 files to review" is a gate I don't understand yet, and that red console error worries me.
STRUGGLE: the app is not live yet ("Proposal"), and there's a red "no action list" error I don't know how to interpret.

## Step 4: Check the numbers before I sign off
I don't accept anything I haven't checked. First I wanted to see the SQL, then the rows.
**Did:** `view Review` → `click "open"` (opened actor.ts in Code) → `click "queries.ts"` in code. Then `view Data`.
**Expected:** the queries, and the rows in the Data view.
**Happened:** The Code view shows queries.ts with comments: "LIST_SQL = SELECT id, destination, weight_kg AS weightKg, status, date FROM shipments ORDER BY date DESC, id DESC", "One row per status the CHECK constraint allows, so a status with no shipments shows 0 instead of vanishing." That second comment is the kind of thing I'd have written. The end of the file was cut off ("(… 21 more lines)"), so I could NOT see the week/weight query in full. Data view showed only a table called "items" and "No rows." — no shipments.
**Felt:** Half-confident. The list query is right. But I couldn't read the query that produces the headline number, and the Data view doesn't show me the shipments table at all. That's the one thing I said mattered.
STRUGGLE: Code view truncates long files, and the Data view only offers the old "items" table — I can't see the shipments rows there.

## Step 5: Get the real rows out of SQL myself
I trust numbers I can recompute. I wanted to run my own SQL against the same table the page uses.
**Did:** Loaded the test data with the page's "Load test data (replaces all rows)" button (first had to press "Play" — in Select mode the click selects HTML instead of pressing the button). Then Data view → "SQL query…" → typed my own queries.
**Expected:** a query box where I paste SQL, like any SQL client.
**Happened:** The query box worked, but getting my SQL into it was a fight: `type "text"` → "No visible field text. Fields on screen: input in dialog". Same for "dialog input", "input in dialog", "textarea" (that one put my SQL into the *agent chat* instead), ".modal input" finally worked. I also accidentally left SQL in the chat composer and had to clear it.
Results, typed by hand:
- `SELECT status, COUNT(*) n, SUM(weight_kg) w FROM shipments GROUP BY status` → 10 delivered 14242.95 / 11 packed 317.85 / 11 shipped 607.15
- `SELECT COUNT(*) n, SUM(weight_kg) w FROM shipments WHERE status IN ('shipped','delivered') AND date BETWEEN '2026-11-16' AND '2026-11-22'` → 6 | 12805.2
The page says packed 11, shipped 11, delivered 10, all 32, and Shipped this week = 12805.2 kg from 6 rows. **It matches exactly.** Adding 12.4+245+0+12480.5+27.3+40 by hand also gives 12805.2.
**Felt:** Genuinely good — the numbers hold up and I can reproduce them in SQL. But two annoyances: the Data view's "Tables" picker still says "items" and querying `items` gives "no such table: items", and typing into the query box took five attempts.
STRUGGLE: the field for the SQL dialog has no usable name; several guesses typed into the wrong place (once into the agent chat).
STRUGGLE: Data view "Tables" lists only a table called "items" that no longer exists; my shipments table is not in the picker.

## Step 6: Ask for fixtures, a scenario, and proof the check can fail
The trap I've fallen into before is a green tick that means nothing. So I asked for a fixture with nasty cases, a scenario comparing page numbers to rows, and above all a demonstration of a check going RED.
**Did:** `benchdrive sam ask "...1) Data view still points at 'items'... 2) I see the bench has Scenarios and Fixtures, I want a fixed fixture with an empty week, Monday, Sunday, the Sunday before, zero weight, decimal, big weight, and a scenario checking per-status counts and week total... 3) do not just show me a green tick. Give me a scenario where the page shows a deliberately WRONG number and show me the check goes red. Tell me exactly which scenario you broke and what it said before and after."`
**Expected:** a fixture, a scenario, and a before/after on a deliberately broken number.
**Happened:** "Sent. The turn ended after 1 min 17 s." The reply was nine eval steps, one of them FAILED (✕ eval 3 · app.sql), and then a line saying `"Good news: I checked your numbers myself…" was discarded`. No explanation of anything I asked. Scenarios view: "No scenarios yet." / Fixtures: "None yet." So it did *nothing* I asked and said nothing useful. One thing did change: the Data view "Tables" picker now says "shipments" instead of "items".
**Felt:** Annoyed and confused. "discarded" — discarded by whom? I asked three plain questions and got a shrug and a failed SQL step.
STRUGGLE: the agent silently discarded my message and produced no answer; I don't know whether to resend it or reword it.

## Step 7: Re-ask, patiently
It said my message was discarded, so I assumed an honest hiccup and asked again, spelling out points 2 and 3.
**Did:** `benchdrive sam ask "Something went wrong with my last message... Please just do points 2 and 3 now... Make a fixture... a scenario that loads it on the test instance and checks the numbers printed on the page against the rows... Then make a copy where the page shows a deliberately wrong number, run it, and tell me the scenario's name, what it printed before and after, and whether it went red. I need to see a red result or I don't believe the green one."`
**Expected:** a fixture, a scenario, and a red run.
**Happened:** 2 min 18 s, nine evals, two of them FAILED (✕ eval 2, ✕ eval 6 "rolled back index.html, scenarios/zz-probe.json"). It wrote a file `scenarios/zz-probe2.json` whose contents are literally `"description": "probe: text exact or contains?"` with a step expecting text "THIS-IS-NOT-THERE" — that's its own experiment left lying in my app. No fixture. No real scenario. No red result. The proposal was **one file: the probe**. I rejected it.
Buried in its chatter was one useful sentence: "Scenario text checks are substring matches."
**Felt:** Irritated. I asked for a proof and got leftover scaffolding. And "substring matches" is exactly the kind of thing that makes a check pass when it shouldn't.
STRUGGLE: the agent left its own probe file in my app as a proposal, and did not do the actual work in two attempts.
STRUGGLE: a scenario's text check is a *substring* match — so a check can pass on the wrong number. Nobody told me that; I had to read it in the agent's commentary.

## Step 8: One thing at a time, and I check the arithmetic myself
I stopped asking for three things at once. I gave the agent a fixture spec I could compute in my head, and asked it to add the numbers up in its reply.
**Did:** `benchdrive sam ask "Do ONLY this... A) Save ONE named fixture (not a probe)... four rows this week: Monday 2026-11-16 shipped 10.5, Sunday 2026-11-22 delivered 20, Wednesday packed 99, Wednesday shipped 0; one Sunday before (2026-11-15) delivered 500; a week with nothing at all. B) Save ONE scenario that loads that fixture and checks the per-status counts and the week total on the page. Add the expected numbers up by hand and put them in your reply. Do not create any probe files."`
**Expected:** a fixture, a scenario, and honest arithmetic.
**Happened:** Fixture `fixtures/week-2026-11-16.json` — the five rows exactly as I specified (Reykjavik 10.5 shipped 11-16, Lyon 20 delivered 11-22, Ghent 99 packed 11-18, Porto 0 shipped 11-18, Oslo 500 delivered 2026-11-15). I accepted it. Still "No scenarios yet."
Two things it told me, both bad:
- "a text check is a substring check ('0.5' passed against 30.5)" — it proved my worst fear: the checking mechanism can pass on the wrong number.
- "The test instance's SQL connection is dead... every action fails now, even a single run" and "sql: connection is already closed".
**Felt:** My own arithmetic: 10.5 + 20 + 0 = 30.5 kg over 3 rows, and packed 1 / shipped 2 / delivered 2 / all 5. Those are the numbers any check must produce. But the thing that is meant to check them is a substring matcher, which won't do.
STRUGGLE: the bench's scenario text check is substring-only, so "0.5" passes against "30.5" — a check that can pass on a wrong number.
STRUGGLE: the test instance's SQL connection dies after the first scenario run ("sql: connection is already closed"), so a scenario can't be run twice.

## Step 9: Accepting a real fix, still no scenario
It found a genuine bug in its own code and fixed it, and I could follow the diff.
**Did:** `benchdrive sam ask "...A scenario 'week-total'... do NOT rely on the substring check for the numbers — compare the whole value exactly (including the ' kg')... Then show me it can fail... You also said the test instance's SQL connection dies, if that is a bug in my app, fix it."`, then `view Review`, then `Accept all`.
**Expected:** one scenario with exact checks, one red run, one bug fix.
**Happened:** Proposal was just `actor.ts +7 −2`: replaced `const sql = use('sql')` (grabbed once at module load) with `const db = () => use('sql')` — with a comment explaining that the instance reopens its database on reset, so a handle cached at load points at a closed connection. That is a real bug and I understood the explanation. Accepted (draft 14).
But Scenarios view still says "No scenarios yet." Three asks, three times no scenario. It also reported: "help on scenarios is terse and unknown step keys are silently ignored" — so it could not confirm whether an exact-text check even exists, and it doesn't know the scenario file format for sure.
**Felt:** Half-satisfied. The bug fix is worth having. But the thing I actually asked for — a check I can trust — does not exist yet, and the tool it's building on may not support exact comparison at all.
STRUGGLE: the scenario file format is undocumented ("unknown step keys are silently ignored"); both I and the agent are guessing.

## Step 10: I built a green tick that means nothing
I got impatient and clicked "+ New" in the Scenarios panel myself.
**Did:** `click "+ New" --in scenarios` → named it `week-total` → `click Edit` (nothing) → found `scenarios/week-total.json` in Code → `view Docs` (only the README, no scenario docs) → `click Run --in scenarios`.
**Expected:** a scenario editor, or at least documentation of what a check can assert.
**Happened:** "+ New" made me a stub file:
`{ "description": "", "page": "index.html", "steps": [ { "waitFor": "body" }, { "expect": "h1" } ] }`
I ran it. Result: "✓ week-total · ✓ wait for body · 1 ms · ✓ expect h1 · 1 ms". **A big green tick.** It checks that the page has an h1. It would stay green if every number on the page were garbage. This is precisely the thing that makes me distrust tests, and I did it to myself in thirty seconds, with no warning from the tool about what a useless check it had created. The Docs view is just the app README and doesn't describe scenario steps at all.
**Felt:** Cross with myself and with the tool. Also a small useful discovery: a step is `{ "expect": "<selector>", "text": "<something>" }` and `text` is a substring match — so if the check reads one whole line, e.g. `packed=1 shipped=2 delivered=2 all=5 week=30.5n=3`, then a wrong page saying `week=130.5` cannot contain it. Substring matching is only dangerous when you check a fragment.
STRUGGLE: the bench let me create and run a scenario that asserts an h1 and nothing else, and it showed a green tick. No warning, no "this check proves nothing".
STRUGGLE: no documentation anywhere for the scenario file format; the Docs view only holds the app README (which is out of date — it still talks about sql/001_items.sql).

## Step 11: A check I could trust, and the green tick earned
It replaced my stub with a real scenario and, crucially, printed one exact summary line from SQL that the check could compare whole.
**Did:** `benchdrive sam ask "...overwrite that file with a real check... have the page print one such line from the SQL results, and have the scenario assert the whole line... the week must be pinned... then break it and show me red"` → `view Review` → `Accept all` → `view Scenarios` → `Run`.
**Expected:** green with the numbers I worked out.
**Happened:** Second canvas frame appeared: `index.html#week=2026-11-16`, page header now reads "Week: Mon 2026-11-16 → Sun 2026-11-22 (UTC) · today 2026-11-17 · **pinned**", and there's a "Week of (a date inside the week)" date field in the page. `scenarios/week-total.json`:
`"page": "index.html#week=2026-11-16", "fixture": "week-2026-11-16"`, steps = waitFor #check, expect #week "Mon 2026-11-16 → Sun 2026-11-22", expect #check "packed=1 shipped=2 delivered=2 all=5 week=30.5 kg rows=3", expect tbody#rows tr count 5.
Ran it: **✓ week-total · ✓ wait for #check · ✓ expect #week · ✓ expect #check · ✓ count 5** — and every number is the one I computed by hand.
**Felt:** Relieved. 30.5 kg, 3 rows, packed 1 / shipped 2 / delivered 2 / all 5. The line is printed from SQL, so I can see where the number comes from.

## Step 12: I tried to break my own check
I don't trust a green tick I didn't try to break. I can't write JavaScript, but I could edit the *expected* number in the scenario file — that's the same as asking "would this catch a lie?"
**Did:** opened `scenarios/week-total.json` in the Code view and retyped it with `week=130.5 kg` instead of `week=30.5 kg`, gave it the description "SAM SABOTAGE TEST: expecting the wrong week total on purpose", then `Run`.
**Expected:** red.
**Happened:** Red: **✗ week-total** after 8003 ms — "expected ... `packed=1 shipped=2 delivered=2 all=5 week=130.5 kg rows=3`, got text "packed=1 shipped=2 delivered=2 all=5 week=30.5 kg rows=3"". So the check really does read the whole line and really does compare the number. It is not fooled by 130.5 vs 30.5.
Then I put the right number back and ran it again: green, 4 steps, "just now".
**Felt:** That is the moment I started trusting this thing. A check that goes red when I lie to it is a check.
STRUGGLE: to break it I had to hand-edit a JSON scenario file. There is no "run this check with a wrong number" button; I got there by editing the expectation, which only works because I'm comfortable editing text files.

## Step 13: Last check — the data behind the number, on the test instance
**Did:** `view Data` → clicked "Test" (switches to the test instance) → "SQL query…" → `SELECT id,destination,weight_kg,status,date FROM shipments WHERE status IN ('shipped','delivered') AND date BETWEEN '2026-11-16' AND '2026-11-22'`.
**Expected:** the three rows that make up 30.5 kg, and no Oslo.
**Happened:** `2026-11-22 Lyon 2 delivered 20 / 2026-11-16 Reykjavik 1 shipped 10.5 / 2026-11-18 Porto 4 shipped 0`. Oslo's 500 kg is dated 2026-11-15 and is correctly absent. 20 + 10.5 + 0 = 30.5.
**Felt:** Settled. Same rows, same total, three different ways (page, SQL, scenario).

## Verdict

**Did I get what I wanted? Partly — nearly all of it.**
Have: the shipments table (id, destination, weight kg, status, date), counts per status, total weight shipped this week with the exact rows listed underneath, the SQL printed on the page, a decent test dataset (32 rows), a named fixture with every edge case I asked for (Monday, Sunday, the Sunday before, a zero weight, a decimal, a big weight, and weeks with nothing in them), a scenario that checks the numbers, a pinned week so the check doesn't rot next Monday, and — the thing I actually came for — a demonstrated RED result when the number is wrong.
Not have: I never saw the empty week on screen. The fixture has empty weeks and the page has a week picker, but I didn't get round to pinning 2026-11-23 and looking at it. That was one of my own edge cases and it is still unchecked. The README in Docs still describes the old to-do-list app.

**Hardest moment:** the agent's second and third replies. My message was answered with "was discarded", then with a leftover probe file (`scenarios/zz-probe2.json` containing `"text": "THIS-IS-NOT-THERE"`) proposed as a change to my app, then with a comment-only tweak — three turns, no scenario. I very nearly concluded the agent couldn't do it.

**Would I come back?** Yes, and I'd come back differently: one thing per message, with the numbers spelled out by me first, and I'd run tests myself instead of believing the agent's summary. And I'd check every new scenario actually goes red before I trust it.

**Three struggles that mattered most:**
1. **A green tick that proved nothing.** I clicked "+ New" in Scenarios, got a stub with `expect: "h1"`, ran it, and got a big ✓. The bench happily shows a pass for a check that would stay green with every number on the page wrong. Nothing warned me. This is the single most dangerous thing I met.
2. **The check's text comparison is a substring match.** The agent proved `0.5` passes against `30.5`. Only by making the page print one whole line (`packed=1 … week=30.5 kg rows=3`) did the check become trustworthy. Nobody told me this; I'd have used it as-is.
3. **The agent lost my question.** "was discarded", an unanswered three-part message, leftover probe files in my app, and two turn timeouts. When it did engage it found a real bug (SQL handle cached at module load died after a reset), so the work is good when it happens — getting it to happen was the hard part.
