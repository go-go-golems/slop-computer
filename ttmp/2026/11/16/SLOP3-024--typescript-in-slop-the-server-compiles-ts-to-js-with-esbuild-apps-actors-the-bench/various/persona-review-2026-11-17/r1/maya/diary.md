# Maya's diary — weekend bread preorders

## Step 1: Find out how this thing works
I run a bakery with my sister and I want a page where my regulars can order bread for the weekend, and a list I can print Friday morning. I've never written code; the words "HTML" and "deploy" are just sounds to me.
**Did:** `benchdrive help`, then `benchdrive maya look`
**Expected:** some sort of menu or a blank page where I can say what I want.
**Happened:** A page with lots of panels: Agent, Eval, Canvas, Console, Code, Review, Docs, Inspector, Layers, Panels. There's an app already open called "Weekly Science Quiz" with a question about chemical symbols. Not mine.
**Felt:** overwhelmed — it's a lot of panels. But the Agent chat box at least looks like a place to type.

## Step 2: Start a fresh app for my bakery
The quiz app isn't mine, so I need my own blank one. I clicked the app name at the top, which I guessed was a menu of apps.
**Did:** `click "Weekly Science Quiz" --in header`, then `click "New app…"`, then `new-app maya-bakery "Page"`
**Expected:** a blank page I can then decorate.
**Happened:** A small window called "New app" with two choices: "Page" and "Page and actor". I picked "Page" because the other one had the word "actor" in it and I don't know what that is. Now there's an app called maya-bakery showing a box that says "Something to remember" and an "Add" button.
**Felt:** relieved that I didn't have to understand the two choices. STRUGGLE: I had no idea which template to choose — "actor" and "SQL" mean nothing to me.

## Step 3: Ask for the bread ordering page
I said it in the words I'd use to my sister: three kinds of bread, how many of each, name and phone, closes Thursday night, and a list I can print Friday.
**Did:** `ask "Hi! I run a small bakery with my sister. I need a page where my regular customers can pre-order weekend bread: sourdough, rye and cinnamon rolls, with how many of each they want, plus their name and phone number. The ordering should close Thursday night. Then on Friday morning I need a list of all the pre-orders that I can read and print out. Can you build that for me?"`
**Expected:** the little page in the middle turns into an order form.
**Happened:** A long list of green ticks appeared in the chat, then the header changed to "Proposal: Hi! I run a small bakery…" and a line said "proposal 3 files changed … Review". But the page in the middle STILL says "Something to remember" with an Add button. Claude didn't say a single sentence to me.
**Felt:** confused. Green ticks everywhere but my page looks the same. STRUGGLE: Claude wrote no plain-English reply — I couldn't tell if it had finished or what I was supposed to do.

## Step 4: Getting the proposal to "land"
The word "proposal" means nothing to me, but the Review tab said "nothing lands until you accept", so I pressed the obvious button.
**Did:** `view Review`, read the diff (it looked like a shopping list of table columns — sourdough, rye, cinnamon_rolls, phone — which I did understand), then `click "Accept all"`
**Expected:** the order form appears on the page.
**Happened:** A notice: "Accepted 3 changes into draft 4". The title at the top changed to "maya-bakery — weekend bread". But the page itself is still the "Something to remember" box.
**Felt:** like I'd signed a form and nothing happened. STRUGGLE: I had to guess that "Accept all" was the way to make the work show up; nobody told me.

## Step 5: Ask again, and say it's still the same box on the page
**Did:** `ask "I pressed Accept all, and the top now says 'weekend bread', but the page in the middle still shows the box that says 'Something to remember' with an Add button. There's no order form for my customers. Can you put the actual form on the page? And could you tell me in a sentence or two what you did, please — I'm not a computer person."`
**Expected:** this time the form on the page.
**Happened:** More green ticks; the details talk about "weekday", "deadline", "this week's bake". The proposal is 3 files again and the diffs are all a file called `actor.ts` and a `_probe.ts`, no page. Canvas still: "maya-bakery / [Something to remember] / [Add]". Claude still wrote no sentences to me.
**Felt:** like talking to a machine that's very busy building the back of the shop while the front door is still shut. **This is the second turn with nothing visible changing.** STRUGGLE: I asked a direct question in plain words and got no sentence back, only ticks.

## Step 6: Accept again just in case
**Did:** `click "Accept all"`
**Expected:** page changes.
**Happened:** "No open proposals" afterwards; the page is still the same box.
**Felt:** flat. I'm starting to wonder if the middle of the screen is even the real page.

