# Changelog

## 2026-11-02

- Initial workspace created

## 2026-11-02

Design doc and diary: one object model (store + grant/binding/route), namespaces for unmodified Claude artifacts, the registry as a store, Durable Objects mapping. Replaces SLOP-008, which reviewed v2 and was dropped.

## 2026-11-02

Design revised: no separate system store. One db path space per page: its own store at the root, every store under _stores/<id>/, registry rows in _-prefixed subcollections; bindings become aliases into that space; _stores as a whole is opt-in (declared and approved). Open questions now include reserving _ and the 14-segment depth.

## 2026-11-02

Mounts and hosts are not mapped into the path space (open question 3 decided); phase 1 is data and assets: new §5.3, /_blob/<id> resolves across the stores a view reaches, uploads stay local.

## 2026-11-02

Registry documents are not live for now (open question 6 decided): computed on read, onSnapshot delivers one snapshot.

## 2026-11-02

Phase 1 implemented (data and assets across stores): rt.Space, aliases (bind.set --prefix --level), _stores behind db.stores and the stores policy cell, cross-store stream with per-store cursors, /_blob through --assets aliases, 16-byte asset ids, reopen on losing access to a followed store. Design doc updated with the decisions and two corrections (asset ids are 8 bytes; blob fetches cannot check the viewer's level).

## 2026-11-02

Phases 2–5 implemented on task/slop3-008-data-assets: files over store trees (915a96e); the registry as documents with confirmed writes and ifVersion, people read-only (6acea8e, 3d524e0); alias templates on mounts (cf8eaaa); Durable-Object-shaped ctx.storage for actors (e339f8a). Phase 6 (one owning process per store) deliberately not built while v3 is single-process. Open question 2 decided: grants, aliases and store type writable.

### Related Files

- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/actor/storage.js — Durable-Object-shaped storage (phase 5)
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/server/registry.go — registry documents (phase 3)
- /home/manuel/workspaces/2026-10-28/slop-computer/slop-computer/pkg/verbs/mounts.go — alias templates (phase 4)
