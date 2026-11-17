# Devon, TypeScript dev — second visit (benchdrive: devon2)

## Step 1: Find my kanban
I came back to pick up my kanban ("devon-kanban2") and turn it into a team board.
**Did:** `benchdrive devon2 look`, then `open-app devon-kanban2`
**Expected:** my kanban, todo/doing/done, cards from SQL through the actor.
**Happened:** the bench opened on "Food Bank Shift Sign-up aisha-shifts", someone else's app and chat. `open-app devon-kanban2` answered: `"devon-kanban2" is not in the project menu. Apps it lists: New app…, Import app….`
**Felt:** annoyed — my app is gone, I have to rebuild it from scratch.
STRUGGLE: my existing app devon-kanban2 vanished; the workspace only had someone else's app.

## Step 2: Recreate it
Fine, rebuild the base: a page with server code (actor + SQL) so the state is in a table, like before.
**Did:** `new-app devon-kanban2` → dialog with two templates
**Expected:** a template picker; pick "Page with server code".
**Happened:** dialog offers "Simple page" and "Page with server code", plus an id field.
**Felt:** fine, that's the right one.

## Step 3: It wasn't lost, just not in my recents
The app exists on the server, my workspace was just pointed at aisha-shifts.
**Did:** `new-app devon-kanban2 "Page with server code"` → "store devon-kanban2 exists"; then clicked the app name in the header → menu → `devon-kanban2 — draft 15 · main 15 · 2 instances`
**Expected:** my board back.
**Happened:** `Bench · app devon-kanban2 · store: draft 15 dev ok`, canvas frame shows `Kanban`, fields "Card title"/"Owner", columns. Files: actor.ts, main.ts, types.ts, sql/002_cards.sql, scenarios/kanban-flow.json, board.json.
**Felt:** relieved, but annoyed the create dialog just said "exists" instead of offering to open it.
STRUGGLE: "New app" with an existing id only says "store exists"; the only way back was the app switcher menu.

## Step 4: Read the current board code
Before asking for anything I want to know what I'm asking to change.
**Did:** `click main.ts --in code`, `read 1 80`, `click types.ts`, `read`; Clicking "actor.ts" failed twice (once it hit an old chat message instead — I forgot `--in code`).
**Expected:** main.ts, types.ts, actor.ts.
**Happened:** main.ts: `cards = await slop.actions.list({})`, then `render()`; a move button does `await slop.actions.move({ id: card.id, column: to }); await load()`. No live update at all, no last-moved line. types.ts: `COLUMNS = ['todo','doing','done'] as const`, `ColumnId`, `interface Card { id, title, owner, column }`. Type check says "types ok".
**Felt:** at home — this is exactly my code. But clicking a file in the list is fiddly: "Nothing on screen in code is labelled 'actor.ts'" when the list is collapsed.
STRUGGLE: the file list collapses itself; `click actor.ts` silently matched an old agent message and opened nothing.

## Step 5: First attempt at the ask — lost to a closed tab
**Did:** `ask "Back again on my kanban. I want it to be a team board now. Four things…"`
**Expected:** Claude answers with the mechanism it will use and then builds it.
**Happened:** `error: frame.evaluate: Target page, context or browser has been closed` — the tab was gone, and the bench was back on aisha-shifts with another person's chat (Theo, inventory2). My message never landed (`reply` still showed the old 22:47 answer).
**Felt:** lost. Someone else is using the same bench page and it took my app away mid-sentence.
STRUGGLE: my tab was closed by someone else using the bench; my long message was silently dropped (only a raw `frame.evaluate` error).

## Step 6: Ask landed — room/SSE, version check, but 4 type errors left
I want push, not polling; and I want a straight sentence about the race.
**Did:** `ask "…1. LIVE … 2. moved by … 3. race … 4. typed, zero any, 0 errors"`
**Expected:** the mechanism explained first, then a green type check.
**Happened:** first eval was the paragraph: "each app gets a room: a per-instance message channel that rides on the connection the page already keeps open with the server (server-sent events under the hood …" — then it built. Draft 15 → 16, new `sql/003_team.sql`, 4 issues in the header, and an honest closing: "Committed to draft 16 … But it is not done, and the type check is not at 0 yet. There are 4 type errors on draft 16, and my fixing eval just failed (a find-text edit didn't match the file, so all of that eval's edits rolled back)". It flagged one liberty: add also publishes an "added" event.
**Felt:** good — it didn't pretend. But every long line of its reply is cut at "…", so I can't read the mechanism paragraph or the race sentence; I have to read the code myself.
STRUGGLE: `reply` truncates every long line, so the "explain it to me" answer is unreadable in chat.

