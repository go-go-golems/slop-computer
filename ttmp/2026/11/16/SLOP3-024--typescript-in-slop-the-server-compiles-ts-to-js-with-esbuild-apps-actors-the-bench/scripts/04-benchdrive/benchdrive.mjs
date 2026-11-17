#!/usr/bin/env node
// benchdrive — drive the slop bench's web page the way a person would, from
// a shell. `benchdrive serve` holds one headless browser; `benchdrive
// <persona> <command> [args]` acts as that persona (one browser context
// each) and prints what the screen shows, as compact text.
//
// It reads only what the page shows (rendered text, visible buttons); it
// does not read the app's files or call the server's API for the persona.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as PG from './page.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = +(process.env.BENCHDRIVE_PORT || 18499)
const BENCH = process.env.BENCHDRIVE_URL || 'http://apps.localhost:18492/bench'
const EMAIL = process.env.BENCHDRIVE_EMAIL || 'admin@example.com'
const ASK_WAIT = Math.max(20, +process.env.BENCHDRIVE_ASK_WAIT || 150)
const VIEW_TITLES = ['Agent', 'Eval', 'Canvas', 'Timeline', 'Console', 'Data', 'Scenarios', 'Code', 'Review', 'Docs', 'Inspector', 'Layers', 'Panels']

const HELP = `benchdrive <you> <command> [args]   (you = your persona name, e.g. maya)

  look                      what the screen shows: header, open views, chat, app frames
  shot <file.png>           screenshot of the whole bench
  click <text|selector> [--in <where>]  click a button, tab or menu item by its label (or a CSS
                            selector); --in header|menu|dialog|tab|agent|canvas|code|... narrows it
  type <field> <text>       replace the text of a field: chat, code, id, title, filter, eval,
                            a placeholder word, or a CSS selector
  key <key>                 press a key (Enter, Escape, Tab, Control+s, ...)
  new-app <id> [template]   New app… from the project menu; without a template, lists the templates
  open-app <id>             open another app from the project menu
  ask <message>             send to Claude in the Agent chat, wait for the reply
  edit <old> <new>          change text in the file open in the Code view (old must occur once)
  read [from] [to]          the file open in the Code view, numbered lines (80 at a time)
  reply                     Claude's last reply in full (look shows only its first lines)
  see <file.png>            what the screen shows, with a grid to aim by (for working by eye)
  click-at <x> <y>, dblclick-at <x> <y>, drag <x1> <y1> <x2> <y2>, scroll-at <x> <y> <dy>, keys <text>
  frame-text [n]            the text of the app's page(s) on the canvas
  frame-shot <file.png> [n] screenshot of an app frame on the canvas
  frame-click <text|sel> [n]  click inside the app's own page (in Play mode, as a user of the app)
  frame-type <sel> <text> [n] type into a field of the app's own page
  view <name>               open a view: ${VIEW_TITLES.join(', ')}
  wait [seconds]            wait, then say what changed (default 5)
  pause [seconds]           (personas named *-visual) wait without describing anything, at most 170
  close                     forget this persona's browser tab

  benchdrive serve [--port N]   start the daemon (one browser)
  benchdrive stop | status`

// ---------------------------------------------------------------- formatting
const cut = (s, n) => (s = String(s ?? '')).length > n ? s.slice(0, n - 1) + '…' : s
const VIEW_NAME = { agent: 'Agent', evalrepl: 'Eval', canvas: 'Canvas', timeline: 'Timeline', console: 'Console', data: 'Data', scenarios: 'Scenarios', code: 'Code', review: 'Review', docs: 'Docs', inspector: 'Inspector', layers: 'Layers', panels: 'Panels' }

