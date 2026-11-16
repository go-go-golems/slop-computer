import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import fs from 'fs'
const mock = fs.readFileSync(new URL('./mock.js', import.meta.url), 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } })
const p = await ctx.newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')))
p.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console.error:', m.text().slice(0, 300)) })
await p.addInitScript(mock)
await p.goto('http://localhost:8765/index.html')
const step = async (name, fn) => { try { const r = await fn(); console.log('ok  ', name, r !== undefined ? JSON.stringify(r).slice(0, 400) : '') } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]) } }
const tab = name => p.evaluate(n => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith(n)); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 1, clientY: 1 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) }, name)
const frameOf = async route => { const i = await p.evaluate(r => [...document.querySelectorAll('.frm')].findIndex(f => f.querySelector('.route').value === r), route); return p.locator('.frm').nth(i).frameLocator('iframe').first() }
await p.waitForSelector('.projbtn .ptitle'); await p.waitForTimeout(2500)
await step('text edit via dblclick', async () => {
  const fr = await frameOf('index.html')
  await fr.locator('h1').dispatchEvent('dblclick')
  await fr.locator('h1').evaluate(el => { el.textContent = 'Slow coffee, made well.'; el.blur() })
  await p.waitForTimeout(800)
  return p.evaluate(() => [...document.querySelectorAll('#toast')].map(t => t.textContent))
})
await step('source changed', async () => { await tab('Eval'); await p.fill('.view[data-view=evalrepl] textarea', 'return (await files.read("index.html")).match(/<h1[^>]*>.*<\\/h1>/)[0]'); await p.click('.view[data-view=evalrepl] .btn.primary'); await p.waitForTimeout(800); return p.evaluate(() => document.querySelector('.view[data-view=evalrepl] .scroll pre').textContent) })
await step('inspector css edit', async () => {
  const fr = await frameOf('index.html'); await fr.locator('.cta').dispatchEvent('click'); await p.waitForTimeout(900)
  const n = await p.evaluate(() => { const ins = [...document.querySelectorAll('.view[data-view=inspector] input')]; const i = ins.find(x => x.value === '4px'); if (!i) return ins.map(x => x.value); i.value = '24px'; i.dispatchEvent(new Event('change')); return 'changed' })
  await p.waitForTimeout(900)
  return [n, await p.evaluate(() => [...document.querySelectorAll('.view[data-view=inspector] input')].map(i => i.value).join(' '))]
})
await step('comment pin', async () => {
  await p.click('.seg.modes button[data-m=comment]')
  const fr = await frameOf('cart.html'); await fr.locator('h1').dispatchEvent('click', { clientX: 30, clientY: 30 })
  await p.waitForTimeout(400); await p.fill('.pinpop textarea', 'Make the total bigger'); await p.click('.pinpop .btn.primary'); await p.waitForTimeout(500)
  const pins = await fr.locator('.__sbpin').count()
  await p.click('.seg.modes button[data-m=select]')
  return { pins, meta: await p.evaluate(() => document.querySelector('.composer .ctxchips').innerText) }
})
await step('data edit -> page live', async () => {
  await tab('Data'); await p.waitForTimeout(300)
  await p.evaluate(() => { const r = [...document.querySelectorAll('.view[data-view=data] .tlist button')].find(b => b.textContent.startsWith('menu')); r.click() })
  await p.waitForTimeout(200)
  await p.evaluate(() => { const inp = document.querySelector('.view[data-view=data] tbody tr:nth-child(2) td:nth-child(2) input'); inp.value = 'Flat white XL'; inp.dispatchEvent(new Event('change')) })
  await p.waitForTimeout(1200)
  const fr = await frameOf('index.html'); await fr.locator('h1').evaluate(() => 0); return p.evaluate(() => 0) && fr.locator('#picks').textContent()
})
await step('play: add to cart syncs other frame', async () => {
  await p.click('.seg.modes button[data-m=play]')
  const fr = await frameOf('menu.html'); await fr.locator('.add').first().dispatchEvent('click'); await p.waitForTimeout(500)
  const cart = await frameOf('cart.html'); const t = await cart.locator('#lines').innerText()
  await cart.locator('input[name=name]').fill('Wes'); await cart.locator('button.cta').dispatchEvent('click'); await p.waitForTimeout(800)
  const done = await cart.locator('#done').innerText()
  const orders = await (await frameOf('orders.html')).locator('#queue').innerText()
  await p.click('.seg.modes button[data-m=select]')
  return { t, done, orders }
})
await step('read-only policy + ask mode + timeout', async () => {
  await tab('Eval')
  const res = await p.evaluate(async () => {
    const out = {}
    return out
  })
  // read-only through the agent: switch thread mode to Read-only and loop forever script -> times out
  await tab('Agent'); await p.click('.composer .seg button:nth-child(3)')   // Read-only
  await p.fill('.composer textarea', 'loop forever please'); await p.press('.composer textarea', 'Enter')
  await p.waitForFunction(() => !document.querySelector('.pill.busy'), null, { timeout: 60000 })
  return p.evaluate(() => [...document.querySelectorAll('.chat .msg.agent')].pop().innerText.slice(0, 300))
})
await step('dock: drag Data tab to the canvas right edge', async () => {
  const lbl = p.locator('.dtab[data-view=data] .lbl'); const bb = await lbl.boundingBox()
  const cv = await p.locator('.tile:has(.dtab[data-view=canvas])').boundingBox()
  await p.mouse.move(bb.x + 5, bb.y + 5); await p.mouse.down(); await p.mouse.move(bb.x + 40, bb.y + 5, { steps: 4 })
  await p.mouse.move(cv.x + cv.width - 10, cv.y + cv.height / 2, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(1500)
  return p.evaluate(() => [...document.querySelectorAll('.tile')].map(t => [...t.querySelectorAll('.dtab')].map(d => d.dataset.view).join('+')))
})
await step('frames survived re-parenting', async () => { await p.waitForTimeout(1500); return p.evaluate(() => [...document.querySelectorAll('.frm .meta')].map(m => m.textContent)) })
await step('float the console', async () => {
  await p.evaluate(() => { const t = document.querySelector('.tile:has(.dtab[data-view=console])'); t.querySelector('.dtab[data-view=console] .lbl').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); t.querySelectorAll('.tabact')[1].click() })
  await p.waitForTimeout(300); return p.evaluate(() => document.querySelector('.float .fhead')?.innerText)
})
await p.screenshot({ path: 'test/m1.png' })
await step('persist + reload', async () => {
  await p.evaluate(() => window.claude.use('db')); await p.waitForTimeout(3500)
  const saved = await p.evaluate(() => JSON.stringify([...window.__mock.store]))
  await p.addInitScript(s => { window.__seed = s }, saved)
  await p.addInitScript(() => { const orig = window.claude.use; window.claude = { use: async n => { const r = await orig(n); if (n === 'db' && window.__seed && !window.__seeded) { window.__seeded = 1; for (const [k, v] of JSON.parse(window.__seed)) window.__mock.store.set(k, v) } return r } } })
  await p.reload(); await p.waitForSelector('.projbtn .ptitle'); await p.waitForTimeout(2500)
  return p.evaluate(() => ({ title: document.querySelector('.projbtn').innerText, tiles: [...document.querySelectorAll('.tile')].length, floats: document.querySelectorAll('.float').length, marks: document.querySelectorAll('.frm').length, pins: 0 }))
})
await step('timeline after reload', async () => { await tab('Timeline'); await p.waitForTimeout(500); return p.evaluate(() => document.querySelectorAll('.story > button').length) })
await step('download project (zip)', async () => { const dl = p.waitForEvent('download', { timeout: 8000 }).catch(() => null); await p.click('.projbtn'); await p.click('text=Download project'); const d = await dl; return d ? d.suggestedFilename() : 'no download event' })
await step('delete project', async () => { await p.click('.projbtn'); await p.click('text=Delete project…'); await p.click('.modal .btn.danger'); await p.waitForTimeout(1500); return p.evaluate(() => document.querySelector('.projbtn').innerText) })
await p.screenshot({ path: 'test/m2.png' })
await b.close()
