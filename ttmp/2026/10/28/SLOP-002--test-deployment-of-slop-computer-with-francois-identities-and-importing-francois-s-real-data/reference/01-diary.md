---
Title: Diary
Ticket: SLOP-002
Status: active
Topics:
    - deployment
    - auth
    - data-migration
    - architecture
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: ttmp/2026/10/28/SLOP-002--test-deployment-of-slop-computer-with-francois-identities-and-importing-francois-s-real-data/design-doc/01-intern-guide-deploying-slop-next-to-francois-sharing-identities-importing-francois-data.md
      Note: the guide this diary records the research for
ExternalSources: []
Summary: "Investigation log for SLOP-002: reading francois's k3s package, ZITADEL Terraform and schema to design a test deployment of slop and a francois importer."
LastUpdated: 2026-10-28T18:40:00-04:00
WhatFor: "Evidence behind the SLOP-002 intern guide."
WhenToUse: "When checking where a claim in the guide comes from, or resuming the ticket."
---

# Diary

## Goal

Record how the SLOP-002 guide was researched: which repositories and revisions were read, the commands run, what they showed, and the claims that remain unverified.

## Step 1: Ticket and evidence gathering

The question was how to deploy slop.computer for testing with francois's identities, and how to copy francois's real data into it to find out what slop is missing. Answering it means reading three other repositories: the k3s GitOps repo that runs francois, the Terraform repo that defines its ZITADEL organisation, and francois itself (schema, capabilities, backups). This step created the ticket and collected that evidence. Nothing in production, the cluster, Vault or Terraform was changed or applied.

### Prompt Context
**User prompt (verbatim):** "Ok, create anew docmgr ticket, and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
(Preceded by: "Ok, how would we deploy slop-computer for testing and potentially using the same identity data as francois, and then also copying over the real data from francois (or some set of artifacts) so we can play around with real data and identify what kind of support we would add?")
**Assistant interpretation:** Turn the answer to the deployment and import question into an intern-ready design and implementation guide in a new docmgr ticket, then upload it to reMarkable.
**Inferred user intent:** Hand the work to someone new without a walkthrough; the guide must stand on its own and point at real files.
**Commit (code):** none (documentation only; see Step 2 for the docs commit)

### What I did
- `docmgr ticket create-ticket --ticket SLOP-002 …`; added vocabulary topics `deployment` and `data-migration`; `docmgr doc add` for the design doc and the diary.
- k3s GitOps repo (`~/code/wesen/2026-03-27--hetzner-k3s`, HEAD `f758001`): read `gitops/kustomize/francois/` (kustomization, deployment, ingress, certificate(s), runtime-secret, vault-auth, db-bootstrap, network-policy), `gitops/applications/francois.yaml`, `vault/policies/kubernetes/francois-prod.hcl`, `vault/roles/kubernetes/francois-prod.json`, `scripts/bootstrap-francois-secrets.sh`.
- Terraform repo (`~/code/wesen/terraform`): `git status`, `git log`, and `git branch -r --contains 04fd555`; read `zitadel/francois/envs/prod/{main,variables}.tf` on `origin/main` and `zitadel/francois/envs/sandbox/main.tf` at `04fd555`; `git diff --stat` of the uncommitted work.
- francois (`../francois` @ `106776a`): `doc/production.md` §§1–3 and §10, `deploy/compose/compose.yaml`, `pkg/catalog/store/migrations/{001_core,004_storefront,006_videos_attachments,012_email_signins}.sql`, `pkg/catalog/releases/releases.go` (blob `keyPattern`, `capabilities`, markers), `examples/*.manifest.json`, `cmd/francois/cmds/api_commands.go`, `.github/workflows/`.
- slop (this repo @ `593e1ce`): `doc/production.md`, `cmd/slop/cmds/{serve,devseed}.go`, `pkg/store/migrations/postgres/00{1,2}_*.sql`, `pkg/server/{serve,auth,kernel}.go`, `pkg/blobs/blobs.go`, `pkg/records/records.go`, `pkg/render/assets/runtime.js`, `pkg/client/kernel.go`, `examples/seed/`.
- `dig +short slop.yolo.scapegoat.dev x.sbx.slop.yolo.scapegoat.dev francois.yolo.scapegoat.dev`.

