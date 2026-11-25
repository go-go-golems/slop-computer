import { base, browser, person, open, frameText, shot, emit, sl, LIVE } from '../browse.mjs';
const st = base('/inbox');
if (st) {
  const r = sl('mount', 'routes', `apps.localhost:${process.env.PORT}`, '/inbox');
  emit('the mount has routes (for the judge)', true, JSON.stringify(r).slice(0, 300));
  // the address the assistant gave: the last URL on this server in its final reply
  const urls = (process.env.FINAL || '').match(/https?:\/\/[a-z.]*localhost:\d+\/[^\s`'")\]]*/g) || [];
  const target = urls.find((u) => !/\/inbox\/?$/.test(u)) || urls[0];
  let ok = false, detail = 'no address in the final reply';
  if (target) {
    const u = new URL(target);
    const res = await fetch(`http://127.0.0.1:${process.env.PORT}${u.pathname}${u.search}`, { method: 'POST', headers: { Host: u.host, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rita Checker', message: 'webhook probe 4711' }) }).catch((e) => ({ status: e.message }));
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
