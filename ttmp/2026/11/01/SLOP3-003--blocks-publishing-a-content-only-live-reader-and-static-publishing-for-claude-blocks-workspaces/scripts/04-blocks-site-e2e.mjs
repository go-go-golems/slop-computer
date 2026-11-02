// B4: Blocks publishing end to end, on the demo server after
// 03-deploy-blocks-site.sh.
//
// A content person (the admin) writes a handbook page and a sub-page in
// Claude Blocks (/b/ws-team), as Hypha lines in the Claude panel, the way
// a person or an agent writes structure. A guest reads them at once at
// /pub/team-site/, with no editor. The admin scopes the site to the
// handbook, publishes it from /pub/team-site/_site, and the static host
// serves the snapshot; a later edit shows in the reader but not on the
// static site until a draft is pushed. Then a member does the whole thing
// for a workspace of their own with the CLI only.
//
//   SLOP_CREDENTIALS=<admin creds> MEMBER_CREDENTIALS=<member creds> \
//   NODE_PATH=<playwright node_modules> node 04-blocks-site-e2e.mjs <slop binary> [shots-dir]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');

const LIVE = 'http://apps.localhost:18300';
const STATIC = 'http://site.localhost:18300';
const [SLOP, shots = '.'] = process.argv.slice(2);
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };
const run = (env, args) => JSON.parse(execFileSync(SLOP, [...args, '-o', 'json'], { encoding: 'utf8', env: { ...process.env, ...env } }));
const admin = (...a) => run({}, a);
const member = (...a) => run({ SLOP_CREDENTIALS: process.env.MEMBER_CREDENTIALS }, a);
const tryRun = (f) => { try { return f(); } catch (e) { return { error: String(e.stderr || e.message) }; } };
async function until(fn, timeout, every = 300) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}
const hash32 = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
const stamp = Date.now().toString(36).slice(-5);