## Step 7: Read what it actually wrote (no polling, CAS in SQL)
**Did:** `click "2 type errors (4 in the app)" --in code` → menu with the 4 errors; `Files` → `actor.ts` → `read`
**Expected:** to see whether "live" is a real push and the race is really handled.
**Happened:** main.ts: `const room = await claude.use('room')` … `room.on('cards', (raw: unknown) => { const msg = parseBoardEvent(raw); if (msg !== null) void onBoardEvent(msg) })`. The only timer is `setTimeout(() => { toastEl.textContent = '' }, 5000)` with the comment "The one timer in this file: it hides a notice. It never fetches." types.ts: `BoardEvent` is a real union (`{type:'moved';id;column;by} | {type:'added';id;title;by}`) + `parseBoardEvent(raw: unknown)`, no `any`. actor.ts move: one `UPDATE cards SET status=?, version=version+1, moved_by=?, moved_at=? WHERE id=? AND version=?` and `if (res.changes === 0)` → not_found or `ctx.fail('conflict', …)`. Errors: main.ts:34 list result unknown, main.ts:113 `me !== ''` vs `() => Promise<string>`, actor.ts:68 x2 'card' possibly null.
**Felt:** impressed — that's the CAS I wanted, in the UPDATE itself, not read-then-write. Then annoyed: 4 errors and `user.name` is a method, not a property, so `me` is a function and the toast check is nonsense right now.
STRUGGLE: the Code file list collapses every time I switch files; `click actor.ts` fails until I re-open "Files".

## Step 8: It fixed the types, then its own two-window test found a real bug
**Did:** `ask "Read it. CAS in the UPDATE is exactly right… get the type check to 0… after that, stop and tell me the count and what you verified"`
**Expected:** 0 errors and an honest "not verified by hand".
**Happened:** it went further and tested with two frames itself. First it doubted its own fix: "the list error is gone isn't proof the generator handles nullable correctly — it could have silently produced movedBy: string". It probed and got `Type 'string | null' is not assignable to type 'string'`, so anyOf was right: "Type check is 0 on draft 18. Now the hand-verification…". Then: "frames.open returns an object, and I passed the object where the frame id string goes" (my kind of bug), then "The card never appeared in Window B… the add worked (row id 3, and Window A renders it) — so what failed is the push to Window B: no console errors anywhere, the event just never arrived". It chased app.json's room declaration, then re-read emit/subscribe. Draft 21 now, console shows `PROBE recv {"topic":"cards","data":{"by":"Probe","id":5,"title":"Probe card B","type":"added"},"peer":"actor",…isMe:false}` and cards in frame 1 read `moved by admin 12:55:58 AM`.
**Felt:** glad it tested rather than told me — but nervous: the push genuinely did not arrive at first, and I can't read why from the chat.
STRUGGLE: the reply is cut per line at "…", so I can't read its explanation of the room bug; I have to go dig in the code and re-ask short questions.

## Step 9: My own two-window test
Devon tests with two frames, not on the agent's word.
**Did:** `click Play --in header`; `frame-text 2`; `frame-click 'button[aria-label="Move \"Draft the launch announcement\" to Doing"]' 1`; `frame-text 2`
**Expected:** Window B moves the card on its own, no reload, within a second.
**Happened:** B before: card under To do. One click in A, then B: `Doing / Ship v0.1 / Maya / [←][→] / Draft the launch announcement / Priya / moved by admin 12:57:57 AM`. No reload button touched.
**Felt:** that's the moment I wanted — it's really pushed, and the moved-by line is there.
STRUGGLE: both frames are the same visitor ("admin"), so "moved by admin" doesn't prove the *name* is the mover's — I'll come back to that.

## Step 10: Contrast fix by hand, then the scenarios
Devon edits small things himself and runs the eval suite before asking for more.
**Did:** opened `styles.css`, `edit 'color: #777; }' 'color: #6b6b6b; }'` (the `.moved` line), then Data view → looked at `cards` (id/status/version/moved_by columns, draft 22), then Scenarios → `Run all`.
**Expected:** issues go 4 → 0; both scenarios green.
**Happened:** `Edited line 19 of the open file … draft 22 … 0 issues`. I tried to poke `version` through the data view's SQL box but it's `Read-only SQL on this instance` — can't update. `Run all` → `Notice: All 2 scenarios passed` (kanban-flow 17 steps, move-existing 10 steps).
**Felt:** comfortable, this is my normal loop. But I still can't make the race happen by hand: no write SQL, and two clicks are never simultaneous.
STRUGGLE: the Data view's query box is read-only, so I can't stale a row on purpose to watch the conflict path.

