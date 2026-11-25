import { base, browser, person, open, frameText, inApp, shot, emit, sl, RUN } from '../browse.mjs';
import path from 'node:path';
const st = base('/photos', 'assets');
if (st) {
  const b = await browser();
  // a picture to upload: a screenshot of a coloured card
  const mk = await (await b.newContext()).newPage();
  await mk.setContent('<div style="width:320px;height:200px;background:linear-gradient(135deg,#e8590c,#f7b267);font:bold 40px sans-serif;color:#fff;display:grid;place-items:center">photo 1</div>');
  const pic = path.join(RUN, 'upload.png'); await mk.locator('div').screenshot({ path: pic });
  // Upload as one account; returns how many uploaded images it then sees,
  // or null when the page offers it no file input.
  const tryUpload = async (email, label) => {
    const c = await person(b, email); const pa = await open(c, '/photos', 3000);
    const f = inApp(pa);
    const input = f && f.locator('input[type=file]');
    let imgs = null;
    // count before and after: a photo already on the wall is not an upload (js-5a)
    const count = () => f.evaluate(() => [...document.images].filter((i) => i.naturalWidth > 0 && /_blob|blob:|\/_s\//.test(i.src)).length).catch(() => 0);
    if (input && await input.count()) {
      const before = await count();
      await input.first().setInputFiles(pic).catch((e) => emit('upload input works', false, e.message));
      await pa.waitForTimeout(1500);
      const up = f.getByRole('button', { name: /upload|add|post|share|save|send/i });
      if (await up.count()) await up.first().click().catch(() => {});
      await pa.waitForTimeout(4000);
      imgs = (await count()) - before;
    }
    await shot(pa, 'member-' + label);
    return { c, imgs };
  };
  const say = (r) => r.imgs === null ? 'no file input in the page' : `${r.imgs} more image(s) shown after the upload`;
  const ana = await tryUpload('ana@example.com', 'ana');
  const ctxs = [ana.c];
  if (process.env.TEAM_ONLY && !(ana.imgs > 0)) {
    // photos-nontech: "only people on our team" may, after the person asks
    // for it, mean an approval list; ana, a stranger who signed in, is then
    // right to be refused. The team is the persona (Sam) and Kim (js-5b/c).
    emit('a signed-in stranger cannot add (for the judge)', true, 'ana@example.com: ' + say(ana));
    let r = null, who = '';
    for (const [email, label] of [['kim@example.com', 'kim'], ['sam@example.com', 'sam']]) {
      r = await tryUpload(email, label); ctxs.push(r.c); who = email;
      if (r.imgs > 0) break;
    }
    emit('a member uploads a picture and sees it', r.imgs > 0, `${who}: ${say(r)} (ana@example.com: ${say(ana)})`);
  } else emit('a member uploads a picture and sees it', ana.imgs > 0, say(ana));
  const gx = await person(b, null); const pg = await open(gx, '/photos', 4000);
  const gf = inApp(pg);
  const gimgs = gf ? await gf.evaluate(() => [...document.images].filter((i) => i.naturalWidth > 0).length).catch(() => 0) : 0;
  emit('a guest sees the uploaded picture', gimgs > 0, `${gimgs} image(s) loaded for the guest; ${(await frameText(pg)).slice(0, 160)}`);
  const ginput = gf ? await gf.locator('input[type=file]:visible').count() : 0;
  const pol = sl('policy', 'ls', sl('app', 'status', st).app || st);
  const gcell = (pol.cells || []).find((c) => c.capability === 'assets' && c.audience === 'guest');
  emit('guests cannot upload', !(gcell && gcell.effective), `assets for guests: ${gcell ? gcell.effective : 'no cell'}; visible file inputs for the guest: ${ginput}`);
  await shot(pg, 'guest');
  const errs = ctxs.flatMap((c) => c.errors).concat(gx.errors);
  emit('no page errors', !errs.some((e) => /pageerror/.test(e)), errs.join(' | '));
  await b.close();
}
