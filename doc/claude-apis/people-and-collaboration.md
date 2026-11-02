# Artifact People & Collaboration — Guide

Oct 10, 2026 · @Manuel Odendahl

## Overview

Three capabilities make a page multi-person: `user` says who is looking and what they may do, `room` connects everyone viewing right now, and `comments` writes into the artifact's shared comment threads. None of them stores state: anything a late joiner must see goes in `db` (see the State Storage guide).

| Need | Capability | Persists? |
| --- | --- | --- |
| Show or hide controls by role | `user` (`isOwner`, `canEdit`, `can`) | n/a |
| Attribute rows to people; per-person data | `user.id()` + `db` | Yes, in `db` |
| Show names and avatars | `user.profiles(ids)` with scope `profile` | No; resolve at render |
| @-mention or assignee picker | `user.search(q)` with scope `profile` | Store the id in `db` |
| Live cursors, who's here, selections | `room.presence` + `onPeers` | No; cleared on leave |
| Momentary events (reactions, "clear board") | `room.emit` / `on` | No; never replayed |
| Separate groups (game tables, breakouts) | `room.join(name)` | No |
| Hand a selection to the viewer's own Claude | `room.sendToClaudeSession` | Into their chat |
| Comment entry points on page elements | `comments.openComposer` | Yes, in the comment store |
| Post comments, or send one to Claude | `comments.create` / `reply` / `sendToClaude` | Yes |
| Comments on canvas, video or redrawn content | `comments.customAnchors` | Yes |

Every page must work for one viewer alone, and light up as these capabilities resolve. All three resolve `null` when the view can't run them; design for absence.

## user: who is viewing

`user` answers who is looking at the page and resolves the people your shared state refers to. Every read resolves and **never rejects**: unavailable strings are `""`, optional data is `null`, booleans are `false`. "Unavailable" covers every reason at once (no viewer, scope not declared, org policy, guest with no identity).

```js
const user = await claude.use("user");          // null: no viewer here
const owner = (await user?.isOwner()) ?? false;  // null matches the all-absent defaults
```

### Scopes gate fields

