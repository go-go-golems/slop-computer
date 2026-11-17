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
  const keep = Agent.sample, saves = ['saveThread', 'saveMeta', 'log'].filter(k => typeof P[k] === 'function'), orig = {}
  for (const k of saves) { orig[k] = P[k]; P[k] = () => { } }
  Agent.sample = async (input) => { const parts = Array.isArray(input) ? input.map(m => m.role + ':' + m.content.length) : ['string:' + input.length]; out.push(parts.join(' ')); if (Array.isArray(input)) out.push('FIRST 600: ' + input[0].content.slice(0, 600)); return { text: 'ok' } }
  try {
    for (const th0 of P.threads.values()) {
      await P.loadThread(th0.id)
      const th = { ...th0, msgs: [...th0.msgs, { role: 'user', text: 'test', t: Date.now() }], summary: th0.summary }
      const msg = { role: 'agent', text: '', steps: [], t: Date.now(), status: 'running' }
      await Agent.turn(P, th, msg, 'test', { ws: 'draft', depth: 0, budget: { max: 30, used: 0, parent: null } }).catch(e => out.push('ERR ' + e.message))
    }
  } finally { Agent.sample = keep; for (const k of saves) P[k] = orig[k] }
  return out
}, process.argv[2])
console.log(r.join('\n').slice(0, 3000)); await b.close()
