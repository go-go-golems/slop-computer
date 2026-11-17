import { chromium } from "playwright"
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
await p.goto('http://apps.localhost:18494/_site/login?return=/benchnext')
if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Audit'); await p.click('form button') }
await p.waitForURL(u => u.href.includes('/benchnext'), { timeout: 30000 })
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
await f.evaluate(() => window.__SB.App.openProject('smoke8')); await p.waitForTimeout(5000)
await f.getByText('Eval', { exact: true }).first().click(); await p.waitForTimeout(800)
const ta = f.locator('textarea.txt.mono').first()
await ta.fill("const fr = await frames.open('index.html', { x: 6000, y: 4000, new: true })\nreturn fr.id"); await ta.press('Control+Enter'); await p.waitForTimeout(4000)
const r = await f.evaluate(() => {
  const C = window.__SB.App.canvas, P = window.__SB.App.P, fr = P.board().frames.find(x => x.x === 6000 && x.y === 4000)
  if (!fr) return { err: 'no frame at 6000,4000' }
  const v = [...C.views.values()].find(x => x.fr.id === fr.id), q = v.pos(), w = C.cv ? C.cv.getBoundingClientRect().width : 1000
  const inView = q.x * C.z + C.x > -10 && (q.x + fr.w) * C.z + C.x < w + 10
  return { id: fr.id, inView, z: C.z, x: Math.round(C.x) }
})
console.log(JSON.stringify(r))
if (r.id) { await ta.fill("return await frames.close('" + r.id + "')"); await ta.press('Control+Enter'); await p.waitForTimeout(2500) }
await b.close()
