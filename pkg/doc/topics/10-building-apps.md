---
Title: "Building apps on slop: the map"
Slug: "building-apps"
Short: "The kinds of app, the files of an app, what runs where, which capabilities to use, patterns that held, caching, testing and a production checklist."
Topics:
- apps
- concepts
- capabilities
Commands:
- push
- dev
- store
- mount
- app
- call
- "on"
- explain
Flags:
- llm
IsTopLevel: true
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
An app on slop is a folder of files pushed to a store: HTML and JavaScript
for the browser, optionally an `actor.js` for the server, optionally
command-line verbs, and an `app.json` that says what the code needs. This
page is the map: it helps you pick the kind of app, tells you which file
runs where and with what authority, points at the page for each capability,
and collects what worked (and what did not) while building the apps that
ship with slop. Each section links to the page with the details.

New to slop? Read `slop help slop-overview` for the words (store, snapshot,
mount, level, grant, policy), then build one app end to end with
`slop help tutorial-first-app`.

## Four kinds of app

Pick the kind first: it decides the host, the files and who can see it.

| Kind | Host | The store holds | Who can see it |
| --- | --- | --- | --- |
| **Static site** | static (`site.…`) | HTML, CSS, JS, data; no `app.json`, or one with only `title`, `page`, `notFound` | guests only, so the store needs `@guest view` |
| **Page-only app** | live (`apps.…`) | `app.json` with `capabilities`, a page | by grant level; the page gets `window.claude` (`db`, `user`, `room`, `sample`, …) |
| **Page + actor** | live | `app.json` with `capabilities` and `actor`, a page, `actor.js` | as above; the actor runs on the server, one turn at a time |
| **Actor only (API)** | live | `app.json` with `actor`, `actor.js` with HTTP routes | each route's level; public routes for anyone |

The rules behind the table:

- **The static host serves files, nothing else.** No sign-in, no sessions,
  no `window.claude`: every visitor is an anonymous guest and the HTML goes
  out byte for byte. It refuses to mount a store that runs a live app
  (`… runs a live app (capabilities or an actor): mount it on a live host`).
- **The live host wraps the page in a shell.** The shell holds the session
  (sign-in, guest id, share link) and frames the app's page on a sandbox
  origin. A store is live as soon as its app declares one capability or has
  an actor.
- **Use an actor for what the server must decide:** shared state that
  visitors must not write directly (a vote, a pick everyone sees), work on a
  visitor's behalf with a level check (`requires: 'interact'`), HTTP
  endpoints, alarms, reactions to commits, model calls paid by the store.
  Keep per-person work in the page: it is simpler and the visitor's own
  limits apply.
- **Use an actor-only app for an API**: routes built with
  `require('express')`, mounted with an API policy that lists them. The mount
  root without a page answers 404.

## The files of an app

An app's code is its store's **tree** at a snapshot. These paths mean
something; everything else is served as a file.

| Path | What it is | Runs where | Page |
| --- | --- | --- | --- |
| `app.json` | The manifest: entry page, actor, capabilities, verbs, modules | read by the server | `slop help app-manifest` |
| `index.html` (or `page`) and its CSS/JS | The page | the visitor's browser, on the sandbox origin | `slop help page-runtime` |
| other `*.html` | More pages of the app; each gets the runtime too | the browser | |
| `actor.js` (or `actor`) | The actor: actions, routes, alarms, reactors | the server, one instance per store | `slop help actors` |
| `sql/*.sql` | Migrations for the store's tables, applied in name order on activation; add only | the server | `slop help actors` |
| `verbs/*.js` (per `slop.verbs.include`) | Command-line verbs | the CLI user's machine, as them | `slop help app-verbs` |
| `vendor/` | npm packages bundled by `slop vendor` | browser or actor | `slop help deploying-apps` |

A small app is four files:

```text
rsvp/app.json
rsvp/index.html
rsvp/actor.js
rsvp/verbs/answers.js
```

## What runs where, and as whom

