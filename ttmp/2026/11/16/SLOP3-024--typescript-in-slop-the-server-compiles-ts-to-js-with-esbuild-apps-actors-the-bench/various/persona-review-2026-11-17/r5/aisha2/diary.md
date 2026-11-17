# Aisha's diary — aisha-shifts2

## Step 1: Get my bearings
Opened the bench. My shift app is showing: two shifts (Pack boxes Sat Mar 14, Greet clients Sun Mar 15), both full, sign-up and cancel-by-phone forms visible. Old chat had a quiz mix-up that got rejected — good, nothing of mine was touched.
**Did:** benchdrive aisha2 look / frame-text
**Expected:** my shifts app, working
**Happened:** exactly that, shifts and sign-up forms visible
**Felt:** relieved — right app, right place

## Step 2: Ask for the no-show record feature
Asked in plain words: tick who came after a shift, 3 no-shows blocks sign-up, I can clear them.
**Did:** benchdrive aisha2 ask "I want to add a no-show record..."
**Expected:** it builds it and shows me it working
**Happened:** built in a proposal; demoed with "Late Larry" missing 3 past shifts, got blocked, sign-up refused. Found+fixed a bug where the refusal message got wiped. 2 test scenarios added; one still failing (browser storage carries coordinator login between test runs).
**Felt:** impressed it found the message-wipe bug itself; a bit nervous the test wasn't green yet.

## Step 3: Try the coordinator view myself (preview)
Switched to Play mode (the "P" keystroke typed stray "PP" text into the page instead — had to click Play in the header). Logged in with my code, ticked Larry as "came" on Nov 14 (saved, shows "(came)"), left him unticked on Nov 15 and Nov 16 and saved.
**Did:** frame-click on tick box + Save who came
**Expected:** a No-shows panel with Larry's count appears
**Happened:** attendance saves fine and shows "(came)"/"(no-show)", but no No-shows panel anywhere on the page
**Felt:** puzzled — Claude said there'd be a panel with counts and a Clear button
STRUGGLE: Play mode toggle via "P" key didn't work for me; and the No-shows panel didn't appear after 1-2 no-shows.

## Step 4: Panel mystery solved - real bug found
Claude explained: my demo-era "cleared" flags made the panel hide (re-recorded no-shows didn't un-clear). It fixed the rule (re-saving attendance is the final word), extended the no-show-block scenario to cover it, and the panel now showed "Late Larry · 2 no-shows [Clear]".
**Did:** my own testing surfaced it; Claude fixed + added regression steps
**Expected:** panel shows counts
**Happened:** panel showed 2 no-shows; Clear gave "Cleared 2 no-shows for Late Larry. They can sign up again." and hid itself
**Felt:** glad I poked at it myself — found a real bug the agent's own demo missed
## Step 5: Accepted the no-show proposal
**Did:** clicked "Accept the changes"
**Expected:** feature in my draft
**Happened:** "Accepted ... the changes are in your draft now"; draft frame back to volunteer view
**Felt:** good — feature 1 done

## Step 6: Ask for the weekly roster CSV
Asked for: from coordinator view, pick a week, download CSV with names + shifts only, no phones.
**Did:** benchdrive aisha2 ask "Next feature, please: a weekly roster..."
**Expected:** working download
**Happened:** panel built with week picker; download didn't fire yet — Claude traced it to a broken date pattern (lost backslashes). Also fixed my stray "PP" text and a handler crash.
**Felt:** reassured it keeps finding its own bugs, but I want to see it download before accepting.

## Step 7: Try the roster download myself
Set up the preview myself: added "Load vans" Wed Nov 25, signed Rosa up from the volunteer side, went back in as coordinator, picked week Nov 23 and hit Download CSV.
**Did:** frame-clicks and frame-types in Play mode
**Expected:** a CSV file for the warehouse
**Happened:** "Downloaded roster-2026-11-23.csv — 1 sign-up." The roster-csv scenario checks the file itself: names + shift/date/task, no phone anywhere, and that volunteers never see the section.
**Felt:** that's what I asked for. But I stumbled into a raw error message on the volunteer page.
## Step 8: Found a raw error leaking to volunteers
When I exited the coordinator view once, the volunteer page showed "listRoster: at /code: minLength: got 0, want 1" — a raw server error, not a friendly message.
**Did:** noticed in frame-text
**Expected:** volunteers should never see server jargon
**Happened:** raw error visible; I'll ask Claude to fix before accepting
STRUGGLE: my clumsy click hit the exit button — but that accident revealed the leak.

## Step 9: Raw-error leak fixed
Claude traced the leak end to end (empty code box → server jargon → shared header message line) and fixed it at four layers: required field, page-side check, empty-saved-code fix, and a friendly() filter on all six error spots. New scenario friendly-code-error; suite 4/4 green.
**Did:** asked; watched it fix and test
**Expected:** no jargon anywhere for volunteers
**Happened:** exactly that; blank submit now shows nothing at all, wrong code shows "That coordinator code is not right."
**Felt:** my accident turned into a real improvement across the whole app
## Step 10: Accepted, ran the suite myself, privacy check
Accepted the roster proposal. Opened Scenarios view: four tests with plain-word descriptions. Ran all: "All 4 scenarios passed". Volunteer view shows first names only, no phone numbers anywhere.
**Did:** click Accept, Scenarios → Run all, frame-text grep for phones
**Expected:** green suite, privacy intact
**Happened:** both
**Felt:** done — this is what I came for

## Verdict
**Did I get what I wanted? Yes.**
- No-show record: tick who came on past shifts, 3 no-shows blocks sign-up with a polite message, I can clear them. Tried it myself in the preview with my own hands.
- Weekly roster CSV: week picker + Download CSV in my coordinator view; "Downloaded roster-2026-11-23.csv — 1 sign-up." Names and shifts only, phones never even read from the database for the file.
- Re-runnable tests: four scenarios on the Scenarios tab (record-attendance, no-show-block, roster-csv, friendly-code-error), each described in plain words, roster-csv actually opens the downloaded file and checks it. I ran "Run all" myself: 4/4 green. Each was proven able to fail on purpose.
- Privacy: untouched, verified by me and by the tests.
**Hardest moment:** the bench's mode switching (my "P" keypresses typed stray text into the app instead of entering Play mode), and a stretch where the No-shows panel didn't appear — which turned out to be a genuine bug my own testing caught.
**Top three struggles:**
1. STRUGGLE: Play/Select mode confusion — "P" keystrokes landed in the app as stray "PP" text; had to click Play in the header instead.
2. STRUGGLE: No-shows panel invisible after recording no-shows on previously-cleared records — real bug, fixed after I reported it.
3. STRUGGLE: Raw server jargon ("minLength") leaked onto the volunteer page when I fumbled the code form — fixed across all six error spots.
**Would I come back?** Yes — I could follow everything it did, every test was explained in plain words, and nothing passed that I couldn't see the meaning of.
