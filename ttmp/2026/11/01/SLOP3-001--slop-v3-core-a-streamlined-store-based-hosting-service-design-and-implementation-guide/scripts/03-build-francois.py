#!/usr/bin/env python3
"""Build the francois example apps as v3 app folders.

usage: 03-build-francois.py <francois-examples-dir> <out-dir>

francois apps are single HTML files written against the claude.ai
artifact contract (claude.use), each with a capability manifest:

  <name>.html + <name>.manifest.json          (polis, capabilities)
  imports/<name>/release.html + manifest.json  (the imported releases)

A v3 app is a store whose tree holds app.json; its capabilities block
keeps the contract's shape. So each app becomes <out-dir>/<name>/ with
index.html (the HTML file) and app.json ({"title", "capabilities":
<manifest>}). A page that links francois's own stylesheet
(/static/<file>, pkg/web/static in francois) gets a copy beside it and a
relative link: on slop, /static/ is not the host's. An app with no
capabilities is plain files and can go on a static host; the others need
a live host.
Each folder is pushed with `slop push <out-dir>/<name>`.
"""
import json
import pathlib
import re
import shutil
import sys

HOST_STATIC = re.compile(r'(href|src)="/static/([A-Za-z0-9_.-]+)"')

# Files of an import folder that are not part of the release.
SKIP = {"manifest.json", "page.md", "release.html", "source"}


def title(name):
    return " ".join(w.capitalize() for w in name.split("-"))


def build(name, html, manifest, out, static, extra=()):
    d = out / name
    d.mkdir(parents=True)
    text = html.read_text()
    for f in sorted({m.group(2) for m in HOST_STATIC.finditer(text)}):
        shutil.copyfile(static / f, d / f)
    (d / "index.html").write_text(HOST_STATIC.sub(r'\1="\2"', text))
    caps = json.loads(manifest.read_text())
    (d / "app.json").write_text(json.dumps({"title": title(name), "capabilities": caps}, indent=2) + "\n")
    for f in extra:
        shutil.copyfile(f, d / f.name)
    kind = "live" if caps else "static"
    print(f"{name:24} {kind:6} {', '.join(sorted(caps)) or '-'}")


def main(src, out):
    src, out = pathlib.Path(src), pathlib.Path(out)
    if out.exists():
        if any(p for p in out.iterdir() if not (p / "app.json").exists()):
            sys.exit(f"{out} holds something other than app folders; not touching it")
        shutil.rmtree(out)
    out.mkdir(parents=True)
    static = src.parent / "pkg" / "web" / "static"
    for manifest in sorted(src.glob("*.manifest.json")):
        name = manifest.name.removesuffix(".manifest.json")
        build(name, src / f"{name}.html", manifest, out, static)
    for d in sorted((src / "imports").iterdir()):
        if (d / "release.html").exists():
            extra = [f for f in d.iterdir() if f.name not in SKIP and f.is_file()]
            build(d.name, d / "release.html", d / "manifest.json", out, static, extra)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