## Step 11: "Show me the race, don't describe it" + two design questions
**Did:** `ask "1. THE RACE. Fire two move calls for the same card concurrently with the same expectVersion… 2. main.ts:113 string-matches names, the envelope has isMe, why not narrow it once and use isMe? 3. both frames are 'admin' - how does the second person get their own name?"`
**Expected:** evidence, and a yes to isMe.
**Happened:** it agreed on 2 immediately — "you're right, and there's no good excuse: I decoded by first and treated the envelope as plumbing to strip and throw away, when isMe was sitting right there". It raced two clicks in Promise.all and reported "The race worked exactly as designed", then deleted its own test rows (3–6: "Draft the launch announcement", both probe cards, "Live test card" — "leftovers from my live-update testing"). Draft 23→26, type check 0, still working after ~15 min.
**Felt:** good — it took a code-review point from me without defending itself, and it cleans up test data. But this turn is very long and I've spent most of my budget on typing.
STRUGGLE: the turn ran 15+ minutes with no way to see the race numbers until it finishes; I can only see its eval code in `reply`, not results.

## Step 12: The thread died on me — I finished it by hand
**Did:** `ask "You ended mid-eval with no summary, and the board right now says 'moved by someone'…"` → `reply`
**Expected:** the race numbers and a name fix.
**Happened:** the only answer was `a prompt is at most 262144 bytes` — the conversation is full, so Claude cannot be asked anything in this thread any more. Meanwhile the board really did read `Push check / check / moved by someone 1:04:59 AM`.
**Felt:** flat. I'd rather debug my own code than fight a dead thread.
STRUGGLE: the thread hit its context limit mid-task; the last turn also ended without a summary, and its temporary console.log probes ("USER-PROBE", "ENVELOPE-PROBE") were still in main.ts.

## Step 13: My own fixes, by hand
Nobody left to ask, so: read the History of app.json, put back what draft 16 had, delete the probes, fix the isMe logic.
**Did:** app.json History → `00:45:54` showed `"user": { "scopes": [ "profile" ] }` vs current `"user": {}` → `edit '"user": {}'` → scopes block (draft 27); `edit` the USER-PROBE block → `const user = await claude.use('user')`; deleted the `ENVELOPE-PROBE` log; replaced `if (env.isMe) return` with `if (me !== '' && env.event.by === me) return` + a comment saying isMe is false for actor pushes (the emitter is the actor); same claim fixed in the types.ts comment (draft 33).
**Expected:** 0 type errors, name back in "moved by", still live.
**Happened:** `main.ts … editing draft types ok` (0 errors), 0 issues. `frame-click 'Move "Push check" to Done' 1` → frame 2 shows `Done / … / Push check / check / moved by admin 1:22:09 AM` — name back AND the push still arrives. `Run all` → `All 2 scenarios passed`.
**Felt:** good, actually — the code was readable enough that I could fix it without the agent.
STRUGGLE: `edit` through the shell mangles multi-line text with quotes; my first attempt ate the `let toastTimer` line and left 3 type errors (draft 29). I had to put old/new text in files and use `$(cat …)`.

## Verdict
**Did I get what I wanted:** yes — mostly.
- Live, not polling: proven twice, once by the agent (0.15 s add, 0.12 s move across two frames) and once by me: one click in Window A and Window B moved the same card with no reload. In the code: `room.on('cards', …)`, publish in the actor after each write, and the only `setTimeout` in main.ts hides a toast ("it never fetches").
- "moved by": a line on each card from `moved_by`/`moved_at` stamped by the actor; shows `moved by admin 1:22:09 AM`. Never-moved cards show no line, no 1970 date.
- Race: one atomic `UPDATE … WHERE id=? AND version=?` plus `ctx.fail('conflict', …)`; the page catches it, re-lists and toasts `… already moved "title" — showing their change`. The agent ran two concurrent clicks with the same expectVersion and reported "the race worked exactly as designed" (the numbers it pasted were truncated in my chat, which is my one real gap).
- Typed: no `any`, `BoardEvent` is a discriminated union, `parseBoardEvent`/`parseBoardEnvelope` narrow `unknown` once; type check 0, scenarios green.
- Hardest moment: the agent's own isMe refactor silently broke the visitor name ("moved by someone") at the same time as the thread ran out of context, so the last 20 minutes were me, a History menu and `edit`.
- Would I come back: yes — the round's first half was the best I've had here (it tested with two frames and doubted its own fix). The end was rough.
**Three struggles that mattered most:**
1. The thread died mid-task (`a prompt is at most 262144 bytes`) with probes still in my file — no warning, no way to continue, so I had to finish it by hand.
2. Long lines in the chat are cut at "…", so the explanations I explicitly asked for ("which mechanism", "what happens when they race") were unreadable; I ended up reading the code instead.
3. `benchdrive edit` is fragile for multi-line edits: my first attempt swallowed the next line and produced 3 type errors; and every click on a file in the Code list needs the file list re-opened first, while `click actor.ts` without `--in code` silently hit an old chat message.
