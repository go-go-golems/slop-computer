## Step 4: Ask to see the merge plan BEFORE merging, and ask about undo
I will not let anybody combine my members until I see what happens to each name gy and each payment. And I wanted to know I could get back.
**Did:** `benchdrive grace ask "Now the duplicates… please don't change anything yet: just write out for me, pair by pair, what the single person would look like afterwards… And tell me plainly whether there is a way to put it back the way it was if I don't like it."`
**Expected:** a table of before/after per pair, and an honest answer about undo.
**Happened:** nothing changed ("Nothing in the app changed in this turn"), and Claude gave three little tables. Anna Schmidt → keeps anna.schmidt@example.org, 12, 2025+2026. Carla Diaz → 7, and paid becomes 2025 (her "never" row disappears, the row that paid 2025 survives); it even noticed the second Carla has **two spaces** in her name ("Carla  Diaz") — that's why it never caught my eye. Frank Liu → 15, emails were the same address in different capitals, paid 2025, 2026. Total after: 9 members. On undo: nothing changes until I accept; it would save a backup of the exact 12 rows first; and "the Timeline keeps earlier versions of the app".
**Felt:** could breathe. It answered the undo question before I had to nag, and it flagged Carla's payment rather than quietly keeping the flattering answer.

## Step 5: Try to look at the raw data myself
Good secretaries check the source, so I went looking for a table of the actual records.
**Did:** `benchdrive grace view Data`, `click "a collection…"`, typed `members` into the dialog field, `OK`, then `shot d1.png`
**Happened:** the Data tab lists records as lines of squiggles: `members/m1 {"email":"anna.schmidt@example.org","name":"Anna Schmidt","paid":{"2025":true,"2026":true},"plot":"12"}`, then m10, m11, m12, m2, m3… in no order I could follow. "Tables: No tables".
**Felt:** not for me. I could see the years recorded as small true/false marks but I couldn't count 12 without a fight. I'll trust the page and the counts instead.

STRUGGLE: The Data view is a wall of code — I could not open it like a spreadsheet, so I have no independent way to count the records other than the page and what Claude tells me.

## Step 6: Let it do the merge after the backup, and count again
I had said yes on all three pairs, so the only thing left was to make sure the backup really came first and that it landed in a copy I could look at.
**Did:** `ask "…yes to all three — Carla's 2025 must stay… save the backup of the exact 12 rows first, then do it in a proposal…"`, then `wait`, `frame-text 1`, `click "Accept"`, `frame-text 1`
**Expected:** 9 rows, every payment year kept, my own list unchanged until I accept.
**Happened:** the first attempt took over four minutes and my connection dropped ("Command aborted") — but when I came back the proposal was ready with "3 files to review". The preview read "9 members" and I counted the rows myself: Anna 12 / 2025, 2026 · Gita 9 / 2026 · Hans 2 / 2025 · Ines Plot 18 / never · Bob #3 / 2025 · Carla 7 / 2025 · Dev 21 / 2026 · Eve Plot 4 / 2024 · Frank 15 / 2025, 2026. Claude's write-up said the backup of all 12 rows was saved in `fixtures/members-backup-12.json` "character-for-character — every odd spelling, both spaces in Carla Diaz, every paid year", that payments merge as a union so "nobody can lose a payment", and that Reject would leave my list untouched. I accepted, then re-read the page: still 9, same numbers.
**Felt:** that was the moment I trusted it. It kept Carla's 2025 and told me why instead of hiding it.

