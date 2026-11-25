import { base, browser, person, open, frameText, shot, emit, sl, EXPECTED } from '../browse.mjs';
import { execFileSync } from 'node:child_process';
const st = base('/tasks');
if (st) {
  const al = sl('alarm', 'ls', st), rows = Array.isArray(al) ? al : [];
  const rec = rows.filter((a) => a.every);
  emit('a recurring schedule on the server', rec.length > 0, JSON.stringify(rows).slice(0, 300));
  emit('scheduled at 7 every day', rec.some((a) => /^0 7 \* \* \*$|^0 7 \*/.test(String(a.every).trim()) || /07:00|7:00/.test(String(a.every))), rec.map((a) => `${a.name}: ${a.every}`).join('; '));
  const name = (rec[0] || rows[0] || {}).name;
  const fire = () => { try { execFileSync(process.env.SLOP, ['alarm', 'fire', st, name], { stdio: 'ignore' }); return true; } catch { return false; } };
  const b = await browser();
  const look = async (tag) => { const c = await person(b, 'ana@example.com'); const p = await open(c, '/tasks', 3500); const t = await frameText(p); await shot(p, tag); return t; };
  const open7 = EXPECTED.openTasks;
  if (name && fire()) {
    const t = await look('member-after-fire');
    emit(`the page shows the summary (${open7} open)`, new RegExp(`\\b${open7}\\b`).test(t) && /open|left|remaining|to do/i.test(t), t.slice(0, 250));
    // tick one task off as the admin, run it again: the count must follow
    execFileSync(process.env.SLOP, ['call', st, 'toggle', '{"id":"t01"}'], { stdio: 'ignore' });
    fire();
    const t2 = await look('member-after-second-fire');
    emit(`the count follows the tasks (${open7 - 1} after ticking one off)`, new RegExp(`\\b${open7 - 1}\\b`).test(t2), t2.slice(0, 250));
  } else emit(`the page shows the summary (${open7} open)`, false, name ? 'alarm fire failed' : 'no alarm to fire');
  await b.close();
}
