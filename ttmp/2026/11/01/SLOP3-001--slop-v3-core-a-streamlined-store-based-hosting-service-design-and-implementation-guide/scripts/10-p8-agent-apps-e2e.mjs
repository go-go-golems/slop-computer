// P8, the coding-agent check (diary Step 17): the apps a Pi agent built
// or changed through the slop CLI work in a browser, checked independently
// of the agent's own report.
//
//   agent-poll  two guests: one votes, the other's count moves without a
//               reload; both see "2 people here"; a changed vote replaces
//               the first one.
//   journal     (tags added by the agent) a member writes a draft with
//               tags in the page and publishes it; a guest sees its tag
//               labels, clicks one to see only the posts with that tag,
//               and clicks it again to see all.
//
//   NODE_PATH=<playwright node_modules> node 10-p8-agent-apps-e2e.mjs [shots-dir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const LIVE = 'http://apps.localhost:18300';
const shots = process.argv[2] || '.';
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };

async function open(browser, path) {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 820 } })).newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(LIVE + path);
  const el = await page.waitForSelector('iframe', { timeout: 10000 });
  const frame = await el.contentFrame();
  await frame.waitForLoadState('load');
  return { page, frame };
}
async function until(fn, timeout, every = 250) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}

const browser = await chromium.launch();
try {
  const a = await open(browser, '/x/agent-poll/');
  const b = await open(browser, '/x/agent-poll/');
  const count = (f, opt) => f.evaluate((o) => Number(document.querySelector(`button[data-option="${o}"] .n`)?.textContent), opt);
  await until(() => count(b.frame, 'habit-tracker').then((n) => !Number.isNaN(n)), 8000);
  const before = await count(b.frame, 'habit-tracker');
  await a.frame.click('button[data-option="habit-tracker"]');
  const moved = await until(async () => (await count(b.frame, 'habit-tracker')) === before + 1, 8000);
  check(moved, `poll: guest A votes habit-tracker, guest B sees ${before} → ${before + 1} without a reload`);
  const here = await until(() => b.frame.evaluate(() => document.getElementById('presence').textContent.includes('2 people')), 5000);
  check(here, 'poll: guest B reads "2 people here right now"');
  const book = await count(b.frame, 'book-club');
  await a.frame.click('button[data-option="book-club"]');
  const replaced = await until(async () => (await count(b.frame, 'habit-tracker')) === before && (await count(b.frame, 'book-club')) === book + 1, 8000);
  check(replaced, 'poll: guest A changes to book-club; the first vote is replaced, not added');
  const own = await until(() => a.frame.evaluate(() => document.querySelector('button[data-option="book-club"]').classList.contains('mine')), 5000);
  check(own, 'poll: guest A\'s page marks book-club as its vote');
  await a.page.screenshot({ path: `${shots}/agent-poll.png` });
  check(a.page.errors.length === 0 && b.page.errors.length === 0, `poll: no console errors ${[...a.page.errors, ...b.page.errors].slice(0, 2).join(' | ')}`);

  // journal: a member writes a tagged post through the page.
  const tag = 'e2e' + Date.now().toString(36).slice(-4);
  const title = `Tagged from the browser (${tag})`;
  const m = await open(browser, '/x/journal/');
  await m.page.getByText('Sign in').click();
  await m.page.fill('input[name=email]', 'mira@example.com');
  await m.page.fill('input[name=name]', 'Mira');
  await Promise.all([m.page.waitForURL(/\/x\/journal/), m.page.click('button')]);
  const mf = await (await m.page.waitForSelector('iframe')).contentFrame();
  await mf.waitForSelector('#compose:not([hidden])', { timeout: 10000 });
  await mf.fill('#title', title);
  await mf.fill('#body', 'Written in the page, tags and all.');
  await mf.fill('#tags', `${tag}, v3`);
  await mf.click('#draft button');
  const pub = await until(async () => (await mf.locator('#drafts button[data-pub]').count()) > 0, 8000);
  if (pub) await mf.locator('#drafts button[data-pub]').first().click();
  const posted = await until(() => mf.evaluate((t) => document.getElementById('posts').innerText.includes(t), title), 8000);
  check(posted, `journal: member Mira drafts "${title}" with tags and publishes it`);

  // A guest filters by the new tag.
  const g = await open(browser, '/x/journal/');
  const shown = await until(() => g.frame.evaluate((t) => !!document.querySelector(`button.tag[data-tag="${t}"]`), tag), 8000);
  const all = await g.frame.evaluate(() => document.querySelectorAll('#posts > li').length);
  await g.frame.click(`button.tag[data-tag="${tag}"]`);
  const only = await until(() => g.frame.evaluate((t) => {
    const items = [...document.querySelectorAll('#posts > li')];
    return items.length === 1 && items[0].innerText.includes(t) && !document.getElementById('filterbar').hidden;
  }, title), 8000);
  check(shown && only, `journal: a guest sees #${tag} and, clicking it, only that post (of ${all})`);
  await g.page.screenshot({ path: `${shots}/agent-journal-tags.png` });
  await g.frame.click(`button.tag[data-tag="${tag}"]`);
  const back = await until(async () => (await g.frame.evaluate(() => document.querySelectorAll('#posts > li').length)) === all, 8000);
  check(back, `journal: clicking #${tag} again shows all ${all} posts`);
  check(m.page.errors.length === 0 && g.page.errors.length === 0, `journal: no console errors ${[...m.page.errors, ...g.page.errors].slice(0, 2).join(' | ')}`);
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
