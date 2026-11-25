import { base, browser, person, open, frameText, inApp, shot, emit, sl, RUN } from '../browse.mjs';
import path from 'node:path';
const st = base('/photos', 'assets');
if (st) {
  const b = await browser();
  // a picture to upload: a screenshot of a coloured card
  const mk = await (await b.newContext()).newPage();
  await mk.setContent('<div style="width:320px;height:200px;background:linear-gradient(135deg,#e8590c,#f7b267);font:bold 40px sans-serif;color:#fff;display:grid;place-items:center">photo 1</div>');
  const pic = path.join(RUN, 'upload.png'); await mk.locator('div').screenshot({ path: pic });
  const ana = await person(b, 'ana@example.com');
  const pa = await open(ana, '/photos', 3000);
  const f = inApp(pa);
  const input = f && f.locator('input[type=file]');
  if (input && await input.count()) {
    await input.first().setInputFiles(pic).catch((e) => emit('upload input works', false, e.message));
    await pa.waitForTimeout(1500);
    const up = f.getByRole('button', { name: /upload|add|post|share|save|send/i });
    if (await up.count()) await up.first().click().catch(() => {});
    await pa.waitForTimeout(4000);
    await shot(pa, 'member-ana');
    const imgs = await f.evaluate(() => [...document.images].filter((i) => i.naturalWidth > 0 && /_blob|blob:|\/_s\//.test(i.src)).length).catch(() => 0);
    emit('a member uploads a picture and sees it', imgs > 0, `${imgs} uploaded image(s) shown`);
  } else { emit('a member uploads a picture and sees it', false, 'no file input in the page'); await shot(pa, 'member-ana'); }
  const gx = await person(b, null); const pg = await open(gx, '/photos', 4000);
  const gf = inApp(pg);
  const gimgs = gf ? await gf.evaluate(() => [...document.images].filter((i) => i.naturalWidth > 0).length).catch(() => 0) : 0;
  emit('a guest sees the uploaded picture', gimgs > 0, `${gimgs} image(s) loaded for the guest; ${(await frameText(pg)).slice(0, 160)}`);
  const ginput = gf ? await gf.locator('input[type=file]:visible').count() : 0;
  const pol = sl('policy', 'ls', sl('app', 'status', st).app || st);
  const gcell = (pol.cells || []).find((c) => c.capability === 'assets' && c.audience === 'guest');
  emit('guests cannot upload', !(gcell && gcell.effective), `assets for guests: ${gcell ? gcell.effective : 'no cell'}; visible file inputs for the guest: ${ginput}`);
  await shot(pg, 'guest');
  emit('no page errors', !ana.errors.concat(gx.errors).some((e) => /pageerror/.test(e)), ana.errors.concat(gx.errors).join(' | '));
  await b.close();
}
