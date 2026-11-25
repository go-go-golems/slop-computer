#!/bin/sh
# look: the agent's browser inside the box (BROWSER=1). It runs look.mjs on
# the person's live site and prints what a person at that screen sees.
case "${1:-}" in -h|--help|"")
cat <<'H'
look ACTIONS-JSON: open the person's site in a real browser (Chrome) and see
what a person sees there: the page's text, buttons, links, fields, pictures,
downloaded files, and what did not work. Pages are on the live host, so paths
are the mount paths (for example /orders).

ACTIONS-JSON is a list, done in order:
  {"as": "me"}          signed in as Sam, a team member (the default)
  {"as": "colleague"}   signed in as Kim, another team member
  {"as": "guest"}       not signed in
  {"open": "/path"}     open a page (each look starts by opening one)
  {"click": "text"}     press the button, link or checkbox with that text
  {"type": "label", "text": "..."}  fill the field with that label or placeholder
  {"press": "Enter"}    press a key in the last field
  {"choose_file": "photo"}  pick a sample picture in the page's file chooser
  {"wait": 3}           wait 3 seconds

Each person stays signed in between looks; open pages do not. Two people in
one look see each other live (both pages stay open until the end).
A full-page screenshot of each person's page is saved under ~/look/shots.

Example:
  look '[{"open":"/orders"},{"click":"Export"},{"click":"Save"}]'
  look '[{"as":"guest"},{"open":"/photos"}]'
H
exit 0;; esac
D=$HOME/look; mkdir -p "$D"
T=look-$(date +%H%M%S)
printf '%s' "$1" | node /opt/look.mjs "$D" "$T" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { const r = JSON.parse(s); console.log(r.seen); for (const f of r.shots) console.log("screenshot: ~/look/shots/" + f); }
  catch { console.log(s || "look failed"); process.exitCode = 1; } });'
