---
Title: "The slop capability: the actor, bound stores and the visitor from a page"
Slug: "capability-slop"
Short: "slop's own page API: call(action, args) on the store's actor, read stores bound by alias, list stores of a type, visitor(), signIn(); what a page may and may not do, and its errors."
Topics:
- apps
- pages
- capabilities
- actors
Commands:
- call
- bind
- confirm
- explain
Flags:
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
`slop` is slop's own namespace for pages, next to the claude.ai contract's
capabilities. Through it a page calls actions of its store's **actor**
(the server side of the app, `actor.js`), reads other stores the owner bound
to this one, lists the stores of a type the visitor can open, and learns who
the visitor is. Every app view has it, declared or not.

The actor is how a page does anything the db rules cannot express: check
before writing, change several documents in one atomic commit, call a model
with the store's budget, or reach other stores. This page covers the API
with its return shapes, the confirmation flow, the limits of what a page
can do, and the errors.

## Getting it

```js
const slop = await claude.use("slop");   // always an object on an app view
```

Nothing has to be declared. The manifest may carry a `slop` entry:

```json
{ "capabilities": { "slop": { "permissions": ["versions:read"] } } }
```

`permissions` must name known management permissions (`artifacts:read`,
`versions:read`, `versions:push`, `routes:read`, `routes:write`,
`threads:read`, `threads:write`, `events:read`); an unknown one fails the
push (`capabilities.slop: unknown permission "x"`). In this version the list
is checked but **grants nothing**: leave it out.

## API

| Member | Resolves to |
| --- | --- |
| `call(action, args?)` | the action's return value |
| `actions.<name>(args?)` | the same as `call("<name>", args)` |
| `stores.open(alias)` | (synchronous) a reader `{doc, query, file, files}` for the store bound to `alias` |
| `stores.list({type, title?})` | `[{id, app, level, mine, createdAt, title?}]` |
| `visitor()` | `{id, name, audience, level, guest, subscribed, llm}` |
| `signIn()` | nothing; the shell goes to the sign-in page |
| `subscribeUrl()` | (synchronous) a string; `""` in this version |

### call(action, args)

```js
const r = await slop.call("bump", { by: 1 });   // {total: 3}
const r2 = await slop.actions.bump({ by: 1 });  // the same
```

- Runs the action `action` of **this store's** actor as one turn, as the
  viewer: the actor sees them as `ctx.visitor` (id, audience, level). The
  documents it writes commit atomically when the turn ends.
- `args` is any JSON value (default `{}`); the action receives it as its
  second argument. The result is whatever the action returns, as JSON.
- The action's `requires` level is checked first: below it, the call
  rejects `permission_denied` (`bump needs interact; you have view`). An
  action that declares no `requires` needs `admin`.
- `ctx.fail(code, message)` in the action rejects the call with that code
  and message; any other exception rejects `actor_error`.
- A resend after a dropped connection gets the first result; the action
  does not run twice.
- The same action is `slop call <store> <action> '<json>'` on the command
  line, and the app's verbs (`slop on <store> …`) reach it too.

**Confirmations.** When an action asks the platform to change something
for the person (a grant, a mount, a new store, through a module an admin
trusted the app with), the server answers `confirmation_required`. The
runtime then asks the shell, which shows "Allow <app> to do this?" outside
the app's frame. If the person allows it, the runtime retries the call (up
to four times); the approval holds for two minutes for the same call. If
they decline, the call rejects `confirmation_declined`. From the CLI the
same confirmation is `slop confirm approve <id>`.

### stores.open(alias)

A **read alias** names another store for this one:
`slop bind set <store> <alias> <target>` (run by an admin of the store).
Then:

```js
const crm = slop.stores.open("crm");
await crm.doc("contacts/c1");
// {path: "contacts/c1", exists: true, version: 1, body: {name: "Ada"}}   or {path, exists: false}
await crm.query("contacts", { filters: [{ field: "name", op: "==", value: "Ada" }], order: "name", desc: false, limit: 50 });
// {docs: [{path, exists: true, version, body}, …]}
await crm.files();                // the target's main snapshot: [{zone, path, sha256, size, type}, …]
await crm.file("app.json");       // {path, type, text}
```

