import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import fs from 'fs'
const mock = fs.readFileSync(new URL('./mock.js', import.meta.url), 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } })
const p = await ctx.newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack?.split('\n')[1]))
p.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console.error:', m.text().slice(0, 200)) })
await p.addInitScript(mock)
await p.goto('http://localhost:8765/index.html'); await p.waitForSelector('.projbtn .ptitle'); await p.waitForTimeout(3000)
const tab = name => p.evaluate(n => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith(n)); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) }, name)
await tab('Eval'); await p.waitForTimeout(300)
const run = async (code, len = 700) => {
  await p.fill('.view[data-view=evalrepl] textarea', code)
  const n0 = await p.evaluate(() => document.querySelectorAll('.view[data-view=evalrepl] .scroll > .block').length)
  await p.click('.view[data-view=evalrepl] .btn.primary')
  await p.waitForFunction(n => { const c = document.querySelector('.view[data-view=evalrepl] .scroll > .block'); return document.querySelectorAll('.view[data-view=evalrepl] .scroll > .block').length > n && c && !/Running/.test(c.innerText) }, n0, { timeout: 60000 })
  return p.evaluate(l => document.querySelector('.view[data-view=evalrepl] .scroll > .block').innerText.replace(/\n+/g, ' ⏎ ').replace(/Edit again/, '').slice(0, l), len)
}
const T = async (name, code, len) => { try { console.log('•', name, '→', await run(code, len)) } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]) } }
await T('frames', "const fs = await frames.list()\nconst menu = fs.find(f => f.route === 'menu.html')\nreturn fs.map(f => f.id + ' ' + f.route + ' ' + f.w)")
await T('waitFor + count + attrs + has-text', "const m = (await frames.list()).find(f => f.route === 'menu.html')\nawait frames.reload(m.id)\nconst first = await frames.waitFor(m.id, '#items li')\nconst n = await frames.count(m.id, '#items li')\nconst add = (await frames.query(m.id, 'button.add'))[0]\nconst tea = await frames.query(m.id, 'button:has-text(\"Tea\")')\nreturn { first: first.text.slice(0, 30), n, addAttrs: add.attrs, tea: tea.map(t => t.text) }")
await T('layout', "const m = (await frames.list()).find(f => f.route === 'menu.html')\nconst L = await frames.layout(m.id, { near: 'cats' })\nreturn { height: L.height, count: L.count, cats: L.items.slice(0, 3) }")
await T('snapshot', "const m = (await frames.list()).find(f => f.route === 'menu.html')\nconst s = await frames.snapshot(m.id, 'before wrap')\nreturn s")
await T('effects layout', "return await files.replace('styles.css', '.cats { display: flex; gap: 8px; margin-bottom: 12px; }', '.cats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }')", 1200)
await T('compare with snapshot', "const m = (await frames.list()).find(f => f.route === 'menu.html')\nreturn await frames.compare(m.id)", 900)
await T('fixture capture + save', "await fixtures.capture('live-copy', { tables: ['menu'] })\nawait fixtures.save('two-items', { description: 'a short menu, after closing', tables: { menu: [{ id: 1, name: 'Flat white with a very long name that wraps', desc: 'x', price: 4.2, cat: 'coffee' }, { id: 2, name: 'Scone', desc: 'y', price: 3, cat: 'bakery' }] }, clock: '2026-05-01T21:30' })\nreturn await fixtures.list()")
await T('bad fixture', "return await fixtures.save('bad', { tables: { menu: 'nope' } })")
await T('frame on fixture', "const f = await frames.open('menu.html', { fixture: 'two-items', label: 'Short menu', x: 0, y: 900 })\nawait frames.waitFor(f.id, '#items li')\nreturn { frame: f, rows: await frames.count(f.id, '#items li'), data: await frames.data(f.id), live: (await data.rows('menu')).length }")
await T('scenario save + run (pass)', `await scenarios.save('order-latte', { description: 'Add a drink, check out, the bar gets the order', page: 'menu.html', steps: [
  { waitFor: '#items li' }, { click: 'button.add' }, { expect: '#cartCount', text: '1' }, { go: 'cart.html' },
  { expect: '#lines li', count: 1 }, { type: 'input[name=name]', text: 'Ana Test' }, { click: 'button:has-text("Place order")' },
  { expect: '#done', text: 'Thanks Ana' }, { data: 'orders', where: { name: 'Ana Test' }, count: 1 }, { store: 'cart', count: 0 }, { snapshot: 'order placed' } ] })
const r = await scenarios.run('order-latte')
return { r, liveOrdersWithAnaTest: (await data.rows('orders', { name: 'Ana Test' })).length }`, 1400)
await T('scenario (fail)', "await scenarios.save('empty-menu', { page: 'menu.html', fixture: 'two-items', steps: [{ waitFor: '#items li' }, { expect: '#items li', count: 3, timeout: 400 }] })\nreturn await scenarios.run('empty-menu')", 900)
await T('bad scenario', "return await scenarios.save('x', { page: 'a.html', steps: [{ hover: 'a' }] })")
await T('runAll', "return await scenarios.runAll()", 900)
// proposal data
await tab('Review'); await p.waitForTimeout(300)
await p.click('.view[data-view=review] .toolbar button:has-text("+ Draft")'); await p.waitForTimeout(600)
await tab('Eval'); await p.waitForTimeout(200)
await T('data in proposal', "const ws = await session.workspace()\nconst r = await data.insert('menu', { name: 'Cortado', desc: 'small', price: 3.6, cat: 'coffee' })\nawait data.update('menu', 1, { price: 9.99 })\nreturn { ws: ws.title, inProposal: (await data.rows('menu')).length, tables: await data.tables() }")
await T('proposal layout vs main', "const m = (await frames.list()).find(f => f.route === 'menu.html')\nreturn await frames.compare(m.id)", 900)
await tab('Review'); await p.waitForTimeout(400)
console.log('review card:', (await p.locator('.view[data-view=review] .ovcard').first().innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 500))
await p.click('.view[data-view=review] .ovcard .checks button'); 
await p.waitForFunction(() => /Check again/.test(document.querySelector('.view[data-view=review] .ovcard .checks')?.innerText || ''), null, { timeout: 60000 })
console.log('checks:', (await p.locator('.view[data-view=review] .ovcard .checks').first().innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 900))
await p.locator('.view[data-view=review] .ovcard').first().screenshot({ path: 'test/review-checks.png' })
// compare frozen frames
const cmp = p.locator('.view[data-view=review] .checks button:has-text("compare frozen frames")').first()
if (await cmp.count()) { await cmp.click(); await p.waitForTimeout(1500); await p.locator('.modal .box').screenshot({ path: 'test/compare.png' }); console.log('modal:', (await p.locator('.modal .box').innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 400)); await p.keyboard.press('Escape') }
await tab('Eval'); await p.waitForTimeout(200)
await T('main still live', "return { ws: (await session.workspace()).ws }")
// accept from Review
await tab('Review'); await p.waitForTimeout(300)
await p.click('.view[data-view=review] .ovcard header .btn.primary'); await p.waitForTimeout(800)
await tab('Eval'); await p.waitForTimeout(200)
await T('after accept, main', "return { ws: (await session.workspace()).ws, rows: (await data.rows('menu')).length, first: (await data.rows('menu', { id: 1 }))[0].price }")
// scenarios panel
await tab('Scenarios'); await p.waitForTimeout(500)
await p.click('.view[data-view=scenarios] .toolbar button:has-text("Run all")')
await p.waitForFunction(() => !/Running/.test(document.querySelector('.view[data-view=scenarios] .toolbar')?.innerText || 'Running'), null, { timeout: 60000 }); await p.waitForTimeout(1600)
console.log('panel:', (await p.locator('.view[data-view=scenarios]').innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 900))
await p.locator('.view[data-view=scenarios]').screenshot({ path: 'test/scenarios.png' })
await p.waitForTimeout(1000)
await b.close()
