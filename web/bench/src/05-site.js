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

// ---------- FrameHost: one iframe (visible on the canvas or headless) and its probe ----------
const FrameHosts = new Set()
const hostByNonce = new Map()     // nonce of a load -> its FrameHost (iframes reload when the dock moves them)
addEventListener('message', e => {
  const m = e.data; if (!m || m.__sb !== 'probe') return
  const fh = hostByNonce.get(m.nonce); if (!fh) return
  const want = fh.next && fh.next.nonce === m.nonce ? fh.next.origin : fh.origin
  if (want && e.origin !== want) return
  fh.onMessage(m)
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
  // An app project's frame on its entry page shows the person's dev
  // instance as slop serves it (an embedded view), on the canvas and in
  // headless checks alike; anything else (another page, a proposal, a
  // fixture, an isolated run, the playhead) is built from the project's
  // files as Sitebench does.
  get embeddable() {
    const P = this.project
    return Slop.on && !!P.meta.app && this.at == null && !this.fixture && !this.isolate && this.ws === 'main' && this.route.split('#')[0] === Embeds.entry(P)
  }
  async load({ keepState = true } = {}) {
    if (keepState && this.iframe && this.ready) { try { this.saved = await this.call('state', [], 400) } catch { } }
    const embed = this.embeddable
    const style = { width: this.w + 'px', height: this.h + 'px', position: 'absolute', left: 0, top: 0, border: 0, opacity: this.iframe ? 0 : 1 }
    const nonce = uid('n'), ifr = h('iframe', embed ? { allow: 'clipboard-write; fullscreen', title: this.route, style } : { sandbox: PAGE_SANDBOX, title: this.route, style })
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
    if (embed) {
      try {
        const e = await Embeds.open(this.project)
        if (!this.next || this.next.nonce !== nonce) return this   // a newer load took over
        const u = new URL(e.src); u.searchParams.set('sbn', nonce); u.hash = this.route.includes('#') ? this.route.slice(this.route.indexOf('#')) : ''
        this.next.embed = e; this.next.origin = e.origin
        ifr.src = u.href
      } catch (err) {
        ifr.removeAttribute('allow'); ifr.setAttribute('sandbox', PAGE_SANDBOX)
        ifr.srcdoc = '<pre style="font:13px monospace;padding:16px;white-space:pre-wrap">The dev instance could not be shown: ' + escHtml(err.message || String(err)) + '</pre><script>parent.postMessage({ __sb: "probe", nonce: ' + JSON.stringify(nonce) + ', ev: "ready" }, "*")<\/script>'
      }
    } else {
      try { ifr.srcdoc = buildDoc(this.project, this.route, this.ws, cfg, src) } catch (err) { ifr.srcdoc = '<pre>' + escHtml(err.stack || err) + '</pre>' }
    }
    const timer = setTimeout(() => { if (this.next && this.next.nonce === nonce) this.swap() }, embed ? 10000 : 4000)
    await p; clearTimeout(timer)
    return this
  }
  // on screen with a layout: a canvas frame in a hidden tab measures as 0×0, so reads go to a headless frame instead
  get shown() { return this.headless || (this.el.isConnected && this.el.getClientRects().length > 0) }
  resetData() { this.fx = null; return this.load({ keepState: false }) }
  reloadSoon() { clearTimeout(this.reloadT); this.reloadT = setTimeout(() => this.load({ keepState: true }), 60) }
  // An embedded frame showing version n (or later) and loaded; resolves
  // anyway after ms (an activation that failed never reloads the frame).
  waitVersion(n, ms = 6000) {
    if (n == null) return Promise.resolve(false)
    const ok = () => !!this.embed && this.embed.version >= n && this.ready && !this.loading
    if (ok()) return Promise.resolve(true)
    return new Promise(res => {
      const iv = setInterval(() => { if (ok()) { clearInterval(iv); clearTimeout(t); res(true) } }, 40)
      const t = setTimeout(() => { clearInterval(iv); res(false) }, ms)
    })
  }
  setFixture(name) { this.fixture = name || null; this.fx = null; return this.load({ keepState: false }) }
  swap() {
    const n = this.next; if (!n) return
    if (this.iframe && this.iframe !== n.ifr) { hostByNonce.delete(this.nonce); this.iframe.remove() }
    n.ifr.style.opacity = 1; this.iframe = n.ifr; this.nonce = n.nonce; this.next = null; this.loading = false; this.ready = true
    this.embed = n.embed || null; this.origin = n.origin || ''
    if (this.embed && this.headless) this.post({ push: 'mode', mode: 'play' })
    else if (this.embed) { this.post({ push: 'mode', mode: App.mode }); this.post({ push: 'pins', pins: App.pinsFor(this.route) }); const pv = Preview.payload(); if (pv) this.post({ push: 'preview', preview: pv }) }
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
    const nx = this.next && nonce === this.next.nonce, ifr = nx ? this.next.ifr : this.iframe, to = (nx ? this.next.origin : this.origin) || '*'
    if (ifr && ifr.contentWindow) ifr.contentWindow.postMessage(Object.assign({ __sb: 'host' }, m), to)
  }
  push(m) { this.post(m); if (this.next && this.next.ifr.contentWindow) this.next.ifr.contentWindow.postMessage(Object.assign({ __sb: 'host' }, m), this.next.origin || '*') }
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

// The bench is the shell of its embedded frames: it answers their slop
// runtime (slop: 1 messages) as slop's shell answers a page it frames
// (pkg/doors/pages/assets/shell.js), for the view the bench opened. A new
// version (reload) or changed access (reopen) loads the frame again, in
// place. What needs the main host's session (consent, confirm, downloads)
// is declined here; open the app on its own mount for those.
addEventListener('message', async e => {
  const m = e.data; if (!m || m.slop !== 1 || typeof m.type !== 'string') return
  let fh = null, cur = false
  for (const x of FrameHosts) {
    if (x.next && x.next.embed && x.next.ifr.contentWindow === e.source) { fh = x; break }
    if (x.embed && x.iframe && x.iframe.contentWindow === e.source) { fh = x; cur = true; break }
  }
  if (!fh) return
  const emb = cur ? fh.embed : fh.next.embed
  if (e.origin !== emb.origin) return
  const reply = r => e.source.postMessage(Object.assign({}, r, { slop: 1 }), emb.origin)
  const give = () => reply({ type: 'view', view: emb.view, secret: emb.secret, expiresAt: emb.expiresAt })
  switch (m.type) {
    case 'hello': give(); return
    case 'renew':
      try { Object.assign(emb, await Slop.call('renew', { view: emb.view })); give() } catch (err) { if (cur) fh.reloadSoon() }
      return
    case 'reload': case 'reopen': if (cur) fh.reloadSoon(); return
    case 'consent': reply({ id: m.id, states: Object.fromEntries((Array.isArray(m.names) ? m.names : []).map(n => [String(n), 'denied'])) }); toast(fh.route + ' asked for ' + (m.names || []).join(', ') + ': not in the bench; open the app on its mount'); return
    case 'download': reply({ id: m.id, status: 'declined' }); return
    case 'confirm': reply({ id: m.id, approved: false }); toast(fh.route + ' asked to confirm a change: not in the bench'); return
    case 'compose': reply({ id: m.id, opened: false }); return
    case 'permissions': reply({ id: m.id }); return
  }
})

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
