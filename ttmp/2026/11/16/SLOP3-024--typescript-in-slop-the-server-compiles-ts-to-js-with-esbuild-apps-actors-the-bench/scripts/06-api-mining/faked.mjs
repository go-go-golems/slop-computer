import { chromium } from '/home/manuel/.claude/jobs/3f423ad3/tmp/bd/benchdrive/node_modules/playwright/index.mjs'
const apps = process.argv.slice(2)
const b = await chromium.launch(); const p = await (await b.newContext()).newPage()
await p.goto('http://apps.localhost:18494/_site/login?return=/bench')
if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Admin'); await p.click('form button') }
await p.waitForURL(/bench/)
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
const re = /\[evals?\b[^\]\n]{0,12}\n?[\s\S]{0,400}?\bawait\s+(files|app|frames|scenarios|fixtures|session|types|lib|ui|publish)\.\w+\(|```(js|javascript|ts)?\s*\n[\s\S]{0,600}?\bawait\s+(files|app|frames|scenarios|fixtures|session|types|lib|ui|publish)\.\w+\(/
for (const app of apps) {
  const r = await f.evaluate(async ([app, src]) => {
    const re = new RegExp(src), P = await window.__SB.Projects.open(app); let agent = 0, faked = 0, withSteps = 0
    for (const th of P.threads.values()) { await P.loadThread(th.id); for (const m of th.msgs || []) if (m.role === 'agent') { agent++; if (re.test(m.text || '')) { if ((m.steps || []).length) withSteps++; else faked++ } } }
    return { agent, faked, withSteps }
  }, [app, re.source]).catch(e => ({ error: e.message }))
  console.log(app, JSON.stringify(r))
}
await b.close()
