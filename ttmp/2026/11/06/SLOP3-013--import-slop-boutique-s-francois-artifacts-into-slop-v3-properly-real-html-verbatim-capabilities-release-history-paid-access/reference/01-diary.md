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
