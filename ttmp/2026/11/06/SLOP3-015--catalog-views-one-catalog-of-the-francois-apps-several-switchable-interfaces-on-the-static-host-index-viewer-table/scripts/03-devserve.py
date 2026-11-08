"""Local preview of the catalog views: /catalog/<view>/ from
apps/catalog-<view>, /catalog/ from apps/catalog plus the built data dir, and
/_d/ and /_s/ proxied (GET) to the production static host."""
import http.server, sys, os, urllib.request, mimetypes
REPO, DATA, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])
UP = "https://site.slop.yolo.scapegoat.dev"
VIEWS = ["list", "table", "sheet", "caps", "zine", "timeline", "treemap", "roulette", "term", "desktop", "agents", "shelf", "curator"]  # shelf and curator: layout only, without the live runtime
# The live views get their copy of the data at deploy time.
MOUNTS = [("/catalog/" + v + "/data", DATA) for v in ("shelf", "curator")] + [("/catalog/" + v, os.path.join(REPO, "apps/catalog-" + v)) for v in VIEWS] + [
          ("/catalog/data", DATA), ("/catalog", os.path.join(REPO, "apps/catalog"))]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        p = self.path.split("?")[0]
        if p.startswith(("/_d/", "/_s/")):
            try:
                with urllib.request.urlopen(UP + self.path, timeout=60) as r:
                    b = r.read(); self.send_response(r.status); self.send_header("Content-Type", r.headers.get("Content-Type", "")); self.end_headers(); self.wfile.write(b)
            except urllib.error.HTTPError as e:
                self.send_response(e.code); self.end_headers()
            return
        for m, d in MOUNTS:
            if p == m: self.send_response(308); self.send_header("Location", m + "/"); self.end_headers(); return
            if p.startswith(m + "/"):
                rest = p[len(m) + 1:] or "index.html"
                if rest.endswith("/"): rest += "index.html"
                f = os.path.join(d, rest)
                if os.path.isfile(f):
                    b = open(f, "rb").read(); self.send_response(200)
                    self.send_header("Content-Type", mimetypes.guess_type(f)[0] or "application/octet-stream"); self.end_headers(); self.wfile.write(b); return
        self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
