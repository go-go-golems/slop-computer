. "$(dirname "$0")/lib.sh"
[ "$(cell guestbook-app sample member)" = true ] && ok "sample on for members (guestbook-app)" || no "sample on for members (guestbook-app)" "$(cell guestbook-app sample member)"
[ "$(cell guestbook-app sample guest)" = false ] && ok "sample off for guests" || no "sample off for guests" "$(cell guestbook-app sample guest)"
r=$(llmrow @member); [ "$r" = "true 50000" ] && ok "@member LLM on, budget 50000" "$r" || no "@member LLM on, budget 50000" "$r"
r=$(llmrow @guest); case "$r" in none|false*) ok "@guest no LLM access" "$r";; *) no "@guest no LLM access" "$r";; esac
ok "llm table (for the judge)" "$($SLOP llm ls -o json | tr -d '\n ' | head -c 400)"