function fmtHeader(S) {
  if (S.bootError) return ['The bench could not start:', ...S.bootError.map(l => '  ' + l)]
  const H = S.header; if (!H) return ['(the bench is still loading)']
  if (!H.app) return ['Bench · no app open']
  return [`Bench · app ${H.app || '(none)'} · workspace ${H.ws || '?'} · mode ${H.mode || '?'} · ${H.health || ''} · Claude: ${(H.claude || '').replace(/ Claude$/, '')} · store: ${H.store || ''}`]
}
function fmtLayout(S) {
  const t = S.tiles.map(tabs => '[' + tabs.map(x => (x.on ? '*' : '') + x.title).join(' ') + ']').join(' ')
  return ['Layout (*=showing): ' + t + (S.floats.length ? ' floating: ' + S.floats.join(', ') : '')]
}
function fmtOverlays(S) {
  const L = []
  if (S.modal) {
    const M = S.modal
    L.push(`== Dialog "${M.title}" ==`)
    for (const l of M.text.slice(0, 12)) L.push('  ' + cut(l, 160))
    if (M.cards.length) L.push('  Choices: ' + M.cards.map(c => (c.on ? '*' : '') + c.name).join(' | ') + '   (* = picked)')
    M.fields.forEach((f, i) => L.push(`  Field ${i ? 'dialog' + (i + 1) : 'dialog'}${f.ph && f.ph !== 'text' ? ' ("' + f.ph + '")' : ''}: ${f.value ? JSON.stringify(cut(f.value, 80)) : '(empty)'}   (type ${i ? 'dialog' + (i + 1) : 'dialog'} "…")`))
    if (M.buttons.length) L.push('  Buttons: ' + M.buttons.join(' | '))
  }
  if (S.menu) {
    L.push('== Menu ==')
    for (const it of S.menu.slice(0, 40)) {
      if (it.group) L.push('  -- ' + it.group)
      else if (it.hr) continue
      else if (it.note) L.push('  (' + cut(it.note, 120) + ')')
      else L.push('  ' + (it.on ? '* ' : '• ') + it.label + (it.sub ? '  — ' + cut(it.sub, 80) : '') + (it.disabled ? ' (disabled)' : ''))
    }
  }
  if (S.toast) L.push('Notice: ' + S.toast)
  return L
}
function fmtAgent(V, budget = 22) {
  const L = ['== Agent (chat with Claude) ==']
  if (V.threads.length) L.push('Threads: ' + V.threads.map(t => cut(t, 30)).join(' | '))
  if (V.note) L.push('  ' + cut(V.note, 240))
  if (V.empty) L.push('  ' + cut(V.empty, 200))
  const body = []
  const msgs = V.msgs.slice(-4)
  if (V.msgs.length > msgs.length) body.push(`  (${V.msgs.length - msgs.length} earlier messages above)`)
  for (const m of msgs) body.push(...fmtMsg(m, 8))
  L.push(...(body.length > budget ? ['  (…)', ...body.slice(-budget)] : body))
  L.push(`Composer: ${V.draft ? JSON.stringify(cut(V.draft, 100)) : '(empty)'} · ${(V.segs || []).join(' · ')} · model ${V.model || '?'} · [${V.action || ''}]` + (V.chips.length ? ' · context: ' + V.chips.join(', ') : ''))
  return L
}
function fmtMsg(m, maxBody = 8, width = 200) {
  const L = []
  if (m.role === 'user') { L.push(`  ${m.who}: ${cut(m.body.join(' '), 300)}`); return L }
  L.push(`  ${m.who}${m.running ? ' (working…)' : ''}:`)
  for (const s of m.steps) {
    L.push('    ' + cut(s.sum, 150))
    for (const x of s.extra || []) L.push('      ' + cut(x, 150))
    if (s.ask) L.push('    → waiting for you: Run this eval? [Run] [Skip]')
  }
  const b = m.body
  for (const l of b.slice(0, maxBody)) L.push('    ' + cut(l, width))
  if (b.length > maxBody) L.push(`    (… ${b.length - maxBody} more lines)`)
  if (m.approval) L.push('    → waiting for you: ' + m.approval.join(' · '))
  return L
}
function fmtCanvas(V, frameTexts, perFrame = 6) {
  const L = ['== Canvas (live frames of the app) ==', '  toolbar: ' + V.toolbar + (V.hud ? '  · ' + V.hud : '')]
  if (!V.frames.length) L.push('  (no frames on the canvas)')
  for (const f of V.frames) {
    L.push(`  Frame ${f.i + 1}: ${[f.label, f.route, f.meta].filter(Boolean).join(' · ')}${f.prop ? ' · proposal' : ''}${f.visible ? '' : ' (scrolled out of sight)'}`)
    if (f.status) L.push('    ERROR shown: ' + cut(f.status, 200))
    if (f.rec) L.push('    ' + cut(f.rec, 160))
    const t = frameTexts && frameTexts[f.i]
    if (t != null) {
      const ls = t.split('\n').map(s => s.trim()).filter(Boolean)
      if (!ls.length) L.push('    | (blank page)')
      for (const l of ls.slice(0, perFrame)) L.push('    | ' + cut(l, 140))
      if (ls.length > perFrame) L.push(`    | (… ${ls.length - perFrame} more lines: frame-text ${f.i + 1})`)
    }
  }
  if (V.pop && V.pop.length) L.push('  popup: ' + V.pop.join(' · '))
  return L
}
function fmtCode(V, codeLines = 12) {
  const L = ['== Code ==']
  if (V.toolbar.length) L.push('  ' + cut(V.toolbar.join(' · '), 160))
  L.push('  files: ' + cut(V.files.join(', '), 400) + '   (* = open)')
  if (V.tabs.length) L.push('  open: ' + V.tabs.join(' | '))
  if (V.empty) L.push('  ' + V.empty)
  if (V.code.length) {
    for (const [i, l] of V.code.slice(0, codeLines).entries()) L.push(`  ${String(i + 1).padStart(3)}  ${cut(l, 140)}`)
    if (V.code.length > codeLines) L.push(`  (… ${V.code.length - codeLines} more lines)`)
  }
  if (V.foot) L.push('  ' + cut(V.foot, 200))
  return L
}
// runs of short lines (buttons, tabs) read better on one line
function joinShort(ls) {
  const out = []
  for (const l of ls) {
    const prev = out[out.length - 1]
    if (l.length <= 16 && prev != null && prev.short && prev.text.length < 120) prev.text += ' · ' + l
    else out.push({ text: l, short: l.length <= 16 })
  }
  return out.map(x => x.text)
}
function fmtGeneric(V, n = 6) {
  const L = [`== ${VIEW_NAME[V.id] || V.id} ==`]
  const text = joinShort(V.text)
  for (const l of text.slice(0, n)) L.push('  ' + cut(l, 160))
  if (text.length > n) L.push(`  (… ${text.length - n} more lines: view ${VIEW_NAME[V.id] || V.id})`)
  return L
}
function fmtView(V, frameTexts, big) {
  if (V.id === 'agent') return fmtAgent(V, big ? 60 : 22)
  if (V.id === 'canvas') return fmtCanvas(V, frameTexts, big ? 25 : 6)
  if (V.id === 'code') return fmtCode(V, big ? 60 : 12)
  return fmtGeneric(V, big ? 50 : 6)
}
function fmtLook(S, frameTexts, opts = {}) {
  const L = [...fmtHeader(S), ...fmtLayout(S), ...fmtOverlays(S)]
  const order = ['agent', 'canvas', 'code']
  const ids = Object.keys(S.views).sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9))
  for (const id of ids) L.push(...fmtView(S.views[id], frameTexts, opts.big === id))
  return L
}

// a line diff (LCS) between two looks, for "what changed"
function diffLines(a, b, max = 30) {
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out = []; let i = 0, j = 0, sect = ''
  const note = (l) => { const s = l.match(/^== (.*?) ==/); if (s) sect = s[1] }
  let lastSect = null
  const push = (sign, l) => {
    const h = l.match(/^== (.*?) ==/)
    if (h) { sect = lastSect = h[1] } else if (sect !== lastSect) { out.push('  [' + (sect || 'top') + ']'); lastSect = sect }
    out.push(sign + ' ' + l)
  }
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { note(a[i]); i++; j++ }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { note(b[j]); push('+', b[j]); j++ }
    else { push('-', a[i]); i++ }
  }
  return out.length > max ? [...out.slice(0, max), `  (… ${out.length - max} more changed lines; use look)`] : out
}

// ---------------------------------------------------------------- the daemon
const sleep = ms => new Promise(r => setTimeout(r, ms))
class Fail extends Error { }

