#!/usr/bin/env python3
"""Push 04-build-import.py's manifests to a v3 server and mount them.

usage: 06-push-import.py <import-dir> [<live-host> <static-host>]

Uses the default login of the slop CLI ($SLOP_CREDENTIALS or
~/.config/slop/credentials.json; an admin token with the admin scope). The
token is read, never printed. Run 05-copy-blobs.sh first: the manifests
name v2's files by hash. Safe to repeat.

  apps/<id>  store <id> of type release, guests interact, sample on for
             members and up; served by the one /f/:id --type release
             mount on the live host (SLOP3-006)
  site       store boutique, guests view, mounted at / on the static host
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request


def login():
    path = os.environ.get("SLOP_CREDENTIALS") or os.path.expanduser("~/.config/slop/credentials.json")
    creds = json.load(open(path))
    server = os.environ.get("SLOP_SERVER") or creds["default"]
    return server, creds["servers"][server]["token"]


SERVER, TOKEN = login()


def call(verb, args, ok=()):
    req = urllib.request.Request(f"{SERVER}/api/v1/{verb}", data=json.dumps(args).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.load(r).get("result")
    except urllib.error.HTTPError as e:
        body = json.load(e)
        code = (body.get("error") or {}).get("code")
        if code in ok:
            return None
        raise SystemExit(f"{verb} {args.get('store') or args.get('id') or ''}: {e.code} {body}")


def install(m, grants, host=None, path=None, typ=""):
    call("store.new", {"id": m["store"], "type": typ}, ok=("conflict",))
    if typ:
        call("store.type", {"id": m["store"], "type": typ})  # an existing store
    r = call("files.push", m)
    for subject, level in grants:
        call("grant.set", {"store": m["store"], "subject": subject, "level": level})
    if host:
        call("mount.set", {"host": host, "path": path, "store": m["store"]})
    return r


def main(d, live, static):
    d = pathlib.Path(d)
    call("mount.set", {"host": live, "path": "/f/:id", "storeParam": "id", "type": "release"})
    for p in sorted((d / "apps").glob("*.json")):
        m = json.loads(p.read_text())
        r = install(m, [("@guest", "interact")], typ="release")
        app = json.loads(next(f["text"] for f in m["files"] if f["path"] == "app.json"))
        if "sample" in app.get("capabilities", {}):
            for aud in ("member", "subscriber", "admin"):
                call("policy.set", {"app": m["store"], "capability": "sample", "audience": aud, "value": "on"})
        print(f"{m['store']:28} snapshot {r['n']}: {r['files']} files  https://{live}/f/{m['store']}/")
    m = json.loads((d / "site.json").read_text())
    r = install(m, [("@guest", "view")], static, "/")
    print(f"{'boutique':28} snapshot {r['n']}: {r['files']} files  https://{static}/")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 4):
        sys.exit(__doc__)
    live, static = (sys.argv[2], sys.argv[3]) if len(sys.argv) == 4 else ("apps.slop.yolo.scapegoat.dev", "site.slop.yolo.scapegoat.dev")
    main(sys.argv[1], live, static)
