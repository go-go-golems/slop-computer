# Diary — Inès, florist (ines-visual)

## Step 1: First look at the bench
**Did:** `benchdrive ines-visual see shot-1.png`
**Saw:** shot-1.png — a big workspace. Top left "Bench". A dropdown showing "Food Bank Shift Signup aisha-shifts" — NOT my shop. Chat on the left full of text about food banks; I stopped reading. Middle shows a small page "Food Bank Shift Signup". Right side a list of files (index.html, main.ts, styles.css) and a Code tab — I don't want code.
**Expected:** I thought I'd see my own empty app.
**Felt:** Confused, in a hurry — whose app is this? I just want my flower page.
STRUGGLE: Screen full of someone else's app and technical words (index.html, main.ts) I don't understand.

## Step 2: Find how to make a new app
**Did:** click the app name at top left → menu opened (shot-2.png). Click "New app..." (shot-3.png).
**Saw:** shot-2.png: a list of apps (aisha-shifts, maya-bakery, inventory, smoke5...) with "New app... start one from a template" at the top. shot-3.png: a white "New app" box with two choices: "Simple page" and "Page with server code", plus "id" and "Title (optional)" fields and a Create button.
**Expected:** A way to start fresh — good.
**Felt:** Relieved the "New app..." was right at the top, but the two choices were hard to tell apart.

## Step 3: Create "ines-bouquets"
**Did:** clicked "Page with server code" (it said "Good when many people share the same data, or for rules people must not get around" — that is my case: customers + me + assistant). Typed id "ines-bouquets" and title "Ines Bouquets" (shot-4.png, shot-5.png). Clicked Create, waited 20 s (shot-6.png).
**Saw:** shot-5.png: both fields filled correctly. shot-6.png: top left now says "Ines Bouquets ines-bouquets". The canvas shows a page titled "Ines Bouquets" with the text "A starting point: a small list that works..." and an "Add an item" field with an Add button.
**Expected:** My own pages.
**Felt:** Good — it's mine now. It's clearly just a placeholder though, and I want it to look like a flower shop.

## Step 4: My message got lost when the screen reloaded
**Did:** sent a long wish in the chat, waited 60 s (shot-7.png). Then the screen lost the bench for a moment and came back on the food-bank app with someone else's chat about "inventory2" (shot-8.png). Reopened the app menu (shot-9.png), clicked "ines-bouquets" (shot-10.png).
**Saw:** shot-7.png: chat showed my wish and "Working ... 1 min". shot-8.png: app was back to Food Bank Shift Signup and the chat was another person's conversation. shot-9.png: "ines-bouquets draft 1 · not published · 2 instances" in the list. shot-10.png: my app, but still the starter page and my chat was gone.
**Expected:** my app stays open and the agent answers there.
**Felt:** Panicky — did I lose my work? And why is someone else's conversation on my screen?
STRUGGLE: The bench jumped to another app and another person's chat by itself; my first request vanished from the chat.

## Step 5: Asked again, and the two pages appeared
**Did:** typed my wish again, shorter ("Where are my pages? ..."), Enter, waited 90 s + 150 s (shot-11.png, shot-12.png).
**Saw:** shot-12.png: two frames side by side, both looking like a flower shop: left "Ines Bouquets — Fresh hand-tied bouquets - delivered on Tuesdays & Fridays" with Order/Orders menu, "Bouquet size" Small 25 €, Medium 35 €, Large 50 €, "Delivery day" Tuesday/Friday; right "This week's orders" with Tuesday 0 orders, Friday 0 orders and a Print button. The chat said "Everything is ready for you to review ... Your code is ines2026 ... press Accept".
**Expected:** exactly what I asked for — yes, looks like it!
**Felt:** Delighted. It even looks like a flower shop (soft colours).
STRUGGLE: The "Card message" field in the left frame is cut off at the bottom of the frame — I could only see the words "Card message" half hidden behind the SELECT/DRAFT bar.

## Step 6: Getting it saved (Accept was the hard part)
**Did:** clicked the "Accept the changes" button at the bottom of the chat twice (shot-13, shot-14), then "Review them" (shot-15) — nothing happened. Then clicked the "Review" tab (shot-16) and "Accept all" (shot-17).
**Saw:** shot-13/14/15: identical screens, button unchanged. shot-16.png: Review tab on the right listed "Proposals" — my two requests, the newest with "Accept all" / "Reject" / "Compare" and a list of files (README.md +20, actor.ts +72, index.html +75...). shot-17.png: after "Accept all" the header changed to "draft 5", the Review list said "accepted just now", and the right frame now says "This page is just for Ines. Enter your code to see the orders." with a code box and Unlock.
**Expected:** one clear button to keep the work.
**Felt:** Annoyed — the chat button did nothing at all and pushed me into a page full of files and "+20/+75" numbers that mean nothing to me.
STRUGGLE: "Accept the changes" in the chat does nothing when clicked (tried twice) — had to find Accept all in the Review tab.

## Step 7: Tried it as a customer — it works
**Did:** clicked "Play" in the top bar (took me three tries: I hit "Comment" twice — shot-18, shot-21). Scrolled inside the left frame (shot-23). Picked Friday, typed card message "Joyeux anniversaire Maman!", name "Claire Dubois", phone "06 12 34 56 78" (shot-24), pressed "Place my order" (shot-25). Then typed the code ines2026 in the right frame and pressed Unlock (shot-26).
**Saw:** shot-23: after scrolling I could see Delivery day, Card message, Your name, Phone, "Total: 35 €" and the "Place my order" button. shot-25: green-ish thanks card "Merci, Claire Dubois! Order #1 is in: Medium bouquet, delivery Friday, 35 €. Ines will text you to confirm." with "Order another bouquet". shot-26: orders page shows "Tuesday — 0 orders, 0 €", "Friday — 1 order, 35 €  #1 · Medium · 35 € — Claire Dubois (06 12 34 56 78) 'Joyeux anniversaire Maman!'" and a Print button.
**Expected:** a customer can order and I can see the order with my code.
**Felt:** Really pleased — this is exactly what I wanted, and the words are friendly.
STRUGGLE: The frames are small; the form's bottom half was hidden behind the toolbar bar and I only found it by scrolling inside the frame. Also the Select / Play / Comment buttons are three grey words of the same size and I clicked "Comment" twice by mistake.

