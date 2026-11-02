#!/usr/bin/env python3
"""Build slop.boutique as one v3 static store, from its v2 source.

usage: 02-build-boutique.py <seed-dir> <out-dir>

<seed-dir> is slop-computer/examples/seed: seed.json (artifacts, routes)
and artifacts/<id>/v<n>/<files>. The v2 server rendered a route by
injecting boot data (records, route params, tokens CSS) into the page.
v3's static host serves files only, so this script does the rendering
once, at build time:

  - every route becomes a directory holding its page's files: /pricing
    is pricing/index.html; a route with a :param gets one directory per
    record (/apps/:slug -> apps/<slug>/index.html);
  - the catch-all route becomes 404.html, named as notFound in app.json;
  - each data artifact's files are parsed into records (as v2's
    pkg/records did) and written to _data/<artifact>.json;
  - each page gets a boot block, the tokens CSS and _slop/page.js, which
    defines the window.slop the pages were written against.

The output folder is pushed with `slop push <out-dir> --store boutique`.
"""
import html
import json
import math
import pathlib
import re
import shutil
import sys

import markdown

PAGE_JS = """/* window.slop for the slop.boutique pages: the API the v2 server gave
   them (data.<alias>.list/get, route.params/path, record, tokens), over
   files of this site. _data/<artifact>.json holds an artifact's records,
   compiled when the site was built; the boot block names the aliases. */
(function () {
  'use strict';
  var el = document.getElementById('slop-boot');
  var D = {};
  try { D = JSON.parse(el ? el.textContent : '{}'); } catch (e) { D = {}; }
  var cache = {};
  function rows(name) {
    if (!cache[name]) {
      cache[name] = fetch('/_data/' + name + '.json')
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; });
    }
    return cache[name];
  }
  var data = {};
  Object.keys(D.reads || {}).forEach(function (alias) {
    var name = D.reads[alias];
    data[alias] = {
      list: function () { return rows(name).then(function (a) { return a.slice(); }); },
      get: function (id) { return rows(name).then(function (a) { return a.filter(function (r) { return r.id === id; })[0] || null; }); },
    };
  });
  var route = D.route || { params: {} };
  route.path = location.pathname;
  window.slop = { route: route, data: data, record: D.record || null, mode: 'site', tokens: D.tokens || null };
})();
"""

FRONT = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.S)
CSS_NAME = re.compile(r"^[A-Za-z0-9_-]+$")
CSS_VALUE = re.compile(r"^[^;{}<>]*$")
TEXT_EXT = {"", ".md", ".json", ".csv", ".txt", ".tsv", ".yaml", ".yml"}


def front_matter(text):
    """v2's records.FrontMatter: [a, b] lists, true/false, else strings."""
    text = text.replace("\r", "")
    m = FRONT.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).split("\n"):
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip()
        if v.startswith("[") and v.endswith("]"):
            meta[k] = [x.strip() for x in v[1:-1].split(",") if x.strip()]
        elif v in ("true", "false"):
            meta[k] = v == "true"
        else:
            meta[k] = v.strip('"')
    return meta, m.group(2)


