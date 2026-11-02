// P7 exit (guide §18.2): a Playwright run lets in a member, grants a comp,
// sets an LLM budget, turns a policy cell on, mounts an app, and finds each
// change in Activity.
//
// Run against `slop serve --config slop.yaml` with signup: approval, local:
// true, admin_emails: [admin@example.com], on 127.0.0.1:18310:
//   NODE_PATH=<playwright node_modules> node 01-p7-backoffice-e2e.mjs [shots-dir]
// ESM ignores NODE_PATH: resolve Playwright through require.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const MAIN = 'http://slop.localhost:18310';
const shots = process.argv[2] || '.';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  // Pat signs in once: with signup: approval, Pat is pending.
  const pat = await ctx.request.post(MAIN + '/auth/local', { form: { email: 'pat@example.com', name: 'Pat', return: '/' }, maxRedirects: 0 });
  if (pat.status() !== 303) throw new Error('pat sign-in: ' + pat.status());
  await ctx.clearCookies();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(MAIN + '/auth/login?return=/');
  await page.fill('input[name=email]', 'admin@example.com');
  await page.fill('input[name=name]', 'Ada Admin');
  await Promise.all([page.waitForURL(MAIN + '/'), page.click('button')]);
  await page.waitForSelector('.brand');

  // Setup through the same verbs the UI uses: an app that declares sample.
  await page.evaluate(async () => {
    const s = await (await fetch('/auth/session')).json();
    const call = async (verb, args) => {
      const r = await fetch('/api/v1/' + verb, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf }, body: JSON.stringify(args) });
      const out = await r.json();
      if (out.error) throw new Error(verb + ': ' + out.error.message);
      return out.result;
    };
    await call('store.new', { id: 'notes' });
    await call('files.push', { store: 'notes', files: [
      { path: 'app.json', text: JSON.stringify({ title: 'Notes', capabilities: { db: {}, sample: {} } }) },
      { path: 'index.html', text: '<!doctype html><title>Notes</title><h1>Notes</h1>' }] });
  });

  // 1. Let in a member.
  await page.click('a.dtab:has-text("People")');
  const patRow = page.locator('tr', { hasText: 'pat@example.com' });
  await patRow.locator('button:has-text("Let in")').click();
  await patRow.locator('td:has-text("member")').waitFor();
  // 2. Grant a comp.
  await patRow.locator('button:has-text("Grant comp")').click();
  await patRow.locator('text=comp until').waitFor();
  await page.screenshot({ path: `${shots}/p7-people.png` });

  // 3. Set an LLM budget.
  await page.click('a.dtab:has-text("LLM")');
  await page.fill('input[aria-label=Subject]', '@subscriber');
  await page.fill('input[aria-label=Budget]', '2000000');
  await page.click('button:has-text("Set")');
  await page.locator('tr', { hasText: '@subscriber' }).locator('text=2,000,000').waitFor();
  await page.screenshot({ path: `${shots}/p7-llm.png` });

  // 4. Turn a policy cell on.
  await page.click('a.dtab:has-text("Apps")');
  await page.locator('tr', { hasText: 'notes' }).first().click();
  const cell = page.locator('button[aria-label="sample for subscriber"]');
  await cell.click();
  await page.locator('button[aria-label="sample for subscriber"][aria-pressed=true]').waitFor();
  await page.screenshot({ path: `${shots}/p7-policy.png` });

  // 5. Mount the app.
  await page.click('a.dtab:has-text("Sites")');
  await page.selectOption('select[aria-label=Host]', { label: 'apps.localhost:18310 · live' });
  await page.fill('input[aria-label=Path]', '/notes');
  await page.fill('input[aria-label=Store]', 'notes');
  await page.click('button:has-text("Mount")');
  await page.locator('a', { hasText: 'apps.localhost:18310/notes' }).waitFor();
  await page.screenshot({ path: `${shots}/p7-sites.png` });

  // 6. Each change is in Activity.
  await page.click('a.dtab:has-text("Activity")');
  await page.locator('h2.stitle', { hasText: 'Activity' }).waitFor();
  await page.locator('table.rt td', { hasText: 'role of Pat' }).first().waitFor();
  const text = await page.locator('table.rt').innerText();
  const want = [/role of Pat: pending → member/, /comp for Pat until/, /llm @subscriber on/, /policy notes sample @subscriber on/, /apps\.localhost:18310\/notes/];
  const missing = want.filter((re) => !re.test(text));
  await page.screenshot({ path: `${shots}/p7-activity.png` });
  if (missing.length) throw new Error('missing in Activity: ' + missing.join(', ') + '\n' + text);
  // Explain answers with a trace.
  await page.click('a.dtab:has-text("Explain")');
  await page.fill('input[aria-label=Store]', 'notes');
  await page.fill('input[aria-label=Who]', 'pat@example.com');
  await page.click('form button:has-text("Explain")');
  await page.waitForSelector('.answer');
  await page.screenshot({ path: `${shots}/p7-explain.png` });
  console.log('P7 back office: all five changes found in Activity');
} catch (e) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  if (pages[0]) await pages[0].screenshot({ path: `${shots}/p7-failure.png` });
  throw e;
} finally {
  await browser.close();
}
