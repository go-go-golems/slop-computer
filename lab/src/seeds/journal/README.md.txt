# journal

An app is a store whose tree has `app.json`. This one has four parts:

- `app.json`: capabilities and rules. Pages may read the views listed under `slop.sql.expose`, nothing else in SQL.
- `sql/001_posts.sql`: the migration. It runs at activation as caller kind `migration`, the only kind allowed DDL.
- `actor.js`: actions, an http route, a reactor and an alarm. Each event is one turn: one SQLite transaction.
- `index.html`, `app.js`, `style.css`: the page. It runs in a sandboxed frame, as whoever is viewing.

Edit any file, then `publish journal` to snapshot the tree and move `main`. Every store running journal activates
the new version: migrations, `setup` and `smoke` in one transaction. If any of them throws, the store keeps the last
good version.
