#!/usr/bin/env python3
"""Export what v2 served on slop.yolo.scapegoat.dev, for the v3 import.

usage: 03-export-v2.py <out-dir>

Reads v2's Postgres database (read-only, through kubectl exec into
postgres/postgres-0) and writes <out-dir>/v2.json: every artifact with its
main version's manifest and files (path, sha256, size, media type), the
routes and the users. The files' bytes stay where they are, in v2's blob
store on the slop volume (/var/lib/slop/blobs, same layout as v3's): only
the small text files the site build reads (pages, styles, catalog records,
tokens) are copied to <out-dir>/blobs/<sha256>, through kubectl exec into
the running slop pod.
"""
import json
import pathlib
import subprocess
import sys

QUERY = r"""
SELECT json_build_object(
  'artifacts', (SELECT json_agg(json_build_object(
      'id', a.id, 'title', a.title, 'kind', a.kind, 'type', a.type,
      'n', r.n, 'manifest', v.manifest::json,
      'files', (SELECT json_agg(json_build_object('path', f.path, 'sha256', f.sha256, 'size', f.size, 'type', f.media_type) ORDER BY f.path)
                FROM version_files f WHERE f.artifact_id = a.id AND f.n = r.n))
      ORDER BY a.created_at)
    FROM artifacts a JOIN refs r ON r.artifact_id = a.id AND r.name = 'main'
    JOIN versions v ON v.artifact_id = a.id AND v.n = r.n),
  'routes', (SELECT json_agg(json_build_object('host', host, 'path', path, 'page', page, 'version', version,
      'bindings', bindings::json, 'access', access, 'live', live)) FROM routes),
  'users', (SELECT json_agg(json_build_object('email', email, 'name', display_name, 'role', role)) FROM users))
"""

# Text files the site build needs (everything else is pushed by hash).
SMALL = ("storefront", "storefront-entry", "francois-catalog", "francois-creators", "lab-tokens")


def sh(args, **kw):
    return subprocess.run(args, check=True, capture_output=True, **kw).stdout


def main(out):
    out = pathlib.Path(out)
    (out / "blobs").mkdir(parents=True, exist_ok=True)
    raw = sh(["kubectl", "-n", "postgres", "exec", "-i", "postgres-0", "--", "sh", "-c",
              'psql -U "$POSTGRES_USER" -d slop -At -f -'], input=QUERY.encode())
    data = json.loads(raw)
    (out / "v2.json").write_text(json.dumps(data, indent=1, ensure_ascii=False))
    n = 0
    for a in data["artifacts"]:
        if a["id"] not in SMALL:
            continue
        for f in a["files"] or []:
            dest = out / "blobs" / f["sha256"]
            if dest.exists():
                continue
            s = f["sha256"]
            dest.write_bytes(sh(["kubectl", "-n", "slop", "exec", "deploy/slop", "--", "cat", f"/var/lib/slop/blobs/blobs/{s[:2]}/{s}"]))
            n += 1
    kinds = {}
    for a in data["artifacts"]:
        kinds[a["kind"]] = kinds.get(a["kind"], 0) + 1
    print(f"{len(data['artifacts'])} artifacts {kinds}, {len(data['routes'])} routes, {len(data['users'])} users; {n} text files copied")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
