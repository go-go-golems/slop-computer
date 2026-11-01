#!/bin/sh
# 08-deploy-blocks-pinup.sh <deploy-dir>: push the app folders
# 07-build-blocks-pinup.sh wrote and make instances of them.
#
#   blocks  workspaces at /b/<id> on the live host (type blocks)
#     ws-lobby    guests interact: anyone who opens the link writes
#     ws-scratch  guests interact
#     ws-team     members interact, guests nothing
#   pinup   design files at /p/<id> on the live host (type design)
#     pin-scratch members admin (design), guests interact (feedback)
#     pin-review  guests view, members interact
#
# Pinup lets only editors design: user.canEdit() is the admin level, and
# a guest's level stops at interact. Guests view, present and leave
# feedback. sample is turned on for both apps, guests included on Blocks.
#
# The mounts offer members to create a new instance of the app. Same
# environment as 04-deploy-sources.sh; safe to repeat.
set -eu
deploy=$1
SLOP=${SLOP:-slop}
export SLOP_SERVER=${SLOP_SERVER:-http://slop.localhost:18300}
LIVE_HOST=${LIVE_HOST:-apps.localhost:18300}

app() { # app <store> <dir>
	$SLOP store new "$1" >/dev/null 2>&1 || true
	$SLOP push "$2" --store "$1" -m "deploy from source" -o json |
		python3 -c 'import json,sys; r=json.load(sys.stdin); print("%-12s snapshot %s: %s files" % (sys.argv[1], r["n"], r["files"]))' "$1"
}
instance() { # instance <store> <app> <type> <subject> <level> [<subject> <level>]
	store=$1 a=$2 type=$3
	shift 3
	$SLOP store new "$store" --app "$a" --type "$type" >/dev/null 2>&1 || true
	while [ $# -ge 2 ]; do
		$SLOP grant set "$store" "$1" "$2" >/dev/null
		echo "  $store: $1 $2"
		shift 2
	done
}

app blocks "$deploy/apps/blocks"
for aud in @guest @member @subscriber @admin; do $SLOP policy set blocks sample "$aud" on >/dev/null; done
$SLOP mount set "$LIVE_HOST" /b/:id --storeParam id --type blocks --createApp blocks >/dev/null
instance ws-lobby blocks blocks @guest interact
instance ws-scratch blocks blocks @guest interact
instance ws-team blocks blocks @member interact
echo "  http://$LIVE_HOST/b/ws-lobby"

app pinup "$deploy/apps/pinup"
for aud in @member @subscriber @admin; do $SLOP policy set pinup sample "$aud" on >/dev/null; done
$SLOP mount set "$LIVE_HOST" /p/:id --storeParam id --type design --createApp pinup >/dev/null
instance pin-scratch pinup design @guest interact @member admin
instance pin-review pinup design @guest view @member interact
echo "  http://$LIVE_HOST/p/pin-scratch"
