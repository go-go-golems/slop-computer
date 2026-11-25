---
Title: "The comments capability (not served on slop)"
Slug: "capability-comments"
Short: "What the claude.ai comments capability is, why claude.use(\"comments\") is null on slop, and how to build comments with db and user instead."
Topics:
- capabilities
- page-runtime
- comments
Commands:
- push
- app
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
On claude.ai, `comments` lets a page write into the artifact's shared comment
threads, the ones the claude.ai shell shows in comment mode. **slop has no
comment threads.** A manifest may declare `comments` (so claude.ai pages run
unchanged), but the server never grants it: `await claude.use("comments")`
resolves `null` for every viewer, in every form of the declaration.

This page says what the declaration accepts, what a page should do with the
`null`, and how to get comments on slop with `db` and `user`.

## Declaring it

Both claude.ai forms are accepted in `app.json`, and neither breaks the app:

```json
"capabilities": { "comments": { "composer_only": true } }
```

```json
"capabilities": { "comments": {} }
```

| Form | claude.ai grants | slop |
| --- | --- | --- |
| `{"composer_only": true}` | `openComposer`, `anchorFor`; no consent prompt | `use("comments")` is `null` |
| `{}` | also `create`, `reply`, `resolve`, `delete`, `sendToClaude`, `canSendToClaude`; consent at the first write | `use("comments")` is `null` |
| `"customAnchors": true` (either form) | `customAnchors(...)` for canvas or video pages | ignored; still `null` |

Declare it only if the same page also runs on claude.ai. A slop-only app
gains nothing from it.

## What a page must do

Treat `null` as "comments are off here" and hide every comment control. This
is what Pinup (a claude.ai design tool that runs on slop) does with its
comment mode.

```js
const comments = await claude.use("comments");
document.getElementById("comment").hidden = !comments;
```

Do not feature-detect individual methods on a `null`; check the object.

## The methods, and their status on slop

None of these is reachable on slop, because the object is never handed out.
They are listed so you recognise them in a claude.ai page.

| Method (claude.ai) | Does on claude.ai | On slop |
| --- | --- | --- |
| `openComposer({element} \| {range})` | Opens the shell's composer anchored on an element | Not available (the slop shell would answer `{opened: false}`) |
| `anchorFor(el)` | Builds an anchor for an element | Not available |
| `create({anchor, text})`, `reply(threadId, text)` | Posts as the viewer (text: plain, at most 4 KiB) | Not available; the server has no comment store |
| `resolve(threadId, bool)`, `delete(threadId)` | Moderation | Not available |
| `sendToClaude(...)`, `canSendToClaude()` | Brings Claude into a thread | Not available; no Claude conversation sits beside a slop page |
| `onSendToClaude` | Lets the page answer a viewer's "Send to Claude" itself (for example with `sample`) before Claude is involved | **Does not exist on slop**, not even in the runtime. To let a viewer ask the model about the page, give them a control that calls `sample` or `agent` directly (`slop help capability-sample`). |
| `customAnchors(...)` | Page-positioned pins | Not available |

## A complete minimal page: comments with db

On slop, comments are ordinary shared data. Each comment is a `db` document
keyed by a random id, holding the author's id from `user`, and a rule lets
viewers at `interact` add their own.

`app.json`:

```json
{
  "title": "Notes on a card",
  "page": "index.html",
  "capabilities": {
    "db": { "rules": [
      { "path": "notes", "read": "view", "write": "admin" },
      { "path": "notes/{self}", "write": "interact" }
    ] },
    "user": { "scopes": ["profile"] },
    "comments": { "composer_only": true }
  }
}
```

`notes/{self}` matches a document whose id is the writer's own person id, so
this rule set gives each person one note they can edit; drop `{self}` and use
`"write": "interact"` on `notes` to allow many notes per person (see
`slop help capability-db` for rules).

`index.html`:

```html
<!doctype html>
<html><body>
<section id="card"><h2>Q3 plan</h2><p>Ship it.</p></section>
<button id="native" hidden>Comment (claude.ai)</button>
<form id="form" hidden><input id="text" maxlength="2000" required><button>Add note</button></form>
<ul id="notes"></ul>
<script>
const $ = (id) => document.getElementById(id);
(async () => {
  const [comments, db, user] = await Promise.all(["comments", "db", "user"].map((n) => claude.use(n)));
  if (comments) {                                   // claude.ai: use the shell's threads
    $("native").hidden = false;
    $("native").onclick = () => comments.openComposer({ element: $("card") }).catch(() => {});
    return;
  }
  if (!db || !user) return;                         // neither: no comments at all
  const me = await user.me();
  $("form").hidden = !me.id || !((await user.can("data.write")) ?? true);
  $("form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await db.doc("notes/" + me.id).set({ text: $("text").value, at: Date.now() });
      $("text").value = "";
    } catch (err) { alert("Not saved: " + err.code); }
  };
  db.collection("notes").orderBy("at").onSnapshot(async (snap) => {
    const ps = await user.profiles(snap.docs.map((d) => d.id));
    $("notes").replaceChildren(...snap.docs.map((d) => {
      const li = document.createElement("li");
      li.textContent = (ps[d.id].name || "Someone") + ": " + d.data().text;   // textContent: untrusted
      return li;
    }));
  });
})();
</script>
</body></html>
```

## Errors

On slop no `comments` call is ever made, so the only outcome is the `null`
from `claude.use`. The claude.ai codes (`consent_required`, `forbidden`,
`invalid`, `not_found`, `rate_limited`, `unavailable`, `upstream_error`,
`claude_unavailable`, `not_granted`) matter only for the claude.ai branch of
a shared page. Errors from the `db` fallback are `db` errors
(`permission_denied` and friends, `slop help capability-db`).

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `claude.use("comments")` is `null` | slop does not serve comments | Hide comment controls, or build notes on `db` as above |
| A claude.ai page shows a dead "Comment" button on slop | It checks a method, not the object | Check `if (comments)` before showing the control |
| `onSendToClaude` is missing | Not implemented on slop | Call `sample` or `agent` from your own control |
| Notes refuse to save with `permission_denied` | The viewer is below `interact`, or the document id is not their own id under a `{self}` rule | Grant `interact` (`slop grant set <store> @member interact`), write to `notes/<me.id>` |
| You expected `slop` CLI verbs for comments | There are none | Read notes as documents: `slop docs query <store> notes` |

## See Also

- `slop help capability-db` — documents, rules and `{self}`
- `slop help capability-user` — ids and names for authors
- `slop help capability-sample` — asking the model from a page control
- `slop help page-runtime` — `claude.use` and how slop differs from claude.ai
- `slop help app-manifest` — every capability's declaration form
