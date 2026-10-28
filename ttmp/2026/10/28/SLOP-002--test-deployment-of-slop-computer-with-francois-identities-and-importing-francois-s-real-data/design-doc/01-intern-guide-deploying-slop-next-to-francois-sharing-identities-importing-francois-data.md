---
Title: 'Intern guide: deploying slop next to francois, sharing identities, importing francois data'
Ticket: SLOP-002
Status: active
Topics:
    - deployment
    - auth
    - data-migration
    - architecture
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: doc/production.md
      Note: slop's own production contract (host classes, flags, backups) that the k3s package must satisfy
    - Path: cmd/slop/cmds/serve.go
      Note: serve flags; OIDC config built at lines 147-155; no --oidc-client-id-file yet
    - Path: cmd/slop/cmds/devseed.go
      Note: seed-directory loader the importer output is modelled on; shows the local-only author impersonation
    - Path: pkg/store/migrations/postgres/001_auth.sql
      Note: users(issuer, subject, role admin|pending|disabled) — the identity join key
    - Path: pkg/store/migrations/postgres/002_kernel.sql
      Note: artifacts, versions, version_files, refs, routes, threads — import targets
    - Path: pkg/server/serve.go
      Note: site serving; /_v/<artifact>/<n>/<file> only for routed pages (gap for media)
    - Path: pkg/server/auth.go
      Note: __Host- cookies, SameSite=Lax — why a same-site sandbox domain is tolerable for a test
    - Path: pkg/blobs/blobs.go
      Note: blob layout blobs/<2 hex>/<sha256>, identical to francois release blobs
    - Path: pkg/records/records.go
      Note: how data-artifact files become records (front matter Markdown, JSON, CSV)
    - Path: pkg/client/kernel.go
      Note: Go client used by the importer (Push, MissingBlobs, PutBlob, SetRoute, PatchArtifact)
    - Path: Dockerfile
      Note: the image the deployment runs
ExternalSources: []
Summary: "How to run a test slop.computer on the hetzner k3s cluster beside francois, signing in with the same ZITADEL organisation, and how to import francois's catalog, releases, posts, creators and media from a restored backup so we can see which francois capabilities slop must grow."
LastUpdated: 2026-10-28T18:30:00-04:00
WhatFor: "Onboarding an intern who will build the deployment package and the importer."
WhenToUse: "Before touching gitops/kustomize/slop, the ZITADEL Terraform for slop, or writing slop import francois."
---

# Intern guide: deploying slop next to francois, sharing identities, importing francois data

## 1. Executive summary

We have two systems built by the same people:

- **francois** is in production at `https://francois.yolo.scapegoat.dev` and `https://slop.boutique`. It is a catalog and storefront for single-file HTML "artifacts", with releases, a blog, creator pages, paid access tiers and a hosted runtime that gives artifacts a database, rooms, comments and file storage.
- **slop.computer** (this repository, ticket SLOP-001) is a workshop where people and coding agents push versioned folders ("artifacts"), comment on them, route them onto public sites, and run small admin "tools". It is finished through phase 7 and ships as a 128 MB Docker image, but it has never run anywhere except a laptop.

This ticket asks three questions, and this guide answers all three:

1. **How do we deploy slop for testing?** Copy francois's GitOps package on the hetzner k3s cluster into a new `slop` namespace: one Deployment, one PVC for blobs, a database on the shared Postgres, secrets from Vault, TLS from cert-manager, Traefik ingress. (Section 6.)
2. **How do we reuse francois's identities?** Point slop at the same ZITADEL instance and the same `Francois` organisation, through a **new** PKCE client. People sign in with the same accounts. Because ZITADEL user IDs are per instance, not per client, a person's `(issuer, subject)` pair is the same in both databases. That lets us mark francois admins as slop admins before they ever sign in. (Section 7.)
3. **How do we get real data in, and learn what slop is missing?** Write `slop import francois`. It reads a *restored copy* of francois's database and blob directory, converts releases, the storefront, posts, creators and media into slop artifacts, pushes them through the normal API, and writes a **capability census**: which francois features the imported data uses that slop cannot yet serve. (Sections 8 and 9.)

Nothing in this ticket changes francois, its database or its OAuth client. Every production-side step is an operator action (Terraform, Vault, Argo CD) and is listed explicitly as such.

## 1a. Implementation status (as built, 2026-10-28)

Read this before the rest: the guide was written first, then implemented, and some facts changed on the way. Details are in the diary (steps 3 onwards).

| Guide section | State | Where |
| --- | --- | --- |
| Phase A: `--oidc-client-id-file`, image workflow, Kubernetes doc | done | slop `db623c3` |
| G1 push on behalf, G2 data files `/_d/` | done | slop `c2ef259` |
| Importer, census, admin import (§7.3, §8, §9) | done, with a second source: the live studio API | slop `7ba914e`, `35a62f8` |
| Health checks on any host (probes) | done | slop `35a62f8` |
| Kustomize package, Vault policies/roles, secrets script (§6) | written, validated with the repo's `validate_gitops.sh`; **not pushed** | hetzner-k3s branch `slop/test-deployment` (`5eaf707`), worktree `../hetzner-k3s-slop` |
| ZITADEL client (§7.1) | written, `terraform validate` ok; **not applied, not pushed** | terraform branch `slop/zitadel-client` (`abc678a`), worktree `../terraform-slop` |
| Operator steps (apply, Vault, Argo, first admin) | not done (operator) | `gitops/kustomize/slop/README.md` |

Corrections to the text below:

