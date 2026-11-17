## Step 2: Asking for the leaderboard — and how to do it safely
I wanted to know the safe way to try this, so I asked the agent straight away, mentioning that my class is using the quiz right now.
**Did:** `benchdrive priya ask "…top 10 scores of the week with first names only… how do I try a change safely without it going live for my students?"`
**Expected:** An explanation of proposals/drafts and then maybe a first draft.
**Happened:** It took 42 seconds and made 9 evals. It said "I've confirmed I'm working in the proposal sandbox, so nothing goes live." The workspace changed to "Proposal: Hi! I teach 8th grade sc…" and there was a notice "Proposal ready: 3 files to review". The Code list now shows actor.js M, index.html M, sql/002_leaderboard.sql M — but with the word "proposal" next to the frame. The frame now also shows "This week's top 10 · 2026-W47 · first names only" and one row "Admin 4 / 4".
**Felt:** Impressed it understood, but a bit uneasy — it never actually told me the words "proposal" and "draft" or how I publish/undo. It just went ahead.

## Step 3: Checking the quiz still works in the preview
My big worry is that students' quiz keeps working, so I wanted to take the quiz myself in the preview.
**Did:** `click "Play" --in header`, then `frame-click H2O`, `Mercury`, `Gravity`, `Carbon dioxide`, `Submit`
**Expected:** The quiz to accept my answers, give me a score, and my entry to appear in the top 10.
**Happened:** First click told me: "The bench is in Select mode; in Select or Comment mode a click picks the element instead of using the app. Click 'Play' in the header to use the app." After I found Play, all four answers ticked ([x] H2O, Mercury, Gravity, Carbon dioxide). But clicking Submit said "Nothing visible changed" — no score, no "thanks", nothing. The top 10 still just shows one row: "Admin 4 / 4".
**Felt:** Worried. Also confused that there's no place to type a student's name.
STRUGGLE: Had to discover Play mode myself — my first click just selected a form element instead of answering the question.
STRUGGLE: Submit does nothing at all in the preview; no score, no confirmation. I can't tell if the quiz is broken or just quiet.
STRUGGLE: The top 10 shows "Admin" — not a student's first name. That's not what I asked for.

