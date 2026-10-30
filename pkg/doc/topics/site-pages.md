---
Title: "Site pages that load fast: images, data and caching"
Slug: site-pages
Short: How a page on the site host gets scaled images (?w=), its data (window.slop.data), and what browsers may cache.
Topics:
- site
- pages
- images
- caching
Commands:
- push
- route
IsTemplate: false
IsTopLevel: true
ShowPerDefault: true
SectionType: GeneralTopic
---

A page on a site host reads data through `slop.json` and shows images that
data artifacts hold. Three things keep it fast: images at the size they are
shown, data the browser keeps, and URLs that say whether they can change.

## Images at the size they are shown

Any URL that serves a JPEG, PNG or WebP image takes `?w=<width>` and returns
the image scaled to that width:

```html
<img src="/_d/media/3/files/cover.webp?w=640"
     srcset="/_d/media/3/files/cover.webp?w=320 320w, /_d/media/3/files/cover.webp?w=640 640w, /_d/media/3/files/cover.webp?w=1280 1280w"
     sizes="(max-width: 700px) 100vw, 33vw" loading="lazy" decoding="async" alt="…">
```

- Widths snap up to 160, 320, 480, 640, 960, 1280 or 1920; an image is never
  enlarged, and the original is sent whenever it is smaller than the copy.
- Opaque images come back as JPEG, transparent ones as PNG.
- `window.slop` writes these for you: `slop.image(src, 640)` and
  `slop.srcset(src, [320, 640, 1280])`.
- Records of image files carry `width` and `height`, so a page can reserve
  the space (`<img width height>`) before the image arrives.

## Data the browser keeps

```json
{ "reads": { "catalog": "francois-catalog" },
  "files": ["francois-media", "francois-media-2"],
  "tokens": "lab-tokens" }
```

- **`reads`**: the records a page uses, as `slop.data.<name>.list()`,
  `.get(id)` and `.all`. They load from `/_r/<artifact>/<n>.js`, one script
  per data version, which the browser keeps: every page that reads the same
  version shares one download.
- **`files`**: data the page only links to (covers, galleries). Its files are
  served; its records are not loaded. Do not put image collections in
  `reads` just so their files are served.

## What may be cached

What a URL names decides how long a browser keeps it:

| URL names | Examples | Cached |
|---|---|---|
| a version or a hash | `/_d/media/3/…`, `/_v/page/7/…`, `/_r/catalog/2.js` | for good |
| a place that moves | `/_d/media/main/…`, `style.css` next to the page | a minute, then refreshed in the background |
| the page | `/`, `/apps/weft` | revalidated on every visit (a 304 when unchanged) |

Prefer numbered `/_d/<artifact>/<n>/…` links in records: `slop import
francois push` (and any seed push) writes them for the data it pushes. A file
next to the page (`style.css`) changes with the page; to make browsers drop a
copy they kept before this rule, link it once with a new query, e.g.
`style.css?v=2`.

Text (HTML, JSON, JavaScript, CSS) is sent gzipped.
