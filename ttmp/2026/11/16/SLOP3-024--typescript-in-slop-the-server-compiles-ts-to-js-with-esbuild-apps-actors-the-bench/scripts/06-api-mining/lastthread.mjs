import { chromium } from '/home/manuel/.claude/jobs/3f423ad3/tmp/bd/benchdrive/node_modules/playwright/index.mjs'
const app = process.argv[2]
const b = await chromium.launch(); const p = await (await b.newContext()).newPage()
await p.goto('http://apps.localhost:18494/_site/login?return=/bench')
if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Admin'); await p.click('form button') }
await p.waitForURL(/bench/)
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
const out = await f.evaluate(async app => {
  const P = await window.__SB.Projects.open(app), res = { proposals: [...P.proposals.values()].map(x => ({ ref: x.ref, status: x.status, title: x.title.slice(0, 50), thread: x.thread })), turns: [] }
  for (const th of [...P.threads.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 1)) {
    await P.loadThread(th.id)
    const ms = (th.msgs || []).slice(-6)
    for (const m of ms) res.turns.push({ th: th.id, role: m.role, ws: m.ws, status: m.status, text: (m.text || '').slice(0, 220), auto: m.auto, steps: (m.steps || []).map(s => (s.status || '') + ' ' + (s.effects ? JSON.stringify(s.effects).slice(0, 140) : '')) })
  }
  return res
}, app)
console.log(process.argv[3] ? (out.turns.find(t => t.ws === process.argv[3] && t.role === "agent") || {}).text : JSON.stringify(out, null, 1)); await b.close()
