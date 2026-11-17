// Every eval step of every app's agent threads on the review server -> one JSONL line each (read-only).
import { chromium } from '/home/manuel/.claude/jobs/3f423ad3/tmp/bd/benchdrive/node_modules/playwright/index.mjs'
import fs from 'node:fs'
const apps = process.argv.slice(3), out = process.argv[2]
const b = await chromium.launch(); const p = await (await b.newContext()).newPage()
await p.goto('http://apps.localhost:18494/_site/login?return=/bench')
if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Admin'); await p.click('form button') }
await p.waitForURL(/bench/)
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
fs.writeFileSync(out, '')
for (const app of apps) {
  const rows = await f.evaluate(async app => {
    const P = await window.__SB.Projects.open(app), res = []
    for (const th of P.threads.values()) {
      await P.loadThread(th.id)
      let turn = 0
      for (const m of th.msgs || []) {
        if (m.role === 'user') turn++
        ;(m.steps || []).forEach((st, i) => res.push({ app, thread: th.id, turn, i, status: st.status, ts: !!st.ts, code: String(st.code || '').slice(0, 5000),
          error: st.error ? String(typeof st.error === 'string' ? st.error : JSON.stringify(st.error)).slice(0, 2000) : null,
          out: st.out != null ? JSON.stringify(st.out).slice(0, 600) : null, effects: st.effects ? JSON.stringify(st.effects).slice(0, 400) : null }))
      }
    }
    return res
  }, app).catch(e => [{ app, mineError: e.message }])
  for (const r of rows) fs.appendFileSync(out, JSON.stringify(r) + '\n')
  console.log(app, rows.length)
}
await b.close()
