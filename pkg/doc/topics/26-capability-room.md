---
Title: "The room capability: everyone here right now"
Slug: "capability-room"
Short: "Presence, live events and named rooms between the open pages of one store; what each viewer may send, and the sender stamp on every message."
Topics:
- capabilities
- page-runtime
- room
- presence
- realtime
Commands:
- grant
- push
- app
IsTopLevel: false
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
`room` connects the pages that are open on one store at this moment. Each
open page is a **peer**. Peers share **presence** (one small object each: a
cursor, a selection, a mode) and send **events** on named topics. Nothing is
stored: a peer's presence goes when its page closes, an event reaches only
the pages open when it is sent, and a new snapshot of the app reloads every
page, which empties the room.

What a page that opens late gets: **everyone's current presence** (the first
`onPeers` call lists every peer as `joined`), so "who is here" and "who is
ready" need nothing else. It does not get **events sent before it opened**,
nor the presence of anyone who already left. Keep in `db` what must outlast
the people in the room: a history, results, anything to read tomorrow
(`slop help capability-db`).

The room belongs to the **store**, not the app: two boards running Pinboard
have two separate rooms. slop implements the claude.ai `room` contract with
the differences listed in "How slop differs from claude.ai" below.

## Declaring it

```json
"capabilities": {
  "room": {}
}
```

or, to let viewers below `admin` send on some topics:

```json
"capabilities": {
  "room": { "topics": { "reaction": "interact", "ops": "interact" } }
}
```

| Field | Rules |
| --- | --- |
| `topics` | Optional map of topic name to the lowest store level that may **send** on it: `"interact"` or `"admin"`. At most 16 topics. Names match `^[a-z][a-z0-9_.-]{0,47}$`. |

Any topic not listed needs `admin` to send. Everyone in the room receives
every topic. A level other than `interact` or `admin` breaks the app:
`slop app status <store>` shows
`broken: 'app.json: capabilities.room: topic "reaction": level must be interact or admin'`.

## Who is in the room

Anyone who can open the store is a peer: people with a level on it, and
guests when the store is granted to `@guest` or opened through a link (guests
get a `vis_…` id and `guest: true`). Presence is open to every peer. Sending
an event checks the sender's **level on the store** against the topic's
level. Give people the level with a grant:

```bash
slop grant set board-1 @member interact      # members may send "interact" topics
slop grant set board-1 usr_64d6… view        # this person only watches
```

A page is a peer while its live connection is up. A closed tab leaves at
once; a dropped connection leaves until it reconnects.

## A complete minimal page

`app.json`:

```json
{
  "title": "Cursors",
  "page": "index.html",
  "capabilities": {
    "user": { "scopes": ["profile"] },
    "room": { "topics": { "reaction": "interact" } }
  }
}
```

`index.html`:

```html
<!doctype html>
<html><body style="height:100vh;margin:0">
<div id="here"></div>
<button id="react" hidden>Wave</button>
<p id="log" aria-live="polite"></p>
<script>
const $ = (id) => document.getElementById(id);
(async () => {
  const [user, room] = await Promise.all([claude.use("user"), claude.use("room")]);
  if (!room) return;                                   // single-viewer page

  // Presence: who is here, with names resolved from ids at render time.
  room.onPeers(async ({ peers }) => {
    const ids = [...new Set(peers.map((p) => p.by).filter(Boolean))];
    const ps = user && ids.length ? await user.profiles(ids) : {};
    $("here").textContent = peers.map((p) =>
      p.isMe ? "you" : (ps[p.by]?.name || "someone") + (p.presence.cursor ? " (pointing)" : "")).join(", ");
  }, (e) => { $("here").textContent = "room closed: " + e.code; });

  let pending = false;                                 // one presence update per frame
  addEventListener("pointermove", (e) => {
    if (pending) return; pending = true;
    requestAnimationFrame(() => {
      pending = false;
      room.presence({ cursor: { x: e.clientX / innerWidth, y: e.clientY / innerHeight } }).catch(() => {});
    });
  });

  // Events: a topic opened to interact.
  $("react").hidden = !((await user?.can("data.write")) ?? true);
  $("react").onclick = () => room.emit("reaction", { kind: "wave" }).catch((e) => {
    if (e.code === "not_permitted") $("react").hidden = true;
  });
  room.on("reaction", async (m) => {
    const who = m.isMe ? "You" : (m.by && user ? (await user.profiles([m.by]))[m.by].name : "") || "Someone";
    $("log").textContent = who + " waved";              // textContent: data is untrusted
  }, () => { $("react").hidden = true; });

  room.onConnection((up) => { $("react").disabled = !up; });
})();
</script>
</body></html>
```

