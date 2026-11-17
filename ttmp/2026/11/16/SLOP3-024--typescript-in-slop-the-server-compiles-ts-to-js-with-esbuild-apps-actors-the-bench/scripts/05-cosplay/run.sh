#!/bin/bash
# One persona review round: one pi process per persona, in parallel, each in
# its own folder under the round's directory, driving the bench through
# benchdrive (on PATH). The playbook (playbook/01-…) says how to set up the
# server and the daemon first.
#
#   run.sh <round dir> <model> <thinking> <name>:<app id>[:<model>[:<thinking>]] …
#   ROUND_NOTES="…" ROUND_BENCH="glm-5.3:medium" \
#     run.sh $W/rounds/r2 lunaroute/glm-5.3-flash medium maya:maya-bakery devon:devon-kanban:lunaroute/glm-5.3:high
#
# <model> and <thinking> are the round's default; a persona may name its own.
# The round's settings go to <round dir>/round.json. Each persona's diary is
# <round dir>/<name>/diary.md; pi's output and session are beside it, and
# benchdrive records every command there too (BENCHDRIVE_RECORD: steps.jsonl
# and shots/). browse.mjs serves the rounds for reading.
#
# Only the lunaroute provider's extension is loaded (it supplies the
# lunaroute models); no other extension, skill, MCP server or context file.
# Personas start a few seconds apart (STAGGER, default 8): lunaroute
# throttles bursts. Exits when every persona has stopped (or after
# PERSONA_TIMEOUT seconds each, default 3600).
set -u
here=$(dirname "$(readlink -f "$0")")
round=$(readlink -f "$1") model=$2 thinking=$3; shift 3
mkdir -p "$round"
names=(); for spec in "$@"; do names+=("\"${spec%%:*}\""); done
cat > "$round/round.json" <<JSON
{"model": "$model", "thinking": "$thinking", "bench": "${ROUND_BENCH:-}", "notes": $(printf '%s' "${ROUND_NOTES:-}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'), "started": "$(date -u +%FT%TZ)", "personas": [$(IFS=,; echo "${names[*]}")], "specs": $(printf '%s\n' "$@" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().split()))')}
JSON
export BENCHDRIVE_RECORD=$round
first=1
for spec in "$@"; do
  IFS=: read -r name app pmodel pthinking <<<"$spec"
  pmodel=${pmodel:-$model} pthinking=${pthinking:-$thinking}
  dir=$round/$name; mkdir -p "$dir"
  brief=$here/personas/$name.md
  # a persona named *-visual works by eye: screenshots and pointer commands only
  prompt=$here/persona-prompt.md; case $name in *-visual) prompt=$here/persona-prompt-visual.md;; esac
  [ -f "$brief" ] || { echo "no brief $brief"; exit 1; }
  [ $first = 1 ] || sleep "${STAGGER:-8}"; first=0
  msg="Begin. Your benchdrive name is $name. The app you work on has the id \"$app\". Write your diary in diary.md here."
  ( cd "$dir" && timeout "${PERSONA_TIMEOUT:-3600}" pi -p --model "$pmodel" --thinking "$pthinking" \
      --no-context-files --no-skills --no-mcp --no-prompt-templates \
      --no-extensions -e "${LUNAROUTE_EXT:-$HOME/.pi/agent/npm/node_modules/@lunaroute/pi-extension}" \
      --tools bash,read,write,edit \
      --append-system-prompt "$(cat "$prompt" "$brief")" \
      --session-dir "$dir/session" \
      "$msg" > "$dir/pi.out" 2> "$dir/pi.err"
    echo "$name exited $? at $(date +%T) ($pmodel, thinking $pthinking)" >> "$round/done.log" ) &
done
wait
echo "round done: $(tr '\n' ';' < "$round/done.log")"