## Step 7: Tidy the plot numbers, before and after
Three plots were written three ways — 'Plot 18', '#3', 'Plot 4' — and a nice list should read as plain numbers, as long as nobody moves plot.
**Did:** `ask "…Please make the whole column plain numbers… Ines must still be on 18, Bob on 3, Eve on 4… nothing until I've seen it, and give me the before and after side by side."`, `wait 100`, `frame-text 1`, `click "Accept"`
**Expected:** one frame showing the old list and one showing the new, so I could compare with my own eyes.
**Happened:** I got only ONE frame, called "After — tidied plots (proposal)". In it: Ines 18, Bob 3, Eve 4, and every other number and every paid year exactly as before, still 9 members. Claude said "Exactly three cells changed in the whole table — and your live list still shows the old spellings". I accepted and checked again: Ines 18, Bob 3, Eve 4, Eve still 2024.
**Felt:** satisfied, but slightly put out — I asked for side-by-side and got a single "after". I compared against my own written-down list instead, which is exactly why I keep notes.

STRUGGLE: Asked for before-and-after side by side and only got the "after" frame; I had to compare from my own notes.
STRUGGLE: The screen went blank/"command aborted" during the long merge turn and I had no idea whether my list had changed while I was away.

## Step 8: Who has not paid this year — and which year is "this year"?
The committee asks me this every meeting, and I refuse to chase the wrong people because an app guessed the year.
**Did:** `ask "…which year does 'this year' mean…? please don't lump everyone unpaid together — Mrs Costa has never paid, while Mr Becker paid in 2025… show me clearly who has not paid for the current year, with how long it's been since they paid anything."`, then `frame-text 1`, `frame-shot f1.png`, `click "Accept"`
**Expected:** a short list of unpaid people for the right year, split by how long ago they paid.
**Happened:** "This year means 2026 — today is 17 November 2026", and it fetched the date rather than guessing. It also said honestly "the list records only the year someone paid, never the month or day", so it can't say "a few weeks late". The preview frame has a boxed section: "Not paid for 2026 — 5 of 9 members", then **Never paid anything: Ines Costa — plot 18 — no email on file**, then **Paid in earlier years, but not 2026:** Eve Martin (plot 4, last paid 2024, 2 years ago), Bob Okafor (plot 3, last paid 2025, last year), Carla Diaz (plot 7, 2025), Hans Becker (plot 2, 2025), with emails beside each. The full list of 9 is still underneath, unchanged. I checked the arithmetic myself: paid 2026 are Anna, Gita, Dev, Frank — so 5 unpaid is right. Accepted.
**Felt:** this is the thing I actually wanted; it reads like something I'd have typed myself. Small pleasure: it prints "last year" next to 2025 rather than making me work it out.

STRUGGLE: I had to ask which year "this year" meant — the app never told me, and if I'd assumed 2025 I'd have chased four people who had paid.

## Step 9: Printable — and I ask to see the paper, not just be told
The noticeboard by the gate and the treasurer both need this on paper, unpaid box included.
**Did:** `ask "…when I press print, what actually comes out? …on ordinary A4, with nothing chopped off the right-hand edge… don't just tell me it's fine — I'd like you to look at the printed page itself."`, `wait 90`, `frame-text 2`, `frame-shot f2.png`, `frame-shot f3.png`
**Expected:** a sheet of paper on the screen I could read, with the unpaid box and all nine names.
**Happened:** it made an A4 frame (794×1123) with title, "Printed on 16 November 2026", "9 members", the yellow unpaid box, and the full table of 9 — and in the first look the A4 sheet was clean with no print button and no date missing (my first shot showed "Printed on 16 November 2026"). But when I asked it to prove the button stays off the paper, the sheet on my screen then read "[Print this list]" at the top and the "Printed on 16 November 2026" line had vanished — so the "paper" I'm being shown is not what came out of the printer.
**Felt:** uneasy. I'd rather be told "I can't show you the paper here" than shown a sheet that quietly changed.

STRUGGLE: The A4 "paper" frame stopped looking like paper — a Print button appeared on the sheet and the printed-on date disappeared. I can't tell whether the printer gets the button or not.
STRUGGLE: It told me "today is 17 November 2026" but the printed line says "Printed on 16 November 2026". Which is it? I don't want the wrong date on the noticeboard.

