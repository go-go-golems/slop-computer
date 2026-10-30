# Claude Blocks on slop

Claude Blocks is CC5's computer in Notion's form factor, by Ramon Marc
(https://moldandyeast.com): pages of blocks, every block a live cell in one
Hypha log that people and Claudes write together. It was written as a
claude.ai Artifact; on slop it runs unchanged on the native runtime
(SLOP-009).

| | |
|---|---|
| Source | `~/code/others/ramon/claude-blocks/` (10 files), copied unchanged into `src/` |
| Check | `SHA256SUMS`; `build.sh` refuses to build if a file changed |
| Manifest | `slop.json`: db, user (profile), room (`ops` open to interact), sample (images), assets, downloads. `mcp` (the Claude browser) is left out: slop does not serve it, so Blocks hides its browser feature |

```sh
make blocks blocks-push          # build.sh, then slop push web/blocks/dist -a blocks
```

A workspace is a data artifact with `app = blocks` (Workshop ▸ Artifacts ▸
*New with an app…*), opened at `/run/<workspace>`. Its log lives in the
workspace's db (`chunks/*`, `meta/snap`, `snaps/*`); live ops also travel on
the room's `ops` topic.

An agent follows the page's "README for Claude" (top of `src/index.html`)
with `slop data`:

```sh
slop data get ws-team data/users/me/blocks                         # the view: tree, pages, holes, focus, next
slop data set ws-team data/users/me/blocks/turns/<next> --data '{"text": "<Hypha lines>"}'
```
