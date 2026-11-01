---
Title: Diary
Ticket: SLOP3-003
Status: active
Topics:
    - architecture
    - goja
    - tools
    - apps
    - publishing
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of SLOP3-003: the Blocks publishing guide and the implementation of phases B1 to B4."
LastUpdated: 2026-11-01T18:01:30.792924484-05:00
WhatFor: "Reviewing what was built in SLOP3-003, why, and what failed along the way."
WhenToUse: "When resuming SLOP3-003 or reviewing one of its commits."
---

# Diary

## Goal

This diary records the work on SLOP3-003: publishing a Claude Blocks
workspace as web pages, both as a live, content-only reader and as a
static snapshot pushed to a static store. Each step follows the
investigation format: what was asked, what was done, what failed, and how
to review it.

## Step 1: Investigation, the ticket and the design guide

The investigation answered one question before any design: can the
server fold a Blocks workspace the way the editor does? It can. The
editor's kernel (`hypha.js`) and the two libraries that register block
kinds (`fruit.js`, `blocks-kit.js`) load without a DOM, and an actor can
`require()` them unchanged. The investigation also found that the editor's
prose tokenizer never returns on text with a bold, italic or struck span
when called directly, which ruled out reusing the editor's renderer. The
guide (`design-doc/01-blocks-publishing-design-and-implementation-guide-for-interns.md`)
was written from these findings and uploaded to reMarkable as "SLOP3-003
Blocks publishing guide" in `/ai/2026/11/01/SLOP3-003`.

### Prompt Context

**User prompt (verbatim):** "Do both. Create a new docmgr ticket. Create
a detailed analysis / design / implementation guide that is for a new
intern, explaining all the parts of the system needed to understand what
it is, with prose paragraphs and bullet point sand pseudocode and diagrams
and api references and file references. It should be very clear and
technical. Store in the ticket and the nupload to remarkable. Then
implement, ccommit at appropriate intervals and keep a detailed diary as
you work (using the diary format from the skill)"

"Both" refers to the two options offered in answer to the earlier
question (verbatim): "how can we publish blocks as a public visible page,
say ws-team, or my-notes if i were to create it? can we do a blocks
serving app that renders the content (but not the blocks UI for
example?)". The two options were a live reader that renders a workspace's
pages without the editor, and publishing a rendered snapshot to a static
site.

**Assistant interpretation:** Design and build an app that serves a
workspace's pages as plain HTML (live) and can push them as files into a
static store (snapshot), usable by admins and by members for their own
workspaces.

**Inferred user intent:** Blocks becomes a content tool for slop: people
write landing pages and descriptions in the editor and publish them
without exposing the editor or the workspace itself.

### What I did

- `docmgr ticket create-ticket --ticket SLOP3-003 --title "Blocks publishing: a content-only live reader and static publishing for Claude Blocks workspaces" --topics architecture,goja,tools,apps,publishing`
  (topics `apps` and `publishing` added to the vocabulary).