def parse_record(rel, content):
    """v2's records.Parse: one file of a data version as one record."""
    p = pathlib.PurePosixPath(rel)
    ext = p.suffix.lower()
    r = {}
    if ext not in TEXT_EXT:
        return {"file": True, "id": p.stem, "path": rel}
    text = content.decode("utf-8")
    if ext == ".md":
        meta, body = front_matter(text)
        r["tags"] = []
        r.update(meta)
        r["body"] = body
        r["html"] = markdown.markdown(body, extensions=["extra"])
        r["minutes"] = max(1, (len(body.split()) + 100) // 200)
    elif ext == ".json":
        try:
            r.update(json.loads(text))
        except ValueError:
            r["error"] = "not valid JSON"
    elif ext == ".csv":
        r["csv"] = text
    else:
        r["text"] = text
    r["id"], r["path"] = p.stem, rel
    return r


def tokens_css(t):
    """v2's records.Tokens.CSS: html:root custom properties."""
    out = []

    def add(k, v):
        if v and CSS_NAME.match(k) and CSS_VALUE.match(v):
            out.append(f"--{k}:{v}")

    for k in sorted(t.get("colors", {})):
        add(k, t["colors"][k])
    add("sans", t.get("type", {}).get("sans", ""))
    add("mono", t.get("type", {}).get("mono", ""))
    add("radius", t.get("radius", ""))
    return "html:root{" + ";".join(out) + "}"


def files_of(version_dir):
    return sorted(str(p.relative_to(version_dir)) for p in version_dir.rglob("*") if p.is_file())


def main(seed, out):
    seed = pathlib.Path(seed)
    out = pathlib.Path(out)
    meta = json.loads((seed / "seed.json").read_text())
    arts = {a["id"]: a for a in meta["artifacts"]}

    def version_dir(art, n=None):
        n = n or max(v["n"] for v in arts[art]["versions"])
        return seed / "artifacts" / art / f"v{n}", n

    if out.exists():
        if any(out.iterdir()) and not (out / "app.json").exists():
            sys.exit(f"{out} is not empty and holds no app.json; not touching it")
        shutil.rmtree(out)
    out.mkdir(parents=True)

    # Data: each data artifact's latest version, as records.
    records = {}
    for a in arts.values():
        if a["kind"] != "data":
            continue
        d, _ = version_dir(a["id"])
        records[a["id"]] = [parse_record(rel, (d / rel).read_bytes()) for rel in files_of(d)]
        (out / "_data").mkdir(exist_ok=True)
        (out / "_data" / f"{a['id']}.json").write_text(json.dumps(records[a["id"]], ensure_ascii=False))

    def tokens_for(manifest):
        name = manifest.get("tokens")
        if not name:
            return None, ""
        d, _ = version_dir(name)
        t = json.loads((d / "tokens.json").read_text())
        return t, tokens_css(t)

    def write_page(dest, page, n, route, record=None, absolute=None):
        """Copy a page version's files into the directory dest and inject
        its boot block. absolute: the page is the file dest instead, and
        its other files move under that URL prefix (404.html is served at
        any depth, so relative URLs would not resolve)."""
        d, n = version_dir(page, n)
        manifest = next(v for v in arts[page]["versions"] if v["n"] == n).get("manifest") or {}
        tokens, css = tokens_for(manifest)
        boot = {"reads": manifest.get("reads", {}), "route": route, "record": record, "tokens": tokens}
        # </ inside a JSON script would end it early.
        boot_json = json.dumps(boot, ensure_ascii=False).replace("</", "<\\/")
        inject = (f'<script id="slop-boot" type="application/json">{boot_json}</script>'
                  f'<script src="/_slop/page.js"></script>'
                  + (f'<style data-slop="tokens">{css}</style>' if css else ""))
        files_dir = out / (absolute.strip("/") if absolute else dest)
        page_file = out / dest if absolute else files_dir / "index.html"
        for rel in files_of(d):
            target = files_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            if rel == "index.html":
                text = (d / rel).read_text()
                if absolute:
                    for other in files_of(d):
                        if other != "index.html":
                            text = text.replace(f'"{other}"', f'"{absolute}{other}"')
                target = page_file
                if "</head>" not in text:
                    sys.exit(f"{page} v{n}: no </head> to inject into")
                text = text.replace("</head>", inject + "</head>", 1)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text)
            else:
                shutil.copyfile(d / rel, target)
        return n

    built = []
    for r in meta["routes"]:
        page, n = r["page"], r.get("version")
        if r["path"] == "*":
            write_page("404.html", page, n, {"pattern": "*", "params": {}}, absolute="/_404/")
            built.append(("*", "404.html"))
            continue
        segs = [s for s in r["path"].split("/") if s]
        params = [s[1:] for s in segs if s.startswith(":")]
        if not params:
            dest = "/".join(segs)
            write_page(dest, page, n, {"pattern": r["path"], "params": {}})
            built.append((r["path"], dest + "/index.html" if dest else "index.html"))
            continue
        # One directory per record the route's record pattern matches.
        if len(params) != 1 or not r.get("record"):
            sys.exit(f"route {r['path']}: one :param with a record pattern is supported")
        rx = re.compile("^" + re.escape(r["record"]).replace(re.escape("{" + params[0] + "}"), "(?P<v>[^/]+)") + "$")
        for art, rows in records.items():
            for rec in rows:
                m = rx.match(rec.get("path", ""))
                if not m:
                    continue
                url = "/".join(m.group("v") if s.startswith(":") else s for s in segs)
                write_page(url, page, n, {"pattern": r["path"], "params": {params[0]: m.group("v")}}, record=rec)
                built.append((r["path"], url + "/index.html"))

    (out / "_slop").mkdir(exist_ok=True)
    (out / "_slop" / "page.js").write_text(PAGE_JS)
    (out / "app.json").write_text(json.dumps({"title": "slop.boutique", "notFound": "404.html"}, indent=2) + "\n")
    for pattern, dest in built:
        print(f"{pattern:16} {dest}")
    print(f"{sum(1 for p in out.rglob('*') if p.is_file())} files in {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
