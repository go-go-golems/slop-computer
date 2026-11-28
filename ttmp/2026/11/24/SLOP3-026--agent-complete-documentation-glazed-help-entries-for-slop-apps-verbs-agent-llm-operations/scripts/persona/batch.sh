#!/bin/bash
# batch.sh BATCH [CONCURRENCY] [scenario…]: run scenarios in parallel, each on
# its own server port (PORT_BASE, default 18701, and up). Without scenarios: every one not heldOut.
# Needs SLOP_BIN, AGENT_DIR, PW_DIR (and CHROME) as in README.md.
set -euo pipefail
cd "$(dirname "$0")"
B=$1; N=${2:-3}; shift $(( $# >= 2 ? 2 : 1 ))
if [ $# -eq 0 ]; then
  set -- $(for f in scenarios/*.json; do python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("" if d.get("heldOut") else d["id"])' "$f"; done)
fi
mkdir -p "runs/$B"
export B
i=0
for s in "$@"; do echo "$s $((${PORT_BASE:-18701} + i))"; i=$((i + 1)); done |
  xargs -P "$N" -L 1 bash -c 'node run.mjs "$0" --slop "$SLOP_BIN" --port "$1" --batch "$B" > "runs/$B/$0.log" 2>&1 || echo "$0 failed: runs/$B/$0.log"'
node summarize.mjs "$B"
