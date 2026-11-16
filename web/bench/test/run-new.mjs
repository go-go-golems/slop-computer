import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import fs from 'fs'
const mock = fs.readFileSync(new URL('./mock.js', import.meta.url), 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack?.split('\n')[1]))
p.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console.error:', m.text().slice(0, 200)) })
await p.addInitScript(mock)
await p.goto('http://localhost:8765/index.html'); await p.waitForSelector('.projbtn .ptitle'); await p.waitForTimeout(2500)
const step = async (name, fn) => { try { const r = await fn(); console.log('ok  ', name, r !== undefined ? JSON.stringify(r).slice(0, 400) : '') } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]) } }
const tab = name => p.evaluate(n => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith(n)); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) }, name)
const frameOf = async route => { const i = await p.evaluate(r => [...document.querySelectorAll('.frm')].findIndex(f => f.querySelector('.route').value === r), route); return p.locator('.frm').nth(i).frameLocator('iframe').first() }
await step('probe styles + hover (select)', async () => {
  const fr = await frameOf('menu.html')
  await fr.locator('h1').dispatchEvent('mousemove')
  return fr.locator('html').evaluate(() => ({ mode: document.documentElement.dataset.sbmode, style: !!document.querySelector('style[data-sitebench]'), hover: document.querySelector('.__sbbox.h') ? getComputedStyle(document.querySelector('.__sbbox.h')).position + ' ' + document.querySelector('.__sbbox.h i').textContent : null, cursor: getComputedStyle(document.querySelector('.cat')).cursor }))
})
await step('comment hover + cursor', async () => {
  await p.click('.seg.modes button[data-m=comment]'); await p.waitForTimeout(200)
  const fr = await frameOf('menu.html'); await fr.locator('.cat').first().dispatchEvent('mousemove')
  const r = await fr.locator('html').evaluate(() => ({ mode: document.documentElement.dataset.sbmode, hover: document.querySelector('.__sbbox.c i')?.textContent, cursor: getComputedStyle(document.querySelector('.cat')).cursor.slice(0, 40) }))
  await p.click('.seg.modes button[data-m=play]'); await p.waitForTimeout(200)
  r.play = await fr.locator('.cat').first().evaluate(el => getComputedStyle(el).cursor)
  await p.click('.seg.modes button[data-m=select]')
  return r
})
await p.locator('.frm').nth(1).screenshot({ path: 'test/n0.png' })
await step('docs view', async () => { await tab('Docs'); await p.waitForTimeout(300); return p.evaluate(() => ({ list: [...document.querySelectorAll('.view[data-view=docs] .fl button')].map(b => b.textContent), h: [...document.querySelectorAll('.view[data-view=docs] .md h2, .view[data-view=docs] .md h3')].map(x => x.textContent), table: !!document.querySelector('.view[data-view=docs] table') })) })
await step('doc link -> code', async () => { await p.click('.view[data-view=docs] .md a.fref >> nth=0'); await p.waitForTimeout(400); return p.evaluate(() => document.querySelector('.efoot b')?.textContent) })
await step('md split preview in code', async () => { await tab('Docs'); await p.click('.view[data-view=docs] .toolbar button:has-text("Edit")'); await p.waitForTimeout(400); return p.evaluate(() => ({ prev: !document.querySelector('.mdprev').hidden, h: document.querySelector('.mdprev h2')?.textContent, seg: [...document.querySelectorAll('.efoot .seg button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')) })) })
await p.locator('.view[data-view=code]').screenshot({ path: 'test/n1.png' })
await step('agent + accept', async () => {
  await p.fill('.composer textarea', 'Fix the overflow'); await p.press('.composer textarea', 'Enter')
  await p.waitForFunction(() => !document.querySelector('.pill.busy'), null, { timeout: 30000 }); await p.waitForTimeout(400)
  await tab('Review'); await p.click('.ovcard button.btn.primary'); await p.waitForTimeout(800); return p.evaluate(() => document.querySelector('.wsbtn').innerText.replace(/\n/g, ' '))
})
await step('history in code', async () => {
  await p.evaluate(() => { const t = [...document.querySelectorAll('.dtab .lbl')].find(b => b.textContent.startsWith('Code')); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) })
  await p.click('.view[data-view=code] .fi:has-text("styles.css")'); await p.waitForTimeout(200)
  await p.click('.efoot button:has-text("History")'); await p.waitForTimeout(200)
  const items = await p.evaluate(() => [...document.querySelectorAll('.menu button')].map(b => b.innerText.replace(/\n/g, ' ')))
  await p.click('.menu button >> nth=-1'); await p.waitForTimeout(300)
  const r = await p.evaluate(() => ({ foot: document.querySelector('.efoot').innerText.replace(/\n/g, ' ').slice(0, 160), ro: document.querySelector('.code textarea').readOnly, wraps: /flex-wrap/.test(document.querySelector('.code textarea').value) }))
  await p.click('.efoot button:has-text("▶")'); await p.waitForTimeout(200)
  r.next = await p.evaluate(() => ({ foot: document.querySelector('.efoot').innerText.replace(/\n/g, ' ').slice(0, 80), wraps: /flex-wrap/.test(document.querySelector('.code textarea').value) }))
  await p.click('.efoot button:has-text("Back to current")'); await p.waitForTimeout(200)
  r.back = await p.evaluate(() => document.querySelector('.code textarea').readOnly)
  return { items, ...r }
})
await step('timeline -> view this version', async () => {
  await tab('Timeline'); await p.waitForTimeout(300)
  await p.click('.story > button:has-text("wrote styles.css") >> nth=0'); await p.waitForTimeout(300)
  await p.click('.tlside button:has-text("View this version")'); await p.waitForTimeout(400)
  return p.evaluate(() => document.querySelector('.efoot').innerText.replace(/\n/g, ' ').slice(0, 120))
})
await step('transcript download', async () => {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), (async () => { await tab('Agent'); await p.click('.threads .new button:has-text("⋯")'); await p.click('.menu button:has-text("Download transcript")') })()])
  const path = 'test/' + dl.suggestedFilename(); await dl.saveAs(path); const t = fs.readFileSync(path, 'utf8')
  return { name: dl.suggestedFilename(), lines: t.split('\n').length, head: t.split('\n').slice(0, 3), hasEval: /### eval 1/.test(t) }
})
let zipPath
await step('project zip download', async () => {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), (async () => { await p.click('.projbtn'); await p.click('.menu button:has-text("Download project")') })()])
  zipPath = 'test/' + dl.suggestedFilename(); await dl.saveAs(zipPath)
  return { name: dl.suggestedFilename(), bytes: fs.statSync(zipPath).size }
})
console.log(require_unzip(zipPath))
await step('import zip', async () => {
  await p.click('.projbtn'); await p.click('.menu button:has-text("Import project")'); await p.waitForTimeout(200)
  await p.setInputFiles('.modal input[type=file]', zipPath); await p.waitForTimeout(2500)
  return p.evaluate(() => ({ title: document.querySelector('.projbtn').innerText.replace(/\n/g, ' '), projects: 0 }))
})
await step('imported state', async () => {
  await tab('Timeline'); await p.waitForTimeout(400)
  return p.evaluate(() => ({ events: document.querySelectorAll('.story > button').length, threads: [...document.querySelectorAll('.threads .th')].map(t => t.innerText), frames: document.querySelectorAll('.frm').length }))
})
await step('import plain site zip', async () => {
  const { execSync } = await import('child_process')
  fs.mkdirSync('/tmp/site1/mysite', { recursive: true }); fs.writeFileSync('/tmp/site1/mysite/index.html', '<!doctype html><html><head><link rel="stylesheet" href="a.css"></head><body><h1>Hi zip</h1></body></html>'); fs.writeFileSync('/tmp/site1/mysite/a.css', 'h1{color:teal}'); fs.writeFileSync('/tmp/site1/mysite/logo.png', 'PNGDATA')
  execSync('cd /tmp/site1 && rm -f site.zip && zip -qr site.zip mysite')
  await p.click('.projbtn'); await p.click('.menu button:has-text("Import project")'); await p.waitForTimeout(200)
  await p.setInputFiles('.modal input[type=file]', '/tmp/site1/site.zip'); await p.waitForTimeout(2500)
  const fr = await frameOf('index.html')
  return { title: await p.evaluate(() => document.querySelector('.projbtn').innerText.replace(/\n/g, ' ')), h1: await fr.locator('h1').textContent(), color: await fr.locator('h1').evaluate(e => getComputedStyle(e).color) }
})
await b.close()
function require_unzip(path) { try { const { execSync } = process.mainModule ? require('child_process') : {}; } catch {} return '' }
