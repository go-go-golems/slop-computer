---
Title: "The user capability: who is viewing"
Slug: "capability-user"
Short: "Read the viewer's id, name, level and permissions from a page, resolve stored ids to names, and search the store's people."
Topics:
- capabilities
- page-runtime
- people
- user
Commands:
- policy
- grant
- push
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
`user` tells a page who is looking at it and what they may do, and turns the
person ids your shared data stores into names. It never stores anything:
per-person data goes in `db`, keyed by the id `user` gives you.

slop implements the claude.ai `user` contract with a few differences; the
section "How slop differs from claude.ai" lists them.

## Declaring it

`user` is declared in the `capabilities` block of `app.json`. Its scopes
decide which fields a page can read; nothing is asked of the viewer (there is
no consent prompt).

| Declaration | What the page gets |
| --- | --- |
| *(not declared)* | `claude.use("user")` resolves `null`. On slop you must declare `user` even for `isOwner()` / `canEdit()` / `can()`. |
| `"user": {}` | `isOwner`, `canEdit`, `can`, `me`, `id`, `profiles`. Names in `me()` and `profiles()` are `""`. |
| `"user": { "scopes": ["profile"] }` | adds names, `name()`, `avatarUrl()`, `search()` |
| `"user": { "scopes": ["profile", "email"] }` | adds `email()` and emails in `me()`, `profiles()`, `search()`, **only if** the app's policy cell `user.email` is on for the viewer's audience |

Any other scope fails the manifest: `slop app status <store>` shows
`broken: 'app.json: capabilities.user: unknown scope "phone"'` and the page
does not open.

The `email` scope is a request; the policy cell `user.email` (off by default
for every audience) is the permission. Turn it on for an audience group, which
also covers the groups above it:

```bash
slop policy set myapp user.email @member on     # members, subscribers, admins
slop policy ls myapp                             # shows every cell and its effect
```

While the cell is off for the viewer, the page behaves as if only `profile`
were declared: `email()` is missing and every `email` field is `null`.

## A complete minimal page

`app.json`:

```json
{
  "title": "Who is here",
  "page": "index.html",
  "capabilities": {
    "db": { "rules": [{ "path": "votes", "read": "view", "write": "interact" }] },
    "user": { "scopes": ["profile"] }
  }
}
```

`index.html`:

```html
<!doctype html>
<html><body>
<p id="hello">Hello.</p>
<button id="vote" hidden>Vote yes</button>
<ul id="people"></ul>
<script>
(async () => {
  const [user, db] = await Promise.all([claude.use("user"), claude.use("db")]);
  if (!user) return;                         // page still works without it
  const me = await user.me();                // never null, never rejects
  document.getElementById("hello").textContent = "Hello, " + (me.name || "you");

  // Offer the control only where a write would succeed; the server still decides.
  const canWrite = (await user.can("data.write")) ?? true;
  const btn = document.getElementById("vote");
  btn.hidden = !canWrite || !me.id;
  btn.onclick = () => db.doc("votes/" + me.id).set({ yes: true }); // store the id, never the name

  // Render names from ids at render time, every time.
  db.collection("votes").onSnapshot(async (snap) => {
    const ids = snap.docs.map((d) => d.id);
    const ps = await user.profiles(ids);
    document.getElementById("people").replaceChildren(...ids.map((id) => {
      const li = document.createElement("li");
      li.textContent = (ps[id].name || "Someone") + (ps[id].isMe ? " (you)" : ""); // textContent: names are other people's input
      return li;
    }));
  });
})();
</script>
</body></html>
```

Deploy it like any app (`slop store new who`, `slop push who`, then a mount;
see `slop help deploying-apps`).

## API reference

Every method returns a Promise. Reads **never reject**: an unavailable string
is `""`, optional data is `null`, a boolean is `false`. Methods a scope does
not grant are absent from the object (check with `typeof user.search ===
"function"` or `"search" in user`).

### Roles and permissions

| Call | Resolves | On slop |
| --- | --- | --- |
| `isOwner()` | boolean | the viewer's level on the store is `owner` |
| `canEdit()` | boolean | level `admin` or above |
| `can("data.write")` | boolean | the app's `db` rules let this level write somewhere (checked against a probe path, so it is a hint, not a promise for every path) |
| `can("assets.write")` | boolean | level `interact` or above |
| `can("files.write")` | boolean | level `admin` or above |
| `can("people.add")` | `false` | always; a page cannot add people |
| `can(<anything else>)` | `null` | unknown names resolve `null` (claude.ai: `false`) |

Levels come from grants, links and audiences (`slop help access-control`).
These answers tell the page what to offer; the server enforces every write
regardless.

### Identity

`me()` returns the whole viewer in one call:

```ts
interface Viewer {
  id: string | null;      // "usr_…" for a person, "vis_…" for a guest
  name: string;           // "" without the profile scope; "Guest" for a guest
  avatarUrl: string;      // "" today: render your own initials (see Limits)
  color: string;          // "hsl(h 55% 45%)", stable per id
  email: string | null;   // needs the email scope and the user.email cell
  isOwner: boolean;
  canEdit: boolean;
  // slop's additions:
  audience: "guest" | "member" | "subscriber" | "admin";
  level: "view" | "interact" | "admin" | "owner";
  guest: boolean;         // true for an anonymous visitor
  subscribed: boolean;
  llm: { allowed: boolean; remaining: number | null };  // may this viewer use sample/agent
}
```

