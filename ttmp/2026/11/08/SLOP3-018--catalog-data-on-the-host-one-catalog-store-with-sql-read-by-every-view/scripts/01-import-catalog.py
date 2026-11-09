#!/usr/bin/env python3
"""SLOP3-018: write the francois catalog into catalog-data's tables.

usage: 01-import-catalog.py [--from catalog.json] [--history inventory.json]
                            [--only id,id] [--prune] [--apply] [--store catalog-data]

Where the items come from:
  --from FILE   a catalog.json as SLOP3-015's 01-build-catalog.py wrote it
                (the backfill: what the views showed before SLOP3-018)
  (default)     the host itself, as 01-build-catalog.py read it: every
                release store's francois.json (SLOP3-013) and boutique's
                _data/francois-catalog.json (covers, featured), listed apps
                only. With --history (SLOP3-013's inventory) each item gets
                its release history; without, catalog-data keeps the
                releases it knows and adds the current version.

What it writes (dry run by default; reads catalog-data's "catalog" action
to say what would change):
  --only ids    upsertApp for each new or changed id, removeApp for each
                id that is no longer listed (hidden, or no release store)
  (default)     importCatalog with every item; with --prune it also
                removes the apps that are not in the list

SLOP3-013's 03-import.py calls sync() after it pushes releases (its
--catalog flag). Uses the slop CLI's default login ($SLOP_CREDENTIALS or
~/.config/slop/credentials.json, server $SLOP_SERVER or the default); the
token is read, never printed.
"""
import argparse
import collections
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

STORE = "catalog-data"


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
            raise APIError(f"{verb} {(args or {}).get('store') or ''} {(args or {}).get('action') or ''}: {e.code} {e.read()[:400]!r}") from None


# --- items, as SLOP3-015's 01-build-catalog.py built them ---------------------

def item(fj, store, rec, apps_origin):
    """One catalog item from a release store's francois.json and boutique's record."""
    art, rel = fj["artifact"], fj["release"]
    free = bool(rel.get("freeSample"))
    base = f"/_s/{urllib.parse.quote(store)}/main/"
    cover = None
    c = (rec or {}).get("cover")
    if isinstance(c, dict) and c.get("src"):
        cover = {"src": c["src"], "width": c.get("width"), "height": c.get("height")}
    return {
        "id": store,
        "title": art.get("title") or store,
        "description": art.get("description") or "",
        "tags": sorted(art.get("tags") or []),
        "featured": bool((rec or {}).get("featured")),
        "version": rel.get("version"),
        "publishedAt": (rel.get("publishedAt") or "")[:19] + "Z" if rel.get("publishedAt") else None,
        "free": free,
        "capabilities": sorted((rel.get("manifest") or {}).keys()),
        "bytes": (rel.get("html") or {}).get("size", 0),
        "attachments": [{"name": a["name"], "label": a.get("label") or a["name"], "size": a.get("size", 0),
                         "href": base + "attachments/" + urllib.parse.quote(a["name"]) if free else None}
                        for a in rel.get("attachments") or []],
        "cover": cover,
        "open": f"{apps_origin}/f/{urllib.parse.quote(store)}/",
        "preview": base + "index.html" if free else None,
        "download": base + "index.html" if free else None,
    }


def history(inv):
    """store id -> its published releases, newest first, from SLOP3-013's inventory."""
    out = collections.defaultdict(list)
    for r in inv["releases"]:
        if r.get("state") != "published":
            continue
        out[r["artifact"].replace("_", "-")].append({
            "version": r.get("version"), "publishedAt": (r.get("publishedAt") or "")[:19] + "Z",
            "changelog": (r.get("changelog") or "").strip()})
    for v in out.values():
        v.sort(key=lambda r: r["publishedAt"], reverse=True)
    return out


def build(slop, apps_origin, only=None, inv=None):
    """The listed apps on the host (all, or those in only), and the ids that
    are not listed (hidden, or no longer a release store)."""
    covers = {r["id"]: r for r in json.loads(slop("files.cat", {"store": "boutique", "path": "_data/francois-catalog.json"}))}
    hist = history(inv) if inv else None
    items, unlisted = [], []
    releases = {s["id"] for s in slop("store.ls", {"all": True}) if s.get("type") == "release"}
    for sid in sorted(releases if not only else set(only)):
        if sid not in releases:
            unlisted.append(sid)
            continue
        fj = json.loads(slop("files.cat", {"store": sid, "path": "francois.json"}))
        if fj["artifact"].get("visibility") != "listed":
            unlisted.append(sid)
            continue
        i = item(fj, sid, covers.get(fj["artifact"]["id"]), apps_origin)
        if hist is not None:
            i["releases"] = hist.get(sid) or [{"version": i["version"], "publishedAt": i["publishedAt"], "changelog": ""}]
        items.append(i)
    return items, unlisted


