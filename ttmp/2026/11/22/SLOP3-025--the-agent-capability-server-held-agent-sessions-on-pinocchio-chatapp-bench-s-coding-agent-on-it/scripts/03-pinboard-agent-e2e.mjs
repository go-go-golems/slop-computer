// SLOP3-026: Pinboard's agent panel on the agent capability, end to end (Chromium, --llm fake).
// usage: node 03-pinboard-agent-e2e.mjs <board url> <out dir>   (CHROME: optional browser binary)
// Signs in as admin@example.com, opens the board, Auto mode, sends "/tool eval {...}" (the fake
// model calls eval: the page runs it, 42), then a second message (the same server session).
// sign in, open the board, Auto mode, send "/tool eval {...}", read the answer.
// require() honours NODE_PATH (an ES import does not), so playwright may live anywhere on it.
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const [url, out] = process.argv.slice(2)
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
const p = await b.newPage()
const logs = []
p.on('console', m => logs.push('[page] ' + m.type() + ' ' + m.text()))
p.on('dialog', d => d.accept())
async function signIn() {
  for (let i = 0; i < 4; i++) {
    if (await p.locator('input[name=email]').count()) {
      await p.fill('input[name=email]', 'admin@example.com')
      if (await p.locator('input[name=name]').count()) await p.fill('input[name=name]', 'Admin')
      await Promise.all([p.waitForLoadState('domcontentloaded'), p.locator('form button, form input[type=submit]').first().click()])
      await p.waitForTimeout(500)
      continue
    }
    const signin = p.getByRole('link', { name: /sign in|log in/i })
    if (await signin.count()) { await Promise.all([p.waitForLoadState('domcontentloaded'), signin.first().click()]); continue }
    break
  }
}
await p.goto(url, { waitUntil: 'domcontentloaded' })
await signIn()
if (!p.url().startsWith(url)) await p.goto(url, { waitUntil: 'domcontentloaded' })
await signIn()
// The app runs in a frame on the sandbox origin; find the one with the agent panel.
let f = null
for (let i = 0; i < 60 && !f; i++) {
  for (const fr of p.frames()) if (await fr.locator('#agentpanel textarea').count().catch(() => 0)) { f = fr; break }
  if (!f) await p.waitForTimeout(500)
}
if (!f) { await p.screenshot({ path: out + '/nopanel.png' }); console.log('no agent panel; url', p.url(), '\n' + logs.join('\n')); await b.close(); process.exit(1) }
await f.waitForFunction(() => window.PB && PB.agent && (PB.agent.agent || PB.agent.sample || PB.agent.available === false), null, { timeout: 15000 })
const state = await f.evaluate(() => ({ agent: !!PB.agent.agent, sample: !!PB.agent.sample, available: PB.agent.available }))
console.log('panel:', JSON.stringify(state))
if (!(await f.locator('body.agent-open').count())) await f.click('#agentbtn')
await f.getByRole('button', { name: 'Auto' }).click()
await f.fill('#agentpanel textarea', '/tool eval {"code":"return 6 * 7","label":"multiply"}')
await f.click('#agentpanel .send')
// Consent: the runtime may ask before the first agent use (in the top page or the frame).
for (let i = 0; i < 20; i++) {
  let clicked = false
  for (const ctx of [p, ...p.frames()]) {
    const allow = ctx.getByRole('button', { name: /^(allow|approve|continue|yes)/i })
    if (await allow.count().catch(() => 0)) { await allow.first().click().catch(() => {}); clicked = true; console.log('consent clicked'); break }
  }
  const done = await f.evaluate(() => { const m = PB.agent.cur && PB.agent.cur.msgs.at(-1); return m && m.role === 'agent' && m.status === 'done' }).catch(() => false)
  if (done) break
  if (!clicked) await p.waitForTimeout(500)
}
await f.waitForFunction(() => { const m = PB.agent.cur && PB.agent.cur.msgs.at(-1); return m && m.role === 'agent' && m.status === 'done' }, null, { timeout: 30000 })
const r1 = await f.evaluate(() => { const m = PB.agent.cur.msgs.at(-1); return { text: m.text, error: m.error || null, steps: (m.steps || []).map(s => ({ code: s.code, status: s.status, result: s.result })), sessions: [...PB.agent.sessions.keys()] } })
console.log('first:', JSON.stringify(r1))
// A second message on the same thread reuses the server session.
await f.fill('#agentpanel textarea', 'hello again')
await f.click('#agentpanel .send')
await f.waitForFunction(() => { const m = PB.agent.cur && PB.agent.cur.msgs.at(-1); return m && m.role === 'agent' && m.status === 'done' && PB.agent.cur.msgs.length >= 4 }, null, { timeout: 30000 })
const r2 = await f.evaluate(() => { const m = PB.agent.cur.msgs.at(-1); return { text: m.text.slice(0, 200), error: m.error || null, sessions: [...PB.agent.sessions.keys()] } })
console.log('second:', JSON.stringify(r2))
await p.screenshot({ path: out + '/panel.png' })
console.log(logs.filter(l => /error|fail|warn/i.test(l)).slice(0, 10).join('\n'))
await b.close()
