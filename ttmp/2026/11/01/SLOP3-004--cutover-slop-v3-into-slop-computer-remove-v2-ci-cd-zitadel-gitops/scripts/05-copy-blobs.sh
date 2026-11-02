#!/bin/sh
# 05-copy-blobs.sh: make v2's file bytes available to v3, inside the running
# slop pod. Both blob stores use the same layout (blobs/<2>/<sha256>) on
# the same volume, so this hard-links v2's files into v3's store: instant,
# no extra space, and v2's store is left as it is. Existing files are kept
# (-n). After it, files.push manifests that name these hashes need no upload.
set -eu
kubectl -n slop exec deploy/slop -- sh -c '
	src=/var/lib/slop/blobs/blobs dst=/var/lib/slop/v3/blobs/blobs
	before=$(find $dst -type f | wc -l)
	cp -aln $src/. $dst/
	echo "v3 blobs: $before -> $(find $dst -type f | wc -l) ($(find $src -type f | wc -l) in v2)"
'
