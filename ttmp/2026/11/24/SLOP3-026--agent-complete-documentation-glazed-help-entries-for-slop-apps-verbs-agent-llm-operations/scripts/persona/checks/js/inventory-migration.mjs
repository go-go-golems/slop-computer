import { base, browser, person, open, frameText, shot, emit, sl, EXPECTED } from '../browse.mjs';
const st = base('/inventory');
if (st) {
  const m = sl('app', 'status', st, '--migrations');
  const mig = JSON.stringify(m.migrations || m);
  emit('a new migration; the original kept', /001_items/.test(mig) && /00[2-9]_/.test(mig), mig.slice(0, 300));
  const q = sl('sql', 'query', st, 'SELECT * FROM items ORDER BY name');
  const rows = Array.isArray(q) ? q : (q.rows || []);
  const names = rows.map((r) => r.name), want = EXPECTED.items || [];
  emit('the 6 items and their quantities are kept', want.every((n) => names.includes(n)) && rows.find((r) => r.name === 'screws')?.qty == 500, JSON.stringify(rows).slice(0, 300));
  const col = rows[0] && Object.keys(rows[0]).find((k) => /shelf|location|place|bin/i.test(k));
  emit('a shelf column exists', !!col, rows[0] ? Object.keys(rows[0]).join(', ') : JSON.stringify(q).slice(0, 200));
  const b = await browser();
  const c = await person(b, 'ana@example.com'); const p = await open(c, '/inventory', 3500); const t = await frameText(p);
  emit("the page shows the items with 'unknown' shelves", want.every((n) => t.includes(n)) && /unknown/i.test(t), t.slice(0, 300));
  await shot(p, 'member-ana');
  emit('no page errors', !c.errors.some((e) => /pageerror/.test(e)), c.errors.join(' | '));
  await b.close();
}
