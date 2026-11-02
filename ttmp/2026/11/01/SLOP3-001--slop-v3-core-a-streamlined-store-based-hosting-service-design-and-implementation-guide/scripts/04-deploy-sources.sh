#!/bin/sh
# 04-deploy-sources.sh <deploy-dir>: push the folders 02-build-boutique.py
# and 03-build-francois.py wrote, with the slop CLI, and publish them.
#
#   <deploy-dir>/boutique        -> store boutique, / on the boutique host
#   <deploy-dir>/francois/<app>  -> store <app>, /f/<app> on the live host
#                                   (or the static host: no capabilities)
#
# SLOP_CREDENTIALS must name an admin login (never the real one in tests);
# SLOP_SERVER, BOUTIQUE_HOST, LIVE_HOST and STATIC_HOST default to the
# local demo server. Every step is safe to repeat: store.new on an existing
# store fails and is skipped, push sends only changed bytes.
set -eu
deploy=$1
SLOP=${SLOP:-slop}
export SLOP_SERVER=${SLOP_SERVER:-http://slop.localhost:18300}
BOUTIQUE_HOST=${BOUTIQUE_HOST:-boutique.localhost:18300}
LIVE_HOST=${LIVE_HOST:-apps.localhost:18300}
STATIC_HOST=${STATIC_HOST:-site.localhost:18300}

publish() { # publish <store> <dir> <host> <path> <guest-level>
	$SLOP store new "$1" >/dev/null 2>&1 || true
	$SLOP push "$2" --store "$1" -m "deploy from source" -o json |
		python3 -c 'import json,sys; r=json.load(sys.stdin); print("%-24s snapshot %s: %s files, %s removed" % (sys.argv[1], r["n"], r["files"], r["removed"]))' "$1"
	$SLOP grant set "$1" @guest "$5" >/dev/null
	$SLOP mount set "$3" "$4" "$1" >/dev/null
	echo "  http://$3$4"
}

publish boutique "$deploy/boutique" "$BOUTIQUE_HOST" / view
for d in "$deploy"/francois/*/; do
	app=$(basename "$d")
	if python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("capabilities") else 1)' "$d/app.json"; then
		publish "$app" "$d" "$LIVE_HOST" "/f/$app" interact
	else
		publish "$app" "$d" "$STATIC_HOST" "/f/$app" view
	fi
done
