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

## Step 3: Phase A — client ID from a file, image workflow, PR

Implementation started with the smallest unblocking pieces from the guide's phase A. The client ID can now come from a mounted file. A publish workflow builds the image from `main`. `doc/production.md` gained a Kubernetes section. Partway through, the user asked for a pull request so a review could run alongside the deployment work, so PR #1 was opened against `main`.

### Prompt Context
**User prompt (verbatim):** "Ok, now implement,  commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill).

MANDATORY: use the skill diary for the diary format"
(Mid-turn: "Create a pull request to main btw already so that we can have codex code review while we work on deployment.")
**Assistant interpretation:** Implement the SLOP-002 guide phase by phase, with focused commits and investigation-format diary entries. Open a PR now.
**Inferred user intent:** Get slop deployable next to francois and loaded with real francois data, with reviewable history.
**Commit (code):** db623c3 — "SLOP-002 phase A: --oidc-client-id-file, image publish workflow, Kubernetes notes"

### What I did
- `cmd/slop/cmds/serve.go`: flag `--oidc-client-id-file`; `oidcClientID(id, file)` refuses both at once and reads the file with `readSecret`. Test: `cmd/slop/cmds/serve_test.go` (`TestOIDCClientID`, the first test in `cmds`).
- `.github/workflows/publish-image.yaml`: francois's workflow (`../francois/.github/workflows/publish-image.yaml`), keeping the reusable `go-go-golems/infra-tooling` publish job, with `image_name: ghcr.io/go-go-golems/slop-computer` and `open_gitops_pr: false`.
- `doc/production.md`: "Kubernetes" section (package layout, Vault keys, the serve flags, the ZITADEL hairpin).
- `gh pr create --base main --head task/slop-computer` → https://github.com/go-go-golems/slop-computer/pull/1 (25 commits: SLOP-001 phases 0–7 plus SLOP-002 so far).

### Why
- The gitops PR step needs a Vault role (`vault_role: francois-gitops-pr` in francois) that does not exist for slop. Until it does, the image is pinned by hand.

### What worked
- `go test ./cmd/...` → `ok …/cmd/slop/cmds`.
- The branch was already on origin at `db623c3` when the PR was created, so the PR needed no extra push.

### What didn't work
- No failures observed.

### What I learned
- The slop repo had no `.github/` at all. This workflow is its first CI, and it runs `go test ./... -count=1` on every PR.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Whether `infra-tooling`'s reusable workflow accepts `open_gitops_pr: false` without the `gitops_*` inputs. It is optional in francois's usage, but slop's workflow has not run yet.

### What should be done in the future
- Add a gitops-pr Vault role for slop and turn on `open_gitops_pr`, once `gitops/kustomize/slop` exists on the k3s repo's main.

### Code review instructions
- `cmd/slop/cmds/serve.go` (`oidcClientID`), `.github/workflows/publish-image.yaml`.

### Technical details
- Flags as the Deployment uses them: `--oidc-client-id-file=/run/slop/oidc-client-id --oidc-scope=urn:zitadel:iam:org:id:$(SLOP_ZITADEL_ORG_ID)`.

## Step 4: Gaps G1 and G2 — pushing on behalf of someone, files of data artifacts

Two server gaps from the guide block a faithful import. G1: there was no way to keep the francois author of a release. G2: images in a data artifact had no URL. Worse, `records.Parse` would have read every binary file as text into the page's boot JSON. Both are fixed here, with tests.

### Prompt Context
**User prompt (verbatim):** see Step 3
**Assistant interpretation:** Close the small gaps the importer depends on before writing it.
**Inferred user intent:** Imported content should look and behave like native slop content.
**Commit (code):** c2ef259 — "SLOP-002 gaps G1, G2: push on behalf (admin scope, audited), data files under /_d/"

### What I did
- G1, in `pkg/server/kernel.go` `push`:
  - New `author` field. It is accepted when the caller is a signed-in admin, or a token with `store.ScopeAdmin`. Grants and read/write tokens get 403 `author_not_allowed`.
  - The author must exist and must not be disabled; otherwise 400 `invalid_author`.
  - A real on-behalf push writes the audit row `version.push_as` with `{author, n, via}`, actor = the caller.
  - `via` now also accepts `import`.
