import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
await p.goto('http://apps.localhost:18494/_site/login?return=/benchnext')
if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Audit'); await p.click('form button') }
await p.waitForURL(u => u.href.includes('/benchnext'), { timeout: 30000 })
let f = null
for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
await f.evaluate(() => window.__SB.App.openProject('smoke8')); await p.waitForTimeout(6000)
await f.evaluate(() => window.__SB.App.openProject('smoke8')); await p.waitForTimeout(6000)
await f.getByText('Eval', { exact: true }).first().click(); await p.waitForTimeout(800)
const ta = f.locator('textarea.txt.mono').first()
const orig = await f.evaluate(() => window.__SB.App.P.read('index.html', 'draft'))
const run = async (code, wait) => { await ta.fill(code); await ta.press('Control+Enter'); await p.waitForTimeout(wait); return f.evaluate(() => { const v = document.querySelector('textarea.txt.mono').closest('.view') || document.body; return v.innerText }) }
const canvasPage = '<!doctype html><body style="margin:0"><canvas id=c width=340 height=200></canvas><script>const g=document.getElementById("c").getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,340,200);g.fillStyle="#36c";[[40,150],[120,90],[200,60],[280,40]].forEach(([x,y])=>{g.beginPath();g.arc(x,y,6,0,7);g.fill()});g.fillStyle="#222";g.font="14px sans-serif";g.fillText("Centro",190,58);g.fillText("Periferia",196,62);g.fillText("Sur",34,145);</script></body>'
await run("await files.write('index.html', " + JSON.stringify(canvasPage) + ")\nreturn 'written'", 4000)
const out1 = await run("const fl = await frames.list()\nawait frames.reload(fl[0].id)\nawait frames.waitFor(fl[0].id, '#c', { timeout: 8000 })\nreturn await frames.look(fl[0].id, 'Do any text labels overlap each other? Name them.')", 60000)
console.log('--- canvas\n' + out1.slice(-900))
const svgPage = '<!doctype html><body style="margin:0"><svg id=s width=340 height=200><style>.lab{font:14px sans-serif;fill:#222}</style><rect width=340 height=200 fill="#fff"/><polyline points="20,180 120,120 220,80 320,30" fill="none" stroke="#c33" stroke-width="3"/><text class=lab x=190 y=58>Centro</text><text class=lab x=196 y=62>Periferia</text></svg></body>'
await run("await files.write('index.html', " + JSON.stringify(svgPage) + ")\nreturn 'written'", 4000)
const out2 = await run("const fl = await frames.list()\nawait frames.reload(fl[0].id)\nawait frames.waitFor(fl[0].id, '#s', { timeout: 8000 })\nreturn await frames.look(fl[0].id, 'What colour is the line, and which way does it go? Do any labels overlap?')", 60000)
console.log('--- svg\n' + out2.slice(-900))
await f.evaluate(o => window.__SB.App.P.write('index.html', o, 'draft'), orig); await p.waitForTimeout(1500)
await b.close()
