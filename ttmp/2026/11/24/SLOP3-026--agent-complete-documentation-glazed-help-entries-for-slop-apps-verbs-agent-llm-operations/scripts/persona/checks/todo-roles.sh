. "$(dirname "$0")/lib.sh"
st=$(mounted /todo)
[ -n "$st" ] && ok "mounted at /todo" "store $st" || { no "mounted at /todo" ""; exit 0; }
s=$($SLOP app status "$st" -o json 2>&1); echo "$s" | grep -q '"broken": "[^"]' && no "app not broken" "$s" || ok "app not broken"
g=$($SLOP explain can "$st" view --subject anonymous -o json 2>&1); echo "$g" | grep -q '"ok": false' && ok "guests cannot view" || no "guests cannot view" "$(echo "$g" | head -c 200)"
gr=$($SLOP grant ls "$st" -o json 2>&1); echo "$gr" | python3 -c 'import json,sys; g=json.load(sys.stdin) or []; sys.exit(0 if any(x.get("subject")=="@member" and x.get("level")=="interact" for x in g) else 1)' && ok "members hold interact (not admin)" || no "members hold interact (not admin)" "$(echo "$gr" | tr -d '\n ' | head -c 300)"
app=$(appof "$st"); src=$($SLOP files cat "$app" actor.js 2>/dev/null; $SLOP files cat "$app" app.json 2>/dev/null)
ok "app source (for the judge)" "$(echo "$src" | tr -s ' \n' ' ' | head -c 580)"
