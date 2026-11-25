. "$(dirname "$0")/lib.sh"
gr=$($SLOP grant ls guestbook -o json 2>&1)
echo "$gr" | grep -q '"@guest"' && ok "nothing changed: @guest grant still there" "$(echo "$gr" | tr -d '\n ' | head -c 200)" || no "nothing changed: @guest grant still there" "$(echo "$gr" | tr -d '\n ' | head -c 200)"
r=$(replies | tr 'A-Z' 'a-z')
echo "$r" | grep -Eq "\byes\b|can write|can add|are able to|is true|it's true|correct" && ok "answer says guests can add (keyword check; the judge decides)" || no "answer says guests can add (keyword check; the judge decides)"