## Step 7: Stop the machinery and ask for the simple thing
Three turns, nothing on the page. I thought maybe I'd chosen the wrong kind of app at the start, so I said that out loud and asked for the smallest possible thing.
**Did:** `ask "Still the same 'Something to remember' box, sorry. I wonder if I picked the wrong thing when I started — there were two choices and I picked the plain 'Page' one, not the one with the word 'actor' in it… Could we make it as simple as possible? … a form where a customer fills in the three breads and their name and phone, presses send, and then I can see a list of what came in."`
**Expected:** at this point, honestly, I expected the same nothing.
**Happened:** In the canvas the page changed under the word "proposal": "Weekend bread / Sourdough, rye and cinnamon rolls, baked for the weekend… / How many? / Sourdough [0] / Rye [0] / Cinnamon rolls [0] / Your name / Phone number / [Send order] / Orders so far". Claude also wrote real sentences this time ("The page itself is still the starter notes box — that's why nothing changed for you").
**Felt:** huge relief. THIS was what I wanted to see. STRUGGLE: it took four asks and a guess about templates before the page itself was touched.

## Step 8: Accept it, and look at my page properly
**Did:** `click "Accept all"` (11 changes), then `frame-text 1`, `frame-shot` of both frames
**Expected:** my order page, at phone size and bigger.
**Happened:** A warm cream-coloured page, brown serif heading "Weekend bread", a card "HOW MANY?" with three rows and little number boxes, then "YOUR NAME", "PHONE NUMBER", a big brown "Send order" button, and "Orders so far / No orders yet." It looks nicer than I imagined.
**Felt:** proud, actually. Then a small worry: at phone size the bottom of the page is cut off in the canvas view (I could see "Orders so far" squashed at the edge), so I couldn't tell what a customer sees after pressing send.

