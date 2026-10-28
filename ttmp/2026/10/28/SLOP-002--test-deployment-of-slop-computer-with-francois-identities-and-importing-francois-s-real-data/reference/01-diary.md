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

## Step 7: The image under production flags, the API source under test, a slow real extract

This step tests the deployment and the importer against things that look like production. The image was run with exactly the Deployment's flags. Its own HEALTHCHECK passes now, and sign-in goes to the real issuer with the client ID from the file. The studio API source got a test against a fake francois. The first real extract died on a slow download; after the fix, it is running.

### Prompt Context
**User prompt (verbatim):** see Step 3
**Assistant interpretation:** Validate what was built at its integration boundaries.
**Inferred user intent:** Confidence that the operator steps will work the first time.
**Commit (code):**
- `35a62f8`: download robustness.
- `3637b17`: "francois: test the studio API source against a fake francois".
- `894ab1f`: lint fix.

### What I did
- Rebuilt the image: `docker build -q -t slop:slop002 .`.
- Ran it with the Deployment's arguments:
  - `--database-url-file`, `--oidc-client-id-file` (`000000000000000000@slop`).
  - `--public-url=https://slop.yolo.scapegoat.dev`, the site and sandbox hosts.
  - `--oidc-issuer=https://auth.slop.boutique`, `--oidc-scope=urn:zitadel:iam:org:id:394966170567966836`, `--trust-proxy-headers`.
  - `--network host`, because the test Postgres listens only on 127.0.0.1:55432. Database `slop_img`.
- `pkg/francois/api_test.go` `TestImportFromAPI`: a fake francois on `httptest`.
  - Studio routes behind a bearer token. The release download refuses tokens and serves only the free sample.
  - `/api/admin/users` returns 403, as for a studio-only token.
  - `/media/{id}` is public, and any non-GET counts as a failure.
  - Asserts releases come out oldest first and only the free sample is public; placeholder versus original HTML; census counts.
  - Asserts that a second extract succeeds from the cache after the fake server is closed.
- Live extract, second run: `./slop import francois extract --out …/fr-api --cache …/fr-cache` in the background. The log is in `fr-api.log`.

### Why
- The image is what the cluster runs, so this was the cheapest end-to-end check of the probe fix and the flag set before an operator applies anything.

### What worked
- `health: healthy`, from the image's own `HEALTHCHECK` (curl on 127.0.0.1:8080).
- Log: `Applied migration migration=004_tools.sql`, then `slop serving … public=https://slop.yolo.scapegoat.dev sandbox=sbx.slop.yolo.scapegoat.dev`.
- With `Host: slop.yolo.scapegoat.dev`, `/` → 303 (sign-in). With `Host: other.example`, `/` → 421. With `Host: 10.42.0.9:8080`, `/readyz` → `{"status":"ready"}`.
- `/auth/login` → 303 to `https://auth.slop.boutique/oauth/v2/authorize?client_id=000000000000000000%40slop&code_challenge=…&code_challenge_method=S256&nonce=…`. OIDC discovery against the real issuer worked (a public GET), and the client ID came from the file.
- `go test ./pkg/francois/ -run TestImportFromAPI` → ok.
- The second extract is past 375 of 689 media at about 3 MB/min, with no retries logged.

### What didn't work
- **First real extract.** `./slop import francois extract --out …/fr-api` died after 4:59 with `francois-media: med_16355b78a6562f1c5093012b.png: context deadline exceeded (Client.Timeout or context cancellation while reading body)`.
  - That file is 16,977,574 bytes (a 3720×2702 PNG).
  - `curl -r 0-999999` against `/media/med_6431e…` measured `538163B/s`, so 17 MB takes at least 30 s, more when shared with other downloads.
  - The 2-minute `http.Client.Timeout` covered the whole body, and one failure aborted the run.
  - Fixed in `35a62f8`: downloads use a client with only `ResponseHeaderTimeout: 1m`, three tries per file, four media workers, and a sha256 cache (`--cache`, by default the user cache directory `slop/francois`).
