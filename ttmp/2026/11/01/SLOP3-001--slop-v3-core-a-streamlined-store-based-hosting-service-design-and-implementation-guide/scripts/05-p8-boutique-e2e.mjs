// P8: the sites deployed from source (04-deploy-sources.sh) work in a
// browser, as a guest. slop.boutique: every route renders its data, the
// tokens CSS applies, a missing path gets the not-found page with a 404.
// The francois apps: each loads in the live shell (or as static files).
//
//   NODE_PATH=<playwright node_modules> node 05-p8-boutique-e2e.mjs [shots-dir]
// ESM ignores NODE_PATH: resolve Playwright through require.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const BOUTIQUE = 'http://boutique.localhost:18300';
const LIVE = 'http://apps.localhost:18300';
const STATIC = 'http://site.localhost:18300';
const shots = process.argv[2] || '.';
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // route, text the page shows once its data is in, screenshot name
  const routes = [
    ['/', 'Tessellate', 'front'],
    ['/apps/orbits/', 'Bodies in orbit around one sun', 'app-orbits'],
    ['/journal/', 'Comments are prompts', 'journal'],
    ['/journal/comments-as-prompts/', 'Pointing at the layout is easy', 'post'],
    ['/pricing/', 'Support the lab', 'pricing'],
    ['/about/', 'Manuel', 'about'],
    ['/play/orbits/', 'Orbits', 'play-orbits'],
    ['/play/type/', 'Type', 'play-type'],
    ['/play/pomodoro/', 'Pomodoro', 'play-pomodoro'],
  ];
  for (const [path, text, shot] of routes) {
    errors.length = 0;
    const r = await page.goto(BOUTIQUE + path);
    let shown = true;
    try { await page.getByText(text, { exact: false }).first().waitFor({ timeout: 5000 }); } catch { shown = false; }
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    check(r.status() === 200 && shown && accent === '#2340D8' && errors.length === 0,
      `${path}: ${r.status()}, shows "${text}": ${shown}, --accent ${accent || '(none)'}${errors.length ? ', errors: ' + errors.join(' | ') : ''}`);
    await page.screenshot({ path: `${shots}/boutique-${shot}.png` });
  }
  // A path with no page: the not-found page, its path, a 404.
  const nf = await page.goto(BOUTIQUE + '/press/kit');
  const nfText = await page.locator('#path').textContent().catch(() => '');
  const nfCss = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check(nf.status() === 404 && nfText === '/press/kit' && nfCss.includes('Areal'), `/press/kit: ${nf.status()}, path "${nfText}", font ${nfCss.slice(0, 30)}`);
  await page.screenshot({ path: `${shots}/boutique-404.png` });
  // An app page links to its experiment's live page.
  await page.goto(BOUTIQUE + '/');
  await page.getByText('Orbits', { exact: true }).first().click();
  await page.waitForLoadState('networkidle');
  check(/\/apps\/orbits\/?$|\/play\/orbits\/?$/.test(page.url()), `front page → Orbits: ${page.url()}`);

  // francois apps: the live ones in the shell, the plain ones as files.
  for (const app of ['polis', 'capabilities', 'lattice-deck', 'rag-workbench', 'tabula-workbench']) {
    errors.length = 0;
    const r = await page.goto(`${LIVE}/f/${app}/`);
    const frame = await page.waitForSelector('iframe', { timeout: 8000 }).then((el) => el.contentFrame()).catch(() => null);
    let body = 0;
    if (frame) {
      await frame.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(1500);
      body = await frame.evaluate(() => document.body ? document.body.innerText.length : 0).catch(() => 0);
    }
    check(r.status() === 200 && frame && body > 0, `live /f/${app}/: ${r.status()}, app frame text ${body} chars${errors.length ? ', errors: ' + errors.slice(0, 3).join(' | ') : ''}`);
    await page.screenshot({ path: `${shots}/francois-${app}.png` });
  }
  for (const app of ['lattice-phantasmagoria', 'lattice-rift']) {
    errors.length = 0;
    const r = await page.goto(`${STATIC}/f/${app}/`);
    await page.waitForTimeout(1500);
    const canvas = await page.locator('canvas').count();
    check(r.status() === 200 && errors.length === 0, `static /f/${app}/: ${r.status()}, ${canvas} canvas${errors.length ? ', errors: ' + errors.slice(0, 3).join(' | ') : ''}`);
    await page.screenshot({ path: `${shots}/francois-${app}.png` });
  }
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
