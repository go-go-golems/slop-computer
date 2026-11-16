import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import fs from 'fs'
const mock = fs.readFileSync(new URL('./mock.js', import.meta.url), 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.addInitScript(mock)
await p.goto('http://localhost:8765/index.html'); await p.waitForSelector('.projbtn .ptitle'); await p.waitForTimeout(2000)
const send = async t => { await p.fill('.composer textarea', t); await p.press('.composer textarea', 'Enter') }
// read-only: the replace should fail with a policy error
await p.click('.composer .seg button:nth-child(3)'); await send('fix it')
await p.waitForFunction(() => !document.querySelector('.pill.busy'), null, { timeout: 30000 })
console.log('read-only:', await p.evaluate(() => [...document.querySelectorAll('.chat .msg.agent details.step')].map(d => d.querySelector('summary').innerText.replace(/\n/g, ' ') + ' | ' + ([...d.querySelectorAll('pre')].pop()?.textContent || '').slice(0, 120))))
// ask mode: run the first, skip the second, run the rest
await p.click('.composer .seg button:nth-child(2)'); await p.click('.composer .seg:nth-of-type(2) button:nth-child(2)'); await send('fix it again')
for (const choice of ['Run', 'Skip', 'Run', 'Run']) {
  await p.waitForSelector('.step .ask button', { timeout: 10000 }); await p.click('.step .ask button:has-text("' + choice + '")'); await p.waitForTimeout(300)
}
await p.waitForFunction(() => !document.querySelector('.pill.busy'), null, { timeout: 30000 })
console.log('ask:', await p.evaluate(() => [...document.querySelectorAll('.chat .msg.agent')].pop().querySelectorAll('details.step').length), await p.evaluate(() => [...[...document.querySelectorAll('.chat .msg.agent')].pop().querySelectorAll('summary b')].map(b => b.textContent)))
console.log('ws:', await p.evaluate(() => document.querySelector('.wsbtn').innerText.replace(/\n/g, ' ')))
console.log('prompt head:', await p.evaluate(() => window.__lastPrompt.slice(-700)))
await b.close()