const browser = await chromium.launch();
try {
  // ---- the content person, in Blocks ----------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
  const tab = await ctx.newPage();
  await tab.goto(LIVE + '/b/ws-team');
  await tab.click('#me a:has-text("Sign in")');
  await tab.fill('input[name=email]', 'admin@example.com');
  await tab.fill('input[name=name]', 'Ada Admin');
  await Promise.all([tab.waitForURL(/\/b\/ws-team/), tab.click('button')]);
  const ed = await (await tab.waitForSelector('iframe')).contentFrame();
  await ed.waitForSelector('#ph-ask', { timeout: 20000 });
  await ed.waitForTimeout(1000);
  const write = async (lines, scope = 'all') => {
    if (!(await ed.locator('#ag-in').isVisible())) await ed.click('#ph-ask');
    await ed.click(`#ag-scope button[data-scope="${scope}"]`);
    await ed.fill('#ag-in', lines.join('\n'));
    await ed.waitForFunction(() => document.querySelector('#ag-send').textContent.trim() === 'Write', null, { timeout: 3000 });
    await ed.click('#ag-send');
  };
  await write([
    'handbook.title = "Weft handbook"',
    'handbook.icon = "🧶"',
    'handbook.ui.0 is h1 "Yarn for people who knit in public"',
    'handbook.ui.1 is p "We spin **small batches** of *undyed* wool. Washing: [[handbook_care]]."',
    'handbook.ui.2 is callout "Orders ship on **Mondays**.", icon: "📦"',
    'handbook.ui.3 is h2 "What we make"',
    'handbook.ui.4 is bullet "Worsted, 200 m"',
    'handbook.ui.5 is bullet "Fingering, 400 m"',
    'handbook.ui.6 is todo "Restock the oat colourway", done: true',
    'handbook.skeins = 12',
    'handbook.ui.7 is p "{skeins} skeins in stock."',
    'handbook_care.title = "Care"',
    'handbook_care.icon = "🫧"',
    'handbook_care.parent = "handbook"',
    'handbook_care.ui.0 is p "Wash cold. Dry flat."',
  ]);
  const inEditor = await until(async () => (await ed.locator('text=Weft handbook').count()) > 0, 8000);
  check(inEditor, 'Blocks: the handbook page is in the workspace');

  // ---- a guest reads it, at once, without the editor --------------------------
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const g = await guest.newPage();
  const gerr = [];
  g.on('console', (m) => { if (m.type() === 'error') gerr.push(m.text()); });
  const live = await until(async () => {
    const r = await g.goto(LIVE + '/pub/team-site/weft-handbook');
    return r.status() === 200 && (await g.content()).includes('Yarn for people who knit in public') ? r : null;
  }, 15000, 800);
  check(!!live, 'reader: a guest reads /pub/team-site/weft-handbook');
  if (live) {
    const csp = live.headers()['content-security-policy'] || '';
    const html = await g.content();
    check(csp.includes("default-src 'none'") && (await g.locator('script').count()) === 0 && (await g.locator('[contenteditable]').count()) === 0,
      'reader: no script, nothing editable, a CSP without script sources');
    check(html.includes('<strong>small batches</strong>') && html.includes('12</span> skeins') && !html.includes('Ask Claude') && !html.includes('Settings and publishing'),
      'reader: prose and formulas render; no editor chrome, no admin bar for a guest');
    await g.screenshot({ path: `${shots}/b4-reader-guest.png`, fullPage: true });
    await g.click('a.mention:has-text("Care")');
    check(/\/pub\/team-site\/care$/.test(g.url()) && (await g.content()).includes('Wash cold'), `reader: the mention links to the sub-page (${new URL(g.url()).pathname})`);
  }

  // ---- the admin scopes the site and publishes ---------------------------------
  await tab.goto(LIVE + '/pub/team-site/_site');
  check(await tab.locator('h1:has-text("Settings and publishing")').count() === 1, 'settings: the admin opens /pub/team-site/_site');
  await tab.selectOption('#root', 'handbook');
  await tab.fill('#title', 'Weft');
  await tab.click('form[action$="/_site"] button.primary');
  check(await until(async () => (await tab.locator('.note').innerText()).includes('Settings saved'), 5000), 'settings: saved (root = handbook, title = Weft)');
  await tab.screenshot({ path: `${shots}/b4-site-settings.png`, fullPage: true });
  await tab.fill('#to', 'team-static');
  await tab.click('button:has-text("Publish now")');
  const published = await until(async () => { const t = await tab.locator('.note').innerText(); return /Published #\d+: team-static serves it now/.test(t) ? t : ''; }, 8000);
  check(!!published, `publish: "${published}"`);

  await g.goto(STATIC + '/s/team-static/');
  const shtml = await g.content();
  check(shtml.includes('Yarn for people who knit in public') && shtml.includes('<a class="brand" href="./">Weft</a>') && !shtml.includes('FOOBAR'),
    'static: site.localhost/s/team-static/ serves the handbook, scoped (FOOBAR is not published)');
  await g.click('a.mention:has-text("Care")');
  check(/\/s\/team-static\/care\/$/.test(g.url()) && (await g.content()).includes('Wash cold'), `static: relative links work (${new URL(g.url()).pathname})`);
  await g.goto(STATIC + '/s/team-static/');
  await g.screenshot({ path: `${shots}/b4-static-site.png`, fullPage: true });

  // ---- an edit after publishing: the reader has it, the static site does not --------
  await tab.goto(LIVE + '/b/ws-team');
  const ed2 = await (await tab.waitForSelector('iframe')).contentFrame();
  await ed2.waitForSelector('#ph-ask', { timeout: 20000 });
  await ed2.waitForTimeout(800);
  await ed2.click('#ph-ask');
  await ed2.click('#ag-scope button[data-scope="all"]');
  await ed2.fill('#ag-in', `handbook.ui.8 is p "Edited after publishing (${stamp})."`);
  await ed2.waitForFunction(() => document.querySelector('#ag-send').textContent.trim() === 'Write', null, { timeout: 3000 });
  await ed2.click('#ag-send');
  const edited = await until(async () => { await g.goto(LIVE + '/pub/team-site/'); return (await g.content()).includes(stamp); }, 10000, 800);
  await g.goto(STATIC + '/s/team-static/');
  check(edited && !(await g.content()).includes(stamp), 'edit: the reader shows it, the static site does not');
  await tab.goto(LIVE + '/pub/team-site/_site');
  await tab.click('button:has-text("Push a draft for review")');
  const drafted = await until(async () => { const t = await tab.locator('.note').innerText(); return /Pushed draft #\d+ to team-static/.test(t) ? t : ''; }, 8000);
  const draftIndex = execFileSync(SLOP, ['files', 'cat', 'team-static', 'index.html', '--at', 'draft'], { encoding: 'utf8' }); // raw text
  await g.goto(STATIC + '/s/team-static/');
  check(!!drafted && String(draftIndex).includes(stamp) && !(await g.content()).includes(stamp), `draft: "${drafted}"; main still serves the last publication`);
  await ctx.close();

  // ---- a member, with the CLI only ------------------------------------------------
  const me = member('whoami').id, peer = 'u' + hash32(me).toString(36) + ':you', now = Date.now();
  tryRun(() => member('store', 'new', 'my-notes', '--type', 'blocks', '--app', 'blocks'));
  member('docs', 'set', 'my-notes', `chunks/c-cli-${stamp}`, '--data', JSON.stringify({ by: me, tab: 'cli', seq: 0, at: now, n: 3, ops: [
    [`n1${stamp}`, peer, 1, 'notes.title = "My notes"', now],
    [`n2${stamp}`, peer, 2, 'notes.ui.0 is p "Published by a member, from the command line."', now],
    [`n3${stamp}`, peer, 3, `notes.ui.1 is p "Run ${stamp}."`, now]] }));
  tryRun(() => member('store', 'new', 'my-notes-site', '--app', 'blocks-site', '--type', 'blocks-site'));
  member('bind', 'set', 'my-notes-site', 'source', 'my-notes');
  member('grant', 'set', 'my-notes', 'store:my-notes-site', 'view');
  member('grant', 'set', 'my-notes-site', '@guest', 'view');
  tryRun(() => member('store', 'new', 'my-notes-static', '--type', 'site'));
  member('grant', 'set', 'my-notes-static', '@guest', 'view');
  const mp = member('call', 'my-notes-site', 'publish', JSON.stringify({ to: 'my-notes-static', live: true }));
  await g.goto(LIVE + '/pub/my-notes-site/');
  const mlive = (await g.content()).includes(`Run ${stamp}.`);
  await g.goto(STATIC + '/s/my-notes-static/');
  const mstatic = (await g.content()).includes(`Run ${stamp}.`);
  check(mlive && mstatic, `member: my-notes → /pub/my-notes-site/ and, published #${mp.n}, /s/my-notes-static/`);
  const denied = tryRun(() => member('call', 'team-site', 'publish', JSON.stringify({ to: 'my-notes-static', live: true })));
  check(String(denied.error || '').includes('permission_denied'), 'member: cannot publish a site they do not administer');
  check(gerr.length === 0, `guest pages: no console errors ${gerr.slice(0, 2).join(' | ')}`);
  await guest.close();
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