Three places run app code, with different authority. Knowing which one
you are in explains most errors.

**The page** runs in the browser, in an iframe on the store's own sandbox
origin, `s<label>.<sandbox host>/v/<snapshot>/`. The label is fixed per
store and app, so `localStorage` survives new versions but is never shared
between stores. The shell on the live host frames it and itself refuses to
be framed (`frame-ancestors 'none'`). The page reaches slop only through
`window.claude.use(name)`; every call is checked against the **viewer's**
level and the app's declarations. `claude.use('slop')` is always there: it
calls actor actions (`slop.actions.<name>(args)`), tells who is visiting
(`slop.visitor()`), and offers sign-in (`slop.signIn()`).

**The actor** runs on the server, one instance per store that runs the app,
handling one **turn** (an action, a route, an alarm, a commit reaction) at
a time; each turn commits atomically. An action runs **as its caller**:
`ctx.visitor` is the person (or guest) who called it from a page or from
the CLI, and `requires` checks their level before `run`. The actor writes
documents as the store, so `db` rules do not limit it: that is how a page
gets a write it may not make directly. An `await` on real I/O ends the turn;
code after it runs in a new turn and must re-read what others may have
written meanwhile.

**Command-line verbs** run in the `slop` CLI on the user's machine, as that
user, with their token. They reach the store only through `require('slop')`
(actor actions, documents), so they can do exactly what the person could do
from the page.

## Choosing capabilities

Declare in `app.json` only what the code uses; anything else is `null`.
Capabilities marked **policy** also need a policy cell turned on for the
visitor's audience (`slop policy set <app> <cap> @member on`).

| Capability | Use it for | Page |
| --- | --- | --- |
| `db` | Shared JSON documents with live listeners and per-path rules | `slop help capability-db` |
| `user` | Who is viewing: id, name (`profile`), email (`email`, **policy** `user.email`) | `slop help capability-user` |
| `room` | Presence (who is here) and broadcast events between open pages | `slop help capability-room` |
| `assets` | Uploading images and files (**policy**, on for members by default) | `slop help capability-assets` |
| `downloads` | Handing the viewer a file to save, through a confirmation | `slop help capability-downloads` |
| `files` | Reading another store's tree as a project | `slop help capability-files` |
| `sample` | One model call per request (**policy** `sample`, plus LLM access) | `slop help capability-sample` |
| `agent` | A server-held conversation with tools the page runs (**policy** `sample`) | `slop help capability-agent` |
| `artifact` | Replacing the app's own page (`publish(html)`); admins, in the app store only | `slop help capability-artifact` |
| `comments` | Accepted for claude.ai pages; never granted on slop | `slop help capability-comments` |
| `slop` | Always present: actor actions, the visitor, sign-in, other stores | `slop help capability-slop` |

The actor has its own set through `use(name)`: `db`, `sql`, `files`,
`alarm`, `storage`, `room`, `sample`, `time`, `log`, `stores`, plus `fetch`, `secrets` and `platform`
when declared under `slop` and allowed by policy, and the Go modules
(`database`, `express`, `fs`, …; `system` and `workshop` after
`slop app trust`). See `slop help actors`.

Model calls need three things, from three people: the app declares `sample`
(or `agent`), an admin turns on the `sample` policy cell for the visitor's
audience, and the payer has LLM access and budget (`slop llm set`). The payer
is the visitor, also inside an actor action; for alarms and reactors it is
the store. See `slop help llm-access`.

## Patterns that held

These come from the apps that ship with slop (Pinboard, the catalog, the
examples) and were each learned the hard way.

- **Check the visitor before offering writes.** A guest has an id but only
  `view`. Read `await (await claude.use('user')).me()` (or
  `slop.visitor()`, which gives `{id, name, audience, level, guest,
  subscribed, llm}`) and offer `slop.signIn()` instead of a form the store
  will refuse.
