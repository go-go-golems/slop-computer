# Diary — Aisha, volunteer coordinator

I need a shift sign-up app for the food bank. Starting from a brand-new app ("aisha-shifts2", template with server code since we need shared data and rules that can't be cheated).

## Step 1: create the new app
I picked "Page with server code" because many volunteers share the same list and the rules (waitlist, privacy) must live on the server, not be cheatable.
**Did:** `benchdrive aisha new-app aisha-shifts2 "Page with server code"`
**Expected:** a fresh starter page
**Happened:** app created, starter page with "Add an item" list
**Felt:** good, ready to describe what I want

## Step 2: sending my long wait, browser died mid-send
STRUGGLE: the bench's browser closed while the agent was reading my first message, and I had to find my way back to my app.
**Did:** described all 6 rules (shifts, sign-up, waitlist, auto-promote on cancel, self-cancel, privacy + coordinator code), then `open-app aisha-shifts2` after a restart
**Expected:** the agent would just build it
**Happened:** first send crashed ("browser has been closed"), the shared bench showed someone else's app; reopening my app from the menu worked
**Felt:** a bit rattled, but my app was still there

## Step 3: the agent builds the whole app and finds a privacy bug itself
**Did:** re-sent my description; waited while it worked (~8 min)
**Expected:** a working page
**Happened:** it built server rules + page, tested waitlist/promote/privacy itself, and caught a real privacy bug: a CSS rule was overriding the hiding of the coordinator-only form so EVERYONE could see it. It fixed that and wrote automated checks. Coordinator code: harvest2026.
**Felt:** impressed — that's exactly the kind of leak I worry about

## Step 4: accepting the proposal
**Did:** clicked "Accept the changes"
**Expected:** my draft becomes the food-bank app
**Happened:** app renamed "Food Bank Shifts", shows Coordinator code box, "No shifts yet."
**Felt:** ready to test it myself now

## Step 5: testing as coordinator — adding shifts
**Did:** Play mode, unlocked with code harvest2026, added "Pack boxes" (Nov 21, 9–12, needs 2) and "Sort donations" (Nov 21, 1–4, needs 1)
**Expected:** both shifts to appear in the list
**Happened:** first add worked; second one silently did nothing at first — the form had cleared the date and times after the first add but kept task/number, so I retyped them and it worked. Both shifts show with "0 of 2 spots filled" etc.
**Felt:** small stumble, my own fault for not refilling everything; but it would be nicer if it told me why
STRUGGLE: second shift add did nothing with no explanation — fields reset differently (date/times cleared, task kept)

## Step 6: volunteer tests — sign-up, waitlist, cancel, auto-promote
**Did:** in Play mode as a volunteer: Maria Lopez (555-0101) and Chen Wei (555-0102) signed up for Pack boxes (needs 2), then Dana Reed (555-0103); then Maria found her sign-up by phone and cancelled
**Expected:** Dana lands on waitlist; after Maria cancels, Dana moves in; volunteer view shows first names only
**Happened:** exactly that. Full shift shows "Full · 2 of 2 spots filled · 1 on the waitlist", button becomes "Join waitlist", message "you're #1 on the waitlist". After cancel: list shows Chen and Dana, waitlist count gone, "No sign-ups found for that number" for Maria. Volunteer view only ever showed first names (Maria, Chen, Dana) — never a phone number
**Felt:** this is exactly what I asked for — the waitlist didn't lose anyone

## Step 7: asking for the privacy proof + reporting the form bug
**Did:** locked the coordinator view, then asked the agent to PROVE volunteers can't see phones (not just hidden on screen), and reported the silent add-shift failure
**Expected:** an explanation I could trust
**Happened:** it added a temporary probe to capture what the server actually sends, and found the root cause of my form bug: the browser's built-in "required" check was silently swallowing the click. Fixed with a clear "Please fill in the date and times" message and all-or-nothing form clearing. All three automated checks passed.
**Felt:** the explanation about "required" checks was jargon-y, but the fix works and the cause made sense once explained
STRUGGLE: agent's replies kept getting cut off in the progress log, so the actual proof only appeared in the middle of its work log — I had to dig for it

## Step 8: the proof itself, in its words
**Did:** read its work log
**Happened:** "The volunteer's raw data has {\"name\":\"Maria\",\"status\":\"signed\"} — no phone field, no last name — while the coordinator's has the full \"Maria Lopez\",\"phone\":\"5550001111\"." It also confirmed the temporary probe was removed from the page afterward.
**Felt:** relieved — that's the actual data going to a volunteer's browser, not just what's drawn on screen

## Step 9: accepting the fixes
**Did:** clicked "Accept the changes"
**Expected:** my draft gets the form fix and cleaned-up page
**Happened:** accepted, 0 issues, draft healthy
**Felt:** good

## Step 10: verifying fixes on the real draft + harder waitlist test
**Did:** tested the empty-form message (now says "Please fill in the date and times."), then put Eve and Frank on the waitlist of the full shift and had Chen cancel
**Expected:** Eve (first on waitlist) gets the spot, Frank stays #1
**Happened:** exactly that — order preserved; Frank's "Find my sign-ups" shows "#1 on the waitlist" with a Cancel button; wrong code says "That coordinator code is not right."
**Felt:** confident — the waitlist never lost anyone

## Step 11: my own coordinator code + publishing
**Did:** asked for code 'sunshine42' instead of the agent's pick, and how to share the app; then clicked Publish → gave it a web address
**Expected:** a link I can send volunteers
**Happened:** app is live at http://apps.localhost:18494/aisha-shifts2 ; sunshine42 unlocks it; coordinator view shows full names, phones, and the waitlist ("1. Frank Osei · 5550105 · waiting")
**Felt:** proud — this is ready for the volunteer team
STRUGGLE: publishing needed a second click ("Give it a web address") that I only noticed because the dialog told me

## Verdict
**Yes** — I got exactly what I wanted: shifts I can add, sign-ups with waitlist that auto-promotes in order when someone cancels, self-service cancel by phone number, and phones visible only with my code. The agent proved privacy at the data level (volunteer's browser receives only first name and status, no phone field at all), which was my biggest worry, and it even caught a CSS bug that would have leaked the coordinator form to everyone.

**Hardest moment:** the browser crash mid-conversation at the very start, and digging the privacy proof out of the agent's long cut-off work logs.

**Would I come back?** Yes — for adding features like shift reminders or removing volunteers who no-show.

**Three struggles that mattered most:**
1. The shared bench browser died on my first message and showed someone else's app; I had to find my way back.
2. Adding a second shift silently did nothing (browser "required" checks swallowed the click) — fixed, but I had to notice and report it.
3. The agent's long replies got cut off in the progress view, so the privacy proof I asked for plainly was buried mid-log.
