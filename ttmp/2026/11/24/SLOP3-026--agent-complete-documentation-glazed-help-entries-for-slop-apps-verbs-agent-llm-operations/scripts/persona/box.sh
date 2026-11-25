#!/bin/bash
# box.sh WORK HOME SLOPBIN [KEY=VAL…] -- cmd…
# Runs cmd in a bubblewrap box that holds only: WORK (rw, as ~/work and the
# cwd), HOME (rw, as /home/agent), the system (/usr, /etc, ro), node and pi
# (ro), pi's npm packages (ro, /opt/pinpm) and the slop binary (/opt/bin).
# The repository, ~/.config, ~/.claude and the real ~/.pi are not there.
# Code hosts resolve nowhere (hosts.blocked): no git clone of slop.
# The environment is empty but for HOME, PATH, TERM and the KEY=VALs given.
set -euo pipefail
W=$1; H=$2; SB=$3; shift 3
ENVS=()
while [ "$1" != "--" ]; do ENVS+=("$1"); shift; done; shift
NODE_DIR=$(dirname "$(dirname "$(command -v node)")")
exec bwrap --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind "$(dirname "$0")/hosts.blocked" /etc/hosts --symlink usr/bin /bin --symlink usr/lib /lib \
  --symlink usr/sbin /sbin --ro-bind-try /lib64 /lib64 --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind-try /run/systemd/resolve /run/systemd/resolve \
  --tmpfs /home --bind "$H" /home/agent --ro-bind "$NODE_DIR" "$NODE_DIR" \
  --tmpfs /opt --ro-bind "$HOME/.pi/agent/npm" /opt/pinpm --bind "$W" /home/agent/work \
  --ro-bind "$SB" /opt/bin/slop --chdir /home/agent/work --unshare-pid --die-with-parent \
  /usr/bin/env -i HOME=/home/agent "PATH=/opt/bin:$NODE_DIR/bin:/usr/bin" TERM=dumb "${ENVS[@]}" "$@"
