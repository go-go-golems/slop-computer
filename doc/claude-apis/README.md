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

Claude Blocks (`apps/upstream/blocks`) and Pinup (`apps/upstream/pinup`) were written as
claude.ai Artifacts against this contract and run on slop unchanged: every
host call goes through `claude.use(name)`, and both apps treat `null` as
"this feature is off".

## How slop differs

What a page sees on slop, capability by capability and with the differences
from claude.ai, is in the help pages (checked against the code and run,
SLOP3-026): `slop help page-runtime` for the overview and one page per
capability, `capability-db`, `capability-assets`, `capability-artifact`,
`capability-user`, `capability-room`, `capability-comments`,
`capability-files`, `capability-downloads`, `capability-sample`,
`capability-agent` and `capability-slop`. The table that used to be here had
gone stale (the static host serves no runtime at all; `/_blob/<id>` serves
anyone with the URL; no consent dialog is shown).

## Blocks and Pinup on slop

**Blocks** (`apps/upstream/blocks`, store type `blocks`, opened at `/b/<workspace>`):
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

**Pinup** (`apps/upstream/pinup`, store type `design`, opened at `/p/<file>`): one
document per layer (`nodes/<id>`), plus `meta/file` (pages and tokens),
`feedback/*` and `log/*` (the revertible history). It subscribes to all of
these with `onSnapshot`. `inbox/*` takes HTML that anyone (a person or
Claude) drops in: one editor tab claims each item with `acquire`, imports
it as layers, and deletes it. Presence carries cursors and the current page.
Comments and "send to Claude" are off on slop (see above). Pinup has no
publishing path of its own; a design is shared by granting its store or
making a link (`slop link new <file> view`).
