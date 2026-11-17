import { chromium } from '/home/manuel/.claude/jobs/3f423ad3/tmp/bd/benchdrive/node_modules/playwright/index.mjs'
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
await p.goto('http://apps.localhost:18494/_site/login?return=/benchnext')
if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Audit'); await p.click('form button') }
await p.waitForURL(u => u.href.includes('/benchnext'), { timeout: 30000 })
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
await f.evaluate(() => window.__SB.App.openProject('smoke6')); await p.waitForTimeout(5000)
await f.getByText('Eval', { exact: true }).first().click(); await p.waitForTimeout(800)
const ta = f.locator('textarea.txt.mono').first()
for (const code of ["await lib.def('addOne', async n => n + 1, { description: 'adds one' })\nreturn await lib.addOne(2)", "const WEEK = 3\nawait lib.def('weekly', async n => n * WEEK, { description: 'x' })\nreturn 1"]) {
  await ta.fill(code); await ta.press('Control+Enter'); await p.waitForTimeout(3500)
  const out = await f.evaluate(() => { const ta = document.querySelector('textarea.txt.mono'); const v = ta.closest('.view') || ta.parentElement.parentElement; const t = v.innerText; const i = t.indexOf('Running') >= 0 ? 0 : 0; return t.slice(t.indexOf('What the agent is told'), t.indexOf('What the agent is told') + 500) })
  console.log('### ' + code.split('\n')[0] + '\n' + out.slice(0, 900) + '\n')
}
await b.close()
