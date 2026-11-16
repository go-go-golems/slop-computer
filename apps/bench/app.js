/* the bench, built from web/bench: do not edit. source sha256:ab926f6beab043a86fbc4390ba14e48f2c31b379619095ce29d69e39caaa8c18 */
// Sitebench: a live-site workbench. Built from src/*.js
"use strict";
(() => {

// ===== 01-util.js =====
// ---------- util: elements, ids, events, diffs, modal, toast ----------
const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

// h('div.cls#id', {attrs, on:{click}}, ...children)
function h(tag, props, ...kids) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { kids.unshift(props); props = {} }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || []
  const el = document.createElement(m[1] || 'div')
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1))
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn)
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v
    else if (k === 'text') el.textContent = v
    else if (k === 'html') el.innerHTML = v
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'readOnly' || k === 'selected') el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  append(el, kids)
  return el
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.appendChild(k instanceof Node ? k : document.createTextNode(String(k))) }
  return el
}
function put(el, ...kids) { return append(el, kids) }
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el }
function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) k === 'text' ? (el.textContent = v) : el.setAttribute(k, v)
  for (const k of kids.flat()) if (k) el.appendChild(k)
  return el
}

const uid = (p = '') => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7)
const now = () => Date.now()
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v))
function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }; d.flush = (...a) => { clearTimeout(t); fn(...a) }; return d }
function fmtTime(t) { const d = new Date(t); return d.toTimeString().slice(0, 8) }
function fmtAgo(t) {
  const s = Math.round((now() - t) / 1000)
  if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'
  if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(t).toLocaleDateString()
}
function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '… (' + (s.length - n) + ' more chars)' : s }
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's') }
function ext(path) { const m = /\.([a-z0-9]+)$/i.exec(path || ''); return m ? m[1].toLowerCase() : '' }
function lineOf(text, idx) { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n }
function offsetOfLine(text, line) { let i = 0, n = 1; while (n < line) { const j = text.indexOf('\n', i); if (j < 0) return text.length; i = j + 1; n++ } return i }
function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) } return (x >>> 0).toString(36) }

// tiny event emitter
function emitter() {
  const m = new Map()
  return {
    on(ev, fn) { if (!m.has(ev)) m.set(ev, new Set()); m.get(ev).add(fn); return () => m.get(ev).delete(fn) },
    emit(ev, ...a) { for (const fn of m.get(ev) || []) { try { fn(...a) } catch (e) { console.error(e) } } }
  }
}

// line diff (LCS on lines, trimmed common prefix/suffix) -> [{op:' '|'+'|'-', text, a, b}]
function diffLines(aText, bText) {
  const a = (aText ?? '').split('\n'), b = (bText ?? '').split('\n')
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++
  let ea = a.length, eb = b.length; while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb-- }
  const A = a.slice(s, ea), B = b.slice(s, eb), out = []
  for (let i = 0; i < s; i++) out.push({ op: ' ', text: a[i], a: i + 1, b: i + 1 })
  if (A.length * B.length > 4e6) { A.forEach((t, i) => out.push({ op: '-', text: t, a: s + i + 1 })); B.forEach((t, i) => out.push({ op: '+', text: t, b: s + i + 1 })) }
  else {
    const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    let i = 0, j = 0
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { out.push({ op: ' ', text: A[i], a: s + i + 1, b: s + j + 1 }); i++; j++ }
      else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { out.push({ op: '+', text: B[j], b: s + j + 1 }); j++ }
      else { out.push({ op: '-', text: A[i], a: s + i + 1 }); i++ }
    }
  }
  for (let i = ea; i < a.length; i++) out.push({ op: ' ', text: a[i], a: i + 1, b: i - ea + eb + 1 })
  return out
}
function diffStat(a, b) { let add = 0, del = 0; for (const d of diffLines(a, b)) d.op === '+' ? add++ : d.op === '-' ? del++ : 0; return { add, del } }
// hunks with context, rendered as a .diff element
function diffView(aText, bText, ctx = 3) {
  const d = diffLines(aText, bText), keep = new Array(d.length).fill(false)
  d.forEach((x, i) => { if (x.op !== ' ') for (let k = Math.max(0, i - ctx); k <= Math.min(d.length - 1, i + ctx); k++) keep[k] = true })
  const el = h('div.diff'); let gap = false, any = false
  d.forEach((x, i) => {
    if (!keep[i]) { gap = true; return }
    if (gap || (!any && i > 0)) el.appendChild(h('div.h', '@@ line ' + (x.b || x.a)))
    gap = false; any = true
    el.appendChild(h('div' + (x.op === '+' ? '.a' : x.op === '-' ? '.d' : ''), (x.op === ' ' ? '  ' : x.op + ' ') + x.text))
  })
  if (!any) el.appendChild(h('div.h', 'no changes'))
  return el
}
// unified diff text for the agent
function diffText(path, aText, bText, ctx = 2) {
  const d = diffLines(aText, bText), keep = new Array(d.length).fill(false), out = ['--- ' + path, '+++ ' + path]
  d.forEach((x, i) => { if (x.op !== ' ') for (let k = Math.max(0, i - ctx); k <= Math.min(d.length - 1, i + ctx); k++) keep[k] = true })
  let gap = true
  d.forEach((x, i) => { if (!keep[i]) { gap = true; return } if (gap) out.push('@@ ' + (x.b || x.a)); gap = false; out.push((x.op === ' ' ? ' ' : x.op) + x.text) })
  return out.join('\n')
}

// toast + modal (no alert/confirm/prompt in artifacts)
let toastT
function toast(msg, ms = 2600) {
  let el = $('#toast'); if (!el) { el = h('div#toast'); document.body.appendChild(el) }
  el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true }, ms)
}
function modal({ title, body, actions = [], onClose, wide }) {
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key); onClose && onClose() }
  const key = e => { if (e.key === 'Escape') close() }
  const box = h('div.box', { style: wide ? { width: 'min(860px, 100%)' } : null },
    h('header', h('span', title), h('span.sp'), h('button.ibtn', { title: 'Close', on: { click: close } }, '×')),
    h('div.bd', body),
    actions.length ? h('footer', actions.map(a => h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), { on: { click: async () => { if ((await a.run?.()) !== false) close() } } }, a.label))) : null)
  const wrap = h('div.modal', { on: { mousedown: e => { if (e.target === wrap) close() } } }, box)
  document.body.appendChild(wrap); document.addEventListener('keydown', key)
  setTimeout(() => { const f = box.querySelector('input,textarea'); f && f.focus() }, 30)
  return { close, box }
}
function confirmBox(title, text, label = 'Confirm', danger = true) {
  return new Promise(res => {
    let done = false
    modal({ title, body: h('p', { style: { margin: 0 } }, text), onClose: () => { if (!done) res(false) },
      actions: [{ label: 'Cancel', run: () => { done = true; res(false) } }, { label, danger, primary: !danger, run: () => { done = true; res(true) } }] })
  })
}
function promptBox(title, label, value = '') {
  return new Promise(res => {
    let done = false
    const inp = h('input.txt', { value, style: { width: '100%' }, on: { keydown: e => { if (e.key === 'Enter') { done = true; res(inp.value.trim()); m.close() } } } })
    const m = modal({ title, body: [h('label.note', label), inp], onClose: () => { if (!done) res(null) },
      actions: [{ label: 'Cancel', run: () => { done = true; res(null) } }, { label: 'OK', primary: true, run: () => { done = true; res(inp.value.trim()) } }] })
  })
}

// popup menu anchored to a button; items: {label, sub, on, run, danger} | {group} | {hr} | {note} | Node
let openMenu = null
function popMenu(anchor, items, { right } = {}) {
  closeMenu()
  const menu = h('div.menu' + (right ? '.right' : ''))
  for (const it of items) {
    if (!it) continue
    if (it instanceof Node) menu.appendChild(it)
    else if (it.group) menu.appendChild(h('div.grp', it.group))
    else if (it.hr) menu.appendChild(h('hr'))
    else if (it.note) menu.appendChild(h('p.note', it.note))
    else menu.appendChild(h('button' + (it.on ? '.on' : '') + (it.danger ? '.danger' : ''), { disabled: it.disabled, on: { click: e => { e.stopPropagation(); closeMenu(); it.run && it.run() } } },
      h('span.t', it.label), it.sub ? h('small', it.sub) : null))
  }
  // fixed to the viewport so scrolling strips, zoomed canvases and floats never clip or scale it
  document.body.appendChild(menu); openMenu = menu
  const r = anchor.getBoundingClientRect()
  Object.assign(menu.style, { position: 'fixed', top: r.bottom + 6 + 'px', left: 'auto', right: 'auto' })
  const w = menu.offsetWidth, hgt = menu.offsetHeight
  let x = right ? r.right - w : r.left; x = clamp(x, 6, innerWidth - w - 6)
  let y = r.bottom + 6; if (y + hgt > innerHeight - 6) y = Math.max(6, r.top - 6 - hgt > 6 ? r.top - 6 - hgt : innerHeight - 6 - hgt)
  menu.style.left = x + 'px'; menu.style.top = y + 'px'
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', escMenu, true) }, 0)
  return menu
}
function outside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu() }
function escMenu(e) { if (e.key === 'Escape') closeMenu() }
function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null } document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', escMenu, true) }

// syntax highlighting (light: keywords bold, strings grey, comments italic)
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const JS_KW = /^(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|this|null|undefined|true|false|yield|delete|void)$/
function hlJS(src) {
  return src.replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)|([<>&"])/g, (m, c, s, n, w, x) =>
    c ? '<span class="tk-c">' + escHtml(c) + '</span>' : s ? '<span class="tk-s">' + escHtml(s) + '</span>' : n ? '<span class="tk-n">' + n + '</span>'
      : w ? (JS_KW.test(w) ? '<span class="tk-k">' + w + '</span>' : w) : escHtml(x))
}
function hlCSS(src) {
  return src.replace(/(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|([^{};\n/][^{};\n]*?)(?=\s*\{)|([\w-]+)(?=\s*:)|([<>&])/g, (m, c, s, sel, prop, x) =>
    c ? '<span class="tk-c">' + escHtml(c) + '</span>' : s ? '<span class="tk-s">' + escHtml(s) + '</span>' : sel ? '<span class="tk-k">' + escHtml(sel) + '</span>'
      : prop ? '<span class="tk-a">' + prop + '</span>' : escHtml(x))
}
function hlHTML(src) {
  let out = '', i = 0
  const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][\w-]*(?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g
  let m
  while ((m = re.exec(src))) {
    out += escHtml(src.slice(i, m.index)); i = re.lastIndex
    const t = m[0]
    if (t.startsWith('<!--')) { out += '<span class="tk-c">' + escHtml(t) + '</span>'; continue }
    out += t.replace(/^(<\/?)([\w-]+)|(\s)([^\s=>\/]+)(?=\s*=)|("[^"]*"|'[^']*')|(\/?>)$/g, (mm, lt, tag, sp, attr, str, gt) =>
      lt ? escHtml(lt) + '<span class="tk-t">' + tag + '</span>' : attr ? sp + '<span class="tk-a">' + attr + '</span>' : str ? '<span class="tk-s">' + escHtml(str) + '</span>' : gt ? escHtml(gt) : escHtml(mm))
    const tm = /^<(script|style)\b/i.exec(t)
    if (tm && !t.endsWith('/>')) {
      const close = src.toLowerCase().indexOf('</' + tm[1].toLowerCase(), i), end = close < 0 ? src.length : close
      const inner = src.slice(i, end); out += tm[1].toLowerCase() === 'script' ? hlJS(inner) : hlCSS(inner); i = end; re.lastIndex = end
    }
  }
  return out + escHtml(src.slice(i))
}
function hlMD(src) {
  let inFence = false
  return src.split('\n').map(l => {
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return '<span class="tk-c">' + escHtml(l) + '</span>' }
    if (inFence) return '<span class="tk-s">' + escHtml(l) + '</span>'
    if (/^#{1,6}\s/.test(l)) return '<span class="tk-k">' + escHtml(l) + '</span>'
    return escHtml(l).replace(/(`[^`]+`)/g, '<span class="tk-s">$1</span>').replace(/(\[[^\]]*\]\([^)]*\))/g, '<span class="tk-a">$1</span>')
      .replace(/^(\s*(?:[-*+]|\d+[.)])\s)/, '<span class="tk-a">$1</span>').replace(/(\*\*[^*]+\*\*)/g, '<b>$1</b>').replace(/^(&gt;.*)$/, '<span class="tk-c">$1</span>')
  }).join('\n')
}
function highlight(path, src) {
  const e = ext(path)
  if (src.length > 160000) return escHtml(src)
  return e === 'js' || e === 'mjs' || e === 'json' ? hlJS(src) : e === 'css' ? hlCSS(src) : e === 'md' || e === 'markdown' ? hlMD(src) : e === 'yaml' || e === 'yml' ? hlYAML(src) : e === 'html' || e === 'htm' || e === 'svg' ? hlHTML(src) : escHtml(src)
}

// ---------- markdown for agent replies: escaped first, then a small safe subset ----------
// file references like `styles.css:12` or menu.html:20 become links that open the code view (data-file, data-line).
const MD_LANG = { js: 'x.js', javascript: 'x.js', mjs: 'x.js', ts: 'x.js', json: 'x.json', css: 'x.css', html: 'x.html', htm: 'x.html', xml: 'x.html', svg: 'x.html' }
const FREF = /^([\w][\w./-]*\.(?:html?|css|js|mjs|json|svg|md|txt))(?::(\d+))?(?:-\d+)?$/
function mdInline(src, isFile) {
  const keep = []
  const stash = html => '\u0000' + (keep.push(html) - 1) + '\u0000'
  let s = src.replace(/`([^`\n]+)`/g, (m, c) => {
    const f = FREF.exec(c.trim())
    if (f && isFile(f[1])) return stash('<code class="fref" data-file="' + escHtml(f[1]) + '" data-line="' + (f[2] || 1) + '" title="Open in Code">' + escHtml(c) + '</code>')
    return stash('<code>' + escHtml(c) + '</code>')
  })
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => stash('<a href="' + escHtml(u) + '" target="_blank" rel="noopener noreferrer">' + escHtml(t) + '</a>'))
  s = s.replace(/\[([^\]\n]+)\]\(([\w][\w./-]*\.(?:html?|css|js|json|svg|md))(?:#L?(\d+))?\)/g, (m, t, f, l) => isFile(f) ? stash('<a class="fref" data-file="' + escHtml(f) + '" data-line="' + (l || 1) + '">' + escHtml(t) + '</a>') : m)
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, u) => pre + stash('<a href="' + escHtml(u) + '" target="_blank" rel="noopener noreferrer">' + escHtml(u) + '</a>'))
  s = s.replace(/(^|[\s(,;])([\w][\w./-]*\.(?:html?|css|js|json|svg|md)):(\d+)(?=$|[\s),.;:])/g, (m, pre, f, l) => isFile(f) ? pre + stash('<a class="fref" data-file="' + escHtml(f) + '" data-line="' + l + '">' + escHtml(f + ':' + l) + '</a>') : m)
  s = escHtml(s)
    .replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g, (m, a, b) => '<strong>' + (a || b) + '</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i])
}
function renderMarkdown(text, isFile = () => false, opts = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n'), root = h('div.md')
  const isList = l => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l)
  const isBlock = l => /^\s*(```|~~~)/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || isList(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l)
  const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l)
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
  function list(i, base) {
    const ordered = /^\s*\d+[.)]/.test(lines[i]), el = h(ordered ? 'ol' : 'ul')
    if (ordered) { const n = parseInt(lines[i].trim(), 10); if (n > 1) el.start = n }
    let li = null
    while (i < lines.length) {
      const l = lines[i], ind = l.length - l.trimStart().length
      if (!l.trim()) { if (i + 1 < lines.length && isList(lines[i + 1]) && lines[i + 1].length - lines[i + 1].trimStart().length >= base) { i++; continue } break }
      if (isList(l) && ind >= base + 2 && li) { const [sub, j] = list(i, ind); li.appendChild(sub); i = j; continue }
      if (isList(l) && ind >= base) { li = h('li', { html: mdInline(l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^\[( |x)\]\s+/i, (m, x) => x.trim() ? '☑ ' : '☐ '), isFile) }); el.appendChild(li); i++; continue }
      if (ind > base && li && !isBlock(l)) { li.insertAdjacentHTML('beforeend', ' ' + mdInline(l.trim(), isFile)); i++; continue }
      break
    }
    return [el, i]
  }
  function blocks(i, end, into) {
    while (i < end) {
      const l = lines[i]
      if (!l.trim()) { i++; continue }
      let m
      if ((m = /^\s*(```|~~~)\s*([\w+-]*)/.exec(l))) {
        const buf = []; i++
        while (i < end && !lines[i].trim().startsWith(m[1])) buf.push(lines[i++])
        i++
        const code = buf.join('\n'), pre = h('pre', h('code', { html: MD_LANG[m[2].toLowerCase()] ? highlight(MD_LANG[m[2].toLowerCase()], code) : escHtml(code) }))
        pre.appendChild(h('button.cp', { title: 'Copy', on: { click: async e => { e.stopPropagation(); try { await navigator.clipboard.writeText(code); toast('Copied') } catch { toast('Copy is blocked here; select the text instead') } } } }, 'Copy'))
        into.appendChild(pre); continue
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { into.appendChild(h('h' + Math.min(6, m[1].length + (opts.doc ? 1 : 2)), { 'data-line': i + 1, 'data-level': m[1].length, html: mdInline(m[2].replace(/\s+#+\s*$/, ''), isFile) })); i++; continue }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { into.appendChild(h('hr')); i++; continue }
      if (/^\s*>/.test(l)) {
        const start = i; while (i < end && /^\s*>/.test(lines[i])) { lines[i] = lines[i].replace(/^\s*>\s?/, ''); i++ }
        const q = h('blockquote'); blocks(start, i, q); into.appendChild(q); continue
      }
      if (isList(l)) { const [el, j] = list(i, l.length - l.trimStart().length); into.appendChild(el); i = Math.max(j, i + 1); continue }
      if (l.includes('|') && i + 1 < end && isSep(lines[i + 1])) {
        const head = cells(l), t = h('table', h('thead', h('tr', head.map(c => h('th', { html: mdInline(c, isFile) })))))
        const body = h('tbody'); i += 2
        while (i < end && lines[i].includes('|') && lines[i].trim()) { body.appendChild(h('tr', cells(lines[i]).map(c => h('td', { html: mdInline(c, isFile) })))); i++ }
        t.appendChild(body); into.appendChild(h('div.mdtable', t)); continue
      }
      const para = [l.trim()]; i++
      while (i < end && lines[i].trim() && !isBlock(lines[i]) && !(lines[i].includes('|') && i + 1 < end && isSep(lines[i + 1]))) para.push(lines[i++].trim())
      into.appendChild(h('p', { html: para.map(x => mdInline(x, isFile)).join('<br>') }))
    }
  }
  blocks(0, lines.length, root)
  return root
}

// ---------- YAML for showing values: easier to read than JSON; the model still gets JSON ----------
function toYAML(v, maxLines = 600) {
  const plainOK = s => s.length > 0 && s.length < 240 && !/^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s) && !/\s$/.test(s) && !/: |\s#|\t|:$/.test(s) &&
    !/^(true|false|null|yes|no|on|off|~|[-+]?(\d[\d_]*\.?\d*([eE][-+]?\d+)?|\.\d+)|0x[0-9a-fA-F]+|\.inf|\.nan)$/i.test(s)
  const short = x => x === null || x === undefined || typeof x === 'number' || typeof x === 'boolean' || (typeof x === 'string' && !x.includes('\n') && x.length <= 40)
  const scalar = (x, ind) => {
    if (x === null || x === undefined) return 'null'
    if (typeof x === 'boolean' || typeof x === 'number') return String(x)
    if (typeof x === 'string') {
      if (x.includes('\n')) return '|' + (x.endsWith('\n') ? '' : '-') + '\n' + x.replace(/\n$/, '').split('\n').map(l => ' '.repeat(ind) + l).join('\n')
      return plainOK(x) ? x : JSON.stringify(x)
    }
    return JSON.stringify(x)
  }
  const key = k => /^[A-Za-z_$][\w$.\-]*$/.test(k) && !/^(true|false|null|yes|no|on|off)$/i.test(k) ? k : JSON.stringify(k)
  const flow = a => { if (!a.length || a.length > 16 || !a.every(short)) return null; const t = '[' + a.map(x => scalar(x, 0)).join(', ') + ']'; return t.length <= 72 ? t : null }
  const isObj = x => x && typeof x === 'object'
  const empty = x => Array.isArray(x) ? (x.length ? null : '[]') : isObj(x) && !Object.keys(x).length ? '{}' : null
  const emit = (x, ind, out) => {
    const pad = ' '.repeat(ind)
    if (Array.isArray(x)) {
      for (const it of x) {
        if (!isObj(it)) { out.push(pad + '- ' + scalar(it, ind + 2)); continue }
        const e = empty(it), f = Array.isArray(it) && flow(it)
        if (e || f) { out.push(pad + '- ' + (e || f)); continue }
        const sub = []; emit(it, ind + 2, sub); out.push(pad + '- ' + sub[0].trimStart(), ...sub.slice(1))
      }
      return
    }
    for (const [k, val] of Object.entries(x)) {
      if (val === undefined) continue
      if (!isObj(val)) { out.push(pad + key(k) + ': ' + scalar(val, ind + 2)); continue }
      const e = empty(val), f = Array.isArray(val) && flow(val)
      if (e || f) { out.push(pad + key(k) + ': ' + (e || f)); continue }
      out.push(pad + key(k) + ':'); emit(val, ind + 2, out)
    }
  }
  if (!isObj(v)) return scalar(v, 2)
  const e = empty(v); if (e) return e
  const out = []; emit(v, 0, out)
  const lines = out.join('\n').split('\n')
  return lines.length > maxLines ? lines.slice(0, maxLines).join('\n') + '\n# … ' + (lines.length - maxLines) + ' more lines' : lines.join('\n')
}
// colour YAML (ours, or a .yaml file): keys, strings, numbers, true/false/null, punctuation, comments, block text
function hlYAML(src) {
  const val = v => {
    if (!v) return ''
    if (/^(null|true|false|~)$/i.test(v)) return '<span class="y-b">' + v + '</span>'
    if (/^[-+]?(\d[\d_]*\.?\d*([eE][-+]?\d+)?|\.\d+)$/.test(v)) return '<span class="y-n">' + v + '</span>'
    if (/^[|>][-+]?$/.test(v)) return '<span class="y-p">' + v + '</span>'
    if (/^\[.*\]$/.test(v)) return '<span class="y-p">[</span>' + v.slice(1, -1).split(/,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x => val(x.trim())).join('<span class="y-p">, </span>') + '<span class="y-p">]</span>'
    if (v === '[]' || v === '{}') return '<span class="y-p">' + v + '</span>'
    return '<span class="y-s">' + escHtml(v) + '</span>'
  }
  let block = -1
  return src.split('\n').map(line => {
    const ind = line.length - line.trimStart().length
    if (block >= 0) { if (line.trim() === '' || ind >= block) return '<span class="y-s">' + escHtml(line) + '</span>'; block = -1 }
    if (/^\s*#/.test(line)) return '<span class="y-c">' + escHtml(line) + '</span>'
    const m = /^(\s*)((?:- )*)(?:("(?:[^"\\]|\\.)*"|[^\s:"'\[\]{}#][^:#]*?):(?= |$))?\s?(.*)$/.exec(line)
    if (!m) return escHtml(line)
    const [, sp, dash, k, rest] = m
    if (/^[|>][-+]?$/.test(rest.trim())) block = ind + dash.length + (k ? 2 : 0) || ind + 1
    return sp + (dash ? '<span class="y-p">' + dash + '</span>' : '') + (k ? '<span class="y-k">' + escHtml(k) + '</span><span class="y-p">:</span> ' : '') + val(rest.trim())
  }).join('\n')
}

// ===== 02-templates.js =====
// ---------- templates: a fresh "repository" for a new project ----------
const T_COFFEE = {
  'README.md': `# Corner Coffee

An order-ahead site for a neighbourhood coffee bar: four pages, two tables, one shared script.

## Pages

| Page | What it does |
|---|---|
| [index.html](index.html) | Hero, hours, today's picks from the \`menu\` table |
| [menu.html](menu.html) | Menu with category filters and Add buttons |
| [cart.html](cart.html) | Cart lines, quantities, checkout form |
| [orders.html](orders.html) | Barista queue: mark orders ready, then collected |

## Data

- \`menu\`: id, name, cat (coffee, tea, bakery), price, desc, tag (\`pick\` puts it on the home page)
- \`orders\`: id, name, items, total, status (new, ready, collected)

## How pages reach the data

[app.js](app.js) runs on every page and switches on \`body[data-page]\`.

- \`site.db.rows('menu')\` reads a table, \`site.db.insert\` and \`site.db.update\` write one, and \`site.db.on('orders', fn)\` repaints when it changes.
- The cart lives in \`site.store\` under \`cart\`. Every frame on the canvas shares it, so adding an item in the menu frame updates the cart frame.

## Known issues

- [ ] The category buttons overflow at 375px (\`.cats\` in [styles.css](styles.css)). The health pill shows it.
- [ ] No way to mark an item sold out.

## Ideas

- An About page with opening hours kept in a table
- Tell the customer on the cart page when their order is ready
`,
  'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Corner Coffee</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-page="home">
  <header class="top">
    <a class="logo" href="index.html">Corner</a>
    <nav>
      <a href="menu.html">Menu</a>
      <a href="cart.html">Cart <span class="badge" id="cartCount">0</span></a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <p class="kicker">Open 7–17 · Corner of 5th &amp; Pine</p>
      <h1>Small batch coffee, poured slowly.</h1>
      <p class="lede">Order ahead and skip the line. We roast on Mondays and bake every morning.</p>
      <a class="cta" href="menu.html">See the menu</a>
    </section>
    <section class="today">
      <h2>Today's picks</h2>
      <ul class="picks" id="picks"></ul>
    </section>
  </main>
  <footer class="foot">Corner Coffee · 12 Pine St</footer>
  <script src="app.js"></script>
</body>
</html>
`,
  'menu.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Menu · Corner Coffee</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-page="menu">
  <header class="top">
    <a class="logo" href="index.html">Corner</a>
    <nav>
      <a href="menu.html" class="on">Menu</a>
      <a href="cart.html">Cart <span class="badge" id="cartCount">0</span></a>
    </nav>
  </header>
  <main>
    <h1>Menu</h1>
    <div class="cats" id="cats">
      <button class="cat on" data-cat="all">Everything</button>
      <button class="cat" data-cat="coffee">Coffee</button>
      <button class="cat" data-cat="tea">Tea &amp; other</button>
      <button class="cat" data-cat="bakery">Bakery</button>
    </div>
    <ul class="items" id="items"></ul>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  'cart.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cart · Corner Coffee</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-page="cart">
  <header class="top">
    <a class="logo" href="index.html">Corner</a>
    <nav>
      <a href="menu.html">Menu</a>
      <a href="cart.html" class="on">Cart <span class="badge" id="cartCount">0</span></a>
    </nav>
  </header>
  <main>
    <h1>Your order</h1>
    <ul class="lines" id="lines"></ul>
    <p class="total">Total <b id="total">$0.00</b></p>
    <form id="checkout" class="checkout">
      <label>Name for the cup <input name="name" required placeholder="Sam"></label>
      <button class="cta" type="submit">Place order</button>
    </form>
    <p class="done" id="done" hidden></p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  'orders.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orders · Corner Coffee</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-page="orders" class="staff">
  <header class="top">
    <a class="logo" href="index.html">Corner · bar</a>
    <nav><a href="orders.html" class="on">Orders</a></nav>
  </header>
  <main>
    <h1>Open orders</h1>
    <table class="queue">
      <thead><tr><th>#</th><th>Name</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody id="queue"></tbody>
    </table>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  'styles.css': `/* Corner Coffee */
:root {
  --ink: #2b211b;
  --paper: #fbf7f1;
  --crema: #9b5b25;
  --line: #e6dccf;
  --muted: #7a6a5d;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 16px/1.5 Georgia, "Times New Roman", serif;
  color: var(--ink);
  background: var(--paper);
}
a { color: inherit; }
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
}
.logo { font-weight: 700; font-size: 20px; text-decoration: none; letter-spacing: .02em; }
.top nav { display: flex; gap: 18px; }
.top nav a { text-decoration: none; color: var(--muted); }
.top nav a.on { color: var(--ink); border-bottom: 2px solid var(--crema); }
.badge {
  display: inline-block;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--crema);
  color: #fff;
  font: 12px/20px Arial, sans-serif;
  text-align: center;
}
main { padding: 20px; max-width: 760px; margin: 0 auto; }
h1 { font-size: 30px; line-height: 1.15; margin: 8px 0 16px; }
h2 { font-size: 20px; margin: 28px 0 10px; }
.hero { padding: 28px 0 8px; }
.kicker { color: var(--crema); font: 13px Arial, sans-serif; text-transform: uppercase; letter-spacing: .08em; margin: 0; }
.lede { color: var(--muted); max-width: 32em; }
.cta {
  display: inline-block;
  background: var(--ink);
  color: var(--paper);
  border: 0;
  padding: 12px 20px;
  border-radius: 4px;
  font: 15px Arial, sans-serif;
  text-decoration: none;
  cursor: pointer;
}
.picks, .items, .lines { list-style: none; padding: 0; margin: 0; }
.picks li, .items li, .lines li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.item-name { font-weight: 700; }
.item-desc { color: var(--muted); font-size: 14px; display: block; }
.price { font: 15px Arial, sans-serif; white-space: nowrap; }
.add {
  border: 1px solid var(--ink);
  background: none;
  border-radius: 4px;
  padding: 6px 12px;
  font: 14px Arial, sans-serif;
  cursor: pointer;
}
.add:hover { background: var(--ink); color: var(--paper); }
.cats { display: flex; gap: 8px; margin-bottom: 12px; }
.cat {
  min-width: 128px;
  padding: 8px 14px;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 18px;
  font: 14px Arial, sans-serif;
  cursor: pointer;
}
.cat.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.qty { display: inline-flex; gap: 6px; align-items: center; font-family: Arial, sans-serif; }
.qty button { width: 26px; height: 26px; border: 1px solid var(--line); background: #fff; border-radius: 13px; cursor: pointer; }
.total { display: flex; justify-content: space-between; font-size: 18px; }
.checkout { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.checkout label { display: flex; flex-direction: column; gap: 4px; font: 14px Arial, sans-serif; color: var(--muted); }
.checkout input { font: 16px Arial, sans-serif; padding: 10px; border: 1px solid var(--line); border-radius: 4px; }
.done { background: #fff; border: 1px solid var(--line); padding: 14px; border-radius: 4px; }
.empty { color: var(--muted); }
.foot { padding: 24px 20px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); margin-top: 40px; }
.staff { font-family: Arial, sans-serif; }
.queue { width: 100%; border-collapse: collapse; font-size: 14px; }
.queue th, .queue td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); }
.status { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
.status.ready { color: #2e7d32; }
`,
  'app.js': `// Corner Coffee — shared page script.
// site.db talks to the project's tables; site.store is a small key/value
// store shared by every frame of this project (the cart lives there).
const money = n => '$' + (Math.round(n * 100) / 100).toFixed(2)
const page = document.body.dataset.page

function cart() { return site.store.get('cart', []) }
function saveCart(c) { site.store.set('cart', c) }
function cartCount() { return cart().reduce((n, l) => n + l.qty, 0) }

function paintBadge() {
  const b = document.getElementById('cartCount')
  if (b) b.textContent = cartCount()
}
site.store.on('cart', paintBadge)
paintBadge()

function addToCart(item) {
  const c = cart()
  const line = c.find(l => l.id === item.id)
  if (line) line.qty += 1
  else c.push({ id: item.id, name: item.name, price: item.price, qty: 1 })
  saveCart(c)
}

async function home() {
  const rows = await site.db.rows('menu')
  const picks = rows.filter(r => r.tag === 'pick')
  document.getElementById('picks').innerHTML = picks.map(r =>
    '<li><span><span class="item-name">' + r.name + '</span><span class="item-desc">' + r.desc + '</span></span>' +
    '<span class="price">' + money(r.price) + '</span></li>').join('')
}
if (page === 'home') site.db.on('menu', home)

async function menu() {
  let rows = await site.db.rows('menu')
  const list = document.getElementById('items')
  let cat = 'all'
  function paint() {
    const shown = rows.filter(r => cat === 'all' || r.cat === cat)
    list.innerHTML = shown.map(r =>
      '<li><span><span class="item-name">' + r.name + '</span><span class="item-desc">' + r.desc + '</span></span>' +
      '<span class="price">' + money(r.price) + '</span>' +
      '<button class="add" data-id="' + r.id + '">Add</button></li>').join('')
  }
  document.getElementById('cats').addEventListener('click', e => {
    const b = e.target.closest('.cat'); if (!b) return
    cat = b.dataset.cat
    document.querySelectorAll('.cat').forEach(x => x.classList.toggle('on', x === b))
    paint()
  })
  list.addEventListener('click', e => {
    const b = e.target.closest('.add'); if (!b) return
    addToCart(rows.find(r => String(r.id) === b.dataset.id))
    b.textContent = 'Added'
    setTimeout(() => { b.textContent = 'Add' }, 900)
  })
  site.db.on('menu', async () => { rows = await site.db.rows('menu'); paint() })
  paint()
}

function cartPage() {
  const lines = document.getElementById('lines')
  function paint() {
    const c = cart()
    lines.innerHTML = c.length ? c.map(l =>
      '<li><span class="item-name">' + l.name + '</span>' +
      '<span class="qty"><button data-d="-1" data-id="' + l.id + '">−</button>' + l.qty +
      '<button data-d="1" data-id="' + l.id + '">+</button></span>' +
      '<span class="price">' + money(l.price * l.qty) + '</span></li>').join('')
      : '<li class="empty">Nothing here yet. <a href="menu.html">Browse the menu</a>.</li>'
    document.getElementById('total').textContent = money(c.reduce((s, l) => s + l.price * l.qty, 0))
  }
  lines.addEventListener('click', e => {
    const b = e.target.closest('button[data-d]'); if (!b) return
    const c = cart(), l = c.find(x => String(x.id) === b.dataset.id)
    l.qty += Number(b.dataset.d)
    saveCart(c.filter(x => x.qty > 0))
  })
  site.store.on('cart', paint)
  paint()
  document.getElementById('checkout').addEventListener('submit', async e => {
    e.preventDefault()
    const c = cart(); if (!c.length) return
    const name = new FormData(e.target).get('name')
    const order = await site.db.insert('orders', {
      name, items: c.map(l => l.qty + '× ' + l.name).join(', '),
      total: c.reduce((s, l) => s + l.price * l.qty, 0), status: 'new'
    })
    saveCart([])
    const done = document.getElementById('done')
    done.hidden = false
    done.textContent = 'Thanks ' + name + '! Order #' + order.id + ' is with the bar.'
  })
}

async function orders() {
  const body = document.getElementById('queue')
  async function paint() {
    const rows = (await site.db.rows('orders')).filter(o => o.status !== 'collected')
    body.innerHTML = rows.map(o =>
      '<tr><td>' + o.id + '</td><td>' + o.name + '</td><td>' + o.items + '</td><td>' + money(o.total) + '</td>' +
      '<td class="status ' + o.status + '">' + o.status + '</td>' +
      '<td><button class="add" data-id="' + o.id + '">' + (o.status === 'new' ? 'Ready' : 'Collected') + '</button></td></tr>').join('')
  }
  body.addEventListener('click', async e => {
    const b = e.target.closest('button[data-id]'); if (!b) return
    const rows = await site.db.rows('orders'), o = rows.find(r => String(r.id) === b.dataset.id)
    await site.db.update('orders', o.id, { status: o.status === 'new' ? 'ready' : 'collected' })
  })
  site.db.on('orders', paint)
  paint()
}

({ home, menu, cart: cartPage, orders })[page]?.()
`
}
const T_COFFEE_TABLES = {
  menu: { cols: ['id', 'name', 'cat', 'price', 'desc', 'tag'], rows: [
    { id: 1, name: 'Espresso', cat: 'coffee', price: 3, desc: 'Double shot, house blend', tag: '' },
    { id: 2, name: 'Flat white', cat: 'coffee', price: 4.5, desc: 'Silky milk, ristretto', tag: 'pick' },
    { id: 3, name: 'Filter of the week', cat: 'coffee', price: 4, desc: 'Ethiopia Guji, washed', tag: 'pick' },
    { id: 4, name: 'Chai latte', cat: 'tea', price: 4.5, desc: 'Spiced, steamed oat milk', tag: '' },
    { id: 5, name: 'Sencha', cat: 'tea', price: 3.5, desc: 'Green tea, second flush', tag: '' },
    { id: 6, name: 'Cardamom bun', cat: 'bakery', price: 3.75, desc: 'Baked at 6am', tag: 'pick' },
    { id: 7, name: 'Butter croissant', cat: 'bakery', price: 3.25, desc: 'Laminated in house', tag: '' }
  ] },
  orders: { cols: ['id', 'name', 'items', 'total', 'status'], rows: [
    { id: 1, name: 'Ana', items: '1× Flat white, 1× Cardamom bun', total: 8.25, status: 'new' }
  ] }
}

const T_LANDING = {
  'README.md': `# Tidewater landing page

A one-page waitlist site for a notes app.

- [index.html](index.html): hero, features, pricing, signup form
- [styles.css](styles.css): the whole look, one file
- [app.js](app.js): stores each signup with \`site.db.insert('signups', {email, source})\`

## To do

- [ ] Monthly / yearly pricing toggle
- [ ] FAQ section
- [ ] Check the features grid at phone width
`,
  'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tidewater — notes that file themselves</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="nav">
    <span class="mark">Tidewater</span>
    <a href="#pricing">Pricing</a>
    <a class="btn small" href="#signup">Get early access</a>
  </header>
  <section class="hero">
    <h1>Notes that file themselves.</h1>
    <p>Write anywhere. Tidewater sorts every note into the right project, links the people in it, and reminds you before it matters.</p>
    <a class="btn" href="#signup">Join the waitlist</a>
  </section>
  <section class="features">
    <article><h3>Auto-filing</h3><p>Every note lands in the project it belongs to, with no folders to keep.</p></article>
    <article><h3>People, linked</h3><p>Names become contacts, with every note about them a click away.</p></article>
    <article><h3>Gentle reminders</h3><p>Dates in your notes turn into nudges a day ahead.</p></article>
  </section>
  <section class="pricing" id="pricing">
    <h2>Pricing</h2>
    <div class="plans">
      <div class="plan"><h3>Free</h3><p class="amt">$0</p><p>500 notes, one device.</p></div>
      <div class="plan best"><h3>Pro</h3><p class="amt">$6<small>/mo</small></p><p>Unlimited notes, every device, reminders.</p></div>
    </div>
  </section>
  <section class="signup" id="signup">
    <h2>Get early access</h2>
    <form id="form">
      <input name="email" type="email" required placeholder="you@example.com">
      <button class="btn" type="submit">Join</button>
    </form>
    <p id="thanks" hidden>You're on the list. We'll write soon.</p>
  </section>
  <footer class="foot">© Tidewater</footer>
  <script src="app.js"></script>
</body>
</html>
`,
  'styles.css': `:root { --ink: #0f2533; --sea: #1c7c8c; --foam: #eef6f7; --muted: #5d7480; }
* { box-sizing: border-box; }
body { margin: 0; font: 17px/1.55 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: var(--ink); }
.nav { display: flex; align-items: center; gap: 20px; padding: 16px 24px; }
.nav .mark { font-weight: 800; margin-right: auto; }
.nav a { color: var(--muted); text-decoration: none; }
.btn { display: inline-block; background: var(--sea); color: #fff; padding: 12px 22px; border-radius: 999px; border: 0; font: inherit; text-decoration: none; cursor: pointer; }
.btn.small { padding: 7px 14px; font-size: 14px; color: #fff; }
.hero { padding: 72px 24px 56px; background: var(--foam); text-align: center; }
.hero h1 { font-size: 48px; line-height: 1.05; margin: 0 0 16px; }
.hero p { max-width: 34em; margin: 0 auto 24px; color: var(--muted); }
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; padding: 48px 24px; max-width: 1000px; margin: 0 auto; }
.features h3 { margin: 0 0 6px; }
.features p { margin: 0; color: var(--muted); }
.pricing, .signup { padding: 40px 24px; text-align: center; }
.plans { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.plan { border: 1px solid #d5e4e8; border-radius: 12px; padding: 20px 28px; min-width: 220px; }
.plan.best { border-color: var(--sea); box-shadow: 0 0 0 1px var(--sea); }
.amt { font-size: 32px; font-weight: 800; margin: 4px 0; }
.amt small { font-size: 14px; color: var(--muted); }
form { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
input { font: inherit; padding: 11px 14px; border: 1px solid #c7d9de; border-radius: 999px; min-width: 260px; }
.foot { text-align: center; color: var(--muted); padding: 32px; font-size: 14px; }
`,
  'app.js': `// Tidewater landing — store signups in the "signups" table.
document.getElementById('form').addEventListener('submit', async e => {
  e.preventDefault()
  const email = new FormData(e.target).get('email')
  await site.db.insert('signups', { email, source: 'landing' })
  e.target.hidden = true
  document.getElementById('thanks').hidden = false
})
`
}
const T_LANDING_TABLES = { signups: { cols: ['id', 'email', 'source'], rows: [] } }

const T_BLANK = {
  'README.md': `# Untitled

A fresh project. Every \`.html\` file is a page; \`styles.css\` and \`app.js\` load into the pages that link them.

- Ask the agent to build something, or edit files in Code.
- Keep notes and plans in Markdown files: they render in the Docs panel.
`,
  'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Untitled</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h1>Hello</h1>
    <p>Start here, or ask the agent to build something.</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  'styles.css': `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
main { padding: 32px; max-width: 720px; margin: 0 auto; }
`,
  'app.js': `// Page script. site.db.rows(table), site.db.insert(table, row), site.store.get/set
`
}

const TEMPLATES = [
  { id: 'coffee', name: 'Corner Coffee', blurb: 'Menu, cart and a barista queue. Four pages, two tables, one layout bug at phone width.',
    files: T_COFFEE, tables: T_COFFEE_TABLES,
    frames: [{ route: 'index.html', w: 375, h: 720 }, { route: 'menu.html', w: 375, h: 720 }, { route: 'cart.html', w: 375, h: 720 }, { route: 'orders.html', w: 960, h: 600 }] },
  { id: 'landing', name: 'Landing page', blurb: 'A one-page waitlist site with a signup table.',
    files: T_LANDING, tables: T_LANDING_TABLES, frames: [{ route: 'index.html', w: 1200, h: 860 }, { route: 'index.html', w: 375, h: 760 }] },
  { id: 'blank', name: 'Blank', blurb: 'One page, an empty stylesheet and script. A fresh repository.',
    files: T_BLANK, tables: {}, frames: [{ route: 'index.html', w: 1024, h: 700 }, { route: 'index.html', w: 375, h: 700 }] }
]

// ===== 03-store.js =====
// ---------- store: the artifact db (per viewer, private) or localStorage, behind one queue ----------
const DEL = Symbol('delete')
const Store = {
  mode: 'memory', root: '', db: null, ev: emitter(), status: 'idle', error: '',
  pend: new Map(), inflight: new Map(), flushing: false, timer: 0, mem: new Map(),

  async init() {
    let db = null, user = null, id = null
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        ;[db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')])
        id = user ? await user.id() : null
      }
    } catch (e) { db = null }
    if (db && id) { this.mode = 'db'; this.db = db; this.root = 'data/users/' + id; this.user = user }
    else {
      try { localStorage.setItem('sb1|probe', '1'); localStorage.removeItem('sb1|probe'); this.mode = 'local' } catch { this.mode = 'memory' }
      this.root = 'local'
    }
    addEventListener('pagehide', () => this.flush())
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush() })
    this.set('idle')
    return this.mode
  },
  set(s, err = '') { this.status = s; this.error = err; this.ev.emit('status', s, err) },
  full(rel) { return this.root + '/' + rel },

  async call(fn) {
    try { return await fn() } catch (e) {
      if (e && e.code === 'unavailable') { await sleep(400 + Math.random() * 600); return await fn() }
      throw e
    }
  },
  shadow(rel) { if (this.pend.has(rel)) return this.pend.get(rel); if (this.inflight.has(rel)) return this.inflight.get(rel); return undefined },
  async get(rel) {
    const sh = this.shadow(rel); if (sh !== undefined) return sh === DEL ? null : clone(sh)
    const p = this.full(rel)
    if (this.mode === 'db') { const s = await this.call(() => this.db.doc(p).get()); return s.exists ? clone(s.data()) : null }
    if (this.mode === 'local') { const v = localStorage.getItem('sb1|' + p); return v ? JSON.parse(v) : null }
    return clone(this.mem.get(p) ?? null)
  },
  async list(relColl) {
    const base = await this.listRaw(relColl), map = new Map(base.map(d => [d.id, d]))
    for (const src of [this.inflight, this.pend]) for (const [rel, data] of src) {
      if (!rel.startsWith(relColl + '/')) continue
      const id = rel.slice(relColl.length + 1); if (id.includes('/')) continue
      data === DEL ? map.delete(id) : map.set(id, { id, data: clone(data) })
    }
    return [...map.values()].sort((a, b) => a.id < b.id ? -1 : 1)
  },
  async listRaw(relColl) {
    const p = this.full(relColl)
    if (this.mode === 'db') { const s = await this.call(() => this.db.collection(p).limit(1000).get()); return s.docs.map(d => ({ id: d.id, data: clone(d.data()) })) }
    const pre = p + '/', out = []
    const keys = this.mode === 'local' ? Object.keys(localStorage).filter(k => k.startsWith('sb1|' + pre)).map(k => k.slice(4)) : [...this.mem.keys()].filter(k => k.startsWith(pre))
    for (const k of keys) {
      const rest = k.slice(pre.length); if (!rest || rest.includes('/')) continue
      out.push({ id: rest, data: this.mode === 'local' ? JSON.parse(localStorage.getItem('sb1|' + k)) : clone(this.mem.get(k)) })
    }
    return out.sort((a, b) => a.id < b.id ? -1 : 1)
  },
  save(rel, data) { this.pend.set(rel, data === DEL ? DEL : clone(data)); this.schedule() },
  remove(rel) { this.save(rel, DEL) },
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 700); if (this.status !== 'error') this.set('dirty') },
  async flush() {
    clearTimeout(this.timer)
    if (this.flushing) { this.again = true; return }
    if (!this.pend.size) return
    this.flushing = true; this.set('saving')
    let failed = null
    try {
      while (this.pend.size) {
        const batch = [...this.pend]; this.pend.clear(); for (const [k, v] of batch) this.inflight.set(k, v)
        let i = 0
        const worker = async () => {
          while (i < batch.length) {
            const [rel, data] = batch[i++]
            try { await this.write(rel, data) } catch (e) { failed = e; console.warn('save failed', rel, e) }
            if (this.inflight.get(rel) === data) this.inflight.delete(rel)
          }
        }
        await Promise.all([worker(), worker(), worker(), worker()])
      }
    } finally { this.flushing = false }
    if (failed) {
      const code = failed.code || ''
      const msg = code === 'quota_exceeded' ? 'Storage is full: delete a project or old sessions.' : code === 'invalid_argument' ? 'A save was refused (' + (failed.message || 'too large or not allowed') + ').' : 'Saving failed: ' + (failed.message || failed)
      this.set('error', msg); toast(msg, 5000)
    } else this.set('saved')
    if (this.again) { this.again = false; if (this.pend.size) this.flush() }
  },
  async write(rel, data) {
    const p = this.full(rel)
    if (data !== DEL && JSON.stringify(data).length > 255000) throw Object.assign(new Error('document over 256 KiB: ' + rel), { code: 'invalid_argument' })
    if (this.mode === 'db') return this.call(() => data === DEL ? this.db.doc(p).delete() : this.db.doc(p).set(data))
    if (this.mode === 'local') {
      try { data === DEL ? localStorage.removeItem('sb1|' + p) : localStorage.setItem('sb1|' + p, JSON.stringify(data)) }
      catch (e) { throw Object.assign(new Error('browser storage is full'), { code: 'quota_exceeded' }) }
      return
    }
    data === DEL ? this.mem.delete(p) : this.mem.set(p, clone(data))
  },
  label() {
    const where = this.mode === 'db' ? 'Saved to your account' : this.mode === 'local' ? 'Saved in this browser only' : 'Not saved (no storage here)'
    return { db: 'Account', local: 'Browser', memory: 'Memory' }[this.mode] + ' · ' + ({ idle: 'ready', dirty: 'unsaved', saving: 'saving…', saved: 'saved', error: 'error' }[this.status] || this.status) + '|' + where
  }
}
// file paths become one db segment: letters, digits, _ - . kept; '/' -> '~'; others -> +hhhh
function encKey(path) {
  let s = ''
  for (const ch of path) s += /[A-Za-z0-9_.-]/.test(ch) ? ch : ch === '/' ? '~' : '+' + ch.codePointAt(0).toString(16).padStart(4, '0')
  if (s === '.' || s === '..') s = '+002e' + s.slice(1)
  return s.slice(0, 190)
}
function validPath(path) {
  if (typeof path !== 'string' || !path) return 'path must be a non-empty string'
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..')) return 'paths are relative like "pages/about.html" (no leading /, no . or ..)'
  if (!/^[\w.\-/ @+~]+$/.test(path)) return 'use letters, digits, - _ . / in paths'
  if (path.length > 160) return 'path too long'
  return null
}

// ===== 04-project.js =====
// ---------- project model: main files, overlay workspaces, tables, session log, marks, threads ----------
class Project {
  constructor(meta) {
    this.id = meta.id; this.meta = meta
    this.files = new Map(); this.overlays = new Map(); this.tables = new Map(); this.threads = new Map()
    this.events = []; this.chunks = []        // chunks: [{id, start, size}]
    this.ev = emitter()
    this.saveMeta = debounce(() => { this.meta.updated = now(); Store.save(this.key(), this.meta); Projects.touch(this) }, 500)
  }
  key(sub) { return 'p_' + this.id + (sub ? '/' + sub : '') }
  get title() { return this.meta.title }

  // ---- files, through a workspace ('main' or an overlay id) ----
  read(path, ws = 'main') {
    const ov = ws !== 'main' && this.overlays.get(ws)
    if (ov && Object.prototype.hasOwnProperty.call(ov.files, path)) return ov.files[path]
    return this.files.has(path) ? this.files.get(path) : null
  }
  list(ws = 'main') {
    const set = new Set(this.files.keys()), ov = ws !== 'main' && this.overlays.get(ws)
    if (ov) for (const [p, t] of Object.entries(ov.files)) t === null ? set.delete(p) : set.add(p)
    return [...set].sort((a, b) => (a.includes('/') - b.includes('/')) || a.localeCompare(b))
  }
  write(path, text, { ws = 'main', who = 'you', note, thread, via } = {}) {
    const bad = validPath(path); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
    if (typeof text !== 'string') throw Object.assign(new Error('file content must be a string'), { kind: 'invalid' })
    if (text.length > 240000) throw Object.assign(new Error('file too large (max 240 KB)'), { kind: 'invalid' })
    const before = this.read(path, ws)
    if (before === text) return false
    if (ws === 'main') { this.files.set(path, text); Store.save(this.key('files/' + encKey(path)), { path, text }) }
    else {
      const ov = this.overlay(ws)
      if (!(path in ov.base)) ov.base[path] = this.files.has(path) ? this.files.get(path) : null
      ov.files[path] = text; ov.updated = now(); this.saveOverlay(ov)
    }
    this.log({ kind: 'write', ws, who, path, after: text, created: before === null, note, thread, ...(via ? { via } : {}) })
    this.ev.emit('files', ws, [path])
    return true
  }
  remove(path, { ws = 'main', who = 'you', note, thread } = {}) {
    if (this.read(path, ws) === null) return false
    if (ws === 'main') { this.files.delete(path); Store.remove(this.key('files/' + encKey(path))) }
    else {
      const ov = this.overlay(ws)
      if (!(path in ov.base)) ov.base[path] = this.files.has(path) ? this.files.get(path) : null
      if (ov.base[path] === null) delete ov.files[path]; else ov.files[path] = null
      this.saveOverlay(ov)
    }
    this.log({ kind: 'remove', ws, who, path, note, thread })
    this.ev.emit('files', ws, [path])
    return true
  }

  // put a file back as it was before an eval's first write (the eval failed); logged like any write
  revert(path, ws, snap, { who = 'you', note, thread } = {}) {
    if (ws === 'main') { if (snap.text === null) this.remove(path, { who, note, thread }); else this.write(path, snap.text, { who, note, thread }); return }
    const ov = this.overlays.get(ws); if (!ov) return
    if (snap.inOv) ov.files[path] = snap.ovText; else delete ov.files[path]
    if (!snap.hadBase) delete ov.base[path]
    ov.updated = now(); this.saveOverlay(ov)
    const after = this.read(path, ws)
    this.log(after === null ? { kind: 'remove', ws, who, path, note, thread } : { kind: 'write', ws, who, path, after, note, thread })
    this.ev.emit('files', ws, [path])
  }

  // ---- overlays: a workspace on top of main, reviewed then accepted or rejected ----
  overlay(id) { const ov = this.overlays.get(id); if (!ov) throw Object.assign(new Error('no workspace ' + id), { kind: 'invalid' }); if (ov.status !== 'open') throw Object.assign(new Error('workspace "' + ov.title + '" is ' + ov.status), { kind: 'policy' }); return ov }
  openOverlays() { return [...this.overlays.values()].filter(o => o.status === 'open').sort((a, b) => a.created - b.created) }
  newOverlay({ title, by = 'you', thread } = {}) {
    const n = this.overlays.size + 1
    const ov = { id: 'ov' + uid(), title: title || 'Proposal ' + n, by, thread: thread || null, created: now(), updated: now(), status: 'open', files: {}, base: {} }
    this.overlays.set(ov.id, ov); this.saveOverlay(ov)
    this.log({ kind: 'overlay', ws: ov.id, who: by, note: 'opened "' + ov.title + '"', thread })
    this.ev.emit('overlays')
    return ov
  }
  saveOverlay(ov) { Store.save(this.key('ov/' + ov.id), ov) }
  changes(oid) {
    const ov = this.overlays.get(oid); if (!ov) return []
    return Object.keys(ov.files).sort().map(path => {
      const after = ov.files[path], main = this.files.has(path) ? this.files.get(path) : null, base = path in ov.base ? ov.base[path] : main
      return { path, before: main, after, base, conflict: base !== main, created: main === null && after !== null, deleted: after === null }
    }).filter(c => c.before !== c.after)
  }
  accept(oid, paths, who = 'you', tables) {
    const ov = this.overlay(oid), list = this.changes(oid).filter(c => !paths || paths.includes(c.path))
    for (const c of list) {
      if (c.after === null) this.remove(c.path, { who, note: 'accepted from "' + ov.title + '"' })
      else this.write(c.path, c.after, { who, note: 'accepted from "' + ov.title + '"', via: oid })
      delete ov.files[c.path]; delete ov.base[c.path]
    }
    for (const p of Object.keys(ov.files)) if (ov.files[p] === (this.files.get(p) ?? null)) { delete ov.files[p]; delete ov.base[p] }
    const tch = this.tableChanges(oid).filter(c => tables === undefined ? !paths : tables.includes(c.name))
    for (const c of tch) {
      if (!c.after) { this.tables.delete(c.name); Store.remove(this.key('tables/' + encKey(c.name))); this.log({ kind: 'data', who, ws: 'main', table: c.name, note: 'drop (accepted)' }); this.ev.emit('tables', c.name, 'main') }
      else { const t = clone(c.after); this.tables.set(c.name, t); this.saveTable(t, 'accepted from "' + ov.title + '": +' + c.added.length + ' −' + c.removed.length + ' ~' + c.changed.length, who, 'main') }
      delete ov.tables[c.name]; if (ov.tbase) delete ov.tbase[c.name]
    }
    if (ov.tables) for (const n of Object.keys(ov.tables)) if (!this.tableChanges(oid).some(c => c.name === n)) { delete ov.tables[n]; if (ov.tbase) delete ov.tbase[n] }
    if (!Object.keys(ov.files).length && !Object.keys(ov.tables || {}).length) ov.status = 'accepted'
    this.saveOverlay(ov)
    this.log({ kind: 'accept', ws: oid, who, note: plural(list.length, 'file') + (tch.length ? ' and ' + plural(tch.length, 'table') : '') + ' from "' + ov.title + '"', paths: list.map(c => c.path) })
    this.ev.emit('overlays'); this.ev.emit('files', oid, list.map(c => c.path))
    return list.length + tch.length
  }
  reject(oid, who = 'you') {
    const ov = this.overlay(oid); ov.status = 'rejected'; this.saveOverlay(ov)
    this.log({ kind: 'reject', ws: oid, who, note: '"' + ov.title + '"' })
    this.ev.emit('overlays'); this.ev.emit('files', oid, Object.keys(ov.files))
  }

  // ---- tables: main's; in a proposal, a copy made on its first write there (so proposals stage data too) ----
  tablesIn(ws = 'main') {
    const m = new Map(this.tables), ov = ws !== 'main' && this.overlays.get(ws)
    if (ov && ov.tables) for (const [n, t] of Object.entries(ov.tables)) t === null ? m.delete(n) : m.set(n, t)
    return m
  }
  table(name, ws = 'main') {
    const t = this.tablesIn(ws).get(name)
    if (!t) throw Object.assign(new Error('no table "' + name + '" (tables: ' + ([...this.tablesIn(ws).keys()].join(', ') || 'none') + ')'), { kind: 'invalid' })
    return t
  }
  ownsTable(name, ws) { const ov = ws !== 'main' && this.overlays.get(ws); return !!ov && !!ov.tables && name in ov.tables }
  tableW(name, ws = 'main', create) {
    if (ws === 'main') {
      let t = this.tables.get(name)
      if (!t && create) { t = { name, cols: [], rows: [], seq: 0 }; this.tables.set(name, t) }
      if (!t) return this.table(name, ws)
      return t
    }
    const ov = this.overlay(ws); ov.tables = ov.tables || {}; ov.tbase = ov.tbase || {}
    if (!(name in ov.tables) || (ov.tables[name] === null && create)) {
      const base = this.tables.get(name)
      if (!base && !create) return this.table(name, ws)
      ov.tables[name] = base ? clone(base) : { name, cols: [], rows: [], seq: 0 }
      if (!(name in ov.tbase)) ov.tbase[name] = base ? hashStr(JSON.stringify(base.rows)) : null
    }
    if (ov.tables[name] === null) return this.table(name, ws)
    return ov.tables[name]
  }
  saveTable(t, op, who, ws = 'main', extra) {
    if (ws === 'main') Store.save(this.key('tables/' + encKey(t.name)), t)
    else { const ov = this.overlays.get(ws); if (ov) { ov.updated = now(); this.saveOverlay(ov) } }
    if (who !== 'site') this.log({ kind: 'data', who, ws, table: t.name, note: op, ...extra })
    this.ev.emit('tables', t.name, ws)
  }
  define(name, cols, who = 'you', ws = 'main') {
    if (!/^[A-Za-z_][\w-]{0,40}$/.test(name)) throw Object.assign(new Error('table names are words: letters, digits, _ or -'), { kind: 'invalid' })
    cols = ['id', ...(cols || []).filter(c => c !== 'id')]
    const t = this.tableW(name, ws, true)
    t.cols = [...new Set([...t.cols.filter(c => cols.includes(c) || t.rows.some(r => r[c] != null)), ...cols])]
    this.saveTable(t, 'define', who, ws); return t.cols
  }
  dropTable(name, who = 'you', ws = 'main') {
    this.table(name, ws)
    if (ws === 'main') { this.tables.delete(name); Store.remove(this.key('tables/' + encKey(name))) }
    else { const ov = this.overlay(ws); ov.tables = ov.tables || {}; ov.tbase = ov.tbase || {}; if (!(name in ov.tbase)) ov.tbase[name] = this.tables.has(name) ? hashStr(JSON.stringify(this.tables.get(name).rows)) : null; ov.tables[name] = null; this.saveOverlay(ov) }
    this.log({ kind: 'data', who, ws, table: name, note: 'drop' }); this.ev.emit('tables', name, ws)
  }
  rows(name, where, ws = 'main') {
    const t = this.table(name, ws)
    return clone(where && typeof where === 'object' ? t.rows.filter(r => Object.entries(where).every(([k, v]) => r[k] === v)) : t.rows)
  }
  insert(name, row, who = 'you', ws = 'main') {
    if (!row || typeof row !== 'object') throw Object.assign(new Error('insert takes an object'), { kind: 'invalid' })
    const t = this.tableW(name, ws)
    t.seq = Math.max(t.seq || 0, ...t.rows.map(r => +r.id || 0)) + 1
    const r = { ...clone(row), id: t.seq }
    for (const k of Object.keys(r)) if (!t.cols.includes(k)) t.cols.push(k)
    t.rows.push(r); this.saveTable(t, 'insert #' + r.id, who, ws); return clone(r)
  }
  update(name, id, patch, who = 'you', ws = 'main') {
    if (!this.table(name, ws).rows.some(x => String(x.id) === String(id))) throw Object.assign(new Error('no row ' + id + ' in ' + name), { kind: 'invalid' })
    const t = this.tableW(name, ws), r = t.rows.find(x => String(x.id) === String(id))
    Object.assign(r, clone(patch), { id: r.id })
    for (const k of Object.keys(r)) if (!t.cols.includes(k)) t.cols.push(k)
    this.saveTable(t, 'update #' + r.id, who, ws); return clone(r)
  }
  removeRow(name, id, who = 'you', ws = 'main') {
    if (!this.table(name, ws).rows.some(x => String(x.id) === String(id))) return false
    const t = this.tableW(name, ws)
    t.rows = t.rows.filter(x => String(x.id) !== String(id))
    this.saveTable(t, 'remove #' + id, who, ws); return true
  }
  // undo for an eval or atomic step: snap is { own, t } as it was before the first write
  restoreTable(name, snap, who = 'you', ws = 'main') {
    if (ws === 'main') {
      if (!snap.t) { if (this.tables.has(name)) { this.tables.delete(name); Store.remove(this.key('tables/' + encKey(name))); this.ev.emit('tables', name, ws) } return }
      const t = clone(snap.t); this.tables.set(name, t); this.saveTable(t, 'rolled back', who, ws); return
    }
    const ov = this.overlays.get(ws); if (!ov) return
    ov.tables = ov.tables || {}
    if (!snap.own) delete ov.tables[name]; else ov.tables[name] = snap.t ? clone(snap.t) : null
    this.saveOverlay(ov); this.ev.emit('tables', name, ws)
  }
  tableSnap(name, ws) { const own = ws === 'main' ? true : this.ownsTable(name, ws), t = this.tablesIn(ws).get(name); return { own, t: t ? clone(t) : null } }
  // what a proposal does to the data: rows added, removed and changed per table
  tableChanges(oid) {
    const ov = this.overlays.get(oid); if (!ov || !ov.tables) return []
    const out = []
    for (const [name, after] of Object.entries(ov.tables)) {
      const before = this.tables.get(name) || null
      if (JSON.stringify(before && { c: before.cols, r: before.rows }) === JSON.stringify(after && { c: after.cols, r: after.rows })) continue
      const bm = new Map((before ? before.rows : []).map(r => [String(r.id), r])), am = new Map((after ? after.rows : []).map(r => [String(r.id), r]))
      const added = [...am.keys()].filter(k => !bm.has(k)), removed = [...bm.keys()].filter(k => !am.has(k)), changed = [...am.keys()].filter(k => bm.has(k) && JSON.stringify(bm.get(k)) !== JSON.stringify(am.get(k)))
      out.push({ name, before, after, added, removed, changed, created: !before, dropped: !after, conflict: (ov.tbase || {})[name] !== undefined && (ov.tbase[name] || null) !== (before ? hashStr(JSON.stringify(before.rows)) : null) })
    }
    return out
  }

  // ---- session log, in chunks of at most ~180 KB ----
  log(e) {
    e.t = now(); e.i = this.events.length
    const last = this.events[this.events.length - 1]
    if (e.kind === 'write' && last && last.kind === 'write' && last.who === e.who && last.who === 'you' && last.path === e.path && last.ws === e.ws && e.t - (last.t2 || last.t) < 20000 && !e.note) {
      last.after = e.after; last.t2 = e.t; this.saveChunk(); this.ev.emit('events'); return last
    }
    let c = this.chunks[this.chunks.length - 1]
    const size = JSON.stringify(e).length
    if (!c || c.size + size > 180000) { c = { id: 'c' + String(this.chunks.length).padStart(4, '0'), start: this.events.length, size: 0 }; this.chunks.push(c) }
    c.size += size; this.events.push(e); this.saveChunk(); this.ev.emit('events', e)
    return e
  }
  saveChunk() {
    const c = this.chunks[this.chunks.length - 1]; if (!c) return
    const next = this.chunks.length > 0 ? this.events.length : 0
    Store.save(this.key('log/' + c.id), { start: c.start, events: this.events.slice(c.start, next) })
  }
  // files of main as they were just after event i (-1: before anything)
  stateAt(i) {
    const st = new Map()
    for (const e of this.events) {
      if (e.i > i) break
      if (e.kind === 'init') { st.clear(); for (const [p, t] of Object.entries(e.files || {})) st.set(p, t) }
      else if (e.ws === 'main' && e.kind === 'write') st.set(e.path, e.after)
      else if (e.ws === 'main' && e.kind === 'remove') st.delete(e.path)
    }
    return st
  }
  // stateAt for the playhead: past states never change (except the last event, which a coalesced edit can update)
  stateAtCached(i) {
    this._st = this._st || new Map()
    if (i < this.events.length - 1 && this._st.has(i)) return this._st.get(i)
    const st = this.stateAt(i); if (i < this.events.length - 1) { this._st.set(i, st); if (this._st.size > 40) this._st.delete(this._st.keys().next().value) }
    return st
  }
  // ---- blame: for each line of a file, the event that wrote it ----
  // the versions a workspace's copy came through: main's; a proposal's starts from main's at its first write
  lineage(path, ws = 'main', upto = Infinity) {
    const all = this.versions(path).filter(v => v.i <= upto)
    if (ws === 'main') return all.filter(v => v.ws === 'main')
    const own = all.filter(v => v.ws === ws), first = own.length ? own[0].i : Infinity
    return [...all.filter(v => v.ws === 'main' && v.i < first), ...own]
  }
  blame(path, ws = 'main', upto = Infinity) {
    let attrib = [], prev = null
    for (const v of this.lineage(path, ws, upto)) {
      if (v.text === null) { attrib = []; prev = null; continue }
      const e = this.events[v.i] || {}
      // a write that accepted a proposal: lines keep the proposal's own authors
      let from = null
      if (e.via) { const pb = this.blame(path, e.via, v.i), pt = this.lineage(path, e.via, v.i).filter(x => x.text !== null).slice(-1)[0]; if (pt && pt.text === v.text) from = pb }
      const next = []
      for (const d of diffLines(prev ?? '', v.text)) {
        if (d.op === ' ') next.push(attrib[d.a - 1] ?? v.i)
        else if (d.op === '+') next.push(from ? from[d.b - 1] ?? v.i : v.i)
      }
      attrib = next; prev = v.text
    }
    return attrib
  }
  // where a change reached main: itself, or the write that accepted its proposal (null if it never did)
  landed(i) {
    const e = this.events[i]; if (!e) return null
    if (e.ws === 'main' || e.kind === 'init') return i
    const a = this.events.find(x => x.i > i && x.via === e.ws && x.path === e.path && x.kind === 'write'); return a ? a.i : null
  }
  // why an event happened: the person's request in that thread, Claude's reply, the marks in between
  why(i) {
    const e = this.events[i]; if (!e) return null
    const out = { i, t: e.t2 || e.t, who: e.who, kind: e.kind, ws: e.ws, note: e.note || e.label || '', thread: e.thread || null, via: e.via || null }
    let th = e.thread && this.threads.get(e.thread)
    if (e.via) { const ov = this.overlays.get(e.via); if (ov) { out.proposal = ov.title; if (!th && ov.thread) th = this.threads.get(ov.thread) } }
    if (th) {
      out.threadTitle = th.title; out.role = th.role || null
      let j = i; while (j >= 0 && !(this.events[j].kind === 'msg' && this.events[j].thread === th.id)) j--
      const msg = j >= 0 ? this.events[j] : null
      // a subagent's work answers its parent's request
      if (!msg && th.parent) { const d = this.events.slice(0, i + 1).reverse().find(x => x.kind === 'delegate' && x.child === th.id); if (d) { out.request = d.note; out.delegatedBy = d.thread } }
      if (msg) out.request = msg.note
      let k = i; while (k < this.events.length && !(this.events[k].kind === 'turn' && this.events[k].thread === th.id)) k++
      const turn = this.events[k]; if (turn) out.reply = (turn.note || '').replace(/^#+\s*/, '')
      const lo = msg ? msg.i : Math.max(0, i - 200), hi = turn ? turn.i : i + 200
      out.marks = this.events.filter(x => x.kind === 'mark' && x.thread === th.id && x.i >= lo && x.i <= hi).map(x => ({ i: x.i, kind: x.mk, label: x.label, why: x.note || undefined }))
    }
    return out
  }
  // what changed in main since event i
  since(i) {
    const then = this.stateAt(i), out = []
    for (const p of new Set([...then.keys(), ...this.files.keys()])) {
      const a = then.has(p) ? then.get(p) : null, b = this.files.has(p) ? this.files.get(p) : null
      if (a !== b) out.push({ path: p, before: a, after: b })
    }
    return out.sort((x, y) => x.path.localeCompare(y.path))
  }
  restore(i, who = 'you') {
    const ch = this.since(i), label = this.events[i] ? (this.events[i].label || this.events[i].note || 'event ' + i) : 'start'
    for (const c of ch) c.before === null ? this.remove(c.path, { who, note: 'restore to ' + label }) : this.write(c.path, c.before, { who, note: 'restore to ' + label })
    return ch.length
  }
  // every saved version of a file: the template/import snapshot, then each write or removal, in any workspace
  versions(path) {
    const out = []
    for (const e of this.events) {
      if (e.kind === 'init' && e.files && Object.prototype.hasOwnProperty.call(e.files, path)) out.push({ i: e.i, t: e.t, who: e.who, kind: 'init', text: e.files[path], note: e.note, ws: 'main' })
      else if (e.path === path && (e.kind === 'write' || e.kind === 'remove')) out.push({ i: e.i, t: e.t2 || e.t, who: e.who, kind: e.kind, text: e.kind === 'remove' ? null : (e.after ?? null), note: e.note, ws: e.ws, thread: e.thread })
    }
    return out
  }
  mark({ label, note, by = 'you', thread, msg, kind }) {
    const mk = kind || (by === 'agent' ? 'milestone' : by === 'ide' ? 'auto' : 'bookmark')
    const e = this.log({ kind: 'mark', mk, ws: 'main', who: by, label: String(label || 'Mark').slice(0, 80), note, thread, msg })
    this.ev.emit('marks'); return e
  }
  marks() { return this.events.filter(e => e.kind === 'mark') }

  // ---- threads ----
  newThread(title) {
    const t = { id: 'th' + uid(), title: title || 'Thread ' + (this.threads.size + 1), created: now(), msgs: [], mode: 'auto', target: 'overlay', tier: 'default' }
    this.threads.set(t.id, t); this.saveThread(t); this.ev.emit('threads'); return t
  }
  saveThread(t) {
    let copy = clone(t)
    while (JSON.stringify(copy).length > 200000 && copy.msgs.some(m => m.steps && m.steps.length)) {
      const m = copy.msgs.find(m => m.steps && m.steps.length); m.steps = m.steps.map(s => ({ ...s, code: trunc(s.code, 300), out: trunc(s.out || '', 200) })); if (m.steps.every(s => s.code.length < 400)) m.steps = []
    }
    Store.save(this.key('threads/' + t.id), copy)
  }
  dropThread(id) { this.threads.delete(id); Store.remove(this.key('threads/' + id)); this.ev.emit('threads') }

  // ---- boards and frames (meta) ----
  board() { return this.meta.boards[0] }
  frame(id) { return this.board().frames.find(f => f.id === id) }
  addFrame(f) {
    const b = this.board(), right = b.frames.reduce((m, x) => Math.max(m, x.x + x.w), 0)
    const fr = { id: 'f' + uid(), route: f.route || 'index.html', w: f.w || 375, h: f.h || 720, x: f.x ?? (b.frames.length ? right + 60 : 0), y: f.y ?? 0 }
    b.frames.push(fr); this.saveMeta(); this.ev.emit('frames'); return fr
  }
  removeFrame(id) { const b = this.board(); b.frames = b.frames.filter(f => f.id !== id); this.saveMeta(); this.ev.emit('frames') }

  export() {
    return { sitebench: 1, title: this.meta.title, template: this.meta.template, created: this.meta.created,
      files: Object.fromEntries(this.files), tables: Object.fromEntries([...this.tables].map(([k, t]) => [k, t])),
      boards: this.meta.boards, pins: this.meta.pins, store: this.meta.store,
      overlays: [...this.overlays.values()], threads: [...this.threads.values()], events: this.events }
  }
}

// ---------- projects: an index of repositories in this artifact ----------
const Projects = {
  index: { projects: [], current: null }, ev: emitter(), cur: null,
  async load() { this.index = (await Store.get('index')) || { projects: [], current: null }; return this.index },
  saveIndex: debounce(function () { Store.save('index', Projects.index) }, 400),
  touch(p) {
    const e = this.index.projects.find(x => x.id === p.id)
    if (e) { e.title = p.meta.title; e.updated = p.meta.updated; e.files = p.files.size; this.saveIndex(); this.ev.emit('index') }
  },
  async create({ template = 'blank', title, data } = {}) {
    const tpl = TEMPLATES.find(t => t.id === template) || TEMPLATES[2]
    const id = uid()
    const src = data || { files: tpl.files, tables: tpl.tables, boards: null }
    const meta = { id, title: title || (data && data.title) || tpl.name, template: data ? (data.template || 'import') : tpl.id, created: now(), updated: now(), boards: null, pins: [], store: {}, v: 1 }
    let x = 0
    meta.boards = src.boards ? clone(src.boards) : [{ id: 'b1', name: 'Board', frames: tpl.frames.map(f => { const fr = { id: 'f' + uid(), route: f.route, w: f.w, h: f.h, x, y: 0 }; x += f.w + 60; return fr }) }]
    if (data) { meta.pins = clone(data.pins || []); meta.store = clone(data.store || {}) }
    const p = new Project(meta)
    for (const [path, text] of Object.entries(src.files || {})) { p.files.set(path, text); Store.save(p.key('files/' + encKey(path)), { path, text }) }
    for (const [name, t] of Object.entries(src.tables || {})) { const tt = { name, cols: [...t.cols], rows: clone(t.rows), seq: Math.max(0, ...t.rows.map(r => +r.id || 0)) }; p.tables.set(name, tt); Store.save(p.key('tables/' + encKey(name)), tt) }
    if (data && data.events && data.events.length) {
      for (const e of data.events) { const c = clone(e); c.i = p.events.length; p.events.push(c) }
      p.chunks = []; let c = null
      p.events.forEach((e, i) => { const s = JSON.stringify(e).length; if (!c || c.size + s > 180000) { c = { id: 'c' + String(p.chunks.length).padStart(4, '0'), start: i, size: 0 }; p.chunks.push(c) } c.size += s })
      p.chunks.forEach((c, k) => Store.save(p.key('log/' + c.id), { start: c.start, events: p.events.slice(c.start, p.chunks[k + 1] ? p.chunks[k + 1].start : p.events.length) }))
      p.log({ kind: 'note', ws: 'main', who: 'you', note: 'imported as "' + meta.title + '"' })
    } else p.log({ kind: 'init', ws: 'main', who: 'you', note: 'new project from ' + (data ? 'import' : tpl.name), files: Object.fromEntries(p.files) })
    for (const ov of (data && data.overlays) || []) { p.overlays.set(ov.id, clone(ov)); p.saveOverlay(ov) }
    for (const th of (data && data.threads) || []) { p.threads.set(th.id, clone(th)); p.saveThread(th) }
    Store.save(p.key(), meta)
    this.index.projects.unshift({ id, title: meta.title, template: meta.template, updated: meta.updated, created: meta.created, files: p.files.size })
    this.saveIndex(); this.ev.emit('index')
    return p
  },
  async open(id) {
    const meta = await Store.get('p_' + id)
    if (!meta) throw new Error('project not found')
    const p = new Project(meta)
    const [files, ovs, tables, threads, logs] = await Promise.all(['files', 'ov', 'tables', 'threads', 'log'].map(c => Store.list(p.key(c))))
    for (const { data } of files) if (data && typeof data.path === 'string') p.files.set(data.path, data.text || '')
    for (const { data } of ovs) if (data && data.id) p.overlays.set(data.id, data)
    for (const { data } of tables) if (data && data.name) p.tables.set(data.name, data)
    for (const { data } of threads) if (data && data.id) p.threads.set(data.id, data)
    for (const { id: cid, data } of logs.sort((a, b) => a.id < b.id ? -1 : 1)) {
      const start = p.events.length
      for (const e of (data && data.events) || []) { e.i = p.events.length; p.events.push(e) }
      p.chunks.push({ id: cid, start, size: JSON.stringify(data || {}).length })
    }
    meta.boards = meta.boards && meta.boards.length ? meta.boards : [{ id: 'b1', name: 'Board', frames: [] }]
    meta.pins = meta.pins || []; meta.store = meta.store || {}
    return p
  },
  async remove(id) {
    const key = 'p_' + id
    for (const c of ['files', 'ov', 'tables', 'threads', 'log']) for (const d of await Store.list(key + '/' + c)) Store.remove(key + '/' + c + '/' + d.id)
    Store.remove(key)
    this.index.projects = this.index.projects.filter(p => p.id !== id)
    if (this.index.current === id) this.index.current = null
    this.saveIndex(); this.ev.emit('index')
  }
}

// ===== 05-site.js =====
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

// ===== 05b-snapshots.js =====
// ---------- layout diffs: what an edit did to the page, as text ----------
const STYLE_PARTS = ['color', 'background', 'font-size', 'font-weight']
function layoutDiff(A, B) {
  const am = new Map((A && A.items || []).map(i => [i.k, i])), bm = new Map((B && B.items || []).map(i => [i.k, i]))
  const out = []
  for (const [k, b] of bm) {
    const a = am.get(k)
    if (!a) { out.push({ k, kind: 'added', b }); continue }
    const d = [], [ax, ay, aw, ah] = a.b, [bx, by, bw, bh] = b.b
    if (Math.abs(aw - bw) > 1 || Math.abs(ah - bh) > 1) d.push({ what: 'size', from: aw + '×' + ah, to: bw + '×' + bh })
    if (Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1) d.push({ what: 'move', dx: bx - ax, dy: by - ay })
    if ((a.x || '') !== (b.x || '')) d.push({ what: 'text', from: a.x || '', to: b.x || '' })
    if (a.st !== b.st) { const sa = (a.st || '').split('|'), sb = (b.st || '').split('|'); STYLE_PARTS.forEach((p, i) => { if (sa[i] !== sb[i]) d.push({ what: p, from: sa[i], to: sb[i] }) }) }
    if (!!a.hid !== !!b.hid) d.push({ what: 'visibility', from: a.hid ? 'hidden' : 'visible', to: b.hid ? 'hidden' : 'visible' })
    if (d.length) out.push({ k, kind: 'changed', a, b, d })
  }
  for (const [k, a] of am) if (!bm.has(k)) out.push({ k, kind: 'removed', a })
  // a move that only follows the parent's move is noise; so is everything inside an added or removed element
  const byKey = new Map(out.map(c => [c.k, c]))
  const moveOf = c => c && c.kind === 'changed' && c.d.find(x => x.what === 'move')
  const keep = out.filter(c => {
    const it = c.b || c.a, par = byKey.get(it.p)
    if (par && (par.kind === 'added' || par.kind === 'removed') && par.kind === c.kind) return false
    if (c.kind === 'changed' && c.d.length === 1 && c.d[0].what === 'move') { const pm = moveOf(par); if (pm && pm.dx === c.d[0].dx && pm.dy === c.d[0].dy) return false }
    return true
  })
  return { changes: keep, heightFrom: A ? A.h : 0, heightTo: B ? B.h : 0 }
}
function diffSummary(diff, max = 12) {
  const lines = [], label = it => it.t + (it.x ? ' "' + it.x.slice(0, 30) + '"' : '') + (it.s ? ' @' + it.s : '')
  const base = t => t.replace(/#[^.]*/, '')
  const fmt = x => x.what === 'move' ? 'moved ' + (x.dx >= 0 ? '+' : '') + x.dx + ',' + (x.dy >= 0 ? '+' : '') + x.dy : x.what === 'text' ? 'text "' + x.from.slice(0, 24) + '" → "' + x.to.slice(0, 24) + '"' : x.what + ' ' + x.from + ' → ' + x.to
  if (diff.heightFrom && diff.heightTo && Math.abs(diff.heightFrom - diff.heightTo) > 1) lines.push('page height ' + diff.heightFrom + ' → ' + diff.heightTo)
  // the same change on elements of the same kind reads as one line: "6 × li: size 331×73 → 335×73"
  const groups = new Map()
  for (const c of diff.changes) {
    const it = c.b || c.a
    const what = c.kind === 'added' ? 'added ' + it.b[2] + '×' + it.b[3] : c.kind === 'removed' ? 'removed' : c.d.map(fmt).join('; ')
    const groupable = !(c.kind === 'changed' && c.d.some(x => x.what === 'text'))
    const k = groupable ? base(it.t) + '|' + what : c.k
    if (!groups.has(k)) groups.set(k, { what, items: [] }); groups.get(k).items.push(it)
  }
  for (const g of groups.values()) {
    const it = g.items[0], n = g.items.length
    if (n > 1) lines.push(n + ' × ' + base(it.t) + ': ' + g.what)
    else if (g.what.startsWith('added ')) lines.push('+ ' + label(it) + ' ' + g.what.slice(6))
    else if (g.what === 'removed') lines.push('− ' + label(it))
    else lines.push(label(it) + ': ' + g.what)
  }
  return lines.length > max ? [...lines.slice(0, max), '… ' + (lines.length - max) + ' more'] : lines
}
// boxes to outline on frozen frames: red where something was (removed, or before a change), green where it is now
function diffBoxes(diff) {
  // a container that only grew or moved because something inside it changed adds no information: outline what changed inside
  const parent = new Map()
  for (const c of diff.changes) for (const it of [c.a, c.b]) if (it) parent.set(it.k, it.p)
  const changedKeys = new Set(diff.changes.map(c => c.k)), hasChangedInside = new Set()
  for (const k of changedKeys) { let p = parent.get(k), guard = 0; while (p && guard++ < 60) { hasChangedInside.add(p); p = parent.get(p) || (p.includes('>') ? p.slice(0, p.lastIndexOf('>')) : null) } }
  const before = [], after = []
  for (const c of diff.changes) {
    if (c.kind === 'changed' && hasChangedInside.has(c.k) && c.d.every(x => x.what === 'size' || x.what === 'move')) continue
    if (c.a) before.push({ b: c.a.b, c: c.kind === 'removed' ? 'del' : 'chg' })
    if (c.b) after.push({ b: c.b.b, c: c.kind === 'added' ? 'add' : 'chg' })
  }
  return { before: before.slice(0, 120), after: after.slice(0, 120) }
}

// ---------- snapshots: frozen pages with their layout, stored per project; stylesheets stored once by hash ----------
const Snaps = {
  docs: new Map(), css: new Map(),
  list(P) { return P.meta.snaps || (P.meta.snaps = []) },
  async capture(fh) {
    const raw = await fh.call('snapshot', [], 6000), css = {}
    for (const [file, text] of Object.entries(raw.css || {})) { const k = hashStr(text) + text.length.toString(36); css[file] = k; if (!this.css.has(k)) this.css.set(k, text) }
    return { ...raw, cssRef: css, route: fh.route, w: fh.w, h: fh.h, ws: fh.ws, fixture: fh.fixture || null }
  },
  // take and keep one; returns its meta
  async take(P, fh, { label, event, by = 'you', note } = {}) {
    const s = await this.capture(fh)
    const last = this.list(P).filter(x => x.route === s.route && x.w === s.w && x.ws === s.ws).slice(-1)[0], hash = hashStr(s.html)
    if (last && last.hash === hash && !label) { if (event != null) this.attach(P, last.id, event); return last }
    for (const [file, k] of Object.entries(s.cssRef)) if (!this.savedCss(P, k)) { Store.save(P.key('css/' + k), { file, text: this.css.get(k) }); (P.meta.cssKeys = P.meta.cssKeys || []).push(k) }
    const id = 'sn' + uid(), doc = { id, html: s.html, layout: s.layout, scroll: s.scroll, cssRef: s.cssRef }
    if (JSON.stringify(doc).length > 240000) { doc.layout = { w: s.layout.w, h: s.layout.h, items: s.layout.items.slice(0, 600) } }
    if (JSON.stringify(doc).length > 250000) { toast('Snapshot of ' + s.route + ' is too large to keep'); return null }
    Store.save(P.key('snaps/' + id), doc); this.docs.set(id, doc)
    const meta = { id, t: now(), route: s.route, w: s.w, h: s.h, ws: s.ws, fixture: s.fixture, label: label || null, note: note || undefined, by, hash, events: event != null ? [event] : [] }
    this.list(P).push(meta); this.prune(P); P.saveMeta()
    return meta
  },
  savedCss(P, k) { return (P.meta.cssKeys || []).includes(k) },
  attach(P, id, event) { const m = this.list(P).find(x => x.id === id); if (m && !m.events.includes(event)) { m.events.push(event); P.saveMeta() } },
  // keep the newest 80, plus any a mark points at
  prune(P) {
    const list = this.list(P), marked = new Set(P.marks().map(e => e.i))
    while (list.length > 80) { const i = list.findIndex(m => !m.events.some(e => marked.has(e))); if (i < 0) break; const [gone] = list.splice(i, 1); Store.remove(P.key('snaps/' + gone.id)); this.docs.delete(gone.id) }
  },
  async load(P, id) {
    if (this.docs.has(id)) return this.docs.get(id)
    const d = await Store.get(P.key('snaps/' + id)); if (d) this.docs.set(id, d); return d
  },
  async cssText(P, k) { if (this.css.has(k)) return this.css.get(k); const d = await Store.get(P.key('css/' + k)); const t = d ? d.text : ''; this.css.set(k, t); return t },
  // a frozen page: its own scripts are gone; ours restores scroll and outlines boxes
  async render(P, doc, { boxes = [], scroll } = {}) {
    let html = doc.html
    for (const [file, k] of Object.entries(doc.cssRef || {})) { const t = this.css.has(k) ? this.css.get(k) : await this.cssText(P, k); html = html.split('/*@css ' + file + '*/').join(t.replace(/<\/style/gi, '<\\/style')) }
    const sc = scroll || doc.scroll || [0, 0]
    const script = '<script>(' + function (sc, boxes) {
      const draw = () => { scrollTo(sc[0], sc[1]); for (const x of boxes) { const d = document.createElement('div'); const col = x.c === 'add' ? '30,138,90' : x.c === 'del' ? '226,0,26' : '31,111,196'; d.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483647;box-sizing:border-box;left:' + x.b[0] + 'px;top:' + x.b[1] + 'px;width:' + Math.max(2, x.b[2]) + 'px;height:' + Math.max(2, x.b[3]) + 'px;outline:2px solid rgb(' + col + ');background:rgba(' + col + ',.10)'; document.documentElement.appendChild(d) } }
      document.readyState === 'complete' ? draw() : addEventListener('load', draw)
    }.toString() + ')(' + JSON.stringify(sc) + ',' + JSON.stringify(boxes).replace(/</g, '\\u003c') + ')</script>'
    return html.replace(/<\/body>/i, script + '</body>')
  },
  // an element showing a frozen page at a scale
  async frozen(P, doc, meta, { scale = 0.25, boxes, title, full } = {}) {
    // full: the whole page from the top, not just the viewport where it was scrolled
    const hh = full ? clamp(Math.max(meta.h, (doc.layout && doc.layout.h) || 0), 200, 3000) : meta.h
    const ifr = h('iframe', { sandbox: 'allow-scripts', title: title || meta.route, style: { width: meta.w + 'px', height: hh + 'px', border: 0, transform: 'scale(' + scale + ')', transformOrigin: '0 0', background: 'transparent', pointerEvents: scale < 0.9 ? 'none' : 'auto' } })
    ifr.srcdoc = await this.render(P, doc, { boxes, scroll: full ? [0, 0] : undefined })
    return h('div', { style: { width: meta.w * scale + 'px', height: hh * scale + 'px', overflow: 'hidden', outline: '1px solid var(--hair)', flex: 'none' } }, ifr)
  }
}
// snapshot every board frame as the given workspace shows it (visible frames, or headless ones)
async function snapshotBoard(P, ws, opts = {}) {
  const out = []
  for (const f of P.board().frames) {
    try {
      let fh = App.hostFor(f.id)
      if (!fh || !fh.shown || fh.ws !== ws || fh.fixture !== (f.fixture || null)) fh = await Headless.get(P, fh ? fh.route : f.route, ws, f.w, f.h, f.fixture || null)
      if (!fh.ready) await fh.readyP
      const m = await Snaps.take(P, fh, opts); if (m) out.push(m)
    } catch (e) { /* a frame that will not snapshot is skipped */ }
  }
  return out
}
// layout of a board frame in a workspace, settled
// (headless: true renders off-screen in a pooled frame even when the canvas shows this workspace, so two sides compare alike)
async function layoutIn(P, f, ws, { headless } = {}) {
  let fh = headless ? null : App.hostFor(f.id)
  if (!fh || !fh.shown || fh.ws !== ws || fh.fixture !== (f.fixture || null)) fh = await Headless.get(P, f.route, ws, f.w, f.h, f.fixture || null)
  if (!fh.ready) await fh.readyP
  return { fh, layout: await fh.call('layout', [], 5000) }
}
// a modal with two frozen frames side by side and the differences outlined
async function compareModal(P, title, left, right, diff) {
  const boxes = diffBoxes(diff), scale = Math.min(1, 400 / Math.max(left.meta.w, 1))
  const lines = diffSummary(diff, 40)
  const body = [
    h('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', overflow: 'auto', maxHeight: '62vh' } },
      h('div', h('div.note', left.label), await Snaps.frozen(P, left.doc, left.meta, { scale, boxes: boxes.before, full: true })),
      h('div', h('div.note', right.label), await Snaps.frozen(P, right.doc, right.meta, { scale, boxes: boxes.after, full: true }))),
    h('pre.mono', { style: { whiteSpace: 'pre-wrap', fontSize: '11.5px', margin: 0 } }, lines.length ? lines.join('\n') : 'No layout changes.')]
  modal({ title, body, wide: true, actions: [{ label: 'Close' }] })
}

// ===== 05c-scenarios.js =====
// ---------- fixtures and scenarios ----------
// A fixture (fixtures/<name>.json) is a fixed set of rows, store values and a clock that a frame or a scenario
// runs against instead of the live data: { description, tables: { menu: [rows] | "live" }, store: {}, clock: "2026-05-01T08:30" }.
// A scenario (scenarios/<name>.json) is a list of steps run in a frame of its own, against a copy of the data:
// { description, page, size: [w, h], fixture, steps: [ { click }, { type, text }, { expect, text|count|visible|value }, … ] }
const SCEN_DIR = 'scenarios/', FIX_DIR = 'fixtures/'
const STEP_KINDS = ['go', 'click', 'type', 'waitFor', 'wait', 'expect', 'data', 'store', 'snapshot']

function fixtureList(P, ws) {
  return P.list(ws).filter(p => p.startsWith(FIX_DIR) && p.endsWith('.json')).map(path => {
    const name = path.slice(FIX_DIR.length, -5); let spec = null, error = null
    try { spec = JSON.parse(P.read(path, ws)) } catch (e) { error = e.message }
    return { name, path, spec, error, description: spec && spec.description || '', tables: spec && spec.tables ? Object.keys(spec.tables) : [], clock: spec && spec.clock || null }
  })
}
function checkFixture(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'a fixture is an object: { tables: { name: [rows] }, store?: {}, clock?: "ISO time" }'
  for (const [n, v] of Object.entries(spec.tables || {})) if (v !== 'live' && !Array.isArray(v) && !(v && Array.isArray(v.rows))) return 'tables.' + n + ' must be a list of rows (or "live" to use the live table)'
  if (spec.clock && isNaN(new Date(spec.clock).getTime())) return 'clock must be a date and time, like "2026-05-01T08:30"'
  return null
}
function stepLabel(s) {
  if (!s || typeof s !== 'object') return String(s)
  if (s.go) return 'go ' + s.go
  if (s.click) return 'click ' + s.click
  if (s.type) return 'type "' + String(s.text ?? '').slice(0, 30) + '" into ' + s.type
  if (s.waitFor) return 'wait for ' + s.waitFor
  if (s.wait != null) return 'wait ' + s.wait + ' ms'
  if (s.expect) return 'expect ' + s.expect + (s.count != null ? ' count ' + s.count : '') + (s.text != null ? ' has "' + String(s.text).slice(0, 30) + '"' : '') + (s.value != null ? ' value "' + s.value + '"' : '') + (s.visible === false ? ' hidden' : '')
  if (s.data) return 'data ' + s.data + (s.where ? ' ' + JSON.stringify(s.where) : '') + (s.count != null ? ' count ' + s.count : '')
  if (s.store) return 'store ' + s.store + (s.count != null ? ' count ' + s.count : s.equals !== undefined ? ' = ' + JSON.stringify(s.equals) : '')
  if (s.snapshot != null) return 'snapshot' + (s.snapshot ? ' "' + s.snapshot + '"' : '')
  return JSON.stringify(s)
}
function checkScenario(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'a scenario is an object: { page, steps: [...] }'
  if (!Array.isArray(spec.steps) || !spec.steps.length) return 'steps must be a non-empty list'
  for (const [i, s] of spec.steps.entries()) {
    const k = s && typeof s === 'object' ? STEP_KINDS.find(k => k in s) : null
    if (!k) return 'step ' + (i + 1) + ' (' + JSON.stringify(s) + ') has none of: ' + STEP_KINDS.join(', ')
    if (k === 'type' && s.text == null) return 'step ' + (i + 1) + ': type needs text'
    if (k === 'expect' && typeof s.expect !== 'string') return 'step ' + (i + 1) + ': expect is a selector'
  }
  if (spec.size && (!Array.isArray(spec.size) || spec.size.length !== 2)) return 'size is [width, height]'
  return null
}
function scenarioList(P, ws) {
  return P.list(ws).filter(p => p.startsWith(SCEN_DIR) && p.endsWith('.json')).map(path => {
    const name = path.slice(SCEN_DIR.length, -5); let spec = null, error = null
    try { spec = JSON.parse(P.read(path, ws)); error = checkScenario(spec) } catch (e) { error = 'not valid JSON: ' + e.message }
    return { name, path, spec, error, last: lastRun(P, name, ws) }
  })
}
const lastRun = (P, name, ws) => (P.meta.runs || {})[ws + '|' + name] || null

// run one scenario: a fresh isolated frame, the steps in order, a snapshot where it fails (and where asked)
async function runScenario(P, spec, { ws = 'main', name = 'unsaved', onStep, signal, who = 'you', thread, keep = true } = {}) {
  const bad = checkScenario(spec); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
  const [w, hgt] = spec.size || [375, 720], t0 = now(), res = { name, ws, ok: true, steps: [], snaps: [], page: spec.page || 'index.html', fixture: spec.fixture || null, t: t0 }
  const fh = await Headless.fresh(P, res.page, ws, w, hgt, { fixture: spec.fixture })
  const timeout = s => clamp(+s.timeout || +spec.timeout || 2000, 100, 15000)
  const poll = async (s, test) => {             // checks retry until they pass or time out: pages render after data arrives
    const end = now() + timeout(s); let last
    while (true) { last = await test(); if (last.ok) return last; if (now() > end) return last; await sleep(60) }
  }
  const afterAction = async () => { await sleep(50); if (fh.loading) await fh.readyP; try { await fh.call('settle', [800], 2000) } catch { } }
  const snap = async label => { try { const m = await Snaps.take(P, fh, { label: label || null, by: who, note: 'scenario ' + name }); if (m) res.snaps.push({ id: m.id, label: label || '', route: fh.route }) } catch { } }
  try {
    for (const [i, s] of spec.steps.entries()) {
      if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { kind: 'cancelled' })
      const st = { i, label: stepLabel(s), ok: true }, ts = now()
      if (onStep) onStep({ ...st, running: true })
      try {
        if (s.go) { fh.navigate(s.go); await fh.readyP; await afterAction() }
        else if (s.click) { await poll(s, async () => ({ ok: (await fh.call('count', [s.click])) > 0 })); await fh.call('click', [s.click]); await afterAction() }
        else if (s.type) { await poll(s, async () => ({ ok: (await fh.call('count', [s.type])) > 0 })); await fh.call('type', [s.type, String(s.text)]); await afterAction() }
        else if (s.waitFor) await fh.call('waitFor', [s.waitFor, timeout(s)], timeout(s) + 1000)
        else if (s.wait != null) await sleep(clamp(+s.wait || 0, 0, 10000))
        else if (s.expect) {
          const r = await poll(s, async () => {
            const n = await fh.call('count', [s.expect])
            if (s.count != null) return { ok: n === +s.count, got: 'count ' + n }
            if (s.visible === false) { if (!n) return { ok: true }; const [el] = await fh.call('all', [s.expect, 1]); return { ok: !el.rect.w || !el.rect.h, got: 'visible ' + el.rect.w + '×' + el.rect.h } }
            if (!n) return { ok: false, got: 'nothing matches' }
            const els = await fh.call('all', [s.expect, 20])
            if (s.text != null) { const want = String(s.text).toLowerCase(); const hit = els.find(e => e.text.toLowerCase().includes(want)); return { ok: !!hit, got: 'text "' + els.map(e => e.text).join(' | ').slice(0, 120) + '"' } }
            if (s.value != null) { const v = (els[0].attrs || {}).value; return { ok: String(v) === String(s.value), got: 'value "' + v + '"' } }
            const vis = els.find(e => e.rect.w && e.rect.h); return { ok: !!vis, got: 'not visible' }
          })
          if (!r.ok) throw Object.assign(new Error('expected ' + stepLabel(s).slice(7) + ', got ' + r.got), { kind: 'verify' })
        }
        else if (s.data) {
          const r = await poll(s, async () => {
            const t = fh.fx && fh.fx.tables[s.data]; if (!t) return { ok: false, got: 'no table ' + s.data }
            const rows = s.where ? t.rows.filter(x => Object.entries(s.where).every(([k, v]) => x[k] === v)) : t.rows
            if (s.count != null) return { ok: rows.length === +s.count, got: rows.length + ' rows' }
            return { ok: rows.length > 0, got: '0 rows' }
          })
          if (!r.ok) throw Object.assign(new Error('expected ' + stepLabel(s) + ', got ' + r.got), { kind: 'verify' })
        }
        else if (s.store) {
          const r = await poll(s, async () => {
            const v = fh.fx ? fh.fx.store[s.store] : undefined
            if (s.count != null) { const n = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0; return { ok: n === +s.count, got: n + ' entries' } }
            if (s.equals !== undefined) return { ok: JSON.stringify(v) === JSON.stringify(s.equals), got: JSON.stringify(v) }
            return { ok: v !== undefined, got: 'nothing' }
          })
          if (!r.ok) throw Object.assign(new Error('expected ' + stepLabel(s) + ', got ' + r.got), { kind: 'verify' })
        }
        else if (s.snapshot != null) await snap(s.snapshot || 'step ' + (i + 1))
      } catch (e) {
        st.ok = false; st.error = e.message.replace(/ in frame [^ ]+$/, ''); st.kind = e.kind || 'error'
      }
      st.ms = now() - ts; st.route = fh.route
      const errs = fh.logs.filter(l => l.level === 'error' && l.t >= ts && !l.keep)
      if (errs.length) st.errors = errs.map(l => l.text).slice(0, 3)
      res.steps.push(st); if (onStep) onStep(st)
      if (!st.ok) { res.ok = false; res.failedAt = i; await snap(null); break }
    }
    if (res.ok && keep && !res.snaps.length) await snap(null)
  } finally { fh.dispose() }
  res.ms = now() - t0
  if (keep && name !== 'unsaved') {
    P.meta.runs = P.meta.runs || {}
    P.meta.runs[ws + '|' + name] = { t: res.t, ok: res.ok, ms: res.ms, failedAt: res.failedAt, steps: res.steps.map(s => ({ label: s.label, ok: s.ok, error: s.error, ms: s.ms })), snaps: res.snaps }
    P.saveMeta()
  }
  P.log({ kind: 'scenario', who, ws, thread, name, ok: res.ok, note: name + (res.ok ? ' passed (' + plural(res.steps.length, 'step') + ')' : ' failed at step ' + (res.failedAt + 1) + ': ' + res.steps[res.failedAt].error) })
  App.ev.emit('scenarios', name)
  return res
}
async function runAllScenarios(P, opts = {}) {
  const ws = opts.ws || 'main', out = []
  for (const s of scenarioList(P, ws)) {
    if (opts.signal && opts.signal.aborted) break
    if (s.error) { out.push({ name: s.name, ok: false, error: s.error }); continue }
    const r = await runScenario(P, s.spec, { ...opts, ws, name: s.name })
    out.push({ name: s.name, ok: r.ok, failedAt: r.failedAt, error: r.ok ? undefined : r.steps[r.failedAt].error, ms: r.ms })
  }
  return out
}
const scenarioSummary = r => r.ok ? '✓ ' + r.name + ' (' + plural(r.steps.length, 'step') + ', ' + r.ms + ' ms)' : '✗ ' + r.name + ' at step ' + (r.failedAt + 1) + ' (' + r.steps[r.failedAt].label + '): ' + r.steps[r.failedAt].error

// ---------- recording: interact with a frame, get a scenario ----------
Object.assign(FrameHost.prototype, {
  async startRecording(fr) {
    this.rec = { steps: [], page: this.route, size: [this.w, this.h], fixture: this.fixture || null, fid: fr ? fr.id : null, t: now() }
    this.isolate = true; this.fx = null
    await this.load({ keepState: false }); this.ev.emit('rec', this.rec)
  },
  recStep(step) {
    const r = this.rec; if (!r || !step) return
    const last = r.steps[r.steps.length - 1]
    if (step.type && last && last.type === step.type) last.text = step.text           // typing into the same field: keep the final text
    else if (step.expect && last && last.expect === step.expect) Object.assign(last, step)
    else r.steps.push(step)
    this.ev.emit('rec', r)
  },
  async stopRecording() {
    const r = this.rec; this.rec = null; this.isolate = false; this.fx = null
    if (r) this.route = r.page; this.saved = null
    await this.load({ keepState: false }); this.ev.emit('nav', this.route); this.ev.emit('rec', null)
    return r
  }
})
async function saveRecording(P, r, ws) {
  if (!r || !r.steps.length) { toast('Nothing was recorded'); return null }
  const name = await promptBox('Save scenario', 'Recorded ' + plural(r.steps.length, 'step') + ' starting on ' + r.page + '. Name:', r.page.replace(/\.html?$/, '').replace(/[^\w-]/g, '-') + '-flow'); if (!name) return null
  const slug = name.trim().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'scenario'
  const spec = { description: '', page: r.page, size: r.size, ...(r.fixture ? { fixture: r.fixture } : {}), steps: r.steps }
  P.write(SCEN_DIR + slug + '.json', JSON.stringify(spec, null, 2) + '\n', { ws, who: 'you', note: 'recorded scenario' })
  toast('Saved ' + SCEN_DIR + slug + '.json'); Dock.open('scenarios')
  return slug
}

// ===== 06-agent.js =====
// ---------- sandbox: QuickJS (wasm) in a worker, with a page-side watchdog ----------
const Sandbox = {
  worker: null, engine: 'off', seq: 0, runs: new Map(), ev: emitter(), tried: 0,
  async spawn() {
    this.engine = 'loading'; this.ev.emit('engine')
    const attach = w => {
      w.onmessage = e => this.onMessage(e.data || {})
      w.onerror = e => { e.preventDefault && e.preventDefault(); if (this.engine === 'loading') { this.engine = 'off'; this.ev.emit('engine') } }
      this.worker = w
    }
    try { attach(new Worker('sandbox.js')) }
    catch (e1) {
      try { const src = await (await fetch('sandbox.js')).text(); attach(new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))) }
      catch (e2) { this.engine = 'off'; this.ev.emit('engine'); return }
    }
    setTimeout(() => { if (this.engine === 'loading') { this.engine = 'off'; this.ev.emit('engine') } }, 15000)
  },
  onMessage(m) {
    if (m.type === 'engine') { this.engine = m.engine; this.ev.emit('engine'); return }
    if (m.type === 'call') {
      const run = this.runs.get(m.eid)
      const reply = (ok, v) => this.worker && this.worker.postMessage(ok ? { type: 'reply', id: m.id, ok: true, value: v } : { type: 'reply', id: m.id, ok: false, error: v })
      if (!run) return reply(false, { kind: 'gone', message: 'eval finished' })
      if (m.name === 'sleep') { setTimeout(() => reply(true, null), clamp(+m.args[0] || 0, 0, 5000)); return }
      const fn = run.api[m.name]
      if (!fn) return reply(false, { kind: 'unknown', message: m.name + ' is not part of the API' })
      run.calls.push(m.name)
      const args = m.args || [], bad = checkArgs(m.name, args)
      if (bad) return reply(false, { kind: 'invalid', message: bad })
      const long = LONG_CALLS.has(m.name)
      if (long && run.long++ === 0) run.pausedAt = Date.now()
      const done = () => { if (long && --run.long === 0) run.extra += Date.now() - run.pausedAt }
      Promise.resolve().then(() => fn(...args)).finally(done).then(v => {
        let out = v === undefined ? null : v
        try { out = JSON.parse(JSON.stringify(out)) } catch { out = String(out) }
        reply(true, out)
      }, err => {
        const kind = err && err.kind || (err instanceof TypeError ? 'invalid' : 'error')
        let message = String(err && err.message || err)
        if (kind === 'invalid' && API_SIGS[m.name]) message += ' · usage: ' + m.name + '(' + API_SIGS[m.name] + ')'
        reply(false, { kind, message })
      })
      return
    }
    if (m.type === 'result') {
      const run = this.runs.get(m.id); if (!run) return
      clearInterval(run.timer); this.runs.delete(m.id)
      run.resolve({ ok: m.ok, value: m.value, error: m.error, logs: m.logs || [], engine: m.engine, ms: m.ms, calls: run.calls, scope: m.scope, fresh: m.fresh })
    }
  },
  // opts: sid (keep this session's variables between evals), restore (its saved variables), lib ([{name, source}])
  async run(code, api, { timeoutMs = 20000, sid, restore, lib } = {}) {
    if (!this.worker) await this.spawn()
    if (this.engine === 'loading') await new Promise(r => { const off = this.ev.on('engine', () => { if (this.engine !== 'loading') { off(); r() } }) })
    if (this.engine === 'off') return { ok: false, error: { kind: 'unavailable', message: 'the sandbox worker could not start in this view' }, logs: [] }
    const id = ++this.seq
    return new Promise(resolve => {
      const run = { resolve, api, calls: [], long: 0, extra: 0, pausedAt: 0 }, t0 = Date.now()
      run.timer = setInterval(() => {          // the engine interrupts itself; this catches a wedged worker
        if (run.long > 0 || Date.now() - t0 - run.extra < timeoutMs + 5000) return
        clearInterval(run.timer); this.runs.delete(id); try { this.worker.terminate() } catch { } this.worker = null
        for (const [, r] of this.runs) { clearInterval(r.timer); r.resolve({ ok: false, error: { kind: 'timeout', message: 'sandbox restarted' }, logs: [] }) } this.runs.clear()
        resolve({ ok: false, error: { kind: 'timeout', message: 'eval exceeded ' + Math.round(timeoutMs / 1000) + ' s; the sandbox was restarted (variables come back from their last saved values)' }, logs: [] })
        this.spawn()
      }, 1000)
      this.runs.set(id, run)
      this.worker.postMessage({ type: 'eval', id, code, api: Object.keys(api), timeoutMs, sid, restore: restore || null, lib: lib || [], sigs: API_SIGS, roles: Object.keys(ROLES) })
    })
  },
  drop(sid) { if (this.worker) this.worker.postMessage({ type: 'drop', sid }) }
}

const LONG_CALLS = new Set(['agents.delegate', 'llm', 'ui.approve', 'ui.ask', 'session.waitFor', 'scenarios.run', 'scenarios.runAll'])
// signatures: a parameter ending in ? is optional. Used to check calls and to say how to call a verb.
const API_SIGS = {
  'files.list': 'prefix?', 'files.read': 'path', 'files.exists': 'path', 'files.lines': 'path, from?, to?', 'files.write': 'path, text',
  'files.replace': 'path, find, replacement, {all}?', 'files.remove': 'path', 'files.grep': 'regex, {path, flags}?', 'files.blame': 'path, {from, to}?',
  'data.tables': '', 'data.rows': 'table, where?', 'data.define': 'table, cols', 'data.insert': 'table, row', 'data.update': 'table, id, patch', 'data.remove': 'table, id', 'data.drop': 'table',
  'frames.list': '', 'frames.open': 'route, {w, h, x, y, label, fixture, new}?', 'frames.update': 'frameId, {route, w, h, x, y, label, fixture}', 'frames.move': 'frameId, x, y', 'frames.close': 'frameId',
  'frames.label': 'frameId, label?', 'frames.arrange': 'rows, {gap, rowGap, x, y}?', 'frames.focus': 'frameId?',
  'frames.outline': 'frameId?', 'frames.inspect': 'frameId, target', 'frames.check': 'frameId?', 'frames.click': 'frameId, target', 'frames.type': 'frameId, target, text',
  'frames.text': 'frameId?, target?', 'frames.query': 'frameId, selector', 'frames.console': 'frameId?', 'frames.reload': 'frameId?',
  'frames.waitFor': 'frameId, selector, {timeout}?', 'frames.count': 'frameId, selector', 'frames.layout': 'frameId?, {near}?', 'frames.snapshot': 'frameId?, label?',
  'frames.compare': 'frameId, {with}?', 'frames.data': 'frameId?', 'snapshots.list': '{route}?',
  'fixtures.list': '', 'fixtures.save': 'name, {tables, store, clock, description}', 'fixtures.capture': 'name, {tables, clock}?',
  'scenarios.list': '', 'scenarios.read': 'name', 'scenarios.save': 'name, spec', 'scenarios.run': 'nameOrSpec', 'scenarios.runAll': '',
  'ui.panel': 'id, spec', 'ui.values': 'id', 'ui.set': 'id, controlId, value', 'ui.ask': 'id, spec?, {label}?', 'ui.panels': '', 'ui.closePanel': 'id',
  'ui.selection': '', 'ui.pins': '{all}?', 'ui.resolvePin': 'pinId, note?', 'ui.notify': 'text', 'ui.pin': 'frameId, target, text', 'ui.approve': 'title, detail?',
  'llm': 'prompt, {output, tier}?', 'agents.delegate': 'role, task, {output, evals, tier, proposal}?', 'agents.roles': '',
  'tx.begin': '', 'tx.commit': '', 'tx.rollback': '', 'dry.begin': '', 'dry.end': '', 'dry.apply': 'id, paths?', 'dry.discard': 'id',
  'session.recall': 'query, {limit, thread, all}?', 'session.message': 'n, {thread}?', 'session.stream': '{kind, frame, since, limit}?', 'session.waitFor': 'kind, {frame, match, timeout}?',
  'session.mark': 'label, {kind, why}?', 'session.marks': '', 'session.events': '{kind, path, since, limit}?', 'session.diff': 'markLabelOrIndex', 'session.workspace': '',
  'lib.def': 'name, fn, {description}?', 'lib.list': '', 'lib.remove': 'name', 'lib.source': 'name', 'log': '...values'
}
function checkArgs(name, args) {
  const sig = API_SIGS[name]; if (sig == null || sig.startsWith('...')) return null
  const req = sig ? sig.split(/,\s*(?![^{]*})/).filter(p => p && !p.endsWith('?')) : []
  const missing = req.filter((p, i) => args[i] === undefined || args[i] === null)
  return missing.length ? name + ' needs ' + req.join(', ') + ' (missing ' + missing.join(', ') + ') · usage: ' + name + '(' + sig + ')' : null
}

// ---------- saved functions: .agent/lib/<name>.js, rebuilt by running their source ----------
const LIB_DIR = '.agent/lib/'
function libEntries(P, ws) {
  return P.list(ws).filter(p => p.startsWith(LIB_DIR) && p.endsWith('.js')).map(path => {
    const text = P.read(path, ws) || '', name = path.slice(LIB_DIR.length, -3)
    let meta = {}; const mm = /^\/\/ @lib (\{.*\})$/m.exec(text); if (mm) { try { meta = JSON.parse(mm[1]) } catch { } }
    const i = text.indexOf('export default ')
    return { name, path, source: (i >= 0 ? text.slice(i + 15) : text).trim(), description: meta.description || '', params: meta.params || [] }
  }).filter(l => /^[A-Za-z_$][\w$]*$/.test(l.name))
}

// ---------- the host API: what code in the sandbox can do (the same API for the agent and the Eval panel) ----------
function hostAPI(ctx) {
  const P = ctx.project, ws = () => ctx.ws, who = ctx.who
  const policy = msg => Object.assign(new Error(msg), { kind: 'policy' })
  const writable = path => {
    if (ctx.mode === 'read') throw policy('read-only mode: this thread may read and check but not write')
    if (ctx.mode === 'tests' && !(path && /^(scenarios|fixtures)\//.test(path))) throw policy('this thread may write only scenarios/ and fixtures/ (tests), not code or data')
  }
  const need = (v, name) => { if (typeof v !== 'string' || !v) throw Object.assign(new Error(name + ' must be a non-empty string'), { kind: 'invalid' }); return v }
  // a dry run (step.dry()) keeps file writes in ctx.scratch; reads see them, the project does not
  const rd = path => ctx.scratch && ctx.scratch.files.has(path) ? ctx.scratch.files.get(path) : P.read(path, ws())
  const ls = () => { const set = new Set(P.list(ws())); if (ctx.scratch) for (const [p, t] of ctx.scratch.files) t === null ? set.delete(p) : set.add(p); return [...set].sort() }
  const wr = (path, text, note) => { if (ctx.scratch) { ctx.scratch.files.set(path, text); return } touchFile(path); P.write(path, text, { ws: ws(), ...meta, note }) }
  const rm = path => { if (ctx.scratch) { ctx.scratch.files.set(path, null); return } touchFile(path); P.remove(path, { ws: ws(), ...meta }) }
  const noDryData = () => { if (ctx.scratch) throw policy('dry runs capture file writes only; data writes are refused inside .dry()') }
  const readOrThrow = path => { need(path, 'path'); const t = rd(path); if (t === null) throw Object.assign(new Error('no file ' + path + '. Files: ' + ls().join(', ')), { kind: 'missing' }); return t }
  const meta = { who, thread: ctx.thread }
  // an eval is a transaction: remember what each file and table was before its first write, to roll back on failure
  const txFrames = () => [ctx.tx, ...(ctx.txStack || [])].filter(Boolean)
  const touchFile = path => {
    const open = txFrames().filter(f => !f.files.has(path)); if (!open.length) return
    const w = ws(), ov = w !== 'main' ? P.overlays.get(w) : null
    const snap = { text: P.read(path, w), inOv: !!ov && Object.prototype.hasOwnProperty.call(ov.files, path), ovText: ov ? ov.files[path] : undefined, hadBase: !!ov && Object.prototype.hasOwnProperty.call(ov.base, path) }
    for (const f of open) f.files.set(path, snap)
  }
  const touchTable = name => { const open = txFrames().filter(f => !f.tables.has(name)); if (!open.length) return; const snap = P.tableSnap(name, ws()); for (const f of open) f.tables.set(name, snap) }
  const rollbackFrame = (f, note) => {
    const opts = { who: ctx.who, thread: ctx.thread, note }
    for (const [path, snap] of f.files) P.revert(path, ws(), snap, opts)
    for (const [name, snap] of f.tables) P.restoreTable(name, snap, ctx.who, ws())
    return [...f.files.keys(), ...[...f.tables.keys()].map(t => 'table ' + t)]
  }
  const frameOrThrow = id => {
    const fr = id ? P.frame(id) : P.board().frames[0]
    if (!fr) throw Object.assign(new Error('no frame ' + id + '. Frames: ' + P.board().frames.map(f => f.id + ' ' + f.route).join(', ')), { kind: 'missing' })
    return fr
  }
  const frameFor = async id => {
    const fr = frameOrThrow(id)
    const vis = App.hostFor(fr.id)
    if (vis && vis.shown && vis.ws === ws() && vis.fixture === (fr.fixture || null)) { if (!vis.ready) await vis.readyP; return vis }
    return Headless.get(P, vis ? vis.route : fr.route, ws(), fr.w, fr.h, fr.fixture || null)
  }
  const frameInfo = f => { const v = App.hostFor(f.id); return { id: f.id, label: f.label || undefined, route: v ? v.route : f.route, page: v && v.route !== f.route ? f.route : undefined, w: f.w, h: f.h, x: f.x, y: f.y, fixture: f.fixture || undefined, errors: v ? v.errors : 0, issues: v ? v.issues.length : 0 } }
  const canvasLog = note => P.log({ kind: 'canvas', ws: 'main', who, thread: ctx.thread, note })
  const strip = e => { const o = { ...e }; delete o.after; delete o.files; return o }
  const MARK_KINDS = ['bookmark', 'milestone', 'decision', 'question', 'checkpoint']
  const api = {
    'files.list': prefix => ls().filter(p => !prefix || p.startsWith(prefix)).map(path => ({ path, size: rd(path).length, lines: rd(path).split('\n').length })),
    'files.read': path => readOrThrow(path),
    'files.exists': path => rd(need(path, 'path')) !== null,
    'files.lines': (path, from = 1, to) => { const ls = readOrThrow(path).split('\n'); to = Math.min(ls.length, to || from + 199); const w = String(to).length; return ls.slice(from - 1, to).map((l, i) => String(from + i).padStart(w) + '| ' + l).join('\n') },
    'files.write': (path, text) => { need(path, 'path'); writable(path); const bad = validPath(path); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' }); const created = rd(path) === null; wr(path, String(text)); return { path, created, lines: String(text).split('\n').length } },
    'files.replace': (path, find, repl, opts = {}) => {
      writable(path); const t = readOrThrow(path); need(find, 'find')
      const n = t.split(find).length - 1
      if (!n) throw Object.assign(new Error('text not found in ' + path + '; read the file and copy the exact text, whitespace included'), { kind: 'anchor' })
      if (n > 1 && !opts.all) throw Object.assign(new Error('text found ' + n + ' times in ' + path + ' (lines ' + t.split('\n').map((l, i) => l.includes(find.split('\n')[0]) ? i + 1 : 0).filter(Boolean).slice(0, 6).join(', ') + '); include more surrounding text, or pass {all: true}'), { kind: 'anchor' })
      wr(path, opts.all ? t.split(find).join(String(repl)) : t.replace(find, () => String(repl)))
      return { path, replaced: opts.all ? n : 1 }
    },
    'files.remove': path => { writable(path); readOrThrow(path); rm(path); return { path, removed: true } },
    // who last changed each run of lines, and why (the request, reply and marks of that turn)
    'files.blame': (path, o = {}) => {
      readOrThrow(path); const at = P.blame(path, ws()), lines = P.read(path, ws()).split('\n'), from = Math.max(1, +o.from || 1), to = Math.min(lines.length, +o.to || lines.length), runs = []
      for (let k = from; k <= to; k++) { const i = at[k - 1], last = runs[runs.length - 1]; if (last && last.event === i) last.to = k; else runs.push({ from: k, to: k, event: i }) }
      return runs.map(r => { const w = r.event != null ? P.why(r.event) : null; return { lines: r.from === r.to ? String(r.from) : r.from + '–' + r.to, who: !w ? 'unknown' : w.kind === 'init' ? 'template' : w.who === 'agent' ? 'claude' + (w.role ? ' (' + w.role + ')' : '') : w.who, when: w ? new Date(w.t).toISOString() : undefined, request: w && w.request || undefined, reply: w && w.reply || undefined, marks: w && w.marks && w.marks.length ? w.marks.map(m => m.kind + ': ' + m.label + (m.why ? ' (' + m.why + ')' : '')) : undefined, note: w && !w.request && w.note || undefined, proposal: w && w.proposal || undefined, thread: w && w.thread || undefined, event: r.event } })
    },
    'files.grep': (pattern, opts = {}) => {
      let re; try { re = new RegExp(need(pattern, 'pattern'), opts.flags || 'i') } catch (e) { throw Object.assign(new Error('bad regex: ' + e.message), { kind: 'invalid' }) }
      const out = []
      for (const path of ls()) { if (opts.path && !path.startsWith(opts.path)) continue; rd(path).split('\n').forEach((l, i) => { if (out.length < 200 && re.test(l)) out.push({ path, line: i + 1, text: l.trim().slice(0, 200) }) }) }
      return out
    },
    // data: in a proposal, the first write to a table copies it into the proposal; main's rows change only on accept
    'data.tables': () => [...P.tablesIn(ws()).values()].map(t => ({ name: t.name, cols: t.cols, count: t.rows.length, ...(ws() !== 'main' && P.ownsTable(t.name, ws()) ? { proposalCopy: true } : {}) })),
    'data.rows': (table, where) => P.rows(need(table, 'table'), where, ws()).slice(0, 300),
    'data.define': (table, cols) => { writable(); noDryData(); touchTable(need(table, 'table')); return P.define(table, cols, who, ws()) },
    'data.insert': (table, row) => { writable(); noDryData(); touchTable(need(table, 'table')); return P.insert(table, row, who, ws()) },
    'data.update': (table, id, patch) => { writable(); noDryData(); touchTable(need(table, 'table')); return P.update(table, id, patch, who, ws()) },
    'data.remove': (table, id) => { writable(); noDryData(); touchTable(need(table, 'table')); return P.removeRow(table, id, who, ws()) },
    'data.drop': table => { writable(); noDryData(); touchTable(need(table, 'table')); P.dropTable(table, who, ws()); return true },
    // ---- the canvas: frames are views, so arranging them is allowed in every mode ----
    'frames.list': () => P.board().frames.map(frameInfo),
    'frames.open': (route, o = {}) => {
      need(route, 'route')
      if (o.fixture && P.read(fixturePath(o.fixture), ws()) === null) throw Object.assign(new Error('no fixture ' + fixturePath(o.fixture) + '. Fixtures: ' + (fixtureList(P, ws()).map(x => x.name).join(', ') || 'none')), { kind: 'missing' })
      const ex = !o.new && P.board().frames.find(f => (App.hostFor(f.id) ? App.hostFor(f.id).route : f.route) === route && f.w === (o.w || 375) && f.h === (o.h || 720) && (f.fixture || null) === (o.fixture || null))
      if (ex) return { ...frameInfo(ex), reused: true, note: 'a frame already shows ' + route + ' at this size; pass {new: true} for another' }
      const f = P.addFrame({ route, w: o.w || 375, h: o.h || 720, x: o.x, y: o.y }); if (o.label) f.label = String(o.label).slice(0, 60); if (o.fixture) f.fixture = String(o.fixture); P.saveMeta(); P.ev.emit('frames'); canvasLog('opened ' + route + ' ' + f.w + '×' + f.h); return frameInfo(f) },
    'frames.update': (id, o = {}) => {
      const f = frameOrThrow(need(id, 'frameId'))
      if (o.w != null) f.w = clamp(Math.round(+o.w) || f.w, 240, 2400); if (o.h != null) f.h = clamp(Math.round(+o.h) || f.h, 200, 4000)
      if (o.x != null) f.x = Math.round(+o.x) || 0; if (o.y != null) f.y = Math.round(+o.y) || 0
      if (o.label !== undefined) f.label = o.label ? String(o.label).slice(0, 60) : undefined
      if (o.route && o.route !== f.route) { const v = App.hostFor(f.id); f.route = o.route; if (v) v.navigate(o.route) }
      if (o.fixture !== undefined) {
        if (o.fixture && P.read(fixturePath(o.fixture), ws()) === null) throw Object.assign(new Error('no fixture ' + fixturePath(o.fixture)), { kind: 'missing' })
        f.fixture = o.fixture || undefined; for (const v of App.canvas ? App.canvas.hostsFor(f.id) : []) v.setFixture(f.fixture)
      }
      P.saveMeta(); P.ev.emit('frames'); return frameInfo(f)
    },
    'frames.move': (id, x, y) => api['frames.update'](id, { x, y }),
    'frames.label': (id, label) => api['frames.update'](id, { label: label || null }),
    'frames.close': id => { const f = frameOrThrow(need(id, 'frameId')); P.removeFrame(f.id); canvasLog('closed ' + (f.label || f.route)); return { closed: f.id, remaining: P.board().frames.length } },
    'frames.arrange': (rows, o = {}) => {
      if (!Array.isArray(rows) || !rows.length) throw Object.assign(new Error('rows is a list of rows, each a list of frame ids: [["f1", "f2"], ["f3"]]'), { kind: 'invalid' })
      const gap = o.gap ?? 60, rowGap = o.rowGap ?? 110
      let y = o.y ?? 0, placed = 0
      for (const row of rows) {
        let x = o.x ?? 0, hmax = 0
        for (const id of [].concat(row)) { const f = frameOrThrow(id); f.x = x; f.y = y; x += f.w + gap; hmax = Math.max(hmax, f.h); placed++ }
        y += hmax + rowGap
      }
      P.saveMeta(); P.ev.emit('frames'); canvasLog('arranged ' + plural(placed, 'frame') + ' in ' + plural(rows.length, 'row'))
      setTimeout(() => App.canvas && App.canvas.fit(), 120)
      return P.board().frames.map(frameInfo)
    },
    'frames.focus': id => { const f = id ? frameOrThrow(id) : null; setTimeout(() => App.canvas && (f ? App.canvas.focusFrame(f.id) : App.canvas.fit()), 60); return true },
    'frames.outline': async id => { const fh = await frameFor(id), nodes = await fh.call('outline', [300]); return nodes.map(n => '  '.repeat(n.d) + n.tag + (n.id ? '#' + n.id : '') + (n.cls ? '.' + n.cls : '') + (n.text ? ' "' + n.text + '"' : '') + (n.src ? '  @' + n.src : '')).join('\n') },
    'frames.inspect': async (id, target) => { const fh = await frameFor(id); const r = await fh.call('inspect', [target]); r.rules = r.rules.map(x => ({ file: x.file, selector: x.selector, media: x.media || undefined, css: x.text })); return r },
    'frames.check': async id => { const fh = await frameFor(id); const issues = await fh.call('check', [], 4000); return { route: fh.route, errors: fh.logs.filter(l => l.level === 'error').map(l => l.text + (l.src ? ' @' + l.src : '')).slice(-10), issues } },
    'frames.click': async (id, target) => { const fh = await frameFor(id); const r = await fh.call('click', [target]); await sleep(120); return r },
    'frames.type': async (id, target, text) => { const fh = await frameFor(id); return fh.call('type', [target, text]) },
    'frames.text': async (id, target) => { const fh = await frameFor(id); return fh.call('text', [target || null]) },
    'frames.query': async (id, selector) => { const fh = await frameFor(id); return fh.call('query', [need(selector, 'selector')]) },
    'frames.console': async id => { const fh = await frameFor(id); return fh.logs.slice(-30).map(l => l.level + ': ' + l.text + (l.src ? ' @' + l.src : '')) },
    'frames.reload': async id => { const fh = await frameFor(id); await fh.load({ keepState: false }); return { route: fh.route, errors: fh.errors } },
    'frames.waitFor': async (id, selector, o = {}) => { const fh = await frameFor(id), t = clamp(+o.timeout || 2000, 50, 15000); return fh.call('waitFor', [need(selector, 'selector'), t], t + 1500) },
    'frames.count': async (id, selector) => { const fh = await frameFor(id); await fh.call('settle', [600], 2000).catch(() => { }); return fh.call('count', [need(selector, 'selector')]) },
    'frames.layout': async (id, o = {}) => {
      const fh = await frameFor(id), L = await fh.call('layout', [], 5000)
      let items = L.items
      if (o.near) { const q = String(o.near); items = items.filter(i => (i.s || '').startsWith(q) || i.k.includes(q) || i.t.includes(q) || (i.x || '').includes(q)) }
      return { route: fh.route, width: L.w, height: L.h, count: L.items.length, items: items.slice(0, 150).map(i => ({ key: i.k, tag: i.t, box: i.b, text: i.x, src: i.s, hidden: i.hid ? true : undefined })) }
    },
    'frames.snapshot': async (id, label) => { const fh = await frameFor(id), m = await Snaps.take(P, fh, { label: label || null, by: who }); if (!m) throw new Error('snapshot too large'); return { id: m.id, route: m.route, w: m.w, ws: m.ws, label: m.label, t: new Date(m.t).toISOString() } },
    // layout differences: this workspace against another (default: main, or the newest snapshot when in main), or a snapshot id
    'frames.compare': async (id, o = {}) => {
      const fr0 = frameOrThrow(need(id, 'frameId')), v0 = App.hostFor(fr0.id), fr = { ...fr0, route: v0 ? v0.route : fr0.route }, cur = await layoutIn(P, fr, ws(), { headless: true })
      let other, what = o.with
      if (!what) { if (ws() !== 'main') what = 'main'; else { const s = Snaps.list(P).filter(x => x.route === cur.fh.route && x.w === fr.w && x.ws === 'main').slice(-1)[0]; if (!s) throw Object.assign(new Error('nothing to compare with: in main, take a snapshot first (frames.snapshot) or pass {with: proposalId}'), { kind: 'missing' }); what = s.id } }
      if (/^sn/.test(what)) { const d = await Snaps.load(P, what); if (!d) throw Object.assign(new Error('no snapshot ' + what), { kind: 'missing' }); other = d.layout }
      else { if (what !== 'main' && !P.overlays.get(what)) throw Object.assign(new Error('no workspace ' + what + ' (main or a proposal id)'), { kind: 'missing' }); other = (await layoutIn(P, fr, what, { headless: true })).layout }
      const d = layoutDiff(other, cur.layout)
      return { frame: cur.fh.route + ' ' + fr.w + 'px', from: what, to: ws(), changes: d.changes.length, summary: diffSummary(d, 30) }
    },
    'frames.data': async id => { const fh = await frameFor(id); return fh.fx ? { fixture: fh.fixture, tables: Object.fromEntries(Object.entries(fh.fx.tables).map(([n, t]) => [n, t.rows.length])), store: fh.fx.store, clock: fh.fx.clock } : { fixture: null, note: 'this frame uses the live data of ' + ws() } },
    'snapshots.list': (o = {}) => Snaps.list(P).filter(s => !o.route || s.route === o.route).slice(-40).map(s => ({ id: s.id, route: s.route, w: s.w, ws: s.ws, label: s.label || undefined, note: s.note, fixture: s.fixture || undefined, t: new Date(s.t).toISOString() })),
    // ---- fixtures and scenarios are files (fixtures/*.json, scenarios/*.json): staged in proposals, reviewed like code ----
    'fixtures.list': () => fixtureList(P, ws()).map(f => ({ name: f.name, description: f.description || undefined, tables: f.tables, clock: f.clock || undefined, error: f.error || undefined })),
    'fixtures.save': (name, spec) => {
      writable('fixtures/'); const bad = checkFixture(spec); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
      const path = fixturePath(need(name, 'name').replace(/[^\w-]/g, '-')); wr(path, JSON.stringify(spec, null, 2) + '\n', 'fixture'); return { path }
    },
    'fixtures.capture': (name, o = {}) => {
      writable('fixtures/'); const tabs = P.tablesIn(ws()), want = o.tables || [...tabs.keys()], tables = {}
      for (const n of want) { const t = tabs.get(n); if (!t) throw Object.assign(new Error('no table ' + n), { kind: 'missing' }); tables[n] = clone(t.rows) }
      return api['fixtures.save'](name, { description: o.description || 'captured from ' + ws() + ' data', tables, ...(o.clock ? { clock: o.clock } : {}) })
    },
    'scenarios.list': () => scenarioList(P, ws()).map(s => ({ name: s.name, description: s.spec && s.spec.description || undefined, page: s.spec && s.spec.page, steps: s.spec && s.spec.steps ? s.spec.steps.length : 0, fixture: s.spec && s.spec.fixture || undefined, error: s.error || undefined, last: s.last ? (s.last.ok ? 'passed' : 'failed at step ' + (s.last.failedAt + 1)) : undefined })),
    'scenarios.read': name => { const s = scenarioList(P, ws()).find(x => x.name === name); if (!s) throw Object.assign(new Error('no scenario ' + name + '. Scenarios: ' + scenarioList(P, ws()).map(x => x.name).join(', ')), { kind: 'missing' }); return s.spec },
    'scenarios.save': (name, spec) => {
      writable('scenarios/'); const bad = checkScenario(spec); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
      const path = SCEN_DIR + need(name, 'name').replace(/[^\w-]/g, '-') + '.json'; wr(path, JSON.stringify(spec, null, 2) + '\n', 'scenario'); return { path, steps: spec.steps.length }
    },
    'scenarios.run': async target => {
      let spec = target, name = 'unsaved'
      if (typeof target === 'string') { name = target; spec = api['scenarios.read'](target) }
      const r = await runScenario(P, spec, { ws: ws(), name, who, thread: ctx.thread, signal: ctx.signal })
      return { name, ok: r.ok, ms: r.ms, failedAt: r.ok ? undefined : r.failedAt + 1, steps: r.steps.map(s => (s.ok ? '✓ ' : '✗ ') + s.label + (s.error ? ': ' + s.error : '') + (s.errors ? ' [console: ' + s.errors.join('; ') + ']' : '')), snapshots: r.snaps.map(s => s.id) }
    },
    'scenarios.runAll': async () => { const rs = await runAllScenarios(P, { ws: ws(), who, thread: ctx.thread, signal: ctx.signal }); return { passed: rs.filter(r => r.ok).length, failed: rs.filter(r => !r.ok).length, results: rs.map(r => (r.ok ? '✓ ' : '✗ ') + r.name + (r.error ? ' (step ' + ((r.failedAt ?? -1) + 1) + '): ' + r.error : '')) } },
    // ---- panels: controls and live widgets shown in the reply (or the Panels tab), see the guide ----
    'ui.panel': (id, spec) => {
      need(id, 'id'); if (!/^[\w-]{1,40}$/.test(id)) throw Object.assign(new Error('panel ids are words: letters, digits, _ or -'), { kind: 'invalid' })
      const p = Panels.upsert(P, id, spec, { by: who === 'agent' ? 'agent' : 'you', thread: ctx.thread, ws: ws(), pinned: ctx.onPanel ? undefined : true })
      if (ctx.onPanel) ctx.onPanel(id); else setTimeout(() => Dock.open('panels'), 50)
      return { id, shown: ctx.onPanel ? 'in your reply' : 'in the Panels tab', values: p.values }
    },
    'ui.values': id => { const p = Panels.get(P, need(id, 'id')); if (!p) throw Object.assign(new Error('no panel ' + id + '. Panels: ' + Panels.list(P).map(x => x.id).join(', ')), { kind: 'missing' }); return { ...p.values, changed: (p.log || []).filter(l => l.by === 'you').slice(-8).map(l => l.id + ' → ' + JSON.stringify(l.v)) } },
    'ui.set': (id, cid, value) => { const p = Panels.get(P, need(id, 'id')); if (!p) throw Object.assign(new Error('no panel ' + id), { kind: 'missing' }); Panels.set(P, p, need(cid, 'controlId'), value, { by: who }); return p.values },
    // show a panel and wait until the person presses Done; resolves to its values (Cancel: an approval error)
    'ui.ask': async (id, spec, o = {}) => {
      need(id, 'id')
      if (spec) api['ui.panel'](id, spec); else if (!Panels.get(P, id)) throw Object.assign(new Error('no panel ' + id + ': pass a spec'), { kind: 'missing' })
      else if (ctx.onPanel) ctx.onPanel(id)
      const v = await new Promise(resolve => { Panels.waiting.set(id, { resolve, label: o.label }); App.ev.emit('ask', id); if (ctx.signal) ctx.signal.addEventListener('abort', () => resolve(null)) })
      Panels.waiting.delete(id); App.ev.emit('ask', id)
      if (!v) throw Object.assign(new Error('the person cancelled the panel'), { kind: 'approval' })
      return v
    },
    'ui.panels': () => Panels.list(P).map(p => ({ id: p.id, title: p.spec.title, values: p.values, pinned: p.pinned, items: p.spec.items.map(i => i.id ? i.type + ' ' + i.id : i.type) })),
    'ui.closePanel': id => { Panels.remove(P, need(id, 'id')); return true },
    'ui.selection': () => App.sel ? { ...App.sel, rect: undefined } : null,
    'ui.pins': (opts = {}) => (P.meta.pins || []).filter(p => opts.all || !p.resolved).map(p => ({ id: p.id, n: p.n, route: p.route, src: p.src, text: p.text, by: p.by, resolved: !!p.resolved })),
    'ui.resolvePin': (id, note) => { const p = (P.meta.pins || []).find(x => x.id === id || x.n === id); if (!p) throw Object.assign(new Error('no pin ' + id), { kind: 'missing' }); p.resolved = true; p.reply = note || ''; P.saveMeta(); App.ev.emit('pins'); return true },
    'ui.notify': text => { toast(String(text).slice(0, 200)); return true },
    'session.mark': (label, o) => {
      const opts = typeof o === 'string' ? { why: o } : (o || {})
      if (opts.kind && !MARK_KINDS.includes(opts.kind)) throw Object.assign(new Error('mark kinds: ' + MARK_KINDS.join(', ')), { kind: 'invalid' })
      const e = P.mark({ label: need(label, 'label'), note: opts.why || opts.note, by: who, thread: ctx.thread, kind: opts.kind })
      return { i: e.i, kind: e.mk }
    },
    'session.marks': () => P.marks().map(e => ({ i: e.i, label: e.label, kind: e.mk || 'bookmark', by: e.who, why: e.note, t: new Date(e.t).toISOString() })),
    'session.events': (opts = {}) => P.events.filter(e => (!opts.kind || e.kind === opts.kind) && (!opts.path || e.path === opts.path) && (opts.since == null || e.i > opts.since)).slice(-(opts.limit || 40)).map(strip),
    'session.diff': since => {
      const i = typeof since === 'number' ? since : (P.marks().reverse().find(m => m.label === since) || {}).i
      if (i == null) throw Object.assign(new Error('pass an event index or a mark label'), { kind: 'invalid' })
      return P.since(i).map(c => diffText(c.path, c.before, c.after)).join('\n\n') || 'no changes in main since then'
    },
    // the full history behind the summary: search it, read one message
    'session.recall': (query, o = {}) => {
      const words = String(need(query, 'query')).toLowerCase().split(/[^\p{L}\p{N}_.#-]+/u).filter(w => w.length > 1)
      const own = ctx.thread && P.threads.get(ctx.thread), ths = o.thread ? [P.threads.get(o.thread)].filter(Boolean) : own && !o.all ? [own] : [...P.threads.values()]
      if (!words.length) throw Object.assign(new Error('give a few words to look for'), { kind: 'invalid' })
      const hits = []
      for (const t of ths) t.msgs.forEach((m, i) => {
        if (t === own && i >= t.msgs.length - 2) return
        const body = [m.text || '', ...(m.steps || []).flatMap(s => [s.code || '', s.out || ''])].join('\n'), low = body.toLowerCase()
        const found = words.filter(w => low.includes(w)); if (!found.length) return
        const at = low.indexOf(found[0]), a = Math.max(0, at - 90)
        hits.push({ thread: t === own ? undefined : t.title, threadId: t === own ? undefined : t.id, n: i + 1, role: m.role === 'user' ? (m.from ? 'main agent' : 'person') : 'claude', when: new Date(m.t).toISOString(), score: found.length / words.length, summarized: !!(t.summary && i < t.summary.upTo), text: (a ? '…' : '') + body.slice(a, at + 160).replace(/\s+/g, ' ') + '…' })
      })
      return hits.sort((x, y) => y.score - x.score || y.when.localeCompare(x.when)).slice(0, clamp(+o.limit || 8, 1, 30))
    },
    // events as they happen: project events (writes, data, marks, scenarios, …) and what happens in canvas frames
    'session.stream': (o = {}) => Streams.merged(P, o).map(e => ({ ...e, when: new Date(e.t).toISOString() })),
    'session.waitFor': (kind, o = {}) => new Promise((resolve, reject) => {
      const kinds = [].concat(need(kind, 'kind')), timeout = clamp(+o.timeout || 30000, 500, 300000), t0 = now()
      const ok = e => kinds.includes(e.kind) && (!o.frame || e.frame === o.frame || e.fid === o.frame) && (!o.match || JSON.stringify(e).toLowerCase().includes(String(o.match).toLowerCase()))
      const done = (v, err) => { offs.forEach(f => f()); clearTimeout(timer); err ? reject(err) : resolve(v) }
      const offs = [App.ev.on('frameevent', e => { if (ok(e)) done({ source: 'frame', kind: e.kind, frame: e.frame + ' ' + e.w + 'px', detail: e.detail, when: new Date(e.t).toISOString(), waited: now() - t0 }) }),
        App.ev.on('events', e => { if (e && e.t >= t0 && ok({ ...e, detail: e.label || e.note || e.path || '' })) done({ source: 'project', kind: e.kind, who: e.who === 'agent' ? 'claude' : e.who, path: e.path, table: e.table, detail: e.label || e.note || '', when: new Date(e.t).toISOString(), waited: now() - t0 }) })]
      const timer = setTimeout(() => done(null, Object.assign(new Error('no ' + kinds.join(' or ') + ' event within ' + timeout + ' ms'), { kind: 'timeout' })), timeout)
      if (ctx.signal) ctx.signal.addEventListener('abort', () => done(null, Object.assign(new Error('cancelled'), { kind: 'cancelled' })))
    }),
    'session.message': (n, o = {}) => {
      const t = o.thread ? P.threads.get(o.thread) : ctx.thread && P.threads.get(ctx.thread)
      if (!t) throw Object.assign(new Error('pass {thread: id} (from session.recall) outside a thread'), { kind: 'invalid' })
      const m = t.msgs[(+n || 0) - 1]; if (!m) throw Object.assign(new Error('no message ' + n + ' (the thread has ' + t.msgs.length + ')'), { kind: 'missing' })
      return { n: +n, role: m.role === 'user' ? (m.from ? 'main agent' : 'person') : 'claude', when: new Date(m.t).toISOString(), text: m.text || '', evals: (m.steps || []).map(s => ({ code: trunc(s.code || '', 2000), status: s.status, result: trunc(s.out || '', 1500), effects: effectsLine(s.effects) || undefined })) }
    },
    'session.workspace': () => ({ ws: ws(), title: ws() === 'main' ? 'main' : (P.overlays.get(ws()) || {}).title, changes: ws() === 'main' ? [] : P.changes(ws()).map(c => c.path) }),
    // lib.def arrives already checked by the sandbox (free variables, compiles alone); this writes the file
    'lib.def': (name, source, opts = {}, params = []) => {
      writable()
      const path = LIB_DIR + name + '.js', existed = rd(path) !== null
      const head = { name, description: String(opts.description || '').slice(0, 200), params, by: who, t: now() }
      const text = '// lib.' + name + (head.description ? ': ' + head.description : '') + '\n// @lib ' + JSON.stringify(head) + '\n// Saved with lib.def; rebuilt by running the source below. It may use the host API and other lib functions.\nexport default ' + source + '\n'
      wr(path, text, (existed ? 'updated' : 'saved') + ' lib.' + name)
      return { saved: 'lib.' + name, path, params, replaced: existed }
    },
    'lib.list': () => libEntries(P, ws()).map(l => ({ name: l.name, params: l.params, description: l.description, path: l.path })),
    'lib.remove': name => { writable(); const path = LIB_DIR + need(name, 'name') + '.js'; readOrThrow(path); rm(path); return { removed: 'lib.' + name } },
    'lib.source': name => readOrThrow(LIB_DIR + need(name, 'name') + '.js'),
    'log': (...a) => { ctx.logs && ctx.logs.push(a.join(' ')); return true },
    'tx.begin': () => { (ctx.txStack = ctx.txStack || []).push({ files: new Map(), tables: new Map() }); return ctx.txStack.length },
    'tx.commit': () => { (ctx.txStack || []).pop(); return true },
    'tx.rollback': () => { const f = (ctx.txStack || []).pop(); return f ? rollbackFrame(f, 'rolled back: an atomic step failed') : [] },
    'dry.begin': () => { if (ctx.scratch) throw Object.assign(new Error('a dry run is already open'), { kind: 'invalid' }); ctx.scratch = { files: new Map() }; return true },
    'dry.end': () => {
      const sc = ctx.scratch; ctx.scratch = null
      const files = [], diffs = []
      for (const [path, text] of sc ? sc.files : []) {
        const cur = P.read(path, ws()); if (cur === text) continue
        files.push(cur === null ? { path, change: 'create', lines: text.split('\n').length } : text === null ? { path, change: 'remove' } : { path, change: 'edit', ...diffStat(cur, text) })
        diffs.push(diffText(path, cur, text))
      }
      const id = uid('cs'); (ctx.dryStore = ctx.dryStore || new Map()).set(id, sc ? sc.files : new Map())
      return { id, files, diff: trunc(diffs.join('\n\n'), 8000) }
    },
    'dry.apply': (id, paths) => {
      writable(); const files = ctx.dryStore && ctx.dryStore.get(id); if (!files) throw Object.assign(new Error('no changeset ' + id + ' (changesets last for the turn)'), { kind: 'missing' })
      let n = 0
      for (const [path, text] of files) { if (paths && !paths.includes(path)) continue; if (text === null) { if (rd(path) !== null) { rm(path); n++ } } else if (rd(path) !== text) { wr(path, text, 'applied a dry run'); n++ } }
      return { applied: n }
    },
    'dry.discard': id => { ctx.dryStore && ctx.dryStore.delete(id); return true },
    'ui.approve': (title, detail) => approvalCard(ctx, String(title), detail ? String(detail) : ''),
    'ui.pin': async (id, target, text) => {
      const fh = await frameFor(need(id, 'frameId'))
      const sel = typeof target === 'string' ? target : target && target.src ? '[data-src="' + target.src + '"]' : null
      const hit = sel ? (await fh.call('query', [sel, 1]))[0] : null
      if (sel && !hit) throw Object.assign(new Error('no element matches ' + sel + ' in ' + fh.route), { kind: 'missing' })
      const n = (P.meta.pins || []).reduce((a, p) => Math.max(a, p.n), 0) + 1
      P.meta.pins.push({ id: 'pin' + uid(), n, route: fh.route, src: hit ? hit.src : '', selector: hit ? hit.selector : '', rx: 0.5, ry: 0.5, text: need(text, 'text').slice(0, 500), by: ctx.role ? 'Claude · ' + ctx.role : who === 'agent' ? 'Claude' : 'you', t: now(), resolved: false })
      P.saveMeta(); P.log({ kind: 'pin', who, ws: 'main', thread: ctx.thread, note: '#' + n + ' ' + text.slice(0, 100), path: hit && hit.src ? hit.src.split(':')[0] : undefined }); App.ev.emit('pins')
      return { pin: n, route: fh.route, src: hit ? hit.src : null }
    },
    'llm': async (prompt, o = {}) => {
      if (!Agent.sample) throw Object.assign(new Error('Claude is not available in this view'), { kind: 'unavailable' })
      ctx.llmCalls = (ctx.llmCalls || 0) + 1
      if (ctx.llmCalls > 24) throw Object.assign(new Error('llm calls are capped at 24 per turn'), { kind: 'budget' })
      let res
      try { res = await Agent.sample(String(prompt) + (o.output ? '\n\nReply with JSON only, no prose and no code fences, matching: ' + o.output : ''), { modelTier: o.tier || 'quick', cache: false, signal: ctx.signal }) }
      catch (e) { throw Object.assign(new Error(e && e.message || String(e)), { kind: e && e.code === 'rate_limited' ? 'rate_limited' : 'llm' }) }
      const text = (res && res.text || '').trim()
      if (!o.output) return text
      const v = parseJSONReply(text); if (v === undefined) throw Object.assign(new Error('the reply was not JSON: ' + text.slice(0, 200)), { kind: 'llm' })
      return v
    },
    'agents.delegate': (role, task, o = {}) => Agent.delegate(ctx, role, need(task, 'task'), o),
    'agents.roles': () => Object.entries(ROLES).map(([name, r]) => ({ name, describe: r.describe, writes: r.mode === 'read' ? false : r.mode === 'tests' ? 'scenarios/ and fixtures/ only' : true, evals: r.evals }))
  }
  return api
}
function parseJSONReply(text) {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  try { return JSON.parse(t) } catch { }
  for (const [o, c] of [['{', '}'], ['[', ']']]) { const i = t.lastIndexOf(o === '{' ? '\n{' : '\n['), a = i >= 0 ? i + 1 : t.indexOf(o), b = t.lastIndexOf(c); if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { } } }
  return undefined
}
// an approval asked from inside an eval (step.approve()): a card in the thread, or a dialog from the Eval panel
function approvalCard(ctx, title, detail) {
  return new Promise(resolve => {
    const done = v => { resolve(v); if (ctx.onApproval) ctx.onApproval(null) }
    if (ctx.onApproval) { ctx.onApproval({ title, detail, decide: done }); if (ctx.signal) ctx.signal.addEventListener('abort', () => done(false)); return }
    let answered = false
    modal({ title, body: [h('p.note', 'Code in the sandbox asks before it continues.'), detail ? h('pre.mono', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', maxHeight: '300px', overflow: 'auto', margin: 0 } }, detail) : null],
      onClose: () => { if (!answered) resolve(false) }, actions: [{ label: 'Decline', run: () => { answered = true; resolve(false) } }, { label: 'Approve', primary: true, run: () => { answered = true; resolve(true) } }] })
  })
}

// ---------- one eval, with its transaction and its effects ----------
// Both the agent and the Eval panel go through this: writes roll back if the eval fails, and the result says
// what changed: files written, check issues that appeared or went away, new console errors.
async function runEval(ctx, code, api, { sid, restore } = {}) {
  const P = ctx.project, ws = ctx.ws
  const before = new Map(), layouts = new Map()
  for (const f of P.board().frames) { const v = App.hostFor(f.id); if (v && v.ws === ws && v.ready) before.set(f.id, new Set(v.issues.map(issueKey(v)))) }
  // each frame's layout before the eval, to report what its writes did to the pages
  await Promise.all(P.board().frames.map(async f => {
    const v = App.hostFor(f.id), fh = v && v.shown && v.ws === ws && v.fixture === (f.fixture || null) ? v : Headless.peek(P, v ? v.route : f.route, ws, f.w, f.h, f.fixture || null)
    if (!fh || !fh.ready) return
    try { layouts.set(f.id, { route: fh.route, layout: await fh.call('layout', [300], 1200) }) } catch { if (fh.layoutMap) layouts.set(f.id, { route: fh.route, layout: fh.layoutMap }) }
  }))
  ctx.tx = { files: new Map(), tables: new Map(), t0: now() }
  const r = await Sandbox.run(code, api, { sid, restore, lib: libEntries(P, ws).map(l => ({ name: l.name, source: l.source })) })
  const tx = ctx.tx; ctx.tx = null; ctx.scratch = null; ctx.txStack = []
  const effects = {}
  if (!r.ok && (tx.files.size || tx.tables.size)) {
    const opts = { who: ctx.who, thread: ctx.thread, note: 'rolled back: the eval failed' }
    for (const [path, snap] of tx.files) P.revert(path, ws, snap, opts)
    for (const [name, snap] of tx.tables) P.restoreTable(name, snap, ctx.who, ws)
    effects.rolledBack = [...tx.files.keys(), ...[...tx.tables.keys()].map(t => 'table ' + t)]
  } else {
    const files = []
    for (const [path, snap] of tx.files) {
      const cur = P.read(path, ws); if (cur === snap.text) continue
      files.push(snap.text === null ? { path, change: 'created', lines: cur.split('\n').length } : cur === null ? { path, change: 'removed' } : { path, change: 'edited', ...diffStat(snap.text, cur) })
    }
    if (files.length) effects.files = files
    if (tx.tables.size) effects.tables = [...tx.tables.keys()]
  }
  if (tx.files.size || tx.tables.size) Object.assign(effects, await frameEffects(ctx, before, tx.t0, layouts))
  r.effects = Object.keys(effects).length ? effects : null
  return r
}
const issueKey = fh => i => fh.route + ' ' + fh.w + 'px|' + i.kind + '|' + (i.src || i.selector)
async function frameEffects(ctx, before, t0, layouts = new Map()) {
  const P = ctx.project, ws = ctx.ws, added = [], fixed = [], errors = new Set(), layout = []
  await sleep(260)                       // let the reloads the writes scheduled begin
  for (const f of P.board().frames) {
    let fh = App.hostFor(f.id)
    try { if (!fh || !fh.shown || fh.ws !== ws || fh.fixture !== (f.fixture || null)) fh = await Headless.get(P, fh ? fh.route : f.route, ws, f.w, f.h, f.fixture || null); await fh.runCheck() } catch { continue }
    const lb = layouts.get(f.id)
    if (lb && lb.route === fh.route && fh.layoutMap && !layout.some(x => x.frame === fh.route + ' ' + fh.w + 'px')) {
      const d = layoutDiff(lb.layout, fh.layoutMap)
      if (d.changes.length || Math.abs(d.heightFrom - d.heightTo) > 1) layout.push({ frame: fh.route + ' ' + fh.w + 'px', changes: diffSummary(d, 10) })
    }
    const key = issueKey(fh), now = new Set(fh.issues.map(key)), was = before.get(f.id)
    if (was) { for (const i of fh.issues) if (!was.has(key(i))) added.push({ frame: fh.route + ' ' + fh.w + 'px', kind: i.kind, message: i.message, src: i.src || undefined }); for (const k of was) if (!now.has(k)) fixed.push(k.split('|').slice(0, 2).join(' · ')) }
    for (const l of fh.logs) if (l.level === 'error' && l.t >= t0) errors.add(fh.route + ': ' + l.text + (l.src ? ' @' + l.src : ''))
  }
  const out = {}
  if (added.length) out.newIssues = added.slice(0, 8)
  if (fixed.length) out.fixedIssues = [...new Set(fixed)].slice(0, 8)
  if (errors.size) out.newErrors = [...errors].slice(0, 6)
  if (layout.length) out.layout = layout.slice(0, 5)
  return out
}
function effectsLine(e) {
  if (!e) return ''
  const parts = []
  if (e.rolledBack) parts.push('rolled back ' + e.rolledBack.join(', '))
  for (const f of e.files || []) parts.push(f.change === 'edited' ? f.path + ' +' + f.add + ' −' + f.del : f.change + ' ' + f.path)
  if (e.tables) parts.push('tables ' + e.tables.join(', '))
  if (e.fixedIssues) parts.push('fixed ' + plural(e.fixedIssues.length, 'issue'))
  if (e.newIssues) parts.push(plural(e.newIssues.length, 'new issue'))
  if (e.newErrors) parts.push(plural(e.newErrors.length, 'new error'))
  if (e.layout) parts.push('layout changed on ' + e.layout.map(l => l.frame.split(' ')[0]).filter((x, i, a) => a.indexOf(x) === i).join(', '))
  return parts.join(' · ')
}
function scopeSummary(scope) {
  if (!scope || !scope.vars) return ''
  const k = v => v === null ? 'null' : Array.isArray(v) ? 'array(' + v.length + ')' : typeof v === 'object' ? 'object' : typeof v
  return Object.entries(scope.vars).map(([n, v]) => n + ': ' + k(v)).join(', ')
}

const API_GUIDE = `You are the coding agent inside Sitebench, an IDE where a person builds real websites (HTML, CSS, JS files plus small data tables) and watches them run live in frames on a canvas.

You act through ONE tool, eval. Each call runs a JavaScript async function body in a QuickJS sandbox: no DOM, no network, no window. Use await, and \`return\` the value you want back (the last expression is not returned automatically). console.log output comes back too.

Your evals share a scope: top-level \`const\`/\`let\`/\`function\`/\`class\` declarations persist to your later evals in this thread (and across reloads, if they are JSON). Read once, keep the result in a variable, use it next time. vars() lists them; forget('name') drops one, forget() all. Names of the API stay local.
An eval is a transaction: if it throws, its file and table writes are rolled back. The result carries \`effects\`: files written (+added −removed lines), check issues that appeared or were fixed in every frame, new console errors, and \`layout\`: what moved, resized, appeared or changed text on each frame's page ("page height 900 → 1020", "div.cats @menu.html:12: size 343×34 → 343×76").
Save reusable helpers with lib.def(name, fn, {description}) (→ .agent/lib/<name>.js, reviewed like any file); later evals, threads and sessions call lib.<name>(...). A saved function is rebuilt from its source alone: it may use the API, its arguments and other lib functions, not your variables. lib.list(), lib.source(name), lib.remove(name).

Steps. Every module verb returns a Step: a plan. Awaiting a step runs it, so \`await files.read(p)\` just works. Steps also compose before they run:
  a.then(b) or seq(a, b)          b gets a's output; a function is wrapped as step(fn): (input, { input: runInput }) => value
  par([a, b]) or par({ k: a })    same input to each branch, outputs in an array or object
  alt({ k: a, other: b }).by(x => key)       one branch per input      loop(body).seed(s).until(st => …).max(n).keep('best', st => score)
  .map({ concurrency }) runs a step once per element of an array input; .fold(monoid.sum | (acc, v) => …, init)
  dyn(async (x, ctx) => ctx.run(term, input))   shape decided at run time       tx(async () => { … })  everything inside is atomic
  A verb missing its first argument takes it from the input: files.list().then(step(fs => fs.filter(f => f.path.endsWith('.css')))).then(files.read().map())
  Wrappers: .retry({ times, when: e => e.kind === 'anchor' }) .timeout('30s') .fallback(other) .guard(x => …, msg) .verify(out => …, msg) .tap(fn) .approve('title') (asks the person) .named(name) .atomic() (undo every write inside if anything inside fails)
  .explain() returns the plan without running it. await step.dry() runs it with file writes captured and returns a changeset { files, diff }: await cs.apply() (or cs.only(f => …).apply()).
  llm\`question about ${'${x => x.text}'}\`.output(s.enum(['yes', 'no'])) asks a quick model once. Schemas: s.string() s.number() s.int() s.boolean() s.enum([…]) s.array(item) s.object({ … }), .optional() .describe(text).
  Error kinds (e.kind): anchor (replace text not found or ambiguous), missing, invalid, type, timeout, guard, verify, schema, policy, approval, budget. retry and fallback never catch policy, approval, budget or cancelled.
  help() lists everything; help(files.replace) shows one verb.

Subagents. delegate(role, task, { output, evals, proposal }) runs another Claude with its own thread, sandbox and timeline lane, and returns { result, thread, evals, proposal?, changes? }. Its evals come out of your budget; depth is capped at 2. Roles:
  explorer  read-only investigation, answers with file:line evidence
  reviewer  reads a proposal's diff and checks its frames; result { verdict: 'approve' | 'changes', comments }  (pass { proposal: id }, default: your own proposal)
  qa        sweeps frames for overflow, contrast, a11y and errors, files a pin per problem; result { pins, summary }
  builder   builds in a proposal of its own and summarizes; result has proposal and changes
  delegate is a step, so it fans out: await par(['editorial', 'playful'].map(d => delegate('builder', brief + ' Direction: ' + d)))
  Pass { output: s.object({ … }) } to get typed JSON back. Delegate when work splits cleanly or needs a second opinion; do small things yourself.

Host API verbs (each returns a Step; await it to run):
files.list(prefix?) -> [{path, size, lines}]
files.read(path) -> text            files.lines(path, from=1, to?) -> numbered lines "12| ..."
files.exists(path) -> bool
files.write(path, text)             (creates or replaces the whole file)
files.replace(path, find, replacement, {all}?)  exact-text edit; error kind anchor if not found or ambiguous
files.remove(path)                  files.grep(regex, {path?, flags?}) -> [{path, line, text}]
files.blame(path, {from, to}?) -> runs of lines with who last changed them, when, and why: the request, reply and marks of that turn (look before undoing someone's change)
data.tables() -> [{name, cols, count}]     data.rows(table, where?) -> rows
data.define(table, cols)   data.insert(table, row) -> row with id   data.update(table, id, patch)   data.remove(table, id)
frames.list() -> [{id, label, route, w, h, x, y, errors, issues}]   frames.open(route, {w, h, x, y, label, fixture, new}?) -> frame (reuses one showing that route at that size unless new: true)
frames.update(frameId, {route, w, h, x, y, label})   frames.move(frameId, x, y)   frames.label(frameId, text)   frames.close(frameId)
frames.arrange([[id, id, ...], [id, ...]], {gap, rowGap}?)  lay frames out in rows, left to right, then fits the view   frames.focus(frameId?)
  (canvas layout is a view: arranging, labelling and closing frames is allowed in every mode)
frames.check(frameId?) -> {errors, issues}   (layout overflow, contrast, a11y, console errors)
frames.outline(frameId?) -> indented DOM tree with @file:line for each element
frames.inspect(frameId, target) -> box, computed styles, matched CSS rules with their files
frames.query(frameId, selector) -> matches     frames.text(frameId, target?) -> visible text
frames.click(frameId, target)   frames.type(frameId, target, text)   frames.console(frameId)   frames.reload(frameId)
  target is a CSS selector string or {src: "file.html:12"}; a selector may end in :has-text("words") (e.g. 'button:has-text("Add")')
  query and the other reads wait until the page has settled (data loaded, DOM quiet). frames.waitFor(frameId, selector, {timeout}?) waits for a visible match
  frames.count(frameId, selector) -> number. Each match from frames.query has attrs (data-*, href, name, value, checked, aria-*)
frames.layout(frameId?, {near}?) -> every rendered element: key, tag, box [x, y, w, h], own text, src
frames.compare(frameId, {with}?) -> layout differences: this workspace against main (from a proposal), or against a snapshot id
frames.snapshot(frameId?, label?) -> a frozen copy of the page and its layout     snapshots.list({route}?)
frames.data(frameId?) -> which data the frame runs on (fixture tables, store, clock)
Fixtures (fixtures/<name>.json) are fixed data a frame or a scenario runs on instead of the live tables: { description, tables: { menu: [rows] | "live" }, store?: {}, clock?: "2026-05-01T08:30" }
  fixtures.list()   fixtures.save(name, spec)   fixtures.capture(name, {tables, clock}?) copies the current rows   frames.open(route, {fixture}) / frames.update(id, {fixture: name | null})
Scenarios (scenarios/<name>.json) are flows that run in a frame of their own, on a copy of the data (or a fixture), and pass or fail:
  { description, page: "menu.html", size?: [375, 720], fixture?: name, steps: [
    { click: sel }, { type: sel, text }, { go: "cart.html" }, { waitFor: sel }, { wait: ms },
    { expect: sel } (visible) | { expect: sel, text } (contains) | { expect: sel, count } | { expect: sel, visible: false } | { expect: sel, value },
    { data: table, where?, count? }, { store: key, count? | equals? }, { snapshot: label } ] }
  Checks retry until they pass or time out ({ timeout } on a step or the scenario, default 2000 ms). A failure keeps a snapshot.
  scenarios.list()   scenarios.read(name)   scenarios.save(name, spec)   scenarios.run(nameOrSpec) -> { ok, failedAt, steps: ["✓ …", "✗ …: why"] }   scenarios.runAll()
ui.selection() -> what the person selected on the canvas (has src "file:line")
Panels: small UIs you show in your reply, to let the person tune things live or to show live numbers.
  ui.panel(id, { title, description?, items: [ … ] }) creates or updates one (same id = same panel; values the person set are kept)
  controls: { type: 'slider', id, label, min, max, step?, value?, unit? } | { type: 'toggle', id, label } | { type: 'select', id, options: [v | {value, label}] } | { type: 'text', id } | { type: 'color', id }
    bind (optional) makes a control act on the pages:
      { cssVar: '--menu-scale', unit?: 'px', file?: 'styles.css' }   previewed live in every canvas frame; the person presses Keep to write it into the CSS
      { style: { selector: '.cats', prop: 'gap' }, unit: 'px' }        the same for one declaration (use cssVar when the CSS already has a variable)
      { css: { on: { '--font': '"Courier New", monospace', 'body': { background: '#000' } }, off: { … } } }  a toggle (or a select: one entry per option value) that switches several CSS values at once, e.g. a theme; keys starting with -- are custom properties, other keys are selectors
      { store: 'key' }   sets site.store live        { fixture: { on: 'empty-menu', frames?: ['menu.html'] } }  a toggle (or a select of fixtures) switches frames to a fixture
    { type: 'button', label, run: "code" } runs as the person, in the workspace being viewed, with \`values\` in scope
  widgets: { type: 'value' | 'chart' | 'table' | 'list' | 'text', label?, from } (charts: kind: 'line' | 'bar'; a text widget may have markdown instead of from)
    from: { data: 'orders', where?, count?, sum?: field, group?: field, of?: field } | { store: key, count? } | { issues: true } (check issues over time) | { scenarios: true, count? }
          | { events: kind | true, per?: 'minute' | 'hour' } | { frameEvents: 'click' | 'change' | 'nav' | 'load' | 'console' | 'error' | true, frame?, count?, per? } | { frame: frameIdOrRoute, count | text: selector } | { eval: "read-only code; \`values\` in scope" } | { lib: name, args? }
    widgets refresh by themselves when what they read changes (an eval source also when a control moves)
  ui.values(id) -> current values (and what the person changed)   ui.set(id, controlId, value)   ui.panels()   ui.closePanel(id)
  await ui.ask(id, spec?, {label}?) shows the panel and waits for Done: returns the values (Cancel throws kind approval). Use it to let the person pick (a color, a variant) before you build.
  Offer a panel when the person is tuning something visual (sizes, spacing, colors: sliders bound to CSS variables, then they Keep the values), or asks to watch numbers. Keep it small: 2–6 items.
ui.pins() -> open comment pins [{id, n, route, src, text}]     ui.resolvePin(id, note)     ui.pin(frameId, target, text) files a pin
session.mark(label, {kind, why}?)  kind: milestone (default), decision (you chose between options; say why), question (you guessed instead of asking), checkpoint (before a risky step)
session.marks()   session.events({kind?, path?, since?, limit?})
session.diff(markLabelOrIndex) -> unified diff of main since then     session.workspace() -> where your writes go
session.recall(query, {limit, all}?) -> earlier messages of this thread (or of all threads) that mention the words: [{n, role, when, text}]     session.message(n) -> one message in full, with its evals
  Long threads: older messages are folded into a summary at the top of your context; recall and message reach what it left out.
session.stream({kind, frame, since, limit}?) -> recent events, oldest first: project events (write, data, mark, scenario, eval, accept, …) and canvas frame events (click, change, nav, load, console, error: what the person does in Play mode and what pages log)
  await session.waitFor(kind | [kinds], {frame, match, timeout}?) waits for the next one (default 30 s), e.g. await session.waitFor('click', { frame: 'menu.html', match: 'Add' }) after asking the person to try something
sleep(ms)

How pages run: every .html file is a route. <link rel=stylesheet href=x.css> and <script src=x.js> load project files. Page scripts get window.site:
  site.db.rows(table, where?) / insert(table, row) / update(table, id, patch) / remove(table, id) -> Promises; site.db.on(table, fn) on changes
  site.store.get(key, default) / set(key, value) / on(key, fn): small shared state across all frames (survives reloads)
  Relative links between .html files navigate inside the frame. There is no network: no CDN scripts, no remote images, no fetch.
Markdown files (README.md, notes, specs) render in the Docs panel. Read README.md first if there is one, and keep it current when you change pages or tables.

Working rules:
- Look before you change: list files, read the relevant ones (use files.lines for long files), check frames.
- Prefer files.replace for small edits; write whole files when creating or rewriting.
- Several small evals beat one huge one. Batch reads in one eval with par or Promise.all.
- After changing a page, check the effects in the eval result; call frames.check or frames.text when you need more.
- Your file writes go to the workspace session.workspace() names. If it is a proposal, the person reviews and accepts it; say what you changed so they can judge.
- In main, data tables are live: change rows only when asked. In a proposal, a table is copied into the proposal on its first write and main's rows change only when the person accepts it.
- When you add or change a flow (ordering, sign-up, a form), add or update a scenario for it and run it. Use a fixture for edge cases (empty table, long names, many rows).
- Mark milestones with session.mark("short label"); mark decisions and guesses with their kind, so the person can audit them later.
- When you will need something again (a file list, rows, frame ids), keep it in a top-level variable. When a helper will be useful in later sessions, save it with lib.def.
- Finish with a short summary in Markdown (short paragraphs, bullets, \`code\`; no big headings): what you changed, where, and anything left to do. Cite places as \`file:line\` (for example \`styles.css:73\`): they become links that open the file.`

// ---------- roles for subagents ----------
const ROLES = {
  explorer: { describe: 'Read-only investigator. Reads code, data and frames; answers with evidence and `file:line` links. Cannot write.', mode: 'read', evals: 12 },
  reviewer: { describe: 'Reviews a proposal: reads its diff, renders and checks its frames, and returns a verdict. Cannot write.', mode: 'read', evals: 12, output: '{verdict: "approve"|"changes", comments: string}' },
  qa: { describe: 'QA. Runs the scenarios (scenarios.runAll), writes new scenarios for important flows that have none (scenarios.save; fixtures.save for edge-case data), sweeps every frame for overflow, contrast, accessibility and console errors, and files a pin on each problem with ui.pin(frameId, target, text). May write only scenarios/ and fixtures/, not code or data.', mode: 'tests', evals: 16, output: '{pins: number, scenarios: {passed: number, failed: number, added: number}, summary: string}' },
  builder: { describe: 'Builds what it is asked in a proposal of its own (a workspace the person reviews), checks the frames, and summarizes what it changed.', mode: 'auto', own: true, evals: 20 }
}
const MAX_DEPTH = 2

// ---------- the agent: one sample() call per turn, the eval tool in a loop ----------
const Agent = {
  sample: null, ready: false, ev: emitter(), turns: new Map(),
  async init() {
    try { if (window.claude && window.claude.use) this.sample = await window.claude.use('sample') } catch { this.sample = null }
    this.ready = true; this.ev.emit('ready')
  },
  busy(tid) { return this.turns.has(tid) },
  anyBusy() { return this.turns.size > 0 },
  context(P, ws, th) {
    const files = P.list(ws).map(p => p + ' (' + P.read(p, ws).split('\n').length + ' lines)').join(', ')
    const tables = [...P.tablesIn(ws).values()].map(t => t.name + '[' + t.cols.join(',') + '] ' + t.rows.length + ' rows' + (ws !== 'main' && P.ownsTable(t.name, ws) ? ' (proposal copy)' : '')).join('; ') || 'none'
    const frames = P.board().frames.map(f => { const v = App.hostFor(f.id); return f.id + (f.label ? ' "' + f.label + '"' : '') + ' ' + (v ? v.route : f.route) + ' ' + f.w + 'x' + f.h + ' at ' + f.x + ',' + f.y + (v && v.errors ? ' ' + v.errors + ' errors' : '') + (v && v.issues.length ? ' ' + v.issues.length + ' issues' : '') }).join('; ')
    const sel = App.sel ? App.sel.tag + (App.sel.id ? '#' + App.sel.id : '') + (App.sel.cls ? '.' + App.sel.cls.split(' ').join('.') : '') + ' at ' + App.sel.src + ' in ' + App.sel.route + (App.sel.text ? ' "' + App.sel.text.slice(0, 60) + '"' : '') : 'nothing'
    const pins = (P.meta.pins || []).filter(p => !p.resolved).map(p => '#' + p.n + ' on ' + p.route + ' @' + (p.src || '?') + ': ' + p.text).join('\n') || 'none'
    const issues = []; for (const fh of FrameHosts) if (!fh.headless && fh.project === P) for (const i of fh.issues) issues.push(fh.route + ' ' + fh.w + 'px: ' + i.message + (i.src ? ' @' + i.src : ''))
    const props = P.openOverlays().map(o => o.id + ' "' + o.title + '" by ' + (o.by === 'agent' ? 'Claude' : 'you') + ', ' + plural(P.changes(o.id).length, 'change')).join('; ') || 'none'
    return 'Project "' + P.title + '". Workspace for your writes: ' + (ws === 'main' ? 'main (direct)' : 'proposal "' + (P.overlays.get(ws) || {}).title + '"') +
      '\nFiles: ' + files + '\nTables: ' + tables + '\nFrames: ' + frames + '\nOpen proposals: ' + props + '\nSelected: ' + sel + '\nOpen pins:\n' + pins + '\nCurrent check issues: ' + (issues.slice(0, 8).join('; ') || 'none') +
      '\nSaved lib functions: ' + (libEntries(P, ws).map(l => 'lib.' + l.name + '(' + l.params.join(', ') + ')' + (l.description ? ' — ' + l.description : '')).join('; ') || 'none') +
      '\nYour variables from earlier evals: ' + (th && th.scope ? (scopeSummary(th.scope) || 'none') + (th.scope.skipped && th.scope.skipped.length ? ' (not kept: ' + th.scope.skipped.join(', ') + ')' : '') : 'none')
  },
  // ---- what Claude sees of a thread: a running summary of older messages, then the recent ones verbatim ----
  HIST_CHARS: 28000, KEEP_CHARS: 12000, KEEP_MIN: 4, MAX_MSGS: 30,
  // one message as history; detail adds a line per eval (what it ran, how it went, what it changed)
  renderMsg(m, detail) {
    if (m.role === 'user') return (m.from ? '(from the ' + m.from + ') ' : '') + (m.text || '')
    const steps = m.steps || [], wrote = [...new Set(steps.flatMap(s => (s.calls || []).filter(c => /write|replace|remove|insert|update|save/.test(c))))]
    let t = m.text || (m.error ? '(failed: ' + m.error + ')' : '(no reply)')
    if (!steps.length) return t
    if (!detail) return t + '\n[' + plural(steps.length, 'eval') + (wrote.length ? ', used ' + wrote.join(', ') : '') + ']'
    return t + '\n[evals: ' + steps.map((s, k) => '\n  ' + (k + 1) + '. ' + (s.status === 'ok' ? '' : (s.status || '?') + ' ') + ((s.code || '').split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 90) +
      (s.status === 'error' && s.out ? ' → ' + s.out.slice(0, 120) : '') + (effectsLine(s.effects) ? ' → ' + effectsLine(s.effects).slice(0, 140) : '')).join('') + ']'
  },
  // fold older messages into th.summary when the history gets long. end: messages before the current exchange
  async compact(P, th, { end = th.msgs.length, force = false, signal, onStart } = {}) {
    const start = th.summary ? th.summary.upTo : 0
    if (end - start < 2) return null
    const sizes = th.msgs.slice(start, end).map(m => this.renderMsg(m, false).length), total = sizes.reduce((a, b) => a + b, 0)
    if (!force && total <= this.HIST_CHARS && sizes.length <= this.MAX_MSGS) return null
    // keep the newest messages verbatim (at least KEEP_MIN, up to KEEP_CHARS); the cut lands on a message from the person
    let keep = 0, acc = 0
    for (let k = sizes.length - 1; k >= 0; k--) { if (keep >= (force ? 2 : this.KEEP_MIN) && (force || acc + sizes[k] > this.KEEP_CHARS)) break; acc += sizes[k]; keep++ }
    let cut = end - keep
    while (cut > start && th.msgs[cut] && th.msgs[cut].role !== 'user') cut--
    if (cut <= start) { cut = end - keep; while (cut < end && th.msgs[cut].role !== 'user') cut++ }
    if (cut <= start || cut >= end) return null
    if (onStart) onStart(cut - start)
    const part = th.msgs.slice(start, cut), lastT = part[part.length - 1].t
    const marks = P.events.filter(e => e.kind === 'mark' && e.thread === th.id && e.t <= lastT && (!th.summary || e.t > th.summary.t0)).map(e => '- ' + (e.mk || 'mark') + ': ' + e.label + (e.note ? ' (' + e.note + ')' : ''))
    const transcript = part.map((m, k) => '[' + (start + k + 1) + '] ' + (m.role === 'user' ? 'Person: ' : 'Claude: ') + trunc(this.renderMsg(m, true), 3000)).join('\n\n')
    const prompt = 'You keep the running summary of a conversation between a person and Claude, a coding agent inside Sitebench (an IDE for small websites). Older messages are about to leave Claude\'s context; your summary replaces them, so Claude must be able to continue the work from it alone. Merge the previous summary with the new messages.\n\n' +
      'Write Markdown, at most 350 words, under these bold headings, skipping any with nothing under it:\n**Goals** what the person wants, constraints and preferences (their words where it matters)\n**Decisions** what was decided and why\n**Done** what was built or changed: files, tables, scenarios, fixtures, proposals (accepted, open or rejected)\n**Didn\'t work** what was tried and dropped, and why\n**Open** unanswered questions, things promised for later, known problems\n**Names** frame ids, variables, lib functions, fixtures and scenarios worth remembering\n\n' +
      'Be specific (file:line, names, numbers). Do not add anything that is not in the messages. Reply with the summary only.\n\n' +
      'Previous summary:\n' + (th.summary ? th.summary.text : '(none: this is the start of the thread)') + '\n\nMessages ' + (start + 1) + '–' + cut + ':\n' + trunc(transcript, 40000) + (marks.length ? '\n\nMarks on the timeline from this stretch:\n' + marks.join('\n') : '')
    let text = '', by = 'claude'
    try { if (this.sample) { const r = await this.sample(prompt, { modelTier: 'quick', cache: false, signal }); text = (r && r.text || '').trim() } } catch (e) { if (signal && signal.aborted) throw e }
    if (text.length < 40) { by = 'fallback'; text = this.plainSummary(th, start, cut) }
    th.summary = { upTo: cut, text: trunc(text, 6000), by, t: now(), t0: lastT, chars: total }
    P.saveThread(th)
    P.log({ kind: 'compact', who: 'ide', ws: 'main', thread: th.id, note: 'summarized messages 1–' + cut + ' of "' + th.title + '" for Claude' + (by === 'fallback' ? ' (without a model)' : '') })
    P.ev.emit('threads')
    return th.summary
  },
  // a summary without a model: the requests, the first line of each reply, the files written
  plainSummary(th, start, cut) {
    const out = th.summary ? [th.summary.text, ''] : [], req = [], rep = [], files = new Set()
    th.msgs.slice(start, cut).forEach((m, k) => {
      const n = start + k + 1
      if (m.role === 'user') req.push('- [' + n + '] ' + trunc((m.text || '').replace(/\s+/g, ' '), 200))
      else { const l = (m.text || m.error || '').split('\n').find(x => x.trim()); if (l) rep.push('- [' + n + '] ' + trunc(l.replace(/^#+\s*/, ''), 160)); for (const s of m.steps || []) for (const f of (s.effects && s.effects.files) || []) files.add(f.path) }
    })
    if (req.length) out.push('**Requests**', ...req)
    if (rep.length) out.push('**Replies**', ...rep)
    if (files.size) out.push('**Files written** ' + [...files].join(', '))
    return out.join('\n')
  },
  // the conversation so far (the model is memoryless), then the current state on the last user message
  messages(P, th, ws, text, head) {
    const start = th.summary ? th.summary.upTo : 0, end = Math.max(start, th.msgs.length - 2)
    const hist = th.msgs.slice(start, end), agentIdx = hist.map((m, k) => m.role === 'agent' ? k : -1).filter(k => k >= 0).slice(-2)
    let rendered = hist.map((m, k) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: this.renderMsg(m, agentIdx.includes(k)), skip: m.role !== 'user' && !m.text && !(m.steps && m.steps.length) }))
      .filter(m => !m.skip)
    // still too long (no summary yet, or one huge message): drop the oldest and say so
    let dropped = 0
    while (rendered.length > 2 && rendered.reduce((a, m) => a + m.content.length, 0) > this.HIST_CHARS) { rendered.shift(); dropped++ }
    while (rendered.length && rendered[0].role !== 'user') { rendered.shift(); dropped++ }
    const merged = []; for (const m of rendered) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.content += '\n\n' + m.content; else merged.push({ role: m.role, content: m.content }) }
    let earlier = ''
    if (th.summary) earlier = 'Earlier in this thread (messages 1–' + th.summary.upTo + ', summarized; session.recall(query) searches them and session.message(n) reads one in full):\n' + th.summary.text + '\n\n' + (merged.length ? 'The conversation continues:\n\n' : '')
    if (dropped) earlier += '(' + plural(dropped, 'older message') + ' not shown; session.recall(query) searches them.)\n\n'
    const cur = 'Current state:\n' + this.context(P, ws, th) + '\n\n' + (th.parent ? 'The main agent asks:\n' : 'The person says:\n') + text
    if (merged.length) { merged[0].content = head + earlier + merged[0].content; if (merged[merged.length - 1].role === 'user') merged.push({ role: 'assistant', content: '(continuing)' }); merged.push({ role: 'user', content: cur }) }
    else merged.push({ role: 'user', content: head + earlier + cur })
    return merged
  },
  // one model turn on a thread: the eval tool runs in the thread's sandbox session. Throws on failure.
  async turn(P, th, msg, text, o) {
    const ctx = { project: P, ws: o.ws, who: 'agent', thread: th.id, mode: th.mode, depth: o.depth || 0, budget: o.budget, role: th.role || null, tier: th.tier, model: th.model, signal: o.signal, children: [] }
    const api = hostAPI(ctx)
    ctx.onApproval = card => { msg.approval = card; this.ev.emit('step', th.id) }
    ctx.onPanel = id => { msg.panels = msg.panels || []; if (!msg.panels.includes(id)) msg.panels.push(id); this.ev.emit('step', th.id) }
    const tool = {
      name: 'eval',
      description: 'Run a JavaScript async function body in the Sitebench sandbox with the host API in scope (files, data, frames, ui, session, lib) and the term core (step, seq, par, delegate, …). Use `return` for the result. Returns {ok, value, logs, error, effects}.',
      inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript statements; may use await; return the value you want back' } }, required: ['code'] },
      execute: async input => {
        const code = String(input && input.code || '')
        const step = { code, t: now(), status: 'running' }
        msg.steps.push(step); this.ev.emit('step', th.id)
        const b = o.budget
        if (b.used >= b.max) { step.status = 'error'; step.out = 'eval budget used up'; this.ev.emit('step', th.id); throw new Error('eval budget (' + b.max + ' for this ' + (th.parent ? 'delegation' : 'turn') + ') used up: stop and summarize') }
        for (let x = b; x; x = x.parent) x.used++
        if (th.mode === 'ask') {
          step.status = 'ask'; this.ev.emit('step', th.id)
          const ok = await new Promise(res => { step.decide = res; if (o.signal) o.signal.addEventListener('abort', () => res(false)) })
          delete step.decide
          if (!ok) { step.status = 'skipped'; this.ev.emit('step', th.id); return JSON.stringify({ ok: false, error: { kind: 'declined', message: 'the person declined to run this eval; ask or try something else' } }) }
          step.status = 'running'; this.ev.emit('step', th.id)
        }
        const r = await runEval(ctx, code, api, { sid: th.id, restore: th.scope && th.scope.vars })
        step.ok = r.ok; step.ms = r.ms; step.engine = r.engine; step.calls = r.calls; step.effects = r.effects || undefined
        if (ctx.children.length) step.children = ctx.children.splice(0)
        if (r.scope) th.scope = r.scope
        step.logs = (r.logs || []).map(l => (l.level !== 'log' ? l.level + ': ' : '') + l.text)
        step.out = r.ok ? trunc(toYAML(r.value), 6000) : (r.error.kind + ': ' + r.error.message + (r.error.line ? ' (line ' + r.error.line + ')' : '')); step.fmt = r.ok ? 'yaml' : undefined
        step.status = r.ok ? 'ok' : 'error'
        P.log({ kind: 'eval', who: 'agent', ws: ctx.ws, thread: th.id, ok: r.ok, note: (code.split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 90), calls: [...new Set(r.calls || [])].slice(0, 12) })
        this.ev.emit('step', th.id)
        const out = { ok: r.ok, value: r.ok ? r.value : undefined, logs: step.logs.length ? step.logs : undefined, error: r.ok ? undefined : r.error, effects: r.effects || undefined }
        return trunc(JSON.stringify(out), 8000)
      }
    }
    const R = th.role && ROLES[th.role]
    const head = (R ? 'You are the ' + th.role + ' subagent, called by the main agent through delegate(). ' + R.describe + (R.mode === 'read' ? ' Writes are refused (policy errors); canvas arrangement and ui.pin are allowed.' : R.mode === 'tests' ? ' You may write only scenarios/ and fixtures/ (other writes are refused); canvas arrangement and ui.pin are allowed.' : '') + ' Reply to the main agent, briefly. Your budget is ' + o.budget.max + ' evals.\n\n' : '') + API_GUIDE + '\n\n'
    // long thread: fold older messages into the summary first
    try { await this.compact(P, th, { end: th.msgs.length - 2, signal: o.signal, onStart: n => { msg.note = 'Summarizing ' + plural(n, 'earlier message') + '…'; this.ev.emit('text', th.id) } }) } catch (e) { if (o.signal && o.signal.aborted) throw e }
    if (msg.note) { delete msg.note; this.ev.emit('text', th.id) }
    const res = await this.sample(this.messages(P, th, o.ws, text, head), { tools: [tool], onText: ({ text: t }) => { msg.text = t; this.ev.emit('text', th.id) }, signal: o.signal, modelTier: th.tier || 'default', cache: false, ...(th.model ? { model: th.model } : {}) })
    if (res && res.modelApplied) msg.model = res.modelApplied
    msg.text = res && res.text || msg.text; if (res && res.truncated) msg.text += '\n[reply truncated]'
    return msg.text
  },
  async send(P, th, text) {
    if (!this.sample) throw new Error('Claude is not available in this view')
    if (this.busy(th.id)) return
    const userMsg = { role: 'user', text, t: now(), ctx: { sel: App.sel ? { src: App.sel.src, tag: App.sel.tag, route: App.sel.route } : null, pins: (P.meta.pins || []).filter(p => !p.resolved).length } }
    th.msgs.push(userMsg)
    if (th.msgs.filter(m => m.role === 'user').length === 1 && /^Thread \d+$/.test(th.title)) th.title = text.slice(0, 32) + (text.length > 32 ? '…' : '')
    // pick the workspace
    let ws = 'main'
    if (th.mode !== 'read' && th.mode !== 'tests' && th.target === 'overlay') {
      let ov = th.ovId && P.overlays.get(th.ovId)
      if (!ov || ov.status !== 'open') { ov = P.newOverlay({ title: text.slice(0, 40) + (text.length > 40 ? '…' : ''), by: 'agent', thread: th.id }); th.ovId = ov.id }
      ws = ov.id
      if (App.ws !== ws) App.setWs(ws)
    } else if (th.mode === 'read' || th.mode === 'tests') ws = App.ws
    const msg = { role: 'agent', text: '', steps: [], t: now(), ws, status: 'running', tier: th.tier }
    th.msgs.push(msg)
    const abort = new AbortController(), turn = { abort, msg, thread: th }
    this.turns.set(th.id, turn); this.ev.emit('turn', th.id)
    P.log({ kind: 'msg', who: 'you', ws, thread: th.id, note: text.slice(0, 140) })
    try {
      await this.turn(P, th, msg, text, { ws, depth: 0, budget: { max: 30, used: 0, parent: null }, signal: abort.signal })
      msg.status = 'done'
    } catch (e) {
      const code = e && e.code
      msg.status = abort.signal.aborted ? 'stopped' : 'error'
      msg.error = abort.signal.aborted ? 'Stopped.' : code === 'not_granted' ? 'Claude is not available for this page (not granted).' : code === 'rate_limited' ? 'Rate limited: wait a little and send again.' : (e && e.message || String(e))
      if (e && e.text && !msg.text) msg.text = e.text
      if (code === 'not_granted') { this.sample = null; this.ev.emit('ready') }
    } finally {
      this.turns.delete(th.id); msg.approval = null
      for (const s of msg.steps) if (s.status === 'running' || s.status === 'ask') s.status = 'skipped'
      const ov = ws !== 'main' && P.overlays.get(ws)
      const changed = ov ? P.changes(ws).length : 0
      if (ov && ov.status === 'open' && !changed && !Object.keys(ov.files).length && !P.tableChanges(ov.id).length) { ov.status = 'discarded'; P.saveOverlay(ov); th.ovId = null; P.ev.emit('overlays'); if (App.ws === ws) App.setWs('main') }
      msg.summary = changed ? plural(changed, 'file') + ' changed in "' + ov.title + '"' : ''
      P.log({ kind: 'turn', who: 'agent', ws, thread: th.id, ok: msg.status === 'done', note: (msg.text || msg.error || '').split('\n')[0].slice(0, 140), evals: msg.steps.length })
      P.saveThread(th); P.ev.emit('threads')
      this.ev.emit('turn', th.id)
      if (changed) toast('Proposal ready: ' + plural(changed, 'file') + ' to review')
    }
  },
  // delegate(role, task): a subagent with its own thread, sandbox session and timeline lane. Its evals come
  // out of the caller's budget; it may delegate in turn, to a depth of 2.
  async delegate(pctx, role, task, opts = {}) {
    const R = ROLES[role]
    if (!R) throw Object.assign(new Error('no role "' + role + '". Roles: ' + Object.keys(ROLES).join(', ')), { kind: 'invalid' })
    if (!this.sample) throw Object.assign(new Error('Claude is not available in this view'), { kind: 'unavailable' })
    if ((pctx.depth || 0) >= MAX_DEPTH) throw Object.assign(new Error('delegation depth is capped at ' + MAX_DEPTH), { kind: 'budget' })
    const pb = pctx.budget || { max: 30, used: 0, parent: null }
    const room = Math.min(...(function* () { for (let x = pb; x; x = x.parent) yield x.max - x.used })())
    const want = Math.min(opts.evals || R.evals, room - 1)
    if (want < 1) throw Object.assign(new Error('not enough eval budget left to delegate (' + room + ' left)'), { kind: 'budget' })
    const budget = { max: want, used: 0, parent: pb }
    const P = pctx.project
    const th = P.newThread(role + ': ' + task.replace(/\s+/g, ' ').slice(0, 40))
    Object.assign(th, { parent: pctx.thread || 'eval', role, mode: R.mode, target: R.own ? 'overlay' : 'main', tier: opts.tier || pctx.tier || 'default', model: opts.model !== undefined ? opts.model : (pctx.model || null) })
    let ws = pctx.ws, ov = null
    if (R.own) { ov = P.newOverlay({ title: role + ': ' + task.replace(/\s+/g, ' ').slice(0, 36), by: 'agent', thread: th.id }); th.ovId = ov.id; ws = ov.id }
    let prompt = task
    if (role === 'reviewer') {
      const target = opts.proposal || (pctx.ws !== 'main' ? pctx.ws : (P.openOverlays().slice(-1)[0] || {}).id)
      if (!target || !P.overlays.get(target)) throw Object.assign(new Error('reviewer needs a proposal: pass { proposal: id } (open: ' + (P.openOverlays().map(o => o.id).join(', ') || 'none') + ')'), { kind: 'invalid' })
      ws = target
      const tch = P.tableChanges(target).map(c => 'table ' + c.name + ': ' + (c.created ? 'new, ' : c.dropped ? 'dropped' : '') + (c.dropped ? '' : '+' + c.added.length + ' −' + c.removed.length + ' ~' + c.changed.length + ' rows')).join('\n')
      prompt += '\n\nYou are reviewing proposal "' + P.overlays.get(target).title + '" (id ' + target + '; your reads and frame checks see it). frames.compare(frameId) lists its layout changes against main; scenarios.runAll() runs the scenarios against it. Its changes against main:\n' + trunc(P.changes(target).map(c => diffText(c.path, c.before, c.after)).join('\n\n'), 7000) + (tch ? '\n\nData changes (proposal copies of tables):\n' + tch : '')
    }
    const out = opts.output || R.output
    if (out) prompt += '\n\nEnd your reply with JSON only (no code fences), matching: ' + out
    th.msgs.push({ role: 'user', text: task, t: now(), from: pctx.role || 'main agent' })
    const msg = { role: 'agent', text: '', steps: [], t: now(), ws, status: 'running', tier: th.tier }
    th.msgs.push(msg)
    const abort = new AbortController()
    if (pctx.signal) { if (pctx.signal.aborted) abort.abort(); else pctx.signal.addEventListener('abort', () => abort.abort()) }
    this.turns.set(th.id, { abort, msg, thread: th }); this.ev.emit('turn', th.id); P.ev.emit('threads')
    if (pctx.children) pctx.children.push({ thread: th.id, role })
    P.log({ kind: 'delegate', who: pctx.who || 'agent', ws: pctx.ws, thread: pctx.thread, note: role + ': ' + task.slice(0, 120), child: th.id })
    let failure = null
    try { await this.turn(P, th, msg, prompt, { ws, depth: (pctx.depth || 0) + 1, budget, signal: abort.signal }); msg.status = 'done' }
    catch (e) { failure = e; msg.status = abort.signal.aborted ? 'stopped' : 'error'; msg.error = e && e.message || String(e) }
    finally {
      this.turns.delete(th.id)
      for (const s of msg.steps) if (s.status === 'running' || s.status === 'ask') s.status = 'skipped'
      P.log({ kind: 'turn', who: 'agent', ws, thread: th.id, ok: msg.status === 'done', note: (msg.text || msg.error || '').split('\n')[0].slice(0, 140), evals: msg.steps.length })
      P.saveThread(th); P.ev.emit('threads'); this.ev.emit('turn', th.id)
    }
    const changes = ov ? [...P.changes(ov.id).map(c => c.path), ...P.tableChanges(ov.id).map(c => 'table ' + c.name)] : undefined
    if (ov && !changes.length && ov.status === 'open') { ov.status = 'discarded'; P.saveOverlay(ov); P.ev.emit('overlays') }
    if (failure) throw Object.assign(new Error(role + ' failed: ' + (msg.error || 'unknown') + ' (thread ' + th.id + ')'), { kind: abort.signal.aborted ? 'cancelled' : 'agent' })
    const parsed = out ? parseJSONReply(msg.text || '') : undefined
    return { role, thread: th.id, evals: budget.used, result: parsed !== undefined ? parsed : (msg.text || ''), text: trunc(msg.text || '', 4000),
      proposal: ov && changes.length ? ov.id : undefined, changes: ov ? changes : undefined }
  },
  stop(tid) { const t = this.turns.get(tid); if (t) t.abort.abort() }
}

// ===== 07-dock.js =====
// ---------- dock: tiles of tabbed views, split by dragging, gutters, floating windows, named layouts (form-skate) ----------
const Views = {}            // id -> {title, make(): {el, show?, hide?}}
function registerView(id, def) { Views[id] = def }
const tile = (views, active) => ({ t: 'tile', id: uid('t'), views, active: active || views[0] })
const split = (dir, kids, sizes) => ({ t: 'split', id: uid('s'), dir, kids, sizes: sizes || kids.map(() => 1 / kids.length) })

const LAYOUTS = {
  Build: () => split('row', [
    tile(['agent', 'evalrepl']),
    split('col', [tile(['canvas', 'timeline']), tile(['console', 'data', 'scenarios'])], [0.7, 0.3]),
    split('col', [tile(['code', 'review', 'docs']), tile(['inspector', 'layers', 'panels'])], [0.56, 0.44])
  ], [0.24, 0.47, 0.29]),
  Code: () => split('row', [
    tile(['code']), split('col', [tile(['canvas']), tile(['agent', 'console'])], [0.55, 0.45])
  ], [0.55, 0.45]),
  Review: () => split('row', [
    tile(['review', 'scenarios', 'timeline', 'docs']), split('col', [tile(['canvas']), tile(['agent', 'code'])], [0.6, 0.4])
  ], [0.42, 0.58]),
  Data: () => split('row', [
    split('col', [tile(['data']), tile(['evalrepl', 'console'])], [0.6, 0.4]), tile(['canvas', 'agent'])
  ], [0.5, 0.5]),
  Canvas: () => split('row', [tile(['canvas']), tile(['inspector', 'layers', 'agent', 'panels'])], [0.74, 0.26])
}

function normalize(n) {
  if (!n) return null
  if (n.t === 'tile') { if (!n.views.length) return null; if (!n.views.includes(n.active)) n.active = n.views[0]; return n }
  const kids = [], sizes = []
  n.kids.forEach((k, i) => {
    const c = normalize(k); if (!c) return
    if (c.t === 'split' && c.dir === n.dir) c.kids.forEach((kk, j) => { kids.push(kk); sizes.push(n.sizes[i] * c.sizes[j]) })
    else { kids.push(c); sizes.push(n.sizes[i]) }
  })
  if (!kids.length) return null
  if (kids.length === 1) return kids[0]
  const sum = sizes.reduce((a, b) => a + b, 0) || 1
  return Object.assign(n, { kids, sizes: sizes.map(s => s / sum) })
}
function walkTiles(n, fn, parent) { if (!n) return; if (n.t === 'tile') fn(n, parent); else n.kids.forEach(k => walkTiles(k, fn, n)) }
function tileOf(layout, view) { let r = null; walkTiles(layout, t => { if (t.views.includes(view)) r = t }); return r }
function tileById(layout, id) { let r = null; walkTiles(layout, t => { if (t.id === id) r = t }); return r }
function replaceNode(n, id, rep) { if (!n) return n; if (n.id === id) return rep; if (n.t === 'split') n.kids = n.kids.map(k => replaceNode(k, id, rep)); return n }

const Dock = {
  layout: null, floats: [], inst: {}, el: null, work: null, ev: emitter(), dragging: null, z: 0,
  mount(work) {
    this.work = work; this.el = h('div.dock'); work.appendChild(this.el)
    new ResizeObserver(() => this.ev.emit('resize')).observe(this.el)
  },
  instance(id) {
    if (!this.inst[id]) {
      const def = Views[id]; if (!def) return null
      const v = def.make(); v.el.classList.add('view'); v.el.dataset.view = id; this.inst[id] = v
    }
    return this.inst[id]
  },
  isOpen(id) { return !!tileOf(this.layout, id) || this.floats.some(f => f.view === id) },
  set(layout, floats) { this.layout = normalize(layout); if (floats) this.floats = floats.filter(f => Views[f.view] && !tileOf(this.layout, f.view)); this.render(); this.changed() },
  changed: debounce(function () { App.savePrefs() }, 600),
  // ---- operations ----
  detach(view) {
    walkTiles(this.layout, t => { const i = t.views.indexOf(view); if (i >= 0) { t.views.splice(i, 1); if (t.active === view) t.active = t.views[Math.max(0, i - 1)] } })
    this.floats = this.floats.filter(f => f.view !== view)
  },
  addTab(view, tileId, index) {
    this.detach(view); const t = tileById(this.layout, tileId) || this.biggest()
    if (!t) { this.layout = tile([view]); return }
    t.views.splice(index == null ? t.views.length : clamp(index, 0, t.views.length), 0, view); t.active = view
  },
  splitWith(view, tileId, side) {
    const t0 = tileById(this.layout, tileId); if (!t0) return
    if (t0.views.length === 1 && t0.views[0] === view) return
    this.detach(view)
    const t = tileById(this.layout, tileId) || this.biggest()
    const nt = tile([view]), dir = side === 'left' || side === 'right' ? 'row' : 'col', first = side === 'left' || side === 'top'
    const copy = { ...t }, sp = split(dir, first ? [nt, copy] : [copy, nt], [0.5, 0.5])
    this.layout = t === this.layout ? sp : replaceNode(this.layout, t.id, sp)
  },
  float(view, x, y) {
    const r = this.work.getBoundingClientRect()
    this.detach(view)
    this.floats.push({ view, x: clamp(x ?? r.width / 2 - 220, 0, r.width - 200), y: clamp(y ?? 60, 0, r.height - 120), w: 460, h: 380 })
  },
  open(view, near) {         // show a view: activate if docked, else add it beside `near` or in the biggest tile
    if (!Views[view]) return
    const t = tileOf(this.layout, view)
    if (t) { t.active = view; this.renderTile(t); return this.changed() }
    if (this.floats.some(f => f.view === view)) return
    const target = near ? tileOf(this.layout, near) : null
    this.addTab(view, (target || this.biggest() || {}).id); this.apply()
  },
  close(view) { this.detach(view); this.apply() },
  biggest() { let best = null, area = -1; walkTiles(this.layout, t => { const el = this.el.querySelector('[data-tile="' + t.id + '"]'); const r = el ? el.getBoundingClientRect() : { width: 1, height: 1 }; if (r.width * r.height > area) { area = r.width * r.height; best = t } }); return best },
  apply() { this.layout = normalize(this.layout); if (!this.layout) this.layout = tile(['canvas']); this.render(); this.changed() },

  // ---- rendering ----
  render() {
    for (const v of Object.values(this.inst)) v.el.remove()
    clear(this.el)
    if (this.layout) this.el.appendChild(this.node(this.layout))
    $$('.float', this.work).forEach(f => f.remove())
    for (const f of this.floats) this.work.appendChild(this.floatEl(f))
    for (const [id, v] of Object.entries(this.inst)) { const vis = this.visible(id); if (vis !== v._vis) { v._vis = vis; vis ? v.show && v.show() : v.hide && v.hide() } }
    this.ev.emit('render')
  },
  visible(id) { const t = tileOf(this.layout, id); return t ? t.active === id : this.floats.some(f => f.view === id) },
  node(n) {
    if (n.t === 'tile') return h('div.dcell', { style: { flex: '1 1 0' } }, this.tileEl(n))
    const wrap = h('div.dsplit.' + n.dir)
    n.kids.forEach((k, i) => {
      if (i) wrap.appendChild(this.gutter(n, i, wrap))
      const c = k.t === 'tile' ? h('div.dcell', this.tileEl(k)) : h('div.dcell', this.node(k))
      c.style.flex = n.sizes[i] + ' 1 0'; wrap.appendChild(c)
    })
    return wrap
  },
  tileEl(t) {
    const strip = h('div.dstrip'), tabs = h('div.dtabs'), body = h('div.tilebody')
    const el = h('div.tile', { 'data-tile': t.id }, strip, body)
    for (const v of t.views) {
      const def = Views[v]; if (!def) continue
      const tab = h('div.dtab' + (t.active === v ? '.on' : ''), { 'data-view': v },
        h('button.lbl', { title: def.title + ' (drag to move or split)', on: { pointerdown: e => this.tabDown(e, v, t) } }, def.title, def.badge ? def.badge() : null),
        h('button.x', { title: 'Close ' + def.title, on: { click: e => { e.stopPropagation(); this.close(v) } } }, '×'))
      tabs.appendChild(tab)
    }
    strip.append(tabs, h('span.sp'),
      h('button.tabact', { title: 'Add a view here', on: { click: e => this.pick(e.currentTarget, t) } }, '+'),
      h('button.tabact', { title: 'Float this view', on: { click: () => { this.float(t.active); this.apply() } } }, '⧉'))
    for (const v of t.views) { const inst = this.instance(v); if (!inst) continue; inst.el.style.display = v === t.active ? '' : 'none'; body.appendChild(inst.el) }
    return el
  },
  renderTile(t) {
    const el = this.el.querySelector('[data-tile="' + t.id + '"]'); if (!el) return this.render()
    $$('.dtab', el).forEach(tb => tb.classList.toggle('on', tb.dataset.view === t.active))
    for (const v of t.views) { const inst = this.inst[v]; if (!inst) continue; const on = v === t.active; inst.el.style.display = on ? '' : 'none'; if (on !== inst._vis) { inst._vis = on; on ? inst.show && inst.show() : inst.hide && inst.hide() } }
  },
  refreshTabs() { walkTiles(this.layout, t => { const el = this.el.querySelector('[data-tile="' + t.id + '"]'); if (!el) return; for (const v of t.views) { const lbl = el.querySelector('.dtab[data-view="' + v + '"] .lbl'); if (lbl && Views[v].badge) { lbl.querySelector('.count')?.remove(); const b = Views[v].badge(); if (b) lbl.appendChild(b) } } }) },
  pick(btn, t) {
    const items = [{ group: 'Views' }]
    for (const [id, def] of Object.entries(Views)) items.push({ label: def.title, sub: this.isOpen(id) ? (t.views.includes(id) ? 'here' : 'move here') : def.sub || '', run: () => { this.addTab(id, t.id); this.apply() } })
    popMenu(btn, items, { right: true })
  },
  gutter(n, i, wrap) {
    const g = h('div.gutter.' + n.dir)
    g.addEventListener('pointerdown', e => {
      e.preventDefault(); g.setPointerCapture(e.pointerId)
      const cells = [...wrap.children].filter(c => c.classList.contains('dcell')), a = cells[i - 1], b = cells[i]
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), total = n.sizes[i - 1] + n.sizes[i]
      const span = n.dir === 'row' ? ra.width + rb.width : ra.height + rb.height, start = n.dir === 'row' ? e.clientX : e.clientY, s0 = n.sizes[i - 1]
      document.body.classList.add(n.dir === 'row' ? 'resizing-x' : 'resizing-y')
      const move = ev => {
        const d = ((n.dir === 'row' ? ev.clientX : ev.clientY) - start) / span * total
        const s = clamp(s0 + d, 0.06 * total, total - 0.06 * total)
        n.sizes[i - 1] = s; n.sizes[i] = total - s; a.style.flex = s + ' 1 0'; b.style.flex = (total - s) + ' 1 0'
      }
      const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); document.body.classList.remove('resizing-x', 'resizing-y'); this.changed(); this.ev.emit('resize') }
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up)
    })
    return g
  },
  // ---- tab drag: tabs zone (insert), edges (split), center (join), outside (float) ----
  tabDown(e, view, t) {
    if (e.button !== 0) return
    const sx = e.clientX, sy = e.clientY
    let ghost = null, hint = null, target = null
    const move = ev => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        ghost = h('div.drag-ghost', Views[view].title, ' ', h('small', 'drop on a tab strip, an edge, or outside to float'))
        hint = h('div.drop-hint'); document.body.append(ghost, hint); document.body.classList.add('dragging-view')
      }
      ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 12 + 'px'
      target = this.dropTarget(ev.clientX, ev.clientY, view)
      if (!target) { hint.hidden = true; return }
      hint.hidden = false; hint.className = 'drop-hint' + (target.marker ? ' marker' : '')
      Object.assign(hint.style, { left: target.rect.x + 'px', top: target.rect.y + 'px', width: target.rect.w + 'px', height: target.rect.h + 'px' })
      hint.innerHTML = target.marker ? '' : '<span>' + target.label + '</span>'
    }
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up)
      if (!ghost) { t.active = view; this.renderTile(t); this.changed(); return }
      ghost.remove(); hint.remove(); document.body.classList.remove('dragging-view')
      if (!target) return
      if (target.kind === 'tabs') this.addTab(view, target.tile, target.index)
      else if (target.kind === 'edge') this.splitWith(view, target.tile, target.side)
      else if (target.kind === 'center') this.addTab(view, target.tile)
      else if (target.kind === 'float') { const r = this.work.getBoundingClientRect(); this.float(view, ev.clientX - r.left - 100, ev.clientY - r.top - 15) }
      this.apply()
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  },
  dropTarget(x, y, view) {
    const dr = this.el.getBoundingClientRect()
    if (x < dr.left || x > dr.right || y < dr.top || y > dr.bottom) return { kind: 'float', label: 'Float', rect: { x: x - 110, y: y - 16, w: 220, h: 32 } }
    for (const el of $$('.tile', this.el)) {
      const r = el.getBoundingClientRect(); if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
      const id = el.dataset.tile, strip = el.querySelector('.dstrip').getBoundingClientRect()
      if (y <= strip.bottom) {
        const tabs = $$('.dtab', el).filter(tb => tb.dataset.view !== view)
        let index = tabs.length, mx = tabs.length ? tabs[tabs.length - 1].getBoundingClientRect().right : strip.left + 4
        for (let i = 0; i < tabs.length; i++) { const tr = tabs[i].getBoundingClientRect(); if (x < tr.left + tr.width / 2) { index = i; mx = tr.left; break } }
        return { kind: 'tabs', tile: id, index, marker: true, rect: { x: mx - 1, y: strip.top + 4, w: 2, h: strip.height - 8 } }
      }
      const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height, band = 0.22
      const sides = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]].filter(s => s[1] < band).sort((a, b) => a[1] - b[1])
      if (sides.length) {
        const s = sides[0][0], R = { x: r.left, y: r.top, w: r.width, h: r.height }
        if (s === 'left') R.w /= 2; if (s === 'right') { R.x += r.width / 2; R.w /= 2 } if (s === 'top') R.h /= 2; if (s === 'bottom') { R.y += r.height / 2; R.h /= 2 }
        return { kind: 'edge', tile: id, side: s, label: 'Split ' + s, rect: R }
      }
      return { kind: 'center', tile: id, label: 'Add as tab', rect: { x: r.left + 8, y: r.top + 8, w: r.width - 16, h: r.height - 16 } }
    }
    return null
  },
  floatEl(f) {
    const def = Views[f.view], inst = this.instance(f.view)
    const head = h('div.fhead', h('span', def.title), h('small', 'floating'), h('span.sp'),
      h('button.ibtn', { title: 'Dock it back', on: { click: () => { this.addTab(f.view, (this.biggest() || {}).id); this.apply() } } }, '⇲'),
      h('button.ibtn', { title: 'Close', on: { click: () => this.close(f.view) } }, '×'))
    const body = h('div.fbody'), el = h('div.float', { style: { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' } }, head, body)
    if (inst) { inst.el.style.display = ''; body.appendChild(inst.el) }
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return
      e.preventDefault(); head.setPointerCapture(e.pointerId); document.body.classList.add('moving')
      const sx = e.clientX - f.x, sy = e.clientY - f.y, R = this.work.getBoundingClientRect()
      const move = ev => { f.x = clamp(ev.clientX - sx, -f.w + 80, R.width - 80); f.y = clamp(ev.clientY - sy, 0, R.height - 30); el.style.left = f.x + 'px'; el.style.top = f.y + 'px' }
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); document.body.classList.remove('moving'); this.changed() }
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up)
    })
    new ResizeObserver(() => { if (!el.isConnected) return; const w = el.offsetWidth, hh = el.offsetHeight; if (w && (w !== f.w || hh !== f.h)) { f.w = w; f.h = hh; this.changed(); this.ev.emit('resize') } }).observe(el)
    el.addEventListener('pointerdown', () => { el.style.zIndex = 30 + (++this.z) }, true)
    return el
  }
}

// ===== 08-canvas.js =====
// ---------- canvas: boards of live frames, pan and zoom, flows, pins, proposal rows (shop-next's app side) ----------
const SIZES = [{ w: 375, h: 720, n: 'Phone' }, { w: 768, h: 900, n: 'Tablet' }, { w: 1280, h: 800, n: 'Desktop' }]
registerView('canvas', {
  title: 'Canvas', sub: 'live frames',
  badge: () => { const n = App.health(); return n ? h('span.count.bad', String(n)) : null },
  make() {
    const C = { views: new Map(), z: 1, x: 40, y: 40, compare: false, flows: true, fitted: false }
    const world = h('div.world'), flows = svgEl('svg', { class: 'flows', width: 1, height: 1 })
    const hud = h('div.cvhud'), pop = h('div')
    const cv = h('div.cv', world, hud, pop)
    world.appendChild(flows)
    const zoomLbl = h('button.btn.sm', { title: 'Reset to 100%', on: { click: () => zoomTo(1) } }, '100%')
    const cmpBtn = h('button.btn.sm', { title: 'Show main and the proposal one above the other', on: { click: () => { C.compare = !C.compare; sync() } } }, 'Compare')
    const mxRoute = h('select.sel', { title: 'Page shown in every cell of the matrix', style: { height: '24px', fontSize: '11px' }, hidden: true, on: { change: () => { C.mxRoute = mxRoute.value; sync() } } })
    const mxBtn = h('button.btn.sm', { title: 'Matrix: one row per proposal (and main), one column per viewport', on: { click: () => { C.matrix = !C.matrix; C.fitted = false; sync() } } }, 'Matrix')
    const flowBtn = h('button.btn.sm.on', { title: 'Arrows for links between pages', on: { click: () => { C.flows = !C.flows; flowBtn.classList.toggle('on', C.flows); drawFlows() } } }, 'Flows')
    const bar = h('div.toolbar',
      h('div.rel', h('button.btn.sm', { on: { click: e => addFrameMenu(e.currentTarget) } }, '+ Frame')),
      h('span.lbl', 'Zoom'), h('button.btn.sm', { on: { click: () => zoomTo(C.z / 1.25) } }, '−'), zoomLbl, h('button.btn.sm', { on: { click: () => zoomTo(C.z * 1.25) } }, '+'),
      h('button.btn.sm', { on: { click: () => fit() } }, 'Fit'), h('span.sp'), mxRoute, mxBtn, cmpBtn, flowBtn,
      h('button.btn.sm', { title: 'Run layout and accessibility checks on every frame', on: { click: () => { for (const v of C.views.values()) v.host.runCheck(); toast('Checking frames…') } } }, 'Check'))
    const el = h('div', bar, cv)

    function apply() {
      world.style.transform = `translate(${C.x}px, ${C.y}px) scale(${C.z})`
      world.style.setProperty('--zb', (1 / C.z) + 'px')    // frame outlines stay one screen pixel at any zoom
      zoomLbl.textContent = Math.round(C.z * 100) + '%'; positionPop()
      for (const v of C.views.values()) v.scaleHead()
    }
    function zoomTo(z, cx, cy) {
      const r = cv.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2
      const nz = clamp(z, 0.1, 3), wx = (cx - C.x) / C.z, wy = (cy - C.y) / C.z
      C.z = nz; C.x = cx - wx * nz; C.y = cy - wy * nz; apply(); saveView()
    }
    function bounds() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const v of C.views.values()) { const p = v.pos(); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y - 30); x1 = Math.max(x1, p.x + v.fr.w); y1 = Math.max(y1, p.y + v.fr.h) }
      return isFinite(x0) ? { x0, y0, x1, y1 } : null
    }
    function fit() {
      const b = bounds(), r = cv.getBoundingClientRect(); if (!b || !r.width) { C.fitted = false; return }
      const z = clamp(Math.min((r.width - 60) / (b.x1 - b.x0), (r.height - 60) / (b.y1 - b.y0)), 0.1, 1.2)
      C.z = z; C.x = (r.width - (b.x1 - b.x0) * z) / 2 - b.x0 * z; C.y = (r.height - (b.y1 - b.y0) * z) / 2 - b.y0 * z; apply(); saveView()
    }
    const saveView = debounce(() => { const P = App.P; if (P) { P.meta.view = { x: C.x, y: C.y, z: C.z }; P.saveMeta() } }, 800)

    // pan: drag the background; wheel pans, ctrl/cmd+wheel (or pinch) zooms
    cv.addEventListener('pointerdown', e => {
      if (e.target !== cv && e.target !== world && e.target !== flows) return
      if (e.button !== 0 && e.button !== 1) return
      e.preventDefault(); cv.setPointerCapture(e.pointerId); cv.classList.add('panning'); document.body.classList.add('moving')
      const sx = e.clientX - C.x, sy = e.clientY - C.y
      const move = ev => { C.x = ev.clientX - sx; C.y = ev.clientY - sy; apply() }
      const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.classList.remove('panning'); document.body.classList.remove('moving'); saveView() }
      cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up)
      closePop()
    })
    cv.addEventListener('wheel', e => {
      e.preventDefault()
      const r = cv.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomTo(C.z * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top)
      else { C.x -= e.deltaX; C.y -= e.deltaY; apply(); saveView() }
    }, { passive: false })

    // ---- frames ----
    function frameView(fr, role, ws) {
      const P = App.P
      const host = new FrameHost({ project: P, route: fr.route, w: fr.w, h: fr.h, ws, fid: fr.id + (role === 'p' ? ':p' : ''), fixture: fr.fixture || null, at: role === 'a' ? App.playhead : null })
      const routeSel = h('select.route', { title: 'Page in this frame', on: { change: () => { if (host.rec) host.recStep({ go: routeSel.value }); else if (role === 'a') { fr.route = routeSel.value; App.P.saveMeta() } host.navigate(routeSel.value) } } })
      const back = h('button.fact', { title: 'Back to this frame\'s page', hidden: true, on: { click: () => host.navigate(fr.route) } }, '↩')
      const meta = h('span.meta'), status = h('div.fstatus', { hidden: true }), flabel = h('b.flabel', { title: 'Double-click the header to rename' })
      const fxTag = h('span.tag.fx', { hidden: true, title: 'This frame runs against a fixture, not the live data', on: { click: e => frameMenu(e.currentTarget, v) } })
      const recBar = h('div.recbar', { hidden: true })
      const v = { fr, role, host, el: null, pos: () => role === 'p' ? { x: v.fr.x, y: v.fr.y + C.rowH + 110 } : { x: v.fr.x, y: v.fr.y } }
      const head = h('div.fh', flabel, routeSel, meta, h('span.sp'),
        role === 'p' ? h('span.tag.ws', 'proposal') : null, fxTag, back,
        role === 'a' ? h('div.rel', h('button.fact', { title: 'Viewport size', on: { click: e => sizeMenu(e.currentTarget, fr) } }, '⇔')) : null,
        role !== 'm' ? h('button.fact', { title: 'Data, snapshots, recording', on: { click: e => frameMenu(e.currentTarget, v) } }, '⋯') : null,
        h('button.fact', { title: 'Reload', on: { click: () => host.load({ keepState: false }) } }, '↻'),
        role === 'a' ? h('button.fact', { title: 'Close frame', on: { click: () => App.P.removeFrame(fr.id) } }, '×') : null)
      const body = h('div.fb', host.el, status, recBar)
      v.el = h('div.frm' + (ws !== 'main' ? '.prop' : '') + (role === 'm' ? '.mx' : ''), head, body)
      v.scaleHead = () => { const k = clamp(1 / C.z, 0.6, 6); head.style.transform = 'scale(' + k + ')'; head.style.width = fr.w / k + 'px' }
      v.paint = () => {
        const p = v.pos(); Object.assign(v.el.style, { left: p.x + 'px', top: p.y + 'px', width: v.fr.w + 'px' })
        clear(routeSel); for (const r of App.P.list(host.ws).filter(x => /\.html?$/.test(x))) routeSel.appendChild(h('option', { value: r, selected: r === host.route }, r))
        routeSel.hidden = role === 'm'
        if (![...routeSel.options].some(o => o.value === host.route)) routeSel.appendChild(h('option', { value: host.route, selected: true }, host.route + ' (missing)'))
        back.hidden = role === 'm' || host.route === v.fr.route; back.title = 'Back to ' + v.fr.route
        flabel.textContent = v.fr.label || ''; flabel.hidden = !v.fr.label; routeSel.classList.toggle('sub', !!fr.label)
        meta.textContent = v.fr.w + '×' + v.fr.h + (host.errors ? ' · ' + plural(host.errors, 'error') : '') + (host.issues.length ? ' · ' + plural(host.issues.length, 'issue') : '')
        meta.style.color = host.errors || host.issues.length ? 'var(--accent)' : ''
        v.el.classList.toggle('past', host.at != null)
        fxTag.hidden = !host.fixture && !host.rec; fxTag.textContent = host.rec ? 'recording' : host.fixture ? 'fixture: ' + host.fixture : ''; fxTag.title = host.rec ? 'Recording on a copy of the data' : 'Runs on fixtures/' + host.fixture + '.json instead of the live data (click to change)'
        recBar.hidden = !host.rec
        if (host.rec) put(clear(recBar), h('span.dot'), h('b', 'Recording'), h('span', plural(host.rec.steps.length, 'step') + (host.rec.steps.length ? ' · last: ' + stepLabel(host.rec.steps[host.rec.steps.length - 1]).slice(0, 48) : ' · click and type in Play mode; pick an element in Select mode to check its text')), h('span.sp'),
          h('button.btn.sm', { on: { click: async () => { await host.stopRecording(); v.paint() } } }, 'Discard'),
          h('button.btn.sm.primary', { on: { click: async () => { const r = await host.stopRecording(); v.paint(); await saveRecording(App.P, r, host.ws) } } }, 'Stop and save'))
        status.hidden = !host.errors; status.textContent = host.errors ? (host.logs.filter(l => l.level === 'error').slice(-1)[0] || {}).text || '' : ''
        v.el.classList.toggle('sel', !!App.sel && App.sel.fid === host.fid)
        v.scaleHead()
      }
      host.ev.on('rec', () => v.paint()); host.ev.on('issues', () => { v.paint(); Dock.refreshTabs() }); host.ev.on('log', l => { if (l.level === 'error') v.paint() })
      host.ev.on('nav', () => { v.paint(); drawFlows() })   // following a link is temporary: the frame keeps its page (↩ goes back)
      head.addEventListener('dblclick', async e => {
        if (e.target.closest('button, select') || role !== 'a') return
        const n = await promptBox('Label this frame', 'A name shown above the frame (empty to clear)', fr.label || ''); if (n === null) return
        fr.label = n || undefined; App.P.saveMeta(); v.paint()
      })
      // drag the header to move the frame
      head.addEventListener('pointerdown', e => {
        if (e.target.closest('button, select') || role !== 'a') return
        e.preventDefault(); head.setPointerCapture(e.pointerId); document.body.classList.add('moving')
        const sx = e.clientX, sy = e.clientY, x0 = fr.x, y0 = fr.y
        const move = ev => { fr.x = Math.round(x0 + (ev.clientX - sx) / C.z); fr.y = Math.round(y0 + (ev.clientY - sy) / C.z); v.paint(); for (const o of C.views.values()) if (o.fr === fr && o !== v) o.paint(); drawFlows() }
        const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); document.body.classList.remove('moving'); layoutRows(); App.P.saveMeta() }
        head.addEventListener('pointermove', move); head.addEventListener('pointerup', up)
      })
      world.appendChild(v.el); v.paint(); host.load()
      return v
    }
    function layoutRows() { const fs = App.P && !C.matrix ? App.P.board().frames : []; C.rowH = fs.reduce((m, f) => Math.max(m, f.y + f.h), 0); for (const v of C.views.values()) v.paint(); drawFlows() }
    function sync() {
      const P = App.P, props = P ? P.openOverlays() : []
      mxBtn.hidden = !P || !props.length; if (mxBtn.hidden) C.matrix = false
      mxBtn.classList.toggle('on', !!C.matrix); mxRoute.hidden = !C.matrix
      cmpBtn.hidden = !P || App.ws === 'main' || C.matrix; cmpBtn.classList.toggle('on', C.compare && App.ws !== 'main')
      const want = new Map()
      if (P && C.matrix) {
        // one row per workspace (main, then each open proposal), one column per viewport the board uses
        const routes = [...new Set([...P.list('main'), ...props.flatMap(o => P.list(o.id))].filter(x => /\.html?$/.test(x)))]
        if (!routes.includes(C.mxRoute)) C.mxRoute = (App.sel && routes.includes(App.sel.route) && App.sel.route) || (P.board().frames[0] || {}).route || routes[0]
        clear(mxRoute); for (const r of routes) mxRoute.appendChild(h('option', { value: r, selected: r === C.mxRoute }, r))
        const sizes = [...new Map(P.board().frames.map(f => [f.w + 'x' + f.h, { w: f.w, h: f.h }])).values()].sort((a, b) => a.w - b.w)
        if (!sizes.length) sizes.push({ w: 375, h: 720 })
        const rowH = Math.max(...sizes.map(s => s.h)) + 120
        ;[{ id: 'main', title: 'main' }, ...props].forEach((o, r) => {
          let x = 0
          for (const sz of sizes) {
            const key = 'mx|' + o.id + '|' + sz.w + 'x' + sz.h + '|' + C.mxRoute
            want.set(key, { role: 'm', ws: o.id, fr: { id: 'mx:' + o.id + ':' + sz.w + 'x' + sz.h, route: C.mxRoute, w: sz.w, h: sz.h, x, y: r * rowH, label: (o.id === 'main' ? 'main' : o.title) + ' · ' + sz.w + 'px' } })
            x += sz.w + 60
          }
        })
      } else if (P) for (const fr of P.board().frames) {
        const past = App.playhead != null
        want.set(fr.id + '|a', { fr, role: 'a', ws: past || (C.compare && App.ws !== 'main') ? 'main' : App.ws })
        if (!past && C.compare && App.ws !== 'main') want.set(fr.id + '|p', { fr, role: 'p', ws: App.ws })
      }
      for (const [k, v] of C.views) {
        const w = want.get(k)
        if (!w || v.host.ws !== w.ws || v.host.project !== P) { v.host.dispose(); v.el.remove(); C.views.delete(k) }
        else { if (w.role === 'm') v.fr = w.fr; if (v.host.w !== w.fr.w || v.host.h !== w.fr.h) { v.host.size(w.fr.w, w.fr.h); v.host.load() } }
      }
      for (const [k, w] of want) if (!C.views.has(k)) C.views.set(k, frameView(w.fr, w.role, w.ws))
      layoutRows(); hudPaint()
      if (P && !C.fitted) { C.fitted = true; if (P.meta.view) { Object.assign(C, P.meta.view); apply() } else requestAnimationFrame(fit) }
    }
    function drawFlows() {
      clear(flows); if (!C.flows || !App.P) return
      const P = App.P, prim = [...C.views.values()].filter(v => v.role === 'a'), first = new Map()
      for (const v of prim) if (!first.has(v.host.route)) first.set(v.host.route, v)
      flows.appendChild(svgEl('defs', {}, svgEl('marker', { id: 'arr', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svgEl('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'var(--ink-2)' }))))
      const seen = new Set()
      for (const v of first.values()) {
        const html = P.read(v.host.route, v.host.ws) || ''
        for (const m of html.matchAll(/href\s*=\s*["']([^"'#?]+\.html?)/gi)) {
          const to = first.get(m[1]); if (!to || to === v || seen.has(v.host.route + '>' + m[1])) continue
          seen.add(v.host.route + '>' + m[1])
          const a = v.pos(), b = to.pos(), right = b.x > a.x
          const x1 = right ? a.x + v.fr.w : a.x, y1 = a.y + 30 + Math.min(80, v.fr.h / 4), x2 = right ? b.x : b.x + to.fr.w, y2 = b.y + 30 + Math.min(80, to.fr.h / 4)
          const back = seen.has(m[1] + '>' + v.host.route)
          flows.appendChild(svgEl('path', { d: `M${x1},${y1 + (back ? 24 : 0)} C${x1 + (right ? 30 : -30)},${y1 + (back ? 24 : 0)} ${x2 + (right ? -30 : 30)},${y2 + (back ? 24 : 0)} ${x2},${y2 + (back ? 24 : 0)}`, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.4 / Math.max(C.z, 0.3), 'stroke-dasharray': back ? '4 4' : null, 'marker-end': 'url(#arr)' }))
        }
      }
    }
    // move every primary frame to the playhead; while a step is loading, only the latest one is kept
    let phBusy = false, phNext = undefined
    async function playhead() {
      if (phBusy) { phNext = App.playhead; return }
      phBusy = true
      try {
        const at = App.playhead
        await Promise.all([...C.views.values()].filter(v => v.role === 'a' && v.host.at !== at).map(v => { v.host.at = at; v.host.fx = null; v.host.saved = null; return v.host.load({ keepState: false }).then(() => v.paint()) }))
      } finally { phBusy = false }
      hudPaint()
      if (phNext !== undefined) { phNext = undefined; playhead() }
    }
    C.playhead = playhead
    function hudPaint() {
      clear(hud)
      if (App.playhead != null && App.P) {
        const P = App.P, e = P.events[App.playhead] || {}, pe = App.pageEvents(P), k = pe.findIndex(x => x.i >= App.playhead)
        const step = d => { const list = App.pageEvents(P), j = d < 0 ? [...list].reverse().find(x => x.i < App.playhead) : list.find(x => x.i > App.playhead); if (j) App.setPlayhead(j.i); else if (d > 0) App.setPlayhead(null) }
        hud.append(h('span.chip.on.past', 'as of ' + fmtTime(e.t)), h('span.note', (e.kind === 'write' ? (e.created ? 'created ' : 'wrote ') + e.path : e.kind === 'remove' ? 'removed ' + e.path : e.label || e.note || e.kind) + (e.who === 'agent' ? ' · Claude' : '')),
          h('button.btn.sm', { title: 'Previous change to the pages', on: { click: () => step(-1) } }, '◀'), h('button.btn.sm', { title: 'Next change to the pages', on: { click: () => step(1) } }, '▶'),
          h('button.btn.sm.primary', { title: 'Back to the pages as they are now', on: { click: () => App.setPlayhead(null) } }, 'Now'))
        return
      }
      hud.append(h('span.chip.on', App.mode), h('span.chip', App.ws === 'main' ? 'main' : 'proposal: ' + ((App.P && App.P.overlays.get(App.ws)) || {}).title))
      if (App.mode === 'select') hud.append(h('span.note', 'click to select · double-click text to edit'))
      if (App.mode === 'comment') hud.append(h('span.note', 'click to drop a pin'))
    }
    function addFrameMenu(btn) {
      const P = App.P; if (!P) return
      const routes = P.list(App.ws).filter(x => /\.html?$/.test(x)), items = []
      for (const r of routes) { items.push({ group: r }); for (const s of SIZES) items.push({ label: s.n + ' ' + s.w + '×' + s.h, run: () => { const f = P.addFrame({ route: r, w: s.w, h: s.h }); setTimeout(() => focusFrame(f.id), 50) } }) }
      popMenu(btn, items)
    }
    // the frame's ⋯ menu: which data it runs against, snapshots and comparisons, recording a scenario
    function frameMenu(btn, v) {
      const P = App.P, host = v.host, fr = v.fr, fxs = fixtureList(P, host.ws)
      const snaps = Snaps.list(P).filter(s => s.route === host.route && s.w === fr.w).slice(-6).reverse()
      const items = [{ group: 'Data' },
        { label: 'Live data', sub: host.ws === 'main' ? 'main' : 'this proposal', on: !host.fixture, disabled: !!host.rec, run: () => setFx(v, null) },
        ...fxs.map(x => ({ label: 'Fixture: ' + x.name, sub: x.error ? 'invalid JSON' : [x.tables.join(', '), x.clock ? 'clock ' + x.clock : ''].filter(Boolean).join(' · '), on: host.fixture === x.name, disabled: !!x.error || !!host.rec, run: () => setFx(v, x.name) })),
        host.fixture ? { label: 'Reset fixture data', sub: 'undo what the page changed', run: () => host.resetData() } : null,
        { label: 'New fixture from live data…', run: async () => { const n = await promptBox('New fixture', 'Saves a copy of the current tables as fixtures/<name>.json; edit it to make edge cases (empty, long names, many rows).', 'sample'); if (!n) return
          const tables = {}; for (const [k, t] of P.tablesIn(host.ws)) tables[k] = t.rows
          const name = n.replace(/[^\w-]/g, '-'); P.write(fixturePath(name), JSON.stringify({ description: '', tables, clock: null }, null, 2) + '\n', { ws: host.ws, who: 'you', note: 'new fixture' }); setFx(v, name); App.code && App.code.open(fixturePath(name)) } },
        { hr: true }, { group: 'Snapshots' },
        { label: 'Take snapshot', sub: 'a frozen copy of the page and its layout', run: async () => { const m = await Snaps.take(P, host, { label: (fr.label || host.route) + ' ' + fmtTime(now()) }); if (m) toast('Snapshot of ' + host.route + ' kept') } },
        ...snaps.map(s => ({ label: 'Compare with ' + (s.label || fmtTime(s.t)), sub: s.ws !== host.ws ? s.ws === 'main' ? 'main' : 'proposal' : s.note || '', run: () => compareWithSnap(v, s) })),
        App.ws !== 'main' ? { label: 'Compare main with this proposal', sub: 'layout differences on ' + host.route, run: () => compareWs(v, 'main', App.ws) } : null,
        { hr: true }, { group: 'Scenarios' },
        host.rec ? { label: 'Stop recording…', run: async () => { const r = await host.stopRecording(); v.paint(); await saveRecording(P, r, host.ws) } }
          : { label: 'Record a scenario', sub: 'on a copy of the data; replays with Run', disabled: role(v) === 'm', run: async () => { if (App.mode !== 'play') App.setMode('play'); await host.startRecording(fr); v.paint() } }]
      popMenu(btn, items, { right: true })
    }
    const role = v => v.role
    function setFx(v, name) { v.fr.fixture = name || undefined; App.P.saveMeta(); for (const o of C.views.values()) if (o.fr === v.fr) o.host.setFixture(name).then(() => o.paint()); App.P.log({ kind: 'canvas', ws: 'main', who: 'you', note: (v.fr.label || v.fr.route) + (name ? ' runs on fixture ' + name : ' runs on live data') }) }
    async function compareWithSnap(v, s) {
      const P = App.P, doc = await Snaps.load(P, s.id); if (!doc) return toast('That snapshot is gone')
      const cur = await Snaps.capture(v.host), diff = layoutDiff(doc.layout, cur.layout)
      compareModal(P, v.host.route + ': ' + (s.label || fmtTime(s.t)) + ' → now', { label: s.label || fmtTime(s.t), doc, meta: s }, { label: 'now', doc: cur, meta: cur }, diff)
    }
    async function compareWs(v, a, b) {
      const P = App.P, fr = { ...v.fr, route: v.host.route }
      try {
        const A = (await layoutIn(P, fr, a, { headless: true })).fh, B = (await layoutIn(P, fr, b, { headless: true })).fh
        const [sa, sb] = [await Snaps.capture(A), await Snaps.capture(B)]
        const title = t => t === 'main' ? 'main' : 'proposal: ' + ((P.overlays.get(t) || {}).title || t)
        compareModal(P, v.host.route + ' ' + fr.w + 'px: ' + title(a) + ' → ' + title(b), { label: title(a), doc: sa, meta: sa }, { label: title(b), doc: sb, meta: sb }, layoutDiff(sa.layout, sb.layout))
      } catch (e) { toast('Could not compare: ' + e.message) }
    }
    C.compareWs = (fid, a, b) => { const v = [...C.views.values()].find(x => x.fr.id === fid && x.role === 'a'); if (v) return compareWs(v, a, b) }
    function sizeMenu(btn, fr) {
      popMenu(btn, SIZES.map(s => ({ label: s.n, sub: s.w + '×' + s.h, on: fr.w === s.w && fr.h === s.h, run: () => { fr.w = s.w; fr.h = s.h; App.P.saveMeta(); App.P.ev.emit('frames') } })), { right: true })
    }
    function focusFrame(fid) {
      const v = [...C.views.values()].find(x => x.host.fid === fid || x.fr.id === fid); if (!v) return
      const r = cv.getBoundingClientRect(), p = v.pos()
      const vis = p.x * C.z + C.x > 0 && (p.x + v.fr.w) * C.z + C.x < r.width && p.y * C.z + C.y > 0
      if (!vis) { C.x = r.width / 2 - (p.x + v.fr.w / 2) * C.z; C.y = 50 - (p.y - 30) * C.z; apply(); saveView() }
    }

    // ---- pins popover ----
    let popState = null
    function closePop() { clear(pop); popState = null }
    function positionPop() {
      if (!popState) return
      const v = [...C.views.values()].find(x => x.host === popState.host); if (!v) return closePop()
      const p = v.pos(), box = pop.firstChild; if (!box) return
      box.style.left = clamp((p.x + popState.x) * C.z + C.x + 14, 4, cv.clientWidth - 270) + 'px'; box.style.top = clamp((p.y + popState.y) * C.z + C.y - 10, 4, cv.clientHeight - 140) + 'px'
    }
    C.newPin = (host, m) => {
      closePop()
      const ta = h('textarea.txt', { placeholder: 'What should change here?' })
      const save = () => {
        const text = ta.value.trim(); if (!text) return closePop()
        const P = App.P, n = (P.meta.pins || []).reduce((a, p) => Math.max(a, p.n), 0) + 1
        P.meta.pins.push({ id: 'pin' + uid(), n, route: host.route, src: m.info.src, selector: m.info.selector, rx: +m.rx.toFixed(3), ry: +m.ry.toFixed(3), text, by: 'you', t: now(), resolved: false })
        P.saveMeta(); P.log({ kind: 'pin', who: 'you', ws: 'main', note: '#' + n + ' ' + text.slice(0, 100), path: m.info.src.split(':')[0] }); App.ev.emit('pins'); closePop()
      }
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') closePop() })
      pop.appendChild(h('div.pinpop', h('b', 'Pin on ' + (m.info.tag || 'element') + ' '), h('span.note', m.info.src || host.route), ta,
        h('div', { style: { display: 'flex', gap: '6px' } }, h('button.btn.sm.primary', { on: { click: save } }, 'Save pin'), h('button.btn.sm', { on: { click: closePop } }, 'Cancel'), h('span.sp'), h('span.note', '⌘↵'))))
      popState = { host, x: m.x, y: m.y }; positionPop(); setTimeout(() => ta.focus(), 20)
    }
    C.showPin = (id, host) => {
      const P = App.P, p = (P.meta.pins || []).find(x => x.id === id); if (!p) return
      closePop()
      pop.appendChild(h('div.pinpop', h('b', '#' + p.n + ' '), h('span.note', (p.by === 'you' ? 'You' : p.by) + ' · ' + fmtAgo(p.t) + (p.resolved ? ' · resolved' : '')),
        h('div', { style: { whiteSpace: 'pre-wrap' } }, p.text), p.reply ? h('div.note', '↳ ' + p.reply) : null,
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          !p.resolved ? h('button.btn.sm', { on: { click: () => { App.askAgent('Address pin #' + p.n + ' on ' + p.route + ': ' + p.text); closePop() } } }, 'Ask agent') : null,
          h('button.btn.sm', { on: { click: () => { p.resolved = !p.resolved; P.saveMeta(); App.ev.emit('pins'); closePop() } } }, p.resolved ? 'Reopen' : 'Resolve'),
          h('button.btn.sm.danger', { on: { click: () => { P.meta.pins = P.meta.pins.filter(x => x !== p); P.saveMeta(); App.ev.emit('pins'); closePop() } } }, 'Delete'),
          h('span.sp'), h('button.btn.sm', { on: { click: closePop } }, 'Close'))))
      const hostRef = host || [...C.views.values()].find(v => v.host.route === p.route)?.host
      if (!hostRef) return
      popState = { host: hostRef, x: hostRef.w * 0.5, y: 40 }; positionPop()
    }
    C.sync = sync; C.paintAll = () => { for (const v of C.views.values()) v.paint(); hudPaint() }; C.focusFrame = focusFrame; C.fit = fit; C.zoomTo = zoomTo
    C.hostsFor = fid => [...C.views.values()].filter(v => v.fr.id === fid).map(v => v.host)
    C.hostFor = fid => { for (const v of C.views.values()) if (v.fr.id === fid && v.role === 'a') return v.host; return null }
    C.reset = () => { for (const v of C.views.values()) { v.host.dispose(); v.el.remove() } C.views.clear(); C.fitted = false; C.compare = false; closePop() }
    App.canvas = C
    return { el, show: () => { if (!C.fitted) sync() } }
  }
})

// ===== 09-views.js =====
// ---------- code view: file list, tabs, editor with highlighting; edits write to the current workspace ----------
registerView('code', {
  title: 'Code', sub: 'files',
  make() {
    const S = { tabs: [], cur: null, filter: '', pending: null, hiLine: 0 }
    const list = h('div.fl'), filter = h('input.txt', { placeholder: 'Filter files', style: { margin: '6px', width: 'calc(100% - 12px)' }, on: { input: () => { S.filter = filter.value.toLowerCase(); paintList() } } })
    const side = h('div.flist', h('div.toolbar', h('span.lbl', 'Files'), h('span.sp'), h('button.btn.sm', { title: 'New file', on: { click: newFile } }, '+ New')), filter, list)
    const tabs = h('div.ftabs')
    const gin = h('div.gin'), gutter = h('div.egutter', gin), bin = h('div.bin'), bcol = h('div.eblame', { hidden: true }, bin)
    const pre = h('pre'), band = h('div', { style: { position: 'absolute', left: 0, right: 0, height: '18px', background: 'var(--sel)', pointerEvents: 'none', display: 'none' } })
    const ta = h('textarea', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off', wrap: 'off' })
    const code = h('div.code', band, pre, ta), ed = h('div.ed', bcol, gutter, code)
    const prev = h('div.mdprev', { hidden: true }), edrow = h('div.edrow', ed, prev)
    S.view = {}
    const isMd = p => /\.(md|markdown)$/i.test(p || '')
    const mdMode = () => isMd(S.cur) ? (S.view[S.cur] || (main.clientWidth >= 640 ? 'split' : 'code')) : 'code'
    function paintPreview() {
      const m = mdMode()
      prev.hidden = m === 'code'; ed.hidden = m === 'preview'
      if (m === 'code') return
      const st = prev.scrollTop
      clear(prev).appendChild(renderMarkdown(ta.value, f => !!P() && P().read(f, App.ws) !== null, { doc: true }))
      prev.scrollTop = st
    }
    const previewSoon = debounce(paintPreview, 150)
    prev.addEventListener('click', e => { const r = e.target.closest('[data-file]'); if (r) { e.preventDefault(); isMd(r.dataset.file) ? open(r.dataset.file) : App.reveal(r.dataset.file, +r.dataset.line || 1) } })
    const foot = h('div.efoot'), empty = h('p.empty', 'Open a file from the list, or select an element on the canvas to jump to its source.')
    const main = h('div.cmain', tabs, edrow, foot, empty)
    const el = h('div', h('div.cview', side, main))
    const P = () => App.P

    function paintList() {
      clear(list); if (!P()) return
      const ws = App.ws, ch = ws !== 'main' ? new Set(P().changes(ws).map(c => c.path)) : new Set()
      let dir = null
      for (const path of P().list(ws)) {
        if (S.filter && !path.toLowerCase().includes(S.filter)) continue
        const d = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        if (d !== dir) { dir = d; if (d) list.appendChild(h('div.fi.dir', d + '/')) }
        list.appendChild(h('button.fi' + (path === S.cur ? '.on' : ''), { title: path, on: { click: () => open(path) } }, d ? path.slice(d.length + 1) : path, ch.has(path) ? h('span.ch', 'M') : null))
      }
      if (ws !== 'main') for (const c of P().changes(ws)) if (c.deleted) list.appendChild(h('button.fi', { disabled: true, style: { textDecoration: 'line-through', opacity: 0.6 } }, c.path))
    }
    function paintTabs() {
      clear(tabs)
      for (const p of S.tabs) tabs.appendChild(h('span.ftab' + (p === S.cur ? '.on' : ''), h('button', { on: { click: () => open(p) } }, p.split('/').pop()), h('button.x', { title: 'Close', on: { click: () => closeTab(p) } }, '×')))
    }
    function closeTab(p) { commit(); S.tabs = S.tabs.filter(x => x !== p); if (S.cur === p) S.cur = S.tabs[S.tabs.length - 1] || null; load(); paintTabs(); paintList() }
    function paintCode() {
      pre.innerHTML = highlight(S.cur, ta.value) + '\n'
      const n = ta.value.split('\n').length; let s = ''
      for (let i = 1; i <= n; i++) s += '<div' + (i === S.hiLine ? ' class="hit"' : '') + '>' + i + '</div>'
      gin.innerHTML = s; paintBlame(); scroll()
    }
    function scroll() { pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; gin.style.transform = bin.style.transform = `translateY(${-ta.scrollTop}px)`; if (S.hiLine) band.style.top = (10 + (S.hiLine - 1) * 18 - ta.scrollTop) + 'px' }
    // blame: who last changed each run of lines (through accepted proposals, back to who wrote them)
    function blameData() {
      const p = P(), snap = S.snap && S.snap.path === S.cur ? S.snap : null
      const key = S.cur + '|' + App.ws + '|' + p.events.length + '|' + (snap ? snap.i : '')
      if (S.bkey !== key) { S.bkey = key; S.bdata = snap ? p.blame(S.cur, 'main', snap.i) : p.blame(S.cur, App.ws) }
      return S.bdata
    }
    function paintBlame() {
      bcol.hidden = !S.blame || !S.cur || !P(); if (bcol.hidden) return
      const p = P(), at = blameData(), n = ta.value.split('\n').length, saved = S.snap && S.snap.path === S.cur ? S.snap.text : p.read(S.cur, App.ws)
      const ids = [...new Set(at)].sort((a, b) => a - b), rank = new Map(ids.map((x, k) => [x, ids.length > 1 ? k / (ids.length - 1) : 1]))
      let s = '', prev = null
      for (let k = 0; k < n; k++) {
        const i = ta.value === saved ? at[k] : (k < at.length ? at[k] : undefined), e = i != null ? p.events[i] : null
        if (!e) { s += '<div class="u">' + (prev === 'u' ? '' : 'unsaved') + '</div>'; prev = 'u'; continue }
        const who = e.who === 'agent' ? 'Claude' : e.who === 'ide' ? 'Sitebench' : e.kind === 'init' ? 'template' : 'you', head = i !== prev
        s += '<div class="' + (head ? 'h' : 'c') + '" data-i="' + i + '" style="--age:' + (0.25 + 0.75 * rank.get(i)).toFixed(2) + '">' + (head ? escHtml(who + ' · ' + fmtAgo(e.t2 || e.t)) : '') + '</div>'
        prev = i
      }
      bin.innerHTML = s
    }
    bin.addEventListener('click', ev => {
      const d = ev.target.closest('[data-i]'); if (!d) return
      const i = +d.dataset.i, rows = [...bin.children], k = rows.indexOf(d)
      let a = k; while (a > 0 && rows[a - 1].dataset.i === d.dataset.i) a--
      let b = k; while (b < rows.length - 1 && rows[b + 1].dataset.i === d.dataset.i) b++
      blameCard(P(), S.cur, i, a + 1, b + 1)
    })
    bin.addEventListener('mouseover', ev => { const d = ev.target.closest('[data-i]'); if (!d || d.title) return; const w = P().why(+d.dataset.i); if (w) d.title = blameTitle(w) })
    function paintFoot() {
      clear(foot); if (!S.cur || !P()) return
      if (S.snap && S.snap.path === S.cur) return paintHistFoot()
      const ws = App.ws, inOv = ws !== 'main', changed = inOv && P().changes(ws).some(c => c.path === S.cur)
      const nv = P().versions(S.cur, ws).length
      const pos = ta.value.slice(0, ta.selectionStart).split('\n')
      put(foot, h('b', S.cur), h('span', 'Ln ' + pos.length + ', Col ' + (pos[pos.length - 1].length + 1)), h('span', inOv ? 'editing proposal "' + (P().overlays.get(ws) || {}).title + '"' : 'editing main'),
        S.pending ? h('span', 'unsaved…') : null,
        S.trace ? h('span', { style: { color: S.trace.elements ? 'var(--a1)' : '' } }, '↳ ' + (S.trace.selector ? S.trace.selector.slice(0, 30) + ' matches ' : 'renders ') + plural(S.trace.elements, 'element') + (S.trace.elements ? ' in ' + plural(S.trace.frames, 'frame') : ''),
          ' ', h('button.link', { title: 'Clear the outlines (Esc)', on: { click: () => { App.trace(null); S.trace = null; paintFoot() } } }, '×')) : null,
        h('span.sp'),
        isMd(S.cur) ? h('div.seg.sm', [['code', 'Code'], ['split', 'Split'], ['preview', 'Preview']].map(([v, l]) => h('button' + (mdMode() === v ? '.on' : ''), { on: { click: () => { S.view[S.cur] = v; paintPreview(); paintFoot() } } }, l))) : null,
        isMd(S.cur) ? h('button.btn.sm', { on: { click: () => App.openDoc(S.cur) } }, 'Open in Docs') : null,
        changed ? h('button.btn.sm', { on: { click: () => { const ov = P().overlays.get(ws); delete ov.files[S.cur]; delete ov.base[S.cur]; P().saveOverlay(ov); P().ev.emit('files', ws, [S.cur]); P().ev.emit('overlays') } } }, 'Revert to main') : null,
        nv > 1 ? h('div.rel', h('button.btn.sm', { title: 'Earlier versions of this file, from the timeline', on: { click: e => historyMenu(e.currentTarget) } }, 'History ' + nv)) : null,
        h('button.btn.sm' + (S.blame ? '.on' : ''), { title: 'Who last changed each line, and why', on: { click: () => { S.blame = !S.blame; paintBlame(); paintFoot() } } }, 'Blame'),
        h('button.btn.sm', { on: { click: () => App.askAgent('About ' + S.cur + ' line ' + pos.length + ': ') } }, 'Ask agent'),
        h('button.btn.sm.danger', { on: { click: async () => { if (await confirmBox('Delete ' + S.cur + '?', inOv ? 'The deletion goes into the proposal.' : 'This removes the file from main. The timeline keeps its history.', 'Delete')) { P().remove(S.cur, { ws: App.ws }); closeTab(S.cur) } } } }, 'Delete'))
    }
    function load(keepView) {
      const snap = S.snap && S.snap.path === S.cur ? S.snap : null
      const has = !!S.cur && !!P() && (!!snap || P().read(S.cur, App.ws) !== null)
      edrow.hidden = foot.hidden = !has; empty.hidden = has
      ta.readOnly = !!snap; edrow.classList.toggle('hist', !!snap); foot.classList.toggle('hist', !!snap)
      if (!has) return
      const st = ta.scrollTop, sl = ta.scrollLeft, ss = ta.selectionStart, se = ta.selectionEnd
      ta.value = snap ? (snap.text ?? '') : P().read(S.cur, App.ws)
      if (keepView) { ta.scrollTop = st; ta.scrollLeft = sl; ta.setSelectionRange(Math.min(ss, ta.value.length), Math.min(se, ta.value.length)) } else { ta.scrollTop = 0; ta.scrollLeft = 0 }
      paintCode(); paintFoot(); paintPreview()
    }
    function open(path, line, keepSnap) {
      commit()
      if (!keepSnap && S.snap) S.snap = null
      if (!S.tabs.includes(path)) S.tabs.push(path)
      const same = S.cur === path; S.cur = path; paintTabs(); paintList(); load(same)
      if (line) goto(line)
    }
    function goto(line) {
      const off = offsetOfLine(ta.value, line); ta.focus({ preventScroll: true }); ta.setSelectionRange(off, off)
      ta.scrollTop = Math.max(0, (line - 1) * 18 - ta.clientHeight / 3)
      S.hiLine = line; band.style.display = ''; paintCode(); clearTimeout(S.hiT); S.hiT = setTimeout(() => { S.hiLine = 0; band.style.display = 'none'; paintCode() }, 2600)
    }
    const commitSoon = debounce(() => commit(), 450)
    function commit() {
      if (!S.pending || !P()) return
      const { path, ws, text } = S.pending; S.pending = null
      try { P().write(path, text, { ws, who: 'you' }) } catch (e) { toast(e.message) }
      paintFoot()
    }
    ta.addEventListener('input', () => { S.pending = { path: S.cur, ws: App.ws, text: ta.value }; paintCode(); commitSoon(); if (isMd(S.cur)) previewSoon() })
    ta.addEventListener('scroll', scroll)
    ta.addEventListener('keyup', () => { paintFoot(); traceSoon() }); ta.addEventListener('click', () => { paintFoot(); traceSoon() })
    // the caret's line (HTML) or rule (CSS) outlines what it renders in every frame
    const traceSoon = debounce(async () => {
      let t = null
      if (S.cur && !S.snap && document.activeElement === ta) {
        const off = ta.selectionStart, line = ta.value.slice(0, off).split('\n').length
        if (/\.html?$/i.test(S.cur)) t = { file: S.cur, line }
        else if (/\.css$/i.test(S.cur)) { const b = cssBlocks(ta.value).find(b => off >= b.selStart && off <= b.bodyEnd + 1); if (b && b.sel) t = { selector: b.sel.replace(/\s+/g, ' ').trim(), file: S.cur } }
      }
      if (!t && !App.traceTarget) return
      S.trace = await App.trace(t); paintFoot()
    }, 200)
    App.ev.on('trace', () => { S.trace = null; paintFoot() })
    ta.addEventListener('blur', () => commit())
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')) }
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); toast('Saved') }
    })
    async function newFile() {
      const p = await promptBox('New file', 'Path, like about.html or css/theme.css', 'about.html'); if (!p) return
      const bad = validPath(p); if (bad) return toast(bad)
      if (P().read(p, App.ws) !== null) return open(p)
      const tpl = /\.md$/i.test(p) ? '# ' + p.replace(/\.md$/i, '').split('/').pop() + '\n\n' : /\.html?$/.test(p) ? '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>' + p + '</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <h1>' + p + '</h1>\n</body>\n</html>\n' : ''
      P().write(p, tpl, { ws: App.ws }); open(p)
    }
    App.ev.on('project', () => { S.tabs = []; S.cur = null; S.pending = null; paintTabs(); paintList(); load() })
    App.ev.on('ws', () => { commit(); paintList(); load(true) })
    App.ev.on('files', (ws, paths) => { paintList(); if (S.snap) { paintFoot(); return } if (S.cur && paths.includes(S.cur) && !S.pending && (ws === App.ws || ws === 'main')) load(true) })
    // ---- history: any saved version of the file, read-only, in step with the timeline ----
    const who = v => v.who === 'agent' ? 'Claude' : v.who === 'site' ? 'a page' : 'you'
    const vlabel = v => (v.kind === 'init' ? 'start' : v.kind === 'remove' ? 'removed' : 'saved') + ' by ' + who(v) + (v.ws !== 'main' ? ' (proposal)' : '')
    function showVersion(path, i) {
      const list = P().versions(path, App.ws); if (!list.length) return toast('No saved versions of ' + path)
      const v = list.find(x => x.i === i) || list[list.length - 1]
      commit(); S.snap = { path, ...v, list }
      if (!S.tabs.includes(path)) S.tabs.push(path)
      S.cur = path; paintTabs(); paintList(); load(false)
      App.ev.emit('version', { path, i: v.i })
    }
    function historyMenu(btn) {
      const list = P().versions(S.cur, App.ws)
      popMenu(btn, [{ group: S.cur + ' · ' + plural(list.length, 'version') }, ...list.slice().reverse().slice(0, 40).map((v, k) => ({
        label: (k === 0 ? 'Latest · ' : '') + fmtTime(v.t), sub: vlabel(v) + (v.note ? ' · ' + v.note.slice(0, 40) : ''), run: () => showVersion(S.cur, v.i) }))], { right: true })
    }
    function paintHistFoot() {
      const s = S.snap, k = s.list.findIndex(x => x.i === s.i), cur = P().read(s.path, App.ws)
      const same = cur === s.text, latest = k === s.list.length - 1
      put(foot, h('b', s.path), h('span', 'version ' + (k + 1) + ' of ' + s.list.length + ' · ' + fmtTime(s.t) + ' · ' + vlabel(s)), s.note ? h('span', s.note.slice(0, 60)) : null,
        h('span', same ? '(same as current)' : latest ? '' : ''), h('span.sp'),
        h('button.btn.sm', { disabled: k <= 0, title: 'Older version', on: { click: () => showVersion(s.path, s.list[k - 1].i) } }, '◀'),
        h('button.btn.sm', { disabled: latest, title: 'Newer version', on: { click: () => showVersion(s.path, s.list[k + 1].i) } }, '▶'),
        h('button.btn.sm', { disabled: same, on: { click: () => modal({ title: s.path + ': ' + fmtTime(s.t) + ' → current', wide: true, body: diffView(s.text ?? '', cur ?? ''), actions: [{ label: 'Close' }] }) } }, 'Diff vs current'),
        h('button.btn.sm', { disabled: same || s.text === null, on: { click: () => { P().write(s.path, s.text, { ws: App.ws, who: 'you', note: 'restored the ' + fmtTime(s.t) + ' version' }); S.snap = null; load(true); toast('Restored ' + s.path) } } }, 'Restore this version'),
        h('button.btn.sm.primary', { on: { click: () => { S.snap = null; load(false); App.ev.emit('version', null) } } }, 'Back to current'))
    }
    App.ev.on('sel', s => { if (s && s.src && Dock.visible('code')) { const [f, l] = s.src.split(':'); if (P().read(f, App.ws) !== null) open(f, +l) } })
    App.code = { open, commit, showVersion }
    return { el, show: () => { paintList(); load(true) } }
  }
})

// ---------- data view: tables as an editable grid ----------
registerView('data', {
  title: 'Data', sub: 'tables',
  make() {
    const S = { cur: null }
    const tl = h('div.tlist'), head = h('div.toolbar'), grid = h('div.scroll')
    const el = h('div', h('div.dview', tl, h('div.cmain', head, grid)))
    const P = () => App.P
    const parse = v => v === '' ? '' : v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
    function paint() {
      clear(tl); clear(head); clear(grid); if (!P()) return
      const ws = App.ws, inOv = ws !== 'main', tabs = P().tablesIn(ws), tch = inOv ? new Map(P().tableChanges(ws).map(c => [c.name, c])) : new Map()
      if (S.cur && !tabs.has(S.cur)) S.cur = null
      if (!S.cur) S.cur = [...tabs.keys()][0] || null
      for (const t of tabs.values()) tl.appendChild(h('button.fi' + (t.name === S.cur ? '.on' : '') + (tch.has(t.name) ? '.mod' : ''), { title: tch.has(t.name) ? 'Changed in this proposal' : '', on: { click: () => { S.cur = t.name; paint() } } }, t.name, h('span.ch', String(t.rows.length))))
      tl.appendChild(h('button.fi', { style: { color: 'var(--ink-2)' }, on: { click: newTable } }, '+ table'))
      if (!S.cur) { grid.appendChild(h('p.empty', 'No tables yet. Pages read them with site.db.rows(name).')); return }
      const t = tabs.get(S.cur), c = tch.get(S.cur)
      const changedIds = c ? new Set([...c.added, ...c.changed]) : new Set()
      head.append(h('b', t.name), h('span.lbl', plural(t.rows.length, 'row')),
        inOv ? h('span.tag.ws', { title: 'Edits here go into the proposal; main\'s data is unchanged until it is accepted' }, c ? 'proposal copy: +' + c.added.length + ' −' + c.removed.length + ' ~' + c.changed.length : 'proposal') : null, h('span.sp'),
        h('button.btn.sm', { on: { click: () => { const r = {}; for (const c of t.cols) if (c !== 'id') r[c] = ''; P().insert(t.name, r, 'you', ws) } } }, '+ Row'),
        h('button.btn.sm', { on: { click: async () => { const c = await promptBox('Add column', 'Column name'); if (c) P().define(t.name, [...t.cols, c], 'you', ws) } } }, '+ Column'),
        h('button.btn.sm', { title: 'Save these rows as a fixture: frames and scenarios can run against it', on: { click: () => saveFixture(t) } }, 'Save as fixture'),
        h('button.btn.sm.danger', { on: { click: async () => { if (await confirmBox('Drop table ' + t.name + '?', 'Its ' + plural(t.rows.length, 'row') + ' go with it.' + (inOv ? ' (In this proposal only.)' : ''), 'Drop')) P().dropTable(t.name, 'you', ws) } } }, 'Drop'))
      const table = h('table.grid', h('thead', h('tr', t.cols.map(c => h('th', c)), h('th'))))
      const body = h('tbody')
      for (const r of t.rows) body.appendChild(h('tr' + (changedIds.has(String(r.id)) ? '.mod' : ''), t.cols.map(c => h('td', h('input', {
        value: r[c] == null ? '' : typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c]), readOnly: c === 'id',
        on: { change: e => { try { P().update(t.name, r.id, { [c]: parse(e.target.value) }, 'you', ws) } catch (err) { toast(err.message) } } }
      }))), h('td.rx', h('button', { title: 'Delete row', on: { click: () => P().removeRow(t.name, r.id, 'you', ws) } }, '×'))))
      table.appendChild(body); grid.appendChild(table)
    }
    async function saveFixture(t) {
      const n = await promptBox('Save as fixture', 'A fixture is a fixed set of rows (and optionally a clock) that a frame or a scenario runs against instead of the live data. Name:', t.name + '-sample'); if (!n) return
      const path = fixturePath(n.replace(/[^\w-]/g, '-')), ex = P().read(path, App.ws)
      let spec = { description: '', tables: {} }; if (ex) { try { spec = JSON.parse(ex) } catch { } }
      spec.tables = spec.tables || {}; spec.tables[t.name] = t.rows
      P().write(path, JSON.stringify(spec, null, 2) + '\n', { ws: App.ws, who: 'you', note: 'fixture from table ' + t.name })
      toast('Saved ' + path + '. Pick it from a frame\'s ⋯ menu.')
    }
    async function newTable() {
      const n = await promptBox('New table', 'Name (letters, digits, _)', 'items'); if (!n) return
      try { P().define(n, ['name'], 'you', App.ws); S.cur = n; paint() } catch (e) { toast(e.message) }
    }
    const later = debounce(paint, 120)
    App.ev.on('project', paint); App.ev.on('ws', later); App.ev.on('overlays', later); App.ev.on('tables', () => { if (!el.contains(document.activeElement)) later() })
    return { el, show: paint }
  }
})

// ---------- inspector: box, computed styles, matched rules with editable declarations ----------
function cssBlocks(text) {
  const out = []; let i = 0, depth = 0, start = 0
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
  for (; i < clean.length; i++) {
    const ch = clean[i]
    if (ch === '{') {
      const sel = clean.slice(start, i).trim()
      if (sel.startsWith('@')) { depth++; start = i + 1; continue }
      const close = clean.indexOf('}', i); const end = close < 0 ? clean.length : close
      out.push({ sel, selStart: start + clean.slice(start, i).search(/\S/), bodyStart: i + 1, bodyEnd: end })
      i = end; start = end + 1
    } else if (ch === '}') { depth = Math.max(0, depth - 1); start = i + 1 } else if (ch === ';' && depth >= 0 && !clean.slice(start, i).includes('{')) { if (clean.slice(start, i).trim().startsWith('@')) start = i + 1 }
  }
  return out
}
const normSel = s => s.replace(/\s+/g, ' ').replace(/\s*([,>+~])\s*/g, '$1').trim()
function findRule(text, selector) { const n = normSel(selector); return cssBlocks(text).find(b => normSel(b.sel) === n) }
function cssSet(text, selector, prop, value) {
  const b = findRule(text, selector); if (!b) return null
  const body = text.slice(b.bodyStart, b.bodyEnd)
  const re = new RegExp('(^|[;{\\s])(' + prop.replace(/[-]/g, '\\-') + ')(\\s*:\\s*)([^;]*?)(\\s*(;|$))', 'm')
  let nb
  if (value === null) nb = body.replace(re, (m, pre) => pre)
  else if (re.test(body)) nb = body.replace(re, (m, pre, p, colon, v, tail) => pre + p + colon + value + tail)
  else {
    const multi = body.includes('\n'), ind = (/\n([ \t]+)\S/.exec(body) || [])[1] || '  '
    nb = multi ? body.replace(/\s*$/, '') + (body.trim() && !body.trim().endsWith(';') ? ';' : '') + '\n' + ind + prop + ': ' + value + ';\n' : body.replace(/\s*$/, '') + (body.trim() && !body.trim().endsWith(';') ? ';' : '') + ' ' + prop + ': ' + value + '; '
  }
  return text.slice(0, b.bodyStart) + nb + text.slice(b.bodyEnd)
}
registerView('inspector', {
  title: 'Inspector', sub: 'styles',
  make() {
    const body = h('div.scroll'), el = h('div', body)
    let seq = 0
    async function paint() {
      const s = App.sel, my = ++seq
      clear(body)
      if (!s) { body.appendChild(h('p.empty', 'Select an element on the canvas (Select mode, click). Its source, box and matching CSS show here, and you can edit them.')); return }
      const fh = App.hostByFid(s.fid)
      const [file, line] = (s.src || ':').split(':')
      body.appendChild(h('div.block', h('header', h('h3', s.tag + (s.id ? '#' + s.id : '') + (s.cls ? '.' + s.cls.split(' ').join('.') : '')), h('span.sp'), h('span.tag' + (s.ws !== 'main' ? '.ws' : ''), s.ws === 'main' ? 'main' : 'proposal')),
        h('dl.kv', h('dt', 'Source'), h('dd', s.src ? h('button.link', { on: { click: () => App.reveal(file, +line) } }, s.src) : '—'), h('dt', 'Page'), h('dd', s.route), s.text ? [h('dt', 'Text'), h('dd', '“' + s.text.slice(0, 120) + '”')] : null, h('dt', 'Selector'), h('dd.mono', s.selector)),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          h('button.btn.sm', { on: { click: () => App.askAgent('About the ' + s.tag + ' at ' + s.src + ' on ' + s.route + ': ') } }, 'Ask agent about this'),
          s.leaf ? h('span.note', 'double-click it on the canvas to edit the text') : null)))
      if (!fh) return
      let r; try { r = await fh.call('inspect', [{ src: s.src }]) } catch (e) { try { r = await fh.call('inspect', [s.selector]) } catch (e2) { body.appendChild(h('p.empty', 'The element is gone from the page (' + e2.message + ').')); return } }
      if (my !== seq) return
      const c = r.computed
      body.appendChild(h('div.block', h('header', h('h3', 'Box'), h('span.sub', r.rect.w + ' × ' + r.rect.h + ' at ' + r.rect.x + ', ' + r.rect.y)),
        h('dl.kv', ['display', 'position', 'margin', 'padding', 'gap', 'font-size', 'font-family', 'color', 'background-color'].map(p => [h('dt', p), h('dd.mono', c[p])]))))
      const rules = h('div.block', h('header', h('h3', 'Rules'), h('span.sub', 'last wins · edits write to the file')))
      for (const rule of [...r.rules].reverse()) {
        const text = App.P.read(rule.file, App.ws) || '', blk = rule.inline ? null : findRule(text, rule.selector), ln = blk ? lineOf(text, blk.selStart) : null
        const box = h('div', { style: { border: '1px solid var(--rule)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '2px' } },
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } }, h('b.mono', rule.selector), rule.media ? h('span.note', '@media ' + rule.media) : null, h('span.sp'),
            h('button.link.note', { on: { click: () => App.reveal(rule.file, ln || 1) } }, rule.file + (ln ? ':' + ln : ''))))
        for (const [p, v, imp] of rule.decls) {
          const inp = h('input.txt.mono', { value: v + (imp ? ' !important' : ''), style: { flex: 1, padding: '1px 4px', fontSize: '11.5px' }, disabled: !blk,
            on: { change: () => edit(rule, p, inp.value.trim() || null) , keydown: e => { if (e.key === 'Enter') inp.blur() } } })
          box.appendChild(h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('span.mono', { style: { minWidth: '110px', color: 'var(--ink-2)', fontSize: '11.5px' } }, p), inp))
        }
        if (blk) {
          const add = h('input.txt.mono', { placeholder: '+ property: value', style: { padding: '1px 4px', fontSize: '11.5px' }, on: { keydown: e => { if (e.key !== 'Enter') return; const m = /^\s*([\w-]+)\s*:\s*(.+?);?\s*$/.exec(add.value); if (m) edit(rule, m[1], m[2]); else toast('Write it as property: value') } } })
          box.appendChild(add)
        }
        rules.appendChild(box)
      }
      if (!r.rules.length) rules.appendChild(h('p.note', 'No project CSS rules match this element.'))
      body.appendChild(rules)
    }
    function edit(rule, prop, value) {
      const P = App.P, text = P.read(rule.file, App.ws); if (text == null) return
      const next = cssSet(text, rule.selector, prop, value)
      if (next == null) return toast('Could not find "' + rule.selector + '" in ' + rule.file)
      P.write(rule.file, next, { ws: App.ws, who: 'you', note: rule.selector + ' { ' + prop + (value ? ': ' + value : ' removed') + ' }' })
      setTimeout(paint, 450)
    }
    App.ev.on('sel', () => { if (Dock.visible('inspector')) paint() })
    App.ev.on('project', paint)
    return { el, show: paint }
  }
})

// ---------- layers: the DOM outline of the selected frame ----------
registerView('layers', {
  title: 'Layers', sub: 'DOM outline',
  make() {
    const tree = h('div.layers'), head = h('div.toolbar'), el = h('div', head, tree)
    let seq = 0
    async function paint() {
      const my = ++seq; clear(head); clear(tree)
      const fh = App.sel ? App.hostByFid(App.sel.fid) : App.firstHost()
      if (!fh) { tree.appendChild(h('p.empty', 'No frame yet.')); return }
      head.append(h('span.lbl', 'Frame'), h('b', fh.route), h('span.note', fh.w + 'px' + (fh.ws !== 'main' ? ' · proposal' : '')), h('span.sp'), h('button.btn.sm', { on: { click: paint } }, 'Refresh'))
      let nodes; try { nodes = await fh.call('outline', [500]) } catch (e) { tree.appendChild(h('p.empty', e.message)); return }
      if (my !== seq) return
      for (const n of nodes) tree.appendChild(h('button' + (App.sel && n.src && n.src === App.sel.src ? '.on' : ''), {
        style: { paddingLeft: 10 + n.d * 12 + 'px' }, title: n.src,
        on: { click: async () => { try { const info = await fh.call('select', [n.src ? { src: n.src } : n.tag]); if (info) App.select({ ...info, fid: fh.fid, route: fh.route, ws: fh.ws }) } catch (e) { toast(e.message) } } }
      }, h('span', n.tag + (n.id ? '#' + n.id : '') + (n.cls ? '.' + n.cls : '')), n.text ? h('span.note', '“' + n.text + '”') : null, h('span.sp'), h('span.src', n.src)))
    }
    const later = debounce(() => { if (Dock.visible('layers')) paint() }, 300)
    App.ev.on('sel', later); App.ev.on('frameready', later); App.ev.on('project', later)
    return { el, show: paint }
  }
})

// ---------- console: page logs and errors, plus eval output ----------
registerView('console', {
  title: 'Console', sub: 'logs',
  badge: () => { const n = App.logs.filter(l => l.level === 'error' && !l.seen).length; return n ? h('span.count.bad', String(n)) : null },
  make() {
    const S = { level: 'all' }
    const out = h('div.clog')
    const seg = h('div.seg.sm', ['all', 'error', 'warn'].map(l => h('button' + (l === S.level ? '.on' : ''), { on: { click: () => { S.level = l; [...seg.children].forEach(b => b.classList.toggle('on', b.textContent.toLowerCase().startsWith(l === 'all' ? 'all' : l))); paint() } } }, l === 'all' ? 'All' : l === 'error' ? 'Errors' : 'Warnings')))
    const el = h('div', h('div.toolbar', seg, h('span.sp'), h('button.btn.sm', { on: { click: () => { App.logs.length = 0; paint(); Dock.refreshTabs() } } }, 'Clear')), out)
    function row(l) {
      const [f, ln] = (l.src || '').split(':')
      return h('div.' + l.level, h('span.t', fmtTime(l.t)), h('span.s', { title: l.frame }, l.frame), h('span', l.text, l.src && f ? [' ', h('button.link.note', { on: { click: () => App.reveal(f, +ln || 1) } }, l.src)] : null))
    }
    function paint() {
      clear(out)
      const ls = App.logs.filter(l => S.level === 'all' || l.level === S.level)
      for (const l of ls.slice(-400)) out.appendChild(row(l))
      if (!ls.length) out.appendChild(h('p.empty', 'Nothing logged. Page console output and errors from every frame land here.'))
      out.scrollTop = out.scrollHeight
      if (Dock.visible('console')) { App.logs.forEach(l => { l.seen = true }); Dock.refreshTabs() }
    }
    App.ev.on('log', l => {
      if (!Dock.visible('console')) { Dock.refreshTabs(); return }
      if (S.level !== 'all' && l.level !== S.level) return
      if (out.querySelector('.empty')) clear(out)
      l.seen = true; out.appendChild(row(l)); if (out.children.length > 400) out.firstChild.remove(); out.scrollTop = out.scrollHeight
    })
    App.ev.on('project', paint)
    return { el, show: paint }
  }
})

// ---------- eval: run code against the host API yourself (the agent's exact tool) ----------
registerView('evalrepl', {
  title: 'Eval', sub: 'run the API yourself',
  make() {
    const ta = h('textarea.txt.mono', { spellcheck: false, style: { width: '100%', minHeight: '120px', resize: 'vertical', fontSize: '12px', lineHeight: '18px' } })
    ta.value = `// The agent's only tool: an async function body, run in a QuickJS sandbox.\n// The host API is in scope (files, data, frames, ui, session). Return a value.\nconst list = await files.list()\nconst issues = await frames.check()\nreturn { files: list.map(f => f.path), issues }`
    const res = h('div.scroll'), engine = h('span.note')
    const run = async () => {
      if (!App.P) return
      const code = ta.value, t0 = now()
      const card = h('div.block', h('header', h('h3', 'Running…'), h('span.sub', fmtTime(t0))))
      res.prepend(card)
      const ctx = { project: App.P, ws: App.ws, who: 'you', mode: 'auto' }
      const r = await runEval(ctx, code, hostAPI(ctx), { sid: 'repl:' + App.P.id, restore: App.P.meta.replScope && App.P.meta.replScope.vars })
      if (r.scope) { App.P.meta.replScope = r.scope; App.P.saveMeta(); paintScope() }
      clear(card)
      if (r.effects) card.appendChild(h('div.fx', effectsLine(r.effects)))
      put(card, h('header', h('h3', { style: { color: r.ok ? '' : 'var(--accent)' } }, r.ok ? 'ok' : r.error.kind), h('span.sub', (r.ms ?? '?') + ' ms · ' + (r.engine || '') + ' · ' + (App.ws === 'main' ? 'main' : 'proposal')), h('span.sp'),
        h('button.btn.sm', { on: { click: () => { ta.value = code; ta.focus() } } }, 'Edit again')),
        r.ok ? h('pre.mono.yaml', { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: '11.5px', maxHeight: '420px', overflow: 'auto' }, html: hlYAML(toYAML(r.value)) }) : h('pre.mono', { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: '11.5px' } }, r.error.message + (r.error.line ? '\n(line ' + r.error.line + ')' : '')),
        r.logs && r.logs.length ? h('pre.mono.note', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, r.logs.map(l => l.level + ': ' + l.text).join('\n')) : null)
      App.P.log({ kind: 'eval', who: 'you', ws: App.ws, ok: r.ok, note: (code.split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 90), calls: [...new Set(r.calls || [])].slice(0, 12) })
    }
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run() } if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end') } })
    const ref = h('details.block', h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'API reference (what the agent sees)'), h('pre.mono', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', margin: 0 } }, API_GUIDE.split('\n\nWorking rules')[0].split('\n').slice(4).join('\n')))
    const paintEngine = () => { engine.textContent = 'Sandbox: ' + ({ quickjs: 'QuickJS (wasm) in a worker', worker: 'worker realm (QuickJS failed to load)', loading: 'starting…', off: 'unavailable here' }[Sandbox.engine] || Sandbox.engine) }
    Sandbox.ev.on('engine', paintEngine); paintEngine()
    const scopeLine = h('div.toolbar', { style: { minHeight: '30px', fontSize: 'var(--fs-xs)' } })
    function paintScope() {
      clear(scopeLine); const P = App.P; if (!P) return
      const sc = P.meta.replScope, vars = sc && sc.vars ? Object.keys(sc.vars) : [], lib = libEntries(P, App.ws)
      put(scopeLine, h('span.lbl', 'Scope'), h('span.mono', vars.length ? vars.join(', ') : 'empty (top-level const/let/function persist between runs)'),
        lib.length ? [h('span.lbl', 'lib'), h('span.mono', lib.map(l => l.name).join(', '))] : null, h('span.sp'),
        vars.length ? h('button.btn.sm', { on: { click: () => { P.meta.replScope = null; P.saveMeta(); Sandbox.drop('repl:' + P.id); paintScope() } } }, 'Reset scope') : null)
    }
    App.ev.on('project', paintScope); App.ev.on('files', (ws, paths) => { if (paths.some(p => p.startsWith(LIB_DIR))) paintScope() })
    const el = h('div', h('div.toolbar', h('button.btn.sm.primary', { on: { click: run } }, 'Run ⌘↵'), engine, h('span.sp'), h('button.btn.sm', { on: { click: () => clear(res) } }, 'Clear')), scopeLine,
      h('div', { style: { padding: '8px 10px', borderBottom: '1px solid var(--hair)' } }, ta), ref, res)
    return { el, show: () => { if (!Sandbox.worker) Sandbox.spawn(); paintScope() } }
  }
})

// ---------- docs: every markdown file in the project, rendered, with an outline ----------
registerView('docs', {
  title: 'Docs', sub: 'markdown files',
  make() {
    const S = { cur: null }
    const list = h('div.fl'), outline = h('div.fl.outline')
    const side = h('div.flist', h('div.toolbar', h('span.lbl', 'Docs'), h('span.sp'), h('button.btn.sm', { title: 'New markdown file', on: { click: newDoc } }, '+ New')), list, h('div.toolbar', { style: { borderTop: '1px solid var(--hair)' } }, h('span.lbl', 'Outline')), outline)
    const head = h('div.toolbar'), body = h('div.scroll.docbody')
    const el = h('div', h('div.cview', side, h('div.cmain', head, body)))
    const P = () => App.P
    const docs = () => P() ? P().list(App.ws).filter(p => /\.(md|markdown)$/i.test(p)) : []
    function paint() {
      const all = docs()
      if (!S.cur || !all.includes(S.cur)) S.cur = all.find(p => /(^|\/)readme\.md$/i.test(p)) || all[0] || null
      clear(list)
      for (const p of all) list.appendChild(h('button.fi' + (p === S.cur ? '.on' : ''), { title: p, on: { click: () => { S.cur = p; paint() } } }, p))
      clear(head); clear(body); clear(outline)
      if (!S.cur) {
        body.appendChild(h('div.empty', h('p', { style: { margin: '0 0 10px' } }, 'No markdown files in this project yet. Notes, specs and READMEs written as .md files show here, rendered.'),
          h('button.btn.sm', { on: { click: () => newDoc('README.md') } }, 'Create README.md')))
        return
      }
      const text = P().read(S.cur, App.ws) || ''
      put(head, h('b', S.cur), h('span.note', text.split('\n').length + ' lines' + (App.ws !== 'main' ? ' · proposal' : '')), h('span.sp'),
        h('button.btn.sm', { on: { click: () => App.askAgent('About ' + S.cur + ': ') } }, 'Ask agent'),
        h('button.btn.sm', { on: { click: () => App.reveal(S.cur, 1) } }, 'Edit'))
      const doc = renderMarkdown(text, f => P().read(f, App.ws) !== null, { doc: true }); doc.classList.add('doc')
      body.appendChild(doc)
      for (const hd of doc.querySelectorAll('[data-level]')) {
        outline.appendChild(h('button.fi', { style: { paddingLeft: 10 + (hd.dataset.level - 1) * 12 + 'px', fontFamily: 'var(--ui)' }, on: { click: () => hd.scrollIntoView({ block: 'start', behavior: 'smooth' }) } }, hd.textContent))
      }
    }
    body.addEventListener('click', e => { const r = e.target.closest('[data-file]'); if (!r) return; e.preventDefault(); if (/\.md$/i.test(r.dataset.file)) { S.cur = r.dataset.file; paint(); body.scrollTop = 0 } else App.reveal(r.dataset.file, +r.dataset.line || 1) })
    async function newDoc(name) {
      const p = typeof name === 'string' ? name : await promptBox('New doc', 'Path, like NOTES.md or docs/plan.md', 'NOTES.md'); if (!p) return
      const path = /\.(md|markdown)$/i.test(p) ? p : p + '.md', bad = validPath(path); if (bad) return toast(bad)
      if (P().read(path, App.ws) === null) P().write(path, '# ' + path.replace(/\.md$/i, '').split('/').pop() + '\n\n', { ws: App.ws })
      S.cur = path; paint(); App.reveal(path, 3)
    }
    const later = debounce(() => { if (Dock.visible('docs')) paint() }, 200)
    App.ev.on('files', (ws, paths) => { if (paths.some(p => /\.(md|markdown)$/i.test(p))) later() })
    App.ev.on('ws', later); App.ev.on('project', () => { S.cur = null; later() })
    App.docs = { open(path) { S.cur = path; paint() } }
    return { el, show: paint }
  }
})

// ---------- blame details ----------
function blameTitle(w) {
  const who = w.who === 'agent' ? 'Claude' + (w.role ? ' (' + w.role + ')' : '') : w.kind === 'init' ? 'the template' : w.who === 'ide' ? 'Sitebench' : 'you'
  return [who + ' · ' + new Date(w.t).toLocaleString(), w.proposal ? 'accepted from "' + w.proposal + '"' : '', w.request ? 'asked: ' + w.request : '', w.marks && w.marks.length ? w.marks.map(m => m.kind + ': ' + m.label).join(' · ') : '', w.note && !w.request ? w.note : ''].filter(Boolean).join('\n')
}
function blameCard(P, path, i, a, b) {
  const w = P.why(i); if (!w) return
  const e = P.events[i], who = w.who === 'agent' ? 'Claude' + (w.role ? ' (' + w.role + ' subagent)' : '') : e.kind === 'init' ? 'The template' : w.who === 'ide' ? 'Sitebench' : 'You'
  const vs = P.versions(path), k = vs.findIndex(v => v.i === i), before = k > 0 ? vs.slice(0, k).reverse().find(v => v.ws === e.ws || v.ws === 'main') : null
  const body = [
    h('dl.kv', h('dt', 'Who'), h('dd', who + (w.threadTitle ? ' · thread "' + w.threadTitle + '"' : '')), h('dt', 'When'), h('dd', new Date(w.t).toLocaleString() + ' (' + fmtAgo(w.t) + ')'),
      w.proposal ? [h('dt', 'Via'), h('dd', 'accepted from proposal "' + w.proposal + '"')] : null,
      w.request ? [h('dt', w.delegatedBy ? 'Asked by the main agent' : 'Asked'), h('dd', w.request)] : null,
      w.reply ? [h('dt', 'Reply'), h('dd', w.reply)] : null,
      !w.request && w.note ? [h('dt', 'Note'), h('dd', w.note)] : null),
    w.marks && w.marks.length ? h('div', h('div.note', 'Marks from that turn'), h('ul', { style: { margin: '4px 0', paddingLeft: '18px' } }, w.marks.map(m => h('li', h('b', m.kind + ': '), m.label, m.why ? h('span.note', ' (' + m.why + ')') : null)))) : null,
    e.kind === 'write' ? h('details', h('summary', { style: { cursor: 'pointer' } }, 'The change'), diffView(before ? before.text ?? '' : '', e.after ?? '')) : null]
  modal({ title: path + ' · line' + (a === b ? ' ' + a : 's ' + a + '–' + b), wide: true, body, actions: [
    { label: 'Close' },
    w.thread && P.threads.get(w.thread) ? { label: 'Open thread', run: () => App.showThread(w.thread) } : null,
    { label: 'Select on timeline', run: () => { Dock.open('timeline'); setTimeout(() => App.timeline && App.timeline.select(i), 30) } },
    P.landed(i) != null ? { label: P.landed(i) === i ? 'Show on canvas' : 'Show on canvas (when accepted)', primary: true, run: () => App.setPlayhead(P.landed(i)) } : null].filter(Boolean) })
}

// ===== 10-agentviews.js =====
// ---------- agent: threads, chat with eval steps, modes, model ----------
const MODELS = [
  { v: 'quick', label: 'Quick' }, { v: 'default', label: 'Default' }, { v: 'complex', label: 'Complex' },
  { v: 'm:claude-haiku-5-5', label: 'Haiku 5.5' }, { v: 'm:claude-sonnet-5-5', label: 'Sonnet 5.5' }, { v: 'm:claude-opus-5-5', label: 'Opus 5.5' }
]
registerView('agent', {
  title: 'Agent', sub: 'chat with Claude',
  badge: () => Agent.anyBusy() ? h('span.count', '…') : null,
  make() {
    const S = { tid: null, chips: { sel: true }, early: {} }
    const strip = h('div.threads'), chat = h('div.chat'), note = h('div.block', { hidden: true })
    const ta = h('textarea.txt', { placeholder: 'Ask for a change. The selection and open pins go along as context.', on: { keydown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() } } } })
    const chips = h('div.ctxchips'), row = h('div.row')
    const el = h('div', strip, note, chat, h('div.composer', chips, ta, row))
    chat.addEventListener('click', e => { const r = e.target.closest('[data-file]'); if (r) { e.preventDefault(); /\.md$/i.test(r.dataset.file) ? App.openDoc(r.dataset.file) : App.reveal(r.dataset.file, +r.dataset.line || 1) } })
    const P = () => App.P
    const th = () => { const p = P(); if (!p) return null; let t = S.tid && p.threads.get(S.tid); if (!t) { t = [...p.threads.values()].sort((a, b) => b.created - a.created)[0]; if (!t) t = p.newThread(); S.tid = t.id } return t }

    function paintStrip() {
      if (!P()) return clear(strip)
      const cur = th(); clear(strip)
      for (const t of [...P().threads.values()].sort((a, b) => a.created - b.created)) {
        if (t.parent && t !== cur) continue
        strip.appendChild(h('span.th' + (t === cur ? '.on' : '') + (t.parent ? '.child' : ''), h('button', { title: t.title, on: { click: () => { S.tid = t.id; paintAll() }, dblclick: async () => { const n = await promptBox('Rename thread', 'Title', t.title); if (n) { t.title = n; P().saveThread(t); paintStrip() } } } },
          Agent.busy(t.id) ? h('span.dot.busy') : null, t.parent ? '↳ ' : '', t.title.length > 22 ? t.title.slice(0, 22) + '…' : t.title)))
      }
      strip.appendChild(h('div.rel.new', { style: { display: 'flex', padding: 0 } },
        h('button', { title: 'Thread actions', on: { click: e => threadMenu(e.currentTarget) } }, '⋯'),
        h('button', { title: 'New thread', on: { click: () => { const t = P().newThread(); S.tid = t.id; paintAll(); ta.focus() } } }, '+ Thread')))
    }
    function threadMenu(btn) {
      const t = th(); if (!t) return
      popMenu(btn, [{ group: t.title },
        { label: 'Rename…', run: async () => { const n = await promptBox('Rename thread', 'Title', t.title); if (n) { t.title = n; P().saveThread(t); paintStrip() } } },
        { label: 'Download transcript', sub: 'Markdown, with every eval', disabled: !t.msgs.length, run: () => saveFile(slug(P().title) + '-' + slug(t.title) + '.md', transcriptMd(P(), t)) },
        ...(() => { const kids = [...P().threads.values()].filter(x => x.parent).sort((a, b) => b.created - a.created).slice(0, 12); return kids.length ? [{ group: 'Subagent threads' }, ...kids.map(k => ({ label: '↳ ' + k.title, sub: (Agent.busy(k.id) ? 'working · ' : '') + fmtAgo(k.created), run: () => { S.tid = k.id; paintAll() } })), { hr: true }] : [] })(),
        { group: 'Context' },
        { label: 'Summarize earlier messages now', sub: t.summary ? 'messages 1–' + t.summary.upTo + ' are summarized' : 'happens on its own when the thread gets long', disabled: Agent.busy(t.id) || t.msgs.length - (t.summary ? t.summary.upTo : 0) < 4, run: () => compactNow(t) },
        t.summary ? { label: 'Edit the summary…', run: () => editSummary(t) } : null,
        t.summary ? { label: 'Forget the summary', sub: 'Claude sees the full history again (as much as fits)', run: () => { t.summary = null; P().saveThread(t); paintChat(); paintChips() } } : null,
        { hr: true },
        { label: 'Download as JSON', disabled: !t.msgs.length, run: () => saveFile(slug(P().title) + '-' + slug(t.title) + '.json', JSON.stringify(t, null, 1)) },
        { hr: true },
        { label: 'Delete thread…', danger: true, disabled: Agent.busy(t.id), run: async () => { if (await confirmBox('Delete "' + t.title + '"?', 'Its messages go; the timeline keeps what it did.', 'Delete')) { P().dropThread(t.id); S.tid = null; paintAll() } } }], { right: true })
    }
    function stepEl(s, i) {
      const calls = [...new Set(s.calls || [])]
      const sum = h('summary', h('b', (s.status === 'ok' ? '✓' : s.status === 'error' ? '✕' : s.status === 'ask' ? '?' : s.status === 'skipped' ? '–' : '…') + ' eval ' + (i + 1)),
        h('span', calls.length ? calls.slice(0, 4).join(', ') + (calls.length > 4 ? ' +' + (calls.length - 4) : '') : (s.code.split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 60)),
        s.ms != null ? h('span', s.ms + ' ms') : null)
      const fx = effectsLine(s.effects)
      if (fx) sum.appendChild(h('span.fx' + (s.effects.rolledBack || s.effects.newIssues || s.effects.newErrors ? '.bad' : ''), fx))
      const d = h('details.step' + (s.status === 'error' ? '.bad' : ''), sum, h('pre', { html: hlJS(s.code) }), s.logs && s.logs.length ? h('pre', s.logs.join('\n')) : null, s.out ? (s.fmt === 'yaml' ? h('pre.yaml', { html: hlYAML(s.out) }) : h('pre', s.out)) : null,
        s.effects && (s.effects.newIssues || s.effects.newErrors) ? h('pre', [...(s.effects.newIssues || []).map(i => 'new issue · ' + i.frame + ' · ' + i.message + (i.src ? ' @' + i.src : '')), ...(s.effects.newErrors || []).map(e => 'new error · ' + e)].join('\n')) : null)
      if (s.children && s.children.length) d.appendChild(h('div.kids', s.children.map(c => { const ct = P().threads.get(c.thread); const last = ct && [...ct.msgs].reverse().find(m => m.role === 'agent')
        return h('div', h('span', '↳ ' + c.role), h('span', ct ? (Agent.busy(ct.id) ? 'working…' : plural((last && last.steps || []).length, 'eval') + (last && last.status === 'error' ? ' · failed' : '')) : ''), h('button.link', { on: { click: e => { e.preventDefault(); App.showThread(c.thread) } } }, 'open thread')) })))
      if (s.status === 'ask') {
        d.open = true
        d.appendChild(h('div.ask', h('span', 'Run this eval?'), h('button.btn.sm.primary', { on: { click: () => s.decide && s.decide(true) } }, 'Run'), h('button.btn.sm', { on: { click: () => s.decide && s.decide(false) } }, 'Skip')))
      }
      return d
    }
    // the running summary: what Claude sees in place of the older messages; readable, editable, forgettable
    function summaryEl(t, early) {
      const sm = t.summary
      return h('div.summary',
        h('div.who', h('b', 'Earlier: ' + plural(sm.upTo, 'message') + ' summarized for Claude'), h('span', sm.by === 'you' ? 'edited by you' : sm.by === 'fallback' ? 'listed without a model' : 'by Claude'), h('span', fmtAgo(sm.t)), h('span.sp'),
          h('button.link.note', { on: { click: () => { S.early[t.id] = !early; paintChat() } } }, early ? 'Hide them' : 'Show them'), ' ',
          h('button.link.note', { title: 'Correct what Claude will remember', on: { click: () => editSummary(t) } }, 'Edit')),
        renderMarkdown(sm.text, f => P().read(f, 'main') !== null))
    }
    function editSummary(t) {
      const ta = h('textarea.mono', { style: { width: '100%', minHeight: '260px', fontSize: '12px' } }); ta.value = t.summary.text
      modal({ title: 'What Claude remembers of messages 1–' + t.summary.upTo, wide: true, body: [h('p.note', 'Claude reads this instead of the older messages. Fix anything wrong or missing; it can still look up the originals with session.recall.'), ta],
        actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, run: () => { t.summary = { ...t.summary, text: ta.value.trim(), by: 'you', t: now() }; P().saveThread(t); P().log({ kind: 'compact', who: 'you', ws: 'main', thread: t.id, note: 'edited the summary of "' + t.title + '"' }); paintChat() } }] })
    }
    async function compactNow(t) {
      toast('Summarizing…')
      try { const r = await Agent.compact(P(), t, { force: true }); toast(r ? 'Summarized messages 1–' + r.upTo : 'Too short to summarize') } catch (e) { toast('Could not summarize: ' + e.message) }
      paintChat(); paintChips()
    }
    function msgEl(m, i, t) {
      if (m.role === 'user') return h('div.msg.user', h('div.who', m.from ? 'From the ' + m.from : 'You', h('span', fmtTime(m.t)), m.ctx && m.ctx.sel ? h('span.tag', m.ctx.sel.tag + ' ' + m.ctx.sel.src) : null), h('div.body', m.text))
      const ov = m.ws && m.ws !== 'main' ? P().overlays.get(m.ws) : null
      return h('div.msg.agent',
        h('div.who', 'Claude', h('span', fmtTime(m.t)), m.model ? h('span', m.model) : null, m.status === 'running' ? h('span.dot.busy') : null, h('span.sp'),
          h('button.link.note', { title: 'Bookmark this reply on the timeline', on: { click: () => { P().mark({ label: (m.text || 'reply').split('\n')[0].slice(0, 40), by: 'you', thread: t.id, msg: i }); toast('Marked on the timeline') } } }, '☆ mark')),
        (m.steps || []).map(stepEl),
        (m.panels || []).map(id => { const pn = Panels.get(P(), id); return pn ? panelEl(P(), pn, { inline: true }) : null }),
        m.text ? renderMarkdown(m.text, file => P().read(file, 'main') !== null || (!!m.ws && m.ws !== 'main' && !!P().overlays.get(m.ws) && P().read(file, m.ws) !== null)) : m.status === 'running' && !(m.steps || []).length ? h('div.body.note', m.note || 'Thinking…') : null,
        m.error ? h('div.note', { style: { color: 'var(--accent)' } }, m.error) : null,
        m.approval ? h('div.approval', h('b', m.approval.title), m.approval.detail ? h('pre', m.approval.detail) : null,
          h('div', { style: { display: 'flex', gap: '6px' } }, h('button.btn.sm.primary', { on: { click: () => m.approval && m.approval.decide(true) } }, 'Approve'), h('button.btn.sm', { on: { click: () => m.approval && m.approval.decide(false) } }, 'Decline'))) : null,
        ov ? h('div.ctx', ov.status === 'open' ? [h('span.tag.ws', 'proposal'), ' ', m.summary || 'working in "' + ov.title + '"', ' ', h('button.link', { on: { click: () => { App.setWs(ov.id); Dock.open('review') } } }, 'Review')] : h('span', '"' + ov.title + '" was ' + ov.status)) : null)
    }
    let raf = 0
    function paintChat() {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0; const t = th(); if (!t) return
        const atEnd = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60
        const open = new Set($$('details.step[open]', chat).map(d => d.dataset.k))
        clear(chat)
        if (!t.msgs.length) chat.appendChild(h('div.note', { style: { padding: '8px 2px' } }, 'Each turn, Claude works through one tool: eval, running JavaScript in a QuickJS sandbox against this project (files, data, frames, pins, timeline). Changes land in a proposal you review, unless you pick Main.'))
        const sm = t.summary, early = sm && S.early[t.id]
        if (sm) chat.appendChild(summaryEl(t, early))
        t.msgs.forEach((m, i) => {
          if (sm && i < sm.upTo && !early) return
          const e = msgEl(m, i, t); $$('details.step', e).forEach((d, j) => { d.dataset.k = i + ':' + j; if (open.has(d.dataset.k)) d.open = true }); chat.appendChild(e)
          if (sm && early && i === sm.upTo - 1) chat.appendChild(h('div.sumcut', 'Claude sees the summary above instead of the messages before this line'))
        })
        if (atEnd) chat.scrollTop = chat.scrollHeight
      })
    }
    function paintChips() {
      clear(chips); const p = P(); if (!p) return
      if (App.sel && S.chips.sel) chips.appendChild(h('span.tag', 'Selected: ' + App.sel.tag + ' ' + (App.sel.src || ''), h('button', { title: 'Leave out', on: { click: () => { S.chips.sel = false; paintChips() } } }, '×')))
      const pins = (p.meta.pins || []).filter(x => !x.resolved).length
      if (pins) chips.appendChild(h('span.tag', plural(pins, 'open pin')))
      if (App.health()) chips.appendChild(h('span.tag', plural(App.health(), 'check issue')))
      const t = th(), vars = t && t.scope && t.scope.vars ? Object.keys(t.scope.vars) : [], lib = libEntries(p, App.ws)
      if (t && t.summary) chips.appendChild(h('button.tag', { title: 'Claude sees a summary of messages 1–' + t.summary.upTo + ' instead of the messages themselves', on: { click: () => { S.early[t.id] = false; paintChat(); chat.scrollTop = 0 } } }, 'Summary: 1–' + t.summary.upTo))
      if (vars.length) chips.appendChild(h('div.rel', { style: { display: 'inline-flex' } }, h('button.tag', { title: 'Variables Claude kept from earlier evals in this thread', on: { click: e => scopeMenu(e.currentTarget, t) } }, 'Scope: ' + (vars.length > 3 ? vars.slice(0, 3).join(', ') + ' +' + (vars.length - 3) : vars.join(', ')))))
      if (lib.length) chips.appendChild(h('div.rel', { style: { display: 'inline-flex' } }, h('button.tag', { title: 'Saved functions (.agent/lib)', on: { click: e => popMenu(e.currentTarget, [{ group: 'lib · .agent/lib/' }, ...lib.map(l => ({ label: 'lib.' + l.name + '(' + l.params.join(', ') + ')', sub: l.description, run: () => App.reveal(l.path, 1) }))]) } }, 'lib: ' + lib.length)))
    }
    function scopeMenu(btn, t) {
      const k = v => v === null ? 'null' : Array.isArray(v) ? 'array(' + v.length + ')' : typeof v === 'object' ? 'object{' + Object.keys(v).slice(0, 4).join(',') + '}' : typeof v === 'string' ? '"' + v.slice(0, 24) + '"' : String(v)
      popMenu(btn, [{ group: 'Kept between evals in "' + t.title + '"' }, ...Object.entries(t.scope.vars).map(([n, v]) => ({ label: n, sub: k(v) })),
        ...(t.scope.skipped || []).map(x => ({ label: x, sub: 'not kept', disabled: true })),
        { hr: true }, { label: 'Forget all', danger: true, run: () => { t.scope = null; Sandbox.drop(t.id); P().saveThread(t); paintChips(); toast('Cleared this thread\'s variables') } }])
    }
    function paintRow() {
      clear(row); const t = th(); if (!t) return
      const busy = Agent.busy(t.id)
      const seg = (vals, cur, set, title) => h('div.seg.sm', { title }, vals.map(([v, l]) => h('button' + (cur === v ? '.on' : ''), { on: { click: () => { set(v); P().saveThread(t); paintRow() } } }, l)))
      const model = h('select.sel', { title: 'Model tier, or a specific model', style: { height: '24px', fontSize: '11px' }, on: { change: () => { const v = model.value; if (v.startsWith('m:')) { t.model = v.slice(2); t.tier = 'default' } else { t.model = null; t.tier = v } P().saveThread(t) } } },
        MODELS.map(m => h('option', { value: m.v, selected: t.model ? m.v === 'm:' + t.model : m.v === (t.tier || 'default') }, m.label)))
      put(row, seg([['auto', 'Auto'], ['ask', 'Ask'], ['read', 'Read-only']], t.mode, v => { t.mode = v }, 'Auto runs evals; Ask asks before each; Read-only refuses writes'),
        t.mode !== 'read' ? seg([['overlay', 'Proposal'], ['main', 'Main']], t.target, v => { t.target = v }, 'Where file writes go') : null,
        model,
        busy ? h('button.btn.sm.danger', { style: { marginLeft: 'auto' }, on: { click: () => Agent.stop(t.id) } }, 'Stop') : h('button.btn.sm.primary', { style: { marginLeft: 'auto' }, disabled: !Agent.sample, on: { click: send } }, 'Send ↵'))
    }
    function paintNote() {
      clear(note)
      note.hidden = !Agent.ready || !!Agent.sample
      if (!note.hidden) note.append(h('b', 'Claude isn\'t available in this view.'), h('p.note', 'The agent uses this page\'s Claude access, which needs the published artifact opened while signed in. You can still drive the same API yourself in the Eval panel.'), h('div', h('button.btn.sm', { on: { click: () => Dock.open('evalrepl', 'agent') } }, 'Open Eval')))
    }
    async function send() {
      const t = th(), text = ta.value.trim(); if (!t || !text || Agent.busy(t.id)) return
      if (!S.chips.sel) { const keep = App.sel; App.sel = null; setTimeout(() => { App.sel = keep }, 0) }
      ta.value = ''; S.chips.sel = true
      Agent.send(P(), t, text).catch(e => toast(e.message))
      paintAll()
    }
    function paintAll() { paintStrip(); paintChat(); paintChips(); paintRow(); paintNote() }
    Agent.ev.on('turn', () => { paintStrip(); paintChat(); paintRow(); Dock.refreshTabs() })
    Agent.ev.on('step', paintChat); Agent.ev.on('text', paintChat); Agent.ev.on('ready', () => { paintNote(); paintRow() })
    App.ev.on('project', () => { S.tid = null; paintAll() })
    App.ev.on('sel', () => { S.chips.sel = true; paintChips() }); App.ev.on('pins', paintChips); App.ev.on('health', paintChips)
    App.ev.on('threads', paintStrip)
    App.ev.on('threads', () => { if (Dock.visible('agent')) paintChat() })
    App.agentView = { compose(text) { ta.value = text; ta.focus(); ta.setSelectionRange(text.length, text.length) }, paintAll, thread: th, open(tid) { S.tid = tid; paintAll() } }
    return { el, show: paintAll }
  }
})

// ---------- review: proposals with diffs; accept or reject; pins ----------
// rows a proposal adds, removes and changes in one table
function rowDiff(c) {
  const bm = new Map((c.before ? c.before.rows : []).map(r => [String(r.id), r])), am = new Map((c.after ? c.after.rows : []).map(r => [String(r.id), r]))
  const cell = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  const lines = []
  for (const id of c.added) lines.push(h('div.rd.add', '+ #' + id + ' ' + Object.entries(am.get(id)).filter(([k]) => k !== 'id').map(([k, v]) => k + ': ' + cell(v)).join(', ')))
  for (const id of c.removed) lines.push(h('div.rd.del', '− #' + id + ' ' + Object.entries(bm.get(id)).filter(([k]) => k !== 'id').map(([k, v]) => k + ': ' + cell(v)).join(', ')))
  for (const id of c.changed) { const a = bm.get(id), b = am.get(id); lines.push(h('div.rd.chg', '~ #' + id + ' ' + [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => cell(a[k]) !== cell(b[k])).map(k => k + ': ' + cell(a[k]) + ' → ' + cell(b[k])).join(', '))) }
  if (c.created || c.dropped) lines.unshift(h('div.note', c.created ? 'New table with columns ' + c.after.cols.join(', ') : 'The proposal drops this table.'))
  return h('div.rowdiff', lines.slice(0, 60), lines.length > 60 ? h('div.note', '… ' + (lines.length - 60) + ' more') : null)
}
// a proposal's checks: layout against main on every board frame, and the scenarios run on both
const ReviewChecks = new Map()
function checksPanel(P, ov) {
  const st = ReviewChecks.get(ov.id) || {}, box = h('div.checks')
  const paintBox = () => {
    clear(box)
    box.append(h('div.toolbar.sub', h('b', 'Checks'), h('span.note', st.t ? 'as of ' + fmtAgo(st.t) : 'layout against main, and the scenarios on both'), h('span.sp'),
      h('button.btn.sm', { disabled: st.busy, on: { click: () => runChecks(P, ov, st, paintBox) } }, st.busy ? 'Checking…' : st.t ? 'Check again' : 'Check layout and scenarios')))
    if (st.layout) for (const f of st.layout) box.appendChild(h('div.lyt', h('div.lh', h('b', f.frame), h('span.note', f.lines.length ? plural(f.changes, 'change') : 'no layout changes'), h('span.sp'),
      f.lines.length ? h('button.link.note', { on: { click: () => App.canvas && App.canvas.compareWs(f.fid, 'main', ov.id) } }, 'compare frozen frames') : null),
      f.lines.length ? h('pre.mono.lines', f.lines.join('\n')) : null))
    if (st.scen) {
      if (!st.scen.length) box.appendChild(h('p.note', 'No scenarios yet: record one from a frame\'s ⋯ menu, or ask the agent (or a qa subagent) to write some.'))
      for (const r of st.scen) box.appendChild(h('div.sres' + (r.ok ? '.ok' : '.bad'), h('span', r.ok ? '✓' : '✗'), h('b', r.name),
        h('span.note', r.ok ? (r.main === false ? 'fixed by this proposal' : 'passes') : (r.main === true ? 'regression: passes in main' : 'fails') + ' · step ' + ((r.failedAt ?? -1) + 1) + ': ' + (r.error || ''))))
    }
  }
  paintBox(); return box
}
async function runChecks(P, ov, st, repaint) {
  st.busy = true; ReviewChecks.set(ov.id, st); repaint()
  try {
    const layout = []
    for (const f of P.board().frames) {
      try {
        const A = await layoutIn(P, f, 'main', { headless: true }), B = await layoutIn(P, f, ov.id, { headless: true }), d = layoutDiff(A.layout, B.layout)
        layout.push({ fid: f.id, frame: (f.label ? f.label + ' · ' : '') + A.fh.route + ' ' + f.w + 'px', changes: d.changes.length, lines: diffSummary(d, 14) })
      } catch (e) { layout.push({ fid: f.id, frame: f.route + ' ' + f.w + 'px', changes: 0, lines: ['could not load: ' + e.message] }) }
    }
    st.layout = layout
    const inOv = await runAllScenarios(P, { ws: ov.id, who: 'you' })
    const inMain = new Map((await runAllScenarios(P, { ws: 'main', who: 'you' })).map(r => [r.name, r.ok]))
    st.scen = inOv.map(r => ({ ...r, main: inMain.get(r.name) }))
    st.t = now()
  } finally { st.busy = false; repaint() }
}

registerView('review', {
  title: 'Review', sub: 'proposals and pins',
  badge: () => { const n = App.P ? App.P.openOverlays().filter(o => App.P.changes(o.id).length || App.P.tableChanges(o.id).length).length : 0; return n ? h('span.count', String(n)) : null },
  make() {
    const body = h('div.scroll'), el = h('div', body)
    const S = { picked: {}, shown: {} }
    function paint() {
      clear(body); const P = App.P; if (!P) return
      const open = P.openOverlays()
      body.appendChild(h('div.toolbar', h('b', 'Proposals'), h('span.note', 'workspaces on top of main; nothing lands until you accept'), h('span.sp'),
        h('button.btn.sm', { on: { click: () => { const ov = P.newOverlay({ title: 'My draft ' + (P.overlays.size + 1) }); App.setWs(ov.id) } } }, '+ Draft')))
      if (!open.length) body.appendChild(h('p.empty', 'No open proposals. Agent turns write into one by default; you can also start a draft and edit in it.'))
      for (const ov of open) {
        const ch = P.changes(ov.id), tch = P.tableChanges(ov.id), pick = S.picked[ov.id] = S.picked[ov.id] || {}
        for (const c of ch) if (!(c.path in pick)) pick[c.path] = true
        for (const c of tch) if (!(('table:' + c.name) in pick)) pick['table:' + c.name] = true
        const th = ov.thread && P.threads.get(ov.thread)
        const nf = ch.filter(c => pick[c.path]).length, nt = tch.filter(c => pick['table:' + c.name]).length, n = nf + nt, all = ch.length + tch.length
        const card = h('div.ovcard', h('header', h('h3', ov.title), h('span.tag.ws', ov.by === 'agent' ? 'agent' : 'you'), th ? h('span.note', th.title) : null, h('span.note', fmtAgo(ov.created)), h('span.sp'),
          h('button.btn.sm' + (App.ws === ov.id ? '.on' : ''), { on: { click: () => App.setWs(App.ws === ov.id ? 'main' : ov.id) } }, App.ws === ov.id ? 'Viewing' : 'View'),
          h('button.btn.sm', { disabled: !all, title: 'Main above, proposal below on the canvas', on: { click: () => { App.setWs(ov.id); App.compare(true) } } }, 'Compare'),
          h('button.btn.sm.primary', { disabled: !n, on: { click: () => { const k = P.accept(ov.id, ch.filter(c => pick[c.path]).map(c => c.path), 'you', tch.filter(c => pick['table:' + c.name]).map(c => c.name)); toast('Accepted ' + plural(k, 'change') + ' into main'); if (P.overlays.get(ov.id).status !== 'open' && App.ws === ov.id) App.setWs('main') } } }, 'Accept ' + (n === all ? 'all' : n)),
          h('button.btn.sm.danger', { on: { click: async () => { if (!all || await confirmBox('Reject "' + ov.title + '"?', 'Its ' + plural(all, 'change') + ' are discarded. The timeline keeps them.', 'Reject')) { P.reject(ov.id); if (App.ws === ov.id) App.setWs('main') } } } }, 'Reject')))
        const files = h('div.files')
        if (!all) files.appendChild(h('p.note', 'No changes yet.'))
        for (const c of ch) {
          const st = diffStat(c.before ?? '', c.after ?? ''), key = ov.id + c.path, shown = S.shown[key] ?? ch.length <= 3
          const cb = h('input', { type: 'checkbox', checked: pick[c.path], on: { change: () => { pick[c.path] = cb.checked; paint() } } })
          files.appendChild(h('div', h('label', cb, h('span', c.path), h('span.note', c.created ? 'new' : c.deleted ? 'deleted' : '+' + st.add + ' −' + st.del), c.conflict ? h('span.tag', { style: { color: 'var(--accent)', borderColor: 'var(--accent)' } }, 'main changed since') : null,
            h('span.sp'), h('button.link.note', { on: { click: e => { e.preventDefault(); S.shown[key] = !shown; paint() } } }, shown ? 'hide diff' : 'show diff'), ' ', h('button.link.note', { on: { click: e => { e.preventDefault(); App.setWs(ov.id); App.reveal(c.path, 1) } } }, 'open')),
            shown ? diffView(c.before ?? '', c.after ?? '') : null))
        }
        for (const c of tch) {
          const key = ov.id + 'table:' + c.name, shown = S.shown[key] ?? (c.added.length + c.removed.length + c.changed.length) <= 6
          const cb = h('input', { type: 'checkbox', checked: pick['table:' + c.name], on: { change: () => { pick['table:' + c.name] = cb.checked; paint() } } })
          files.appendChild(h('div', h('label', cb, h('span', 'table ' + c.name), h('span.note', c.created ? 'new table, ' + plural(c.after.rows.length, 'row') : c.dropped ? 'dropped' : '+' + c.added.length + ' −' + c.removed.length + ' ~' + c.changed.length + ' rows'),
            c.conflict ? h('span.tag', { title: 'Main\'s rows changed after the proposal copied the table; accepting replaces them', style: { color: 'var(--accent)', borderColor: 'var(--accent)' } }, 'main changed since') : null,
            h('span.sp'), h('button.link.note', { on: { click: e => { e.preventDefault(); S.shown[key] = !shown; paint() } } }, shown ? 'hide rows' : 'show rows')),
            shown ? rowDiff(c) : null))
        }
        card.appendChild(files)
        if (all) card.appendChild(checksPanel(P, ov))
        body.appendChild(card)
      }
      const closed = [...P.overlays.values()].filter(o => o.status !== 'open' && o.status !== 'discarded').sort((a, b) => b.updated - a.updated).slice(0, 12)
      if (closed.length) { body.appendChild(h('div.toolbar', h('b', 'Closed'))); body.appendChild(h('div.rows', { style: { padding: '0 12px 8px' } }, closed.map(o => h('div', h('span', o.title), h('span.note', o.status), h('span.sp'), h('span.note', fmtAgo(o.updated)))))) }
      const pins = P.meta.pins || []
      body.appendChild(h('div.toolbar', h('b', 'Pins'), h('span.note', 'Comment mode: click a frame to pin a note'), h('span.sp'), h('span.note', pins.filter(p => !p.resolved).length + ' open')))
      body.appendChild(h('div.rows', { style: { padding: '0 12px 12px' } }, pins.length ? pins.slice().sort((a, b) => a.resolved - b.resolved || b.n - a.n).map(p => h('div', { style: { opacity: p.resolved ? 0.55 : 1 } },
        h('b', '#' + p.n), h('span', { style: { flex: 1 } }, p.text, p.reply ? h('div.note', '↳ ' + p.reply) : null), h('span.note', p.route),
        !p.resolved ? h('button.link.note', { on: { click: () => App.askAgent('Address pin #' + p.n + ' on ' + p.route + ' (' + (p.src || '') + '): ' + p.text) } }, 'ask agent') : null,
        h('button.link.note', { on: { click: () => { p.resolved = !p.resolved; P.saveMeta(); App.ev.emit('pins') } } }, p.resolved ? 'reopen' : 'resolve'))) : h('p.note', 'No pins.')))
    }
    const later = debounce(() => { if (Dock.visible('review')) paint(); Dock.refreshTabs() }, 150)
    App.ev.on('overlays', later); App.ev.on('files', later); App.ev.on('tables', later); App.ev.on('pins', later); App.ev.on('ws', later); App.ev.on('project', later)
    return { el, show: paint }
  }
})

// ---------- timeline: lanes of who did what, marks, files written when, diff and restore ----------
// mark kinds: who makes them and how they look
const MARK_STYLE = { bookmark: ['◆', 'var(--accent)', 'Bookmark'], milestone: ['◆', 'var(--a1)', 'Milestone'], decision: ['◆', 'var(--a2)', 'Decision'], question: ['?', 'var(--a4)', 'Question'], checkpoint: ['■', 'var(--ink)', 'Checkpoint'], auto: ['◇', 'var(--ink-2)', 'Automatic'] }
const markStyle = e => MARK_STYLE[e.mk || (e.who === 'agent' ? 'milestone' : 'bookmark')] || MARK_STYLE.bookmark
const STORY_KINDS = ['mark', 'msg', 'turn', 'accept', 'reject', 'delegate', 'scenario']
const KIND_STYLE = { scenario: 'var(--a4)', canvas: 'var(--ink-2)', delegate: 'var(--a2)', write: 'var(--ink)', remove: 'var(--accent)', eval: 'var(--a1)', turn: 'var(--a2)', msg: 'var(--ink-2)', accept: 'var(--good)', reject: 'var(--accent)', mark: 'var(--accent)', data: 'var(--a3)', pin: 'var(--a4)', overlay: 'var(--a1)', init: 'var(--ink-2)', note: 'var(--ink-2)' }
// thumbnails of snapshots; clicking one compares it with the same page now
function snapStrip(P, shots, title, hint) {
  const row = h('div.snapstrip')
  for (const s of shots.slice(0, 8)) {
    const cell = h('button.snap', { title: (s.label || s.route) + ' · ' + s.w + 'px · ' + fmtTime(s.t) + (hint ? '\n' + hint : '') , on: { click: () => compareSnapNow(P, s) } }, h('div.ph', { style: { width: s.w * 0.2 + 'px', height: s.h * 0.2 + 'px' } }), h('span.note', s.route + ' ' + s.w))
    row.appendChild(cell)
    Snaps.load(P, s.id).then(async doc => { if (!doc) return; const fz = await Snaps.frozen(P, doc, s, { scale: 0.2 }); const ph = cell.querySelector('.ph'); if (ph) ph.replaceWith(fz) })
  }
  return h('div', h('div.note', { style: { margin: '8px 0 4px' } }, title), row)
}
async function compareSnapNow(P, s) {
  const doc = await Snaps.load(P, s.id); if (!doc) return toast('That snapshot is gone')
  const fr = P.board().frames.find(f => f.w === s.w && f.route === s.route) || { id: null, route: s.route, w: s.w, h: s.h }
  const live = await (s.fixture ? Headless.get(P, s.route, s.ws === 'main' || (P.overlays.get(s.ws) || {}).status === 'open' ? s.ws : 'main', s.w, s.h, s.fixture) : layoutIn(P, fr, s.ws === 'main' || (P.overlays.get(s.ws) || {}).status === 'open' ? s.ws : 'main').then(x => x.fh))
  const cur = await Snaps.capture(live)
  compareModal(P, s.route + ' ' + s.w + 'px: ' + (s.label || fmtTime(s.t)) + ' → now', { label: (s.label || '') + ' ' + fmtTime(s.t), doc, meta: s }, { label: 'now', doc: cur, meta: cur }, layoutDiff(doc.layout, cur.layout))
}

registerView('timeline', {
  title: 'Timeline', sub: 'session history',
  make() {
    const S = { kind: 'all', path: null, sel: null }
    const svgWrap = h('div', { style: { overflowX: 'auto', borderBottom: '1px solid var(--hair)', flex: 'none' } }), story = h('div.story'), side = h('div.tlside')
    const bar = h('div.toolbar')
    const el = h('div', bar, h('div.tl', h('div.tlmain', svgWrap, story), side))
    const P = () => App.P
    const filt = e => (S.kind === 'all' || (S.kind === 'files' && (e.kind === 'write' || e.kind === 'remove' || e.kind === 'accept')) || (S.kind === 'agent' && e.who === 'agent') || (S.kind === 'story' && STORY_KINDS.includes(e.kind))) && (!S.path || e.path === S.path || (e.paths || []).includes(S.path))
    const laneOf = e => e.kind === 'mark' ? 'marks' : e.who === 'agent' ? 'agent:' + (e.thread || '?') : e.who === 'site' ? 'site' : 'you'
    const label = e => e.kind === 'write' ? (e.created ? 'created ' : 'wrote ') + e.path + (e.ws !== 'main' ? ' (proposal)' : '') : e.kind === 'remove' ? 'removed ' + e.path : e.kind === 'mark' ? e.label + (e.mk && e.mk !== 'bookmark' && e.mk !== 'milestone' ? ' (' + e.mk + ')' : '') : e.kind === 'eval' ? 'eval: ' + (e.calls && e.calls.length ? e.calls.join(', ') : e.note) : e.kind === 'turn' ? 'reply: ' + (e.note || '') : e.kind === 'msg' ? 'asked: ' + e.note : e.kind === 'data' ? e.table + ' ' + e.note : (e.kind + (e.note ? ': ' + e.note : ''))
    function paintBar() {
      clear(bar)
      put(bar, h('div.seg.sm', [['all', 'All'], ['files', 'Files'], ['agent', 'Agent'], ['story', 'Story']].map(([k, l]) => h('button' + (S.kind === k ? '.on' : ''), { on: { click: () => { S.kind = k; paint() } } }, l))),
        S.path ? h('span.tag', S.path, h('button', { style: { background: 'none', border: 0 }, on: { click: () => { S.path = null; paint() } } }, '×')) : null, h('span.sp'),
        h('span.note', P() ? plural(P().events.length, 'event') : ''),
        App.playhead != null ? [h('button.btn.sm', { title: 'Step through every change to the pages up to now', on: { click: togglePlay } }, S.playing ? '■ Stop' : '▶ Play'), h('button.btn.sm.primary', { title: 'The canvas shows the pages as they are now', on: { click: () => { stopPlay(); App.setPlayhead(null) } } }, 'Now')]
          : h('button.btn.sm', { title: 'Show the pages on the canvas as they were at a point in time; drag the line along the timeline', on: { click: () => { const p = P(), pe = App.pageEvents(p); App.setPlayhead(S.sel != null ? S.sel : pe.length > 1 ? pe[pe.length - 2].i : 0) } } }, 'Playhead'),
        h('button.btn.sm', { on: { click: () => App.addMark() } }, '+ Mark'))
    }
    function stopPlay() { clearInterval(S.playT); S.playing = false }
    function togglePlay() {
      if (S.playing) { stopPlay(); paintBar(); return }
      S.playing = true; paintBar()
      S.playT = setInterval(() => { const p = P(), nx = p && App.pageEvents(p).find(x => x.i > App.playhead); if (!nx) { stopPlay(); paintBar(); return } App.setPlayhead(nx.i) }, 900)
    }
    function paintLanes() {
      clear(svgWrap); const p = P(); if (!p) return
      const evs = p.events.filter(filt), lanes = ['you']
      for (const e of evs) { const l = laneOf(e); if (!lanes.includes(l)) lanes.push(l) }
      if (lanes.includes('marks')) { lanes.splice(lanes.indexOf('marks'), 1); lanes.push('marks') }
      const LW = 110, DX = 14, W = Math.max(400, LW + evs.length * DX + 40), H = 26 + lanes.length * 26 + 10
      const svg = svgEl('svg', { class: 'tlsvg', width: W, height: H })
      lanes.forEach((l, i) => {
        const y = 26 + i * 26 + 13, th = l.startsWith('agent:') ? p.threads.get(l.slice(6)) : null
        svg.appendChild(svgEl('line', { x1: LW, x2: W - 10, y1: y, y2: y, stroke: 'var(--rule)' }))
        svg.appendChild(svgEl('text', { x: 10, y: y + 4, 'font-size': 11, fill: 'var(--ink-2)', text: l === 'you' ? 'You' : l === 'site' ? 'Pages' : l === 'marks' ? 'Marks' : 'Claude · ' + ((th && th.role) || (th && th.title) || 'thread').slice(0, 12) }))
      })
      let lastDay = '', lastLabel = -1e9
      evs.forEach((e, k) => {
        const x = LW + 10 + k * DX, y = 26 + lanes.indexOf(laneOf(e)) * 26 + 13
        const tm = fmtTime(e.t).slice(0, 5); if (k % 12 === 0 && tm !== lastDay) { lastDay = tm; svg.appendChild(svgEl('text', { x, y: 12, 'font-size': 9.5, fill: 'var(--ink-2)', text: tm })) }
        if (e.kind === 'mark' && e.mk !== 'auto') {
          const mc = markStyle(e)[1]
          svg.appendChild(svgEl('line', { x1: x, x2: x, y1: 16, y2: H - 4, stroke: mc, 'stroke-dasharray': '3 3', opacity: 0.7 }))
          if (x - lastLabel > 96) { svg.appendChild(svgEl('text', { x: x + 3, y: 22, 'font-size': 9.5, fill: mc, text: e.label.slice(0, 16) })); lastLabel = x }
        }
        const c = e.kind === 'mark' ? markStyle(e)[1] : KIND_STYLE[e.kind] || 'var(--ink-2)', on = S.sel === e.i
        const shape = e.kind === 'mark' ? (e.mk === 'auto' ? svgEl('path', { d: `M${x},${y - 4} L${x + 4},${y} L${x},${y + 4} L${x - 4},${y} z`, fill: 'var(--bg)', stroke: c, 'stroke-width': 1.2 }) : e.mk === 'checkpoint' ? svgEl('rect', { x: x - 5, y: y - 5, width: 10, height: 10, fill: c }) : svgEl('path', { d: `M${x},${y - 6} L${x + 6},${y} L${x},${y + 6} L${x - 6},${y} z`, fill: c })) : svgEl('circle', { cx: x, cy: y, r: on ? 6 : 4.5, fill: e.kind === 'msg' || e.ws !== 'main' && e.kind === 'write' ? 'var(--bg)' : c, stroke: c, 'stroke-width': 1.5 })
        const g = svgEl('g', { style: 'cursor:pointer' }, svgEl('title', { text: fmtTime(e.t) + ' ' + label(e) }), shape)
        if (on) g.appendChild(svgEl('circle', { cx: x, cy: y, r: 9, fill: 'none', stroke: 'var(--ink)' }))
        g.addEventListener('click', () => { S.sel = e.i; paint() })
        svg.appendChild(g)
      })
      // the playhead: a line at the last shown event at or before it; drag it (or click the time strip) to move it
      const xOf = k => LW + 10 + k * DX
      if (App.playhead != null) {
        let k = -1; evs.forEach((e, j) => { if (e.i <= App.playhead) k = j })
        const x = k < 0 ? LW : xOf(k)
        svg.append(svgEl('line', { x1: x, x2: x, y1: 14, y2: H - 2, class: 'ph-line' }), svgEl('rect', { x: x - 5, y: 2, width: 10, height: 12, class: 'ph-knob' }))
      }
      const strip = svgEl('rect', { x: LW, y: 0, width: W - LW, height: 16, fill: 'transparent', style: 'cursor:ew-resize' })
      strip.appendChild(svgEl('title', { text: 'Drag to move the playhead: the canvas shows the pages as they were' }))
      const at = ev => { const r = svg.getBoundingClientRect(), k = clamp(Math.round((ev.clientX - r.left - LW - 10) / DX), 0, evs.length - 1); if (evs[k]) { S.sel = evs[k].i; App.setPlayhead(evs[k].i) } }
      strip.addEventListener('pointerdown', ev => { ev.preventDefault(); strip.setPointerCapture(ev.pointerId); stopPlay(); at(ev); const mv = e2 => at(e2), up = () => { strip.removeEventListener('pointermove', mv); strip.removeEventListener('pointerup', up) }; strip.addEventListener('pointermove', mv); strip.addEventListener('pointerup', up) })
      svg.appendChild(strip)
      const keep = App.playhead != null && S.scrolled != null ? svgWrap.scrollLeft : null
      svgWrap.appendChild(svg)
      if (keep != null) svgWrap.scrollLeft = keep
      else svgWrap.scrollLeft = svgWrap.scrollWidth
      S.scrolled = true
    }
    function paintStory() {
      clear(story); const p = P(); if (!p) return
      const evs = p.events.filter(filt).slice(-300)
      if (!evs.length) story.appendChild(h('p.empty', 'Nothing yet.'))
      for (const e of evs) {
        const b = h('button', { style: S.sel === e.i ? { background: 'var(--sel)' } : null, on: { click: () => { S.sel = e.i; paint() } } },
          h('span', { style: { color: e.kind === 'mark' ? markStyle(e)[1] : KIND_STYLE[e.kind] || 'var(--ink-2)' } }, e.kind === 'mark' ? markStyle(e)[0] : '●'), h('span.t', fmtTime(e.t)), h('span', label(e), e.who === 'agent' ? h('span.note', ' · Claude') : null))
        story.appendChild(b)
      }
      const selB = story.querySelector('[style*="var(--sel)"]'); if (selB) selB.scrollIntoView({ block: 'nearest' })
    }
    function before(p, e) {
      for (let j = e.i - 1; j >= 0; j--) { const x = p.events[j]; if (x.path === e.path && x.ws === e.ws && x.kind === 'write') return x.after; if (x.path === e.path && x.ws === e.ws && x.kind === 'remove') return null }
      const st = p.stateAt(e.i - 1); return st.has(e.path) ? st.get(e.path) : null
    }
    function paintSide() {
      clear(side); const p = P(); if (!p) return
      const e = S.sel != null ? p.events[S.sel] : null
      if (e) {
        const blk = h('div.block', h('header', h('h3', e.kind), h('span.sub', new Date(e.t).toLocaleString())),
          h('dl.kv', h('dt', 'Who'), h('dd', e.who === 'agent' ? 'Claude' + ((p.threads.get(e.thread) || {}).title ? ' · ' + p.threads.get(e.thread).title : '') : e.who === 'site' ? 'a page' : e.who === 'ide' ? 'Sitebench' : 'You'),
            h('dt', 'Where'), h('dd', e.ws === 'main' ? 'main' : 'proposal "' + ((p.overlays.get(e.ws) || {}).title || '?') + '"'),
            e.path ? [h('dt', 'File'), h('dd', h('button.link', { on: { click: () => { S.path = e.path; paint() } } }, e.path))] : null,
            e.note || e.label ? [h('dt', 'Note'), h('dd', e.label || e.note)] : null))
        const acts = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } })
        if (e.path && (e.kind === 'write' || e.kind === 'remove')) acts.appendChild(h('button.btn.sm.primary', { title: 'Open the file as it was right after this event', on: { click: () => { if (e.ws !== App.ws && e.ws !== 'main' && (p.overlays.get(e.ws) || {}).status === 'open') App.setWs(e.ws); App.viewVersion(e.path, e.i) } } }, 'View this version'))
        if (e.path && p.read(e.path, e.ws === 'main' || (p.overlays.get(e.ws) || {}).status === 'open' ? e.ws : 'main') !== null) acts.appendChild(h('button.btn.sm', { on: { click: () => { if (e.ws !== App.ws && (e.ws === 'main' || (p.overlays.get(e.ws) || {}).status === 'open')) App.setWs(e.ws); App.reveal(e.path, 1) } } }, 'Open current'))
        if (e.thread && p.threads.get(e.thread)) acts.appendChild(h('button.btn.sm', { on: { click: () => { App.showThread(e.thread) } } }, 'Open thread'))
        acts.appendChild(h('button.btn.sm', { title: 'The canvas shows the pages as they were just after this event', on: { click: () => App.setPlayhead(e.i) } }, App.playhead === e.i ? 'On the canvas' : 'Show on canvas'))
        acts.appendChild(h('button.btn.sm', { on: { click: () => showSince(e.i) } }, 'Diff since'))
        acts.appendChild(h('button.btn.sm.danger', { on: { click: async () => { const n = p.since(e.i).length; if (!n) return toast('Main is already as it was then'); if (await confirmBox('Restore main to this point?', plural(n, 'file') + ' go back to how they were just after this event. That is logged too, so you can return.', 'Restore')) toast('Restored ' + plural(p.restore(e.i), 'file')) } } }, 'Restore'))
        blk.appendChild(acts)
        const shots = Snaps.list(p).filter(s => s.events.includes(e.i))
        if (shots.length) blk.appendChild(snapStrip(p, shots, 'Frames at this point', 'Click one to compare it with the page now'))
        if (e.kind === 'write') blk.appendChild(diffView(before(p, e) ?? '', e.after ?? ''))
        side.appendChild(blk)
      }
      const marks = p.marks()
      side.appendChild(h('div.block', h('header', h('h3', 'Marks'), h('span.sub', 'yours and Claude\'s')),
        marks.length ? h('div.rows', marks.slice().reverse().map(m => h('button', { on: { click: () => { S.sel = m.i; paint() } } }, h('span', { style: { color: markStyle(m)[1] } }, markStyle(m)[0]), h('span', { style: { flex: 1 } }, m.label, m.note ? h('div.note', m.note) : null), h('span.note', markStyle(m)[2] + ' · ' + (m.who === 'agent' ? 'Claude · ' : m.who === 'ide' ? '' : 'you · ') + fmtTime(m.t))))) : h('p.note', 'Add one with + Mark; Claude marks milestones, decisions and guesses with session.mark().')))
      const files = new Map()
      for (const x of p.events) if ((x.kind === 'write' || x.kind === 'remove') && x.path) { const f = files.get(x.path) || { n: 0, t: 0, agent: 0 }; f.n++; f.t = x.t; if (x.who === 'agent') f.agent++; files.set(x.path, f) }
      side.appendChild(h('div.block', h('header', h('h3', 'Files written'), h('span.sub', 'click to filter')),
        h('div.rows', [...files].sort((a, b) => b[1].t - a[1].t).map(([path, f]) => h('button' + (S.path === path ? '.on' : ''), { on: { click: () => { S.path = S.path === path ? null : path; S.kind = 'all'; paint() } } }, h('span.mono', { style: { flex: 1, fontSize: '11.5px' } }, path), h('span.note', f.n + '×' + (f.agent ? ' (' + f.agent + ' Claude)' : '')), h('span.note', fmtTime(f.t)))))))
    }
    function showSince(i) {
      const p = P(), ch = p.since(i), e = p.events[i]
      modal({ title: 'Main since ' + fmtTime(e.t) + ' · ' + label(e).slice(0, 40), wide: true, body: ch.length ? ch.map(c => h('div', h('b.mono', c.path), ' ', h('span.note', c.before === null ? 'new' : c.after === null ? 'deleted' : ''), diffView(c.before ?? '', c.after ?? ''))) : h('p', 'No changes in main since then.'),
        actions: [{ label: 'Close' }] })
    }
    function paint() { paintBar(); paintLanes(); paintStory(); paintSide() }
    const later = debounce(() => { if (Dock.visible('timeline')) paint() }, 200)
    App.ev.on('events', later); App.ev.on('project', () => { S.sel = null; S.path = null; clearInterval(S.playT); S.playing = false; later() })
    App.ev.on('playhead', () => { if (App.playhead == null) { clearInterval(S.playT); S.playing = false } else S.sel = App.playhead; if (Dock.visible('timeline')) { paintBar(); paintLanes(); paintSide() } })
    App.timeline = { select(i) { S.sel = i; S.kind = 'all'; S.path = null; paint() } }
    // arrow keys step the playhead through changes to the pages
    el.tabIndex = -1
    el.addEventListener('keydown', ev => {
      if (App.playhead == null || !/^Arrow(Left|Right)$/.test(ev.key) || ev.target.closest('input, textarea, select')) return
      ev.preventDefault(); const list = App.pageEvents(P()), j = ev.key === 'ArrowLeft' ? [...list].reverse().find(x => x.i < App.playhead) : list.find(x => x.i > App.playhead)
      if (j) App.setPlayhead(j.i); else if (ev.key === 'ArrowRight') App.setPlayhead(null)
    })
    App.ev.on('version', v => { if (v && S.sel !== v.i) { S.sel = v.i; later() } })
    App.timeline = { focus: (i, path) => { S.sel = i; if (path) S.path = path; Dock.open('timeline'); paint() } }
    return { el, show: paint }
  }
})

// ===== 10b-archive.js =====
// ---------- archives: zip a whole project (files, tables, proposals, threads, transcripts, timeline), read it back ----------
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
async function viaStream(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()) }
async function deflateRaw(u8) { try { return typeof CompressionStream === 'undefined' ? null : await viaStream(u8, new CompressionStream('deflate-raw')) } catch { return null } }
async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unzip compressed files')
  return viaStream(u8, new DecompressionStream('deflate-raw'))
}
// entries: [{name, data: string | Uint8Array}] -> Blob (deflate when it helps, else store; UTF-8 names)
async function makeZip(entries) {
  const enc = new TextEncoder(), parts = [], central = []
  const d = new Date(), dt = (((d.getFullYear() - 1980) << 25) | ((d.getMonth() + 1) << 21) | (d.getDate() << 16) | (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) >>> 0
  let off = 0
  for (const e of entries) {
    const name = enc.encode(e.name), raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data
    const crc = crc32(raw); let body = raw, method = 0
    if (raw.length > 128) { const z = await deflateRaw(raw); if (z && z.length < raw.length) { body = z; method = 8 } }
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true); lh.setUint32(10, dt, true)
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true)
    parts.push(new Uint8Array(lh.buffer), name, body)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true); ch.setUint32(12, dt, true)
    ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true)
    central.push(new Uint8Array(ch.buffer), name)
    off += 30 + name.length + body.length
  }
  const size = central.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, size, true); end.setUint32(16, off, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' })
}
async function readZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--
  if (e < 0) throw new Error('not a zip file')
  const n = dv.getUint16(e + 10, true), dec = new TextDecoder(), out = []
  let p = dv.getUint32(e + 16, true)
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip directory')
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + xlen + clen
    if (name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)/.test(name)) continue
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), body = u8.subarray(start, start + csize)
    if (method === 0) out.push({ name, data: body }); else if (method === 8) out.push({ name, data: await inflateRaw(body) })
  }
  return out
}

// ---------- readable exports ----------
const fence = (text, lang = '') => { const run = Math.max(2, ...((String(text).match(/`+/g) || []).map(s => s.length))) + 1; const f = '`'.repeat(run); return f + lang + '\n' + text + '\n' + f }
const slug = s => String(s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'untitled'
const stamp = t => new Date(t).toISOString().replace('T', ' ').slice(0, 19)
function transcriptMd(P, th) {
  const out = ['# ' + th.title, '', 'Project: ' + P.title + ' · thread started ' + stamp(th.created) + ' · exported ' + stamp(now()), 'Mode: ' + (th.mode || 'auto') + ' · writes to: ' + (th.target === 'main' ? 'main' : 'proposals') + ' · model: ' + (th.model || th.tier || 'default'), '']
  if (th.summary) out.push('> **Summary Claude sees in place of messages 1–' + th.summary.upTo + '** (' + (th.summary.by === 'you' ? 'edited by you' : th.summary.by === 'fallback' ? 'listed without a model' : 'by Claude') + ', ' + stamp(th.summary.t) + ')', '>', ...th.summary.text.split('\n').map(l => '> ' + l), '')
  for (const [i, m] of th.msgs.entries()) {
    if (th.summary && i === th.summary.upTo) out.push('---', '', '*Claude sees the messages from here on in full; the ones above are summarized.*', '')
    out.push('---', '')
    if (m.role === 'user') {
      out.push('## You · ' + stamp(m.t), '')
      const ctx = [m.ctx && m.ctx.sel ? 'selected ' + m.ctx.sel.tag + ' at ' + m.ctx.sel.src : '', m.ctx && m.ctx.pins ? plural(m.ctx.pins, 'open pin') : ''].filter(Boolean)
      if (ctx.length) out.push('> context: ' + ctx.join(' · '), '')
      out.push(m.text, '')
      continue
    }
    out.push('## Claude · ' + stamp(m.t) + (m.model ? ' · ' + m.model : ''), '')
    ;(m.steps || []).forEach((s, i) => {
      out.push('### eval ' + (i + 1) + ' · ' + (s.status || '?') + (s.ms != null ? ' · ' + s.ms + ' ms' : '') + (s.calls && s.calls.length ? ' · ' + [...new Set(s.calls)].join(', ') : ''), '', fence(s.code, 'js'), '')
      if (s.logs && s.logs.length) out.push('Logs:', '', fence(s.logs.join('\n')), '')
      if (s.out) out.push('Result:', '', fence(s.out, s.fmt || (s.status === 'ok' ? 'json' : '')), '')
    })
    if (m.text) out.push(m.text, '')
    if (m.error) out.push('> ' + m.error, '')
    if (m.summary) out.push('_' + m.summary + '_', '')
  }
  return out.join('\n')
}
function timelineMd(P) {
  const who = e => e.who === 'agent' ? 'Claude' + (P.threads.get(e.thread) ? ' (' + P.threads.get(e.thread).title + ')' : '') : e.who === 'site' ? 'page' : e.who === 'ide' ? 'Sitebench' : 'you'
  const what = e => e.kind === 'write' ? (e.created ? 'created ' : 'wrote ') + '`' + e.path + '`' : e.kind === 'remove' ? 'removed `' + e.path + '`' : e.kind === 'mark' ? '**' + (e.mk || 'mark') + ': ' + e.label + '**' + (e.note ? ' (' + e.note + ')' : '') : e.kind === 'eval' ? 'eval' + (e.calls && e.calls.length ? ': ' + e.calls.join(', ') : '') : e.kind === 'data' ? e.table + ' ' + e.note : e.kind
  const out = ['# Timeline: ' + P.title, '', '| # | Time | Who | What | Where | Note |', '|---|---|---|---|---|---|']
  for (const e of P.events) out.push('| ' + e.i + ' | ' + stamp(e.t) + ' | ' + who(e) + ' | ' + what(e) + ' | ' + (e.ws === 'main' || !e.ws ? 'main' : 'proposal ' + ((P.overlays.get(e.ws) || {}).title || e.ws)).replace(/\|/g, '/') + ' | ' + String(e.note || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 140) + ' |')
  return out.join('\n') + '\n'
}
async function projectZip(P) {
  const E = [], add = (name, data) => E.push({ name, data: typeof data === 'string' ? data : JSON.stringify(data, null, 1) })
  add('sitebench.json', { sitebench: 2, app: 'Sitebench', title: P.title, template: P.meta.template, created: P.meta.created, exported: now(),
    counts: { files: P.files.size, tables: P.tables.size, proposals: P.overlays.size, threads: P.threads.size, events: P.events.length },
    layout: 'files/ = the site (main). tables/ = data. proposals/ = overlay workspaces. threads/ + transcripts/ = agent chats. timeline.json = the full session log (file contents after each write).' })
  add('project.json', { title: P.meta.title, template: P.meta.template, created: P.meta.created, updated: P.meta.updated, boards: P.meta.boards, pins: P.meta.pins, store: P.meta.store, view: P.meta.view })
  for (const [path, text] of [...P.files].sort()) add('files/' + path, text)
  for (const t of P.tables.values()) add('tables/' + t.name + '.json', t)
  for (const ov of P.overlays.values()) {
    add('proposals/' + ov.id + '.json', ov)
    if (ov.status === 'open') for (const [path, text] of Object.entries(ov.files)) if (text !== null) add('proposals/' + ov.id + '-' + slug(ov.title) + '/' + path, text)
  }
  let k = 0
  for (const th of [...P.threads.values()].sort((a, b) => a.created - b.created)) { k++; add('threads/' + th.id + '.json', th); add('transcripts/' + String(k).padStart(2, '0') + '-' + slug(th.title) + '.md', transcriptMd(P, th)) }
  add('timeline.json', P.events); add('timeline.md', timelineMd(P))
  return makeZip(E)
}
// zip (Sitebench export, or any folder of site files) or JSON -> data for Projects.create
const TEXT_EXT = /\.(html?|css|js|mjs|json|md|markdown|svg|txt|xml|csv)$/i
async function readArchive(buf, filename = 'import') {
  const head = new Uint8Array(buf.slice ? buf.slice(0, 4) : buf)
  if (!(head[0] === 0x50 && head[1] === 0x4b)) {
    const d = JSON.parse(new TextDecoder().decode(buf)); if (!d || typeof d.files !== 'object') throw new Error('no files in that JSON'); return d
  }
  const entries = await readZip(buf), dec = new TextDecoder()
  const manifest = entries.find(e => /(^|\/)sitebench\.json$/.test(e.name))
  if (manifest) {
    const root = manifest.name.slice(0, -'sitebench.json'.length), J = name => { const e = entries.find(x => x.name === root + name); return e ? JSON.parse(dec.decode(e.data)) : null }
    const m = JSON.parse(dec.decode(manifest.data)), meta = J('project.json') || {}
    const data = { title: meta.title || m.title, template: meta.template || m.template, created: meta.created, boards: meta.boards, pins: meta.pins || [], store: meta.store || {}, files: {}, tables: {}, overlays: [], threads: [], events: J('timeline.json') || [] }
    for (const e of entries) {
      const n = e.name.slice(root.length)
      if (!e.name.startsWith(root)) continue
      if (n.startsWith('files/')) data.files[n.slice(6)] = dec.decode(e.data)
      else if (/^tables\/[^/]+\.json$/.test(n)) { const t = JSON.parse(dec.decode(e.data)); data.tables[t.name || n.slice(7, -5)] = t }
      else if (/^proposals\/[^/]+\.json$/.test(n)) data.overlays.push(JSON.parse(dec.decode(e.data)))
      else if (/^threads\/[^/]+\.json$/.test(n)) data.threads.push(JSON.parse(dec.decode(e.data)))
    }
    return data
  }
  // a plain folder of site files: keep text files, drop a shared top folder
  const texts = entries.filter(e => TEXT_EXT.test(e.name) && e.data.length < 240000)
  if (!texts.length) throw new Error('no text files (html, css, js, md…) in that zip')
  const tops = new Set(texts.map(e => e.name.includes('/') ? e.name.split('/')[0] + '/' : ''))
  const strip = tops.size === 1 && [...tops][0] ? [...tops][0] : ''
  const files = {}
  for (const e of texts) { const p = e.name.slice(strip.length); if (!validPath(p)) files[p] = dec.decode(e.data) }
  return { title: (strip ? strip.slice(0, -1) : filename.replace(/\.zip$/i, '')) || 'Imported site', template: 'import', files, tables: {} }
}
// hand a file to the viewer: the downloads capability when granted, else a plain link click
async function saveFile(filename, data) {
  let dl = null; try { dl = window.claude && await window.claude.use('downloads') } catch { }
  if (dl) {
    try { await dl.save({ filename, data }); toast('Saved ' + filename); return true }
    catch (e) { if (e && e.code === 'declined') return false; if (e && !['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e.code)) { toast('Download failed: ' + (e.message || e.code)); return false } }
  }
  const blob = data instanceof Blob ? data : new Blob([data]), url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: filename, style: { display: 'none' } }); document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  toast('Downloading ' + filename)
  return true
}

// ===== 10c-scenarioview.js =====
// ---------- scenarios panel: flows that pass or fail, the fixtures they run on ----------
registerView('scenarios', {
  title: 'Scenarios', sub: 'flows that pass or fail',
  badge: () => { const P = App.P; if (!P) return null; const bad = scenarioList(P, App.ws).filter(s => s.last && !s.last.ok).length; return bad ? h('span.count', String(bad)) : null },
  make() {
    const S = { open: {}, live: {}, busy: false }
    const body = h('div.scroll'), el = h('div', body)
    const P = () => App.P
    function paint() {
      clear(body); const p = P(); if (!p) return
      const ws = App.ws, list = scenarioList(p, ws), fxs = fixtureList(p, ws)
      body.appendChild(h('div.toolbar', h('b', 'Scenarios'), h('span.note', 'each runs in a frame of its own on a copy of the data' + (ws !== 'main' ? ', in this proposal' : '')), h('span.sp'),
        h('button.btn.sm', { disabled: S.busy || !list.length, on: { click: runAll } }, S.busy ? 'Running…' : 'Run all'),
        h('button.btn.sm', { on: { click: newScenario } }, '+ New')))
      if (!list.length) body.appendChild(h('div.empty', h('p', 'No scenarios yet.'), h('p.note', 'Record one from a frame\'s ⋯ menu (click and type in Play mode; pick an element in Select mode to check its text), write scenarios/<name>.json by hand, or ask Claude: "write scenarios for ordering and run them".')))
      for (const s of list) body.appendChild(card(p, s))
      body.appendChild(h('div.toolbar', h('b', 'Fixtures'), h('span.note', 'fixed data for frames and scenarios'), h('span.sp'), h('button.btn.sm', { on: { click: newFixture } }, '+ New')))
      if (!fxs.length) body.appendChild(h('p.note', { style: { padding: '0 12px 12px' } }, 'None yet. A fixture holds rows (and optionally a clock) to run a page against instead of the live data: an empty menu, very long names, a hundred orders, a time after closing.'))
      else body.appendChild(h('div.rows', { style: { padding: '0 12px 12px' } }, fxs.map(f => h('div', h('b', f.name), h('span', { style: { flex: 1 } }, f.error ? h('span', { style: { color: 'var(--accent)' } }, f.error) : [f.description ? f.description + ' · ' : '', f.tables.map(t => t + ' (' + (Array.isArray(f.spec.tables[t]) ? f.spec.tables[t].length : f.spec.tables[t]) + ')').join(', '), f.clock ? ' · clock ' + f.clock : '']),
        h('button.link.note', { on: { click: () => App.reveal(f.path, 1) } }, 'edit')))))
    }
    function card(p, s) {
      const live = S.live[s.name], last = s.last, shown = S.open[s.name] ?? (!!live || (last && !last.ok))
      const state = live ? (live.done ? (live.ok ? 'ok' : 'bad') : 'run') : last ? (last.ok ? 'ok' : 'bad') : 'none'
      const icon = { ok: '✓', bad: '✗', run: '◌', none: '○' }[state]
      const head = h('div.sh', h('span.si.' + state, icon), h('button.link', { on: { click: () => { S.open[s.name] = !shown; paint() } } }, h('b', s.name)),
        s.spec && s.spec.description ? h('span.note', s.spec.description) : null, h('span.sp'),
        s.spec ? h('span.note', s.spec.page + (s.spec.fixture ? ' · fixture ' + s.spec.fixture : '') + ' · ' + plural(s.spec.steps.length, 'step')) : null,
        last && !live ? h('span.note', fmtAgo(last.t)) : null,
        h('button.btn.sm', { disabled: !!s.error || S.busy, on: { click: () => run(s) } }, 'Run'),
        h('button.btn.sm', { on: { click: () => App.reveal(s.path, 1) } }, 'Edit'))
      const c = h('div.scard.' + state, head)
      if (s.error) { c.appendChild(h('p.note', { style: { color: 'var(--accent)', margin: '4px 0 0 26px' } }, s.error)); return c }
      if (!shown) return c
      const res = live || last, steps = h('ol.ssteps')
      s.spec.steps.forEach((st, i) => {
        const r = res && res.steps && res.steps[i], cls = !r ? (live && live.cur === i ? 'run' : '') : r.ok ? 'ok' : 'bad'
        steps.appendChild(h('li.' + (cls || 'todo'), h('span.m', cls === 'ok' ? '✓' : cls === 'bad' ? '✗' : cls === 'run' ? '◌' : '·'), h('span', stepLabel(st)), r && r.ms != null ? h('span.note', r.ms + ' ms') : null,
          r && r.error ? h('div.err', r.error) : null))
      })
      c.appendChild(steps)
      if (res && res.snaps && res.snaps.length) {
        const shots = res.snaps.map(x => Snaps.list(p).find(m => m.id === x.id)).filter(Boolean)
        if (shots.length) c.appendChild(snapStrip(p, shots, res.ok ? 'Where it ended' : 'Where it failed', 'Click to compare with the page now'))
      }
      if (res && !res.ok && !live) c.appendChild(h('div', { style: { margin: '6px 0 0 26px' } }, h('button.btn.sm', { on: { click: () => App.askAgent('Scenario "' + s.name + '" fails at step ' + (res.failedAt + 1) + ' (' + res.steps[res.failedAt].label + '): ' + res.steps[res.failedAt].error + '. Find out why (scenarios.read, scenarios.run, frames.*) and fix the page, or the scenario if the page is right.') } }, 'Ask Claude to fix')))
      return c
    }
    async function run(s) {
      const p = P(); S.live[s.name] = { steps: [], cur: 0 }; S.open[s.name] = true; paint()
      try {
        const r = await runScenario(p, s.spec, { ws: App.ws, name: s.name, onStep: st => { const L = S.live[s.name]; if (!L) return; if (st.running) L.cur = st.i; else L.steps[st.i] = st; later() } })
        S.live[s.name] = { ...r, done: true }
      } catch (e) { toast(s.name + ': ' + e.message); delete S.live[s.name] }
      setTimeout(() => { delete S.live[s.name]; later() }, 1200); paint()
    }
    async function runAll() {
      S.busy = true; paint()
      try { for (const s of scenarioList(P(), App.ws)) if (!s.error) await run(s) } finally { S.busy = false; paint() }
      const list = scenarioList(P(), App.ws), bad = list.filter(s => s.last && !s.last.ok).length
      toast(bad ? plural(bad, 'scenario') + ' failed' : 'All ' + plural(list.length, 'scenario') + ' passed')
    }
    async function newScenario() {
      const p = P(), n = await promptBox('New scenario', 'A name (letters, digits, -). You can also record one from a frame\'s ⋯ menu.', 'order-a-drink'); if (!n) return
      const page = (p.board().frames[0] || {}).route || 'index.html', path = SCEN_DIR + n.replace(/[^\w-]+/g, '-') + '.json'
      if (p.read(path, App.ws) === null) p.write(path, JSON.stringify({ description: '', page, steps: [{ waitFor: 'body' }, { click: 'a:has-text("Menu")' }, { expect: 'h1', text: 'Menu' }] }, null, 2) + '\n', { ws: App.ws, who: 'you', note: 'new scenario' })
      App.reveal(path, 1)
    }
    async function newFixture() {
      const p = P(), n = await promptBox('New fixture', 'Starts as a copy of the current tables; edit the rows to make the case you want.', 'empty-menu'); if (!n) return
      const tables = {}; for (const [k, t] of p.tablesIn(App.ws)) tables[k] = t.rows
      const path = fixturePath(n.replace(/[^\w-]+/g, '-'))
      if (p.read(path, App.ws) === null) p.write(path, JSON.stringify({ description: '', tables, clock: null }, null, 2) + '\n', { ws: App.ws, who: 'you', note: 'new fixture' })
      App.reveal(path, 1)
    }
    const later = debounce(() => { if (Dock.visible('scenarios')) paint(); Dock.refreshTabs() }, 80)
    App.ev.on('scenarios', later); App.ev.on('files', later); App.ev.on('ws', later); App.ev.on('project', () => { S.live = {}; later() })
    return { el, show: paint }
  }
})

// ===== 10d-panels.js =====
// ---------- panels: small UIs Claude declares ----------
// A panel is a list of items. Controls (slider, toggle, select, text, color, button) hold values; a control can be
// bound to the pages (a CSS variable or a style previewed live in every frame, a site.store key, a fixture), and the
// person can keep a previewed value in the CSS file. Widgets (value, chart, table, list, text) show live values
// from the project: table rows, the store, check issues, scenario results, events, a frame's DOM, or read-only code.
const PANEL_CONTROLS = ['slider', 'toggle', 'select', 'text', 'color', 'button']
const PANEL_WIDGETS = ['value', 'chart', 'table', 'list', 'text']
const SOURCE_KEYS = ['data', 'store', 'issues', 'scenarios', 'events', 'frameEvents', 'frame', 'eval', 'lib']
const FRAME_EVENT_KINDS = ['click', 'change', 'nav', 'load', 'console', 'error']

function checkPanel(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'a panel is { title, items: [ … ] }'
  if (!Array.isArray(spec.items) || !spec.items.length) return 'items must be a non-empty list of controls and widgets'
  if (spec.items.length > 24) return 'at most 24 items in a panel'
  const ids = new Set()
  for (const [i, it] of spec.items.entries()) {
    const where = 'item ' + (i + 1) + (it && it.id ? ' (' + it.id + ')' : '')
    if (!it || typeof it !== 'object') return where + ' is not an object'
    if (![...PANEL_CONTROLS, ...PANEL_WIDGETS].includes(it.type)) return where + ': type is one of ' + [...PANEL_CONTROLS, ...PANEL_WIDGETS].join(', ')
    if (PANEL_CONTROLS.includes(it.type) && it.type !== 'button') {
      if (!it.id || !/^[A-Za-z_][\w-]{0,30}$/.test(it.id)) return where + ': a ' + it.type + ' needs an id (a word), to read its value by'
      if (ids.has(it.id)) return where + ': id "' + it.id + '" is used twice'; ids.add(it.id)
    }
    if (it.type === 'slider' && (typeof it.min !== 'number' || typeof it.max !== 'number' || it.max <= it.min)) return where + ': a slider needs numbers min < max'
    if (it.type === 'select' && !Array.isArray(it.options) && !(it.bind && (it.bind.fixture || it.bind.css))) return where + ': a select needs options: [value, …] or [{ value, label }, …]'
    if (it.type === 'button' && typeof it.run !== 'string') return where + ': a button needs run: "code" (it runs as the person, with `values` in scope)'
    if (it.bind) {
      const b = it.bind, k = Object.keys(b).filter(x => ['cssVar', 'style', 'store', 'fixture', 'css'].includes(x))
      if (k.length !== 1) return where + ': bind is one of { cssVar: "--name", unit?, file? } | { style: { selector, prop }, unit?, file? } | { css: { on: {…}, off: {…} } } (toggle) or { css: { optionValue: {…} } } (select) | { store: key } | { fixture: { on?, off?, frames? } }'
      if (b.css) {
        if (!['toggle', 'select'].includes(it.type)) return where + ': bind.css is for a toggle ({ on, off }) or a select (one entry per option)'
        if (typeof b.css !== 'object' || !Object.keys(b.css).length) return where + ': bind.css maps each state to CSS: { on: { "--font": "…", "body": { "font-family": "…" } }, off: { … } }'
        for (const [state, map] of Object.entries(b.css)) {
          if (!map || typeof map !== 'object') return where + ': bind.css.' + state + ' must be an object'
          for (const [key, v] of Object.entries(map)) {
            if (key.startsWith('--')) { if (typeof v !== 'string' && typeof v !== 'number') return where + ': ' + key + ' in bind.css.' + state + ' must be a value' }
            else if (!v || typeof v !== 'object') return where + ': in bind.css.' + state + ', "' + key + '" is a selector, so it needs { property: value }'
          }
        }
      }
      if (b.cssVar && !/^--[\w-]+$/.test(b.cssVar)) return where + ': cssVar is a custom property name like "--menu-scale"'
      if (b.style && (!b.style.selector || !b.style.prop)) return where + ': style needs selector and prop'
    }
    if (['value', 'chart', 'table', 'list'].includes(it.type)) {
      if (!it.from || typeof it.from !== 'object' || !SOURCE_KEYS.some(k => k in it.from)) return where + ': from is one of ' + SOURCE_KEYS.map(k => '{ ' + k + ' }').join(', ')
    }
    if (it.type === 'chart' && it.kind && !['line', 'bar'].includes(it.kind)) return where + ': kind is line or bar'
  }
  return null
}

// ---------- the live preview: CSS variables and styles shown in every canvas frame, not yet in any file ----------
const Preview = {
  vars: {}, rules: {},              // name -> { value, panel }, 'selector|prop' -> { selector, prop, value, panel }
  payload() { return { vars: Object.fromEntries(Object.entries(this.vars).map(([k, v]) => [k, v.value])), rules: Object.values(this.rules).map(r => ({ selector: r.selector, prop: r.prop, value: r.value })) } },
  push() { const pv = this.payload(); for (const fh of FrameHosts) if (!fh.headless && fh.project === App.P) fh.push({ push: 'preview', preview: pv }); App.ev.emit('preview') },
  count(panel) { return Object.values(this.vars).filter(v => !panel || v.panel === panel).length + Object.values(this.rules).filter(r => !panel || r.panel === panel).length },
  clear(panel) { for (const [k, v] of Object.entries(this.vars)) if (!panel || v.panel === panel) delete this.vars[k]; for (const [k, r] of Object.entries(this.rules)) if (!panel || r.panel === panel) delete this.rules[k]; this.push() }
}
const cssFiles = (P, ws) => P.list(ws).filter(p => p.endsWith('.css'))
const fmtVal = (v, unit) => typeof v === 'number' ? String(Math.round(v * 1000) / 1000) + (unit || '') : String(v)

const Panels = {
  waiting: new Map(), runs: new Map(),
  list(P) { return P.meta.panels || (P.meta.panels = []) },
  get(P, id) { return this.list(P).find(p => p.id === id) || null },
  // create or replace; values the person set survive when the control is still there
  upsert(P, id, spec, o = {}) {
    const bad = checkPanel(spec); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
    let p = this.get(P, id)
    const values = {}
    for (const it of spec.items) if (it.id && it.type !== 'button') values[it.id] = p && p.values && it.id in p.values ? p.values[it.id] : this.initial(P, it, o.ws || 'main')
    if (!p) { p = { id, created: now() }; this.list(P).push(p); while (this.list(P).length > 30) this.list(P).shift() }
    Object.assign(p, { spec: clone(spec), values, by: o.by || 'agent', thread: o.thread || p.thread || null, t: now(), pinned: o.pinned ?? p.pinned ?? false })
    P.saveMeta(); App.ev.emit('panels', id)
    return p
  },
  // a slider bound to a CSS variable starts at the file's value when there is one
  initial(P, it, ws) {
    if (it.value !== undefined) return it.value
    const b = it.bind || {}
    if (b.cssVar || b.style) {
      for (const f of b.file ? [b.file] : cssFiles(P, ws)) {
        const text = P.read(f, ws) || ''
        const m = b.cssVar ? new RegExp(b.cssVar.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;}]+)').exec(text) : (() => { const r = findRule(text, b.style.selector); if (!r) return null; return new RegExp('(?:^|[;{\\s])' + b.style.prop.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;}]+)').exec(text.slice(r.bodyStart, r.bodyEnd)) })()
        if (m) { const raw = m[1].trim(); if (it.type === 'slider') { const n = parseFloat(raw); if (!isNaN(n)) return n } else if (it.type !== 'toggle') return raw }
      }
    }
    if (b.store !== undefined && P.meta.store && b.store in P.meta.store) return P.meta.store[b.store]
    if (b.fixture && it.type === 'toggle') return false
    return it.type === 'slider' ? it.min : it.type === 'toggle' ? false : it.type === 'select' ? (this.options(P, it)[0] || {}).value ?? '' : it.type === 'color' ? '#000000' : ''
  },
  options(P, it) {
    if (it.bind && it.bind.css && !it.options) return Object.keys(it.bind.css).map(k => ({ value: k, label: k }))
    if (it.bind && it.bind.fixture && !it.options) return [{ value: '', label: 'Live data' }, ...fixtureList(P, App.ws).map(f => ({ value: f.name, label: f.name }))]
    return (it.options || []).map(o => typeof o === 'object' ? { value: o.value, label: o.label ?? String(o.value) } : { value: o, label: String(o) })
  },
  // the person (or ui.set) changes a value: apply its binding
  set(P, p, id, v, { by = 'you' } = {}) {
    const it = p.spec.items.find(x => x.id === id); if (!it) throw Object.assign(new Error('no control "' + id + '" in panel ' + p.id), { kind: 'missing' })
    if (it.type === 'slider') v = clamp(+v, it.min, it.max)
    p.values[id] = v; this.saveSoon(P)
    const b = it.bind
    if (b && b.css) {
      // a theme switch: drop what this control previewed before, then preview the CSS of the chosen state
      for (const [k, x] of Object.entries(Preview.vars)) if (x.panel === p.id && x.item === id) delete Preview.vars[k]
      for (const [k, x] of Object.entries(Preview.rules)) if (x.panel === p.id && x.item === id) delete Preview.rules[k]
      const map = b.css[it.type === 'toggle' ? (v ? 'on' : 'off') : String(v)] || {}
      for (const [key, val] of Object.entries(map)) {
        if (key.startsWith('--')) Preview.vars[key] = { value: String(val), panel: p.id, item: id }
        else for (const [prop, pv] of Object.entries(val)) Preview.rules[key + '|' + prop] = { selector: key, prop, value: String(pv), panel: p.id, item: id }
      }
      Preview.push()
    }
    else if (b && b.cssVar) { Preview.vars[b.cssVar] = { value: fmtVal(v, b.unit), panel: p.id, item: id }; Preview.push() }
    else if (b && b.style) { Preview.rules[b.style.selector + '|' + b.style.prop] = { selector: b.style.selector, prop: b.style.prop, value: fmtVal(v, b.unit), panel: p.id, item: id }; Preview.push() }
    else if (b && b.store !== undefined) { P.meta.store[b.store] = clone(v); P.saveMeta(); for (const fh of FrameHosts) if (fh.project === P && !fh.fx) fh.push({ push: 'store', key: b.store, value: v }); App.ev.emit('store', b.store) }
    else if (b && b.fixture) {
      const name = it.type === 'toggle' ? (v ? b.fixture.on : (b.fixture.off || null)) : (v || null)
      const targets = P.board().frames.filter(f => !b.fixture.frames || b.fixture.frames === 'all' || [].concat(b.fixture.frames).includes(f.id) || [].concat(b.fixture.frames).includes(f.route))
      for (const f of targets) { f.fixture = name || undefined; for (const fh of App.canvas ? App.canvas.hostsFor(f.id) : []) fh.setFixture(f.fixture) }
      P.saveMeta(); P.ev.emit('frames')
    }
    p.log = (p.log || []).concat([{ t: now(), id, v, by }]).slice(-40)
    App.ev.emit('panelvalue', p.id, id)
  },
  saveSoon: debounce(P => P.saveMeta(), 600),
  // write the previewed values of a panel into the CSS (the workspace being viewed)
  keep(P, p) {
    const ws = App.ws, written = new Map()
    const fileFor = b => b.file || (cssFiles(P, ws).includes('styles.css') ? 'styles.css' : cssFiles(P, ws)[0])
    const textOf = f => written.has(f) ? written.get(f) : (P.read(f, ws) ?? '')
    for (const [name, v] of Object.entries(Preview.vars)) {
      if (v.panel !== p.id) continue
      const it = p.spec.items.find(x => x.id === v.item), f = fileFor(it.bind); if (!f) continue
      let t = textOf(f), re = new RegExp('(' + name.replace(/[-]/g, '\\-') + '\\s*:\\s*)([^;}]+)')
      if (re.test(t)) t = t.replace(re, (m, a) => a + v.value)
      else if (findRule(t, ':root')) t = cssSet(t, ':root', name, v.value)
      else t = ':root { ' + name + ': ' + v.value + '; }\n' + t
      written.set(f, t)
    }
    for (const r of Object.values(Preview.rules)) {
      if (r.panel !== p.id) continue
      const it = p.spec.items.find(x => x.id === r.item), f = fileFor(it.bind); if (!f) continue
      let t = textOf(f); t = cssSet(t, r.selector, r.prop, r.value) ?? (t.replace(/\s*$/, '') + '\n\n' + r.selector + ' {\n  ' + r.prop + ': ' + r.value + ';\n}\n')
      written.set(f, t)
    }
    const what = [...Object.entries(Preview.vars).filter(([, v]) => v.panel === p.id).map(([k, v]) => k + ': ' + v.value), ...Object.values(Preview.rules).filter(r => r.panel === p.id).map(r => r.selector + ' { ' + r.prop + ': ' + r.value + ' }')]
    for (const [f, t] of written) P.write(f, t, { ws, who: 'you', note: 'kept from panel "' + (p.spec.title || p.id) + '": ' + what.join(', ') })
    Preview.clear(p.id)
    return { files: [...written.keys()], what }
  },
  // a button: its code runs as the person, in the workspace being viewed, with the panel's values in scope
  async run(P, p, it) {
    const code = 'const values = ' + JSON.stringify(p.values) + '\n' + it.run
    const ctx = { project: P, ws: App.ws, who: 'you', mode: 'auto' }
    this.runs.set(p.id, { label: it.label, busy: true }); App.ev.emit('panelvalue', p.id)
    const r = await runEval(ctx, code, hostAPI(ctx), { sid: 'panel:' + P.id + ':' + p.id })
    P.log({ kind: 'eval', who: 'you', ws: App.ws, ok: r.ok, note: 'panel "' + (p.spec.title || p.id) + '": ' + (it.label || 'button'), calls: [...new Set(r.calls || [])].slice(0, 12) })
    this.runs.set(p.id, { label: it.label, ok: r.ok, out: r.ok ? (r.value === undefined ? 'done' : trunc(toYAML(r.value), 600)) : r.error.kind + ': ' + r.error.message, fx: effectsLine(r.effects) })
    App.ev.emit('panelvalue', p.id)
    return r
  },
  remove(P, id) { const l = this.list(P), i = l.findIndex(p => p.id === id); if (i >= 0) l.splice(i, 1); Preview.clear(id); const w = this.waiting.get(id); if (w) w.resolve(null); P.saveMeta(); App.ev.emit('panels', id) }
}

// ---------- live sources for widgets ----------
const Streams = {
  issues: [], events: [], frames: [],
  // what the person does on the canvas, and what the pages say: clicks, changes, navigation, loads, console
  frame(fh, kind, detail, extra) {
    const e = { t: now(), kind, frame: fh.route, w: fh.w, fid: fh.fid, ws: fh.ws, detail: String(detail || '').slice(0, 200), ...(extra || {}) }
    this.frames.push(e); if (this.frames.length > 500) this.frames.shift()
    App.ev.emit('frameevent', e)
  },
  // project events and frame events in one list, oldest first
  merged(P, { kind, frame, since, limit = 50 } = {}) {
    const kinds = kind ? [].concat(kind) : null
    const proj = P.events.filter(e => (since == null || e.t > since) && (!kinds || kinds.includes(e.kind)) && !frame).map(e => ({ t: e.t, source: 'project', kind: e.kind, who: e.who === 'agent' ? 'claude' : e.who, ws: e.ws, path: e.path, table: e.table, detail: e.label || e.note || '', i: e.i }))
    const fr = this.frames.filter(e => (since == null || e.t > since) && (!kinds || kinds.includes(e.kind)) && (!frame || e.frame === frame || e.fid === frame)).map(e => ({ t: e.t, source: 'frame', kind: e.kind, frame: e.frame + ' ' + e.w + 'px', detail: e.detail }))
    return [...proj, ...fr].sort((a, b) => a.t - b.t).slice(-clamp(+limit || 50, 1, 500))
  },
  init() {
    App.ev.on('health', () => { const v = App.health(), last = this.issues[this.issues.length - 1]; if (!last || last.v !== v || now() - last.t > 60000) { this.issues.push({ t: now(), v }); if (this.issues.length > 240) this.issues.shift() } })
    App.ev.on('project', () => { this.issues = []; this.frames = [] })
  },
  // what changes make a source worth reading again
  triggers(from) {
    if (from.data) return ['tables']
    if (from.store !== undefined) return ['store']
    if (from.issues) return ['health']
    if (from.scenarios) return ['scenarios']
    if (from.events) return ['events']
    if (from.frameEvents) return ['frameevent']
    if (from.frame) return ['frameready', 'tables', 'store']
    return ['files', 'tables', 'scenarios', 'panelvalue']
  },
  async read(P, from, p) {
    if (from.data) {
      let rows = P.rows(from.data, from.where, App.ws)
      if (from.count) return rows.length
      if (from.sum) return rows.reduce((a, r) => a + (+r[from.sum] || 0), 0)
      if (from.group) { const m = new Map(); for (const r of rows) { const k = String(r[from.group] ?? '—'); m.set(k, (m.get(k) || 0) + (from.of ? (+r[from.of] || 0) : 1)) } return [...m].map(([label, value]) => ({ label, value })) }
      if (from.limit) rows = rows.slice(-from.limit)
      return rows
    }
    if (from.store !== undefined) { const v = (P.meta.store || {})[from.store]; return from.count ? (Array.isArray(v) ? v.reduce((a, x) => a + (+(x && x.qty) || 1), 0) : v ? Object.keys(v).length : 0) : v }
    if (from.issues) return this.issues.map(x => ({ t: x.t, value: x.v }))
    if (from.scenarios) { const l = scenarioList(P, App.ws); return from.count ? l.filter(s => s.last && s.last.ok).length + ' / ' + l.length : l.map(s => ({ scenario: s.name, result: s.error ? 'invalid' : !s.last ? 'not run' : s.last.ok ? 'passes' : 'fails at step ' + (s.last.failedAt + 1), when: s.last ? fmtAgo(s.last.t) : '' })) }
    if (from.events) {
      const per = from.per === 'hour' ? 3600000 : 60000, n = clamp(+from.buckets || 30, 5, 120), end = Math.ceil(now() / per) * per, out = Array.from({ length: n }, (_, k) => ({ t: end - (n - k) * per, value: 0 }))
      for (const e of P.events) { if (from.events !== true && e.kind !== from.events) continue; const k = Math.floor((e.t - (end - n * per)) / per); if (k >= 0 && k < n) out[k].value++ }
      return out
    }
    if (from.frameEvents) {
      const kinds = from.frameEvents === true ? null : [].concat(from.frameEvents)
      const evs = this.frames.filter(e => (!kinds || kinds.includes(e.kind)) && (!from.frame || e.frame === from.frame || e.fid === from.frame))
      if (from.count) return evs.length
      if (from.per) { const per = from.per === 'hour' ? 3600000 : 60000, n = clamp(+from.buckets || 30, 5, 120), end = Math.ceil(now() / per) * per, out = Array.from({ length: n }, (_, k) => ({ t: end - (n - k) * per, value: 0 })); for (const e of evs) { const k = Math.floor((e.t - (end - n * per)) / per); if (k >= 0 && k < n) out[k].value++ } return out }
      return evs.slice(-(from.limit || 20)).reverse().map(e => ({ when: fmtTime(e.t), frame: e.frame + ' ' + e.w, kind: e.kind, what: e.detail }))
    }
    if (from.frame) {
      const fr = P.frame(from.frame) || P.board().frames.find(f => f.route === from.frame); if (!fr) throw new Error('no frame ' + from.frame)
      const { fh } = await layoutIn(P, fr, App.ws)
      if (from.count) return fh.call('count', [from.count], 3000)
      if (from.text) return fh.call('text', [from.text], 3000)
      throw new Error('frame sources take count or text: a selector')
    }
    if (from.eval || from.lib) {
      const code = 'const values = ' + JSON.stringify(p.values) + '\n' + (from.eval || 'return await lib.' + from.lib + '(...' + JSON.stringify(from.args || []) + ')')
      const ctx = { project: P, ws: App.ws, who: 'you', mode: 'read' }
      const r = await runEval(ctx, code, hostAPI(ctx), { sid: 'panelsrc:' + P.id + ':' + p.id })
      if (!r.ok) throw new Error(r.error.kind + ': ' + r.error.message)
      return r.value
    }
    throw new Error('unknown source')
  }
}

// ---------- charts: one axis, thin marks, a tooltip on hover ----------
function chartEl(data, it) {
  const W = 320, H = 128, L = 30, R = it.kind === 'line' && Array.isArray(data) && data.series ? 54 : 10, T = 8, B = 20
  const wrap = h('div.pchart'), tip = h('div.ptip', { hidden: true })
  // normalize: numbers | {label, value} | {t, value} | rows with x/y fields | { series: [{ name, points }] }
  let series
  const asPoints = arr => arr.map((d, i) => typeof d === 'number' ? { x: i, label: String(i + 1), y: d } : d && 'value' in d ? { x: d.t ?? i, label: d.label ?? (d.t ? fmtTime(d.t) : String(i + 1)), y: +d.value || 0 } : { x: it.x ? d[it.x] : i, label: String(it.x ? d[it.x] : i + 1), y: +(it.y ? d[it.y] : Object.values(d).find(v => typeof v === 'number')) || 0 })
  if (data && Array.isArray(data.series)) series = data.series.slice(0, 3).map(s => ({ name: s.name, pts: asPoints(s.points || []) }))
  else if (Array.isArray(data)) series = [{ name: it.label || '', pts: asPoints(data) }]
  else { wrap.appendChild(h('p.note', 'Nothing to chart (expected a list).')); return wrap }
  const kind = it.kind || (series[0].pts.every(p => typeof p.x === 'number' && p.x > 1e11) ? 'line' : 'bar')
  const all = series.flatMap(s => s.pts); if (!all.length) { wrap.appendChild(h('p.note', 'No data yet.')); return wrap }
  const ymax = Math.max(0, ...all.map(p => p.y)), ymin = Math.min(0, ...all.map(p => p.y)), span = ymax - ymin || 1
  const nice = v => { const e = Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1))), f = Math.abs(v) / e; return Math.sign(v) * (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e }
  const top = ymax > 0 ? nice(ymax) : 0, bot = ymin < 0 ? nice(ymin) : 0, Y = v => T + (H - T - B) * (1 - (v - bot) / ((top - bot) || span))
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', 'aria-label': (it.label || 'chart') + ': ' + series.map(s => s.pts.length + ' points').join(', ') })
  const ints = all.every(p => Number.isInteger(p.y)), mid = (bot + top) / 2
  for (const v of ints && !Number.isInteger(mid) ? [bot, top] : [bot, mid, top]) { svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: v === 0 ? 'base' : 'grid' })); const tx = svgEl('text', { x: L - 4, y: Y(v) + 3, 'text-anchor': 'end', class: 'tick' }); tx.textContent = fmtNum(v); svg.appendChild(tx) }
  const show = (x, y, text) => { tip.hidden = false; tip.textContent = text; const r = wrap.getBoundingClientRect(); tip.style.left = clamp(x / W * r.width, 40, r.width - 40) + 'px'; tip.style.top = Math.max(0, y / H * r.height - 30) + 'px' }
  const hide = () => { tip.hidden = true }
  if (kind === 'bar') {
    const pts = series[0].pts.slice(-40), bw = Math.min(44, (W - L - R) / pts.length), gap = Math.min(2, bw * 0.2), off = L + ((W - L - R) - bw * pts.length) / 2
    pts.forEach((p, i) => {
      const x = off + i * bw + gap / 2, w = Math.max(1, bw - gap), y0 = Y(0), y1 = Y(p.y), r = Math.min(4, w / 2, Math.abs(y0 - y1))
      const d = p.y >= 0 ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z` : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`
      const bar = svgEl('path', { d, class: 'bar' }); svg.appendChild(bar)
      const hit = svgEl('rect', { x: off + i * bw, y: T, width: bw, height: H - T - B, fill: 'transparent' })
      hit.addEventListener('mouseenter', () => { bar.classList.add('on'); show(x + w / 2, Math.min(y0, y1), p.label + ': ' + fmtNum(p.y)) }); hit.addEventListener('mouseleave', () => { bar.classList.remove('on'); hide() })
      svg.appendChild(hit)
      if (pts.length <= 8) { const tx = svgEl('text', { x: x + w / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick' }); tx.textContent = trunc(p.label, Math.max(4, Math.floor(bw / 6))); svg.appendChild(tx) }
    })
  } else {
    const xs = all.map(p => +p.x), x0 = Math.min(...xs), x1 = Math.max(...xs), X = v => L + (W - L - R) * (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0))
    series.forEach((s, k) => {
      if (!s.pts.length) return
      svg.appendChild(svgEl('path', { d: s.pts.map((p, i) => (i ? 'L' : 'M') + X(+p.x).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' '), class: 'line s' + (k + 1) }))
      if (series.length > 1) { const l = s.pts[s.pts.length - 1], tx = svgEl('text', { x: X(+l.x) + 4, y: Y(l.y) + 3, class: 'tick end' }); tx.textContent = trunc(s.name || 'series ' + (k + 1), 9); svg.appendChild(tx) }
    })
    for (const [v, a] of [[x0, 'start'], [x1, 'end']]) { const tx = svgEl('text', { x: X(v), y: H - 6, 'text-anchor': a, class: 'tick' }); tx.textContent = x1 > 1e11 ? fmtTime(v) : fmtNum(v); svg.appendChild(tx) }
    const cross = svgEl('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' }), dots = series.map((s, k) => svgEl('circle', { r: 4, class: 'dot s' + (k + 1), visibility: 'hidden' }))
    svg.append(cross, ...dots)
    const hit = svgEl('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' })
    hit.addEventListener('mousemove', e => {
      const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * W, near = series[0].pts.reduce((b, p) => Math.abs(X(+p.x) - vx) < Math.abs(X(+b.x) - vx) ? p : b, series[0].pts[0])
      cross.setAttribute('x1', X(+near.x)); cross.setAttribute('x2', X(+near.x)); cross.setAttribute('visibility', 'visible')
      const parts = series.map((s, k) => { const q = s.pts.find(p => +p.x === +near.x); if (q) { dots[k].setAttribute('cx', X(+q.x)); dots[k].setAttribute('cy', Y(q.y)); dots[k].setAttribute('visibility', 'visible') } else dots[k].setAttribute('visibility', 'hidden'); return q ? (series.length > 1 ? (s.name || 'series ' + (k + 1)) + ' ' : '') + fmtNum(q.y) : '' }).filter(Boolean)
      show(X(+near.x), Y(near.y), near.label + ' · ' + parts.join(' · '))
    })
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); hide() })
    svg.appendChild(hit)
  }
  wrap.append(svg, tip)
  if (series.length > 1) wrap.appendChild(h('div.plegend', series.map((s, k) => h('span', h('i.s' + (k + 1)), s.name || 'series ' + (k + 1)))))
  return wrap
}
const fmtNum = v => typeof v !== 'number' ? String(v) : Math.abs(v) >= 10000 ? (v / 1000).toFixed(Math.abs(v) >= 100000 ? 0 : 1) + 'k' : Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)

// ---------- one panel, as a card ----------
function panelEl(P, p, { inline } = {}) {
  const card = h('div.panel' + (inline ? '.inline' : ''), { 'data-panel': p.id })
  const base = [], wl = []            // the card's listeners; the widgets' listeners (renewed on each paint)
  const paint = () => {
    wl.splice(0).forEach(f => f())
    const np = Panels.get(P, p.id); if (!np) { clear(card).appendChild(h('p.note', 'Panel "' + p.id + '" was removed.')); return } p = np
    clear(card)
    const waiting = Panels.waiting.get(p.id), run = Panels.runs.get(p.id), pv = Preview.count(p.id)
    card.appendChild(h('div.ph', h('b', p.spec.title || p.id), p.spec.description ? h('span.note', p.spec.description) : null, h('span.sp'),
      h('button.link.note', { title: 'Panel actions', on: { click: e => popMenu(e.currentTarget, [
        { label: p.pinned ? 'Unpin from the Panels tab' : 'Pin to the Panels tab', run: () => { p.pinned = !p.pinned; P.saveMeta(); App.ev.emit('panels', p.id); if (p.pinned) Dock.open('panels') } },
        { label: 'Show its definition', run: () => modal({ title: 'Panel "' + p.id + '"', wide: true, body: [h('pre.mono.yaml', { html: hlYAML(toYAML(p.spec)) })], actions: [{ label: 'Close' }] }) },
        { label: 'Remove', danger: true, run: () => Panels.remove(P, p.id) }], { right: true }) } }, '⋯')))
    const grid = h('div.pgrid')
    for (const it of p.spec.items) grid.appendChild(PANEL_CONTROLS.includes(it.type) ? controlEl(P, p, it) : widgetEl(P, p, it, wl))
    card.appendChild(grid)
    if (run) card.appendChild(h('div.prun' + (run.busy ? '' : run.ok ? '.ok' : '.bad'), h('b', run.label || 'button'), ' ', h('span.note', run.busy ? 'running…' : (run.ok ? 'done' : 'failed') + (run.fx ? ' · ' + run.fx : '')), run.busy ? null : h('pre.mono', run.out)))
    if (pv || waiting) card.appendChild(h('div.pfoot',
      pv ? [h('span.note', 'Previewing ' + plural(pv, 'value') + ' on the canvas, not in any file yet'), h('span.sp'),
        h('button.btn.sm', { on: { click: () => Preview.clear(p.id) } }, 'Reset'),
        h('button.btn.sm.primary', { title: 'Write the values into the CSS' + (App.ws !== 'main' ? ' of this proposal' : ''), on: { click: () => { const r = Panels.keep(P, p); toast('Kept ' + r.what.join(', ') + ' in ' + r.files.join(', ')) } } }, 'Keep')] : h('span.sp'),
      waiting ? [h('button.btn.sm', { on: { click: () => waiting.resolve(null) } }, 'Cancel'), h('button.btn.sm.primary', { on: { click: () => waiting.resolve(clone(p.values)) } }, waiting.label || 'Done')] : null))
  }
  const repaintSoon = debounce(() => { if (!card.contains(document.activeElement) || document.activeElement.type !== 'range') paint() }, 60)
  base.push(App.ev.on('panelvalue', id => { if (id === p.id) repaintSoon() }), App.ev.on('panels', id => { if (id === p.id) paint() }),
    App.ev.on('preview', () => paintFoot()), App.ev.on('ask', id => { if (id === p.id) paint() }))
  // only the footer depends on the preview; repainting the whole card mid-drag would drop the slider
  const paintFoot = () => { const has = !!card.querySelector('.pfoot'), want = Preview.count(p.id) > 0 || Panels.waiting.has(p.id); if (has !== want) paint(); else if (has) { const n = card.querySelector('.pfoot .note'); if (n) n.textContent = 'Previewing ' + plural(Preview.count(p.id), 'value') + ' on the canvas, not in any file yet' } }
  paint()
  // stop listening once the card leaves the page
  const mo = new MutationObserver(() => { if (!card.isConnected) { base.forEach(f => f()); wl.forEach(f => f()); mo.disconnect() } })
  setTimeout(() => mo.observe(document.body, { childList: true, subtree: true }), 0)
  return card
}
function controlEl(P, p, it) {
  const v = p.values[it.id], set = val => { try { Panels.set(P, p, it.id, val) } catch (e) { toast(e.message) } }
  const label = h('label.pl', it.label || it.id), out = h('span.pv')
  const show = val => { out.textContent = it.type === 'slider' ? fmtVal(val, it.bind && it.bind.unit || it.unit) : '' }
  let input
  const fill = (el, val) => el.style.setProperty('--p', ((val - it.min) / (it.max - it.min) * 100) + '%')
  if (it.type === 'slider') { input = h('input', { type: 'range', min: it.min, max: it.max, step: it.step || (it.max - it.min) / 100, value: v, on: { input: e => { fill(e.target, +e.target.value); show(+e.target.value); set(+e.target.value) } } }); fill(input, v); show(v) }
  else if (it.type === 'toggle') input = h('input', { type: 'checkbox', checked: !!v, on: { change: e => set(e.target.checked) } })
  else if (it.type === 'select') { input = h('select', { on: { change: e => { const o = Panels.options(P, it).find(o => String(o.value) === e.target.value); set(o ? o.value : e.target.value) } } }, Panels.options(P, it).map(o => h('option', { value: String(o.value), selected: String(o.value) === String(v) }, o.label))) }
  else if (it.type === 'text') input = h('input', { value: v ?? '', placeholder: it.placeholder || '', on: { change: e => set(e.target.value) } })
  else if (it.type === 'color') input = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000', on: { input: e => set(e.target.value) } })
  else if (it.type === 'button') return h('div.prow.btnrow', h('button.btn.sm', { disabled: !!(Panels.runs.get(p.id) || {}).busy, title: it.description || '', on: { click: () => Panels.run(P, p, it) } }, it.label || 'Run'), it.description ? h('span.note', it.description) : null)
  const bind = it.bind ? h('span.pb', { title: 'What this control changes' }, it.bind.css ? (() => { const m = it.bind.css[it.type === 'toggle' ? (v ? 'on' : 'off') : String(v)] || {}, n = Object.entries(m).reduce((a, [k, x]) => a + (k.startsWith('--') ? 1 : Object.keys(x).length), 0); return 'css: ' + plural(n, 'value') }) () : it.bind.cssVar ? it.bind.cssVar : it.bind.style ? it.bind.style.selector + ' ' + it.bind.style.prop : it.bind.store !== undefined ? 'store: ' + it.bind.store : it.bind.fixture ? 'fixture' : '') : null
  return h('div.prow', label, input, out, bind)
}
function widgetEl(P, p, it, offs) {   // offs collects the listeners, removed when the card repaints
  const box = h('div.pw' + (it.type === 'value' ? '.val' : ''))
  if (it.type === 'text' && !it.from) { box.appendChild(renderMarkdown(String(it.text || it.markdown || ''), f => P.read(f, 'main') !== null)); return box }
  let seq = 0
  const load = async () => {
    const my = ++seq
    let v, err
    try { v = await Streams.read(P, it.from, p) } catch (e) { err = e.message }
    if (my !== seq) return
    clear(box)
    if (it.label && it.type !== 'value') box.appendChild(h('div.pl', it.label))
    if (err) { box.appendChild(h('p.note', { style: { color: 'var(--accent)' } }, err)); return }
    if (it.type === 'value') box.append(h('div.big', typeof v === 'number' ? fmtNum(v) + (it.unit || '') : v == null ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v)), h('div.pl', it.label || ''))
    else if (it.type === 'chart') box.appendChild(chartEl(v, it))
    else if (it.type === 'table') {
      if (Array.isArray(v) && !v.length) { box.appendChild(h('p.note', it.empty || 'Nothing yet.')); return }
      const rows = Array.isArray(v) ? v.slice(0, it.limit || 50) : v && typeof v === 'object' ? Object.entries(v).map(([key, value]) => ({ key, value })) : [{ value: v }]
      const cols = it.cols || [...new Set(rows.flatMap(r => r && typeof r === 'object' ? Object.keys(r) : ['value']))].slice(0, 8)
      box.appendChild(h('div.ptable', h('table.grid.ro', h('thead', h('tr', cols.map(c => h('th', c)))), h('tbody', rows.map(r => h('tr', cols.map(c => { const x = r && typeof r === 'object' ? r[c] : r; return h('td', x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : typeof x === 'number' ? fmtNum(x) : String(x)) })))))))
      if (Array.isArray(v) && v.length > rows.length) box.appendChild(h('div.note', '… ' + (v.length - rows.length) + ' more'))
    }
    else if (it.type === 'list') box.appendChild(h('ul.plist', (Array.isArray(v) ? v : [v]).slice(0, it.limit || 30).map(x => h('li', x && typeof x === 'object' ? (x.label ?? x.name ?? Object.values(x).filter(v => v != null && v !== '' && typeof v !== 'object').join(' · ')) + ((x.label ?? x.name) != null && x.value !== undefined ? ': ' + x.value : '') : String(x)))))
    else if (it.type === 'text') box.appendChild(renderMarkdown(String(v ?? ''), f => P.read(f, 'main') !== null))
  }
  const soon = debounce(load, it.from.eval || it.from.lib ? 400 : 150)
  for (const t of Streams.triggers(it.from)) offs.push(App.ev.on(t, (...a) => { if (t === 'panelvalue' && a[0] !== p.id) return; soon() }))
  offs.push(App.ev.on('ws', soon))
  box.appendChild(h('p.note', '…')); load()
  return box
}

// ---------- the Panels tab: pinned panels, and panels made from the Eval panel ----------
registerView('panels', {
  title: 'Panels', sub: 'controls and live values',
  make() {
    const body = h('div.scroll'), el = h('div', body)
    function paint() {
      clear(body); const P = App.P; if (!P) return
      const list = Panels.list(P).filter(p => p.pinned)
      body.appendChild(h('div.toolbar', h('b', 'Panels'), h('span.note', 'pinned from threads, or made in the Eval panel'), h('span.sp'),
        Preview.count() ? [h('span.note', 'Previewing ' + plural(Preview.count(), 'value')), h('button.btn.sm', { on: { click: () => Preview.clear() } }, 'Reset all')] : null))
      if (!list.length) body.appendChild(h('div.empty', h('p', 'No pinned panels.'), h('p.note', 'Ask Claude for one, for example: "give me sliders for the menu\'s font size and spacing, a toggle for the empty-menu fixture, and a chart of open orders by status". Panels show in the reply; pin one here from its ⋯ menu.')))
      for (const p of list.slice().reverse()) body.appendChild(panelEl(P, p))
    }
    const later = debounce(() => { if (Dock.visible('panels')) paint() }, 80)
    App.ev.on('panels', later); App.ev.on('project', () => { Preview.vars = {}; Preview.rules = {}; later() })
    return { el, show: paint }
  }
})

// ===== 11-app.js =====
// ---------- app: header, projects, workspaces, modes, selection, wiring, boot ----------
const App = {
  P: null, ws: 'main', mode: 'select', sel: null, logs: [], ev: emitter(), prefs: {}, canvas: null, offs: [], traceTarget: null,

  // ---- queries ----
  health() { let n = 0; for (const fh of FrameHosts) if (!fh.headless && fh.project === this.P) n += fh.issues.length + fh.errors; return n },
  hostFor(fid) { return this.canvas ? this.canvas.hostFor(fid) : null },
  hostByFid(fid) { for (const fh of FrameHosts) if (fh.fid === fid) return fh; return null },
  firstHost() { for (const fh of FrameHosts) if (!fh.headless && fh.project === this.P) return fh; return null },
  pinsFor(route) { return this.P ? (this.P.meta.pins || []).filter(p => p.route === route) : [] },

  // ---- selection, pins, text edits ----
  // outline, in every frame, the elements a source line or CSS rule renders; resolves to how many, in how many frames
  async trace(target) {
    this.traceTarget = target || null
    let elements = 0, frames = 0
    await Promise.all([...FrameHosts].filter(fh => !fh.headless && fh.project === this.P && fh.ready).map(async fh => {
      try { const r = await fh.call('trace', [target || null], 1500); if (r && r.count) { elements += r.count; frames++ } } catch { }
    }))
    return target ? { elements, frames, selector: target.selector || null } : null
  },
  select(info) { if (this.traceTarget) this.trace(null); this.sel = info; this.ev.emit('sel', info); if (this.canvas) this.canvas.paintAll(); if (!Dock.visible('inspector') && !Dock.visible('code')) Dock.open('inspector') },
  placePin(host, m) { if (this.canvas) this.canvas.newPin(host, m) },
  openPin(id, host) { if (this.canvas) this.canvas.showPin(id, host) },
  textEdit(host, m) {
    const [file, line] = (m.src || '').split(':'), P = this.P, text = P.read(file, host.ws)
    if (text == null) return
    const off = offsetOfLine(text, +line), old = m.old.trim(), next = m.text.trim()
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    for (const cand of [old, esc(old), old.replace(/&/g, '&amp;')]) {
      const i = text.indexOf(cand, off)
      if (i >= 0 && i - off < 4000) { P.write(file, text.slice(0, i) + esc(next) + text.slice(i + cand.length), { ws: host.ws, who: 'you', note: 'text "' + old.slice(0, 24) + '" → "' + next.slice(0, 24) + '"' }); toast('Text updated in ' + file + ':' + lineOf(text, i)); return }
    }
    toast('Could not find that text in ' + file + ' (it may come from a script). Edit it in Code.'); host.load()
  },
  consoleAdd(l) { this.logs.push(l); if (this.logs.length > 1000) this.logs.splice(0, 200); this.ev.emit('log', l) },
  askAgent(text) { Dock.open('agent'); setTimeout(() => this.agentView && this.agentView.compose(text), 30) },
  showThread(tid) { Dock.open('agent'); if (this.agentView && this.P.threads.get(tid)) this.agentView.open(tid) },
  viewVersion(path, i) { Dock.open('code'); setTimeout(() => this.code && this.code.showVersion(path, i), 20) },
  openDoc(path) { Dock.open('docs'); setTimeout(() => this.docs && this.docs.open(path), 20) },
  reveal(file, line) { if (this.P.read(file, this.ws) === null && this.P.read(file, 'main') !== null && this.ws !== 'main') this.setWs('main'); Dock.open('code'); setTimeout(() => this.code && this.code.open(file, line), 20) },
  compare(on) { if (this.canvas) { this.canvas.compare = on && this.ws !== 'main'; this.canvas.sync() } this.paintHeader() },
  async addMark() { if (!this.P) return; const label = await promptBox('Add a mark', 'A label for this point in the session', 'Checkpoint ' + (this.P.marks().length + 1)); if (label) { this.P.mark({ label, by: 'you' }); toast('Marked') } },

  // ---- workspace and mode ----
  setWs(ws) {
    if (ws !== 'main' && (!this.P.overlays.get(ws) || this.P.overlays.get(ws).status !== 'open')) ws = 'main'
    if (this.code) this.code.commit()
    this.ws = ws; if (ws === 'main' && this.canvas) this.canvas.compare = false
    this.ev.emit('ws', ws); if (this.canvas) this.canvas.sync(); this.paintHeader()
  },
  setMode(m) { this.mode = m; for (const fh of FrameHosts) if (!fh.headless && fh.at == null) fh.push({ push: 'mode', mode: m }); if (this.canvas) this.canvas.paintAll(); this.paintHeader(); this.savePrefs() },

  // ---- prefs ----
  savePrefs: debounce(function () { Store.save('prefs', { theme: App.prefs.theme || 'auto', layout: Dock.layout, floats: Dock.floats, layouts: App.prefs.layouts || {}, mode: App.mode }) }, 800),
  theme(t) { this.prefs.theme = t; if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; this.savePrefs() },

  // ---- projects ----
  async openProject(id) {
    let P
    try { P = await Projects.open(id) } catch (e) { toast('Could not open that project: ' + e.message); return false }
    this.offs.forEach(f => f()); this.offs = []
    if (this.canvas) this.canvas.reset(); Headless.clear()
    this.P = P; this.ws = 'main'; this.sel = null; this.logs = []; this.playhead = null
    Projects.index.current = id; Projects.saveIndex()
    const reloadT = new Map()
    const reload = fh => { clearTimeout(reloadT.get(fh)); reloadT.set(fh, setTimeout(() => fh.load(), 180)) }
    this.offs.push(
      P.ev.on('files', (ws, paths) => { for (const fh of FrameHosts) if (fh.project === P && (ws === 'main' || fh.ws === ws)) { if (fh.headless) fh.stale = true; else reload(fh) } this.ev.emit('files', ws, paths); this.paintHeader() }),
      P.ev.on('tables', name => { for (const fh of FrameHosts) if (fh.project === P) fh.push({ push: 'db', table: name }); this.ev.emit('tables', name) }),
      P.ev.on('marks', () => this.snapMarkSoon(P)),
      P.ev.on('overlays', () => { if (this.ws !== 'main' && (!P.overlays.get(this.ws) || P.overlays.get(this.ws).status !== 'open')) this.setWs('main'); this.ev.emit('overlays'); this.paintHeader(); if (this.canvas) this.canvas.sync() }),
      P.ev.on('frames', () => { if (this.canvas) this.canvas.sync() }),
      P.ev.on('events', e => this.ev.emit('events', e)),
      P.ev.on('threads', () => this.ev.emit('threads')),
      P.ev.on('marks', () => this.ev.emit('events')),
      this.ev.on('pins', () => { for (const fh of FrameHosts) if (!fh.headless && fh.project === P) fh.push({ push: 'pins', pins: this.pinsFor(fh.route) }) }),
      this.ev.on('health', () => { this.paintHeader(); Dock.refreshTabs() }),
      ...this.autoMarks(P))
    this.ev.emit('project', P)
    if (this.canvas) this.canvas.sync()
    this.paintHeader()
    return true
  },
  // the playhead: the canvas shows main's pages as they were just after event i (null: now)
  playhead: null,
  setPlayhead(i) {
    const P = this.P; if (!P) return
    if (i != null) i = clamp(Math.round(i), 0, P.events.length - 1)
    if (i === this.playhead) return
    const was = this.playhead; this.playhead = i
    if (this.canvas) { if ((was == null) !== (i == null)) this.canvas.sync(); this.canvas.playhead() }
    this.ev.emit('playhead', i)
  },
  // events that change what main's pages look like (the playhead steps through these)
  pageEvents(P) { return P.events.filter(e => e.kind === 'init' || ((e.kind === 'write' || e.kind === 'remove') && e.ws === 'main')) },
  // a mark keeps frozen copies of the board's frames as they are, for the timeline and later comparison
  snapMarkSoon(P) {
    clearTimeout(this.snapT)
    this.snapT = setTimeout(async () => {
      if (P !== this.P) return
      const e = P.marks().slice(-1)[0]; if (!e || Snaps.list(P).some(s => s.events.includes(e.i))) return
      try { await snapshotBoard(P, 'main', { event: e.i, by: 'ide' }); this.ev.emit('events') } catch { }
    }, 700)
  },
  autoMarks(P) {
    const t0 = now(); let prev = null, errState = false
    const settle = () => now() - t0 > 4000 && this.P === P
    const hosts = () => [...FrameHosts].filter(fh => !fh.headless && fh.project === P)
    const check = debounce(() => {
      if (hosts().some(fh => fh.loading)) return check()
      const n = this.health(), errs = hosts().reduce((s, fh) => s + fh.errors, 0)
      if (settle() && prev > 0 && n === 0) P.mark({ label: 'All checks pass', by: 'ide', kind: 'auto' })
      if (!errs) errState = false
      prev = n
    }, 1200)
    return [this.ev.on('health', check), this.ev.on('log', l => {
      if (l.level !== 'error' || errState || !settle()) return
      errState = true; P.mark({ label: 'First error: ' + l.text.slice(0, 60), note: l.frame + (l.src ? ' @' + l.src : ''), by: 'ide', kind: 'auto' })
    })]
  },
  newProjectDialog() {
    let pick = 'coffee'
    const name = h('input.txt', { value: '', placeholder: 'Name (optional)', style: { width: '100%' } })
    const cards = h('div.tcards')
    const paint = () => { clear(cards); for (const t of TEMPLATES) cards.appendChild(h('button' + (t.id === pick ? '.on' : ''), { on: { click: () => { pick = t.id; paint() }, dblclick: () => go() } }, h('b', t.name), h('small', t.blurb), h('small', Object.keys(t.files).length + ' files' + (Object.keys(t.tables).length ? ' · ' + Object.keys(t.tables).length + ' tables' : '')))) }
    const go = async () => { m.close(); const p = await Projects.create({ template: pick, title: name.value.trim() || undefined }); await this.openProject(p.id); toast('New project: ' + p.title) }
    paint()
    const m = modal({ title: 'New project', body: [h('p.note', 'Each project is its own repository: files, tables, proposals, threads and timeline. Try ideas side by side.'), cards, name], actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, run: () => { go(); return false } }] })
  },
  async duplicate() { const d = this.P.export(); d.title = this.P.title + ' copy'; const p = await Projects.create({ data: d }); await this.openProject(p.id); toast('Duplicated as "' + p.title + '"') },
  async rename() { const t = await promptBox('Rename project', 'Title', this.P.title); if (t) { this.P.meta.title = t; this.P.saveMeta(); this.paintHeader() } },
  async remove() {
    const P = this.P
    if (!await confirmBox('Delete "' + P.title + '"?', 'Its files, tables, proposals, threads and timeline are deleted from storage. Export it first if you may want it back.', 'Delete project')) return
    const id = P.id; await Projects.remove(id)
    const next = Projects.index.projects[0]
    if (next) await this.openProject(next.id); else { const p = await Projects.create({ template: 'blank', title: 'Untitled' }); await this.openProject(p.id) }
    toast('Deleted')
  },
  async downloadProject() {
    toast('Packing ' + this.P.title + '…')
    try { const blob = await projectZip(this.P); await saveFile(slug(this.P.title) + '.sitebench.zip', blob) } catch (e) { toast('Could not build the zip: ' + e.message) }
  },
  async importFile(file) {
    try {
      const data = await readArchive(await file.arrayBuffer(), file.name || 'import')
      const p = await Projects.create({ data }); await this.openProject(p.id)
      toast('Imported "' + p.title + '": ' + plural(p.files.size, 'file') + (p.threads.size ? ', ' + plural(p.threads.size, 'thread') : ''))
      return true
    } catch (e) { toast('Import failed: ' + e.message, 5000); return false }
  },
  importDialog() {
    const input = h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', style: { display: 'none' }, on: { change: async () => { if (input.files[0] && await this.importFile(input.files[0])) m.close() } } })
    const drop = h('div', { style: { border: '1px dashed var(--ink-2)', padding: '28px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' } },
      h('b', 'Drop a .zip or .json here'), h('span.note', 'A Sitebench export (files, tables, proposals, threads, timeline), or any zip of site files.'),
      h('button.btn', { on: { click: () => input.click() } }, 'Choose a file…'), input)
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--accent)' })
    drop.addEventListener('dragleave', () => { drop.style.borderColor = '' })
    drop.addEventListener('drop', async e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f && await this.importFile(f)) m.close() })
    const ta = h('textarea.txt.mono', { placeholder: '{"sitebench": 1, "files": {...}}', style: { width: '100%', height: '140px', fontSize: '11px' } })
    const paste = h('details', h('summary', { style: { cursor: 'pointer' } }, 'Or paste exported JSON'), ta, h('div', { style: { marginTop: '6px' } }, h('button.btn.sm', { on: { click: async () => {
      let d; try { d = JSON.parse(ta.value) } catch { return toast('That is not valid JSON') }
      if (!d || typeof d.files !== 'object') return toast('No files in that JSON')
      const p = await Projects.create({ data: d }); await this.openProject(p.id); m.close(); toast('Imported "' + p.title + '"')
    } } }, 'Import JSON')))
    const m = modal({ title: 'Import a project', body: [drop, paste, h('p.note', 'It comes in as a new project; nothing you have is changed.')], actions: [{ label: 'Close' }] })
  },
  // dropping a zip anywhere on the workbench imports it
  dropImport() {
    let depth = 0
    const hint = h('div.drop-hint', { hidden: true, style: { inset: '8px' } }, h('span', 'Drop to import as a new project'))
    document.body.appendChild(hint)
    const files = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    addEventListener('dragenter', e => { if (!files(e) || $('.modal')) return; depth++; hint.hidden = false; document.body.classList.add('moving') })
    addEventListener('dragleave', e => { if (!files(e)) return; if (--depth <= 0) { depth = 0; hint.hidden = true; document.body.classList.remove('moving') } })
    addEventListener('dragover', e => { if (files(e)) e.preventDefault() })
    addEventListener('drop', e => {
      if (!files(e)) return
      e.preventDefault(); depth = 0; hint.hidden = true; document.body.classList.remove('moving')
      if ($('.modal')) return
      const f = e.dataTransfer.files[0]; if (f && /\.(zip|json)$/i.test(f.name)) this.importFile(f); else if (f) toast('Drop a .zip or .json project')
    })
  },

  // ---- header ----
  header() {
    this.hdr = {
      proj: h('button.projbtn', { on: { click: e => this.projectMenu(e.currentTarget) } }),
      ws: h('button.wsbtn', { title: 'Workspace: main, or a proposal on top of it', on: { click: e => this.wsMenu(e.currentTarget) } }),
      modes: h('div.seg.modes', [['select', 'Select', 'V'], ['play', 'Play', 'P'], ['comment', 'Comment', 'C']].map(([m, l, k]) => h('button', { 'data-m': m, title: l + ' (' + k + ')', on: { click: () => this.setMode(m) } }, l))),
      health: h('button.pill', { title: 'Layout, contrast and a11y checks, plus page errors', on: { click: e => this.healthMenu(e.currentTarget) } }),
      agent: h('button.pill.hide-s', { title: 'Claude', on: { click: () => Dock.open('agent') } }),
      store: h('button.pill.hide-s', { on: { click: () => Store.flush() } })
    }
    const H = this.hdr
    return h('header.bar', h('div.brand', 'Sitebench', h('i', 'live site workbench')),
      h('div.rel', H.proj), h('div.rel', H.ws), H.modes, h('span.sp'),
      h('div.rel', H.health), H.agent, H.store,
      h('button.btn.hide-s', { title: 'Bookmark this moment on the timeline', on: { click: () => this.addMark() } }, '+ Mark'),
      h('div.rel', h('button.btn', { on: { click: e => this.layoutMenu(e.currentTarget) } }, 'Layout')),
      h('button.ibtn', { title: 'Theme', on: { click: () => this.theme({ auto: 'dark', dark: 'light', light: 'auto' }[this.prefs.theme || 'auto']) } }, '◐'))
  },
  paintHeader() {
    const H = this.hdr; if (!H || !this.P) return
    const P = this.P, ov = this.ws !== 'main' ? P.overlays.get(this.ws) : null
    clear(H.proj).append(h('span.ptitle', P.title), h('span.pcode', P.files.size + ' files'), h('span.caret', '▾'))
    put(clear(H.ws), h('span.dot' + (ov ? '.busy' : '.ok')), ov ? 'Proposal: ' + (ov.title.length > 24 ? ov.title.slice(0, 24) + '…' : ov.title) : 'main', ov ? h('span.note', ' ' + P.changes(ov.id).length + ' changed') : null, h('span.caret', '▾'))
    for (const b of H.modes.children) b.classList.toggle('on', b.dataset.m === this.mode)
    const n = this.health()
    H.health.className = 'pill' + (n ? ' bad' : ''); clear(H.health).append(h('b', String(n)), h('span', n === 1 ? 'issue' : 'issues'))
    const busy = Agent.anyBusy()
    H.agent.className = 'pill hide-s' + (busy ? ' busy' : ''); clear(H.agent).append(h('b', busy ? 'Working' : Agent.sample ? 'Idle' : Agent.ready ? 'Off' : '…'), h('span', 'Claude'))
    const [lbl, where] = Store.label().split('|')
    H.store.title = where + (Store.error ? ' · ' + Store.error : '') + ' (click to save now)'; H.store.className = 'pill hide-s' + (Store.status === 'error' ? ' bad' : '')
    clear(H.store).append(h('b', lbl.split(' · ')[1]), h('span', lbl.split(' · ')[0]))
  },
  projectMenu(btn) {
    const items = [{ group: 'Projects in this artifact' }]
    for (const p of Projects.index.projects) items.push({ label: p.title, sub: (p.files || '?') + ' files · ' + fmtAgo(p.updated), on: this.P && p.id === this.P.id, run: () => { if (!this.P || p.id !== this.P.id) this.openProject(p.id) } })
    items.push({ hr: true }, { label: 'New project…', sub: 'from a template', run: () => this.newProjectDialog() }, { label: 'Duplicate', sub: 'try an idea on a copy', run: () => this.duplicate() },
      { label: 'Rename…', run: () => this.rename() }, { label: 'Download project', sub: '.zip with transcripts and timeline', run: () => this.downloadProject() }, { label: 'Import project…', sub: '.zip or .json', run: () => this.importDialog() },
      { hr: true }, { label: 'Delete project…', danger: true, run: () => this.remove() }, { note: Store.label().split('|')[1] + '.' })
    popMenu(btn, items)
  },
  wsMenu(btn) {
    const P = this.P, items = [{ group: 'Workspace' }, { label: 'main', sub: 'the files as they are', on: this.ws === 'main', run: () => this.setWs('main') }]
    for (const ov of P.openOverlays()) items.push({ label: ov.title, sub: (ov.by === 'agent' ? 'Claude' : 'you') + ' · ' + plural(P.changes(ov.id).length, 'change'), on: this.ws === ov.id, run: () => this.setWs(ov.id) })
    items.push({ hr: true }, { label: 'New draft', sub: 'edit in a proposal of your own', run: () => { const ov = P.newOverlay({ title: 'My draft ' + (P.overlays.size + 1) }); this.setWs(ov.id) } },
      { label: 'Review proposals', run: () => Dock.open('review') })
    if (this.ws !== 'main') items.push({ label: this.canvas && this.canvas.compare ? 'Stop comparing' : 'Compare with main', sub: 'on the canvas', run: () => this.compare(!(this.canvas && this.canvas.compare)) })
    popMenu(btn, items)
  },
  healthMenu(btn) {
    const items = [{ group: 'Checks and errors' }]
    for (const fh of FrameHosts) {
      if (fh.headless || fh.project !== this.P) continue
      for (const l of fh.logs.filter(l => l.level === 'error').slice(-3)) items.push({ label: fh.route + ' · error', sub: l.text.slice(0, 70), run: () => Dock.open('console') })
      for (const i of fh.issues) items.push({ label: fh.route + ' ' + fh.w + 'px · ' + i.kind, sub: i.message.slice(0, 70), run: () => { if (i.src) { const [f, l] = i.src.split(':'); this.reveal(f, +l) } fh.call('select', [i.src ? { src: i.src } : i.selector]).then(info => info && this.select({ ...info, fid: fh.fid, route: fh.route, ws: fh.ws })).catch(() => { }) } })
    }
    if (items.length === 1) items.push({ note: 'No issues in the frames on the canvas.' })
    else items.push({ hr: true }, { label: 'Ask Claude to fix these', run: () => this.askAgent('Fix the check issues and errors the frames report.') })
    popMenu(btn, items, { right: true })
  },
  layoutMenu(btn) {
    const saved = this.prefs.layouts || {}
    const items = [{ group: 'Layouts' }, ...Object.keys(LAYOUTS).map(n => ({ label: n, run: () => Dock.set(LAYOUTS[n](), []) }))]
    if (Object.keys(saved).length) { items.push({ group: 'Saved' }); for (const [n, l] of Object.entries(saved)) items.push({ label: n, run: () => Dock.set(clone(l.layout), clone(l.floats || [])) }) }
    items.push({ hr: true }, { label: 'Save current as…', run: async () => { const n = await promptBox('Save layout', 'Name', 'My layout'); if (n) { this.prefs.layouts = { ...saved, [n]: { layout: clone(Dock.layout), floats: clone(Dock.floats) } }; this.savePrefs(); toast('Saved layout "' + n + '"') } } })
    if (Object.keys(saved).length) items.push({ label: 'Forget saved layouts', danger: true, run: () => { this.prefs.layouts = {}; this.savePrefs() } })
    items.push({ note: 'Drag a tab onto a strip to join, onto an edge to split, or outside to float.' })
    popMenu(btn, items, { right: true })
  },

  // ---- boot ----
  async boot() {
    Streams.init()
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__SB = { App, Snaps, Headless, Agent }   // local test runs only

    const root = $('#app')
    clear(root)
    const work = h('div#work')
    root.append(this.header(), work)
    Dock.mount(work)
    Store.ev.on('status', () => this.paintHeader())
    Agent.ev.on('turn', () => this.paintHeader()); Agent.ev.on('ready', () => this.paintHeader())
    await Store.init()
    this.prefs = (await Store.get('prefs')) || {}
    this.theme(this.prefs.theme || 'auto'); this.mode = this.prefs.mode || 'select'
    await Projects.load()
    let first = Projects.index.current && Projects.index.projects.find(p => p.id === Projects.index.current)
    if (!first) first = Projects.index.projects[0]
    if (!first) { const p = await Projects.create({ template: 'coffee' }); first = { id: p.id } }
    const valid = l => { try { let ok = true; walkTiles(normalize(clone(l)), t => { t.views = t.views.filter(v => Views[v]); if (!t.views.length) ok = false }); return ok } catch { return false } }
    Dock.set(this.prefs.layout && valid(this.prefs.layout) ? clone(this.prefs.layout) : LAYOUTS.Build(), this.prefs.floats || [])
    if (!(await this.openProject(first.id))) { const p = await Projects.create({ template: 'coffee' }); await this.openProject(p.id) }
    Agent.init()
    this.dropImport()
    setTimeout(() => { if (!Sandbox.worker) Sandbox.spawn() }, 1200)
    document.addEventListener('keydown', e => {
      const t = e.target; if (t.closest && t.closest('input, textarea, select, [contenteditable]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'v') this.setMode('select'); else if (k === 'p') this.setMode('play'); else if (k === 'c') this.setMode('comment')
      else if (k === 'escape' && this.traceTarget) { this.trace(null); this.ev.emit('trace', null) }
      else if (k === 'escape' && this.sel) { this.sel = null; this.ev.emit('sel', null); for (const fh of FrameHosts) if (!fh.headless) fh.post({ op: 'select', args: [null], id: 0 }); if (this.canvas) this.canvas.paintAll() }
    })
    this.paintHeader()
  }
}
App.boot().catch(e => { console.error(e); const r = $('#app'); clear(r).appendChild(h('div.boot', h('div', h('b', 'Sitebench could not start'), h('pre.note', String(e && e.stack || e))))) })

})();
