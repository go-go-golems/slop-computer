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
// 1. you edit, 2. Claude edits in a proposal, which you accept
await p.evaluate(() => { const P = window.__SB.App.P; P.write('styles.css', P.read('styles.css').replace('.price {', '/* prices */\n.price {'), { who: 'you', note: 'comment on prices' }) })
await p.fill('.composer textarea', 'The category buttons overflow on phones, make them wrap'); await p.press('.composer textarea', 'Enter')
await p.waitForTimeout(300); await p.waitForFunction(() => !document.querySelector('.pill.busy'), null, { timeout: 30000 }); await p.waitForTimeout(500)
await tab('Review'); await p.waitForTimeout(300); await p.click('.view[data-view=review] .ovcard header .btn.primary'); await p.waitForTimeout(800)
await tab('Eval'); await p.waitForTimeout(200)
const run = async (code, wait = 900) => { await p.fill('.view[data-view=evalrepl] textarea', code); await p.click('.view[data-view=evalrepl] .btn.primary'); await p.waitForTimeout(wait); return (await p.locator('.view[data-view=evalrepl] .scroll > .block').first().innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 900) }
console.log('files.blame:', await run("const t = await files.read('styles.css'), l = t.split('\\n').findIndex(x => x.includes('.cats')) + 1\nreturn await files.blame('styles.css', { from: l - 3, to: l + 1 })"))
// blame column
await p.evaluate(() => window.__SB.App.reveal('styles.css', 1)); await p.waitForTimeout(400)
await p.click('.efoot button:has-text("Blame")'); await p.waitForTimeout(300)
const line = await p.evaluate(() => window.__SB.App.P.read('styles.css').split('\n').findIndex(x => x.includes('.cats')) + 1)
await p.evaluate(l => window.__SB.App.reveal('styles.css', l), line); await p.waitForTimeout(400)
console.log('blame rows:', await p.evaluate(() => { const rows = [...document.querySelectorAll('.eblame .bin > div.h')]; return rows.length + ' runs: ' + rows.slice(0, 6).map(r => r.textContent).join(' | ') }))
await p.locator('.view[data-view=code] .ed').screenshot({ path: 'test/blame.png' })
await p.click(`.eblame .bin > div:nth-child(${line})`); await p.waitForTimeout(400)
console.log('card:', (await p.locator('.modal .box').innerText()).replace(/\n+/g, ' | ').slice(0, 500))
await p.locator('.modal .box').screenshot({ path: 'test/blame-card.png' })
// show on canvas from the card: the page as of Claude's change; then step back before it
await p.click('.modal footer .btn.primary'); await p.waitForTimeout(1500)
console.log('playhead at claude change:', await p.evaluate(() => window.__SB.App.playhead), '· cats wrap:', await style('menu.html', '.cats', 'flex-wrap'), '· tag:', await p.locator('.frm:has(select.route option[value="menu.html"]:checked) .tag.fx').innerText(), '· hud:', (await p.locator('.view[data-view=canvas]').innerText()).match(/as of[^\n]*\n[^\n]*/)?.[0].replace(/\n/g, ' · '))
await p.click('.view[data-view=canvas] button[title="Previous change to the pages"]'); await p.waitForTimeout(1500)
console.log('one step back:', await p.evaluate(() => { const P = window.__SB.App.P, e = P.events[window.__SB.App.playhead]; return e.kind + ' ' + e.path + ' by ' + e.who }), '· cats wrap:', await style('menu.html', '.cats', 'flex-wrap'))
await p.locator('.view[data-view=canvas]').screenshot({ path: 'test/playhead-canvas.png' })
// timeline: the line, then Now
await tab('Timeline'); await p.waitForTimeout(400)
console.log('timeline bar:', (await p.locator('.view[data-view=timeline] .toolbar').first().innerText()).replace(/\n+/g, ' | '), '· line:', await p.locator('.tlsvg .ph-line').count())
await p.locator('.view[data-view=timeline]').screenshot({ path: 'test/playhead-timeline.png' })
// drag the strip to the start
const box = await p.locator('.tlsvg').boundingBox()
await p.mouse.move(box.x + 125, box.y + 6); await p.mouse.down(); await p.mouse.move(box.x + 140, box.y + 6); await p.mouse.up(); await p.waitForTimeout(1200)
console.log('dragged to:', await p.evaluate(() => window.__SB.App.playhead))
await p.click('.view[data-view=timeline] .toolbar button:has-text("Now")'); await p.waitForTimeout(1200)
await tab('Canvas').catch(() => {}); 
console.log('now:', await p.evaluate(() => window.__SB.App.playhead), '· past frames:', await p.locator('.frm.past').count(), '· cats wrap:', await style('menu.html', '.cats', 'flex-wrap'))
await b.close()
