#!/usr/bin/env python3
"""SLOP3-015: publish the catalog views on the static host.

usage: 02-deploy.py <repo> <data-dir> [--apply] [--host site.slop.yolo.scapegoat.dev]

<data-dir> holds catalog.json and views.json (01-build-catalog.py). For each
of the stores below: store.new if missing; files.push only when the tree
differs from files.ls (path and sha256); grant.set @guest view if missing;
mount.set on the static host if missing. Dry run by default. Uses the slop
CLI's default login; the token is read, never printed.
"""
import argparse
import hashlib
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

STORES = [  # store, source dir in the repo, mount path, extra files from the data dir
    ("catalog", "apps/catalog", "/catalog", {"data/catalog.json": "catalog.json", "data/views.json": "views.json", "data/feed.xml": "feed.xml"}),
    ("catalog-list", "apps/catalog-list", "/catalog/list", {}),
    ("catalog-table", "apps/catalog-table", "/catalog/table", {}),
    ("catalog-sheet", "apps/catalog-sheet", "/catalog/sheet", {}),
    ("catalog-caps", "apps/catalog-caps", "/catalog/caps", {}),
    ("catalog-zine", "apps/catalog-zine", "/catalog/zine", {}),
    ("catalog-timeline", "apps/catalog-timeline", "/catalog/timeline", {}),
    ("catalog-treemap", "apps/catalog-treemap", "/catalog/treemap", {}),
    ("catalog-roulette", "apps/catalog-roulette", "/catalog/roulette", {}),
    ("catalog-term", "apps/catalog-term", "/catalog/term", {}),
    ("catalog-desktop", "apps/catalog-desktop", "/catalog/desktop", {}),
]


class APIError(Exception):
    pass


class Slop:
    def __init__(self):
        path = os.environ.get("SLOP_CREDENTIALS") or os.path.expanduser("~/.config/slop/credentials.json")
        creds = json.load(open(path))
        self.server = os.environ.get("SLOP_SERVER") or creds["default"]
        self._token = creds["servers"][self.server]["token"]

    def __call__(self, verb, args=None):
        req = urllib.request.Request(f"{self.server}/api/v1/{verb}", data=json.dumps(args or {}).encode(), method="POST",
                                     headers={"Authorization": "Bearer " + self._token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r).get("result")
        except urllib.error.HTTPError as e:
            raise APIError(f"{verb} {args.get('store') or args.get('id') or ''}: {e.code} {e.read()[:300]!r}") from None


# Pages name the kit with its content hash (views.js?v=<sha>): the static
# host lets browsers keep a file 60 s and then use it stale for 600 s more,
# so an unversioned kit would lag a deploy by up to 11 minutes.
KIT = ("kit/views.js", "kit/views.css")


def stamps(repo):
    out = {}
    for k in KIT:
        b = pathlib.Path(repo, "apps/catalog", k).read_bytes()
        out[f'"/catalog/{k}"'] = f'"/catalog/{k}?v={hashlib.sha256(b).hexdigest()[:12]}"'.encode()
    return out


def tree(repo, src, data, extra):
    out = {}
    root = pathlib.Path(repo, src)
    st = stamps(repo)
    for p in sorted(root.rglob("*")):
        if p.is_file():
            b = p.read_bytes()
            if p.suffix == ".html":
                for old, new in st.items():
                    b = b.replace(old.encode(), new)
            out[p.relative_to(root).as_posix()] = b
    for dst, name in extra.items():
        out[dst] = pathlib.Path(data, name).read_bytes()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("data")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--host", default="site.slop.yolo.scapegoat.dev")
    a = ap.parse_args()
    slop = Slop()
    stores = {s["id"]: s for s in slop("store.ls", {"all": True})}
    mounts = {(m["mount"]["host"], m["mount"]["path"]): m["mount"].get("store") for m in slop("mount.ls", {})}
    for sid, src, mount, extra in STORES:
        want = tree(a.repo, src, a.data, extra)
        exists = sid in stores
        cur = {f["path"]: f["sha256"] for f in slop("files.ls", {"store": sid}) if f.get("zone", "tree") == "tree"} if exists else {}
        diff = sorted({p for p, b in want.items() if cur.get(p) != hashlib.sha256(b).hexdigest()} | (set(cur) - set(want)))
        guest = exists and any(g["subject"] == "@guest" and g["level"] in ("view", "interact", "admin")
                               for g in slop("grant.ls", {"store": sid}))
        at = mounts.get((a.host, mount))
        if at not in (None, sid):
            sys.exit(f"{a.host}{mount} is already mounted to {at}; refusing to replace it")
        plan = [x for x in [
            None if exists else "store.new",
            f"files.push ({len(diff)} changed: {', '.join(diff[:6])}{'…' if len(diff) > 6 else ''})" if diff else None,
            None if guest else "grant.set @guest view",
            None if at == sid else f"mount.set {a.host}{mount}",
        ] if x]
        print(f"{sid:14} {', '.join(plan) or 'up to date'}")
        if not a.apply or not plan:
            continue
        if not exists:
            slop("store.new", {"id": sid})
        if diff:
            files = [{"path": p, "text": b.decode()} for p, b in want.items()]
            r = slop("files.push", {"store": sid, "files": files, "message": "SLOP3-015 catalog views"})
            print(f"{'':14} snapshot {r.get('n')}")
        if not guest:
            slop("grant.set", {"store": sid, "subject": "@guest", "level": "view"})
        if at != sid:
            slop("mount.set", {"host": a.host, "path": mount, "store": sid})
    for sid, _, mount, _ in STORES:
        print(f"https://{a.host}{mount}/")


if __name__ == "__main__":
    try:
        main()
    except APIError as e:
        sys.exit(str(e))
