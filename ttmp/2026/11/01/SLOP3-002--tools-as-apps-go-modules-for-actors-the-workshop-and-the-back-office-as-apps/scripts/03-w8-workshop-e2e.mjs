// W8: the Workshop app with an agent loop. A small static site (wsite) has
// main #k and a draft. An admin opens /workshop, picks the site's draft,
// comments on its call-to-action button through the preview's pick mode.
// An "agent" (the slop CLI with a read/write token, as a coding agent
// would use it) blocks in `slop log wait workshop`, wakes on the comment,
// pushes a new draft and replies with that snapshot. The admin views the
// reply's snapshot, publishes it, and the static host serves it.
//
//   SLOP_CREDENTIALS=<admin creds> AGENT_CREDENTIALS=<agent creds> \
//   NODE_PATH=<playwright node_modules> node 03-w8-workshop-e2e.mjs <slop binary> <work dir> [shots-dir]
import { createRequire } from 'node:module';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const LIVE = 'http://apps.localhost:18300';
const STATIC = 'http://site.localhost:18300';
const [SLOP, WORK, shots = '.'] = process.argv.slice(2);
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };
const admin = (...a) => JSON.parse(execFileSync(SLOP, [...a, '-o', 'json'], { encoding: 'utf8' }));
const agentEnv = { ...process.env, SLOP_CREDENTIALS: process.env.AGENT_CREDENTIALS };
const agent = (...a) => JSON.parse(execFileSync(SLOP, [...a, '-o', 'json'], { encoding: 'utf8', env: agentEnv }));
const agentAsync = (...a) => new Promise((res, rej) => execFile(SLOP, [...a, '-o', 'json'], { encoding: 'utf8', env: agentEnv },
  (err, out) => (err ? rej(err) : res(JSON.parse(out)))));
async function until(fn, timeout, every = 200) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}

