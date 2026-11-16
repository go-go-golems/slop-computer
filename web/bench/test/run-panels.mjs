import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import fs from 'fs'
const mock = fs.readFileSync(new URL('./mock.js', import.meta.url), 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack?.split('\n')[1]))
p.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console.error:', m.text().slice(0, 200)) })
await p.addInitScript(mock)
await p.goto('http://localhost:8765/index.html'); await p.waitForSelector('.projbtn .ptitle'); await p.waitForTimeout(2500)
await p.click('.composer .seg:nth-of-type(2) button:nth-child(2)')   // Main
const send = async t => { await p.fill('.composer textarea', t); await p.press('.composer textarea', 'Enter'); await p.waitForTimeout(200) }
const idle = () => p.waitForFunction(() => !document.querySelector('.pill.busy'), null, { timeout: 30000 })
const fl = route => p.frameLocator('.frm:has(select.route option[value="' + route + '"]:checked) .fb iframe >> nth=-1')
const frameStyle = (route, sel, prop) => fl(route).locator(sel).first().evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), prop)
await send('PANEL TEST'); await idle(); await p.waitForTimeout(1500)
const panel = p.locator('.chat .panel').first()
console.log('panel:', (await panel.innerText()).replace(/\n+/g, ' | ').slice(0, 600))
await panel.screenshot({ path: 'test/panel.png' })
// slider -> preview in the frames
const gap0 = await frameStyle('menu.html', '.cats', 'gap')
await panel.locator('.prow:has-text("Category gap") input[type=range]').fill('20'); await p.waitForTimeout(400)
console.log('gap', gap0, '→', await frameStyle('menu.html', '.cats', 'gap'), '· file unchanged:', await p.evaluate(() => /gap: 20px/.test(window.__SB.App.P.read('styles.css'))))
console.log('foot:', (await panel.locator('.pfoot').innerText()).replace(/\n+/g, ' | '))
// markup slider drives the eval widget
await panel.locator('.prow:has-text("Price markup") input[type=range]').fill('1.5'); await p.waitForTimeout(1200)
console.log('avg widget:', (await panel.locator('.pw.val').first().innerText()).replace(/\n+/g, ' | '))
// keep -> written to styles.css, preview cleared
await panel.locator('.pfoot button:has-text("Keep")').click(); await p.waitForTimeout(700)
console.log('kept:', await p.evaluate(() => { const t = window.__SB.App.P.read('styles.css'); const i = t.indexOf('.cats'); return t.slice(i, i + 90).replace(/\n/g, ' ') }), '· previews left:', await panel.locator('.pfoot').count(), '· gap now', await frameStyle('menu.html', '.cats', 'gap'))
// toggle the fixture
await panel.locator('.prow:has-text("Short menu") input[type=checkbox]').check(); await p.waitForTimeout(1500)
console.log('fixture:', await p.evaluate(() => window.__SB.App.P.board().frames.map(f => f.route + ':' + (f.fixture || '-')).join(' ')), '· menu items in frame:', await fl('menu.html').locator('#items li').count())
await panel.locator('.prow:has-text("Short menu") input[type=checkbox]').uncheck(); await p.waitForTimeout(800)
// the button
await panel.locator('.btnrow button').click(); await p.waitForTimeout(1200)
console.log('button:', (await panel.locator('.prun').innerText()).replace(/\n+/g, ' | '))
// store-driven value: add to cart in the menu frame
await p.evaluate(() => { const f = [...document.querySelectorAll('.frm')].find(x => x.querySelector('select.route')?.value === 'menu.html'); window.__SB.App.canvas.zoomTo(1); window.__SB.App.canvas.focusFrame(window.__SB.App.P.board().frames[1].id) })
await p.click('.seg.modes button[data-m=play]')
await p.frameLocator('.frm:has(select.route option[value="menu.html"]:checked) .fb iframe >> nth=-1').locator('button.add').first().click().catch(e => console.log('click fail', e.message.slice(0, 80)))
await p.waitForTimeout(800)
console.log('cart value:', (await panel.locator('.pw.val').nth(1).innerText()).replace(/\n+/g, ' | '))
await panel.screenshot({ path: 'test/panel-after.png' })
// values from the Eval panel; pin to the tab
const tab = name => p.evaluate(n => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith(n)); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) }, name)
await tab('Eval'); await p.waitForTimeout(200)
await p.fill('.view[data-view=evalrepl] textarea', "await ui.set('menu-tuning', 'markup', 1.2)\nreturn [await ui.values('menu-tuning'), await ui.panels()]"); await p.click('.view[data-view=evalrepl] .btn.primary'); await p.waitForTimeout(800)
console.log('values:', (await p.locator('.view[data-view=evalrepl] .scroll > .block').first().innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 500))
await p.fill('.view[data-view=evalrepl] textarea', "return await ui.panel('bad', { items: [{ type: 'slider', label: 'x' }] })"); await p.click('.view[data-view=evalrepl] .btn.primary'); await p.waitForTimeout(600)
console.log('bad:', (await p.locator('.view[data-view=evalrepl] .scroll > .block').first().innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 200))
await p.fill('.view[data-view=evalrepl] textarea', "return await ui.panel('orders-live', { title: 'Orders', items: [{ type: 'value', label: 'open orders', from: { data: 'orders', count: true } }, { type: 'chart', kind: 'line', label: 'writes per minute', from: { events: 'write' } }] })"); await p.click('.view[data-view=evalrepl] .btn.primary'); await p.waitForTimeout(1200)
console.log('panels tab:', (await p.locator('.view[data-view=panels]').innerText()).replace(/\n+/g, ' | ').slice(0, 300))
await p.locator('.view[data-view=panels]').screenshot({ path: 'test/panels-tab.png' })
// ask: the turn waits for Done
await tab('Agent'); await p.waitForTimeout(200)
await send('ASK TEST'); await p.waitForTimeout(1500)
console.log('waiting:', await p.locator('.pill.busy').count(), (await p.locator('.chat .panel').last().innerText()).replace(/\n+/g, ' | '))
await p.locator('.chat .panel').last().locator('select').selectOption('playful'); await p.waitForTimeout(200)
await p.locator('.chat .panel').last().locator('.pfoot button:has-text("Use this")').click(); await idle(); await p.waitForTimeout(400)
console.log('after done:', (await p.locator('.chat details.step').last().innerText()).replace(/\n+/g, ' | ').slice(0, 300))
await b.close()
