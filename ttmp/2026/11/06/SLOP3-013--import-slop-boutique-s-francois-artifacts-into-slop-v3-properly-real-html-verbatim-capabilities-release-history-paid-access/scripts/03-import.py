#!/usr/bin/env python3
"""SLOP3-013: make slop's release stores match francois's catalog.

usage: 03-import.py <inventory.json> [--apply] [--only id,id] [--history]
                    [--plan-out plan.json] [--log-out apply.jsonl]
                    [--blob-cache DIR] [--blobs-from DIR]

Dry run by default: reads the inventory (01-inventory.sh) and the server's
release stores (store.ls, files.ls, grant.ls; reads only) and prints what an
apply would do. With --apply it writes, store by store:

  paid store:  grant.set @subscriber interact, grant.rm @guest, then push
  free store:  push, then grant.set @guest interact if missing

A store is pushed only when its tree differs from the desired tree
(index.html, app.json, francois.json, attachments/*), compared by path and
sha256, so a second run writes nothing. Blobs the server lacks (its
missing_blobs answer) are read from the francois pod's volume with
`kubectl exec … cat` (or from --blobs-from DIR/<sha256>), checked against
their sha256, cached in --blob-cache, and uploaded with files.blobs.

History (--history): older releases go to ref francois/<version>, oldest
first, before the latest is pushed to main; only releases the store's
grants allow (free ones, or paid ones in a paid store); never withdrawn ones.

Uses the slop CLI's login ($SLOP_CREDENTIALS or
~/.config/slop/credentials.json, server $SLOP_SERVER or the default); the
token is read, never printed. Never writes to francois.
"""
import argparse
import base64
import collections
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

SOURCE = "https://slop.boutique"
BLOB_BATCH = 32 << 20
CHUNK = 4 << 20
KEY = re.compile(r"^blobs/[0-9a-f]{2}/[0-9a-f]{64}$")
UNSAFE = re.compile(r"[^A-Za-z0-9._-]")  # francois pkg/catalog/routes.go safeName
SUBJECTS = ("@guest", "@member", "@subscriber")


# --- the slop API ----------------------------------------------------------

class APIError(Exception):
    def __init__(self, verb, status, body):
        self.verb, self.status, self.body = verb, status, body
        err = body.get("error") or {}
        self.code, self.extra = err.get("code"), err.get("extra") or {}
        super().__init__(f"{verb}: {status} {err.get('code')}: {err.get('message')}")