- **Let the actor write what others must not forge.** Give the collection a
  rule with `write: 'admin'` and write it from an action with
  `requires: 'interact'`, keyed by `ctx.visitor.id`. The page cannot write
  it (`this viewer cannot write "rsvps/forged"`), and every write is the
  caller's own.
- **For per-person state, use `{self}` rules** (`notes/{self}`): each person
  writes their own document from the page, no actor needed.
- **Own your own document.** For a document only this person writes, read
  it once with `get()` and write in order (`saving = saving.then(…)`).
  Applying `onSnapshot` of your own document rolled pages back when a late
  snapshot arrived after a quick run of edits. Use `onSnapshot` for what
  others write.
- **Re-render on presence only when it matters.** `onPeers` fires on every
  presence change; rebuilding a list between a mousedown and its mouseup
  loses the click. Compare a signature of the fields you show.
- **Resolve names in the render path** with `user.profiles(ids)`; it caches.
  On slop `avatarUrl` is `""`: draw initials on the profile's `color`.
- **Read model answers leniently.** Find the JSON object in the text,
  validate ids against your data, and show the raw text when it does not
  parse. The local `--llm fake` backend answers "slop is connected.", which
  exercises exactly that path.
- **Treat `null` from `claude.use()` as "feature off"**, not as an error:
  the policy may be off for this viewer's audience while on for others.

## Caching

What the hosts send decides how fast a change reaches visitors:

