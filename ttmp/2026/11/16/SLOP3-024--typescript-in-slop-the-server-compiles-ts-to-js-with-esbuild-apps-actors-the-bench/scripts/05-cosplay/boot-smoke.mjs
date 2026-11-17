// boot-smoke.mjs — before a new bench build goes to the review server: sign
// in, let the bench boot, create a TypeScript app from the server-code
// template, open main.ts, and check the type checker sees a planted error.
// A broken boot (round 1's "Records.get is not a function") fails here.
//
//   PLAYWRIGHT=<path to playwright's index.mjs> BENCH=http://apps.localhost:18494/bench \
//     node boot-smoke.mjs <new app id>
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
const bench = process.env.BENCH || 'http://apps.localhost:18494/bench', id = process.argv[2]
if (!id) { console.error('usage: node boot-smoke.mjs <new app id>'); process.exit(2) }
const fail = m => { console.log('FAIL: ' + m); process.exit(1) }
const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
const errors = []
p.on('pageerror', e => errors.push(e.message))
const origin = new URL(bench).origin
await p.goto(origin + '/_site/login?return=' + encodeURIComponent(new URL(bench).pathname))
if (await p.locator('input[name=email]').count()) {
  await p.fill('input[name=email]', process.env.EMAIL || 'admin@example.com'); await p.fill('input[name=name]', 'Smoke'); await p.click('form button')
}
await p.waitForURL(u => u.href.startsWith(bench), { timeout: 30000 })
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
if (!f) fail('the bench did not boot; page errors: ' + errors.join(' | '))
const boot = await f.evaluate(() => (document.querySelector('.boot') || {}).innerText || '')
if (/could not start/i.test(boot)) fail('the bench could not start: ' + boot.replace(/\s+/g, ' ').slice(0, 300))
await f.evaluate(async id => { await window.__SB.Projects.create({ id, title: 'Smoke ' + id, template: 'actor' }); await window.__SB.App.openProject(id) }, id)
await p.waitForTimeout(9000)
await f.evaluate(() => window.__SB.App.code.open('main.ts'))
await p.waitForTimeout(3000)
const foot = () => f.evaluate(() => (document.querySelector('.efoot') || {}).innerText || '').then(t => t.replace(/\s+/g, ' '))
const before = await foot()
if (!/types ok/.test(before)) fail('a fresh app is not "types ok": ' + before)
await f.evaluate(() => { const ta = document.querySelector('.code textarea'); ta.value = ta.value.replace('{ text: input.value }', '{ txt: input.value }'); ta.dispatchEvent(new Event('input')) })
await p.waitForTimeout(3000)
const after = await foot()
if (!/1 type error/.test(after)) fail('the planted error is not found: ' + after)
console.log('ok: the bench boots; a fresh app is "types ok"; a planted error is found' + (errors.length ? ' (page errors: ' + errors.join(' | ') + ')' : ''))
await b.close()
