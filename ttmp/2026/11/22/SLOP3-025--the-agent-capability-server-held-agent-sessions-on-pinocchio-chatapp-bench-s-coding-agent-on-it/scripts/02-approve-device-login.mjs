// require() honours NODE_PATH (an ES import does not), so playwright may live anywhere on it.
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const [url] = process.argv.slice(2)
// CHROME: a browser binary when Playwright's own download does not fit (e.g. arm64 Linux).
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
const p = await b.newPage()
await p.goto(url, { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 3; i++) {
  if (await p.locator('input[name=email]').count()) {
    await p.fill('input[name=email]', 'admin@example.com')
    if (await p.locator('input[name=name]').count()) await p.fill('input[name=name]', 'Admin')
    await Promise.all([p.waitForLoadState('domcontentloaded'), p.locator('form button, form input[type=submit]').first().click()])
    if (!p.url().includes('/device')) await p.goto(url, { waitUntil: 'domcontentloaded' })
    continue
  }
  const approve = p.getByRole('button', { name: /approve|allow/i })
  if (await approve.count()) { await approve.first().click(); await p.waitForTimeout(800); break }
  await p.waitForTimeout(500)
}
console.log((await p.locator('body').innerText()).slice(0, 600))
await b.close()
