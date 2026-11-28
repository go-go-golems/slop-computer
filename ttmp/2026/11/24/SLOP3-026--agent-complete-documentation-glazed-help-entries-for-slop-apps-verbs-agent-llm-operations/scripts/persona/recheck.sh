#!/bin/bash
# recheck.sh BATCH SCENARIO: rerun a scenario's checker against a
# finished run's data (a server on the saved data dir, the run's host login).
# For fixing a checker without rerunning the conversation.
set -euo pipefail
cd "$(dirname "$0")"
RUN=$PWD/runs/$1/$2
# The saved login is keyed by the run's server URL: reuse its port.
PORT=$(python3 -c 'import json,sys,re; d=json.load(open(sys.argv[1])); s=json.dumps(d); print(re.search(r"slop\.localhost:(\d+)", s).group(1))' "$RUN/host/creds.json")
"$SLOP_BIN" serve --local --llm fake --admin-email admin@example.com --data "$RUN/data" --listen 127.0.0.1:$PORT >/dev/null 2>&1 &
PID=$!; trap 'kill $PID' EXIT
for i in $(seq 60); do curl -s -o /dev/null -H "Host: slop.localhost:$PORT" http://127.0.0.1:$PORT/readyz && break; sleep 0.25; done
SLOP=$SLOP_BIN SLOP_SERVER=http://slop.localhost:$PORT SLOP_CREDENTIALS=$RUN/host/creds.json XDG_CONFIG_HOME=$RUN/host/config \
  PORT=$PORT RUN=$RUN WORK=$RUN/work SETUP=$PWD/setup bash checks/$2.sh