// The site under review: main has a pale button; the draft changes the headline.
const site = `${WORK}/wsite`;
mkdirSync(site, { recursive: true });
const page = (h1) => `<!doctype html><html><head><meta charset="utf-8"><title>Weft</title><link rel="stylesheet" href="style.css"></head>
<body><main><h1>${h1}</h1><p>Yarn for people who knit in public.</p><a class="cta" href="#buy">Buy a skein</a></main></body></html>`;
const css = (bg) => `body{font:18px/1.5 Georgia,serif;margin:3rem auto;max-width:36rem;color:#222}.cta{display:inline-block;padding:.7rem 1.2rem;background:${bg};color:#fff;text-decoration:none;border-radius:4px}`;
writeFileSync(`${site}/index.html`, page('Weft'));
writeFileSync(`${site}/style.css`, css('#9db4ff'));
try { execFileSync(SLOP, ['store', 'new', 'wsite'], { stdio: 'ignore' }); } catch { /* exists */ }
admin('push', site, '--store', 'wsite', '-m', 'pale button');
admin('grant', 'set', 'wsite', '@guest', 'view');
admin('mount', 'set', 'site.localhost:18300', '/wsite', 'wsite');
writeFileSync(`${site}/index.html`, page('Weft, spun slowly'));
const draft = admin('push', site, '--store', 'wsite', '--ref', 'draft', '-m', 'new headline');

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const tab = await ctx.newPage();
  const errors = [];
  tab.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await tab.goto(LIVE + '/workshop');
  await tab.click('#me a:has-text("Sign in")');
  await tab.fill('input[name=email]', 'admin@example.com');
  await tab.fill('input[name=name]', 'Ada Admin');
  await Promise.all([tab.waitForURL(/\/workshop/), tab.click('button')]);
  errors.splice(0); // signed out, the shell's view request is refused: expected
  const wf = await (await tab.waitForSelector('iframe')).contentFrame();
  await wf.waitForSelector('#stores li[data-store="wsite"]', { timeout: 15000 });
  check(true, 'the Workshop opens at /workshop and lists wsite');

  // The agent starts waiting before anyone comments.
  const head = agent('log', 'show', 'workshop', '--limit', '1');
  const rev = head.length ? head[head.length - 1].rev : 0;
  const woke = agentAsync('log', 'wait', 'workshop', '--after', String(rev), '--timeout', '90');

  await wf.click('#stores li[data-store="wsite"]');
  await wf.waitForSelector(`#snaps li.on[data-n="${draft.n}"]`, { timeout: 10000 });
  const pf = await (await wf.waitForSelector('#frame')).contentFrame();
  await pf.waitForSelector('h1:has-text("spun slowly")', { timeout: 10000 });
  check(true, `the preview shows draft #${draft.n} on its own origin (${new URL(pf.url()).host.split('.')[0].slice(0, 8)}…)`);

  // Comment on the button through pick mode.
  await wf.click('#pick');
  await new Promise((r) => setTimeout(r, 200));
  await pf.click('.cta');
  await wf.waitForSelector('#composer:not([hidden])', { timeout: 5000 });
  const anchorText = await wf.locator('#anchor').innerText();
  await wf.fill('#ctext', 'White on this pale blue is hard to read. Make the button darker.');
  await wf.click('#composer button.primary');
  await wf.waitForSelector('.thread.focus', { timeout: 8000 });
  const num = await wf.locator('.thread.focus .pin').innerText();
  const pin = await until(() => pf.locator('#__slop_pins button', { hasText: num }).count(), 5000);
  check(anchorText.includes('a') && anchorText.includes('Buy a skein') && pin, `pick: "${anchorText}" becomes thread ${num}, drawn as pin ${num} in the preview`);
  await tab.screenshot({ path: `${shots}/w8-workshop-comment.png` });

  // The agent wakes, reads the thread, pushes a fix to draft and replies.
  const commits = await woke;
  const threads = agent('docs', 'ls', 'workshop', 'threads');
  const th = threads.map((d) => ({ id: d.path.split('/').pop(), ...d.body })).find((t) => t.store === 'wsite' && t.status === 'open' && !t.comments.some((c) => c.agent));
  check(commits.length > 0 && th && th.anchor.selector.includes('cta'), `agent: log wait woke after ${commits.length} commit(s); the thread anchors ${th && th.anchor.selector}`);
  writeFileSync(`${site}/style.css`, css('#1f3a8a'));
  const fix = agent('push', site, '--store', 'wsite', '--ref', 'draft', '-m', 'darker button');
  agent('call', 'workshop', 'reply', JSON.stringify({ thread: th.id, n: fix.n, agent: true, text: 'Darker blue (#1f3a8a): white text now passes AA contrast.' }));

  // The admin sees the reply, views its snapshot, publishes it.
  await wf.waitForSelector('.c.agent', { timeout: 10000 });
  await wf.click(`.c.agent a:has-text("view #${fix.n}")`);
  await wf.waitForSelector(`#snaps li.on[data-n="${fix.n}"]`, { timeout: 8000 });
  const bg = await until(async () => {
    const f = await (await wf.waitForSelector('#frame')).contentFrame();
    const v = await f.evaluate(() => getComputedStyle(document.querySelector('.cta')).backgroundColor);
    return v === 'rgb(31, 58, 138)' ? v : '';
  }, 8000);
  check(!!bg, `agent's snapshot #${fix.n} previews with the darker button (${bg})`);
  await tab.screenshot({ path: `${shots}/w8-workshop-reply.png` });
  const before = await (await ctx.request.get(`${STATIC}/wsite/style.css`)).text();
  await wf.click('#publish');
  const served = await until(async () => (await (await ctx.request.get(`${STATIC}/wsite/style.css`)).text()).includes('#1f3a8a'), 8000);
  check(before.includes('#9db4ff') && served, `publish #${fix.n}: the static host switched from the pale to the darker button`);
  const noted = await until(() => wf.locator('.c.system', { hasText: `published #${fix.n}` }).count(), 8000);
  check(noted, 'the open thread notes the publication');
  await wf.click('.thread.focus button:has-text("Resolve")');
  await wf.waitForSelector('.thread.focus.resolved', { timeout: 8000 });
  check(true, 'the thread is resolved');
  await tab.screenshot({ path: `${shots}/w8-workshop-published.png` });
  check(errors.length === 0, `no console errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
