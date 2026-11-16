import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import fs from 'fs'
const mock = fs.readFileSync(new URL('./mock.js', import.meta.url), 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.addInitScript(mock)
await p.goto('http://localhost:8765/index.html'); await p.waitForSelector('.projbtn .ptitle'); await p.waitForTimeout(2500)
await p.click('.composer .seg:nth-of-type(2) button:nth-child(2)')   // Main
await p.fill('.composer textarea', 'DELEGATE TEST'); await p.press('.composer textarea', 'Enter')
await p.waitForFunction(() => !document.querySelector('.pill.busy'), null, { timeout: 30000 }); await p.waitForTimeout(600)
console.log(await p.evaluate(() => ({ strip: [...document.querySelectorAll('.threads .th')].map(t => t.innerText), step: document.querySelector('.chat details.step')?.innerText.replace(/\n/g, ' | ').slice(0, 300) })))
await p.evaluate(() => { const d = document.querySelector('.chat details.step'); d.open = true })
await p.click('.chat .kids button.link'); await p.waitForTimeout(500)
console.log(await p.evaluate(() => ({ strip: [...document.querySelectorAll('.threads .th')].map(t => t.innerText), chat: document.querySelector('.chat').innerText.replace(/\n/g, ' | ').slice(0, 300) })))
await p.locator('.view[data-view=agent]').screenshot({ path: 'test/deleg.png' })
await b.close()
