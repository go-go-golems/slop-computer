# Inès — diary (round 5, works by eye)

## Step 1: Open the bench and find my app
**Did:** `benchdrive ines2-visual see shot-1.png`
**Saw:** shot-1.png — the bench opened on somebody else's app: "Food Bank Shift Sign-up" (aisha-shifts). Chat on the left is full of old notes about a quiz. Not mine.
**Expected:** my flower shop app, "ines-bouquets".
**Felt:** confused — why does somebody else's sign-up sheet open when I sit down?

## Step 2: Switch app
**Did:** clicked the app name dropdown (328,61), then `see shot-2.png`
**Saw:** shot-2.png — a long list: New app…, Import app…, Recent (aisha-shifts), then a list of apps. I can read "ines-bouquets  draft 7 · main 7 · 3 instances" about halfway down.
**Expected:** a list of my apps — yes, found it.
**Felt:** relieved, it was there, but the list is long and the names are tiny.

## Step 3: Pick "ines-bouquets"
**Did:** clicked (244,385) on ines-bouquets, `see shot-3.png`
**Saw:** shot-3.png — my app "Ines Bouquets" is on the canvas, two frames side by side: Order (bouquet sizes Small 25€ / Medium 35€ / Large 50€, delivery day Tuesday/Friday, card message) and Orders (asks for a code). Chat on the left is still the old conversation, very long and scrolly, all about "Print no longer works" and code-ish instructions.
**Expected:** my pages, with the old talk still hanging there.
**Felt:** ok, this is my shop. But the old chat is a wall of text I can't face reading.
STRUGGLE: the chat panel from last time is a huge wall of technical text covering the left side of the canvas — I can't read it and it hides the page.

