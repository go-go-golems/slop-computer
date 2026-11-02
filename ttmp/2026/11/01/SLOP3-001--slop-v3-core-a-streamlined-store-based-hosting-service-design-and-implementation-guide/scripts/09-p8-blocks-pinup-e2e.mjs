// P8: Claude Blocks and Pinup, deployed from source (07, 08), work for
// the people their grants name.
//
//   Blocks  two guests in ws-lobby: one makes a page, the other sees it
//           arrive; each sees the other as a peer, and nobody else; a
//           guest is asked to sign in at the members' ws-team.
//   Pinup   the admin starts a design in pin-scratch and has Claude add
//           to it (sample, the real model); a guest sees each change live,
//           view only (editing is the admin level).
//
//   NODE_PATH=<playwright node_modules> node 09-p8-blocks-pinup-e2e.mjs [shots-dir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const LIVE = 'http://apps.localhost:18300';
const shots = process.argv[2] || '.';
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };
const stamp = new Date().toISOString().slice(11, 19);

async function open(browser, path) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(LIVE + path);
  return page;
}
async function frameOf(page) {
  const el = await page.waitForSelector('iframe', { timeout: 10000 });
  const f = await el.contentFrame();
  await f.waitForLoadState('load');
  return f;
}
async function until(fn, timeout, every = 250) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}
const peers = (f) => f.evaluate(async () => {
  const room = await claude.use('room');
  return new Promise((res) => { room.onPeers((ch) => res((ch.peers || []).length)); setTimeout(() => res(-1), 3000); });
});

const browser = await chromium.launch();
try {
  // Blocks: two guests in one workspace.
  const a = await open(browser, '/b/ws-lobby/');
  const b = await open(browser, '/b/ws-lobby/');
  const fa = await frameOf(a), fb = await frameOf(b);
  await a.waitForTimeout(2500);
  check(await peers(fa) === 2 && await peers(fb) === 2, 'blocks: each guest sees two peers (self and the other)');
  const title = `Lobby notes ${stamp}`;
  await fa.locator('button', { hasText: 'New page' }).first().click();
  await a.waitForTimeout(800);
  await a.keyboard.type(title);
  await a.keyboard.press('Enter');
  await a.keyboard.type('A guest wrote this; another guest watched it arrive.');
  const seen = await until(() => fb.evaluate((t) => document.body.innerText.includes(t), title), 8000);
  check(seen, `blocks: guest B sees guest A's page "${title}"`);
  await fb.locator('text=' + title).first().click();
  const body = await until(() => fb.evaluate(() => document.body.innerText.includes('another guest watched it arrive')), 8000);
  check(body, 'blocks: guest B opens it and reads the block');
  await a.screenshot({ path: `${shots}/blocks-guest-a.png` });
  await b.screenshot({ path: `${shots}/blocks-guest-b.png` });
  check(a.errors.length === 0 && b.errors.length === 0, `blocks: no console errors ${[...a.errors, ...b.errors].slice(0, 2).join(' | ')}`);
  await a.context().close();
  const left = await until(async () => (await peers(fb)) === 1, 5000, 500);
  check(left, 'blocks: when guest A leaves, guest B is alone at once');
  await b.context().close();

  const t = await open(browser, '/b/ws-team/');
  const signIn = await until(() => t.locator('text=Sign in to open this').count(), 5000);
  const apps = t.frames().filter((f) => f !== t.mainFrame() && f.url().includes('sbx.')).length;
  check(signIn && apps === 0, `blocks: a guest at ws-team is asked to sign in, no app loads (${apps} app frames)`);
  await t.screenshot({ path: `${shots}/blocks-team-guest.png` });
  await t.context().close();

  // Pinup: the admin designs, a guest watches.
  const ad = await open(browser, '/p/pin-scratch/');
  await ad.getByText('Sign in').click();
  await ad.fill('input[name=email]', 'admin@example.com');
  await ad.fill('input[name=name]', 'Admin');
  await Promise.all([ad.waitForURL(/\/p\/pin-scratch/), ad.click('button')]);
  const fd = await frameOf(ad);
  await ad.waitForTimeout(2500);
  const nodes = (f) => f.evaluate(() => document.querySelectorAll('#world [data-nid]').length);
  if ((await nodes(fd)) === 0) await fd.click('text=Start with an example app');
  const n0 = await until(async () => { const n = await nodes(fd); return n > 0 && n; }, 10000);
  check(n0 > 0, `pinup: the admin's design has ${n0} nodes`);
  const g = await open(browser, '/p/pin-scratch/');
  const fg = await frameOf(g);
  const gn = await until(async () => { const n = await nodes(fg); return n >= n0 && n; }, 10000);
  const ro = await fg.evaluate(() => document.body.innerText.includes('View only'));
  check(gn >= n0 && ro, `pinup: the guest sees ${gn} nodes, view only: ${ro}`);

  // Claude adds to the design through sample.
  const word = `Slop ${stamp.replace(/:/g, '')}`;
  await fd.fill('#askIn', `Add a new frame with one big heading text that reads exactly "${word}". Keep everything else.`);
  await fd.press('#askIn', 'Enter');
  const made = await until(() => fd.evaluate((w) => document.querySelector('#world').innerText.includes(w), word), 180000, 1000);
  check(made, `pinup: Claude added a heading "${word}" (sample on the real model)`);
  const live = await until(() => fg.evaluate((w) => document.querySelector('#world').innerText.includes(w), word), 10000);
  check(live, 'pinup: the guest sees Claude\'s change live');
  await ad.screenshot({ path: `${shots}/pinup-admin.png` });
  await g.screenshot({ path: `${shots}/pinup-guest.png` });
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