## Step 10: I hold the paper up to the light, and it comes back fixed
I would rather be a nuisance before the photocopier than after.
**Did:** `ask "Stop a moment — I'm not accepting this one yet… show me the paper exactly as the printer will produce it, with the print rules switched on, and tell me plainly if that can't be shown here."`, `wait 120` twice, `frame-text 2`, `frame-shot f4.png`
**Expected:** an honest admission, then a sheet that matches the printer.
**Happened:** it owned both things. The A4 frame really had been printed-rules for the first look and screen-rules for the second, and "that's my fault for not saying so"; my first sheet was the genuine paper view, my second was the screen squeezed onto a big page. On the date: the date line "is written by the clock of whatever machine views the page", and its own clock was in a different time zone, past midnight — my own computer says 16 November 2026 too, so the printed date is right and its spoken "17th" was the odd one out. Then it found a real fault in its own work: the paper stylesheet was switched off on screen ("a canvas frame is a screen, so the printer's rules… were invisible to it"), and fixed it so the paper view is a genuine paper view. New sheet: no Print button, "Printed on 16 November 2026" back, the unpaid box now black-on-white instead of yellow (printer ink), all nine rows, one page, nothing over the right edge.
**Felt:** this is why I insist on seeing things. It was wrong twice and both times it said so plainly rather than smoothing it over.

## Step 11: Accept the printable version, and count one last time
**Did:** `click "Accept"`, `frame-text 1`, `frame-text 2`, `frame-text 1 | tail`
**Happened:** header went to `workspace draft · draft 21 · dev on`; Frame 1 is "Screen — the app as she uses it (button, no date line)" with "9 members" and the unpaid box; Frame 2 is "A4 paper — exactly as the printer produces it" with the date line and no button. Final read of the list: Anna 12 / 2025, 2026 · Gita 9 / 2026 · Hans 2 / 2025 · Ines 18 / never · Bob 3 / 2025 · Carla 7 / 2025 · Dev 21 / 2026 · Eve 4 / 2024 · Frank 15 / 2025, 2026 — 9 people, nobody lost.
**Felt:** done, and calm about it.

STRUGGLE: The frame's own label reads "index.html#paper (missing)" next to my sheet of paper. The paper looks right, but "(missing)" in the title of the thing I'm trusting with the noticeboard is unsettling.
STRUGGLE: I never actually pressed the "Print this list" button — I've no proof of what my printer does, only of the sheet on this screen.

## Verdict
**Did I get what I wanted: yes.** The list is clean — 12 rows down to 9 real gardeners, no one lost and no payment lost (Carla's 2025 survived because one of her rows showed it); plots are all plain numbers (12, 9, 2, 18, 3, 7, 21, 4, 15); a clear "Not paid for 2026 — 5 of 9" box separates Mrs Costa (never paid) from four people who paid last year; and there's a proper A4 print sheet with the unpaid box on it. A backup of the original 12 rows was saved before anything was touched, and I was told how to get back.

**Hardest moment:** the paper. Being shown a "sheet of paper" that quietly changed from the printer's version to the screen's version — and a date off by one — made me distrust everything on the screen for a while. It was fixed honestly, but only because I stopped and asked.

**Would I come back:** Yes. It explains itself in my language, it never changes anything until I accept, and it volunteers bad news (Carla, the date, the broken stylesheet). I would not use it without looking at every step, though.

**Three struggles that mattered most:**
1. The "proposal / accept / draft" idea — nothing tells you plainly "your list has not changed yet". I worked it out by watching a label in the top bar.
2. The A4 "paper" view that wasn't paper — a Print button on the sheet and no printed-on date, then a "(missing)" label on the frame. If I'd not looked twice, the noticeboard copy might have been wrong.
3. The Data tab is a wall of code (`members/m1 {"email":…}`); as a spreadsheet person I had no independent way to count the records myself, and had to rely on the page's count and on Claude's word for "12 is everybody".
