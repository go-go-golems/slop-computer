// The Workshop's Files view: an admin looks at a snapshot's files, adds a
// file (replacing style.css), removes one, and pushes a folder; each push is
// a new draft and the static host keeps serving main.
//
//   SLOP_CREDENTIALS=<admin creds> NODE_PATH=<playwright node_modules> \
//     node 05-workshop-files-e2e.mjs <slop binary> <work dir> [shots-dir]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const LIVE = 'http://apps.localhost:18300';
const STATIC = 'http://site.localhost:18300';
const [SLOP, WORK, shots = '.'] = process.argv.slice(2);
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };
const cli = (...a) => JSON.parse(execFileSync(SLOP, [...a, '-o', 'json'], { encoding: 'utf8' }));
async function until(fn, timeout, every = 200) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}

// Start from a known draft: index.html and style.css (repeatable runs).
const base = `${WORK}/wsite-base`;
mkdirSync(base, { recursive: true });
writeFileSync(`${base}/index.html`, '<!doctype html><title>Weft</title><link rel="stylesheet" href="style.css"><h1>Weft, spun slowly</h1><a class="cta" href="#buy">Buy a skein</a>');
writeFileSync(`${base}/style.css`, '.cta{background:#1f3a8a;color:#fff;padding:.7rem 1.2rem}');
cli('push', base, '--store', 'wsite', '--ref', 'draft', '-m', 'start of the files check');

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const tab = await ctx.newPage();
  const errors = [];
  tab.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await tab.goto(LIVE + '/workshop');
  await tab.click('#me a:has-text("Sign in")');
  await tab.fill('input[name=email]', 'admin@example.com');
  await tab.fill('input[name=name]', 'Ada Admin');
  await Promise.all([tab.waitForURL(/\/workshop/), tab.click('button')]);
  errors.splice(0);
  const wf = await (await tab.waitForSelector('iframe')).contentFrame();
  await wf.click('#stores li[data-store="wsite"]', { timeout: 15000 });
  await wf.waitForSelector('#snaps li.on', { timeout: 10000 });
  const mainBefore = await (await ctx.request.get(`${STATIC}/wsite/index.html`)).text();

  await wf.click('#v-files');
  await wf.click('#flist li[data-path="index.html"]', { timeout: 8000 });
  const shown = await until(async () => (await wf.locator('#fview').innerText()).includes('<h1>'), 5000);
  check(shown, 'files: index.html of the selected snapshot is shown, read-only');

  // Add files: replace style.css (selected first, so the root folder).
  await wf.click('#flist li[data-path="style.css"]');
  const before = await wf.locator('#snaps li.on').getAttribute('data-n');
  await wf.fill('#fmsg', 'green button');
  await wf.setInputFiles('#fadd', { name: 'style.css', mimeType: 'text/css', buffer: Buffer.from('body{font:18px Georgia;margin:3rem auto;max-width:36rem}.cta{display:inline-block;padding:.7rem 1.2rem;background:#1b7f3b;color:#fff;text-decoration:none}') });
  const after = await until(async () => {
    const n = await wf.locator('#snaps li.on').getAttribute('data-n');
    return n !== before && (await wf.locator('#fview').innerText()).includes('#1b7f3b') ? n : '';
  }, 8000);
  check(!!after, `add files: style.css replaced, new draft #${after} (was #${before}), shown in the viewer`);
  await tab.screenshot({ path: `${shots}/workshop-files.png` });
  await wf.click('#v-preview');
  const green = await until(async () => {
    const f = await (await wf.waitForSelector('#frame')).contentFrame();
    return (await f.evaluate(() => getComputedStyle(document.querySelector('.cta')).backgroundColor)) === 'rgb(27, 127, 59)';
  }, 8000);
  check(green, `preview of #${after} shows the green button`);

  // Remove a file: add notes.txt, then remove it (confirmed in the page).
  await wf.click('#v-files');
  await wf.click('#flist li[data-path="index.html"]');
  await wf.setInputFiles('#fadd', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('scratch') });
  await wf.click('#flist li[data-path="notes.txt"]', { timeout: 8000 });
  await wf.click('#frm');
  await wf.click('#fcyes:has-text("Remove")');
  const gone = await until(async () => (await wf.locator('#flist li[data-path="notes.txt"]').count()) === 0 && (await wf.locator('#flist li').count()) > 0, 8000);
  check(gone, 'remove: notes.txt is gone in the next draft');

  // Push a folder: its files become the whole tree.
  const dir = `${WORK}/wsite-folder`;
  mkdirSync(`${dir}/css`, { recursive: true });
  writeFileSync(`${dir}/index.html`, '<!doctype html><link rel="stylesheet" href="css/site.css"><h1>Weft, from a folder</h1><a class="cta" href="#">Buy a skein</a>');
  writeFileSync(`${dir}/css/site.css`, '.cta{background:#7a2a8a;color:#fff;padding:.5rem}');
  await wf.setInputFiles('#fdir', dir);
  await wf.click('#fcyes:has-text("Push folder")', { timeout: 5000 });
  const tree = await until(async () => {
    const paths = await wf.locator('#flist li').evaluateAll((ls) => ls.map((l) => l.dataset.path));
    return paths.includes('css/site.css') && !paths.includes('style.css') ? paths : null;
  }, 8000);
  check(!!tree, `push a folder: the tree is now ${tree && tree.join(', ')}`);
  const mainAfter = await (await ctx.request.get(`${STATIC}/wsite/index.html`)).text();
  check(mainAfter === mainBefore, 'the static host still serves main: nothing was published');
  check(errors.length === 0, `no console errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
