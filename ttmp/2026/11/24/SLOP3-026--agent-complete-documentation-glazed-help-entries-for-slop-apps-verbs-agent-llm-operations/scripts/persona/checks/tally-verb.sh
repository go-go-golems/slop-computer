. "$(dirname "$0")/lib.sh"
# A fresh machine: no learned aliases, no verb cache.
export XDG_CONFIG_HOME=$(mktemp -d)
mkdir -p "$XDG_CONFIG_HOME/slop"; cp "$SLOP_CREDENTIALS" "$XDG_CONFIG_HOME/slop/credentials.json"
h=$($SLOP on scores --help 2>&1); echo "$h" | grep -qw add && ok "slop on scores --help lists add" || no "slop on scores --help lists add" "$(echo "$h" | head -c 300)"
a=$($SLOP tally scores add bob 2>&1); [ $? = 0 ] && ok "slop tally scores add bob" "$(echo "$a" | tr -d '\n' | head -c 200)" || no "slop tally scores add bob" "$(echo "$a" | head -c 300)"
l=$($SLOP tally scores ls 2>&1); echo "$l" | grep -q bob && ok "slop tally scores ls shows bob" "$(echo "$l" | tr -d '\n' | head -c 200)" || no "slop tally scores ls shows bob" "$(echo "$l" | head -c 300)"
c=$($SLOP actor call scores ls 2>&1); echo "$c" | grep -q bob && ok "the count changed on the server" || no "the count changed on the server" "$(echo "$c" | head -c 200)"
x=$($SLOP tally scores add --help 2>&1); echo "$x" | grep -qi name && ok "add --help mentions the name" || no "add --help mentions the name" "$(echo "$x" | head -c 300)"
