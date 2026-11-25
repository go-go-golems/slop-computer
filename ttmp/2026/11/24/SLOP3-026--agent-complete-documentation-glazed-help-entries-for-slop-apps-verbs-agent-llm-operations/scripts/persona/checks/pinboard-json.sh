. "$(dirname "$0")/lib.sh"
c=$($SLOP actor call kitchen clips --args '{"tag":"dinner"}' -o json 2>&1)
n=$(echo "$c" | python3 -c 'import json,sys
d=json.load(sys.stdin); l=d if isinstance(d,list) else (d.get("clips") or d.get("items") or [])
print(sum(1 for x in l if x.get("url")))' 2>/dev/null || echo 0)
[ "${n:-0}" -ge 3 ] && ok "3+ dinner links on kitchen" "$n" || no "3+ dinner links on kitchen" "$n: $(echo "$c" | head -c 200)"
replies | grep -q '"dinner"' && ok "JSON with the dinner tag in a reply" || no "JSON with the dinner tag in a reply"
