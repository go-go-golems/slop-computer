## Step 3: Asked for the preorder page in plain words
Told the agent exactly what I need: three breads with number boxes, name and phone, an order button, a list of all orders I can read Friday, and a Thursday-night cutoff. I don't know any code words so I just described it like I'd tell a friend.
**Did:** benchdrive maya ask "…weekend bread preorder form…"
**Expected:** it would ask me confusing questions, or something would break.
**Happened:** It built the whole thing and showed me a preview on the canvas. It even mentions a "proposal" — apparently my app doesn't change until I accept. There's a Review and an Accept button. It tested it two ways itself and warned me it couldn't test the "closed" message because today is Tuesday.
**Felt:** actually surprised it understood all of that in one go. The "proposal" bit is new to me but the preview is right there to try.

## Step 4: Looked at the form as a customer would
Read the preview frame text.
**Did:** benchdrive maya frame-text 1
**Expected:** the breads, name, phone, a button.
**Happened:** Exactly that, plus friendly lines like "No orders yet — yours could be the first!" and "So Maya can reach you" as the phone hint. Cute.
**Felt:** this looks like something I'd actually put on Instagram.

## Step 5: Tried the form myself — first stumble
Typed my name, phone, 2 sourdough and 6 cinnamon rolls, then clicked Send my order. Nothing happened — turns out I was in "Select" mode and my click just picked the button instead of pressing it. The bench kept telling me to click "Play" in the header.
**Did:** frame-type into the fields, frame-click "Send my order", then clicked "Play" in the header and clicked again.
**Expected:** the order to go through the first time.
**Happened:** First click just highlighted the button (and the Code view opened index.html at some line — a bit scary). After switching to Play mode it worked: "Thank you! Your order is in. See you this weekend!", form cleared, and under "Orders so far" it shows "To bake: 2 sourdough, 6 cinnamon rolls" plus my order line with name and phone.
**Felt:** annoyed for a second — why isn't the preview just usable? — but the Play switch fixed it.
STRUGGLE: preview clicks did nothing in Select mode; had to discover the Play mode switch in the header.

## Step 6: A second order, like a regular customer
Added Priya, 1 rye, sent it.
**Did:** frame-type + frame-click again.
**Expected:** both orders listed, counts added up.
**Happened:** "To bake: 2 sourdough, 1 rye, 6 cinnamon rolls", Priya listed above Maya Test. Exactly what I want to read Friday morning.
**Felt:** this is the list. If the printed version looks like this, I'm happy.

## Step 7: Accepted the proposal, asked for printing + going live
Clicked Accept so the changes are really mine now. Then asked for two things: a print button for my Friday kitchen list, and how to put the page on the internet for my Instagram bio — telling it I don't know technical words.
**Did:** click Accept, then ask about print button + publishing.
**Expected:** a print button preview and simple "press this" instructions.
**Happened:** It built the print button (4 files changed, new proposal waiting), but the turn ended mid-way: its last test shows a red ✕ and I never got the publishing answer. It also mentioned my two test orders "lived in the old preview's own data copy" — I think my test orders disappeared?
**Felt:** uneasy — it stopped talking before answering my question, and I don't know if the print thing is finished.
STRUGGLE: agent's turn ended without the final answer; last eval shows an error; unclear if the work is done or broken.

## Step 8: Asked it to finish — it broke my preview instead
Nagged it about the red cross, the missing publishing answer, and whether orders stay saved. It did fix the print test (both tests pass now, the print click is included) and explained my test orders lived in the preview's own copy, not the real database. But while cleaning up its test order with a "reset" it dropped the dev preview, and now the canvas shows nothing and the corner says "no dev instance". Then it stopped talking AGAIN, mid-sentence, saying the preview "comes back when the proposal is accepted".
**Did:** ask, wait 8s, look.
**Expected:** a fixed preview and a straight answer about going live.
**Happened:** The message ends with tech gibberish ("ts?: false, store: true"). No frames on the canvas. I still have no publishing instructions and I can't see my page.
**Felt:** lost. Twice now it stopped before the part I actually asked for, and now my page is invisible.
STRUGGLE: agent's cleanup reset killed the dev preview; canvas empty, "no dev instance"; turns repeatedly end without the requested plain-words answer.

## Step 9: Tried the print button, accepted, and the preview came back
Before accepting I placed a test order in the proposal preview (Test Print, 3 sourdough) and clicked "🖨️ Print orders". Nothing visible happened — I guess a printing window opens somewhere I can't see. The agent's own test had pressed the button with an order in the list and it passed, so I accepted. The preview came back right after ("dev ok").
**Did:** frame-type + frame-click Send, frame-click "Print orders", then Accept, then wait.
**Expected:** the print button to visibly do something.
**Happened:** No visible change on print (probably a system print window), but the agent's automated test passed and after accepting, my canvas frame returned.
**Felt:** a little unsure about print since I can't see paper from here, but reassured by the test.
STRUGGLE: can't personally verify the printout from inside the bench.

