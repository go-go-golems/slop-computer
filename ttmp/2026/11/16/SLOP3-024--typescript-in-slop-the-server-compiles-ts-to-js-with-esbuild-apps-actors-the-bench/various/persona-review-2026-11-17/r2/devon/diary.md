# Devon's diary — kanban board on the bench

## Step 1: create the app
I want a small kanban for my side project: todo/doing/done columns, cards with title + owner, moves between columns, all stored server-side through the actor and SQL, with typed calls between page and actor. TypeScript, types checked.

**Did:** `benchdrive devon new-app devon-kanban2 "Page with server code"`
**Expected:** a new app with a page (main.ts) and an actor (actor.ts)
**Happened:** app devon-kanban2 created, files: README.md, actor.ts, app.json, index.html, main.ts, sql/001_items.sql, styles.css. Canvas shows a starter "Add an item" page.
**Felt:** good, exactly the template I wanted — page plus server code.

## Step 2: ask for the kanban board
**Did:** asked the agent for the full board: 3 columns, cards with title+owner, add and move, SQL storage via the actor, shared types, zero type errors.
**Expected:** one reply, code written, maybe a proposal to review.
**Happened:** big reply — it wrote types.ts, rebuilt actor.ts (list/add/move actions), main.ts, sql/002_cards.sql, plus fixtures and two scenarios (kanban-flow, move-existing). Zero type errors reported; everything landed in a *proposal*, header says "workspace Proposal", waiting for me to accept. Frame already shows the new form (Card title, Owner, column choice).
**Felt:** solid — it even planted a wrong expected value in a scenario to prove the scenario can fail. That's the kind of thing I'd do.

## Step 3: read the code before accepting
**Did:** opened Code view, opened types.ts and actor.ts; tried Review's "show diff"; took a screenshot.
**Expected:** read the whole files.
**Happened:** types.ts is clean — `COLUMNS as const`, `ColumnId = (typeof COLUMNS)[number]`, `Card { id, title, owner, column }`, imported by both sides. But every view truncates: Code view shows only the first ~12 lines of a file, arrow keys/PageDown don't scroll, and the screenshot doesn't help me. Code footer says "types ok", header says 0 issues.
**Felt:** annoying — I can see the shape of the code but not the middle of it. I want to read the actions before I accept.
STRUGGLE: cannot read more than the first ~12 lines of a file in the Code view; scrolling does nothing, screenshot useless.

## Step 4: accept → broken dev instance
**Did:** clicked "Accept 9" in Review.
**Expected:** the whole proposal lands in the draft, app keeps working.
**Happened:** page went white-ish with "Uncaught Error: no such table: items" on load. Data view showed the cards table existed (so migration 002 ran and dropped items) but something still queried items. Reload and Refresh didn't help.
**Felt:** that's a real breakage — I read the error, it smells like a stale server, not my code.
STRUGGLE: after accepting, the draft dev instance crashed with "no such table: items"; nothing I tried (reload, refresh) fixed it.

## Step 5: agent diagnosis — the accept had silently dropped actor.ts
**Did:** reported the error to the agent and asked it to fix the instance without changing code unless the code was wrong.
**Expected:** an instance restart.
**Happened:** it found the real cause: my "Accept 9" only landed *some* files — main.ts, types.ts, migration 002 arrived, but the actor.ts rewrite was dropped, so the old starter actor (querying items) ran against a DB where items no longer exists. It rebuilt actor.ts from its earlier eval sources into a new proposal (actor.ts +62 −21, types check 0 errors).
**Felt:** relieved it wasn't me, but uneasy — an accept that silently drops a file is exactly the kind of hidden behavior I hate. I'll watch file lists after every accept from now on.
STRUGGLE: "Accept" silently dropped the agent's actor.ts change, leaving draft inconsistent — only the agent's blame digging found it.

## Step 6: accept the fix, verify the page loads
**Did:** read the actor.ts diff in Review (list/add over cards with JSON Schemas, typed results), clicked "Accept all".
**Expected:** draft healthy, columns render.
**Happened:** accepted into draft 10, 0 issues, frame shows Kanban + Card title/Owner/column form and To do / Doing / Done columns, no error.
**Felt:** good — back on track.

## Step 7: use the app — add and move a card
**Did:** switched to Play mode, typed title "Write README", owner "Devon", clicked Add, then clicked → twice.
**Expected:** card appears in To do, moves to Doing, then Done.
**Happened:** exactly that. Data view (after Refresh) shows the row: `id 1, Devon, done, Write README` in the cards table — and it survived a frame reload. The database really is the source of truth.
**Felt:** that's the whole point of the actor setup, working as advertised.

