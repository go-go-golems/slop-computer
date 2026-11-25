import fs from 'node:fs';
import http from 'node:http';
import { base, browser, person, open, frameText, shot, emit, sl, LIVE } from '../browse.mjs';
const st = base('/inbox');
if (st) {
  const r = sl('mount', 'routes', `apps.localhost:${process.env.PORT}`, '/inbox');
  emit('the mount has routes (for the judge)', true, JSON.stringify(r).slice(0, 300));
  // the address the assistant gave: the last URL on this server in its
  // replies (any turn: a follow-up may not repeat it), else in the final one
  let said = process.env.FINAL || '';
  try { said = JSON.parse(fs.readFileSync('run.json', 'utf8')).turns.map((t) => t.reply || '').join('\n') + '\n' + said; } catch {}
  const urls = said.match(/https?:\/\/[a-z.]*localhost:\d+\/[^\s`'")\]*]*/g) || [];
  const target = urls.filter((u) => !/\/inbox\/?$/.test(u)).at(-1) || urls.at(-1);
  let ok = false, detail = 'no address in the final reply';
  if (target) {
    const u = new URL(target);
    // node:http, not fetch: fetch drops a Host header set by hand, and the
    // server answers 421 for a host it does not serve (the first version
    // of this check could not pass).
    const res = await new Promise((done) => {
      const body = JSON.stringify({ name: 'Rita Checker', message: 'webhook probe 4711' });
      const rq = http.request({ host: '127.0.0.1', port: process.env.PORT, path: u.pathname + u.search, method: 'POST', headers: { Host: u.host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (r) => { r.resume(); r.on('end', () => done({ status: r.statusCode })); });
      rq.on('error', (e) => done({ status: e.message }));
      rq.end(body);
    });
    detail = `POST ${target} → ${res.status}`;
    ok = typeof res.status === 'number' && res.status < 300;
  }
  emit('a POSTed submission is accepted', ok, detail);
  const b = await browser();
  const c = await person(b, 'ana@example.com'); const p = await open(c, '/inbox', 4000); const t = await frameText(p);
  emit('the page shows the submission', /webhook probe 4711|Rita Checker/.test(t), t.slice(0, 300));
  await shot(p, 'member-ana');
  await b.close();
}