Example from a local server (admin, owner of the store, `profile` and `email`
declared, `user.email` on for `@member`):

```json
{"id":"usr_5f7fcc82b37d301c39606d95","name":"Admin","avatarUrl":"","color":"hsl(12 55% 45%)",
 "email":"admin@example.com","isOwner":true,"canEdit":true,"audience":"admin","level":"owner",
 "guest":false,"subscribed":false,"llm":{"allowed":false,"remaining":null}}
```

Single-field versions: `id()` (any declaration), `name()` and `avatarUrl()`
(scope `profile`; `avatarUrl()` resolves `null` when there is no avatar), and
`email()` (scope `email` with the cell on).

**Ids.** A person's id is their slop id (`usr_…`), the same in every store
and app on the server; a guest's is `vis_…`. Store ids and key data by them;
never parse them or show them to people.

### profiles(ids)

```js
const ps = await user.profiles(["usr_a", "usr_b"]);  // or a single id string
ps["usr_a"].name || "Someone";
```

- Resolves an object with exactly one entry per id passed. Unknown ids get
  `name: ""`, `avatarUrl: ""` and a grey color.
- `Profile` is `{id, name, avatarUrl, color, email, isMe, guest}`.
  Without the `profile` scope every `name` is `""`. A person with no name set
  shows the part of their email before `@`. A guest id resolves to the name
  `"Guest"`.
- Results are cached for the life of the page (no background refresh); new
  ids are fetched in one batch. A batch over 200 ids fails silently and
  returns empty entries, so ask for the ids on screen, not every id you know.
- Call it in your render path; keep only ids in `db`.

### search(query)

Needs the `profile` scope. Resolves an array of `Profile`, at most 20.

- It searches the people who hold a grant on this store directly, plus its
  owner, not the whole server. People who reach the store only through a
  group grant (`@member`) or a link are not found.
- The match is a case-insensitive substring of the name, or of the email when
  the page may see emails. `search("")` lists everyone it covers.
- `[]` means no match. It never rejects.

## Rules

- **Store ids, never names or emails.** Names change and differ per scope.
- **Names are other people's input.** Set them with `textContent`.
- **Not a security boundary.** Every viewer gets the same HTML; hide data with
  `db` rules, not by checking `user` in the page.
- **Guests are real viewers.** A store granted to `@guest` (or opened by a
  link) gives anonymous visitors a `vis_…` id, `name: "Guest"` and
  `guest: true`.

## How slop differs from claude.ai

| claude.ai | slop |
| --- | --- |
| `isOwner`/`canEdit`/`can` work without declaring `user` | `user` must be declared, or `use("user")` is `null` |
| Ids are opaque `u_…`, per organisation | `usr_…` / `vis_…`, one id per person on the server |
| `email` scope gated by the organisation | gated by the policy cell `user.email` (`slop policy set <app> user.email @<group> on`) |
| `search` covers the organisation, at most 8 | covers the store's owner and direct grantees, at most 20 |
| `avatarUrl` is always renderable | `""` today |
| `can(unknown)` is `false` | `null` |
| `me()` has the contract's fields | adds `audience`, `level`, `guest`, `subscribed`, `llm` |

The same viewer facts are available without `user` through
`(await claude.use("slop")).visitor()` (see `slop help capability-slop`).

## Limits

| What | Limit |
| --- | --- |
| Ids per `profiles()` request | 200 (more: empty entries) |
| `search()` results | 20 |
| Scopes | `profile`, `email` |
| Avatars | none served; `avatarUrl` is `""` |

## Errors

`user` reads do not reject. What a page sees instead:

| Situation | Result |
| --- | --- |
| `user` not declared, or the app is broken | `claude.use("user")` resolves `null` |
| Scope not declared | the method is missing; fields are `""` / `null` |
| `email` declared but the `user.email` cell is off | `email()` missing, `email: null` |
| Server unreachable during `profiles` / `search` | empty entries / `[]` |

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `claude.use("user")` is `null` | `user` is not in `app.json` | Add `"user": {}` (or with scopes) and `slop push` |
| Page does not open; `slop app status` shows `unknown scope` | A scope other than `profile` / `email` | Fix the scope list |
| `user.search` is not a function | No `profile` scope | Declare `"scopes": ["profile"]` |
| Emails are always `null` | The `user.email` cell is off for the viewer's audience | `slop policy set <app> user.email @member on`; check with `slop policy ls <app>` |
| Every name is `""` | No `profile` scope | Add it |
| `search()` misses someone who can open the store | They reach it through `@member` or a link, not a direct grant | Grant them directly (`slop grant set <store> <usr_id> view`) or store their id when they first visit (`me().id`) |
| Avatars are blank | slop serves no avatars | Draw initials on `color` |
| `profiles()` returns empty names for many ids | More than 200 ids in one call | Pass only the ids on screen |

## See Also

- `slop help page-runtime` — `claude.use`, consent, how slop differs from claude.ai
- `slop help capability-room` — who is here right now (presence, events)
- `slop help capability-db` — storing per-person data under `user.id()`
- `slop help access-control` — levels, audiences, groups and policy cells
- `slop help app-manifest` — every `app.json` field
- `slop help capability-slop` — `visitor()` and actor actions
