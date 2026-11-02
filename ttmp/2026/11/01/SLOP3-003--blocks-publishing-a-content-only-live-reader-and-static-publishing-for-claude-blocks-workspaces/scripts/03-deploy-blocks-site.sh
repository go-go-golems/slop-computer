#!/bin/sh
# 03-deploy-blocks-site.sh <slop-v3 repo>: install apps/blocks-site on a
# running server and publish the demo workspace ws-team through it.
#
#   SLOP_CREDENTIALS=<admin creds> 03-deploy-blocks-site.sh <repo>
#
# Admin, once per server: push the app, trust it with the workshop module,
# mount readers at /pub/:id (live host) and static sites at /s/:id (static
# host). Then, as any member could for a workspace they administer: a site
# for ws-team (team-site), public, and a static store for its snapshots
# (team-static), public. The binding shares ws-team's uploads (the admin
# administers both stores), so pictures are published too. Safe to repeat.
set -eu
repo=$(cd "$1" && pwd)
SLOP=${SLOP:-$repo/slop}
export SLOP_SERVER=${SLOP_SERVER:-http://slop.localhost:18300}
LIVE_HOST=${LIVE_HOST:-apps.localhost:18300}
STATIC_HOST=${STATIC_HOST:-site.localhost:18300}

$SLOP store new blocks-site >/dev/null 2>&1 || true
$SLOP push "$repo/apps/blocks-site" --store blocks-site -m "deploy from source" >/dev/null
$SLOP app trust blocks-site workshop >/dev/null
$SLOP mount set "$LIVE_HOST" /pub/:id --storeParam id --type blocks-site >/dev/null
$SLOP mount set "$STATIC_HOST" /s/:id --storeParam id --type site >/dev/null

$SLOP store new team-site --app blocks-site --type blocks-site >/dev/null 2>&1 || true
$SLOP bind set team-site source ws-team --assets true >/dev/null
$SLOP grant set ws-team store:team-site view >/dev/null
$SLOP grant set team-site @guest view >/dev/null
$SLOP store new team-static --type site >/dev/null 2>&1 || true
$SLOP grant set team-static @guest view >/dev/null
$SLOP call team-site configure '{"to":"team-static"}' >/dev/null

echo "reader:   http://$LIVE_HOST/pub/team-site/"
echo "settings: http://$LIVE_HOST/pub/team-site/_site (admins)"
echo "static:   http://$STATIC_HOST/s/team-static/ (after publishing)"