- Read the Blocks storage code in slop-computer `web/blocks/src/blocks.js`:
  `Net.load` (the fold, line 529), `owns` and `hash32`, `Pages` (line 152),
  `envFor`, `Markdown.page` (the reference walk over a page's blocks), the
  slash menu (`SLASH`, line 1388) for the list of block kinds, and the
  constants `CHUNK_OPS`, `MARGIN` (line 503).
- Read `blocks-kit.js` (prose grammar, `rich`, `toHTML`, the `R.*` block
  renderers, `H.POS` registration), `fruit.js` (`h`, `kidsOf`, `kindOf`,
  `prop`) and `hypha.js` (`Kernel`: `receive`, `restore`, `batch`,
  `checkpoint`; the `performance` guard).
- Read the slop v3 side: `pkg/actor/actor.go` (`build`, `requirer`,
  `TurnLimit`), `pkg/actor/modules.go` (`storesModule`, `snap`),
  `pkg/actor/manager.go` (`MatchRoute`, `Serve`, `toRes`, `Req`),
  `pkg/server/actors.go` (`serveActorRoute`), `pkg/server/live.go` and
  `pkg/server/site.go` (actor routes on live and static hosts),
  `pkg/server/modworkshop.go`, `pkg/verbs/files.go` (`files.push`),
  `pkg/verbs/stores.go` (`store.new`), `pkg/verbs/actors.go` (`bind.set`),
  `pkg/rt/query.go`, `pkg/store/store.go` (`Head`), `pkg/system/mounts.go`
  (`Match.Base`).
- Looked at the demo workspaces' documents with `slop docs ls ws-team chunks`
  and checked the ownership hash by hand: `hash32("usr_e41fab4c0f7e823ae90df3cd")`
  in base 36 is `cm0pbw`, matching the peer `ucm0pbw:you`.
- Wrote `scripts/01-load-blocks-libs.mjs`: loads the three libraries in a
  fresh `vm` context, folds five ops, evaluates `{2+3}`, and shows the
  tokenizer loop in a worker with a 64 MB heap.
- Wrote the guide (11 sections, two mermaid diagrams, fold and render
  pseudocode, permission table, API and file references), added tasks B1
  to B4, related the upstream and server files, uploaded it.

### Why

- The fold must be the editor's fold, or a published page can differ from
  what its author sees. Vendoring the kernel and porting `Net.load` line by
  line is the only way to keep that true.
- A separate `blocks-site` store, bound to the workspace, keeps the
  workspace private: a guest of the site never gets a read on the
  workspace, only the HTML the actor renders.

### What worked

- All three libraries load in a context with no `window` or `document`;
  `globalThis.Hypha`, `Fruit` and `Blocks` appear, and `blocks-kit.js`
  registers the positional props (`p: ["text"]`) the fold needs.
- `Fruit.kindOf`, `Fruit.prop` and `Blocks.valueOf` work on a kernel built
  from ops, without the editor's `envFor` (a minimal `{al: new Map()}` is
  enough for formulas).

### What didn't work

- The first harness called `Blocks.richHTML(K, path, "Some **bold** and {2+3} and [[about]]", {})`
  and Node died with `FATAL ERROR: Ineffective mark-compacts near heap limit
  Allocation failed - JavaScript heap out of memory`. Narrowing it down,
  `Blocks.tokens("plain")` returns and `Blocks.tokens("Some **bold**")` does
  not. A copy of the tokenizer with a loop counter printed
  `LOOP at 5 "**bold**" lastIndex 13`: the recursive call for the bold
  span's inside resets the shared global `RE.lastIndex` to 0, and the outer
  `while ((m = RE.exec(s)))` matches the same span again, forever.
- `docmgr doc relate --file-note "$R/$G:the intern guide"` failed with
  `malformed --file-note value ".../01-blocks-...mdhe intern guide"`: zsh
  read `$G:t` as the tail modifier. Braces (`${G}:the`) fixed it.

### What I learned

- An actor's `require` wraps each file in `(function (module, exports, require) {...})`,
  so a browser IIFE that ends in `(typeof window !== "undefined" ? window : globalThis)`
  installs its global unchanged.
- Actor routes are already served on the static host (as a guest, after an
  `@guest view` check), so the live reader can be mounted on either host.
- `system.Match` already carries `Base`; the actor's `Req` only needs to
  pass it on.

### What was tricky to build

- Deciding where the administration page lives. The shell serves the
  app's `index.html` only for paths no actor route claims, and the reader
  claims `/` and `/:page`. The design puts administration in the actor as
  well (`GET /_site`, form posts), which keeps the reader free of
  JavaScript and relies on `SameSite=Lax` cookies against cross-site posts.

### What warrants a second pair of eyes

- The ownership check trusts the chunk body's `by`, as the editor does.
  The server-stamped writer of a document is not visible to actors
  (`snap()` exposes only `exists`, `path`, `id`, `version`, `data`). If the
  runtime does not force `body.by` to equal the writer, a contributor could
  forge ops for another person in the editor and in the reader alike.

### What should be done in the future

- Check in the browser whether the editor itself hits the tokenizer loop
  (phase B4), and report it upstream either way.

### Code review instructions

