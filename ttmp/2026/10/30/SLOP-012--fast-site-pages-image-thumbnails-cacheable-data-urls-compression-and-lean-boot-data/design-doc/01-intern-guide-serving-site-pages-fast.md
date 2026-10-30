---
Title: 'Intern guide: serving site pages fast'
Ticket: SLOP-012
Status: active
Topics:
    - architecture
    - backend
    - routing
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://pkg/server/serve.go
      Note: serveSite, serveData, records, bindings, renderPage, writePage; most of the change lands here
    - Path: repo://pkg/server/kernel.go
      Note: serveBlob, the one place file bytes are written today
    - Path: repo://pkg/render/render.go
      Note: Boot and Inject; where data scripts replace inline data
    - Path: repo://pkg/render/assets/runtime.js
      Note: window.slop; gains the data registry and the image helpers
    - Path: repo://pkg/blobs/blobs.go
      Note: Blob storage; derived files live beside it, outside garbage collection
    - Path: repo://web/workshop/src/components/organisms/TopBar.tsx
      Note: ArtifactMenu hides artifacts whose project is unknown
    - Path: repo://ttmp/2026/10/30/SLOP-012--fast-site-pages-image-thumbnails-cacheable-data-urls-compression-and-lean-boot-data/scripts/01-measure-site.py
      Note: Measures a page's weight before and after
ExternalSources:
    - https://site.slop.yolo.scapegoat.dev/
Summary: "How slop serves site pages, files and data today, why the storefront is slow (76 MB of full-size covers, no compression, 664 KB of inline data per page, revalidation of every main URL, and a cache bug), and one consistent design: three cache classes decided by what a URL names, ?w= thumbnails on any image URL, gzip for text, and data as cacheable scripts."
LastUpdated: 2026-10-30T18:00:00-04:00
WhatFor: "Understanding slop's file and page serving well enough to implement fast site pages"
WhenToUse: "Before working on SLOP-012, or when asked why a site page is slow or stale"
---

# Intern guide: serving site pages fast

This guide is for someone new to slop who will implement SLOP-012. It explains how slop serves a public page, its data and its files today. It then shows, with measurements, why the storefront at `https://site.slop.yolo.scapegoat.dev/` is slow, and proposes one consistent design to fix it.

The design has four parts, each a single rule:

1. **Caching follows what a URL names.** A URL that names *content* (a version number or a hash) is cached forever. A URL that names a *place* (`main`, a page path) is revalidated. HTML documents are always revalidated, cheaply, with an ETag.
2. **Any image URL takes `?w=<width>`.** The server returns a scaled-down copy and caches it beside the original.
3. **Text is compressed.** HTML, JSON, JavaScript and CSS are sent gzipped when the browser accepts it.
4. **Data is a script, not inline JSON.** A page's data bindings are loaded from content-addressed scripts that the browser caches. The HTML carries only references.

You do not need to know the artifact runtime (SLOP-009) or live sites (SLOP-011) for this ticket. Everything here is about the public site host and how bytes reach the browser.

## 1. Executive summary

The storefront is the page artifact `storefront` routed at `/` on the site host. It lists 100 apps from the data artifact `francois-catalog`, each with a cover image. On the test cluster it takes many seconds to show, and most covers arrive much later.

Measured on 2026-10-30 (`scripts/01-measure-site.py` and curl; details in the diary):

| Cost | Measured | Why |
|---|---|---|
| **Cover images** | 94 covers, **76.3 MB**, 130–800 KB each, shown about 400 px wide | Pages can only link the original file |
| **HTML** | 670 KB per visit, every visit | 664 KB of inline data (four bindings, three unused); `Cache-Control: no-store`; no gzip (it would be 171 KB) |
| **Cover URLs** | every image revalidated on every visit | The importer writes `/_d/<artifact>/main/…` URLs, served `no-cache` |
| **Link** | 40–500 KB/s, about 0.45 s per new connection | The test cluster's uplink |
| **Bug** | `/boutique.css` cached `immutable` for a year | Page-relative files are treated as content although their URL names a place |

The design brings a first visit from roughly 670 KB of HTML plus up to 76 MB of images down to about:
- 3 KB of HTML;
- about 70 KB of gzipped catalog script, cached after the first visit;
- about 35 KB per visible cover.

A repeat visit costs a few 304s.

## 2. Orientation: hosts and how a site page is served

slop answers on three kinds of host (`Server.Handler`, `pkg/server/server.go:160-197`):

| Host | Example | Handler | What it serves |
|---|---|---|---|
| main | `slop.yolo.scapegoat.dev` | `s.mux` | the Workshop, `/api/*`, sign-in |
| site | `site.slop.yolo.scapegoat.dev` | `serveSite` (`pkg/server/serve.go:334`) | public pages from the route table |
| sandbox | `s<label>.sbx.slop.yolo.scapegoat.dev` | `serveSandbox` (`serve.go:472`) | Workshop previews and apps, one origin per target |

This ticket is mostly about the **site host**, with small changes on the other two so the rules stay the same everywhere.

### 2.1 Artifacts, versions and `main`

