// ---------- site runtime: build a page from project files, instrument it, inject the probe ----------

// add data-src="file:line" to every element in <body> (or everywhere, for fragments)
function instrument(html, file) {
  let out = '', i = 0, inBody = !/<body[\s>]/i.test(html)
  const n = html.length
  const lineAt = (() => { let ln = 1, pos = 0; return idx => { for (; pos < idx; pos++) if (html.charCodeAt(pos) === 10) ln++; return ln } })()
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) { out += html.slice(i); break }
    out += html.slice(i, lt); i = lt
    if (html.startsWith('<!--', i)) { const e = html.indexOf('-->', i + 4); const end = e < 0 ? n : e + 3; out += html.slice(i, end); i = end; continue }
    const m = /^<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/.exec(html.slice(i, i + 4000))
    if (!m) { out += '<'; i++; continue }
    const tag = m[1].toLowerCase(), whole = m[0]
    if (tag === 'body') inBody = true
    const skip = ['html', 'head', 'meta', 'link', 'title', 'script', 'style', 'base', 'br', 'wbr'].includes(tag)
    if (inBody && !skip && !/\sdata-src=/.test(whole)) out += whole.slice(0, whole.length - (m[3] ? 2 : 1)).replace(/\s+$/, '') + ' data-src="' + file + ':' + lineAt(i) + '"' + (m[3] ? ' />' : '>')
    else out += whole
    i += whole.length
    if ((tag === 'script' || tag === 'style') && !m[3]) {
      const close = html.toLowerCase().indexOf('</' + tag, i), end = close < 0 ? n : close
      out += html.slice(i, end); i = end
    }
  }
  return out
}

const PAGE_SANDBOX = 'allow-scripts allow-forms'
function buildDoc(project, route, ws, cfg, src) {
  // src: { read(path), list() } to build from another state of the files (the playhead); default: the workspace
  const rd = src ? src.read : p => project.read(p, ws), ls = src ? src.list : () => project.list(ws)
  let html = rd(route)
  if (html === null) {
    const pages = ls().filter(p => /\.html?$/.test(p))
    html = '<!doctype html><html><body style="font:14px Arial;padding:24px;color:#444"><h3 style="margin:0 0 8px">No page at ' + escHtml(route) + '</h3><p>Pages in this workspace:</p><ul>' +
      pages.map(p => '<li><a href="' + escHtml(p) + '">' + escHtml(p) + '</a></li>').join('') + '</ul></body></html>'
  } else html = instrument(html, route)
  const base = route.includes('/') ? route.slice(0, route.lastIndexOf('/') + 1) : ''
  const resolve = href => { if (!href || /^([a-z]+:|\/\/|#|\/)/i.test(href)) return null; const parts = (base + href.split(/[?#]/)[0]).split('/'), st = []; for (const p of parts) p === '..' ? st.pop() : p !== '.' && st.push(p); return st.join('/') }
  // stylesheets and scripts are inlined so the page is one document
  html = html.replace(/<link\b[^>]*>/gi, tag => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag
    const href = (/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag) || []).slice(1).find(Boolean), path = resolve(href)
    const css = path && rd(path)
    if (css === null || css === undefined) return path ? '<!-- missing stylesheet ' + escHtml(path) + ' -->' : tag
    return '<style data-file="' + escHtml(path) + '">' + css.replace(/<\/style/gi, '<\\/style') + '</style>'
  })
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>\s*<\/script>/gi, (tag, pre, a, b, c, post) => {
    const path = resolve(a || b || c), js = path && rd(path)
    if (js === null || js === undefined) return path ? '<script>console.error("missing script ' + path.replace(/"/g, '') + '")</script>' : tag
    return '<script' + pre.replace(/\s+$/, '') + post + ' data-file="' + escHtml(path) + '">' + js.replace(/<\/script/gi, '<\\/script') + '\n//# sourceURL=' + path + '\n</script>'
  })
  // project svg files referenced by src= become data urls
  html = html.replace(/\bsrc\s*=\s*"([^"]+\.svg)"/gi, (all, href) => { const p = resolve(href), svg = p && rd(p); return svg ? 'src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '"' : all })
  const probe = '<script data-sb-probe>(' + PROBE.toString() + ')(' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ')</script>'
  const at = /<head[^>]*>/i.exec(html) || /<html[^>]*>/i.exec(html) || /<!doctype[^>]*>/i.exec(html)
  return at ? html.slice(0, at.index + at[0].length) + probe + html.slice(at.index + at[0].length) : probe + html
}

