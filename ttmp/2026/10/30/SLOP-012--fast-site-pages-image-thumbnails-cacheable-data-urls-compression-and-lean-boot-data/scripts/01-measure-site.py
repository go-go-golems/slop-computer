#!/usr/bin/env python3
"""Measure a site page's weight: HTML (raw and gzipped), boot data per
binding, cover images referenced by records, and cache headers.

usage: 01-measure-site.py [page URL]   (default: the storefront on the test cluster)
Read-only: GET and HEAD requests only.
"""
import gzip
import json
import re
import sys
import time
import urllib.request

url = sys.argv[1] if len(sys.argv) > 1 else "https://site.slop.yolo.scapegoat.dev/"
base = re.match(r"(https?://[^/]+)", url).group(1)


def get(u, method="GET", headers=None):
    req = urllib.request.Request(u, method=method, headers=headers or {})
    t = time.time()
    with urllib.request.urlopen(req) as r:
        body = r.read() if method == "GET" else b""
        return r.status, dict(r.headers), body, time.time() - t


status, hdr, html, dt = get(url, headers={"Accept-Encoding": "gzip"})
raw = gzip.decompress(html) if hdr.get("Content-Encoding") == "gzip" else html
print(f"page {url}: {status}, {len(html)} bytes on the wire, {len(raw)} raw, "
      f"{len(gzip.compress(raw))} if gzipped, {dt:.2f}s")
print(f"  cache-control: {hdr.get('Cache-Control')}  content-encoding: {hdr.get('Content-Encoding')}  etag: {hdr.get('ETag')}")

text = raw.decode()
m = re.search(r'<script type="application/json" id="slop-boot">(.*?)</script>', text, re.S)
boot = json.loads(m.group(1)) if m else {}
print(f"  boot block: {len(m.group(1)) if m else 0} bytes")
for name, rows in (boot.get("data") or {}).items():
    print(f"    data.{name}: {len(rows)} records, {len(json.dumps(rows))} bytes")

# Images the page shows: cover.src of listed catalog records (storefront shape).
covers = [r.get("cover", {}).get("src") for r in (boot.get("data", {}).get("catalog") or [])
          if r.get("visibility") == "listed" and (r.get("cover") or {}).get("src")]
sizes = {}
for name, rows in (boot.get("data") or {}).items():
    for r in rows:
        if r.get("file"):
            sizes[r["path"].split("/")[-1]] = r.get("size") or 0
total = sum(sizes.get(c.split("/")[-1], 0) for c in covers)
print(f"  covers: {len(covers)}, {total/1e6:.1f} MB at full size")
if covers:
    c = covers[0]
    s, h, _, dt = get(base + c, method="HEAD")
    print(f"  first cover {c}: {s} cache-control={h.get('Cache-Control')} {dt:.2f}s")
    for w in (480,):
        try:
            s, h, b, dt = get(base + c + f"?w={w}")
            print(f"  first cover ?w={w}: {s} {len(b)} bytes type={h.get('Content-Type')} "
                  f"cache-control={h.get('Cache-Control')} {dt:.2f}s")
        except Exception as e:  # servers without thumbnails ignore or refuse ?w
            print(f"  first cover ?w={w}: {e}")
