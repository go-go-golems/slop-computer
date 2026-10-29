---
Title: Pinup designs, for agents
Slug: pinup
Short: Read and change a Pinup design that people have open, apply review feedback step by step, and publish or build from it.
Topics:
- pinup
- docs
- agents
Commands:
- docs
- comments
- pull
- route
IsTemplate: false
IsTopLevel: true
ShowPerDefault: true
SectionType: GeneralTopic
---

Pinup is the screen-design tool in the Workshop (Tools ▸ Pinup). A **design**
is a data artifact of type `pinup`, such as `design-pace-club`, with two halves:

- **Live documents**, the working copy people edit right now. Read and write
  them with `slop docs`. Changes show up in every open Pinup tab within a
  second.
- **Versions**, snapshots made with *Save version* in Pinup. They are what
  `slop pull` gives you and what published prototypes serve.

## Live documents

```
meta/file      { name, pages:[{id,name}], tokens:{colors, type}, v:1 }
nodes/<id>     one layer: id, type (frame|rect|ellipse|line|text|icon|svg|instance), page, parent, z, name,
               x, y, w, h, fills, stroke, radius, effects, layout, sw/sh (fixed|hug|fill), text, font, size, …
feedback/<id>  a review item: n, text, cat, node, dx, dy, area, marks, status (open|doing|done|wontfix), reply, log
log/<id>       one history step (before/after per layer), written by the editor tabs
inbox/<id>     HTML or a step for the first open editor tab to apply (then it deletes it)
```

```sh
slop docs ls design-pace-club nodes/          # paths and revs
slop docs get design-pace-club meta/file      # pages and tokens
slop docs get design-pace-club feedback/<id>  # one review item
slop docs watch design-pace-club              # every change and who is looking, as JSON lines
```

Omit any layer field you don't need; Pinup fills in defaults. Colours are
`#RRGGBB` or `$tokenId`.

## Changing a design: write to inbox/

Prefer the inbox to writing `nodes/` directly. The open editor tab applies
each inbox document as **one step in the history**, so a person can revert
it on its own.

**HTML** adds or replaces a screen. Use inline styles and flexbox, which
becomes auto layout. The root sets an explicit width: 390 for phones, 1440
for desktop.

```sh
cat > h1.json <<'JSON'
{ "html": "<div data-name=\"Settings\" style=\"width:390px;height:844px;background:#fff;display:flex;flex-direction:column;gap:12px;padding:24px\"><h2 style=\"margin:0;font:700 24px Inter\">Settings</h2></div>",
  "name": "Settings", "x": 2000, "y": 0 }
JSON
slop docs put design-pace-club inbox/h1 h1.json
```

The importer understands these attributes:

- `data-name="Card"`: the layer's name;
- `data-icon="arrow-right"`: a Lucide icon;
- `data-component="Button/Primary"` and `data-instance="Button/Primary"`: components and their instances;
- `data-link="Run detail"` or `"back"`: a prototype link;
- `data-flow="Onboarding"`: the screen starts a prototype flow;
- `var(--tk-<tokenId>)`: a colour token.

`"replace": "<nodeId>"` swaps that layer for the imported one.

**A step** applies ordered operations, can resolve a feedback item, and lands as one revertible history entry:

```json
{ "kind": "step", "seq": 1, "feedback": "#1", "label": "More space between run cards",
  "reply": "Raised the gap between run cards from 12 to 20px.",
  "ops": [{ "op": "update", "id": "keFmmRsu4p", "data": { "layout": { "dir": "col", "gap": 20, "pad": [0,0,0,0] } } }] }
```

The ops:

- `update`: merge fields into a layer (`{op, id, data}`);
- `set`: replace a layer (`{op, id, data}`);
- `delete`: remove a layer (`{op, id}`);
- `html`: import HTML (`{op, html, parent?, replace?, x?, y?}`);
- `tokens`: add or replace colour tokens and text styles (`{op, data: {colors, type}}`).

When `feedback` names an item (`#n`), the item becomes `done` with your
`reply`. Write several steps with increasing `seq`, and they land in order,
half a second apart, so people can follow along.

**An editor tab must be open.** Steps wait in `inbox/` until someone has the
design open in Pinup. Use `slop docs watch` to see who is there; an agent
that is waiting shows as "Claude".

## The loop

```sh
slop comments wait -a design-pace-club
#   Pinup's "Send to Claude" and "Hand off" open threads on the design.
slop docs ls design-pace-club feedback/
slop docs get …
#   decide the smallest change that addresses each item
slop docs put design-pace-club inbox/s1 step.json
slop comments reply <thread> "Done in step #1"
```

## Building the real app

*Hand off* in Pinup saves a version and opens a thread for you:

1. `slop pull design-pace-club` gives you:
   - `handoff.md`: tokens, components and screens as JSX, and the prototype map;
   - `pages/<pageId>.json`: every layer, page by page;
   - `file.json`: the pages and tokens.
2. Build the app as a page artifact (`slop push … -a pace-club`), route it,
   and reply in the thread with the URL.

## Publishing a prototype

*Publish prototype* in Pinup does this for you. By hand:

```sh
slop route set /proto/pace-club/:screen pinup-player --bind design=design-pace-club
slop route set /proto/pace-club         pinup-player --bind design=design-pace-club
```

- **What it serves.** `pinup-player` presents the design's **saved version**,
  following its `main`, at `/proto/pace-club/<screen>`, where the screen is
  the frame name as a slug.
- **Updating it.** Saving a new version updates the prototype.
- **What becomes public.** The route makes the saved version public:
  `file.json`, the pages and `handoff.md`. Feedback stays in the live documents.

## Pinup apps: designs that are real pages

A design can be published as a real page instead of a prototype. In Pinup:
slop menu → *Make this an app…*, then *Publish app*. Publishing compiles every
screen that has a page path into one page artifact (`S.file.app.page`, for
example `pace-club`), and routes each screen on the app's host under its base
path. The page's manifest says where it comes from:

```json
{"pinup": {"design": "design-pace-club", "version": 5}, "reads": {"runs": "data-runs"}}
```

**The design is the source.** Change the design, not the page. A
`slop push` to a compiled page warns you, and *Publish app* then asks the
person before replacing the hand-written version. That push is how an app
becomes hand-written code; also remove `app` from the design's `meta/file`.

These are the fields an agent can set with steps (`{"op": "update", "id": …, "set": {…}}`):

| Where | Field | Meaning |
|---|---|---|
| `meta/file` | `app: {page, host, base, data}` | The page artifact, site host, base path, and data sources (name → data artifact) |
| top-level frame | `route: "/runs/:id"` | The screen's path under the base. A frame without a route is not a page |
| top-level frame | `record: "runs"` | On a path with a `:param`, show the record of that source whose `id` (or `slug`) is the param |
| frame | `repeat: {from: "runs", sort: "-date", limit: 10}` | Repeat the first child once per record. The other children are sample copies and are left out |
| image fill | `bind: "photo"` | Use the record's field (a file record's `src`, or a URL) as the image |
| text | `{{title}}`, `{{params.id}}`, `{{app.name}}` | Filled from the repeat's row, then the screen's record, then the path and the app |

Prototype links become `<a href>`s. A link to a screen whose path has
parameters is filled in from the record in scope (`/pace-club/runs/{{id}}`).
Publishing stays a person's action in Pinup: it moves routes on the site.