- **Artifacts.** An artifact is a named, versioned folder of files. Each push makes version `n`, which never changes. `main` points at the version the world sees, and moves on each push or `slop route` change.
- **Kinds.** A **page** has an `index.html`. A **data** artifact holds files that pages read.
- **File entries.** Every file in a version is a `store.FileEntry{SHA256, Size, Type}`. The bytes live once in the blob store, keyed by their sha256: `pkg/blobs/blobs.go`, under `<root>/blobs/<sha[:2]>/<sha>`.

The difference between "version `n`" and "`main`" is the heart of this ticket:
- `n` names **content**: the bytes at `/_d/catalog/7/x.json` will never change.
- `main` names a **place**: `/_d/catalog/main/x.json` may return different bytes tomorrow.

### 2.2 Routes and bindings

A route maps `host + path` to a page (`pkg/store/routes.go:26-37`). A page reads data through **bindings**. `bindings()` (`serve.go:99-123`) builds them from:
1. the page manifest's `reads` (`{"catalog": "francois-catalog"}`);
2. its `tokens` (design tokens, which become CSS);
3. the route's own `--bind` overrides.

Each binding resolves to a concrete version: the pinned one, or the data artifact's current `main` (`ResolvedBinding{Artifact, Version, N}`).

The storefront's manifest reads four artifacts:

```json
{ "reads": { "catalog": "francois-catalog", "media": "francois-media",
             "media2": "francois-media-2", "media3": "francois-media-3" },
  "tokens": "lab-tokens" }
```

The page uses only `catalog`. The three media bindings are there because `serveSite` serves `/_d/<artifact>/…` files only for artifacts that some public route's page reads. Without them, the cover URLs would 404.

### 2.3 Records

`records()` (`serve.go:51-81`) turns a data version's files into **records** (`pkg/records/records.go`):
- **Text files** (`.json`, `.md`, `.csv`, `.yaml`, …) are parsed into fields.
- **Every other file** (images, video, fonts) becomes a *file record* `{id, path, file: true, src, type, size}`. Its `src` is `/_d/<artifact>/<n>/<path>`, a content URL.

Records are cached in memory per `artifact@n` (`recordCache`, `serve.go:29-48`).

The francois importer copied the catalog's cover links as `/_d/<media artifact>/main/files/<id>.<ext>` (`pkg/francois/extract.go:73`). Those are place URLs, because the importer does not know the media version numbers when it writes the catalog.

### 2.4 Rendering a page

For a request to `site…/`, `serveSite`:
1. loads the host's routes and keeps the public ones;
2. resolves the path (`routing.Resolve`);
3. calls `renderPage(…, render.ModeSite, …)` (`serve.go:126-183`).

`renderPage` builds a **boot block** and `render.Inject` (`pkg/render/render.go:70-109`) writes it into the page's `<head>`:

```html
<script type="application/json" id="slop-boot">{"route":…,"data":{"catalog":[…104 records…],"media":[…],…},"version":…,"mode":"site","tokens":…}</script>
<script src="/_slop/runtime.js"></script>
… the page's own head …
<style data-slop="tokens">html:root{--accent:#2340D8;…}</style>
```

`runtime.js` (`pkg/render/assets/runtime.js`) turns the boot into `window.slop`:

```js
window.slop = { route, data: { <name>: { list(), get(id), all } }, record, version, mode, tokens }
```

`list()` and `get()` return Promises. `all` is the array itself, read synchronously. Pinup's compiled apps use `all` (`web/pinup/slop/js/96-slop-app.js:268`), so whatever we change must keep `all` synchronous.

`writePage` (`serve.go:213-218`) sends the result with `Cache-Control: no-store`.

### 2.5 Every URL that serves bytes today

| URL (host) | Handler | Names | Cache-Control today |
|---|---|---|---|
| page HTML (site) | `serveSite` → `writePage` | a place | `no-store` |
| `/_d/<a>/<n>/<f>` (site, sandbox) | `serveData` → `serveBlob` (`kernel.go:240`) | content | `private, max-age=31536000, immutable` |
| `/_d/<a>/main/<f>` (site, sandbox) | `serveData` (`serve.go:234-259`) | a place | `no-cache` + ETag |
| `/_v/<a>/<n>/<f>` (site) | `serveSite` → `serveBlob` | content | immutable |
| `/<file>` relative to the page (site) | `serveSite` (`serve.go:406-425`) → `serveBlob` | **a place** | **immutable** ← bug |
| `/v/<n>/<f>` (sandbox) | `serveSandbox` → `serveBlob` | content | immutable |
| `/_blob/<id>` (sandbox, runtime assets) | `serveAsset` (`rt_more.go:393-413`) | a deletable id | `private, no-cache` |
| `/_slop/<name>.js` (all hosts) | `serveSlopAsset` (`serve.go:196-206`) | a place (changes with the binary) | `no-cache` |
| `/api/artifacts/{id}/versions/{n}/files/{path}` (main) | `getFile` → `serveBlob` | content | immutable |
| `/static/workshop/assets/*` (main) | `workshopFile` (`workshop.go:48-58`) | content (hashed names) | `public, immutable` |

