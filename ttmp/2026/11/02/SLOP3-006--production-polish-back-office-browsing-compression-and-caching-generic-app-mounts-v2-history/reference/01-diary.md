---
Title: Diary
Ticket: SLOP3-006
Status: active
Topics:
    - backoffice
    - deploy
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/server/admin.go
      Note: asset cache key over both files
    - Path: repo://web/admin/src/admin.css
      Note: scroll fix, browse and narrow-screen styles
    - Path: repo://web/admin/src/ui.jsx
      Note: Browse component and hash state
    - Path: repo://web/admin/src/views.jsx
      Note: catalog, browse tabs and detail panes
ExternalSources: []
Summary: 'Chronological work log for SLOP3-006: back office browsing, Traefik compression, caching, follow-ups from the v3 cutover.'
LastUpdated: 2026-11-02T14:25:23.411415438-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Work log for SLOP3-006: the follow-ups to the v3 cutover on slop.yolo.scapegoat.dev (SLOP3-004). Production holds 100+ imported stores and mounts. The back office couldn't page through them or scroll, and pages load slowly over the network path to the Hetzner node.

## Step 1: Ticket from the cutover findings

The study questions after the import (one store per app or one big store; why the long pages don't scroll; why loading is slow) left a list of concrete improvements. This step turned them into the ticket and its tasks. Nothing was implemented in this step.

### Prompt Context
**User prompt (verbatim):** "Ok, create a new ticket for all these improvements. because we have so many apps/stores, make a better way to browse them (and pagination and all that), and also show a bit more detail in the detail pane. Setup traefik compression and all, we'll do cloudflare later."
**Assistant interpretation:** Create the ticket for every improvement found during the cutover. Implement now: back office browsing with pagination, a richer detail pane, and Traefik compression. Cloudflare is deferred.
**Inferred user intent:** Make the production deployment usable at its real size, and fast enough over a slow link, without re-architecting stores.

### What I did
- `docmgr ticket create-ticket --ticket SLOP3-006 ...`, plus nine tasks (see tasks.md).

### Why
- These are the study answers from the cutover conversation:
  - **Store per app:** keep one store per app; it is the unit of origin, database, policy and versions. Replace 103 mounts with one parameter mount.
  - **Scrolling:** the lab stylesheet sets `body { overflow: hidden }` (pkg/server/admin/styles.css, about line 850).
  - **Slowness:** the network, not the server. In the pod a response takes 1–2 ms. The path from the user to Hetzner runs at about 45–50 KB/s, and Hetzner's own speed-test servers are just as slow. Nothing was compressed.

### What should be done in the future
- See tasks.md: the generic /f/:id mount, importing v2 history, Cloudflare, and rechecking the slow apps.

## Step 2: Back office browsing, a richer detail pane, and scrolling

The Apps, Stores and Sites tabs now go through one `Browse` component: a search box, filters with counts, sortable columns, and pages of 25/50/100. Its state lives in the hash (`#stores?q=inst&f=instance&s=Created&d=1&p=2&n=50&sel=inst-3`), so a filtered view can be linked and survives a reload. The store pane shows what the store is and where it is served, its snapshots, recent changes and bindings. The app pane shows version, kind, instances and addresses. The page scrolls.

Filtering and paging run on the client, over the full lists that `store.ls {all:true}`, `app.ls` and `mount.ls` already return. Server-side paging (the task's original wording) is not needed at this size. At hundreds of rows, one request plus a client-side filter is faster to use than a round trip per page over the slow link.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Implement browsing and pagination, plus more detail in the detail pane, in web/admin.
**Inferred user intent:** Find any of the ~100 imported apps or stores quickly and see what it is without leaving the page.
**Commit (code):** f392ef2 — "Back office: browse long lists, see more of a store, and scroll"; 2bb18bb — "Back office assets: the cache key covers the stylesheet too"

### What I did
- `web/admin/src/ui.jsx`:
  - `Table` takes `sort`/`onSort` (header buttons with `aria-sort`).
  - `useHashParams()` reads and writes the query after `#tab?` with `history.replaceState`.
  - `Browse({rows, cols, text, filters, rowKey, sel, onRow, noun, defaultSort, defaultDesc})`.
  - `Kv({items})`.
- `web/admin/src/views.jsx`:
  - `useCatalog()` loads apps, stores, mounts and people once. It derives `appOf`, `personOf`, `urlsOf` (exact mounts plus parameter mounts of the store's type) and `kindOf` (app / instance / files).
  - `Apps`, `Stores` and `Sites` use Browse.
  - `AppDetail` and `StoreDetail` are rewritten. StoreDetail calls `store.meta`, `snap.ls`, `log.show` (limit 8), `bind.ls`, and `app.status` when the store runs an app.
- `web/admin/src/main.jsx`: `tabOf()` ignores the `?…` after the tab name.
- `web/admin/src/admin.css`:
  - `body { overflow: auto }`;
  - `.browsebar`, `.pager`, `.sorth`;
  - a sticky detail pane;
  - `.kv`;
  - narrow-screen rules: filters wrap, tables scroll on their own, `.split > * { min-width: 0 }`.
- `pkg/server/admin.go`: `adminVersion` hashes both `app.js` and `styles.css`.
- Rebuilt with `cd web/admin && node build.mjs`.

### Why
- Hash state rather than component state: an admin can paste a link to "instances of blocks, page 3".
- One `useCatalog` for all three tabs, so Stores can show titles and addresses and Sites can link to stores without extra calls per row.

### What worked
- Local run on a fresh data dir: `slop-dev serve --local --data s6data --admin-email admin@example.com --listen 127.0.0.1:18310`.
  - Seeded 60 app stores, 25 instances of app-01, 15 empty stores, 28 mounts (one of them `/t/:id --storeParam id --type thing`).
  - Measured with Playwright:
    - Stores: "100 stores"; filters "All 100 / Apps 40 / Instances 25 / Files 35 / Not mounted 21"; pager "1–25 of 100".
    - Next page gives `#stores?p=2`, "26–50 of 100".
    - Search "inst" gives "25 of 100 stores".
    - Sort by Store: app-00 first; again, inst-24 first.
    - 100 per page: 100 rows.
    - Wheel scroll: `scrollY` 2062 (it was 0 before the fix).
  - Store pane for inst-24:
    - kind "instance of app-01", type thing, status "running app-01@1";
    - served at `apps.localhost:18310/t/inst-24` (resolved through the parameter mount);
    - recent changes rev 2 "activated app-01@1" and rev 1 "created".
  - At 390 px wide, `scrollWidth` is 375 on stores, sites and apps (no sideways scroll).
- `GOWORK=off go test ./pkg/server/... -count=1`: ok.

### What didn't work
- My first Playwright run hit the wrong server. Port 18300 was still held by a server from an earlier session (pid 1390210, the Nov 1 v3run config), so my new server never bound and the old UI answered. Fixed by using port 18310 with a fresh data dir.
- The seed's `mount.set` failed for stores with no capabilities: `app-02 is plain content: mount it on a static host`. This is expected. A store whose app.json declares no capabilities is plain content and only mounts on the static host.
- The default sort on Stores read "Created ↑" but showed the newest first. The column's sort key was `-(createdAt)`, so "ascending" meant newest-first. Fixed: the sort key is `createdAt`, and `Browse` takes `defaultDesc`. An explicit `d=0` in the hash means ascending; no `d` means the default.
- After rebuilding, the browser still showed the old bundle. The cause was not the server: `page.goto` from `#stores` to `#stores` is a same-document navigation, so the old document stayed. Reloading with a pass-through route (`page.route('**/*', r => r.continue())`) loaded the new bundle.

### What I learned
- The back office assets are served `immutable` for a year under `?v=<hash>`. The hash covered only `app.js`, so a CSS-only change would have stayed cached; this is fixed in 2bb18bb.
- Rows with equal sort keys came out in server order. A tie-break on `rowKey` makes paging stable.

### What was tricky to build
- `urlsOf` has to cover both exact mounts (`mount.store === id`) and parameter mounts whose `type` matches the store's type. Otherwise instances (Blocks workspaces, Pinup designs) look "not mounted" even though they are served at `/b/<id>`.

### What warrants a second pair of eyes
- The "Not mounted" filter depends on the same `urlsOf`. A parameter mount without a type matches nothing.
- StoreDetail makes 4–5 calls per selection. That is fine for one pane, but `log.show` on a busy store is limited to 8 entries for that reason.

### What should be done in the future
- If store counts grow into the thousands, move search and paging into `store.ls`.

### Code review instructions
- Start with `Browse` in web/admin/src/ui.jsx, then `useCatalog`, `Stores` and `StoreDetail` in web/admin/src/views.jsx.
- Rebuild with `cd web/admin && node build.mjs`, then run `GOWORK=off go test ./pkg/server -count=1`.

## Step 3: Traefik compression (GitOps PR #408)

Every slop host now goes through a Traefik `compress` middleware for text types. The change lives in the GitOps repo, so it takes effect when the user merges PR #408 and Argo CD syncs.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Configure Traefik compression for the slop ingress in GitOps. Leave Cloudflare out.
**Inferred user intent:** Faster page loads over the slow link.
**Commit (gitops):** e43843a — "slop: compress text responses at Traefik" (branch `slop/compress`, https://github.com/wesen/2026-03-27--hetzner-k3s/pull/408)

### What I did
- Added `gitops/kustomize/slop/compress.yaml`: a Middleware `compress` with `encodings: [zstd, br, gzip]`, `minResponseBodyBytes: 1024`, and an `includedContentTypes` allowlist (html, css, plain, markdown, csv, xml, js, json, manifest, wasm, svg).
- Listed it in kustomization.yaml.
- Ingress annotation: `slop-test-headers@kubernetescrd,slop-compress@kubernetescrd`.

### Why
- An allowlist instead of compressing everything:
  - images and fonts are already compressed;
  - `pkg/server/views.go:276` and `pkg/server/sample.go:165` stream `text/event-stream`, which must not be buffered by a compressor.
- Traefik is `rancher/mirrored-library-traefik:3.6.9`, so zstd and brotli are available.
- Precompressed copies (`pkg/blobs/derived.go`, `<sha>.gz`) exist as a concept but are not served yet. Compressing at the edge needs no slop change.

### What worked
- `kubectl kustomize gitops/kustomize/slop` renders.
- `kubectl -n slop apply --dry-run=server -f compress.yaml`: `middleware.traefik.io/compress created (server dry run)`.
- The CRD's compress fields are `defaultEncoding`, `encodings`, `excludedContentTypes`, `includedContentTypes`, `minResponseBodyBytes`.
- Baseline in production with `Accept-Encoding: zstd, br, gzip`, no encoding on any of them:

  | URL | Size | Time |
  |---|---|---|
  | `/admin/app.js` | 163,558 B | 1.51 s |
  | `_data/francois-catalog.json` | 377,632 B | 1.82 s |
  | site `/` | 7,213 B | 0.65 s |

  `gzip -9` shrinks app.js to 51,509 B.

### What didn't work
- No failures observed.

### What warrants a second pair of eyes
- After the merge, check that live views still update: SSE must pass through uncompressed.
- Check the ETag/304 behaviour on compressed site files. slop sets a strong ETag (the file hash), and the encoding is added on top.

### What should be done in the future
- After the merge, re-measure the three URLs and recheck thought-machines and vitrine (task ilxa).

### Code review instructions
- In the GitOps repo, read `gitops/kustomize/slop/compress.yaml` and the `ingress.yaml` annotation.

### Technical details
- Caching as it stands:
  - site files: `Cache-Control` max-age=60 plus `ETag` = sha256, served with `http.ServeContent` (pkg/server/site.go:221), so revalidation returns 304;
  - back office assets: `immutable` under `?v=`.
- Snapshot-addressed immutable URLs for site files would need URLs that name the snapshot. That is left in task hc66.

## Step 4: Review fix on #15, and merge

Codex flagged (P2) that the Apps tab resolved an app's addresses with the type from `app.ls`. That is the type the app's manifest declares for its instances, not the app store's own type. An untyped app store such as `blocks-site`, whose manifest declares `blocks-site`, was therefore shown as served at `/pub/blocks-site`. `pkg/server/site.go` refuses that address, and the app also dropped out of the Not mounted filter. The fix looks up the app's store row instead. The PR was merged after CI passed.

### Prompt Context
**User prompt (verbatim):** "Address code review comment for #15, then merge"
**Assistant interpretation:** Fix the review finding on PR #15, reply to it, and merge once CI passes.
**Inferred user intent:** Ship the back office improvements.
**Commit (code):** 1895500 — "Back office: an app's addresses come from its own store's type (review on #15)"; merge 30defba

### What I did
- `useCatalog` exposes `storeOf`; `Apps` calls `c.urlsOf(c.storeOf.get(a.app) || { id: a.app })`.
- The AppDetail label "store type" is now "instance type".
- Replied on the review thread (discussion_r4446949055). Merged with `gh pr merge 15 --merge`.

### What worked
- Checked on a local server (port 18311). An app store `pubapp` with no type, a manifest with `type: thing`, a mount `/pub/:id --storeParam id --type thing`, and an instance `inst-a`:
  - the app pane shows "served at=not mounted";
  - the instance pane shows "served at=apps.localhost:18311/pub/inst-a".
- `GOWORK=off go test ./pkg/server -count=1`: ok. CI `release / publish`: pass.

### What should be done in the future
- Production runs this only after the image pin in GitOps moves to the merge's image. `publish-image.yaml` sets `open_gitops_pr: false`, so the bump is a manual GitOps PR.