## Step 10: Pressed Publish, got the go-live steps
Asked a third time, plainly, how to go live. This time it answered simply: Accept → Publish (top of screen) → ask the administrator for a web address, with a ready-made sentence to send them. I pressed Publish, confirmed "Publish draft 10", and it said "Published draft 10 to main". The agent confirmed everything checked out and gave me the exact sentence for my admin.
**Did:** click Publish, click "Publish draft 10", Escape, ask for the admin sentence.
**Expected:** publish = live.
**Happened:** Published! But no web address yet — only the administrator of this workshop server can switch that on. Once they do, the link appears in my header.
**Felt:** relieved. This is the part I was most scared of and it was two buttons. The admin step is out of my hands, but at least I know exactly what to ask.

## Step 11: Realized a privacy problem (going beyond the brief)
Thinking about strangers from Instagram visiting: the order list shows EVERYONE'S name and phone number to anyone who opens the page. My regulars wouldn't want their numbers on display.
**Did:** thinking, before asking.
**Expected:** —
**Happened:** —
**Felt:** I need to fix this before the link goes in my bio.

## Step 12: Privacy fix — customers see tallies, I keep the names
Asked for the change: customers get a friendly "this week so far" tally with no names or phones; my full list hides behind a secret word, checked on the server. It built it and all its tests passed — but I spotted a red error in the Console myself ("Cannot read properties of undefined, main.ts:31").
**Did:** ask, frame-text, Console view.
**Expected:** all clean.
**Happened:** Customer side confirmed by me: after Lena's order it shows only "So far this week: 1 order — 2 rye." The console error turned out to be from mid-build; after clearing it, nothing new appeared.
**Felt:** good — and checking the Console myself made me feel less helpless.
STRUGGLE: a console error appeared during the build; had to figure out it was leftover from mid-edit, not a real break.

## Step 13: My secret word
It had quietly picked "bakefriday" and never told me. I asked for it and had it changed to "flourpower". Also the Show button looked blank on a phone — it fixed that too.
**Did:** ask, then frame-type "Secret word" flourpower, frame-click Show.
**Expected:** my full list with names and phones.
**Happened:** First tries timed out because the For Maya box was folded; after clicking the heading it opened, and flourpower + Show revealed "Orders so far / Print orders / To bake: 2 rye / Lena · 555-0333". A wrong word is refused (its test covered that).
**Felt:** like a door that's actually mine.
STRUGGLE: secret word was never mentioned until I asked; the folded box made my first typing attempts time out.

## Step 14: Accepted and published again
Remembered the live page still ran the old version, so after accepting I pressed Publish → "Publish draft 19" → confirmed. The live page now has the privacy fix.
**Did:** Accept, Publish, "Publish draft 19", Escape.
**Expected:** live version updated.
**Happened:** "maya-bakery2 @19 · on 19". Done.
**Felt:** proud of myself for remembering the re-publish.

## Step 15: Friday rehearsal and where orders really live
Asked where Friday orders show up and whether the Thursday closing really works. It did a full dress rehearsal: flipped the app to closed mode in front of me (I saw the greyed-out page and "Orders are closed for the week"), pretended it was Friday with two fake orders, showed my list and print still work while closed, then flipped back. Key thing I learned: this screen's preview is a private practice copy with its own order book — real orders land on the live link, so Friday I open my link, tap "For Maya", type flourpower, press Show, print.
**Did:** ask; accept the leftover 1-file proposal (its saved test set).
**Expected:** clear instructions.
**Happened:** Exactly that, step by step, phone-friendly. It also honestly noted the closing time can be off by an hour or so from my local midnight.
**Felt:** this is the answer I wanted all along — a checklist I can actually follow.

## Verdict
Did I get what I wanted? **Yes.** A preorder page with the three breads, name and phone, a Thursday-night cutoff, a private order list behind my secret word with a print button, published and ready for the link (which just needs my administrator to switch on the web address — I even have the sentence to send them).

Hardest moment: when the agent's cleanup broke my preview ("no dev instance") and stopped mid-answer twice — for a while I couldn't see my own page and had no idea if it was broken.

Would I come back? Yes — especially Friday morning if anything looks odd, or when I want to add a bread like focaccia.

Top three struggles:
1. The agent repeatedly ended its turn before answering my actual question (twice I had to ask again for the go-live steps).
2. Its cleanup "reset" dropped my dev preview and I couldn't see or try my page until I accepted a proposal.
3. Small invisible-to-me things I had to chase: the Play vs Select mode switch, the never-mentioned secret word, the folded "For Maya" box, and a console error I had to work out was harmless.
