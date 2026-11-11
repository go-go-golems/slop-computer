#!/usr/bin/env python3
"""Publish HTML and Markdown reports on slop, one store per report (SLOP3-020).

A report is a store of type "report" that carries its own page. The live
host serves every such store at /r/<id> through one mount, to the people
who hold a level on it: the owner, people granted view, and anyone who
opened a share link. Nothing is public unless you make it so.

  publish.py publish SOURCE [--id ID] [--title T] [--show-title]
                            [--link DAYS] [--grant usr_… …] [--grant-file FILE]
  publish.py link ID [--days N]
  publish.py ls

SOURCE is a Markdown file (rendered with pandoc), an HTML file, or a
directory with an index.html. Without --id a new report gets a generated
id; with the id of an existing report, that report is updated in place
(its grants and links stay).

The script calls the slop CLI (SLOP, else "slop" on PATH) with its usual
credentials and server (--server, SLOP_SERVER, the default login). It never
reads or prints the token. A link's URL holds a secret: it is printed once.
"""
import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CSS = HERE / "report.css"
TYPE = "report"
META = "report/meta"
MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"
NEUTRAL_TITLE = "Report"


class Fail(Exception):
    pass


# ---------- the slop CLI ----------

class Slop:
    def __init__(self, server=None, dry=False):
        self.bin = os.environ.get("SLOP") or shutil.which("slop") or "slop"
        self.server = server
        self.dry = dry

    def __call__(self, *args, write=False, ok_codes=()):
        cmd = [self.bin, *args, "-o", "json"]
        if self.server:
            cmd += ["--server", self.server]
        if write and self.dry:
            print("dry-run: slop " + " ".join(args), file=sys.stderr)
            return None
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode != 0:
            err = (p.stderr or p.stdout).strip()
            for code in ok_codes:
                if code in err:
                    return None
            raise Fail("slop " + " ".join(args[:2]) + ": " + err)
        out = p.stdout.strip()
        return json.loads(out) if out else None

    def one(self, *args, **kw):
        """A command that answers one object (some print it as a list of one)."""
        r = self(*args, **kw)
        return r[0] if isinstance(r, list) and len(r) == 1 else r


# ---------- Markdown → one HTML page ----------

FRONT = re.compile(r"\A---[ \t]*\n(.*?)\n---[ \t]*\n", re.S)
WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")
CALLOUT = re.compile(r"^([ \t]*>[ \t]*)\[!(\w+)\][+-]?[ \t]*(.*)$", re.M)
EMBED = re.compile(r"!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")


def front_title(front):
    """The title: field of YAML front matter (one line, quoted or not)."""
    for line in front.splitlines():
        m = re.match(r"^title:\s*(.*)$", line)
        if m:
            v = m.group(1).strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            return v.strip() or None
    return None


def prepare_markdown(text):
    """Make Obsidian-flavoured Markdown portable; return (title or None, text).

    - YAML front matter is removed; its title is returned.
    - ![[image.png]] embeds become ![](image.png).
    - [[target|text]] and [[target]] wikilinks become their text.
    - "> [!summary] Heading" callouts become a blockquote that starts with
      a bold label ("**Summary.** Heading").
    """
    title = None
    m = FRONT.match(text)
    if m:
        title = front_title(m.group(1))
        text = text[m.end():]
    text = EMBED.sub(lambda m: "![](" + m.group(1).strip().replace(" ", "%20") + ")", text)
    text = WIKILINK.sub(lambda m: (m.group(2) or m.group(1)).strip(), text)
    text = CALLOUT.sub(lambda m: m.group(1) + "**" + m.group(2).capitalize() + ".**" + (" " + m.group(3) if m.group(3) else ""), text)
    return title, text


def first_heading(text):
    m = re.search(r"^#\s+(.+?)\s*#*\s*$", text, re.M)
    return m.group(1).strip() if m else None


MERMAID_BLOCK = re.compile(r'<pre class="mermaid"><code>(.*?)</code></pre>', re.S)


def finish_html(page):
    """Turn pandoc's mermaid code blocks into diagrams; returns (page, count)."""
    page, n = MERMAID_BLOCK.subn(lambda m: '<pre class="mermaid">' + m.group(1) + "</pre>", page)
    if n:
        tag = ('<script src="' + MERMAID + '"></script>\n'
               "<script>mermaid.initialize({startOnLoad: true, theme: "
               "matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'});</script>\n")
        page = page.replace("</body>", tag + "</body>", 1)
    return page, n


