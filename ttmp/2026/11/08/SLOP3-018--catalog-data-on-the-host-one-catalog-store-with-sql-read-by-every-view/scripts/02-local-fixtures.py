#!/usr/bin/env python3
"""SLOP3-018: what 01-import-catalog.py reads from the host, on a local slop,
to rehearse the build-from-host path (and 03-import.py --catalog).

usage: SLOP_CREDENTIALS=local-creds.json 02-local-fixtures.py <inventory.json> <catalog.json> id [id…]

Creates (or updates) on the local server only:
  boutique                       a store with _data/francois-catalog.json: each
                                 item's cover and featured flag from catalog.json
  <id> (type release)            francois.json as SLOP3-013's 03-import.py
                                 writes it (its provenance()), for the latest
                                 published release in the inventory, plus a
                                 placeholder index.html and app.json
No release bytes are fetched: build() reads only francois.json. Refuses a
non-local server.
"""
import importlib.util
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve()
found = sorted(HERE.parents[5].glob("2026/*/*/SLOP3-013*/scripts/03-import.py"))
spec = importlib.util.spec_from_file_location("imp", found[0])
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)


def main(inventory, catalog, ids):
    slop = imp.Slop()
    if "localhost" not in slop.server and "127.0.0.1" not in slop.server:
        sys.exit(f"refusing to make fixtures on {slop.server}")
    inv, cat = json.load(open(inventory)), json.load(open(catalog))
    have = {s["id"] for s in slop("store.ls", {"all": True})}
    recs = [{"id": i["id"], "cover": i["cover"], "featured": i["featured"]} for i in cat["items"] if i.get("cover") or i.get("featured")]
    if "boutique" not in have:
        slop("store.new", {"id": "boutique"})
    slop("files.push", {"store": "boutique", "files": [{"path": "_data/francois-catalog.json", "text": json.dumps(recs)}],
                        "message": "SLOP3-018 fixture: covers"})
    arts = {a["id"]: a for a in inv["artifacts"]}
    for aid in ids:
        art = arts[aid]
        pub = [r for r in inv["releases"] if r["artifact"] == aid and r["state"] == "published"]
        if not pub:
            print(f"{aid}: no published release; skipped")
            continue
        rel = pub[-1]
        sid = aid.replace("_", "-")
        if sid not in have:
            slop("store.new", {"id": sid, "type": "release"})
        slop("files.push", {"store": sid, "message": "SLOP3-018 fixture", "files": [
            {"path": "francois.json", "text": imp.jtext(imp.provenance(art, rel))},
            {"path": "app.json", "text": json.dumps({"title": art["title"], "page": "index.html"})},
            {"path": "index.html", "text": f"<!doctype html><title>{art['title']}</title><p>fixture</p>\n"}]})
        print(f"{sid}: {rel['version']} ({art.get('visibility')})")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