Nothing is compressed anywhere: there is no gzip in `pkg/server` or `pkg/httpx`, and the Traefik ingress has no compress middleware (`hetzner-k3s gitops/kustomize/slop/ingress.yaml`).

## 3. The measurements, explained

`scripts/01-measure-site.py` fetches a page, splits its boot block per binding, sums the covers, and prints cache headers. Baseline:

```text
page https://site.slop.yolo.scapegoat.dev/: 200, 670476 bytes on the wire, 670476 raw, 170738 if gzipped, 3.26s
  cache-control: no-store  content-encoding: None  etag: None
  boot block: 664252 bytes
    data.catalog: 104 records, 380339 bytes
    data.media: 304 records, 136971 bytes
    data.media2: 360 records, 163641 bytes
    data.media3: 28 records, 12565 bytes
  covers: 94, 76.3 MB at full size
  first cover /_d/francois-media-3/main/files/med_fc427b42fb1d4fdb36e63b71.webp: 200 cache-control=no-cache 0.67s
  first cover ?w=480: 200 285314 bytes type=image/webp cache-control=no-cache 2.33s
```

What each line means:
- **The HTML is the data.** 99% of the page's bytes are the boot block, and 47% of that is media records the page never reads.
- **The HTML cannot be cached.** `no-store` forbids even a 304, so the browser downloads 670 KB on every visit, including from the back button.
- **Covers are originals.** `?w=480` is ignored today; the server returns the full 285 KB file.
- **Revalidation per image.** Each cover is a place URL, so each visit asks the server about all 94 again.
- **The link is slow.** A fresh connection costs about 0.45 s before the first byte (TLS plus round trips). Throughput was 40–500 KB/s. Under these conditions bytes dominate: 76 MB at 300 KB/s is over four minutes.

The entry page `/apps/<id>` (page `storefront-entry`) has the same problem. It shows one record but inlines all four bindings (676 KB). Its gallery shows full-size images in 160 px tiles.

## 4. Design principles

**Consistent.** One rule per concern, applied on every host and every URL that serves bytes. No storefront-specific code in the server.

**Simple.** Each rule is decided in one function. An intern should be able to answer "what cache header does this URL get?" by reading one switch.

**Elegant.** Reuse what exists:
- Content addressing (sha256 and version numbers) already makes most URLs immutable.
- Derived files are keyed by the same sha256.
- Data scripts are keyed by the same `artifact@n`.

**Expressive.** Page authors get two small helpers (`slop.image`, `slop.srcset`) and one manifest key (`files`). The URL forms they already know keep working.

## 5. Rule 1: three cache classes

Every response that carries bytes gets one of three classes. What decides it is **what the URL names**, never the file type.

| Class | URL names | `Cache-Control` | Validator |
|---|---|---|---|
| **Content** | a version number or a hash | `public, max-age=31536000, immutable` (site host); `private, …` elsewhere | ETag = sha256 (+ variant) |
| **Place** | `main`, a page-relative path, `/_slop/…` | `public, max-age=60, stale-while-revalidate=86400` (site); `private, no-cache` elsewhere | ETag = sha256 (+ variant) |
| **Document** | an HTML page | `no-cache` | ETag = sha256 of the rendered body |

Why these values:
- **Content** URLs can never return different bytes, so the browser may keep them forever. `public` lets a CDN or proxy in front of the site host cache them too. The sandbox and the main host stay `private`, because their content is not public.
- **Place** files may change. A minute of freshness plus `stale-while-revalidate` means:
  - a repeat visit shows images and CSS instantly;
  - the browser checks in the background;
  - a new version appears within a minute, or on the next visit after that.
- **Documents** must reflect the current route table and `main` immediately. `no-cache` with an ETag gives a 304 (no body) when nothing changed. That replaces today's `no-store`, which forces a full download.

The bug fix falls out of the rule. Page-relative files (`/boutique.css`) are place URLs, so they become class **Place**. Browsers that already cached `/boutique.css` as immutable keep it until it expires. Only a different URL reaches them. The storefront can force that by linking `boutique.css?v=2` once.

`/_slop/runtime.js` and `/_slop/claude.js` become content URLs. `Inject` writes `/_slop/runtime.js?h=<sha8 of the embedded file>`, computed once at startup, and `serveSlopAsset` serves a matching `h` as class Content.

### 5.1 One function serves file bytes

Today `serveBlob`, `serveData` and `serveAsset` each set headers and call `http.ServeContent`. They become callers of one function:

