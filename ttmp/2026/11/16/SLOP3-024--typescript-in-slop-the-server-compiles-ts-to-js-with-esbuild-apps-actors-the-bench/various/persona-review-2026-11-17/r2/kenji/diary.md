# Kenji's diary — live meetup poll

## Step 1: Get my bearings on this bench thing
I've got a monthly meetup with 80 people and I want a live poll they can vote
on from their phones. First I need to see what I'm looking at here.
**Did:** `benchdrive help` then `benchdrive kenji look`
**Expected:** some kind of editor with a chat box.
**Happened:** It showed a screen with a chat with "Claude", a Canvas with "Frame 1: index.html", Code/Console/Inspector views — and it was showing an app called "devon-kanban", not mine. There's a list of layouts and stuff about "evals" and "proposal". A bit much at once.
**Felt:** impatient — I want my app, not somebody's kanban.

## Step 2: Make my own app
I don't want to poke at someone else's kanban, I want my poll app. New app, server-backed, because votes need to be shared and one-per-person.
**Did:** `new-app kenji-poll`, picked "Page with server code", typed the id and "Live Meetup Poll", clicked Create.
**Expected:** a blank app I can fill in.
**Happened:** It created it straight away: a "Live Meetup Poll" page with an "Add an item" field, and the header said "store: draft 1 no dev instance". Fine.
**Felt:** good — that was quick.

## Step 3: Ask for the whole thing at once
I know how long back-and-forth takes, so I wrote the whole spec in one message: host screen, phone screen, live bars, one vote per person, close vote, history.
**Did:** `ask` with the full six-point spec, plus "I'll test with two frames side by side" and "tell me how I switch a window between host and audience".
**Expected:** it builds it, probably asks me a question or two.
**Happened:** 12 minutes later it had written 6 files and put them in a **proposal** — "These changes are in a proposal: a copy of your app. Your app does not change until you accept them." with Review / Accept. So nothing happened until I clicked Accept. There was also a line "Tool conversation exceeds local context budget" and it never answered my question about switching windows.  But the preview in the frame already showed a poll header, so it did build something.
**Felt:** productive but a bit annoyed — nobody told me I'd have to accept things, and it skipped my question about how to switch windows.
STRUGGLE: Work landed in a "proposal" I had to find and accept before anything showed in my app.

## Step 4: Accept and find the host screen
**Did:** clicked `Accept`, then looked at frame 1.
**Expected:** the poll, ready to go.
**Happened:** frame 1 just said "📊 Live Meetup Poll / Host screen / ☕ Waiting for the host to open a question…". I couldn't see any form. I clicked "Host screen" in the frame — nothing, because I was in **Select** mode ("a click picks the element instead of using the app"). I had to click "Play" in the header first. Then clicking "Host screen" worked and my form appeared: question field, Option 1, Option 2, "+ Add option", "Open voting", and "Earlier this evening — No earlier questions yet."
**Felt:** that Select/Play thing cost me two clicks and I still don't fully get why clicking text is sometimes "editing" and sometimes "using the app".
STRUGGLE: Had to discover Play mode before the app would respond to my clicks.

## Step 5: Two frames, host and audience
I want to watch a vote land from the audience side while the host chart is on screen.
**Did:** filled in question "Which topic for next month?" with 3 options, added a second frame (+ Frame → Phone 375×720).
**Expected:** one frame as host, one as somebody in the room.
**Happened:** the new frame opened on the **audience** screen too (header toggle said "Host screen", i.e. it offers to switch). Good enough: frame 1 = host, frame 2 = audience.
**Felt:** fine, that's the setup I wanted.
STRUGGLE: A new frame starts on the audience screen and there's no obvious "this frame is the host" setting — I only got host in frame 1 by clicking the header toggle there.

