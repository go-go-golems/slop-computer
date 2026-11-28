. "$(dirname "$0")/lib.sh"
s=$($SLOP app status notes -o json 2>&1)
echo "$s" | grep -q '"broken": ""' && ok "notes not broken" || no "notes not broken" "$(echo "$s" | tr -d '\n' | head -c 300)"
c=$(get /notes); [ "$c" = 200 ] && ok "/notes answers" || no "/notes answers" "→ $c"
$SLOP files cat notes-app app.json 2>/dev/null | grep -q storage && no "storage removed from app.json" || ok "storage removed from app.json"
