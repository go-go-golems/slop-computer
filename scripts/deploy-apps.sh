#!/bin/sh
# deploy-apps.sh [<slop-computer checkout>] (make deploy-apps): install the apps that ship
# with slop, Blocks and Pinup, and the examples on a v3 server, with their
# mounts. Uses the default login (an admin token with the admin scope);
# SLOP_SERVER, LIVE_HOST and STATIC_HOST name the server. Safe to repeat:
# store.new on an existing store fails and is skipped, push sends only
# changed bytes, mounts and grants are set again.
#
#   live host                         static host
#   /workshop      Workshop (admins)  /s/:id      published Blocks sites
#   /office        back office app    /examples/static-site
#   /b/:id         Blocks workspaces (members create them)
#   /p/:id         Pinup designs (members create them)
#   /pub/:id       Blocks sites (readers)
#   /guestbook     example (guests sign)
#   /journal       example (members)
#
# Unlike SLOP3-001's demo scripts, no open workspaces are created: guests
# get nothing they did not get a link to.
set -eu
repo=$(cd "${1:-$(dirname "$0")/..}" && pwd)
SLOP=${SLOP:-slop}
export SLOP_SERVER=${SLOP_SERVER:-https://slop.yolo.scapegoat.dev}
LIVE_HOST=${LIVE_HOST:-apps.slop.yolo.scapegoat.dev}
STATIC_HOST=${STATIC_HOST:-site.slop.yolo.scapegoat.dev}

app() { # app <store> <dir>
	$SLOP store new "$1" >/dev/null 2>&1 || true
	$SLOP push "$2" --store "$1" -m "deploy from source $(git -C "$repo" rev-parse --short HEAD)" -o json |
		python3 -c 'import json,sys; r=json.load(sys.stdin); print("%-14s snapshot %s: %s files" % (sys.argv[1], r["n"], r["files"]))' "$1"
}

# The apps that ship with slop (trusted with their Go modules).
app workshop "$repo/apps/workshop"
$SLOP app trust workshop workshop >/dev/null
$SLOP mount set "$LIVE_HOST" /workshop workshop >/dev/null
app backoffice "$repo/apps/backoffice"
$SLOP app trust backoffice system >/dev/null
$SLOP mount set "$LIVE_HOST" /office backoffice >/dev/null
app blocks-site "$repo/apps/blocks-site"
$SLOP app trust blocks-site workshop >/dev/null
$SLOP mount set "$LIVE_HOST" /pub/:id --storeParam id --type blocks-site >/dev/null
$SLOP mount set "$STATIC_HOST" /s/:id --storeParam id --type site >/dev/null

# Claude Blocks and Pinup, built from their upstream sources by their own
# build scripts (Pinup needs apps/upstream/pinup/vendor installed: npm ci).
"$repo/apps/upstream/blocks/build.sh" >/dev/null
"$repo/apps/upstream/pinup/build-app.sh" >/dev/null
app blocks "$repo/apps/upstream/blocks/dist"
for aud in @guest @member @subscriber @admin; do $SLOP policy set blocks sample "$aud" on >/dev/null; done
$SLOP mount set "$LIVE_HOST" /b/:id --storeParam id --type blocks --createApp blocks >/dev/null
app pinup "$repo/apps/upstream/pinup/dist/app"
for aud in @member @subscriber @admin; do $SLOP policy set pinup sample "$aud" on >/dev/null; done
$SLOP mount set "$LIVE_HOST" /p/:id --storeParam id --type design --createApp pinup >/dev/null

# The examples.
app guestbook "$repo/apps/examples/guestbook"
$SLOP grant set guestbook @guest interact >/dev/null
$SLOP mount set "$LIVE_HOST" /guestbook guestbook >/dev/null
app journal "$repo/apps/examples/journal"
$SLOP grant set journal @member interact >/dev/null
$SLOP mount set "$LIVE_HOST" /journal journal >/dev/null
app static-site "$repo/apps/examples/static-site"
$SLOP grant set static-site @guest view >/dev/null
$SLOP mount set "$STATIC_HOST" /examples/static-site static-site >/dev/null

$SLOP mount ls -o json | python3 -c 'import json,sys; [print("  %-60s %s" % (r["url"], r["mount"].get("store") or "(store per :" + r["mount"].get("storeParam", "") + ")")) for r in json.load(sys.stdin)]'
