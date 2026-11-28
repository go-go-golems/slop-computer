#!/usr/bin/env bash
# SLOP3-026: Pinboard's agent panel on the agent capability, end to end, with the fake model.
# usage: 03-pinboard-agent-e2e.sh <slop-computer checkout> <scratch dir>
# Needs playwright importable from this directory (NODE_PATH) and, on arm64, CHROME=<chromium binary>.
# Starts `slop serve --local --llm fake` on :18494, logs the CLI in, pushes Pinboard, allows sample
# for @admin with a budget, makes a board and drives its agent panel (03-pinboard-agent-e2e.mjs).
set -euo pipefail
repo=$1; S=$2; here=$(cd "$(dirname "$0")" && pwd); mkdir -p "$S"
(cd "$repo" && go build -tags sqlite_fts5 -o "$S/slop" ./cmd/slop)
"$S/slop" serve --local --llm fake --data "$S/data" --listen 127.0.0.1:18494 --admin-email admin@example.com > "$S/server.log" 2>&1 &
trap 'kill %1 2>/dev/null || true' EXIT
until curl -s -o /dev/null http://slop.localhost:18494/; do sleep 0.5; done
export SLOP_CREDENTIALS=$S/creds.json SLOP_SERVER=http://slop.localhost:18494 XDG_CONFIG_HOME=$S/config
"$S/slop" auth login --name e2e > "$S/login.log" 2>&1 &
until grep -q 'code=' "$S/login.log"; do sleep 0.2; done
node "$here/02-approve-device-login.mjs" "$(grep -o 'http[^ ]*device?code=[A-Z0-9-]*' "$S/login.log")"
wait %2 || true
"$S/slop" store new pinboard
"$S/slop" push "$repo/apps/pinboard" --store pinboard -m "pinboard e2e"
"$S/slop" policy set pinboard sample @admin on
"$S/slop" llm set @admin on --budget 200000
"$S/slop" store new e2e-board --app pinboard --type pinboard
"$S/slop" mount set --host apps.localhost:18494 --path /pb/:id --storeParam id --type pinboard --createApp pinboard
node "$here/03-pinboard-agent-e2e.mjs" http://apps.localhost:18494/pb/e2e-board "$S"
