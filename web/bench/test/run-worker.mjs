import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const p = await b.newPage(); p.on('pageerror', e => console.log('pageerror', e.message))
await p.goto('http://localhost:8765/worker-test.html');
try { await p.waitForFunction(() => document.title === 'done', null, { timeout: 15000 }) } catch (e) { console.log('timeout') }
console.log((await p.evaluate(() => window.out)).join('\n')); await b.close()