- `pkg/client/kernel.go`: `PushRequest.Author`, `User`, `Users()`; `pkg/client/errors.go`: `IsNotFound`.
- G2, in `pkg/records/records.go`:
  - `IsText(path)` covers `.md .json .csv .txt .tsv .yaml .yml` and files without an extension. Every other file becomes `{id, path, file: true}`, and `FromFiles` no longer reads its bytes.
  - `pkg/server/serve.go` `records()` adds `src: /_d/<artifact>/<n>/<path>`, plus `type` and `size`.
- `/_d/<artifact>/<n|main>/<path>` (`dataPath`, `serveData`, `reads`):
  - **Site hosts:** served only if a public route's page reads that artifact.
  - **Sandbox hosts:** served if the previewed version reads it, by its manifest or through a route to that page on any site host.
  - **Caching:** numbered versions are `immutable`; `main` is `no-cache` with an ETag. `slop.json` is never served.
- Tests in `pkg/server/import_test.go`:
  - `TestDataFiles`: record src, bytes, cache headers, 404 for unread data and for the manifest, preview access.
  - `TestPushAs`: 403 with a read/write token, 400 for an unknown author, 201 with `by` = ramon, then the audit row.

### Why
- `main` URLs exist so that Markdown links written once (journal posts, catalog bodies) keep working when a re-import adds media and the media artifact gets a new version. Records use the numbered, immutable URL.
- Gating `/_d/` on "something routed reads it" mirrors the existing `/_v/` rule (`routedPage`): data nobody published stays unreachable from site hosts.

### What worked
- `go test ./pkg/server/ -run 'TestDataFiles|TestPushAs'` → ok on the first run; then `go test ./...` all ok, `make lint` 0 issues.

### What didn't work
- No failures in this step.

### What I learned
- Before this change, a PNG in a data artifact would have been inlined as a `text` field of a record in every page that reads it. That was a latent bug, not just a missing feature.

### What was tricky to build
- Sandbox access to data files. A preview iframe's request for `/_d/…` does not carry the `?host=` query that gave the page its route context. The rule therefore checks the version's own reads, then the routes to that page on every configured site host.

### What warrants a second pair of eyes
- `serveSite` runs `s.reads` for each public route on every `/_d/` request (a version lookup and bindings per route). That is fine for tens of routes. Cache it if route tables grow.
- G1's trust boundary: an admin-scoped token can attribute versions to any enabled user. That is acceptable for a two-admin tool and visible in the audit log, but it is a real capability.

### What should be done in the future
- The Workshop's data panes could show file records as thumbnails, using `src`.

### Code review instructions
- `pkg/server/serve.go`: `dataPath`, `serveData`, `reads`, the `/_d/` blocks in `serveSite` and `serveSandbox`. `pkg/server/kernel.go`: `push` (author). `pkg/records/records.go`: `IsText`, `Parse`, `FromFiles`.
- `go test ./pkg/server/ -run 'TestDataFiles|TestPushAs' -v`.

### Technical details
- File record shape: `{"id":"med_1","path":"files/med_1.png","file":true,"src":"/_d/media/1/files/med_1.png","type":"image/png","size":9}`.

## Step 5: The importer — sources, extract, census, push, admins

This is the importer from the guide's §8–9. There are two sources behind one snapshot model: a restored database, and the live studio API. One extractor writes the dev-seed directory format plus a census. One push path is now shared with `slop dev seed`. A fixture test on Postgres runs the whole chain, including a second push that must change nothing.

### Prompt Context
**User prompt (verbatim):** see Step 3
**Assistant interpretation:** Phase C code: `slop import francois extract|push` and the admin import.
**Inferred user intent:** Real francois content in slop, plus a list of what slop lacks.
**Commit (code):** 7ba914e — "SLOP-002 phase C: slop import francois (extract, push), import-francois-admins, census"

