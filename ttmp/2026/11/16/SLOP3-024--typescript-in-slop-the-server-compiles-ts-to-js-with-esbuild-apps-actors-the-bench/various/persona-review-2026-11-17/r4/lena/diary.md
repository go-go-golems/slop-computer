# Lena's diary — rent chart page

## Step 1: Getting my bearings on the bench
I need a page for my rents story, so first I want to see what's on the screen and start a fresh app.
**Did:** `benchdrive lena help`, then `benchdrive lena look`
**Expected:** my own empty app, ready for my chart page.
**Happened:** The bench showed "Food Bank Shift Sign-up" and a long chat with someone called Maya and then Theo. No app of mine: "lena-charts2" wasn't anywhere.
**Felt:** out of place — like I walked into someone else's office.

## Step 2: Making my own app
I don't want anybody else's food bank app; I want a blank one for my charts.
**Did:** `benchdrive lena new-app lena-charts2` (listed templates), then `new-app lena-charts2 "Simple page"`
**Expected:** a clean page I can put a chart on.
**Happened:** A New app dialog with two choices, "Simple page" and "Page with server code", and fields for id and title.
**Felt:** fine, this bit was obvious.
STRUGGLE: didn't know which template to pick — "server code" sounded heavy for a chart page.

## Step 3: Telling the agent what the page should do
I wrote out the whole brief plus my sample CSV so it can't invent numbers.
**Did:** `benchdrive lena ask "…I'm Lena, a data journalist…"` (full brief + 30 rows of CSV)
**Expected:** it starts building the chart page.
**Happened:** error: "frame.evaluate: Target page, context or browser has been closed". The bench jumped back to the Food Bank app.
**Felt:** frustrated — I lost my page for a second and had to hunt for it in the project menu.
STRUGGLE: the message failed and the bench silently switched me to a different app; I had to `open-app` to get back.

## Step 4: Watching it build (long wait)
Seven minutes of waiting while it worked, and I could see it fixing its own errors about "types" and an "actor". I mostly watched the frame change.
**Did:** `ask "…brief + CSV…"`, then `wait 120` ×3
**Expected:** to see a chart appear in a couple of minutes.
**Happened:** "Working for 6 min 42 s: writing its next step" then finally a proposal with 8 files, frame shows "Rents / Median rent by district" with a dropdown, district chips and a line chart, plus "In 2024-05, the highest median rent was Centro at 1,360; the lowest was Periferia at 760." Numbers match my CSV.
**Felt:** relieved the numbers are right, but the wait was long and I wasn't sure anything was happening.
STRUGGLE: 7 minutes with no visible progress besides a spinner; I nearly pressed Stop.

## Step 5: Checking it's a real library, not a drawing
I asked for Chart.js specifically. I opened the file it wrote to check — and the first comment says "A small, dependency-free line chart renderer: draws into a container as SVG". That's exactly what I said I did NOT want.
**Did:** `view Code`, `click "chart.ts"`, `read`
**Expected:** a couple of lines pulling in chart.js or ECharts.
**Happened:** "// A small, dependency-free line chart renderer: draws into a container as SVG" — hand-drawn, no library.
**Felt:** annoyed — it quietly did the thing I ruled out, and hid it behind a nice-looking chart.
STRUGGLE: it ignored a hard requirement (use a real charting library) and told me it "can't add packages from here".

## Step 6: Pushing back on the library
**Did:** `ask "I looked at chart.ts and it says 'dependency-free'… can't you download it into my app?"`
**Expected:** it would either put Chart.js in my app's own files, or explain clearly why it can't and how.
**Happened:** "The bench I work in has no internet access at all…", and: "A developer with access to this app's server runs the slop command line: `slop vendor chart.js`". Otherwise it offered to keep its own renderer and label it honestly.
**Felt:** flat. This is the thing I actually care about and it's blocked by something I can't touch.
STRUGGLE: told the library is impossible without a developer and a `slop vendor` command I've never heard of.