```go
// File classes: what a URL names decides how long it may be cached.
type class int

const (
    contentURL class = iota // names bytes that never change (a version number, a hash)
    placeURL                // names a place whose bytes may change (main, a page path)
)

// serveFile writes one stored file: its variant (?w=), its encoding (gzip),
// and the cache headers of its URL's class.
func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, f store.FileEntry, c class) {
    v, err := s.variant(r.Context(), f, r.URL.Query().Get("w"), acceptsGzip(r)) // section 6, 7
    if err != nil { unavailable(w, err); return }
    defer v.Close()
    h := w.Header()
    h.Set("Content-Type", v.Type)
    h.Set("ETag", `"`+v.Tag+`"`)                  // sha256, or sha256.w480, or sha256.gz
    if v.Encoding != "" { h.Set("Content-Encoding", v.Encoding); h.Add("Vary", "Accept-Encoding") }
    h.Set("Cache-Control", s.cacheControl(r, c))
    http.ServeContent(w, r, "", zeroTime, v)       // ranges, If-None-Match, HEAD
}

func (s *Server) cacheControl(r *http.Request, c class) string {
    scope := "private"
    if s.isSiteHost(r.Host) { scope = "public" }
    switch c {
    case contentURL: return scope + ", max-age=31536000, immutable"
    default:
        if scope == "public" { return "public, max-age=60, stale-while-revalidate=86400" }
        return "private, no-cache"
    }
}
```

Callers become one line each. For example, `serveData` passes `contentURL` for a number and `placeURL` for `main`, and the page-relative branch of `serveSite` passes `placeURL`. `serveAsset` keeps its own `Cache-Control` (`private, no-cache`), because a deleted runtime asset must disappear. It can still use `variant` for `?w=`.

### 5.2 Documents get an ETag

```go
func (s *Server) writePage(w http.ResponseWriter, r *http.Request, status int, body []byte) {
    tag := `"` + blobs.Sum(body)[:32] + `"`
    h := w.Header()
    h.Set("Content-Type", "text/html; charset=utf-8")
    h.Set("Cache-Control", "no-cache")
    h.Set("ETag", tag)
    if status == http.StatusOK && etagMatch(r.Header.Get("If-None-Match"), tag) {
        w.WriteHeader(http.StatusNotModified)
        return
    }
    writeMaybeGzip(w, r, status, body)             // section 7
}
```

Hashing a 3 KB page (after section 8) costs microseconds. Even today's 670 KB page hashes in about 1 ms.

## 6. Rule 2: thumbnails with `?w=`

Any URL that serves an image file accepts `?w=<width>`. The server returns the image scaled to that width (height in proportion) and caches the result. Authors write:

```html
<img src="/_d/francois-media-2/1/files/med_c53d….webp?w=480"
     srcset="…?w=320 320w, …?w=480 480w, …?w=640 640w, …?w=960 960w"
     sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
     loading="lazy" decoding="async" alt="…">
```

### 6.1 Rules

- **Widths are snapped up** to a fixed ladder: 160, 320, 480, 640, 960, 1280 and 1920. `?w=500` serves 640. The ladder bounds the number of cached copies per image to seven, which also bounds abuse.
- **Never upscale.** If the original is not wider than the snapped width, serve the original.
- **Supported sources:** JPEG, PNG and WebP (still images). GIF (often animated), AVIF, SVG and anything that fails to decode are served as the original. `?w` is ignored for non-images.
- **Output format:**
  - JPEG at quality 80 when the image is opaque;
  - PNG when it has transparency;
  - if the result is not smaller than the original, the original is served.
  - Go's standard library encodes JPEG and PNG but not WebP. JPEG thumbnails at these sizes are small (a 480×300 photo is about 25–40 KB), so a WebP encoder is not worth a cgo or WebAssembly dependency.
- **Guard rails:**
  - Read dimensions first with `image.DecodeConfig`. Above 50 megapixels, serve the original.
  - At most two resizes run at once (a semaphore). The pod has a 512 Mi memory limit, and a 4000×3000 image decodes to 48 MB.
  - Concurrent requests for the same key share one resize (`golang.org/x/sync/singleflight`, already in `go.mod`).
- **ETag** is `<sha256>.w<width>`. The class follows the URL: `/_d/<a>/1/…?w=480` is Content; `/_d/<a>/main/…?w=480` is Place.

### 6.2 Where thumbnails live

Derived files live **beside** the blob store, never inside `blobs/`. `Blobs.Collect` (`blobs.go:182`) walks `blobs/` and deletes every file no version references, so a thumbnail inside it would be collected.

```text
/var/lib/slop/blobs/
├── blobs/<sha[:2]>/<sha>                 originals (content-addressed, garbage-collected by reference)
└── derived/<sha[:2]>/<sha>.w480.jpg      thumbnails
    derived/<sha[:2]>/<sha>.w480.same     "the original is smaller": an empty marker
    derived/<sha[:2]>/<sha>.gz            gzipped text (section 7)
```

Garbage collection of `derived/`: `slop db gc-blobs` also removes derived files whose source sha is gone. Add this to `Collect` or to a sibling `CollectDerived(existing func(sum) bool)`. Derived files can always be rebuilt, so deleting too many is safe.

### 6.3 `variant`, in pseudocode

