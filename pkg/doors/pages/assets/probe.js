/* the bench, built from web/bench: do not edit. source sha256:da3d38d807d381ad24002642e7446cb003b25e75ab659629fb939c87e3077a19 */
// slop's dev probe (SLOP3-022): the bench's PROBE from web/bench/src/frames/probe.js,
// which the sandbox adds to dev embeds only, after the runtime. It answers the
// tool that framed the view (the boot data's parentOrigin) and nothing else.
(() => {
  'use strict';
  const bootEl = document.getElementById('slop-boot');
  let boot = {};
  try { boot = JSON.parse((bootEl && bootEl.textContent) || '{}'); } catch (e) { boot = {}; }
  if (!boot.parentOrigin || window.parent === window) return;
  const q = new URLSearchParams(location.search);
// frames/probe.js — the script slop adds to the bench's embedded views of an
// instance: it reports picks, console lines, checks and layouts, and answers
// the bench's ops (click, type, query, layout, snapshot, …).
//
// It runs inside the framed page, not in the bench, so it must stand alone:
// build.mjs writes this function into pkg/doors/pages/assets/probe.js, which
// slop's sandbox serves after the runtime in dev embeds. It talks to the
// bench's origin only (CFG.origin) and to nothing else; links navigate as
// they do in the app.
//
// Public API: PROBE(CFG) — CFG {embedded, origin, nonce, route, mode, pins,
// preview, record}. The host side is frames/host.js.
function PROBE(CFG) {
  const post = m => parent.postMessage(Object.assign({ __sb: 'probe', nonce: CFG.nonce }, m), CFG.origin || '*')
  const fmt = v => { try { return typeof v === 'string' ? v : v instanceof Error ? v.name + ': ' + v.message : JSON.stringify(v) } catch (e) { return String(v) } }
  for (const l of ['log', 'info', 'warn', 'error']) { const o = console[l].bind(console); console[l] = (...a) => { o(...a); post({ ev: 'log', level: l, text: a.map(fmt).join(' ').slice(0, 2000) }) } }
  addEventListener('error', e => post({ ev: 'log', level: 'error', text: e.message, src: e.filename && !/^about:/.test(e.filename) ? e.filename.split('/').pop() + (e.lineno ? ':' + e.lineno : '') : '' }))
  addEventListener('unhandledrejection', e => post({ ev: 'log', level: 'error', text: 'Unhandled rejection: ' + fmt(e.reason && e.reason.message || e.reason) }))

  let mode = CFG.mode || 'select', pins = CFG.pins || [], selected = null, recording = !!CFG.record
  // a file of the app, from a URL of an embedded view (/e/<token>/v/<n>/<path>)
  const fileOfURL = href => { try { return decodeURIComponent(new URL(href, location.href).pathname.replace(/^\/e\/[^/]+\/v\/\d+\//, '').replace(/^\/v\/\d+\//, '')) } catch (e) { return '' } }
  // the file a stylesheet came from: its URL (an inline style has none)
  const sheetFile = s => s.href ? fileOfURL(s.href) : ''
  // ---- element helpers ----
  const srcOf = el => el && el.closest && (el.closest('[data-src]') || {}).dataset?.src || ''
  function find(t) {
    if (!t) return null
    if (t.nodeType) return t
    const q = typeof t === 'string' ? t : t.src ? '[data-src="' + t.src + '"]' : t.selector
    const el = qsa(q)[0]
    if (!el) throw new Error('no element matches ' + q)
    return el
  }
  // CSS selectors, plus a trailing :has-text("words"): elements whose visible text contains the words (innermost first)
  function qsa(q) {
    const m = /^(.*?):has-text\((["']?)(.*)\2\)$/.exec(String(q).trim())
    let list
    try { list = [...document.querySelectorAll(m ? (m[1].trim() || '*') : q)] } catch (e) { throw new Error('bad selector ' + q) }
    if (!m) return list
    const want = m[3].toLowerCase().replace(/\s+/g, ' ').trim()
    const hits = list.filter(el => (el.innerText || el.textContent || '').toLowerCase().replace(/\s+/g, ' ').includes(want))
    return hits.filter(el => !hits.some(o => o !== el && el.contains(o)))
  }
  // a selector a recording can replay: the shortest of several that picks out exactly this element
  function stableSel(el) {
    const uniq = q => { try { const l = qsa(q); return l.length === 1 && l[0] === el } catch (e) { return false } }
    const tag = el.tagName.toLowerCase(), esc = v => String(v).replace(/["\\]/g, '\\$&')
    const cands = []
    if (el.id) cands.push('#' + CSS.escape(el.id))
    for (const at of el.attributes) if (/^data-(?!src)/.test(at.name) && at.value && at.value.length < 40) cands.push(tag + '[' + at.name + '="' + esc(at.value) + '"]')
    if (el.name) cands.push(tag + '[name="' + esc(el.name) + '"]')
    if (tag === 'a' && el.getAttribute('href')) cands.push('a[href="' + esc(el.getAttribute('href')) + '"]')
    const txt = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ')
    if (txt && txt.length <= 40 && !/["()]/.test(txt)) cands.push(tag + ':has-text("' + txt + '")')
    for (const c of cands) if (uniq(c)) return c
    const anc = el.parentElement && el.parentElement.closest('[id], [data-id], li, tr, article, .card, section')
    if (anc && anc !== document.body) { const a = stableSelShallow(anc); for (const c of cands.slice(1)) { const q = a + ' ' + c; if (uniq(q)) return q } }
    return selPath(el)
  }
  function stableSelShallow(el) {
    if (el.id) return '#' + CSS.escape(el.id)
    if (el.dataset.id) return el.tagName.toLowerCase() + '[data-id="' + el.dataset.id + '"]'
    const t = (el.innerText || '').trim().split('\n')[0].slice(0, 30)
    return t && !/["()]/.test(t) && qsa(el.tagName.toLowerCase() + ':has-text("' + t + '")').length === 1 ? el.tagName.toLowerCase() + ':has-text("' + t + '")' : selPath(el)
  }
  function selPath(el) {
    if (el.id) return '#' + el.id
    const parts = []
    for (let e = el; e && e.nodeType === 1 && e !== document.body && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase()
      if (e.id) { parts.unshift('#' + e.id); break }
      const cls = [...e.classList].filter(c => !c.startsWith('__sb')).slice(0, 2)
      if (cls.length) s += '.' + cls.join('.')
      const sib = e.parentElement ? [...e.parentElement.children].filter(x => x.tagName === e.tagName) : []
      if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')'
      parts.unshift(s)
    }
    return parts.join(' > ')
  }
  function info(el) {
    const r = el.getBoundingClientRect()
    return { src: el.dataset.src || srcOf(el), tag: el.tagName.toLowerCase(), id: el.id || '', cls: [...el.classList].filter(c => !c.startsWith('__sb')).join(' '),
      text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120), selector: selPath(el),
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }, leaf: [...el.childNodes].every(n => n.nodeType === 3) && !!el.textContent.trim(), attrs: attrsOf(el) }
  }
  function attrsOf(el) {
    const a = {}
    for (const at of el.attributes) if (/^(data-(?!src)|href$|type$|name$|alt$|role$|aria-|disabled$|placeholder$|for$|title$)/.test(at.name)) a[at.name] = at.value.slice(0, 120)
    if ('value' in el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) a.value = String(el.value).slice(0, 120)
    if (el.type === 'checkbox' || el.type === 'radio') a.checked = el.checked
    return Object.keys(a).length ? a : undefined
  }
  // settle: no DOM changes for a moment (a page renders after its data arrives)
  let lastMut = performance.now()
  async function settle(max = 1500) {
    const t0 = performance.now()
    while (performance.now() - t0 < max) { if (performance.now() - lastMut > 80) return true; await new Promise(r => setTimeout(r, 25)) }
    return false
  }
  // layout map: every rendered element keyed by its source line, or by its path from the nearest element that has one
  function layout() {
    const items = [], seen = new Map()
    const ourEl = el => el.classList.contains('__sbbox') || el.classList.contains('__sbpin') || el.classList.contains('__sbpins')
    const walk = (el, pkey) => {
      const counts = {}
      for (const c of el.children) {
        if (items.length >= 2500) return
        if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE)$/.test(c.tagName) || ourEl(c)) continue
        const cs = getComputedStyle(c); if (cs.display === 'none') continue
        const cls = [...c.classList][0], tag = c.tagName.toLowerCase() + (c.id ? '#' + c.id : cls ? '.' + cls : '')
        let k
        if (c.dataset.src) { const n = seen.get(c.dataset.src) || 0; seen.set(c.dataset.src, n + 1); k = c.dataset.src + (n ? '#' + n : '') }
        else { const base = c.tagName.toLowerCase() + (cls ? '.' + cls : ''); counts[base] = (counts[base] || 0) + 1; k = pkey + '>' + base + ':' + counts[base] }
        const r = c.getBoundingClientRect(), own = [...c.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim().replace(/\s+/g, ' ').slice(0, 80)
        const it = { k, p: pkey, t: tag, b: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)] }
        if (c.dataset.src) it.s = c.dataset.src
        if (own) it.x = own
        if (cs.visibility === 'hidden' || +cs.opacity === 0) it.hid = 1
        it.st = [cs.color, cs.backgroundColor, cs.fontSize, cs.fontWeight].join('|')
        if (r.width || r.height || own) items.push(it)
        walk(c, k)
      }
    }
    walk(document.body, 'body')
    return { w: document.documentElement.clientWidth, h: document.documentElement.scrollHeight, items }
  }
  // a frozen copy of the page: scripts and our overlays removed, form state written into attributes
  async function snapshot() {
    await settle()
    const doc = document.documentElement.cloneNode(true)
    const src = document.querySelectorAll('input, textarea, select'), dst = doc.querySelectorAll('input, textarea, select')
    src.forEach((e, i) => { const d = dst[i]; if (!d) return
      if (e.tagName === 'TEXTAREA') d.textContent = e.value
      else if (e.tagName === 'SELECT') [...d.options].forEach((o, j) => { if (e.options[j] && e.options[j].selected) o.setAttribute('selected', ''); else o.removeAttribute('selected') })
      else if (e.type === 'checkbox' || e.type === 'radio') { if (e.checked) d.setAttribute('checked', ''); else d.removeAttribute('checked') }
      else d.setAttribute('value', e.value) })
    const cv = document.querySelectorAll('canvas'), cd = doc.querySelectorAll('canvas')
    cv.forEach((c, i) => { try { const img = document.createElement('img'); img.src = c.toDataURL(); img.setAttribute('style', c.getAttribute('style') || ''); img.width = c.width; img.height = c.height; cd[i].replaceWith(img) } catch (e) { } })
    doc.querySelectorAll('script, .__sbbox, .__sbpin, .__sbpins, style[data-sitebench]').forEach(n => n.remove())
    doc.querySelectorAll('[contenteditable]').forEach(n => { n.removeAttribute('contenteditable'); n.classList.remove('__sbedit') })
    doc.removeAttribute('data-sbmode')
    const css = {}
    {   // linked stylesheets become inline ones, so a snapshot stands alone
      const live = [...document.styleSheets]
      doc.querySelectorAll('link[rel~=stylesheet]').forEach(l => {
        const sh = live.find(x => x.href && l.href && x.href === new URL(l.getAttribute('href'), location.href).href)
        let text = ''; try { text = sh ? [...sh.cssRules].map(r => r.cssText).join('\n') : '' } catch (e) { }
        const st = document.createElement('style'); st.dataset.file = fileOfURL(l.getAttribute('href')); st.textContent = text; l.replaceWith(st)
      })
    }
    doc.querySelectorAll('style[data-file]').forEach(st => { css[st.dataset.file] = st.textContent; st.textContent = '/*@css ' + st.dataset.file + '*/' })
    return { html: '<!doctype html>\n' + doc.outerHTML, css, layout: layout(), scroll: [scrollX, scrollY], title: document.title }
  }

  // ---- overlays drawn inside the page ----
  const COMMENT_CURSOR = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><path d="M3 23V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8z" fill="#d98e04" stroke="#fff" stroke-width="1.6"/><path d="M13 7.5v7M9.5 11h7" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>') + '") 3 23, crosshair'
  const css = document.createElement('style')
  css.textContent = '.__sbbox{position:absolute;pointer-events:none;z-index:2147483646;box-sizing:border-box}' +
    '.__sbbox.h{outline:1px dashed #e2001a}.__sbbox.s{outline:2px solid #e2001a;background:rgba(226,0,26,.06)}' +
    '.__sbbox i{position:absolute;left:-2px;top:-18px;font:10px/16px Arial,sans-serif;font-style:normal;background:#e2001a;color:#fff;padding:0 5px;white-space:nowrap}' +
    '.__sbpin{position:absolute;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50% 50% 50% 0;background:#e2001a;color:#fff;font:700 11px/22px Arial,sans-serif;text-align:center;pointer-events:auto;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.3)}' +
    '.__sbpin.done{background:#888}[contenteditable].__sbedit{outline:2px solid #1f6fc4!important;outline-offset:2px}' +
    '.__sbbox.c{outline:2px dashed #d98e04;background:rgba(217,142,4,.08)}.__sbbox.c i{background:#d98e04}' +
    '.__sbbox.t{outline:2px solid #1f6fc4;background:rgba(31,111,196,.08)}.__sbbox.t i{background:#1f6fc4}' +
    'html[data-sbmode=select],html[data-sbmode=select] *{cursor:default!important}' +
    'html[data-sbmode=comment],html[data-sbmode=comment] *{cursor:' + COMMENT_CURSOR + '!important}' +
    'html[data-sbmode] .__sbpin{cursor:pointer!important}html[data-sbmode=select] [contenteditable]{cursor:text!important}'
  css.setAttribute('data-sitebench', '')
  // values a panel previews: CSS variables and declarations laid over the page's own CSS, until kept or reset
  function applyPreview(pv) {
    let st = document.querySelector('style[data-sb-preview]')
    const clean = v => String(v).replace(/[{}<>;]/g, ''), vars = Object.entries((pv && pv.vars) || {}), rules = (pv && pv.rules) || []
    if (!vars.length && !rules.length) { if (st) st.remove(); return }
    if (!st) { st = document.createElement('style'); st.setAttribute('data-sb-preview', ''); document.documentElement.appendChild(st) }
    st.textContent = (vars.length ? ':root{' + vars.map(([k, v]) => clean(k) + ':' + clean(v) + ' !important').join(';') + '}' : '') + rules.map(r => clean(r.selector) + '{' + clean(r.prop) + ':' + clean(r.value) + ' !important}').join('')
  }
  applyPreview(CFG.preview)
  // phone and tablet sizes scroll like phones and tablets: the scrollbar overlays the page instead of narrowing it
  const dev = document.createElement('style'); dev.setAttribute('data-sb-device', '')
  dev.textContent = '@media (max-width: 1024px) { html { scrollbar-width: none } html::-webkit-scrollbar { display: none } }'
  ;(document.head || document.documentElement).appendChild(dev)
  ;(document.head || document.documentElement).appendChild(css)
  const setMode = m => { mode = m; document.documentElement.setAttribute('data-sbmode', m); hover.remove() }
  const hover = Object.assign(document.createElement('div'), { className: '__sbbox h' }), box = Object.assign(document.createElement('div'), { className: '__sbbox s' })
  const pinLayer = document.createElement('div'); pinLayer.className = '__sbpins'
  setMode(mode)
  function place(div, el, label) {
    if (!el || !el.isConnected) { div.remove(); return }
    const r = el.getBoundingClientRect()
    Object.assign(div.style, { left: r.left + scrollX + 'px', top: r.top + scrollY + 'px', width: r.width + 'px', height: r.height + 'px' })
    div.innerHTML = label ? '<i></i>' : ''; if (label) div.firstChild.textContent = label
    if (!div.isConnected) document.documentElement.appendChild(div)
  }
  const labelOf = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.classList[0] && !el.classList[0].startsWith('__sb') ? '.' + el.classList[0] : '') + '  ' + (srcOf(el) || '')
  function selectEl(el, report) {
    selected = el; place(box, el, el ? labelOf(el) : ''); if (report && el) post({ ev: 'pick', info: info(el) })
    // while recording, picking an element in Select mode records a check that it shows its current text
    if (report && el && recording) { const t = (el.innerText || '').trim().replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '').slice(0, 40).trim(); post({ ev: 'rec', step: t ? { expect: stableSel(el), text: t } : { expect: stableSel(el) } }) }   // the first sentence: ids and counts later in the text change between runs
  }
  function drawPins() {
    pinLayer.innerHTML = ''
    for (const p of pins) {
      let el = null; try { el = p.src ? document.querySelector('[data-src="' + p.src + '"]') : null } catch (e) { }
      if (!el && p.selector) try { el = document.querySelector(p.selector) } catch (e) { }
      const r = el ? el.getBoundingClientRect() : null
      const d = document.createElement('div'); d.className = '__sbpin' + (p.resolved ? ' done' : ''); d.textContent = p.n; d.title = p.text || ''
      d.style.left = (r ? r.left + scrollX + r.width * (p.rx ?? 0.5) : 12) + 'px'; d.style.top = (r ? r.top + scrollY + r.height * (p.ry ?? 0.5) : 12 + 26 * p.n) + 'px'
      d.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); post({ ev: 'pinclick', id: p.id }) })
      pinLayer.appendChild(d)
    }
    if (!pinLayer.isConnected && pins.length) document.documentElement.appendChild(pinLayer)
  }
  let raf = 0
  let traced = [], traceLabel = '', traceBoxes = []
  function drawTrace() {
    traceBoxes.forEach(b => b.remove())
    traceBoxes = traced.filter(e => e.isConnected).slice(0, 60).map((el, k) => { const b = document.createElement('div'); b.className = '__sbbox t'; place(b, el, k === 0 ? traceLabel : ''); return b })
  }
  const refresh = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (selected) place(box, selected, labelOf(selected)); if (pins.length) drawPins(); if (traced.length) drawTrace() }) }
  addEventListener('resize', refresh); addEventListener('scroll', refresh, true)
  const isOurs = n => n && n.nodeType === 1 && (n.classList.contains('__sbbox') || n.classList.contains('__sbpin') || n.classList.contains('__sbpins') || !!(n.closest && n.closest('.__sbpins')))
  new MutationObserver(recs => {
    if (recs.some(r => !isOurs(r.target) && (r.type !== 'childList' || ![...r.addedNodes, ...r.removedNodes].every(isOurs)))) lastMut = performance.now()
    refresh()
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })

  // ---- interaction by mode ----
  const ours = el => el && el.closest && el.closest('.__sbpin')
  addEventListener('mousemove', e => {
    if (mode === 'play' || ours(e.target)) { hover.remove(); return }
    const el = e.target.closest('[data-src]') || e.target
    if (!el || el.nodeType !== 1 || el === document.documentElement || el.isContentEditable) { hover.remove(); return }
    hover.className = '__sbbox ' + (mode === 'comment' ? 'c' : 'h')
    place(hover, el, mode === 'comment' ? '+ comment on ' + labelOf(el).split('  ')[0] : labelOf(el))
  }, true)
  document.addEventListener('mouseleave', () => hover.remove())
  addEventListener('click', e => {
    if (ours(e.target)) return
    const el = e.target.closest('[data-src]') || e.target
    if (mode === 'select') { e.preventDefault(); e.stopPropagation(); if (!el.isContentEditable) selectEl(el, true); return }
    if (mode === 'comment') {
      e.preventDefault(); e.stopPropagation()
      const r = el.getBoundingClientRect()
      post({ ev: 'pin', info: info(el), rx: r.width ? (e.clientX - r.left) / r.width : 0.5, ry: r.height ? (e.clientY - r.top) / r.height : 0.5, x: e.clientX, y: e.clientY })
      return
    }
    // recording a scenario: clicks on things people click (typing is recorded on change)
    if (recording && !e.__sbReplay) {
      const t = e.target.closest('a, button, input, select, textarea, label, summary, [role=button], [data-id], [onclick]') || e.target
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !/^(checkbox|radio|submit|button|reset)$/.test(t.type)
      if (!typing && t !== document.body && t !== document.documentElement) post({ ev: 'rec', step: { click: stableSel(t) }, text: (t.innerText || t.value || '').trim().slice(0, 60) })
    }
    // what the person does in play mode is an event stream (panels and Claude can follow it)
    if (!e.__sbReplay) { const t = e.target.closest('a, button, input, select, textarea, label, summary, [role=button], [data-id]') || e.target; if (t && t !== document.body && t !== document.documentElement) post({ ev: 'act', kind: 'click', sel: selPath(t), text: (t.innerText || t.value || '').trim().replace(/\s+/g, ' ').slice(0, 60) }) }
    // play: same-project links navigate the frame; submit buttons submit without leaving the page
    // links navigate as they do in the app
    const btn = e.target.closest('button, input[type=submit]')
    if (btn && btn.form && (btn.type === 'submit')) {
      e.preventDefault()
      if (!btn.form.reportValidity()) return
      btn.form.dispatchEvent(new (window.SubmitEvent || Event)('submit', { bubbles: true, cancelable: true, submitter: btn }))
    }
  }, true)
  addEventListener('keydown', e => {
    if (mode !== 'play' || e.key !== 'Enter' || !e.target.form || e.target.tagName === 'TEXTAREA') return
    const f = e.target.form
    if (!f.querySelector('button:not([type]), button[type=submit], input[type=submit]')) { e.preventDefault(); if (f.reportValidity()) f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }
  }, true)
  addEventListener('dragover', e => e.preventDefault()); addEventListener('drop', e => { e.preventDefault(); post({ ev: 'log', level: 'info', text: 'drop files on the workbench, not on a frame, to import' }) })
  addEventListener('change', e => {
    const t = e.target
    if (mode === 'play' && t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) post({ ev: 'act', kind: 'change', sel: selPath(t), text: t.type === 'password' ? '•••' : t.type === 'checkbox' || t.type === 'radio' ? String(t.checked) : String(t.value).slice(0, 60) })
    if (!recording || mode !== 'play' || !t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || /^(checkbox|radio|submit|button|reset)$/.test(t.type)) return
    post({ ev: 'rec', step: { type: stableSel(t), text: t.value } })
  }, true)
  addEventListener('submit', e => { setTimeout(() => { if (!e.defaultPrevented) console.warn('form submitted without preventDefault(); the preview stays on this page') }, 0) })
  // double-click a text leaf in select mode to edit its words in place
  addEventListener('dblclick', e => {
    if (mode !== 'select') return
    const el = e.target.closest('[data-src]')
    if (!el || ![...el.childNodes].every(n => n.nodeType === 3) || !el.textContent.trim()) return
    e.preventDefault(); const old = el.textContent
    el.contentEditable = 'plaintext-only'; if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'
    el.classList.add('__sbedit'); el.focus()
    const done = keep => { el.removeAttribute('contenteditable'); el.classList.remove('__sbedit'); el.removeEventListener('blur', onBlur); el.removeEventListener('keydown', onKey); if (!keep) el.textContent = old; else if (el.textContent !== old) post({ ev: 'textedit', src: el.dataset.src, old, text: el.textContent }) }
    const onBlur = () => done(true), onKey = k => { if (k.key === 'Enter') { k.preventDefault(); el.blur() } if (k.key === 'Escape') done(false) }
    el.addEventListener('blur', onBlur); el.addEventListener('keydown', onKey)
  }, true)

  // ---- checks ----
  function lum(c) { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const [r, g, b, a = 1] = m[1].split(',').map(Number); if (a === 0) return null; return [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0) }
  function bgOf(el) { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor, m = /rgba?\(([^)]+)\)/.exec(c); if (m && (m[1].split(',')[3] === undefined || +m[1].split(',')[3] > 0.5)) return c } return 'rgb(255, 255, 255)' }
  function check() {
    const issues = [], W = document.documentElement.clientWidth
    if (document.documentElement.scrollWidth > W + 1) {
      const over = [...document.body.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > W + 1 && !e.closest('.__sbbox,.__sbpin') })
      const top = over.filter(e => !over.includes(e.parentElement)), groups = new Map()
      for (const e of top) { const k = e.parentElement || e, d = e.getBoundingClientRect().right - W, g = groups.get(k); if (!g) groups.set(k, { e, d, n: 1 }); else { g.n++; if (d > g.d) { g.d = d; g.e = e } } }
      for (const [parent, g] of [...groups].slice(0, 4)) {
        const el = g.n > 1 ? parent : g.e, name = labelOf(el).split('  ')[0]
        issues.push({ kind: 'overflow', src: srcOf(el), selector: selPath(el), message: (g.n > 1 ? 'the ' + g.n + ' children of ' + name + ' run ' : name + ' runs ') + Math.round(g.d) + 'px past the ' + W + 'px viewport' })
      }
      if (!top.length) issues.push({ kind: 'overflow', src: '', selector: 'html', message: 'page scrolls sideways (' + document.documentElement.scrollWidth + 'px wide in a ' + W + 'px viewport)' })
    }
    let n = 0
    for (const e of document.body.querySelectorAll('*')) {
      if (n > 6) break
      if (e.closest('.__sbbox,.__sbpin') || !e.offsetParent && getComputedStyle(e).position !== 'fixed') continue
      const text = [...e.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())
      if (!text) continue
      const cs = getComputedStyle(e), fg = lum(cs.color), bg = lum(bgOf(e)); if (fg == null || bg == null) continue
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05), big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.6 && +cs.fontWeight >= 700)
      if (ratio < (big ? 3 : 4.5)) { n++; issues.push({ kind: 'contrast', src: srcOf(e), selector: selPath(e), message: 'text contrast ' + ratio.toFixed(2) + ':1 on "' + e.textContent.trim().slice(0, 30) + '"' }) }
    }
    for (const img of document.querySelectorAll('img:not([alt])')) issues.push({ kind: 'a11y', src: srcOf(img), selector: selPath(img), message: 'image without alt text' })
    for (const b of document.querySelectorAll('button, a[href]')) if (!b.textContent.trim() && !b.getAttribute('aria-label') && !b.querySelector('img[alt]')) issues.push({ kind: 'a11y', src: srcOf(b), selector: selPath(b), message: b.tagName.toLowerCase() + ' with no label' })
    return issues.slice(0, 20)
  }

  // ---- ops the host can call ----
  const PROPS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'gap', 'flex-direction', 'grid-template-columns', 'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'border', 'border-radius', 'min-width', 'max-width', 'overflow', 'white-space']
  function rulesFor(el) {
    const out = []
    const walk = (rules, file, media) => {
      for (const r of rules) {
        if (r.cssRules && r.media) { if (matchMedia(r.media.mediaText).matches) walk(r.cssRules, file, r.media.mediaText); continue }
        if (!r.selectorText) continue
        let hit = false; try { hit = el.matches(r.selectorText) } catch (e) { }
        if (!hit) continue
        const decls = []; for (let i = 0; i < r.style.length; i++) { const p = r.style[i]; decls.push([p, r.style.getPropertyValue(p), r.style.getPropertyPriority(p)]) }
        out.push({ file, selector: r.selectorText, media: media || '', decls, text: r.style.cssText })
      }
    }
    for (const s of document.styleSheets) { const f = sheetFile(s); if (!f) continue; try { walk(s.cssRules, f) } catch (e) { } }
    if (el.getAttribute('style')) out.push({ file: srcOf(el).split(':')[0], selector: 'style=""', media: '', inline: true, decls: [...el.style].map(p => [p, el.style.getPropertyValue(p), '']), text: el.getAttribute('style') })
    return out
  }
  const OPS = {
    ping: () => ({ title: document.title, route: CFG.route }),
    // outline every element a source line (HTML) or a rule (CSS) renders
    trace: t => {
      traced = []; traceLabel = ''
      if (t && t.selector) {
        const sel = t.selector.replace(/::?(hover|focus|focus-visible|focus-within|active|visited|before|after|placeholder|marker|selection)\b(\([^)]*\))?/g, '') || '*'
        try { traced = [...document.querySelectorAll(sel)].filter(e => !e.closest('.__sbbox,.__sbpin')) } catch (e) { }
        traceLabel = t.selector
      } else if (t && t.file) {
        const pre = t.file + ':', els = [...document.querySelectorAll('[data-src]')].filter(e => e.dataset.src.startsWith(pre))
        let best = 0; for (const e of els) { const ln = +e.dataset.src.slice(pre.length); if (ln <= t.line && ln > best) best = ln }
        traced = best ? els.filter(e => +e.dataset.src.slice(pre.length) === best) : []
        traceLabel = pre + best
      }
      if (traced.length > 1) traceLabel += '  ×' + traced.length
      drawTrace()
      if (traced[0]) { const r = traced[0].getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) traced[0].scrollIntoView({ block: 'center' }) }
      return { count: traced.length }
    },
    outline: (max = 400) => {
      const out = [], walk = (el, d) => {
        if (out.length >= max || el.classList.contains('__sbbox') || el === pinLayer) return
        out.push({ d, tag: el.tagName.toLowerCase(), id: el.id || '', cls: [...el.classList].filter(c => !c.startsWith('__sb')).slice(0, 3).join('.'), src: el.dataset.src || '', text: [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim().replace(/\s+/g, ' ').slice(0, 40) })
        for (const c of el.children) if (!['SCRIPT', 'STYLE'].includes(c.tagName)) walk(c, d + 1)
      }
      walk(document.body, 0); return out.filter(n => !/__sb/.test(n.cls))
    },
    inspect: t => { const el = find(t), cs = getComputedStyle(el); return { ...info(el), computed: Object.fromEntries(PROPS.map(p => [p, cs.getPropertyValue(p)])), rules: rulesFor(el) } },
    select: t => { const el = t ? find(t) : null; selectEl(el, false); if (el) el.scrollIntoView({ block: 'nearest' }); return el ? info(el) : null },
    query: async (q, max = 30) => { await settle(600); return qsa(q).slice(0, max).map(info) },
    check: async () => { await settle(); return check() },
    layout: async (max = 1500) => { await settle(max); return layout() },
    snapshot,
    settle: max => settle(max),
    waitFor: async (q, timeout = 2000) => {
      const t0 = performance.now()
      while (true) {
        // visible as a scenario's expect means it: a box with an area (body
        // has no offsetParent, so that test never passed for it)
        const el = qsa(q).find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
        if (el) return info(el)
        if (performance.now() - t0 > timeout) throw new Error('nothing visible matches ' + q + ' after ' + timeout + ' ms')
        await new Promise(r => setTimeout(r, 40))
      }
    },
    count: q => qsa(q).length,
    all: (q, max = 50) => qsa(q).slice(0, max).map(info),
    record: on => { recording = !!on; return recording },
    stableSel: t => stableSel(find(t)),
    click: t => { const el = find(t); const m = mode; mode = 'play'; try { el.click() } finally { mode = m } return info(el) },
    type: (t, text) => { const el = find(t); el.focus(); el.value = String(text); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return info(el) },
    text: t => { const el = t ? find(t) : document.body; return (el.innerText || '').slice(0, 6000) },
    state: () => ({ scroll: [scrollX, scrollY], fields: [...document.querySelectorAll('input, textarea, select')].map((e, i) => ({ k: (e.dataset.src || '') + '|' + (e.name || i), v: e.value, c: e.checked })) }),
    restore: st => {
      if (!st) return
      for (const f of st.fields || []) { const e = [...document.querySelectorAll('input, textarea, select')].find((x, i) => (x.dataset.src || '') + '|' + (x.name || i) === f.k); if (e && e.type !== 'file') { e.value = f.v; e.checked = f.c } }
      const go = () => scrollTo(st.scroll[0], st.scroll[1]); go(); setTimeout(go, 80); setTimeout(go, 350)
    }
  }
  addEventListener('message', e => {
    if (e.source !== parent || (CFG.origin && e.origin !== CFG.origin)) return
    const m = e.data; if (!m || m.__sb !== 'host') return
    if (m.push === 'mode') { setMode(m.mode); return }
    if (m.push === 'preview') { applyPreview(m.preview); return }
    if (m.push === 'pins') { pins = m.pins || []; drawPins(); return }
    if (m.op) Promise.resolve().then(() => { if (!OPS[m.op]) throw new Error('unknown op ' + m.op); return OPS[m.op](...(m.args || [])) })
      .then(v => post({ ev: 'res', id: m.id, ok: true, value: v }), err => post({ ev: 'res', id: m.id, ok: false, error: String(err && err.message || err) }))
  })
  const ready = () => { post({ ev: 'ready', title: document.title }); drawPins() }
  document.readyState === 'complete' ? setTimeout(ready, 0) : addEventListener('load', () => setTimeout(ready, 0))
}

  PROBE({ embedded: true, origin: boot.parentOrigin, nonce: q.get('sbn') || '', route: location.pathname.split('/').slice(5).join('/') || 'index.html', mode: 'select', pins: [] });
})();
