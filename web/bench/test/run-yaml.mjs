import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import fs from 'fs'
const mock = fs.readFileSync(new URL('./mock.js', import.meta.url), 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.addInitScript(mock)
await p.goto('http://localhost:8765/index.html'); await p.waitForSelector('.projbtn .ptitle'); await p.waitForTimeout(2500)
await p.evaluate(() => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith('Eval')); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) })
await p.fill('.view[data-view=evalrepl] textarea', "return { tables: await data.tables(), menu: (await data.rows('menu')).slice(0, 2), frames: await frames.list(), plan: files.list().then(files.read().map()).explain() }")
await p.click('.view[data-view=evalrepl] .btn.primary'); await p.waitForTimeout(1500)
await p.locator('.view[data-view=evalrepl] .scroll > .block').first().screenshot({ path: 'test/yaml.png' })
await b.close()
