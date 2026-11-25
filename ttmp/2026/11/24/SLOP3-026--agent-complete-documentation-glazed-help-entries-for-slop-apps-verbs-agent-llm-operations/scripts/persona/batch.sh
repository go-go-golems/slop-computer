#!/bin/bash
# batch.sh BATCH [CONCURRENCY] [scenario…]: run scenarios in parallel, each on
# its own server port (18701…). Without scenarios: every one not heldOut.
# Needs SLOP_BIN, AGENT_DIR, PW_DIR (and CHROME) as in README.md.
set -euo pipefail
cd "$(dirname "$0")"
B=$1; N=${2:-3}; shift $(( $# >= 2 ? 2 : 1 ))
if [ $# -eq 0 ]; then
  set -- $(for f in scenarios/*.json; do python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("" if d.get("heldOut") else d["id"])' "$f"; done)
fi
mkdir -p "runs/$B"
i=0
for s in "$@"; do
  port=$((18701 + i)); i=$((i + 1))
  echo "node run.mjs $s --slop $SLOP_BIN --port $port --batch $B > runs/$B/$s.log 2>&1 || echo \"$s failed (see runs/$B/$s.log)\""
done | xargs -P "$N" -I{} bash -c '{}'
node summarize.mjs "$B"
