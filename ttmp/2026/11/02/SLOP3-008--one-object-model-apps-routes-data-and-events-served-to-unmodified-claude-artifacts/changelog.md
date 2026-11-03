# Changelog

## 2026-11-02

- Initial workspace created

## 2026-11-02

Design doc and diary: one object model (store + grant/binding/route), namespaces for unmodified Claude artifacts, the registry as a store, Durable Objects mapping. Replaces SLOP-008, which reviewed v2 and was dropped.

## 2026-11-02

Design revised: no separate system store. One db path space per page: its own store at the root, every store under _stores/<id>/, registry rows in _-prefixed subcollections; bindings become aliases into that space; _stores as a whole is opt-in (declared and approved). Open questions now include reserving _ and the 14-segment depth.
