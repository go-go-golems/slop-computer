#!/usr/bin/env bash
# SLOP3-025: bench's agent on the agent capability, end to end, with the fake model.
# usage: 01-bench-agent-e2e.sh <slop-computer checkout> <scratch dir>
# Builds slop (with the workspace's pinocchio), starts `slop serve --local --llm fake` on :18492,
# logs the CLI in (device login approved by 02-approve-device-login.mjs, playwright on NODE_PATH or
# next to it), pushes and mounts bench, then drives it with SLOP3-024's benchdrive:
#   new app → "/tool eval {...}" → a second message; then inspect <scratch>/data/agent/*.db and llm_holds.
set -euo pipefail
repo=$1; S=$2; mkdir -p "$S"
(cd "$repo" && go build -tags sqlite_fts5 -o "$S/slop" ./cmd/slop)
"$S/slop" serve --local --llm fake --data "$S/data" --listen 127.0.0.1:18492 --admin-email admin@example.com > "$S/server.log" 2>&1 &
until curl -s -o /dev/null http://slop.localhost:18492/; do sleep 0.5; done
export SLOP_CREDENTIALS=$S/creds.json SLOP_SERVER=http://slop.localhost:18492
"$S/slop" auth login --name e2e > "$S/login.log" 2>&1 &
until grep -q 'code=' "$S/login.log"; do sleep 0.2; done
node "$(dirname "$0")/02-approve-device-login.mjs" "$(grep -o 'http[^ ]*device?code=[A-Z0-9-]*' "$S/login.log")"
wait %2 || true
"$S/slop" store new --id bench --type bench
"$S/slop" push "$repo/apps/bench" --store bench -m "bench with the agent capability"
"$S/slop" policy set bench sample @admin on
"$S/slop" llm set @admin on --budget 200000
"$S/slop" app trust bench workshop
"$S/slop" mount set --host apps.localhost:18492 --path /bench --store bench
echo "bench: http://apps.localhost:18492/bench — drive it with benchdrive (BENCHDRIVE_URL default)"