## Step 4: Pointing out the two problems
I wanted the agent to actually fix the missing name box and get 'Admin' off the class leaderboard, and I still hadn't been told how to publish or undo.
**Did:** `benchdrive priya ask "…pressing Submit did nothing… no place to type a student's name… top 10 shows one row called 'Admin 4/4'… how do I put this live, and how would I undo it?"`
**Expected:** A fix (name box, no admin on the board) plus a plain-English explanation of publish and undo.
**Happened:** 1 min 16 s, 9 evals. It agreed with me: "Submit does record and score when I drive it — so the breakage is in what a student actually sees." and "the attempt was stored as student: 'admin', because there is no name field at all". It said it wanted to save a fixture of a realistic class before changing anything. After that the preview now says "You scored 1 / 4" after Submit (so the score does appear, I just hadn't scrolled). But there's still no name box and the board still shows "Admin 4 / 4".
**Felt:** Glad it took me seriously and said it agreed — but I asked three things and got an explanation of one. No answer about publishing or undoing.
STRUGGLE: I asked "how do I publish / how do I undo" twice now and still haven't been told.
STRUGGLE: The frame is much taller than the little 375x720 window, so results happening below the fold look like nothing happened.

## Step 5: Finding Publish and Reject myself
I got impatient about "how do I publish", so I went looking at the tabs in the top corner.
**Did:** `view Review` (found "Proposals — copies of draft; nothing lands until you accept" with "Accept all" and "Reject"), then `frame-type input Priya`, `frame-click H2O/Mercury/Gravity/Carbon dioxide`, `frame-click Submit`, and a whole-bench `shot b1.png`.
**Expected:** The leaderboard, with my own test score on it.
**Happened:** Review says proposals are "copies of draft; nothing lands until you accept" with Accept all / Reject. In the preview typing my name worked and Submit finally said "Thanks, Priya! You scored 4 / 4." But the "This week's top 10" section is now GONE from the page — it isn't anywhere in the frame text. The whole bench has a "Publish" button top right and "draft 1 dev ok" next to it.
**Felt:** Half relieved (I now know where Accept/Reject and Publish are), half alarmed — the leaderboard I asked for has disappeared.
STRUGGLE: Had to hunt for Publish/Accept/Reject on my own; the agent never told me.
STRUGGLE: Clicked Submit with only some questions answered and nothing happened at all — no message, no hint that I'd missed questions.
STRUGGLE: Switching tabs to Console/Timeline made the canvas disappear ("The Canvas is not showing; open it with: view Canvas") and my clicks silently did nothing for two commands.

## Step 6: Board back, and finally the plain-English instructions
I needed to know the exact clicks before I'd dare touch my students' quiz.
**Did:** `frame-text 1` (board is back: "This week's top 10 · 2026-W47 · first names only · Priya 4 / 4"), `view Agent`, then `ask "…say the last bit in three short lines, like you'd tell a colleague…"`
**Expected:** Three short lines: go live, undo, what students notice.
**Happened:** It explained the board had been hidden because the leaderboard was returning nothing on my preview, "Priya 4 / 4" now, Admin gone. Then the three lines:
- Go live: "open the Review tab → press Accept all (that moves the work into your draft) → then press Publish and confirm. Publish — not Accept all — is the click that reaches your students."
- Undo: "Reject only works before you press Accept all ... After you've published, tell me and I'll put the old version back and the two of us publish it again."
- Students notice: "a 'Your first name' box, a 'Thanks, Ava! You scored 4 / 4.' message after Submit, and a 'This week's top 10' list of first names only".
It also warned that Publish alone does nothing until Accept all, and that the board hides itself when there are no attempts yet this week.
**Felt:** Relieved. This is the first time anyone told me plainly how to go live and how to back out. Slightly nervous that after publishing there's no one-click undo — it has to go through the agent.
STRUGGLE: Took four asks before I got the publish/undo instructions in words I could follow.

## Step 7: Accepting it into my draft, then spotting fake names
The preview worked, so I followed the three lines: Review tab → Accept all.
**Did:** `view Review`, then `click "Accept all" --in Review`
**Expected:** The change to move into my draft, still not live for students.
**Happened:** "Notice: Accepted 7 changes into draft 9". Workspace changed from "Proposal: …" to "draft", store "draft 9 dev on 1". The frame is now titled "PLAY DRAFT". The board was there — but full of made-up names: Sofia 3/4, Emma 3/4, Noah 2/4, Isabella 2/4, Ethan 2/4, "Priya 2/4".
**Felt:** Pleased the click worked — then a jolt at the fake names.
STRUGGLE: The agent's test scores came along with the change into my draft; nothing warned me they'd be there.

## Step 8: Getting the test scores out
My students must never see made-up names.
**Did:** `ask "…the draft's top 10 is showing Sofia, Emma, Noah… those are your test scores… Please clear the test scores out of my draft, and tell me if it's then safe for me to press Publish."`
**Expected:** It clears its test rows and says whether Monday is safe.
**Happened:** It agreed: "those are my test rows, and they live in the dev instance's data, which Accept all carried over with the draft." It ran `app.reset`. Then the reply ended mid-thought and the bench said: "was discarded". The board is now gone from the draft — the page looks like the old quiz again with only [Submit] at the bottom.
**Felt:** Unsettled. My reply just vanished and the leaderboard disappeared again — is the feature still there or not?
STRUGGLE: My question to the agent came back "was discarded" after a reset, so I lost the answer about whether publishing is safe.
STRUGGLE: After the reset the board vanished again, which looks exactly like a broken feature to me.

## Step 9: Checking the draft really works, then publishing
I wasn't going to publish a quiz I hadn't taken myself.
**Did:** `frame-type input Priya`, `frame-click H2O/Mercury/Gravity/Carbon dioxide`, `frame-click Submit`, `frame-text 1`
**Expected:** The draft to behave like the preview did.
**Happened:** "Thanks, Priya! You scored 4 / 4." and "This week's top 10 · 2026-W47 · first names only · Priya 4 / 4". The fake class was gone; only my own play was on the board.
**Felt:** Confident for the first time. That's the whole quiz, working.

## Step 10: Pressing Publish
The thing I'd been nervous about all along.
**Did:** `click "Publish" --in header`, then `click "Publish draft 9" --in dialog`, then `click "Done"`
**Expected:** A scary warning, or maybe nothing happening and no way back.
**Happened:** A dialog titled "Publish quiz": "Publishing moves main to this draft. Production instances run it on their next view; a migration runs on each. You can roll back. draft 9 → main (now 1)" and "new migrations run on every production instance: sql/002_leaderboard.sql, sql/003_attempt_visitor_level.sql". Buttons Cancel / Publish draft 9. After confirming: "Published draft 9 to main", "quiz @9 · on 9", with a **Roll back to 1** button right there in the same dialog.
**Felt:** Genuinely relieved. The undo was one click, in the same place — exactly what I'd been asking for and never got told.
STRUGGLE: None here — but I only knew to press Publish because I asked four times; the button itself just says "Publish".

## Verdict
**Did I get what I wanted:** Yes. The quiz is live (quiz @9) with a first-name box, a "Thanks, <name>! You scored 4 / 4." message, and a "This week's top 10 · first names only" board. My students' old quiz kept working the whole time — everything I did happened in a proposal and then my draft, and I took the quiz myself twice before publishing. The production data wasn't touched (the migrations are additions only).

**Hardest moment:** Step 3–4. I answered all four questions and pressed Submit and *nothing happened* — no score, no message — and there was no visible place for a name. I genuinely thought I'd broken the class quiz, and I had no idea how to undo it because the agent had never told me. It turned out the score just appeared below the little preview window and the name box didn't exist yet, but for a few commands I was scared.

**Would I come back:** Yes — but I'd ask for the undo instructions up front, before anything else. Once I knew Accept all → Publish and that Roll back exists, the whole thing felt safe and I'd do it again.

**Three struggles that mattered most:**
1. The agent never volunteered how to go live or how to undo. I had to ask four times, and in the end I found Publish / Accept all / Reject by clicking around myself. The "you can roll back" fact only showed up in the Publish dialog — too late to reassure me when I was worried.
2. Submit with questions unanswered does nothing at all — no message, no hint. Twice I concluded the quiz was broken when it was only waiting for answers, and a score appearing below the fold of a 375×720 preview window looks identical to a dead button.
3. The agent's own test data (Sofia, Emma, Noah, "Admin", my own "Priya 2/4") came along when I pressed Accept all, and ended up on the top-10 board in my draft. Nobody warned me; I spotted it myself. And one of my questions got "discarded" mid-answer after a reset, leaving the leaderboard invisible again with no explanation.
