# Tasks

## TODO
- [x] Write the intern guide (cache classes, ?w= thumbnails, gzip, data scripts, phases) <!-- t:2bci -->
- [x] Phase 1: serveFile with cache classes (fix page-relative immutable bug), document ETag + no-cache + gzip, /_slop ?h=, gzip of stored text, Workshop project grouping <!-- t:ohl9 -->
- [x] Phase 2: ?w= thumbnails (x/image, derived store, ladder, guard rails), image width/height in records, slop.image/slop.srcset, gc of derived/ <!-- t:fm9u -->
- [x] Phase 3: /_r/<artifact>/<n>.js data scripts, Inject references, runtime.js registry (.all stays sync), manifest files key <!-- t:0pa7 -->
- [x] Phase 4 on the cluster: storefront v2 and storefront-entry v2 pushed (various/storefront-v2/), measured: the front page loads one data script (catalog), covers scaled by ?w=. <!-- t:ngh2 -->
- [ ] Phase 5 (optional): per-host index of servable artifacts <!-- t:dtvc -->
- [x] Decide open questions (guide section 14): ladder, Place freshness, WebP output, importer numbered URLs <!-- t:5kk9 -->
- [x] Importer: seed pushes pin /_d/<media>/main/ links to numbered versions (e3d7bd8); re-ran slop import francois push --dir fr-api3 on the cluster: francois-catalog v3, covers are content URLs. <!-- t:452h -->
- [x] Workshop thumbnails no longer run pages: catalog covers (GET /api/covers) or a version summary; the main preview is the only live frame (4626897). Stored screenshots were considered and declined. <!-- t:qvoy -->