## Step 6: THE BIG ONE — does it update live?
**Did:** `frame-click "Open voting"` in frame 1, then `frame-text 2`, then `frame-click "Live coding: CSS art"` in frame 2 and read frame 1 again.
**Expected:** bars appear on the phone with no refresh, and my host chart counts up as people vote.
**Happened:** It just worked, both ways. Frame 2 (untouched) went from "Waiting…" to the question with three big buttons. After I tapped "Live coding: CSS art" on the phone frame, **frame 1 flipped to "1 vote" and "Live coding: CSS art 1 · 100%"** on its own. Frame 2 also turned its buttons into bars and said "Thanks — your vote is in. Watch the bars move as the room votes."
**Felt:** that's the moment I wanted. Genuinely excited — bars moving on the projector.
STRUGGLE: The frame was scrolled out of sight after adding a third frame and clicking inside it threw a "Timeout 5000ms exceeded" error; I had to click "Fit" on the canvas toolbar to bring it back. That error message means nothing to me.

## Step 7: One vote per person?
**Did:** tapped a different option ("Rust for JS devs") on the same phone frame. Then opened a **third** frame to be "another person".
**Expected:** second tap refused; third frame should be a fresh person who can vote.
**Happened:** second tap did nothing. But the third frame ALSO said "You voted: Live coding: CSS art" — so every window in my browser is the same voter. I can't play two audience members from this bench.
**Felt:** stuck on the one thing I actually need to know before I trust this with 80 people.
STRUGGLE: All frames share one voter identity, so I cannot test that two different people's votes both count, or that one person truly can't vote twice.

## Step 8: Close the vote, keep the history
**Did:** clicked "Close voting" in frame 1, then typed a second question ("Second question: drinks after?", two options) and clicked "Open voting" again.
**Expected:** bars freeze, result stays; second question starts; first one moves into history; phones switch to the new question.
**Happened:** All three frames went to "🔒 Voting closed — final result" with "1 vote · final" and "Frozen — the final result stays up." Then the new question appeared on the host and both phone frames instantly, and above the new chart it now read "Earlier this evening / Which topic for next month? / 1 vote · final / … Live coding: CSS art 1 · 100%". Then I voted "Pub around the corner" from frame 2 and frame 1 went to "1 vote" again, live.
**Felt:** this is basically exactly my spec. Slightly suspicious it was this easy — where's the catch?

## Step 9: Ask how "live" works and how voting is policed
I can't stand on stage and hand-wave, and I couldn't test one-vote-per-person myself.
**Did:** one `ask` with two questions: explain "live" in plain words; how does it know who a person is, is one-vote-per-person on the server, and how do I test two different people.
**Expected:** two paragraphs of plain English.
**Happened:** ~3 minutes and it was really good. "Every screen quietly asks the server the same small question about once a second: what's the current question, what are the counts… the page just stretches the bars to match." It said the vote is a row tied to a visitor id from the session, checked on the server (actor.ts:186) *and* backed by a unique database index, and it added a test (`scenarios/one-vote-per-person`) where it planted a vote from "audience-seat-7" and a second vote from the same seat was refused. It also ran the test with a wrong expectation first to prove the test can fail. That's the kind of thing that makes me trust it.
Downsides: it told me "canvas frames are all you, always" — so I genuinely cannot play two people here, I need a real second device. And it landed all this in yet another **proposal** to accept.
**Felt:** relieved about the vote rule, mildly annoyed about the accept-dance every time.
STRUGGLE: Second acceptance round needed; every answer also brings a proposal I must click through.

## Step 10: The three questions before the meetup
Phones in the room need a link and a QR, 80 phones hammering it, the vote-at-the-same-instant race, and that "1 issue" in the header.
**Did:** one `ask` with all three.
**Expected:** a link/QR, a yes/no on 80 phones, and "the issue is harmless" or a fix.
**Happened:** It worked for **15 minutes** and then... nothing. No answer at all. What I saw scrolling by: "Found the '1 issue' candidate already: one TypeScript error left in actor.ts:183 ('q' is possibly 'null')", "The output got clipped", "The reads were fine but the model-question formatting bounced" — then "This turn ended… Nothing in the app changed in this turn." So it diagnosed my issue but never told me anything, and 15 minutes were gone.
**Felt:** furious. This is the second time a long message of mine got a shrug or a timeout.
STRUGGLE: A 15-minute turn ended with no answer to any of my three questions — and I only know the "1 issue" is a TypeScript null error because I read its working notes.

