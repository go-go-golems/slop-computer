. "$(dirname "$0")/lib.sh"
st=$(mounted /guestbook)
[ -n "$st" ] && ok "mounted at /guestbook" "store $st" || { no "mounted at /guestbook" "$($SLOP mount ls -o json 2>&1 | head -c 400)"; exit 0; }
c=$(get /guestbook); [ "$c" = 200 ] && ok "page answers" "GET /guestbook → $c" || no "page answers" "GET /guestbook → $c"
s=$($SLOP app status "$st" -o json 2>&1); echo "$s" | grep -q '"broken": "[^"]' && no "app not broken" "$s" || ok "app not broken" "$(echo "$s" | tr -d '\n' | head -c 300)"
g=$($SLOP explain can "$st" view --subject anonymous -o json 2>&1); echo "$g" | grep -q '"ok": true' && ok "guests can read (view)" || no "guests can read (view)" "$g"
g=$($SLOP explain can "$st" interact --subject anonymous -o json 2>&1); echo "$g" | grep -q '"ok": false' && ok "guests below interact" || no "guests below interact" "$(echo "$g" | head -c 300)"
gr=$($SLOP grant ls "$st" -o json 2>&1); echo "$gr" | python3 -c 'import json,sys; g=json.load(sys.stdin) or []; sys.exit(0 if any(x.get("subject")=="@member" and x.get("level") in ("interact","admin") for x in g) else 1)' && ok "members reach interact" "$(echo "$gr" | tr -d '\n ' | head -c 300)" || no "members reach interact" "grants: $(echo "$gr" | tr -d '\n ' | head -c 300)"
ok "app.json (for the judge)" "$($SLOP files cat "$($SLOP app status "$st" -o json | python3 -c 'import json,sys; print(json.load(sys.stdin).get("app") or "")')" app.json 2>&1 | tr -d '\n' | head -c 500)"