## Step 4: Ask for my three changes
**Did:** clicked the chat box (190,890), typed my wishes in plain words (address required; printable delivery list per day, one day per page; Mother's Day Special bouquet for that week only), Enter, `see shot-4.png`
**Saw:** shot-4.png — my message sits in the chat, agent says "Working · reading your app and planning", a little "PROPOSAL: HELLO INES HERE. THREE THINGS" tag floats on the canvas.
**Expected:** it just does it.
**Felt:** fine, but that proposal tag worries me — last time I had to "accept" things.
STRUGGLE: a "PROPOSAL …" label floats on top of my page in the canvas and hides the card-message box.

## Step 5: Try to switch off "Proposal" mode
**Did:** clicked (269,951) — hit the wrong thing, a model list (Quick/Default/Opus 5.5…) opened. Escape, then clicked (233,951) "Draft", `see shot-6.png`
**Saw:** shot-6.png — model list gone, "Draft" now dark/selected, agent still working.
**Expected:** changes would land straight in my draft.
**Felt:** annoyed that a tiny row of buttons at the bottom holds the model list, the permission mode and something else — I cannot tell them apart.
STRUGGLE: the bottom-left row (Auto / Ask / Read-only | Proposal / Draft | Default) is a row of look-alike buttons; I opened a model list by mistake and still don't know which one "keeps my work".

## Step 6: Wait for the work
**Did:** `pause 60`, `see shot-7.png`; `pause 90`, `see shot-8.png`; `pause 120`, `see shot-9.png`
**Saw:** shot-7: agent "reading your app and planning", 4 file reads listed. shot-8: same, 3 min 39 s. shot-9: answer finished — it says it added the address block, a printable list, and "Mother's Day Special" at 65 €; asks me to press **Accept** on the proposal, then **Publish** in the header; says tests are still to do and to say "continue".
**Expected:** finished work, straight in.
**Felt:** slow (nearly 4 minutes of watching), but the answer is in plain words I can follow — two lines at a time.
STRUGGLE: the answer is a long wall of small text; the useful bit (Accept, then Publish) is buried in the middle.

## Step 7: Accept the changes
**Did:** clicked "Accept the changes" (85,823), `see shot-10.png`
**Saw:** shot-10.png — toast "Accepted … the changes are in your draft now", header shows draft 10, and a new file `003_order_address…` with an "M" beside it in the file list.
**Expected:** my pages would now show the address box.
**Felt:** good — found Accept on the first try this time.

## Step 8: A stray keypress, and a busted line of my page
**Did:** tried to get more canvas room; closed the bottom panels; pressed "Play"; clicked in the code panel by accident and a stray "p" landed in index.html (line 11 became `p<div class="wrap">`); then my Backspace turned `<body>` into `<bdy>`. Tried the History list and "Restore this version", which showed a clean copy but the code pane still showed the damage.
**Saw:** shots 12–18: crop-code2.png / crop-code3.png show `p<div class="wrap">` and `<bdy>`; header went from "draft 10" to "unsaved" and back.
**Expected:** clicking a page in the canvas would never change my code.
**Felt:** horrible. I broke my own page in a way I cannot repair, and the code panel is right there inviting the damage.
STRUGGLE: **the code pane sits right next to what I'm clicking**, and one stray keystroke edited my page and made a new draft ("unsaved") without me understanding why. This is the single scariest moment of the round.
STRUGGLE: the History popup lists four versions by time and by "saved by you in 11 / accepted …" — I could not tell which one was the good one, and "Restore this version" did not visibly fix the code pane.

## Step 9: Ask the agent to repair, and finish its tests
**Did:** typed into chat: "I broke my own page by accident … `<bdy>` and a stray p before `<div class=wrap>` … put it back, then continue with the checks you said were still to do", Enter, paused 100 s and 120 s (shot-19…shot-22).
**Saw:** shot-20: "The repair is confirmed — `<body>` and `<div class="wrap">` are back (index.html:9, index.html:10)". shot-22: a tidy list of four ticked items (order with address ✓, Mother's Day hidden outside its week ✓, order + week list ✓, printable delivery list ✓) and "One fix the tests forced: your private orders page always asks for the code again now."
**Expected:** exactly that — it fixed what I broke and told me in plain words.
**Felt:** relieved, and glad it lists what it checked with ticks.
STRUGGLE: I had to wait ~4 more minutes of "…writing its next step (25 steps done)" before I got that answer.

## Step 10: Make room to see my pages
**Did:** Canvas tab, "Fit", closed the Console and Data/Scenarios panels (clicked their ×), pressed the "Play" button in the top bar.
**Saw:** shot-28 — the little footer now reads PLAY | DRAFT; the two frames fit side by side.
**Expected:** a clear view of both pages.
**Felt:** better, though it took five attempts to find the × that closes the bottom panel.
STRUGGLE: the × to close a bottom panel is tiny and sits next to the tab name; I hit the tab label twice before finding it.

## Step 11: Order as a customer (Friday, Large)
**Did:** + to 95 %, scrolled inside the iframe, picked Large, Friday, typed 12 rue des Lilas / 75011 / Paris / "Joyeux anniversaire Maman, je t'aime fort" / Camille Durand / 06 12 34 56 78, pressed "Place my order" (shots 29–37).
**Saw:** shot-31: the form now has a **Delivery address** block (Street and number, Postcode, Town), Card message, Your name, Phone, "Total: 50 €" and a "Place my order" button. shot-37: "Merci, Camille Durand ! Order #3 is in: Large bouquet, delivery Friday, 50 €. Ines will text you to confirm."
**Expected:** the address box and a confirmation.
**Felt:** good. The address block looks like the rest of the page, and the total changes when I change the size.

## Step 12: Order as a customer (Tuesday, Small) and test the address rule
**Did:** "Order another bouquet", Small + Tuesday, filled street/name/phone/message but left Postcode and Town empty, pressed "Place my order" → browser says "Please fill out this field."; then filled 69006 / Lyon and placed it (shots 38–46).
**Saw:** shot-43/44: a small native tooltip "! Please fill out this field." stuck on the empty box. shot-46: "Merci, Lea Moreau ! Order #4 is in: Small bouquet, delivery Tuesday, 25 €."
**Expected:** it would not accept an order without the address.
**Felt:** reassured — it really insists on the address now.
STRUGGLE: the "please fill out this field" bubble is the browser's own and it hangs over the form, half-hiding "Card message" until I scroll.

## Step 13: Open my private day lists
**Did:** clicked the Orders frame's "Your code" box (900,356), typed `ines2026`, clicked Unlock (1077,356), `see shot-47.png`
**Saw:** shot-47 — my private page now says "Each button opens that day's delivery list in a new tab, ready to print — one day per page", then **Tuesday — 2 orders, 75 €** with a "Print the Tuesday list" button and two order cards (#2 Mme Rossi Large 50 €; #4 Lea Moreau Small 25 € with 8 avenue Victor Hugo, 69006 Lyon, "Bonne fete Maman"), and below **Friday — 2 orders, 85 €** with "Print the Friday list".
**Expected:** a list split by delivery day with the addresses in it.
**Felt:** this is exactly what I wanted to see. It is readable at a glance.
STRUGGLE: order #2 (Mme Rossi, an old order) shows a phone but **no address at all** — on a delivery list that is a hole; nothing tells me the address is missing.

## Step 14: Look at the Friday list
**Did:** scrolled inside the Orders frame, `see shot-49.png`
**Saw:** shot-49 — Friday: #1 Claire Dubois Medium 35 € "Joyeux anniversaire Maman!" (no address, old order) and #3 Camille Durand Large 50 € · 12 rue des Lilas, 75011 Paris · "Joyeux anniversaire Maman, je t'aime fort".
**Expected:** my two orders with addresses, sorted by day.
**Felt:** good — the address and the card message sit under each name.
STRUGGLE: in the canvas there is **no Mother's Day bouquet to see** (it is hidden because today isn't that week) and I cannot try it, which is half of what I asked for.

## Step 15: Press the print button
**Did:** clicked "Print the Tuesday list" (863,389), `see shot-48.png`
**Saw:** shot-48 — the button turned dark as if pressed/focused, and then… nothing. No printable page appears anywhere, no message, no new tab I can see.
**Expected:** a printable page for Tuesday, one day per page.
**Felt:** the same disappointment as last time. I cannot tell whether my print list works.
STRUGGLE: **pressing "Print the … list" in the bench gives no visible result** — no page, no error, no tab. I have no way of knowing if it worked.

## Step 16: The printable sheets on the canvas
**Did:** asked the agent (see step 17 note below) and it answered; "Fit" then zoomed to 74 % (shots 52–54)
**Saw:** shot-53/54 — two new frames appear beside my pages: **"Tuesday delivery sheet (printable)"** and **"Friday delivery sheet (printable)"**. The Friday one reads: "Ines Bouquets — Friday delivery — Friday, November 20, 2026 — 2 orders · 85 €" and a table **Customer | Address | Phone | Bouquet | Card message**: Claire Dubois (#1) "No address given" 06 12 34 56 78 Medium · 35 € "Joyeux anniversaire Maman!"; Camille Durand (#3) 12 rue des Lilas, 75011 Paris Large · 50 € "Joyeux anniversaire Maman, je t'aime fort". Below it a "Print this page" button and "If the print sheet doesn't open by itself, press Ctrl + P".
**Expected:** exactly this, one day per sheet, everything on one page.
**Felt:** this is the thing I have wanted for a year. I can read it without squinting, and "No address given" tells me where to chase.
STRUGGLE: I only found these sheets by scrolling around the canvas — they opened off to the side, below the two pages, and the canvas does not obviously scroll; I got there by pressing "Fit".

## Step 17: Mother's Day, by eye
**Did:** clicked the little "Mother's Day preview" link at the foot of my private page (520,279), then the "Mother's Day Special" radio (415,307), scrolled to the total (shots 56–58)
**Saw:** shot-56/58 — the fourth size appears: "Mother's Day Special 65 € — Extra large, our grandest bouquet of the year — Mother's Day week only (3–9 May 2027)" and a note "Mother's Day preview — you are seeing the Special ahead of its week … so you can try it. Customers can only order it during that week." Total at the bottom changed to **65 €**.
**Expected:** a special bouquet at its own price that I can try before the week.
**Felt:** happy — and the note explains in one line why it is not on the normal page.
STRUGGLE: the "Mother's Day preview" link is tiny pale text at the very bottom of my private page — I only found it because the agent told me, and it looks like a footnote, not something to click.

## Step 18: Save the work
**Did:** clicked **Publish** in the header (1383,61); a dialog "Publish ines-bouquets — Publishing makes this version the one people use … you can roll back"; clicked **Publish** (1180,601) (shots 59–60)
**Saw:** shot-60 — "Published draft 17 · Your app is live at: http://apps.localhost:18494/ines-bouquets · Instances that follow main: ines-bouquets @17 · on 17", a **Roll back to 7** button and **Done**; a toast "Published draft 17 to main".
**Expected:** my work kept.
**Felt:** this is the first time saving felt like one obvious button. Two clicks and it is live.
STRUGGLE: the "Roll back to 7" button sits right next to Done in the same dark style — after all the doubt about which button keeps my work, a big "roll back" next to it is unnerving.

## Verdict

**Did I get what I wanted?** — **Yes, nearly all of it.**
- Customers must give an address: yes, the order form has Street and number / Postcode / Town, and it refuses to send without them (I tried, it said "Please fill out this field").
- A printable delivery list per delivery day: yes — Tuesday sheet and Friday sheet, each with name, address, phone, bouquet size and card message, in a table, with a "Print this page" button. One day per sheet.
- Mother's Day Special: yes — a fourth size at 65 €, marked "Mother's Day week only (3–9 May 2027)", with a preview link so I could try it now.
- Keep the work: yes — Published (draft 17, live at apps.localhost:18494/ines-bouquets).
- Not done: I never saw an actual printer dialog from inside the bench. The print button on the bench seems to do nothing visible; I have to trust the sheet and the "Ctrl + P" hint.

**Hardest moment:** the stray keystroke that wrote a "p" into index.html and turned `<body>` into `<bdy>`. I broke my own shop with one wrong key and I could not put it right — the History list showed me four versions with times and internal notes and I could not tell which was safe. I had to ask the agent to repair it.

**Would I come back?** Yes — the pages themselves are lovely and the day sheets are exactly my job. But I would keep my hands off the right-hand side of the screen, and I would still like the bench to stop offering me code.

**Three struggles that mattered most:**
1. **The code pane is one careless keystroke away from my page.** It sits next to the canvas, takes the keyboard when I click near it, and silently starts a new "unsaved" draft. Text I cannot read, in a place I can break.
2. **Print gives no feedback.** Pressing "Print the Tuesday list" in the bench does nothing I can see — no page, no message. I only got reassurance because the agent put the sheets on the canvas as extra frames to look at. Closing the bottom panel's × and discovering those off-screen frames both took several tries, and the canvas does not clearly scroll or pan.
3. **Saving is a maze of near-identical buttons and modes.** Auto / Ask / Read-only | Proposal / Draft | Default at the bottom left (I opened a model list by accident), Accept vs Publish, an old proposal still sitting in the Review tab from two hours ago, plus "Roll back to 7" next to "Done". Today, at least, Publish → Publish → Done was findable — after the agent told me the words "Accept, then Publish".