# --- the push -------------------------------------------------------------------

def current(slop, store):
    try:
        return slop("actor.call", {"store": store, "action": "catalog"})
    except Exception as e:  # this script's APIError, or the caller's (03-import.py)
        raise SystemExit(f"{store} cannot be read ({e}); deploy it first (SLOP3-015 02-deploy.py)")


def same(want, have):
    """want (as built) equals have (as served); without releases in want,
    the releases are not compared (catalog-data keeps its own)."""
    if have is None:
        return False
    if "releases" not in want:
        have = {k: v for k, v in have.items() if k != "releases"}
    return json.dumps(want, sort_keys=True) == json.dumps(have, sort_keys=True)


def plan(items, unlisted, cur, only, prune):
    have = {i["id"]: i for i in cur["items"]}
    ids = {i["id"] for i in items}
    new = [i for i in items if i["id"] not in have]
    changed = [i for i in items if i["id"] in have and not same(i, have[i["id"]])]
    if only:
        gone = sorted(x for x in unlisted if x in have)
    else:
        gone = sorted(x for x in have if x not in ids) if prune else []
    return new, changed, gone


def sync(slop, items, unlisted, only=None, prune=False, apply=False, store=STORE, out=print):
    """Plan, and with apply write, the catalog-data changes for these items.
    Returns (new, changed, gone)."""
    cur = current(slop, store)
    new, changed, gone = plan(items, unlisted, cur, only, prune)
    out(f"{store}: rev {cur.get('rev')}, {cur.get('count')} apps; {len(items)} listed here: "
        f"{len(new)} new, {len(changed)} changed, {len(items) - len(new) - len(changed)} the same, {len(gone)} to remove")
    for i in new:
        out(f"  + {i['id']} {i.get('version') or ''}")
    for i in changed:
        out(f"  ~ {i['id']} {i.get('version') or ''}")
    for x in gone:
        out(f"  - {x}")
    if not apply:
        return new, changed, gone
    if only:
        for i in new + changed:
            r = slop("actor.call", {"store": store, "action": "upsertApp", "args": i})
            out(f"  upsertApp {i['id']}: rev {r['rev']}")
        for x in gone:
            r = slop("actor.call", {"store": store, "action": "removeApp", "args": {"id": x}})
            out(f"  removeApp {x}: rev {r['rev']}")
    elif new or changed or gone:
        r = slop("actor.call", {"store": store, "action": "importCatalog", "args": {"items": items, "prune": prune}})
        out(f"  importCatalog: {r['upserted']} upserted ({r['created']} new), removed {r['removed']}, rev {r['rev']}")
    return new, changed, gone


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="src", help="a catalog.json to import (the backfill)")
    ap.add_argument("--history", help="SLOP3-013's inventory JSON: each app's release history")
    ap.add_argument("--only", default="", help="comma-separated store ids")
    ap.add_argument("--prune", action="store_true", help="remove the apps that are not in the list")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--store", default=STORE)
    ap.add_argument("--apps-origin", help="the live host the items link to (default: catalog-data's appsOrigin)")
    a = ap.parse_args()
    only = sorted({s for s in a.only.split(",") if s})
    slop = Slop()
    print(f"server {slop.server}")
    if a.src:
        cat = json.load(open(a.src))
        items = [i for i in cat["items"] if not only or i["id"] in only]
        unlisted = [x for x in only if x not in {i["id"] for i in items}]
    else:
        origin = a.apps_origin or current(slop, a.store).get("appsOrigin") or "https://apps.slop.yolo.scapegoat.dev"
        items, unlisted = build(slop, origin, only or None, json.load(open(a.history)) if a.history else None)
    sync(slop, items, unlisted, only, a.prune, a.apply, a.store)
    print("applied" if a.apply else "dry run (--apply to write)")


if __name__ == "__main__":
    try:
        main()
    except APIError as e:
        sys.exit(str(e))
