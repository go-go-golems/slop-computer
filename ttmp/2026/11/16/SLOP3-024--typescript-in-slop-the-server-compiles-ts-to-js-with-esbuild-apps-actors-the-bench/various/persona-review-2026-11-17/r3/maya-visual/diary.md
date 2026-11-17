# Maya's diary — weekend bread preorders

## Step 1: Open the bench and look around
**Did:** `benchdrive maya-visual see shot-1.png`, then a couple more sees after a hiccup where the picture didn't show up in my folder.
**Saw:** shot-3.png: a big "Bench" screen. On the left a chat panel titled "I coordinate volunteer..." with lots of grey code-ish text in it. In the middle a canvas showing a page called "Food Bank Shift Sign-up" with a green "Coordinator view" button, a "Coordinator code" box, and cards for "Pack boxes" and "Greet clients". On the right a Code panel with a file list (README.md, actor.ts, app.json, index.html...).
**Expected / Felt:** I expected a blank page for MY bakery. This is somebody else's thing about volunteers and food bank shifts. I don't know how to get to my own page.
STRUGGLE: The screen opened on a stranger's app ("Food Bank Shift Sign-up"); I could not see any obvious "start something new" button at first glance.
STRUGGLE: The chat on the left is full of computer code, with tiny numbers down the side. I don't read that.

## Step 2: Looking for my own app
**Did:** clicked the app name at the top ("Food Bank Shift Sign-up"), got a dropdown listing apps: aishi-shifts, devon-kanban, inventory, kenji-poll, maya-bakery, maya-bakery2, members, quiz, sam-shipments, smoke, tomapp, tsmoke... Tried scrolling inside it, pressed Escape, clicked "Bench" and "slop app workbench", then reopened the dropdown and typed "maya-visual-bakery" hoping it would search.
**Saw:** shot-4.png / shot-5.png: a long list of app names with little grey labels like "draft 12 · main 12". shot-8.png: my typing did nothing — the list stayed exactly the same. No "new page" or "start fresh" button anywhere I could see.
**Expected:** a big obvious "make a new page" button.
**Felt:** frustrated. There are names like "maya-bakery" in there but I don't know if those are mine, and nothing says "new".
STRUGGLE: Could not find any way to start a brand-new page from the app-name dropdown.
STRUGGLE: Typing in the dropdown did nothing (no search, no "create" option appeared).

## Step 3: Just asked the agent in plain words
**Did:** clicked the message box at the bottom left, typed "Hi, I'm Maya, I run a small two-person bakery. I think this page isn't mine - I need a brand new simple page where my regulars can preorder weekend bread until Thursday night, and where I can see and print a list of all preorders on Friday morning. Can we start from scratch, please?" and pressed Enter. Then waited ~25 s, then ~60 s more.
**Saw:** shot-9.png: my message appeared in the chat under "You 23:40:37", and "Claude ... Thinking...". The middle page changed to "No shifts yet." and there is a selected box around it. shot-10.png (85 s later): identical — still "Thinking...", page still says "Food Bank Shift Sign-up" and "No shifts yet."
**Expected:** it would say hello back and maybe ask me a question, or show a new empty page.
**Felt:** unsure. Nothing is happening, and nobody told me whether this page can even become mine.
STRUGGLE: The app title still says "Food Bank Shift Sign-up" and there was no sign of a new bakery page appearing.

## Step 4: Found it! (finally) — the app-name list scrolls
**Did:** reopened the app list and scrolled a big amount with the mouse wheel inside it (`scroll-at 330 600 300`).
**Saw:** shot-19.png: the list really did have more at the bottom, in a grey footer: "New app… — an app store from a template, on draft", "Import app…", "Download aishi-shifts", "Reset dev data…", "Forget aishi-shifts here…". Clicked "New app…".
**Expected / Felt:** relief! So you *can* start a new page; the button was just hidden below the fold of that little list.
STRUGGLE: The "New app" option only appears after scrolling inside the app-name dropdown; nothing hints that the list is scrollable (no visible scrollbar, no "more" arrow).