### Why
- Copying francois's package means knowing every file in it, including the ones not to copy (pi/fonts secrets, the slop.boutique certificate).
- The identity plan depends on the exact OIDC setup (org scope, public signup, existing clients) and on `users(issuer, subject)` in both schemas.
- The importer mapping needs the real columns, not the CLI's view of them.

### What worked
- Both schemas key users by `UNIQUE (issuer, subject)` (francois `001_core.sql`, slop `001_auth.sql`), so admins can be matched without any ZITADEL API call.
- Blob addressing is identical: francois `^blobs/[0-9a-f]{2}/[0-9a-f]{64}$` (`releases.go:35`), slop `filepath.Join(root, "blobs", sum[:2], sum)` (`blobs.go:48`). Blobs can be rsynced across.
- DNS needs no change: all three names resolve to `91.98.46.169` through the `*.yolo.scapegoat.dev` wildcard.
- slop's `devseed` loader (`seedFile`, push with `Create`/`Base`, data first, viewers last) is a ready model for the importer's push stage.

### What didn't work
- My first file list for francois's package (from memory) was incomplete. The real `kustomization.yaml` has 23 resources, including separate service accounts and Vault auths for the db-bootstrap Job and the backup CronJob, plus `pi-secret`, `fonts-secret` and `certificate-slop-boutique.yaml`. The guide's §5.2 table was corrected against `ls gitops/kustomize/francois/`.
- No production row counts: deliberately not read. The guide shows the census report's shape with invented numbers, marked as such.

### What I learned
- **Public signup is on** in the shared organisation: `allow_register` defaults to `true` on terraform `origin/main` (`e41283c`), and the GitHub/Google IdPs have `is_creation_allowed`. Anyone can reach slop's pending screen, so only admins should be imported.
- **Someone has already started a slop client**: local-only commit `04fd555` "feat(identity): provision separate Slop sandbox PKCE client" (project `francois-sandbox`, app `slop-sandbox-web`, redirect `https://sandbox.slop.boutique/auth/callback`). `git branch -r --contains 04fd555` prints nothing. Local main is "ahead 18, behind 7" of origin. The uncommitted diff is unrelated (a `bling` CNAME in `dns/zones/scapegoat-dev`).
- slop's site serving exposes version files at `/_v/<artifact>/<n>/<file>` only for **routed** pages (`routedPage` in `pkg/server/serve.go`), so imported media in a data artifact has no URL. This became gap G2.
- slop's cookies are `__Host-` prefixed with `SameSite=Lax` (`pkg/server/auth.go:43-58`). This is what makes a same-site sandbox domain tolerable for an admins-only test.
- slop has no `--oidc-client-id-file`; francois's deployment reads its client id from a file.

### What was tricky to build
- Choosing the sandbox domain. `doc/production.md` says it must be a separate registrable domain. The cheapest test setup puts it under `scapegoat.dev`. Resolved as decision D3: same-site for the admins-only test, with the reasons spelled out, and a separate domain before any wider use. francois's `*.apps.francois.yolo.scapegoat.dev` is the same trade-off.
- Authorship of imported versions. `devseed` impersonates authors only in local mode, with `LocalToken`. Production must not allow that, so imports are authored by the importer, with the francois author in the message, and "push on behalf of" becomes gap G1 rather than a hack.

### What warrants a second pair of eyes
- §7.2's claim that ZITADEL's `sub` is the instance-wide user id, the same across applications. It is believed true, not verified; test I2 checks it on the first sign-in.
- §6.5: that the :8443 hairpin egress rule is all slop needs to reach ZITADEL from inside the cluster.
- §8.2: mapping withdrawn releases to non-main versions. Someone who knows how francois uses `withdrawn` should confirm it.

