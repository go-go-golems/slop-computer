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
