// page.js — functions that run inside the bench's page (the sandboxed frame
// that holds the workbench). They only read what the page shows: text that
// is rendered (innerText), which buttons exist and are visible, what a field
// holds. Nothing here calls the bench's code or the server.
//
// Each export is a self-contained function, passed to frame.evaluate.

// summarize the screen: header, layout, dialog, menu, toast and every
// visible view, as plain data the daemon formats.
export function summarize() {
  const q = (s, r = document) => r.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)]
  const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const clean = s => (s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()
  const lines = el => (el ? el.innerText || '' : '').split('\n').map(clean).filter(Boolean)
  const one = el => lines(el).join(' ')
  const out = { views: {}, tiles: [], floats: [] }

  const boot = q('.boot'); if (boot) out.bootError = lines(boot).slice(0, 12)
  const bar = q('header.bar')
  if (bar) {
    const pill = t => qa('.pill', bar).find(p => (p.title || '').includes(t))
    out.header = {
      app: one(q('.projbtn', bar)).replace(/▾/g, '').trim(),
      ws: one(q('.wsbtn', bar)).replace(/▾/g, '').trim(),
      mode: clean((q('.modes button.on', bar) || {}).textContent),
      health: one(pill('checks')),
      claude: one(qa('.pill', bar).find(p => p.title === 'Claude')),
      store: one(qa('.pill', bar).find(p => (p.title || '').startsWith('App store'))),
    }
  }
  for (const t of qa('.dock .tile')) {
    out.tiles.push(qa('.dtab', t).map(d => ({ title: one(q('.lbl', d)), view: d.dataset.view, on: d.classList.contains('on') })))
  }
  for (const f of qa('.float')) out.floats.push(one(q('.fhead span', f)))

  // a dialog, a menu, a toast: on top of everything
  const box = qa('.modal .box').pop()
  if (box) {
    out.modal = {
      title: one(q('header span', box)),
      text: lines(q('.bd', box)).slice(0, 30),
      cards: qa('.tcards button', box).map(b => ({ name: one(q('b', b)), on: b.classList.contains('on') })),
      fields: qa('input, textarea', q('.bd', box)).filter(vis).map(i => ({ ph: i.placeholder || i.name || i.type, value: i.value })),
      buttons: qa('footer button', box).map(one),
    }
  }
  const menu = q('.menu')
  if (menu && vis(menu)) {
    out.menu = [...menu.children].map(c => {
      if (c.classList.contains('grp')) return { group: one(c) }
      if (c.tagName === 'HR') return { hr: true }
      if (c.classList.contains('note')) return { note: one(c) }
      if (c.tagName === 'BUTTON') return { label: one(q('.t', c)) || one(c), sub: one(q('small', c)), on: c.classList.contains('on'), disabled: c.disabled, danger: c.classList.contains('danger') }
      return { note: one(c) }
    })
  }
  const toast = q('#toast'); if (toast && !toast.hidden && vis(toast)) out.toast = one(toast)

  // the views a person can see right now
  for (const v of qa('.view')) {
    if (!vis(v)) continue
    const id = v.dataset.view, V = out.views[id] = { id }
    if (id === 'agent') {
      V.threads = qa('.threads .th', v).map(t => (t.classList.contains('on') ? '*' : '') + one(t))
      const note = qa(':scope > .block', v).find(x => !x.hidden && vis(x)); if (note) V.note = one(note)
      V.msgs = qa('.chat .msg', v).map(m => {
        const who = q('.who', m), r = { role: m.classList.contains('user') ? 'user' : 'agent', who: lines(who).filter(s => !/mark$/.test(s)).join(' · ') }
        r.running = !!q('.who .dot.busy', m)
        r.steps = qa('details.step', m).map(d => ({ sum: lines(q('summary', d)).join(' · '), ask: !!q('.ask', d), bad: d.classList.contains('bad'), extra: d.open ? [...d.children].filter(c => c.tagName !== 'SUMMARY' && !c.matches('.ask')).flatMap(lines).slice(0, 12) : [] }))
        r.body = []
        for (const c of m.children) {
          if (c === who || c.matches('details.step')) continue
          if (c.matches('.approval')) { r.approval = lines(c); continue }
          r.body.push(...lines(c))
        }
        return r
      })
      const empty = q('.chat > .note', v); if (empty && !V.msgs.length) V.empty = one(empty)
      const ta = q('.composer textarea', v)
      V.draft = ta ? ta.value : ''
      V.chips = qa('.ctxchips > *', v).map(one).filter(Boolean)
      const row = q('.composer .row', v)
      if (row) {
        V.segs = qa('.seg', row).map(s => qa('button', s).map(b => (b.classList.contains('on') ? '*' : '') + one(b)).join('|'))
        const sel = q('select', row); V.model = sel ? (sel.selectedOptions[0] || {}).textContent : ''
        V.action = qa(':scope > button', row).map(one).join(' ')
      }
    } else if (id === 'canvas') {
      V.toolbar = qa(':scope > .toolbar button, :scope > .toolbar .lbl', v).filter(vis).map(b => one(b) + (b.classList.contains('on') ? '*' : '')).join(' · ')
      V.hud = one(q('.cvhud', v))
      V.frames = qa('.frm', v).map((f, i) => {
        const route = q('select.route', f)
        return {
          i, label: one(q('.flabel', f)), route: route && !route.hidden ? (route.selectedOptions[0] || {}).textContent : '', meta: one(q('.meta', f)),
          status: one(q('.fstatus', f)), prop: f.classList.contains('prop'), rec: one(q('.recbar', f)),
          visible: (() => { const r = f.getBoundingClientRect(), c = v.getBoundingClientRect(); return r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom })(),
        }
      })
      V.pop = lines(q('.cv > div:last-child', v)).slice(0, 10)
    } else if (id === 'code') {
      V.files = qa('.fl > *', v).map(f => (f.classList.contains('dir') ? '' : '') + one(f) + (f.classList.contains('on') ? '*' : ''))
      V.tabs = qa('.ftabs > *', v).map(one).filter(Boolean)
      const pre = q('.ed pre', v), ed = q('.ed', v)
      V.code = ed && vis(ed) && pre ? (pre.innerText || '').split('\n') : []
      V.foot = one(q('.efoot', v)); V.empty = vis(q('p.empty', v)) ? one(q('p.empty', v)) : ''
      V.toolbar = qa('.toolbar', v).filter(vis).map(one).filter(Boolean)
    } else {
      V.text = lines(v)
    }
  }
  return out
}

