import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import fs from 'fs'
const mock = fs.readFileSync(new URL('./mock.js', import.meta.url), 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack?.split('\n')[1]))
p.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console.error:', m.text().slice(0, 200)) })
await p.addInitScript(mock)
await p.goto('http://localhost:8765/index.html'); await p.waitForSelector('.projbtn .ptitle'); await p.waitForTimeout(2500)
const tab = name => p.evaluate(n => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith(n)); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) }, name)
const fl = route => p.frameLocator('.frm:has(select.route option[value="' + route + '"]:checked) .fb iframe >> nth=-1')
const style = (route, sel, prop) => fl(route).locator(sel).first().evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), prop)
await tab('Eval'); await p.waitForTimeout(200)
const run = async (code, wait = 900) => { await p.fill('.view[data-view=evalrepl] textarea', code); await p.click('.view[data-view=evalrepl] .btn.primary'); await p.waitForTimeout(wait); return (await p.locator('.view[data-view=evalrepl] .scroll > .block').first().innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 500) }
console.log('theme panel:', await run(`return await ui.panel('look', { title: 'Look', items: [
  { type: 'toggle', id: 'matrix', label: 'Matrix', bind: { css: { on: { '--crema': '#00ff41', 'body': { 'font-family': '"Courier New", monospace', background: '#020a04', color: '#00ff41' } }, off: {} } } },
  { type: 'select', id: 'font', label: 'Font', bind: { css: { sans: { 'body': { 'font-family': 'system-ui, sans-serif' } }, serif: { 'body': { 'font-family': 'Georgia, serif' } } } } },
  { type: 'list', label: 'Canvas activity', from: { frameEvents: true, limit: 6 } },
  { type: 'value', label: 'clicks', from: { frameEvents: 'click', count: true } } ] })`))
console.log('bad css:', await run("return await ui.panel('x', { items: [{ type: 'toggle', id: 't', bind: { css: { on: { body: 'red' } } } }] })"))
const card = p.locator('.view[data-view=panels] .panel[data-panel=look]')
const f0 = await style('menu.html', 'body', 'font-family')
await card.locator('.prow:has-text("Matrix") input[type=checkbox]').check(); await p.waitForTimeout(400)
console.log('matrix on:', f0, '→', await style('menu.html', 'body', 'font-family'), '| bg', await style('menu.html', 'body', 'background-color'), '| --crema', await style('menu.html', 'html', '--crema'))
await card.locator('.prow:has-text("Matrix") input[type=checkbox]').uncheck(); await p.waitForTimeout(300)
console.log('matrix off:', await style('menu.html', 'body', 'font-family'), '| previews', await p.evaluate(() => document.querySelectorAll('.view[data-view=panels] .pfoot').length))
await card.locator('.prow:has-text("Font") select').selectOption('serif'); await p.waitForTimeout(300)
console.log('serif:', await style('menu.html', 'body', 'font-family'))
await card.locator('.pfoot button:has-text("Keep")').click(); await p.waitForTimeout(500)
console.log('kept:', await p.evaluate(() => { const t = window.__SB.App.P.read('styles.css'); return t.match(/body\s*\{[^}]*\}/)[0].replace(/\s+/g, ' ') }))
// frame events: click in a frame (Play mode) and wait for it from code
await p.evaluate(() => { window.__SB.App.canvas.zoomTo(1); window.__SB.App.canvas.focusFrame(window.__SB.App.P.board().frames[1].id) })
await p.click('.seg.modes button[data-m=play]')
await p.fill('.view[data-view=evalrepl] textarea', "const e = await session.waitFor('click', { frame: 'menu.html', match: 'Add', timeout: 8000 })\nreturn { e, recent: (await session.stream({ kind: ['click', 'change', 'write'], limit: 4 })).map(x => x.source + ':' + x.kind + ' ' + x.detail.slice(0, 40)) }")
await p.click('.view[data-view=evalrepl] .btn.primary'); await p.waitForTimeout(600)
await fl('menu.html').locator('button.add').first().click(); await p.waitForTimeout(1200)
console.log('waitFor:', (await p.locator('.view[data-view=evalrepl] .scroll > .block').first().innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 600))
console.log('activity widget:', (await card.innerText()).replace(/\n+/g, ' | ').split('Canvas activity')[1]?.slice(0, 300))
console.log('timeout:', await run("return await session.waitFor('error', { timeout: 600 })", 1200))
await card.screenshot({ path: 'test/panel-theme.png' })
await b.close()