def render_markdown(src, title, out):
    if not shutil.which("pandoc"):
        raise Fail("pandoc is needed to render Markdown (https://pandoc.org)")
    _, text = prepare_markdown(src.read_text(encoding="utf-8"))
    p = subprocess.run(
        ["pandoc", "--from", "markdown+autolink_bare_uris-yaml_metadata_block", "--to", "html5",
         "--standalone", "--embed-resources", "--css", str(CSS),
         "--resource-path", str(src.parent), "--metadata", "pagetitle=" + title,
         "--syntax-highlighting=pygments" if pandoc_version() >= (3, 8) else "--highlight-style=pygments"],
        input=text, capture_output=True, text=True, cwd=src.parent)
    if p.returncode != 0:
        raise Fail("pandoc: " + p.stderr.strip())
    for line in p.stderr.splitlines():
        print("pandoc: " + line, file=sys.stderr)
    page, n = finish_html(p.stdout)
    (out / "index.html").write_text(page, encoding="utf-8")
    return n


def pandoc_version():
    m = re.search(r"pandoc\S*\s+(\d+)\.(\d+)", subprocess.run(["pandoc", "--version"], capture_output=True, text=True).stdout)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


# ---------- building the site ----------

def title_of(src, given):
    if given:
        return given
    if src.is_file() and src.suffix.lower() in (".md", ".markdown"):
        text = src.read_text(encoding="utf-8")
        t, body = prepare_markdown(text)
        return t or first_heading(body) or src.stem
    page = src / "index.html" if src.is_dir() else src
    m = re.search(r"<title[^>]*>(.*?)</title>", page.read_text(encoding="utf-8", errors="replace"), re.S | re.I)
    if m and m.group(1).strip():
        return html.unescape(m.group(1).strip())
    return src.stem if src.is_file() else src.name


def build(src, title, show_title, out):
    """Write the report's files into out: index.html, assets, app.json."""
    if src.is_dir():
        if not (src / "index.html").is_file():
            raise Fail(str(src) + " has no index.html")
        shutil.copytree(src, out, dirs_exist_ok=True)
        what = "directory"
    elif src.suffix.lower() in (".md", ".markdown"):
        n = render_markdown(src, title, out)
        what = "markdown" + (" (" + str(n) + " mermaid)" if n else "")
    elif src.suffix.lower() in (".html", ".htm"):
        shutil.copy(src, out / "index.html")
        what = "html"
    else:
        raise Fail("publish a .md, .html or a directory with index.html, not " + src.name)
    if (out / "app.json").exists():
        print("note: the source's app.json is replaced", file=sys.stderr)
    (out / "app.json").write_text(json.dumps(
        {"title": title if show_title else NEUTRAL_TITLE, "type": TYPE, "page": "index.html"}, indent=2) + "\n")
    return what


# ---------- the report store ----------

def report_url(slop, rid):
    """The report's address, from the server's typed /r/:id mount."""
    for row in slop("mount", "ls") or []:
        m = row.get("mount") or {}
        if m.get("type") == TYPE and m.get("storeParam") and row.get("kind", "live") == "live":
            host = m["host"]
            scheme = "http" if "localhost" in host else "https"
            return scheme + "://" + host + m["path"].replace(":" + m["storeParam"], rid)
    return None


def existing(slop, rid):
    meta = slop.one("store", "meta", "--id", rid, ok_codes=("not_found",))
    if meta is None:
        return None
    t = (meta.get("meta") or {}).get("type") or (meta.get("store") or {}).get("type") or ""
    if t != TYPE:
        raise Fail(rid + " is a store of type " + repr(t) + ", not a report: choose another --id")
    return meta


