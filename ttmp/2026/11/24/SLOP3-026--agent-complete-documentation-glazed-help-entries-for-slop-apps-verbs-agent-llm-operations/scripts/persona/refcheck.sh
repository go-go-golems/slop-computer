#!/bin/bash
# refcheck.sh SCENARIO DEPLOY-CMDS: prove a checker. Deploys a reference app
# (built from the help's own example) on the scenario's dry run (runs/dry/,
# from run.mjs --dry), then runs the checker: every check must pass.
# Needs SLOP_BIN, PW_DIR, CHROME. Not while a batch uses the same port.
set -u
cd "$(dirname "$0")"; RUN=$PWD/runs/dry/$1
PORT=$(python3 -c 'import json,sys,re; print(re.search(r"slop\.localhost:(\d+)", open(sys.argv[1]).read()).group(1))' "$RUN/host/creds.json")
"$SLOP_BIN" serve --local --llm fake --admin-email admin@example.com --data "$RUN/data" --listen 127.0.0.1:$PORT >/dev/null 2>&1 & PID=$!
for i in $(seq 60); do curl -s -o /dev/null -H "Host: slop.localhost:$PORT" http://127.0.0.1:$PORT/readyz && break; sleep 0.25; done
export SLOP=$SLOP_BIN SLOP_SERVER=http://slop.localhost:$PORT SLOP_CREDENTIALS=$RUN/host/creds.json XDG_CONFIG_HOME=$RUN/host/config PORT RUN WORK=$RUN/work SETUP=$PWD/setup
bash -c "$2" >/dev/null 2>$RUN/ref-deploy.err || { echo "deploy failed:"; cat $RUN/ref-deploy.err; }
bash checks/$1.sh 2>&1 | python3 -c 'import json,sys
for l in sys.stdin:
    try: c=json.loads(l); print(("  PASS " if c["ok"] else "  FAIL ")+c["check"]+": "+c["detail"][:150].replace("\n"," / "))
    except Exception: print("  ??", l.rstrip()[:200])'
kill $PID
