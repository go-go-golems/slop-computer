#!/usr/bin/env python3
"""SLOP3-015: build the catalog the views read.

usage: 01-build-catalog.py <out-dir> [--apps-origin URL] [--site-origin URL] [--history inventory.json]

Reads (never writes) the slop server of the CLI's default login
($SLOP_CREDENTIALS or ~/.config/slop/credentials.json; the token is read,
never printed):
  store.ls --all                          the release stores
  files.cat <store> francois.json         each release's facts (SLOP3-013)
  files.cat boutique _data/francois-catalog.json   covers and featured flags
and writes <out-dir>/catalog.json and <out-dir>/views.json (guide §3.2), plus
feed.xml (Atom, one entry per release), and for agents llms.txt (a Markdown
index, https://llmstxt.org) and search-index.json (one flat record per app). With --history (SLOP3-013's
francois inventory, read from the file) each item also gets "releases":
every published release of the app, newest first, with its changelog.
Only listed apps go in; paid apps get no preview, download or attachment
links (the static host would answer 404 to a guest anyway).
"""
import argparse
import html
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


# Views that need slop's runtime run on the live host; they are listed with
# absolute URLs (the static views use paths on the site host).
LIVE_VIEWS = [
    {"id": "shelf", "title": "Shelf", "path": "/catalog/shelf/",
     "blurb": "Sign in and keep a shelf of apps; share it if you like, and see what people here are looking at."},
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


def history(path):
    """artifact id -> its published releases, newest first, from the francois inventory."""
    inv = json.load(open(path))
    out = collections.defaultdict(list)
    for r in inv["releases"]:
        if r.get("state") != "published":
            continue
        out[r["artifact"]].append({"version": r.get("version"), "publishedAt": (r.get("publishedAt") or "")[:19] + "Z",
                                   "changelog": (r.get("changelog") or "").strip()})
    for v in out.values():
        v.sort(key=lambda r: r["publishedAt"], reverse=True)
    return out


def atom(cat, site):
    """An Atom feed with one entry per release (or per app, without history), newest first."""
    esc = html.escape
    entries = []
    for i in cat["items"]:
        rels = i.get("releases") or [{"version": i["version"], "publishedAt": i["publishedAt"], "changelog": ""}]
        for k, r in enumerate(rels):
            first = k == len(rels) - 1
            title = f"{i['title']} {r['version']}" + ("" if first else " (update)")
            body = r["changelog"] or i["description"]
            link = f"{site}/catalog/list/?open={urllib.parse.quote(i['id'])}"
            entries.append((r["publishedAt"] or cat["generated"], f"""  <entry>
    <id>tag:slop.yolo.scapegoat.dev,2026:catalog/{esc(i['id'])}/{esc(r['version'] or '')}</id>
    <title>{esc(title)}</title>
    <updated>{r['publishedAt'] or cat['generated']}</updated>
    <link rel="alternate" type="text/html" href="{esc(link)}"/>
    <link rel="related" type="text/html" href="{esc(i['open'])}"/>
    <summary>{esc(body)}</summary>
{''.join(f'    <category term="{esc(t)}"/>' + chr(10) for t in i['tags'])}  </entry>
"""))
    entries.sort(key=lambda e: e[0], reverse=True)
    updated = entries[0][0] if entries else cat["generated"]
    return f"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>tag:slop.yolo.scapegoat.dev,2026:catalog</id>
  <title>slop catalog</title>
  <subtitle>Releases of the apps imported from slop.boutique, running on slop.</subtitle>
  <updated>{updated}</updated>
  <link rel="self" type="application/atom+xml" href="{site}/catalog/data/feed.xml"/>
  <link rel="alternate" type="text/html" href="{site}/catalog/timeline/"/>
{''.join(e[1] for e in entries)}</feed>
"""


def search_index(cat, site):
    """One flat record per app, with a text field to match against."""
    return {
        "generated": cat["generated"], "count": cat["count"],
        "fields": ["id", "title", "description", "tags", "capabilities", "access", "version", "publishedAt", "bytes", "open", "html", "text"],
        "apps": [{
            "id": i["id"], "title": i["title"], "description": i["description"], "tags": i["tags"],
            "capabilities": i["capabilities"], "access": "free" if i["free"] else "subscribers",
            "version": i["version"], "publishedAt": i["publishedAt"], "bytes": i["bytes"], "open": i["open"],
            "html": site + i["download"] if i["download"] else None,
            "text": " ".join([i["title"], i["description"], i["id"], *i["tags"]]).lower(),
        } for i in cat["items"]],
    }


def llms_txt(cat, site, mcp):
    """llms.txt: what the catalog is, where its data is, and every app."""
    lines = [
        "# slop catalog", "",
        f"> {cat['count']} single-file HTML apps imported from slop.boutique, running on slop "
        f"({cat['appsOrigin']}). Free apps can be opened, previewed and downloaded by anyone; "
        f"the rest are for subscribers.", "",
        "Every app is one HTML file. Apps may declare slop runtime capabilities: sample (model calls), "
        "db (shared documents), room (real-time presence), user (who is looking), downloads (save files).", "",
        "## For agents", "",
        f"- [MCP endpoint]({mcp}): read-only, Streamable HTTP (JSON answers, stateless); tools search_apps, get_app, list_tags, list_capabilities",
        f"- [search-index.json]({site}/catalog/data/search-index.json): one flat record per app, with a lower-case text field",
        f"- [catalog.json]({site}/catalog/data/catalog.json): the full catalog the views read",
        f"- [feed.xml]({site}/catalog/data/feed.xml): Atom, one entry per release",
        f"- [Agents page]({site}/catalog/agents/): how to connect, with examples", "",
        "## Apps", "",
    ]
    for i in cat["items"]:
        extra = ", ".join(x for x in [", ".join(i["tags"][:4]), "runtime: " + "+".join(i["capabilities"]) if i["capabilities"] else "",
                                      "free" if i["free"] else "subscribers"] if x)
        lines.append(f"- [{i['title']}]({i['open']}): {i['description']} ({extra})")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--apps-origin", default="https://apps.slop.yolo.scapegoat.dev")
    ap.add_argument("--site-origin", default="https://site.slop.yolo.scapegoat.dev")
    ap.add_argument("--history", help="SLOP3-013 inventory JSON: add each app's release history")
    ap.add_argument("--mcp", default="https://apps.slop.yolo.scapegoat.dev/catalog/mcp", help="the MCP endpoint's URL")
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
    if a.history:
        hist = history(a.history)
        for i in items:
            i["releases"] = hist.get(i["id"]) or [{"version": i["version"], "publishedAt": i["publishedAt"], "changelog": ""}]
    tags = collections.Counter(t for i in items for t in i["tags"])
    cat = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "https://slop.boutique",
        "appsOrigin": a.apps_origin,
        "mcp": a.mcp,
        "siteOrigin": a.site_origin,
        "count": len(items),
        "totalBytes": sum(i["bytes"] for i in items),
        "tags": [{"tag": t, "count": n} for t, n in sorted(tags.items(), key=lambda kv: (-kv[1], kv[0]))],
        "items": items,
    }
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n")
    views = VIEWS + [dict(v, path=a.apps_origin + v["path"], live=True) for v in LIVE_VIEWS]
    (out / "views.json").write_text(json.dumps(views, ensure_ascii=False, indent=1) + "\n")
    (out / "feed.xml").write_text(atom(cat, a.site_origin))
    (out / "search-index.json").write_text(json.dumps(search_index(cat, a.site_origin), ensure_ascii=False, separators=(",", ":")) + "\n")
    (out / "llms.txt").write_text(llms_txt(cat, a.site_origin, a.mcp))
    print(f"{len(items)} listed apps ({sum(not i['free'] for i in items)} for subscribers, "
          f"{sum(1 for i in items if i['cover'])} with covers), {len(tags)} tags; left out (hidden): {', '.join(hidden)}")


if __name__ == "__main__":
    sys.exit(main())
