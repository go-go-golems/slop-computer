# Working on slop v3 apps

You build and change apps on a local slop v3 server with the `slop` CLI
(on PATH, already logged in with a token that has the read and write
scopes).

Rules:
- Work only in this folder, and change the server only through `slop`.
  Do not read files outside this folder (server configuration, other
  credentials, ~/.pi, ~/.config).
- Act only as the token you were given. Never sign in through the
  browser, never create or approve tokens, never act as another person.
- If the server refuses an operation (permission_denied and the like),
  do not work around it: stop and report the refusal and what you would
  need.

## What an app is

A store is a versioned tree of files plus documents and SQL tables. A
store is an app when its tree holds `app.json`:

    app.json        {"title", "type", "actor"?, "capabilities": {...}}
    index.html      the page (any other files beside it: css, js, images)
    actor.js        optional server code: defineActor({setup, actions, http, on})
    sql/001_x.sql   optional migrations for the actor's tables (run in order, once)

`capabilities` uses the claude.ai artifact contract: the page calls
`await claude.use("db" | "user" | "room" | "sample" | ...)` and gets a
namespace or null. `db` is shared documents (`db.doc("a/b").set/get/
onSnapshot`, `db.collection("a")`), with optional rules, e.g.
`{"db": {"rules": [{"path": "votes", "read": "view", "write": "admin"}]}}`.
`user` gives `user.me()` -> {id, name, level}. `room` is presence and
events for whoever has the page open. With an actor, the page calls its
actions: `const slop = await claude.use("slop"); await slop.actions.posts()`.
Levels are view < interact < admin < owner; guests get at most interact.

Read `reference/guestbook` (small, actor + db) and `reference/journal`
(actor, SQL migrations, reactors) before writing code; they are working
apps. `reference/slop-v3-guide.md` is the full design: §3.4 walks through
the guestbook, §5 is apps and app.json, §6 is actors (§6.1 actor.js,
§6.7 what actors can use()).

## Commands

    slop store new <id>                       make a store (you own it)
    slop push <dir> --store <id> -m "msg"     replace its tree with the folder, snapshot it
    slop pull <id> <dir>                      write a store's tree into a folder
    slop grant set <id> @guest interact       let guests use it (view to only look)
    slop app status <id>                      is the app running? manifest errors show here
    slop app logs <id>                        the actor's console.log and failures
    slop call <id> <action> '<json args>'     call an actor action as yourself
    slop docs ls <id> <collection>            the store's documents
    slop sql schema <id>                      the actor's tables

A store you can use is served at http://apps.localhost:18300/x/<id>/
(check it with curl; the page itself runs in a sandboxed iframe there).
After a push, `slop app status <id>` must show the new snapshot with no
error. Report what you built, the store id, and how you checked it.
