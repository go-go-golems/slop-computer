#!/bin/bash
# Resume one persona of a round from its pi session (after a dropped model
# connection, or to restart it with a changed environment), with the same
# prompt, brief and model as run.sh. Its earlier pi.out/pi.err are kept as .N.
#
#   resume.sh <round dir> <name> <model> <thinking> ["message"]
set -u
here=$(dirname "$(readlink -f "$0")")
round=$(readlink -f "$1") name=$2 model=$3 thinking=$4
msg=${5:-"(Your connection to the model dropped for a moment. Continue exactly where you left off, in character: your benchdrive name is $name, and your diary is diary.md here.)"}
dir=$round/$name
prompt=$here/persona-prompt.md; case $name in *-visual) prompt=$here/persona-prompt-visual.md;; esac
n=1; while [ -e "$dir/pi.out.$n" ]; do n=$((n+1)); done
[ -e "$dir/pi.out" ] && mv "$dir/pi.out" "$dir/pi.out.$n"; [ -e "$dir/pi.err" ] && mv "$dir/pi.err" "$dir/pi.err.$n"
export BENCHDRIVE_RECORD=$round PATH="$here/shim:$PATH" SLOP_SERVER=http://127.0.0.1:9 SLOP_CREDENTIALS=/nonexistent
cd "$dir" && timeout "${PERSONA_TIMEOUT:-3300}" pi -p --continue --model "$model" --thinking "$thinking" \
  --no-context-files --no-skills --no-mcp --no-prompt-templates \
  --no-extensions -e "${LUNAROUTE_EXT:-$HOME/.pi/agent/npm/node_modules/@lunaroute/pi-extension}" \
  --tools bash,read,write,edit --append-system-prompt "$(cat "$prompt" "$here/personas/$name.md")" \
  --session-dir "$dir/session" "$msg" > "$dir/pi.out" 2> "$dir/pi.err"
echo "$name exited $? at $(date +%T) ($model, thinking $thinking, resumed)" >> "$round/done.log"