// The probe runs inside each sandboxed frame. It defines window.site, reports picks, logs and checks,
// and answers the host's ops. It is stringified into the page, so it must stand alone.
function PROBE(CFG) {
  const post = m => parent.postMessage(Object.assign({ __sb: 'probe', nonce: CFG.nonce }, m), '*')
  const fmt = v => { try { return typeof v === 'string' ? v : v instanceof Error ? v.name + ': ' + v.message : JSON.stringify(v) } catch (e) { return String(v) } }
  if (CFG.clock) {           // a fixture's clock: time starts at its moment and runs on from there
    const T = new Date(CFG.clock).getTime(), RD = Date, t0 = performance.now()
    if (!isNaN(T)) { const FD = class extends RD { constructor(...a) { if (a.length) super(...a); else super(T + performance.now() - t0) } static now() { return T + performance.now() - t0 } }; window.Date = FD }
  }
  for (const l of ['log', 'info', 'warn', 'error']) { const o = console[l].bind(console); console[l] = (...a) => { o(...a); post({ ev: 'log', level: l, text: a.map(fmt).join(' ').slice(0, 2000) }) } }
  addEventListener('error', e => post({ ev: 'log', level: 'error', text: e.message, src: e.filename && !/^about:/.test(e.filename) ? e.filename.split('/').pop() + (e.lineno ? ':' + e.lineno : '') : '' }))
  addEventListener('unhandledrejection', e => post({ ev: 'log', level: 'error', text: 'Unhandled rejection: ' + fmt(e.reason && e.reason.message || e.reason) }))

  let seq = 0, mode = CFG.mode || 'select', pins = CFG.pins || [], selected = null, recording = !!CFG.record
  const pend = new Map(), storeData = CFG.store || {}, storeSubs = {}, dbSubs = {}
  const rpc = (op, args) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); post({ ev: 'rpc', id, op, args }) })
  const cp = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v))
  window.site = Object.freeze({
    route: CFG.route,
    db: Object.freeze({
      rows: (t, w) => rpc('db.rows', [t, w]), insert: (t, r) => rpc('db.insert', [t, r]), update: (t, id, p) => rpc('db.update', [t, id, p]),
      remove: (t, id) => rpc('db.remove', [t, id]), tables: () => rpc('db.tables', []), on: (t, fn) => { (dbSubs[t] = dbSubs[t] || []).push(fn) }
    }),
    store: Object.freeze({
      get: (k, d) => k in storeData ? cp(storeData[k]) : d,
      set: (k, v) => { storeData[k] = cp(v); post({ ev: 'store', key: k, value: storeData[k] }); for (const f of storeSubs[k] || []) try { f(cp(v)) } catch (e) { console.error(e) } },
      on: (k, fn) => { (storeSubs[k] = storeSubs[k] || []).push(fn) }
    }),
    nav: r => post({ ev: 'nav', route: String(r) })
  })

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
  // settle: no db calls in flight and no DOM changes for a moment (pages render after site.db.rows answers)
  let lastMut = performance.now()
  async function settle(max = 1500) {
    const t0 = performance.now()
    while (performance.now() - t0 < max) { if (pend.size === 0 && performance.now() - lastMut > 80) return true; await new Promise(r => setTimeout(r, 25)) }
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
    const a = e.target.closest('a[href]')
    if (a) { const href = a.getAttribute('href'); if (href && !/^([a-z]+:|\/\/|#)/i.test(href)) { e.preventDefault(); site.nav(href.split('#')[0]) } else if (/^[a-z]+:|^\/\//i.test(href || '')) { e.preventDefault(); console.warn('external link blocked in preview: ' + href) } return }
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
    for (const s of document.styleSheets) { const f = s.ownerNode && s.ownerNode.dataset && s.ownerNode.dataset.file; if (!f) continue; try { walk(s.cssRules, f) } catch (e) { } }
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
        const el = qsa(q).find(x => x.offsetParent || getComputedStyle(x).position === 'fixed')
        if (el && (el.offsetParent || getComputedStyle(el).position === 'fixed')) return info(el)
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
    if (e.source !== parent) return
    const m = e.data; if (!m || m.__sb !== 'host') return
    if (m.reply) { const p = pend.get(m.reply); if (p) { pend.delete(m.reply); m.ok ? p.res(m.value) : p.rej(new Error(m.error)) } return }
    if (m.push === 'store') { storeData[m.key] = m.value; for (const f of storeSubs[m.key] || []) try { f(cp(m.value)) } catch (err) { console.error(err) } return }
    if (m.push === 'db') { for (const f of dbSubs[m.table] || []) try { f() } catch (err) { console.error(err) } return }
    if (m.push === 'mode') { setMode(m.mode); return }
    if (m.push === 'preview') { applyPreview(m.preview); return }
    if (m.push === 'pins') { pins = m.pins || []; drawPins(); return }
    if (m.op) Promise.resolve().then(() => { if (!OPS[m.op]) throw new Error('unknown op ' + m.op); return OPS[m.op](...(m.args || [])) })
      .then(v => post({ ev: 'res', id: m.id, ok: true, value: v }), err => post({ ev: 'res', id: m.id, ok: false, error: String(err && err.message || err) }))
  })
  const ready = () => { post({ ev: 'ready', title: document.title }); drawPins() }
  document.readyState === 'complete' ? setTimeout(ready, 0) : addEventListener('load', () => setTimeout(ready, 0))
}

// ---------- FrameHost: one iframe (visible on the canvas or headless) and its probe ----------
const FrameHosts = new Set()
const hostByNonce = new Map()     // nonce of a load -> its FrameHost (iframes reload when the dock moves them)
addEventListener('message', e => {
  const m = e.data; if (!m || m.__sb !== 'probe') return
  const fh = hostByNonce.get(m.nonce); if (fh) fh.onMessage(m)
})
class FrameHost {
  constructor(o) {
    Object.assign(this, { project: o.project, route: o.route, w: o.w, h: o.h, ws: o.ws || 'main', fid: o.fid || uid('h'), headless: !!o.headless, fixture: o.fixture || null, isolate: !!o.isolate })
    this.fx = null; this.layoutMap = null; this.at = o.at ?? null
    this.el = h('div', { style: { position: 'relative', width: o.w + 'px', height: o.h + 'px', overflow: 'hidden' } })   // no background: at fractional zoom a sub-pixel edge would show it
    this.iframe = null; this.nonce = ''; this.readyP = null; this.readyRes = null; this.pend = new Map(); this.seq = 0
    this.logs = []; this.issues = []; this.errors = 0; this.ev = emitter(); this.loading = false; this.saved = null
    FrameHosts.add(this)
  }
  size(w, h) { this.w = w; this.h = h; Object.assign(this.el.style, { width: w + 'px', height: h + 'px' }); if (this.iframe) Object.assign(this.iframe.style, { width: w + 'px', height: h + 'px' }) }
  async load({ keepState = true } = {}) {
    if (keepState && this.iframe && this.ready) { try { this.saved = await this.call('state', [], 400) } catch { } }
    const nonce = uid('n'), ifr = h('iframe', { sandbox: PAGE_SANDBOX, title: this.route, style: { width: this.w + 'px', height: this.h + 'px', position: 'absolute', left: 0, top: 0, border: 0, opacity: this.iframe ? 0 : 1 } })
    let res; const p = new Promise(r => { res = r })
    this.next = { ifr, nonce, res }; this.loading = true; this.ready = false
    this.readyP = p
    this.el.appendChild(ifr); hostByNonce.set(nonce, this)
    this.logs = this.logs.filter(l => l.keep); this.errors = 0
    // a fixture (or an isolated run) gives the page its own copy of the data, store and clock; it lasts across
    // reloads and page changes until the fixture file changes or resetData() is called
    if (this.fixture || this.isolate || this.at != null) {
      const P = this.project, ftext = this.fixture ? P.read(fixturePath(this.fixture), this.ws) : null, key = (this.fixture || '') + '|' + this.ws + '|' + hashStr(ftext || '') + '|' + (this.at != null ? 'past' : '')
      if (!this.fx || this.fx.key !== key) {
        const tables = {}
        for (const [n, t] of P.tablesIn(this.ws)) tables[n] = clone(t)
        let spec = {}
        if (this.fixture && ftext === null) this.logs.push({ t: now(), level: 'error', text: 'no fixture ' + fixturePath(this.fixture) + ' (using a copy of the live data)', frame: this.route, fid: this.fid, keep: true })
        if (ftext) { try { spec = JSON.parse(ftext) || {} } catch (e) { this.logs.push({ t: now(), level: 'error', text: fixturePath(this.fixture) + ' is not valid JSON: ' + e.message, frame: this.route, fid: this.fid, keep: true }) } }
        for (const [n, v] of Object.entries(spec.tables || {})) { if (v === 'live') continue; const rows = Array.isArray(v) ? v : (v && v.rows) || []; const cols = (v && v.cols) || (tables[n] && tables[n].cols) || ['id', ...new Set(rows.flatMap(r => Object.keys(r)).filter(k => k !== 'id'))]; tables[n] = { name: n, cols, rows: clone(rows), seq: Math.max(0, ...rows.map(r => +r.id || 0)) } }
        this.fx = { key, tables, store: clone(spec.store || ((this.isolate || this.at != null) && !this.fixture ? this.project.meta.store : {}) || {}), clock: spec.clock || null }
      }
    } else this.fx = null
    const cfg = { nonce, route: this.route, mode: this.headless || this.at != null ? 'play' : App.mode, store: this.fx ? this.fx.store : (this.project.meta.store || {}), clock: this.fx ? this.fx.clock : null, record: !!this.rec, preview: this.headless ? null : Preview.payload(), pins: this.headless ? [] : App.pinsFor(this.route) }
    // the playhead: the files as they were just after event this.at, on a copy of today's data
    let src = null
    if (this.at != null) { const st = this.project.stateAtCached(this.at); src = { read: p => st.has(p) ? st.get(p) : null, list: () => [...st.keys()].sort() } }
    try { ifr.srcdoc = buildDoc(this.project, this.route, this.ws, cfg, src) } catch (err) { ifr.srcdoc = '<pre>' + escHtml(err.stack || err) + '</pre>' }
    const timer = setTimeout(() => { if (this.next && this.next.nonce === nonce) this.swap() }, 4000)
    await p; clearTimeout(timer)
    return this
  }
  // on screen with a layout: a canvas frame in a hidden tab measures as 0×0, so reads go to a headless frame instead
  get shown() { return this.headless || (this.el.isConnected && this.el.getClientRects().length > 0) }
  resetData() { this.fx = null; return this.load({ keepState: false }) }
  setFixture(name) { this.fixture = name || null; this.fx = null; return this.load({ keepState: false }) }
  swap() {
    const n = this.next; if (!n) return
    if (this.iframe && this.iframe !== n.ifr) { hostByNonce.delete(this.nonce); this.iframe.remove() }
    n.ifr.style.opacity = 1; this.iframe = n.ifr; this.nonce = n.nonce; this.next = null; this.loading = false; this.ready = true
    for (const [, p] of this.pend) p.rej(Object.assign(new Error('page reloaded'), { kind: 'frame' })); this.pend.clear()
    n.res(this)
    if (this.saved) { this.post({ op: 'restore', args: [this.saved], id: 0 }); this.saved = null }
    if (!this.headless) { this.runCheck(); App.ev.emit('frameready', this); Streams.frame(this, 'load', this.route + (this.at != null ? ' (as of event ' + this.at + ')' : '')); if (App.traceTarget) this.call('trace', [App.traceTarget]).catch(() => { }) }
    this.ev.emit('ready')
  }
  async runCheck() {
    try { this.issues = await this.call('check', [], 4000); this.ev.emit('issues', this.issues); App.ev.emit('health') } catch { }
    try { this.layoutMap = await this.call('layout', [], 4000) } catch { }
  }
  post(m, nonce) {
    const ifr = this.next && nonce === this.next.nonce ? this.next.ifr : this.iframe
    if (ifr && ifr.contentWindow) ifr.contentWindow.postMessage(Object.assign({ __sb: 'host' }, m), '*')
  }
  push(m) { this.post(m); if (this.next) this.next.ifr.contentWindow.postMessage(Object.assign({ __sb: 'host' }, m), '*') }
  async call(op, args = [], timeout = 5000) {
    if (!this.ready) { const t = sleep(Math.max(timeout, 4500)).then(() => { throw Object.assign(new Error('frame did not load'), { kind: 'frame' }) }); await Promise.race([this.readyP, t]) }
    const id = ++this.seq
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pend.delete(id); rej(Object.assign(new Error(op + ' timed out in frame ' + this.route), { kind: 'timeout' })) }, timeout)
      this.pend.set(id, { res: v => { clearTimeout(t); res(v) }, rej: e => { clearTimeout(t); rej(e) } })
      this.post({ op, args, id })
    })
  }
  onMessage(m) {
    if (this.next && m.nonce === this.next.nonce) { if (m.ev === 'ready') { this.swap(); return } }
    else if (m.nonce !== this.nonce) return
    else if (m.ev === 'ready') {          // the same load came back (the dock re-parented the iframe)
      this.post({ push: 'mode', mode: this.headless ? 'play' : App.mode }); if (!this.headless) { this.post({ push: 'pins', pins: App.pinsFor(this.route) }); this.runCheck() }
      return
    }
    const P = this.project
    switch (m.ev) {
      case 'res': { const p = this.pend.get(m.id); if (p) { this.pend.delete(m.id); m.ok ? p.res(m.value) : p.rej(Object.assign(new Error(m.error), { kind: 'frame' })) } break }
      case 'log': { const l = { t: now(), level: m.level, text: m.text, src: m.src || '', frame: this.route, fid: this.fid }; this.logs.push(l); if (this.logs.length > 300) this.logs.shift(); if (m.level === 'error') this.errors++; if (!this.headless) { App.consoleAdd(l); Streams.frame(this, m.level === 'error' ? 'error' : 'console', m.text + (m.src ? ' @' + m.src : '')) } this.ev.emit('log', l); break }
      case 'act': if (!this.headless) Streams.frame(this, m.kind, m.sel + (m.text ? ' “' + m.text + '”' : ''), { sel: m.sel, text: m.text }); break
      case 'rpc': this.rpc(m, m.nonce); break
      case 'store': { if (this.fx) { this.fx.store[m.key] = m.value; break } P.meta.store[m.key] = m.value; P.saveMeta(); for (const fh of FrameHosts) if (fh !== this && fh.project === P && !fh.fx) fh.push({ push: 'store', key: m.key, value: m.value }); App.ev.emit('store', m.key); break }
      case 'nav': { if (!this.headless) Streams.frame(this, 'nav', this.route + ' → ' + m.route); this.navigate(m.route); break }
      case 'pick': App.select({ ...m.info, fid: this.fid, route: this.route, ws: this.ws }); break
      case 'rec': if (this.rec) this.recStep(m.step); break
      case 'pin': App.placePin(this, m); break
      case 'pinclick': App.openPin(m.id, this); break
      case 'textedit': App.textEdit(this, m); break
    }
  }
  rpc(m, nonce) {
    const P = this.project, [a, b, c] = m.args || [], ws = this.ws
    let out
    try {
      if (this.fx) out = fxOp(this.fx, m.op, a, b, c, () => this.push({ push: 'db', table: a }))
      else out = m.op === 'db.rows' ? P.rows(a, b, ws) : m.op === 'db.insert' ? P.insert(a, b, 'site', ws) : m.op === 'db.update' ? P.update(a, b, c, 'site', ws)
        : m.op === 'db.remove' ? P.removeRow(a, b, 'site', ws) : m.op === 'db.tables' ? [...P.tablesIn(ws).keys()] : (() => { throw new Error('unknown ' + m.op) })()
      this.post({ reply: m.id, ok: true, value: out }, nonce)
    } catch (err) { this.post({ reply: m.id, ok: false, error: err.message }, nonce) }
  }
  navigate(route) {
    const base = this.route.includes('/') ? this.route.slice(0, this.route.lastIndexOf('/') + 1) : ''
    const st = []; for (const p of (base + route).split('/')) p === '..' ? st.pop() : p !== '.' && p && st.push(p)
    this.route = st.join('/') || 'index.html'
    this.saved = null; this.ev.emit('nav', this.route); this.load({ keepState: false })
  }
  dispose() { FrameHosts.delete(this); hostByNonce.delete(this.nonce); if (this.next) hostByNonce.delete(this.next.nonce); this.el.remove() }
}