## Step 5: Made my new app
**Did:** clicked "Simple page" (of two cards: "Simple page" and "Page with server code"), typed the id `maya-visual-bakery`, typed the title "Maya's Bakery - Weekend Bread Preorders", clicked Create.
**Saw:** shot-20.png was the "New app" window with two big cards; I picked "Simple page" because it says "Good for a form, a list or a notebook" — that sounds like my order form. shot-22.png: the header now says "Maya's Bakery - Weekend ..." and the canvas shows a plain page titled "Maya's Bakery - Weekend Bread Preorders" with one lonely box "Something to remember" and an "Add" button.
**Expected:** a blank sheet to fill in.
**Felt:** good — this is a blank page with my name on it. But it also doesn't look like a bread order form yet, it looks like a shopping list.
STRUGGLE: The template page I got has a "Something to remember" box, which confused me — is this my bread form?

## Step 6: Told the agent exactly what I want
**Did:** clicked the message box, typed: "Hi! I run a small bakery, just two of us. I need a page where my regulars can preorder bread for the weekend: sourdough, rye and cinnamon rolls, with how many of each they want, plus their name and phone number. They should be able to order until Thursday night. And I need a page for me where I can see all the preorders and print them on Friday morning. My bakery is called Maya's Bakery. Please make it look nice and simple, my customers are not techy either!" then Enter, waited 40 s.
**Saw:** shot-23.png: my message in the chat, "Claude ... Thinking...", header says "Proposal: Hi! I run a small bakery…", and the page got a dashed blue border with a little "PROPOSAL: HI! I RUN A SMALL BAKERY, JUST TWO OF US..." tag at the bottom. Nothing about bread yet.
**Expected:** it would start drawing the form.
**Felt:** a bit nervous about the word "PROPOSAL" — I don't know if this is a real page or a maybe-page.

## Step 7: The app appeared
**Did:** waited (twice, ~2.5 min each), then clicked "Fit" in the canvas toolbar (the frames were cut off) and looked.
**Saw:** shot-27.png: the agent's chat showed it reading files and saying it would build "one page with two views (the order form for customers, the bake list for you)" and that today is Monday so the ordering window is open for testing. shot-29.png at 57% zoom: TWO pages side by side. Left = "Maya's Bakery" with "Order bread / Bake list" tabs, a green note "Ordering is open until Thursday night.", big title "Weekend preorder", "For pickup on Saturday, November 21. Pay when you pick up.", and three breads with little − 0 + buttons: Sourdough loaf, Rye loaf, Cinnamon rolls. Below: "Your name". Right = the "Bake list" page: "Bread for Saturday, November 21", an orange Print button, a green "Ordering is open — it closes Thursday night.", four counters (2 sourdough loaves, 0 rye loaves, 1 cinnamon rolls, 1 preorders), a customer card "Marcus Webb 555-0160 — 2 sourdough · 1 cinnamon rolls", and a link "Done with this weekend — start a fresh list."
**Expected:** something like my paper order book. This is better than I imagined.
**Felt:** genuinely pleased — the bread names, the pick-up day, the Print button. Small niggle: "1 preorders" reads wrong, and there's a stranger called Marcus Webb in my bake list (the agent's made-up test order).
STRUGGLE: The chat sat on "Thinking..." for several minutes with no sign of progress; I nearly gave up before it started writing. Later the same happened again (~5 min) before the plan appeared.

## Step 8: I broke it by clicking (my mistake)
**Did:** clicked the + next to Sourdough and Rye in the page, clicked "Your name" and typed "Anna Berger".
**Saw:** shot-30.png: instead of +1 loaves, the right-hand Code view opened with index.html and my name "Anna Berger" typed into line 19 of the code, plus "editing proposal" in grey. shot-31.png: back on the canvas, "Anna Berger" is now sitting as stray text under "Maya's Bakery" in BOTH pages.
**Expected / Felt:** I thought clicking the page would work the page. It edited the page's code instead. I felt sick — I'd broken something and it was all little grey code lines.
STRUGGLE: Pressing on the page in the default "Select" mode doesn't use the app, it selects/edits its pieces — and my typed text went straight into the code file. Nothing warned me.

