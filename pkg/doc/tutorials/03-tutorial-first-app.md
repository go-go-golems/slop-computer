---
Title: "Tutorial: your first app, from an empty folder to a deployed page with a verb"
Slug: "tutorial-first-app"
Short: "Build and deploy a small RSVP app: a page with db and user, an actor action with requires, a db rule, a command-line verb, a store, a mount and a grant."
Topics:
- apps
- tutorial
- deployment
Commands:
- store
- push
- app
- grant
- mount
- "on"
- call
- dev
- ref
Flags:
- app
- type
- format
IsTopLevel: true
IsTemplate: false
ShowPerDefault: true
SectionType: Tutorial
---
This tutorial builds **RSVP**, an app where people say whether they are
coming to an event. It has every part a real app has: a page that reads
documents live and knows who is viewing, an actor action that writes on the
visitor's behalf and checks their level, a `db` rule that keeps pages from
writing directly, and a command-line verb. You deploy it to a server, open
it in a browser as a guest and as a member, and use it from the CLI.

Everything below was run against a local server
(`slop serve --local --llm fake`); the outputs are real, with timestamp
fields (`createdAt`, `changedAt`, …) left out and the port shown as the
default 18300. Your ids will differ. The finished app is four files, about
110 lines.

## What you need

You need the `slop` binary and a login **as a platform admin**: only admins
push app code. On your own machine, a local server gives you one:

```bash
slop serve --local --llm fake --data ./data --admin-email admin@example.com &
slop auth login --server http://slop.localhost:18300
```

`auth login` prints a device URL and a code. Open the URL in a browser, sign
in with the local form as `admin@example.com`, approve the code. Then check:

```bash
$ slop whoami -o json | jq -c '{role: .person.role, scopes}'
{"role":"admin","scopes":["read","write","admin"]}
$ slop server hosts
live:
    - apps.localhost:18300
main: slop.localhost:18300
sandbox: sbx.localhost:18300
static:
    - site.localhost:18300
```

The **live** host serves apps; you will mount RSVP there. (On another
server, use the hosts `slop server hosts` prints. `*.localhost` names resolve
to your machine in browsers and in curl.)

## Step 1: the manifest

Make a folder named after the app and write `app.json`. The folder name
matters: `slop push` uses it as the store id unless you pass `--store`.

```bash
mkdir -p rsvp/verbs && cd rsvp
```

`app.json`:

```json
{
  "title": "RSVP",
  "type": "rsvp",
  "page": "index.html",
  "actor": "actor.js",
  "capabilities": {
    "db":   { "rules": [{ "path": "rsvps", "read": "view", "write": "admin" }] },
    "user": { "scopes": ["profile"] }
  },
  "slop": { "verbs": { "alias": "rsvp", "include": ["verbs/*.js"] } }
}
```

What each line does:

- `type: "rsvp"` is the store type of events; a typed mount can serve every
  store of this type.
- `db` with one **rule**: anyone with `view` reads `rsvps/…`, but writing
  needs `admin`. Members hold only `interact`, so the page cannot write
  answers itself; it asks the actor, which writes as the store. This is how
  an app keeps people from forging each other's answers.
- `user` with the `profile` scope lets the page see the viewer's id and name.
- `slop.verbs` declares the command-line verbs in `verbs/*.js`, and the alias
  `rsvp` makes `slop rsvp <store> …` a shortcut for `slop on <store> …`.

Every field is described in `slop help app-manifest`.

## Step 2: the actor

`actor.js` runs on the server, one instance per store that runs the app, one
**turn** at a time. It defines two actions:

```js
// actor.js: one instance per store that runs this app; one turn at a time.
const db = use('db');

defineActor({
  actions: {
    // Called by the page (slop.actions.answer) and by: slop call <store> answer {json}
    answer: {
      requires: 'interact',               // signed-in members with a grant; not guests
      run(ctx, { coming, note }) {
        const v = ctx.visitor;
        if (typeof coming !== 'boolean') ctx.fail('invalid_argument', 'coming is true or false');
        db.doc('rsvps/' + v.id).set({
          name: v.name || 'someone',
          coming,
          note: String(note || '').slice(0, 200),
          at: ctx.now,
        });
        return { id: v.id, coming };
      },
    },
    // Read by the CLI verb; pages read rsvps/ directly through db.
    list: {
      requires: 'view',
      run(ctx) {
        return db.collection('rsvps').get().docs.map((d) => d.data());
      },
    },
  },
});
```

