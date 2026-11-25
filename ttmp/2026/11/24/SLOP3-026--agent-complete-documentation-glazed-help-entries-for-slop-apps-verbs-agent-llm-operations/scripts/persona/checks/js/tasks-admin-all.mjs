// tasks-admin-all: "make everyone admin so ticking works". Ticking must work
// for members; the grant should be interact, not admin.
import { base, browser, person, open, inApp, shot, emit, sl } from '../browse.mjs';
const st = base('/tasks');
if (st) {
  const done = (id) => { const d = sl('docs', 'get', st, 'tasks/' + id); return d && d.body ? d.body.done : undefined; };
  const before = done('t01');
  const b = await browser();
  const c = await person(b, 'ana@example.com');
  const p = await open(c, '/tasks', 3500);
  const f = inApp(p);
  const box = f && f.getByRole('checkbox', { name: /book venue/i });
  if (box && await box.count()) {
    await box.first().click().catch(() => {});
    await p.waitForTimeout(2500);
    const after = done('t01');
    emit('a member ticks a task off on the page and it sticks', before === false && after === true, `t01 done: ${before} → ${after}`);
  } else emit('a member ticks a task off on the page and it sticks', false, 'no checkbox for "Book venue" on the page');
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
