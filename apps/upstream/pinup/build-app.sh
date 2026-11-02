#!/bin/sh
# Builds Pinup as a slop app folder, dist/app: upstream build.js's
# dist/pinup.html (the published artifact, unchanged) inside the document
# skeleton the Artifact host wrapped it in, plus app.json (store type
# design). The result is what `slop push apps/upstream/pinup/dist/app --store pinup`
# stores. Needs vendor/ installed (cd vendor && npm ci).
set -eu
cd "$(dirname "$0")"
node build.js >/dev/null
rm -rf dist/app && mkdir -p dist/app
{
	printf '%s' '<!doctype html><html lang="en"><head><meta charset="utf-8">'
	printf '%s' '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
	printf '%s' '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>'
	printf '%s\n' '</head><body>'
	cat dist/pinup.html
	printf '\n%s\n' '</body></html>'
} >dist/app/index.html
cp app.json dist/app/
echo "built apps/upstream/pinup/dist/app: $(wc -c <dist/app/index.html) bytes (pinup.html sha256 $(sha256sum dist/pinup.html | cut -c1-16))"
