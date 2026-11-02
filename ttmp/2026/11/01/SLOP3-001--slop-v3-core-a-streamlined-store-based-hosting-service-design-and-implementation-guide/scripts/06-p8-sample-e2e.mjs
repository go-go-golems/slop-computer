// P8: a deployed francois app reaches the model through sample, on the
// real Pi worker (slop serve with llm: pi). A guest on polis (policy
// sample on for @guest, an @guest budget), then a signed-in admin on
// capabilities. Each call is metered: llm.usage shows the tokens.
//
//   NODE_PATH=<playwright node_modules> node 06-p8-sample-e2e.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const LIVE = 'http://apps.localhost:18300';
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures++; };

async function appFrame(page, url) {
  await page.goto(url);
  const el = await page.waitForSelector('iframe', { timeout: 10000 });
  const frame = await el.contentFrame();
  await frame.waitForLoadState('load');
  return frame;
}

// ask runs sample in the app's frame, as the app itself would.
const ask = (frame) => frame.evaluate(async () => {
  const sample = await claude.use('sample');
  if (!sample) return { error: 'sample is null' };
  try {
    const r = await sample('Reply with exactly these two words and nothing else: slop ok');
    return { text: r.text };
  } catch (e) {
    return { error: `${e.code}: ${e.message}` };
  }
});

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const guest = await ask(await appFrame(page, `${LIVE}/f/polis/`));
  check(guest.text && /slop ok/i.test(guest.text), `guest on polis: ${JSON.stringify(guest)}`);

  // The admin signs in through the shell: main host form, then back.
  await page.goto(`${LIVE}/f/capabilities/`);
  await page.getByText('Sign in').click();
  await page.fill('input[name=email]', 'admin@example.com');
  await page.fill('input[name=name]', 'Admin');
  await Promise.all([page.waitForURL(/apps\.localhost:18300\/f\/capabilities/), page.click('button')]);
  const frame = await appFrame(page, `${LIVE}/f/capabilities/`);
  const who = await page.locator('header').innerText();
  const admin = await ask(frame);
  check(admin.text && /slop ok/i.test(admin.text), `admin on capabilities (${who.replace(/\s+/g, ' ').trim()}): ${JSON.stringify(admin)}`);
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