## API reference

`await claude.use("room")` joins the store's unnamed room (the **lobby**) and
resolves its object, or `null` when the app does not declare `room` or the
view cannot connect.

### Events

| Call | Behaviour |
| --- | --- |
| `emit(topic, data?)` | Sends to every peer in the room, you included. Resolves `undefined` once handed over. `data` is any JSON value, at most 4096 bytes serialised. While disconnected the event is **dropped**, not queued. Over the rate limit it is dropped silently too. |
| `on(topic, handler, onError?)` | Calls `handler(message)` for each event on `topic` from now on; nothing earlier is replayed. Returns an unsubscribe function. An invalid topic **throws** (synchronously). |

A message is:

```ts
{ topic: string, data: any, peer: string, by: string | null,
  isMe: boolean, sameTab: boolean, kind: "viewer" | "actor", guest: boolean }
```

### Presence

| Call | Behaviour |
| --- | --- |
| `presence(patch)` | Merges a plain object into your presence; a top-level `null` removes that field. Applied to your own `peers()` entry at once, then sent. The merged object is at most 4096 bytes and 8 levels deep. Each call is one request to the server: throttle it (one per animation frame is plenty). |
| `peers()` | Synchronous array of everyone in the room, you included. The same frozen array until something changes. |
| `onPeers(handler, onError?)` | Calls `handler({peers, joined, left, updated})` on every change. The first call lists everyone present as `joined`. Returns an unsubscribe function. |

A peer is
`{peer, by, kind, guest, presence, updatedAt, isMe, sameTab}`, where
`updatedAt` is the server's time in milliseconds when that peer's presence
last changed (or when it joined). Send absolute state (`{x: 0.42}`), never
deltas, and read other peers' fields defensively.

### The sender stamp

The server fills these fields; a page cannot forge them. Identity claimed
inside `data` or presence is worth nothing.

| Field | Meaning |
| --- | --- |
| `peer` | The sending page's view id (`v…`). One per open page; new on reload. Key cursors on it; never store it. |
| `by` | The sender's person id (`usr_…`, or `vis_…` for a guest) only when the app declares `user`; otherwise `null`. Resolve it with `user.profiles()`. |
| `isMe`, `sameTab` | Both `true` only for this page. Your other tabs are other peers with `isMe: false`. |
| `kind` | `"viewer"` for a page; `"actor"` for an event the store's actor sent (then `peer` is `"actor"` and `by` is `"store:<id>"`). |
| `guest` | The sender is an anonymous visitor. Display data, not authority. |

### Named rooms

`await room.join(name)` joins a separate room inside the store and resolves
an object with `name`, `emit`, `on`, `presence`, `peers`, `onPeers`,
`connected`, `onConnection` and `leave()`. Only pages that joined the same
name hear it; the lobby stays shared. Joining a name you are already in
returns the same object. Names match `^[a-z0-9][a-z0-9_.-]{0,47}$`; they are
not secret. A page can be in 16 named rooms besides the lobby. `leave()`
drops your presence there and removes your listeners.

### Connection

`connected()` is synchronous. `onConnection(handler)` calls the handler with
the current state, then on every change. When the page reconnects, the
runtime joins its rooms again and re-sends its presence.

