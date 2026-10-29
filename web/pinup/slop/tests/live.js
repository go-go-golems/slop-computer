// Pinup on slop's runtime, end to end against a running server: the
// Workshop runs Pinup on a design (/run/<design>), an agent changes it with
// `slop data`, Save version writes db.json, and a site route plays the
// saved version in static mode.
//   SLOP_SERVER=http://localhost:8080 SLOP_TOKEN=… SLOP_BIN=slop node slop/tests/live.js <design>
// Needs pinup and pinup-player pushed, pinup's version approved, the
// design created with app = pinup, local mode (nickname sign-in).
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const base = process.env.SLOP_SERVER || 'http://localhost:8080';
const design = process.argv[2] || 'design-live';
const slop = (...args) => JSON.parse(execFileSync(process.env.SLOP_BIN || 'slop', args, { encoding: 'utf8' }));
const slopText = (...args) => execFileSync(process.env.SLOP_BIN || 'slop', args, { encoding: 'utf8' });
let failed = 0;
const check = (ok, what, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + what + (ok || extra === undefined ? '' : ' — ' + JSON.stringify(extra).slice(0, 400))); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 10000) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch {} await sleep(250); } return v; }

(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const r = await ctx.request.post(base + '/auth/local', { form: { nickname: 'manuel' }, headers: { Origin: base }, maxRedirects: 0 });
  check(r.status() === 303, 'signed in');
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.googleapis.com/**', x => x.abort());

  // Pinup opened on itself offers the designs of this app.
  await p.goto(base + '/run/pinup');
  let fr = await (await p.waitForSelector('iframe', { timeout: 15000 })).contentFrame();
  const rows = await until(async () => { const t = await fr.$$eval('.slop-design b', bs => bs.map(x => x.textContent)); return t.length ? t : null; });
  check(rows && rows.includes('Live test'), 'Pinup on itself lists the designs that run it', rows);
  await fr.click('.slop-design');
  const moved = await until(() => new URL(p.url()).pathname === '/run/' + design);
  check(moved, 'clicking a design opens it in the Workshop (/run/' + design + ')', p.url());
  await sleep(500);

  // Pinup on the design: the slop menu is there, storage is shared.
  fr = await (await p.waitForSelector('iframe', { timeout: 15000 })).contentFrame();
  const slopBtn = await until(() => fr.$('#bSlop'), 15000);
  check(!!slopBtn, 'tool mode: the slop menu is beside Share');
  const local = await fr.evaluate(() => document.body.innerText.includes('changes stay in this browser'));
  check(!local, 'storage is the design’s db, not the browser');

  // An agent drops HTML into the inbox; the open tab imports it as layers.
  const step = 'h' + Date.now().toString(36);
  slop('data', 'set', design, 'inbox/' + step, '--data', JSON.stringify({ html: '<div data-name="Hero" style="display:flex;width:390px;height:200px;padding:24px;background:#1d4ed8"><span data-name="Title" style="color:#fff;font-size:28px">Hello from an agent</span></div>', name: 'Hero' }));
  const nodes = await until(() => { const l = slop('data', 'list', design, 'nodes'); return l.docs.some(d => d.body.name === 'Hero') ? l.docs : null; }, 20000);
  check(!!nodes, 'the inbox step became layers in the design (slop data list … nodes)', nodes && nodes.length);
  const inbox = await until(() => { const d = slop('data', 'get', design, 'inbox/' + step); return d.exists === false ? d : null; });
  check(inbox && inbox.exists === false, 'the tab deleted the inbox step after applying it', inbox);
  const shown = await until(() => fr.evaluate(() => document.body.innerText.includes('Hello from an agent')), 10000);
  check(shown, 'the layers show on the canvas');
  const file = slop('data', 'get', design, 'meta/file');
  check(file.exists && Array.isArray(file.body.pages), 'meta/file was written with the page list', file.body && Object.keys(file.body));

  // Save version: db.json carries the documents a player reads.
  await fr.click('#bSlop');
  await fr.click('text=Save version…');
  await fr.click('.sheet .btn.primary.sm, .btn.primary.sm:has-text("Save")');
  const ver = await until(() => { const v = JSON.parse(execFileSync('curl', ['-s', '-H', 'Authorization: Bearer ' + process.env.SLOP_TOKEN, base + '/api/artifacts/' + design + '/versions'], { encoding: 'utf8' })); return v.length ? v[v.length - 1] : null; });
  check(ver && ver.files['db.json'] && ver.files['file.json'] && ver.files['handoff.md'], 'Save version wrote db.json, file.json and handoff.md', ver && Object.keys(ver.files));

  // A site route plays the saved version in static mode.
  slopText('route', 'set', '--host', 'site.localhost:18140', '/proto/live/:screen', 'pinup-player', '--bind', 'target=' + design);
  slopText('route', 'set', '--host', 'site.localhost:18140', '/proto/live', 'pinup-player', '--bind', 'target=' + design);
  const site = 'http://site.localhost:18140/proto/live';
  const pl = await ctx.newPage();
  pl.on('pageerror', e => errs.push('player: ' + e.message));
  await pl.route('**/fonts.googleapis.com/**', x => x.abort());
  await pl.goto(site);
  const boot = await pl.evaluate(() => JSON.parse(document.getElementById('slop-boot').textContent));
  check(boot.mode === 'static' && boot.runtime && boot.runtime.target === design && boot.runtime.docs['meta/file'], 'the player page boots in static mode with the saved documents', boot.mode);
  const played = await until(() => pl.evaluate(() => !document.getElementById('present').hidden && document.body.innerText.includes('Hello from an agent')), 10000);
  check(played, 'the player presents the saved design');
  const ro = await pl.evaluate(async () => { const db = await claude.use('db'); try { await db.doc('nodes/x').set({ a: 1 }); return 'wrote'; } catch (e) { return e.code; } });
  check(ro === 'invalid_argument', 'static db is read-only', ro);
  check(!errs.length, 'no page errors', errs);
  await b.close();
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
