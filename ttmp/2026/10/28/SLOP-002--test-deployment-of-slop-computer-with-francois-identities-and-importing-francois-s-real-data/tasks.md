# Tasks

## TODO

- [x] Create ticket SLOP-002 and the guide/diary documents
- [x] Gather evidence: k3s package, ZITADEL Terraform, francois schema/capabilities/backups, slop serving/identity/seed
- [x] Write the intern guide (design-doc/01)
- [x] Diary (reference/01)
- [x] Upload the guide to reMarkable
- [x] Phase A [code]: `--oidc-client-id-file`; image publish workflow; doc/production.md Kubernetes section (db623c3)
- [x] PR #1 to main for review (https://github.com/go-go-golems/slop-computer/pull/1)
- [x] Gap G6 `--oidc-client-id-file` (db623c3); G1 push on behalf (c2ef259); G2 data files `/_d/` (c2ef259); G4 drafts/withdrawn as non-main versions (7ba914e)
- [x] Health checks answer on any host, for probes (35a62f8)
- [x] Phase C [code]: `slop import francois extract|push`, `slop db import-francois-admins`, DB + API sources, census, fixture test (7ba914e, 35a62f8)
- [x] Phase B [code]: gitops/kustomize/slop + Vault policies/roles + bootstrap-slop-secrets.sh (hetzner-k3s branch slop/test-deployment 5eaf707, not pushed)
- [x] Phase B [code]: ZITADEL slop-web client (terraform branch slop/zitadel-client abc678a, not pushed)
- [ ] Phase C: extract real data (studio API) → census.md; push into a local slop; agent builds catalog/journal pages on it
- [ ] Ask the owner of terraform commit 04fd555 (Slop sandbox client, applied but unpushed) how envs/slop should land
- [ ] Phase B [operator]: push/merge the two branches, terraform apply, bootstrap secrets + Vault roles, set image tag, apply Argo app, first admin
- [ ] Phase C [operator]: rehearse francois restore (db + blobs); DB-source import (real HTML for paid releases)
- [ ] Phase E [operator]: slop blobs in backups; decide on teardown
