#!/usr/bin/env python3
"""SLOP3-015: publish the catalog views (static host) and the catalog's apps (live host).

usage: 02-deploy.py <repo> <data-dir> [--apply] [--only store,store]
                    [--static site.slop.yolo.scapegoat.dev] [--live apps.slop.yolo.scapegoat.dev]

<data-dir> holds what 01-build-catalog.py wrote (catalog.json, views.json,
feed.xml, search-index.json, llms.txt). For each store below, in order:
  store.new    if missing
  files.push   only when the tree differs from files.ls (path and sha256)
  grant.set    each wanted grant that is missing or at another level
  policy.set   each wanted policy cell that is not already so
  mount.set    when the mount is missing, or its API policy differs
Dry run by default. Refuses to replace a mount that serves another store.
Uses the slop CLI's default login; the token is read, never printed.
"""
import argparse
import hashlib
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

SITE = "https://site.slop.yolo.scapegoat.dev"


def view(name):
    return {"store": f"catalog-{name}", "src": f"apps/catalog-{name}", "host": "static", "path": f"/catalog/{name}"}


STORES = [
    {"store": "catalog", "src": "apps/catalog", "host": "static", "path": "/catalog",
     "extra": {"data/catalog.json": "catalog.json", "data/views.json": "views.json", "data/feed.xml": "feed.xml",
               "data/search-index.json": "search-index.json", "llms.txt": "llms.txt"}},
    *[view(v) for v in ["list", "table", "sheet", "caps", "zine", "timeline", "treemap", "roulette", "term", "desktop", "agents"]],
    # View 4's MCP server: an actor, so on the live host. Public routes, a
    # per-IP rate limit, CORS for the catalog's site.
    {"store": "catalog-mcp", "src": "apps/catalog-mcp", "host": "live", "path": "/catalog/mcp",
     "extra": {"data/catalog.json": "catalog.json"},
     "api": {"routes": ["POST /", "GET /"], "defaultMin": "public", "middleware": [
         {"name": "rateLimit", "config": {"per": "ip", "limit": 60, "window": "1m", "burst": 120}},
         {"name": "cors", "config": {"origins": [SITE]}}]}},
]
GUEST_VIEW = {"@guest": "view"}


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
            raise APIError(f"{verb} {(args or {}).get('store') or (args or {}).get('app') or ''}: {e.code} {e.read()[:300]!r}") from None


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


def covers(want, have):
    """have includes every key and value of want (the server may add defaults)."""
    if isinstance(want, dict):
        return isinstance(have, dict) and all(covers(v, have.get(k)) for k, v in want.items())
    if isinstance(want, list):
        return isinstance(have, list) and len(want) == len(have) and all(covers(a, b) for a, b in zip(want, have))
    return want == have


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("data")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated store ids")
    ap.add_argument("--static", default="site.slop.yolo.scapegoat.dev")
    ap.add_argument("--live", default="apps.slop.yolo.scapegoat.dev")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    hosts = {"static": a.static, "live": a.live}
    slop = Slop()
    stores = {s["id"]: s for s in slop("store.ls", {"all": True})}
    mounts = {(m["mount"]["host"], m["mount"]["path"]): m["mount"] for m in slop("mount.ls", {})}
    for s in STORES:
        sid = s["store"]
        if only and sid not in only:
            continue
        host = hosts[s["host"]]
        want = tree(a.repo, s["src"], a.data, s.get("extra", {}))
        exists = sid in stores
        cur = {f["path"]: f["sha256"] for f in slop("files.ls", {"store": sid}) if f.get("zone", "tree") == "tree"} if exists else {}
        diff = sorted({p for p, b in want.items() if cur.get(p) != hashlib.sha256(b).hexdigest()} | (set(cur) - set(want)))
        have_grants = {g["subject"]: g["level"] for g in slop("grant.ls", {"store": sid})} if exists else {}
        grants = [(sub, lvl) for sub, lvl in s.get("grants", GUEST_VIEW).items() if have_grants.get(sub) != lvl]
        cells = []
        if s.get("policy"):
            have = {}
            if exists and "app.json" in cur:
                have = {(c["capability"], c["audience"]): c["allowed"] for c in slop("policy.ls", {"app": sid})["cells"]}
            cells = [(c, aud, on) for c, aud, on in s["policy"] if have.get((c, aud)) != on]
        m = mounts.get((host, s["path"]))
        if m and m.get("store") != sid:
            sys.exit(f"{host}{s['path']} is already mounted to {m.get('store') or m.get('storeParam')}; refusing to replace it")
        remount = m is None or (s.get("api") is not None and not covers(s["api"], m.get("api")))
        plan = [x for x in [
            None if exists else "store.new",
            f"files.push ({len(diff)} changed: {', '.join(diff[:6])}{'…' if len(diff) > 6 else ''})" if diff else None,
            *[f"grant.set {sub} {lvl}" for sub, lvl in grants],
            *[f"policy.set {c} @{aud} {'on' if on else 'off'}" for c, aud, on in cells],
            (f"mount.set {host}{s['path']}" + (" (api policy)" if s.get("api") else "")) if remount else None,
        ] if x]
        print(f"{sid:16} {', '.join(plan) or 'up to date'}")
        if not a.apply or not plan:
            continue
        if not exists:
            slop("store.new", {"id": sid})
        if diff:
            files = [{"path": p, "text": b.decode()} for p, b in want.items()]
            r = slop("files.push", {"store": sid, "files": files, "message": "SLOP3-015 catalog views"})
            print(f"{'':16} snapshot {r.get('n')}")
        for sub, lvl in grants:
            slop("grant.set", {"store": sid, "subject": sub, "level": lvl})
        for c, aud, on in cells:
            slop("policy.set", {"app": sid, "capability": c, "audience": "@" + aud, "value": "on" if on else "off"})
        if remount:
            args = {"host": host, "path": s["path"], "store": sid}
            if s.get("api"):
                args["api"] = s["api"]
            slop("mount.set", args)
    for s in STORES:
        if not only or s["store"] in only:
            print(f"https://{hosts[s['host']]}{s['path']}{'/' if s['host'] == 'static' else ''}")


if __name__ == "__main__":
    try:
        main()
    except APIError as e:
        sys.exit(str(e))
