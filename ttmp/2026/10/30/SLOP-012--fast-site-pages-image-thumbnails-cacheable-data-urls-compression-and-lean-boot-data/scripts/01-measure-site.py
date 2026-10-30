#!/usr/bin/env python3
"""Measure a site page's weight: HTML (on the wire, raw, gzipped), its data
(inline in the boot block, or /_r/ scripts since SLOP-012), the cover images
its catalog records name, and cache headers.

usage: 01-measure-site.py [page URL]   (default: the storefront on the test cluster)
Read-only: GET and HEAD requests only.
"""
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.request

url = sys.argv[1] if len(sys.argv) > 1 else "https://site.slop.yolo.scapegoat.dev/"
base = re.match(r"(https?://[^/]+)", url).group(1)


def get(u, method="GET", headers=None):
    req = urllib.request.Request(u, method=method, headers=headers or {})
    t = time.time()
    with urllib.request.urlopen(req) as r:
        body = r.read() if method == "GET" else b""
        return r.status, r.headers, body, time.time() - t


def text(hdr, body):
    return gzip.decompress(body) if hdr.get("Content-Encoding") == "gzip" else body


status, hdr, wire, dt = get(url, headers={"Accept-Encoding": "gzip"})
raw = text(hdr, wire)
print(f"page {url}: {status}, {len(wire)} bytes on the wire, {len(raw)} raw, "
      f"{len(gzip.compress(raw))} if gzipped, {dt:.2f}s")
print(f"  cache-control: {hdr.get('Cache-Control')}  content-encoding: {hdr.get('Content-Encoding')}  etag: {hdr.get('ETag')}")
if hdr.get("ETag"):
    try:
        get(url, headers={"If-None-Match": hdr.get("ETag")})
        print("  revalidation: 200 (the page changed or the ETag did not match)")
    except urllib.error.HTTPError as e:
        print(f"  revalidation: {e.code}")

page = raw.decode()
m = re.search(r'<script type="application/json" id="slop-boot">(.*?)</script>', page, re.S)
boot = json.loads(m.group(1)) if m else {}
print(f"  boot block: {len(m.group(1)) if m else 0} bytes")

# Each binding: inline rows, or "<artifact>@<n>" loaded from /_r/<artifact>/<n>.js.
data = {}
for name, val in (boot.get("data") or {}).items():
    if isinstance(val, str):
        a, n = val.split("@")
        s, h, b, dt = get(f"{base}/_r/{a}/{n}.js", headers={"Accept-Encoding": "gzip"})
        body = text(h, b).decode()
        rows = json.loads(body[body.index(",") + 1: body.rindex(")")])
        print(f"    data.{name}: {len(rows)} records from /_r/{a}/{n}.js, {len(b)} bytes on the wire "
              f"({h.get('Content-Encoding') or 'plain'}), cache-control={h.get('Cache-Control')}")
    else:
        rows = val
        print(f"    data.{name}: {len(rows)} records inline, {len(json.dumps(rows))} bytes")
    data[name] = rows

# Images the page shows: cover.src of listed catalog records (storefront shape).
covers = [r["cover"]["src"] for r in (data.get("catalog") or [])
          if r.get("visibility") == "listed" and (r.get("cover") or {}).get("src")]
print(f"  covers: {len(covers)}")
if covers:
    c = re.sub(r"^https?://slop\.boutique", "", covers[0])
    for q in ("", "?w=640"):
        try:
            s, h, b, dt = get(base + c + q)
            print(f"  first cover {c}{q}: {s} {len(b)} bytes {h.get('Content-Type')} cache-control={h.get('Cache-Control')} {dt:.2f}s")
        except urllib.error.HTTPError as e:
            print(f"  first cover {c}{q}: {e.code}")
