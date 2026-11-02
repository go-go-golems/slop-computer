# Vendored Claude Blocks libraries

`hypha.js`, `fruit.js` and `blocks-kit.js` are copied unchanged from
`apps/upstream/blocks/src` (then `web/blocks/src`, commit 9cf5485).
`SHA256SUMS` holds their lines from `apps/upstream/blocks/SHA256SUMS`;
check with `sha256sum -c SHA256SUMS` in this folder.

The blocks-site actor loads them in this order (`lib/blocks.js`), as the
editor's `index.html` does: the kernel, then Fruit, then the block kit,
which registers the block kinds' positional props the fold depends on.
They are used for folding and for evaluating props and formulas only. The
renderer is `lib/render.js`: `Blocks.tokens` does not return on text with
a bold, italic or struck span when called directly (see SLOP3-003,
`scripts/01-load-blocks-libs.mjs`), so the renderer has its own tokenizer.

Do not edit these files. To update, copy the new upstream files and their
checksum lines together.
