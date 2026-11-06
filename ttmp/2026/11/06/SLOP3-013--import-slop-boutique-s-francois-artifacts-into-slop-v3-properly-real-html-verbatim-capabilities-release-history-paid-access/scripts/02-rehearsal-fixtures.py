#!/usr/bin/env python3
"""SLOP3-013: recreate production's release stores, as SLOP3-004 left them, on a
local slop (slop serve --local), so 03-import.py can be rehearsed.

usage: SLOP_CREDENTIALS=local-creds.json 02-rehearsal-fixtures.py <inventory.json> <live-host> id [id…]

For each artifact id, as 04-build-import.py and 06-push-import.py did:
store <id> of type release; index.html = the latest published release's HTML
for free samples, a placeholder page for paid ones (the API import could not
fetch those); app.json with the capability names mapped through CAP_BLOCK;
the attachments; grant @guest interact; sample on for member, subscriber and
admin; and the /f/:id --type release mount. Bytes come from the francois pod
(read-only) through 03-import.py's blob cache. Refuses a non-local server.
"""
import importlib.util
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("imp", HERE / "03-import.py")
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)

CAP_BLOCK = {"downloads": True, "user": {"scopes": ["profile"]}}  # 04-build-import.py
PLACEHOLDER = ("<!doctype html><html><head><meta charset=\"utf-8\"><title>{t}</title></head>"
               "<body><h1>{t}</h1><p>This release is not available as a free sample.</p></body></html>\n")


def main(inventory, live, ids):
    slop = imp.Slop()
    if "localhost" not in slop.server and "127.0.0.1" not in slop.server:
        sys.exit(f"refusing to make fixtures on {slop.server}")
    inv = json.load(open(inventory))
    blobs = imp.Blobs(pathlib.Path(imp.os.environ.get("TMPDIR", "/tmp")) / "slop3-013-blobs", None)
    arts = {a["id"]: a for a in inv["artifacts"]}
    slop("mount.set", {"host": live, "path": "/f/:id", "storeParam": "id", "type": "release"})
    for aid in ids:
        art = arts[aid]
        pub = [r for r in inv["releases"] if r["artifact"] == aid and r["state"] == "published"]
        rel = pub[-1]
        h = imp.html_of(rel)
        files = []
        if rel["freeSample"]:
            blobs.get(h["sha256"], h["storageKey"], h["size"])
            files.append({"path": "index.html", "sha256": h["sha256"], "size": h["size"]})
        else:
            files.append({"path": "index.html", "text": PLACEHOLDER.format(t=art["title"])})
        for a in rel["attachments"]:
            blobs.get(a["sha256"], a["storageKey"], a["size"])
            files.append({"path": "attachments/" + imp.safe_name(a["name"]), "sha256": a["sha256"], "size": a["size"]})
        caps = {c: CAP_BLOCK.get(c, {}) for c in rel["manifest"]}
        files.append({"path": "app.json", "text": json.dumps({"title": art["title"], "capabilities": caps},
                                                             ensure_ascii=False, indent=2) + "\n"})
        slop("store.new", {"id": aid, "type": "release"}) if not any(s["id"] == aid for s in slop("store.ls", {"all": True})) else None
        keys = {x["sha256"]: x["storageKey"] for x in [h, *rel["attachments"]]}
        tree = {f["path"]: (dict(f, key=keys[f["sha256"]]) if "sha256" in f else f) for f in files}
        res, sent = imp.push(slop, blobs, aid, tree, f"imported from v2 ({rel['id']})")
        slop("grant.set", {"store": aid, "subject": "@guest", "level": "interact"})
        for aud in ("member", "subscriber", "admin"):
            slop("policy.set", {"app": aid, "capability": "sample", "audience": aud, "value": "on"})
        print(f"{aid:30} snapshot {res.get('n')} ({'free' if rel['freeSample'] else 'placeholder'}; {sent:,} B)")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