## Step 7: Asking it to actually test instead of guess
**Did:** `ask "two things to try: (1) any way to import a package besides slop? (2) put a CDN script tag in and tell me if it loads"`
**Expected:** it would say no to both, or find a way.
**Happened:** It did test. Two findings: "files under vendor/ are served from your own site" and "the page reached jsdelivr and loaded the real Chart.js 4.4.1, no console errors". It also wrote two test scenarios and proved they can fail ("expected 1361, got 1360").
**Felt:** properly impressed at last — it went and checked rather than telling me it was impossible. And now I can see a way through.
STRUGGLE: the answer to "can I have a library" changed from "impossible" to "the page can download it", so the first answer was wrong-ish.

## Step 8: "Just try it" — and it said no on principle
I asked it to fetch the file inside the page and save it into vendor/, since it had just proved both halves were possible.
**Did:** `ask "you've proved your own blocker wrong… fetch it in the page, write the bytes to vendor/chart.umd.js"`
**Expected:** real Chart.js 4.4.1 in my app, no CDN at runtime.
**Happened:** It did fetch it — "Chart.js v4.4.1, UMD build, 205,125 bytes, SHA-256 74401d73…" — and then refused to write it: "the limit isn't technical, it's a rule I work under". It wants a developer to run `slop vendor chart.js`, and put the URL/version/checksum in the README for whoever does.
**Felt:** disappointed but it was straight with me. I have a checksum and a one-line instruction to hand to someone.
STRUGGLE: "a library is impossible" → then "I could, but I won't". I still don't have a library.

## Step 9: Reading its own README
**Did:** `view Docs`
**Expected:** plain-English instructions for me.
**Happened:** "Why no Chart.js (yet) — Packages can only be added from the slop command line… the bench cannot put a package's code into the app's files, however the bytes are fetched." Plus pinned source, byte count and checksum, and the note that the chart is a "small purpose-built SVG renderer".
**Felt:** at least it's honest and it's written down. That README I can paste into an email to the developer.

## Step 10: Using the page like a reader (phone-width frame)
**Did:** `click "Accept the changes"`, `key p` (Play mode), `frame-click "Sur"`, `frame-shot f2.png`
**Expected:** pick a district in the dropdown, see its line and the exact values.
**Happened:** The district chips work ("Sur: median rent went from 890 in 2024-01 to 945 in 2024-05" — right numbers). But the District dropdown at the top is an empty white box: `frame-type "select" "Centro"` said "No option "Centro" in select. Its options: (nothing)". And the last month label on the axis is cut to "2024-0" at 375px.
**Felt:** deflated — the dropdown is the first thing I asked for and it's blank, and a reader on a phone can't read the latest month.
STRUGGLE: the main dropdown is empty; I could only switch district by clicking the chips. A reader would think the page is broken.

## Step 11: Pasting my own CSV
**Did:** `frame-click "Data tools"`, `frame-type "textarea" "district,month,median_rent / Centro,2024-01,1500 / …"`, `frame-click "Import CSV"`
**Expected:** the chart replaces the data with mine, and tells me how many rows.
**Happened:** "Imported 4 rows across 2 districts and 2 months. The chart is updated." The district chips became Centro and Sur, and the summary read "Sur: median rent went from 700 in 2024-01 to 710 in 2024-02" — exactly what I pasted.
**Felt:** that was smooth and exactly the workflow I wanted.

