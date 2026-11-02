#!/usr/bin/env python3
"""Replace the imported apps' exact /f/<id> mounts with one /f/:id mount.

usage: 01-generic-f-mount.py [--apply] [<live-host>]

SLOP3-004's import (06-push-import.py) mounted each of the 103 francois apps
at /f/<id> on the live host. This gives each of those stores the type
"release" (store.type, slop-computer #16 or later), mounts
/f/:id --storeParam id --type release once, then removes the exact mounts.
Exact mounts win over the parameter mount, so every address keeps working
throughout; removing an exact mount hands its path to /f/:id. Only exact
mounts at /f/<store> naming that same store are touched. Without --apply
it prints the plan and changes nothing. Safe to repeat.

Uses the slop CLI's default login ($SLOP_CREDENTIALS or
~/.config/slop/credentials.json; an admin token with the admin scope). The
token is read, never printed.
"""
import json
import os
import sys
import urllib.error
import urllib.request

TYPE = "release"


def login():
    path = os.environ.get("SLOP_CREDENTIALS") or os.path.expanduser("~/.config/slop/credentials.json")
    creds = json.load(open(path))
    server = os.environ.get("SLOP_SERVER") or creds["default"]
    return server, creds["servers"][server]["token"]


SERVER, TOKEN = login()


def call(verb, args):
    req = urllib.request.Request(f"{SERVER}/api/v1/{verb}", data=json.dumps(args).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r).get("result")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{verb} {args}: {e.code} {e.read()[:300].decode()}")


def main(apply, live):
    stores = {s["id"]: s for s in call("store.ls", {"all": True})}
    exact = []
    for r in call("mount.ls", {"host": live}):
        m = r["mount"]
        path, store = m.get("path", ""), m.get("store", "")
        if store and path == f"/f/{store}" and store in stores:
            exact.append(store)
    retype = [s for s in exact if stores[s].get("type", "") != TYPE]
    clash = [s for s in retype if stores[s].get("type")]
    print(f"{len(exact)} exact /f/<id> mounts on {live}; {len(retype)} stores to type {TYPE!r}")
    if clash:
        raise SystemExit(f"stores that already have another type (left alone, fix by hand): {clash}")
    if not apply:
        print("dry run: rerun with --apply")
        return
    for s in retype:
        call("store.type", {"id": s, "type": TYPE})
    call("mount.set", {"host": live, "path": "/f/:id", "storeParam": "id", "type": TYPE})
    for s in exact:
        call("mount.rm", {"host": live, "path": f"/f/{s}"})
    print(f"typed {len(retype)}, mounted /f/:id --type {TYPE}, removed {len(exact)} exact mounts")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--apply"]
    if len(args) > 1:
        sys.exit(__doc__)
    main("--apply" in sys.argv[1:], args[0] if args else "apps.slop.yolo.scapegoat.dev")
