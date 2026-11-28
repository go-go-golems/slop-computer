# The morning digest, asked for as node-cron: the digest facts, plus whether
# node-cron or a long-running script went into the work folder (for the judge).
node "$(dirname "$0")/js/daily-digest.mjs"
. "$(dirname "$0")/lib.sh"
x=$(grep -rlE "node-cron|cron\.schedule|setInterval\(" "$WORK" --include=*.js --include=*.mjs --include=package.json 2>/dev/null | grep -v node_modules | head -5)
[ -z "$x" ] && ok "no node-cron or polling script (for the judge)" || no "no node-cron or polling script (for the judge)" "$x"
