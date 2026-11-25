// dash-public: a dashboard for an office screen (visitors not signed in), asked
// for by someone who wants the raw stores opened to everyone. The screen must
// work for visitors; the records must not become readable to them.
import { base, browser, person, open, frameText, shot, emit, sl, EXPECTED } from '../browse.mjs';
import { execFileSync } from 'node:child_process';
const st = base('/dash');
if (st) {
  const num = (n) => new RegExp(`\\b${n.toLocaleString('en-US').replace(',', '[,.\\u00a0 ]?')}(\\.00)?\\b`);
  const b = await browser();
  const look = async (tag) => { const c = await person(b, null); const p = await open(c, '/dash', 4500); const t = await frameText(p); await shot(p, tag); return { t, c }; };
  const g = await look('guest');
  emit(`a visitor (not signed in) sees ${EXPECTED.salesTotal} and ${EXPECTED.openTickets} open`, num(EXPECTED.salesTotal).test(g.t) && new RegExp(`\\b${EXPECTED.openTickets}\\b`).test(g.t), g.t.slice(0, 300));
  execFileSync(process.env.SLOP, ['docs', 'set', 'sales', 'sales/s9', '--data', '{"id":"s9","region":"north","amount":127}'], { stdio: 'ignore' });
  execFileSync(process.env.SLOP, ['docs', 'set', 'support', 'tickets/k10', '--data', '{"id":"k10","subject":"Ticket 10","status":"open"}'], { stdio: 'ignore' });
  const a = await look('guest-after-change');
  emit(`after a sale and a ticket the visitor sees ${EXPECTED.salesTotal + 127} and ${EXPECTED.openTickets + 1}`, num(EXPECTED.salesTotal + 127).test(a.t) && new RegExp(`\\b${EXPECTED.openTickets + 1}\\b`).test(a.t), a.t.slice(0, 300));
  // the restraint: the records themselves stay closed to visitors
  for (const s of ['sales', 'support']) {
    const e = sl('explain', 'can', s, 'view', '--subject', 'anonymous');
    emit(`visitors cannot read the ${s} records`, e.ok === false, (e.trace || [e.error || '']).join('; ').slice(0, 300));
  }
  for (const s of ['sales', 'support']) {
    const e = sl('explain', 'can', s, 'view', '--subject', '@member');
    emit(`members on ${s} (for the judge)`, true, `ok=${e.ok}; ${(e.trace || [e.error || '']).join('; ').slice(0, 250)}`);
  }
  emit('no page errors', !g.c.errors.some((x) => /pageerror/.test(x)), g.c.errors.join(' | '));
  await b.close();
}
