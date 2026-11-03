# Changelog

## 2026-11-02

- Initial workspace created

## 2026-11-02

Back office browses long lists (search, filters, sort, pages; state in the hash), richer store/app panes, page scrolls (f392ef2); asset cache key covers styles.css (2bb18bb). Traefik compress middleware for text types in GitOps PR #408 (awaiting merge).

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/admin/src/ui.jsx — Browse, useHashParams, sortable Table, Kv
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/web/admin/src/views.jsx — useCatalog, Apps/Stores/Sites with Browse, StoreDetail, AppDetail

## 2026-11-03

2026-11-03: ran scripts/01-generic-f-mount.py --apply on production (image sha-1af14cb, GitOps #412): typed 103 stores 'release', mounted /f/:id --type release, removed 103 exact /f/<id> mounts. A re-run finds nothing to do; /f/shop, /f/lattice-arcade, /f/porous-forge and /f/exposure-studio return 200, and guest views of shop and lattice-arcade open at interact.