## Step 9: Trying to put it right
**Did:** clicked the small "History 2" button in the code panel (shot-35.png) — it listed only two versions, "Latest 23:56:14 saved by Claude" and "23:47:42 as it was at msg 1". Restoring the old one would have thrown away the whole bakery page, so I didn't touch it. Then clicked "Play" in the top bar (I first hit "Comment" by mistake, shot-34.png), then tried zooming to 100% and dragging the canvas to bring my order page into view.
**Saw:** shot-36.png: with Play lit up, I can now use the pages. shot-37.png at 100%: the bake list fills the screen, my order page is half off to the left. The drag did nothing (shot-38.png).
**Expected / Felt:** I wanted to just click the + buttons like a customer and see an order appear. I couldn't get my order page fully on screen.
STRUGGLE: At 100% zoom the two pages don't fit, and I couldn't find a way to scroll or drag the canvas sideways to reach the order page (dragging did nothing).
STRUGGLE: "Select / Play / Comment" at the top: three buttons with no explanation; I had to hit the wrong one twice before "Play" let me touch the app.

## Step 10: Asked the agent to fix my mess and tell me about the link
**Did:** typed to the agent: "That looks wonderful, thank you! Two things: (1) I was clicking around and accidentally typed my test name Anna Berger onto the top of the page... please take that off. (2) The bake list says '1 preorders' - should say '1 preorder'. And then: how do I get a link I can put on Instagram so my customers can order? I need it live, please." Enter.
**Saw:** sent; will look after it works.

## Step 11: Accepted it and put it live
**Did:** read the agent's answer (shot-39.png): the stray name was removed, "1 preorder / 2 preorders" fixed, and it explained I had to "Accept the proposal", then press Publish, then "Give it a web address". I hunted for Accept in the chat (clicked the wrong spot twice), then found it in the "Review 1" tab at the top right (shot-42.png) — a proposal card with Viewing / Compare / **Accept all** / Reject and a list of changed files. Clicked "Accept all".
**Saw:** shot-43.png: the proposal card moved to "Closed — accepted just now", the header no longer said "Proposal:" and the pages stopped having the dashed outline. The bake list immediately filled with real orders: Elena Vargas 555-0142 (2 sourdough · 1 rye · 4 cinnamon rolls), Tom Okafor (1 sourdough · 6 cinnamon rolls), Priya Nair (2 rye · 2 cinnamon rolls) and totals 3 / 3 / 12 / 3. Then I pressed the black **Publish** button in the top bar and got a "Publish maya-visual-bakery" card: "draft 7 → main (first publish) ... no production instance yet: nothing serves main" with Cancel / Publish draft 7.
**Expected:** something scary and technical. It was a bit technical ("migration", "instances") but short, and Publish draft 7 was an obvious button.
**Felt:** nervous pressing Publish, but it was fine. Then: "Published draft 7 — Your app is published, but it has no web address yet" with a "Give it a web address (maya-visual-bakery)" button. I clicked it and got: **Your app is live at: http://apps.localhost:18494/maya-visual-bakery** (shot-46.png). That's the link for Instagram.
STRUGGLE: The word "proposal" everywhere, and the Accept button sitting as tiny grey text at the foot of the chat — I clicked it twice and nothing happened; the one that worked was "Accept all" over in the Review tab.
STRUGGLE: Jargon in the publish card: "draft 7 → main", "production instances", "migration" — none of it means anything to me, though the big black "Publish draft 7" button was clear enough.

## Step 12: Tried the form like a customer (it works!)
**Did:** in the canvas with Play lit, clicked "Fit" to see both pages, clicked + once on Sourdough loaf (the counter went 0 → 1 and a note appeared "1 item in your preorder"), scrolled down inside my order page to find the rest, typed "Rosa Klein" and "555-0199", then pressed the orange "Place my preorder" button.
**Saw:** shot-48/49/50.png. The page turned into a green tick: "Thank you, Rosa! Your preorder for Saturday, November 21 is in. • 1 × Sourdough loaf • Maya will have it ready for pickup on the weekend. If anything changes, she'll call or text you." with a "Place another preorder" button. AND the bake list beside it updated by itself: 4 sourdough loaves, 4 preorders, and a new line "Rosa Klein 555-0199 — 1 sourdough".
**Expected:** roughly this. I didn't expect the numbers on the right to change on their own without refreshing.
**Felt:** delighted. The fields say "Your name" and "Phone number — So Maya can reach you", and the button says "Place my preorder". That's exactly the kind of plain words my customers need.
STRUGGLE: My order page was taller than its little window in the canvas; I had to work out that I had to scroll *inside* the page to reach the name, phone and the orange button.
STRUGGLE: The bake list already contained three people I've never heard of (Elena, Tom, Priya) with 12 cinnamon rolls between them — leftover made-up orders from the agent's testing, which I'd rather not see on my Friday list.

