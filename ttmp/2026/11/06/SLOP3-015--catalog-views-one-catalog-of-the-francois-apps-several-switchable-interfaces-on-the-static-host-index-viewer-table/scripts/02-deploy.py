#!/usr/bin/env python3
"""SLOP3-015: publish the catalog views (static host) and the catalog's apps (live host).

usage: 02-deploy.py <repo> [--apply] [--only store,store]
                    [--static site.slop.yolo.scapegoat.dev] [--live apps.slop.yolo.scapegoat.dev]
                    [--scheme https]

Code only (SLOP3-018): the catalog's data lives in catalog-data's tables and
is written by the importer (SLOP3-018 scripts/01-import-catalog.py, or
SLOP3-013's 03-import.py), never by this script. For each store below, in
order:
  store.new    if missing
  files.push   only when the tree differs from files.ls (path and sha256)
  grant.set    each wanted grant that is missing or at another level
  policy.set   each wanted policy cell that is not already so
  bind.set     each read alias that is missing or points elsewhere, and
               grant.set <target> store:<store> view, which it needs
  mount.set    each mount that is missing, or whose API policy differs
  configure    catalog-data's origins, when they differ from these hosts
catalog-data comes first. Whatever reads the catalog (the views, Shelf,
Curator, and the /catalog/mcp mount it takes over) waits until catalog-data
has apps, so a first deploy is: run this, import (SLOP3-018
scripts/01-import-catalog.py --from <catalog.json> --apply, or from the
host), run this again.

Dry run by default. Refuses to replace a mount that serves another store,
unless the entry names that store in "replaces" (catalog-data takes over
catalog-mcp's /catalog/mcp). Uses the slop CLI's default login; the token is
read, never printed.

The sources name slop.yolo's hosts (the API's address in the kit, the
feed's link); for other --static, --live or --scheme (http for a local
server on *.localhost), .html and .js files are rewritten on the way.
"""
import argparse
import base64
import hashlib
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

STAGING = {"static": "site.slop.yolo.scapegoat.dev", "live": "apps.slop.yolo.scapegoat.dev"}

# The views, as the header's menu lists them (data/views.json in the catalog
# store). The live ones get absolute URLs on the live host.
VIEWS = [
    {"id": "list", "title": "Index", "path": "/catalog/list/", "blurb": "Rows with covers, sort, tag filter and search."},
    {"id": "table", "title": "Table", "path": "/catalog/table/",
     "blurb": "Every app as a row: capabilities, access, version, date and size, sortable."},
    {"id": "sheet", "title": "Sheet", "path": "/catalog/sheet/",
     "blurb": "A contact sheet of live previews: the free apps run while they are on screen."},
    {"id": "caps", "title": "Capabilities", "path": "/catalog/caps/",
     "blurb": "The apps by what they ask of slop's runtime: model, documents, rooms, identity, downloads."},
    {"id": "zine", "title": "Zine", "path": "/catalog/zine/",
     "blurb": "One printed page per app, sized for the reMarkable, A5, A4 or Letter; or a zine to fold."},
    {"id": "timeline", "title": "Timeline", "path": "/catalog/timeline/",
     "blurb": "Releases day by day, with versions and changelogs, and an Atom feed."},
    {"id": "treemap", "title": "Sizes", "path": "/catalog/treemap/",
     "blurb": "A treemap of the apps by the size of their HTML, from 10 MB down to 40 KB."},
    {"id": "roulette", "title": "Roulette", "path": "/catalog/roulette/",
     "blurb": "A random app, or two side by side; then one like it, or one quite unlike it."},
    {"id": "term", "title": "Terminal", "path": "/catalog/term/",
     "blurb": "A keyboard-only catalog: ls, grep, cat, open, run, tags, caps, du."},
    {"id": "desktop", "title": "Desktop", "path": "/catalog/desktop/",
     "blurb": "The apps as windows on a desktop, with a start menu and a taskbar."},
    {"id": "agents", "title": "Agents", "path": "/catalog/agents/",
     "blurb": "The catalog for programs: a read-only MCP server, llms.txt, a search index and the feed."},
]
LIVE_VIEWS = [
    {"id": "shelf", "title": "Shelf", "path": "/catalog/shelf/",
     "blurb": "Sign in and keep a shelf of apps; share it if you like, and see what people here are looking at."},
    {"id": "curator", "title": "Curator", "path": "/catalog/curator/",
     "blurb": "Ask slop's model for apps that fit what you are after, and see today's three picks."},
]


DATA = "catalog-data"


def view(name):
    return {"store": f"catalog-{name}", "src": f"apps/catalog-{name}", "host": "static", "path": f"/catalog/{name}", "needs": DATA}


