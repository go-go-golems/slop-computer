#!/usr/bin/env python3
"""Build the v3 import of v2's slop.yolo.scapegoat.dev as files.push manifests.

usage: 04-build-import.py <v2-export> <boutique-seed> <out-dir> [<apps-origin>]

<v2-export> is 03-export-v2.py's folder; <boutique-seed> is v2's
examples/seed (git show 96eab85:examples/seed). <apps-origin> is the live
host the apps run on (default https://apps.slop.yolo.scapegoat.dev).
Writes <out-dir>/apps/<id>.json and <out-dir>/site.json, each the
arguments of one files.push: {"store", "files": [...], "message"}. Files
that v2 already holds are named by sha256 (their bytes are copied into
v3's blob store on the volume, 05-copy-blobs.sh); generated files carry
their text.

  apps/<id>   each francois release v2 served (103): index.html and its
              attachments, plus app.json with the release's title and
              capabilities. Mounted at /f/<id> on the live host.
  site        the site at the root of the static host, slop.boutique:
              - the boutique's pages from the seed (journal, about,
                pricing, press, play), rendered by SLOP3-001's
                02-build-boutique.py;
              - over them, the catalogue v2 served at / and /apps/:id
                (storefront, storefront-entry), rendered once per catalog
                record with the window.slop shim, /_data/francois-catalog.json;
              - the catalogue's images at the paths v2 served them
                (/_d/<artifact>/<n>/<path>), by hash;
              - /r/<id>, where the catalogue's "Open release" links go:
                a page that sends the visitor to the app on the live host.
"""
import base64
import importlib.util
import json
import pathlib
import shutil
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
BOUTIQUE = next(HERE.parent.parent.glob("SLOP3-001--*/scripts/02-build-boutique.py"))
spec = importlib.util.spec_from_file_location("boutique", BOUTIQUE)
boutique = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boutique)

# The catalogue pages ask slop for scaled images; the static host serves
# files as they are, so the helpers return the original.
PAGE_JS = boutique.PAGE_JS.replace(
    "window.slop = { route: route, data: data, record: D.record || null, mode: 'site', tokens: D.tokens || null };",
    "window.slop = { route: route, data: data, record: D.record || null, mode: 'site', tokens: D.tokens || null,\n"
    "    image: function (u) { return u; }, srcset: function () { return ''; } };")
assert PAGE_JS != boutique.PAGE_JS

# Capabilities a francois release declares, as v3 app.json blocks. The slop
# namespace needs no declaration in v3.
CAP_BLOCK = {"downloads": True, "user": {"scopes": ["profile"]}}

REDIRECT = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>{title} · slop.boutique</title><meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url={url}"></head>
<body><p><a href="{url}">Open {title}</a></p></body></html>
"""


def main(export, seed, out, apps_origin):
    export, out = pathlib.Path(export), pathlib.Path(out)
    v2 = json.loads((export / "v2.json").read_text())
    arts = {a["id"]: a for a in v2["artifacts"]}

    def text(sha):
        return (export / "blobs" / sha).read_bytes()

    def by_hash(f, path=None):
        return {"path": path or f["path"], "sha256": f["sha256"], "size": f["size"], "type": f["type"]}

    (out / "apps").mkdir(parents=True, exist_ok=True)
    released = []
    for a in v2["artifacts"]:
        imp = (a["manifest"] or {}).get("import")
        if a["kind"] != "page" or not imp or "capabilities" not in imp:
            continue
        caps = {c: CAP_BLOCK.get(c, {}) for c in imp["capabilities"] if c != "slop"}
        files = [by_hash(f) for f in a["files"] if f["path"] != "francois.manifest.json"]
        files.append({"path": "app.json", "text": json.dumps({"title": a["title"], "capabilities": caps}, ensure_ascii=False, indent=2) + "\n"})
        (out / "apps" / f"{a['id']}.json").write_text(json.dumps(
            {"store": a["id"], "files": files, "message": f"imported from v2 ({imp.get('release', '')})"}, ensure_ascii=False))
        released.append(a)

    # The boutique's pages, rendered from the seed.
    with tempfile.TemporaryDirectory() as tmp:
        site = pathlib.Path(tmp) / "site"
        boutique.main(seed, str(site))
        # The catalogue replaces the seed's front page and app pages.
        shutil.rmtree(site / "apps", ignore_errors=True)
        catalog = [boutique.parse_record(f["path"], text(f["sha256"])) for f in arts["francois-catalog"]["files"]]
        creators = [boutique.parse_record(f["path"], text(f["sha256"])) for f in arts["francois-creators"]["files"]]
        (site / "_data").mkdir(exist_ok=True)
        (site / "_data" / "francois-catalog.json").write_text(json.dumps(catalog, ensure_ascii=False))
        (site / "_data" / "francois-creators.json").write_text(json.dumps(creators, ensure_ascii=False))
        tokens = json.loads(text(arts["lab-tokens"]["files"][0]["sha256"]))
        css = boutique.tokens_css(tokens)

        def page(art, dest, route):
            a = arts[art]
            files = {f["path"]: text(f["sha256"]) for f in a["files"]}
            boot = {"reads": a["manifest"].get("reads", {}), "route": route, "record": None, "tokens": tokens}
            boot_json = json.dumps(boot, ensure_ascii=False).replace("</", "<\\/")
            html = files["index.html"].decode()
            html = html.replace('href="boutique.css', 'href="/boutique.css')
            inject = (f'<script id="slop-boot" type="application/json">{boot_json}</script>'
                      f'<script src="/_slop/page.js"></script><style data-slop="tokens">{css}</style>')
            html = html.replace("</head>", inject + "</head>", 1)
            target = site / dest
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(html)
            (site / "boutique.css").write_bytes(files["boutique.css"])

        page("storefront", "index.html", {"pattern": "/", "params": {}})
        for r in catalog:
            page("storefront-entry", f"apps/{r['id']}/index.html", {"pattern": "/apps/:id", "params": {"id": r["id"]}})
        for a in released:
            url = f"{apps_origin}/f/{a['id']}/"
            t = a["title"].replace("&", "&amp;").replace("<", "&lt;")
            (site / "r" / a["id"]).mkdir(parents=True, exist_ok=True)
            (site / "r" / a["id"] / "index.html").write_text(REDIRECT.format(title=t, url=url))
        (site / "_slop" / "page.js").write_text(PAGE_JS)

        files = []
        for p in sorted(site.rglob("*")):
            if not p.is_file():
                continue
            rel = str(p.relative_to(site))
            b = p.read_bytes()
            try:
                files.append({"path": rel, "text": b.decode("utf-8")})
            except UnicodeDecodeError:
                files.append({"path": rel, "data": base64.b64encode(b).decode()})
        generated = len(files)
    for name in ("francois-media", "francois-media-2", "francois-media-3"):
        a = arts[name]
        files += [by_hash(f, f"_d/{name}/{a['n']}/{f['path']}") for f in a["files"]]
    (out / "site.json").write_text(json.dumps({"store": "boutique", "files": files, "message": "slop.boutique: the boutique seed and v2's catalogue"}, ensure_ascii=False))
    print(f"{len(released)} apps; site: {generated} generated files, {len(files) - generated} media by hash, {len(catalog)} catalog records")


if __name__ == "__main__":
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) == 5 else "https://apps.slop.yolo.scapegoat.dev")
