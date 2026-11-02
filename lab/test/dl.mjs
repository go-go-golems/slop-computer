import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = 'dist';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await pg.goto(`http://127.0.0.1:${srv.address().port}/`); await pg.waitForSelector('.bar');
fs.mkdirSync('test/dl', { recursive: true });
const grab = async (f) => { const [d] = await Promise.all([pg.waitForEvent('download'), f()]); const p = 'test/dl/' + d.suggestedFilename(); await d.saveAs(p); return p; };
await pg.locator('.dtab .lbl', { hasText: /^Stores/ }).click();
const row = pg.locator('tr', { hasText: 'blog' }).first();
await row.locator('button', { hasText: 'download' }).click();
const j = await grab(() => pg.locator('.menu button', { hasText: 'blog.json' }).click());
const dump = JSON.parse(fs.readFileSync(j, 'utf8'));
console.log('json:', j, Object.keys(dump), 'docs', dump.documents.length, 'posts rows', dump.tables.posts.rows.length, 'files', dump.files.length, 'log', dump.log.length);
await row.locator('button', { hasText: 'download' }).click();
const z = await grab(() => pg.locator('.menu button', { hasText: 'zipped' }).click());
console.log('zip:', z, fs.statSync(z).size);
// world export
await pg.locator('.bar .btn', { hasText: 'World' }).click();
const w = await grab(() => pg.locator('.menu button', { hasText: 'Export world' }).click());
console.log('world:', w, fs.statSync(w).size);
// console download
await pg.locator('.dtab .lbl', { hasText: /^Console/ }).click();
const c = await grab(async () => { await pg.locator('.conin input').fill('download team-board'); await pg.locator('.conin input').press('Enter'); });
console.log('console:', c);
// change something, then import the exported world and check it came back
await pg.locator('.conin input').fill('call blog draft {"title":"after export"}'); await pg.locator('.conin input').press('Enter'); await pg.waitForTimeout(300);
await pg.locator('.bar .btn', { hasText: 'World' }).click();
const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.locator('.menu button', { hasText: 'Import world' }).click()]);
await fc.setFiles(w); await pg.waitForTimeout(1500);
await pg.locator('.dtab .lbl', { hasText: /^Console/ }).click();
await pg.locator('.conin input').fill('sql blog "SELECT count(*) AS n FROM posts WHERE title = \'after export\'"'); await pg.locator('.conin input').press('Enter'); await pg.waitForTimeout(400);
console.log('after import:', (await pg.locator('.conout').innerText()).split('\n').slice(-3).join(' | '));
console.log('errors:', errs);
await b.close(); srv.close();
