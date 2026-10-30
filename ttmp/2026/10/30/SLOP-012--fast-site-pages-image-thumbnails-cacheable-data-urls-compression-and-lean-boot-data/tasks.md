# Tasks

## TODO
- [x] Write the intern guide (cache classes, ?w= thumbnails, gzip, data scripts, phases) <!-- t:2bci -->
- [x] Phase 1: serveFile with cache classes (fix page-relative immutable bug), document ETag + no-cache + gzip, /_slop ?h=, gzip of stored text, Workshop project grouping <!-- t:ohl9 -->
- [x] Phase 2: ?w= thumbnails (x/image, derived store, ladder, guard rails), image width/height in records, slop.image/slop.srcset, gc of derived/ <!-- t:fm9u -->
- [x] Phase 3: /_r/<artifact>/<n>.js data scripts, Inject references, runtime.js registry (.all stays sync), manifest files key <!-- t:0pa7 -->
- [ ] Phase 4 on the cluster: push storefront v2 and storefront-entry v2 (various/storefront-v2/, project francois) and measure. Help topic site-pages and agents.md shipped in sha-ec4c4c9. <!-- t:ngh2 -->
- [ ] Phase 5 (optional): per-host index of servable artifacts <!-- t:dtvc -->
- [x] Decide open questions (guide section 14): ladder, Place freshness, WebP output, importer numbered URLs <!-- t:5kk9 -->
- [ ] Importer: seed pushes pin /_d/<media>/main/ links to numbered versions (e3d7bd8, deployed). Left: re-run slop import francois push on the cluster. <!-- t:452h -->
- [x] Workshop thumbnails no longer run pages: catalog covers (GET /api/covers) or a version summary; the main preview is the only live frame (4626897). Stored screenshots were considered and declined. <!-- t:qvoy -->