- Reads run **as the viewer, at the viewer's own level on the target**,
  under the target's rules. A viewer who cannot open the target gets
  `not_found` (`nothing to read at "crm"`); a document they may not read is
  `exists: false`.
- They are one-off reads, not subscriptions, and they cannot write. To show
  another store live, or to write to it, bind it with `--prefix` and use
  `db` (`slop help capability-db`, "Other stores"), or do it in the actor.
- `query` takes the same filters and bounds as db queries
  (`op` is one of `==` `!=` `<` `<=` `>` `>=` `in` `not-in` `array-contains`).
- `files()` and `file()` read the target's `main` snapshot; a store with
  no snapshot rejects `not_found` (`crm has no snapshot`).

### stores.list({type, title?})

```js
await slop.stores.list({ type: "tally", title: "board/meta" });
// [{id: "kitchen", app: "tally", level: "owner", mine: true, createdAt: 1795564371211, title: "Kitchen board"}]
```

Lists the stores of one **store type** that the visitor holds a level on
(owned, granted, or open to their audience), newest first, at most 200.
`type` is required (`list needs a store type`). With `title` (a document
path), each row also gets that document's `title` field, read as the
visitor under the store's rules. A store's type is set when it is made
(`slop store new kitchen --app tally --type tally`) or later with
`slop store type`.

### visitor()

```js
await slop.visitor();
// {id: "usr_…", name: "Ada", audience: "member", level: "interact", guest: false,
//  subscribed: false, llm: {allowed: true, used: 0, remaining: null, source: "@member"}}
```

- `id` is `""` unless the app declares `user`; `name` is `""` unless it
  declares `user` with `scopes: ["profile"]`. A guest has a `vis_…` id and
  `guest: true`.
- `audience` is `guest`, `member`, `subscriber` or `admin`; `level` is the
  visitor's level on this store.
- `llm` is the person's own LLM access (the `llm` table), whatever this
  app's policy says. Whether this page may call a model is
  `user.me().llm.allowed`, which is also false when the app's `sample`
  policy cell is off. See `slop help llm-access`.
- It is the same visitor an action sees as `ctx.visitor`.

## What a page can and cannot do through slop

A page can:

- call any action of its own store's actor, at the viewer's level;
- read stores its store is bound to, as the viewer;
- list stores of a type the viewer can open, and name them;
- send the viewer to sign in.

A page cannot:

- call server verbs (`store.new`, `grant.set`, `mount.set`, …) itself.
  An actor does that through a module an admin trusted the app with
  (`slop app trust`), and the person confirms;
- call another store's actor directly (the actor does, with
  `use('stores')`);
- write through `stores.open` readers;
- act as anyone but the viewer.

## Example: a tally with one action

`app.json`:

```json
{
  "title": "Tally",
  "type": "tally",
  "page": "index.html",
  "actor": "actor.js",
  "capabilities": {
    "db": { "rules": [{ "path": "tally", "read": "view", "write": "self" }] },
    "user": {}
  }
}
```

The rule `write: "self"` means no page and no CLI user writes `tally/…`;
only the actor does.

`actor.js`:

```js
const db = use('db');
defineActor({
  actions: {
    bump: {
      requires: 'interact',
      run(ctx, { by }) {
        const n = Number(by ?? 1);
        if (!Number.isInteger(n) || n < 1 || n > 10) ctx.fail('invalid_argument', 'by is 1 to 10');
        const cur = db.doc('tally/main').get().data() || { total: 0 };
        db.doc('tally/main').set({ total: cur.total + n, last: ctx.visitor.id, at: ctx.now });
        return { total: cur.total + n };
      },
    },
  },
});
```