### What I did
- Found that francois's API can be read with the stored CLI token. `francois catalog whoami` showed a token with scopes `studio account admin:read admin:write`. `francois catalog artifacts list` printed the live catalog (Weft, Vitrine, Type Studio, …).
- Read francois's routes before relying on the API:
  - The release download `GET /api/releases/{release}/files/{file}/download` is `guard(public, noToken, …)`, so a token gets 401 `token_not_allowed`.
  - `mayDownload` lets anyone download a **free sample**.
  - There is no studio route for release HTML. So the API source gets HTML only for published free samples; everything else gets a placeholder page, and the census counts it (gap G9).
- `pkg/francois`:
  - `snapshot.go`: `Snapshot`, `Artifact`, `Release`, `File`, `Post`, `Creator`, `Media`, `User`, `Source`, `ErrUnavailable`.
  - `db.go`: `DBSource`. A single connection with `SET default_transaction_read_only = on`. Arrays come out through `array_to_json`. Blobs are opened by `storage_key`, checked against francois's `keyPattern`. Row counts for tables the import leaves out.
  - `api.go`: `APISource` makes only GET requests. `StoredToken` reads `~/.config/francois/credentials.json`. Admins come from `/api/admin/users?role=admin` when the token has admin:read.
  - `extract.go`: `Extract` writes `seed.json` and `artifacts/<id>/v<n>/`.
    - Releases become versions, oldest first. Each has `index.html` (the original or a placeholder), `francois.manifest.json`, `attachments/<safeName>`, and an import manifest `{"import":{"key":"francois:release:<id>",…}}`.
    - Drafts and withdrawn releases get `main: false`, and the francois author becomes `author: {issuer, subject}`.
    - Data artifacts: `francois-catalog` (one `<id>.json` each), `francois-journal` (`<slug>.md`), `francois-creators` (`<slug>.json`), `francois-media` (`files/<id>.<ext>` + `index.json`).
    - Only referenced media is copied (`--all-media` copies everything). `/media/<id>[?w=…]` links are rewritten to `/_d/francois-media/main/files/<id>.<ext>`, and every copied file's sha256 is checked against francois's record.
  - `census.go`: `Classify` (`static`, `static+downloads`, `runtime-marker`, `needs-runtime:<caps>`), gaps G3/G4/G5(+per capability)/G9/G10, `census.json` and `census.md`. The report names artifacts, never users.
- `pkg/seed`: moved the dev-seed loader out of `cmd/slop/cmds/devseed.go`.
  - New fields: `Key` (skip versions already imported), `Main` (`moveMain`), `Author` (mapped to a user ID through `GET /api/users`).
  - The base for each push is the current main, so `main:false` versions branch off main.
  - `UploadDir` now hashes files as streams and reads only the blobs the server lacks.
- `pkg/store/users.go` `ImportAdmin`: create an admin (with no login time), promote a pending user, leave disabled users alone.
- Commands: `slop import francois extract|push` and `slop db import-francois-admins` (with `--dry-run`).
- Test `pkg/francois/francois_test.go` with `testdata/schema.sql`, the subset of francois's tables and columns the source reads:
  - The fixture holds 3 users, 3 artifacts (one `weft_lab` with an underscore, one without releases), and 4 releases (published with `db` plus the runtime marker plus an external script; withdrawn; published with downloads plus an attachment named `../Manual v1.pdf`; draft).
  - It also has 2 media (one referenced as `/media/med_aa?w=640`, one unreferenced), a dangling `/media/med_ff`, a post with a two-line summary and a tag containing a comma, and 2 instances.
  - It asserts the read-only session, the seed contents, link rewriting, front matter, census buckets and counts, push authorship, that drafts and withdrawn releases are not main, and that a second push gives 0 versions, 4 skipped and 4 unchanged.

### Why
- One snapshot model keeps the extractor and census independent of where the data comes from. The API source lets us work with real data now. The DB source is the faithful one, for after the restore rehearsal.
- Seed format: it can be inspected, diffed and pushed to any slop (local first). It is also what `dev seed` already reads.
- Data artifacts have a `francois-` prefix so a francois artifact called `journal` cannot collide with them. Page IDs map `_` to `-`, and a collision is an error.