- **Issuer.** It is `https://auth.slop.boutique`, not `zitadel.yolo.scapegoat.dev`. All 12 francois users carry this issuer (read through `/api/admin/users`), so matching admins on issuer and subject works.
- **Template.** Since 2026-10-23, `origin/main` of hetzner-k3s has `gitops/kustomize/francois-sandbox` ("Slop sandbox", demo-apps project, `sandbox.slop.boutique`). It was a better template for a test deployment than production, and slop's package follows it. One exception: no Traefik basic-auth gate, because it would consume the `Authorization` header that slop's bearer tokens use.
- **The unpushed sandbox client is live.** The sandbox deployment uses Terraform `envs/sandbox` (local commit `04fd555`), which is still not on `origin/main`. Somebody applied it from a local checkout.
- **Vault path.** `kv/apps/slop/test/runtime`, keys `database username password database-url oidc-client-id oidc-org-id` (francois's key names).
- **Data artifact names.** `francois-catalog`, `francois-journal`, `francois-creators` and `francois-media`, prefixed so they can't collide with a francois artifact called `journal`.
- **Probes.** See §5.2 below.

## 2. How to read this guide

If you are new, read sections 3 and 4 first. They explain the vocabulary: host classes, artifacts and versions, routes, ZITADEL, PKCE and GitOps. Section 5 describes what exists today, with file references. Sections 6 to 9 are the design. Section 10 is the phased plan, with each step marked **[code]** (you write it, in a PR) or **[operator]** (someone with cluster/Vault/Terraform rights runs it). Section 11 covers testing, section 12 risks and open questions, and section 13 lists every file referenced.

Paths without a prefix are relative to the slop repository root. Other repositories:

| Short name | Location | Revision read |
| --- | --- | --- |
| slop | `~/workspaces/2026-10-28/slop-computer/slop-computer` (this repo) | `593e1ce` |
| francois | `../francois` | `106776a` |
| k3s gitops | `~/code/wesen/2026-03-27--hetzner-k3s` | `f758001` |
| terraform | `~/code/wesen/terraform` | `origin/main` @ `e41283c`; local main has unpushed work (see §12) |

## 3. Orientation: what slop is

### 3.1 One binary, three kinds of host

`slop` is both the server (`slop serve`) and the CLI agents use (`slop push`, `slop route`, `slop comments wait`). The server decides what to do with a request from its `Host` header:

```
                         ┌──────────────────────────── slop serve ────────────────────────────┐
 https://slop.computer ─▶│ main host   Workshop SPA, /api, /auth, safe mode /_/               │
                         │             (session cookie __Host-slop_session lives only here)   │
 https://slop.boutique ─▶│ site hosts  route table → page version → HTML + window.slop        │
                         │             (public, no cookies)                                   │
 https://s3f9…​.slop.run ─▶│ sandbox     one unguessable origin per version, for the Workshop's │
                         │             preview/thumbnail/tool iframes                         │
                         └──────────────┬──────────────────────────────┬──────────────────────┘
                                        │                              │
                                   Postgres (or SQLite)        blob directory
                                   users, artifacts, versions, blobs/<aa>/<sha256>
                                   routes, threads, events, tools
```

The contract is written down in `doc/production.md` (section "The three kinds of host"). Its key rule: the sandbox domain should be a **separate registrable domain**, because previews run code anyone with push rights wrote. Section 6.2 explains why we bend that rule for a test deployment, and what that costs.

### 3.2 Artifacts, versions, refs, routes

- An **artifact** has an id (`front-page`), a title, a kind (`page` or `data`) and an optional project. Table: `artifacts` in `pkg/store/migrations/postgres/002_kernel.sql`.
- A **version** is an immutable snapshot of a folder: a manifest (`slop.json` minus bookkeeping), a message, an author, a `via` label (`cli`, `claude`, `agent`, `tool board@1`) and a file list. Tables: `versions` and `version_files(path, sha256, size, media_type)`. Bytes live in the blob directory, addressed by SHA-256.
- A **ref** named `main` points at the version that "is" the artifact. Pushes advance it. A push identical to main is deduplicated (`PushResult.Unchanged`, `pkg/store/artifacts.go`).
- A **route** maps `(host, path pattern)` to a page artifact, following main or pinned to a version. It carries bindings (which data artifact a page reads under which name), an optional `record` binding for `/:slug` pages, and `access` (`public` or `admins`). Every change is logged in `route_log` and can be undone (`slop route undo`).
- A **data artifact** is a folder of records. `pkg/records/records.go` turns each file into a record: Markdown with front matter, JSON, CSV or text. A page declares what it reads in its manifest (`"reads": {"posts": "journal"}`), and the runtime gives it `window.slop.data.posts.list()`.

Example data record, from the dev seed (`examples/seed/artifacts/journal/v3/posts/comments-as-prompts.md`):

```markdown
---
title: Comments are prompts
date: 2026-10-22
tags: [agents, workshop]
author: Manuel
summary: The fastest way to tell an agent what is wrong is to point at it.
---
Writing a good prompt about a layout is hard. Pointing at the layout is easy. …
```

### 3.3 People and roles

slop has three roles: `admin`, `pending` and `disabled` (`users.role`, `001_auth.sql`). **Everyone who signs in for the first time is pending** and sees only a "wait for an admin" screen (`PendingScreen` in `web/workshop/src/app/App.tsx`). There is no "subscriber": slop is a tool for the people who make things, not a store. A user is identified by `UNIQUE (issuer, subject)`, the OIDC issuer URL plus the provider's user id. That pair is the key to the identity plan in section 7.

### 3.4 Agents and tokens

Agents authenticate with personal API tokens (`slop auth login --server …` runs a device-code flow approved in the browser). Tokens have scopes `read`, `write` and `admin`. A push records which token made it, and `via` says what kind of client did. Tools get a short-lived **grant** (`slg_…`) instead of a token, limited to permissions an admin approved (`pkg/store/tools.go`, `pkg/server/tools.go`).

### 3.5 What the importer will call

The import goes through the same HTTP API the CLI uses, via the Go client in `pkg/client/kernel.go`:

| Call | HTTP | Guard |
| --- | --- | --- |
| `PutProject` | `PUT /api/projects/{id}` | admin |
| `MissingBlobs` | `POST /api/blobs/missing` | `versions:push` |
| `PutBlob` | `PUT /api/blobs/{sha}` | `versions:push` |
| `Push` | `POST /api/artifacts/{id}/versions` | `versions:push` |
| `PatchArtifact` | `PATCH /api/artifacts/{id}` | admin |
| `SetRoute` | `PUT /api/routes` | `routes:write` |

Route registrations are in `pkg/server/kernel.go:26-48`.

## 4. Orientation: francois, ZITADEL and the cluster

### 4.1 francois in one paragraph

francois sells and hosts single-file HTML artifacts. A **catalog artifact** (`catalog_artifacts`) has a storefront page (`page` jsonb with `body`, `cover` and `gallery`, plus a `page_draft`), tags, visibility, an early-access date, a launch mode, featured and sort flags. Each artifact has **releases** (`releases`: semver-ish `version`, `changelog`, `manifest` jsonb, `state draft|published|withdrawn`, `free_sample`, `created_by`). A release has exactly two files (`release_files.role html|manifest`), and may have **attachments** (`release_attachments`: extra downloads). There is a blog (`posts`: markdown `body`, `cover_media_id`, `author_id` → `creators`), creator profiles (`creators`, linked to artifacts through `artifact_creators`) and an image library (`catalog_media`, referenced from markdown as `/media/<id>`). Schema: `../francois/pkg/catalog/store/migrations/001_core.sql`, `004_storefront.sql` and `006_videos_attachments.sql`.

### 4.2 The francois runtime and its capabilities

A release's manifest asks for **capabilities**, which francois's hosted runtime grants when it runs the HTML inside an "instance". The full list is in `../francois/pkg/catalog/releases/releases.go:204`:

```go
var capabilities = map[string]bool{"sample": true, "db": true, "user": true, "room": true,
    "comments": true, "assets": true, "artifact": true, "downloads": true, "files": true}
```

The example `../francois/examples/capabilities.manifest.json` asks for all of them:

```json
{ "sample": {"images": true}, "db": {}, "user": {"scopes": ["profile"]},
  "room": {"topics": {"reaction": "interact"}}, "comments": {}, "downloads": true,
  "assets": {}, "artifact": {}, "files": {"project": "local"} }
```

whereas `polis.manifest.json` asks only for `{ "sample": {} }`. The runtime keeps per-instance state in `instances`, `instance_documents` (the `db` capability), `instance_assets`, `instance_threads`/`instance_comments` and `instance_leases`. An HTML file that uses the runtime contains `id="francois-view"` or loads `/static/runtime.js` (`bootstrapMarker`, same file).

**Why this matters:** slop's page runtime (`pkg/render/assets/runtime.js`) gives a page only `slop.route`, `slop.data` (read-only records), `slop.record`, `slop.version`, `slop.tokens` and, for tools, `slop.tool`. A francois release that needs `db`, `room` or `user` will load in slop but cannot work. The census in section 9 counts exactly how many releases are affected.

### 4.3 ZITADEL, OIDC and PKCE in five bullets

- **ZITADEL** is the identity provider. Its issuer has been `https://auth.slop.boutique` since hetzner-k3s commit `cfe0ebb` (2026-10-23); the management API is still reached at `zitadel.yolo.scapegoat.dev` (Terraform provider `domain`). It holds the accounts. GitHub and Google are upstream identity providers linked by email.
- An **organisation** (`Francois`, id `394966170567966836`) groups users. A **project** groups applications. An **application** is an OAuth client with a client id and allowed redirect URIs.
- **OIDC authorisation code + PKCE**: the browser goes to ZITADEL, comes back to `<app>/auth/callback?code=…`, and the server exchanges the code with a one-time verifier. No client secret is needed (a "public" client). slop implements this in `pkg/identity` and stores the flow in `login_flows`.
- The ID token's `iss` is the instance URL and its `sub` is the ZITADEL **user id**, which is the same for every application in the instance. This is why identities carry over between francois and slop.
- The scope `urn:zitadel:iam:org:id:<org>` makes the login page use that organisation's login policy and IdPs. Both francois and slop must request it: francois via `--oidc-extra-scopes`, slop via `--oidc-scope` (`cmd/slop/cmds/serve.go:47`).

### 4.4 The cluster and GitOps in five bullets

- One hetzner node runs **k3s** (Kubernetes). Ingress is **Traefik**. TLS certificates come from **cert-manager** with Let's Encrypt DNS-01 issuers (DigitalOcean DNS).
- **Argo CD** watches the gitops repo. An `Application` (`gitops/applications/francois.yaml`: project `prod-apps`, automated prune + selfHeal, ServerSideApply) points at a kustomize directory (`gitops/kustomize/francois/`). **Merging to the gitops repo is deploying.**
- **Vault** holds secrets. The Vault Secrets Operator syncs `kv/apps/francois/prod/runtime` into a Kubernetes Secret (`VaultStaticSecret`, refreshAfter 30s, restarting the Deployment on change). Access goes through a Kubernetes auth role (`vault/roles/kubernetes/francois-prod.json`) and policy (`vault/policies/kubernetes/francois-prod.hcl`).
- **Postgres** is a shared cluster in namespace `postgres` (`postgres.postgres.svc.cluster.local:5432`). Each app gets its own database and role, created by a bootstrap Job (`db-bootstrap-script-configmap.yaml`) using credentials from Vault (`scripts/bootstrap-francois-secrets.sh`).
- **Backups:** nightly `pg_dumpall` of the whole cluster, plus a CronJob `francois-backup` that syncs `/var/lib/francois/releases/blobs` to `s3://<bucket>/<francois-prefix>releases/blobs/`. A restore has never been rehearsed (`../francois/doc/production.md` §10).

## 5. Current state, with evidence

### 5.1 slop is ready to package, not to deploy

| Piece | State | Where |
| --- | --- | --- |
| Image | Multi-stage, Workshop embedded with `-tags embed`, 128 MB, runs `slop serve --listen 0.0.0.0:8080 --blobs /var/lib/slop/blobs` | `Dockerfile` |
| Migrations | Applied at start (`--no-migrate` to skip) | `pkg/store/migrations/postgres/001…004` |
| Health | `/healthz` (process), `/readyz` (database) | `doc/production.md` "Health" |
| Proxy | Needs `Host` passed through, SSE unbuffered (`/api/events`, `comments wait`), `--trust-proxy-headers` | same, "DNS and TLS" |
| Secrets from files | `--database-url-file`, `--oidc-client-secret-file` | `cmd/slop/cmds/serve.go` |
| Secrets from files, missing | **no `--oidc-client-id-file`**: the client id must be an argument | `serve.go:45` |
| First admin | `slop db users promote --user-id …` after first sign-in | `doc/production.md` "Identity" |
| Blob GC | `slop db gc-blobs` with a 24h grace | `doc/production.md` |
| Image registry | none yet; francois publishes `ghcr.io/go-go-golems/francois:sha-<short>` from CI | `../francois/.github/workflows/publish-image.yaml` |

### 5.2 francois's deployment package (what we will copy)

`gitops/kustomize/francois/` in the k3s repo, file by file:

| File | What it does | Copy for slop? |
| --- | --- | --- |
| `kustomization.yaml` | `namespace: francois`, resource list, `part-of` label | yes |
| `namespace.yaml` | namespace `francois` | yes → `slop` |
| `serviceaccount.yaml`, `vault-connection.yaml`, `vault-auth.yaml` | SA `francois`; `VaultAuth` with role `francois-prod` | yes → `slop-prod` |
| `runtime-secret.yaml` | `VaultStaticSecret` `kv` `apps/francois/prod/runtime` → Secret, rolloutRestartTargets | yes |
| `pi-secret.yaml`, `fonts-secret.yaml` | optional secrets for francois's model backend and fonts | **no** |
| `db-bootstrap-serviceaccount.yaml`, `db-bootstrap-vault-auth.yaml`, `postgres-admin-secret.yaml` (Vault `infra/postgres/cluster`), `db-bootstrap-script-configmap.yaml`, `db-bootstrap-job.yaml` | a Job with cluster-admin Postgres credentials that creates the role and database | yes, renamed |
| `persistentvolumeclaim.yaml` | `francois-data` for `/var/lib/francois` | yes → `slop-data` |
| `deployment.yaml` | 1 replica, `Recreate`, runAsUser 10001, probes with a `Host` header | yes, adapted |
| `service.yaml` | ClusterIP :8080 | yes |
| `certificate.yaml` | issuer `letsencrypt-prod-dns01-digitalocean`; `francois.yolo.scapegoat.dev`, `*.apps.francois.yolo.scapegoat.dev` | yes, slop names |
| `certificate-slop-boutique.yaml` | issuer `letsencrypt-prod-dns01-digitalocean-follow` for `slop.boutique` | **no** (francois keeps that domain) |
| `ingress.yaml` | Traefik; hosts `francois.yolo.scapegoat.dev`, `*.apps.francois.yolo.scapegoat.dev`, `slop.boutique`, `*.slop.boutique` | yes, slop hosts |
| `network-policy.yaml` | ingress from Traefik and node 91.98.46.169; egress to kube-dns, Postgres primary :5432, Traefik :8443 (the ZITADEL hairpin) and :443 | yes, it matters (see §6.5) |
| `backup-serviceaccount.yaml`, `backup-vault-auth.yaml`, `backup-storage-secret.yaml`, `backup-cronjob.yaml` | blobs to S3 | later (§10, phase E) |

There is no `gitops/kustomize/slop*` directory yet (only the unrelated `hyperslop-systems`).

Two details from `deployment.yaml` are worth knowing before you copy it:

- The probes send `Host: francois.yolo.scapegoat.dev`, because the app routes by host and answers unknown hosts with 421. *Correction (as built):* slop did the same until commit `35a62f8`, which makes `/healthz` and `/readyz` answer on hosts it does not serve, so slop's probes need no Host header (and the Docker `HEALTHCHECK` on 127.0.0.1 works).
- The OIDC flags read the org id from the environment: `--oidc-extra-scopes=urn:zitadel:iam:org:id:$(FRANCOIS_ZITADEL_ORG_ID)`, and the client id from a file, `--oidc-client-id-file`. slop has no client-id-file flag (§5.1). Either add one (recommended, a 10-line change) or pass the client id as a literal argument; it is not a secret.

### 5.3 Identity configuration (Terraform)

On `origin/main` of the terraform repo, `zitadel/francois/envs/prod/main.tf` defines:

- `zitadel_organization.francois`
- project `francois`, with role checks off
- app `francois_portal`: PKCE, redirect URIs from `var.public_url` plus `var.alias_urls`
- GitHub and Google IdPs with `is_creation_allowed` and auto-linking by email
- the login policy, `allow_register = var.allow_register`

`variables.tf` defaults: `public_url = "https://francois.yolo.scapegoat.dev"`, `alias_urls = ["https://slop.boutique"]`, **`allow_register = true`** (commit `e41283c`). **Anyone with a Google or GitHub account can create an account in this organisation.** For francois this is the point: subscribers sign up. For slop it means strangers can reach the "pending" screen. That is safe (pending users see nothing), but the pending list will fill with francois subscribers. Section 7.3 deals with this.

There is a precedent for exactly the client we need. Commit `04fd555` ("feat(identity): provision separate Slop sandbox PKCE client") adds `zitadel/francois/envs/sandbox/main.tf` with the comment *"Share operator identities, not application databases or OAuth clients"*. It creates project `francois-sandbox` with app `slop-sandbox-web` (redirect `https://sandbox.slop.boutique/auth/callback`, PKCE, auth method NONE) in org `394966170567966836`. **That commit exists only on someone's local `main` and is on no remote branch** (local main is 18 ahead, 7 behind `origin/main`). Do not build on it until its author pushes or abandons it (§12).

### 5.4 Data volume and shape

We have not read production row counts, on purpose: this ticket does not touch production. The importer reports counts on its first dry run against the restored copy (§9.4). Known shape:

- Release HTML files are single files, often with inlined fonts and images (francois's credential scanner has a comment about "a few hundred KB of base64"), so the blob directory is the bulk of the data.
- francois's blob layout is `releases/blobs/<2 hex>/<sha256>` (`keyPattern` in `releases.go:35`). slop's is `<root>/blobs/<2 hex>/<sha256>` (`pkg/blobs/blobs.go:48`). **Identical addressing**, so blobs can be copied with `rsync` and pushes will find them already present (§8.6).

## 6. Design: the deployment

### 6.1 Goals and non-goals

Goals:

- slop runs on the same cluster, reachable over HTTPS, with real TLS and real sign-in.
- A small group (the francois admins) can use the Workshop and point agents at it.
- Imported francois content is visible on a slop site host.

Non-goals:

- Replacing francois or serving `slop.boutique` from slop. francois keeps its hosts.
- High availability. One replica, Recreate, like francois.
- Public visitors. The site host is public, but we will not announce it.

### 6.2 Host names

| Role | Proposed | Why |
| --- | --- | --- |
| Main (`--public-url`) | `https://slop.yolo.scapegoat.dev` | same pattern as francois |
| Site (`--site-host`) | `site.slop.yolo.scapegoat.dev` | public, cookieless |
| Sandbox (`--sandbox-domain`) | `sbx.slop.yolo.scapegoat.dev` → origins `s<20 hex>.sbx.slop.yolo.scapegoat.dev` | one wildcard certificate, DNS-01 |

**The sandbox is same-site with the main host here** (both are under `scapegoat.dev`). `doc/production.md` asks for a separate registrable domain. For a test with admins only, this is acceptable for these reasons:

- slop's cookies are `__Host-` prefixed (`pkg/server/auth.go:43,50`), so a sandbox page cannot toss or overwrite them.
- They are host-only and `HttpOnly`, so a sandbox page cannot read them.
- State-changing requests need a CSRF token that sandbox pages never see.
- `/api` CORS answers sandbox origins only without credentials (`pkg/server/tools.go`, `cors()`).

What we lose: `SameSite=Lax` no longer separates them, so a sandbox page's top-level navigation to the main host carries the session cookie. francois already accepts the same trade-off with `*.apps.francois.yolo.scapegoat.dev`. **Before slop is used by anyone outside the admin group, buy a separate domain for the sandbox** (decision record D3).

DNS: no change is needed. On 2026-10-28, `dig +short slop.yolo.scapegoat.dev` and `dig +short x.sbx.slop.yolo.scapegoat.dev` both return `91.98.46.169`, the node, through the existing `*.yolo.scapegoat.dev` wildcard. DNS-01 needs only the issuer's DigitalOcean token, which cert-manager already has.

### 6.3 The kustomize package

New directory `gitops/kustomize/slop/` in the k3s repo, plus `gitops/applications/slop.yaml`. The differences from francois are the interesting part:

```yaml
# deployment.yaml (abridged)
spec:
  replicas: 1
  strategy: { type: Recreate }          # the PVC is ReadWriteOnce
  template:
    spec:
      serviceAccountName: slop
      securityContext: { runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001, runAsNonRoot: true }
      containers:
        - name: slop
          image: ghcr.io/go-go-golems/slop-computer:sha-<short>
          args:
            - serve
            - --listen=0.0.0.0:8080
            - --blobs=/var/lib/slop/blobs
            - --database-url-file=/run/slop/database-url
            - --public-url=https://slop.yolo.scapegoat.dev
            - --site-host=site.slop.yolo.scapegoat.dev
            - --sandbox-domain=sbx.slop.yolo.scapegoat.dev
            - --oidc-issuer=https://auth.slop.boutique
            - --oidc-client-id-file=/run/slop/oidc-client-id      # new flag, see §10 phase A
            - --oidc-scope=urn:zitadel:iam:org:id:$(SLOP_ZITADEL_ORG_ID)
            - --trust-proxy-headers
          env:
            - name: SLOP_ZITADEL_ORG_ID
              valueFrom: { secretKeyRef: { name: slop-runtime, key: zitadel-org-id } }
          ports: [{ containerPort: 8080, name: http }]
          readinessProbe: { httpGet: { path: /readyz, port: http } }
          livenessProbe:  { httpGet: { path: /healthz, port: http } }
          volumeMounts:
            - { name: data, mountPath: /var/lib/slop }
            - { name: runtime, mountPath: /run/slop, readOnly: true }
      volumes:
        - { name: data, persistentVolumeClaim: { claimName: slop-data } }
        - name: runtime
          secret:
            secretName: slop-runtime
            items:
              - { key: database-url, path: database-url }
              - { key: oidc-client-id, path: oidc-client-id }
```

```yaml
# ingress.yaml (abridged)
spec:
  ingressClassName: traefik
  tls: [{ secretName: slop-tls, hosts: [slop.yolo.scapegoat.dev, site.slop.yolo.scapegoat.dev, "*.sbx.slop.yolo.scapegoat.dev"] }]
  rules:
    - host: slop.yolo.scapegoat.dev
      http: { paths: [{ path: /, pathType: Prefix, backend: { service: { name: slop, port: { name: http } } } }] }
    - host: site.slop.yolo.scapegoat.dev      # same backend
    - host: "*.sbx.slop.yolo.scapegoat.dev"   # same backend
```

```yaml
# certificate.yaml
spec:
  secretName: slop-tls
  issuerRef: { name: letsencrypt-prod-dns01-digitalocean, kind: ClusterIssuer }
  dnsNames: [slop.yolo.scapegoat.dev, site.slop.yolo.scapegoat.dev, "*.sbx.slop.yolo.scapegoat.dev"]
```

**Server-sent events through Traefik.** `/api/events` and `slop comments wait` are long-lived streams. Traefik does not buffer responses by default, so no middleware is needed, but check the idle timeout. If streams drop every 60 to 180 seconds, the Workshop reconnects (the browser console shows `ERR_INCOMPLETE_CHUNKED_ENCODING`, which we saw locally when the server restarted). That is acceptable. A `comments wait` that keeps reconnecting is not, so test it (§11).

### 6.4 Secrets and the database

Vault path `kv/apps/slop/prod/runtime` with keys:

| Key | Value | Source |
| --- | --- | --- |
| `database-url` | `postgres://slop_app:<pw>@postgres.postgres.svc.cluster.local:5432/slop?sslmode=disable` | generated by the bootstrap script |
| `oidc-client-id` | the new ZITADEL app's client id | Terraform output |
| `zitadel-org-id` | `394966170567966836` | constant |

A copy of `scripts/bootstrap-francois-secrets.sh` creates the password and writes the path. A copy of `vault/policies/kubernetes/francois-prod.hcl` (read `kv/data/apps/slop/prod/*`) and `vault/roles/kubernetes/francois-prod.json` (bound to SA `slop`, namespace `slop`) grant access. The db bootstrap Job creates role `slop_app` and database `slop`, owned by `slop_app`. slop creates its own tables on start.

### 6.5 Network policy

Copy francois's policy exactly, renaming selectors. The non-obvious line is egress to **Traefik on 8443**. slop's server fetches ZITADEL's discovery document and exchanges codes at `https://auth.slop.boutique`, which resolves to the node's public address. Inside the cluster that "hairpins" back into Traefik. Without that rule, sign-in fails with a timeout at the callback, not with a helpful error. Egress to :443 covers anything external (nothing today; later perhaps an LLM for agents running in-cluster).

### 6.6 Picture of the result

```
                       ┌───────────────────── hetzner k3s node ─────────────────────┐
  browser ─TLS─▶ Traefik ─┬─ francois.yolo… / slop.boutique ─▶ ns francois ─▶ francois pod ─┐
                         │                                                                 │
                         ├─ slop.yolo…, site.slop.yolo…, *.sbx.slop.yolo… ─▶ ns slop ─▶ slop pod ─┐
                         │                                                                 │      │
                         └─ zitadel.yolo… ─▶ ns zitadel ◀──── OIDC (hairpin :8443) ────────┴──────┤
                                                                                                  │
                         ns postgres: postgres primary ◀── db francois (francois_app) ────────────┤
                                                       ◀── db slop (slop_app) ───────────────────┘
                         Vault ─(VSO)─▶ Secret francois-runtime / Secret slop-runtime
                         PVC francois-data (/var/lib/francois)   PVC slop-data (/var/lib/slop)
                       └────────────────────────────────────────────────────────────┘
```

The two applications share only Traefik, ZITADEL and the Postgres *server*. They have separate databases, roles, secrets, volumes and OAuth clients.

## 7. Design: sharing identities

### 7.1 The new OAuth client

Add to Terraform, in a new environment `zitadel/francois/envs/slop/` (or an extension of the unpushed `sandbox` environment, once its owner decides; §12):

```hcl
# Pseudocode; mirror resource names from envs/prod and from 04fd555.
data "zitadel_org" "francois" { id = "394966170567966836" }

resource "zitadel_project" "slop" {
  org_id = data.zitadel_org.francois.id
  name   = "slop"
}

resource "zitadel_application_oidc" "slop_web" {
  org_id                      = data.zitadel_org.francois.id
  project_id                  = zitadel_project.slop.id
  name                        = "slop-web"
  redirect_uris               = ["https://slop.yolo.scapegoat.dev/auth/callback"]
  post_logout_redirect_uris   = ["https://slop.yolo.scapegoat.dev/"]
  response_types              = ["OIDC_RESPONSE_TYPE_CODE"]
  grant_types                 = ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"]
  app_type                    = "OIDC_APP_TYPE_WEB"
  auth_method_type            = "OIDC_AUTH_METHOD_TYPE_NONE"   # PKCE public client
}

output "slop_client_id" { value = zitadel_application_oidc.slop_web.client_id }
```

Do **not** add slop's callback to `francois_portal`'s redirect URIs. Sharing a client would let either app redeem the other's codes, and would tie slop's sign-in to francois's Terraform variables. That is decision record D2.

### 7.2 Why identities line up

```
ZITADEL user 2846…  (Ramon, linked to GitHub ramon@…)
   │
   ├── signs in to francois (client francois-portal)  → id_token { iss: https://auth.slop.boutique, sub: 2846… }
   │                                                     francois.users(issuer, subject) = (…, 2846…)  role admin
   │
   └── signs in to slop (client slop-web)             → id_token { iss: https://auth.slop.boutique, sub: 2846… }
                                                         slop.users(issuer, subject)     = (…, 2846…)  role ?
```

Same `iss`, same `sub`: we can match the rows. ZITADEL's `sub` is the user id in the instance, not a per-client pairwise id. Verify this on the first sign-in (§11, test I2) rather than trusting this paragraph.

### 7.3 Who becomes a slop admin

Default slop behaviour: first sign-in creates a pending user. We add an explicit import step for admins, and leave everyone else pending:

```
slop import francois-users --francois-db <restored-dsn> --database-url-file … [--dry-run]

for each row in francois.users where role = 'admin' and not disabled:
    upsert slop.users (id = new id, issuer, subject, email, email_verified, display_name,
                       role = 'admin', created_at = now())
       on conflict (issuer, subject) do update set role = 'admin'   -- a pending row from an earlier sign-in
    audit("user.import", subject = id, summary = {from: "francois", francois_id})
report counts: admins imported, already present, skipped (disabled)
```

This writes directly to the store, like `slop db users promote`, so it belongs under `slop db`, needs the database URL, and runs from a `kubectl exec` or a one-off Job. It never touches francois. Subscribers are not imported: slop has no use for them, and with public signup on (§5.3), "everyone in the org" means "anyone with a Google account".

Alternative considered (D4): an org-level ZITADEL role or grant such as `slop:admin`, checked by slop at sign-in. That is cleaner long-term, but slop has no role-claim mapping today. The import is one command and is reversible with `slop db users` (set the role back to pending).

### 7.4 Agent tokens

Agents use personal tokens from `slop auth login --server https://slop.yolo.scapegoat.dev`. The device flow's approval page is on the main host and needs a signed-in admin. Nothing francois-specific is involved. Put `SLOP_VIA=agent` in agents' environments (`doc/production.md`, "Agents").

## 8. Design: the importer

### 8.1 Principles

1. **Never read production.** Input is a restored copy: a Postgres database restored from the nightly `pg_dumpall` (only the `francois` database), plus a blob directory restored from S3. Rehearsing that restore is a deliverable in its own right, since francois has never done one (§10 phase C).
2. **Write through the API** for artifacts, versions and routes, so that every slop invariant (dedup, refs, events, audit, `via`) holds. Use the store directly only for users (§7.3).
3. **Idempotent.** Re-running pushes nothing new: versions identical to main are deduplicated server-side, and the importer skips artifacts whose imported marker matches (§8.5).
4. **Two stages**, so you can inspect the output: `extract` writes a seed-format directory (the same shape as `examples/seed`), and `push` loads a directory. During development, push into a local `slop serve --local` first.

```
restored francois db ─┐                                       ┌─▶ census.md / census.json
                      ├─▶ slop import francois extract ─▶ out/├─▶ seed.json
restored blob dir ────┘        (read-only SQL + files)        └─▶ artifacts/<id>/v<n>/…
                                                                       │
                                     slop import francois push out/ ───┘──▶ slop API (local or k3s)
```

### 8.2 The mapping

| francois | slop | Notes |
| --- | --- | --- |
| `catalog_artifacts` row | project `francois` (one), plus **page artifact `<id>`** | id kept if it matches slop's id rule; francois allows `_`, slop ids are `[a-z0-9][a-z0-9-]{0,62}` → replace `_` with `-`, record the mapping |
| `releases` (ordered by `created_at`), `state ∈ {published, draft}` | versions `v1…vN` of `<id>` | tree: `index.html` = release HTML, `francois.manifest.json` = release manifest; message = `"<version>: <first line of changelog>"`; `via = "import"` |
| `releases.state = withdrawn` | a version, but **not main** | see gap G4; for now: push it, then push the next one; if the last release is withdrawn, set `main` to the newest non-withdrawn version with `PUT /api/artifacts/{id}/refs/main` |
| `release_attachments` | extra files in that version's tree under `attachments/<name>` | blobs shared |
| storefront fields (`title`, `description`, `tags`, `visibility`, `page`, `featured`, `sort_order`, `early_access_until`, `launch_mode`, `demo_enabled`, creators) | **data artifact `catalog`**, one record `<id>.json` per catalog artifact | `page.body` is Markdown; `/media/<id>` links are rewritten (§8.4) |
| `page_draft` | ignored, census counts non-empty drafts | slop has no drafts; a draft is an unpushed version |
| `posts` | **data artifact `journal`**, one record `<slug>.md` per post | front matter: title, date (`published_at`), tags, author (creator slug), summary, cover, state; body = Markdown |
| `creators` + `artifact_creators` | **data artifact `creators`**, one `<slug>.json` each; the catalog record lists creator slugs in order | `user_id` kept as `francois_user` for reference only |
| `catalog_media` | **data artifact `media`**, files `files/<id>.<ext>` plus `index.json` with `width`, `height`, `alt` | see gap G2 for how pages reach them |
| `users` (admins) | slop users (§7.3) | separate command |
| instances, instance_* , billing, plans, access_grants, analytics, model_calls | **not imported**; census counts | runtime and commerce state |

Pages to view this data are **not** part of the importer. Once data is in, an agent builds a `catalog-index` page, a `catalog-entry` page (`/:id` with `record` binding on `catalog`), and `journal`/`journal-post` pages, exactly as in the SLOP-001 two-agent test. That is the point of the exercise: it tells us what slop is missing.

### 8.3 Extract: pseudocode

```go
// cmd/slop/cmds/import_francois.go  (new) — `slop import francois extract`
func extract(ctx, db *sql.DB, blobs string, out string) (Census, error) {
    seed := Seed{Projects: []Project{{ID: "francois", Name: "francois import", Brief: "Imported from francois on <date>"}}}
    census := newCensus()

    arts := query(db, `SELECT id, title, description, tags, visibility, page, page_draft, featured, sort_order,
                              early_access_until, launch_mode, demo_enabled FROM catalog_artifacts ORDER BY sort_order, id`)
    for _, a := range arts {
        id := slopID(a.ID)                                // '_' → '-', check collisions
        rels := query(db, `SELECT r.id, r.version, r.changelog, r.manifest, r.state, r.free_sample, r.created_by, r.created_at,
                                  f.role, f.sha256, f.storage_key, f.size
                           FROM releases r JOIN release_files f ON f.release_id = r.id
                           WHERE r.artifact_id = $1 ORDER BY r.created_at`, a.ID)
        art := SeedArtifact{ID: id, Title: a.Title, Kind: "page", Project: "francois"}
        for n, r := range groupByRelease(rels) {
            dir := filepath.Join(out, "artifacts", id, fmt.Sprintf("v%d", n+1))
            linkBlob(blobs, r.HTML.StorageKey, r.HTML.SHA256, filepath.Join(dir, "index.html"))   // hardlink or copy, verify sha
            writeJSON(filepath.Join(dir, "francois.manifest.json"), r.Manifest)
            for _, att := range attachments(db, r.ID) {
                linkBlob(blobs, att.StorageKey, att.SHA256, filepath.Join(dir, "attachments", safeName(att.Name)))
            }
            art.Versions = append(art.Versions, SeedVersion{N: n + 1, Message: r.Version + ": " + firstLine(r.Changelog),
                By: "import", Via: "import", Manifest: json.RawMessage(`{"francois":{"release":"` + r.ID + `"}}`)})
            census.release(a.ID, r)                         // capabilities, markers, state, size
        }
        seed.Artifacts = append(seed.Artifacts, art)
        writeRecord(out, "catalog", id+".json", catalogRecord(a, creatorsOf(db, a.ID), rewriteMedia))
        census.storefront(a)
    }
    for _, p := range query(db, `SELECT slug, title, summary, body, cover_media_id, author_id, tags, state, published_at FROM posts`) {
        writeRecord(out, "journal", p.Slug+".md", frontMatter(p)+rewriteMedia(p.Body))
    }
    for _, c := range query(db, `SELECT slug, name, bio, avatar_media_id, links, sort_order, user_id FROM creators`) {
        writeRecord(out, "creators", c.Slug+".json", creatorRecord(c, rewriteMedia))
    }
    for _, m := range query(db, `SELECT id, sha256, storage_key, media_type, width, height, alt FROM catalog_media`) {
        linkBlob(blobs, m.StorageKey, m.SHA256, filepath.Join(out, "artifacts", "media", "v1", "files", m.ID+ext(m.MediaType)))
        index[m.ID] = MediaInfo{Width: m.Width, Height: m.Height, Alt: m.Alt, Type: m.MediaType}
    }
    // data artifacts are v1 of "catalog", "journal", "creators", "media" (kind "data")
    write(out, "seed.json", seed)
    write(out, "census.json", census); write(out, "census.md", census.Markdown())
    return census, nil
}
```

SQL notes:

- Use the restored database with a read-only role, or `SET default_transaction_read_only = on`. The importer has no business writing there.
- `page` is jsonb `{body, cover, gallery}` (`../francois/pkg/catalog/store/releases.go`, struct `Page`). Decode it with a struct of your own, not francois's package: slop must not import francois.

### 8.4 Media links

francois Markdown references images as `/media/<id>`. On a slop site host, a page can fetch files of a routed page's version through `/_v/<artifact>/<n>/<file>` (`pkg/server/serve.go`, `versionPath`), but **only if that artifact is routed** (`routedPage`). Data artifacts are not routed. So there is no URL today for `media/files/<id>.png`. That is gap G2. Until it is closed, the importer rewrites `/media/<id>` to a placeholder `slop-media:<id>`, and pages resolve it themselves. Two options for closing it:

- **(preferred)** Serve files of data artifacts that a routed page *reads* (binding or manifest `reads`), at `/_d/<artifact>/<n>/<file>`, with the same immutable caching as blobs. The check is "is some public route's page reading this artifact", which mirrors `routedPage`.
- Route a trivial `media` page and use `/_v/media/<n>/files/<id>.png`. This works today, but it makes a page artifact out of what is really data.

### 8.5 Push: pseudocode

```go
// `slop import francois push <dir> --server … [--host site.slop…]`
// Reuses devseed's loader; the differences are authorship and idempotency.
func push(ctx, api *client.Client, dir string) error {
    seed := readSeed(dir)
    api.PutProject(ctx, seed.Projects[0])
    for _, art := range dataFirst(seed.Artifacts) {
        existing, err := api.Artifact(ctx, art.ID)
        start := 0
        if err == nil { start = importedUpTo(existing) }      // versions whose manifest carries francois.release ids we already pushed
        for i := start; i < len(art.Versions); i++ {
            tree := uploadDir(ctx, api, versionDir(dir, art, i))   // MissingBlobs then PutBlob for the missing ones
            req := client.PushRequest{Tree: tree, Manifest: art.Versions[i].Manifest, Message: art.Versions[i].Message, Via: "import"}
            if i == 0 && existing == nil { req.Create = &client.CreateArtifact{Title: art.Title, Kind: art.Kind, Project: &art.Project} } else { req.Base = &prev }
            res := api.Push(ctx, art.ID, req)                      // Unchanged == already there: fine
            prev = res.N
        }
        fixMain(ctx, api, art)                                     // withdrawn last release → main to previous
    }
    return nil
}
```

Authorship: every imported version is authored by the person whose token runs the import, with `via: "import"`. The francois author (`releases.created_by`) is kept in the message trailer (`imported from francois release r_…, by <name>`). slop has no "push on behalf of" (gap G1). `devseed.go` impersonates authors only in `--local` mode, through `LocalToken`, which is correct: a production server must not let one user write as another.

### 8.6 Moving bytes cheaply

Both systems name blobs `blobs/<aa>/<sha256>`. For the k3s deployment:

```
# operator, once, after restoring francois blobs to a scratch PVC or the operator's machine
kubectl -n slop cp ./restored/releases/blobs <slop-pod>:/var/lib/slop/       # or rsync through a debug pod
kubectl -n slop exec <slop-pod> -- chown -R 10001:10001 /var/lib/slop/blobs
```

After that, `MissingBlobs` returns nothing for release files and the push uploads only manifests and records. This is optional, since pushing over HTTPS also works, just slower. Unreferenced copied blobs (from releases we skip) are removed later by `slop db gc-blobs`, after its 24-hour grace.

## 9. Design: the capability census

The census is the real product of the import. It turns "what support should we add?" into counted facts.

### 9.1 What it measures

For every release:

- the manifest's capability keys (`sample`, `db`, `user`, `room`, `comments`, `assets`, `artifact`, `downloads`, `files`) and their options
- whether the HTML has the runtime bootstrap marker (`id="francois-view"` or `/static/runtime.js`)
- external `<script src>` hosts (francois's own `externalScript` regex)
- HTML size, and attachment count and size
- `state`, `free_sample`

For every catalog artifact: `visibility`, `early_access_until` in the future, `launch_mode`, `featured`, non-empty `page_draft`, `demo_enabled`, gallery size, creators.

Globally, from tables the importer does not import: row counts of `instances` (by kind), `instance_documents`, `instance_assets`, `instance_comments`, `access_grants`, `billing_subscriptions`, and `posts` by state.

### 9.2 Classification

Each release lands in exactly one bucket, which is what the report leads with:

```
classify(release):
    caps := keys(manifest) − {"sample"}         # sample only affects francois's preview mode
    if caps == ∅ and not hasBootstrap(html): return "static"        # works in slop as-is
    if caps ⊆ {"downloads"}:                 return "static+downloads"  # works; downloads = attachments in the tree
    if caps ∩ {"db","room","user","comments","assets","artifact","files"} ≠ ∅:
        return "needs-runtime:" + sorted(caps)                       # loads, then breaks
```

### 9.3 Report shape

`census.md`, written next to `seed.json`:

```markdown
# francois → slop census  (restored from backup of 2026-10-27, importer <git sha>)

| bucket | releases | artifacts | example |
| static | 41 | 18 | polis 1.2.0 |
| static+downloads | 6 | 4 | … |
| needs-runtime:db | 9 | 5 | … |
| needs-runtime:db,room,user | 3 | 2 | … |

## Gaps, ranked by how much imported content each one blocks
| gap | releases blocked | artifacts blocked |
| G5 runtime: db | 12 | 7 |
…
## Storefront features with no slop equivalent
early access (3 artifacts with a future date), launch_mode=…, hidden (2), drafts (4) …
## Not imported (counts only)
instances 57 (workspace 40, preview 17) · instance_documents 1 204 · access_grants 88 · subscriptions 23
```

The numbers above are invented, to show the shape. The real ones come from the first dry run.

### 9.4 The gap list we expect

These are the gaps known from reading the code. The census confirms them or ranks them:

| Id | Gap | Evidence | Size |
| --- | --- | --- | --- |
| G1 | No "push on behalf of": imported versions are authored by the importer | `devseed.go` uses `LocalToken` only in local mode | small: admin-only `author` field on push, audited |
| G2 | No URL for files of data artifacts on site hosts | `serve.go` `routedPage` gate on `/_v/` | small: `/_d/` for read data (§8.4) |
| G3 | No access tiers: routes are `public` or `admins` | `routes.access` CHECK in `002_kernel.sql` | large: needs visitor identity on site hosts; out of scope |
| G4 | No "withdrawn" state for versions | `versions` has no state | small: a version flag hidden from history pickers, or rely on refs |
| G5 | No page runtime for `db`, `room`, `user`, `comments`, `assets`, `artifact`, `files` | `runtime.js` exposes only read-only data | large: one capability at a time, starting with whichever the census ranks first |
| G6 | `--oidc-client-id-file` missing | `serve.go:45` | trivial |
| G7 | No storefront concepts (featured, sort order, early access, launch mode) | not in slop's model | none needed: they are fields in `catalog` records, and pages interpret them |
| G8 | No drafts of a page's text separate from versions | — | none needed: an unpushed folder is a draft |

G7 and G8 are deliberate non-gaps. They show slop's design choice: storefront semantics live in data records and the pages that read them, not in the server.

## 10. Implementation plan

Each phase ends with something that can be checked. Steps marked **[operator]** need rights an intern will not have. Write them as a runbook in the ticket's `playbooks/`, and someone with access runs them.

### Phase A: slop changes that unblock the deployment [code]

1. Add `--oidc-client-id-file` to `slop serve` (`cmd/slop/cmds/serve.go`), mutually exclusive with `--oidc-client-id`, using `readSecret`. Add a unit test next to the existing flag tests.
2. Publish the image from CI: a GitHub Actions workflow that builds `Dockerfile` and pushes `ghcr.io/go-go-golems/slop-computer:sha-<short>` on `main`. Copy `../francois/.github/workflows/publish-image.yaml` and adapt it.
3. Update `doc/production.md` with a "Kubernetes" section that points at the gitops package.

### Phase B: deployment [code in the k3s repo, operator to apply]

1. **[code]** `gitops/kustomize/slop/*` and `gitops/applications/slop.yaml` (§6.3–6.5). Render it locally with `kubectl kustomize gitops/kustomize/slop` and diff it against francois's to review.
2. **[code]** `vault/policies/kubernetes/slop-prod.hcl` (plus whatever policy the db-bootstrap auth uses for `infra/postgres/cluster`; copy francois's), `vault/roles/kubernetes/slop-prod.json`, `scripts/bootstrap-slop-secrets.sh`.
3. **[code]** Terraform: the `slop` project and `slop-web` app (§7.1). Coordinate with the owner of `04fd555` first.
4. **[operator]** `terraform apply`, then write the client id to Vault. Run the bootstrap script. Apply the Vault role and policy.
5. **[operator]** Merge the gitops PR; Argo syncs. Watch `kubectl -n slop get pods,certificate,ingress`.
6. **[operator]** First sign-in by one admin, then `slop db users promote` (or phase C's user import).

Exit check: `https://slop.yolo.scapegoat.dev` shows the Workshop after signing in. `slop auth login` from a laptop works. A pushed page appears on `site.slop.yolo.scapegoat.dev` once routed. Preview iframes load from `s….sbx.slop.yolo.scapegoat.dev`.

### Phase C: restore rehearsal and import [code + operator]

1. **[operator]** Restore the latest `pg_dumpall` into a scratch Postgres (a laptop container is fine): extract only the `francois` database. Restore blobs from S3 into a scratch directory. Record the timing and every snag in the diary. This is francois's first restore rehearsal and is valuable on its own.
2. **[code]** `slop import francois extract|push` and `slop db import-francois-users` (§7.3, §8). Test against a fixture database (§11).
3. Run `extract` against the restored copy and read `census.md`.
4. `push` into a local `slop serve --local`. Have an agent build catalog and journal pages (as in SLOP-001's two-agent test) and note every point where it had to work around slop.
5. **[operator]** Copy blobs into the slop PVC (§8.6), run `import-francois-users`, then `push` with an admin token against the cluster.

Exit check: the census report is committed to the ticket. Imported artifacts are visible in the Workshop. One catalog page and one journal page are routed on the site host.

### Phase D: close the small gaps [code]

Pick from G1, G2, G4 and G6 in census order. Each is a separate PR with tests. G3 and G5 get their own tickets, scoped by the census numbers.

### Phase E: operations [operator]

Add slop's blobs to the backup CronJob, alongside francois's. The database is already covered by `pg_dumpall`. Decide whether the test deployment lives on or gets torn down (`kubectl delete application slop`, drop the database, delete the Vault path and the ZITADEL app).

## 11. Test strategy

| Id | Test | How |
| --- | --- | --- |
| U1 | Importer mapping | Go test with a fixture francois schema: apply `../francois/pkg/catalog/store/migrations/*.sql` to a throwaway Postgres (port 55432, as in SLOP-001's `make test-postgres`), insert 3 artifacts / 5 releases (one withdrawn, one with `db`) / 2 posts with `/media/` links, run `extract`, compare against a golden directory |
| U2 | Idempotency | run `push` twice against an `httptest` slop server; the second run pushes 0 versions |
| U3 | Census buckets | table test over manifest + HTML snippets |
| U4 | `--oidc-client-id-file` | flag test |
| I1 | Kustomize render | `kubectl kustomize` succeeds; `kubeconform` passes if available |
| I2 | Identity | after the first sign-in on the cluster, `slop db users list` shows the same `subject` as `SELECT subject FROM users WHERE email = …` in francois's restored copy |
| I3 | Streams through Traefik | `slop comments wait` held open for 10 minutes and receives a comment posted at minute 9 |
| I4 | Sandbox isolation | from a preview iframe, `fetch('https://slop.yolo…/api/me')` without credentials returns 401; with `credentials: 'include'` it is blocked by CORS |
| I5 | Network policy | sign-in works (proves the :8443 hairpin rule) |

## 12. Risks and open questions

- **The sandbox Terraform client `04fd555` is unpushed.** Someone started the same thing on another machine. Ask before creating a second client. If it is meant for slop, reuse its project and change the redirect URI to the host chosen in §6.2.
- **Public signup in the shared org.** Pending users are harmless but noisy. If the pending list becomes a problem, add an admin-side filter ("signed up via francois") or hide pending users older than N days.
- **Same-site sandbox** (§6.2). Fine for admins; not for open use.
- **Restore never rehearsed.** Phase C1 may find that the backups are incomplete. That is a francois incident, not a slop task. Report it, don't fix it here.
- **Data protection.** Even restored, `users`, `posts` drafts and `instance_documents` hold personal data. Keep the restored copy on a machine with disk encryption, delete it after the import, and never commit census output that names users. The census reports counts, not names.
- **Release HTML is untrusted code.** On slop, imported pages run on the site host and in sandbox previews, the same as any pushed page. Don't route imported releases on a host that anyone outside the team visits until someone has looked at them.
- **Id collisions** after `_` → `-` (e.g. `foo_bar` and `foo-bar`). The importer fails loudly and asks for a mapping file.
- **Open:** should imported page artifacts be named `fr-<id>`, to keep francois ids distinct from native slop work? Default: keep plain ids within project `francois`.

## 13. Decision records

- **D1. Deploy by cloning francois's GitOps package.** Rationale: it encodes hard-won cluster details (ZITADEL hairpin, Vault auth, DNS-01). Alternative: Docker on another host with Caddy (`doc/production.md`). Rejected, because it would mean a second TLS, DNS and secret setup with no reuse.
- **D2. Same ZITADEL org, new client.** Rationale: the same people, no shared codes, independent lifecycle. Precedent: `04fd555`.
- **D3. Same-site sandbox for the test, a separate domain before wider use.** See §6.2.
- **D4. Admins imported by `(issuer, subject)`, everyone else pending.** Alternative: a ZITADEL role claim. Deferred until slop maps role claims.
- **D5. Importer reads a restored backup, writes seed format, pushes through the API.** Rationale: no production reads, inspectable intermediate output, and every slop invariant still holds.
- **D6. Storefront semantics become data records, not server features.** Rationale: slop's model. Pages interpret `featured`, `early_access_until` and so on.

## 14. File reference

slop (this repository):

- `doc/production.md`: host classes, flags, identity, backups, GC, agents
- `Dockerfile`, `.dockerignore`, `Makefile`: the image
- `cmd/slop/cmds/serve.go`: serve flags; OIDC wiring at 147–155
- `cmd/slop/cmds/devseed.go`: seed format (`seedFile`) and loader; the importer's model
- `cmd/slop/cmds/db.go`: `slop db` subcommands (users, gc-blobs); where `import-francois-users` goes
- `cmd/slop/cmds/push.go`: `via()` and `SLOP_VIA`
- `pkg/store/migrations/postgres/001_auth.sql`: users, sessions, tokens, device flow, audit
- `pkg/store/migrations/postgres/002_kernel.sql`: projects, artifacts, versions, files, refs, routes, threads, events
- `pkg/store/artifacts.go`: push, dedup (`Unchanged`)
- `pkg/server/kernel.go`: API routes and guards (26–48)
- `pkg/server/serve.go`: site and sandbox serving, `/_v/` file URLs
- `pkg/server/auth.go`: cookies (`__Host-`, SameSite Lax), guards
- `pkg/server/tools.go`: CORS for sandbox origins, grants
- `pkg/records/records.go`: data-artifact record parsing
- `pkg/render/assets/runtime.js`: what a page can call (`window.slop`)
- `pkg/blobs/blobs.go`: blob layout
- `pkg/client/kernel.go`: Go API client
- `examples/seed/`: seed-format example the importer's output follows

francois (`../francois`):

- `doc/production.md` §§1–3, §10: inventory, Vault and ZITADEL tables, backups
- `pkg/catalog/store/migrations/001_core.sql`: users, catalog_artifacts, releases, release_files, instances, instance_*
- `pkg/catalog/store/migrations/004_storefront.sql`: catalog_media, creators, artifact_creators, posts
- `pkg/catalog/store/migrations/006_videos_attachments.sql`: release_attachments
- `pkg/catalog/releases/releases.go`: blob keys (35), capabilities (204), bootstrap and external-script markers
- `pkg/catalog/store/releases.go`: `Page` struct
- `pkg/catalog/routes.go:87`: release download route
- `examples/capabilities.manifest.json`, `examples/polis.manifest.json`: manifest examples
- `deploy/compose/compose.yaml`: local stack with ZITADEL, useful for importer development

k3s gitops (`~/code/wesen/2026-03-27--hetzner-k3s`):

- `gitops/kustomize/francois/*`: the package to clone (§5.2)
- `gitops/applications/francois.yaml`: Argo Application
- `vault/policies/kubernetes/francois-prod.hcl`, `vault/roles/kubernetes/francois-prod.json`
- `scripts/bootstrap-francois-secrets.sh`

terraform (`~/code/wesen/terraform`):

- `zitadel/francois/envs/prod/main.tf`, `variables.tf` (origin/main): org, project, portal client, IdPs, `allow_register`
- `zitadel/francois/envs/sandbox/main.tf` (local commit `04fd555` only): precedent client `slop-sandbox-web`
