#!/bin/bash
# box.sh WORK HOME SLOPBIN [KEY=VAL…] -- cmd…
# Runs cmd in a bubblewrap box that holds only: WORK (rw, as ~/work and the
# cwd), HOME (rw, as /home/agent), the system (/usr, /etc, ro), node and pi
# (ro), pi's npm packages (ro, /opt/pinpm) and the slop binary (/opt/bin).
# The repository, ~/.config, ~/.claude and the real ~/.pi are not there.
# Code hosts resolve nowhere (hosts.blocked): no git clone of slop.
# Node is only node, npm and pi at /opt/node: the real install (under the real
# home, with global packages) is not there (round 3 loaded puppeteer from it).
# The environment is empty but for HOME, PATH, TZ=UTC, TERM and the KEY=VALs.
set -euo pipefail
W=$1; H=$2; SB=$3; shift 3
ENVS=()
while [ "$1" != "--" ]; do ENVS+=("$1"); shift; done; shift
NODE_DIR=$(dirname "$(dirname "$(command -v node)")")
exec bwrap --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind "$(dirname "$0")/hosts.blocked" /etc/hosts --symlink usr/bin /bin --symlink usr/lib /lib \
  --symlink usr/sbin /sbin --ro-bind-try /lib64 /lib64 --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind-try /run/systemd/resolve /run/systemd/resolve \
  --tmpfs /home --bind "$H" /home/agent \
  --tmpfs /opt --ro-bind "$HOME/.pi/agent/npm" /opt/pinpm \
  --ro-bind "$NODE_DIR/bin/node" /opt/node/bin/node --ro-bind "$NODE_DIR/lib/node_modules/npm" /opt/node/lib/node_modules/npm \
  --ro-bind "$NODE_DIR/lib/node_modules/@earendil-works" /opt/node/lib/node_modules/@earendil-works \
  --symlink ../lib/node_modules/npm/bin/npm-cli.js /opt/node/bin/npm --symlink ../lib/node_modules/npm/bin/npx-cli.js /opt/node/bin/npx \
  --symlink ../lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js /opt/node/bin/pi --bind "$W" /home/agent/work \
  --ro-bind "$SB" /opt/bin/slop --chdir /home/agent/work --unshare-pid --die-with-parent \
  /usr/bin/env -i HOME=/home/agent PATH=/opt/bin:/opt/node/bin:/usr/bin TZ=UTC TERM=dumb "${ENVS[@]}" "$@"
