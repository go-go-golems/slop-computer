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
for m in json.load(sys.stdin) or []:
    if m.get("path")==p: print(m.get("store") or m.get("storeParam") or "?"); break' "$1"; }
replies() { cat "$RUN/replies.txt" 2>/dev/null; }
