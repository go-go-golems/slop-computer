# Devon's diary — kanban board

## Step 1: See what the bench is
I want a kenban board, side project, and I want to see how this thing works before I ask for anything.
**Did:** `benchdrive devon look`
**Expected:** A blank-ish bench or some editor.
**Happened:** "Bench · app Weekly Science Quiz quiz · workspace draft". There's Agent chat, Canvas with a 375×720 frame showing a quiz, Code view listing actor.js, app.json, index.html, sql/001_quiz.sql, Console, Inspector.
**Felt:** Okay, so it's another app open, not mine. Need to make my own app first.

## Step 2: Make my own app
I don't want the quiz app. I need my own kenban app, from the "page and actor" starter, because the whole point is rows in SQL through an actor.
**Did:** clicked the app title menu → "New app…" → "Page and actor" → id "devon-kanban" → Create
**Expected:** A fresh app with a page, an actor and a sql migration, in TypeScript.
**Happened:** "New app devon-kanban (on draft)". Code view files: README.md, actor.ts, app.json, index.html, main.ts, sql/001_items.sql, styles.css. Canvas frame 375×720 with title, an "Add an item" field and Add button.
**Felt:** Good — it's TypeScript out of the box, .ts files not .js. Now let me read what they gave me.

## Step 3: Read the starter
Before I ask for anything I want to know what the starter actually gives me: how the page talks to the actor, and whether the types are real.
**Did:** clicked each file in Code: main.ts, actor.ts, sql/001_items.sql, app.json, index.html
**Expected:** TypeScript, a typed door between page and actor, a real SQL migration.
**Happened:** main.ts does `const slop = await claude.use('slop')` then `await slop.actions.list({})` — returns rows typed from the actor's `result` schema. actor.ts uses `defineActor` / `defineAction` with JSON Schema for args and result, `const sql = use('sql')`, `requires: 'view'`. The status line under each file says "editing draft types ok". Comments mention `actions.d.ts` "from slop types".
**Felt:** Fine. Types are inferred from the schemas, not hand-written d.ts, which I can live with — but I want to see it actually fail when I break something.

## Step 4: Ask for the kanban board
I described exactly what I want: three columns, title+owner, move cards, all through the actor and SQL, typed, wide frame.
**Did:** `ask "Build me a small kanban board ..."`
**Expected:** A proposal with a new migration, actor actions and a page that calls them.
**Happened:** Agent made a proposal (4 files: actor.ts, index.html, sql/002_cards.sql new, styles.css). Frame 1 shows "1 error" and "Uncaught Error: devon-kanban-prop-mwk3wyo3224s-1082d4 has no action \"list\"". So the frame is broken.
**Felt:** Suspicious. It renamed the actor's actions but let me check whether it touched main.ts.

## Step 5: Read the proposal before accepting it
The frame errors, so before accepting anything I read the changed files.
**Did:** Review, then Code → main.ts, index.html, actor.ts
**Expected:** The page rewritten to call `board` / `addCard` / `moveCard`.
**Happened:** actor.ts is good: STATUSES tuple, Status type, CardRow type, CARD result schema reused, actions `board`, `addCard`, `moveCard`, `sql.one`, a new 002_cards.sql. index.html got the new form (title, owner, status radios) and still loads `main.ts`. But main.ts was NOT changed: still `querySelector('#list')` and `slop.actions.list({})` / `slop.actions.add(...)`. So `#list` doesn't exist and `list` isn't an action. Yet the file footer says "editing proposal ... types ok".
**Felt:** That's the exact thing I hate: green "types ok" while the page is guaranteed broken. The agent said "Now the page" and then didn't do the page.
STRUGGLE: Code view reports "types ok" on main.ts even though it calls `slop.actions.list` and the actor only has board/addCard/moveCard — and the frame is erroring with "has no action list".

