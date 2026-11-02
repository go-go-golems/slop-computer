import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = 'dist', shots = 'test/shots';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const p = path.join(root, u === '/' ? 'index.html' : u); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  const sample = async (input, opts) => {
    window.__lastInput = input;
    const t = opts.tools && opts.tools[0];
    const steps = [
      { command: 'tables blog' },
      { command: 'write journal sql/002_tags.sql', stdin: "ALTER TABLE posts ADD COLUMN tags TEXT NOT NULL DEFAULT '';" },
      { command: 'publish journal tags column' },
      { command: 'sql blog "SELECT id, tags FROM posts LIMIT 2"' },
    ];
    const outs = [];
    for (const s of steps) outs.push(await t.execute(s));
    const text = 'I added a migration with a **tags** column and published journal; blog activated `journal@2`.';
    opts.onText && opts.onText({ text, delta: text });
    return { text, truncated: false, outs };
  };
  window.claude = { use: async (n) => (n === 'sample' ? sample : null) };
});
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const port = srv.address().port;
await pg.goto(`http://127.0.0.1:${port}/`);
await pg.waitForSelector('.bar');
await pg.locator('.dtab .lbl', { hasText: /^Agent/ }).click();
await pg.locator('.composer textarea').fill('Add tags to journal posts');
await pg.locator('.composer .btn.primary').click();
await pg.locator('.msg.agent .md').waitFor({ timeout: 15000 });
await pg.waitForTimeout(800);
console.log('tools:', await pg.locator('details.tool .first').allTextContents());
console.log('step note:', await pg.locator('.msg.agent .note').last().textContent());
console.log('preamble starts:', (await pg.evaluate(() => JSON.stringify(window.__lastInput).slice(0, 160))));
await pg.locator('details.tool').nth(2).locator('summary').click();
await pg.screenshot({ path: `${shots}/13-agent-run.png` });
await pg.locator('.msg.agent .note button', { hasText: 'revert' }).click();
await pg.waitForTimeout(800);
console.log('after revert:', await pg.locator('.msg.agent .note').last().textContent());
// Ask mode
await pg.locator('.agent-set .seg button', { hasText: 'Ask' }).click();
await pg.locator('.composer textarea').fill('Again, with approval');
await pg.locator('.composer .btn.primary').click();
await pg.locator('details.tool.ask').first().waitFor({ timeout: 8000 });
await pg.screenshot({ path: `${shots}/14-agent-ask.png` });
await pg.locator('details.tool.ask .btn.primary').first().click();
await pg.locator('details.tool.ask .btn', { hasText: 'Decline' }).first().click({ timeout: 8000 });
await pg.locator('.msg.agent .md').nth(1).waitFor({ timeout: 8000 });
console.log('ask statuses:', await pg.locator('.msg.agent').nth(1).locator('details.tool').evaluateAll(els => els.map(e => e.className)));
// persistence
await pg.waitForTimeout(9500);
await pg.reload(); await pg.waitForSelector('.bar');
await pg.locator('.dtab .lbl', { hasText: /^Console/ }).click();
const cin = pg.locator('.conin input'); await cin.fill('stores'); await cin.press('Enter'); await pg.waitForTimeout(400);
console.log('after reload:', (await pg.locator('.conout').innerText()).split('\n').slice(-8).join('\n'));
await pg.locator('.dtab .lbl', { hasText: /^Agent/ }).click(); await pg.waitForTimeout(500);
console.log('thread after reload:', await pg.locator('.msg.user .body').allTextContents());
const [d] = await Promise.all([pg.waitForEvent('download'), pg.locator('.agent-set .btn', { hasText: 'Download' }).click()]);
console.log('thread download:', d.suggestedFilename());
console.log('save pill:', await pg.locator('.bar .pill').last().innerText());
console.log('errors:', errs);
await b.close(); srv.close();