## Step 8: Print button does nothing (second try)
**Did:** closed Review, typed the code again (shot-32), clicked Print again (shot-33). Told the agent about it (shot-34, shot-36).
**Saw:** shot-32.png: orders page unlocked, Friday "1 order, 35 €" with my test order — so the order was still there, good. shot-33.png: after clicking Print, nothing at all happened — no sheet, no message. shot-36.png (chat scrolled down): the agent says "The Print button does call window.print() — the likely problem is the printing is blocked inside the preview frame..." and that it will fix the faint grey text.
**Expected:** a printable sheet of this week's list.
**Felt:** Frustrated: the one button I care about most does nothing and gives no explanation.
STRUGGLE: Print button silently does nothing in the preview — no error, no message saying "printing only works in the real page".
STRUGGLE: The chat is long; I had to scroll a long way and it is full of computer text (eval 1, eval 2, "styles.css:55 +5", file names) mixed in with the plain sentences. I skip past it.

## Step 9: Published it and got a web address
**Did:** clicked "Publish" in the top bar (shot-38 showed the Publish dialog), pressed Publish (shot-39), then clicked "Give it a web address (ines-bouquets)" (shot-40).
**Saw:** shot-38.png: "Publish ines-bouquets — Publishing makes this version the one people use. This is the first publish: nobody uses the app yet." shot-39.png: "Published draft 7 — Your app is published, but it has no web address yet." shot-40.png: "Your app is live at: http://apps.localhost:18494/ines-bouquets".
**Expected:** a link I can copy and put in my Instagram bio.
**Felt:** Excited to see a web address... then unsure: "apps.localhost" looks like nothing a customer could open on their phone.
STRUGGLE: The web address I got is "apps.localhost:18494" — I don't know if that is a real address my customers can open or just something on this computer.

## Step 10: Checked the whole week's list with two orders
**Did:** in the left frame picked Large 50 € + Tuesday, filled card "Pour la fete des meres, merci!", name "Mme Rossi", phone "06 98 76 54 32", pressed "Place my order" (shot-47, shot-48). Unlocked the orders page again with ines2026 (shot-49). Pressed Print once more (shot-50).
**Saw:** shot-48.png: "Merci, Mme Rossi! Order #2 is in: Large bouquet, delivery Tuesday, 50 €." shot-49.png: the orders page lists "Tuesday — 1 order, 50 €  #2 · Large · 50 € — Mme Rossi (06 98 76 54 32) 'Pour la fete des meres, merci!'" and "Friday — 1 order, 35 €  #1 · Medium · 35 € — Claire Dubois (06 12 34 56 78) 'Joyeux anniversaire Maman!'". shot-50.png: Print — again nothing at all.
**Expected:** two orders sorted by day with a total, and a printable sheet.
**Felt:** The list is exactly what I need to see on printout day. But the Print button is a dud and it makes me nervous about using this for real orders.
STRUGGLE: Print button (third attempt, after the agent said it had rewritten it) still does nothing at all — no sheet, no message, no explanation.

## Step 11: The agent went quiet
**Did:** sent "Is that a link my customers can open?" and "Print still does nothing. Help!" and waited 120 s, 160 s, 100 s (shot-42 to shot-51).
**Saw:** For the last several screenshots the chat does not change: the header stays on "draft" and never says "Working" again; no answer arrives, and the chat still shows computer text (eval 1…eval 10, "styles.css:55 +5", "printBtn.textContent = 'Print'"). shot-51.png is the same as shot-45.png.
**Expected:** a reply in plain words about printing and about the address.
**Felt:** Left in the dark — I don't know if it is still working or gone, and there is nothing on screen that tells me.
STRUGGLE: No sign at all that the agent has stopped or is still thinking; three messages got no answer while the screen kept saying everything is fine ("0 issues", "draft 7 dev ok").

## Verdict
**Did I get what I wanted?** Partly. I have my two pages, they look like a flower shop, and they work: a customer can pick small/medium/large with prices, Tuesday or Friday, a card message, name and phone, and gets a friendly "Merci, Claire Dubois!" confirmation; I can open the private orders page with the code ines2026 and it lists this week's orders grouped by Tuesday/Friday with counts and totals. It is published and I was given a web address. What I did NOT get: printing, which is the thing I do every Thursday, and a web address I trust to put on Instagram (it reads apps.localhost:18494).

**Hardest moment:** the Print button doing absolutely nothing, three times, while the agent kept saying it was fixed — and then the agent going silent with no sign that it had stopped.

**Would I come back?** Yes, but only with someone next to me for the file-and-diff screens. The building part was magic; the "agree/save/print" part lost me.

**Three struggles that mattered most:**
1. Print does nothing, silently — no error, no "only works in the real page" note.
2. "Accept the changes" in the chat did nothing when clicked (twice); I only saved my work by finding "Accept all" in a Review tab full of file names and +20/+75 numbers.
3. The bench jumped to someone else's app and someone else's chat and my first request disappeared — I had to ask again from scratch; and the address I was given (apps.localhost:18494/ines-bouquets) doesn't look like something my customers can open on their phones.
