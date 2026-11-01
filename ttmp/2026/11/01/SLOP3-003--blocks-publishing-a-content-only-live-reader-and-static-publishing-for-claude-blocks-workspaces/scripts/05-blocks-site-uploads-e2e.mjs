// B5: uploaded files, end to end, on the demo server after
// 03-deploy-blocks-site.sh (and 04, which wrote the handbook page).
//
// The editor adds a "File or image" block to the handbook in Claude
// Blocks and uploads a picture through it, as a person does. The reader
// does not show it: the binding does not share uploads. The admin of the
// workspace shares them (bind set --assets true); the reader shows the
// picture and serves it, sandboxed. A publication copies it to the static
// site. An upload no published page shows is never served.
//
//   SLOP_CREDENTIALS=<admin creds> NODE_PATH=<playwright node_modules> \
//     node 05-blocks-site-uploads-e2e.mjs <slop binary> [shots-dir]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
const { chromium } = createRequire(import.meta.url)('playwright');

const LIVE = 'http://apps.localhost:18300';
const STATIC = 'http://site.localhost:18300';
const [SLOP, shots = '.'] = process.argv.slice(2);
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };
const slop = (...a) => execFileSync(SLOP, [...a, '-o', 'json'], { encoding: 'utf8' });
async function until(fn, timeout, every = 300) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}

// A 240x80 PNG in the yarn colour (a real picture, so the screenshot shows it).
function png(w, h, [r, g, b]) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const picture = png(240, 80, [200, 97, 63]);

slop('bind', 'set', 'team-site', 'source', 'ws-team'); // start without shared uploads
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
  const tab = await ctx.newPage();
  await tab.goto(LIVE + '/b/ws-team');
  await tab.click('#me a:has-text("Sign in")');
  await tab.fill('input[name=email]', 'admin@example.com');
  await tab.fill('input[name=name]', 'Ada Admin');
  await Promise.all([tab.waitForURL(/\/b\/ws-team/), tab.click('button')]);
  const ed = await (await tab.waitForSelector('iframe')).contentFrame();
  await ed.waitForSelector('#ph-ask', { timeout: 20000 });
  await ed.waitForTimeout(1000);
  // What the "File or image" block writes: a list, an upload into it, each item shown.
  await ed.click('#ph-ask');
  await ed.click('#ag-scope button[data-scope="all"]');
  await ed.fill('#ag-in', ['handbook.photos = []', 'handbook.ui.20 is h2 "In the dye house"', 'handbook.ui.21 is upload photos', 'handbook.ui.22 is each m in photos', 'handbook.ui.22.0 is file m'].join('\n'));
  await ed.waitForFunction(() => document.querySelector('#ag-send').textContent.trim() === 'Write', null, { timeout: 3000 });
  await ed.click('#ag-send');
  // Open the handbook and upload through the block's own file input.
  await ed.click('#sidebar >> text=Weft handbook').catch(() => ed.click('text=Weft handbook'));
  const input = await ed.waitForSelector('.f-upload input[type=file]', { state: 'attached', timeout: 10000 });
  await input.setInputFiles({ name: 'dye-house.png', mimeType: 'image/png', buffer: picture });
  const since = Date.now() - 1000;
  const rec = await until(async () => { // this run's upload (a rerun resets the list and uploads again)
    const docs = JSON.parse(slop('docs', 'ls', 'ws-team', 'chunks'));
    for (const d of docs) for (const o of d.body.ops) { const m = /^handbook\.photos \+= .*id: "([\w.-]+)"/.exec(o[3]); if (m && o[4] >= since) return m[1]; }
    return '';
  }, 10000, 500);
  check(!!rec, `Blocks: the picture is uploaded into the workspace (asset ${rec})`);
  await tab.screenshot({ path: `${shots}/b5-blocks-upload.png` });

  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const g = await guest.newPage();
  const home = async () => { await g.goto(LIVE + '/pub/team-site/'); return g.content(); };
  const before = await home();
  check(before.includes('In the dye house') && !before.includes('_media'), 'reader, uploads not shared: the heading shows, the picture does not');
  check((await g.request.get(`${LIVE}/pub/team-site/_media/${rec}`)).status() === 404, 'reader, uploads not shared: _media answers 404');

  slop('bind', 'set', 'team-site', 'source', 'ws-team', '--assets', 'true');
  const after = await home();
  check(after.includes(`<img src="/pub/team-site/_media/${rec}" alt="dye-house.png"`), 'reader, uploads shared: the page shows the picture');
  // loading="lazy": bring it into view and wait for it
  await g.locator('figure.file img').scrollIntoViewIfNeeded();
  const shown = await until(async () => g.evaluate(() => { const i = document.querySelector('figure.file img'); return i && i.complete && i.naturalWidth; }), 5000);
  check(shown === 240, `reader: the browser loads it (${shown} px wide)`);
  const r = await g.request.get(`${LIVE}/pub/team-site/_media/${rec}`);
  check(r.status() === 200 && r.headers()['content-type'] === 'image/png' && r.headers()['content-security-policy'] === "sandbox; default-src 'none'" && Buffer.compare(await r.body(), picture) === 0,
    'reader: _media sends the bytes, as image/png, sandboxed');
  await g.screenshot({ path: `${shots}/b5-reader-picture.png`, fullPage: true });

  // An upload in the workspace that no published page shows.
  const other = execFileSync(SLOP, ['files', 'ls', 'ws-team', '--zone', 'assets', '-o', 'json'], { encoding: 'utf8' });
  const ids = JSON.parse(other).map((f) => f.path).filter((p) => p !== rec);
  if (ids.length) check((await g.request.get(`${LIVE}/pub/team-site/_media/${ids[0]}`)).status() === 404, `reader: an upload no published page shows (${ids[0]}) answers 404`);

  // A publication copies it.
  await tab.goto(LIVE + '/pub/team-site/_site');
  check((await tab.locator('dd', { hasText: 'published with the pages that show them' }).count()) === 1, 'settings: uploads are shown as shared');
  await tab.fill('#to', 'team-static');
  await tab.click('button:has-text("Publish now")');
  const note = await until(async () => { const t = await tab.locator('.note').innerText(); return /Published #\d+/.test(t) ? t : ''; }, 8000);
  await g.goto(STATIC + '/s/team-static/');
  await g.locator('figure.file img').scrollIntoViewIfNeeded();
  const sshown = await until(async () => g.evaluate(() => { const i = document.querySelector('figure.file img'); return i && i.complete && i.naturalWidth === 240 ? i.getAttribute('src') : ''; }), 5000);
  check(!!note && sshown === `media/${rec}`, `static: "${note}"; the static site shows ${sshown}`);
  await g.screenshot({ path: `${shots}/b5-static-picture.png`, fullPage: true });
  await guest.close();
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
