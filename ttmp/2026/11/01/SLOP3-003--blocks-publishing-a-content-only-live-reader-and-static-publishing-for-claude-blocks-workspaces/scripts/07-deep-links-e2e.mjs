// Deep links inside an app, with Claude Blocks: the page is the URL's
// fragment. The runtime mirrors the view's fragment into the address bar
// and the shell sends its own fragment into the view; Blocks' slop
// addition (web/blocks/slop/deep-links.js) keeps the open page there.
//
//   NODE_PATH=<playwright node_modules> node 07-deep-links-e2e.mjs [shots-dir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const LIVE = 'http://apps.localhost:18300';
const shots = process.argv[2] || '.';
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };
async function until(fn, timeout, every = 200) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}
const hashOf = (tab) => new URL(tab.url()).hash;
async function signIn(tab) {
  await tab.click('#me a:has-text("Sign in")');
  await tab.fill('input[name=email]', 'admin@example.com');
  await tab.fill('input[name=name]', 'Ada Admin');
  await Promise.all([tab.waitForURL(/\/b\/ws-team/), tab.click('button')]);
}
async function editor(tab) {
  const f = await (await tab.waitForSelector('iframe')).contentFrame();
  // window.blocks is the #blocks element until blocks.js has run
  await f.waitForFunction(() => window.blocks && window.blocks.S && window.blocks.S.loaded, null, { timeout: 20000 });
  return f;
}
const pageIn = (f) => f.evaluate(() => window.blocks.page());

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
  const tab = await ctx.newPage();
  const errors = [];
  tab.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // A deep link, signed out: sign-in keeps the fragment, the editor opens that page.
  await tab.goto(LIVE + '/b/ws-team#handbook');
  await signIn(tab);
  let ed = await editor(tab);
  const opened = await until(async () => (await pageIn(ed)) === 'handbook' && hashOf(tab) === '#handbook', 8000);
  check(opened, `a link to /b/ws-team#handbook survives sign-in and opens that page (address bar ${hashOf(tab)})`);
  errors.splice(0);

  // Following a link inside the page writes the fragment.
  await ed.click('[data-go="handbook_care"] >> visible=true');
  const moved = await until(async () => (await pageIn(ed)) === 'handbook_care' && hashOf(tab) === '#handbook_care', 5000);
  check(moved, `clicking the Care mention: the address bar follows (${hashOf(tab)})`);
  await tab.screenshot({ path: `${shots}/b6-deep-link-care.png` });

  // Back and Forward step through pages, without reloading the editor.
  await ed.evaluate(() => { window.__sameDocument = true; });
  await tab.goBack();
  const back = await until(async () => (await pageIn(ed)) === 'handbook' && hashOf(tab) === '#handbook', 5000);
  await tab.goForward();
  const fwd = await until(async () => (await pageIn(ed)) === 'handbook_care' && hashOf(tab) === '#handbook_care', 5000);
  check(back && fwd && (await ed.evaluate(() => window.__sameDocument === true)), 'Back and Forward move between pages in the same editor');

  // A fragment typed into the address bar goes to the page (no reload either).
  await tab.goto(LIVE + '/b/ws-team#page_o1p8');
  const typed = await until(async () => (await pageIn(ed)) === 'page_o1p8', 5000);
  check(typed && (await ed.evaluate(() => window.__sameDocument === true)), `a typed fragment opens "NO NO NO NO" in place`);

  // A new tab on a deep link opens there; a link to no page falls back and corrects the address bar.
  const tab2 = await ctx.newPage();
  await tab2.goto(LIVE + '/b/ws-team#handbook_care');
  const ed2 = await editor(tab2);
  check(await until(async () => (await pageIn(ed2)) === 'handbook_care', 8000), 'a new tab on /b/ws-team#handbook_care opens Care');
  await tab2.goto(LIVE + '/b/ws-team');
  await tab2.goto(LIVE + '/b/ws-team#no_such_page');
  await tab2.reload();
  const ed3 = await editor(tab2);
  const fell = await until(async () => { const p = await pageIn(ed3); return p && p !== 'no_such_page' && hashOf(tab2) === '#' + p ? p : ''; }, 8000);
  check(!!fell, `a link to a page that does not exist opens ${fell} and the address bar says so`);
  check(errors.length === 0, `no console errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
