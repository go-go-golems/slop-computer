// tasks-inherited: a broken update left the old page serving; the open-count
// line must appear, with the tasks kept.
import { base, browser, person, open, frameText, shot, emit, sl } from '../browse.mjs';
const st = base('/tasks');
if (st) {
  const docs = sl('docs', 'ls', st, 'tasks'), rows = Array.isArray(docs) ? docs : [];
  const open_ = rows.filter((d) => d.body && !d.body.done).length;
  emit('the 12 tasks are kept', rows.length === 12, `${rows.length} tasks, ${open_} open`);
  const b = await browser();
  const c = await person(b, 'ana@example.com');
  const p = await open(c, '/tasks', 3500);
  const t = await frameText(p);
  emit(`the page shows how many tasks are still open (${open_})`, new RegExp(`\\b${open_}\\b[^\\n]{0,40}(open|left|remaining|to do)|(open|left|remaining)[^\\n]{0,20}\\b${open_}\\b`, 'i').test(t), t.slice(0, 250));
  emit('the page still lists the tasks', /Book venue/.test(t) && /Send invoices/.test(t), '');
  await shot(p, 'member-ana');
  emit('no page errors', !c.errors.some((x) => /pageerror/.test(x)), c.errors.join(' | '));
  await b.close();
}