### What worked
- `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable go test ./pkg/francois/` → ok (0.29 s). The full suite is ok, and `make lint` reports 0 issues.
- The refactored dev seed against a fresh `slop serve --local` printed `seeded 41 versions, 10 routes on site.localhost:18111, 6 threads`, the same counts as in SLOP-001. A second run printed `pomodoro exists (v2), skipped … seeded 0 versions`.

### What didn't work
- **Test fixture.** First run: `attachment: stat …/polis/v1/attachments/.._Manual_v1.pdf: no such file or directory`. `safeName` also prefixes `_` to names that start with a dot, which is intended. The test expectation became `_.._Manual_v1.pdf`.
- **Test fixture.** Second run: `Dangling:[]`. The fixture's `med_zz` is not hex, so it never matched francois's ID shape (`med_[0-9a-f]+`). Changed to `med_ff`.
- **Live API extract.** `./slop import francois extract --out …/fr-api` exceeded the 120 s tool timeout and moved to the background. Media downloads from production run at about 3 MB/min (31 MB and 55 files after about 10 minutes). The result is recorded in the next step.
- **Shell slip.** `pkill -f "listen 127.0.0.1:18111"` (and later `pgrep -f … | xargs kill`) matched the parent shell's own command line and killed it with exit 144. The first time, that happened before `git commit` ran. Background servers now get PID files.

### What I learned
- The studio API returns no author for releases (`releaseItems` has no `createdBy`). Only the database source can keep authorship.
- 745 media files, 361 MB, sit in francois's library. Copying only referenced media is what keeps the import small.
- 0 posts and 2 creators exist live, so the journal and creators data artifacts are tiny for now.

### What was tricky to build
- Keeping `main` on the right version while pushing a history containing drafts and withdrawn releases. A push compares its `base` against main, so every push uses the current main as its base, and `moveMain: false` versions branch off it. The first version must create the artifact, so it always becomes main. If francois's first release is a draft, it is main until a published one arrives.
- Front matter that `records.FrontMatter` reads back. Values must be one line, and `[a, b]` is parsed as a list. The fix: `fmValue` collapses whitespace and trims brackets, and tags lose commas and brackets.

### What warrants a second pair of eyes
- `DBSource` relies on `SetMaxOpenConns(1)` so that the read-only `SET` covers every query. A dropped connection would reconnect without it. The source runs against a restored copy anyway, but `BEGIN READ ONLY` per snapshot would be stricter.
- Placeholder pages are versions too. When the DB source later brings the real HTML, the import key matches, so the release is skipped. A placeholder would never be replaced. Use a fresh slop, or delete the artifact, when switching sources.

### What should be done in the future
- Restore rehearsal plus a DB-source import (guide phase C1).
- Gap G9 (paid HTML via the API) would need a francois change, such as a studio download route for admin tokens. That is out of scope here.

### Code review instructions
- `pkg/francois/extract.go` (`Extract`, `writeReleases`, `selectMedia`, `rewrite`), `pkg/francois/census.go` (`Classify`, `release`), `pkg/seed/seed.go` (`pushArtifact`), `pkg/store/users.go` (`ImportAdmin`).
- `make test-postgres` with `TEST_DATABASE_URL` pointing at port 55432.

### Technical details
```
slop import francois extract --out DIR [--francois-db URL --francois-blobs DIR | --francois-server URL --francois-token-file F] [--all-media]
slop import francois push --dir DIR [--server URL --token-file F]
slop db import-francois-admins --database-url-file F [--francois-db … | API flags] [--dry-run]
```

## Step 6: Deployment package, ZITADEL client, and what had changed underneath the guide

Phase B, the code half. This wrote the kustomize package, the Vault policies and roles, the secrets script, and the Terraform client, each on its own branch in a git worktree beside this one. Nothing was pushed or applied. On the way, three facts in the guide turned out to be stale: the issuer, the best template, and the health probes. Two of them needed code changes.

