// A visual audit of the bench: three window sizes, light and dark; main screen, Code with an
// error, Review, Data, the Publish dialog (cancelled), the project menu; a drag and a double-click
// on the canvas. Screenshots to <out>/<size>-<scheme>-<step>.png.
const { chromium } = await import(process.env.PLAYWRIGHT)
const bench = 'http://apps.localhost:18494/' + (process.env.AUDIT_BENCH || 'bench'), out = process.argv[2], app = process.argv[3] || 'smoke6'
const sizes = (process.env.AUDIT_SIZES || '1600x1000,1280x800,900x900').split(',').map(s => s.split('x').map(Number)), schemes = (process.env.AUDIT_SCHEMES || 'light,dark').split(',')
const b = await chromium.launch()
const log = []
for (const [w, h] of sizes) for (const scheme of schemes) {
  const tag = `${w}x${h}-${scheme}`
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme })
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss())
  const shot = async n => { await p.waitForTimeout(700); await p.screenshot({ path: `${out}/${tag}-${n}.png` }) }
  await p.goto('http://apps.localhost:18494/_site/login?return=' + new URL(bench).pathname)
  if (await p.locator('input[name=email]').count()) { await p.fill('input[name=email]', 'admin@example.com'); await p.fill('input[name=name]', 'Audit'); await p.click('form button') }
  await p.waitForURL(u => u.href.startsWith(bench), { timeout: 30000 })
  let f = null
  for (let i = 0; i < 60 && !f; i++) { for (const fr of p.frames()) { try { if (await fr.evaluate(() => !!window.__SB)) { f = fr; break } } catch { } } if (!f) await p.waitForTimeout(500) }
  if (!f) { log.push(tag + ': no bench'); await ctx.close(); continue }
  await f.evaluate(id => window.__SB.App.openProject(id), app); await p.waitForTimeout(6000)
  await shot('1-main')
  const tab = async name => { const t = f.getByText(name, { exact: true }).first(); if (await t.count()) { await t.click().catch(e => log.push(`${tag}: tab ${name}: ${e.message.split('\n')[0]}`)) } else log.push(`${tag}: no tab ${name}`) }
  await f.evaluate(() => window.__SB.App.code.open('main.ts')).catch(() => { }); await p.waitForTimeout(1500)
  await f.evaluate(() => { const ta = document.querySelector('.code textarea'); if (ta && !ta.value.includes('txt:')) { ta.value = ta.value.replace('{ text: input.value }', '{ txt: input.value }'); ta.dispatchEvent(new Event('input')) } }); await p.waitForTimeout(2500)
  await shot('2-code-error')
  await f.evaluate(() => { const ta = document.querySelector('.code textarea'); if (ta) { ta.value = ta.value.replace('{ txt: input.value }', '{ text: input.value }'); ta.dispatchEvent(new Event('input')) } }); await p.waitForTimeout(1500)
  await tab('Review'); await shot('3-review')
  await tab('Data'); await shot('4-data')
  const pub = f.getByRole('button', { name: 'Publish' }).first()
  if (await pub.count()) { await pub.click().catch(() => { }); await shot('5-publish-dialog'); await p.keyboard.press('Escape') }
  await p.waitForTimeout(500)
  const menu = f.locator('.proj, .project-menu, header .app-picker').first()
  // the canvas: drag the first frame's header 120px right, then double-click inside the frame
  const fr = f.locator('.frame .fhead, .frame-head, .frame > header').first()
  if (await fr.count()) { const bb = await fr.boundingBox(); if (bb) { await p.mouse.move(bb.x + 40, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + 160, bb.y + bb.height / 2 + 40, { steps: 10 }); await p.mouse.up(); await shot('6-after-drag') } } else log.push(`${tag}: no frame header found`)
  log.push(`${tag}: page errors: ${errs.length ? errs.join(' | ').slice(0, 300) : 'none'}`)
  await ctx.close()
}
await b.close(); console.log(log.join('\n'))
