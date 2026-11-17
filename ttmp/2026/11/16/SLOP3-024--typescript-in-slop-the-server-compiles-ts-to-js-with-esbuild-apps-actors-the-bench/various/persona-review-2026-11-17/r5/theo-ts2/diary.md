# Theo — finishing the inventory2 TypeScript migration

Session start: last session converted the actor (actor.ts, typed args schemas, no `any`).
What's left per my plan:
1. The page: inline JS in index.html becomes TypeScript, calling the actor through typed actions.
2. Pin the CSV export byte-for-byte with a scenario (bench scenarios can check a download now).
3. A scenario for the edit leg of the add/edit/delete round trip.
4. Zero type errors, every scenario green before and after, no `any`, every cast explained.

## Step 1: Survey current state
Opened inventory2 (not a new app). Read the Code view, Scenarios, Review tab.
**Did:** open-app, view Scenarios, view Review, view Code, read index.html (113 lines, one inline `<script>`), read actor.ts (96 lines).
**Expected:** actor converted, page still plain JS inline, scenarios pinning today's behaviour.
**Happened:** Exactly that. actor.ts is typed and clean. Page is all inline JS with untyped `slop.actions.*` calls. 8 scenarios exist; two already had recorded ✓ results.
**Felt:** in familiar territory — this is where I left off.

## Step 2: Baseline — all scenarios green before touching anything
**Did:** view Scenarios → Run all.
**Expected:** all pass, so I can prove I don't break behaviour.
**Happened:** "All 8 scenarios passed" (transient `__rowid` seeding notices, but green).
**Felt:** good, safe to proceed.

## Step 3: Asked about download-checking scenarios; reversed the step order
**Did:** ask — agent explained the download step `{ "download": "inventory.csv", "text": "…", "exact": true }`, confirmed the edit-leg is feasible, confirmed .ts compiles on the page, and flagged the inline-onclick → addEventListener trap. It wanted to refactor first; I refused: pin first, then refactor.
**Expected:** it to add the edit-leg scenario and CSV byte-pin against the current JS page, then convert.
**Happened:** It agreed — and then went far beyond: claimed the captured fixtures carry a bogus `__rowid` key and are "unloadable", that reset re-runs migrations (rows 1–7 always present), that several scenario selectors were "broken from birth", so it DELETED fixtures/no-low-stock.json, emptied today-7-rows.json to `tbl_inv: []` (relying on migration seed!), and edited selectors in four existing scenario files. I hit Stop mid-debugging.
**Felt:** alarmed — its runner said "5 pass 4 fail" on a suite I watched pass 8/8.
STRUGGLE: agent rewrites existing scenarios/fixtures and claims the suite was "never green" while I personally watched Run all say 8/8 — direct contradiction of what I can see.

## Step 4: Investigated the proposal; rejected it
**Did:** read the diffs in Review (deleted no-low-stock fixture with the 7 Qty-raised rows; today-7-rows emptied to `[]`), ran "Check layout and scenarios", then Run all on the proposal.
**Expected:** either its fixes make the suite greener than draft, or proof the originals were broken.
**Happened:** the proposal suite FAILED ("2 scenarios failed"), while the draft — which I re-ran right after rejecting — passed 8/8 again. So the originals were green and its rewrites made things worse. Rejected the proposal (7 files discarded).
**Felt:** vindicated and annoyed in equal measure. My rule held: what I can see in the Scenarios view beats what the agent claims its internal tools did.
STRUGGLE: had to use the bench's own Run all as the only trustworthy gate, because the agent's tool-based run results contradicted the visible ones.

## Step 5: Rules set; agent in Ask mode; discrepancy explained
**Did:** rejected the proposal (7 files), re-verified draft green ("All 8 scenarios passed" — third time), switched composer to Ask, and sent the rules: no touching existing scenarios/fixtures (one exception: the stale note), the Scenarios-view Run all is the only gate, explain tool-vs-view discrepancies before "fixing" anything.
**Expected:** pushback or excuses.
**Happened:** none — it reproduced the failure live (its scenarios.runAll hard-errors on the fixtures' `__rowid` key; the view's seeding is lenient and genuinely lands the rows — low-stock-none-when-empty can only pass if the bumped quantities load), admitted it overgeneralized the "no recorded results" claim (run records are per-workspace), and probed the edit leg in-memory including a deliberate-fail self-test. Ask mode means I approve each eval — much better.
**Felt:** this is the working relationship I want. The diagnosis finally matches what I can see.

## Step 6: STEP 1 done — edit-leg scenario written and accepted
**Did:** approved its two writes: created scenarios/edit-row-via-ui.json (19 steps: prefill assertions, edit to Foam roller 9in/9/12.50, Add, in-place update on ID 3 via single-column SQL checks, count stays 7, no 'Paint roller' left, form clears, no Updated assertion) + the one-line stale-note fix in add-delete-roundtrip.json. Read both diffs in Review, then ran Run all myself on the proposal.
**Expected:** 9 green, then accept.
**Happened:** "All 9 scenarios passed" → accepted into draft (store: draft 33). Nothing else changed — 0 type issues still.
**Felt:** solid. The edit leg of the round trip is now pinned against the real JS page, before any refactoring.

## Step 7: STEP 2 — CSV export pinned byte-for-byte, accepted
**Did:** authorized the one exception (modify export-csv-no-error.json for this purpose). The agent derived the pinned bytes from the fixture + the export code (bare-comma join, \n, no trailing newline), showed me the exact string, found a real timing trap on the way (clicking Export before the async load() finished yields a header-only CSV — added a `waitFor` guard), proved the pin can fail (deliberate wrong-bytes variant), then wrote +9 −1: new description, waitFor guard, `{ "download": "inventory.csv", "text": <pinned>, "exact": true }`.
**Expected:** Run all 9 green, then accept.
**Happened:** "All 9 scenarios passed" on the proposal → accepted into draft 35. The pinned bytes lock in the no-quoting quirk too (comma in a name would corrupt the export and fail the scenario) — agent suggested a SECURITY-REVIEW.md note; I'll decide later.
**Felt:** good — a pin that can fail, verified against the fixture by my own eyes.

## Step 8: STEP 3 — convert the page to main.ts
**Did:** (next) ask for the page conversion: extract the inline script into main.ts, typed actions, addEventListener wiring, no `any`, casts commented; index.html gets the module script tag; every scenario stays green.
