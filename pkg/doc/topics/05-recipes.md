---
Title: "Recipes: which page answers which task"
Slug: "recipes"
Short: "Common requests (a photo wall, a public dashboard, a CSV export, a job at 7 every morning, an inherited app) and the help page, commands and pattern for each; how Firebase, Express and node-cron map onto slop."
Topics:
- recipes
- apps
- patterns
Commands:
- store
- grant
- mount
- push
- alarm
IsTopLevel: true
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
Each recipe names what people usually ask for, the shape of the answer in
slop, and the page with the complete example. They are short on purpose:
read the page before you build.

## Who may do what

Almost every request has an access part. Say it with grants on the store
that holds the data (`slop help access-control`):

| They ask | Grants | Check with |
| --- | --- | --- |
| "Anyone can read it, only our team can add" | `@guest view`, `@member interact` | `slop explain can <store> interact --subject @guest` (false) |
| "Only signed-in people can see it" | `@member view` (or `interact`), no `@guest` grant | `slop explain can <store> view --subject @guest` (false) |
| "Just make everyone admin" | Usually `@member interact`: admin also lets them change grants, mounts, code and data | `slop explain can <store> admin --subject @member` |
| "Make the records readable to everyone so the dashboard works" | Usually no grant on the records: compute the numbers in the actor (below) | `slop explain can <records> view --subject @guest` (false) |

When you give less than was asked, say in a sentence what the wider grant
would have allowed.

## Recipes

| Task | Pattern | Page |
| --- | --- | --- |
| A photo wall: guests look, members add | `assets` to upload, an actor action to write the row (`write: "self"` rule), `@guest view` + `@member interact` | `capability-assets`, "Example: a photo wall" |
| A guestbook or comments: anyone reads, signed-in people post | `db` with a rule, `@guest view` + `@member interact`; or the `comments` capability | `capability-db`, `capability-comments` |
| A dashboard of totals for an office screen, without opening the records | An actor reads the other stores (`slop bind set` without `--prefix`, `grant set <records> store:<dash> view`) and returns or stores the totals; the page shows them; `@guest view` on the dashboard only | `capability-db`, "Other stores", `actors` ("Calls between stores") |
| "Download this month as a spreadsheet" | The `downloads` capability: the page builds the CSV and offers it | `capability-downloads` |
| Something every morning at 7 (a digest, a cleanup) | An alarm in `actor.js` (`every: '0 7 * * *'`), `CRON_TZ=` for a zone; try it with `slop alarm fire --at 07:00` | `alarms` |
| Who is here right now, live cursors, "ready" buttons | The `room` capability (presence); `db` for what must outlast the room | `capability-room` |
| An assistant on a page that can change the app's data | The `agent` capability with page tools; `--llm fake` tests tools, not language | `capability-agent` |
| Add a column or a table to an app with data | A new `sql/NNN_….sql` migration, pushed; rows stay | `store-data`, "Changing tables: migrations" |
| A command people run from the terminal | App verbs (`verbs/*.js`, an alias) | `app-verbs`, `using-app-verbs` |
| Show a time the server decides (when something was saved) | Store `ctx.now` (actor) or read a document's `at`; pages run in the viewer's clock and zone | `actors` ("ctx"), `capability-db` |

## You inherited an app

Someone built it and left; you know roughly where it is (`/tasks`).

```bash
slop mount ls -o table                 # which store is behind /tasks (STORE column; admins, others: slop store ls)
slop store show tasks                  # its app and code, mounts, data, grants, actions, alarms, next steps
slop app status tasks                  # is it broken? a failed update keeps the old version serving
slop pull tasks ./tasks                # its code (store show names the app store if it is another one)
```

- Data are either documents (`slop docs ls tasks <collection>`) or SQL
  tables (`slop sql query tasks 'SELECT * FROM items'`); `store show` lists
  both. `docs: 0` does not mean empty.
- An update that "never showed up" is usually a version that failed to
  activate: `app status` shows `broken: snapshot N: …` while the previous
  snapshot keeps serving. Fix the cause and push again.
- To change the page: pull, edit, `slop push ./tasks --store tasks`, then
  `slop app status tasks`. Tell the next person the same four commands.

## Coming from Firebase, Express or node-cron

slop has no server process for you to run and nothing to `npm install` on
the server. What you would build with those tools maps like this:

| You know | In slop | Page |
| --- | --- | --- |
| Firebase Hosting, a static host | A store holding the page, mounted at a path: `slop push`, `slop mount set` | `deploying-apps` |
| A Firestore collection | A `db` collection in the store (`claude.use('db')` in the page) | `capability-db` |
| Firestore security rules | Grants on the store (who has which level) plus `db` rules in `app.json` (which level a path needs) | `access-control`, `capability-db` |
| Firebase Auth | The platform's sign-in; the page asks `claude.use('user')` who is there | `capability-user` |
| An Express route, a Cloud Function | An actor action (`slop call`, `slop.call` from the page) or an HTTP route in `actor.js` | `actors` |
| A Postgres table | An SQL table from a migration, used by the actor | `store-data`, `actors` |
| node-cron, a scheduled function | An alarm in `actor.js` | `alarms` |
| Environment variables, API keys | `slop secret set <app> NAME value`, read by the actor | `app-manifest`, `store-data` |
| npm packages | `slop vendor add` copies pinned packages into the app's tree | `deploying-apps` |

Explain the mapping to the person in a sentence or two; then build it the
slop way.

## See Also

- `slop help agent-quickstart` — the CLI, logins, reading errors
- `slop help building-apps` — what an app is, the capabilities, patterns
- `slop help tutorial-first-app` — a complete app, step by step
- `slop help troubleshooting` — errors and what to do
