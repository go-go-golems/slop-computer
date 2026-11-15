#!/usr/bin/env bash
# SLOP3-022 stage 0: Sitebench's built output, unchanged, as a slop app.
# usage: 01-stage0-sitebench-as-a-slop-app.sh <sitebench/dist> <slop binary>
# Needs a local slop (slop serve --local --llm fake ...) and a CLI login to it
# (SLOP_CREDENTIALS / SLOP_SERVER). Copies dist/ to a scratch folder, adds
# app.json (db, user, sample, downloads), pushes it to store "bench", allows
# sample for @admin and mounts it at /bench on the live host.
set -euo pipefail
dist=$1; slop=$2; live=${LIVE_HOST:-apps.localhost:18490}
work=$(mktemp -d); cp -r "$dist" "$work/bench"
cp "$(dirname "$0")/../various/stage0-app.json" "$work/bench/app.json"
"$slop" store new --id bench --type bench
"$slop" push "$work/bench" --store bench -m "Sitebench dist, unchanged, plus app.json"
"$slop" policy set bench sample @admin on
"$slop" mount set --host "$live" --path /bench --store bench
"$slop" app status bench
echo "open http://$live/bench"
