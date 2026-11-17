import { chromium } from '/home/manuel/.claude/jobs/3f423ad3/tmp/bd/benchdrive/node_modules/playwright/index.mjs'
const apps = process.argv.slice(2)
const b = await chromium.launch(); const p = await (await b.newContext()).newPage()
await p.goto('http://apps.localhost:18494/_site/login?return=/bench')
if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Admin'); await p.click('form button') }
await p.waitForURL(/bench/)
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
const r = await f.evaluate(async app => {
  const { Projects, Agent } = window.__SB, P = await Projects.open(app), out = []
  for (const th of P.threads.values()) { await P.loadThread(th.id); out.push('summary upTo ' + (th.summary && th.summary.upTo) + ' len ' + (th.summary ? th.summary.text.length : 0))
    th.msgs.forEach((m, i) => out.push(i + ' ' + m.role + ' text ' + (m.text || '').length + ' render ' + Agent.renderMsg(m, true).length + ' steps ' + (m.steps || []).length + (m.error ? ' ERR ' + m.error.slice(0, 80) : '') + ' | ' + (m.text || '').slice(0, 70).replace(/\n/g, ' '))) }
  return out
}, process.argv[2])
console.log(r.join('\n')); await b.close()