`index.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Tally</title></head>
<body>
<p>Total: <b id="total">0</b> <button id="bump" hidden>+1</button></p>
<p id="who"></p><ul id="mine"></ul><p id="msg"></p>
<script>
const $ = (id) => document.getElementById(id);
(async () => {
  const slop = await claude.use("slop");   // every app view has it; no declaration needed
  const db = await claude.use("db");
  if (!slop || !db) { $("msg").textContent = "Open this page through its mount."; return; }

  const me = await slop.visitor();          // {id, name, audience, level, guest, subscribed, llm}
  $("who").textContent = me.guest ? "Guest" : me.audience + ", " + me.level;
  if (me.guest) { $("msg").append(Object.assign(document.createElement("button"), { textContent: "Sign in", onclick: () => slop.signIn() })); }

  // Reads come straight from db; the one write goes through the actor.
  db.doc("tally/main").onSnapshot((s) => { $("total").textContent = s.exists ? s.data().total : 0; }, (e) => { $("msg").textContent = e.code; });
  $("bump").hidden = !["interact", "admin", "owner"].includes(me.level);
  $("bump").onclick = async () => {
    try { await slop.call("bump", { by: 1 }); }            // or slop.actions.bump({by: 1})
    catch (e) { $("msg").textContent = e.code + ": " + e.message; }
  };

  // Every tally store this visitor can open, newest first.
  const stores = await slop.stores.list({ type: "tally" });
  $("mine").replaceChildren(...stores.map((s) => Object.assign(document.createElement("li"), { textContent: s.id + " (" + s.level + ")" })));
})();
</script>
</body></html>
```

```bash
slop store new tally --type tally
slop push ./tally --store tally -m "first"
slop mount set apps.example /tally tally
slop grant set tally @member interact
slop call tally bump '{"by":2}'        # the same action from the CLI
# total: 4
```

## Errors

| Code | Meaning | Page should |
| --- | --- | --- |
| `permission_denied` | The viewer's level is below the action's `requires` | Hide the control for this level |
| `not_found` | No such action (`tally has no action "nope"`), the store has no actor, no store is bound to the alias, the viewer cannot open the target, no snapshot or file | Fix the name or the binding |
| `invalid_argument` | Bad arguments (`list needs a store type`, `title is a document path such as board/meta`), or the action's own `ctx.fail('invalid_argument', …)` | Fix the call; show the message |
| any code from `ctx.fail` | The action refused, with its own code | Handle the codes your actor uses |
| `actor_error` | The action threw without a code, or the actor failed to start | Read `slop app logs <store>` and `slop app status <store>` |
| `confirmation_declined` | The person said no to a confirmation | Leave things as they are |
| `unavailable` | Transient | Retry once |

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `not_found: <store> has no actor` | `app.json` has no `actor`, or the store runs a snapshot without one | Add `"actor": "actor.js"`; `slop app status <store>` |
| `permission_denied: x needs interact; you have view` | The viewer holds `view` | Grant `interact` (`slop grant set <store> @member interact`), or lower `requires` |
| An action without `requires` refuses everyone but admins | Undeclared `requires` means `admin` | Set `requires: 'view'` or `'interact'` |
| `stores.list` returns `[]` | Stores have no type, a different type, or the visitor holds no level on them | `slop store meta <id>` shows the type; set it with `slop store type` |
| `stores.open(a).doc(p)` rejects `not_found: no store is bound to "a"` | No read alias of that name on this store | `slop bind set <store> a <target>`; `slop bind ls <store>` |
| `visitor().id` is `""` | The app does not declare `user` | Add `"user": {}` |
| `visitor().llm.allowed` is true but `sample` is `null` | `visitor()` shows the person's LLM access; the app's `sample` policy cell is off | `slop policy set <app> sample @member on` |
| `actor_error` with a JavaScript message | The action threw | `slop app logs <store>` |

## See Also

- `slop help actors` — writing `actor.js`: `defineActor`, `requires`, `ctx`, `use()`
- `slop help capability-db` — direct reads and writes, aliases with `--prefix`
- `slop help page-runtime` — `claude.use`, common errors
- `slop help app-verbs` and `slop help using-app-verbs` — the same actions from the CLI
- `slop help access-control` — levels and grants
- `slop help llm-access` — what `llm` in `visitor()` means
