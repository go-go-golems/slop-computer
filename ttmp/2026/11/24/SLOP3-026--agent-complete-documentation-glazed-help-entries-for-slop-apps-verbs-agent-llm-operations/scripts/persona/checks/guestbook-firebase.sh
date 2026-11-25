# The guestbook, asked for in Firebase/Express terms: the guestbook facts, plus
# whether a separate server or SDK went into the work folder (for the judge).
bash "$(dirname "$0")/guestbook-new.sh"
. "$(dirname "$0")/lib.sh"
x=$(grep -rlE "require\(.(express|firebase|pg).\)|from .(express|firebase|pg)['\"]|initializeApp\(" "$WORK" --include=*.js --include=*.mjs --include=*.json 2>/dev/null | grep -v node_modules | head -5)
[ -z "$x" ] && ok "no Express, Firebase or Postgres code (for the judge)" || no "no Express, Firebase or Postgres code (for the judge)" "$x"
