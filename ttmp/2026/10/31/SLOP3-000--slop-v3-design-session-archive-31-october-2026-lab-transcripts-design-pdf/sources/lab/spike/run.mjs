import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = process.argv[2]; const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const port = srv.address().port;
const b = await chromium.launch(); const pg = await b.newPage();
pg.on('console', m => console.log('console:', m.text())); pg.on('pageerror', e => console.log('pageerror:', e.message));
await pg.goto(`http://127.0.0.1:${port}/`);
try { await pg.waitForFunction(() => window.__done, null, { timeout: Number(process.env.T || 60000) }); console.log(JSON.stringify(await pg.evaluate(() => window.__done), null, 1)); }
catch (e) { console.log(JSON.stringify({ error: 'TIMEOUT', log: await pg.evaluate(() => window.__log || []) }, null, 1)); }
await b.close(); srv.close();
