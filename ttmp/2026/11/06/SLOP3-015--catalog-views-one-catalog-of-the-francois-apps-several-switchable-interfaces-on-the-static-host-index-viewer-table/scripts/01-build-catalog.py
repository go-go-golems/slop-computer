#!/usr/bin/env python3
"""SLOP3-015: build the catalog the views read.

usage: 01-build-catalog.py <out-dir> [--apps-origin URL]

Reads (never writes) the slop server of the CLI's default login
($SLOP_CREDENTIALS or ~/.config/slop/credentials.json; the token is read,
never printed):
  store.ls --all                          the release stores
  files.cat <store> francois.json         each release's facts (SLOP3-013)
  files.cat boutique _data/francois-catalog.json   covers and featured flags
and writes <out-dir>/catalog.json and <out-dir>/views.json (guide §3.2).
Only listed apps go in; paid apps get no preview, download or attachment
links (the static host would answer 404 to a guest anyway).
"""
import argparse
import collections
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

VIEWS = [
    {"id": "list", "title": "Index", "path": "/catalog/list/", "blurb": "Rows with covers, sort, tag filter and search."},
    {"id": "table", "title": "Table", "path": "/catalog/table/",
     "blurb": "Every app as a row: capabilities, access, version, date and size, sortable."},
]


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
            raise SystemExit(f"{verb} {args}: {e.code} {e.read()[:300]!r}") from None


def item(fj, store, rec, apps_origin):
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--apps-origin", default="https://apps.slop.yolo.scapegoat.dev")
    a = ap.parse_args()
    slop = Slop()
    covers = {r["id"]: r for r in json.loads(slop("files.cat", {"store": "boutique", "path": "_data/francois-catalog.json"}))}
    items, hidden = [], []
    for s in sorted(slop("store.ls", {"all": True}), key=lambda s: s["id"]):
        if s.get("type") != "release":
            continue
        fj = json.loads(slop("files.cat", {"store": s["id"], "path": "francois.json"}))
        if fj["artifact"].get("visibility") != "listed":
            hidden.append(s["id"])
            continue
        items.append(item(fj, s["id"], covers.get(fj["artifact"]["id"]), a.apps_origin))
    items.sort(key=lambda i: (i["publishedAt"] or "", i["id"]), reverse=True)
    tags = collections.Counter(t for i in items for t in i["tags"])
    cat = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "https://slop.boutique",
        "appsOrigin": a.apps_origin,
        "count": len(items),
        "totalBytes": sum(i["bytes"] for i in items),
        "tags": [{"tag": t, "count": n} for t, n in sorted(tags.items(), key=lambda kv: (-kv[1], kv[0]))],
        "items": items,
    }
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n")
    (out / "views.json").write_text(json.dumps(VIEWS, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(items)} listed apps ({sum(not i['free'] for i in items)} for subscribers, "
          f"{sum(1 for i in items if i['cover'])} with covers), {len(tags)} tags; left out (hidden): {', '.join(hidden)}")


if __name__ == "__main__":
    sys.exit(main())
