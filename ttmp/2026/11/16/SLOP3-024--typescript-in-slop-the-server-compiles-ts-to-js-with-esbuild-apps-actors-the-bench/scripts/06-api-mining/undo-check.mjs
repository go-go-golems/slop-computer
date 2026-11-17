import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
await p.goto('http://apps.localhost:18494/_site/login?return=/benchnext')
if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Audit'); await p.click('form button') }
await p.waitForURL(u => u.href.includes('/benchnext'), { timeout: 30000 })
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
await f.evaluate(() => window.__SB.App.openProject('smoke8')); await p.waitForTimeout(6000)
await f.evaluate(() => window.__SB.App.code.open('index.html')); await p.waitForTimeout(1500)
const before = await f.evaluate(() => window.__SB.App.P.read('index.html', 'draft'))
const ta = f.locator('textarea').filter({ hasNot: f.locator('[placeholder^="Ask"]') }).first()
const tas = f.locator('.code textarea, textarea.code, .cv textarea')
const t = (await tas.count()) ? tas.first() : ta
await t.click(); await p.keyboard.press('End'); await p.keyboard.type('p'); await p.waitForTimeout(1200)
const after = await f.evaluate(() => window.__SB.App.P.read('index.html', 'draft'))
const toastText = await f.evaluate(() => (document.querySelector('#toast') || {}).innerText || '')
await f.locator('#toast button').click().catch(e => console.log('no undo button', e.message))
await p.waitForTimeout(1200)
const restored = await f.evaluate(() => window.__SB.App.P.read('index.html', 'draft'))
console.log(JSON.stringify({ changed: after !== before, toast: toastText, restored: restored === before }))
await b.close()
