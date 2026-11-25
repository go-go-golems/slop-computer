# Shared by the checkers: $SLOP talks to the run's server as the admin
# (SLOP_SERVER, SLOP_CREDENTIALS, XDG_CONFIG_HOME are the host-side login).
# Each check prints one JSON line: {"check", "ok", "detail"}.
set -u
LIVE="apps.localhost:$PORT"
emit() { python3 -c 'import json,sys; print(json.dumps({"check":sys.argv[1],"ok":sys.argv[2]=="1","detail":sys.argv[3][:600]}))' "$1" "$2" "$3"; }
ok() { emit "$1" 1 "${2:-}"; }
no() { emit "$1" 0 "${2:-}"; }
# get URL-PATH [HOST]: the HTTP status of a page on the live host
get() { curl -s -o /dev/null -w '%{http_code}' -H "Host: ${2:-$LIVE}" "http://127.0.0.1:$PORT$1"; }
# mounted PATH: the store a live mount at PATH names ("" if none)
mounted() { $SLOP mount ls -o json 2>/dev/null | python3 -c 'import json,sys
p=sys.argv[1]
for e in json.load(sys.stdin) or []:
    m=e.get("mount", e)  # mount ls rows are {kind, mount: {host, path, store}, url}
    if m.get("path")==p and e.get("kind","live")=="live": print(m.get("store") or m.get("storeParam") or "?"); break' "$1"; }
replies() { cat "$RUN/replies.txt" 2>/dev/null; }
# mounted_any PATH KIND: the store of a mount at PATH of KIND (live|static)
mounted_kind() { $SLOP mount ls -o json 2>/dev/null | python3 -c 'import json,sys
p,k=sys.argv[1],sys.argv[2]
for e in json.load(sys.stdin) or []:
    m=e.get("mount", e)
    if (m.get("path")==p or p=="*") and e.get("kind")==k: print(m.get("path"), m.get("store") or m.get("storeParam") or "?"); break' "$1" "$2"; }
# cell APP CAP AUDIENCE: "true"/"false", the effective policy cell
cell() { $SLOP policy ls "$1" -o json 2>/dev/null | python3 -c 'import json,sys
d=json.load(sys.stdin)
print(next((str(c["effective"]).lower() for c in d.get("cells",[]) if c["capability"]==sys.argv[1] and c["audience"]==sys.argv[2]), "missing"))' "$2" "$3"; }
# llmrow SUBJECT: "allowed budget" of an llm row, or "none"
llmrow() { $SLOP llm ls -o json 2>/dev/null | python3 -c 'import json,sys
r=next((x for x in json.load(sys.stdin) or [] if x.get("subject")==sys.argv[1]), None)
print("none" if r is None else "%s %s" % (str(r.get("allowed")).lower(), r.get("budget")))' "$1"; }
# appof STORE: the app store a store runs
appof() { $SLOP app status "$1" -o json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("app") or "")'; }