| Declaration | Adds |
| --- | --- |
| none | `isOwner()`, `canEdit()`, `can()`; `me()` with id/email null and name "" |
| `{ "user": {} }` | `id()` — your opaque id; `profiles()` resolves, but names stay "" |
| `{ "user": { "scopes": ["profile"] } }` | names, avatars, `guest` flag, `search()` |
| `{ "user": { "scopes": ["profile", "email"] } }` | emails (yours and others'), if the org allows |

A scope is a ceiling, not a guarantee: any field may still be empty for a given viewer.

### Roles and permissions (no declaration needed)

| Call | True when |
| --- | --- |
| `isOwner()` | This person owns the artifact |
| `canEdit()` | They can publish page versions; equals the `db` `admin` level |
| `can("data.write")` | They may change shared `db` documents |
| `can("files.write")` | They may publish the artifact's files and versions |
| `can("assets.write")` | They may upload and delete assets |
| `can("people.add")` | They may add a colleague via the share menu (the page can't add anyone itself) |

`can()` resolves `true`, `false` or `null`. **`null` means the platform said nothing, not "cannot".** Then keep shared-data controls and let a refused write decide; use `canEdit()` for the file names; offer no add-people control. Unknown names resolve `false`. Answers are advice for what to offer; the server enforces every action.

`canEdit()` is not "may write shared data": Contributors write `db` by default without being editors. Ask `can("data.write")` for that.

### Identity

`me()` returns everything in one await and is never null:

```ts
interface Viewer {
  id: string | null;   // opaque "u_..." token; needs { user: {} }
  name: string;        // "" when unavailable — render me.name || "you"
  avatarUrl: string;   // always renderable (photo or generated initials)
  color: string;       // stable per account, contrast-safe in both themes
  email: string | null;
  isOwner: boolean;
  canEdit: boolean;
}
```

`id()`, `name()`, `avatarUrl()` and `email()` are single-field versions.

**Id rules.** Ids are issued per scope (today, the organization that owns the artifact). Within a scope they're stable forever, so store and key by them freely. Never compare ids across scopes, never parse them, never shorten or show them. Members' and guests' ids look alike; use `Profile.guest` to tell them apart.

### Resolving people: profiles(ids)

```js
const ps = await user.profiles(idsOnScreen);  // batch only; keys = exactly the ids passed
cell.textContent = ps[id].name || "Someone";   // || not ?? — "" is falsy
img.src = ps[id].avatarUrl;
```

- Call it **inside your render path, every time**. It's cached for the page's life, concurrent calls coalesce, and entries refresh in the background. Hoisting it to load time goes stale when someone new appears.
- Every id gets an entry. Unknown, foreign or erased ids come back with `name: ""`, a generic avatar and a stable color.
- `Profile` has `id`, `name`, `avatarUrl`, `color`, `email`, `isMe` and `guest`.
- Two viewers may see different names for the same id.

### Picking people: search(query)

An @-mention or assignee typeahead over the viewer's organization: at most 8 profiles, best match first.

- Call `search("")` on focus to pre-seed the menu (you plus people already resolved).
- Call it straight from `oninput`; the platform debounces, and superseded calls resolve with the newest result.
- `[]` means no match or unavailable, never "keep typing".
- Searching notifies no one and grants no access.

### Rules

- **Store only ids**, from `id()`, `me().id` or a search hit's `.id`. Never store a name, avatar, email or Profile: they differ per viewer, go stale and outlive people.
- **Names are other people's input.** Set them with `textContent`, never `innerHTML`.
- Every viewer gets identical HTML. These reads change what you render, not what a viewer can extract from source, so they're not a security boundary.

## room: everyone here right now

`room` connects everyone viewing the artifact at this moment. Nothing persists: a new page version reloads every view and empties the room.

- **Events** (`emit` / `on`): moments on topics, sent to everyone, never stored or replayed.
- **Presence** (`presence` / `peers` / `onPeers`): one object per participant (cursor, selection), handed to newcomers and cleared when they leave.
- **Named rooms** (`join`): separate groups inside the lobby.
- **To Claude** (`sendToClaudeSession`): hand what the viewer picked to their own Claude conversation.

```js
// manifest: { "room": { "topics": { "reaction": "interact" } }, "user": { "scopes": ["profile"] } }
const room = await claude.use("room"); // null: this view can't connect
```

### Who's here and who may send

Signed-in people the platform admits (`kind: "viewer"`): org members and admitted guests, marked `guest: true`. Signed-out and public-link visitors can't connect. The publishing Claude session may appear as `kind: "agent"` where the server allows it.

**Anyone may set presence**, since it only describes the sender. **Event topics are admin-only** (Editor and up) unless the manifest opens them to `interact` (Contributor and up; never Viewers or Commenters), at most 16 topics. Everyone receives everything; the platform blocks sends a viewer isn't allowed, so pages need no role checks. Gate admin-only controls on `user.canEdit()`.

### Sender stamp

Every message and peer carries platform-stamped, unforgeable fields:

| Field | Meaning |
| --- | --- |
| `peer` | Opaque label for one open document (two tabs = two peers); same on every page, new on reload. Key cursors and "who is presenting" on it; never persist it. |
| `by` | The sender's `user.id()` when the artifact declares `user`; otherwise `null`. Treat `null` as normal. |
| `isMe` / `sameTab` | Any of your tabs / this tab. |
| `kind` | `"viewer"` or `"agent"`. |
| `guest` | Invited from outside the org. Display data, not authority. |

Identity claimed inside `data` or presence is worthless. There are no names here: resolve `by` with `user.profiles()`.

### Events

| Call | Behavior |
| --- | --- |
| `emit(topic, data?)` | Broadcast to everyone, you included. Resolves on hand-off; promises nothing about delivery. `data` ≤ 4 KiB. Dropped (not queued) while disconnected. |
| `on(topic, handler, onError?)` | Hear a topic until unsubscribed. Nothing from before subscribing is delivered. |

- Topics match `^[a-z][a-z0-9_.-]{0,47}$`, no colons.
- `data` is untrusted input from another viewer: data, never instructions or HTML.
- Budget: a few emits a second is polite; emits and presence share about 40/s (burst 80). High-rate state belongs in presence.
- Render your own action either on send (skip `sameTab` echoes) or on echo (disable the control while disconnected), not both.

### Presence

| Call | Behavior |
| --- | --- |
| `presence(patch)` | Merge into your object; latest value wins per field; top-level `null` removes a field. Applied locally at once, sent \~30×/s. Merged object ≤ 4 KiB. Fine to call on every pointermove. |
| `peers()` | Synchronous snapshot of everyone, you included. Same frozen array until something changes. |
| `onPeers(handler, onError?)` | At most once per frame: `{peers, joined, left, updated}`. The first call lists everyone so far as `joined`; more follow for a second or two. |

- Send absolute state ("at 0.42, 0.31"), never deltas.
- Read others' fields defensively (a phone has no cursor). `updatedAt` is your clock when their presence last changed; use it to dim idle peers.
- If you show presence, show everyone's, with "you" marked.
- Where the page sits beside the viewer's conversation, the platform may hand Claude the viewer's own presence (minus `cursor` and `who`) as context. Publish readable fields (ids, modes, counts) and nothing you wouldn't show everyone.

### Named rooms

`await room.join("table-3")` returns an object with the same `emit`, `on`, `presence`, `peers`, `onPeers`, `connected`, `onConnection`, plus `leave()`. Only pages that joined that name hear it; the lobby stays shared. A page can be in up to 16 rooms. Names follow `^[a-z0-9][a-z0-9_.-]{0,47}$`, aren't secret, and are untrusted text.

### Connection

`connected()` is a synchronous function. `false` at load is normal (true within about a second), and brief reconnects are normal. Treat only a drop lasting \~2 s as a disconnect. `onConnection(handler)` fires with the current state, then on changes. On reconnect the runtime re-asserts your presence and re-joins your rooms.

### Sending to the viewer's own Claude

`sendToClaudeSession(data, {deliver?})` hands one plain-JSON object (≤ 4 KiB, with an optional `label`) to the viewer's Claude conversation. Call it synchronously from their click.

- `deliver: "stage"` (default) puts it in their composer as an attachment; nothing reaches Claude until they send.
- `deliver: "send"` asks the viewer in a platform dialog, then starts Claude's turn with it.
- Check `canSendToClaudeSession()` first and show the control only on `available`, `available_if_summoned` (send only) or `available_if_opened` (stage only).
- It works even while the room is disconnected.

### Errors

| Code | Meaning |
| --- | --- |
| `invalid_argument` | Bad topic, value or size. Fix the call. |
| `not_permitted` | Viewer can't send on that topic, or can't join. Don't retry. |
| `limit_reached` | Too many named rooms. Leave one. |
| `upstream_error` | Transient; safe to drop. |
| `claude_unavailable` / `rate_limited` | `sendToClaudeSession` only. Keep the draft. |
| `revoked` / `not_granted` / `capability_*` | Terminal: listeners die, `peers()` shrinks to you. Render the single-viewer page. |

Always pass `onError` to listeners; without it a room failure is silent.

## comments: the shared comment threads

`comments` lets the page's own UI write into the artifact's one shared comment store, the same threads the claude.ai shell shows in comment mode. It is **write-only**: there's no verb to list, read, edit or watch threads, because the shell already displays every thread. Never build your own thread list.

### Two declaration forms

| Manifest | Grants | Consent |
| --- | --- | --- |
| `{ "comments": { "composer_only": true } }` | `openComposer`, `anchorFor` | Never asked |
| `{ "comments": {} }` | Also `create`, `reply`, `sendToClaude`, `resolve`, `delete` | Asked at the first write |

Add `"customAnchors": true` to either form for pages that position pins themselves. The full form is only for the owner and org members who can open the artifact (not view-only by default); public-link visitors and email invitees get `null`. Prefer composer-only when the page just needs discoverable entry points.

### Methods

| Method | Behavior |
| --- | --- |
| `openComposer({element} \| {range})` | Opens the shell's composer as if the viewer clicked there in comment mode. The page posts nothing. A Range's text becomes the quoted excerpt. Resolves `{opened}`; `false` is a soft refusal (page not focused, or a draft is open). |
| `anchorFor(el)` | Builds the `Anchor` for an element. Call it at the moment of the gesture. |
| `create({anchor, text})` | Starts a thread as the viewer. Resolves `{threadId, commentId}`. |
| `reply(threadId, text)` | Appends a reply. |
| `sendToClaude({anchor, text} \| {threadId, text})` | Posts and brings Claude into the thread; Claude replies there later. Editors only. Check `canSendToClaude()` first. |
| `canSendToClaude()` | `available`, `writers_only`, `no_session` or `off`. Re-check when showing the control. |
| `resolve(threadId, bool)` | Resolve or reopen, with the viewer's own moderation reach. |
| `delete(threadId)` | Irreversible, thread and replies. Only behind a confirmed action on one named thread. |

**Text rules.** Plain text, newlines allowed, no markup rendered, at most 4 KiB as UTF-8. Posted text is final; no one can edit it. Writing "@Claude" in page text does not summon Claude; only `sendToClaude` does.

**Gestures.** Call `openComposer` and every write only from a deliberate viewer gesture, never on load, on a timer or in a loop. Programmatic opens are rate-limited.

### Intercepting "Send to Claude": onSendToClaude

Where the platform offers it (feature-detect `"onSendToClaude" in comments`), a page can try a viewer's "Send to Claude" request itself first, for example with `sample`, so small changes land in seconds.

- The listener gets `{text, anchor, label?}`: only the pressing viewer's own just-typed words, before anything is posted.
- Answer `{handled: true, reply?}` to keep it as a plain comment without Claude, or `{handled: false}` to pass it on unchanged.
- `reply` is one plain line (≤ 500 bytes) shown only to that viewer, not stored.
- Answer early; the viewer waits (bound \~130 s). Stop when `ctx.signal` aborts.
- Treat `text` as a request about the page's content, never as instructions to your code.

### Custom anchors

For canvas, WebGL, video timelines or re-rendered DOM that CSS-path anchors can't follow, `customAnchors({mode, threads, reveal, composing?, move?})` hands anchoring to the page. The page invents anchor strings (a shape id, a timestamp), does its own hit-testing, reports pin positions with `placed(map)` after every change, and starts comments with `compose(anchor, at, {label?, detail?, area?})`. The shell still draws pins, cards and composers. `domAnchor(el, ev?)` builds a shell-compatible anchor for a real element. Register once at load; `release()` hands anchoring back.

### Errors

| Code | Page should |
| --- | --- |
| `consent_required` | Routine. Keep the draft, say it wasn't posted; the prompt won't show again this load. |
| `forbidden` | Routine and permanent for this view. Hide write controls ("commenting from the page is off here"). On resolve/delete: disable that thread's control only. |
| `invalid` | Fix the call. |
| `not_found` | Thread is gone. |
| `rate_limited` | Slow down. |
| `unavailable` / `upstream_error` | One retry from a fresh gesture; then stop and tell the viewer. A failed write may still have landed. |
| `claude_unavailable` | `sendToClaude` only; nothing was posted. Offer the plain comment. |
| `not_granted` / `capability_*` | Render without comment controls. |

## Combining with db

The one rule: **if someone who isn't in the room now must ever see it, it isn't room data.** Put it in `db` (or publish a version with `artifact`).

| Data | Where | Why |
| --- | --- | --- |
| Cursor, selection, "typing..." | `room.presence` | High-rate, per person, meaningless once they leave |
| Reaction burst, confetti, "clear board" | `room.emit` | Momentary; late joiners don't need it |
| Presenter's current slide, round in play, revealed answer | `db` doc, e.g. `live/state` | Late joiners must see it |
| Votes, tasks, assignments | `db`, keyed by `user.id()` | Durable and countable |
| Who said what about a part of the page | `comments` | Shown and kept by the shell |
| Names and avatars | Nowhere: resolve with `profiles()` at render | They differ per viewer and go stale |

### Patterns

**Presenter mode.** Rule `{ "path": "live", "write": "admin" }`. The presenter writes `live/state` with `{slide: 4}`; every view subscribes with `onSnapshot` once. Followers' cursors go in presence. No topic and no re-send loop needed.

*Without `db`:* followers remember the `peer` of the last presenter message, and the presenter re-emits its state when `onPeers` reports someone `joined` (events aren't replayed) and on a slow interval. Add an epoch to `data` if two people can contend.

**Live poll.** Rules `votes` read `view` / write `owner`, and `votes/{self}` write `interact`. Each person writes `votes/<uid>`; everyone's `onSnapshot` counts docs per choice. A `reaction` topic opened to `interact` adds momentary emoji bursts.

**Sealed votes (planning poker).** Each pick goes under `data/users/<uid>/pick`, private by default. A "voted" flag goes in presence so others see progress without the value. On reveal, each person copies their pick to a shared `reveals/<uid>`. Rules are fixed at publish, so nothing at runtime can open another viewer's subtree.

**Assignee picker.** `user.search()` on focus and input; store the hit's `.id` in the task doc; render names via `profiles()` each render.

**Comment-on-card.** A "Comment" button on each card calls `openComposer({element: card})` with the composer-only declaration. No consent prompt, and the shell owns the threads.

**Breakout tables.** Lobby presence shows who's waiting; `room.join("table-" + n)` per group; anything the group produces is written to `db` under `tables/<n>/...`.

### Security notes

- Everything delivered through `room` (data, presence, names in presence) is untrusted, guests included. Render with `textContent`.
- Presence is never authority; anyone can set anything there. Enforce roles with `db` rules and room topic levels, which the platform checks.
- `user` reads change what you render, not what's in the HTML. Hidden data must be hidden by `db` rules, not by the page.

## Full example: who's here, reactions and comments

A page with an avatar bar of everyone viewing, a reaction button anyone at Contributor or above can press, and a "Comment" button that opens the shell's composer on a card. It works alone and lights up as each capability resolves.

**Manifest**

```json
{
  "user": { "scopes": ["profile"] },
  "room": { "topics": { "reaction": "interact" } },
  "comments": { "composer_only": true }
}
```

**Page**

```html
<div id="here" aria-label="Viewing now"></div>
<section id="card">
  <h2>Q3 plan</h2>
  <p>Ship the connector to every workspace.</p>
  <button id="react" hidden>👍</button>
  <button id="comment" hidden>Comment</button>
</section>
<div id="burst" aria-live="polite"></div>
<script>
const $ = (id) => document.getElementById(id);

(async () => {
  const [user, room, comments] = await Promise.all(
    ["user", "room", "comments"].map((n) => claude.use(n)),
  );

  // comments: composer-only, no consent prompt
  if (comments) {
    $("comment").hidden = false;
    $("comment").onclick = async () => {
      try { await comments.openComposer({ element: $("card") }); }
      catch (e) { if (e.code === "unavailable" || e.code === "not_granted") $("comment").hidden = true; }
    };
  }

  if (!room) return; // single-viewer page from here on

  // Presence: who's here, rendered with profiles() on every change
  async function renderPeers(peers) {
    const viewers = peers.filter((p) => p.kind === "viewer");
    const ids = [...new Set(viewers.map((p) => p.by).filter(Boolean))];
    const ps = user && ids.length ? await user.profiles(ids) : {};
    $("here").replaceChildren(...viewers.map((p) => {
      const prof = p.by ? ps[p.by] : null;
      const img = document.createElement("img");
      img.width = img.height = 24;
      if (prof) img.src = prof.avatarUrl;
      img.alt = p.isMe ? "You" : (prof?.name || "Someone");
      img.title = img.alt + (p.guest ? " (guest)" : "");
      img.style.opacity = Date.now() - p.updatedAt > 60000 ? 0.5 : 1;
      return img;
    }));
  }
  const stopPeers = room.onPeers((c) => renderPeers(c.peers), () => renderPeers([]));
  room.presence({ view: "q3-plan" }); // readable state, no names

  // Events: reactions on a topic opened to Contributors
  const writable = (await user?.can("data.write")) ?? true;
  $("react").hidden = !writable;
  $("react").onclick = () => {
    room.emit("reaction", { emoji: "thumbs-up" }).catch((e) => {
      if (e.code === "not_permitted") $("react").hidden = true;
    });
  };
  const stopReact = room.on("reaction", async (msg) => {
    const who = msg.isMe ? "You" : (msg.by && user ? (await user.profiles([msg.by]))[msg.by].name : "") || "Someone";
    $("burst").textContent = who + " reacted 👍"; // textContent: untrusted input
  }, () => { $("react").hidden = true; });

  // Disable while disconnected (render-on-echo style)
  room.onConnection((up) => { $("react").disabled = !up; });
})();
</script>
```

**What this demonstrates**

- Each capability is optional; the card works with none of them.
- Names come from `profiles()` at render time, never from presence or stored strings.
- The reaction renders on echo, so the button is disabled while disconnected.
- `can("data.write")` returning `null` keeps the button; `not_permitted` hides it.
- The comment button uses composer-only, so no consent prompt and no thread list in the page.

To make reaction counts survive reloads, add `db` and write `reactions/<uid>` docs instead of (or as well as) emitting. To show who reacted to people who arrive later, the same applies.
