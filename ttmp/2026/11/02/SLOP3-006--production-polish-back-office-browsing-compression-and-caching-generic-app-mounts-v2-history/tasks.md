# Tasks

## TODO
- [x] Back office: the page scrolls (lab stylesheet sets body overflow hidden) <!-- t:xi2l -->
- [x] Back office: browse stores, apps and mounts with search, filters, sorting and pagination (server-side in store.ls/app.ls/mount.ls) <!-- t:qctw -->
- [x] Back office: richer detail pane for a store (app, version, size, files, grants, mounts, bindings, recent log) <!-- t:zw1t -->
- [x] Traefik: compress responses (gzip/brotli) on the slop hosts <!-- t:1nh0 -->
- [ ] Caching: immutable caching for snapshot files on the static host where the URL names the snapshot; check entry pages <!-- t:hc66 -->
- [x] Generic /f/:id mount for imported apps (store type release) instead of 103 mounts <!-- t:07oh -->
- [x] Import v2 history: older versions of imported artifacts as snapshots — done as SLOP3-013 (2026-11-06): the mechanism exists (03-import.py --history), but all 8 older published releases are paid and their stores are public, so none were imported; 3 withdrawn rag-workbench releases are excluded by design <!-- t:2ghn -->
- [ ] Cloudflare in front of the slop hosts (later) <!-- t:wcpm -->
- [x] Recheck slow-loading imported apps (thought-machines, vitrine) after compression <!-- t:ilxa -->
