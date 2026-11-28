. "$(dirname "$0")/lib.sh"
exp=$(cat "$RUN/expected.txt")
best=0; where=""
for st in $($SLOP store ls -o json | python3 -c 'import json,sys; print(" ".join(s["id"] for s in json.load(sys.stdin) or []))'); do
  n=$($SLOP store export "$st" -o json 2>/dev/null | python3 -c '
import json,sys,collections
b=json.load(sys.stdin).get("bundle") or {}; c=collections.Counter()
for d in b.get("docs") or []:
    c[d.get("path","").rsplit("/",1)[0]]+=1
for t,rows in (b.get("tables") or {}).items():
    c["table:"+t]+=len(rows if isinstance(rows,list) else (rows or {}).get("rows",[]))
k,v=(c.most_common(1) or [("",0)])[0]; print(v, k)')
  set -- $n; if [ "${1:-0}" -gt "$best" ]; then best=$1; where="$st ${2:-}"; fi
done
[ "$best" -ge 50 ] && ok "50 tasks stored" "$best in $where" || no "50 tasks stored" "largest: $best in $where"
replies | grep -Eqw "$exp" && ok "overdue count $exp given" || no "overdue count $exp given" "no reply contains $exp"
