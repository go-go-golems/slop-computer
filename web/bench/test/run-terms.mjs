import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import fs from 'fs'
const mock = fs.readFileSync(new URL('./mock.js', import.meta.url), 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
p.on('pageerror', e => { if (!/about:srcdoc/.test(e.stack || '')) console.log('PAGEERROR', e.message, e.stack?.split('\n')[1]) })
p.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console.error:', m.text().slice(0, 200)) })
await p.addInitScript(mock)
await p.goto('http://localhost:8765/index.html'); await p.waitForSelector('.projbtn .ptitle'); await p.waitForTimeout(3000)
const tab = name => p.evaluate(n => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith(n)); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) }, name)
await tab('Eval'); await p.waitForTimeout(300)
const run = async (code, onModal) => {
  await p.fill('.view[data-view=evalrepl] textarea', code)
  const n0 = await p.evaluate(() => document.querySelectorAll('.view[data-view=evalrepl] .scroll > .block').length)
  await p.click('.view[data-view=evalrepl] .btn.primary')
  if (onModal) { await p.waitForSelector('.modal', { timeout: 10000 }); await onModal() }
  await p.waitForFunction(n => { const c = document.querySelector('.view[data-view=evalrepl] .scroll > .block'); return document.querySelectorAll('.view[data-view=evalrepl] .scroll > .block').length > n && c && !/Running/.test(c.innerText) }, n0, { timeout: 60000 })
  return p.evaluate(() => document.querySelector('.view[data-view=evalrepl] .scroll > .block').innerText.replace(/\n+/g, ' ⏎ ').replace(/Edit again/, '').slice(0, 700))
}
const T = async (name, code, m) => { try { console.log('•', name, '→', await run(code, m)) } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]) } }
await T('compose + explain + lift', `const pages = files.list().then(step(fs => fs.filter(f => f.path.endsWith('.html')).map(f => f.path)))
const plan = pages.then(files.read().map()).then(step(ts => ts.map(t => t.split('\\n').length), 'line counts'))
return { plan: plan.explain(), lines: await plan }`)
await T('par alt loop fold', `const a = await par({ n: files.list().then(step(x => x.length)), t: data.tables().then(step(ts => ts.map(t => t.name))) })
const r = await alt({ big: step(() => 'big'), small: step(() => 'small') }).by(x => x > 3 ? 'big' : 'small').run(5)
const l = await loop(step(x => x + 1)).seed(step(() => 0)).until(x => x >= 3).max(10).run()
const f = await files.list().then(step(fs => fs.map(f => f.lines))).fold(monoid.sum)
const g = await files.list().then(step(fs => fs.map(f => f.path))).fold(monoid.groupBy(p => p.split('.').pop(), monoid.count))
return [a, r, l, f, g]`)
await T('wrappers', `let attempts = 0
const flaky = step(() => { attempts++; if (attempts < 2) { const e = new Error('nope'); e.kind = 'anchor'; throw e } return 'ok' })
const a = await flaky.retry({ times: 2 })
const b = await files.replace('styles.css', 'NOT THERE', 'x').fallback(step(() => 'fell back'), { when: e => e.kind === 'anchor' })
let c; try { await step(() => 1).verify(v => v > 1, 'too small') } catch (e) { c = e.kind + ': ' + e.message }
let d; try { await step(async () => { await sleep(600); return 1 }).timeout(100) } catch (e) { d = e.kind }
let e2; try { await files.write('x.html', 'x').guard(() => false, 'not now') } catch (e) { e2 = e.kind }
return [a, attempts, b, c, d, e2, await files.exists('x.html')]`)
await T('atomic', `let e1; try { await seq(files.write('a1.html', '<p>1</p>'), step(() => { throw new Error('later') })).atomic() } catch (e) { e1 = e.message }
const t = await tx(async () => { await files.write('a2.html', '<p>2</p>'); return 'kept' })
return [e1, await files.exists('a1.html'), t, await files.exists('a2.html')]`)
await T('dry run', `const cs = await files.replace('styles.css', 'h1 {', 'h1 { letter-spacing: -0.01em;').dry()
const before = (await files.read('styles.css')).includes('letter-spacing')
const applied = await cs.apply()
return [cs.files, before, applied, (await files.read('styles.css')).includes('letter-spacing')]`)
await T('diag: step is not its output', `const t = files.read('styles.css')\nreturn t.includes('x')`)
await T('diag: lift', `return await files.list().then(files.read())`)
await T('diag: pure returned step', `return await step(() => files.list())`)
await T('llm', `return await llm\`Is the sky blue?\`.output(s.enum(['yes', 'no']))`)
await T('help', `return [help().split('\\n').length, help(files.replace), help(files)]`)
await T('approve', `return await step(() => 'went ahead').approve('Go ahead?')`, async () => { await p.click('.modal .btn.primary') })
await T('delegate explorer', `return await delegate('explorer', 'How many pages are there?', { output: s.object({ pages: s.int() }) })`)
await T('fan-out builders', `const rs = await par(['bold', 'calm'].map(d => delegate('builder', 'Make headings bigger. Direction: ' + d)))
props = rs.map(r => r.proposal)
return rs.map(r => [r.role, r.evals, r.proposal, r.changes])`)
await T('reviewer', `return (await delegate('reviewer', 'Review this change', { proposal: props[0] })).result`)
await T('qa', `const r = await delegate('qa', 'Sweep the frames'); return [r.result, (await ui.pins()).map(p => p.by + ': ' + p.text), await scenarios.list(), r.thread]`)
await T('bad role / depth', `let a; try { await delegate('wizard', 'x') } catch (e) { a = e.kind + ': ' + e.message } return a`)
console.log('threads:', await p.evaluate(() => [...document.querySelectorAll('.threads .th')].map(t => t.innerText)))
// matrix board
await tab('Canvas'); await p.waitForTimeout(300)
await p.click('.view[data-view=canvas] .toolbar button:has-text("Matrix")'); await p.waitForTimeout(2500)
console.log('matrix:', await p.evaluate(() => [...document.querySelectorAll('.frm.mx .flabel')].map(l => l.textContent)))
await p.screenshot({ path: 'test/mx.png' })
await p.click('.view[data-view=canvas] .toolbar button:has-text("Matrix")'); await p.waitForTimeout(800)
// temporary navigation
await p.click('.seg.modes button[data-m=play]')
const fr = p.locator('.frm').nth(0).frameLocator('iframe').first(); await fr.locator('a[href="menu.html"]').first().dispatchEvent('click'); await p.waitForTimeout(1200)
console.log('nav:', await p.evaluate(() => { const f = document.querySelectorAll('.frm')[0]; return { route: f.querySelector('.route').value, back: !f.querySelector('.fh button[title^="Back"]').hidden } }))
await p.click('.seg.modes button[data-m=select]')
// agent: timeline lanes for subagents
await tab('Timeline'); await p.waitForTimeout(500)
console.log('lanes:', await p.evaluate(() => [...document.querySelectorAll('.tlsvg text')].map(t => t.textContent).filter(t => /^(You|Pages|Marks|Claude)/.test(t))))
await b.close()
