---
Title: Diary
Ticket: SLOP3-013
Status: active
Topics:
    - data-migration
    - deployment
    - architecture
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of the SLOP3-013 francois → slop v3 catalog import: investigation, guide, importer, rehearsal and production run."
LastUpdated: 2026-11-06T17:07:33.834793714-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Step 1: What is deployed, what slop.yolo already holds, and the guide

The user asked whether the latest slop.computer is deployed and how to import every artifact from slop.boutique (francois) into slop.yolo. Then they pointed at the cluster repository for database access, noted that slop already has stores that "are empty or have a placeholder", and asked for this ticket and an intern guide before doing the import. This step answers the deployment question, reconstructs the two earlier imports, measures today's gaps against francois's database, and writes the guide.

The finding that shapes everything: the 103 `release` stores already exist and 95 of them already serve the right HTML. The work is a faithful *correction* of existing stores rather than a fresh import: 8 placeholders, 6 altered capability blocks, public grants on paid apps, and no provenance.

### Prompt Context
**User prompt (verbatim):** "ok, did we deploy the latest slop.computer? Now assume we log in to francois, to slop.yolo, and we properly import all the artifacts that are on https://slop.boutique/ (deployed). How would you do that?"

then: "potentially you could also get access to the database through ~/code/wesen/2026-03-27--hetzner-k3s, if that makes things maybe easier. We also already have slop stores that I think are empty or have a placeholder. Any,way, create a docmgr ticket, and Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. Then do it, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"

**Assistant interpretation:** Confirm the deployed version; create SLOP3-013 with an intern guide (uploaded to reMarkable); then implement and run a proper import of slop.boutique's artifacts into slop.yolo's existing stores, with commits and this diary.
**Inferred user intent:** Have slop.yolo carry the real francois catalog (the successor platform should not serve placeholders), with the reasoning recorded for whoever maintains it next.
**Commit (code):** pending — ticket, guide and this entry are the first commit.

### What I did
- **Deployment.** GitOps pins `ghcr.io/go-go-golems/slop-computer:sha-a3da880` (hetzner-k3s commit `122fd1a`), the merge of #30; main since then is docs only. Confirmed on the cluster: `kubectl -n slop get deploy slop -o jsonpath='{..image}'` → `ghcr.io/go-go-golems/slop-computer:sha-a3da880`. PRs #31–#33 are open and not deployed.
- **francois surface.** Read `francois: pkg/catalog/routes.go` (`download`, `mayDownload`), `pkg/catalog/studio.go`, `pkg/catalog/store/migrations/001_core.sql`, `pkg/catalog/releases/releases.go` (`Blobs.Read`). `GET https://slop.boutique/api/catalog` lists 100 artifacts (93 `free_sample`, 7 `subscriber_required` in the public view).
- **History.** Read SLOP-002's guide and diary (v2 API import; placeholders for paid HTML, step 5) and SLOP3-004's `scripts/03-06` (v2 → v3: `04-build-import.py`'s `CAP_BLOCK` mapping, `06-push-import.py`'s grants and policies), and SLOP3-006's generic `/f/:id` mount and open task `2ghn`.
- **Cluster access.** `kubeconfig-k3s-demo-1.tail879302.ts.net.yaml` works; pods `francois-88d87b859-56fqp`, `slop-6577b5fcd5-xz8sf`, `postgres-0`. Database `francois` on `postgres-0`.
- **francois inventory** (read-only session, `PGOPTIONS="-c default_transaction_read_only=on"`): 104 artifacts (4 hidden), 113 releases (110 published, 3 withdrawn), 95 published free samples, 113 html (99,531,690 B) + 113 manifests, 18 attachments (63,806,193 B), 1 artifact without a release (`aasd`), 5 with several releases, 99 instances. Exported as JSON to the scratchpad (`fr013/francois-inventory.json`).
- **Blob layout.** `ls /var/lib/francois/releases` → `blobs variants`; 252 shard dirs; `sha256sum` of one blob equals its name.
- **slop.yolo state** with the saved admin token (scopes `read write admin`, expires 2026-12-02), through a small client `fr013/slopcall.py` that never prints the token: 112 stores (103 `release`); per release store `files.ls`, `snap.ls`, `grant.ls`, `files.cat app.json`.
- **Comparison** (scratch script): 95 stores' `index.html` equal the latest published release by sha256; 8 are placeholders (730–898 B), all paid; every store's single snapshot names the latest release id; attachments match; all grants `@guest interact`. Capability drift computed by replaying `CAP_BLOCK` over francois's manifests: 6 stores.
- **slop code read for the design:** `pkg/commands/files.go` (`push` 300–395, `missing_blobs` at 352, unconditional snapshot at 380, `files.blobs`, `ref.move`), `pkg/commands/stores.go` (grant subjects), `pkg/rt/manifest.go`, `pkg/apps/manifest.go`, `pkg/doors/pages/sandbox.go` and `views.go` (sandbox label and `/v/<n>/`), `pkg/doors/api/api.go` (`maxAPIBody = 96 << 20`), `pkg/access/principal.go` (admins have a level on every store).
- **Ticket and guide.** `docmgr ticket create-ticket --ticket SLOP3-013 …`; guide `design-doc/01-intern-guide-importing-francois-s-catalog-into-slop-v3-stores.md` (15 sections, mermaid diagrams, pseudocode, API and file references); 8 tasks.