### Prompt Context
**User prompt (verbatim):** see Step 3
**Assistant interpretation:** Write the deployment (guide §6–7) without touching the cluster, Vault or ZITADEL.
**Inferred user intent:** A test deployment an operator can apply in a few commands.
**Commit (code):**
- slop `35a62f8`: "Health checks on any host; importer downloads: retries, cache, parallel media".
- hetzner-k3s `5eaf707` (branch `slop/test-deployment`): "slop: test deployment of slop.computer (namespace slop, demo-apps)".
- terraform `abc678a` (branch `slop/zitadel-client`): "feat(identity): slop.computer PKCE client in the francois organization".

### What I did
- Worktrees, so the checkouts other sessions use stay untouched:
  - `git -C ~/code/wesen/2026-03-27--hetzner-k3s worktree add -b slop/test-deployment …/hetzner-k3s-slop origin/main`. The main checkout is on `francois/catalog-db-commands`.
  - `git -C ~/code/wesen/terraform worktree add -b slop/zitadel-client …/terraform-slop origin/main`. The main checkout is 18 ahead and 7 behind, with uncommitted DNS work.
- Read `origin/main` (`e51f5a1`) of hetzner-k3s instead of the checkout I had used for the guide (`f758001`, a feature branch). That turned up:
  - `gitops/kustomize/francois-sandbox` ("Slop sandbox", commit `2621d11`): demo-apps project, Traefik basic-auth `operator-gate`, `sandbox-headers` (noindex), Vault `apps/francois/sandbox/*`.
  - `cfe0ebb` "feat(identity): move active ZITADEL consumers to auth.slop.boutique": francois now runs with `--oidc-issuer=https://auth.slop.boutique`.
- Checked the issuer of real users: `GET /api/admin/users?role=admin` → `Counter({('https://auth.slop.boutique', 'admin'): 3})`; all users → 12, all on `auth.slop.boutique`. Only issuer and role were printed, not names or emails.
- `gitops/kustomize/slop/` (17 resources) and the files around it:
  - Namespace, the two service accounts, VaultConnection, the two VaultAuths (`slop-test`, `slop-test-db-bootstrap`), VaultStaticSecrets (`apps/slop/test/runtime`, `infra/postgres/cluster`).
  - The db bootstrap ConfigMap and Job, via `sed` from francois's with `FRANCOIS_DB_` renamed to `SLOP_DB_`.
  - PVC `slop-data` 5Gi in wave 2, the same wave as the Deployment, which the repo's validator requires.
  - Deployment: issuer `https://auth.slop.boutique`, `--oidc-client-id-file`, org scope from the secret, probes without a Host header, image `sha-PENDING`.
  - Service; Certificate `slop-tls` (DNS-01, three names); Middleware `test-headers`; Ingress.
  - NetworkPolicy: francois-sandbox's, minus public egress on 443.
  - `README.md` with the operator runbook.
  - `gitops/applications/slop.yaml` (demo-apps) and the `slop` destination in `gitops/projects/demo-apps.yaml`.
  - `vault/policies/kubernetes/slop-test{,-db-bootstrap}.hcl`, `vault/roles/kubernetes/slop-test{,-db-bootstrap}.json`.
  - `scripts/bootstrap-slop-secrets.sh`, francois's script minus Stripe and Pi.
- Validation: `kubectl kustomize gitops/kustomize/slop` renders 17 objects. `bash scripts/validate_gitops.sh` → `OK slop … Packages checked: 56 Violations: 0 RESULT: PASS`. `bash -n` passes on the script.
- Terraform `zitadel/francois/envs/slop/{main,versions}.tf` (state key `zitadel/francois/slop/terraform.tfstate`) plus the lock file from `04fd555`. Project `slop`, application `slop-web`, PKCE, redirect `https://slop.yolo.scapegoat.dev/auth/callback`, outputs `oidc_client_id` and `organization_id`. `terraform init -backend=false && terraform validate` → "Success! The configuration is valid." Nothing touched state.
- slop: probes. `pkg/server/server.go` `Handler` answers `/healthz` and `/readyz` on hosts it does not serve, instead of 421. A test in `serve_test.go` uses host `10.42.0.7:8080`, and `doc/production.md` was updated.
- Guide: added §1a, "Implementation status (as built)", and corrected the issuer in §4.3, §6.3, §6.5 and §7.2, plus the probe sentence in §5.2.

