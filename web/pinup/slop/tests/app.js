// Pinup apps: compile the example design into an app page and run the
// compiled page's runtime against boot data the way slop serves it.
//   node slop/build.js && node slop/tests/app.js
// Needs playwright (require('playwright')); see web/pinup/README.md.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '../..');
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

// The slop bundle with its outer function removed, so the test can reach
// Pinup's and the slop modules' functions from page.evaluate.
const built = fs.readFileSync(path.join(root, 'dist/slop/index.html'), 'utf8');
const open = "<script>\n(function () {\n'use strict';\n", close = '\n})();\n</script>';
if (!built.includes(open) || !built.endsWith(close + '\n</body>\n</html>\n')) throw new Error('unexpected dist/slop/index.html shape');
fs.writeFileSync(path.join(out, 'harness.html'), built.replace(open, '<script>\n').replace(close + '\n</body>', '\n</script>\n</body>'));
const runtimeJS = fs.readFileSync(path.join(root, '../../pkg/render/assets/runtime.js'), 'utf8');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const runs = [
  { id: '7', path: 'runs/7.json', title: 'Harbour 10K', distance: 10, date: '2026-11-02' },
  { id: '8', path: 'runs/8.json', title: 'Sunrise 5K', distance: 5, date: '2026-11-01' },
];
let failed = 0;
const check = (ok, what, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + what + (ok || extra === undefined ? '' : ' — ' + JSON.stringify(extra))); if (!ok) failed++; };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.goto('file://' + path.join(out, 'harness.html'));
  await p.waitForTimeout(500);
  const res = await p.evaluate(async png => {
    await loadExample();
    const fr = name => allFrames().find(f => f.name === name);
    const W = fr('Welcome'), H = fr('Home'), R = fr('Run detail');
    // A list screen: a frame repeated once per run, linking to the run.
    const im = await importHTML('<div data-name="Runs" style="display:flex;flex-direction:column;gap:12px;width:390px;padding:24px;background:#ffffff"><span data-name="Heading" style="font-size:24px">All runs</span><div data-name="List" style="display:flex;flex-direction:column;gap:8px"><div data-name="Card" style="display:flex;flex-direction:column;padding:12px;background:#eeeeee"><span data-name="T">{{title}}</span><span data-name="D">{{distance}} km</span></div><div data-name="Sample" style="padding:12px;background:#eeeeee"><span>sample copy</span></div></div></div>', { page: W.page, x: 1400, y: 0, width: 390 });
    const L = get(im.ids[0]);
    const list = descendants(L.id).find(n => n.name === 'List'), card = descendants(L.id).find(n => n.name === 'Card');
    const title = descendants(R.id).find(n => n.type === 'text' && n.name === 'Title');
    patchMany([[W.id, { route: '/' }], [H.id, { route: '/home' }], [R.id, { route: '/runs/:id', record: 'runs' }], [L.id, { route: '/runs' }],
      [list.id, { repeat: { from: 'runs', sort: 'date' } }], [card.id, { link: { to: R.id, on: 'click' } }], [title.id, { text: '{{title}}' }]]);
    commit([{ id: 'img1', before: null, after: { id: 'img1', type: 'rect', page: L.page, parent: L.id, z: 99, x: 0, y: 0, w: 40, h: 40, name: 'Logo', fills: [{ t: 'image', src: png, fit: 'cover' }] } }]);
    setFile({ app: { page: 'pace', host: 'site.localhost', base: '/pace', data: { runs: 'data-runs' } } });
    SLOP.file = 'design-test';
    const chk = slopAppCheck();
    const c = await slopAppCompile(chk, 7);
    // a duplicate path is refused
    patch(L.id, { route: '/home' });
    const dup = slopAppCheck().errors;
    patch(L.id, { route: '/runs' });
    return { errors: chk.errors, warnings: chk.warnings, dup, files: Object.keys(c.files), html: c.files['index.html'], manifest: c.manifest, app: c.app,
      paths: [slopAppPath('Runs/'), slopAppPath(''), slopAppJoin('/', '/x'), slopAppJoin('/a', '/'), slopAppJoin('/a', '/b/:id')],
      valid: [slopAppValidPath('/runs/:id', true), slopAppValidPath('/runs/:id', false), slopAppValidPath('/Bad', true), slopAppValidPath('/a b', true)] };
  }, PNG);
  check(!res.errors.length, 'no compile errors', res.errors);
  check(res.dup.some(e => /same path \/home/.test(e)), 'duplicate paths are refused', res.dup);
  check(JSON.stringify(res.paths) === JSON.stringify(['/Runs', '/', '/x', '/a', '/a/b/:id']), 'path normalisation and joins', res.paths);
  check(JSON.stringify(res.valid) === JSON.stringify([true, false, false, false]), 'path validation', res.valid);
  check(res.manifest.pinup.design === 'design-test' && res.manifest.pinup.version === 7 && res.manifest.reads.runs === 'data-runs', 'manifest links the design and reads the data', res.manifest);
  check(res.app.screens.map(s => s.route).sort().join(' ') === '/ /home /runs /runs/:id', 'four screens', res.app.screens);
  const img = res.files.find(f => /^i-[0-9a-f]{16}\.png$/.test(f));
  check(!!img && res.html.includes(`url("${img}")`), 'the data: image became a file the CSS names', res.files);
  check(res.html.includes('href="/pace/home"'), 'Welcome’s button links to /pace/home');
  check(res.html.includes('data-href="/pace/runs/{{id}}"'), 'cards link to the record screen through {{id}}');
  check(res.html.includes('data-repeat="runs"') && !res.html.includes('sample copy'), 'the list repeats its first child only');
  check((res.html.match(/<template id="s-/g) || []).length === 4, 'one template per screen');
  const classes = [...res.html.matchAll(/^\.([a-z0-9-]+) \{/gm)].map(m => m[1]);
  check(classes.length === new Set(classes).size, 'class names are unique across screens', classes.length);
  fs.writeFileSync(path.join(out, 'app.html'), res.html);

  // The compiled page as the server would serve it: boot data and runtime.js
  // injected after <head>.
  const serve = async (reqPath, mode = 'site') => {
    const boot = { route: { host: 'site.localhost', path: reqPath, params: {} }, data: { runs }, version: { artifact: 'pace', n: 1 }, mode };
    const f = path.join(out, 'page.html');
    fs.writeFileSync(f, res.html.replace('<head>', '<head><script type="application/json" id="slop-boot">' + JSON.stringify(boot).replace(/</g, '\\u003c') + '</script><script>' + runtimeJS + '</script>'));
    await p.goto('file://' + f);
    return p.evaluate(() => ({ title: document.title, text: document.body.innerText, links: [...document.querySelectorAll('main a')].map(a => a.getAttribute('href')), templates: document.querySelectorAll('main template').length, bg: document.body.style.background }));
  };
  let r = await serve('/pace');
  check(r.title.startsWith('Welcome') && r.links.includes('/pace/home'), '/pace shows Welcome with a link to /pace/home', r);
  check(!!r.bg, 'the screen’s fill colours the page', r.bg);
  await p.screenshot({ path: path.join(out, 'app-welcome.png') });
  r = await serve('/pace/home');
  check(r.title.startsWith('Home') && r.links.includes(null), '/pace/home shows Home; the card’s record link has no id there, so it has no href', r.links);
  await p.screenshot({ path: path.join(out, 'app-home.png') });
  r = await serve('/pace/runs/');
  check(r.text.indexOf('Sunrise 5K') >= 0 && r.text.indexOf('Sunrise 5K') < r.text.indexOf('Harbour 10K'), '/pace/runs lists both runs, sorted by date', r.text);
  check(r.text.includes('5 km') && !r.text.includes('{{') && !r.text.includes('sample copy') && r.templates === 0, 'placeholders filled, sample dropped, templates gone', r);
  check(JSON.stringify(r.links) === JSON.stringify(['/pace/runs/8', '/pace/runs/7']), 'each card links to its run', r.links);
  await p.screenshot({ path: path.join(out, 'app-runs.png') });
  r = await serve('/pace/runs/8');
  check(r.title === 'Sunrise 5K · Pace Club' && r.text.includes('Sunrise 5K'), '/pace/runs/8 shows that run', r);
  await p.screenshot({ path: path.join(out, 'app-run-8.png') });
  r = await serve('/pace/runs/99');
  check(r.title === 'Not found', 'an unknown record is not found on the site', r.title);
  r = await serve('/pace/runs/99', 'preview');
  check(r.title === 'Harbour 10K · Pace Club', 'previews fall back to the first record', r.title);
  r = await serve('/elsewhere');
  check(r.title === 'Not found', 'a path outside the app is not found', r.title);
  r = await serve('/elsewhere', 'preview');
  check(r.title.startsWith('Welcome'), 'previews fall back to the start screen', r.title);
  check(!errs.length, 'no page errors', errs);
  await b.close();
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