### What should be done in the future
- Phase A of the guide: `--oidc-client-id-file` and an image publish workflow.
- Ask the owner of `04fd555` whether that client is meant for this deployment.
- Rehearse the francois restore (phase C1). This is useful to francois regardless of slop.

### Code review instructions
- Read the guide top to bottom. Spot-check §5.2 against `ls ~/code/wesen/2026-03-27--hetzner-k3s/gitops/kustomize/francois/`, §4.2 against `../francois/pkg/catalog/releases/releases.go:204`, and §8.6 against both blob `path` functions.
- `docmgr doctor --ticket SLOP-002 --stale-after 30`.

### Technical details
```
$ cd ~/code/wesen/terraform && git status -sb | head -1
## main...origin/main [ahead 18, behind 7]
$ git branch -r --contains 04fd555
(no output)
$ git diff --stat
 dns/zones/scapegoat-dev/envs/prod/main.tf    | 7 +++++++
 dns/zones/scapegoat-dev/envs/prod/outputs.tf | 2 +-
$ dig +short slop.yolo.scapegoat.dev x.sbx.slop.yolo.scapegoat.dev francois.yolo.scapegoat.dev
91.98.46.169
91.98.46.169
91.98.46.169
```
francois capability map (`pkg/catalog/releases/releases.go:204`): `sample db user room comments assets artifact downloads files`. Runtime marker: `id=["']francois-view["']|/static/runtime\.js`.

## Step 2: Writing the guide, validation and delivery

With the evidence in hand, I wrote the guide in 14 sections: orientation, then current state, then the design (deployment, identity, importer, census), then plan, tests, risks, decisions and a file index. It is written for someone who knows Go and HTTP but has never seen slop, francois, ZITADEL or this cluster.

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Write, validate, commit and upload the guide.
**Inferred user intent:** A document an intern can execute phase by phase, marking which steps need operator rights.
**Commit (code):** see changelog (docs-only commit "SLOP-002: intern guide …")

### What I did
- Wrote `design-doc/01-intern-guide-…md`. It contains:
  - ASCII diagrams: host classes, cluster topology, identity flow, importer pipeline.
  - Abridged YAML for the deployment, ingress and certificate.
  - HCL pseudocode for the ZITADEL client.
  - Go pseudocode for extract and push, plus the census classifier.
  - Mapping and gap tables.
  - A phased plan, with steps marked [code] or [operator].
  - A test matrix (U1–U4, I1–I5) and decision records D1–D6.
- Corrected §5.2 and the DNS paragraph after checking the real file list and `dig` (Step 1, "What didn't work").
- Related key files, updated tasks and the changelog, then ran `docmgr doctor`. Uploaded to reMarkable.

### Why
- Every production-side action is marked [operator] because nothing in this ticket may change production. An intern needs to know which steps to hand off.

### What worked
- `docmgr doctor --ticket SLOP-002 --stale-after 30`: all checks passed. reMarkable bundle (guide + diary) uploaded on the first try.

### What didn't work
- N/A

### What I learned
- The census buckets (`static`, `static+downloads`, `needs-runtime:*`) are the most useful single output: they turn "what support should we add" into counts.

### What was tricky to build
- Keeping the gap list honest. G7 (storefront fields) and G8 (drafts) are deliberately listed as non-gaps, because in slop's model they are data and pages, not server features.

### What warrants a second pair of eyes
- The invented census numbers in §9.3 are labelled as invented. Make sure nobody quotes them.

### What should be done in the future
- Implement phases A to E. The guide is a design, not an implementation.

### Code review instructions
- Start with §1 and §10; check that each phase's exit criterion can actually be tested.

### Technical details
- Upload: `remarquee upload bundle <guide> <diary> --name "SLOP-002 Intern Guide - slop next to francois" --remote-dir /ai/2026/10/28/SLOP-002 --toc-depth 2` → `OK: uploaded SLOP-002 Intern Guide - slop next to francois.pdf -> /ai/2026/10/28/SLOP-002`.
