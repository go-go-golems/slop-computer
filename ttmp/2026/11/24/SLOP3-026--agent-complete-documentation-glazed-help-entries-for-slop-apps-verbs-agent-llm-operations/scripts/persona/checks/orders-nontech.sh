# The orders export, asked for by a non-technical person: the same facts as orders-export.
exec node "$(dirname "$0")/js/orders-export.mjs"
