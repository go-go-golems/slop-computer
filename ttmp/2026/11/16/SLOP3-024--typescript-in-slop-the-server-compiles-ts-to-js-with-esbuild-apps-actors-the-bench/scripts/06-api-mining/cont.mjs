import { chromium } from '/home/manuel/.claude/jobs/3f423ad3/tmp/bd/benchdrive/node_modules/playwright/index.mjs'
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
await p.goto('http://apps.localhost:18494/_site/login?return=/benchnext')
if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Audit'); await p.click('form button') }
await p.waitForURL(u => u.href.includes('/benchnext'), { timeout: 30000 })
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
await f.evaluate(() => window.__SB.App.openProject('smoke6')); await p.waitForTimeout(5000)
await f.locator('button:has-text("+ Thread")').first().click().catch(() => { }); await p.waitForTimeout(800)
const ta = f.locator('textarea[placeholder^="Ask for a change"]').first()
await ta.fill('A test of the bench, not a change: run 12 separate evals, one per tool call, the k-th returning just the number k (return 1, then return 2, … return 12). Do not combine them and change nothing. After the 12th, reply with the single word: done.'); await ta.press('Enter')
const t0 = Date.now(); let last = ''
while (Date.now() - t0 < 420000) {
  await p.waitForTimeout(5000)
  const st = await f.evaluate(() => { const A = window.__SB.Agent, P = window.__SB.App.P; const th = [...P.threads.values()].sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0))[0]; const m = (th.msgs || []).filter(x => x.role === 'agent').pop(); return { busy: A.busy(th.id), steps: m ? (m.steps || []).length : 0, text: m ? (m.text || '').slice(-300) : '' } })
  last = JSON.stringify(st); if (!st.busy && st.steps) break
}
console.log(((Date.now() - t0) / 1000 | 0) + ' s', last); await b.close()