### Why
- **Database and volume over the API:** the API cannot hand out paid HTML (`download` is `guard(public, noToken, …)`, `mayDownload` needs an entitled session), which is exactly the gap. Both cluster reads are non-mutating, which honours "francois is read-only".
- **Correct the existing stores instead of importing new ones:** keeps ids, sandbox origins (localStorage), mounts, `sample` policies and visitor data; `import.folder` would create new stores.
- **Ticket scripts over Go code:** v3's one-off migrations have been ticket scripts over the HTTP API (SLOP3-004, SLOP3-006); the v2 `pkg/francois` is gone and the platform should not depend on francois.

### What worked
- Every number in the guide's §7 came from a read-only query or a read verb; nothing was written anywhere yet.

### What didn't work
- `KUBECONFIG=…/kubeconfig-91.98.46.169.yaml kubectl get pods -n francois` hung past the 120 s tool limit (moved to background, stopped). The Tailscale kubeconfig answered immediately.
- `psql -U postgres` in `postgres-0`: `FATAL:  role "postgres" does not exist`. The superuser is `$POSTGRES_USER`; `sh -c 'psql -U "$POSTGRES_USER" …'` works.
- First `store.ls` call sent `{"all": true, "limit": 1000}` → `HTTP Error 400: Bad Request` (`StoreLsIn` has only `all`; strict decoding).
- The 103-store comparison exceeded 120 s (≈ 3 API calls per store) and finished in the background.

### What I learned
- slop's sandbox origin serves **any** snapshot at `/v/<n>/` with no viewer check; the HMAC label is the only protection, and every viewer of the app learns it. This turns francois's per-release access into a per-store constraint: a paid release must not sit in a public store, even off `main`.
- All 8 older published releases (lattice-deck ×2, lattice-phantasmagoria, lattice-rift ×2, tabula-workbench ×2) are paid while their artifacts' latest release is free. So "import history" (task `2ghn`) has nothing it may safely import today.
- The cutover's capability mapping changed security-relevant settings: `hypercore-studio` and `living-comic-studio` lost their `chatlog` `db.rules`.
- `files.push` snapshots even when nothing changed, so idempotence has to come from comparing trees before pushing.

### What was tricky to build
- Telling "the latest release is imported" from "the right bytes are imported": all 103 snapshot messages name the correct latest release id, so a message-based check says everything is fine. Only comparing `index.html`'s sha256 with `release_files.sha256` exposes the 8 placeholders.

### What warrants a second pair of eyes
- The access rule (guide §8.3): paid stores become `@subscriber interact` only. If slop.yolo has no subscribers, those 8 apps become admin-only.
- The sandbox `/v/<n>/` exposure (guide §14) is a platform property worth its own ticket.

### What should be done in the future
- A ticket for viewer checks on sandbox snapshot URLs (or per-snapshot grants).

### Code review instructions
- Read the guide's §7 table against `various/` evidence once the inventory is committed (next step).

### Technical details
```
francois:  104 artifacts (hidden: aasd, craftkit-studio, polis, stackchan-pet-studio); 113 releases; storage_key blobs/<2 hex>/<sha256>
slop.yolo: 112 stores; release 103; mount apps.slop.yolo.scapegoat.dev /f/:id --type release
placeholders: blockout-studio hypercore-studio kiln-workbench living-comic-studio mimeo no-dom-the-interface-is-a-projection octavo-lab polis
caps drift:   craftkit-workbench hypercore-studio lattice-arena lattice-arena-ds living-comic-studio sonnet-new-roman-modular
```

