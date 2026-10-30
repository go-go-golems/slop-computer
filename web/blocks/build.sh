#!/bin/sh
# Builds Claude Blocks for slop: the upstream files, checked against
# SHA256SUMS (unchanged from the export), plus slop.json. The result is
# what `slop push web/blocks/dist -a blocks` stores.
set -eu
cd "$(dirname "$0")"
(cd src && sha256sum -c --quiet ../SHA256SUMS)
rm -rf dist && mkdir -p dist
cp src/* slop.json dist/
echo "built web/blocks/dist: $(ls src | wc -l) upstream files + slop.json"