```go
// variant opens the bytes to send for f: the original, a thumbnail for
// ?w=, or a gzipped copy. Derived files are built once and kept.
func (s *Server) variant(ctx context.Context, f store.FileEntry, w string, gz bool) (*variantFile, error) {
    if width, ok := snapWidth(w); ok && thumbable(f.Type) {   // 160…1920; jpeg, png, webp
        key := f.SHA256 + ".w" + strconv.Itoa(width)
        if p, typ, ok := s.Derived.Find(key); ok {           // .jpg, .png, or .same
            return openVariant(p, typ, key)
        }
        p, typ, err, _ := s.thumbs.Do(key, func() (any, error) {
            s.resizeSem <- struct{}{}; defer func() { <-s.resizeSem }()
            return s.makeThumb(f, width, key)                 // decode, scale, encode, write
        })
        if err == nil && typ != "same" { return openVariant(p, typ, key) }
        // fall through: decoding failed, too large, or not smaller -> the original
    }
    if gz && compressible(f.Type) && f.Size > 1024 {
        return s.gzipped(f)                                   // derived/<sha>.gz, built once
    }
    return openOriginal(s.Blobs, f)
}

func (s *Server) makeThumb(f store.FileEntry, width int, key string) (string, string, error) {
    src, _ := s.Blobs.Open(f.SHA256); defer src.Close()
    cfg, _, err := image.DecodeConfig(src)                    // header only
    if err != nil || cfg.Width <= width || cfg.Width*cfg.Height > 50_000_000 {
        return s.Derived.Mark(key + ".same")
    }
    src.Seek(0, io.SeekStart)
    img, _, err := image.Decode(src)                          // jpeg, png, webp registered
    if err != nil { return s.Derived.Mark(key + ".same") }
    h := cfg.Height * width / cfg.Width
    dst := image.NewNRGBA(image.Rect(0, 0, width, h))
    draw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil) // golang.org/x/image/draw
    if opaque(dst) { return s.Derived.WriteJPEG(key, dst, 80) }
    return s.Derived.WritePNG(key, dst)
}
```

New dependency: `golang.org/x/image` (`draw` for scaling, `webp` for decoding). It is pure Go and maintained by the Go team.

### 6.4 Records learn image sizes

File records of images gain `width` and `height`. `records()` reads them with `image.DecodeConfig` from the blob header when it builds the record cache, which happens once per `artifact@n`. Pages can then reserve space (`width`/`height` attributes), so nothing jumps while images load, and pick sensible sizes.

### 6.5 Helpers for authors (`runtime.js`)

```js
// slop.image(src, width): the URL of src scaled to width (snapped server-side).
slop.image = function (src, w) { return w ? src + (src.indexOf('?') < 0 ? '?' : '&') + 'w=' + w : src; };
// slop.srcset(src, widths): a srcset attribute value for src.
slop.srcset = function (src, widths) {
  return (widths || [320, 480, 640, 960, 1280]).map(function (w) { return slop.image(src, w) + ' ' + w + 'w'; }).join(', ');
};
```

They are plain string helpers: no DOM, no magic. A page that prefers to write `?w=480` by hand gets exactly the same result.

## 7. Rule 3: compress text

Send text gzipped when the request says `Accept-Encoding: gzip`. Compressible types: `text/*`, `application/json`, `application/javascript`, `text/javascript`, `image/svg+xml`, `application/xml`. Skip responses under 1 KB.

