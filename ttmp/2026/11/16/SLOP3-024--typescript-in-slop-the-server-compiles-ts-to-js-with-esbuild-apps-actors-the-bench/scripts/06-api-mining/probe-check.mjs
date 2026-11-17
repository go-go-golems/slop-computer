import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
await p.goto('http://apps.localhost:18494/_site/login?return=/benchnext')
if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Audit'); await p.click('form button') }
await p.waitForURL(u => u.href.includes('/benchnext'), { timeout: 30000 })
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
await f.evaluate(() => window.__SB.App.openProject('smoke8')); await p.waitForTimeout(6000)
const out = {}
out.firstMode = await f.evaluate(() => window.__SB.App.mode)
// a page with a required field and an SVG button
await f.getByText('Eval', { exact: true }).first().click(); await p.waitForTimeout(800)
const ta = f.locator('textarea.txt.mono').first()
const page = '<!doctype html><form id=f><label for=n>Owner</label><input id=n required><button id=add>Add</button></form><svg width=40 height=40><rect id=r width=40 height=40 onclick="document.title=\'svg clicked\'"/></svg>'
const orig = await f.evaluate(() => window.__SB.App.P.read('index.html', 'draft'))
await ta.fill("await files.write('index.html', " + JSON.stringify(page) + ")\nreturn 'written'"); await ta.press("Control+Enter"); await p.waitForTimeout(4000)
await ta.fill("const fl = await frames.list()\nawait frames.reload(fl[0].id)\nawait frames.waitFor(fl[0].id, '#n', { timeout: 8000 })\nconst c = await frames.click(fl[0].id, '#r')\nreturn { svg: c.tag }"); await ta.press("Control+Enter"); await p.waitForTimeout(12000)
out.evalOut = await f.evaluate(() => { const v = document.querySelector("textarea.txt.mono").closest(".view") || document.body; return v.innerText.slice(-400) })
// the required field: click Add in Play mode inside the frame
const fid = ''
await f.evaluate(() => window.__SB.App.setMode('play'))
const host = await f.evaluate(fid => !!window.__SB.App.hostFor(fid), fid)
let frame = null
for (let i = 0; i < 20 && !frame; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!document.getElementById('n'))) frame = fr } catch { } } if (!frame) await p.waitForTimeout(500) }
out.frameFound = !!frame; out.frameCount = p.frames().length
if (frame) out.printFn = await frame.evaluate(() => String(window.print).slice(0, 60)).catch(e => e.message)
if (frame) out.frameUrl = frame.url().slice(0, 80)
if (frame) { await frame.evaluate(() => { window.__inv = 0; addEventListener('invalid', () => window.__inv++, true) }); await frame.evaluate(() => document.getElementById('add').click()); await p.waitForTimeout(300); out.invCount = await frame.evaluate(() => window.__inv); out.direct = await frame.evaluate(() => { document.getElementById('n').reportValidity(); return window.__inv }); out.title = await frame.evaluate(() => { document.getElementById('r').dispatchEvent(new MouseEvent('click', { bubbles: true })); return document.title }); out.toast300 = await f.evaluate(() => (document.querySelector('#toast') || {}).innerText || ''); out.consoleHas = await f.evaluate(() => JSON.stringify((window.__SB.App.logs || []).slice(-3).map(l => l.text)).slice(0, 300)) }
out.invalidToast = await f.evaluate(() => (document.querySelector('#toast') || {}).innerText || '')
// mode keys from a focused frame, outside Play
await f.evaluate(() => window.__SB.App.setMode('select')); await p.waitForTimeout(800)
await f.evaluate(() => { window.__mk = []; addEventListener('message', e => { const d = e.data; if (d && typeof d === 'object' && d.ev) window.__mk.push(d.ev) }) })
if (frame) { out.frameKeys = await frame.evaluate(() => { window.__kd = 0; addEventListener('keydown', () => window.__kd++, true); return 'ok' }); out.active = await frame.evaluate(() => { const a = document.activeElement; const tag = a ? a.tagName : ''; if (a && a.blur) a.blur(); return tag + ' -> ' + (document.activeElement || {}).tagName }); await frame.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }))); out.kd = await frame.evaluate(() => window.__kd) }
await p.waitForTimeout(500)
out.afterPress = await f.evaluate(() => window.__SB.App.mode)
out.msgs = await f.evaluate(() => window.__mk.join(','))
out.synthetic = await f.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' })); return window.__SB.App.mode })
await f.evaluate(() => window.__SB.App.setMode('select'))
await p.waitForTimeout(500)
out.afterP = await f.evaluate(() => window.__SB.App.mode)
await f.evaluate(o => window.__SB.App.P.write('index.html', o, 'draft'), orig); await p.waitForTimeout(1500)
console.log(JSON.stringify(out)); await b.close()
