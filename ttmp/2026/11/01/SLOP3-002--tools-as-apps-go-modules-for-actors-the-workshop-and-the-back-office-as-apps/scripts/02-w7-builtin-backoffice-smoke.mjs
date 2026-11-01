// W7 regression: the built-in back office on the main host (same UI as the
// app, api.js instead of api-app.js) still signs in, reads its hosts from
// the boot data and lists mounts.
//
//   NODE_PATH=<playwright node_modules> node 02-w7-builtin-backoffice-smoke.mjs [shots-dir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const MAIN = 'http://slop.localhost:18300';
const shots = process.argv[2] || '.';
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(MAIN + '/auth/login?return=/');
  await page.fill('input[name=email]', 'admin@example.com');
  await page.fill('input[name=name]', 'Ada Admin');
  await Promise.all([page.waitForURL(MAIN + '/'), page.click('button[type=submit], form button')]);
  await page.waitForSelector('.brand', { timeout: 10000 });
  check(await page.locator('button:has-text("Sign out")').count() === 1, 'built-in back office: signed in, with its Sign out button');
  await page.click('a.dtab:has-text("Sites")');
  const hostOK = await page.waitForSelector('text=apps.localhost:18300', { timeout: 8000 }).then(() => true, () => false);
  check(hostOK, 'Sites: hosts from the boot data and the mounts are listed');
  await page.screenshot({ path: `${shots}/w7-builtin-sites.png` });
  check(errors.length === 0, `no console errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