Two cases, one rule:
- **Bodies built in memory** (HTML pages, data scripts from section 8, JSON from `httpx.JSON`): compress on the fly with a pooled `gzip.Writer` at level 5. Set `Content-Encoding: gzip` and `Vary: Accept-Encoding`. A 670 KB page becomes 171 KB; a 3 KB page becomes about 1.3 KB.
- **Stored files** (a page's CSS and JS, JSON records files): compress once into `derived/<sha>.gz` and serve that with `http.ServeContent`. ETag `<sha>.gz`. Same class as the original URL.

Do **not** wrap the whole mux in a compression middleware:
- Server-sent event streams (`/_rt/events`, `/api/events`) must flush every event, and a gzip writer buffers them.
- `http.ServeContent` answers byte ranges for media, which must stay uncompressed.

The explicit approach touches only the handlers listed above.

The ingress could compress instead (a Traefik `compress` middleware). Doing it in slop keeps local mode and the cluster identical, and lets stored files be compressed once instead of on every request.

## 8. Rule 4: data as cacheable scripts

### 8.1 The idea

The boot block is inside the HTML, and the HTML is a Document: it must be revalidated, and when anything changes, all of it is downloaded again. The records, however, are content. `francois-catalog@1` will never change. So they should travel at a content URL:

```text
/_r/<artifact>/<n>.js          e.g. /_r/francois-catalog/1.js
```

This new namespace holds one data version's records as a script:

```js
slop.records("francois-catalog@1", [ {...}, {...}, … ]);
```

`Inject` writes one synchronous `<script src>` per binding, right after `runtime.js`:

```html
<script type="application/json" id="slop-boot">{"route":…,"data":{"catalog":"francois-catalog@1"},…}</script>
<script src="/_slop/runtime.js?h=3f9a1c2e"></script>
<script src="/_r/francois-catalog/1.js"></script>
… the page's own head and scripts …
```

Why a script and not `fetch()`:
- **Synchronous scripts in `<head>` run in order before the page's own scripts.** So `slop.data.catalog.all` is filled when the page reads it, and Pinup's compiled apps keep working without a change.
- **The browser caches a content URL forever.** The storefront and every `/apps/<id>` page share one download of the catalog.
- **It gzips** (rule 3) and gets class **Content** (rule 1).

`runtime.js` keeps its API and gains a registry:

```js
var store = {};
slop.records = function (key, rows) { store[key] = rows; };      // called by /_r/ scripts
Object.keys(D.data || {}).forEach(function (name) {
  var ref = D.data[name];                                         // "artifact@n", or inline rows (old servers)
  var rows = function () { return typeof ref === 'string' ? (store[ref] || []) : ref; };
  data[name] = {
    list: function () { return Promise.resolve(rows().slice()); },
    get: function (id) { return Promise.resolve(rows().filter(function (r) { return r.id === id; })[0] || null); },
    get all() { return rows(); },
  };
});
```

The route's matched `record` (`--record`) stays inline. It is one record, and it names a place.

### 8.2 Serving `/_r/`

```text
GET /_r/<artifact>/<n>.js     (site and sandbox hosts)
  - allowed when /_d/<artifact>/… would be allowed (the artifact is read by a public route's page)
  - body: "slop.records(" + json(key) + "," + json(records(artifact, n)) + ");"
  - Content-Type: text/javascript; charset=utf-8
  - class Content (immutable), gzip when accepted, ETag "<artifact>@<n>"
```

The JSON is escaped for a script context: `<` becomes `<`, exactly like `Inject` already does for the boot (`render.go:73`), so a record cannot close the script.

### 8.3 Serve-only artifacts: the `files` manifest key

The storefront binds three media artifacts only so their files may be served. With data as scripts, those bindings would still cost three downloads. A manifest key says "this page links to these artifacts' files; do not load their records":

```json
{ "reads": { "catalog": "francois-catalog" },
  "files": ["francois-media", "francois-media-2", "francois-media-3"],
  "tokens": "lab-tokens" }
```

`pageManifest` (`serve.go:84-87`) gains `Files []string`. `reads()` (`serve.go:262`), which decides what `/_d/` may serve, includes them. `bindings()` ignores them.

### 8.4 Optional: an index of servable artifacts

Every `/_d/` and `/_r/` request walks all public routes of the host and loads each routed page version to see what it reads (`serve.go:366-386`). On the cluster that is about 100 routes (`/r/<page>` for each app). Today it is not the dominant cost: a 304 takes as long as `/healthz`. If it shows up after the byte savings, cache the set per host and rebuild it when a route or a `main` changes. Route changes and pushes already publish events: `EvRouteSet`, `EvRouteRemoved`, `EvVersionCreated` and `EvRefMoved` (`pkg/store/events.go:25-41`).

## 9. Putting it together: the storefront after the change

The page code (artifact `storefront`, version 2) changes in three places:

```js
const fix = u => String(u || '').replace(/^https?:\/\/slop\.boutique/i, '');
// …
grid.innerHTML = rows.map((r, i) => {
  const src = cover ? fix(cover.src) : '';
  return `<a class="sb-card" href="/apps/${encodeURIComponent(r.id)}">
    <div class="sb-cover">${cover ? `<img class="cover" src="${slop.image(src, 640)}"
         srcset="${slop.srcset(src, [320, 480, 640, 960, 1280])}"
         sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
         alt="${esc(cover.alt || r.title)}" ${i < 6 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : ''}…`;
}).join('');
```

- Its manifest uses `files` instead of the three media `reads` (section 8.3).
- `<link rel="stylesheet" href="boutique.css?v=2">` gets past the year-long cache the bug left behind.
- `storefront-entry` gets the same treatment: the cover at `slop.image(src, 1280)`, gallery tiles at `slop.srcset(src, [320, 640])`, and links to the original for the full image.

Expected weight on a first visit:

| Part | Before | After |
|---|---|---|
| HTML | 670 KB, `no-store` | about 3 KB raw, 1.5 KB gzipped, `no-cache` + ETag |
| Data | (inline) | `/_r/francois-catalog/1.js`: 380 KB raw, about 70 KB gzipped, immutable |
| Visible covers (about 6) | about 3–5 MB | about 6 × 40 KB = 240 KB |
| All covers (lazy, while scrolling) | 76 MB | about 3.5 MB |
| Repeat visit | 670 KB + 94 revalidations | one 304 for the HTML; images and data from cache |

### 9.1 The request flow after the change

```text
browser                                   site host (serveSite)
-------                                   ---------------------
GET /  (If-None-Match: "ab12…")  ------>  render page, hash body
<------------------------------- 304 (or 200, 1.5 KB gzip, no-cache, ETag)
GET /_slop/runtime.js?h=3f9a1c2e ------>  embedded asset           (content: cached forever after once)
GET /_r/francois-catalog/1.js    ------>  records -> script -> gzip (content: cached forever)
GET /boutique.css?v=2            ------>  page file, derived .gz    (place: 60 s fresh, then SWR)
GET /_d/francois-media-2/main/files/med_c53d….webp?w=640
                                 ------>  variant: derived/c5/c53d….w640.jpg (built once)