class Persona {
  constructor(name, browser) { this.name = name; this.browser = browser; this.queue = Promise.resolve() }
  run(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => { }); return p }

  async open() {
    if (this.page && !this.page.isClosed()) return
    this.ctx = await this.browser.newContext({ viewport: { width: 1600, height: 1000 } })
    this.page = await this.ctx.newPage()
    // alert/confirm/prompt in the bench or an app frame: a person reads it and clicks OK
    // (Playwright dismissed them unseen, so confirm() returned false)
    this.dialogs = []
    this.page.on('dialog', d => { this.dialogs.push(d.type() + ' "' + cut(d.message(), 160) + '"'); d.accept().catch(() => { }) })
    const origin = new URL(BENCH).origin, ret = new URL(BENCH).pathname
    await this.page.goto(origin + '/_site/login?return=' + encodeURIComponent(ret), { waitUntil: 'domcontentloaded' })
    if (await this.page.locator('input[name=email]').count()) {
      await this.page.fill('input[name=email]', this.email || EMAIL)
      await this.page.fill('input[name=name]', this.display || 'Admin')
      await this.page.click('form button')
    }
    await this.page.waitForURL(u => u.href.startsWith(BENCH), { timeout: 30000 })
    const bf = await this.bench(60000)
    await bf.waitForFunction(() => document.querySelector('header.bar .projbtn')?.textContent || document.querySelector('.modal') || document.querySelector('.boot'), null, { timeout: 60000 })
    await this.settle(bf, { min: 1500, max: 15000 })
    // a tab that was lost (a daemon restart, a crash) comes back on this persona's own app, not on the
    // app the shared account opened last (a persona's next message went to another app's agent)
    if (this.app) {
      const cur = await bf.evaluate(() => (document.querySelector('header.bar .projbtn .pcode') || {}).textContent || '').catch(() => '')
      if (cur !== this.app) {
        await bf.evaluate(id => window.__SB && window.__SB.App.openProject(id), this.app).catch(() => { })
        await this.settle(bf, { min: 2000, max: 15000 })
        this.reopened = this.app
      }
    }
  }
  // the app this persona is on, remembered after each command
  async rememberApp() {
    try { const bf = await this.bench(3000); const id = await bf.evaluate(() => (document.querySelector('header.bar .projbtn .pcode') || {}).textContent || ''); if (id) this.app = id } catch { }
  }
  // the bench's own page: the sandboxed frame inside the shell
  async bench(timeout = 15000) {
    const el = await this.page.waitForSelector('#app', { state: 'attached', timeout })
    let f = await el.contentFrame()
    const t0 = Date.now()
    while ((!f || !(await f.$('header.bar').catch(() => null))) && Date.now() - t0 < timeout) { await sleep(300); f = await el.contentFrame() }
    if (!f) throw new Fail('the bench page did not load (no frame #app)')
    await f.evaluate(PG.watchToasts).catch(() => { })
    return f
  }
  async snap(bf) { return bf.evaluate(PG.summarize) }
  // the app frames on the canvas: Playwright frames, one per .frm (the visible iframe)
  async appFrames(bf) {
    const frms = await bf.$$('.view[data-view=canvas] .frm')
    const out = []
    for (const frm of frms) {
      let pick = null
      for (const ifr of await frm.$$('.fb iframe')) {
        const op = await ifr.evaluate(e => getComputedStyle(e).opacity)
        if (op !== '0' || !pick) pick = ifr
      }
      out.push(pick ? { el: pick, frame: await pick.contentFrame() } : null)
    }
    return out
  }
  async frameTexts(bf, S) {
    if (!S.views.canvas) return null
    const fr = await this.appFrames(bf)
    return Promise.all(fr.map(async x => {
      if (!x || !x.frame) return '(nothing loaded)'
      try { return await x.frame.evaluate(PG.readAppPage) } catch (e) { return '(could not read: ' + cut(e.message.split('\n')[0], 80) + ')' }
    }))
  }
  async lookLines(bf, opts) { const S = await this.snap(bf); return { S, lines: fmtLook(S, await this.frameTexts(bf, S), opts) } }
  // wait until the screen stops changing
  async settle(bf, { min = 500, max = 5000 } = {}) {
    const t0 = Date.now(); await sleep(min)
    let prev = null, same = 0
    while (Date.now() - t0 < max) {
      const cur = JSON.stringify((await this.lookLines(bf)).lines)
      if (cur === prev) { if (++same >= 2) return } else same = 0
      prev = cur; await sleep(400)
    }
  }
  // run an action, then report what changed on screen
  async act(fn, { settle = {}, quiet = false } = {}) {
    const bf = await this.bench()
    const before = (await this.lookLines(bf)).lines, t0 = Date.now()
    if (this.dialogs) this.dialogs.length = 0
    const msg = await fn(bf)
    await this.settle(bf, settle)
    const { S, lines } = await this.lookLines(bf)
    const out = []
    if (msg) out.push(...[].concat(msg))
    for (const d of this.dialogs || []) out.push('The page showed a dialog: ' + d + ' (you clicked OK).')
    const toasts = await bf.evaluate(PG.toastsSince, t0).catch(() => [])
    for (const t of toasts) if (t !== S.toast) out.push('Notice (shown briefly): ' + t)
    if (quiet) return out
    const d = diffLines(before, lines, 1000)
    // another app, or most of the screen: show the screen, not the diff
    const appOf = l => ((l || '').match(/^Bench · (app \S+|no app open)/) || [])[1]
    if (appOf(before[0]) !== appOf(lines[0]) || d.length > 30) out.push('The screen now:', ...lines)
    else if (!d.length) out.push('Nothing visible changed.')
    else out.push('What changed on screen:', ...d)
    return out
  }

  // ---- commands ----
  // the last reply from Claude, whole (look shows its first lines)
  async reply() {
    const bf = await this.bench(), S = await this.snap(bf), V = S.views.agent
    if (!V) throw new Fail('The Agent view is not open: view Agent first.')
    const m = [...V.msgs].reverse().find(x => x.role === 'agent')
    if (!m) return ['No reply from Claude yet in this thread.']
    return fmtMsg(m, 400, 4000) // whole lines too (a persona: "reply truncates every long line")
  }
  async look() { const bf = await this.bench(); return [...(await this.lookLines(bf)).lines, ...(await this.shellDialog())] }
  // the page around the bench (the shell: Share, sign-in) has dialogs of its own
  async shellDialog() {
    const m = this.page.locator('.shell-modal').last()
    if (!(await m.count().catch(() => 0)) || !(await m.isVisible().catch(() => false))) return []
    const text = (await m.innerText().catch(() => '')).split('\n').map(l => l.trim()).filter(Boolean)
    const buttons = await m.locator('button').allInnerTexts().catch(() => [])
    return ['== Dialog of the page around the bench ==', ...text.slice(0, 30).map(l => '  ' + cut(l, 120)), '  Buttons: ' + buttons.map(b => b.trim()).filter(Boolean).join(' | ')]
  }

  // read the file open in the Code view, lines from..to (a person scrolls through it)
  async read(from, to) {
    const bf = await this.bench()
    const loc = bf.locator('.view[data-view=code] .ed textarea').first()
    if (!(await loc.count()) || !(await loc.isVisible())) throw new Fail('No file is open in the Code view: view Code, then click a file.')
    const lines = (await loc.inputValue()).split('\n')
    const a = Math.max(1, parseInt(from, 10) || 1), b = Math.min(lines.length, parseInt(to, 10) || a + 79)
    const name = await bf.locator('.view[data-view=code] .efoot').first().innerText().then(t => t.split(/\s+/)[0]).catch(() => 'the open file')
    return [`${name}: lines ${a}-${b} of ${lines.length}` + (b < lines.length ? ` (more: read ${b + 1})` : ''), ...lines.slice(a - 1, b).map((l, i) => String(a + i).padStart(5) + '  ' + l)]
  }

  // edit the open file in the Code view: select old (it must occur once) and type new over it
  async edit(old, nw) {
    if (!old || nw == null) throw new Fail('usage: edit <old text> <new text>   (in the file open in the Code view; old must occur exactly once; new may be "")')
    return this.act(async bf => {
      const loc = bf.locator('.view[data-view=code] .ed textarea').first()
      if (!(await loc.count()) || !(await loc.isVisible())) throw new Fail('No file is open in the Code view: view Code, then click a file.')
      const v = await loc.inputValue()
      const n = v.split(old).length - 1
      if (n !== 1) throw new Fail(n ? `"${cut(old, 60)}" occurs ${n} times in the open file; include more of the line so it occurs once.` : `"${cut(old, 60)}" is not in the open file (${v.split('\n').length} lines). Look at it with: view Code`)
      const at = v.indexOf(old)
      await loc.evaluate((ta, [a, b]) => { ta.focus(); ta.setSelectionRange(a, b) }, [at, at + old.length])
      if (nw === '') await this.page.keyboard.press('Delete'); else await this.page.keyboard.insertText(nw)
      return `Edited line ${v.slice(0, at).split('\n').length} of the open file: ${JSON.stringify(cut(old, 60))} → ${JSON.stringify(cut(nw, 60))}`
    })
  }

  // ---- eyes and hands: for a persona that works by looking, not by reading the page as text ----
  // see: a screenshot with a faint labelled grid every 100 px (to aim click-at); the answer is only where it went
  async see(file) {
    if (!file) throw new Fail('usage: see <file.png>   (then look at the file; aim with the grid: x across, y down)')
    await this.page.evaluate(() => {
      const W = innerWidth, H = innerHeight, d = document.createElement('div')
      d.id = '__bd_grid'; d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
      let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">'
      for (let x = 100; x < W; x += 100) svg += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + H + '" stroke="rgba(255,0,128,.22)"/><text x="' + (x + 2) + '" y="11" font-size="10" fill="rgba(200,0,100,.8)">' + x + '</text>'
      for (let y = 100; y < H; y += 100) svg += '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="rgba(255,0,128,.22)"/><text x="2" y="' + (y - 2) + '" font-size="10" fill="rgba(200,0,100,.8)">' + y + '</text>'
      d.innerHTML = svg + '</svg>'; document.body.appendChild(d)
    })
    try { await this.page.screenshot({ path: file }) } finally { await this.page.evaluate(() => { const g = document.getElementById('__bd_grid'); if (g) g.remove() }).catch(() => { }) }
    const v = this.page.viewportSize()
    return [`Saved what the screen shows (${v.width}×${v.height}, grid every 100 px) to ${file}. Look at it.`]
  }
  async pointer(fn, what) {
    await this.bench()
    if (this.dialogs) this.dialogs.length = 0
    await fn(this.page.mouse)
    await sleep(700)
    const out = [what]
    for (const d of this.dialogs || []) out.push('A dialog appeared: ' + d + ' (you clicked OK).')
    return [...out, 'Take another look (see) to know what changed.']
  }
  // what is under a screen point, through the shell's frame, the bench's and a canvas frame (zoomed):
  // a person sees the pointer turn into a hand over something clickable; a screenshot does not show it
  async hitAt(x, y) {
    let f = this.page.mainFrame(), lx = x, ly = y
    for (let d = 0; d < 5; d++) {
      const el = (await f.evaluateHandle(([x, y]) => document.elementFromPoint(x, y), [lx, ly]).catch(() => null))?.asElement()
      if (!el) return null
      const info = await el.evaluate(e => {
        const r = e.getBoundingClientRect(), b = e.closest('button, a[href], [role=button], input, select, textarea, label, summary, [onclick], [tabindex]')
        return { tag: e.tagName, x: r.left, y: r.top, w: r.width, cw: e.clientWidth || r.width, clickable: !!b, cursor: getComputedStyle(e).cursor }
      }).catch(() => null)
      if (!info) return null
      if (info.tag !== 'IFRAME') return info
      const cf = await el.contentFrame(); if (!cf) return info
      const k = info.cw ? info.w / info.cw : 1 // a canvas frame is scaled by the zoom
      lx = (lx - info.x) / k; ly = (ly - info.y) / k; f = cf
    }
    return null
  }
  async clickAt(x, y) {
    if (isNaN(+x) || isNaN(+y)) throw new Fail('usage: click-at <x> <y>')
    await this.bench()
    const hit = await this.hitAt(+x, +y).catch(() => null)
    const cue = hit && !hit.clickable && hit.cursor !== 'pointer' ? ' (The pointer was an arrow there, not a hand: nothing clickable at that exact spot.)' : ''
    return this.pointer(m => m.click(+x, +y), `Clicked at (${+x}, ${+y}).${cue}`)
  }
  dblclickAt(x, y) { if (isNaN(+x) || isNaN(+y)) throw new Fail('usage: dblclick-at <x> <y>'); return this.pointer(m => m.dblclick(+x, +y), `Double-clicked at (${+x}, ${+y}).`) }
  drag(x1, y1, x2, y2) {
    if ([x1, y1, x2, y2].some(v => isNaN(+v))) throw new Fail('usage: drag <x1> <y1> <x2> <y2>')
    return this.pointer(async m => { await m.move(+x1, +y1); await m.down(); await m.move(+x2, +y2, { steps: 12 }); await m.up() }, `Dragged from (${+x1}, ${+y1}) to (${+x2}, ${+y2}).`)
  }
  scrollAt(x, y, dy) { if ([x, y, dy].some(v => isNaN(+v))) throw new Fail('usage: scroll-at <x> <y> <dy>   (dy > 0 scrolls down)'); return this.pointer(async m => { await m.move(+x, +y); await m.wheel(0, +dy) }, `Scrolled ${+dy} px at (${+x}, ${+y}).`) }
  async keys(text) {
    if (text == null || text === '') throw new Fail('usage: keys <text>   (types where the cursor is; click-at a field first)')
    await this.bench(); await this.page.keyboard.type(text, { delay: 8 }); await sleep(300)
    return [`Typed ${JSON.stringify(cut(text, 80))} where the cursor is. Take another look (see).`]
  }

  async shot(file) {
    if (!file) throw new Fail('usage: shot <file.png>')
    await this.page.screenshot({ path: file })
    return ['Saved a screenshot of the whole bench to ' + file]
  }

  async click(arg, within) {
    // a dialog of the page around the bench takes the click first
    const sm = this.page.locator('.shell-modal').last()
    if (arg && (await sm.count().catch(() => 0)) && (await sm.isVisible().catch(() => false))) {
      const b = sm.locator('button, a', { hasText: arg }).first()
      if (await b.count()) { await b.click({ timeout: 5000 }); await sleep(400); return ['Clicked "' + arg + '" in the dialog of the page around the bench.', ...(await this.shellDialog())] }
    }
    try { return await this.click1(arg, within) } catch (e) { if (e.follow) return e.follow; throw e }
  }
  async click1(arg, within) {
    if (!arg) throw new Fail('usage: click <text or CSS selector> [--in <where>]   where: header, menu, dialog, tab, or a view (agent, canvas, code, ...)')
    if (within) { const w = within.toLowerCase(); within = w === 'eval' ? 'evalrepl' : w }
    return this.act(async bf => {
      let r = null
      if (/^[.#\[]|[>\[]|^[a-z]+[.#:\[]/.test(arg)) {
        const loc = bf.locator(arg)
        const n = await loc.count().catch(() => 0)
        for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) { await loc.nth(i).click({ timeout: 5000 }); return 'Clicked ' + arg + (n > 1 ? ` (the first visible of ${n})` : '') }
        if (n) throw new Fail(`"${arg}" matches ${n} element(s), but none is visible`)
      }
      r = await bf.evaluate(PG.clickables, [arg, within || null])
      if (!r.token) throw new Fail(nearby(arg, r.all, within))
      const c = r.chosen
      if (c.disabled) throw new Fail(`"${c.label || c.title}" (${c.where}) is disabled right now`)
      if (c.where === 'agent' && /^(Run|Skip|Approve|Decline)$/.test(c.label)) {
        const before = (await this.lookLines(bf)).lines, nMsgs = await bf.locator('.view[data-view=agent] .chat .msg').count() - 1
        await bf.locator(`[data-bd-target="${r.token}"]`).click({ timeout: 5000 })
        throw Object.assign(new Error('turn'), { follow: await this.finishTurn(bf, { t0: Date.now(), nMsgs, before, verb: `Clicked "${c.label}".` }) })
      }
      await bf.locator(`[data-bd-target="${r.token}"]`).click({ timeout: 5000 })
      return `Clicked "${c.label || c.title}"` + (c.title && c.label && c.title !== c.label ? ` (${c.title})` : '') + ` in ${c.where}` + (r.others.length ? ` (also matched: ${[...new Set(r.others)].join(', ')}; add --in <where> to pick another)` : '')
    })
  }

  async type(field, text) {
    if (!field || text == null) throw new Fail('usage: type <field> <text>   (field: chat, code, id, title, filter, eval, a placeholder word, or a CSS selector)')
    if (/^(code|editor)$/i.test(field) && !this.replaceOk) throw new Fail('type code replaces the WHOLE open file with your text. To change part of it: edit "<old>" "<new>". To really replace all of it: type code --replace "<text>".')
    return this.act(async bf => {
      const r = await bf.evaluate(PG.fieldFor, field)
      if (!r.token) throw new Fail(`No visible field "${field}"${r.hidden ? ' (it exists but is not on screen: open its view first)' : ''}. Fields on screen:\n` + (r.all.length ? r.all.map(x => '  ' + x).join('\n') : '  (none)'))
      const loc = bf.locator(`[data-bd-field="${r.token}"]`)
      await loc.fill(text, { timeout: 5000 })
      return `Typed into ${r.desc}: ${JSON.stringify(cut(text, 120))}`
    })
  }

  async key(k) {
    if (!k) throw new Fail('usage: key <key>   e.g. Enter, Escape, Tab, Control+s')
    return this.act(async () => { await this.page.keyboard.press(k); return 'Pressed ' + k })
  }

  async view(name) {
    if (!name) throw new Fail('usage: view <name>   one of: ' + VIEW_TITLES.join(', '))
    const want = VIEW_TITLES.find(t => t.toLowerCase() === name.toLowerCase()) || VIEW_TITLES.find(t => t.toLowerCase().startsWith(name.toLowerCase()))
    if (!want) throw new Fail(`No view "${name}". Views: ${VIEW_TITLES.join(', ')}`)
    const id = Object.keys(VIEW_NAME).find(k => VIEW_NAME[k] === want)
    const bf = await this.bench()
    const tab = bf.locator(`.dtab[data-view="${id}"] .lbl`)
    let how
    if (await tab.count()) { await tab.first().click(); how = `Clicked the ${want} tab.` }
    else {
      // not in the layout: the "+" (Add a view here) of the first tile, then the view's name
      await bf.locator('.tile .tabact[title="Add a view here"]').first().click()
      await bf.locator('.menu button', { hasText: want }).first().click()
      how = `${want} was not in the layout; added it with the "+" (Add a view here) menu.`
    }
    await this.settle(bf, { min: 400, max: 4000 })
    const S = await this.snap(bf)
    const V = S.views[id]
    if (!V) return [how, `The ${want} view is still not showing.`]
    const ft = id === 'canvas' ? await this.frameTexts(bf, S) : null
    return [how, ...fmtOverlays(S), ...fmtView(V, ft, true)]
  }

  async newApp(id, tpl) {
    if (!id) throw new Fail('usage: new-app <id> [template]   (without a template: opens the New app dialog and lists the templates, as a person sees them)')
    return this.act(async bf => {
      const out = []
      if (!(await bf.locator('.modal .tcards').count())) {
        if (await bf.locator('.modal').count()) throw new Fail('A dialog is open (' + (await bf.locator('.modal .box header span').first().innerText()) + '); close it first (click Cancel or key Escape).')
        await bf.locator('header.bar .projbtn').click()
        out.push('Opened the project menu.')
        const item = bf.locator('.menu button', { hasText: 'New app…' })
        if (!(await item.count())) throw new Fail('The project menu has no "New app…" item.')
        await item.first().click()
        out.push('Clicked "New app…".')
      }
      await bf.locator('.modal .tcards button').first().waitFor({ timeout: 5000 })
      const cards = await bf.locator('.modal .tcards button b').allInnerTexts()
      if (!tpl) {
        const blurbs = await bf.locator('.modal .tcards button small').allInnerTexts()
        return [...out, 'The New app dialog is open. Its templates:', ...cards.map((c, i) => '  "' + c + '": ' + (blurbs[i] || '')), 'Pick one: new-app ' + id + ' "<template>"']
      }
      const t = tpl.toLowerCase()
      const idx = [c => c.toLowerCase() === t, c => c.toLowerCase().startsWith(t), c => c.toLowerCase().includes(t)].map(f => cards.findIndex(f)).find(i => i >= 0)
      if (idx == null) throw new Fail(`No template "${tpl}" in the New app dialog. Templates: ${cards.map(c => '"' + c + '"').join(', ')}. The dialog is still open.`)
      await bf.locator('.modal .tcards button').nth(idx).click()
      out.push(`Picked the "${cards[idx]}" template.`)
      await bf.locator('.modal input.txt').first().fill(id)
      await bf.locator('.modal footer button', { hasText: 'Create' }).click()
      out.push(`Typed the id "${id}" and clicked Create.`)
      // the dialog closes when the app is created and opened; it stays when it failed
      const t0 = Date.now()
      while (Date.now() - t0 < 30000) {
        await sleep(400)
        if (!(await bf.locator('.modal .tcards').count())) break
        const toast = await bf.locator('#toast:not([hidden])').innerText().catch(() => '')
        if (/could not|the id is/i.test(toast)) throw new Fail('The bench said: ' + toast + ' (the dialog is still open)')
      }
      await this.waitFrames(bf)
      return out
    }, { settle: { min: 1000, max: 12000 } })
  }
  async waitFrames(bf, ms = 20000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const S = await this.snap(bf)
      if (!S.views.canvas) return
      const tx = await this.frameTexts(bf, S)
      if (tx && tx.length && tx.every(t => t && t !== '(nothing loaded)')) return
      await sleep(500)
    }
  }

  async openApp(id) {
    if (!id) throw new Fail('usage: open-app <id>')
    return this.act(async bf => {
      if (await bf.locator('.modal').count()) throw new Fail('A dialog is open; close it first (click Cancel or key Escape).')
      await bf.locator('header.bar .projbtn').click()
      // the apps: every item in the Recent and "Apps on this server" groups (New app… and Import app… come first)
      const labels = await bf.locator('.menu').evaluate(m => { const r = []; let inApps = false; for (const c of m.children) { if (c.classList.contains('grp') || /^(Recent|Apps on this server)$/.test((c.textContent || '').trim())) { inApps = /^(Recent|Apps on this server)$/.test((c.textContent || '').trim()); continue } if (c.tagName === 'HR') { inApps = false; continue } const t = c.querySelector('.t'); if (inApps && t) r.push(t.textContent.trim()) } return r })
      const i = labels.findIndex(l => l === id)
      if (i < 0) { await this.page.keyboard.press('Escape'); throw new Fail(`"${id}" is not in the project menu. Apps it lists: ${labels.join(', ') || '(none)'}. (To make one: new-app <id> <template>)`) }
      await bf.locator('.menu button').filter({ has: bf.locator('.t', { hasText: new RegExp('^' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).first().click()
      await bf.waitForFunction(id => (document.querySelector('header.bar .projbtn .pcode') || {}).textContent === id, id, { timeout: 30000 })
      await this.waitFrames(bf)
      return `Opened ${id} from the project menu.`
    }, { settle: { min: 1000, max: 10000 } })
  }

  // ask waits ASK_WAIT seconds at most (a persona's shell gives up on a command after
  // about 180 s, and its next command would queue behind the wait); a turn still
  // running then is followed by wait.
  async ask(message, timeoutS = ASK_WAIT) {
    if (!message) throw new Fail('usage: ask <message>')
    const bf = await this.bench()
    const pre = []
    if (await bf.locator('.modal').count()) throw new Fail('A dialog is open; close it first (click Cancel or key Escape).')
    if (!(await bf.locator('.view[data-view=agent]').isVisible().catch(() => false))) {
      await bf.locator('header.bar .pill[title="Claude"]').click()
      pre.push('Opened the Agent view (clicked "Claude" in the header).')
      await sleep(400)
    }
    const V = bf.locator('.view[data-view=agent]')
    const note = V.locator(':scope > .block:not([hidden])')
    if (await note.count() && await note.isVisible()) throw new Fail('The chat says: ' + (await note.innerText()).replace(/\s+/g, ' '))
    if (await V.locator('.composer .row button', { hasText: 'Stop' }).count()) throw new Fail('Claude is still working on the last message (the chat shows a Stop button). Wait (benchdrive <you> wait 30) or click Stop.')
    const before = (await this.lookLines(bf)).lines
    const nMsgs = await V.locator('.chat .msg').count()
    const ta = V.locator('.composer textarea')
    await ta.fill(message)
    await ta.press('Enter')
    const t0 = Date.now()
    // the turn starts: a new message appears
    let started = false
    while (Date.now() - t0 < 20000) {
      if (await V.locator('.chat .msg').count() > nMsgs) { started = true; break }
      await sleep(250)
    }
    if (!started) {
      const out = [...pre, 'Sent, but no message appeared in the chat after 20 s.']
      const toasts = await bf.evaluate(PG.toastsSince, t0).catch(() => [])
      for (const t of toasts) out.push('Notice: ' + t)
      return out
    }
    return this.finishTurn(bf, { t0, nMsgs, before, pre, timeoutS })
  }
  // wait for the turn to end (or to wait for the person), then report it
  async finishTurn(bf, { t0, nMsgs, before, pre = [], timeoutS = ASK_WAIT, verb = 'Sent.' }) {
    this.pending = null
    // the turn ends: no Stop button, the header's Claude pill no longer "Working"
    let waiting = null
    while (Date.now() - t0 < timeoutS * 1000) {
      await sleep(1000)
      const busy = await bf.evaluate(() => {
        const pill = [...document.querySelectorAll('header.bar .pill')].find(p => p.title === 'Claude')
        const v = document.querySelector('.view[data-view=agent]')
        return {
          working: !!pill && /Working/.test(pill.textContent), stop: !!v && [...v.querySelectorAll('.composer .row button')].some(b => /Stop/.test(b.textContent)),
          ask: !!(v && v.querySelector('.chat .msg:last-child .ask')), approval: !!(v && v.querySelector('.chat .msg:last-child .approval')),
        }
      })
      if (busy.ask || busy.approval) { waiting = busy.ask ? 'Claude is waiting for you to Run or Skip an eval (click Run / click Skip).' : 'Claude is waiting for your approval (click Approve / click Decline).'; break }
      if (!busy.working && !busy.stop) break
    }
    const secs = Math.round((Date.now() - t0) / 1000)
    await this.settle(bf, { min: 1500, max: 8000 })
    await this.waitFrames(bf, 8000)
    const S = await this.snap(bf)
    const msgs = (S.views.agent ? S.views.agent.msgs : []).slice(nMsgs)
    const out = [...pre]
    const still = !waiting && Date.now() - t0 >= timeoutS * 1000
    if (still) this.pending = { t0, nMsgs, before }
    out.push(`${verb} ${waiting ? 'After ' + fmtDur(secs) + ': ' + waiting : still ? 'Claude is still working after ' + fmtDur(secs) + ' (its progress so far is below). Follow it with: benchdrive <you> wait 120' : 'The turn ended after ' + fmtDur(secs) + '.'}`)
    for (const m of msgs) if (m.role === 'agent') out.push(...fmtMsg(m, 40))
    const toasts = await bf.evaluate(PG.toastsSince, t0).catch(() => [])
    for (const t of toasts) out.push('Notice (shown briefly): ' + t)
    // what else changed: header and canvas, not the chat itself
    const after = fmtLook(S, await this.frameTexts(bf, S))
    const strip = ls => { const r = []; let skip = false; for (const l of ls) { if (/^== /.test(l)) skip = /^== Agent/.test(l); if (!skip) r.push(l) } return r }
    const d = diffLines(strip(before), strip(after))
    if (d.length) out.push('Elsewhere on screen:', ...d)
    return out
  }

  async frameText(n) {
    const bf = await this.bench()
    const S = await this.snap(bf)
    if (!S.views.canvas) throw new Fail('The Canvas is not showing; open it with: view Canvas')
    const tx = await this.frameTexts(bf, S), fr = S.views.canvas.frames
    if (!fr.length) return ['The canvas has no frames.']
    const pick = n ? [+n - 1] : fr.map(f => f.i)
    const out = []
    for (const i of pick) {
      const f = fr[i]; if (!f) throw new Fail(`No frame ${n}; the canvas has ${fr.length}.`)
      out.push(`Frame ${i + 1}: ${[f.label, f.route, f.meta].filter(Boolean).join(' · ')}${f.prop ? ' · proposal' : ''}`)
      if (f.status) out.push('  ERROR shown: ' + f.status)
      const ls = (tx[i] || '').split('\n').map(s => s.trimEnd()).filter(s => s.trim())
      if (!ls.length) out.push('  (blank page)')
      for (const l of ls.slice(0, 80)) out.push('  | ' + cut(l, 200))
      if (ls.length > 80) out.push(`  (… ${ls.length - 80} more lines)`)
    }
    return out
  }
  async pickFrame(bf, n) {
    const S = await this.snap(bf)
    if (!S.views.canvas) throw new Fail('The Canvas is not showing; open it with: view Canvas')
    const fr = await this.appFrames(bf)
    if (!fr.length) throw new Fail('The canvas has no frames.')
    const i = n ? +n - 1 : 0
    if (!fr[i] || !fr[i].frame) throw new Fail(`No frame ${n}; the canvas has ${fr.length}.`)
    return { ...fr[i], i, S }
  }
  async frameShot(file, n) {
    if (!file) throw new Fail('usage: frame-shot <file.png> [frame number]')
    const bf = await this.bench()
    const { el, i } = await this.pickFrame(bf, n)
    await el.screenshot({ path: file })
    return [`Saved a screenshot of frame ${i + 1} (as it looks on the canvas, at the canvas's zoom) to ${file}`]
  }
  async frameClick(arg, n) {
    if (!arg) throw new Fail('usage: frame-click <text|selector> [frame number]')
    return this.act(async bf => {
      const { frame, i, S } = await this.pickFrame(bf, n)
      const notes = S.header && S.header.mode !== 'Play' ? [`(The bench is in ${S.header.mode} mode; in Select or Comment mode a click picks the element instead of using the app. Click "Play" in the header to use the app.)`] : []
      let loc = null
      if (/^[.#\[]|[>\[]|^[a-z]+[.#:\[]/.test(arg)) { loc = frame.locator(arg) }
      if (!loc || !(await loc.count())) {
        loc = frame.getByRole('button', { name: arg }).or(frame.getByRole('link', { name: arg })).or(frame.getByText(arg, { exact: true }))
        if (!(await loc.count())) loc = frame.getByText(arg)
      }
      if (!(await loc.count())) {
        const labels = await frame.evaluate(() => [...document.querySelectorAll('button, a, input[type=submit], [role=button], label')].map(e => (e.innerText || e.value || '').trim()).filter(Boolean).slice(0, 30)).catch(() => [])
        throw new Fail(`Nothing called "${arg}" in frame ${i + 1}. Clickable there: ${labels.map(l => '"' + cut(l, 40) + '"').join(', ') || '(nothing)'}`)
      }
      // a frame panned out of sight on the canvas: press Fit, as a person would, and try again
      try { await loc.first().click({ timeout: 5000 }) } catch (e) {
        if (!/Timeout/i.test(String(e && e.message))) throw e
        await bf.getByRole('button', { name: 'Fit', exact: true }).first().click({ timeout: 3000 }).catch(() => { })
        await sleep(600); await loc.first().click({ timeout: 5000 })
        notes.push('(The frame was out of view; Fit was pressed to show the whole canvas.)')
      }
      return [...notes, `Clicked "${arg}" in frame ${i + 1}.`]
    })
  }
  async frameType(sel, text, n) {
    if (!sel || text == null) throw new Fail('usage: frame-type <selector|placeholder|label> <text> [frame number]')
    return this.act(async bf => {
      const { frame, i, S } = await this.pickFrame(bf, n)
      let loc = null
      try { loc = frame.locator(sel); if (!(await loc.count())) loc = null } catch { loc = null }
      if (!loc) { loc = frame.getByPlaceholder(sel).or(frame.getByLabel(sel)); if (!(await loc.count())) loc = null }
      if (!loc) {
        const fields = await frame.evaluate(() => [...document.querySelectorAll('input, textarea, select')].map(e => e.tagName.toLowerCase() + (e.name ? '[name=' + e.name + ']' : '') + (e.placeholder ? ' "' + e.placeholder + '"' : ''))).catch(() => [])
        throw new Fail(`No field "${sel}" in frame ${i + 1}. Fields there: ${fields.join(', ') || '(none)'}`)
      }
      const notes = S.header && S.header.mode !== 'Play' ? [`(The bench is in ${S.header.mode} mode; click "Play" in the header to use the app as its users would.)`] : []
      // a field that is there but hidden (a closed <details>, a collapsed panel): say so, not a timeout
      if (!(await loc.first().isVisible().catch(() => false))) {
        const where = await loc.first().evaluate(e => { const d = e.closest('details:not([open])'); return d ? 'inside a closed section "' + ((d.querySelector('summary') || {}).textContent || '').trim().slice(0, 60) + '"' : 'hidden on the page' }).catch(() => 'hidden on the page')
        throw new Fail(`The field ${sel} in frame ${i + 1} is ${where}: open it first (frame-click its heading).`)
      }
      // a <select>: pick the option by its value or its label (a persona could not set one)
      if (await loc.first().evaluate(e => e.tagName === 'SELECT').catch(() => false)) {
        const opts = await loc.first().evaluate(e => [...e.options].map(o => ({ v: o.value, l: o.label })))
        const o = opts.find(o => o.v === text || o.l === text) || opts.find(o => o.l.toLowerCase().includes(text.toLowerCase()))
        if (!o) throw new Fail(`No option "${text}" in ${sel}. Its options: ${opts.map(o => JSON.stringify(o.l)).join(', ')}`)
        await loc.first().selectOption(o.v, { timeout: 5000 })
        return [...notes, `Chose "${o.l}" in ${sel} in frame ${i + 1}.`]
      }
      await loc.first().fill(text, { timeout: 5000 })
      return [...notes, `Typed ${JSON.stringify(cut(text, 80))} into ${sel} in frame ${i + 1}.`]
    })
  }
  async wait(s = 5) {
    // a turn ask left running: follow it until it ends, or for s more seconds
    if (this.pending) {
      const bf = await this.bench(), p = this.pending
      return this.finishTurn(bf, { ...p, timeoutS: (Date.now() - p.t0) / 1000 + Math.min(+s || 120, ASK_WAIT), verb: 'Following your last message to Claude.' })
    }
    return this.act(async () => { await sleep(Math.min(+s || 5, 600) * 1000); return `Waited ${+s || 5} s.` }, { settle: { min: 300, max: 3000 } }) }
  async close() { if (this.ctx) await this.ctx.close(); this.page = null; this.app = null; return ['Closed your browser tab.'] }
}

function fmtDur(s) { return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s' }

function nearby(arg, all, within) {
  const a = arg.toLowerCase(), words = a.split(/\W+/).filter(w => w.length > 2)
  const score = c => {
    const l = (c.label + ' ' + c.title).toLowerCase()
    let s = 0
    if (l.includes(a) || (a.includes(c.label.toLowerCase()) && c.label.length > 2)) s += 5
    for (const w of words) if (l.includes(w)) s += 2
    for (let i = 0; i + 2 < a.length; i++) if (l.includes(a.slice(i, i + 3))) s += 0.2
    if (c.where === 'menu' || c.where === 'dialog') s += 1
    return s
  }
  const seen = new Set(), list = []
  for (const c of all.map(c => ({ ...c, s: score(c) })).sort((x, y) => y.s - x.s)) {
    const k = (c.label || c.title) + '|' + c.where
    if (seen.has(k)) continue
    seen.add(k); list.push(c)
    if (list.length >= 20) break
  }
  return `Nothing on screen${within ? ' in ' + within : ''} is labelled "${arg}". Things you can click (closest first; where they are in brackets):\n` +
    list.map(c => '  ' + (c.label ? JSON.stringify(cut(c.label, 50)) : '') + (c.title && c.title !== c.label ? (c.label ? ' ' : '') + '(' + cut(c.title, 60) + ')' : '') + ' [' + c.where + ']' + (c.disabled ? ' (disabled)' : '')).join('\n') +
    '\nUse the label exactly as shown, or a CSS selector.'
}

// BENCHDRIVE_RECORD=<dir>: every command is recorded for the transcript
// browser: <dir>/<persona>/steps.jsonl (one line per command: n, t, ms,
// cmd, args, ok, out) and <dir>/<persona>/shots/<n>.jpg (the bench after
// the command; nothing after look, frame-text and wait-free reads).
const RECORD = process.env.BENCHDRIVE_RECORD || ''
const READS = new Set(['look', 'frame-text', 'shot', 'frame-shot', 'see', 'reply'])
async function record(P, persona, cmd, args, ok, out, ms, where) {
  const root = where || RECORD
  if (!root || !path.isAbsolute(root)) return
  const dir = path.join(root, persona)
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
  P.recN = (P.recN || 0) + 1
  const rec = { n: P.recN, t: new Date().toISOString(), ms, cmd, args, ok, out: String(out).slice(0, 20000) }
  if (!READS.has(cmd) && P.page && !P.page.isClosed()) {
    try { await P.page.screenshot({ path: path.join(dir, 'shots', P.recN + '.jpg'), type: 'jpeg', quality: 60 }); rec.shot = 'shots/' + P.recN + '.jpg' } catch { }
  }
  fs.appendFileSync(path.join(dir, 'steps.jsonl'), JSON.stringify(rec) + '\n')
}

async function serve(port) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const personas = new Map()
  const pidFile = path.join(HERE, 'benchdrive.pid')
  fs.writeFileSync(pidFile, String(process.pid))
  const commands = {
    look: P => P.look(), shot: (P, a) => P.shot(a[0]), click: (P, a) => { const i = a.indexOf('--in'); return i >= 0 ? P.click(a.slice(0, i).join(' '), a[i + 1]) : P.click(a.join(' ')) },
    type: (P, a) => { const r = a.indexOf('--replace'); P.replaceOk = r >= 0; const b = r >= 0 ? a.filter((_, i) => i !== r) : a; return P.type(b[0], b.slice(1).join(' ')).finally(() => { P.replaceOk = false }) }, key: (P, a) => P.key(a[0]),
    read: (P, a) => P.read(a[0], a[1]), reply: P => P.reply(),
    see: (P, a) => P.see(a[0]), 'click-at': (P, a) => P.clickAt(a[0], a[1]), 'dblclick-at': (P, a) => P.dblclickAt(a[0], a[1]),
    drag: (P, a) => P.drag(a[0], a[1], a[2], a[3]), 'scroll-at': (P, a) => P.scrollAt(a[0], a[1], a[2]), keys: (P, a) => P.keys(a.join(' ')),
    'new-app': (P, a) => P.newApp(a[0], a.slice(1).join(' ')), 'open-app': (P, a) => P.openApp(a[0]),
    ask: (P, a) => P.ask(a.join(' ')), 'frame-text': (P, a) => P.frameText(a[0]), 'frame-shot': (P, a) => P.frameShot(a[0], a[1]),
    'frame-click': (P, a) => P.frameClick(a[0], a[1]), 'frame-type': (P, a) => P.frameType(a[0], a[1], a[2]),
    view: (P, a) => P.view(a.join(' ')), edit: (P, a) => P.edit(a[0], a[1]), wait: (P, a) => P.wait(a[0]), close: P => P.close(),
  }
  const EYES = {
    see: commands.see, 'click-at': commands['click-at'], 'dblclick-at': commands['dblclick-at'], drag: commands.drag,
    'scroll-at': commands['scroll-at'], keys: commands.keys,
    key: async (P, a) => { if (!a[0]) throw new Fail('usage: key <key>'); await P.bench(); await P.page.keyboard.press(a[0]); await sleep(500); return [`Pressed ${a[0]}. Take another look (see).`] },
    pause: async (P, a) => { const s = Math.min(Math.max(+a[0] || 10, 1), 170); await sleep(s * 1000); return [`Waited ${s} s. Take another look (see).`] },
  }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', async () => {
      const reply = (code, text) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text.endsWith('\n') ? text : text + '\n') }
      try {
        if (req.url === '/stop') { reply(200, 'stopping'); await browser.close().catch(() => { }); try { fs.unlinkSync(pidFile) } catch { } process.exit(0) }
        if (req.url === '/status') return reply(200, `benchdrive pid ${process.pid} on 127.0.0.1:${port}, bench ${BENCH}\npersonas: ${[...personas.keys()].join(', ') || '(none yet)'}`)
        const { persona, cmd, args, record: where, email, name: display } = JSON.parse(body || '{}')
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(persona || '')) return reply(400, 'error: a persona name is letters, digits, - and _')
        // a persona named *-visual works by eye: only the commands that show pixels or move the
        // pointer, and key/pause answer without describing the page
        const visual = /-visual$/.test(persona)
        if (visual && !EYES[cmd]) return reply(422, `A persona that works by eye can use only: ${Object.keys(EYES).join(', ')}.`)
        const fn = visual ? EYES[cmd] : commands[cmd]
        if (!fn) return reply(400, `error: unknown command "${cmd}".\n\n` + HELP)
        let P = personas.get(persona)
        if (!P) { P = new Persona(persona, browser); personas.set(persona, P) }
        // the account this persona signs in as (BENCHDRIVE_EMAIL/NAME of its client), used when its tab opens
        if (email && /^[^@\s]+@[^@\s]+$/.test(email)) { P.email = email; P.display = display || persona }
        const t0 = Date.now()
        const out = await P.run(async () => {
          if (cmd !== 'close') { const fresh = !P.page || P.page.isClosed(); await P.open(); if (fresh && cmd !== 'look') { /* first use: the persona starts at the bench */ } }
          return fn(P, args || [])
        })
        console.log(new Date().toISOString(), persona, cmd, (Date.now() - t0) + 'ms')
        await P.run(() => P.rememberApp()).catch(() => { })
        const reopened = P.reopened ? `(Your browser tab had closed; it was opened again on ${P.reopened}.)\n` : ''
        P.reopened = null
        const text = reopened + [].concat(out).join('\n')
        await P.run(() => record(P, persona, cmd, args || [], true, text, Date.now() - t0, where)).catch(() => { })
        reply(200, text)
      } catch (e) {
        const msg = e instanceof Fail ? e.message : 'error: ' + String(e && e.message || e).split('\n').filter(l => !/^\s+at /.test(l)).slice(0, 6).join('\n')
        console.log(new Date().toISOString(), 'error', msg.split('\n')[0])
        try { const { persona, cmd, args, record: where } = JSON.parse(body || '{}'); const P = personas.get(persona); if (P) await P.run(() => record(P, persona, cmd, args || [], false, msg, 0, where)).catch(() => { }) } catch { }
        reply(e instanceof Fail ? 422 : 500, msg)
      }
    })
  })
  server.requestTimeout = 0; server.headersTimeout = 0
  server.listen(port, '127.0.0.1', () => console.log(`benchdrive serving on 127.0.0.1:${port} (pid ${process.pid}), bench ${BENCH}`))
}