| Served | Cache-Control |
| --- | --- |
| Static host files at a mount (moving: they follow the store's `main`) | `public, max-age=60, stale-while-revalidate=600`, strong ETag, `If-None-Match` → 304 |
| Static host, by snapshot: `/_s/<store>/<n>/<path>` | `public, max-age=31536000, immutable` |
| Static host, by ref: `/_s/<store>/main/<path>` | `public, max-age=60, stale-while-revalidate=600` |
| Live host shell pages and actor routes | `no-store` (routes may set their own) |
| Sandbox: the app's HTML pages (with the runtime injected) | `private, no-cache` |
| Sandbox: other files of the app (`/v/<n>/style.css`) | `public, max-age=31536000, immutable` |

Consequences:

- **A changed static file can lag up to 11 minutes** in browsers that saw
  the old one. For shared assets, use the snapshot URL
  (`/_s/<store>/<n>/kit.js`) or add a content hash to the URL
  (`kit.js?v=<sha256[:12]>`) when you deploy.
- **App pages are always fresh**: the sandbox URL contains the snapshot
  number, so a new version is a new URL, and its files can be cached forever.
- **Images are sent as uploaded.** Nothing on the server resizes. Make
  thumbnails at build time and use `srcset`.
- **Keep generated files stable.** A build that stamps a timestamp into a
  data file changes the tree on every build, so every push makes a new
  snapshot and every visitor downloads it again.

## Running other people's HTML inside a page

Pages sometimes preview untrusted HTML (a catalog of apps, user content).
What worked in the catalog (browser behaviour, not slop-specific):

- `<iframe sandbox="allow-scripts allow-forms allow-modals">` **without**
  `allow-same-origin`: the content runs in an opaque origin and cannot
  script your page or read your storage.
- `localStorage` throws in an opaque origin, and many apps read it while
  starting and render blank. Fetch the HTML, insert `<base href="…">` and a
  shim that swaps in in-memory `localStorage`/`sessionStorage` when access
  throws, and set `srcdoc`.
- Keep the frame at the device's CSS size and scale it with `transform`.
- Budget the frames: run only visible ones (`IntersectionObserver`), a few
  at a time, and skip very large documents until asked.
- An iframe under the pointer swallows `pointermove`: turn off
  `pointer-events` on frames while dragging.

## Testing

Test against a local server you own, never a shared one.

1. **Start one.** `slop serve --local --llm fake --data ./data
   --admin-email admin@example.com`, then `slop auth login --server
   http://slop.localhost:18300` (approve the device code in a browser signed
   in as that email). Use a separate `SLOP_CREDENTIALS` file so your normal
   login is untouched. `--local` gives a sign-in form that accepts any email:
   sign people in on the live host at `/_site/login?return=<path>`.
2. **Iterate with `slop dev <folder> --app <app>`**: it pushes to `draft` on
   every save and runs it in your dev instance with its own data, printing
   activation errors and the actor's log lines. `--once` for scripts.
3. **Check every push**: `slop app status <store>` (`broken`, `n`, `ref`),
   `slop app logs <store>`.
4. **Call actions directly**: `slop call <store> <action> '{"…":…}'` runs an
   action as you, with the same `requires` check as from a page.
5. **Check access**: `slop explain can <store> interact --subject
   bob@example.com` shows a person's level and why; `--path rsvps/x --op
   write` checks a document rule.
6. **Drive the page in a browser** (Playwright with Chromium): the app is in
   a frame on `s….sbx.…`, so find the frame (`page.frames()`) before
   querying the DOM; check the DOM with an evaluation before trusting a
   blank screenshot; frames go stale after a reload. From inside the frame,
   `await claude.use('db')` and `await (await claude.use('slop')).actions.x()`
   test rules and actions as that viewer.
7. **Model calls with `--llm fake`**: `sample` answers "slop is connected.";
   in `agent` sessions a message `/tool <name> {json}` calls that tool.
   Give someone access with `slop llm set <email> on --budget 100000`.

## Before calling it production

- [ ] `slop app status` is clean for the app store and every store that
      runs it; a rerun of the deploy script changes nothing.
- [ ] Every store's grants, policy cells, trusts and mounts are in the
      deploy script, not only typed once.
- [ ] Each `db` rule and each action's `requires` was tried as a guest, a
      member and a non-member (`slop explain can`, or a browser).
- [ ] Every action declares `requires` (one without needs `admin`, and the
      log warns).
- [ ] Model access is decided per audience (`slop llm set … --budget`) for
      any app that declares `sample` or `agent`.
- [ ] Public routes are on an API-policy mount with `defaultMin: public`, a
      `rateLimit`, and CORS limited to the origins that need it.
- [ ] Shared static assets are referenced by snapshot or hash; images have
      thumbnails; generated data is stable between identical builds.
- [ ] Migrations only add files; `slop app status <store> --migrations`
      matches what you ship.
- [ ] A favicon (the static host answers 404 for `/favicon.ico` unless the
      store has one).

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `claude.use('x')` returns `null` | Not declared, or its policy cell is off for the viewer's audience | Declare it in `app.json`; `slop policy ls <app>` |
| `permission_denied: <action> needs interact; you have view` | The caller's level is below the action's `requires` | Grant the level (`slop grant set <store> @member interact`) or lower `requires` |
| `invalid_argument: this viewer cannot write "<path>"` | A `db` rule needs a higher level for that path | Write it from an actor action, or change the rule |
| `… runs a live app …: mount it on a live host` | A store with capabilities or an actor on the static host | Mount it on the live host |
| `… is plain content: mount it on a static host` | A store with no capability and no actor on the live host | Declare a capability, or use the static host |
| The page is blank on the static host | The static host has no runtime: `window.claude` is undefined | Make it a live app, or drop the runtime calls |
| A change to a shared static file does not show | `max-age=60, stale-while-revalidate=600` | Reference it by snapshot or hash |
| `broken: …` in `slop app status` | Manifest error, actor error at load or `setup`, or a changed migration | Fix and push; the store keeps its last good snapshot |
| `permission_denied: only admins change app code` | App code is admin-only | Push as a platform admin |

## See Also

- `slop help tutorial-first-app` — build and deploy one app, step by step
- `slop help app-manifest` — every field of `app.json`
- `slop help deploying-apps` — push, refs, drafts, mounts, grants, policy
- `slop help page-runtime` — `window.claude` and how slop differs from claude.ai
- `slop help actors` — the actor API
- `slop help app-verbs` — command-line verbs for your app
- `slop help access-control` — levels, groups, grants, policy
- `slop help llm-access` — who may call the model, and budgets
