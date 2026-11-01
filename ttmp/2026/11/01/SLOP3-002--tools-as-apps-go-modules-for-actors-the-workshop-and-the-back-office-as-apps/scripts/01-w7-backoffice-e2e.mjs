// W7: the back office as an app, in a browser. An admin opens /admin on the
// live host (the backoffice store, trusted with the system module), lets a
// pending person in, grants a comp and toggles a policy cell. Each is a
// governance change made through an app, so the shell asks first: the test
// declines once, then allows. Activity then lists the changes with
// via app:backoffice, and a change made from the CLI shows up without a
// reload (the actor's system:* reactor).
//
//   SLOP_CREDENTIALS=<admin creds> NODE_PATH=<playwright node_modules> \
//     node 01-w7-backoffice-e2e.mjs <slop binary> [shots-dir]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');

const LIVE = 'http://apps.localhost:18300';
const SLOP = process.argv[2] || 'slop';
const shots = process.argv[3] || '.';
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };
const cli = (...args) => JSON.parse(execFileSync(SLOP, [...args, '-o', 'json'], { encoding: 'utf8' }));
async function until(fn, timeout, every = 200) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}

// Mira waits to be let in (set from the CLI, not through the app).
const mira = cli('people', 'ls').find((p) => p.email === 'mira@example.com');
cli('people', 'role', mira.id, 'pending');
for (const c of cli('sub', 'ls', mira.id)) if (!c.revokedAt) cli('sub', 'revoke', c.id);
const policyBefore = cli('policy', 'ls', 'polis').cells.find((c) => c.capability === 'sample' && c.audience === 'guest')?.allowed;
if (policyBefore) cli('policy', 'set', 'polis', 'sample', '@guest', 'off');

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  const failed = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  await page.goto(LIVE + '/admin');
  await page.click('#me a:has-text("Sign in")');
  await page.fill('input[name=email]', 'admin@example.com');
  await page.fill('input[name=name]', 'Ada Admin');
  await Promise.all([page.waitForURL(/\/admin/), page.click('button')]);
  // Signed out, the shell's view request is refused (401): expected.
  const before = failed.splice(0);
  check(before.every((f) => f.startsWith('401 POST') && f.endsWith('/_site/views')), `signed out: only the view request failed (${before.join(', ') || 'none'})`);
  errors.splice(0);
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForSelector('.brand', { timeout: 15000 });
  check(true, 'the back office app opens at /admin on the live host');

  // A dialog the shell draws, outside the app's frame.
  const dialog = async (choice) => {
    const d = await page.waitForSelector('.shell-dialog', { timeout: 8000 });
    const text = await d.innerText();
    await page.click(`.shell-dialog button:has-text("${choice}")`);
    return text;
  };

  // People: let Mira in (confirmed in the shell).
  await frame.click('a.dtab:has-text("People")');
  const row = frame.locator('tr', { hasText: 'mira@example.com' });
  await row.locator('button:has-text("Let in")').click();
  const asked = await dialog('Allow');
  check(/Back office/.test(asked) && asked.includes('people.role') && asked.includes(mira.id), `let in: the shell asks "${asked.replace(/\s+/g, ' ').slice(0, 90)}…"`);
  const member = await until(async () => (await row.innerText()).includes('member'), 8000);
  check(member && cli('people', 'ls').find((p) => p.id === mira.id).role === 'member', 'let in: Mira is a member after allowing');
  await page.screenshot({ path: `${shots}/w7-backoffice-people.png` });

  // Grant a comp (sub.grant is governance too).
  await row.locator('button:has-text("Grant comp")').click();
  await dialog('Allow');
  const comped = await until(async () => (await row.innerText()).includes('comp until'), 8000);
  check(comped, 'grant comp: allowed in the shell, the row shows the comp');

  // Policy: decline once, then allow.
  await frame.click('a.dtab:has-text("Apps")');
  await frame.locator('tr', { hasText: 'polis' }).first().click();
  const cell = frame.locator('button[aria-label="sample for guest"]');
  await cell.waitFor({ timeout: 8000 });
  await cell.click();
  await dialog('Cancel');
  const declined = await until(() => frame.locator('.otoast.bad', { hasText: 'confirmation_declined' }).count(), 5000);
  check(declined && (await cell.getAttribute('aria-pressed')) === 'false', 'policy: Cancel leaves the cell off and the app reports confirmation_declined');
  await cell.click();
  const summary = await dialog('Allow');
  const on = await until(async () => (await cell.getAttribute('aria-pressed')) === 'true', 8000);
  check(on && summary.includes('policy.set') && summary.includes('polis'), 'policy: Allow turns sample on for guests');
  await page.screenshot({ path: `${shots}/w7-backoffice-policy.png` });

  // Activity: the three changes, via app:backoffice.
  await frame.click('a.dtab:has-text("Activity")');
  const viaApp = await until(async () => {
    const t = await frame.locator('table').innerText();
    return t.includes('app:backoffice') && /role of .*pending → member/.test(t) && /policy polis sample @guest on/.test(t) ? t : '';
  }, 8000);
  check(!!viaApp, 'activity: role, comp and policy changes are logged via app:backoffice');

  // A change made from the CLI appears without a reload (system:* reactor).
  const probe = 'w7-probe-' + Date.now().toString(36);
  cli('store', 'new', probe);
  const live = await until(async () => (await frame.locator('table').innerText()).includes(probe), 10000);
  check(live, `activity: "${probe}" created from the CLI appears without a reload`);
  cli('store', 'rm', probe);
  await page.screenshot({ path: `${shots}/w7-backoffice-activity.png` });
  check(errors.length === 0 && failed.length === 0, `signed in: no console errors or failed requests ${[...errors, ...failed].slice(0, 3).join(' | ')}`);
  await ctx.close();
} finally {
  await browser.close();
  // Leave the demo as it was.
  for (const c of cli('sub', 'ls', mira.id)) if (!c.revokedAt) cli('sub', 'revoke', c.id);
  cli('policy', 'set', 'polis', 'sample', '@guest', policyBefore ? 'on' : 'off');
  cli('people', 'role', mira.id, 'member');
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