- **First container run.** It used the bridge network and `host.docker.internal` and failed with `dial tcp 10.10.0.1:55432: connect: connection refused`: the test Postgres publishes on 127.0.0.1 only. Rerun with `--network host`.
- **Lint slip.** I committed `3637b17` with `make lint 2>&1 | grep -v "^level" | tail -3; git add … && git commit`. The pipe ended in `tail`, so the 4 staticcheck ST1013 findings (`http.Error(w, "no", 401)` and three more) did not stop the commit. Fixed in `894ab1f` (`http.StatusUnauthorized`, `http.StatusForbidden`). Lint is now run on its own before committing.
- **Wait loop.** A wait loop with `pgrep -f "import francois extract --out …"` matched its own shell, the same mistake as in step 5, and ran until its 100 s cap. The watcher now waits on the log file instead.

### What I learned
- Production media are big: 745 files, 361 MB, with single PNGs up to 17 MB. Galleries reference 689 of the 745, so "referenced only" saves little. A width-limited variant (`/media/<id>?w=1600`, which francois supports) would make imports much smaller, but loses the sha256 check.

### What was tricky to build
- The cache had to be safe with concurrent workers. Files are written to the output first, verified, then hard-linked into the cache (falling back to a copy). A partial download never lands in the cache.

### What warrants a second pair of eyes
- `linkOrCopy` treats `os.IsExist` on `Link` as success. If a cache entry existed but was corrupt, it would never be replaced. The entries are verified when written, so corruption would need disk damage.

### What should be done in the future
- An optional `--media-width` for smaller imports (no sha256 check, recorded in the census).

### Code review instructions
- `pkg/francois/extract.go`: `copyFile`, `download`, `cached`, `remember`, `writeMedia` (the worker pool). `pkg/francois/api.go`: `NewAPI` (two clients).