class Slop:
    def __init__(self):
        path = os.environ.get("SLOP_CREDENTIALS") or os.path.expanduser("~/.config/slop/credentials.json")
        creds = json.load(open(path))
        self.server = os.environ.get("SLOP_SERVER") or creds["default"]
        self._token = creds["servers"][self.server]["token"]

    def __call__(self, verb, args=None):
        req = urllib.request.Request(f"{self.server}/api/v1/{verb}", data=json.dumps(args or {}).encode(),
                                     method="POST", headers={"Authorization": "Bearer " + self._token,
                                                             "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.load(r).get("result")
        except urllib.error.HTTPError as e:
            try:
                body = json.load(e)
            except ValueError:
                body = {"error": {"code": "http", "message": str(e)}}
            raise APIError(verb, e.code, body) from None


# --- the desired state -----------------------------------------------------

def jtext(v):
    return json.dumps(v, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def sha(b):
    return hashlib.sha256(b).hexdigest()


def safe_name(name):
    n = UNSAFE.sub("_", name)
    return "_" + n if n.startswith(".") else n


def html_of(rel):
    return next(f for f in rel["files"] if f["role"] == "html")


def provenance(art, rel):
    h = html_of(rel)
    return {
        "source": SOURCE,
        "artifact": {k: art[k] for k in ("id", "title", "description", "tags", "visibility")},
        "release": {
            "id": rel["id"], "version": rel["version"], "state": rel["state"],
            "freeSample": rel["freeSample"], "publishedAt": rel["publishedAt"], "changelog": rel["changelog"],
            "manifest": rel["manifest"],
            "html": {"name": h["name"], "sha256": h["sha256"], "size": h["size"]},
            "attachments": [{"name": a["name"], "label": a["label"], "sha256": a["sha256"], "size": a["size"]}
                            for a in rel["attachments"]],
        },
    }


def desired_tree(art, rel):
    """path -> entry; entries with "text" are sent inline, the others by hash."""
    h = html_of(rel)
    tree = {"index.html": {"path": "index.html", "sha256": h["sha256"], "size": h["size"], "key": h["storageKey"]}}
    for a in rel["attachments"]:
        p = "attachments/" + safe_name(a["name"])
        if p in tree:
            raise SystemExit(f"{art['id']}: two attachments named {p}")
        tree[p] = {"path": p, "sha256": a["sha256"], "size": a["size"], "key": a["storageKey"]}
    app = {"title": art["title"], "page": "index.html", "capabilities": rel["manifest"]}
    for p, v in (("app.json", app), ("francois.json", provenance(art, rel))):
        t = jtext(v)
        tree[p] = {"path": p, "text": t, "sha256": sha(t.encode()), "size": len(t.encode())}
    return tree


def wire(tree):
    out = []
    for e in tree.values():
        if "text" in e:
            out.append({"path": e["path"], "text": e["text"]})
        else:
            out.append({"path": e["path"], "sha256": e["sha256"], "size": e["size"]})
    return out


# --- planning --------------------------------------------------------------

def plan(inv, slop, only, history):
    rels = collections.defaultdict(list)
    for r in inv["releases"]:
        rels[r["artifact"]].append(r)  # oldest first (01-inventory.sh orders by created_at)
    stores = {s["id"]: s for s in slop("store.ls", {"all": True})}
    out, skipped = [], []
    for art in inv["artifacts"]:
        sid = art["id"].replace("_", "-")
        if only and sid not in only:
            continue
        rs = rels.get(art["id"], [])
        pub = [r for r in rs if r["state"] == "published"]
        if not pub:
            skipped.append({"store": sid, "what": "artifact", "reason": "no published release"})
            continue
        st = stores.get(sid)
        if st is None or st.get("type") != "release":
            skipped.append({"store": sid, "what": "artifact", "reason": "no release store (create it first)"})
            continue
        main = pub[-1]
        paid = not main["freeSample"]
        hist = []
        for r in rs:
            if r is main:
                continue
            why = ("withdrawn" if r["state"] != "published"
                   else "paid release in a public store" if (not r["freeSample"] and not paid)
                   else None if history else "history off (--history)")
            if why:
                skipped.append({"store": sid, "what": f"{r['id']} {r['version']}", "reason": why})
            else:
                hist.append(r)
        tree = desired_tree(art, main)
        cur = {f["path"]: f["sha256"] for f in slop("files.ls", {"store": sid}) if f.get("zone", "tree") == "tree"}
        want = {p: e["sha256"] for p, e in tree.items()}
        grants = {g["subject"]: g["level"] for g in slop("grant.ls", {"store": sid})
                  if g["subject"] in SUBJECTS and g.get("via", "direct") == "direct"}
        want_g = {"@subscriber": "interact"} if paid else {"@guest": "interact"}
        refs = slop("ref.ls", {"store": sid}) or {}  # {"main": n, "francois/0.1.0": n, …}
        hist = [r for r in hist if f"francois/{r['version']}" not in refs]
        changes = sorted({p for p in want if want.get(p) != cur.get(p)} | {p for p in cur if p not in want})
        out.append({
            "store": sid, "release": main["id"], "version": main["version"], "paid": paid,
            "push": bool(changes), "changes": changes,
            "grants": {"have": grants, "want": want_g, "change": grants != want_g},
            "history": [{"release": r["id"], "version": r["version"]} for r in hist],
            "before": {"n": refs.get("main")},
            "_tree": tree, "_hist": hist, "_art": art,
        })
    return out, skipped


def describe(p):
    why = []
    ch = set(p["changes"])
    if "index.html" in ch:
        why.append("html")
    if "app.json" in ch:
        why.append("app.json")
    if "francois.json" in ch:
        why.append("provenance")
    att = [c for c in ch if c.startswith("attachments/")]
    if att:
        why.append(f"attachments×{len(att)}")
    other = [c for c in ch if c not in ("index.html", "app.json", "francois.json") and not c.startswith("attachments/")]
    if other:
        why.append(f"remove×{len(other)}")
    return why


# --- applying --------------------------------------------------------------

class Blobs:
    def __init__(self, cache, local):
        self.cache = pathlib.Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.local = pathlib.Path(local) if local else None

    @staticmethod
    def fetch(key, size):
        """Read a blob from the francois pod in 4 MiB pieces: one `kubectl exec
        cat` of a large file can end early (12,848,209 bytes arrived as
        10,780,672), so each piece's length is checked and retried."""
        if not KEY.match(key or ""):
            raise SystemExit(f"refusing storage key {key!r}")
        path = "/var/lib/francois/releases/" + key
        out = bytearray()
        while len(out) < size:
            n = min(CHUNK, size - len(out))
            for _ in range(4):
                piece = subprocess.run(["kubectl", "exec", "-n", "francois", "deploy/francois", "--", "sh", "-c",
                                        f'tail -c +{len(out) + 1} "$0" | head -c {n}', path],
                                       check=True, capture_output=True).stdout
                if len(piece) == n:
                    break
            else:
                raise SystemExit(f"{key}: short read at {len(out)} ({len(piece)} of {n} bytes, 4 tries)")
            out += piece
        return bytes(out)

    def get(self, digest, key, size):
        c = self.cache / digest
        if c.exists() and sha(c.read_bytes()) == digest:
            return c.read_bytes()
        if self.local and (self.local / digest).exists():
            data = (self.local / digest).read_bytes()
        else:
            data = self.fetch(key, size)
        if sha(data) != digest:
            raise SystemExit(f"blob {digest}: bytes hash to {sha(data)}")
        tmp = c.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(c)
        return data


def push(slop, blobs, sid, tree, message, ref=None):
    args = {"store": sid, "files": wire(tree), "message": message}
    if ref:
        args["ref"] = ref
    try:
        return slop("files.push", args), 0
    except APIError as e:
        if e.code != "missing_blobs":
            raise
        missing = e.extra.get("missing") or []
    keys = {e["sha256"]: (e["key"], e["size"]) for e in tree.values() if "key" in e}
    batch, size, sent = {}, 0, 0
    for d in missing:
        if d not in keys:
            raise SystemExit(f"{sid}: server wants {d}, which is not in the tree")
        data = blobs.get(d, *keys[d])
        if batch and size + len(data) > BLOB_BATCH:
            slop("files.blobs", {"store": sid, "blobs": batch})
            batch, size = {}, 0
        batch[d] = base64.b64encode(data).decode()
        size += len(data)
        sent += len(data)
    if batch:
        slop("files.blobs", {"store": sid, "blobs": batch})
    return slop("files.push", args), sent


def set_grants(slop, sid, g, log):
    for subject, level in g["want"].items():
        if g["have"].get(subject) != level:
            slop("grant.set", {"store": sid, "subject": subject, "level": level})
            log(store=sid, action="grant.set", subject=subject, level=level)
    for subject in g["have"]:
        if subject not in g["want"]:
            slop("grant.rm", {"store": sid, "subject": subject, "via": "direct"})
            log(store=sid, action="grant.rm", subject=subject)


def apply(slop, plans, blobs, logf):
    def log(**kv):
        kv["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        logf.write(json.dumps(kv) + "\n")
        logf.flush()

    for p in plans:
        sid = p["store"]
        if not (p["push"] or p["grants"]["change"] or p["history"]):
            continue
        if p["paid"] and p["grants"]["change"]:
            set_grants(slop, sid, p["grants"], log)  # close the store before the paid bytes arrive
        for r in p["_hist"]:
            t = desired_tree(p["_art"], r)
            res, sent = push(slop, blobs, sid, t, f"francois {r['id']} {r['version']} (history)", ref=f"francois/{r['version']}")
            log(store=sid, action="push", ref=f"francois/{r['version']}", release=r["id"], n=res.get("n"), sent=sent)
            print(f"{sid:40} history {r['version']} → snapshot {res.get('n')}")
        if p["push"] or p["history"]:
            res, sent = push(slop, blobs, sid, p["_tree"], f"francois {p['release']} {p['version']}")
            log(store=sid, action="push", ref="main", release=p["release"], before=p["before"]["n"], n=res.get("n"),
                files=res.get("files"), removed=res.get("removed"), sent=sent, changes=p["changes"])
            print(f"{sid:40} main {p['version']} → snapshot {res.get('n')} ({', '.join(describe(p)) or 'history'}; "
                  f"uploaded {sent:,} B)")
            if p["history"]:
                slop("ref.move", {"store": sid, "ref": f"francois/{p['version']}", "n": res["n"]})
                log(store=sid, action="ref.move", ref=f"francois/{p['version']}", n=res["n"])
        if not p["paid"] and p["grants"]["change"]:
            set_grants(slop, sid, p["grants"], log)
        if p["grants"]["change"]:
            print(f"{sid:40} grants {p['grants']['have']} → {p['grants']['want']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inventory")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--history", action="store_true")
    ap.add_argument("--plan-out")
    ap.add_argument("--log-out")
    ap.add_argument("--blob-cache", default=os.path.join(os.environ.get("TMPDIR", "/tmp"), "slop3-013-blobs"))
    ap.add_argument("--blobs-from", help="a directory of <sha256> files to use before the francois pod")
    ap.add_argument("--emit-apps", help="write each store's generated app.json to DIR/<store>.json (for apps.Parse)")
    a = ap.parse_args()

    inv = json.load(open(a.inventory))
    slop = Slop()
    only = {s for s in a.only.split(",") if s}
    plans, skipped = plan(inv, slop, only, a.history)

    n_push = sum(p["push"] for p in plans)
    n_grant = sum(p["grants"]["change"] for p in plans)
    n_hist = sum(len(p["history"]) for p in plans)
    reasons = collections.Counter(w for p in plans if p["push"] for w in describe(p))
    print(f"server {slop.server}; inventory {inv.get('takenAt')}; {len(plans)} stores")
    for p in plans:
        if p["push"] or p["grants"]["change"] or p["history"]:
            g = f" grants→{','.join(p['grants']['want'])}" if p["grants"]["change"] else ""
            h = f" history×{len(p['history'])}" if p["history"] else ""
            print(f"  {p['store']:40} {'paid' if p['paid'] else 'free'} {p['version']:8} "
                  f"{','.join(describe(p)) or '-'}{g}{h}")
    for s in skipped:
        print(f"  skip {s['store']:35} {s['what']:38} {s['reason']}")
    print(f"plan: {n_push} pushes ({dict(reasons)}), {n_grant} grant changes, {n_hist} history snapshots, "
          f"{len(skipped)} skipped")
    if a.plan_out:
        json.dump({"server": slop.server, "inventory": inv.get("takenAt"), "skipped": skipped,
                   "stores": [{k: v for k, v in p.items() if not k.startswith("_")} for p in plans]},
                  open(a.plan_out, "w"), indent=1)
    if a.emit_apps:
        os.makedirs(a.emit_apps, exist_ok=True)
        for p in plans:
            pathlib.Path(a.emit_apps, p["store"] + ".json").write_text(p["_tree"]["app.json"]["text"])
    if not a.apply:
        return
    with open(a.log_out or os.devnull, "a") as logf:
        apply(slop, plans, Blobs(a.blob_cache, a.blobs_from), logf)
    print("applied")


if __name__ == "__main__":
    try:
        main()
    except APIError as e:
        sys.exit(str(e))