<------------------------------- 200 image/jpeg 38 KB, public, max-age=60, stale-while-revalidate=86400
```

## 10. Side fix: the Workshop hides artifacts with an unknown project

`ArtifactMenu` (`web/workshop/src/components/organisms/TopBar.tsx:114-133`) and `ArtifactsScreen` (`web/workshop/src/screens/ArtifactsScreen.tsx:14-29`) both group artifacts like this:

```ts
const groups = [...projects.map(p => ({ id: p.id, name: p.name })), { id: null, name: 'No project' }]
groups.map(g => arts.filter(a => a.project === g.id))
```

An artifact whose project is not in `projects` belongs to no group and is not shown. That happens when the projects request fails or is still loading, or when a project row is missing. Then the menu shows only "No project", which is what the user saw on the cluster.

Fix: derive the groups from the artifacts themselves, and use `projects` only for names:

```ts
const ids = [...new Set(arts.map(a => a.project ?? null))]
const name = (id: string | null) => id == null ? 'No project' : projects.find(p => p.id === id)?.name ?? id
const groups = ids.sort(byNameNullLast).map(id => ({ id, name: name(id) }))
```

This is the same rule as the rest of the ticket: show what the data says, never drop rows because a side lookup is missing.

## 11. API and file reference

### 11.1 URL forms (new or changed)

| URL | Host | Change |
|---|---|---|
| `…?w=<width>` on `/_d/`, `/_v/`, page-relative files, sandbox `/v/<n>/`, `/_blob/<id>`, `/api/…/files/…` | all | new: thumbnail variant |
| `/_r/<artifact>/<n>.js` | site, sandbox | new: a data version's records as a script |
| `/_slop/<name>.js?h=<sha8>` | all | new query: content-addressed runtime assets |
| page HTML | site, sandbox | `no-store` → `no-cache` + ETag, gzip |
| `/_d/<a>/main/…`, page-relative files | site | `no-cache` / immutable → Place class |

### 11.2 Manifest

```json
{ "reads": { "<name>": "<data artifact>" },   // records loaded, as today (now via /_r/)
  "files": ["<data artifact>", …],            // new: files servable, records not loaded
  "tokens": "<tokens artifact>" }
