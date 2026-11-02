#!/bin/sh
# 07-build-blocks-pinup.sh <slop-computer>/web <out-dir>: Claude Blocks and
# Pinup as v3 app folders, from their upstream sources. Both were written
# as claude.ai Artifacts and use only the contract (claude.use), which v3
# serves, so neither is changed:
#
#   blocks/  web/blocks/src/* (checked against SHA256SUMS) + app.json,
#            plus slop's additions in web/blocks/slop/ (deep-links.js,
#            loaded after blocks.js: the page is the URL's fragment)
#   pinup/   upstream build.js's dist/pinup.html (the published artifact)
#            in the document skeleton the Artifact host wrapped it in,
#            + app.json. v2's slop/js layer (Workshop publishing through
#            the slop management permissions) is not used: v3 has no
#            Workshop.
#
# Each app.json names the store type its instances have: blocks for a
# workspace, design for a Pinup file.
set -eu
web=$(cd "$1" && pwd)
out=$2
mkdir -p "$out"
rm -rf "$out/blocks" "$out/pinup"
mkdir "$out/blocks" "$out/pinup"

(cd "$web/blocks/src" && sha256sum -c --quiet ../SHA256SUMS)
cp "$web/blocks/src/"* "$out/blocks/"
if [ -d "$web/blocks/slop" ]; then
	cp "$web/blocks/slop/"*.js "$out/blocks/"
	sed -i 's|<script src="blocks.js"></script>|&\n<script src="deep-links.js"></script>|' "$out/blocks/index.html"
	grep -q '<script src="deep-links.js"></script>' "$out/blocks/index.html"
fi
cat >"$out/blocks/app.json" <<'EOF'
{
  "title": "Claude Blocks",
  "type": "blocks",
  "capabilities": {
    "db": {},
    "user": { "scopes": ["profile"] },
    "room": { "topics": { "ops": "interact" } },
    "sample": { "images": true },
    "assets": {},
    "downloads": true
  }
}
EOF

(cd "$web/pinup" && node build.js >/dev/null)
{
	printf '%s' '<!doctype html><html lang="en"><head><meta charset="utf-8">'
	printf '%s' '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
	printf '%s' '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>'
	printf '%s\n' '</head><body>'
	cat "$web/pinup/dist/pinup.html"
	printf '\n%s\n' '</body></html>'
} >"$out/pinup/index.html"
cat >"$out/pinup/app.json" <<'EOF'
{
  "title": "Pinup",
  "type": "design",
  "capabilities": {
    "db": {},
    "user": { "scopes": ["profile"] },
    "room": {},
    "comments": {},
    "assets": {},
    "downloads": true,
    "sample": {}
  }
}
EOF
echo "blocks: $(ls "$web/blocks/src" | wc -l) upstream files; pinup: $(wc -c <"$out/pinup/index.html") bytes (pinup.html sha256 $(sha256sum "$web/pinup/dist/pinup.html" | cut -c1-16))"
