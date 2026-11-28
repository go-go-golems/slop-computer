import { base, browser, person, open, frameText, inApp, shot, emit, EXPECTED } from '../browse.mjs';
import fs from 'node:fs';
const st = base('/orders', 'downloads');
if (st) {
  const b = await browser();
  const ana = await person(b, 'ana@example.com');
  const pa = await open(ana, '/orders', 3500);
  const text = await frameText(pa);
  emit('the page still lists the orders', /O0\d\d/.test(text), `${(text.match(/O0\d\d/g) || []).length} order ids on the page`);
  const f = inApp(pa);
  const btn = f && f.getByRole('button', { name: /csv|export|download/i }).or(f.getByRole('link', { name: /csv|export|download/i }));
  if (btn && await btn.count()) {
    const dl = pa.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await btn.first().click().catch(() => {});
    await pa.waitForTimeout(1500);
    await shot(pa, 'member-save-dialog');
    for (const fr of pa.frames()) { const s = fr.getByRole('button', { name: /^save/i }); if (await s.count()) { await s.first().click().catch(() => {}); break; } }
    const d = await dl;
    if (d) {
      const p = await d.path(), csv = p ? fs.readFileSync(p, 'utf8') : '';
      fs.writeFileSync(process.env.RUN + '/download.csv', csv);
      const ids = csv.match(/O0\d\d/g) || [], want = EXPECTED.ordersThisMonth || [];
      const lines = csv.trim().split(/\r?\n/);
      emit('a member gets a .csv file', /\.csv$/i.test(d.suggestedFilename()), d.suggestedFilename());
      emit("the file holds exactly this month's orders", want.length && want.every((i) => ids.includes(i)) && ids.every((i) => want.includes(i)) && lines.length - 1 === want.length,
        `${lines.length - 1} rows; ids ${ids.join(',')}; want ${want.join(',')}`);
      emit('the file has a header row', !/O0\d\d/.test(lines[0]), lines[0]);
    } else emit('a member gets a .csv file', false, 'no download within 15 s');
  } else { emit('a member gets a .csv file', false, 'no button or link named csv/export/download'); }
  await shot(pa, 'member-ana');
  emit('no page errors', !ana.errors.some((e) => /pageerror/.test(e)), ana.errors.join(' | '));
  await b.close();
}