```

### 11.3 `window.slop`

| Member | Status |
|---|---|
| `slop.data.<name>.list()`, `.get(id)`, `.all` | unchanged API; backed by `/_r/` scripts |
| `slop.image(src, width)` | new |
| `slop.srcset(src, widths?)` | new |
| `slop.records(key, rows)` | new, internal: called by `/_r/` scripts |

### 11.4 Code to change

| File | Change |
|---|---|
| `pkg/server/kernel.go` (`serveBlob`) | becomes `serveFile(w, r, f, class)`; the callers pass a class |
| `pkg/server/serve.go` | `serveData` classes; the page-relative branch → Place; `/_r/` in `serveSite` and `serveSandboxData`; `writePage` ETag + gzip; `pageManifest.Files`; `reads()` includes `files`; `records()` adds `width`/`height` |
| `pkg/server/variants.go` (new) | `variant`, `snapWidth`, `makeThumb`, gzip of stored files, semaphore, singleflight |
| `pkg/blobs/derived.go` (new) | `Derived{Root}`: `Find`, `WriteJPEG`, `WritePNG`, `WriteGzip`, `Mark`; `CollectDerived` |
| `pkg/server/rt_more.go` (`serveAsset`) | uses `variant` for `?w=`; keeps `private, no-cache` |
| `pkg/httpx` | `JSON` gzips large bodies when accepted (optional, main host) |
| `pkg/render/render.go` (`Inject`) | `Boot.Data` becomes `map[string]string` (`artifact@n`); writes `/_r/` scripts and `?h=` |
| `pkg/render/assets/runtime.js` | the registry, `all` as a getter, `image`, `srcset` |
| `cmd/slop/cmds/db.go` (`gc-blobs`) | also collects `derived/` |
| `web/workshop/src/components/organisms/TopBar.tsx`, `screens/ArtifactsScreen.tsx` | group by the artifacts' projects |
| `pkg/doc/topics/agents.md` + a new help topic `site-pages` | `?w=`, `files`, cache classes |
| `go.mod` | `golang.org/x/image` |

Pages (not repository code; pushed with `slop push`): `storefront` and `storefront-entry`.

## 12. Implementation phases

Each phase is shippable on its own and measurable with `scripts/01-measure-site.py`.

### Phase 1: cache classes, the bug, documents and gzip

1. Add `serveFile` with classes, and move `serveBlob`, `serveData` and the page-relative branch onto it. This fixes the bug.
2. In `writePage`: ETag, `no-cache`, 304, gzip.
3. Content-addressed `/_slop/*.js?h=`.
4. gzip of stored text files (`derived/<sha>.gz`).
5. Workshop grouping fix.

**Check:** the HTML is gzipped (about 171 KB), repeat visits get 304, and `/boutique.css` is Place.

### Phase 2: thumbnails

1. `golang.org/x/image`, `Derived`, `variant`, `makeThumb`, the ladder, the guard rails.
2. `width`/`height` in image records.
3. `slop.image` and `slop.srcset`.
4. `gc-blobs` collects `derived/`.

**Check:** `?w=480` on a cover returns about 30–40 KB JPEG with the right class. A second request is served from `derived/`.

### Phase 3: data as scripts

1. `/_r/<artifact>/<n>.js`.
2. `Inject` writes the scripts; `Boot.Data` holds references.
3. The `runtime.js` registry with `all` as a getter.
4. The manifest key `files`.

**Check:** the HTML is a few KB. Pinup's compiled app (`96-slop-app.js`) still renders from `.all`.

### Phase 4: the storefront and docs

1. Push `storefront` v2 and `storefront-entry` v2 (section 9).
2. Help topic `site-pages`; update `agents.md`.

**Check:** run the measurement script on the cluster and compare with the baseline.

### Phase 5 (optional): the servable-artifact index

Only if per-request route walking shows up in the measurements after phases 1–4.

## 13. Test strategy

| Area | Test |
|---|---|
| Classes | table test over every URL form in section 2.5: expected `Cache-Control` and ETag on site, sandbox and main hosts |
| Bug regression | push a page with `style.css`, request `/style.css` on the site: Place class; push v2 with a new `style.css`: the new bytes are served after revalidation |
| Documents | `If-None-Match` with the page's ETag gives 304 with no body; a route change gives 200 |
| gzip | `Accept-Encoding: gzip` gives `Content-Encoding: gzip` + `Vary`; without it, plain; SSE endpoints are never gzipped; range requests on video are not gzipped |
| Thumbnails | ladder snapping; no upscale; JPEG for opaque, PNG for alpha; WebP decodes; GIF/AVIF/SVG served as originals; over 50 MP served as original; second request comes from `derived/`; concurrent identical requests run one resize (counter); the "not smaller" marker |
| Memory | resize a 6000×4000 JPEG with a two-slot semaphore under `GOMEMLIMIT=400MiB` |
| GC | `gc-blobs` removes derived files of collected blobs and keeps the others |
| `/_r/` | gating is identical to `/_d/`; the body escapes `<`; immutable class; a page with two bindings gets both scripts in order |
| runtime.js | `.all` is synchronous in a page script after the `/_r/` scripts; old inline boots still work |
| Workshop | the artifact menu shows an artifact whose project is missing from `projects` |
| End to end | `scripts/01-measure-site.py` against the local server and the cluster, before and after |

## 14. Risks and open questions

**Risks**
- **Disk use of `derived/`.** At most seven thumbnails per image. For the catalog's 692 images at about 40 KB each, that is under 200 MB worst case on a 5 Gi volume. Monitor it; GC handles removed images.
- **CPU on first view.** The first visit after deploy builds thumbnails on demand. With two resizes at a time, 94 covers take a few seconds of server CPU, once. A warm-up command (`slop thumbs warm <artifact>`) can precompute them if needed.
- **Stale `/boutique.css` in existing browsers.** Fixed only by a new URL (`?v=2`).
- **`public` caching on the site host.** It is correct for public pages. If live sites (SLOP-011) later serve per-viewer pages on the site host, those responses must be `private`. The class function is the single place to change.

**Open questions**
1. **Ladder.** Is 160–1920 right, or should it stop at 1280 for this deployment's bandwidth?
2. **Freshness.** Should Place freshness be 60 s or 5 minutes? Shorter shows edits sooner; longer saves revalidations.
3. **WebP output.** Is it ever wanted? It needs a non-standard encoder dependency.
4. **The importer.** Should it rewrite catalog cover URLs to numbered versions (content class) after pushing the media artifacts? It would need a second pass once version numbers are known.

### 14.1 Decisions (2026-10-30)

The user asked me to pick ("You chose the best cases"):

1. **Ladder: keep 160–1920.** `srcset` lets the browser pick the smallest width that fits, so the large rungs cost nothing unless a wide or high-DPI screen asks for them. Disk use is bounded at seven copies per image.
2. **Place freshness: 60 s** with a one-day `stale-while-revalidate`. Edits show within a minute, and repeat visits never wait on revalidation.
3. **No WebP output.** JPEG and PNG from the standard library are enough at thumbnail sizes. No new encoder dependency.
4. **The importer writes numbered URLs.**
   - `slop import francois push` pushes the media artifacts first, then rewrites `cover.src` and `gallery[].src` in the catalog records to `/_d/<media>/<n>/…` before pushing the catalog.
   - Covers then use the Content class, so the browser never revalidates them.
   - The cluster's catalog is fixed by re-running the import push. The import is idempotent, and only the catalog gets a new version.

## 15. Glossary

- **Content URL**: names bytes that can never change (a version number or a hash in the URL).
- **Place URL**: names a location whose bytes may change (`main`, a page path).
- **Document**: an HTML page rendered per request.
- **Variant**: a derived form of a stored file: a thumbnail (`.w480`) or a gzipped copy (`.gz`).
- **Derived store**: `<blobs root>/derived/`, files computed from blobs, safe to delete.
- **Data script**: `/_r/<artifact>/<n>.js`, one data version's records as a cacheable script.
