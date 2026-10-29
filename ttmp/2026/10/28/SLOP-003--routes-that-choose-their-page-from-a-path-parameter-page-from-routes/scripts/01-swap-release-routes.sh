#!/usr/bin/env bash
# Replace the per-release /r/<page> routes with one page-from route.
# Needs a slop server with page-from routes (SLOP-003) and an admin login
# (SLOP_SERVER / SLOP_CONFIG_DIR as for any slop command).
#   HOST=site.slop.yolo.scapegoat.dev ./01-swap-release-routes.sh
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
tsv=$(ls "$here"/../SLOP-002--*/various/agent-import/release-routes.tsv)
host=${HOST:?set HOST to the site host}
slop=${SLOP:-slop}

# 1. The else page, in project francois.
work=$(mktemp -d)
cp "$here/various/release-missing/index.html" "$work/"
(cd "$work" && "$slop" push . -a release-missing --project francois --title "No such release" -m "else page for /r/:page")

# 2. The page-from route. Static /r/<page> routes are more specific and keep
#    winning until they are removed, so the order of 2 and 3 doesn't matter.
"$slop" route set /r/:page release-missing --page-from '{page}' --host "$host" --note "one route for all releases (SLOP-003)"

# 3. Remove the static routes.
while IFS=$'\t' read -r rpath _; do
  "$slop" route rm "$rpath" --host "$host" >/dev/null
done < "$tsv"

# 4. Check.
fails=0
while IFS=$'\t' read -r rpath _; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$host$rpath")
  [ "$code" = 200 ] || { echo "FAIL $rpath $code"; fails=$((fails+1)); }
done < "$tsv"
echo "nope: $(curl -s -o /dev/null -w '%{http_code}' "https://$host/r/nope") (want 404); failures: $fails"