## Step 11: Publishing — and the wall
I published: clicked "Publish" in the header → dialog "Publish kenji-poll" → "draft 8 → main (first publish)", "your dev instance runs draft 8: ok", "no production instance yet: nothing serves main" → clicked "Publish draft 8".
**Expected:** a link I can send to the room.
**Happened:** "Published draft 8 to main" — and then "**Your app is published, but it has no web address yet. An administrator of this server gives it one (a mount: slop mount set --host <host> --path /kenji-poll …)**". So publishing was only half of it; I can't hand anyone a URL without an admin. The agent also said it can't make a QR code without adding a library, and would need a `slop vendor` command run first.
**Felt:** deflated. The app works and I still can't put it in 80 people's hands without asking a stranger for a mount.
STRUGGLE: "Publish" does not produce a URL; an administrator has to give the app a web address. And no QR without extra plumbing.

## Step 12: The projector
The chart is what 80 people stare at, so I added a Desktop 1280×800 frame as a stand-in for the projector, switched it to the host screen and took a screenshot.
**Did:** + Frame → Desktop 1280×800, `frame-click "Host screen"`, `frame-shot`.
**Expected:** a big chart I could read from the back row.
**Happened:** the whole host screen is a narrow card floating in the middle of a huge dark page — the question is one line of medium text and the bars are short and thin. Most of the projector is empty. Readable on my laptop, weak from row 8.
**Felt:** "we're nearly there" — this is a look problem, not a wiring problem.

## Step 13: Projection view fixed, and one more live check
**Did:** accepted the proposal, then on the desktop frame: "+ New question" → typed "Final dry run: who is demoing next?" with "Me, live" / "A volunteer" → "Open voting"; then tapped "A volunteer" on the phone frame (frame 2).
**Expected:** big readable chart on the projector frame, still live.
**Happened:** The host screen is now a real projection view: form folded away behind "＋ New question" / "Hide the form — show the chart", the question huge, bars wide and thick, "1 vote" big at the top, "● Voting open — live" badge — and the type error is gone too ("0 issues"). Live still works: the phone frame picked up the new question on its own, and after I tapped "A volunteer" the projector frame went to "A volunteer 1 · 100%" with the bar filled green, no refresh. Its own notes said it reloaded and measured my desktop frame to check.
**Felt:** ready. This is what I'd want on the wall at the meetup.
STRUGGLE: The paste-ready message for the administrator I asked for wasn't in what I could read of the reply; I found the technical bit ("slop mount set --host <host> --path /kenji-poll") in the publish dialog and "polls about every 800 ms" in the README, so I can write it myself — but I asked for the text and didn't get it.

## Verdict
**Did I get what I wanted:** yes. A host screen that opens a question with options, phone screens that vote, bars that grow live on every screen without refresh, one vote per person enforced server-side with a database index, close that freezes the result everywhere, and a history of the evening under "Earlier this evening". Plus a projection view I didn't even ask for until I saw the small bars on a big frame.
**Hardest moment:** the 15-minute turn that answered none of my three questions — I watched "Found the '1 issue' candidate already", "The output got clipped" scroll past and then "Nothing in the app changed in this turn." For a minute I thought the whole thing was going to be like that.
**Would I come back:** yes, and I'd bring the next meetup's app. But I'd write shorter messages and expect to click Accept a lot, and I'd know up front that "publish" alone doesn't give me a URL.
**Three struggles that mattered most:**
1. Every round of work lands in a proposal I have to find and Accept before anything exists in my app. Three separate times.
2. A 15-minute turn with zero answers, and separately a 12-minute build that ended with "Tool conversation exceeds local context budget" and skipped my question about switching windows.
3. Publishing gave me "no web address yet — an administrator of this server gives it one", so I still can't put this in 80 people's hands; and I can never test two different voters, because every frame on the canvas is me.
