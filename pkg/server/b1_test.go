package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// blocksWorkspace makes a store of type blocks holding the test workspace
// (testdata/blocks-site-fixture.json, written by SLOP3-003's
// scripts/02-render-fixture.mjs): a checkpoint, chunks after it, a forged
// op, a stale chunk.
func blocksWorkspace(t *testing.T, h *harness, token, id string) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "blocks-site-fixture.json"))
	if err != nil {
		t.Fatal(err)
	}
	var docs map[string]any
	if err := json.Unmarshal(b, &docs); err != nil {
		t.Fatal(err)
	}
	batch := []any{}
	for p, d := range docs {
		batch = append(batch, map[string]any{"path": p, "data": d})
	}
	h.call(token, "store.new", map[string]any{"id": id, "type": "blocks"})
	h.call(token, "docs.set", map[string]any{"store": id, "batch": batch})
}

const libsActor = `
const { fold } = require('./lib/fold.js');
const site = require('./lib/site.js');
const render = require('./lib/render.js');
defineActor({
  actions: {
    render(ctx, { root }) {
      const src = use('stores').open('source');
      const r = fold(src), s = site.build(r.K, { root }, src.id);
      const files = render.staticFiles(s);
      return { rev: src.rev(), ops: r.ops, pages: s.pages, home: s.home, paths: files.map((f) => f.path),
        index: files.find((f) => f.path === 'index.html').text, care: files.find((f) => f.path === 'care/index.html').text };
    },
  },
  http: { 'GET /*': { level: 'public', run(ctx, req) { return { json: { base: req.base, path: req.path } }; } } },
});
`

// B1 exit: the blocks-site libraries (the vendored editor kernel, the
// fold, the site model, the renderer) run in an actor; the fold matches
// the editor's (checkpoint, ownership, margin); the HTML holds what the
// author sees and nothing else. Also req.base and a store handle's rev().
func TestBlocksSiteLibs(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	blocksWorkspace(t, h, admin, "ws-weft")

	m := map[string]string{"app.json": `{"title":"libs","actor":"actor.js","capabilities":{"db":{}}}`, "actor.js": libsActor}
	for _, f := range appDir(t, "blocks-site") {
		f := f.(map[string]any)
		if p := f["path"].(string); strings.HasPrefix(p, "lib/") || strings.HasPrefix(p, "vendor/") {
			m[p] = f["text"].(string)
		}
	}
	h.call(admin, "store.new", map[string]any{"id": "bslibs"})
	h.call(admin, "files.push", map[string]any{"store": "bslibs", "files": files(m)})
	h.call(admin, "store.new", map[string]any{"id": "t-site", "app": "bslibs"})
	h.call(admin, "bind.set", map[string]any{"store": "t-site", "alias": "source", "target": "ws-weft"})
	h.fail(admin, "actor.call", map[string]any{"store": "t-site", "action": "render", "args": map[string]any{}}, "permission_denied")
	h.call(admin, "grant.set", map[string]any{"store": "ws-weft", "subject": "store:t-site", "level": "view"})

	out := h.call(admin, "actor.call", map[string]any{"store": "t-site", "action": "render", "args": map[string]any{"root": "weft"}}).(map[string]any)
	head := h.call(admin, "store.meta", map[string]any{"id": "ws-weft"}).(map[string]any)
	if fmtAny(out["rev"]) != fmtAny(head["head"]) {
		t.Fatalf("rev() = %v, store head = %v", out["rev"], head["head"])
	}
	if fmtAny(out["pages"]) != `["weft","care","faq"]` || out["home"] != "weft" ||
		fmtAny(out["paths"]) != `["index.html","care/index.html","faq/index.html"]` {
		t.Fatalf("pages = %v, home = %v, paths = %v", out["pages"], out["home"], out["paths"])
	}
	index, care := out["index"].(string), out["care"].(string)
	t.Logf("rev %v, %v ops, index.html %d bytes", out["rev"], out["ops"], len(index))
	for _, want := range []string{
		`<span class="pi">🧶</span>Weft</h1>`,                  // the title and icon come from the checkpoint
		`<h2 id="b0">Yarn for people who knit in public</h2>`, // so does the heading
		`<strong>small batches</strong> of <em>undyed</em> wool, <s>fast</s> slowly`,
		`<a class="mention" href="care/"><span class="i">🫧</span>Care</a>`,
		`<a href="https://example.com/shop" rel="noopener noreferrer nofollow">our shop</a>`,
		`<aside class="callout"><span class="ci" aria-hidden="true">📦</span><div class="ct">Orders ship on <strong>Mondays</strong>.</div></aside>`,
		`<nav class="toc" aria-label="On this page"><a class="l1" href="#b0">`,
		`<ul class="bullet"><li>Worsted, 200 m<ul class="bullet"><li>in three weights</li></ul></li><li class="c-blue">Fingering, 400 m</li></ul>`,
		`<ol class="numbered"><li>Pick a yarn</li><li>Pick a colour</li></ol>`,
		`<li class="done"><span class="check" aria-hidden="true">☑</span>`,
		`<blockquote>The softest yarn I own.</blockquote>`,
		`<pre><code>skeins = 12</code></pre>`,
		`<details><summary>Shipping details</summary><div class="kids"><p>Two to four days in the EU.</p></div></details>`,
		`<div class="cols"><div class="col"><p>Left column</p></div><div class="col"><p>Right column</p></div></div>`,
		`<a class="pagelink" href="care/">`,
		`We have <span class="val">12</span> skeins, <span class="val">216</span> euros of stock.`,
		`<div class="sv val">12</div><div class="sl">Skeins</div>`,
		`<progress max="100" value="40">40%</progress>`,
		`<th>name</th><th>stock</th></tr></thead><tbody><tr><td>Oat</td><td>4</td></tr>`,
		`&lt;script&gt;alert(1)&lt;/script&gt; &amp; stays text`,
		`Unpublished: <span class="mention">drafts</span>.`, // a page outside the site: its name, no link, no title
		`Mallory was here`, // her own op counts
		`<h2>Pages in this section</h2><a class="pagelink" href="faq/">`, // faq is not linked from the page: listed below it
	} {
		if !strings.Contains(index, want) {
			t.Errorf("index.html lacks %s", want)
		}
	}
	for _, gone := range []string{"OLD INTRO TEXT", "FORGED BY MALLORY", "STALE CHUNK", "NOT READY", "Drafts", "Press me", "<script>", "op00"} {
		if strings.Contains(index, gone) {
			t.Errorf("index.html holds %q", gone)
		}
	}
	if !strings.Contains(care, `<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Weft</a> / Care</nav>`) ||
		!strings.Contains(care, `<a href="../faq/">FAQ</a>`) {
		t.Errorf("care/index.html links:\n%s", care)
	}

	// req.base: the URL path the mount matched.
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/t/:id", "storeParam": "id"})
	if _, body := h.get(live, "/t/t-site/x/y"); !strings.Contains(body, `"base":"/t/t-site"`) || !strings.Contains(body, `"path":"/x/y"`) {
		t.Fatalf("route request = %s", body)
	}
}