## Step 2: The importer, the verifier, and a local rehearsal

This step builds the four ticket scripts and rehearses them on a local slop. The rehearsal recreates seven production stores the way SLOP3-004 left them: two placeholders, wrong capabilities, attachments, an artifact with paid history and one with withdrawn releases. The importer then fixes them, and a second run plans nothing. History is exercised on a modified inventory, and the verifier checks trees, `main`, grants and anonymous access.

The rehearsal caught two real bugs before production: a truncated `kubectl exec` stream, and a wrong "before" snapshot. It also corrected one claim in the guide (§8.5).

### Prompt Context
**User prompt (verbatim):** see Step 1
**Assistant interpretation:** Implement the import designed in the guide, and prove it locally before touching production.
**Inferred user intent:** A correct, repeatable import, with no surprises on the shared deployment.
**Commit (code):** pending — scripts and this entry are committed together (next commit).

### What I did
- `scripts/01-inventory.sh`: one `json_build_object` query in a read-only session. It leaves out user ids (`grep -c @` → 0, `usr_` → 0). Committed output: `various/inventory-2026-11-06.json` (taken `2026-11-06T22:14:20Z`: 104 artifacts, 113 releases, 18 attachments).
- `scripts/03-import.py`: the planner (dry run by default) and the applier (`--apply`).
  - `desired_tree` builds `index.html`, `app.json` (`{title, page, capabilities: manifest}`, sorted keys), `francois.json` and `attachments/<safeName>`.
  - The plan compares trees with `files.ls`, grants with `grant.ls`, and refs with `ref.ls`.
  - `push` handles `missing_blobs`: it fetches the listed blobs, uploads them with `files.blobs` in batches of 32 MiB or less, and pushes again.
  - Grants are swapped before the push for a paid store, and after it for a free one.
  - `--history` writes older releases to `francois/<version>` refs.
  - Options: `--only`, `--plan-out`, `--log-out` (JSONL), `--emit-apps`.