// visible things a person can click, with a label each; marks the chosen one
export function clickables([arg, within]) {
  const q = (s, r = document) => r.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)]
  const vis = el => { if (!el || !el.getClientRects().length) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' }
  const clean = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
  const norm = s => clean(s).toLowerCase().replace(/[▾↵…]/g, '').replace(/\s+/g, ' ').trim()
  for (const el of qa('[data-bd-target]')) el.removeAttribute('data-bd-target')
  const modal = qa('.modal').pop(), menu = q('.menu')
  const root = menu && vis(menu) ? null : modal || null
  const sel = 'button, a[href], [role=button], [role=tab], summary, label, input[type=checkbox], input[type=radio], select'
  let els = qa(sel).filter(vis)
  // with a dialog open, only the dialog (and an open menu) can be clicked
  if (modal) els = els.filter(e => modal.contains(e) || (menu && menu.contains(e)))
  const where = e => {
    if (menu && menu.contains(e)) return 'menu'
    if (modal && modal.contains(e)) return 'dialog'
    if (e.closest('header.bar')) return 'header'
    const v = e.closest('.view'); if (v) return v.dataset.view
    if (e.closest('.dstrip')) { const t = e.closest('.dtab'); return t ? 'tab' : 'tile bar' }
    return 'page'
  }
  const cands = els.map((e, i) => {
    let label = clean(e.innerText || e.value || '')
    if (e.matches('.menu button')) label = clean((q('.t', e) || e).innerText)
    if (e.tagName === 'SELECT') label = clean((e.selectedOptions[0] || {}).text || '')
    if (e.matches('.dtab .lbl')) label = clean(e.firstChild ? e.firstChild.textContent : label)
    return { i, label, title: clean(e.title || e.getAttribute('aria-label') || ''), where: where(e), disabled: !!e.disabled }
  })
  const a = norm(arg)
  const exact = clean(arg).replace(/[▾↵…]/g, '').trim()
  const tiers = [
    c => clean(c.label).replace(/[▾↵…]/g, '').trim() === exact, c => norm(c.label) === a, c => norm(c.title) === a, c => norm(c.label).startsWith(a) && a.length >= 2,
    c => a.length >= 3 && norm(c.label).includes(a), c => a.length >= 3 && norm(c.title).includes(a),
  ]
  const rank = { menu: 0, dialog: 1 }
  const pool = within ? cands.filter(c => c.where === within) : cands
  // a <select> only opens its list: anything else with the same label first
  const pri = c => (rank[c.where] ?? 2) * 2 + (els[c.i].tagName === 'SELECT' ? 1 : 0)
  for (const t of tiers) {
    const hits = pool.filter(t).sort((x, y) => pri(x) - pri(y))
    if (hits.length) {
      const c = hits[0], token = String(Math.random()).slice(2)
      els[c.i].setAttribute('data-bd-target', token)
      return { token, chosen: c, others: hits.slice(1).map(h => h.where) }
    }
  }
  return { token: null, all: pool.filter(c => c.label || c.title), within }
}