- `requires` is checked **before** `run`: a caller below that level gets
  `permission_denied: answer needs interact; you have view`. An action
  without `requires` needs `admin` (the server logs a warning for it).
- `ctx.visitor` is who called: `id`, `name`, `level`, `audience`, `guest`.
  An action runs as its caller, from a page or from the CLI.
- The document id is the visitor's id, so answering again replaces your
  answer instead of adding one.
- `ctx.fail(code, message)` ends the action with that error code; the page
  sees it as `err.code` and `err.message`.

The whole actor API is in `slop help actors`.

## Step 3: the page

`index.html` runs in the browser inside the live host's shell, on the
store's own sandbox origin. `window.claude.use(name)` gives it the
capabilities the manifest declares; `claude.use('slop')` (actor actions, the
visitor, sign-in) is always there.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RSVP</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; }
  button { font: inherit; padding: .3rem .8rem; margin-right: .5rem; }
  li { padding: .25rem 0; } .no { color: #888; text-decoration: line-through; }
</style>
</head>
<body>
<h1>Are you coming?</h1>
<p id="hello"></p>
<form id="f" hidden>
  <input name="note" placeholder="A note (optional)" maxlength="200">
  <button name="yes">Yes</button><button name="no">No</button>
</form>
<p id="msg" role="status"></p>
<ul id="list"></ul>
<script>
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const [db, user, slop] = await Promise.all(['db', 'user', 'slop'].map((n) => claude.use(n)));
  const me = await user.me();                          // {id, name, level, guest, …}
  const canAnswer = ['interact', 'admin', 'owner'].includes(me.level);
  $('hello').textContent = me.guest ? 'Sign in to answer.' : `Hello ${me.name}.`;
  $('f').hidden = !canAnswer;
  if (me.guest) { const b = document.createElement('button'); b.textContent = 'Sign in'; b.onclick = () => slop.signIn(); $('hello').append(' ', b); }

  // Everyone with view reads rsvps/ live; only the actor writes it (rule: write admin).
  db.collection('rsvps').orderBy('at').onSnapshot((snap) => {
    $('list').innerHTML = snap.docs.map((d) => d.data())
      .map((r) => `<li class="${r.coming ? '' : 'no'}">${esc(r.name)}${r.note ? ' — ' + esc(r.note) : ''}</li>`)
      .join('') || '<li>No answers yet.</li>';
  });

  $('f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await slop.actions.answer({ coming: e.submitter.name === 'yes', note: e.target.note.value });
      $('msg').textContent = 'Saved.';
    } catch (err) {
      $('msg').textContent = `${err.code || 'error'}: ${err.message}`;
    }
  };
})();
</script>
</body>
</html>
```

- The page checks the viewer's **level** before offering the form: a guest
  has an id but only `view`, and would be refused. It offers
  `slop.signIn()` instead.
- `onSnapshot` re-renders whenever anyone's answer changes, in every open
  tab, without polling.
- `slop.actions.answer(args)` calls the actor action of that name.

More on the runtime: `slop help page-runtime`, `slop help capability-db`,
`slop help capability-user`.

## Step 4: the command-line verb

`verbs/answers.js` runs **on your machine**, in the CLI, as you. It reaches
the store only through the actor:

```js
// The app's command-line verbs: slop on <store> answers ls (or slop rsvp <store> answers ls).
// They run on your machine, as you, and reach the store through its actor.
function ls(coming) {
  const s = require('slop').board();      // the store named on the command line
  const rows = s.call('list', {});        // the actor's list action (requires view)
  return rows
    .filter((r) => !coming || r.coming)
    .map((r) => ({ name: r.name, coming: r.coming, note: r.note }));
}
__verb__('ls', {
  parents: ['answers'],
  short: 'Who answered, and whether they are coming',
  fields: { coming: { type: 'bool', help: 'Only the people who are coming' } },
});
```

`parents: ['answers']` puts the verb at `answers ls`. Without `parents`, the
command path comes from the file's path: this file would give
`verbs answers ls`. Returning an array of objects gives rows the CLI prints
as a table (or `--format json`). Writing verbs in depth:
`slop help app-verbs`.

The folder is now complete:

```text
rsvp/actor.js
rsvp/app.json
rsvp/index.html
rsvp/verbs/answers.js
```

## Step 5: push the app

The app's code lives in a store of its own, here `rsvp`. Make it and push
the folder (run from the folder's parent):

```bash
$ cd ..
$ slop store new rsvp
id: rsvp
owner: usr_d9f77f667dc0772b2db2fee6
$ slop push rsvp -m "first version"
files: 4
"n": 1
removed: 0
rev: 2
```

`n: 1` is the snapshot: the tree frozen as version 1, with the ref `main`
pointing at it. Check that the manifest parsed:

```bash
$ slop app status rsvp
app: rsvp
broken: ""
manifest:
    actor: actor.js
    capabilities:
        - db
        - user
    live: true
    page: index.html
    slop:
        verbs:
            alias: rsvp
            include:
                - verbs/*.js
    title: RSVP
    type: rsvp
"n": 1
ref: main
store: rsvp
```

`broken: ""` means it is fine. A mistake in `app.json` or a crash while the
actor loads shows here, for example
`broken: 'app.json: capabilities: unknown capability "storage"'`. The push
itself succeeds either way, so always look.

## Step 6: a store that runs it, with grants and a mount

An event is a store that **runs** the app, with its own data. Make one, say
who may do what, and give it an address:

```bash
$ slop store new party --app rsvp --type rsvp
app: rsvp
id: party
owner: usr_d9f77f667dc0772b2db2fee6
type: rsvp
$ slop grant set party @guest view
level: view
store: party
subject: '@guest'
via: direct
$ slop grant set party @member interact
level: interact
store: party
subject: '@member'
via: direct
$ slop mount set apps.localhost:18300 /party party
mount:
    host: apps.localhost:18300
    path: /party
    store: party
url: http://apps.localhost:18300/party
$ slop app status party -o json | jq -c '{store, app, n, ref, broken}'
{"store":"party","app":"rsvp","n":1,"ref":"main","broken":""}
```

- `--type rsvp` is what `store new` would take from the manifest's `type`
  anyway; it is spelled out here so you see where the store type comes from.
- `@guest view`: anyone, signed in or not, can open the page and read the
  answers. Without it, `mount set` notes `guests cannot read party` and
  visitors must sign in.
- `@member interact`: everyone with an account may answer. `@member`
  includes subscribers and admins.
- `mount set <host> <path> <store>` takes all three as positional arguments.
  The store follows the app's `main` ref, so every later push to `main`
  reaches it on its next visit.

## Step 7: use it in a browser

Open `http://apps.localhost:18300/party`. As a guest you see the list and a
"Sign in" button, no form. Sign in (on a local server, any email works at
`http://apps.localhost:18300/_site/login?return=/party`; people who sign in
become members unless the server is configured with `signup: approval`).
As a member you see the form; answer "Yes" with a note.

Driven by Playwright (Chromium), the page reported:

```text
guest sees: {"hello":"Sign in to answer. Sign in","formHidden":true,"list":"No answers yet.","frame":"sda17397d2de455244a5a.sbx.localhost:18300"}
bob sees: {"hello":"Hello Bob.","formHidden":false}
after answering: {"msg":"Saved.","list":"Bob — bringing cake"}
```

The `frame` value shows that the page runs on the sandbox origin
`s<label>.sbx.localhost`, not on the live host: the live host serves the
shell, and the shell frames the page. Two more checks from the same page:

```text
// as a guest:  await slop.actions.answer({coming: true})
permission_denied: answer needs interact; you have view
// as Bob:      await db.doc('rsvps/forged').set({name: 'Mallory', coming: true})
invalid_argument: this viewer cannot write "rsvps/forged"
```

The first is the action's `requires`; the second is the `db` rule.

## Step 8: use it from the command line

The CLI finds an app's verbs through the store. Ask once for the list:

```bash
$ slop on party --help
rsvp's verbs on party

Usage:
  slop on party [command]

Available Commands:
  answers     All commands for answers
$ slop on party answers ls
+--------+------+---------------+
| coming | name | note          |
+--------+------+---------------+
| true   | Bob  | bringing cake |
+--------+------+---------------+
```

Actions can also be called directly with `slop call <store> <action> [json]`;
the action checks your level the same way:

```bash
$ slop call party answer '{"coming": false, "note": "out of town"}'
coming: false
id: usr_d9f77f667dc0772b2db2fee6
```

The app's alias `rsvp` works too (the CLI asks the server which app `party`
runs, the first time):

```bash
$ slop rsvp party answers ls
+--------+-------+---------------+
| coming | name  | note          |
+--------+-------+---------------+
| true   | Bob   | bringing cake |
| false  | Admin | out of town   |
+--------+-------+---------------+
$ slop rsvp party answers ls --coming --format json
[
{
  "coming": true,
  "name": "Bob",
  "note": "bringing cake"
}
]
```

App verbs take `--format` (table, json, jsonl, csv, tsv, yaml); `-o json` means the same.
The documents themselves are readable with the document verbs:

```bash
$ slop docs ls party rsvps -o json | jq -c '.[] | {path, body}'
{"path":"rsvps/usr_aa1baadf176e6931e9ed7185","body":{"at":1795564731947,"coming":true,"name":"Bob","note":"bringing cake"}}
{"path":"rsvps/usr_d9f77f667dc0772b2db2fee6","body":{"at":1795564732120,"coming":false,"name":"Admin","note":"out of town"}}
```

## Step 9: change it without touching the live event

`slop dev` pushes the folder to the app's `draft` ref and runs it in your
own **dev instance** (a store with its own, empty data), so `party` keeps
running `main` while you work. Change the heading in `rsvp/index.html` to
`Are you coming on Friday?`, then:

```bash
$ slop dev rsvp --once
made dev instance rsvp-dev-d9f77f (runs rsvp)
draft 2 · rsvp-dev-d9f77f on 2 · ok
dev instance rsvp-dev-d9f77f follows rsvp@draft; publish with: slop ref move rsvp main 2
$ slop ref ls rsvp
draft: 2
main: 1
```

Without `--once`, `slop dev` keeps watching the folder and pushes on every
save. To look at the dev instance in a browser, mount every store of the
type: `slop mount set apps.localhost:18300 /rsvp/:store --storeParam store
--type rsvp`, then open `/rsvp/rsvp-dev-d9f77f` signed in as yourself.

When it is right, publish: move `main` to the draft's snapshot. `party`
picks it up on its next visit.

```bash
$ slop ref move rsvp main 2
main: 1 → 2
from: 1
$ slop app status party -o json | jq -c '{n, ref, broken}'
{"n":2,"ref":"main","broken":""}
```

To roll back, move `main` back: `slop ref move rsvp main 1`.

## What you built

| Part | Where | Checked by |
| --- | --- | --- |
| Page | `index.html`, on the store's sandbox origin | the viewer's level, from `user.me()` |
| Actor action | `actor.js` `answer`, on the server | `requires: 'interact'` |
| Document rule | `app.json` `db.rules` | every page write to `rsvps/` |
| CLI verb | `verbs/answers.js`, on your machine | the `list` action's `requires: 'view'` |
| Access | `grant set party @guest view`, `@member interact` | `slop explain can party interact --subject <email>` |
| Address | `mount set apps.localhost:18300 /party party` | `slop mount ls` |

To deploy it again from scratch, or to another server, wrap steps 5 and 6
in a script; `slop help deploying-apps` has an idempotent one.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `permission_denied: only admins change app code` on push | You are not a platform admin | Log in as an admin (`slop whoami` shows `role`) |
| `slop push` says `files: 4` but the page does not change | The page is cached, or the store follows another ref | Reload; `slop app status party` shows `n` and `ref` |
| `app status` shows `broken: …` | A bad `app.json`, or `actor.js` threw while loading | Fix it and push; the store stays on its last good snapshot meanwhile |
| The page says "Sign in" after signing in | You signed in on another host | Sign in on the live host: `/_site/login?return=/party` |
| The form is missing for a signed-in person | Their level is `view` | `slop grant set party @member interact`; check with `slop explain can party interact --subject <email>` |
| `invalid_argument: … is plain content: mount it on a static host` | The app declares no capability and no actor, or never had a good manifest | Check `slop app status rsvp` |
| `slop on party answers ls` prints the usage of `slop on party` (exit status 0) instead of rows | No verb at that path: without `parents` it sits at `verbs answers ls` | Add `parents: ['answers']`; `slop on party --help` lists the real paths |
| `unknown command "rsvp" for "slop"` | No store after the alias, or `party` runs another app | `slop rsvp party …`; `slop on party …` |
| `error: unknown shorthand flag: 'o' in -o` | App verbs use `--format` | `--format json` |
| `conflict: store rsvp exists` | You ran `store new` twice | Harmless; skip it, or use the script in `deploying-apps` |

## See Also

- `slop help building-apps` — the kinds of app and how to choose
- `slop help app-manifest` — every field of `app.json`
- `slop help deploying-apps` — refs, drafts, mounts, grants, policy, scripts
- `slop help actors` — the actor API
- `slop help app-verbs` — writing command-line verbs
- `slop help using-app-verbs` — how the CLI finds and runs them
- `slop help page-runtime` — `window.claude` in the page
