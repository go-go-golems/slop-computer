#!/bin/sh
# 02-local-alias-dashboard.sh <slop binary>: on a --local server the CLI is
# logged in to (SLOP_SERVER, SLOP_CREDENTIALS), set up SLOP3-008's
# dashboard case: a store "crm" with contacts and an uploaded picture, and
# the unmodified page in 02-dashboard/ as store "dash" at /dash on the live
# host, reading crm's contacts through the alias "contacts" (with uploads).
# Guests may view both. Safe to repeat.
set -eu
SLOP=$1
here=$(cd "$(dirname "$0")" && pwd)
LIVE=${LIVE_HOST:-apps.localhost:18320}
j() { $SLOP "$@" -o json >/dev/null; }
photo=a0123456789abcdef0123456789abcdef   # a 16-byte asset id, as new uploads get
png=$(python3 -I -c 'import base64,struct,zlib
def chunk(t,d): return struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff)
w=h=32; row=b"\x00"+bytes([217,119,87])*w
print(base64.b64encode(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",w,h,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(row*h))+chunk(b"IEND",b"")).decode())')
$SLOP store new crm -o json >/dev/null 2>&1 || true
j docs set --json '{"store":"crm","path":"contacts/c1","data":{"name":"Ada Lovelace","photo":"'$photo'"}}'
j files put --json '{"store":"crm","path":"'$photo'","data":"'$png'","type":"image/png","zone":"assets"}'
$SLOP store new dash -o json >/dev/null 2>&1 || true
j push "$here/02-dashboard" --store dash -m "dashboard"
j mount set --json '{"host":"'$LIVE'","path":"/dash","store":"dash"}'
j grant set --json '{"store":"dash","subject":"@guest","level":"interact"}'
j grant set --json '{"store":"crm","subject":"@guest","level":"view"}'
j bind set --json '{"store":"dash","alias":"contacts","target":"crm","prefix":"contacts","assets":true}'
$SLOP bind ls dash -o json