### Why
- **No basic-auth gate.** Traefik's basicAuth uses the `Authorization` header, and slop's CLI and agents send `Authorization: Bearer slt_…`. A gate in front of the main host would lock out every agent. Sign-in plus the pending role already guard the Workshop; site hosts serve only what an admin routed; preview origins are unguessable per version.
- **No public egress.** slop calls nothing outside the cluster. ZITADEL is reached through the Traefik hairpin rule.
- **demo-apps project.** That is where francois-sandbox lives, and this is a test deployment.

### What worked
- All validators listed above passed. Reusing francois's manifests through `sed` kept the bootstrap Job identical apart from names.

### What didn't work
- My guide claimed slop's health endpoints answer on any host. `pkg/server/server.go` `Handler` returned 421 (`unknown host`) for every host that was not main, site or sandbox, so kubelet probes to the pod IP would have failed. So would the Dockerfile's `HEALTHCHECK … curl -fsS http://127.0.0.1:8080/healthz` in any non-local deployment. Fixed in `35a62f8`.
- That also corrects SLOP-001 diary step 19. It blamed the container's "starting" health state on the moved listen port; the 421 would have failed the check either way outside `--local`.

### What I learned
- The identity domain moved to `auth.slop.boutique` five days before this work. A guide written from a feature-branch checkout can be wrong about main; read `origin/main` of infrastructure repos.
- The "Slop sandbox" francois deployment uses Terraform `envs/sandbox`, which exists only in local commit `04fd555` (`git ls-tree origin/main zitadel/francois/envs/` → `prod` only). Production identity config was applied from unpushed code.

### What was tricky to build
- Deciding the host names again, with the facts above. A `*.slop.boutique` main host would sit same-site with francois's untrusted instance origins (`i-<id>.slop.boutique`), just as `slop.yolo.scapegoat.dev` sits next to `*.apps.francois.yolo.scapegoat.dev`. Neither choice gives the main host a site of its own, so I kept the guide's names (decision D3). The `*.yolo.scapegoat.dev` DNS wildcard also covers the two-label `*.sbx.slop` names.

### What warrants a second pair of eyes
- `traefik.ingress.kubernetes.io/router.priority`: francois-sandbox sets 100 to win over a wildcard route. slop's hosts are under `yolo.scapegoat.dev`, where no wildcard ingress is known to compete, so I set none. Check with `kubectl get ingress -A | grep yolo.scapegoat.dev` before merging.
- Whether `demo-apps` permits `traefik.io` Middleware and `secrets.hashicorp.com` kinds (francois-sandbox uses both in the same project, so it should).

### What should be done in the future
- Operator:
  1. Push both branches and merge `slop/zitadel-client`.
  2. `terraform apply` in `envs/slop`.
  3. Run `bootstrap-slop-secrets.sh`, then `bootstrap-vault-kubernetes-auth.sh`.
  4. Set the image tag, merge `slop/test-deployment`, and apply `gitops/applications/slop.yaml`.
- Merge PR #1 so the publish workflow builds the first image.

### Code review instructions
- `../hetzner-k3s-slop`: `git show 5eaf707 --stat`; start with `gitops/kustomize/slop/deployment.yaml`, `ingress.yaml`, `network-policy.yaml`, `README.md`. Run `bash scripts/validate_gitops.sh`.
- `../terraform-slop`: `zitadel/francois/envs/slop/main.tf`; `terraform init -backend=false && terraform validate`.

### Technical details
```
Deployment args: serve --listen=0.0.0.0:8080 --blobs=/var/lib/slop/blobs --database-url-file=/run/secrets/slop/database-url
  --public-url=https://slop.yolo.scapegoat.dev --site-host=site.slop.yolo.scapegoat.dev --sandbox-domain=sbx.slop.yolo.scapegoat.dev
  --oidc-issuer=https://auth.slop.boutique --oidc-client-id-file=/run/secrets/slop/oidc-client-id
  --oidc-scope=urn:zitadel:iam:org:id:$(SLOP_ZITADEL_ORG_ID) --trust-proxy-headers
```
