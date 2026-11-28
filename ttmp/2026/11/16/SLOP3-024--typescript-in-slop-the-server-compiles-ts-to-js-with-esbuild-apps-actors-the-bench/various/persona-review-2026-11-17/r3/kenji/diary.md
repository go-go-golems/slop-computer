# Kenji — live meetup poll

## Step 1: Get my bearings on this bench thing
I run a monthly meetup, 80 people, and I want to stop doing polls by shouting "raise your hand". I want a live poll on everyone's phones.
**Did:** `benchdrive kenji look`
**Expected:** some kind of blank canvas with a chat box, like the demo I saw.
**Happened:** It opened into somebody else's app ("Food Bank Shift Sign-up", aisha-shifts) with a big chat thread about volunteers and coordinator codes. Layout has Agent, Canvas, Console, Code, Inspector panels.
**Felt:** confused — am I in someone else's project? Where's my app?

## Step 2: Make my own app
I don't want someone else's shift app. I want mine, and I know I need real shared data (everyone votes at once), not a notebook.
**Did:** `benchdrive kenji new-app kenji-poll2` then `new-app kenji-poll2 "Page with server code"`
**Expected:** a fresh empty app called kenji-poll2.
**Happened:** Dialog with two templates: "Simple page" and "Page with server code" (the second said it's for "many people share the same data, or for rules people must not get around"). Created it; canvas shows a stub page with "kenji-poll2", a field "Add an item" and an Add button. Notice: "2 issues".
**Felt:** good — that template description is literally my use case (shared data + one vote per person).

## Step 3: Tell the agent the whole thing in one go
I hate dribbling requirements. So I described the entire evening: host mode with question+options+Open voting, audience mode on phones, one vote per person, a live bar chart that updates without refresh, Close voting that freezes the result, and a history of earlier questions.
**Did:** one long `ask` with all 5 points + "how does the live updating actually work here — websockets or polling? don't hand-wave"
**Expected:** agent starts building and gives me a link/code to test.
**Happened:** `✓ eval 1 · app.info, files.list, files.read`, then literally: "The model provider request failed. Retry or choose another model. Nothing in the app changed in this turn."
**Felt:** annoyed — my whole demo hinges on this thing working, and the first reply is an error message.

STRUGGLE: first ask died with "model provider request failed"; had to re-send the whole request.

## Step 4: Retry, and then watch grass grow
**Did:** re-sent a shorter version of the same request.
**Expected:** maybe 2-3 minutes of building, then a working poll.
**Happened:** Status went to "workspace Proposal: Retry that please…", canvas frame labelled "proposal" still showing the stub "kenji-poll2 / Add an item / Add". After 9+ minutes only one eval logged (`files.read, app.status, app.logs, frames.list, scenarios.list, fixtures.list, app.info`). Timeline shows no new events since 23:32:37. Button says [Stop]. There's a "Review" link.
**Felt:** impatient. Standing in front of the room this thing can't take 10 minutes to think.

STRUGGLE: agent stuck "working" for ~9 min with one eval, no visible progress anywhere (Timeline frozen, canvas showing stub).

## Step 5: Accept the build and look at it
Proposal finished ("Proposal ready: 8 files to review"). It had explained its plan: one page with hash routes (#/host, #/vote), all data in SQL behind the server code, one vote per person enforced by the database (votes primary key is question+visitor), and live updates pushed via room "moments" rather than polling.
**Did:** `click Review` → `view Review` → `click "Accept all"`
**Expected:** the poll appears on the canvas.
**Happened:** Review listed 8 changed files with diffs and an Accept all / Reject pair. After accepting, Canvas already had 3 frames: "index.html" (welcome: "I'm the host / I'm here to vote"), "Host (projector) · index.html#/host (missing) · 1280×800" and "Audience (phone) · index.html#/vote (missing) · 390×844". Host frame: Question field + 4 option fields + [Add question]. Audience frame: "Waiting for the host to open a question... This page updates by itself - no need to refresh."
**Felt:** relieved, mostly. But "index.html#/host (missing)" — missing what?

STRUGGLE: frames 2 and 3 are labelled "(missing)" and I don't know what that means or if it matters.

## Step 6: Create a question as the host (Play mode)
This is exactly the two-frames-side-by-side test I wanted.
**Did:** `key p` (Play), then `frame-type "Your question" "Which JS framework should I learn next?" 2`, Option 1 React, Option 2 Svelte, Option 3 Vue, then `frame-click "Add question" 2`
**Expected:** a question card with an Open voting button.
**Happened:** Host frame now shows "Next up / Which JS framework should I learn next? / React · Svelte · Vue / [Open voting]". Note typing into Option 2 and 3 said "Nothing visible changed" but the values were there when I read the frame.
**Felt:** good, that's quick and obvious.

## Step 7: Open voting, and the phone frame woke up by itself
**Did:** `frame-click "Open voting" 2`, then `frame-text 3`
**Expected:** audience frame stops saying "Waiting for the host".
**Happened:** Host: "Open - voting is live / 0 votes so far". WITHOUT me touching frame 3 it changed to the question, "Your name" field, React/Svelte/Vue radio-ish rows and a [Vote] button. It also showed the share link with a [Copy link] button.
**Felt:** that's the moment I actually smiled. Live works.

## Step 8: Vote as a person from a phone
**Did:** `frame-type "Your name" "Priya" 3`, `frame-click "React" 3`, `frame-click "Vote" 3`
**Expected:** the HOST frame bar chart moves.
**Happened:** Host went "0 votes so far" → "1 vote so far"; bars: React "1 vote · 100%", Svelte 0, Vue 0. Audience: "Thanks, Priya - you voted for "React"." + its own live results. Screenshot of the host frame shows a proper dark projector view with big gradient bars, percentages, and a red [Close voting] button plus the share URL and [Copy link]. Typing/clicking the radio said "Nothing visible changed" but the [x] marker did appear.
**Felt:** impressed. It looks like something I'd actually put on the projector.

## Step 9: Try to be a second person side by side
I test everything on stage as two people: host on the big screen, audience on a phone. So I added a frame.
**Did:** `click "+ Frame" --in canvas`, picked "Phone 375×720", then `frame-click "I'm here to vote" 4`
**Expected:** a second voter, e.g. "Your name" field, vote as Dev.
**Happened:** Frame 4 went straight to "Thanks, Priya - you voted for "React". Live results: React 1 vote · 100%". The new frame is the SAME person as frame 3 — the browser remembers Priya. There's no "not me?" / "change name" on the page.
**Felt:** stuck. I cannot rehearse my own demo. One vote per person is right for the room, but I can't show it working with two people on my screen.

STRUGGLE: no way to be a second, different person in a second frame — new frames inherit the same voter identity.

## Step 10: Close the vote, then a second question
**Did:** `frame-click "Close voting" 2`
**Expected:** final result frozen on the screen and phones closed.
**Happened:** Host: "Voting is closed - final result:". BOTH phone frames (3 and 4) changed by themselves to "Voting is closed - final result:" with the bars. Note: my first `frame-click "Close voting"` timed out (element not stable) until I hit `Fit` to bring the frame back into view.
**Felt:** nice, the whole room would see it freeze at once.

STRUGGLE: clicks into a frame that's scrolled out of sight fail with a timeout; I had to press Fit first.

## Step 11: Second question in the same evening
**Did:** filled the form with "Best thing about meetups?" (The talks / The pizza / The people) and Add question, then Open voting.
**Expected:** new question goes live, old one drops into history.
**Happened:** The form kept the old question's text until I retyped it (fine). Host showed "Next up / Best thing about meetups? / The talks · The pizza · The people". Underneath: "Earlier questions / Which JS framework should I learn next? / Closed · 1 vote" with its bars. Phone frame reset to a fresh voting form with the name still "Priya". Voting "The pizza" moved the host bar to "The pizza 1 vote · 100%" live.
**Felt:** the history is exactly what I wanted. But I still can't get a second person on screen.

## Step 12: Ask about being two people + how "live" works
**Did:** one `ask` reporting what worked, then asking for a way to rehearse as 2-3 different people, warning it must not let the room vote 5 times each, plus asking what "(missing)" means and how live reaches 80 phones / what happens if the wifi blips.
**Expected:** a concrete proposal.
**Happened:** it went into a proposal again and did a lot of work. Reading its reply (had to scroll the chat panel and screenshot it, the text is cut off in `look`):
- "the votes table's primary key is (question_id, visitor_id)... where visitor_id is the server's browser cookie. That's why both phone frames are 'Priya': every canvas frame is the same browser, so the same cookie."
- Rehearsal: a HOST-ONLY "rehearsal votes" box. "it requires your host permission, so the audience can never call it, and it can't weaken the one-vote rule. A ?as=dev URL switch is exactly the thing I won't add: it would let anyone in the room become multiple people too." — I liked that he pushed back.
- Hardening: second lock, "one vote per name per question", because a private window gets a fresh cookie.
- "(missing) label appears when a frame's page can't be found at that moment (typically when the preview rebuilds after a change). It's canvas-only, nothing in the app."
- It also wrote a README with a "How the live updating works" section: no polling; room.emit('poll') after each change, server pushes to every page on the topic, each page refetches once; and if the wifi blips, a page catches up on reconnect/foreground/at worst 10s, and hidden phones stay quiet so 80 phones don't storm the server.
**Felt:** this is the first time it felt like it understood the actual event, not just the feature list. The README paragraph is the plain-words answer I asked for.

STRUGGLE: long agent replies are truncated in `look` ("… 71 more lines"); I had to scroll the chat pane and take screenshots to read them.

## Step 13: Rehearse as several people — this is the bit I came for
**Did:** accepted the proposal (`view Review` → `click "Accept all"`; the second time it needed just the bare label without `--in review`), then in Play mode typed "Dev" in the rehearsal name field and pressed `+1 The talks`, then "Sam" → `+1 The pizza`.
**Expected:** the bars moving as if strangers voted.
**Happened:** Host went 1 → 2 → 3 votes, and the PHONE frame (frame 2) changed by itself each time: "The talks 1 vote · 33.3% / The pizza 2 votes · 66.7%". A yellow chip appeared: "3 rehearsal votes in the counts right now" and a [Clear rehearsal votes] button. Screenshot shows the whole rehearsal panel built into the projector page.
**Felt:** yes. THIS is the thing I could not do before. I can rehearse my own demo now.

## Step 14: Break it on purpose
**Did:** pressed `+1` twice as the same name "Sam", then a real vote from the phone frame as Priya, then Dress rehearsal on a brand new question ("Should we do a summer hackathon?": real vote from the phone for "Only if free pizza" + rehearsal vote as Ana for "Yes, sign me up"), then [Clear rehearsal votes].
**Expected:** refused duplicates, and clear leaves only real votes.
**Happened:** duplicate was silently ignored — nothing on screen at all. Clear worked (3 → 1 vote, only Priya's). The dress rehearsal worked: 2 votes, 50/50 on the host, and the phone frame showed the same.
**Felt:** good, but the silence bugged me — on stage I'd press it twice and not know if the app was dead.

STRUGGLE: second vote as the same rehearsal name did nothing and said nothing; no way to tell "refused" from "broken".

STRUGGLE: the rehearsal chip said "3 rehearsal votes in the counts right now" when there were 2 rehearsal + 1 real; it corrected itself to 2 on the next click.

## Step 15: Report both, and ask what URL to project
**Did:** told it the Ana vote was mine (cast after the clear), and asked for a visible refusal + a correct chip + which URL goes on the projector.
**Expected:** two small fixes.
**Happened:** it dug in and found the real causes, which I could not have found: 1) the refusal WAS shown, but the message renders at y=1072 — 272px below the bottom of my 800px projector frame, so it is invisible, and 2) the chip sums rehearsal votes over every question EVER, closed ones included, while its label says "in the counts right now"; and it also spotted that the actor announces the change before the vote is committed, so a page can refetch stale data (that's why the number was late). Then it went quiet without leaving a proposal; I verified on the draft myself: pressing +1 as "Ana" again now shows a red toast over the chart — ""Ana" already voted in this question - rehearsal votes are one per name too" — and the chip reads "1 rehearsal vote in the counts right now". History still shows both earlier questions with their final bars.
**Felt:** that's the response I wanted: it explained the cause instead of just patching the symptom.

## Step 16: Publish
**Did:** `click Publish --in header` → dialog "draft 11 → main (first publish)" with the migrations listed → `click "Publish draft 11"`.
**Expected:** it goes live for the room.
**Happened:** published. The dialog warned "no production instance yet: nothing serves main". The link on the host screen is a sandbox address: http://sc4af2e59....sbx.localhost:18494/e/emb_.../v/11/index.html?sbn=...#/vote
**Felt:** one loose end. "sbx.localhost" is not an address 80 phones in a room can open. I still don't know what I'd actually put on the projector.

## Step 17: The address question — the honest answer I needed
**Did:** asked what address goes on the projector and whether the welcome page is at the same place.
**Expected:** "here's your public URL".
**Happened:** "right now there is no address 80 phones can open — not even the one on the host screen. The …sbx.localhost:18494/… link is the bench's internal preview address... It will never open on a phone at the venue — you spotted that correctly." Publishing put it on the shelf, but an administrator has to give the app a web address. Then: the address opens the welcome page, projecting the plain address is fine, and don't project it until a question is open because it's live from the moment people open it. Also confirmed what I tested on draft is what's on main.
**Felt:** disappointed but not annoyed — it would have been easy to wave at the link and let me find out on stage. That's the second time it pushed back on the easy answer.

STRUGGLE: the app has no public web address, so I cannot actually run the poll for the room until an administrator assigns one. Nothing the agent could do about it, but it's the difference between "my demo works" and "my meetup works".

## Verdict

**Did I get what I wanted?** Yes, as an app. Live poll with host/audience modes, one vote per person (two server-side locks), a live bar chart that moves on the projector AND on the phones without a refresh, Close voting freezing the final result everywhere, and earlier questions keeping their final charts. Plus something I didn't ask for and now won't run an event without: a host-only rehearsal box so I can be five people from my own laptop.
Not fully as an event: the app has no public address yet, so I can't actually hand 80 phones a link until an admin gives it one.

**Hardest moment:** the start. My first message died with "The model provider request failed", then the second attempt sat at "working…" for about nine minutes with one eval and a frozen Timeline, and I had no way to tell "thinking hard" from "dead". That is the worst possible feeling five days before a meetup.

**Would I come back?** Yes. Once it got going it was fast, it built the right thing from one description, and twice it pushed back on something I asked for because it would have weakened the vote (no ?as=person URL switch) or because a number on my screen was lying to me (the rehearsal chip counting across closed questions). The README's "How the live updating works" section is the plain-words answer I demanded, no hand-waving.

**Three struggles that mattered most:**
1. First ask failed with a model provider error and the retry stalled ~9 minutes with no visible progress — I nearly gave up right there.
2. No way to be a different person in a second frame: every canvas frame shares one browser cookie, so every phone frame was "Priya". Only fixed on my second attempt, with a host-only rehearsal box.
3. The "already voted" refusal was rendering 272px below the bottom of the projector frame, i.e. invisible — I had to report "nothing happens and I can't tell if it's broken" before it was found, and the rehearsal tally chip was counting votes from closed questions too.

Honourable mention: long agent replies are cut off in `look` ("… 71 more lines") and I had to scroll the chat and screenshot it to read the answer to my question.