## Step 12: Source note, and my numbers in the data
**Did:** `frame-type 'Source: …' "Source: National Statistics Office…"`, `frame-click "Save source note"`, `view Data`, `click "rents"`
**Expected:** the note appears under the chart for readers; the table holds my rows.
**Happened:** "Saved. The note under the chart is updated." and the page now shows "Source: National Statistics Office, rental listings survey, 2024 (monthly median asking rent)." The rents table showed Centro 1500 / Centro 1550 — my numbers.
**Felt:** good. Two places I could check numbers against my sheet and both agreed.
STRUGGLE: I typed my note in the wrong box first (there's a hidden file-input next to a "Source: …" box) — "the field input is hidden on the page".

## Step 13: Reporting the dropdown and the cut-off label
I took the three problems to the agent rather than fixing them myself, with what I saw.
**Did:** `ask "1. District dropdown is empty… 2. last month label cut to '2024-0'… 3. put my 30-row sample back"`
**Expected:** it fixes those and tells me about hover honestly.
**Happened:** "Found the dropdown bug already: render() sets selectEl.value but nothing ever creates the <option> elements… My miss." Fixed both, restored 30 rows, and said hover/tap is wired three ways (pointermove, pointerdown, click) but that it couldn't automate a tap.
**Felt:** good — it owned the mistake plainly instead of blaming the tooling.
STRUGGLE: it shipped a blank dropdown in the first place; I only found it because I went looking in Play mode.

## Step 14: Re-checking everything at phone width
**Did:** `click "Accept the changes"`, `frame-text`, `frame-shot f3.png`, `frame-type "select" "Periferia"`, `see`, `click-at 866 424`, `frame-shot f4.png`
**Expected:** dropdown lists all districts, latest month readable, exact values on tap.
**Happened:** Dropdown reads "All districts" and choosing "Periferia" gives "Periferia: median rent went from 720 in 2024-01 to 760 in 2024-05". Axis now ends "2024-05". Tapping the last point gives a dark readout: "2024-05 / Centro 1,360 / Este 1,170 / Oeste 1,070 / Norte 1,055 / Sur 945 / Periferia 760" — every one matches my spreadsheet.
**Felt:** that's the page I described. Numbers right in three places (chart readout, summary sentence, data table).

## Step 15: Asking the awkward questions (40 districts, publishing, the future swap)
**Did:** `ask "what happens at 40 districts… what do I press to publish… does swapping chart.ts for Chart.js break anything?"`
**Expected:** a straight answer, and one line for my email to the developer.
**Happened:** It built a 40-district fixture and ran it: "47 options, 230 dots, last month readable at 375px… settled in under 0.3 s" — fast, but "with 46 lines the colors start repeating… Six districts is the honest ceiling." Publishing: press Publish in the header, first publish, no address yet. Readers can't import (admin only, both server and page). And an earlier gap it found: my typed source note wouldn't have survived to production, so it seeded it — otherwise "a fresh production instance would have shown a blank source line under the chart". README line to paste: "Readers get the app's own small SVG renderer (chart.ts), not Chart.js… To switch to the real pinned library, a developer runs slop vendor chart.js."
**Felt:** the scale answer was the useful part — it tested instead of guessing. Good advice, if a bit much.

## Step 16: Publishing
**Did:** `click "Accept the changes"`, `click "Publish" --in header`, `click "Publish" --in dialog`, `click "Give it a web address"`
**Expected:** a link I can send my editor.
**Happened:** "Published draft 20 to main", then "Your app is live at: http://apps.localhost:18494/lena-charts2".
**Felt:** genuinely satisfying. It's a real page with a real address and my numbers in it.

## Verdict
**Did I get what I wanted? Partly.**
- Yes: an interactive rent page — line chart, district dropdown (and chips), a readout giving the exact month and every district's figure on hover/tap, my own CSV pasted in and drawn correctly, a source note under the chart that readers see, fast at 375px, published with an address.
- No: the hard technical ask — a real charting library instead of hand-drawn SVG. What's drawing the chart is a purpose-built SVG renderer (chart.ts). The agent fetched the real Chart.js 4.4.1 (205,125 bytes, SHA-256 74401d73…) to prove the page *could*, then refused to put it in because packages may only arrive via `slop vendor`, which needs a developer. So the library is a promise, not a fact.
- Not a numbers problem, though: the chart readout, the summary sentence, the tap tooltip and the rents table agreed with my CSV every time I checked.

**Hardest moment:** pushing on the library. First answer: "no internet access, impossible." I asked it to test; it found the page *could* download Chart.js and that vendor/ *was* served from my own site — and still said no, on a rule. Two rounds of the same request ending in "you need a developer" is where I'd normally walk away.

**Would I come back?** Yes, and I did keep going after I had the chart (scale test, publishing). I'd come back for the data work; for anything needing a package, no.

**Three struggles that mattered most:**
1. The library: three exchanges before I got the truth, and the first "impossible" answer was wrong. I still don't have Chart.js.
2. The District dropdown shipped **empty** — the main control I asked for was a blank box, and I only caught it by using the page at phone width. That's the bug that would have embarrassed me in front of my editor.
3. The source note: it existed only as an editor field with example text and lived only in the dev database — the version readers would have seen had no source line. Found and fixed, but that's the kind of thing that gets printed wrong.