// data ops against a frame's own copy (fixture or isolated run); changes notify only that frame
function fxOp(fx, op, name, b, c, changed) {
  const t = fx.tables[name]
  if (op === 'db.tables') return Object.keys(fx.tables)
  if (!t) throw new Error('no table "' + name + '"')
  if (op === 'db.rows') return clone(b && typeof b === 'object' ? t.rows.filter(r => Object.entries(b).every(([k, v]) => r[k] === v)) : t.rows)
  if (op === 'db.insert') { t.seq = Math.max(t.seq || 0, ...t.rows.map(r => +r.id || 0)) + 1; const r = { ...clone(b), id: t.seq }; t.rows.push(r); setTimeout(changed, 0); return clone(r) }
  const r = t.rows.find(x => String(x.id) === String(b))
  if (op === 'db.update') { if (!r) throw new Error('no row ' + b); Object.assign(r, clone(c), { id: r.id }); setTimeout(changed, 0); return clone(r) }
  if (op === 'db.remove') { const n = t.rows.length; t.rows = t.rows.filter(x => x !== r); setTimeout(changed, 0); return t.rows.length < n }
  throw new Error('unknown ' + op)
}
const fixturePath = name => 'fixtures/' + String(name).replace(/\.json$/, '') + '.json'

// headless frames: for the agent's frame calls in a workspace the canvas is not showing
const Headless = {
  pool: new Map(),
  root() { let r = $('#headless'); if (!r) { r = h('div#headless', { 'aria-hidden': 'true', style: { position: 'fixed', left: '-30000px', top: 0, width: '1px', height: '1px', overflow: 'hidden', pointerEvents: 'none' } }); document.body.appendChild(r) } return r },
  async get(project, route, ws, w = 375, h = 720, fixture = null) {
    const k = project.id + '|' + ws + '|' + route + '|' + w + 'x' + h + '|' + (fixture || '')
    let fh = this.pool.get(k)
    if (!fh) { fh = new FrameHost({ project, route, w, h, ws, headless: true, fixture }); this.root().appendChild(fh.el); this.pool.set(k, fh); await fh.load() }
    else if (fh.stale) { fh.stale = false; await fh.load({ keepState: false }) }
    else if (!fh.ready) await fh.readyP
    return fh
  },
  peek(project, route, ws, w = 375, h = 720, fixture = null) { return this.pool.get(project.id + '|' + ws + '|' + route + '|' + w + 'x' + h + '|' + (fixture || '')) || null },
  // a frame of its own, outside the pool (scenario runs); dispose it when done
  async fresh(project, route, ws, w = 375, h = 720, opts = {}) {
    const fh = new FrameHost({ project, route, w, h, ws, headless: true, fixture: opts.fixture || null, isolate: true }); this.root().appendChild(fh.el); await fh.load(); return fh
  },
  invalidate(project) { for (const fh of this.pool.values()) if (fh.project === project) fh.stale = true },
  clear() { for (const fh of this.pool.values()) fh.dispose(); this.pool.clear() }
}
