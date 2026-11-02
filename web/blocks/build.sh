#!/bin/sh
# Builds Claude Blocks for slop: the upstream files, checked against
# SHA256SUMS (unchanged from the export), plus slop.json, plus slop's own
# additions in slop/ (deep-links.js, loaded after blocks.js). The result is
# what `slop push web/blocks/dist -a blocks` stores.
set -eu
cd "$(dirname "$0")"
(cd src && sha256sum -c --quiet ../SHA256SUMS)
rm -rf dist && mkdir -p dist
cp src/* slop.json slop/*.js dist/
sed -i 's|<script src="blocks.js"></script>|&\n<script src="deep-links.js"></script>|' dist/index.html
grep -q '<script src="deep-links.js"></script>' dist/index.html || { echo "build.sh: no blocks.js script tag in index.html" >&2; exit 1; }
echo "built web/blocks/dist: $(ls src | wc -l) upstream files + slop.json + $(ls slop/*.js | wc -l) slop addition(s)"
