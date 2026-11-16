import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const p = await b.newPage(); p.on('worker', w => w.on('console', m => console.log('wconsole', m.text())))
await p.goto('http://localhost:8765/w2.html'); await p.waitForTimeout(4000)
console.log(await p.evaluate(() => msgs)); await b.close()