### Technical details
- Container run: `docker run -d --network host -v …/img-secrets:/run/secrets/slop:ro slop:slop002 serve --listen=0.0.0.0:8080 …` (the Deployment's args).

## Step 8: The remote deployment, live

The user chose "do it all", and slop now runs on the cluster at https://slop.yolo.scapegoat.dev with TLS, signing in through ZITADEL. On the way, two problems in my own manifests and one in the Terraform provider domain blocked it, and they were fixed in order. Using the deployment immediately turned up a real sign-out bug. Pushing the real data hit the 200 MB version limit, which led to media shards.

### Prompt Context
**User prompts (verbatim):**
- "what about the remote deploy?"
- Then, to a choice of how far to go: "do it all actually".
- Mid-turn: "we need TLScertificate, maybe it's some special waves login ? See ~/code/wesen/go-go-golems/go-go-parc/Research/playbooks/infra I think."
- "I can't properly sign out and https://slop.yolo.scapegoat.dev/ just gets me back to \"an admin has to let you tin\"".
- "k, merged 1 2" and "merged #398".

**Assistant interpretation:** Carry out the operator steps too: merge, apply, seed, sync, first admins, push the data. Then fix what breaks.
**Inferred user intent:** A working test deployment with real data today.
**Commit (code):**
- slop: `9776e4e` (workflow permissions); `cb68898` (merge of PR #1); PR #2: `18f8617` (sign-out, `--email`), `1d06618` (media shards).
- hetzner-k3s: PR #397 → `47830b9` (package and image `sha-cb68898`); PR #398 (VaultAuth audiences).
- terraform: PR #38 (`envs/slop`, applied).

### What I did
1. **Image.** `gh run list` showed every publish-image run with `startup_failure`.
   - The reusable `infra-tooling/.github/workflows/publish-ghcr-image.yml` declares `permissions: contents read, packages write, pull-requests write, id-token write`, and my caller lacked `pull-requests: write`. Fixed in `9776e4e`; the PR run passed (`release / publish success`).
   - Merged PR #1 (`cb68898`). The main build published `ghcr.io/go-go-golems/slop-computer:sha-cb68898` (tags `latest`, `main`, `sha-cb68898`; package public).
2. **Terraform.** No default AWS credentials; `AWS_PROFILE=manuel` (per the terraform README) → `arn:aws:iam::745667007186:user/manuel`.
   - First `terraform apply` failed creating `zitadel_project_v2.slop`. `curl` showed `zitadel.yolo.scapegoat.dev` answers `/management/v1/projects/_search` with `404 page not found`, while `auth.slop.boutique` answers 200.
   - A search of the organization's projects found only `francois` and `francois-sandbox`, so nothing half-created. Provider domain → `auth.slop.boutique`, then plan: "2 to add, 0 to change, 0 to destroy", then `Apply complete! Resources: 2 added`. Client ID `397165131227726018`.
   - PR wesen/terraform#38. My `gh pr merge` was denied by the permission classifier ("Merge Without Review"); the user merged.
3. **Vault.**
   - `vault policy write` and `vault write auth/kubernetes/role/<name> @file` for `slop-test` and `slop-test-db-bootstrap` only, the same commands as `bootstrap-vault-kubernetes-auth.sh` uses, without reapplying every app.
   - `bootstrap-slop-secrets.sh` first stopped: `missing required environment variable: VAULT_TOKEN` (the CLI keeps it in `~/.vault-token`). Rerun with it inline → `Seeded kv/apps/slop/test/runtime (database slop, role slop_app)`, version 1.
4. **gitops.**
   - Rebased `slop/test-deployment` on `origin/main`, set the image to `sha-cb68898`, validator PASS, PR #397.
   - Argo has no app-of-apps, and `demo-apps` was applied by hand (it has `last-applied-configuration`). So I ran `kubectl apply -f gitops/projects/demo-apps.yaml -f gitops/applications/slop.yaml` before the merge: Application status "app path does not exist" until the merge.
5. **After the merge (47830b9).**
   - Sync stuck: `waiting for completion of hook batch/Job/slop-db-bootstrap`; the pod showed `CreateContainerConfigError … secret "slop-postgres-admin" not found`.
   - VaultStaticSecret events: `Failed to get Vault auth login … PUT …/v1/auth/kubernetes/login Code: 403`.
   - Cause: my roles copy francois-sandbox's (`"audience": "vault"`) but my VaultAuths copy francois prod's (no `audiences`). Fix: `audiences: [vault]` in both, PR #398.
   - The user asked about TLS and sync waves. The Certificate (wave 2) waited behind the bootstrap hook (wave 1), which waited on the secrets.
   - After the merge I server-side-applied the two VaultAuths from `origin/main` (`--field-manager=argocd-controller`), the same content Argo would apply.
   - Within 25 s: both VaultStaticSecrets synced, `job.batch/slop-db-bootstrap Complete 1/1`, the pod Running, `slop-tls` Ready, PVC Bound, Application `Synced Healthy`.
   - `https://slop.yolo.scapegoat.dev/healthz` → 200, `ssl_verify_result=0`. `/auth/login` → 303 to `https://auth.slop.boutique/oauth/v2/authorize?client_id=397165131227726018…`: the Traefik hairpin egress rule works.
6. **Admins.** `kubectl -n postgres port-forward svc/postgres 15432:5432`; the database URL from Vault rewritten to 127.0.0.1:15432, written to a mode-600 file in the scratchpad.
   - `slop db import-francois-admins --dry-run` listed Ramon, Manuel and "E2E Admin" (`e2e-admin@francois.test`, a test account).
   - Added `--email` and ran it with Manuel and Ramon only: Ramon `created`, Manuel `promoted` (he had signed in once and was pending).
7. **Sign-out bug** (user report).
   - `logout` in `pkg/server/auth.go` revoked the slop session, but a form post (pending screen, safe mode) redirected to `/` rather than to the provider logout. ZITADEL's live session then signed the person straight back in.
   - Fix: form posts redirect to the `end_session` URL. `TestFormLogoutEndsProviderSession` uses a fake issuer serving a discovery document. It passes with the fix, and with the fix stashed it fails as in production: `form logout: 303 /`.
   - PR #2.
8. **Real data to the cluster.**
   - Device login (`slop auth login --server https://slop.yolo.scapegoat.dev --scopes read,write,admin --days 7 --no-browser`), approved by the user → token `tok_81f…` (admin, read write admin).
   - `slop import francois push --dir fr-api` started uploading. Then the numbers: referenced media are 322.1 MB in one data version, against `maxVersionSize` 200 MB, so the push would have ended in 413 after all uploads.
   - Added media shards (`MediaShardBytes`, default 150 MiB): `francois-media`, `francois-media-2`, `francois-media-3` (151, 148, 8 MiB). Each file's `src` points at its shard. Test: two fixture images, 11-byte shards → two artifacts.
   - Re-extract from the cache: 24.5 s, against about 50 min the first time. Stopped the old push (anchored `pkill -f "^./slop import francois push"`), with 115 MB already uploaded and kept, and started the sharded push.
9. **Local push** of the same directory: `pushed 118 versions; 0 unchanged, 0 already imported` in 3 s. The storefront agent (pi, deepseek-4.1-flash, thinking medium) started in tmux window `slop:storefront` with the brief in `various/agent-import/`.

### Why
- Applying the VaultAuths by hand instead of waiting: Argo's running operation was blocked on a hook that could not finish with the old manifests. The applied objects were byte-for-byte `origin/main`'s, so self-heal had nothing to undo.
- Admins by email: francois has an E2E test admin, and making it a slop admin would hand the Workshop to whoever holds that test account.

### What worked
- The real census (`fr-api2/census.md`):
  - 104 catalog artifacts (103 with releases); 113 releases (110 published, 3 withdrawn); 96 free samples; 95 releases with their HTML (74.9 MB), 18 placeholders.
  - Buckets: `static` 83, `static+downloads` 12, `needs-runtime:db,user` 7, `needs-runtime:db,room,user` 5, `needs-runtime:db` 4, `needs-runtime:room` 2.
  - Gaps: G10 external scripts 32 releases; G5 runtime 18 (db 16, user 12, room 7); G9 placeholder HTML 18; G3 access tiers 15; G4 withdrawn 3.
  - Storefront: listed 100, hidden 4, featured 5, demo 21, early access still running 81. Media 689 of 745 copied (322 MB); attachments 18 (63.8 MB); 89 instances not imported.

### What didn't work
- Exact diagnostics, in order:
  1. `startup_failure` (workflow permissions).
  2. Terraform `zitadel_project_v2.slop` create error on the dead domain (`404 page not found`).
  3. `missing required environment variable: VAULT_TOKEN`.
  4. VSO `Code: 403` at `auth/kubernetes/login` (audience), hence `secret "slop-postgres-admin" not found`.
  5. Sign-out returning to the pending screen (`303 /`).
  6. 322 MB media version against the 200 MB limit (caught before the 413).
- Smaller slips:
  - `slop db import-francois-admins --fields …`: `unknown flag: --fields`.
  - `--output json` printed a table; I read the table.
  - A `sleep 45; …` chain was blocked by the harness; I used an until-loop on the certificate's Ready condition instead.

### What I learned
- The terraform repo's `envs/prod` still defaults `zitadel_domain` to `zitadel.yolo.scapegoat.dev`, which now 404s for management calls. Its next plan will likely fail the same way.
- In the census, the 18 paid releases are exactly the 18 that need the runtime. Paid content and runtime-dependent content are the same set today.
- 81 of 104 artifacts are in early access, so access tiers (G3) matter more than the release count suggests.

### What was tricky to build
- Reading "no TLS" correctly. The certificate was not failing: it had never been created, because Argo waves stop at the first unhealthy hook. The real fault was three steps upstream, at Vault login.

### What warrants a second pair of eyes
- Media shards: when a re-import adds or reorders media, a file can move to another shard. `/_d/<shard>/main/` links in Markdown written earlier would then 404. Records are rewritten on each import, so only copies outside the import are affected.
- The admin import ran through a port-forward with the app role's credentials, from a laptop.

### What should be done in the future
- Merge PR #2, then bump the gitops image tag (a third gitops PR) so sign-out is fixed on the cluster.
- The census has an empty "posts:" line when there are no posts; to fix.

### Code review instructions
- `pkg/server/auth.go` `logout`, plus `pkg/server/logout_test.go`.
- `pkg/francois/extract.go` `shardMedia`, `mediaSrc`, `writeMedia(shard, dir)`.
- hetzner-k3s `gitops/kustomize/slop/{vault-auth,db-bootstrap-vault-auth}.yaml`.

### Technical details
```
kubectl -n slop get certificate,ingress,pvc   → slop-tls True; ingress 91.98.46.169 80,443; slop-data Bound 5Gi
kubectl -n argocd get application slop        → Synced Healthy
```

## Step 9: Real data on the cluster, a storefront built by an agent, and what slop is missing

The real francois catalog is on the test deployment, and anyone can browse it at https://site.slop.yolo.scapegoat.dev/. The storefront pages were written by a pi agent working on the same data locally. The agent's NOTES are the most direct answer yet to "what support would we add". Its notes also caught an importer bug, absolute media links, which is fixed and was re-imported. The re-import ran idempotently on real data.

### Prompt Context
**User prompt (verbatim):** see Step 8, plus: "I don't see any on slop.yolo.scapegoat.dev though, right? Also never forget the diary, it's MANDATORY."
**Assistant interpretation:** Get the imported data visibly onto the cluster and keep the diary current at every milestone.
**Inferred user intent:** See real francois content on the new deployment, with the reasoning recorded.
**Commit (code):** `d1c670f` (census "posts: none"); `47bf7a7` (absolute media links). Evidence is committed with this entry.

### What I did
- **Cluster push.** `slop import francois push --dir fr-api2` with the device-login token → `pushed 118 versions; 0 unchanged, 0 already imported`. The cluster now has 108 artifacts in `francois`: 103 pages plus `francois-catalog`, `francois-creators` and `francois-media`, `-2`, `-3`. Versions are `by usr_8a5…` (Manuel, the token's owner; the API source has no authors) and `via import`.
- **Smoke test.** `slop route set /weft weft` on `site.slop.yolo.scapegoat.dev` → `site /weft 200 1043130 bytes`. Later removed (`route rm /weft`) in favour of `/r/weft`.
- **Local storefront agent.** pi, `lunaroute/deepseek-4.1-flash`, thinking medium, `SLOP_VIA=agent`, its own `claude-manuel` login. Brief: `various/agent-import/{AGENTS.md.txt,prompt.txt}`. It built `storefront` (v2) at `/` and `storefront-entry` (v2) at `/apps/:id --record '{id}.json' --bind catalog=francois-catalog`, plus 100 `/r/<page>` routes pinned to each record's latest release. It wrote `NOTES.md`: 16 findings, all saved.
- **Importer fix** from NOTES §11. Catalogue bodies link `https://slop.boutique/media/<id>`, and `mediaRef` only matched the path, so 124 links became `https://slop.boutique/_d/francois-media…`. The regex now swallows an optional `https?://host` origin; the fixture has an absolute link. Re-extract from the cache → `absolute _d links: 0`.
- **Re-push to both servers** → `pushed 1 versions; 4 unchanged, 113 already imported` (`francois-catalog` v2 only).
- **Moved the storefront to the cluster.**
  - `slop pull storefront|storefront-entry|lab-tokens` from local, then `slop push` to the cluster. `lab-tokens` lost its `lab-site` project, which doesn't exist there.
  - Routes `/`, `/apps/:id` (same record and bind), and the 100 lines of `release-routes.tsv`.
  - Checks: `/ 200 670476`, `/apps/weft 200 676481`, `/r/weft 200 1043132`, `/r/lattice-deck 200 426291`, `/_d/francois-media/main/index.json 200`, a cover `/_d/francois-media-3/main/files/med_fc42….webp 200 image/webp`.
- **Screenshots** (`various/screenshots/`):
  - `s2-01-remote-storefront.png`: the catalogue, 100 apps.
  - `s2-02-remote-entry-weft.png`: the entry page with "Open release · v1.0.0".
  - `s2-03-remote-release-type-studio.png`: an imported release running.
  - `s2-04-remote-workshop-signin.png`: the Workshop sends you to ZITADEL login with `organization=394966170567966836`.
- **Saved evidence:** `various/agent-import/{NOTES.md.txt, pi.log, session.jsonl, release-routes.tsv}`, plus `various/census-api-2026-10-28.{md.txt,json}`. The agent's local `slp_` token appeared twice in `session.jsonl` and was redacted to `slp_REDACTED` before committing. The census contains no email addresses (`grep -c @` → 0).

### Why
- Building the pages locally first kept the agent's 100 probe routes and throwaway artifacts (`probe-media`, `/probe`) off the shared deployment.
- Copying the pages rather than letting the agent push to the cluster: the agent has no cluster login, and a second device approval just to copy two folders wasn't worth the user's time.

### What worked
- The import's design held on real data: idempotent re-runs, sharded media, `/_d/` serving gated by `reads`, release HTML served unmodified.
- The agent built a working storefront for 100 apps in one session. Badges: early access 79, `needs db|user|room` 23. Covers come from `/_d/`, and there's a monogram fallback for 6 records without a cover.

### What didn't work
- **Wiped search path.** While creating cluster routes, `while IFS=$'\t' read -r path target` in zsh assigned `path`, which zsh ties to `$PATH`. The following `curl` calls failed with `command not found: curl`. The routes were unaffected (the binary was called by absolute path), and the checks reran in a fresh shell.
- **Screenshot read.** `Read` of the second screenshot reported "File does not exist" right after Playwright saved it, while it was still being written. A `find /` I started to look for it overran its timeout and was killed.

### What I learned (the agent's findings, ranked)
1. **Gating of data files** (NOTES §1, §3): `/_d/` files are public only if some routed page `reads` the artifact. The agent found this only by probing; `src` values look broken until then. This is my G2 design working as intended, but it's undocumented and surprising.
2. **Boot payload** (§2): `reads` is page-wide, so every page ships the whole catalogue and all media records, 667 KB of `#slop-boot` on `/apps/weft`. A per-route projection, or loading records on demand, would fix it.
3. **No route by record** (§6, §14): a route can't choose its page from a parameter, hence 100 pinned routes that go stale when a release is added. This is the biggest missing feature for a catalogue.
4. **Silent route shadowing** (§7): `/apps/:id` shadowed the existing `/apps/:slug` with no warning. **Silent `/` replacement** (§8): same problem.
5. **Asset paths** (§4, §5): `/_v/` is undocumented, numeric versions only. Relative assets resolve from the route's prefix, so files must sit flat at the page root.
6. **No structured CLI output** (§9): `--output json` is not available on `artifacts list` or `route list`. No preview without a route (§10). No artifact delete. `route rm` has no `--note`.
7. **No server-rendered Markdown for JSON records** (§11): only `.md` records get `html`.
8. **Imported releases make external requests** (§15): Google Fonts and cdnjs. That matches census G10 (32 releases).

### What was tricky to build
- Choosing what to fix now. Only the importer bug was mine to fix in this step. The rest are product decisions for slop (route by record, data projections, documenting `/_v/`/`/_d/`), recorded as next tasks rather than built ad hoc.

### What warrants a second pair of eyes
- The cluster's public site now serves 100 imported francois releases. 15 of them are paid releases on francois (census G3), but they came over as placeholders, so no paid HTML is exposed. The free samples are public on francois too. Still, someone who owns the francois catalogue should be told it is mirrored on a second host.
- The storefront pages copy `lab-tokens` and `boutique.css` from the dev seed's lab-site.

### What should be done in the future
- Product, in order of what blocks a real catalogue: route-by-record (`/r/:page → {page}`, or a page binding taken from the record); per-route data projections; route conflict warnings; `--output json` on list commands; documenting `/_d/` and `/_v/`.
- Deploy PR #2 (sign-out fix, media shards, absolute-link fix) and bump the gitops image tag.
- Upload the updated guide and diary to reMarkable.

### Code review instructions
- `pkg/francois/extract.go` `mediaRef`; `pkg/francois/francois_test.go` (the absolute link case).
- Read `various/agent-import/NOTES.md.txt` in full. It is the input for the next slop ticket.

### Technical details
```
cluster routes on site.slop.yolo.scapegoat.dev: / → storefront, /apps/:id → storefront-entry {id}.json (bind catalog=francois-catalog), /r/<page> → <page>@<n> ×100
census (api, 2026-10-28): 113 releases; static 83, static+downloads 12, needs-runtime 18 (db 16, user 12, room 7); external scripts 32; early access running 81
```