## Step 13: Asked about the strangers in my list, then tidied it myself
**Did:** told the agent those three people were test orders and asked it to clear them so my Friday list only shows real orders. Waited ~5.5 minutes across two looks.
**Saw:** shot-51.png / shot-52.png: the agent hunted through its storage, then said "your bake list even has a 'Start a fresh list' button made for this. Let me use it through the frame" — but after another 2.5 minutes nothing on the pages had changed (the little × s were still there, four unknown orders still showing). Then I noticed the link at the bottom of my bake list myself: "Done with this weekend — start a fresh list". I clicked it; a small window asked "Start a fresh list? This tidies 4 preorders out of the way (nothing is deleted)." and I said OK.
**Saw (after):** shot-53.png: my bake list now reads 0 sourdough loaves, 0 rye loaves, 0 cinnamon rolls, 0 preorders and "No preorders yet — the list fills up as customers order." The order page reset to zero too. Clean slate, and it says nothing is actually deleted, which I like.
**Expected / Felt:** relief. This is the state I want before I tell the regulars. Irritating that the agent went round the houses for five minutes when the app had a button for it — though to be fair it did spot the button.
STRUGGLE: The agent took a long detour (and briefly invented a customer called "Noor Haddad" before correcting itself) to do something the page already had a button for.
STRUGGLE: That confirm box ("Start a fresh list? This tidies 4 preorders out of the way") is a plain browser pop-up, not part of the app, and it covered the screen — I only just caught what it said.

## Verdict
**Did I get what I wanted?** Yes. I have a page where a regular can pick sourdough / rye / cinnamon rolls with − 0 + buttons, put in their name and phone, and press "Place my preorder" — I tried it as "Rosa Klein" and it worked and thanked me by name. Beside it I have a bake list that fills itself in as orders come (4 sourdough, 3 rye, 12 cinnamon rolls, 4 preorders when I ordered) with a big orange **Print** button and a line per customer with their phone number. And it is live: http://apps.localhost:18494/maya-visual-bakery — that's the link I'd paste into Instagram. For my own use I keep the bake list, which the agent said is at the end of the link with #/orders, and I just don't put that on Instagram.

**Hardest moment:** Accidentally typing my own name into the page and seeing it appear as stray text on both pages, with the Code panel suddenly open showing my name inside a line of grey code (shot-30/31). I thought I'd broken the whole thing and I didn't dare touch the history buttons.

**Would I come back?** Yes, though I'd want a big "New app" button that's actually visible, and someone to tell me up front that clicking the page in "Select" mode edits the page's code rather than using the app, and that I need to press "Accept" before anything is real.

**Three struggles that mattered most**
1. Nothing told me how to start a brand-new page: "New app…" was hidden below the fold of the app-name list, and I only found it by accidently scrolling inside that dropdown (shot-19.png). Before that I spent several turns on a stranger's "Food Bank Shift Sign-up" app.
2. "Select / Play / Comment" and the difference between a *proposal* and the real app: I broke the page in Select mode, then couldn't find the Accept button (it was tiny grey text at the foot of the chat; the one that worked was "Accept all" in the Review tab), and the Publish card then asked me about "main", "production instances" and "migration".
3. Everything is slow and silent: the agent sat on "Thinking..." for 3–5 minutes with nothing changing on screen, twice, and once I nearly pressed Stop and would have thrown the work away; my order page was also taller than its little frame in the canvas, and I had to discover that I had to scroll *inside* the page to reach the name, phone and the orange "Place my preorder" button.
