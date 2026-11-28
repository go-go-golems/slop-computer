. "$(dirname "$0")/lib.sh"
st=$(mounted /ask)
[ -n "$st" ] && ok "mounted at /ask" "store $st" || { no "mounted at /ask" ""; exit 0; }
c=$(get /ask); [ "$c" = 200 ] && ok "page answers" || no "page answers" "→ $c"
app=$(appof "$st"); j=$($SLOP files cat "$app" app.json 2>&1)
echo "$j" | grep -Eq '"(sample|agent)"' && ok "declares sample or agent" || no "declares sample or agent" "$(echo "$j" | tr -d '\n' | head -c 300)"
[ "$(cell "$app" sample member)" = true ] && ok "policy on for members" || no "policy on for members" "$(cell "$app" sample member)"
r=$(llmrow @member); case "$r" in true*) ok "members have LLM access" "$r";; *) no "members have LLM access" "$r";; esac
[ "$(cell "$app" sample guest)" != true ] && ok "guests not allowed" || no "guests not allowed"