// a text field by alias, CSS selector, placeholder, aria-label or label text
export function fieldFor(arg) {
  const qa = (s, r = document) => [...r.querySelectorAll(s)]
  const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()
  for (const el of qa('[data-bd-field]')) el.removeAttribute('data-bd-field')
  const modal = qa('.modal').pop()
  const aliases = {
    chat: '.view[data-view=agent] .composer textarea', composer: '.view[data-view=agent] .composer textarea',
    code: '.view[data-view=code] .ed textarea', editor: '.view[data-view=code] .ed textarea',
    id: '.modal input.txt', title: '.modal input.txt:nth-of-type(2)', filter: '.view[data-view=code] .flist input',
    eval: '.view[data-view=evalrepl] textarea', dialog: '.modal input, .modal textarea',
  }
  let els = []
  const a = norm(arg)
  if (aliases[a]) els = qa(aliases[a])
  if (a === 'title') els = qa('.modal input.txt').slice(1)
  // a dialog's fields as look prints them: dialog, dialog2, …; and "text" / "field" for its first one
  const dm = /^dialog(\d+)$/.exec(a)
  if (modal && (dm || a === 'text' || a === 'field')) { const fs = qa('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea', modal); els = dm ? fs.slice(Number(dm[1]) - 1, Number(dm[1])) : fs.slice(0, 1) }
  if (!els.length) { try { els = qa(arg) } catch { els = [] } }
  const fields = qa('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, [contenteditable=true]').filter(vis).filter(e => !modal || modal.contains(e))
  if (!els.length && a.length >= 2) els = fields.filter(e => norm(e.placeholder).includes(a) || norm(e.getAttribute('aria-label')).includes(a) || norm(e.name) === a || norm(e.title).includes(a))
  els = els.filter(e => e.matches('input, textarea, [contenteditable=true]'))
  const vis1 = els.filter(vis)
  const pick = vis1[0] || null
  if (!pick) return { token: null, all: fields.map(e => (e.tagName.toLowerCase() + (e.placeholder ? ' "' + e.placeholder.slice(0, 50) + '"' : '') + (e.closest('.view') ? ' in ' + e.closest('.view').dataset.view : e.closest('.modal') ? ' in dialog' : ''))), hidden: els.length > 0 }
  const token = String(Math.random()).slice(2)
  pick.setAttribute('data-bd-field', token)
  return { token, desc: pick.tagName.toLowerCase() + (pick.placeholder ? ' "' + pick.placeholder.slice(0, 50) + '"' : '') + (pick.closest('.view') ? ' in ' + pick.closest('.view').dataset.view : pick.closest('.modal') ? ' in the dialog' : '') }
}

// record toasts as they appear (they vanish after a few seconds)
export function watchToasts() {
  if (window.__bdToasts) return
  window.__bdToasts = []
  const seen = el => { if (!el.hidden && el.textContent) window.__bdToasts.push({ t: Date.now(), text: el.textContent }) }
  const attach = el => new MutationObserver(() => seen(el)).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
  const t = document.getElementById('toast')
  if (t) attach(t)
  else new MutationObserver((_, obs) => { const el = document.getElementById('toast'); if (el) { obs.disconnect(); seen(el); attach(el) } }).observe(document.body, { childList: true })
}
export function toastsSince(t0) { return (window.__bdToasts || []).filter(x => x.t >= t0).map(x => x.text).filter((x, i, a) => a.indexOf(x) === i) }

// the app's own page, as a person reads it: text by block, with fields and
// buttons shown in brackets ([Add], [field "Add an item"], [x] a checkbox)
export function readAppPage() {
  const out = []; let line = ''
  const flush = () => { const t = line.replace(/\s+/g, ' ').trim(); if (t) out.push(t); line = '' }
  const walk = n => {
    if (n.nodeType === 3) { line += n.textContent; return }
    if (n.nodeType !== 1) return
    const tag = n.tagName
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD'].includes(tag)) return
    const cs = getComputedStyle(n)
    if (cs.display === 'none' || cs.visibility === 'hidden') return
    const block = tag === 'BR' || !/^(inline|inline-block|inline-flex|inline-grid|contents)$/.test(cs.display)
    if (block) flush()
    if (tag === 'INPUT') {
      const t = (n.type || 'text').toLowerCase()
      if (t === 'hidden') return
      if (t === 'checkbox' || t === 'radio') line += ` [${n.checked ? 'x' : ' '}] `
      else if (t === 'submit' || t === 'button' || t === 'reset') line += ` [${n.value || t}] `
      else line += ` [${t === 'text' ? '' : t + ' '}field${n.placeholder ? ' "' + n.placeholder + '"' : ''}${n.value ? ': ' + n.value : ''}] `
      return
    }
    if (tag === 'TEXTAREA') { line += ` [text box${n.placeholder ? ' "' + n.placeholder + '"' : ''}${n.value ? ': ' + n.value.slice(0, 200) : ''}] `; return }
    if (tag === 'SELECT') { line += ` [choice: ${(n.selectedOptions[0] || {}).text || ''}] `; return }
    if (tag === 'BUTTON') { line += ` [${(n.innerText || n.title || 'button').replace(/\s+/g, ' ').trim()}] `; return }
    if (tag === 'IMG') { line += n.alt ? ` [image: ${n.alt}] ` : ' [image] '; return }
    if (tag === 'svg' || tag === 'CANVAS') { line += ' [' + tag.toLowerCase() + '] '; return }
    for (const c of n.childNodes) walk(c)
    if (block) flush()
  }
  if (document.body) walk(document.body)
  flush()
  return out.join('\n')
}
