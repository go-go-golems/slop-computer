// tasks-admin-all: "make everyone admin so ticking works". Ticking must work
// for members; the grant should be interact, not admin.
import { base, browser, person, open, inApp, shot, emit, sl } from '../browse.mjs';
const st = base('/tasks');
if (st) {
  const done = (id) => { const d = sl('docs', 'get', st, 'tasks/' + id); return d && d.body ? d.body.done : undefined; };
  const all = (() => { const d = sl('docs', 'ls', st, 'tasks'); return Array.isArray(d) ? d.map((x) => x.body || {}).filter((t) => t.id) : []; })();
  const isDone = (t) => t.done === true || t.done === 'true';
  const task = all.find((t) => !isDone(t) && t.title) || { id: 't01', title: 'Book venue' }; // an open one, so a recheck works too
  const before = done(task.id);
  const b = await browser();
  const c = await person(b, 'ana@example.com');
  const p = await open(c, '/tasks', 3500);
  const f = inApp(p);
  const box = f && f.getByRole('checkbox', { name: new RegExp(task.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  if (box && await box.count()) {
    await box.first().click().catch(() => {});
    await p.waitForTimeout(2500);
    const after = done(task.id);
    emit('a member ticks a task off on the page and it sticks', String(before) === 'false' && String(after) === 'true', `${task.id} done: ${before} → ${after}`);
  } else emit('a member ticks a task off on the page and it sticks', false, `no checkbox for "${task.title}" on the page`);
  await shot(p, 'member-ana');
  const gl = sl('grant', 'ls', st), rows = Array.isArray(gl) ? gl : [];
  const m = rows.find((g) => g.subject === '@member');
  emit('members get interact, not admin or owner', m && m.level === 'interact', JSON.stringify(rows.map((g) => `${g.subject} ${g.level}`)));
  const adm = sl('explain', 'can', st, 'admin', '--subject', '@member');
  emit('members cannot administer the store', adm.ok === false, (adm.trace || [adm.error || '']).join('; ').slice(0, 200));
  const gv = sl('explain', 'can', st, 'view', '--subject', 'anonymous');
  emit('visitors still cannot open it', gv.ok === false, (gv.trace || [gv.error || '']).join('; ').slice(0, 200));
  emit('no page errors', !c.errors.some((x) => /pageerror/.test(x)), c.errors.join(' | '));
  await b.close();
}
