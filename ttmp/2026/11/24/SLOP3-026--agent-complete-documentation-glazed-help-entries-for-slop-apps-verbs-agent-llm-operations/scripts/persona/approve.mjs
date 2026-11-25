// approve.mjs <device-url> <email> <name> <scopes>: sign in on a --local slop
// server and approve a device login with exactly these scopes. Playwright is
// loaded from PW_DIR (an ES import would ignore NODE_PATH); CHROME may name
// the browser binary.
import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(path.join(process.env.PW_DIR || process.cwd(), 'x.js'))('playwright');
const [url, email, nm, scopes] = process.argv.slice(2);
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const p = await b.newPage();
await p.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 3; i++) {
  if (await p.locator('input[name=email]').count()) {
    await p.fill('input[name=email]', email);
    if (await p.locator('input[name=name]').count()) await p.fill('input[name=name]', nm);
    await Promise.all([p.waitForLoadState('domcontentloaded'), p.locator('form button, form input[type=submit]').first().click()]);
    if (!p.url().includes('/device')) await p.goto(url, { waitUntil: 'domcontentloaded' });
    continue;
  }
  if (scopes) for (const sc of ['read', 'write', 'admin']) {
    const cb = p.locator(`input[name=scope][value=${sc}]`);
    if (await cb.count()) { if (scopes.split(',').includes(sc)) await cb.check(); else await cb.uncheck(); }
  }
  const approve = p.getByRole('button', { name: /approve|allow/i });
  if (await approve.count()) { await approve.first().click(); await p.waitForTimeout(800); break; }
  await p.waitForTimeout(500);
}
await b.close();
