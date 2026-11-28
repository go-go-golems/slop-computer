. "$(dirname "$0")/lib.sh"
m=$(mounted_kind '*' static)
[ -n "$m" ] && ok "a static mount" "$m" || { no "a static mount" "$(mounted_kind '*' live)"; exit 0; }
set -- $m; base=${1%/}
for f in "" about.html; do c=$(get "$base/$f" "site.localhost:$PORT"); [ "$c" = 200 ] && ok "static $base/$f answers 200" || no "static $base/$f answers 200" "→ $c"; done
replies | grep -q "site.localhost:$PORT" && ok "gave the static address" || no "gave the static address"
