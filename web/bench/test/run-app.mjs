import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import fs from 'fs'
const mock = fs.readFileSync(new URL('./mock.js', import.meta.url), 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => { errs.push('pageerror: ' + e.message); console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')) })
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console.' + m.type() + ':', m.text().slice(0, 300)) })
if (process.argv[2] !== 'nomock') await p.addInitScript(mock)
await p.goto('http://localhost:8765/index.html')
const step = async (name, fn) => { try { const r = await fn(); console.log('ok  ', name, r !== undefined ? JSON.stringify(r).slice(0, 300) : '') } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]) } }
await step('boot', () => p.waitForSelector('.projbtn .ptitle', { timeout: 10000 }).then(() => p.textContent('.projbtn')))
await p.waitForTimeout(2500)
await step('frames', () => p.evaluate(() => [...document.querySelectorAll('.frm .route')].map(s => s.value)))
await step('health', () => p.textContent('.bar .pill'))
await step('issues', async () => { await p.click('.bar .pill'); const t = await p.evaluate(() => document.querySelector('.menu').innerText); await p.keyboard.press('Escape'); await p.mouse.click(5, 990); return t })
await step('store mode', () => p.evaluate(() => [window.__mock && window.__mock.store.size]))
await p.screenshot({ path: 'test/s1.png' })
// select an element in the menu frame
await step('select in frame', async () => {
  const idx = await p.evaluate(() => [...document.querySelectorAll('.frm')].findIndex(f => f.querySelector('.route').value === 'menu.html'))
  const fr = p.locator('.frm').nth(idx).frameLocator('iframe').first()
  await fr.locator('.cat').first().dispatchEvent('click')
  await p.waitForTimeout(500)
  return p.evaluate(() => document.querySelector('.view[data-view=inspector]')?.innerText.slice(0, 200))
})
await step('code jumped', () => p.evaluate(() => document.querySelector('.efoot b')?.textContent))
// agent turn
await step('agent send', async () => {
  await p.fill('.composer textarea', 'Fix the overflow on the menu at phone width')
  await p.press('.composer textarea', 'Enter')
  await p.waitForFunction(() => !document.querySelector('.pill.busy'), null, { timeout: 30000 })
  await p.waitForTimeout(600)
  return p.evaluate(() => ({ steps: document.querySelectorAll('.chat details.step').length, bad: document.querySelectorAll('.chat details.step.bad').length, ws: document.querySelector('.wsbtn').innerText, text: document.querySelector('.msg.agent .body')?.innerText.slice(0, 80), toolLog: (window.__toolLog || []).map(s => s.slice(0, 160)) }))
})
await p.screenshot({ path: 'test/s2.png' })
await step('review', async () => {
  await p.evaluate(() => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith('Review')); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) })
  await p.waitForTimeout(300)
  return p.evaluate(() => document.querySelector('.view[data-view=review]').innerText.slice(0, 300))
})
await step('accept', async () => {
  await p.click('.ovcard button.btn.primary')
  await p.waitForTimeout(1500)
  return p.evaluate(() => ({ ws: document.querySelector('.wsbtn').innerText, health: document.querySelector('.bar .pill').innerText }))
})
await step('timeline', async () => {
  await p.evaluate(() => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith('Timeline')); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) })
  await p.waitForTimeout(400)
  return p.evaluate(() => ({ dots: document.querySelectorAll('.tlsvg circle, .tlsvg path').length, story: document.querySelectorAll('.story > button').length, side: document.querySelector('.tlside').innerText.slice(0, 200) }))
})
await p.screenshot({ path: 'test/s3.png' })
await step('eval repl', async () => {
  await p.evaluate(() => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith('Eval')); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) })
  await p.click('.view[data-view=evalrepl] .btn.primary')
  await p.waitForTimeout(2500)
  return p.evaluate(() => document.querySelector('.view[data-view=evalrepl] .scroll').innerText.slice(0, 300))
})
await step('new project', async () => {
  await p.click('.projbtn'); await p.click('text=New project…'); await p.click('.tcards button:nth-child(2)'); await p.click('.modal footer .btn.primary')
  await p.waitForTimeout(2000)
  return p.evaluate(() => ({ title: document.querySelector('.projbtn').innerText, frames: document.querySelectorAll('.frm').length }))
})
await step('switch back', async () => {
  await p.click('.projbtn'); await p.click('.menu button:nth-child(3)')
  await p.waitForTimeout(1500)
  return p.evaluate(() => ({ title: document.querySelector('.projbtn').innerText, frames: document.querySelectorAll('.frm').length }))
})
await step('reload persists', async () => {
  await p.evaluate(() => { window.__saved = JSON.stringify([...window.__mock.store]) })
  const saved = await p.evaluate(() => window.__saved)
  await p.addInitScript(s => { window.__restore = s }, saved)
  return saved.length
})
console.log('errors:', errs.length)
await b.close()