## Step 9: Try ordering as if I were a customer
**Did:** clicked "Play" at the top (it's how you use the page yourself), then `frame-type` my quantities/name/phone, then `frame-click "Send order"`
**Expected:** it either works or tells me off.
**Happened:** The form emptied, and a green thank-you appeared: "Thank you, Joost — we have your order: 2 sourdough." Below: "Orders so far (1) / Joost / 06 1234 5678 / 2 sourdough / Mon 10:06 PM".
**Felt:** genuinely pleased — it works! But then I stopped: my customers would see each other's names and phone numbers. That's not on.

## Step 10: Ask for a private Friday list and the Thursday cut-off
**Did:** `ask "It works! … But that 'Orders so far' list is on the same page my customers use, so they'd all see each other's names and phone numbers. … On Friday morning I need to see the whole week's orders somewhere just for me, laid out so I can print it … Maybe a separate page for that with a password … Also, ordering should stop Thursday night."`
**Expected:** a second page for me, and the form refusing orders after Thursday.
**Happened:** A long, long string of ticks (it was thinking about "lockKey", passwords, CSS, my page). At the end: the message "…was discarded". The header still said draft 16, and my canvas still shows the same order form with "Orders so far (1) / Joost" on it. Nothing at all changed for me.
**Felt:** deflated. It was working on my one ask for a minute and a half and then the whole thing just went in the bin, with no explanation I could understand. STRUGGLE: my message was "discarded" — I don't know if that means I did something wrong, or it gave up, or I should try again.

## Step 11: Ask for the smallest thing, one at a time
**Did:** `ask "Hello? I think your last answer got thrown away — nothing changed on my page … Can we do just one small thing at a time? Small thing number one: take that 'Orders so far' list off the page my customers see, and put it on its own separate page that only I can open, so I can print it on Friday. Nothing else in this message — just that."`
**Expected:** the list disappears from the customer page.
**Happened:** A third frame appeared in the canvas, called "kitchen (locked)", showing "Weekend orders / Friday morning list — just for the two of you. / Kitchen code / [password field] / [Open the list]". And the customer page now ends with a small "Bakers' list" link instead of everybody's phone numbers.
**Felt:** that was the right shape at last, and asking for one thing worked. STRUGGLE: it never told me what the kitchen code actually is.

## Step 12: Open the kitchen page and get stuck on the code
**Did:** `click "Accept all"`, `frame-click "Bakers' list" 1`, `frame-shot`
**Expected:** the page opens, or at least says what the code is.
**Happened:** The customer page swapped over to the kitchen page: "Weekend orders / Friday morning list — just for the two of you / KITCHEN CODE / [blank box] / [Open the list]". Nothing anywhere says what the code is.
**Felt:** stuck in front of my own kitchen door. STRUGGLE: a password page with no instructions and no code given — I can't use my own list.

## Step 13: Ask what the code is
**Did:** `ask "…it asks for a 'Kitchen code' and you never told me what it is — I can't get into my own list. What do I type? And … will my sister be able to remember it?"`
**Expected:** a word I could write on a note by the till.
**Happened:** It answered in normal sentences for once: the code is **sourdough** (all lowercase, capitals don't matter). It said it picked it because it's what I bake every week, offered to change it to the shop name or a nickname, and warned me straight: "this is a light lock, not a real password."
**Felt:** good — and the warning actually made me trust it more. That's exactly right for us; customers fiddling about is the worry, not hackers.

## Step 14: Type the code and see my Friday list
**Did:** `click "Accept all"`, `frame-click "Bakers' list" 1`, `frame-type "input[type=password]" "sourdough" 1`, `frame-click "Open the list" 1`, `frame-shot`
**Expected:** a list I could print.
**Happened:** A table: "# / NAME / PHONE / SOURDOUGH / RYE / ROLLS / ORDERED", with "1 / Joost / 06 1234 5678 / 2" and a "Total — 1 order" row with 2, 0, 0. Buttons "Print" and "Lock" at the top. On the narrow phone-shaped frame the "Rolls" column is cut off at the edge and "Total — 1 order" wraps onto three lines.
**Felt:** pleased, and slightly fussy: on my phone that table gets chopped. On the big frame it'd be fine, and I print from my laptop anyway.

## Step 15: Ask for the Thursday closing
**Did:** `ask "…Next small thing: the Thursday night part. … I want the ordering to stop on Thursday at midnight, and then a customer who comes on Friday should see a friendly message instead of the form, saying ordering is closed and it opens again for next weekend."`
**Expected:** a line on the page telling customers when to order by, and the form shutting itself.
**Happened:** This time it worked straight away. A new line under the intro: "Order by **Thursday, November 19** night." It also noticed my own confusion out loud ("the wording 'midnight on Friday' is confusing (it means Thursday night)").
**Felt:** fine — except the sentence reads oddly to me. "Order by Thursday, November 19 night" isn't how I'd put it; I'd say "Orders close Thursday night". STRUGGLE: the date is right but the sentence is clumsy, and I only know that because I read it as a customer would.

## Step 16: Fix my clumsy sentence, and see the closed Friday
**Did:** `ask "…the line 'Order by Thursday, November 19 night.' reads awkwardly. Could it say 'Orders close Thursday night (19 November)'? Also — how do I see what a customer sees on Friday, when it's closed?"`
**Expected:** new wording, and some way to look at Friday.
**Happened:** It changed the line to "Orders close Thursday night (19 November)" and made a new frame on the canvas called "closed (Friday)" so I could see Friday without waiting a week: "Ordering is closed / We are busy baking this weekend, so ordering is closed. It opens again on Monday, November 23 for the next weekend."
**Felt:** clever, that — being able to peek at Friday. STRUGGLE: while it was working I saw red writing in the Console panel: "Uncaught ReferenceError: CLOSE_DAY_NAME is not defined". I don't know what that means and it scared me; it seemed to be fixed but I'd have panicked if I hadn't seen the page working.

## Step 17: Check ordering still works after all that
**Did:** filled 1 sourdough as "Ana", phone 055 987 6543, `frame-click "Send order" 1`
**Expected:** thank-you message.
**Happened:** "Thank you, Ana — we have your order: 1 sourdough." and the form cleared. Good.
**Felt:** satisfied — it survived the engine work.

## Step 18: Ask how to go live
**Did:** `ask "…I want to actually put this live so my regulars can use it. I'm going to put the link in my Instagram bio… How do I do that? I see a 'Publish' button at the top right but I'm scared of pressing things I don't understand. And what is the link, exactly?"`
**Expected:** "press Publish, here's your link."
**Happened:** Another long run of ticks about "publish.check", "slug", "the actual public address", and then "…was discarded" again. Nothing changed on my screen, and no answer.
**Felt:** frustrated. Twice now my question has just been dropped in the bin. STRUGGLE: the same "discarded" dead end again — and this was a two-line question, not a complicated one.

## Step 19: Publish it myself
Claude never answered my "how do I go live" question, so I pressed the button that says Publish, because that's what I want.
**Did:** `click "Publish" --in header` → a small window: "Publish maya-bakery / draft 29 → main (first publish) / your dev instance runs draft 29: ok / no production instance yet: nothing serves main" → `click "Publish draft 29"`
**Expected:** it goes live and tells me the address.
**Happened:** "Published draft 29 to main", then a window "Published draft 29 / Instances that follow main: maya-bakery @29 · on 29". No address anywhere. The top of the page now says "draft 29 · main 29".
**Felt:** half thrilled (it's out in the world), half stranded: I have nothing to paste into Instagram. STRUGGLE: after publishing, nothing on the screen shows the web address of my live page.

## Step 20: Ask for the address
**Did:** `ask "I went ahead and pressed Publish myself (I hope that was all right) … But I still don't know what to paste into Instagram. What is the web address, in one line? If you can't see it from where you are, just tell me where on this screen I should look for it."`
**Expected:** one line with a link.
**Happened:** A long run of ticks, then a discarded message, but the text did come through: it can't see the address from where it sits, and says look in "the strip above the page preview (the little bar that usually says something like …/maya-bakery)" or the publish message. It warned me to post the plain address, not anything ending in #/kitchen (my private list), and said the publish went through cleanly.
**Felt:** it was honest with me, which I respect — but I looked where it said, and the strip above my page just says "index.html". No address. STRUGGLE: "…was discarded" again, and its guess about where the address lives was wrong.

## Step 21: Hunting for the link myself
**Did:** tried the app-name menu, the "draft" menu, the "draft 29 dev ok" chip, the "Share" button at the top right, the little icons over the page preview, the "+ Frame" menu, and the Docs page.
**Expected:** somewhere, a web address I could copy.
**Happened:** Nothing. The Docs page is a nice 31-line description of my app, but no address; the frame bar says "index.html" and nothing else; "Share" at the top right doesn't respond to me. The Docs page also still says "Not built yet — there is no Thursday-night cut-off", which isn't true any more.
**Felt:** daft and a bit panicky — I've built the thing and can't hand out the door key. STRUGGLE: no visible way to get the live link, and a dead "Share" button.

## Step 22: It put a web address on my customer page — no thanks
**Did:** `ask "The strip above my page just says 'index.html' … Or could you add a small line at the bottom of my page with my own web address on it…?"`
**Expected:** a small line I could copy.
**Happened:** It added a block at the bottom of the *customer* page: "Preview address — not your public link / http://s6e9a8ea91dd6b03db266.sbx.localhost:18494/e/emb_QHbd…/v/31/ / [Copy] / Open your live page in a browser tab and copy the address from the bar at the top." It was honest that this is the workbench's preview address and would be a broken link on Instagram.
**Felt:** a bit cross — that's a machine address sitting under my order form where my customers would see it, and it isn't even the right link. That's my fault for asking, partly. STRUGGLE: the only address it could produce is one that would embarrass me on Instagram.

## Step 23: Get it off the page again
**Did:** `ask "Oh no — please take that address line off the customer page… Take it off, and leave the page as it was."` then `view Review`, `click "Accept all"`
**Expected:** my clean customer page back.
**Happened:** Gone. The page is back to: heading, three breads, name, phone, "Send order", and a small "Bakers' list" link. Draft 33, and what's live (main 29) is the good version without the address line.
**Felt:** relieved. The page is exactly what I wanted; the only thing missing is the link to give people.

## Verdict

**Did I get what I wanted?** Partly. The bakery page itself is really good: a customer page with the three breads, count boxes, name and phone, a "Orders close Thursday night (19 November)" line, a friendly closed message on Fridays, and a private "kitchen" page behind the word *sourdough* with a Print button and a table of orders with a total. I tested ordering twice myself and it worked, and I pressed Publish, so it is live. What I did not get is the plain web address to put on Instagram — the one thing I actually need to hand the page to my regulars.

**Hardest moment:** the first four asks, where each one ended with a batch of ticks and my page still saying "Something to remember". I genuinely thought I'd got the wrong kind of app. The second hardest: two of my messages came back "…was discarded", with no explanation a shopkeeper can follow.

**Would I come back?** Yes for the page — it's better than what I'd have got from a form builder. But I'd bring a friend who knows computers, at least to find the link, and I'd ask for one small thing at a time, because that's the only thing that worked.

**Three struggles that mattered most:**
1. No plain-English reply for the first several turns — only ticks and diffs, so I couldn't tell whether anything had happened or what I was meant to press.
2. "Proposal" and "Accept all": nothing lands until you press a button nobody has explained. I had to guess, twice, and once the work looked finished but my page hadn't changed at all.
3. No way to find my live web address, and my question about it was thrown away once; the "Share" button at the top right doesn't respond, the strip above my page says only "index.html", and the one address it managed to print was a broken preview one that I then had to ask it to take off my customer page.