### The actor's side

An actor reaches the same lobby with `use('room')` in `actor.js`:
`room.emit(topic, data)` sends after the current turn commits (topic levels
do not apply to the store itself), and `room.peers()` lists the pages open
now. See `slop help actors`.

## How slop differs from claude.ai

| claude.ai | slop |
| --- | --- |
| Only signed-in viewers connect | Anyone who can open the store, guests included |
| Topic levels by role (Contributor, Editor) | By store level (`interact`, `admin`) from grants, links and audiences |
| `isMe` covers all your tabs | `isMe` and `sameTab` both mean this page only |
| `kind: "agent"` for the publishing Claude session | `kind: "actor"` for the store's actor; no agent peer |
| Presence sent about 30 times a second | Sent on every call; throttle it yourself |
| `sendToClaudeSession(data)` stages into the viewer's Claude chat | No chat sits beside a slop page: `canSendToClaudeSession()` resolves `false` (not a status string) and `sendToClaudeSession()` rejects `capability_removed` |

## Limits

| What | Limit |
| --- | --- |
| Event `data` | 4096 bytes of JSON |
| Merged presence | 4096 bytes, 8 levels |
| Declared topics | 16 |
| Named rooms per page | 16 (plus the lobby) |
| Emit rate per page | 40 per second, burst 80; extra events are dropped without an error |
| Topic and room names | 48 characters, see the patterns above |

## Errors

Errors carry `code` and `message`. Listener failures reach `onError`;
without one, a closed room is silent.

| Code | Where | Meaning and what to do |
| --- | --- | --- |
| `invalid_argument` | `emit`, `on`, `presence`, `join` | Bad topic or room name, data or presence too large, not a plain object, or the room was left. Fix the call. |
| `not_permitted` | `emit` | Your level is below the topic's (`topic "reaction" needs interact`). Hide the control; do not retry. |
| `limit_reached` | `join` | Already in 16 named rooms. Leave one. |
| `upstream_error` | `join` | The server did not answer. Safe to retry later. |
| `revoked` | listeners, every call | The view closed (access changed, signed out, expired). Listeners get it through `onError`, `peers()` shrinks to nothing. Render the single-viewer page. |
| `not_granted` | every call | `room` is not declared for this version. |
| `capability_removed` | `sendToClaudeSession` | Not served on slop. |

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `claude.use("room")` is `null` | `room` not declared, or the app is broken | Add `"room": {}`; run `slop app status <store>` |
| `not_permitted` on `emit` for most viewers | The topic is not in `topics`, so it needs `admin` | Add `"topics": {"<name>": "interact"}` and push |
| `not_permitted` even with the topic opened | The viewer's level is `view` | `slop grant set <store> <subject> interact` |
| App broken: `level must be interact or admin` | A topic level like `"view"` | Viewers can only receive; use `interact` or `admin` |
| `by` is always `null` | The app does not declare `user` | Add `"user": {}` |
| Events from before a page opened are missing | Events are never replayed | Keep shared state in `db`; re-send state when `onPeers` reports `joined` |
| Some events never arrive | Sent while disconnected, or over 40/s | Disable the control while `connected()` is false; move high-rate state to presence |
| Everyone's cursor vanished after a deploy | A new snapshot reloads every page | Normal; presence is re-sent as pages come back |
| Two tabs of the same person show as two peers | Each page is its own peer | Group by `by` if you want one entry per person |
| The room goes quiet after access changed | The view was closed (`revoked`) | Pass `onError` to every listener and tell the viewer to reload |

## See Also

- `slop help capability-user` — names and avatars for `by`
- `slop help capability-db` — state that late arrivals must see
- `slop help actors` — `use('room')` from the server side
- `slop help access-control` — levels and grants that decide who may send
- `slop help page-runtime` — `claude.use`, errors, how slop differs
- `slop help app-manifest` — every capability's declaration form