def publish(a):
    slop = Slop(a.server, a.dry_run)
    src = Path(a.source).expanduser().resolve()
    if not src.exists():
        raise Fail(str(src) + " does not exist")
    title = title_of(src, a.title)
    grants = list(a.grant or [])
    if a.grant_file:
        grants += [l.split("#")[0].strip() for l in Path(a.grant_file).read_text().splitlines() if l.split("#")[0].strip()]
    for g in grants:
        if not re.match(r"^(usr|vis)_[0-9a-f]+$", g):
            raise Fail("grant subjects are user ids (usr_…), not " + repr(g) + ": see `slop whoami` on their side")

    with tempfile.TemporaryDirectory(prefix="report-") as tmp:
        out = Path(tmp)
        what = build(src, title, a.show_title, out)
        size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
        print(f"built {what}: {title!r}, {size / 1024:.0f} KiB", file=sys.stderr)

        rid, old = a.id, None
        if rid:
            if existing(slop, rid):
                got = slop.one("docs", "get", rid, META, ok_codes=("not_found",))
                old = (got or {}).get("body") or {}
            else:
                slop("store", "new", "--id", rid, "--type", TYPE, write=True)
        else:
            made = slop.one("store", "new", "--type", TYPE, write=True)
            rid = made["id"] if made else "s-(new)"
        slop("push", str(out), "--store", rid, "-m", ("update: " if old is not None else "report: ") + title, write=True)

    now = int(time.time() * 1000)
    meta = {"title": title, "source": src.name, "publishedAt": (old or {}).get("publishedAt") or now,
            "updatedAt": now, "version": int((old or {}).get("version") or 0) + 1}
    slop("docs", "set", rid, META, "--data", json.dumps(meta), write=True)
    for g in grants:
        slop("grant", "set", rid, g, "view", write=True)

    url = report_url(slop, rid)
    done = ("would update" if a.dry_run else "updated") if old is not None else ("would publish" if a.dry_run else "published")
    print(done + f" {rid} (v{meta['version']}): {title}")
    print("  " + (url or "no /r/:id mount for type report on this server: see scripts/reports/README.md"))
    if grants:
        print(f"  view granted to {len(grants)} " + ("person" if len(grants) == 1 else "people"))
    if a.link is not None:
        make_link(slop, rid, a.link, url)


def make_link(slop, rid, days, url):
    args = ["link", "new", "--store", rid, "--level", "view", "--days", str(days)]
    if url:
        args += ["--url", url]
    r = slop.one(*args, write=True)
    if r is None:
        return
    exp = r["link"].get("expiresAt")
    when = time.strftime("%Y-%m-%d %H:%M", time.localtime(exp / 1000)) if exp else "until revoked"
    print(f"  link {r['link']['id']} (view, {'until ' + when if exp else when}):")
    print("  " + (r.get("url") or r.get("token")))


def link(a):
    slop = Slop(a.server)
    if not existing(slop, a.id):
        raise Fail("no report " + a.id)
    make_link(slop, a.id, a.days, report_url(slop, a.id))


def ls(a):
    slop = Slop(a.server)
    me = (slop.one("whoami") or {}).get("id")
    rows = [s for s in slop("store", "ls") or [] if s.get("type") == TYPE and s.get("owner") == me]
    if not rows:
        print("no reports yet")
        return
    now = time.time() * 1000
    for s in sorted(rows, key=lambda s: -s.get("createdAt", 0)):
        m = (slop.one("docs", "get", s["id"], META, ok_codes=("not_found",)) or {}).get("body") or {}
        links = slop("link", "ls", "--store", s["id"]) or []
        live = [l for l in links if not l.get("revokedAt") and (not l.get("expiresAt") or l["expiresAt"] > now)]
        grants = slop("grant", "ls", "--store", s["id"]) or []
        print(f"{s['id']}  v{m.get('version', '?')}  {m.get('title', '(no title)')}")
        print(f"    {len(grants)} grant(s); links: " + (", ".join(
            f"{l['id']} uses {l.get('uses', 0)} " + ("until revoked" if not l.get("expiresAt") else "until " + time.strftime("%Y-%m-%d", time.localtime(l["expiresAt"] / 1000)))
            for l in live) or "none active"))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--server", help="slop server (default: $SLOP_SERVER, then the default login)")
    sub = p.add_subparsers(dest="cmd", required=True)
    pp = sub.add_parser("publish", help="publish or update a report")
    pp.add_argument("source", help="a .md or .html file, or a directory with index.html")
    pp.add_argument("--id", help="the report's store id (default: a new generated one); an existing report is updated")
    pp.add_argument("--title", help="the title (default: front matter, first heading, <title>, file name)")
    pp.add_argument("--show-title", action="store_true", help="put the title in app.json too: the shell then shows it, also to people without access")
    pp.add_argument("--link", type=int, metavar="DAYS", help="also make a view link that works this many days (0: until revoked)")
    pp.add_argument("--grant", action="append", metavar="usr_…", help="give this person view (repeatable)")
    pp.add_argument("--grant-file", help="a file of user ids, one per line (# comments)")
    pp.add_argument("--dry-run", action="store_true", help="build and print what would be done, change nothing")
    pp.set_defaults(fn=publish)
    pl = sub.add_parser("link", help="make a view link for a report")
    pl.add_argument("id")
    pl.add_argument("--days", type=int, default=7, help="how long it works (0: until revoked; default 7)")
    pl.set_defaults(fn=link)
    sub.add_parser("ls", help="your reports, their links and grants").set_defaults(fn=ls)
    a = p.parse_args(argv)
    try:
        a.fn(a)
    except Fail as e:
        print("error: " + str(e), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
