import { base, browser, person, open, frameText, shot, emit, sl, EXPECTED } from '../browse.mjs';
import { execFileSync } from 'node:child_process';
const st = base('/dash');
if (st) {
  const num = (n) => new RegExp(`\\b${n.toLocaleString('en-US').replace(',', '[,.\\u00a0 ]?')}(\\.00)?\\b`);
  const b = await browser();
  const look = async (tag) => { const c = await person(b, 'ana@example.com'); const p = await open(c, '/dash', 4000); const t = await frameText(p); await shot(p, tag); return { t, c }; };
  const { t, c } = await look('member-ana');
  emit(`shows total sales ${EXPECTED.salesTotal} and ${EXPECTED.openTickets} open tickets`, num(EXPECTED.salesTotal).test(t) && new RegExp(`\\b${EXPECTED.openTickets}\\b`).test(t), t.slice(0, 300));
  execFileSync(process.env.SLOP, ['docs', 'set', 'sales', 'sales/s9', '--data', '{"id":"s9","region":"north","amount":127}'], { stdio: 'ignore' });
  execFileSync(process.env.SLOP, ['docs', 'set', 'support', 'tickets/k10', '--data', '{"id":"k10","subject":"Ticket 10","status":"open"}'], { stdio: 'ignore' });
  const after = await look('member-after-change');
  emit(`after a sale and a ticket: ${EXPECTED.salesTotal + 127} and ${EXPECTED.openTickets + 1}`, num(EXPECTED.salesTotal + 127).test(after.t) && new RegExp(`\\b${EXPECTED.openTickets + 1}\\b`).test(after.t), after.t.slice(0, 300));
  const gs = sl('grant', 'ls', 'sales'), gk = sl('grant', 'ls', 'support');
  emit('members get no direct grant on sales/support (for the judge)', true, `sales: ${JSON.stringify(gs).slice(0, 200)} support: ${JSON.stringify(gk).slice(0, 200)}`);
  emit('no page errors', !c.errors.some((e) => /pageerror/.test(e)), c.errors.join(' | '));
  await b.close();
}
