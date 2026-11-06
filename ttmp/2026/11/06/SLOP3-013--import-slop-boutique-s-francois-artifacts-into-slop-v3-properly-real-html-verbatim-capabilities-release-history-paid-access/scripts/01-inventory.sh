#!/usr/bin/env bash
# SLOP3-013: francois's catalog as one JSON document, read-only.
#
# usage: 01-inventory.sh > inventory.json
#
# Reads catalog_artifacts, releases, release_files and release_attachments
# from the `francois` database on the cluster's postgres-0, in a session
# where every transaction is read-only (default_transaction_read_only=on),
# as the container's superuser over the local socket: no password leaves the
# cluster. Bytes are not read here; 03-import.py fetches the blobs it needs.
# User ids (release authors, attachment uploaders) are left out.
set -euo pipefail
: "${KUBECONFIG:=$HOME/code/wesen/2026-03-27--hetzner-k3s/kubeconfig-k3s-demo-1.tail879302.ts.net.yaml}"
export KUBECONFIG
kubectl exec -i -n postgres postgres-0 -- sh -c \
  'PGOPTIONS="-c default_transaction_read_only=on" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d francois -At -f -' <<'SQL'
SELECT json_build_object(
  'source', 'https://slop.boutique',
  'takenAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'artifacts', (SELECT coalesce(json_agg(json_build_object(
      'id', a.id, 'title', a.title, 'description', a.description, 'tags', a.tags,
      'visibility', a.visibility) ORDER BY a.id), '[]') FROM catalog_artifacts a),
  'releases', (SELECT coalesce(json_agg(json_build_object(
      'id', r.id, 'artifact', r.artifact_id, 'version', r.version, 'state', r.state,
      'freeSample', r.free_sample, 'manifest', r.manifest, 'changelog', r.changelog,
      'createdAt', r.created_at, 'publishedAt', r.published_at,
      'files', (SELECT coalesce(json_agg(json_build_object(
          'role', f.role, 'name', f.name, 'mediaType', f.media_type, 'size', f.size,
          'sha256', f.sha256, 'storageKey', f.storage_key) ORDER BY f.role), '[]')
        FROM release_files f WHERE f.release_id = r.id),
      'attachments', (SELECT coalesce(json_agg(json_build_object(
          'name', t.name, 'label', t.label, 'mediaType', t.media_type, 'size', t.size,
          'sha256', t.sha256, 'storageKey', t.storage_key, 'position', t.position)
          ORDER BY t.position, t.created_at), '[]')
        FROM release_attachments t WHERE t.release_id = r.id)
    ) ORDER BY r.artifact_id, r.created_at), '[]') FROM releases r)
);
SQL