- Read the guide's sections 4 (fold) and 5.2 (decisions) first.
- Run `node scripts/01-load-blocks-libs.mjs <slop-computer>/web/blocks/src`.

### Technical details

- Demo data: `ws-team` has one chunk, `chunks/c-ucm0pbw-wv8ldp-0`, five
  ops, folding to the page `page_p7sq` titled "FOOBAR".
- Upload: `remarquee upload bundle <guide> --name "SLOP3-003 Blocks publishing guide" --remote-dir "/ai/2026/11/01/SLOP3-003" --toc-depth 2 --non-interactive`
  answered `OK: uploaded SLOP3-003 Blocks publishing guide.pdf -> /ai/2026/11/01/SLOP3-003`.

## Step 2: B1, the libraries and the two server changes

Phase B1 built everything the reader needs except the app itself: the two
server changes (`req.base`, a store handle's `rev()`), the vendored editor
libraries, and the four libraries of `apps/blocks-site/lib`: the fold, the
site model, the renderer and the stylesheet. The exit test,
`TestBlocksSiteLibs`, runs them in a goja actor against a fixture
workspace and checks the HTML block by block. It passed: goja folds the
same 46 ops as Node and renders a 10 kB home page. Commit `843de56`.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Implement phase B1 of the guide.

**Inferred user intent:** A server-side renderer that shows exactly what
the editor shows.

### What I did

- `pkg/actor/manager.go`: `Req.Base` (`json:"base"`); `pkg/server/actors.go`
  sets it from `res.m.Base`. `pkg/actor/modules.go`: `rev()` on the
  `use('stores').open()` handle returns `ts.Head()`.
- Copied `hypha.js`, `fruit.js`, `blocks-kit.js` from slop-computer
  `web/blocks/src` (commit 9cf5485) into `apps/blocks-site/vendor/`, with
  their three upstream checksum lines (`sha256sum -c SHA256SUMS` passes)
  and a README.
- `lib/blocks.js` loads them; `lib/fold.js` ports `Net.load`, `owns`,
  `hash32`, `roleOf`, `ensurePeer`; `lib/site.js` ports `Pages` and adds
  scope (`root`), slugs and the home page; `lib/render.js` renders blocks,
  prose, the page layout, the admin page and the static file set;
  `lib/style.js` is the stylesheet.
- `scripts/02-render-fixture.mjs` builds the fixture workspace (written to
  `pkg/server/testdata/blocks-site-fixture.json`), loads the libraries
  through a copy of the actor's `require`, renders the live and static
  pages to a directory and runs ten checks.
- `pkg/server/b1_test.go`: `blocksWorkspace` (puts the fixture into a
  `blocks` store with `docs.set`) and `TestBlocksSiteLibs`.

### Why

- The renderer's prose tokenizer copies the editor's regular expression
  source from `vendor/blocks-kit.js` at build time of `render.js`, so the
  grammar is the same; only the compile-per-call differs.
- The fixture exercises each rule of the fold: content only in the
  checkpoint, an overwritten text, a forged op, a writer's own op, a chunk
  older than the margin, a page outside the scope.

### What worked

- goja ran all three vendored libraries unchanged, including the prose
  grammar's lookbehind `(?<=\s)`.
- The Go test passed on its first run; `-v` confirmed it did the work:
  `rev 2, 46 ops, index.html 10420 bytes`.

### What didn't work

- The first harness run failed in `blocks-kit.js` with
  `TypeError: Cannot read properties of undefined (reading 'POS')`.
  `hypha.js` ends with
  `if (typeof module !== "undefined" && module.exports) module.exports = Hypha; else root.Hypha = Hypha;`,
  and the actor's `require` passes a `module`, so no global was set.
  `lib/blocks.js` now installs it: `globalThis.Hypha = globalThis.Hypha || require('../vendor/hypha.js')`.
- One harness check failed on a wrong expectation: from `care/index.html`
  the home page is `../`, not `./`.
- The first screenshot showed the sidebar links in the accent colour: the
  rule `a:not(.mention):not(.pagelink):not(.brand)` beat `.side a`. It is
  now scoped to `article a`.

### What I learned

- In the fixture, `stat skeins` resolves `skeins` from the page scope
  (`weft.skeins`), because `viewBase("weft.ui.19")` is `weft`. Values for
  a page's formulas belong under the page.

### What was tricky to build

- Lists: the editor stores each bullet as its own block; HTML needs one
  `<ul>` around a run of them. `blocks()` groups consecutive items of the
  same list kind, and nested items go inside their `<li>`.

### What warrants a second pair of eyes

- `render.js` escapes every workspace string with `esc()`, including
  attributes; the CSP is the second line of defence. Review every template
  literal in `block()`, `prose()` and `adminPage()` for an unescaped
  interpolation.

### What should be done in the future

- Nothing for B1.

### Code review instructions

- `apps/blocks-site/lib/fold.js` side by side with `blocks.js` `Net.load`.
- `GOWORK=off go test ./pkg/server -run TestBlocksSiteLibs -count=1 -v`.
- `node scripts/02-render-fixture.mjs <repo> <out>` and open `<out>/static/index.html`.

### Technical details

- Fixture peers: Ada is `usr_ada`, Mallory `usr_mallory`; Mallory's chunk
  holds one op under her own peer and one under Ada's (`FORGED BY MALLORY`).
- Static output for the fixture with `root: weft`: `index.html`,
  `care/index.html`, `faq/index.html`.

## Step 3: B2, the live reader

The reader is `apps/blocks-site/app.json` plus `actor.js`: three routes
(`GET /`, `GET /:page`, and `GET /*` so that deeper paths are a 404 page
rather than the shell), a fold cache keyed on the workspace's rev, a site
model cache keyed on the settings document, and response headers (CSP,
`Cache-Control: private, no-cache`, `Referrer-Policy`). The exit test,
`TestBlocksSiteReader`, passed on its first run. Commit `bb18f4c`.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Implement phase B2 of the guide.

**Inferred user intent:** A public page for a workspace that shows
content and nothing of the editor.

### What I did

- `app.json`: type `blocks-site`, actor `actor.js`, capability `db`, module
  `workshop` (used in B3).
- `actor.js`: `current()` opens the binding, compares `rev()` with the
  cached fold, refolds on change, rebuilds the site model when
  `site/config` changes; `show()` renders the home page, a page by slug,
  a 302 for a page id or the home page's slug, a 404 page, or a 503 page
  when the binding or grant is missing (details for the site's admins
  only).
- `render.bare()` for the 503 page.
- `pkg/server/b2_test.go`: `installBlocksSite`, `blocksSite` and
  `TestBlocksSiteReader`.

### Why

- `GET /*` keeps the shell out: without it, `/pub/site/a/b` would load the
  shell, which would look for an `index.html` the app does not have.
- The 503 page hides the binding error from guests: "no binding for
  source on weft-site" names stores a guest has no business knowing.

### What worked

- The test covers: 404 without a grant on the site; 200 with `@guest view`
  on the site only (the workspace stays private); the CSP has no `script`
  source; no op ids, paths, writer ids or overwritten text in the HTML;
  absolute links under `/pub/weft-site`; the home slug and a page id
  redirect; an edit (a new chunk) shows on the next request; `root` scope
  makes `drafts` a 404 and strips its mention; the same site mounted on
  the static host answers as a guest with links under `/r/weft-site`.
- `app.status` reports the app healthy without an `index.html`.

### What didn't work

- Nothing failed in this phase.

### What I learned

- The static host serves actor routes after its own `@guest view` check,
  so a reader can be sessionless and cacheable with no extra code.

### What was tricky to build

- The cache has two keys. Refolding is the expensive part and depends only
  on the workspace's rev; the site model depends on the settings too. A
  settings change rebuilds the model from the cached kernel.

### What warrants a second pair of eyes

- The cache lives in actor memory with no bound: one kernel per site. A
  very large workspace costs its whole tree in memory per site bound to it.

### What should be done in the future

- Measure fold time on a large workspace (thousands of ops) against the
  5-second turn limit.

### Code review instructions

- `apps/blocks-site/actor.js` (short); `pkg/server/b2_test.go`.
- `GOWORK=off go test ./pkg/server -run TestBlocksSite -count=1`.

### Technical details

- Reader response headers: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  `Cache-Control: private, no-cache`, `Referrer-Policy: same-origin`.

## Step 4: B3, static publishing and the settings page

B3 added the three actions (`status`, `configure`, `publish`), the
settings page `GET /_site` with its two form posts, and one server rule
the forms turned out to need: on the live host, an unsafe cross-origin
request to an actor route is served as a guest. `TestBlocksSitePublish`
passes, and fails when the rule is removed. The full suite passes.
Commit `d065c7c`.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** Implement phase B3 of the guide.

**Inferred user intent:** An editor publishes a snapshot with one click,
or pushes a draft and reviews it in the Workshop.

### What I did

- `actor.js`: `configure` (title, home, root, to; validated; empty clears),
  `publish` (`use('workshop')` per call, `render.staticFiles`, `w.push`,
  `w.publish` when live, record in `site/published`), `status`; routes
  `GET /_site` (admin), `POST /_site`, `POST /_publish` (admin; 303 back
  with a note built from known codes and validated values only); a small
  `application/x-www-form-urlencoded` parser.
- `render.adminPage`: a warning when the app is not trusted with the
  workshop module.
- `pkg/server/live.go`: `crossOrigin(r)`; the actor-route branch of
  `serveLive` drops the session principal for unsafe cross-origin
  requests.
- `pkg/server/b3_test.go`: `site.page` (a text-body request with the
  site's cookies) and `TestBlocksSitePublish`.
- The guide gained section 6.3 and the corrected reasoning in 5.2.

### Why

- The guide's first argument for the forms was `SameSite=Lax`. Writing
  the test showed the hole: Lax keys on the registrable domain, and the
  sandbox origins share it with the live host. An app page could post to
  `/_publish` with the visitor's session. `/_site/*` endpoints already
  refuse such requests (`sameOrigin`); actor routes did not.

### What worked

- Publishing as the visitor: the same `publish` call answers
  `permission_denied` for a member who is admin of the site but not of the
  static store, with no extra check in the app.
- The static host's existing slash redirect (`/s/weft-static/care` → 308
  `/s/weft-static/care/`) made relative links work unchanged.

### What didn't work

- `h.personOf` does not exist in the harness; tests get an id with
  `h.call(token, "whoami", nil)`.
- `h.fail(..., "")` expects an empty error code; the call answered
  `permission_denied` (`this needs admin; you have view`), which is the
  right answer, so the test now names it.
- Negative control: with `pr = nil` disabled in `serveLive`, the test
  fails with `a cross-origin form post (map[Origin:http://x1.sbx.localhost Sec-Fetch-Site:same-site]) was accepted`.

### What I learned

- `ctx.fail` throws an `Error` with `.code`, and rejected module calls
  carry `.code` too, so an http route can catch and translate both.

### What was tricky to build

- Notes after a redirect. The query string is attacker-controlled, so the
  page never prints free text from it: `m=published` needs a numeric `n`
  and a store-shaped `to`, errors map from a fixed set of codes.

### What warrants a second pair of eyes

- `crossOrigin` trusts browsers to send `Sec-Fetch-Site` or `Origin` on
  unsafe requests. Both are sent by current browsers on form posts; an old
  browser that sends neither is treated as same-origin, as `sameOrigin`
  already does.

### What should be done in the future

- The Workshop could list a draft's origin ("pushed by team-site") so a
  reviewer knows it came from Blocks.

### Code review instructions

- `apps/blocks-site/actor.js` (`publish`, `note`, the routes),
  `pkg/server/live.go` (`crossOrigin`).
- `GOWORK=off go test ./pkg/server -run TestBlocksSite -count=1`; `GOWORK=off go test ./... -count=1`.

### Technical details

- Static output for the fixture: 3 files; the test pushes a live
  publication, then a draft (main unchanged, `files.cat --at draft` shows
  the edit), then a live publication from the form.
