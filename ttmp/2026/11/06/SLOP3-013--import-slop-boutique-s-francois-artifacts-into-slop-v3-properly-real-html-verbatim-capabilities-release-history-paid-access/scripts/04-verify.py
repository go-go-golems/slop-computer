#!/usr/bin/env python3
"""SLOP3-013: check slop's release stores against francois's inventory.

usage: 04-verify.py <inventory.json> <live-origin> [--only id,id] [--json out.json]

For every artifact with a published release (reads only):
  tree    files.ls equals 03-import.py's desired tree (path and sha256)
  main    snap.ls/ref.ls: main's snapshot message names the latest release
  grants  @guest interact for free samples; @subscriber interact, no @guest, for paid
  access  an anonymous visitor opens the app as the mount's shell does
          (POST <live-origin>/_site/views {path}): free → 200 at main's
          snapshot; paid → 401. One cookie jar, so the run makes one visitor;
          each view is closed again (DELETE /_site/views/<id>).
Exits non-zero when any check fails.
"""
import argparse
import collections
import http.cookiejar
import importlib.util
import json
import pathlib
import sys
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("imp", HERE / "03-import.py")
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)


JAR = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def open_view(live, path):
    req = urllib.request.Request(f"{live}/_site/views", data=json.dumps({"path": path}).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with JAR.open(req, timeout=60) as r:
            body = json.load(r)
            code = r.status
    except urllib.error.HTTPError as e:
        return e.code, (json.load(e).get("error") or {}).get("code"), None
    if body.get("view"):
        try:
            JAR.open(urllib.request.Request(f"{live}/_site/views/{body['view']}", method="DELETE"), timeout=30).close()
        except urllib.error.HTTPError:
            pass
    return code, None, body.get("version")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inventory")
    ap.add_argument("live")
    ap.add_argument("--only", default="")
    ap.add_argument("--json")
    a = ap.parse_args()
    inv = json.load(open(a.inventory))
    only = {s for s in a.only.split(",") if s}
    slop = imp.Slop()
    rels = collections.defaultdict(list)
    for r in inv["releases"]:
        if r["state"] == "published":
            rels[r["artifact"]].append(r)
    rows, failed = [], 0
    for art in inv["artifacts"]:
        sid = art["id"].replace("_", "-")
        if (only and sid not in only) or not rels.get(art["id"]):
            continue
        main = rels[art["id"]][-1]
        paid = not main["freeSample"]
        want = {p: e["sha256"] for p, e in imp.desired_tree(art, main).items()}
        have = {f["path"]: f["sha256"] for f in slop("files.ls", {"store": sid}) if f.get("zone", "tree") == "tree"}
        refs = slop("ref.ls", {"store": sid}) or {}
        snap = next((s for s in slop("snap.ls", {"store": sid}) if s["n"] == refs.get("main")), {})
        grants = {g["subject"]: g["level"] for g in slop("grant.ls", {"store": sid}) if g["subject"] in imp.SUBJECTS}
        want_g = {"@subscriber": "interact"} if paid else {"@guest": "interact"}
        code, err, version = open_view(a.live, f"/f/{sid}/")
        checks = {
            "tree": want == have,
            "main": main["id"] in snap.get("message", ""),
            "grants": grants == want_g,
            "access": (code == 401) if paid else (code == 200 and version == refs.get("main")),
        }
        ok = all(checks.values())
        failed += not ok
        rows.append({"store": sid, "release": main["id"], "paid": paid, "main": refs.get("main"),
                     "status": code, "error": err, "version": version, **checks})
        if not ok:
            print(f"FAIL {sid}: {checks} status={code} {err or ''} version={version} main={refs.get('main')}")
    by = collections.Counter(("paid" if r["paid"] else "free", r["status"]) for r in rows)
    print(f"{len(rows)} stores, {failed} failing; anonymous view status: {dict(by)}")
    if a.json:
        json.dump(rows, open(a.json, "w"), indent=1)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