- `scripts/02-rehearsal-fixtures.py`: rebuilds production-shaped release stores on a **local** server (it refuses any other) with SLOP3-004's `CAP_BLOCK` mapping, placeholders for paid releases, `@guest interact`, `sample` policies and the `/f/:id` mount.
- `scripts/04-verify.py`: tree, `main`, grants and anonymous access, checked per store.
- **Local server:**
  - `go build -o fr013/slop ./cmd/slop` (worktree at `6fa32c2`; the code is the same as production's `a3da880`).
  - `slop serve --local --listen 127.0.0.1:18413 --data fr013/local-data --admin-email admin@example.com` in tmux session `slop013`.
  - Signed in with `POST /auth/local`, read the CSRF token from `GET /auth/session`, then `POST /api/v1/token.new {"scopes":"read,write,admin","days":1}`. The token went to `fr013/local-creds.json` (mode 600) and was never printed.
- **Fixtures:** `weft polis hypercore-studio lattice-deck rag-workbench craftkit-studio lattice-arena`.
- **Scratch validator:** `_validate/main.go` in the worktree, not committed. It runs `apps.Parse` and `Entry()` on each `--emit-apps` file.

### Why
- **Fixtures recreate SLOP3-004's output rather than copying production's stores.** The production bytes are francois's bytes, and the `CAP_BLOCK` mapping and placeholder are known, so the fixtures are faithful without any download from production.
- **Anonymous access is tested with `POST /_site/views`, not `GET /f/<id>/`.** The GET returns the shell page, which is always 200. The shell's view request is where access is decided.

### What worked
- Fixture run: 7 stores at snapshot 1.
- Dry run on the fixtures: `plan: 7 pushes ({'app.json': 7, 'provenance': 7, 'html': 2}), 2 grant changes, 0 history snapshots, 5 skipped`. The skipped entries were lattice-deck 0.1.0 and 0.1.1 ("paid release in a public store") and rag-workbench 0.1.0–0.1.2 ("withdrawn").
- **Apply:**
  - Every store moved to snapshot 2.
  - `hypercore-studio` uploaded 8,179,289 B and `polis` 245,339 B; the other five uploaded 0 B, because their blobs were already present.
  - The log shows `grant.set @subscriber`, then `grant.rm @guest`, then `push` for both paid stores, in that order.
- Second dry run: `plan: 0 pushes ({}), 0 grant changes, 0 history snapshots, 0 skipped` on the history fixture; on the base inventory the result is the same, apart from the 5 deliberate skips.
- **History,** on `inventory-history-fixture.json` (lattice-deck's releases marked free):
  - The applier printed `history 0.1.0 → snapshot 3`, `history 0.1.1 → snapshot 4`, and `main 0.1.2 → snapshot 2`.
  - `ref.ls` → `{"francois/0.1.0": 3, "francois/0.1.1": 4, "francois/0.1.2": 2, "main": 2}`.
  - A rerun is a no-op.
- Verifier: `7 stores, 0 failing; anonymous view status: {('free', 200): 5, ('paid', 401): 2}`.

### What didn't work
- **Fixture push, first try:** `imp.APIError: files.push: 409 missing_blobs: send these blobs` on the *second* push, after `files.blobs`. The cause: `APIError` read `missing` from `error`, while the server puts it in `error.extra.missing`; the body is `{'error': {'code': 'missing_blobs', 'message': 'send these blobs', 'extra': {'missing': […]}}}`. Fixed: `self.extra = err.get("extra") or {}`.
- **Blob fetch:** `blob 20d3fc5a…cdb7: bytes hash to 1673683f…434f` (craftkit-studio's 12,848,209-byte `craftkit-studio-source-project.zip`).
  - In the pod, `ls -l` and `sha256sum` were correct.
  - `kubectl exec … cat … | wc -c` → `10780672`, so the exec stream ends early with no error.
  - Fixed: `Blobs.fetch` reads 4 MiB pieces with `tail -c +off | head -c n`, retries a short piece up to 4 times, and still checks the hash of the whole blob. The fixtures then completed: craftkit-studio 27,724,957 B, lattice-arena 6,392,054 B.
- **Wrong "before":** the plan's `before.n` came from `snap.ls[-1]`, but `snap.ls` lists **newest first**, so it named the oldest snapshot. Fixed: `before = ref.ls()["main"]`. The history check now looks up ref names in that dict, instead of a substring match on its JSON.
- **First verifier:** `FAIL polis: … http=200` for both paid stores. `GET /f/<id>/` returns the shell page (200) whatever the grants are. Replaced with the `_site/views` request (paid → `401 {"error":{"code":"unauthenticated","message":"sign in to open this"}}`). The first version also let `**checks` overwrite the `http` field in each row, which produced a `Counter` of booleans.

### What I learned
- `Turn.Snapshot` (`pkg/store/files.go:183`) returns the ref's current snapshot when the tree hash is unchanged. The final `main` push after history reused snapshot 2. The guide's §8.5 said "always takes a snapshot"; it is corrected.
- An anonymous `POST /_site/views` on a free app creates a visitor (`vis_…`) and sets a `slop_site` cookie. A production verification run therefore uses one cookie jar, which means one visitor, and closes each view with `DELETE /_site/views/<id>`.

### What was tricky to build
- **Silent truncation.** `kubectl exec` exits 0 with fewer bytes, so the only defence is to compare lengths and hashes.
  - The importer checks the hash of the whole blob before uploading it, and that check is what caught the problem.
  - The server checks as well. `putBlobs` (`pkg/commands/data.go:326`) refuses a blob whose bytes do not hash to its key (`invalid_argument … does not match its sha256`), so a corrupt file can never be stored. The local check gives the better message, because it names the source.

### What warrants a second pair of eyes
- `grant.rm` is called with `via: "direct"`, so a grant made through a share link (`via: lnk_…`) is left alone. Those are deliberate shares made by people, not import state.

### What should be done in the future
- N/A for this step.

### Code review instructions
- `scripts/03-import.py`: `plan`, `desired_tree`, `push`, `Blobs.fetch`, `apply` (grant order).
- `scripts/04-verify.py`: `open_view`.
- Rehearsal commands are in "Technical details".

### Technical details
```sh
S=…/scratchpad; export TMPDIR=$S/fr013 SLOP_CREDENTIALS=$S/fr013/local-creds.json
python3 -I scripts/02-rehearsal-fixtures.py various/inventory-2026-11-06.json apps.localhost:18413 weft polis …
python3 -I scripts/03-import.py various/inventory-2026-11-06.json --only weft,polis,… [--apply --log-out local-apply.jsonl]
python3 -I scripts/04-verify.py various/inventory-2026-11-06.json http://apps.localhost:18413 --only weft,polis,…
```
