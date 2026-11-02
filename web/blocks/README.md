# Claude Blocks on slop

Claude Blocks is CC5's computer in Notion's form factor, by Ramon Marc
(https://moldandyeast.com): pages of blocks, every block a live cell in one
Hypha log that people and Claudes write together. It was written as a
claude.ai Artifact; on slop it runs unchanged on the page runtime
(`window.claude`).

| | |
|---|---|
| Source | `~/code/others/ramon/claude-blocks/` (10 files), copied unchanged into `src/` |
| Check | `SHA256SUMS`; `build.sh` refuses to build if a file changed |
| slop additions | `slop/deep-links.js`, added after `blocks.js` by `build.sh`: the open page is the URL's fragment (`/b/ws-team#page_o1p8`), Back and Forward step through pages. Uses only `window.blocks` |
| Manifest | `app.json` (store type `blocks`): db, user (profile), room (`ops` open to interact), sample (images), assets, downloads. `mcp` (the Claude browser) is left out: slop does not serve it, so Blocks hides its browser feature |

```sh
make blocks blocks-push          # build.sh, then slop push web/blocks/dist --store blocks
```

A workspace is a store of type `blocks` running the `blocks` app, opened at
`/b/<workspace>` on the live host (a mount with `--storeParam id --type
blocks --createApp blocks` lets members create one). Its log lives in the
workspace's documents (`chunks/*`, `meta/snap`, `snaps/*`); live ops also
travel on the room's `ops` topic. The deployment script is SLOP3-001's
`scripts/08-deploy-blocks-pinup.sh`; publishing a workspace as web pages is
the `blocks-site` app (`apps/blocks-site`, SLOP3-003).

The page's "README for Claude" (top of `src/index.html`) describes an agent
loop over the documents at `data/users/me/blocks`. v2's `slop data` put the
caller's id in place of `me`; v3's `slop docs` does not, and the loop has
not been tried on v3 yet.
