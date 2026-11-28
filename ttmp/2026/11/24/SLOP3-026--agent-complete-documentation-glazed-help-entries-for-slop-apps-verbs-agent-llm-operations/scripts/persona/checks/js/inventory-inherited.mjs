// inventory-inherited: add anchors (25) to an inventory nobody understands.
import { base, browser, person, open, frameText, shot, emit, sl } from '../browse.mjs';
const st = base('/inventory');
if (st) {
  const q = sl('sql', 'query', st, 'SELECT * FROM items ORDER BY name');
  const rows = Array.isArray(q) ? q : (q.rows || []);
  const by = Object.fromEntries(rows.map((r) => [String(r.name).toLowerCase(), r]));
  emit('anchors, 25, is in the inventory', by.anchors && Number(by.anchors.qty) === 25, JSON.stringify(by.anchors || rows.map((r) => r.name)));
  const want = { bolts: 120, nuts: 340, washers: 75, hinges: 18, brackets: 42, screws: 500 };
  const changed = Object.entries(want).filter(([n, v]) => !by[n] || Number(by[n].qty) !== v).map(([n]) => n);
  emit('the 6 existing items are unchanged', changed.length === 0, changed.length ? 'changed or missing: ' + changed.join(', ') : '');
  emit('rows (for the judge)', true, rows.length + ' rows');
  const b = await browser();
  const c = await person(b, 'ana@example.com');
  const p = await open(c, '/inventory', 3500);
  const t = await frameText(p);
  emit('the page shows anchors and 25', /anchors[\s\S]{0,40}\b25\b/i.test(t), t.slice(0, 300));
  await shot(p, 'member-ana');
  emit('no page errors', !c.errors.some((x) => /pageerror/.test(x)), c.errors.join(' | '));
  await b.close();
}