## Step 6: Ask again, and find the agent left debugging junk in my files
The frame had one error and the page's script was untouched, so I asked it to rewrite main.ts and explain the 'types ok'.
**Did:** `ask "The proposal is broken ... Please rewrite main.ts for the new actor, and tell me exactly why the type check passed before."`
**Expected:** A real page script and a straight answer about the type check.
**Happened:** No answer: the last chat line is "Empty completion". main.ts is now THREE lines: `const slop = (await claude.use('slop'))!` / `const all: never = slop.actions` / `export { all }` and its footer says "1 type error". actor.ts grew a `probe` action and its first comment now reads "The app's server half (checks probe)". The canvas has no error but the board is empty — the form is there, no columns, no cards. Header still says "0 issues".
**Felt:** Furious. It left a deliberate type error and a probe action in my proposal and then said nothing. And the header says 0 issues while the file footer says 1 type error.
STRUGGLE: Proposal contains leftover probe action in actor.ts and a deliberate `const all: never` type error in main.ts, with "Empty completion" instead of an explanation; page renders an empty board with no console error.
STRUGGLE: Header "0 issues" disagrees with the Code footer "1 type error".

## Step 7: Read the second attempt
**Did:** read main.ts, actor.ts, clicked "7 type errors" in the footer
**Expected:** The page rebuilt and type-clean.
**Happened:** main.ts is now a real page: Card/Status types, boardEl, a form, cardEl with initials, columns. Frame shows three columns with "0 / Nothing here yet / [+ Add to To do]" etc. But footer says 7 type errors. Clicking the footer opens a menu:
  main.ts:124 'slop' is possibly 'null'.
  main.ts:124 Property 'board' does not exist on type 'ActionsOf<AppActions>'.
  main.ts:126 Parameter 'col' implicitly has an 'any' type.
  main.ts:138 same for moveCard; 159 same for addCard.
The last agent reply is again "Empty completion". The actor still had a probe action until this turn; now actor.ts changed +1 −7.
**Felt:** At least it's alive on screen. But three of those errors are true null-check mistakes, and the other four are the checker not believing the actor has board/moveCard/addCard. The actor clearly declares them.
STRUGGLE: Type checker says `board`/`moveCard`/`addCard` do not exist on ActionsOf<AppActions> while they are declared in the actor's defineActor in the same proposal.

## Step 8: Accept it so I have something to edit
The 4 "action does not exist" errors are on the actor's own actions, so I suspected the proposal's generated action types were stale. I accepted all to see.
**Did:** Review → "Accept all"; opened Code again; clicked the footer errors
**Expected:** After accepting, types regenerate and the action errors go away.
**Happened:** "Accepted 5 changes into draft 15". Now main.ts says 3 type errors, all "'slop' is possibly 'null'" at 124, 138, 159. The board/addCard/moveCard errors are gone. So yes: inside a proposal, the page was checked against the draft's old actions. On the canvas the board renders: three columns, "Nothing here yet", "+ Add to To do/Doing/Done".
**Felt:** Relieved the actions are typed for real, but annoyed I had to accept a broken-in-proposal change to find out.
STRUGGLE: Type errors on page action calls only cleared after accepting the proposal; before that the checker used stale action types and I couldn't tell whether my page or the checker was wrong.

## Step 9: Try to edit the file by hand
The only errors left are three "'slop' is possibly 'null'". I want to fix them myself, one char: `const slop = await claude.use('slop')!`.
**Did:** clicked main.ts, then clicked "textarea", pressed Control+End, pressed "a"; also tried creating a scratch file with "+ New"
**Expected:** Clicking the code puts a caret in it so I can type a character.
**Happened:** Clicking main.ts only opens it; no caret. Control+End and "a" changed nothing. `type "code"` works but it REPLACES the whole file: on a scratch about.html, `type code "hello world"` made the entire file "hello world", and `key "!"` then appended because the replace left the caret at the end. There is no visible Edit button on the Code pane, only History, Blame, Ask agent, Delete.
**Felt:** Stuck. I can't put a caret at line 4. The only way to change one character is to rewrite the whole 178-line file through the agent or through a bulk text replace.
STRUGGLE: No way to edit code by hand at a caret: Code is a textarea that benchdrive can only replace wholesale; clicking the file or pane doesn't focus it, and there's no Edit action.
STRUGGLE: Creating a new file with "+ New" and clicking OK without a name silently created about.html from a template (I deleted it).

