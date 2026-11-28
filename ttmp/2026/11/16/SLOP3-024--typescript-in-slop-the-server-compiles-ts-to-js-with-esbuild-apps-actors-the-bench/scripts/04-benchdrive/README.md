# benchdrive

A command-line driver for the slop bench's web page, for model-played personas
that only have a shell. One daemon holds a headless Chromium; each persona name
gets its own browser context (its own tab and cookies), signed in as the local
admin and opened at the bench. Every command prints what the screen shows, as
compact text. It reads only what the page renders: it does not read the app's
files or call the server for the persona.

## Start and stop

```sh
cd benchdrive && npm install            # playwright 1.66.0-alpha-2026-11-09 = cached chromium-1254
./benchdrive serve [--port 18499] &     # daemon; logs one line per command
./benchdrive status                     # pid, port, personas
./benchdrive stop
```

Environment (daemon and client): `BENCHDRIVE_PORT` (default 18499),
`BENCHDRIVE_URL` (default `http://apps.localhost:18492/bench`),
`BENCHDRIVE_EMAIL` (default `admin@example.com`; the server must run with
`--local`). The daemon writes `benchdrive.pid` next to the script.

## Commands

```
benchdrive <you> look                      the screen: header, layout, dialog/menu, every visible view, app frames
benchdrive <you> shot <file.png>           screenshot of the whole bench
benchdrive <you> click <text|selector> [--in <where>]
                                           a button, tab, menu item or eval step by its label; --in header|menu|
                                           dialog|tab|agent|canvas|code|review|... when a label is on screen twice
benchdrive <you> type <field> <text>       replace a field's text: chat, code, id, title, filter, eval,
                                           a placeholder word, or a CSS selector
benchdrive <you> key <key>                 Enter, Escape, Tab, Control+s, ...
benchdrive <you> new-app <id> <template>   project menu → New app… → template → id → Create
benchdrive <you> open-app <id>             project menu → the app
benchdrive <you> ask <message>             Agent chat: type, Enter, wait for the turn to end, print the reply
benchdrive <you> frame-text [n]            the app's own page(s) on the canvas, fields and buttons in [brackets]
benchdrive <you> frame-shot <file.png> [n] screenshot of an app frame (at the canvas's zoom)
benchdrive <you> frame-click <text|sel> [n]  click inside the app (switch the bench to Play first)
benchdrive <you> frame-type <sel|placeholder> <text> [n]
benchdrive <you> view <name>               Agent, Eval, Canvas, Timeline, Console, Data, Scenarios, Code,
                                           Review, Docs, Inspector, Layers, Panels
benchdrive <you> wait [seconds]            wait, then what changed
benchdrive <you> close                     drop this persona's tab (the next command opens a fresh one)
```

Action commands print what they did, any notice (toast) that flashed, and a
line diff of the screen summary (`+` new, `-` gone, `[section]` markers). When
the open app changes, or most of the screen does, they print the whole screen
instead. Errors exit 1 and say what is on screen instead (an unknown label
lists the closest clickable labels, with where they are).

`ask` waits for the bench's own signals that a turn ended: the header's
"Claude" pill leaves "Working" and the composer's Stop button goes back to
Send. It returns early when Claude waits for the person (an eval to Run/Skip in
Ask mode, an approval card). It prints the reply's eval steps (`✓ eval 2 ·
files.read · 6 ms · effects`), the reply text, toasts, and what changed on the
canvas and header. Default timeout 15 minutes.

## Limits

- All personas sign in as the same local admin. The bench keeps the "Recent"
  app list, layout and each app's threads per person, so personas share them:
  a fresh persona opens whichever app another persona used last, and two
  personas on the same app write into the same thread. Give each persona its
  own app id.
- A page reload (a new persona, `close`, a daemon restart) puts the bench back
  on `draft`: an agent's open proposal is still there (Review tab, workspace
  menu) but the canvas shows draft.
- `frame-shot` shoots the frame as the canvas shows it (zoomed, clipped by the
  canvas). `look` shows the first 6 lines of each frame; `frame-text` shows 80.
- Model `<select>`s and native dropdowns are not drivable by `click`.