// ---------------------------------------------------------------- the client
function call(pathname, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : ''
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', c => { b += c }); res.on('end', () => resolve({ code: res.statusCode, text: b }))
    })
    req.on('error', reject)
    req.end(data)
  })
}

async function main() {
  const argv = process.argv.slice(2)
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') { console.log(HELP); return }
  if (argv[0] === 'serve') { const i = argv.indexOf('--port'); return serve(i >= 0 ? +argv[i + 1] : PORT) }
  if (argv[0] === 'stop' || argv[0] === 'status') {
    try { const r = await call('/' + argv[0]); process.stdout.write(r.text) } catch { console.log(`no benchdrive daemon on 127.0.0.1:${PORT}`); process.exitCode = 1 }
    return
  }
  const [persona, cmd, ...args] = argv
  if (!cmd || cmd === 'help') { console.log(HELP); return }
  // files are written by the daemon: make paths absolute from here
  if ((cmd === 'shot' || cmd === 'frame-shot' || cmd === 'see') && args[0]) args[0] = path.resolve(args[0])
  try {
    const r = await call('/cmd', { persona, cmd, args, record: process.env.BENCHDRIVE_RECORD || undefined, email: process.env.BENCHDRIVE_EMAIL || undefined, name: process.env.BENCHDRIVE_NAME || undefined })
    process.stdout.write(r.text)
    if (r.code !== 200) process.exitCode = 1
  } catch (e) {
    console.log(`benchdrive: no daemon on 127.0.0.1:${PORT} (${e.code || e.message}). Start it with: benchdrive serve`)
    process.exitCode = 2
  }
}
main()
