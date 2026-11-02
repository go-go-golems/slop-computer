import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = 'dist', shots = 'test/shots';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await pg.goto(`http://127.0.0.1:${srv.address().port}/`);
await pg.waitForSelector('.bar');
const tab = (n) => pg.locator('.dtab .lbl', { hasText: new RegExp('^' + n) }).first();
const tilesInfo = () => pg.evaluate(() => [...document.querySelectorAll('.tile[data-tile]')].map(t => { const r = t.getBoundingClientRect(); return `${[...t.querySelectorAll('.dtab .lbl')].map(x => x.textContent).join(',')} @${r.x|0},${r.y|0} ${r.width|0}x${r.height|0}`; }));
// console state survives a move
await tab('Console').click();
await pg.locator('.conin input').fill('stores'); await pg.locator('.conin input').press('Enter'); await pg.waitForTimeout(400);
const drag = async (from, x, y, shot) => {
  const bb = await from.boundingBox();
  await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await pg.mouse.down();
  await pg.mouse.move(bb.x + bb.width / 2 + 20, bb.y + bb.height / 2 + 10, { steps: 3 });
  await pg.mouse.move(x, y, { steps: 8 });
  if (shot) await pg.screenshot({ path: `${shots}/${shot}.png` });
  const label = await pg.locator('.drag-ghost').textContent().catch(() => null);
  await pg.mouse.up(); await pg.waitForTimeout(400);
  return label;
};
// 1. Agent onto the bottom edge of the left tile → split bottom
const left = await pg.locator('.tile[data-tile]').first().boundingBox();
console.log('ghost:', await drag(tab('Agent'), left.x + left.width / 2, left.y + left.height - 30, '15-drag-split'));
console.log('after split:', await tilesInfo());
// 2. Console into the left tile's strip, between Start here and Site
const site = await tab('Site').boundingBox();
console.log('ghost:', await drag(tab('Console'), site.x + 3, site.y + site.height / 2, '16-drag-tabs'));
console.log('after move:', await tilesInfo());
console.log('console lines kept:', (await pg.locator('.conout').innerText()).includes('blog'));
// 3. Turns into the middle of the agent tile → join
const ag = await pg.locator('.tile[data-tile]', { has: pg.locator('.dtab .lbl', { hasText: /^Agent/ }) }).boundingBox();
console.log('ghost:', await drag(tab('Turns'), ag.x + ag.width / 2, ag.y + ag.height / 2));
console.log('after join:', await tilesInfo());
// 4. close Access, reopen via +
await pg.locator('.dtab', { has: pg.locator('.lbl', { hasText: /^Access/ }) }).hover();
await pg.locator('.dtab', { has: pg.locator('.lbl', { hasText: /^Access/ }) }).locator('.x').click();
console.log('after close:', await tilesInfo());
// gutter drag
const g = await pg.locator('.gutter.row').first().boundingBox();
await pg.mouse.move(g.x + 1, g.y + 200); await pg.mouse.down(); await pg.mouse.move(g.x - 200, g.y + 200, { steps: 5 }); await pg.mouse.up();
console.log('after gutter:', await tilesInfo());
await tab('Site').click(); await pg.waitForTimeout(1500);
console.log('site frame posts:', await pg.frameLocator('.frame iframe').first().locator('#posts li h3').count());
await pg.screenshot({ path: `${shots}/17-dock-after.png` });
await pg.reload(); await pg.waitForSelector('.bar'); await pg.waitForTimeout(600);
console.log('after reload:', await tilesInfo());
const plus = pg.locator('.tile[data-tile]').last().locator('.tabact.plus'); await plus.click();
console.log('plus menu:', await pg.locator('.tile .rel > .menu').innerText());
console.log('errors:', errs);
await b.close(); srv.close();
