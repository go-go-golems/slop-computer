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
const send = async t => { await p.fill('.composer textarea', t); await p.press('.composer textarea', 'Enter'); await p.waitForTimeout(150); await p.waitForFunction(() => !document.querySelector('.pill.busy'), null, { timeout: 30000 }) }
const info = () => p.evaluate(() => { const inp = window.__lastInput || []; return { summaries: (window.__summaryPrompts || []).length, msgsSent: inp.length, chars: inp.reduce((a, m) => a + m.content.length, 0), head: (inp[0] && inp[0].content.match(/Earlier in this thread \(messages 1–\d+/) || [''])[0] } })
for (let i = 1; i <= 15; i++) { await send('CHAT ' + i + ' please keep the cups at 240ml and use the word ' + ['latte', 'scone', 'cortado', 'chai', 'muffin'][i % 5]); if (i % 3 === 0 || i >= 11) console.log('after', i, JSON.stringify(await info())) }
console.log('summary prompt (start):', (await p.evaluate(() => (window.__summaryPrompts || [])[0] || '')).split('Messages')[1]?.slice(0, 300).replace(/\n/g, ' ⏎ '))
console.log('summary card:', (await p.locator('.chat .summary').innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 300))
console.log('visible msgs:', await p.locator('.chat .msg').count(), '· chip:', await p.locator('.composer button.tag:has-text("Summary")').innerText().catch(() => 'none'))
await p.click('.chat .summary button:has-text("Show them")'); await p.waitForTimeout(200)
console.log('after show: msgs', await p.locator('.chat .msg').count(), '· cut line:', await p.locator('.chat .sumcut').count())
await p.locator('.view[data-view=agent]').screenshot({ path: 'test/compact.png' })
// recall from the Eval panel
const tab = name => p.evaluate(n => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith(n)); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) }, name)
await tab('Eval'); await p.waitForTimeout(200)
const run = async code => { await p.fill('.view[data-view=evalrepl] textarea', code); await p.click('.view[data-view=evalrepl] .btn.primary'); await p.waitForTimeout(900); return p.evaluate(() => document.querySelector('.view[data-view=evalrepl] .scroll > .block').innerText.replace(/\n+/g, ' ⏎ ').slice(0, 700)) }
console.log('recall:', await run("const r = await session.recall('240ml cortado', { limit: 3 })\nreturn r"))
console.log('message:', await run("const r = await session.recall('end 3.', { limit: 1 })\nconst m = await session.message(r[0].n, { thread: r[0].threadId })\nreturn { n: m.n, role: m.role, evals: m.evals.length, start: m.text.slice(0, 30) }"))
await tab('Agent'); await p.waitForTimeout(200)
// edit the summary
await p.click('.chat .summary button:has-text("Edit")'); await p.waitForTimeout(200)
await p.fill('.modal textarea', '**Goals**\n- cups are 240ml (edited)'); await p.click('.modal footer .btn.primary'); await p.waitForTimeout(300)
console.log('edited:', (await p.locator('.chat .summary').innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 160))
await send('CHAT 16 after the edit')
console.log('sees edit:', await p.evaluate(() => /cups are 240ml \(edited\)/.test(window.__lastInput[0].content)), JSON.stringify(await info()))
// summarize now, without a model
await p.evaluate(() => { window.__noSummary = true })
await p.click('.threads button[title="Thread actions"]'); await p.click('.menu button:has-text("Summarize earlier messages now")'); await p.waitForTimeout(800)
console.log('fallback:', (await p.locator('.chat .summary').innerText()).replace(/\n+/g, ' ⏎ ').slice(0, 400))
await p.click('.threads button[title="Thread actions"]'); console.log('menu:', (await p.locator('.menu').innerText()).replace(/\n+/g, ' | ')); await p.keyboard.press('Escape')
await b.close()
