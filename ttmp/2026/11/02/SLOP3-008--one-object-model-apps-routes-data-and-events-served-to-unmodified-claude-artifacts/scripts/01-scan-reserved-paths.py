#!/usr/bin/env python3
"""01-scan-reserved-paths.py: read-only scan of every store on the server the
slop CLI is logged in to, for documents whose first path segment starts with
"_" (the names SLOP3-008 reserves for the platform). Prints one line per
store with any, and a summary. Needs an admin token (sql.query, store.ls --all)."""
import json
import subprocess
import sys

def slop(verb, args):
    r = subprocess.run(["slop", *verb.split(), "--json", json.dumps(args), "-o", "json"], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{verb} {args}: {r.stderr.strip() or r.stdout.strip()}")
    return json.loads(r.stdout)

stores = [s["id"] for s in slop("store ls", {"all": True})]
hits, failed = {}, []
for sid in stores:
    try:
        rows = slop("sql query", {"store": sid, "sql": "SELECT path, body IS NULL AS deleted FROM _docs WHERE path LIKE '\\_%' ESCAPE '\\' ORDER BY path LIMIT 50"})
    except RuntimeError as e:
        failed.append((sid, str(e)[:120]))
        continue
    if rows:
        hits[sid] = rows
for sid, rows in hits.items():
    live = [r["path"] for r in rows if not r["deleted"]]
    print(f"{sid}: {len(rows)} path(s), {len(live)} live: {', '.join(live[:5])}")
for sid, err in failed:
    print(f"FAILED {sid}: {err}")
print(f"scanned {len(stores) - len(failed)}/{len(stores)} stores; {len(hits)} with top-level _ paths")
sys.exit(1 if failed else 0)
