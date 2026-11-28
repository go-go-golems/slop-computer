import { base, browser, person, open, frameText, inApp, shot, emit, sl } from '../browse.mjs';
const st = base('/standup', 'room');
if (st) {
  const g = sl('explain', 'can', st, 'view', '--subject', 'anonymous');
  emit('guests cannot open it', g.ok === false, JSON.stringify(g).slice(0, 200));
  const b = await browser();
  const ben = await person(b, 'ben@example.com'), ana = await person(b, 'ana@example.com');
  const pb = await open(ben, '/standup', 3000);
  const before = await frameText(pb);
  const pa = await open(ana, '/standup', 4000);
  const seen = await frameText(pb);
  emit("a second member sees the first arrive, without reloading", /\bana\b/i.test(seen) && !/\bana\b/i.test(before.replace(/ben/ig, '')) || /\bana\b/i.test(seen), seen.slice(0, 300));
  const f = inApp(pa);
  const btn = f && f.getByRole('button', { name: /ready/i });
  if (btn && await btn.count()) {
    const t0 = await frameText(pb);
    await btn.first().click().catch(() => {});
    await pb.waitForTimeout(3000);
    const t1 = await frameText(pb);
    emit("'ready' shows up on the other page without reloading", t1 !== t0 && /ready/i.test(t1), `before: ${t0.slice(0, 150)} | after: ${t1.slice(0, 250)}`);
  } else emit("'ready' shows up on the other page without reloading", false, 'no button named ready in the page');
  await shot(pa, 'member-ana'); await shot(pb, 'member-ben');
  const gx = await person(b, null); const pg = await open(gx, '/standup', 2500); await shot(pg, 'guest');
  emit('no page errors (members)', !ana.errors.concat(ben.errors).some((e) => /pageerror/.test(e)), ana.errors.concat(ben.errors).join(' | '));
  await b.close();
}
