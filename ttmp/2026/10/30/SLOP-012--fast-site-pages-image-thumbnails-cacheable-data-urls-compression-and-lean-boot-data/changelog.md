# Changelog

## 2026-10-30

- Initial workspace created

## 2026-10-30

Ticket created. Baseline measured on the cluster (76 MB of covers, 670 KB no-store HTML with 664 KB inline data, main URLs revalidated, page-relative files cached immutable: a bug). Intern guide written: cache classes by what a URL names, ?w= thumbnails, gzip, data as /_r/ scripts, files manifest key, Workshop grouping fix; phases, tests, open questions. GitOps PR hetzner-k3s#401 (sha-2ac2611) opened and merged by the user.

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/ttmp/2026/10/30/SLOP-012--fast-site-pages-image-thumbnails-cacheable-data-urls-compression-and-lean-boot-data/design-doc/01-intern-guide-serving-site-pages-fast.md — The guide

## 2026-10-30

Uploaded the intern guide to reMarkable: /ai/2026/10/30/SLOP-012/SLOP-012 Fast site pages intern guide.pdf (remarquee: OK: uploaded).

## 2026-10-30

Open questions decided (guide 14.1): ladder 160-1920, Place 60s + SWR, no WebP, importer writes numbered media URLs (new task). Cluster token restored; dropdown data checked (111 francois + 3 no project).

## 2026-10-30

Phases 1-2 implemented: serveFile with content/place classes (fixes page-relative immutable bug), document ETag + gzip, hashed runtime assets, derived store + gc, Workshop grouping (3e3aacb); ?w= thumbnails, image sizes in records, slop.image/srcset (b050095). Diary step 4.

## 2026-10-30

Phase 3 (4b5076b), seed pinning (e3d7bd8), help topic + storefront v2 sources (2004edf); verified locally (page 3.1 KB, catalog script 99.8 KB gz cached, covers ~30 KB at 640; conformance 51/51 and 20/20). Diary step 5.

## 2026-10-30

Branch task/fast-sites-and-sign-in pushed; PR https://github.com/go-go-golems/slop-computer/pull/5 opened (SLOP-012 + SLOP-013). Remaining: merge, deploy, push storefront v2, re-run import push, measure on the cluster; manual sign-in check on the cluster.

## 2026-10-30

Workshop records table derives its columns from the records; image files get ?w=160 thumbnails and a large preview when no viewer is set (addd400)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/workshop/src/components/organisms/DataPanes.tsx — columns, fileURL, ImagePreview

## 2026-10-30

Workshop project UI: a project scope shared by the artifact menu and Artifacts screen, New/Edit project, and Move… (title, project, viewer) on artifacts (dfd2ade)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/workshop/src/components/organisms/Projects.tsx — project scope, ProjectDialog, ArtifactDialog

## 2026-10-30

Review fixes: sandbox previews authorize /_r/ and /_d/ by the version named in the Referer; ?w= thumbnails and image record sizes follow JPEG EXIF orientation (13dc440)

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/serve.go — sandboxReads, previewRoute
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/thumbs.go — jpegOrientation, orient, makeThumb
