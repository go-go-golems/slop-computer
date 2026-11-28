# Diary — Lena, round 2

Goal: a second chart on the same page (rent vs income per district, scatter with trend
line), drawn with a REAL library (Chart.js or Observable Plot). Last time I got three
contradictory answers about libraries, so this time I ask once, plainly, and hold the
agent to it. Numbers must match my CSV. Page must stay fast at 375px.

## Step 1: opened my app, getting oriented
Opened lena-charts2. The line chart with district dropdown is there (the SVG renderer
the agent built last time). Before asking, I want to see what data the app holds so I
know whether income figures are even in there or I have to bring them.
**Did:** benchdrive lena2 open-app lena-charts2, then view Data
**Expected:** the rents table with my 30 rows / 6 districts
**Happened:** Data view shows tables meta + rents; rents has district/median_rent/month (30 rows, 6 districts). No income data in the app — I'll bring mine.
**Felt:** oriented, good to go

## Step 2: asking THE question, once
No income column exists, so my income CSV has to come in. And the whole point of this
visit: last visit I got three contradictory answers about charting libraries ("yes
Chart.js" → "no, custom renderer" → "actually SVG is better"). This time one plain
question, and I hold it to the answer.
**Did:** benchdrive lena2 ask "..." (the full text below)
**Expected:** one straight answer about Chart.js vs Observable Plot — possible or not,
who fetches the library from where, and what happens when that site is down — then it
carries out my choice.
**Happened:** One straight answer, finally: both Chart.js and Observable Plot ARE possible.
Script-tag route: the reader's browser fetches from jsdelivr CDN, pinned version;
if the CDN is down my existing line chart still works (it's the agent's own SVG code,
no dependencies) and the scatter box shows a note instead. Vendored route: a command
my developer runs puts the library inside the app so no outside site is contacted at
all (no failure mode). It recommends Chart.js (smaller, ~205 KB vs ~430 KB, already
checksummed a pinned version) and refuses to hand-copy library bytes in — enters either
via visible script tag or the vendor command. Also honest that both routes work for Plot
and it'd checksum Plot too if I pick it.
**Felt:** relieved — this is the answer I should have gotten the first time, and it
hasn't wobbled yet. "slop vendor" is a strange name for a command but the explanation
was clear enough.

## Step 3: confirming Chart.js, with my numbers pinned down
Holding it to the answer and to my data. I'm confirming Chart.js via the script-tag
route (vendoring needs my developer, later). Restating the exact numbers so there's no
wiggle room later.
**Did:** benchdrive lena2 ask "..." (confirmation with exact figures)
**Expected:** it builds the scatter without changing its story
**Happened:** Built in a proposal (~5 min): income table + admin-only income CSV import,
scatter.ts loading Chart.js v4.4.1 lazily from the jsdelivr CDN (never blocks the line
chart, 12s timeout → note in the scatter box), least-squares trend line + summary line
"rises by about €0.35 for every €1", both source notes, 5 scenarios green (it even
broke its own tests on purpose to prove they can fail). Frame text at 375px shows the
scatter section under the line chart. I hand-checked the slope against my CSV:
covariance 588,500, variance 1,705,000 → 0.345 — matches. Rent figures 1360/1170/1070/
1055/945/760 and income 4150/3600/3300/3400/2900/2450 all as I gave them.
One caveat from the agent: district names beside the dots are drawn inside the canvas,
so its automated tools can't read them — it asked me to glance at 375px myself.
STRUGGLE: I couldn't get a readable look at the canvas pixels myself — screenshot tools
saved a file but I couldn't make out the labels from it, so the dot labels are the one
thing I'm taking on code + the agent's word.
**Felt:** cautiously happy — the story stayed consistent all the way through

## Step 4: accepting the proposal
Numbers verified against my CSV, story consistent, line chart untouched. Accepting so
the draft gets the scatter; then I'll re-check the live draft at 375px.
**Did:** clicked "Accept the changes"
**Expected:** draft gains the scatter + income table, dev frame reloads with it
**Happened:** Accepted cleanly — draft now has income table (my six figures exactly:
Centro 4150, Este 3600, Oeste 3300, Norte 3400, Sur 2900, Periferia 2450), scatter
section renders at 375px, console clean, no errors.
**Felt:** good — this is what accepting should feel like

## Step 5: using the app as an editor — income import round-trip
I test like a journalist: paste a doctored income CSV (Periferia 2000 instead of 2450)
through the app's own import box, watch the scatter react, then restore my real data.
**Did:** frame-type into the income box, frame-click "Import income CSV"
**Expected:** slope line changes, then changes back on restore
**Happened:** slope went €0.35 → €0.27 → back to €0.35. I hand-checked the doctored
slope too (724,500 ÷ 2,643,750 ≈ 0.274) — it's really computing from the data, not a
canned string. Took a few tries to get into Play mode (Select mode kept intercepting my
clicks — had to click "Play" in the bench header, the P key didn't take).
STRUGGLE: Play mode — my clicks kept picking elements for inspection instead of using
the app; the P keypress didn't switch modes, had to find the header button.
**Felt:** satisfied — the chart is honest, it recomputes from the table

## Step 6: looking at the phone-width render myself
The one thing neither the agent's tools nor my frame-text can confirm: do the district
labels beside the dots crowd at 375px? The agent flagged this itself. Trying to see it.
**Did:** frame-shot / see + read of the saved PNG
**Expected:** a look at the 375px render
**Happened:** I genuinely couldn't make out the canvas from the saved screenshots —
so I did what I'd do with a colleague: told the agent neither of us can read pixels, but
it wrote the placement math, so it should check the math. It came back honest: the old
placement WAS broken at 375px (Oeste↔Norte labels overlapped by 111px², Centro's label
ran past the plot edge — two names literally unreadable on a phone). It replaced the
placement with measured-text slot search (right/below/above/left, reject any box that
hits another label, a dot, or the edge) and added a #label-check mode where the page
prints its own collision report, plus a permanent scenario. It even showed me every
label's pixel box — all six clear.
STRUGGLE: the one thing neither the agent's tools nor mine could verify (canvas-drawn
labels) turned out to be actually broken — pushing on it was the difference between
shipping two unreadable district names and a real fix.
**Felt:** vindicated — my suspicion was right, and it admitted it with real numbers

## Step 7: accepting the label fix and running all scenarios
**Did:** clicked "Accept the changes", then "Run all" in Scenarios
**Expected:** 6/6 green on the draft
**Happened:** "All 6 scenarios passed" — including scatter-labels-check at 375px
**Felt:** confident now

## Step 8: publishing (going beyond the brief)
Goal was met, so the next thing I want is what any journalist wants: readers. I looked
for a Publish button in the workspace and project menus and couldn't find one, so I
asked the agent where it was.
**Did:** benchdrive lena2 ask "where exactly do I publish from?"
**Expected:** it points me at a button
**Happened:** It brought up the publish approval directly instead — draft 29 → main,
with the income migration listed. I approved, it published, and it queried the live
production instance: Centro 4150, Este 3600, Norte 3400, Oeste 3300, Sur 2900,
Periferia 2450 — my CSV, row for row, live. Link for my editor:
http://apps.localhost:18494/lena-charts2
STRUGGLE: no visible Publish button in the menus I searched — I had to ask the agent
for it, and it turned out publishing is an agent-mediated approval, not a menu item.
**Felt:** that's the finish line — the story can run

## Verdict
**Did I get what I wanted? Yes.** A second chart on the same page — rent vs income per
district, scatter with a least-squares trend line — drawn with a real library (Chart.js
4.4.1, pinned). I asked the library question once and got one consistent answer that
never wobbled: both Chart.js and Observable Plot are possible; script tag = reader's
browser fetches from jsdelivr, CDN down = line chart still works + a note in the
scatter box; vendoring = no outside site at all. It recommended Chart.js, I picked it,
it carried it out exactly. Numbers all match my CSV (verified by hand: slope 588,500 ÷
1,705,000 ≈ 0.35; income table row for row; the import round-trip test €0.35 → €0.27 →
€0.35 proved the chart computes from the data, not a canned string). Page is fine at
375px, all six scenarios pass, and it's published.
**Hardest moment:** verifying the canvas-drawn district labels at phone width — the one
thing no automated tool could read turned out to be actually broken (two names
overlapping / off the edge), and I only caught it by refusing to accept "glance at it
yourself" as an answer and asking for the placement math to be checked instead.
**Would I come back?** Yes. This session the agent was straight with me from the first
message to the last — the opposite of last time's three contradictory answers. It
volunteered costs and failure modes, admitted the label bug with real pixel numbers,
and made the thing checkable instead of asking me to trust it.
**The three struggles that mattered most:**
1. The canvas blind spot — labels drawn inside the chart couldn't be verified by anyone's
tools, and they were genuinely broken at 375px until I pushed for a math-level check.
2. Play mode — my clicks kept selecting elements for inspection instead of using the
app; the P key didn't switch modes, I had to find the Play button in the header.
3. No findable Publish button — I had to ask the agent where publishing happens; it
turned out to be an approval dialog the agent raises, not a menu item.