## Step 8: deliberate type mistake by hand
**Did:** in the Code view, hand-edited main.ts line 7 — typo'd `done: 'Done'` to `donn: 'Done'` inside a `Record<ColumnId, string>` literal.
**Expected:** the bench should flag a type error.
**Happened:** immediately: header went to "1 issue", Code footer to "1 type error", and the issues menu showed the exact diagnostic — "main.ts:7 — Object literal may only specify known properties, and 'donn' does not…". Reverted by hand, back to "types ok" instantly.
**Felt:** exactly what I wanted — the type check runs on MY edits, not just the agent's, with real tsc diagnostics.

## Step 9: see the call sites, break one on purpose
**Did:** asked the agent (no file changes) to paste main.ts's action calls; then hand-edited `slop.actions.move({ id: card.id, column: to })` → `column: 'oops'`.
**Expected:** if the page→actor calls are really typed, tsc flags it.
**Happened:** "main.ts:60 — Type '"oops" is not assignable to type '"todo" | "doing" | "done"'." So the arguments are typed from the actor's JSON Schemas — the contract is real, not just naming. Reverted, types ok. The agent pasted the calls: `list({})`, `move({ id, column })`, `add({ title, owner, column })`.
**Felt:** that's the typed boundary I asked for, verified by breaking it.

## Step 10: remove an `as ColumnId` cast by hand
**Did:** hand-edited main.ts: replaced `String(data.get('column') ?? 'todo') as ColumnId` with `const raw = String(...); const column = COLUMNS.find((c) => c === raw) ?? 'todo'` — no cast, `COLUMNS` from types.ts.
**Expected:** types still ok, edit sticks.
**Happened:** draft 15, "types ok", 0 issues. The bench kept my hand edit (no agent turn ran, nothing reverted it).
**Felt:** good — I can shape the code by hand and the checker follows along.

## Step 11: second card, robustness checks
**Did:** in Play mode tried an empty-title Add (rejected, nothing happened — likely the HTML required field), added "Ship v0.1" / Maya, moved it to Doing. Couldn't drive the column <select> (fill doesn't work on selects) so I added to To do and clicked →.
**Expected:** both cards in SQL with correct statuses.
**Happened:** Data view: `1 Devon done Write README`, `2 Maya doing Ship v0.1`. No new console errors (only the three stale ones from the broken-instance episode earlier).
**Felt:** the app does what it says.
STRUGGLE: benchdrive can't set a <select> (fill fails, clicking an <option> times out) — had to work around via the default column + move.

## Step 12: publish and final checks
**Did:** published draft 15 to main (dialog confirmed: "Published draft 15", instance devon-kanban2 @15 follows main; no web address yet — an admin mounts it). Ran the canvas Check (0 issues) and "Run all" on the agent's two scenarios.
**Expected:** publish goes through, scenarios pass on my edited code.
**Happened:** "All 2 scenarios passed", header 0 issues, store draft 15 dev ok.
**Felt:** shipped. Went a bit beyond the brief: broke a call site on purpose, removed a cast by hand, ran scenarios, published.

## Verdict
**Yes** — I got what I wanted: a working kanban (todo/doing/done, title+owner cards, add and move), all state in SQL through the actor, the page holding nothing of its own, and genuinely typed calls between page and actor — I proved it by hand-editing a call site to `column: 'oops'` and getting `Type '"oops"' is not assignable to type '"todo" | "doing" | "done"'`. The bench type-checks every edit, mine included, with real tsc diagnostics in the issues menu and the Code footer, and it never reverted my hand edits.

**Hardest moment:** the first "Accept" silently dropped the agent's actor.ts rewrite, leaving the draft running the old starter actor against a migrated DB — the app died with "no such table: items" and nothing I tried fixed it. The agent's blame digging found it and restored the actor; after that I checked the file list after every accept.

**Would I come back?** Yes. The Code view truncating files to the first ~12 lines is my biggest gripe — I couldn't read main.ts's middle without asking the agent to paste it. But the check/scenario/proposal loop is the kind of tooling I want around TypeScript.

**Struggles that mattered most:**
1. STRUGGLE: cannot read more than the first ~12 lines of a file in the Code view; scrolling does nothing, screenshot useless — had to ask the agent to paste call sites.
2. STRUGGLE: "Accept" silently dropped the agent's actor.ts change, leaving draft inconsistent — only the agent's blame digging found it.
3. STRUGGLE: after accepting, the draft dev instance crashed with "no such table: items"; reload/refresh didn't help. (Plus a small one: benchdrive can't set a <select> — fill fails, option clicks time out.)
