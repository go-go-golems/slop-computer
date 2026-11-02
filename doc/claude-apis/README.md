# Claude artifact APIs, and how slop differs

These four guides describe the `window.claude` runtime that claude.ai serves
to published Artifacts (runtime contract 0.2.75, guides dated 2026-10-10).
They are copied here unchanged so slop's runtime (`web/runtime/src`) can be
checked against them.

| File | Covers |
|---|---|
| [state-storage.md](state-storage.md) | `artifact.publish`, `db` (paths, rules, levels, `acquire`), `assets` |
| [files.md](files.md) | `files` (a Claude Code project's files), `downloads` |
| [people-and-collaboration.md](people-and-collaboration.md) | `user`, `room`, `comments`, `sendToClaudeSession` |
| [sample-spec.md](sample-spec.md) | `sample`, `sample.json`, `sample.limits`, tools, errors |

Claude Blocks (`web/blocks`) and Pinup (`web/pinup`) were written as
claude.ai Artifacts against this contract and run on slop unchanged: every
host call goes through `claude.use(name)`, and both apps treat `null` as
"this feature is off". The table below is what a page sees differently on
slop (as of 2026-11-02, `main` at 1af14cb).

## Capability by capability

| Capability | claude.ai | slop |
|---|---|---|
| `db` | Firestore-like docs and collections, rules with `{self}`, `data/users/<id>/` private, `acquire` leases, listeners | Same surface and limits (`web/runtime/src/db.ts`, `limits.ts`; rules in `pkg/rt/rules.go`). The documents are the store's own. Writes may go over the wire as patches against a known version, which pages don't see. On the static host the runtime serves `db` read-only from the documents baked into the page, and `user` as an anonymous viewer; everything else is `null` (`static.ts`). |
| `user` | `isOwner`, `canEdit`, `can`, `id`, `me`, `profiles`, `search` (scope `profile`), email (scope `email`) | Same calls. `me()` has extra fields: `audience`, `level`, `guest`, `subscribed`, `llm {allowed, remaining}`. The `email` scope works only when the app's policy cell `user.email` is on for the viewer's audience. |
| `room` | `emit`/`on`/`presence`/`onPeers`/`join`; event topics admin-only unless opened in the manifest; `sendToClaudeSession` | Same calls, and topic levels from `room.topics` are enforced (`pkg/server/views.go`). `canSendToClaudeSession` always answers no: no Claude conversation sits beside a slop page. |
| `assets` | upload/list/delete; images, SVG (sanitized), video, PDF, fonts, data, CSS/JS; served at `/_blob/<id>` | Same, except SVG is refused (`unsupported_type`). Served only to viewers at `interact` or above with an id, when the policy cell `assets` allows their audience (members and up by default). |
| `downloads` | `save({filename, data})` behind a confirmation | Same. Extension allow-list, 50 MiB cap, and the shell's confirm dialog. |
| `artifact` (`self`) | `publish(html)` or a files map with `ifMatch`; any Editor | Only the HTML string form (a files map is `invalid_content`). Offered only in the app's own store, and only to a platform admin; publishing replaces the app's entry file for everyone. `edit` is `capability_removed`. `metadata` is a stub. |
| `sample` | Claude, on the viewer's account; tiers, `model`/`effort`, tools, images, `json`, `limits` | Same call shape, but slop's model backend (Pi through LunaRoute; all three tiers are deepseek-4.1-flash with different thinking) runs it, not Claude. A viewer needs an id and the policy cell `sample`. Each call is metered against the person's (or store's) monthly token budget, so a call can fail with `quota_exceeded`. At most 16 tools. Images need `sample: {images: true}` in the manifest. The 5-minute replay cache lives in the page and is skipped with tools, images or `onText`. |
| `comments` | write verbs, `openComposer`, `anchorFor`, `sendToClaude` | Implemented in the runtime, but the server never grants it: `use("comments")` is `null`. Pinup hides comment mode. |
| `files` | read a Claude Code project's files | Not served (`null`). |
| `mcp` | the viewer's claude.ai connectors | Not served (`null`). Blocks hides its browser feature. |
| `permissions` | built in; `state`/`request`/`manage` | Same, with the shell's consent dialog. |
| `slop` | — | slop's own namespace, on every app view: actor `actions`/`call` (with the shell's confirmation flow), read aliases through `stores.open(alias)`, `visitor()`, `signIn()`, `subscribeUrl()`. |

Where claude.ai has viewer roles (Viewer, Commenter, Contributor, Editor,
Owner), slop has store levels (`view` < `interact` < `admin` < `owner`)
from grants, links and audiences (`@guest` ⊆ `@member` ⊆ `@subscriber` ⊆
`@admin`). Rules and topic levels use the same names in both, so manifests
carry over.

## Blocks and Pinup on slop

**Blocks** (`web/blocks`, store type `blocks`, opened at `/b/<workspace>`):
the workspace's Hypha log lives in the store's documents (`chunks/<id>`,
one per open tab, plus the `meta/snap` checkpoint and its `snaps/*` parts).
Live ops also travel on the room's `ops` topic, which the manifest opens to
`interact`. Two `acquire` leases coordinate tabs: `claims/*` (who is
editing what) and `meta/compact` (one tab at a time folds the log into a
new snapshot). Neither app calls `artifact.publish`. It reads `user.me()`, `isOwner()` and `can("data.write")` (read-only
when false), and it uses `sample` (with images), `assets` and `downloads`.
slop adds only `slop/deep-links.js`, which keeps the open page in the URL
fragment.

Blocks publishes as a separate app. `apps/blocks-site` is an actor bound to
a workspace through the read alias `source`. It folds the same log and
serves the pages itself (`/pub/<id>`). Its `publish` action (requires
`admin`) renders every page to static files and pushes them into a store of
type `site` through the trusted `workshop` module, which serves them at
`/s/<id>` on the static host:

```sh
slop bind set team-site source ws-team
slop app trust blocks-site workshop
slop call team-site publish '{"to":"team-static","live":true}'
```

**Pinup** (`web/pinup`, store type `design`, opened at `/p/<file>`): one
document per layer (`nodes/<id>`), plus `meta/file` (pages and tokens),
`feedback/*` and `log/*` (the revertible history). It subscribes to all of
these with `onSnapshot`. `inbox/*` takes HTML that anyone (a person or
Claude) drops in: one editor tab claims each item with `acquire`, imports
it as layers, and deletes it. Presence carries cursors and the current page.
Comments and "send to Claude" are off on slop (see above). Pinup has no
publishing path of its own; a design is shared by granting its store or
making a link (`slop link new <file> view`).