## Step 10: Use it like a user
**Did:** switched to Play, typed title "Fix the auth redirect" and owner "Devon" with frame-type, clicked Add card, then moved it with the card's Doing button, then changed the frame viewport to Desktop (1280×800) with the ⇔ menu and reloaded with ↻
**Expected:** Card shows up in To do, moves to Doing, and survives a reload because the actor wrote SQL.
**Happened:** "Added \"Fix the auth redirect\" to To do." Card appears with "D" avatar and Devon. Clicking plain "Doing" hit the form radio instead; I had to target "li.card .move button" to move the card. Then "Moved ... to Doing". After the reload the card is still in Doing, so it is really on the server. Desktop viewport shows three columns side by side. Header has 2 issues: text contrast 3.77:1 and 3.79:1 on the "To do"/"Doing" column labels.
**Felt:** The board works and persists. Good. The radio-vs-button ambiguity is on me but took a guess.
STRUGGLE: Clicking visible text "Doing" hit the add-form radio, not the card's move button; needed a CSS selector to do what I meant.

## Step 11: Trying to make a scratch file went sideways
I wanted a small file to hand-type a deliberate type mistake into.
**Did:** Code → "+ New"; tried type text / Path / input / about.html; then clicked OK; later typed in the file filter by accident
**Expected:** Name a file and get an empty editor.
**Happened:** Every `type <field>` for the dialog said "No visible field ... Fields on screen: input in dialog". Clicking OK with the default value created about.html from a template twice (deleted both). The only thing that typed into the dialog was `key` (pressing s replaced the selected "about.html" with "s"). One `type "input"` went into the Code "Filter files" box instead, hiding the file list.
**Felt:** Death by a thousand paper cuts. The dialog is right there and I can't address its input.
STRUGGLE: New file dialog does not expose a typeable field to benchdrive; only single key presses reach it, and default about.html gets created if you press OK.

## Step 12: Get it type-clean and re-check
My two-part ask (null errors + contrast) was read, the agent poked at luminance in eval, then ended "Empty completion" and my message "was discarded" — no files changed.
**Did:** asked again with one edit only, exactly the line to change
**Expected:** The non-null assertion, a type check, and a sentence back.
**Happened:** "eval 3 ... main.ts +1 −1 ... fixed 3 type errors". Reply: "Done — one edit, in main.ts only, exactly as you specified." It says types.check returns {errors: [], count: 0}. It also says it won't guess why the earlier "types ok" was wrong without reading. Accepted the proposal into draft 23. main.ts footer now: "editing draft types ok" (no error count). Reloaded: the card "Fix the auth redirect" is still in Doing.
**Felt:** Good: typed, server-backed, that part is done. But I still can't explain the green "types ok" from before, and the 2 contrast issues are still in the header.
STRUGGLE: A two-item request (fix 3 null errors + 2 contrast issues) was dropped entirely with "Empty completion" and "was discarded"; only a single-edit retry worked, and the contrast fix never happened.
STRUGGLE: When I finally got prose, the agent refused to explain the earlier type-check behaviour ("I'm not going to guess at the mechanism") — exactly the kind of answer that leaves me unable to tell whether the code is correct.

## Verdict
**Did I get what I wanted:** Partly. There is a working kanban board: three columns, cards with title and owner, add and move, all through the actor's `board`/`addCard`/`moveCard` actions into a real `cards` table (002_cards.sql). The calls are typed from the action result/arg schemas, there is no fetch() in the page, and after the last edit main.ts says "types ok" and the agent's check says 0 errors. The card survived a reload, so it is on the server. What I did not get: a page I type-checked and edited by hand. The Code view's "types ok" was wrong while main.ts called a nonexistent `list` action, the code editor has no caret-level editing through the bench, and the agent left probe code and empty replies.

**Hardest moment:** reading main.ts in the proposal, seeing it call `slop.actions.list` while the actor had no such action, and the footer still saying "types ok" — then having to accept the broken proposal to discover that the four action errors were only stale proposal types.

**Would I come back:** Yes, for the actor + SQL + typed action model, which felt right and was easy to read. No, if I have to hand-edit anything bigger than a few lines: the 178-line code textarea is replace-only and the New file dialog input can't be targeted. I'd want an editor with a caret and a real language server that knows the current proposal's actor.

**Three struggles that mattered most:**
1. Type status cannot be trusted in a proposal: "types ok" while the page calls a missing action; 4 phantom "action does not exist" errors that disappeared only after accepting.
2. No hand editing: clicking the file or pane doesn't focus the code, no Edit action, `type code` replaces the entire file, and the New file dialog input rejects `type` (only single `key` presses reach it, and OK without a name creates about.html).
3. Agent reliability: two "Empty completion" turns, a leftover `probe` action and a deliberate `const all: never = slop.actions` in my main.ts, and a valid two-part request silently discarded.
