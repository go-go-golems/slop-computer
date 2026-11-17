## Step 5: The build, in MY app this time
Told my quiz agent to build (owner-only, auto week label, past weeks mine only). It took ~9 minutes, fixed its own bugs, ran a full weekly-flow scenario plus the two old ones, all passing. It left the proposal for me to review.
**Did:** `ask "Owner-only is exactly what I want… Build it now in our proposal…"`
**Expected:** weekly quizzes built in my quiz app
**Happened:** proposal with teacher's desk, week labels, live week, archive, champion banner. "Proposal ready: 5 files to review."
**Felt:** good, though I watched a couple of console errors appear and disappear while it worked — it caught its own mistakes.

## Step 6: Trying it myself before accepting
Toggled Play mode (first click was swallowed by Select mode), opened the Teacher's desk: My weeks list with LIVE badge, Make live, Edit questions, Board, Start next week's quiz. The new-week form has 10 questions × 4 choices with a radio for the right answer, week label pre-filled (2026-W49). Typed a question and choices — they stuck. Saving with an incomplete question was politely refused. Making W49 live automatically un-made W48 live. Editing W49 kept what I typed. Played as a pupil: typed Aarav, picked 54, Submit → "Thanks, Aarav! You scored 1 / 1."

STRUGGLE: clicking the "correct answer" radio directly timed out twice; had to Tab+Space from the question field instead. Fiddly but got there.

STRUGGLE: after making W49 live, the pupil page kept showing W48 even after navigating and reloading.
**Felt:** this is exactly the kind of thing my pupils would hit.

## Step 7: Reported the stale-week bug; agent found and fixed it
Told Claude what I saw, including what the Data table said (W49 live=1). It found a backwards cache check in the page (pupil's browser remembered the old quiz), reproduced it, fixed it so the server decides the week on every load, and re-ran all checks. Pupil page now shows W49, and Submit scores against the live week.
**Did:** `ask "I found a problem while trying the pupil page myself…"`
**Expected:** a fix without touching my stored scores
**Happened:** fixed and proven in my preview; all three scenarios pass. It also honestly flagged that its own test play shows in the preview only.
**Felt:** proud of myself for catching it, and reassured it checked before touching anything.

## Step 8: Confirmed my data is safe, then accepted
Asked Claude what Accept all + Publish does to my pupils' week 47 scores. Answer, verified with the publish check: publishing copies files, never data; the three DB changes are all additions (a query speed-up, a new column for who made each attempt, and the weeks list that marks W47 live); preview test scores stay in the preview.
**Did:** `ask "Before I accept: what happens to the scores already in my app…"`
**Expected:** clear yes/no
**Happened:** clear yes — "Attempts are never touched: old weeks' scores ride along untouched."
**Felt:** exactly the reassurance I wanted before touching the button.

STRUGGLE: "Accept all" was disabled at first and I couldn't tell why. There were TWO proposals with the same title — an empty stale one from my crashed first message. Rejecting the stale one freed the button on the real one. Scary moment: I had to trust I was rejecting the right one.

## Step 9: Accepted and published
Ran the checks (layout + all three scenarios pass), accepted all, pressed Publish in the header, confirmed. "Published draft 17 to main", the pupil instance followed it automatically.
**Did:** view Review → click "Check layout and scenarios" → Accept all → Publish → confirm
**Expected:** my pupils get the new app without losing anything
**Happened:** exactly that.

## Step 10: Final look at what pupils see
The frame now shows "This week: 2026-W47 · 4 questions", the W47 top-10 with "Priya 4 / 4" still on it, and my "Teacher's desk" link at the bottom. Dev data confirms W47 is live and the old attempt rows are untouched.
**Felt:** this is my weekly routine now.

## Verdict
**Did I get what I wanted?** Yes. Weekly quizzes are live: I type each week's 10 questions in the Teacher's desk (no code, no JSON), pupils see only the week I make live, scores are kept per week, the board shows this week's top 10 plus last week's champion, and old weeks stay in my archive. Published, with my pupils' existing scores untouched.
**Hardest moment:** my browser tab crashed and reopened on someone else's app, so my "build it" message went to the wrong agent and it started rebuilding the food bank app. I had to stop it and reject that proposal.
**Would I come back?** Yes — this is how I'll start every week now.
**Top three struggles:**
1. The tab crash silently pointed my chat at the wrong app; the header app name is too easy to miss mid-conversation.
2. Two same-titled proposals (one stale and empty) made "Accept all" disabled with no explanation of why.
3. Clicking the correct-answer radio in the teacher form didn't work; Tab+Space was the workaround.