def stores(hosts):
    site, live = hosts["origin"]("static"), hosts["origin"]("live")
    limit = lambda n: {"name": "rateLimit", "config": {"per": "ip", "limit": n, "window": "1m", "burst": 2 * n}}
    cors = {"name": "cors", "config": {"origins": [site]}}
    return [
        # SLOP3-018: the catalog's one copy, in SQL, with its routes and MCP.
        # /catalog/api serves every route (a route no mount allows breaks the
        # actor until the next push, so the first mount set must allow them
        # all); /catalog/mcp only MCP's, at SLOP3-015's URL.
        {"store": "catalog-data", "src": "apps/catalog-data", "host": "live", "mounts": [
            {"path": "/catalog/api", "api": {
                "routes": ["GET /", "POST /", "GET /catalog.json", "GET /apps", "GET /apps/:id", "GET /feed.xml", "GET /llms.txt", "GET /search-index.json"],
                "defaultMin": "public", "middleware": [limit(120), cors],
                "responseTypes": ["application/json", "text/plain", "application/atom+xml"],
                "forwardHeaders": ["content-type", "accept", "user-agent", "if-none-match"]}},
            {"path": "/catalog/mcp", "replaces": "catalog-mcp", "needs": DATA, "api": {
                "routes": ["POST /", "GET /"], "defaultMin": "public", "middleware": [limit(60), cors]}},
        ], "configure": {"source": "https://slop.boutique", "appsOrigin": live, "siteOrigin": site,
                         "api": live + "/catalog/api", "mcp": live + "/catalog/mcp"}},
        {"store": "catalog", "src": "apps/catalog", "host": "static", "path": "/catalog", "views": True, "needs": DATA},
        *[view(v) for v in ["list", "table", "sheet", "caps", "zine", "timeline", "treemap", "roulette", "term", "desktop", "agents"]],
        # View 14: stars kept per person (db, data/users/<id>/shelf), shelves
        # shared by choice (shelves/<id>), and who is looking at what (room).
        # Guests see the page; signed-in members keep a shelf. Its actor reads
        # the catalog through the binding.
        {"store": "catalog-shelf", "src": "apps/catalog-shelf", "host": "live", "path": "/catalog/shelf", "needs": DATA,
         "grants": {"@guest": "view", "@member": "interact"}, "binds": {"catalog": DATA}},
        # View 15: the curator asks slop's model, on the member's own allowance
        # (the page's sample, and the actor's "today" action run as the member
        # who opens the page first that day). Policy: sample for members only.
        {"store": "catalog-curator", "src": "apps/catalog-curator", "host": "live", "path": "/catalog/curator", "needs": DATA,
         "grants": {"@guest": "view", "@member": "interact"}, "binds": {"catalog": DATA},
         "policy": [("sample", "member", True)]},
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


def rewrite(hosts):
    """Byte replacements for .html and .js files: slop.yolo's origins to these."""
    return [(f"https://{STAGING[k]}".encode(), hosts["origin"](k).encode()) for k in ("static", "live")
            if hosts["origin"](k) != f"https://{STAGING[k]}"]


def text_file(p, b, subs):
    if p.suffix in (".html", ".js"):
        for old, new in subs:
            b = b.replace(old, new)
    return b


# Pages name the kit with its content hash (views.js?v=<sha>): the static
# host lets browsers keep a file 60 s and then use it stale for 600 s more,
# so an unversioned kit would lag a deploy by up to 11 minutes.
KIT = ("kit/views.js", "kit/views.css")


def stamps(repo, subs):
    out = {}
    for k in KIT:
        p = pathlib.Path(repo, "apps/catalog", k)
        b = text_file(p, p.read_bytes(), subs)
        out[f'"/catalog/{k}"'] = f'"/catalog/{k}?v={hashlib.sha256(b).hexdigest()[:12]}"'.encode()
    return out


def tree(repo, s, hosts):
    out = {}
    root = pathlib.Path(repo, s["src"])
    subs = rewrite(hosts)
    st = stamps(repo, subs)
    for p in sorted(root.rglob("*")):
        if p.is_file():
            b = text_file(p, p.read_bytes(), subs)
            if p.suffix == ".html":
                for old, new in st.items():
                    b = b.replace(old.encode(), new)
            out[p.relative_to(root).as_posix()] = b
    if s.get("views"):
        views = VIEWS + [dict(v, path=hosts["origin"]("live") + v["path"], live=True) for v in LIVE_VIEWS]
        out["data/views.json"] = (json.dumps(views, ensure_ascii=False, indent=1) + "\n").encode()
    return out


def entry(path, b):
    """A files.push manifest entry: text as text, anything else (the kit's
    fonts) as base64 data."""
    try:
        return {"path": path, "text": b.decode("utf-8")}
    except UnicodeDecodeError:
        return {"path": path, "data": base64.b64encode(b).decode()}


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
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated store ids")
    ap.add_argument("--static", default=STAGING["static"])
    ap.add_argument("--live", default=STAGING["live"])
    ap.add_argument("--scheme", default="https", choices=["https", "http"], help="how browsers reach the hosts (http: a local server)")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    hosts = {"static": a.static, "live": a.live}
    hosts["origin"] = lambda k: f"{a.scheme}://{hosts[k]}"
    STORES = stores(hosts)
    slop = Slop()
    have_stores = {s["id"]: s for s in slop("store.ls", {"all": True})}
    mounts = {(m["mount"]["host"], m["mount"]["path"]): m["mount"] for m in slop("mount.ls", {})}
    counts = {}

    def ready(store):
        """store (catalog-data) has apps: what reads it may be deployed."""
        if store not in counts:
            try:
                counts[store] = (slop("actor.call", {"store": store, "action": "catalog"}) or {}).get("count", 0) if store in have_stores else 0
            except APIError:
                counts[store] = 0
        return counts[store] > 0

    waited = []
    for s in STORES:
        sid = s["store"]
        if only and sid not in only:
            continue
        if s.get("needs") and not ready(s["needs"]):
            print(f"{sid:16} waits until {s['needs']} has apps")
            waited.append(sid)
            continue
        host = hosts[s["host"]]
        want = tree(a.repo, s, hosts)
        exists = sid in have_stores
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
        binds, target_grants = [], []
        if s.get("binds"):
            have_b = {b["alias"]: b["target"] for b in slop("bind.ls", {"store": sid})} if exists else {}
            binds = [(al, tg) for al, tg in s["binds"].items() if have_b.get(al) != tg]
            for tg in sorted(set(s["binds"].values())):
                tg_grants = {g["subject"]: g["level"] for g in slop("grant.ls", {"store": tg})} if tg in have_stores else {}
                if tg_grants.get("store:" + sid) != "view":
                    target_grants.append(tg)
        remounts = []
        for m in s.get("mounts") or [{"path": s["path"]}]:
            if m.get("needs") and not ready(m["needs"]):
                print(f"{sid:16} {host}{m['path']} waits until {m['needs']} has apps")
                waited.append(f"{host}{m['path']}")
                continue
            have_m = mounts.get((host, m["path"]))
            if have_m and have_m.get("store") != sid and have_m.get("store") != m.get("replaces"):
                sys.exit(f"{host}{m['path']} is already mounted to {have_m.get('store') or have_m.get('storeParam')}; refusing to replace it")
            if have_m is None or have_m.get("store") != sid or (m.get("api") is not None and not covers(m["api"], have_m.get("api"))):
                remounts.append((m, have_m.get("store") if have_m else None))
        conf = None
        if s.get("configure") and exists and "app.json" in cur:
            cat = slop("actor.call", {"store": sid, "action": "catalog"})
            if any((cat.get(k) or None) != v for k, v in s["configure"].items()):
                conf = s["configure"]
        elif s.get("configure"):
            conf = s["configure"]  # a new store: after the push
        plan = [x for x in [
            None if exists else "store.new",
            f"files.push ({len(diff)} changed: {', '.join(diff[:6])}{'…' if len(diff) > 6 else ''})" if diff else None,
            *[f"grant.set {sub} {lvl}" for sub, lvl in grants],
            *[f"policy.set {c} @{aud} {'on' if on else 'off'}" for c, aud, on in cells],
            *[f"bind.set {al} → {tg}" for al, tg in binds],
            *[f"grant.set {tg} store:{sid} view" for tg in target_grants],
            *[f"mount.set {host}{m['path']}" + (" (api policy)" if m.get("api") else "") + (f" (from {old})" if old and old != sid else "")
              for m, old in remounts],
            "configure (origins)" if conf else None,
        ] if x]
        print(f"{sid:16} {', '.join(plan) or 'up to date'}")
        if not a.apply or not plan:
            continue
        if not exists:
            slop("store.new", {"id": sid})
            have_stores[sid] = {"id": sid}
        if diff:
            files = [entry(p, b) for p, b in want.items()]
            r = slop("files.push", {"store": sid, "files": files, "message": "SLOP3-015/018 catalog views"})
            print(f"{'':16} snapshot {r.get('n')}")
        for sub, lvl in grants:
            slop("grant.set", {"store": sid, "subject": sub, "level": lvl})
        for c, aud, on in cells:
            slop("policy.set", {"app": sid, "capability": c, "audience": "@" + aud, "value": "on" if on else "off"})
        for tg in target_grants:
            slop("grant.set", {"store": tg, "subject": "store:" + sid, "level": "view"})
        for al, tg in binds:
            slop("bind.set", {"store": sid, "alias": al, "target": tg})
        for m, old in remounts:
            args = {"host": host, "path": m["path"], "store": sid}
            if m.get("api"):
                args["api"] = m["api"]
            slop("mount.set", args)
            if old and old != sid:
                print(f"{'':16} {old} is no longer mounted at {host}{m['path']}; store.rm {old} when you are done with it")
        if conf:
            slop("actor.call", {"store": sid, "action": "configure", "args": conf})
        counts.pop(sid, None)
    if waited:
        print(f"waiting: {', '.join(waited)}. Import the catalog (SLOP3-018 scripts/01-import-catalog.py), then run this again.")
    for s in STORES:
        if not only or s["store"] in only:
            for m in s.get("mounts") or [{"path": s["path"]}]:
                print(f"{hosts['origin'](s['host'])}{m['path']}{'/' if s['host'] == 'static' else ''}")


if __name__ == "__main__":
    try:
        main()
    except APIError as e:
        sys.exit(str(e))
